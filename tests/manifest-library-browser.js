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
			const normalizedShapes = Object.entries(ShapeLibrary.DEFS)
				.filter(([, definition]) => definition.sourceBounds)
				.map(([id, definition]) => {
					const canvas = document.createElement('canvas');
					canvas.width = 520;
					canvas.height = 280;
					const context = canvas.getContext('2d', { willReadFrequently: true });
					context.translate(260, 140);
					context.fillStyle = '#000';
					ShapeLibrary.trace(id, context, 240, 120, { fit: 'fill' });
					const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
					let minX = canvas.width;
					let minY = canvas.height;
					let maxX = -1;
					let maxY = -1;
					for (let y = 0; y < canvas.height; y++) {
						for (let x = 0; x < canvas.width; x++) {
							if (pixels[((y * canvas.width) + x) * 4 + 3] === 0) continue;
							minX = Math.min(minX, x);
							minY = Math.min(minY, y);
							maxX = Math.max(maxX, x);
							maxY = Math.max(maxY, y);
						}
					}
					return {
						id,
						bounds: ShapeLibrary._geometry(id).bounds,
						sourceAspect: definition.sourceBounds[2] / definition.sourceBounds[3],
						naturalAspect: ShapeLibrary.getAspect(id),
						wideFrameAspect: (maxX - minX + 1) / (maxY - minY + 1)
					};
				});
			return {
				fonts: window.editor.textGlitterManager.fontManifest.length,
				fontTagGroups: window.editor.textGlitterManager.fontTagGroups.length,
				fillShapes: ShapeLibrary.FILL_SHAPES.length,
				fillShapeCategories: ShapeLibrary.FILL_SHAPE_CATEGORIES.length,
				brushShapes: ShapeLibrary.BRUSH_SHAPES.length,
				maskEditorBrushShapes: MaskEditor.BRUSH_SHAPES.length,
				shapeCards: document.querySelectorAll('.shape-gallery-option').length,
				brushCards: document.querySelectorAll('#brushShapePicker .brush-shape-option').length,
				normalizedShapes
			};
		});

		assert(result.fonts === 25, `Expected 25 fonts, got ${result.fonts}`);
		assert(result.fontTagGroups === 4, `Expected 4 font tag groups, got ${result.fontTagGroups}`);
		assert(result.fillShapes === 40, `Expected 40 fill shapes, got ${result.fillShapes}`);
		assert(result.fillShapeCategories === 7, `Expected 7 fill-shape categories, got ${result.fillShapeCategories}`);
		assert(result.brushShapes === 5, `Expected 5 brush shapes, got ${result.brushShapes}`);
		assert(result.maskEditorBrushShapes === result.brushShapes, 'MaskEditor brush alias is stale');
		assert(result.shapeCards === result.fillShapes, 'Shape gallery does not match the manifest');
		assert(result.brushCards === result.brushShapes, 'Brush gallery does not match the manifest');
		assert(result.normalizedShapes.length === 21, `Expected 21 normalized supplied shapes, got ${result.normalizedShapes.length}`);
		result.normalizedShapes.forEach(({ id, bounds }) => {
			assert(bounds.minX >= 0.75 && bounds.minY >= 0.75, `${id} extends above or left of its 24x24 viewBox`);
			assert(bounds.maxX <= 23.25 && bounds.maxY <= 23.25, `${id} extends below or right of its 24x24 viewBox`);
			assert(bounds.maxX - bounds.minX > 0.5 && bounds.maxY - bounds.minY > 0.5, `${id} rendered empty`);
		});
		result.normalizedShapes.forEach(({ id, sourceAspect, naturalAspect, wideFrameAspect }) => {
			assert(Math.abs((naturalAspect / sourceAspect) - 1) < 0.000001, `${id} natural aspect differs from its SVG bounds`);
			assert(Math.abs((wideFrameAspect / sourceAspect) - 1) < 0.03, `${id} is distorted in a non-square layer frame`);
		});
		console.log('PASS editor font and shape galleries use their canonical manifests');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
