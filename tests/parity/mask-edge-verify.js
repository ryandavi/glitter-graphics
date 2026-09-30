'use strict';

const { chromium } = require('playwright');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function openEditor(page) {
	await page.goto(APP_URL, { waitUntil: 'networkidle' });
	await page.evaluate(() => {
		document.querySelectorAll('.modal-overlay.visible').forEach((node) => node.classList.remove('visible'));
	});
	await page.evaluate(async () => window.editor.loadBlankImage(320, 240, '#ffffff'));
	await page.waitForFunction(() => Boolean(window.editor?.originalImage));
}

async function getBrushAlphaProfile(page, { crisp, softness, flow = 100 }) {
	return page.evaluate(({ crispEdges, brushSoftness, brushFlow }) => {
		PREFERENCES.set('crispMaskEdges', crispEdges);
		const editor = window.editor;
		const maskEditor = editor.maskEditor;
		maskEditor.toolSettings.add.size = 41;
		maskEditor.toolSettings.add.softness = brushSoftness;
		maskEditor.toolSettings.add.flow = brushFlow;
		maskEditor.toolSettings.add.pressure = false;
		maskEditor.mode = 'add';

		const stamp = maskEditor._getStampCanvas();
		const stampPixels = stamp.getContext('2d', { willReadFrequently: true })
			.getImageData(0, 0, stamp.width, stamp.height).data;
		const stampAlpha = [...new Set(Array.from(stampPixels).filter((_, index) => index % 4 === 3))].sort((a, b) => a - b);

		const layer = editor.glitterManager.createLayer();
		const paint = editor.paintMaskStore.ensurePaintMask(layer.id);
		maskEditor._stampAtPoint(layer, paint, 100.25, 100.75, null);
		const paintPixels = paint.add.getContext('2d', { willReadFrequently: true })
			.getImageData(70, 70, 60, 60).data;
		const paintAlpha = [...new Set(Array.from(paintPixels).filter((_, index) => index % 4 === 3))].sort((a, b) => a - b);

		return { stampAlpha, paintAlpha };
	}, { crispEdges: crisp, brushSoftness: softness, brushFlow: flow });
}

async function getStickerOutlineProfiles(page) {
	return page.evaluate(() => {
		PREFERENCES.set('crispMaskEdges', true);
		const source = createAppCanvas(7, 7, 'tests/sticker-outline');
		const ctx = source.getContext('2d', { willReadFrequently: true, alpha: true });
		const image = ctx.createImageData(7, 7);
		image.data[(3 * 7 + 3) * 4 + 3] = 255;
		image.data[(3 * 7 + 2) * 4 + 3] = 96;
		image.data[(3 * 7 + 4) * 4 + 3] = 180;
		ctx.putImageData(image, 0, 0);
		binarizeCanvasAlpha(ctx);

		const profile = (canvas) => ({
			alpha: [...new Set(Array.from(canvas.getContext('2d', { willReadFrequently: true })
				.getImageData(0, 0, canvas.width, canvas.height).data)
				.filter((_, index) => index % 4 === 3))].sort((a, b) => a - b),
			center: canvas.getContext('2d', { willReadFrequently: true }).getImageData(3, 3, 1, 1).data[3]
		});
		const smooth = createOutlineMaskCanvas(source, 2, 'round', false);
		const pixel = createOutlineMaskCanvas(source, 2, 'hard', false);
		const backing = createOutlineMaskCanvas(source, 2, 'round', true);
		return {
			defaultUnionFrames: window.editor.stickerManager.getDefaultBorder().unionFrames,
			defaultFillInterior: window.editor.stickerManager.getDefaultBorder().fillInterior,
			smooth: profile(smooth),
			pixel: profile(pixel),
			backing: profile(backing)
		};
	});
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
	try {
		await openEditor(page);

		const crisp = await getBrushAlphaProfile(page, { crisp: true, softness: 0 });
		assert(crisp.stampAlpha.every((alpha) => alpha === 0 || alpha === 255), `Crisp stamp retained partial alpha: ${crisp.stampAlpha}`);

		const antialiased = await getBrushAlphaProfile(page, { crisp: false, softness: 0 });
		assert(antialiased.stampAlpha.some((alpha) => alpha > 0 && alpha < 255), 'Antialias switch did not restore partial edge alpha');

		const soft = await getBrushAlphaProfile(page, { crisp: true, softness: 35 });
		assert(soft.stampAlpha.some((alpha) => alpha > 0 && alpha < 255), 'Softness no longer produces a feathered edge');

		const lowFlow = await getBrushAlphaProfile(page, { crisp: true, softness: 0, flow: 40 });
		const nonzeroFlow = lowFlow.paintAlpha.filter((alpha) => alpha > 0);
		assert(nonzeroFlow.length === 1, `Flow introduced a blurred edge ramp: ${lowFlow.paintAlpha}`);

		const stickerOutlines = await getStickerOutlineProfiles(page);
		assert(stickerOutlines.defaultUnionFrames, 'Sticker outlines did not default to all animation frames');
		assert(stickerOutlines.defaultFillInterior, 'Sticker outlines did not default to filling their interior');
		assert(stickerOutlines.smooth.alpha.every((alpha) => alpha === 0 || alpha === 255), `Smooth sticker outline retained partial alpha: ${stickerOutlines.smooth.alpha}`);
		assert(stickerOutlines.pixel.alpha.every((alpha) => alpha === 0 || alpha === 255), `Pixel sticker outline retained partial alpha: ${stickerOutlines.pixel.alpha}`);
		assert(stickerOutlines.smooth.center === 0, 'Outline-only sticker mask did not subtract its interior');
		assert(stickerOutlines.backing.center === 255, 'Filled sticker outline did not retain its interior backing');

		const pointerPressure = await page.evaluate(() => {
			const maskEditor = window.editor.maskEditor;
			return {
				trackpad: maskEditor._getPointerPressure('mouse', 0),
				pen: maskEditor._getPointerPressure('pen', 0.25)
			};
		});
		assert(pointerPressure.trackpad === null, 'Mouse/trackpad pressure was not ignored');
		assert(pointerPressure.pen === 0.25, 'Pen pressure was not preserved');

		const settingsState = await page.evaluate(() => {
			const input = document.getElementById('antialiasMaskEdges');
			const initialChecked = input.checked;
			input.checked = true;
			input.dispatchEvent(new Event('change', { bubbles: true }));
			const saved = JSON.parse(localStorage.getItem('glitterEditorSettings'));
			return {
				initialChecked,
				crispMaskEdges: PREFERENCES.get('crispMaskEdges'),
				savedAntialiasEdges: saved.antialiasEdges
			};
		});
		assert(!settingsState.initialChecked, 'Antialias Edges was not off by default');
		assert(!settingsState.crispMaskEdges, 'Enabling Antialias Edges did not disable crisp mask rendering');
		assert(settingsState.savedAntialiasEdges, 'Antialias Edges was not persisted');

		await page.reload({ waitUntil: 'networkidle' });
		const persistedState = await page.evaluate(() => ({
			checked: document.getElementById('antialiasMaskEdges').checked,
			crispMaskEdges: PREFERENCES.get('crispMaskEdges')
		}));
		assert(persistedState.checked, 'Antialias Edges did not restore after reload');
		assert(!persistedState.crispMaskEdges, 'Restored Antialias Edges did not update mask rendering');

		console.log('PASS Zero-softness brush stamps are binary in crisp mode');
		console.log('PASS Disabling crisp mode restores antialiased brush edges');
		console.log('PASS Softness remains feathered independently of antialiasing');
		console.log('PASS Flow remains uniform across a crisp stamp');
		console.log('PASS Sticker outline styles are binary in crisp mode and support a filled backing');
		console.log('PASS Sticker outlines use all animation frames by default');
		console.log('PASS Sticker outlines fill their interior by default');
		console.log('PASS Mouse and Force Touch trackpad input ignores pressure while pen pressure is preserved');
		console.log('PASS Antialias Edges defaults off and persists when enabled');
	} finally {
		await page.evaluate(() => {
			const input = document.getElementById('antialiasMaskEdges');
			if (input) {
				input.checked = false;
				input.dispatchEvent(new Event('change', { bubbles: true }));
			}
			CONFIG.rendering.crispMaskEdges = true;
		}).catch(() => {});
		await page.close();
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error?.stack || String(error));
	process.exit(1);
});
