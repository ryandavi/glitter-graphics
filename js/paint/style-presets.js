'use strict';

// Style presets: one-click looks for text, shapes and stickers. A preset is
// a partial paint-slot bundle keyed by slot key, plus optional plain layer
// values (`data`, keyed by field path). Applying copies the values into the
// layer (presets are never referenced), so projects never depend on a preset
// id and editing any control afterwards just changes those values.
//
// A style owns the fill, border, shadow and bevel slots:
//   - a slot the preset names is switched on and reset to its defaults plus
//     the preset's values, so nothing from the previous look leaks through;
//   - an effect slot the preset leaves out is switched off (its settings are
//     parked like the panel toggle parks them);
//   - the fill, when left out, is kept.
// Sparkles and the text background are never touched.
//
// Glitter slots also name a `color`: it's the thumbnail's stand-in for the
// glitter, and the look if the user later switches the slot to Color. A
// glitter missing from the library falls back to the slot's glitterDefault.

const STYLE_PRESET_ROLES = Object.freeze(['fill', 'border', 'shadow', 'bevel']);

const STYLE_PRESET_TARGETS = Object.freeze({
	text: LayerType.TEXT_GLITTER,
	shape: LayerType.SHAPE,
	sticker: LayerType.STICKER
});

const STYLE_PRESET_GROUPS = Object.freeze([
	Object.freeze({ id: 'classic', label: 'Classic' }),
	Object.freeze({ id: 'shiny', label: 'Shiny' })
]);

const STYLE_PRESET_ENTRIES = (() => {
	const glitter = (glitterId, color, extra = {}) => ({ mode: 'glitter', glitterId, color, ...extra });
	const solid = (color, extra = {}) => ({ mode: 'solid', color, ...extra });
	const gradient = (presetId, extra = {}) => ({
		mode: 'gradient',
		gradient: normalizeEffectGradient({ ...CONFIG.rendering.gradient, ...GRADIENT_PRESETS.get(presetId).value, ...extra })
	});
	const all = ['text', 'shape', 'sticker'];
	// A shadow shows only where it reaches past the outline: |offset| +
	// spread + blur must beat the outline width (the unit test holds every
	// look to it).
	return [
		{
			id: 'default', label: 'Default', group: 'classic', targets: ['text'], tags: ['reset'],
			value: {
				resetFill: true,
				slots: { fill: buildDefaultFill({ defaultGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId.text }) },
				data: { 'textData.fontId': CONFIG.tools.text.defaultFontId, 'textData.textCase': CONFIG.tools.text.defaultTextCase }
			}
		},
		{ id: 'plain', label: 'Plain', group: 'classic', targets: ['shape', 'sticker'], tags: ['none', 'reset'], value: { slots: {} } },
		{
			id: 'blingee-pink', label: 'Blingee Pink', group: 'classic', targets: all,
			value: { slots: {
				fill: glitter(89, '#ff4fa3'),
				border: glitter(20, '#ffffff', { widthPx: 4 }),
				shadow: solid('#000000', { offsetX: 3, offsetY: 4, spread: 4, opacity: 70 })
			} }
		},
		{
			id: 'glitter-outline', label: 'Glitter Outline', group: 'classic', targets: ['sticker'], backdrop: 'dark',
			value: { slots: {
				border: glitter(20, '#ffffff', { widthPx: 6, edgeStyle: 'round' })
			} }
		},
		{
			id: 'wordart-rainbow', label: 'WordArt Rainbow', group: 'classic', targets: ['text', 'shape'],
			value: { slots: {
				fill: gradient('spectrum', { angle: 90 }),
				shadow: solid('#7f7f7f', { offsetX: 6, offsetY: 6, spread: 0 })
			} }
		},
		{
			id: 'impact-meme', label: 'Impact Meme', group: 'classic', targets: ['text'], tags: ['meme'],
			value: {
				slots: {
					fill: solid('#ffffff'),
					border: solid('#000000', { widthPx: 4 })
				},
				data: { 'textData.fontId': 'impact', 'textData.textCase': 'upper' }
			}
		},
		// A fat white outline and a soft lift, like a vinyl sticker.
		{
			id: 'sticker-bomb', label: 'Sticker', group: 'classic', targets: ['text', 'shape'],
			value: { slots: {
				fill: solid('#ff3d9a'),
				border: solid('#ffffff', { widthPx: 8, edgeStyle: 'round' }),
				shadow: solid('#2a0f24', { offsetX: 0, offsetY: 4, spread: 8, blur: 6, opacity: 45 })
			} }
		},
		{
			id: 'die-cut', label: 'Die-cut', group: 'classic', targets: ['sticker'], backdrop: 'dark',
			value: { slots: {
				border: solid('#ffffff', { widthPx: 8, edgeStyle: 'round' }),
				shadow: solid('#000000', { offsetX: 0, offsetY: 4, spread: 8, blur: 6, opacity: 45 })
			} }
		},
		{
			id: 'soft-shadow', label: 'Soft Shadow', group: 'classic', targets: ['sticker'],
			value: { slots: {
				shadow: solid('#000000', { offsetX: 0, offsetY: 6, spread: 0, blur: 12, opacity: 45 })
			} }
		},
		{
			id: 'pixel-outline', label: 'Pixel Outline', group: 'classic', targets: ['sticker'],
			value: { slots: {
				border: solid('#000000', { widthPx: 2, edgeStyle: 'hard' })
			} }
		},

		// Shiny: each leans on a different effect so they read apart at a
		// glance: chisel metal, pillow candy, gloss gel, glow, offset retro.
		{
			id: 'chrome-bevel', label: 'Chrome', group: 'shiny', targets: ['text', 'shape'],
			value: { slots: {
				fill: gradient('chrome', { angle: 180 }),
				border: solid('#1b1f27', { widthPx: 2 }),
				bevelHighlight: solid('#ffffff', { profile: 'chisel', size: 5, depth: 90, angle: 120, altitude: 40, soften: 0 }),
				bevelShade: solid('#000000'),
				shadow: solid('#000000', { offsetX: 0, offsetY: 4, spread: 0, blur: 8, opacity: 45 })
			} }
		},
		{
			id: 'gold-foil', label: 'Gold Foil', group: 'shiny', targets: ['text', 'shape'],
			value: { slots: {
				fill: gradient('gold', { angle: 180 }),
				border: solid('#5d3100', { widthPx: 2 }),
				bevelHighlight: solid('#fff4ad', { profile: 'chisel', size: 4, depth: 75, angle: 135, altitude: 45, soften: 1 }),
				bevelShade: solid('#5d3100'),
				shadow: solid('#3b1f00', { offsetX: 2, offsetY: 4, spread: 0, blur: 4, opacity: 55 })
			} }
		},
		{
			id: 'y2k-bubble', label: 'Y2K Bubble', group: 'shiny', targets: ['text', 'shape'],
			value: { slots: {
				fill: gradient('bubblegum', { angle: 180 }),
				border: solid('#ffffff', { widthPx: 4 }),
				bevelHighlight: solid('#ffffff', { profile: 'pillow', size: 10, depth: 70, angle: 120, altitude: 45, soften: 3 }),
				bevelShade: solid('#b04aa0'),
				shadow: solid('#b967ff', { offsetX: 5, offsetY: 6, spread: 4, opacity: 90 })
			} }
		},
		{
			id: 'candy-jelly', label: 'Jelly', group: 'shiny', targets: ['text', 'shape'],
			value: { slots: {
				fill: solid('#ff4fa3'),
				bevelHighlight: solid('#ffffff', { profile: 'pillow', size: 12, depth: 90, angle: 110, altitude: 55, soften: 4 }),
				bevelShade: solid('#9b0050'),
				shadow: solid('#9b0050', { offsetX: 0, offsetY: 5, spread: 0, blur: 8, opacity: 40 })
			} }
		},
		{
			id: 'aqua-button', label: 'Aqua Gel', group: 'shiny', targets: ['text', 'shape'],
			value: { slots: {
				fill: gradient('aqua-glass', { angle: 180 }),
				border: solid('#00507f', { widthPx: 2 }),
				bevelHighlight: solid('#ffffff', { profile: 'gloss', depth: 85 }),
				bevelShade: solid('#000000'),
				shadow: solid('#00304d', { offsetX: 0, offsetY: 4, spread: 0, blur: 8, opacity: 55 })
			} }
		},
		{
			id: 'frutiger-glass', label: 'Frutiger', group: 'shiny', targets: ['text', 'shape'],
			value: { slots: {
				fill: gradient('frutiger-sky', { angle: 180 }),
				border: solid('#ffffff', { widthPx: 3 }),
				bevelHighlight: solid('#ffffff', { profile: 'gloss', depth: 90 }),
				bevelShade: solid('#004a8f'),
				shadow: solid('#178bff', { offsetX: 0, offsetY: 0, spread: 0, blur: 14, opacity: 55 })
			} }
		},
		{
			id: 'holographic', label: 'Holo', group: 'shiny', targets: ['text', 'shape'], backdrop: 'dark',
			value: { slots: {
				fill: gradient('holographic', { angle: 135 }),
				border: solid('#ffffff', { widthPx: 2 }),
				bevelHighlight: solid('#ffffff', { profile: 'gloss', depth: 60 }),
				bevelShade: solid('#5747ff'),
				shadow: solid('#b9c4ff', { offsetX: 0, offsetY: 0, spread: 0, blur: 14, opacity: 70 })
			} }
		},
		// A white-hot tube inside a soft colored glow.
		{
			id: 'neon-glow', label: 'Neon Glow', group: 'shiny', targets: all, backdrop: 'dark',
			value: { slots: {
				fill: solid('#ffffff'),
				border: solid('#ff2bd6', { widthPx: 3 }),
				shadow: solid('#ff2bd6', { offsetX: 0, offsetY: 0, spread: 2, blur: 18, opacity: 90 })
			} }
		},
		// The hard-edged glow: no offset, all spread, no blur.
		{
			id: 'neon-pop', label: 'Neon Pop', group: 'shiny', targets: all, backdrop: 'dark',
			value: { slots: {
				fill: solid('#ffffff'),
				border: solid('#ff2bd6', { widthPx: 3 }),
				shadow: solid('#ff2bd6', { offsetX: 0, offsetY: 0, spread: 8, opacity: 55 })
			} }
		},
		{
			id: 'vaporwave', label: 'Vaporwave', group: 'shiny', targets: ['text', 'shape'], backdrop: 'dark',
			value: { slots: {
				fill: gradient('vaporwave', { angle: 90 }),
				border: solid('#00e5ff', { widthPx: 2 }),
				shadow: solid('#ff4fd8', { offsetX: 5, offsetY: 5, spread: 0, opacity: 100 })
			} }
		}
	];
})();

function getStylePresetSlotDefinitions(type) {
	return (LAYER_UI_CONFIG[type]?.paintSlots || []).filter((definition) => STYLE_PRESET_ROLES.includes(definition.role));
}

// Slots gated by a shared enabledPath (the two bevel slots) switch on
// together: a preset naming one resets the other to its defaults.
function getStylePresetEnabledPaths(definitions, slots) {
	return new Set(definitions.filter((definition) => slots[definition.key] && definition.enabledPath).map((definition) => definition.enabledPath));
}

// context: { getSlotDefaults(key), glitterAvailable(id), onSlotDisabled?(key) }
function applyStylePresetValue(layer, value, context) {
	const slots = value.slots || {};
	const definitions = getStylePresetSlotDefinitions(layer.type);
	const enabledPaths = getStylePresetEnabledPaths(definitions, slots);
	const repairGlitter = (definition, data) => {
		if (data.mode === 'glitter' && (data.glitterId == null || !context.glitterAvailable(data.glitterId))) {
			data.glitterId = getPaintSlotDefaultGlitterId(layer.type, definition);
		}
	};
	definitions.forEach((definition) => {
		const partial = slots[definition.key] ? structuredClone(slots[definition.key]) : null;
		if (definition.role === 'fill') {
			if (!partial) return;
			const fill = value.resetFill ? context.getSlotDefaults(definition.key) : readFieldPath(layer, definition.pathKeys);
			Object.assign(fill, {
				opacity: FIELDS.slotOpacity.value,
				scale: FIELDS.textureScale.value,
				colorAdjust: null
			}, partial);
			repairGlitter(definition, fill);
			if (value.resetFill) writeFieldPath(layer, definition.pathKeys, fill);
			return;
		}
		if (!partial && !enabledPaths.has(definition.enabledPath)) {
			toggleSlotEffect(layer, definition, false, () => context.getSlotDefaults(definition.key));
			context.onSlotDisabled?.(definition.key);
			return;
		}
		const data = { ...context.getSlotDefaults(definition.key), ...(partial || {}) };
		repairGlitter(definition, data);
		writeFieldPath(layer, definition.pathKeys, data);
		if (definition.enabledKeys) writeFieldPath(layer, definition.enabledKeys, true);
		const draftHost = definition.draftKeys ? readFieldPath(layer, definition.draftKeys.slice(0, -1)) : null;
		if (draftHost) delete draftHost[definition.draftKeys.at(-1)];
	});
	Object.entries(value.data || {}).forEach(([path, fieldValue]) => {
		writeFieldPath(layer, splitFieldPath(path), structuredClone(fieldValue));
	});
}

// The preset the layer currently matches, if any: every value the preset
// writes is still in place and every effect it leaves out is off.
function findStylePresetId(layer) {
	const library = STYLE_PRESETS[layer?.type];
	if (!library) return null;
	const definitions = getStylePresetSlotDefinitions(layer.type);
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	return library.entries.find((entry) => {
		const slots = entry.value.slots || {};
		const enabledPaths = getStylePresetEnabledPaths(definitions, slots);
		const slotsMatch = definitions.every((definition) => {
			const partial = slots[definition.key];
			const data = readFieldPath(layer, definition.pathKeys);
			const present = Boolean(data) && (!definition.enabledKeys || Boolean(readFieldPath(layer, definition.enabledKeys)));
			if (!partial) return definition.role === 'fill' || enabledPaths.has(definition.enabledPath) || !present;
			return present && Object.entries(partial).every(([key, value]) => {
				// A glitter repaired to the slot default still counts as the preset.
				if (key === 'glitterId') return true;
				return same(data[key], value);
			});
		});
		return slotsMatch && Object.entries(entry.value.data || {}).every(([path, value]) => same(readFieldPath(layer, splitFieldPath(path)), value));
	})?.id || null;
}

// Thumbnails: text and shape tiles show the real render (ui/style-preset-
// thumbnails.js, bound in syncStylePresetGrid), which may arrive a moment
// later. Until then, and always for stickers (no sample artwork), a tile
// shows a CSS sketch of the look: glitter fills show the real GIF, glitter
// outlines and shadows their stand-in color. The glitter URL comes from the
// library the panel is bound to.
let stylePresetGlitterUrl = () => null;
// (kind, entry) -> data URL | Promise<data URL | null> | null
let stylePresetRenderedUrl = () => null;

function setStylePresetGlitterResolver(resolve) {
	stylePresetGlitterUrl = resolve;
}

function setStylePresetPreviewResolver(resolve) {
	stylePresetRenderedUrl = resolve;
}

function showStylePresetRender(element, sample, url) {
	if (!url) return;
	element.classList.add('is-rendered');
	element.style.backgroundImage = `url(${url})`;
	sample.hidden = true;
}

function applyStylePresetSamplePaint(sample, paint, clipToText) {
	const style = sample.style;
	if (!paint || paint.mode === 'none') {
		style.color = 'transparent';
		return;
	}
	const url = paint.mode === 'glitter' ? stylePresetGlitterUrl(paint.glitterId) : null;
	const image = paint.mode === 'gradient' ? effectGradientToCss(paint.gradient) : (url ? `url(${url})` : null);
	if (!image) {
		style.backgroundColor = clipToText ? '' : paint.color;
		style.color = paint.color;
		return;
	}
	style.backgroundImage = image;
	if (clipToText) {
		style.backgroundClip = 'text';
		style.webkitBackgroundClip = 'text';
		style.color = 'transparent';
	}
}

function renderStylePresetThumbnail(kind, entry, element) {
	const slots = entry.value.slots || {};
	const sample = document.createElement('span');
	sample.className = `style-preset-sample is-${kind}`;
	const isBox = kind === 'shape';
	if (!isBox) sample.textContent = kind === 'sticker' ? '♥' : 'Aa';
	const fontId = entry.value.data?.['textData.fontId'];
	if (fontId) sample.style.fontFamily = FontLibrary.getFamily(FontLibrary.getFont(fontId));
	applyStylePresetSamplePaint(sample, slots.fill || (kind === 'sticker' ? { mode: 'solid', color: '#ff8fcf' } : { mode: 'solid', color: '#ff66cc' }), !isBox);
	const border = slots.border;
	const shadow = slots.shadow;
	const bevel = slots.bevelHighlight;
	if (isBox) {
		const shadows = [];
		if (bevel) {
			shadows.push(bevel.profile === 'gloss'
				? 'inset 0 9px 0 -2px rgba(255, 255, 255, 0.55)'
				: 'inset 2px 2px 0 rgba(255, 255, 255, 0.75), inset -2px -2px 0 rgba(0, 0, 0, 0.35)');
		}
		if (border) shadows.push(`0 0 0 ${Math.max(1, Math.round(border.widthPx / 2))}px ${border.color}`);
		if (shadow) shadows.push(`${Math.round(shadow.offsetX / 2)}px ${Math.round(shadow.offsetY / 2)}px 0 ${Math.round((shadow.spread || 0) / 3) + (border ? Math.max(1, Math.round(border.widthPx / 2)) : 0)}px ${shadow.color}`);
		sample.style.boxShadow = shadows.join(', ');
	} else {
		const filters = [];
		if (border) {
			const width = Math.max(1, Math.min(2, Math.round(border.widthPx / 3)));
			[[width, 0], [-width, 0], [0, width], [0, -width]].forEach(([x, y]) => filters.push(`drop-shadow(${x}px ${y}px 0 ${border.color})`));
		}
		if (shadow) {
			const soft = Math.round(((shadow.spread || 0) + (shadow.blur || 0)) / 3);
			filters.push(`drop-shadow(${Math.round(shadow.offsetX / 2)}px ${Math.round(shadow.offsetY / 2)}px ${soft}px ${shadow.color})`);
		}
		sample.style.filter = filters.join(' ');
	}
	element.classList.add('style-preset-thumbnail');
	// Glows read on dark, everything else on the light backdrop a typical
	// canvas image gives it.
	element.classList.toggle('is-dark', entry.backdrop === 'dark');
	element.replaceChildren(sample);
	const rendered = stylePresetRenderedUrl(kind, entry);
	if (typeof rendered === 'string') showStylePresetRender(element, sample, rendered);
	else rendered?.then?.((url) => showStylePresetRender(element, sample, url));
}

// A shared look keeps only the slots the target type declares (a sticker
// has no fill, so Neon Glow on a sticker is its outline and glow).
function fitStylePresetEntry(entry, type) {
	const { targets, ...rest } = entry;
	const declared = new Set(getStylePresetSlotDefinitions(type).map((definition) => definition.key));
	const slots = Object.fromEntries(Object.entries(entry.value.slots || {}).filter(([key]) => declared.has(key)));
	return { ...rest, value: { ...entry.value, slots } };
}

// One library per target type (the grid shows only what fits that layer).
const STYLE_PRESETS = Object.freeze(Object.fromEntries(Object.entries(STYLE_PRESET_TARGETS).map(([kind, type]) => [
	type,
	GlitterPresetLibrary.createPresetLibrary({
		id: `styles-${kind}`,
		groups: STYLE_PRESET_GROUPS,
		entries: STYLE_PRESET_ENTRIES.filter((entry) => entry.targets.includes(kind)).map((entry) => fitStylePresetEntry(entry, type)),
		renderThumbnail: (entry, element) => renderStylePresetThumbnail(kind, entry, element),
		// target: { layer, context } (see applyStylePresetValue).
		apply(entry, target, value) {
			if (target?.layer) applyStylePresetValue(target.layer, value, target.context);
		}
	})
])));

if (typeof module !== 'undefined' && module.exports) {
	module.exports = { STYLE_PRESETS, STYLE_PRESET_ENTRIES, STYLE_PRESET_ROLES, applyStylePresetValue, findStylePresetId };
}
