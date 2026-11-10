'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { GifReader, GifWriter } = require('../../js/vendor/omggif.js');

const context = vm.createContext({ GifReader, GifWriter, Uint8Array, Uint8ClampedArray, navigator: { hardwareConcurrency: 4 } });
for (const file of ['js/core/math.js', 'js/core/color.js', 'js/core/releases.js', 'js/core/fields.js', 'js/core/area.js', 'js/core/config.js', 'js/core/gif-decode.js', 'js/export/ExportTimeline.js']) {
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), context);
}
const { retimeGifDelays, retimeGifBytes, readGifTiming, getGifCycleRange, getGifStartFrame, getGifStartMs, rotateGifBytes, AuthoredAnimationSource } = vm.runInContext('({ retimeGifDelays, retimeGifBytes, readGifTiming, getGifCycleRange, getGifStartFrame, getGifStartMs, rotateGifBytes, AuthoredAnimationSource })', context);
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

// Start at: the stored ms resolves to the nearest frame boundary of the file's timing.
assert.strictEqual(getGifStartFrame([100, 100, 100], 0), 0);
assert.strictEqual(getGifStartFrame([100, 100, 100], 140), 1);
assert.strictEqual(getGifStartFrame([100, 100, 100], 160), 2);
assert.strictEqual(getGifStartFrame([100, 100, 100], 290), 2, 'past the last boundary stays on the last frame');
assert.strictEqual(getGifStartFrame([100], 50), 0, 'a still has no start frame');
assert.strictEqual(getGifStartMs([40, 60, 100], 2), 100);

// Rotation re-encodes whole composited frames, so an optimized GIF (patches
// over earlier frames, every disposal) starts cleanly mid-cycle.
function composites(bytes) {
	const reader = new GifReader(bytes), frames = [];
	let canvas = new Uint8ClampedArray(reader.width * reader.height * 4);
	for (let index = 0; index < reader.numFrames(); index++) {
		const info = reader.frameInfo(index), restore = info.disposal === 3 ? canvas.slice() : null;
		reader.decodeAndBlitFrameRGBA(index, canvas);
		frames.push(list(canvas));
		if (info.disposal === 2) for (let y = info.y; y < info.y + info.height; y++) canvas.fill(0, (y * reader.width + info.x) * 4, (y * reader.width + info.x + info.width) * 4);
		else if (restore) canvas = restore;
	}
	return frames;
}
const optimizedBuffer = new Uint8Array(8192);
const optimizedWriter = new GifWriter(optimizedBuffer, 4, 4, { loop: 0, palette: [0x000000, 0xff0000, 0x00ff00, 0x0000ff] });
optimizedWriter.addFrame(0, 0, 4, 4, new Uint8Array(16).fill(1), { delay: 5, disposal: 1 });
optimizedWriter.addFrame(0, 0, 2, 2, new Uint8Array(4).fill(2), { delay: 6, disposal: 3 });
optimizedWriter.addFrame(2, 2, 2, 2, new Uint8Array([3, 0, 0, 3]), { delay: 7, disposal: 2, transparent: 0 });
optimizedWriter.addFrame(1, 1, 2, 2, new Uint8Array(4).fill(2), { delay: 8, disposal: 1 });
const optimized = optimizedBuffer.slice(0, optimizedWriter.end());
const fileDelays = list(readGifTiming(optimized).frameDelays);
for (const start of [1, 2, 3]) {
	const rotated = rotateGifBytes(optimized, start, fileDelays);
	const original = composites(optimized), shown = composites(rotated);
	original.forEach((_, step) => assert.deepStrictEqual(shown[step], original[(start + step) % original.length], `start ${start}: frame ${step} shows file frame ${(start + step) % original.length}`));
	assert.deepStrictEqual(list(readGifTiming(rotated).frameDelays), fileDelays.map((_, step) => fileDelays[(start + step) % fileDelays.length]), `start ${start}: delays follow their frames`);
	assert.strictEqual(new GifReader(rotated).loopCount(), 0, 'the loop count is kept');
}
const stretchedDelays = [60, 70, 80, 90];
assert.deepStrictEqual(list(readGifTiming(rotateGifBytes(optimized, 2, stretchedDelays)).frameDelays), [80, 90, 60, 70], 'a retimed cycle rotates with its frames');

// Export reads the same rotation: time 0 is the start frame, and the pass wraps.
const source = new AuthoredAnimationSource({ key: 'gif', frameCount: 4, frameDurations: [100, 200, 300, 400], startFrame: 2 });
assert.deepStrictEqual([0, 299, 300, 699, 700, 899, 900, 1000].map(time => source.frameIndexAt(time)), [2, 2, 3, 3, 0, 1, 1, 2]);
assert.strictEqual(source.cycleDuration, 1000, 'the cycle length is unchanged');
assert.deepStrictEqual(list(source.boundariesUntil(1000)), [300, 700, 800]);
assert.deepStrictEqual(list(source.occurrencesUntil(1000).map(entry => entry.index)), [2, 3, 0, 1]);
const stretchedSource = new AuthoredAnimationSource({ ...source, retimeDelays: () => [200, 200, 200, 200] }).atPeriod(800);
assert.deepStrictEqual([0, 199, 200, 400].map(time => stretchedSource.frameIndexAt(time)), [2, 2, 3, 0], 'a retimed pass keeps its start frame');

// Shipped glitter rotates exactly.
let rotatedAssets = 0;
for (const item of require('../../data/glitter.index.json').filter((entry) => entry.isAnimated).slice(0, 8)) {
	const asset = new Uint8Array(fs.readFileSync(path.join(__dirname, '../..', item.url)));
	const frames = composites(asset), start = Math.floor(frames.length / 2);
	const rotated = rotateGifBytes(asset, start, list(readGifTiming(asset).frameDelays));
	if (!rotated) continue;
	composites(rotated).forEach((frame, step) => assert.deepStrictEqual(frame, frames[(start + step) % frames.length], `${item.name}: rotated frame ${step}`));
	rotatedAssets++;
}
assert(rotatedAssets > 0, 'No shipped glitter could be rotated');

process.stdout.write(`PASS GIF retiming: delay settling, limits, byte rewrite, ${checked} shipped assets, start frames and rotation (${rotatedAssets} shipped)\n`);
