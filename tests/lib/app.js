'use strict';

const { chromium } = require('playwright');

async function openApp({ viewport = { width: 1440, height: 900 }, touch = false, document: blank, browser: existingBrowser, setup } = {}) {
	const browser = existingBrowser || await chromium.launch({ headless: true });
	try {
		const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
		if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', route => route.fulfill({ path: process.env.GLITTER_TEST_CSS, contentType: 'text/css' }));
		if (setup) await setup(page);
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/', { waitUntil: 'networkidle' });
		await page.waitForFunction(() => window.editor?.modalManager);
		await page.evaluate(async blank => {
			editor.modalManager.closeAll({ force: true });
			await editor.modalManager.pendingHistoryBack;
			if (blank) await editor.loadBlankImage(blank.width, blank.height, blank.color || '#ffffff');
		}, blank);
		if (blank) await page.waitForFunction(() => editor.originalImage != null);
		return { browser, context, page, errors };
	} catch (error) {
		if (!existingBrowser) await browser.close();
		throw error;
	}
}

module.exports = { openApp };
