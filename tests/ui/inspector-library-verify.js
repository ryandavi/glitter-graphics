'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');
const browserType = process.env.GLITTER_BROWSER === 'webkit' ? webkit : chromium;

const css = process.env.GLITTER_TEST_CSS;
const output = path.resolve('.tmp/inspector-completion');
const wait = (page) => page.waitForTimeout(400);

async function press(page, title) {
	await page.evaluate((name) => {
		const mobile = window.editor.mobileManager;
		mobile.renderBar();
		const entry = mobile.barEntries.find((candidate) => candidate.title === name);
		if (!entry) throw new Error(`Missing chip: ${name}`);
		mobile.pressChip(entry);
	}, title);
	await wait(page);
}

async function swipe(page, start, end) {
	const session = await page.context().newCDPSession(page);
	const touch = (x, y) => [{ x, y, id: 1 }];
	await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(start.x, start.y) });
	for (let step = 1; step <= 12; step++) {
		await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(start.x + (end.x - start.x) * step / 12, start.y) });
		await page.waitForTimeout(16);
	}
	await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await session.detach();
}

async function main() {
	fs.mkdirSync(output, { recursive: true });
	const browser = await browserType.launch();
	try {
		const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		if (css) await page.route('**/css/style.css*', (route) => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(css) }));
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/', { waitUntil: 'networkidle' });
		await page.evaluate(async () => {
			window.editor.modalManager.closeAll({ force: true });
			await window.editor.loadBlankImage(300, 240, '#ffffff');
			window.editor.setTool(ToolType.SELECT);
		});
		await wait(page);
		assert.deepEqual(await page.evaluate(() => window.editor.mobileManager.barEntries.filter((entry) => entry.button).map((entry) => entry.title)), ['Sticker', 'Fill Layer', 'Shape', 'Text']);
		assert(await page.locator('.mobile-layers-swatch').evaluate((node) => node.classList.contains('is-unset')));
		assert(await page.locator('.phone-chip.is-add').count() === 4);
		for (let run = 0; browserType === chromium && run < 3; run++) {
			await page.locator('#phoneChipBar').evaluate((node) => { node.scrollLeft = 0; });
			const rect = await page.locator('#phoneChipBar').boundingBox();
			await swipe(page, { x: rect.x + rect.width - 35, y: rect.y + rect.height / 2 }, { x: rect.x + 25, y: rect.y + rect.height / 2 });
			assert(await page.locator('#phoneChipBar').evaluate((node) => node.scrollLeft > 50), 'Native chip swipe must scroll every time');
		}
		console.log(`PASS permanent phone bar, ordered Add chips and unset swatch${browserType === chromium ? ', with repeated native scrolling' : ' (native swipe covered in Chromium)'}`);
		await page.screenshot({ path: path.join(output, 'phone-canvas-bar.png') });

		await page.evaluate(() => window.editor.viewport.setZoom(1.25));
		const samples = await page.evaluate(async () => {
			const editor = window.editor;
			const mobile = editor.mobileManager;
			const entry = mobile.barEntries.find((candidate) => candidate.title === 'Size');
			const samples = [];
			const sample = (phase) => new Promise((resolve) => {
				const start = performance.now();
				const frame = () => {
					const tween = editor.viewport.viewTween;
					samples.push({ phase, time: performance.now() - start, shown: tween?.shown.zoom ?? editor.viewport.currentZoom, target: editor.viewport.currentZoom, transform: editor.previewWrapper.style.transform, sheet: document.getElementById('designPanel').getBoundingClientRect().top });
					if (performance.now() - start < 360) requestAnimationFrame(frame);
					else resolve();
				};
				requestAnimationFrame(frame);
			});
			mobile.pressChip(entry);
			await sample('open');
			mobile.closeAllDrawers();
			await sample('close');
			return samples;
		});
		fs.writeFileSync(path.join(output, 'animation.json'), JSON.stringify(samples, null, 2));
		for (const phase of ['open', 'close']) {
			const frames = samples.filter((sample) => sample.phase === phase);
			assert(frames.some((frame) => frame.time > 120 && frame.time < 200 && Math.abs(frame.shown - frame.target) > 0.005), `${phase} must keep animating past the pixel-zoom debounce`);
			assert(frames.every((frame) => Math.abs(Number(frame.transform.match(/scale\(([^)]+)\)/)[1]) - frame.shown) < 0.0001), `${phase} transform must follow the animated view every frame`);
		}
		console.log('PASS canvas and sheet keep animating together on open and close');

		const textId = await page.evaluate(async () => {
			const editor = window.editor;
			const layer = editor.textGlitterManager.createLayer({ text: 'Hello', position: { x: 150, y: 120 } });
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			await editor.textGlitterManager.refreshLayer(layer, { saveHistory: false });
			return layer.id;
		});
		await wait(page);
		await press(page, 'Type');
		await page.evaluate(() => window.editor.fontBrowserManager.openPicker());
		await wait(page);
		assert(await page.locator('#libraryBack').isVisible(), 'Font Library must have Back');
		await page.locator('#libraryBack').click();
		await wait(page);
		assert.equal(await page.locator('#inspectorTitleText').textContent(), 'Type');
		await press(page, 'Fill');
		await page.evaluate(() => window.editor.textGlitterManager.armPicker('fill'));
		await wait(page);
		await page.locator('#libraryBack').click();
		await wait(page);
		assert(await page.locator('#flyoutSection').isVisible());
		await page.screenshot({ path: path.join(output, 'phone-fill-back.png') });
		console.log('PASS Library Back returns to both inline and flyout sections');

		await page.evaluate(() => {
			window.editor.mobileManager.closeAllDrawers({ immediate: true });
			window.editor.setTool(ToolType.TEXT);
			window.editor.mobileManager.renderBar();
		});
		await press(page, 'Type');
		const count = await page.evaluate(() => window.editor.layers.length);
		await page.touchscreen.tap(180, 160);
		assert.equal(await page.evaluate(() => window.editor.layers.length), count, 'Hidden Text tool must not create a layer');
		assert(await page.evaluate(() => window.editor.isCanvasToolSuspended()));
		await page.evaluate(() => window.editor.mobileManager.closeAllDrawers({ immediate: true }));
		assert(!await page.evaluate(() => window.editor.isCanvasToolSuspended()));
		console.log('PASS hidden tools suspend canvas actions and resume when the sheet closes');

		await page.setViewportSize({ width: 390, height: 500 });
		await wait(page);
		await press(page, 'Transform');
		assert(await page.locator('#inspectorClose').isVisible());
		await page.locator('#textRotation').evaluate((node) => {
			node.value = '30';
			node.dispatchEvent(new Event('input', { bubbles: true }));
			node.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await wait(page);
		assert(await page.locator('#inspectorReset').isEnabled());
		await page.locator('#inspectorReset').click();
		await wait(page);
		assert.equal(await page.evaluate(() => window.editor.layerManager.getInspectedLayer().transform.rotation), 0, 'Sheet header must forward the Transform reset');
		await page.screenshot({ path: path.join(output, 'phone-short-transform.png') });
		await page.goBack();
		await wait(page);
		assert.equal(await page.evaluate(() => window.editor.mobileManager.activeDrawer), null, 'Browser Back must dismiss the sheet');
		await page.goForward();
		await wait(page);
		assert.equal(await page.evaluate(() => window.editor.mobileManager.activeDrawer), null, 'Forward must not revive a dismissed picker');
		await press(page, 'Transform');
		await page.keyboard.press('Escape');
		await wait(page);
		assert.equal(await page.evaluate(() => window.editor.mobileManager.activeDrawer), null, 'Escape must dismiss inline sheets');
		console.log('PASS browser Back, Forward and Escape dismiss sheets without stale sessions');
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.waitForTimeout(800);
		await page.evaluate((id) => { window.editor.setTool(ToolType.SELECT); window.editor.layerManager.setActiveLayer(id); window.editor.viewport.zoomToFill(); }, textId);
		const before = await page.evaluate(() => ({ rect: window.editor.previewContainer.getBoundingClientRect().toJSON(), view: window.editor.viewport.captureViewState(), usable: window.editor.viewport.getUsableRect() }));
		await page.evaluate(() => window.editor.pickers.toggleFlyout('fill'));
		await wait(page);
		const after = await page.evaluate(() => ({ rect: window.editor.previewContainer.getBoundingClientRect().toJSON(), view: window.editor.viewport.captureViewState(), usable: window.editor.viewport.getUsableRect() }));
		assert.deepEqual(after, before, 'Desktop Library must overlay without moving the canvas');
		assert.equal(before.rect.width, await page.locator('.main-content').evaluate((node) => node.clientWidth));
		assert(await page.locator('#layersPanel').isVisible(), 'Library must retain Layers');
		await page.screenshot({ path: path.join(output, 'desktop-overlay.png') });
		assert.deepEqual(errors, []);
		console.log('PASS short screen, breakpoint cleanup and desktop workspace overlay; no page errors');
	} finally {
		await browser.close();
	}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
