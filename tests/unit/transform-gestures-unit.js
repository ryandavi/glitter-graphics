'use strict';

// Handle gesture math (transform-gestures.js) and the selection chrome's
// cursor and hit test (selection-chrome.js), without a browser.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
	console,
	CONFIG: { ui: { stickerHandles: { dragThresholdPx: 3 } } }
};
vm.createContext(context);
['selection-overlay.js', 'transform-gestures.js', 'selection-chrome.js'].forEach((file) => {
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/transforms', file), 'utf8'), context);
});
vm.runInContext('globalThis.__SelectionChrome = SelectionChrome;', context);

const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
const pivot = { x: 0, y: 0 };

// Rotation is relative: no pointer movement means no change, wherever the grab was.
near(context.rotationDeltaDeg(pivot, { x: 3, y: 4 }, { x: 3, y: 4 }), 0, 'Grabbing without moving rotated the layer');
near(context.rotationDeltaDeg(pivot, { x: 1, y: 0 }, { x: 0, y: 1 }), 90, 'Quarter turn');
// Crossing the ±180° seam stays a small turn.
const seam = context.rotationDeltaDeg(pivot, { x: Math.cos(3), y: Math.sin(3) }, { x: Math.cos(-3), y: Math.sin(-3) });
near(seam, (2 * Math.PI - 6) * 180 / Math.PI, 'Crossing the seam flipped the turn direction');

assert.strictEqual(context.snapRotationDeg(22, true), 15, 'Shift snap down');
assert.strictEqual(context.snapRotationDeg(23, true), 30, 'Shift snap up');
assert.strictEqual(context.snapRotationDeg(23, false), 23, 'Snapped without Shift');
assert.strictEqual(context.normalizeRotationDeg(-30), 330, 'Negative rotation not normalized');

const turned = context.rotatePointAbout({ x: 10, y: 0 }, pivot, 90);
near(turned.x, 0, 'Pivot rotation x');
near(turned.y, 10, 'Pivot rotation y');

const dragged = context.anchoredHandlePoint({ x: 100, y: 50 }, { x: 104, y: 46 }, { x: 110, y: 46 });
assert.deepStrictEqual({ ...dragged }, { x: 106, y: 50 }, 'Handle point does not follow the pointer delta');

const metrics = {
	centerX: 50,
	centerY: 20,
	corners: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }]
};
assert.deepStrictEqual({ ...context.getFrameHandlePoint(metrics, 'edge-right') }, { x: 100, y: 20 }, 'Edge handle point');
assert.deepStrictEqual({ ...context.getFrameHandlePoint(metrics, 'corner-bl') }, { x: 0, y: 40 }, 'Corner handle point');

assert.strictEqual(context.hasPassedDragThreshold({ x: 0, y: 0 }, { clientX: 2, clientY: 0 }), false, '2px counted as a drag');
assert.strictEqual(context.hasPassedDragThreshold({ x: 0, y: 0 }, { clientX: 3, clientY: 0 }), true, '3px not counted as a drag');

assert.strictEqual(context.getHandleCursor('corner-tl', 0), 'nwse-resize', 'Corner cursor');
assert.strictEqual(context.getHandleCursor('corner-tl', 90), 'nesw-resize', 'Corner cursor does not turn with the layer');
assert.strictEqual(context.getHandleCursor('edge-left', 0), 'ew-resize', 'Edge cursor');

// Hit test: a 100×60 frame centered at (100, 100) in overlay space.
const chrome = Object.create(context.__SelectionChrome.prototype);
chrome.overlay = { element: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } };
chrome.screen = {
	center: { x: 100, y: 100 },
	hw: 50,
	hh: 30,
	cos: 1,
	sin: 0,
	handles: [
		{ handleType: 'corner-tl', x: 46, y: 66, half: 16 },
		{ handleType: 'corner-tr', x: 154, y: 66, half: 16 },
		{ handleType: 'edge-top', x: 100, y: 66, half: 18 },
		{ handleType: 'rotation', x: 100, y: 40, half: 20 }
	]
};
assert.strictEqual(chrome.hitTest(48, 64, 'mouse'), 'corner-tl', 'Corner handle not hit');
assert.strictEqual(chrome.hitTest(100, 100, 'mouse'), 'move', 'Frame interior not a move');
assert.strictEqual(chrome.hitTest(300, 300, 'mouse'), null, 'Empty space hit something');
// Top edge (48..84) and rotation (20..60) squares overlap: nearest center wins.
assert.strictEqual(chrome.hitTest(100, 52, 'mouse'), 'rotation', 'Overlap did not prefer the nearer rotation handle');
assert.strictEqual(chrome.hitTest(100, 58, 'mouse'), 'edge-top', 'Overlap did not prefer the nearer edge handle');

// Explicit handle zones win over the body on every pointer type. Compact-frame
// filtering removes unsuitable handles before hit testing.
chrome.screen = {
	center: { x: 100, y: 100 },
	hw: 20,
	hh: 10,
	cos: 1,
	sin: 0,
	handles: [{ handleType: 'edge-top', x: 100, y: 86, half: 22 }]
};
assert.strictEqual(chrome.hitTest(100, 100, 'touch'), 'edge-top', 'Touch edge zone lost priority to the body');
assert.strictEqual(chrome.hitTest(100, 100, 'mouse'), 'edge-top', 'Mouse under a handle square did not grab it');

console.log('PASS transform gesture math and selection chrome hit testing');
