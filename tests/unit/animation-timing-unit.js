'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const context = require('../fixtures/pattern-source-context')();
Object.assign(context, {
	getLayerManagerForType: () => null,

	getLayerPaintSlots: layer => layer.slots || [], getLayerSparkleEntries: layer => layer.sparkles || [],
	getPaintSlotSourceKey: (layer, entry) => `${layer.id}_${entry.key}`, getSparkleSampleKey: (layer, entry) => `${layer.id}_${entry.key}`,
	isFeatureEnabled: () => true, window: { dispatchEvent() {} }, CustomEvent: class {},
	GlitterFilter: { isActive: () => false }, GlitterFilters: { get: () => ({}) }
});
for (const file of ['core/math.js', 'core/format.js', 'core/layer-types.js', 'paint/clip-mask.js', 'effects/easing.js', 'effects/animation.js', 'core/animation-timing.js', 'editor/animation-loop.js', 'editor/animation-edit.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js', file), 'utf8'), context);
vm.runInContext("LAYER_UI_CONFIG.shape = { visibilityWindow: true, clippable: true, clipBase: true }; LAYER_UI_CONFIG[LayerType.BASE_IMAGE] = { visibilityWindow: false };", context);
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
	layer.type = LayerType.BASE_IMAGE;
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
	const timing = editor.resolveTimingTarget(listTimingTargets(editor).find(target => target.kind === 'motion'));
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
	assert(!editor.isLoopEstimateCurrent() && editor.resolveTimingTarget(listTimingTargets(editor).find(target => target.kind === 'motion')).exportPeriod == null, 'pending analysis supplies no effective period');
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
vm.runInContext(`(() => {
	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	const layer = { id: 'window', type: 'shape', animations: [] }, child = { id: 'clipped', type: 'shape', clipped: true };
	let commits = 0;
	const editor = { layers: [layer, child], sceneCompositor: { describeAuthoredTiming: () => [] }, layerManager: { getLayerById: id => editor.layers.find(layer => layer.id === id) },
		requestPreviewUpdate() {}, commitAnimationTiming() { commits++; }, writeTiming: EDITOR_ANIMATION_LOOP_METHODS.writeTiming, setLayerAppear: EDITOR_ANIMATION_LOOP_METHODS.setLayerAppear };
	const target = listTimingTargets(editor).find(target => target.kind === 'appear' && target.layerId === layer.id);
	assert(target && !target.can.period && target.can.run && !target.active, 'an absent window is a writable non-periodic range');
	assert(editor.setLayerAppear(layer, { start: 200, end: 700 }) && commits === 1, 'window edit shares the timing commit');
	for (const time of [199.999, 200, 699.999, 700]) {
		const expected = time >= 200 && time < 700;
		assert(isLayerShownAt(layer, time) === expected, 'half-open visibility edge ' + time);
		assert(isLayerShownAt(child, time, { layers: editor.layers }) === expected, 'clipped child inherits visibility edge ' + time);
		assert(isLayerShownAt(child, time, { layers: editor.layers, rest: true }), 'rest ignores both windows');
	}
	layer.visible = false;
	assert(!isLayerShownAt(layer, 400, { rest: true }) && !isLayerShownAt(child, 400, { layers: editor.layers, rest: true }), 'hidden always wins, including clip bases at rest');
	layer.visible = true;
	const before = JSON.stringify({ layer, commits, revision: editor.documentRevision });
	for (const patch of [{}, { period: 1000 }, { appear: { start: NaN, end: null } }, { appear: { start: 400, end: 300 } }, { appear: null, run: { start: 0, end: Infinity } }]) {
		assert(!editor.writeTiming(target.key, patch), 'invalid/empty window patch rejected');
		assert(JSON.stringify({ layer, commits, revision: editor.documentRevision }) === before, 'invalid window edit is atomic');
	}
	layer.locked = true; assert(!editor.setLayerAppear(layer, null), 'locked windows cannot clear'); layer.locked = false;
	assert(editor.writeTiming(target.key, { run: { start: 500, end: Infinity } }), 'range edit supports loop end');
	assert(layer.appear.end === null && isLayerShownAt(layer, 999, { loopEnd: 1000 }) && !isLayerShownAt(layer, 1000, { loopEnd: 1000 }), 'null end follows the document loop');
	assert(editor.setLayerAppear(layer, null) && !Object.hasOwn(layer, 'appear'), 'Always visible restores field absence');
	assert(!editor.setLayerAppear(layer, null), 'clearing absence is a no-op');
	layer.type = LayerType.BASE_IMAGE;
	assert(!editor.setLayerAppear(layer, { start: 100, end: 400 }), 'Canvas cannot have a window');
	assert(normalizeLayerAppear({ start: -100, end: null }) === null, 'default normalization removes redundant window');
})()`, context);
console.log('PASS layer visibility ranges: boundary membership, clipping/rest, atomic writes, locks, clear and loop-end semantics');

vm.runInContext(`(() => {
	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	const close = (a, b) => Math.abs(a - b) < 1e-6;
	const layers = [0, 1, 2].map(index => ({ id: 'batch-' + index, type: 'shape', animations: [GlitterAnimation.normalizeAnimation({ id: 'motion', type: 'pulse', periodMs: 1000 + index * 100, delayMs: 300 + index * 200, iterations: 2.375, phase: .125, direction: 'alternate-reverse' })], loopOriginalPeriods: { untouched: 777 } }));
	layers.push({ id: 'window', type: 'shape', appear: { start: 400, end: 1400 } });
	let commits = 0, previews = 0;
	const editor = { layers, layerManager: { getLayerById: id => editor.layers.find(layer => layer.id === id) }, sceneCompositor: { describeAuthoredTiming: () => [] }, requestPreviewUpdate() { previews++; }, commitAnimationTiming() { commits++; }, writeTiming: EDITOR_ANIMATION_LOOP_METHODS.writeTiming, moveTimingTargets: EDITOR_ANIMATION_LOOP_METHODS.moveTimingTargets, applyTimingPlan: EDITOR_ANIMATION_LOOP_METHODS.applyTimingPlan };
	const keys = layers.map(layer => layer.animations ? GlitterAnimation.sourceKey(layer.id, layer.animations[0]) : '__appear_' + layer.id);
	const runs = () => keys.map(key => findTimingTarget(editor, key).run);
	const original = runs(), parameters = JSON.stringify(layers.map(layer => [layer.animations?.map(({delayMs, ...entry}) => entry), layer.loopOriginalPeriods]));
	assert(editor.moveTimingTargets(keys, 'move', 125).changed && commits === 1 && previews === 1, 'one publication and commit for the group');
	assert(runs().every((run, index) => close(run.start, original[index].start + 125) && close(run.end, original[index].end + 125)), 'group movement keeps spacing and durations');
	assert(JSON.stringify(layers.map(layer => [layer.animations?.map(({delayMs, ...entry}) => entry), layer.loopOriginalPeriods])) === parameters, 'movement keeps cycle, repeats, offset, direction and original-period metadata exactly');
	for (const operation of ['align-start', 'align-end', 'stagger']) {
		assert(editor.moveTimingTargets(keys, operation, 150).changed, operation + ' applies');
		const moved = runs();
		assert(moved.every((run, index) => close(run.end - run.start, original[index].end - original[index].start)), 'alignment/stagger moves rather than trims');
		assert(operation === 'align-start' ? moved.every(run => close(run.start, moved[0].start)) : operation === 'align-end' ? moved.every(run => close(run.end, moved[0].end)) : moved.every((run, index) => close(run.start, moved[0].start + index * 150)), operation + ' uses the selected order');
	}
	const unchanged = () => JSON.stringify({ layers, commits, previews, revision: editor.documentRevision });
	for (const [selection, operation, value] of [[keys, 'move', -50000], [keys, 'move', 50000], [keys, 'stagger', -1], [keys, 'move', NaN], [[...keys, keys[0]], 'move', 10], [[...keys, 'missing'], 'move', 10]]) {
		const before = unchanged();
		assert(editor.moveTimingTargets(selection, operation, value).reason && unchanged() === before, 'invalid batch writes and publishes nothing');
	}
	layers[1].locked = true;
	let before = unchanged();
	assert(editor.moveTimingTargets(keys, 'move', 100).reason && unchanged() === before, 'one live lock refuses every move');
	layers[1].locked = false;
	layers[2].animations[0].iterations = Infinity;
	before = unchanged();
	assert(editor.moveTimingTargets(keys, 'align-end', 0).reason && unchanged() === before, 'open ends explain why they cannot align');
	assert(editor.moveTimingTargets(keys, 'move', 100).changed, 'infinite runs can still move their start');
	const reordered = [...keys].reverse();
	assert(editor.moveTimingTargets(reordered, 'stagger', 250).changed && runs().every((run, index) => close(run.start, runs().at(-1).start + (keys.length - 1 - index) * 250)), 'stagger follows the requested visible order');
	layers[3].appear = undefined;
	const absent = planTimingMoves(editor, [keys[3]], 'move', 100);
	assert(!absent.reason && !layers[3].appear && absent.changes[0].run.end === Infinity, 'preflight never creates a missing visibility window');
	before = unchanged();
	assert(!editor.moveTimingTargets([keys[3]], 'move', 0).changed && unchanged() === before, 'zero movement preserves absence and history');
	const snapshot = captureTimingMoves(editor, keys), starts = runs().map(run => run.start);
	editor.moveTimingTargets(keys, 'move', 50, { commit: false });
	layers[1].locked = true;
	EDITOR_ANIMATION_LOOP_METHODS.restoreTimingMoves.call(editor, snapshot);
	assert(runs().every((run, index) => close(run.start, starts[index])) && !layers[3].appear, 'cancellation restores all original timing and absent windows even after a lock changes');
	layers[1].locked = false;
	editor.moveTimingTargets(keys, 'move', 50, { commit: false });
	editor.animationRevisionEpoch = 1;
	EDITOR_ANIMATION_LOOP_METHODS.restoreTimingMoves.call(editor, snapshot);
	assert(runs().every((run, index) => close(run.start, starts[index] + 50)), 'old-document rollback cannot overwrite replacement/history state');
	layers.push({ id: 'fixed', type: 'shape', sparkles: [{ key: 'slot', data: { cycleMs: 1000 } }] });
	before = unchanged();
	assert(editor.moveTimingTargets([keys[0], '__sparkles_fixed_slot'], 'move', 100).reason && unchanged() === before, 'period-only sources refuse the complete move instead of being skipped');
})()`, context);
console.log('PASS atomic coordinated move/alignment/stagger, live locks, limits, no-op rejection, precision and metadata preservation');

vm.runInContext(`(() => {
	const assert = (condition, message) => { if (!condition) throw new Error(message); };
	const a = { id: 'cycles', name: 'Cycles', type: 'shape', animations: ['pulse', 'rotate'].map((type, index) => GlitterAnimation.normalizeAnimation({ id: type, type, periodMs: 1000 + index * 500, delayMs: 200, phase: .25, direction: 'reverse' })) };
	const windowLayer = { id: 'range', type: 'shape', appear: { start: 300, end: 1400 } };
	const gif = { id: 'gif', type: 'sticker', stickerData: {} };
	let commits = 0, previews = 0, current = true, copies = 0;
	const editor = { layers: [a, windowLayer, gif], layerManager: { getLayerById: id => editor.layers.find(layer => layer.id === id), serializeLayer(layer) { copies++; return structuredClone(layer); } },
		sceneCompositor: { describeAuthoredTiming: layer => layer.stickerData ? [{ descriptor: { key: layer.id, timingRecord: layer.stickerData, label: 'GIF' }, timing: { file: [500, 500], delays: [layer.stickerData.gifCycleMs || 1000], range: { min: 500, max: 2000 } } }] : [] },
		requestPreviewUpdate() { previews++; }, commitAnimationTiming() { commits++; }, isLoopEstimateCurrent: () => current, updateStatus() {}, showError() {} };
	for (const name of ['writeTiming', 'writeTimingBatch', 'applyTimingPlan']) editor[name] = EDITOR_ANIMATION_LOOP_METHODS[name];
	for (const name of ['copyTiming', 'pasteTiming', 'planTimingGroup', 'applyTimingGroup', 'animationTimingGroupActions']) editor[name] = EDITOR_ANIMATION_EDIT_METHODS[name];
	const keys = a.animations.map(animation => GlitterAnimation.sourceKey(a.id, animation));
	const before = () => JSON.stringify({ layers: editor.layers, commits, previews, revision: editor.documentRevision });
	let saved = before();
	let result = editor.writeTimingBatch([{ key: keys[0], patch: { period: 1200 } }, { key: keys[1], patch: { period: 50000 } }]);
	assert(result.reason && before() === saved, 'a later out-of-range value refuses every earlier patch and metadata write');
	result = editor.writeTimingBatch([{ key: keys[0], patch: { period: 1200 } }, { key: 'missing', patch: { period: 1000 } }]);
	assert(result.reason && before() === saved, 'a missing source refuses the entire batch');
	for (const updates of [[null], [{key: keys[0], patch: {period: NaN}}], [{key: keys[0], patch: {}, restoreOriginal: true}], [{key: keys[0], patch: {}}, {key: keys[0], patch: {}}]]) assert(editor.writeTimingBatch(updates).reason && before() === saved, 'malformed/duplicate/invalid metadata batches write nothing');
	a.locked = true; saved = before();
	assert(editor.writeTimingBatch([{ key: 'gif', patch: {period: 1200} }, { key: keys[0], patch: {period: 1200} }]).reason && before() === saved, 'live locks prevent partial writes');
	a.locked = false;
	copies = 0;
	result = editor.writeTimingBatch(keys.map((key, index) => ({key, patch: {period: 1200 + index * 600}})));
	assert(result.changed && commits === 1 && previews === 1 && copies === 1, 'one owner copy, one publication and one history step for same-layer sources');
	assert(a.loopOriginalPeriods[keys[0]] === 1000 && a.loopOriginalPeriods[keys[1]] === 1500, 'batch cycle changes remember each original only once');
	editor.getLoopCandidate = () => ({ duration: 3600, fits: [...keys.map((key, index) => ({key, fitted: true, fittedPeriod: 900 + index * 900})), { key: 'gif', fitted: true, fittedPeriod: 900 }] });
	const fitAction = editor.animationTimingGroupActions([...keys, 'gif']).find(action => action.id === 'group-fit');
	current = false; saved = before(); fitAction.run();
	assert(before() === saved, 'Fit rechecks analysis rather than trusting an opened menu');
	current = true;
	assert(editor.applyTimingGroup([...keys, 'gif'], 'fit').changed && commits === 2 && previews === 2, 'selected Fit applies once across motion and GIF sources');
	assert(gif.stickerData.gifCycleMs === 900 && gif.loopOriginalPeriods.gif === 1000, 'Fit keeps GIF original-cycle metadata');
	saved = before();
	assert(editor.applyTimingGroup([...keys, '__appear_range'], 'fit').reason && before() === saved, 'a range-only source refuses a cycle Fit without skipping it');
	a.animations[1].iterations = 2; saved = before();
	assert(editor.applyTimingGroup(keys, 'fit').reason && before() === saved, 'finite runs cannot be implicitly retimed by Fit');
	result = editor.applyTimingGroup([...keys, '__appear_range', 'gif'], 'reset');
	assert(result.changed && commits === 3 && previews === 3 && !windowLayer.appear && !gif.stickerData.gifCycleMs && !a.loopOriginalPeriods && !gif.loopOriginalPeriods, 'Reset atomically restores remembered cycles and visibility absence');
	assert(a.animations.every(animation => animation.delayMs === 0 && animation.iterations === Infinity && animation.phase === 0 && animation.direction === 'normal'), 'Reset uses the same run/phase/direction order for every motion');
	assert(a.animations[0].periodMs === 1000 && a.animations[1].periodMs === 1500, 'Reset returns the original cycle values');
	editor.copyTiming(keys[0]);
	const partial = editor.planTimingGroup(['gif'], 'paste');
	assert(!partial.reason && partial.summary.includes('Not supported here') && partial.summary.includes('Starts/ends'), 'partial paste explains omitted dimensions');
	editor.timingClipboard.cycle = 1205;
	assert(editor.pasteTiming('gif') && gif.stickerData.gifCycleMs === 1210, 'GIF paste uses representable delay quantization');
	assert(editor.planTimingGroup(['gif'], 'paste').summary.includes('1.21 s'), 'paste summary reports the accepted quantized cycle');
	saved = before(); editor.timingClipboard.cycle = 3000;
	assert(!editor.pasteTiming('gif') && before() === saved, 'an unrepresentable paste preserves all timing and history');
	editor.copyTiming('__appear_range');
	a.animations[0].phase = .5; a.animations[0].delayMs = 600;
	assert(editor.pasteTiming(keys[0]) && a.animations[0].delayMs === 0 && a.animations[0].periodMs === 1000 && a.animations[0].phase === .5, 'a visibility copy pastes run-only through the API without an undefined cycle or accidental offset reset');
	windowLayer.appear = { start: 300, end: 1400 }; editor.copyTiming('__appear_range'); windowLayer.appear.start = 900;
	assert(editor.timingClipboard.appear.start === 300 && editor.timingClipboard.run.start === 300, 'timing copies are independent of later source edits');
	editor.copyTiming(keys[0]);
	assert(editor.applyTimingGroup([keys[1], '__appear_range'], 'paste').changed && !windowLayer.appear, 'mixed-target paste applies compatible dimensions and canonical always-visible absence atomically');
	a.loopOriginalPeriods = {[keys[0]]: a.animations[0].periodMs};
	const metaRevision = editor.documentRevision, metaCommits = commits;
	assert(editor.applyTimingGroup([keys[0]], 'reset').changed && !a.loopOriginalPeriods && editor.documentRevision > metaRevision && commits === metaCommits + 1, 'metadata-only restoration remains one undoable action');
})()`, context);
console.log('PASS atomic Fit/Reset and capability-aware paste, stale analysis, GIF quantization, copies, limits and original metadata');
