'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const { chromium } = require('playwright');
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

async function exportBytes(page, target = 'still:png') {
	return page.evaluate(async target => {
		setActiveExportTarget(editor.exportSettings, target);
		editor.exportSettings.transparency = true;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Export timed out')), 20000);
			const show = editor.exportResultPresenter.show;
			editor.exportResultPresenter.show = async payload => {
				editor.exportResultPresenter.show = show;
				clearTimeout(timer);
				resolve(Array.from(new Uint8Array(await payload.blob.arrayBuffer())));
			};
			editor.exportCurrentTarget();
		});
	}, target);
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
		const errors = [];
		const requests = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('request', request => requests.push(request.url()));
		// A deterministic processor keeps lifecycle tests independent of model/CDN availability.
		// Real model inference is verified separately against the spike fixtures.
		await page.route('**/background-removal-worker.js*', route => route.fulfill({ contentType: 'text/javascript', body: `
			self.onmessage = async ({ data }) => {
				self.postMessage({ type: 'progress', label: 'Removing background…' });
				await new Promise(resolve => setTimeout(resolve, 250));
				const image = await createImageBitmap(data.blob);
				const canvas = new OffscreenCanvas(image.width, image.height);
				const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
				ctx.clearRect(0, 0, canvas.width / 2, canvas.height);
				self.postMessage({ type: 'result', blob: await canvas.convertToBlob({ type: 'image/png' }) });
			};` }));
		await page.goto(APP_URL);
		await page.waitForFunction(() => window.editor);
		assert(!requests.some(url => /BackgroundRemover|background-removal|isnet/u.test(url)), 'Remover loaded at boot');
		await page.evaluate(() => editor.loadBlankImage(32, 32, '#ffffff'));
		await page.waitForFunction(() => editor.originalImage);
		await page.evaluate(async () => {
			const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
			const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 16, 16);
			const blob = await new Promise(resolve => canvas.toBlob(resolve));
			const item = await editor.stickerLibrary.handleUserUpload(new File([blob], 'test.png', { type: 'image/png' }), { navigate: false });
			await editor.stickerManager.createStickerLayer(item.id);
			window.originalId = item.id;
			const layer = editor.layerManager.getActiveLayer();
			layer.name = 'My photo'; layer.transform.rotation = 17; layer.stickerData.colorAdjust.hue = 20;
			editor.saveState('Style sticker'); editor.setTool(ToolType.SELECT);
		});
		assert(await page.isVisible('#contextRemoveBackground'), 'Selected upload has no context action');
		assert(await page.evaluate(() => editor.stickerManager.canRemoveBackground()), 'PNG is ineligible');
		assert(await page.evaluate(() => {
			const item = editor.stickerLibrary.getItemById(originalId);
			item.hasTransparency = true;
			const transparentAllowed = editor.stickerManager.canRemoveBackground();
			item.isAnimated = true;
			const animatedRejected = !editor.stickerManager.canRemoveBackground();
			item.isAnimated = false; item.mimeType = 'image/gif';
			const gifRejected = !editor.stickerManager.canRemoveBackground();
			item.mimeType = 'image/jpeg'; const jpegAllowed = editor.stickerManager.canRemoveBackground();
			item.mimeType = 'image/png'; item.source = 'preset';
			const presetRejected = !editor.stickerManager.canRemoveBackground(); item.source = 'user-upload';
			const layer = editor.layerManager.getActiveLayer(); layer.locked = true;
			const lockedRejected = !editor.stickerManager.canRemoveBackground(); layer.locked = false;
			return transparentAllowed && animatedRejected && gifRejected && jpegAllowed && presetRejected && lockedRejected;
		}), 'Eligibility rules failed');
		const originalState = await page.evaluate(() => ({ history: editor.historyManager.history.length, uploads: editor.stickerLibrary.userContent.length }));
		await page.click('#contextRemoveBackground');
		await page.waitForSelector('#backgroundRemovalProgress.visible');
		await page.waitForFunction(() => editor.stickerManager.backgroundRemover.worker);
		assert(await page.isVisible('#backgroundRemovalProgress'), 'Loading animation is missing');
		assert.equal(await page.locator('#backgroundRemovalModal.visible').count(), 0, 'Processing opened a blocking dialog');
		assert(await page.evaluate(() => {
			editor.exportInProgress = true;
			editor.exportProgressPresenter.show({ label: 'PNG' });
			editor.exportProgressPresenter.update(25, 'Encoding PNG', 0, 0, { phaseKey: 'encoding' });
			const percent = document.getElementById('exportProgressPercent').textContent;
			document.getElementById('exportProgressCancel').click();
			const exportCancelled = editor.exportCancelled;
			editor.exportProgressPresenter.hide();
			editor.exportInProgress = false;
			return percent === '25%' && exportCancelled && editor.notifications.activitySuspended
				&& document.getElementById('backgroundRemovalProgress').classList.contains('visible');
		}), 'Shared progress lost export cancellation or released another task’s slot');
		await page.click('#backgroundRemovalProgressCancel');
		await page.waitForFunction(() => !editor.stickerManager.backgroundRemover.job);
		assert(await page.evaluate(() => !editor.stickerManager.backgroundRemover.worker), 'Cancel did not terminate inference');
		await page.click('#contextRemoveBackground');
		await page.waitForSelector('#backgroundRemovalModal.visible');
		await page.click('#backgroundRemovalDiscard');
		await page.waitForFunction(() => !editor.stickerManager.backgroundRemover.job);
		assert.deepEqual(await page.evaluate(() => ({ history: editor.historyManager.history.length, uploads: editor.stickerLibrary.userContent.length })), originalState, 'Discard changed the project');
		await page.click('#contextRemoveBackground');
		await page.waitForSelector('#backgroundRemovalModal.visible');
		await page.evaluate(() => { editor.layerManager.getActiveLayer().stickerSourceId = 'changed-during-processing'; });
		await page.click('#backgroundRemovalKeep');
		await page.waitForFunction(() => !editor.stickerManager.backgroundRemover.job);
		assert.deepEqual(await page.evaluate(() => ({ history: editor.historyManager.history.length, uploads: editor.stickerLibrary.userContent.length })), originalState, 'Stale result was committed');
		await page.evaluate(() => { editor.layerManager.getActiveLayer().stickerSourceId = originalId; });
		await page.click('#contextRemoveBackground');
		await page.waitForSelector('#backgroundRemovalModal.visible');
		fs.mkdirSync('.tmp/background-removal', { recursive: true });
		await page.screenshot({ path: '.tmp/background-removal/desktop.png' });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.screenshot({ path: '.tmp/background-removal/phone.png' });
		assert(await page.evaluate(() => {
			const box = document.querySelector('#backgroundRemovalModal .modal-content').getBoundingClientRect();
			return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
		}), 'Preview overflows phone viewport');
		await page.click('#backgroundRemovalKeep');
		await page.waitForFunction(() => !editor.stickerManager.backgroundRemover.job);
		const kept = await page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer();
			return { id: layer.stickerSourceId, history: editor.historyManager.history.length, uploads: editor.stickerLibrary.userContent.length,
				width: layer.stickerData.width, height: layer.stickerData.height, rotation: layer.transform.rotation, hue: layer.stickerData.colorAdjust.hue, name: layer.name,
				original: Boolean(editor.stickerLibrary.getItemById(originalId)) };
		});
		assert.equal(kept.history, originalState.history + 1, 'Keep created multiple undo steps');
		assert.equal(kept.uploads, originalState.uploads + 1);
		assert(kept.original && kept.width === 16 && kept.height === 16 && kept.rotation === 17 && kept.hue === 20 && kept.name === 'My photo', 'Keep lost source, size, transform or effects');
		assert(!await page.evaluate(() => editor.stickerManager.canRemoveBackground()), 'Cutout can be processed again');
		assert(!await page.isVisible('#contextRemoveBackground') && !await page.isVisible('#stickerRemoveBackground'), 'Cutout still shows Remove background');
		for (const width of [1280, 390]) {
			await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
			await page.waitForTimeout(500);
			for (const control of ['stickerAssetThumbnail', 'stickerAssetChange']) {
				await page.evaluate(() => {
					editor.mobileManager.closeAllDrawers({ immediate: true });
					editor.mobileManager.openLeadingSection();
				});
				// The shared Change button overlays the thumbnail; check both handlers.
				if (control === 'stickerAssetThumbnail') await page.locator(`#${control}`).dispatchEvent('click');
				else await page.locator(`#${control}`).click();
				assert(await page.evaluate(() => editor.stickerManager.pickerSession?.kind === 'asset'), 'Sticker control did not arm the asset picker');
				await page.waitForSelector(`.asset-option[data-id="${kept.id}"]`, { state: 'visible' });
				await page.locator('#libraryWindowClose').click();
				assert(!await page.evaluate(() => editor.stickerManager.pickerSession), 'Close did not close the picker');
			}
		}
		const exported = await exportBytes(page);
		assert.deepEqual(await exportBytes(page), exported, 'Repeated export changed pixels');
		await page.evaluate(() => editor.undo());
		assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().stickerSourceId), await page.evaluate(() => originalId), 'Undo did not restore original');
		await page.evaluate(() => editor.redo());
		assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().stickerSourceId), kept.id, 'Redo lost cutout');
		assert.deepEqual(await exportBytes(page), exported, 'Undo/redo changed export');
		await exportBytes(page, 'still:gif');
		await page.evaluate(async () => {
			const project = await editor.projectSerializer.serialize();
			if (!project.customStickers[editor.layerManager.getActiveLayer().stickerSourceId]) throw Error('Cutout not embedded');
			// Force registration from project bytes instead of reusing the session asset.
			editor.stickerLibrary.userContent = editor.stickerLibrary.userContent.filter(item => item.id !== editor.layerManager.getActiveLayer().stickerSourceId);
			await editor.projectSerializer.load(project);
		});
		assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().stickerSourceId), kept.id, 'Project reload lost cutout reference');
		assert(!await page.evaluate(() => editor.stickerManager.canRemoveBackground()), 'Project reload lost cutout marker');
		assert.deepEqual(await exportBytes(page), exported, 'Project reload changed export');
		await page.evaluate(() => {
			editor.stickerManager.backgroundRemover.releaseWorker();
		});
		await page.evaluate(async () => {
			await editor.stickerManager.pickLibrarySticker(originalId);
			if (!editor.stickerManager.canRemoveBackground()) throw Error('Original upload lost Remove background');
		});
		await page.route('**/background-removal-worker.js*', route => route.fulfill({ contentType: 'text/javascript', body: `self.onmessage = () => self.postMessage({ type: 'error', message: 'Download failed' });` }));
		await page.evaluate(() => COMMANDS.removeBackground.run(editor));
		await page.waitForFunction(() => document.getElementById('errorText').textContent === 'Download failed');
		assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().stickerSourceId), await page.evaluate(() => originalId), 'Failure changed source');
		assert.deepEqual(errors, [], 'Browser exceptions');
		process.stdout.write('PASS background removal lifecycle, eligibility, cancellation, history, project and exports\n');
	} finally { await browser.close(); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
