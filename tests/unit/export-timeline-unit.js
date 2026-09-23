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
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'core', 'gif-decode.js'), 'utf8'), context);
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'export', 'ExportTimeline.js'), 'utf8');
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
		frameCount: count,
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

function createPlanner() {
	return new CompositeTimelinePlanner({
		proceduralPeriodTolerance: 0.10,
		preRenderBudgetMultiplier: 1.5,
		renderClock: {
			gifDelayQuantumMs: 10,
			gifMinimumDelayMs: 20,
			gifMaximumDelayMs: 200,
			mp4OutputFpsStops: [12, 15, 20, 24, 25, 30, 50, 60],
			cadenceShortfallTolerance: 0.05,
			loopCandidateShortlist: 4
		}
	});

}

async function buildPlan(timelines, overrides = {}) {
	const planner = createPlanner();
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

	let scheduleRenderCalls = 0;
	const scheduleOptions = {
		timelines: [timeline('schedule', 4, [80, 120, 90, 110]), procedural('schedule-motion', 400, 20)],
		outputFormat: 'gif',
		fallbackDuration: 100,
		maxLoopDurationMs: 12000,
		maxSamplingFps: 30,
		manualFrameSkip: 2,
		reverse: true,
		smartReduction: true,
		preRenderSampling: true,
		preRenderBudgetMultiplier: 1.5,
		visualErrorThreshold: 0.008,
		preferredFrameBudget: 1000,
		hardFrameLimit: 1000,
		renderFrame: (_timestamp, selection) => {
			scheduleRenderCalls++;
			return frame([...selection.values()].reduce((sum, selected) => sum + (selected.frameIndex || 0), 0));
		}
	};
	const schedulePlanner = createPlanner();
	const schedule = schedulePlanner.planSchedule(scheduleOptions);
	assert(scheduleRenderCalls === 0, 'planSchedule rendered pixels.');
	const materializedSchedule = await schedulePlanner.plan(scheduleOptions);
	const scheduleSignature = (plan) => plan.entries.map((entry) => [entry.timestamp, entry.duration, [...entry.selection.entries()]]);
	assert(JSON.stringify(scheduleSignature(schedule)) === JSON.stringify(scheduleSignature(materializedSchedule))
		&& schedule.renderClock.mode === materializedSchedule.renderClock.mode
		&& schedule.loopSeam.duration === materializedSchedule.loopSeam.duration,
		'plan and planSchedule did not share the same authoritative schedule.');

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

	// --- Composite render clock: the committed clock owns displayed time ---

	const rotateClock = await buildPlan([
		timeline('authored', 3, [110, 110, 110]),
		procedural('rotate', 3000, 30)
	]);
	const clock = rotateClock.renderClock;
	assert(clock.mode === 'gif' && clock.delaySpread === 0 && clock.minimumDelay === 30,
		'A mixed authored + procedural export did not get one deliberate, regular master cadence.');
	// The judder this whole clock exists to remove: authored boundaries describe
	// when that source changes, not when the composite must render.
	const authoredBoundaries = timeline('authored', 3, [110, 110, 110]).boundariesUntil(clock.duration);
	assert(clock.timestamps.every((timestamp, index) => timestamp === index * clock.delays[0])
		&& authoredBoundaries.some((boundary) => !clock.timestamps.includes(boundary)),
		'Native authored boundaries were inserted into the master render clock.');
	assert(clock.timestamps[0] === 0
		&& clock.timestamps.at(-1) + clock.delays.at(-1) === clock.duration
		&& !clock.timestamps.includes(clock.duration),
		'The render clock emitted a frame at Dactual instead of ending the loop there.');
	assert(clock.delays.every((delay) => delay >= 20 && delay % 10 === 0
		&& Math.round(delay / 10) * 10 === delay),
		'GIF delays were not planned on the grid gif.js actually encodes (round(ms / 10) centiseconds).');
	assert(clock.duration === clock.delays.reduce((sum, delay) => sum + delay, 0)
		&& clock.duration === rotateClock.totalDuration,
		'Planner, clock and reported durations disagree after rounding.');
	// Sampling always reads the native authored timeline at the actual output
	// timestamp, so a late transition never accumulates into source drift.
	const nativeAuthored = timeline('authored', 3, [110, 110, 110]);
	const sampledIndices = rotateClock.sourceFrameSelections.get('authored');
	assert(sampledIndices.every((frameIndex, index) => frameIndex === nativeAuthored.frameIndexAt(clock.timestamps[index])),
		'Authored sampling did not read the original native timeline at the output timestamps.');
	assert(clock.authoredOccurrencesMissed === 0 && clock.maximumAuthoredBoundaryLateness <= clock.maximumDelay,
		'Authored coverage or boundary lateness exceeded what frame-start sampling allows.');

	let rotateRenderCalls = 0;
	await buildPlan([timeline('authored', 3, [110, 110, 110]), procedural('rotate', 3000, 30)], {
		renderFrame: () => { rotateRenderCalls++; return frame(0); }
	});
	assert(rotateRenderCalls === clock.frameCount,
		'Candidate planning rendered pixels instead of evaluating timing metadata only.');

	const shortAuthored = await buildPlan([
		timeline('flicker', 5, [20, 20, 20, 20, 20]),
		procedural('rotate', 1000, 30)
	]);
	assert(shortAuthored.renderClock.authoredOccurrencesMissed === 0
		&& shortAuthored.renderClock.maximumDelay <= 20,
		'A short authored frame disappeared because the master cadence was too coarse.');

	// An authored LCM above the cap stays on the existing best-fit-seam choice;
	// its compromise duration is not a base loop whose multiples can be searched.
	const seamWithEffect = await buildPlan([
		timeline('twenty-four', 24, Array(24).fill(40)),
		timeline('twenty-five', 25, Array(25).fill(40)),
		procedural('rotate', 3000, 30)
	]);
	assert(!seamWithEffect.loopSeam.exact
		&& seamWithEffect.renderClock.duration <= 12000
		&& seamWithEffect.renderClock.frameCount <= 1000
		&& seamWithEffect.renderClock.clippedOccurrencesMissed >= 0,
		'A seam-truncated terminal fragment forced an unbounded global cadence.');

	const videoClock = await buildPlan([
		timeline('authored', 3, [110, 110, 110]),
		procedural('rotate', 3000, 30)
	], { outputFormat: 'mp4' });
	const video = videoClock.renderClock;
	assert(video.mode === 'mp4' && video.outputFps === 30
		&& Math.abs(video.duration - video.frameCount * 1000 / video.outputFps) < 1e-9,
		'MP4 duration was not frameCount / outputFps.');
	assert(video.duration !== video.targetDuration,
		'The MP4 fixture no longer exercises a target duration the format cannot represent exactly.');
	const videoFit = videoClock.timingResolution.proceduralPeriodFits.find((fit) => fit.key === 'rotate');
	assert(Math.abs(video.duration / videoFit.resolvedPeriod - Math.round(video.duration / videoFit.resolvedPeriod)) < 1e-9,
		'Procedural period fitting used the ideal target duration instead of the duration MP4 actually represents.');

	// Slow continuous motion reads as near-duplicate without being temporally
	// redundant, so reduction may not stretch a delay past the committed cadence.
	const motionFrames = Array.from({ length: 6 }, (_, index) => frame(50 + index, 255, 4));
	const motionInput = () => ({
		frames: [...motionFrames],
		frameDurations: Array(6).fill(30),
		selections: motionFrames.map(() => new Map())
	});
	const cadenceSafe = reducer.reduce(motionInput(), {
		enabled: true, visualErrorThreshold: 0.05, preferredFrameBudget: 2, hardFrameLimit: 1000, maximumCadenceGap: 30
	});
	const cadenceFree = reducer.reduce(motionInput(), {
		enabled: true, visualErrorThreshold: 0.05, preferredFrameBudget: 2, hardFrameLimit: 1000
	});
	assert(cadenceSafe.nearDuplicatesMerged === 0 && cadenceFree.nearDuplicatesMerged > 0,
		'Reduction re-irregularized continuous motion the master clock had already planned.');

	// The most demanding active preference sets the target resolution; it is a
	// preference, not a hard minimum, and never becomes an effect's speed.
	const mixedPreferences = await buildPlan([
		procedural('slow-stepped', 1000, 8),
		procedural('continuous', 1000, 30)
	]);
	assert(mixedPreferences.renderClock.maximumDelay <= 1000 / 30
		&& mixedPreferences.timingResolution.proceduralPeriodFits.every((fit) => fit.resolvedPeriod === 1000),
		'The most demanding sampling preference did not set the cadence, or it leaked into effect speed.');

	const atMaximumLoop = await buildPlan([procedural('long', 11900, 30)], { maxLoopDurationMs: 12000 });
	assert(atMaximumLoop.renderClock.duration <= 12000
		&& atMaximumLoop.renderClock.frameCount <= 1000
		&& atMaximumLoop.renderClock.delays.every((delay) => delay >= 20),
		'A loop at the maximum duration escaped its bounded cadence and frame-count ceilings.');

	const deterministicA = await buildPlan([timeline('authored', 3, [110, 110, 110]), procedural('rotate', 3000, 30)]);
	const deterministicB = await buildPlan([timeline('authored', 3, [110, 110, 110]), procedural('rotate', 3000, 30)]);
	assert(deterministicA.renderClock.delays.join(',') === deterministicB.renderClock.delays.join(','),
		'Identical input did not produce an identical timing plan.');

	assert(CompositeFrameReducer.hash(frame(12)) === '2x2:1598205349',
		'Golden no-reduction composed-frame hash changed.');
	assert(sevenEleven.reduction.durationPreserved && sampled.reduction.durationPreserved,
		'No-reduction and sampled plans did not preserve total duration.');

	console.log('PASS export timeline fixtures: authored timing, procedural fitting, seams, render-clock cadence, sampling, duplicates, alpha, effects, and visual error.');
}

main().catch((error) => {
	console.error(error.stack || String(error));
	process.exit(1);
});
