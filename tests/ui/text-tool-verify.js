'use strict';

const assert = require('assert');
const fs = require('fs');
const { chromium } = require('playwright');

async function boot(browser, mobile = false) {
	const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: mobile, isMobile: mobile });
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', route => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.GLITTER_TEST_CSS) }));
	await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/');
	await page.waitForFunction(() => window.editor?.textGlitterManager?.textProxy);
	await page.evaluate(() => { document.querySelectorAll('.modal-overlay.visible').forEach(node => node.classList.remove('visible')); editor.loadBlankImage(600, 400); });
	await page.waitForFunction(() => editor.originalImage);
	await page.evaluate(async () => { await FontLibrary.ensureLoaded(CONFIG.tools.text.defaultFontId); editor.mobileManager?.closeAllDrawers?.(); });
	return { page, errors };
}

async function main() {
	const browser = await chromium.launch();
	try {
		const { page, errors } = await boot(browser);
		await page.evaluate(() => createTextAt(editor, { position: { x: 80, y: 120 } }));
		await page.locator('#canvasTextInput').fill('First');
		await page.waitForTimeout(250);
		assert.equal(await page.locator('#textLayerInput').inputValue(), 'First');
		await page.keyboard.press('Control+b');
		assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().textData.fontWeight), 700);
		await page.keyboard.press('Escape');
		assert.equal(await page.evaluate(() => editor.textGlitterManager.editSession), null);
		await page.evaluate(() => editor.undo());
		assert.equal(await page.evaluate(() => editor.layers.filter(layer => layer.textData).length), 0, 'Creating and typing is one undo step');
		await page.evaluate(() => editor.redo());
		assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().textData.text), 'First');

		await page.evaluate(() => editor.textGlitterManager.beginTextEdit(editor.layerManager.getActiveLayer()));
		await page.locator('#canvasTextInput').fill('First word\nSecond line');
		await page.waitForTimeout(250);
		const caretPoints = await page.evaluate(() => {
			const manager = editor.textGlitterManager, layer = editor.layerManager.getActiveLayer(), entry = manager.getMeasurementEntry(layer);
			const rect = editor.previewContainer.getBoundingClientRect();
			return [1, 4, 7].map(index => {
				const caret = manager.getTextBoundaries(layer).find(item => item.index === index);
				const world = manager.getWorldPointFromLocal(layer.transform, { x: entry.layoutOffsetX + caret.x - entry.width / 2, y: entry.layoutOffsetY + caret.y - entry.ascent / 2 - entry.height / 2 });
				return { x: rect.left + editor.viewport.panX + world.x * editor.viewport.currentZoom, y: rect.top + editor.viewport.panY + world.y * editor.viewport.currentZoom };
			});
		});
		await page.mouse.dblclick(caretPoints[2].x, caretPoints[2].y);
		assert.equal(await page.evaluate(() => { const session = editor.textGlitterManager.editSession; return editor.layerManager.getActiveLayer().textData.text.slice(session.selectionStart, session.selectionEnd); }), 'word', 'Double-click selects a word');
		await page.mouse.move(caretPoints[0].x, caretPoints[0].y); await page.mouse.down(); await page.mouse.move(caretPoints[1].x, caretPoints[1].y, { steps: 5 }); await page.mouse.up();
		assert.deepEqual(await page.evaluate(() => { const session = editor.textGlitterManager.editSession; return [session.selectionStart, session.selectionEnd]; }), [1, 4], 'Dragging selects glyphs');
		await page.evaluate(() => editor.textGlitterManager.setTextSelection(2, 2));
		await page.keyboard.press('ArrowDown');
		assert(await page.evaluate(() => editor.textGlitterManager.editSession.selectionStart > 10), 'Down follows the next layout line');
		await page.keyboard.press('Shift+ArrowUp');
		assert(await page.evaluate(() => editor.textGlitterManager.editSession.selectionEnd > editor.textGlitterManager.editSession.selectionStart), 'Shift+Up extends the selection');
		await page.evaluate(() => {
			const proxy = editor.textGlitterManager.textProxy;
			proxy.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
			proxy.value = 'Composing'; proxy.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
		});
		assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().textData.text), 'First word\nSecond line');
		await page.evaluate(() => editor.textGlitterManager.textProxy.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
		assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().textData.text), 'Composing');
		await page.locator('#canvasTextInput').fill('First');

		await page.locator('#canvasTextInput').fill('');
		await page.keyboard.press('Escape');
		assert.equal(await page.evaluate(() => editor.layers.filter(layer => layer.textData).length), 0, 'Empty committed text is deleted');
		await page.evaluate(() => editor.undo());
		assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().textData.text), 'First');
		await page.evaluate(() => {
			const manager = editor.textGlitterManager, layer = editor.layerManager.getActiveLayer();
			manager.beginTextEdit(layer); manager.setTextSelection(1, 3); manager.insertTextSymbol('\u2605');
		});
		assert.equal(await page.locator('#canvasTextInput').inputValue(), 'F\u2605st');
		await page.keyboard.press('Escape');
		const geometry = await page.evaluate(async () => {
			const manager = editor.textGlitterManager;
			const layer = editor.layerManager.getActiveLayer();
			await manager.runLayoutRefreshWithAnchor(layer, () => Object.assign(layer.textData, { text: 'one two three four\nfive', boxMode: 'autoHeight', boxWidth: 180, align: 'justify', decoration: { underline: true, strikethrough: true } }), { saveHistory: true });
			const entry = manager.getMeasurementEntry(layer);
			const start = manager.getTextBoundaries(layer).find(boundary => boundary.index === 0);
			const world = manager.getWorldPointFromLocal(layer.transform, { x: entry.layoutOffsetX + start.x - entry.width / 2, y: entry.layoutOffsetY + start.y - entry.ascent / 2 - entry.height / 2 });
			const rect = editor.previewContainer.getBoundingClientRect();
			const screen = { x: rect.left + editor.viewport.panX + world.x * editor.viewport.currentZoom, y: rect.top + editor.viewport.panY + world.y * editor.viewport.currentZoom };
			return { height: entry.layoutHeight, overflow: entry.hasOverflow, lines: entry.layout.lines.length, decorations: entry.layout.decorations.length, hit: manager.hitTextBoundary(layer, screen.x, screen.y), wrapped: entry.layout.lines.filter(line => line.wrapped).length };
		});
		assert(geometry.lines > 1 && !geometry.overflow && geometry.decorations === geometry.lines * 2);
		assert.equal(geometry.hit, 0);
		assert(geometry.wrapped > 0);
		const split = await page.evaluate(async () => {
			const manager = editor.textGlitterManager, source = editor.layerManager.getActiveLayer();
			await manager.runLayoutRefreshWithAnchor(source, () => Object.assign(source.textData, { text: 'ABC', fontWeight: 400, boxMode: 'point', letterSpacing: 4, align: 'left', decoration: { underline: false, strikethrough: false }, fill: { ...source.textData.fill, mode: 'solid', color: '#000000' } }), { saveHistory: true });
			const compose = async () => {
				const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400; const ctx = canvas.getContext('2d');
				for (const layer of editor.layers.filter(layer => layer.textData)) {
					const compositeCanvas = document.createElement('canvas'), fillCanvas = document.createElement('canvas');
					editor.sceneCompositor._renderSlotStackToCanvas(layer, ctx, 0, null, null, await manager.renderSlotMasks(layer), { compositeCanvas, compositeCtx: compositeCanvas.getContext('2d'), fillCanvas, buildStack: resolve => manager.getSlotStack(layer, resolve) });
				}
				return ctx.getImageData(0, 0, 600, 400).data;
			};
			const before = await compose();
			await manager.splitText('characters');
			const after = await compose();
			let outsideTolerance = 0;
			for (let y = 1; y < 399; y++) for (let x = 1; x < 599; x++) {
				const index = (y * 600 + x) * 4 + 3;
				if (before[index] === after[index]) continue;
				const other = before[index] ? after : before;
				let found = false;
				for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (other[((y + dy) * 600 + x + dx) * 4 + 3]) found = true;
				if (!found) outsideTolerance++;
			}
			const texts = editor.layers.filter(layer => layer.textData).map(layer => layer.textData.text);
			const selected = editor.layerManager.selectedLayerIds.size;
			await editor.undo(); const undone = editor.layers.filter(layer => layer.textData).map(layer => layer.textData.text);
			await editor.redo();
			return { texts, selected, undone, outsideTolerance };
		});
		assert.deepEqual(split.texts, ['C', 'B', 'A']); assert.equal(split.selected, 3); assert.deepEqual(split.undone, ['ABC']); assert.equal(split.outsideTolerance, 0, 'Split export moved ink more than one edge pixel');
		const refusal = await page.evaluate(async () => {
			const manager = editor.textGlitterManager;
			const layer = editor.layerManager.getActiveLayer();
			layer.textData.text = 'abcdefghijklmnopqrstuvwxyz';
			const count = editor.layers.length;
			await manager.splitText('characters');
			return { before: count, after: editor.layers.length };
		});
		assert.equal(refusal.before, refusal.after, 'Layer cap must refuse the whole split');
		await page.evaluate(() => {
			editor.layerManager.clearSelection();
			const clipboard = new DataTransfer(); clipboard.setData('text/plain', 'Plain text');
			document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
		});
		assert.equal(await page.locator('#canvasTextInput').inputValue(), 'Plain text');
		await page.keyboard.press('Escape');
		const color = await page.evaluate(async () => {
			const manager = editor.textGlitterManager;
			const layer = editor.layerManager.getActiveLayer();
			Object.assign(layer.textData, { text: 'A\uD83D\uDE00', boxMode: 'point', colorEmoji: true, decoration: { underline: false, strikethrough: false } });
			const entry = manager.getMeasurementEntry(layer);
			let colors = 0, leakingFill = 0;
			if (entry.emojiCanvas) {
				const rgba = entry.emojiCanvas.getContext('2d').getImageData(0, 0, entry.width, entry.height).data;
				const letters = entry.lettersCanvas.getContext('2d').getImageData(0, 0, entry.width, entry.height).data;
				for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) { if (rgba[i] !== rgba[i + 1] || rgba[i] !== rgba[i + 2]) colors++; if (letters[i + 3]) leakingFill++; }
			}
			layer.textData.colorEmoji = false;
			const off = manager.getMeasurementEntry(layer);
			return { colors, leakingFill, off: off.emojiCanvas === null, unified: off.lettersCanvas === off.canvas };
		});
		assert(color.colors > 0, 'System emoji must keep their own colors'); assert.equal(color.leakingFill, 0); assert(color.off && color.unified);
		const nested = await page.evaluate(async () => {
			const manager = editor.textGlitterManager;
			const layer = createTextAt(editor, { text: 'AB\nCD' }); manager.endTextEdit();
			layer.textData.textBackground.enabled = true; layer.textData.textBackground.mode = 'text-box';
			layer.textData.boxMode = 'fixed'; layer.textData.boxWidth = 200; layer.textData.boxHeight = 200;
			await manager.splitText('lines');
			const lines = editor.layers.filter(item => item.textData?.text === 'AB' || item.textData?.text === 'CD');
			const plates = lines.every(item => manager.getMeasurementEntry(item).textBackgroundGeometry?.shapes?.length > 0);
			editor.layerManager.setSelection([lines.find(item => item.textData.text === 'AB').id]);
			await manager.splitText('characters');
			return { plates, pieces: [...editor.layerManager.selectedLayerIds].map(id => editor.layerManager.getLayerById(id).textData.text) };
		});
		assert(nested.plates); assert.deepEqual(nested.pieces, ['A', 'B']);
		// A new text opens its Fill when typing ends; close it and let the view settle before measuring.
		await page.evaluate(() => { editor.pickers.closeActive(); editor.setTool(ToolType.TEXT); });
		await page.waitForTimeout(600);
		const drag = await page.evaluate(() => {
			const rect = editor.previewContainer.getBoundingClientRect();
			const point = { x: 430, y: 300 };
			return { x: rect.left + editor.viewport.panX + point.x * editor.viewport.currentZoom, y: rect.top + editor.viewport.panY + point.y * editor.viewport.currentZoom };
		});
		await page.mouse.move(drag.x, drag.y); await page.mouse.down(); await page.mouse.move(drag.x + 110, drag.y + 70, { steps: 8 }); await page.mouse.up();
		const box = await page.evaluate(() => {
			const layer = editor.layerManager.getActiveLayer(), manager = editor.textGlitterManager, entry = manager.getMeasurementEntry(layer);
			return { mode: layer.textData.boxMode, origin: manager.getWorldPointFromLocal(layer.transform, { x: entry.layoutOffsetX - entry.width / 2, y: entry.layoutOffsetY - entry.height / 2 }) };
		});
		assert.equal(box.mode, 'fixed'); assert(Math.abs(box.origin.x - 430) < 1 && Math.abs(box.origin.y - 300) < 1, 'Dragged box must keep the drawn top-left');
		await page.locator('#canvasTextInput').fill('Dragged');
		if (process.env.GLITTER_TEST_REVIEW) { await page.waitForTimeout(250); await page.screenshot({ path: `${process.env.GLITTER_TEST_REVIEW}/desktop-edit.png` }); }
		await page.keyboard.press('Escape');
		const selectedBody = page.locator('.transform-handles[data-layer-id="' + await page.evaluate(() => editor.layerManager.activeLayerId) + '"] .transform-bounding-box');
		await page.evaluate(() => editor.pickers.closeActive());
		await page.waitForTimeout(350);
		await selectedBody.dblclick({ position: { x: 25, y: 25 } });
		assert(await page.evaluate(() => Boolean(editor.textGlitterManager.editSession)), 'Double-click on selected chrome starts editing');
		await page.keyboard.press('Escape');

		const stacked = await page.evaluate(async () => {
			const manager = editor.textGlitterManager;
			const layer = editor.layerManager.getActiveLayer();
			manager.endTextEdit();
			await manager.runLayoutRefreshWithAnchor(layer, () => Object.assign(layer.textData, { text: 'Wi\uD83D\uDC69\u200D\uD83D\uDE80\nA\u0301B', orientation: 'stacked', boxMode: 'point', align: 'center', fontSize: 32, textCase: 'none', letterSpacing: 8, lineHeight: 1, warp: normalizeTextWarp(), decoration: { underline: true, strikethrough: false } }), { saveHistory: true });
			const entry = manager.getMeasurementEntry(layer);
			const glyphs = entry.layout.glyphs;
			const boundaries = manager.getTextBoundaries(layer);
			const centers = glyphs.slice(0, 3).map(glyph => glyph.x + glyph.advance / 2);
			const before = manager.getCacheKeyForLayer(layer);
			layer.textData.orientation = 'horizontal';
			const cacheChanged = before !== manager.getCacheKeyForLayer(layer);
			layer.textData.orientation = 'stacked';
			layer.textData.textBackground.enabled = true;
			const background = manager.getMeasurementEntry(layer).textBackgroundGeometry;
			layer.textData.warp = { type: 'rise', bend: 35 };
			const warped = manager.getMeasurementEntry(layer);
			const masks = await manager.renderSlotMasks(layer);
			layer.textData.warp = normalizeTextWarp();
			Object.assign(layer.textData, { boxMode: 'fixed', boxWidth: 30, boxHeight: 40 });
			const overflow = manager.getMeasurementEntry(layer).hasOverflow;
			manager.fitBoxToText(layer);
			const fits = !manager.getMeasurementEntry(layer).hasOverflow;
			Object.assign(layer.textData, { text: 'W\n\ni', boxMode: 'point' });
			const empty = manager.getMeasurementEntry(layer).layout.lines;
			Object.assign(layer.textData, { text: 'AB', boxMode: 'point', textBackground: buildDefaultTextBackground(), decoration: { underline: false, strikethrough: false }, fill: { ...getSlotDefaults(layer.type, 'fill'), mode: 'solid', color: '#000000' }, border: null, shadow: null });
			manager.beginTextEdit(layer, { focus: false }); manager.setTextSelection(0, 0);
			manager.moveTextCaretVertically(1, false);
			const down = manager.editSession.selectionStart;
			manager.setTextSelection(0, 1);
			manager.renderTextSelection();
			const selection = manager.layerElements.get(layer.id).querySelectorAll('.text-edit-selection').length;
			manager.endTextEdit();
			const original = manager.getMeasurementEntry(layer);
			const positions = original.layout.glyphs.map(glyph => manager.getWorldPointFromLocal(layer.transform, { x: glyph.x + original.layoutOffsetX - original.width / 2, y: glyph.baseline + original.layoutOffsetY - original.height / 2 }));
			await manager.splitText('characters');
			const pieces = [...editor.layerManager.selectedLayerIds].map(id => editor.layerManager.getLayerById(id));
			const splitStable = pieces.every((piece, index) => { const position = manager.getTextOriginWorldPosition(piece); return Math.hypot(position.x - positions[index].x, position.y - positions[index].y) < 1; });
			return { chars: glyphs.map(glyph => glyph.char), centers, rows: glyphs.map(glyph => glyph.baseline), ranges: glyphs.map(glyph => [glyph.sourceIndex, glyph.sourceEnd]), indices: boundaries.map(boundary => boundary.index), cacheChanged, background: Boolean(background?.shapes.length), warped: warped.warpedGlyphs.length, mask: masks.fill.width > 0, overflow, fits, emptyColumn: empty[2].columnX > empty[0].columnX + empty[0].columnWidth, selection, splitStable, down };
		});
		assert.deepEqual(stacked.chars, ['W', 'i', '\uD83D\uDC69\u200D\uD83D\uDE80', 'A\u0301', 'B']);
		assert(stacked.centers.every(center => Math.abs(center - stacked.centers[0]) < 0.01), 'Stacked graphemes center in their column');
		assert(stacked.rows[0] < stacked.rows[1] && stacked.rows[1] < stacked.rows[2] && stacked.rows[0] === stacked.rows[3], 'Newlines start a column at the top');
		assert.deepEqual(stacked.ranges, [[0, 1], [1, 2], [2, 7], [8, 10], [10, 11]]);
		assert(stacked.indices.includes(8) && stacked.cacheChanged && stacked.background && stacked.mask && stacked.warped === 5);
		assert(stacked.overflow && stacked.fits && stacked.emptyColumn && stacked.selection === 1 && stacked.splitStable && stacked.down === 1);
		await page.evaluate(() => editor.layerManager.setSelection([editor.layerManager.activeLayerId]));
		// Orientation is in Type's Advanced.
		await page.evaluate(() => setAdvancedDisclosureOpen(document.querySelector('[data-text-orientation]').closest('[data-advanced]'), true));
		await page.locator('[data-text-orientation="horizontal"]').click();
		await page.waitForFunction(() => editor.layerManager.getActiveLayer().textData.orientation === 'horizontal');
		await page.evaluate(() => editor.undo());
		assert.equal(await page.evaluate(() => editor.layerManager.getActiveLayer().textData.orientation), 'stacked', 'Orientation changes undo in one step');
		assert.deepEqual(errors, []);
		await page.close();
		const phone = await boot(browser, true);
		const touchStart = await phone.page.evaluate(() => {
			editor.setTool(ToolType.TEXT);
			const rect = editor.previewContainer.getBoundingClientRect();
			return { x: rect.left + editor.viewport.panX + 180 * editor.viewport.currentZoom, y: rect.top + editor.viewport.panY + 120 * editor.viewport.currentZoom };
		});
		const touch = await phone.page.context().newCDPSession(phone.page);
		const sendTouch = (type, point) => touch.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1, radiusX: 5, radiusY: 5 }] : [] });
		await sendTouch('touchStart', touchStart);
		for (let step = 1; step <= 10; step++) { await phone.page.waitForTimeout(16); await sendTouch('touchMove', { x: touchStart.x + step * 8, y: touchStart.y + step * 5 }); }
		await sendTouch('touchEnd');

		assert.equal(await phone.page.evaluate(() => editor.layerManager.getActiveLayer().textData.boxMode), 'fixed');
		assert.equal(await phone.page.evaluate(() => document.activeElement.id), 'canvasTextInput');
		await phone.page.locator('#canvasTextInput').fill('Phone');
		assert(await phone.page.evaluate(() => {
			const bar = document.getElementById('textEditControls').getBoundingClientRect();
			const nav = document.querySelector('.mobile-bottom-nav').getBoundingClientRect();
			return bar.bottom <= nav.top && Math.abs(bar.left + bar.width / 2 - window.innerWidth / 2) < 1;
		}), 'Phone text actions share the page center above the nav');
		assert(await phone.page.evaluate(() => {
			const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
			Object.defineProperty(window, 'visualViewport', { configurable: true, value: { offsetTop: 0, height: 500 } });
			try {
				editor.textGlitterManager.syncTextKeyboardViewport();
				return document.getElementById('textEditControls').getBoundingClientRect().bottom <= 500;
			} finally {
				Object.defineProperty(window, 'visualViewport', descriptor);
				editor.textGlitterManager.syncTextKeyboardViewport();
			}
		}), 'Phone text actions clear the onscreen keyboard');
		if (process.env.GLITTER_TEST_REVIEW) { await phone.page.waitForTimeout(250); await phone.page.screenshot({ path: `${process.env.GLITTER_TEST_REVIEW}/phone-edit.png` }); }
		await phone.page.keyboard.press('Escape');
		assert.deepEqual(phone.errors, []);
		await phone.page.close();
		console.log('Text tool verification passed (desktop/mobile sessions, history, layout, split export, cap, symbols and paste)');
	} finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
