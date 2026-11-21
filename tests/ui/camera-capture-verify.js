'use strict';

// Take Photo (js/systems/CameraCapture.js) against Chromium's fake camera:
// the entry points, live preview, mirror matching the preview, a footer that
// never hides anything, the roll of takes (shutter again adds one, picking a
// take reviews it), Use opening the selected take at the fitted canvas size,
// the shot modes (Grid size, fill-in and cancel, GIF opening as an animated
// base with Bounce and Speed, stop motion), the aspect crop (Square photo by
// canvas size, square Grid cells), an effect and the Webcam look becoming
// Filter layers above the base, the stream stopping on Use and on close, a
// blocked camera reporting one message, and a listed camera that cannot be
// found hiding Take Photo.

const assert = require('assert/strict');
const { chromium } = require('playwright');
const { openApp } = require('../lib/app');

(async () => {
	const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
	try {
		const { page, errors } = await openApp({ browser });
		assert(await page.evaluate(() => [...document.querySelectorAll('[data-take-photo]')].every(button => !button.disabled) && !document.getElementById('takePhotoMenuItem').hidden), 'Take Photo is enabled on the start screen and shows in the menu');
		const ready = () => page.waitForFunction(() => editor.cameraCapture?.stream && document.getElementById('cameraVideo').videoWidth > 0);
		const openBooth = async (mode) => {
			await page.evaluate(() => COMMANDS.takePhoto.run(editor));
			await ready();
			await page.locator(`#cameraModes [data-mode="${mode}"]`).click();
		};
		const review = () => page.waitForFunction(() => editor.cameraCapture.phase === 'review', null, { timeout: 15000 });

		const footer = () => page.evaluate(() => ['cameraModes', 'cameraTakeBtn', 'cameraEffectsBtn', 'cameraUseBtn'].map(id => {
			const element = document.getElementById(id);
			const box = element.getBoundingClientRect();
			return [id, !element.hidden && box.width > 0, Math.round(box.left), Math.round(box.width)];
		}));

		await page.locator('[data-take-photo]:visible').click();
		await ready();
		const live = await page.evaluate(() => ({ mirror: document.getElementById('cameraMirror').checked, mirrored: document.getElementById('cameraStage').classList.contains('is-mirrored'), useDisabled: document.getElementById('cameraUseBtn').disabled, use: document.querySelector('#cameraUseBtn .name').textContent, modes: [...document.querySelectorAll('#cameraModes [data-mode]')].map(button => button.getAttribute('aria-label')), effects: document.querySelectorAll('#cameraEffects .camera-effect').length, roll: document.getElementById('cameraRoll').classList.contains('is-empty') }));
		assert.deepEqual(live, { mirror: true, mirrored: true, useDisabled: true, use: 'Use', modes: ['Photo', 'Grid', 'Strip', 'GIF'], effects: 9, roll: true }, 'A front camera previews mirrored, with four modes, a 3×3 Effects grid, an empty roll and Use disabled');
		await page.locator('#cameraModes [data-mode="photo"]').click();
		const footerLive = await footer();

		// A paused frame makes the capture comparable with an unmirrored draw.
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
			return { mismatched, fits: still.width <= limits.maxWidth && still.height <= limits.maxHeight, useDisabled: document.getElementById('cameraUseBtn').disabled, videoOpacity: getComputedStyle(video).opacity, playbackHidden: document.getElementById('cameraPlaybackSet').hidden, takes: document.querySelectorAll('#cameraRoll .camera-take').length };
		});
		assert.equal(mirror.mismatched, 0, 'The mirrored still is the preview flipped');
		assert(mirror.fits, 'The still fits the canvas limits');
		assert.deepEqual([mirror.useDisabled, mirror.takes], [false, 1], 'After the shutter: Use is enabled and the roll holds the take');
		assert(mirror.playbackHidden, 'Playback (Bounce, Speed) only shows when reviewing a GIF');
		assert.deepEqual(await footer(), footerLive, 'The footer keeps every control in place after a take');
		await page.waitForFunction(() => !document.getElementById('cameraView').hidden && document.getElementById('cameraView').width === editor.cameraCapture.result.image.width);

		// The shutter shoots again from review; picking a take reviews it, and
		// picking it again goes back to the camera with it still selected.
		await page.evaluate(() => document.getElementById('cameraVideo').play());
		await page.locator('#cameraTakeBtn').click();
		await page.waitForFunction(() => editor.cameraCapture.roll.length === 2 && editor.cameraCapture.phase === 'review');
		const first = page.locator('#cameraRoll .camera-take').first();
		await first.click();
		const picked = await page.evaluate(() => ({ selected: editor.cameraCapture.selected === editor.cameraCapture.roll[0], pressed: document.querySelector('#cameraRoll .camera-take').getAttribute('aria-pressed') }));
		assert.deepEqual(picked, { selected: true, pressed: 'true' }, 'Picking the first take selects it');
		await first.click();
		assert.deepEqual(await page.evaluate(() => [editor.cameraCapture.phase, editor.cameraCapture.selected === editor.cameraCapture.roll[0], document.getElementById('cameraUseBtn').disabled]), ['live', true, false], 'Picking it again returns to the camera, still selected for Use');
		const roll = await page.evaluate(() => {
			const capture = editor.cameraCapture, limit = CONFIG.tools.camera.roll.size;
			for (let added = 0; added < limit + 2; added++) capture.addTake({ mode: 'photo', image: capture.roll[0].image, aspect: 'original' });
			return { length: capture.roll.length, buttons: document.querySelectorAll('#cameraRoll .camera-take').length, limit };
		});
		assert.deepEqual([roll.length, roll.buttons], [roll.limit, roll.limit], 'The roll keeps the newest takes up to its limit');
		await page.locator('#cameraRoll .camera-take').last().click();
		const stillSize = await page.evaluate(() => ({ width: editor.cameraCapture.result.image.width, height: editor.cameraCapture.result.image.height }));
		await page.evaluate(() => { window.cameraStream = editor.cameraCapture.stream; });
		await page.locator('#cameraUseBtn').click();
		await page.waitForFunction(() => editor.originalImage != null && !editor.modalManager.isAnyOpen());
		const used = await page.evaluate(() => ({ stopped: window.cameraStream.getTracks().every(track => track.readyState === 'ended'), width: editor.originalCanvas.width, height: editor.originalCanvas.height, filters: editor.layers.filter(layer => layer.type === LayerType.FILTER).length }));
		assert.deepEqual(used, { stopped: true, filters: 0, ...stillSize }, 'Use opens the photo as the document, with no effect layer, and stops the camera');

		// Square: the stage dims outside the crop, and Use crops the photo by
		// canvas size in one undo step.
		await openBooth('photo');
		await page.locator('#cameraAspect [data-value="square"]').click();
		const guide = await page.evaluate(() => {
			const stage = document.getElementById('cameraStage').getBoundingClientRect(), crop = document.getElementById('cameraCrop');
			const box = crop.getBoundingClientRect();
			return { shown: !crop.hidden, square: Math.abs(box.width - box.height) <= 2, inside: box.width < stage.width, remembered: PREFERENCES.get('cameraAspect') };
		});
		assert.deepEqual(guide, { shown: true, square: true, inside: true, remembered: 'square' }, `Square shows a square crop guide: ${JSON.stringify(guide)}`);
		await page.locator('#cameraTakeBtn').click();
		await review();
		const full = await page.evaluate(() => ({ width: editor.cameraCapture.result.image.width, height: editor.cameraCapture.result.image.height }));
		await page.locator('#cameraUseBtn').click();
		await page.waitForFunction(() => !editor.modalManager.isAnyOpen() && editor.originalCanvas.width === editor.originalCanvas.height);
		assert.equal(await page.evaluate(() => editor.originalCanvas.width), Math.min(full.width, full.height), 'Use crops the full frame to a centred square');
		await page.evaluate(() => editor.undo());
		await page.waitForFunction((size) => editor.originalCanvas.width === size.width && editor.originalCanvas.height === size.height, full);

		// Grid: four square cells composed 2×2 with gutters, inside the canvas
		// limits; the take fills in on the roll while it is shot.
		await openBooth('grid');
		await page.locator('#cameraTakeBtn').click();
		await page.waitForFunction(() => /2 of 4/.test(document.getElementById('cameraCountdownBadge').textContent));
		assert(await page.evaluate(() => editor.cameraCapture.roll.length === 1 && editor.cameraCapture.roll[0].pending && Boolean(document.querySelector('#cameraRoll .camera-take.is-pending'))), 'The Grid take shows on the roll while shooting');
		await review();
		const grid = await page.evaluate(() => {
			const { result } = editor.cameraCapture, size = editor.cameraCapture.layoutCell(result), limits = CONFIG.canvas.limits;
			return { width: result.image.width, height: result.image.height, expected: [2 * size.width + 3 * size.gutter, 2 * size.height + 3 * size.gutter], square: size.width === size.height, fits: result.image.width <= limits.maxWidth && result.image.height <= limits.maxHeight, corner: Array.from(result.image.getContext('2d').getImageData(0, 0, 1, 1).data), remembered: PREFERENCES.get('cameraMode'), guide: document.getElementById('cameraCrop').hidden };
		});
		assert.deepEqual([grid.width, grid.height], grid.expected, 'Grid composes four cells and three gutters each way');
		assert(grid.square && grid.fits && grid.remembered === 'grid', `Grid cells are square, fit the limits, and the mode is remembered: ${JSON.stringify(grid)}`);
		assert(grid.guide, 'A Grid take is already cropped, so its review has no guide');
		assert.deepEqual(grid.corner, [255, 255, 255, 255], 'The gutter is the CONFIG background');
		// Reviewing, the Aspect control re-crops the take from its full shots.
		await page.locator('#cameraAspect [data-value="original"]').click();
		const recropped = await page.evaluate(() => {
			const { result } = editor.cameraCapture, { videoWidth, videoHeight } = document.getElementById('cameraVideo'), cell = editor.cameraCapture.layoutCell(result);
			return { take: result.aspect, setting: PREFERENCES.get('cameraAspect'), cellRatio: cell.width / cell.height, camera: videoWidth / videoHeight, thumb: result.thumb.width / result.thumb.height, image: result.image.width / result.image.height };
		});
		assert(recropped.take === 'original' && recropped.setting === 'original' && Math.abs(recropped.cellRatio - recropped.camera) < 0.02 && Math.abs(recropped.thumb - recropped.image) < 0.05, `Aspect re-crops the reviewed Grid take and its thumbnail: ${JSON.stringify(recropped)}`);

		// Closing mid-sequence cancels it, empties the roll and stops the camera.
		await page.locator('#cameraTakeBtn').click();
		await page.waitForFunction(() => editor.cameraCapture.sequence);
		const cancelled = await page.evaluate(async () => {
			const stream = editor.cameraCapture.stream;
			editor.modalManager.close('cameraModal');
			await new Promise(resolve => setTimeout(resolve, 1500));
			return { stopped: stream.getTracks().every(track => track.readyState === 'ended'), sequence: editor.cameraCapture.sequence, phase: editor.cameraCapture.phase, result: editor.cameraCapture.result, roll: editor.cameraCapture.roll.length };
		});
		assert.deepEqual(cancelled, { stopped: true, sequence: null, phase: 'live', result: null, roll: 0 }, 'Closing mid-sequence cancels it, empties the roll and stops the camera');

		// Stop motion: eight frames a (shortened) gap apart, a flash each.
		await openBooth('gif');
		assert(await page.evaluate(() => !document.getElementById('cameraCapture').closest('.property-row').hidden), 'Capture shows in GIF mode');
		await page.locator('#cameraCapture [data-value="stopMotion"]').click();
		const stopMotion = await page.evaluate(async () => {
			const capture = CONFIG.tools.camera.modes.gif.capture.stopMotion, interval = capture.intervalMs;
			capture.intervalMs = 300;
			let flashes = 0;
			const flash = document.getElementById('cameraFlash');
			const observer = new MutationObserver(() => { if (flash.classList.contains('is-flashing')) flashes++; });
			observer.observe(flash, { attributes: true });
			const started = performance.now();
			await editor.cameraCapture.take();
			observer.disconnect();
			capture.intervalMs = interval;
			return { frames: editor.cameraCapture.result.frames.length, flashes, ms: performance.now() - started };
		});
		assert(stopMotion.frames === 8 && stopMotion.flashes >= 8 && stopMotion.ms >= 7 * 300 - 50, `Stop motion: 8 frames, a flash each, a gap apart: ${JSON.stringify(stopMotion)}`);
		await page.locator('#cameraCapture [data-value="burst"]').click();

		// GIF: eight frames, Bounce on by default, Speed sets the delay, opened as an animated base.
		await page.locator('#cameraTakeBtn').click();
		await page.waitForFunction(() => editor.cameraCapture.roll.length === 2 && editor.cameraCapture.phase === 'review', null, { timeout: 15000 });
		const gif = await page.evaluate(() => {
			const capture = editor.cameraCapture, bounce = document.getElementById('cameraBounce');
			const counts = [capture.result.frames.length, capture.reviewFrames().length];
			bounce.click();
			counts.push(capture.reviewFrames().length);
			bounce.click();
			return { counts, playbackShown: !document.getElementById('cameraPlaybackSet').hidden, use: document.querySelector('#cameraUseBtn .name').textContent };
		});
		assert.deepEqual(gif, { counts: [8, 14, 8], playbackShown: true, use: 'Use' }, 'GIF review: 8 frames, Bounce plays 14, toggling changes it instantly, Speed shows');
		await page.locator('#cameraSpeed [data-value="fast"]').click();

		// Effect + Webcam: both become Filter layers above the base, Webcam underneath.
		await page.locator('#cameraEffectsBtn').click();
		await page.waitForFunction(() => document.querySelector('#cameraEffects [data-effect="warp:bulge"] canvas').width > 0);
		await page.locator('#cameraEffects [data-effect="warp:bulge"]').click();
		assert(await page.evaluate(() => document.getElementById('cameraEffects').hidden && /Bulge/.test(document.getElementById('cameraEffectsBtn').textContent)), 'Choosing an effect closes the grid and names it');
		// WP-9a timing: one stage paint of the live camera through Webcam + Bulge.
		const webcamMs = await page.evaluate(async () => {
			const capture = editor.cameraCapture;
			document.querySelector('#cameraWebcam [data-value="720"]').click();
			const target = document.createElement('canvas'), video = document.getElementById('cameraVideo'), stageWidth = CONFIG.tools.camera.effects.webcamStageWidth[720];
			await capture.paintLook(target, video, stageWidth, capture.looksFor(capture.effect));
			const started = performance.now();
			for (let run = 0; run < 5; run++) await capture.paintLook(target, video, stageWidth, capture.looksFor(capture.effect));
			return (performance.now() - started) / 5;
		});
		process.stdout.write(`INFO Webcam + Bulge stage paint: ${Math.round(webcamMs)} ms (interval ${await page.evaluate(() => CONFIG.tools.camera.effects.stageIntervalMs)} ms)\n`);
		await page.locator('#cameraUseBtn').click();
		await page.waitForFunction(() => !editor.modalManager.isAnyOpen() && editor.baseImageSource?.animation && editor.layers.filter(layer => layer.type === LayerType.FILTER).length === 2, null, { timeout: 30000 });
		const opened = await page.evaluate(() => {
			const baseIndex = editor.layers.findIndex(layer => layer.type === LayerType.BASE_IMAGE);
			const looks = editor.layers.slice(baseIndex + 1, baseIndex + 3).map(layer => GlitterFilters.lookId(layer.filterData));
			return { frames: editor.baseImageSource.animation.frameCount, delay: editor.baseImageSource.animation.frameDelays[0] === CONFIG.tools.camera.modes.gif.speeds.fast.delayMs, looks };
		});
		assert.deepEqual(opened, { frames: 14, delay: true, looks: ['webcam', 'warp:bulge'] }, `The GIF opens as an animated base at the Fast speed, with Webcam then the effect above it: ${JSON.stringify(opened)}`);

		// A blocked camera closes the modal with one error message and keeps Take Photo.
		const failWith = (name) => page.evaluate(async (errorName) => {
			editor.notifications.dismissError();
			navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Failed', errorName));
			COMMANDS.takePhoto.run(editor);
			await new Promise(resolve => setTimeout(resolve, 300));
			return { open: editor.modalManager.isAnyOpen(), message: document.getElementById('errorText')?.textContent || '', buttonDisabled: document.getElementById('takePhotoBtn').disabled };
		}, name);
		const denied = await failWith('NotAllowedError');
		assert(!denied.open && /blocked/.test(denied.message) && !denied.buttonDisabled, `A blocked camera explains itself: ${JSON.stringify(denied)}`);
		// A listed camera that cannot be opened disables Take Photo on the start
		// screen and hides the menu item.
		const missing = await failWith('NotFoundError');
		assert(!missing.open && /No camera/.test(missing.message) && missing.buttonDisabled, `A missing camera disables Take Photo: ${JSON.stringify(missing)}`);
		assert(await page.evaluate(() => document.getElementById('takePhotoMenuItem').hidden && !CameraCapture.isSupported()), 'The menu item hides too');
		assert.deepEqual(errors, []);
		console.log('PASS Take Photo: entry points, mirror, fixed footer, roll, use, Square crop, Grid fill-in, cancel, stop motion, GIF + Bounce + Speed, effect + Webcam layers, stream stop, blocked and missing camera');
	} finally { await browser.close(); }

})().catch(error => { console.error(error); process.exitCode = 1; });
