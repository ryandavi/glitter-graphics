'use strict';

// Take Photo (js/systems/CameraCapture.js) against Chromium's fake camera:
// the entry points, live preview, mirror matching the preview, retake, Use
// opening the photo as the document at the fitted canvas size, the stream
// stopping on Use and on close, and a blocked camera reporting one message.

const assert = require('assert/strict');
const { chromium } = require('playwright');
const { openApp } = require('../lib/app');

(async () => {
	const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
	try {
		const { page, errors } = await openApp({ browser });
		assert(await page.evaluate(() => !document.getElementById('takePhotoBtn').hidden && !document.getElementById('takePhotoMenuItem').hidden), 'Take Photo shows on the start card and in the menu');
		const ready = () => page.waitForFunction(() => editor.cameraCapture?.stream && document.getElementById('cameraVideo').videoWidth > 0);

		await page.locator('#takePhotoBtn').click();
		await ready();
		const live = await page.evaluate(() => ({ mirror: document.getElementById('cameraMirror').checked, mirrored: document.getElementById('cameraStage').classList.contains('is-mirrored'), take: !document.getElementById('cameraTakeBtn').hidden, use: document.getElementById('cameraUseBtn').hidden }));
		assert.deepEqual(live, { mirror: true, mirrored: true, take: true, use: true }, 'A front camera previews mirrored');

		// A paused frame makes the capture comparable with an unmirrored draw.
		const mirror = await page.evaluate(() => {
			const video = document.getElementById('cameraVideo');
			video.pause();
			document.getElementById('cameraTakeBtn').click();
			const still = document.getElementById('cameraStill'), plain = document.createElement('canvas');
			plain.width = still.width; plain.height = still.height;
			plain.getContext('2d').drawImage(video, 0, 0, plain.width, plain.height);
			const a = still.getContext('2d').getImageData(0, 0, still.width, still.height).data, b = plain.getContext('2d').getImageData(0, 0, plain.width, plain.height).data;
			let mismatched = 0;
			for (let y = 0; y < still.height; y += 7) for (let x = 0; x < still.width; x += 7) {
				const i = (y * still.width + x) * 4, j = (y * still.width + still.width - 1 - x) * 4;
				if (Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]) > 24) mismatched++;
			}
			const limits = CONFIG.canvas.limits;
			return { mismatched, fits: still.width <= limits.maxWidth && still.height <= limits.maxHeight, shown: !still.hidden && video.hidden, buttons: [document.getElementById('cameraRetakeBtn').hidden, document.getElementById('cameraUseBtn').hidden, document.getElementById('cameraTakeBtn').hidden] };
		});
		assert.equal(mirror.mismatched, 0, 'The mirrored still is the preview flipped');
		assert(mirror.fits && mirror.shown, 'The still fits the canvas limits and replaces the preview');
		assert.deepEqual(mirror.buttons, [false, false, true], 'After Take: Retake and Use Photo');

		await page.locator('#cameraRetakeBtn').click();
		assert(await page.evaluate(() => { document.getElementById('cameraVideo').play(); return !document.getElementById('cameraVideo').hidden && document.getElementById('cameraStill').hidden && !document.getElementById('cameraTakeBtn').hidden; }), 'Retake returns to the live preview');
		await page.locator('#cameraTakeBtn').click();
		const stillSize = await page.evaluate(() => ({ width: document.getElementById('cameraStill').width, height: document.getElementById('cameraStill').height }));
		await page.evaluate(() => { window.cameraStream = editor.cameraCapture.stream; });
		await page.locator('#cameraUseBtn').click();
		await page.waitForFunction(() => editor.originalImage != null);
		const used = await page.evaluate(() => ({ stopped: window.cameraStream.getTracks().every(track => track.readyState === 'ended'), open: editor.modalManager.isAnyOpen(), width: editor.originalCanvas.width, height: editor.originalCanvas.height }));
		assert.deepEqual(used, { stopped: true, open: false, ...stillSize }, 'Use Photo opens the photo as the document and stops the camera');

		// Closing stops the stream too.
		await page.evaluate(() => COMMANDS.takePhoto.run(editor));
		await ready();
		const closed = await page.evaluate(() => { const stream = editor.cameraCapture.stream; editor.modalManager.close('cameraModal'); return stream.getTracks().every(track => track.readyState === 'ended') && !editor.cameraCapture.stream; });
		assert(closed, 'Closing the modal stops the camera');

		// A blocked camera closes the modal with one status message.
		const denied = await page.evaluate(async () => {
			navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
			COMMANDS.takePhoto.run(editor);
			await new Promise(resolve => setTimeout(resolve, 300));
			return { open: editor.modalManager.isAnyOpen(), status: document.getElementById('statusText')?.textContent || '' };
		});
		assert(!denied.open && /blocked/.test(denied.status), `A blocked camera explains itself: ${JSON.stringify(denied)}`);
		assert.deepEqual(errors, []);
		console.log('PASS Take Photo: entry points, mirror, retake, use, stream stop and blocked camera');
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
