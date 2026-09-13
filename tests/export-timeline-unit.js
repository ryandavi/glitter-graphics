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
vm.runInContext(`${source}\nglobalThis.timelineExports = { AuthoredAnimationSource, ProceduralAnimationSource, CompositeFrameReducer, CompositeTimelinePlanner };`, context);
const { AuthoredAnimationSource, ProceduralAnimationSource, CompositeFrameReducer, CompositeTimelinePlanner } = context.timelineExports;

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
	return new AuthoredAnimationSource({
		key,
		frames: Array.from({ length: count }, (_, index) => frame(index)),
		frameDurations: durations
	});
}

function procedural(key, period, preferredSamplingRate = 12) {
	return new ProceduralAnimationSource({
		key,
		naturalPeriod: period,
		preferredSamplingRate,
		sampler: (timestamp, resolvedPeriod) => ({ progress: (timestamp % resolvedPeriod) / resolvedPeriod })
	});
}

async function buildPlan(timelines, overrides = {}) {
	const planner = new CompositeTimelinePlanner({
		proceduralPeriodTolerance: 0.10,
		preRenderBudgetMultiplier: 1.5
	});
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

	const authoredWithEffect = await buildPlan([
		timeline('authored', 3, [100, 100, 100]),
		procedural('breath', 530, 30)
	]);
	const authoredAnalysis = authoredWithEffect.sourceAnalysis.find((source) => source.key === 'authored');
	const breathAnalysis = authoredWithEffect.sourceAnalysis.find((source) => source.key === 'breath');
	assert(authoredWithEffect.totalDuration === 9000 && authoredWithEffect.loopSeam.exact,
		'Authored-loop multiples were not searched for the best procedural fit.');
	assert(authoredAnalysis.nativeCycleDuration === 300 && authoredAnalysis.nativeFps === 10,
		'Authored timing changed while fitting a procedural source.');
	assert(breathAnalysis.periodChanged && Math.abs(breathAnalysis.resolvedPeriod - (9000 / 17)) < 0.001 && breathAnalysis.cycleCount === 17,
		'Procedural period fitting was not reported as period and cycle data.');

	const fallbackPerEffect = await buildPlan([
		timeline('authored', 3, [100, 100, 100]),
		procedural('fits', 590),
		procedural('does-not-fit', 20000)
	]);
	const fallbackFits = fallbackPerEffect.timingResolution.proceduralPeriodFits;
	assert(fallbackFits.find((fit) => fit.key === 'fits').fitted
		&& !fallbackFits.find((fit) => fit.key === 'does-not-fit').fitted
		&& fallbackPerEffect.sourceAnalysis.find((source) => source.key === 'does-not-fit').resolvedPeriod === 20000,
		'Procedural tolerance fallback was not applied independently per effect.');

	const proceduralOnly = await buildPlan([procedural('one', 1300), procedural('two', 1750)]);
	assert(proceduralOnly.totalDuration <= 12000 && proceduralOnly.timingResolution.proceduralPeriodFits.length === 2,
		'Procedural-only sources did not use the bounded shared candidate search.');

	const proceduralSampling = await buildPlan([procedural('smooth', 1000, 20)], { maxSamplingFps: 30 });
	assert(proceduralSampling.reduction.originalFrameCount === 20,
		'Procedural preferred sampling rate did not create the output sampling grid.');

	const stressTimelines = [
		timeline('rate-70', 3, [70, 70, 70]),
		timeline('rate-80', 4, [80, 80, 80, 80]),
		timeline('rate-90', 5, [90, 90, 90, 90, 90]),
		timeline('rate-100', 6, [100, 100, 100, 100, 100, 100]),
		timeline('rate-110', 7, [110, 110, 110, 110, 110, 110, 110]),
		timeline('rate-130', 3, [130, 130, 130]),
		timeline('rate-170', 4, [170, 170, 170, 170]),
		timeline('rate-200', 5, [200, 200, 200, 200, 200]),
		timeline('variable-stress', 3, [60, 140, 90])
	];
	let stressRenderCalls = 0;
	const stressPlan = await buildPlan(stressTimelines, {
		smartReduction: true,
		preRenderSampling: true,
		preferredFrameBudget: 60,
		renderFrame: (_, selection) => {
			stressRenderCalls++;
			return frame([...selection.values()].reduce((sum, selected) => sum + selected.frameIndex, 0));
		}
	});
	assert(stressPlan.reduction.originalFrameCount > 90
		&& stressPlan.reduction.renderedFrameCount === 90
		&& stressRenderCalls === 90,
		'Many-rate stress planning did not cap expensive frame composition at 1.5x the target.');
	assert(stressPlan.reduction.durationPreserved, 'Many-rate stress planning changed the loop duration.');

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

	const underBudgetResult = reducer.reduce({
		frames: [frame(50, 255, 4), nearMiddle, frame(90, 255, 4)],
		frameDurations: [100, 100, 100],
		selections: [new Map(), new Map(), new Map()]
	}, { enabled: true, visualErrorThreshold: 0.01, preferredFrameBudget: 60, hardFrameLimit: 1000 });
	assert(underBudgetResult.framesRemoved === 0 && underBudgetResult.frames.length === 3,
		'Under-budget motion was reduced even though it already fit the frame target.');

	const immutableNearRates = await buildPlan([
		timeline('three-at-ten-fps', 3, [100, 100, 100]),
		timeline('three-at-eleven-fps', 3, [91, 91, 91])
	]);
	const nearSource = immutableNearRates.sourceAnalysis.find((asset) => asset.key === 'three-at-eleven-fps');
	assert(nearSource.kind === 'authored'
		&& nearSource.nativeCycleDuration === 273
		&& Math.abs(nearSource.nativeFps - 10.989) < 0.001
		&& !('resolvedFps' in nearSource),
		'Authored source analysis did not preserve and report only native timing.');

	const exactOnlyResult = reducer.reduce({
		frames: [frame(50, 255, 4), nearMiddle, frame(90, 255, 4)],
		frameDurations: [100, 100, 100],
		selections: [new Map(), new Map(), new Map()]
	}, { enabled: true, visualErrorThreshold: 0, preferredFrameBudget: 1, hardFrameLimit: 1000 });
	assert(exactOnlyResult.nearDuplicatesMerged === 0 && exactOnlyResult.frames.length === 3,
		'Zero visual error performed a perceptual merge.');

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

	console.log('PASS export timeline fixtures: authored timing, procedural fitting, seams, sampling, duplicates, alpha, effects, and visual error.');
}

main().catch((error) => {
	console.error(error.stack || String(error));
	process.exit(1);
});
