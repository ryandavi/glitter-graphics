'use strict';

const assert = require('assert');

const types = [
	'breath', 'float', 'sway', 'dim', 'drift', 'twinkle', 'pulse', 'heartbeat', 'blink',
	'bounce', 'shake', 'tremble', 'wobble', 'jello', 'tada', 'swing', 'rubber-band',
	'move', 'orbit', 'rotate', 'flip', 'zoom', 'ping', 'marquee'
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
global.GlitterEasing = require('../js/effects/easing.js');
const Animation = require('../js/effects/animation.js');

const keys = ['tx', 'ty', 'rotate', 'scaleX', 'scaleY', 'skewX', 'skewY', 'opacity', 'originX', 'originY'];
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

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

console.log(`animation-parity: ${types.length} presets passed`);
