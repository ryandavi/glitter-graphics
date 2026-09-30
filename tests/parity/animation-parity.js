'use strict';

const assert = require('assert');

const types = [
	'breath', 'float', 'sway', 'dim', 'drift', 'twinkle', 'glint', 'pulse', 'heartbeat', 'blink',
	'bounce', 'shake', 'tremble', 'wobble', 'jello', 'tada', 'swing', 'rubber-band',
	'move', 'orbit', 'rotate', 'flip', 'zoom', 'ping', 'marquee', 'rainbow'
];
const presets = Object.fromEntries(types.map((type) => [type, {
	periodMs: 1000, easing: 'linear', amount: 10, distance: 20, radius: 20, turns: 1,
	duty: 50, opacityFloor: 20, direction: 'normal', iterations: Infinity, anchor: 'center'
}]));
Object.assign(presets.marquee, { includeWhenOffCanvas: true });

global.CONFIG = { tools: { animation: {
	defaultType: 'pulse', presets, jitterQuantMs: 60, rotateSnapStepDeg: 15,
	scaleSnapStep: 0.05, maxPeriodMs: 20000, exportFps: 30
} } };
global.GlitterEasing = require('../../js/effects/easing.js');
const Animation = require('../../js/effects/animation.js');

const keys = ['tx', 'ty', 'rotate', 'scaleX', 'scaleY', 'skewX', 'skewY', 'opacity', 'originX', 'originY', 'hue'];
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

assert.deepStrictEqual(Object.keys(Animation.MOTION_REGISTRY), Animation.ANIMATION_TYPES);
Animation.ANIMATION_TYPES.forEach((type) => {
	const entry = Animation.MOTION_REGISTRY[type];
	assert.strictEqual(entry.id, type);
	assert.strictEqual(typeof entry.needsBounds, 'boolean');
	assert.strictEqual(typeof entry.particleSafe, 'boolean');
});
assert.strictEqual(Animation.MOTION_REGISTRY.marquee.needsBounds, true);
assert.strictEqual(Animation.MOTION_REGISTRY.rotate.particleSafe, true);
assert.strictEqual(Animation.MOTION_REGISTRY.tada.particleSafe, false);

types.forEach((type) => {
	const data = Animation.normalizeAnimation({ type });
	assert.strictEqual(data.type, type);
	const sample = Animation.sampleAt(data, 375, { layerId: 'layer-a' });
	assert.deepStrictEqual(Object.keys(sample), keys);
	assert(sample.opacity >= 0 && sample.opacity <= 1);
	assert(Number.isFinite(sample.scaleX) && Number.isFinite(sample.scaleY));
	assert.deepStrictEqual(sample, Animation.sampleAt(data, 375, { layerId: 'layer-a' }));
	if (!Number.isFinite(data.iterations)) {
		assert.strictEqual(Animation.loopDurationMs(data), Infinity);
		assert(Animation.isSeamlessLoop(data), `${type} should loop seamlessly`);
		const start = Animation.sampleAt(data, 0, { layerId: 'layer-a' });
		const end = Animation.sampleAt(data, data.periodMs, { layerId: 'layer-a' });
		keys.forEach((key) => assert(near(start[key], end[key]), `${type}.${key} seam`));
	}
});

assert.strictEqual(Animation.normalizeAnimation({ type: 'pulse', iterations: null }).iterations, Infinity);
assert.strictEqual(Animation.loopDurationMs({ type: 'pulse', iterations: 1 }), 1000);
assert.strictEqual(Animation.includesOffCanvas({ type: 'marquee' }), true);
assert.strictEqual(Animation.includesOffCanvas({ type: 'move' }), false);
assert.strictEqual(Animation.includesOffCanvas({ type: 'marquee', distance: 0 }), false);

// Every preset now loops indefinitely by default (no built-in "play once"
// transitions), but the engine still supports an explicit finite `iterations`
// override, so that mechanism gets covered directly here instead of via a
// dedicated one-shot preset.
['pulse', 'rotate', 'move'].forEach((type) => {
	const data = Animation.normalizeAnimation({ type, iterations: 1, fillMode: 'forwards' });
	assert(!Animation.isSeamlessLoop(data));
	assert.deepStrictEqual(
		Animation.sampleAt(data, data.periodMs, { layerId: 'transition' }),
		Animation.sampleAt(data, data.periodMs * 2, { layerId: 'transition' })
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
	Animation.sampleAt(offsetPulse, 0, { layerId: 'offset' }),
	Animation.sampleAt({ ...offsetPulse, phase: 0 }, offsetPulse.periodMs * 0.25, { layerId: 'offset' })
);

const verticalFloat = Animation.sampleAt({ ...presets.float, type: 'float', angle: 270 }, 125, { layerId: 'float' });
assert(near(verticalFloat.tx, 0));

const snapped = Animation.sampleAt({ ...presets.move, type: 'move', snapMode: 'pixel-snap' }, 330, { layerId: 'snap' });
assert(Number.isInteger(snapped.tx) && Number.isInteger(snapped.ty));
const normal = Animation.sampleAt({ ...presets.rotate, type: 'rotate' }, 250, { layerId: 'direction' });
const reverse = Animation.sampleAt({ ...presets.rotate, type: 'rotate', direction: 'reverse' }, 750, { layerId: 'direction' });
assert(near(normal.rotate, reverse.rotate));
assert.strictEqual(GlitterEasing.easingFn('linear')(0.37), 0.37);
assert.strictEqual(GlitterEasing.stepsEase(0.49, 2), 0);
assert.strictEqual(GlitterEasing.stepsEase(0.5, 2), 0.5);

const matrixSample = Animation.sampleAt({ ...presets.jello, type: 'jello' }, 250, { layerId: 'matrix' });
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

const bounds = { canvasW: 640, canvasH: 480, boxW: 80, boxH: 40, layerId: 'bounds', seed: 7 };
assert.deepStrictEqual(
	Animation.sampleAt({ ...presets.rotate, type: 'rotate' }, 250, bounds),
	Animation.sampleAt({ ...presets.rotate, type: 'rotate' }, 250, bounds)
);
assert.strictEqual(Animation.isSeamlessLoop({ ...presets.rotate, type: 'rotate' }, bounds), true);

const stacked = Animation.sampleAt([
	{ ...presets.move, type: 'move', angle: 0, distance: 20, opacityFloor: 0 },
	{ ...presets.rotate, type: 'rotate', turns: 1 },
	{ ...presets.rainbow, type: 'rainbow' },
	{ ...presets.rainbow, type: 'rainbow', direction: 'reverse' },
	{ ...presets.dim, type: 'dim', opacityFloor: 20 }
], 250, { layerId: 'stacked' });
assert(stacked.matrix, 'stacked animations should compose into one affine transform');
assert(near(stacked.tx, 20 * Math.sin(Math.PI * 0.25)));
assert(near(stacked.opacity, 1 - 0.8 * Math.sin(Math.PI * 0.25)));
assert(near(stacked.hue, 360));
assert(Animation.domTransformString(stacked).startsWith('matrix('));
assert.strictEqual(Animation.normalizeAnimations({ type: 'pulse' }).length, 1);
assert.strictEqual(Animation.summaryText([{ type: 'pulse' }, { type: 'rotate' }]), '2 animations');
assert.strictEqual(Animation.includesOffCanvas([{ type: 'move' }, { type: 'marquee' }]), true);

console.log(`animation-parity: ${types.length} presets passed`);
