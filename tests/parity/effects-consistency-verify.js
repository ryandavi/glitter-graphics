'use strict';

const assert = require('assert');
const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

async function main() {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
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
			const title = group.querySelector(':scope > .property-group-label');
			return {
				outerToggle: Boolean(title.querySelector('.checkbox-group')),
				// Pixelate and Palette moved to filter layers.
				pixelCards: Boolean(document.getElementById('pixelEffectsPixelateEnabled') || document.getElementById('pixelEffectsPaletteEnabled')),
				sharedEffectCardCount: document.querySelectorAll('[data-effect-card] > .property-card-title input[data-effect-toggle]').length
			};
		});
		assert.deepStrictEqual(canvasStructure, { outerToggle: false, pixelCards: false, sharedEffectCardCount: 28 });

		const shape = await page.evaluate(() => {
			const editor = window.editor;
			const layer = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x: 48, y: 48 } });
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			layer.shapeData.border = getSlotDefaults(LayerType.SHAPE, 'border');
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
			layer.stickerData.shadow = getSlotDefaults(LayerType.STICKER, 'shadow');
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
			layer.textData.border = getSlotDefaults(LayerType.TEXT_GLITTER, 'border');
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

		const shapeSources = await page.evaluate(() => {
			const editor = window.editor;
			return [
				['border', 'shapeBorderGlitter', 'borderGlitterId'],
				['shadow', 'shapeShadowGlitter', 'shadowGlitterId']
			].map(([slot, buttonId, defaultKey]) => {
				const layer = editor.shapeGlitterManager.createLayer({ shapeId: 'square' });
				layer.shapeData[slot] = slot === 'border'
					? getSlotDefaults(LayerType.SHAPE, 'border')
					: getSlotDefaults(LayerType.SHAPE, 'shadow');
				layer.shapeData[slot].mode = 'solid';
				layer.shapeData[slot].glitterId = null;
				editor.layerManager.insertLayer(layer);
				editor.layerManager.setActiveLayer(layer.id);
				editor.shapeGlitterManager.loadLayerSettings(layer);
				document.getElementById(buttonId).click();
				editor.shapeGlitterManager.loadLayerSettings(layer);
				return {
					slot,
					mode: layer.shapeData[slot].mode,
					defaulted: layer.shapeData[slot].glitterId === CONFIG.tools.glitter.defaults[defaultKey].shape,
					active: document.getElementById(buttonId).classList.contains('active')
				};
			});
		});
		assert.deepStrictEqual(shapeSources, [
			{ slot: 'border', mode: 'glitter', defaulted: true, active: true },
			{ slot: 'shadow', mode: 'glitter', defaulted: true, active: true }
		]);

		const offsets = await page.evaluate(() => {
			const editor = window.editor;
			const cases = [
				{
					prefix: 'stickerShadow',
					create: () => editor.stickerManager.createLayer(),
					manager: editor.stickerManager,
					prepare: (layer) => { layer.stickerData.shadow = getSlotDefaults(LayerType.STICKER, 'shadow'); },
					getEffects: (layer) => [layer.stickerData.shadow]
				},
				{
					prefix: 'textShadow',
					create: () => editor.textGlitterManager.createLayer({ text: 'Offset' }),
					manager: editor.textGlitterManager,
					prepare: (layer) => {
						layer.textData.border = getSlotDefaults(LayerType.TEXT_GLITTER, 'border');
						layer.textData.shadow = getSlotDefaults(LayerType.TEXT_GLITTER, 'shadow');
					},
					getEffects: (layer) => [layer.textData.fill, layer.textData.border, layer.textData.shadow]
				},
				{
					prefix: 'shapeShadow',
					create: () => editor.shapeGlitterManager.createLayer({ shapeId: 'square' }),
					manager: editor.shapeGlitterManager,
					prepare: (layer) => {
						layer.shapeData.border = getSlotDefaults(LayerType.SHAPE, 'border');
						layer.shapeData.shadow = getSlotDefaults(LayerType.SHAPE, 'shadow');
					},
					getEffects: (layer) => [layer.shapeData.fill, layer.shapeData.border, layer.shapeData.shadow]
				}
			];
			return cases.map((entry, index) => {
				const layer = entry.create();
				entry.prepare(layer);
				entry.manager.normalizeLayer?.(layer);
				const effectReferences = entry.getEffects(layer);
				editor.layerManager.insertLayer(layer);
				editor.layerManager.setActiveLayer(layer.id);
				entry.manager.loadLayerSettings(layer);
				const input = document.getElementById(`${entry.prefix}OffsetX`);
				input.value = String(21 + index);
				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.dispatchEvent(new Event('change', { bubbles: true }));
				const stored = entry.getEffects(layer).at(-1).offsetX;
				const title = input.closest('[data-effect-card]').querySelector(':scope > .property-card-title');
				title.click();
				title.click();
				entry.manager.loadLayerSettings(layer);
				const liveEffects = entry.getEffects(layer);
				return {
					prefix: entry.prefix,
					stored,
					reopened: Number(input.value),
					stableReferences: effectReferences.map((effect, effectIndex) => effect === liveEffects[effectIndex])
				};
			});
		});
		assert.deepStrictEqual(offsets, [
			{ prefix: 'stickerShadow', stored: 21, reopened: 21, stableReferences: [true] },
			{ prefix: 'textShadow', stored: 22, reopened: 22, stableReferences: [true, true, true] },
			{ prefix: 'shapeShadow', stored: 23, reopened: 23, stableReferences: [true, true, true] }
		]);

		console.log('effects consistency checks passed');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
