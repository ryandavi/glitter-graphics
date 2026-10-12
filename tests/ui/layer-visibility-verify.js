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
				stroke: editor.layerManager.visibilityStroke,
				dragged: editor.layerManager.draggedLayerId,
				icons: [...document.querySelectorAll('#layersList .layer-visibility use')].map(icon => icon.getAttribute('href'))
			}));
			assert.deepStrictEqual(after.visible, before.visible.map(() => show), 'A mixed-state stroke sets every crossed eye to the first eye’s new state');
			assert.deepStrictEqual(after.order, before.order, 'Visibility must not reorder layers');
			assert.deepStrictEqual(after.selected, before.selected, 'Visibility must not change selection');
			assert.strictEqual(after.history, before.history + 1, 'A complete stroke is one history step');
			assert.strictEqual(after.dragStarts, 0, 'The eye must not start a native drag');
			assert.strictEqual(after.stroke, null);
			assert.strictEqual(after.dragged, null);
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
			assert.strictEqual(await page.evaluate(() => editor.layerManager.visibilityStroke), null, 'Cancellation releases the stroke');
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
