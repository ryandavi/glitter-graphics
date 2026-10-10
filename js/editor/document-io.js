'use strict';

const EDITOR_DOCUMENT_IO_METHODS = {
	getBaseLayer() { return this.layerManager.getBaseLayer(); },
	getConstrainedCanvasSize(width, height) {
		const scale = Math.min(
			1,
			CONFIG.canvas.limits.maxWidth / width,
			CONFIG.canvas.limits.maxHeight / height
		);
		return {
			width: Math.max(1, Math.floor(width * scale)),
			height: Math.max(1, Math.floor(height * scale)),
			resized: !validateCanvasSize(width, height).ok
		};
	},

	confirmOversizedImageResize({ fileName, width, height, targetWidth, targetHeight, action = 'Open' }) {
		return this.confirmAction({
			title: 'Resize this image?',
			message: `This image is larger than the ${CONFIG.canvas.limits.maxWidth} × ${CONFIG.canvas.limits.maxHeight}px canvas limit.`,
			subject: {
				label: 'File',
				value: fileName || 'Untitled image'
			},
			facts: [
				{ label: 'Original', value: `${width} × ${height}px` },
				{ label: 'After resize', value: `${targetWidth} × ${targetHeight}px` }
			],
			outro: 'The original file on your device will not be changed.',
			confirmLabel: `Resize & ${action}`,
			cancelLabel: 'Cancel'
		});
	},

	// An uploaded GIF with more than one frame animates the base image. Only
	// its timing is read here: the preview plays the file itself and export
	// decodes it. The still base (originalImageData) stays its first frame.
	async readBaseAnimation(file) {
		if (file?.type !== 'image/gif') return null;
		let timing;
		try {
			timing = readGifTiming(new Uint8Array(await file.arrayBuffer()));
		} catch (error) {
			return null;
		}
		if (timing.frameCount < 2) return null;
		const limits = CONFIG.canvas.limits.animatedBase;
		const totalDuration = timing.frameDelays.reduce((sum, delay) => sum + delay, 0);
		const decodedMB = timing.width * timing.height * 4 * timing.frameCount / (1024 * 1024);
		const reason = timing.frameCount > limits.maxFrames ? `it has ${timing.frameCount} frames (the limit is ${limits.maxFrames})`
			: totalDuration > limits.maxDurationMs ? `it runs ${(totalDuration / 1000).toFixed(1)} s (the limit is ${limits.maxDurationMs / 1000} s)`
			: decodedMB > limits.maxDecodedMB ? 'it needs too much memory to play' : '';
		if (reason) {
			this.showError(`This GIF opened as a still image because ${reason}.`);
			return null;
		}
		const url = URL.createObjectURL(file);
		this.baseAnimationUrls.add(url);
		return { file, url, width: timing.width, height: timing.height, frameCount: timing.frameCount, frameDelays: timing.frameDelays, totalDuration };
	},

	// Undo can bring back an earlier base image, so its animation URL lives
	// until the document that made it is replaced.
	releaseBaseAnimationUrls() {
		this.baseAnimationUrls.forEach((url) => URL.revokeObjectURL(url));
		this.baseAnimationUrls.clear();
	},

	// Where an animated base sits, in canvas px: the box of its full frame,
	// and `clip`, the part of that box a crop has left. Pixels a crop removed
	// stay removed when the canvas grows again, as they do in the still base.
	createBaseAnimationPlacement(width, height) {
		return { x: 0, y: 0, width, height, clip: { x: 0, y: 0, width, height } };
	},

	// History snapshots share baseImageSource, so a change makes a new one.
	updateBaseAnimationPlacement(map) {
		const source = this.baseImageSource;
		if (source?.animation) this.baseImageSource = { ...source, placement: map(source.placement) };
	},

	// A project whose canvas was resized stores the still canvas and the
	// animated file apart; this puts the animation back over the loaded still.
	async attachBaseAnimation(file, placement) {
		const animation = await this.readBaseAnimation(file);
		if (!animation) return;
		this.baseImageSource = { ...this.baseImageSource, animation, placement: structuredClone(placement) };
		this.requestPreviewUpdate();
	},

	async replaceBaseImageFile(file) {
		if (!file || !this.originalImageData) return false;
		if (file.size > CONFIG.canvas.limits.maxFileSizeMB * 1024 * 1024) {
			this.showError(`Image too large. Maximum size is ${CONFIG.canvas.limits.maxFileSizeMB}MB`);
			return false;
		}
		const objectUrl = URL.createObjectURL(file);
		const image = await loadImageElement(objectUrl).catch(() => null);
		if (!image) {
			URL.revokeObjectURL(objectUrl);
			this.showError('Could not load that image. The file may be corrupt or unsupported.');
			return false;
		}
		const fittedSize = this.getConstrainedCanvasSize(image.width, image.height);
		if (fittedSize.resized) {
			const confirmed = await this.confirmOversizedImageResize({
				fileName: file.name,
				width: image.width,
				height: image.height,
				targetWidth: fittedSize.width,
				targetHeight: fittedSize.height,
				action: 'Replace'
			});
			if (!confirmed) {
				URL.revokeObjectURL(objectUrl);
				return false;
			}
		}
		if (this.autoGlitterManager?.isSessionActive()) this.autoGlitterManager.endSessionUI();
		const { width, height } = fittedSize;
		const animation = await this.readBaseAnimation(file);
		const offsetX = Math.round((width - this.originalCanvas.width) / 2);
		const offsetY = Math.round((height - this.originalCanvas.height) / 2);
		const previousImageUrl = this.originalImage?.src?.startsWith('blob:') ? this.originalImage.src : null;
		this.resizeCanvas(width, height, offsetX, offsetY, { saveHistory: false, updateStatus: false });
		this.originalCtx.clearRect(0, 0, width, height);
		this.originalCtx.drawImage(image, 0, 0, width, height);
		this.originalImage = image;
		this.originalImageData = this.originalCtx.getImageData(0, 0, width, height);
		this.originalAlphaChannel = new Uint8Array(width * height);
		for (let i = 0; i < this.originalAlphaChannel.length; i++) this.originalAlphaChannel[i] = this.originalImageData.data[i * 4 + 3];
		this.baseImageSource = { kind: 'file', file, renderedWidth: width, renderedHeight: height, hasBaseImage: true, animation, placement: this.createBaseAnimationPlacement(width, height) };
		if (previousImageUrl && previousImageUrl !== objectUrl) URL.revokeObjectURL(previousImageUrl);
		this.layerManager.updateBaseImageSwatchCache();
		const layer = this.layerManager.getBaseLayer();
		if (layer) layer.background.mode = 'image';
		this.requestPreviewUpdate();
		this.layerManager.renderLayersList();
		if (layer) this.baseBackgroundManager?.loadLayerSettings(layer);
		this.saveState('Edit document');
		this.updateStatus('Base image replaced');
		return true;
	},

	async loadImage(event) {
		const file = event.target.files[0];
		if (!file) return;
		try {
			// Once a project exists, every image-upload surface means “replace the
			// protected background image”; it must never clear the layer stack.
			if (this.originalImage && this.layers?.some((layer) => layer.type === LayerType.BASE_IMAGE)) {
				return await this.replaceBaseImageFile(file);
			}
			return await this.loadImageFile(file);
		} finally {
			if (event.target && 'value' in event.target) event.target.value = '';
		}
	},

	async loadImageFile(file, options = {}) {
		if (!file) return false;

		if (file.size > CONFIG.canvas.limits.maxFileSizeMB * 1024 * 1024) {
			this.showError(`Image too large. Maximum size is ${CONFIG.canvas.limits.maxFileSizeMB}MB`);
			return false;
		}

		return this.loadImageFromBlob(file, {
			...options,
			fileName: options.fileName || file.name,
			source: options.source || {
				kind: 'file',
				file
			}
		});
	},

	async loadImageFromBlob(blob, options = {}) {
		if (!blob) return false;

		const {
			fileName = 'image.png',
			source = null,
			preserveProjectName = false
		} = options;

		const objectUrl = URL.createObjectURL(blob);
		const decoded = this.beginActivity('open-image', 'Opening image');
		const img = await loadImageElement(objectUrl).catch(() => {
			URL.revokeObjectURL(objectUrl);
			this.showError('Could not load that image. The file may be corrupt or unsupported.');
			return null;
		}).finally(decoded);

		if (!img) {
			return false;
		}
		const fittedSize = this.getConstrainedCanvasSize(img.width, img.height);
		if (fittedSize.resized && source?.kind !== 'preset') {
			const confirmed = await this.confirmOversizedImageResize({
				fileName,
				width: img.width,
				height: img.height,
				targetWidth: fittedSize.width,
				targetHeight: fittedSize.height
			});
			if (!confirmed) {
				URL.revokeObjectURL(objectUrl);
				return false;
			}
		}

		const file = blob instanceof File ? blob : new File([blob], fileName, { type: blob.type || 'image/png' });
		this.releaseBaseAnimationUrls();
		const animation = source?.kind === 'preset' ? null : await this.readBaseAnimation(file);

		this.exportResultPresenter?.clear();
		if (this.originalImage && this.originalImage.src.startsWith('blob:')) {
			URL.revokeObjectURL(this.originalImage.src);
		}
		if (this.autoGlitterManager?.isSessionActive()) this.autoGlitterManager.endSessionUI();

		const { width, height } = fittedSize;

		this.originalImage = img;
		this.originalCanvas.width = width;
		this.originalCanvas.height = height;
		this.previewCanvas.width = width;
		this.previewCanvas.height = height;
		this._basePreviewCache = null;

		this.previewWrapper.style.width = width + 'px';
		this.previewWrapper.style.height = height + 'px';
		this.previewWrapper.classList.add('hasImage');

		this.originalCtx.drawImage(img, 0, 0, width, height);
		this.originalImageData = this.originalCtx.getImageData(0, 0, width, height);
		this.baseImageSource = source?.kind === 'preset'
			? {
				kind: 'preset',
				preset: { ...source.preset },
				hasBaseImage: false,
				renderedWidth: width,
				renderedHeight: height
			}
			: {
				kind: source?.kind || 'file',
				hasBaseImage: source?.hasBaseImage !== false,
				file,
				renderedWidth: width,
				renderedHeight: height,
				animation,
				placement: this.createBaseAnimationPlacement(width, height)
			};

		this.originalAlphaChannel = new Uint8Array(width * height);
		for (let i = 0; i < width * height; i++) {
			this.originalAlphaChannel[i] = this.originalImageData.data[i * 4 + 3];
		}

		this.layerManager.updateBaseImageSwatchCache();
		this.viewport.setCanvasDimensions(this.previewCanvas.width, this.previewCanvas.height);
		this.viewport.resetZoomSmart();
		this.updateZoomUI();

		this.originalCanvas.classList.add('visible');

		if (this.glitterManager) {
			this.layerManager.layers.forEach((layer) => {
				this.glitterManager.releaseLayerResources(layer);
			});
			this.paintMaskStore.clearAllPaintData();
		}
		this.layers = [];
		this.canvasElementsContainer.innerHTML = '';
		this.areaSelection.clear();
		this.viewport.selectionOverlay.clear();

		if (CONFIG.app.startup.layers.createBaseImage) {
			const layer = this.layerManager.createBaseImageLayer(LayerType.BASE_IMAGE);
			this.layers.push(layer);
		}

		if (CONFIG.app.startup.layers.createDefaultGlitterFill) {
			const layer = this.glitterManager.createLayer();
			this.layers.push(layer);
			this.layerManager.setActiveLayer(layer.id);
		} else if (this.layers.length === 0) {
			this.activeLayerId = null;
		}

		this.historyManager.reset(this.historyManager.createStateSnapshot());
		this.isSaved = false;
		if (!preserveProjectName) {
			this.setProjectName('', { markDirty: false });
		}

		this.refreshInspector();
		this.layerManager.renderLayersList();
		this.updateHistoryButtons();
		this.updateActionButtons();
		this.updateStatusBar();
		this.updateHelpfulMessage();

		this.previewCtx.putImageData(this.originalImageData, 0, 0);
		FontLibrary.ensureLoaded(CONFIG.tools.text.defaultFontId).catch(() => {});
		window.dispatchEvent(new Event('imageLoaded'));
		return true;
	},

	async saveProjectFile() {
		if (!this.originalImage) {
			this.showError('Load an image before saving a project.');
			return;
		}

		const done = this.beginActivity('save-project', 'Saving project');
		try {
			const blob = await this.projectSerializer.serializeToBlob();
			downloadBlob(blob, this.getProjectDownloadName());
			this.isSaved = true;
			this.updateStatus('Project saved');
		} catch (error) {
			console.error('Project save failed:', error);
			this.showError(error.message || 'Failed to save project.');
		} finally {
			done();
		}
	},

	async openProjectFile(file) {
		if (!file) return false;
		const done = this.beginActivity('open-project', 'Opening project');
		try {
			return await this.projectSerializer.loadFile(file);
		} catch (error) {
			console.error('Project load failed:', error);
			this.showError(error.message || 'Failed to open project.');
			return false;
		} finally {
			done();
		}
	}
};
