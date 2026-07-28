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
	const coordinates = CONFIG.rendering.textureCoordinates;
	const fill = {
		mode: 'glitter',
		color: defaults.fillColor,
		textureAnchor: coordinates.defaultAnchor,
		textureOffsetX: coordinates.defaultOffsetX,
		textureOffsetY: coordinates.defaultOffsetY
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

function bindSlotTextureCoordinateControls(options) {
	const { prefix, getLayer, getData, render, save } = options;
	const defaults = CONFIG.rendering.textureCoordinates;
	const getActive = () => {
		const layer = getLayer();
		return layer ? { layer, data: normalizeSlotTextureCoordinates(getData(layer)) } : null;
	};
	const setAnchor = (anchor) => {
		const active = getActive();
		if (!active) return;
		active.data.textureAnchor = anchor;
		syncSlotTextureCoordinateControls(prefix, active.data);
		render(active.layer);
		save();
	};
	document.getElementById(`${prefix}TextureAnchorArtwork`)?.addEventListener('click', () => setAnchor('artwork'));
	document.getElementById(`${prefix}TextureAnchorCanvas`)?.addEventListener('click', () => setAnchor('canvas'));

	[['X', 'textureOffsetX'], ['Y', 'textureOffsetY']].forEach(([axis, key]) => {
		const slider = document.getElementById(`${prefix}TextureOffset${axis}`);
		const value = document.getElementById(`${prefix}TextureOffset${axis}Value`);
		if (!slider) return;
		bindSlider(slider, value, {
			suffix: 'px',
			resetValue: axis === 'X' ? defaults.defaultOffsetX : defaults.defaultOffsetY,
			resetButton: document.getElementById(`reset${prefix.charAt(0).toUpperCase() + prefix.slice(1)}TextureOffset${axis}`),
			apply: (next) => {
				const active = getActive();
				if (!active) return;
				active.data[key] = next;
				render(active.layer);
			},
			onCommit: save
		});
	});

	document.getElementById(`${prefix}ResetTexturePosition`)?.addEventListener('click', () => {
		const active = getActive();
		if (!active) return;
		active.data.textureAnchor = defaults.defaultAnchor;
		active.data.textureOffsetX = defaults.defaultOffsetX;
		active.data.textureOffsetY = defaults.defaultOffsetY;
		syncSlotTextureCoordinateControls(prefix, active.data);
		render(active.layer);
		save();
	});
}

function syncSlotTextureCoordinateControls(prefix, data) {
	const normalized = normalizeSlotTextureCoordinates(data);
	if (!normalized) return;
	['artwork', 'canvas'].forEach((anchor) => {
		const button = document.getElementById(`${prefix}TextureAnchor${anchor.charAt(0).toUpperCase() + anchor.slice(1)}`);
		const active = normalized.textureAnchor === anchor;
		button?.classList.toggle('active', active);
		button?.setAttribute('aria-pressed', String(active));
	});
	[['X', normalized.textureOffsetX], ['Y', normalized.textureOffsetY]].forEach(([axis, value]) => {
		const slider = document.getElementById(`${prefix}TextureOffset${axis}`);
		const valueEl = document.getElementById(`${prefix}TextureOffset${axis}Value`);
		if (slider) slider.value = value;
		if (valueEl) valueEl.innerHTML = formatUnit(value, 'px');
	});
}
