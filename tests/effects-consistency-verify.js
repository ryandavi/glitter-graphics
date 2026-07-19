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
			window.changeEffectsToggle = (id, checked) => {
				const toggle = document.getElementById(id);
				toggle.checked = checked;
				toggle.dispatchEvent(new Event('change', { bubbles: true }));
			};
		});

		const canvasStructure = await page.evaluate(() => {
			const group = document.querySelector('#baseLayerSettingsContent [data-panel-group="Effects"]');
			const title = group.querySelector(':scope > .subsection-title');
			return {
				outerToggle: Boolean(title.querySelector('.checkbox-group')),
				statusInHeader: document.getElementById('pixelEffectsStatus').parentElement === title,
				statusBeforeChevron: document.getElementById('pixelEffectsStatus').nextElementSibling?.classList.contains('panel-group-chevron'),
				cardToggles: ['pixelEffectsPixelateEnabled', 'pixelEffectsPaletteEnabled'].every((id) => {
					const toggle = document.getElementById(id);
					return toggle?.matches('[data-effect-toggle]') && Boolean(toggle.closest('[data-effect-card]'));
				}),
				sharedEffectCardCount: document.querySelectorAll('[data-effect-card] > .subsection-title input[data-effect-toggle]').length
			};
		});
		assert.deepStrictEqual(canvasStructure, { outerToggle: false, statusInHeader: true, statusBeforeChevron: true, cardToggles: true, sharedEffectCardCount: 7 });

		const availability = await page.evaluate(() => {
			const editor = window.editor;
			const layer = editor.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
			const group = document.querySelector('#baseLayerSettingsContent [data-effect-group]');
			layer.background.mode = 'solid';
			editor.baseBackgroundManager.loadLayerSettings(layer);
			const hiddenWithoutEffects = group.hidden;
			const resetHiddenWithGroup = document.getElementById('resetPixelEffects').closest('[data-effect-group]').hidden;
			layer.background.mode = 'gradient';
			editor.baseBackgroundManager.loadLayerSettings(layer);
			return { hiddenWithoutEffects, resetHiddenWithGroup, shownWithEffects: !group.hidden };
		});
		assert.deepStrictEqual(availability, { hiddenWithoutEffects: true, resetHiddenWithGroup: true, shownWithEffects: true });

		const shape = await page.evaluate(() => {
			const editor = window.editor;
			const layer = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x: 48, y: 48 } });
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			layer.shapeData.border = editor.shapeGlitterManager.getDefaultBorder();
			layer.shapeData.border.widthPx = 17;
			editor.shapeGlitterManager.loadLayerSettings(layer);
			window.changeEffectsToggle('shapeBorderEnabled', false);
			const saved = layer.shapeData.effectDrafts.border.widthPx;
			const collapsedWhenDisabled = document.getElementById('shapeBorderEnabled').closest('[data-effect-card]').classList.contains('is-collapsed');
			window.changeEffectsToggle('shapeBorderEnabled', true);
			const restored = layer.shapeData.border.widthPx;
			const expandedWhenEnabled = !document.getElementById('shapeBorderEnabled').closest('[data-effect-card]').classList.contains('is-collapsed');
			document.getElementById('resetShapeEffects').click();
			return { saved, restored, collapsedWhenDisabled, expandedWhenEnabled, border: layer.shapeData.border, shadow: layer.shapeData.shadow, drafts: layer.shapeData.effectDrafts };
		});
		assert.deepStrictEqual(shape, { saved: 17, restored: 17, collapsedWhenDisabled: true, expandedWhenEnabled: true, border: null, shadow: null, drafts: undefined });

		const sticker = await page.evaluate(() => {
			const editor = window.editor;
			const layer = editor.stickerManager.createLayer();
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			layer.stickerData.shadow = editor.stickerManager.getDefaultShadow();
			layer.stickerData.shadow.offsetX = 13;
			editor.stickerManager.loadLayerSettings(layer);
			window.changeEffectsToggle('stickerShadowEnabled', false);
			const saved = layer.stickerData.effectDrafts.shadow.offsetX;
			window.changeEffectsToggle('stickerShadowEnabled', true);
			const restored = layer.stickerData.shadow.offsetX;
			document.getElementById('resetStickerEffects').click();
			return { saved, restored, shadow: layer.stickerData.shadow, drafts: layer.stickerData.effectDrafts };
		});
		assert.deepStrictEqual(sticker, { saved: 13, restored: 13, shadow: null, drafts: undefined });

		const textLayerId = await page.evaluate(() => {
			const editor = window.editor;
			const layer = editor.textGlitterManager.createLayer({ text: 'Effects' });
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			layer.textData.border = editor.textGlitterManager.getDefaultBorder();
			layer.textData.border.widthPx = 9;
			editor.textGlitterManager.loadLayerSettings(layer);
			window.changeEffectsToggle('textBorderEnabled', false);
			return layer.id;
		});
		await page.waitForFunction((id) => window.editor.layers.find((layer) => layer.id === id)?.textData.effectDrafts?.border?.widthPx === 9, textLayerId);
		await page.evaluate(() => window.changeEffectsToggle('textBorderEnabled', true));
		await page.waitForFunction((id) => window.editor.layers.find((layer) => layer.id === id)?.textData.border?.widthPx === 9, textLayerId);
		await page.evaluate(() => document.getElementById('resetTextEffects').click());
		await page.waitForFunction((id) => {
			const data = window.editor.layers.find((layer) => layer.id === id)?.textData;
			return data?.border === null && data.shadow === null && data.effectDrafts == null;
		}, textLayerId);

		console.log('effects consistency checks passed');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
