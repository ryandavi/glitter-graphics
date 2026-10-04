'use strict';

// js/ui/slider.js: the one arrow-key step for numeric controls, the focus
// rule that decides whether arrows nudge the layer, and the live-apply
// scheduler that picks an update cadence from a field's cost.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');

// A manual clock: frames and timers run only when the test says so.
const clock = { now: 0, frames: new Map(), timers: new Map(), nextId: 1 };
const context = vm.createContext({
	console,
	Math,
	navigator: { hardwareConcurrency: 4, userAgent: 'node' },
	performance: { now: () => clock.now },
	requestAnimationFrame: (run) => { const id = clock.nextId++; clock.frames.set(id, run); return id; },
	cancelAnimationFrame: (id) => clock.frames.delete(id),
	setTimeout: (run, ms) => { const id = clock.nextId++; clock.timers.set(id, { run, at: clock.now + ms }); return id; },
	clearTimeout: (id) => clock.timers.delete(id),
	Event: class Event { constructor(type, init = {}) { this.type = type; this.bubbles = Boolean(init.bubbles); } }
});
['js/core/releases.js', 'js/core/fields.js', 'js/core/config.js', 'js/ui/slider.js'].forEach((file) => {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
});
const run = (code) => vm.runInContext(code, context);

function runFrame() {
	const frames = [...clock.frames.values()];
	clock.frames.clear();
	frames.forEach((frame) => frame());
}
function advance(ms) {
	clock.now += ms;
	[...clock.timers.entries()].filter(([, timer]) => timer.at <= clock.now).forEach(([id, timer]) => {
		clock.timers.delete(id);
		timer.run();
	});
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

// ===== stepNumericControl =====

const stepNumericControl = run('stepNumericControl');
const currentStepCoalesceKey = run('currentStepCoalesceKey');

function makeInput(type, attrs) {
	const input = {
		tagName: 'INPUT', type, id: attrs.id || '', min: '', max: '', step: '', value: '0', disabled: false, readOnly: false,
		events: [], keys: [],
		dispatchEvent(event) { this.events.push(`${event.type}${event.bubbles ? '' : ':nobubble'}`); this.keys.push(currentStepCoalesceKey()); },
		...attrs
	};
	return input;
}
function step(input, direction, modifiers) {
	input.events = [];
	const changed = stepNumericControl(input, direction, modifiers);
	return { changed, value: Number(input.value), events: input.events };
}

// Plain, Shift and clamping on a number field.
let field = makeInput('number', { id: 'posX', min: '0', max: '100', step: '1', value: '10' });
assert.deepStrictEqual(step(field, 1), { changed: true, value: 11, events: ['input', 'change'] }, 'a step fires input then change, bubbling');
assert.strictEqual(step(field, -1).value, 10, 'ArrowDown steps back');
assert.strictEqual(step(field, 1, { shift: true }).value, 20, 'Shift is x10');
field.value = '95';
assert.strictEqual(step(field, 1, { shift: true }).value, 100, 'a step clamps to max');
assert.deepStrictEqual(step(field, 1), { changed: false, value: 100, events: [] }, 'a step at the limit changes nothing and fires nothing');
field.value = '3';
assert.strictEqual(step(field, -1, { shift: true }).value, 0, 'a step clamps to min');

// One step, one value change: nothing double-steps.
field = makeInput('number', { id: 'w', min: '1', step: '1', value: '50' });
assert.strictEqual(step(field, 1, { shift: true }).value, 60, 'Shift+Up moves exactly ten');
assert.strictEqual(step(makeInput('number', { value: '7' }), -1).value, 6, 'a field with no step attribute steps by 1');
assert.strictEqual(step(makeInput('number', { value: '' }), 1).value, 1, 'an empty field steps from 0');
assert.strictEqual(step(makeInput('number', { min: '1', value: '-5' }), 1).value, 1, 'an out-of-range value steps back into range');

// Off-grid values land on the grid, and fractional steps stay exact.
assert.strictEqual(step(makeInput('number', { step: '1', value: '10.4' }), 1).value, 11, 'an off-grid value steps onto the grid');
field = makeInput('number', { min: '0', max: '100', step: '0.1', value: '0.2' });
assert.strictEqual(step(field, 1).value, 0.3, 'a fractional step has no float noise');
assert.strictEqual(step(field, 1, { shift: true }).value, 1.3, 'Shift is x10 of a fractional step');
field = makeInput('number', { min: '120', max: '20000', step: '10', value: '1400' });
assert.strictEqual(step(field, 1).value, 1410, 'steps count from min');

// Alt is a fine step only where there is no grid to fall off.
field = makeInput('number', { min: '0', max: '10', step: '1', value: '5' });
assert.deepStrictEqual(step(field, 1, { alt: true }), { changed: false, value: 5, events: [] }, 'Alt does nothing on a gridded field');
field = makeInput('number', { step: 'any', value: '5' });
assert.strictEqual(step(field, 1, { alt: true }).value, 5.1, 'Alt is x0.1 on a gridless field');
assert.strictEqual(step(field, 1).value, 6.1, 'a gridless field steps by 1');

// Sliders step in their raw track domain, so a log slider steps one position.
let slider = makeInput('range', { id: 'opacity', min: '0', max: '100', step: '', value: '50' });
assert.strictEqual(step(slider, 1).value, 51);
assert.strictEqual(step(slider, -1, { shift: true }).value, 41);
assert.deepStrictEqual(step(slider, 1, { alt: true }).events, [], 'Alt never steps a slider off its grid');
slider = makeInput('range', { min: '0', max: '1000', step: '1', value: '1000', dataset: { scale: 'log', scaleMin: '1', scaleMax: '1000' } });
assert.strictEqual(step(slider, 1).changed, false, 'a slider at its end does not move');
assert.strictEqual(step(slider, -1).value, 999, 'a log slider steps one track position');
slider = makeInput('range', { value: '95' });
assert.strictEqual(step(slider, 1, { shift: true }).value, 100, 'a slider with no attributes uses the 0..100 default');

// Disabled and read-only controls do not step.
assert.strictEqual(step(makeInput('number', { value: '1', disabled: true }), 1).changed, false);
assert.strictEqual(step(makeInput('number', { value: '1', readOnly: true }), 1).changed, false);

// The editable readout beside a slider steps that slider.
slider = makeInput('range', { id: 'size', min: '1', max: '64', value: '6' });
const readout = { tagName: 'SPAN', closest: () => ({ querySelector: () => slider }) };
assert.strictEqual(stepNumericControl(readout, 1), true);
assert.strictEqual(slider.value, '7', 'a readout steps its slider');

// History: every save a step triggers shares one key, and only while it runs.
field = makeInput('number', { id: 'posY', value: '4' });
step(field, 1);
assert.strictEqual(new Set(field.keys).size, 1, 'input and change of one step share a key');
assert(/^step:posY:/.test(field.keys[0]), `step key names the control (${field.keys[0]})`);
assert.strictEqual(currentStepCoalesceKey(), null, 'no key outside a step');
const firstKey = field.keys[0];
field.keys = [];
step(field, 1);
assert.strictEqual(field.keys[0], firstKey, 'repeated steps on a control coalesce');
const anonymous = makeInput('number', { value: '1' });
step(anonymous, 1);
assert(/^step:control\d+:/.test(anonymous.keys[0]), 'a control without an id still gets a stable key');
assert.notStrictEqual(anonymous.keys[0], firstKey);

// ===== focusKeyClaim: who owns the arrows =====

const focusClaimsArrowKey = run('focusClaimsArrowKey');
const focusKeyClaim = run('focusKeyClaim');
const element = (tagName, extra = {}) => ({ tagName, closest: () => null, ...extra });
const inside = (selector) => element('BUTTON', { closest: (query) => (query.includes(selector) ? {} : null) });

assert.strictEqual(focusClaimsArrowKey('ArrowLeft', null), false, 'no focus: arrows nudge');
assert.strictEqual(focusClaimsArrowKey('ArrowLeft', element('BODY')), false);
assert.strictEqual(focusClaimsArrowKey('ArrowUp', element('SELECT')), true, 'a select keeps its arrows');
assert.strictEqual(focusKeyClaim(element('SELECT')).typing, false, 'a select is not a typing target');
assert.strictEqual(focusClaimsArrowKey('ArrowUp', element('INPUT', { type: 'number' })), true);
assert.strictEqual(focusClaimsArrowKey('ArrowLeft', element('INPUT', { type: 'range' })), true);
assert.strictEqual(focusClaimsArrowKey('ArrowLeft', element('INPUT', { type: 'radio' })), true);
assert.strictEqual(focusClaimsArrowKey('ArrowLeft', element('TEXTAREA')), true);
assert.strictEqual(focusClaimsArrowKey('ArrowLeft', element('SPAN', { isContentEditable: true })), true);
assert.strictEqual(focusClaimsArrowKey('ArrowUp', element('INPUT', { type: 'checkbox' })), false, 'a toggle has no use for arrows');
assert.strictEqual(focusKeyClaim(element('INPUT', { type: 'checkbox' })).typing, true, 'the shortcut guard is unchanged for inputs');
assert.strictEqual(focusClaimsArrowKey('ArrowUp', element('BUTTON')), false, 'a button has no use for arrows');
assert.strictEqual(focusClaimsArrowKey('ArrowRight', inside('[role="slider"]')), true);
assert.strictEqual(focusClaimsArrowKey('ArrowRight', inside('[role="grid"]')), true);
assert.strictEqual(focusClaimsArrowKey('ArrowRight', inside('[data-picker-navigation]')), true);
assert.strictEqual(focusClaimsArrowKey('ArrowDown', inside('[role="listbox"]')), true, 'a list keeps Up and Down');
assert.strictEqual(focusClaimsArrowKey('ArrowRight', inside('[role="listbox"]')), false, 'a list leaves Left and Right to the layer');

// ===== live-apply scheduler =====

const scheduleLiveApply = run('scheduleLiveApply');
const flushLiveApply = run('flushLiveApply');
const settleMs = run('CONFIG.ui.live.settleMs');
const rasterBudgetMs = run('CONFIG.ui.live.rasterBudgetMs');
assert(settleMs > 0 && rasterBudgetMs > 0);
assert.strictEqual(run('CONFIG.tools.selection.timing'), undefined, 'the old slider debounce key is gone');
assert.strictEqual(run('FIELDS.slotOpacity.cost'), 'style', 'cost defaults to style');
assert.strictEqual(run('FIELDS.bevelSize.cost'), 'raster');
assert.strictEqual(run('FIELDS.threshold.cost'), 'compute');
Object.entries(run('FIELDS')).forEach(([name, spec]) => {
	assert(['style', 'raster', 'compute'].includes(spec.cost), `FIELDS.${name}.cost "${spec.cost}"`);
});

(async () => {
	// style: any number of ticks in a frame run once, with the newest value.
	let ran = [];
	[1, 2, 3].forEach((value) => scheduleLiveApply('a', 'style', () => { ran.push(value); }));
	assert.deepStrictEqual(ran, [], 'nothing runs inside the input event');
	assert.strictEqual(clock.frames.size, 1, 'one frame for three ticks');
	runFrame();
	assert.deepStrictEqual(ran, [3], 'the newest value wins');
	runFrame();
	assert.deepStrictEqual(ran, [3], 'an idle control schedules nothing');

	// Release flushes: the waiting value runs at once and the frame is dropped.
	ran = [];
	scheduleLiveApply('a', 'style', () => { ran.push('drag'); });
	scheduleLiveApply('a', 'style', () => { ran.push('final'); });
	assert.strictEqual(flushLiveApply('a'), undefined, 'a sync apply leaves nothing to wait for');
	assert.deepStrictEqual(ran, ['final'], 'flush runs the final value immediately');
	runFrame();
	assert.deepStrictEqual(ran, ['final'], 'the flushed frame does not run again');
	assert.strictEqual(flushLiveApply('never-scheduled'), undefined);

	// Keys are independent.
	ran = [];
	scheduleLiveApply('a', 'style', () => { ran.push('a'); });
	scheduleLiveApply('b', 'style', () => { ran.push('b'); });
	runFrame();
	assert.deepStrictEqual(ran.sort(), ['a', 'b']);

	// raster: tracks the frame while fast, drops to settle after a slow run,
	// and comes back once a run is fast again.
	ran = [];
	const raster = (value, cost) => scheduleLiveApply('r', 'raster', () => { clock.now += cost; ran.push(value); });
	raster(1, rasterBudgetMs + 1);
	runFrame();
	assert.deepStrictEqual(ran, [1]);
	raster(2, 1);
	assert.strictEqual(clock.frames.size, 0, 'a slow control stops using frames');
	advance(settleMs - 1);
	raster(3, 1);
	advance(settleMs - 1);
	assert.deepStrictEqual(ran, [1], 'a slow control waits for the value to settle');
	advance(1);
	assert.deepStrictEqual(ran, [1, 3], 'the settled value is the newest one');
	raster(4, 1);
	assert.strictEqual(clock.frames.size, 1, 'a fast run returns the control to frames');
	runFrame();
	assert.deepStrictEqual(ran, [1, 3, 4]);

	// A slow control still flushes on release.
	raster(5, rasterBudgetMs + 1);
	runFrame();
	raster(6, 1);
	flushLiveApply('r');
	assert.deepStrictEqual(ran.slice(-2), [5, 6], 'release does not wait for the settle timer');
	advance(settleMs);
	assert.deepStrictEqual(ran.slice(-2), [5, 6], 'the cancelled settle timer never fires');

	// style never drops to settle, however slow.
	scheduleLiveApply('s', 'style', () => { clock.now += 1000; });
	runFrame();
	scheduleLiveApply('s', 'style', () => {});
	assert.strictEqual(clock.frames.size, 1, 'a style control always tracks the frame');
	runFrame();

	// Latest-wins over async work: one run in flight, one value waiting.
	const started = [];
	const finished = [];
	const gates = [];
	const asyncRun = (value) => (ticket) => {
		started.push(value);
		return new Promise((resolve) => gates.push(() => {
			if (ticket.isCurrent()) finished.push(value);
			resolve();
		}));
	};
	scheduleLiveApply('t', 'style', asyncRun('a'));
	runFrame();
	scheduleLiveApply('t', 'style', asyncRun('b'));
	scheduleLiveApply('t', 'style', asyncRun('c'));
	runFrame();
	assert.deepStrictEqual(started, ['a'], 'nothing starts while a run is in flight');
	gates.shift()();
	await settle();
	assert.deepStrictEqual(finished, ['a'], 'a run that nothing overtook still draws');
	runFrame();
	assert.deepStrictEqual(started, ['a', 'c'], 'the newest waiting value starts when the run returns; b is dropped');

	// Flush over a run in flight: the final value starts now, the older run's
	// ticket goes stale, and the caller can wait for the final one.
	scheduleLiveApply('t', 'style', asyncRun('d'));
	const settled = flushLiveApply('t');
	assert.deepStrictEqual(started, ['a', 'c', 'd'], 'release starts the final value over the run in flight');
	assert(settled && typeof settled.then === 'function', 'flush returns the final run');
	let committed = false;
	settled.then(() => { committed = true; });
	gates.shift()();
	await settle();
	assert.deepStrictEqual(finished, ['a'], 'the overtaken run (c) must not draw');
	assert.strictEqual(committed, false, 'the commit waits for the final run');
	gates.shift()();
	await settle();
	assert.deepStrictEqual(finished, ['a', 'd'], 'the final value draws');
	assert.strictEqual(committed, true);
	assert.strictEqual(flushLiveApply('t'), undefined, 'nothing left in flight');
	assert.strictEqual(clock.frames.size + clock.timers.size, 0, 'the scheduler ends idle');

	// A run that throws leaves the control usable.
	scheduleLiveApply('e', 'style', () => { throw new Error('boom'); });
	assert.throws(() => runFrame(), /boom/);
	ran = [];
	scheduleLiveApply('e', 'style', () => { ran.push('after'); });
	runFrame();
	assert.deepStrictEqual(ran, ['after']);

	// The implementations this replaced must stay deleted.
	const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
	['js/ui/panel-renderer.js', 'js/ui/paint-slot-controls.js', 'js/editor/transform-interaction.js'].forEach((file) => {
		read(file).split('\n').forEach((line, index) => {
			assert(!/event\.key\s*[!=]==\s*'Arrow(Up|Down)'/.test(line), `${file}:${index + 1} steps on arrow keys; use stepNumericControl`);
		});
	});
	assert(!/debouncedSliderUpdate|sliderDebounceMs/.test(['js/app.js', 'js/editor/disclosures.js', 'js/core/config.js', 'js/ui/slider.js'].map(read).join('\n')), 'the slider debounce must stay deleted');
	assert((read('js/ui/slider.js').match(/addEventListener\('keydown'/g) || []).length === 1, 'one delegated keydown listener');

	process.stdout.write('Numeric controls unit passed (step, focus claim, live-apply scheduler)\n');
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
