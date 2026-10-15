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
console.log('PASS timing targets, clamping, stable identity, original periods, locks, Canvas timing and JSON repeats');
