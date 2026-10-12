'use strict';

const { openApp } = require('../lib/app');


function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const { browser, page, errors } = await openApp({ viewport: { width: 1200, height: 900 } });
	try {
		const result = await page.evaluate(async () => {
			await FontLibrary.loadManifest();
			for (const manager of [editor.shapeBrowserManager, editor.fontBrowserManager]) {
				manager.browser.ensureView();
				manager.handleSearch(' ');
				manager.browser.renderSearchResults();
				manager.browser.loadListingItems(Infinity);
			}
			const [fontsManifest, shapesManifest] = await Promise.all([
				fetch(`${CONFIG.tools.text.fontsManifest}?v=${CONFIG.app.assets.manifestVersion}`).then(response => response.json()),
				ShapeLibrary.loadManifest()
			]);
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
				expected: {
					fonts: fontsManifest.fonts.length, fontTagGroups: fontsManifest.tagGroups.length,
					fillShapes: shapesManifest.shapes.filter(shape => shape.uses.includes('shape')).length,
					fillShapeCategories: shapesManifest.categories.length,
					brushShapes: shapesManifest.shapes.filter(shape => shape.uses.includes('brush')).length,
					normalizedShapes: shapesManifest.shapes.filter(shape => shape.sourceBounds).length
				},
				fonts: FontLibrary.fonts.length,
				fontTagGroups: FontLibrary.tagGroups.length,
				fillShapes: ShapeLibrary.FILL_SHAPES.length,
				fillShapeCategories: ShapeLibrary.FILL_SHAPE_CATEGORIES.length,
				brushShapes: ShapeLibrary.BRUSH_SHAPES.length,
				maskEditorBrushShapes: MaskEditor.BRUSH_SHAPES.length,
				shapeCards: editor.shapeBrowserManager.browser.elements.searchResults.querySelectorAll('.shape-gallery-option').length,
				fontCards: editor.fontBrowserManager.browser.elements.searchResults.querySelectorAll('.text-font-option').length,
				brushTips: window.editor.brushTipManager.content.length,
				rasterBrushes: Object.keys(BrushLibrary.BRUSHES).length,
				normalizedShapes
			};
		});

		for (const key of ['fonts', 'fontTagGroups', 'fillShapes', 'fillShapeCategories', 'brushShapes']) {
			assert(result[key] === result.expected[key], `${key} differs from loaded manifest: ${result[key]} vs ${result.expected[key]}`);
		}
		assert(result.maskEditorBrushShapes === result.brushShapes, 'MaskEditor brush alias is stale');
		assert(result.shapeCards === result.fillShapes, 'Shape gallery does not match the manifest');
		assert(result.fontCards === result.fonts, 'Font Library does not match the manifest');
		assert(result.brushTips === result.brushShapes + result.rasterBrushes, 'Brush gallery does not match its vector and raster manifests');
		assert(result.normalizedShapes.length === result.expected.normalizedShapes, `Normalized supplied shapes differ from manifest, got ${result.normalizedShapes.length}`);
		result.normalizedShapes.forEach(({ id, bounds }) => {
			assert(bounds.minX >= 0.75 && bounds.minY >= 0.75, `${id} extends above or left of its 24x24 viewBox`);
			assert(bounds.maxX <= 23.25 && bounds.maxY <= 23.25, `${id} extends below or right of its 24x24 viewBox`);
			assert(bounds.maxX - bounds.minX > 0.5 && bounds.maxY - bounds.minY > 0.5, `${id} rendered empty`);
		});
		result.normalizedShapes.forEach(({ id, sourceAspect, naturalAspect, wideFrameAspect }) => {
			assert(Math.abs((naturalAspect / sourceAspect) - 1) < 0.000001, `${id} natural aspect differs from its SVG bounds`);
			assert(Math.abs((wideFrameAspect / sourceAspect) - 1) < 0.03, `${id} is distorted in a non-square layer frame`);
		});
		assert(errors.length === 0, errors.join('; '));
		console.log('PASS editor font and shape galleries use their canonical manifests');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
