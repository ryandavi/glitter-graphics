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

const context = { ImageData: ImageDataPolyfill, Uint8ClampedArray, Map, Set, Math, Number, Infinity, navigator: { hardwareConcurrency: 4, userAgent: 'node' } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'core', 'gif-decode.js'), 'utf8'), context);
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'export', 'ExportTimeline.js'), 'utf8');
vm.runInContext(`${source}\nglobalThis.timelineExports = { AuthoredAnimationSource, ProceduralAnimationSource, CompositeFrameReducer, CompositeTimelinePlanner, planLoopFit, planFrameOptions };`, context);
const { AuthoredAnimationSource, ProceduralAnimationSource, CompositeFrameReducer, CompositeTimelinePlanner, planLoopFit, planFrameOptions } = context.timelineExports;

for (const file of ['core/releases.js', 'core/fields.js', 'core/math.js', 'core/format.js', 'core/area.js', 'core/config.js', 'effects/easing.js', 'effects/animation.js', 'export/SceneCompositor.js']) {
	vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', file), 'utf8'), context);
}
const motionSources = vm.runInContext(`(animation) => {
	const compositor = Object.create(SceneCompositor.prototype);
	compositor._buildAnimationSamplingContext = () => ({ id: 'motion' });
	const layer = { id: 'motion', animations: [GlitterAnimation.normalizeAnimation(animation)] };
	return compositor._createProceduralTimelines(compositor._createLayerAnimationTimelineSources(layer));
}`, context);

const patternContext = require('../fixtures/pattern-source-context')();
const keyedSource = motionSources({ type: 'custom', keys: [{ at: 0, values: { tx: 0 } }, { at: 0.5, values: { tx: 80 } }] })[0];
assert(keyedSource.keyTrack?.entry.type === 'custom', 'Custom source retains its key-authoring capability');
assert(JSON.stringify(keyedSource.cycleMarks) === '[0.5]', 'Custom source publishes intrinsic key marks');
assert(keyedSource.withPeriod(2000).keyTrack === keyedSource.keyTrack, 'Fitting preserves key-track identity');
assert(JSON.stringify(keyedSource.withPeriod(2000).cycleMarks) === '[0.5]', 'Fitting preserves key positions');
const samplePattern = vm.runInContext('getPatternScrollOffset', patternContext);
const scrollingPattern = new ProceduralAnimationSource({
	key: 'pattern-scroll', naturalPeriod: 2000, preferredSamplingRate: 30,
	periodRange: { min: 100, max: 20000 }, setPeriod: () => {},
	sampler: (time, period = 2000) => samplePattern({ scroll: 'down-right' }, 31, time, period)
});
assert(JSON.stringify(scrollingPattern.sampler(0)) === JSON.stringify(scrollingPattern.sampler(2000)), 'Pattern scroll must close at its declared period');
assert(scrollingPattern.sampler(1000).x === 15, 'Pattern timeline must retain whole-pixel scroll steps');

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

function createPlanner(renderClockOverrides = {}) {
	return new CompositeTimelinePlanner({
		proceduralPeriodTolerance: 0.10,
		preRenderBudgetMultiplier: 1.5,
		renderClock: {
			gifDelayQuantumMs: 10,
			gifMinimumDelayMs: 20,
			gifMaximumDelayMs: 200,
			mp4OutputFpsStops: [12, 15, 20, 24, 25, 30, 50, 60],
			cadenceShortfallTolerance: 0.05,
			loopCandidateShortlist: 4,
			...renderClockOverrides
		}
	});

}

async function buildPlan(timelines, overrides = {}, renderClockOverrides = {}) {
	const planner = createPlanner(renderClockOverrides);
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
	const motionOptions = {
		outputFormat: 'gif', fallbackDuration: 100, maxLoopDurationMs: 12000,
		maxSamplingFps: 30, manualFrameSkip: 1, preferredFrameBudget: 1000, hardFrameLimit: 1000
	};
	for (const cycle of [800, 1000]) {
		const set = createPlanner().planSchedule({ ...motionOptions, loopDurationMs: 3000, timelines: [timeline(`set-${cycle}`, 2, [cycle / 2, cycle / 2])] });
		assert(set.loopSeam.duration === 3000 && set.totalDuration === 3000, 'Set authored loop must retain its chosen length');
		assert(set.loopSeam.exact === (cycle === 1000), 'Set authored seam must use source closure');
	}
	const setMotion = duration => createPlanner().planSchedule({ ...motionOptions, loopDurationMs: duration, timelines: motionSources({ type: 'pulse', periodMs: 1400 }) });
	const fittedSet = setMotion(3000);
	assert(fittedSet.loopSeam.duration === 3000 && fittedSet.loopSeam.exact && fittedSet.sourceAnalysis[0].resolvedPeriod === 1500, 'Set loop must quietly fit within tolerance');
	const missedSet = setMotion(2400);
	assert(missedSet.loopSeam.duration === 2400 && !missedSet.loopSeam.exact && missedSet.sourceAnalysis[0].resolvedPeriod === 1400, 'Set loop must report an out-of-tolerance seam');
	const cutFinite = createPlanner().planSchedule({ ...motionOptions, loopDurationMs: 1000, timelines: motionSources({ type: 'tada', periodMs: 1000, iterations: 5 }) });
	assert(cutFinite.loopSeam.duration === 1000, 'Set length must override the automatic finite-run minimum');
	const config = { ...createPlanner().config, maxLoopDurationMs: 12000 };
	const candidates = planLoopFit([timeline('current-set', 2, [400, 400])], { config, loopDurationMs: 3000 });
	assert(candidates.candidates.some(candidate => candidate.duration === 3000), 'Loop fitting must retain the current length');
	const mutation = vm.runInContext(`(() => {
		const compositor = Object.create(SceneCompositor.prototype);
		compositor._buildAnimationSamplingContext = () => ({ id: 'run' });
		const layer = { id: 'run', animations: [GlitterAnimation.normalizeAnimation({ type: 'pulse', periodMs: 1000 })] };
		const source = () => compositor._createProceduralTimelines(compositor._createLayerAnimationTimelineSources(layer))[0];
		return { layer, source, run: () => GlitterAnimation.runTiming(layer.animations[0]), normalize: value => GlitterAnimation.normalizeAnimation(value) };
	})()`, context);
	for (const phase of [0, 0.25]) for (const end of [2600, Infinity]) {
		mutation.layer.animations[0].phase = phase;
		mutation.source().setRun({ start: 600, end });
		const run = mutation.run();
		assert(run.start === 600 && run.end === end, 'Run setter must invert runTiming including phase and Infinity');
		// A finite run keeps a speed setter: a bar's right edge sets its length at the same repeat count.
		assert(typeof mutation.source().setPeriod === 'function', 'Runs must keep their period setters');
	}
	mutation.source().setPhase(-0.25);
	assert(mutation.layer.animations[0].phase === 0.75, 'Phase setter must wrap negative values');
	const originalSource = mutation.source();
	const fittedSource = originalSource.withPeriod(1200);
	const writtenRun = fittedSource.setRun({ start: 500, end: 1500 });
	assert(writtenRun.start === mutation.run().start && writtenRun.end === mutation.run().end && fittedSource.setPhase === originalSource.setPhase && fittedSource.setRun === originalSource.setRun, 'Fitted source must retain timing setters and return their normalized run');
	const returned = motionSources({ type: 'rotate', periodMs: 1000, iterations: 0.5, turns: 0.5, fillMode: 'none' })[0];
	const held = motionSources({ type: 'rotate', periodMs: 1000, iterations: 0.5, turns: 0.5, fillMode: 'forwards' })[0];
	assert(returned.closesAt(1000, 1000) && !held.closesAt(1000, 1000), 'Trimmed rest closes and held non-rest pose does not');
	assert(mutation.normalize({ type: 'tada' }).iterations === vm.runInContext('CONFIG.tools.animation.presets.tada.iterations', context), 'Omitted repeats retain the preset default');
	assert(mutation.normalize(JSON.parse(JSON.stringify({ type: 'tada', iterations: Infinity }))).iterations === Infinity, 'JSON must preserve Repeat forever');
	console.log('PASS set-loop timing, seam reports, finite-run overrides, run/phase setters and repeat persistence');
	const motionCases = [
		{ type: 'pulse', periodMs: 1400, delayMs: 2000 },
		{ type: 'pulse', periodMs: 1400, delayMs: 500 },
		...[1, 3, 5].map((iterations) => ({ type: 'tada', periodMs: 1000, iterations })),
		{ type: 'tada', periodMs: 1000, iterations: 1, delayMs: 2000 },
		{ type: 'tada', periodMs: 1000, iterations: 3, authored: true },
		{ type: 'rotate', periodMs: 1000, iterations: 1, fillMode: 'forwards', turns: 0.5 }
	];
	for (const motion of motionCases) {
		const sources = motionSources(motion);
		if (motion.authored) sources.push(timeline('gif', 2, [400, 400]));
		const plan = createPlanner().planSchedule({ ...motionOptions, timelines: sources });
		const duration = plan.loopSeam.duration;
		const source = sources[0];
		assert(plan.loopSeam.exact === (motion.fillMode !== 'forwards'), `Wrong motion seam: ${JSON.stringify(motion)}`);
		if (source.nonLooping) {
			assert(duration >= source.run.end, 'Finite run was truncated');
			assert(plan.sourceAnalysis[0].resolvedPeriod === motion.periodMs, 'Finite speed changed');
		} else {
			const cycles = (duration - source.run.start) / plan.sourceAnalysis[0].resolvedPeriod;
			assert(cycles >= 1 && Math.abs(cycles - Math.round(cycles)) < 1e-8, 'Delayed loop cuts a cycle');
		}
		if (motion.authored) assert(duration % 800 === 0, 'Authored loop did not close');
		const rest = JSON.stringify(source.sampleAt(0));
		assert(plan.entries.some((entry) => entry.timestamp >= source.run.start
			&& entry.timestamp < source.run.end && JSON.stringify(entry.selection.get(source.key)) !== rest), 'Motion was never sampled');
		const fit = planLoopFit(sources, { config: { ...createPlanner().config, maxLoopDurationMs: 12000 } });
		assert(fit.candidates.some((candidate) => candidate.exact) === (motion.fillMode !== 'forwards'), 'Loop helper seam disagrees');
		console.log(`Motion ${JSON.stringify(motion)}: ${duration} ms, exact=${plan.loopSeam.exact}`);
	}
	const capped = createPlanner().planSchedule({ ...motionOptions, maxLoopDurationMs: 1000,
		timelines: [...motionSources({ type: 'tada', periodMs: 1000, iterations: 3 }), timeline('gif', 2, [400, 400])] });
	assert(capped.loopSeam.duration === 3200 && capped.loopSeam.exact, 'Search cap truncated finite motion');
	const phased = motionSources({ type: 'tada', periodMs: 1000, iterations: 3, delayMs: 2000, phase: 0.25 });
	assert(phased[0].run.end === 4750, 'Phase was omitted from finite run end');
	const quantized = createPlanner().planSchedule({ ...motionOptions,
		timelines: motionSources({ type: 'tada', periodMs: 1001, iterations: 1 }) });
	assert(quantized.loopSeam.duration >= 1001, 'Format rounding truncated the run');
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

	// --- Glitter-locked clock (TEMPORARY switch renderClock.glitterLocked) ---
	// Every frame change of a frame animation starts an output frame, so each
	// glitter frame plays for its own time; motion is sampled between them.
	const locked = { glitterLocked: true };
	for (const frameMs of [100, 110, 120, 170]) {
		const glitter = () => timeline(`glitter-${frameMs}`, 4, Array(4).fill(frameMs));
		const lockedPlan = await buildPlan([glitter(), procedural('rotate', 3000, 30)], {}, locked);
		const lockedClock = lockedPlan.renderClock;
		assert(lockedClock.maximumAuthoredBoundaryLateness < 0.5
			&& glitter().boundariesUntil(lockedClock.duration).every((boundary) => lockedClock.timestamps.includes(boundary)),
			`A ${frameMs} ms glitter frame change did not start an output frame on the locked clock.`);
		assert(lockedClock.delays.every((delay) => delay >= 20 && delay % 10 === 0) && lockedClock.maximumDelay <= 40,
			`The locked clock for ${frameMs} ms glitter left the GIF grid or slowed motion past 25 fps.`);
		const lockedVideo = (await buildPlan([glitter(), procedural('rotate', 3000, 30)], { outputFormat: 'mp4' }, locked)).renderClock;
		const freeVideo = (await buildPlan([glitter(), procedural('rotate', 3000, 30)], { outputFormat: 'mp4' })).renderClock;
		assert(lockedVideo.maximumAuthoredBoundaryLateness <= freeVideo.maximumAuthoredBoundaryLateness,
			`The locked MP4 clock showed ${frameMs} ms glitter later than the free clock.`);
	}
	const evenGlitter = (await buildPlan([timeline('glitter-120', 4, Array(4).fill(120)), procedural('rotate', 3000, 30)], {}, locked)).renderClock;
	assert(evenGlitter.delaySpread === 0, 'A glitter frame the grid divides evenly must give even motion steps.');
	const glitter120Video = (await buildPlan([timeline('glitter-120', 4, Array(4).fill(120)), procedural('rotate', 3000, 30)], { outputFormat: 'mp4' }, locked)).renderClock;
	assert(glitter120Video.maximumAuthoredBoundaryLateness < 0.5, 'The locked MP4 clock must pick a rate that divides the glitter frame (25 fps for 120 ms).');
	const unrelated = () => [timeline('fast', 2, [30, 30]), timeline('slow', 2, [50, 50]), procedural('rotate', 3000, 30)];
	const unrelatedLocked = (await buildPlan(unrelated(), {}, locked)).renderClock;
	const unrelatedFree = (await buildPlan(unrelated())).renderClock;
	assert(unrelatedLocked.maximumAuthoredBoundaryLateness <= unrelatedFree.maximumAuthoredBoundaryLateness
		&& unrelatedLocked.delays.every((delay) => delay >= 20),
		'Two frame animations at unrelated rates must not be shown later than the free clock, or below the delay floor.');
	// Reduction never merges across a glitter frame change while locked.
	const lockedFrames = Array.from({ length: 4 }, (_, index) => frame(100 + (index % 2), 255, 4));
	const lockedInput = () => ({
		frames: [...lockedFrames],
		frameDurations: Array(4).fill(50),
		selections: lockedFrames.map((_, index) => new Map([['glitter', { frameIndex: index }]]))
	});
	const lockedReduction = reducer.reduce(lockedInput(), {
		enabled: true, visualErrorThreshold: 0.05, preferredFrameBudget: 1, hardFrameLimit: 1000, lockAuthoredFrames: true
	});
	const freeReduction = reducer.reduce(lockedInput(), {
		enabled: true, visualErrorThreshold: 0.05, preferredFrameBudget: 1, hardFrameLimit: 1000
	});
	assert(lockedReduction.nearDuplicatesMerged === 0 && freeReduction.nearDuplicatesMerged > 0,
		'Locked reduction merged two frames that show different glitter frames.');

	assert(CompositeFrameReducer.hash(frame(12)) === '2x2:615909253',
		'Golden no-reduction composed-frame hash changed.');
	assert(sevenEleven.reduction.durationPreserved && sampled.reduction.durationPreserved,
		'No-reduction and sampled plans did not preserve total duration.');

	console.log('PASS export timeline fixtures: authored timing, procedural fitting, seams, render-clock cadence, sampling, duplicates, alpha, effects, and visual error.');
}

main().catch((error) => {
	console.error(error.stack || String(error));
	process.exit(1);
});

// The helper may fit beyond export's quiet tolerance, but never outside the
// source's writable range or discrete period vocabulary.
{
	const config = { ...createPlanner().config, maxLoopDurationMs: 12000 };
	const fixed = timeline('fixed', 2, [500, 500]);
	const writable = (period, range, resolvePeriod = null) => new ProceduralAnimationSource({
		key: 'editable', naturalPeriod: period, preferredSamplingRate: 10, sampler: () => ({}),
		setPeriod: () => {}, periodRange: range, resolvePeriod
	});
	const exact = planLoopFit([fixed, writable(1000, { min: 400, max: 8000 })], { config });
	assert(exact.candidates[0].exact && !exact.candidates[0].canApply, 'Exact fit must need no edit');
	const beyond = planLoopFit([fixed, writable(1400, { min: 400, max: 8000 })], { config });
	assert(beyond.candidates[0].exact && beyond.candidates[0].fits[0].drift > 0.1, 'Helper must fit beyond quiet tolerance');
	const clamped = planLoopFit([fixed, writable(4000, { min: 2000, max: 8000 })], { config });
	assert(!clamped.candidates[0].exact && clamped.candidates[0].cannotFit.length === 1, 'Out-of-range fit must be rejected');
	const clash = planLoopFit([timeline('a', 2, [305, 305]), timeline('b', 2, [355, 355])], { config });
	assert(!clash.fixedLoop.exact && !clash.candidates[0].exact && clash.fixed.length === 2, 'Clashing GIFs must remain fixed');
	const discrete = planLoopFit([fixed, writable(400, { min: 200, max: 800 }, (ms) => [200, 400, 800].sort((a,b) => Math.abs(a-ms)-Math.abs(b-ms))[0])], { config });
	assert(discrete.candidates[0].fits[0].fittedPeriod === 200, 'Fit must search representable cycle counts');
	const oneShot = writable(1000, { min: 400, max: 8000 }); oneShot.nonLooping = true;
	assert(planLoopFit([fixed, oneShot], { config }).oneShots.length === 1, 'One shots must not be fitted');
	assert(!planLoopFit([], { config }).candidates.length, 'Still scenes need no loop candidates');
	// A GIF with a cycle setter joins loop fitting, and only loop fitting.
	const stretchable = () => new AuthoredAnimationSource({
		key: 'sticker', frameCount: 12, frameDurations: new Array(12).fill(80),
		fileCycleDuration: 960, periodRange: { min: 480, max: 1920 }, resolvePeriod: (ms) => Math.round(ms / 10) * 10, setPeriod: () => {}
	});
	const glitter = timeline('glitter', 10, new Array(10).fill(100));
	const stretched = planLoopFit([stretchable(), glitter], { config });
	const oneSecond = stretched.candidates.find((candidate) => candidate.duration === 1000);
	assert(stretched.fixed.length === 1 && stretched.fixed[0].key === 'glitter', 'A GIF with a setter must not be listed as fixed');
	assert(oneSecond?.exact && oneSecond.canApply && oneSecond.fits[0].source.key === 'sticker' && oneSecond.fits[0].fittedPeriod === 1000, 'A settable GIF must be fitted to the loop');
	assert(stretchable().kind === 'authored' && stretchable().naturalPeriod === 960, 'A settable GIF stays an authored source');
	const scheduleOptions = {
		outputFormat: 'gif', fallbackDuration: 100, maxLoopDurationMs: 12000,
		maxSamplingFps: 30, manualFrameSkip: 1, preferredFrameBudget: 1000, hardFrameLimit: 1000
	};
	const unstretched = createPlanner().planSchedule({ ...scheduleOptions, timelines: [stretchable(), procedural('motion', 1000)] });
	assert(unstretched.timingResolution.proceduralPeriodFits.every((fit) => fit.key !== 'sticker'), 'The export planner must never fit a GIF by itself');
	assert(unstretched.sourceAnalysis.find((entry) => entry.key === 'sticker').nativeCycleDuration === 960, 'The export planner must keep a GIF on its own cycle');
	const withinTolerance = createPlanner().planSchedule({ ...scheduleOptions, timelines: [stretchable(), procedural('motion', 1000)], loopDurationMs: 1000 });
	assert(withinTolerance.loopSeam.duration === 1000 && !withinTolerance.loopSeam.exact, 'A set loop must report the seam of a GIF it does not stretch');
}

// Frame options: a timing is offered when it exports fewer frames, planned
// the way the export plans, and never past the allowed change of speed.
(async () => {
	const config = { ...createPlanner().config, maxLoopDurationMs: 12000 };
	const options = { candidateLimit: 8, minimumSaving: 0.2, maximumSpeedChange: 0.25 };
	const retimeGifDelays = vm.runInContext('retimeGifDelays', context);
	const sticker = (cycle = 960) => {
		const file = new Array(12).fill(80);
		return new AuthoredAnimationSource({
			key: 'sticker', frameCount: 12, frameDurations: retimeGifDelays(file, cycle),
			fileCycleDuration: 960, periodRange: { min: 480, max: 1920 }, resolvePeriod: (ms) => Math.round(ms / 10) * 10,
			setPeriod: () => {}, retimeDelays: (target) => retimeGifDelays(file, target)
		});
	};
	const glitter = timeline('glitter', 8, new Array(8).fill(100));
	const plan = (timelines) => buildPlan(timelines);
	const measure = async (timelines, extra = {}) => {
		const current = await plan(timelines);
		return { current, result: await planFrameOptions(timelines, planLoopFit(timelines, { config }), current.frameCount, { config: options, plan, ...extra }) };
	};
	const retimed = sticker().atPeriod(800);
	assert(retimed.cycleDuration === 800 && retimed.frameCount === 12 && typeof retimed.setPeriod === 'function', 'A retimed copy must play one pass in the new cycle and keep its controls');
	assert(procedural('motion', 900).atPeriod(1000).naturalPeriod === 1000, 'A retimed procedural copy must own the new period');

	// 960 ms against 800 ms only closes after 4.8 s.
	const clash = await measure([sticker(), glitter]);
	const fewest = clash.result.options.at(-1);
	assert(clash.current.loopSeam.duration === 4800 && clash.result.optimizable && fewest.kind === 'fewest', 'Cycles that only close on a long loop must offer a timing with fewer frames');
	assert(fewest.duration === 800 && fewest.fits.length === 1 && fewest.fits[0].fittedPeriod === 800, 'The offered timing must be the loop fit that closes');
	const applied = await plan([sticker(800), glitter]);
	assert(fewest.frameCount === applied.frameCount && fewest.frameCount < clash.current.frameCount * 0.8, 'An option must report the frame count its fit exports');
	assert((await measure([sticker(800), glitter])).result.options.length === 0, 'A fitted timing must offer nothing');
	const capped = await measure([sticker(), glitter], { originalPeriod: (source) => (source.key === 'sticker' ? 1200 : source.naturalPeriod) });
	assert(!capped.result.optimizable, 'An option must stay inside the allowed change from the original speed');
	assert(!(await measure([timeline('a', 12, new Array(12).fill(80)), glitter])).result.optimizable, 'Fixed sources must offer nothing');
	console.log('PASS frame options: retimed copies, export-planned counts, speed cap, fixed and already-fitted timing.');
})().catch((error) => {
	console.error(error.stack || String(error));
	process.exit(1);
});
