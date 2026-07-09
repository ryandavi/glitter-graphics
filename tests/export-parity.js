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

		const textLayer = editor.textGlitterManager.createLayer({
			text: 'Parity',
			position: { x: 160, y: 154 },
			align: 'center'
		});
		editor.layerManager.insertLayer(textLayer);
		textLayer.selectedGlitterId = glitterA;
		textLayer.textData.fill = editor.textGlitterManager.getDefaultFill();
		textLayer.textData.fill.mode = 'glitter';
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
		shapeLayer.shapeData.fill.mode = 'glitter';
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

