'use strict';

const assert = require('assert');
const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

async function settle(page) {
	await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
	try {
		await page.goto(APP_URL, { waitUntil: 'networkidle' });
		await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach((node) => node.classList.remove('visible')));
		await page.evaluate(() => window.editor.loadBlankImage(96, 96, '#ffffff'));
		await page.waitForFunction(() => Boolean(window.editor?.originalImage));

		const ids = await page.evaluate(() => {
			const editor = window.editor;
			const base = editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
			const shape = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 32, height: 32, position: { x: 48, y: 48 } });
			editor.layerManager.insertLayer(shape);
			editor.layerManager.renderLayersList();
			editor.layerManager.setActiveLayer(shape.id);
			window.layerRevealCalls = [];
			document.querySelectorAll('#layersList .layer-item').forEach((item) => {
				item.scrollIntoView = (options) => window.layerRevealCalls.push({ layerId: item.dataset.layerId, options });
			});
			return { baseId: base.id, shapeId: shape.id };
		});

		await page.evaluate(({ baseId }) => window.editor.layerManager.selectLayerFromCanvas(baseId), ids);
		await settle(page);
		let calls = await page.evaluate(() => window.layerRevealCalls);
		assert.deepStrictEqual(calls, [{ layerId: String(ids.baseId), options: { block: 'nearest', inline: 'nearest' } }]);

		await page.evaluate(({ baseId }) => {
			window.layerRevealCalls = [];
			window.editor.layerManager.selectLayerFromCanvas(baseId);
		}, ids);
		await settle(page);
		calls = await page.evaluate(() => window.layerRevealCalls);
		assert.strictEqual(calls.length, 1, 'reselecting the active canvas layer still reveals an off-screen row');

		await page.evaluate(({ shapeId }) => {
			window.layerRevealCalls = [];
			window.editor.layerManager.setActiveLayer(shapeId);
		}, ids);
		await settle(page);
		assert.deepStrictEqual(await page.evaluate(() => window.layerRevealCalls), [], 'ordinary selection does not move the Layers panel');

		await page.evaluate(({ baseId }) => {
			window.layerRevealCalls = [];
			window.editor.mobileManager.isMobile = true;
			window.editor.mobileManager.activeDrawer = null;
			window.editor.layerManager.selectLayerFromCanvas(baseId);
		}, ids);
		await settle(page);
		assert.deepStrictEqual(await page.evaluate(() => window.layerRevealCalls), [], 'a closed mobile Layers drawer is not opened or scrolled');

		await page.evaluate(({ shapeId }) => {
			window.editor.mobileManager.activeDrawer = 'layers';
			window.editor.layerManager.selectLayerFromCanvas(shapeId);
		}, ids);
		await settle(page);
		calls = await page.evaluate(() => window.layerRevealCalls);
		assert.strictEqual(calls.at(-1)?.layerId, String(ids.shapeId), 'an open mobile Layers drawer reveals the canvas selection');

		const sourceNavigation = await page.evaluate(({ baseId, shapeId }) => {
			const editor = window.editor;
			const glitter = editor.glitterManager.createLayer();
			const sticker = editor.stickerManager.createLayer();
			const text = editor.textGlitterManager.createLayer();
			[glitter, sticker, text].forEach((layer) => editor.layerManager.insertLayer(layer));
			sticker.locked = true;
			editor.layerManager.renderLayersList();

			const button = document.getElementById('layersBarGoToSelected');
			const revealCalls = [];
			window.revealAssetBrowser = (_editor, manager, assetId) => {
				revealCalls.push({
					manager: manager === editor.stickerManager ? 'sticker' : 'glitter',
					assetId
				});
			};

			const results = {};
			[
				['glitter', glitter.id],
				['sticker', sticker.id],
				['text', text.id],
				['shape', shapeId]
			].forEach(([name, layerId]) => {
				editor.layerManager.setActiveLayer(layerId);
				results[name] = { disabled: button.disabled };
				button.click();
			});

			editor.layerManager.setActiveLayer(baseId);
			results.base = { disabled: button.disabled };
			editor.layerManager.setSelection([shapeId, text.id], { activeLayerId: text.id });
			results.multi = { disabled: button.disabled };
			return { results, revealCalls };
		}, ids);

		assert.deepStrictEqual(sourceNavigation.results, {
			glitter: { disabled: false },
			sticker: { disabled: false },
			text: { disabled: false },
			shape: { disabled: false },
			base: { disabled: true },
			multi: { disabled: true }
		});
		assert.deepStrictEqual(
			sourceNavigation.revealCalls.map(({ manager }) => manager),
			['glitter', 'sticker', 'glitter', 'glitter'],
			'each source-bearing layer type opens its configured asset browser'
		);

		const filteredReveal = await page.evaluate(async () => {
			const manager = window.editor.glitterManager;
			const asset = manager.content[0];
			manager.activeFilters.search = 'source-that-cannot-match';
			manager.activeFilters.categories.add('missing-category');
			await manager.browser.navigateToItem(asset.id);
			return {
				search: manager.activeFilters.search,
				categoryCount: manager.activeFilters.categories.size,
				found: Boolean(manager.browser.elements.itemGrid.querySelector(`[data-id="${asset.id}"]`))
			};
		});
		assert.deepStrictEqual(filteredReveal, { search: '', categoryCount: 0, found: true }, 'source navigation clears filters that hide the asset');

		console.log('layer selection reveal checks passed');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
