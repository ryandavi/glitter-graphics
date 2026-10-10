'use strict';

const EDITOR_EXPORT_FLOW_METHODS = {
	showExportProgress(target) { this.exportProgressPresenter.show(target); },

	updateExportProgress(...args) { this.exportProgressPresenter.update(...args); },

	_updateExportProgressTime() { this.exportProgressPresenter.updateTime(); },

	hideExportProgress() { this.exportProgressPresenter.hide(); },

	validateExportSettings() {
		this.settingsStore.validate(this.exportSettings);
	},

	_layerIntersectsExportCanvas(layer) {
		if (!isTransformableLayerType(layer?.type)) return true;
		if (!this.originalCanvas?.width || !this.originalCanvas?.height) return true;
		if (GlitterAnimation.includesOffCanvas(layer.animations)) return true;

		try {
			const box = getLayerCanvasBox(this, layer, { visual: true });
			return !box || (box.right > 0 && box.bottom > 0 && box.left < this.originalCanvas.width && box.top < this.originalCanvas.height);
		} catch (error) {
			dbg('[Export] Could not measure layer bounds; keeping layer in export.', layer?.id, error);
			return true;
		}
	},

	// The document as an export or a scene snapshot composes it.
	getExportCanvasData() {
		return {
			width: this.originalCanvas.width,
			height: this.originalCanvas.height,
			originalData: new Uint8ClampedArray(this.originalImageData.data),
			originalAlpha: this.originalAlphaChannel,
			alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold,
			hasBaseImage: this.baseBackgroundManager?.hasBaseImage() ?? true,
			// Set when the base image is an animated GIF that plays.
			baseAnimation: this.baseBackgroundManager?.getAnimation() || null
		};
	},

	// Export settings for a picture of the scene at document size (filter
	// previews, the eyedropper): never watermarked, matted or resized.
	getSceneSnapshotSettings(overrides = {}) {
		return { ...structuredClone(this.exportSettings), watermarkEnabled: false, transparency: true, outputScale: CONFIG.export.defaults.outputScale, ...overrides };
	},

	// `fit` ({ label, limitBytes }) exports under a file size; without it the
	// Target Size export setting decides. A fit lowers settings on the job's
	// own snapshot and never writes to the stored export settings.
	async exportCurrentTarget({ fit = null } = {}) {
		if (this.exportInProgress) return;
		// Filter visible layers (ephemeral Auto Glitter previews never export)
		const candidateLayers = this.layers.filter(l => {
			if (!l.visible || l.isPreview) return false;
			return layerHasVisibleContent(l);
		});
		const visibleLayers = candidateLayers.filter((layer) => this._layerIntersectsExportCanvas(layer));
		const offCanvasLayerCount = candidateLayers.length - visibleLayers.length;
		if (offCanvasLayerCount > 0) dbg(`[Export] Skipping ${offCanvasLayerCount} fully off-canvas layer(s).`);

		if (visibleLayers.length === 0) {
			this.showError(candidateLayers.length
				? 'All visible content is outside the canvas.'
				: 'No visible layers with content to export!');
			return;
		}

		// Validate export settings before proceeding
		this.validateExportSettings();
		const target = getActiveExportTarget(this.exportSettings, { mp4Supported: this.mp4ExportSupported !== false });
		const exportSettings = structuredClone(this.exportSettings);
		if (!target.supportsTransparency) exportSettings.transparency = false;
		const goal = fit || resolveFitTarget(exportSettings);
		const activeExporter = this[target.exporter];
		activeExporter.setFileName(this.getProjectFileName(target.extension));

		this.exportInProgress = true;
		const memoryConfirmed = await this.confirmExportMemory(target, visibleLayers);
		this.exportInProgress = false;
		if (!memoryConfirmed) return;

		this.exportInProgress = true;
		this.updateExportActionUI();
		this.showExportProgress(target);

		const finishExport = () => {
			this.exportInProgress = false;
			this.hideExportProgress();
			this.updateExportActionUI();
		};
		const failExport = (error) => {
			dbg('Export error:', error);
			finishExport();
			if (error.message === 'Export cancelled') this.updateStatus('Export cancelled');
			else this.showError('Export failed: ' + error.message);
		};

		const exportParams = {
			visibleLayers: visibleLayers,
			glitterGifs: this.glitterLibrary.getRenderContent(),
			canvasData: this.getExportCanvasData(),
			target,
			timestamp: target.isStill && exportSettings.stillFrame === 'current' ? this.animationTicker.getCurrentTime() : 0,
			// Composed frames shared by the attempts of a fit.
			frameCache: goal ? {} : null
		};
		// One export. Exporters receive an immutable settings snapshot; UI
		// changes cannot alter a running job. The result comes back here, not
		// to Export Ready, so a fit can compare attempts before showing one.
		const runAttempt = async (settings) => {
			dbg('Export settings:', settings);
			let result = null;
			await activeExporter.process({
				...exportParams,
				exportSettings: settings,
				callbacks: {
					progressFormat: target.isStill ? 'still' : target.format,
					phaseTimer: createExportPhaseTimer(),
					onStatus: (msg) => this.updateStatus(msg),
					onProgress: (percent, text, currentFrame, totalFrames, progressInfo) => {
						if (this.exportCancelled) throw new Error('Export cancelled');
						this.updateExportProgress(percent, text, currentFrame, totalFrames, progressInfo);
					},
					onComplete: () => {},
					present: (delivered) => { result = delivered; },
					isCancelled: () => this.exportCancelled,
					createMask: (layer) => this.maskCompositor.getMaskData(layer),
					renderSlotMasks: (layer) => getLayerManagerForType(this, layer.type).renderSlotMasks(layer),
					ensureTextFont: (fontId) => FontLibrary.ensureLoaded(fontId)
				}
			});
			return result;
		};

		setTimeout(async () => {
			try {
				const attempts = [{ step: 0, overrides: {}, result: await runAttempt(exportSettings) }];
				let chosen = { best: 0, reached: true };
				while (goal) {
					attempts[attempts.length - 1].bytes = attempts[attempts.length - 1].result.blob.size;
					const next = planFitAttempt({ target, settings: exportSettings, limitBytes: goal.limitBytes, attempts });
					if (next.done) { chosen = next; break; }
					this.exportProgressPresenter.show(target, { title: `Fitting under ${goal.label}`, detail: `Attempt ${attempts.length + 1} of up to ${CONFIG.export.fit.maxAttempts}` });
					attempts.push({ ...next, result: await runAttempt({ ...exportSettings, ...next.overrides }) });
				}
				// Only a fit that had to change something is reported.
				const fitSummary = goal && attempts.length > 1 ? summarizeFit({ goal, attempts, ...chosen }) : null;
				this.isSaved = true;
				finishExport();
				this.exportResultPresenter.show({ ...attempts[chosen.best].result, fit: fitSummary });
			} catch (error) {
				failExport(error);
			} finally {
				// Decoded animation frames are only needed while composing.
				this.sceneCompositor.releaseDecodedSources();
			}
		}, 50);
	}
};
