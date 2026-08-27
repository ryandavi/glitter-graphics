'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElement(rect = { left: 0, top: 0, width: 1000, height: 800 }) {
	const classes = new Set();
	return {
		clientHeight: rect.height,
		style: {
			transform: '',
			setProperty() {}
		},
		classList: {
			add: (...names) => names.forEach((name) => classes.add(name)),
			remove: (...names) => names.forEach((name) => classes.delete(name)),
			contains: (name) => classes.has(name)
		},
		addEventListener() {},
		getBoundingClientRect: () => ({ ...rect })
	};
}

const context = {
	console,
	CONFIG: {
		ui: {
			zoom: { levels: [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16] },
			gestures: { inertia: { enabled: false, decay: 0.92 } }
		},
		tools: { glitter: { preview: { selectedOutlineOffset: 1, selectedOutlineWidth: 1 } } }
	},
	GestureManager: class GestureManager {},
	CustomEvent: class CustomEvent {
		constructor(type, options) { this.type = type; this.detail = options?.detail; }
	},
	document: { getElementById: () => null },
	window: {
		addEventListener() {},
		dispatchEvent() {},
		matchMedia: () => ({ matches: false }),
		visualViewport: null
	},
	setTimeout,
	clearTimeout,
	requestAnimationFrame: (callback) => setTimeout(callback, 0),
	cancelAnimationFrame: clearTimeout
};
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '../js/classes/ViewportManager.js'), 'utf8');
vm.runInContext(`${source}\nglobalThis.__ViewportManager = ViewportManager;`, context);

const container = createElement();
const wrapper = createElement({ left: 300, top: 250, width: 400, height: 300 });
const viewport = new context.__ViewportManager(container, wrapper);
viewport.setCanvasDimensions(400, 300);
viewport.resetViewport();
const canvasAt = (x, y) => ({
	x: (x - viewport.panX) / viewport.currentZoom,
	y: (y - viewport.panY) / viewport.currentZoom
});

assert.strictEqual(viewport.panX, 300, 'Reset did not center the canvas horizontally');
assert.strictEqual(viewport.panY, 250, 'Reset did not center the canvas vertically');

const anchor = { x: 500, y: 400 };
const canvasBefore = canvasAt(anchor.x, anchor.y);
viewport.zoomByFactor(2, anchor.x, anchor.y);
const canvasAfter = canvasAt(anchor.x, anchor.y);
assert(Math.abs(canvasAfter.x - canvasBefore.x) < 1e-9, 'Continuous zoom moved the X anchor');
assert(Math.abs(canvasAfter.y - canvasBefore.y) < 1e-9, 'Continuous zoom moved the Y anchor');
assert.strictEqual(viewport.currentZoom, 2, 'Continuous zoom did not apply its factor');

viewport.setZoom(1, null, null, { animate: true });
assert(wrapper.classList.contains('viewport-transition'), 'Animated zoom did not start a view transition');
viewport.zoomByFactor(1.1, anchor.x, anchor.y);
assert(!wrapper.classList.contains('viewport-transition'), 'Continuous zoom did not cancel an active view transition');

viewport.setZoom(1.1);
viewport.zoomIn();
assert.strictEqual(viewport.currentZoom, 1.25, 'Zoom In skipped the next preset after continuous zoom');
viewport.zoomOut();
assert.strictEqual(viewport.currentZoom, 1, 'Zoom Out skipped the previous preset after continuous zoom');

viewport.zoomToBounds({ left: 100, top: 100, right: 300, bottom: 200 }, { padding: 100 });
assert.strictEqual(viewport.currentZoom, 4.5, 'Zoom to bounds did not fit the requested area');
const fittedCenter = canvasAt(500, 400);
assert(Math.abs(fittedCenter.x - 200) < 1e-9, 'Zoom to bounds did not center X');
assert(Math.abs(fittedCenter.y - 150) < 1e-9, 'Zoom to bounds did not center Y');

viewport.pinchZoomAt(2, anchor.x, anchor.y);
assert.strictEqual(viewport.currentZoom, 9, 'Touch compatibility path did not use continuous zoom');

viewport.setZoom(1);
const gestureCanvasPoint = canvasAt(450, 350);
viewport.transformByGesture(1.5, 450, 350, 490, 380);
const gestureResult = canvasAt(490, 380);
assert(Math.abs(gestureResult.x - gestureCanvasPoint.x) < 1e-9, 'Atomic gesture transform drifted on X');
assert(Math.abs(gestureResult.y - gestureCanvasPoint.y) < 1e-9, 'Atomic gesture transform drifted on Y');
assert.strictEqual(viewport.currentZoom, 1.5, 'Atomic gesture transform did not apply scale');

viewport.panBy(100000, 100000);
assert(viewport.panX < 100000 && viewport.panY < 100000, 'Pan bounds allowed the canvas to disappear');

(async () => {
	// Frame-batched wheel input: deltas accumulate and apply once per frame.
	viewport.setZoom(1);
	viewport.resetViewport();
	const panBaseline = viewport.panX;
	viewport.queuePanBy(-30, 0);
	viewport.queuePanBy(-20, 0);
	assert.strictEqual(viewport.panX, panBaseline, 'Queued pan applied before its animation frame');
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.strictEqual(viewport.panX, panBaseline - 50, 'Queued pan deltas did not sum into a single frame');

	viewport.resetViewport();
	const anchorBefore = canvasAt(520, 360);
	viewport.queueZoomByFactor(1.2, 520, 360);
	viewport.queueZoomByFactor(1.2, 520, 360);
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert(Math.abs(viewport.currentZoom - 1.44) < 1e-9, 'Composed zoom factors were not multiplied on flush');
	const anchorAfter = canvasAt(520, 360);
	assert(Math.abs(anchorAfter.x - anchorBefore.x) < 1e-9, 'Batched zoom moved the anchor on X');
	assert(Math.abs(anchorAfter.y - anchorBefore.y) < 1e-9, 'Batched zoom moved the anchor on Y');

	// Momentum is suppressed when the viewer asked for reduced motion.
	context.CONFIG.ui.gestures.inertia.enabled = true;
	context.window.matchMedia = () => ({ matches: true });
	viewport.startInertia(40, 40);
	assert.strictEqual(viewport.inertiaFrame, null, 'Inertia ran despite a reduced-motion preference');

	process.stdout.write('PASS shared viewport navigation primitives\n');
})().catch((error) => {
	process.stderr.write(`FAIL ${error.stack || error.message}\n`);
	process.exit(1);
});
