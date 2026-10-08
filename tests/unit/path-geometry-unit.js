'use strict';

// Path geometry (js/paint/path-geometry.js): bounds, split, length, nearest
// point, fill and stroke hit tests, point edits, trimming, and the SVG path
// parser round-tripped over every svgPath in data/shapes.json.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const { PathGeometry: G } = require(path.join(root, 'js/paint/path-geometry.js'));
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/paths.json'), 'utf8'));
const shapes = JSON.parse(fs.readFileSync(path.join(root, 'data/shapes.json'), 'utf8')).shapes;

function fail(message) {
	throw new Error(`path-geometry: ${message}`);
}
function near(actual, expected, tolerance, label) {
	if (!(Math.abs(actual - expected) <= tolerance)) fail(`${label}: expected ${expected}, got ${actual}`);
}
const clone = (name) => G.cloneSubpaths(fixtures[name]);

// Every fixture is already in canonical form.
Object.keys(fixtures).forEach((name) => {
	if (JSON.stringify(G.normalizeSubpaths(clone(name))) !== JSON.stringify(fixtures[name])) fail(`${name} is not canonical`);
});

// Bounds use curve extrema, not control points.
{
	const line = G.getBounds(clone('line'));
	near(line.width, 100, 1e-9, 'line width');
	near(line.height, 0, 1e-9, 'line height');
	const loop = G.getBounds(clone('loop'));
	near(loop.minY, -50, 1e-6, 'loop top (extremum at t = 0.5, not the control points)');
	const blob = G.getBounds(clone('closedBlob'));
	near(blob.minX, -50, 0.01, 'blob left');
	near(blob.maxX, 50, 0.01, 'blob right');
}

// Split: both halves stay on the original curve and meet at the split point.
{
	const segment = G.getSegment(clone('sCurve')[0], 0);
	const [left, right] = G.split(segment, 0.3);
	const at = G.evaluate(segment, 0.3);
	near(left[3].x, at.x, 1e-9, 'split x');
	near(right[0].y, at.y, 1e-9, 'split y');
	const sample = G.evaluate(left, 0.5);
	const original = G.evaluate(segment, 0.15);
	near(sample.x, original.x, 1e-9, 'left half x');
	near(sample.y, original.y, 1e-9, 'left half y');
}

// Length and point-at-length.
{
	near(G.getLength(clone('line')[0]), 100, 1e-9, 'line length');
	near(G.getLength(clone('lCorner')[0]), 160, 1e-9, 'L length');
	// The blob approximates a circle of radius 50.
	near(G.getLength(clone('closedBlob')[0]), 2 * Math.PI * 50, 1, 'blob length');
	const corner = G.locationAtLength(clone('lCorner')[0], 80);
	near(corner.x, -40, 1e-6, 'L corner x');
	near(corner.y, 40, 1e-6, 'L corner y');
	const middle = G.locationAtLength(clone('line')[0], 25);
	near(middle.x, -25, 1e-9, 'line quarter');
	near(middle.tangent.x, 1, 1e-9, 'line tangent');
	const ends = G.getEndTangents(clone('lCorner')[0]);
	near(ends.start.y, 1, 1e-9, 'L start tangent');
	near(ends.end.x, 1, 1e-9, 'L end tangent');
}

// Nearest point and hit tests.
{
	const nearest = G.nearestPoint(clone('line'), { x: 10, y: 7 });
	near(nearest.x, 10, 1e-6, 'nearest x');
	near(nearest.distance, 7, 1e-6, 'nearest distance');
	near(nearest.t, 0.6, 1e-6, 'nearest t');
	const onBlob = G.nearestPoint(clone('closedBlob'), { x: 80, y: 0 });
	near(onBlob.distance, 30, 0.05, 'blob nearest distance');
	if (!G.hitTestStroke(clone('line'), { x: 0, y: 3 }, 4)) fail('stroke hit missed');
	if (G.hitTestStroke(clone('line'), { x: 0, y: 5 }, 4)) fail('stroke hit too wide');
	if (!G.containsPoint(clone('closedBlob'), { x: 0, y: 0 })) fail('blob center is inside');
	if (G.containsPoint(clone('closedBlob'), { x: 49, y: 49 })) fail('blob corner is outside');
	// The hole is wound the other way, so it is empty under both rules.
	if (G.containsPoint(clone('ring'), { x: 0, y: 0 }, 'nonzero')) fail('ring hole filled (nonzero)');
	if (G.containsPoint(clone('ring'), { x: 0, y: 0 }, 'evenodd')) fail('ring hole filled (evenodd)');
	if (!G.containsPoint(clone('ring'), { x: 35, y: 0 })) fail('ring band is inside');
	// An open path fills as if closed.
	if (!G.containsPoint(clone('lCorner'), { x: -20, y: 20 })) fail('open path fill');
}

// Insert keeps the outline; delete restores it closely.
{
	const subpath = clone('sCurve')[0];
	const before = [0.2, 0.5, 0.8].map((t) => G.evaluate(G.getSegment(subpath, 0), t));
	const index = G.insertPoint(subpath, 0, 0.5);
	if (index !== 1 || subpath.points.length !== 4) fail('insert index');
	near(G.evaluate(G.getSegment(subpath, 0), 0.4).x, before[0].x, 1e-9, 'insert keeps curve (left)');
	near(G.evaluate(G.getSegment(subpath, 1), 0.6).y, before[2].y, 1e-9, 'insert keeps curve (right)');
	G.deletePoint(subpath, 1);
	if (subpath.points.length !== 3) fail('delete count');
	// The refit curve passes where the old one did (its parameter may differ).
	before.forEach((point) => near(G.nearestPoint([subpath], point).distance, 0, 1, 'delete refit'));

	const corner = clone('lCorner')[0];
	G.deletePoint(corner, 1);
	if (!G.isSegmentStraight(corner, 0)) fail('deleting a corner between lines leaves a line');
	const straight = clone('line')[0];
	G.insertPoint(straight, 0, 0.25);
	if (straight.points[1].in || straight.points[1].out) fail('a point inserted on a line has no handles');
	near(straight.points[1].x, -25, 1e-9, 'insert on line');

	const blob = clone('closedBlob')[0];
	G.deletePoint(blob, 0);
	if (!blob.closed || blob.points.length !== 3) fail('closed delete');
	G.deletePoint(blob, 0);
	if (blob.closed) fail('a two-point path cannot stay closed');
}

// Dragging a segment puts the curve under the pointer.
{
	const subpath = clone('line')[0];
	const segment = G.getSegment(subpath, 0);
	const handles = G.dragSegment(segment, 0.5, { x: 0, y: 20 });
	subpath.points[0].out = handles.out;
	subpath.points[1].in = handles.in;
	const at = G.evaluate(G.getSegment(subpath, 0), 0.5);
	near(at.x, 0, 1e-9, 'drag segment x');
	near(at.y, 20, 1e-9, 'drag segment y');
}

// Handle constraints and point types.
{
	const point = { x: 0, y: 0, in: { x: -10, y: 0 }, out: { x: 30, y: 0 }, type: 'smooth' };
	point.out = { x: 0, y: 30 };
	G.constrainHandles(point, 'out');
	near(point.in.x, 0, 1e-9, 'smooth keeps collinear x');
	near(point.in.y, -10, 1e-9, 'smooth keeps its own length');
	point.type = 'mirrored';
	G.constrainHandles(point, 'out');
	near(point.in.y, -30, 1e-9, 'mirrored matches length');

	const subpath = clone('lCorner')[0];
	G.setPointType(subpath, 1, 'smooth');
	const middle = subpath.points[1];
	if (!middle.in || !middle.out) fail('smooth corner gains handles');
	near(middle.in.x * middle.out.y - middle.in.y * middle.out.x, 0, 1e-6, 'smooth handles are collinear');
	G.removeHandles(subpath, 1);
	if (middle.in || middle.out || middle.type !== 'corner') fail('removeHandles');

	const auto = clone('lCorner')[0];
	auto.points.forEach((entry) => { entry.type = 'auto'; });
	G.solveAutoHandles(auto);
	if (auto.points[0].out || auto.points[2].in) fail('open ends get no auto handles');
	near(auto.points[1].out.x, auto.points[1].out.y, 1e-6, 'auto handle follows its neighbours');
}

// Reverse, scale, recenter.
{
	const subpath = clone('sCurve')[0];
	const length = G.getLength(subpath);
	G.reverseSubpath(subpath);
	near(subpath.points[0].x, 60, 1e-9, 'reverse order');
	near(subpath.points[0].out.x, -30, 1e-9, 'reverse swaps handles');
	near(G.getLength(subpath), length, 1e-6, 'reverse keeps length');

	const scaled = G.scaleSubpaths(clone('closedBlob'), 2, 0.5);
	const bounds = G.getBounds(scaled);
	near(bounds.width, 200, 0.05, 'scaled width');
	near(bounds.height, 50, 0.05, 'scaled height');

	const moved = G.translateSubpaths(clone('line'), 13.337, -4);
	const offset = G.recenter(moved);
	near(offset.x, 13.34, 1e-9, 'recenter offset x');
	near(offset.y, -4, 1e-9, 'recenter offset y');
	const centered = G.getBounds(moved);
	near(centered.minX + centered.maxX, 0, 0.011, 'recentered on origin');
}

// Trim by length.
{
	const trimmed = G.trimSubpath(clone('lCorner')[0], 10, 150);
	near(G.getLength(trimmed), 140, 1e-6, 'trimmed length');
	near(trimmed.points[0].y, -30, 1e-6, 'trim start');
	near(trimmed.points[trimmed.points.length - 1].x, 30, 1e-6, 'trim end');
	if (trimmed.points.length !== 3) fail('trim keeps the corner');
	const curve = clone('sCurve')[0];
	const total = G.getLength(curve);
	const piece = G.trimSubpath(curve, total * 0.25, total * 0.75);
	near(G.getLength(piece), total * 0.5, 0.2, 'trimmed curve length');
	if (G.trimSubpath(clone('line')[0], 60, 40)) fail('an inverted trim is empty');
	if (G.trimSubpath(clone('closedBlob')[0], 0, 10)) fail('closed paths are not trimmed');
}

// SVG parser: commands, relative forms, arcs, shorthand curves.
{
	const parsed = G.parseSvgPath('M10 10 h20 v20 h-20 z m40 0 l10 0 0 10 z');
	if (parsed.length !== 2 || !parsed[0].closed || parsed[0].points.length !== 4) fail('H/V/Z parse');
	near(parsed[1].points[0].x, 50, 1e-9, 'relative move after close');
	near(parsed[1].points[2].y, 20, 1e-9, 'implicit lineto');

	const arc = G.parseSvgPath('M0 50 A50 50 0 1 1 100 50 A50 50 0 1 1 0 50 Z');
	const arcBounds = G.getBounds(arc);
	near(arcBounds.minY, 0, 0.05, 'arc top');
	near(arcBounds.maxY, 100, 0.05, 'arc bottom');
	near(G.getLength(arc[0]), Math.PI * 100, 0.2, 'arc circle length');
	const compact = G.parseSvgPath('M0 50a50 50 0 01100 0');
	near(compact[0].points[compact[0].points.length - 1].x, 100, 1e-9, 'compact arc flags');

	const quad = G.parseSvgPath('M0 0 Q50 100 100 0 T200 0');
	near(G.evaluate(G.getSegment(quad[0], 0), 0.5).y, 50, 1e-9, 'quadratic midpoint');
	near(G.evaluate(G.getSegment(quad[0], 1), 0.5).y, -50, 1e-9, 'reflected quadratic');
	const smooth = G.parseSvgPath('M0 0 C0 50 50 50 50 0 S100 -50 100 0');
	near(smooth[0].points[1].out.y, -50, 1e-9, 'reflected cubic control');
	if (smooth[0].points[1].type !== 'smooth') fail('collinear handles parse as smooth');
}

// Round trip every manifest shape: parse, write, parse again.
{
	let checked = 0;
	shapes.filter((shape) => shape.svgPath).forEach((shape) => {
		const first = G.parseSvgPath(shape.svgPath);
		if (!first.length) fail(`${shape.id}: no subpaths`);
		const written = G.toSvgPath(first);
		const second = G.parseSvgPath(written);
		if (G.toSvgPath(second) !== written) fail(`${shape.id}: round trip changed the path`);
		if (second.length !== first.length) fail(`${shape.id}: subpath count`);
		const a = G.getBounds(first);
		const b = G.getBounds(second);
		['minX', 'minY', 'maxX', 'maxY'].forEach((key) => near(b[key], a[key], 0.002, `${shape.id} ${key}`));
		// A parsed shape sits inside its source box.
		const box = shape.sourceBounds || [0, 0, shape.viewBox, shape.viewBox];
		const slack = Math.max(box[2], box[3]) * 0.02;
		if (a.minX < box[0] - slack || a.minY < box[1] - slack || a.maxX > box[0] + box[2] + slack || a.maxY > box[1] + box[3] + slack) {
			fail(`${shape.id}: parsed bounds leave its box`);
		}
		first.forEach((subpath, index) => near(G.getLength(second[index]), G.getLength(subpath), 0.05, `${shape.id} length`));
		checked++;
	});
	if (checked < 30) fail(`only ${checked} manifest paths checked`);
}

// 45-degree constraint.
{
	const snapped = G.constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
	near(snapped.y, 0, 1e-9, 'constrain to horizontal');
	const diagonal = G.constrainAngle({ x: 0, y: 0 }, { x: 10, y: 9 });
	near(diagonal.x, diagonal.y, 1e-9, 'constrain to diagonal');
}


// Handleless endpoints and isolated points accept every explicit point type.
{
	for (const points of [[{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 60, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 0 }]]) {
		for (const type of ['smooth', 'mirrored']) {
			const subpath = G.normalizeSubpaths([{ closed: false, points }])[0];
			G.setPointType(subpath, 0, type);
			G.setPointType(subpath, points.length - 1, type);
			if (subpath.points.some((point) => point.type !== type)) fail('endpoint point type');
			if (points.length === 2 && points[1].x === 60) {
				near(subpath.points[0].out.x, 20, 1e-9, 'endpoint leading handle');
				near(subpath.points[1].in.x, -20, 1e-9, 'endpoint trailing handle');
			}
		}
	}
	for (const data of ['M0 0 L5 5 Z 3 4', 'M0 0 z 3']) {
		let threw = false;
		try { G.parseSvgPath(data); } catch (error) { threw = /Malformed/.test(error.message); }
		if (!threw) fail('numbers after close must throw');
	}
	if (G.parseSvgPath('M0 0 L5 5 Z M3 4 L7 8').length !== 2) fail('command after close');
}

// Placement honors the rounding switch before creating or constraining points.
{
	const context = {
		CONFIG: { tools: { stickers: { transform: { roundValues: false } }, path: { line: { angleStepDeg: 45 } } }, snapping: { targets: { point: {} }, threshold: 5 } },
		PREFERENCES: { get: () => false }, PathGeometry: G, LayerType: { PATH: 'path' }
	};
	require('vm').createContext(context);
	require('vm').runInContext(fs.readFileSync(path.join(root, 'js/ui/path-edit.js'), 'utf8') + '\nthis.PathEditSession = PathEditSession;', context);
	const session = Object.create(context.PathEditSession.prototype);
	let placed;
	session.editor = {
		clearSmartGuides() {}, viewport: { isWithinCanvas: () => true },
		layerManager: { addLayer: (type, options) => { placed = options.pathLayer.subpaths[0].points[0]; return null; } }
	};
	session.startNewPath({ x: 10.25, y: 20.75 }, {});
	near(placed.x, 10.25, 1e-9, 'fractional first point');
	session.session = { mode: 'draw', drawEnd: { subpath: 0, atStart: false } };
	const subpaths = [{ points: [{ x: 0, y: 0 }] }];
	const target = { x: 10.25, y: 1.25 };
	const expected = G.constrainAngle(subpaths[0].points[0], target, 45);
	near(session.resolvePlacement(target, { shiftKey: true }, subpaths).x, expected.x, 1e-9, 'fractional constrained placement');
	context.CONFIG.tools.stickers.transform.roundValues = true;
	near(session.resolvePlacement(target, { shiftKey: true }, subpaths).x, Math.round(expected.x), 1e-9, 'rounded constrained placement');
}

console.log('path-geometry-unit: ok');
