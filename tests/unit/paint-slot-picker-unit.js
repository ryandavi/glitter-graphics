'use strict';

// Glitter pickers resolve a paint slot through its declaration (path, label,
// panelPrefix), never by reading the layer's data root with the slot key. A
// slot stored at a nested path (the bevel paints at `bevel.highlight`) is
// invisible to a root lookup, which is how a Change button ends up opening the
// wrong library or writing to the fill. This walks every declared slot that
// offers a glitter source and checks the picker can arm it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const context = vm.createContext({ console, structuredClone, Math, navigator: { hardwareConcurrency: 4, userAgent: 'node' } });
const typeFiles = fs.readdirSync(path.join(root, 'js/layers/types')).filter((file) => file.endsWith('.js')).map((file) => `js/layers/types/${file}`);
for (const file of [
	'js/core/releases.js',
	'js/core/fields.js',
	'js/core/config.js',
	'js/core/tools.js', 'js/core/sessions.js',
	'js/core/layer-types.js',
	'js/core/options.js',
	'js/effects/animation.js', 'js/systems/CanvasBounds.js', 'js/ui/panel-schemas.js',
	'js/paint/paint-slots.js',
	...typeFiles,
	'js/ui/asset-browser-markup.js',
	'js/ui/gallery.js',
	'js/ui/picker-session.js'
]) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const run = (code) => vm.runInContext(code, context);
context.LIBRARY_ALL_ID = 'all';
context.requestAnimationFrame = (callback) => callback();

const config = run('LAYER_UI_CONFIG');
const getLayerPaintSlot = run('getLayerPaintSlot');
const ensureLayerPaintSlot = run('ensureLayerPaintSlot');
const pickerArmedSlot = run('pickerArmedSlot');
const getPaintSlotChipId = run('getPaintSlotChipId');

let checked = 0;
let nested = 0;
Object.entries(config).forEach(([type, entry]) => {
	(entry.paintSlots || []).forEach((definition) => {
		if (!definition.panelPrefix || !definition.modes?.includes('glitter')) return;
		const where = `${type}.${definition.key}`;
		const layer = { id: 'layer-1', type, name: 'Layer' };
		const manager = { pickerSession: { layerId: layer.id, slot: definition.key } };
		const editor = { pickers: { active: manager }, layerManager: { getLayerById: () => layer, getInspectedLayer: () => layer } };
		const schema = run("getAssetBrowserSchema('glitter')");
		const defaultId = schema.pickerDefault(editor);
		assert.strictEqual(defaultId, run('getPaintSlotDefaultGlitterId')(type, definition), `${where}: picker uses its declared default`);
		const browser = { schema, rail: { select: (value) => { browser.selected = value; } }, navigateToItem: (value) => { browser.navigated = value; } };
		const library = { browser, clearFilters: () => { library.cleared = true; } };
		run('revealAssetBrowser')(editor, library, defaultId);
		assert.strictEqual(browser.selected, 'all', `${where}: default opens All`);
		assert(library.cleared, `${where}: All clears stale filters`);
		run('revealAssetBrowser')(editor, library, 'custom-asset');
		assert.strictEqual(browser.navigated, 'custom-asset', `${where}: custom assets retain their category reveal`);

		// Nothing stored yet: the slot is not armable, and no root lookup says otherwise.
		assert.strictEqual(getLayerPaintSlot(layer, definition.key), null, `${where}: an empty layer has no slot data`);
		assert.strictEqual(pickerArmedSlot(manager, layer), null, `${where}: a missing slot must not read as armed`);

		const created = ensureLayerPaintSlot(layer, definition.key, () => ({ mode: 'solid', glitterId: null }));
		assert(created && typeof created === 'object', `${where}: ensureLayerPaintSlot returns the slot object`);
		assert.strictEqual(getLayerPaintSlot(layer, definition.key), created, `${where}: the slot reads back from its declared path`);
		assert.strictEqual(pickerArmedSlot(manager, layer), definition.key, `${where}: the picker's armed check must be true once the slot exists`);
		assert.strictEqual(pickerArmedSlot(manager, { ...layer, id: 'other' }), null, `${where}: a session never arms another layer`);

		// A pick writes through the same object the renderers read.
		created.glitterId = 7;
		created.mode = 'glitter';
		assert.strictEqual(definition.pathKeys.reduce((node, key) => node[key], layer).glitterId, 7, `${where}: a pick lands at ${definition.path}`);

		// Close returns to the slot's own chip, and the Library names the slot in words.
		assert.strictEqual(getPaintSlotChipId(type, definition.key), `${definition.panelPrefix}GlitterChip`, `${where}: return-focus id comes from panelPrefix`);
		assert(/^[a-z]+( [a-z]+)*$/.test(definition.label), `${where}: label "${definition.label}" must be lowercase words, not a key`);

		checked += 1;
		// The slots a `root[key]` lookup cannot find.
		if (definition.pathKeys.at(-1) !== definition.key) nested += 1;
	});
});
assert(checked > 0, 'no glitter slots were checked');
assert(nested > 0, 'expected at least one nested-path slot (bevel) to be covered');

['font', 'sticker', 'shape', 'brushTip'].forEach((kind) => {
	const schema = run('getAssetBrowserSchema')(kind);
	const browser = { schema, browseView: 'favorites', rail: { select: (value) => { browser.selected = value; } }, navigateToItem: (value) => { browser.navigated = value; } };
	const library = { browser, clearFilters: () => { library.cleared = true; } };
	run('revealAssetBrowser')({}, library, String(schema.pickerDefault()));
	assert.strictEqual(browser.selected, 'all', `${kind}: default opens All regardless of id type`);
	assert.strictEqual(browser.browseView, 'style', `${kind}: default leaves Favorites`);
	assert(library.cleared, `${kind}: default clears stale filters`);
	assert.strictEqual(browser.navigated, undefined, `${kind}: default does not reveal its category`);
	run('revealAssetBrowser')({}, library, 'custom-asset');
	assert.strictEqual(browser.navigated, 'custom-asset', `${kind}: a custom asset reveals its category`);
});
assert.strictEqual(run("getAssetBrowserSchema('glitter')").pickerDefault({ pickers: { active: { pickerSession: { defaultAssetId: 123 } } } }), 123, 'Auto Glitter uses its suggested match as the default');

// The stale lookup itself must not come back: no picker path may index a
// layer's data root with a computed slot key.
const ROOT_LOOKUP = /\b(?:shape|text|sticker|frame)Data\??\.?\[(?!['"])/;
['js/layers/ShapeGlitterManager.js', 'js/layers/TextGlitterManager.js', 'js/layers/StickerManager.js', 'js/layers/GlitterManager.js', 'js/assets/GlitterBrowserManager.js', 'js/editor/panels.js', 'js/ui/picker-session.js'].forEach((file) => {
	fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
		assert(!ROOT_LOOKUP.test(line), `${file}:${index + 1} reads a slot from the data root by key; use getLayerPaintSlot`);
	});
});
assert(!/function getSlotEffectData\b/.test(fs.readFileSync(path.join(root, 'js/paint/slot-effects.js'), 'utf8')), 'getSlotEffectData (root[slot]) must stay deleted');

process.stdout.write(`Paint slot picker unit passed (${checked} glitter slots, ${nested} nested)\n`);
