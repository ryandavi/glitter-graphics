'use strict';

const CANVAS_BOUNDS_SOURCES = Object.freeze([
	{ id: 'custom', label: 'Custom', historyLabel: 'Resize canvas', rect: (_editor, { rect }) => rect },
	{ id: 'artwork', label: 'Artwork', historyLabel: 'Fit canvas to artwork', rect: (editor, options) => fittedCanvasRect(editor.getArtworkBounds(), options.padding) },
	{ id: 'selection', label: 'Selection', historyLabel: 'Fit canvas to selection', rect: (editor, options) => fittedCanvasRect(editor.getArtworkBounds(editor.layerManager.getSelectedLayers()), options.padding) }
].map(Object.freeze));

function fittedCanvasRect(bounds, padding) {
	if (!bounds) return null;
	return { x: bounds.minX - padding, y: bounds.minY - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 };
}

// Pending bounds are document coordinates, independent of any input or chrome.
class CanvasBounds {
	constructor(editor, sync = () => {}) {
		this.editor = editor;
		this.sync = sync;
		Object.assign(this, this.defaults());
	}

	defaults() {
		const editor = this.editor;
		const color = editor.baseImageSource?.preset?.color || editor.layers?.find((layer) => layer.background)?.background.color;
		return {
			rect: { x: 0, y: 0, width: editor.originalCanvas.width, height: editor.originalCanvas.height },
			source: 'custom', padding: 0, ratio: null,
			extension: { mode: editor.baseImageSource?.kind === 'preset' && color !== 'transparent' ? 'color' : 'transparent', color: color && color !== 'transparent' ? color : CONFIG.canvas.defaults.blankDocument.color }
		};
	}

	setRect(rect) {
		this.rect = Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value)]));
		this.source = 'custom';
		this.sync();
	}

	setSize(width, height, anchor = { fx: 0.5, fy: 0.5 }) {
		width = Math.round(width); height = Math.round(height);
		this.setRect({ x: this.rect.x + (this.rect.width - width) * anchor.fx, y: this.rect.y + (this.rect.height - height) * anchor.fy, width, height });
	}

	refreshSource() {
		const entry = CANVAS_BOUNDS_SOURCES.find((entry) => entry.id === this.source);
		const rect = entry.rect(this.editor, this);
		this.sourceAvailable = Boolean(rect);
		if (rect) this.rect = { ...rect };
	}

	setSource(source) {
		if (!CANVAS_BOUNDS_SOURCES.some((entry) => entry.id === source)) return;
		this.source = source;
		if (source !== 'custom') this.ratio = null;
		this.refreshSource();
		this.sync();
	}

	setPadding(value) { this.padding = Math.max(0, Math.round(value) || 0); this.refreshSource(); this.sync(); }
	setRatio(ratio) {
		this.ratio = ratio && ratio.w > 0 && ratio.h > 0 ? { ...ratio } : null;
		if (this.ratio) this.setSize(this.rect.width, this.rect.width * this.ratio.h / this.ratio.w);
		else this.sync();
	}
	swapOrientation() {
		if (this.ratio) this.ratio = { w: this.ratio.h, h: this.ratio.w };
		this.setSize(this.rect.height, this.rect.width);
	}
	setExtension(extension) { this.extension = { ...this.extension, ...extension }; this.sync(); }
	validate() {
		this.refreshSource();
		return this.sourceAvailable ? validateCanvasSize(this.rect.width, this.rect.height) : { ok: false, message: 'There is no artwork to fit.' };
	}
	apply() {
		const result = this.validate();
		if (!result.ok) return result;
		const { x, y, width, height } = this.rect;
		const source = CANVAS_BOUNDS_SOURCES.find((entry) => entry.id === this.source);
		this.editor.resizeCanvas(width, height, -x, -y, { extensionColor: this.extension.mode === 'color' ? this.extension.color : null, historyLabel: this.editor.getActiveSession?.() === 'crop' ? 'Crop canvas' : source.historyLabel });
		this.clear();
		return result;
	}
	clear() { this.editor.documentSize.bounds = null; this.sync(); }
}

function getCanvasRatioOptions(editor) {
	const gcd = (a, b) => b ? gcd(b, a % b) : a;
	const ratios = new Map();
	CONFIG.canvas.presets.forEach(({ width, height }) => {
		const divisor = gcd(width, height), w = width / divisor, h = height / divisor;
		ratios.set(`${w}:${h}`, { id: `ratio:${w}:${h}`, label: `${w}:${h}`, ratio: { w, h } });
	});
	const locked = editor.canvasBounds?.ratio;
	if (locked) {
		const divisor = gcd(locked.w, locked.h), w = locked.w / divisor, h = locked.h / divisor;
		if (!ratios.has(`${w}:${h}`)) ratios.set(`${w}:${h}`, { id: `ratio:${w}:${h}`, label: `${w}:${h}`, ratio: { w, h } });
	}
	return [
		{ id: 'free', label: 'Free', ratio: null },
		{ id: 'original', label: 'Original', ratio: { w: editor.originalCanvas.width, h: editor.originalCanvas.height } },
		...ratios.values(),
		...CONFIG.canvas.presets.map((preset) => ({ id: `size:${preset.id}`, label: `${preset.label} (${preset.width} × ${preset.height})`, width: preset.width, height: preset.height }))
	];
}

if (typeof module !== 'undefined' && module.exports) module.exports = { CanvasBounds, CANVAS_BOUNDS_SOURCES, fittedCanvasRect };
