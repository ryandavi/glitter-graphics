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
const metrics = { centerX: 70, centerY: 30, width: 140, fontSize: 32, ascent: 24 };
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
const legacy = normalize({ type: 'circle', bend: 80 });
if (legacy.type !== 'arc' || legacy.bend !== 80) fail('a saved circle warp must load as arc');
// Arch keeps the baseline and grows the middle; bulge grows about the middle.
const arch = layout({ type: 'arch', bend: 60 }, glyphs, metrics);
if (arch.some((placement, index) => placement.y !== glyphs[index].y)) fail('arch must keep the baseline flat');
if (!(arch[middle].scaleY > arch[0].scaleY)) fail('arch must grow toward the middle');
const bulge = layout({ type: 'bulge', bend: 60 }, glyphs, metrics);
if (!(bulge[middle].y > 40)) fail('bulge must scale about the glyph middle, moving the baseline down');
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
