'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const { chromium } = require('playwright');
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

async function exportPixels(page) {
	return page.evaluate(async () => {
		setActiveExportTarget(editor.exportSettings, 'still:png');
		return new Promise((resolve, reject) => {
			const show = editor.exportResultPresenter.show;
			const timer = setTimeout(() => reject(new Error('Export timed out')), 20000);
			editor.exportResultPresenter.show = async payload => {
				editor.exportResultPresenter.show = show;
				clearTimeout(timer);
				resolve(Array.from(new Uint8Array(await payload.blob.arrayBuffer())));
			};
			editor.exportCurrentTarget();
		});
	});
}

(async () => {
	const browser = await chromium.launch();
	try {
		for (const [kind, phone] of [['sticker', false], ['glitter', false], ['sticker', true], ['glitter', true]]) {
			const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone });
			const page = await context.newPage();
			const errors = [];
			page.on('pageerror', error => errors.push(error.message));
			if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', route => route.fulfill({ path: process.env.GLITTER_TEST_CSS, contentType: 'text/css' }));
			await page.goto(APP_URL);
			await page.waitForFunction(() => window.editor);
			await page.evaluate(() => { PREFERENCES.set('showHints', false); editor.updateHelpfulMessage(); });
			await page.evaluate(() => editor.loadBlankImage(32, 32, '#fff'));
			await page.waitForFunction(() => editor.originalImage);
			await page.evaluate(async kind => {
				const library = editor[kind === 'sticker' ? 'stickerLibrary' : 'glitterLibrary'];
				const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
				const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 8, 8);
				const blob = await new Promise(resolve => canvas.toBlob(resolve));
				const item = await library.handleUserUpload(new File([blob], `${kind}.png`, { type: 'image/png' }), { navigate: false });
				window.uploadLibrary = library; window.uploadId = item.id;
				if (kind === 'sticker') await editor.stickerManager.createStickerLayer(item.id);
				else {
					const layer = editor.textGlitterManager.createLayer({ text: 'Test' });
					layer.textData.fill.glitterId = item.id;
					editor.layerManager.insertLayer(layer); editor.layerManager.setActiveLayer(layer.id);
					editor.saveState('Use uploaded fill');
				}
				library.toggleFavorite(item.id); library.recordRecent(item.id);
				// The Library shows while a picker is armed; arming reveals the item.
				if (kind === 'sticker') editor.stickerManager.armAssetPicker();
				else editor.textGlitterManager.armPicker('fill');
				window.uploadLayerId = editor.layerManager.getActiveLayer().id;
				window.uploadHistoryLength = editor.historyManager.history.length;
			}, kind);
			const id = await page.evaluate(() => uploadId);
			const beforeExport = await exportPixels(page);
			const button = page.locator(`.asset-option[data-id="${id}"] .asset-delete-button`).first();
			const clickDelete = () => phone ? button.tap() : button.click();
			if (!phone) await button.hover();
			else assert(await button.evaluate(node => Number(getComputedStyle(node).opacity) > 0), 'Trash hidden on touch');
			await clickDelete();
			await page.waitForSelector('#confirmationModal.visible');
			assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().id), await page.evaluate(() => uploadLayerId), 'Trash also selected a different asset');
			assert.equal(await page.evaluate(() => document.activeElement.id), 'confirmationCancelBtn', 'Delete confirmation should focus Cancel');
			await page.click('#confirmationCancelBtn');
			await page.waitForFunction(() => !document.getElementById('confirmationModal').classList.contains('visible'));
			assert(await page.evaluate(() => uploadLibrary.userContent.some(item => item.id === uploadId)), 'Cancel removed upload');
			await page.locator('#confirmationModal').waitFor({ state: 'hidden' });
			fs.mkdirSync('.tmp/upload-delete', { recursive: true });
			if (!phone) await button.hover();
			await page.screenshot({ path: `.tmp/upload-delete/${kind}-${phone ? 'phone' : 'desktop'}.png` });
			const beforeStyle = await page.addStyleTag({ content: '.asset-delete-button { display: none !important; }' });
			await page.screenshot({ path: `.tmp/upload-delete/${kind}-${phone ? 'phone' : 'desktop'}-before.png` });
			await beforeStyle.evaluate(node => node.remove());
			await clickDelete();
			await page.waitForSelector('#confirmationModal.visible');
			await page.click('#confirmationConfirmBtn');
			await page.waitForFunction(() => !uploadLibrary.userContent.some(item => item.id === uploadId));
			assert.equal(await page.locator(`.asset-option[data-id="${id}"]`).count(), 0, 'Deleted upload remains in the Library');
			assert(await page.evaluate(() => {
				const library = uploadLibrary;
				return !library.getAllContent().some(item => item.id === uploadId)
					&& !library.getProjectItems().some(item => item.id === uploadId)
					&& !library.getRecentItems().some(item => item.id === uploadId)
					&& !library.getLibraryIds('libraryFavorites').includes(uploadId)
					&& !library.getLibraryIds('libraryRecents').includes(uploadId)
					&& library.getItemById(uploadId) && library.getRenderContent().some(item => item.id === uploadId)
					&& editor.historyManager.history.length === uploadHistoryLength;
			}), 'Deletion leaked into Quick picks/Favorites or broke the document');
			assert(await page.evaluate(async kind => {
				const item = uploadLibrary.getItemById(uploadId);
				const blob = await fetch(item.url).then(response => response.blob());
				if (!blob.size) return false;
				const project = await editor.projectSerializer.serialize();
				return Boolean((kind === 'sticker' ? project.customStickers : project.customGlitter)[uploadId]);
			}, kind), 'Used deleted upload was not embedded in saved project');
			await page.evaluate(async () => { await editor.undo(); await editor.redo(); });
			assert.deepEqual(await exportPixels(page), beforeExport, 'Deletion or undo/redo changed the artwork export');
			assert(await page.evaluate(() => uploadLibrary.getItemById(uploadId)), 'Undo/redo lost the upload');
			assert(await page.evaluate(() => {
				const preset = uploadLibrary.content[0];
				return !uploadLibrary.createItemElement(preset).querySelector('.asset-delete-button');
			}), 'Preset has a delete button');
			assert.deepEqual(errors, [], 'Browser errors');
			await context.close();
		}
		process.stdout.write('PASS uploaded sticker/fill deletion, Cancel, library cleanup, retained history and project assets\n');
	} finally { await browser.close(); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
