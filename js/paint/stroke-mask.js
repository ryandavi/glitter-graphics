'use strict';

// The stroke slot's geometry: the only place a path and its stroke data become
// pixels. A stroke is the line itself (width, joins, caps, dashes) plus an
// optional ornament at each end of an open subpath. Ornaments are shapes from
// the shape manifest filled into the same mask, so the stroke's paint runs
// unbroken from line into arrowhead and every effect derived from the mask
// includes them.
//
// planStrokeSubpath is DOM-free: which part of the subpath is stroked and
// where its ornaments go. buildStrokeMask draws that plan and thresholds it.

const STROKE_LINE_CAPS = Object.freeze({ flat: 'butt', round: 'round', square: 'square' });
const STROKE_ENDS = Object.freeze(['start', 'end']);

function getStrokeCap(stroke) {
	return isOptionValue('strokeCap', stroke?.cap) ? stroke.cap : CONFIG.tools.path.stroke.cap;
}

function getStrokeDashStyle(stroke) {
	return isOptionValue('strokeDashStyle', stroke?.dashStyle) ? stroke.dashStyle : 'solid';
}

// A stroke joins Smooth or Sharp; it has no Pixel edge.
function getStrokeEdgeStyle(stroke) {
	return stroke?.edgeStyle === 'miter' ? 'miter' : 'round';
}

function buildDefaultStroke(options = {}) {
	const config = CONFIG.tools.path.stroke;
	const coordinates = CONFIG.rendering.textureCoordinates;
	return {
		widthPx: FIELDS.strokeWidth.value,
		edgeStyle: config.edgeStyle,
		cap: config.cap,
		dashStyle: 'solid',
		dashPx: FIELDS.strokeDash.value,
		gapPx: FIELDS.strokeGap.value,
		dashOffsetPx: FIELDS.strokeDashOffset.value,
		startShapeId: null,
		startSize: FIELDS.strokeOrnamentSize.value / 100,
		endShapeId: null,
		endSize: FIELDS.strokeOrnamentSize.value / 100,
		mode: config.source,
		glitterId: options.defaultGlitterId ?? null,
		color: config.color,
		scale: FIELDS.textureScale.value,
		opacity: FIELDS.slotOpacity.value,
		textureAnchor: coordinates.defaultAnchor,
		textureOffsetX: coordinates.defaultOffsetX,
		textureOffsetY: coordinates.defaultOffsetY,
		colorAdjust: null
	};
}

// Canvas line dash for the stroke's dash style, or null for a solid line. A
// dot is a zero-length dash drawn with a round cap.
function getStrokeLineDash(stroke) {
	const width = Math.max(0, Number(stroke?.widthPx) || 0);
	const gap = Math.max(0, Number(stroke?.gapPx) || 0);
	const style = getStrokeDashStyle(stroke);
	if (style === 'dotted') return [0, width + gap];
	if (style === 'dashed') return [Math.max(0, Number(stroke.dashPx) || 0), gap];
	return null;
}

// Everything in the stroke data that changes the mask.
function getStrokeMaskKey(stroke) {
	if (!stroke) return null;
	return [
		stroke.widthPx, getStrokeEdgeStyle(stroke), getStrokeCap(stroke), getStrokeDashStyle(stroke),
		stroke.dashPx, stroke.gapPx, stroke.dashOffsetPx,
		stroke.startShapeId || null, stroke.startSize, stroke.endShapeId || null, stroke.endSize
	];
}

function getStrokeOrnament(shapeId) {
	return shapeId ? ShapeLibrary.getOrnament(shapeId) : null;
}

// One subpath's stroke: `path` is the subpath to stroke (shortened under its
// ornaments, or null when nothing of it is left), `ornaments` where each end's
// shape goes, `dashShift` how far the start was trimmed (so dashes keep their
// phase when an ornament is added). Ornaments apply to open subpaths only.
function planStrokeSubpath(subpath, stroke, getOrnament = getStrokeOrnament) {
	const plan = { path: subpath, ornaments: [], dashShift: 0 };
	const width = Math.max(0, Number(stroke?.widthPx) || 0);
	if (subpath.closed || PathGeometry.segmentCount(subpath) < 1 || !width) return plan;
	const tangents = PathGeometry.getEndTangents(subpath);
	const points = subpath.points;
	const trim = { start: 0, end: 0 };
	STROKE_ENDS.forEach((end) => {
		const ornament = getOrnament(stroke[`${end}ShapeId`]);
		if (!ornament) return;
		const point = end === 'start' ? points[0] : points[points.length - 1];
		// Ornaments point away from the path along its end tangent.
		const direction = end === 'start' ? { x: -tangents.start.x, y: -tangents.start.y } : tangents.end;
		const bounds = ornament.bounds;
		const size = Math.max(0, Number(stroke[`${end}Size`]) || 0) * width;
		const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 1;
		const origin = ornament.anchor === 'center'
			? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
			: { x: ornament.tip[0], y: ornament.tip[1] };
		plan.ornaments.push({
			end,
			shapeId: stroke[`${end}ShapeId`],
			x: point.x,
			y: point.y,
			rotation: Math.atan2(direction.y, direction.x) - ornament.angle * Math.PI / 180,
			scale: size / extent,
			originX: origin.x,
			originY: origin.y
		});
		trim[end] = ornament.trim * size;
	});
	if (trim.start || trim.end) {
		// A path shorter than its trims keeps its ornaments and draws no line.
		plan.path = PathGeometry.trimSubpath(subpath, trim.start, PathGeometry.getLength(subpath) - trim.end);
		plan.dashShift = trim.start;
	}
	return plan;
}

// How far the stroke can paint outside the geometry's tight bounds, for
// sizing its canvas: half the width through the widest join or cap, or an
// ornament's farthest corner from the point it is pinned by.
function getStrokeReach(subpaths, stroke, getOrnament = getStrokeOrnament) {
	const width = Math.max(0, Number(stroke?.widthPx) || 0);
	if (!width) return 0;
	const half = width / 2;
	let reach = getStrokeEdgeStyle(stroke) === 'miter' ? half * CONFIG.tools.path.stroke.miterLimit : half;
	if (getStrokeCap(stroke) === 'square') reach = Math.max(reach, half * Math.SQRT2);
	if (!(subpaths || []).some((subpath) => !subpath.closed)) return reach;
	STROKE_ENDS.forEach((end) => {
		const ornament = getOrnament(stroke[`${end}ShapeId`]);
		if (!ornament) return;
		const bounds = ornament.bounds;
		const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 1;
		const scale = Math.max(0, Number(stroke[`${end}Size`]) || 0) * width / extent;
		const origin = ornament.anchor === 'center'
			? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
			: { x: ornament.tip[0], y: ornament.tip[1] };
		[[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.minX, bounds.maxY], [bounds.maxX, bounds.maxY]].forEach(([x, y]) => {
			reach = Math.max(reach, Math.hypot(x - origin.x, y - origin.y) * scale);
		});
	});
	return reach;
}

// The stroke mask for a path. geometry is { subpaths } in path-local px;
// surface is { width, height, originX, originY }: the canvas to allocate and
// where the path's origin sits in it.
function buildStrokeMask(geometry, stroke, surface) {
	const canvas = createAppCanvas(0, 0, 'paint/stroke-mask');
	canvas.width = surface.width;
	canvas.height = surface.height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	const width = Math.max(0, Number(stroke?.widthPx) || 0);
	if (width > 0) {
		const dashStyle = getStrokeDashStyle(stroke);
		const dash = getStrokeLineDash(stroke);
		ctx.save();
		ctx.translate(surface.originX, surface.originY);
		ctx.fillStyle = '#ffffff';
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = width;
		ctx.lineJoin = getStrokeEdgeStyle(stroke) === 'miter' ? 'miter' : 'round';
		ctx.miterLimit = CONFIG.tools.path.stroke.miterLimit;
		ctx.lineCap = dashStyle === 'dotted' ? 'round' : STROKE_LINE_CAPS[getStrokeCap(stroke)];
		(geometry.subpaths || []).forEach((subpath) => {
			if (subpath.points.length === 1) {
				// A path with one point so far shows as a dot.
				ctx.beginPath();
				ctx.arc(subpath.points[0].x, subpath.points[0].y, width / 2, 0, Math.PI * 2);
				ctx.fill();
				return;
			}
			const plan = planStrokeSubpath(subpath, stroke);
			if (plan.path) {
				ctx.setLineDash(dash || []);
				ctx.lineDashOffset = dash ? (Number(stroke.dashOffsetPx) || 0) + plan.dashShift : 0;
				ctx.stroke(PathGeometry.toPath2D([plan.path]));
			}
			plan.ornaments.forEach((placement) => {
				ctx.save();
				ctx.translate(placement.x, placement.y);
				ctx.rotate(placement.rotation);
				ctx.scale(placement.scale, placement.scale);
				ctx.translate(-placement.originX, -placement.originY);
				ctx.fill(getStrokeOrnament(placement.shapeId).path);
				ctx.restore();
			});
		});
		ctx.restore();
		if (shouldUseCrispMaskEdges()) binarizeCanvasAlpha(ctx);
	}
	return canvas;
}

// ===== PRESETS =====

// Presets set the line's shape only: its dash style and its ends. Paint and
// width are the stroke slot's and never change, so presets are named for
// their shape. Every entry writes the same keys, so applying one replaces the
// last.
const STROKE_PRESET_KEYS = Object.freeze(['dashStyle', 'startShapeId', 'startSize', 'endShapeId', 'endSize']);

function createStrokePresetValue(value = {}) {
	const size = FIELDS.strokeOrnamentSize.value / 100;
	return { dashStyle: 'solid', startShapeId: null, startSize: size, endShapeId: null, endSize: size, ...value };
}

const STROKE_PRESETS = GlitterPresetLibrary.createPresetLibrary({
	id: 'strokes',
	groups: [{ id: 'lines', label: '' }],
	entries: [
		{ id: 'line', label: 'Line', group: 'lines', value: createStrokePresetValue() },
		{ id: 'arrow', label: 'Arrow', group: 'lines', value: createStrokePresetValue({ endShapeId: 'arrowHead' }) },
		{ id: 'double-arrow', label: 'Double Arrow', group: 'lines', value: createStrokePresetValue({ startShapeId: 'arrowHead', endShapeId: 'arrowHead' }) },
		{ id: 'dashed', label: 'Dashed', group: 'lines', value: createStrokePresetValue({ dashStyle: 'dashed' }) },
		{ id: 'dotted', label: 'Dotted', group: 'lines', value: createStrokePresetValue({ dashStyle: 'dotted' }) },
		{ id: 'dot-ends', label: 'Dot Ends', group: 'lines', value: createStrokePresetValue({ startShapeId: 'circle', startSize: 3, endShapeId: 'circle', endSize: 3 }) },
		{ id: 'heart-string', label: 'Heart String', group: 'lines', tags: ['hearts'], value: createStrokePresetValue({ dashStyle: 'dotted', startShapeId: 'heart', startSize: 5, endShapeId: 'heart', endSize: 5 }) }
	],
	renderThumbnail(entry, element) {
		element.classList.add('is-drawn');
		element.style.backgroundImage = `url(${getStrokeThumbnail(`preset:${entry.id}`, entry.value)})`;
	},
	// target is the stroke slot's data.
	apply(entry, target, value) {
		if (target) Object.assign(target, value);
	}
});

function findStrokePresetId(stroke) {
	if (!stroke) return null;
	return STROKE_PRESETS.entries.find((entry) => STROKE_PRESET_KEYS.every((key) => {
		// A size only counts where its end has an ornament.
		if (key === 'startSize' && !entry.value.startShapeId) return true;
		if (key === 'endSize' && !entry.value.endShapeId) return true;
		return (stroke[key] ?? null) === entry.value[key];
	}))?.id || null;
}

const STROKE_THUMBNAIL_COLOR = '#c8c8c8';
const STROKE_THUMBNAIL_CACHE = new Map();

// A short horizontal line drawn with `value` over the default stroke, in one
// neutral gray on a transparent landscape tile: preset tiles and the ornament
// pickers, which show shape only.
function getStrokeThumbnail(key, value) {
	if (STROKE_THUMBNAIL_CACHE.has(key)) return STROKE_THUMBNAIL_CACHE.get(key);
	const width = 80;
	const height = 40;
	const stroke = { ...buildDefaultStroke(), ...value, widthPx: 4, dashPx: 9, gapPx: 6, cap: 'round' };
	const reach = Math.ceil(getStrokeReach([{ closed: false, points: [] }], stroke));
	const half = Math.max(8, width / 2 - Math.min(reach, 14) - 4);
	const subpath = { closed: false, points: [
		{ x: -half, y: 0, in: null, out: null, type: 'corner' },
		{ x: half, y: 0, in: null, out: null, type: 'corner' }
	] };
	const canvas = buildStrokeMask({ subpaths: [subpath] }, stroke, { width, height, originX: width / 2, originY: height / 2 });
	const ctx = canvas.getContext('2d');
	ctx.globalCompositeOperation = 'source-in';
	ctx.fillStyle = STROKE_THUMBNAIL_COLOR;
	ctx.fillRect(0, 0, width, height);
	const url = canvas.toDataURL('image/png');
	canvas.width = canvas.height = 0;
	STROKE_THUMBNAIL_CACHE.set(key, url);
	return url;
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = { planStrokeSubpath, getStrokeReach, getStrokeLineDash, getStrokeMaskKey, STROKE_PRESETS, findStrokePresetId };
}
