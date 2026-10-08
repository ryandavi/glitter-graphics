'use strict';

// Path geometry (DOM-free, worker-safe). Everything that needs Bézier math
// calls this file: path masks, picking, the point editor, stroke ornaments
// and trimming.
//
// A path is a list of subpaths:
//   { closed, points: [{ x, y, in, out, type }] }
// `in` and `out` are handle offsets from the anchor ({ x, y }) or null for no
// handle. A segment runs from one point to the next (and from the last back to
// the first when closed); it is straight when both of its handles are null.
// `type` is 'corner', 'smooth' (collinear handles, free lengths), 'mirrored'
// (collinear, equal lengths) or 'auto' (handles derived from the neighbours).
const PathGeometry = (() => {
	const POINT_TYPES = Object.freeze(['corner', 'smooth', 'mirrored', 'auto']);
	const EPSILON = 1e-9;
	// Stored coordinates round to this many decimals so repeated edits and
	// re-centering cannot drift.
	const PRECISION = 100;
	const FLATTEN_TOLERANCE = 0.25;
	// Fraction of the distance to a neighbour an auto point's handle spans.
	const AUTO_HANDLE_RATIO = 1 / 3;

	const round = (value) => Math.round(value * PRECISION) / PRECISION || 0;
	const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
	const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
	const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
	const length = (a) => Math.hypot(a.x, a.y);
	const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
	const normalize = (a) => {
		const size = length(a);
		return size > EPSILON ? { x: a.x / size, y: a.y / size } : null;
	};
	const isZero = (handle) => !handle || (Math.abs(handle.x) < EPSILON && Math.abs(handle.y) < EPSILON);

	function clonePoint(point) {
		return {
			x: point.x,
			y: point.y,
			in: point.in ? { x: point.in.x, y: point.in.y } : null,
			out: point.out ? { x: point.out.x, y: point.out.y } : null,
			type: point.type
		};
	}

	function cloneSubpaths(subpaths) {
		return (subpaths || []).map((subpath) => ({ closed: Boolean(subpath.closed), points: subpath.points.map(clonePoint) }));
	}

	function normalizeHandle(handle) {
		const x = Number(handle?.x);
		const y = Number(handle?.y);
		if (!Number.isFinite(x) || !Number.isFinite(y) || (Math.abs(x) < 0.005 && Math.abs(y) < 0.005)) return null;
		return { x: round(x), y: round(y) };
	}

	// Canonical stored form: finite rounded numbers, known point types, no
	// zero-length handles, no empty subpaths.
	function normalizeSubpaths(subpaths) {
		return (Array.isArray(subpaths) ? subpaths : []).map((subpath) => ({
			closed: Boolean(subpath?.closed),
			points: (Array.isArray(subpath?.points) ? subpath.points : [])
				.filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
				.map((point) => ({
					x: round(Number(point.x)),
					y: round(Number(point.y)),
					in: normalizeHandle(point.in),
					out: normalizeHandle(point.out),
					type: POINT_TYPES.includes(point.type) ? point.type : 'corner'
				}))
		})).filter((subpath) => subpath.points.length > 0);
	}

	function countPoints(subpaths) {
		return (subpaths || []).reduce((total, subpath) => total + subpath.points.length, 0);
	}

	// ===== SEGMENTS =====

	function segmentCount(subpath) {
		const count = subpath?.points?.length || 0;
		if (count < 2) return 0;
		return subpath.closed ? count : count - 1;
	}

	// Control points of segment `index`: [p0, p1, p2, p3]. A straight segment
	// puts its inner control points at thirds, so its parameter is distance.
	function getSegment(subpath, index) {
		const points = subpath.points;
		const a = points[index];
		const b = points[(index + 1) % points.length];
		if (isZero(a.out) && isZero(b.in)) {
			return [{ x: a.x, y: a.y }, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), { x: b.x, y: b.y }];
		}
		return [
			{ x: a.x, y: a.y },
			a.out ? { x: a.x + a.out.x, y: a.y + a.out.y } : { x: a.x, y: a.y },
			b.in ? { x: b.x + b.in.x, y: b.y + b.in.y } : { x: b.x, y: b.y },
			{ x: b.x, y: b.y }
		];
	}

	function isSegmentStraight(subpath, index) {
		const points = subpath.points;
		return isZero(points[index].out) && isZero(points[(index + 1) % points.length].in);
	}

	function evaluate(segment, t) {
		const u = 1 - t;
		const a = u * u * u;
		const b = 3 * u * u * t;
		const c = 3 * u * t * t;
		const d = t * t * t;
		return {
			x: a * segment[0].x + b * segment[1].x + c * segment[2].x + d * segment[3].x,
			y: a * segment[0].y + b * segment[1].y + c * segment[2].y + d * segment[3].y
		};
	}

	function derivative(segment, t) {
		const u = 1 - t;
		return {
			x: 3 * u * u * (segment[1].x - segment[0].x) + 6 * u * t * (segment[2].x - segment[1].x) + 3 * t * t * (segment[3].x - segment[2].x),
			y: 3 * u * u * (segment[1].y - segment[0].y) + 6 * u * t * (segment[2].y - segment[1].y) + 3 * t * t * (segment[3].y - segment[2].y)
		};
	}

	// Unit tangent at t. A zero-length handle makes the derivative vanish at
	// that end, so fall back to the next control point that differs.
	function tangent(segment, t) {
		const direct = normalize(derivative(segment, t));
		if (direct) return direct;
		const candidates = t < 0.5
			? [sub(segment[2], segment[0]), sub(segment[3], segment[0])]
			: [sub(segment[3], segment[1]), sub(segment[3], segment[0])];
		for (const candidate of candidates) {
			const unit = normalize(candidate);
			if (unit) return unit;
		}
		return { x: 1, y: 0 };
	}

	// de Casteljau: the two cubics that together trace `segment`.
	function split(segment, t) {
		const p01 = lerp(segment[0], segment[1], t);
		const p12 = lerp(segment[1], segment[2], t);
		const p23 = lerp(segment[2], segment[3], t);
		const p012 = lerp(p01, p12, t);
		const p123 = lerp(p12, p23, t);
		const mid = lerp(p012, p123, t);
		return [[segment[0], p01, p012, mid], [mid, p123, p23, segment[3]]];
	}

	// ===== BOUNDS =====

	// Roots in (0, 1) of one axis of the cubic's derivative.
	function axisExtrema(p0, p1, p2, p3) {
		const a = -p0 + 3 * p1 - 3 * p2 + p3;
		const b = 2 * (p0 - 2 * p1 + p2);
		const c = p1 - p0;
		const roots = [];
		if (Math.abs(a) < EPSILON) {
			if (Math.abs(b) > EPSILON) roots.push(-c / b);
		} else {
			const discriminant = b * b - 4 * a * c;
			if (discriminant >= 0) {
				const root = Math.sqrt(discriminant);
				roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
			}
		}
		return roots.filter((t) => t > 0 && t < 1);
	}

	function growBounds(bounds, point) {
		if (point.x < bounds.minX) bounds.minX = point.x;
		if (point.x > bounds.maxX) bounds.maxX = point.x;
		if (point.y < bounds.minY) bounds.minY = point.y;
		if (point.y > bounds.maxY) bounds.maxY = point.y;
	}

	// Tight bounds: curve extrema, never the control points.
	function getBounds(subpaths) {
		const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
		(subpaths || []).forEach((subpath) => {
			subpath.points.forEach((point) => growBounds(bounds, point));
			for (let index = 0; index < segmentCount(subpath); index++) {
				if (isSegmentStraight(subpath, index)) continue;
				const segment = getSegment(subpath, index);
				[
					...axisExtrema(segment[0].x, segment[1].x, segment[2].x, segment[3].x),
					...axisExtrema(segment[0].y, segment[1].y, segment[2].y, segment[3].y)
				].forEach((t) => growBounds(bounds, evaluate(segment, t)));
			}
		});
		if (bounds.minX === Infinity) return null;
		return { ...bounds, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
	}

	// ===== FLATTENING, LENGTH =====

	function flattenSegment(segment, tolerance, output, segmentIndex, t0, t1, depth) {
		// Flat enough when both inner control points sit within tolerance of the
		// chord.
		const chord = sub(segment[3], segment[0]);
		const chordLength = length(chord);
		let flat;
		if (chordLength < EPSILON) {
			flat = length(sub(segment[1], segment[0])) < tolerance && length(sub(segment[2], segment[0])) < tolerance;
		} else {
			const d1 = Math.abs((segment[1].x - segment[0].x) * chord.y - (segment[1].y - segment[0].y) * chord.x) / chordLength;
			const d2 = Math.abs((segment[2].x - segment[0].x) * chord.y - (segment[2].y - segment[0].y) * chord.x) / chordLength;
			// A handle folded back past its anchor is flat by distance but not by
			// extent, so it must also project inside the chord.
			const within = (point) => {
				const projection = ((point.x - segment[0].x) * chord.x + (point.y - segment[0].y) * chord.y) / (chordLength * chordLength);
				return projection >= -0.01 && projection <= 1.01;
			};
			flat = d1 <= tolerance && d2 <= tolerance && within(segment[1]) && within(segment[2]);
		}
		if (flat || depth >= 16) {
			output.push({ x: segment[3].x, y: segment[3].y, segment: segmentIndex, t: t1 });
			return;
		}
		const [left, right] = split(segment, 0.5);
		const middle = (t0 + t1) / 2;
		flattenSegment(left, tolerance, output, segmentIndex, t0, middle, depth + 1);
		flattenSegment(right, tolerance, output, segmentIndex, middle, t1, depth + 1);
	}

	// Polyline of one subpath: [{ x, y, segment, t, length }], `length` being the
	// distance travelled from the start. A closed subpath ends back on its first
	// point.
	function flatten(subpath, tolerance = FLATTEN_TOLERANCE) {
		const first = subpath.points[0];
		if (!first) return [];
		const output = [{ x: first.x, y: first.y, segment: 0, t: 0 }];
		for (let index = 0; index < segmentCount(subpath); index++) {
			if (isSegmentStraight(subpath, index)) {
				const end = subpath.points[(index + 1) % subpath.points.length];
				output.push({ x: end.x, y: end.y, segment: index, t: 1 });
			} else {
				flattenSegment(getSegment(subpath, index), tolerance, output, index, 0, 1, 0);
			}
		}
		let travelled = 0;
		output.forEach((vertex, index) => {
			if (index) travelled += Math.hypot(vertex.x - output[index - 1].x, vertex.y - output[index - 1].y);
			vertex.length = travelled;
		});
		return output;
	}

	function getLength(subpath, tolerance = FLATTEN_TOLERANCE) {
		const polyline = flatten(subpath, tolerance);
		return polyline.length ? polyline[polyline.length - 1].length : 0;
	}

	// Where a distance along the subpath falls: { x, y, segment, t, tangent }.
	function locationAtLength(subpath, distance, polyline = flatten(subpath)) {
		if (polyline.length < 2) {
			const point = subpath.points[0];
			return point ? { x: point.x, y: point.y, segment: 0, t: 0, tangent: { x: 1, y: 0 } } : null;
		}
		const total = polyline[polyline.length - 1].length;
		const target = Math.max(0, Math.min(total, distance));
		let low = 1;
		let high = polyline.length - 1;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (polyline[middle].length < target) low = middle + 1;
			else high = middle;
		}
		const b = polyline[low];
		const a = polyline[low - 1];
		const span = b.length - a.length;
		const ratio = span > EPSILON ? (target - a.length) / span : 0;
		// Vertices of one segment share its parameter range; the previous vertex
		// of an earlier segment is this segment's start.
		const startT = a.segment === b.segment ? a.t : 0;
		const t = startT + (b.t - startT) * ratio;
		const segment = getSegment(subpath, b.segment);
		return { ...evaluate(segment, t), segment: b.segment, t, tangent: tangent(segment, t) };
	}

	// Tangent leaving the start of an open subpath and arriving at its end, as
	// unit vectors pointing along the direction of travel.
	function getEndTangents(subpath) {
		const count = segmentCount(subpath);
		if (!count) return null;
		return {
			start: tangent(getSegment(subpath, 0), 0),
			end: tangent(getSegment(subpath, count - 1), 1)
		};
	}

	// ===== NEAREST POINT, HIT TESTS =====

	function nearestOnSegment(segment, point, straight) {
		if (straight) {
			const chord = sub(segment[3], segment[0]);
			const size = chord.x * chord.x + chord.y * chord.y;
			const t = size > EPSILON ? Math.max(0, Math.min(1, ((point.x - segment[0].x) * chord.x + (point.y - segment[0].y) * chord.y) / size)) : 0;
			const at = lerp(segment[0], segment[3], t);
			return { t, x: at.x, y: at.y, distance: Math.hypot(at.x - point.x, at.y - point.y) };
		}
		// Coarse scan, then a ternary refinement around the best sample.
		const samples = 24;
		let bestT = 0;
		let best = Infinity;
		for (let index = 0; index <= samples; index++) {
			const t = index / samples;
			const at = evaluate(segment, t);
			const distance = (at.x - point.x) ** 2 + (at.y - point.y) ** 2;
			if (distance < best) { best = distance; bestT = t; }
		}
		let low = Math.max(0, bestT - 1 / samples);
		let high = Math.min(1, bestT + 1 / samples);
		const squared = (t) => {
			const at = evaluate(segment, t);
			return (at.x - point.x) ** 2 + (at.y - point.y) ** 2;
		};
		for (let step = 0; step < 24; step++) {
			const a = low + (high - low) / 3;
			const b = high - (high - low) / 3;
			if (squared(a) < squared(b)) high = b;
			else low = a;
		}
		const t = (low + high) / 2;
		const at = evaluate(segment, t);
		return { t, x: at.x, y: at.y, distance: Math.hypot(at.x - point.x, at.y - point.y) };
	}

	// Closest point on the path: { subpath, segment, t, x, y, distance }, or
	// null for a path with no segments.
	function nearestPoint(subpaths, point) {
		let best = null;
		(subpaths || []).forEach((subpath, subpathIndex) => {
			for (let index = 0; index < segmentCount(subpath); index++) {
				const hit = nearestOnSegment(getSegment(subpath, index), point, isSegmentStraight(subpath, index));
				if (!best || hit.distance < best.distance) best = { subpath: subpathIndex, segment: index, ...hit };
			}
		});
		return best;
	}

	function hitTestStroke(subpaths, point, halfWidth) {
		const nearest = nearestPoint(subpaths, point);
		if (nearest) return nearest.distance <= halfWidth;
		// A lone point is a dot.
		return (subpaths || []).some((subpath) => subpath.points.some((anchor) => Math.hypot(anchor.x - point.x, anchor.y - point.y) <= halfWidth));
	}

	// Inside the fill. Open subpaths close implicitly, as canvas fill does.
	function containsPoint(subpaths, point, fillRule = 'nonzero') {
		let winding = 0;
		let crossings = 0;
		(subpaths || []).forEach((subpath) => {
			const polyline = flatten(subpath);
			if (polyline.length < 3) return;
			for (let index = 0; index < polyline.length; index++) {
				const a = polyline[index];
				const b = polyline[(index + 1) % polyline.length];
				if ((a.y <= point.y) === (b.y <= point.y)) continue;
				const x = a.x + (point.y - a.y) / (b.y - a.y) * (b.x - a.x);
				if (x <= point.x) continue;
				crossings++;
				winding += b.y > a.y ? 1 : -1;
			}
		});
		return fillRule === 'evenodd' ? crossings % 2 === 1 : winding !== 0;
	}

	// ===== HANDLES AND POINT TYPES =====

	// Keep a smooth or mirrored point's handles collinear after `moved` ('in'
	// or 'out') changed. Corner points keep whatever they have.
	function constrainHandles(point, moved) {
		if (point.type !== 'smooth' && point.type !== 'mirrored') return point;
		const other = moved === 'in' ? 'out' : 'in';
		const source = point[moved];
		if (isZero(source)) return point;
		const direction = normalize(source);
		if (point.type === 'mirrored') {
			point[other] = { x: -source.x, y: -source.y };
		} else if (!isZero(point[other])) {
			const size = length(point[other]);
			point[other] = { x: -direction.x * size, y: -direction.y * size };
		}
		return point;
	}

	// Handles an auto point gets from its neighbours: along the line between
	// them, a third of the way to each. An open path's ends get none.
	function getAutoHandles(subpath, index) {
		const points = subpath.points;
		const count = points.length;
		const previous = subpath.closed ? points[(index - 1 + count) % count] : points[index - 1];
		const next = subpath.closed ? points[(index + 1) % count] : points[index + 1];
		const point = points[index];
		if (!previous || !next || previous === point || next === point) return { in: null, out: null };
		const direction = normalize(sub(next, previous));
		if (!direction) return { in: null, out: null };
		const before = length(sub(point, previous)) * AUTO_HANDLE_RATIO;
		const after = length(sub(next, point)) * AUTO_HANDLE_RATIO;
		return {
			in: { x: -direction.x * before, y: -direction.y * before },
			out: { x: direction.x * after, y: direction.y * after }
		};
	}

	// Recompute every auto point's handles in place. Call after any anchor
	// moves, is inserted or is removed.
	function solveAutoHandles(subpath) {
		subpath.points.forEach((point, index) => {
			if (point.type !== 'auto') return;
			const handles = getAutoHandles(subpath, index);
			point.in = handles.in;
			point.out = handles.out;
		});
		return subpath;
	}

	// Change a point's type in place. Smooth and mirrored give a corner handles
	// along the line between its neighbours; corner keeps the handles it has.
	function setPointType(subpath, index, type) {
		const point = subpath.points[index];
		if (!point || !POINT_TYPES.includes(type)) return subpath;
		point.type = type;
		if (type === 'corner') return subpath;
		const auto = getAutoHandles(subpath, index);
		if (type === 'auto') {
			point.in = auto.in;
			point.out = auto.out;
			return subpath;
		}
		if (isZero(point.in) && isZero(point.out)) {
			point.in = auto.in;
			point.out = auto.out;
		} else if (isZero(point.in) || isZero(point.out)) {
			const present = isZero(point.in) ? 'out' : 'in';
			const missing = present === 'in' ? 'out' : 'in';
			const size = length(auto[missing] || point[present]);
			const direction = normalize(point[present]);
			point[missing] = { x: -direction.x * size, y: -direction.y * size };
		}
		if (isZero(point.in) && isZero(point.out)) {
			const neighbour = subpath.points[index + 1] || subpath.points[index - 1];
			if (!neighbour) return subpath;
			const vector = index === 0 ? sub(neighbour, point) : sub(point, neighbour);
			point.out = scale(vector, AUTO_HANDLE_RATIO);
			point.in = scale(point.out, -1);
		}
		const anchor = isZero(point.out) ? 'in' : 'out';
		if (type === 'mirrored') {
			const size = (length(point.in || { x: 0, y: 0 }) + length(point.out || { x: 0, y: 0 })) / 2;
			const direction = normalize(point[anchor]);
			if (direction) point[anchor] = { x: direction.x * size, y: direction.y * size };
		}
		constrainHandles(point, anchor);
		return subpath;
	}

	// A corner loses its handles, as a double-click on a smooth point does.
	function removeHandles(subpath, index) {
		const point = subpath.points[index];
		if (!point) return subpath;
		point.in = null;
		point.out = null;
		point.type = 'corner';
		return subpath;
	}

	// ===== EDITS =====

	// Add a point on segment `index` at t without changing the outline. Returns
	// the new point's index.
	function insertPoint(subpath, index, t) {
		const points = subpath.points;
		const a = points[index];
		const bIndex = (index + 1) % points.length;
		const b = points[bIndex];
		const straight = isSegmentStraight(subpath, index);
		const [left, right] = split(getSegment(subpath, index), t);
		const inserted = { x: left[3].x, y: left[3].y, in: null, out: null, type: 'corner' };
		if (!straight) {
			a.out = sub(left[1], left[0]);
			inserted.in = sub(left[2], left[3]);
			inserted.out = sub(right[1], right[0]);
			b.in = sub(right[2], right[3]);
			inserted.type = 'smooth';
			// Shortened handles no longer match a mirrored or derived pair.
			[a, b].forEach((point) => { if (point.type === 'mirrored' || point.type === 'auto') point.type = 'smooth'; });
		}
		points.splice(index + 1, 0, inserted);
		return index + 1;
	}

	// Remove a point and merge its two segments into one that keeps the outline
	// as close as it can. When the two segments are the halves of one cubic
	// (the point was inserted on it) this is the exact inverse of insertPoint:
	// the point's handle lengths give the split parameter, and the outer
	// handles grow back by it. Two straight segments become one straight segment.
	function deletePoint(subpath, index) {
		const points = subpath.points;
		const count = points.length;
		const removed = points[index];
		if (!removed) return subpath;
		const interior = subpath.closed ? count > 2 : index > 0 && index < count - 1;
		if (!interior) {
			points.splice(index, 1);
			if (points.length < 3) subpath.closed = false;
			// The removed point's neighbour is now an end with a dangling handle.
			if (!subpath.closed && points.length) {
				if (index === 0) points[0].in = null;
				else if (index >= points.length) points[points.length - 1].out = null;
			}
			return subpath;
		}
		const previous = points[(index - 1 + count) % count];
		const next = points[(index + 1) % count];
		const beforeLength = isZero(removed.in) ? length(sub(removed, previous)) : length(removed.in);
		const afterLength = isZero(removed.out) ? length(sub(next, removed)) : length(removed.out);
		const total = beforeLength + afterLength;
		const t = total > EPSILON ? Math.max(0.05, Math.min(0.95, beforeLength / total)) : 0.5;
		if (!isZero(previous.out)) previous.out = scale(previous.out, 1 / t);
		if (!isZero(next.in)) next.in = scale(next.in, 1 / (1 - t));
		[previous, next].forEach((point) => { if (point.type === 'mirrored' || point.type === 'auto') point.type = 'smooth'; });
		points.splice(index, 1);
		if (points.length < 3) subpath.closed = false;
		return subpath;
	}

	// Bend a segment by dragging the point at t by `delta`: the handle offsets
	// that put the curve under the pointer. A straight segment gains handles.
	// Returns { out, in } for the segment's start and end points.
	function dragSegment(segment, t, delta) {
		const clamped = Math.max(0.05, Math.min(0.95, t));
		// How much of the move the far handle takes: none near the start, all
		// near the end, a smooth blend between.
		let weight;
		if (clamped <= 1 / 6) weight = 0;
		else if (clamped <= 0.5) weight = (((6 * clamped - 1) / 2) ** 3) / 2;
		else if (clamped <= 5 / 6) weight = (1 - ((6 * (1 - clamped) - 1) / 2) ** 3) / 2 + 0.5;
		else weight = 1;
		const u = 1 - clamped;
		const first = scale(delta, (1 - weight) / (3 * clamped * u * u));
		const second = scale(delta, weight / (3 * clamped * clamped * u));
		return {
			out: sub(add(segment[1], first), segment[0]),
			in: sub(add(segment[2], second), segment[3])
		};
	}

	function reverseSubpath(subpath) {
		subpath.points.reverse();
		subpath.points.forEach((point) => {
			const swap = point.in;
			point.in = point.out;
			point.out = swap;
		});
		return subpath;
	}

	function transformSubpaths(subpaths, map, mapVector) {
		(subpaths || []).forEach((subpath) => subpath.points.forEach((point) => {
			const moved = map(point);
			if (point.in) point.in = mapVector(point.in);
			if (point.out) point.out = mapVector(point.out);
			point.x = moved.x;
			point.y = moved.y;
		}));
		return subpaths;
	}

	function scaleSubpaths(subpaths, sx, sy = sx) {
		const map = (point) => ({ x: point.x * sx, y: point.y * sy });
		return transformSubpaths(subpaths, map, map);
	}

	function translateSubpaths(subpaths, dx, dy) {
		return transformSubpaths(subpaths, (point) => ({ x: point.x + dx, y: point.y + dy }), (vector) => vector);
	}

	function roundSubpaths(subpaths) {
		(subpaths || []).forEach((subpath) => subpath.points.forEach((point) => {
			point.x = round(point.x);
			point.y = round(point.y);
			point.in = normalizeHandle(point.in);
			point.out = normalizeHandle(point.out);
		}));
		return subpaths;
	}

	// Move the points so the tight bounds are centered on the origin. Returns
	// the offset that was removed (the old bounds center), which the caller
	// adds back through the layer transform so nothing moves on canvas. `step`
	// is the grid the offset lands on: a whole-pixel step keeps anchors that
	// sit on whole pixels there.
	function recenter(subpaths, step = 1 / PRECISION) {
		const bounds = getBounds(subpaths);
		if (!bounds) return { x: 0, y: 0 };
		const snap = (value) => round(Math.round(value / step) * step);
		const offset = { x: snap((bounds.minX + bounds.maxX) / 2), y: snap((bounds.minY + bounds.maxY) / 2) };
		if (offset.x || offset.y) translateSubpaths(subpaths, -offset.x, -offset.y);
		roundSubpaths(subpaths);
		return offset;
	}

	// The part of an open subpath between two distances from its start. An
	// empty or inverted range returns null.
	function trimSubpath(subpath, startDistance, endDistance) {
		if (subpath.closed || segmentCount(subpath) < 1) return null;
		const polyline = flatten(subpath);
		const total = polyline[polyline.length - 1].length;
		const from = Math.max(0, startDistance);
		const to = Math.min(total, endDistance);
		if (!(to - from > 1e-6)) return null;
		const start = locationAtLength(subpath, from, polyline);
		const end = locationAtLength(subpath, to, polyline);
		const points = [];
		const push = (segment, isFirst, straight) => {
			if (isFirst) points.push({ x: segment[0].x, y: segment[0].y, in: null, out: null, type: 'corner' });
			points[points.length - 1].out = straight ? null : sub(segment[1], segment[0]);
			points.push({ x: segment[3].x, y: segment[3].y, in: straight ? null : sub(segment[2], segment[3]), out: null, type: 'corner' });
		};
		for (let index = start.segment; index <= end.segment; index++) {
			let segment = getSegment(subpath, index);
			const t0 = index === start.segment ? start.t : 0;
			const t1 = index === end.segment ? end.t : 1;
			if (t1 - t0 < 1e-9) continue;
			if (t1 < 1) segment = split(segment, t1)[0];
			if (t0 > 0) segment = split(segment, t1 > 0 ? t0 / t1 : 0)[1];
			push(segment, !points.length, isSegmentStraight(subpath, index));
		}
		if (points.length < 2) return null;
		return normalizeSubpaths([{ closed: false, points }])[0] || null;
	}

	// ===== DRAWING =====

	// Replay the path on anything with the canvas path methods (a 2D context or
	// a Path2D).
	function trace(target, subpaths) {
		(subpaths || []).forEach((subpath) => {
			const points = subpath.points;
			if (!points.length) return;
			target.moveTo(points[0].x, points[0].y);
			for (let index = 0; index < segmentCount(subpath); index++) {
				const end = points[(index + 1) % points.length];
				if (isSegmentStraight(subpath, index)) {
					target.lineTo(end.x, end.y);
				} else {
					const segment = getSegment(subpath, index);
					target.bezierCurveTo(segment[1].x, segment[1].y, segment[2].x, segment[2].y, end.x, end.y);
				}
			}
			if (subpath.closed) target.closePath();
		});
		return target;
	}

	function toPath2D(subpaths) {
		return trace(new Path2D(), subpaths);
	}

	// ===== SVG PATH DATA =====

	const formatNumber = (value) => String(Math.round(value * 1000) / 1000 || 0);

	function toSvgPath(subpaths) {
		const parts = [];
		(subpaths || []).forEach((subpath) => {
			const points = subpath.points;
			if (!points.length) return;
			parts.push(`M${formatNumber(points[0].x)} ${formatNumber(points[0].y)}`);
			for (let index = 0; index < segmentCount(subpath); index++) {
				const end = points[(index + 1) % points.length];
				if (isSegmentStraight(subpath, index)) {
					parts.push(`L${formatNumber(end.x)} ${formatNumber(end.y)}`);
				} else {
					const segment = getSegment(subpath, index);
					parts.push(`C${[segment[1].x, segment[1].y, segment[2].x, segment[2].y, end.x, end.y].map(formatNumber).join(' ')}`);
				}
			}
			if (subpath.closed) parts.push('Z');
		});
		return parts.join(' ');
	}

	function tokenizeSvgPath(d) {
		const tokens = [];
		const pattern = /([a-zA-Z])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
		let match;
		while ((match = pattern.exec(d))) {
			tokens.push(match[1] ? { command: match[1] } : { value: Number(match[2]), text: match[2] });
		}
		return tokens;
	}

	// One elliptical arc as cubic segments (the SVG implementation notes'
	// endpoint-to-center conversion). Returns [[c1, c2, end], …].
	function arcToCubics(from, rx, ry, rotationDeg, largeArc, sweep, to) {
		if ((from.x === to.x && from.y === to.y) || !rx || !ry) return [[{ ...from }, { ...to }, { ...to }]];
		rx = Math.abs(rx);
		ry = Math.abs(ry);
		const phi = rotationDeg * Math.PI / 180;
		const cos = Math.cos(phi);
		const sin = Math.sin(phi);
		const dx = (from.x - to.x) / 2;
		const dy = (from.y - to.y) / 2;
		const x1 = cos * dx + sin * dy;
		const y1 = -sin * dx + cos * dy;
		const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
		if (lambda > 1) {
			rx *= Math.sqrt(lambda);
			ry *= Math.sqrt(lambda);
		}
		const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
		const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
		const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
		const cxp = factor * (rx * y1) / ry;
		const cyp = factor * -(ry * x1) / rx;
		const cx = cos * cxp - sin * cyp + (from.x + to.x) / 2;
		const cy = sin * cxp + cos * cyp + (from.y + to.y) / 2;
		const angle = (ux, uy, vx, vy) => {
			const dot = ux * vx + uy * vy;
			const size = Math.hypot(ux, uy) * Math.hypot(vx, vy);
			const value = Math.acos(Math.max(-1, Math.min(1, dot / size)));
			return ux * vy - uy * vx < 0 ? -value : value;
		};
		const theta = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
		let delta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
		if (!sweep && delta > 0) delta -= 2 * Math.PI;
		if (sweep && delta < 0) delta += 2 * Math.PI;
		const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
		const step = delta / pieces;
		const handle = 4 / 3 * Math.tan(step / 4);
		const at = (a) => ({
			x: cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin,
			y: cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos
		});
		const slope = (a) => ({
			x: -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin,
			y: -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos
		});
		const cubics = [];
		for (let index = 0; index < pieces; index++) {
			const a0 = theta + step * index;
			const a1 = a0 + step;
			const p0 = at(a0);
			const p3 = index === pieces - 1 ? { x: to.x, y: to.y } : at(a1);
			const d0 = slope(a0);
			const d1 = slope(a1);
			cubics.push([
				{ x: p0.x + d0.x * handle, y: p0.y + d0.y * handle },
				{ x: p3.x - d1.x * handle, y: p3.y - d1.y * handle },
				p3
			]);
		}
		return cubics;
	}

	// SVG path data to subpaths. Handles every command, relative and absolute;
	// quadratics and arcs become cubics. Points come out as corners or, where
	// both handles line up, smooth.
	function parseSvgPath(d) {
		const tokens = tokenizeSvgPath(String(d || ''));
		const subpaths = [];
		let current = null;
		let position = { x: 0, y: 0 };
		let start = { x: 0, y: 0 };
		let previousControl = null;
		let previousCommand = '';
		let cursor = 0;
		const hasNumber = () => cursor < tokens.length && tokens[cursor].value !== undefined;
		const number = () => {
			if (!hasNumber()) throw new Error('Malformed SVG path data');
			return tokens[cursor++].value;
		};
		// Arc flags may be written without separators ("a1 1 0 01 2 2").
		const flag = () => {
			if (!hasNumber()) throw new Error('Malformed SVG path data');
			const token = tokens[cursor];
			if (token.text.length > 1 && /^[01]/.test(token.text) && !/^[01]\./.test(token.text)) {
				const rest = token.text.slice(1);
				tokens[cursor] = { value: Number(rest), text: rest };
				return Number(token.text[0]);
			}
			cursor++;
			return token.value ? 1 : 0;
		};
		const begin = (point) => {
			current = { closed: false, points: [{ x: point.x, y: point.y, in: null, out: null, type: 'corner' }] };
			subpaths.push(current);
			start = { ...point };
		};
		const ensure = () => { if (!current) begin(position); };
		const lineTo = (point) => {
			ensure();
			current.points.push({ x: point.x, y: point.y, in: null, out: null, type: 'corner' });
			position = { ...point };
		};
		const curveTo = (c1, c2, end) => {
			ensure();
			const last = current.points[current.points.length - 1];
			last.out = sub(c1, last);
			current.points.push({ x: end.x, y: end.y, in: sub(c2, end), out: null, type: 'corner' });
			position = { ...end };
		};
		while (cursor < tokens.length) {
			const token = tokens[cursor];
			let command = previousCommand;
			if (token.command) {
				command = token.command;
				cursor++;
			} else if (command.toUpperCase() === 'Z') {
				throw new Error('Malformed SVG path data');
			} else if (!command) {
				throw new Error('SVG path data must start with a command');
			} else if (command === 'M') {
				command = 'L';
			} else if (command === 'm') {
				command = 'l';
			}
			const relative = command === command.toLowerCase();
			const point = () => {
				const x = number();
				const y = number();
				return relative ? { x: position.x + x, y: position.y + y } : { x, y };
			};
			let control = null;
			switch (command.toUpperCase()) {
				case 'M': {
					const to = point();
					position = { ...to };
					begin(to);
					break;
				}
				case 'L':
					lineTo(point());
					break;
				case 'H': {
					const x = number();
					lineTo({ x: relative ? position.x + x : x, y: position.y });
					break;
				}
				case 'V': {
					const y = number();
					lineTo({ x: position.x, y: relative ? position.y + y : y });
					break;
				}
				case 'C': {
					const c1 = point();
					const c2 = point();
					const end = point();
					curveTo(c1, c2, end);
					control = c2;
					break;
				}
				case 'S': {
					const reflect = /[CS]/i.test(previousCommand) && previousControl;
					const c1 = reflect ? { x: 2 * position.x - previousControl.x, y: 2 * position.y - previousControl.y } : { ...position };
					const c2 = point();
					const end = point();
					curveTo(c1, c2, end);
					control = c2;
					break;
				}
				case 'Q':
				case 'T': {
					let q;
					if (command.toUpperCase() === 'Q') q = point();
					else q = /[QT]/i.test(previousCommand) && previousControl ? { x: 2 * position.x - previousControl.x, y: 2 * position.y - previousControl.y } : { ...position };
					const end = point();
					curveTo(lerp(position, q, 2 / 3), lerp(end, q, 2 / 3), end);
					control = q;
					break;
				}
				case 'A': {
					const rx = number();
					const ry = number();
					const rotation = number();
					const largeArc = flag();
					const sweep = flag();
					const end = point();
					arcToCubics(position, rx, ry, rotation, largeArc, sweep, end).forEach(([c1, c2, to]) => curveTo(c1, c2, to));
					break;
				}
				case 'Z':
					if (current) {
						current.closed = true;
						position = { ...start };
						current = null;
					}
					break;
				default:
					throw new Error(`Unknown SVG path command ${command}`);
			}
			previousControl = control;
			previousCommand = command;
			// After a close, a following draw command starts a new subpath there.
			if (command.toUpperCase() === 'Z') previousControl = null;
		}
		// A closed subpath that returns to its first point carries that point
		// twice: fold the duplicate into the start.
		subpaths.forEach((subpath) => {
			const points = subpath.points;
			if (!subpath.closed || points.length < 2) return;
			const first = points[0];
			const last = points[points.length - 1];
			if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-6) return;
			first.in = last.in;
			points.pop();
		});
		subpaths.forEach((subpath) => subpath.points.forEach((point) => {
			if (isZero(point.in)) point.in = null;
			if (isZero(point.out)) point.out = null;
			if (!point.in || !point.out) return;
			const a = normalize(point.in);
			const b = normalize(point.out);
			if (a && b && a.x * b.x + a.y * b.y < -0.9999) point.type = 'smooth';
		}));
		return subpaths.filter((subpath) => subpath.points.length > 0);
	}

	// ===== POINTER HELPERS =====

	// `to` moved onto the nearest multiple of `stepDeg` around `from`, keeping
	// its distance.
	function constrainAngle(from, to, stepDeg = 45) {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const distance = Math.hypot(dx, dy);
		if (distance < EPSILON) return { x: to.x, y: to.y };
		const step = stepDeg * Math.PI / 180;
		const angle = Math.round(Math.atan2(dy, dx) / step) * step;
		return { x: from.x + Math.cos(angle) * distance, y: from.y + Math.sin(angle) * distance };
	}

	return Object.freeze({
		POINT_TYPES,
		cloneSubpaths,
		normalizeSubpaths,
		countPoints,
		segmentCount,
		getSegment,
		isSegmentStraight,
		evaluate,
		tangent,
		split,
		getBounds,
		flatten,
		getLength,
		locationAtLength,
		getEndTangents,
		nearestPoint,
		hitTestStroke,
		containsPoint,
		constrainHandles,
		getAutoHandles,
		solveAutoHandles,
		setPointType,
		removeHandles,
		insertPoint,
		deletePoint,
		dragSegment,
		reverseSubpath,
		scaleSubpaths,
		translateSubpaths,
		roundSubpaths,
		recenter,
		trimSubpath,
		trace,
		toPath2D,
		toSvgPath,
		parseSvgPath,
		constrainAngle
	});
})();

if (typeof module !== 'undefined' && module.exports) {
	module.exports = { PathGeometry };
}
