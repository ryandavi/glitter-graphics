'use strict';

// Shared per-slot (fill / border / shadow) effect-data helpers. Every slot
// stores the same color/glitter defaults (CONFIG.tools.glitter.defaults) and
// the same source + scale/opacity model. Numeric defaults come from the field
// specs the slot declares (options.slot, see js/paint/paint-slots.js); the
// CONFIG block (options.config) supplies the per-type option defaults.

function buildDefaultFill(options = {}) {
	const defaults = CONFIG.tools.glitter.defaults;
	const coordinates = CONFIG.rendering.textureCoordinates;
	const imageFill = CONFIG.tools.shapes.imageFill;
	const fill = {
		mode: 'glitter',
		color: defaults.fillColor,
		opacity: FIELDS.slotOpacity.value,
		imageRef: null,
		fit: imageFill.defaultFit,
		imageScalePercent: FIELDS.shapeImageScale.value,
		offsetXPercent: FIELDS.shapeImageOffsetX.value,
		offsetYPercent: FIELDS.shapeImageOffsetY.value,
		tile: imageFill.defaultTile,
		imageRendering: imageFill.defaultRendering,
		textureAnchor: coordinates.defaultAnchor,
		textureOffsetX: coordinates.defaultOffsetX,
		textureOffsetY: coordinates.defaultOffsetY,
		glitterId: options.defaultGlitterId ?? null,
		scale: FIELDS.textureScale.value,
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
		widthPx: getPaintSlotFieldDefault(options.slot, 'widthPx', 4)
	};
	if (options.includeShapeStyle) {
		border.style = config.defaultStyle ?? 'solid';
		border.dotSpacingPx = getPaintSlotFieldDefault(options.slot, 'dotSpacingPx', 10);
	}
	border.placement = config.defaultPlacement ?? 'outside';
	border.edgeStyle = config.defaultEdgeStyle ?? 'round';
	border.drawOrder = config.defaultDrawOrder ?? 'behind';
	border.mode = config.defaultSource ?? options.fallbackMode ?? 'glitter';
	border.glitterId = options.defaultGlitterId ?? null;
	border.color = defaults.borderColor;
	border.scale = FIELDS.textureScale.value;
	border.opacity = FIELDS.slotOpacity.value;
	border.textureAnchor = coordinates.defaultAnchor;
	border.textureOffsetX = coordinates.defaultOffsetX;
	border.textureOffsetY = coordinates.defaultOffsetY;
	if (options.includeColorAdjust) {
		border.colorAdjust = null;
	}
	return border;
}

function buildDefaultShadow(options = {}) {
	const defaults = CONFIG.tools.glitter.defaults;
	const coordinates = CONFIG.rendering.textureCoordinates;
	const shadow = {
		offsetX: FIELDS.shadowOffsetX.value,
		offsetY: FIELDS.shadowOffsetY.value,
		mode: options.defaultMode ?? 'glitter',
		glitterId: options.defaultGlitterId ?? null,
		color: defaults.shadowColor,
		scale: FIELDS.textureScale.value,
		opacity: FIELDS.slotOpacity.value,
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

// Switch an optional effect slot on or off, remembering its settings while
// off: switching off parks the slot at its draftPath, switching on restores
// the parked copy or builds a default. Slots gated by an enabledPath (text
// background) keep their data and flip the flag instead.
function toggleSlotEffect(layer, definition, enabled, buildDefault) {
	if (definition.enabledKeys) {
		writeFieldPath(layer, definition.enabledKeys, Boolean(enabled));
		return;
	}
	const current = readFieldPath(layer, definition.pathKeys);
	const draft = definition.draftKeys ? readFieldPath(layer, definition.draftKeys) : null;
	const draftHost = definition.draftKeys ? definition.draftKeys.slice(0, -1) : null;
	if (draftHost && !readFieldPath(layer, draftHost)) writeFieldPath(layer, draftHost, {});
	if (enabled) {
		writeFieldPath(layer, definition.pathKeys, draft || current || buildDefault());
		if (draftHost) delete readFieldPath(layer, draftHost)[definition.draftKeys.at(-1)];
	} else {
		if (current && draftHost) writeFieldPath(layer, definition.draftKeys, current);
		writeFieldPath(layer, definition.pathKeys, null);
	}
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
