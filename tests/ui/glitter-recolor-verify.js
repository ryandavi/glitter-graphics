'use strict';

const assert = require('assert');
const fs = require('fs');
const { chromium } = require('playwright');
const { exportSnapshot, assertByteIdentity } = require('../parity/export-harness');
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', route => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.GLITTER_TEST_CSS) }));
		const errors = []; page.on('pageerror', error => errors.push(error.message));
		await page.goto(APP_URL);
		await page.waitForFunction(() => window.editor?.glitterLibrary?.browser && document.querySelector('#recolorGlitterBtn'));
		await page.evaluate(() => editor.modalManager.closeAll());
		await page.evaluate(() => COMMANDS.recolorGlitter.run(editor));
		assert(await page.evaluate(() => Boolean(editor.glitterRecolor.pickerSession)));
		await page.evaluate(() => editor.glitterLibrary.browser.setState('CATEGORY_DETAIL', 'star-dust'));
		assert(await page.locator('#glitterBrowser .recolor-unavailable').count() > 0);
		await page.keyboard.press('Escape');
		assert(await page.evaluate(() => !editor.glitterRecolor.pickerSession));
		await page.evaluate(() => editor.glitterRecolor.open(editor.glitterLibrary.getItemById(111)));
		await page.locator('#recolorFrames button').nth(1).click();
		assert.strictEqual(await page.evaluate(() => editor.glitterRecolor.frame), 1);
		await page.locator('#recolorSwatches input[type=text]').first().fill('#18b7c9');
		await page.locator('#recolorSwatches input[type=text]').first().press('Tab');
		const changed = await page.evaluate(() => Object.values(editor.glitterRecolor.session.colors));
		assert(changed.includes('18b7c9'));
		await page.keyboard.press('Control+z');
		assert(!(await page.evaluate(() => Object.values(editor.glitterRecolor.session.colors))).includes('18b7c9'));
		await page.keyboard.press('Control+Shift+z');
		assert((await page.evaluate(() => Object.values(editor.glitterRecolor.session.colors))).includes('18b7c9'));
		await page.locator('[data-revert-for="recolorAll"]').click();
		assert(await page.evaluate(() => Object.entries(editor.glitterRecolor.session.colors).every(([key, value]) => key === value)));
		await page.keyboard.press('Control+z');
		assert((await page.evaluate(() => Object.values(editor.glitterRecolor.session.colors))).includes('18b7c9'));
		await page.evaluate(() => { const slider = document.querySelector('#recolorHue'); slider.value = 40; slider.dispatchEvent(new Event('input')); });
		assert(await page.locator('#recolorSwatch0').isDisabled());
		await page.locator('#recolorCancelAdjust').click();
		assert(!(await page.locator('#recolorSwatch0').isDisabled()));
		await page.evaluate(() => { const slider = document.querySelector('#recolorLightness'); slider.value = 10; slider.dispatchEvent(new Event('input')); });
		await page.locator('#recolorApplyAdjust').click();
		assert.strictEqual(await page.locator('#recolorLightness').inputValue(), '0');
		await page.locator('#recolorCancel').click();
		await page.waitForSelector('#confirmationModal.visible');
		await page.locator('#confirmationCancelBtn').click();
		await page.waitForSelector('#glitterRecolorModal.visible');
		assert(await page.evaluate(() => Boolean(editor.glitterRecolor.session)));
		await page.locator('#recolorName').fill('Teal test');
		await page.locator('#recolorSave').click();
		await page.waitForFunction(() => !editor.glitterRecolor.session);
		const originalId = await page.evaluate(() => editor.glitterLibrary.userContent[0].id);
		assert(await page.evaluate(() => editor.glitterLibrary.browser.categories[0].name === 'My Glitter'));
		assert(await page.evaluate(() => PREFERENCES.get('customGlitter').length === 1));
		await page.reload();
		await page.waitForFunction(() => window.editor?.glitterLibrary?.userContent.length === 1);
		assert.strictEqual(await page.evaluate(() => editor.glitterLibrary.userContent[0].id), originalId);
		await page.evaluate(id => COMMANDS.recolorGlitter.run(editor, { itemId: id }), originalId);
		assert((await page.locator('#recolorCredit').textContent()).includes('Recolored from Light Pink'));
		assert.strictEqual(await page.locator('#recolorSave .name').textContent(), 'Replace');
		await page.locator('#recolorName').fill('Copy test');
		await page.locator('#recolorCopy').click();
		await page.waitForFunction(() => !editor.glitterRecolor.session);
		assert.strictEqual(await page.evaluate(() => editor.glitterLibrary.userContent.length), 2);
		const copyId = await page.evaluate(() => editor.glitterLibrary.userContent[0].id);
		await page.evaluate(id => editor.glitterRecolor.open(editor.glitterLibrary.getItemById(id)), copyId);
		await page.locator('#recolorDelete').click(); await page.waitForSelector('#confirmationModal.visible');
		await page.locator('#confirmationConfirmBtn').click(); await page.waitForFunction(() => !editor.glitterRecolor.session);
		assert.strictEqual(await page.evaluate(() => editor.glitterLibrary.userContent.length), 1);
		assert(await page.evaluate(id => Boolean(editor.glitterLibrary.getItemById(id)), copyId));
		await page.evaluate(id => editor.glitterRecolor.open(editor.glitterLibrary.getItemById(id)), copyId);
		assert.strictEqual(await page.locator('#recolorSave .name').textContent(), 'Save to My Glitter');
		await page.locator('#recolorCancel').click(); await page.waitForFunction(() => !editor.glitterRecolor.session);
		await page.evaluate(() => editor.loadBlankImage(100, 80, '#ffffff'));
		await page.waitForFunction(() => Boolean(editor.originalImage));
		const ids = await page.evaluate(async id => {
			const e = editor;
			const layers = [0, 1].map(index => e.shapeGlitterManager.createLayer({ shapeId: 'square', width: 40, height: 40, position: { x: 30 + index * 35, y: 40 } }));
			for (const layer of layers) {
				e.layerManager.insertLayer(layer); layer.shapeData.fill.mode = 'glitter'; layer.shapeData.fill.glitterId = id;
				e.shapeGlitterManager.renderLayer(layer);
			}
			const asset = e.stickerLibrary.content.find(item => item.isAnimated);
			await e.stickerLibrary.ensureAssetDetails(asset.id); await e.stickerLibrary.ensureAssetImageReady(asset);
			const sticker = e.stickerManager.createLayer(asset.id);
			sticker.transform.position = { x: 80, y: 65 };
			sticker.transform.scale = { x: 15, y: 15 };
			e.layerManager.insertLayer(sticker);
			e.stickerManager.renderLayer(sticker);
			e.layerManager.setActiveLayer(layers[0].id); e.requestPreviewUpdate(); e.saveState('Test custom glitter');
			return layers.map(layer => layer.id);
		}, originalId);
		console.log('PASS modal editing and persistence');
		const first = await exportSnapshot(page, { maxFrames: 4 }, { minLayers: 3 });
		const second = await exportSnapshot(page, { maxFrames: 4 }, { minLayers: 3 });
		assertByteIdentity(first, second, 'Custom glitter repeated export');
		const replacement = await page.evaluate(async id => {
			const item = editor.glitterLibrary.getItemById(id);
			const colors = { ...item.recipe.colors }; colors[Object.keys(colors)[0]] = 'ff0000';
			const updated = await editor.glitterLibrary.saveCustomGlitter({ ...item.recipe, id: `custom-${crypto.randomUUID()}`, colors }, { replaceId: id });
			return updated.id;
		}, originalId);
		assert(await page.evaluate(({ ids, replacement }) => ids.every(id => editor.layerManager.getLayerById(id).shapeData.fill.glitterId === replacement), { ids, replacement }));
		assert(await page.evaluate(id => editor.glitterLibrary.getItemById(id) && !editor.glitterLibrary.getAllContent().some(item => item.id === id), originalId));
		const updatedExport = await exportSnapshot(page, { maxFrames: 4 }, { minLayers: 3 });
		assert.notStrictEqual(updatedExport.hash, first.hash, 'Recolor must affect the export');
		await page.evaluate(() => editor.undo());
		assert(await page.evaluate(({ ids, originalId }) => ids.every(id => editor.layerManager.getLayerById(id).shapeData.fill.glitterId === originalId), { ids, originalId }));
		const restored = await exportSnapshot(page, { maxFrames: 4 }, { minLayers: 3 });
		assertByteIdentity(first, restored, 'Replace -> undo -> custom glitter export');
		console.log('PASS custom exports and replacement undo');
		await page.evaluate(({ id }) => COMMANDS.recolorGlitter.run(editor, { layerId: id, slot: 'fill' }), { id: ids[0] });
		assert.strictEqual(await page.evaluate(() => editor.glitterRecolor.session.target.slot), 'fill');
		await page.locator('#recolorSave').click(); await page.waitForFunction(() => !editor.glitterRecolor.session);
		assert(await page.evaluate(({ ids, originalId }) => editor.layerManager.getLayerById(ids[0]).shapeData.fill.glitterId !== originalId && editor.layerManager.getLayerById(ids[1]).shapeData.fill.glitterId === originalId, { ids, originalId }));
		await page.evaluate(() => editor.undo());
		const project = await page.evaluate(() => editor.projectSerializer.serialize());
		assert(project.customGlitter[originalId].data.startsWith('data:image/gif'));
		assert(project.customGlitter[originalId].sourceData.startsWith('data:image/gif'));
		const foreign = await browser.newPage();
		await foreign.goto(APP_URL); await foreign.waitForFunction(() => window.editor?.glitterLibrary?.browser);
		const roundTrip = await foreign.evaluate(async data => {
			// A project remains portable even after the source leaves the manifest.
			editor.glitterLibrary.content = editor.glitterLibrary.content.filter(item => item.id !== data.customGlitter[Object.keys(data.customGlitter)[0]].recipe.sourceId);
			const report = await editor.projectSerializer.preflight(data);
			await editor.projectSerializer.load(data);
			const embedded = await editor.projectSerializer.serializeCustomGlitter(editor.layers);
			const tile = editor.glitterLibrary.getItemById(Object.keys(embedded)[0]);
			await editor.glitterRecolor.open(tile);
			return { issues: report.issues, embedded, editable: Boolean(editor.glitterRecolor.session) };
		}, project);
		assert.deepStrictEqual(roundTrip.issues, []); assert(roundTrip.editable);
		assert.strictEqual(roundTrip.embedded[originalId].data, project.customGlitter[originalId].data);
		assert.deepStrictEqual(roundTrip.embedded[originalId].recipe, project.customGlitter[originalId].recipe);
		await foreign.close();
		const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
		if (process.env.GLITTER_TEST_CSS) await phone.route('**/css/style.css*', route => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.GLITTER_TEST_CSS) }));
		await phone.goto(APP_URL); await phone.waitForFunction(() => window.editor?.glitterLibrary?.browser);
		await phone.evaluate(() => editor.modalManager.closeAll());
		await phone.evaluate(() => editor.glitterRecolor.open(editor.glitterLibrary.getItemById(111)));
		await phone.locator('#recolorFrames button').nth(2).tap();
		assert.strictEqual(await phone.evaluate(() => editor.glitterRecolor.frame), 2);
		if (process.env.GLITTER_TEST_CSS) {
			assert(await phone.evaluate(() => {
				const box = document.querySelector('#glitterRecolorModal .modal-content').getBoundingClientRect();
				const row = document.querySelector('#recolorSwatches .property-row').getBoundingClientRect();
				return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && row.height < 60;
			}));
		}
		await phone.locator('#recolorCancel').tap(); await phone.waitForFunction(() => !editor.glitterRecolor.session);
		await phone.close();
		assert.deepStrictEqual(errors, []);
		console.log('PASS recolor picker, exact hex, local undo, sliders, discard confirmation, persistence, My Glitter, replacement on two layers, stable animated-sticker exports and portable project restore without its source');
	} finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
