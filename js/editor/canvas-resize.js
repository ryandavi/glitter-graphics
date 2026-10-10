const CANVAS_RESIZE_METHODS = {
	setCanvasSurface(width, height, draw) {
		this.originalCanvas.width = width; this.originalCanvas.height = height;
		this.originalCtx.imageSmoothingEnabled = false;
		draw(this.originalCtx);
		this.originalImageData = this.originalCtx.getImageData(0, 0, width, height);
		this.originalAlphaChannel = new Uint8Array(width * height);
		for (let index = 0; index < width * height; index++) this.originalAlphaChannel[index] = this.originalImageData.data[index * 4 + 3];
		this.previewCanvas.width = width; this.previewCanvas.height = height;
		this._basePreviewCache = null;
		this.previewWrapper.style.width = `${width}px`; this.previewWrapper.style.height = `${height}px`;
		this.viewport.setCanvasDimensions(width, height);
	},
	refreshAfterCanvasChange({ restoring = false } = {}) {
		this.resetDocumentSize();
		this.layerManager.updateBaseImageSwatchCache();
		if (restoring) return;
		this.requestPreviewUpdate(); this.layerManager.renderLayersList();
		this.loadActiveLayerSettings(); this.syncTransformHandlesForActiveLayer?.();
		this.updateStatusBar(); this.updateHistoryButtons();
	},

scaleDocument(newWidth, newHeight, uniformScale, options = {}) {
		if (!this.originalImage) return;
		const oldWidth = this.originalCanvas.width;
		const oldHeight = this.originalCanvas.height;
		if (newWidth === oldWidth && newHeight === oldHeight) return;

		const scaleX = newWidth / oldWidth;
		const scaleY = newHeight / oldHeight;
		const scaled = createAppCanvas(0, 0, 'editor/canvas-resize');
		scaled.width = newWidth;
		scaled.height = newHeight;
		const scaledCtx = scaled.getContext('2d', { willReadFrequently: true });
		scaledCtx.imageSmoothingEnabled = false;
		scaledCtx.drawImage(this.originalCanvas, 0, 0, newWidth, newHeight);

		this.setCanvasSurface(newWidth, newHeight, (ctx) => ctx.drawImage(scaled, 0, 0));

		this.glitterManager?.scaleSelectionsForCanvasResize(newWidth, newHeight, scaleX, scaleY, this.layers);
		this.paintMaskStore.scaleForCanvasResize(newWidth, newHeight, scaleX, scaleY, this.layers);
		this.areaSelection.transformPoints((point) => ({ x: point.x * scaleX, y: point.y * scaleY }));
		this.updateBaseAnimationPlacement((box) => {
			const left = Math.round(box.clip.x * scaleX);
			const top = Math.round(box.clip.y * scaleY);
			return {
				x: box.x * scaleX, y: box.y * scaleY, width: box.width * scaleX, height: box.height * scaleY,
				clip: { x: left, y: top, width: Math.round((box.clip.x + box.clip.width) * scaleX) - left, height: Math.round((box.clip.y + box.clip.height) * scaleY) - top }
			};
		});
		scaleDocumentLayerStates(this.layers, scaleX, scaleY, uniformScale, {
			...options,
			// Read after the canvas took its new size above.
			elementBox: (layer) => LAYER_UI_CONFIG[layer.type]?.elementBox?.(this, layer)
		});

		this.layers.forEach((layer) => {
			if (isTransformableLayerType(layer.type)) getLayerManagerForType(this, layer.type)?.renderLayer(layer);
		});

		this.layerManager.updateBaseImageSwatchCache();
		this.viewport.setCanvasDimensions(newWidth, newHeight);
		this.viewport.resetZoomSmart();
		this.updateZoomUI();
		if (options.saveHistory !== false) this.historyManager.saveState(options.historyLabel || 'Resize canvas');
		this.isSaved = false;
		if (options.updateStatus !== false) this.updateStatus(`Design scaled to ${newWidth} × ${newHeight} px`);

		this.refreshAfterCanvasChange();
	}

	// Bounding box (canvas pixel coords) of everything that counts as
	// "artwork": every movable layer's visual bounds (every painted pixel,
	// shadows included; see getLayerVisualBounds). The base
	// image is deliberately NOT included — it defines the canvas by
	// construction (canvas dims = image dims on load) and is almost always
	// opaque edge-to-edge, so folding it in would make this a no-op for the
	// common case. Fill layers contribute their transformed visible-mask bounds.
	// Returns null when there are no movable painted layers.
,
	getArtworkBounds(layers = this.layers) {
		if (!this.originalImage) return null;
		const box = getLayersCanvasBox(this, layers.filter((layer) => layer.visible !== false), { visual: true });
		if (!box) return null;
		const minX = Math.floor(box.left), minY = Math.floor(box.top);
		return { minX, minY, width: Math.max(1, Math.ceil(box.right) - minX), height: Math.max(1, Math.ceil(box.bottom) - minY) };
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
		const rebased = createAppCanvas(0, 0, 'editor/canvas-resize');
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

		this.setCanvasSurface(newWidth, newHeight, (ctx) => ctx.drawImage(rebased, 0, 0));

		// 3. Glitter paint buffers, selection seeds, and mask caches.
		this.glitterManager?.reanchorTransformsForCanvasResize(
			oldWidth,
			oldHeight,
			newWidth,
			newHeight,
			offsetX,
			offsetY,
			this.layers
		);
		this.glitterManager?.reanchorSelectionsForCanvasResize(offsetX, offsetY, this.layers);
		this.paintMaskStore.reanchorForCanvasResize(newWidth, newHeight, offsetX, offsetY, this.layers);
		this.areaSelection.transformPoints((point) => ({ x: point.x + offsetX, y: point.y + offsetY }));
		this.updateBaseAnimationPlacement((box) => {
			const left = Math.max(0, box.clip.x + offsetX);
			const top = Math.max(0, box.clip.y + offsetY);
			const right = Math.min(newWidth, box.clip.x + offsetX + box.clip.width);
			const bottom = Math.min(newHeight, box.clip.y + offsetY + box.clip.height);
			return { ...box, x: box.x + offsetX, y: box.y + offsetY, clip: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) } };
		});

		// 4. Sticker / text positions shift with the content (canvas coords).
		this.layers.forEach((layer) => {
			if (!isTransformableLayerType(layer.type)) return;
			if (layer.type === LayerType.GLITTER_FILL) {
				this.glitterManager?.renderLayer(layer, newWidth, newHeight);
				return;
			}
			const position = layer.transform.position;
			if (layer.type === LayerType.STICKER) {
				this.stickerManager?.updateTransform(layer.id, {
					position: { x: position.x + offsetX, y: position.y + offsetY }
				});
			} else {
				position.x += offsetX;
				position.y += offsetY;
				getLayerManagerForType(this, layer.type)?.renderLayer(layer);
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
		if (options.saveHistory !== false) this.historyManager.saveState(options.historyLabel || 'Resize canvas');
		this.isSaved = false;
		if (options.updateStatus !== false) this.updateStatus(`Canvas resized to ${newWidth} × ${newHeight} px`);

		// 7. Repaint composite + list + status; drop any live resize preview.
		this.refreshAfterCanvasChange();
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

		this.setCanvasSurface(width, height, (ctx) => ctx.putImageData(imageData, 0, 0));
		this.originalImageData = imageData;
		this.originalAlphaChannel = alphaChannel;
		if ('baseImageSource' in canvasState) this.baseImageSource = canvasState.baseImageSource;
		if (canvasState.originalImage) this.originalImage = canvasState.originalImage;

		if (!sameSize) {
			// Live paint buffers are now the wrong size; restorePaintState (runs
			// next) rebuilds them at this size from each layer's snapshot.
			this.paintMaskStore?.discardLivePaintBuffers();
			// The area is not in history, so it cannot follow a size it never saw.
			this.areaSelection.clear();
			this.viewport.setCanvasDimensions(width, height);
			this.viewport.resetZoomSmart();
			this.updateZoomUI();
		}

		this.refreshAfterCanvasChange({ restoring: true });
	}

};
