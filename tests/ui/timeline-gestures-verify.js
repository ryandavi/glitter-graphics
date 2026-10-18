'use strict';

const assert = require('assert/strict');
const { openApp } = require('../lib/app');

async function verifyTimelineGestures(browser) {
	const { page, context, errors } = await openApp({ browser, viewport: { width: 1920, height: 900 }, document: { width: 200, height: 160 } });
	try {
		await page.evaluate(async () => {
			editor.historyManager.limit = 100;
			const layer = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40 });
			getLayerFillSlot(layer).mode = 'solid'; editor.layerManager.insertLayer(layer); editor.layerManager.setActiveLayer(layer.id);
			window.emptyTimelineLayerId = layer.id;
			await editor.ensureTimelineDock(); PREFERENCES.set('timelineOpen', true); await editor.updateExportDuration();
		});
		await page.waitForFunction(() => editor.timelineDock?.model?.groups.some(group => group.layerId === emptyTimelineLayerId) && !editor.timelineDock.stale);
		const emptyBand = await page.evaluate(() => {
			const dock = editor.timelineDock;
			return { height: dock.ruler.getBoundingClientRect().height, empty: dock.body.querySelectorAll('.property-empty, .timeline-group-track').length,
				hint: dock.ruler.textContent, disabled: dock.addAnimation.disabled, columns: getComputedStyle(dock.body.querySelector('.timeline-group-header')).gridTemplateColumns.split(' ').length,
				chevron: dock.body.querySelector(`[data-layer-id="${emptyTimelineLayerId}"] .timeline-group-chevron`).getBoundingClientRect().toJSON() };
		});
		assert.equal(emptyBand.empty, 0, 'Empty timeline has no body empty state or group tracks');
		assert.equal(emptyBand.columns, 1, 'Empty timeline is a single-column layer list');
		assert.equal(emptyBand.hint, "Nothing moves yet. Select a layer and press + to add an animation.");
		assert.equal(emptyBand.disabled, false, 'Header Add animation is enabled for the active animatable layer');
		await page.locator('.timeline-dock .section-header-actions button[aria-label="Add animation"]').click();
		await page.evaluate(async () => { await editor.updateExportDuration(); });
		assert(await page.evaluate(() => editor.layerManager.getLayerById(emptyTimelineLayerId).animations.length === 1), 'Header Add animation adds a motion');
		assert.equal(await page.evaluate(() => editor.timelineDock.ruler.getBoundingClientRect().height), emptyBand.height, 'First animation preserves ruler band height');
		const chevron = page.locator(`.timeline-group[data-layer-id="${await page.evaluate(() => emptyTimelineLayerId)}"] .timeline-group-chevron`);
		const enabledBox = await chevron.evaluate(node => node.getBoundingClientRect().toJSON());
		assert.equal(enabledBox.width, emptyBand.chevron.width, 'Disabled chevron preserves width');
		assert.equal(enabledBox.height, emptyBand.chevron.height, 'Disabled chevron preserves height');
		await chevron.locator('..').press('ArrowLeft');
		await chevron.locator('..').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Add animation', exact: true }).click();
		await page.evaluate(async () => { await editor.updateExportDuration(); });
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock, group = dock.body.querySelector(`[data-layer-id="${emptyTimelineLayerId}"]`);
			return editor.layerManager.getLayerById(emptyTimelineLayerId).animations.length === 2 && !dock.collapsed.get(emptyTimelineLayerId)
				&& !group.classList.contains('is-collapsed') && group.querySelector('.timeline-group-chevron').getAttribute('aria-expanded') === 'true';
		}), 'Context-menu Add animation expands the collapsed group');
		await page.evaluate(async () => { await editor.loadBlankImage(200, 160, '#ffffff'); });
		await page.evaluate(async () => {
			const layer = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x: 60, y: 80 } });
			getLayerFillSlot(layer).mode = 'solid';
			layer.animations = [GlitterAnimation.normalizeAnimation({ id: editor.layerManager.generateLayerId(), type: 'pulse', periodMs: 1000 })];
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
		const ready = () => page.waitForFunction(() => editor.timelineDock?.model?.groups.some(group => group.layerId === window.timelineFixtureId) && !editor.timelineDock.stale);
		await ready();
		const state = () => page.evaluate(() => {
			const layer = editor.layerManager.getLayerById(window.timelineFixtureId), animation = layer.animations[0];
			return { delay: animation.delayMs, repeats: animation.iterations, phase: animation.phase, period: animation.periodMs,
				originals: structuredClone(layer.loopOriginalPeriods ?? null), history: editor.historyManager.historyIndex, loop: editor.documentLoop.durationMs };
		});
		let liveDrag = false;
		let feedback = null;
		const drag = async (kind, time, { alt = false, shift = false, cancel = false, delta = false, pointerCancel = false, grab = null } = {}) => {
			await ready();
			await page.evaluate(() => {
				window.timelineTargetCalls = 0; window.timelineOriginalTargets = TimelineView.snapTargets;
				TimelineView.snapTargets = function (...args) { window.timelineTargetCalls++; return timelineOriginalTargets.apply(this, args); };
			});
			const points = await page.evaluate(({ kind, time, delta, grab }) => {
				const dock = editor.timelineDock;
				const node = dock.body.querySelector(`[data-layer-id="${window.timelineFixtureId}"] .timeline-row`);
				const track = (kind === 'loop' ? dock.rulerTrack : node.querySelector('.timeline-track')).getBoundingClientRect();
				const target = (kind === 'loop' ? dock.rulerTrack.querySelector('.timeline-loop-end') : node.querySelector(kind === 'body' ? '.timeline-bar' : kind === 'period' ? '.timeline-period-notch' : `.timeline-bar-handle.is-${kind}`)).getBoundingClientRect();
				let x = target.left + target.width / 2;
				if (kind === 'body' && !grab) {
					const view = dock.body.getBoundingClientRect(), left = Math.max(target.left, view.left), right = Math.min(target.right, view.right);
					const bar = node.querySelector('.timeline-bar'), y = target.top + target.height / 2;
					x = [0.5, 0.75, 0.25].map(share => left + (right - left) * share).find(candidate => document.elementFromPoint(candidate, y)?.closest('[data-drag]') === bar);
					if (x == null) throw new Error('No unobstructed timing-bar body for dragging');
				}
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
			if (kind === 'period' || (kind === 'body' && alt)) assert(await page.evaluate(() => {
				const node = editor.timelineDock.drag?.node;
				return !node || [...node.querySelectorAll('.timeline-period-notch')].every(notch => getComputedStyle(notch).display === 'none');
			}), 'Cycle notches hide while their boundaries change');
			if (cancel) await page.keyboard.press('Escape');
			if (pointerCancel) await page.evaluate(() => editor.timelineDock.stage.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: editor.timelineDock.drag.pointerId })));
			await page.mouse.up();
			if (alt) await page.keyboard.up('Alt');
			if (shift) await page.keyboard.up('Shift');
			assert(await page.evaluate(() => {
				TimelineView.snapTargets = timelineOriginalTargets;
				return timelineTargetCalls <= 1;
			}), 'A timing drag computes static snap targets at most once');
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
		after = await state();
		assert.equal(after.repeats, 5, 'A forever bar takes the nearest whole repeat count on its first duration drag');
		assert.deepEqual(Object.values(after.originals), [1000], 'A committed duration drag remembers the original speed');
		assert(Math.abs(after.period - 400) < 0.01, 'The new cycle distributes those repeats inside the ruler-snapped length');
		assert.equal(feedback.text, 'Lasts 2.00 s · 5 × 0.40 s (was forever) · 2.00 s');
		assert.equal(after.history, before.history + 1);
		assert.equal(await page.evaluate(() => editor.historyManager.history[editor.historyManager.historyIndex].label), 'Change animation length');
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		assert.deepEqual(await state(), before, 'One Undo restores the forever run and its speed');
		const frameTarget = await page.evaluate(() => {
			const dock = editor.timelineDock; dock.setZoom(300);
			return dock.model.frameStarts.find(ms => ms > 250 && ms < 600 && ms % 100 >= 35 && ms % 100 <= 65);
		});
		assert.equal(typeof frameTarget, 'number', 'The fixture has an output frame between ruler snap ranges');
		await drag('left', frameTarget + 1);
		assert(Math.abs((await state()).delay - frameTarget - 1) < 0.01, 'Hidden output frames do not catch a left edge');
		assert.equal(feedback.guide, null);
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		await page.evaluate(() => editor.timelineDock.showItems.find(item => item.dataset.show === 'frames').click());
		await drag('left', frameTarget + 1);
		assert(Math.abs((await state()).delay - frameTarget) < 0.01, 'Output frames on makes the same left edge snap to a frame');
		assert.match(feedback.text, / · frame$/);
		await page.evaluate(() => {
			editor.historyManager.undo();
			editor.timelineDock.showItems.find(item => item.dataset.show === 'frames').click();
			editor.timelineDock.setZoom('fit');
		});
		await ready();
		await drag('right', await page.evaluate(() => {
			const dock = editor.timelineDock;
			return dock.model.loopMs - TimelineView.xToTime(dock.config.snapPx - 0.25, dock.scale);
		}));
		assert.equal((await state()).repeats, 5);
		assert(Math.abs((await state()).period - 960) < 0.01, 'A duration edge snaps to the loop end without becoming an infinite run');
		assert.match(feedback.text, /^Lasts 4\.80 s · 5 × 0\.96 s .*loop end$/);
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		before = await state();
		await drag('right', 2040, { shift: true });
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
		await drag('right', 2040, { alt: true, shift: true });
		assert(Math.abs((await state()).repeats - 2.04) < 1e-6, 'Alt bypasses snapping without rounding stored repeats');
		assert.equal(feedback.guide, null, 'An unsnapped drag has no guide');
		before = await state();
		await drag('left', 600, { alt: true, cancel: true });
		assert.deepEqual(await state(), before, 'Escape restores values without history');
		await drag('left', 600, { alt: true });
		after = await state();
		assert(Math.abs(after.delay - 600) < 0.01);
		assert(Math.abs(after.repeats - 1.44) < 1e-6, 'Left edge keeps the finite end');
		before = await state();
		await drag('body', 300, { delta: true, alt: false });
		after = await state();
		assert(after.delay > before.delay && Math.abs(after.repeats - before.repeats) < 1e-10, 'Body moves a trimmed bar without changing its length');
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
		assert(await bar.evaluate(button => {
			const dock = editor.timelineDock, node = button.closest('.timeline-row'), row = dock.rowFor(node);
			const left = button.style.left;
			button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
			return button.style.left !== left && Math.abs(parseFloat(button.style.left) - TimelineView.timeToX(row.startMs, dock.scale)) < 0.01;
		}), 'A keyboard nudge places the bar before the delayed estimate arrives');
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
		await bar.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Reset timing', exact: true }).click(); await ready();
		assert.equal((await state()).period, 1000, 'Reset timing restores the speed remembered by a notch drag');
		assert.equal((await state()).originals, null, 'Reset consumes the saved original speed');
		await drag('period', 1200, { alt: true });
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
		await page.keyboard.press('Escape');
		await gifBar.focus(); await page.keyboard.press('Shift+F10');
		assert(Math.abs((await page.locator('.app-menu-panel.is-fixed-menu:visible').boundingBox()).x - menuBar.x) < 1, 'Keyboard menus anchor at the visible start of the bar');
		await page.keyboard.press('Escape');
		await page.evaluate(() => editor.timelineDock.setZoom('fit'));
		await page.evaluate(() => {
			const dock = editor.timelineDock, row = dock.model.groups.flatMap(group => group.rows).find(row => row.kind === 'procedural');
			dock.barActions(row).find(action => action.id === 'copy').run();
			editor.timingClipboard.cycle = 1200;
		});
		await gifBar.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Paste timing', exact: true }).click();
		await ready();
		assert.equal(await page.evaluate(() => editor.layerManager.getLayerById(window.timelineGifId).stickerData.gifCycleMs), 1200, 'GIF menu matches another source cycle');
		assert.equal(await page.evaluate(() => editor.historyManager.history[editor.historyManager.historyIndex].label), 'Paste timing', 'A pasted timing is one named history step');
		await gifBar.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Reset timing', exact: true }).click(); await ready();
		assert(await page.evaluate(() => editor.layerManager.getLayerById(window.timelineGifId).stickerData.gifCycleMs == null), 'Reset timing also restores the speed remembered by Paste timing');
		await gifBar.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Original cycle', exact: true }).click();
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
		// Arrows walk the bars, across layers; Enter selects and Shift+F10 opens the menu.
		const focusedLayer = () => page.evaluate(() => document.activeElement.closest('.timeline-group')?.dataset.layerId);
		const fixtureId = await page.evaluate(() => window.timelineFixtureId);
		await page.locator(`#timelineDock [data-layer-id="${fixtureId}"] .timeline-bar`).focus();
		assert.equal(await page.evaluate(() => editor.notifications.statusText.textContent), 'Drag to move · left edge changes start · right edge sets length · Shift-edge changes repeats · Alt-drag slips · Enter selects · right-click or Shift+F10 for more', 'A focused bar says what it can do');
		await page.keyboard.press('Home');
		assert.equal(await focusedLayer(), await page.evaluate(() => window.timelineGifId), 'Home reaches the first bar, in another layer');
		await page.keyboard.press('End');
		assert.equal(await focusedLayer(), fixtureId, 'End reaches the last bar');
		await page.keyboard.press('ArrowUp');
		assert.equal(await focusedLayer(), await page.evaluate(() => window.timelineGifId), 'Up moves to the bar above');
		await page.keyboard.press('ArrowDown');
		assert.equal(await focusedLayer(), fixtureId);
		await page.keyboard.press('Enter');
		assert.equal(await page.evaluate(() => editor.timelineDock.selectedKey), await page.locator(`#timelineDock [data-layer-id="${fixtureId}"] .timeline-row`).getAttribute('data-source-key'), 'Enter selects the focused bar');
		await page.keyboard.press('Shift+F10');
		assert(await page.getByRole('menuitem', { name: 'Reset timing', exact: true }).isVisible(), 'Shift+F10 opens the bar menu');
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
		assert.equal(feedback.text, 'Lasts 0.40 s · 1 × 0.40 s (was 0.20 s · 1 × 0.20 s)');
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		after = await state();
		await drag('right', after.delay + 400, { alt: true, shift: true });
		assert(Math.abs((await state()).period - 200) < 0.01 && Math.abs((await state()).repeats - 2) < 0.01, 'Shift on a one-cycle edge adds repeats');
		after = await state();
		await drag('right', after.delay + 800, { alt: true });
		assert(Math.abs((await state()).period - 400) < 0.01 && Math.abs((await state()).repeats - 2) < 0.01, 'An ordinary repeating edge sets length and keeps its count');
		after = await state();
		await drag('right', after.delay + 1200, { alt: true, shift: true });
		assert(Math.abs((await state()).repeats - 3) < 1e-4, `Shift on a repeating edge changes the count: ${JSON.stringify(await state())}`);
		assert(Math.abs((await state()).period - 400) < 0.01);
		await page.evaluate(async () => {
			const layer = editor.layerManager.getLayerById(window.timelineFixtureId);
			Object.assign(layer.animations[0], { periodMs: 500, iterations: 2, delayMs: 0, phase: 0.25 });
			editor.shapeGlitterManager.renderLayer(layer); editor.saveState('Offset duration fixture'); await editor.updateExportDuration();
		}); await ready();
		before = await state();
		await drag('right', 1400, { alt: true, cancel: true });
		assert.deepEqual(await state(), before, 'Escape restores both period and run from a duration drag');
		await drag('right', 1400, { alt: true, pointerCancel: true });
		assert.deepEqual(await state(), before, 'Pointer cancellation restores both period and run');
		await drag('right', 1400, { alt: true });
		after = await state();
		assert.equal(after.repeats, 2); assert.equal(after.phase, 0.25);
		assert(Math.abs(after.period - 800) < 0.01, 'Duration preserves repeat count and Start offset');
		assert.equal(after.history, before.history + 1);
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		assert.deepEqual(await state(), before);
		await page.evaluate(async () => {
			const layer = editor.layerManager.getLayerById(window.timelineFixtureId);
			Object.assign(layer.animations[0], { periodMs: 1000, iterations: 2, delayMs: 0, phase: 0 });
			editor.shapeGlitterManager.renderLayer(layer); editor.saveState('Duration limit fixture'); await editor.updateExportDuration();
		}); await ready();
		await drag('right', 50);
		assert.equal((await state()).repeats, 2, 'A cycle limit never turns the duration edge into a trim');
		assert.equal((await state()).period, 100);
		assert.equal(feedback.guide, null, 'A clamped duration edge drops the snap');

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
		for (const selector of ['#timelineDock .timeline-bar', '.timeline-row-label', '.timeline-ruler', '#timelineDock .section-header', '.timeline-body']) {
			await page.evaluate(() => { editor.timelineDock.setZoom(300); editor.timelineDock.scrollToTimeX(0); });
			const empty = selector === '.timeline-body' ? { x: bodyBox.width - 40, y: bodyBox.height - 25 } : null;
			await ctrlWheel(selector, empty);
		}
		await ctrlWheel('#timelineDock .section-header', null, 1);
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock;
			dock.setZoom(dock.config.pxPerSecondStops.at(-1));
			const row = dock.body.querySelector('.timeline-row'), ruler = dock.rulerTrack;
			const scale = dock.scale;
			const consumed = !dock.header.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }));
			return consumed && dock.scale === scale && row === dock.body.querySelector('.timeline-row') && ruler === dock.rulerTrack;
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
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock, bar = dock.body.querySelector(`[data-layer-id="${window.timelineFixtureId}"] .timeline-bar`), box = bar.getBoundingClientRect();
			bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 81, clientX: box.left + 30, clientY: box.top + box.height / 2 }));
			if (!dock.drag) return false;
			const estimate = { ...editor.loopEstimate, renderClock: { ...editor.loopEstimate.renderClock, frameCount: 123 } };
			editor.loopEstimate = estimate; dock.sync(estimate);
			window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 81 }));
			return !dock.drag && !dock.syncPending && dock.model.frameCount === 123;
		}), 'An estimate arriving during an unmoved bar press is replayed on release');
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock, model = dock.model, theme = editor.interfaceTheme;
			editor.interfaceTheme = theme === 'light' ? 'dark' : 'light'; editor.applyInterfaceTheme();
			const matches = dock.rulerTicks.text === getComputedStyle(dock.host).getPropertyValue('--color-text-secondary') && dock.model === model;
			editor.interfaceTheme = theme; editor.applyInterfaceTheme();
			return matches;
		}), 'A theme change refreshes ruler colors without rebuilding rows');
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock, layer = editor.layerManager.getLayerById(window.timelineFixtureId);
			const row = dock.model.groups.find(group => group.layerId === layer.id).rows[0];
			const delay = layer.animations[0].delayMs, history = editor.historyManager.historyIndex;
			dock.markStale(); dock.nudgeRow(row, { key: 'ArrowRight', shiftKey: false });
			const held = dock.stale && !dock.host.classList.contains('is-stale') && dock.canEdit(row)
				&& layer.animations[0].delayMs > delay && editor.historyManager.historyIndex === history + 1;
			dock.resync();
			return held && !dock.stale;
		}), 'Timing remains editable while the estimate is pending');
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock, row = dock.model.groups.find(group => group.layerId === window.timelineFixtureId).rows[0];
			const drawing = { ...row, exportCycleMs: 1000, cycleMarks: [0.5], source: { ...row.source, keyTrack: {} } };
			const marks = dock.buildMarks(drawing, 0, 3000), children = [...marks.children];
			dock.buildMarks({ ...drawing, phase: 0.1 }, 0, 3000, marks);
			return children.length > 0 && children.every((node, index) => marks.children[index] === node);
		}), 'Moving cycle marks retains the existing mark nodes');
		await page.evaluate(async () => {
			const layer = editor.layerManager.getLayerById(window.timelineFixtureId);
			Object.assign(layer.animations[0], { periodMs: 100, delayMs: 0 });
			editor.setDocumentLoop({ mode: 'set', durationMs: 10000 }, { commit: false });
			editor.timelineDock.setZoom('fit'); await editor.updateExportDuration();
		}); await ready();
		assert.equal(await page.locator(`[data-layer-id="${fixtureId}"] .timeline-period-notch`).count(), 0, 'Dense cycles leave the bar body available to drag');
		await page.getByRole('button', { name: 'Timeline options', exact: true }).click();
		assert.equal(await page.getByRole('menuitem', { name: 'Zoom to fit', exact: true }).count(), 0, 'Fit moved to the slider double-click and ruler menu');
		const output = page.getByRole('menuitemcheckbox', { name: 'Output frames', exact: true });
		const cycles = page.getByRole('menuitemcheckbox', { name: 'Cycle marks', exact: true });
		await output.click();
		assert(await output.isVisible() && await output.isChecked(), 'An Output frames checkbox remains open and exposes its checked state');
		await cycles.click();
		assert(await cycles.isVisible() && !await cycles.isChecked(), 'Several Show choices can change in one open menu');
		await output.click(); await cycles.click();
		await page.keyboard.press('Escape');
		assert(!(await output.isVisible()), 'Escape still closes the options menu');
		await page.evaluate(() => editor.timelineDock.setZoom(300));
		await page.getByRole('slider', { name: 'Timeline zoom', exact: true }).dblclick();
		assert.equal(await page.evaluate(() => PREFERENCES.get('timelineZoom')), 'fit', 'Double-clicking the zoom slider fits the loop');
		await page.evaluate(async () => {
			const layer = editor.layerManager.getLayerById(window.timelineFixtureId);
			layer.animations = [GlitterAnimation.normalizeAnimation({ id: editor.layerManager.generateLayerId(), type: 'pulse', direction: 'normal', periodMs: 1000, phase: 0.2, delayMs: 200, iterations: 2 })];
			editor.setDocumentLoop({ mode: 'set', durationMs: 4000 }, { commit: false });
			editor.shapeGlitterManager.renderLayer(layer); editor.saveState('Menu fixture'); await editor.updateExportDuration();
			editor.animationPanel.setPaused(true); editor.animationTicker.seek(1500);
		}); await ready();
		const openMotionMenu = () => page.evaluate(() => {
			const dock = editor.timelineDock, row = dock.model.groups.find(group => group.layerId === window.timelineFixtureId).rows[0];
			const node = dock.rowNodesByKey.get(String(row.key)); dock.openBarMenu(row, node, node.querySelector('.timeline-bar'));
		});
		for (const [label, field, value] of [['Play once', 'repeats', 1], ['Repeat forever', 'repeats', Infinity], ['Start at playhead', 'delay', 1500], ['Trim end at playhead', 'repeats', 1.5], ['Reverse', 'direction', 'reverse'], ['Ping-pong', 'direction', 'alternate']]) {
			const before = await state(); await openMotionMenu();
			await page.getByRole('menuitem', { name: label, exact: true }).click(); await ready();
			const after = await state();
			assert.equal(field === 'direction' ? await page.evaluate(() => editor.layerManager.getLayerById(window.timelineFixtureId).animations[0].direction) : after[field], value, label);
			assert.equal(after.history, before.history + 1, `${label} saves one step`);
			await page.evaluate(() => editor.historyManager.undo()); await ready(); assert.deepEqual(await state(), before, `${label} undoes in one step`);
		}
		assert(await page.evaluate(async () => {
			const dock = editor.timelineDock, layer = editor.layerManager.getLayerById(window.timelineFixtureId), nodes = [...dock.rowNodesByKey.values()];
			dock.setZoom(300); const zoomReused = nodes.every(node => node.isConnected && dock.rowNodesByKey.get(node.dataset.sourceKey) === node);
			getLayerFillSlot(layer).color = '#ff0000'; editor.shapeGlitterManager.renderLayer(layer); editor.saveState('Change static paint'); await editor.updateExportDuration();
			return zoomReused && nodes.every(node => node.isConnected && dock.rowNodesByKey.get(node.dataset.sourceKey) === node);
		}), 'Zoom and a static paint commit reuse row nodes');
		assert(await page.evaluate(async () => {
			const dock = editor.timelineDock, layer = editor.layerManager.getLayerById(window.timelineFixtureId);
			const groups = [...dock.body.querySelectorAll('.timeline-group')], nodes = [...dock.rowNodesByKey.values()];
			let sampled = 0; const curve = TimelineView.motionCurve;
			TimelineView.motionCurve = (...args) => { sampled++; return curve.apply(TimelineView, args); };
			try {
				layer.name = 'Renamed motion'; editor.saveState('Rename fixture'); await editor.updateExportDuration();
				const chevron = dock.body.querySelector(`[data-layer-id="${layer.id}"] .timeline-group-chevron`);
				chevron.click(); chevron.click();
				const renameKept = groups.every(node => node.isConnected) && nodes.every(node => node.isConnected) && sampled === 0
					&& chevron.getAttribute('aria-label') === 'Toggle Renamed motion timeline rows';
				editor.writeTiming(GlitterAnimation.sourceKey(layer.id, layer.animations[0]), { period: layer.animations[0].periodMs + 100 }); await editor.updateExportDuration();
				return renameKept && groups.every(node => node.isConnected) && sampled === 1;
			} finally { TimelineView.motionCurve = curve; }
		}), 'Rename retains groups and rows without curve sampling; retime samples only its changed curve');

		assert(await page.evaluate(() => {
			const dock = editor.timelineDock, row = dock.model.groups.find(group => group.layerId === window.timelineFixtureId).rows[0], start = row.startMs;
			for (let i = 0; i < 3; i++) dock.nudgeRow(row, { key: 'ArrowRight', shiftKey: false });
			return row.startMs > start + 2 * dock.model.frameStarts[1] && dock.canEdit(row);
		}), 'Held-arrow repeats advance while their estimates are pending');
		await page.evaluate(() => editor.updateExportDuration()); await ready();
		await page.getByRole('button', { name: 'Timeline options', exact: true }).click();
		await page.evaluate(() => editor.timelineDock.close());
		assert.equal(await page.getByRole('menuitem', { name: 'Zoom to fit', exact: true }).isVisible(), false, 'Closing the dock closes its portaled options menu');
		await page.evaluate(async () => {
			await editor.loadBlankImage(200, 160, '#ffffff');
			const fill = editor.layerManager.addLayer(LayerType.GLITTER_FILL);
			getLayerFillSlot(fill).mode = 'solid'; getLayerFillSlot(fill).color = '#12ab34';
			editor.setTool(ToolType.BRUSH);
			const rect = editor.previewWrapper.getBoundingClientRect();
			if (!editor.maskEditor._startStrokeFromScreenPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) throw new Error('Fill fixture stroke failed');
			editor.maskEditor._finishStroke(); editor.setTool(ToolType.SELECT);
			const still = editor.layerManager.addLayer(LayerType.SHAPE); still.name = 'Static layer'; still.animations = [];
			window.stackFixture = { fillId: fill.id, staticId: still.id };
			editor.setDocumentLoop(CONFIG.project.loop);
			PREFERENCES.set('timelineOpen', true); PREFERENCES.set('timelineLabelWidth', CONFIG.ui.timeline.labelWidth);
			await editor.updateExportDuration();
		});
		const stackReady = () => page.waitForFunction(() => !editor.timelineDock.stale && editor.timelineDock.model.groups.length === editor.layers.filter(layer => !layer.isPreview).length);
		await stackReady();
		const fillId = await page.evaluate(() => stackFixture.fillId), staticId = await page.evaluate(() => stackFixture.staticId);
		const group = id => page.locator(`.timeline-group[data-layer-id="${id}"]`);
		assert.equal(await group(fillId).locator('.layer-name').textContent(), await page.evaluate(() => describeLayer(editor.layerManager.getLayerById(stackFixture.fillId), editor).name), 'A Fill header uses its described name');
		assert.equal(await group(staticId).locator('.layer-name').textContent(), 'Static layer', 'A static layer is listed');
		assert.equal(await page.locator('#timelineDock .property-empty').count(), 0, 'Existing static layers suppress the empty state');
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock; dock.sync({ ...editor.loopEstimate, duration: 0 });
			return dock.model.groups.length === 3 && !dock.ruler.hidden && !dock.labelHandle.hidden
				&& dock.body.querySelector('.timeline-group-label').getBoundingClientRect().width === CONFIG.ui.timeline.labelWidth;
		}), 'A zero-length loop builds every group with the ruler band reserved and the default label width');
		const startGroup = await group(fillId).locator('.list-row-text').boundingBox(), targetGroup = await group(staticId).boundingBox();
		const orderHistory = await page.evaluate(() => editor.historyManager.historyIndex);
		await page.mouse.move(startGroup.x + 1, startGroup.y + startGroup.height / 2); await page.mouse.down();
		await page.mouse.move(targetGroup.x + 80, targetGroup.y + 1); await page.mouse.up();
		await stackReady();
		assert(await page.evaluate(index => editor.layers.at(-1).id === stackFixture.fillId && editor.layerManager.layersListContainer.querySelector('.layer-item').dataset.layerId === stackFixture.fillId && editor.historyManager.historyIndex === index + 1, orderHistory), 'Group dragging reorders layers and the Layers panel in one step');
		await page.evaluate(async () => {
			const layer = editor.layerManager.getLayerById(stackFixture.fillId);
			editor.layerManager.setActiveLayer(layer.id);
			editor.animationPanel.addAnimation(layer, 'pulse'); editor.animationPanel.addAnimation(layer, 'rotate');
			editor.animationPanel.toggleAnimation(layer, 1);
			await editor.updateExportDuration();
		});
		await stackReady();
		const motions = group(fillId).locator('.timeline-row[data-motion-index]');
		await page.evaluate(async () => {
			const layer = editor.layerManager.getLayerById(stackFixture.fillId);
			getLayerFillSlot(layer).mode = 'glitter';
			getLayerFillSlot(layer).glitterId = editor.glitterLibrary.getAllContent().find(item => item.isAnimated && item.isActive !== false).id;
			await editor.updateExportDuration();
		});
		assert(await group(fillId).evaluate(node => {
			const motion = node.querySelector('.timeline-row.has-motion .list-row-content');
			const source = node.querySelector('.timeline-row:not(.has-motion) .list-row-content');
			return source && Math.abs(source.getBoundingClientRect().left - motion.getBoundingClientRect().left) < 0.1;
		}), 'Animation and authored source names share the same left edge');
		assert.equal(await motions.count(), 2, 'Every stack entry is listed');
		assert.equal(await motions.nth(1).locator('.timeline-bar').count(), 0, 'Disabled motion has no bar');
		assert.equal(await motions.nth(1).locator('.list-row-content').textContent(), 'Rotate', 'Disabled motion retains its registry name');
		const motionStart = await motions.nth(0).locator('.list-row-content').boundingBox(), motionTarget = await motions.nth(1).boundingBox();
		const motionHistory = await page.evaluate(() => editor.historyManager.historyIndex);
		await page.mouse.move(motionStart.x + 1, motionStart.y + motionStart.height / 2); await page.mouse.down();
		await page.mouse.move(motionTarget.x + 80, motionTarget.y + motionTarget.height - 1); await page.mouse.up();
		await page.waitForFunction(() => !editor.timelineDock.stale && editor.timelineDock.model.groups.find(group => group.layerId === stackFixture.fillId).rows.filter(row => row.animation)[0].label === 'Rotate');
		assert(await page.evaluate(index => {
			const layer = editor.layerManager.getLayerById(stackFixture.fillId), prefix = editor.animationPanel.prefixByType.get(layer.type);
			return layer.animations[0].type === 'rotate' && editor.animationPanel.selectedMotionIndex(layer) === 1
				&& document.getElementById(`${prefix}AnimStack`).querySelector('.list-row-name').textContent === 'Rotate' && editor.historyManager.historyIndex === index + 1;
		}, motionHistory), 'Motion row dragging reorders both timeline and inspector in one step');
		await motions.nth(0).locator('.timeline-motion-enabled').click();
		await page.waitForFunction(() => !editor.timelineDock.stale && editor.timelineDock.model.groups.find(group => group.layerId === stackFixture.fillId).rows.filter(row => row.animation)[0].source);
		assert.equal(await motions.nth(0).locator('.timeline-bar').count(), 1, 'Timeline eye enables a disabled motion');
		await group(fillId).locator('.timeline-group-label').focus();
		await page.keyboard.press('Alt+ArrowDown');
		await page.waitForFunction(() => !editor.timelineDock.stale && editor.timelineDock.model.groups[0].layerId === stackFixture.staticId);
		assert.equal(await page.evaluate(() => editor.layers[1].id), fillId, 'Header row Alt+ArrowDown reorders the layer');
		await motions.nth(0).focus(); await page.keyboard.press('Alt+ArrowDown');
		await page.waitForFunction(() => !editor.timelineDock.stale && editor.timelineDock.model.groups.find(group => group.layerId === stackFixture.fillId).rows.filter(row => row.animation)[0].label === 'Pulse');
		assert.equal(await page.evaluate(() => editor.layerManager.getLayerById(stackFixture.fillId).animations[0].type), 'pulse', 'Motion row Alt+ArrowDown reorders its stack');
		await page.evaluate(async () => { editor.layerManager.toggleLayerVisibility(stackFixture.fillId); await editor.updateExportDuration(); });
		assert.equal(await motions.count(), 2, 'A hidden layer retains all stack entries');
		assert.equal(await motions.locator('.timeline-bar').count(), 0, 'A hidden layer has no motion bars');
		assert.deepEqual(errors, []);
		console.log('PASS timeline gestures: body move and slip, snap guide and readout, Alt, live trim, Undo, Escape, locked bars, nudge burst, arrow focus, menu, short bars, cycle and loop length');
	} finally { await context.close(); }
}

if (require.main === module) {
	const { chromium } = require('playwright');
	(async () => { const browser = await chromium.launch(); try { await verifyTimelineGestures(browser); } finally { await browser.close(); } })().catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { verifyTimelineGestures };
