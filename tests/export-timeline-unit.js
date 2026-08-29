'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

class ImageDataPolyfill {
	constructor(data, width, height) {
		this.data = data;
		this.width = width;
		this.height = height;
	}
}

const context = { ImageData: ImageDataPolyfill, Uint8ClampedArray, Map, Set, Math, Number, Infinity };
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'classes', 'ExportTimeline.js'), 'utf8');
vm.runInContext(`${source}\nglobalThis.timelineExports = { AnimationSourceTimeline, CompositeFrameReducer, CompositeTimelinePlanner };`, context);
const { AnimationSourceTimeline, CompositeFrameReducer, CompositeTimelinePlanner } = context.timelineExports;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function frame(value, alpha = 255, size = 2) {
	const data = new Uint8ClampedArray(size * size * 4);
	for (let index = 0; index < data.length; index += 4) {
		data[index] = value;
		data[index + 1] = value;
		data[index + 2] = value;
		data[index + 3] = alpha;
	}
	return new ImageDataPolyfill(data, size, size);
}

function timeline(key, count, durations) {
	return new AnimationSourceTimeline({
		key,
		frames: Array.from({ length: count }, (_, index) => frame(index)),
		frameDurations: durations
	});
}

async function buildPlan(timelines, overrides = {}) {
	const planner = new CompositeTimelinePlanner();
	return planner.plan({
		timelines,
		fallbackDuration: 100,
		maxLoopDurationMs: 12000,
		maxSamplingFps: 30,
		manualFrameSkip: 1,
		reverse: false,
		smartReduction: false,
		visualErrorThreshold: 0.008,
		preferredFrameBudget: 1000,
		hardFrameLimit: 1000,
		renderFrame: (_, selection) => {
			const value = [...selection.values()].reduce((sum, selected) => sum + selected.frameIndex, 0);
			return frame(value);
		},
		...overrides
	});
}

async function main() {
	const constant = timeline('constant', 4, [100, 100, 100, 100]);
	assert(constant.frameIndexAt(0) === 0 && constant.frameIndexAt(399) === 3 && constant.frameIndexAt(400) === 0,
		'Constant-rate source lookup failed.');

	const variable = timeline('variable', 3, [50, 150, 300]);
	assert(variable.frameIndexAt(49) === 0 && variable.frameIndexAt(50) === 1 && variable.frameIndexAt(200) === 2,
		'Variable-rate source lookup failed.');

	const sevenEleven = await buildPlan([
		timeline('sticker', 7, Array(7).fill(100)),
		timeline('glitter:fill', 11, Array(11).fill(100))
	]);
	assert(sevenEleven.totalDuration === 7700 && sevenEleven.loopSeam.exact && sevenEleven.frames.length === 77,
		'7/11-frame sources did not produce their clean 77-sample loop.');

	const longCommonLoop = await buildPlan([
		timeline('twenty-four', 24, Array(24).fill(40)),
		timeline('twenty-five', 25, Array(25).fill(40))
	]);
	assert(!longCommonLoop.loopSeam.exact && longCommonLoop.totalDuration <= 12000,
		'Long exact common loop was not bounded with a reported seam decision.');

	const effects = await buildPlan([
		timeline('sticker', 3, [80, 120, 100]),
		timeline('sticker:shadow', 2, [150, 150]),
		timeline('text:border', 2, [100, 200])
	]);
	assert(effects.sourceFrameSelections.size === 3 && effects.loopSeam.exact,
		'Sticker and multiple effect-slot timelines were not planned together.');

	const sampled = await buildPlan([timeline('manual', 4, [100, 100, 100, 100])], {
		manualFrameSkip: 2,
		reverse: true
	});
	assert(sampled.frames.length === 2 && sampled.frameDurations.every((duration) => duration === 200),
		'Manual sampling did not preserve duration.');
	assert(sampled.sourceFrameSelections.get('manual').join(',') === '2,0', 'Reverse did not reverse the sampled frame order.');
	for (let every = 1; every <= 4; every++) {
		const samplingPlan = await buildPlan([timeline(`skip-${every}`, 4, [100, 100, 100, 100])], {
			manualFrameSkip: every
		});
		assert(samplingPlan.frames.length === Math.ceil(4 / every) && samplingPlan.totalDuration === 400,
			`Manual sampling value ${every} did not preserve its frame count and duration.`);
	}

	const reducer = new CompositeFrameReducer();
	const exact = frame(20);
	const exactResult = reducer.reduce({
		frames: [exact, frame(20), frame(80)],
		frameDurations: [100, 150, 200],
		selections: [new Map(), new Map(), new Map()]
	}, { enabled: true, visualErrorThreshold: 0, preferredFrameBudget: 2, hardFrameLimit: 10 });
	assert(exactResult.exactDuplicatesMerged === 1 && exactResult.frameDurations[0] === 250,
		'Exact composed duplicates were not losslessly merged.');

	const nearMiddle = frame(50, 255, 4);
	nearMiddle.data[0] = 51;
	const nearResult = reducer.reduce({
		frames: [frame(50, 255, 4), nearMiddle, frame(51, 255, 4)],
		frameDurations: [100, 100, 100],
		selections: [new Map(), new Map(), new Map()]
	}, { enabled: true, visualErrorThreshold: 0.01, preferredFrameBudget: 2, hardFrameLimit: 10 });
	assert(nearResult.nearDuplicatesMerged === 1 && nearResult.maximumVisualError <= 0.01,
		'Near-duplicate reduction exceeded its visual-error budget.');
	assert(nearResult.frameDurations.reduce((sum, duration) => sum + duration, 0) === 300,
		'Near-duplicate reduction changed duration.');

	const alphaDifference = CompositeFrameReducer.difference(frame(0, 0), frame(0, 1));
	assert(alphaDifference > 0, 'Alpha-only changes were ignored.');

	const tinyLayerA = frame(0, 255, 16);
	const tinyLayerB = frame(0, 255, 16);
	tinyLayerB.data[0] = 255;
	assert(CompositeFrameReducer.difference(tinyLayerA, tinyLayerB) > 0.02,
		'A tiny high-contrast sparkle was not protected from smart reduction.');

	assert(CompositeFrameReducer.hash(frame(12)) === '2x2:1598205349',
		'Golden no-reduction composed-frame hash changed.');
	assert(sevenEleven.reduction.durationPreserved && sampled.reduction.durationPreserved,
		'No-reduction and sampled plans did not preserve total duration.');

	console.log('PASS export timeline fixtures: timing, seams, sampling, duplicates, alpha, effects, and visual error.');
}

main().catch((error) => {
	console.error(error.stack || String(error));
	process.exit(1);
});
