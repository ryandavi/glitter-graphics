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
		preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
	};
}

async function main() {
	const context = {
		console,
		CONFIG: { ui: { gestures: {
			tapMaxMs: 300, tapSlopPx: 10, secondFingerGraceMs: 40,
			secondFingerCommitSlopPx: 24, doubleTapMs: 300, doubleTapSlopPx: 30,
			palmRejectionContactPx: 60, layerGesturePaddingPx: 20
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
	const source = fs.readFileSync(path.join(__dirname, '../../js/systems/GestureManager.js'), 'utf8');
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

	context.ToolType.SELECT = 'select';
	context.isLayerTransformable = layer => Boolean(layer);
	context.isLayerSelectableOnCanvas = layer => Boolean(layer);
	const layer = { id: 'target', type: 'sticker' };
	const other = { id: 'other', type: 'sticker' };
	const transform = { beginGestureInteraction() {}, endGestureInteraction() {}, isDraggingHandle: false };
	context.getLayerManagerForType = () => ({ layerTransforms: new Map([[layer.id, transform]]) });
	viewport.screenToCanvas = (x, y) => ({ x, y });
	viewport.editor = {
		currentTool: 'select',
		layerManager: {
			layers: [layer, other], activeLayerId: layer.id,
			getActiveLayer() { return this.layers.find(entry => entry.id === this.activeLayerId); },
			hasMultiSelection: () => false,
			getTopVisibleLayerAtPoint: (x, y) => x >= 100 && x <= 160 && y >= 100 && y <= 160 ? layer : null,
			isPointInLayer: (target, x, y, padding = 0) => target === layer && x >= 100 - padding && x <= 160 + padding && y >= 100 - padding && y <= 160 + padding,
			selectLayerFromCanvas(id) { this.activeLayerId = id; }
		}
	};
	manager.handlePointerDown(touch(40, 130, 130));
	manager.handlePointerDown(touch(41, 180, 130));
	assert.strictEqual(manager.route.type, 'layerGesture', 'One finger outside a small layer lost the pinch');
	manager.cancelActiveGesture(true);
	viewport.editor.layerManager.activeLayerId = other.id;
	manager.handlePointerDown(touch(42, 130, 130));
	manager.handlePointerDown(touch(43, 180, 130));
	assert.strictEqual(manager.route.type, 'layerGesture', 'Pending unselected layer lost the pinch');
	assert.strictEqual(viewport.editor.layerManager.activeLayerId, layer.id, 'Pinch did not select its target');
	manager.cancelActiveGesture(true);
	manager.handlePointerDown(touch(44, 300, 300));
	manager.handlePointerDown(touch(45, 350, 300));
	assert.strictEqual(manager.route.type, 'viewportTwoFinger', 'Empty canvas lost viewport routing');
	manager.cancelActiveGesture(true);
	manager.handlePointerDown(Object.assign(touch(46, 130, 130), { width: 5, height: 5 }));
	manager.handlePointerDown(Object.assign(touch(47, 180, 130), { width: 30, height: 30 }));
	assert.strictEqual(manager.pointers.size, 2, 'A thumb below the absolute threshold was rejected');
	manager.cancelActiveGesture(true);
	transform.isDraggingHandle = true;
	manager.handlePointerDown(touch(48, 130, 130));
	assert(manager.ignoredPointerIds.has(48), 'Second touch during handle drag was not ignored');
	assert.strictEqual(manager.pointers.size, 0, 'Handle drag and gesture ran together');
	manager.handlePointerUp(touch(48, 130, 130));
	transform.isDraggingHandle = false;
	manager.handlePointerDown(touch(49, 130, 130));
	const corner = touch(50, 160, 160);
	corner.target.closest = selector => selector === '.transform-handles' ? {} : null;
	manager.handlePointerDown(corner);
	assert.strictEqual(manager.route.type, 'layerGesture', 'Second touch on chrome started a handle drag');
	manager.cancelActiveGesture(true);
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/transforms/selection-chrome.js'), 'utf8') + '\nglobalThis.__SelectionChrome = SelectionChrome;', context);
	const chrome = Object.create(context.__SelectionChrome.prototype);
	chrome.overlay = { element: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } };
	chrome.screen = { center: { x: 100, y: 100 }, hw: 30, hh: 30, cos: 1, sin: 0,
		handles: [{ handleType: 'corner-tl', kind: 'corner', x: 90, y: 90, half: 22 }] };
	assert.strictEqual(chrome.hitTest(100, 100, 'touch'), 'move', 'Touch inner move zone lost to a handle');
	assert.strictEqual(chrome.hitTest(100, 100, 'mouse'), 'corner-tl', 'Fine pointer hit testing changed');

	manager.destroy();
	process.stdout.write('PASS deterministic gesture routing and finger-count transitions\n');
}

main().catch((error) => {
	process.stderr.write(`FAIL ${error.stack || error.message}\n`);
	process.exit(1);
});
