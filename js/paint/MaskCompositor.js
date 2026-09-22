class MaskCompositor {
	constructor(editor) {
		this.editor = editor;
		this.cache = new Map();
		this.selectionCanvasCache = new Map();
	}

	getMaskCanvas(layer, options = {}) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL || !this.editor.originalCanvas) {
			return this._createCanvas(1, 1);
		}

		const { draft = false } = options;
		const paint = this.editor.glitterManager.getPaintMask(layer.id);

		if (!paint?.hasContent) {
			return this._createCanvasFromMaskData(
				this.editor.glitterManager.createMaskForLayer(layer),
				this.editor.originalCanvas.width,
				this.editor.originalCanvas.height
			);
		}

		const cacheKey = this.getCacheKey(layer, options);
		if (!draft) {
			const cached = this.cache.get(layer.id);
			if (cached?.key === cacheKey) {
				return cached.canvas;
			}
		}

		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const selectionCanvas = this._getSelectionMaskCanvas(layer, width, height);
		const compositeCanvas = this._createCanvas(width, height);
		const compositeCtx = compositeCanvas.getContext('2d', { willReadFrequently: true });

		compositeCtx.clearRect(0, 0, width, height);
		compositeCtx.drawImage(selectionCanvas, 0, 0);

		compositeCtx.globalCompositeOperation = 'source-over';
		compositeCtx.drawImage(paint.add, 0, 0);

		compositeCtx.globalCompositeOperation = 'destination-out';
		compositeCtx.drawImage(paint.sub, 0, 0);
		compositeCtx.globalCompositeOperation = 'source-over';

		const featheredCanvas = this._applyFeatherToCanvas(compositeCanvas, layer.settings.feather, draft);
		const finalCanvas = this._applyInvertIfNeeded(featheredCanvas, layer.settings.invert);

		if (!draft) {
			this.cache.set(layer.id, {
				key: cacheKey,
				canvas: finalCanvas,
				data: null
			});
		}

		return finalCanvas;
	}

	getMaskData(layer) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL || !this.editor.originalCanvas) {
			return new Uint8Array(0);
		}

		const paint = this.editor.glitterManager.getPaintMask(layer.id);
		if (!paint?.hasContent) {
			return this.editor.glitterManager.createMaskForLayer(layer);
		}

		const cacheKey = this.getCacheKey(layer);
		let cached = this.cache.get(layer.id);
		if (!cached || cached.key !== cacheKey) {
			this.getMaskCanvas(layer);
			cached = this.cache.get(layer.id);
		}

		if (cached?.data) {
			return new Uint8Array(cached.data);
		}

		const canvas = cached?.canvas || this.getMaskCanvas(layer);
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		const alpha = new Uint8Array(canvas.width * canvas.height);
		for (let i = 0; i < alpha.length; i++) {
			alpha[i] = imageData[i * 4 + 3];
		}

		if (cached) {
			cached.data = new Uint8Array(alpha);
		}

		return alpha;
	}

	getCacheKey(layer, options = {}) {
		const paint = this.editor.glitterManager.getPaintMask(layer.id);
		const selectionsKey = this.editor.glitterManager.getSelectionCacheKey(layer);
		const parts = [
			selectionsKey,
			layer.settings.invert ? 1 : 0,
			layer.settings.feather,
			paint?.version || 0
		];

		if (options.draft) {
			parts.push('draft', paint?.liveRevision || 0);
		}

		return parts.join('|');
	}

	invalidate(layerId) {
		this.cache.delete(layerId);
		this.selectionCanvasCache.delete(layerId);
	}

	reset() {
		this.cache.clear();
		this.selectionCanvasCache.clear();
	}

	_getSelectionMaskCanvas(layer, width, height) {
		const key = this.editor.glitterManager.getSelectionCacheKey(layer);
		const cached = this.selectionCanvasCache.get(layer.id);
		if (cached?.key === key) {
			return cached.canvas;
		}

		const canvas = this._createCanvasFromMaskData(
			this.editor.glitterManager.createSelectionMaskForLayer(layer),
			width,
			height
		);

		this.selectionCanvasCache.set(layer.id, { key, canvas });
		return canvas;
	}

	_applyFeatherToCanvas(sourceCanvas, feather, draft) {
		if (!feather || feather <= 0 || draft) {
			return sourceCanvas;
		}

		const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
		const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
		const alpha = new Uint8Array(sourceCanvas.width * sourceCanvas.height);
		for (let i = 0; i < alpha.length; i++) {
			alpha[i] = imageData[i * 4 + 3];
		}

		this.editor.glitterManager.applyFeatherToMask(alpha, feather);
		return this._createCanvasFromMaskData(alpha, sourceCanvas.width, sourceCanvas.height);
	}

	_applyInvertIfNeeded(sourceCanvas, invert) {
		if (!invert) {
			return sourceCanvas;
		}

		const width = sourceCanvas.width;
		const height = sourceCanvas.height;
		const outputCanvas = this._cloneCanvas(sourceCanvas);
		const outputCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
		const imageData = outputCtx.getImageData(0, 0, width, height);
		const alphaChannel = this.editor.originalAlphaChannel;

		for (let i = 0; i < width * height; i++) {
			if (alphaChannel[i] >= CONFIG.tools.selection.transparency.alphaThreshold) {
				imageData.data[i * 4 + 3] = 255 - imageData.data[i * 4 + 3];
			} else {
				imageData.data[i * 4 + 3] = 0;
			}
		}

		outputCtx.putImageData(imageData, 0, 0);
		return outputCanvas;
	}

	_createCanvasFromMaskData(maskData, width, height) {
		const canvas = this._createCanvas(width, height);
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		const imageData = ctx.createImageData(width, height);

		for (let i = 0; i < width * height; i++) {
			imageData.data[i * 4 + 3] = maskData[i] || 0;
		}

		ctx.putImageData(imageData, 0, 0);
		return canvas;
	}

	_cloneCanvas(sourceCanvas) {
		const canvas = this._createCanvas(sourceCanvas.width, sourceCanvas.height);
		canvas.getContext('2d', { willReadFrequently: true }).drawImage(sourceCanvas, 0, 0);
		return canvas;
	}

	_createCanvas(width, height) {
		const canvas = createAppCanvas(0, 0, 'paint/MaskCompositor');
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
}
