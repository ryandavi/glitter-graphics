'use strict';
const { chromium } = require('playwright');
const { assertByteIdentity, exportSnapshot } = require('./export-harness');
async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/', { waitUntil: 'networkidle' });
		await page.waitForFunction(() => Boolean(window.editor));
		const result = await page.evaluate(async () => {
			const editor = window.editor;
			await editor.loadBlankImage(80, 60, '#ffffff');
			const manager = editor.stickerManager;
			const indexedSlice = manager.content.find((asset) => asset.sliced);
			if (!indexedSlice) throw new Error('Stretchable metadata missing from the loaded browse index');
			await manager.ensureAssetDetails(indexedSlice.id);
			const pickedSlice = manager.createLayer(indexedSlice.id);
			if (!pickedSlice.stickerData.slice || pickedSlice.stickerData.sliceEnabled !== true) throw new Error('Lazy asset details must copy slices and enable Smart Stretch');

			const domExpected = [];
			const layer = manager.createLayer();
			layer.stickerData = { ...layer.stickerData, isEmpty: false, width: 12, height: 10, isPixelated: true, slice: { top: 2, right: 3, bottom: 2, left: 3, mode: 'stretch' }, sliceEnabled: true };
			layer.transform.scale = { x: 300, y: 200 };
			layer.transform.position = { x: 40, y: 30 };
			const source = document.createElement('canvas');
			source.width = 12; source.height = 10;
			const sourceCtx = source.getContext('2d');
			const compare = (a, b, label) => {
				const aa = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
				const bb = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
				if (aa.length !== bb.length || aa.some((v, i) => v !== bb[i])) throw new Error(label);
			};
			for (const mode of ['stretch', 'round']) {
				layer.stickerData.slice.mode = mode;
				for (const color of ['#ff3355', '#33ccff']) {
					sourceCtx.clearRect(0, 0, 12, 10);
					sourceCtx.fillStyle = color;
					sourceCtx.fillRect(0, 0, 12, 10);
					sourceCtx.clearRect(3, 2, 6, 6);
					layer.stickerData.url = source.toDataURL();
					const img = new Image(); img.src = layer.stickerData.url; await img.decode();
					const element = document.createElement('div'); element.appendChild(img);
					manager.reconcileSliceSpans(layer, element, img);
					const spans = element.querySelectorAll('.sticker-slice');
					const rects = manager.getSliceRects(layer, 12, 10, 36, 20);
					if (spans.length !== rects.length || img.style.display !== 'none') throw new Error('Preview slice reconciliation');
					const preview = document.createElement('canvas'); preview.width = 36; preview.height = 20;
					preview.getContext('2d').imageSmoothingEnabled = false;
					manager.drawStickerImage(preview.getContext('2d'), img, layer, 36, 20);
					layer.stickerData.staticImageData = sourceCtx.getImageData(0, 0, 12, 10);
					const output = document.createElement('canvas'); output.width = 80; output.height = 60;
					const scratch = { sourceCanvas: document.createElement('canvas'), unionFrameCanvas: document.createElement('canvas') };
					editor.sceneCompositor._renderLayerToCanvas(layer, output.getContext('2d'), 0, null, null, scratch);
					const crop = document.createElement('canvas'); crop.width = 36; crop.height = 20;
					crop.getContext('2d').drawImage(output, 22, 20, 36, 20, 0, 0, 36, 20);
					compare(preview, crop, `${mode} sticker preview/export pixels`);
					if (color === '#ff3355') {
						element.id = `nine-slice-dom-${mode}`;
						Object.assign(element.style, { position: 'fixed', left: '0px', top: '0px', width: '36px', height: '20px', background: '#fff', zIndex: '999999', imageRendering: 'pixelated', isolation: 'isolate' });
						element.querySelectorAll('.sticker-slice').forEach((span) => Object.assign(span.style, { position: 'absolute', zIndex: '2', backgroundRepeat: 'no-repeat' }));
						document.body.appendChild(element);
						const expected = document.createElement('canvas'); expected.width = 36; expected.height = 20;
						expected.getContext('2d').fillStyle = '#fff'; expected.getContext('2d').fillRect(0,0,36,20);
						expected.getContext('2d').drawImage(preview, 0, 0);
						domExpected.push({ mode, src: expected.toDataURL() });
					}

					if (typeof getFrameSliceRects === 'function') {
						const frame = document.createElement('canvas'); frame.width = 36; frame.height = 20;
						frame.getContext('2d').imageSmoothingEnabled = false;
						drawFrameImage(frame.getContext('2d'), source, { image: { width: 12, height: 10, slice: layer.stickerData.slice, isPixelated: true }, fit: 'slice', sliceScale: 200 }, 36, 20);
						compare(preview, frame, 'Frame and sticker slice geometry parity');
					}

					if (mode === 'stretch' && color === '#ff3355') {
						const compositor = editor.sceneCompositor;
						const originalFill = compositor._renderFilledMaskInto;
						const originalDraw = compositor._drawTransformedCanvas;
						for (const effect of ['border', 'shadow', 'bevel']) {
							layer.stickerData.border = effect === 'border' ? { ...manager.getDefaultBorder(), mode: 'solid', color: '#ffffff', widthPx: 2 } : null;
							layer.stickerData.shadow = effect === 'shadow' ? { ...manager.getDefaultShadow(), mode: 'solid', color: '#ffffff', spread: 1, blur: 1 } : null;
							layer.stickerData.bevel = manager.getDefaultBevel();
							if (effect === 'bevel') { layer.stickerData.bevel.enabled = true; layer.stickerData.bevel.highlight.mode = 'solid'; layer.stickerData.bevel.shade.mode = 'solid'; }
							manager.reconcileStickerEffectSpans(layer, element, img);
							const exported = [];
							compositor._renderFilledMaskInto = (_target, mask) => {
								const copy = document.createElement('canvas'); copy.width = mask.width; copy.height = mask.height;
								copy.getContext('2d').drawImage(mask, 0, 0); exported.push(copy);
							};
							compositor._drawTransformedCanvas = () => {};
							const effectScratch = { shadowMaskCanvas: document.createElement('canvas'), shadowFillCanvas: document.createElement('canvas') };
							effectScratch.shadowMaskCtx = effectScratch.shadowMaskCanvas.getContext('2d');
							compositor._renderStickerEffects(layer, output.getContext('2d'), preview, 0, null, null, effectScratch, effect === 'bevel' ? 'front' : 'behind');
							compositor._renderFilledMaskInto = originalFill;
							compositor._drawTransformedCanvas = originalDraw;
							const spans = Array.from(element.querySelectorAll('.sticker-effect-layer'));
							for (let index = 0; index < spans.length; index++) {
								const maskImg = new Image(); maskImg.src = spans[index].style.maskImage.slice(4, -1).replace(/^"|"$/g, ''); await maskImg.decode();
								const expected = exported[index * 2 + 1] || exported[index];
								const actual = document.createElement('canvas'); actual.width = expected.width; actual.height = expected.height;
								actual.getContext('2d').drawImage(maskImg, (expected.width - maskImg.width) / 2, (expected.height - maskImg.height) / 2);
								const aa = actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data;
								const bb = expected.getContext('2d').getImageData(0,0,expected.width,expected.height).data;
								for(let pixel=3;pixel<aa.length;pixel+=4) if(Math.abs(aa[pixel]-bb[pixel])>1) throw new Error(`${effect} effect mask parity at ${pixel}: ${aa[pixel]} vs ${bb[pixel]}`);
							}
						}
						layer.stickerData.border = null; layer.stickerData.shadow = null; layer.stickerData.bevel = manager.getDefaultBevel();
					}
					const again = document.createElement('canvas'); again.width = 80; again.height = 60;
					editor.sceneCompositor._renderLayerToCanvas(layer, again.getContext('2d'), 0, null, null, scratch);
					compare(output, again, 'Repeated export must be stable');
					layer.stickerData.isAnimated = true;
					editor.sceneCompositor.decodedSources.set(layer.stickerData.url, { frames: [{ imageData: layer.stickerData.staticImageData }] });
					const animated = document.createElement('canvas'); animated.width = 80; animated.height = 60;
					editor.sceneCompositor._renderLayerToCanvas(layer, animated.getContext('2d'), 0, null, new Map([[layer.id, [layer.stickerData.staticImageData]]]), scratch);
					compare(output, animated, 'Animated frame slicing');
					layer.stickerData.isAnimated = false;
				}
			}
			document.querySelectorAll('[id^="nine-slice-dom-"] .sticker-effect-layer').forEach((node) => node.remove());
			return { message: 'Stretch/round sticker masks, animated frames, and repeated exports passed', domExpected };
		});
		console.log(result.message);
		for (const fixture of result.domExpected) {
			await page.evaluate((mode) => {
				document.querySelectorAll('[id^="nine-slice-dom-"]').forEach((node) => { node.style.visibility = node.id === `nine-slice-dom-${mode}` ? 'visible' : 'hidden'; });
			}, fixture.mode);
			const png = await page.locator(`#nine-slice-dom-${fixture.mode}`).screenshot();
			await page.evaluate(async ({ png, expected, mode }) => {
				const read = async (src) => {
					const image = new Image(); image.src = src; await image.decode();
					const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
					canvas.getContext('2d').drawImage(image, 0, 0);
					return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
				};
				const actual = await read(png), reference = await read(expected);
				if (actual.length !== reference.length || actual.some((byte,index) => Math.abs(byte-reference[index])>1)) throw new Error(`${mode} rendered DOM pixels differ from export`);
			}, { png: `data:image/png;base64,${png.toString('base64')}`, expected: fixture.src, mode: fixture.mode });
		}
		console.log('PASS rendered DOM stretch/round pixels match compositor');
		await page.evaluate(async () => {
			const editor = window.editor;
			document.querySelectorAll('[id^="nine-slice-dom-"]').forEach((node) => node.remove());
			const item = editor.stickerManager.content.find((entry) => entry.isAnimated);
			if (!item) throw new Error('An animated library sticker is required');
			await editor.stickerManager.ensureAssetDetails(item.id);
			const layer = editor.stickerManager.createLayer(item.id);
			const data = layer.stickerData;
			data.slice = normalizeSlice({ top: Math.max(1,Math.floor(data.height/4)), right: Math.max(1,Math.floor(data.width/4)), bottom: Math.max(1,Math.floor(data.height/4)), left: Math.max(1,Math.floor(data.width/4)), mode: 'stretch' }, data.width, data.height);
			data.sliceEnabled = true;
			layer.transform.scale = { x: 64 / data.width * 100, y: 32 / data.height * 100 };
			layer.transform.position = { x: 40, y: 30 };
			editor.layerManager.insertLayer(layer);
			editor.stickerManager.renderLayer(layer);
			editor.requestPreviewUpdate();
			editor.saveState('Sliced animated fixture');
		});
		const settings = { maxFrames: 4, transparency: true };
		const reference = await exportSnapshot(page, settings, { minLayers: 1 });
		const encodedFrames = await page.evaluate(async (bytes) => {
			const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/gif' }));
			try { return (await decodeGifFromUrl(url)).frames.length; }
			finally { URL.revokeObjectURL(url); }
		}, reference.bytes);
		if (encodedFrames < 2) throw new Error('Animated sliced export must contain multiple frames');
		const repeated = await exportSnapshot(page, settings, { minLayers: 1 });
		assertByteIdentity(reference, repeated, 'Repeated sliced animated GIF');
		await page.evaluate(async () => {
			const editor = window.editor;
			const layer = editor.layerManager.layers.find((entry) => entry.type === LayerType.STICKER);
			layer.stickerData.sliceEnabled = false;
			editor.stickerManager.renderLayer(layer);
			editor.saveState('Toggle Smart Stretch');
			await editor.undo();
		});
		const restored = await exportSnapshot(page, settings, { minLayers: 1 });
		assertByteIdentity(reference, restored, 'Animated GIF after Smart Stretch edit/undo');
		console.log(`PASS real animated sliced GIF repeated exports and edit/undo (${encodedFrames} frames, ${reference.bytes.length} bytes)`);
		await page.evaluate(async () => {
			const editor = window.editor;
			const manager = editor.frameLayerManager;
			const source = document.createElement('canvas'); source.width = 12; source.height = 10;
			const ctx = source.getContext('2d'); ctx.fillStyle = '#ff3355'; ctx.fillRect(0, 0, 12, 10); ctx.clearRect(3, 2, 6, 6);
			const url = source.toDataURL();
			const image = new Image(); image.src = url; await image.decode();
			manager.hitImages.set(url, image);
			const frame = manager.createLayer();
			frame.frameData = { ...frame.frameData, kind: 'image', fit: 'slice', inset: 2, sliceScale: 200,
				image: { url, baseUrl: url, width: 12, height: 10, name: 'Sliced frame', isPixelated: true,
					variantUrls: { 24: 'frame-24.png' }, slice: { top: 2, right: 3, bottom: 2, left: 3, mode: 'stretch' } } };
			editor.layerManager.insertLayer(frame);
			manager.renderLayer(frame);
			const wrapper = manager.layerElements.get(frame.id);
			const spans = Array.from(wrapper.querySelectorAll('.frame-layer-image'));
			if (spans.length !== 9) throw new Error('Pinned frame must render nine slice spans');
			manager.renderLayer(frame);
			if (spans.some((span, index) => wrapper.querySelectorAll('.frame-layer-image')[index] !== span)) throw new Error('Frame rerender recreated slice spans');
			if (frame.frameData.width !== 76 || frame.frameData.height !== 56) throw new Error('Pinned frame inset geometry');
			if (!manager.hitTest(frame, 3, 3) || manager.hitTest(frame, 40, 30)) throw new Error('Frame hit alpha must pick its border and pass through its center');
			const serialized = editor.layerManager.serializeLayer(frame);
			const restored = await editor.layerManager.deserializeLayer(serialized);
			if (restored.frameData.sliceScale !== 200 || restored.frameData.image.width !== 12 || restored.frameData.image.height !== 10
				|| restored.frameData.image.baseUrl !== url || restored.frameData.image.variantUrls[24] !== 'frame-24.png'
				|| JSON.stringify(restored.frameData.image.slice) !== JSON.stringify(frame.frameData.image.slice)) throw new Error('Frame serialization lost slice scale or asset metadata');
			serialized.frameData.image.slice.left = 1;
			if (frame.frameData.image.slice.left !== 3 || restored.frameData.image.slice.left !== 3) throw new Error('Serialized frame slice aliases live metadata');
			editor.resizeCanvas(120, 90, 20, 15);
			manager.renderLayer(frame);
			if (frame.frameData.width !== 116 || frame.frameData.height !== 86 || frame.transform.position.x !== 60 || frame.transform.position.y !== 45) throw new Error('Pinned sliced frame did not follow canvas resize');
			if (spans.some((span, index) => wrapper.querySelectorAll('.frame-layer-image')[index] !== span)) throw new Error('Canvas resize recreated frame slice spans');
			const rects = getFrameSliceRects(frame.frameData, 12, 10, 116, 86);
			if (rects[0].dw !== 6 || rects[0].dh !== 4 || spans[0].style.width !== '6px' || spans[0].style.height !== '4px') throw new Error('Canvas resize changed frame border scale');
			if (!manager.hitTest(frame, 3, 3) || manager.hitTest(frame, 60, 45)) throw new Error('Resized frame alpha picking did not follow new geometry');
		});
		console.log('PASS sliced frame resize, serialization, alpha picking, and stable preview spans');
	} finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
