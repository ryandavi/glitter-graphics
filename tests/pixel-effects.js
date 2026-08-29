const assert = require('assert');
const PixelEffects = require('../js/effects/pixel-effects.js');

const config = {
	defaults: {
		pixelateEnabled: false, paletteEnabled: false, pixelSize: 1, paletteMode: 'posterize', colorCount: 4, paletteStyle: 'balanced', mergeDistinctness: 0.045, detail: 2, cleanEdges: true,
		dither: { algorithm: 'bayer', angle: 45, strength: 100, palette: 'bw', duotone: ['#000000', '#ffffff'], shimmer: false }
	},
	limits: { minPixelSize: 1, maxPixelSize: 8, minColors: 2, maxColors: 12 },
	analysis: { iterations: 6, maxSamples: 1000 },
	animation: { frameDurationMs: 100, algorithms: { bayer: { frames: 8, offsetPerFrame: 13 }, halftone: { frames: 16, offsetPerFrame: 0.5 } } },
	presets: { bw: ['#000000', '#ffffff'], gameboy: ['#0f380f', '#9bbc0f'] }
};

const width = 8;
const height = 8;
const source = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
	const offset = (y * width + x) * 4;
	const value = Math.round((x + y) / 14 * 255);
	source.set([value, 255 - value, value / 2, x === 0 && y === 0 ? 0 : 64 + y * 20], offset);
}

const normalized = PixelEffects.normalizeSettings({}, config);
assert.deepStrictEqual(normalized.dither.duotone, ['#000000', '#ffffff'], 'defaults normalize into independent state');
assert.strictEqual(normalized.dither.scale, 1, 'dither texture scale has a stable one-pixel default');
assert.strictEqual(normalized.dither.edgeProtection, true, 'dither edge protection defaults on');
const normalizedLegacy = PixelEffects.normalizeSettings({ enabled: true, colorCount: 3, mergeDistinctness: 0.08 }, config);
assert.strictEqual(normalizedLegacy.paletteEnabled, true, 'legacy Posterize enabled migrates to an enabled Palette card');
assert.strictEqual(normalizedLegacy.paletteMode, 'posterize', 'legacy Posterize enabled migrates to Palette mode');
const invalid = PixelEffects.normalizeSettings({ pixelSize: 'bad', colorCount: Infinity, mergeDistinctness: NaN, dither: { angle: null, strength: 'nope' } }, config);
assert.strictEqual(invalid.pixelSize, config.defaults.pixelSize, 'invalid Pixel Size returns to CONFIG');
assert.strictEqual(invalid.colorCount, config.defaults.colorCount, 'invalid Colors returns to CONFIG');
assert.strictEqual(invalid.dither.strength, config.defaults.dither.strength, 'invalid dither values return to CONFIG');

const pixelized = PixelEffects.pixelize(source, width, height, 3);
assert.deepStrictEqual([...pixelized.slice(0, 3)], [...pixelized.slice(4, 7)], 'pixelize repeats the sampled RGB across a cell');
assert.strictEqual(pixelized[3], source[3], 'pixelize preserves each source alpha');

const labels = new Uint8Array([0, 1, 255]);
const flattened = PixelEffects.flatten(new Uint8ClampedArray([1, 2, 3, 14, 4, 5, 6, 99, 7, 8, 9, 0]), labels, [[10, 20, 30], [40, 50, 60]]);
assert.deepStrictEqual([...flattened], [10, 20, 30, 14, 40, 50, 60, 99, 0, 0, 0, 0], 'flatten is the canonical labels-plus-palette operation');

const outputs = {};
for (const algorithm of ['bayer', 'floyd', 'atkinson', 'halftone']) {
	const settings = PixelEffects.normalizeSettings({ paletteEnabled: true, paletteMode: 'dither', dither: { ...config.defaults.dither, algorithm } }, config);
	outputs[algorithm] = PixelEffects.applyPixelEffects(source, width, height, settings, config, 0);
	assert.deepStrictEqual([...outputs[algorithm]], [...PixelEffects.applyPixelEffects(source, width, height, settings, config, 0)], `${algorithm} is deterministic`);
	for (let offset = 3; offset < source.length; offset += 4) assert.strictEqual(outputs[algorithm][offset], source[offset], `${algorithm} preserves alpha`);
}
assert.notDeepStrictEqual([...outputs.floyd], [...outputs.atkinson], 'diffusion kernels produce distinct looks');

const shimmer = PixelEffects.normalizeSettings({ paletteEnabled: true, paletteMode: 'dither', dither: { ...config.defaults.dither, algorithm: 'bayer', shimmer: true } }, config);
const shimmerOne = PixelEffects.applyPixelEffects(source, width, height, shimmer, config, 1);
const shimmerTwo = PixelEffects.applyPixelEffects(source, width, height, shimmer, config, 2);
assert.notDeepStrictEqual([...shimmerOne], [...shimmerTwo], 'shimmer changes deterministically by frame index');
assert.deepStrictEqual([...shimmerOne], [...PixelEffects.applyPixelEffects(source, width, height, shimmer, config, 1)], 'the same shimmer frame is byte-stable');
const halftoneShimmer = PixelEffects.normalizeSettings({ paletteEnabled: true, paletteMode: 'dither', dither: { ...config.defaults.dither, algorithm: 'halftone', shimmer: true } }, config);
const halftoneStart = PixelEffects.applyPixelEffects(source, width, height, halftoneShimmer, config, 0);
assert.notDeepStrictEqual(
	[...PixelEffects.applyPixelEffects(source, width, height, halftoneShimmer, config, 1)],
	[...PixelEffects.applyPixelEffects(source, width, height, halftoneShimmer, config, 2)],
	'halftone shimmer changes by frame index'
);
assert.deepStrictEqual(
	[...halftoneStart],
	[...PixelEffects.applyPixelEffects(source, width, height, halftoneShimmer, config, config.animation.algorithms.halftone.frames)],
	'halftone shimmer closes exactly after its configured cycle'
);
assert.deepStrictEqual(
	[...PixelEffects.applyPixelEffects(source, width, height, shimmer, config, 0)],
	[...PixelEffects.applyPixelEffects(source, width, height, shimmer, config, config.animation.algorithms.bayer.frames)],
	'bayer shimmer closes exactly after its configured cycle'
);
const diffusionShimmer = PixelEffects.normalizeSettings({ paletteEnabled: true, paletteMode: 'dither', dither: { ...config.defaults.dither, algorithm: 'floyd', shimmer: true } }, config);
assert.deepStrictEqual(
	[...PixelEffects.applyPixelEffects(source, width, height, diffusionShimmer, config, 1)],
	[...PixelEffects.applyPixelEffects(source, width, height, diffusionShimmer, config, 2)],
	'diffusion dithering remains stable across frame indexes'
);
const disabled = PixelEffects.normalizeSettings({ enabled: false, pixelSize: 4, paletteMode: 'dither', dither: { ...config.defaults.dither, shimmer: true } }, config);
assert.deepStrictEqual(
	[...PixelEffects.applyPixelEffects(source, width, height, disabled, config, 3)],
	[...source],
	'disabling both effect cards bypasses Pixelate, Palette, and Shimmer without changing their settings'
);

const paletteOnlyLargeSavedSize = PixelEffects.normalizeSettings({ pixelateEnabled: false, paletteEnabled: true, pixelSize: 4, paletteMode: 'dither' }, config);
const paletteOnlyUnitSize = PixelEffects.normalizeSettings({ pixelateEnabled: false, paletteEnabled: true, pixelSize: 1, paletteMode: 'dither' }, config);
assert.deepStrictEqual(
	[...PixelEffects.applyPixelEffects(source, width, height, paletteOnlyLargeSavedSize, config, 0)],
	[...PixelEffects.applyPixelEffects(source, width, height, paletteOnlyUnitSize, config, 0)],
	'disabled Pixelate does not leak its saved cell size into Palette'
);

const cellDither = PixelEffects.normalizeSettings({ pixelateEnabled: true, paletteEnabled: true, pixelSize: 3, paletteMode: 'dither', dither: { ...config.defaults.dither, algorithm: 'bayer' } }, config);
const cellOutput = PixelEffects.applyPixelEffects(source, width, height, cellDither, config, 0);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
	const cellX = Math.floor(x / 3) * 3;
	const cellY = Math.floor(y / 3) * 3;
	const offset = (y * width + x) * 4;
	const cellOffset = (cellY * width + cellX) * 4;
	assert.deepStrictEqual([...cellOutput.slice(offset, offset + 3)], [...cellOutput.slice(cellOffset, cellOffset + 3)], 'dither Pixel Size produces crisp RGB cells');
	assert.strictEqual(cellOutput[offset + 3], source[offset + 3], 'dither cells retain each source alpha');
}

console.log('pixel effects checks passed');
