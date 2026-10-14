'use strict';

const assert = require('assert');
const { openApp } = require('../lib/app');

async function verify(touch) {
	const { browser, context, page, errors } = await openApp({
		viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 900 },
		touch,
		document: { width: 96, height: 96 }
	});
	try {
		await page.evaluate(() => {
			for (let i = 0; i < 3; i++) editor.layerManager.addLayer(LayerType.SHAPE);
			if (editor.mobileManager.isMobile) editor.mobileManager.openDrawer('layers');
			window.visibilityDragStarts = 0;
			document.getElementById('layersList').addEventListener('dragstart', () => window.visibilityDragStarts++);
		});
		await page.locator('#layersList .layer-visibility').first().waitFor({ state: 'visible' });
		await page.waitForTimeout(350);
		const client = touch ? await context.newCDPSession(page) : null;
		const move = async (point, type) => {
			if (touch) {
				await client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x: point.x, y: point.y }] });
			} else {
				await page.mouse.move(point.x, point.y);
				if (type === 'touchStart') await page.mouse.down();
				if (type === 'touchEnd') await page.mouse.up();
			}
		};
		for (const show of [false, true]) {
			const before = await page.evaluate(show => {
				const rows = [...document.querySelectorAll('#layersList .layer-item')];
				rows.forEach((row, i) => editor.layerManager.setLayerVisibility(row.dataset.layerId, show ? i === 0 : i !== 1));
				editor.saveState('Visibility fixture');
				return {
					points: rows.map(row => {
						const rect = row.querySelector('.layer-visibility').getBoundingClientRect();
						return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
					}),
					order: editor.layers.map(layer => layer.id),
					visible: editor.layers.map(layer => layer.visible),
					selected: [...editor.selectedLayerIds],
					history: editor.historyManager.historyIndex
				};
			}, show);
			const first = show ? before.points.length - 1 : 0;
			const last = show ? 0 : before.points.length - 1;
			await move(before.points[first], 'touchStart');
			await move(before.points[last], 'touchMove');
			await move(before.points[first], 'touchMove');
			await move(before.points[last], 'touchEnd');
			const after = await page.evaluate(() => ({
				order: editor.layers.map(layer => layer.id),
				visible: editor.layers.map(layer => layer.visible),
				selected: [...editor.selectedLayerIds],
				history: editor.historyManager.historyIndex,
				dragStarts: window.visibilityDragStarts,
				stroke: isLayerVisibilityStroking(editor.layerManager.layersListContainer),
				dragged: isReordering(editor.layerManager.layersListContainer),
				icons: [...document.querySelectorAll('#layersList .layer-visibility use')].map(icon => icon.getAttribute('href'))
			}));
			assert.deepStrictEqual(after.visible, before.visible.map(() => show), 'A mixed-state stroke sets every crossed eye to the first eye’s new state');
			assert.deepStrictEqual(after.order, before.order, 'Visibility must not reorder layers');
			assert.deepStrictEqual(after.selected, before.selected, 'Visibility must not change selection');
			assert.strictEqual(after.history, before.history + 1, 'A complete stroke is one history step');
			assert.strictEqual(after.dragStarts, 0, 'The eye must not start a native drag');
			assert.strictEqual(after.stroke, false);
			assert.strictEqual(after.dragged, false);
			assert(after.icons.every(icon => icon === (show ? '#icon-eye' : '#icon-eye-slash')));
			await page.evaluate(() => editor.historyManager.undo());
			assert.deepStrictEqual(await page.evaluate(() => editor.layers.map(layer => layer.visible)), before.visible, 'Undo restores mixed visibility');
			await page.evaluate(() => editor.historyManager.redo());
			assert.deepStrictEqual(await page.evaluate(() => editor.layers.map(layer => layer.visible)), after.visible);
		}
		if (!touch) {
			const eye = page.locator('#layersList .layer-visibility').first();
			const index = await page.evaluate(() => editor.historyManager.historyIndex);
			await eye.click();
			assert.strictEqual(await page.evaluate(() => editor.historyManager.historyIndex), index + 1, 'Click toggles once');
			await eye.focus();
			await page.keyboard.press('Enter');
			assert.strictEqual(await page.evaluate(() => editor.historyManager.historyIndex), index + 2, 'Keyboard activation still toggles once');
		} else {
			const box = await page.locator('#layersList .layer-visibility').first().boundingBox();
			await move({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, 'touchStart');
			await move({}, 'touchCancel');
			assert.strictEqual(await page.evaluate(() => isLayerVisibilityStroking(editor.layerManager.layersListContainer)), false, 'Cancellation releases the stroke');
		}
		if (!touch) {
			await page.evaluate(() => {
				editor.setTool(ToolType.SELECT);
				const layer = editor.layers.at(-1); layer.visible = true;
				getLayerFillSlot(layer).mode = 'solid';
				editor.shapeGlitterManager.renderLayer(layer);
				editor.layerManager.setActiveLayer(layer.id);
				window.menuLayerId = layer.id;
			});
			const row = page.locator(`#layersList .layer-item[data-layer-id="${await page.evaluate(() => window.menuLayerId)}"]`);
			const menu = page.locator('.app-menu-panel.is-fixed-menu:visible');
			const actions = () => menu.locator('.app-menu-item').evaluateAll(items => items.map(item => ({ label: item.textContent, disabled: item.disabled })));
			await row.click({ button: 'right' });
			const rowActions = await actions();
			assert.deepStrictEqual(rowActions, await page.evaluate(() => getLayerActions(editor, editor.layerManager.getLayerById(window.menuLayerId)).map(action => ({ label: action.label, disabled: Boolean(action.disabled) }))), 'Row menu reflects its shared actions');
			await page.keyboard.press('Escape');
			const point = await page.evaluate(() => {
				editor.layerManager.clearSelection();
				const rect = editor.previewWrapper.getBoundingClientRect();
				return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
			});
			await page.mouse.click(point.x, point.y, { button: 'right' });
			assert.strictEqual(await page.evaluate(() => editor.activeLayerId), await page.evaluate(() => window.menuLayerId), 'Canvas right-click first selects the picked layer');
			assert.deepStrictEqual(await actions(), rowActions, 'Canvas and Layers menus list the same enabled actions');
			const box = await menu.boundingBox();
			assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 900, 'Layer action menu fits the viewport');
			await page.keyboard.press('Escape');
			await row.focus(); await page.keyboard.press('Shift+F10');
			assert.deepStrictEqual(await actions(), rowActions, 'Shift+F10 opens the same row menu');
			await page.keyboard.press('Escape');
			await row.focus(); await page.keyboard.press('ContextMenu');
			assert.deepStrictEqual(await actions(), rowActions, 'ContextMenu opens the same row menu');
			await page.keyboard.press('Escape');
			await page.evaluate(() => editor.setTool(ToolType.ZOOM));
			await page.mouse.click(point.x, point.y, { button: 'right' });
			assert.strictEqual(await menu.count(), 0, 'Zoom right-click retains its tool behavior');
		}
		assert.deepStrictEqual(errors, []);
	} finally {
		await browser.close();
	}
}

(async () => {
	await verify(false);
	await verify(true);
	console.log('layer-visibility-verify: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
