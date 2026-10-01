'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const context = vm.createContext({ CONFIG: { tools: { nineSlice: { maxTiles: 256 } } } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/paint/nine-slice.js'), 'utf8'), context);
const { normalizeSlice, scaleSliceInsets, getSliceScale, getSliceRects, drawSlicedImage, sliceSpanStyle } = context;
const slice = { top: 2, right: 3, bottom: 4, left: 2, mode: 'stretch' };
assert(normalizeSlice(slice, 12, 14));
for (const bad of [{ ...slice, left: -1 }, { ...slice, left: 0.5 }, { ...slice, right: 10 }, { ...slice, mode: 'repeat' }]) assert.strictEqual(normalizeSlice(bad, 12, 14), null);
assert.strictEqual(normalizeSlice({ top: 0, right: 0, bottom: 0, left: 0, mode: 'stretch' }, 12, 14), null);

function coverage(rects, width, height) {
	const pixels = new Uint8Array(width * height);
	for (const rect of rects) {
		assert(rect.sw > 0 && rect.sh > 0 && rect.dw > 0 && rect.dh > 0);
		for (let y = rect.dy; y < rect.dy + rect.dh; y++) {
			for (let x = rect.dx; x < rect.dx + rect.dw; x++) pixels[y * width + x]++;
		}
	}
	assert(pixels.every((value) => value === 1), 'pieces must cover each pixel exactly once');
}
for (const mode of ['stretch', 'round']) {
	for (const [width, height] of [[36, 28], [3, 2], [100, 87]]) {
		const record = { ...slice, mode };
		coverage(getSliceRects(record, 12, 14, width, height, getSliceScale(record, { scaleX: width / 12, scaleY: height / 14, boxWidth: width, boxHeight: height })), width, height);
	}
}

// A nearest-neighbor pixel buffer verifies the uniform-scale identity without a canvas.
function render(rects, width, height) {
	const output = new Uint16Array(width * height);
	for (const rect of rects) {
		for (let y = rect.dy; y < rect.dy + rect.dh; y++) {
			for (let x = rect.dx; x < rect.dx + rect.dw; x++) {
				const sx = Math.floor(rect.sx + (x - rect.dx + 0.5) * rect.sw / rect.dw);
				const sy = Math.floor(rect.sy + (y - rect.dy + 0.5) * rect.sh / rect.dh);
				output[y * width + x] = sy * 12 + sx;
			}
		}
	}
	return output;
}
for (const scale of [1, 2, 3]) {
	const width = 12 * scale, height = 14 * scale;
	assert.deepStrictEqual(render(getSliceRects(slice, 12, 14, width, height, scale), width, height), render([{ sx: 0, sy: 0, sw: 12, sh: 14, dx: 0, dy: 0, dw: width, dh: height }], width, height));
}
const banner = { top: 0, bottom: 0, left: 3, right: 3, mode: 'stretch' };
assert.strictEqual(getSliceScale(banner, { scaleX: 8, scaleY: 2 }), 2);
assert.strictEqual(getSliceRects(banner, 12, 14, 96, 28, 2).length, 3);
assert.strictEqual(getSliceScale(slice, { fixedScale: 10, boxWidth: 10, boxHeight: 9 }), 1.5);
assert.strictEqual(getSliceScale(slice, { scaleX: 3.8, scaleY: 4.9, pixelated: true }), 3);
assert.strictEqual(getSliceScale(slice, { fixedScale: 4, pixelated: true, boxWidth: 2, boxHeight: 2 }), 1 / 3);
const round = { top: 2, right: 2, bottom: 2, left: 2, mode: 'round' };
const tiled = getSliceRects(round, 8, 8, 16, 16, 1);
assert.strictEqual(tiled.length, 25);
coverage(tiled, 16, 16);
const capped = getSliceRects(round, 8, 8, 2000, 2000, 1);
assert(capped.length <= 256);
assert.deepStrictEqual(JSON.parse(JSON.stringify(scaleSliceInsets(slice, 12, 14, 24, 28))), { top: 4, right: 6, bottom: 8, left: 4, mode: 'stretch' });
const calls = [];
drawSlicedImage({ drawImage: (...args) => calls.push(args) }, 'image', tiled);
assert.strictEqual(calls.length, tiled.length);
const style = sliceSpanStyle({ sx: 2, sy: 4, sw: 3, sh: 2, dx: 8, dy: 9, dw: 6, dh: 6 }, 12, 14);
assert.strictEqual(style.backgroundSize, '24px 42px');
assert.strictEqual(style.backgroundPosition, '-4px -12px');
process.stdout.write('PASS nine-slice geometry\n');
