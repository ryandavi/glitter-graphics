'use strict';

const assert = require('assert');
const { chromium } = require('playwright');
const { exportBytes, hashBytes, assertByteIdentity } = require('./export-harness');

(async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/', { waitUntil: 'networkidle' });
		await page.evaluate(async () => {
			document.querySelectorAll('.modal-overlay.visible').forEach(node => node.classList.remove('visible'));
			await window.editor.loadBlankImage(480, 320, '#ffffff');
		});
		const checks = await page.evaluate(async () => {
			const e = window.editor;
			const check = (value, message) => { if (!value) throw new Error(message); };
			const bounds = canvas => {
				const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
				let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
				for (let row = 0; row < canvas.height; row++) for (let col = 0; col < canvas.width; col++) if (pixels[(row * canvas.width + col) * 4 + 3]) {
					x = Math.min(x, col); y = Math.min(y, row); right = Math.max(right, col); bottom = Math.max(bottom, row);
				}
				return { x, y, width: right - x + 1, height: bottom - y + 1 };
			};
			const source = createAppCanvas(100, 100, 'test');
			source.getContext('2d').fillRect(40, 30, 10, 20);
			source._shadowBounds = { x: 40, y: 30, width: 10, height: 20 };
			for (const [x, y] of [[0, 0], [15, 0], [0, -12], [-13, 17], [7, -3]]) {
				const mask = createExtrudedMaskCanvas(source, x, y);
				const actual = bounds(mask);
				const expected = getShadowSlotBounds(source._shadowBounds, { kind: 'extrude', offsetX: x, offsetY: y });
				check(JSON.stringify(actual) === JSON.stringify(expected), `Extrusion bounds ${x},${y}`);
				const pixels = mask.getContext('2d').getImageData(0, 0, 100, 100).data;
				for (let step = 0; step <= Math.max(Math.abs(x), Math.abs(y)); step++) {
					const fraction = step / (Math.max(Math.abs(x), Math.abs(y)) || 1);
					check(pixels[((40 + Math.round(y * fraction)) * 100 + 45 + Math.round(x * fraction)) * 4 + 3] === 255, 'Extrusion has a gap');
				}
			}
			const alpha = (canvas, x, y) => canvas.getContext('2d').getImageData(x, y, 1, 1).data[3];
			const sourceBefore = source.toDataURL();
			for (const lean of [-12, 0, 12]) {
				const cast = createShadowSlotMaskCanvas(source, { kind: 'cast', castLength: 10, castLean: lean, offsetX: 6, offsetY: 6, spread: 9, blur: 0 });
				const box = bounds(cast);
				check(box.y === 40 && box.height === 10 && box.x >= 40 + Math.min(0, lean) && box.x + box.width <= 50 + Math.max(0, lean), 'Cast must flatten above its fixed bottom edge');
				check(alpha(cast, 45, 49) === 255 && alpha(cast, 45, 30) === 0, 'Cast must stay attached at the baseline without filling an extrusion');
				check(source.toDataURL() === sourceBefore, 'Cast must leave the source text unchanged');
				check(cast.toDataURL() !== createExtrudedMaskCanvas(source, lean, 10).toDataURL(), 'Cast must differ from Extrude');
			}
			const sharpCast = createShadowSlotMaskCanvas(source, { kind: 'cast', castLength: 10, castLean: 0 });
			const softCast = createShadowSlotMaskCanvas(source, { kind: 'cast', castLength: 10, castLean: 0, blur: 4 });
			check(softCast.toDataURL() === createShadowMaskCanvas(sharpCast, 0, 4).toDataURL(), 'Cast blur must apply after projection');
			check(alpha(softCast, 38, 45) > 0 && alpha(softCast, 38, 45) < 255, 'Cast blur must create a soft edge');
			source._shadowBounds.baseline = 45;
			const baselineCast = createShadowSlotMaskCanvas(source, { kind: 'cast', castLength: 10, castLean: 0, castAnchor: 'baseline' });
			check(bounds(baselineCast).y === 35 && alpha(baselineCast, 45, 47) === 255, 'Baseline anchoring must project descenders below the floor');
			check(baselineCast.toDataURL() !== sharpCast.toDataURL(), 'Baseline and Bottom edge must use distinct floors');
			delete source._shadowBounds.baseline;
			const emptyCast = createShadowSlotMaskCanvas(source, { kind: 'cast', castLength: 0, castLean: 50 });
			check(!Number.isFinite(bounds(emptyCast).x), 'Zero length must paint no cast even with lean');
			const ring = createAppCanvas(100, 100, 'test');
			const ringCtx = ring.getContext('2d');
			ringCtx.fillRect(20, 20, 60, 60); ringCtx.clearRect(30, 30, 40, 40);
			ring._shadowBounds = { x: 20, y: 20, width: 60, height: 60 };
			const ringCast = createShadowSlotMaskCanvas(ring, { kind: 'cast', castLength: 30, castLean: 0 });
			check(alpha(ringCast, 50, 65) === 0 && alpha(ringCast, 22, 52) === 255 && alpha(ringCast, 50, 78) === 255, 'Floor projection must preserve the silhouette counters');

			const text = e.textGlitterManager.createLayer({ text: 'Block', position: { x: 140, y: 95 } });
			text.textData.fontId = 'impact'; text.textData.fontSize = 54;
			text.textData.warp = { type: 'rise', bend: 35 };
			await FontLibrary.ensureLoaded('impact');
			check(e.textGlitterManager.getDefaultShadow().castAnchor === 'baseline' && e.shapeGlitterManager.getDefaultShadow().castAnchor === 'bottom', 'Text defaults to Baseline; other artwork to Bottom edge');
			const originalWarp = text.textData.warp;
			text.textData.warp = { type: 'none', bend: 0 };
			text.textData.text = 'H';
			const floorForText = () => {
				const canvas = e.textGlitterManager.getMeasurementEntry(text).canvas;
				return canvas._shadowBounds.baseline - canvas._textureOrigin.y;
			};
			const noDescenderFloor = floorForText();
			text.textData.text = 'Hgpy';
			check(floorForText() === noDescenderFloor, 'Descenders must not move the typographic baseline');
			text.textData.text = 'H\nHgpy';
			check(floorForText() > noDescenderFloor, 'Multiline Cast must anchor to the last ink line');
			text.textData.text = 'Block'; text.textData.warp = originalWarp;
			const shape = e.shapeGlitterManager.createLayer({ shapeId: 'heart', width: 65, height: 55, position: { x: 330, y: 80 } });
			const glitter = e.glitterManager.createLayer();
			e.layerManager.insertLayer(glitter);
			const paint = e.paintMaskStore.ensurePaintMask(glitter.id);
			paint.add.getContext('2d').fillRect(110, 190, 60, 40);
			paint.hasContent = true; paint.liveRevision++; glitter.maskHasContent = true;
			e.paintMaskStore.commitPaintState(glitter);
			const asset = e.stickerManager.content.find(item => item.isAnimated);
			check(asset, 'Animated sticker fixture missing');
			const sticker = e.stickerManager.createLayer(asset.id);
			sticker.transform.position = { x: 325, y: 215 };
			const entries = [
				{ layer: text, manager: e.textGlitterManager, data: text.textData, prefix: 'textShadow' },
				{ layer: shape, manager: e.shapeGlitterManager, data: shape.shapeData, prefix: 'shapeShadow' },
				{ layer: glitter, manager: e.glitterManager, data: glitter, prefix: 'glitterShadow' },
				{ layer: sticker, manager: e.stickerManager, data: sticker.stickerData, prefix: 'stickerShadow' }
			];
			for (const entry of entries) {
				const { layer, manager, data, prefix } = entry;
				if (layer !== glitter) e.layerManager.insertLayer(layer);
				data.shadow = { ...manager.getDefaultShadow(), mode: 'solid', color: '#663399', offsetX: -17, offsetY: 13 };
				if (data.fill) { data.fill.mode = 'solid'; data.fill.color = '#ffcc00'; }
				e.layerManager.setActiveLayer(layer.id);
				for (const kind of ['drop', 'cast', 'extrude']) {
					document.getElementById(prefix + 'Kind' + kind[0].toUpperCase() + kind.slice(1)).click();
					await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
					check(data.shadow.kind === kind, prefix + ' Type binding');
					check(document.getElementById(prefix + 'CastLength').closest('.property-row').hidden === (kind !== 'cast'), prefix + ' cast controls visibility');
					check(document.getElementById(prefix + 'Blur').closest('.property-row').hidden === (kind === 'cast' && layer === text), prefix + ' blur units must match shadow kind');
					for (const suffix of ['OffsetRow', 'Spread']) check(document.getElementById(prefix + suffix).closest('.property-row').hidden === (kind === 'cast'), prefix + ' must expose only cast distances');
					if (kind === 'cast') {
						if (layer === text) {
							check(!document.getElementById(prefix + 'CastAnchorRow').hidden, 'Cast Anchor must be visible on text');
							for (const anchor of ['bottom', 'baseline']) {
								document.getElementById(prefix + 'CastAnchor' + anchor[0].toUpperCase() + anchor.slice(1)).click();
								check(data.shadow.castAnchor === anchor, 'Cast Anchor binding');
							}
						}
						for (const [suffix, value, key] of [['CastLength', 65, 'castLength'], ['CastLean', 25, 'castLean']]) {
							const control = document.getElementById(prefix + suffix);
							writeSliderValue(control, value);
							control.dispatchEvent(new Event('input', { bubbles: true }));
							await flushLiveApply(control.id);
							check(data.shadow[layer === text ? key + 'Ratio' : key] === (layer === text ? value / 100 : value), prefix + ' ' + suffix + ' binding');
						}
						if (layer === text) { data.shadow.castLengthRatio = FIELDS.textCastLength.value / 100; data.shadow.castLeanRatio = FIELDS.textCastLean.value / 100; }
						else { data.shadow.castLength = FIELDS.shadowCastLength.value; data.shadow.castLean = -45; }
					}
					const item = buildSlotStack(layer, () => ({ type: 'solid', color: '#000000' })).find(item => item.role === 'shadow');
					check(item.offsetX === (kind === 'drop' ? -17 : 0), prefix + ' offset applied twice');
					const restored = await e.layerManager.deserializeLayer(e.layerManager.serializeLayer(layer));
					const restoredData = restored.textData || restored.shapeData || restored.stickerData || restored;
					check(restoredData.shadow.kind === kind && (layer === text ? restoredData.shadow.castLengthRatio === FIELDS.textCastLength.value / 100 : restoredData.shadow.castLength === FIELDS.shadowCastLength.value) && restoredData.shadow.castAnchor === data.shadow.castAnchor, prefix + ' persistence');
					if (layer === sticker) {
						const scale = layer.transform.scale;
						const width = Math.max(1, Math.round(data.width * Math.abs(scale.x) / 100));
						const height = Math.max(1, Math.round(data.height * Math.abs(scale.y) / 100));
						const pad = manager.getEffectPadding(layer);
						const box = { x: pad, y: pad, width, height };
						const reach = getShadowSlotBounds(box, data.shadow);
						const offset = getShadowSlotOffset(data.shadow);
						reach.x -= offset.x; reach.y -= offset.y;
						check(reach.x >= 0 && reach.y >= 0 && reach.x + reach.width <= width + pad * 2 && reach.y + reach.height <= height + pad * 2, 'Sticker effect pad clips ' + kind);
						continue;
					}
					for (const scale of [{ x: 100, y: 100 }, { x: 160, y: 75 }]) {
						layer.transform.scale = scale;
						const masks = await manager.renderSlotMasks(layer);
						const box = bounds(masks.shadow);
						check(box.x > 0 && box.y > 0 && box.x + box.width < masks.renderWidth && box.y + box.height < masks.renderHeight, prefix + ' clipped ' + kind);
						if (layer === glitter) continue;
						const measurement = manager.getMeasurementEntry(layer);
						const preview = (layer === shape ? manager.getSlotMask(measurement, item, layer) : manager.getSlotMask(layer, measurement, item)).canvas;
						const offset = getShadowSlotOffset(data.shadow);
						const expected = createOffsetMaskCanvas(preview, offset.x, offset.y);
						check(expected.toDataURL() === masks.shadow.toDataURL(), prefix + ' preview/export mask diverged');
					}
				}
				if (layer === text || layer === shape) {
					data.shadow.kind = 'cast';
					if (layer === text) data.shadow.castLengthRatio = 2; else data.shadow.castLength = 200;
					data.shadow.spread = 8; data.shadow.blur = 5;
					for (const lean of [-200, 200]) {
						if (layer === text) data.shadow.castLeanRatio = lean / 100; else data.shadow.castLean = lean;
						const masks = await manager.renderSlotMasks(layer);
						const box = bounds(masks.shadow);
						check(box.x > 0 && box.y > 0 && box.x + box.width < masks.renderWidth && box.y + box.height < masks.renderHeight, prefix + ' extreme cast clipped');
					}
					data.shadow.spread = 0; data.shadow.blur = 0;
				}
				if (layer === text) {
					data.shadow.kind = 'cast'; data.shadow.castLengthRatio = 0.25; data.shadow.castLeanRatio = -0.7; data.shadow.castBlurRatio = 0.0625;
					const originalFontSize = data.fontSize;
					const originalWarp = data.warp;
					data.warp = { type: 'none', bend: 0 };
					const ratios = () => JSON.stringify([data.shadow.castLengthRatio, data.shadow.castLeanRatio, data.shadow.castBlurRatio]);
					const stored = ratios();
					for (const fontSize of [32, 64, 128]) for (const scale of [{ x: 50, y: 50 }, { x: 100, y: 100 }, { x: 200, y: 200 }, { x: 160, y: 75 }]) {
						data.fontSize = fontSize; layer.transform.scale = scale;
						const measurement = getRasterMeasurement(layer, manager.getMeasurementEntry(layer));
						const box = measurement.canvas._shadowBounds;
						const projection = getCastShadowProjection(data.shadow, box);
						check(Math.abs(projection.length / (fontSize * scale.y / 100) - 0.25) < 1e-9, 'Cast depth must scale with font size and vertical transform');
						check(Math.abs(projection.lean / (fontSize * scale.x / 100) + 0.7) < 1e-9, 'Cast lean must scale with horizontal transform');
						check(Math.abs(getCastShadowBlur(box, data.shadow) / (fontSize * Math.sqrt(scale.x * scale.y) / 100) - 0.0625) < 1e-9, 'Cast softness must scale with text');
						const masks = await manager.renderSlotMasks(layer);
						const painted = bounds(masks.shadow);
						check(painted.x > 0 && painted.y > 0 && painted.x + painted.width < masks.renderWidth && painted.y + painted.height < masks.renderHeight, 'Scaled relative cast clips');
					}
					const scaleEffects = PREFERENCES.get('scaleEffects');
					for (const enabled of [false, true]) {
						PREFERENCES.set('scaleEffects', enabled);
						data.fontSize = 64; layer.transform.scale = { x: 200, y: 200 };
						await manager.commitScaleToFontSize(layer);
						check(data.fontSize === 128 && ratios() === stored, 'Bake to font size must preserve cast proportions regardless of Scale Effects');
						const serialized = e.layerManager.serializeLayer(layer);
						const resized = await e.layerManager.deserializeLayer(serialized);
						scaleDocumentLayerState(resized, 0.5, 0.5, 0.5, { scaleEffects: enabled });
						check(resized.textData.fontSize === 64 && resized.textData.shadow.castLengthRatio === 0.25 && resized.textData.shadow.castBlurRatio === 0.0625, 'Document scaling must not double-scale cast ratios');
					}
					PREFERENCES.set('scaleEffects', scaleEffects);
					const legacy = e.layerManager.serializeLayer(layer);
					legacy.textData.fontSize = 64; legacy.transform.scale = { x: 200, y: 100 };
					delete legacy.textData.shadow.castLengthRatio; delete legacy.textData.shadow.castLeanRatio; delete legacy.textData.shadow.castBlurRatio;
					Object.assign(legacy.textData.shadow, { castLength: 16, castLean: -45, blur: 4 });
					const restored = await e.layerManager.deserializeLayer(legacy);
					check(restored.textData.shadow.castLengthRatio === 0.25 && restored.textData.shadow.castLeanRatio === -45 / 128 && restored.textData.shadow.castBlurRatio === 4 / Math.sqrt(64 * 128), 'Legacy pixel casts must keep their current appearance on load');
					data.fontSize = originalFontSize; data.warp = originalWarp;
					layer.transform.scale = { x: 160, y: 75 };
				}
				data.shadow.kind = layer === sticker || layer === shape || layer === text ? 'cast' : 'extrude';
				data.shadow.castLength = 70; data.shadow.castLean = -30;
				data.shadow.blur = data.shadow.kind === 'cast' ? 4 : 0;

			}
			e.saveState('Shadow fixture');
			e.requestPreviewUpdate();
			window.__shadowTextId = text.id;
			return 'PASS shadow sweep, baseline-anchored floor projection, all four Type controls, persistence, bounds and scaled preview/export masks';
		});
		console.log(checks);
		for (const transparency of [false, true]) {
			const bytes = await exportBytes(page, { transparency, maxFrames: 4 });
			const reference = { bytes, hash: hashBytes(bytes) };
			const again = await exportBytes(page, { transparency, maxFrames: 4 });
			assertByteIdentity(reference, { bytes: again, hash: hashBytes(again) }, 'Shadow repeated export');
			await page.evaluate(async () => {
				const e = window.editor;
				const layer = e.layers.find(layer => layer.id === window.__shadowTextId);
				layer.textData.shadow.offsetX -= 9;
				e.saveState('Edit extrusion');
				await e.undo();
			});
			const afterUndo = await exportBytes(page, { transparency, maxFrames: 4 });
			assertByteIdentity(reference, { bytes: afterUndo, hash: hashBytes(afterUndo) }, 'Shadow edit/undo export');
			console.log(`PASS ${transparency ? 'transparent' : 'matte'} shadows with animated sticker: repeated and edit/undo exports byte-identical`);
		}
		assert.deepStrictEqual(errors, []);
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
