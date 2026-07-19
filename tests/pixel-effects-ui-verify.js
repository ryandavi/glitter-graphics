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
		await page.waitForFunction(() => Boolean(window.editor?.originalImage));
		await page.evaluate(() => {
			const base = window.editor.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
			window.editor.layerManager.setActiveLayer(base.id);
		});

		const structure = await page.evaluate(() => {
			const effects = document.querySelector('[data-panel-group="Effects"]');
			return {
				hasLegacyGroup: Boolean(document.querySelector('[data-panel-group="Palette Effects"]')),
				cards: [...effects.querySelectorAll(':scope > .subsection-content-group > .subsection-title > span:first-child')].map((node) => node.textContent),
				modeCount: document.querySelectorAll('#pixelEffectsPaletteMode > .segmented-option').length,
				styleCount: document.querySelectorAll('#pixelEffectsPaletteStyle > .segmented-option').length,
				algorithmTag: document.getElementById('pixelEffectsAlgorithm').tagName,
				paletteTag: document.getElementById('pixelEffectsDitherPalette').tagName,
				cleanupLabel: document.querySelector('#pixelEffectsPosterizeControls .advanced-disclosure-label').textContent,
				hasOuterToggle: Boolean(effects.querySelector(':scope > .subsection-title > .checkbox-group')),
				hasPixelateToggle: Boolean(document.getElementById('pixelEffectsPixelateEnabled')),
				hasPaletteToggle: Boolean(document.getElementById('pixelEffectsPaletteEnabled')),
				statusInHeader: document.getElementById('pixelEffectsStatus')?.parentElement === effects.querySelector(':scope > .subsection-title'),
				hasReset: Boolean(document.getElementById('resetPixelEffects')),
				textCaseTag: document.getElementById('textCaseSelect').tagName,
				ordinaryLongSegments: [...document.querySelectorAll('.design-panel .segmented-control')].filter((node) =>
					!node.classList.contains('paint-source-choice-grid') && node.querySelectorAll(':scope > .segmented-option').length > 3
				).length
			};
		});
		assert.strictEqual(structure.hasLegacyGroup, false);
		assert.deepStrictEqual(structure.cards, ['Pixelate', 'Palette']);
		assert.strictEqual(structure.modeCount, 2);
		assert.strictEqual(structure.styleCount, 3);
		assert.strictEqual(structure.algorithmTag, 'SELECT');
		assert.strictEqual(structure.paletteTag, 'SELECT');
		assert.strictEqual(structure.cleanupLabel, 'Cleanup');
		assert.strictEqual(structure.hasOuterToggle, false);
		assert.strictEqual(structure.hasPixelateToggle, true);
		assert.strictEqual(structure.hasPaletteToggle, true);
		assert.strictEqual(structure.statusInHeader, true);
		assert.strictEqual(structure.hasReset, true);
		assert.strictEqual(structure.textCaseTag, 'SELECT');
		assert.strictEqual(structure.ordinaryLongSegments, 0);

		await page.evaluate(() => {
			const toggle = document.getElementById('pixelEffectsPaletteEnabled');
			toggle.checked = true;
			toggle.dispatchEvent(new Event('change', { bubbles: true }));
			document.querySelector('#pixelEffectsPaletteMode [data-value="dither"]').click();
		});
		await page.evaluate(() => {
			const change = (id, value) => {
				const select = document.getElementById(id);
				select.value = value;
				select.dispatchEvent(new Event('change', { bubbles: true }));
			};
			change('pixelEffectsAlgorithm', 'halftone');
			change('pixelEffectsDitherPalette', 'duotone');
		});
		const dither = await page.evaluate(() => {
			const layer = window.editor.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
			return {
				settings: layer.background.pixelEffects,
				controlsHidden: document.getElementById('pixelEffectsDitherControls').hidden,
				duotoneHidden: document.getElementById('pixelEffectsDuotone').hidden
			};
		});
		assert.strictEqual(dither.settings.paletteMode, 'dither');
		assert.strictEqual(dither.settings.dither.algorithm, 'halftone');
		assert.strictEqual(dither.settings.dither.palette, 'duotone');
		assert.strictEqual(dither.controlsHidden, false);
		assert.strictEqual(dither.duotoneHidden, false);

		const bypassed = await page.evaluate(async () => {
			const pixelateToggle = document.getElementById('pixelEffectsPixelateEnabled');
			const paletteToggle = document.getElementById('pixelEffectsPaletteEnabled');
			pixelateToggle.checked = false;
			pixelateToggle.dispatchEvent(new Event('change', { bubbles: true }));
			paletteToggle.checked = false;
			paletteToggle.dispatchEvent(new Event('change', { bubbles: true }));
			const layer = window.editor.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
			const editor = window.editor;
			const background = editor.baseBackgroundManager.normalizeLayer(layer).background;
			background.mode = 'image';
			const width = editor.originalCanvas.width;
			const height = editor.originalCanvas.height;
			const source = editor.baseBackgroundManager.getBackgroundSourceImageData(background, width, height);
			const preview = editor.baseBackgroundManager.getPixelEffectImageData(source, width, height, background.pixelEffects, 3);
			const exported = editor.exporter._getBasePipelineImageData(layer, {
				width, height,
				originalData: new Uint8ClampedArray(editor.originalImageData.data),
				originalAlpha: editor.originalAlphaChannel,
				alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold
			}, 3);
			const restored = await editor.layerManager.deserializeLayer(editor.layerManager.serializeLayer(layer));
			return {
				settings: layer.background.pixelEffects,
				pixelateCollapsed: pixelateToggle.closest('[data-effect-card]').classList.contains('is-collapsed'),
				paletteCollapsed: paletteToggle.closest('[data-effect-card]').classList.contains('is-collapsed'),
				previewExportMatch: preview.data.every((value, index) => value === exported.data[index]),
				roundTripEnabled: [restored.background.pixelEffects.pixelateEnabled, restored.background.pixelEffects.paletteEnabled]
			};
		});
		assert.strictEqual(bypassed.settings.pixelateEnabled, false);
		assert.strictEqual(bypassed.settings.paletteEnabled, false);
		assert.strictEqual(bypassed.settings.dither.algorithm, 'halftone');
		assert.strictEqual(bypassed.settings.dither.palette, 'duotone');
		assert.strictEqual(bypassed.pixelateCollapsed, true);
		assert.strictEqual(bypassed.paletteCollapsed, true);
		assert.strictEqual(bypassed.previewExportMatch, true);
		assert.deepStrictEqual(bypassed.roundTripEnabled, [false, false]);
		await page.evaluate(() => {
			const toggle = document.getElementById('pixelEffectsPaletteEnabled');
			toggle.checked = true;
			toggle.dispatchEvent(new Event('change', { bubbles: true }));
		});

		await page.evaluate(() => document.querySelector('#pixelEffectsPaletteMode [data-value="posterize"]').click());
		const posterize = await page.evaluate(() => ({
			colorsHidden: document.getElementById('pixelEffectsPaletteControls').hidden,
			cleanupHidden: document.getElementById('pixelEffectsPosterizeControls').hidden,
			ditherHidden: document.getElementById('pixelEffectsDitherControls').hidden
		}));
		assert.deepStrictEqual(posterize, { colorsHidden: false, cleanupHidden: false, ditherHidden: true });

		const reset = await page.evaluate(() => {
			document.getElementById('resetPixelEffects').click();
			const layer = window.editor.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
			return layer.background.pixelEffects;
		});
		assert.strictEqual(reset.pixelateEnabled, false);
		assert.strictEqual(reset.paletteEnabled, false);
		assert.strictEqual(reset.pixelSize, 1);
		assert.strictEqual(reset.paletteMode, 'posterize');
		assert.strictEqual(reset.dither.algorithm, 'bayer');
		assert.strictEqual(reset.dither.shimmer, false);
		await page.evaluate(() => window.editor.undo());
		await page.waitForFunction(() => window.editor.layers.find((entry) => entry.type === LayerType.BASE_IMAGE)?.background.pixelEffects.paletteMode === 'posterize');

		const textLayerId = await page.evaluate(() => {
			const layer = window.editor.textGlitterManager.createLayer({ text: 'Case test' });
			window.editor.layerManager.insertLayer(layer);
			window.editor.layerManager.setActiveLayer(layer.id);
			const select = document.getElementById('textCaseSelect');
			select.value = 'upper';
			select.dispatchEvent(new Event('change', { bubbles: true }));
			return layer.id;
		});
		await page.waitForFunction((layerId) => window.editor.layers.find((layer) => layer.id === layerId)?.textData.textCase === 'upper', textLayerId);

		console.log('pixel effects UI checks passed');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
