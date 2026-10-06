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
//     text styles also discard parked effects;
//   - the fill, when left out, is kept.
// Text style fields reset before applying a look; omitted fields use defaults.
// Text styles clear background, sparkles and motion, and reset layer paint.
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
	Object.freeze({ id: 'shiny', label: 'Shiny' }),
	Object.freeze({ id: 'wordart', label: 'WordArt' })
]);

const STYLE_PRESET_TEXT_DEFAULTS = Object.freeze({
	'textData.fontId': CONFIG.tools.text.defaultFontId,
	'textData.fontWeight': CONFIG.tools.text.defaultFontWeight,
	'textData.fontStyle': CONFIG.tools.text.defaultFontStyle,
	'textData.textCase': CONFIG.tools.text.defaultTextCase,
	'textData.letterSpacing': FIELDS.textLetterSpacing.value,
	'textData.lineHeight': FIELDS.textLineHeight.value / 100,
	'textData.warp.type': CONFIG.tools.text.defaultWarpType,
	'textData.warp.bend': FIELDS.textWarpBend.value,
	'textData.decoration.underline': false,
	'textData.decoration.strikethrough': false
});
const STYLE_PRESET_TEXT_PATHS = Object.freeze(Object.keys(STYLE_PRESET_TEXT_DEFAULTS));

const STYLE_PRESET_ENTRIES = (() => {
	const glitter = (glitterId, color, extra = {}) => ({ mode: 'glitter', glitterId, color, ...extra });
	const solid = (color, extra = {}) => ({ mode: 'solid', color, ...extra });
	const gradient = (presetId, extra = {}) => ({
		mode: 'gradient',
		gradient: normalizeEffectGradient({ ...CONFIG.rendering.gradient, ...GRADIENT_PRESETS.get(presetId).value, ...extra })
	});
	const all = ['text', 'shape', 'sticker'];
	const inlineGradient = (colors, extra = {}) => ({ mode: 'gradient', gradient: normalizeEffectGradient({
		...CONFIG.rendering.gradient, angle: 180,
		stops: colors.map((stop, index) => ({ offset: Array.isArray(stop) ? stop[0] : index / (colors.length - 1), color: Array.isArray(stop) ? stop[1] : stop, alpha: 1 })), ...extra
	}) });
	const wordart = (id, label, slots, data = {}) => ({ id, label, group: 'wordart', targets: ['text'], value: {
		slots, data: { 'textData.textCase': 'upper', 'textData.fontStyle': 'normal', 'textData.letterSpacing': 0, ...data }
	} });
	const impact = { 'textData.fontId': 'impact' };
	const warp = (type, bend) => ({ 'textData.warp.type': type, 'textData.warp.bend': bend });
	const hardShadow = (color, offsetX, offsetY, extra = {}) => solid(color, { offsetX, offsetY, spread: 0, blur: 0, ...extra });
	const extrude = (color, x, y) => hardShadow(color, x, y, { kind: 'extrude' });
	const cast = color => solid(color, { kind: 'cast', castAnchor: 'baseline', castLengthRatio: 0.25, castLeanRatio: -0.7, castBlurRatio: 0 });
	// A shadow shows only where it reaches past the outline: |offset| +
	// spread + blur must beat the outline width (the unit test holds every
	// look to it).
	return [
		{
			id: 'default', label: 'Default', group: 'classic', targets: ['text'], tags: ['reset'],
			value: {
				slots: { fill: buildDefaultFill({ defaultGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId.text }) },
				data: { 'textData.fontId': CONFIG.tools.text.defaultFontId, 'textData.fontStyle': CONFIG.tools.text.defaultFontStyle, 'textData.textCase': CONFIG.tools.text.defaultTextCase,
					'textData.letterSpacing': FIELDS.textLetterSpacing.value, 'textData.warp.type': CONFIG.tools.text.defaultWarpType, 'textData.warp.bend': FIELDS.textWarpBend.value }
			}
		},
		{ id: 'plain', label: 'Plain', group: 'classic', targets: ['shape', 'sticker'], tags: ['none', 'reset'], value: { slots: {} } },
		{
			id: 'blingee-pink', label: 'Bling', group: 'classic', targets: all,
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

		// Serif and Arial Black looks use the default font until those faces
		// are available. Unnamed warps draw flat.
		wordart('outline', 'Outline', { fill: solid('#ffffff'), border: solid('#000000', { widthPx: 1 }) }, impact),
		wordart('up', 'Up', { fill: solid('#000000') }, { ...impact, ...warp('rise', 35) }),
		wordart('arc', 'Arc', { fill: solid('#000000') }, { ...warp('arc', 25), 'textData.letterSpacing': 6 }),
		wordart('squeeze', 'Squeeze', { fill: solid('#000000') }, { ...impact, ...warp('bulge', -60) }),
		wordart('inverted-arc', 'Inverted Arc', { fill: solid('#000000') }, warp('arc', -25)),
		wordart('italic-outline', 'Italic Outline', { fill: solid('#ffffff'), border: solid('#000000', { widthPx: 1 }), shadow: hardShadow('#999999', 3, 2) }, { 'textData.fontStyle': 'italic' }),
		wordart('slate', 'Slate', { fill: solid('#336699'), shadow: hardShadow('#c1c1c1', 3, 2) }),
		wordart('mauve', 'Mauve', { fill: solid('#a6a7dc'), border: solid('#6e6dc4', { widthPx: 2 }), shadow: hardShadow('#9392e4', 4, 4) }, impact),
		wordart('graydient', 'Graydient', { fill: inlineGradient(['#adadad', '#ffffff']), shadow: hardShadow('#7f7f7f', 4, 3) }, { 'textData.letterSpacing': 12 }),
		wordart('red-blue', 'Red Blue', { fill: solid('#0363ca'), border: solid('#bad1f5', { widthPx: 2 }), shadow: hardShadow('#732d40', 4, 4) }, impact),
		wordart('radial', 'Radial', { fill: inlineGradient(['#fdef50', '#f29f42'], { type: 'radial' }), shadow: hardShadow('#c9c9c9', 3, 3) }, impact),
		wordart('purple', 'Purple', { fill: inlineGradient(['#773fc9', '#bf47cc']), shadow: hardShadow('#bea5f8', 4, 4) }, { ...impact, ...warp('rise', 15) }),
		wordart('green-marble', 'Green Marble', { fill: solid('#106229'), shadow: hardShadow('#d9e8e0', 0, -18) }),
		wordart('rainbow', 'Rainbow', { fill: inlineGradient([[0.18, '#d31573'], [0.31, '#e74b2e'], [0.44, '#f7a51d'], [0.57, '#fbec3d'], [0.7, '#3aa33f'], [0.83, '#2941b5'], [1, '#6f0bc3']], { angle: 90 }), shadow: cast('#c8c8c8') }, impact),
		wordart('aqua', 'Aqua', { fill: inlineGradient(['#a6aedd', '#729ebb', '#4f9aa0']), shadow: hardShadow('#c9d2da', 3, 3) }, warp('ripple', 50)),
		wordart('paper-bag', 'Paper Bag', { fill: solid('#95795b'), shadow: extrude('#221103', 5, 5) }, impact),
		wordart('sunset', 'Sunset', { fill: inlineGradient(['#f4f4eb', '#ebb0ae']), shadow: extrude('#084d92', -4, -8) }, warp('arch', 40)),
		wordart('tilt', 'Tilt', { fill: inlineGradient(['#623608', '#debc41']), shadow: cast('#705522') }, { ...impact, 'textData.fontStyle': 'italic' }),
		wordart('blues', 'Blues', { fill: solid('#54ccfa'), border: solid('#2969b6', { widthPx: 2 }), shadow: extrude('#0b3198', 8, -8) }, { ...impact, ...warp('ripple', 50) }),
		wordart('yellow-dash', 'Yellow Dash', { fill: solid('#f4f621'), border: solid('#434308', { widthPx: 2 }), shadow: hardShadow('#abab74', 3, 3) }, { ...impact, ...warp('climb', 40) }),
		wordart('chrome', 'Chrome', { fill: inlineGradient(['#484848', '#dadada', '#5f5f5f', '#aaaaaa', '#f4f4f4']), shadow: extrude('#393939', 4, 3) }),
		wordart('superhero', 'Superhero', { fill: inlineGradient(['#fdd213', '#f97306']), shadow: extrude('#8b3802', -6, 10) }, { ...impact, ...warp('rise', 35) }),
		wordart('horizon', 'Horizon', { fill: inlineGradient([[0, '#7f95ac'], [0.5, '#dfe3e7'], [0.51, '#98514e'], [1, '#b89695']]), shadow: extrude('#110e0e', -5, 5) }, impact),

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

function createStylePresetEntryFromLayer(layer, getSlotDefaults) {
	const slots = {};
	getStylePresetSlotDefinitions(layer.type).forEach((definition) => {
		const data = readFieldPath(layer, definition.pathKeys);
		if (!data || (definition.enabledKeys && !readFieldPath(layer, definition.enabledKeys))) return;
		const defaults = getSlotDefaults(definition.key);
		slots[definition.key] = Object.fromEntries(Object.entries(data).filter(([key, value]) =>
			key === 'mode' || (data.mode === 'glitter' && ['color', 'glitterId'].includes(key)) || (!key.startsWith('_') && JSON.stringify(value) !== JSON.stringify(defaults[key]))));
	});
	const paths = layer.textData?.orientation == null ? STYLE_PRESET_TEXT_PATHS : [...STYLE_PRESET_TEXT_PATHS, 'textData.orientation'];
	const data = Object.fromEntries(paths.map(path => [path, readFieldPath(layer, splitFieldPath(path))]).filter(([, value]) => value !== undefined));
	return structuredClone({ id: 'custom-style', label: 'Custom style', group: 'wordart', targets: ['text'], value: { slots, data } });
}

// context: { getSlotDefaults(key), glitterAvailable(id), onSlotDisabled?(key) }
function applyStylePresetValue(layer, value, context) {
	if (layer.type === LayerType.TEXT_GLITTER) {
		layer.opacity = FIELDS.layerOpacity.value;
		layer.blendMode = CONFIG.layers.defaultBlendMode;
		layer.animations = [];
		delete layer.animation;
		layer.textData.textBackground = buildDefaultTextBackground();
		layer.textData.sparkles = null;
		layer.textData.border = null;
		layer.textData.shadow = null;
		layer.textData.bevel = buildDefaultBevel();
		delete layer.textData.effectDrafts;
		(LAYER_UI_CONFIG[layer.type].paintSlots || []).filter(slot => slot.role !== 'fill').forEach(slot => context.onSlotDisabled?.(slot.key));
	}
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
			if (!partial && layer.type !== LayerType.TEXT_GLITTER) return;
			const fill = { ...context.getSlotDefaults(definition.key), ...(partial || {}) };
			repairGlitter(definition, fill);
			writeFieldPath(layer, definition.pathKeys, fill);
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
	if (layer.type === LayerType.TEXT_GLITTER) delete layer.textData.effectDrafts;
	Object.entries({ ...(layer.type === LayerType.TEXT_GLITTER ? STYLE_PRESET_TEXT_DEFAULTS : {}), ...value.data }).forEach(([path, fieldValue]) => {
		writeFieldPath(layer, splitFieldPath(path), structuredClone(fieldValue));
	});
}

// The preset the layer currently matches, if any: every value the preset
// writes is still in place and every effect it leaves out is off.
function findStylePresetId(layer) {
	const library = STYLE_PRESETS[layer?.type];
	if (!library) return null;
	if (layer.type === LayerType.TEXT_GLITTER && (layer.textData.textBackground?.enabled || layer.textData.sparkles || layer.animations?.length || layer.animation || layer.opacity !== FIELDS.layerOpacity.value || layer.blendMode !== CONFIG.layers.defaultBlendMode)) return null;
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
	const rest = { ...entry };
	delete rest.targets;
	const declared = new Set(getStylePresetSlotDefinitions(type).map((definition) => definition.key));
	const slots = Object.fromEntries(Object.entries(entry.value.slots || {}).filter(([key]) => declared.has(key)));
	return { ...rest, value: { ...entry.value, slots, data: { ...(type === LayerType.TEXT_GLITTER ? STYLE_PRESET_TEXT_DEFAULTS : {}), ...entry.value.data } } };
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
