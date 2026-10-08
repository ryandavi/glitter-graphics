'use strict';

// Mask surfaces for vector slot stacks (shape, path): the padded canvas a
// silhouette is rasterized into, the measurement cache that keeps the few most
// recent ones, and the preview's mask data URLs. A manager owns one of each
// cache; restoring history rebuilds layer objects, so entries are keyed by
// content, never held on a layer.

// A mask canvas covering an ink box given in layout units ({ left, top, right,
// bottom }, measured from the artwork's own origin), padded on every side by
// CONFIG.rendering.maskPaddingPx. layoutX / layoutY is where that origin lands
// in the canvas; textures register against it.
function allocatePaddedMaskCanvas(ink, label) {
	const padding = CONFIG.rendering.maskPaddingPx;
	const layoutX = padding - ink.left;
	const layoutY = padding - ink.top;
	const width = Math.max(1, Math.ceil(ink.right - ink.left + padding * 2));
	const height = Math.max(1, Math.ceil(ink.bottom - ink.top + padding * 2));
	const canvas = createAppCanvas(0, 0, label);
	canvas.width = width;
	canvas.height = height;
	canvas._textureOrigin = { x: layoutX, y: layoutY };
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.clearRect(0, 0, width, height);
	return { canvas, ctx, layoutX, layoutY, width, height };
}

// Most-recently-used entries by content key.
function createMeasurementCache(limit) {
	const entries = new Map();
	return {
		get(key) {
			const cached = entries.get(key);
			if (!cached) return null;
			entries.delete(key);
			entries.set(key, cached);
			return cached;
		},
		set(key, entry) {
			entries.set(key, entry);
			while (entries.size > limit) entries.delete(entries.keys().next().value);
			return entry;
		},
		clear() {
			entries.clear();
		}
	};
}

// PNG data URLs of preview masks by cache key, bounded so a long editing
// session cannot grow it forever.
function createMaskUrlCache(limit) {
	const urls = new Map();
	return {
		get(canvas, key) {
			if (urls.has(key)) return urls.get(key);
			const url = canvas.toDataURL('image/png');
			urls.set(key, url);
			if (urls.size > limit) urls.delete(urls.keys().next().value);
			return url;
		},
		clear() {
			urls.clear();
		}
	};
}
