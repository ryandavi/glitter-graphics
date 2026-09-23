'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const VIEWPORT = { width: 1200, height: 900 };
const POSITION_TOLERANCE_PX = 0.5;

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function approxEqual(actual, expected, tolerance, message) {
	if (Math.abs(actual - expected) > tolerance) {
		throw new Error(`${message} (expected ${expected}, got ${actual})`);
	}
}

async function openEditor(page) {
	await page.goto(APP_URL, { waitUntil: 'networkidle' });
	await page.evaluate(() => {
		document.querySelectorAll('.modal-overlay.visible').forEach((node) => node.classList.remove('visible'));
	});
	await page.evaluate(async () => {
		await window.editor.loadBlankImage(500, 400, '#ffffff');
	});
	await page.waitForFunction(() => Boolean(window.editor?.originalImage));
}

async function createBorderedShape(page, options = {}) {
	return page.evaluate((shapeOptions) => {
		const editor = window.editor;
		const layer = editor.shapeGlitterManager.createLayer({
			shapeId: shapeOptions.shapeId || 'square',
			width: shapeOptions.width || 120,
			height: shapeOptions.height || 80,
			position: shapeOptions.position || { x: 250, y: 200 }
		});
		editor.layerManager.insertLayer(layer);
		editor.layerManager.setActiveLayer(layer.id);

		layer.shapeData.border = editor.shapeGlitterManager.getDefaultBorder();
		layer.shapeData.border.widthPx = shapeOptions.borderWidth || 20;
		layer.shapeData.border.style = shapeOptions.borderStyle || 'solid';
		layer.shapeData.border.dotSpacingPx = shapeOptions.dotSpacingPx || 10;

		if (shapeOptions.shadow) {
			layer.shapeData.shadow = editor.shapeGlitterManager.getDefaultShadow();
			layer.shapeData.shadow.offsetX = shapeOptions.shadow.offsetX;
			layer.shapeData.shadow.offsetY = shapeOptions.shadow.offsetY;
		}

		if (shapeOptions.rotation != null) {
			layer.transform.rotation = shapeOptions.rotation;
		}

		editor.shapeGlitterManager.renderLayer(layer);
		editor.shapeGlitterManager.loadLayerSettings(layer);
		return layer.id;
	}, options);
}

async function captureShapeSnapshot(page, layerId, label) {
	return page.evaluate(({ id, tag }) => {
		const editor = window.editor;
		const layer = editor.layerManager.layers.find((entry) => entry.id === id);
		const wrapper = editor.shapeGlitterManager.layerElements.get(id);
		const stack = wrapper?.querySelector('.shape-glitter-stack');
		const frame = editor.shapeGlitterManager.getShapeHandleFrame(layer);
		const handles = document.querySelector(`.transform-handles[data-layer-id="${id}"]`);
		const box = handles?.querySelector('.transform-bounding-box');
		const styleValue = (name) => stack?.style.getPropertyValue(name) || '';
		return {
			label: tag,
			wrapperRect: wrapper?.getBoundingClientRect() || null,
			boxRect: box?.getBoundingClientRect() || null,
			frame,
			tfTop: styleValue('--tf-top'),
			tfRight: styleValue('--tf-right'),
			tfBottom: styleValue('--tf-bottom'),
			tfLeft: styleValue('--tf-left'),
			transform: layer?.transform ? JSON.parse(JSON.stringify(layer.transform)) : null
		};
	}, { id: layerId, tag: label });
}

function compareRects(actual, expected, message) {
	['left', 'top', 'width', 'height'].forEach((key) => {
		approxEqual(actual[key], expected[key], POSITION_TOLERANCE_PX, `${message} (${key})`);
	});
}

function parsePx(value) {
	return Number.parseFloat(String(value).replace('px', ''));
}

async function check1(page) {
	const layerId = await createBorderedShape(page, {
		shapeId: 'square',
		width: 120,
		height: 80,
		borderWidth: 20
	});

	const selected = await captureShapeSnapshot(page, layerId, 'selected');
	await page.evaluate((id) => window.editor.layerManager.setActiveLayer(null), layerId);
	const deselected = await captureShapeSnapshot(page, layerId, 'deselected');
	await page.evaluate((id) => window.editor.layerManager.setActiveLayer(id), layerId);
	const reselected = await captureShapeSnapshot(page, layerId, 'reselected');

	assert(selected.frame, 'Missing initial shape handle frame');
	approxEqual(selected.frame.width, 160, POSITION_TOLERANCE_PX, 'Border frame width did not include the border on both sides');
	approxEqual(selected.frame.height, 120, POSITION_TOLERANCE_PX, 'Border frame height did not include the border on both sides');
	compareRects(deselected.wrapperRect, selected.wrapperRect, 'Shape wrapper moved after deselect');
	compareRects(reselected.wrapperRect, selected.wrapperRect, 'Shape wrapper moved after reselect');
	compareRects(reselected.boxRect, selected.boxRect, 'Transform box moved after reselect');
	approxEqual(parsePx(selected.tfLeft), parsePx(selected.tfRight), POSITION_TOLERANCE_PX, 'Selection frame was not horizontally balanced');
	approxEqual(parsePx(selected.tfTop), parsePx(selected.tfBottom), POSITION_TOLERANCE_PX, 'Selection frame was not vertically balanced');
}

async function check2(page) {
	const layerId = await createBorderedShape(page, {
		shapeId: 'diamond',
		width: 140,
		height: 100,
		borderWidth: 12,
		rotation: 27,
		shadow: { offsetX: 24, offsetY: -18 }
	});

	const selected = await captureShapeSnapshot(page, layerId, 'selected-rotated');
	await page.evaluate((id) => window.editor.layerManager.setActiveLayer(null), layerId);
	const deselected = await captureShapeSnapshot(page, layerId, 'deselected-rotated');
	await page.evaluate((id) => window.editor.layerManager.setActiveLayer(id), layerId);
	const reselected = await captureShapeSnapshot(page, layerId, 'reselected-rotated');

	compareRects(deselected.wrapperRect, selected.wrapperRect, 'Rotated/shadowed shape wrapper moved after deselect');
	compareRects(reselected.wrapperRect, selected.wrapperRect, 'Rotated/shadowed shape wrapper moved after reselect');
	compareRects(reselected.boxRect, selected.boxRect, 'Rotated/shadowed transform box moved after reselect');
	approxEqual(reselected.transform.position.x, selected.transform.position.x, POSITION_TOLERANCE_PX, 'Transform X shifted after reselect');
	approxEqual(reselected.transform.position.y, selected.transform.position.y, POSITION_TOLERANCE_PX, 'Transform Y shifted after reselect');
}

async function check3(page) {
	const layerId = await createBorderedShape(page, {
		shapeId: 'circle',
		width: 120,
		height: 120,
		borderWidth: 12
	});

	await page.click('#shapeBorderStyleDotted');
	const dotted = await page.evaluate((id) => {
		const editor = window.editor;
		const layer = editor.layerManager.layers.find((entry) => entry.id === id);
		const masks = editor.shapeGlitterManager.renderSlotMasks(layer);
		return {
			style: layer.shapeData.border.style,
			spacingRowHidden: document.getElementById('shapeBorderDotSpacingRow')?.hidden,
			dottedActive: document.getElementById('shapeBorderStyleDotted')?.classList.contains('active'),
			maskPresent: Boolean(masks.border)
		};
	}, layerId);

	assert(dotted.style === 'dotted', 'Dotted border mode was not stored on the layer');
	assert(dotted.dottedActive, 'Dotted border button did not become active');
	assert(dotted.spacingRowHidden === false, 'Dot spacing control stayed hidden in dotted mode');
	assert(dotted.maskPresent, 'Dotted border mode did not produce a border mask');

	await page.click('#shapeBorderStyleSolid');
	const solid = await page.evaluate((id) => {
		const editor = window.editor;
		const layer = editor.layerManager.layers.find((entry) => entry.id === id);
		return {
			style: layer.shapeData.border.style,
			spacingRowHidden: document.getElementById('shapeBorderDotSpacingRow')?.hidden,
			solidActive: document.getElementById('shapeBorderStyleSolid')?.classList.contains('active')
		};
	}, layerId);

	assert(solid.style === 'solid', 'Solid border mode was not restored on the layer');
	assert(solid.solidActive, 'Solid border button did not become active again');
	assert(solid.spacingRowHidden === true, 'Dot spacing control stayed visible in solid mode');
}

async function check4(page) {
	const layerId = await createBorderedShape(page, {
		shapeId: 'square',
		width: 120,
		height: 80,
		borderWidth: 20
	});

	await page.evaluate(() => window.editor.saveState());
	const selected = await captureShapeSnapshot(page, layerId, 'selected-before-border-remove');

	await page.evaluate(() => {
		const input = document.getElementById('shapeBorderEnabled');
		input.checked = false;
		input.dispatchEvent(new Event('change', { bubbles: true }));
	});
	await page.evaluate(async () => {
		await window.editor.undo();
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});

	const restored = await captureShapeSnapshot(page, layerId, 'restored-after-undo');

	assert(restored.frame, 'Missing restored shape handle frame after undo');
	compareRects(restored.wrapperRect, selected.wrapperRect, 'Shape wrapper moved after border remove undo');
	compareRects(restored.boxRect, selected.boxRect, 'Transform box moved after border remove undo');
	approxEqual(restored.frame.width, selected.frame.width, POSITION_TOLERANCE_PX, 'Border frame width changed after undo');
	approxEqual(restored.frame.height, selected.frame.height, POSITION_TOLERANCE_PX, 'Border frame height changed after undo');
}

async function check5(page) {
	const layerId = await createBorderedShape(page, {
		shapeId: 'square',
		width: 140,
		height: 90,
		borderWidth: 8
	});

	const rounded = await page.evaluate((id) => {
		const editor = window.editor;
		const layer = editor.layerManager.layers.find((entry) => entry.id === id);
		const input = document.getElementById('shapeRadius');
		input.value = '30';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		const measurement = editor.shapeGlitterManager.getMeasurementEntry(layer);
		const { x, y } = measurement.shapeRect;
		return {
			radius: layer.shapeData.cornerRadiusPx,
			rowHidden: document.getElementById('shapeRadiusRow').hidden,
			cornerAlpha: measurement.canvas.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3]
		};
	}, layerId);

	assert(rounded.radius === 30, 'Radius slider did not update the shape data');
	assert(rounded.rowHidden === false, 'Radius row was hidden for the parametric square');
	assert(rounded.cornerAlpha === 0, 'Square corner radius did not cut out the corner pixels');

	await page.evaluate((id) => {
		const editor = window.editor;
		const layer = editor.layerManager.layers.find((entry) => entry.id === id);
		editor.shapeGlitterManager.applyShapeToLayer(layer, 'circle');
	}, layerId);
	assert(await page.locator('#shapeRadiusRow').evaluate((row) => row.hidden), 'Radius row stayed visible for a non-square shape');
}

async function check6(page) {
	// A hard-edge border must not inflate the transform box to the worst-case
	// miter reservation — the handle frame tracks the nominal border box.
	const layerId = await createBorderedShape(page, {
		shapeId: 'square',
		width: 120,
		height: 80,
		borderWidth: 12
	});

	const frames = await page.evaluate((id) => {
		const editor = window.editor;
		const layer = editor.layerManager.layers.find((entry) => entry.id === id);
		const read = () => {
			editor.shapeGlitterManager.invalidateMeasurement(layer);
			return editor.shapeGlitterManager.getShapeHandleFrame(layer);
		};
		layer.shapeData.border.edgeStyle = 'round';
		const round = read();
		layer.shapeData.border.edgeStyle = 'hard';
		const hard = read();
		return { round, hard };
	}, layerId);

	// width 120 + 2 × 12px border, both edge styles.
	approxEqual(frames.round.width, 144, POSITION_TOLERANCE_PX, 'Round-edge handle frame width');
	approxEqual(frames.hard.width, 144, POSITION_TOLERANCE_PX, 'Hard-edge handle frame width ballooned past the nominal border');
	approxEqual(frames.hard.height, 104, POSITION_TOLERANCE_PX, 'Hard-edge handle frame height ballooned past the nominal border');
	approxEqual(frames.hard.offsetX, 0, POSITION_TOLERANCE_PX, 'Hard-edge handle frame is offset from the shape');
	approxEqual(frames.hard.offsetY, 0, POSITION_TOLERANCE_PX, 'Hard-edge handle frame is offset from the shape');
}

async function check7(page) {
	const result = await page.evaluate(async () => {
		const editor = window.editor;
		const makeImage = (left, right) => {
			const canvas = document.createElement('canvas');
			canvas.width = 20;
			canvas.height = 10;
			const ctx = canvas.getContext('2d');
			ctx.fillStyle = left;
			ctx.fillRect(0, 0, 10, 10);
			ctx.fillStyle = right;
			ctx.fillRect(10, 0, 10, 10);
			return canvas.toDataURL('image/png');
		};
		await editor.shapeGlitterManager.registerImageFillAsset('image-a', {
			dataUrl: makeImage('#ef247a', '#25b9e8'), name: 'A.png', mimeType: 'image/png'
		});

		const layer = editor.shapeGlitterManager.createLayer({
			shapeId: 'square', width: 40, height: 40, position: { x: 250, y: 200 }
		});
		editor.layerManager.insertLayer(layer);
		editor.layerManager.setActiveLayer(layer.id);
		Object.assign(layer.shapeData.fill, {
			mode: 'image', imageRef: 'image-a', fit: 'cover', offsetXPercent: 100, offsetYPercent: 0, opacity: 100
		});
		editor.shapeGlitterManager.renderLayer(layer);
		editor.shapeGlitterManager.loadLayerSettings(layer);

		const measurement = editor.shapeGlitterManager.getMeasurementEntry(layer);
		const source = editor.shapeGlitterManager.getEffectPaintSource(layer, 'fill');
		const span = editor.shapeGlitterManager.layerElements.get(layer.id).querySelector('[data-span-key="fill"]');
		const output = document.createElement('canvas');
		editor.sceneCompositor._renderFilledMaskInto(output, measurement.canvas, source, layer, 0, `${layer.id}:fill`, new Map(), new Map());
		const center = output.getContext('2d').getImageData(
			Math.floor(measurement.shapeRect.x + 20), Math.floor(measurement.shapeRect.y + 20), 1, 1
		).data;
		const coverSpanSize = span.style.backgroundSize;
		const coverSpanPosition = span.style.backgroundPosition;
		const placements = {
			cover: computeImageFitPlacement('cover', 20, 10, 40, 40, 50, 50),
			contain: computeImageFitPlacement('contain', 20, 10, 40, 40, 50, 50),
			fill: computeImageFitPlacement('fill', 20, 10, 40, 40, 50, 50),
			none: computeImageFitPlacement('none', 20, 10, 40, 40, 50, 50),
			scaleDownFits: computeImageFitPlacement('scale-down', 20, 10, 40, 40, 50, 50),
			scaleDownShrinks: computeImageFitPlacement('scale-down', 20, 10, 10, 4, 50, 50),
			scaledCover: computeImageFitPlacement('cover', 20, 10, 40, 40, 50, 50, 150)
		};
		Object.assign(layer.shapeData.fill, {
			fit: 'none', imageScalePercent: 100, offsetXPercent: 0, offsetYPercent: 0,
			tile: true, imageRendering: 'pixelated'
		});
		editor.shapeGlitterManager.renderLayer(layer);
		editor.shapeGlitterManager.loadLayerSettings(layer);
		const tiledSource = editor.shapeGlitterManager.getEffectPaintSource(layer, 'fill');
		const tiledOutput = document.createElement('canvas');
		editor.sceneCompositor._renderFilledMaskInto(tiledOutput, measurement.canvas, tiledSource, layer, 0, `${layer.id}:fill`, new Map(), new Map());
		const tiledContext = tiledOutput.getContext('2d');
		const sample = (x) => Array.from(tiledContext.getImageData(Math.floor(measurement.shapeRect.x + x), Math.floor(measurement.shapeRect.y + 5), 1, 1).data);
		const tiledPixels = [sample(5), sample(15), sample(25)];
		const advanced = document.getElementById('shapeFillImageAdvanced');
		syncPaintSlotSourceUI(document.getElementById('shapeFillSolid'), 'solid');
		const advancedHiddenInSolid = advanced.hidden;
		syncPaintSlotSourceUI(document.getElementById('shapeFillImage'), 'image');

		const project = await editor.projectSerializer.serialize();
		const snapshotText = JSON.stringify(editor.historyManager.createStateSnapshot());
		editor.shapeGlitterManager.clearImageFillAssets();
		await editor.projectSerializer.registerShapeFillImages(project.shapeFillImages);
		const reloadedAssetName = editor.shapeGlitterManager.getImageFillAsset('image-a')?.name;
		editor.historyManager.reset(editor.historyManager.createStateSnapshot());
		await editor.shapeGlitterManager.registerImageFillAsset('image-b', {
			dataUrl: makeImage('#ffd33d', '#4c55ef'), name: 'B.png', mimeType: 'image/png'
		});
		layer.shapeData.fill.imageRef = 'image-b';
		editor.historyManager.saveState('Change image');
		await editor.historyManager.undo();
		const undoRef = editor.layerManager.getLayerById(layer.id)?.shapeData.fill.imageRef;
		await editor.historyManager.redo();
		const redoRef = editor.layerManager.getLayerById(layer.id)?.shapeData.fill.imageRef;

		return {
			coverSpanSize,
			coverSpanPosition,
			tiledRepeat: span.style.backgroundRepeat,
			tiledRendering: span.style.imageRendering,
			tiledPixels,
			center: Array.from(center),
			placements,
			projectAssetName: project.shapeFillImages['image-a']?.name,
			reloadedAssetName,
			serializedRef: project.layers.find((entry) => entry.id === layer.id)?.shapeData.fill.imageRef,
			snapshotContainsPixels: snapshotText.includes('data:image/png'),
			undoRef,
			redoRef,
			advancedParentIsPropertySet: advanced.parentElement.classList.contains('property-set'),
			advancedHasContract: advanced.hasAttribute('data-advanced'),
			advancedHiddenInSolid,
			imageControlsHidden: document.getElementById('shapeFillImageControls').hidden,
			imageAdvancedHidden: advanced.hidden,
			serializedTile: project.layers.find((entry) => entry.id === layer.id)?.shapeData.fill.tile,
			serializedRendering: project.layers.find((entry) => entry.id === layer.id)?.shapeData.fill.imageRendering
		};
	});

	assert(result.coverSpanSize === '80px 40px', `Cover preview size is wrong: ${result.coverSpanSize}`);
	assert(result.coverSpanPosition.endsWith('px'), 'Image preview position was not derived in pixels');
	assert(result.center[2] > result.center[0], `Right-aligned cover did not expose the blue half: ${result.center}`);
	assert(result.placements.cover.dw === 80 && result.placements.cover.dh === 40, 'Cover placement is wrong');
	assert(result.placements.contain.dw === 40 && result.placements.contain.dh === 20, 'Contain placement is wrong');
	assert(result.placements.fill.dw === 40 && result.placements.fill.dh === 40, 'Fill placement is wrong');
	assert(result.placements.none.dw === 20 && result.placements.none.dh === 10, 'None placement is wrong');
	assert(result.placements.scaleDownFits.dw === 20 && result.placements.scaleDownFits.dh === 10, 'Scale-down enlarged a fitting image');
	assert(result.placements.scaleDownShrinks.dw === 8 && result.placements.scaleDownShrinks.dh === 4, 'Scale-down did not shrink an overflowing image');
	assert(result.placements.scaledCover.dw === 120 && result.placements.scaledCover.dh === 60, 'Image scale was not applied after fit');
	assert(result.tiledRepeat === 'repeat' && result.tiledRendering === 'pixelated', 'Preview tiling/rendering controls were not applied');
	assert(result.tiledPixels[0][0] > result.tiledPixels[0][2] && result.tiledPixels[1][2] > result.tiledPixels[1][0] && result.tiledPixels[2][0] > result.tiledPixels[2][2], 'Exported image tiles did not repeat');
	assert(result.projectAssetName === 'A.png' && result.reloadedAssetName === 'A.png' && result.serializedRef === 'image-a', 'Project image-fill persistence is incomplete');
	assert(result.serializedTile === true && result.serializedRendering === 'pixelated', 'Image tiling/rendering state was not serialized');
	assert(result.snapshotContainsPixels === false, 'History snapshot cloned image pixel data');
	assert(result.undoRef === 'image-a' && result.redoRef === 'image-b', 'Image-fill ref did not survive undo/redo');
	assert(result.imageControlsHidden === false && result.imageAdvancedHidden === false, 'Image-fill controls were hidden in image mode');
	assert(result.advancedParentIsPropertySet === false && result.advancedHasContract && result.advancedHiddenInSolid, 'Image Advanced disclosure does not match the module-level disclosure contract');
}

async function runCheck(browser, label, checkFn) {
	const page = await browser.newPage({ viewport: VIEWPORT });
	try {
		await openEditor(page);
		await checkFn(page);
		console.log(`PASS ${label}`);
	} finally {
		await page.close();
	}
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		await runCheck(browser, '1. Solid shape border stays aligned through select/deselect/reselect', check1);
		await runCheck(browser, '2. Rotated shadowed shape border stays aligned through reselect', check2);
		await runCheck(browser, '3. Dotted shape border toggles spacing UI and produces a mask', check3);
		await runCheck(browser, '4. Undo restoring a removed shape border keeps the transform box aligned', check4);
		await runCheck(browser, '5. Rounded rectangle radius updates geometry and conditional UI', check5);
		await runCheck(browser, '6. Hard-edge border keeps the transform box tight to the shape', check6);
		await runCheck(browser, '7. Image fill preview/export, fit, persistence, and history stay aligned', check7);
		console.log('\nShape border verification finished with all checks passing.');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error?.stack || String(error));
	process.exit(1);
});
