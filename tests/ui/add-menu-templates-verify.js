'use strict';

const { chromium } = require('playwright');
const fs = require('fs');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function openEditor(browser) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await context.addInitScript(() => localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'));
	const page = await context.newPage();
	if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', (route) => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.GLITTER_TEST_CSS) }));
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor != null);
	await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach((modal) => modal.classList.remove('visible')));
	return { context, page, errors };
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const overlay = await openEditor(browser);
		await overlay.page.evaluate(() => window.editor.loadBlankImage(400, 400, '#222222'));
		await overlay.page.waitForFunction(() => window.editor.originalImage != null);
		await overlay.page.click('#addLayerBtn');
		await overlay.page.waitForSelector('[data-add-kind="template"]');
		const menu = await overlay.page.evaluate(() => ({
			groups: [...document.querySelectorAll('#layerTypePickerModal .add-menu-group-title')].map((node) => node.textContent),
			autoGlitter: Boolean(document.querySelector('[data-add-id="auto-glitter"]')),
			overlay: Boolean(document.querySelector('[data-add-id="impact-meme"]')),
			photoShape: Boolean(document.querySelector('[data-add-id="quickActionAddPhotoShape"]'))
		}));
		assert(menu.groups.join('|') === 'Layers|Basics|Decorate|Effects|Generate', 'Add menu groups are incomplete or out of order');
		const primary = overlay.page.locator('[data-add-group="layers"] .layer-type-option');
		assert((await primary.locator('.layer-type-name').allTextContents()).join('|') === 'Sticker|Fill Layer|Shape|Text', 'Main layers have their own ordered group');
		assert(await primary.count() === 4 && await primary.evaluateAll((nodes) => nodes.every((node) => !node.classList.contains('is-horizontal'))), 'Only the main layers use prominent tiles');
		assert(menu.autoGlitter && menu.overlay && menu.photoShape, 'Add menu is missing a generator or creation variant');

		await overlay.page.click('[data-add-id="impact-meme"]');
		await overlay.page.waitForSelector('#confirmationModal.visible');
		const preview = await overlay.page.evaluate(() => window.editor.layers.filter((layer) => layer.isPreview).map((layer) => ({
			text: layer.textData.text,
			fontId: layer.textData.fontId,
			fontSize: layer.textData.fontSize,
			x: layer.transform.position.x,
			y: layer.transform.position.y
		})));
		assert(preview.length === 2 && preview[0].x === 200 && preview[0].y === 32 && preview[1].y === 368,
			'Overlay preview did not scale and preserve edge placement');
		assert(preview.every((layer) => layer.fontId === 'impact' && layer.fontSize === 60),
			'Meme captions did not use the larger Impact treatment');
		await overlay.page.click('#confirmationConfirmBtn');
		await overlay.page.waitForFunction(() => !window.editor.layers.some((layer) => layer.isPreview));
		assert(await overlay.page.evaluate(() => window.editor.layers.filter((layer) => layer.type === LayerType.TEXT_GLITTER).length === 2),
			'Overlay template did not commit editable text layers');

		await overlay.page.evaluate(() => window.editor.modalManager.open('settingsModal'));
		await overlay.page.$eval('#showAllControls', (input) => {
			input.checked = true;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
		assert(await overlay.page.evaluate(() => document.documentElement.dataset.showAllControls === 'true'
			&& getComputedStyle(document.querySelector('.advanced-disclosure-content')).display === 'flex'),
			'Show All Controls did not reveal disclosures');
		assert(overlay.errors.length === 0, `Browser errors: ${overlay.errors.join('; ')}`);
		await overlay.context.close();
		for (const [id, width, height] of [['caption-subtitle', 800, 400], ['caption-subtitle', 400, 800], ['caption-bar', 800, 400], ['caption-bar', 400, 800], ['caption-date-stamp', 500, 500]]) {
			const caption = await openEditor(browser);
			await caption.page.evaluate(([w, h]) => editor.loadBlankImage(w, h, '#222222'), [width, height]);
			await caption.page.waitForFunction(() => editor.originalImage);
			await caption.page.click('#addLayerBtn');
			await caption.page.waitForSelector(`[data-add-id="${id}"]`);
			assert(await caption.page.locator(`[data-add-group="decorate"] [data-add-id="${id}"]`).count() === 1, 'Caption must be grouped in Decorate');
			const before = await caption.page.evaluate(() => editor.historyManager.history.length);
			await caption.page.click(`[data-add-id="${id}"]`);
			await caption.page.waitForSelector('#confirmationModal.visible');
			const preview = await caption.page.evaluate(() => {
				const layer = editor.layers.find(l => l.isPreview);
				return { boxWidth: layer.textData.boxWidth, type: layer.type };
			});
			assert(preview.type === 'text-glitter', 'Caption must be editable text');
			if (id === 'caption-bar') assert(preview.boxWidth === width, 'Caption Bar must span non-square canvas width');
			if (id === 'caption-subtitle') assert(preview.boxWidth === width * 0.9, 'Subtitle must retain its canvas margin');
			await caption.page.click('#confirmationCancelBtn');
			await caption.page.waitForFunction(() => !editor.layers.some(l => l.isPreview));
			assert(await caption.page.evaluate(() => editor.layers.length === 1), 'Cancel left caption layers behind');
			await caption.page.evaluate(id => { window.captionPreview = editor.templateManager.previewOverlay(id); }, id);
			await caption.page.waitForSelector('#confirmationModal.visible');
			await caption.page.click('#confirmationConfirmBtn');
			await caption.page.evaluate(() => window.captionPreview);
			assert(await caption.page.evaluate(() => editor.historyManager.history.length) === before + 1, 'Caption must commit as one history step');
			const saved = await caption.page.evaluate(() => editor.projectSerializer.serialize());
			await caption.page.evaluate(() => editor.historyManager.undo());
			assert(await caption.page.evaluate(() => editor.layers.length === 1), 'Undo must remove the caption');
			await caption.page.evaluate(async project => {
				editor.isSaved = true;
				const confirm = editor.confirmAction;
				editor.confirmAction = async () => true;
				try { await editor.projectSerializer.load(project); } finally { editor.confirmAction = confirm; }
			}, saved);
			assert(await caption.page.evaluate(() => editor.layers.filter(l => l.type === LayerType.TEXT_GLITTER).length === 1), 'Caption did not survive reopen');
			assert(caption.errors.length === 0, caption.errors.join('; '));
			await caption.context.close();
		}


		const project = await openEditor(browser);
		await project.page.click('#openNewCanvasBtn');
		await project.page.waitForSelector('[data-template-id="impact-meme-canvas"]');
		assert(await project.page.locator('[data-template-id="impact-meme-canvas"]').count() === 1,
			'Meme captions are not available as a New Canvas template');
		assert(await project.page.locator('[data-template-id="demotivational-poster"]').count() === 1, 'Poster must appear in New Canvas');
		assert(await project.page.locator('[data-template-id="blingee-nameplate"]').count() === 0,
			'Inactive Glitter Nameplate template is still visible');
		assert(await project.page.evaluate(async () => {
			const entries = await TemplateLibrary.loadManifest();
			return entries.some((entry) => entry.id === 'blingee-nameplate' && entry.active === false)
				&& await TemplateLibrary.get('blingee-nameplate') === null;
		}), 'Inactive Glitter Nameplate template is not retained safely in the manifest');
		assert(project.errors.length === 0, `Browser errors: ${project.errors.join('; ')}`);
		await project.context.close();
		const poster = await openEditor(browser);
		await poster.page.click('#openNewCanvasBtn');
		await poster.page.waitForSelector('[data-template-id="demotivational-poster"]');
		await poster.page.click('[data-template-id="demotivational-poster"]');
		await poster.page.click('#createCanvasBtn');
		await poster.page.waitForFunction(() => editor.layers.some(layer => layer.name === 'Photo'));
		assert(await poster.page.evaluate(() => editor.originalCanvas.width === 750 && editor.originalCanvas.height === 600
			&& editor.layers.filter(layer => layer.type === LayerType.TEXT_GLITTER).length === 2), 'Poster did not open with its editable photo and captions');
		assert(poster.errors.length === 0, poster.errors.join('; '));
		await poster.context.close();

		const memeProject = await openEditor(browser);
		await memeProject.page.click('#openNewCanvasBtn');
		await memeProject.page.waitForSelector('[data-template-id="impact-meme-canvas"]');
		await memeProject.page.click('[data-template-id="impact-meme-canvas"]');
		await memeProject.page.click('#createCanvasBtn');
		await memeProject.page.waitForFunction(() => window.editor.layers.filter((layer) => layer.type === LayerType.TEXT_GLITTER).length === 2);
		assert(await memeProject.page.evaluate(() => window.editor.projectName === 'Meme Captions'
			&& window.editor.layers.filter((layer) => layer.type === LayerType.TEXT_GLITTER)
				.every((layer) => layer.textData.fontId === 'impact' && layer.textData.fontSize === 120)),
			'New Canvas meme template did not load its full-size Impact captions');
		const growth = await memeProject.page.evaluate(async () => {
			const e = window.editor;
			const manager = e.textGlitterManager;
			const results = [];
			for (const layer of e.layers.filter(layer => layer.type === LayerType.TEXT_GLITTER)) {
				await manager.refreshLayer(layer);
				const before = getLayerAnchorPoint(e, layer);
				manager.applyTextEdit(layer, 'FIRST LINE\nSECOND LINE\nTHIRD LINE');
				const after = getLayerAnchorPoint(e, layer);
				results.push({ mode: layer.textData.boxMode, width: layer.textData.boxWidth, dy: after.y - before.y });
			}
			return results;
		});
		assert(growth.every(item => item.mode === 'autoHeight' && item.width === 800 && Math.abs(item.dy) < 0.01), `Caption anchor drift: ${JSON.stringify(growth)}`);
		assert(memeProject.errors.length === 0, `Browser errors: ${memeProject.errors.join('; ')}`);
		await memeProject.context.close();

		console.log('Add menu and templates verification passed');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
