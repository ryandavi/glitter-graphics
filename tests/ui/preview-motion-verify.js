'use strict';

const assert = require('assert/strict');
const { chromium } = require('playwright');
const { exportSnapshot, assertByteIdentity } = require('../parity/export-harness');

async function main() {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/', { waitUntil: 'networkidle' });
		await page.evaluate(async () => {
			const editor = window.editor;
			await editor.loadBlankImage(96, 96, '#ffffff');
			const buffer = new Uint8Array(1024);
			const writer = new GifWriter(buffer, 2, 2, { loop: 0, palette: [0xff0000, 0x0000ff] });
			writer.addFrame(0, 0, 2, 2, new Uint8Array([0, 0, 0, 0]), { delay: 10 });
			writer.addFrame(0, 0, 2, 2, new Uint8Array([1, 1, 1, 1]), { delay: 10 });
			const url = `data:image/gif;base64,${btoa(String.fromCharCode(...buffer.subarray(0, writer.end())))}`;
			const asset = await editor.glitterLibrary.ensureAssetDetails(getSlotDefaults(LayerType.SHAPE, 'fill').glitterId);
			Object.assign(asset, { url, width: 2, height: 2, frameCount: 2, frameDelay: 100 });
			window.motionFixture = { url, glitterId: asset.id };
			const shape = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x: 48, y: 48 } });
			for (const key of ['fill', 'border', 'shadow']) {
				const slot = ensureLayerPaintSlot(shape, key, () => getSlotDefaults(LayerType.SHAPE, key));
				Object.assign(slot, { mode: 'glitter', glitterId: asset.id });
				if (key === 'border') slot.widthPx = 4;
			}
			editor.layerManager.insertLayer(shape);
			Object.assign(editor.baseBackgroundManager.getBaseLayer().background, { mode: 'glitter', glitterId: asset.id });
			const sticker = editor.stickerManager.createLayer();
			Object.assign(sticker.stickerData, { isEmpty: false, isAnimated: true, url, baseUrl: url, width: 2, height: 2, frameCount: 2 });
			editor.layerManager.insertLayer(sticker);
			window.motionFixture.stickerId = sticker.id;
			editor.requestPreviewUpdate();
		});
		await page.waitForTimeout(400);
		assert(await page.evaluate(() => [...window.editor.canvasElementsContainer.querySelectorAll('*')].filter(node => node.style.backgroundImage.startsWith('url("data:image/gif')).length >= 4), 'Fixture paints start with animated GIF textures');
		const playing = await exportSnapshot(page, {}, { minLayers: 3 });
		await page.evaluate(() => window.editor.animationPanel.setPaused(true));
		await page.waitForFunction(() => {
			const editor = window.editor;
			const entry = editor.animationPanel.previewFrames.get(window.motionFixture.url);
			return entry?.url?.startsWith('data:image/png') && editor.stickerManager.layerElements.get(window.motionFixture.stickerId)?.querySelector('img').src === entry.url;
		});
		await page.waitForTimeout(100);
		const paused = await page.evaluate(async () => {
			const editor = window.editor;
			const url = editor.animationPanel.getPreviewImageUrl(window.motionFixture.url);
			const image = await loadImageElement(url);
			const canvas = createAppCanvas(2, 2, 'tests/preview-motion');
			canvas.getContext('2d').drawImage(image, 0, 0);
			const paintNodes = [...editor.canvasElementsContainer.querySelectorAll('*'), editor.baseBackgroundManager.backgroundElement?.firstElementChild].filter(Boolean);
			return {
				pixel: [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data],
				frozenPaints: paintNodes.filter(node => node.style.backgroundImage.startsWith('url("data:image/png')).length,
				playingPaints: paintNodes.filter(node => node.style.backgroundImage.startsWith('url("data:image/gif')).length,
				original: editor.layerManager.getLayerById(window.motionFixture.stickerId).stickerData.url
			};
		});
		assert.deepEqual(paused.pixel, [255, 0, 0, 255], 'Pause uses the actual first GIF frame');
		assert(paused.frozenPaints >= 4, `Fill, outline, shadow and canvas background freeze: ${JSON.stringify(paused)}`);
		assert.equal(paused.playingPaints, 0, 'No fixture texture keeps playing');
		assert.equal(paused.original, await page.evaluate(() => window.motionFixture.url), 'Preview freezing preserves authored sources');
		assertByteIdentity(playing, await exportSnapshot(page, {}, { minLayers: 3 }), 'Paused preview export');
		await page.evaluate(() => {
			const editor = window.editor;
			const sticker = editor.stickerManager.createLayer();
			Object.assign(sticker.stickerData, { isEmpty: false, isAnimated: true, url: window.motionFixture.url, baseUrl: window.motionFixture.url, width: 2, height: 2, frameCount: 2 });
			sticker.id = 'paused-sticker';
			editor.layerManager.insertLayer(sticker);
			const frame = editor.frameLayerManager.createLayer();
			frame.frameData.kind = 'image';
			frame.frameData.image = { url: window.motionFixture.url, width: 2, height: 2, isAnimated: true };
			editor.layerManager.insertLayer(frame);
			editor.requestPreviewUpdate();
		});
		await page.waitForFunction(() => window.editor.stickerManager.layerElements.get('paused-sticker')?.querySelector('img').src.startsWith('data:image/png'));
		await page.waitForFunction(() => document.querySelector('.frame-layer-image')?.style.backgroundImage.startsWith('url("data:image/png'));
		await page.evaluate(() => window.editor.animationPanel.setPaused(false));
		await page.waitForFunction(() => [...window.editor.stickerManager.layerElements.values()].every(node => node.querySelector('img').src === window.motionFixture.url));
		assert.equal(await page.evaluate(() => window.editor.animationPanel.previewFrames.size), 0, 'Resume releases cached preview frames');
		assert(await page.evaluate(() => [...window.editor.canvasElementsContainer.querySelectorAll('*')].filter(node => node.style.backgroundImage.startsWith('url("data:image/gif')).length >= 4), 'Resume restores animated paint textures');
		await page.evaluate(() => { window.editor.animationPanel.setPaused(true); window.editor.animationPanel.setPaused(false); });
		await page.waitForTimeout(200);
		assert.equal(await page.evaluate(() => window.editor.stickerManager.layerElements.get('paused-sticker').querySelector('img').src), await page.evaluate(() => window.motionFixture.url), 'A quick resume cannot receive a stale frozen image');
		console.log('PASS paused textures, stickers, first-frame pixels, new layers, resume and unchanged animated exports');
	} finally {
		await browser.close();
	}
}

main().catch(error => { console.error(error); process.exitCode = 1; });
