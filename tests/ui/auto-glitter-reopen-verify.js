'use strict';

const assert = require('assert');
const { openApp } = require('../lib/app');

async function main() {
	const { browser, context, page, errors: pageErrors } = await openApp({ viewport: { width: Number(process.env.GLITTER_TEST_WIDTH) || 1280, height: 900 }, touch: true, document: { width: 40, height: 20 } });
	try {
		const initial = await page.evaluate(() => {
			const auto = window.editor.autoGlitterManager;
			window.editor.baseImageSource = { kind: 'file', hasBaseImage: true };
			const base = window.editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
			window.editor.baseBackgroundManager.normalizeLayer(base).background.mode = 'image';
			const glitter = window.editor.glitterLibrary.getAllContent().find((item) => item.isActive !== false && !item.hasTransparency);
			const baseIndex = window.editor.layers.findIndex((layer) => layer.type === LayerType.BASE_IMAGE);
			const batchId = 'auto-glitter-reopen-test';
			const createdAt = Date.now();
			const layers = [0, 1].map((side) => {
				const layer = window.editor.glitterManager.createLayer({ skipLimitCheck: true });
				layer.fill.glitterId = glitter.id;
				layer.fill.color = side === 0 ? 'rgb(255, 0, 0)' : '#0000ff';
				layer.name = side === 0 ? 'Left Region' : 'Right Region';
				const paint = window.editor.paintMaskStore.ensurePaintMask(layer.id);
				const context = paint.add.getContext('2d');
				context.fillStyle = '#fff';
				context.fillRect(side * 20, 0, 20, 20);
				window.editor.paintMaskStore.commitPaintState(layer);
				window.editor.layers.splice(baseIndex + 1 + side, 0, layer);
				layer.autoGlitter = {
					batchId,
					createdAt,
					batchSize: 2,
					generatedState: auto.captureGeneratedState(layer)
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
		assert.strictEqual(initial.buttonLabel, 'Apply changes', 'Edit mode did not use Apply Changes');
		assert(await page.evaluate(() => {
			const event = key => new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
			const tool = editor.currentTool;
			const count = editor.layers.length;
			const blocked = dispatchKeyboardCommand(editor, event('b'));
			// Fit Screen stands for the View group: the Library search shortcut
			// only exists while the Library window is open.
			const view = dispatchKeyboardCommand(editor, new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true, cancelable: true }));
			return !blocked && editor.currentTool === tool && editor.layers.length === count && view;
		}), 'Auto Glitter did not apply the real View/Tools command policy');

		const matches = page.locator('#autoGlitterResults > .auto-glitter-match');
		await matches.nth(0).scrollIntoViewIfNeeded();
		const mergeState = () => page.evaluate(() => {
			const auto = editor.autoGlitterManager;
			return { targets: auto.result.palette.map(color => color.manualMergeTarget ?? null), steps: auto.steps.undoStack.length, document: editor.historyManager.historyIndex };
		});
		const beforeMerge = await mergeState();
		const press = async () => {
			const start = await matches.nth(0).locator('.auto-glitter-color-name').boundingBox(), target = await matches.nth(1).boundingBox();
			await page.mouse.move(start.x + 5, start.y + start.height / 2); await page.mouse.down();
			await page.mouse.move(target.x + 60, target.y + target.height / 2, { steps: 5 });
			assert.equal(await matches.nth(1).evaluate(node => node.classList.contains('is-drop-target')), true, 'Manual merge marks its target with the shared class');
		};
		await press();
		await page.evaluate(() => { const auto = editor.autoGlitterManager; auto.renderReviewResults(); });
		assert.equal(await page.evaluate(() => editor.autoGlitterManager.pendingReviewRender), true, 'Review rerenders defer while merging');
		await page.keyboard.press('Escape'); await page.mouse.up();
		assert.deepStrictEqual(await mergeState(), beforeMerge, 'Escape cancels manual merging without a session or document step');
		assert.equal(await page.locator('#autoGlitterResults .is-drop-target, #autoGlitterResults .is-dragging').count(), 0, 'Cancellation clears drag states');
		await press(); await page.mouse.up();
		const merged = await mergeState();
		assert.equal(merged.targets[0], 1, 'Pointer drop combines the source color into its target');
		assert.equal(merged.steps, beforeMerge.steps + 1, 'Manual combine records one session step');
		assert.equal(merged.document, beforeMerge.document, 'Manual combine does not write document history');
		assert.equal(await page.evaluate(() => editor.autoGlitterManager.session.layers.length), 1, 'Merged preview has one layer');
		await page.evaluate(async () => editor.autoGlitterManager.getHistory().undo());
		assert.equal((await mergeState()).targets[0], null, 'Session undo separates the manually merged color');
		await page.evaluate(async () => editor.autoGlitterManager.getHistory().redo());
		assert.equal((await mergeState()).targets[0], 1, 'Session redo restores the manual merge');
		await page.evaluate(async () => editor.autoGlitterManager.getHistory().undo());
		// Native touch input exercises the same pointer path from the handle.
		await matches.nth(0).locator('.auto-glitter-choice').focus();
		const grip = await matches.nth(0).locator('.list-row-handle').boundingBox(), target = await matches.nth(1).boundingBox();
		const cdp = await context.newCDPSession(page);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }] });
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x + 60, y: target.y + target.height / 2 }] });
		assert.equal(await matches.nth(1).evaluate(node => node.classList.contains('is-drop-target')), true, 'Touch handle uses the same onto target');
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
		assert.equal((await mergeState()).targets[0], null, 'Touch cancellation keeps both colors separate');
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }] });
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x + 60, y: target.y + target.height / 2 }] });
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		assert.equal((await mergeState()).targets[0], 1, 'Touch handle drop combines colors');
		await page.evaluate(async () => editor.autoGlitterManager.getHistory().undo());

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

		const renamed = await page.evaluate(async () => {
			const editor = window.editor;
			const [first, second] = editor.glitterLibrary.getAllContent().filter((item) => item.isAnimated).slice(0, 2);
			if (!first || !second) throw new Error('Need two animated glitters for layer-name coverage');
			const layer = editor.glitterManager.createLayer();
			layer.fill.glitterId = first.id;
			layer.name = first.name;
			editor.layerManager.insertLayer(layer);
			editor.glitterManager.armPicker();
			await editor.glitterLibrary.selectGlitter(second.id);
			const generatedName = layer.name;
			const rowName = editor.layerManager.layersListContainer
				.querySelector(`[data-layer-id="${layer.id}"] .layer-name`)?.textContent;
			const pickerDetail = document.getElementById('designGalleryTitleText').textContent;
			layer.name = 'My custom fill';
			await editor.glitterLibrary.selectGlitter(first.id);
			return { generatedName, rowName, pickerDetail, customName: layer.name, expected: second.name };
		});
		assert.strictEqual(renamed.generatedName, renamed.expected, 'Generated fill-layer name did not follow its new swatch');
		assert.strictEqual(renamed.rowName, renamed.expected, 'Layers panel kept the previous swatch name');
		assert.strictEqual(renamed.pickerDetail, 'Fill', 'The Library title names what a pick changes, not the layer');
		assert.strictEqual(renamed.customName, 'My custom fill', 'Swatch selection replaced a custom layer name');
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
