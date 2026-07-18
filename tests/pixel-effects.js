const assert = require('assert');
const PixelEffects = require('../js/effects/pixel-effects.js');

const config = {
	defaults: {
		pixelSize: 1, paletteMode: 'off', colorCount: 4, paletteStyle: 'balanced', mergeDistinctness: 0.045, detail: 2, cleanEdges: true,
		dither: { algorithm: 'bayer', angle: 45, strength: 100, palette: 'bw', duotone: ['#000000', '#ffffff'], shimmer: false }
	},
	limits: { minPixelSize: 1, maxPixelSize: 8, minColors: 2, maxColors: 12 },
	analysis: { iterations: 6, maxSamples: 1000 },
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
	const settings = PixelEffects.normalizeSettings({ paletteMode: 'dither', dither: { ...config.defaults.dither, algorithm } }, config);
	outputs[algorithm] = PixelEffects.applyPixelEffects(source, width, height, settings, config, 0);
	assert.deepStrictEqual([...outputs[algorithm]], [...PixelEffects.applyPixelEffects(source, width, height, settings, config, 0)], `${algorithm} is deterministic`);
	for (let offset = 3; offset < source.length; offset += 4) assert.strictEqual(outputs[algorithm][offset], source[offset], `${algorithm} preserves alpha`);
}
assert.notDeepStrictEqual([...outputs.floyd], [...outputs.atkinson], 'diffusion kernels produce distinct looks');

const shimmer = PixelEffects.normalizeSettings({ paletteMode: 'dither', dither: { ...config.defaults.dither, algorithm: 'bayer', shimmer: true } }, config);
const shimmerOne = PixelEffects.applyPixelEffects(source, width, height, shimmer, config, 1);
const shimmerTwo = PixelEffects.applyPixelEffects(source, width, height, shimmer, config, 2);
assert.notDeepStrictEqual([...shimmerOne], [...shimmerTwo], 'shimmer changes deterministically by frame index');
assert.deepStrictEqual([...shimmerOne], [...PixelEffects.applyPixelEffects(source, width, height, shimmer, config, 1)], 'the same shimmer frame is byte-stable');

const cellDither = PixelEffects.normalizeSettings({ pixelSize: 3, paletteMode: 'dither', dither: { ...config.defaults.dither, algorithm: 'bayer' } }, config);
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
