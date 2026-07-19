const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const PaletteAnalysis = require('../js/effects/palette-analysis.js');
const PixelEffects = require('../js/effects/pixel-effects.js');

const messages = [];
const context = {
	GlitterPaletteAnalysis: PaletteAnalysis,
	GlitterPixelEffects: PixelEffects,
	Uint8ClampedArray,
	importScripts() {},
	self: { postMessage: (message) => messages.push(message) }
};
vm.runInNewContext(fs.readFileSync('js/workers/pixel-effects.worker.js', 'utf8'), context);

const width = 16;
const height = 16;
const source = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
	const offset = (y * width + x) * 4;
	const value = Math.round(((x + y) / (width + height - 2)) * 255);
	source.set([value, value, value, 255], offset);
}
const pixelConfig = {
	defaults: {
		pixelateEnabled: false, paletteEnabled: false, pixelSize: 1, paletteMode: 'posterize', colorCount: 4, paletteStyle: 'balanced', mergeDistinctness: 0.045, detail: 2, cleanEdges: true,
		dither: { algorithm: 'bayer', angle: 45, strength: 100, palette: 'bw', duotone: ['#000000', '#ffffff'], shimmer: false }
	},
	limits: { minPixelSize: 1, maxPixelSize: 8, minColors: 2, maxColors: 12 },
	analysis: { iterations: 6, maxSamples: 1000 },
	animation: { frameDurationMs: 100, algorithms: { bayer: { frames: 8, offsetPerFrame: 13 }, halftone: { frames: 16, offsetPerFrame: 0.5 } } },
	presets: { bw: ['#000000', '#ffffff'] }
};
const settings = PixelEffects.normalizeSettings({
	paletteEnabled: true,
	paletteMode: 'dither',
	dither: { ...pixelConfig.defaults.dither, shimmer: true }
}, pixelConfig);
const config = { pixelEffects: pixelConfig };

context.self.onmessage({ data: {
	requestId: 'initial', animationKey: 'preview-session', pixels: source.buffer.slice(0),
	width, height, settings, config, frameIndex: 0
} });
context.self.onmessage({ data: { requestId: 'next', animationKey: 'preview-session', frameIndex: 1 } });

assert.strictEqual(messages[0].requestId, 'initial');
assert.strictEqual(messages[1].requestId, 'next');
assert.notDeepStrictEqual(
	[...new Uint8ClampedArray(messages[0].pixels)],
	[...new Uint8ClampedArray(messages[1].pixels)],
	'the retained worker session renders the next Shimmer phase without another source transfer'
);

context.self.onmessage({ data: { clearAnimation: true } });
context.self.onmessage({ data: { requestId: 'expired', animationKey: 'preview-session', frameIndex: 2 } });
assert.ok(messages.at(-1).error, 'cleared Shimmer sessions reject stale frame requests');

console.log('shimmer preview worker checks passed');
