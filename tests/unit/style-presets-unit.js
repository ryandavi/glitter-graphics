'use strict';

// Style presets (js/paint/style-presets.js): every entry fits the layer type
// it targets (declared slots, paint modes, field ranges, real glitter and
// font ids), applying one is recognized afterwards, and switching looks
// never leaks the previous look's slots.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const context = vm.createContext({ console, structuredClone, Math, navigator: { hardwareConcurrency: 4, userAgent: 'node' } });
for (const file of [
	'js/core/releases.js',
	'js/core/fields.js',
	'js/core/config.js',
	'js/core/tools.js',
	'js/core/layer-types.js',
	'js/core/options.js',
	'js/ui/panel-schemas.js',
	'js/paint/paint-slots.js',
	'js/layers/types/sticker.js',
	'js/layers/types/text.js',
	'js/layers/types/shape.js',
	'js/ui/preset-library.js',
	'js/paint/bevel.js',
	'js/paint/effect-source.js',
	'js/paint/gradient-presets.js',
	'js/paint/slot-effects.js',
	'js/paint/style-presets.js'
]) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const run = (code) => vm.runInContext(code, context);

function fail(message) {
	throw new Error(`style-presets: ${message}`);
}

const libraries = run('STYLE_PRESETS');
const roles = run('STYLE_PRESET_ROLES');
const entries = run('STYLE_PRESET_ENTRIES');
const LayerType = run('LayerType');
const glitterIds = new Set(require(path.join(root, 'data/glitter.json')).map((item) => item.id));
const fontsManifest = require(path.join(root, 'data/fonts.json'));
const fontIds = new Set((Array.isArray(fontsManifest) ? fontsManifest : fontsManifest.fonts).map((font) => font.id));
const paintModes = run("getOptionValues('paintMode')");
const dataPaths = { [LayerType.TEXT_GLITTER]: ['textData.fontId', 'textData.textCase'] };

// Slot defaults the way the managers build them (text, shape and sticker all
// start from the shared slot-effects builders).
run(`globalThis.testSlotDefaults = (type, key) => {
	const slot = getPaintSlotDefinition(type, key);
	if (key === 'fill') return buildDefaultFill({ defaultGlitterId: getPaintSlotDefaultGlitterId(type, slot) });
	if (key === 'border') return buildDefaultBorder({ slot, defaultGlitterId: getPaintSlotDefaultGlitterId(type, slot), includeColorAdjust: true });
	if (key === 'shadow') return buildDefaultShadow({ defaultGlitterId: getPaintSlotDefaultGlitterId(type, slot), includeColorAdjust: true });
	if (key === 'bevelHighlight') return buildDefaultBevel().highlight;
	if (key === 'bevelShade') return buildDefaultBevel().shade;
	throw new Error('no defaults for ' + key);
};`);

function makeLayer(type) {
	const root = { [LayerType.TEXT_GLITTER]: 'textData', [LayerType.SHAPE]: 'shapeData', [LayerType.STICKER]: 'stickerData' }[type];
	const data = { border: null, shadow: null, bevel: run('buildDefaultBevel()'), sparkles: null };
	if (type !== LayerType.STICKER) data.fill = run(`testSlotDefaults(${JSON.stringify(type)}, 'fill')`);
	if (type === LayerType.TEXT_GLITTER) Object.assign(data, { fontId: 'luckiest-guy', textCase: 'none' });
	return { id: 'layer-1', type, [root]: data };
}

function applyTo(layer, entry) {
	const disabled = [];
	libraries[layer.type].apply(entry, {
		layer,
		context: {
			getSlotDefaults: (key) => run(`testSlotDefaults(${JSON.stringify(layer.type)}, ${JSON.stringify(key)})`),
			glitterAvailable: (glitterId) => glitterIds.has(glitterId),
			onSlotDisabled: (key) => disabled.push(key)
		}
	});
	return disabled;
}

// Every entry lands in at least one library, ids are unique per library, and
// the libraries cover exactly text, shapes and stickers.
if (JSON.stringify(Object.keys(libraries).sort()) !== JSON.stringify([LayerType.TEXT_GLITTER, LayerType.SHAPE, LayerType.STICKER].sort())) fail('libraries must be text, shape and sticker');
const seen = new Set();
Object.values(libraries).forEach((library) => library.entries.forEach((entry) => seen.add(entry.id)));
const targetTypes = run('STYLE_PRESET_TARGETS');
entries.forEach((entry) => {
	if (!seen.has(entry.id)) fail(`${entry.id} targets no library`);
	// Libraries drop slots a target lacks, so a misspelled key would vanish
	// silently: each key must exist on at least one of the entry's targets.
	Object.keys(entry.value.slots || {}).forEach((key) => {
		if (!entry.targets.some((kind) => run(`getPaintSlotDefinition(${JSON.stringify(targetTypes[kind])}, ${JSON.stringify(key)})`))) fail(`${entry.id} names slot ${key}, which none of its targets declare`);
	});
});

Object.entries(libraries).forEach(([type, library]) => {
	const definitions = run(`LAYER_UI_CONFIG[${JSON.stringify(type)}].paintSlots`);
	const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
	library.entries.forEach((entry) => {
		const where = `${type}/${entry.id}`;
		Object.entries(entry.value.slots || {}).forEach(([key, partial]) => {
			const definition = byKey.get(key);
			if (!definition) fail(`${where} names slot ${key}, which the type does not declare`);
			if (!roles.includes(definition.role)) fail(`${where} writes ${key}, a ${definition.role} slot styles never own`);
			if (!paintModes.includes(partial.mode)) fail(`${where} ${key} mode ${partial.mode}`);
			if (partial.mode !== 'gradient' && !definition.modes.includes(partial.mode)) fail(`${where} ${key} mode ${partial.mode} is not offered by the slot`);
			if (partial.mode === 'glitter' && !glitterIds.has(partial.glitterId)) fail(`${where} ${key} glitter ${partial.glitterId} is not in the library`);
			if (partial.mode === 'glitter' && !/^#[0-9a-f]{6}$/i.test(partial.color || '')) fail(`${where} ${key} glitter needs a stand-in color`);
			if (partial.mode === 'gradient' && !(partial.gradient?.stops?.length >= 2)) fail(`${where} ${key} gradient needs stops`);
			definition.fields.forEach((binding) => {
				const value = binding.path.split('.').reduce((node, part) => node?.[part], partial);
				if (value == null || !binding.spec) return;
				if (value < binding.spec.min || value > binding.spec.max) fail(`${where} ${key}.${binding.path} = ${value} is outside ${binding.spec.min}..${binding.spec.max}`);
			});
			if (definition.role === 'bevel' && partial.profile && !run(`isOptionValue('bevelProfile', ${JSON.stringify(partial.profile)})`)) fail(`${where} bevel profile ${partial.profile}`);
			if (partial.edgeStyle && !['round', 'hard'].includes(partial.edgeStyle)) fail(`${where} edge style ${partial.edgeStyle}`);
		});
		Object.entries(entry.value.data || {}).forEach(([dataPath, value]) => {
			if (!(dataPaths[type] || []).includes(dataPath)) fail(`${where} writes ${dataPath}, which styles do not own`);
			if (dataPath === 'textData.fontId' && !fontIds.has(value)) fail(`${where} font ${value} is not in the font manifest`);
		});

		// Round trip: applied, recognized, and one step (values copied, not shared).
		const layer = makeLayer(type);
		applyTo(layer, entry);
		const found = run('findStylePresetId')(layer);
		if (found !== entry.id) fail(`${where} is recognized as ${found} after apply`);
		const fillPath = byKey.get('fill')?.path;
		if (fillPath && entry.value.slots.fill) {
			const fill = fillPath.split('.').reduce((node, part) => node[part], layer);
			if (fill.gradient && fill.gradient === entry.value.slots.fill.gradient) fail(`${where} shares its gradient object with the preset`);
		}
	});

	// Switching looks: every effect the new look leaves out is switched off
	// (parked as a draft), and a named bevel side resets the other one.
	const fancy = library.entries.find((entry) => entry.value.slots.shadow && entry.value.slots.border);
	const plain = library.get(type === LayerType.TEXT_GLITTER ? 'default' : 'plain');
	const layer = makeLayer(type);
	applyTo(layer, fancy);
	const disabled = applyTo(layer, plain);
	const rootKey = Object.keys(layer).find((key) => key.endsWith('Data'));
	if (layer[rootKey].border || layer[rootKey].shadow || layer[rootKey].bevel.enabled) fail(`${type}: Plain after ${fancy.id} left effects on`);
	if (!layer[rootKey].effectDrafts?.border || !layer[rootKey].effectDrafts?.shadow) fail(`${type}: switched-off effects must be parked as drafts`);
	if (!disabled.includes('border') || !disabled.includes('shadow')) fail(`${type}: disabled slots must be reported so an armed picker closes`);
	if (run('findStylePresetId')(layer) !== plain.id) fail(`${type}: ${plain.label} is not recognized after apply`);
	applyTo(layer, fancy);
	if (layer[rootKey].effectDrafts?.border) fail(`${type}: re-enabling a slot must drop its draft`);
});

// A missing glitter falls back to the slot's default instead of an empty slot.
const textLibrary = libraries[LayerType.TEXT_GLITTER];
// Default restores every value a text style owns while preserving content
// and placement, even after a look changes the font and letter case.
const defaultText = makeLayer(LayerType.TEXT_GLITTER);
defaultText.textData.text = 'Keep my text';
defaultText.transform = { position: { x: 45, y: 67 } };
for (const entry of textLibrary.entries) {
	applyTo(defaultText, entry);
	applyTo(defaultText, textLibrary.get('default'));
	const defaults = makeLayer(LayerType.TEXT_GLITTER).textData;
	if (JSON.stringify(defaultText.textData.fill) !== JSON.stringify(defaults.fill)) fail(`Default after ${entry.id} did not restore the fill`);
	if (defaultText.textData.fontId !== run('CONFIG.tools.text.defaultFontId') || defaultText.textData.textCase !== run('CONFIG.tools.text.defaultTextCase')) fail(`Default after ${entry.id} did not restore font and case`);
	if (defaultText.textData.border || defaultText.textData.shadow || defaultText.textData.bevel.enabled) fail(`Default after ${entry.id} left effects on`);
	if (defaultText.textData.text !== 'Keep my text' || defaultText.transform.position.x !== 45 || defaultText.transform.position.y !== 67) fail('Default changed content or placement');
	if (run('findStylePresetId')(defaultText) !== 'default') fail('Default is not recognized after reset');
}
const blingee = textLibrary.get('blingee-pink');
const layer = makeLayer(LayerType.TEXT_GLITTER);
libraries[LayerType.TEXT_GLITTER].apply(blingee, {
	layer,
	context: {
		getSlotDefaults: (key) => run(`testSlotDefaults(${JSON.stringify(LayerType.TEXT_GLITTER)}, ${JSON.stringify(key)})`),
		glitterAvailable: () => false
	}
});
const fallback = run(`getPaintSlotDefaultGlitterId(${JSON.stringify(LayerType.TEXT_GLITTER)}, getPaintSlotDefinition(${JSON.stringify(LayerType.TEXT_GLITTER)}, 'fill'))`);
if (layer.textData.fill.glitterId !== fallback) fail('a missing glitter must fall back to the slot default');

// A shadow under an outline shows only where it reaches past it (the old Y2K
// Bubble hid a 4px-offset shadow under a 5px outline), and a tile backdrop
// is light unless the look asks for dark.
entries.forEach((entry) => {
	const { border, shadow } = entry.value.slots || {};
	if (entry.backdrop != null && entry.backdrop !== 'dark') fail(`${entry.id} backdrop ${entry.backdrop}`);
	if (!shadow || !border || border.placement === 'inside') return;
	const reach = Math.max(Math.abs(shadow.offsetX || 0), Math.abs(shadow.offsetY || 0)) + (shadow.spread || 0) + (shadow.blur || 0);
	if (reach <= border.widthPx) fail(`${entry.id} shadow (reach ${reach}px) is hidden under its ${border.widthPx}px outline`);
});

process.stdout.write(`Style presets unit passed (${entries.length} presets across ${Object.keys(libraries).length} layer types)\n`);
