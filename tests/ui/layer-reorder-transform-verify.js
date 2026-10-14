'use strict';

const { chromium } = require('playwright');

const fs = require('fs');

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
	const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true });
	const page = await context.newPage();

	if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', route => route.fulfill({ body: fs.readFileSync(process.env.GLITTER_TEST_CSS), contentType: 'text/css' }));
	page.on('console', (message) => {
		if (message.type() === 'error') {
			console.error(message.text());
		}
	});

	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor != null, null, { timeout: 15000 });
	await loadBlankCanvas(page);
	await createStickerLayer(page, 'Reorder Target Sticker');
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
		editor.layerManager.moveLayers([activeLayer.id], { targetId: editor.layers[0].id, place: 'above' });
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
	const row = index => page.locator('#layersList > .layer-item').nth(index);
	const line = page.locator('#layersList > .list-insertion-line');
	const draggedId = await row(3).getAttribute('data-layer-id');
	const upperRect = await row(0).boundingBox(), lowerRect = await row(1).boundingBox();
	const startPoint = await row(3).locator('.list-row-text').boundingBox();
	await page.mouse.move(startPoint.x + 10, startPoint.y + startPoint.height / 2);
	await page.mouse.down();
	const over = async y => {
		await page.mouse.move(upperRect.x + 80, y);
		return line.evaluate(node => parseFloat(node.style.top));
	};
	const visible = () => line.evaluate(node => node.classList.contains('visible'));
	const belowUpper = await over(upperRect.y + upperRect.height - 1);
	const aboveLower = await over(lowerRect.y + 1);
	assert(await visible(), 'Expected a line between two target rows');
	assert(Math.abs(belowUpper - aboveLower) < 0.01, 'The same gap has two insertion line positions');
	assert(Math.abs(await over((upperRect.y + upperRect.height + lowerRect.y) / 2) - aboveLower) < 0.01, 'Dragging over the gap must preserve its insertion position');
	await over(upperRect.y + 1);
	assert(await visible(), 'Expected a line above the top layer');
	assert(await line.evaluate(node => node.getBoundingClientRect().top >= node.parentElement.getBoundingClientRect().top), 'Top insertion line is clipped');
	await over(upperRect.y);
	assert(await visible(), 'Container top edge must allow dropping above the top layer');
	const draggedRect = await row(3).boundingBox();
	await over(draggedRect.y + 1);
	assert(!await visible(), 'Dragging over itself must clear the previous drop');
	await over(upperRect.y + upperRect.height - 1);
	const noOp = await row(2).boundingBox();
	await over(noOp.y + noOp.height - 1);
	assert(!await visible(), 'A no-op drop must clear the previous drop');
	const base = await row(4).boundingBox();
	assert(await page.evaluate(() => editor.layers[0].locked), 'Expected the bottom layer to be locked');
	await over(base.y + base.height - 1);
	assert(!await visible(), 'Dropping below a locked bottom layer must be invalid');
	await page.evaluate(() => { const container = editor.layerManager.layersListContainer; container.style.flex = 'none'; container.style.height = '100px'; container.scrollTop = 25; });
	const scrolledUpper = await row(0).boundingBox(), scrolledLower = await row(1).boundingBox();
	const scrolledPosition = await over(scrolledUpper.y + scrolledUpper.height - 1);
	assert(Math.abs(scrolledPosition - belowUpper) < 0.01, 'Scrolling must preserve the insertion position in list coordinates');
	assert(Math.abs(await over(scrolledLower.y + 1) - scrolledPosition) < 0.01, 'Scrolled gap has two insertion line positions');
	await page.evaluate(() => { editor.layerManager.layersListContainer.scrollTop = 0; });
	const top = await row(0).boundingBox();
	await over(top.y + 1); await page.mouse.up();
	assert(await page.evaluate(id => editor.layers.at(-1).id === id, draggedId), 'Drop above the top layer must move the layer to the top');

	await page.evaluate(() => {
		const manager = editor.layerManager;
		const check = (condition, message) => { if (!condition) throw new Error(message); };
		const before = manager.layers.map(layer => layer.id), history = editor.historyManager.historyIndex;
		const ids = [before[1], before[2]];
		manager.setSelection(ids);
		const drop = { targetId: before.at(-1), place: 'above' };
		check(manager.canDropLayers(ids, drop), 'Multi-layer preview should allow the move');
		check(manager.layers.map(layer => layer.id).join() === before.join(), 'Preview must not mutate the stack');
		check(manager.moveLayers(ids, drop), 'Multi-layer move should succeed');
		check(manager.layers.slice(-2).map(layer => layer.id).join() === ids.join(), 'Multi-layer move must retain relative order');
		check(ids.every(id => manager.isLayerSelected(id)), 'Multi-layer move must retain selection');
		check(editor.historyManager.historyIndex === history + 1, 'Multi-layer move must save exactly once');
		const moved = manager.layers.map(layer => layer.id).join(), index = editor.historyManager.historyIndex;
		const invalid = { targetId: manager.layers[0].id, place: 'below' };
		check(!manager.canDropLayers(ids, invalid) && !manager.moveLayers(ids, invalid), 'Locked bottom must reject preview and move');
		check(!manager.moveLayers([manager.layers[0].id], drop), 'Locked bottom layer must not move');
		check(!manager.moveLayers(ids, { targetId: ids[0], place: 'above' }), 'Self drop must be refused');
		check(!manager.moveLayers(ids, { targetId: manager.layers.at(-3).id, place: 'above' }), 'No-op must be refused');
		check(manager.layers.map(layer => layer.id).join() === moved && editor.historyManager.historyIndex === index, 'Refused moves must change neither stack nor history');
	});
	await page.evaluate(() => {
		const manager = editor.layerManager;
		manager.layersListContainer.style.removeProperty('height');
		manager.layersListContainer.style.removeProperty('flex');
		manager.setSelection([manager.layers[1].id]);
	});
	const touchId = await row(3).getAttribute('data-layer-id');
	await row(3).focus();
	const grip = await row(3).locator('.list-row-handle').boundingBox();
	const touchTarget = await row(0).boundingBox();
	const cdp = await context.newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }] });
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchTarget.x + 80, y: touchTarget.y + 1 }] });
	assert(await visible(), 'Touch handle drag must show the insertion line');
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	assert(await page.evaluate(id => editor.layers.at(-1).id === id, touchId), 'Touch handle drag must reorder');

	const beforeCancel = await page.evaluate(() => ({ ids: editor.layers.map(layer => layer.id), history: editor.historyManager.historyIndex }));
	const cancelPoint = await row(2).locator('.list-row-text').boundingBox();
	await page.mouse.move(cancelPoint.x + 10, cancelPoint.y + cancelPoint.height / 2); await page.mouse.down();
	await over((await row(0).boundingBox()).y + 1);
	await page.keyboard.press('Escape'); await page.mouse.up();
	assert(!await visible() && await page.evaluate(() => !isReordering(editor.layerManager.layersListContainer)), 'Escape must clear the reorder gesture');
	assert(JSON.stringify(await page.evaluate(() => ({ ids: editor.layers.map(layer => layer.id), history: editor.historyManager.historyIndex }))) === JSON.stringify(beforeCancel), 'Cancelled reorder must change neither stack nor history');

	await page.evaluate(() => {
		const layer = editor.layers[1]; editor.layerManager.setSelection([layer.id]);
		editor.animationPanel.addAnimation(layer, 'pulse'); editor.animationPanel.addAnimation(layer, 'rotate');
		const section = document.getElementById('stickerAnimationSection');
		if (editor.pickers.flyout !== section.dataset.flyoutKey) editor.pickers.toggleFlyout(section.dataset.flyoutKey);
		setPanelCardCollapsed(section, false);
	});
	const motion = page.locator('#stickerAnimStack > .animation-stack-item');
	const motionStart = await motion.nth(0).locator('.list-row-content').boundingBox();
	const motionTarget = await motion.nth(1).boundingBox();
	const motionHistory = await page.evaluate(() => editor.historyManager.historyIndex);
	await page.mouse.move(motionStart.x + 15, motionStart.y + motionStart.height / 2); await page.mouse.down();
	await page.mouse.move(motionTarget.x + 30, motionTarget.y + motionTarget.height - 1); await page.mouse.up();
	assert(await page.evaluate(index => { const layer = editor.layerManager.getActiveLayer(); return layer.animations[0].type === 'rotate' && layer.animations[1].type === 'pulse' && editor.animationPanel.selectedMotionIndex(layer) === 1 && editor.historyManager.historyIndex === index + 1; }, motionHistory), 'Motion stack pointer drag must reorder, retain the moved selection and save once');
	await motion.nth(1).locator('.list-row-content').focus();
	await motion.nth(1).locator('.list-row-handle').focus(); await page.keyboard.press('ArrowUp');
	assert(await page.evaluate(() => editor.layerManager.getActiveLayer().animations[0].type === 'pulse'), 'Motion handle ArrowUp must use the shared reorder');
	await browser.close();
	console.log('layer-reorder-transform-verify: passed');
})();

