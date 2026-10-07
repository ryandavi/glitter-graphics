'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { GifReader, GifWriter } = require('../../js/vendor/omggif.js');
global.GifReader = GifReader;
global.GlitterPaletteAnalysis = require('../../js/effects/palette-analysis.js');
const recolor = require('../../js/effects/glitter-recolor.js');
const manifest = require('../../data/glitter.index.json');
let local = 0, transparent = 0;
for (const item of manifest) {
	const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '../..', item.url)));
	const analysis = recolor.analyze(bytes);
	assert.deepStrictEqual(recolor.apply(bytes, {}), bytes, `${item.name}: empty recipe`);
	const colors = Object.fromEntries(analysis.swatches.map((swatch, index) => [swatch.key, ['18b7c9', '9fe8f0', '0f0f0f'][index % 3]]));
	const result = recolor.apply(bytes, colors, analysis);
	assert.strictEqual(result.length, bytes.length);
	const before = new GifReader(bytes), after = new GifReader(result);
	assert.strictEqual(after.numFrames(), before.numFrames());
	assert.strictEqual(after.width, before.width); assert.strictEqual(after.height, before.height);
	const editable = new Set();
	for (const table of analysis.tables) for (const index of table.opaque) for (let channel = 0; channel < 3; channel++) editable.add(table.offset + index * 3 + channel);
	for (let index = 0; index < bytes.length; index++) if (!editable.has(index)) assert.strictEqual(result[index], bytes[index], 'Non-palette bytes must not change');
	for (let frame = 0; frame < before.numFrames(); frame++) {
		assert.deepStrictEqual(after.frameInfo(frame), before.frameInfo(frame));
		const original = new Uint8Array(before.width * before.height * 4), changed = new Uint8Array(original.length);
		before.decodeAndBlitFrameRGBA(frame, original); after.decodeAndBlitFrameRGBA(frame, changed);
		for (let offset = 0; offset < original.length; offset += 4) {
			assert.strictEqual(changed[offset + 3], original[offset + 3]);
			if (!original[offset + 3]) { assert.deepStrictEqual(changed.slice(offset, offset + 4), original.slice(offset, offset + 4)); continue; }
			const key = recolor.hex(Array.from(original.slice(offset, offset + 3)));
			assert.deepStrictEqual(Array.from(changed.slice(offset, offset + 3)), recolor.rgb(colors[key]), `${item.name} frame ${frame}`);
		}
	}
	if (analysis.tables.length > 1) local++;
	if (analysis.hasTransparency) transparent++;
}
assert(local > 0 && transparent > 0);

// The transparent index of a shared palette can be opaque in another frame.
const buffer = new Uint8Array(1024);
const writer = new GifWriter(buffer, 2, 1, { palette: [0xff0000, 0x0000ff] });
writer.addFrame(0, 0, 2, 1, new Uint8Array([0, 1]), { transparent: 0, delay: 2 });
writer.addFrame(0, 0, 2, 1, new Uint8Array([0, 1]), { transparent: 1, delay: 7 });
const bytes = buffer.slice(0, writer.end());
const changed = new GifReader(recolor.apply(bytes, { ff0000: '00ff00', '0000ff': 'ffffff' }));
const frame = new Uint8Array(8); changed.decodeAndBlitFrameRGBA(1, frame);
assert.deepStrictEqual(Array.from(frame), [0, 255, 0, 255, 0, 0, 0, 0]);

for (const color of ['000000', 'ffffff', 'ff60ba', '18b7c9', '00ff00']) assert.strictEqual(recolor.fromLch(...recolor.lch(color)), color);
const swatches = [{ key: 'ff60ba', share: 0.8 }, { key: 'ffffff', share: 0.2 }];
assert.strictEqual(recolor.shiftAll({}, swatches, '18b7c9').ff60ba, '18b7c9');
assert.deepStrictEqual(recolor.adjust({ ff60ba: '123456' }, swatches), { ff60ba: '123456' });
assert.throws(() => recolor.apply(bytes, { red: 'bad' }));
assert.deepStrictEqual(recolor.paletteTags([{ key: '18b7c9', share: 0.85 }, { key: 'ffffff', share: 0.15 }], { neutralSaturation: 0.12, colorTagMinShare: 0.1 }), ['blue', 'neutral']);
console.log(`PASS ${manifest.length} GIFs: palette-only rewrites, timing, local palettes (${local}), transparency (${transparent}), shared transparent indexes and OKLCH`);
