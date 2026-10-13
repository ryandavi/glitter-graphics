'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const motion = { periodMs: 1000, easing: 'linear', amount: 10, direction: 'normal', iterations: Infinity };
const context = vm.createContext({ isLayerFullyLocked: layer => layer.locked, CONFIG: { tools: { animation: { defaultType: 'pulse', presets: { pulse: motion, custom: motion }, jitterQuantMs: 60, keySeek: { samples: 128, iterations: 24, tolerance: 1e-7 } } } } });
for (const file of ['js/core/format.js', 'js/core/gif-decode.js', 'js/export/ExportTimeline.js', 'js/core/math.js', 'js/effects/easing.js', 'js/effects/animation.js', 'js/ui/timeline-view.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
const { view, Authored, Procedural } = vm.runInContext('({ view: TimelineView, Authored: AuthoredAnimationSource, Procedural: ProceduralAnimationSource })', context);
const json = value => JSON.parse(JSON.stringify(value));
assert.equal(vm.runInContext('formatSeconds(1230)', context), '1.23 s');
assert.equal(vm.runInContext('formatSeconds(1230, { unit: false })', context), '1.23');
assert.equal(view.motionIndex({ effectSlot: 'animation-0' }), 0);
assert.equal(view.motionIndex({ effectSlot: 'animation-12' }), 12);
assert.equal(view.motionIndex({ effectSlot: 'fill' }), null);
assert.equal(view.motionIndex({ effectSlot: 'animation-nope' }), null);
assert.equal(view.motionIndex(null), null);
// A key is drawn at the time its motion reaches it, in one cycle of the bar.
const keyRow = (entry, run = { start: entry.delayMs || 0, end: Infinity }) => ({
	startMs: run.start, endMs: Math.min(run.end, 4800), cycleMs: entry.periodMs, exportCycleMs: entry.periodMs,
	phase: entry.phase || 0, direction: entry.direction || 'normal', source: { run }
});
const keyed = options => ({ type: 'custom', periodMs: 1600, keys: [{ at: 0, values: { tx: 0 } }, { at: 0.35, values: { tx: 40 } }], ...options });
const plain = keyed({});
assert(Math.abs(view.keyToTime(keyRow(plain), plain, 0.35, 0).ms - 560) < 0.001, 'A key at 35% of a 1.6 s cycle sits at 0.56 s');
assert(Math.abs(view.keyToTime(keyRow(plain), plain, 0.35, 2).ms - 3760) < 0.001);
assert.strictEqual(view.keyCycle(keyRow(plain), 2000), 1, 'The lane opens the cycle the playhead is in');
assert.deepStrictEqual(json(view.cycleSpan(keyRow(plain), 1)), { start: 1600, end: 3200 });
const trimmedMotion = keyed({ delayMs: 600, iterations: 2 });
const trimmedRow = keyRow(trimmedMotion, { start: 600, end: 3800 });
assert.strictEqual(view.keyCycle(trimmedRow, 100), 0, 'Outside the run the lane opens the first whole cycle');
assert.strictEqual(view.keyCycle(trimmedRow, 4000), 0);
assert.strictEqual(view.keyCycle(keyRow(keyed({ phase: 0.25 })), -1), 1);
for (const [name, options] of Object.entries({
	linear: {}, eased: { easing: 'easeInOut' }, alternate: { direction: 'alternate', easing: 'easeOut' }, reverse: { direction: 'reverse' },
	phase: { phase: 0.25, easing: 'easeIn' }, trimmed: { delayMs: 600, iterations: 2, easing: 'ease' }
})) {
	const entry = keyed(options);
	const row = keyRow(entry, { start: entry.delayMs || 0, end: Number.isFinite(entry.iterations) ? (entry.delayMs || 0) + entry.iterations * entry.periodMs : Infinity });
	for (const index of [view.keyCycle(row, -1), view.keyCycle(row, -1) + 1]) for (const at of [0.1, 0.35, 0.5, 0.9]) {
		const time = view.keyToTime(row, entry, at, index);
		const span = view.cycleSpan(row, index);
		assert(!time.untimed && time.ms >= span.start && time.ms <= span.end, `${name}: a key has a time inside its cycle`);
		assert(Math.abs(view.timeToKey(row, entry, time.ms, index) - at) < 0.001, `${name}: draw and drag agree at ${at}`);
	}
}
const stepped = keyed({ easing: 'steps', steps: 4 });
assert.deepStrictEqual(json(view.keyToTime(keyRow(stepped), stepped, 0.35, 0)), { ms: 560, untimed: true }, 'A stepping motion draws its keys at their linear place');
assert(Math.abs(view.timeToKey(keyRow(stepped), stepped, 560, 0) - 0.35) < 1e-9);
assert.strictEqual(view.timeToKey(keyRow(plain), plain, -50, 0), 0, 'A drag stays inside the cycle');
for (const ms of [-500, 0, 600, 4800]) assert.strictEqual(view.xToTime(view.timeToX(ms, 135), 135), ms);
const row = { startMs: 0, endMs: 4800, cycleMs: 1400, phase: 0 };
assert.deepStrictEqual(json(view.cycleStarts(row, 4800)), [1400, 2800, 4200]);
assert.deepStrictEqual(json(view.cycleStarts({ ...row, phase: 0.5 }, 4800)), [700, 2100, 3500]);
assert.deepStrictEqual(json(view.cycleStarts({ startMs: 600, endMs: 1600, cycleMs: 1000, phase: 0 }, 4800)), []);
for (const direction of ['normal', 'reverse', 'alternate', 'alternate-reverse']) {
	const directed = { ...row, direction, phase: 0.25 };
	for (const time of [0, 200, 1050, 1600, 3000, 4799]) {
		const cycle = view.timeToCycle(directed, time);
		assert(Math.abs(view.cycleToTime(directed, cycle.index, cycle.progress) - time) < 1e-9, direction);
	}
}
assert.strictEqual(view.timeToCycle(row, -1), null);
assert.strictEqual(view.timeToCycle(row, 4800), null);
const setter = () => {};
const a = new Procedural({ key: 'a', rowLabel: 'Pulse', ownerLayerId: 'top', naturalPeriod: 1400, preferredSamplingRate: 30, setPeriod: setter, sampler: () => ({}) });
const b = new Procedural({ key: 'b', ownerLayerId: 'top', naturalPeriod: 1200, preferredSamplingRate: 30, sampler: () => ({}) });
const c = new Authored({ key: 'c', rowLabel: 'Fill', ownerLayerId: 'bottom', frameCount: 3, frameDurations: [100, 200, 100] });
assert.deepStrictEqual(json(c.cycleMarks), [0.25, 0.75]);
assert.strictEqual(a.withPeriod(1200).rowLabel, 'Pulse');
const marked = new Procedural({ key: 'marks', naturalPeriod: 1000, cycleMarks: [0.5], direction: 'reverse', preferredSamplingRate: 30 });
assert.deepStrictEqual(json(marked.withPeriod(1200).cycleMarks), [0.5]);
assert.strictEqual(marked.withPeriod(1200).direction, 'reverse');
const estimate = { duration: 4800, exact: false, outputFormat: 'gif', renderClock: { frameStarts: [0, 100], frameCount: 2 }, loopFit: { sources: [c, a, b, new Authored({ key: 'watermark', frameCount: 2, frameDurations: [100, 100] })] } };
const model = view.buildModel(estimate, [{ id: 'bottom', name: 'Bottom', locked: true }, { id: 'top', name: 'Top' }]);
assert.strictEqual(model.groups.length, 2);
const hidden = [{ id: 'gone', name: 'Gone', visible: false }, { id: 'other', name: 'Other', visible: false }];
assert.deepStrictEqual(json(view.buildModel(estimate, hidden, new Set(['gone'])).groups), [{ layerId: 'gone', name: 'Gone', rows: [] }], 'A listed layer that is hidden keeps an empty group');
assert.strictEqual(model.groups[0].layerId, 'top');
assert.strictEqual(model.groups[0].rows.length, 2);
assert.strictEqual(model.groups[0].rows[0].closes, false);
assert.strictEqual(model.groups[0].rows[1].closes, true);
assert.strictEqual(model.groups[0].rows[0].can.period, true);
assert.strictEqual(model.groups[0].rows[1].can.period, false);
assert.strictEqual(model.groups[1].locked, true);
assert.strictEqual(model.frameCount, 2);
const fitted = view.buildModel({ ...estimate, sourceAnalysis: [{ key: 'a', resolvedPeriod: 1200 }] }, [{ id: 'top' }]);
assert.strictEqual(fitted.groups[0].rows[0].closes, true);
assert.strictEqual(fitted.groups[0].rows[0].exportCycleMs, 1200);
assert.equal(view.buildModel(estimate, [{ id: 'top', loopOriginalPeriods: { a: 900 } }]).groups[0].rows[0].originalPeriod, 900);
const ticks = { tickSteps: [100, 200, 500, 1000, 2000, 5000], tickLabelMinPx: 110, minTickPx: 4 };
assert.deepEqual(json(view.tickStep(300, ticks)), { major: 500, minor: 100 });
assert.deepEqual(json(view.tickStep(1000, ticks)), { major: 200, minor: 40 });
assert.deepEqual(json(view.tickStep(300, { ...ticks, minTickPx: 31 })), { major: 500, minor: 250 });
assert.deepEqual(json(view.tickStep(300, { ...ticks, minTickPx: 30 })), { major: 500, minor: 100 });
assert.equal(view.tickLabel(500), '0.5 s');
assert.equal(view.tickLabel(1000), '1 s');
assert.equal(view.tickLabel(20000), '20 s');
assert.equal(view.tickLabel(40), '0.04 s');
assert.deepEqual(json(view.frameCells([0, 10, 20, 100, 200], 300, 100, 4)), [
	{ start: 0, end: 20, index: 0, plain: true }, { start: 20, end: 100, index: 2, plain: false },
	{ start: 100, end: 200, index: 3, plain: false }, { start: 200, end: 300, index: 4, plain: false }
]);
assert.deepEqual(json(view.frameCells([], 300, 100, 4)), []);
assert.deepEqual(json(view.frameCells([0, 40], 80, 100, 4)).map(cell => cell.plain), [false, false]);
assert.deepEqual(json(view.frameCells([0, 10, 20], 30, 100, 4)), [{ start: 0, end: 30, index: 0, plain: true }]);
assert.deepStrictEqual(json(view.buildModel(null, []).groups), []);
const starts = [0, 100, 250, 400];
assert.strictEqual(view.nearestFrameStart(starts, 160), 100);
assert.strictEqual(view.nearestFrameStart(starts, 190), 250);
assert.strictEqual(view.nearestFrameStart(starts, 900), 400);
assert.strictEqual(view.nearestFrameStart([], 42), 42);
assert.strictEqual(view.stepFrame(starts, 100, 1), 250);
assert.strictEqual(view.stepFrame(starts, 130, 1), 250);
assert.strictEqual(view.stepFrame(starts, 130, -1), 100, 'Stepping back inside a frame lands on its start');
assert.strictEqual(view.stepFrame(starts, 100, -1), 0);
assert.strictEqual(view.stepFrame(starts, 0, -1), 400, 'Stepping back from the start wraps');
assert.strictEqual(view.stepFrame(starts, 400, 1), 0, 'Stepping on from the last frame wraps');
assert.strictEqual(view.stepFrame([], 70, 1), 70);
assert.equal(view.snapTime(2040, [{ ms: 2000 }, { ms: 2100 }], 50).ms, 2000);
assert.equal(view.snapTime(2040, [{ ms: 2000 }], 30).ms, 2040);
assert.equal(view.snapTime(4790, [{ ms: 4800 }], 20).ms, 4800);
assert.equal(view.snapTime(1000, [{ ms: 1005, rank: 1 }, { ms: 1010, rank: 0 }], 20).ms, 1010);
const ranked = ['playhead', 'edge', 'loop', 'frame', 'ruler'];
for (let i = 1; i < ranked.length; i++) {
	const priority = ranked[i - 1], lesser = ranked[i];
	if (priority === 'playhead') continue;
	assert.equal(view.snapTime(1000, [{ ms: 1001, kind: lesser }, { ms: 1010, kind: priority }], 20).target.kind, priority);
}
assert.equal(view.snapTime(1000, [{ ms: 1010, kind: 'playhead' }, { ms: 1001, kind: 'edge' }], 20).target.kind, 'edge');
const trimmed = { startMs: 600, endMs: 2600, cycleMs: 1000, phase: 0, source: { run: { start: 600, end: 2600 } } };
assert.deepEqual(json(view.runFromLeftEdge(trimmed, 900)), { start: 900, end: 2600 });
assert.deepEqual(json(view.runFromBodyMove(trimmed, 300)), { start: 900, end: 2900 });
assert.deepEqual(json(view.runFromBodyMove(trimmed, -1000)), { start: 0, end: 2000 });
assert.equal(view.runFromRightEdge(trimmed, 4800, 4800).end, Infinity);
assert.equal(view.runFromRightEdge(trimmed, 2040, 4800).end, 2040);
assert.equal(view.phaseFromSlip(trimmed, 500), 0.5);
assert.equal(view.phaseFromSlip({ ...trimmed, phase: 0.25 }, 500), 0.75);
assert.equal(view.periodFromNotch({ ...trimmed, startMs: 0 }, 2, 2400), 1200);
const gestureModel = { loopMs: 4800, groups: [{ layerId: 'visible', rows: [trimmed] },
	{ layerId: 'folded', rows: [{ key: 'hidden', startMs: 370, endMs: 870 }] },
	{ layerId: 'scrollable', rows: [{ key: 'offscreen', startMs: 1700, endMs: 2300 }] }],
	frameStarts: [0, 100], loopFit: { candidates: [{ duration: 4800, exact: true }, { duration: 4790, exact: false }] } };
const snapView = { scale: 300, config: ticks, frames: false, collapsed: new Map([['folded', true]]), endMs: 6000 };
assert(view.snapTargets(gestureModel, trimmed, 'right', 70).some(target => target.ms === 2600 && target.kind === 'cycle'));
for (const kind of ['move', 'left', 'duration']) {
	const targets = view.snapTargets(gestureModel, trimmed, kind, 70, snapView);
	assert(!targets.some(target => target.kind === 'frame'));
	assert(!targets.some(target => target.kind === 'edge' && target.ms === 370));
	assert(targets.some(target => target.kind === 'edge' && target.ms === 1700));
	assert.deepEqual(json(targets.filter(target => target.kind === 'loop').map(target => target.ms)), [0, 4800]);
	assert.deepEqual(json(targets.filter(target => target.kind === 'ruler').slice(0, 6).map(target => target.ms)), [0, 100, 200, 300, 400, 500]);
	assert.equal(targets.at(-1).ms, 6000);
	assert(view.snapTargets(gestureModel, trimmed, kind, 70, { ...snapView, frames: true }).some(target => target.ms === 100 && target.kind === 'frame'));
}
assert.equal(view.snapTargets(gestureModel, trimmed, 'loop')[0].exact, true);
assert.equal(view.snapTargets(gestureModel, trimmed, 'loop')[0].kind, 'fit');
assert.equal(view.snapTime(4790, view.snapTargets(gestureModel, trimmed, 'loop'), 20).ms, 4800);
const config = { barMinPx: 12, gripPx: 8 };
const outside = { ...row, startMs: 6000, endMs: 4800, exportCycleMs: 1400 };
assert.equal(view.timeToCycle(outside, 4800), null, 'A delayed bar has no cycle inside a shorter loop');
assert.deepEqual(json(view.cycleStarts(outside, 4800)), []);
assert.deepEqual(json(view.barBox(outside, 100, config)), { left: 600, width: 12, gripsOutside: true, leftGripInside: false });
vm.runInContext(fs.readFileSync(path.join(root, 'js/ui/timeline-dock.js'), 'utf8'), context);
const seamTitle = vm.runInContext('TimelineDock.prototype.seamTitle', context);
assert.equal(seamTitle.call({ model: { loopMs: 4800 } }, outside), 'Starts after the loop ends, so it never plays.');
assert.equal(view.hasGripRoom(23.99, config), false, 'A cycle needs room for two grips and a body');
assert.equal(view.hasGripRoom(24, config), true);
for (const cycleMs of [0, -1, Infinity, NaN]) {
	const badSource = { key: 'invalid', ownerLayerId: 'top', kind: 'procedural', naturalPeriod: cycleMs };
	assert.deepEqual(json(view.buildModel({ duration: 1000, loopFit: { sources: [badSource] } }, [{ id: 'top' }]).groups), []);
	assert.deepEqual(json(view.buildModel({ ...estimate, sourceAnalysis: [{ key: 'a', resolvedPeriod: cycleMs }] }, [{ id: 'top' }]).groups[0].rows.map(entry => entry.key)), ['b']);
}
assert.deepStrictEqual(json(view.barBox({ startMs: 0, endMs: 4800 }, 100, config)), { left: 0, width: 480, gripsOutside: false, leftGripInside: false });
assert.deepStrictEqual(json(view.barBox({ startMs: 1000, endMs: 1050 }, 100, config)), { left: 100, width: 12, gripsOutside: true, leftGripInside: false }, 'A short bar keeps a body and wears its grips outside');
assert.strictEqual(view.barBox({ startMs: 0, endMs: 50 }, 100, config).leftGripInside, true);
const can = (run, phase, period = false) => ({ can: { run, phase, period } });

const edges = { ...can(true, true, true), cycleMs: 1000, phase: 0, source: { run: { start: 0, end: 1000 } } };
assert.equal(view.edgeDrag(edges, 'left'), 'left');
assert.equal(view.edgeDrag(edges, 'right'), 'duration', 'A plays-once edge sets its length');
assert.equal(view.edgeDrag(edges, 'right', true), 'right');
for (const end of [2000, Infinity]) {
	const repeating = { ...edges, source: { run: { start: 0, end } } };
	assert.equal(view.edgeDrag(repeating, 'right'), 'duration');
	assert.equal(view.edgeDrag(repeating, 'right', true), 'right');
}
assert.equal(view.edgeDrag(can(false, false, true), 'right'), 'period', 'A GIF edge changes speed');
assert.equal(view.edgeDrag(can(false, false, true), 'right', true), 'period');
assert.equal(view.edgeDrag(can(false, false, true), 'left'), null);
assert.equal(view.edgeDrag(can(true, true), 'right', true), 'right', 'Fixed timing cannot stretch');
const durationRow = { ...edges, startMs: 0, source: { run: { start: 0, end: 2000 }, periodRange: { min: 100, max: 2000 } } };
assert.equal(view.durationRepeats(durationRow, 4800, 200), 2);
assert.equal(view.durationRepeats({ ...durationRow, source: { ...durationRow.source, run: { start: 0, end: Infinity } } }, 4800, 200), 5);
assert.equal(view.durationRepeats({ ...durationRow, phase: 0.75, cycleMs: 100, source: { ...durationRow.source, run: { start: 0, end: Infinity } } }, 20000, 200), 200);
assert.deepEqual(json(view.durationFromEdge(durationRow, 2, 1000)), { period: 500, run: { start: 0, end: 1000 } });
assert.deepEqual(json(view.durationFromEdge(durationRow, 2, 50)), { period: 100, run: { start: 0, end: 200 } }, 'The edge stops at the minimum cycle, keeping two repeats');
assert.deepEqual(json(view.durationFromEdge(durationRow, 2, 10000)), { period: 2000, run: { start: 0, end: 4000 } });
assert.deepEqual(json(view.durationFromEdge({ ...durationRow, phase: 0.25 }, 2, 1400)), { period: 800, run: { start: 0, end: 1400 } }, 'Duration preserves count and offset');
const quantized = { ...durationRow, source: { ...durationRow.source, resolvePeriod: ms => Math.round(ms / 100) * 100 } };
assert.deepEqual(json(view.durationFromEdge(quantized, 2, 1050)), { period: 500, run: { start: 0, end: 1000 } }, 'Representable cycles also decide the edge');
assert.equal(view.durationFromEdge({ ...durationRow, phase: 0.75 }, 0.5, 1000), null, 'A run consumed by its offset has no positive length to stretch');
assert.equal(view.dragReadout('duration', durationRow, { period: 500, run: { start: 0, end: 1000 } }, { period: 1000, run: { start: 0, end: 2000 } }, null), 'Lasts 1.00 s · 2 × 0.50 s (was 2.00 s · 2 × 1.00 s)');
assert.equal(view.revealScroll(400, 424, 0, 400), 24);
assert.equal(view.revealScroll(0, 24, 400, 400), 0);
assert.equal(view.revealScroll(450, 474, 400, 400), 400);
assert.strictEqual(view.bodyDrag(can(true, true), false), 'move');
assert.strictEqual(view.bodyDrag(can(true, true), true), 'slip');
assert.strictEqual(view.bodyDrag(can(true, false), true), 'move');
assert.strictEqual(view.bodyDrag(can(false, true), false), 'slip');
assert.strictEqual(view.bodyDrag(can(false, false), false), null);
assert.strictEqual(view.rowHint(can(true, true)), 'Drag to move · left edge changes start · right edge trims repeats · Alt-drag slips · Enter selects · right-click or Shift+F10 for more');
assert.strictEqual(view.rowHint(can(false, true)), 'Drag to slip · Enter selects · right-click or Shift+F10 for more');
assert.strictEqual(view.rowHint(can(false, false)), 'Enter selects');
const full = { cycleMs: 1000, phase: 0, source: { run: { start: 0, end: Infinity } } };
assert.strictEqual(view.dragReadout('move', full, { start: 600, end: Infinity }, { start: 0, end: Infinity }, null), 'Starts at 0.60 s (was 0.00 s)');
assert.strictEqual(view.dragReadout('left', full, { start: 700, end: Infinity }, { start: 700, end: Infinity }, { kind: 'playhead' }), 'Starts at 0.70 s · playhead');
assert.strictEqual(view.dragReadout('right', full, { start: 0, end: 2500 }, { start: 0, end: Infinity }, { kind: 'edge' }), 'Repeats 2.5 (was forever) · another bar');
assert.strictEqual(view.dragReadout('right', full, { start: 0, end: Infinity }, { start: 0, end: 2000 }, { kind: 'loop' }), 'Repeats forever (was 2) · loop end');
assert.strictEqual(view.dragReadout('right', full, { start: 0, end: 2000 }, { start: 0, end: 1000 }, { kind: 'cycle' }), 'Repeats 2 (was 1) · whole cycle');
assert.strictEqual(view.dragReadout('slip', full, 0.25, 0, { kind: 'phase' }), 'Start offset 25% (was 0%) · quarter');
assert.strictEqual(view.dragReadout('period', full, 1200, 1000, { kind: 'period' }), 'Cycle 1.20 s (was 1.00 s) · fits the loop');
assert.strictEqual(view.dragReadout('loop', null, 4800, 4800, null), 'Loop 4.80 s');
assert.strictEqual(view.dragReadout('move', full, { start: 100, end: Infinity }, { start: 0, end: Infinity }, { kind: 'frame' }), 'Starts at 0.10 s (was 0.00 s) · frame');
assert.strictEqual(view.dragReadout('key', full, 0.35, 0.2, { kind: 'key' }), 'Key at 35% (was 20%) · another key');
assert.strictEqual(view.rowInfo({ kind: 'authored', frameCount: 12, cycleMs: 960 }), '12 frames · 0.96 s');
assert.strictEqual(view.rowInfo({ kind: 'procedural', cycleMs: 1000, phase: 0, source: { run: { start: 0, end: 2000 } } }), '2.00 s · 2 × 1.00 s');
assert.strictEqual(view.rowInfo({ kind: 'procedural', cycleMs: 1200, phase: 0, source: { run: { start: 0, end: Infinity } } }), '1.20 s');
console.log('PASS timeline grouping, metadata, seams, geometry, cycle and key conversions, playhead, gesture math and drag words');
