'use strict';

const assert = require('assert/strict');
const { openApp } = require('../lib/app');

(async () => {
	for (const viewport of [{ width: 1600, height: 900 }, { width: 390, height: 844 }]) {
		const { browser, page, errors } = await openApp({ viewport, document: { width: 160, height: 120 } });
		try {
			const checks = await page.evaluate(async () => {
				const e = editor; e.historyManager.limit = 100; const layer = e.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40 });
				e.layerManager.insertLayer(layer); e.layerManager.setActiveLayer(layer.id); e.saveState('Fixture');
				const results = [];
				const exercise = async (action, layerId = layer.id) => {
					const before = JSON.stringify(e.layerManager.serializeLayer(e.layerManager.getLayerById(layerId))), index = e.historyManager.historyIndex;
					await action(e.layerManager.getLayerById(layerId));
					results.push(e.historyManager.historyIndex === index + 1);
					await e.historyManager.undo();
					results.push(JSON.stringify(e.layerManager.serializeLayer(e.layerManager.getLayerById(layerId))) === before);
					await e.historyManager.redo();
				};
				await exercise(layer => e.addAnimation(layer, 'pulse'));
				await exercise(layer => e.addAnimation(layer, 'custom'));
				const stack = document.getElementById('shapeAnimStack'), firstRow = stack.querySelector('.animation-stack-item');
				e.animationPanel.load(e.layerManager.getLayerById(layer.id));
				results.push(firstRow === stack.querySelector('.animation-stack-item'));
				await exercise(layer => e.setAnimationVisible(layer, layer.animations[0].id, false));
				await exercise(layer => e.setAnimationVisible(layer, layer.animations[1].id, false));
				results.push(document.getElementById('shapeAnimEnabled').checked && !document.getElementById('shapeAnimationSection').classList.contains('is-off'));
				await exercise(layer => e.setAnimationsEnabled(layer, false));
				await exercise(layer => e.setAnimationsEnabled(layer, true));
				results.push(e.layerManager.getLayerById(layer.id).animations.every(animation => animation.enabled === false));
				await exercise(layer => e.setAnimationVisible(layer, layer.animations[0].id, true));
				await exercise(layer => e.setAnimationVisible(layer, layer.animations[1].id, true));

				e.setPlayback(false); e.animationTicker.seek(250);
				await exercise(layer => e.addKey(layer, layer.animations[1]));
				await exercise(layer => e.editKeyEasing(layer, layer.animations[1], layer.animations[1].keys[0].at, 'easeIn'));
				await exercise(layer => e.retimeKey(layer, layer.animations[1], 0, 0.2));
				await exercise(layer => e.duplicateKey(layer, layer.animations[1], layer.animations[1].keys[0].at));
				await exercise(layer => e.deleteKey(layer, layer.animations[1], 0));
				await exercise(layer => e.convertToCustom(layer, layer.animations[0]));
				await exercise(layer => e.writeTiming(GlitterAnimation.sourceKey(layer.id, layer.animations[0]), { period: 800 }));
				const beforeType = e.layerManager.getLayerById(layer.id).animations[0];
				const timingBeforeType = { period: beforeType.periodMs, id: beforeType.id };
				await exercise(layer => e.setAnimationType(layer, layer.animations[0].id, 'rotate'));
				const afterType = e.layerManager.getLayerById(layer.id).animations[0];
				results.push(afterType.periodMs === timingBeforeType.period && afterType.id === timingBeforeType.id);
				await exercise(layer => e.writeTiming(GlitterAnimation.sourceKey(layer.id, layer.animations[0]), { phase: 0.5, iterations: 2, delayMs: 500 }));
				await exercise(() => { const input = document.getElementById('shapeAnimTrimEnd'); input.value = 2; input.dispatchEvent(new Event('change', { bubbles: true })); });
				const countBeforeStretch = e.layerManager.getLayerById(layer.id).animations[0].iterations;
				await exercise(() => { const input = document.getElementById('shapeAnimStretchDuration'); input.value = 1.8; input.dispatchEvent(new Event('change', { bubbles: true })); });
				results.push(Math.abs(e.layerManager.getLayerById(layer.id).animations[0].iterations - countBeforeStretch) < 1e-10);
				results.push(!document.getElementById('shapeAnimIterations').validity.stepMismatch && !document.getElementById('shapeAnimTrimEnd').validity.stepMismatch);
				e.animationTicker.setRestPreview(true);
				const resting = e.layerManager.getLayerById(layer.id);
				const wrapper = e.shapeGlitterManager.layerElements.get(resting.id).querySelector('.layer-anim-wrapper');
				const restProbe = document.createElement('div');
				paintLayerAnimationPreview(resting, 0, restProbe, { editor: e, data: [], rest: true });
				results.push(wrapper.style.transform === restProbe.style.transform && wrapper.style.opacity === restProbe.style.opacity);
				e.animationTicker.seek(750);
				const heldProbe = document.createElement('div');
				paintLayerAnimationPreview(resting, e.animationTicker.getCurrentTime(), heldProbe, { editor: e, data: resting.animations });
				results.push(wrapper.style.transform === heldProbe.style.transform);
				await exercise(layer => e.moveAnimation(layer, 0, 1));
				await exercise(layer => e.duplicateAnimation(layer, 0));
				await exercise(layer => e.deleteAnimation(layer, 0));
				const ticker = e.animationTicker; ticker.seek(250); ticker.step(1); results.push(ticker.paused && ticker.getPlayheadTime() !== 250); ticker.goToStart(); results.push(ticker.getPlayheadTime() === 0);
				if (!e.mobileManager.isMobile) {
					const recording = await e.ensureKeyRecording(), current = e.layerManager.getLayerById(layer.id);
					e.motionSelection.select(current.id, current.animations[0].id); recording.begin(current, current.animations[0]); results.push(recording.active); recording.end();
				}
				const asset = e.stickerLibrary.content.find(asset => asset.isAnimated);
				await e.stickerLibrary.ensureAssetDetails(asset.id);
				const sticker = e.stickerManager.createLayer(asset.id); e.layerManager.insertLayer(sticker); e.stickerManager.renderLayer(sticker); e.saveState('Authored fixture');
				await e.updateExportDuration();
				const gif = listTimingTargets(e).find(target => target.layerId === sticker.id && target.kind === 'gifCycle' && target.can.period);
				results.push(Boolean(gif));
				if (gif) await exercise(() => e.writeTiming(gif.key, { period: Math.min(gif.periodRange.max, gif.period + 100) }), sticker.id);
				e.setDocumentLoop({ mode: 'set', durationMs: 2300 }, { commit: false }); await e.updateExportDuration();
				const current = e.layerManager.getLayerById(layer.id), key = GlitterAnimation.sourceKey(current.id, current.animations[0]);
				await exercise(() => e.fitToLoop(key));
				await e.updateExportDuration();
				results.push(Boolean(await e.ensureFrameOptions()));
				await exercise(() => e.resetAnimationLoop());

				results.push(!e.timelineDock);
				return results;
			});
			assert(checks.every(Boolean), JSON.stringify({ viewport, checks }));
			await page.evaluate(() => {
				const layer = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40 });
				editor.layerManager.insertLayer(layer); editor.layerManager.setActiveLayer(layer.id);
				const section = document.getElementById('shapeAnimationSection');
				editor.pickers.toggleFlyout(section.dataset.flyoutKey); setPanelCardCollapsed(section, false);
			});
			await page.locator('#shapeAnimAdd').click();
			assert(await page.evaluate(() => editor.layerManager.getActiveLayer().animations.length === 1), 'Add animation immediately creates a preset');
			await page.locator('#shapeAnimTransport').waitFor({ state: 'visible' });
			assert(!await page.locator('#shapeAnimTrimEnd').isVisible(), 'Precise timing starts under Advanced');
			assert(!await page.locator('#shapeAnimKeyStrip').isVisible(), 'Preset users see no key editor');
			await page.locator('#shapeAnimAdvanced [data-advanced-toggle]').click();
			await page.locator('#shapeAnimTrimEnd').waitFor({ state: 'visible' });
			await page.locator('#shapeAnimType').selectOption('custom');
			await page.locator('#shapeAnimKeyStrip').waitFor({ state: 'visible' });
			await page.locator('#shapeAnimPresetNext').click();
			assert(await page.evaluate(() => !GlitterAnimation.MOTION_REGISTRY[editor.animationPanel.selectedMotion(editor.layerManager.getActiveLayer()).type].keyed), 'Preset arrows return to presets');
			assert(!await page.locator('#shapeAnimKeyStrip').isVisible(), 'Leaving Custom hides its key editor');
			await page.evaluate(() => { editor.openAnimationLoop(); editor.setPlayback(false); });
			const transport = page.locator('#animationTransport');
			await transport.waitFor({ state: 'visible' });
			assert(await page.locator('#animationLoopCandidate').isVisible(), 'Loop length stays available without Advanced');
			assert(!await page.locator('#animationLoopSources').isVisible(), 'Source analysis starts under Advanced');
			const historyIndex = await page.evaluate(() => editor.historyManager.historyIndex);
			await transport.getByRole('button', { name: 'Play', exact: true }).click();
			assert(await page.evaluate(() => !editor.animationTicker.paused));
			await transport.getByRole('button', { name: 'Pause', exact: true }).click();
			await transport.getByRole('button', { name: 'Go to loop start', exact: true }).click();
			assert.equal(await page.evaluate(() => editor.animationTicker.getPlayheadTime()), 0);
			await transport.getByRole('button', { name: 'Next frame', exact: true }).click();
			assert(await page.evaluate(() => editor.animationTicker.getPlayheadTime() > 0));
			const seek = transport.getByRole('slider', { name: 'Document time' });
			await seek.evaluate(input => { input.value = 400; input.dispatchEvent(new Event('input', { bubbles: true })); });
			assert.equal(await page.evaluate(() => editor.animationTicker.getPlayheadTime()), 400, JSON.stringify(await page.evaluate(() => ({ loop: editor.documentLoop, ticker: editor.animationTicker.loopMs, range: document.querySelector('#animationTransport input').outerHTML, state: editor.resolveAnimationLoop() }))));
			await seek.focus(); await page.keyboard.press('ArrowRight');
			assert(await page.evaluate(() => editor.animationTicker.getPlayheadTime() > 400));
			if (viewport.width > 500) {
				await page.evaluate(() => editor.updateExportDuration());
				await transport.getByRole('button', { name: 'Preview export', exact: true }).click();
				await page.waitForFunction(() => Boolean(editor.previewFrameView?.exact));
				await transport.getByRole('button', { name: 'Preview export', exact: true }).click();
				assert(await page.evaluate(() => !editor.previewFrameView.exact && !editor.timelineDock));
			}
			assert.equal(await page.evaluate(() => editor.historyManager.historyIndex), historyIndex, 'Visible transport navigation creates no history');
			assert.deepEqual(errors, []);
			console.log(`PASS animation operations and undo with dock unloaded at ${viewport.width}px`);
		} finally { await browser.close(); }
	}
})().catch(error => { console.error(error); process.exit(1); });
