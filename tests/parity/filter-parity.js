const assert = require('assert');

global.CONFIG = {
	tools: {
		pixelEffects: {
			defaults: { pixelateEnabled: false, paletteEnabled: false, pixelSize: 1, paletteMode: 'posterize', colorCount: 4, paletteStyle: 'balanced', mergeDistinctness: 0.045, detail: 2, cleanEdges: true, dither: { algorithm: 'bayer', angle: 45, strength: 100, scale: 1, edgeProtection: true, serpentine: true, palette: 'bw', duotone: ['#000000', '#ffffff'], shimmer: false } },
			limits: { minPixelSize: 1, maxPixelSize: 8, minColors: 2, maxColors: 24 }, analysis: { maxSamples: 100, iterations: 2 }, presets: { bw: ['#000000', '#ffffff'] }, animation: { algorithms: {} }
		},
		filter: {
			defaultType: 'basic',
			tintPresets: {
				'warming-85': { label: 'Warming Filter (85)', color: '#ec8a00' },
				'warming-81': { label: 'Warming Filter (81)', color: '#efb45a' },
				'cooling-80': { label: 'Cooling Filter (80)', color: '#006dff' },
				'cooling-82': { label: 'Cooling Filter (82)', color: '#00b5ff' },
				sepia: { label: 'Sepia', color: '#ac7a33' },
				deepBlue: { label: 'Deep Blue', color: '#1c3f95' },
				deepEmerald: { label: 'Deep Emerald', color: '#009e6c' },
				custom: { label: 'Custom', color: null }
			},
			nameCaption: { fontPx: 28, minFontPx: 16, fontFamily: 'sans-serif', color: '#fff', shadow: { color: '#0008', offsetX: 0, offsetY: 1, blur: 2 }, maxWidthFraction: 0.6 },
			grainTilePx: 256
		}
	}
};
global.ImageData = class ImageData { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };

const Blend = require('../../js/effects/blend-modes.js');
const Fields = require('../../js/core/fields.js');
const Tone = require('../../js/effects/tone-adjust.js');
const Grain = require('../../js/effects/grain.js');
const Blur = require('../../js/effects/blur.js');
const Presets = require('../../js/effects/filter-presets.js');
const PresetLibrary = require('../../js/ui/preset-library.js');
const Ops = require('../../js/effects/filter-ops.js');
const Filters = require('../../js/effects/filters.js');
const Filter = require('../../js/effects/filter.js');

assert.strictEqual(Blend.cssToGCO('normal'), 'source-over');
assert.strictEqual(Blend.normalize('screen'), 'screen');
assert.strictEqual(Blend.normalize('not-a-mode'), 'normal');
assert.strictEqual(Blend.forLayer({ blendMode: 'multiply' }), 'multiply');
assert.strictEqual(Blend.forLayer({ stickerData: { blendMode: 'overlay' } }), 'overlay');
assert.strictEqual(Blend.forLayer({ blendMode: 'invalid', stickerData: { blendMode: 'screen' } }), 'normal');
const colorBurnBackdrop = { data: new Uint8ClampedArray([255, 79, 163, 255, 57, 255, 20, 255]) };
const colorBurnSource = { data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]) };
Blend.compositeColorBurn(colorBurnBackdrop, colorBurnSource);
assert.deepStrictEqual(Array.from(colorBurnBackdrop.data), [0, 0, 0, 255, 57, 255, 20, 255]);
assert.deepStrictEqual(Array.from(Tone.composeToneAffine(null).m), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
assert.strictEqual(Filter.normalizeFilterData({}).type, 'basic');
assert.deepStrictEqual(Filter.FILTER_TYPES, ['basic', 'invert', 'grayscale', 'sepia', 'tint', 'vignette', 'grain', 'blur', 'instagram', 'scanlines', 'light-leak', 'dreamy-glow', 'jpeg-crunch', 'deep-fry', 'pixelate', 'posterize', 'dither', 'rgb-split', 'gradient-map']);
assert.strictEqual(Filter.normalizeFilterData({ type: 'instagram' }).presetId, 'rio');
assert.strictEqual(Object.keys(Presets)[0], 'rio');

const identityPixel = { width: 1, height: 1, data: new Uint8ClampedArray([12, 34, 56, 78]) };
Tone.applyToneToImageData(identityPixel, null);
assert.deepStrictEqual(Array.from(identityPixel.data), [12, 34, 56, 78]);
Tone.applyToneToImageData(identityPixel, { invert: 1 });
assert.deepStrictEqual(Array.from(identityPixel.data), [243, 221, 199, 78]);

for (const [id, preset] of Object.entries(Presets)) {
	const data = Filter.normalizeFilterData({ type: 'instagram', presetId: id, showName: true, strength: 0 });
	assert.strictEqual(data.strength, 0);
	const resolved = Filter.resolve(data);
	assert(Tone.isIdentityTone(resolved.tone), `${id} strength zero must resolve to identity tone`);
	assert(resolved.ops.every((op) => op.opacity === 0), `${id} strength zero must suppress overlays`);
	assert.strictEqual(resolved.caption, preset.name || preset.instagramName);
	preset.ops.forEach((op) => assert(Blend.isBlendMode(op.mode), `${id} has invalid blend mode ${op.mode}`));
}

for (const type of Filter.FILTER_TYPES) {
	const normalized = Filter.normalizeFilterData({ type });
	assert.strictEqual(normalized.type, type);
	const resolved = Filter.resolve(normalized);
	assert(Array.isArray(resolved.ops));
	assert(Object.hasOwn(resolved, 'tone'));
	assert(Object.hasOwn(resolved, 'blur'));
}

for (const op of Ops.list()) {
	assert(op.id && op.params, 'filter ops require id and params');
	assert.strictEqual(typeof op.pixel, 'function', `${op.id} requires a pixel painter`);
}
for (const entry of Filters.list()) {
	assert(entry.id && entry.label && entry.group && entry.fields && entry.recipe, 'filter entries must conform');
	Object.values(entry.fields).forEach((field) => {
		if (field.kind === 'number') assert.strictEqual(field.spec, Fields[field.specId], `${entry.id}.${field.specId} must resolve through FIELDS`);
	});
	const normalized = Filters.normalize(entry.id);
	for (const recipeStep of Filters.recipe(normalized)) assert(Ops.get(recipeStep.op), `${entry.id} uses unknown op ${recipeStep.op}`);
	assert.strictEqual(Filters.tier(normalized), ['jpeg-crunch', 'deep-fry', 'pixelate', 'posterize', 'dither', 'rgb-split', 'gradient-map'].includes(entry.id) ? 3 : 1, `${entry.id} has the wrong render tier`);
}
for (const library of PresetLibrary.listPresetLibraries()) {
	assert(library.id && library.entries.length, 'preset libraries require entries');
	library.entries.forEach((entry) => assert.strictEqual(library.get(entry.id), entry));
}
assert.strictEqual(Filters.looksLibrary.get('instagram'), null, 'Instagram must not render as a standalone look');
assert.strictEqual(Filters.looksLibrary.groups.at(-1).label, 'Instagram', 'Instagram must be the last Looks group');
for (const [presetId, preset] of Object.entries(Presets)) {
	const entry = Filters.looksLibrary.get(`instagram:${presetId}`);
	assert(entry, `${presetId} must resolve to a Looks entry`);
	assert.strictEqual(entry.label, preset.name || preset.instagramName);
	assert.deepStrictEqual(entry.value, { type: 'instagram', presetId });
}
const applied = Filters.looksLibrary.apply('scanlines');
applied.type = 'mutated';
assert.strictEqual(Filters.looksLibrary.get('scanlines').value.type, 'scanlines', 'preset values must be copied on apply');
const appliedInstagram = Filters.looksLibrary.apply('instagram:clarendon');
appliedInstagram.presetId = 'mutated';
assert.strictEqual(Filters.looksLibrary.get('instagram:clarendon').value.presetId, 'clarendon', 'Instagram look values must be copied on apply');

assert.strictEqual(Filter.toneCssFilter({ type: 'basic' }), '');
assert.strictEqual(
	Filter.toneCssFilter({ type: 'instagram', presetId: 'rise', strength: 100 }),
	'brightness(1.05) sepia(0.2) contrast(0.9) saturate(0.9)'
);
assert.strictEqual(
	Filter.toneCssFilter({ type: 'instagram', presetId: 'f1977', strength: 100 }),
	'contrast(1.1) brightness(1.1) saturate(1.3)'
);
assert.strictEqual(Presets.rio.instagramName, 'Rio de Janeiro');
assert.strictEqual(Presets.rio.ops.some((op) => op.kind === 'fill'), false);
assert.deepStrictEqual(Presets.rio.tone, { brightness: 1, contrast: 1.3, saturate: 0.9 });
assert.deepStrictEqual(Presets.rio.ops.map((op) => [op.mode, op.opacity, op.gradient.angle, op.gradient.stops.length]), [
	['screen', 0.3, 160, 12], ['lighten', 0.3, 160, 12]
]);
assert.deepStrictEqual(Presets.rio.ops[0].gradient.stops, Presets.rio.ops[1].gradient.stops);
assert.deepStrictEqual(Presets.rio.ops[0].gradient.stops.map((entry) => entry.color), [
	'#4a48b1', '#6740a6', '#7b379a', '#8a2e8d', '#95267f', '#9f2273',
	'#a62167', '#ab235b', '#b12b4f', '#b33643', '#b34238', '#b14e2e'
]);
Presets.rio.ops[0].gradient.stops.forEach((entry, index) => assert.strictEqual(entry.at, index / 11));
const xProStyles = Filter.overlayLayerStyles({ type: 'instagram', presetId: 'crossprocess', strength: 100 });
const xProGradient = xProStyles.find((style) => style.className === 'filter-layer-gradient');
assert(xProGradient.style.backgroundImage.includes('circle farthest-corner'), 'preset radial gradients must preserve a circle on non-square images');
assert(xProGradient.style.backgroundImage.includes('110%'), 'gradient stops beyond the image edge must be preserved');
assert.strictEqual(xProStyles.at(-1).className, 'filter-layer-backdrop', 'tone adjustment must run after CSSgram blend layers');
const tintStyles = Filter.overlayLayerStyles({ type: 'tint', color: '#ff0000', mode: 'soft-light', amount: 100 });
assert.strictEqual(tintStyles[0].style.mixBlendMode, 'soft-light');
assert.strictEqual(tintStyles[0].style.opacity, 1);
assert.strictEqual(Filter.normalizeFilterData({ type: 'tint', mode: 'multiply' }).mode, 'soft-light');
assert.strictEqual(Filter.normalizeFilterData({ type: 'tint' }).presetId, 'warming-85');
assert.strictEqual(Filter.normalizeFilterData({ type: 'tint', presetId: 'cooling-80' }).color, '#006dff');
assert.strictEqual(Filter.normalizeFilterData({ type: 'tint', color: '#ff0000' }).presetId, 'custom');
assert.strictEqual(Filter.summaryText({ type: 'basic', brightness: 100 }), 'Basic');
assert.strictEqual(Filter.summaryText({ type: 'blur', radius: 24 }), 'Blur');
assert.strictEqual(Filter.summaryText({ type: 'instagram', presetId: 'rio' }), 'Rio de Janeiro');
assert.strictEqual(Filter.summaryText({ type: 'tint', presetId: 'warming-85' }), 'Warming Filter (85)');
assert.strictEqual(Filter.summaryText({ type: 'tint', presetId: 'custom', color: '#ffffff' }), 'Custom Tint');
assert.strictEqual(Filter.summaryText({ type: 'scanlines' }), 'Scanlines');
assert(Filter.gradientCss(Filter.resolve({ type: 'scanlines' }).ops[0].gradient).startsWith('repeating-linear-gradient('));
assert.strictEqual(Filter.resolve({ type: 'scanlines', spacing: 8 }).ops[0].gradient.size, 8);
assert.strictEqual(Filter.isActive({ type: 'scanlines', strength: 0 }), false);
assert.strictEqual(Filters.recipe({ type: 'deep-fry', level: 'nuclear' }).at(-1).params.generations, 3);
assert.strictEqual(Filters.recipe({ type: 'jpeg-crunch', quality: 17 }).at(-1).params.quality, 17);
const splitFixture = new ImageData(new Uint8ClampedArray([10, 20, 30, 255, 100, 110, 120, 255, 200, 210, 220, 255]), 3, 1);
Ops.get('rgbSplit').pixel(splitFixture, { offset: 1 });
assert.deepStrictEqual(Array.from(splitFixture.data), [10, 20, 120, 255, 10, 110, 220, 255, 100, 210, 220, 255]);
const mapFixture = new ImageData(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1);
Ops.get('gradientMap').pixel(mapFixture, { stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] });
assert.deepStrictEqual(Array.from(mapFixture.data), [255, 0, 0, 255, 0, 0, 255, 255]);
assert.strictEqual(Filter.resolve({ type: 'light-leak' }).ops.length, 2);
assert(Math.abs(Filter.resolve({ type: 'light-leak', size: 140 }).ops[0].gradient.radius - 1.05) < 1e-9);
assert.deepStrictEqual(
	[Filter.resolve({ type: 'dreamy-glow' }).ops[0].kind, Filter.resolve({ type: 'dreamy-glow' }).ops[0].mode],
	['blur', 'normal']
);
assert.strictEqual(Filter.resolve({ type: 'vignette', color: '#ffffff' }).ops[0].mode, 'screen');
assert.strictEqual(Filter.resolve({ type: 'vignette', color: '#000000' }).ops[0].mode, 'multiply');
assert.strictEqual(Grain.isIdentityGrain({ amount: 0 }), true);
assert.deepStrictEqual(Array.from(Grain.createNoise({ roughness: 0.5 }, 'fixed', 4)), Array.from(Grain.createNoise({ roughness: 0.5 }, 'fixed', 4)));
assert.notStrictEqual(Grain.tileSignature({ size: 10 }, 'fixed'), Grain.tileSignature({ size: 80 }, 'fixed'));

// Posterize/Dither carry the controls the old canvas Palette card had.
const legacyDither = Filter.normalizeFilterData({ type: 'dither', colors: 4 });
assert.deepStrictEqual([legacyDither.palette, legacyDither.pixelSize, legacyDither.shimmer, legacyDither.colors], ['auto', 1, false, 4]);
const ditherFields = Filters.get('dither').fields;
assert.strictEqual(ditherFields.duotoneDark.when(legacyDither), false);
assert.strictEqual(ditherFields.duotoneDark.when({ ...legacyDither, palette: 'duotone' }), true);
assert.strictEqual(ditherFields.colors.when({ ...legacyDither, palette: 'gameboy' }), false);
assert.strictEqual(ditherFields.angle.when({ ...legacyDither, algorithm: 'halftone' }), true);
assert.deepStrictEqual(Filters.recipe({ type: 'dither', palette: 'duotone', duotoneDark: '#112233' })[0].params.duotone, ['#112233', '#ffffff']);
assert.deepStrictEqual(Object.keys(Filter.normalizeFilterData({ type: 'posterize' })).sort(), ['cleanEdges', 'colors', 'detail', 'merge', 'pixelSize', 'style', 'type']);
const pixelContext = {
	pixelDefaults: GlitterPixelEffects.normalizeSettings({}, CONFIG.tools.pixelEffects),
	pixelConfig: { pixelEffects: CONFIG.tools.pixelEffects }
};
const mosaicPixels = new Uint8ClampedArray(4 * 4 * 4);
for (let index = 0; index < 16; index++) mosaicPixels.set([(index * 53) % 256, (index * 97) % 256, (index * 31) % 256, 255], index * 4);
['posterize', 'dither'].forEach((type) => {
	const mosaic = new ImageData(new Uint8ClampedArray(mosaicPixels), 4, 4);
	Ops.get(type).pixel(mosaic, Filters.recipe({ type, pixelSize: 2, palette: 'bw' })[0].params, pixelContext);
	const at = (x, y) => Array.from(mosaic.data.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)).join();
	[[0, 0], [2, 0], [0, 2], [2, 2]].forEach(([x, y]) => {
		assert(at(x, y) === at(x + 1, y) && at(x, y) === at(x, y + 1) && at(x, y) === at(x + 1, y + 1), `${type} Pixel Size must paint whole 2x2 cells`);
	});
});

const noBlur = { width: 3, height: 3, data: new Uint8ClampedArray(3 * 3 * 4) };
for (let index = 3; index < noBlur.data.length; index += 4) noBlur.data[index] = 255;
noBlur.data[16] = 255;
const unchanged = Array.from(noBlur.data);
Blur.applyBlurToImageData(noBlur, 0);
assert.deepStrictEqual(Array.from(noBlur.data), unchanged);
Blur.applyBlurToImageData(noBlur, 1);
assert(noBlur.data[0] > 0 || noBlur.data[4] > 0 || noBlur.data[12] > 0, 'blur must spread a bright pixel');
assert(Math.abs(noBlur.data.filter((value, index) => index % 4 === 0).reduce((sum, value) => sum + value, 0) - 255) <= 3, 'blur must preserve channel energy');

console.log(`filter-parity: ${Object.keys(Presets).length} presets, ${Ops.list().length} ops and ${Filter.FILTER_TYPES.length} looks passed`);
