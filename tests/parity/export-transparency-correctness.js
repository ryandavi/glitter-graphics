'use strict';

// Regression coverage for docs/EXPORT-TRANSPARENCY-CORRECTNESS-PLAN.md.
// The invariant under test: transparency comes from the final pixel's alpha,
// never from its RGB color. These checks specifically target the bugs the
// plan describes (PNG chroma-key contamination on partial alpha, GIF
// quantization stealing an opaque color into the transparent index) rather
// than re-testing already-covered export architecture.

const { chromium } = require('playwright');
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(APP_URL, { waitUntil: 'networkidle' });
	await page.waitForFunction(() => window.editor?.settingsStore);

	const result = await page.evaluate(async () => {
		const check = (condition, message) => { if (!condition) throw new Error(message); };
		const editor = window.editor;
		const exporter = editor.exporter;

		const SIZE = 64;
		await editor.loadBlankImage(SIZE, SIZE, '#ffffff');
		while (!editor.originalImage) await new Promise((resolve) => setTimeout(resolve, 10));

		const callbacks = {
			onStatus: () => {}, onProgress: () => {}, onComplete: () => {},
			parseGif: (url) => editor.glitterManager.parseGifFromUrl(url),
			createMask: (layer) => editor.maskCompositor.getMaskData(layer),
			renderSlotMasks: (layer) => getLayerManagerForType(editor, layer.type).renderSlotMasks(layer),
			ensureTextFont: (fontId) => editor.textGlitterManager.ensureFontLoaded(fontId)
		};

		function baseCanvasData() {
			return {
				width: SIZE, height: SIZE,
				originalData: new Uint8ClampedArray(editor.originalImageData.data),
				originalAlpha: editor.originalAlphaChannel,
				alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold,
				hasBaseImage: true
			};
		}

		// --- 1/2/3. PNG must preserve true partial alpha with zero RGB
		// contamination from any chroma key. A solid shape at 50% layer opacity,
		// drawn over a fully transparent (no base image) canvas, must come out
		// as exactly its own color at its own alpha - not blended against
		// magenta or any other sentinel. The shape is sized well inside the
		// canvas (with room for the shape mask's own edge padding) so the
		// sampled pixel sits deep in the fill, away from the antialiased edge.
		{
			const shapeLayer = editor.shapeGlitterManager.createLayer({ shapeId: 'circle', width: 40, height: 40 });
			shapeLayer.opacity = 50;
			shapeLayer.shapeData.fill = { mode: 'solid', color: '#ff0000', opacity: 100 };
			const visibleLayers = [shapeLayer];
			const composed = await exporter.composeFrameAt({
				visibleLayers, glitterGifs: editor.glitterManager.content, canvasData: baseCanvasData(),
				exportSettings: { ...structuredClone(editor.exportSettings), baseImage: false, transparency: true },
				target: EXPORT_TARGETS['still:png'], callbacks, timestamp: 0
			});
			const data = composed.imageData.data;
			const centerOffset = ((SIZE / 2) * SIZE + (SIZE / 2)) * 4;
			check(data[centerOffset] === 255 && data[centerOffset + 1] === 0 && data[centerOffset + 2] === 0,
				`PNG partial-alpha pixel RGB was contaminated: ${data[centerOffset]},${data[centerOffset + 1]},${data[centerOffset + 2]}`);
			check(Math.abs(data[centerOffset + 3] - 128) <= 1,
				`PNG partial-alpha pixel alpha was not preserved (${data[centerOffset + 3]})`);

			// Full round trip through the still-image PNG encoder/decoder: the
			// browser's own PNG codec is not the bug surface, but this proves the
			// compositor's RGBA reaches it unmolested end to end.
			const originalShow = editor.exportResultPresenter.show;
			editor.exportResultPresenter.show = () => {};
			try {
				const blob = await editor.stillImageExporter.process({
					visibleLayers, glitterGifs: editor.glitterManager.content, canvasData: baseCanvasData(),
					exportSettings: { ...structuredClone(editor.exportSettings), baseImage: false, transparency: true },
					target: EXPORT_TARGETS['still:png'], callbacks, timestamp: 0
				});
				const bitmap = await createImageBitmap(blob);
				const decodeCanvas = document.createElement('canvas');
				decodeCanvas.width = SIZE; decodeCanvas.height = SIZE;
				const decodeCtx = decodeCanvas.getContext('2d');
				decodeCtx.drawImage(bitmap, 0, 0);
				const decoded = decodeCtx.getImageData(SIZE / 2, SIZE / 2, 1, 1).data;
				check(decoded[0] === 255 && decoded[1] === 0 && decoded[2] === 0 && Math.abs(decoded[3] - 128) <= 1,
					`Full PNG round trip lost partial alpha or contaminated RGB: ${[...decoded].join(',')}`);
			} finally { editor.exportResultPresenter.show = originalShow; }
		}

		// --- 14/15. Transparency-disabled PNG must still matte fully opaque.
		{
			const shapeLayer = editor.shapeGlitterManager.createLayer({ shapeId: 'circle', width: 8, height: 8 });
			shapeLayer.shapeData.fill = { mode: 'solid', color: '#0000ff', opacity: 100 };
			const composed = await exporter.composeFrameAt({
				visibleLayers: [shapeLayer], glitterGifs: editor.glitterManager.content, canvasData: baseCanvasData(),
				exportSettings: { ...structuredClone(editor.exportSettings), baseImage: false, transparency: false, matteColor: '#00ff00' },
				target: EXPORT_TARGETS['still:png'], callbacks, timestamp: 0
			});
			const cornerOffset = 0;
			check(composed.imageData.data[cornerOffset] === 0 && composed.imageData.data[cornerOffset + 1] === 255
				&& composed.imageData.data[cornerOffset + 2] === 0 && composed.imageData.data[cornerOffset + 3] === 255,
				'Transparency-disabled export did not matte an uncovered pixel to the configured matte color');
		}

		// --- 4. GIF binary threshold boundary is exactly 128, owned only by
		// GifEncodingPipeline, and never conflated with the 254 selection
		// threshold or reused across PNG.
		{
			const pipeline = exporter.gifEncodingPipeline;
			const boundaryFrame = (alpha) => new ImageData(new Uint8ClampedArray([10, 20, 30, alpha]), 1, 1);
			for (const [alpha, expectTransparent] of [[0, true], [1, true], [127, true], [128, false], [129, false], [254, false], [255, false]]) {
				const prepared = pipeline._prepareTransparentFrame(boundaryFrame(alpha), [], { r: 255, g: 0, b: 255, hex: 0xff00ff }, 128);
				check(prepared.hasTransparentPixel === expectTransparent, `GIF alpha ${alpha} was classified as ${prepared.hasTransparentPixel ? 'transparent' : 'opaque'}, expected ${expectTransparent ? 'transparent' : 'opaque'}`);
			}
		}

		// --- 5/7/8/9. Opaque colors must never become transparent regardless of
		// RGB, including colors that collide with sentinel candidates and a
		// color produced only by rendering (gradient interpolation), never
		// copied from a source asset.
		{
			const pipeline = exporter.gifEncodingPipeline;
			// Visible palette already contains every sentinel candidate up to
			// yellow; force the sentinel further down the deterministic list.
			const crowdedPalette = [255, 0, 255, 0, 255, 255, 255, 255, 0];
			const sentinel = pipeline._selectTransparencySentinel(crowdedPalette);
			check(sentinel.r === 1 && sentinel.g === 1 && sentinel.b === 1, `Sentinel selection did not walk past crowded candidates: ${JSON.stringify(sentinel)}`);
			for (const [r, g, b] of [[255, 0, 255], [0, 255, 255], [255, 255, 0]]) {
				const frame = new ImageData(new Uint8ClampedArray([r, g, b, 255]), 1, 1);
				const prepared = pipeline._prepareTransparentFrame(frame, crowdedPalette, sentinel, 128);
				check(!prepared.hasTransparentPixel, `Opaque pixel (${r},${g},${b}) equal to a sentinel candidate was classified transparent`);
				check(prepared.frame.data[0] === r && prepared.frame.data[1] === g && prepared.frame.data[2] === b && prepared.frame.data[3] === 255,
					`Opaque pixel (${r},${g},${b}) equal to a sentinel candidate was not preserved exactly`);
			}
			// A rendered-only color (mid-interpolation of a gradient), not copied
			// from any source asset.
			const renderedFrame = new ImageData(new Uint8ClampedArray([37, 142, 201, 255]), 1, 1);
			const preparedRendered = pipeline._prepareTransparentFrame(renderedFrame, [37, 142, 201], sentinel, 128);
			check(!preparedRendered.hasTransparentPixel && preparedRendered.frame.data[3] === 255,
				'A generated (non-source) opaque color was classified transparent');
		}

		// --- 25. An all-transparent frame (no visible palette entries anywhere)
		// must still encode using only the sentinel, without throwing.
		{
			const pipeline = exporter.gifEncodingPipeline;
			const sentinel = pipeline._selectTransparencySentinel([]);
			const frame = new ImageData(new Uint8ClampedArray([9, 9, 9, 0]), 1, 1);
			const prepared = pipeline._prepareTransparentFrame(frame, [], sentinel, 128);
			check(prepared.hasTransparentPixel && prepared.frame.data[0] === sentinel.r && prepared.frame.data[3] === 255,
				'All-transparent frame with an empty visible palette was not handled');
		}

		// --- 8/17. Filter edge protection (keepAlpha) must restore the real
		// original RGBA pixel, never a sentinel RGB, below the alpha threshold.
		{
			const width = 2, height = 1;
			const canvas = document.createElement('canvas');
			canvas.width = width; canvas.height = height;
			const ctx = canvas.getContext('2d');
			// Pixel 0 is below the selection threshold (edge-protected); pixel 1 is opaque.
			ctx.putImageData(new ImageData(new Uint8ClampedArray([12, 34, 56, 40, 200, 200, 200, 255]), width, height), 0, 0);
			// Canvas 2D storage is premultiplied, so a low-alpha pixel round-trips
			// through getImageData with small rounding, independent of this fix -
			// compare against what the canvas itself reports as "pre", not the
			// literal bytes written in.
			const pre = ctx.getImageData(0, 0, width, height).data;
			GlitterFilter.renderToCanvas(ctx, width, height, { type: 'basic', brightness: 80 }, 1, {
				keepAlpha: true,
				alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold
			});
			const out = ctx.getImageData(0, 0, width, height).data;
			check(out[0] === pre[0] && out[1] === pre[1] && out[2] === pre[2] && out[3] === pre[3],
				`Filter keepAlpha did not restore the original RGBA edge pixel exactly: ${[...out.slice(0, 4)].join(',')} vs pre ${[...pre.slice(0, 4)].join(',')}`);
			check(out[3] === 40, 'Filter keepAlpha did not preserve the original low alpha value');
		}

		// --- preserveAlpha SSOT: verify the compositor decision matches the
		// documented formula exactly (no base-content prediction involved).
		{
			check(exporter._resolvePreserveAlpha(true, { transparency: true }) === true
				&& exporter._resolvePreserveAlpha(true, { transparency: false }) === false
				&& exporter._resolvePreserveAlpha(false, { transparency: true }) === false
				&& exporter._resolvePreserveAlpha(false, { transparency: false }) === false,
				'preserveAlpha diverged from targetSupportsTransparency && exportSettings.transparency');
		}

		return { ok: true };
	});

	assert(result.ok, 'Transparency correctness verifier returned incomplete results');
	assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
	console.log('PASS export transparency correctness: PNG alpha/RGB integrity, GIF threshold boundary, opaque-color/sentinel collision safety, all-transparent frames, and filter edge protection');
	await browser.close();
})().catch((error) => {
	console.error('FAIL', error.stack || error.message);
	process.exit(1);
});
