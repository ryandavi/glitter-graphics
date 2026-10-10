// ============================================
// GIF EXPORTER
// Encodes the frames SceneCompositor plans and composes into an animated GIF
// (GifEncodingPipeline, GifPalette) and hands the file to the result presenter.
// ============================================
class GifExporter {
	constructor(compositor, options = {}) {
		this.compositor = compositor;
		this.fileName = `${CONFIG.export.core.defaultBaseName}.gif`;
		this.resultPresenter = options.resultPresenter || (typeof ExportResultPresenter === 'function' ? new ExportResultPresenter() : null);
		this.gifEncodingPipeline = options.gifEncodingPipeline || new GifEncodingPipeline();
	}

	setFileName(fileName) {
		if (fileName) {
			this.fileName = fileName;
		}
	}

	async process(params) {
		const { visibleLayers, callbacks } = params;
		const { plan, frames, context, exportSettings, preserveAlpha } = await this._planFrames(params);
		const encoded = await this.gifEncodingPipeline.encode({
			frames,
			delays: plan.frameDurations,
			settings: exportSettings,
			// A soft glow over transparency fades out as a dither instead of
			// stopping at a hard edge where alpha crosses the cut.
			transparency: { enabled: preserveAlpha, ditherSoftEdges: preserveAlpha && visibleLayers.some(layerHasSoftShadow) },
			mode: 'animation',
			reportProgress: (phase, ratio, detail, current, total) => reportExportProgress(callbacks, phase, ratio, detail, current, total),
			isCancelled: callbacks.isCancelled
		});
		plan.colorAnalysis = encoded.analysis;
		if (plan.colorAnalysis) {
			plan.colorAnalysis.ditherEnabled = Boolean(exportSettings.ditherEnabled && !encoded.transparencyUsed);
			plan.colorAnalysis.paletteSize = encoded.paletteSize;
			plan.colorAnalysis.paletteMode = encoded.paletteMode;
			plan.colorAnalysis.authoredDither = visibleLayers.some((layer) => layer.type === LayerType.FILTER
				&& layer.filterData?.type === 'dither' && GlitterFilter.isActive(layer.filterData, layer.opacity));
		}
		this._handleFileSave(encoded.blob, callbacks, plan);
		logExportTimings('gif', {
			plan, context, exportSettings, blob: encoded.blob,
			details: {
				transparent: encoded.transparencyUsed,
				palette: `${encoded.paletteMode} ${encoded.paletteSize}`,
				dither: exportSettings.ditherEnabled && !encoded.transparencyUsed ? exportSettings.ditherType : 'off',
				workers: encoded.workers,
				...encoded.timings
			}
		});
		return encoded.blob;
	}

	// Plans and composes the frames. A size fit passes `frameCache`, so an
	// attempt that only changes the encoding reuses the previous attempt's
	// frames. The encoder empties the list it is given, hence the copies.
	async _planFrames(params) {
		const cache = params.frameCache;
		const key = cache ? JSON.stringify(Object.entries(params.exportSettings).filter(([name]) => !GIF_ENCODE_ONLY_SETTINGS.includes(name))) : '';
		if (cache && cache.key === key) return { ...cache.planned, plan: { ...cache.planned.plan }, frames: [...cache.frames] };
		const planned = await this.compositor.planAnimation({ ...params, outputFormat: 'gif' });
		const frames = planned.plan.frames;
		planned.plan.frameCount = frames.length;
		delete planned.plan.frames;
		if (!cache) return { ...planned, frames };
		const bytes = frames.reduce((sum, frame) => sum + frame.data.byteLength, 0);
		const keep = bytes <= CONFIG.export.fit.frameCacheBytes;
		Object.assign(cache, { key: keep ? key : null, planned: keep ? planned : null, frames: keep ? frames : null });
		return { ...planned, plan: { ...planned.plan }, frames: keep ? [...frames] : frames };
	}

	_handleFileSave(blob, callbacks, plan) {
		dbg('_handleFileSave called with blob size:', blob.size);
		reportExportProgress(callbacks, 'finalizing', 1, 'Export complete');
		plan.phaseTimings = callbacks.phaseTimer?.finish();
		deliverExportResult(callbacks, this.resultPresenter, {
			blob,
			fileName: this.fileName,
			completion: { smartReduced: plan.reduction.framesRemoved > 0, timelinePlan: plan },
			target: EXPORT_TARGETS['animation:gif'],
			width: plan.width,
			height: plan.height,
			frameCount: plan.frameCount,
			duration: plan.totalDuration / 1000,
			timelinePlan: plan
		});
	}
}
