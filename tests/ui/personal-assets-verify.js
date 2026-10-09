'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { exportSnapshot, assertByteIdentity } = require('../parity/export-harness');
const root = path.resolve(__dirname, '../..');
const url = process.env.GLITTER_URL || 'http://localhost/glitter/';

async function open(browser) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', route => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.GLITTER_TEST_CSS) }));
	await page.goto(url, { waitUntil: 'networkidle' });
	await page.waitForFunction(() => window.editor?.glitterLibrary?.browser && window.editor?.stickerLibrary?.browser);
	await page.evaluate(() => editor.modalManager.closeAll());
	return page;
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await open(browser);
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.evaluate(async () => {
			await editor.loadBlankImage(100, 80, '#ffffff');
			const layer = editor.glitterManager.createLayer();
			editor.layerManager.insertLayer(layer); editor.layerManager.setActiveLayer(layer.id);
			editor.glitterManager.armPicker();
		});
		const png = await page.evaluate(() => {
			const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
			const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 2, 4);
			return canvas.toDataURL('image/png').split(',')[1];
		});
		const gif = JSON.parse(fs.readFileSync(path.join(root, 'data/glitter.json'))).find(item => item.isAnimated);
		await page.locator('#uploadStickerBtn').click();
		assert.strictEqual(await page.locator('#stickerUploadModal .modal-title-text').textContent(), 'Upload fill tile');
		await page.locator('#stickerUploadInput').setInputFiles([
			{ name: 'My tile.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
			{ name: 'My animation.gif', mimeType: 'image/gif', buffer: fs.readFileSync(path.join(root, gif.url)) }
		]);
		await page.waitForFunction(() => editor.glitterLibrary.userContent.filter(item => item.source === 'user-upload').length === 2 && !document.getElementById('stickerUploadModal').classList.contains('visible'));
		const ids = await page.evaluate(() => {
			const library = editor.glitterLibrary;
			const items = library.userContent;
			const png = items.find(item => item.mimeType === 'image/png');
			const gif = items.find(item => item.mimeType === 'image/gif');
			if (png.isAnimated || !png.hasTransparency || png.width !== 4 || !gif.isAnimated || gif.frameCount <= 1) throw new Error('Upload metadata is wrong');
			const category = library.browser.getCategoryById('custom');
			const card = library.browser.createCategoryCard(category, 2);
			if (card.querySelectorAll('.category-card-preview').length !== 2) throw new Error('Personal cover has no assets');
			if (!library.createCollectionPreview(category)?.src.startsWith('blob:')) throw new Error('Personal dropdown has no thumbnail');
			if (!library.createItemElement(png).querySelector('.asset-origin-mark use').getAttribute('href').endsWith('upload')) throw new Error('Upload origin mark is missing');
			library.persistCustomGlitter();
			if (PREFERENCES.get('customGlitter').some(recipe => !recipe?.colors)) throw new Error('Uploads polluted recolor preferences');
			return { png: png.id, gif: gif.id };
		});
		const originTile = page.locator(`#glitterBrowser .asset-option[data-id="${ids.png}"]`).last();
		const badgeGeometry = async () => originTile.evaluate(tile => {
			const badge = tile.querySelector('.asset-origin-mark').getBoundingClientRect();
			const icon = tile.querySelector('.asset-origin-mark > .icon').getBoundingClientRect();
			return { width: badge.width, height: badge.height, iconWidth: icon.width, iconHeight: icon.height,
				dx: (icon.left + icon.right - badge.left - badge.right) / 2,
				dy: (icon.top + icon.bottom - badge.top - badge.bottom) / 2 };
		});
		const restingBadge = await badgeGeometry();
		assert(restingBadge.iconWidth > 0 && Math.abs(restingBadge.dx) < 0.5 && Math.abs(restingBadge.dy) < 0.5, 'Origin icon is not centered');
		await originTile.hover();
		assert.deepStrictEqual(await badgeGeometry(), restingBadge, 'Origin icon changes size or alignment on hover');
		// A static JPEG uses the same pipeline and keeps photographic rendering smooth.
		ids.jpg = await page.evaluate(async () => {
			const blob = await fetch('images/glitter/ms-office-texture/wood-oak.jpg').then(response => response.blob());
			const item = await editor.glitterLibrary.handleUserUpload(new File([blob], 'Wood.jpg', { type: 'image/jpeg' }));
			if (!item || item.isAnimated || item.isPixelated || item.width !== 128) throw new Error('JPEG fill upload failed');
			return item.id;
		});
		await page.evaluate(() => {
			document.getElementById('designGallerySection').dataset.pickerLibrary = 'sticker'; syncLibraryView();
		});
		await page.locator('#uploadStickerBtn').click();
		assert.strictEqual(await page.locator('#stickerUploadModal .modal-title-text').textContent(), 'Upload sticker');
		await page.locator('#stickerUploadInput').setInputFiles({ name: 'My sticker.gif', mimeType: 'image/gif', buffer: fs.readFileSync(path.join(root, gif.url)) });
		await page.waitForFunction(() => editor.stickerLibrary.userContent.length === 1 && !document.getElementById('stickerUploadModal').classList.contains('visible'));
		await page.evaluate(ids => {
			const e = editor;
			const category = e.stickerLibrary.browser.getCategoryById('user-uploads');
			if (category.name !== 'My Stickers' || e.stickerLibrary.browser.createCategoryCard(category, 1).querySelectorAll('.category-card-preview').length !== 1) throw new Error('Sticker naming or cover is wrong');
			for (const [index, id] of [ids.png, ids.gif, ids.jpg].entries()) {
				const layer = e.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x: 25 + index * 30, y: 30 } });
				e.layerManager.insertLayer(layer); layer.shapeData.fill.mode = 'glitter'; layer.shapeData.fill.glitterId = id;
				e.shapeGlitterManager.renderLayer(layer);
			}
			e.requestPreviewUpdate(); e.saveState('Uploaded fills');
		}, ids);
		const first = await exportSnapshot(page, { maxFrames: 4 }, { minLayers: 3 });
		assertByteIdentity(first, await exportSnapshot(page, { maxFrames: 4 }, { minLayers: 3 }), 'Repeated upload export');
		await page.evaluate(() => { editor.layers.find(layer => layer.type === LayerType.SHAPE).opacity = 50; editor.saveState('Edit fill'); });
		await page.evaluate(() => editor.undo());
		assertByteIdentity(first, await exportSnapshot(page, { maxFrames: 4 }, { minLayers: 3 }), 'Upload edit/undo export');
		const project = await page.evaluate(() => editor.projectSerializer.serialize());
		assert(project.customGlitter[ids.png].data.startsWith('data:image/png'));
		assert(project.customGlitter[ids.gif].data.startsWith('data:image/gif'));
		assert(project.customGlitter[ids.jpg].data.startsWith('data:image/jpeg'));
		const foreign = await open(browser);
		const restored = await foreign.evaluate(async project => {
			const report = await editor.projectSerializer.preflight(project);
			await editor.projectSerializer.load(project);
			return { issues: report.issues, embedded: await editor.projectSerializer.serializeCustomGlitter(editor.layers), names: editor.glitterLibrary.userContent.map(item => item.name) };
		}, project);
		assert.deepStrictEqual(restored.issues, []);
		assert.strictEqual(restored.embedded[ids.png].data, project.customGlitter[ids.png].data);
		assert.strictEqual(restored.embedded[ids.gif].data, project.customGlitter[ids.gif].data);
		assert.strictEqual(restored.embedded[ids.jpg].data, project.customGlitter[ids.jpg].data);
		assert(restored.names.includes('My tile') && restored.names.includes('My animation'));
		assert.deepStrictEqual(errors, []);
		console.log('PASS personal covers, names, origin marks, batch PNG/GIF and JPEG uploads, stable export, undo and portable project round-trip');
	} finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
