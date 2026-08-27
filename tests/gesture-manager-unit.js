'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createContainer() {
	const listeners = new Map();
	return {
		style: {},
		captured: new Set(),
		addEventListener(type, listener) { listeners.set(type, listener); },
		removeEventListener() {},
		setPointerCapture(id) { this.captured.add(id); },
		releasePointerCapture(id) { this.captured.delete(id); }
	};
}

function touch(pointerId, x, y) {
	return {
		pointerType: 'touch', pointerId, clientX: x, clientY: y,
		target: { closest: () => null },
		preventDefault() {}, stopPropagation() {}
	};
}

async function main() {
	const context = {
		console,
		CONFIG: { ui: { gestures: {
			tapMaxMs: 300, tapSlopPx: 10, secondFingerGraceMs: 40,
			secondFingerCommitSlopPx: 24, doubleTapMs: 300, doubleTapSlopPx: 30,
			palmRejectionContactPx: 60
		} } },
		window: { addEventListener() {}, removeEventListener() {}, editor: null },
		document: {
			addEventListener() {}, removeEventListener() {},
			visibilityState: 'visible', hasFocus: () => true
		},
		performance,
		setTimeout,
		clearTimeout,
		queueMicrotask,
		ToolType: {}, LayerType: {}, LAYER_UI_CONFIG: {}, TOOL_TOUCH_ROUTES: {},
		isTransformableLayerType: () => false,
		getLayerManagerForType: () => null
	};
	vm.createContext(context);
	const source = fs.readFileSync(path.join(__dirname, '../js/classes/GestureManager.js'), 'utf8');
	vm.runInContext(`${source}\nglobalThis.__GestureManager = GestureManager;`, context);

	const container = createContainer();
	const calls = [];
	const viewport = {
		editor: null,
		cancelInertia() {},
		panBy(x, y) { calls.push({ type: 'pan', x, y }); },
		transformByGesture(scale, fromX, fromY, toX, toY) {
			calls.push({ type: 'transform', scale, fromX, fromY, toX, toY });
		},
		startInertia() {}
	};
	const manager = new context.__GestureManager(container, viewport);

	manager.handlePointerDown(touch(1, 100, 100));
	manager.handlePointerMove(touch(1, 115, 100));
	assert.strictEqual(calls.length, 0, 'Small movement bypassed the second-finger grace window');
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.deepStrictEqual(calls[0], { type: 'pan', x: 15, y: 0 }, 'Pending one-finger movement was not committed after grace');
	manager.handlePointerUp(touch(1, 115, 100));

	calls.length = 0;
	manager.handlePointerDown(touch(10, 100, 100));
	manager.handlePointerMove(touch(10, 130, 100));
	assert.strictEqual(calls[0]?.type, 'pan', 'Decisive one-finger movement was delayed');
	manager.handlePointerDown(touch(11, 200, 100));
	assert.strictEqual(manager.state, 'twoFinger', 'Second touch did not atomically upgrade the route');
	manager.handlePointerDown(touch(12, 300, 100));
	assert.strictEqual(manager.pointers.size, 2, 'A third touch entered the gesture calculation');
	assert(manager.ignoredPointerIds.has(12), 'Excess touch was not tracked for a clean release');

	calls.length = 0;
	manager.handlePointerMove(touch(10, 120, 100));
	const transformed = calls.find((call) => call.type === 'transform');
	assert(transformed, 'Two-finger motion did not use the atomic viewport transform');
	assert.strictEqual(transformed.fromX, 165, 'Previous centroid was not preserved');
	assert.strictEqual(transformed.toX, 160, 'Current centroid was calculated incorrectly');
	assert(Math.abs(transformed.scale - (80 / 70)) < 1e-9, 'Pinch distance ratio was calculated incorrectly');

	manager.handlePointerUp(touch(12, 300, 100));
	assert.strictEqual(manager.pointers.size, 2, 'Releasing an ignored touch disturbed the active pair');
	manager.handlePointerUp(touch(10, 120, 100));
	assert.strictEqual(manager.state, 'dragging', 'Two-to-one transition did not retain the remaining touch');
	manager.handlePointerMove(touch(11, 210, 100));
	assert(calls.some((call) => call.type === 'pan' && call.x === 10), 'Remaining touch jumped or stopped after two-to-one transition');
	manager.handlePointerUp(touch(11, 210, 100));
	assert.strictEqual(manager.state, 'idle', 'Final touch release did not reset gesture state');
	assert.strictEqual(manager.pointers.size, 0, 'Pointer records leaked after the gesture');

	manager.handlePointerDown(touch(20, 50, 50));
	manager.handlePointerCancel(touch(20, 50, 50));
	assert.strictEqual(manager.state, 'idle', 'Pointer cancellation did not abort pending gesture state');
	assert.strictEqual(manager.pointers.size, 0, 'Pointer cancellation leaked a contact');

	// A broad second contact is a palm, not the start of a pinch.
	calls.length = 0;
	manager.handlePointerDown(touch(30, 100, 100));
	manager.handlePointerMove(touch(30, 140, 100));
	assert.strictEqual(manager.state, 'dragging', 'One-finger drag did not commit before the palm scenario');
	const palm = Object.assign(touch(31, 150, 105), { width: 90, height: 80 });
	manager.handlePointerDown(palm);
	assert.strictEqual(manager.state, 'dragging', 'Palm contact upgraded a one-finger drag to a pinch');
	assert(manager.ignoredPointerIds.has(31), 'Palm contact was not excluded from the gesture');
	assert.strictEqual(manager.pointers.size, 1, 'Palm contact entered the active pointer set');
	manager.handlePointerUp(palm);
	manager.handlePointerUp(touch(30, 140, 100));
	assert.strictEqual(manager.state, 'idle', 'Gesture state did not reset after the palm scenario');

	manager.destroy();
	process.stdout.write('PASS deterministic gesture routing and finger-count transitions\n');
}

main().catch((error) => {
	process.stderr.write(`FAIL ${error.stack || error.message}\n`);
	process.exit(1);
});
