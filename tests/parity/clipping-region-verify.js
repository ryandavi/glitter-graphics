'use strict';

const assert = require('assert');
const { openApp } = require('../lib/app');
const { exportSnapshot, assertByteIdentity } = require('./export-harness');

async function pixels(page, url) {
	return page.evaluate(async url => {
		const image = new Image(); image.src = url; await image.decode();
		const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
		const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
		return { width: canvas.width, height: canvas.height, data: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data) };
	}, url);
}

async function compare(page, label, timestamp = 0) {
	const exported = await page.evaluate(async timestamp => {
		const result = await editor.sceneCompositor.composeFrameAt({ ...editor.getSceneSnapshotParams(editor.layers), timestamp });
		const canvas = document.createElement('canvas'); canvas.width = result.imageData.width; canvas.height = result.imageData.height;
		canvas.getContext('2d').putImageData(result.imageData, 0, 0); return canvas.toDataURL();
	}, timestamp);
	await page.waitForFunction(() => !editor.clipPreview || [...editor.clipPreview.entries.values()].every(entry => entry.url && !entry.pending));
	await page.waitForTimeout(150);
	const clip = await page.evaluate(() => { const r = editor.previewCanvas.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
	const preview = `data:image/png;base64,${(await page.screenshot({ clip })).toString('base64')}`;
	const a = await pixels(page, exported), b = await pixels(page, preview);
	assert.strictEqual(b.width, a.width, `${label}: preview width`);
	assert.strictEqual(b.height, a.height, `${label}: preview height`);
	let checked = 0, differing = 0, max = 0;
	for (let y = 2; y < a.height - 2; y++) for (let x = 2; x < a.width - 2; x++) {
		const offset = (y * a.width + x) * 4;
		// Fractional mask edges and font rasterization are checked by the mask suites.
		if (![-2, -1, 0, 1, 2].every(dy => [-2, -1, 0, 1, 2].every(dx => [0, 1, 2, 3].every(channel => a.data[offset + channel] === a.data[offset + (dy * a.width + dx) * 4 + channel])))) continue;
		checked++;
		const error = Math.max(...[0, 1, 2].map(channel => Math.abs(a.data[offset + channel] - b.data[offset + channel])));
		max = Math.max(max, error); if (error > 3) differing++;
	}
	assert(checked > 1000, `${label}: insufficient interior coverage`);
	if (differing) {
		const fs = require('fs'); fs.mkdirSync('.tmp/clipping', { recursive: true });
		fs.writeFileSync('.tmp/clipping/export.png', Buffer.from(exported.split(',')[1], 'base64'));
		fs.writeFileSync('.tmp/clipping/preview.png', Buffer.from(preview.split(',')[1], 'base64'));
	}
	assert(differing === 0, `${label}: ${differing}/${checked} interior pixels differ, max=${max}`);
	process.stdout.write(`PASS ${label}: ${checked} interior pixels\n`);
}

async function main() {
	const { browser, page, errors } = await openApp({ document: { width: 180, height: 140 } });
	try {
		for (const baseKind of ['shape', 'text', 'sticker']) for (const contentKind of ['sticker', 'fill', 'text']) {
			await page.evaluate(async ({ baseKind, contentKind }) => {
				await editor.loadBlankImage(180, 140, '#ffffff');
				editor.animationTicker.setPaused(true); editor.setTool(ToolType.HAND); editor.viewport.setZoom(1);
				const asset = editor.stickerLibrary.content.find(item => !item.isAnimated);
				await editor.stickerLibrary.ensureAssetDetails(asset.id);
				const make = kind => {
					if (kind === 'shape') return editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 80, height: 60, position: { x: 90, y: 70 } });
					if (kind === 'text') return editor.textGlitterManager.createLayer({ text: 'H', fontSize: 80, position: { x: 90, y: 70 } });
					if (kind === 'fill') {
						const layer = editor.glitterManager.createLayer();
						const mask = editor.paintMaskStore.ensurePaintMask(layer.id);
						mask.add.getContext('2d').fillRect(15, 10, 150, 120); mask.hasContent = true; mask.liveRevision++;
						layer.maskHasContent = true; layer.fill.mode = 'solid'; layer.fill.color = '#ff3366';
						return layer;
					}
					const layer = editor.stickerManager.createLayer(asset.id);
					layer.transform.position = { x: 90, y: 70 };
					const scale = Math.min(120 / layer.stickerData.width, 100 / layer.stickerData.height) * 100;
					layer.transform.scale = { x: scale, y: scale }; return layer;
				};
				const base = make(baseKind), content = make(contentKind);
				for (const layer of [base, content]) {
					const fill = getLayerFillSlot(layer); if (fill) { fill.mode = 'solid'; fill.color = layer === base ? '#3366ff' : '#ff3366'; }
				}
				editor.layerManager.insertLayer(base); content.clipped = true; editor.layerManager.insertLayer(content);
				editor.setTool(ToolType.HAND);
				await editor.getClipBodyCache().get(base);
				editor.requestPreviewUpdate();
			}, { baseKind, contentKind });
			await compare(page, `${contentKind} clipped to ${baseKind}`);
		}
		await page.evaluate(async () => {
			await editor.loadBlankImage(180, 140, '#ffffff'); editor.viewport.setZoom(1);
			const base = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 100, height: 80 });
			base.transform.rotation = 20; base.transform.scale = { x: 90, y: 120 }; base.transform.flipX = true; base.opacity = 70;
			base.shapeData.fill.mode = 'solid'; base.shapeData.fill.color = '#3366ff';
			base.animations = [GlitterAnimation.normalizeAnimation({ id: editor.layerManager.generateLayerId(), type: 'bounce', periodMs: 400, amount: 10 }), GlitterAnimation.normalizeAnimation({ id: editor.layerManager.generateLayerId(), type: 'rainbow', periodMs: 400 })]; editor.layerManager.insertLayer(base);
			const content = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 120, height: 110 }); content.shapeData.fill.mode = 'solid'; content.shapeData.fill.color = '#ff3366'; content.opacity = 80; content.clipped = true;
			content.animations = [GlitterAnimation.normalizeAnimation({ id: editor.layerManager.generateLayerId(), type: 'pulse', periodMs: 400, amount: 10 })]; editor.layerManager.insertLayer(content);
			editor.setTool(ToolType.HAND); editor.requestPreviewUpdate();
		});
		for (const timestamp of [0, 100, 400]) {
			await page.evaluate(timestamp => { editor.animationTicker._elapsedAt = () => timestamp; editor.animationTicker.setPaused(false); }, timestamp);
			await compare(page, `own Pulse inside inherited Bounce/Rainbow at ${timestamp} ms`, timestamp);
		}
		await page.evaluate(() => {
			const content = editor.layers.find(layer => layer.clipped), base = getClipBase(editor.layers, content);
			content.animations = []; base.animations = [GlitterAnimation.normalizeAnimation({ id: editor.layerManager.generateLayerId(), type: 'marquee', repeat: 'wrap', angle: 0, periodMs: 400 })]; editor.requestPreviewUpdate();
		});
		for (const timestamp of [100, 300]) {
			await page.evaluate(timestamp => { editor.animationTicker._elapsedAt = () => timestamp; editor.animationTicker.refresh(); }, timestamp);
			await compare(page, `inherited Marquee wrap copies at ${timestamp} ms`, timestamp);
		}
		await page.evaluate(() => { delete editor.animationTicker._elapsedAt; editor.animationTicker.setPaused(true); });
		await page.evaluate(async () => {
			await editor.loadBlankImage(180, 140, '#8899aa'); editor.animationTicker.setPaused(true); editor.setTool(ToolType.HAND); editor.viewport.setZoom(1);
			const filter = editor.filterLayerManager.createLayer({ filterData: { type: 'pixelate', size: 8 } });
			editor.layerManager.insertLayer(filter); filter.locked = false; editor.requestPreviewUpdate();
			window.regionFilter = filter;
		});
		await page.waitForFunction(() => editor.filterLayerManager.layerTransforms.has(regionFilter.id));
		const region = await page.evaluate(async () => {
			const layer = regionFilter, manager = editor.filterLayerManager;
			manager.updateTransform(layer.id, { scale: { x: 50, y: 50 }, position: { x: 60, y: 50 } });
			const serialized = editor.layerManager.serializeLayer(layer);
			const restored = await editor.layerManager.deserializeLayer(serialized);
			if (JSON.stringify(restored.filterData.region) !== JSON.stringify(layer.filterData.region)) throw new Error('Region round trip failed');
			manager.loadLayerSettings(layer);
			return layer.filterData.region;
		});
		assert.deepStrictEqual(region, { width: 90, height: 70 });
		await page.evaluate(async () => { await editor.filterLayerManager.renderSnapshot(regionFilter, false); editor.setTool(ToolType.HAND); editor.requestPreviewUpdate(); });
		await compare(page, 'pixel filter region');
		assert.strictEqual(await page.evaluate(() => { editor.filterLayerManager.resetTransform(regionFilter.id); return regionFilter.filterData.region; }), null);
		process.stdout.write('PASS filter position lock, geometry bake, serialization and reset\n');
		await page.evaluate(async () => {
			await editor.loadBlankImage(180, 140, '#ffffff');
			const base = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 100, height: 90 }); editor.layerManager.insertLayer(base);
			const asset = editor.stickerLibrary.content.find(item => item.isAnimated); await editor.stickerLibrary.ensureAssetDetails(asset.id);
			const layer = editor.stickerManager.createLayer(asset.id); layer.clipped = true; editor.layerManager.insertLayer(layer);
			base.animations = [GlitterAnimation.normalizeAnimation({ id: editor.layerManager.generateLayerId(), type: 'bounce', periodMs: 400 })];
			editor.saveState('Clip fixture'); window.clipFixture = layer.id;
		});
		const first = await exportSnapshot(page, { baseImage: true, maxFrames: 6 }, { minLayers: 2 });
		await page.evaluate(async () => { const layer = editor.layerManager.getLayerById(clipFixture); layer.opacity = 30; editor.saveState('Edit clipped sticker'); await editor.undo(); });
		const afterUndo = await exportSnapshot(page, { baseImage: true, maxFrames: 6 }, { minLayers: 2 });
		assertByteIdentity(first, afterUndo, 'Animated clipped export after edit/undo');
		const repeated = await exportSnapshot(page, { baseImage: true, maxFrames: 6 }, { minLayers: 2 });
		assertByteIdentity(afterUndo, repeated, 'Repeated animated clipped export');
		assert.deepStrictEqual(errors, []);
		process.stdout.write('PASS animated clipping export fragility and repeated GIF bytes\n');
	} finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
