'use strict';

const { chromium } = require('playwright');
const { openApp } = require('../lib/app');
const fs = require('fs');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/wn4GBgYGJAQoAHgQCAftBAX8AAAAASUVORK5CYII=';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function openEditor(browser, viewport) {
	return openApp({ browser, viewport, touch: viewport.width < 600 });
}

async function verifyCanvasFormLayout(page) {
	const before = await page.evaluate(() => {
		const settings = document.getElementById('newCanvasSettingsSection');
		const style = getComputedStyle(settings);
		if (parseFloat(style.paddingTop) === 0 || parseFloat(style.paddingBottom) === 0) throw new Error('New Canvas settings lack vertical padding');
		for (const button of document.querySelectorAll('#newCanvasOrientation button, #newCanvasBackground button')) {
			if (button.scrollWidth > button.clientWidth + 1) throw new Error('New Canvas segmented option is clipped');
		}
		const pane = document.getElementById('newCanvasPresets');
		if (!pane.classList.contains('scroll-region') || !pane.classList.contains('has-scroll-fade')) throw new Error('Preset pane lacks the shared scrollbar or fade');
		return [pane.clientHeight, pane.getBoundingClientRect().bottom, settings.getBoundingClientRect().top, settings.offsetHeight];
	});
	await page.click('#newCanvasBackground [data-value="transparent"]');
	await page.waitForTimeout(100);
	const after = await page.evaluate(() => {
		const pane = document.getElementById('newCanvasPresets');
		const settings = document.getElementById('newCanvasSettingsSection');
		return [pane.clientHeight, pane.getBoundingClientRect().bottom, settings.getBoundingClientRect().top, settings.offsetHeight];
	});
	assert(JSON.stringify(before) === JSON.stringify(after), 'Background change resized the presets or settings pane');
	assert(await page.isDisabled('#newCanvasColor'), 'Transparent background left Color editable');
	await page.click('#newCanvasBackground [data-value="color"]');
	assert(await page.isEnabled('#newCanvasColor'), 'Color background did not restore the color field');
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const startupContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		await startupContext.addInitScript(() => {
			localStorage.setItem('glitter.theme', JSON.stringify('bubblegum'));
			localStorage.setItem('glitter.preferences', JSON.stringify({
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
		assert(await startupPage.evaluate(() => document.documentElement.dataset.theme === 'bubblegum'),
			'Saved theme was not applied by the head bootstrap before app initialization');
		await startupPage.waitForFunction(() => window.editor != null, null, { timeout: 15000 });
		await startupPage.waitForSelector('.workspace-start-preset[data-preset-id]');
		assert(await startupPage.evaluate(() => !isFeatureEnabled('welcomeOnStartup')
			&& !document.querySelector('.modal-overlay.visible')
			&& !document.getElementById('workspaceStart').hidden),
			'Startup did not land on the start card with no modal open');
		assert(await startupPage.evaluate(() => document.querySelectorAll('.workspace-start-preset[data-preset-id]').length
			=== CONFIG.canvas.presets.filter((preset) => preset.quickStart).length),
			'Start card quick presets do not match the configured quickStart presets');
		await startupPage.click('#workspaceStartAbout');
		await startupPage.waitForSelector('#aboutModal.visible', { timeout: 5000 });
		await startupPage.waitForSelector('#aboutModal #AboutWhatYouCanMake', { timeout: 5000 });
		await startupPage.click('#closeAboutModal');
		await startupPage.evaluate(() => document.getElementById('openWelcomeModal').click());
		await startupPage.waitForSelector('#welcomeModal.visible', { timeout: 1000 });
		assert(await startupPage.isVisible('#welcomeModal .modal-loading'),
			'Welcome modal waits for its external content before becoming visible');
		await startupPage.waitForFunction(() => !document.querySelector('#welcomeModal .modal-loading'), null, { timeout: 5000 });
		assert(await startupPage.evaluate(() => [...document.querySelectorAll('#welcomeModal .welcome-checkbox')].every((node) => node.hidden)),
			'Welcome still offers a startup option while startup Welcome is gated off');
		await startupPage.click('#welcomeStartCreatingBtn');
		await startupPage.click('.workspace-start-preset[data-preset-id="classic-blingee"]');
		await startupPage.waitForFunction(() => window.editor.originalImage != null);
		assert(await startupPage.evaluate(() => window.editor.previewCanvas.width === 400 && window.editor.previewCanvas.height === 400
			&& document.getElementById('workspaceStart').hidden),
			'A start card preset did not create its canvas in one click');
		assert(await startupPage.evaluate(() => PREFERENCES.get('recentCanvasSizes')[0].width === 400
			&& PREFERENCES.get('recentCanvasSizes')[0].height === 400), 'Start card creation did not record a recent size');
		await startupContext.close();

		const desktop = await openEditor(browser, { width: 1440, height: 900 });
		await desktop.page.waitForFunction(() => document.querySelector('.new-canvas-template-btn'));
		const startState = await desktop.page.evaluate(() => ({
			startVisible: !document.getElementById('workspaceStart').hidden,
			noLegacyImagePanel: !document.getElementById('imagePanelSection'),
			presetCount: document.querySelectorAll('.new-canvas-preset-btn').length,
			presetGroups: [...document.querySelectorAll('#newCanvasPresets .property-group-label')].map((node) => node.textContent),
			maxWidth: Number(document.getElementById('newCanvasWidth').max),
			maxHeight: Number(document.getElementById('newCanvasHeight').max),
			panelsHidden: ['.layers-panel', '.design-panel']
				.every((selector) => getComputedStyle(document.querySelector(selector)).display === 'none')
		}));
		assert(startState.startVisible, 'Desktop start surface is not visible without a document');
		assert(startState.noLegacyImagePanel, 'Legacy Image panel is still present');
		assert(startState.presetCount === 10, `Expected 10 canvas presets, got ${startState.presetCount}`);
		assert(startState.presetGroups.join('|') === 'Web Classics|General|Social Media|Templates', 'Canvas preset groups are missing or out of order');
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
		await desktop.page.waitForTimeout(250);
		assert(await desktop.page.evaluate(() => document.activeElement.id === 'newCanvasWidth'), 'Desktop initial focus did not land on Width');
		await verifyCanvasFormLayout(desktop.page);
		await desktop.page.fill('#newCanvasName', 'Star Garden');
		const presetBox = await desktop.page.locator('#newCanvasPresets').boundingBox();
		await desktop.page.mouse.move(presetBox.x + presetBox.width / 2, presetBox.y + 70);
		await desktop.page.waitForSelector('.scroll-region-track.is-visible');
		const thumbBox = await desktop.page.locator('.scroll-region-thumb').boundingBox();
		await desktop.page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
		await desktop.page.mouse.down();
		await desktop.page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2 + 40);
		await desktop.page.mouse.up();
		assert(await desktop.page.$eval('#newCanvasPresets', pane => pane.scrollTop > 0), 'Custom scrollbar did not scroll the preset pane');
		const independentScroll = await desktop.page.evaluate(async () => {
			const presets = document.getElementById('newCanvasPresets');
			const settings = document.getElementById('newCanvasSettingsSection');
			const before = settings.getBoundingClientRect().top;
			presets.scrollTop = presets.scrollHeight;
			await new Promise(resolve => requestAnimationFrame(resolve));
			return presets.scrollTop > 0 && settings.getBoundingClientRect().top === before
				&& document.querySelector('#newCanvasModal .modal-body').scrollTop === 0;
		});
		assert(independentScroll, 'Presets did not scroll independently of the settings');
		await desktop.page.waitForTimeout(100);
		assert(await desktop.page.evaluate(() => !document.getElementById('newCanvasPresets').classList.contains('has-scroll-fade')),
			'Preset fade stayed visible at the end of the list');
		await desktop.page.click('.new-canvas-template-btn');
		assert(await desktop.page.evaluate(() => document.getElementById('newCanvasSettingsSection').inert
			&& !document.getElementById('newCanvasTemplateNote').hidden
			&& document.querySelector('#createCanvasBtn .name').textContent === 'Open Template'
			&& !document.querySelector('.new-canvas-preset-btn.active')), 'Template selection did not disable settings and change the action');
		await desktop.page.click('#newCanvasModal [data-preset-id="classic-blingee"]');
		assert(await desktop.page.evaluate(() => !document.getElementById('newCanvasSettingsSection').inert
			&& document.getElementById('newCanvasTemplateNote').hidden
			&& document.querySelector('#createCanvasBtn .name').textContent === 'Create Canvas'), 'Size selection did not restore blank-canvas settings');
		const landscapePreviewsFit = await desktop.page.evaluate(() => (
			['landscape-video', 'classic-signature', 'general-landscape'].every((id) => {
				const button = document.querySelector(`#newCanvasModal [data-preset-id="${id}"]`);
				const wrapper = button.querySelector('.blank-preview-wrapper').getBoundingClientRect();
				const preview = button.querySelector('.blank-preview').getBoundingClientRect();
				return preview.width <= wrapper.width * 0.82 && preview.height <= wrapper.height;
			})
		));
		assert(landscapePreviewsFit, 'Landscape preset previews fill their entire preview frame');
		await desktop.page.click('#newCanvasModal [data-preset-id="story-reel"]');
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
		assert(await desktop.page.evaluate(async () => editor.projectName === 'Star Garden'
			&& document.getElementById('projectNameInput').value === 'Star Garden'
			&& (await editor.projectSerializer.serialize()).name === 'Star Garden'), 'New Canvas name did not reach the project and saved metadata');
		await desktop.page.evaluate(() => editor.modalManager.open('newCanvasModal'));
		assert(await desktop.page.inputValue('#newCanvasName') === '', 'New canvas kept the previous draft name');
		await desktop.page.fill('#newCanvasName', 'Cancelled draft');
		await desktop.page.click('#createCanvasCloseBtn');
		assert(await desktop.page.evaluate(() => editor.projectName === 'Star Garden'), 'Cancelling changed the current project name');
		await desktop.page.evaluate(() => editor.modalManager.open('newCanvasModal'));
		assert(await desktop.page.$eval('[data-recent-group] .action-card-title', node => node.textContent === 'Story / Reel'),
			'Preset-sized recent did not carry its preset label');
		await desktop.page.fill('#newCanvasWidth', '88');
		await desktop.page.fill('#newCanvasHeight', '31');
		await desktop.page.click('#createCanvasBtn');
		await desktop.page.waitForSelector('#newCanvasModal.visible', { state: 'hidden' });
		await desktop.page.evaluate(() => editor.modalManager.open('newCanvasModal'));
		assert(await desktop.page.$eval('[data-recent-group] .action-card-title', node => node.textContent === 'Custom'),
			'Custom recent was not the first tile');
		assert(await desktop.page.evaluate(() => document.getElementById('newCanvasWidth').value === '400'
			&& document.getElementById('newCanvasHeight').value === '400'), 'Reopening did not reset to default dimensions');
		await desktop.page.click('[data-recent-group] .new-canvas-preset-btn:first-child');
		assert(await desktop.page.evaluate(() => document.getElementById('newCanvasWidth').value === '88'
			&& document.getElementById('newCanvasHeight').value === '31'), 'Custom recent did not restore dimensions');
		await desktop.page.fill('#newCanvasWidth', '1025');
		await desktop.page.click('#createCanvasBtn');
		assert(await desktop.page.evaluate(() => PREFERENCES.get('recentCanvasSizes').length === 2), 'Invalid size polluted recents');
		await desktop.page.fill('#newCanvasWidth', '88');
		await desktop.page.dblclick('[data-recent-group] .new-canvas-preset-btn:first-child');
		await desktop.page.waitForSelector('#newCanvasModal.visible', { state: 'hidden' });
		assert(await desktop.page.evaluate(() => PREFERENCES.get('recentCanvasSizes').length === 2), 'Repeated creation duplicated recent size');
		await desktop.page.evaluate(async () => {
			const before = JSON.stringify(PREFERENCES.get('recentCanvasSizes'));
			PREFERENCES.resetAll();
			if (JSON.stringify(PREFERENCES.get('recentCanvasSizes')) !== before) throw new Error('Settings reset cleared recent sizes');
			await editor.loadBlankImage(576, 1024);
			if (JSON.stringify(PREFERENCES.get('recentCanvasSizes')) !== before) throw new Error('Internal blank load recorded a recent size');
		});

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
		await mobile.page.click('#openNewCanvasBtn');
		await mobile.page.waitForTimeout(250);
		assert(await mobile.page.evaluate(() => document.activeElement.matches('.modal-title-text')), 'Phone initial focus opened a numeric field');
		await verifyCanvasFormLayout(mobile.page);
		assert(await mobile.page.evaluate(() => {
			const presets = document.getElementById('newCanvasPresets');
			const settings = document.getElementById('newCanvasSettingsSection');
			const top = settings.getBoundingClientRect().top;
			presets.scrollTop = presets.scrollHeight;
			return presets.scrollTop > 0 && settings.getBoundingClientRect().top === top;
		}), 'Phone presets moved the fixed settings band');
		await mobile.page.setViewportSize({ width: 360, height: 640 });
		await mobile.page.waitForTimeout(100);
		assert(await mobile.page.evaluate(() => {
			const pane = document.getElementById('newCanvasPresets');
			const group = pane.querySelector('.new-canvas-preset-group');
			const tile = group.querySelector('.blank-image-option');
			const grid = group.querySelector('.blank-image-grid');
			return pane.clientHeight >= tile.offsetHeight + parseFloat(getComputedStyle(grid).rowGap)
				+ group.querySelector('.property-group-label').offsetHeight;
		}), '360 × 640 phone cannot show a complete preset row above the five-row form');
		await mobile.page.evaluate(() => { document.getElementById('newCanvasPresets').scrollTop = 0; });
		await mobile.page.waitForTimeout(100);
		await verifyCanvasFormLayout(mobile.page);
		await mobile.page.evaluate(() => { document.getElementById('newCanvasPresets').scrollTop = 0; });
		fs.mkdirSync('.tmp/new-canvas', { recursive: true });
		await mobile.page.screenshot({ path: '.tmp/new-canvas/phone-360x640.png' });
		await mobile.page.evaluate(() => {
			PREFERENCES.set('recentCanvasSizes', Array.from({ length: CONFIG.canvas.recentSizeCount }, (_, index) => ({ width: 88 + index, height: 31 })));
			editor.initializeNewCanvasModal();
		});
		await mobile.page.waitForTimeout(100);
		assert(await mobile.page.locator('[data-recent-group] .blank-image-option:visible').count() === 2,
			'Phone recent sizes wrapped beyond a single row');
		await mobile.page.setViewportSize({ width: 1200, height: 800 });
		await mobile.page.waitForTimeout(100);
		assert(await mobile.page.locator('[data-recent-group] .blank-image-option:visible').count() === 3,
			'Recent row did not refit when the modal widened');
		await mobile.page.setViewportSize({ width: 640, height: 360 });
		assert(await mobile.page.evaluate(() => {
			const body = document.querySelector('#newCanvasModal .modal-body');
			return getComputedStyle(body).display === 'block' && body.scrollHeight > body.clientHeight;
		}), 'Short viewport did not fall back to a scrolling body');
		await mobile.page.evaluate(() => editor.modalManager.close('newCanvasModal'));
		await mobile.page.setViewportSize({ width: 390, height: 844 });
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
