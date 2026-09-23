'use strict';

// Shared per-slot (fill / border / shadow) effect-data helpers for
// TextGlitterManager and ShapeGlitterManager. Both store the same
// color/glitter defaults (CONFIG.tools.glitter.defaults) and the same
// glitter-vs-solid + scale/opacity model per slot; they differ only in the
// CONFIG geometry block (CONFIG.tools.text vs CONFIG.tools.shapes), a few
// shape-only keys (style, dotSpacingPx), and the data root
// (layer.textData vs layer.shapeData). Each manager parameterizes these with
// an options object supplied by thin wrapper methods.

// The paint slot that fills a layer's own artwork. Every slot is one
// self-contained object: mode, color, gradient, glitterId, scale, colorAdjust,
// opacity and texture registration. Glitter fill and canvas background layers
// are a single paint, so their whole-layer opacity is their only fade and the
// slot opacity is not read for them.
function getLayerFillSlot(layer) {
	switch (layer?.type) {
		case LayerType.GLITTER_FILL: return layer.fill || null;
		case LayerType.TEXT_GLITTER: return layer.textData?.fill || null;
		case LayerType.SHAPE: return layer.shapeData?.fill || null;
		case LayerType.BASE_IMAGE: return layer.background || null;
		default: return null;
	}
}

function getLayerFillGlitterId(layer) {
	return getLayerFillSlot(layer)?.glitterId ?? null;
}

function buildDefaultFill(options = {}) {
	const defaults = CONFIG.tools.glitter.defaults;
	const coordinates = CONFIG.rendering.textureCoordinates;
	const imageFill = CONFIG.tools.shapes.imageFill;
	const fill = {
		mode: 'glitter',
		color: defaults.fillColor,
		opacity: 100,
		imageRef: null,
		fit: imageFill.defaultFit,
		imageScalePercent: imageFill.defaultScalePercent,
		offsetXPercent: imageFill.defaultOffsetXPercent,
		offsetYPercent: imageFill.defaultOffsetYPercent,
		tile: imageFill.defaultTile,
		imageRendering: imageFill.defaultRendering,
		textureAnchor: coordinates.defaultAnchor,
		textureOffsetX: coordinates.defaultOffsetX,
		textureOffsetY: coordinates.defaultOffsetY,
		glitterId: options.defaultGlitterId ?? null,
		scale: CONFIG.tools.effects.defaults.scale,
		colorAdjust: null
	};
	return fill;
}

// `mode` is UI intent (which display + segmented state); the actual
// paint/export still derive from glitterId truthiness, so it is additive and
// parity-safe. Legacy data without `mode` falls back to glitterId (see
// effectUsesGlitter). config is the manager's CONFIG geometry block.
function buildDefaultBorder(options = {}) {
	const config = options.config || {};
	const defaults = CONFIG.tools.glitter.defaults;
	const coordinates = CONFIG.rendering.textureCoordinates;
	const border = {
		widthPx: config.defaultWidthPx ?? options.fallbackWidthPx ?? 4
	};
	if (options.includeShapeStyle) {
		border.style = config.defaultStyle ?? 'solid';
		border.dotSpacingPx = config.defaultDotSpacingPx ?? 10;
	}
	border.placement = config.defaultPlacement ?? 'outside';
	border.edgeStyle = config.defaultEdgeStyle ?? 'round';
	border.drawOrder = config.defaultDrawOrder ?? 'behind';
	border.mode = config.defaultSource ?? options.fallbackMode ?? 'glitter';
	border.glitterId = options.defaultGlitterId ?? null;
	border.color = defaults.borderColor;
	border.scale = 100;
	border.opacity = 100;
	border.textureAnchor = coordinates.defaultAnchor;
	border.textureOffsetX = coordinates.defaultOffsetX;
	border.textureOffsetY = coordinates.defaultOffsetY;
	if (options.includeColorAdjust) {
		border.colorAdjust = null;
	}
	return border;
}

function buildDefaultShadow(options = {}) {
	const config = options.config || {};
	const defaults = CONFIG.tools.glitter.defaults;
	const coordinates = CONFIG.rendering.textureCoordinates;
	const shadow = {
		offsetX: config.defaultOffsetX ?? 6,
		offsetY: config.defaultOffsetY ?? 6,
		mode: options.defaultMode ?? 'glitter',
		glitterId: options.defaultGlitterId ?? null,
		color: defaults.shadowColor,
		scale: 100,
		opacity: 100,
		textureAnchor: coordinates.defaultAnchor,
		textureOffsetX: coordinates.defaultOffsetX,
		textureOffsetY: coordinates.defaultOffsetY
	};
	if (options.includeColorAdjust) {
		shadow.colorAdjust = null;
	}
	return shadow;
}

// Lazily created as identity so untouched slots stay export-byte-identical.
function ensureSlotColorAdjust(target) {
	if (!target.colorAdjust) {
		target.colorAdjust = { ...COLOR_ADJUST_IDENTITY };
	}
	return target.colorAdjust;
}

// root is layer.textData or layer.shapeData. options.builders maps slot ->
// default factory for a slot that is switched on. Existing slots are already
// canonical: legacy keys are backfilled where the layer enters the document.
function ensureSlotEffectData(root, slot, options = {}) {
	const { builders } = options;
	if (!root) return null;
	if (!builders?.[slot]) return null;
	root[slot] ||= builders[slot]();
	return root[slot];
}

function getSlotEffectData(root, slot) {
	if (!root) return null;
	return root[slot] || null;
}

function mergeSlotEffectDefaults(target, defaults) {
	if (!target) return { ...defaults };
	return Object.assign(target, { ...defaults, ...target });
}

function normalizeSlotTextureCoordinates(target) {
	if (!target) return null;
	const defaults = CONFIG.rendering.textureCoordinates;
	target.textureAnchor = target.textureAnchor === 'canvas' ? 'canvas' : defaults.defaultAnchor;
	target.textureOffsetX = Number.isFinite(Number(target.textureOffsetX))
		? Number(target.textureOffsetX)
		: defaults.defaultOffsetX;
	target.textureOffsetY = Number.isFinite(Number(target.textureOffsetY))
		? Number(target.textureOffsetY)
		: defaults.defaultOffsetY;
	if (Number.isFinite(Number(target.scale))) {
		target.scale = roundSlotTextureScale(target.scale);
	}
	return target;
}

function roundSlotTextureScale(value) {
	const precision = CONFIG.rendering.textureCoordinates.scalePrecision;
	const factor = 10 ** precision;
	return Math.round(Number(value) * factor) / factor;
}

// Convert a document-space texture registration point into the local mask
// surface. Artwork anchoring deliberately uses the unpadded artwork origin;
// Canvas anchoring uses the inverse layer transform so separate objects share
// the same repeat phase.
function getSlotTexturePatternOrigin(maskCanvas, source, layer, options = {}) {
	const defaults = CONFIG.rendering.textureCoordinates;
	const anchor = source?.textureAnchor === 'canvas' ? 'canvas' : defaults.defaultAnchor;
	const offsetX = Number(source?.textureOffsetX) || 0;
	const offsetY = Number(source?.textureOffsetY) || 0;
	if (anchor !== 'canvas' || !layer) {
		const artwork = maskCanvas?._textureOrigin || { x: 0, y: 0 };
		return {
			x: artwork.x + offsetX,
			y: artwork.y + offsetY
		};
	}

	const transform = getLayerTransform(layer);
	const rotation = -(Number(transform.rotation) || 0) * Math.PI / 180;
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	const dx = offsetX - (Number(transform.position?.x) || 0);
	const dy = offsetY - (Number(transform.position?.y) || 0);
	const rotatedX = dx * cos - dy * sin;
	const rotatedY = dx * sin + dy * cos;
	const scaleX = Math.max(0.01, Math.abs((Number(transform.scale?.x) || 100) / 100)) * (transform.flipX ? -1 : 1);
	const scaleY = Math.max(0.01, Math.abs((Number(transform.scale?.y) || 100) / 100)) * (transform.flipY ? -1 : 1);

	return {
		x: rotatedX / scaleX + (maskCanvas?.width || 0) / 2 - (Number(options.localOffsetX) || 0),
		y: rotatedY / scaleY + (maskCanvas?.height || 0) / 2 - (Number(options.localOffsetY) || 0)
	};
}
