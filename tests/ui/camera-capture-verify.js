'use strict';

// Take Photo (js/systems/CameraCapture.js) against Chromium's fake camera:
// the entry points, live preview, mirror matching the preview, retake, Use
// opening the photo as the document at the fitted canvas size, the shot
// modes (Grid size and cancel, GIF opening as an animated base with Bounce),
// an effect becoming a Filter layer above the base, the stream stopping on
// Use and on close, a blocked camera reporting one message, and a listed
// camera that cannot be found hiding Take Photo.

const assert = require('assert/strict');
const { chromium } = require('playwright');
const { openApp } = require('../lib/app');

(async () => {
	const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
	try {
		const { page, errors } = await openApp({ browser });
		assert(await page.evaluate(() => !document.getElementById('takePhotoBtn').hidden && !document.getElementById('takePhotoMenuItem').hidden), 'Take Photo shows on the start card and in the menu');
		const ready = () => page.waitForFunction(() => editor.cameraCapture?.stream && document.getElementById('cameraVideo').videoWidth > 0);
		const openBooth = async (mode) => {
			await page.evaluate(() => COMMANDS.takePhoto.run(editor));
			await ready();
			await page.locator(`#cameraModes [data-mode="${mode}"]`).click();
		};
		const review = () => page.waitForFunction(() => editor.cameraCapture.phase === 'review', null, { timeout: 15000 });

		await page.locator('#takePhotoBtn').click();
		await ready();
		const live = await page.evaluate(() => ({ mirror: document.getElementById('cameraMirror').checked, mirrored: document.getElementById('cameraStage').classList.contains('is-mirrored'), take: !document.getElementById('cameraTakeBtn').hidden, use: document.getElementById('cameraUseBtn').hidden, modes: [...document.querySelectorAll('#cameraModes [data-mode]')].map(button => button.textContent), effects: document.querySelectorAll('#cameraEffects .camera-effect').length }));
		assert.deepEqual(live, { mirror: true, mirrored: true, take: true, use: true, modes: ['Photo', 'Grid', 'Strip', 'GIF'], effects: 9 }, 'A front camera previews mirrored, with four modes and a 3×3 Effects grid');

		// A paused frame makes the capture comparable with an unmirrored draw.
		await page.locator('#cameraModes [data-mode="photo"]').click();
		await page.evaluate(() => document.getElementById('cameraVideo').pause());
		await page.locator('#cameraTakeBtn').click();
		await review();
		const mirror = await page.evaluate(() => {
			const video = document.getElementById('cameraVideo');
			const still = editor.cameraCapture.result.image, plain = document.createElement('canvas');
			plain.width = still.width; plain.height = still.height;
			plain.getContext('2d').drawImage(video, 0, 0, plain.width, plain.height);
			const a = still.getContext('2d').getImageData(0, 0, still.width, still.height).data, b = plain.getContext('2d').getImageData(0, 0, plain.width, plain.height).data;
			let mismatched = 0;
			for (let y = 0; y < still.height; y += 7) for (let x = 0; x < still.width; x += 7) {
				const i = (y * still.width + x) * 4, j = (y * still.width + still.width - 1 - x) * 4;
				if (Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]) > 24) mismatched++;
			}
			const limits = CONFIG.canvas.limits;
			return { mismatched, fits: still.width <= limits.maxWidth && still.height <= limits.maxHeight, buttons: [document.getElementById('cameraRetakeBtn').hidden, document.getElementById('cameraUseBtn').hidden, document.getElementById('cameraTakeBtn').hidden], bounceHidden: document.getElementById('cameraBounce').closest('.property-row').hidden };
		});
		assert.equal(mirror.mismatched, 0, 'The mirrored still is the preview flipped');
		assert(mirror.fits, 'The still fits the canvas limits');
		assert.deepEqual(mirror.buttons, [false, false, true], 'After the shutter: Retake and Use Photo');
		assert(mirror.bounceHidden, 'Bounce only shows when reviewing a GIF');
		await page.waitForFunction(() => !document.getElementById('cameraView').hidden && document.getElementById('cameraView').width === editor.cameraCapture.result.image.width);

		await page.locator('#cameraRetakeBtn').click();
		await page.evaluate(() => document.getElementById('cameraVideo').play());
		await page.waitForFunction(() => editor.cameraCapture.phase === 'live' && document.getElementById('cameraView').hidden && !document.getElementById('cameraTakeBtn').hidden);
		await page.locator('#cameraTakeBtn').click();
		await review();
		const stillSize = await page.evaluate(() => ({ width: editor.cameraCapture.result.image.width, height: editor.cameraCapture.result.image.height }));
		await page.evaluate(() => { window.cameraStream = editor.cameraCapture.stream; });
		await page.locator('#cameraUseBtn').click();
		await page.waitForFunction(() => editor.originalImage != null && !editor.modalManager.isAnyOpen());
		const used = await page.evaluate(() => ({ stopped: window.cameraStream.getTracks().every(track => track.readyState === 'ended'), width: editor.originalCanvas.width, height: editor.originalCanvas.height, filters: editor.layers.filter(layer => layer.type === LayerType.FILTER).length }));
		assert.deepEqual(used, { stopped: true, filters: 0, ...stillSize }, 'Use Photo opens the photo as the document, with no effect layer, and stops the camera');

		// Grid: four shots composed 2×2 with gutters, inside the canvas limits.
		await openBooth('grid');
		await page.locator('#cameraTakeBtn').click();
		await page.waitForFunction(() => /2 of 4/.test(document.getElementById('cameraCountdownBadge').textContent));
		await review();
		const grid = await page.evaluate(() => {
			const { result, ui } = editor.cameraCapture, size = editor.cameraCapture.shotSize(CONFIG.tools.camera.modes.grid), limits = CONFIG.canvas.limits;
			return { width: result.image.width, height: result.image.height, expected: [2 * size.width + 3 * size.gutter, 2 * size.height + 3 * size.gutter], fits: result.image.width <= limits.maxWidth && result.image.height <= limits.maxHeight, corner: Array.from(result.image.getContext('2d').getImageData(0, 0, 1, 1).data), video: ui.video.videoWidth, remembered: PREFERENCES.get('cameraMode') };
		});
		assert.deepEqual([grid.width, grid.height], grid.expected, 'Grid composes four cells and three gutters each way');
		assert(grid.fits && grid.remembered === 'grid', `Grid fits the limits and the mode is remembered: ${JSON.stringify(grid)}`);
		assert.deepEqual(grid.corner, [255, 255, 255, 255], 'The gutter is the CONFIG background');

		// Closing mid-sequence cancels it and stops the camera.
		await page.locator('#cameraRetakeBtn').click();
		await page.locator('#cameraTakeBtn').click();
		await page.waitForFunction(() => editor.cameraCapture.sequence);
		const cancelled = await page.evaluate(async () => {
			const stream = editor.cameraCapture.stream;
			editor.modalManager.close('cameraModal');
			await new Promise(resolve => setTimeout(resolve, 1500));
			return { stopped: stream.getTracks().every(track => track.readyState === 'ended'), sequence: editor.cameraCapture.sequence, phase: editor.cameraCapture.phase, result: editor.cameraCapture.result };
		});
		assert.deepEqual(cancelled, { stopped: true, sequence: null, phase: 'live', result: null }, 'Closing mid-sequence cancels it and stops the camera');

		// GIF: eight frames, Bounce on by default, opened as an animated base.
		await openBooth('gif');
		await page.locator('#cameraTakeBtn').click();
		await review();
		const gif = await page.evaluate(() => {
			const capture = editor.cameraCapture, bounce = document.getElementById('cameraBounce');
			const counts = [capture.result.frames.length, capture.reviewFrames().length];
			bounce.click();
			counts.push(capture.reviewFrames().length);
			bounce.click();
			return { counts, bounceShown: !bounce.closest('.property-row').hidden, use: document.querySelector('#cameraUseBtn .name').textContent };
		});
		assert.deepEqual(gif, { counts: [8, 14, 8], bounceShown: true, use: 'Use GIF' }, 'GIF review: 8 frames, Bounce plays 14, toggling changes it instantly');

		// Effect: the chosen look previews on the stage and becomes a Filter layer above the base.
		await page.locator('#cameraEffectsBtn').click();
		await page.waitForFunction(() => document.querySelector('#cameraEffects [data-effect="warp:bulge"] canvas').width > 0);
		await page.locator('#cameraEffects [data-effect="warp:bulge"]').click();
		assert(await page.evaluate(() => document.getElementById('cameraEffects').hidden && /Bulge/.test(document.getElementById('cameraEffectsBtn').textContent)), 'Choosing an effect closes the grid and names it');
		await page.locator('#cameraUseBtn').click();
		await page.waitForFunction(() => !editor.modalManager.isAnyOpen() && editor.baseImageSource?.animation && editor.layers.some(layer => layer.type === LayerType.FILTER), null, { timeout: 30000 });
		const opened = await page.evaluate(() => {
			const filterIndex = editor.layers.findIndex(layer => layer.type === LayerType.FILTER);
			const baseIndex = editor.layers.findIndex(layer => layer.type === LayerType.BASE_IMAGE);
			const filter = editor.layers[filterIndex].filterData;
			return { frames: editor.baseImageSource.animation.frameCount, delay: editor.baseImageSource.animation.frameDelays[0] === CONFIG.tools.camera.modes.gif.intervalMs, look: [filter.type, filter.shape], aboveBase: filterIndex === baseIndex + 1 };
		});
		assert.deepEqual(opened, { frames: 14, delay: true, look: ['warp', 'bulge'], aboveBase: true }, `The GIF opens as an animated base with the effect as a Filter layer: ${JSON.stringify(opened)}`);

		// A blocked camera closes the modal with one error message and keeps Take Photo.
		const failWith = (name) => page.evaluate(async (errorName) => {
			editor.notifications.dismissError();
			navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Failed', errorName));
			COMMANDS.takePhoto.run(editor);
			await new Promise(resolve => setTimeout(resolve, 300));
			return { open: editor.modalManager.isAnyOpen(), message: document.getElementById('errorText')?.textContent || '', buttonHidden: document.getElementById('takePhotoBtn').hidden };
		}, name);
		const denied = await failWith('NotAllowedError');
		assert(!denied.open && /blocked/.test(denied.message) && !denied.buttonHidden, `A blocked camera explains itself: ${JSON.stringify(denied)}`);
		// A listed camera that cannot be opened hides Take Photo everywhere.
		const missing = await failWith('NotFoundError');
		assert(!missing.open && /No camera/.test(missing.message) && missing.buttonHidden, `A missing camera hides Take Photo: ${JSON.stringify(missing)}`);
		assert(await page.evaluate(() => document.getElementById('takePhotoMenuItem').hidden && !CameraCapture.isSupported()), 'The menu item hides too');
		assert.deepEqual(errors, []);
		console.log('PASS Take Photo: entry points, mirror, retake, use, Grid, cancel, GIF + Bounce, effect layer, stream stop, blocked and missing camera');
	} finally { await browser.close(); }

})().catch(error => { console.error(error); process.exitCode = 1; });
