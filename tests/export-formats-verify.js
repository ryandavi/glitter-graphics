'use strict';

const { chromium } = require('playwright');
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) { if (!condition) throw new Error(message); }

async function captureExport(page, targetId, overrides = {}) {
	return page.evaluate(async ({ targetId, overrides }) => {
		const editor = window.editor;
		setActiveExportTarget(editor.exportSettings, targetId);
		Object.assign(editor.exportSettings, overrides);
		let resolveResult;
		const result = new Promise((resolve) => { resolveResult = resolve; });
		const originalShow = editor.exportResultPresenter.show.bind(editor.exportResultPresenter);
		editor.exportResultPresenter.show = (payload) => {
			editor.exportResultPresenter.show = originalShow;
			resolveResult({ type: payload.blob.type, size: payload.blob.size, name: payload.file.name, target: payload.target.id });
		};
		editor.exportCurrentTarget();
		return Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error('Still export timed out')), 20000))]);
	}, { targetId, overrides });
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

	const initial = await page.evaluate(() => ({
		mainDisabled: document.getElementById('exportGif').disabled,
		menuDisabled: document.getElementById('exportMenuBtn').disabled,
		quickDisabled: [...document.querySelectorAll('[data-export-target]')].every((item) => item.disabled),
		settingsDisabled: document.getElementById('exportSettingsMenuItem').disabled,
		legacyGif: new SettingsStore(EXPORT_SETTINGS_SCHEMA).load({ exportFormat: 'gif' }),
		legacyMp4: new SettingsStore(EXPORT_SETTINGS_SCHEMA).load({ exportFormat: 'mp4' })
	}));
	assert(initial.mainDisabled && !initial.menuDisabled && initial.quickDisabled && !initial.settingsDisabled, 'No-document split-control state is inconsistent');
	assert(initial.legacyGif.outputMode === 'animation' && initial.legacyGif.animationFormat === 'gif' && initial.legacyGif.stillFormat === 'png', 'Legacy GIF migration failed');
	assert(initial.legacyMp4.outputMode === 'animation' && initial.legacyMp4.animationFormat === 'mp4', 'Legacy MP4 migration failed');
	await page.evaluate(() => document.getElementById('exportMenuBtn').click());
	assert(await page.getAttribute('#exportMenuBtn', 'aria-expanded') === 'true', 'Export menu did not expose open state');
	assert(await page.evaluate(() => document.activeElement?.id === 'exportSettingsMenuItem'), 'Disabled quick commands were not skipped by menu focus');
	await page.keyboard.press('Escape');
	assert(await page.evaluate(() => document.activeElement?.id === 'exportMenuBtn'), 'Escape did not restore export-menu focus');
	await page.evaluate(() => document.getElementById('exportMenuBtn').click());
	await page.evaluate(() => document.getElementById('exportSettingsMenuItem').click());
	assert(await page.locator('#exportSettingsModal.visible').count() === 1, 'Export Settings was not reachable without a document');
	await page.click('#closeExportSettingsModal');

	await page.evaluate(() => window.editor.loadBlankImage(48, 32, '#ff6699'));
	await page.waitForFunction(() => window.editor.originalImage != null);
	await page.evaluate(() => window.editor.updateExportActionUI());
	await page.evaluate(() => window.editor.modalManager.open('exportSettingsModal'));
	await page.click('#exportModeControl [data-export-mode="still"]');
	await page.click('#exportFormatControl [data-export-mode="still"][data-export-format="jpeg"]');
	assert(await page.getAttribute('#exportGif', 'aria-label') === 'Export JPG', 'Modal target did not synchronize the main action');
	assert(await page.locator('#exportJpegQualityRow:not([hidden])').count() === 1 && await page.locator('#exportSettingsGroups .settings-group:has-text("Playback"):not([hidden])').count() === 0, 'JPG capability visibility is incorrect');
	await page.click('#closeExportSettingsModal');
	const png = await captureExport(page, 'still:png', { transparency: true });
	assert(png.type === 'image/png' && png.name.endsWith('.png') && png.size > 0, `PNG contract failed: ${JSON.stringify(png)}`);

	await page.evaluate(() => {
		window.__jpegEncodes = 0;
		const original = HTMLCanvasElement.prototype.toBlob;
		HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
			if (type === 'image/jpeg') window.__jpegEncodes++;
			return original.call(this, callback, type, quality);
		};
	});
	const jpg = await captureExport(page, 'still:jpeg', { jpegQuality: 72, jpegGenerations: 3, matteColor: '#123456' });
	const jpegEncodes = await page.evaluate(() => window.__jpegEncodes);
	assert(jpg.type === 'image/jpeg' && jpg.name.endsWith('.jpg') && jpegEncodes === 3, `JPG generations failed: ${JSON.stringify({ jpg, jpegEncodes })}`);

	const stillGif = await captureExport(page, 'still:gif', { transparency: false, ditherEnabled: false });
	assert(stillGif.type === 'image/gif' && stillGif.name.endsWith('.gif'), `Still GIF contract failed: ${JSON.stringify(stillGif)}`);
	assert(await page.evaluate(() => !window.editor.exportInProgress), 'Export concurrency guard did not clear');
	assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
	console.log('PASS Export target migration, split-control state, PNG, JPG generations, and still GIF');
	await browser.close();
})().catch((error) => { console.error('FAIL', error.message); process.exit(1); });
