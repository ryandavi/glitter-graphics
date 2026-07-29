'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await context.addInitScript(() => localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'));
	const page = await context.newPage();
	const runtimeErrors = [];
	page.on('pageerror', (error) => runtimeErrors.push(error.message || String(error)));
	page.on('console', (message) => {
		if (message.type() === 'error') runtimeErrors.push(message.text());
	});

	try {
		await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => window.editor != null, null, { timeout: 15000 });

		const modalAudit = await page.evaluate(() => {
			const advanced = document.querySelector('#exportSettingsModal .export-advanced-settings');
			return {
				advancedCount: document.querySelectorAll('#exportSettingsModal [data-advanced]').length,
				advancedIds: advanced ? [...advanced.querySelectorAll('[id]')].map((node) => node.id) : [],
				creativeIds: ['exportTransparency', 'exportMatteColor', 'exportWatermarkEnabled', 'exportFrameDelay', 'exportReverse']
					.filter((id) => !document.getElementById(id)?.closest('[data-advanced]')),
				sectionResetCount: document.querySelectorAll('#exportSettingsModal .reset-section-btn').length,
				settingsRows: ['interfaceTheme', 'showHelpfulHints', 'showWelcomeOnStartup', 'confirmDestructiveActions']
					.filter((id) => document.getElementById(id)).length
			};
		});
		assert(modalAudit.advancedCount === 0, `Export Settings still contains a nested Advanced disclosure (${modalAudit.advancedCount})`);
		for (const id of ['exportDitherEnabled', 'exportDitherType', 'exportQuality', 'exportMaxFrames', 'exportSmartFrameReduction', 'exportFrameSkip']) {
			assert(!modalAudit.advancedIds.includes(id), `${id} is unexpectedly nested inside Export Advanced`);
		}
		assert(modalAudit.creativeIds.length === 5, 'Creative export controls are not all top-level');
		assert(modalAudit.sectionResetCount === 0, 'Export Settings still has per-section reset buttons');
		assert(modalAudit.settingsRows === 4, 'Settings modal is missing backed interface controls');
		console.log('PASS Export and Settings modal hierarchy');

		await page.evaluate(() => window.editor.modalManager.open('exportSettingsModal'));
		assert(await page.locator('#exportSettingsModal [data-advanced-toggle]').count() === 0,
			'Export Settings unexpectedly renders an Advanced disclosure toggle');
		console.log('PASS Export settings remain flat and searchable');

		await page.evaluate(() => window.editor.modalManager.close('exportSettingsModal'));
		await page.waitForTimeout(350);
		await page.evaluate(() => window.editor.modalManager.open('settingsModal'));
		await page.selectOption('#interfaceTheme', 'light');
		await page.waitForTimeout(50);
		const themeState = await page.evaluate(() => ({
			theme: document.documentElement.dataset.theme,
			background: getComputedStyle(document.documentElement).getPropertyValue('--color-bg-primary').trim(),
			saved: JSON.parse(localStorage.getItem('glitterEditorSettings')).interfaceTheme
		}));
		assert(themeState.theme === 'light' && themeState.saved === 'light', 'Light theme was not applied and persisted');
		assert(themeState.background === '#eef3f9', `Unexpected light theme background token: ${themeState.background}`);
		console.log('PASS Light theme application and persistence');

		await page.$eval('#showWelcomeOnStartup', (input) => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
		assert(await page.evaluate(() => localStorage.getItem('glitterEditor_welcomeModalSeen') === null),
			'Enabling the welcome screen did not clear suppression state');
		await page.$eval('#showWelcomeOnStartup', (input) => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
		assert(await page.evaluate(() => localStorage.getItem('glitterEditor_welcomeModalSeen') === 'true'),
			'Disabling the welcome screen did not set suppression state');
		await page.$eval('#confirmDestructiveActions', (input) => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
		assert(await page.evaluate(() => window.editor.confirmAction({ destructive: true })),
			'Disabled destructive confirmations did not bypass the modal');
		console.log('PASS Backed interface preference behavior');

		await page.evaluate(async () => {
			window.editor.modalManager.close('settingsModal');
			await window.editor.loadBlankImage(240, 180, '#ffffff');
			window.editor.setTool(ToolType.SELECT);
		});
		await page.keyboard.down('Space');
		assert(await page.evaluate(() => window.editor.currentTool === ToolType.HAND), 'Space did not activate temporary Hand tool');
		await page.keyboard.up('Space');
		assert(await page.evaluate(() => window.editor.currentTool === ToolType.SELECT), 'Space release did not restore Select tool');
		await page.focus('#projectNameInput');
		await page.keyboard.press('Space');
		assert(await page.evaluate(() => window.editor.currentTool === ToolType.SELECT), 'Space changed tools while typing');
		console.log('PASS Temporary Hand tool and typing guard');

		await page.evaluate(() => {
			window.__redoCalls = 0;
			window.editor.redo = async () => { window.__redoCalls += 1; };
		});
		await page.keyboard.press('Control+Y');
		assert(await page.evaluate(() => window.__redoCalls === 1), 'Ctrl+Y did not invoke redo');
		console.log('PASS Ctrl+Y redo alias');

		await page.evaluate(() => window.editor.viewport.setZoom(2));
		await page.dblclick('#statusZoom');
		await page.waitForTimeout(80);
		assert(await page.evaluate(() => Math.abs(window.editor.viewport.currentZoom - 1) < 0.001),
			'Double-clicking zoom readout did not reset to 100%');
		console.log('PASS Zoom readout double-click reset');

		const textId = await page.evaluate(() => window.editor.layerManager.addLayer(LayerType.TEXT_GLITTER, {
			textLayer: { text: 'Edit me', position: { x: 120, y: 90 }, align: 'center', boxMode: 'auto' }
		})?.id);
		await page.waitForSelector(`.text-glitter-element[data-layer-id="${textId}"]`);
		await page.evaluate((id) => window.editor.layerManager.setActiveLayer(id), textId);
		await page.dblclick(`.text-glitter-element[data-layer-id="${textId}"]`, { force: true });
		await page.waitForTimeout(80);
		assert(await page.evaluate(() => document.activeElement === window.editor.textGlitterManager.ui.textInput),
			'Double-clicking text did not focus the text input');
		console.log('PASS Desktop text double-click editing');

		await page.evaluate(() => {
			document.activeElement?.blur();
			window.editor.setTool(ToolType.SELECT);
		});
		const textBox = await page.locator(`.transform-handles[data-layer-id="${textId}"] .transform-bounding-box`).boundingBox();
		const textCountBefore = await page.evaluate(() => window.editor.layerManager.layers.filter((layer) => layer.type === LayerType.TEXT_GLITTER).length);
		await page.keyboard.down('Alt');
		assert(await page.$eval('#previewContainer', (node) => node.classList.contains('alt-duplicate-armed')),
			'Alt did not arm the duplicate cursor state');
		await page.mouse.move(textBox.x + textBox.width / 2, textBox.y + textBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(textBox.x + textBox.width / 2 + 30, textBox.y + textBox.height / 2 + 20, { steps: 4 });
		await page.waitForTimeout(100);
		const liveDuplicate = await page.evaluate(() => ({
			status: document.getElementById('statusText').textContent,
			copies: document.querySelectorAll('.text-glitter-element, [data-duplicate-ghost]').length,
			layers: window.editor.layerManager.layers.filter((layer) => layer.type === LayerType.TEXT_GLITTER).length
		}));
		assert(liveDuplicate.status === 'Duplicating layer', `Unexpected duplicate state: ${JSON.stringify(liveDuplicate)}`);
		assert(liveDuplicate.copies >= 2, 'Alt-drag did not show a source plus clone/ghost during the drag');
		await page.mouse.up();
		await page.keyboard.up('Alt');
		await page.waitForTimeout(120);
		const textCountAfter = await page.evaluate(() => window.editor.layerManager.layers.filter((layer) => layer.type === LayerType.TEXT_GLITTER).length);
		assert(textCountAfter === textCountBefore + 1, 'Alt-drag did not create exactly one text clone');
		await page.evaluate(() => window.editor.undo());
		await page.waitForTimeout(150);
		assert(await page.evaluate((expected) => window.editor.layerManager.layers.filter((layer) => layer.type === LayerType.TEXT_GLITTER).length === expected, textCountBefore),
			'One undo did not remove the Alt-drag clone');
		console.log('PASS Alt-drag affordance, live clone visibility, and one-step undo');

		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForTimeout(400);
		const mobileActions = await page.evaluate(() => ({
			toolbarSettings: getComputedStyle(document.getElementById('settingsBtn')).display,
			toolbarClearGroup: getComputedStyle(document.getElementById('toolbarClearGroup')).display,
			hasLayersClear: Boolean(document.getElementById('layersBarClearAll')),
			bottomNavButtons: document.querySelectorAll('.mobile-bottom-nav .mobile-drawer-btn').length
		}));
		assert(mobileActions.toolbarSettings !== 'none', 'Mobile toolbar is missing App Settings');
		assert(mobileActions.toolbarClearGroup === 'none', 'Mobile toolbar still shows Clear All');
		assert(mobileActions.hasLayersClear && mobileActions.bottomNavButtons === 4,
			`Mobile four-button navigation or relocated Clear All is unavailable: ${JSON.stringify(mobileActions)}`);
		console.log('PASS Mobile Settings visibility and Clear All relocation');

		assert(runtimeErrors.length === 0, `Runtime errors:\n${runtimeErrors.join('\n')}`);
		console.log('\nUX polish verification finished with all checks passing.');
	} finally {
		await context.close();
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error.stack || error);
	process.exit(1);
});
