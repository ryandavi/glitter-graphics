'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const context = vm.createContext({ isLayerFullyLocked: layer => layer.locked });
for (const file of ['js/core/gif-decode.js', 'js/export/ExportTimeline.js', 'js/ui/timeline-view.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
const { view, Authored, Procedural } = vm.runInContext('({ view: TimelineView, Authored: AuthoredAnimationSource, Procedural: ProceduralAnimationSource })', context);
const json = value => JSON.parse(JSON.stringify(value));
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
assert.deepStrictEqual(json(view.buildModel(null, []).groups), []);
console.log('PASS timeline grouping, source metadata, seam rules, geometry and directed cycle conversions');
