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
		await page.evaluate(() => editor.loadBlankImage(100, 80, '#ffffff'));
		await page.waitForFunction(() => Boolean(editor.originalImage));
		await page.evaluate(() => {
			const layer = editor.glitterManager.createLayer();
			editor.layerManager.insertLayer(layer);
			editor.glitterManager.armAssetPicker();
			editor.glitterLibrary.browser.setState('CATEGORY_DETAIL', 'star-dust');
		});
		await page.waitForTimeout(500);
		await page.evaluate(() => {
			const browser = editor.glitterLibrary.browser;
			browser.scrollContainer.scrollTop = 120;
			window.recolorBrowseBefore = {
				tiles: [...browser.elements.itemGrid.children], scroll: browser.scrollContainer.scrollTop,
				title: document.getElementById('designGalleryTitleText').textContent,
				session: editor.glitterManager.pickerSession
			};
		});
		await page.evaluate(() => COMMANDS.recolorGlitter.run(editor));
		assert(await page.evaluate(() => {
			const browser = editor.glitterLibrary.browser, before = window.recolorBrowseBefore;
			return before.tiles.length > 0 && before.tiles.every((tile, index) => browser.elements.itemGrid.children[index] === tile)
				&& browser.scrollContainer.scrollTop === before.scroll;
		}));
		assert(await page.evaluate(() => Boolean(editor.glitterRecolor.pickerSession)));
		assert(await page.locator('#designGalleryHeader #recolorGlitterBtn').evaluate(button => button.classList.contains('active') && button.getAttribute('aria-pressed') === 'true'));
		assert(await page.locator('#recolorGlitterBtn').isVisible());
		assert(await page.locator('#uploadStickerBtn').isVisible());
		assert.strictEqual(await page.locator('#uploadStickerBtn').getAttribute('aria-label'), 'Upload fill tile');
		assert(await page.locator('#uploadStickerBtn').evaluate(button => button.getBoundingClientRect().width > 0));
		await page.locator('#recolorGlitterBtn').click();
		assert(await page.evaluate(() => !editor.glitterRecolor.pickerSession));
		assert(await page.evaluate(() => {
			const before = window.recolorBrowseBefore;
			return document.getElementById('designGallerySection').dataset.pickerLibrary === 'glitter'
				&& document.getElementById('designGalleryTitleText').textContent === before.title
				&& editor.glitterManager.pickerSession.layerId === before.session.layerId
				&& before.tiles.every(tile => tile.isConnected && !tile.classList.contains('recolor-unavailable') && !tile.hasAttribute('aria-disabled'));
		}));
		await page.evaluate(() => COMMANDS.recolorGlitter.run(editor));
		await page.evaluate(() => editor.glitterLibrary.browser.setState('CATEGORY_DETAIL', 'star-dust'));
		assert(await page.locator('#glitterBrowser .recolor-unavailable').count() > 0);
		await page.keyboard.press('Escape');
		assert(await page.evaluate(() => !editor.glitterRecolor.pickerSession));
		assert(await page.locator('#recolorGlitterBtn').evaluate(button => !button.classList.contains('active') && button.getAttribute('aria-pressed') === 'false'));
		await page.evaluate(() => editor.glitterRecolor.open(editor.glitterLibrary.getItemById(111)));
		const defaultName = await page.locator('#recolorName').inputValue();
		const nameWidth = await page.locator('#recolorName').evaluate(input => input.getBoundingClientRect().width);
		assert(await page.locator('[data-revert-for="recolorName"]').isDisabled());
		await page.locator('#recolorName').fill('Temporary name'); await page.locator('#recolorName').press('Tab');
		assert.strictEqual(await page.locator('#recolorName').evaluate(input => input.getBoundingClientRect().width), nameWidth);
		await page.locator('[data-revert-for="recolorName"]').click();
		assert.strictEqual(await page.locator('#recolorName').inputValue(), defaultName);
		await page.keyboard.press('Control+z');
		assert.strictEqual(await page.locator('#recolorName').inputValue(), 'Temporary name');
		await page.keyboard.press('Control+z');
		assert.strictEqual(await page.locator('#recolorName').inputValue(), defaultName);
		assert.deepStrictEqual(await page.locator('#recolorSwatches .color-list-select').allTextContents(), ['29%', '26%', '20%', '18%', '6%']);
		assert(await page.locator('#recolorSwatch0').evaluate(input => {
			const wrapper = input.parentElement;
			return wrapper.children[0] === input && wrapper.children[1].matches('.color-hex-input') && wrapper.children[2].matches('.color-eyedropper-button');
		}));
		assert(await page.locator('#recolorApplyAdjust').isDisabled());
		assert.strictEqual(await page.locator('#recolorSwatches .selected').count(), 0);
		const select = page.locator('#recolorSwatches .color-list-select');
		await select.nth(0).click();
		assert.strictEqual(await select.nth(0).getAttribute('aria-pressed'), 'true');
		await select.nth(1).click();
		assert.strictEqual(await select.nth(0).getAttribute('aria-pressed'), 'false');
		assert.strictEqual(await select.nth(1).getAttribute('aria-pressed'), 'true');
		await select.nth(1).click();
		assert.strictEqual(await page.locator('#recolorSwatches .selected').count(), 0);
		await select.nth(0).focus(); await page.keyboard.press('Space');
		assert.strictEqual(await select.nth(0).getAttribute('aria-pressed'), 'true');
		await page.keyboard.press('Escape');
		assert.strictEqual(await page.locator('#recolorSwatches .selected').count(), 0);
		assert(await page.locator('#glitterRecolorModal').isVisible());
		const pixels = await page.evaluate(() => {
			const controller = editor.glitterRecolor, bounds = document.getElementById('recolorStage').getBoundingClientRect();
			controller.rows.forEach(entry => { entry.input.showPicker = () => {}; });
			return [0, 1].map(index => {
				const pixel = controller.frames[controller.frame].map.indexOf(index), { width, height } = controller.session.analysis;
				return { index, x: bounds.left + (pixel % width + 0.5) * bounds.width / width, y: bounds.top + (Math.floor(pixel / width) + 0.5) * bounds.height / height };
			});
		});
		for (const pixel of pixels) {
			await page.mouse.click(pixel.x, pixel.y);
			assert.strictEqual(await select.nth(pixel.index).getAttribute('aria-pressed'), 'true');
		}
		await page.mouse.click(pixels[1].x, pixels[1].y);
		assert.strictEqual(await page.locator('#recolorSwatches .selected').count(), 0);
		await page.evaluate(() => editor.glitterRecolor.rows.forEach(entry => { delete entry.input.showPicker; }));
		await page.locator('#recolorPlay').click();
		assert.strictEqual(await page.locator('#recolorPlay').getAttribute('aria-label'), 'Pause');
		await page.locator('#recolorPlay').click();
		assert.strictEqual(await page.locator('#recolorPlay').getAttribute('aria-label'), 'Play');
		const unchangedPreview = await page.locator('#recolorStage').evaluate(canvas => canvas.toDataURL());
		await page.locator('#recolorSwatch0').hover();
		assert.strictEqual(await page.locator('#recolorStage').evaluate(canvas => canvas.toDataURL()), unchangedPreview);
		assert(await page.locator('#recolorSwatch0').evaluate(input => input.getBoundingClientRect().width >= parseFloat(getComputedStyle(input).height)));
		const picker = await page.evaluate(() => {
			const controller = editor.glitterRecolor, input = controller.rows[0].input;
			const before = input.getBoundingClientRect();
			input.addEventListener('click', event => event.preventDefault(), { once: true });
			input.click();
			const after = input.getBoundingClientRect();
			return { stable: before.x === after.x && before.y === after.y, paused: !controller.playing, selected: controller.rows[0].row.classList.contains('selected') };
		});
		assert(picker.stable && picker.paused && picker.selected);
		await page.evaluate(() => {
			window.recolorTestEyeDropper = window.EyeDropper;
			window.EyeDropper = class { async open() { return { sRGBHex: '#112233' }; } };
		});
		await page.locator('#recolorSwatches .color-eyedropper-button').first().click();
		assert.strictEqual(await page.locator('#recolorSwatch0').inputValue(), '#112233');
		await page.evaluate(() => { window.EyeDropper = window.recolorTestEyeDropper; delete window.recolorTestEyeDropper; });
		await page.keyboard.press('Control+z');
		await page.locator('input[aria-label="Hex color for all colors"]').fill('#18b7c9');
		await page.locator('input[aria-label="Hex color for all colors"]').press('Tab');
		assert.strictEqual(await page.locator('#recolorSwatch0').inputValue(), '#18b7c9');
		await page.keyboard.press('Control+z');
		await page.locator('#recolorFrames button').nth(1).click();
		assert.strictEqual(await page.evaluate(() => editor.glitterRecolor.frame), 1);
		await page.locator('#recolorSwatches input[type=text]').first().fill('#18b7c9');
		await page.locator('#recolorSwatches input[type=text]').first().press('Tab');
		const changed = await page.evaluate(() => Object.values(editor.glitterRecolor.session.colors));
		assert(changed.includes('18b7c9'));
		const recoloredPreview = await page.locator('#recolorStage').evaluate(canvas => canvas.toDataURL());
		const comparisonState = await page.evaluate(() => JSON.stringify(editor.glitterRecolor.snapshot()));
		await page.locator('#recolorComparison [data-original="true"]').click();
		assert.notStrictEqual(await page.locator('#recolorStage').evaluate(canvas => canvas.toDataURL()), recoloredPreview);
		assert.strictEqual(await page.evaluate(() => JSON.stringify(editor.glitterRecolor.snapshot())), comparisonState);
		await page.locator('#recolorComparison [data-original="false"]').click();
		assert.strictEqual(await page.locator('#recolorStage').evaluate(canvas => canvas.toDataURL()), recoloredPreview);
		assert.strictEqual(await page.locator('#recolorInfo, #recolorZoom').count(), 0);
		assert(await page.locator('#recolorComparison').evaluate(control => control.getBoundingClientRect().width < control.parentElement.getBoundingClientRect().width / 2));
		assert(await page.evaluate(() => {
			const canvas = document.getElementById('recolorStage'), host = document.getElementById('recolorStageHost');
			const bounds = canvas.getBoundingClientRect(), control = document.getElementById('recolorComparison'), outer = control.parentElement.getBoundingClientRect(), toggle = control.getBoundingClientRect();
			return Math.abs(bounds.width - host.clientWidth) < 1 && Math.abs(bounds.width / bounds.height - canvas.width / canvas.height) < 0.001
				&& getComputedStyle(control).position === 'absolute' && Math.abs(toggle.left + toggle.width / 2 - outer.left - outer.width / 2) < 1;
		}));
		assert(await page.locator('#recolorRepeat').evaluate(canvas => canvas.height > 58 && canvas.getBoundingClientRect().width === canvas.width));
		assert.strictEqual(await page.locator('.recolor-hint').evaluate(note => getComputedStyle(note).paddingInlineStart), '0px');
		await page.keyboard.press('Control+z');
		assert(!(await page.evaluate(() => Object.values(editor.glitterRecolor.session.colors))).includes('18b7c9'));
		await page.keyboard.press('Control+Shift+z');
		assert((await page.evaluate(() => Object.values(editor.glitterRecolor.session.colors))).includes('18b7c9'));
		await page.locator('[data-revert-for="recolorAll"]').click();
		assert(await page.evaluate(() => Object.entries(editor.glitterRecolor.session.colors).every(([key, value]) => key === value)));
		await page.keyboard.press('Control+z');
		assert((await page.evaluate(() => Object.values(editor.glitterRecolor.session.colors))).includes('18b7c9'));
		const adjustTop = await page.locator('#recolorHue').evaluate(input => input.getBoundingClientRect().top);
		await page.evaluate(() => { const slider = document.querySelector('#recolorHue'); slider.value = 40; slider.dispatchEvent(new Event('input')); });
		assert(await page.locator('#recolorSwatch0').isDisabled());
		assert.strictEqual(await page.locator('#recolorHue').evaluate(input => input.getBoundingClientRect().top), adjustTop);
		assert.strictEqual(await page.locator('#recolorPendingHint').count(), 0);
		assert(await page.locator('#recolorApplyAdjust').isEnabled());
		assert(await page.evaluate(() => {
			const cancel = document.getElementById('recolorCancelAdjust').getBoundingClientRect(), apply = document.getElementById('recolorApplyAdjust').getBoundingClientRect();
			return cancel.top === apply.top && cancel.right <= apply.left;
		}));
		await page.locator('#recolorCancelAdjust').click();
		assert(!(await page.locator('#recolorSwatch0').isDisabled()));
		await page.evaluate(() => { const slider = document.querySelector('#recolorLightness'); slider.value = 10; slider.dispatchEvent(new Event('input')); });
		await page.locator('#recolorApplyAdjust').click();
		assert.strictEqual(await page.locator('#recolorLightness').inputValue(), '0');
		await page.locator('#recolorCancel').click();
		await page.waitForSelector('#confirmationModal.visible');
		assert(await page.evaluate(() => document.getElementById('glitterRecolorModal').classList.contains('visible') && document.getElementById('glitterRecolorModal').inert));
		await page.locator('#confirmationCancelBtn').click();
		await page.waitForFunction(() => document.getElementById('glitterRecolorModal').contains(document.activeElement));
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
		await page.evaluate(async () => { await editor.modalManager.pendingHistoryBack; });
		assert(await page.evaluate(() => !history.state?.glitterModal));
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
		await phone.locator('#recolorComparison [data-original="true"]').tap();
		assert(await phone.evaluate(() => editor.glitterRecolor.showOriginal));
		await phone.locator('#recolorComparison [data-original="false"]').tap();
		assert(!(await phone.evaluate(() => editor.glitterRecolor.showOriginal)));
		await phone.locator('#recolorSwatches .color-list-select').nth(0).tap();
		assert.strictEqual(await phone.locator('#recolorSwatches .color-list-select').nth(0).getAttribute('aria-pressed'), 'true');
		await phone.locator('#recolorSwatches .color-list-select').nth(1).tap();
		assert.strictEqual(await phone.locator('#recolorSwatches .color-list-select').nth(1).getAttribute('aria-pressed'), 'true');
		await phone.locator('#recolorSwatches .color-list-select').nth(1).tap();
		assert.strictEqual(await phone.locator('#recolorSwatches .selected').count(), 0);
		if (process.env.GLITTER_TEST_CSS) {
			assert(await phone.evaluate(() => {
				const box = document.querySelector('#glitterRecolorModal .modal-content').getBoundingClientRect();
				const row = document.querySelector('#recolorSwatches .list-row').getBoundingClientRect();
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
