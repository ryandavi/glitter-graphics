'use strict';

// Headless checks for BrushLibrary (manifest validation, gallery assets,
// attribution) and MaskEditor's dynamics helpers (seeded PRNG, dab bounds).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const load = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---- shared stubs --------------------------------------------------------
const CONFIG = {
	tools: {
		maskBrush: {
			rasterBrushes: { manifest: 'data/brushes.json' },
			dynamics: { defaults: {}, limits: { scatterMax: 1000, countMax: 16 } }
		},
		rendering: {}
	},
	rendering: { maskAlphaThreshold: 8 }
};
const ShapeLibrary = {
	BRUSH_SHAPES: [
		{ id: 'round', label: 'Round' }, { id: 'square', label: 'Square' },
		{ id: 'star', label: 'Star' }, { id: 'heart', label: 'Heart' },
		{ id: 'calligraphy', label: 'Calligraphy' }
	],
	getIconSvg: (id) => `<svg xmlns="http://www.w3.org/2000/svg"><title>${id}</title></svg>`
};
const stubCanvas = () => ({
	width: 0, height: 0,
	getContext: () => ({
		drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
		fillRect() {}, beginPath() {}, arc() {}, fill() {}, createRadialGradient: () => ({ addColorStop() {} }),
		getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {}
	})
});

// ---- BrushLibrary ------------------------------------------------------------
const brushCtx = {
	console, CONFIG, ShapeLibrary, Promise, Math, JSON, Object, Array, Number, String, Set, Map,
	document: { createElement: stubCanvas },
	Image: function () {},
	fetch: async () => ({ ok: true, json: async () => JSON.parse(load('data/brushes.json')) })
};
brushCtx.window = brushCtx; brushCtx.globalThis = brushCtx;
vm.createContext(brushCtx);
vm.runInContext(load('js/classes/BrushLibrary.js') + '\nthis.BrushLibrary = BrushLibrary;', brushCtx, { filename: 'BrushLibrary.js' });
const BrushLibrary = brushCtx.BrushLibrary;

const manifest = JSON.parse(load('data/brushes.json'));
BrushLibrary.applyManifest(manifest);
const collectionIds = JSON.parse(load('data/brush-categories.json')).map((entry) => entry.id);
assert.deepStrictEqual(collectionIds, manifest.packs.map((pack) => pack.id), 'raster gallery collections mirror the source packs');

const assets = BrushLibrary.assets();
assert(assets.length > ShapeLibrary.BRUSH_SHAPES.length, 'gallery includes vector and raster tips');
assert(assets.some((asset) => asset.category === 'basic' && asset.kind === 'vector'), 'basic vector category is present');
assert(assets.filter((asset) => asset.kind === 'raster').every((asset) => BrushLibrary.packById(asset.category)), 'raster tips browse by source pack');
assert(assets.every((asset) => Array.isArray(asset.categories) && asset.categories.length), 'taxonomy categories remain available as facets');
assets.forEach((asset) => ['id', 'name', 'category', 'thumbnailUrl'].forEach((key) => assert(asset[key], `${asset.id} exposes ${key}`)));
assets.filter((asset) => asset.kind === 'raster').forEach((asset) => {
	assert(asset.thumbnailUrl.startsWith('images/brushes/'));
	assert(fs.existsSync(path.join(root, asset.thumbnailUrl)), `${asset.id} thumbnail exists`);
});

const someRaster = manifest.packs[0].brushes[0].id;
assert(BrushLibrary.isRaster(someRaster));
assert(!BrushLibrary.isRaster('round'));

// defaultDynamics merges the fallback shape under the manifest values
const dyn = BrushLibrary.defaultDynamics(someRaster);
['scatter', 'count', 'countJitter', 'sizeJitter', 'angleJitter', 'roundness', 'flipX', 'bothAxes'].forEach((k) => {
	assert(k in dyn, `defaultDynamics exposes ${k}`);
});
assert.deepStrictEqual(
	Object.keys(BrushLibrary.defaultDynamics('round')).sort(),
	Object.keys(BrushLibrary.DEFAULT_DYNAMICS).sort(),
	'a vector id still resolves the neutral dynamics shape'
);

// attribution: brush override beats pack default, else falls back to the pack
const withOverride = {
	version: 'x',
	packs: [{
		id: 'p', label: 'P', order: 1,
		attribution: { author: 'Pack Author', license: 'unknown' },
		brushes: [
			{ id: 'p-1', label: 'P 1', tip: { src: 'images/brushes/p/1.png', width: 4, height: 4 } },
			{ id: 'p-2', label: 'P 2', tip: { src: 'images/brushes/p/2.png', width: 4, height: 4 }, attribution: { author: 'Solo', license: 'CC0-1.0' } }
		]
	}]
};
BrushLibrary.applyManifest(withOverride);
assert.strictEqual(BrushLibrary.attributionFor('p-1').author, 'Pack Author');
assert.strictEqual(BrushLibrary.attributionFor('p-2').author, 'Solo');
assert.strictEqual(BrushLibrary.attributionFor('p-2').license, 'CC0-1.0');

// validation: colliding id and unknown licence both throw
assert.throws(() => BrushLibrary.applyManifest({
	version: 'x', packs: [{ id: 'q', label: 'Q', order: 1, attribution: { license: 'unknown' },
		brushes: [{ id: 'round', label: 'x', tip: { src: 'images/brushes/x.png', width: 1, height: 1 } }] }]
}), /colliding brush id/);
assert.throws(() => BrushLibrary.applyManifest({
	version: 'x', packs: [{ id: 'q', label: 'Q', order: 1, attribution: { license: 'nope' },
		brushes: [{ id: 'z1', label: 'x', tip: { src: 'images/brushes/x.png', width: 1, height: 1 } }] }]
}), /license/);

BrushLibrary.applyManifest(manifest);

// ---- MaskEditor dynamics helpers ------------------------------------------
const meCtx = {
	console, CONFIG, ShapeLibrary, BrushLibrary, Math, JSON, Object, Array, Number, String, Set, Map, Date,
	document: { getElementById: () => null, querySelectorAll: () => [], createElement: stubCanvas },
	localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
	requestAnimationFrame: () => {},
	ToolType: { BRUSH: 'brush', SELECT: 'select' },
	LayerType: { GLITTER_FILL: 'glitter-fill' }
};
meCtx.window = meCtx; meCtx.globalThis = meCtx;
vm.createContext(meCtx);
vm.runInContext(
	load('js/classes/MaskEditor.js') + '\nthis.maskMulberry32 = maskMulberry32; this.maskClamp = maskClamp; this.MaskEditor = MaskEditor;',
	meCtx, { filename: 'MaskEditor.js' }
);

assert.strictEqual(typeof meCtx.MaskEditor, 'function', 'MaskEditor.js evaluates (static init OK)');
assert(Array.isArray(meCtx.MaskEditor.DYNAMICS_SLIDERS) && meCtx.MaskEditor.DYNAMICS_SLIDERS.length >= 5);
assert.strictEqual(meCtx.MaskEditor.isKnownBrushShape('round'), true);
assert.strictEqual(meCtx.MaskEditor.isKnownBrushShape(someRaster), true);
assert.strictEqual(meCtx.MaskEditor.isKnownBrushShape('not-a-tip'), false);

// clamp
assert.strictEqual(meCtx.maskClamp(5, 0, 3), 3);
assert.strictEqual(meCtx.maskClamp(-1, 0, 3), 0);
assert.strictEqual(meCtx.maskClamp(NaN, 2, 9), 2);

// seeded PRNG: same seed => identical stream; different seed => diverges
const a = meCtx.maskMulberry32(12345);
const b = meCtx.maskMulberry32(12345);
const c = meCtx.maskMulberry32(99999);
const seqA = Array.from({ length: 8 }, () => a());
const seqB = Array.from({ length: 8 }, () => b());
const seqC = Array.from({ length: 8 }, () => c());
assert.deepStrictEqual(seqA, seqB, 'same seed reproduces the scatter stream');
assert.notDeepStrictEqual(seqA, seqC, 'different seed diverges');
assert(seqA.every((v) => v >= 0 && v < 1), 'PRNG stays in [0,1)');

// Photoshop-style jitter bounds: Size Jitter only shrinks and Count Jitter
// never emits more than the configured Count.
const recordedSizes = [];
const stampHarness = {
	_activeTip: () => ({ width: 10, height: 10 }),
	getBrushSize: () => 40,
	getBrushDynamics: () => ({ scatter: 0, bothAxes: true, count: 5, countJitter: 1, sizeJitter: 1, angle: 0, angleJitter: 0, roundness: 1, flipX: false, flipY: false, smoothing: true }),
	_strokeRng: meCtx.maskMulberry32(2468),
	_lastDirX: 1,
	_lastDirY: 0,
	_drawDab: (_a, _b, _tip, _x, _y, size) => recordedSizes.push(size)
};
meCtx.MaskEditor.prototype._stampDynamicDabs.call(stampHarness, {}, {}, 0, 0, 1);
assert(recordedSizes.length >= 1 && recordedSizes.length <= 5, 'jittered dab count stays between 1 and Count');
assert(recordedSizes.every((size) => size >= 1 && size <= 40), 'size jitter never grows beyond brush size');

process.stdout.write('PASS BrushLibrary assets/attribution + MaskEditor dynamics helpers\n');
