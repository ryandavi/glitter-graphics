'use strict';

// Fill layers move, scale, rotate and flip as one object. The mask stays a
// canvas-sized surface placed by `layer.transform`, so every consumer of that
// placement has to agree: the frame, picking, the preview DOM, the export
// compositor, the brush and canvas resize.

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const VIEWPORT = { width: 1280, height: 900 };
const FILL_COLOR = '#ff0000';
// Painted rect in mask-local px.
const RECT = { x: 40, y: 50, width: 80, height: 40 };

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function near(actual, expected, tolerance, label) {
	assert(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

async function dismissVisibleModals(page) {
	await page.evaluate(() => {
		document.querySelectorAll('.modal-overlay.visible').forEach((element) => {
			element.classList.remove('visible');
			element.style.display = 'none';
		});
	});
}

async function openEditor(page) {
	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor != null, null, { timeout: 15000 });
	await page.evaluate(async () => window.editor.loadBlankImage(320, 240, '#ffffff'));
	await page.waitForFunction(() => window.editor.originalImage != null);
	await dismissVisibleModals(page);
	await page.waitForTimeout(150);
}

async function createPaintedFill(page) {
	return page.evaluate(({ rect, color }) => {
		const editor = window.editor;
		const layer = editor.glitterManager.createLayer();
		editor.layerManager.insertLayer(layer, { suppressDesignGalleryFocus: true });
		layer.fill = { ...layer.fill, mode: 'solid', color };
		const paint = editor.paintMaskStore.ensurePaintMask(layer.id);
		const ctx = paint.add.getContext('2d', { willReadFrequently: true });
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
		paint.hasContent = true;
		paint.liveRevision += 1;
		layer.maskHasContent = true;
		editor.paintMaskStore.commitPaintState(layer);
		editor.setTool(ToolType.SELECT);
		editor.layerManager.setActiveLayer(layer.id);
		editor.updatePreview();
		editor.saveState('Paint mask');
		return layer.id;
	}, { rect: RECT, color: FILL_COLOR });
}

async function waitForMask(page, layerId) {
	await page.waitForFunction((id) => window.editor.glitterManager.maskImages.get(id)?.fullApplied === true, layerId, { timeout: 10000 });
	await page.waitForTimeout(80);
}

// Canvas-space bounds of the fill color in the composited export frame.
async function exportBounds(page, timestamp = 0) {
	return page.evaluate(async (timestamp) => {
		const editor = window.editor;
		const layers = editor.layers.filter((layer) => layer.visible && layerHasVisibleContent(layer));
		const composed = await editor.sceneCompositor.composeFrameAt({
			visibleLayers: layers,
			glitterGifs: editor.glitterLibrary.content,
			canvasData: {
				width: editor.originalCanvas.width,
				height: editor.originalCanvas.height,
				originalData: new Uint8ClampedArray(editor.originalImageData.data),
				originalAlpha: editor.originalAlphaChannel,
				alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold,
				hasBaseImage: false
			},
			exportSettings: { ...structuredClone(editor.exportSettings), watermarkEnabled: false, transparency: true, baseImage: false },
			target: EXPORT_TARGETS['still:png'],
			timestamp,
			callbacks: {
				onStatus: () => {},
				onProgress: () => {},
				isCancelled: () => false,
				createMask: (layer) => editor.maskCompositor.getMaskData(layer),
				renderSlotMasks: (layer) => getLayerManagerForType(editor, layer.type).renderSlotMasks(layer),
				ensureTextFont: (fontId) => FontLibrary.ensureLoaded(fontId)
			}
		});
		const { width, height } = composed;
		const data = composed.imageData.data;
		let minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const i = (y * width + x) * 4;
				if (data[i + 3] < 128 || data[i] < 200 || data[i + 1] > 80 || data[i + 2] > 80) continue;
				count++;
				if (x < minX) minX = x;
				if (y < minY) minY = y;
				if (x > maxX) maxX = x;
				if (y > maxY) maxY = y;
			}
		}
		return count ? { minX, minY, maxX: maxX + 1, maxY: maxY + 1, count } : null;
	}, timestamp);
}

// Canvas-space bounds of the fill color as the preview DOM actually paints it.
// `beforeShot` runs in the page once the selection chrome is gone.
async function previewBounds(page, beforeShot = null) {
	await page.evaluate(() => window.editor.setTool(ToolType.HAND));
	await page.waitForTimeout(80);
	if (beforeShot) await beforeShot();
	const shot = (await page.screenshot()).toString('base64');
	const bounds = await page.evaluate(async (base64) => {
		const image = new Image();
		image.src = `data:image/png;base64,${base64}`;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = image.width;
		canvas.height = image.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(image, 0, 0);
		const area = document.getElementById('previewContainer').getBoundingClientRect();
		const left = Math.max(0, Math.floor(area.left));
		const top = Math.max(0, Math.floor(area.top));
		const width = Math.min(canvas.width - left, Math.ceil(area.width));
		const height = Math.min(canvas.height - top, Math.ceil(area.height));
		const data = ctx.getImageData(left, top, width, height).data;
		let minX = width, minY = height, maxX = -1, maxY = -1;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const i = (y * width + x) * 4;
				if (data[i] < 200 || data[i + 1] > 80 || data[i + 2] > 80) continue;
				if (x < minX) minX = x;
				if (y < minY) minY = y;
				if (x > maxX) maxX = x;
				if (y > maxY) maxY = y;
			}
		}
		if (maxX < 0) return null;
		const viewport = window.editor.viewport;
		const a = viewport.screenToCanvas(left + minX, top + minY);
		const b = viewport.screenToCanvas(left + maxX + 1, top + maxY + 1);
		return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
	}, shot);
	await page.evaluate(() => window.editor.setTool(ToolType.SELECT));
	await page.waitForTimeout(80);
	return bounds;
}

async function frameBounds(page, layerId) {
	return page.evaluate((id) => {
		const metrics = window.editor.glitterManager.layerTransforms.get(id).getFrameMetrics();
		return { minX: metrics.minX, minY: metrics.minY, maxX: metrics.maxX, maxY: metrics.maxY };
	}, layerId);
}

function assertBounds(actual, expected, tolerance, label) {
	assert(actual, `${label}: nothing was painted`);
	['minX', 'minY', 'maxX', 'maxY'].forEach((key) => near(actual[key], expected[key], tolerance, `${label} ${key}`));
}

async function assertPlacement(page, layerId, label, tolerance = 2) {
	const frame = await frameBounds(page, layerId);
	assertBounds(await exportBounds(page), frame, tolerance, `${label}: export vs frame`);
	assertBounds(await previewBounds(page), frame, tolerance, `${label}: preview vs frame`);
	return frame;
}

async function setTransform(page, layerId, updates) {
	await page.evaluate(({ id, updates }) => {
		const editor = window.editor;
		const layer = editor.layerManager.getLayerById(id);
		editor.applyTransformEditWithAnchor(layer, editor.glitterManager, () => editor.glitterManager.updateTransform(id, updates));
	}, { id: layerId, updates });
	await page.waitForTimeout(60);
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));

	try {
		await openEditor(page);

		// 1. An empty fill has nothing to transform.
		const emptyState = await page.evaluate(() => {
			const editor = window.editor;
			const layer = editor.glitterManager.createLayer();
			editor.layerManager.insertLayer(layer, { suppressDesignGalleryFocus: true });
			editor.setTool(ToolType.SELECT);
			editor.layerManager.setActiveLayer(layer.id);
			editor.updatePreview();
			const state = {
				transformable: isLayerTransformable(layer),
				handles: document.querySelectorAll(`.transform-handles[data-layer-id="${layer.id}"]`).length,
				hasTransform: Boolean(layer.transform)
			};
			editor.layerManager.deleteLayers([layer.id], { skipHistory: true, silent: true });
			return state;
		});
		assert(emptyState.hasTransform, 'An empty fill layer still carries a transform');
		assert(!emptyState.transformable && emptyState.handles === 0, 'An empty fill layer must not show transform handles');

		// 2. The frame is the painted pixels, and identity placement is unchanged.
		const layerId = await createPaintedFill(page);
		await waitForMask(page, layerId);
		const identity = await assertPlacement(page, layerId, 'identity', 1);
		assertBounds(identity, { minX: RECT.x, minY: RECT.y, maxX: RECT.x + RECT.width, maxY: RECT.y + RECT.height }, 0.01, 'identity frame');
		const handles = await page.evaluate((id) => document.querySelectorAll(`.transform-handles[data-layer-id="${id}"]`).length, layerId);
		assert(handles === 1, `Expected one handle overlay on the selected fill, found ${handles}`);
		const passthrough = await page.evaluate((id) => getComputedStyle(window.editor.glitterManager.layerElements.get(id)).pointerEvents, layerId);
		assert(passthrough === 'none', 'The canvas-sized fill element must not take pointer events');

		// 3. Press-and-drag on the painted pixels moves the layer in one gesture,
		// while it is not selected.
		await page.evaluate(() => {
			const editor = window.editor;
			editor.layerManager.setActiveLayer(editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE).id);
		});
		const start = await page.evaluate((rect) => {
			const overlay = window.editor.viewport.selectionOverlay;
			const origin = overlay.element.getBoundingClientRect();
			const point = overlay.toScreen({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, overlay.getMapping());
			return { x: origin.left + point.x, y: origin.top + point.y, zoom: window.editor.viewport.currentZoom };
		}, RECT);
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(start.x + 30 * start.zoom, start.y + 20 * start.zoom, { steps: 6 });
		await page.mouse.up();
		await page.waitForTimeout(250);
		const dragged = await page.evaluate((id) => {
			const editor = window.editor;
			const layer = editor.layerManager.getLayerById(id);
			return {
				active: editor.layerManager.activeLayerId === id,
				x: layer.transform.position.x - editor.originalCanvas.width / 2,
				y: layer.transform.position.y - editor.originalCanvas.height / 2
			};
		}, layerId);
		assert(dragged.active, 'Dragging a fill selects it');
		// Snapping may pull the drag a few px toward a guide.
		near(dragged.x, 30, 12, 'drag moved the fill in x');
		near(dragged.y, 20, 12, 'drag moved the fill in y');
		await assertPlacement(page, layerId, 'after drag');

		// 4. Picking follows the moved mask.
		const picking = await page.evaluate(({ id, rect }) => {
			const editor = window.editor;
			const layer = editor.layerManager.getLayerById(id);
			const dx = layer.transform.position.x - editor.originalCanvas.width / 2;
			const dy = layer.transform.position.y - editor.originalCanvas.height / 2;
			const top = (x, y) => editor.layerManager.getTopVisibleLayerAtPoint(x, y, { includeBase: false })?.id || null;
			return {
				moved: top(rect.x + rect.width - 2 + dx, rect.y + rect.height - 2 + dy),
				vacated: top(rect.x + 2, rect.y + 2)
			};
		}, { id: layerId, rect: RECT });
		assert(picking.moved === layerId, 'The moved mask is picked where it now is');
		assert(dragged.x < 4 && dragged.y < 4 || picking.vacated === null, 'The vacated area no longer picks the fill');

		// 5. Rotate, scale and flip: frame, preview and export stay together.
		await setTransform(page, layerId, { rotation: 30 });
		await assertPlacement(page, layerId, 'rotated 30°');
		await setTransform(page, layerId, { scale: { x: 150, y: 75 } });
		await assertPlacement(page, layerId, 'rotated and scaled');
		await setTransform(page, layerId, { flipX: true });
		await assertPlacement(page, layerId, 'rotated, scaled and flipped');

		// 6. A brush stamp lands under the pointer on the transformed layer.
		const stamp = await page.evaluate((id) => {
			const editor = window.editor;
			const layer = editor.layerManager.getLayerById(id);
			const target = { x: 200, y: 150 };
			const local = editor.glitterManager.getMaskLocalPoint(layer, target);
			const paint = editor.paintMaskStore.ensurePaintMask(id);
			const ctx = paint.add.getContext('2d', { willReadFrequently: true });
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(Math.round(local.x) - 3, Math.round(local.y) - 3, 7, 7);
			paint.liveRevision += 1;
			editor.paintMaskStore.commitPaintState(layer);
			editor.updatePreview();
			return {
				hitsTarget: editor.glitterManager.hitTest(layer, target.x, target.y, 0),
				hitsElsewhere: editor.glitterManager.hitTest(layer, target.x + 40, target.y + 40, 0)
			};
		}, layerId);
		assert(stamp.hitsTarget, 'Paint mapped through the inverse transform lands under the pointer');
		assert(!stamp.hitsElsewhere, 'The stamp does not land away from the pointer');

		// 7. Structural canvas resize keeps a transformed fill on its content.
		await waitForMask(page, layerId);
		const beforeResize = await frameBounds(page, layerId);
		await page.evaluate(() => window.editor.resizeCanvas(400, 300, 50, 30, { saveHistory: false, updateStatus: false }));
		await page.waitForTimeout(200);
		await waitForMask(page, layerId);
		const afterResize = await frameBounds(page, layerId);
		assertBounds(afterResize, {
			minX: beforeResize.minX + 50, minY: beforeResize.minY + 30,
			maxX: beforeResize.maxX + 50, maxY: beforeResize.maxY + 30
		}, 1.01, 'canvas resize shifts the fill with the content');
		// The frame is one oriented box around the rect and the stamp, so its
		// bounds no longer equal the painted pixels'; preview and export still do.
		assertBounds(await previewBounds(page), await exportBounds(page), 2, 'after canvas resize: preview vs export');

		// 8. Reset Transform returns the fill to where it was painted.
		const reset = await page.evaluate((id) => {
			const editor = window.editor;
			editor.glitterManager.resetTransform(id);
			const transform = editor.layerManager.getLayerById(id).transform;
			return {
				x: transform.position.x, y: transform.position.y,
				rotation: transform.rotation, scaleX: transform.scale.x, flipX: transform.flipX,
				homeX: editor.originalCanvas.width / 2, homeY: editor.originalCanvas.height / 2
			};
		}, layerId);
		assert(reset.x === reset.homeX && reset.y === reset.homeY && reset.rotation === 0 && reset.scaleX === 100 && !reset.flipX,
			`Reset Transform restores the home placement, got ${JSON.stringify(reset)}`);

		// 9. A transform is an undo step of its own, and survives save and load.
		const history = await page.evaluate(async (id) => {
			const editor = window.editor;
			editor.saveState('Transform layer');
			editor.glitterManager.updateTransform(id, { position: { x: 123, y: 77 }, rotation: 45 });
			editor.saveState('Transform layer');
			const moved = structuredClone(editor.layerManager.getLayerById(id).transform);
			const roundTrip = await editor.layerManager.deserializeLayer(structuredClone(editor.layerManager.serializeLayer(editor.layerManager.getLayerById(id))));
			const legacy = editor.layerManager.serializeLayer(editor.layerManager.getLayerById(id));
			delete legacy.transform;
			const migrated = await editor.layerManager.deserializeLayer(structuredClone(legacy));
			await editor.historyManager.undo();
			const undone = structuredClone(editor.layerManager.getLayerById(id).transform);
			return {
				moved, undone, roundTrip: roundTrip.transform, migrated: migrated.transform,
				home: { x: editor.originalCanvas.width / 2, y: editor.originalCanvas.height / 2 }
			};
		}, layerId);
		assert(history.moved.position.x === 123 && history.moved.rotation === 45, 'The transform edit applied');
		assert(history.undone.position.x === history.home.x && history.undone.rotation === 0, `Undo restores the previous transform, got ${JSON.stringify(history.undone)}`);
		assert(history.roundTrip.position.x === 123 && history.roundTrip.rotation === 45, 'Serialization keeps the fill transform');
		assert(history.migrated.position.x === history.home.x && history.migrated.position.y === history.home.y && history.migrated.rotation === 0,
			'A fill saved before transforms existed loads at its home placement');

		// 10. On an odd-sized canvas the surface center sits on a half pixel.
		// Scaling the document and nudging keep its corner on the pixel grid.
		const odd = await page.evaluate((id) => {
			const editor = window.editor;
			editor.glitterManager.resetTransform(id);
			editor.scaleDocument(481, 361, 481 / editor.originalCanvas.width, { saveHistory: false, updateStatus: false });
			const transform = editor.layerManager.getLayerById(id).transform;
			const scaled = { ...transform.position };
			editor.glitterManager.updateTransform(id, { position: { x: transform.position.x + 1, y: transform.position.y } });
			return { scaled, nudged: { ...transform.position } };
		}, layerId);
		assert(odd.scaled.x === 240.5 && odd.scaled.y === 180.5, `Document scaling keeps the fill on its home placement, got ${JSON.stringify(odd.scaled)}`);
		assert(odd.nudged.x === 241.5 && odd.nudged.y === 180.5, `A 1px nudge moves an odd-sized surface 1px, got ${JSON.stringify(odd.nudged)}`);

		// 11. An animated fill that keeps a scale moves as far in the preview as
		// in the export, about the same origin.
		await page.evaluate((id) => {
			const editor = window.editor;
			const layer = editor.layerManager.getLayerById(id);
			editor.glitterManager.resetTransform(id);
			editor.applyTransformEditWithAnchor(layer, editor.glitterManager, () => editor.glitterManager.updateTransform(id, { scale: { x: 60, y: 60 }, rotation: 30 }));
			layer.animations = GlitterAnimation.normalizeAnimations([
				{ type: 'move', distance: 40, angle: 0, periodMs: 1000 },
				{ type: 'pulse', amount: 30, periodMs: 1000 }
			]);
			editor.glitterManager.renderLayer(layer);
			editor.animationTicker.setPaused(true);
		}, layerId);
		await waitForMask(page, layerId);
		const animatedPreview = await previewBounds(page, () => page.evaluate((id) => {
			const editor = window.editor;
			const layer = editor.layerManager.getLayerById(id);
			const wrapper = editor.glitterManager.layerElements.get(id).querySelector('.layer-anim-wrapper');
			LAYER_UI_CONFIG[layer.type].animate(layer, 500, wrapper, { editor, layerId: id, data: layer.animations });
		}, layerId));
		const stillExport = await exportBounds(page, 0);
		const animatedExport = await exportBounds(page, 500);
		assert(Math.abs(animatedExport.minX - stillExport.minX) > 10, 'The animation moves the fill in the export');
		assertBounds(animatedPreview, animatedExport, 2, 'animated fill: preview vs export');

		assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
		console.log('fill-transform-verify: all checks passed');
	} finally {
		await browser.close();
	}
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
