'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(APP_URL, { waitUntil: 'networkidle' });
		const result = await page.evaluate(async () => {
			if (!await Mp4Exporter.isSupported()) return { supported: false };
			const maxCanvasConfig = await Mp4Exporter.getSupportedConfig(
				CONFIG.canvas.limits.maxWidth,
				CONFIG.canvas.limits.maxHeight,
				CONFIG.export.mp4.qualityPresets.high.bitrate
			);
			if (!maxCanvasConfig) {
				throw new Error(`No H.264 profile supports the ${CONFIG.canvas.limits.maxWidth}x${CONFIG.canvas.limits.maxHeight} canvas limit.`);
			}
			document.querySelector('[data-export-format="mp4"]').click();
			const lengthMode = document.getElementById('exportMp4LengthMode');
			lengthMode.value = 'loops';
			lengthMode.dispatchEvent(new Event('change', { bubbles: true }));
			const repeatInput = document.getElementById('exportMp4LoopCount');
			repeatInput.value = '15';
			repeatInput.dispatchEvent(new Event('input', { bubbles: true }));
			const settingsUi = {
				duration: document.getElementById('exportMp4Duration').textContent,
				loopCount: editor.exportSettings.mp4LoopCount,
				matteDisabled: document.getElementById('exportMatteColor').disabled,
				matteRowDisabled: document.getElementById('matteColorRow').classList.contains('disabled')
			};
			const width = 64;
			const height = 48;
			const frames = [];
			for (let index = 0; index < 3; index++) {
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d');
				ctx.fillStyle = ['#ff0088', '#00aaff', '#55dd44'][index];
				ctx.fillRect(0, 0, width, height);
				frames.push(ctx.getImageData(0, 0, width, height));
			}
			const exporter = new Mp4Exporter(new GifExporter());
			const originalDownload = window.downloadBlob;
			window.downloadBlob = () => {};
			let blob;
			try {
				blob = await exporter._encode(
					{ frames, frameDelay: 110, width, height, reductions: [] },
					{ matteColor: '#ffffff', mp4Quality: 'standard', mp4LoopCount: 2 },
					{ onProgress: () => {}, onStatus: () => {}, onComplete: () => {} }
				);
			} finally {
				window.downloadBlob = originalDownload;
			}
			const url = URL.createObjectURL(blob);
			const resultModal = {
				visible: document.getElementById('exportPreviewModal').classList.contains('visible'),
				videoVisible: !document.getElementById('exportPreviewVideo').hidden,
				imageHidden: document.getElementById('exportPreviewImage').hidden,
				duration: document.getElementById('exportStatDuration').textContent,
				size: document.getElementById('exportStatSize').textContent,
				saveLabel: document.querySelector('#exportPreviewSave .name').textContent,
				openLabel: document.querySelector('#exportPreviewOpen .name').textContent
			};
			const video = document.createElement('video');
			video.muted = true;
			video.src = url;
			await new Promise((resolve, reject) => {
				video.addEventListener('loadeddata', resolve, { once: true });
				video.addEventListener('error', () => reject(video.error || new Error('Video failed to load')), { once: true });
			});
			const output = {
				supported: true,
				size: blob.size,
				type: blob.type,
				width: video.videoWidth,
				height: video.videoHeight,
				duration: video.duration,
				resultModal,
				settingsUi
			};
			URL.revokeObjectURL(url);
			return output;
		});
		if (!result.supported) {
			console.log('SKIP MP4 verification: this Playwright browser has no WebCodecs H.264 encoder.');
			return;
		}
		if (result.type !== 'video/mp4' || result.size <= 0) throw new Error('MP4 Blob was empty or had the wrong MIME type.');
		if (result.width !== 64 || result.height !== 48 || !(result.duration >= 0.65 && result.duration <= 0.67)) throw new Error('MP4 did not decode with the expected 110 ms frame timing.');
		if (!result.resultModal.visible || !result.resultModal.videoVisible || !result.resultModal.imageHidden) throw new Error('MP4 result modal did not show its video preview.');
		if (result.resultModal.saveLabel !== 'Save MP4' || result.resultModal.openLabel !== 'Open MP4') throw new Error('MP4 result actions were not format-aware.');
		if (!result.resultModal.duration.includes('0.66s') || !result.resultModal.size.match(/\d/)) throw new Error('MP4 result stats were incomplete.');
		if (result.settingsUi.loopCount !== 15) throw new Error('MP4 loop count did not update beyond the former 10-repeat limit.');
		if (result.settingsUi.matteDisabled || result.settingsUi.matteRowDisabled) throw new Error('MP4 matte color remained disabled.');
		console.log(`PASS MP4 Blob (${result.size} bytes) decoded at ${result.width}x${result.height}, ${result.duration.toFixed(2)}s.`);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error?.stack || String(error));
	process.exit(1);
});
