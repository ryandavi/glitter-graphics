const CANVAS_RESIZE_METHODS = {
scaleDocument(newWidth, newHeight, uniformScale, options = {}) {
		if (!this.originalImage) return;
		const oldWidth = this.originalCanvas.width;
		const oldHeight = this.originalCanvas.height;
		if (newWidth === oldWidth && newHeight === oldHeight) return;

		const scaleX = newWidth / oldWidth;
		const scaleY = newHeight / oldHeight;
		const scaled = document.createElement('canvas');
		scaled.width = newWidth;
		scaled.height = newHeight;
		const scaledCtx = scaled.getContext('2d', { willReadFrequently: true });
		scaledCtx.imageSmoothingEnabled = false;
		scaledCtx.drawImage(this.originalCanvas, 0, 0, newWidth, newHeight);

		this.originalCanvas.width = newWidth;
		this.originalCanvas.height = newHeight;
		this.originalCtx.imageSmoothingEnabled = false;
		this.originalCtx.drawImage(scaled, 0, 0);
		this.originalImageData = this.originalCtx.getImageData(0, 0, newWidth, newHeight);
		this.originalAlphaChannel = new Uint8Array(newWidth * newHeight);
		for (let index = 0; index < newWidth * newHeight; index++) {
			this.originalAlphaChannel[index] = this.originalImageData.data[index * 4 + 3];
		}

		this.previewCanvas.width = newWidth;
		this.previewCanvas.height = newHeight;
		this.previewWrapper.style.width = `${newWidth}px`;
		this.previewWrapper.style.height = `${newHeight}px`;

		this.glitterManager?.scaleForCanvasResize(newWidth, newHeight, scaleX, scaleY, this.layers);
		scaleDocumentLayerStates(this.layers, scaleX, scaleY, uniformScale, options);
		this.baseBackgroundManager?.invalidatePixelEffects();

		this.layers.forEach((layer) => {
			if (layer.type === LayerType.STICKER) this.stickerManager?.renderLayer(layer);
			else if (layer.type === LayerType.TEXT_GLITTER) this.textGlitterManager?.renderLayer(layer);
			else if (layer.type === LayerType.SHAPE) this.shapeGlitterManager?.renderLayer(layer);
		});

		this.layerManager.updateBaseImageSwatchCache();
		this.viewport.setCanvasDimensions(newWidth, newHeight);
		this.viewport.resetZoomSmart();
		this.updateZoomUI();
		if (options.saveHistory !== false) this.historyManager.saveState('Resize canvas');
		this.isSaved = false;
		if (options.updateStatus !== false) this.updateStatus(`Design scaled to ${newWidth} × ${newHeight} px`);

		this.hideCanvasResizePreview();
		this.requestPreviewUpdate();
		this.layerManager.renderLayersList();
		this.loadActiveLayerSettings();
		this.syncTransformHandlesForActiveLayer?.();
		this.syncCanvasSizeInputs();
		this.syncScaleDesignInputs();
		this.updateStatusBar();
		this.updateHistoryButtons();
	}

	// Structural canvas resize (Photoshop "Canvas Size"): change the canvas
	// bounds WITHOUT resampling. Content keeps its pixel size; it's translated by
	// (offsetX, offsetY) — where the old top-left lands in the new canvas — then
	// cropped or extended with transparent or solid-color margins. Crop reuses this exact
	// primitive by passing the crop rect's origin as a negative offset plus the
	// smaller size. Re-anchors every buffer and records an undoable history entry
	// (the snapshot carries the new canvas dims + base pixels; see
	// applyCanvasStateFromHistory), so Ctrl+Z restores the previous size.
,
	resizeCanvas(newWidth, newHeight, offsetX, offsetY, options = {}) {
		if (!this.originalImage) return;
		newWidth = Math.max(1, Math.round(newWidth));
		newHeight = Math.max(1, Math.round(newHeight));
		offsetX = Math.round(offsetX);
		offsetY = Math.round(offsetY);

		const oldWidth = this.originalCanvas.width;
		const oldHeight = this.originalCanvas.height;
		if (newWidth === oldWidth && newHeight === oldHeight && offsetX === 0 && offsetY === 0) {
			return;
		}

		// 1. Re-anchor the base image pixels onto a new canvas-sized buffer.
		const rebased = document.createElement('canvas');
		rebased.width = newWidth;
		rebased.height = newHeight;
		const rebasedCtx = rebased.getContext('2d', { willReadFrequently: true });
		const extensionSpecified = Object.prototype.hasOwnProperty.call(options, 'extensionColor');
		if (extensionSpecified && options.extensionColor) {
			rebasedCtx.fillStyle = options.extensionColor;
			rebasedCtx.fillRect(0, 0, newWidth, newHeight);
		} else if (!extensionSpecified && this.baseImageSource?.kind === 'preset') {
			rebasedCtx.fillStyle = this.baseImageSource.preset.color;
			rebasedCtx.fillRect(0, 0, newWidth, newHeight);
		}
		rebasedCtx.drawImage(this.originalCanvas, offsetX, offsetY);

		this.originalCanvas.width = newWidth;
		this.originalCanvas.height = newHeight;
		this.originalCtx.clearRect(0, 0, newWidth, newHeight);
		this.originalCtx.drawImage(rebased, 0, 0);
		this.originalImageData = this.originalCtx.getImageData(0, 0, newWidth, newHeight);

		this.originalAlphaChannel = new Uint8Array(newWidth * newHeight);
		for (let i = 0; i < newWidth * newHeight; i++) {
			this.originalAlphaChannel[i] = this.originalImageData.data[i * 4 + 3];
		}

		// 2. Preview surface + wrapper.
		this.previewCanvas.width = newWidth;
		this.previewCanvas.height = newHeight;
		this.previewWrapper.style.width = newWidth + 'px';
		this.previewWrapper.style.height = newHeight + 'px';

		// 3. Glitter paint buffers, selection seeds, and mask caches.
		this.glitterManager?.reanchorForCanvasResize(newWidth, newHeight, offsetX, offsetY, this.layers);

		// 4. Sticker / text positions shift with the content (canvas coords).
		this.layers.forEach((layer) => {
			if (layer.type === LayerType.STICKER && layer.stickerData?.transform?.position) {
				const position = layer.stickerData.transform.position;
				this.stickerManager?.updateTransform(layer.id, {
					position: { x: position.x + offsetX, y: position.y + offsetY }
				});
			} else if (layer.type === LayerType.TEXT_GLITTER && layer.textData?.transform?.position) {
				layer.textData.transform.position.x += offsetX;
				layer.textData.transform.position.y += offsetY;
				this.textGlitterManager?.renderLayer(layer);
			} else if (layer.type === LayerType.SHAPE && layer.shapeData?.transform?.position) {
				layer.shapeData.transform.position.x += offsetX;
				layer.shapeData.transform.position.y += offsetY;
				this.shapeGlitterManager?.renderLayer(layer);
			}
		});

		// 5. Base swatch, viewport, zoom.
		this.layerManager.updateBaseImageSwatchCache();
		this.viewport.setCanvasDimensions(newWidth, newHeight);
		this.viewport.resetZoomSmart();
		this.updateZoomUI();

		// 6. Undoable checkpoint. reanchorForCanvasResize re-captured paint at the
		// new size, and the snapshot records the new canvas dims + base pixels, so
		// undo restores the previous size/content and redo re-applies this resize.
		if (options.saveHistory !== false) this.historyManager.saveState('Resize canvas');
		this.isSaved = false;
		if (options.updateStatus !== false) this.updateStatus(`Canvas resized to ${newWidth} × ${newHeight} px`);

		// 7. Repaint composite + list + status; drop any live resize preview.
		this.hideCanvasResizePreview();
		this.requestPreviewUpdate();
		this.layerManager.renderLayersList();
		this.syncScaleDesignInputs();
		this.updateStatusBar();
		this.updateHistoryButtons();
	}

	// Restore canvas dimensions + base-image pixels from a history snapshot's
	// `canvas` field (see HistoryManager.createStateSnapshot). Called at the top
	// of restoreState, before paint/layers, so buffers rebuild at the right size.
,
	applyCanvasStateFromHistory(canvasState) {
		if (!canvasState || !canvasState.imageData) return;

		const sameSize = this.originalCanvas.width === canvasState.width
			&& this.originalCanvas.height === canvasState.height;
		const sameData = this.originalImageData === canvasState.imageData;
		if (sameSize && sameData) return; // typical non-resize undo — nothing to do

		const { width, height, imageData, alphaChannel } = canvasState;

		this.originalCanvas.width = width;
		this.originalCanvas.height = height;
		this.originalCtx.clearRect(0, 0, width, height);
		this.originalCtx.putImageData(imageData, 0, 0);
		this.originalImageData = imageData;
		this.originalAlphaChannel = alphaChannel;
		if ('baseImageSource' in canvasState) this.baseImageSource = canvasState.baseImageSource;
		if (canvasState.originalImage) this.originalImage = canvasState.originalImage;

		this.previewCanvas.width = width;
		this.previewCanvas.height = height;
		this.previewWrapper.style.width = width + 'px';
		this.previewWrapper.style.height = height + 'px';

		if (!sameSize) {
			// Live paint buffers are now the wrong size; restorePaintState (runs
			// next) rebuilds them at this size from each layer's snapshot.
			this.glitterManager?.discardLivePaintBuffers();
			this.viewport.setCanvasDimensions(width, height);
			this.viewport.resetZoomSmart();
			this.updateZoomUI();
		}

		this.layerManager.updateBaseImageSwatchCache();
		this.syncCanvasSizeInputs();
		this.syncScaleDesignInputs();
	}

	// Live preview overlay: a dashed rectangle inside previewWrapper (so it
	// inherits the viewport's zoom/pan transform for free) showing where the new
	// canvas bounds will fall relative to the current content. New bounds in
	// current-canvas coords = a rect at (-offsetX, -offsetY) sized newW×newH.
,
	_ensureCanvasResizePreviewEl() {
		if (this._canvasResizePreviewEl) return this._canvasResizePreviewEl;
		if (!this.previewWrapper) return null;
		const el = document.createElement('div');
		el.className = 'canvas-resize-preview';
		el.style.display = 'none';
		this.previewWrapper.appendChild(el);
		this._canvasResizePreviewEl = el;
		return el;
	}

,
	updateCanvasResizePreview() {
		const el = this._ensureCanvasResizePreviewEl();
		if (!el || !this.originalImage) {
			this.hideCanvasResizePreview();
			return;
		}

		const requested = this.getRequestedCanvasSize();
		if (
			!requested ||
			requested.width < 1 ||
			requested.height < 1 ||
			requested.width > CONFIG.canvas.limits.maxWidth ||
			requested.height > CONFIG.canvas.limits.maxHeight
		) {
			this.hideCanvasResizePreview();
			return;
		}
		const newWidth = requested.width;
		const newHeight = requested.height;

		const oldWidth = this.originalCanvas.width;
		const oldHeight = this.originalCanvas.height;
		if (newWidth === oldWidth && newHeight === oldHeight) {
			this.hideCanvasResizePreview();
			return;
		}

		const anchor = GlitterEditor.CANVAS_ANCHORS[this.canvasSizeAnchorIndex] || GlitterEditor.CANVAS_ANCHORS[4];
		const offsetX = Math.round((newWidth - oldWidth) * anchor.fx);
		const offsetY = Math.round((newHeight - oldHeight) * anchor.fy);

		el.style.left = `${-offsetX}px`;
		el.style.top = `${-offsetY}px`;
		el.style.width = `${newWidth}px`;
		el.style.height = `${newHeight}px`;
		el.style.display = 'block';
	}

,
	hideCanvasResizePreview() {
		if (this._canvasResizePreviewEl) {
			this._canvasResizePreviewEl.style.display = 'none';
		}
	}
};
