'use strict';

// The Warp filter op (js/effects/filter-ops.js) and its looks: Amount 0 is the
// identity, the centre pixel never moves, pixels outside the radius stay, each
// shape moves pixels, and one look per shape sits in the Distort group.

const assert = require('assert/strict');
global.CONFIG = { tools: { filter: { tintPresets: {}, animation: { frameMs: 100, crawl: {} } } } };
global.FIELDS = require('../../js/core/fields.js');
const Ops = require('../../js/effects/filter-ops.js');
const Filters = require('../../js/effects/filter-looks.js');

const width = 41, height = 31;
function fixture() {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const offset = (y * width + x) * 4;
		data.set([x * 6 % 256, y * 8 % 256, (x * y) % 256, 255], offset);
	}
	return { width, height, data };
}
const warp = (params) => Ops.get('warp').pixel(fixture(), params).data;
const original = fixture().data;
const pixel = (data, x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
const center = [(width - 1) / 2, (height - 1) / 2];

for (const shape of ['bulge', 'pinch', 'twirl']) {
	assert.deepEqual(warp({ shape, amount: 0, radius: 1 }), original, `${shape} at Amount 0 returns the input`);
	assert.equal(Ops.get('warp').isActive({ shape, amount: 0, radius: 1 }), false, `${shape} at Amount 0 is inactive`);
	const warped = warp({ shape, amount: 1, radius: 0.8 });
	assert.deepEqual(pixel(warped, ...center), pixel(original, ...center), `${shape} never moves the centre pixel`);
	assert.notDeepEqual(warped, original, `${shape} at full Amount moves pixels`);
	// Radius 0.8 of half the shorter side (15) is 12 px; the corners are far outside.
	for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [0, 15], [40, 15]]) {
		assert.deepEqual(pixel(warped, x, y), pixel(original, x, y), `${shape} leaves (${x}, ${y}) outside the radius untouched`);
	}
}

// Bulge magnifies the centre (a pixel near it samples from closer in); Pinch shrinks it.
const near = [center[0] + 4, center[1]];
const bulged = pixel(warp({ shape: 'bulge', amount: 1, radius: 1 }), ...near);
const pinched = pixel(warp({ shape: 'pinch', amount: 1, radius: 1 }), ...near);
assert(bulged[0] < pixel(original, ...near)[0] && pinched[0] > pixel(original, ...near)[0], 'Bulge samples inward, Pinch outward');

// A region-limited warp is covered by tests/parity/regional-look-verify.js,
// which renders through renderRegionToCanvas.

// Looks: one per shape, in Distort; the op itself has no plain look.
assert.equal(Filters.looksLibrary.get('warp'), null, 'Warp has no shape-less look');
for (const shape of ['bulge', 'pinch', 'twirl']) {
	const entry = Filters.looksLibrary.get(`warp:${shape}`);
	assert.equal(entry?.group, 'distort', `warp:${shape} is a Distort look`);
	const data = Filters.normalize('warp', entry.value);
	assert.equal(Filters.lookId(data), `warp:${shape}`, 'lookId round-trips the shape');
	assert.equal(Filters.tier(data), 3, 'Warp renders through the pixel path');
}
assert.equal(Filters.lookId(Filters.normalize('sepia')), 'sepia');
assert.equal(Filters.lookId({ type: 'instagram', presetId: 'rio' }), 'instagram:rio');
console.log('PASS filter warp op and looks');
