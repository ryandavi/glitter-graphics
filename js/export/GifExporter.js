// ============================================
// GIF EXPORTER
// Encodes the frames SceneCompositor plans and composes into an animated GIF
// (GifEncodingPipeline, GifPalette) and hands the file to the result presenter.
// ============================================
class GifExporter {
	constructor(compositor, options = {}) {
		this.compositor = compositor;
		this.fileName = `${CONFIG.export.core?.defaultBaseName || 'ryandavi-com_glitter'}.gif`;
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
		const { plan, exportSettings, preserveAlpha } = await this.compositor.planAnimation({ ...params, outputFormat: 'gif' });
		const frames = plan.frames;
		plan.frameCount = frames.length;
		delete plan.frames;
		const encoded = await this.gifEncodingPipeline.encode({
			frames,
			delays: plan.frameDurations,
			settings: exportSettings,
			transparency: { enabled: preserveAlpha },
			mode: 'animation',
			reportProgress: (phase, ratio, detail, current, total) => reportExportProgress(callbacks, phase, ratio, detail, current, total),
			isCancelled: callbacks.isCancelled
		});
		plan.colorAnalysis = encoded.analysis;
		if (plan.colorAnalysis) {
			plan.colorAnalysis.ditherEnabled = Boolean(exportSettings.ditherEnabled && !encoded.transparencyUsed);
			plan.colorAnalysis.paletteSize = encoded.paletteSize;
			plan.colorAnalysis.paletteMode = encoded.paletteMode;
			plan.colorAnalysis.authoredDither = visibleLayers.some((layer) => {
				const effects = layer.background?.pixelEffects;
				return effects?.paletteEnabled && effects.paletteMode === 'dither';
			});
		}
		this._handleFileSave(encoded.blob, callbacks, plan);
		return encoded.blob;
	}

	_handleFileSave(blob, callbacks, plan) {
		dbg('_handleFileSave called with blob size:', blob.size);
		reportExportProgress(callbacks, 'finalizing', 1, 'Export complete');
		callbacks.onStatus('Export complete!');
		callbacks.onComplete({
			smartReduced: plan.reduction.framesRemoved > 0,
			timelinePlan: plan
		});

		const file = new File([blob], this.fileName, {
			type: 'image/gif',
			lastModified: Date.now()
		});

		this.resultPresenter?.show({ blob, file, target: EXPORT_TARGETS['animation:gif'], width: plan.width, height: plan.height, frameCount: plan.frameCount, duration: plan.totalDuration / 1000, timelinePlan: plan });
	}
}
