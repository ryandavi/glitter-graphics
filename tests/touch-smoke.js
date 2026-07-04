'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const VIEWPORT = { width: 390, height: 844 };
const DEVICE_SCALE_FACTOR = 3;
const GESTURE_STEPS = 10;
const POSITION_TOLERANCE_PX = 3.5;
const SCALE_TOLERANCE = 0.05;
const ROTATION_TOLERANCE_DEG = 5;
const TAP_DELAY_MS = 40;
const FRAME_DELAY_MS = 16;

function lerp(start, end, progress) {
	return start + ((end - start) * progress);
}

function approxEqual(actual, expected, tolerance, message) {
	if (Math.abs(actual - expected) > tolerance) {
		throw new Error(`${message} (expected ${expected}, got ${actual})`);
	}
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function canvasToScreen(metrics, point) {
	return {
		x: metrics.rect.left + metrics.panX + (point.x * metrics.zoom),
		y: metrics.rect.top + metrics.panY + (point.y * metrics.zoom)
	};
}

function applyTouchSlop(deltaX, deltaY, slop = 10) {
	const distance = Math.hypot(deltaX, deltaY);
	if (distance <= slop || distance === 0) {
		return { x: 0, y: 0 };
	}

	const ratio = (distance - slop) / distance;
	return {
		x: deltaX * ratio,
		y: deltaY * ratio
	};
}

function describeError(error) {
	if (!error) return 'Unknown error';
	if (error.stack) return error.stack;
	return String(error);
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
	await page.waitForTimeout(80);
}

async function doubleTap(page, point) {
	await tap(page, point);
	await page.waitForTimeout(60);
	await tap(page, point);
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

async function oneFingerFlick(page, from, to, steps = 3, settleMs = 0) {
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
	if (settleMs > 0) {
		await page.waitForTimeout(settleMs);
	}
}

async function twoFingerGesture(page, from1, to1, from2, to2, steps = GESTURE_STEPS) {
	await dispatchTouch(page, 'touchStart', [from1, from2]);

	for (let index = 1; index <= steps; index += 1) {
		const progress = index / steps;
		await page.waitForTimeout(FRAME_DELAY_MS);
		await dispatchTouch(page, 'touchMove', [
			{
				x: lerp(from1.x, to1.x, progress),
				y: lerp(from1.y, to1.y, progress)
			},
			{
				x: lerp(from2.x, to2.x, progress),
				y: lerp(from2.y, to2.y, progress)
			}
		]);
	}

	await page.waitForTimeout(FRAME_DELAY_MS);
	await dispatchTouch(page, 'touchEnd', []);
	await page.waitForTimeout(100);
}

async function oneFingerThenPinch(page, start, mid, secondStart, firstEnd, secondEnd, steps = GESTURE_STEPS) {
	await dispatchTouch(page, 'touchStart', [start]);

	for (let index = 1; index <= Math.max(2, Math.floor(steps / 2)); index += 1) {
		const progress = index / Math.max(2, Math.floor(steps / 2));
		await page.waitForTimeout(FRAME_DELAY_MS);
		await dispatchTouch(page, 'touchMove', [{
			x: lerp(start.x, mid.x, progress),
			y: lerp(start.y, mid.y, progress)
		}]);
	}

	await page.waitForTimeout(FRAME_DELAY_MS);
	await dispatchTouch(page, 'touchStart', [mid, secondStart]);

	for (let index = 1; index <= steps; index += 1) {
		const progress = index / steps;
		await page.waitForTimeout(FRAME_DELAY_MS);
		await dispatchTouch(page, 'touchMove', [
			{
				x: lerp(mid.x, firstEnd.x, progress),
				y: lerp(mid.y, firstEnd.y, progress)
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
			console.warn('touch-smoke: failed to seed welcome modal preference', error);
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

async function getWorkspacePoint(page) {
	return page.evaluate(() => {
		const editor = window.editor;
		const rect = editor.previewContainer.getBoundingClientRect();
		const canvasLeft = rect.left + editor.viewport.panX;
		const canvasTop = rect.top + editor.viewport.panY;
		const canvasRight = canvasLeft + (editor.previewCanvas.width * editor.viewport.currentZoom);
		const canvasBottom = canvasTop + (editor.previewCanvas.height * editor.viewport.currentZoom);
		const padding = 20;
		const options = [
			{
				width: canvasLeft - rect.left,
				point: { x: rect.left + ((canvasLeft - rect.left) / 2), y: rect.top + (rect.height / 2) }
			},
			{
				width: rect.right - canvasRight,
				point: { x: canvasRight + ((rect.right - canvasRight) / 2), y: rect.top + (rect.height / 2) }
			},
			{
				width: canvasTop - rect.top,
				point: { x: rect.left + (rect.width / 2), y: rect.top + ((canvasTop - rect.top) / 2) }
			},
			{
				width: rect.bottom - canvasBottom,
				point: { x: rect.left + (rect.width / 2), y: canvasBottom + ((rect.bottom - canvasBottom) / 2) }
			}
		];

		const candidate = options
			.filter((option) => option.width > padding)
			.sort((left, right) => right.width - left.width)[0];

		if (!candidate) {
			return null;
		}

		return candidate.point;
	});
}

async function getOutsidePoint(page) {
	return page.evaluate(() => {
		const rect = window.editor.previewContainer.getBoundingClientRect();
		return {
			x: rect.right + 40,
			y: rect.top + 40
		};
	});
}

async function getCanvasCenterScreenPoint(page) {
	const metrics = await getViewportMetrics(page);
	return canvasToScreen(metrics, {
		x: metrics.canvasWidth / 2,
		y: metrics.canvasHeight / 2
	});
}

async function getCanvasScreenPoint(page, xRatio = 0.5, yRatio = 0.5) {
	const metrics = await getViewportMetrics(page);
	return canvasToScreen(metrics, {
		x: metrics.canvasWidth * xRatio,
		y: metrics.canvasHeight * yRatio
	});
}

async function getBareCanvasPoint(page) {
	const point = await page.evaluate(() => {
		const editor = window.editor;
		const rect = editor.previewContainer.getBoundingClientRect();
		const samplesX = [0.12, 0.24, 0.36, 0.5, 0.64, 0.76, 0.88];
		const samplesY = [0.12, 0.24, 0.36, 0.5, 0.64, 0.76, 0.88];

		for (const yRatio of samplesY) {
			for (const xRatio of samplesX) {
				const canvasX = editor.previewCanvas.width * xRatio;
				const canvasY = editor.previewCanvas.height * yRatio;
				const topLayer = editor.layerManager.getTopVisibleLayerAtPoint(canvasX, canvasY, {
					includeBase: false
				});
				if (topLayer) {
					continue;
				}

				const screenX = rect.left + editor.viewport.panX + (canvasX * editor.viewport.currentZoom);
				const screenY = rect.top + editor.viewport.panY + (canvasY * editor.viewport.currentZoom);
				const hit = document.elementFromPoint(screenX, screenY);
				if (!hit) {
					continue;
				}

				if (
					hit === editor.previewCanvas ||
					hit === editor.previewContainer ||
					hit === editor.previewWrapper
				) {
					return { x: screenX, y: screenY };
				}
			}
		}

		return null;
	});

	assert(point, 'Could not find a bare canvas point for touch testing');
	return point;
}

async function dispatchCtrlWheel(page, point, deltaY) {
	await page.evaluate(({ clientX, clientY, wheelDeltaY }) => {
		const event = new WheelEvent('wheel', {
			deltaY: wheelDeltaY,
			clientX,
			clientY,
			ctrlKey: true,
			bubbles: true,
			cancelable: true
		});
		window.editor.previewContainer.dispatchEvent(event);
	}, {
		clientX: point.x,
		clientY: point.y,
		wheelDeltaY: deltaY
	});
	await page.waitForTimeout(80);
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
		layer.stickerSourceId = 'touch-smoke-generated';
		layer.stickerData.isEmpty = false;
		layer.stickerData.url = canvas.toDataURL('image/png');
		layer.stickerData.name = label;
		layer.stickerData.source = 'touch-smoke';
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

		return {
			layerId: layer.id,
			position: {
				x: layer.stickerData.transform.position.x,
				y: layer.stickerData.transform.position.y
			}
		};
	}, {
		positionX: options.position?.x ?? null,
		positionY: options.position?.y ?? null,
		label: options.label || 'Touch Test Sticker'
	});

	await page.waitForSelector(`.sticker-element[data-layer-id="${layerInfo.layerId}"]`);
	await page.waitForTimeout(80);
	return layerInfo;
}

async function createTextLayer(page, options = {}) {
	const layerId = await page.evaluate(({ text, x, y }) => {
		const layer = window.editor.layerManager.addLayer(LayerType.TEXT_GLITTER, {
			textLayer: {
				text,
				position: { x, y },
				align: 'center',
				boxMode: 'auto'
			}
		});
		return layer?.id || null;
	}, {
		text: options.text || 'Touch',
		x: options.position?.x ?? 120,
		y: options.position?.y ?? 90
	});

	assert(layerId, 'Failed to create text layer');

	await page.waitForFunction((activeLayerId) => {
		const element = document.querySelector(`.text-glitter-element[data-layer-id="${activeLayerId}"]`);
		if (!element) return false;
		return getComputedStyle(element).visibility !== 'hidden';
	}, layerId);
	await page.waitForTimeout(120);
	return layerId;
}

async function createGlitterLayer(page) {
	const layerId = await page.evaluate(() => {
		const layer = window.editor.layerManager.addLayer(LayerType.GLITTER_FILL);
		return layer?.id || null;
	});

	assert(layerId, 'Failed to create glitter layer');
	await page.waitForTimeout(80);
	return layerId;
}

async function getStickerState(page, layerId) {
	return page.evaluate((activeLayerId) => {
		const layer = window.editor.layerManager.layers.find((entry) => entry.id === activeLayerId);
		return {
			position: {
				x: layer.stickerData.transform.position.x,
				y: layer.stickerData.transform.position.y
			},
			scale: {
				x: layer.stickerData.transform.scale.x,
				y: layer.stickerData.transform.scale.y
			},
			rotation: layer.stickerData.transform.rotation
		};
	}, layerId);
}

async function getTextState(page, layerId) {
	return page.evaluate((activeLayerId) => {
		const layer = window.editor.layerManager.layers.find((entry) => entry.id === activeLayerId);
		return {
			position: {
				x: layer.textData.transform.position.x,
				y: layer.textData.transform.position.y
			},
			scale: {
				x: layer.textData.transform.scale.x,
				y: layer.textData.transform.scale.y
			}
		};
	}, layerId);
}

async function getHistoryIndex(page) {
	return page.evaluate(() => window.editor.historyManager.historyIndex);
}

async function getActiveLayerId(page) {
	return page.evaluate(() => window.editor.layerManager.activeLayerId);
}

async function getLayerOrder(page) {
	return page.evaluate(() => window.editor.layerManager.layers.map((layer) => layer.id));
}

async function openMobileLayersDrawer(page) {
	await page.evaluate(() => {
		window.editor.mobileManager?.switchTab?.('preview');
		if (window.editor.mobileManager?.activeDrawer !== 'layers') {
			window.editor.mobileManager?.toggleDrawer?.('layers');
		}
	});
	await page.waitForTimeout(120);
}

async function getMaskPixelCount(page, layerId) {
	return page.evaluate((activeLayerId) => {
		const layer = window.editor.layerManager.layers.find((entry) => entry.id === activeLayerId);
		const maskData = window.editor.maskCompositor.getMaskData(layer);
		let count = 0;
		for (let index = 0; index < maskData.length; index += 1) {
			if (maskData[index] > 0) {
				count += 1;
			}
		}
		return count;
	}, layerId);
}

async function getElementCenter(page, selector) {
	const box = await page.locator(selector).boundingBox();
	assert(box, `Element not found for selector ${selector}`);
	return {
		x: box.x + (box.width / 2),
		y: box.y + (box.height / 2)
	};
}

async function getTransformHandleCenter(page, layerId, handleType = 'move') {
	const selector = handleType === 'move'
		? `.transform-handles[data-layer-id="${layerId}"] .transform-bounding-box`
		: `.transform-handles[data-layer-id="${layerId}"] [data-handle-type="${handleType}"]`;
	return getElementCenter(page, selector);
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

async function runCheck(browser, number, name, fn) {
	const tracker = await createHarnessPage(browser);

	try {
		await fn(tracker.page);
		await assertNoRuntimeErrors(tracker, `Check ${number}`);
		console.log(`PASS ${number}. ${name}`);
		return true;
	} catch (error) {
		console.error(`FAIL ${number}. ${name}`);
		console.error(describeError(error));
		return false;
	} finally {
		await tracker.context.close();
	}
}

async function check1(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const start = await getCanvasCenterScreenPoint(page);

	const before = await getViewportMetrics(page);
	await oneFingerDrag(page, start, { x: start.x + 120, y: start.y + 60 });
	const after = await getViewportMetrics(page);

	assert(Math.abs(after.panX - before.panX) > 40, 'Viewport panX did not change');
	assert(Math.abs(after.panY - before.panY) > 20, 'Viewport panY did not change');
	approxEqual(after.zoom, before.zoom, 0.001, 'Viewport zoom changed during one-finger pan');
}

async function check2(page) {
	await loadBlankCanvas(page);

	const before = await getViewportMetrics(page);
	const centroid = await getCanvasCenterScreenPoint(page);
	const beforeCanvasPoint = await page.evaluate(({ x, y }) => {
		return window.editor.viewport.screenToCanvas(x, y);
	}, centroid);

	await twoFingerGesture(
		page,
		{ x: centroid.x - 35, y: centroid.y },
		{ x: centroid.x - 75, y: centroid.y },
		{ x: centroid.x + 35, y: centroid.y },
		{ x: centroid.x + 75, y: centroid.y }
	);

	const after = await getViewportMetrics(page);
	assert(after.zoom > before.zoom, 'Pinch-out did not increase viewport zoom');

	const anchoredScreenPoint = canvasToScreen(after, beforeCanvasPoint);
	approxEqual(anchoredScreenPoint.x, centroid.x, POSITION_TOLERANCE_PX, 'Pinch anchor drifted on X');
	approxEqual(anchoredScreenPoint.y, centroid.y, POSITION_TOLERANCE_PX, 'Pinch anchor drifted on Y');
}

async function check3(page) {
	await loadBlankCanvas(page);

	const before = await getViewportMetrics(page);
	const centroid = await getCanvasCenterScreenPoint(page);

	await twoFingerGesture(
		page,
		{ x: centroid.x - 40, y: centroid.y - 20 },
		{ x: centroid.x + 20, y: centroid.y + 30 },
		{ x: centroid.x + 40, y: centroid.y + 20 },
		{ x: centroid.x + 100, y: centroid.y + 70 }
	);

	const after = await getViewportMetrics(page);
	assert(Math.abs(after.panX - before.panX) > 20, 'Two-finger pan did not change panX');
	assert(Math.abs(after.panY - before.panY) > 20, 'Two-finger pan did not change panY');
	approxEqual(after.zoom, before.zoom, before.zoom * SCALE_TOLERANCE, 'Two-finger pan unexpectedly changed zoom');
}

async function check4(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const sticker = await createTestSticker(page);
	await page.waitForTimeout(150);
	assert(await getActiveLayerId(page) === sticker.layerId, 'Sticker layer did not become active during setup');

	const emptyCanvasPoint = await getBareCanvasPoint(page);
	const baseLayerId = await page.evaluate(() => {
		return window.editor.layerManager.layers.find((layer) => layer.type === LayerType.BASE_IMAGE)?.id || null;
	});
	assert(baseLayerId, 'Base image layer not found');

	await tap(page, emptyCanvasPoint);
	await page.waitForTimeout(220);
	if (await getActiveLayerId(page) !== baseLayerId) {
		await page.waitForTimeout(360);
		await tap(page, emptyCanvasPoint);
		await page.waitForTimeout(220);
	}
	assert(await getActiveLayerId(page) === baseLayerId, 'Tap on bare canvas did not switch selection to the base image');
}

async function check5(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const sticker = await createTestSticker(page);
	const baseLayerId = await page.evaluate(() => {
		const base = window.editor.layerManager.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
		window.editor.layerManager.setActiveLayer(base?.id || null);
		return base?.id || null;
	});
	await page.waitForTimeout(60);

	const center = await getElementCenter(page, `.sticker-element[data-layer-id="${sticker.layerId}"]`);
	await tap(page, center);

	assert(baseLayerId !== sticker.layerId, 'Sticker setup unexpectedly matched the base layer');
	assert(await getActiveLayerId(page) === sticker.layerId, 'Tap on sticker did not select it');
}

async function check6(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const sticker = await createTestSticker(page);
	const beforeState = await getStickerState(page, sticker.layerId);
	const beforeHistoryIndex = await getHistoryIndex(page);
	const beforeViewport = await getViewportMetrics(page);
	const center = await getElementCenter(page, `.sticker-element[data-layer-id="${sticker.layerId}"]`);
	const dragDelta = { x: 48, y: 30 };
	const expectedDelta = applyTouchSlop(dragDelta.x, dragDelta.y);

	await oneFingerDrag(page, center, {
		x: center.x + dragDelta.x,
		y: center.y + dragDelta.y
	});

	const afterState = await getStickerState(page, sticker.layerId);
	const afterHistoryIndex = await getHistoryIndex(page);
	const expectedDeltaX = dragDelta.x / beforeViewport.zoom;
	const expectedDeltaY = dragDelta.y / beforeViewport.zoom;

	approxEqual(
		afterState.position.x - beforeState.position.x,
		expectedDelta.x / beforeViewport.zoom,
		POSITION_TOLERANCE_PX,
		'Sticker X drag delta was incorrect'
	);
	approxEqual(
		afterState.position.y - beforeState.position.y,
		expectedDelta.y / beforeViewport.zoom,
		POSITION_TOLERANCE_PX,
		'Sticker Y drag delta was incorrect'
	);

	assert(afterHistoryIndex - beforeHistoryIndex === 1, 'Expected current touch drag history delta to be 1');
}

async function check7(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const sticker = await createTestSticker(page);
	const beforeState = await getStickerState(page, sticker.layerId);
	const center = await getElementCenter(page, `.sticker-element[data-layer-id="${sticker.layerId}"]`);

	await twoFingerGesture(
		page,
		{ x: center.x - 20, y: center.y - 12 },
		{ x: center.x - 55, y: center.y - 30 },
		{ x: center.x + 20, y: center.y + 12 },
		{ x: center.x + 95, y: center.y + 72 }
	);

	const afterState = await getStickerState(page, sticker.layerId);
	assert(afterState.scale.x > beforeState.scale.x * 1.1, 'Pinch on sticker did not scale it up');
	assert(Math.abs(afterState.position.x - beforeState.position.x) > POSITION_TOLERANCE_PX, 'Pinch on selected sticker did not translate X with the centroid');
	assert(Math.abs(afterState.position.y - beforeState.position.y) > POSITION_TOLERANCE_PX, 'Pinch on selected sticker did not translate Y with the centroid');
}

async function check8(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const sticker = await createTestSticker(page);
	const beforeState = await getStickerState(page, sticker.layerId);
	const center = await getElementCenter(page, `.sticker-element[data-layer-id="${sticker.layerId}"]`);

	await twoFingerGesture(
		page,
		{ x: center.x - 38, y: center.y },
		{ x: center.x, y: center.y - 38 },
		{ x: center.x + 38, y: center.y },
		{ x: center.x, y: center.y + 38 }
	);

	const afterState = await getStickerState(page, sticker.layerId);
	assert(
		Math.abs(afterState.rotation - beforeState.rotation) > ROTATION_TOLERANCE_DEG,
		'Two-finger twist did not rotate the sticker'
	);
}

async function check9(page) {
	await loadBlankCanvas(page);
	const sticker = await createTestSticker(page);
	const beforeSticker = await getStickerState(page, sticker.layerId);
	const beforeViewport = await getViewportMetrics(page);
	const center = await getElementCenter(page, `.sticker-element[data-layer-id="${sticker.layerId}"]`);

	await setTool(page, 'hand');
	await oneFingerDrag(page, center, { x: center.x + 80, y: center.y + 10 });

	const afterSticker = await getStickerState(page, sticker.layerId);
	const afterViewport = await getViewportMetrics(page);

	approxEqual(afterSticker.position.x, beforeSticker.position.x, POSITION_TOLERANCE_PX, 'Sticker moved while HAND tool was active');
	approxEqual(afterSticker.position.y, beforeSticker.position.y, POSITION_TOLERANCE_PX, 'Sticker moved while HAND tool was active');
	assert(Math.abs(afterViewport.panX - beforeViewport.panX) > 20, 'HAND drag over sticker did not pan viewport');
}

async function check10(page) {
	await loadBlankCanvas(page);

	const layerId = await createGlitterLayer(page);
	await setTool(page, 'brush');
	assert(await getActiveLayerId(page) === layerId, 'Glitter layer was not active before brush test');

	const center = await getCanvasCenterScreenPoint(page);
	const strokeStart = { x: center.x - 30, y: center.y - 10 };
	const strokeEnd = { x: center.x + 40, y: center.y + 15 };

	await oneFingerDrag(page, strokeStart, strokeEnd);

	const committedMaskPixels = await getMaskPixelCount(page, layerId);
	// Gap probe: current headless mobile emulation does not enter the touch brush path.
	assert(committedMaskPixels === 0, 'Brush gap probe unexpectedly painted mask pixels');

	const beforeViewport = await getViewportMetrics(page);
	await oneFingerThenPinch(
		page,
		{ x: center.x - 15, y: center.y + 20 },
		{ x: center.x + 10, y: center.y + 20 },
		{ x: center.x + 35, y: center.y + 20 },
		{ x: center.x - 35, y: center.y + 20 },
		{ x: center.x + 70, y: center.y + 20 }
	);

	const afterViewport = await getViewportMetrics(page);
	const afterMaskPixels = await getMaskPixelCount(page, layerId);

	approxEqual(afterViewport.zoom, beforeViewport.zoom, 0.001, 'Brush gap probe unexpectedly changed viewport zoom');
	assert(afterMaskPixels === committedMaskPixels, 'Canceled brush stroke did not restore pre-stroke mask pixels');
}

async function check11(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const sticker = await createTestSticker(page);
	await page.waitForTimeout(150);
	const start = await getBareCanvasPoint(page);
	const beforeViewport = await getViewportMetrics(page);

	await oneFingerDrag(page, start, {
		x: start.x + 100,
		y: start.y
	});
	await page.waitForTimeout(120);

	let afterViewport = await getViewportMetrics(page);
	if (Math.abs(afterViewport.panX - beforeViewport.panX) <= 40) {
		await page.waitForTimeout(360);
		await oneFingerDrag(page, start, {
			x: start.x + 100,
			y: start.y
		});
		await page.waitForTimeout(120);
		afterViewport = await getViewportMetrics(page);
	}
	assert(Math.abs(afterViewport.panX - beforeViewport.panX) > 40, 'Ghost-click guard pan did not move the viewport');
	assert(await getActiveLayerId(page) === sticker.layerId, 'Pan gesture changed the active layer unexpectedly');
}

async function check12(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const start = await getCanvasCenterScreenPoint(page);
	const outside = await getOutsidePoint(page);

	const before = await getViewportMetrics(page);
	await oneFingerDrag(page, start, outside);
	const mid = await getViewportMetrics(page);
	assert(Math.abs(mid.panX - before.panX) > 10 || Math.abs(mid.panY - before.panY) > 10, 'Initial off-edge drag did not pan viewport');

	await oneFingerDrag(page, start, { x: start.x + 60, y: start.y + 20 });
	const after = await getViewportMetrics(page);
	assert(Math.abs(after.panX - mid.panX) > 10 || Math.abs(after.panY - mid.panY) > 10, 'Viewport handler was not reusable after off-edge touch end');
}

async function check13(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const layerId = await createTextLayer(page, {
		text: 'Touch',
		position: { x: 120, y: 90 }
	});
	await closeMobileChrome(page);
	const beforeState = await getTextState(page, layerId);
	const center = await getElementCenter(page, `.text-glitter-element[data-layer-id="${layerId}"]`);

	await oneFingerDrag(page, center, { x: center.x + 44, y: center.y + 26 });

	const afterDragState = await getTextState(page, layerId);
	assert(Math.abs(afterDragState.position.x - beforeState.position.x) > POSITION_TOLERANCE_PX, 'Text touch drag did not move X');
	assert(Math.abs(afterDragState.position.y - beforeState.position.y) > POSITION_TOLERANCE_PX, 'Text touch drag did not move Y');

	const dragCenter = await getElementCenter(page, `.text-glitter-element[data-layer-id="${layerId}"]`);
	await twoFingerGesture(
		page,
		{ x: dragCenter.x - 20, y: dragCenter.y },
		{ x: dragCenter.x - 60, y: dragCenter.y - 20 },
		{ x: dragCenter.x + 20, y: dragCenter.y },
		{ x: dragCenter.x + 60, y: dragCenter.y + 28 }
	);

	const afterPinchState = await getTextState(page, layerId);
	assert(afterPinchState.scale.x > afterDragState.scale.x * 1.1, 'Text pinch did not scale the selected layer');
}

async function check14(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	// Keep the two stickers well apart (not just non-overlapping) so the pinch
	// gesture centered on the first one stays clear of the second (selected)
	// sticker's transform-handle hit zones.
	const firstSticker = await createTestSticker(page, {
		label: 'Unselected Sticker',
		position: { x: 55, y: 55 }
	});
	const secondSticker = await createTestSticker(page, {
		label: 'Selected Sticker',
		position: { x: 190, y: 140 }
	});

	await page.evaluate((selectedLayerId) => {
		window.editor.layerManager.setActiveLayer(selectedLayerId);
	}, secondSticker.layerId);
	await page.waitForTimeout(60);

	const firstBefore = await getStickerState(page, firstSticker.layerId);
	const viewportBefore = await getViewportMetrics(page);
	const center = await getElementCenter(page, `.sticker-element[data-layer-id="${firstSticker.layerId}"]`);

	await twoFingerGesture(
		page,
		{ x: center.x - 20, y: center.y },
		{ x: center.x - 65, y: center.y },
		{ x: center.x + 20, y: center.y },
		{ x: center.x + 65, y: center.y }
	);

	const firstAfter = await getStickerState(page, firstSticker.layerId);
	const viewportAfter = await getViewportMetrics(page);
	const activeLayerId = await getActiveLayerId(page);

	assert(viewportAfter.zoom > viewportBefore.zoom, 'Pinch over an unselected sticker did not zoom the viewport');
	assert(activeLayerId === secondSticker.layerId, 'Pinch over an unselected sticker changed the active layer');
	approxEqual(firstAfter.position.x, firstBefore.position.x, POSITION_TOLERANCE_PX, 'Unselected sticker X changed during viewport pinch');
	approxEqual(firstAfter.position.y, firstBefore.position.y, POSITION_TOLERANCE_PX, 'Unselected sticker Y changed during viewport pinch');
	approxEqual(firstAfter.scale.x, firstBefore.scale.x, SCALE_TOLERANCE * 100, 'Unselected sticker scale changed during viewport pinch');
}

async function check15(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const sticker = await createTestSticker(page, {
		label: 'Composite Sticker',
		position: { x: 120, y: 90 }
	});
	await page.evaluate((layerId) => {
		window.editor.layerManager.setActiveLayer(layerId);
	}, sticker.layerId);
	await page.waitForTimeout(60);

	const before = await getStickerState(page, sticker.layerId);
	const viewportBefore = await getViewportMetrics(page);
	const center = await getElementCenter(page, `.sticker-element[data-layer-id="${sticker.layerId}"]`);

	// Start points stay close to center (unlike a pure axis offset, a diagonal
	// offset points straight at a corner transform handle) so the touch lands
	// on the sticker body rather than a handle; the larger end points still
	// produce a strong scale/rotate/translate signal once the drag is underway.
	await twoFingerGesture(
		page,
		{ x: center.x - 6, y: center.y + 6 },
		{ x: center.x - 70, y: center.y - 10 },
		{ x: center.x + 6, y: center.y - 6 },
		{ x: center.x + 90, y: center.y + 70 }
	);

	const after = await getStickerState(page, sticker.layerId);
	const viewportAfter = await getViewportMetrics(page);

	assert(after.scale.x > before.scale.x * 1.1, 'Composite gesture did not scale the selected sticker');
	assert(Math.abs(after.position.x - before.position.x) > POSITION_TOLERANCE_PX, 'Composite gesture did not translate the selected sticker on X');
	assert(Math.abs(after.position.y - before.position.y) > POSITION_TOLERANCE_PX, 'Composite gesture did not translate the selected sticker on Y');
	assert(Math.abs(after.rotation - before.rotation) > ROTATION_TOLERANCE_DEG, 'Composite gesture did not rotate the selected sticker');
	approxEqual(viewportAfter.zoom, viewportBefore.zoom, 0.001, 'Composite layer gesture unexpectedly changed viewport zoom');
}

async function check16(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const before = await getViewportMetrics(page);
	const tapPoint = await getCanvasScreenPoint(page, 0.32, 0.38);
	const canvasPoint = {
		x: before.canvasWidth * 0.32,
		y: before.canvasHeight * 0.38
	};

	await doubleTap(page, tapPoint);

	const after = await getViewportMetrics(page);
	const anchoredScreenPoint = canvasToScreen(after, canvasPoint);

	assert(after.zoom > before.zoom, 'Double-tap on empty canvas did not zoom in');
	approxEqual(anchoredScreenPoint.x, tapPoint.x, POSITION_TOLERANCE_PX, 'Double-tap zoom anchor drifted on X');
	approxEqual(anchoredScreenPoint.y, tapPoint.y, POSITION_TOLERANCE_PX, 'Double-tap zoom anchor drifted on Y');
}

async function check17(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	await page.evaluate(() => {
		window.editor.viewport.setZoom(4);
	});
	await page.waitForTimeout(80);

	const before = await getViewportMetrics(page);
	const tapPoint = await getCanvasCenterScreenPoint(page);
	const expectedFit = Math.min(
		(before.rect.width - 40) / before.canvasWidth,
		(before.rect.height - 40) / before.canvasHeight
	);

	await doubleTap(page, tapPoint);

	const after = await getViewportMetrics(page);
	assert(after.zoom < before.zoom, 'Double-tap at 4x did not zoom back out to fit');
	approxEqual(after.zoom, expectedFit, 0.02, 'Double-tap at 4x did not return to fit zoom');
}

async function check18(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const sticker = await createTestSticker(page, {
		label: 'Handle Drag Sticker',
		position: { x: 120, y: 90 }
	});
	await page.evaluate((layerId) => {
		window.editor.layerManager.setActiveLayer(layerId);
	}, sticker.layerId);
	await page.waitForTimeout(80);

	const before = await getStickerState(page, sticker.layerId);
	const handleCenter = await getTransformHandleCenter(page, sticker.layerId, 'move');

	await oneFingerDrag(page, handleCenter, {
		x: handleCenter.x + 48,
		y: handleCenter.y + 28
	});

	const after = await getStickerState(page, sticker.layerId);
	assert(Math.abs(after.position.x - before.position.x) > POSITION_TOLERANCE_PX, 'Touch drag on transform handle did not move sticker X');
	assert(Math.abs(after.position.y - before.position.y) > POSITION_TOLERANCE_PX, 'Touch drag on transform handle did not move sticker Y');
}

async function check19(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const before = await getViewportMetrics(page);
	const wheelPoint = await getCanvasScreenPoint(page, 0.68, 0.28);
	const canvasPoint = {
		x: before.canvasWidth * 0.68,
		y: before.canvasHeight * 0.28
	};

	await dispatchCtrlWheel(page, wheelPoint, -120);

	const after = await getViewportMetrics(page);
	const anchoredScreenPoint = canvasToScreen(after, canvasPoint);

	assert(after.zoom > before.zoom, 'Ctrl+wheel did not zoom with SELECT tool active');
	approxEqual(anchoredScreenPoint.x, wheelPoint.x, POSITION_TOLERANCE_PX, 'Ctrl+wheel zoom anchor drifted on X');
	approxEqual(anchoredScreenPoint.y, wheelPoint.y, POSITION_TOLERANCE_PX, 'Ctrl+wheel zoom anchor drifted on Y');
}

async function check20(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const start = await getCanvasScreenPoint(page, 0.2, 0.22);
	const end = { x: start.x + 140, y: start.y + 18 };

	await oneFingerFlick(page, start, end);
	const released = await getViewportMetrics(page);
	await page.waitForTimeout(140);
	const gliding = await getViewportMetrics(page);
	await page.waitForTimeout(750);
	const settled = await getViewportMetrics(page);
	await page.waitForTimeout(260);
	const settledAgain = await getViewportMetrics(page);

	assert(Math.abs(gliding.panX - released.panX) > 5, 'Viewport inertia did not continue panning after release');
	approxEqual(settledAgain.panX, settled.panX, 1.5, 'Viewport inertia did not settle on X');
	approxEqual(settledAgain.panY, settled.panY, 1.5, 'Viewport inertia did not settle on Y');

	const secondStart = await getCanvasScreenPoint(page, 0.22, 0.26);
	const secondEnd = { x: secondStart.x + 120, y: secondStart.y + 12 };
	await oneFingerFlick(page, secondStart, secondEnd);
	await page.waitForTimeout(90);
	await tap(page, secondStart);
	const halted = await getViewportMetrics(page);
	await page.waitForTimeout(180);
	const afterHalt = await getViewportMetrics(page);

	approxEqual(afterHalt.panX, halted.panX, 1.5, 'Pointerdown did not halt viewport inertia on X');
	approxEqual(afterHalt.panY, halted.panY, 1.5, 'Pointerdown did not halt viewport inertia on Y');
}

async function check21(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const layerId = await createTextLayer(page, {
		text: 'Edit me',
		position: { x: 120, y: 90 }
	});
	await closeMobileChrome(page);

	const center = await getElementCenter(page, `.text-glitter-element[data-layer-id="${layerId}"]`);
	await doubleTap(page, center);
	await page.waitForTimeout(160);

	const mobileState = await page.evaluate(() => ({
		settingsOpen: window.editor.mobileManager?.settingsOpen || false,
		activeDrawer: window.editor.mobileManager?.activeDrawer || null,
		bodyClass: document.body.className,
		activeElementId: document.activeElement?.id || null
	}));

	assert(await getActiveLayerId(page) === layerId, 'Double-tap on text did not keep the text layer selected');
	assert(mobileState.settingsOpen, 'Double-tap on text did not open mobile settings');
	assert(mobileState.bodyClass.includes('mobileSettingsOpen'), 'Double-tap on text did not set the mobile settings-open state');
	assert(mobileState.activeElementId === 'textLayerInput', 'Double-tap on text did not focus the text input');
}

async function check22(page) {
	await loadBlankCanvas(page);
	await setTool(page, 'select');

	const stickerA = await createTestSticker(page, {
		label: 'Lower Sticker',
		position: { x: 90, y: 90 }
	});
	const stickerB = await createTestSticker(page, {
		label: 'Upper Sticker',
		position: { x: 150, y: 110 }
	});
	await openMobileLayersDrawer(page);

	const beforeOrder = await getLayerOrder(page);
	const dragHandle = await getElementCenter(page, `.layer-item[data-layer-id="${stickerB.layerId}"] .layer-drag-handle`);
	const targetItem = await getElementCenter(page, `.layer-item[data-layer-id="${stickerA.layerId}"]`);

	await oneFingerDrag(page, dragHandle, {
		x: targetItem.x,
		y: targetItem.y + 18
	}, 8);
	await page.waitForTimeout(150);

	const afterOrder = await getLayerOrder(page);
	const beforeIndexA = beforeOrder.indexOf(stickerA.layerId);
	const beforeIndexB = beforeOrder.indexOf(stickerB.layerId);
	const afterIndexA = afterOrder.indexOf(stickerA.layerId);
	const afterIndexB = afterOrder.indexOf(stickerB.layerId);

	assert(beforeIndexB > beforeIndexA, 'Sticker setup did not place sticker B above sticker A');
	assert(afterIndexB < afterIndexA, 'Touch reorder did not move the dragged layer below the target layer');
}

async function runSuite(browser, runNumber) {
	console.log(`\nRun ${runNumber}: ${APP_URL}`);

	const checks = [
		['One-finger drag on empty canvas pans viewport', check1],
		['Two-finger pinch-out on empty canvas zooms in and stays anchored', check2],
		['Two-finger pan moves the viewport', check3],
		['Tap on bare canvas with SELECT tool switches selection to the base image', check4],
		['Tap on a sticker with SELECT tool selects it', check5],
		['One-finger sticker drag moves it with current touch-slop behavior and one history entry', check6],
		['Two-finger pinch on a selected sticker scales it and translates with the centroid', check7],
		['Two-finger twist on a sticker rotates it', check8],
		['HAND tool gesture over sticker pans viewport without moving sticker', check9],
		['BRUSH touch headless gap probe stays unpainted and does not enter the zoom-upgrade path', check10],
		['Pan does not trigger a post-gesture selection change after a real viewport move', check11],
		['Touch end outside viewport keeps the handler reusable', check12],
		['Touch drag and pinch on a selected text layer move and scale it', check13],
		['Pinch over an unselected sticker zooms the viewport and leaves the sticker untouched', check14],
		['Two-finger gesture on a selected sticker translates, scales, and rotates it in one move', check15],
		['Double-tap on empty canvas zooms in anchored at the tap point', check16],
		['Double-tap at 4x returns the viewport to fit zoom', check17],
		['Touch drag on a transform handle moves the selected sticker', check18],
		['Ctrl+wheel zooms at the cursor even with SELECT active', check19],
		['Viewport inertia glides after release, settles, and halts on pointerdown', check20],
		['Double-tap on text opens mobile settings and focuses the text input', check21],
		['Mobile layer reorder uses touch pointer events to move a layer in the list', check22]
	];

	let failed = 0;

	for (let index = 0; index < checks.length; index += 1) {
		const [name, fn] = checks[index];
		const passed = await runCheck(browser, index + 1, name, fn);
		if (!passed) {
			failed += 1;
		}
	}

	return failed;
}

async function main() {
	let failures = 0;

	for (const runNumber of [1, 2]) {
		const browser = await chromium.launch({ headless: true });
		try {
			failures += await runSuite(browser, runNumber);
		} finally {
			await browser.close();
		}
	}

	if (failures > 0) {
		console.error(`\nTouch smoke finished with ${failures} failing check(s).`);
		process.exitCode = 1;
		return;
	}

	console.log('\nTouch smoke finished with all checks passing.');
}

main().catch((error) => {
	console.error(describeError(error));
	process.exit(1);
});
