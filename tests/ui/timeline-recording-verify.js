'use strict';

const assert = require('assert');
const { openApp } = require('../lib/app');

(async () => {
	const { browser, page, errors } = await openApp({ viewport: { width: 1600, height: 1000 }, document: { width: 400, height: 300 } });
	try {
		await page.evaluate(async () => {
			const layer = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 100, height: 70, position: { x: 200, y: 150 } });
			getLayerFillSlot(layer).mode = 'solid';
			layer.animations = [GlitterAnimation.normalizeAnimation({ type: 'custom', periodMs: 1000, keys: [{ at: 0, values: { tx: 0 } }, { at: 0.5, values: { tx: 20, rotate: 15, skewX: 7 } }] }), GlitterAnimation.normalizeAnimation({ type: 'pulse', periodMs: 1000 })];
			editor.layerManager.insertLayer(layer); editor.layerManager.setActiveLayer(layer.id); editor.shapeGlitterManager.renderLayer(layer);
			editor.saveState('Recording fixture'); editor.setDocumentLoop({ mode: 'set', durationMs: 4000 });
			await editor.ensureTimelineDock(); PREFERENCES.set('timelineOpen', true); await editor.updateExportDuration();
			editor.timelineDock.selectMotion(layer.id, 0); editor.animationPanel.setPaused(true); editor.animationTicker.seek(250);
			// Opening the dock schedules a debounced refit; settle it before fixing the zoom.
			clearTimeout(editor.viewport.resizeTimeout); editor.viewport.setZoom(1, null, null, { animate: false });
		});
		const ready = () => page.waitForFunction(() => editor.timelineDock.available && !editor.timelineDock.stale);
		const state = () => page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer();
			return { rest: JSON.stringify(layer.transform), geometry: JSON.stringify({ width: layer.shapeData.width, height: layer.shapeData.height, radius: layer.shapeData.cornerRadiusPx }), keys: layer.animations[0].keys, history: editor.historyManager.historyIndex };
		});
		const arm = async () => { await ready(); await page.evaluate(() => { const layer = editor.layerManager.getActiveLayer(); editor.viewport.setZoom(1, null, null, { animate: false }); editor.timelineKeyRecording.begin(layer, layer.animations[0]); }); await page.waitForTimeout(100); };
		const drag = async (kind, dx, dy, { escape = false, cancel = false, blur = false, shift = false } = {}) => {
			const selector = kind === 'move' ? '.is-recording-keys .transform-bounding-box' : `.is-recording-keys [data-handle-type="${kind}"]`;
			await page.locator(selector).waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
			const box = await page.locator(selector).boundingBox();
			assert(box, `Handle ${kind} is visible: ${JSON.stringify(await page.evaluate(() => {
				const record = editor.timelineKeyRecording;
				return { active: record.active, frame: record.frameToken, actualFrame: record.transform && JSON.stringify(record.transform.getFrame()), rest: record.restToken, actualRest: record.transform && JSON.stringify(record.transform.layer.transform), tool: editor.currentTool, handles: record.transform?.transformHandles?.outerHTML.slice(0, 140) };
			}))}`);
			await page.keyboard.down('Control'); if (shift) await page.keyboard.down('Shift');
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
			assert(await page.evaluate(() => Boolean(editor.timelineKeyRecording.drag)), `Pointerdown begins a recording transaction: ${JSON.stringify(await page.evaluate(({ x, y }) => {
				const record = editor.timelineKeyRecording;
				return { active: record.active, target: document.elementFromPoint(x, y)?.outerHTML.slice(0, 250), frame: record.frameToken, actualFrame: JSON.stringify(record.transform.getFrame()), rest: record.restToken, actualRest: JSON.stringify(record.transform.layer.transform), entry: record.entry === editor.layerManager.getActiveLayer()?.animations[0] };
			}, { x: box.x + box.width / 2, y: box.y + box.height / 2 }))}`);
			await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
			assert(await page.evaluate(() => Boolean(editor.timelineKeyRecording.drag?.moved && editor.timelineKeyRecording.active)), 'The recording transaction stays active during movement');
			assert(await page.evaluate(() => JSON.stringify(editor.layerManager.getActiveLayer().transform) === JSON.stringify(editor.timelineKeyRecording.restToken)), 'A live gesture never writes the rest transform');
			if (escape) await page.keyboard.press('Escape');
			if (blur) await page.evaluate(() => window.dispatchEvent(new Event('blur')));
			if (cancel) await page.evaluate(() => {
				const record = editor.timelineKeyRecording;
				record.drag.handle.dispatchEvent(new PointerEvent('pointercancel', { pointerId: record.drag.pointerId, bubbles: true }));
			});
			await page.mouse.up(); await page.keyboard.up('Control'); if (shift) await page.keyboard.up('Shift'); await ready();
		};
		await arm();
		assert(await page.evaluate(() => editor.timelineKeyRecording.active && editor.getActiveSession() === 'keyRecording'));
		assert(await page.evaluate(() => document.querySelector('[data-transform-prefix="shape"] input').disabled));
		await page.waitForFunction(() => !editor.timelineDock.frameView.canvas.hidden && !editor.timelineDock.frameView.scrubbing);
		const isolated = await page.evaluate(() => ({ original: editor.layerManager.getActiveLayer().animations.length,
			preview: editor.timelineDock.frameView.params.visibleLayers.find(layer => layer.id === editor.activeLayerId).animations.length,
			label: document.getElementById('canvasActivityModeLabel').textContent }));
		assert.deepStrictEqual(isolated, { original: 2, preview: 1, label: 'Pose keys' });
		const scrubWork = await page.evaluate(() => {
			const record = editor.timelineKeyRecording, lane = editor.timelineDock.keyLane;
			const buttons = [...lane.buttons], validate = record.validate, refresh = lane.refresh;
			let validations = 0, refreshes = 0;
			record.validate = function (...args) { validations++; return validate.apply(this, args); };
			lane.refresh = function (...args) { refreshes++; return refresh.apply(this, args); };
			for (let ms = 260; ms <= 350; ms += 10) editor.animationTicker.seek(ms);
			record.validate = validate; lane.refresh = refresh;
			return { validations, refreshes, same: buttons.every((button, index) => button === lane.buttons[index]) };
		});
		assert.deepStrictEqual(scrubWork, { validations: 0, refreshes: 0, same: true }, 'Recording scrubs update the pose without validation or key-button rebuilds');
		await page.evaluate(() => editor.animationTicker.seek(250));
		let before = await state();
		await drag('move', 30, 12);
		let after = await state();
		assert.strictEqual(after.rest, before.rest); assert.strictEqual(after.geometry, before.geometry);
		assert.strictEqual(after.history, before.history + 1);
		const key = after.keys.find(key => Math.abs(key.at - 0.25) < 1e-8);
		assert(key && Math.abs(key.values.tx - 40) < 0.1 && Math.abs(key.values.ty - 12) < 0.1, JSON.stringify(key));
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		assert(!(await page.evaluate(() => editor.timelineKeyRecording.active)), 'Undo exits recording');
		assert.deepStrictEqual((await state()).keys, before.keys);
		await arm(); before = await state();
		await drag('move', 50, 20, { escape: true }); assert.deepStrictEqual(await state(), before);
		assert(await page.evaluate(() => editor.timelineKeyRecording.active), 'First Escape cancels the gesture');
		await drag('move', 50, 20, { cancel: true }); assert.deepStrictEqual(await state(), before);
		await drag('move', 50, 20, { blur: true }); assert.deepStrictEqual(await state(), before);
		assert(await page.evaluate(() => editor.timelineKeyRecording.active && !editor.timelineKeyRecording.drag
			&& document.querySelector('[data-transform-prefix="shape"] input').disabled), 'Blur rolls back the gesture and retains the recording session');
		await page.keyboard.press('Escape'); assert(!(await page.evaluate(() => editor.timelineKeyRecording.active)), 'Second Escape exits recording');
		await arm(); before = await state();
		const fixedBefore = await page.evaluate(() => PoseGeometry.frame(editor, editor.timelineKeyRecording.transform, editor.timelineKeyRecording.pose()).corners[0]);
		await drag('corner-br', 25, 18, { shift: true });
		after = await state();
		assert.strictEqual(after.rest, before.rest); assert.strictEqual(after.geometry, before.geometry);
		assert.strictEqual(after.history, before.history + 1);
		const fixedAfter = await page.evaluate(() => PoseGeometry.frame(editor, editor.timelineKeyRecording.transform, editor.timelineKeyRecording.pose()).corners[0]);
		assert(Math.hypot(fixedBefore.x - fixedAfter.x, fixedBefore.y - fixedAfter.y) < 0.01, 'Pose scaling keeps the opposite corner fixed');
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		await arm(); before = await state();
		await drag('rotate-tr', 20, 20);
		assert.strictEqual((await state()).history, before.history + 1);
		assert.strictEqual((await state()).rest, before.rest);
		await page.evaluate(() => editor.timelineKeyRecording.end());
		await page.waitForFunction(() => editor.timelineDock.frameView.params && !editor.timelineDock.frameView.scrubbing && !editor.timelineDock.frameView.canvas.hidden);
		assert(await page.evaluate(() => editor.timelineDock.frameView.params.visibleLayers.find(layer => layer.id === editor.activeLayerId).animations.length === 2), 'Done restores the full motion stack');
		// A rotated, nonuniform, reflected rest transform with an off-centre anchor.
		await page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer();
			Object.assign(layer.transform, { rotation: 30, scale: { x: 150, y: 80 }, anchor: { x: 0.2, y: 0.8 }, flipX: true, proportionalScale: false });
			editor.shapeGlitterManager.renderLayer(layer); editor.saveState('Recording rest fixture');
		});
		await arm(); before = await state();
		const pose = () => page.evaluate(() => { const record = editor.timelineKeyRecording, sample = record.pose(); return { tx: sample.tx, ty: sample.ty, corners: PoseGeometry.frame(editor, record.transform, sample).corners }; });
		const poseBefore = await pose();
		await drag('move', 30, 12);
		const poseMoved = await pose();
		assert(Math.abs(poseMoved.tx - poseBefore.tx - 30) < 0.1 && Math.abs(poseMoved.ty - poseBefore.ty - 12) < 0.1, `A move records canvas pixels under a transformed rest: ${JSON.stringify([poseBefore, poseMoved])}`);
		poseMoved.corners.forEach((corner, index) => assert(Math.hypot(corner.x - poseBefore.corners[index].x - 30, corner.y - poseBefore.corners[index].y - 12) < 0.1, 'The handle frame follows the recorded move'));
		await drag('corner-br', 14, 9);
		const poseScaled = await pose();
		assert(Math.hypot(poseScaled.corners[0].x - poseMoved.corners[0].x, poseScaled.corners[0].y - poseMoved.corners[0].y) < 0.01, 'Pose scaling keeps the opposite corner fixed under a transformed rest');
		assert(Math.hypot(poseScaled.corners[2].x - poseMoved.corners[2].x, poseScaled.corners[2].y - poseMoved.corners[2].y) > 1, 'Pose scaling moves the dragged corner');
		after = await state();
		assert.strictEqual(after.rest, before.rest); assert.strictEqual(after.geometry, before.geometry);
		assert.strictEqual(after.history, before.history + 2);
		await page.evaluate(() => editor.timelineKeyRecording.end());
		// Convert to custom replaces one stack entry with measured keys.
		const stack = () => page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer(), set = document.getElementById('shapeAnimConvertActions'), button = document.getElementById('shapeAnimConvert');
			return { entries: JSON.stringify(layer.animations), types: layer.animations.map(entry => entry.type), rest: JSON.stringify(layer.transform), history: editor.historyManager.historyIndex,
				selected: editor.animationPanel._selectedIndex(layer), offered: !set.hidden, enabled: !button.disabled };
		});
		const selectEntry = index => page.evaluate(index => { const layer = editor.layerManager.getActiveLayer(); editor.animationPanel.selectedByLayer.set(layer.id, index); editor.animationPanel.load(layer); }, index);
		await selectEntry(0);
		assert.strictEqual((await stack()).offered, false, 'A Custom entry has nothing to convert');
		await selectEntry(1);
		const preset = await stack();
		assert.deepStrictEqual([preset.types, preset.offered, preset.enabled], [['custom', 'pulse'], true, true]);
		const pulse = JSON.parse(preset.entries)[1];
		const sampled = () => page.evaluate(() => { const layer = editor.layerManager.getActiveLayer(); return [0, 130, 350, 700, 1000, 1490].map(time => GlitterAnimation.sampleAt(layer.animations[1], time).scaleX); });
		const pulseSamples = await sampled();
		await page.evaluate(() => document.getElementById('shapeAnimConvert').click()); await ready();
		const converted = await stack(), custom = JSON.parse(converted.entries)[1];
		assert.deepStrictEqual([converted.types, converted.selected, converted.history, converted.rest], [['custom', 'custom'], 1, preset.history + 1, preset.rest]);
		assert.strictEqual(JSON.stringify(JSON.parse(converted.entries)[0]), JSON.stringify(JSON.parse(preset.entries)[0]), 'Other stack entries are untouched');
		for (const key of ['periodMs', 'direction', 'delayMs', 'phase', 'fillMode']) assert.strictEqual(custom[key], pulse[key], `Conversion keeps ${key}`);
		(await sampled()).forEach((value, index) => assert(Math.abs(value - pulseSamples[index]) <= CONFIG_SCALE_TOLERANCE, `The converted motion follows the preset: ${value} vs ${pulseSamples[index]}`));
		assert(await page.evaluate(() => { const layer = editor.layerManager.getActiveLayer(); return editor.timelineKeyRecording.canBegin(layer, layer.animations[1]); }), 'A converted motion is editable on the canvas');
		await page.evaluate(() => editor.historyManager.undo()); await ready();
		assert.strictEqual((await stack()).entries, preset.entries, 'One Undo restores the preset');
		await page.evaluate(() => { const layer = editor.layerManager.getActiveLayer(); editor.animationPanel.selectedByLayer.set(layer.id, 1); layer.animations[1].easing = 'elasticOut'; editor.animationPanel.load(layer); });
		const refused = await stack();
		assert.deepStrictEqual([refused.offered, refused.enabled], [true, true], 'Time sampling follows an overshooting half-wave');
		await page.evaluate(() => { const layer = editor.layerManager.getActiveLayer(); editor.animationPanel.convertToCustom(layer, layer.animations[1]); });
		assert.deepStrictEqual([(await stack()).types, (await stack()).history], [['custom', 'custom'], refused.history + 1], 'Time sampling converts the preset in one history step');
		await page.evaluate(() => { const layer = editor.layerManager.getActiveLayer(); layer.animations[1] = GlitterAnimation.normalizeAnimation({ type: 'shake' }); editor.animationPanel.load(layer); });
		assert.strictEqual((await stack()).offered, false, 'A seeded preset is not offered');
		assert.deepStrictEqual(errors, []);
		console.log('PASS canvas key recording, isolated preview, move/scale/rotation, fixed pivot, transformed rest, one-step undo, cancellation, rest geometry preservation and Convert to custom');
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

// Twice the scale tolerance in CONFIG.tools.animation.convert.
const CONFIG_SCALE_TOLERANCE = 0.004;
