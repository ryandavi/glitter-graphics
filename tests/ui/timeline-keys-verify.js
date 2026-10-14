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
		const ready = () => page.waitForFunction(() => editor.timelineDock.available && !editor.timelineDock.stale
			&& editor.timelineDock.keyLane.host?.isConnected && !editor.timelineDock.keyLane.host.hidden
			&& editor.timelineDock.keyLane.entry === editor.animationPanel._selected(editor.layerManager.getActiveLayer()));
		const state = () => page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer();
			return { keys: layer.animations[0].keys, rest: JSON.stringify(layer.transform), history: editor.historyManager.historyIndex };
		});
		const change = (id, value) => page.evaluate(({ id, value }) => {
			const input = document.getElementById(id);
			input.value = value;
			if (input.type === 'range') input.dispatchEvent(new Event('input', { bubbles: true }));
			input.dispatchEvent(new Event('change', { bubbles: true }));
		}, { id, value });
		await ready();
		await page.evaluate(() => { editor.timelineDock.selectedKey = null; editor.timelineDock.syncSelection(); });
		await page.locator('#timelineDock .timeline-bar').first().focus(); await page.keyboard.press('Enter'); await ready();
		assert(await page.locator('.timeline-row-lane:not([hidden])').isVisible(), 'Enter selects a Custom bar and opens its key lane');
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock, lane = dock.keyLane, buttons = [...lane.buttons];
			const record = lane.record, observer = new MutationObserver(() => {});
			observer.observe(record, { attributes: true });
			for (let ms = 260; ms < 500; ms += 10) dock.paintPlayhead(ms);
			const unchanged = observer.takeRecords().length === 0; observer.disconnect();
			const before = buttons[1].style.left;
			editor.animationPanel.setKeySelection(lane.entry, Number(buttons[1].dataset.keyAt)); dock.syncKeys();
			return unchanged && buttons.every((button, index) => button === lane.buttons[index])
				&& lane.buttons[1].style.left === before && lane.buttons[1].getAttribute('aria-pressed') === 'true';
		}), 'Playback and selection keep key buttons intact and avoid repeated record-control writes');
		assert(await page.evaluate(() => {
			const dock = editor.timelineDock, button = dock.keyLane.buttons[0], box = button.getBoundingClientRect();
			button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 82, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
			if (!dock.keyLane.drag) return false;
			const estimate = { ...editor.loopEstimate, renderClock: { ...editor.loopEstimate.renderClock, frameCount: 123 } };
			editor.loopEstimate = estimate; dock.sync(estimate);
			window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 82 }));
			return !dock.keyLane.drag && !dock.syncPending && dock.model.frameCount === 123;
		}), 'An estimate arriving during an unmoved key press is replayed on release');
		await page.evaluate(() => editor.updateExportDuration()); await ready();
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
		await page.waitForFunction(() => !editor.timelineDock.stale);
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
		const shown = () => page.evaluate(() => ['Position', 'Rotation', 'Scale', 'Skew', 'Opacity', 'Hue'].filter(name => !document.getElementById(`shapeAnimKeyProp${name}Row`).hidden));
		assert.deepStrictEqual(await shown(), ['Position', 'Scale', 'Opacity'], 'The Values set lists what the key holds');
		assert(await page.evaluate(() => !document.querySelector('#shapeAnimKeySet input[type="checkbox"], #shapeAnimKeyValues input[type="checkbox"]')
			&& [...document.querySelectorAll('#shapeAnimKeyValues .property-label')].every(label => !/[(°%]|px/.test(label.textContent))), 'No switch and no unit in a label');
		assert.deepStrictEqual(await page.evaluate(() => [...document.getElementById('shapeAnimKeySelect').options].map(option => option.textContent)), ['1 · 0.00 s', '2 · 0.50 s']);
		const initial = await state();
		await change('shapeAnimKeyEasing', 'steps'); await ready();
		assert(await page.evaluate(() => !document.getElementById('shapeAnimKeyStepsRow').hidden && document.getElementById('shapeAnimStepsRow').hidden), 'Custom Steps count lives beside the selected key easing');
		await change('shapeAnimKeySteps', 4); await ready();
		assert.strictEqual(await page.evaluate(() => editor.layerManager.getActiveLayer().animations[0].steps), 4);
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		const addValue = name => page.evaluate(name => {
			const trigger = document.getElementById('shapeAnimKeyAddValue'); trigger.click();
			const items = [...trigger.closest('.app-menu').querySelectorAll('.app-menu-item')];
			const labels = items.map(item => item.textContent);
			items.find(item => item.textContent === name).click();
			return labels;
		}, name);
		assert.deepStrictEqual(await addValue('Hue'), ['Rotation', 'Skew', 'Hue'], 'Add value lists what the key does not hold'); await ready();
		assert.strictEqual((await state()).history, initial.history + 1);
		assert.strictEqual((await state()).keys[0].values.hue, 0, 'A value is added where the motion has it');
		await change('shapeAnimKeyPropHue', 90); await ready();
		assert.strictEqual((await state()).keys[0].values.hue, 90);
		assert.strictEqual((await state()).keys[1].values.hue, 0, 'First-use channels seed the other keys at their previous poses');
		assert.deepStrictEqual(await shown(), ['Position', 'Scale', 'Opacity', 'Hue']);
		await page.evaluate(() => document.querySelector('#shapeAnimKeyPropHueRow .property-revert').click()); await ready();
		assert(!Object.hasOwn((await state()).keys[0].values, 'hue'), 'A row revert stops keying its value');
		assert.strictEqual(await page.evaluate(() => document.querySelector('#shapeAnimKeyPropHueRow .property-revert').title), 'Stop keying Hue here');
		await change('shapeAnimKeyPropPositionY', 12); await ready();
		assert.deepStrictEqual(await page.evaluate(() => { const { tx, ty } = editor.layerManager.getActiveLayer().animations[0].keys[0].values; return { tx, ty }; }), { tx: 0, ty: 12 }, 'Editing one field of a pair keys the other where it is');
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		await change('shapeAnimKeyPropScaleX', 150); await ready();
		assert.deepStrictEqual(await page.evaluate(() => { const { scaleX, scaleY } = editor.layerManager.getActiveLayer().animations[0].keys[0].values; return { scaleX, scaleY }; }), { scaleX: 1.5, scaleY: 1 });
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		await page.evaluate(() => document.getElementById('shapeAnimKeyNext').click()); await ready();
		assert.strictEqual(await page.evaluate(() => document.getElementById('shapeAnimKeySelect').value), '0.5', 'The stepper selects the next key');
		assert(await page.evaluate(() => Math.abs(editor.animationTicker.getPlayheadTime() - 500) < 0.01), 'Stepping seeks as picking does');
		await page.evaluate(() => document.getElementById('shapeAnimKeyNext').click()); await ready();
		assert.strictEqual(await page.evaluate(() => document.getElementById('shapeAnimKeySelect').value), '0', 'The stepper wraps');
		await page.evaluate(() => editor.animationTicker.seek(250)); await ready();
		await change('shapeAnimKeyEasing', 'easeIn'); await ready();
		assert.strictEqual((await state()).keys[0].easing, 'easeIn');
		assert((await page.locator('.timeline-key-track button').first().getAttribute('title')).includes('Ease in outgoing easing'), 'Key tooltips use the easing display name');
		await page.evaluate(() => document.getElementById('shapeAnimKeyAdd').click()); await ready();
		let after = await state();
		assert.deepStrictEqual(after.keys.map(key => key.at), [0, 0.25, 0.5]);
		assert.strictEqual(after.keys[1].values.tx, 20, 'Add key samples the outgoing easing');
		assert.strictEqual(after.rest, initial.rest);
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		assert.deepStrictEqual((await state()).keys.map(key => key.at), [0, 0.5]);
		await page.evaluate(() => editor.historyManager.redo()); await ready();
		assert.deepStrictEqual((await state()).keys.map(key => key.at), [0, 0.25, 0.5]);

		let feedback = null;
		const drag = async (at, next, cancel = null, alt = true) => {
			const node = page.locator(`.timeline-row-lane:not([hidden]) [data-key-at="${at}"]`);
			const box = await node.boundingBox();
			const track = await page.locator('.timeline-row-lane:not([hidden]) .timeline-key-track').boundingBox();
			if (alt) await page.keyboard.down('Alt');
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
			await page.mouse.move(track.x + next * track.width, track.y + track.height / 2, { steps: 5 });
			feedback = await page.evaluate(() => ({ text: editor.timelineDock.dragReadout?.textContent, guide: !editor.timelineDock.snapGuide.hidden }));
			if (cancel === 'escape') await page.keyboard.press('Escape');
			if (cancel === 'pointer') await page.evaluate(() => {
				const lane = editor.timelineDock.keyLane;
				lane.track.dispatchEvent(new PointerEvent('pointercancel', { pointerId: lane.drag.pointerId, bubbles: true }));
			});
			await page.mouse.up(); await page.keyboard.up('Alt'); await ready();
		};
		let before = await state();
		assert(await page.evaluate(() => {
			const lane = document.querySelector('.timeline-row-lane:not([hidden])'), track = lane.querySelector('.timeline-key-track').getBoundingClientRect();
			const origin = lane.querySelector('.timeline-key-cell').getBoundingClientRect().left, scale = editor.timelineDock.scale;
			const key = lane.querySelector('[data-key-at="0.5"]').getBoundingClientRect();
			return Math.abs(track.left - origin) < 0.5 && Math.abs(track.width - TimelineView.timeToX(1000, scale)) < 0.5
				&& Math.abs(key.left + key.width / 2 - origin - TimelineView.timeToX(500, scale)) < 0.5
				&& !lane.closest('.timeline-stage').querySelector('.btn-flat, .timeline-key-playhead, .timeline-key-heading');
		}), 'The lane is one cycle of the bar on the dock ruler, without a heading, a boxed button or a playhead of its own');
		await drag(0.5, 0.75);
		after = await state();
		assert(Math.abs(after.keys.at(-1).at - 0.75) < 0.005);
		assert.strictEqual(after.history, before.history + 1, 'A diamond drag commits once');
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		assert.deepStrictEqual((await state()).keys, before.keys);
		before = await state();
		await drag(0.5, 0.8, 'escape'); assert.deepStrictEqual(await state(), before);
		await drag(0.5, 0.8, 'pointer'); assert.deepStrictEqual(await state(), before);
		await page.evaluate(() => editor.animationTicker.seek(600)); await ready();
		await drag(0.5, 0.605, 'escape', false);
		assert.deepStrictEqual(feedback, { text: 'Key at 60% (was 50%) · playhead', guide: true }, 'A key dragged to the playhead snaps there and says so');
		assert.deepStrictEqual(await state(), before);
		await page.locator('.timeline-row-lane:not([hidden]) [data-key-at="0.5"]').click();
		assert(await page.evaluate(() => Math.abs(editor.animationTicker.getPlayheadTime() - 500) < 0.01), 'A diamond click seeks to its intrinsic position');
		assert(await page.evaluate(() => {
			const key = document.querySelector('.timeline-row-lane:not([hidden]) [data-key-at="0.5"]').getBoundingClientRect();
			return Math.abs(key.left + key.width / 2 - editor.timelineDock.playhead.getBoundingClientRect().left) < 1;
		}), 'The selected key sits under the dock playhead after a click');
		await change('shapeAnimKeyPosition', 25); await ready();
		after = await state();
		assert.strictEqual(after.keys.length, 3, 'Retime collision does not delete another key');
		assert(after.keys.every((key, index, list) => index === 0 || key.at - list[index - 1].at >= CONFIG_TOLERANCE));
		before = await state();
		await page.evaluate(() => {
			const slider = document.getElementById('shapeAnimKeyPosition');
			for (const value of [30, 40, 60]) { slider.value = value; slider.dispatchEvent(new Event('input', { bubbles: true })); }
			slider.dispatchEvent(new Event('change', { bubbles: true }));
		}); await ready();
		after = await state();
		assert(after.keys.some(key => Math.abs(key.at - 0.6) < 1e-8) && after.history === before.history + 1, 'A Position slider drag retimes the key in one history entry');
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		assert.deepStrictEqual((await state()).keys, before.keys);

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
		assert(await page.evaluate(() => !document.getElementById('shapeAnimKeyAdd').disabled), 'Add key works in the inspector with the dock closed');
		const closedAdd = await page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer(), animation = layer.animations[0], panel = editor.animationPanel;
			animation.keys = [{ at: 0, easing: 'linear', values: { opacity: 1 } }, { at: 0.5, easing: 'linear', values: { opacity: 0.5 } }];
			const keys = GlitterAnimation.normalizeKeys(animation.keys); panel.setKeySelection(animation, keys[0].at);
			const at = (keys[0].at + (keys[1]?.at ?? 1)) / 2;
			panel.addKey(layer, animation);
			return { at, added: animation.keys.some(key => key.at === at), seeded: animation.keys.length };
		});
		assert(closedAdd.added, 'With the dock closed, Add key inserts halfway to the next key');
		await page.evaluate(() => editor.historyManager.undo());
		before = await state();
		await change('shapeAnimKeyPropOpacity', 60);
		assert.strictEqual((await state()).history, before.history + 1, 'Selected-key fields work with the dock closed');
		assert.strictEqual((await state()).rest, initial.rest);
		const stripBefore = await state();
		await page.evaluate(() => { const section = document.getElementById('shapeAnimationSection'); if (editor.pickers.flyout !== section.dataset.flyoutKey) editor.pickers.toggleFlyout(section.dataset.flyoutKey); setPanelCardCollapsed(section, false); });
		await page.locator('#shapeAnimKeyStrip').waitFor({ state: 'visible' });
		await page.locator('#shapeAnimKeyStrip').scrollIntoViewIfNeeded();
		await page.waitForTimeout(250);
		const stripPoint = await page.evaluate(() => {
			const strip = editor.animationPanel.keyStrips.get('shape'), box = strip.host.getBoundingClientRect(), key = strip.buttons[0].getBoundingClientRect();
			return { x: key.left + key.width / 2, y: key.top + key.height / 2, target: box.left + box.width * 0.2 };
		});
		await page.mouse.move(stripPoint.x, stripPoint.y); await page.mouse.down();
		await page.mouse.move(stripPoint.target, stripPoint.y, { steps: 5 }); await page.mouse.up();
		assert((await state()).keys.some(key => Math.abs(key.at - 0.2) < 0.01), `The panel strip retimes a key without the dock: ${JSON.stringify({ point: stripPoint, state: await state(), errors })}`);
		assert.strictEqual((await state()).history, stripBefore.history + 1, 'A panel-strip drag saves one history step');
		await page.evaluate(() => editor.historyManager.undo());
		assert.deepStrictEqual((await state()).keys, stripBefore.keys, 'One Undo restores panel-strip timing');
		await page.evaluate(() => PREFERENCES.set('timelineOpen', true)); await ready();
		await page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer(), entry = layer.animations[0];
			editor.animationPanel.setKeys(layer, entry, []);
		}); await ready();
		assert.strictEqual(await page.locator('.timeline-row-lane:not([hidden]) .timeline-key[data-key-at]').count(), 0);
		await page.evaluate(() => document.getElementById('shapeAnimKeyAdd').click()); await ready();
		assert.strictEqual((await state()).keys.length, 1, 'Deleting the last key keeps an editable identity motion');
		await page.evaluate(() => { editor.timelineDock.setZoom(1000); editor.animationTicker.seek(250); }); await ready();
		before = await state();
		const edgeKey = await page.locator('.timeline-row-lane:not([hidden]) [data-key-at]').first().boundingBox();
		const edgeBody = await page.locator('.timeline-body').boundingBox();
		await page.mouse.move(edgeKey.x + edgeKey.width / 2, edgeKey.y + edgeKey.height / 2); await page.mouse.down();
		await page.mouse.move(edgeBody.x + edgeBody.width + 20, edgeKey.y + edgeKey.height / 2);
		const edgeStart = await page.locator('.timeline-body').evaluate(node => node.scrollLeft);
		await page.waitForTimeout(180);
		assert(await page.locator('.timeline-body').evaluate(node => node.scrollLeft) > edgeStart + 20, 'A held key drag shares the dock edge-scroll clock');
		await page.keyboard.press('Escape'); await page.mouse.up(); await ready();
		assert.deepStrictEqual(await state(), before, 'Cancelling an edge-scrolling key restores its keys without history');
		assert.deepStrictEqual(errors, []);
		console.log('PASS Custom key values, stepper, Position slider, diamond retiming, collisions, cancellation, seeking, history, serialization and rest-transform preservation');
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
