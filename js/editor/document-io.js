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
		this.baseImageSource = { kind: 'file', file, renderedWidth: width, renderedHeight: height, hasBaseImage: true };
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
				file: blob instanceof File ? blob : new File([blob], fileName, { type: blob.type || 'image/png' }),
				renderedWidth: width,
				renderedHeight: height
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
		this.viewport.selectionOverlay.clear();

			if (CONFIG.app.startup.layers.createBaseImage) {
			const layer = this.layerManager.createBaseImageLayer(LayerType.BASE_IMAGE);
			this.layers.push(layer);
		}

		if (CONFIG.app.startup.layers.createDefaultGlitterFill) {
			const layer = this.createLayer();
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
