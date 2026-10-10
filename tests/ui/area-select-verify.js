'use strict';

// The Select Area tool in the real app: drawing rectangle, ellipse and lasso
// areas, add / subtract / invert, Fill and Erase on a fill layer's mask, the
// brush clipped to the area, undo, a moved fill layer, canvas resize, and that
// the export matches what was filled.

const { chromium } = require('playwright');
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) { if (!condition) throw new Error(message); }

// Coverage of the active fill layer's mask over document rectangles, as the
// share of pixels with glitter.
async function coverage(page, rects) {
	return page.evaluate((rects) => {
		const editor = window.editor;
		const layer = editor.layers.find((entry) => entry.type === LayerType.GLITTER_FILL);
		if (!layer) return rects.map(() => 0);
		const width = editor.originalCanvas.width;
		const paint = editor.paintMaskStore.getPaintMask(layer.id);
		const add = paint.add.getContext('2d', { willReadFrequently: true });
		const sub = paint.sub.getContext('2d', { willReadFrequently: true });
		return rects.map(([x, y, w, h]) => {
			const a = add.getImageData(x, y, w, h).data;
			const s = sub.getImageData(x, y, w, h).data;
			let on = 0;
			for (let index = 3; index < a.length; index += 4) if (a[index] >= 128 && s[index] < 128) on++;
			return on / (w * h);
		});
		void width;
	}, rects);
}

async function drag(page, from, to, { modifiers = [], steps = 6 } = {}) {
	const point = (p) => page.evaluate(([x, y]) => {
		const screen = window.editor.viewport.canvasToScreen ? window.editor.viewport.canvasToScreen(x, y) : null;
		if (screen) return [screen.x, screen.y];
		const rect = window.editor.previewWrapper.getBoundingClientRect();
		const zoom = window.editor.viewport.currentZoom;
		return [rect.left + x * zoom, rect.top + y * zoom];
	}, p);
	const start = await point(from);
	const end = await point(to);
	for (const key of modifiers) await page.keyboard.down(key);
	await page.mouse.move(start[0], start[1]);
	await page.mouse.down();
	for (let step = 1; step <= steps; step++) {
		await page.mouse.move(start[0] + (end[0] - start[0]) * step / steps, start[1] + (end[1] - start[1]) * step / steps);
	}
	await page.mouse.up();
	for (const key of modifiers) await page.keyboard.up(key);
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	await context.addInitScript(() => { localStorage.clear(); localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'); });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor?.settingsStore);
	await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach((modal) => modal.classList.remove('visible')));
	await page.evaluate(() => window.editor.loadBlankImage(200, 160, '#336699'));
	await page.waitForFunction(() => window.editor.originalImage != null);
	await page.waitForTimeout(300);

	// The tool, its key and its bar.
	await page.keyboard.press('m');
	const tool = await page.evaluate(() => ({
		tool: window.editor.currentTool,
		button: document.getElementById('areaTool')?.classList.contains('active'),
		bar: document.getElementById('areaSelectControls').classList.contains('visible'),
		fillDisabled: document.getElementById('contextAreaFill').disabled,
		shape: document.querySelector('#contextAreaShape .active')?.dataset.value
	}));
	assert(tool.tool === 'area' && tool.button && tool.bar && tool.fillDisabled && tool.shape === 'rect', `Tool state: ${JSON.stringify(tool)}`);
	console.log('PASS M selects the tool and shows its bar');

	// A rectangle, then Fill.
	await drag(page, [20, 20], [100, 80]);
	let state = await page.evaluate(() => ({ ops: window.editor.areaSelection.ops.length, session: window.editor.getActiveSession(), chrome: Boolean(document.querySelector('.area-chrome')), fillDisabled: document.getElementById('contextAreaFill').disabled }));
	assert(state.ops === 1 && state.session === 'area' && state.chrome && !state.fillDisabled, `After a drag: ${JSON.stringify(state)}`);
	await page.keyboard.press('Enter');
	let [inside, outside] = await coverage(page, [[22, 22, 76, 56], [110, 20, 60, 100]]);
	assert(inside === 1 && outside === 0, `Fill covered ${inside} inside and ${outside} outside`);
	const edge = await coverage(page, [[20, 20, 80, 60]]);
	assert(edge[0] === 1, `A rectangle fill missed pixels on its own edge (${edge[0]})`);
	console.log('PASS Rectangle fill covers exactly its pixels');

	// Undo and redo are paint steps; the area is untouched by them.
	await page.keyboard.press('Control+z');
	const afterUndo = await page.evaluate(() => ({ layers: window.editor.layers.filter((layer) => layer.type === LayerType.GLITTER_FILL).length, ops: window.editor.areaSelection.ops.length }));
	assert(afterUndo.ops === 1, 'Undo removed the area');
	await page.keyboard.press('Control+Shift+z');
	await page.waitForTimeout(300);
	[inside] = await coverage(page, [[22, 22, 76, 56]]);
	assert(inside === 1, 'Redo did not restore the fill');
	console.log('PASS Undo and redo step through the fill, not the area');

	// Subtract with Alt, erase with Delete.
	await drag(page, [20, 20], [60, 80], { modifiers: ['Alt'] });
	assert(await page.evaluate(() => window.editor.areaSelection.ops.map((entry) => entry.op).join()) === 'add,subtract', 'Alt-drag did not subtract');
	await page.keyboard.press('Delete');
	let [cut, kept] = await coverage(page, [[22, 22, 36, 56], [62, 22, 36, 56]]);
	assert(cut === 1 && kept === 0, `Erase removed the wrong part: cut ${cut}, kept ${kept}`);
	console.log('PASS Alt subtracts from the area; Delete erases inside it');

	// The brush only paints inside the area.
	await page.keyboard.press('Escape');
	assert(await page.evaluate(() => window.editor.areaSelection.isEmpty), 'Escape did not deselect');
	await page.evaluate(() => {
		const editor = window.editor;
		editor.areaSelect.setShape('ellipse');
		const layer = editor.layers.find((entry) => entry.type === LayerType.GLITTER_FILL);
		editor.layerManager.setActiveLayer(layer.id);
	});
	await drag(page, [110, 30], [190, 110]);
	await page.keyboard.press('b');
	const brush = await page.evaluate(() => ({ tool: window.editor.currentTool, deselect: !document.getElementById('maskBrushDeselect').hidden, chrome: Boolean(document.querySelector('.area-chrome')) }));
	assert(brush.tool === 'brush' && brush.deselect && brush.chrome, `Brush with an area: ${JSON.stringify(brush)}`);
	await page.evaluate(() => { window.editor.maskEditor.setMode('add'); window.editor.maskEditor.toolSettings.add.size = 40; window.editor.maskEditor._applySettingsToDOM?.('add'); });
	const before = await coverage(page, [[62, 22, 36, 56]]);
	await drag(page, [70, 70], [195, 70], { steps: 12 });
	const [center, beyondLeft, corner] = await coverage(page, [[140, 60, 20, 20], [70, 60, 30, 20], [112, 32, 6, 6]]);
	const after = await coverage(page, [[62, 22, 36, 56]]);
	assert(center === 1, `The brush did not paint inside the area (${center})`);
	assert(beyondLeft === 0 && corner === 0, `The brush painted outside the area: ${beyondLeft}, ${corner}`);
	assert(before[0] === after[0], 'A clipped stroke changed pixels outside the area');
	console.log('PASS The brush paints only inside the area');

	// Eraser is clipped too, and a clipped stroke is one undo step.
	await page.keyboard.press('Control+z');
	const [undone] = await coverage(page, [[140, 60, 20, 20]]);
	assert(undone === 0, 'Undo did not remove the clipped stroke');
	await page.keyboard.press('Control+Shift+z');
	await page.waitForTimeout(300);
	await page.keyboard.press('Escape');
	assert(await page.evaluate(() => window.editor.areaSelection.isEmpty && document.getElementById('maskBrushDeselect').hidden), 'Escape in the Brush did not deselect the area');
	console.log('PASS Clipped stroke undoes in one step; Escape deselects from the Brush');

	// Lasso and invert.
	await page.keyboard.press('m');
	await page.evaluate(() => window.editor.areaSelect.setShape('lasso'));
	const corners = [[10, 120], [60, 120], [60, 155], [10, 155], [10, 122]];
	const screen = await page.evaluate((points) => {
		const rect = window.editor.previewWrapper.getBoundingClientRect();
		const zoom = window.editor.viewport.currentZoom;
		return points.map(([x, y]) => [rect.left + x * zoom, rect.top + y * zoom]);
	}, corners);
	await page.mouse.move(screen[0][0], screen[0][1]);
	await page.mouse.down();
	for (let index = 1; index < screen.length; index++) await page.mouse.move(screen[index][0], screen[index][1], { steps: 8 });
	await page.mouse.up();
	const lasso = await page.evaluate(() => ({ points: window.editor.areaSelection.ops[0]?.points.length, inside: window.editor.areaSelection.contains({ x: 30, y: 140 }), outside: window.editor.areaSelection.contains({ x: 100, y: 140 }) }));
	assert(lasso.points > 8 && lasso.inside && !lasso.outside, `Lasso: ${JSON.stringify(lasso)}`);
	await page.evaluate(() => window.editor.areaSelect.invert());
	const inverted = await page.evaluate(() => ({ inside: window.editor.areaSelection.contains({ x: 30, y: 140 }), outside: window.editor.areaSelection.contains({ x: 100, y: 140 }) }));
	assert(!inverted.inside && inverted.outside, `Invert: ${JSON.stringify(inverted)}`);
	await page.evaluate(() => window.editor.areaSelect.invert());
	assert(await page.evaluate(() => window.editor.areaSelection.ops.length) === 1, 'Inverting twice did not return to the area');
	console.log('PASS Lasso and Invert');

	// The export shows glitter exactly where the lasso was filled.
	await page.keyboard.press('Enter');
	const exported = await page.evaluate(async () => {
		const editor = window.editor;
		const composed = await editor.sceneCompositor.composeFrameAt({
			visibleLayers: editor.layers.filter((layer) => layer.visible),
			glitterGifs: editor.glitterLibrary.getRenderContent(),
			canvasData: editor.getExportCanvasData(),
			exportSettings: editor.getSceneSnapshotSettings(),
			target: EXPORT_TARGETS['still:png'],
			callbacks: { onStatus: () => {}, onProgress: () => {}, isCancelled: () => false, createMask: (layer) => editor.maskCompositor.getMaskData(layer), renderSlotMasks: (layer) => getLayerManagerForType(editor, layer.type).renderSlotMasks(layer), ensureTextFont: (fontId) => FontLibrary.ensureLoaded(fontId) }
		});
		const base = [0x33, 0x66, 0x99];
		const differs = (x, y) => { const o = (y * composed.width + x) * 4; return base.some((value, channel) => Math.abs(composed.imageData.data[o + channel] - value) > 8); };
		return { inLasso: differs(30, 140), outside: differs(100, 140) };
	});
	assert(exported.inLasso && !exported.outside, `Export after a lasso fill: ${JSON.stringify(exported)}`);
	console.log('PASS Export shows the filled area');

	// The area follows a canvas resize, and is dropped by an undo across one.
	await page.evaluate(() => window.editor.resizeCanvas(240, 200, 20, 20));
	const moved = await page.evaluate(() => window.editor.areaSelection.contains({ x: 50, y: 160 }) && !window.editor.areaSelection.contains({ x: 15, y: 125 }));
	assert(moved, 'The area did not move with a canvas resize');
	await page.keyboard.press('Control+z');
	assert(await page.evaluate(() => window.editor.areaSelection.isEmpty && !document.querySelector('.area-chrome')), 'Undo across a canvas resize kept a stale area');
	console.log('PASS The area follows a canvas resize and clears on an undo across one');

	// A moved fill layer: the fill still lands where the area is drawn.
	await page.evaluate(() => {
		const editor = window.editor;
		const layer = editor.layers.find((entry) => entry.type === LayerType.GLITTER_FILL);
		editor.glitterManager.updateTransform(layer.id, { position: { x: layer.transform.position.x + 30, y: layer.transform.position.y + 10 } });
		editor.areaSelect.setShape('rect');
		editor.areaSelection.apply([{ x: 130, y: 100 }, { x: 170, y: 100 }, { x: 170, y: 140 }, { x: 130, y: 140 }], 'new');
		editor.areaSelect.fill();
	});
	const placed = await page.evaluate(() => {
		const editor = window.editor;
		const layer = editor.layers.find((entry) => entry.type === LayerType.GLITTER_FILL);
		const add = editor.paintMaskStore.getPaintMask(layer.id).add.getContext('2d', { willReadFrequently: true });
		const local = editor.glitterManager.getMaskLocalPoint(layer, { x: 150, y: 120 });
		const far = editor.glitterManager.getMaskLocalPoint(layer, { x: 185, y: 150 });
		const at = (point) => add.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data[3];
		return { inside: at(local), outside: at(far) };
	});
	assert(placed.inside > 0 && !placed.outside, `Fill on a moved layer: ${JSON.stringify(placed)}`);
	console.log('PASS Fill lands under the area on a moved fill layer');

	assert(errors.length === 0, `Page errors: ${errors.join(' | ')}`);
	await browser.close();
	console.log('\nSelect Area verification passed');
})().catch((error) => { console.error(`FAIL ${error.message}`); process.exit(1); });
