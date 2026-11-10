'use strict';

// Preview ranges are a transient transport constraint owned by the ticker;
// markers are document data with one-step history and no loop influence.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');

let now = 0;
const events = [];
const context = vm.createContext({
	performance: { now: () => now },
	requestAnimationFrame: () => 1, cancelAnimationFrame() {},
	window: { matchMedia: () => null, dispatchEvent: event => events.push(event.type) },
	CustomEvent: class { constructor(type) { this.type = type; } },
	PREFERENCES: { get: () => false }, navigator: { hardwareConcurrency: 4 },
	Math, Number, JSON, Object, Array, Set, Map, String, Infinity
});
for (const file of ['js/core/math.js', 'js/core/color.js', 'js/core/releases.js', 'js/core/fields.js', 'js/core/area.js', 'js/core/config.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/systems/AnimationTicker.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/editor/timeline.js'), 'utf8'), context);
vm.runInContext('this.isSameData = (a, b) => JSON.stringify(a) === JSON.stringify(b); this.CONFIG = CONFIG;', context);
const { AnimationTicker, CONFIG, methods, normalize } = vm.runInContext('({ AnimationTicker, CONFIG, methods: EDITOR_TIMELINE_METHODS, normalize: normalizeTimelineMarkers })', context);

// Ticker: an editor double with only what playback touches.
const editor = { previewWrapper: { addEventListener() {} }, previewFrameView: null, syncPlaybackControls() {}, setPlayback(playing) { ticker.setPaused(!playing); } };
const ticker = new AnimationTicker(editor);
ticker.subscribeTick(() => {});
ticker.setLoop(4000);
ticker.setPaused(true);
ticker.seek(500);
assert.equal(ticker.setPreviewRange({ start: 1000, end: 1020 }), null, 'A range shorter than the minimum is refused');
assert.equal(ticker.previewRange, null, 'A refused range leaves the transport unchanged');
assert.deepEqual({ ...ticker.setPreviewRange({ start: 1000, end: 2000 }) }, { start: 1000, end: 2000 });
assert.equal(ticker.getPlayheadTime(), 500, 'Setting a range does not move a paused playhead');
ticker.seek(3500);
assert.equal(ticker.getPlayheadTime(), 3500, 'Seeking outside the range stays possible while paused');
ticker.setPaused(false);
assert.equal(ticker.getPlayheadTime(), 1000, 'Play outside the range enters it at its start');
now += 600;
assert.equal(ticker.getPlayheadTime(), 1600, 'Inside the range time is document time');
now += 600;
assert.equal(ticker.getPlayheadTime(), 1200, 'Play wraps at the range end, not the loop end');
assert.equal(ticker.getCurrentTime(), 1200, 'Samplers see the same wrapped document time');
ticker.setPaused(true);
ticker.seek(1500);
ticker.setPaused(false);
now += 200;
assert.equal(ticker.getPlayheadTime(), 1700, 'Play from inside the range continues from the playhead');
ticker.setLoop(1500);
assert.deepEqual({ ...ticker.activeRange() }, { start: 1000, end: 1500 }, 'A shortened loop clips the range');
ticker.setLoop(900);
assert.equal(ticker.activeRange(), null, 'A range wholly past the loop end is inactive but kept');
assert.notEqual(ticker.previewRange, null);
ticker.setLoop(4000);
editor.previewFrameView = { exact: {} };
assert.equal(ticker.activeRange(), null, 'Preview export plays the full loop');
editor.previewFrameView = null;
ticker.setPaused(true);
ticker.goToRangeStart();
assert.equal(ticker.getPlayheadTime(), 1000);
ticker.goToStart();
assert.equal(ticker.getPlayheadTime(), 0, 'Go to loop start and Go to range start are distinct');
ticker.resetDocument();
assert.equal(ticker.previewRange, null, 'Document replacement clears the range');
assert(events.includes('previewRangeChanged'));

// Markers: normalized document data; every edit is one history step.
assert.deepEqual(JSON.parse(JSON.stringify(normalize([
	{ id: 'a', name: '  Hit  ', at: 1200.4 }, { id: 'a', name: 'Duplicate', at: 5 }, { id: 'b', name: '', at: -40 },
	{ id: '', at: 3 }, null, { id: 'c', at: 'x' }, { id: 'd', name: 'x'.repeat(80), at: 1e9 }
]))), [
	{ id: 'a', name: 'Hit', at: 1200 }, { id: 'b', name: 'Marker', at: 0 },
	{ id: 'd', name: 'x'.repeat(CONFIG.ui.timeline.markers.nameMaxLength), at: CONFIG.export.timeline.setLoopRange.max }
]);
const saved = [];
const doc = Object.assign(Object.create(methods), {
	documentMarkers: [], documentLoop: { mode: 'auto' },
	saveState(label, options) { saved.push([label, options?.coalesceKey || null]); }, updateStatus() {}
});
const loopBefore = JSON.stringify(doc.documentLoop);
const first = doc.addTimelineMarker(800);
const second = doc.addTimelineMarker(300, 'Intro');
assert.equal(first.name, 'Marker 1');
assert.deepEqual([...doc.getTimelineMarkers().map(marker => marker.name)], ['Intro', 'Marker 1'], 'Visible order follows time');
assert.equal(doc.renameTimelineMarker(first.id, '   '), false, 'An empty name is refused');
assert.equal(doc.renameTimelineMarker(first.id, 'Drop'), true);
assert.equal(doc.moveTimelineMarker(second.id, 300), false, 'An unchanged move writes no history');
assert.equal(doc.moveTimelineMarker(second.id, 2400, { commit: false }), true, 'A live drag writes without history');
assert.equal(doc.moveTimelineMarker(second.id, 2500, { coalesceKey: 'nudge' }), true);
assert.equal(doc.deleteTimelineMarker(first.id), true);
assert.deepEqual(saved, [['Add marker', null], ['Add marker', null], ['Rename marker', null], ['Move marker', 'nudge'], ['Delete marker', null]]);
assert.equal(JSON.stringify(doc.documentLoop), loopBefore, 'Markers never change the loop');
const kept = doc.documentMarkers;
doc.setTimelineMarkers([{ id: 'z', name: 'New', at: 10 }], null, { commit: false });
assert.notEqual(doc.documentMarkers, kept, 'Writes replace the array, so history snapshots can share it');
assert.deepEqual(JSON.parse(JSON.stringify(kept)), [{ id: second.id, name: 'Intro', at: 2500 }]);
console.log('PASS preview range wrapping, entry, clipping, exact-preview bypass and reset; marker normalization, ordering, history labels and loop independence');
