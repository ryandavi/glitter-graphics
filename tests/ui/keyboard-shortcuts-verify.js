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
		process.stdout.write('PASS shortcut dispatch requires exact modifiers\n');
		process.stdout.write('PASS shape picker labels and text/layer copy priority\n');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	process.stderr.write(`${error.stack || error.message}\n`);
	process.exit(1);
});
