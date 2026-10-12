'use strict';

const assert = require('assert');
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', route => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.GLITTER_TEST_CSS) }));
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/');
		await page.waitForFunction(() => window.editor);
		await page.evaluate(() => editor.loadBlankImage(500, 500));
		await page.waitForFunction(() => editor.originalImage);
		const id = await page.evaluate(async () => {
			const template = await (await fetch('data/templates/caption-bar.glitter.json')).json();
			const layer = editor.textGlitterManager.createLayer({ text: 'Caption', position: { x: 250, y: 250 } });
			layer.textData = template.layers[0].textData;
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			await FontLibrary.ensureLoaded(layer.textData.fontId);
			await editor.textGlitterManager.refreshLayer(layer, { saveHistory: true });
			return layer.id;
		});
		const chrome = `.transform-handles[data-layer-id="${id}"]`;
		const checks = await page.evaluate(async id => {
			const manager = editor.textGlitterManager;
			const layer = editor.layerManager.getLayerById(id);
			const results = [];
			for (const text of ['CAPTION', 'Your caption here', 'gyp']) {
				layer.textData.text = text;
				await manager.refreshLayer(layer, { saveHistory: false });
				const entry = manager.getMeasurementEntry(layer);
				const ink = entry.textInkRect;
				results.push(entry.layout.visibleLines[0].baseline === entry.ascent && ink.height > 0);
			}
			layer.textData.boxHeight = Math.ceil(manager.getMeasurementEntry(layer).textInkRect.height);
			layer.textData.boxMode = 'fixed';
			await manager.refreshLayer(layer, { saveHistory: true });
			results.push(!manager.getMeasurementEntry(layer).hasOverflow);
			return results;
		}, id);
		assert(checks.every(Boolean), 'Caption baseline uses font metrics and lowercase fits a fixed box');
		assert.equal(await page.locator(`${chrome} .text-baselines > span`).count(), 1);
		assert.equal(await page.locator('.text-box-mode-group.is-stacked').count(), 0);
		for (let index = 0; index < 2; index++) {
			const edge = page.locator(`${chrome} [data-handle-type="edge-bottom"]`);
			assert(await edge.isVisible(), 'Short caption has a bottom resize edge');
			const rect = await edge.boundingBox();
			const before = await page.evaluate(id => editor.layerManager.getLayerById(id).textData.boxHeight, id);
			await page.mouse.move(rect.x + rect.width / 2 + 35, rect.y + rect.height / 2);
			await page.mouse.down();
			await page.mouse.move(rect.x + rect.width / 2 + 35, rect.y + rect.height / 2 + 25, { steps: 5 });
			await page.mouse.up();
			assert(await page.evaluate(({ id, before }) => editor.layerManager.getLayerById(id).textData.boxHeight > before, { id, before }), 'Fixed caption can be extended repeatedly');
		}
		const mode = page.locator(`${chrome} [data-handle-type="text-mode"]`);
		await mode.click();
		await page.waitForFunction(id => editor.layerManager.getLayerById(id).textData.boxMode === 'point', id);
		const origin = await page.evaluate(id => editor.textGlitterManager.getTextOriginWorldPosition(editor.layerManager.getLayerById(id)), id);
		await mode.click();
		await page.waitForFunction(id => editor.layerManager.getLayerById(id).textData.boxMode === 'fixed', id);
		assert(await page.evaluate(({ id, origin }) => {
			const layer = editor.layerManager.getLayerById(id);
			const next = editor.textGlitterManager.getTextOriginWorldPosition(layer);
			return !editor.textGlitterManager.getMeasurementEntry(layer).hasOverflow && Math.hypot(origin.x - next.x, origin.y - next.y) < 1;
		}, { id, origin }), 'Point to box conversion preserves the text origin');
		await page.evaluate(() => editor.undo());
		assert.equal(await page.evaluate(id => editor.layerManager.getLayerById(id).textData.boxMode, id), 'point', 'Conversion is one undo step');
		for (const boxMode of ['point', 'autoHeight', 'fixed']) {
			const points = await page.evaluate(async ({ id, boxMode }) => {
				const manager = editor.textGlitterManager;
				const layer = editor.layerManager.getLayerById(id);
				Object.assign(layer.textData, { boxMode, boxWidth: 180, boxHeight: 100 });
				layer.textData.textBackground.enabled = false;
				Object.assign(layer.transform, { rotation: 25, scale: { x: 110, y: 90 }, flipX: true });
				await manager.refreshLayer(layer, { saveHistory: false });
				editor.layerManager.setActiveLayer(null);
				PREFERENCES.set('autoSelect', true);
				const entry = manager.getMeasurementEntry(layer);
				const line = entry.positionedLines.find(line => !line.blank);
				const body = entry.bodyRect;
				const screen = (x, y) => {
					const world = manager.getWorldPointFromLocal(layer.transform, { x: x - entry.width / 2, y: y - entry.height / 2 });
					const rect = editor.previewContainer.getBoundingClientRect();
					return { x: rect.left + editor.viewport.panX + world.x * editor.viewport.currentZoom, y: rect.top + editor.viewport.panY + world.y * editor.viewport.currentZoom };
				};
				return {
					text: screen(entry.layoutOffsetX + (line.left + line.right) / 2, entry.layoutOffsetY + (line.top + line.bottom) / 2),
					edge: screen(body.x + 1, body.y + 1),
					inside: screen(body.x + body.width / 4, body.y + body.height / 2)
				};
			}, { id, boxMode });
			await page.mouse.move(points.text.x, points.text.y);
			await page.waitForFunction(() => document.querySelector('.selection-overlay > .text-baselines > span'));
			assert.equal(await page.locator('.transform-hover-outline:visible').count(), 0, `${boxMode}: text hover shows only baselines`);
			await page.mouse.move(points.edge.x, points.edge.y);
			await page.waitForFunction(() => document.querySelector('.transform-hover-outline:not([hidden])'));
			assert.equal(await page.locator('.selection-overlay > .text-baselines > span').count(), 0, `${boxMode}: frame hover shows only the outline`);
			if (boxMode === 'fixed') {
				await page.mouse.move(points.inside.x, points.inside.y);
				assert.equal(await page.locator('.transform-hover-outline:visible').count(), 0, 'Empty box interior has no hover outline');
				assert.equal(await page.locator('.selection-overlay > .text-baselines > span').count(), 0);
			}
			await page.mouse.click(points.text.x, points.text.y);
			assert(await page.locator(`${chrome} .transform-bounding-box`).isVisible(), 'Selecting text shows its transform frame');
			assert.equal(await page.locator(`${chrome} .text-baselines > span`).count(), 1, 'Selecting text also shows its baseline');
			assert.equal(await page.locator('.transform-hover-outline:visible').count(), 0, 'Selection clears hover feedback');
		}
		const stable = await page.evaluate(async id => {
			const manager = editor.textGlitterManager;
			const layer = editor.layerManager.getLayerById(id);
			const results = [];
			for (const boxMode of ['point', 'autoHeight', 'fixed']) {
				for (const verticalAlign of ['top', 'middle', 'bottom']) {
					Object.assign(layer.textData, { text: 'aaa', boxMode, boxWidth: 200, boxHeight: 100, verticalAlign });
					layer.textData.textBackground.enabled = true;
					layer.textData.textBackground.mode = boxMode === 'point' ? 'text-bounds' : 'text-box';
					await manager.refreshLayer(layer, { saveHistory: false });
					const before = manager.getTextWorldBaselines(layer)[0].start;
					manager.beginTextEdit(layer, { focus: false });
					for (const text of ['aaay', 'aaa', 'aaaH', 'aaag', 'aaa']) {
						manager.applyTextEdit(layer, text);
						await editor.runPendingCommit('panelText');
						const after = manager.getTextWorldBaselines(layer)[0].start;
						// The layer is rotated/flipped: compare along the vertical local axis.
						const angle = layer.transform.rotation * Math.PI / 180;
						results.push(Math.abs(-(after.x - before.x) * Math.sin(angle) + (after.y - before.y) * Math.cos(angle)) < 0.01);
					}
					manager.endTextEdit();
				}
			}
			return results;
		}, id);
		assert(stable.every(Boolean), 'Typing and deleting ascenders/descenders keeps the visible baseline stable in every text mode');
		for (const boxMode of ['point', 'autoHeight', 'fixed']) {
			await page.evaluate(async ({ id, boxMode }) => {
				const manager = editor.textGlitterManager;
				const layer = editor.layerManager.getLayerById(id);
				manager.endTextEdit();
				const library = STYLE_PRESETS[LayerType.TEXT_GLITTER];
				library.apply(library.get('subtitle'), { layer, context: {
					getSlotDefaults: key => getSlotDefaults(layer.type, key), glitterAvailable: () => true
				} });
				Object.assign(layer.textData, { text: 'aaa', boxMode, boxWidth: 220, boxHeight: 40, fontSize: 32, verticalAlign: 'top', align: 'left' });
				Object.assign(layer.transform, { position: { x: 250, y: 250 }, rotation: 0, scale: { x: 100, y: 100 }, flipX: false });
				editor.layerManager.setActiveLayer(id);
				await manager.refreshLayer(layer, { saveHistory: false });
			}, { id, boxMode });
			let initial = null;
			for (const text of ['aaa', 'aaay', 'aaa', 'aaag', 'aaa']) {
				await page.locator('#textLayerInput').fill(text);
				await page.evaluate(() => editor.runPendingCommit('panelText'));
				await page.waitForTimeout(50);
				const clip = await page.evaluate(() => {
					const rect = editor.previewCanvas.getBoundingClientRect();
					return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
				});
				const screenshot = await page.screenshot({ clip });
				const top = await page.evaluate(async base64 => {
					const image = new Image();
					image.src = `data:image/png;base64,${base64}`;
					await image.decode();
					const canvas = document.createElement('canvas');
					canvas.width = image.width; canvas.height = image.height;
					const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
					const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
					for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
						const i = (y * canvas.width + x) * 4;
						if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] < 80) return y;
					}
					return null;
				}, screenshot.toString('base64'));
				assert.notEqual(top, null, 'Subtitle yellow letters are visible');
				if (initial === null) initial = top;
				assert.equal(top, initial, `${boxMode}: actual Subtitle pixels stay at the same height while typing/deleting descenders`);
			}
			await page.evaluate(() => editor.textGlitterManager.endTextEdit());
		}
		assert.deepEqual(errors, []);
		process.stdout.write('Text chrome verification passed (caption baseline stability, overset, repeated resizing, baselines, mode conversion and undo)\n');
	} finally {
		await browser.close();
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
