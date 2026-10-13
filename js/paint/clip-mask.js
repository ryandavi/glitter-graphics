'use strict';

function getClipBase(layers, layer, { requireClipped = true } = {}) {
	if (!layer || (requireClipped && !layer.clipped) || layer.isPreview || !LAYER_UI_CONFIG[layer.type]?.clippable) return null;
	const ownIndex = layers.indexOf(layer);
	for (let index = (ownIndex < 0 ? layers.findIndex(candidate => candidate.id === layer.id) : ownIndex) - 1; index >= 0; index--) {
		const candidate = layers[index];
		if (candidate.isPreview) continue;
		if (candidate.clipped) continue;
		return LAYER_UI_CONFIG[candidate.type]?.clipBase ? candidate : null;
	}
	return null;
}

function getClippedLayers(layers, base) {
	return layers.filter(layer => getClipBase(layers, layer) === base);
}

function isClipBodyEntry(entry) {
	return entry.role !== 'shadow' && entry.role !== 'sparkles';
}

function getClipInsertion(layers, layer, index) {
	const above = layers[index];
	const base = above && getClipBase(layers, above);
	if (!base) return { index, clipped: Boolean(layer.clipped) };
	if (LAYER_UI_CONFIG[layer.type]?.clippable) return { index, clipped: true };
	while (index < layers.length && getClipBase(layers, layers[index]) === base) index++;
	return { index, clipped: Boolean(layer.clipped) };
}

function getClipRestPoints(editor, base, x, y) {
	const animations = editor.timelineKeyRecording?.previewAnimations(base) || base.animations;
	const sample = GlitterAnimation.sampleAt(GlitterAnimation.normalizeAnimations(animations), editor.animationTicker.getCurrentTime(), getLayerAnimationSamplingContext(editor, base));
	if (sample.opacity <= 0 || base.opacity <= 0) return [];
	const frame = getLayerFrame(editor, base);
	if (!frame) return [];
	const metrics = computeLayerTransform(getLayerTransform(base), frame);
	const cos = Math.cos(metrics.rotationRad), sin = Math.sin(metrics.rotationRad);
	const { a, b, c, d } = sample.matrix;
	const determinant = a * d - b * c;
	if (Math.abs(determinant) < 1e-8) return [];
	const ox = (sample.originX - 0.5) * frame.width, oy = (sample.originY - 0.5) * frame.height;
	return (sample.copies || [{ x: 0, y: 0 }]).map(copy => {
		const dx = x - copy.x - sample.tx - metrics.centerX, dy = y - copy.y - sample.ty - metrics.centerY;
		const lx = (dx * cos + dy * sin) / metrics.signedScaleX - ox;
		const ly = (-dx * sin + dy * cos) / metrics.signedScaleY - oy;
		const px = ((d * lx - c * ly) / determinant + ox) * metrics.signedScaleX;
		const py = ((-b * lx + a * ly) / determinant + oy) * metrics.signedScaleY;
		return { x: metrics.centerX + px * cos - py * sin, y: metrics.centerY + px * sin + py * cos };
	});
}

function getClipMovedPoint(editor, base, sample, x, y) {
	const frame = getLayerFrame(editor, base);
	const metrics = computeLayerTransform(getLayerTransform(base), frame);
	const cos = Math.cos(metrics.rotationRad), sin = Math.sin(metrics.rotationRad);
	const dx = x - metrics.centerX, dy = y - metrics.centerY;
	const ox = (sample.originX - 0.5) * frame.width, oy = (sample.originY - 0.5) * frame.height;
	const lx = (dx * cos + dy * sin) / metrics.signedScaleX - ox;
	const ly = (-dx * sin + dy * cos) / metrics.signedScaleY - oy;
	const px = (sample.matrix.a * lx + sample.matrix.c * ly + ox) * metrics.signedScaleX;
	const py = (sample.matrix.b * lx + sample.matrix.d * ly + oy) * metrics.signedScaleY;
	return { x: metrics.centerX + px * cos - py * sin + sample.tx, y: metrics.centerY + px * sin + py * cos + sample.ty };
}

// The preview turns its mask with the base element, so the base's edge and the
// clip's edge come from one rasterizer. This is the box of the base's
// unrotated space that covers the document once the rotation is applied
// again, or null when the document itself is that space. An odd-sized base
// centered on a whole pixel sits half a pixel off the document grid, so the
// box is rendered at twice the document's density to hold its edge exactly.
const CLIP_PREVIEW_DENSITY = 2;

function getClipPreviewSpace(editor, base) {
	const frame = getLayerFrame(editor, base);
	const metrics = frame && computeLayerTransform(getLayerTransform(base), frame);
	if (!metrics?.rotationRad) return null;
	const { width, height } = editor.originalCanvas;
	const { centerX, centerY, rotationRad } = metrics;
	const cos = Math.cos(rotationRad), sin = Math.sin(rotationRad);
	const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => ({
		x: centerX + (x - centerX) * cos + (y - centerY) * sin,
		y: centerY - (x - centerX) * sin + (y - centerY) * cos
	}));
	const x = Math.floor(Math.min(...corners.map(point => point.x))), y = Math.floor(Math.min(...corners.map(point => point.y)));
	return { x, y, width: Math.ceil(Math.max(...corners.map(point => point.x))) - x, height: Math.ceil(Math.max(...corners.map(point => point.y))) - y, centerX, centerY, rotationRad, density: CLIP_PREVIEW_DENSITY };
}

function getClipContentKey(editor, base) {
	const serialized = editor.layerManager.serializeLayer(base);
	delete serialized.animations;
	delete serialized.opacity;
	delete serialized.visible;
	delete serialized.blendMode;
	delete serialized.locked;
	delete serialized.name;
	const paint = editor.paintMaskStore?.paintMasks?.get(base.id);
	return `${editor.originalCanvas.width}x${editor.originalCanvas.height}|${shouldUseCrispMaskEdges()}|${paint?.liveRevision || 0}|${JSON.stringify(serialized)}`;
}

class ClipBodyCache {
	constructor(editor) {
		this.editor = editor;
		this.cache = new ByteBudgetCache({ id: 'clip-bodies', label: 'Clipping bodies', measure: canvasBytes });
		this.pending = new Map();
		// Content over a half-covered base pixel lets the base's own color
		// through (coverage times its remainder). Counting soft coverage
		// several times over closes that ring; whole and empty pixels keep
		// their value.
		this.coverage = Uint8ClampedArray.from({ length: 256 }, (_, alpha) => Math.round(255 * (1 - (1 - alpha / 255) ** CONFIG.rendering.clipSoftEdgeGain)));
		this.compositor = new SceneCompositor({ editor, resolveImageFill: reference => editor.imageFills.get(reference) });
	}

	peek(base) { return this.cache.get(getClipContentKey(this.editor, base)); }

	// `space` (getClipPreviewSpace) renders the body unrotated into that box
	// instead of at rest in the document.
	async get(base, { prepared = null, space = null } = {}) {
		const key = `${getClipContentKey(this.editor, base)}${space ? '|unrotated' : ''}`;
		const cached = this.cache.get(key);
		if (cached) return cached;
		if (this.pending.has(key)) return this.pending.get(key);
		const build = async () => {
			const inPrepared = prepared?.context.layerPlans.some(entry => entry.layer.id === base.id);
			const compositor = inPrepared ? prepared.compositor : this.compositor;
			const context = inPrepared ? prepared.context : await compositor.prepareContext(this.editor.getSceneSnapshotParams([base]));
			const plan = context.layerPlans.find(entry => entry.layer.id === base.id)?.plan;
			if (!plan?.renderBody) throw new Error(`Clip base ${base.type} has no renderBody export plan`);
			const { width, height } = context.canvasData;
			const canvas = space ? createAppCanvas(space.width * space.density, space.height * space.density, 'paint/clip-body') : createAppCanvas(width, height, 'paint/clip-body');
			const ctx = canvas.getContext('2d');
			if (space) {
				ctx.scale(space.density, space.density);
				ctx.translate(space.centerX - space.x, space.centerY - space.y);
				ctx.rotate(-space.rotationRad);
				ctx.translate(-space.centerX, -space.centerY);
			}
			await plan.renderBody({ ctx, width, height, frameIndex: 0, timestamp: 0, slotMaskCanvases: context.masks.slot, maskCanvases: context.masks.glitter });
			const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const pixels = image.data;
			const bounds = { left: canvas.width, top: canvas.height, right: 0, bottom: 0 };
			let soft = false;
			for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
				const index = (y * canvas.width + x) * 4 + 3;
				if (!pixels[index]) continue;
				if (pixels[index] < 255) { pixels[index] = this.coverage[pixels[index]]; soft = true; }
				bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y);
				bounds.right = Math.max(bounds.right, x + 1); bounds.bottom = Math.max(bounds.bottom, y + 1);
			}
			if (soft) ctx.putImageData(image, 0, 0);
			canvas._clipBounds = bounds;
			this.cache.set(key, canvas);
			return canvas;
		};
		const pending = build().finally(() => this.pending.delete(key));
		this.pending.set(key, pending);
		return pending;
	}

	clear() { this.cache.clear(); this.compositor.releaseDecodedSources(); }
}
