'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const VIEWPORT = { width: 390, height: 844 };
const DEVICE_SCALE_FACTOR = 3;
const FRAME_DELAY_MS = 16;
const GESTURE_STEPS = 10;
const TAP_DELAY_MS = 40;
const POSITION_TOLERANCE_PX = 3;
const SIZE_TOLERANCE_PX = 2;

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function approxEqual(actual, expected, tolerance, message) {
	if (Math.abs(actual - expected) > tolerance) {
		throw new Error(`${message} (expected ${expected}, got ${actual})`);
	}
}

function describeError(error) {
	if (!error) return 'Unknown error';
	if (error.stack) return error.stack;
	return String(error);
}

function lerp(start, end, progress) {
	return start + ((end - start) * progress);
}

async function getTouchSession(page) {
	if (!page.__touchSession) {
		page.__touchSession = await page.context().newCDPSession(page);
	}
	return page.__touchSession;
}

function toTouchPoint(point, id) {
	return {
		x: Math.round(point.x),
		y: Math.round(point.y),
		radiusX: 8,
		radiusY: 8,
		force: 1,
		id
	};
}

async function dispatchTouch(page, type, points) {
	const session = await getTouchSession(page);
	await session.send('Input.dispatchTouchEvent', {
		type,
		touchPoints: points.map((point, index) => toTouchPoint(point, index + 1)),
		modifiers: 0
	});
}

async function tap(page, point) {
	await dispatchTouch(page, 'touchStart', [point]);
	await page.waitForTimeout(TAP_DELAY_MS);
	await dispatchTouch(page, 'touchEnd', []);
	await page.waitForTimeout(100);
}

async function longPress(page, point, holdMs = 600) {
	await dispatchTouch(page, 'touchStart', [point]);
	await page.waitForTimeout(holdMs);
	await dispatchTouch(page, 'touchEnd', []);
	await page.waitForTimeout(100);
}

async function oneFingerDrag(page, from, to, steps = GESTURE_STEPS) {
	await dispatchTouch(page, 'touchStart', [from]);

	for (let index = 1; index <= steps; index += 1) {
		const progress = index / steps;
		await page.waitForTimeout(FRAME_DELAY_MS);
		await dispatchTouch(page, 'touchMove', [{
			x: lerp(from.x, to.x, progress),
			y: lerp(from.y, to.y, progress)
		}]);
	}

	await page.waitForTimeout(FRAME_DELAY_MS);
	await dispatchTouch(page, 'touchEnd', []);
	await page.waitForTimeout(100);
}

async function dragThenPinch(page, start, dragMid, secondStart, firstEnd, secondEnd, steps = GESTURE_STEPS) {
	await dispatchTouch(page, 'touchStart', [start]);

	for (let index = 1; index <= Math.max(2, Math.floor(steps / 2)); index += 1) {
		const progress = index / Math.max(2, Math.floor(steps / 2));
		await page.waitForTimeout(FRAME_DELAY_MS);
		await dispatchTouch(page, 'touchMove', [{
			x: lerp(start.x, dragMid.x, progress),
			y: lerp(start.y, dragMid.y, progress)
		}]);
	}

	await page.waitForTimeout(FRAME_DELAY_MS);
	await dispatchTouch(page, 'touchStart', [dragMid, secondStart]);

	for (let index = 1; index <= steps; index += 1) {
		const progress = index / steps;
		await page.waitForTimeout(FRAME_DELAY_MS);
		await dispatchTouch(page, 'touchMove', [
			{
				x: lerp(dragMid.x, firstEnd.x, progress),
				y: lerp(dragMid.y, firstEnd.y, progress)
			},
			{
				x: lerp(secondStart.x, secondEnd.x, progress),
				y: lerp(secondStart.y, secondEnd.y, progress)
			}
		]);
	}

	await page.waitForTimeout(FRAME_DELAY_MS);
	await dispatchTouch(page, 'touchEnd', []);
	await page.waitForTimeout(120);
}

async function dismissVisibleModals(page) {
	await page.evaluate(() => {
		document.querySelectorAll('.modal-overlay.visible').forEach((element) => {
			element.classList.remove('visible');
			element.style.display = 'none';
		});
	});
}

async function closeMobileChrome(page) {
	await page.evaluate(() => {
		window.editor.mobileManager?.closeSettings?.();
		window.editor.mobileManager?.closeAllDrawers?.();
	});
	await page.waitForTimeout(80);
}

async function createHarnessPage(browser) {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: VIEWPORT,
		deviceScaleFactor: DEVICE_SCALE_FACTOR
	});

	await context.addInitScript(() => {
		try {
			localStorage.setItem('glitterEditor_welcomeModalSeen', 'true');
		} catch (error) {
			console.warn('shape-touch-verify: failed to seed welcome modal preference', error);
		}
	});

	const page = await context.newPage();
	const consoleErrors = [];
	const pageErrors = [];

	page.on('console', (message) => {
		if (message.type() === 'error') {
			consoleErrors.push(message.text());
		}
	});

	page.on('pageerror', (error) => {
		pageErrors.push(error.message || String(error));
	});

	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor != null, null, { timeout: 15000 });
	await dismissVisibleModals(page);

	return { context, page, consoleErrors, pageErrors };
}

async function assertNoRuntimeErrors(tracker, label) {
	if (tracker.consoleErrors.length || tracker.pageErrors.length) {
		const output = [
			...tracker.consoleErrors.map((message) => `console.error: ${message}`),
			...tracker.pageErrors.map((message) => `pageerror: ${message}`)
		].join('\n');
		throw new Error(`${label} saw browser errors:\n${output}`);
	}
}

async function loadBlankCanvas(page, options = {}) {
	const width = options.width || 240;
	const height = options.height || 180;
	const color = options.color || '#ffffff';

	await page.evaluate(async ({ blankWidth, blankHeight, blankColor }) => {
		await window.editor.loadBlankImage(blankWidth, blankHeight, blankColor);
	}, {
		blankWidth: width,
		blankHeight: height,
		blankColor: color
	});

	await page.waitForFunction(() => window.editor.originalImage != null);
	await page.waitForFunction(() => {
		return Boolean(
			window.editor.previewCanvas.width &&
			window.editor.layerManager.layers.some((layer) => layer.type === LayerType.BASE_IMAGE)
		);
	});
	await dismissVisibleModals(page);
	await closeMobileChrome(page);
	await page.waitForTimeout(120);
}

async function setTool(page, tool) {
	await page.evaluate((nextTool) => {
		window.editor.setTool(nextTool);
	}, tool);
	await page.waitForTimeout(80);
}

async function getViewportMetrics(page) {
	return page.evaluate(() => {
		const rect = window.editor.previewContainer.getBoundingClientRect();
		return {
			panX: window.editor.viewport.panX,
			panY: window.editor.viewport.panY,
			zoom: window.editor.viewport.currentZoom,
			canvasWidth: window.editor.previewCanvas.width,
			canvasHeight: window.editor.previewCanvas.height,
			rect: {
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height
			}
		};
	});
}

async function getCanvasPoint(page, xRatio = 0.5, yRatio = 0.5) {
	const metrics = await getViewportMetrics(page);
	const canvasX = metrics.canvasWidth * xRatio;
	const canvasY = metrics.canvasHeight * yRatio;
	return {
		canvas: { x: canvasX, y: canvasY },
		screen: {
			x: metrics.rect.left + metrics.panX + (canvasX * metrics.zoom),
			y: metrics.rect.top + metrics.panY + (canvasY * metrics.zoom)
		}
	};
}

async function getShapeTouchRouteSupport(page) {
	return page.evaluate(() => {
		return typeof TOOL_TOUCH_ROUTES !== 'undefined'
			&& TOOL_TOUCH_ROUTES[ToolType.SHAPE] === 'creationDrag';
	});
}

async function getShapeSummary(page) {
	return page.evaluate(() => {
		const shapes = window.editor.layerManager.layers.filter((layer) => layer.type === LayerType.SHAPE);
		const latest = shapes[shapes.length - 1] || null;
		return {
			count: shapes.length,
			latest: latest ? {
				id: latest.id,
				position: {
					x: latest.shapeData.transform.position.x,
					y: latest.shapeData.transform.position.y
				},
				width: latest.shapeData.width,
				height: latest.shapeData.height
			} : null
		};
	});
}

async function runCheck(browser, number, name, fn) {
	const tracker = await createHarnessPage(browser);

	try {
		const result = await fn(tracker.page);
		if (result?.skipped) {
			console.log(`SKIP ${number}. ${name} — ${result.reason}`);
			return { passed: true, skipped: true };
		}
		await assertNoRuntimeErrors(tracker, `Check ${number}`);
		console.log(`PASS ${number}. ${name}`);
		return { passed: true, skipped: false };
	} catch (error) {
		console.error(`FAIL ${number}. ${name}`);
		console.error(describeError(error));
		return { passed: false, skipped: false };
	} finally {
		await tracker.context.close();
	}
}

async function check1(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'shape');

	const before = await getShapeSummary(page);
	const point = await getCanvasPoint(page, 0.35, 0.4);

	await tap(page, point.screen);

	const after = await getShapeSummary(page);
	assert(after.count === before.count + 1, 'Touch tap with shape tool did not create exactly one shape layer');
	assert(after.latest, 'No shape layer was available after touch tap');
	approxEqual(after.latest.position.x, point.canvas.x, POSITION_TOLERANCE_PX, 'Tap-created shape X position was incorrect');
	approxEqual(after.latest.position.y, point.canvas.y, POSITION_TOLERANCE_PX, 'Tap-created shape Y position was incorrect');
}

async function check2(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'shape');

	const hasRoute = await getShapeTouchRouteSupport(page);
	assert(hasRoute, 'Shape tool did not expose the expected creationDrag touch route');

	const before = await getShapeSummary(page);
	const start = await getCanvasPoint(page, 0.2, 0.22);
	const end = await getCanvasPoint(page, 0.62, 0.66);
	const expectedWidth = Math.abs(end.canvas.x - start.canvas.x);
	const expectedHeight = Math.abs(end.canvas.y - start.canvas.y);

	await oneFingerDrag(page, start.screen, end.screen);

	const after = await getShapeSummary(page);
	assert(after.count === before.count + 1, 'Touch drag with shape tool did not create exactly one shape layer');
	assert(after.latest, 'No shape layer was available after drag create');
	approxEqual(after.latest.width, Math.round(expectedWidth), SIZE_TOLERANCE_PX, 'Drag-created shape width was incorrect');
	approxEqual(after.latest.height, Math.round(expectedHeight), SIZE_TOLERANCE_PX, 'Drag-created shape height was incorrect');
}

async function check3(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'shape');

	const before = await getShapeSummary(page);
	const point = await getCanvasPoint(page, 0.55, 0.3);

	await longPress(page, point.screen, 600);

	const after = await getShapeSummary(page);
	assert(after.count === before.count + 1, 'Long press with shape tool did not create a default shape');
	assert(after.latest, 'No shape layer was available after long press create');
	approxEqual(after.latest.position.x, point.canvas.x, POSITION_TOLERANCE_PX, 'Long-press-created shape X position was incorrect');
	approxEqual(after.latest.position.y, point.canvas.y, POSITION_TOLERANCE_PX, 'Long-press-created shape Y position was incorrect');
}

async function check4(page) {
	await loadBlankCanvas(page);

	const before = await getShapeSummary(page);
	await page.evaluate(() => {
		window.editor.modalManager.open('layerTypePickerModal');
	});
	await page.waitForTimeout(80);

	const optionCount = await page.locator('#layerTypePickerModal .layer-type-option[data-layer-type="shape"]').count();
	assert(optionCount === 1, 'Add Layer modal did not render exactly one Shape option');

	await page.click('#layerTypePickerModal .layer-type-option[data-layer-type="shape"]');
	await page.waitForTimeout(120);

	const after = await getShapeSummary(page);
	assert(after.count === before.count + 1, 'Clicking the Shape card in Add Layer modal did not create a shape layer');
	assert(after.latest, 'No shape layer was available after modal create');

	const canvasCenter = await page.evaluate(() => ({
		x: window.editor.previewCanvas.width / 2,
		y: window.editor.previewCanvas.height / 2
	}));
	approxEqual(after.latest.position.x, canvasCenter.x, POSITION_TOLERANCE_PX, 'Modal-created shape was not centered on X');
	approxEqual(after.latest.position.y, canvasCenter.y, POSITION_TOLERANCE_PX, 'Modal-created shape was not centered on Y');
}

async function check5(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'shape');

	const beforeShapes = await getShapeSummary(page);
	const beforeViewport = await getViewportMetrics(page);
	const start = await getCanvasPoint(page, 0.3, 0.32);
	const dragMid = await getCanvasPoint(page, 0.45, 0.5);
	const secondStart = await getCanvasPoint(page, 0.58, 0.5);
	const firstEnd = await getCanvasPoint(page, 0.18, 0.28);
	const secondEnd = await getCanvasPoint(page, 0.78, 0.68);

	await dragThenPinch(
		page,
		start.screen,
		dragMid.screen,
		secondStart.screen,
		firstEnd.screen,
		secondEnd.screen
	);

	const afterShapes = await getShapeSummary(page);
	const afterViewport = await getViewportMetrics(page);

	assert(afterShapes.count === beforeShapes.count, 'Two-finger upgrade during shape drag should cancel shape creation');
	assert(afterViewport.zoom > beforeViewport.zoom, 'Two-finger upgrade during shape drag did not zoom the viewport');
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	let failures = 0;

	try {
		const checks = [
			['Touch tap with shape tool creates one shape layer at the tap point', check1],
			['Touch drag with shape tool creates a shape matching the dragged box', check2],
			['Slow 600ms press with shape tool still creates a default shape', check3],
			['Add Layer modal renders a Shape option and creates a centered default shape', check4],
			['Second finger during shape drag cancels creation and zooms the viewport', check5]
		];

		for (let index = 0; index < checks.length; index += 1) {
			const [name, fn] = checks[index];
			const result = await runCheck(browser, index + 1, name, fn);
			if (!result.passed) {
				failures += 1;
			}
		}
	} finally {
		await browser.close();
	}

	if (failures > 0) {
		console.error(`\nShape touch verification finished with ${failures} failing check(s).`);
		process.exitCode = 1;
		return;
	}

	console.log('\nShape touch verification finished with all checks passing.');
}

main().catch((error) => {
	console.error(describeError(error));
	process.exit(1);
});

