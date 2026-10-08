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

	async exportCurrentTarget() {
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
		const activeExporter = this[target.exporter];
		activeExporter.setFileName(this.getProjectFileName(target.extension));

		this.exportInProgress = true;
		const memoryConfirmed = await this.confirmExportMemory(target, visibleLayers);
		this.exportInProgress = false;
		if (!memoryConfirmed) return;

		this.exportInProgress = true;
		this.updateExportActionUI();
		this.showExportProgress(target);

		// Exporters receive this immutable snapshot; UI changes cannot alter a running job.
		dbg('Export settings:', exportSettings);
		let finished = false;
		const finishExport = () => {
			if (finished) return;
			finished = true;
			this.exportInProgress = false;
			this.hideExportProgress();
			this.updateExportActionUI();
		};

		const exportParams = {
			visibleLayers: visibleLayers,
			glitterGifs: this.glitterLibrary.getRenderContent(),
			canvasData: {
				width: this.originalCanvas.width,
				height: this.originalCanvas.height,
				originalData: new Uint8ClampedArray(this.originalImageData.data),
				originalAlpha: this.originalAlphaChannel,
				alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold,
				hasBaseImage: this.baseBackgroundManager?.hasBaseImage() ?? true
			},
			exportSettings,
			target,
			timestamp: target.isStill && exportSettings.stillFrame === 'current' ? this.animationTicker.getCurrentTime() : 0,
			callbacks: {
				progressFormat: target.isStill ? 'still' : target.format,
				phaseTimer: createExportPhaseTimer(),
				onStatus: (msg) => this.updateStatus(msg),
				onProgress: (percent, text, currentFrame, totalFrames, progressInfo) => {
					if (this.exportCancelled) throw new Error('Export cancelled');
					this.updateExportProgress(percent, text, currentFrame, totalFrames, progressInfo);
				},
				onComplete: () => {
					this.isSaved = true;
					finishExport();
				},

				onError: (error) => {
					// Fired by gif.js encoder events, outside our try/catch below
					finishExport();
					if (error.message === 'Export cancelled') this.updateStatus('Export cancelled');
					if (error.message !== 'Export cancelled') {
						this.showError('Export failed: ' + error.message);
					}
				},
				isCancelled: () => this.exportCancelled,
				createMask: (layer) => this.maskCompositor.getMaskData(layer),
				renderSlotMasks: (layer) => getLayerManagerForType(this, layer.type).renderSlotMasks(layer),
				ensureTextFont: (fontId) => FontLibrary.ensureLoaded(fontId)
			}
		};

		setTimeout(async () => {
			try {
				await activeExporter.process(exportParams);
			} catch (error) {
				dbg('Export error:', error);
				finishExport();
				if (error.message === 'Export cancelled') this.updateStatus('Export cancelled');
				if (error.message !== 'Export cancelled') {
					this.showError('Export failed: ' + error.message);
				}
			} finally {
				// Decoded animation frames are only needed while composing.
				this.sceneCompositor.releaseDecodedSources();
			}
		}, 50);
	}
};
