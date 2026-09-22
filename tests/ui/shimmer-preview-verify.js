'use strict';

const assert = require('assert');
const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

async function main() {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
	try {
		await page.goto(APP_URL, { waitUntil: 'networkidle' });
		await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach((node) => node.classList.remove('visible')));
		await page.evaluate(() => window.editor.loadBlankImage(96, 96, '#ffffff'));
		await page.waitForFunction(() => Boolean(window.editor?.originalImage) && window.editor.previewCanvas?.width === 96);
		await page.evaluate(() => {
			const editor = window.editor;
			const layer = editor.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
			const background = editor.baseBackgroundManager.normalizeLayer(layer).background;
			background.mode = 'gradient';
			background.gradient = {
				type: 'linear', angle: 0, interpolation: 'linear',
				stops: [{ offset: 0, color: '#000000', alpha: 1 }, { offset: 1, color: '#ffffff', alpha: 1 }]
			};
			background.pixelEffects = GlitterPixelEffects.normalizeSettings({
				...background.pixelEffects,
				paletteEnabled: true,
				paletteMode: 'dither',
				dither: { ...background.pixelEffects.dither, algorithm: 'halftone', palette: 'bw', strength: 100, shimmer: true }
			}, CONFIG.tools.pixelEffects);
			editor.baseBackgroundManager.invalidatePixelEffects();
			editor.updatePreview();
		});
		await page.waitForFunction(() => window.editor.baseBackgroundManager.shimmerPreview.frameIndex > 0);
		const halftoneAnimation = await page.evaluate(() => CONFIG.tools.pixelEffects.animation.algorithms.halftone);
		assert.deepStrictEqual(halftoneAnimation, { frames: 16, offsetPerFrame: 0.5 }, 'Halftone uses the smooth sixteen-phase loop');
		const first = await page.evaluate(() => ({
			frame: window.editor.baseBackgroundManager.shimmerPreview.frameIndex,
			pixels: [...window.editor.previewCtx.getImageData(0, 0, 96, 96).data]
		}));
		await page.waitForFunction((frame) => window.editor.baseBackgroundManager.shimmerPreview.frameIndex !== frame, first.frame);
		const second = await page.evaluate(() => [...window.editor.previewCtx.getImageData(0, 0, 96, 96).data]);
		assert.notDeepStrictEqual(first.pixels, second, 'the preview canvas advances through distinct Shimmer phases');

		await page.evaluate(() => {
			const manager = window.editor.baseBackgroundManager;
			const layer = window.editor.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
			layer.background.pixelEffects.dither.shimmer = false;
			manager.invalidatePixelEffects();
			window.editor.updatePreview();
		});
		await page.waitForTimeout(250);
		const stopped = await page.evaluate(() => ({
			key: window.editor.baseBackgroundManager.shimmerPreview.key,
			pending: window.editor.baseBackgroundManager.shimmerPreview.pending
		}));
		assert.deepStrictEqual(stopped, { key: null, pending: false }, 'turning Shimmer off stops and clears the preview session');
		console.log('shimmer preview browser checks passed');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
