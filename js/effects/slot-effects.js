'use strict';

// Shared per-slot (fill / border / shadow) effect-data helpers for
// TextGlitterManager and ShapeGlitterManager. Both store the same
// color/glitter defaults (CONFIG.tools.glitter.defaults) and the same
// glitter-vs-solid + scale/opacity model per slot; they differ only in the
// CONFIG geometry block (CONFIG.tools.text vs CONFIG.tools.shapes), a few
// shape-only keys (style, dotSpacingPx), text's fill slot deferring
// scale/opacity/colorAdjust to layer.settings, and the data root
// (layer.textData vs layer.shapeData). Each manager parameterizes these with
// an options object supplied by thin wrapper methods, so no call site changes.
// Semantics are byte-identical to the pre-extraction per-manager bodies.

// The fill slot's texture scale/opacity/colorAdjust are (for text) the
// existing layer-level settings.scale/settings.opacity, not duplicated on the
// slot; text omits them (includeTexture false) while shape carries its own.
function buildDefaultFill(options = {}) {
	const defaults = CONFIG.tools.glitter.defaults;
	const fill = {
		mode: 'glitter',
		color: defaults.fillColor
	};
	if (options.includeTexture) {
		fill.scale = 100;
		fill.opacity = 100;
		fill.colorAdjust = null;
	}
	return fill;
}

// `mode` is UI intent (which display + segmented state); the actual
// paint/export still derive from glitterId truthiness, so it is additive and
// parity-safe. Legacy data without `mode` falls back to glitterId (see
// effectUsesGlitter). config is the manager's CONFIG geometry block.
function buildDefaultBorder(options = {}) {
	const config = options.config || {};
	const defaults = CONFIG.tools.glitter.defaults;
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
	if (options.includeColorAdjust) {
		border.colorAdjust = null;
	}
	return border;
}

function buildDefaultShadow(options = {}) {
	const config = options.config || {};
	const defaults = CONFIG.tools.glitter.defaults;
	const shadow = {
		offsetX: config.defaultOffsetX ?? 6,
		offsetY: config.defaultOffsetY ?? 6,
		mode: options.defaultMode ?? 'glitter',
		glitterId: options.defaultGlitterId ?? null,
		color: defaults.shadowColor,
		scale: 100,
		opacity: 100
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
// default factory; options.mergeBorderDefaults backfills newer border keys
// onto legacy data (shape does this here; text does it in normalizeLayer).
function ensureSlotEffectData(root, slot, options = {}) {
	const { builders, mergeBorderDefaults = false } = options;
	if (!root) return null;
	if (!builders?.[slot]) return null;
	if (!root[slot]) {
		root[slot] = builders[slot]();
	} else if (slot === 'border' && mergeBorderDefaults) {
		root[slot] = { ...builders.border(), ...root[slot] };
	}
	return root[slot];
}

function getSlotEffectData(root, slot) {
	if (!root) return null;
	return root[slot] || null;
}
