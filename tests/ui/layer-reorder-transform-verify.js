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
		layer.transform.position.x = editor.previewCanvas.width / 2;
		layer.transform.position.y = editor.previewCanvas.height / 2;
		layer.transform.rotation = 0;
		layer.transform.scale.x = 100;
		layer.transform.scale.y = 100;

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

	await loadBlankCanvas(page);
	for (const label of ['Bottom', 'Middle', 'Upper', 'Top']) {
		await createStickerLayer(page, label);
	}
	await page.evaluate(() => {
		const manager = window.editor.layerManager;
		const container = manager.layersListContainer;
		const rows = [...container.querySelectorAll('.layer-item')];
		const line = container.querySelector('.layer-insertion-line');
		const dragged = rows[3];
		const dataTransfer = new DataTransfer();
		const check = (condition, message) => {
			if (!condition) throw new Error(message);
		};
		const over = (element, clientY) => {
			element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientY, dataTransfer }));
			return parseFloat(line.style.top);
		};
		dragged.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
		const upperRect = rows[0].getBoundingClientRect();
		const lowerRect = rows[1].getBoundingClientRect();
		const belowUpper = over(rows[0], upperRect.bottom - 1);
		const aboveLower = over(rows[1], lowerRect.top + 1);
		check(line.classList.contains('visible'), 'Expected a line between two target rows');
		check(Math.abs(belowUpper - aboveLower) < 0.01, 'The same gap has two insertion line positions');
		const gapPosition = over(container, (upperRect.bottom + lowerRect.top) / 2);
		check(Math.abs(gapPosition - aboveLower) < 0.01, 'Dragging over the gap must preserve its insertion position');
		over(rows[0], upperRect.top + 1);
		check(line.classList.contains('visible'), 'Expected a line above the top layer');
		check(line.getBoundingClientRect().top >= container.getBoundingClientRect().top, 'Top insertion line is clipped');
		over(container, upperRect.top);
		check(line.classList.contains('visible') && manager.dropInsertAbove, 'Container top edge must allow dropping above the top layer');
		over(dragged, dragged.getBoundingClientRect().top + 1);
		check(!line.classList.contains('visible') && !manager.dropTargetId, 'Dragging over itself must clear the previous drop');
		over(rows[0], upperRect.bottom - 1);
		over(rows[2], rows[2].getBoundingClientRect().bottom - 1);
		check(!line.classList.contains('visible') && !manager.dropTargetId, 'A no-op drop must clear the previous drop');
		const base = rows[4];
		check(manager.getLayerById(base.dataset.layerId).locked, 'Expected the bottom layer to be locked');
		over(base, base.getBoundingClientRect().bottom - 1);
		check(!line.classList.contains('visible') && !manager.dropTargetId, 'Dropping below a locked bottom layer must be invalid');

		container.style.flex = 'none';
		container.style.height = '100px';
		container.scrollTop = 25;
		const scrolledUpper = rows[0].getBoundingClientRect();
		const scrolledLower = rows[1].getBoundingClientRect();
		const scrolledPosition = over(rows[0], scrolledUpper.bottom - 1);
		check(Math.abs(scrolledPosition - belowUpper) < 0.01, 'Scrolling must preserve the insertion position in list coordinates');
		check(Math.abs(over(rows[1], scrolledLower.top + 1) - scrolledPosition) < 0.01, 'Scrolled gap has two insertion line positions');
		container.scrollTop = 0;
		over(rows[0], rows[0].getBoundingClientRect().top + 1);
		rows[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
		check(manager.layers[manager.layers.length - 1].id === dragged.dataset.layerId, 'Drop above the top layer must move the layer to the top');
		dragged.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
	});

	await browser.close();
	console.log('layer-reorder-transform-verify: passed');
})();

