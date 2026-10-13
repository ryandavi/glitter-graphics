'use strict';

const assert = require('node:assert/strict');
const { openApp } = require('../lib/app');

async function main() {
	const { browser, page, errors } = await openApp({ viewport: { width: 1440, height: 900 } });
	try {
		await page.evaluate(async () => {
			editor.modalManager.closeAll({ force: true });
			// The global Reduce Motion duration also creates width transitions on
			// otherwise nontransitioning panels; exercise separator resizing without it.
			PREFERENCES.set('reduceMotion', false);
			PREFERENCES.set('showHints', false);
			await editor.loadBlankImage(500, 400, '#ffffff');
		});
		await page.waitForSelector('.inspector-panel');
		const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		const drag = async (key, distance) => {
			const box = await page.locator(`[data-panel-resize="${key}"]`).boundingBox();
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width / 2 + distance, box.y + box.height / 2, { steps: 15 });
			await page.mouse.up();
			await settle();
		};
		const frame = () => page.evaluate(() => {
			const viewport = editor.viewport;
			const centered = viewport.getCenteredPan();
			return { x: viewport.panX, y: viewport.panY, zoom: viewport.currentZoom, dx: viewport.panX - centered.panX, dy: viewport.panY - centered.panY };
		});
		for (const nearCenter of [true, false]) {
			await page.evaluate(near => {
				PREFERENCES.set('balanceSidebars', false);
				Object.keys(PANEL_RESIZE_TARGETS).forEach(resetPanelWidth);
				setPanelWidth('layers', 300);
				const viewport = editor.viewport;
				viewport.setZoom(1.5);
				const area = viewport.getUsableRect();
				Object.assign(viewport, viewport.getCenteredPan(area));
				viewport.panX += area.width * (near ? 0.03 : 0.08);
				viewport.panY += area.height * (near ? 0.03 : 0.2);
				viewport.applyTransform();
				viewport._notifyViewportChanged();
			}, nearCenter);
			await settle();
			const before = await frame();
			await drag('layers', 150);
			const after = await frame();
			assert.equal(after.zoom, before.zoom, 'Panel dragging must preserve zoom');
			if (nearCenter) {
				assert(Math.abs(after.dx) < 1 && Math.abs(after.dy) < 1, 'A near-centered canvas follows the usable area center');
			} else {
				assert.equal(after.x, before.x, 'A deliberately panned canvas must not snap when a shrinking area brings it near center');
				assert.equal(after.y, before.y, 'A deliberately panned vertical position stays put');
			}
		}
		await page.evaluate(() => PREFERENCES.set('balanceSidebars', true));
		await settle();
		await page.evaluate(() => editor.viewport.resetViewport());
		await settle();
		await drag('inspector', 40);
		assert.equal(await page.evaluate(() => PREFERENCES.get('balanceSidebars')), false, 'Dragging Inspector switches to independent widths');
		assert(Math.abs((await frame()).dx) < 1, 'Switching balance off during a drag retains centering');
		await page.locator('[data-panel-resize="layers"]').focus();
		await page.keyboard.press('Shift+ArrowRight');
		await settle();
		assert(Math.abs((await frame()).dx) < 1, 'Keyboard resizing retains centering');
		await page.waitForFunction(() => getPanelWidth('layers') === parseFloat(document.documentElement.style.getPropertyValue('--layer-panel-width')));
		for (const cancel of ['Escape', 'blur']) {
			const width = await page.evaluate(() => getPanelWidth('layers'));
			const handle = page.locator('[data-panel-resize="layers"]'), box = await handle.boundingBox();
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
			await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2);
			assert.notEqual(await page.evaluate(() => getPanelWidth('layers')), width, 'A separator changes width while pressed');
			if (cancel === 'Escape') await page.keyboard.press('Escape');
			else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
			await page.mouse.up(); await settle();
			assert.equal(await page.evaluate(() => getPanelWidth('layers')), width, `${cancel} restores a separator's original width`);
			assert.equal(await handle.evaluate(node => node.classList.contains('is-dragging')), false);
		}
		await page.locator('[data-panel-resize="layers"]').dblclick(); await settle();
		assert(await page.evaluate(() => !Object.hasOwn(readPanelWidths(), 'layers')), 'Double-click resets the stored separator width');

		await page.evaluate(() => {
			window.historyPlacementSamples = [];
			window.historyPlacementObserver = new ResizeObserver(() => {
				const mobile = innerWidth <= CONFIG.ui.mobile.breakpoint;
				window.historyPlacementSamples.push({ mobile, header: Boolean(document.getElementById('undoTool').closest('.app-header')) });
			});
			window.historyPlacementObserver.observe(document.body);
		});
		for (const width of [1030, 1050, 390, 1440, 1039, 1041]) {
			await page.setViewportSize({ width, height: 900 });
			await settle();
		}
		const placements = await page.evaluate(() => window.historyPlacementSamples);
		assert(placements.length >= 6, 'Observe both directions of the responsive transition');
		assert(placements.every(sample => sample.mobile === sample.header), 'Undo/Redo must reach their responsive home before the resize frame paints');
		assert.equal(await page.locator('#undoTool').count(), 1, 'Keep one Undo button and its existing listener');
		assert.equal(await page.locator('#redoTool').count(), 1, 'Keep one Redo button and its existing listener');
		assert.deepEqual(errors, []);
		console.log('PASS near-center drag, panned-position retention, unchanged zoom, balance handoff, keyboard resize and immediate responsive Undo/Redo placement');
	} finally {
		await browser.close();
	}
}

main().catch(error => { console.error(error); process.exit(1); });
