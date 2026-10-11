'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '../..');
function canvas(width, height) {
	let data = new Uint8ClampedArray(width * height * 4);
	return { width, height, getContext: () => ({
		getImageData: () => ({ data }),
		createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
		putImageData: image => { data = image.data; }
	}) };
}
const context = vm.createContext({ createAppCanvas: canvas, CONFIG: { rendering: { maskAlphaThreshold: 128 }, tools: { area: { historyLimit: 30 } } } });
for (const file of ['js/core/options.js', 'js/core/area.js', 'js/paint/mask-geometry.js', 'js/systems/AreaSelection.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
vm.runInContext('globalThis.AreaSelection = AreaSelection; globalThis.modifiers = AREA_MODIFIERS;', context);

function raster(rings, width, height) {
	const coverage = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		let winding = 0;
		for (const ring of rings) for (let i = 0; i < ring.length; i++) {
			const a = ring[i], b = ring[(i + 1) % ring.length];
			const side = (b.x - a.x) * (y + 0.5 - a.y) - (x + 0.5 - a.x) * (b.y - a.y);
			if (a.y <= y + 0.5 && b.y > y + 0.5 && side > 0) winding++;
			if (a.y > y + 0.5 && b.y <= y + 0.5 && side < 0) winding--;
		}
		coverage[y * width + x] = winding ? 255 : 0;
	}
	return coverage;
}
for (const rows of [
	['00000', '01110', '01110', '00000'],
	['11111', '10001', '10001', '11111'],
	['110011', '110011'], ['10', '01'], ['1'], ['111', '101', '111']
]) {
	const width = rows[0].length, height = rows.length;
	const coverage = Uint8Array.from(rows.join(''), value => value === '1' ? 255 : 0);
	const rings = context.traceMaskContours(coverage, width, height, 0);
	assert.deepStrictEqual(raster(rings, width, height), coverage, `Contour round trip ${rows}`);
	assert(rings.every(ring => ring.length >= 3 && (ring[0].x !== ring.at(-1).x || ring[0].y !== ring.at(-1).y)));
}
console.log('PASS Exact contour round trips: rectangle, hole, islands, corner contact, pixel, borders');

const editor = { originalCanvas: { width: 100, height: 100 }, historyManager: { serial: 0, historyIndex: 0, history: [{ serial: 0 }], nextSerial() { return ++this.serial; }, updateButtons() {} } };
const area = new context.AreaSelection(editor);
editor.areaSelection = area;
const square = new Uint8Array(10000);
for (let y = 40; y < 60; y++) square.fill(255, y * 100 + 40, y * 100 + 60);
function source(coverage) {
	const image = canvas(100, 100), ctx = image.getContext();
	const pixels = ctx.createImageData(100, 100);
	coverage.forEach((value, index) => { pixels.data[index * 4 + 3] = value; });
	ctx.putImageData(pixels);
	return { x: 0, y: 0, width: 100, height: 100, canvas: image, field: context.createSignedDistanceField(image) };
}
const count = coverage => coverage.reduce((sum, value) => sum + Boolean(value), 0);
const base = source(square);
const expanded = area.modifyCoverage(base, 'expand', 5);
assert(count(expanded) > 800 && count(expanded) < 900);
assert.strictEqual(count(area.modifyCoverage(base, 'contract', 5)), 100);
assert.strictEqual(count(area.modifyCoverage(base, 'contract', 10)), 0);
assert.deepStrictEqual(Uint8Array.from(area.modifyCoverage(source(expanded), 'contract', 5)), square);
const border = area.modifyCoverage(base, 'border', 4);
for (let i = 0; i < border.length; i++) assert.strictEqual(Boolean(border[i]), base.field.distance[i] >= -2 && base.field.distance[i] <= 2);
const speck = square.slice(); speck[1010] = speck[1011] = speck[1110] = speck[1111] = 255;
const smooth = area.modifyCoverage(source(speck), 'smooth', 3);
assert.strictEqual(smooth[1010], 0);
// Integer Euclidean opening rounds a square's four corners at radius 3.
assert(count(smooth) >= 360 && count(smooth) <= 400);
const edge = square.slice();
for (let y = 40; y < 60; y++) edge.fill(255, y * 100, y * 100 + 20);
assert.strictEqual(area.modifyCoverage(source(edge), 'contract', 5)[50 * 100], 255);
console.log('PASS Modify distances, inverse morphology, specks and document-edge behavior');

area._rasterize = (_map, ops) => {
	const coverage = raster(ops.flatMap(entry => entry.rings || []), 100, 100);
	return source(coverage).canvas;
};
area.applyCoverage(square);
const original = area.ops;
area.moveBy(2, 0, { key: 'drag' }); area.moveBy(2, 0, { key: 'drag' });
assert.strictEqual(area.history.undoStack.length, 2);
area.history.undo(); assert.strictEqual(area.ops, original);
area.history.redo(); assert(area.contains({ x: 63, y: 50 }));
area.clear(); assert.strictEqual(area.history.lastCleared.length, 1);
area.reselect(); assert(area.contains({ x: 63, y: 50 }));
area.transformPoints(point => ({ x: point.x + 5, y: point.y + 10 }));
area.history.undo(); area.history.undo(); assert(area.contains({ x: 68, y: 60 }));
area.reset(); assert.strictEqual(area.history.undoStack.length, 0);
const ring = new Uint8Array(10000);
for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) if (x < 30 || x >= 70 || y < 30 || y >= 70) ring[y * 100 + x] = 255;
area.applyCoverage(ring);
assert(area.contains(area.getAnchorPoint()), 'Anchor must stay in a ring');
console.log('PASS Immutable area history, move coalescing, Reselect, transformed history and covered anchor');
