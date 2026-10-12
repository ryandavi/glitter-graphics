const assert = require('assert');
const { openApp } = require('../lib/app');

(async () => {
	const { browser, page, errors } = await openApp({ viewport: { width: 1280, height: 800 }, document: { width: 32, height: 24, color: '#a348cd' } });
	try {
		await page.evaluate(async () => { editor.openAnimationLoop(); await editor.updateExportDuration(); });
		assert(await page.locator('#animationLoopStatus').isVisible());
		for (const id of ['animationLoopSourceSet', 'animationLoopLengthSet', 'animationLoopChangeSet', 'animationLoopActionSet']) {
			assert(!(await page.locator(`#${id}`).isVisible()), `${id} must be hidden with no animation sources`);
		}
		const replay = await page.evaluate(async () => {
			const e = editor;
			const layer = e.layerManager.addLayer(LayerType.SHAPE);
			getLayerFillSlot(layer).mode = 'solid';
			layer.animations = [GlitterAnimation.normalizeAnimation({ type: 'tada', periodMs: 1000, iterations: 1, delayMs: 2000 })];
			e.shapeGlitterManager.renderLayer(layer);
			await e.updateExportDuration();
			e.animationTicker.stop();
			const ticker = e.animationTicker;
			const wrapper = ticker.targets.get(layer.id).target.getWrapper();
			const start = ticker.timelineStartedAt;
			ticker._paint(start + 2250);
			const first = wrapper.style.transform;
			ticker._paint(start + e.loopEstimate.duration + 2250);
			const second = wrapper.style.transform;
			ticker._paint(start + e.loopEstimate.duration + 1500);
			const rest = wrapper.style.transform;
			ticker.timelineStartedAt = performance.now() - e.loopEstimate.duration - 2250;
			const current = ticker.getCurrentTime();
			const result = { duration: e.loopEstimate.duration, replays: first === second && first !== rest, current,
				badge: document.getElementById('animationLoopStatus').textContent };
			e.layerManager.deleteLayer(layer.id, { skipHistory: true });
			return result;
		});
		assert.strictEqual(replay.duration, 3000);
		assert(replay.replays, 'Finite motion must move again after the loop wraps');
		assert(replay.current >= 2250 && replay.current < 2300, 'Current frame must use wrapped time');
		assert(replay.badge.includes('Seamless'), 'Returning finite motion must show a seamless badge');
		const timings = await page.evaluate(async () => {
			const e = editor;
			const scan = e.layerManager.addLayer(LayerType.FILTER);
			scan.filterData = GlitterFilter.normalizeFilterData({ type: 'scanlines', spacing: 4, crawl: 'medium' });
			const source = e.sceneCompositor._createFilterTimelineSources(scan)[0];
			const samples = [0, 100, 200, 300, 400].map((timestamp) => source.sampleAt(timestamp).frameIndex);
			const node = e.filterLayerManager.renderLayer(scan);
			e.animationTicker.stop();
			const ticker = e.animationTicker.targets.get(`filter-animation-${scan.id}`);
			ticker.target.paint(200);
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const offset = getComputedStyle(node.querySelector('.filter-layer-gradient')).backgroundPositionY;
			ticker.target.paint(0);
			const off = e.sceneCompositor._createFilterTimelineSources({ ...scan, filterData: GlitterFilter.normalizeFilterData({ type: 'scanlines' }) }).length;
			e.layerManager.deleteLayer(scan.id, { skipHistory: true });
			const hue = e.layerManager.addLayer(LayerType.FILTER);
			hue.filterData = GlitterFilter.normalizeFilterData({ type: 'hue-cycle', speed: 0.8 });
			clearTimeout(e.filterLayerManager.snapshotTimers.get(hue.id));
			await e.filterLayerManager.renderSnapshot(hue, true);
			const output = e.filterLayerManager.snapshotOutputs.get(hue.id);
			const index = Math.floor(output.frames.length / 2);
			const preview = output.frames[index].getContext('2d').getImageData(0, 0, 32, 24).data;
			const exported = await e.sceneCompositor.composeFrameAt({ ...e.getSceneSnapshotParams(e.layers), timestamp: index * output.frameDuration });
			const parity = Array.from(preview).every((value, i) => value === exported.imageData.data[i]);
			const changesHue = preview[0] !== e.originalImageData.data[0];
			e.layerManager.deleteLayer(hue.id, { skipHistory: true });
			return { samples, offset, off, parity, changesHue, frames: output.frames.length };
		});
		assert.deepStrictEqual(timings.samples, [0, 2, 4, 6, 0]);
		if (process.env.GLITTER_TEST_CSS) assert.strictEqual(timings.offset, '2px', 'CSS crawl and export must have the same pixel offset');
		assert.strictEqual(timings.off, 0);
		assert(timings.parity && timings.changesHue && timings.frames > 1, 'Hue snapshots must animate and match export pixels');
		const fitting = await page.evaluate(async () => {
			const e = editor;
			const fixed = e.layerManager.addLayer(LayerType.FILTER);
			fixed.filterData = GlitterFilter.normalizeFilterData({ type: 'dither', shimmer: true, palette: 'bw' });
			const hue = e.layerManager.addLayer(LayerType.FILTER);
			hue.filterData = GlitterFilter.normalizeFilterData({ type: 'hue-cycle', speed: 1.4 });
			const shape = e.layerManager.addLayer(LayerType.SHAPE);
			getLayerFillSlot(shape).mode = 'solid';
			shape.animations = [GlitterAnimation.normalizeAnimation({ type: 'wobble', periodMs: 1400 })];
			e.saveState('Loop fixture');
			e.modalManager.open('exportSettingsModal');
			document.getElementById('openAnimationLoop').click();
			if (document.getElementById('exportSettingsModal').classList.contains('visible') || document.getElementById('animationLoopSection').classList.contains('is-collapsed')) throw new Error('Animation Loop button must close the modal and expand the panel');
			await e.updateExportDuration();
			const candidate = e.loopEstimate.loopFit.candidates.find((entry) => entry.duration === 800);
			document.getElementById('animationLoopCandidate').value = '800'; e.syncLoopCandidate();
			const beforeUi = {
				fit: !document.getElementById('fitAnimationsToLoop').hidden,
				length: !document.getElementById('animationLoopLengthSet').hidden,
				restore: !document.getElementById('resetAnimationLoop').hidden
			};
			const beforeColumns = document.getElementById('animationLoopSources').tHead.rows[0].cells.length;
			const before = e.historyManager.historyIndex;
			e.fitAnimationsToLoop();
			const fitted = { hue: hue.filterData.speed, motion: shape.animations[0].periodMs, history: e.historyManager.historyIndex - before };
			await e.historyManager.undo();
			const undone = e.layers.find((layer) => layer.id === hue.id).filterData.speed;
			await e.historyManager.redo();
			await e.updateExportDuration();
			const refitted = e.layers.find((layer) => layer.id === hue.id).filterData.speed;
			const seam = e.loopEstimate.exact;
			const selected = document.getElementById('animationLoopSources').querySelectorAll('button').length;
			const staleCandidate = e.loopEstimate;
			e.saveState('Invalidate loop');
			const fittedColumns = document.getElementById('animationLoopSources').tHead.rows[0].cells.length;
			const badge = document.querySelector('#animationLoopStatus .badge').textContent;
			return { fitted, undone, refitted, seam, selected, beforeUi, beforeColumns, fittedColumns, badge, candidate: candidate.exact, staleCleared: !e.loopEstimate && !!staleCandidate };
		});
		assert(fitting.candidate && fitting.seam);
		assert.deepStrictEqual(fitting.fitted, { hue: 0.8, motion: 800, history: 1 });
		assert.strictEqual(fitting.undone, 1.4); assert.strictEqual(fitting.refitted, 0.8);
		assert(fitting.selected >= 3 && fitting.staleCleared);
		assert.deepStrictEqual(fitting.beforeUi, { fit: true, length: true, restore: false });
		assert.strictEqual(fitting.beforeColumns, 2);
		assert.strictEqual(fitting.fittedColumns, 3);
		assert.strictEqual(fitting.badge, 'Seamless');
		assert.strictEqual(await page.locator('#animationLoopStatus').innerText(), '0.80 s loop\nSeamless');
		assert(await page.locator('#animationLoopChangeSet').isVisible(), 'Already fitted timing belongs below the source table');
		assert.strictEqual(await page.locator('#animationLoopChanges').innerText(), 'Timing already fits.');
		assert.strictEqual(await page.locator('#animationLoopSources td[aria-label="No saved timing"]').innerText(), '-');
		assert(await page.locator('#animationLoopSourceSet').isVisible());
		assert(!(await page.locator('#animationLoopLengthSet').isVisible()), 'Already fitted timing with no useful alternative needs no length picker');
		assert(!(await page.locator('#fitAnimationsToLoop').isVisible()), 'An unavailable fit action must be hidden');
		assert(await page.locator('#resetAnimationLoop').isVisible(), 'Saved timing must remain available to restore');
		const restored = await page.evaluate(async () => {
			await editor.updateExportDuration();
			const table = document.getElementById('animationLoopSources');
			const row = Array.from(table.tBodies[0].rows).find((entry) => entry.cells[0].textContent.includes('Hue Cycle'));
			const times = Array.from(row.cells).slice(1).map((cell) => cell.textContent);
			const hueId = editor.layers.find((layer) => layer.filterData?.type === 'hue-cycle').id;
			row.querySelector('th button').click();
			const navigates = editor.layerManager.getActiveLayer().id === hueId;
			editor.openAnimationLoop();
			await editor.updateExportDuration();
			const before = editor.historyManager.historyIndex;
			const saved = editor.layers.filter((layer) => layer.loopOriginalPeriods).map((layer) => editor.layerManager.serializeLayer(layer));
			const roundTrips = await Promise.all(saved.map((layer) => editor.layerManager.deserializeLayer(layer)));
			const persists = roundTrips.every((layer, index) => JSON.stringify(layer.loopOriginalPeriods) === JSON.stringify(saved[index].loopOriginalPeriods));
			document.getElementById('resetAnimationLoop').click();
			const hue = editor.layers.find((layer) => layer.filterData?.type === 'hue-cycle');
			const shape = editor.layers.find((layer) => layer.type === LayerType.SHAPE);
			const result = { hue: hue.filterData.speed, motion: shape.animations[0].periodMs, history: editor.historyManager.historyIndex - before, persists, cleared: !hue.loopOriginalPeriods && !shape.loopOriginalPeriods, times, navigates };
			await editor.historyManager.undo();
			result.undo = editor.layers.find((layer) => layer.id === hue.id).filterData.speed;
			await editor.historyManager.redo();
			result.redo = editor.layers.find((layer) => layer.id === hue.id).filterData.speed;
			return result;
		});
		assert.deepStrictEqual(restored, { hue: 1.4, motion: 1400, history: 1, persists: true, cleared: true, undo: 0.8, redo: 1.4, times: ['0.80 s', '1.40 s'], navigates: true });
		const slow = await page.evaluate(() => {
			const data = GlitterFilter.normalizeFilterData({ type: 'scanlines', spacing: 4, crawl: 'slow' });
			const animation = GlitterFilter.animation(data);
			return Array.from({ length: animation.frames + 1 }, (_, index) => GlitterFilter.resolve(data, index).ops[0].gradient.offset);
		});
		assert.deepStrictEqual(slow, [...Array.from({ length: 16 }, (_, index) => index / 4), 0], 'Slow crawl must advance uniformly through the wrap');
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForFunction(() => editor.mobileManager.isMobile);
		await page.evaluate(() => editor.openAnimationLoop());
		await page.waitForFunction(() => editor.mobileManager.sheetSection?.element.id === 'animationLoopSection');
		assert(await page.locator('#animationLoopStatus').isVisible(), 'Phone helper must mount its section into the sheet');
		await page.evaluate(() => editor.openAnimationLoop());
		assert(await page.locator('#animationLoopStatus').isVisible(), 'Opening the current helper must keep it open');
		assert.deepStrictEqual(errors, []);
		console.log('PASS animated filter timing, crawl CSS steps, hue pixel parity, loop fit, one-step undo/redo, and stale estimate invalidation');
	} finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
