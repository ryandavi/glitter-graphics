'use strict';

const assert = require('assert/strict');
const { chromium } = require('playwright');
const { openApp } = require('../lib/app');
const { exportSnapshot, assertByteIdentity } = require('../parity/export-harness');

// The preview clock: a plain Pause is unchanged, the open timeline holds and
// moves the playhead, and the loop length outlives the estimate.
async function verifyPlayhead(browser) {
	const { page, errors } = await openApp({ browser, viewport: { width: 1600, height: 900 }, document: { width: 200, height: 160 } });
	const pose = (time) => page.evaluate((ms) => {
		const layer = editor.layerManager.getLayerById(window.clockFixture.spinId);
		const probe = document.createElement('div');
		paintLayerAnimationPreview(layer, ms, probe, { editor, data: layer.animations });
		const wrapper = editor.shapeGlitterManager.layerElements.get(layer.id).querySelector('.layer-anim-wrapper');
		return { expected: probe.style.transform, actual: wrapper.style.transform };
	}, time);
	const fixture = await page.evaluate(async () => {
		const e = editor;
		const add = (animation, x) => {
			const shape = e.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x, y: 80 } });
			getLayerFillSlot(shape).mode = 'solid';
			shape.animations = [GlitterAnimation.normalizeAnimation(animation)];
			e.layerManager.insertLayer(shape);
			e.shapeGlitterManager.renderLayer(shape);
			return shape;
		};
		const spin = add({ type: 'rotate', periodMs: 1000, turns: 1 }, 60);
		e.saveState('Clock fixture');
		await e.updateExportDuration();
		window.clockFixture = { spinId: spin.id };
		return { loop: e.loopEstimate.duration, tickerLoop: e.animationTicker.loopMs };
	});
	assert.equal(fixture.loop, 1000);
	assert.equal(fixture.tickerLoop, 1000, 'The ticker keeps the estimated loop length');

	// Dock closed: Pause shows the rest pose and leaves the clock running.
	await page.waitForTimeout(150);
	const plain = await page.evaluate(() => {
		const ticker = editor.animationTicker;
		const startedAt = ticker.timelineStartedAt;
		editor.animationPanel.setPaused(true);
		const paused = { time: ticker.getCurrentTime(), held: ticker.heldMs, playhead: ticker.getPlayheadTime(), rest: editor.canvasElementsContainer.classList.contains('preview-motion-paused'), heldClass: editor.canvasElementsContainer.classList.contains('preview-motion-held') };
		return { startedAt, paused };
	});
	assert.deepEqual(plain.paused, { time: 0, held: 0, playhead: 0, rest: true, heldClass: false }, 'Pause with the dock closed shows time 0');
	let shown = await pose(0);
	assert.equal(shown.actual, shown.expected, 'Pause with the dock closed paints the rest pose');
	const resumed = await page.evaluate(() => {
		editor.animationPanel.setPaused(false);
		return { startedAt: editor.animationTicker.timelineStartedAt, elapsed: editor.animationTicker.getCurrentTime() };
	});
	assert.equal(resumed.startedAt, plain.startedAt, 'Resume with the dock closed leaves the clock where it was');
	assert(resumed.elapsed >= 150, 'Resume with the dock closed does not restart the clock');

	// Dock open: Pause holds the playhead, seek moves everything to it.
	await page.click('#timelineToggle');
	await page.waitForFunction(() => editor.timelineDock?.isOpen);
	await page.evaluate(() => editor.updateExportDuration());
	await page.waitForTimeout(120);
	await page.click('#pauseMotionTool');
	const held = await page.evaluate(() => {
		const ticker = editor.animationTicker;
		return { paused: ticker.paused, holding: ticker.holding, held: ticker.heldMs, time: ticker.getCurrentTime(), button: document.querySelector('#timelineDock .timeline-transport button').title, tool: document.getElementById('pauseMotionTool').title };
	});
	assert(held.paused && held.holding && held.held > 0 && held.held < 1000 && held.time === held.held, `Pause with the dock open holds the playhead: ${JSON.stringify(held)}`);
	assert.equal(held.button, 'Resume motion');
	assert.equal(held.tool, held.button, 'The dock and the view menu show one playback state');
	shown = await pose(held.held);
	assert.equal(shown.actual, shown.expected, 'A held pause paints the pose at the playhead');
	const sought = await page.evaluate(() => {
		const ticker = editor.animationTicker;
		ticker.seek(700);
		const dock = editor.timelineDock;
		return {
			time: ticker.getCurrentTime(), playhead: ticker.getPlayheadTime(), snapshot: editor.getSceneSnapshotParams([]).timestamp,
			line: dock.playhead.style.transform, expectedLine: `translateX(${TimelineView.timeToX(700, dock.scale)}px)`, readout: dock.time.textContent,
			heldClass: editor.canvasElementsContainer.classList.contains('preview-motion-held'), heldValue: editor.canvasElementsContainer.style.getPropertyValue('--preview-held-ms')
		};
	});
	assert.equal(sought.time, 700);
	assert.equal(sought.playhead, 700);
	assert.equal(sought.snapshot, 700, 'A current-frame export reads the playhead');
	assert.equal(sought.line, sought.expectedLine, 'The playhead line sits at the held time');
	assert.equal(sought.readout, '0.70 / 1.00 s');
	assert(sought.heldClass && sought.heldValue === '700', 'CSS-driven motion is told the held time');
	shown = await pose(700);
	assert.equal(shown.actual, shown.expected, 'Seek paints the pose the sampler gives at that time');

	// Pattern scroll stops where the held moment puts it.
	const scroll = await page.evaluate(async () => {
		const shape = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x: 140, y: 80 } });
		shape.shapeData.fill.mode = 'pattern';
		shape.shapeData.fill.pattern = normalizeEffectPattern({ scroll: 'right', scrollCycleMs: 1000 });
		editor.layerManager.insertLayer(shape);
		editor.shapeGlitterManager.renderLayer(shape);
		await new Promise(resolve => setTimeout(resolve, 100));
		const span = editor.shapeGlitterManager.layerElements.get(shape.id).querySelector('.pattern-scrolling');
		const read = () => parseFloat(getComputedStyle(span).backgroundPositionX);
		const origin = parseFloat(span.style.getPropertyValue('--pattern-origin-x'));
		const distance = parseFloat(span.style.getPropertyValue('--pattern-distance-x'));
		const steps = Number(span.style.getPropertyValue('--pattern-steps-x'));
		editor.animationTicker.seek(500);
		const half = read();
		editor.animationTicker.seek(0);
		const start = read();
		editor.animationTicker.seek(700);
		editor.layerManager.deleteLayer(shape.id);
		// The dock rebuilds on the next estimate; let it land before the ruler is used.
		await editor.updateExportDuration();
		return { half, start, origin, distance, steps };
	});
	assert.equal(scroll.start, scroll.origin, 'Held at 0 the pattern rests at its origin');
	assert.equal(scroll.half, scroll.origin + Math.floor(scroll.steps / 2) * scroll.distance / scroll.steps, `A held pattern scroll sits at the playhead: ${JSON.stringify(scroll)}`);

	// Resume continues from the playhead.
	const continued = await page.evaluate(async () => {
		const ticker = editor.animationTicker;
		editor.animationPanel.setPaused(false);
		const at = ticker.getPlayheadTime();
		await new Promise(resolve => setTimeout(resolve, 100));
		return { at, later: ticker.getPlayheadTime(), heldClass: editor.canvasElementsContainer.classList.contains('preview-motion-held'), button: document.querySelector('#timelineDock .timeline-transport button').title };
	});
	assert(continued.at >= 700 && continued.at < 760, `Resume continues from the playhead: ${continued.at}`);
	assert(continued.later > continued.at && continued.later < 1000, `The playhead keeps moving: ${JSON.stringify(continued)}`);
	assert(!continued.heldClass);
	assert.equal(continued.button, 'Pause motion');

	// The ruler, and the keys it takes with focus.
	const track = page.locator('#timelineDock .timeline-ruler-track');
	const box = await track.boundingBox();
	const scale = await page.evaluate(() => editor.timelineDock.scale);
	await page.mouse.click(box.x + 0.42 * scale, box.y + box.height / 2);
	const clicked = await page.evaluate(() => ({ paused: editor.animationTicker.paused, time: editor.animationTicker.getCurrentTime(), starts: editor.timelineDock.model.frameStarts, focused: document.activeElement.classList.contains('timeline-ruler-track') }));
	assert(clicked.paused && clicked.focused, 'Pressing the ruler pauses and takes focus');
	assert(clicked.starts.includes(clicked.time) && Math.abs(clicked.time - 420) <= Math.max(...clicked.starts.map((start, index) => (clicked.starts[index + 1] ?? 1000) - start)), `A ruler press snaps to an output frame: ${clicked.time}`);
	await page.mouse.move(box.x + 0.1 * scale, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 0.8 * scale, box.y + box.height / 2, { steps: 4 });
	await page.mouse.up();
	const dragged = await page.evaluate(() => editor.animationTicker.getCurrentTime());
	assert(clicked.starts.includes(dragged) && dragged > 700, `Dragging the ruler scrubs: ${dragged}`);
	shown = await pose(dragged);
	assert.equal(shown.actual, shown.expected, 'Scrubbing paints the pose at the playhead');
	const index = clicked.starts.indexOf(dragged);
	await page.keyboard.press('ArrowLeft');
	assert.equal(await page.evaluate(() => editor.animationTicker.getCurrentTime()), clicked.starts[index - 1], 'Left steps back one output frame');
	await page.keyboard.press('ArrowRight');
	assert.equal(await page.evaluate(() => editor.animationTicker.getCurrentTime()), dragged, 'Right steps on one output frame');
	const position = await page.evaluate(() => {
		const layer = editor.layerManager.getLayerById(window.clockFixture.spinId);
		editor.layerManager.setActiveLayer(layer.id);
		document.querySelector('#timelineDock .timeline-ruler-track').focus();
		return { ...layer.transform.position };
	});
	await page.keyboard.press('ArrowRight');
	assert.deepEqual(await page.evaluate(() => ({ ...editor.layerManager.getLayerById(window.clockFixture.spinId).transform.position })), position, 'The ruler keeps its arrows from the layer nudge');
	await page.keyboard.press('Home');
	assert.equal(await page.evaluate(() => editor.animationTicker.getCurrentTime()), 0, 'Home returns to the start');
	await page.keyboard.press('Space');
	assert.deepEqual(await page.evaluate(() => ({ paused: editor.animationTicker.paused, hand: Boolean(editor.temporaryHandToolActive) })), { paused: false, hand: false }, 'Space in the dock plays without taking the Hand tool');
	await page.keyboard.press('Space');
	assert(await page.evaluate(() => editor.animationTicker.paused), 'Space in the dock pauses');
	await page.evaluate(() => document.activeElement.blur());
	await page.keyboard.down('Space');
	const canvasSpace = await page.evaluate(() => ({ paused: editor.animationTicker.paused, hand: Boolean(editor.temporaryHandToolActive) }));
	await page.keyboard.up('Space');
	assert.deepEqual(canvasSpace, { paused: true, hand: true }, 'Space away from the dock is still the temporary Hand');
	assert(!(await page.evaluate(() => editor.animationTicker.paused)), 'A tap of Space away from the dock plays');
	await page.keyboard.down('Space');
	await page.waitForTimeout(await page.evaluate(() => CONFIG.ui.timeline.spaceTapMs) + 100);
	await page.keyboard.up('Space');
	assert(!(await page.evaluate(() => editor.animationTicker.paused)), 'A held Space is only the Hand');
	await page.keyboard.press('Space');
	assert(await page.evaluate(() => editor.animationTicker.paused), 'A second tap pauses');

	// Closing the dock while paused returns to the rest pose.
	await page.evaluate(() => editor.animationTicker.seek(300));
	await page.click('#timelineToggle');
	await page.waitForFunction(() => !editor.timelineDock.isOpen);
	const closed = await page.evaluate(() => ({ time: editor.animationTicker.getCurrentTime(), rest: editor.canvasElementsContainer.classList.contains('preview-motion-paused') }));
	assert.deepEqual(closed, { time: 0, rest: true }, 'Closing the dock drops the held playhead');
	shown = await pose(0);
	assert.equal(shown.actual, shown.expected);
	await page.evaluate(() => editor.animationPanel.setPaused(false));

	// A play-once motion replays on every pass, and the loop length outlives
	// the estimate that an edit throws away.
	const loop = await page.evaluate(async () => {
		const e = editor;
		const ticker = e.animationTicker;
		const layer = e.layerManager.getLayerById(window.clockFixture.spinId);
		layer.animations = [GlitterAnimation.normalizeAnimation({ type: 'rotate', periodMs: 400, turns: 1, iterations: 1, delayMs: 200 })];
		e.shapeGlitterManager.renderLayer(layer);
		e.saveState('Play once');
		await e.updateExportDuration();
		const length = e.loopEstimate.duration;
		const start = ticker.timelineStartedAt;
		const second = ticker._elapsedAt(start + length + 350);
		e.saveState('Another edit');
		const stale = e.loopEstimate === null;
		const during = { loop: ticker.loopMs, sampler: ticker._elapsedAt(start + length + 350), playhead: ticker.getPlayheadTime(start + length + 350) };
		await e.updateExportDuration();
		return { length, second, stale, during, after: ticker.loopMs };
	});
	assert.equal(loop.length, 600);
	assert.equal(loop.second, 350, 'A play-once motion replays on the next pass');
	assert(loop.stale, 'The edit must have dropped the estimate');
	assert.deepEqual(loop.during, { loop: 600, sampler: 350, playhead: 350 }, 'The preview keeps its loop length while the estimate is recomputed');
	assert.equal(loop.after, 600);
	assert.deepEqual(errors, []);
	console.log('PASS plain pause unchanged, held playhead, seek poses, pattern scroll, resume, ruler and keys, dock close, play-once replay and a loop length that outlives its estimate');
}

async function main() {
	const browser = await chromium.launch();
	try {
		const { page } = await openApp({ browser });
		await page.evaluate(async () => {
			const editor = window.editor;
			await editor.loadBlankImage(96, 96, '#ffffff');
			const buffer = new Uint8Array(1024);
			const writer = new GifWriter(buffer, 2, 2, { loop: 0, palette: [0xff0000, 0x0000ff] });
			writer.addFrame(0, 0, 2, 2, new Uint8Array([0, 0, 0, 0]), { delay: 10 });
			writer.addFrame(0, 0, 2, 2, new Uint8Array([1, 1, 1, 1]), { delay: 10 });
			const url = `data:image/gif;base64,${btoa(String.fromCharCode(...buffer.subarray(0, writer.end())))}`;
			const asset = await editor.glitterLibrary.ensureAssetDetails(getSlotDefaults(LayerType.SHAPE, 'fill').glitterId);
			Object.assign(asset, { url, width: 2, height: 2, frameCount: 2, frameDelay: 100 });
			window.motionFixture = { url, glitterId: asset.id };
			const shape = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x: 48, y: 48 } });
			for (const key of ['fill', 'border', 'shadow']) {
				const slot = ensureLayerPaintSlot(shape, key, () => getSlotDefaults(LayerType.SHAPE, key));
				Object.assign(slot, { mode: 'glitter', glitterId: asset.id });
				if (key === 'border') slot.widthPx = 4;
			}
			editor.layerManager.insertLayer(shape);
			Object.assign(editor.baseBackgroundManager.getBaseLayer().background, { mode: 'glitter', glitterId: asset.id });
			const sticker = editor.stickerManager.createLayer();
			Object.assign(sticker.stickerData, { isEmpty: false, isAnimated: true, url, baseUrl: url, width: 2, height: 2, frameCount: 2 });
			editor.layerManager.insertLayer(sticker);
			window.motionFixture.stickerId = sticker.id;
			editor.requestPreviewUpdate();
		});
		await page.waitForTimeout(400);
		await page.evaluate(async () => {
			const shape = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 20, height: 20, position: { x: 20, y: 20 } });
			shape.shapeData.fill.mode = 'pattern';
			shape.shapeData.fill.pattern = normalizeEffectPattern({ scroll: 'right' });
			editor.layerManager.insertLayer(shape);
			await new Promise(resolve => setTimeout(resolve, 100));
			const span = editor.shapeGlitterManager.layerElements.get(shape.id).querySelector('.pattern-scrolling');
			const animation = span.getAnimations()[0];
			if (!animation) throw Error('Pattern scroll animation did not start');
			window.motionFixture.patternId = shape.id;
			editor.shapeGlitterManager.renderLayer(shape);
			if (span.getAnimations()[0] !== animation) throw Error('Reconciling the pattern restarted its animation');
		});
		assert(await page.evaluate(() => [...window.editor.canvasElementsContainer.querySelectorAll('*')].filter(node => node.style.backgroundImage.startsWith('url("data:image/gif')).length >= 4), 'Fixture paints start with animated GIF textures');
		const playing = await exportSnapshot(page, {}, { minLayers: 3 });
		await page.evaluate(() => window.editor.animationPanel.setPaused(true));
		await page.waitForFunction(() => {
			const editor = window.editor;
			const entry = editor.animationPanel.previewFrames.get(window.motionFixture.url);
			return entry?.url?.startsWith('data:image/png') && editor.stickerManager.layerElements.get(window.motionFixture.stickerId)?.querySelector('img').src === entry.url;
		});
		await page.waitForTimeout(100);
		const paused = await page.evaluate(async () => {
			const editor = window.editor;
			const url = editor.animationPanel.getPreviewImageUrl(window.motionFixture.url);
			const image = await loadImageElement(url);
			const canvas = createAppCanvas(2, 2, 'tests/preview-motion');
			canvas.getContext('2d').drawImage(image, 0, 0);
			const paintNodes = [...editor.canvasElementsContainer.querySelectorAll('*'), editor.baseBackgroundManager.backgroundElement?.firstElementChild].filter(Boolean);
			return {
				pixel: [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data],
				frozenPaints: paintNodes.filter(node => node.style.backgroundImage.startsWith('url("data:image/png')).length,
				playingPaints: paintNodes.filter(node => node.style.backgroundImage.startsWith('url("data:image/gif')).length,
				original: editor.layerManager.getLayerById(window.motionFixture.stickerId).stickerData.url
			};
		});
		assert.deepEqual(paused.pixel, [255, 0, 0, 255], 'Pause uses the actual first GIF frame');
		assert(paused.frozenPaints >= 4, `Fill, outline, shadow and canvas background freeze: ${JSON.stringify(paused)}`);
		assert.equal(paused.playingPaints, 0, 'No fixture texture keeps playing');
		assert(await page.evaluate(() => {
			const span = editor.shapeGlitterManager.layerElements.get(window.motionFixture.patternId).querySelector('.pattern-scrolling');
			return span.getAnimations().length === 0 && getComputedStyle(span).backgroundPosition === span.style.backgroundPosition;
		}), 'Pause motion must reset pattern scroll to its texture origin');
		assert.equal(paused.original, await page.evaluate(() => window.motionFixture.url), 'Preview freezing preserves authored sources');
		assertByteIdentity(playing, await exportSnapshot(page, {}, { minLayers: 3 }), 'Paused preview export');
		await page.evaluate(() => {
			const editor = window.editor;
			const sticker = editor.stickerManager.createLayer();
			Object.assign(sticker.stickerData, { isEmpty: false, isAnimated: true, url: window.motionFixture.url, baseUrl: window.motionFixture.url, width: 2, height: 2, frameCount: 2 });
			sticker.id = 'paused-sticker';
			editor.layerManager.insertLayer(sticker);
			const frame = editor.frameLayerManager.createLayer();
			frame.frameData.kind = 'image';
			frame.frameData.image = { url: window.motionFixture.url, width: 2, height: 2, isAnimated: true };
			editor.layerManager.insertLayer(frame);
			editor.requestPreviewUpdate();
		});
		await page.waitForFunction(() => window.editor.stickerManager.layerElements.get('paused-sticker')?.querySelector('img').src.startsWith('data:image/png'));
		await page.waitForFunction(() => document.querySelector('.frame-layer-image')?.style.backgroundImage.startsWith('url("data:image/png'));
		await page.evaluate(() => window.editor.animationPanel.setPaused(false));
		await page.waitForFunction(() => [...window.editor.stickerManager.layerElements.values()].every(node => node.querySelector('img').src === window.motionFixture.url));
		assert.equal(await page.evaluate(() => window.editor.animationPanel.previewFrames.size), 0, 'Resume releases cached preview frames');
		assert(await page.evaluate(() => editor.shapeGlitterManager.layerElements.get(window.motionFixture.patternId).querySelector('.pattern-scrolling').getAnimations().map(animation => animation.animationName).sort().join(',') === 'pattern-scroll-x,pattern-scroll-y'), 'Resume must restart pattern scroll');
		assert(await page.evaluate(() => [...window.editor.canvasElementsContainer.querySelectorAll('*')].filter(node => node.style.backgroundImage.startsWith('url("data:image/gif')).length >= 4), 'Resume restores animated paint textures');
		await page.evaluate(() => { window.editor.animationPanel.setPaused(true); window.editor.animationPanel.setPaused(false); });
		await page.waitForTimeout(200);
		assert.equal(await page.evaluate(() => window.editor.stickerManager.layerElements.get('paused-sticker').querySelector('img').src), await page.evaluate(() => window.motionFixture.url), 'A quick resume cannot receive a stale frozen image');
		console.log('PASS paused textures, stickers, first-frame pixels, new layers, resume and unchanged animated exports');
		await verifyPlayhead(browser);
	} finally {
		await browser.close();
	}
}

main().catch(error => { console.error(error); process.exitCode = 1; });
