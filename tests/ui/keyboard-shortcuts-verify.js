'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
		await page.goto(APP_URL, { waitUntil: 'networkidle' });
		await page.evaluate(async () => {
			document.querySelectorAll('.modal-overlay.visible').forEach((node) => node.classList.remove('visible'));
			await editor.loadBlankImage(320, 240, '#ffffff');
			editor.setTool(ToolType.HAND);
		});
		await page.keyboard.press('Control+V');
		assert(await page.evaluate(() => editor.currentTool === ToolType.HAND), 'Ctrl+V hijacked the active tool');
		await page.keyboard.press('Control+B');
		assert(await page.evaluate(() => editor.currentTool === ToolType.HAND), 'Ctrl+B hijacked the active tool');
		await page.keyboard.press('v');
		assert(await page.evaluate(() => editor.currentTool === ToolType.SELECT), 'V did not activate the Select tool');
		await page.waitForFunction(() => editor.originalImage != null);
		await page.evaluate(() => {
			editor.layerManager.addLayer(LayerType.SHAPE, { shapeLayer: { shapeId: 'rounderHeart' } });
			editor.shapeGlitterManager.updatePickerStrip();
		});
		assert(await page.locator('#galleryPickerStripTitle').textContent() === 'Choosing shape', 'Shapes library showed the glitter hint');
		await page.evaluate(() => editor.shapeGlitterManager.armShapeAssetPicker());
		assert(await page.locator('#designGallerySection').getAttribute('data-library') === 'shape', 'Shape picker showed the wrong library');
		await page.evaluate(() => {
			const range = document.createRange();
			range.selectNodeContents(document.getElementById('galleryPickerStripTitle'));
			window.getSelection().removeAllRanges();
			window.getSelection().addRange(range);
			window.__glitterLayerClipboard = null;
		});
		await page.keyboard.press('Control+c');
		assert(await page.evaluate(() => window.__glitterLayerClipboard === null), 'Copying highlighted page text copied layers');
		await page.evaluate(() => window.getSelection().removeAllRanges());
		await page.keyboard.press('Control+c');
		await page.waitForFunction(() => window.__glitterLayerClipboard != null);
		assert(await page.evaluate(() => JSON.parse(window.__glitterLayerClipboard).kind === 'glitter-layers'), 'Ctrl+C without highlighted text did not copy layers');
		await page.evaluate(() => editor.shapeGlitterManager.armPicker('fill'));
		assert(await page.locator('#galleryPickerStripTitle').textContent() === 'Choosing fill glitter', 'Fill picker lost its glitter label');
		assert(await page.locator('#designGallerySection').getAttribute('data-library') === 'glitter', 'Fill picker showed the wrong library');
		for (const width of [1200, 390]) {
			await page.setViewportSize({ width, height: 900 });
			await page.evaluate(() => {
				editor.setTool(ToolType.TEXT);
				editor.shapeGlitterManager.armPicker('border');
				document.activeElement.blur();
				window.auditSelected = editor.activeLayerId;
			});
			await page.keyboard.press('Escape');
			assert(await page.evaluate(() => !editor.pickers.active && editor.currentTool === ToolType.TEXT && editor.activeLayerId === window.auditSelected), `${width}: picker Escape changed tool or selection`);
			await page.keyboard.press('Escape');
			assert(await page.evaluate(() => editor.currentTool === ToolType.TEXT && editor.layerManager.getSelectedLayers().length === 0), `${width}: deselection changed tool`);
			assert(await page.evaluate(async () => {
				const item = editor.glitterLibrary.getAllContent().find(item => item.category === 'sparkle');
				const before = JSON.stringify(editor.layerManager.getBaseLayer().background);
				await editor.glitterLibrary.selectGlitter(item.id);
				return JSON.stringify(editor.layerManager.getBaseLayer().background) === before && editor.activeLayerId === null;
			}), `${width}: a glitter pick with nothing selected changed the background`);
			await page.evaluate(() => {
				editor.layerManager.setActiveLayer(window.auditSelected);
				editor.shapeGlitterManager.armPicker('fill');
				window.auditDoneCalls = 0;
				const manager = editor.shapeGlitterManager;
				const done = manager.handlePickerDone.bind(manager);
				manager.handlePickerDone = () => { window.auditDoneCalls++; done(); };
				document.getElementById('galleryPickerStripDone').click();
				manager.handlePickerDone = done;
			});
			assert(await page.evaluate(() => window.auditDoneCalls === 1 && !editor.pickers.active), `${width}: Done ran more than once`);
		}
		await page.setViewportSize({ width: 1200, height: 900 });
		await page.evaluate(() => {
			const layer = editor.layerManager.addLayer(LayerType.TEXT_GLITTER);
			editor.setTool(ToolType.TEXT);
			editor.textGlitterManager.beginTextEdit(layer, { focus: false });
			window.auditTextSession = editor.textGlitterManager.editSession;
			document.activeElement.blur();
		});
		await page.keyboard.down('Space');
		assert(await page.evaluate(() => editor.currentTool === ToolType.HAND && editor.textGlitterManager.editSession === window.auditTextSession), 'Temporary Hand ended the text session');
		await page.keyboard.up('Space');
		assert(await page.evaluate(() => editor.currentTool === ToolType.TEXT && editor.textGlitterManager.editSession === window.auditTextSession), 'Temporary Hand did not resume the text session');
		await page.evaluate(() => editor.setTool(ToolType.HAND));
		assert(await page.evaluate(() => !editor.textGlitterManager.editSession), 'Ordinary tool change did not end the text session');
		process.stdout.write('PASS shortcut dispatch requires exact modifiers\n');
		process.stdout.write('PASS shape picker labels and text/layer copy priority\n');
		process.stdout.write('PASS desktop/mobile single-owner Done, Escape tool preservation and no pick without a selection\n');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	process.stderr.write(`${error.stack || error.message}\n`);
	process.exit(1);
});
