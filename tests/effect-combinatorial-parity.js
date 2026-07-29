'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

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

		const result = await page.evaluate(() => {
			const sweep = PREVIEW_EXPORT_SWEEP;
			const editor = window.editor;
			const glitterId = editor.glitterManager.content[0]?.id;
			if (!glitterId) throw new Error('Combinatorial parity requires one glitter asset');

			const makeFill = (mode) => {
				if (mode === 'glitter') return { mode, glitterId };
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

			const textFillMask = document.createElement('canvas');
			textFillMask.width = 48;
			textFillMask.height = 40;
			textFillMask._textureOrigin = { x: 0, y: 0 };
			const textContext = textFillMask.getContext('2d');
			textContext.fillStyle = '#ffffff';
			textContext.fillRect(9, 7, 25, 21);
			textContext.clearRect(18, 14, 7, 6);

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
								selectedGlitterId: glitterId,
								settings: { scale: 100, opacity: 100, colorAdjust: { hue: 0, saturation: 100, brightness: 100 } },
								textData: { fill: makeFill(fillMode), border }
							};
							const measurement = {
								key: `text-mask-${textCases}`,
								canvas: textFillMask,
								_borderMaskCache: null
							};
							const previewTextMask = editor.textGlitterManager
								.getBorderMaskCanvas(textLayer, measurement, border).canvas;
							const exportTextMask = editor.exporter._createPlacedBorderMaskCanvas(textFillMask, border);
							assertPixels(previewTextMask, exportTextMask, `text ${placement}/${edgeStyle}/${drawOrder}/${fillMode}`);
							if (editor.textGlitterManager.getBorderDrawOrder(border) !== editor.exporter._getBorderDrawOrder(border)) {
								throw new Error('Text border draw order diverged');
							}
							if (
								JSON.stringify(editor.textGlitterManager.getEffectPaintSource(textLayer, 'fill'))
								!== JSON.stringify(editor.exporter._getTextEffectSource(textLayer, 'fill'))
							) {
								throw new Error(`Text fill source diverged for ${fillMode}`);
							}
							textCases += 1;

							const shapeLayer = editor.shapeGlitterManager.createLayer({
								shapeId: 'heart',
								width: 54,
								height: 46,
								position: { x: 80, y: 60 }
							});
							shapeLayer.id = `shape-${shapeCases}`;
							shapeLayer.selectedGlitterId = glitterId;
							shapeLayer.shapeData.fill = makeFill(fillMode);
							shapeLayer.shapeData.border = border;
							const shapeMeasurement = editor.shapeGlitterManager.getMeasurementEntry(shapeLayer);
							const previewShapeMask = editor.shapeGlitterManager.getBorderMaskCanvas(shapeMeasurement, border);
							const exportShapeMask = editor.shapeGlitterManager.buildMaskEntry(shapeLayer).border;
							assertPixels(previewShapeMask, exportShapeMask, `shape ${placement}/${edgeStyle}/${drawOrder}/${fillMode}`);
							if (editor.shapeGlitterManager.getBorderDrawOrder(border) !== editor.exporter._getBorderDrawOrder(border)) {
								throw new Error('Shape border draw order diverged');
							}
							if (
								JSON.stringify(editor.shapeGlitterManager.getEffectPaintSource(shapeLayer, 'fill'))
								!== JSON.stringify(editor.exporter._getShapeEffectSource(shapeLayer, 'fill'))
							) {
								throw new Error(`Shape fill source diverged for ${fillMode}`);
							}
							shapeCases += 1;
						}
					}
				}
			}
			return { textCases, shapeCases };
		});

		assert(result.textCases === 36, `Expected 36 text combinations, got ${result.textCases}`);
		assert(result.shapeCases === 36, `Expected 36 shape combinations, got ${result.shapeCases}`);
		process.stdout.write(`Combinatorial preview/export parity passed (${result.textCases + result.shapeCases} cases)\n`);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	process.stderr.write(`${error.stack || error}\n`);
	process.exit(1);
});
