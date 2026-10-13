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
		const drag = async (kind, time, { alt = false, shift = false, cancel = false, delta = false, pointerCancel = false, grab = null } = {}) => {
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
			if (shift) await page.keyboard.down('Shift');
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
			if (shift) await page.keyboard.up('Shift');
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
		await page.evaluate(() => { editor.timelineDock.setZoom(300); editor.animationTicker.seek(0); editor.timelineDock.scrollToTimeX(0); });
		const menuBar = await gifBar.boundingBox();
		await gifBar.click({ button: 'right', position: { x: 30, y: menuBar.height / 2 } });
		const menuBox = await page.locator('.app-menu-panel.is-fixed-menu:visible').boundingBox();
		assert(Math.abs(menuBox.x - (menuBar.x + 30)) < 1, 'A zoomed-in bar menu opens at the right-click, rather than its distant end');
		assert(menuBox.x + menuBox.width <= 1600 && menuBox.y >= 0 && menuBox.y + menuBox.height <= 900, 'A context menu stays within the viewport');
		await page.getByRole('menuitem', { name: 'Match cycle to...', exact: true }).click();
		assert(Math.abs((await page.locator('.app-menu-panel.is-fixed-menu:visible').boundingBox()).x - menuBox.x) < 1, 'Nested choices retain the right-click anchor');
		await page.keyboard.press('Escape');
		await gifBar.focus(); await page.keyboard.press('Enter');
		assert(Math.abs((await page.locator('.app-menu-panel.is-fixed-menu:visible').boundingBox()).x - menuBar.x) < 1, 'Keyboard menus anchor at the visible start of the bar');
		await page.keyboard.press('Escape');
		await page.evaluate(() => editor.timelineDock.setZoom('fit'));
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
		assert.equal(await page.evaluate(() => editor.notifications.statusText.textContent), 'Drag to move · left edge changes start · right edge trims repeats · Shift-edge stretches cycles · Alt-drag slips · right-click for more', 'A focused bar says what it can do');
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
		await drag('right', after.delay + 400, { alt: true });
		assert(Math.abs((await state()).period - 400) < 0.01 && (await state()).repeats === 1, 'A one-cycle right edge stretches duration and keeps one repeat');
		assert.match(feedback.text, /^Cycle 0\.40 s \(was 0\.20 s\)/);
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		after = await state();
		await drag('right', after.delay + 400, { alt: true, shift: true });
		assert(Math.abs((await state()).period - 200) < 0.01 && Math.abs((await state()).repeats - 2) < 0.01, 'Shift on a one-cycle edge adds repeats');
		after = await state();
		await drag('right', after.delay + 800, { alt: true, shift: true });
		assert(Math.abs((await state()).period - 400) < 0.01 && Math.abs((await state()).repeats - 2) < 0.01, 'Shift on a repeating edge stretches duration and keeps its count');

		await page.evaluate(async () => {
			editor.animationPanel.setPaused(true);
			editor.timelineDock.setZoom(300);
			editor.animationTicker.seek(0);
			editor.timelineDock.scrollToTimeX(0);
		});
		const body = page.locator('.timeline-body');
		const bodyBox = await body.boundingBox();
		await page.evaluate(() => {
			window.timelineWheelResult = null;
			window.addEventListener('wheel', event => {
				setTimeout(() => { window.timelineWheelResult = { prevented: event.defaultPrevented, ratio: devicePixelRatio, width: innerWidth, canvasZoom: editor.viewport.currentZoom }; }, 0);
			}, { capture: true });
		});
		const pageZoom = await page.evaluate(() => ({ prevented: true, ratio: devicePixelRatio, width: innerWidth, canvasZoom: editor.viewport.currentZoom }));
		const ctrlWheel = async (selector, position, direction = -1) => {
			const box = await page.locator(selector).first().boundingBox();
			await page.mouse.move(box.x + (position?.x ?? Math.min(30, box.width / 2)), box.y + (position?.y ?? box.height / 2));
			await page.evaluate(() => { window.timelineWheelResult = null; });
			const scale = await page.evaluate(() => editor.timelineDock.scale);
			await page.keyboard.down('Control'); await page.mouse.wheel(0, direction * 100); await page.keyboard.up('Control');
			await page.waitForFunction(() => window.timelineWheelResult);
			const result = await page.evaluate(() => window.timelineWheelResult);
			assert.deepEqual(result, pageZoom, `Ctrl-wheel consumes browser zoom over ${selector} and leaves canvas zoom unchanged: ${JSON.stringify(result)}`);
			assert(await page.evaluate(() => editor.timelineDock.scale) !== scale, `Ctrl-wheel zooms over ${selector}`);
		};
		for (const selector of ['.timeline-bar', '.timeline-row-label', '.timeline-ruler', '#timelineDock .section-header', '.timeline-body']) {
			await page.evaluate(() => { editor.timelineDock.setZoom(300); editor.timelineDock.scrollToTimeX(0); });
			const empty = selector === '.timeline-body' ? { x: bodyBox.width - 40, y: bodyBox.height - 25 } : null;
			await ctrlWheel(selector, empty);
		}
		await ctrlWheel('#timelineDock .section-header', null, 1);
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock;
			dock.setZoom(dock.config.pxPerSecondStops.at(-1));
			const scale = dock.scale;
			const consumed = !dock.header.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }));
			return consumed && dock.scale === scale;
		}), 'Ctrl-wheel remains consumed at the timeline zoom limit');
		await page.evaluate(() => { editor.timelineDock.setZoom(300); editor.timelineDock.scrollToTimeX(0); });
		await page.mouse.move(bodyBox.x + bodyBox.width - 40, bodyBox.y + 30);
		if (process.env.GLITTER_TEST_CSS) {
			const rail = page.locator('.scroll-region-track.is-horizontal');
			await rail.waitFor({ state: 'visible' });
			assert(await rail.evaluate(node => {
				const body = editor.timelineDock.body.getBoundingClientRect();
				return node.getBoundingClientRect().left >= body.left + editor.timelineDock.labelColumn;
			}), 'The horizontal rail clears sticky labels');
			await ctrlWheel('.scroll-region-track.is-horizontal', { x: 40, y: 4 });
			await page.evaluate(() => { editor.timelineDock.setZoom(300); editor.timelineDock.scrollToTimeX(0); });
			const thumb = await rail.locator('.scroll-region-thumb').boundingBox();
			await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
			await page.mouse.down(); await page.mouse.move(thumb.x + thumb.width / 2 + 70, thumb.y + thumb.height / 2); await page.mouse.up();
			assert(await body.evaluate(node => node.scrollLeft > 0), 'Dragging the horizontal thumb scrolls the tracks');
			await page.evaluate(() => editor.timelineDock.scrollToTimeX(0));
		}
		await page.evaluate(() => {
			const dock = editor.timelineDock, ticker = editor.animationTicker;
			ticker.stop(); ticker.paused = false; dock.syncPlayback();
			const ms = TimelineView.xToTime(dock.viewWidth, dock.scale);
			dock.paintPlayhead(ms); ticker.heldMs = ms; ticker.paused = true;
		});
		assert(await body.evaluate(node => node.scrollLeft > 0), 'Playing pages when the playhead passes the edge');
		await page.evaluate(() => { const dock = editor.timelineDock; editor.animationTicker.paused = false; dock.paintPlayhead(0); editor.animationTicker.heldMs = 0; editor.animationTicker.paused = true; });
		assert.equal(await body.evaluate(node => node.scrollLeft), 0, 'Loop wrap returns the view to the start');
		await page.evaluate(() => { editor.animationTicker.stop(); editor.animationTicker.timelineStartedAt = performance.now(); editor.animationTicker.paused = false; editor.timelineDock.body.scrollLeft = 500; });
		await page.waitForTimeout(50);
		assert(await page.evaluate(() => editor.timelineDock.followSuspended), 'A manual sideways scroll suspends following');
		await page.evaluate(() => editor.timelineDock.paintPlayhead(0));
		assert.equal(await body.evaluate(node => node.scrollLeft), 500, 'Following respects the manual view');
		await page.evaluate(() => { const dock = editor.timelineDock; dock.syncPlayback(); dock.paintPlayhead(0); editor.animationTicker.paused = true; });
		assert.equal(await body.evaluate(node => node.scrollLeft), 0, 'Pressing Play resumes following');
		const pausedScroll = await page.evaluate(() => {
			const dock = editor.timelineDock;
			editor.animationTicker.seek(TimelineView.xToTime(dock.viewWidth - dock.config.followMarginPx - 1, dock.scale));
			const before = dock.body.scrollLeft;
			dock.rulerTrack.focus();
			return { before, view: dock.viewWidth };
		});
		await page.keyboard.press('ArrowRight');
		const steppedScroll = await body.evaluate(node => node.scrollLeft);
		assert(steppedScroll > pausedScroll.before && steppedScroll - pausedScroll.before < pausedScroll.view / 2, 'A paused frame step reveals by less than a page');
		await page.evaluate(() => { editor.animationTicker.seek(0); editor.timelineDock.scrollToTimeX(0); });
		const rulerBox = await page.locator('.timeline-ruler').boundingBox();
		await page.mouse.move(rulerBox.x + rulerBox.width - 60, rulerBox.y + rulerBox.height / 2);
		await page.mouse.wheel(0, 100); await page.waitForTimeout(50);
		assert(await body.evaluate(node => node.scrollLeft >= 100), 'A plain wheel over the ruler scrolls sideways');
		await page.evaluate(() => editor.timelineDock.scrollToTimeX(0));
		await page.mouse.move(bodyBox.x + bodyBox.width - 60, bodyBox.y + 30);
		await page.mouse.wheel(100, 0); await page.waitForTimeout(50);
		assert(await body.evaluate(node => node.scrollLeft >= 100), 'A trackpad sideways wheel scrolls natively');
		await page.evaluate(() => editor.timelineDock.scrollToTimeX(0));
		await page.keyboard.down('Shift'); await page.mouse.wheel(0, 100); await page.keyboard.up('Shift'); await page.waitForTimeout(50);
		assert(await body.evaluate(node => node.scrollLeft >= 100), 'Shift-wheel scrolls sideways natively');
		await page.evaluate(() => PREFERENCES.set('timelineFollow', false));
		await page.evaluate(() => { const dock = editor.timelineDock; dock.scrollToTimeX(500); editor.animationTicker.seek(0); dock.paintPlayhead(0); });
		assert.equal(await body.evaluate(node => node.scrollLeft), 500, 'Follow off leaves paused seeks where the user put the view');
		await page.evaluate(() => { PREFERENCES.reset('timelineFollow'); editor.timelineDock.scrollToTimeX(0); });
		// A held scrub travels after pointer movement stops, then releases its clock.
		const scrubStart = await page.evaluate(() => editor.timelineDock.labelColumn + 20);
		await page.mouse.move(rulerBox.x + scrubStart, rulerBox.y + rulerBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(rulerBox.x + rulerBox.width + 20, rulerBox.y + rulerBox.height / 2);
		const edgeBefore = await body.evaluate(node => node.scrollLeft);
		await page.waitForTimeout(180);
		assert(await body.evaluate(node => node.scrollLeft) > edgeBefore + 20, 'A scrub held beyond the edge scrolls at a steady rate');
		await page.mouse.up();
		const edgeAfter = await body.evaluate(node => node.scrollLeft);
		await page.waitForTimeout(80);
		assert.equal(await body.evaluate(node => node.scrollLeft), edgeAfter, 'Release stops edge scrolling');
		await page.evaluate(async () => {
			const layer = editor.layerManager.getLayerById(window.timelineFixtureId);
			Object.assign(layer.animations[0], { delayMs: 0, iterations: Infinity, periodMs: 1000 });
			editor.shapeGlitterManager.renderLayer(layer); await editor.updateExportDuration();
			editor.animationTicker.seek(0); editor.timelineDock.scrollToTimeX(0);
		}); await ready();
		before = await state();
		const moveBar = await page.locator(`[data-layer-id="${fixtureId}"] .timeline-bar`).boundingBox();
		await page.mouse.move(moveBar.x + 30, moveBar.y + moveBar.height / 2); await page.mouse.down();
		await page.mouse.move(bodyBox.x + bodyBox.width + 20, moveBar.y + moveBar.height / 2);
		const barEdgeBefore = await body.evaluate(node => node.scrollLeft);
		await page.waitForTimeout(180);
		assert(await body.evaluate(node => node.scrollLeft) > barEdgeBefore + 20, 'A bar held beyond the edge uses the shared scroll clock');
		await page.keyboard.press('Escape'); await page.mouse.up(); await ready();
		assert.deepEqual(await state(), before, 'Cancelling an edge-scrolling bar restores timing without history');
		assert.deepEqual(errors, []);
		console.log('PASS timeline gestures: body move and slip, snap guide and readout, Alt, live trim, Undo, Escape, locked bars, nudge burst, arrow focus, menu, short bars, cycle and loop length');
	} finally { await context.close(); }
}

if (require.main === module) {
	const { chromium } = require('playwright');
	(async () => { const browser = await chromium.launch(); try { await verifyTimelineGestures(browser); } finally { await browser.close(); } })().catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { verifyTimelineGestures };
