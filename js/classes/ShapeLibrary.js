// ============================================
// SHAPE LIBRARY
// ============================================
// Single source of truth for all shape geometry AND the gallery thumbnails
// (WP5a/WP5b, docs/TOOL-EXPANSION-PLAN.md). Each shape is defined ONCE — as an
// SVG path `d` string (or a trivial primitive) in its own square viewBox — and
// that same definition drives:
//   - the on-canvas mask (trace() fills a Path2D built from the definition), and
//   - the picker thumbnail (getIconSvg() emits an <svg> using the same path).
// So the thumbnail always matches what lands on the canvas.
//
// Adding a brush tip or fill shape = adding one entry to DEFS with an `svg` path
// (in a `viewBox`-sized box). It is rasterized through the same crisp-threshold
// step as everything else, so custom shapes stay pixel-crisp/aliased like the
// built-ins.
//
// trace(id, ctx, halfW, halfH, {fit}) FILLS the shape centered on the current
// origin, scaled so its content bounds fit a box of half-width halfW / half-
// height halfH. `fit`: 'contain' (uniform, aspect-preserving — the brush) or
// 'fill' (stretch to the box — the Shape tool). Callers set fillStyle and any
// filter beforehand; trace does the fill.

const ShapeLibrary = {
	// id -> definition. `svg` is an SVG path `d` in a `viewBox`×`viewBox` box.
	// Primitives (circle/square/calligraphy) are built directly as Path2D so the
	// trivial cases need no hand-authored path. brushOnly hides a tip from the
	// Shape tool's fill picker.
	DEFS: {
		circle: { primitive: 'circle', viewBox: 24 },
		square: { primitive: 'square', viewBox: 24 },
		calligraphy: { primitive: 'calligraphy', viewBox: 24, brushOnly: true },
		star: {
			viewBox: 24,
			svg: 'M12 2 L14.7 8.6 L21.8 9.2 L16.4 13.8 L18.1 20.8 L12 17 L5.9 20.8 L7.6 13.8 L2.2 9.2 L9.3 8.6 Z'
		},
		heart: {
			viewBox: 24,
			svg: 'M12 21 C12 21 3 14.6 3 8.8 C3 5.6 5.4 3.5 8 3.5 C10 3.5 11.4 4.8 12 6 C12.6 4.8 14 3.5 16 3.5 C18.6 3.5 21 5.6 21 8.8 C21 14.6 12 21 12 21 Z'
		},
		triangle: { viewBox: 24, svg: 'M12 2 L22 21 L2 21 Z' },
		diamond: { viewBox: 24, svg: 'M12 1 L22 12 L12 23 L2 12 Z' },
		pentagon: { viewBox: 24, svg: 'M12 2 L22 9.3 L18.2 21 L5.8 21 L2 9.3 Z' },
		hexagon: { viewBox: 24, svg: 'M6.5 2.5 L17.5 2.5 L23 12 L17.5 21.5 L6.5 21.5 L1 12 Z' }
	},

	// Build (once) the Path2D and its rasterized content bounds for a shape.
	// Bounds are found by scanning alpha, so fitting is accurate for ANY path —
	// including user-supplied SVGs — with no hand-measured numbers.
	_geometry(id) {
		const def = this.DEFS[id] || this.DEFS.circle;
		if (def._geom) return def._geom;
		const path = this._buildPath(def);
		const bounds = this._computeBounds(path, def.viewBox || 24);
		def._geom = { path, bounds };
		return def._geom;
	},

	_buildPath(def) {
		if (def.svg) return new Path2D(def.svg);
		const vb = def.viewBox || 24;
		const p = new Path2D();
		if (def.primitive === 'square') {
			p.rect(0, 0, vb, vb);
		} else if (def.primitive === 'calligraphy') {
			// Flat 45° nib.
			p.ellipse(vb / 2, vb / 2, vb / 2, vb * 0.16, -Math.PI / 4, 0, Math.PI * 2);
		} else {
			p.arc(vb / 2, vb / 2, vb / 2, 0, Math.PI * 2);
		}
		return p;
	},

	_computeBounds(path, viewBox) {
		const S = 4; // supersample for a tighter bbox
		const size = Math.max(1, Math.round(viewBox * S));
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.scale(S, S);
		ctx.fillStyle = '#000';
		ctx.fill(path);
		const data = ctx.getImageData(0, 0, size, size).data;
		let minX = size, minY = size, maxX = 0, maxY = 0, found = false;
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				if (data[(y * size + x) * 4 + 3] > 10) {
					found = true;
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
		}
		if (!found) return { minX: 0, minY: 0, maxX: viewBox, maxY: viewBox };
		return { minX: minX / S, minY: minY / S, maxX: (maxX + 1) / S, maxY: (maxY + 1) / S };
	},

	// A Path2D of the shape mapped into a box of half-width halfW / half-height
	// halfH, centered on (0,0) in OUTPUT units. Used to fill the shape (trace)
	// and, crucially, to STROKE a smooth vector border (uniform lineWidth in
	// output space, no scalloping) — far cleaner than raster ring-union.
	buildTransformedPath(id, halfW, halfH, options = {}) {
		const geom = this._geometry(id);
		const bw = (geom.bounds.maxX - geom.bounds.minX) || 1;
		const bh = (geom.bounds.maxY - geom.bounds.minY) || 1;
		const cx = (geom.bounds.minX + geom.bounds.maxX) / 2;
		const cy = (geom.bounds.minY + geom.bounds.maxY) / 2;

		let sx = (2 * halfW) / bw;
		let sy = (2 * halfH) / bh;
		if ((options.fit || 'contain') === 'contain') {
			sx = sy = Math.min(sx, sy);
		}

		// CTM = Scale · Translate(-center) → point p maps to (p - center) * scale.
		const matrix = new DOMMatrix().scaleSelf(sx, sy).translateSelf(-cx, -cy);
		const out = new Path2D();
		out.addPath(geom.path, matrix);
		return out;
	},

	trace(id, ctx, halfW, halfH, options = {}) {
		ctx.fill(this.buildTransformedPath(id, halfW, halfH, options));
	},

	// Full <svg> markup for a picker thumbnail — same geometry as trace(), so the
	// thumbnail matches the stamped/filled result. fill:currentColor is theme-aware.
	getIconSvg(id) {
		const def = this.DEFS[id] || this.DEFS.circle;
		const vb = def.viewBox || 24;
		let inner;
		if (def.svg) {
			inner = `<path d="${def.svg}"/>`;
		} else if (def.primitive === 'square') {
			inner = `<rect x="0" y="0" width="${vb}" height="${vb}"/>`;
		} else if (def.primitive === 'calligraphy') {
			inner = `<ellipse cx="${vb / 2}" cy="${vb / 2}" rx="${vb / 2}" ry="${vb * 0.16}" transform="rotate(-45 ${vb / 2} ${vb / 2})"/>`;
		} else {
			inner = `<circle cx="${vb / 2}" cy="${vb / 2}" r="${vb / 2}"/>`;
		}
		return `<svg viewBox="0 0 ${vb} ${vb}">${inner}</svg>`;
	},

	// Natural aspect ratio (width / height) of a shape's content bounds, so a
	// shape can be created undistorted (e.g. a regular hexagon isn't square).
	getAspect(id) {
		const g = this._geometry(id);
		const w = (g.bounds.maxX - g.bounds.minX) || 1;
		const h = (g.bounds.maxY - g.bounds.minY) || 1;
		return w / h;
	},

	isFillShape(id) {
		return this.FILL_SHAPES.some((shape) => shape.id === id);
	},

	isBrushShape(id) {
		return this.BRUSH_SHAPES.some((shape) => shape.id === id);
	}
};

// Catalogs (id + label + brushOnly) derived from DEFS. Gallery order is the
// insertion order below.
ShapeLibrary.BRUSH_SHAPES = [
	{ id: 'round', label: 'Round' }, // round tip is a soft radial gradient, not a traced path (see MaskEditor._drawRoundStamp)
	{ id: 'square', label: 'Square' },
	{ id: 'calligraphy', label: 'Calligraphy', brushOnly: true },
	{ id: 'star', label: 'Star' },
	{ id: 'heart', label: 'Heart' }
];

ShapeLibrary.FILL_SHAPES = [
	{ id: 'circle', label: 'Circle' },
	{ id: 'square', label: 'Square' },
	{ id: 'triangle', label: 'Triangle' },
	{ id: 'diamond', label: 'Diamond' },
	{ id: 'pentagon', label: 'Pentagon' },
	{ id: 'hexagon', label: 'Hexagon' },
	{ id: 'star', label: 'Star' },
	{ id: 'heart', label: 'Heart' }
];
