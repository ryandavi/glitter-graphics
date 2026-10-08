'use strict';

const assert = require('assert');
const fs = require('fs');
const { chromium } = require('playwright');
const url = process.env.GLITTER_URL || 'http://localhost/glitter/';

async function boot(browser, mobile = false) {
	const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: mobile, isMobile: mobile });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', (route) => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.GLITTER_TEST_CSS) }));
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor).catch((error) => { throw new Error(`${error.message}: ${errors.join('; ')}`); });
	await page.evaluate(() => editor.loadBlankImage(320, 240, '#123456'));
	await page.waitForFunction(() => Boolean(editor.originalImage));
	await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach((modal) => modal.classList.remove('visible')));
	return { context, page, errors };
}

async function main() {
	const browser = await chromium.launch();
	try {
		const { context, page, errors } = await boot(browser);
		const setup = await page.evaluate(() => {
			const layer = editor.layerManager.addLayer(LayerType.SHAPE, { shapeLayer: { shapeId: 'rectangle', position: { x: 160, y: 120 }, width: 80, height: 60 } });
			layer.transform.scale = { x: 150, y: 150 }; layer.transform.rotation = 30; layer.transform.flipX = true;
			layer.transform.anchor = { x: 0.3, y: 0.7 };
			layer.animations = [GlitterAnimation.normalizeAnimation({ type: 'marquee', angle: 37 })];
			editor.shapeGlitterManager.renderLayer(layer);
			const wrapper = editor.shapeGlitterManager.layerElements.get(layer.id).querySelector('.layer-anim-wrapper');
			const box = editor.sceneCompositor._getAnimationBox(layer, 320, 240);
			const exported = editor.sceneCompositor._buildAnimationSamplingContext(layer, box);
			const sampleAt = GlitterAnimation.sampleAt;
			let preview;
			GlitterAnimation.sampleAt = (value, time, context) => { preview = context; return sampleAt(value, time, context); };
			try { paintLayerAnimationPreview(layer, 1234, wrapper, { editor, layerId: layer.id, data: layer.animations }); }
			finally { GlitterAnimation.sampleAt = sampleAt; }
			const sample = sampleAt(layer.animations, 1234, exported);
			const move = GlitterAnimation.splitSample(sample).move;
			const matrix = new DOMMatrix(wrapper.style.transform);
			const rad = layer.transform.rotation * Math.PI / 180;
			const dx = -matrix.e, dy = matrix.f;
			const canvasMove = { x: dx * Math.cos(rad) - dy * Math.sin(rad), y: dx * Math.sin(rad) + dy * Math.cos(rad) };
			editor.saveState('Fixture');
			const copies = wrapper._motionCopies.map((copy) => {
				const matrix = new DOMMatrix(copy.style.transform);
				const dx = -matrix.e, dy = matrix.f;
				return { x: dx * Math.cos(rad) - dy * Math.sin(rad), y: dx * Math.sin(rad) + dy * Math.cos(rad) };
			});
			return { id: layer.id, preview, exported, move, canvasMove, copies, expectedCopies: sample.copies.filter(({ x, y }) => Math.abs(x) + Math.abs(y) > 1e-6).map(({ x, y }) => ({ x: move.x + x, y: move.y + y })), position: { ...layer.transform.position } };
		});
		assert.deepStrictEqual(setup.preview, setup.exported, `preview/export context differs: ${JSON.stringify({ preview: setup.preview, exported: setup.exported })}`);
		assert(Math.hypot(setup.move.x - setup.canvasMove.x, setup.move.y - setup.canvasMove.y) < 0.001, 'canvas-space moves differ');
		assert.strictEqual(setup.copies.length, 2);
		setup.copies.forEach((copy, index) => assert(Math.hypot(copy.x - setup.expectedCopies[index].x, copy.y - setup.expectedCopies[index].y) < 0.001, 'marquee copy preview/export offsets differ'));
		assert(await page.evaluate(() => {
			const source = document.createElement('canvas'); source.width = 80; source.height = 40;
			source.getContext('2d').fillRect(0, 0, 80, 40);
			const output = document.createElement('canvas'); output.width = 320; output.height = 240;
			const layer = { id: 'copy-fixture', type: LayerType.SHAPE, opacity: 100, transform: { position: { x: 160, y: 120 }, scale: { x: 100, y: 100 }, rotation: 0, flipX: false, flipY: false } };
			const context = GlitterAnimation.createSamplingContext({ area: { width: 320, height: 240 }, rest: { left: 120, top: 100, right: 200, bottom: 140 } });
			const animation = GlitterAnimation.normalizeAnimation({ type: 'marquee', angle: 0 });
			editor.sceneCompositor._activeLayerAnimation = { layer, sample: GlitterAnimation.sampleAt(animation, animation.periodMs / 2, context) };
			try { editor.sceneCompositor._drawTransformedCanvas(output.getContext('2d'), source, layer, 80, 40); }
			finally { editor.sceneCompositor._activeLayerAnimation = null; }
			const alpha = (x) => output.getContext('2d').getImageData(x, 120, 1, 1).data[3];
			return alpha(0) === 255 && alpha(319) === 255 && alpha(160) === 0;
		}), 'export omitted the incoming marquee copy');
		await page.keyboard.press('c');
		assert(await page.evaluate(() => editor.getActiveSession() === 'crop'));
		const cropSnap = await page.evaluate(() => {
			PREFERENCES.set('snappingEnabled', true);
			editor.canvasBounds.setRect({ x: 30, y: 30, width: 100, height: 80 });
			const box = editor.previewWrapper.getBoundingClientRect();
			const zoom = editor.viewport.currentZoom;
			const start = { x: box.left + 80 * zoom, y: box.top + 70 * zoom };
			const end = { x: box.left + 159 * zoom, y: box.top + 119 * zoom };
			editor.cropEdit.press({ clientX: start.x, clientY: start.y, pointerType: 'mouse' });
			editor.cropEdit.move({ clientX: end.x, clientY: end.y, pointerType: 'mouse' });
			const rect = { ...editor.canvasBounds.rect };
			editor.cropEdit.release();
			editor.canvasBounds.setRect({ x: 30, y: 30, width: 100, height: 80 });
			editor.cropEdit.press({ clientX: start.x, clientY: start.y, pointerType: 'mouse' });
			editor.cropEdit.move(Object.assign(Object.create({ ctrlKey: true }), { clientX: end.x, clientY: end.y, pointerType: 'mouse' }));
			const bypassed = { ...editor.canvasBounds.rect };
			editor.cropEdit.release();
			editor.canvasBounds.setRect({ x: 0, y: 0, width: 320, height: 240 });
			return { rect, bypassed };
		});
		assert.deepStrictEqual(cropSnap.rect, { x: 110, y: 80, width: 100, height: 80 }, 'crop center did not snap to canvas center');
		assert.deepStrictEqual(cropSnap.bypassed, { x: 109, y: 79, width: 100, height: 80 }, 'Ctrl did not bypass crop snapping');
		await page.locator('#canvasSizeWidth').fill('200');
		assert.strictEqual(await page.evaluate(() => editor.canvasBounds.rect.width), 200);
		await page.evaluate(() => document.activeElement.blur());
		await page.keyboard.press('Shift+ArrowRight');
		assert.strictEqual(await page.evaluate(() => editor.canvasBounds.rect.x), 70);
		const handle = await page.locator('.canvas-bounds-chrome [data-handle-type="corner-br"]').boundingBox();
		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 - 30, handle.y + handle.height / 2 - 20, { steps: 6 }); await page.mouse.up();
		assert(await page.evaluate(() => Number(document.getElementById('canvasSizeWidth').value) === editor.canvasBounds.rect.width && editor.canvasBounds.rect.width < 200), 'drag did not sync panel');
		await page.keyboard.press('Escape');
		assert(await page.evaluate(() => editor.currentTool === ToolType.CROP && !editor.canvasBounds && editor.originalCanvas.width === 320));
		assert(await page.evaluate(() => {
			const rect = editor.previewWrapper.getBoundingClientRect();
			editor.cropEdit.press({ clientX: rect.left + 40, clientY: rect.top + 40, pointerType: 'mouse' });
			editor.cropEdit.release();
			return Boolean(editor.canvasBounds) && getSessionDefinition(editor)?.id === 'crop';
		}), 'Crop could not restart after Escape preserved the tool');
		await page.evaluate(() => { editor.setTool(ToolType.CROP); editor.setDocumentSizeMode('image'); });
		assert(await page.evaluate(() => editor.currentTool === ToolType.SELECT && !editor.canvasBounds), 'Image mode left a crop session active');
		const paint = await page.evaluate(() => {
			const layer = editor.glitterManager.createLayer(); editor.layerManager.insertLayer(layer);
			const paint = editor.paintMaskStore.ensurePaintMask(layer.id);
			paint.add.getContext('2d').fillRect(40, 40, 10, 10); paint.hasContent = true; paint.liveRevision++;
			editor.paintMaskStore.commitPaintState(layer); editor.saveState('Paint fixture');
			return { id: layer.id, version: layer.maskVersion };
		});
		await page.evaluate(() => { editor.setTool(ToolType.CROP); editor.canvasBounds.setRect({ x: 20, y: 30, width: 200, height: 150 }); });
		const historyIndex = await page.evaluate(() => editor.historyManager.historyIndex);
		await page.keyboard.press('Enter');
		assert(await page.evaluate((index) => editor.historyManager.historyIndex === index + 1 && editor.originalCanvas.width === 200 && editor.currentTool === ToolType.SELECT, historyIndex));
		assert(await page.evaluate((id) => editor.layerManager.getLayerById(id).transform.position.x === 140, setup.id));
		await page.evaluate(() => editor.undo());
		assert(await page.evaluate(({ id, version }) => editor.originalCanvas.width === 320 && editor.originalCanvas.height === 240 && editor.layerManager.getLayerById(id).maskVersion === version && editor.originalImageData.data[0] === 0x12, paint));
		await page.evaluate(() => editor.redo());
		assert(await page.evaluate(() => editor.originalCanvas.width === 200 && editor.originalCanvas.height === 150));
		await page.evaluate(() => { editor.setTool(ToolType.CROP); editor.canvasBounds.setRect({ x: -10, y: -10, width: 220, height: 170 }); editor.canvasBounds.setExtension({ mode: 'color', color: '#ff0000' }); editor.applyCanvasBounds(); });
		assert(await page.evaluate(() => editor.originalImageData.data[0] === 255 && editor.originalImageData.data[1] === 0), 'extension pixels missing');
		assert.deepStrictEqual(errors, []);
		await context.close();

		const phone = await boot(browser, true);
		await phone.page.evaluate(() => { editor.setTool(ToolType.CROP); editor.mobileManager.closeDrawers?.(); });
		const client = await phone.context.newCDPSession(phone.page);
		const touch = (type, points) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((point, id) => ({ ...point, id, radiusX: 4, radiusY: 4, force: 1 })) });
		const center = await phone.page.evaluate(() => { const box = editor.previewWrapper.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; });
		const before = await phone.page.evaluate(() => ({ rect: { ...editor.canvasBounds.rect }, zoom: editor.viewport.currentZoom }));
		await touch('touchStart', [center]);
		for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: center.x + i * 4, y: center.y + i * 2 }]);
		await touch('touchEnd', []);
		assert(await phone.page.evaluate((rect) => editor.canvasBounds.rect.x !== rect.x, before.rect), 'touch crop did not move');
		const pending = await phone.page.evaluate(() => ({ ...editor.canvasBounds.rect }));
		await touch('touchStart', [{ x: center.x - 35, y: center.y }, { x: center.x + 35, y: center.y }]);
		for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: center.x - 35 - i * 5, y: center.y }, { x: center.x + 35 + i * 5, y: center.y }]);
		await touch('touchEnd', []);
		assert(await phone.page.evaluate((zoom) => editor.viewport.currentZoom > zoom, before.zoom), 'crop pinch did not zoom viewport');
		assert.deepStrictEqual(await phone.page.evaluate(() => ({ ...editor.canvasBounds.rect })), pending, 'pinch changed pending crop');
		assert(await phone.page.locator('#contextCropDone').isVisible());
		await phone.page.locator('#contextCropCancel').click();
		assert(await phone.page.evaluate(() => !editor.canvasBounds && editor.currentTool === ToolType.SELECT));
		assert.deepStrictEqual(phone.errors, []);
		await phone.context.close();
		console.log('PASS bounded context/move parity; crop panel, handles, keys, apply/undo/redo, extension and phone drag/pinch/actions');
	} finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
