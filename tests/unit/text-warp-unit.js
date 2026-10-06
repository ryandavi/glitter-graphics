'use strict';

// Text warp registry and layout math (js/paint/text-warp.js): registry and
// option conformance, presets, normalization, identity at zero bend, the
// direction and symmetry of each warp, and warped glyph bounds. The mask
// drawing itself needs a canvas; preview and export share that one mask.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const context = vm.createContext({ console, structuredClone, Math, navigator: { hardwareConcurrency: 4, userAgent: 'node' } });
for (const file of [
	'js/core/releases.js',
	'js/core/fields.js',
	'js/core/config.js',
	'js/core/options.js',
	'js/ui/preset-library.js',
	'js/paint/text-warp.js'
]) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const run = (code) => vm.runInContext(code, context);

function fail(message) {
	throw new Error(`text-warp: ${message}`);
}

const types = run('WARP_TYPES');
const presets = run('WARP_PRESETS');
const spec = run('FIELDS.textWarpBend');
const normalize = run('normalizeTextWarp');
const isActive = run('isTextWarpActive');
const layout = run('layoutWarpedGlyphs');
const bounds = run('getWarpedGlyphBounds');
const findPreset = run('findWarpPresetId');
const matchPreset = run('matchWarpPreset');

// Registry: options mirror it, the CONFIG default names an entry, and every
// entry but none lays glyphs out.
if (JSON.stringify(run("getOptionValues('textWarp')")) !== JSON.stringify(Object.keys(types))) fail('textWarp options differ from WARP_TYPES');
if (!types[run('CONFIG.tools.text.defaultWarpType')]) fail('CONFIG default warp is not a WARP_TYPES id');
Object.values(types).forEach((type) => {
	if (!type.label) fail(`${type.id} needs a label`);
	if (type.id !== 'none' && typeof type.layoutGlyphs !== 'function') fail(`${type.id} needs layoutGlyphs`);
});

// Normalization clamps from the FIELDS spec and repairs unknown types.
const repaired = normalize({ type: 'zigzag', bend: 999 });
if (repaired.type !== 'none' || repaired.bend !== spec.max) fail('normalize must repair the type and clamp bend');
if (normalize(null).bend !== spec.value) fail('a missing warp takes the spec default bend');
if (isActive({ type: 'arc', bend: 0 }) || isActive({ type: 'none', bend: 50 })) fail('zero bend and none must take the flat path');

// A seven-glyph line, 20px per glyph, baseline at 40, centered on x = 70.
const glyphs = Array.from({ length: 7 }, (_, index) => ({ x: 10 + index * 20, y: 40, line: 0 }));
// The ink block is 20px tall and ends on the baseline.
const metrics = { centerX: 70, centerY: 30, width: 140, height: 20, fontSize: 32, ascent: 24 };
const middle = 3;
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

Object.values(types).filter((type) => type.layoutGlyphs).forEach((type) => {
	[-100, -35, 35, 100].forEach((bend) => {
		const placed = layout({ type: type.id, bend }, glyphs, metrics);
		if (placed.length !== glyphs.length) fail(`${type.id} changed the glyph count`);
		placed.forEach((placement, index) => {
			['x', 'y', 'rotation', 'scaleY'].forEach((key) => {
				if (!Number.isFinite(placement[key])) fail(`${type.id} bend ${bend} glyph ${index} ${key} is not finite`);
			});
			if (placement.scaleY <= 0) fail(`${type.id} bend ${bend} flipped glyph ${index}`);
		});
		// Mirror symmetry about the center for the curves; the waves are odd.
		const first = placed[0];
		const last = placed[placed.length - 1];
		if (['arc', 'arch', 'bulge'].includes(type.id)) {
			if (!near(first.y, last.y, 1e-6) || !near(first.x - 70, 70 - last.x, 1e-6)) fail(`${type.id} is not mirror-symmetric`);
			if (!near(placed[middle].x, 70, 1e-6)) fail(`${type.id} moved the middle glyph sideways`);
		}
	});
	// Tiny bends stay close to flat, so the slider has no jump at zero.
	const flat = layout({ type: type.id, bend: 0.5 }, glyphs, metrics);
	flat.forEach((placement, index) => {
		if (Math.abs(placement.x - glyphs[index].x) > 3 || Math.abs(placement.y - glyphs[index].y) > 3) fail(`${type.id} jumps away from flat at a tiny bend`);
	});
});

// Direction: a positive arc lifts the middle (ends droop), a negative one the reverse.
const arcUp = layout({ type: 'arc', bend: 50 }, glyphs, metrics);
const arcDown = layout({ type: 'arc', bend: -50 }, glyphs, metrics);
if (!(arcUp[0].y > arcUp[middle].y) || !(arcDown[0].y < arcDown[middle].y)) fail('arc direction');
if (!(arcUp[0].rotation < 0 && arcUp[6].rotation > 0)) fail('arc glyphs must lean along the curve');
if (!near(arcUp[middle].y, 40, 1e-6)) fail('arc must keep the middle baseline in place');
// Arc at 100% is a full circle: the ends come back near each other.
const circle = layout({ type: 'arc', bend: 100 }, glyphs, metrics);
if (Math.hypot(circle[0].x - circle[6].x, circle[0].y - circle[6].y) > 40) fail('arc at 100% must nearly close');
// The old Circle type loads as the merged Arc with its bend unchanged.
// Arch keeps the baseline and grows the middle; bulge grows about the middle.
const arch = layout({ type: 'arch', bend: 60 }, glyphs, metrics);
if (arch.some((placement, index) => placement.y !== glyphs[index].y)) fail('arch must keep the baseline flat');
if (!(arch[middle].scaleY > arch[0].scaleY)) fail('arch must grow toward the middle');
const bulge = layout({ type: 'bulge', bend: 60 }, glyphs, metrics);
if (!(bulge[middle].y > 40)) fail('bulge must scale about the glyph middle, moving the baseline down');
// Envelopes never fold the block, at any bend or position.
Object.values(types).filter((type) => type.envelope).forEach((type) => {
	for (let bend = -1; bend <= 1; bend += 0.25) {
		for (let u = 0; u <= 1; u += 0.125) {
			const edges = type.envelope(u, bend);
			if (!(1 + edges.bottom - edges.top > 0.1)) fail(`${type.id} folds the block at bend ${bend}, u ${u}`);
		}
	}
});
// Rise climbs to the right and pivots on the middle; Taper shrinks to the right.
const rise = layout({ type: 'rise', bend: 50 }, glyphs, metrics);
if (!(rise[0].y > 40 && rise[6].y < 40) || !near(rise[middle].y, 40, 1e-6)) fail('rise must climb to the right about the middle');
if (!near(rise[0].y - 40, 40 - rise[6].y, 1e-6)) fail('rise must be odd about the center');
const taper = layout({ type: 'taper', bend: 60 }, glyphs, metrics);
if (!(taper[0].scaleY > taper[6].scaleY)) fail('taper must shrink toward the right');
if (!(layout({ type: 'taper', bend: -60 }, glyphs, metrics)[0].scaleY < 1)) fail('a negative taper must shrink toward the left');
// Bow, Chevron and Ripple move both edges together (letters keep their
// height); Bow and Chevron lift the middle, Ripple is odd about the center.
['bow', 'chevron', 'ripple', 'rise'].forEach((id) => {
	if (layout({ type: id, bend: 70 }, glyphs, metrics).some((placement) => !near(placement.scaleY, 1, 1e-9))) fail(`${id} must keep the letter height`);
});
['bow', 'chevron'].forEach((id) => {
	const placed = layout({ type: id, bend: 50 }, glyphs, metrics);
	if (!(placed[middle].y < placed[0].y) || !near(placed[0].y, placed[6].y, 1e-6)) fail(`${id} must lift the middle evenly`);
});
const ripple = layout({ type: 'ripple', bend: 50 }, glyphs, metrics);
if (!near(ripple[middle].y, 40, 1e-6) || !near(ripple[1].y - 40, 40 - ripple[5].y, 1e-6) || near(ripple[1].y, 40, 1e-3)) fail('ripple must be odd about the center');
// Sag and Peak each hold one edge: Sag the top, Peak the bottom (the baseline here).
const peak = layout({ type: 'peak', bend: 50 }, glyphs, metrics);
if (peak.some((placement) => placement.y !== 40) || !(peak[middle].scaleY > peak[1].scaleY && peak[1].scaleY > peak[0].scaleY)) fail('peak must hold the bottom and point the top');
const sag = layout({ type: 'sag', bend: 50 }, glyphs, metrics);
if (!(sag[middle].y > 40) || !(sag[middle].scaleY > 1)) fail('sag must drop the bottom in the middle');
// Climb rises and grows toward the right.
const climb = layout({ type: 'climb', bend: 50 }, glyphs, metrics);
if (!(climb[6].y < climb[0].y) || !(climb[6].scaleY > climb[0].scaleY)) fail('climb must rise and grow to the right');
// A type with one tile keeps it when bent the other way.
if (matchPreset({ type: 'ripple', bend: -30 })?.id !== 'ripple' || !matchPreset({ type: 'ripple', bend: -30 }).modified) fail('a negative ripple must still match Ripple');
// An envelope box covers the edge's ends, not just the glyph center.
const sloped = run('getEnvelopeWarpBounds')({ type: 'rise', bend: 50 }, { left: 0, top: 20, right: 20, bottom: 40 }, metrics);
if (!(sloped.bottom > rise[0].y) || sloped.left !== 0 || sloped.right !== 20) fail('envelope bounds must cover the sloped edge');
if (!run('hasWarpEnvelope')({ type: 'arch', bend: 50 }) || run('hasWarpEnvelope')({ type: 'arc', bend: 50 }) || run('hasWarpEnvelope')({ type: 'arch', bend: 0 })) fail('hasWarpEnvelope');
// Waves: odd about the center. Flag keeps the middle glyph on its baseline;
// Wave leans it about its mid-height, so that point stays put instead.
const flag = layout({ type: 'flag', bend: 60 }, glyphs, metrics);
if (!near(flag[middle].y, 40, 1e-6)) fail('flag moved the middle glyph');
if (near(flag[1].y, 40, 1e-3)) fail('flag must displace off-center glyphs');
const wave = layout({ type: 'wave', bend: 60 }, glyphs, metrics);
const half = metrics.ascent / 2;
const midpoint = (placement) => ({ x: placement.x + half * Math.sin(placement.rotation), y: placement.y - half * Math.cos(placement.rotation) });
if (!near(midpoint(wave[middle]).x, 70, 1e-6) || !near(midpoint(wave[middle]).y, 40 - half, 1e-6)) fail('wave must lean the middle glyph about its mid-height');
if (near(midpoint(wave[1]).y, 40 - half, 1e-3)) fail('wave must displace off-center glyphs');
// Wave spaces letters by distance along the curve, so neighboring glyph
// midpoints stay one advance (20px) apart instead of stretching on the slopes.
for (let index = 1; index < wave.length; index += 1) {
	const a = midpoint(wave[index - 1]);
	const b = midpoint(wave[index]);
	if (Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 20) > 1) fail(`wave glyphs ${index - 1}-${index} are not evenly spaced along the curve`);
}
// A short word gets a gentler wave: its curve never bends tighter than the cap.
const short = layout({ type: 'wave', bend: 100 }, glyphs.slice(0, 2).map((glyph, index) => ({ ...glyph, x: 60 + index * 20 })), { ...metrics, width: 40 });
if (short.some((placement) => Math.abs(placement.rotation) > 0.6)) fail('a short wave must stay gentle');

// Bounds: identity for an unrotated glyph, and a quarter turn swaps extents.
const ink = { left: -8, right: 8, top: -20, bottom: 4 };
const straight = bounds({ x: 100, y: 50, rotation: 0, scaleY: 1 }, ink);
if (straight.left !== 92 || straight.right !== 108 || straight.top !== 30 || straight.bottom !== 54) fail('unrotated bounds');
const turned = bounds({ x: 0, y: 0, rotation: Math.PI / 2, scaleY: 1 }, ink);
if (!near(turned.right - turned.left, 24, 1e-9) || !near(turned.bottom - turned.top, 16, 1e-9)) fail('rotated bounds');
const tall = bounds({ x: 0, y: 0, rotation: 0, scaleY: 2 }, ink);
if (tall.top !== -40 || tall.bottom !== 8) fail('scaleY bounds');

// Presets: known types, bends in range, unique ids, recognized after apply.
const ids = new Set();
presets.entries.forEach((entry) => {
	if (ids.has(entry.id)) fail(`duplicate preset ${entry.id}`);
	ids.add(entry.id);
	if (!types[entry.value.type]) fail(`preset ${entry.id} names unknown type ${entry.value.type}`);
	if (entry.value.bend < spec.min || entry.value.bend > spec.max) fail(`preset ${entry.id} bend out of range`);
	const target = {};
	presets.apply(entry, target);
	if (findPreset(target.warp) !== entry.id) fail(`preset ${entry.id} is not recognized after apply`);
});
if (!ids.has('none')) fail('the grid needs a None preset');
// A bend tuned off every preset still names its nearest tile of the same
// type and direction, marked modified; a flat warp is None.
const edited = matchPreset({ type: 'arc', bend: 40 });
if (edited?.id !== 'arc' || !edited.modified) fail('arc at 40% must match Arc as edited');
if (matchPreset({ type: 'arc', bend: 90 })?.id !== 'circle') fail('arc at 90% must match Circle');
if (matchPreset({ type: 'arc', bend: -60 })?.id !== 'arc-down') fail('a negative arc must match Arc Down');
if (matchPreset({ type: 'bulge', bend: -10 })?.id !== 'pinch') fail('a negative bulge must match Pinch');
if (matchPreset({ type: 'wave', bend: 0 })?.id !== 'none') fail('a zero bend must match None');
if (findPreset({ type: 'arc', bend: 40 }) !== null) fail('findWarpPresetId must only return exact matches');

process.stdout.write(`Text warp unit passed (${Object.keys(types).length} types, ${presets.entries.length} presets)\n`);

// Text content and flat layout are shared by warp, editing and split.
for (const file of ['js/core/text-content.js', 'js/paint/text-layout.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
{
	const assert = require('assert');
	const graphemes = run('splitGraphemes');
	const cases = run('applyTextCase');
	const clamp = run('clampTextLength');
	for (const glyph of ['\uD83C\uDDFA\uD83C\uDDF8', '\uD83D\uDC4D\uD83C\uDFFD', 'e\u0301', '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67']) assert.equal(graphemes(glyph).length, 1);
	for (const [mode, expected] of [['none', 'hello WORLD'], ['upper', 'HELLO WORLD'], ['lower', 'hello world'], ['title', 'Hello WORLD'], ['alternating', 'hElLo WoRlD']]) assert.equal(cases('hello WORLD', mode), expected);
	assert.equal(clamp('A\uD83D\uDC4D\uD83C\uDFFDB', 2), 'A\uD83D\uDC4D\uD83C\uDFFD');
	const ctx = { measureText(text) { return { width: graphemes(text).length * 10, actualBoundingBoxLeft: 0, actualBoundingBoxRight: graphemes(text).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }; } };
	const textLayout = run('TextLayout');
	const data = { boxMode: 'autoHeight', boxWidth: 45, fontSize: 10, letterSpacing: 0, textCase: 'none', align: 'justify', verticalAlign: 'top', decoration: { underline: true }, warp: { type: 'none' } };
	const metrics = { fontSize: 10, letterSpacing: 0, lineHeightPx: 12, ascent: 8, descent: 2, minBoxSize: 4 };
	const measured = textLayout.layout(ctx, 'a b c d\nx', data, metrics);
	assert.equal(measured.layoutHeight, 34);
	assert.equal(measured.hasOverflow, false);
	assert.equal(measured.visibleLines[0].wrapped, true);
	assert.equal(measured.visibleLines[1].wrapped, false);
	assert.equal(measured.glyphs.at(-1).sourceIndex, 8);
	assert.equal(measured.decorations.length, 3);
	const fixed = textLayout.layout(ctx, 'a b c d\nx', { ...data, boxMode: 'fixed', boxHeight: 10 }, metrics);
	assert.equal(fixed.hasOverflow, true);
	assert.equal(fixed.visibleLines.length, 1);
	const expanded = textLayout.layout(ctx, '\u00dfA', { ...data, boxMode: 'point', textCase: 'upper' }, metrics);
	assert.deepEqual(Array.from(expanded.glyphs, glyph => glyph.sourceIndex), [0, 0, 1]);
	const emoji = textLayout.layout(ctx, 'A\uD83D\uDC4D\uD83C\uDFFDB', { ...data, boxMode: 'point' }, { ...metrics, letterSpacing: 3 });
	assert.equal(emoji.glyphs.length, 3);
	assert.equal(emoji.runs.length, 3);
	assert.equal(emoji.glyphs[2].sourceIndex, 5);
	assert.equal(textLayout.layout(ctx, 'abcdef', { ...data, boxWidth: 20 }, metrics).lines.length, 3);
	process.stdout.write('Text content/layout verification passed\n');
}
