'use strict';

const assert = require('assert');

const patternContext = require('../fixtures/pattern-source-context')();
const patternOffset = require('vm').runInContext('getPatternScrollOffset', patternContext);
for (const scroll of ['up', 'down', 'left', 'right', 'up-left', 'up-right', 'down-left', 'down-right']) {
	assert.strictEqual(JSON.stringify(patternOffset({ scroll }, 32, 0)), JSON.stringify(patternOffset({ scroll }, 32, 2000)));
	const halfway = patternOffset({ scroll }, 32, 1000);
	assert(Number.isInteger(halfway.x) && Number.isInteger(halfway.y));
}

global.GlitterEasing = require('../../js/effects/easing.js');
const Animation = require('../../js/effects/animation.js');
const types = Animation.ANIMATION_TYPES;
const presets = Object.fromEntries(types.map((type) => [type, {
	periodMs: 1000, easing: 'linear', amount: 10, distance: 20, radius: 20, turns: 1,
	duty: 50, opacityFloor: 20, direction: 'normal', iterations: Infinity,
	maxTrips: 12, maxCopies: 48, harmonics: { x: [{ frequency: 1, weight: 0.6 }, { frequency: 2, weight: 0.4 }], y: [{ frequency: 1, weight: 0.6 }, { frequency: 3, weight: 0.4 }] }
}]));
global.CONFIG = { tools: { animation: { defaultType: 'pulse', presets, jitterQuantMs: 60, keySeek: { samples: 128, iterations: 24, tolerance: 1e-7 } } } };

const keys = ['tx', 'ty', 'rotate', 'scaleX', 'scaleY', 'skewX', 'skewY', 'opacity', 'originX', 'originY', 'hue'];
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

assert(Animation.isSeamlessLoop({ type: 'rainbow', periodMs: 1000 }, {}, 1000.0001), 'Hue seam tolerance must work on both sides of a full turn');

assert.deepStrictEqual(Object.keys(Animation.MOTION_REGISTRY), Animation.ANIMATION_TYPES);
Animation.ANIMATION_TYPES.forEach((type) => {
	const entry = Animation.MOTION_REGISTRY[type];
	assert.strictEqual(entry.id, type);
	assert.strictEqual(typeof entry.needsBounds, 'boolean');
	assert(Array.isArray(entry.targets));
});
assert.strictEqual(Animation.MOTION_REGISTRY.marquee.needsBounds, true);
assert.strictEqual(Animation.MOTION_REGISTRY.rotate.targets.includes('particle'), true);
assert.strictEqual(Animation.MOTION_REGISTRY.tada.targets.includes('particle'), false);

types.forEach((type) => {
	const data = Animation.normalizeAnimation({ type });
	assert.strictEqual(data.type, type);
	const sample = Animation.sampleAt(data, 375, { id: 'layer-a' });
	assert.deepStrictEqual(Object.keys(sample), keys);
	assert(sample.opacity >= 0 && sample.opacity <= 1);
	assert(Number.isFinite(sample.scaleX) && Number.isFinite(sample.scaleY));
	assert.deepStrictEqual(sample, Animation.sampleAt(data, 375, { id: 'layer-a' }));
	if (!Number.isFinite(data.iterations)) {
		assert.strictEqual(Animation.loopDurationMs(data), Infinity);
		assert(Animation.isSeamlessLoop(data), `${type} should loop seamlessly`);
		const start = Animation.sampleAt(data, 0, { id: 'layer-a' });
		const end = Animation.sampleAt(data, data.periodMs, { id: 'layer-a' });
		keys.forEach((key) => assert(near(start[key], end[key]), `${type}.${key} seam`));
	}
});

assert.strictEqual(Animation.normalizeAnimation({ type: 'pulse', iterations: null }).iterations, Infinity);
assert.strictEqual(Animation.loopDurationMs({ type: 'pulse', iterations: 1 }), 1000);
assert.strictEqual(Animation.includesOffCanvas({ type: 'marquee' }), true);
assert.strictEqual(Animation.includesOffCanvas({ type: 'move' }), false);
assert.strictEqual(Animation.includesOffCanvas({ type: 'marquee', distance: 0 }), true);

// Every preset now loops indefinitely by default (no built-in "play once"
// transitions), but the engine still supports an explicit finite `iterations`
// override, so that mechanism gets covered directly here instead of via a
// dedicated one-shot preset.
['pulse', 'rotate', 'move'].forEach((type) => {
	const data = Animation.normalizeAnimation({ type, iterations: 1, fillMode: 'forwards' });
	assert.strictEqual(Animation.isSeamlessLoop(data), type !== 'rotate');
	assert.deepStrictEqual(
		Animation.sampleAt(data, data.periodMs, { id: 'transition' }),
		Animation.sampleAt(data, data.periodMs * 2, { id: 'transition' })
	);
});

const delayed = Animation.normalizeAnimation({ type: 'rotate', delayMs: 100, iterations: 1, fillMode: 'none' });
assert.strictEqual(Animation.sampleAt(delayed, 99).rotate, 0);
assert.strictEqual(Animation.sampleAt(delayed, 100).rotate, 0);
const backwards = { ...delayed, fillMode: 'backwards' };
assert.strictEqual(Animation.sampleAt(backwards, 99).rotate, 0);
const finalTick = Animation.sampleAt(delayed, 1099).rotate;
assert(finalTick > 359 && finalTick < 360);
assert.strictEqual(Animation.sampleAt(delayed, 1100).rotate, 0);
const forwardsHeld = Animation.sampleAt({ ...delayed, fillMode: 'forwards' }, 1100).rotate;
assert.strictEqual(forwardsHeld, 360);

const blink = Animation.normalizeAnimation({ type: 'blink', easing: 'linear', duty: 75 });
assert.strictEqual(Animation.sampleAt(blink, 0).opacity, 1);
assert.strictEqual(Animation.sampleAt(blink, 749).opacity, 1);
assert.strictEqual(Animation.sampleAt(blink, 750).opacity, 0);
assert.strictEqual(Animation.sampleAt(blink, 1000).opacity, 1);

const offsetPulse = Animation.normalizeAnimation({ type: 'pulse', phase: 0.25 });
assert.deepStrictEqual(
	Animation.sampleAt(offsetPulse, 0, { id: 'offset' }),
	Animation.sampleAt({ ...offsetPulse, phase: 0 }, offsetPulse.periodMs * 0.25, { id: 'offset' })
);

const verticalFloat = Animation.sampleAt({ ...presets.float, type: 'float', angle: 270 }, 125, { id: 'float' });
assert(near(verticalFloat.tx, 0));

const snapped = Animation.sampleAt({ ...presets.move, type: 'move', snapMode: 'pixel-snap' }, 330, { id: 'snap' });
assert(Number.isInteger(snapped.tx) && Number.isInteger(snapped.ty));
const normal = Animation.sampleAt({ ...presets.rotate, type: 'rotate' }, 250, { id: 'direction' });
const reverse = Animation.sampleAt({ ...presets.rotate, type: 'rotate', direction: 'reverse' }, 750, { id: 'direction' });
assert(near(normal.rotate, reverse.rotate));
assert.strictEqual(GlitterEasing.easingFn('linear')(0.37), 0.37);
assert.strictEqual(GlitterEasing.stepsEase(0.49, 2), 0);
assert.strictEqual(GlitterEasing.stepsEase(0.5, 2), 0.5);

const matrixSample = Animation.sampleAt({ ...presets.jello, type: 'jello' }, 250, { id: 'matrix' });
const cssNumbers = Animation.domTransformString(matrixSample).match(/-?\d+(?:\.\d+)?/g).map(Number);
assert.deepStrictEqual(cssNumbers, [
	matrixSample.tx, matrixSample.ty, matrixSample.rotate, matrixSample.scaleX,
	matrixSample.scaleY, matrixSample.skewX, matrixSample.skewY
]);
const calls = [];
const context = ['translate', 'rotate', 'scale', 'transform'].reduce((mock, method) => {
	mock[method] = (...args) => calls.push([method, ...args]);
	return mock;
}, {});
Animation.applyToContext(context, matrixSample, 80, 40);
assert.deepStrictEqual(calls[0], ['translate', matrixSample.tx, matrixSample.ty]);
assert.deepStrictEqual(calls[1], ['translate', matrixSample.originX * 80, matrixSample.originY * 40]);
assert.deepStrictEqual(calls.at(-1), ['translate', -matrixSample.originX * 80, -matrixSample.originY * 40]);

const bounds = Animation.createSamplingContext({ area: { width: 640, height: 480 }, rest: { left: 100, top: 100, right: 180, bottom: 140 }, id: 'bounds', seed: 7 });
assert.deepStrictEqual(
	Animation.sampleAt({ ...presets.rotate, type: 'rotate' }, 250, bounds),
	Animation.sampleAt({ ...presets.rotate, type: 'rotate' }, 250, bounds)
);
assert.strictEqual(Animation.isSeamlessLoop({ ...presets.rotate, type: 'rotate' }, bounds), true);


for (const entry of Object.values(Animation.MOTION_REGISTRY).filter((entry) => entry.needsBounds)) {
	const data = { type: entry.id };
	assert(Animation.isSeamlessLoop(data, bounds), `${entry.id} bounded loop`);
	assert.deepStrictEqual(Animation.sampleAt(data, 375), { tx: 0, ty: 0, rotate: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, opacity: 1, originX: 0.5, originY: 0.5, hue: 0 });
}
for (const width of [400, 800]) for (const turns of [1, 2, 3, 4]) {
	const context = Animation.createSamplingContext({ area: { width, height: 400 }, rest: { left: 50, top: 70, right: 90, bottom: 110 } });
	for (let t = 0; t <= 1000; t += 5) {
		const sample = Animation.sampleAt({ type: 'ricochet', turns, angle: 45 }, t, context);
		assert(context.rest.left + sample.tx >= -1e-6 && context.rest.right + sample.tx <= width + 1e-6);
		assert(context.rest.top + sample.ty >= -1e-6 && context.rest.bottom + sample.ty <= 400 + 1e-6);
	}
}
for (const angle of [0, 37, 90, 180, 270]) {
	for (const repeat of ['wrap', 'tile']) {
		const data = { type: 'marquee', angle, repeat, gap: 12 };
		assert(Animation.isSeamlessLoop(data, bounds));
		let previous = Animation.sampleAt(data, 0, bounds);
		let jumped = false;
		for (let t = 1; t < 1000; t++) {
			const next = Animation.sampleAt(data, t, bounds);
			assert.strictEqual(next.copies.length, previous.copies.length, `marquee ${repeat} ${angle} copy count changed mid-cycle`);
			if (Math.hypot(next.tx - previous.tx, next.ty - previous.ty) > 10) {
				const nearestCopy = Math.min(...next.copies.map(({ x, y }) => Math.hypot(next.tx + x - previous.tx, next.ty + y - previous.ty)));
				assert(nearestCopy < 2, `marquee ${repeat} ${angle} replicas did not meet at wrap`);
				jumped = true;
			}
			previous = next;
		}
		assert(jumped);
	}
	assert(Animation.isSeamlessLoop({ type: 'marquee', angle }, bounds));
	assert.strictEqual(Animation.sampleAt({ type: 'marquee', angle }, 250, bounds).copies, undefined, 'an unrepeated marquee draws once');
}
// Tiles sit one layer width plus the gap apart and cover the canvas at every offset.
for (let t = 0; t < 1000; t += 7) {
	const tiled = Animation.sampleAt({ type: 'marquee', angle: 0, repeat: 'tile', gap: 20 }, t, bounds);
	const lefts = tiled.copies.map(({ x }) => bounds.rest.left + tiled.tx + x).sort((a, b) => a - b);
	lefts.slice(1).forEach((left, index) => assert(near(left - lefts[index], 100), 'tile pitch is not width plus gap'));
	assert(lefts[0] <= 0 && lefts.at(-1) + 80 >= 640, 'tiles left part of the canvas empty');
}
// At an angle the neighbors touch on one pair of box edges, so that axis steps by size plus gap.
for (const [angle, gap, step] of [[45, 10, { x: 50, y: 50 }], [30, 0, { x: 69, y: 40 }], [300, 6, { x: 27, y: -46 }], [90, 4, { x: 0, y: 44 }]]) {
	const tiled = Animation.sampleAt({ type: 'marquee', angle, repeat: 'tile', gap }, 333, bounds);
	assert(Number.isInteger(tiled.tx) && Number.isInteger(tiled.ty), 'tiled offsets stay on whole pixels');
	assert(tiled.copies.some(({ x, y }) => x === step.x && y === step.y), `tile step at ${angle} is not ${JSON.stringify(step)}`);
}
assert(Animation.sampleAt({ type: 'marquee', angle: 0, repeat: 'tile' }, 250, { ...bounds, rest: { left: 100, top: 100, right: 101, bottom: 101 }, restVisual: { left: 100, top: 100, right: 101, bottom: 101 } }).copies.length <= 51, 'tile copies are not capped');
assert(near(Animation.travelSpeed({ type: 'drift', distance: 120, periodMs: 2000 }), 60), 'drift speed is distance over duration');
assert(near(Animation.travelSpeed({ type: 'marquee', angle: 0, repeat: 'wrap', periodMs: 4000 }, bounds), 160), 'a wrapped marquee crosses the canvas each cycle');
assert.strictEqual(Animation.travelSpeed({ type: 'pulse' }, bounds), 0, 'a motion that stays in place has no speed');
const square = Animation.createSamplingContext({ area: { width: 400, height: 400 }, rest: { left: 180, top: 180, right: 220, bottom: 220 } });
const angledBounce = Animation.sampleAt({ type: 'ricochet', angle: 30 }, 125, square);
assert(!near(Math.abs(angledBounce.tx), Math.abs(angledBounce.ty)), 'square ricochet still follows its diagonal');
assert.strictEqual(Animation.sampleAt({ type: 'ricochet', angle: 0 }, 125, square).ty, 0);
assert.strictEqual(Animation.sampleAt({ type: 'ricochet', angle: 90 }, 125, square).tx, 0);
assert.notDeepStrictEqual(Animation.sampleAt({ type: 'wander' }, 300, { ...bounds, id: 'a' }), Animation.sampleAt({ type: 'wander' }, 300, { ...bounds, id: 'b' }));
const oversized = Animation.createSamplingContext({ area: { width: 40, height: 400 }, rest: { left: -10, top: 70, right: 90, bottom: 110 } });
for (let t = 0; t <= 1000; t += 5) {
	const sample = Animation.sampleAt({ type: 'ricochet', angle: 45 }, t, oversized);
	assert.strictEqual(sample.tx, 0, 'oversized subject moved on its blocked axis');
	assert(oversized.rest.top + sample.ty >= -1e-6 && oversized.rest.bottom + sample.ty <= 400 + 1e-6);
}

const stacked = Animation.sampleAt([
	{ ...presets.move, type: 'move', angle: 0, distance: 20, opacityFloor: 0 },
	{ ...presets.rotate, type: 'rotate', turns: 1 },
	{ ...presets.rainbow, type: 'rainbow' },
	{ ...presets.rainbow, type: 'rainbow', direction: 'reverse' },
	{ ...presets.dim, type: 'dim', opacityFloor: 20 }
], 250, { id: 'stacked' });
assert(stacked.matrix, 'stacked animations should compose into one affine transform');
assert(near(stacked.tx, 20 * Math.sin(Math.PI * 0.25)));
assert(near(stacked.opacity, 1 - 0.8 * Math.sin(Math.PI * 0.25)));
assert(near(stacked.hue, 360));
assert(Animation.domTransformString(stacked).startsWith('matrix('));
assert.strictEqual(Animation.normalizeAnimations({ type: 'pulse' }).length, 1);
assert.strictEqual(Animation.summaryText([{ type: 'pulse' }, { type: 'rotate' }]), '2 animations');
assert.strictEqual(Animation.includesOffCanvas([{ type: 'move' }, { type: 'marquee' }]), true);
const repeatStack = Animation.sampleAt([{ type: 'marquee', angle: 0, repeat: 'wrap' }, { type: 'marquee', angle: 0, repeat: 'wrap' }], 250, bounds);
assert.strictEqual(repeatStack.copies.length, 5, 'overlapping repeat offsets must draw only once');
const rotatedRepeat = Animation.sampleAt([{ type: 'rotate', turns: 1, amount: 0 }, { type: 'marquee', angle: 0, repeat: 'wrap' }], 250, bounds);
assert(rotatedRepeat.copies.slice(1).every(({ x, y }) => near(x, 0) && near(Math.abs(y), 640)), 'stacked rotation must rotate repeat offsets');

const keyed = Animation.normalizeAnimation({ type: 'custom', keys: [
	{ at: 0, easing: 'linear', values: { tx: 0, rotate: 350, opacity: 1 } },
	{ at: 0.25, easing: 'linear', values: { scaleX: -1 } },
	{ at: 0.5, easing: 'linear', values: { tx: 100, rotate: 10, opacity: 0.2 } },
	{ at: 0.75, easing: 'linear', values: { scaleX: 1 } }
] });
const halfwayKey = Animation.sampleAt(keyed, 250);
assert(near(halfwayKey.tx, 50));
assert(near(halfwayKey.rotate, 360));
assert(near(halfwayKey.opacity, 0.6));
assert.strictEqual(halfwayKey.scaleX, -1);
assert.strictEqual(Animation.sampleAt(keyed, 0).scaleX, 0, 'Signed scales interpolate across the closing segment');
assert.strictEqual(Animation.sampleAt(keyed, 500).scaleX, 0);
assert(near(Animation.sampleAt(keyed, 750).tx, 50), 'A missing channel does not add a rest-pose key');
assert(Animation.isSeamlessLoop(keyed));
assert.deepStrictEqual(Animation.sampleAt(keyed, 0), Animation.sampleAt(keyed, 1000));
for (const channel of Object.values(Animation.POSE_CHANNELS)) {
	assert(Object.isFrozen(channel));
	assert.strictEqual(typeof channel.label, 'string');
	assert(Number.isFinite(channel.rest));
}
assert.strictEqual(Animation.interpolateChannel(Animation.POSE_CHANNELS.rotate, 0, -180, 0.5), 90);
assert.strictEqual(Animation.interpolateChannel(Animation.POSE_CHANNELS.scaleX, -1, 1, 0.5), 0);
const emptyCustom = Animation.normalizeAnimation({ type: 'custom', keys: [] });
assert(Animation.isActive(emptyCustom), 'An identity Custom still supplies an editable source');
assert.deepStrictEqual(Animation.sampleAt(emptyCustom, 345), Animation.sampleAt({ type: 'custom', keys: [{ at: 0.8, values: {} }] }, 789));
const singleCustom = { type: 'custom', keys: [{ at: 0.8, values: { ty: 12, hue: 90 } }] };
for (const time of [0, 150, 800, 990, 1234]) {
	assert.strictEqual(Animation.sampleAt(singleCustom, time).ty, 12);
	assert.strictEqual(Animation.sampleAt(singleCustom, time).hue, 90);
}
const authoredKeys = Object.freeze([
	Object.freeze({ at: 0.5, easing: 'easeIn', values: Object.freeze({ tx: 10, scaleX: -2 }) }),
	Object.freeze({ at: 1, values: Object.freeze({ opacity: 5, __unknown: 9 }) }),
	Object.freeze({ at: 0.5, easing: 'easeOut', values: Object.freeze({ ty: 20, tx: 30, hue: NaN }) }),
	Object.freeze({ at: -0.1, values: { tx: 40 } }), { at: Infinity }, { at: '0.5' }, null
]);
const normalizedKeys = Animation.normalizeKeys(authoredKeys);
assert.deepStrictEqual(normalizedKeys, [
	{ at: 0.5, easing: 'easeOut', values: { tx: 30, scaleX: -2, ty: 20 } },
	{ at: 1, easing: 'linear', values: { opacity: 1 } }
]);
normalizedKeys[1].values.tx = 999;
assert.strictEqual(authoredKeys[0].values.tx, 10);
const keyedEase = { type: 'custom', keys: [{ at: 0, easing: 'easeIn', values: { tx: 0 } }, { at: 0.5, values: { tx: 100 } }] };
const endPose = { type: 'custom', periodMs: 1000, iterations: 1, fillMode: 'forwards', easing: 'easeIn', keys: [{ at: 0, values: { tx: 0 } }, { at: 1, values: { tx: 100 } }] };
assert.strictEqual(Animation.sampleAt(endPose, 500).tx, 50, 'Custom positions are time, regardless of motion easing');
assert.strictEqual(Animation.sampleAt(endPose, 1000).tx, 100, 'A finite Custom run holds its explicit end key');
assert.strictEqual(Animation.sampleAt(endPose, 2000).tx, 100);
assert.strictEqual(Animation.isSeamlessLoop({ ...endPose, iterations: Infinity }), false, 'A looping explicit end pose reports its jump');
assert.strictEqual(Animation.isSeamlessLoop({ ...endPose, iterations: Infinity, direction: 'alternate' }, {}, 2000), true, 'Ping-pong can close a different end pose');
assert.strictEqual(Animation.sampleAt({ ...endPose, enabled: false }, 500).tx, 0);
assert.strictEqual(Animation.sampleAt([{ ...endPose, enabled: false }], 500).tx, 0, 'Disabled motions do not compose');
assert.strictEqual(Animation.isActive({ ...endPose, enabled: false }), false);
assert.strictEqual(Animation.sampleAt(keyedEase, 250).tx, 25, 'Outgoing segment easing applies once');
const steppedKeys = { type: 'custom', steps: 1, keys: [{ at: 0, easing: 'steps', values: { opacity: 1 } }, { at: 0.5, easing: 'steps', values: { opacity: 0 } }] };
assert.strictEqual(Animation.sampleAt(steppedKeys, 499).opacity, 1);
assert.strictEqual(Animation.sampleAt(steppedKeys, 500).opacity, 0);
assert.strictEqual(Animation.sampleAt(steppedKeys, 999).opacity, 0);
for (const direction of ['normal', 'reverse', 'alternate', 'alternate-reverse']) {
	const data = { ...keyed, direction, phase: 0.2, delayMs: 100, easing: 'easeInOut', iterations: 2.5, fillMode: 'both' };
	for (const time of [0, 99, 100, 500, 1250, 2200, 2400, 4000]) {
		const progress = Animation.cycleProgress(data, time);
		const sample = Animation.sampleAt(data, time);
		const intrinsic = Animation.sampleAt({ ...keyed, delayMs: 0, phase: progress.eased, direction: 'normal' }, 0);
		assert(near(sample.tx, intrinsic.tx));
			assert(near(sample.opacity, intrinsic.opacity));
	}
	assert.strictEqual(Animation.cycleProgress(data, 99, { fill: false }), null);
	assert.strictEqual(Animation.cycleProgress(data, 2400, { fill: false }), null);
}
const spinKeys = { type: 'custom', keys: [0, 0.25, 0.5, 0.75].map(at => ({ at, values: { rotate: at * 360, hue: at * 360 } })) };
for (const time of [125, 375, 625, 875]) {
	assert.strictEqual(Animation.sampleAt(spinKeys, time).rotate, time * 0.36);
	assert.strictEqual(Animation.sampleAt(spinKeys, time).hue, time * 0.36);
}
const customStack = Animation.sampleAt([keyed, { type: 'pulse', amount: 30 }], 250);
for (const direction of ['normal', 'reverse', 'alternate', 'alternate-reverse']) {
	for (const easing of ['linear', 'easeIn', 'easeInOut', 'bounceOut', 'elasticOut']) {
		const data = { ...keyed, direction, easing, delayMs: 100, phase: 0.2 };
		for (const time of [1100, 1600, 2450]) for (const at of [0, 0.25, 0.6]) {
			const found = Animation.timeAtProgress(data, at, time);
			if (direction === 'reverse' && at === 0) { assert.strictEqual(found, null, 'A reversed forever run jumps before the explicit zero endpoint can be sampled'); continue; }
			assert.notStrictEqual(found, null, `${direction}/${easing}/${at} has an occurrence`);
			const progress = Animation.cycleProgress(data, found, { fill: false });
			const actual = ((progress.eased % 1) + 1) % 1;
			assert(Math.min(Math.abs(actual - at), 1 - Math.abs(actual - at)) < 1e-6, `${direction}/${easing}/${at}: ${actual}`);
		}
	}
}
assert.strictEqual(Animation.timeAtProgress({ ...keyed, easing: 'steps' }, 0.25, 500), 250);
assert.strictEqual(Animation.timeAtProgress({ ...keyed, snapMode: 'step' }, 0.25, 500), 250);
assert.strictEqual(Animation.timeAtProgress({ ...keyed, delayMs: 100 }, 0.25, 99), 350, 'Seek enters the delayed run');
assert(near(Animation.timeAtProgress({ ...keyed, delayMs: 100, phase: 0.2, easing: 'bounceOut' }, 0.1, 100), 1000), 'Seek finds the key in the next reachable repetition');
assert.deepStrictEqual(customStack, Animation.composeSamples([Animation.sampleAt(keyed, 250), Animation.sampleAt({ type: 'pulse', amount: 30 }, 250)]));
const customCalls = [];
const customContext = Object.fromEntries(['translate', 'rotate', 'scale', 'transform'].map(method => [method, (...args) => customCalls.push([method, ...args])]));
Animation.applyToContext(customContext, halfwayKey, 80, 40);
assert.deepStrictEqual(customCalls[0], ['translate', halfwayKey.tx, halfwayKey.ty]);
assert.deepStrictEqual(customCalls[3], ['scale', halfwayKey.scaleX, halfwayKey.scaleY]);
assert(Animation.domTransformString(halfwayKey).includes(`rotate(${halfwayKey.rotate}deg)`));

// Convert to custom, measured against the shipped defaults and tolerances.
{
	const fs = require('fs'), path = require('path'), vm = require('vm');
	const context = { Math, Number, Infinity, navigator: { hardwareConcurrency: 4, userAgent: 'node' } };
	vm.createContext(context);
	for (const file of ['core/releases.js', 'core/fields.js', 'core/math.js', 'core/area.js', 'core/config.js', 'core/options.js', 'effects/easing.js', 'effects/animation.js']) {
		vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', file), 'utf8'), context);
	}
	const { Shipped, convert } = vm.runInContext('({ Shipped: GlitterAnimation, convert: CONFIG.tools.animation.convert })', context);
	context.describeLayer = layer => ({ name: layer.id });
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/export/SceneCompositor.js'), 'utf8'), context);
	const createSources = vm.runInContext('SceneCompositor.prototype._createLayerAnimationTimelineSources', context);
	const samplingContexts = [{}, bounds, { ...bounds, id: 'other', seed: 91, origin: [0.2, 0.8] }, { ...bounds, area: { width: 120, height: 90 }, restVisual: { left: -10, top: 4, right: 200, bottom: 130 } }];
	const samplingVariants = [{}, { delayMs: 120, phase: 0.37, iterations: 1.83, direction: 'alternate-reverse', fillMode: 'both' }, { delayMs: 300, phase: 0.8, iterations: 0.4, direction: 'reverse', fillMode: 'none' }];
	for (const type of Shipped.ANIMATION_TYPES) for (const variant of samplingVariants) {
		const entry = { id: 'prepared', type, ...variant, ...(type === 'custom' ? { keys: keyed.keys } : {}) };
		const layer = { id: 'prepared-layer', animations: [entry, { ...entry, id: 'disabled', enabled: false }] };
		for (const options of samplingContexts) {
			const sources = createSources.call({ editor: {}, _buildAnimationSamplingContext: () => options }, layer);
			const active = Shipped.isActive(entry);
			assert.strictEqual(sources.length, active ? 1 : 0, `${type}: prepared export excludes inactive entries`);
			if (!active) continue;
			const natural = Shipped.normalizeAnimation(entry).periodMs;
			for (const period of [natural, natural * 0.7, natural * 1.3, natural]) for (const time of [-1, 0, 119.999, 120, 300, 537, 1000, 2000, 6000]) {
				const expected = Shipped.sampleAt({ ...entry, periodMs: period }, time, options);
				assert.deepStrictEqual(sources[0].sampleAt(time, period).sample, expected, `${type}: prepared export preserves every channel at ${time}/${period}`);
				const prepared = Shipped.prepare([entry, { type: 'pulse', amount: 15 }, { ...entry, enabled: false }]);
				const composed = Shipped.composeSamples([entry, { type: 'pulse', amount: 15 }].filter(value => Shipped.isActive(value)).map(value => Shipped.sampleAt(value, time, options)), options);
				assert.deepStrictEqual(Shipped.samplePrepared(prepared, time, options), composed, `${type}: prepared composition matches independent samples`);
			}
			const previous = sources[0].sampleAt(537).sample;
			entry.phase = (entry.phase || 0) + 0.1;
			const replacement = createSources.call({ editor: {}, _buildAnimationSamplingContext: () => options }, layer)[0];
			assert.deepStrictEqual(replacement.sampleAt(537).sample, Shipped.sampleAt(entry, 537, options), 'A new export observes changed motion data');
			assert.deepStrictEqual(sources[0].sampleAt(537).sample, previous, 'Prepared data belongs to its source, not a global or layer cache');
		}
	}
	const offered = Object.values(Shipped.MOTION_REGISTRY).filter(motion => motion.convertible).map(motion => motion.id);
	assert.deepStrictEqual(offered, ['breath', 'float', 'sway', 'dim', 'pulse', 'move', 'rotate', 'zoom', 'rainbow']);
	const angular = id => Shipped.POSE_CHANNELS[id].interpolation === 'angle';
	const gap = (id, a, b) => { const d = Math.abs(a - b); return angular(id) ? Math.min(((d % 360) + 360) % 360, 360 - ((d % 360) + 360) % 360) : d; };
	const variants = [{}, { direction: 'alternate' }, { direction: 'reverse', phase: 0.3, delayMs: 120 }, { easing: 'bounceOut' }, { easing: 'steps', steps: 5 }, { amount: 200, distance: 2000, turns: 8, opacityFloor: 0 }];
	for (const type of offered) for (const variant of variants) {
		const source = Shipped.normalizeAnimation({ type, ...variant }), frozen = JSON.stringify(source);
		const result = Shipped.convertToKeys(source);
		if (!result && variant.distance === 2000) continue;
		assert(result, `${type} converts: ${JSON.stringify(variant)}`);
		assert.strictEqual(JSON.stringify(source), frozen, 'Conversion leaves its source untouched');
		const custom = result.animation;
		assert.strictEqual(custom.type, 'custom');
		assert.strictEqual(custom.easing, 'linear', 'Converted keys are positioned in time');
		assert(custom.keys.length >= 2 && custom.keys.length <= 64 && custom.keys.every(key => key.easing === (source.easing === 'steps' ? 'steps' : 'linear')));
		for (const key of ['periodMs', 'direction', 'iterations', 'delayMs', 'phase', 'fillMode', 'snapMode']) assert.strictEqual(custom[key], source[key], `${type} keeps ${key}`);
		let worst = 0;
		for (let index = 0; index <= 4000; index++) {
			const time = -200 + index * (source.periodMs * 3 + 400) / 4000;
			const a = Shipped.sampleAt(source, time), b = Shipped.sampleAt(custom, time);
			for (const id of Object.keys(Shipped.POSE_CHANNELS)) worst = Math.max(worst, gap(id, a[id], b[id]) / convert.tolerance[id]);
		}
		assert(worst <= convert.maxError * 1.05, `${type} stays within the conversion limit: ${worst} ${JSON.stringify(variant)}`);
		if (!result.error) assert(worst < 1e-3, `${type} reports an exact conversion only when it is one: ${worst}`);
		if (!Object.keys(variant).length && ['rotate', 'rainbow'].includes(type)) assert.strictEqual(result.error, null, `${type} winds exactly`);
		if (!Object.keys(variant).length && ['breath', 'float', 'pulse'].includes(type)) assert(result.error && worst <= 1.05, `${type} is approximate and within tolerance: ${worst}`);
	}
	assert.strictEqual(Shipped.convertToKeys({ type: 'rotate', turns: 3 }).animation.keys.length, 8, 'Rotation keeps its winding with steps under a half turn');
	const snapped = Shipped.convertToKeys({ type: 'float', snapMode: 'pixel-snap' });
	assert.strictEqual(snapped.animation.snapMode, 'pixel-snap');
	assert(snapped.animation.keys.some(key => !Number.isInteger(key.values.ty)), 'Keys hold the unsnapped curve; the motion snaps it');
	for (const type of Shipped.ANIMATION_TYPES.filter(type => !offered.includes(type))) assert.strictEqual(Shipped.convertToKeys({ type }), null, `${type} is not offered`);
	for (const type of ['pulse', 'move', 'zoom', 'dim']) assert(Shipped.convertToKeys({ type, easing: 'elasticOut' }), `${type} samples the overshooting curve in time`);
	assert(Shipped.convertToKeys({ type: 'sway', easing: 'elasticOut' }), 'A full wave survives an overshoot');
	assert.strictEqual(Shipped.convertToKeys({ type: 'pulse', amount: 0 }), null, 'An inactive preset has nothing to convert');
}

console.log(`animation-parity: ${types.length} presets and sparse Custom keys and conversions passed`);
