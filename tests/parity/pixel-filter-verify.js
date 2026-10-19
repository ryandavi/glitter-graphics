'use strict';

const assert = require('assert');
const { chromium } = require('playwright');
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

(async () => {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1200, height: 760 } });
	await context.addInitScript(() => { localStorage.clear(); localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'); });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor?.settingsStore);
	await page.evaluate(async () => { await window.editor.modalManager.open('settingsModal'); window.editor.modalManager.close('settingsModal'); });
	await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach((modal) => modal.classList.remove('visible')));
	await page.evaluate(() => window.editor.loadBlankImage(24, 16, '#7b3fd1'));
	await page.waitForFunction(() => window.editor.originalImage != null);

	await page.evaluate(async () => {
		const e = window.editor;
		const m = e.filterLayerManager;
		const layer = e.layerManager.addLayer(LayerType.FILTER);
		layer.filterData = GlitterFilter.normalizeFilterData({ type: 'rgb-split', offset: 3 });
		const frame = createAppCanvas(24, 16, 'test');
		const ctx = frame.getContext('2d');
		ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'; ctx.fillRect(0, 0, 24, 16);
		const frames = [frame, frame];
		const inputSignature = m.getInputSignature(layer, m.getSnapshotLayers(layer));
		const filterSignature = m.getFilterSignature(layer);
		m.snapshotOutputs.set(layer.id, { frames, inputSignature, filterSignature, signature: `${inputSignature}|${filterSignature}|${m.isAnimatedPreview(layer)}`, startedAt: performance.now(), frameDuration: 100 });
		const element = m.renderLayer(layer);
		m.paintSnapshotElement(layer, element); m.paintSnapshotElement(layer, element);
		if (element.querySelector('canvas').getContext('2d').getImageData(0, 0, 1, 1).data[3] !== 128) throw new Error('Snapshot alpha accumulated');
		if (m.snapshotPlaybackFrame) cancelAnimationFrame(m.snapshotPlaybackFrame);
		m.snapshotPlaybackFrame = null;
		layer.visible = false; m.renderContent([]);
		layer.visible = true; m.renderContent([layer]);
		if (!m.snapshotPlaybackFrame) throw new Error('Showing cached animation did not restart playback');
		e.layerManager.deleteLayer(layer.id, { skipHistory: true });
	});
	const feedback = await page.evaluate(async () => {
		const e = window.editor;
		const m = e.filterLayerManager;
		const layer = e.layerManager.addLayer(LayerType.FILTER);
		layer.filterData = GlitterFilter.normalizeFilterData({ type: 'dither', shimmer: true });
		clearTimeout(m.snapshotTimers.get(layer.id));
		let observed = false;
		const update = e.updateActivity;
		e.updateActivity = function(key, changes) {
			update.call(this, key, changes);
			if (key === 'filter-preview' && changes.current < changes.total) {
				const pill = document.getElementById('canvasActivity');
				observed ||= !pill.hidden && pill.textContent.includes(`${changes.current}/${changes.total}`);
			}
		};
		try { await m.renderSnapshot(layer, true); }
		finally { e.updateActivity = update; e.layerManager.deleteLayer(layer.id, { skipHistory: true }); }
		return observed;
	});
	assert(feedback, 'Animated Dither must show a current/total activity label before completing');
	const result = await page.evaluate(async () => {
		const editor = window.editor;
		const layer = editor.layerManager.addLayer(LayerType.FILTER);
		layer.filterData = GlitterFilter.normalizeFilterData({ type: 'rgb-split', offset: 3 });
		editor.requestPreviewUpdate();
		await editor.filterLayerManager.renderSnapshot(layer, false);
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const preview = editor.filterLayerManager.snapshotOutputs.get(layer.id).frames[0].getContext('2d').getImageData(0, 0, 24, 16).data;
		const params = editor.filterLayerManager.buildSnapshotParams(editor.layers.filter((candidate) => candidate.visible && layerHasVisibleContent(candidate)));
		const exported = await editor.sceneCompositor.composeFrameAt(params);
		await editor.filterLayerManager.renderSnapshot(layer, true);
		const animatedFrameCount = editor.filterLayerManager.snapshotOutputs.get(layer.id).frames.length;

		let jpegEncodes = 0;
		PREFERENCES.set('filterPreviewLevel', 'off');
		clearTimeout(editor.filterLayerManager.snapshotTimers.get(layer.id));
		const original = HTMLCanvasElement.prototype.toBlob;
		HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
			if (type === 'image/jpeg') jpegEncodes++;
			return original.call(this, callback, type, quality);
		};
		layer.filterData = GlitterFilter.normalizeFilterData({ type: 'jpeg-crunch', quality: 30, generations: 2, blockSize: 2, chromaBleed: 25 });
		await editor.sceneCompositor.composeFrameAt(editor.filterLayerManager.buildSnapshotParams(editor.layers.filter((candidate) => candidate.visible && layerHasVisibleContent(candidate))));
		HTMLCanvasElement.prototype.toBlob = original;
		const alphaFixture = await GlitterFilter.jpegRoundTrip(new ImageData(new Uint8ClampedArray([
			255, 0, 0, 64, 0, 0, 255, 192
		]), 2, 1), { quality: 70, generations: 1, blockSize: 1, chromaBleed: 0 }, { alphaThreshold: 128, matteColor: '#ffffff' });

		return {
			preview: Array.from(preview), export: Array.from(exported.imageData.data), jpegEncodes, animatedFrameCount,
			jpegAlpha: [alphaFixture.data[3], alphaFixture.data[7]],
			tier: GlitterFilters.tier(layer.filterData), hasPreviewControl: Boolean(document.getElementById('filterPreviewLevel')),
			hasLegacyExportSetting: Object.hasOwn(editor.exportSettings, 'jpegGenerations')
		};
	});

	assert.deepStrictEqual(result.preview, result.export, 'Tier-3 preview and export pixels must match');
	assert(result.animatedFrameCount >= 2 && result.animatedFrameCount <= 24, 'Animated preview must honor its bounded frame cache');
	assert.strictEqual(result.jpegEncodes, 2, 'JPEG Crunch must perform its configured real encoder generations');
	assert.deepStrictEqual(result.jpegAlpha, [0, 255], 'JPEG Crunch must restore binarized scene alpha');
	assert.strictEqual(result.tier, 3, 'JPEG Crunch must derive Tier 3 from its pixel-only op');
	assert(result.hasPreviewControl, 'Pixel filter preview preference is missing');
	assert.strictEqual(result.hasLegacyExportSetting, false, 'jpegGenerations must be removed from export settings');
	const windowPixels = await page.evaluate(async () => {
		const e = editor, m = e.filterLayerManager;
		await e.loadBlankImage(24, 16, '#7b3fd1');
		PREFERENCES.set('filterPreviewLevel', 'still');
		const shape = e.shapeGlitterManager.createLayer({ shapeId: 'square', width: 12, height: 12, position: { x: 12, y: 8 } });
		Object.assign(getLayerFillSlot(shape), { mode: 'solid', color: '#ff0000' });
		e.layerManager.insertLayer(shape); e.setLayerAppear(shape, { start: 300, end: 600 });
		const filter = m.createLayer({ filterData: { type: 'rgb-split', offset: 3 } });
		e.layerManager.insertLayer(filter); e.setLayerAppear(filter, { start: 200, end: 700 });
		e.setDocumentLoop({ mode: 'set', durationMs: 1000 }, { commit: false });
		e.setPlayback(false); clearTimeout(m.snapshotTimers.get(filter.id));
		await m.renderSnapshot(filter, false);
		m.renderContent(e.layers); e.clipPreview.reconcile(e.layers);
		const output = m.snapshotOutputs.get(filter.id), element = m.layerElements.get(filter.id), checks = [];
		const params = m.buildSnapshotParams(e.layers);
		for (const timestamp of [0, 199, 200, 299, 300, 599, 600, 699, 700, 999]) {
			e.animationTicker.seek(timestamp); m.paintSnapshotElement(filter, element);
			const preview = element.querySelector('canvas').getContext('2d').getImageData(0, 0, 24, 16).data;
			const composed = await e.sceneCompositor.composeFrameAt({ ...params, timestamp, rest: false });
			checks.push(preview.every((value, index) => value === composed.imageData.data[index]));
			checks.push(!element.classList.contains('is-outside-appear') && e.previewCanvas.style.visibility === 'hidden');
		}
		e.animationTicker.setRestPreview(true); m.paintSnapshotElement(filter, element);
		const rest = element.querySelector('canvas').getContext('2d').getImageData(0, 0, 24, 16).data;
		const composed = await e.sceneCompositor.composeFrameAt({ ...params, timestamp: 0, rest: true });
		checks.push(rest.every((value, index) => value === composed.imageData.data[index]));
		return { checks, timestamps: output.timestamps };
	});
	assert(windowPixels.checks.every(Boolean), `Windowed pixel-filter preview matches export at each boundary and rest: ${JSON.stringify(windowPixels)}`);
	assert.deepStrictEqual(windowPixels.timestamps, [0, 200, 300, 600, 700]);
	assert.strictEqual(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
	console.log('PASS pixel-filter registry, still/animated preview, export parity, JPEG generations, preview setting, and export-setting persistence');
	await browser.close();
})().catch((error) => { console.error('FAIL', error.stack || error.message); process.exit(1); });
