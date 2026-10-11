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
	if (process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', route => route.fulfill({ path: process.env.GLITTER_TEST_CSS, contentType: 'text/css' }));
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

	// A drag inside the area moves it, and a click inside deselects.
	await page.keyboard.press('m');
	await page.evaluate(() => window.editor.areaSelect.setShape('rect'));
	const layerCount = await page.evaluate(() => window.editor.layers.length);
	const bounds = () => page.evaluate(() => { const box = window.editor.areaSelection.getBounds(); return box && [box.minX, box.minY, box.width, box.height].join(); });
	await drag(page, [20, 20], [60, 60]);
	await drag(page, [40, 40], [70, 50]);
	assert(await bounds() === '50,30,40,40' && await page.evaluate(() => window.editor.areaSelection.ops.length) === 1, `Drag inside the area: ${await bounds()}`);
	assert(await page.evaluate(() => window.editor.previewContainer.dataset.areaCursor) === 'move', 'No move cursor over the area');
	await drag(page, [60, 40], [120, 100], { modifiers: ['Shift', 'Alt'] });
	assert(await bounds() === '60,40,30,30', `Shift+Alt intersect: ${await bounds()}`);
	await drag(page, [70, 50], [70, 50]);
	assert(await page.evaluate(() => window.editor.areaSelection.isEmpty), 'A click inside the area did not deselect');
	console.log('PASS Drag inside moves the area; Shift+Alt intersects; a click deselects');

	// Space carries the shape being drawn, and the tool stays.
	const at = (x, y) => page.evaluate(([x, y]) => {
		const rect = window.editor.previewWrapper.getBoundingClientRect();
		const zoom = window.editor.viewport.currentZoom;
		return [rect.left + x * zoom, rect.top + y * zoom];
	}, [x, y]);
	const stops = [await at(20, 20), await at(60, 60), await at(80, 70)];
	await page.mouse.move(...stops[0]);
	await page.mouse.down();
	await page.mouse.move(...stops[1], { steps: 4 });
	await page.keyboard.down('Space');
	await page.mouse.move(...stops[2], { steps: 4 });
	await page.keyboard.up('Space');
	await page.mouse.up();
	assert(await bounds() === '40,30,40,40' && await page.evaluate(() => window.editor.currentTool) === 'area', `Space during a drag: ${await bounds()}`);
	console.log('PASS Space moves the shape being drawn');

	// Ctrl+A selects the canvas and Ctrl+D deselects, without touching layers.
	await page.keyboard.press('Control+a');
	assert(await bounds() === '0,0,200,160', `Ctrl+A: ${await bounds()}`);
	await page.keyboard.press('Control+d');
	assert(await page.evaluate(() => window.editor.areaSelection.isEmpty) && await page.evaluate(() => window.editor.layers.length) === layerCount, 'Ctrl+D did not deselect the area alone');
	console.log('PASS Ctrl+A selects the whole canvas; Ctrl+D deselects');

	// Lasso and invert.
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
	const lasso = await page.evaluate(() => ({ points: window.editor.areaSelection.ops[0]?.rings[0].length, inside: window.editor.areaSelection.contains({ x: 30, y: 140 }), outside: window.editor.areaSelection.contains({ x: 100, y: 140 }) }));
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
		editor.areaSelection.apply([[{ x: 130, y: 100 }, { x: 170, y: 100 }, { x: 170, y: 140 }, { x: 130, y: 140 }]], 'new');
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

	// Glitter Fill only picks and matches inside the area, and Crop fits it.
	const picked = await page.evaluate(() => {
		const editor = window.editor;
		const layer = editor.layerManager.addLayer(LayerType.GLITTER_FILL);
		editor.layerManager.setActiveLayer(layer.id);
		layer.settings.contiguous = false;
		editor.areaSelection.apply([[{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 60 }, { x: 10, y: 60 }]], 'new');
		editor.setTool(ToolType.GLITTER_FILL);
		editor.glitterFillSelector(120, 30, null);
		const ignored = layer.selections.length === 0;
		editor.glitterFillSelector(20, 20, null);
		const mask = buildColorSelectionMask(editor, layer);
		const width = editor.originalCanvas.width;
		const result = { ignored, inside: mask[30 * width + 30], outside: mask[30 * width + 120], deselect: !document.getElementById('contextFillDeselect').hidden };
		editor.setTool(ToolType.AREA);
		editor.areaSelect.crop();
		result.crop = { tool: editor.currentTool, source: editor.canvasBounds.source, width: editor.canvasBounds.rect.width, height: editor.canvasBounds.rect.height };
		editor.cancelCanvasBounds();
		return result;
	});
	assert(picked.ignored && picked.inside === 255 && picked.outside === 0 && picked.deselect, `Glitter Fill in an area: ${JSON.stringify(picked)}`);
	assert(picked.crop.tool === 'crop' && picked.crop.source === 'area' && picked.crop.width === 40 && picked.crop.height === 50, `Crop to the area: ${JSON.stringify(picked.crop)}`);
	console.log('PASS Glitter Fill stays inside the area; Crop fits it');

	// Area history shares chronological ordering with document edits.
	await page.evaluate(() => {
		const e = window.editor;
		e.setTool(ToolType.AREA); e.areaSelection.reset(); e.areaSelect.setShape('rect');
		e.historyManager.reset(e.historyManager.createStateSnapshot());
		e.areaSelection.apply(AREA_SHAPES.rect.build({ x: 20, y: 20 }, { x: 70, y: 70 }, {}));
		e.areaSelect.fill(); e.areaSelection.moveBy(10, 0);
	});
	await page.keyboard.press('Control+z');
	assert(await bounds() === '20,20,50,50', 'First undo did not reverse move');
	await page.keyboard.press('Control+z');
	assert(await bounds() === '20,20,50,50', 'Document undo changed area');
	await page.keyboard.press('Control+z');
	assert(await page.evaluate(() => window.editor.areaSelection.isEmpty), 'Third undo did not reverse drawing');
	for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(50); }
	assert(await bounds() === '30,20,50,50', 'Chronological redo failed');
	const beforeClear = await page.evaluate(() => JSON.stringify(window.editor.areaSelection.ops));
	await page.keyboard.press('Control+d'); await page.keyboard.press('Control+z');
	assert(await page.evaluate(() => JSON.stringify(window.editor.areaSelection.ops)) === beforeClear, 'Deselect undo did not restore exact ops');
	await page.keyboard.press('Control+d'); await page.keyboard.press('Control+Shift+d');
	assert(await page.evaluate(() => JSON.stringify(window.editor.areaSelection.ops)) === beforeClear, 'Reselect lost geometry');
	await page.evaluate(() => window.editor.setTool(ToolType.SELECT));
	await page.keyboard.press('Control+z');
	assert(await page.evaluate(() => window.editor.areaSelection.isEmpty), 'Area undo unavailable in another tool');
	await page.keyboard.press('Control+Shift+z');
	await page.evaluate(() => window.editor.setTool(ToolType.AREA));
	const nudgeSteps = await page.evaluate(() => window.editor.areaSelection.history.undoStack.length);
	for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
	assert(await page.evaluate(() => window.editor.areaSelection.history.undoStack.length) === nudgeSteps + 1, 'Held nudge not coalesced');
	await page.keyboard.press('Control+z');
	assert(await page.evaluate(() => JSON.stringify(window.editor.areaSelection.ops)) === beforeClear, 'Nudge undo failed');
	await page.evaluate(() => {
		const e = window.editor;
		e.areaSelection.moveBy(5, 0);
		e.resizeCanvas(220, 180, 10, 10);
		e.areaSelection.history.undo();
	});
	assert(await bounds() === '40,30,50,50', 'Area history did not transform with resize');
	console.log('PASS Area/document undo ordering, empty-area undo, Reselect, nudge coalescing and resized history');

	// Modify is a draft until committed, and empty results cannot apply.
	await page.evaluate(() => window.editor.areaSelect.beginModify('expand'));
	assert(await page.evaluate(() => document.getElementById('areaModifyControls').classList.contains('visible') && window.editor.notifications.mode.label === 'Modify Area'), 'Modify bar/pill missing');
	const modifyBefore = await page.evaluate(() => JSON.stringify(window.editor.areaSelection.ops));
	await page.locator('#contextAreaModifyAmount').fill('8');
	await page.locator('#contextAreaModifyAmount').dispatchEvent('input');
	await page.waitForTimeout(80);
	assert(await page.evaluate(() => JSON.stringify(window.editor.areaSelection.ops)) === modifyBefore, 'Preview committed area');
	assert(await page.evaluate(() => window.editor.areaSelect.chrome.draft.ops[0].rings.length > 0), 'Modify draft missing');
	await page.keyboard.press('Escape');
	assert(await page.evaluate(() => !window.editor.areaSelect.modify && JSON.stringify(window.editor.areaSelection.ops)) === modifyBefore, 'Modify cancel changed ops');
	await page.evaluate(() => window.editor.areaSelect.beginModify('expand'));
	await page.keyboard.press('Enter');
	assert(await page.evaluate(() => !window.editor.areaSelect.modify && window.editor.areaSelection.getBounds().width === 58), 'Modify apply failed');
	await page.keyboard.press('Control+z');
	assert(await page.evaluate(() => JSON.stringify(window.editor.areaSelection.ops)) === modifyBefore, 'Modify undo failed');
	await page.evaluate(() => { window.editor.areaSelect.beginModify('contract'); window.editor.areaSelect.setModifyAmount(100); window.editor.areaSelect.previewModify(); });
	assert(await page.evaluate(() => window.editor.areaSelect.modify.empty && document.getElementById('canvasActivityConfirm').disabled), 'Empty Modify allowed apply');
	await page.keyboard.press('Escape');
	console.log('PASS Modify preview, cancel, apply, undo and empty-result guard');

	// A deterministic base image: separated equal colors, near color and transparency.
	await page.evaluate(() => {
		const e = window.editor, canvas = createAppCanvas(200, 160, 'tests/area');
		const ctx = canvas.getContext('2d'); ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 0, 200, 160);
		ctx.fillStyle = '#ff0000'; ctx.fillRect(10, 10, 30, 30); ctx.fillRect(80, 10, 30, 30);
		ctx.fillStyle = '#ee0000'; ctx.fillRect(40, 10, 10, 30); ctx.clearRect(150, 10, 20, 20);
		e.originalCanvas = canvas; e.originalImageData = ctx.getImageData(0, 0, 200, 160);
		e.originalAlphaChannel = Uint8Array.from({ length: 32000 }, (_, i) => e.originalImageData.data[i * 4 + 3]);
		e.areaSelection.reset(); e.areaSelect.setShape('wand'); e.areaSelect.wand.tolerance = 0;
	});
	const click = async (x, y, modifiers = []) => {
		for (const key of modifiers) await page.keyboard.down(key);
		await page.mouse.click(...await at(x, y));
		for (const key of modifiers) await page.keyboard.up(key);
	};
	await click(20, 20);
	const areaCount = () => page.evaluate(() => window.editor.areaSelection.getCoverage().reduce((sum, pixel) => sum + Boolean(pixel), 0));
	assert(await areaCount() === 900, 'Contiguous wand did not select exact region');
	await click(25, 25); assert(await areaCount() === 0, 'Wand click inside selection did not deselect');
	await page.evaluate(() => window.editor.undo());
	assert(await areaCount() === 900, 'Wand deselect undo did not restore selection');
	await click(20, 20, ['Shift']); assert(await areaCount() === 900, 'Shift wand inside selection deselected');
	await click(20, 20, ['Shift', 'Alt']); assert(await areaCount() === 900, 'Intersect wand inside selection deselected');
	await click(20, 20, ['Alt']); assert(await areaCount() === 0, 'Alt wand did not subtract selected region');
	await page.evaluate(() => COMMANDS.areaWandTolerance.run(window.editor, 30));
	await click(20, 20); assert(await areaCount() === 1200, 'Tolerance did not include near color');
	await page.evaluate(() => { window.editor.areaSelection.clear(); COMMANDS.areaWandTolerance.run(window.editor, 0); COMMANDS.areaWandContiguous.run(window.editor, false); });
	await click(20, 20); assert(await areaCount() === 1800, 'Noncontiguous wand did not select both islands');
	await click(155, 15, ['Shift']); assert(await areaCount() === 2200, 'Shift wand did not add transparent region');
	await page.evaluate(() => window.editor.areaSelection.clear());
	await click(155, 15); assert(await areaCount() === 400, 'Transparent wand failed');
	await drag(page, [20, 20], [60, 60]); assert(await areaCount() === 400, 'Wand drag changed area');
	console.log('PASS Wand deselect/undo, modifiers, tolerance, contiguous matching, transparency and drag suppression');

	// Polygon keys belong to the drawing, including Enter with only two corners.
	await page.evaluate(() => window.editor.areaSelect.setShape('polygon'));
	const polygonBefore = await page.evaluate(() => JSON.stringify(window.editor.areaSelection.ops));
	await click(20, 20); await click(80, 20); await page.keyboard.press('Enter');
	assert(await page.evaluate(() => window.editor.areaSelect.polygon.points.length === 2), 'Two-corner Enter ended polygon');
	await page.keyboard.down('Space');
	await drag(page, [120, 100], [140, 110]);
	await page.keyboard.up('Space');
	assert(await page.evaluate(() => window.editor.currentTool === ToolType.AREA && window.editor.areaSelect.polygon.points.length === 2), 'Space pan lost polygon or placed a corner');
	await click(50, 80); await page.keyboard.press('Backspace');
	assert(await page.evaluate(() => window.editor.areaSelect.polygon.points.length === 2), 'Backspace did not remove corner');
	await page.keyboard.press('Escape');
	assert(await page.evaluate(() => JSON.stringify(window.editor.areaSelection.ops)) === polygonBefore, 'Polygon cancel changed area');
	await click(20, 20); await click(80, 20); await click(50, 80); await page.keyboard.press('Enter');
	assert(await page.evaluate(() => !window.editor.areaSelect.polygon && window.editor.areaSelection.ops[0].rings[0].length === 3 && window.editor.areaSelection.contains({ x: 50, y: 40 }) && !window.editor.areaSelection.contains({ x: 20, y: 70 })), 'Triangle incorrect');
	await click(20, 20); await click(80, 20);
	await page.mouse.dblclick(...await at(50, 80));
	assert(await page.evaluate(() => !window.editor.areaSelect.polygon), 'Double-click did not close polygon');
	console.log('PASS Polygon triangle, two-corner Enter, Backspace, Escape and double-click');

	// Read silhouettes through the compositor, including outline but no shadow.
	const silhouette = await page.evaluate(async () => {
		const e = window.editor;
		const outer = AREA_SHAPES.rect.build({ x: 30, y: 30 }, { x: 100, y: 100 }, {})[0];
		const hole = AREA_SHAPES.rect.build({ x: 50, y: 50 }, { x: 80, y: 80 }, {})[0].reverse();
		const layer = e.layerManager.addLayer(LayerType.PATH, { pathLayer: { subpaths: [{ closed: true, points: outer }, { closed: true, points: hole }], stroke: null } });
		layer.opacity = 20; layer.visible = false;
		e.setTool(ToolType.SELECT);
		await e.areaSelect.selectLayerPixels([layer]);
		const first = e.areaSelection.getCoverage().slice();
		const result = { hole: !e.areaSelection.contains({ x: 65, y: 65 }), body: e.areaSelection.contains({ x: 40, y: 40 }), tool: e.currentTool, unchanged: layer.opacity === 20 && !layer.visible };
		layer.opacity = 100; layer.visible = true;
		await e.areaSelect.selectLayerPixels([layer]);
		result.opacity = first.every((value, i) => value === e.areaSelection.getCoverage()[i]);
		layer.pathData.border = { ...getSlotDefaults(LayerType.PATH, 'border'), mode: 'solid', color: '#ffffff', width: 4 };
		layer.pathData.shadow = { ...getSlotDefaults(LayerType.PATH, 'shadow'), mode: 'solid', color: '#ffffff', offsetX: 40, offsetY: 0 };
		await e.areaSelect.selectLayerPixels([layer]);
		result.outline = e.areaSelection.contains({ x: 28, y: 40 });
		result.shadow = !e.areaSelection.contains({ x: 125, y: 40 });
		e.setTool(ToolType.BRUSH); await e.areaSelect.selectLayerPixels([layer]); result.brush = e.currentTool === ToolType.BRUSH;
		e.setTool(ToolType.AREA);
		return { ...result, layerId: layer.id };
	});
	assert(silhouette.hole && silhouette.body && silhouette.tool === 'area' && silhouette.unchanged && silhouette.opacity && silhouette.outline && silhouette.shadow && silhouette.brush, `Silhouette: ${JSON.stringify(silhouette)}`);
	await page.evaluate(() => window.editor.layerManager.renderLayersList());
	await page.locator(`[data-layer-id="${silhouette.layerId}"] .layer-swatch`).click({ modifiers: ['Control', 'Shift'] });
	await page.waitForFunction(() => window.editor.areaSelection.ops.at(-1).op === 'add');
	assert(await page.evaluate(() => window.editor.areaSelection.ops.length > 1), 'Ctrl+Shift thumbnail did not add');
	const activeId = await page.evaluate(() => window.editor.activeLayerId);
	await page.locator(`[data-layer-id="${silhouette.layerId}"] .layer-name`).click({ modifiers: ['Control'] });
	assert(await page.evaluate(() => window.editor.selectedLayerIds.size) === 0, 'Ctrl row click lost multiselect behavior');
	assert(activeId === silhouette.layerId, 'Thumbnail switched layer');
	console.log('PASS Hidden/low-opacity silhouettes, holes, outline/shadow split, tool routing and thumbnail modifiers');

	const pathAlpha = await page.evaluate(async () => {
		const e = window.editor;
		const area = e.areaSelection.getCoverage().slice();
		e.areaSelect.toPath(); const layer = e.layerManager.getActiveLayer();
		const frame = await e.sceneCompositor.composeFrameAt(e.getSceneSnapshotParams([layer]));
		let mismatches = 0;
		for (let i = 0; i < area.length; i++) if (Boolean(area[i]) !== (frame.imageData.data[i * 4 + 3] >= CONFIG.rendering.maskAlphaThreshold)) mismatches++;
		return { type: layer.type, rings: layer.pathData.subpaths.length, mismatches, selected: !e.areaSelection.isEmpty };
	});
	assert(pathAlpha.type === 'path' && pathAlpha.rings >= 2 && pathAlpha.mismatches < 200 && pathAlpha.selected, `Area to path: ${JSON.stringify(pathAlpha)}`);
	console.log('PASS Area to Path export keeps holes and selection');
	const rotatedSticker = await page.evaluate(async () => {
		const e = window.editor;
		const sticker = e.stickerManager.createLayer(e.stickerLibrary.content[0].id);
		e.layerManager.insertLayer(sticker); e.stickerManager.renderLayer(sticker);
		sticker.transform.rotation = 35; sticker.transform.position = { x: 100, y: 80 };
		const frame = await e.sceneCompositor.composeFrameAt(e.getSceneSnapshotParams([sticker], { timestamp: 0 }));
		await e.areaSelect.selectLayerPixels([sticker]);
		const coverage = e.areaSelection.getCoverage();
		return coverage.some(Boolean) && coverage.every((pixel, i) => Boolean(pixel) === (frame.imageData.data[i * 4 + 3] >= CONFIG.rendering.maskAlphaThreshold));
	});
	assert(rotatedSticker, 'Rotated sticker silhouette differed from exported alpha');
	const baseSilhouette = await page.evaluate(async () => {
		const e = window.editor, base = e.layers.find(layer => layer.type === LayerType.BASE_IMAGE);
		base.background.mode = 'image'; e.baseImageSource = { ...e.baseImageSource, hasBaseImage: true };
		await e.areaSelect.selectLayerPixels([base]);
		const transparent = !e.areaSelection.contains({ x: 155, y: 15 }) && e.areaSelection.contains({ x: 20, y: 20 });
		base.background.mode = 'solid'; await e.areaSelect.selectLayerPixels([base]);
		return transparent && e.areaSelection.getCoverage().every(Boolean);
	});
	assert(baseSilhouette, 'Base-image silhouette lost its own transparency');
	console.log('PASS Rotated sticker exported alpha and transparent base silhouette');

	const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	await mobile.addInitScript(() => { localStorage.clear(); localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'); });
	const phone = await mobile.newPage();
	if (process.env.GLITTER_TEST_CSS) await phone.route('**/css/style.css*', route => route.fulfill({ path: process.env.GLITTER_TEST_CSS, contentType: 'text/css' }));
	phone.on('pageerror', error => errors.push(error.message));
	await phone.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await phone.waitForFunction(() => window.editor?.settingsStore);
	await phone.evaluate(() => { window.editor.modalManager.closeAll({ force: true }); window.editor.loadBlankImage(200, 160, '#336699'); });
	await phone.waitForFunction(() => window.editor.originalImage != null);
	await phone.evaluate(() => { const e = window.editor; e.layerManager.setActiveLayer(e.layers[0].id); e.setTool(ToolType.AREA); e.areaSelect.setShape('wand'); });
	await phone.waitForTimeout(250);
	const tap = async (x, y) => {
		const point = await phone.evaluate(([x, y]) => {
			const e = window.editor, rect = e.previewWrapper.getBoundingClientRect();
			return [rect.left + x * e.viewport.currentZoom, rect.top + y * e.viewport.currentZoom];
		}, [x, y]);
		await phone.touchscreen.tap(...point);
	};
	await tap(20, 20);
	assert(await phone.evaluate(() => window.editor.areaSelection.getBounds()?.width === 200), 'Touch wand did not pick');
	await tap(25, 25);
	assert(await phone.evaluate(() => !window.editor.areaSelection.getBounds()), 'Touch wand inside selection did not deselect');
	await phone.evaluate(() => window.editor.undo());
	assert(await phone.evaluate(() => window.editor.areaSelection.getBounds()?.width === 200), 'Touch wand deselect undo failed');
	await phone.evaluate(() => window.editor.areaSelect.setShape('polygon'));
	await tap(20, 20); await tap(80, 20); await tap(50, 80); await tap(20, 20);
	assert(await phone.evaluate(() => !window.editor.areaSelect.polygon && window.editor.areaSelection.ops[0].rings[0].length === 3), 'Touch polygon did not close');
	await phone.locator('#contextAreaMenu').scrollIntoViewIfNeeded();
	await phone.locator('#contextAreaMenu').tap();
	const menuBounds = await phone.locator('.app-menu-panel.is-fixed-menu').boundingBox();
	assert(menuBounds.y >= 0 && menuBounds.y + menuBounds.height <= 844 && menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 390, `Phone menu outside viewport: ${JSON.stringify(menuBounds)}`);
	assert(await phone.locator('.app-menu-panel.is-fixed-menu').getByRole('button', { name: 'Select Layer Pixels', exact: true }).isEnabled(), 'Phone layer selection command unavailable');
	await phone.locator('.app-menu-panel.is-fixed-menu').getByRole('button', { name: 'Expand', exact: true }).tap();
	assert(await phone.evaluate(() => document.getElementById('areaModifyControls').classList.contains('visible')), 'Phone Modify bar missing');
	await phone.locator('#canvasActivityConfirm').tap();
	assert(await phone.evaluate(() => !window.editor.areaSelect.modify), 'Phone Modify confirm failed');
	await mobile.close();
	console.log('PASS Phone wand tap, polygon taps, viewport-contained Select menu and Modify pill');

	// Full-canvas previews measure the cost at both supported large sizes.
	const timings = await page.evaluate(() => {
		const e = window.editor, timings = [];
		for (const size of [1024, 4096]) {
			e.originalCanvas = createAppCanvas(size, size, 'tests/area-timing'); e.areaSelection.reset(); e.areaSelection.selectAll();
			const source = e.areaSelection.getDistanceField(FIELDS.areaModifyAmount.max + 2);
			for (const kind of ['expand', 'smooth']) {
				e.areaSelect.modify = { kind, amount: 4, source, baseOps: e.areaSelection.ops };
				const start = performance.now();
				e.areaSelect.previewModify();
				const ms = performance.now() - start;
				dbg(`[Area timing] ${kind} ${size}: ${ms.toFixed(1)}ms`); timings.push({ size, kind, ms });
				e.areaSelect.cancelModify();
			}
		}
		return timings;
	});
	console.log(`Modify timings: ${JSON.stringify(timings)}`);

	assert(errors.length === 0, `Page errors: ${errors.join(' | ')}`);
	await browser.close();
	console.log('\nSelect Area verification passed');
})().catch((error) => { console.error(`FAIL ${error.message}`); process.exit(1); });
