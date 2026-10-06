'use strict';

// Text warp (DOM-free). A warp bends where each glyph is placed in the text
// mask, so every slot drawn from that mask (border, shadow, bevel, sparkles)
// bends with it. The text manager measures the glyphs; this file only maps
// flat glyph positions to warped ones, so preview and export share it through
// the one mask canvas.
//
// layoutGlyphs(glyphs, bend, metrics) -> [{ x, y, rotation, scaleY }]
//   glyphs   [{ x, y, line }]: x = the center of the glyph's advance, y = its
//            baseline, both in the layout's unshifted local space
//   bend     -1..1 (the stored percent / 100); the sign flips the direction
//   metrics  { centerX, centerY, width, height, fontSize, ascent }: the flat
//            block's center, its ink width and height and the font's size
//            and ascent
// The result is where the glyph's advance center lands on its baseline,
// its rotation in radians (clockwise) and a vertical scale about the
// baseline. A later `path` warp (text on a drawn path) fits this contract.

// One ring for every arc: 100% wraps the widest line all the way round,
// leaving a gap about half a letter wide where the ends meet, so the slider
// runs from a gentle curve (a quarter turn near 25%) to a full circle.
function arcWarp(glyphs, bend, metrics) {
	const side = Math.sign(bend);
	const width = Math.max(1, metrics.width);
	const radius = (width + metrics.fontSize * 0.6) / (2 * Math.PI * Math.abs(bend));
	const centerY = metrics.centerY + side * radius;
	return glyphs.map((glyph) => {
		// Lines farther from the circle's center sit on a larger ring. Angles
		// are measured on the block's middle ring, so the block bends as one
		// piece and a single line keeps its spacing at mid-height.
		const ringRadius = Math.max(1, radius - side * (glyph.y - metrics.centerY));
		const angle = (glyph.x - metrics.centerX) / radius;
		return {
			x: metrics.centerX + ringRadius * Math.sin(angle),
			y: centerY - side * ringRadius * Math.cos(angle),
			rotation: side * angle,
			scaleY: 1
		};
	});
}

// One full sine across the widest line, letters leaning with the slope.
// Three things keep the spacing even instead of crowding at the crests and
// gaping in the troughs:
//   - each letter keeps its flat distance from the center measured ALONG the
//     curve, so the steep stretches don't pull letters apart;
//   - it leans about its mid-height, not its baseline, so a crest's squeeze
//     and a trough's spread are split between the letter's top and bottom;
//   - the curve is never tighter than WAVE_MIN_RADIUS letter heights, so a
//     short word gets a gentler wave rather than letters piled on each other.
const WAVE_MIN_RADIUS = 1.5;
const WAVE_STEPS = 96;

function waveWarp(glyphs, bend, metrics) {
	const width = Math.max(1, metrics.width);
	const frequency = 2 * Math.PI / width;
	const half = Math.max(1, metrics.ascent) / 2;
	// A*sin(kx) peaks at curvature A*k^2.
	const maxAmplitude = 1 / (frequency * frequency * WAVE_MIN_RADIUS * half * 2);
	const amplitude = bend * Math.min(metrics.fontSize * 0.5, maxAmplitude);
	const slope = (offset) => amplitude * frequency * Math.cos(offset * frequency);
	// Arc length from the center out along one side (the wave is odd, so the
	// other side mirrors it).
	const step = width / 2 / WAVE_STEPS;
	const lengths = [0];
	for (let index = 1; index <= WAVE_STEPS; index += 1) {
		lengths.push(lengths[index - 1] + (Math.hypot(1, slope((index - 1) * step)) + Math.hypot(1, slope(index * step))) / 2 * step);
	}
	const offsetAlongCurve = (distance) => {
		const target = Math.abs(distance);
		const total = lengths[WAVE_STEPS];
		if (target >= total) return Math.sign(distance) * (width / 2 + target - total);
		let index = 1;
		while (lengths[index] < target) index += 1;
		const t = (target - lengths[index - 1]) / Math.max(1e-9, lengths[index] - lengths[index - 1]);
		return Math.sign(distance) * (index - 1 + t) * step;
	};
	return glyphs.map((glyph) => {
		const offset = offsetAlongCurve(glyph.x - metrics.centerX);
		const rotation = Math.atan(-slope(offset));
		const pivotX = metrics.centerX + offset;
		const pivotY = glyph.y - half - amplitude * Math.sin(offset * frequency);
		return {
			x: pivotX - half * Math.sin(rotation),
			y: pivotY + half * Math.cos(rotation),
			rotation,
			scaleY: 1
		};
	});
}

// Envelope warps reshape the whole block between a top and a bottom curve, so
// the letter outlines themselves bend (a glyph placement can only move, turn
// and stretch a letter). envelope(u, bend) -> { top, bottom }: how far the
// block's top and bottom edges move at u (0 at the ink's left edge, 1 at its
// right), in block heights, positive downward. bottom - top must stay above
// -1 so the block never folds. The mask is drawn flat and pushed through the
// envelope column by column (drawThroughWarpEnvelope); layoutGlyphs gives the
// same warp one letter at a time, for carets, Split and line boxes.
function getEnvelopeU(x, metrics) {
	const width = Math.max(1, metrics.width);
	return Math.max(0, Math.min(1, (x - (metrics.centerX - width / 2)) / width));
}

function mapEnvelopeY(edges, y, metrics) {
	const height = Math.max(1, metrics.height);
	const v = (y - (metrics.centerY - height / 2)) / height;
	return y + height * (edges.top * (1 - v) + edges.bottom * v);
}

function envelopeWarp(id, label, envelope) {
	return Object.freeze({
		id,
		label,
		envelope,
		layoutGlyphs: (glyphs, bend, metrics) => glyphs.map((glyph) => {
			const edges = envelope(getEnvelopeU(glyph.x, metrics), bend);
			return {
				x: glyph.x,
				y: mapEnvelopeY(edges, glyph.y, metrics),
				rotation: 0,
				scaleY: 1 + edges.bottom - edges.top
			};
		})
	});
}

// 1 mid-block, 0 at both ends.
function centerSwell(u) {
	const t = 2 * u - 1;
	return 1 - t * t;
}

// The same, with straight sides: a point instead of a dome.
function centerPoint(u) {
	return 1 - Math.abs(2 * u - 1);
}

// Both edges move together: the block keeps its height and letters stay
// upright, sheared along the line.
function shiftBoth(amount) {
	return { top: amount, bottom: amount };
}

const WARP_TYPES = Object.freeze({
	none: Object.freeze({ id: 'none', label: 'None', layoutGlyphs: null }),
	arc: Object.freeze({
		id: 'arc',
		label: 'Arc',
		layoutGlyphs: (glyphs, bend, metrics) => arcWarp(glyphs, bend, metrics)
	}),
	// The bottom edge stays flat and the top rises toward the middle.
	arch: envelopeWarp('arch', 'Arch', (u, bend) => ({ top: -0.8 * bend * centerSwell(u), bottom: 0 })),
	// Arch upside down: the top stays flat and the bottom drops toward the middle.
	sag: envelopeWarp('sag', 'Sag', (u, bend) => ({ top: 0, bottom: 0.8 * bend * centerSwell(u) })),
	// The line bows up in the middle with its letters upright (Arc turns them).
	bow: envelopeWarp('bow', 'Bow', (u, bend) => shiftBoth(-0.6 * bend * centerSwell(u))),
	// Bow with straight sides.
	chevron: envelopeWarp('chevron', 'Chevron', (u, bend) => shiftBoth(-0.6 * bend * centerPoint(u))),
	// Arch with straight sides: the top comes to a point.
	peak: envelopeWarp('peak', 'Peak', (u, bend) => ({ top: -0.8 * bend * centerPoint(u), bottom: 0 })),
	// The whole block climbs to the right (falls, below 0): two block heights
	// end to end at 100%.
	rise: envelopeWarp('rise', 'Rise', (u, bend) => shiftBoth(bend * (1 - 2 * u))),
	// Letters shrink toward the right (toward the left, below 0).
	taper: envelopeWarp('taper', 'Taper', (u, bend) => {
		const amount = 0.4 * Math.abs(bend) * (bend > 0 ? u : 1 - u);
		return { top: amount, bottom: -amount };
	}),
	// Letters climb and grow toward the right (toward the left, below 0): the
	// top edge rises faster than the bottom.
	climb: envelopeWarp('climb', 'Climb', (u, bend) => {
		const amount = Math.abs(bend) * (bend > 0 ? u : 1 - u);
		return { top: -amount, bottom: -0.3 * amount };
	}),
	// One slow wave, letters upright (Wave turns them along the curve).
	ripple: envelopeWarp('ripple', 'Ripple', (u, bend) => shiftBoth(-0.5 * bend * Math.sin(2 * Math.PI * u))),
	wave: Object.freeze({
		id: 'wave',
		label: 'Wave',
		layoutGlyphs: (glyphs, bend, metrics) => waveWarp(glyphs, bend, metrics)
	}),
	// A waving flag: one and a half ripples, letters kept upright.
	flag: Object.freeze({
		id: 'flag',
		label: 'Flag',
		layoutGlyphs: (glyphs, bend, metrics) => {
			const width = Math.max(1, metrics.width);
			const amplitude = bend * metrics.fontSize * 0.35;
			return glyphs.map((glyph) => ({
				x: glyph.x,
				y: glyph.y - amplitude * Math.sin((glyph.x - metrics.centerX) * 3 * Math.PI / width),
				rotation: 0,
				scaleY: 1
			}));
		}
	}),
	// The block swells (or pinches, below 0) about its middle.
	bulge: envelopeWarp('bulge', 'Bulge', (u, bend) => {
		const amount = 0.35 * bend * centerSwell(u);
		return { top: -amount, bottom: amount };
	})
});

defineOptions('textWarp', Object.values(WARP_TYPES).map(({ id, label }) => ({ value: id, label })));

function normalizeTextWarp(warp) {
	const named = warp?.type;
	const type = WARP_TYPES[named] ? named : CONFIG.tools.text.defaultWarpType;
	const spec = FIELDS.textWarpBend;
	const bend = Number(warp?.bend);
	return {
		type,
		bend: Math.max(spec.min, Math.min(spec.max, Number.isFinite(bend) ? bend : spec.value))
	};
}

// A warp that changes nothing takes the flat drawing path, so unwarped text
// keeps its exact pixels.
function isTextWarpActive(warp) {
	return Boolean(WARP_TYPES[warp?.type]?.layoutGlyphs) && Number(warp.bend) !== 0;
}

function layoutWarpedGlyphs(warp, glyphs, metrics) {
	if (!isTextWarpActive(warp)) {
		return glyphs.map((glyph) => ({ x: glyph.x, y: glyph.y, rotation: 0, scaleY: 1 }));
	}
	return WARP_TYPES[warp.type].layoutGlyphs(glyphs, warp.bend / 100, metrics);
}

// The ink box of one placed glyph, in the same space as its placement. ink
// is the glyph's own box around its drawing origin (the advance center on the
// baseline): { left, right, top, bottom } with top negative above the baseline.
function getWarpedGlyphBounds(placement, ink) {
	const cos = Math.cos(placement.rotation);
	const sin = Math.sin(placement.rotation);
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	[[ink.left, ink.top], [ink.right, ink.top], [ink.right, ink.bottom], [ink.left, ink.bottom]].forEach(([localX, localY]) => {
		const scaledY = localY * placement.scaleY;
		const x = placement.x + localX * cos - scaledY * sin;
		const y = placement.y + localX * sin + scaledY * cos;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	});
	return { left: minX, top: minY, right: maxX, bottom: maxY };
}

function hasWarpEnvelope(warp) {
	return isTextWarpActive(warp) && Boolean(WARP_TYPES[warp.type].envelope);
}

// Where a flat box { left, top, right, bottom } lands under an envelope warp.
// Its edges curve, so the ends and the middle are all sampled.
function getEnvelopeWarpBounds(warp, box, metrics) {
	const envelope = WARP_TYPES[warp.type].envelope;
	let top = Infinity;
	let bottom = -Infinity;
	[box.left, (box.left + box.right) / 2, box.right].forEach((x) => {
		const edges = envelope(getEnvelopeU(x, metrics), warp.bend / 100);
		const a = mapEnvelopeY(edges, box.top, metrics);
		const b = mapEnvelopeY(edges, box.bottom, metrics);
		top = Math.min(top, a, b);
		bottom = Math.max(bottom, a, b);
	});
	return { left: box.left, top, right: box.right, bottom };
}

// Paints flat artwork through an envelope warp. drawFlat(ctx, offsetX,
// offsetY) draws the unwarped artwork with the offset added to its text-local
// coordinates; rect is its flat ink box in that space, and (originX, originY)
// is where text-local 0,0 sits on `context`. Columns are one device pixel
// wide and land on whole device pixels, so a scaled context (rasterized layer
// scale) warps at its own resolution and neighbors never blend into seams.
function drawThroughWarpEnvelope(context, warp, metrics, rect, originX, originY, drawFlat) {
	const envelope = WARP_TYPES[warp.type].envelope;
	const bend = warp.bend / 100;
	const base = context.getTransform();
	const scaleX = Math.abs(base.a) || 1;
	const scaleY = Math.abs(base.d) || 1;
	const margin = 2;
	const deviceLeft = Math.floor((originX + rect.left - margin) * scaleX + base.e);
	const deviceRight = Math.ceil((originX + rect.right + margin) * scaleX + base.e);
	const localLeft = (deviceLeft - base.e) / scaleX - originX;
	const localTop = rect.top - margin;
	const width = Math.max(1, deviceRight - deviceLeft);
	const height = Math.max(1, Math.ceil((rect.bottom - rect.top + margin * 2) * scaleY));
	const localBottom = localTop + height / scaleY;
	const scratch = createAppCanvas(width, height, 'paint/text-warp');
	const scratchCtx = scratch.getContext('2d');
	scratchCtx.scale(scaleX, scaleY);
	drawFlat(scratchCtx, -localLeft, -localTop);
	context.save();
	context.setTransform(1, 0, 0, 1, 0, 0);
	for (let column = 0; column < width; column += 1) {
		const edges = envelope(getEnvelopeU(localLeft + (column + 0.5) / scaleX, metrics), bend);
		const top = (originY + mapEnvelopeY(edges, localTop, metrics)) * scaleY + base.f;
		const bottom = (originY + mapEnvelopeY(edges, localBottom, metrics)) * scaleY + base.f;
		context.drawImage(scratch, column, 0, 1, height, deviceLeft + column, top, 1, bottom - top);
	}
	context.restore();
	scratch.width = scratch.height = 0;
}

// Grid choices. Each writes a type and a bend (copied, never referenced), and
// the Bend slider tunes it afterwards.
const WARP_PRESETS = GlitterPresetLibrary.createPresetLibrary({
	id: 'text-warps',
	groups: [
		{ id: 'curves', label: 'Curves' },
		{ id: 'waves', label: 'Waves' },
		{ id: 'slants', label: 'Slants' }
	],
	entries: [
		{ id: 'none', label: 'None', group: 'curves', value: { type: 'none', bend: FIELDS.textWarpBend.value } },
		{ id: 'arc', label: 'Arc', group: 'curves', value: { type: 'arc', bend: 25 } },
		{ id: 'arc-down', label: 'Arc Down', group: 'curves', value: { type: 'arc', bend: -25 } },
		{ id: 'arch', label: 'Arch', group: 'curves', value: { type: 'arch', bend: 50 } },
		{ id: 'circle', label: 'Circle', group: 'curves', value: { type: 'arc', bend: 100 } },
		{ id: 'bulge', label: 'Bulge', group: 'curves', value: { type: 'bulge', bend: 50 } },
		{ id: 'pinch', label: 'Pinch', group: 'curves', value: { type: 'bulge', bend: -40 } },
		{ id: 'sag', label: 'Sag', group: 'curves', value: { type: 'sag', bend: 50 } },
		{ id: 'bow', label: 'Bow', group: 'curves', value: { type: 'bow', bend: 50 } },
		{ id: 'bow-down', label: 'Bow Down', group: 'curves', value: { type: 'bow', bend: -50 } },
		{ id: 'wave', label: 'Wave', group: 'waves', value: { type: 'wave', bend: 50 } },
		{ id: 'flag', label: 'Flag', group: 'waves', value: { type: 'flag', bend: 50 } },
		{ id: 'ripple', label: 'Ripple', group: 'waves', value: { type: 'ripple', bend: 50 } },
		{ id: 'rise', label: 'Rise', group: 'slants', value: { type: 'rise', bend: 50 } },
		{ id: 'fall', label: 'Fall', group: 'slants', value: { type: 'rise', bend: -50 } },
		{ id: 'taper', label: 'Taper', group: 'slants', value: { type: 'taper', bend: 60 } },
		{ id: 'grow', label: 'Grow', group: 'slants', value: { type: 'taper', bend: -60 } },
		{ id: 'climb', label: 'Climb', group: 'slants', value: { type: 'climb', bend: 50 } },
		{ id: 'chevron', label: 'Chevron', group: 'slants', value: { type: 'chevron', bend: 50 } },
		{ id: 'chevron-down', label: 'Chevron Down', group: 'slants', value: { type: 'chevron', bend: -50 } },
		{ id: 'peak', label: 'Peak', group: 'slants', value: { type: 'peak', bend: 50 } }
	],
	renderThumbnail(entry, element) {
		element.classList.add('is-drawn');
		element.style.backgroundImage = `url(${getWarpPresetThumbnail(entry)})`;
	},
	// target is textData.
	apply(entry, target, value) {
		if (target) target.warp = normalizeTextWarp(value);
	}
});

// The grid tile a warp belongs to. An exact preset match is that preset;
// a warp the Bend slider has moved off every preset still belongs to the
// nearest preset of its type bending the same way (Arc at 40% is an edited
// Arc, Arc at 90% an edited Circle), so the grid never loses the type.
// -> { id, modified } or null
function matchWarpPreset(warp) {
	const current = normalizeTextWarp(warp);
	if (!isTextWarpActive(current)) return { id: 'none', modified: false };
	// A type with one tile (Sag, Ripple) keeps it when bent the other way.
	const ofType = WARP_PRESETS.entries.filter((entry) => entry.value.type === current.type);
	const sameWay = ofType.filter((entry) => Math.sign(entry.value.bend) === Math.sign(current.bend));
	const candidates = sameWay.length ? sameWay : ofType;
	if (!candidates.length) return null;
	const nearest = candidates.reduce((best, entry) => (
		Math.abs(entry.value.bend - current.bend) < Math.abs(best.value.bend - current.bend) ? entry : best
	));
	return { id: nearest.id, modified: nearest.value.bend !== current.bend };
}

function findWarpPresetId(warp) {
	const match = matchWarpPreset(warp);
	return match && !match.modified ? match.id : null;
}

const WARP_THUMBNAIL_CACHE = new Map();

// A curved "Abc" through the same layout function the mask uses, on a
// transparent landscape tile (the grid supplies the dark backdrop).
function getWarpPresetThumbnail(entry) {
	if (WARP_THUMBNAIL_CACHE.has(entry.id)) return WARP_THUMBNAIL_CACHE.get(entry.id);
	const width = 96;
	const height = 48;
	// A full circle needs smaller, more letters to read as a ring on the tile.
	const circle = entry.id === 'circle';
	const fontSize = circle ? 10 : 18;
	const canvas = createAppCanvas(width, height, 'paint/text-warp');
	const ctx = canvas.getContext('2d');
	ctx.font = `900 ${fontSize}px sans-serif`;
	ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = '#ff9ad5';
	const text = circle ? 'GLITTER*GLITTER' : 'Abcde';
	const chars = Array.from(text);
	const advances = chars.map((char) => ctx.measureText(char).width);
	const total = advances.reduce((sum, advance) => sum + advance, 0);
	const ascent = fontSize * 0.72;
	let cursor = (width - total) / 2;
	const glyphs = chars.map((char, index) => {
		const glyph = { x: cursor + advances[index] / 2, y: height / 2 + ascent / 2, line: 0 };
		cursor += advances[index];
		return glyph;
	});
	const metrics = { centerX: width / 2, centerY: height / 2, width: total, height: ascent, fontSize, ascent };
	if (hasWarpEnvelope(entry.value)) {
		const rect = { left: (width - total) / 2, top: (height - ascent) / 2, right: (width + total) / 2, bottom: (height + ascent) / 2 };
		drawThroughWarpEnvelope(ctx, entry.value, metrics, rect, 0, 0, (flat, offsetX, offsetY) => {
			flat.font = ctx.font;
			flat.textBaseline = 'alphabetic';
			flat.fillStyle = ctx.fillStyle;
			chars.forEach((char, index) => flat.fillText(char, offsetX + glyphs[index].x - advances[index] / 2, offsetY + glyphs[index].y));
		});
	} else {
		layoutWarpedGlyphs(entry.value, glyphs, metrics).forEach((placement, index) => {
			ctx.save();
			ctx.translate(placement.x, placement.y);
			ctx.rotate(placement.rotation);
			ctx.scale(1, placement.scaleY);
			ctx.fillText(chars[index], -advances[index] / 2, 0);
			ctx.restore();
		});
	}
	const url = canvas.toDataURL('image/png');
	canvas.width = canvas.height = 0;
	WARP_THUMBNAIL_CACHE.set(entry.id, url);
	return url;
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = { WARP_TYPES, WARP_PRESETS, normalizeTextWarp, isTextWarpActive, layoutWarpedGlyphs, getWarpedGlyphBounds, hasWarpEnvelope, getEnvelopeWarpBounds, findWarpPresetId, matchWarpPreset };
}
