'use strict';

const { openApp } = require('../lib/app');
const path = require('path');

const fs = require('fs');

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

async function verifyReorderControls(page) {
	const sourceRoot = path.join(__dirname, '..', '..', 'js');
	const sources = fs.readdirSync(sourceRoot, { recursive: true }).filter(file => file.endsWith('.js') && !file.startsWith('dist') && !file.startsWith('vendor'));
	const references = new Set();
	for (const file of sources) {
		const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
		if (!['list-reorder.js', 'layer-row.js'].includes(path.basename(file)) && !source.includes('bindPointerDrag(')) continue;
		for (const match of source.matchAll(/CONFIG(?:\.[A-Za-z_$][\w$]*)+/g)) references.add(match[0]);
	}
	const missing = await page.evaluate(references => references.filter(reference => {
		let value = CONFIG;
		for (const key of reference.split('.').slice(1)) value = value?.[key];
		return value === undefined;
	}), [...references]);
	assert(!missing.length, `Undefined drag CONFIG keys: ${missing.join(', ')}`);
	assert(await page.evaluate(() => CONFIG.ui.gestures.dragThresholdPx > 0), 'Drag threshold must allow clicks');
	for (const label of ['One', 'Two', 'Three', 'Four', 'Five', 'Six']) await createStickerLayer(page, label);
	await page.evaluate(async () => {
		await editor.ensureTimelineDock(); PREFERENCES.set('timelineOpen', true); PREFERENCES.set('timelineHeight', 450);
		await editor.updateExportDuration();
	});
	await page.waitForFunction(() => editor.timelineDock?.model?.groups.length === 7 && !editor.timelineDock.stale);
	const selection = () => page.evaluate(() => [...editor.layerManager.selectedLayerIds]);
	const drag = async (container, rows, from, target, place, during) => {
		const start = await rows.nth(from).locator('.list-row-text, .list-row-content').first().boundingBox(), end = await rows.nth(target).boundingBox();
		assert(start && end, 'Row bodies and targets must have layout boxes');
		await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
		await page.mouse.move(end.x + 70, place === 'above' ? end.y + 1 : end.y + end.height - 1);
		await page.waitForTimeout(250);
		const geometry = await container.locator(':scope > .list-insertion-line').evaluate(node => ({ opacity: getComputedStyle(node).opacity, line: node.getBoundingClientRect().toJSON(), list: node.parentElement.getBoundingClientRect().toJSON(), classes: node.className }));
		assert(await container.locator(':scope > .list-insertion-line').evaluate(node => {
			const rect = node.getBoundingClientRect(), parent = node.parentElement.getBoundingClientRect();
			return getComputedStyle(node).opacity === '1' && rect.width > 0 && rect.height > 0 && rect.top >= parent.top && rect.bottom <= parent.bottom;
		}), `Insertion line must have opacity 1 and a non-zero rectangle inside its list: ${JSON.stringify(geometry)}`);
		if (during) await during();
		await page.mouse.up();
		assert(await page.evaluate(() => window.getSelection().toString() === '' && !document.documentElement.classList.contains('is-reordering')), 'Text selection and reorder state must clear after dragging');
		await page.evaluate(async () => { await editor.updateExportDuration(); editor.timelineDock.resync(); });
		await page.waitForTimeout(200);
	};
	for (const selector of ['#layersList', '.timeline-body']) {
		const timeline = selector !== '#layersList', container = page.locator(selector);
		const rows = container.locator(timeline ? ':scope > .timeline-group' : ':scope > .layer-item');
		const name = index => rows.nth(index).locator('.layer-name').first();
		const id = index => rows.nth(index).getAttribute('data-layer-id');
		await page.evaluate(() => { editor.timelineDock.body.scrollTop = 0; });
		await page.waitForTimeout(200);
		await name(0).click(); assert((await selection()).join() === await id(0), `${selector}: plain click selects (${(await selection()).join()}; target ${await id(0)})`);
		await name(1).click({ modifiers: ['Control'] }); assert((await selection()).length === 2, `${selector}: Ctrl+click adds selection`);
		await name(3).click({ modifiers: ['Shift'] }); assert((await selection()).length >= 3 && (await selection()).includes(await id(3)), `${selector}: Shift+click selects a range (${(await selection()).join()}; target ${await id(3)})`);
		await name(4).click(); await page.mouse.move(5, 5); await page.evaluate(() => document.activeElement?.blur());
		const measure = () => rows.nth(1).evaluate(node => {
			const row = node.matches('.timeline-group') ? node.querySelector('.layer-item') : node;
			return { width: row.scrollWidth, left: row.querySelector('.layer-name').getBoundingClientRect().left, gutter: row.querySelector('.list-row-handle').getBoundingClientRect().width };
		});
		const before = await measure(); await name(1).hover(); const after = await measure();
		assert(JSON.stringify(before) === JSON.stringify(after) && before.gutter === 0, `${selector}: desktop handles have no gutter, even on hover`);
		const control = await rows.nth(1).locator('.lock').boundingBox(), controlTarget = await rows.nth(0).boundingBox();
		await page.mouse.move(control.x + control.width / 2, control.y + control.height / 2); await page.mouse.down();
		await page.mouse.move(controlTarget.x + 80, controlTarget.y + 1);
		assert(!await container.evaluate(node => isReordering(node)), `${selector}: buttons cannot start row dragging`);
		await page.mouse.up();
		await name(1).dblclick();
		const input = rows.nth(1).locator('.layer-name-input'), inputBox = await input.boundingBox();
		await page.mouse.move(inputBox.x + 8, inputBox.y + inputBox.height / 2); await page.mouse.down();
		await page.mouse.move(controlTarget.x + 80, controlTarget.y + 1);
		assert(!await container.evaluate(node => isReordering(node)), `${selector}: inputs cannot start row dragging`);
		await page.mouse.up(); await page.keyboard.press('Escape');
		await name(1).click(); await name(2).click({ modifiers: ['Control'] }); await name(3).click({ modifiers: ['Control'] });
		const selected = await selection(), original = await page.evaluate(() => editor.layers.map(layer => layer.id));
		await name(2).evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); window.getSelection().addRange(range); });
		await drag(container, rows, 2, 0, 'above', async () => {
			const marked = await rows.evaluateAll(nodes => nodes.filter(node => node.classList.contains('is-dragging')).map(node => node.dataset.layerId));
			assert(marked.length === 3 && selected.every(id => marked.includes(id)), `${selector}: exactly the selected rows must dim`);
			assert(await name(2).evaluate(node => getComputedStyle(node).userSelect === 'none'), 'Layer names must block text selection during dragging');
			assert(await page.evaluate(() => window.getSelection().toString() === ''), 'Drag start must clear text selection');
		});
		const order = await page.evaluate(() => editor.layers.map(layer => layer.id));
		assert(order.slice(-3).join() === original.filter(id => selected.includes(id)).join(), `${selector}: selected handle must move all three in order`);
		const unselected = await id(3), singleBefore = await page.evaluate(() => editor.layers.map(layer => layer.id));
		await drag(container, rows, 3, 0, 'above', async () => {
			assert(await rows.evaluateAll(nodes => nodes.filter(node => node.classList.contains('is-dragging')).length) === 1, 'An unselected row must drag alone');
		});
		const singleAfter = await page.evaluate(() => editor.layers.map(layer => layer.id));
		assert(singleAfter.at(-1) === unselected && singleBefore.filter(id => id !== unselected).join() === singleAfter.filter(id => id !== unselected).join(), 'Unselected drag must move only its own layer');
		// The protected base is the last row; the last movable slot is above it.
		await page.evaluate(() => editor.layerManager.setSelection([editor.layers.at(-1).id]));
		await drag(container, rows, 0, 5, 'below');
		const keyboardId = await id(1);
		await page.evaluate(id => editor.layerManager.setSelection([id]), keyboardId);
		await (timeline ? rows.nth(1).locator('.timeline-group-label') : rows.nth(1)).focus();
		await page.keyboard.press('Alt+ArrowUp');
		await page.evaluate(async () => { await editor.updateExportDuration(); });
		assert(await id(0) === keyboardId, `${selector}: focused row Alt+ArrowUp reorders`);
		await page.keyboard.press('Alt+ArrowDown');
		await page.evaluate(async () => { await editor.updateExportDuration(); });
		assert(await id(1) === keyboardId, `${selector}: focused row Alt+ArrowDown reorders`);
		if (timeline) {
			assert(await rows.nth(0).locator('.timeline-group-chevron').evaluate(node => node.disabled && node.getAttribute('aria-disabled') === 'true' && !node.hasAttribute('aria-expanded') && !node.closest('.timeline-group').classList.contains('is-collapsed')), 'Empty groups must have disabled chevrons and no collapsed state');
			await rows.nth(0).evaluate(node => { window.reusedGroup = node; });
			await page.evaluate(async () => { const layer = editor.layerManager.getLayerById(reusedGroup.dataset.layerId); editor.animationPanel.addAnimation(layer); await editor.updateExportDuration(); });
			assert(await page.evaluate(() => reusedGroup.isConnected && !reusedGroup.querySelector('.timeline-group-chevron').disabled), 'Adding a motion must re-enable the existing group chevron');
		}
	}
	await page.evaluate(() => {
		const layer = editor.layers[1]; editor.layerManager.setActiveLayer(layer.id);
		layer.animations = []; editor.animationPanel.load(layer);
		const section = document.getElementById('stickerAnimEnabled').closest('.animation-module');
		if (!section.querySelector('.animation-stack-card') || section.querySelectorAll('.property-object-card').length !== 1) throw new Error('Only the Animations object has a card');
		if (!section.classList.contains('is-empty') || document.getElementById('stickerAnimStackEmpty').hidden) throw new Error('Empty stack must show its empty state');
		const controls = [...section.querySelectorAll('[id]')];
		const movement = () => ['Amount', 'Angle', 'Distance', 'Radius', 'Turns', 'Duty', 'OpacityFloor'].map(suffix => document.getElementById(`stickerAnim${suffix}Row`).hidden).join();
		const emptyRows = movement(), toggle = document.getElementById('stickerAnimEnabled');
		for (const checked of [true, false, true]) { toggle.checked = checked; toggle.dispatchEvent(new Event('change', { bubbles: true })); }
		if (emptyRows !== movement() || !controls.every(node => node.isConnected)) throw new Error('Empty and enabled panels must keep the same controls and default row filtering');
		const times = document.getElementById('stickerAnimPlaysTimes'); times.checked = true; times.dispatchEvent(new Event('change', { bubbles: true }));
		if (document.getElementById('stickerAnimIterationsRow').hidden || !Number.isFinite(layer.animations[0].iterations)) throw new Error('Times must expose the finite play count');
		const forever = document.getElementById('stickerAnimPlaysForever'); forever.checked = true; forever.dispatchEvent(new Event('change', { bubbles: true }));
		if (!document.getElementById('stickerAnimIterationsRow').hidden || layer.animations[0].iterations !== Infinity) throw new Error('Forever must hide the count and store Infinity');
		// Four rows exercise all insertion slots independently of the Add limit.
		layer.animations = ['pulse', 'rotate', 'bounce', 'shake'].map(type => GlitterAnimation.normalizeAnimation({ id: editor.layerManager.generateLayerId(), type }));
		editor.animationPanel.load(layer);
		if (section.classList.contains('is-empty') || !document.getElementById('stickerAnimStackEmpty').hidden) throw new Error('Populated stack must show its settings');
		if (editor.pickers.flyout !== section.dataset.flyoutKey) editor.pickers.toggleFlyout(section.dataset.flyoutKey);
		setPanelCardCollapsed(section, false);
	});
	const stack = page.locator('#stickerAnimStack'), motions = stack.locator(':scope > .animation-stack-item');
	await motions.nth(2).locator('.list-row-content').click();
	assert(await page.evaluate(() => editor.animationPanel.selectedMotionIndex(editor.layerManager.getActiveLayer()) === 2), 'Plain motion click selects');
	await motions.nth(2).focus(); await page.keyboard.press('Alt+ArrowUp');
	assert(await page.evaluate(() => editor.layerManager.getActiveLayer().animations[1].type === 'bounce'), 'Focused motion row Alt+ArrowUp reorders');
	await page.keyboard.press('Alt+ArrowDown');
	await drag(stack, motions, 2, 0, 'above');
	await drag(stack, motions, 0, 3, 'below');
	await page.evaluate(async () => { editor.pickers.closeActive(); await editor.updateExportDuration(); editor.timelineDock.resync(); const group = editor.timelineDock.body.querySelector(`[data-layer-id="${editor.layerManager.activeLayerId}"]`); editor.timelineDock.body.scrollTop = group.offsetTop; });
	await page.waitForTimeout(250);
	const motionLayerId = await page.evaluate(() => editor.layerManager.activeLayerId);
	const timelineStack = page.locator(`.timeline-group[data-layer-id="${motionLayerId}"] > .timeline-group-rows`);
	const timelineMotions = timelineStack.locator(':scope > .timeline-row[data-motion-index]');
	const alignedEyes = () => timelineStack.evaluate(node => Math.abs(node.parentElement.querySelector('.timeline-group-header .layer-visibility').getBoundingClientRect().left - node.querySelector('.timeline-motion-enabled').getBoundingClientRect().left) < 0.1);
	assert(await alignedEyes(), 'Narrow timeline motion eyes must align with the group eye');
	await timelineMotions.nth(2).focus(); await page.keyboard.press('Alt+ArrowUp');
	assert(await page.evaluate(() => editor.layerManager.getActiveLayer().animations[1].type === 'shake'), 'Timeline motion row Alt+ArrowUp reorders');
	await page.evaluate(async () => { await editor.updateExportDuration(); });
	await page.keyboard.press('Alt+ArrowDown');
	await drag(timelineStack, timelineMotions, 2, 0, 'above');
	await drag(timelineStack, timelineMotions, 0, 3, 'below');
	await page.setViewportSize({ width: 1600, height: 1100 }); await page.waitForTimeout(250);
	assert(await alignedEyes(), 'Wide timeline motion eyes must align with the group eye');
	await page.evaluate(() => { PREFERENCES.set('timelineOpen', false); editor.pickers.closeActive(); });
	assert(await page.evaluate(() => {
		const base = editor.layerManager.getBaseLayer(); editor.layerManager.setActiveLayer(base.id);
		base.background.mode = 'gradient'; editor.baseBackgroundManager.loadLayerSettings(base);
		const card = document.getElementById('baseBackgroundGradientCard');
		return card?.matches('.inset-surface.property-object-card') && card.querySelector('.property-object-title').textContent === 'Colors'
			&& !card.parentElement.hidden && card.querySelector('.gradient-preview') && card.querySelector('.gradient-actions')
			&& !card.querySelector('.effect-gradient-editor') && card.parentElement.nextElementSibling?.matches('.effect-gradient-editor')
			&& getComputedStyle(card.querySelector('.property-object-title')).fontSize === getComputedStyle(card.closest('.property-card').querySelector('.property-card-title')).fontSize;
	}), 'Gradient stops use the shared object card (preview, stops, actions, section-title typography), with Type/Blend/Angle after it');
	await page.setViewportSize(VIEWPORT); await page.waitForTimeout(250);
}

(async () => {
	const fine = await openApp({ viewport: VIEWPORT, document: { width: 320, height: 240 } });
	await verifyReorderControls(fine.page); await fine.browser.close();
	const { browser, context, page } = await openApp({ viewport: VIEWPORT, touch: true, document: { width: 320, height: 240 } });
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
	const beforeScroll = await over(lowerRect.y + lowerRect.height - 1);
	await page.evaluate(() => { const container = editor.layerManager.layersListContainer; container.style.flex = 'none'; container.style.height = '180px'; container.scrollTop = 25; });
	const scrolledUpper = await row(1).boundingBox(), scrolledLower = await row(2).boundingBox();
	const scrolledPosition = await over(scrolledUpper.y + scrolledUpper.height - 1);
	assert(Math.abs(scrolledPosition - beforeScroll) < 0.01, 'Scrolling must preserve the insertion position in list coordinates');
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
	assert(grip && grip.width > 0 && await row(3).locator('.list-row-handle').isVisible(), 'Coarse-pointer handles are visible');
	assert(await row(4).locator('.list-row-handle').evaluate(node => node.disabled && getComputedStyle(node).visibility === 'hidden' && node.getBoundingClientRect().width === 16), 'Locked touch handle hides while retaining its slot');
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
	await motion.nth(1).locator('.list-row-handle').focus(); await page.keyboard.press('ArrowUp');
	assert(await page.evaluate(() => editor.layerManager.getActiveLayer().animations[0].type === 'pulse'), 'Motion handle ArrowUp must use the shared reorder');
	await browser.close();
	console.log('layer-reorder-transform-verify: passed');
})();

