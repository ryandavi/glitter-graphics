'use strict';

const assert = require('assert');

global.GlitterEasing = require('../../js/effects/easing.js');
const Animation = require('../../js/effects/animation.js');
const types = Animation.ANIMATION_TYPES;
const presets = Object.fromEntries(types.map((type) => [type, {
	periodMs: 1000, easing: 'linear', amount: 10, distance: 20, radius: 20, turns: 1,
	duty: 50, opacityFloor: 20, direction: 'normal', iterations: Infinity,
	maxTrips: 12, maxCopies: 48, harmonics: { x: [{ frequency: 1, weight: 0.6 }, { frequency: 2, weight: 0.4 }], y: [{ frequency: 1, weight: 0.6 }, { frequency: 3, weight: 0.4 }] }
}]));
global.CONFIG = { tools: { animation: { defaultType: 'pulse', presets, jitterQuantMs: 60 } } };

const keys = ['tx', 'ty', 'rotate', 'scaleX', 'scaleY', 'skewX', 'skewY', 'opacity', 'originX', 'originY', 'hue'];
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

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
	assert(!Animation.isSeamlessLoop(data));
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

console.log(`animation-parity: ${types.length} presets passed`);
