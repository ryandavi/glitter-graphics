class MaskCompositor {
	constructor(editor) {
		this.editor = editor;
		// All three rebuild on demand, so they live in the shared preview budget.
		this.cache = new ByteBudgetCache({
			id: 'fill-mask-cache',
			label: 'Fill mask cache',
			measure: (entry) => (entry?.data?.byteLength || 0) + canvasBytes(entry?.canvas)
		});
		// Per layer id, keyed by the selection inputs; cleared by invalidate/reset
		// (canvas resize, paint reset), so they survive undo of unrelated edits.
		this.selectionMaskCache = new ByteBudgetCache({
			id: 'selection-mask-cache',
			label: 'Color selection masks',
			measure: (entry) => entry?.mask?.byteLength || 0
		});
		this.selectionCanvasCache = new ByteBudgetCache({
			id: 'selection-canvas-cache',
			label: 'Color selection mask canvases',
			measure: (entry) => canvasBytes(entry?.canvas)
		});
	}

	// One mask pipeline for every fill layer, painted or not: color selection,
	// plus painted additions, minus painted erasures; then invert; then feather.
	// Draft masks (live brushing) skip the feather and the cache.
	getMaskCanvas(layer, options = {}) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL || !this.editor.originalCanvas) {
			return this._createCanvas(1, 1);
		}

		const { draft = false } = options;
		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		if (draft) {
			return this._createCanvasFromMaskData(this._buildMask(layer, { draft }), width, height);
		}
		const entry = this._getCacheEntry(layer);
		entry.canvas ||= this._createCanvasFromMaskData(entry.data, width, height);
		return entry.canvas;
	}

	getMaskData(layer) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL || !this.editor.originalCanvas) {
			return new Uint8Array(0);
		}
		return new Uint8Array(this._getCacheEntry(layer).data);
	}

	// The key covers every input of _buildMask, so edits never need to
	// invalidate by hand. A draft key also changes with every live stroke.
	getCacheKey(layer, { draft = false } = {}) {
		const paint = this.editor.paintMaskStore.getPaintMask(layer.id);
		const parts = [
			this.editor.originalCanvas.width,
			this.editor.originalCanvas.height,
			this.editor.glitterManager.getSelectionCacheKey(layer),
			layer.settings.invert ? 1 : 0,
			layer.settings.feather,
			paint?.hasContent ? paint.version : 0
		];
		if (draft) parts.push('draft', paint?.liveRevision || 0);
		return parts.join('|');
	}

	_getCacheEntry(layer) {
		const key = this.getCacheKey(layer);
		let entry = this.cache.get(layer.id);
		if (entry?.key !== key) {
			entry = { key, data: this._buildMask(layer), canvas: null };
			this.cache.set(layer.id, entry);
		}
		return entry;
	}

	_buildMask(layer, { draft = false } = {}) {
		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const paint = this.editor.paintMaskStore.getPaintMask(layer.id);
		const mask = paint?.hasContent
			? this._composePaintedMask(layer, paint, width, height)
			: this._getSelectionMask(layer);

		// Inverting selects every opaque pixel outside the mask; transparent
		// pixels are never part of an inverted mask.
		if (layer.settings.invert) {
			const alphaChannel = this.editor.originalAlphaChannel;
			const alphaThreshold = CONFIG.tools.selection.transparency.alphaThreshold;
			for (let i = 0; i < mask.length; i++) {
				mask[i] = alphaChannel[i] >= alphaThreshold ? 255 - mask[i] : 0;
			}
		}
		if (!draft && layer.settings.feather > 0) {
			this.editor.glitterManager.applyFeatherToMask(mask, layer.settings.feather);
		}
		return mask;
	}

	_composePaintedMask(layer, paint, width, height) {
		const compositeCanvas = this._createCanvas(width, height);
		const compositeCtx = compositeCanvas.getContext('2d', { willReadFrequently: true });
		compositeCtx.drawImage(this._getSelectionMaskCanvas(layer, width, height), 0, 0);
		compositeCtx.drawImage(paint.add, 0, 0);
		compositeCtx.globalCompositeOperation = 'destination-out';
		compositeCtx.drawImage(paint.sub, 0, 0);
		const pixels = compositeCtx.getImageData(0, 0, width, height).data;
		const mask = new Uint8Array(width * height);
		for (let i = 0; i < mask.length; i++) {
			mask[i] = pixels[i * 4 + 3];
		}
		return mask;
	}

	invalidate(layerId) {
		this.cache.delete(layerId);
		this.selectionMaskCache.delete(layerId);
		this.selectionCanvasCache.delete(layerId);
	}

	reset() {
		this.cache.clear();
		this.selectionMaskCache.clear();
		this.selectionCanvasCache.clear();
	}

	// A copy, since callers combine it with paint in place.
	_getSelectionMask(layer) {
		const key = this.editor.glitterManager.getSelectionCacheKey(layer);
		let cached = this.selectionMaskCache.get(layer.id);
		if (cached?.key !== key) {
			cached = { key, mask: this.editor.glitterManager.buildSelectionMask(layer) };
			this.selectionMaskCache.set(layer.id, cached);
		}
		return new Uint8Array(cached.mask);
	}

	_getSelectionMaskCanvas(layer, width, height) {
		const key = this.editor.glitterManager.getSelectionCacheKey(layer);
		const cached = this.selectionCanvasCache.get(layer.id);
		if (cached?.key === key) {
			return cached.canvas;
		}

		const canvas = this._createCanvasFromMaskData(
			this._getSelectionMask(layer),
			width,
			height
		);

		this.selectionCanvasCache.set(layer.id, { key, canvas });
		return canvas;
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

	_createCanvas(width, height) {
		const canvas = createAppCanvas(0, 0, 'paint/MaskCompositor');
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
}
