'use strict';

const assert = require('assert');
const { chromium } = require('playwright');

(async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/', { waitUntil: 'networkidle' });
		await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach(node => node.classList.remove('visible')));
		await page.evaluate(() => window.editor.loadBlankImage(640, 480, '#ffffff'));
		await page.waitForFunction(() => window.editor.originalImage);
		const results = await page.evaluate(async () => {
			const e = window.editor;
			PREFERENCES.set('crispMaskEdges', true);
			const results = [];
			for (const type of [LayerType.TEXT_GLITTER, LayerType.SHAPE]) {
				const manager = getLayerManagerForType(e, type);
				const layer = type === LayerType.TEXT_GLITTER
					? manager.createLayer({ text: 'H', position: { x: 320, y: 240 } })
					: manager.createLayer({ shapeId: 'square', width: 80, height: 60, cornerRadiusPx: 12, position: { x: 320, y: 240 } });
				e.layerManager.insertLayer(layer);
				const data = layer.textData || layer.shapeData;
				data.fill.mode = 'glitter';
				data.fill.textureAnchor = 'canvas';
				data.border = getSlotDefaults(layer.type, 'border');
				data.border.mode = 'solid'; data.border.widthPx = 6;
				if (layer.textData) { data.fontId = 'impact'; data.fontSize = 80; await FontLibrary.ensureLoaded(data.fontId); }
				layer.transform.proportionalScale = false;
				for (const [edgeStyle, scale] of ['round', 'miter'].flatMap(style => [{ x: 200, y: 100 }, { x: 50, y: 150 }].map(scale => [style, scale]))) {
					data.border.edgeStyle = edgeStyle;
					layer.transform.scale = scale;
					manager.renderLayer(layer);
					await new Promise(resolve => setTimeout(resolve, 30));
					const masks = await manager.renderSlotMasks(layer);
					const wrapper = manager.layerElements.get(layer.id);
					const stack = wrapper.querySelector('.text-glitter-stack, .shape-glitter-stack');
					const fill = stack.querySelector('[data-span-key="fill"]');
					const bounds = canvas => {
						const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
						let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
						for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3]) {
							left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
						}
						return { left, top, right, bottom };
					};
					const body = bounds(masks.fill), outline = bounds(masks.border);
					const originX = parseFloat(fill.style.backgroundPosition);
					if (Math.abs(originX - (masks.renderWidth / 2 - layer.transform.position.x)) > 0.01) throw new Error(`${type} canvas texture uses logical instead of raster coordinates`);
					manager.updateTransform(layer.id, { position: { x: layer.transform.position.x + 23 } });
					if (Math.abs(parseFloat(fill.style.backgroundPosition) - originX + 23) > 0.01) throw new Error(`${type} canvas texture registration freezes during a move`);
					manager.updateTransform(layer.id, { position: { x: layer.transform.position.x - 23 } });
					const transform = new DOMMatrix(getComputedStyle(stack).transform);
					results.push({ type, scale, edgeStyle, texture: fill.style.backgroundSize, transform: [transform.a, transform.d],
						extent: [body.left - outline.left, outline.right - body.right, body.top - outline.top, outline.bottom - body.bottom],
						sizesMatch: parseFloat(fill.style.width) === masks.renderWidth && parseFloat(fill.style.height) === masks.renderHeight });
				}
				if (layer.textData) {
					layer.transform.scale = { x: 200, y: 100 };
					await manager.commitScale(layer);
					if (layer.transform.scale.x !== 200 || layer.transform.scale.y !== 100 || layer.transform.proportionalScale) throw new Error('Nonuniform scale or lock changed at commit');
					const settled = new DOMMatrix(getComputedStyle(manager.layerElements.get(layer.id).querySelector('.text-glitter-stack')).transform);
					if (settled.a !== 1 || settled.d !== 1) throw new Error('Committed text keeps stretching its texture through CSS');
				}
				e.layerManager.deleteLayer(layer.id, { skipHistory: true });
			}
			return results;
		});
		for (const result of results) {
			assert.strictEqual(result.texture, results.find(other => other.type === result.type).texture, `${result.type} changes tile size with object scale`);
			assert.deepStrictEqual(result.transform, [1, 1], `${result.type} stretches its raster texture`);
			assert(result.sizesMatch, `${result.type} preview/export raster sizes differ`);
			assert(result.extent.every(value => Math.abs(value - 6) <= 1), `${result.type} outline stretches or clips: ${JSON.stringify(result)}`);
		}
		const exported = await page.evaluate(async () => {
			const e = window.editor;
			const layer = e.textGlitterManager.createLayer({ text: 'H', position: { x: 320, y: 240 } });
			e.layerManager.insertLayer(layer);
			layer.textData.fontId = 'impact'; layer.textData.fontSize = 80;
			layer.textData.fill.mode = 'glitter';
			layer.textData.border = { ...getSlotDefaults(LayerType.TEXT_GLITTER, 'border'), mode: 'solid', color: '#ff00ff', widthPx: 6 };
			layer.transform.scale = { x: 200, y: 100 };
			layer.transform.proportionalScale = false;
			await e.textGlitterManager.refreshLayer(layer);
			e.setTool(ToolType.HAND); e.viewport.setZoom(1);
			const composed = await e.sceneCompositor.composeFrameAt({
				visibleLayers: [layer], glitterGifs: e.glitterLibrary.content,
				canvasData: { width: 640, height: 480, originalData: e.originalImageData.data, originalAlpha: e.originalAlphaChannel, hasBaseImage: false, alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold },
				exportSettings: { ...structuredClone(e.exportSettings), watermarkEnabled: false, transparency: false, baseImage: false },
				target: EXPORT_TARGETS['still:png'], timestamp: 0,
				callbacks: { onStatus: () => {}, onProgress: () => {}, isCancelled: () => false, renderSlotMasks: layer => getLayerManagerForType(e, layer.type).renderSlotMasks(layer), ensureTextFont: id => FontLibrary.ensureLoaded(id) }
			});
			const canvas = createAppCanvas(640, 480, 'test'); canvas.getContext('2d').putImageData(composed.imageData, 0, 0);
			return canvas.toDataURL();
		});
		await page.waitForTimeout(100);
		const preview = (await page.locator('#previewCanvas').screenshot()).toString('base64');
		const parity = await page.evaluate(async ({ preview, exported }) => {
			const bounds = async url => {
				const image = new Image(); image.src = url; await image.decode();
				const canvas = createAppCanvas(image.width, image.height, 'test'); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
				const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
				let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
				for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
					const i = (y * canvas.width + x) * 4;
					if (pixels[i] > 240 && pixels[i + 1] < 10 && pixels[i + 2] > 240) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
				}
				return [left, top, right, bottom];
			};
			return { preview: await bounds(`data:image/png;base64,${preview}`), exported: await bounds(exported) };
		}, { preview, exported });
		assert(parity.preview.every((value, index) => Number.isFinite(value) && Math.abs(value - parity.exported[index]) <= 1), `Scaled glitter text preview/export placement differs: ${JSON.stringify(parity)}`);
		await page.evaluate(async () => {
			const e = window.editor;
			const check = (condition, message) => { if (!condition) throw new Error(message); };
			for (const enabled of [false, true]) {
				PREFERENCES.set('scaleCorners', enabled);
				PREFERENCES.set('scaleEffects', enabled);
				const shape = e.shapeGlitterManager.createLayer({ shapeId: 'square', width: 80, height: 60, cornerRadiusPx: 12 });
				const text = e.textGlitterManager.createLayer({ text: 'Plate', fontSize: 64 });
				const frame = e.frameLayerManager.createLayer();
				for (const layer of [shape, text, frame]) e.layerManager.insertLayer(layer);
				frame.frameData.pinned = false;
				frame.locked = false;
				frame.frameData.width = 120; frame.frameData.height = 80; frame.frameData.radius = 10;
				const thickness = frame.frameData.widthPx;
				shape.shapeData.cornerRadiusPx = 12;
				shape.shapeData.effectDrafts = { border: { ...getSlotDefaults(LayerType.SHAPE, 'border'), widthPx: 8 } };
				shape.shapeData.sparkles = { ...buildDefaultSparkles(), sizeMin: 10, sizeMax: 16, spacing: 20 };
				text.textData.textBackground.enabled = true;
				Object.assign(text.textData.textBackground, { horizontalPadding: 10, verticalPadding: 6, cornerRadius: 8, mergeDistance: 4 });
				text.transform.scale = { x: 200, y: 200 };
				await e.textGlitterManager.commitScale(text);
				check(text.textData.fontSize === 128 && text.textData.textBackground.horizontalPadding === 20
					&& text.textData.textBackground.verticalPadding === 12 && text.textData.textBackground.cornerRadius === 16
					&& text.textData.textBackground.mergeDistance === 8, 'Text plate geometry must follow font size with effects on or off');
				shape.transform.scale = { x: 200, y: 200 };
				frame.transform.scale = { x: 200, y: 150 };
				e.layerManager.setSelection([shape.id, frame.id], { activeLayerId: shape.id });
				await e.groupTransformManager.commitScaledLayers(new Map([[shape.id, { x: 100, y: 100 }], [frame.id, { x: 100, y: 100 }]]));
				check(shape.shapeData.cornerRadiusPx === (enabled ? 24 : 12), 'Shape corners must follow Scale Corners');
				check(shape.shapeData.effectDrafts.border.widthPx === (enabled ? 16 : 8), 'Parked outlines must follow Scale Effects');
				check(shape.shapeData.sparkles.sizeMin === (enabled ? 20 : 10) && shape.shapeData.sparkles.sizeMax === (enabled ? 32 : 16)
					&& shape.shapeData.sparkles.spacing === (enabled ? 40 : 20), 'Sparkles must follow Scale Effects');
				check(frame.frameData.width === 240 && frame.frameData.height === 120 && frame.transform.scale.x === 100 && frame.transform.scale.y === 100,
					'Group resize must bake an unpinned frame');
				check(frame.frameData.widthPx === thickness && frame.frameData.radius === (enabled ? 20 : 10), 'Frame thickness stays in pixels and corners follow Scale Corners');
				scaleDocumentLayerState(shape, 2, 2, 2);
				check(shape.shapeData.cornerRadiusPx === (enabled ? 48 : 24), 'Document resize must always scale corners');
			}
		});
		assert.deepStrictEqual(errors, []);
		console.log('PASS scaled text and shape rasters preserve physical outlines, texture proportions, preview/export sizes, and unlocked text scale');
	} finally {
		await browser.close();
	}
})().catch(error => { console.error(error); process.exitCode = 1; });
