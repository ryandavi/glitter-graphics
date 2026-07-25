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
		await page.waitForFunction(() => Boolean(window.editor));
		const result = await page.evaluate(async () => {
			await window.editor.textGlitterManager.loadFontsManifest();
			return {
				fonts: window.editor.textGlitterManager.fontManifest.length,
				fontTagGroups: window.editor.textGlitterManager.fontTagGroups.length,
				fillShapes: ShapeLibrary.FILL_SHAPES.length,
				brushShapes: ShapeLibrary.BRUSH_SHAPES.length,
				maskEditorBrushShapes: MaskEditor.BRUSH_SHAPES.length,
				shapeCards: document.querySelectorAll('.shape-gallery-option').length,
				brushCards: document.querySelectorAll('#brushShapePicker .brush-shape-option').length
			};
		});

		assert(result.fonts === 25, `Expected 25 fonts, got ${result.fonts}`);
		assert(result.fontTagGroups === 4, `Expected 4 font tag groups, got ${result.fontTagGroups}`);
		assert(result.fillShapes === 24, `Expected 24 fill shapes, got ${result.fillShapes}`);
		assert(result.brushShapes === 5, `Expected 5 brush shapes, got ${result.brushShapes}`);
		assert(result.maskEditorBrushShapes === result.brushShapes, 'MaskEditor brush alias is stale');
		assert(result.shapeCards === result.fillShapes, 'Shape gallery does not match the manifest');
		assert(result.brushCards === result.brushShapes, 'Brush gallery does not match the manifest');
		console.log('PASS editor font and shape galleries use their canonical manifests');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
