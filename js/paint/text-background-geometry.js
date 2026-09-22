'use strict';

// Text Background — geometry pipeline (docs/DYNAMIC-TEXT-BACKGROUND-IMPLEMENTATION-PLAN.md).
//
// Renderer-independent: consumes the canonical text layout (positioned line
// rects + overall/box bounds, already computed by TextGlitterManager's
// measurement pass) and returns a list of drawable shapes in the SAME local
// coordinate space as that layout. Nothing here measures text, wraps text,
// resolves alignment, or knows about canvas/layer transforms — see the
// plan's "Core architectural rules". Preview and every export path call the
// exact same generateTextBackgroundGeometry + renderTextBackgroundGeometry
// pair (TextGlitterManager.getTextBackgroundMaskCanvas is the single call
// site for both).
//
// `layout` shape expected by generateTextBackgroundGeometry:
//   {
//     lines: [{ left, top, right, bottom, blank }, ...],  // one per source line, in order
//     textInkRect: { x, y, width, height } | null,
//     boxRect: { x, y, width, height } | null,             // box-mode text only
//     lineHeightPx, ascent, descent
//   }
// All rects/points are in the same unshifted local space; TextGlitterManager
// is responsible for translating the returned geometry into the mask
// canvas's own pixel space (translateTextBackgroundGeometry).

const TEXT_BACKGROUND_MODES = ['lines', 'text-bounds', 'text-box'];
const TEXT_BACKGROUND_CONNECTIONS = ['separate', 'merge-adjacent', 'connected'];

// 'Connected' reuses the exact merge-adjacent adjacency/grouping code with a
// more permissive effective threshold (plan: "Do not create a second
// connected-shape algorithm... the intended visual difference should come
// from property values"), not a second algorithm.
const CONNECTED_MERGE_MULTIPLIER = 2.2;

function clampNumber(value, min, max, fallback = min) {
	const num = Number(value);
	if (!Number.isFinite(num)) return fallback;
	return Math.max(min, Math.min(max, num));
}

// One explicit interpretation of mergeDistance + lineSpacingSensitivity so
// every line-connection mode shares the same rule (plan "Merge calculation").
// Tighter-than-normal spacing (actualGap < expectedGap) raises the effective
// threshold; looser spacing lowers it; sensitivity 0 disables the adjustment.
function computeEffectiveMergeThreshold({ mergeDistance, lineSpacingSensitivity, actualGap, expectedGap, permissive }) {
	const distance = permissive ? mergeDistance * CONNECTED_MERGE_MULTIPLIER : mergeDistance;
	const sensitivity = permissive
		? Math.min(100, lineSpacingSensitivity * CONNECTED_MERGE_MULTIPLIER)
		: lineSpacingSensitivity;
	const safeExpected = Math.max(1, expectedGap);
	const spacingRatio = actualGap / safeExpected;
	const spacingAdjustment = (1 - spacingRatio) * (sensitivity / 100) * safeExpected;
	return clampNumber(distance + spacingAdjustment, 0, 2000, distance);
}

// Groups PADDED line rects into contiguous top-to-bottom runs that should
// render as one merged shape. `lines` includes blank entries (no rect, just
// `{ blank: true }`) in source order — a blank line always breaks a group
// ("hard separator"), regardless of the geometric gap around it. Only
// neighboring lines are ever considered (top-to-bottom scan; no
// non-adjacent-overlap merging).
function groupPaddedLines(lines, { lineConnection, mergeDistance, lineSpacingSensitivity, lineHeightPx, ascent, descent }) {
	const nonBlank = lines.filter((line) => !line.blank);
	if (lineConnection === 'separate' || nonBlank.length <= 1) {
		return nonBlank.map((line) => [line]);
	}

	const permissive = lineConnection === 'connected';
	const expectedGap = Math.max(1, (lineHeightPx || 0) - ((ascent || 0) + (descent || 0)));
	const groups = [];
	let current = [];

	lines.forEach((line) => {
		if (line.blank) {
			if (current.length) groups.push(current);
			current = [];
			return;
		}
		if (!current.length) {
			current.push(line);
			return;
		}
		const previous = current[current.length - 1];
		const actualGap = line.top - previous.bottom;
		const threshold = computeEffectiveMergeThreshold({
			mergeDistance, lineSpacingSensitivity, actualGap, expectedGap, permissive
		});
		if (actualGap <= threshold) {
			current.push(line);
		} else {
			groups.push(current);
			current = [line];
		}
	});
	if (current.length) groups.push(current);
	return groups;
}

// A merge group's vertical bands: each padded line rect's own top/bottom,
// extended to meet its neighbor exactly at the midpoint of the gap between
// them. This closes any vertical gap inside a merged group (so the silhouette
// has no seam) while leaving each band's left/right (its padded line width)
// untouched, preserving the stepped Instagram-style outline.
function buildMergeBands(group) {
	return group.map((rect, index) => ({
		left: rect.left,
		right: rect.right,
		top: index === 0 ? rect.top : (group[index - 1].bottom + rect.top) / 2,
		bottom: index === group.length - 1 ? rect.bottom : (rect.bottom + group[index + 1].top) / 2
	}));
}

// Walks the bands' right edges top-to-bottom, then their left edges
// bottom-to-top, closing into one orthogonal ("staircase") polygon. Adjacent
// bands share their touching edge exactly (buildMergeBands guarantees
// band[i].bottom === band[i+1].top), so the natural step between differing
// widths falls out of the point list with no extra bridging logic.
function buildStaircasePolygonPoints(bands) {
	const points = [];
	const push = (x, y) => {
		const last = points[points.length - 1];
		if (last && Math.abs(last[0] - x) < 0.01 && Math.abs(last[1] - y) < 0.01) return;
		points.push([x, y]);
	};
	bands.forEach((band) => {
		push(band.right, band.top);
		push(band.right, band.bottom);
	});
	for (let i = bands.length - 1; i >= 0; i--) {
		const band = bands[i];
		push(band.left, band.bottom);
		push(band.left, band.top);
	}
	if (points.length > 1) {
		const first = points[0];
		const last = points[points.length - 1];
		if (Math.abs(first[0] - last[0]) < 0.01 && Math.abs(first[1] - last[1]) < 0.01) points.pop();
	}
	return points;
}

function rectPolygon(x, y, width, height, radius) {
	return {
		type: 'polygon',
		radius: Math.max(0, radius),
		points: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
	};
}

function buildGroupShape(group, radius) {
	if (group.length === 1) {
		const rect = group[0];
		return rectPolygon(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top, radius);
	}
	const bands = buildMergeBands(group);
	return { type: 'polygon', radius: Math.max(0, radius), points: buildStaircasePolygonPoints(bands) };
}

function computeShapesBounds(shapes) {
	if (!shapes.length) return null;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	shapes.forEach((shape) => {
		shape.points.forEach(([x, y]) => {
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		});
	});
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// The one canonical geometry generator. Same call for the editor's live
// preview, still-image export, GIF export, and MP4 export — never
// reimplemented per renderer. Returns { shapes, bounds } in the layout's
// unshifted local space; shapes are always simple polygons (an axis-aligned
// rect is just a 4-point polygon) so exactly one path/rounding routine
// (renderTextBackgroundGeometry) draws every mode.
function generateTextBackgroundGeometry(layout, properties = {}) {
	const mode = TEXT_BACKGROUND_MODES.includes(properties.mode) ? properties.mode : 'lines';
	const lineConnection = TEXT_BACKGROUND_CONNECTIONS.includes(properties.lineConnection) ? properties.lineConnection : 'separate';
	const horizontalPadding = Math.max(0, Number(properties.horizontalPadding) || 0);
	const verticalPadding = Math.max(0, Number(properties.verticalPadding) || 0);
	const cornerRadius = Math.max(0, Number(properties.cornerRadius) || 0);
	const mergeDistance = Math.max(0, Number(properties.mergeDistance) || 0);
	const lineSpacingSensitivity = clampNumber(properties.lineSpacingSensitivity, 0, 100, 0);

	if (mode === 'text-bounds' || mode === 'text-box') {
		const rect = mode === 'text-box' ? layout?.boxRect : layout?.textInkRect;
		if (!rect || rect.width <= 0 || rect.height <= 0) return { shapes: [], bounds: null };
		const shape = rectPolygon(
			rect.x - horizontalPadding,
			rect.y - verticalPadding,
			rect.width + horizontalPadding * 2,
			rect.height + verticalPadding * 2,
			cornerRadius
		);
		return { shapes: [shape], bounds: computeShapesBounds([shape]) };
	}

	const lines = Array.isArray(layout?.lines) ? layout.lines : [];
	const padded = lines.map((line) => (line.blank ? { blank: true } : {
		left: line.left - horizontalPadding,
		top: line.top - verticalPadding,
		right: line.right + horizontalPadding,
		bottom: line.bottom + verticalPadding,
		blank: false
	}));

	const groups = groupPaddedLines(padded, {
		lineConnection, mergeDistance, lineSpacingSensitivity,
		lineHeightPx: layout?.lineHeightPx, ascent: layout?.ascent, descent: layout?.descent
	});

	const shapes = groups
		.filter((group) => group.length && group.every((rect) => rect.right > rect.left && rect.bottom > rect.top))
		.map((group) => buildGroupShape(group, cornerRadius));

	return { shapes, bounds: computeShapesBounds(shapes) };
}

function translateTextBackgroundGeometry(geometry, dx, dy) {
	if (!geometry?.shapes?.length) return { shapes: [], bounds: null };
	const shapes = geometry.shapes.map((shape) => ({
		...shape,
		points: shape.points.map(([x, y]) => [x + dx, y + dy])
	}));
	const bounds = geometry.bounds
		? { x: geometry.bounds.x + dx, y: geometry.bounds.y + dy, width: geometry.bounds.width, height: geometry.bounds.height }
		: null;
	return { shapes, bounds };
}

// Traces one polygon's rounded outline into the current path using
// ctx.arcTo at every vertex — correct for both convex and concave corners
// without needing separate winding-direction bookkeeping, which is the
// building block the plan calls for ("implement that once as a reusable
// geometry/path helper"). Radius is clamped per-vertex to half of each
// incident edge so tight steps (e.g. a one-character line) can't self-intersect.
function tracePolygonPath(ctx, points, radius) {
	const n = points.length;
	if (n < 3) return;
	const first = points[0];
	const last = points[n - 1];
	ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
	for (let i = 0; i < n; i++) {
		const curr = points[i];
		const next = points[(i + 1) % n];
		const prev = points[(i - 1 + n) % n];
		const lenIn = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
		const lenOut = Math.hypot(next[0] - curr[0], next[1] - curr[1]);
		const r = Math.max(0, Math.min(radius, lenIn / 2, lenOut / 2));
		if (r > 0.01) {
			ctx.arcTo(curr[0], curr[1], next[0], next[1], r);
		} else {
			ctx.lineTo(curr[0], curr[1]);
		}
	}
	ctx.closePath();
}

// The one rendering routine for the whole feature: preview's mask generation
// and every export path call this exact function against their own 2D
// context (see TextGlitterManager.getTextBackgroundMaskCanvas).
function renderTextBackgroundGeometry(ctx, geometry) {
	if (!geometry?.shapes?.length) return;
	ctx.beginPath();
	geometry.shapes.forEach((shape) => tracePolygonPath(ctx, shape.points, shape.radius));
	ctx.fill();
}
