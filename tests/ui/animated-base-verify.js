'use strict';

// An animated GIF as the base image, in the real app: detection at load, the
// playing preview element, export frames that follow the GIF and agree with
// the still base, the Play animation switch, Pause motion, crop and canvas
// extension, undo, the animated GIF export, project round-trip, the import
// limits, and that a still image is untouched by any of it.

const { chromium } = require('playwright');
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) { if (!condition) throw new Error(message); }

// Loads a four-frame GIF (60 × 40, 200 ms a frame) as the base image. Each
// frame is one flat color with a block that moves, so frames are easy to
// tell apart and survive GIF encoding exactly.
async function loadAnimatedBase(page, { replace = false } = {}) {
	await page.evaluate(async ({ replace }) => {
		const width = 60, height = 40, frames = 4;
		const buffer = new Uint8Array(width * height * frames + 2048);
		const writer = new GifWriter(buffer, width, height, { loop: 0 });
		const palette = [0xcc3355, 0x33aa77, 0x3355cc, 0xffffff];
		for (let frame = 0; frame < frames; frame++) {
			const pixels = new Uint8Array(width * height).fill(frame % 3);
			for (let y = 10; y < 30; y++) for (let x = 0; x < 10; x++) pixels[y * width + frame * 12 + 5 + x] = 3;
			writer.addFrame(0, 0, width, height, pixels, { palette, delay: 20 });
		}
		const file = new File([buffer.slice(0, writer.end())], 'spinner.gif', { type: 'image/gif' });
		if (replace) await window.editor.replaceBaseImageFile(file);
		else await window.editor.loadImageFile(file);
	}, { replace });
	await page.waitForTimeout(250);
}

// One composed export frame at `timestamp`, as [r, g, b, a] at the probes
// plus a hash of every pixel.
async function compose(page, timestamp, probes = [[1, 1]]) {
	return page.evaluate(async ({ timestamp, probes }) => {
		const editor = window.editor;
		const composed = await editor.sceneCompositor.composeFrameAt({
			visibleLayers: editor.layers.filter((layer) => layer.visible),
			glitterGifs: editor.glitterLibrary.getRenderContent(),
			canvasData: editor.getExportCanvasData(),
			exportSettings: editor.getSceneSnapshotSettings(),
			target: EXPORT_TARGETS['still:png'],
			timestamp,
			callbacks: { onStatus: () => {}, onProgress: () => {}, isCancelled: () => false, createMask: (layer) => editor.maskCompositor.getMaskData(layer), renderSlotMasks: (layer) => getLayerManagerForType(editor, layer.type).renderSlotMasks(layer), ensureTextFont: (fontId) => FontLibrary.ensureLoaded(fontId) }
		});
		editor.sceneCompositor.releaseDecodedSources();
		const data = composed.imageData.data;
		const still = editor.originalImageData.data;
		let hash = 0, differsFromStill = 0;
		for (let index = 0; index < data.length; index++) {
			hash = (hash * 31 + data[index]) >>> 0;
			if (data[index] !== still[index]) differsFromStill++;
		}
		return {
			hash,
			differsFromStill,
			width: composed.width,
			probes: probes.map(([x, y]) => Array.from(data.slice((y * composed.width + x) * 4, (y * composed.width + x) * 4 + 4)))
		};
	}, { timestamp, probes });
}

const element = (page) => page.evaluate(() => {
	const image = document.querySelector('.base-animation-element');
	return image ? { left: image.style.left, top: image.style.top, width: image.style.width, height: image.style.height, clip: image.style.clipPath, filter: image.style.filter, opacity: image.style.opacity } : null;
});

(async () => {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	await context.addInitScript(() => { localStorage.clear(); localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'); });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor?.settingsStore);
	await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach((modal) => modal.classList.remove('visible')));

	// Detection, the preview element and the panel.
	await loadAnimatedBase(page);
	const loaded = await page.evaluate(() => {
		const editor = window.editor;
		const source = editor.baseImageSource;
		editor.layerManager.setActiveLayer(editor.layerManager.getBaseLayer().id);
		return {
			frames: source.animation?.frameCount, duration: source.animation?.totalDuration, placement: source.placement,
			canvas: [editor.originalCanvas.width, editor.originalCanvas.height],
			sectionHidden: document.getElementById('baseBackgroundAnimationSection').hidden,
			checked: document.getElementById('baseBackgroundAnimate').checked,
			badge: document.getElementById('baseBackgroundImageBadges').textContent,
			note: document.getElementById('baseBackgroundAnimateNote').textContent
		};
	});
	assert(loaded.frames === 4 && loaded.duration === 800 && loaded.canvas.join() === '60,40', `Loaded: ${JSON.stringify(loaded)}`);
	assert(loaded.placement.width === 60 && loaded.placement.height === 40 && loaded.placement.clip.width === 60, `Placement: ${JSON.stringify(loaded.placement)}`);
	assert(!loaded.sectionHidden && loaded.checked && loaded.badge.includes('Animated') && loaded.note.startsWith('4 frames, 0.8 s'), `Panel: ${JSON.stringify(loaded)}`);
	let shown = await element(page);
	assert(shown && shown.width === '60px' && shown.height === '40px' && shown.left === '0px', `Preview element: ${JSON.stringify(shown)}`);
	console.log('PASS An uploaded GIF animates the base: timing, preview element and panel');

	// Export frames follow the GIF, and its first frame is the still base.
	const first = await compose(page, 0);
	const second = await compose(page, 250);
	const third = await compose(page, 450);
	assert(first.differsFromStill === 0, `The first export frame differs from the still base in ${first.differsFromStill} bytes`);
	assert(first.probes[0].join() === '204,51,85,255' && second.probes[0].join() === '51,170,119,255' && third.probes[0].join() === '51,85,204,255', `Frame colors: ${first.probes} | ${second.probes} | ${third.probes}`);
	console.log('PASS Export frames follow the GIF; frame one equals the still base');

	// Play animation off is exactly a still base; back on plays again.
	await page.evaluate(() => { const input = document.getElementById('baseBackgroundAnimate'); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
	await page.waitForTimeout(150);
	const off = [await compose(page, 0), await compose(page, 450)];
	assert(!(await element(page)) && off[0].hash === off[1].hash && off[1].differsFromStill === 0, 'Play animation off still animated');
	assert(await page.evaluate(() => window.editor.getExportCanvasData().baseAnimation === null), 'Play animation off left the export animated');
	await page.keyboard.press('Control+z');
	await page.waitForTimeout(250);
	assert(await element(page) && await page.evaluate(() => document.getElementById('baseBackgroundAnimate').checked), 'Undo did not turn Play animation back on');
	console.log('PASS Play animation switch, with undo');

	// Pause motion shows the still.
	await page.evaluate(() => window.editor.animationPanel.setPaused(true));
	await page.waitForTimeout(150);
	const pausedPixel = await page.evaluate(() => Array.from(window.editor.previewCtx.getImageData(1, 1, 1, 1).data).join());
	assert(!(await element(page)) && pausedPixel === '204,51,85,255', `Paused preview: ${pausedPixel}`);
	await page.evaluate(() => window.editor.animationPanel.setPaused(false));
	await page.waitForTimeout(150);
	assert(await element(page), 'Resuming motion did not bring the animation back');
	console.log('PASS Pause motion shows the still base');

	// Color adjust and opacity reach the preview element and every export frame.
	const adjusted = await page.evaluate(async () => {
		const editor = window.editor;
		const layer = editor.layerManager.getBaseLayer();
		layer.background.colorAdjust.hue = 90;
		layer.opacity = 50;
		editor.updatePreview();
		return document.querySelector('.base-animation-element').style.cssText;
	});
	assert(adjusted.includes('hue-rotate') && adjusted.includes('opacity: 0.5'), `Adjusted element: ${adjusted}`);
	const adjustedFrame = await compose(page, 250);
	assert(adjustedFrame.probes[0][3] === 128 && adjustedFrame.probes[0].slice(0, 3).join() !== '51,170,119', `Adjusted export frame: ${adjustedFrame.probes}`);
	const adjustedStill = await page.evaluate(() => {
		const editor = window.editor;
		const layer = editor.layerManager.getBaseLayer();
		const expected = adjustImageDataCopy(editor.originalImageData, layer.background.colorAdjust, layer.opacity);
		return Array.from(expected.data.slice(4 * 61, 4 * 61 + 4));
	});
	const adjustedFirst = await compose(page, 0);
	// Half-transparent pixels pass through a premultiplied canvas, which can
	// move a channel by one.
	assert(adjustedFirst.probes[0].every((value, channel) => Math.abs(value - adjustedStill[channel]) <= 1), `Adjusted first frame ${adjustedFirst.probes[0]} is not the adjusted still ${adjustedStill}`);
	await page.evaluate(() => { const layer = window.editor.layerManager.getBaseLayer(); layer.background.colorAdjust.hue = 0; layer.opacity = 100; window.editor.updatePreview(); });
	console.log('PASS Color adjust and opacity apply to the preview and to each export frame');

	// A crop: the animation keeps its place under the smaller canvas.
	await page.evaluate(() => window.editor.resizeCanvas(40, 30, -10, -5));
	await page.waitForTimeout(150);
	shown = await element(page);
	assert(shown.left === '-10px' && shown.top === '-5px' && shown.clip === 'inset(5px 10px)', `Cropped element: ${JSON.stringify(shown)}`);
	const cropped = await compose(page, 0);
	assert(cropped.width === 40 && cropped.differsFromStill === 0, `Cropped first frame differs from the cropped still in ${cropped.differsFromStill} bytes`);
	const croppedLater = await compose(page, 250);
	assert(croppedLater.probes[0].join() === '51,170,119,255', `Cropped later frame: ${croppedLater.probes}`);
	console.log('PASS Crop moves the animation with the canvas');

	// An extension: the still margin shows around the animation.
	await page.evaluate(() => window.editor.resizeCanvas(80, 60, 20, 15, { extensionColor: '#112233' }));
	await page.waitForTimeout(150);
	const extended = await compose(page, 250, [[2, 2], [40, 30]]);
	assert(extended.probes[0].join() === '17,34,51,255', `Extension margin in export: ${extended.probes[0]}`);
	assert(extended.probes[1].join() !== '17,34,51,255', 'The animation is missing inside an extended canvas');
	const extendedFirst = await compose(page, 0);
	assert(extendedFirst.differsFromStill === 0, `Extended first frame differs from the still in ${extendedFirst.differsFromStill} bytes`);
	const marginPreview = await page.evaluate(() => ({
		margin: Array.from(window.editor.previewCtx.getImageData(2, 2, 1, 1).data).join(),
		under: window.editor.previewCtx.getImageData(40, 30, 1, 1).data[3]
	}));
	assert(marginPreview.margin === '17,34,51,255' && marginPreview.under === 0, `Preview plate: ${JSON.stringify(marginPreview)}`);
	console.log('PASS Canvas extension shows its margin around the animation, in preview and export');

	// Undo restores the placement with the canvas.
	await page.keyboard.press('Control+z');
	await page.waitForTimeout(300);
	const undone = await page.evaluate(() => ({ size: [window.editor.originalCanvas.width, window.editor.originalCanvas.height], placement: window.editor.baseImageSource.placement }));
	assert(undone.size.join() === '40,30' && undone.placement.x === -10 && undone.placement.y === -5, `After undo: ${JSON.stringify(undone)}`);
	assert((await compose(page, 0)).differsFromStill === 0, 'After undo the first frame no longer matches the still');
	console.log('PASS Undo restores the animation placement');

	// The animated export: the GIF's loop, twice the same bytes.
	const exportOnce = () => page.evaluate(async () => {
		const editor = window.editor;
		setActiveExportTarget(editor.exportSettings, 'animation:gif');
		const originalShow = editor.exportResultPresenter.show.bind(editor.exportResultPresenter);
		const result = await new Promise((resolve, reject) => {
			setTimeout(() => reject(new Error('Animated export timed out')), 60000);
			editor.exportResultPresenter.show = (payload) => { editor.exportResultPresenter.show = originalShow; resolve(payload); };
			editor.exportCurrentTarget();
		});
		const bytes = new Uint8Array(await result.blob.arrayBuffer());
		let hash = 0;
		for (const byte of bytes) hash = (hash * 31 + byte) >>> 0;
		return { hash, size: bytes.length, frames: result.frameCount, duration: result.duration, sources: result.timelinePlan.sourceAnalysis.map((source) => source.label) };
	});
	const exportA = await exportOnce();
	const exportB = await exportOnce();
	assert(exportA.frames === 4 && Math.abs(exportA.duration - 0.8) < 0.01, `Animated export: ${JSON.stringify(exportA)}`);
	assert(exportA.sources.includes('spinner.gif'), `Export sources: ${exportA.sources}`);
	assert(exportA.hash === exportB.hash && exportA.size === exportB.size, 'Two exports of the same animated base differ');
	console.log('PASS Animated GIF export keeps the loop and is stable');

	// Include Base Image off: the animation is neither drawn nor part of the loop.
	const withoutBase = await page.evaluate(async () => {
		const editor = window.editor;
		const estimate = await editor.sceneCompositor.estimateLoopDuration({ layers: editor.layers.filter((layer) => layer.visible), library: editor.glitterLibrary.getRenderContent(), fallbackDuration: 110, baseImage: false, baseAnimation: editor.baseBackgroundManager.getAnimation() });
		return estimate.estimatedFrameCount;
	});
	assert(withoutBase === 1, `Without the base image the loop still had ${withoutBase} frames`);
	console.log('PASS A base that is not exported does not set the loop');

	// Project round-trip keeps the animation and where it sits.
	const reopened = await page.evaluate(async () => {
		const editor = window.editor;
		const blob = await editor.projectSerializer.serializeToBlob();
		const text = JSON.parse(await blob.text());
		await editor.projectSerializer.loadFile(new File([blob], 'animated.glitter.json', { type: 'application/json' }));
		const source = editor.baseImageSource;
		return { saved: Boolean(text.baseImage.animation), frames: source.animation?.frameCount, placement: source.placement, size: [editor.originalCanvas.width, editor.originalCanvas.height] };
	});
	await page.waitForTimeout(300);
	assert(reopened.saved && reopened.frames === 4 && reopened.size.join() === '40,30' && reopened.placement.x === -10 && reopened.placement.width === 60, `Reopened: ${JSON.stringify(reopened)}`);
	assert(await element(page), 'The reopened project does not play its base animation');
	assert((await compose(page, 250)).probes[0].join() === '51,170,119,255' && (await compose(page, 0)).differsFromStill === 0, 'The reopened project exports the wrong frames');
	// Saved again from the reopened state, where the base file is the still canvas.
	const resaved = await page.evaluate(async () => {
		const editor = window.editor;
		const blob = await editor.projectSerializer.serializeToBlob();
		await editor.projectSerializer.loadFile(new File([blob], 'animated-2.glitter.json', { type: 'application/json' }));
		return editor.baseImageSource.animation?.frameCount;
	});
	assert(resaved === 4, 'A second save lost the animated file');
	console.log('PASS Project save and reopen, twice');

	// Replace with a still, then with the GIF again.
	await page.evaluate(async () => {
		const canvas = document.createElement('canvas'); canvas.width = 50; canvas.height = 50;
		canvas.getContext('2d').fillRect(0, 0, 50, 50);
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
		await window.editor.replaceBaseImageFile(new File([blob], 'still.png', { type: 'image/png' }));
		window.editor.layerManager.setActiveLayer(window.editor.layerManager.getBaseLayer().id);
	});
	await page.waitForTimeout(200);
	const still = await page.evaluate(() => ({ animation: window.editor.baseImageSource.animation, hidden: document.getElementById('baseBackgroundAnimationSection').hidden, badge: document.getElementById('baseBackgroundImageBadges').textContent }));
	assert(!still.animation && still.hidden && !still.badge.includes('Animated') && !(await element(page)), `A still base kept animation state: ${JSON.stringify(still)}`);
	await loadAnimatedBase(page, { replace: true });
	assert(await element(page) && (await compose(page, 0)).differsFromStill === 0, 'Replacing a still with a GIF did not animate the base');
	console.log('PASS Replacing the base image with a still and back');

	// Over the limits a GIF opens as a still, with the reason.
	const limited = await page.evaluate(async () => {
		const real = window.readGifTiming;
		window.readGifTiming = (bytes) => ({ ...real(bytes), frameCount: CONFIG.canvas.limits.animatedBase.maxFrames + 1 });
		const file = window.editor.baseImageSource.animation.file;
		await window.editor.replaceBaseImageFile(file);
		window.readGifTiming = real;
		return { animation: window.editor.baseImageSource.animation, toast: document.getElementById('errorText').textContent };
	});
	assert(!limited.animation && limited.toast.includes('opened as a still image'), `Over the limit: ${JSON.stringify(limited)}`);
	console.log('PASS A GIF over the limits opens as a still and says why');

	assert(errors.length === 0, `Page errors: ${errors.join(' | ')}`);
	await browser.close();
	console.log('\nAnimated base verification passed');
})().catch((error) => { console.error(`FAIL ${error.message}`); process.exit(1); });
