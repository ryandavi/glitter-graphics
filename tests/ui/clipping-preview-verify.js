'use strict';

const assert = require('assert');
const { chromium, webkit } = require('playwright');
const { openApp } = require('../lib/app');

async function touchDrag(page, browserName, from, to) {
	const session = browserName === 'Chromium' ? await page.context().newCDPSession(page) : null;
	const send = async (type, point) => {
		if (session) await session.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ ...point, id: 1, radiusX: 5, radiusY: 5, force: 1 }] });
		else await page.evaluate(({ type, point }) => {
			const preview = editor.viewport.gestureManager.previewContainer;
			// Synthetic WebKit pointers have no native capture; route subsequent
			// events to the same surface that captures a real touch.
			preview.setPointerCapture = () => {}; preview.releasePointerCapture = () => {};
			const target = type === 'touchStart' ? document.elementFromPoint(point.x, point.y) : preview;
			target.dispatchEvent(new PointerEvent({ touchStart: 'pointerdown', touchMove: 'pointermove', touchEnd: 'pointerup' }[type], { bubbles: true, pointerId: 91, pointerType: 'touch', isPrimary: true, buttons: type === 'touchEnd' ? 0 : 1, clientX: point.x, clientY: point.y }));
		}, { type, point });
	};
	await send('touchStart', from);
	for (let index = 1; index <= 8; index++) { await page.waitForTimeout(20); await send('touchMove', { x: from.x + (to.x - from.x) * index / 8, y: from.y + (to.y - from.y) * index / 8 }); }
	await send('touchEnd', to); await page.waitForTimeout(100);
}

async function main() {
	const browsers = [['Chromium', chromium], ...(process.argv.includes('--webkit') ? [['WebKit', webkit]] : [])];
	for (const [name, type] of browsers) {
		const browser = await type.launch({ headless: true });
		try {
			const { page, errors } = await openApp({ browser, touch: true, document: { width: 240, height: 180 } });
			await page.evaluate(async () => {
				editor.viewport.setZoom(1);
				const base = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 220, height: 160 }); base.shapeData.fill.mode = 'solid'; base.shapeData.fill.color = '#8080ff'; editor.layerManager.insertLayer(base);
				const asset = editor.stickerLibrary.content.find(item => item.isAnimated); await editor.stickerLibrary.ensureAssetDetails(asset.id);
				const sticker = editor.stickerManager.createLayer(asset.id); sticker.transform.position = { x: 70, y: 60 }; sticker.transform.scale = { x: 40 / sticker.stickerData.width * 100, y: 40 / sticker.stickerData.height * 100 }; sticker.clipped = true; editor.layerManager.insertLayer(sticker);
				const glitter = editor.glitterLibrary.content.find(item => item.isAnimated);
				const text = editor.textGlitterManager.createLayer({ text: 'GIF', position: { x: 170, y: 60 } }); text.textData.fontSize = 22; text.textData.fill.mode = 'glitter'; text.textData.fill.glitterId = glitter.id; text.clipped = true; editor.layerManager.insertLayer(text);
				const fill = editor.glitterManager.createLayer(); const mask = editor.paintMaskStore.ensurePaintMask(fill.id); mask.add.getContext('2d').fillRect(40, 115, 160, 35); mask.hasContent = true; mask.liveRevision++; fill.maskHasContent = true; fill.fill.mode = 'glitter'; fill.fill.glitterId = glitter.id; fill.clipped = true; editor.layerManager.insertLayer(fill);
				window.clipPreviewFixture = { base, sticker, text, fill };
				editor.setTool(ToolType.SELECT); editor.layerManager.clearSelection(); editor.requestPreviewUpdate();
			});
			await page.waitForFunction(() => editor.clipPreview?.entries.size === 3 && [...editor.clipPreview.entries.values()].every(entry => entry.url && !entry.pending));
			await page.evaluate(() => { window.retainedClipNodes = [...editor.clipPreview.entries.values()].map(entry => [entry.element, ...entry.element.querySelectorAll('img, .paint-slot')]); window.retainedMaskUrl = editor.clipPreview.entries.get(clipPreviewFixture.sticker.id).url; });
			const first = await page.locator('#previewWrapper').screenshot(); await page.waitForTimeout(350); const next = await page.locator('#previewWrapper').screenshot();
			assert(!first.equals(next), `${name}: masked sticker, fill and text GIFs keep playing`);
			const point = await page.evaluate(() => { const r = editor.previewWrapper.getBoundingClientRect(); return { x: r.left + 70, y: r.top + 60 }; });
			await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 16, point.y + 10, { steps: 8 }); await page.mouse.up();
			const beforeTouch = await page.evaluate(() => ({ ...clipPreviewFixture.sticker.transform.position }));
			assert(beforeTouch.x !== 70, `${name}: mouse drag inside clip reaches LayerTransform`);
			await page.evaluate(() => editor.layerManager.clearSelection()); await page.waitForTimeout(100);
			const start = await page.evaluate(() => { const r = editor.previewWrapper.getBoundingClientRect(), p = clipPreviewFixture.sticker.transform.position; return { x: r.left + p.x, y: r.top + p.y }; });
			await touchDrag(page, name, start, { x: start.x + 20, y: start.y + 12 });
			assert(await page.evaluate(x => clipPreviewFixture.sticker.transform.position.x !== x, beforeTouch.x), `${name}: touch drag inside clip reaches LayerTransform`);
			assert(await page.evaluate(() => editor.clipPreview.entries.get(clipPreviewFixture.sticker.id).url === retainedMaskUrl && retainedClipNodes.flat().every(node => node.isConnected)), `${name}: own drag retains mask and GIF nodes`);
			await page.evaluate(() => { editor.layerManager.setActiveLayer(clipPreviewFixture.base.id); editor.shapeGlitterManager.updateTransform(clipPreviewFixture.base.id, { position: { x: 130, y: 95 } }); editor.requestPreviewUpdate(); });
			await page.waitForFunction(() => editor.clipPreview.entries.get(clipPreviewFixture.sticker.id).url !== retainedMaskUrl && !editor.clipPreview.entries.get(clipPreviewFixture.sticker.id).pending);
			assert(await page.evaluate(() => retainedClipNodes.flat().every(node => node.isConnected)), `${name}: base move swaps decoded masks and retains content`);
			await page.evaluate(() => { const fill = clipPreviewFixture.fill; fill.fill.mode = 'solid'; fill.fill.color = '#ff8080'; fill.blendMode = 'multiply'; editor.setTool(ToolType.HAND); editor.requestPreviewUpdate(); });
			await page.waitForTimeout(100);
			const screenshot = (await page.locator('#previewWrapper').screenshot()).toString('base64');
			const pixel = await page.evaluate(async screenshot => { const image = new Image(); image.src = `data:image/png;base64,${screenshot}`; await image.decode(); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); return [...ctx.getImageData(120, 130, 1, 1).data]; }, screenshot);
			assert(pixel.slice(0, 3).every((channel, index) => Math.abs(channel - [128, 64, 128][index]) <= 2), `${name}: clipped Multiply against picture below: ${pixel}`);
			// A turned base and its clip share one rasterizer, so none of the
			// base's own color rings the clipped layer.
			await page.evaluate(async () => {
				await editor.loadBlankImage(240, 180, '#ffffff'); editor.viewport.setZoom(1); editor.animationTicker.setPaused(true);
				const base = editor.textGlitterManager.createLayer({ text: 'Halo', position: { x: 120, y: 90 } }); base.textData.fontSize = 70; base.textData.fill.mode = 'solid'; base.textData.fill.color = '#0033ff'; base.transform.rotation = -12; editor.layerManager.insertLayer(base);
				const content = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 236, height: 176, position: { x: 120, y: 90 } }); content.shapeData.fill.mode = 'solid'; content.shapeData.fill.color = '#ff2200'; content.clipped = true; editor.layerManager.insertLayer(content);
				editor.setTool(ToolType.HAND); editor.layerManager.clearSelection(); editor.requestPreviewUpdate();
			});
			await page.waitForFunction(() => editor.clipPreview.entries.size === 1 && [...editor.clipPreview.entries.values()].every(entry => entry.space && !entry.pending));
			await page.waitForTimeout(100);
			const turned = (await page.locator('#previewWrapper').screenshot()).toString('base64');
			const ring = await page.evaluate(async turned => { const image = new Image(); image.src = `data:image/png;base64,${turned}`; await image.decode(); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, c.width, c.height).data; let blue = 0, red = 0; for (let i = 0; i < data.length; i += 4) { if (data[i + 2] - data[i + 1] > 60) blue++; if (data[i] > 200 && data[i + 2] < 60) red++; } return { blue, red }; }, turned);
			assert(ring.blue === 0 && ring.red > 1000, `${name}: turned base shows no ring of its own color: ${JSON.stringify(ring)}`);
			// Replacing a base sticker redraws only that layer; the clip follows.
			const swapped = await page.evaluate(async () => {
				await editor.loadBlankImage(240, 180, '#ffffff');
				const assets = editor.stickerLibrary.content.filter(item => !item.isAnimated).slice(0, 8);
				const first = await editor.stickerLibrary.ensureAssetDetails(assets[0].id);
				const second = await editor.stickerLibrary.ensureAssetDetails(assets.find(item => item.id !== first.id && item.url !== first.url).id);
				const base = editor.stickerManager.createLayer(first.id); editor.layerManager.insertLayer(base);
				const content = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 236, height: 176 }); content.clipped = true; editor.layerManager.insertLayer(content);
				const settled = () => new Promise(resolve => { const check = () => { const entry = [...editor.clipPreview.entries.values()][0]; if (entry?.url && !entry.pending && entry.key === getClipContentKey(editor, entry.base)) resolve(entry.url); else setTimeout(check, 30); }; check(); });
				editor.requestPreviewUpdate(); const before = await settled();
				editor.layerManager.setActiveLayer(base.id); await editor.stickerManager.pickLibrarySticker(second.id);
				return await Promise.race([settled(), new Promise(resolve => setTimeout(() => resolve(before), 3000))]) !== before;
			});
			assert(swapped, `${name}: replacing a base sticker rebuilds its clip mask`);
			// The preview refreshes while a base is dragged; its handles survive.
			await page.evaluate(async () => {
				await editor.loadBlankImage(240, 180, '#ffffff'); editor.viewport.setZoom(1);
				const asset = editor.stickerLibrary.content.find(item => !item.isAnimated); await editor.stickerLibrary.ensureAssetDetails(asset.id);
				const base = editor.stickerManager.createLayer(asset.id); base.transform.position = { x: 120, y: 90 }; base.transform.scale = { x: 8000 / base.stickerData.width, y: 8000 / base.stickerData.height }; editor.layerManager.insertLayer(base);
				const content = editor.shapeGlitterManager.createLayer({ shapeId: 'circle', width: 150, height: 150, position: { x: 120, y: 90 } }); content.clipped = true; editor.layerManager.insertLayer(content);
				window.turnedBase = base; editor.setTool(ToolType.SELECT); editor.layerManager.setActiveLayer(base.id); editor.requestPreviewUpdate();
			});
			await page.waitForFunction(() => editor.clipPreview.entries.size === 1 && document.querySelector('[data-handle-type="rotation"]'));
			const knob = await page.evaluate(() => { const r = document.querySelector('[data-handle-type="rotation"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
			await page.mouse.move(knob.x, knob.y); await page.mouse.down(); await page.mouse.move(knob.x + 60, knob.y + 40, { steps: 8 }); await page.mouse.up();
			const angle = await page.evaluate(() => turnedBase.transform.rotation);
			assert(Math.abs(angle) > 30, `${name}: a base sticker rotates by its handle: ${angle}`);
			assert.deepStrictEqual(errors, []);
			process.stdout.write(`PASS ${name}: masked GIF continuity, Multiply, mouse/touch drag, retained nodes, decoded base-mask swaps, turned-base edges, base sticker replacement and base handle rotation${name === 'WebKit' ? ' (touch PointerEvent harness)' : ' (native CDP touch)'}\n`);
		} finally { await browser.close(); }
	}
}

main().catch(error => { console.error(error); process.exitCode = 1; });
