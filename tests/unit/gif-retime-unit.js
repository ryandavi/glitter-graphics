'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { GifReader, GifWriter } = require('../../js/vendor/omggif.js');

const context = vm.createContext({ GifReader, Uint8Array, navigator: { hardwareConcurrency: 4 } });
for (const file of ['js/core/math.js', 'js/core/color.js', 'js/core/releases.js', 'js/core/fields.js', 'js/core/area.js', 'js/core/config.js', 'js/core/gif-decode.js']) {
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), context);
}
const { retimeGifDelays, retimeGifBytes, readGifTiming, getGifCycleRange } = vm.runInContext('({ retimeGifDelays, retimeGifBytes, readGifTiming, getGifCycleRange })', context);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const list = (values) => Array.from(values);

function buildGif(delaysCs) {
	const buffer = new Uint8Array(4096 + delaysCs.length * 256);
	const writer = new GifWriter(buffer, 4, 4, { loop: 0, palette: [0x000000, 0xffffff] });
	delaysCs.forEach((delay, index) => writer.addFrame(0, 0, 4, 4, new Uint8Array(16).fill(index % 2), { delay }));
	return buffer.slice(0, writer.end());
}

// Uniform delays: the leftover units go to the earliest frames.
const uniform = new Array(12).fill(80);
const stretched = list(retimeGifDelays(uniform, 1000));
assert.strictEqual(sum(stretched), 1000);
assert(stretched.every((delay) => delay === 80 || delay === 90), 'Uniform delays must stay within one grid step of each other');
assert.deepStrictEqual(stretched, [90, 90, 90, 90, 80, 80, 80, 80, 80, 80, 80, 80]);
assert.deepStrictEqual(list(retimeGifDelays(uniform, 1000)), stretched, 'Retiming must be deterministic');

// Variable delays keep which frames are long and which are short.
const variable = [40, 40, 200, 40, 40, 40, 300, 40, 40, 20];
for (const target of [400, 600, 1000, 1200, 1600]) {
	const retimed = list(retimeGifDelays(variable, target));
	assert.strictEqual(sum(retimed), target, `Delays must total ${target} ms`);
	assert(retimed.every((delay) => delay >= 20 && delay % 10 === 0), 'Delays must sit on the GIF grid at or above the minimum');
	variable.forEach((left, a) => variable.forEach((right, b) => {
		if (left < right) assert(retimed[a] <= retimed[b], `Frame order of long and short was lost at ${target} ms`);
	}));
}

// Limits.
assert.strictEqual(retimeGifDelays(uniform, 230), null, 'A target under 20 ms a frame cannot be represented');
assert.strictEqual(retimeGifDelays(uniform, 1005), null, 'A target off the delay grid cannot be represented');
assert.deepStrictEqual(list(retimeGifDelays(uniform, 240)), new Array(12).fill(20));
assert.deepStrictEqual(list(retimeGifDelays(uniform, 960)), uniform, 'The native cycle returns the input');
assert.deepStrictEqual(list(retimeGifDelays([83, 83, 83], 249)), [83, 83, 83], 'An off-grid native cycle is returned untouched');
// Frames lifted to the minimum must not push the total past the target.
assert.strictEqual(sum(retimeGifDelays([20, 20, 20, 20, 1000], 300)), 300);
assert(list(retimeGifDelays([20, 20, 20, 20, 1000], 300)).every((delay) => delay >= 20));

// The range a cycle may be set to.
assert.deepStrictEqual({ ...getGifCycleRange(uniform) }, { min: 480, max: 1920 });
assert.deepStrictEqual({ ...getGifCycleRange(new Array(40).fill(20)) }, { min: 800, max: 1600 }, 'The frame floor bounds the fastest cycle');
assert.strictEqual(getGifCycleRange([100]), null, 'A still has no cycle to set');

// Bytes: only the delay fields change, and they read back as written.
const bytes = buildGif([8, 8, 8, 8, 8, 8]);
const delays = list(retimeGifDelays(readGifTiming(bytes).frameDelays, 700));
const rewritten = retimeGifBytes(bytes, delays);
assert.strictEqual(readGifTiming(bytes).canRetime, true);
assert.deepStrictEqual(list(readGifTiming(rewritten).frameDelays), delays);
assert.strictEqual(rewritten.length, bytes.length);
let changed = 0;
for (let index = 0; index < bytes.length; index++) if (bytes[index] !== rewritten[index]) changed++;
assert(changed > 0 && changed <= delays.length * 2, 'Only delay bytes may change');
assert.deepStrictEqual(list(readGifTiming(bytes).frameDelays), new Array(6).fill(80), 'The source bytes must not be written');
assert.strictEqual(retimeGifBytes(bytes, [100, 100]), null, 'A delay list for another frame count is refused');

// A frame with no Graphic Control Extension has no delay field to write.
const bare = buildGif([8, 8, 0, 8]);
assert.strictEqual(readGifTiming(bare).canRetime, false);
assert.strictEqual(retimeGifBytes(bare, [100, 100, 100, 100]), null);

// Shipped assets round-trip.
let checked = 0;
for (const item of require('../../data/glitter.index.json').filter((entry) => entry.isAnimated).slice(0, 40)) {
	const source = new Uint8Array(fs.readFileSync(path.join(__dirname, '../..', item.url)));
	const timing = readGifTiming(source);
	const range = timing.canRetime ? getGifCycleRange(timing.frameDelays) : null;
	if (!range) continue;
	for (const target of [range.min, range.max]) {
		const next = list(retimeGifDelays(timing.frameDelays, target));
		assert.deepStrictEqual(list(readGifTiming(retimeGifBytes(source, next)).frameDelays), next, `${item.name}: delays written at ${target} ms`);
	}
	checked++;
}
assert(checked > 0, 'No shipped glitter could be retimed');

process.stdout.write(`PASS GIF retiming: delay settling, limits, byte rewrite, ${checked} shipped assets\n`);
