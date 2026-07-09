'use strict';

// Deterministic verification for coarse-pointer transform-handle behaviors
// not covered by the numbered checks in touch-smoke.js: the rotation handle,
// the corner scale handle, and the fixed-text edge resize handle. Each is
// also driven via mouse to prove the shared pointer-event handle path did
// not regress desktop behavior.

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const VIEWPORT = { width: 390, height: 844 };
const DEVICE_SCALE_FACTOR = 3;
const GESTURE_STEPS = 10;
const FRAME_DELAY_MS = 16;
const ROTATION_DELTA_MIN_DEG = 30;
const SCALE_DELTA_MIN_PCT = 10;
const BOX_WIDTH_DELTA_MIN_PX = 10;

function lerp(start, end, progress) {
	return start + ((end - start) * progress);
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function describeError(error) {
	if (!error) return 'Unknown error';
	if (error.stack) return error.stack;
	return String(error);
}

function canvasToScreen(metrics, point) {
	return {
		x: metrics.rect.left + metrics.panX + (point.x * metrics.zoom),
		y: metrics.rect.top + metrics.panY + (point.y * metrics.zoom)
	};
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
	await page.waitForTimeout(80);
}

async function mouseDrag(page, from, to, steps = GESTURE_STEPS) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();

	for (let index = 1; index <= steps; index += 1) {
		const progress = index / steps;
		await page.waitForTimeout(FRAME_DELAY_MS);
		await page.mouse.move(lerp(from.x, to.x, progress), lerp(from.y, to.y, progress));
	}

	await page.waitForTimeout(FRAME_DELAY_MS);
	await page.mouse.up();
	await page.waitForTimeout(80);
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
			console.warn('touch-handle-verify: failed to seed welcome modal preference', error);
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
	await page.waitForTimeout(60);
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
				right: rect.right,
				bottom: rect.bottom,
				width: rect.width,
				height: rect.height
			}
		};
	});
}

async function createTestSticker(page, options = {}) {
	const layerInfo = await page.evaluate(({ positionX, positionY, label }) => {
		const editor = window.editor;
		const canvas = document.createElement('canvas');
		canvas.width = 84;
		canvas.height = 84;
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = '#ff5c8a';
		ctx.fillRect(6, 6, 72, 72);
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(24, 24, 36, 36);
		ctx.strokeStyle = '#171717';
		ctx.lineWidth = 4;
		ctx.strokeRect(6, 6, 72, 72);

		const layer = editor.stickerManager.createLayer();
		layer.name = label;
		layer.stickerSourceId = 'touch-handle-verify-generated';
		layer.stickerData.isEmpty = false;
		layer.stickerData.url = canvas.toDataURL('image/png');
		layer.stickerData.name = label;
		layer.stickerData.source = 'touch-handle-verify';
		layer.stickerData.width = canvas.width;
		layer.stickerData.height = canvas.height;
		layer.stickerData.transform.position.x = positionX ?? (editor.previewCanvas.width / 2);
		layer.stickerData.transform.position.y = positionY ?? (editor.previewCanvas.height / 2);
		layer.stickerData.transform.rotation = 0;
		layer.stickerData.transform.scale.x = 100;
		layer.stickerData.transform.scale.y = 100;

		editor.layerManager.insertLayer(layer);
		editor.stickerManager.renderLayer(layer);
		editor.layerManager.renderLayersList();
		editor.updatePreview();
		editor.saveState();

		return { layerId: layer.id };
	}, {
		positionX: options.position?.x,
		positionY: options.position?.y,
		label: options.label || 'Handle Verify Sticker'
	});

	return layerInfo;
}

async function selectLayer(page, layerId) {
	await page.evaluate((activeLayerId) => {
		window.editor.layerManager.setActiveLayer(activeLayerId);
	}, layerId);
	await page.waitForTimeout(100);
	// Selecting a layer (especially text) can re-open the mobile design/glitter
	// drawer, which is a fixed full-width overlay that sits on top of the
	// canvas and would otherwise swallow the pointer meant for a handle.
	await closeMobileChrome(page);
}

async function selectLayers(page, layerIds, activeLayerId = layerIds[layerIds.length - 1]) {
	await page.evaluate(({ ids, activeId }) => {
		window.editor.layerManager.setSelection(ids, { activeLayerId: activeId });
	}, {
		ids: layerIds,
		activeId: activeLayerId
	});
	await page.waitForTimeout(120);
	await closeMobileChrome(page);
}

async function getStickerState(page, layerId) {
	return page.evaluate((activeLayerId) => {
		const layer = window.editor.layerManager.layers.find((entry) => entry.id === activeLayerId);
		return {
			position: { x: layer.stickerData.transform.position.x, y: layer.stickerData.transform.position.y },
			scale: { x: layer.stickerData.transform.scale.x, y: layer.stickerData.transform.scale.y },
			rotation: layer.stickerData.transform.rotation
		};
	}, layerId);
}

async function getElementCenter(page, selector) {
	const box = await page.evaluate((sel) => {
		const element = document.querySelector(sel);
		if (!element) return null;
		const rect = element.getBoundingClientRect();
		return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
	}, selector);
	assert(box, `Element not found for selector ${selector}`);
	return { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
}

async function getTransformHandleCenter(page, layerId, handleType) {
	const selector = `.transform-handles[data-layer-id="${layerId}"] [data-handle-type="${handleType}"]`;
	const center = await getElementCenter(page, selector);

	// Mobile drawers (e.g. the design/glitter panel re-opened by layer
	// selection) close synchronously, but guard against any residual overlay
	// still owning the hit-test at this point before a drag depends on it.
	await page.waitForFunction(({ sel, x, y }) => {
		const handle = document.querySelector(sel);
		const hit = document.elementFromPoint(x, y);
		return Boolean(handle && hit && (hit === handle || handle.contains(hit) || hit.contains(handle)));
	}, { sel: selector, x: center.x, y: center.y }, { timeout: 2000 });

	return center;
}

async function createFixedBoxTextLayer(page, options = {}) {
	const layerId = await page.evaluate(async ({ text, x, y, boxWidth, boxHeight }) => {
		const layer = window.editor.layerManager.addLayer(LayerType.TEXT_GLITTER, {
			textLayer: {
				text,
				position: { x, y },
				align: 'center',
				boxMode: 'auto'
			}
		});
		if (!layer) return null;

		// Use an explicit, deterministic box size rather than ensureFixedBox's
		// auto-measurement, which reflects whatever the text naturally wraps to
		// at the moment of the call and can vary with font-load timing — wide
		// enough on occasion to push the right edge handle outside the mobile
		// viewport entirely.
		layer.textData.boxMode = 'fixed';
		layer.textData.boxWidth = boxWidth;
		layer.textData.boxHeight = boxHeight;

		const textGlitterManager = window.editor.textGlitterManager;
		await textGlitterManager.refreshLayer(layer, { saveHistory: true });
		return layer.id;
	}, {
		text: options.text || 'Resize me',
		x: options.position?.x ?? 120,
		y: options.position?.y ?? 90,
		boxWidth: options.boxWidth ?? 100,
		boxHeight: options.boxHeight ?? 60
	});

	assert(layerId, 'Failed to create fixed-box text layer');

	await page.waitForFunction((activeLayerId) => {
		const element = document.querySelector(`.text-glitter-element[data-layer-id="${activeLayerId}"]`);
		if (!element) return false;
		return getComputedStyle(element).visibility !== 'hidden';
	}, layerId);
	await page.waitForTimeout(120);
	return layerId;
}

async function getTextBoxWidth(page, layerId) {
	return page.evaluate((activeLayerId) => {
		const layer = window.editor.layerManager.layers.find((entry) => entry.id === activeLayerId);
		return layer.textData.boxWidth;
	}, layerId);
}

async function rotationVector(page, layerId) {
	const handleCenter = await getTransformHandleCenter(page, layerId, 'rotation');
	const state = await getStickerState(page, layerId);
	const metrics = await getViewportMetrics(page);
	const centerScreen = canvasToScreen(metrics, state.position);
	return {
		handleCenter,
		centerScreen,
		radius: Math.hypot(handleCenter.x - centerScreen.x, handleCenter.y - centerScreen.y)
	};
}

async function checkRotationHandle(page, drag, label) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const sticker = await createTestSticker(page, { position: { x: 130, y: 100 } });
	await selectLayer(page, sticker.layerId);

	const before = await getStickerState(page, sticker.layerId);
	const vector = await rotationVector(page, sticker.layerId);
	// Drag the rotation handle from directly above the sticker to directly
	// beside it (same radius) — a robust, unambiguous ~90 degree turn.
	const target = { x: vector.centerScreen.x + vector.radius, y: vector.centerScreen.y };

	await drag(page, vector.handleCenter, target);

	const after = await getStickerState(page, sticker.layerId);
	const rawDelta = Math.abs(after.rotation - before.rotation);
	const angularDelta = Math.min(rawDelta, 360 - rawDelta);
	assert(
		angularDelta > ROTATION_DELTA_MIN_DEG,
		`${label}: rotation handle drag did not rotate the sticker enough (before ${before.rotation}, after ${after.rotation})`
	);
}

async function checkCornerScaleHandle(page, drag, label) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const sticker = await createTestSticker(page, { position: { x: 130, y: 100 } });
	await selectLayer(page, sticker.layerId);

	const before = await getStickerState(page, sticker.layerId);
	const handleCenter = await getTransformHandleCenter(page, sticker.layerId, 'corner-br');

	await drag(page, handleCenter, { x: handleCenter.x + 45, y: handleCenter.y + 45 });

	const after = await getStickerState(page, sticker.layerId);
	assert(
		after.scale.x - before.scale.x > SCALE_DELTA_MIN_PCT,
		`${label}: corner handle drag did not scale the sticker up enough (before ${before.scale.x}, after ${after.scale.x})`
	);
}

async function checkFixedTextEdgeResizeHandle(page, drag, label) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const layerId = await createFixedBoxTextLayer(page, { position: { x: 120, y: 90 } });
	await selectLayer(page, layerId);
	await page.waitForTimeout(100);

	const before = await getTextBoxWidth(page, layerId);
	const handleCenter = await getTransformHandleCenter(page, layerId, 'edge-right');

	await drag(page, handleCenter, { x: handleCenter.x + 60, y: handleCenter.y });

	const after = await getTextBoxWidth(page, layerId);
	assert(
		after - before > BOX_WIDTH_DELTA_MIN_PX,
		`${label}: edge handle drag did not widen the fixed text box enough (before ${before}, after ${after})`
	);
}

async function checkGroupMoveHandle(page, drag, label) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const firstSticker = await createTestSticker(page, { position: { x: 90, y: 90 }, label: 'Group Handle A' });
	const secondSticker = await createTestSticker(page, { position: { x: 165, y: 110 }, label: 'Group Handle B' });
	await selectLayers(page, [firstSticker.layerId, secondSticker.layerId], secondSticker.layerId);

	const beforeFirst = await getStickerState(page, firstSticker.layerId);
	const beforeSecond = await getStickerState(page, secondSticker.layerId);
	const handleCenter = await getElementCenter(page, '.group-transform-handles .transform-bounding-box');

	await drag(page, handleCenter, { x: handleCenter.x + 42, y: handleCenter.y + 24 });

	const afterFirst = await getStickerState(page, firstSticker.layerId);
	const afterSecond = await getStickerState(page, secondSticker.layerId);
	assert(
		Math.abs(afterFirst.position.x - beforeFirst.position.x) > 10 &&
		Math.abs(afterFirst.position.y - beforeFirst.position.y) > 5,
		`${label}: group move handle drag did not move sticker A enough`
	);
	assert(
		Math.abs(afterSecond.position.x - beforeSecond.position.x) > 10 &&
		Math.abs(afterSecond.position.y - beforeSecond.position.y) > 5,
		`${label}: group move handle drag did not move sticker B enough`
	);
}

async function runCheck(browser, name, fn) {
	const tracker = await createHarnessPage(browser);

	try {
		await fn(tracker.page);
		await assertNoRuntimeErrors(tracker, name);
		console.log(`PASS ${name}`);
		return true;
	} catch (error) {
		console.error(`FAIL ${name}`);
		console.error(describeError(error));
		return false;
	} finally {
		await tracker.context.close();
	}
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	let failures = 0;

	try {
		const checks = [
			['Touch drag on rotation handle rotates the selected sticker', (page) => checkRotationHandle(page, oneFingerDrag, 'touch')],
			['Touch drag on corner handle scales the selected sticker', (page) => checkCornerScaleHandle(page, oneFingerDrag, 'touch')],
			['Touch drag on fixed-text edge handle resizes the box', (page) => checkFixedTextEdgeResizeHandle(page, oneFingerDrag, 'touch')],
			['Touch drag on the shared group box moves every selected sticker', (page) => checkGroupMoveHandle(page, oneFingerDrag, 'touch')],
			['Mouse drag on rotation handle still rotates the selected sticker', (page) => checkRotationHandle(page, mouseDrag, 'mouse')],
			['Mouse drag on corner handle still scales the selected sticker', (page) => checkCornerScaleHandle(page, mouseDrag, 'mouse')],
			['Mouse drag on fixed-text edge handle still resizes the box', (page) => checkFixedTextEdgeResizeHandle(page, mouseDrag, 'mouse')]
		];

		for (const [name, fn] of checks) {
			const passed = await runCheck(browser, name, fn);
			if (!passed) {
				failures += 1;
			}
		}
	} finally {
		await browser.close();
	}

	if (failures > 0) {
		console.error(`\nTouch handle verification finished with ${failures} failing check(s).`);
		process.exitCode = 1;
		return;
	}

	console.log('\nTouch handle verification finished with all checks passing.');
}

main().catch((error) => {
	console.error(describeError(error));
	process.exit(1);
});

