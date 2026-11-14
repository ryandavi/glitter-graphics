'use strict';

const assert = require('assert');
const { chromium } = require('playwright');
const { openApp } = require('../lib/app');

(async () => {
	// Playwright normally hides scrollbars, masking the header alignment bug.
	const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
	try {
		for (const width of [1440, 390]) {
			const { page, context, errors } = await openApp({ browser, viewport: { width, height: 900 }, touch: width === 390 });
			const editorUrl = page.url();
			const root = new URL('.', editorUrl).href;
			const menu = await page.locator('#appMenuBtn').boundingBox();
			await page.evaluate(() => editor.modalManager.open('historyModal'));
			assert.strictEqual(page.url(), `${root}history/`);
			assert.strictEqual(await page.locator('#historyModal .modal-body h1').textContent(), 'History');
			assert.strictEqual(await page.locator('#historyModal .modal-body head, #historyModal .modal-body header, #historyModal .modal-body script').count(), 0);
			const imageUrl = await page.locator('#historyModal .modal-body img').first().getAttribute('src');
			assert(imageUrl.startsWith(`${root}images/`), imageUrl);
			assert((await page.request.get(imageUrl)).ok());
			assert.strictEqual(await page.evaluate(() => new URL('modals/welcome.html', document.baseURI).href), `${root}modals/welcome.html`);

			await page.goBack();
			await page.waitForFunction(() => !editor.modalManager.isAnyOpen());
			assert.strictEqual(page.url(), editorUrl);
			await page.goForward();
			await page.waitForSelector('#historyModal.visible');
			assert.strictEqual(page.url(), `${root}history/`);

			await page.evaluate(() => editor.modalManager.open('guideModal'));
			assert.strictEqual(page.url(), `${root}guide/`);
			await page.evaluate(() => editor.modalManager.open('confirmationModal'));
			assert.strictEqual(page.url(), `${root}guide/`);
			await page.evaluate(async () => {
				editor.modalManager.close('confirmationModal', { force: true });
				await editor.modalManager.pendingHistoryBack;
			});
			assert.strictEqual(page.url(), `${root}guide/`);
			await page.evaluate(async () => {
				editor.modalManager.close('guideModal');
				await editor.modalManager.pendingHistoryBack;
			});
			assert.strictEqual(page.url(), editorUrl);

			await page.evaluate(() => editor.modalManager.open('preservationModal'));
			assert.strictEqual(page.url(), `${root}preservation/`);
			assert.strictEqual(await page.locator('#PreservationTimelineFilters').getAttribute('data-initialized'), 'true');
			await page.locator('#preservationModal [data-timeline-type]').first().click();
			assert.strictEqual(await page.locator('#preservationModal [data-timeline-type]').first().getAttribute('aria-pressed'), 'true');
			await page.evaluate(() => editor.modalManager.open('personalWebModal'));
			assert.strictEqual(page.url(), `${root}personal-web/`);
			await page.evaluate(() => editor.modalManager.open('welcomeModal'));
			assert.strictEqual(page.url(), editorUrl);
			assert.strictEqual(await page.locator('#welcomeModal .modal-error').count(), 0);
			await page.evaluate(() => editor.modalManager.open('aboutModal'));
			await page.reload({ waitUntil: 'networkidle' });
			assert.strictEqual(page.url(), `${root}about/`);
			assert.strictEqual(await page.locator('body.content-page .doc-content').count(), 1);
			assert.strictEqual(await page.evaluate(() => typeof window.editor), 'undefined');
			if (process.env.GLITTER_TEST_CSS) {
				assert.deepStrictEqual(await page.locator('#appMenuBtn').boundingBox(), menu);
				assert(await page.locator('.content-page-scroll').evaluate(element => element.scrollHeight > element.clientHeight));
				await page.locator('.content-page-scroll').evaluate(element => { element.scrollTop = 300; });
				assert.deepStrictEqual(await page.locator('#appMenuBtn').boundingBox(), menu);
			}
			assert.deepStrictEqual(errors, []);
			await context.close();
			console.log(`PASS content routes, shared article, refresh and header at ${width}px`);
		}
	} finally {
		await browser.close();
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
