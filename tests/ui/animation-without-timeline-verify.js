'use strict';

const assert = require('assert/strict');
const { openApp } = require('../lib/app');
const { exportSnapshot, assertByteIdentity } = require('../parity/export-harness');

(async () => {
	for (const viewport of [{ width: 1600, height: 900 }, { width: 390, height: 844 }]) {
		const { browser, page, errors } = await openApp({ viewport, touch: viewport.width < 500, document: { width: 160, height: 120 } });
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
			await page.locator('#shapeAnimEasing').focus();
			assert(await page.evaluate(() => {
				const control = document.getElementById('shapeAnimEasing'), previews = [...control.options].map(option => option.querySelector('svg'));
				for (let index = 0; index < 10; index++) editor.animationPanel.load(editor.layerManager.getActiveLayer());
				return document.activeElement === control && previews.every((node, index) => node === control.options[index].querySelector('svg'));
			}), 'Refreshing the panel preserves focused easing choices and their previews');
			await page.locator('#shapeAnimEasing').selectOption('steps');
			const stepCurve = page.locator('#shapeAnimEasing option[value="steps"] polyline');
			const beforeSteps = await stepCurve.getAttribute('points');
			await page.locator('#shapeAnimSteps').fill('4'); await page.locator('#shapeAnimSteps').press('Tab');
			assert.notEqual(await stepCurve.getAttribute('points'), beforeSteps, 'Changing Steps updates its curve');
			await page.evaluate(() => editor.historyManager.undo());
			assert.equal(await stepCurve.getAttribute('points'), beforeSteps, 'Undo restores the Steps curve');
			await page.locator('#shapeAnimType').selectOption('custom');
			await page.locator('#shapeAnimKeyStrip').waitFor({ state: 'visible' });
			await page.locator('#shapeAnimPresetNext').click();
			assert(await page.evaluate(() => !GlitterAnimation.MOTION_REGISTRY[editor.animationPanel.selectedMotion(editor.layerManager.getActiveLayer()).type].keyed), 'Preset arrows return to presets');
			assert(!await page.locator('#shapeAnimKeyStrip').isVisible(), 'Leaving Custom hides its key editor');
			await page.evaluate(() => {
				const layer = editor.layerManager.getActiveLayer(), motion = editor.animationPanel.selectedMotion(layer);
				editor.writeTiming(GlitterAnimation.sourceKey(layer.id, motion), { period: 1000, delayMs: 500, phase: 0.25, iterations: 1.5 });
				editor.setDocumentLoop({ mode: 'set', durationMs: 1200 });
				editor.animationPanel.load(layer);
			});
			assert.match(await page.locator('#shapeAnimTimingSummary').innerText(), /starts at 0.50 s; ends at 1.75 s/, 'The selected run is explained in document seconds, including its offset');
			await page.locator('#shapeAnimIncludeInLoop').click();
			assert(await page.evaluate(() => editor.documentLoop.durationMs >= 1750), 'Extending the scene loop includes the selected finite run');
			await page.locator('#shapeAnimTimingHint').waitFor({ state: 'hidden' });
			await page.evaluate(() => { editor.openAnimationLoop(); editor.setPlayback(false); });
			const transport = page.locator('#animationTransport');
			await transport.waitFor({ state: 'visible' });
			assert(await page.locator('#animationLoopCandidate').isVisible(), 'Loop length stays available without Advanced');
			assert(!await page.locator('#animationLoopSources').isVisible(), 'Source analysis starts under Advanced');
			const historyIndex = await page.evaluate(() => editor.historyManager.historyIndex);
			const playbackBoxes = () => transport.evaluate(host => {
				const origin = host.getBoundingClientRect();
				return [...host.querySelectorAll('.animation-transport-actions > button, input[type="range"]')].map(node => {
					const rect = node.getBoundingClientRect();
					return [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height].map(value => Math.round(value * 100) / 100);
				});
			});
			const pausedBoxes = await playbackBoxes();
			await transport.getByRole('button', { name: 'Play', exact: true }).click();
			assert(await page.evaluate(() => !editor.animationTicker.paused));
			assert.deepEqual(await playbackBoxes(), pausedBoxes, 'Play/Pause never moves or resizes playback controls or the slider');
			await transport.getByRole('button', { name: 'Pause', exact: true }).click();
			await transport.getByRole('button', { name: 'Go to loop start', exact: true }).click();
			assert.equal(await page.evaluate(() => editor.animationTicker.getPlayheadTime()), 0);
			await transport.getByRole('button', { name: 'Next frame', exact: true }).click();
			assert(await page.evaluate(() => editor.animationTicker.getPlayheadTime() > 0));
			const seek = transport.getByRole('slider', { name: 'Scene time' });
			await seek.evaluate(input => { input.value = 400; input.dispatchEvent(new Event('input', { bubbles: true })); });
			assert.equal(await page.evaluate(() => editor.animationTicker.getPlayheadTime()), 400, JSON.stringify(await page.evaluate(() => ({ loop: editor.documentLoop, ticker: editor.animationTicker.loopMs, range: document.querySelector('#animationTransport input').outerHTML, state: editor.resolveAnimationLoop() }))));
			await seek.focus(); await page.keyboard.press('ArrowRight');
			assert(await page.evaluate(() => editor.animationTicker.getPlayheadTime() > 400));
			for (const reason of ['Escape', 'blur', 'pointercancel']) {
				await page.evaluate(() => { editor.setPlayback(false); editor.animationTicker.seek(250); });
				await seek.scrollIntoViewIfNeeded();
				await page.waitForTimeout(250);
				const box = await seek.boundingBox();
				await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2); await page.mouse.down();
				assert(await page.evaluate(() => editor.animationTicker.getPlayheadTime() !== 250));
				if (reason === 'Escape') await page.keyboard.press('Escape');
				else if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
				else await seek.dispatchEvent('pointercancel');
				assert.equal(await page.evaluate(() => editor.animationTicker.getPlayheadTime()), 250, `${reason} restores the previous held time`);
				await page.mouse.up();
				if (viewport.width < 500) assert(await page.evaluate(() => Boolean(editor.mobileManager.activeDrawer)), 'Cancelling a seek leaves the phone sheet open');
			}
			await page.evaluate(() => { editor.setPlayback(false); editor.animationTicker.setRestPreview(true); });
			await seek.evaluate(input => { input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); input.value = 900; input.dispatchEvent(new Event('input', { bubbles: true })); });
			await seek.focus(); await page.keyboard.press('Escape');
			assert(await page.evaluate(() => editor.animationTicker.paused && editor.animationTicker.restPreview), 'Seek cancellation restores the rest preview');
			await page.evaluate(() => { editor.setPlayback(true); });
			await seek.evaluate(input => { input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); input.value = 900; input.dispatchEvent(new Event('input', { bubbles: true })); });
			await page.keyboard.press('Escape');
			assert(await page.evaluate(() => !editor.animationTicker.paused), 'Seek cancellation resumes previously running playback');
			await page.evaluate(() => editor.setPlayback(false));
			if (viewport.width < 500) {
				await page.evaluate(() => editor.animationTicker.seek(250)); await seek.scrollIntoViewIfNeeded();
				const box = await seek.boundingBox(), cdp = await page.context().newCDPSession(page);
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.25, y: box.y + box.height / 2 }] });
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * 0.75, y: box.y + box.height / 2 }] });
				assert(await page.evaluate(() => editor.animationTicker.paused && editor.animationTicker.getPlayheadTime() > 250), 'A touch scrub seeks the scene clock');
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
				assert.equal(await page.evaluate(() => editor.animationTicker.getPlayheadTime()), 250, 'Cancelling a touch scrub restores its time');
				await cdp.detach();
			}
			if (viewport.width > 500) {
				await page.evaluate(() => editor.updateExportDuration());
				await transport.getByRole('button', { name: 'Preview export', exact: true }).click();
				await page.waitForFunction(() => Boolean(editor.previewFrameView?.exact));
				await transport.getByRole('button', { name: 'Preview export', exact: true }).click();
				assert(await page.evaluate(() => !editor.previewFrameView.exact && !editor.timelineDock));
			}
			assert.equal(await page.evaluate(() => editor.historyManager.historyIndex), historyIndex, 'Visible transport navigation creates no history');
			await page.evaluate(() => setPanelCardCollapsed(document.getElementById('animationLoopSection'), true));
			await page.waitForFunction(() => !editor.unsubscribeAnimationTransport);
			await page.evaluate(() => setPanelCardCollapsed(document.getElementById('animationLoopSection'), false));
			await seek.waitFor({ state: 'visible' });
			await seek.evaluate(input => { input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); input.value = 900; input.dispatchEvent(new Event('input', { bubbles: true })); });
			await page.evaluate(() => editor.loadBlankImage(120, 100, '#ffffff'));
			assert.equal(await page.evaluate(() => editor.animationTicker.getPlayheadTime()), 0, 'Replacing the document discards an unfinished seek');
			await page.waitForFunction(() => !editor.unsubscribeAnimationTransport);
			const windows = await page.evaluate(async () => {
				const e = editor, checks = [];
				let base = e.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x: 60, y: 50 } });
				Object.assign(getLayerFillSlot(base), { mode: 'solid', color: '#ff0000' });
				e.layerManager.insertLayer(base); e.saveState('Visibility fixture');
				e.setLayerAppear(base, { start: 200, end: 700 });
				await e.historyManager.undo(); base = e.layerManager.getLayerById(base.id); checks.push(!Object.hasOwn(base, 'appear'));
				await e.historyManager.redo(); base = e.layerManager.getLayerById(base.id); checks.push(base.appear.start === 200 && base.appear.end === 700);
				const child = e.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x: 60, y: 50 } });
				Object.assign(getLayerFillSlot(child), { mode: 'solid', color: '#0000ff' }); child.clipped = true;
				e.layerManager.insertLayer(child); e.setLayerAppear(child, { start: 300, end: 600 });
				e.setDocumentLoop({ mode: 'set', durationMs: 1000 }, { commit: false }); e.setPlayback(false);
				e.requestPreviewUpdate(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
				const element = e.shapeGlitterManager.layerElements.get(child.id);
				const pixels = [];
				const params = e.getSceneSnapshotParams(e.layers.filter(layer => layer.visible !== false));
				for (const time of [199, 200, 300, 599, 600, 700]) {
					e.animationTicker.seek(time);
					checks.push(element.classList.contains('is-outside-appear') === !(time >= 300 && time < 600));
					const result = await e.sceneCompositor.composeFrameAt({ ...params, timestamp: time, rest: false });
					pixels.push([...result.imageData.data.slice((50 * result.width + 60) * 4, (50 * result.width + 60) * 4 + 4)]);
				}
				e.animationTicker.seek(100);
				const chrome = e.shapeGlitterManager.layerTransforms.get(child.id).chrome.element;
				checks.push(chrome.isConnected && getComputedStyle(chrome).visibility === 'visible');
				e.animationTicker.setRestPreview(true);
				checks.push(!element.classList.contains('is-outside-appear') && e.activeLayerId === child.id);
				const rest = await e.sceneCompositor.composeFrameAt({ ...params, timestamp: 0, rest: true });
				const restPixel = [...rest.imageData.data.slice((50 * rest.width + 60) * 4, (50 * rest.width + 60) * 4 + 4)];
				const copy = e.layerManager.buildClonedLayer(child);
				checks.push(copy.appear.start === 300 && copy.appear !== child.appear);
				const project = await e.projectSerializer.serialize();
				e.isSaved = true;
				await e.projectSerializer.load(project);
				const restored = e.layerManager.getLayerById(child.id);
				checks.push(project.version === 6 && restored.appear.start === 300 && restored.appear.end === 600 && !e.timelineDock);
				return { checks, pixels, restPixel };
			});
			assert(windows.checks.every(Boolean), JSON.stringify(windows));
			assert.deepEqual(windows.pixels, [[255, 255, 255, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255], [255, 0, 0, 255], [255, 255, 255, 255]], 'Visibility and clipping share exact frame boundaries');
			assert.deepEqual(windows.restPixel, [0, 0, 255, 255], 'Intentional still/rest output ignores windows');
			await page.evaluate(() => {
				const input = document.getElementById('shapeLayerOpacityAppears'), section = input.closest('.property-card');
				setPanelCardCollapsed(section, false); setAdvancedDisclosureOpen(input.closest('.advanced-disclosure'), true);
				if (editor.mobileManager.isMobile) {
					const bar = editor.mobileManager.chipBar; bar.render(); bar.pressChip(bar.entries.find(entry => entry.element === section));
				}
			});
			const appears = page.locator('#shapeLayerOpacityAppears'), disappears = page.locator('#shapeLayerOpacityDisappears');
			await appears.waitFor({ state: 'visible' });
			const visibilityHistory = await page.evaluate(() => editor.historyManager.historyIndex);
			await appears.fill('0.4'); await appears.press('Tab');
			assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().appear.start), 400);
			assert.equal(await page.evaluate(() => editor.historyManager.historyIndex), visibilityHistory + 1, 'A visibility field commits once');
			await page.evaluate(() => editor.setLayerAppear(editor.layers.find(layer => layer.type === LayerType.SHAPE && layer.id !== editor.activeLayerId), { start: 100, end: 700 }));
			assert.equal(await appears.inputValue(), '0.4', 'An edit on another layer cannot overwrite inspected visibility fields');
			await disappears.fill(''); await disappears.press('Tab');
			assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().appear.end), null, 'Empty Disappears follows the loop end');
			await disappears.fill('0.3'); await disappears.press('Tab');
			assert.equal(await disappears.inputValue(), '', 'A reversed interval is rejected and the field restored');
			await page.locator('#shapeLayerOpacityAlwaysVisible').click();
			assert(await page.evaluate(() => !Object.hasOwn(editor.layerManager.getActiveLayer(), 'appear')));
			await page.evaluate(() => editor.historyManager.undo());
			assert.equal(await appears.inputValue(), '0.4', 'Undo restores visibility fields');
			await page.evaluate(() => { editor.layerManager.getActiveLayer().locked = true; editor.refreshInspector(); });
			assert(await appears.isDisabled() && await disappears.isDisabled(), 'Locked layer visibility fields are disabled');
			await page.evaluate(async () => { editor.openAnimationLoop(); await editor.updateExportDuration(); });
			assert.match(await page.locator('#animationLoopStatus').innerText(), /layer visibility/);
			await page.locator('#animationLoopCandidate').selectOption('custom');
			await page.locator('#animationLoopDuration').fill('1.6'); await page.locator('#animationLoopDuration').press('Tab');
			assert.equal(await page.evaluate(() => editor.documentLoop.durationMs), 1600, 'Visibility-only scenes can set loop duration without the dock');
			await page.locator('#animationLoopCandidate').selectOption('auto');
			await page.evaluate(() => editor.updateExportDuration());
			assert.equal(await page.evaluate(() => editor.resolveAnimationLoop().duration), 1200, 'Automatic uses the last edge plus the visibility hold');
			if (viewport.width > 500) {
				const html = await page.evaluate(async () => {
					const e = editor, asset = e.stickerLibrary.content.find(item => !item.isAnimated);
					await e.stickerLibrary.ensureAssetDetails(asset.id);
					const sticker = e.stickerManager.createLayer(asset.id); e.layerManager.insertLayer(sticker);
					e.setLayerAppear(sticker, { start: 200, end: 700 });
					e.setDocumentLoop({ mode: 'set', durationMs: 1000 }, { commit: false });
					const exporter = await e.ensureHtmlSceneExporter();
					return exporter.createDocument([sticker], { ...CONFIG.experimental.htmlScene.defaults, embedAssets: true });
				});
				const output = await page.context().newPage();
				try {
					await output.setContent(html);
					const states = await output.evaluate(() => {
						const node = document.querySelector('.glitter-scene__timed'), animation = node.getAnimations()[0];
						animation.pause();
						return [0, 199, 200, 699, 700, 999, 1000, 1201].map(time => { animation.currentTime = time; return getComputedStyle(node).visibility; });
					});
					assert.deepEqual(states, ['hidden', 'hidden', 'visible', 'visible', 'hidden', 'hidden', 'hidden', 'visible'], `HTML uses the same half-open window on every loop: ${JSON.stringify(states)}`);
					await output.emulateMedia({ reducedMotion: 'reduce' });
					assert.equal(await output.locator('.glitter-scene__timed').evaluate(node => getComputedStyle(node).visibility), 'visible', 'Reduced motion shows the ordinarily visible HTML layer');
				} finally { await output.close(); }
				await page.evaluate(async () => {
					const e = editor, asset = e.stickerLibrary.content.find(item => item.isAnimated);
					await e.stickerLibrary.ensureAssetDetails(asset.id);
					const layer = e.stickerManager.createLayer(asset.id); e.layerManager.insertLayer(layer);
					e.setLayerAppear(layer, { start: 200, end: 700 }); window.visibilityExportLayerId = layer.id;
					e.saveState('Windowed export fixture');
				});
				const settings = { transparency: false, maxFrames: 8, exportFrameSkip: 4 };
				const first = await exportSnapshot(page, settings, { minLayers: 3 });
				const second = await exportSnapshot(page, settings, { minLayers: 3 });
				assertByteIdentity(first, second, 'Consecutive windowed animated exports');
				await page.evaluate(async () => { editor.setLayerAppear(editor.layerManager.getLayerById(visibilityExportLayerId), { start: 400, end: 600 }); await editor.historyManager.undo(); });
				const restored = await exportSnapshot(page, settings, { minLayers: 3 });
				assertByteIdentity(first, restored, 'Visibility edit/Undo animated export');

			}
			assert.deepEqual(errors, []);
			console.log(`PASS animation operations and undo with dock unloaded at ${viewport.width}px`);
		} finally { await browser.close(); }
	}
})().catch(error => { console.error(error); process.exit(1); });
