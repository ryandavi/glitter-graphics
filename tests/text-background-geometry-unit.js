'use strict';

// Node-side unit coverage for the Text Background geometry generator
// (docs/DYNAMIC-TEXT-BACKGROUND-IMPLEMENTATION-PLAN.md, "Geometry test
// cases"). Pure function, no DOM — loaded into a vm context the same way
// gif-palette-unit.js loads GifPalette.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { Math };
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'effects', 'text-background-geometry.js'), 'utf8');
vm.runInContext(`${source}\nglobalThis.generateTextBackgroundGeometry = generateTextBackgroundGeometry;`, context);
const generate = context.generateTextBackgroundGeometry;

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

// A line at a given left/right ink extent and vertical slot, using a shared
// lineHeightPx/ascent/descent so gaps come out predictable.
const LINE_HEIGHT = 40;
const ASCENT = 28;
const DESCENT = 8; // expectedGap = 40 - (28 + 8) = 4

function line(index, left, right) {
	const top = index * LINE_HEIGHT;
	return { left, top, right, bottom: top + ASCENT + DESCENT, blank: false };
}

function blank(index) {
	return { blank: true };
}

const baseLayout = (lines) => ({ lines, textInkRect: null, boxRect: null, lineHeightPx: LINE_HEIGHT, ascent: ASCENT, descent: DESCENT });

// --- Separate mode: always one shape per non-blank line ---------------------
{
	const layout = baseLayout([line(0, 0, 100), line(1, 0, 60)]);
	const geometry = generate(layout, { mode: 'lines', lineConnection: 'separate', horizontalPadding: 4, verticalPadding: 2, cornerRadius: 6 });
	assert(geometry.shapes.length === 2, 'Separate mode should keep each line as its own shape.');
	console.log('PASS separate line connection keeps independent shapes');
}

// --- Equal-width adjacent lines merge into a simple connected shape --------
{
	const layout = baseLayout([line(0, 0, 100), line(1, 0, 100)]);
	const geometry = generate(layout, { mode: 'lines', lineConnection: 'merge-adjacent', mergeDistance: 20, lineSpacingSensitivity: 0, horizontalPadding: 0, verticalPadding: 0, cornerRadius: 0 });
	assert(geometry.shapes.length === 1, 'Equal-width adjacent lines within threshold should merge into one shape.');
	const xs = geometry.shapes[0].points.map((p) => p[0]);
	assert(new Set(xs).size === 2, 'Equal-width merge should produce a plain rectangle (only two distinct X values).');
	console.log('PASS equal-width adjacent lines merge into a simple rectangle');
}

// --- Different-width lines preserve stepped edges (left-aligned) ----------
{
	const layout = baseLayout([line(0, 0, 200), line(1, 0, 80)]);
	const geometry = generate(layout, { mode: 'lines', lineConnection: 'merge-adjacent', mergeDistance: 20, lineSpacingSensitivity: 0, horizontalPadding: 0, verticalPadding: 0, cornerRadius: 0 });
	assert(geometry.shapes.length === 1, 'Different-width adjacent lines within threshold should still merge into one shape.');
	const rightXs = new Set(geometry.shapes[0].points.map((p) => p[0]));
	assert(rightXs.has(200) && rightXs.has(80) && rightXs.has(0), 'Stepped right edge (200 vs 80) should survive the merge.');
	console.log('PASS different-width lines preserve stepped right edge');
}

// --- Large vertical gap stays separate --------------------------------------
{
	const layout = baseLayout([
		{ left: 0, top: 0, right: 100, bottom: 36, blank: false },
		{ left: 0, top: 400, right: 100, bottom: 436, blank: false }
	]);
	const geometry = generate(layout, { mode: 'lines', lineConnection: 'merge-adjacent', mergeDistance: 10, lineSpacingSensitivity: 0, horizontalPadding: 0, verticalPadding: 0, cornerRadius: 0 });
	assert(geometry.shapes.length === 2, 'A gap far beyond the merge threshold should keep lines separate.');
	console.log('PASS large vertical gap keeps lines separate');
}

// --- Blank line between close lines is a hard separator ---------------------
{
	const layout = baseLayout([line(0, 0, 100), blank(1), line(2, 0, 100)]);
	const geometry = generate(layout, { mode: 'lines', lineConnection: 'connected', mergeDistance: 1000, lineSpacingSensitivity: 100, horizontalPadding: 0, verticalPadding: 0, cornerRadius: 0 });
	assert(geometry.shapes.length === 2, 'A blank line must break the merge group even with maximal merge settings.');
	console.log('PASS blank line forces a hard separator between merge groups');
}

// --- Tight spacing merges more readily than the base mergeDistance alone ---
{
	// Gap of 2px: tighter than the expected 4px gap at this line height.
	const layout = baseLayout([
		{ left: 0, top: 0, right: 100, bottom: 36, blank: false },
		{ left: 0, top: 38, right: 100, bottom: 74, blank: false }
	]);
	const loose = generate(layout, { mode: 'lines', lineConnection: 'merge-adjacent', mergeDistance: 0, lineSpacingSensitivity: 0, horizontalPadding: 0, verticalPadding: 0, cornerRadius: 0 });
	const sensitive = generate(layout, { mode: 'lines', lineConnection: 'merge-adjacent', mergeDistance: 0, lineSpacingSensitivity: 100, horizontalPadding: 0, verticalPadding: 0, cornerRadius: 0 });
	assert(loose.shapes.length === 2, 'With sensitivity 0 and mergeDistance 0, a positive gap should not merge.');
	assert(sensitive.shapes.length === 1, 'Tighter-than-normal spacing with sensitivity should merge even at mergeDistance 0.');
	console.log('PASS line spacing sensitivity increases merging for tight spacing');
}

// --- One-character line beside a long line: stable concave transition -----
{
	const layout = baseLayout([line(0, 0, 300), line(1, 130, 170)]);
	const geometry = generate(layout, { mode: 'lines', lineConnection: 'merge-adjacent', mergeDistance: 20, lineSpacingSensitivity: 0, horizontalPadding: 0, verticalPadding: 0, cornerRadius: 500 });
	assert(geometry.shapes.length === 1, 'A short line beside a long one within threshold should still merge.');
	const shape = geometry.shapes[0];
	shape.points.forEach(([x, y]) => {
		assert(Number.isFinite(x) && Number.isFinite(y), 'Merged polygon with an extreme radius must not produce NaN/Infinity points.');
	});
	assert(shape.points.length >= 4, 'A concave (short-beside-long) merge should produce a real stepped polygon, not a degenerate shape.');
	console.log('PASS very high radius and a short-beside-long merge stay numerically stable');
}

// --- Text Bounds / Text Box modes -------------------------------------------
{
	const layout = { lines: [], textInkRect: { x: 10, y: 5, width: 120, height: 40 }, boxRect: { x: 0, y: 0, width: 200, height: 100 }, lineHeightPx: LINE_HEIGHT, ascent: ASCENT, descent: DESCENT };
	const bounds = generate(layout, { mode: 'text-bounds', horizontalPadding: 10, verticalPadding: 5, cornerRadius: 8 });
	assert(bounds.shapes.length === 1, 'Text Bounds mode should produce exactly one shape.');
	assert(bounds.bounds.width === 120 + 20 && bounds.bounds.height === 40 + 10, 'Text Bounds padding should expand the ink rect symmetrically.');

	const box = generate(layout, { mode: 'text-box', horizontalPadding: 0, verticalPadding: 0, cornerRadius: 8 });
	assert(box.shapes.length === 1 && box.bounds.width === 200 && box.bounds.height === 100, 'Text Box mode should use the container bounds regardless of ink content.');
	console.log('PASS text-bounds and text-box modes use the correct source rect');
}

// --- Empty input is handled without throwing --------------------------------
{
	const empty = generate({ lines: [], textInkRect: null, boxRect: null }, { mode: 'lines' });
	assert(empty.shapes.length === 0 && empty.bounds === null, 'No lines should produce no geometry, not an error.');
	console.log('PASS empty text produces no geometry');
}
