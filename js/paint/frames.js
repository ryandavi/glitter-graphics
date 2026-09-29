'use strict';

// Frames: the Frame layer's registries and geometry (js/layers/FrameLayerManager.js).
//
//   FRAME_KINDS    what draws the frame: a generated early-web `style` ring
//                  painted with the frame's fill slot, or an ornate `image`
//                  (a transparent frame sticker) fitted to the frame box.
//   FRAME_STYLES   the style kind's looks as band tables. A band is a slice
//                  of the ring's thickness (from/to: 0 = outer edge, 1 =
//                  inner edge) with a shade per side (-1 dark, 0 flat, 1
//                  light) and an optional dash pattern. This is CSS's own
//                  border algorithm: the sides meet at the corner diagonals,
//                  and groove and ridge are two halves shaded oppositely.
//   FRAME_PRESETS  the preset library (js/ui/preset-library.js).
//
// Light and dark come from the frame's own paint, shaded through the color
// adjust brightness, so a glitter ridge frame works. The preview span stack
// and the export slot stack both read buildFrameShadeMasks and
// shadeFramePaintSource.

const FRAME_KINDS = Object.freeze({
	style: Object.freeze({ id: 'style', label: 'Style', paints: true }),
	image: Object.freeze({ id: 'image', label: 'Image', paints: false })
});
defineOptions('frameKind', Object.values(FRAME_KINDS).map(({ id, label }) => ({ value: id, label })));

const FRAME_SIDE_SHADES = Object.freeze({
	flat: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
	inset: Object.freeze({ top: -1, left: -1, bottom: 1, right: 1 }),
	outset: Object.freeze({ top: 1, left: 1, bottom: -1, right: -1 })
});

const FRAME_STYLES = (() => {
	const band = (from, to, shades = 'flat', pattern = null) => Object.freeze({ from, to, shades: FRAME_SIDE_SHADES[shades], pattern });
	const definitions = {
		solid: { label: 'Solid', bands: [band(0, 1)] },
		double: { label: 'Double', bands: [band(0, 1 / 3), band(2 / 3, 1)] },
		dotted: { label: 'Dotted', bands: [band(0, 1, 'flat', 'dotted')] },
		dashed: { label: 'Dashed', bands: [band(0, 1, 'flat', 'dashed')] },
		inset: { label: 'Inset', bands: [band(0, 1, 'inset')] },
		outset: { label: 'Outset', bands: [band(0, 1, 'outset')] },
		groove: { label: 'Groove', bands: [band(0, 0.5, 'inset'), band(0.5, 1, 'outset')] },
		ridge: { label: 'Ridge', bands: [band(0, 0.5, 'outset'), band(0.5, 1, 'inset')] }
	};
	return Object.freeze(Object.fromEntries(Object.entries(definitions).map(([id, entry]) => [
		id,
		Object.freeze({ id, ...entry, bands: Object.freeze(entry.bands) })
	])));
})();
defineOptions('frameStyle', Object.values(FRAME_STYLES).map(({ id, label }) => ({ value: id, label })));

// Ring thickness and outer corner radius, clamped to the box.
function getFrameRing(data, width, height) {
	const half = Math.max(0.5, Math.min(width, height) / 2);
	return {
		thickness: Math.max(1, Math.min(half, Number(data?.widthPx) || FIELDS.frameThickness.value)),
		radius: Math.max(0, Math.min(half, Number(data?.radius) || 0))
	};
}

// A rounded rectangle inset from the box edge, radius shrinking with it.
function traceFrameRect(path, inset, width, height, radius) {
	const w = width - inset * 2;
	const h = height - inset * 2;
	if (w <= 0 || h <= 0) return 0;
	const r = Math.max(0, Math.min(radius - inset, w / 2, h / 2));
	if (r > 0) path.roundRect(inset, inset, w, h, r);
	else path.rect(inset, inset, w, h);
	return 2 * (w + h) - 8 * r + 2 * Math.PI * r;
}

// One band of the ring, white on ctx. A patterned band strokes its center
// line with a dash evenly fitted to the perimeter, so no half dot sits at the
// seam.
function drawFrameBand(ctx, band, ring, width, height) {
	const outer = band.from * ring.thickness;
	const inner = band.to * ring.thickness;
	ctx.fillStyle = '#ffffff';
	ctx.strokeStyle = '#ffffff';
	if (!band.pattern) {
		const path = new Path2D();
		traceFrameRect(path, outer, width, height, ring.radius);
		traceFrameRect(path, inner, width, height, ring.radius);
		ctx.fill(path, 'evenodd');
		return;
	}
	const lineWidth = inner - outer;
	const path = new Path2D();
	const perimeter = traceFrameRect(path, outer + lineWidth / 2, width, height, ring.radius);
	if (perimeter <= 0) return;
	ctx.lineWidth = lineWidth;
	if (band.pattern === 'dotted') {
		const count = Math.max(1, Math.round(perimeter / (lineWidth * 2)));
		ctx.lineCap = 'round';
		ctx.setLineDash([0, perimeter / count]);
	} else {
		const count = Math.max(1, Math.round(perimeter / (lineWidth * 5)));
		const segment = perimeter / count;
		ctx.lineCap = 'butt';
		ctx.setLineDash([segment * 0.6, segment * 0.4]);
	}
	ctx.stroke(path);
	ctx.setLineDash([]);
}

// Which side a pixel belongs to: the nearest box edge, so the sides meet at
// the corner diagonals (rounded corners too). Ties go top, bottom, left.
function getFrameSide(x, y, width, height) {
	const top = y;
	const bottom = height - y;
	const left = x;
	const right = width - x;
	const nearest = Math.min(top, bottom, left, right);
	if (nearest === top) return 'top';
	if (nearest === bottom) return 'bottom';
	if (nearest === left) return 'left';
	return 'right';
}

const FRAME_MASK_CACHE = new Map();
const FRAME_MASK_CACHE_LIMIT = 8;

function getFrameMaskKey(data, width, height) {
	const ring = getFrameRing(data, width, height);
	return JSON.stringify([data?.style, width, height, ring.thickness, ring.radius, shouldUseCrispMaskEdges(), CONFIG.rendering.maskAlphaThreshold]);
}

// The ring split by shade: [{ key, shade, canvas }] in shade order, each a
// width x height mask. Every pixel of the ring is in exactly one mask. The
// result is cached; callers must not draw into the canvases.
function buildFrameShadeMasks(data, width, height) {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	const key = getFrameMaskKey(data, w, h);
	const cached = FRAME_MASK_CACHE.get(key);
	if (cached) return cached;

	const style = FRAME_STYLES[data?.style] || FRAME_STYLES.solid;
	const ring = getFrameRing(data, w, h);
	const scratch = createAppCanvas(w, h, 'paint/frames');
	const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
	const threshold = shouldUseCrispMaskEdges() ? CONFIG.rendering.maskAlphaThreshold : 1;
	const groups = new Map();
	const groupFor = (shade) => {
		if (!groups.has(shade)) groups.set(shade, new ImageData(w, h));
		return groups.get(shade).data;
	};

	style.bands.forEach((band) => {
		scratchCtx.clearRect(0, 0, w, h);
		drawFrameBand(scratchCtx, band, ring, w, h);
		const pixels = scratchCtx.getImageData(0, 0, w, h).data;
		const shades = band.shades;
		const flat = shades.top === shades.right && shades.top === shades.bottom && shades.top === shades.left;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const index = (y * w + x) * 4;
				const alpha = pixels[index + 3];
				if (alpha < threshold) continue;
				const shade = flat ? shades.top : shades[getFrameSide(x + 0.5, y + 0.5, w, h)];
				const target = groupFor(shade);
				target[index] = target[index + 1] = target[index + 2] = 255;
				target[index + 3] = shouldUseCrispMaskEdges() ? 255 : alpha;
			}
		}
	});
	scratch.width = scratch.height = 0;

	const masks = Object.freeze([...groups.keys()].sort((a, b) => a - b).map((shade) => {
		const canvas = createAppCanvas(w, h, 'paint/frames');
		canvas.getContext('2d').putImageData(groups.get(shade), 0, 0);
		canvas._textureOrigin = { x: 0, y: 0 };
		canvas._paintBox = { x: 0, y: 0, width: w, height: h };
		return Object.freeze({ key: `shade${shade}`, shade, canvas });
	}));
	FRAME_MASK_CACHE.set(key, masks);
	while (FRAME_MASK_CACHE.size > FRAME_MASK_CACHE_LIMIT) FRAME_MASK_CACHE.delete(FRAME_MASK_CACHE.keys().next().value);
	return masks;
}

// Brightness percent a band of this shade paints at: Bevel Depth percent
// lighter or darker.
function getFrameShadeBrightness(shade, depth) {
	return Math.max(0, 100 + shade * (Number(depth) || 0));
}

function shadeFrameHexColor(hex, brightness) {
	const value = parseInt(String(hex || '#000000').replace('#', '').padEnd(6, '0').slice(0, 6), 16);
	const channel = (shift) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * brightness / 100)));
	return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

// A resolved paint source shaded for one band: solid and gradient colors are
// scaled directly; glitter multiplies its color adjust brightness (the CSS
// filter in preview, the pixel matrix in export). Flat bands keep the source.
function shadeFramePaintSource(source, shade, depth) {
	if (!source || !shade) return source;
	const brightness = getFrameShadeBrightness(shade, depth);
	if (brightness === 100) return source;
	if (source.mode === 'solid') return { ...source, color: shadeFrameHexColor(source.color, brightness) };
	if (source.mode === 'gradient') {
		return {
			...source,
			gradient: {
				...source.gradient,
				stops: source.gradient.stops.map((stop) => ({ ...stop, color: shadeFrameHexColor(stop.color, brightness) }))
			}
		};
	}
	if (source.mode === 'glitter') {
		const adjust = normalizeColorAdjust(source.colorAdjust);
		return { ...source, colorAdjust: { ...adjust, brightness: adjust.brightness * brightness / 100 } };
	}
	return source;
}

// Where an image frame's picture sits in the frame box.
function getFrameImagePlacement(fit, imageWidth, imageHeight, width, height) {
	if (fit !== 'contain' || !imageWidth || !imageHeight) return { x: 0, y: 0, width, height };
	const scale = Math.min(width / imageWidth, height / imageHeight);
	const w = imageWidth * scale;
	const h = imageHeight * scale;
	return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

// Presets set only the shape of the frame: style, thickness, corners and
// bevel depth. Paint (glitter, color, gradient) is the fill slot's and never
// changes, so presets are named for their shape, never a color.
const FRAME_PRESETS = GlitterPresetLibrary.createPresetLibrary({
	id: 'frames',
	groups: [
		{ id: 'lines', label: 'Lines' },
		{ id: 'bevels', label: 'Bevels' }
	],
	entries: [
		{ id: 'thin-line', label: 'Thin Line', group: 'lines', value: { style: 'solid', widthPx: 4, radius: 0, shade: 40 } },
		{ id: 'thick-border', label: 'Thick Border', group: 'lines', value: { style: 'solid', widthPx: 18, radius: 0, shade: 40 } },
		{ id: 'rounded', label: 'Rounded', group: 'lines', value: { style: 'solid', widthPx: 14, radius: 24, shade: 40 } },
		{ id: 'double-line', label: 'Double Line', group: 'lines', value: { style: 'double', widthPx: 18, radius: 0, shade: 40 } },
		{ id: 'dotted', label: 'Dotted', group: 'lines', value: { style: 'dotted', widthPx: 12, radius: 0, shade: 40 } },
		{ id: 'dashed', label: 'Dashed', group: 'lines', value: { style: 'dashed', widthPx: 6, radius: 0, shade: 40 } },
		{ id: 'raised', label: 'Raised', group: 'bevels', value: { style: 'outset', widthPx: 6, radius: 0, shade: 45 } },
		{ id: 'sunken', label: 'Sunken', group: 'bevels', value: { style: 'inset', widthPx: 6, radius: 0, shade: 45 } },
		{ id: 'groove', label: 'Groove', group: 'bevels', value: { style: 'groove', widthPx: 14, radius: 0, shade: 35 } },
		{ id: 'ridge', label: 'Ridge', group: 'bevels', value: { style: 'ridge', widthPx: 14, radius: 0, shade: 35 } }
	],
	renderThumbnail(entry, element) {
		element.classList.add('is-drawn');
		element.style.backgroundImage = `url(${getFramePresetThumbnail(entry)})`;
	},
	// target is frameData.
	apply(entry, target, value) {
		if (target) Object.assign(target, { kind: 'style', ...value });
	}
});

// Thumbnails show shape only, so they draw in one neutral gray that shows
// both bevel shades.
const FRAME_THUMBNAIL_COLOR = '#c8c8c8';

const FRAME_THUMBNAIL_CACHE = new Map();

// The preset's ring, drawn once on a transparent landscape
// tile (the preset grid's chip shape); the grid supplies the dark backdrop.
function getFramePresetThumbnail(entry) {
	if (FRAME_THUMBNAIL_CACHE.has(entry.id)) return FRAME_THUMBNAIL_CACHE.get(entry.id);
	const width = 80;
	const height = 40;
	const margin = 4;
	const value = entry.value;
	const canvas = createAppCanvas(width, height, 'paint/frames');
	const ctx = canvas.getContext('2d');
	const data = { style: value.style, widthPx: Math.max(3, Math.round((value.widthPx || 12) / 2)), radius: Math.round((value.radius || 0) / 2) };
	const source = { mode: 'solid', color: FRAME_THUMBNAIL_COLOR, opacity: 1 };
	buildFrameShadeMasks(data, width - margin * 2, height - margin * 2).forEach((mask) => {
		const tinted = createAppCanvas(width - margin * 2, height - margin * 2, 'paint/frames');
		const tintCtx = tinted.getContext('2d');
		tintCtx.fillStyle = shadeFramePaintSource(source, mask.shade, value.shade).color;
		tintCtx.fillRect(0, 0, tinted.width, tinted.height);
		tintCtx.globalCompositeOperation = 'destination-in';
		tintCtx.drawImage(mask.canvas, 0, 0);
		ctx.drawImage(tinted, margin, margin);
		tinted.width = tinted.height = 0;
	});
	const url = canvas.toDataURL('image/png');
	canvas.width = canvas.height = 0;
	FRAME_THUMBNAIL_CACHE.set(entry.id, url);
	return url;
}

// The preset a frame currently matches, if any (values are copied, so this
// compares them).
function findFramePresetId(data) {
	if (!data) return null;
	if (data.kind !== 'style') return null;
	return FRAME_PRESETS.entries.find((entry) => Object.entries(entry.value)
		.every(([key, value]) => data[key] === value))?.id || null;
}
