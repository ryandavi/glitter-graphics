'use strict';

const assert = require('assert');
const fs = require('fs');
const { openApp } = require('../lib/app');

(async () => {
	const { browser, page, errors } = await openApp({ document: { width: 320, height: 240 } });
	try {
		await page.evaluate(async () => {
			const layer = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 80, height: 60, position: { x: 160, y: 120 } });
			getLayerFillSlot(layer).mode = 'solid';
			layer.animations = [GlitterAnimation.normalizeAnimation({ type: 'custom', periodMs: 1000, keys: [
				{ at: 0, values: { tx: 0, opacity: 1, scaleX: 1 } }, { at: 0.5, values: { tx: 80, opacity: 0.4, scaleX: 1.5 } }
			] })];
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			editor.shapeGlitterManager.renderLayer(layer);
			editor.setDocumentLoop({ mode: 'set', durationMs: 4000 });
			await editor.ensureTimelineDock(); PREFERENCES.set('timelineOpen', true);
			await editor.updateExportDuration(); editor.animationPanel.load(layer); editor.timelineDock.selectMotion(layer.id, 0);
			editor.animationPanel.setPaused(true); editor.animationTicker.seek(250);
		});
		const ready = () => page.waitForFunction(() => editor.timelineDock.available && !editor.timelineDock.host.classList.contains('is-stale')
			&& editor.timelineDock.keyLane.host?.isConnected && !editor.timelineDock.keyLane.host.hidden
			&& editor.timelineDock.keyLane.entry === editor.animationPanel._selected(editor.layerManager.getActiveLayer()));
		const state = () => page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer();
			return { keys: layer.animations[0].keys, rest: JSON.stringify(layer.transform), history: editor.historyManager.historyIndex };
		});
		const change = (id, value) => page.evaluate(({ id, value }) => {
			const input = document.getElementById(id);
			if (input.type === 'checkbox') input.checked = value; else input.value = value;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		}, { id, value });
		await ready();
		await page.waitForFunction(() => !editor.timelineDock.frameView.canvas.hidden && !editor.timelineDock.frameView.scrubbing);
		const twin = await page.evaluate(async () => {
			const layer = editor.layerManager.getActiveLayer(), view = editor.timelineDock.frameView;
			const sample = GlitterAnimation.sampleAt(layer.animations, 250, getLayerAnimationSamplingContext(editor, layer));
			const wrapper = editor.shapeGlitterManager.layerElements.get(layer.id).querySelector('.layer-anim-wrapper');
			const dom = wrapper.style.transform === GlitterAnimation.domTransformString(sample) && Math.abs(Number(wrapper.style.opacity) - sample.opacity) < 1e-8;
			const expected = await editor.sceneCompositor.composeFrameAt(editor.getSceneSnapshotParams(editor.layers.filter(entry => entry.visible !== false), { timestamp: 250 }));
			const pixels = view.canvas.getContext('2d').getImageData(0, 0, view.canvas.width, view.canvas.height).data;
			return { dom, pixels: pixels.every((value, index) => value === expected.imageData.data[index]) };
		});
		assert.deepStrictEqual(twin, { dom: true, pixels: true }, 'Custom poses agree in native preview, held frame and export composition');
		const timingBefore = await state();
		await page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer();
			Object.assign(layer.animations[0], { direction: 'alternate', phase: 0.2, delayMs: 500, iterations: 2 });
			editor.shapeGlitterManager.renderLayer(layer); editor.saveState('Custom timing fixture');
			editor.animationTicker.seek(1750);
		}); await ready();
		await page.evaluate(() => document.getElementById('shapeAnimKeyAdd').click()); await ready();
		assert((await state()).keys.some(key => Math.abs(key.at - 0.55) < 1e-8), 'Adding in a later alternate repeat uses delay, phase and direction');
		await page.evaluate(() => editor.animationTicker.seek(2750));
		assert(await page.evaluate(() => document.getElementById('shapeAnimKeyAdd').disabled), 'Authoring outside a trimmed run is disabled');
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		assert.deepStrictEqual((await state()).keys, timingBefore.keys);
		await page.evaluate(() => editor.animationTicker.seek(250));
		await page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer(), fill = getLayerFillSlot(layer);
			fill.mode = 'pattern'; fill.pattern = normalizeEffectPattern({ scroll: 'right', scrollCycleMs: 1000 });
			editor.shapeGlitterManager.renderLayer(layer); editor.saveState('Pattern row fixture');
		}); await ready();
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock, row = dock.model.groups.flatMap(group => group.rows).find(entry => entry.effectSlot === 'fill');
			[...dock.body.querySelectorAll('.timeline-row')].find(node => node.dataset.sourceKey === String(row.key)).querySelector('.timeline-row-label').click();
			return dock.selectedKey === String(row.key) && dock.body.querySelectorAll('.timeline-row-lane:not([hidden])').length === 0;
		}), 'Refreshing the Animation panel must not replace a selected fill bar with a motion bar');
		await page.evaluate(() => editor.historyManager.undo());
		await page.waitForFunction(() => !editor.timelineDock.host.classList.contains('is-stale'));
		await page.evaluate(() => { const layer = editor.layerManager.getActiveLayer(); editor.timelineDock.selectMotion(layer.id, 0); }); await ready();
		let menuBefore = await state();
		await page.evaluate(() => {
			const trigger = document.getElementById('shapeAnimAdd'); trigger.click();
			[...trigger.closest('.app-menu').querySelectorAll('.app-menu-item')].find(button => button.textContent === 'Custom').click();
		});
		await ready();
		assert.strictEqual(await page.evaluate(() => editor.layerManager.getActiveLayer().animations.length), 2);
		assert.strictEqual(await page.evaluate(() => editor.timelineDock.keyLane.row.source.keyTrack.index), 1, 'Adding Custom selects its new lane');
		assert.strictEqual((await state()).history, menuBefore.history + 1);
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		assert.strictEqual(await page.locator('.timeline-row-lane:not([hidden]) .timeline-key[data-key-at]').count(), 2);
		assert(await page.evaluate(() => document.getElementById('shapeAnimKeyValuety').disabled));
		const initial = await state();
		await change('shapeAnimKeyUsehue', true); await ready();
		assert.strictEqual((await state()).history, initial.history + 1);
		await change('shapeAnimKeyValuehue', 90); await ready();
		assert.strictEqual((await state()).keys[0].values.hue, 90);
		await change('shapeAnimKeyUsehue', false); await ready();
		assert(!Object.hasOwn((await state()).keys[0].values, 'hue'));
		await change('shapeAnimKeyEasing', 'easeIn'); await ready();
		assert.strictEqual((await state()).keys[0].easing, 'easeIn');
		await page.evaluate(() => document.getElementById('shapeAnimKeyAdd').click()); await ready();
		let after = await state();
		assert.deepStrictEqual(after.keys.map(key => key.at), [0, 0.25, 0.5]);
		assert.strictEqual(after.keys[1].values.tx, 20, 'Add key samples the outgoing easing');
		assert.strictEqual(after.rest, initial.rest);
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		assert.deepStrictEqual((await state()).keys.map(key => key.at), [0, 0.5]);
		await page.evaluate(() => editor.historyManager.redo()); await ready();
		assert.deepStrictEqual((await state()).keys.map(key => key.at), [0, 0.25, 0.5]);

		const drag = async (at, next, cancel = null) => {
			const node = page.locator(`.timeline-row-lane:not([hidden]) [data-key-at="${at}"]`);
			const box = await node.boundingBox();
			const track = await page.locator('.timeline-row-lane:not([hidden]) .timeline-key-track').boundingBox();
			await page.keyboard.down('Alt');
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
			await page.mouse.move(track.x + next * track.width, track.y + track.height / 2, { steps: 5 });
			if (cancel === 'escape') await page.keyboard.press('Escape');
			if (cancel === 'pointer') await page.evaluate(() => {
				const lane = editor.timelineDock.keyLane;
				lane.track.dispatchEvent(new PointerEvent('pointercancel', { pointerId: lane.drag.pointerId, bubbles: true }));
			});
			await page.mouse.up(); await page.keyboard.up('Alt'); await ready();
		};
		let before = await state();
		await change('shapeAnimKeyPosition', '');
		assert.deepStrictEqual(await state(), before, 'An empty position field does not retime a key');
		await drag(0.5, 0.75);
		after = await state();
		assert(Math.abs(after.keys.at(-1).at - 0.75) < 0.005);
		assert.strictEqual(after.history, before.history + 1, 'A diamond drag commits once');
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		assert.deepStrictEqual((await state()).keys, before.keys);
		before = await state();
		await drag(0.5, 0.8, 'escape'); assert.deepStrictEqual(await state(), before);
		await drag(0.5, 0.8, 'pointer'); assert.deepStrictEqual(await state(), before);
		await page.locator('.timeline-row-lane:not([hidden]) [data-key-at="0.5"]').click();
		assert(await page.evaluate(() => Math.abs(editor.animationTicker.getPlayheadTime() - 500) < 0.01), 'A diamond click seeks to its intrinsic position');
		await change('shapeAnimKeyPosition', 25); await ready();
		after = await state();
		assert.strictEqual(after.keys.length, 3, 'Retime collision does not delete another key');
		assert(after.keys.every((key, index, list) => index === 0 || key.at - list[index - 1].at >= CONFIG_TOLERANCE));

		await page.evaluate(() => {
			const lane = editor.timelineDock.keyLane;
			editor.animationPanel.selectKey(lane.layer, lane.entry, 0);
			lane.focusSelected();
		});
		before = await state();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight'); await ready();
		after = await state();
		assert(Math.abs(after.keys[0].at - 0.02) < 1e-8);
		assert.strictEqual(after.history, before.history + 1, 'Key nudge burst coalesces');
		await page.keyboard.press('Delete'); await ready();
		assert.strictEqual((await state()).keys.length, 2);
		assert.strictEqual(await page.evaluate(() => editor.layers.filter(layer => layer.type === LayerType.SHAPE).length), 1, 'Delete on a key does not delete its layer');

		const serialized = await page.evaluate(async () => {
			const layer = editor.layerManager.getActiveLayer();
			const restored = await editor.layerManager.deserializeLayer(editor.layerManager.serializeLayer(layer));
			return { original: layer.animations[0].keys, restored: restored.animations[0].keys, shared: restored.animations[0].keys === layer.animations[0].keys };
		});
		assert.deepStrictEqual(serialized.original, serialized.restored); assert.strictEqual(serialized.shared, false);
		await page.evaluate(() => { PREFERENCES.set('timelineOpen', false); });
		before = await state();
		await change('shapeAnimKeyValueopacity', 60);
		assert.strictEqual((await state()).history, before.history + 1, 'Selected-key fields work with the dock closed');
		assert.strictEqual((await state()).rest, initial.rest);
		await page.evaluate(() => PREFERENCES.set('timelineOpen', true)); await ready();
		await page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer(), entry = layer.animations[0];
			editor.animationPanel.setKeys(layer, entry, []);
		}); await ready();
		assert.strictEqual(await page.locator('.timeline-row-lane:not([hidden]) .timeline-key[data-key-at]').count(), 0);
		await page.evaluate(() => document.getElementById('shapeAnimKeyAdd').click()); await ready();
		assert.strictEqual((await state()).keys.length, 1, 'Deleting the last key keeps an editable identity motion');
		assert.deepStrictEqual(errors, []);
		console.log('PASS Custom key fields, diamond retiming, collisions, cancellation, seeking, history, serialization and rest-transform preservation');
	} finally { await browser.close(); }

	for (const phone of [false, true]) {
		const gated = await openApp({ viewport: phone ? { width: 390, height: 844 } : undefined, touch: phone, document: { width: 160, height: 120 }, setup: async page => {
			if (phone) return;
			for (const file of ['js/core/features.js', 'js/dist/boot.js']) await page.route(`**/${file}*`, route => route.fulfill({ contentType: 'text/javascript', body: "document.documentElement.classList.remove('is-localhost');\n" + fs.readFileSync(file, 'utf8') }));
		} });
		try {
			const stored = await gated.page.evaluate(async () => {
				const layer = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 30, height: 20, position: { x: 80, y: 60 } });
				getLayerFillSlot(layer).mode = 'solid';
				layer.animations = [GlitterAnimation.normalizeAnimation({ type: 'custom', periodMs: 1000, keys: [{ at: 0, values: { tx: 0 } }, { at: 0.5, values: { tx: 40 } }] })];
				editor.layerManager.insertLayer(layer); editor.layerManager.setActiveLayer(layer.id);
				editor.shapeGlitterManager.renderLayer(layer); editor.animationPanel.load(layer);
				editor.animationTicker.stop();
				editor.animationTicker._paintEntry(layer.id, editor.animationTicker.targets.get(layer.id), 250);
				const wrapper = editor.shapeGlitterManager.layerElements.get(layer.id).querySelector('.layer-anim-wrapper');
				const sample = GlitterAnimation.sampleAt(layer.animations, 250, getLayerAnimationSamplingContext(editor, layer));
				const preview = wrapper.style.transform === GlitterAnimation.domTransformString(sample);
				const frame = await editor.sceneCompositor.composeFrameAt(editor.getSceneSnapshotParams(editor.layers, { timestamp: 250 }));
				const option = [...document.getElementById('shapeAnimType').options].find(entry => entry.value === 'custom');
				const source = editor.sceneCompositor._createLayerAnimationTimelineSources(layer)[0];
				return { preview, frame: frame.width > 0, tx: source.sampleAt(250).sample.tx, editable: editor.animationPanel.canEditKeys(layer, layer.animations[0]), optionDisabled: option.disabled,
					timelineLoaded: performance.getEntriesByType('resource').some(entry => /timeline-(dock|key-lane)\.js/.test(entry.name)) };
			});
			assert.deepStrictEqual(stored, { preview: true, frame: true, tx: 20, editable: false, optionDisabled: true, timelineLoaded: false });
			assert.deepStrictEqual(gated.errors, []);
			console.log(`PASS stored Custom playback/export with authoring gated on ${phone ? 'phone' : 'deployed host'}, without the lazy timeline group`);
		} finally { await gated.browser.close(); }
	}
})().catch(error => { console.error(error); process.exitCode = 1; });

const CONFIG_TOLERANCE = 0.001 - 1e-8;
