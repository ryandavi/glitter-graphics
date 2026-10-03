'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function openEditor(browser) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await context.addInitScript(() => localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'));
	const page = await context.newPage();
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
		assert(menu.groups.join('|') === 'Basics|Decorate|Effects|Generate', 'Add menu groups are incomplete or out of order');
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

		const project = await openEditor(browser);
		await project.page.click('#openNewCanvasBtn');
		await project.page.waitForSelector('[data-template-id="impact-meme-canvas"]');
		assert(await project.page.locator('[data-template-id="impact-meme-canvas"]').count() === 1,
			'Meme captions are not available as a New Canvas template');
		assert(await project.page.locator('[data-template-id="blingee-nameplate"]').count() === 0,
			'Inactive Glitter Nameplate template is still visible');
		assert(await project.page.evaluate(async () => {
			const entries = await TemplateLibrary.loadManifest();
			return entries.some((entry) => entry.id === 'blingee-nameplate' && entry.active === false)
				&& await TemplateLibrary.get('blingee-nameplate') === null;
		}), 'Inactive Glitter Nameplate template is not retained safely in the manifest');
		assert(project.errors.length === 0, `Browser errors: ${project.errors.join('; ')}`);
		await project.context.close();

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
