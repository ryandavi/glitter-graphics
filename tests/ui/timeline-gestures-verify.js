'use strict';

const assert = require('assert/strict');
const { openApp } = require('../lib/app');

async function verifyTimelineGestures(browser) {
	const { page, context, errors } = await openApp({ browser, viewport: { width: 1600, height: 900 }, document: { width: 200, height: 160 } });
	try {
		await page.evaluate(async () => {
			const layer = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x: 60, y: 80 } });
			getLayerFillSlot(layer).mode = 'solid';
			layer.animations = [GlitterAnimation.normalizeAnimation({ type: 'pulse', periodMs: 1000 })];
			editor.layerManager.insertLayer(layer);
			editor.shapeGlitterManager.renderLayer(layer);
			window.timelineFixtureId = layer.id;
			editor.setDocumentLoop({ mode: 'set', durationMs: 4800 }, { commit: false });
			editor.saveState('Timeline fixture');
			await editor.ensureTimelineDock();
			PREFERENCES.set('timelineSnap', true);
			PREFERENCES.set('timelineOpen', true);
			await editor.updateExportDuration();
		});
		const ready = () => page.waitForFunction(() => editor.timelineDock?.model?.groups.some(group => group.layerId === window.timelineFixtureId) && !editor.timelineDock.host.classList.contains('is-stale'));
		await ready();
		const state = () => page.evaluate(() => {
			const animation = editor.layerManager.getLayerById(window.timelineFixtureId).animations[0];
			return { delay: animation.delayMs, repeats: animation.iterations, phase: animation.phase, period: animation.periodMs, history: editor.historyManager.historyIndex, loop: editor.documentLoop.durationMs };
		});
		let liveDrag = false;
		let feedback = null;
		const drag = async (kind, time, { alt = false, cancel = false, delta = false, pointerCancel = false, grab = null } = {}) => {
			await ready();
			const points = await page.evaluate(({ kind, time, delta, grab }) => {
				const dock = editor.timelineDock;
				const node = dock.body.querySelector(`[data-layer-id="${window.timelineFixtureId}"] .timeline-row`);
				const track = (kind === 'loop' ? dock.rulerTrack : node.querySelector('.timeline-track')).getBoundingClientRect();
				const target = (kind === 'loop' ? dock.rulerTrack.querySelector('.timeline-loop-end') : node.querySelector(kind === 'body' ? '.timeline-bar' : kind === 'period' ? '.timeline-period-notch' : `.timeline-bar-handle.is-${kind}`)).getBoundingClientRect();
				const x = kind === 'body' && !grab ? target.left + Math.min(30, target.width / 2) : target.left + target.width / 2;
				return { x, y: target.top + target.height / 2, to: (delta ? x : track.left) + TimelineView.timeToX(time, dock.scale) };
			}, { kind, time, delta, grab });
			if (alt) await page.keyboard.down('Alt');
			await page.mouse.move(points.x, points.y);
			await page.mouse.down();
			await page.mouse.move(points.to, points.y, { steps: 4 });
			liveDrag = await page.evaluate(() => editor.timelineDock.frameView.canvas.hidden);
			feedback = await page.evaluate(() => {
				const dock = editor.timelineDock;
				return { guide: dock.snapGuide.hidden ? null : new DOMMatrix(dock.snapGuide.style.transform).e, text: dock.dragReadout?.textContent, cursor: getComputedStyle(dock.stage).cursor };
			});
			if (cancel) await page.keyboard.press('Escape');
			if (pointerCancel) await page.evaluate(() => editor.timelineDock.stage.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: editor.timelineDock.drag.pointerId })));
			await page.mouse.up();
			if (alt) await page.keyboard.up('Alt');
			await ready();
		};
		await page.evaluate(() => { editor.animationPanel.setPaused(true); editor.animationTicker.seek(700); });
		await page.waitForFunction(() => !editor.timelineDock.frameView.canvas.hidden);
		let before = await state();
		assert(await page.evaluate(() => editor.timelineDock.body.querySelector('.timeline-bar').classList.contains('is-movable')), 'A motion bar says its body moves');
		await drag('body', 600, { delta: true });
		let after = await state();
		assert(after.delay > 500 && after.delay < 700 && after.repeats === Infinity && after.phase === before.phase, 'Dragging a full-length bar moves it and keeps it running to the loop end');
		assert.equal(feedback.cursor, 'grabbing');
		assert(/^Starts at 0\.\d\d s \(was 0\.00 s\)/.test(feedback.text), `A move says where it starts and where it was: ${feedback.text}`);
		assert.equal(after.history, before.history + 1);
		await page.evaluate(() => editor.historyManager.undo());
		await ready();
		assert.equal((await state()).delay, 0);
		before = await state();
		await drag('right', 2040);
		assert(liveDrag, 'A timing drag exposes the live artwork instead of an older held frame');
		assert.equal(feedback.text, 'Repeats 2 (was forever) · whole cycle', 'The readout names the value, what it was and the snap');
		assert(Math.abs(feedback.guide - await page.evaluate(() => TimelineView.timeToX(2000, editor.timelineDock.scale) - editor.timelineDock.body.scrollLeft)) < 0.5, 'A snapped drag draws its guide at the snap');
		assert(await page.evaluate(() => editor.timelineDock.snapGuide.hidden && !editor.timelineDock.dragReadout), 'The guide and the readout leave with the drag');
		after = await state();
		assert.equal(after.repeats, 2, 'Right edge snaps to two cycles');
		assert.equal(after.history, before.history + 1, 'A multi-step drag commits once');
		await page.evaluate(() => editor.historyManager.undo());
		await ready();
		assert.equal((await state()).repeats, Infinity, 'One Undo restores the drag');
		await drag('right', 2040, { alt: true });
		assert.equal((await state()).repeats, 2.04, 'Alt bypasses snapping');
		assert.equal(feedback.guide, null, 'An unsnapped drag has no guide');
		before = await state();
		await drag('left', 600, { alt: true, cancel: true });
		assert.deepEqual(await state(), before, 'Escape restores values without history');
		await drag('left', 600, { alt: true });
		after = await state();
		assert(Math.abs(after.delay - 600) < 0.01);
		assert.equal(after.repeats, 1.44, 'Left edge keeps the finite end');
		before = await state();
		await drag('body', 300, { delta: true, alt: false });
		after = await state();
		assert(after.delay > before.delay && after.repeats === before.repeats, 'Body moves a trimmed bar without changing its length');
		before = await state();
		await drag('body', 500, { delta: true, alt: true, pointerCancel: true });
		assert.deepEqual(await state(), before, 'Pointer cancellation restores values without history');
		await drag('body', 500, { delta: true, alt: true });
		assert(Math.abs((await state()).phase - 0.5) < 0.0001, 'Alt-body drag slips by half a cycle');
		await page.locator('#timelineDock .timeline-bar').first().click();
		assert(await page.evaluate(() => editor.libraryWindow.flyoutCard?.id === 'shapeAnimationSection'), 'Clicking a motion opens its owning Animation section');
		const bar = page.locator('#timelineDock .timeline-bar').first();
		await bar.focus();
		before = await state();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		after = await state();
		assert(after.delay > before.delay);
		assert.equal(after.history, before.history + 1, 'A nudge burst coalesces');
		await ready();
		await bar.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Fill the loop', exact: true }).click();
		await ready();
		assert.equal((await state()).repeats, Infinity);
		await bar.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Reset timing', exact: true }).click();
		await ready();
		assert.equal((await state()).phase, 0, 'Reset timing restores the phase');
		await drag('period', 1200, { alt: true });
		assert.equal(Math.round((await state()).period), 1200, 'A cycle notch writes duration');
		await drag('loop', 3600, { alt: true });
		assert.equal((await state()).loop, 3600, 'Loop-end drag writes document duration');
		await page.locator('#timelineDock .timeline-loop-end').dblclick();
		await ready();
		assert.equal((await state()).loop, null, 'Double-click restores automatic duration');
		await page.evaluate(() => {
			const layer = editor.layerManager.getLayerById(window.timelineFixtureId);
			layer.locked = true;
			editor.timelineDock.resync();
		});
		before = await state();
		await page.locator('#timelineDock .timeline-bar').first().focus();
		await page.keyboard.press('ArrowRight');
		assert.deepEqual(await state(), before, 'Locked bars reject keyboard editing');
		assert(await page.evaluate(() => editor.timelineDock.body.querySelector(`[data-layer-id="${window.timelineFixtureId}"]`).classList.contains('is-locked')
			&& getComputedStyle(editor.timelineDock.body.querySelector('.timeline-bar')).cursor === 'not-allowed'), 'A locked layer marks its bars');
		await page.evaluate(() => { editor.notifications.errorText.textContent = ''; });
		await drag('body', 400, { delta: true });
		assert.deepEqual(await state(), before, 'Locked bars reject a drag');
		assert.equal(await page.evaluate(() => editor.notifications.errorText.textContent), 'Unlock this layer to edit it', 'A locked bar says why it will not move');
		await page.evaluate(() => editor.notifications.dismissError());
		await page.evaluate(async () => {
			const motion = editor.layerManager.getLayerById(window.timelineFixtureId);
			motion.locked = false;
			const buffer = new Uint8Array(1024);
			const writer = new GifWriter(buffer, 2, 2, { loop: 0, palette: [0xff0000, 0x0000ff] });
			writer.addFrame(0, 0, 2, 2, new Uint8Array(4), { delay: 50 });
			writer.addFrame(0, 0, 2, 2, new Uint8Array([1, 1, 1, 1]), { delay: 50 });
			const url = `data:image/gif;base64,${btoa(String.fromCharCode(...buffer.subarray(0, writer.end())))}`;
			const sticker = editor.stickerManager.createLayer();
			Object.assign(sticker.stickerData, { isEmpty: false, isAnimated: true, url, baseUrl: url, width: 2, height: 2, frameCount: 2 });
			editor.layerManager.insertLayer(sticker);
			window.timelineGifId = sticker.id;
			editor.setDocumentLoop({ mode: 'set', durationMs: 4800 });
			await editor.updateExportDuration();
		});
		await ready();
		const gifBar = page.locator('#timelineDock .timeline-group').filter({ has: page.locator('.timeline-bar.is-authored') }).locator('.timeline-bar');
		await gifBar.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Match cycle to...', exact: true }).click();
		await page.getByRole('menuitem', { name: /1\.20 s/ }).click();
		await ready();
		assert.equal(await page.evaluate(() => editor.layerManager.getLayerById(window.timelineGifId).stickerData.gifCycleMs), 1200, 'GIF menu matches another source cycle');
		await gifBar.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Reset speed', exact: true }).click();
		await ready();
		assert.equal(await page.evaluate(() => editor.layerManager.getLayerById(window.timelineGifId).stickerData.gifCycleMs == null), true, 'Reset speed restores the native GIF');
		await gifBar.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Fit to loop', exact: true }).click();
		await ready();
		assert.equal(await page.evaluate(() => editor.layerManager.getLayerById(window.timelineGifId).stickerData.gifCycleMs), 960, 'GIF menu fits an authored cycle to the loop');
		await gifBar.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Reset timing', exact: true }).click();
		await ready();
		assert(await page.evaluate(() => editor.layerManager.getLayerById(window.timelineGifId).stickerData.gifCycleMs == null), 'Reset timing restores the cycle remembered by Fit');
		// Arrows walk the bars, across layers; Enter opens the bar's menu.
		const focusedLayer = () => page.evaluate(() => document.activeElement.closest('.timeline-group')?.dataset.layerId);
		const fixtureId = await page.evaluate(() => window.timelineFixtureId);
		await page.locator(`#timelineDock [data-layer-id="${fixtureId}"] .timeline-bar`).focus();
		assert.equal(await page.evaluate(() => editor.notifications.statusText.textContent), 'Drag to move · edges trim · Alt-drag slips · right-click for more', 'A focused bar says what it can do');
		await page.keyboard.press('Home');
		assert.equal(await focusedLayer(), await page.evaluate(() => window.timelineGifId), 'Home reaches the first bar, in another layer');
		await page.keyboard.press('End');
		assert.equal(await focusedLayer(), fixtureId, 'End reaches the last bar');
		await page.keyboard.press('ArrowUp');
		assert.equal(await focusedLayer(), await page.evaluate(() => window.timelineGifId), 'Up moves to the bar above');
		await page.keyboard.press('ArrowDown');
		assert.equal(await focusedLayer(), fixtureId);
		await page.keyboard.press('Enter');
		assert(await page.getByRole('menuitem', { name: 'Reset timing', exact: true }).isVisible(), 'Enter opens the bar menu');
		await page.keyboard.press('Escape');
		// A one-cycle bar too short for its grips still moves by its body.
		await page.evaluate(async () => {
			const layer = editor.layerManager.getLayerById(window.timelineFixtureId);
			Object.assign(layer.animations[0], { periodMs: 200, iterations: 1, delayMs: 1000, phase: 0 });
			editor.shapeGlitterManager.renderLayer(layer); editor.saveState('Short bar fixture');
			await editor.updateExportDuration();
		});
		await ready();
		assert(await page.evaluate(() => {
			const bar = editor.timelineDock.body.querySelector(`[data-layer-id="${window.timelineFixtureId}"] .timeline-bar`);
			return bar.classList.contains('has-outside-grips') && bar.getBoundingClientRect().width >= CONFIG.ui.timeline.barMinPx;
		}), 'A short bar keeps a body and wears its grips outside');
		before = await state();
		await drag('body', 500, { delta: true, grab: 'middle' });
		after = await state();
		assert(after.delay > before.delay + 400 && after.repeats === 1, 'A short bar moves by its body');
		assert.deepEqual(errors, []);
		console.log('PASS timeline gestures: body move and slip, snap guide and readout, Alt, live trim, Undo, Escape, locked bars, nudge burst, arrow focus, menu, short bars, cycle and loop length');
	} finally { await context.close(); }
}

if (require.main === module) {
	const { chromium } = require('playwright');
	(async () => { const browser = await chromium.launch(); try { await verifyTimelineGestures(browser); } finally { await browser.close(); } })().catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { verifyTimelineGestures };
