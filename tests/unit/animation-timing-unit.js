'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const context = require('../fixtures/pattern-source-context')();
Object.assign(context, {
	getLayerManagerForType: () => null,
	LayerType: { BASE_IMAGE: 'base' }, isLayerFullyLocked: layer => layer.locked === true,
	getLayerPaintSlots: layer => layer.slots || [], getLayerSparkleEntries: layer => layer.sparkles || [],
	getPaintSlotSourceKey: (layer, entry) => `${layer.id}_${entry.key}`, getSparkleSampleKey: (layer, entry) => `${layer.id}_${entry.key}`,
	isFeatureEnabled: () => true, window: { dispatchEvent() {} }, CustomEvent: class {},
	GlitterFilter: { isActive: () => false }, GlitterFilters: { get: () => ({}) }
});
for (const file of ['core/math.js', 'core/format.js', 'effects/easing.js', 'effects/animation.js', 'core/animation-timing.js', 'editor/animation-loop.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js', file), 'utf8'), context);
const result = vm.runInContext(`(() => {
	const animation = GlitterAnimation.normalizeAnimation({ id: 'first', type: 'pulse', periodMs: 1400 });
	const layer = { id: 'one', animations: [animation], type: 'shape' };
	let commits = 0;
	const editor = { layers: [layer], sceneCompositor: { describeAuthoredTiming: () => [] }, layerManager: { getLayerById: id => editor.layers.find(layer => layer.id === id) }, requestPreviewUpdate() {}, commitAnimationTiming() { commits++; } };
	editor.writeTiming = EDITOR_ANIMATION_LOOP_METHODS.writeTiming;
	const key = GlitterAnimation.sourceKey(layer.id, animation);
	editor.writeTiming(key, { period: 1, phase: -0.25 });
	const clamped = animation.periodMs === FIELDS.animDuration.min * 1000 && animation.phase === 0.75;
	const remembered = layer.loopOriginalPeriods[key] === 1400;
	layer.animations.unshift(GlitterAnimation.normalizeAnimation({ id: 'second', type: 'pulse' }));
	editor.writeTiming(key, { period: 900, run: { start: 400, end: Infinity } }, { live: true });
	const follows = animation.periodMs === 900 && animation.delayMs === 400 && animation.iterations === Infinity;
	layer.locked = true;
	const locked = !editor.writeTiming(key, { period: 800 });
	layer.type = 'base';
	const canvas = editor.writeTiming(key, { period: 800 }, { live: true });
	const finite = GlitterAnimation.normalizeAnimation(JSON.parse(JSON.stringify({ type: 'tada', iterations: 3 }))).iterations === 3;
	const infinite = GlitterAnimation.normalizeAnimation(JSON.parse(JSON.stringify({ type: 'tada', iterations: Infinity }))).iterations === Infinity;
	return { clamped, remembered, follows, locked, canvas, finite, infinite, commits };
})()`, context);
assert.deepEqual(JSON.parse(JSON.stringify(result)), { clamped: true, remembered: true, follows: true, locked: true, canvas: true, finite: true, infinite: true, commits: 1 });
vm.runInContext(`(() => {
	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	const close = (a, b) => Math.abs(a - b) < 1e-7;
	const motion = { type: 'drift', periodMs: 1000, delayMs: 500, phase: 0.5, iterations: 2, easing: 'linear' };
	for (const direction of ['normal', 'reverse', 'alternate', 'alternate-reverse']) {
		for (const fillMode of ['none', 'backwards', 'forwards', 'both']) {
			const data = { ...motion, direction, fillMode };
			const before = GlitterAnimation.cycleProgress(data, 250);
			assert(['backwards', 'both'].includes(fillMode) ? before?.held && close(before.progress, 0.5) : before === null, 'pre-start offset membership: ' + direction + '/' + fillMode);
			assert(GlitterAnimation.cycleProgress(data, 500 - 1e-6, { fill: false }) === null, 'pre-start is inactive');
			assert(close(GlitterAnimation.cycleProgress(data, 500).progress, 0.5), 'directed offset at start');
			assert(GlitterAnimation.cycleProgress(data, 2000 - 1e-6) !== null, 'finite run before end');
			const end = GlitterAnimation.cycleProgress(data, 2000);
			assert(['forwards', 'both'].includes(fillMode) ? end?.held : end === null, 'finite end fill');
		}
	}
	assert(close(GlitterAnimation.iterationsForRun({ ...motion, phase: 0 }, { start: 500, end: 1833.3 }), 1.3333), 'run calculations retain precision');
	const animation = GlitterAnimation.normalizeAnimation({ ...motion, id: 'precise' });
	const layer = { id: 'precise-layer', type: 'shape', animations: [animation] };
	let commits = 0;
	const editor = { layers: [layer], sceneCompositor: { describeAuthoredTiming: () => [] }, layerManager: { getLayerById: () => layer }, requestPreviewUpdate() {}, commitAnimationTiming() { commits++; }, writeTiming: EDITOR_ANIMATION_LOOP_METHODS.writeTiming };
	const key = GlitterAnimation.sourceKey(layer.id, animation);
	assert(editor.writeTiming(key, { phase: 0.75 }), 'offset edit accepted');
	assert(close(GlitterAnimation.runTiming(animation).end, 2000) && close(animation.iterations, 2.25), 'offset preserves finite endpoints');
	editor.writeTiming(key, { phase: 0.25, iterations: 3 });
	assert(animation.iterations === 3, 'explicit count wins over implicit endpoint preservation');
	editor.writeTiming(key, { phase: 0.75, iterations: 4, run: { start: 600, end: 1933.3 } });
	assert(close(GlitterAnimation.runTiming(animation).end, 1933.3), 'explicit run wins over count');
	const before = JSON.stringify({ layer, revision: editor.documentRevision, commits });
	for (const patch of [{ iterations: NaN }, { iterations: -Infinity }, { period: 800, run: { start: NaN, end: 1500 } }, { period: 800, run: { start: 0, end: -Infinity } }, { direction: 'invalid' }, { run: null }, { period: null }]) {
		assert(editor.writeTiming(key, patch) === false, 'invalid patch rejected');
		assert(JSON.stringify({ layer, revision: editor.documentRevision, commits }) === before, 'invalid write is atomic');
	}
	assert(editor.writeTiming(key, { phase: animation.phase }) === false, 'unchanged value rejected');
	assert(JSON.stringify({ layer, revision: editor.documentRevision, commits }) === before, 'no-op changes nothing');
	const custom = { ...motion, type: 'custom', direction: 'normal', phase: 0.75, iterations: 2 };
	assert(close(GlitterAnimation.timeAtProgress(custom, 0.5, 0), 1250), 'seek finds later reachable cycle before delayed run');
	assert(GlitterAnimation.timeAtProgress(custom, 0.5, 0, { endMs: 1000 }) === null, 'seeking respects the document loop');
	assert(GlitterAnimation.timeAtProgress({ ...custom, iterations: 0.8 }, 0.5, 0) === null, 'consumed partial run has no matching key');
	for (const direction of ['normal', 'reverse', 'alternate', 'alternate-reverse']) {
		const data = { ...motion, phase: 0.3, direction, fillMode: 'backwards', iterations: 0.25 };
		const expected = GlitterAnimation.isReversedCycle(direction, 0) ? 0.7 : 0.3;
		assert(close(GlitterAnimation.cycleProgress(data, 0).progress, expected), 'consumed run still holds directed starting offset before delay');
		assert(GlitterAnimation.cycleProgress(data, 500, { fill: false }) === null, 'consumed run is inactive');
	}
	assert(GlitterAnimation.timeAtProgress({ ...custom, phase: 0, delayMs: 0, iterations: Infinity }, 1, 0) === null, 'an explicit end key is unreachable when every cycle jumps at the boundary');
	assert(close(GlitterAnimation.timeAtProgress({ ...custom, phase: 0, delayMs: 0, iterations: 1, fillMode: 'forwards' }, 1, 0), 1000), 'finite forwards hold reaches the explicit end key');
	Object.assign(editor, EDITOR_ANIMATION_LOOP_METHODS);
	editor.documentLoop = { mode: 'auto' }; editor.exportSettings = { animationFormat: 'gif' };
	const estimate = { duration: 2000, analysisContext: editor.loopAnalysisContext(), sourceAnalysis: [{ key, resolvedPeriod: 2000 }], loopFit: { sources: [] } };
	editor.loopEstimate = estimate;
	assert(editor.isLoopEstimateCurrent(), 'matching analysis context is current');
	const timing = editor.resolveTimingTarget(listTimingTargets(editor)[0]);
	assert(timing.period === 1000 && timing.exportPeriod === 2000, 'authored and export periods are separate');
	assert(close(timing.exportRun.end, animation.delayMs + (animation.iterations - animation.phase) * 2000), 'effective endpoint uses effective period');
	assert(timing.closes === null, 'missing source cannot claim seamless output');
	editor.exportSettings.animationFormat = 'mp4';
	assert(!editor.isLoopEstimateCurrent(), 'same-revision settings change invalidates analysis');
	editor.exportSettings.animationFormat = 'gif';
	editor.sceneCompositor.timingRevision = 1;
	assert(!editor.isLoopEstimateCurrent(), 'decode readiness invalidates analysis');
	editor.sceneCompositor.timingRevision = 0; editor.animationRevisionEpoch = 1;
	assert(!editor.isLoopEstimateCurrent(), 'document identity invalidates analysis');
	editor.animationRevisionEpoch = 0; editor.loopEstimatePending = true;
	assert(!editor.isLoopEstimateCurrent() && editor.resolveTimingTarget(listTimingTargets(editor)[0]).exportPeriod == null, 'pending analysis supplies no effective period');
	editor.documentLoop = { mode: 'set', durationMs: 3500 };
	assert(editor.resolveAnimationLoop().duration === 3500, 'Set loop stays available while analysis is pending');
	const calls = new Map(), collect = ANIMATION_TIMING_KINDS.motion.collect;
	ANIMATION_TIMING_KINDS.motion.collect = function (editor, layer) { calls.set(layer.id, (calls.get(layer.id) || 0) + 1); return collect(editor, layer); };
	try {
		editor.layers = Array.from({ length: 12 }, (_, index) => ({ id: 'measured-' + index, type: 'shape', animations: [GlitterAnimation.normalizeAnimation({ id: 'motion-' + index, type: 'pulse', periodMs: 1000 })] }));
		editor.layerManager.getLayerById = id => editor.layers.find(layer => layer.id === id);
		listTimingTargets(editor); calls.clear();
		const key = GlitterAnimation.sourceKey(editor.layers[0].id, editor.layers[0].animations[0]);
		for (let index = 0; index < 10; index++) editor.writeTiming(key, { period: 1100 + index }, { live: true });
		assert(calls.size === 1 && calls.get(editor.layers[0].id) === 20, 'ten edits recollect only the owning motion kind, twice per edit');
		editor.layers[0].locked = true;
		assert(!editor.writeTiming(key, { period: 1200 }), 'cached ownership never caches permission');
		editor.layers[0] = { ...editor.layers[0], locked: false, animations: [GlitterAnimation.normalizeAnimation({ id: 'motion-0', type: 'pulse', periodMs: 1700 })] };
		assert(editor.writeTiming(key, { period: 1800 }, { live: true }) && editor.layers[0].animations[0].periodMs === 1800, 'ownership resolves live records after restore');
		editor.layers.shift();
		assert(!editor.writeTiming(key, { period: 1200 }), 'deleted source cannot be edited through cached ownership');
	} finally { ANIMATION_TIMING_KINDS.motion.collect = collect; }
})()`, context);
console.log('PASS timing targets, clamping, stable identity, original periods, locks, Canvas timing and JSON repeats');
