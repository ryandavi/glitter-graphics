'use strict';

const assert = require('assert');
const { chromium } = require('playwright');
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(APP_URL, { waitUntil: 'networkidle' });
		await page.evaluate(async () => {
			editor.modalManager.closeAll();
			await editor.loadBlankImage(160, 120, '#ffffff');
		});
		assert(await page.evaluate(() => {
			const e = editor, mask = e.maskEditor;
			e.layerManager.clearSelection();
			e.setTool(ToolType.BRUSH);
			const count = e.layers.length;
			if (!mask.isEditing || count !== 1) return false;
			const rect = e.previewWrapper.getBoundingClientRect();
			const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
			if (!mask._startStrokeFromScreenPoint(x, y)) return false;
			mask._finishStroke();
			const fill = e.layerManager.getActiveLayer();
			if (fill.type !== LayerType.GLITTER_FILL || e.layers.length !== count + 1 || !hasMaskContent(fill)) return false;
			e.layerManager.clearSelection();
			if (!mask._startStrokeFromScreenPoint(x, y) || e.activeLayerId !== fill.id || e.layers.length !== count + 1) return false;
			mask._cancelStroke();
			e.layerManager.clearSelection();
			mask.setMode('sub');
			const noHit = e.viewport.screenToCanvas(rect.left + 1, rect.top + 1);
			return !e.resolveFillLayer(noHit.x, noHit.y, { create: false }) && e.layers.length === count + 1;
		}), 'Brush did not defer creation, reuse the fill under the pointer, or preserve empty eraser behavior');
		assert(await page.evaluate(() => {
			PREFERENCES.set('libraryFavorites', { glitter: [111] });
			PREFERENCES.set('showHints', false);
			editor.interfaceTheme = 'light'; editor.applyInterfaceTheme();
			setPanelWidth('layers', 400);
			editor.maskEditor.brushDynamics = { round: { scatter: 99 } };
			editor.maskEditor._saveBrushDynamics();
			editor.setTool(ToolType.HAND);
			resetStoredSettings(editor);
			window.auditStores = Object.fromEntries(Object.values(STORAGE_KEYS).map(({ key }) => [key, readStored(key, null)]));
			return PREFERENCES.get('showHints') === PREFERENCE_SCHEMA.showHints.default()
				&& PREFERENCES.get('libraryFavorites').glitter[0] === 111
				&& editor.interfaceTheme === 'dark' && Object.keys(editor.maskEditor.brushDynamics).length === 0
				&& Object.keys(readPanelWidths()).length === 0 && !document.documentElement.style.getPropertyValue('--layer-panel-width')
				&& editor.currentTool === CONFIG.app.startup.tool;
		}), 'Reset Everything missed a registered store or erased the Library collection');
		const stores = await page.evaluate(() => window.auditStores);
		await page.reload({ waitUntil: 'networkidle' });
		const changes = await page.evaluate(expected => Object.entries(expected).flatMap(([key, value]) => {
			const actual = readStored(key, null);
			if (key === STORAGE_KEYS.preferences.key) delete actual.welcomeLastSeenRelease;
			return JSON.stringify(actual) === JSON.stringify(value) ? [] : [{ key, expected: value, actual }];
		}), stores);
		assert.deepStrictEqual(changes, [], `Reset stores did not persist through reload: ${JSON.stringify(changes)}`);
		assert(await page.evaluate(() => {
			localStorage.setItem(STORAGE_KEYS.brushSettings.key, '{broken');
			localStorage.setItem(STORAGE_KEYS.preferences.key, 'null');
			return Object.keys(readStored(STORAGE_KEYS.preferences.key, {})).length === 0
				&& Object.keys(readStored(STORAGE_KEYS.brushSettings.key, {})).length === 0;
		}), 'Corrupt storage did not fall back safely');
		assert.deepStrictEqual(errors, []);
		console.log('PASS Brush first-stroke creation and hit resolution; every settings store resets and survives reload without clearing collections');
	} finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
