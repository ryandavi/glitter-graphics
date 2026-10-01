'use strict';

// Frame registries and pure geometry (js/paint/frames.js): style band tables,
// kinds, presets, side split, shading and image placement. The masks
// themselves need a canvas; their preview/export parity is covered in the
// browser.

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
	'js/effects/color-adjust.js',
	'js/ui/preset-library.js',
	'js/paint/nine-slice.js',
	'js/paint/frames.js'
]) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const run = (code) => vm.runInContext(code, context);

function fail(message) {
	throw new Error(`frames: ${message}`);
}

const styles = run('FRAME_STYLES');
const kinds = run('FRAME_KINDS');
const presets = run('FRAME_PRESETS');
const fields = run('FIELDS');

// Styles: every band is a slice of the ring with a shade per side.
Object.values(styles).forEach((style) => {
	if (!style.label || !style.bands.length) fail(`style ${style.id} needs a label and bands`);
	let previous = 0;
	style.bands.forEach((band, index) => {
		if (!(band.from >= previous && band.from < band.to && band.to <= 1)) fail(`style ${style.id} band ${index} is not an ordered slice of [0, 1]`);
		previous = band.to;
		['top', 'right', 'bottom', 'left'].forEach((side) => {
			if (![-1, 0, 1].includes(band.shades[side])) fail(`style ${style.id} band ${index} ${side} shade`);
		});
		if (![null, 'dotted', 'dashed'].includes(band.pattern)) fail(`style ${style.id} band ${index} pattern ${band.pattern}`);
	});
});
if (JSON.stringify(run("getOptionValues('frameStyle')")) !== JSON.stringify(Object.keys(styles))) fail('frameStyle options differ from FRAME_STYLES');
if (JSON.stringify(run("getOptionValues('frameKind')")) !== JSON.stringify(Object.keys(kinds))) fail('frameKind options differ from FRAME_KINDS');
const defaults = run('CONFIG.tools.frames.defaults');
if (!styles[defaults.style] || !kinds[defaults.kind] || !run(`isOptionValue('frameFit', ${JSON.stringify(defaults.fit)})`)) fail('CONFIG frame defaults name unknown registry entries');
// CSS: inset is dark top-left, outset the reverse; groove and ridge are halves.
if (styles.inset.bands[0].shades.top !== -1 || styles.outset.bands[0].shades.top !== 1) fail('inset/outset shading');
if (styles.groove.bands[0].shades.top !== -1 || styles.ridge.bands[0].shades.top !== 1) fail('groove/ridge outer halves');

// Presets: shape only (never paint), every shape key set, in field range,
// recognized after apply.
const presetFields = { widthPx: 'frameThickness', radius: 'frameRadius', shade: 'frameShade' };
presets.entries.forEach((entry) => {
	const value = entry.value;
	const keys = ['style', ...Object.keys(presetFields)];
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(`preset ${entry.id} must set exactly ${keys.join(', ')}`);
	if (!styles[value.style]) fail(`preset ${entry.id} style ${value.style}`);
	Object.entries(presetFields).forEach(([key, spec]) => {
		if (value[key] == null) return;
		if (value[key] < fields[spec].min || value[key] > fields[spec].max) fail(`preset ${entry.id} ${key} outside its field range`);
	});
	context.presetTarget = { kind: 'image', style: 'solid', widthPx: 1, radius: 99, shade: 1, fill: { color: '#000000' } };
	run(`FRAME_PRESETS.apply(${JSON.stringify(entry.id)}, presetTarget)`);
	if (context.presetTarget.kind !== 'style') fail(`preset ${entry.id} does not switch to the style kind`);
	if (context.presetTarget.fill.color !== '#000000') fail(`preset ${entry.id} changed the paint`);
	if (run('findFramePresetId(presetTarget)') !== entry.id) fail(`preset ${entry.id} is not recognized after applying it`);
});

// Sides meet at the corner diagonals; nearest edge wins.
[[[1, 50, 100, 100], 'left'], [[50, 1, 100, 100], 'top'], [[99, 50, 100, 100], 'right'], [[50, 99, 100, 100], 'bottom'], [[5, 20, 200, 40], 'left'], [[30, 20, 200, 40], 'top']]
	.forEach(([args, side]) => {
		const got = run(`getFrameSide(${args.join(',')})`);
		if (got !== side) fail(`getFrameSide(${args}) = ${got}, expected ${side}`);
	});

// Ring clamps to the box.
const ring = run('getFrameRing({ widthPx: 500, radius: 900 }, 100, 60)');
if (ring.thickness !== 30 || ring.radius !== 30) fail(`ring clamp gave ${JSON.stringify(ring)}`);

// Shading: flat bands keep the source; solid scales; glitter multiplies.
context.solid = { mode: 'solid', color: '#804020', opacity: 1 };
if (run('shadeFramePaintSource(solid, 0, 40)') !== context.solid) fail('a flat band must keep its source');
if (run('shadeFramePaintSource(solid, -1, 50).color') !== '#402010') fail('dark shading of a solid color');
if (run('shadeFramePaintSource(solid, 1, 100).color') !== '#ff8040') fail('light shading of a solid color');
context.glitter = { mode: 'glitter', glitterId: 1, colorAdjust: { hue: 10, saturation: 100, brightness: 80 } };
const shaded = run('shadeFramePaintSource(glitter, 1, 50).colorAdjust');
if (shaded.brightness !== 120 || shaded.hue !== 10) fail(`glitter shading gave ${JSON.stringify(shaded)}`);

// Image placement: stretch fills, contain centers.
const stretch = run("getFrameImagePlacement('stretch', 100, 50, 200, 200)");
const contain = run("getFrameImagePlacement('contain', 100, 50, 200, 200)");
if (stretch.width !== 200 || stretch.height !== 200) fail('stretch placement');
if (contain.width !== 200 || contain.height !== 100 || contain.y !== 50) fail(`contain placement ${JSON.stringify(contain)}`);

// Border scale stays in base asset pixels when a decoded source is a variant.
context.slicedFrame = {
	fit: 'slice', sliceScale: 200,
	image: { width: 100, height: 100, isPixelated: true, slice: { top: 10, right: 10, bottom: 10, left: 10, mode: 'stretch' } }
};
const nativeRects = run('getFrameSliceRects(slicedFrame, 100, 100, 300, 200)');
const variantRects = run('getFrameSliceRects(slicedFrame, 200, 200, 300, 200)');
if (nativeRects.length !== 9 || nativeRects[0].dw !== 20 || nativeRects[0].dh !== 20) fail('frame border scale');
if (variantRects[0].sw !== 20 || variantRects[0].dw !== 20) fail('variant changes frame border size');
if (JSON.stringify(nativeRects.map(({ dx, dy, dw, dh }) => [dx, dy, dw, dh])) !== JSON.stringify(variantRects.map(({ dx, dy, dw, dh }) => [dx, dy, dw, dh]))) fail('variant destination geometry differs');
context.slicedFrame.sliceScale = 300;
if (run('getFrameSliceRects(slicedFrame, 200, 200, 300, 200)')[0].dw !== 30) fail('variant re-snaps the base border scale');
context.slicedFrame.fit = 'stretch';
if (run('getFrameSliceRects(slicedFrame, 100, 100, 300, 200)') !== null) fail('plain stretch still slices');
context.slicedFrame.fit = 'slice';
context.slicedFrame.image.slice = null;
if (run('getFrameSliceRects(slicedFrame, 100, 100, 300, 200)') !== null) fail('unsliced asset supplies rectangles');

process.stdout.write(`Frames verification passed (${Object.keys(styles).length} styles, ${Object.keys(kinds).length} kinds, ${presets.entries.length} presets)\n`);
