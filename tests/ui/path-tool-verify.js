'use strict';

// Path layers, the Line tool and the Pen. One geometry feeds everything, so
// the checks cross the seams: the layer contract (frame, picking, resize
// baking, history), the stroke mask (ornaments, dashes, trimming), the export
// against the frame the handles use, and the point editor with mouse, keys
// and touch.

const fs = require('fs');
const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const VIEWPORT = { width: 1280, height: 900 };

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function near(actual, expected, tolerance, label) {
	assert(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

async function openEditor(context) {
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	if (process.env.GLITTER_TEST_CSS) {
		await page.route('**/css/style.css*', (route) => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.GLITTER_TEST_CSS) }));
	}
	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor != null, null, { timeout: 15000 });
	await page.evaluate(async () => window.editor.loadBlankImage(320, 240, '#ffffff'));
	await page.waitForFunction(() => window.editor.originalImage != null);
	await page.evaluate(() => {
		document.querySelectorAll('.modal-overlay.visible').forEach((element) => {
			element.classList.remove('visible');
			element.style.display = 'none';
		});
	});
	// History is capped, so steps are counted as they are recorded: a save
	// that coalesces into the current state is not a new step.
	await page.evaluate(() => {
		const history = window.editor.historyManager;
		const saveState = history.saveState.bind(history);
		window.__steps = 0;
		history.saveState = (label, options = {}) => {
			const current = history.history[history.historyIndex];
			if (!(options.coalesceKey && current?.coalesceKey === options.coalesceKey)) window.__steps++;
			return saveState(label, options);
		};
	});
	await page.waitForTimeout(150);
	return { page, errors };
}

// Remove every layer but the base image and return to Select.
async function reset(page) {
	await page.evaluate(() => {
		const editor = window.editor;
		editor.pathEdit.end();
		editor.setTool(ToolType.SELECT);
		const ids = editor.layers.filter((layer) => layer.type !== LayerType.BASE_IMAGE).map((layer) => layer.id);
		if (ids.length) editor.layerManager.deleteLayers(ids);
		editor.updatePreview();
	});
	await page.waitForTimeout(60);
}

async function clientPoint(page, x, y) {
	return page.evaluate(([cx, cy]) => {
		const rect = window.editor.previewWrapper.getBoundingClientRect();
		const zoom = window.editor.viewport.currentZoom;
		return { x: rect.left + cx * zoom, y: rect.top + cy * zoom };
	}, [x, y]);
}

async function click(page, x, y, options = {}) {
	const point = await clientPoint(page, x, y);
	await page.mouse.move(point.x, point.y);
	await page.mouse.down();
	await page.mouse.up();
	// Past the double-click window unless the caller wants one.
	await page.waitForTimeout(options.fast ? 30 : 360);
}

async function drag(page, from, to, options = {}) {
	const a = await clientPoint(page, from.x, from.y);
	const b = await clientPoint(page, to.x, to.y);
	await page.mouse.move(a.x, a.y);
	if (options.modifier) await page.keyboard.down(options.modifier);
	await page.mouse.down();
	const steps = 6;
	for (let step = 1; step <= steps; step++) {
		await page.mouse.move(a.x + (b.x - a.x) * step / steps, a.y + (b.y - a.y) * step / steps);
		await page.waitForTimeout(20);
	}
	await page.mouse.up();
	if (options.modifier) await page.keyboard.up(options.modifier);
	await page.waitForTimeout(360);
}

// The active path's points in canvas px, plus session state.
async function pathState(page) {
	return page.evaluate(() => {
		const editor = window.editor;
		const layers = editor.layers.filter((layer) => layer.type === LayerType.PATH);
		const layer = editor.layerManager.getActiveLayer()?.type === LayerType.PATH ? editor.layerManager.getActiveLayer() : layers[layers.length - 1];
		const session = editor.pathEdit.session;
		return {
			count: layers.length,
			tool: editor.currentTool,
			session: session ? { mode: session.mode, selection: Array.from(session.selection), layerId: session.layerId } : null,
			activeSession: editor.getActiveSession(),
			subpaths: layer ? editor.pathLayerManager.readCanvasSubpaths(layer) : [],
			fillMode: layer?.pathData.fill.mode,
			hasStroke: Boolean(layer?.pathData.stroke),
			history: window.__steps
		};
	});
}

// Opaque-pixel facts about the composited export frame.
async function exportFrame(page) {
	return page.evaluate(async () => {
		const editor = window.editor;
		const layers = editor.layers.filter((layer) => layer.visible && layerHasVisibleContent(layer));
		const composed = await editor.sceneCompositor.composeFrameAt({
			visibleLayers: layers,
			glitterGifs: editor.glitterLibrary.content,
			canvasData: {
				width: editor.originalCanvas.width,
				height: editor.originalCanvas.height,
				originalData: new Uint8ClampedArray(editor.originalImageData.data),
				originalAlpha: editor.originalAlphaChannel,
				alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold,
				hasBaseImage: false
			},
			exportSettings: { ...structuredClone(editor.exportSettings), watermarkEnabled: false, transparency: true, baseImage: false },
			target: EXPORT_TARGETS['still:png'],
			timestamp: 0,
			callbacks: {
				onStatus: () => {},
				onProgress: () => {},
				isCancelled: () => false,
				createMask: (layer) => editor.maskCompositor.getMaskData(layer),
				renderSlotMasks: (layer) => getLayerManagerForType(editor, layer.type).renderSlotMasks(layer),
				ensureTextFont: (fontId) => FontLibrary.ensureLoaded(fontId)
			}
		});
		const { width, height } = composed;
		window.__frame = { width, height, data: composed.imageData.data };
		let minX = width, minY = height, maxX = -1, maxY = -1;
		const data = composed.imageData.data;
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			if (data[(y * width + x) * 4 + 3] < 128) continue;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
		return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
	});
}

async function pixel(page, x, y) {
	return page.evaluate(([px, py]) => {
		const frame = window.__frame;
		const i = (py * frame.width + px) * 4;
		return [frame.data[i], frame.data[i + 1], frame.data[i + 2], frame.data[i + 3]];
	}, [x, y]);
}

async function addPath(page, options) {
	return page.evaluate((pathLayer) => {
		const editor = window.editor;
		const layer = editor.layerManager.addLayer(LayerType.PATH, { pathLayer });
		editor.setTool(ToolType.SELECT);
		editor.updatePreview();
		return layer.id;
	}, options);
}

const RED = { mode: 'solid', color: '#ff0000' };

// ===== THE LAYER =====

async function checkLayerContract(page) {
	await reset(page);
	const id = await addPath(page, {
		subpaths: [{ closed: false, points: [{ x: 40, y: 60 }, { x: 200, y: 60 }] }],
		stroke: { ...RED, widthPx: 8, cap: 'flat' }
	});
	const facts = await page.evaluate((layerId) => {
		const editor = window.editor;
		const layer = editor.layerManager.getLayerById(layerId);
		const manager = editor.pathLayerManager;
		const metrics = manager.layerTransforms.get(layerId).getFrameMetrics();
		return {
			position: layer.transform.position,
			local: layer.pathData.subpaths[0].points.map((point) => [point.x, point.y]),
			frame: { minX: metrics.minX, maxX: metrics.maxX, minY: metrics.minY, maxY: metrics.maxY },
			fillMode: layer.pathData.fill.mode,
			pointerEvents: manager.layerElements.get(layerId).style.pointerEvents,
			spans: Array.from(manager.layerElements.get(layerId).querySelectorAll('span[data-span-key]')).map((span) => span.dataset.spanKey),
			hitOn: manager.hitTest(layer, 100, 62, 0),
			hitOff: manager.hitTest(layer, 100, 70, 0)
		};
	}, id);
	// Points are stored around the origin the transform places.
	assert(facts.position.x === 120 && facts.position.y === 60, `line origin ${JSON.stringify(facts.position)}`);
	assert(JSON.stringify(facts.local) === '[[-80,0],[80,0]]', `line local points ${JSON.stringify(facts.local)}`);
	assert(facts.fillMode === 'none', 'an open path has no fill');
	assert(facts.spans.join() === 'stroke', `open path paints its stroke only, got ${facts.spans}`);
	assert(facts.pointerEvents === 'none', 'a path element takes no pointer events');
	// A horizontal line's frame has the stroke's height.
	near(facts.frame.minX, 40, 0.01, 'line frame left');
	near(facts.frame.maxX, 200, 0.01, 'line frame right');
	near(facts.frame.minY, 56, 0.01, 'line frame top');
	near(facts.frame.maxY, 64, 0.01, 'line frame bottom');
	assert(facts.hitOn && !facts.hitOff, 'a line is picked on its stroke, not its box');
	// Export paints exactly what the frame says.
	const bounds = await exportFrame(page);
	near(bounds.minX, 40, 0.01, 'export left');
	near(bounds.maxX, 200, 0.01, 'export right');
	near(bounds.minY, 56, 0.01, 'export top');
	near(bounds.maxY, 64, 0.01, 'export bottom');
	const color = await pixel(page, 100, 60);
	assert(color[0] === 255 && color[1] === 0 && color[3] === 255, `stroke color ${color}`);

	// A diagonal line: a click inside its box but off the line reaches what
	// is under it.
	await reset(page);
	const diagonal = await addPath(page, {
		subpaths: [{ closed: false, points: [{ x: 40, y: 40 }, { x: 200, y: 200 }] }],
		stroke: { ...RED, widthPx: 6 }
	});
	const picked = await page.evaluate(() => {
		const manager = window.editor.layerManager;
		return {
			on: manager.getTopVisibleLayerAtPoint(120, 120, { includeBase: false })?.id || null,
			off: manager.getTopVisibleLayerAtPoint(180, 60, { includeBase: false })?.id || null
		};
	});
	assert(picked.on === diagonal && picked.off === null, `diagonal picking ${JSON.stringify(picked)}`);
}

async function checkBodyMask(page) {
	// With fill None the body is the line alone: an outline wraps both sides.
	await reset(page);
	await addPath(page, {
		subpaths: [{ closed: false, points: [{ x: 40, y: 100 }, { x: 200, y: 100 }] }],
		stroke: { ...RED, widthPx: 8, cap: 'flat' }
	});
	await page.evaluate(() => {
		const editor = window.editor;
		const layer = editor.layerManager.getActiveLayer();
		const manager = editor.pathLayerManager;
		layer.pathData.border = { ...manager.getDefaultBorder(), mode: 'solid', color: '#0000ff', widthPx: 4 };
		manager.renderLayer(layer);
	});
	await exportFrame(page);
	const above = await pixel(page, 100, 94);
	const below = await pixel(page, 100, 105);
	const middle = await pixel(page, 100, 100);
	assert(above[2] === 255 && above[0] === 0 && above[3] === 255, `outline above the line ${above}`);
	assert(below[2] === 255 && below[0] === 0 && below[3] === 255, `outline below the line ${below}`);
	assert(middle[0] === 255 && middle[2] === 0, `the line keeps its own paint ${middle}`);
	const frame = await page.evaluate(() => {
		const editor = window.editor;
		const metrics = editor.pathLayerManager.layerTransforms.get(editor.layerManager.activeLayerId).getFrameMetrics();
		return { minY: metrics.minY, maxY: metrics.maxY };
	});
	// The frame is the body plus its outline.
	near(frame.minY, 92, 0.01, 'outlined frame top');
	near(frame.maxY, 108, 0.01, 'outlined frame bottom');

	// A closed path defaults to a fill and no stroke; adding a stroke unites
	// the two in the body.
	await reset(page);
	const closed = await addPath(page, {
		subpaths: [{ closed: true, points: [{ x: 60, y: 60 }, { x: 160, y: 60 }, { x: 160, y: 140 }, { x: 60, y: 140 }] }],
		fill: { mode: 'solid', color: '#00ff00' }
	});
	const defaults = await page.evaluate((layerId) => {
		const layer = window.editor.layerManager.getLayerById(layerId);
		return { fill: layer.pathData.fill.mode, stroke: layer.pathData.stroke };
	}, closed);
	assert(defaults.fill === 'solid' && defaults.stroke === null, `closed defaults ${JSON.stringify(defaults)}`);
	let bounds = await exportFrame(page);
	assert(bounds.minX === 60 && bounds.maxX === 160 && bounds.minY === 60 && bounds.maxY === 140, `closed fill bounds ${JSON.stringify(bounds)}`);
	await page.evaluate((layerId) => {
		const editor = window.editor;
		const layer = editor.layerManager.getLayerById(layerId);
		layer.pathData.stroke = { ...editor.pathLayerManager.getDefaultStroke(), mode: 'solid', color: '#ff0000', widthPx: 10, edgeStyle: 'miter' };
		editor.pathLayerManager.renderLayer(layer);
	}, closed);
	bounds = await exportFrame(page);
	assert(bounds.minX === 55 && bounds.maxX === 165 && bounds.minY === 55 && bounds.maxY === 145, `fill plus stroke bounds ${JSON.stringify(bounds)}`);
	const corner = await pixel(page, 56, 56);
	const inside = await pixel(page, 110, 100);
	assert(corner[0] === 255 && corner[1] === 0, `a Sharp join reaches its corner ${corner}`);
	assert(inside[1] === 255 && inside[0] === 0, `the fill shows inside the stroke ${inside}`);
}

async function checkStrokeGeometry(page) {
	await reset(page);
	const results = await page.evaluate(() => {
		const editor = window.editor;
		const manager = editor.pathLayerManager;
		const line = (length) => [{ closed: false, points: [{ x: -length / 2, y: 0, in: null, out: null, type: 'corner' }, { x: length / 2, y: 0, in: null, out: null, type: 'corner' }] }];
		const stroke = { ...manager.getDefaultStroke(), widthPx: 6, startShapeId: 'arrowHead', endShapeId: 'arrowHead', startSize: 4, endSize: 4 };
		const long = planStrokeSubpath(line(200)[0], stroke);
		const short = planStrokeSubpath(line(20)[0], stroke);
		const closed = planStrokeSubpath({ ...line(200)[0], closed: true, points: [...line(200)[0].points, { x: 0, y: 50, in: null, out: null, type: 'corner' }] }, stroke);
		return {
			longLength: PathGeometry.getLength(long.path),
			longOrnaments: long.ornaments.map((ornament) => [ornament.end, Math.round(ornament.x), Math.abs(Math.round(ornament.rotation * 180 / Math.PI))]),
			dashShift: long.dashShift,
			shortPath: short.path,
			shortOrnaments: short.ornaments.length,
			closedOrnaments: closed.ornaments.length,
			dotted: getStrokeLineDash({ ...stroke, dashStyle: 'dotted', gapPx: 10 }),
			dashed: getStrokeLineDash({ ...stroke, dashStyle: 'dashed', dashPx: 12, gapPx: 5 }),
			solid: getStrokeLineDash({ ...stroke, dashStyle: 'solid' }),
			ornamentIds: ShapeLibrary.ORNAMENT_SHAPES.map((shape) => shape.id)
		};
	});
	// Each arrowhead is 24 px long and trims 70% of that from the line.
	near(results.longLength, 200 - 2 * 24 * 0.7, 0.01, 'trimmed stroke length');
	near(results.dashShift, 24 * 0.7, 0.01, 'dash phase follows the start trim');
	assert(JSON.stringify(results.longOrnaments) === '[["start",-100,180],["end",100,0]]', `ornament placement ${JSON.stringify(results.longOrnaments)}`);
	// Shorter than its two trims: ornaments, no line.
	assert(results.shortPath === null && results.shortOrnaments === 2, 'a path too short for its ornaments keeps them and draws no line');
	assert(results.closedOrnaments === 0, 'a closed path has no ends');
	assert(JSON.stringify(results.dotted) === '[0,16]' && JSON.stringify(results.dashed) === '[12,5]' && results.solid === null, 'dash arrays');
	assert(results.ornamentIds.length >= 10 && results.ornamentIds[0] === 'arrowHead', `ornament shapes ${results.ornamentIds}`);

	// A dotted line has gaps in the export.
	await addPath(page, {
		subpaths: [{ closed: false, points: [{ x: 40, y: 120 }, { x: 280, y: 120 }] }],
		stroke: { ...RED, widthPx: 8, dashStyle: 'dotted', gapPx: 12 }
	});
	await exportFrame(page);
	let opaque = 0;
	let clear = 0;
	for (let x = 44; x < 276; x += 2) {
		const alpha = (await pixel(page, x, 120))[3];
		if (alpha === 255) opaque++;
		else if (alpha === 0) clear++;
	}
	assert(opaque > 20 && clear > 20, `dotted stroke alternates (${opaque} opaque, ${clear} clear)`);
}

async function checkTransformAndHistory(page) {
	await reset(page);
	const id = await addPath(page, {
		subpaths: [{ closed: false, points: [{ x: 60, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 140 }] }],
		stroke: { ...RED, widthPx: 6 }
	});
	// A resize is baked into the points.
	const baked = await page.evaluate((layerId) => {
		const editor = window.editor;
		const layer = editor.layerManager.getLayerById(layerId);
		PREFERENCES.set('scaleEffects', true);
		editor.pathLayerManager.updateTransform(layerId, { scale: { x: 200, y: 200 } });
		return {
			scale: layer.transform.scale,
			points: editor.pathLayerManager.readCanvasSubpaths(layer)[0].points.map((point) => [point.x, point.y]),
			width: layer.pathData.stroke.widthPx
		};
	}, id);
	assert(baked.scale.x === 100 && baked.scale.y === 100, 'a resize leaves the scale at 100%');
	assert(JSON.stringify(baked.points) === '[[10,50],[210,50],[210,170]]', `baked points ${JSON.stringify(baked.points)}`);
	near(baked.width, 12, 0.01, 'stroke width follows a resize with Scale Outlines & Effects on');

	// Stretching a line across its thin axis changes nothing.
	await reset(page);
	const line = await addPath(page, { subpaths: [{ closed: false, points: [{ x: 40, y: 60 }, { x: 200, y: 60 }] }], stroke: { ...RED, widthPx: 6 } });
	const thin = await page.evaluate((layerId) => {
		const editor = window.editor;
		const layer = editor.layerManager.getLayerById(layerId);
		editor.pathLayerManager.updateTransform(layerId, { scale: { x: 100, y: 300 } });
		return { width: layer.pathData.stroke.widthPx, points: editor.pathLayerManager.readCanvasSubpaths(layer)[0].points.map((point) => [point.x, point.y]) };
	}, line);
	assert(thin.width === 6 && JSON.stringify(thin.points) === '[[40,60],[200,60]]', `thin-axis resize ${JSON.stringify(thin)}`);

	// Rotation and flip stay in the transform; canvas-space geometry survives
	// a write through them.
	const roundTrip = await page.evaluate((layerId) => {
		const editor = window.editor;
		const manager = editor.pathLayerManager;
		const layer = editor.layerManager.getLayerById(layerId);
		manager.updateTransform(layerId, { rotation: 30, flipX: true });
		const before = manager.readCanvasSubpaths(layer);
		const moved = structuredClone(before);
		moved[0].points[1].x += 20;
		moved[0].points[1].y += 10;
		manager.writeCanvasSubpaths(layer, moved);
		const after = manager.readCanvasSubpaths(layer);
		return { before, after, rotation: layer.transform.rotation, flipX: layer.transform.flipX };
	}, line);
	assert(roundTrip.rotation === 30 && roundTrip.flipX === true, 'a point edit keeps rotation and flip');
	near(roundTrip.after[0].points[0].x, roundTrip.before[0].points[0].x, 0.02, 'untouched point x through rotation');
	near(roundTrip.after[0].points[0].y, roundTrip.before[0].points[0].y, 0.02, 'untouched point y through rotation');
	near(roundTrip.after[0].points[1].x, roundTrip.before[0].points[1].x + 20, 0.02, 'moved point x through rotation');
	near(roundTrip.after[0].points[1].y, roundTrip.before[0].points[1].y + 10, 0.02, 'moved point y through rotation');

	// Serialization is plain JSON.
	const serial = await page.evaluate(async (layerId) => {
		const editor = window.editor;
		const layer = editor.layerManager.getLayerById(layerId);
		const saved = editor.layerManager.serializeLayer(layer);
		const loaded = await editor.layerManager.deserializeLayer(JSON.parse(JSON.stringify(saved)));
		return { same: JSON.stringify(loaded.pathData) === JSON.stringify(layer.pathData), type: loaded.type };
	}, line);
	assert(serial.same && serial.type === 'path', 'a path round-trips through serialization');
}

// Convert Shape to Path: the same outline, in the shape's place.
async function checkConvertShape(page) {
	await reset(page);
	const before = await page.evaluate(async () => {
		const editor = window.editor;
		const shape = editor.layerManager.addLayer(LayerType.SHAPE, { shapeLayer: { shapeId: 'heart', width: 120, height: 100, position: { x: 150, y: 110 } } });
		shape.shapeData.fill = { ...shape.shapeData.fill, mode: 'solid', color: '#ff0000' };
		shape.shapeData.shadow = { ...editor.shapeGlitterManager.getDefaultShadow(), mode: 'solid', color: '#0000ff', offsetX: 12, offsetY: 8, blur: 0, spread: 0 };
		shape.transform.rotation = 20;
		const above = editor.layerManager.addLayer(LayerType.SHAPE, { shapeLayer: { shapeId: 'circle', width: 20, height: 20, position: { x: 20, y: 20 } } });
		editor.layerManager.setActiveLayer(shape.id);
		editor.updatePreview();
		return { shapeId: shape.id, aboveId: above.id, index: editor.layers.findIndex((layer) => layer.id === shape.id) };
	});
	await exportFrame(page);
	await page.evaluate(() => { window.__before = new Uint8ClampedArray(window.__frame.data); });
	const converted = await page.evaluate(() => {
		const editor = window.editor;
		COMMANDS.convertShapeToPath.run(editor);
		const layer = editor.layerManager.getActiveLayer();
		return {
			type: layer.type,
			index: editor.layers.findIndex((entry) => entry.id === layer.id),
			count: editor.layers.length,
			rotation: layer.transform.rotation,
			fill: layer.pathData.fill.color,
			shadow: layer.pathData.shadow?.offsetX,
			stroke: layer.pathData.stroke,
			closed: layer.pathData.subpaths.every((subpath) => subpath.closed)
		};
	});
	assert(converted.type === 'path' && converted.index === before.index && converted.count === 3, `the path takes the shape's place ${JSON.stringify(converted)}`);
	assert(converted.rotation === 20 && converted.fill === '#ff0000' && converted.shadow === 12 && converted.stroke === null && converted.closed, `transform and slots carry over ${JSON.stringify(converted)}`);
	await exportFrame(page);
	const difference = await page.evaluate(() => {
		const a = window.__before;
		const b = window.__frame.data;
		let different = 0;
		let opaque = 0;
		for (let i = 0; i < a.length; i += 4) {
			if (a[i + 3] > 127) opaque++;
			if (Math.abs(a[i] - b[i]) > 40 || Math.abs(a[i + 2] - b[i + 2]) > 40 || Math.abs(a[i + 3] - b[i + 3]) > 40) different++;
		}
		return { different, opaque };
	});
	// Rotated edges resample, so a thin rim of pixels may differ.
	assert(difference.different <= difference.opaque * 0.02, `converted artwork matches the shape (${difference.different} of ${difference.opaque} px differ)`);
	await page.keyboard.press('Control+z');
	await page.waitForTimeout(250);
	const restored = await page.evaluate((shapeId) => window.editor.layerManager.getLayerById(shapeId)?.type, before.shapeId);
	assert(restored === 'shape', 'undo brings the shape back');
}

// ===== LINE TOOL =====

async function checkLineTool(page) {
	await reset(page);
	await page.evaluate(() => window.editor.setTool(ToolType.LINE));
	await drag(page, { x: 50, y: 50 }, { x: 210, y: 130 });
	let state = await pathState(page);
	assert(state.count === 1 && state.tool === 'select', `line tool made a layer and returned to Select (${state.count}, ${state.tool})`);
	const points = state.subpaths[0].points;
	assert(points.length === 2 && points[0].x === 50 && points[0].y === 50 && points[1].x === 210 && points[1].y === 130, `line endpoints ${JSON.stringify(points)}`);
	assert(state.hasStroke && state.fillMode === 'none', 'a line has a stroke and no fill');

	// Shift holds the line to 45-degree steps.
	await page.evaluate(() => window.editor.setTool(ToolType.LINE));
	await drag(page, { x: 60, y: 180 }, { x: 220, y: 190 }, { modifier: 'Shift' });
	state = await pathState(page);
	const flat = state.subpaths[0].points;
	assert(state.count === 2 && flat[0].y === flat[1].y, `Shift line is horizontal ${JSON.stringify(flat)}`);
}

// ===== PEN =====

async function checkPenDrawing(page) {
	await reset(page);
	await page.evaluate(() => {
		window.editor.pathEdit.setNextPointType('corner');
		window.editor.setTool(ToolType.PEN);
	});
	const historyBefore = (await pathState(page)).history;
	await click(page, 60, 60);
	let state = await pathState(page);
	assert(state.count === 1 && state.session?.mode === 'draw' && state.activeSession === 'pathEdit', `first click starts a path ${JSON.stringify(state.session)}`);
	assert(state.history === historyBefore + 1, 'the first point is one history step');
	await click(page, 160, 60);
	await click(page, 160, 140);
	state = await pathState(page);
	assert(state.subpaths[0].points.length === 3, `three clicks, three points (${state.subpaths[0].points.length})`);
	assert(state.history === historyBefore + 3, 'each point is one history step');
	assert(state.subpaths[0].points.every((point) => point.in === null && point.out === null), 'clicks place corners');

	// Undo removes the last point and drawing continues.
	await page.keyboard.press('Control+z');
	await page.waitForTimeout(250);
	state = await pathState(page);
	assert(state.subpaths[0].points.length === 2 && state.session?.mode === 'draw', `undo mid-drawing ${JSON.stringify(state.session)}`);
	await click(page, 200, 160);
	state = await pathState(page);
	assert(state.subpaths[0].points.length === 3 && state.subpaths[0].points[2].x === 200, 'drawing continues after undo');

	// Backspace removes the last point; the layer stays.
	await page.keyboard.press('Backspace');
	await page.waitForTimeout(120);
	state = await pathState(page);
	assert(state.count === 1 && state.subpaths[0].points.length === 2 && state.session?.mode === 'draw', 'Backspace removes the last point, not the layer');

	// A click-drag places a smooth point and pulls its handles.
	await drag(page, { x: 220, y: 100 }, { x: 250, y: 100 });
	state = await pathState(page);
	const smooth = state.subpaths[0].points[2];
	assert(smooth.type === 'smooth' && smooth.out && smooth.in, `drag places a smooth point ${JSON.stringify(smooth)}`);
	near(smooth.out.x, 30, 0.6, 'leading handle follows the pointer');
	near(smooth.in.x, -30, 0.6, 'trailing handle mirrors it');

	// The temporary Hand does not end the path.
	await page.keyboard.down('Space');
	await page.waitForTimeout(60);
	const handState = await pathState(page);
	await page.keyboard.up('Space');
	await page.waitForTimeout(60);
	state = await pathState(page);
	assert(handState.tool === 'hand' && state.tool === 'pen' && state.session?.mode === 'draw', 'Space pans without ending the path');

	// Enter finishes the path (open), then leaves the session.
	await page.keyboard.press('Enter');
	await page.waitForTimeout(80);
	state = await pathState(page);
	assert(state.session?.mode === 'edit' && state.tool === 'pen', 'Enter finishes drawing');
	await page.keyboard.press('Enter');
	await page.waitForTimeout(80);
	state = await pathState(page);
	assert(state.session === null && state.tool === 'select' && state.count === 1, 'Enter again leaves the session for Select');
	assert(state.hasStroke && state.fillMode === 'none', 'an open drawn path keeps a stroke and no fill');

	// Clicking the first point closes the path: a fill and no stroke.
	await reset(page);
	await page.evaluate(() => window.editor.setTool(ToolType.PEN));
	await click(page, 80, 60);
	await click(page, 200, 60);
	await click(page, 140, 160);
	await click(page, 81, 61);
	state = await pathState(page);
	assert(state.subpaths[0].closed && state.subpaths[0].points.length === 3, `closing keeps three points ${JSON.stringify(state.subpaths[0].points.length)}`);
	assert(state.fillMode !== 'none' && !state.hasStroke, 'a path closed by the Pen takes a fill and no stroke');
	assert(state.session?.mode === 'edit', 'closing ends drawing');

	// A path left with one point is removed.
	await reset(page);
	await page.evaluate(() => window.editor.setTool(ToolType.PEN));
	await click(page, 100, 100);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(120);
	state = await pathState(page);
	assert(state.count === 0 && state.session === null, 'a one-point path is removed when drawing ends');

	// Curve points: handles follow the neighbours.
	await page.evaluate(() => {
		window.editor.pathEdit.setNextPointType('curve');
		window.editor.setTool(ToolType.PEN);
	});
	await click(page, 60, 120);
	await click(page, 140, 60);
	await click(page, 220, 120);
	state = await pathState(page);
	const middle = state.subpaths[0].points[1];
	assert(middle.type === 'auto' && middle.in && middle.out, `curve clicks place flowing points ${JSON.stringify(middle)}`);
	near(middle.out.y, 0, 0.05, 'a curve point runs along the line between its neighbours');
	assert(state.subpaths[0].points[0].out === null, 'an open path end gets no derived handle');
	await page.evaluate(() => window.editor.pathEdit.setNextPointType('corner'));
}

async function checkPenEditing(page) {
	await reset(page);
	const id = await addPath(page, {
		subpaths: [{ closed: false, points: [{ x: 60, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 180 }] }],
		stroke: { ...RED, widthPx: 4 }
	});
	// Enter opens the selected path with Select.
	await page.keyboard.press('Enter');
	await page.waitForTimeout(100);
	let state = await pathState(page);
	assert(state.session?.mode === 'edit' && state.tool === 'pen' && state.session.layerId === id, 'Enter opens the point editor');
	const chrome = await page.evaluate(() => ({
		anchors: document.querySelectorAll('.path-chrome .path-chrome-anchor').length,
		toolbar: document.getElementById('pathEditControls')?.classList.contains('visible')
	}));
	assert(chrome.anchors === 3 && chrome.toolbar, `chrome shows three anchors and the context bar ${JSON.stringify(chrome)}`);

	// Drag the middle point.
	const historyBefore = state.history;
	await drag(page, { x: 160, y: 80 }, { x: 190, y: 60 });
	state = await pathState(page);
	assert(state.subpaths[0].points[1].x === 190 && state.subpaths[0].points[1].y === 60, `moved point ${JSON.stringify(state.subpaths[0].points[1])}`);
	assert(state.subpaths[0].points[0].x === 60 && state.subpaths[0].points[2].y === 180, 'other points stay put');
	assert(state.history === historyBefore + 1, 'a point drag is one history step');
	assert(state.session.selection.join() === '0:1', 'the dragged point is selected');

	// The Point card shows it.
	const card = await page.evaluate(() => ({
		hidden: document.getElementById('pathPointSection').hidden,
		x: document.getElementById('pathPointX').value,
		y: document.getElementById('pathPointY').value
	}));
	assert(!card.hidden && card.x === '190' && card.y === '60', `point card ${JSON.stringify(card)}`);

	// Arrow keys nudge it; a burst is one history step.
	const beforeNudge = state.history;
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+ArrowDown');
	await page.waitForTimeout(80);
	state = await pathState(page);
	assert(state.subpaths[0].points[1].x === 192 && state.subpaths[0].points[1].y === 70, `nudged point ${JSON.stringify(state.subpaths[0].points[1])}`);
	assert(state.history === beforeNudge + 1, `nudges coalesce (${state.history - beforeNudge} steps)`);

	// Click a segment: a point is added on it, the outline unchanged.
	await click(page, 110, 75);
	state = await pathState(page);
	assert(state.subpaths[0].points.length === 4, `segment click adds a point (${state.subpaths[0].points.length})`);
	const added = state.subpaths[0].points[1];
	assert(added.in === null && added.out === null, 'a point added on a straight segment has no handles');
	assert(state.session.selection.join() === '0:1', 'the new point is selected');

	// Delete removes the selected point and never the layer.
	await page.keyboard.press('Delete');
	await page.waitForTimeout(100);
	state = await pathState(page);
	assert(state.count === 1 && state.subpaths[0].points.length === 3 && state.session, 'Delete removes the point, the layer stays');

	// Double-click a corner: it becomes smooth. Its handle then drags.
	await click(page, 192, 70, { fast: true });
	await click(page, 192, 70);
	state = await pathState(page);
	const smoothed = state.subpaths[0].points[1];
	assert(smoothed.type === 'smooth' && smoothed.in && smoothed.out, `double-click smooths a corner ${JSON.stringify(smoothed)}`);
	const tip = { x: smoothed.x + smoothed.out.x, y: smoothed.y + smoothed.out.y };
	const inLength = Math.hypot(smoothed.in.x, smoothed.in.y);
	await drag(page, tip, { x: tip.x + 30, y: tip.y });
	state = await pathState(page);
	let edited = state.subpaths[0].points[1];
	near(edited.out.x, smoothed.out.x + 30, 1, 'handle follows the drag');
	near(edited.in.x * edited.out.y - edited.in.y * edited.out.x, 0, 1, 'a smooth point keeps its handles in line');
	near(Math.hypot(edited.in.x, edited.in.y), inLength, 0.5, 'and the other handle keeps its length');
	// Alt breaks the pair.
	const tip2 = { x: edited.x + edited.out.x, y: edited.y + edited.out.y };
	const inBefore = { ...edited.in };
	await drag(page, tip2, { x: tip2.x, y: tip2.y + 30 }, { modifier: 'Alt' });
	state = await pathState(page);
	edited = state.subpaths[0].points[1];
	assert(edited.type === 'corner', 'Alt-dragging a handle makes a corner');
	near(edited.in.x, inBefore.x, 0.05, 'the other handle stays where it was');

	// Drag a straight segment: it bends and gains handles.
	await page.keyboard.press('Escape');
	await page.waitForTimeout(60);
	const before = (await pathState(page)).subpaths[0];
	assert(before.points[2].in === null, 'the last segment has a straight end before the bend');
	// Bend the middle of the first segment.
	const onCurve = await page.evaluate(([s]) => {
		const subpath = window.editor.pathLayerManager.readCanvasSubpaths(window.editor.layerManager.getActiveLayer())[0];
		return PathGeometry.evaluate(PathGeometry.getSegment(subpath, s), 0.5);
	}, [0]);
	await drag(page, onCurve, { x: onCurve.x, y: onCurve.y - 30 });
	state = await pathState(page);
	assert(state.subpaths[0].points[0].out, `dragging a segment gives it handles ${JSON.stringify(state.subpaths[0].points[0])}`);
	const nearest = await page.evaluate(([x, y]) => {
		const subpath = window.editor.pathLayerManager.readCanvasSubpaths(window.editor.layerManager.getActiveLayer())[0];
		return PathGeometry.nearestPoint([subpath], { x, y }).distance;
	}, [onCurve.x, onCurve.y - 30]);
	near(nearest, 0, 1.5, 'the curve passes under the pointer');

	// A marquee selects points; Escape clears the selection, then leaves.
	await drag(page, { x: 20, y: 20 }, { x: 300, y: 230 });
	state = await pathState(page);
	assert(state.session.selection.length === 3, `marquee selects every point (${state.session.selection.length})`);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(60);
	state = await pathState(page);
	assert(state.session && state.session.selection.length === 0, 'Escape clears the point selection first');
	await page.keyboard.press('Escape');
	await page.waitForTimeout(80);
	state = await pathState(page);
	assert(state.session === null && state.tool === 'select', 'Escape then leaves the session');

	// Double-click with Select opens the editor; an endpoint click continues
	// the path.
	const end = state.subpaths[0].points[2];
	const client = await clientPoint(page, end.x, end.y);
	await page.mouse.dblclick(client.x, client.y);
	await page.waitForTimeout(400);
	state = await pathState(page);
	assert(state.session?.mode === 'edit' && state.tool === 'pen', 'double-click opens the point editor');
	await click(page, end.x, end.y);
	state = await pathState(page);
	assert(state.session?.mode === 'draw', 'clicking an endpoint continues the path');
	await click(page, 60, 200);
	state = await pathState(page);
	assert(state.subpaths[0].points.length === 4 && state.subpaths[0].points[3].x === 60, 'the continued path gains a point at its end');

	// Undo while editing restores the geometry and keeps the session valid.
	await page.keyboard.press('Control+z');
	await page.waitForTimeout(250);
	state = await pathState(page);
	assert(state.subpaths[0].points.length === 3 && state.session, 'undo restores the path under an open session');
	await page.evaluate(() => window.editor.pathEdit.end({ keepTool: false }));
}

async function checkLiveDragCost(page) {
	// How long one live redraw of a large, fully dressed path takes: the
	// session falls back to chrome-only dragging past the raster budget.
	await reset(page);
	await page.evaluate(async () => window.editor.loadBlankImage(1000, 800, '#ffffff'));
	await page.waitForFunction(() => window.editor.originalCanvas.width === 1000);
	await page.waitForTimeout(200);
	const cost = await page.evaluate(() => {
		const editor = window.editor;
		const manager = editor.pathLayerManager;
		const points = [];
		for (let index = 0; index < 40; index++) {
			const angle = index / 40 * Math.PI * 2;
			const radius = 300 + (index % 2) * 60;
			points.push({ x: Math.round(500 + Math.cos(angle) * radius), y: Math.round(400 + Math.sin(angle) * radius), type: 'auto' });
		}
		const layer = editor.layerManager.addLayer(LayerType.PATH, { pathLayer: { subpaths: [{ closed: true, points }] } });
		layer.pathData.stroke = manager.getDefaultStroke();
		layer.pathData.border = manager.getDefaultBorder();
		layer.pathData.shadow = manager.getDefaultShadow();
		const host = manager.createEditHost(layer.id);
		const times = [];
		for (let step = 0; step < 5; step++) {
			const subpaths = host.read();
			subpaths[0].points[0].x += 3;
			const started = performance.now();
			host.write(subpaths, { render: true });
			times.push(performance.now() - started);
		}
		times.sort((a, b) => a - b);
		return { median: times[2], budget: CONFIG.ui.live.rasterBudgetMs };
	});
	console.log(`  live redraw of a 720 px path with fill, stroke, outline and shadow: ${cost.median.toFixed(1)} ms (budget ${cost.budget} ms)`);
	await page.evaluate(async () => window.editor.loadBlankImage(320, 240, '#ffffff'));
	await page.waitForFunction(() => window.editor.originalCanvas.width === 320);
	await page.waitForTimeout(200);
}

// ===== TOUCH =====

async function touch(client, type, points) {
	await client.send('Input.dispatchTouchEvent', {
		type,
		touchPoints: points.map((point, id) => ({ x: point.x, y: point.y, id, radiusX: 4, radiusY: 4, force: 1 }))
	});
}

async function tap(page, client, x, y) {
	const point = await clientPoint(page, x, y);
	await touch(client, 'touchStart', [point]);
	await page.waitForTimeout(40);
	await touch(client, 'touchEnd', []);
	await page.waitForTimeout(420);
}

async function checkTouch(browser) {
	const context = await browser.newContext({ viewport: { width: 900, height: 1100 }, hasTouch: true });
	const { page, errors } = await openEditor(context);
	const client = await context.newCDPSession(page);
	await page.evaluate(() => {
		window.editor.pathEdit.setNextPointType('curve');
		window.editor.setTool(ToolType.PEN);
	});
	await tap(page, client, 60, 60);
	await tap(page, client, 160, 100);
	let state = await pathState(page);
	assert(state.count === 1 && state.subpaths[0].points.length === 2 && state.session?.mode === 'draw', `taps place points ${JSON.stringify(state.session)}`);
	assert(state.subpaths[0].points[1].type === 'auto', 'a tap places the context bar\'s point type');

	// Two fingers pan and zoom and never place a point.
	const a = await clientPoint(page, 100, 160);
	const b = await clientPoint(page, 220, 160);
	const zoomBefore = await page.evaluate(() => window.editor.viewport.currentZoom);
	await touch(client, 'touchStart', [a]);
	await page.waitForTimeout(20);
	await touch(client, 'touchStart', [a, b]);
	for (let step = 1; step <= 6; step++) {
		await touch(client, 'touchMove', [{ x: a.x - step * 8, y: a.y }, { x: b.x + step * 8, y: b.y }]);
		await page.waitForTimeout(20);
	}
	await touch(client, 'touchEnd', []);
	await page.waitForTimeout(450);
	state = await pathState(page);
	const zoomAfter = await page.evaluate(() => window.editor.viewport.currentZoom);
	assert(state.subpaths[0].points.length === 2, `a pinch places no point (${state.subpaths[0].points.length})`);
	assert(zoomAfter > zoomBefore * 1.1, `a pinch zooms mid-path (${zoomBefore} -> ${zoomAfter})`);
	assert(state.session?.mode === 'draw', 'the path is still being drawn after a pinch');

	// A one-finger drag from empty canvas places a point and pulls its handles.
	const from = await clientPoint(page, 220, 60);
	const to = await clientPoint(page, 250, 60);
	await touch(client, 'touchStart', [from]);
	for (let step = 1; step <= 6; step++) {
		await touch(client, 'touchMove', [{ x: from.x + (to.x - from.x) * step / 6, y: from.y }]);
		await page.waitForTimeout(40);
	}
	await touch(client, 'touchEnd', []);
	await page.waitForTimeout(420);
	state = await pathState(page);
	assert(state.subpaths[0].points.length === 3 && state.subpaths[0].points[2].out, `a touch drag pulls handles ${JSON.stringify(state.subpaths[0].points[2])}`);

	// Done replaces Enter.
	await page.evaluate(() => document.getElementById('contextPathDone').click());
	state = await pathState(page);
	assert(state.session?.mode === 'edit', 'Done finishes drawing');
	await page.evaluate(() => document.getElementById('contextPathDone').click());
	state = await pathState(page);
	assert(state.session === null && state.count === 1, 'Done again leaves the session');
	assert(errors.length === 0, `page errors on touch: ${errors.join('; ')}`);
	await context.close();
}

(async () => {
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({ viewport: VIEWPORT });
		const { page, errors } = await openEditor(context);
		const checks = [
			['layer contract', checkLayerContract],
			['body mask', checkBodyMask],
			['stroke geometry', checkStrokeGeometry],
			['transform and history', checkTransformAndHistory],
			['convert shape', checkConvertShape],
			['line tool', checkLineTool],
			['pen drawing', checkPenDrawing],
			['pen editing', checkPenEditing],
			['live drag cost', checkLiveDragCost]
		];
		for (const [name, check] of checks) {
			await check(page);
			assert(errors.length === 0, `page errors during ${name}: ${errors.join('; ')}`);
			console.log(`ok  ${name}`);
		}
		await context.close();
		await checkTouch(browser);
		console.log('ok  touch');
		console.log('path-tool-verify: passed');
	} finally {
		await browser.close();
	}
})().catch((error) => {
	console.error(error.stack || error.message);
	process.exit(1);
});
