'use strict';

// Export Size and fitting an export under a size target, in the real app:
// the resampled output, the fit loop for stills and an animated GIF, the Fit
// button in Export Ready, and the Target Size setting.

const { chromium } = require('playwright');
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) { if (!condition) throw new Error(message); }

// Exports and resolves with what Export Ready was given.
async function captureExport(page, targetId, { overrides = {}, fit = null } = {}) {
	return page.evaluate(async ({ targetId, overrides, fit }) => {
		const editor = window.editor;
		setActiveExportTarget(editor.exportSettings, targetId);
		Object.assign(editor.exportSettings, overrides);
		const stored = JSON.stringify(editor.exportSettings);
		const originalShow = editor.exportResultPresenter.show.bind(editor.exportResultPresenter);
		const payload = await new Promise((resolve, reject) => {
			setTimeout(() => reject(new Error(`${targetId} export timed out`)), 120000);
			editor.exportResultPresenter.show = (result) => { editor.exportResultPresenter.show = originalShow; originalShow(result); resolve(result); };
			editor.exportCurrentTarget({ fit });
		});
		const bitmap = payload.target.isVideo ? null : await createImageBitmap(payload.blob);
		return {
			size: payload.blob.size,
			width: payload.width,
			height: payload.height,
			decoded: bitmap ? [bitmap.width, bitmap.height] : null,
			fit: payload.fit,
			settingsUnchanged: stored === JSON.stringify(editor.exportSettings),
			notices: [...document.querySelectorAll('#exportNotices .property-note')].map((note) => note.textContent),
			fitButtons: [...document.querySelectorAll('#exportSizeWarningList .export-limit-fit')].filter((button) => !button.hidden).length,
			detailTitles: [...document.querySelectorAll('#exportDetailsView .property-group-label')].map((label) => label.textContent)
		};
	}, { targetId, overrides, fit });
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	await context.addInitScript(() => { localStorage.clear(); localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'); });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor?.settingsStore);
	await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach((modal) => modal.classList.remove('visible')));

	// A noisy base image, so file size responds to colors and dimensions.
	await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 240; canvas.height = 160;
		const ctx = canvas.getContext('2d');
		const image = ctx.createImageData(240, 160);
		let seed = 7;
		for (let index = 0; index < image.data.length; index += 4) {
			for (let channel = 0; channel < 3; channel++) {
				seed = (seed * 1664525 + 1013904223) >>> 0;
				image.data[index + channel] = (seed >>> 24) * 0.5 + ((index / 4) % 240) * 0.5;
			}
			image.data[index + 3] = 255;
		}
		ctx.putImageData(image, 0, 0);
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
		await window.editor.loadImageFromBlob(blob, { fileName: 'noise.png' });
		// Glitter over the left half makes the animated export a real animation.
		const editor = window.editor;
		const layer = editor.layerManager.addLayer(LayerType.GLITTER_FILL);
		const paint = editor.paintMaskStore.ensurePaintMask(layer.id);
		const paintCtx = paint.add.getContext('2d');
		paintCtx.fillStyle = '#fff';
		paintCtx.fillRect(0, 0, 120, 160);
		editor.paintMaskStore.commitPaintState(layer);
		editor.requestPreviewUpdate();
		editor.updateExportActionUI();
	});

	// Export Size resamples the output; the document keeps its size.
	const full = await captureExport(page, 'still:png');
	assert(full.width === 240 && full.decoded.join() === '240,160' && !full.fit, `Full-size PNG was ${full.decoded}`);
	const half = await captureExport(page, 'still:png', { overrides: { outputScale: 50 } });
	assert(half.width === 120 && half.height === 80 && half.decoded.join() === '120,80', `Half-size PNG was ${half.decoded}`);
	assert(half.size < full.size, 'A half-size PNG was not smaller');
	assert(await page.evaluate(() => window.editor.originalCanvas.width) === 240, 'Export Size changed the document');
	console.log('PASS Export Size resamples the export and leaves the document alone');

	// A still fit: the only PNG lever is size.
	const pngFit = await captureExport(page, 'still:png', { overrides: { outputScale: 100 }, fit: { label: 'the test limit', limitBytes: Math.round(full.size * 0.5) } });
	assert(pngFit.fit?.reached && pngFit.size <= full.size * 0.5, `PNG fit ended at ${pngFit.size} of ${full.size}`);
	assert(pngFit.width < 240 && pngFit.fit.changes.includes('% size'), `PNG fit changes: ${pngFit.fit?.changes}`);
	assert(pngFit.settingsUnchanged, 'A fit wrote to the stored export settings');
	assert(pngFit.notices.some((text) => text.startsWith('Fitted under the test limit')), `Fit notice missing: ${pngFit.notices}`);
	console.log(`PASS PNG fit: ${pngFit.fit.changes} in ${pngFit.fit.attempts.length} exports`);

	// JPG lowers quality before size.
	const jpg = await captureExport(page, 'still:jpeg');
	const jpgFit = await captureExport(page, 'still:jpeg', { fit: { label: 'the test limit', limitBytes: Math.round(jpg.size * 0.75) } });
	assert(jpgFit.fit?.reached && jpgFit.fit.changes.includes('JPG quality') && jpgFit.width === 240, `JPG fit changes: ${jpgFit.fit?.changes}`);
	console.log(`PASS JPG fit: ${jpgFit.fit.changes}`);

	// An animated GIF fit, with the Details table.
	const gif = await captureExport(page, 'animation:gif');
	const gifFit = await captureExport(page, 'animation:gif', { fit: { label: 'the test limit', limitBytes: Math.round(gif.size * 0.45) } });
	assert(gifFit.fit?.reached && gifFit.size <= gif.size * 0.45, `GIF fit ended at ${gifFit.size} of ${gif.size}: ${JSON.stringify(gifFit.fit?.attempts)}`);
	assert(gifFit.detailTitles.includes('Fit under the test limit'), `Details tables: ${gifFit.detailTitles}`);
	assert(gifFit.settingsUnchanged, 'A GIF fit wrote to the stored export settings');
	console.log(`PASS GIF fit: ${gifFit.fit.changes} in ${gifFit.fit.attempts.length} exports`);

	// A limit nothing can reach keeps the smallest attempt and says so.
	const missed = await captureExport(page, 'still:png', { fit: { label: 'the test limit', limitBytes: 200 } });
	assert(missed.fit && !missed.fit.reached && missed.notices.some((text) => text.startsWith('Could not fit')), 'An unreachable limit was not reported as a miss');
	console.log('PASS An unreachable limit reports the smallest version');

	// The Target Size setting runs the same fit on every export.
	const standing = await captureExport(page, 'still:png', { overrides: { targetSize: 'custom', targetSizeKB: Math.max(10, Math.round(full.size * 0.6 / 1024)) } });
	assert(standing.fit?.reached && standing.width < 240, `Target Size did not fit the export: ${JSON.stringify(standing.fit)}`);
	const roomy = await captureExport(page, 'still:png', { overrides: { targetSize: 'discord' } });
	assert(!roomy.fit && roomy.width === 240, 'An export already under its target was changed');
	console.log('PASS Target Size fits only an export that is over it');

	// Settings rows.
	const rows = await page.evaluate(() => {
		const editor = window.editor;
		editor.modalManager.close('exportPreviewModal');
		editor.modalManager.open('exportSettingsModal');
		const select = document.getElementById('exportTargetSize');
		const row = document.getElementById('exportTargetSizeKBRow');
		const state = () => row.classList.contains('disabled') || row.classList.contains('is-inactive') || document.getElementById('exportTargetSizeKB').disabled;
		select.value = 'none'; select.dispatchEvent(new Event('change', { bubbles: true }));
		const inactive = state();
		select.value = 'custom'; select.dispatchEvent(new Event('change', { bubbles: true }));
		return { inactive, active: !state(), options: select.options.length, scale: Boolean(document.getElementById('exportOutputScale')) };
	});
	assert(rows.scale && rows.options >= 9 && rows.inactive && rows.active, `Settings rows: ${JSON.stringify(rows)}`);
	console.log('PASS Export Size and Target Size rows');

	// The Fit button on a "Too large to post on" row.
	const button = await page.evaluate(() => {
		const editor = window.editor;
		let asked = null;
		const presenter = new ExportResultPresenter({ onFit: (goal) => { asked = goal; } });
		presenter._renderUploadLimits(resolveUploadLimits(8 * 1024 * 1024, CONFIG.export.sizeTargets), null);
		const first = document.querySelector('#exportSizeWarningList .export-limit-fit');
		first.click();
		presenter._renderUploadLimits(resolveUploadLimits(8 * 1024 * 1024, CONFIG.export.sizeTargets), { label: asked.label });
		return { asked, hiddenAfterMiss: document.querySelector('#exportSizeWarningList .export-limit-fit').hidden, wired: typeof editor.exportResultPresenter.onFit === 'function' };
	});
	assert(button.asked?.limitBytes === 5 * 1024 * 1024 && button.hiddenAfterMiss && button.wired, `Fit button: ${JSON.stringify(button)}`);
	console.log('PASS Fit button asks for its row\'s limit');

	assert(errors.length === 0, `Page errors: ${errors.join(' | ')}`);
	await browser.close();
	console.log('\nExport fit verification passed');
})().catch((error) => { console.error(`FAIL ${error.message}`); process.exit(1); });
