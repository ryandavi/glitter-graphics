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
			layer.shapeData.transform.rotation = shapeOptions.rotation;
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
			transform: layer?.shapeData?.transform ? JSON.parse(JSON.stringify(layer.shapeData.transform)) : null
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
		const masks = editor.shapeGlitterManager.buildMaskEntry(layer);
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
		console.log('\nShape border verification finished with all checks passing.');
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error?.stack || String(error));
	process.exit(1);
});
