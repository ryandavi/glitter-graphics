'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const VIEWPORT = { width: 1280, height: 900 };

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

async function dismissVisibleModals(page) {
	await page.evaluate(() => {
		document.querySelectorAll('.modal-overlay.visible').forEach((element) => {
			element.classList.remove('visible');
			element.style.display = 'none';
		});
	});
}

async function loadBlankCanvas(page) {
	await page.evaluate(async () => {
		await window.editor.loadBlankImage(320, 240, '#ffffff');
	});
	await page.waitForFunction(() => window.editor.originalImage != null);
	await dismissVisibleModals(page);
	await page.waitForTimeout(120);
}

async function createStickerLayer(page, label) {
	await page.evaluate(({ layerLabel }) => {
		const editor = window.editor;
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 96;
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = '#ff5c8a';
		ctx.fillRect(12, 12, 72, 72);

		const layer = editor.stickerManager.createLayer();
		layer.name = layerLabel;
		layer.stickerSourceId = 'layer-reorder-transform-verify';
		layer.stickerData.isEmpty = false;
		layer.stickerData.url = canvas.toDataURL('image/png');
		layer.stickerData.name = layerLabel;
		layer.stickerData.width = canvas.width;
		layer.stickerData.height = canvas.height;
		layer.stickerData.transform.position.x = editor.previewCanvas.width / 2;
		layer.stickerData.transform.position.y = editor.previewCanvas.height / 2;
		layer.stickerData.transform.rotation = 0;
		layer.stickerData.transform.scale.x = 100;
		layer.stickerData.transform.scale.y = 100;

		editor.layerManager.insertLayer(layer);
		editor.stickerManager.renderLayer(layer);
		editor.layerManager.renderLayersList();
		editor.updatePreview();
		editor.saveState();
		editor.layerManager.setActiveLayer(layer.id);
	}, { layerLabel: label });
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: VIEWPORT });
	const page = await context.newPage();

	page.on('console', (message) => {
		if (message.type() === 'error') {
			console.error(message.text());
		}
	});

	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor != null, null, { timeout: 15000 });
	await loadBlankCanvas(page);
	await createStickerLayer(page, 'Reorder Test Sticker');
	await page.waitForTimeout(120);

	const handlesBeforeReorder = await page.evaluate(() => {
		const editor = window.editor;
		return document.querySelectorAll(`.transform-handles[data-layer-id="${editor.layerManager.activeLayerId}"]`).length;
	});
	assert(handlesBeforeReorder === 1, `Expected a transform handle overlay before reorder, found ${handlesBeforeReorder}`);

	await page.evaluate(() => {
		const editor = window.editor;
		const activeLayer = editor.layerManager.getActiveLayer();
		const layers = editor.layerManager.layers;
		const activeIndex = layers.findIndex((layer) => layer.id === activeLayer.id);
		const targetLayer = layers.find((layer) => layer.id !== activeLayer.id);
		const [movedLayer] = layers.splice(activeIndex, 1);
		layers.splice(layers.indexOf(targetLayer), 0, movedLayer);
		editor.layerManager.reorderLayerItems();
		editor.layerManager.reorderLayers();
	});
	await page.waitForTimeout(120);

	const handlesAfterReorder = await page.evaluate(() => {
		const editor = window.editor;
		return document.querySelectorAll(`.transform-handles[data-layer-id="${editor.layerManager.activeLayerId}"]`).length;
	});
	assert(handlesAfterReorder === 1, `Expected transform handles to survive reordering, found ${handlesAfterReorder}`);

	await browser.close();
	console.log('layer-reorder-transform-verify: passed');
})();

