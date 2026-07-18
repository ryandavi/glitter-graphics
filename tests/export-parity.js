'use strict';

const { chromium } = require('playwright');
const crypto = require('crypto');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const VIEWPORT = { width: 1200, height: 900 };
const EXPORT_TIMEOUT_MS = 20000;

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function hashBytes(bytes) {
	return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function findFirstByteDiff(a, b) {
	const limit = Math.min(a.length, b.length);
	for (let index = 0; index < limit; index += 1) {
		if (a[index] !== b[index]) {
			return index;
		}
	}
	return a.length === b.length ? -1 : limit;
}

async function openEditor(page) {
	await page.goto(APP_URL, { waitUntil: 'networkidle' });
	await page.evaluate(() => {
		document.querySelectorAll('.modal-overlay.visible').forEach((node) => node.classList.remove('visible'));
	});
	await page.evaluate(() => window.editor.loadBlankImage(320, 240, '#ffffff'));
	await page.waitForFunction(() => Boolean(window.editor?.originalImage) && window.editor.originalCanvas?.width === 320);
}

async function buildComposition(page) {
	return page.evaluate(async () => {
		const editor = window.editor;
		const animatedGlitters = editor.glitterManager.content.filter((item) => item.isAnimated);
		const animatedSticker = editor.stickerManager.content.find((item) => item.isAnimated);

		if (animatedGlitters.length < 2) {
			throw new Error('Need at least two animated glitter swatches for export parity coverage');
		}
		if (!animatedSticker) {
			throw new Error('Need at least one animated sticker for export parity coverage');
		}

		const glitterA = animatedGlitters[0].id;
		const glitterB = animatedGlitters[1].id;

		const glitterLayer = editor.glitterManager.createLayer();
		editor.layerManager.insertLayer(glitterLayer);
		glitterLayer.selectedGlitterId = glitterA;
		glitterLayer.fill = { mode: 'gradient', gradient: { type: 'linear', angle: 35, interpolation: 'steps', stops: [{ offset: 0, color: '#ff0066', alpha: 1 }, { offset: 1, color: '#3344ff', alpha: 0.75 }] } };
		const paint = editor.glitterManager.ensurePaintMask(glitterLayer.id);
		const paintCtx = paint.add.getContext('2d', { willReadFrequently: true });
		paintCtx.fillStyle = '#ffffff';
		paintCtx.fillRect(24, 28, 88, 72);
		paint.hasContent = true;
		paint.liveRevision += 1;
		glitterLayer.maskHasContent = true;
		editor.glitterManager.commitPaintState(glitterLayer);

		const stickerLayer = editor.stickerManager.createLayer(animatedSticker.id);
		editor.layerManager.insertLayer(stickerLayer);
		stickerLayer.stickerData.transform.position = { x: 250, y: 72 };
		stickerLayer.stickerData.transform.rotation = 28;
		stickerLayer.stickerData.transform.scale.x = 145;
		stickerLayer.stickerData.transform.scale.y = 120;
		stickerLayer.stickerData.transform.flipX = true;
		stickerLayer.stickerData.shadow = editor.stickerManager.getDefaultShadow();
		stickerLayer.stickerData.shadow.mode = 'glitter';
		stickerLayer.stickerData.shadow.glitterId = glitterB;

		const textLayer = editor.textGlitterManager.createLayer({
			text: 'Parity',
			position: { x: 160, y: 154 },
			align: 'center'
		});
		editor.layerManager.insertLayer(textLayer);
		textLayer.selectedGlitterId = glitterA;
		textLayer.textData.fill = editor.textGlitterManager.getDefaultFill();
		textLayer.textData.fill.mode = 'gradient';
		textLayer.textData.fill.gradient = { type: 'linear', angle: 70, interpolation: 'smooth', stops: [{ offset: 0, color: '#ff3300', alpha: 1 }, { offset: 0.45, color: '#ffee00', alpha: 0.8 }, { offset: 1, color: '#6633ff', alpha: 1 }] };
		textLayer.settings.colorAdjust = { hue: 90, saturation: 140, brightness: 110 };
		textLayer.textData.border = editor.textGlitterManager.getDefaultBorder();
		textLayer.textData.border.mode = 'solid';
		textLayer.textData.border.color = '#113355';
		textLayer.textData.border.widthPx = 4;
		textLayer.textData.shadow = editor.textGlitterManager.getDefaultShadow();
		textLayer.textData.shadow.mode = 'glitter';
		textLayer.textData.shadow.glitterId = glitterB;
		textLayer.textData.shadow.offsetX = 8;
		textLayer.textData.shadow.offsetY = 6;
		textLayer.textData.transform.rotation = 344;
		textLayer.textData.transform.scale.x = 125;
		textLayer.textData.transform.scale.y = 125;
		textLayer.textData.transform.flipY = true;
		await editor.textGlitterManager.refreshLayer(textLayer, { saveHistory: false });

		const shapeLayer = editor.shapeGlitterManager.createLayer({
			shapeId: 'heart',
			width: 88,
			height: 76,
			position: { x: 236, y: 170 }
		});
		editor.layerManager.insertLayer(shapeLayer);
		shapeLayer.selectedGlitterId = glitterB;
		shapeLayer.shapeData.fill.mode = 'gradient';
		shapeLayer.shapeData.fill.gradient = { type: 'radial', angle: 0, stops: [{ offset: 0, color: '#ffffff', alpha: 1 }, { offset: 1, color: '#00aacc', alpha: 0.65 }] };
		shapeLayer.shapeData.fill.colorAdjust = { hue: -45, saturation: 130, brightness: 120 };
		shapeLayer.shapeData.border = editor.shapeGlitterManager.getDefaultBorder();
		shapeLayer.shapeData.border.mode = 'solid';
		shapeLayer.shapeData.border.color = '#29163f';
		shapeLayer.shapeData.border.widthPx = 6;
		shapeLayer.shapeData.shadow = editor.shapeGlitterManager.getDefaultShadow();
		shapeLayer.shapeData.shadow.mode = 'glitter';
		shapeLayer.shapeData.shadow.glitterId = glitterA;
		shapeLayer.shapeData.shadow.offsetX = -6;
		shapeLayer.shapeData.shadow.offsetY = 8;
		shapeLayer.shapeData.transform.rotation = 22;
		shapeLayer.shapeData.transform.scale.x = 135;
		shapeLayer.shapeData.transform.scale.y = 90;
		shapeLayer.shapeData.transform.flipX = true;
		editor.shapeGlitterManager.renderLayer(shapeLayer);

		editor.layerManager.renderLayersList();
		editor.updatePreview();
		editor.saveState();
	});
}

async function exportBytes(page, exportOverrides = {}) {
	return page.evaluate(async ({ exportTimeoutMs, exportOverrides }) => {
		const editor = window.editor;
		Object.assign(editor.exportSettings, {
			baseImage: false,
			transparency: false,
			watermarkEnabled: false,
			exportReverse: false,
			smartFrameReduction: false,
			exportFrameSkip: 1,
			maxFrames: 24,
			frameDelay: 100,
			quality: 10,
			ditherEnabled: false,
			matteColor: '#ffffff'
		}, exportOverrides || {});

		const visibleLayers = editor.layerManager.layers.filter((layer) => layer.visible && window.layerHasVisibleContent(layer));
		if (visibleLayers.length < 4) {
			throw new Error('Expected the parity composition to create at least four visible content layers');
		}

		return await new Promise((resolve, reject) => {
			const exporter = editor.exporter;
			const originalHandleFileSave = exporter._handleFileSave.bind(exporter);
			const timeout = setTimeout(() => {
				exporter._handleFileSave = originalHandleFileSave;
				reject(new Error('Export timed out'));
			}, exportTimeoutMs);

			exporter._handleFileSave = async (blob) => {
				try {
					clearTimeout(timeout);
					const arrayBuffer = await blob.arrayBuffer();
					exporter._handleFileSave = originalHandleFileSave;
					resolve(Array.from(new Uint8Array(arrayBuffer)));
				} catch (error) {
					exporter._handleFileSave = originalHandleFileSave;
					reject(error);
				}
			};

			exporter.process({
				visibleLayers,
				glitterGifs: editor.glitterManager.content,
				canvasData: {
					width: editor.originalCanvas.width,
					height: editor.originalCanvas.height,
					originalData: new Uint8ClampedArray(editor.originalImageData.data),
					originalAlpha: editor.originalAlphaChannel,
					alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold
				},
				exportSettings: editor.exportSettings,
				callbacks: {
					onStatus: () => {},
					onProgress: () => {},
					onComplete: () => {},
					onError: (error) => {
						clearTimeout(timeout);
						exporter._handleFileSave = originalHandleFileSave;
						reject(error);
					},
					parseGif: (url) => editor.glitterManager.parseGifFromUrl(url),
					createMask: (layer) => editor.maskCompositor.getMaskData(layer),
					renderTextMask: (layer) => editor.textGlitterManager.renderTextMask(layer),
					renderShapeMask: (layer) => editor.shapeGlitterManager.buildMaskEntry(layer),
					ensureTextFont: (fontId) => editor.textGlitterManager.ensureFontLoaded(fontId)
				}
			}).catch((error) => {
				clearTimeout(timeout);
				exporter._handleFileSave = originalHandleFileSave;
				reject(error);
			});
		});
	}, { exportTimeoutMs: EXPORT_TIMEOUT_MS, exportOverrides });
}

async function verifyGradientStopLiveEditing(page) {
	const result = await page.evaluate(() => {
		const editor = window.editor;
		const layer = editor.layerManager.layers.find((entry) => entry.type === LayerType.TEXT_GLITTER);
		editor.layerManager.setActiveLayer(layer.id);
		editor.textGlitterManager.loadLayerSettings(layer);
		const panel = document.querySelector('#textFillGradient')?.closest('.glitter-source')?.querySelector('.effect-gradient-editor')
			|| document.querySelector('#textFillGradient')?.parentElement?.parentElement?.querySelector('.effect-gradient-editor');
		const position = panel?.querySelector('input[aria-label="Stop position"]');
		const color = panel?.querySelector('input[aria-label="Stop color"]');
		if (!position || !color) return { error: 'Missing text gradient stop controls' };
		position.value = '25';
		position.dispatchEvent(new Event('input', { bubbles: true }));
		const connectedAfterFirst = position.isConnected;
		position.value = '70';
		position.dispatchEvent(new Event('input', { bubbles: true }));
		color.value = '#123456';
		color.dispatchEvent(new Event('input', { bubbles: true }));
		color.value = '#654321';
		color.dispatchEvent(new Event('input', { bubbles: true }));
		const result = {
			connectedAfterFirst,
			connectedAfterSecond: position.isConnected && color.isConnected,
			offset: layer.textData.fill.gradient.stops[0].offset,
			color: layer.textData.fill.gradient.stops[0].color,
			stickerShadowLayers: document.querySelectorAll('.sticker-effect-shadow').length
		};
		editor.saveState();
		return result;
	});
	if (result.error) throw new Error(result.error);
	if (!result.connectedAfterFirst || !result.connectedAfterSecond || Math.abs(result.offset - 0.7) > 0.001 || result.color !== '#654321' || !result.stickerShadowLayers) {
		throw new Error(`Gradient stop live editing lost its control or state: ${JSON.stringify(result)}`);
	}
}

async function mutateTextAndUndo(page) {
	await page.evaluate(async () => {
		const editor = window.editor;
		const textLayer = editor.layerManager.layers.find((layer) => Boolean(layer.textData));
		if (!textLayer) {
			throw new Error('Could not find the text layer for the undo parity check');
		}

		textLayer.textData.text = 'Parity!';
		await editor.textGlitterManager.refreshLayer(textLayer, { saveHistory: true });
		await editor.undo();
	});
}

async function configureBasePixelEffects(page, paletteMode, { shimmer = false } = {}) {
	await page.evaluate(({ paletteMode, shimmer }) => {
		const editor = window.editor;
		const layer = editor.layerManager.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
		layer.background.mode = 'gradient';
		layer.background.gradient = normalizeEffectGradient({
			type: 'linear', angle: 28, interpolation: 'linear',
			stops: [{ offset: 0, color: '#18112d', alpha: 1 }, { offset: 0.48, color: '#e74672', alpha: 0.8 }, { offset: 1, color: '#f6d365', alpha: 1 }]
		});
		layer.background.colorAdjust = { hue: 18, saturation: 112, brightness: 94 };
		layer.background.opacity = 73;
		layer.background.pixelEffects = GlitterPixelEffects.normalizeSettings({
			pixelSize: 3,
			paletteMode,
			colorCount: 5,
			paletteStyle: 'balanced',
			mergeDistinctness: 0.045,
			detail: 4,
			cleanEdges: true,
			dither: {
				algorithm: 'halftone', angle: 35, strength: 88,
				palette: 'duotone', duotone: ['#120b24', '#ffd36a'], shimmer
			}
		}, CONFIG.tools.pixelEffects);
		editor.baseBackgroundManager.invalidatePixelEffects();
		editor.updatePreview();
		editor.saveState();
	}, { paletteMode, shimmer });
}

async function mutateBaseEffectAndUndo(page) {
	await page.evaluate(async () => {
		const editor = window.editor;
		const layer = editor.layerManager.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
		layer.background.pixelEffects.dither.angle = 137;
		editor.saveState();
		await editor.undo();
	});
}

async function verifyBasePreviewExportParity(page, label, frameIndex = 0) {
	const result = await page.evaluate(({ frameIndex }) => {
		const editor = window.editor;
		const layer = editor.layerManager.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
		const background = editor.baseBackgroundManager.normalizeLayer(layer).background;
		const width = editor.originalCanvas.width;
		const height = editor.originalCanvas.height;
		const source = editor.baseBackgroundManager.getBackgroundSourceImageData(background, width, height);
		const preview = editor.baseBackgroundManager.getPixelEffectImageData(source, width, height, background.pixelEffects, frameIndex);
		const previewFinished = new ImageData(new Uint8ClampedArray(preview.data), width, height);
		applyColorAdjustToImageData(previewFinished, background.colorAdjust);
		if (background.opacity < 100) {
			for (let offset = 3; offset < previewFinished.data.length; offset += 4) previewFinished.data[offset] = Math.round(previewFinished.data[offset] * background.opacity / 100);
		}
		const exported = editor.exporter._getBasePipelineImageData(layer, {
			width, height,
			originalData: new Uint8ClampedArray(editor.originalImageData.data),
			originalAlpha: editor.originalAlphaChannel,
			alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold
		}, frameIndex);
		for (let index = 0; index < exported.data.length; index++) {
			if (exported.data[index] !== previewFinished.data[index]) return { firstDiff: index };
		}
		return { firstDiff: -1 };
	}, { frameIndex });
	if (result.firstDiff !== -1) throw new Error(`${label} preview/export base pixels first differ at byte ${result.firstDiff}`);
}

async function verifyBaseStateRoundTrip(page) {
	const result = await page.evaluate(async () => {
		const editor = window.editor;
		const layer = editor.layerManager.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
		const serialized = editor.layerManager.serializeLayer(layer);
		const restored = await editor.layerManager.deserializeLayer(serialized);
		return {
			expected: JSON.stringify(layer.background.pixelEffects),
			actual: JSON.stringify(restored.background.pixelEffects)
		};
	});
	if (result.expected !== result.actual) throw new Error('Base Image pixelEffects changed during layer serialization');
}

function assertByteIdentity(reference, candidate, label) {
	const firstDiff = findFirstByteDiff(reference.bytes, candidate.bytes);
	if (firstDiff !== -1) {
		throw new Error(
			`${label} was not byte-identical (first differing byte ${firstDiff}, ` +
			`reference=${reference.hash}, candidate=${candidate.hash})`
		);
	}
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: VIEWPORT });
		try {
			await openEditor(page);
			await buildComposition(page);
			await verifyGradientStopLiveEditing(page);
			console.log('PASS Gradient stop controls survive repeated live edits');

			const matteSettings = {
				transparency: false,
				matteColor: '#ffffff'
			};
			const transparentSettings = {
				transparency: true,
				matteColor: '#ffffff'
			};

			const matteFirstBytes = await exportBytes(page, matteSettings);
			const matteSecondBytes = await exportBytes(page, matteSettings);
			const matteFirst = { bytes: matteFirstBytes, hash: hashBytes(matteFirstBytes) };
			const matteSecond = { bytes: matteSecondBytes, hash: hashBytes(matteSecondBytes) };

			assertByteIdentity(matteFirst, matteSecond, 'Back-to-back matte export');
			console.log(`PASS 1. Back-to-back matte exports matched exactly (${matteFirst.bytes.length} bytes, sha256 ${matteFirst.hash})`);

			const transparentFirstBytes = await exportBytes(page, transparentSettings);
			const transparentSecondBytes = await exportBytes(page, transparentSettings);
			const transparentFirst = { bytes: transparentFirstBytes, hash: hashBytes(transparentFirstBytes) };
			const transparentSecond = { bytes: transparentSecondBytes, hash: hashBytes(transparentSecondBytes) };

			assertByteIdentity(transparentFirst, transparentSecond, 'Back-to-back transparent export');
			console.log(`PASS 2. Back-to-back transparent exports matched exactly (${transparentFirst.bytes.length} bytes, sha256 ${transparentFirst.hash})`);

			await mutateTextAndUndo(page);

			const matteThirdBytes = await exportBytes(page, matteSettings);
			const matteThird = { bytes: matteThirdBytes, hash: hashBytes(matteThirdBytes) };
			assertByteIdentity(matteFirst, matteThird, 'Edit -> undo -> matte export');
			console.log(`PASS 3. Edit -> undo -> matte export matched the original (${matteThird.bytes.length} bytes, sha256 ${matteThird.hash})`);

			const transparentThirdBytes = await exportBytes(page, transparentSettings);
			const transparentThird = { bytes: transparentThirdBytes, hash: hashBytes(transparentThirdBytes) };
			assertByteIdentity(transparentFirst, transparentThird, 'Edit -> undo -> transparent export');
			console.log(`PASS 4. Edit -> undo -> transparent export matched the original (${transparentThird.bytes.length} bytes, sha256 ${transparentThird.hash})`);

			await configureBasePixelEffects(page, 'posterize');
			await verifyBasePreviewExportParity(page, 'Posterize');
			console.log('PASS Posterize preview/export base pixels matched exactly');
			const posterizeFirstBytes = await exportBytes(page, { ...matteSettings, baseImage: true });
			const posterizeSecondBytes = await exportBytes(page, { ...matteSettings, baseImage: true });
			const posterizeFirst = { bytes: posterizeFirstBytes, hash: hashBytes(posterizeFirstBytes) };
			const posterizeSecond = { bytes: posterizeSecondBytes, hash: hashBytes(posterizeSecondBytes) };
			assertByteIdentity(posterizeFirst, posterizeSecond, 'Back-to-back Posterize export');
			console.log(`PASS 5. Back-to-back Posterize exports matched exactly (${posterizeFirst.bytes.length} bytes, sha256 ${posterizeFirst.hash})`);

			await configureBasePixelEffects(page, 'dither', { shimmer: true });
			await verifyBaseStateRoundTrip(page);
			console.log('PASS Pixel-effect state survived Base Image serialization');
			await verifyBasePreviewExportParity(page, 'Shimmer', 3);
			console.log('PASS Shimmer preview/export base pixels matched exactly');
			const shimmerFirstBytes = await exportBytes(page, { ...matteSettings, baseImage: true });
			const shimmerSecondBytes = await exportBytes(page, { ...matteSettings, baseImage: true });
			const shimmerFirst = { bytes: shimmerFirstBytes, hash: hashBytes(shimmerFirstBytes) };
			const shimmerSecond = { bytes: shimmerSecondBytes, hash: hashBytes(shimmerSecondBytes) };
			assertByteIdentity(shimmerFirst, shimmerSecond, 'Back-to-back Shimmer export');
			console.log(`PASS 6. Back-to-back Shimmer exports matched exactly (${shimmerFirst.bytes.length} bytes, sha256 ${shimmerFirst.hash})`);

			await mutateBaseEffectAndUndo(page);
			const shimmerUndoBytes = await exportBytes(page, { ...matteSettings, baseImage: true });
			const shimmerUndo = { bytes: shimmerUndoBytes, hash: hashBytes(shimmerUndoBytes) };
			assertByteIdentity(shimmerFirst, shimmerUndo, 'Edit -> undo -> Shimmer export');
			console.log(`PASS 7. Edit -> undo -> Shimmer export matched the original (${shimmerUndo.bytes.length} bytes, sha256 ${shimmerUndo.hash})`);

			console.log('\nExport parity verification finished with all checks passing.');
		} finally {
			await page.close();
		}
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error?.stack || String(error));
	process.exit(1);
});
