'use strict';

const assert = require('assert');
const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_APP_URL || 'http://localhost/glitter/';

async function main() {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(error.message || String(error)));
	try {
		await page.addInitScript(() => localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'));
		await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => window.editor != null);
		await page.evaluate(async () => {
			document.querySelectorAll('.modal-overlay.visible').forEach((element) => element.classList.remove('visible'));
			await window.editor.loadBlankImage(40, 20, '#ffffff');
		});
		await page.waitForFunction(() => window.editor.originalImage != null);
		await page.waitForFunction(() => window.editor.glitterManager.getAllContent().length > 0);

		const initial = await page.evaluate(() => {
			const auto = window.editor.autoGlitterManager;
			window.editor.baseImageSource = { kind: 'file', hasBaseImage: true };
			const base = window.editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
			window.editor.baseBackgroundManager.normalizeLayer(base).background.mode = 'image';
			const glitter = window.editor.glitterManager.getAllContent().find((item) => item.isActive !== false && !item.hasTransparency);
			const baseIndex = window.editor.layers.findIndex((layer) => layer.type === LayerType.BASE_IMAGE);
			const batchId = 'auto-glitter-reopen-test';
			const createdAt = Date.now();
			const layers = [0, 1].map((side) => {
				const layer = window.editor.glitterManager.createLayer({ skipLimitCheck: true });
				layer.selectedGlitterId = glitter.id;
				layer.fill.color = side === 0 ? 'rgb(255, 0, 0)' : '#0000ff';
				layer.name = side === 0 ? 'Left Region' : 'Right Region';
				const paint = window.editor.glitterManager.ensurePaintMask(layer.id);
				const context = paint.add.getContext('2d');
				context.fillStyle = '#fff';
				context.fillRect(side * 20, 0, 20, 20);
				window.editor.glitterManager.commitPaintState(layer);
				window.editor.layers.splice(baseIndex + 1 + side, 0, layer);
				layer.autoGlitter = {
					batchId,
					createdAt,
					batchSize: 2,
					generatedState: JSON.stringify(auto.captureGeneratedState(layer))
				};
				return layer;
			});
			window.editor.layerManager.renderLayersList();
			window.editor.updatePreview();
			auto.open();
			return {
				ids: layers.map((layer) => layer.id),
				editChecked: auto.ui.editCurrent.checked,
				paletteSize: auto.result?.palette.length,
				previewSize: auto.session?.layers.length,
				oldHidden: layers.every((layer) => !layer.visible),
				buttonLabel: auto.ui.create.textContent
			};
		});

		assert.strictEqual(initial.editChecked, true, 'Existing batch did not default to Edit current');
		assert.strictEqual(initial.paletteSize, 2, 'Existing masks did not reopen as two Color Matches');
		assert.strictEqual(initial.previewSize, 2, 'Existing batch did not create a two-layer preview');
		assert.strictEqual(initial.oldHidden, true, 'Committed batch remained visible under its edit preview');
		assert.strictEqual(initial.buttonLabel, 'Apply Changes', 'Edit mode did not use Apply Changes');

		const coalesced = await page.evaluate(async () => {
			const auto = window.editor.autoGlitterManager;
			const sourceResult = auto.result;
			const originalRequestWorker = auto.requestWorker;
			const originalRenderReviewResults = auto.renderReviewResults;
			let reduceCalls = 0;
			let renders = 0;
			auto.segmentDirty = false;
			auto.requestWorker = async (type) => {
				if (type !== 'reduce') throw new Error(`Unexpected worker request: ${type}`);
				reduceCalls++;
				await new Promise((resolve) => setTimeout(resolve, 220));
				return {
					labels: new Uint8Array(sourceResult.labels),
					palette: sourceResult.palette.map((entry) => ({ ...entry })),
					visiblePixelCount: sourceResult.visiblePixelCount
				};
			};
			auto.renderReviewResults = () => { renders++; };
			auto.analyze();
			for (let index = 0; index < 4; index++) {
				auto.scheduleReduce();
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			await new Promise((resolve) => setTimeout(resolve, 850));
			auto.requestWorker = originalRequestWorker;
			auto.renderReviewResults = originalRenderReviewResults;
			auto.ui.editCurrent.checked = true;
			auto.loadPreviousBatch();
			return { reduceCalls, renders };
		});
		assert.ok(coalesced.reduceCalls <= 3, `Rapid settings queued ${coalesced.reduceCalls} analyses`);
		assert.strictEqual(coalesced.renders, 1, 'Stale analyses refreshed the Auto Glitter preview');

		const cancelled = await page.evaluate((oldIds) => {
			const auto = window.editor.autoGlitterManager;
			auto.cancelSession();
			return {
				oldPresent: oldIds.every((id) => window.editor.layers.some((layer) => layer.id === id)),
				oldVisible: oldIds.every((id) => window.editor.layers.find((layer) => layer.id === id)?.visible),
				previewCount: window.editor.layers.filter((layer) => layer.isPreview).length
			};
		}, initial.ids);
		assert.strictEqual(cancelled.oldPresent, true, 'Cancel removed the committed batch');
		assert.strictEqual(cancelled.oldVisible, true, 'Cancel did not restore the committed batch visibility');
		assert.strictEqual(cancelled.previewCount, 0, 'Cancel left preview layers behind');

		const applied = await page.evaluate((oldIds) => {
			const auto = window.editor.autoGlitterManager;
			auto.open();
			auto.createLayers();
			const current = auto.getLatestBatch();
			return {
				oldPresent: oldIds.some((id) => window.editor.layers.some((layer) => layer.id === id)),
				batchSize: current?.layers.length,
				hasSessionState: current?.layers.every((layer) => layer.autoGlitter?.sessionState?.version === 1),
				sessionActive: auto.isSessionActive()
			};
		}, initial.ids);
		assert.strictEqual(applied.oldPresent, false, 'Apply did not replace the committed batch');
		assert.strictEqual(applied.batchSize, 2, 'Apply did not commit the reopened Color Matches');
		assert.strictEqual(applied.hasSessionState, true, 'Apply did not save the Auto Glitter controls');
		assert.strictEqual(applied.sessionActive, false, 'Apply left Auto Glitter mode active');
		assert.deepStrictEqual(pageErrors, [], `Page errors: ${pageErrors.join('; ')}`);
		console.log('PASS Auto Glitter reopens, cancels safely, and applies over the current batch');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
