'use strict';

const assert = require('assert');
const { openApp } = require('../lib/app');

async function main() {
	const { browser, page, errors } = await openApp({ touch: true, document: { width: 320, height: 240 } });
	try {
		await page.evaluate(() => { window.canvasPoint = (x, y) => { const rect = editor.previewWrapper.getBoundingClientRect(); return { x: rect.left + x * editor.viewport.currentZoom, y: rect.top + y * editor.viewport.currentZoom }; }; });
		for (const zoom of [0.25, 1, 8]) for (const tool of ['shape', 'text', 'line']) for (const shift of [false, true]) {
			const result = await page.evaluate(async ({ zoom, tool, shift }) => {
				await editor.loadBlankImage(320, 240, '#ffffff'); editor.setTool(tool); editor.viewport.setZoom(zoom);
				const start = canvasPoint(50, 50), end = canvasPoint(90.4, 77.6);
				editor.beginCreationGesture(start.x, start.y);
				editor.updateCreationGesture(start.x + zoom, start.y + zoom);
				const belowThreshold = editor.creationGesture.chrome.element.hidden;
				editor.updateCreationGesture(end.x, end.y, shift);
				const badge = editor.creationGesture.chrome.badge.textContent;
				const visible = !editor.creationGesture.chrome.element.hidden;
				const layer = editor.finishCreationGesture(end.x, end.y, { shiftKey: shift });
				const frame = getLayerFrame(editor, layer);
				const points = layer.pathData?.subpaths[0].points;
				const expected = points ? `${Math.round(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y))} px · ${Math.round(normalizeRotationDeg(Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) * 180 / Math.PI))}°` : formatSizeBadge(frame.width, frame.height);
				return { belowThreshold, visible, badge, expected, removed: !document.querySelector('.creation-chrome') };
			}, { zoom, tool, shift });
			assert(result.belowThreshold && result.visible && result.removed, `${tool} chrome lifecycle at ${zoom}`);
			assert.strictEqual(result.badge, result.expected, `${tool} badge matches committed size at ${zoom}, shift=${shift}`);
		}
		process.stdout.write('PASS Shape, Text and Line badges match committed geometry at 25%, 100%, 800%, with Shift and click threshold\n');
		await page.evaluate(async () => {
			await editor.loadBlankImage(320, 240, '#ffffff'); editor.viewport.setZoom(1); editor.setTool(ToolType.SELECT);
			const asset = editor.stickerLibrary.content.find(item => !item.isAnimated); await editor.stickerLibrary.ensureAssetDetails(asset.id);
			const sticker = editor.stickerManager.createLayer(asset.id); sticker.transform.position = { x: 160, y: 120 }; editor.layerManager.insertLayer(sticker);
			window.sourceLayer = sticker; window.sourceCalls = [];
			editor.openCreateTarget = (layer, target) => sourceCalls.push({ id: layer.id, target });
		});
		await page.waitForTimeout(100);
		for (const selected of [false, true]) {
			await page.evaluate(selected => { sourceCalls.length = 0; if (selected) editor.layerManager.setActiveLayer(sourceLayer.id); else editor.layerManager.clearSelection(); }, selected);
			const point = await page.evaluate(() => canvasPoint(160, 120));
			await page.mouse.dblclick(point.x, point.y);
			assert.deepStrictEqual(await page.evaluate(() => sourceCalls), [{ id: await page.evaluate(() => sourceLayer.id), target: 'asset' }]);
			assert.strictEqual(await page.evaluate(() => editor.layerManager.activeLayerId), await page.evaluate(() => sourceLayer.id));
		}
		const session = await page.context().newCDPSession(page);
		for (const selected of [false, true]) {
			await page.waitForTimeout(400);
			await page.evaluate(selected => { sourceCalls.length = 0; if (selected) editor.layerManager.setActiveLayer(sourceLayer.id); else editor.layerManager.clearSelection(); }, selected);
			const point = await page.evaluate(() => canvasPoint(160, 120));
			for (let index = 0; index < 2; index++) {
				await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1, radiusX: 5, radiusY: 5, force: 1 }] });
				await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
				await page.waitForTimeout(70);
			}
			assert((await page.evaluate(() => sourceCalls)).some(call => call.target === 'asset'), `Touch source dispatch, selected=${selected}`);
		}
		const guards = await page.evaluate(() => {
			const shape = editor.shapeGlitterManager.createLayer(); editor.layerManager.insertLayer(shape); sourceCalls.length = 0;
			editor.handleLayerDoubleClick(shape);
			const shapeOpens = sourceCalls.at(-1)?.target === 'asset';
			shape.locked = true; sourceCalls.length = 0; editor.handleLayerDoubleClick(shape); const lockedIgnored = !sourceCalls.length;
			shape.locked = false; editor.layerManager.setSelection([shape.id, sourceLayer.id]); editor.handleLayerDoubleClick(shape); const groupIgnored = !sourceCalls.length;
			return { shapeOpens, lockedIgnored, groupIgnored };
		});
		assert(Object.values(guards).every(Boolean), JSON.stringify(guards));
		process.stdout.write('PASS selected/unselected sticker mouse double-click and touch double-tap, Shape Library, locked and group guards\n');
		const pinnedFill = await page.evaluate(() => {
			const fill = editor.glitterManager.createLayer(); editor.layerManager.insertLayer(fill); sourceCalls.length = 0;
			editor.handleLayerDoubleClick(fill); return fill.locked && sourceCalls.at(-1)?.target === 'fill';
		});
		assert(pinnedFill, 'Position-locked fill still opens Fill');
		await page.evaluate(async () => {
			await editor.loadBlankImage(320, 240, '#ffffff'); editor.viewport.setZoom(1); editor.setTool(ToolType.SELECT);
			const path = editor.layerManager.addLayer(LayerType.PATH, { pathLayer: { subpaths: [{ closed: false, points: [{ x: 50, y: 70 }, { x: 170, y: 70 }] }] } });
			window.pathSourceId = path.id; window.pathSourceCalls = []; editor.pathEdit.begin = layer => pathSourceCalls.push(layer.id);
			editor.layerManager.setActiveLayer(path.id); editor.requestPreviewUpdate();
		});
		await page.waitForTimeout(100);
		const pathPoint = await page.evaluate(() => canvasPoint(110, 70)); await page.mouse.dblclick(pathPoint.x, pathPoint.y);
		assert((await page.evaluate(() => pathSourceCalls)).includes(await page.evaluate(() => pathSourceId)), 'Selected path chrome opens its points');
		process.stdout.write('PASS pinned Fill source and selected path point editor dispatch\n');
		await page.evaluate(async () => { await editor.loadBlankImage(320, 240, '#ffffff'); editor.viewport.setZoom(1); editor.setTool(ToolType.SHAPE); });
		const start = await page.evaluate(() => canvasPoint(80, 80));
		await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
		await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 70, y: start.y + 50, id: 1 }] });
		assert(await page.evaluate(() => !!editor.creationGesture && !editor.creationGesture.chrome.element.hidden), 'Touch creation has a badge');
		await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x + 70, y: start.y + 50, id: 1 }, { x: start.x + 110, y: start.y + 70, id: 2 }] });
		assert(await page.evaluate(() => !editor.creationGesture && !document.querySelector('.creation-chrome')), 'Second finger cancels creation chrome');
		await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		process.stdout.write('PASS touch creation badge and second-finger cancellation\n');
		assert.deepStrictEqual(errors, []);
	} finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
