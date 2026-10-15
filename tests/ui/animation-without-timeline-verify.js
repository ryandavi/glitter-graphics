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
			assert.deepEqual(errors, []);
			console.log(`PASS animation operations and undo with dock unloaded at ${viewport.width}px`);
		} finally { await browser.close(); }
	}
})().catch(error => { console.error(error); process.exit(1); });
