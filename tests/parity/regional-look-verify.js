'use strict';

const assert = require('assert');
const { openApp } = require('../lib/app');

async function main() {
	const { browser, page, errors } = await openApp({ document: { width: 180, height: 140 } });
	try {
		for (const data of [{ type: 'invert' }, { type: 'vignette', amount: 80 }, { type: 'blur', radius: 6 }, { type: 'scanlines', crawl: 'slow' }]) {
			await page.evaluate(async data => {
				await editor.loadBlankImage(180, 140, '#0033cc'); editor.animationTicker.setPaused(true); editor.viewport.setZoom(1);
				// Red ends at the region's left edge: a blur must not read it.
				const shape = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 110, height: 140, position: { x: 0, y: 70 } });
				shape.shapeData.fill.mode = 'solid'; shape.shapeData.fill.color = '#ff0000'; editor.layerManager.insertLayer(shape);
				const filter = editor.filterLayerManager.createLayer({ filterData: { ...data, region: { width: 70, height: 70 } } });
				editor.layerManager.insertLayer(filter); editor.setTool(ToolType.HAND); editor.requestPreviewUpdate();
			}, data);
			for (const timestamp of data.type === 'scanlines' ? [0, 200] : [0]) {
				await page.evaluate(timestamp => {
					editor.animationTicker._elapsedAt = () => timestamp;
					editor.animationTicker.setPaused(false);
				}, timestamp);
				await page.waitForTimeout(100);
				const output = await page.evaluate(async timestamp => Array.from((await editor.sceneCompositor.composeFrameAt({ ...editor.getSceneSnapshotParams(editor.layers), timestamp })).imageData.data), timestamp);
				const clip = await page.evaluate(() => { const r = editor.previewCanvas.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
				const screenshot = (await page.screenshot({ clip })).toString('base64');
				const preview = await page.evaluate(async base64 => {
					const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
					const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
					const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
				}, screenshot);
				let max = 0;
				for (let y = 38; y < 102; y++) for (let x = 56; x < 124; x++) {
					const index = (y * 180 + x) * 4;
					for (let channel = 0; channel < 3; channel++) max = Math.max(max, Math.abs(output[index + channel] - preview[index + channel]));
				}
				assert(max <= 4, `${data.type} at ${timestamp}: preview/export difference ${max}`);
				assert.deepStrictEqual(output.slice((70 * 180 + 130) * 4, (70 * 180 + 130) * 4 + 4), [0, 51, 204, 255], 'Pixels outside the region stay unchanged');
				if (data.type === 'blur') assert.deepStrictEqual(output.slice((70 * 180 + 56) * 4, (70 * 180 + 56) * 4 + 4), [0, 51, 204, 255], 'Blur clamps at the region edge');
				process.stdout.write(`PASS regional ${data.type} at ${timestamp} ms: ${64 * 68} pixels, maximum channel difference ${max}\n`);
			}
		}
		assert.deepStrictEqual(errors, []);
	} finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
