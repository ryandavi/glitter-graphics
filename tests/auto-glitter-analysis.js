const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const workerSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'workers', 'auto-glitter.worker.js'), 'utf8');
let response;
const context = {
	Uint8Array,
	Uint8ClampedArray,
	Uint32Array,
	Math,
	Set,
	Map,
	self: {
		postMessage(value) {
			response = value;
		}
	}
};
vm.runInNewContext(workerSource, context, { filename: 'auto-glitter.worker.js' });

const width = 100;
const height = 100;
const pixels = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) {
	for (let x = 0; x < width; x++) {
		const offset = (y * width + x) * 4;
		const neutral = x < 50 ? [184, 166, 143] : [150, 132, 112];
		const color = x >= 44 && x < 56 && y >= 44 && y < 56 ? [235, 24, 34] : neutral;
		pixels.set([...color, 255], offset);
	}
}


const analysisOptions = {
	iterations: 12,
	alphaThreshold: 1,
	similarityThreshold: 0.045,
	neutralSimilarityThreshold: 0.105,
	neutralChromaThreshold: 0.075,
	chromaWeight: 12,
	maxColorBoost: 3.5,
	neutralImportance: 0.62,
	coherenceBase: 0.4,
	coherenceScale: 0.75,
	connectedAreaWeight: 4,
	maxConnectedBoost: 1,
	connectedNeutralProtection: 0.65,
	fragmentedSimilarityBoost: 0.6,
	hueMinChroma: 0.04,
	maxHueShift: 20,
	componentDensityBase: 0.55,
	componentDensityScale: 0.45,
	highlightLightness: 0.84,
	highlightImportanceBoost: 1.2,
	highlightMergeScale: 0.55,
	swatchPrimaryWeight: 0.75,
	tuneGlitterHue: true,
	candidateMultiplier: 2,
	candidatePadding: 4,
	maxSamples: 24000
};

context.self.onmessage({
	data: {
		pixels: pixels.buffer,
		width,
		height,
		colorCount: 3,
		options: analysisOptions,
		swatches: [
			{ id: 'neutral', colors: ['#aa9277'] },
			{ id: 'red', colors: ['#ee1622', '#a6000b'] }
		]
	}
});

assert.ok(!response.error, response.error);
assert.ok(response.palette.length <= 3, 'analysis respects the requested layer limit');
const redRegion = response.palette.find((color) => color.r > 200 && color.g < 70 && color.b < 70);
assert.ok(redRegion, 'a small, concentrated red detail remains in the palette');
assert.strictEqual(redRegion.suggestedGlitterId, 'red', 'the vivid region keeps its independently closest glitter match');
assert.strictEqual(response.labels.length, width * height, 'every source pixel receives a label');

context.self.onmessage({
	data: {
		pixels: pixels.slice().buffer,
		width,
		height,
		colorCount: 3,
		options: analysisOptions,
		swatches: [{ id: 'blue', colors: ['#234fd8'] }]
	}
});
const hueAdjustedRed = response.palette.find((color) => color.r > 200 && color.g < 70 && color.b < 70);
assert.strictEqual(hueAdjustedRed.suggestedGlitterId, 'blue', 'a recolorable glitter can still be selected for the vivid region');
const hueCorrection = Math.abs(hueAdjustedRed.suggestedColorAdjust?.hue || 0);
assert.ok(hueCorrection >= 2 && hueCorrection <= 20, 'the Advanced hue adjustment stays small but meaningful');

const creamPixels = new Uint8ClampedArray(20 * 20 * 4);
for (let offset = 0; offset < creamPixels.length; offset += 4) creamPixels.set([238, 232, 222, 255], offset);
context.self.onmessage({
	data: {
		pixels: creamPixels.buffer,
		width: 20,
		height: 20,
		colorCount: 2,
		options: analysisOptions,
		swatches: [
			{ id: 'dusty-pink', colors: ['#EF9C99', '#E16871', '#FF00CF', '#FFFFFF', '#FF30E5'] },
			{ id: 'white', colors: ['#F8F8F5', '#D8D6D0'] }
		]
	}
});
assert.strictEqual(response.palette[0].suggestedGlitterId, 'white', 'a white sparkle inside a pink glitter does not make that glitter a cream match');

const highlightPixels = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) {
	for (let x = 0; x < width; x++) {
		const color = x < 28 ? [250, 249, 247]
			: x < 48 ? [224, 211, 198]
				: x < 68 ? [126, 86, 70]
					: x < 83 ? [48, 38, 32]
						: x < 93 ? [226, 42, 198]
							: [224, 28, 36];
		highlightPixels.set([...color, 255], (y * width + x) * 4);
	}
}
context.self.onmessage({
	data: {
		pixels: highlightPixels.buffer,
		width,
		height,
		colorCount: 5,
		options: analysisOptions,
		swatches: []
	}
});
assert.ok(response.palette.some((color) => color.r > 240 && color.g > 240 && color.b > 240), 'a large connected white region survives a colorful five-layer reduction');

const bandWidth = 12;
const bandValues = [70, 85, 100, 115, 130, 145, 160, 175, 190, 205];
const neutralPixels = new Uint8ClampedArray(bandWidth * bandValues.length * height * 4);
for (let y = 0; y < height; y++) {
	for (let x = 0; x < bandWidth * bandValues.length; x++) {
		const value = bandValues[Math.floor(x / bandWidth)];
		const offset = (y * bandWidth * bandValues.length + x) * 4;
		neutralPixels.set([value, value, value, 255], offset);
	}
}
const analyzeNeutralBands = (options) => {
	context.self.onmessage({
		data: {
			pixels: neutralPixels.slice().buffer,
			width: bandWidth * bandValues.length,
			height,
			colorCount: 12,
			options,
			swatches: []
		}
	});
	return response.palette.length;
};
const vibrantNeutralCount = analyzeNeutralBands(analysisOptions);
const naturalNeutralCount = analyzeNeutralBands({
	...analysisOptions,
	similarityThreshold: 0.035,
	neutralSimilarityThreshold: 0.045,
	neutralChromaThreshold: 0.05,
	chromaWeight: 4,
	maxColorBoost: 1,
	neutralImportance: 1,
	coherenceBase: 0.65,
	coherenceScale: 0.5,
	connectedAreaWeight: 2,
	maxConnectedBoost: 0.5,
	connectedNeutralProtection: 0.9,
	fragmentedSimilarityBoost: 0.15
});
assert.ok(vibrantNeutralCount < naturalNeutralCount, 'Vibrant combines more nearby neutral shades than Natural');

const topologyPixels = new Uint8ClampedArray(width * height * 4);
for (let offset = 0; offset < topologyPixels.length; offset += 4) topologyPixels.set([145, 145, 145, 255], offset);
for (let y = 10; y < 30; y++) {
	for (let x = 10; x < 30; x++) topologyPixels.set([235, 24, 34, 255], (y * width + x) * 4);
}
for (let y = 2; y < height; y += 5) {
	for (let x = 2; x < width; x += 5) topologyPixels.set([30, 75, 225, 255], (y * width + x) * 4);
}
context.self.onmessage({
	data: {
		pixels: topologyPixels.buffer,
		width,
		height,
		colorCount: 2,
		options: analysisOptions,
		swatches: []
	}
});
assert.ok(response.palette.some((color) => color.r > 200 && color.g < 70), 'a connected accent survives the final palette reduction');
assert.ok(!response.palette.some((color) => color.b > 180 && color.r < 80), 'equally sized scattered edge-like pixels do not displace a connected accent');

console.log('Auto Glitter analysis verification passed.');
