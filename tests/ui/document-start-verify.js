'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/wn4GBgYGJAQoAHgQCAftBAX8AAAAASUVORK5CYII=';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function openEditor(browser, viewport) {
	const context = await browser.newContext({ viewport });
	await context.addInitScript(() => localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'));
	const page = await context.newPage();
	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor != null, null, { timeout: 15000 });
	await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach((modal) => modal.classList.remove('visible')));
	return { context, page };
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const startupContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		await startupContext.addInitScript(() => {
			localStorage.setItem('glitterEditorTheme', 'bubblegum');
			localStorage.setItem('glitterEditorSettings', JSON.stringify({
				interfaceTheme: 'bubblegum',
				showWelcomeOnStartup: true
			}));
			localStorage.removeItem('glitterEditor_welcomeModalSeen');
		});
		await startupContext.route('**/modals/welcome.html*', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 600));
			await route.continue();
		});
		const startupPage = await startupContext.newPage();
		await startupPage.goto(APP_URL, { waitUntil: 'domcontentloaded' });
		await startupPage.waitForSelector('#welcomeModal.visible', { timeout: 1000 });
		assert(await startupPage.isVisible('#welcomeModal .modal-loading'),
			'Welcome modal waits for its external content before becoming visible');
		assert(await startupPage.evaluate(() => document.documentElement.dataset.theme === 'bubblegum'),
			'Saved theme was not applied by the head bootstrap before app initialization');
		await startupPage.waitForFunction(() => !document.querySelector('#welcomeModal .modal-loading'), null, { timeout: 5000 });
		await startupContext.close();

		const desktop = await openEditor(browser, { width: 1440, height: 900 });
		const startState = await desktop.page.evaluate(() => ({
			startVisible: !document.getElementById('workspaceStart').hidden,
			noLegacyImagePanel: !document.getElementById('imagePanelSection'),
			presetCount: document.querySelectorAll('.new-canvas-preset-btn').length,
			presetGroups: [...document.querySelectorAll('.new-canvas-preset-title')].map((node) => node.textContent),
			maxWidth: Number(document.getElementById('newCanvasWidth').max),
			maxHeight: Number(document.getElementById('newCanvasHeight').max),
			panelsHidden: ['.layers-panel', '.design-panel']
				.every((selector) => getComputedStyle(document.querySelector(selector)).display === 'none')
		}));
		assert(startState.startVisible, 'Desktop start surface is not visible without a document');
		assert(startState.noLegacyImagePanel, 'Legacy Image panel is still present');
		assert(startState.presetCount === 10, `Expected 10 canvas presets, got ${startState.presetCount}`);
		assert(startState.presetGroups.join('|') === 'Social Media|Web Classics|General', 'Canvas preset groups are missing or out of order');
		assert(startState.maxWidth === 1024 && startState.maxHeight === 1024, 'Custom canvas limits are not 1024px');
		assert(startState.panelsHidden, 'Document panels are visible during the no-document state');

		await desktop.page.evaluate(async () => {
			const canvas = document.createElement('canvas');
			canvas.width = 1400;
			canvas.height = 700;
			const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
			window.__oversizedLoad = window.editor.loadImageFile(new File([blob], 'oversized.png', { type: 'image/png' }));
		});
		await desktop.page.waitForSelector('#confirmationModal.visible');
		const resizePrompt = await desktop.page.$eval('#confirmationModalMessage', (node) => ({
			text: node.textContent,
			subject: node.querySelector('.confirmation-subject-value')?.textContent,
			facts: [...node.querySelectorAll('.confirmation-facts > div')].map((row) => row.textContent),
			copyWeight: Number(getComputedStyle(node.querySelector('.confirmation-message-copy')).fontWeight)
		}));
		assert(resizePrompt.text.includes('1400 × 700px') && resizePrompt.text.includes('1024 × 512px'),
			'Oversized-image prompt does not explain the source and resized dimensions');
		assert(resizePrompt.subject === 'oversized.png' && resizePrompt.facts.length === 2 && resizePrompt.copyWeight <= 500,
			'Oversized-image prompt does not provide a clear file and dimension hierarchy');
		await desktop.page.click('#confirmationCancelBtn');
		assert(await desktop.page.evaluate(async () => !(await window.__oversizedLoad) && !window.editor.originalImage),
			'Cancelling an oversized image import changed the document');

		await desktop.page.click('#openNewCanvasBtn');
		assert(await desktop.page.isVisible('#newCanvasModal.visible'), 'New Canvas did not open from the start surface');
		const landscapePreviewsFit = await desktop.page.evaluate(() => (
			['landscape-video', 'classic-signature', 'general-landscape'].every((id) => {
				const button = document.querySelector(`[data-preset-id="${id}"]`);
				const wrapper = button.querySelector('.blank-preview-wrapper').getBoundingClientRect();
				const preview = button.querySelector('.blank-preview').getBoundingClientRect();
				return preview.width <= wrapper.width * 0.82 && preview.height <= wrapper.height;
			})
		));
		assert(landscapePreviewsFit, 'Landscape preset previews fill their entire preview frame');
		await desktop.page.click('[data-preset-id="story-reel"]');
		const storySize = await desktop.page.evaluate(() => [
			Number(document.getElementById('newCanvasWidth').value),
			Number(document.getElementById('newCanvasHeight').value)
		]);
		assert(storySize[0] === 576 && storySize[1] === 1024, 'Story / Reel preset did not set 576 × 1024');
		await desktop.page.click('#createCanvasBtn');
		await desktop.page.waitForFunction(() => window.editor.originalImage != null);
		await desktop.page.waitForFunction(() => {
			const workspace = document.getElementById('previewContainer').getBoundingClientRect();
			const canvas = document.getElementById('previewWrapper').getBoundingClientRect();
			const centerDeltaX = Math.abs((canvas.left + canvas.width / 2) - (workspace.left + workspace.width / 2));
			const centerDeltaY = Math.abs((canvas.top + canvas.height / 2) - (workspace.top + workspace.height / 2));
			return getComputedStyle(document.getElementById('previewWrapper')).opacity === '1'
				&& centerDeltaX < 2 && centerDeltaY < 2
				&& canvas.width <= workspace.width && canvas.height <= workspace.height;
		});
		assert(await desktop.page.$eval('#workspaceStart', (node) => node.hidden), 'Start surface stayed visible after canvas creation');

		await desktop.page.evaluate(async (pngBase64) => {
			const bytes = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0));
			const file = new File([bytes], 'placed.png', { type: 'image/png' });
			const transfer = new DataTransfer();
			transfer.items.add(file);
			document.getElementById('previewContainer').dispatchEvent(new DragEvent('drop', {
				bubbles: true,
				cancelable: true,
				dataTransfer: transfer
			}));
		}, PNG_BASE64);
		await desktop.page.waitForFunction(() => window.editor.layers.some((layer) => layer.type === LayerType.STICKER));
		assert(await desktop.page.evaluate(() => window.editor.layers.filter((layer) => layer.type === LayerType.BASE_IMAGE).length === 1),
			'Dropping an image replaced or duplicated the base layer');
		const replacementState = await desktop.page.evaluate(async (pngBase64) => {
			const stickerId = window.editor.layers.find((layer) => layer.type === LayerType.STICKER).id;
			const bytes = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0));
			const replaced = await window.editor.replaceBaseImageFile(new File([bytes], 'replacement.png', { type: 'image/png' }));
			return {
				replaced,
				stickerPreserved: window.editor.layers.some((layer) => layer.id === stickerId),
				baseCount: window.editor.layers.filter((layer) => layer.type === LayerType.BASE_IMAGE).length
			};
		}, PNG_BASE64);
		assert(replacementState.replaced && replacementState.stickerPreserved && replacementState.baseCount === 1,
			'Explicit base-image replacement did not preserve the existing layer stack');
		await desktop.context.close();

		const mobile = await openEditor(browser, { width: 390, height: 844 });
		const mobileStart = await mobile.page.evaluate(() => ({
			startVisible: !document.getElementById('workspaceStart').hidden,
			navHidden: getComputedStyle(document.querySelector('.mobile-bottom-nav')).display === 'none',
			previewVisible: getComputedStyle(document.querySelector('.preview-panel')).display !== 'none'
		}));
		assert(mobileStart.startVisible && mobileStart.navHidden && mobileStart.previewVisible,
			'Mobile empty-document layout does not prioritize the shared start surface');
		await mobile.page.evaluate(() => window.editor.loadBlankImage(400, 400, '#ffffff'));
		await mobile.page.waitForFunction(() => window.editor.originalImage != null);
		assert(await mobile.page.$eval('.mobile-bottom-nav', (node) => getComputedStyle(node).display !== 'none'),
			'Mobile navigation did not return after document creation');
		await mobile.context.close();

		console.log('Document start verification passed');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
