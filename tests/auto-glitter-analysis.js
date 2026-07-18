const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const workerSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'workers', 'auto-glitter.worker.js'), 'utf8');
const sharedAnalysisSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'effects', 'palette-analysis.js'), 'utf8');
let response;
let segmentResponses = 0;
const context = {
	Uint8Array,
	Uint8ClampedArray,
	Uint32Array,
	Int32Array,
	Math,
	Set,
	Map,
	self: {
		postMessage(value) {
			response = value;
			if (value.type === 'segmented') segmentResponses++;
		}
	}
};
context.importScripts = () => {
	vm.runInNewContext(sharedAnalysisSource, context, { filename: 'palette-analysis.js' });
	context.GlitterPaletteAnalysis = context.self.GlitterPaletteAnalysis;
};
vm.runInNewContext(workerSource, context, { filename: 'auto-glitter.worker.js' });

const baseOptions = {
	iterations: 12,
	alphaThreshold: 1,
	candidateCount: 24,
	gradientWeight: 18,
	seedChromaWeight: 12,
	seedMaxColorBoost: 3.5,
	mergeDistinctness: 0.045,
	neutralSimilarityScale: 2.333333,
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
	maxSamples: 24000,
	cleanup: {
		aliasDissolve: { enabled: true, maxMixtureDistance: 0.12, minBoundaryShare: 0.55, maxShare: 0.25 },
		despeckle: { enabled: true, absMin: 4, shareMin: 0.00004 }
	}
};

let requestId = 0;
function segment(pixels, width, height, options = baseOptions) {
	context.self.onmessage({ data: { type: 'segment', requestId: ++requestId, pixels: pixels.buffer, width, height, options } });
	assert.strictEqual(response.type, 'segmented', response.error);
	return response;
}

function reduce(colorCount, options = baseOptions, swatches = []) {
	context.self.onmessage({ data: { type: 'reduce', requestId: ++requestId, colorCount, options, swatches } });
	assert.strictEqual(response.type, 'result', response.error);
	return response;
}

function image(width, height, colorAt) {
	const pixels = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) pixels.set([...colorAt(x, y), 255], (y * width + x) * 4);
	}
	return pixels;
}

const width = 100;
const height = 100;
const accentPixels = image(width, height, (x, y) => {
	if (x >= 44 && x < 56 && y >= 44 && y < 56) return [235, 24, 34];
	return x < 50 ? [184, 166, 143] : [150, 132, 112];
});
segment(accentPixels, width, height);
let result = reduce(3, baseOptions, [
	{ id: 'neutral', colors: ['#aa9277'] },
	{ id: 'red', colors: ['#ee1622', '#a6000b'] }
]);
assert.ok(result.palette.length <= 3, 'analysis respects the requested maximum');
const redRegion = result.palette.find(color => color.r > 200 && color.g < 70 && color.b < 70);
assert.ok(redRegion, 'a small connected vivid detail remains in the palette');
assert.strictEqual(redRegion.suggestedGlitterId, 'red', 'the vivid region keeps its closest glitter match');
assert.strictEqual(result.labels.length, width * height, 'every source pixel receives a label');

const segmentsBeforeReuse = segmentResponses;
const threeColorResult = reduce(3, baseOptions, []);
const twoColorResult = reduce(2, baseOptions, []);
assert.strictEqual(segmentResponses, segmentsBeforeReuse, 'successive reductions reuse the cached segment');
assert.ok(threeColorResult.labels.length === width * height && twoColorResult.labels.length === width * height, 'each cached reduction returns a complete label array');
assert.ok(twoColorResult.palette.length <= 2, 'a second reduction honors its new color maximum');

result = reduce(3, baseOptions, [{ id: 'blue', colors: ['#234fd8'] }]);
const hueAdjustedRed = result.palette.find(color => color.r > 200 && color.g < 70 && color.b < 70);
assert.strictEqual(hueAdjustedRed.suggestedGlitterId, 'blue', 'a recolorable glitter can be selected for a vivid region');
assert.ok(Math.abs(hueAdjustedRed.suggestedColorAdjust?.hue || 0) >= 2, 'the suggested glitter hue correction remains visible and editable');

const glyphWidth = 40;
const glyphHeight = 24;
const aaPixels = image(glyphWidth, glyphHeight, (x, y) => {
	const black = x >= 10 && x <= 29 && y >= 6 && y <= 17;
	const ring = x >= 9 && x <= 30 && y >= 5 && y <= 18;
	return black ? [0, 0, 0] : (ring ? [150, 150, 150] : [255, 255, 255]);
});
segment(aaPixels, glyphWidth, glyphHeight);
result = reduce(6);
assert.strictEqual(result.palette.length, 2, 'a grey anti-alias ring dissolves into black and white regions');
assert.ok(result.palette.some(color => color.r < 30) && result.palette.some(color => color.r > 230), 'the glyph and background colors survive alias cleanup');
for (let y = 5; y <= 18; y++) {
	for (let x = 9; x <= 30; x++) assert.notStrictEqual(result.labels[y * glyphWidth + x], 255, 'every anti-alias pixel is absorbed into an endpoint mask');
}

const noiseWidth = 48;
const noiseHeight = 48;
const ditherPixels = image(noiseWidth, noiseHeight, (x, y) => (x % 6 === 0 && y % 6 < 2) ? [244, 174, 40] : [34, 96, 190]);
segment(ditherPixels, noiseWidth, noiseHeight);
result = reduce(6);
assert.strictEqual(result.palette.length, 1, 'ordered 1–2px dither speckles do not survive as a palette color');
assert.ok(result.labels.every(label => label === 0), 'despeckle fills the surrounding mask without holes');

const redPixels = image(60, 30, x => x < 30 ? [220, 30, 42] : [232, 34, 46]);
segment(redPixels, 60, 30);
const separatedRedCount = reduce(6, { ...baseOptions, mergeDistinctness: 0.01 }).palette.length;
result = reduce(6, { ...baseOptions, mergeDistinctness: 0.08 });
assert.strictEqual(result.palette.length, 1, 'nearby reds merge even when the requested maximum has spare room');
assert.ok(result.palette.length < separatedRedCount, 'Combine Similar changes the reduced palette without rerunning segmentation');

const outlinePixels = image(60, 30, x => x < 29 ? [230, 45, 55] : (x < 31 ? [0, 0, 0] : [250, 205, 35]));
segment(outlinePixels, 60, 30);
result = reduce(6);
assert.strictEqual(result.palette.length, 3, 'a connected two-pixel black outline remains its own logical color');
assert.ok(result.palette.some(color => color.r < 20 && color.g < 20 && color.b < 20), 'outline protection keeps black instead of classifying it as a blend');

const bandValues = [70, 85, 100, 115, 130, 145, 160, 175, 190, 205];
const neutralPixels = image(120, 60, x => {
	const value = bandValues[Math.floor(x / 12)];
	return [value, value, value];
});
segment(neutralPixels, 120, 60);
const vibrantCount = reduce(12).palette.length;
const naturalOptions = {
	...baseOptions,
	mergeDistinctness: 0.035,
	neutralSimilarityScale: 1.285714,
	neutralChromaThreshold: 0.05,
	neutralImportance: 1,
	connectedNeutralProtection: 0.9,
	fragmentedSimilarityBoost: 0.15
};
const naturalCount = reduce(12, naturalOptions).palette.length;
assert.ok(vibrantCount < naturalCount, 'Vibrant still combines more neutral shades than Natural');

console.log('auto-glitter analysis checks passed');
