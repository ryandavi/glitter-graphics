'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

const paritySource = fs.readFileSync(path.join(__dirname, 'preview-export-parity.js'), 'utf8');
const parityContext = {};
vm.runInNewContext(`${paritySource}\nglobalThis.sweep = PREVIEW_EXPORT_SWEEP;`, parityContext);
const PREVIEW_EXPORT_SWEEP = parityContext.sweep;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
		await page.goto(APP_URL, { waitUntil: 'networkidle' });
		await page.evaluate(async () => {
			document.querySelectorAll('.modal-overlay.visible').forEach((node) => node.classList.remove('visible'));
			await window.editor.loadBlankImage(160, 120, '#ffffff');
		});
		await page.waitForFunction(() => Boolean(window.editor?.originalImage));

		const result = await page.evaluate(async (sweep) => {
			const editor = window.editor;
			const glitterId = editor.glitterManager.content[0]?.id;
			if (!glitterId) throw new Error('Combinatorial parity requires one glitter asset');
			const imageCanvas = document.createElement('canvas');
			imageCanvas.width = 12;
			imageCanvas.height = 8;
			const imageContext = imageCanvas.getContext('2d');
			imageContext.fillStyle = '#ef247a';
			imageContext.fillRect(0, 0, 6, 8);
			imageContext.fillStyle = '#25b9e8';
			imageContext.fillRect(6, 0, 6, 8);
			await editor.shapeGlitterManager.registerImageFillAsset('parity-image', {
				dataUrl: imageCanvas.toDataURL('image/png'),
				name: 'Parity Image',
				mimeType: 'image/png'
			});

			const makeFill = (mode) => {
				if (mode === 'glitter') return { mode, glitterId };
				if (mode === 'image') return { mode, imageRef: 'parity-image', fit: 'cover', offsetXPercent: 25, offsetYPercent: 75, opacity: 83 };
				if (mode === 'gradient') {
					return {
						mode,
						gradient: {
							type: 'linear',
							angle: 37,
							interpolation: 'linear',
							stops: [
								{ offset: 0, color: '#e62e73', alpha: 1 },
								{ offset: 1, color: '#284dd8', alpha: 0.7 }
							]
						}
					};
				}
				return { mode: 'solid', color: '#4b8fce', opacity: 83 };
			};
			const canvasBytes = (canvas) => canvas
				? Array.from(canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data)
				: null;
			const assertPixels = (previewCanvas, exportCanvas, label) => {
				if (!previewCanvas || !exportCanvas) throw new Error(`${label}: missing mask canvas`);
				if (previewCanvas.width !== exportCanvas.width || previewCanvas.height !== exportCanvas.height) {
					throw new Error(`${label}: mask dimensions differ`);
				}
				const preview = canvasBytes(previewCanvas);
				const exported = canvasBytes(exportCanvas);
				for (let index = 0; index < preview.length; index += 1) {
					if (Math.abs(preview[index] - exported[index]) > 1) {
						throw new Error(`${label}: mask differs at byte ${index}`);
					}
				}
			};

			// Preview spans and the export composite both read buildSlotStack, so
			// they must agree on order and on every resolved paint source; a front
			// border must land after the fill and a behind border before it.
			const assertStackParity = (manager, layer, drawOrder, label) => {
				const preview = manager.getSlotStack(layer);
				const exported = buildSlotStack(layer, (entry) => editor.exporter._getSlotSource(layer, entry));
				const keys = (stack) => stack.map((item) => item.key).join(',');
				if (keys(preview) !== keys(exported)) throw new Error(`${label}: stack order diverged (${keys(preview)} vs ${keys(exported)})`);
				preview.forEach((item, index) => {
					if (JSON.stringify(item.source) !== JSON.stringify(exported[index].source)) {
						throw new Error(`${label}: ${item.key} source diverged`);
					}
				});
				const order = keys(preview).split(',');
				const borderAfterFill = order.indexOf('border') > order.indexOf('fill');
				if (order.includes('fill') && borderAfterFill !== (drawOrder === 'front')) {
					throw new Error(`${label}: border drawn on the wrong side of the fill`);
				}
			};

			let textCases = 0;
			let shapeCases = 0;
			for (const placement of sweep.placements) {
				for (const edgeStyle of sweep.edgeStyles) {
					for (const drawOrder of sweep.drawOrders) {
						for (const fillMode of sweep.fillModes) {
							const border = {
								mode: 'solid',
								color: '#15243d',
								widthPx: 5,
								placement,
								edgeStyle,
								drawOrder,
								style: 'solid'
							};
							const textLayer = {
								id: `text-${textCases}`,
								type: LayerType.TEXT_GLITTER,
								textData: { fill: { scale: 100, opacity: 100, colorAdjust: { hue: 0, saturation: 100, brightness: 100 }, ...makeFill(fillMode), glitterId }, border }
							};
							assertStackParity(editor.textGlitterManager, textLayer, drawOrder, `text ${placement}/${edgeStyle}/${drawOrder}/${fillMode}`);
							textCases += 1;

							const shapeLayer = editor.shapeGlitterManager.createLayer({
								shapeId: 'heart',
								width: 54,
								height: 46,
								position: { x: 80, y: 60 }
							});
							shapeLayer.id = `shape-${shapeCases}`;
							shapeLayer.shapeData.fill = { ...makeFill(fillMode), glitterId };
							shapeLayer.shapeData.border = border;
							const shapeMeasurement = editor.shapeGlitterManager.getMeasurementEntry(shapeLayer);
							const previewShapeMask = editor.shapeGlitterManager.getBorderMaskCanvas(shapeMeasurement, border);
							const exportShapeMask = editor.shapeGlitterManager.renderSlotMasks(shapeLayer).border;
							assertPixels(previewShapeMask, exportShapeMask, `shape ${placement}/${edgeStyle}/${drawOrder}/${fillMode}`);
							assertStackParity(editor.shapeGlitterManager, shapeLayer, drawOrder, `shape ${placement}/${edgeStyle}/${drawOrder}/${fillMode}`);
							shapeCases += 1;
						}
					}
				}
			}
			return { textCases, shapeCases };
		}, PREVIEW_EXPORT_SWEEP);

		assert(result.textCases === 48, `Expected 48 text combinations, got ${result.textCases}`);
		assert(result.shapeCases === 48, `Expected 48 shape combinations, got ${result.shapeCases}`);
		process.stdout.write(`Combinatorial preview/export parity passed (${result.textCases + result.shapeCases} cases)\n`);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	process.stderr.write(`${error.stack || error}\n`);
	process.exit(1);
});
