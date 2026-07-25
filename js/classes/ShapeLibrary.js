// ============================================
// SHAPE LIBRARY
// ============================================
// Single source of truth for all shape geometry AND the gallery thumbnails
// Each shape is defined ONCE — as an
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
	puffyStar: {
		viewBox: 24,
		svg: 'M17.97 24c-.38 0-.75-.1-1.09-.28l-4.87-2.67-4.87 2.67c-.34.19-.72.28-1.09.28-.69 0-1.35-.32-1.8-.88-.44-.55-.63-1.27-.51-1.98l.93-5.65L.71 11.49c-.64-.65-.87-1.61-.59-2.5s1-1.53 1.89-1.66l5.45-.82 2.44-5.14C10.3.52 11.1 0 12 0s1.71.52 2.1 1.36l2.44 5.14 5.45.82c.89.13 1.62.77 1.89 1.66.28.89.05 1.85-.59 2.5l-3.94 4 .93 5.65c.12.71-.07 1.44-.51 1.98-.45.56-1.11.88-1.8.88Z'
	},
	roundedStar: {
		viewBox: 24,
		svg: 'M17.56 14.36l5.93-4.31c.96-.69.46-2.21-.72-2.21h-7.33L13.17.84c-.37-1.12-1.95-1.12-2.32 0l-2.28 7H1.22c-1.18 0-1.67 1.51-.72 2.21l5.95 4.32-2.27 6.99c-.37 1.12.92 2.06 1.88 1.36l5.95-4.32 5.96 4.33c.96.69 2.24-.24 1.88-1.36l-2.28-7Z'
	},
	heart: {
		viewBox: 24,
		svg: 'M12 21 C12 21 3 14.6 3 8.8 C3 5.6 5.4 3.5 8 3.5 C10 3.5 11.4 4.8 12 6 C12.6 4.8 14 3.5 16 3.5 C18.6 3.5 21 5.6 21 8.8 C21 14.6 12 21 12 21 Z'
	},
	rounderHeart: {
		viewBox: 24,
		svg: 'M17.65 0c-2.46 0-4.6 1.4-5.65 3.45C10.95 1.4 8.81 0 6.35 0 2.84 0 0 2.84 0 6.35c0 1.32.35 3.37 1.68 4.96 5.3 6.32 10.3 9.15 10.32 9.16h0s0 0 0 0h0s0 0 0 0h0s5.02-2.84 10.32-9.16C23.65 9.72 24 7.67 24 6.35 24 2.84 21.16 0 17.65 0Z'
	},
	sparkle: {
		viewBox: 24,
		svg: 'M24 12c-8 2.21-9.79 4-12 12-2.21-8-4-9.79-12-12C8 9.79 9.79 8 12 0c2.21 8 4 9.79 12 12Z'
	},

	fivePetalFlower: {
		viewBox: 24,
		svg: 'M24.37 10.32c0-2.75-2.23-4.98-4.98-4.98-.84 0-1.63.21-2.32.58.06-.31.09-.62.09-.94 0-2.75-2.23-4.98-4.98-4.98S7.2 2.23 7.2 4.98c0 .32.03.64.09.94-.69-.37-1.48-.58-2.32-.58C2.23 5.34 0 7.57 0 10.32c0 2.54 1.9 4.63 4.36 4.94-1.06.91-1.72 2.26-1.72 3.77 0 2.75 2.23 4.98 4.98 4.98 2.05 0 3.81-1.24 4.57-3.01.76 1.77 2.52 3.01 4.57 3.01 2.75 0 4.98-2.23 4.98-4.98 0-1.5-.67-2.85-1.72-3.77 2.46-.3 4.36-2.4 4.36-4.94Z'
	},


	eightPetalFlower: {
		viewBox: 24,
		svg: 'M20.43 8.51c2.29-3.16.05-4.99.05-4.99s-1.82-2.24-4.99.05C14.87-.29 12 0 12 0s-2.87-.29-3.49 3.56c-3.16-2.29-4.99-.05-4.99-.05s-2.24 1.82.05 4.99C-.29 9.13 0 12 0 12s-.29 2.87 3.56 3.49c-2.29 3.16-.05 4.99-.05 4.99s1.82 2.24 4.99-.05C9.12 24.29 12 24 12 24s2.87.29 3.49-3.56c3.16 2.29 4.99.05 4.99.05s2.24-1.82-.05-4.99C24.29 14.87 24 12 24 12s.29-2.87-3.56-3.49Z'
	},
	spiral: {
		viewBox: 24,
		svg: 'M11.21 21.64c2.53-.06 4.84-1.07 6.27-3.23 1.81-2.59 1.86-6.59-.59-8.8-2.38-2.17-6.8-2.13-8.51.85-.91 1.52-1.02 3.72.25 5.08 1.09 1.2 3.03 1.64 4.39.64.84-.56 1.48-1.88.75-2.76-.26-.31-1.18-.82-1.35-.21-.27.82-1.29 1.21-1.99.65-1.21-1.02-.05-3 1.23-3.36 1.77-.57 3.87.46 4.62 2.14.28.62.32 1.32.3 1.98-.18 2.21-2.08 4.09-4.24 4.44-2.79.53-5.78-1.17-6.76-3.83-1.11-2.96.04-6.51 2.6-8.33 2.9-2.13 7.15-1.83 9.94.34 2.19 1.64 3.3 4.42 3.2 7.12-.14 3.09-1.72 6.11-4.27 7.89-2.31 1.66-5.35 2.05-8.1 1.53C4.23 22.84.61 18.68.11 13.93-.78 7.58 3.74 1.73 9.87.3c.25-.07.51-.11.76-.15.74-.14 1.6-.36 2.15.33.32.38.44.91.21 1.36-.44 1.07-1.73.75-2.63 1.09-1.59.38-3.08 1.13-4.32 2.21-2.25 1.89-3.56 4.82-3.49 7.75.14 4.88 3.74 8.63 8.66 8.75Z'
	},


	triangle: { viewBox: 24, svg: 'M12 2 L22 21 L2 21 Z' },
	diamond: { viewBox: 24, svg: 'M12 1 L22 12 L12 23 L2 12 Z' },
	pentagon: { viewBox: 24, svg: 'M12 2 L22 9.3 L18.2 21 L5.8 21 L2 9.3 Z' },
	hexagon: { viewBox: 24, svg: 'M6.5 2.5 L17.5 2.5 L23 12 L17.5 21.5 L6.5 21.5 L1 12 Z' },
	octagon: { viewBox: 24, svg: 'M7 1 L17 1 L23 7 L23 17 L17 23 L7 23 L1 17 L1 7 Z' },
	roundedRectangle: { viewBox: 24, svg: 'M6 2 H18 Q22 2 22 6 V18 Q22 22 18 22 H6 Q2 22 2 18 V6 Q2 2 6 2 Z' },
	sunburst: {
		viewBox: 24,
		svg: 'M12 0 L15.06 4.61 L20.49 3.51 L19.39 8.94 L24 12 L19.39 15.06 L20.49 20.49 L15.06 19.39 L12 24 L8.94 19.39 L3.51 20.49 L4.61 15.06 L0 12 L4.61 8.94 L3.51 3.51 L8.94 4.61 Z'
	},
	crescentMoon: {
		viewBox: 24,
		svg: 'M19.8 18.4 C17.7 20.7 14.8 22 11.6 22 C5.3 22 .2 16.9 .2 10.6 C.2 5.1 4.1 .4 9.4 0 C7 2.2 5.5 5.4 5.5 8.9 C5.5 15 10.5 20 16.6 20 C17.7 20 18.8 19.8 19.8 18.4 Z'
	},
	cloud: {
		viewBox: 24,
		svg: 'M5 20 C2.2 20 0 17.8 0 15 C0 12.4 2 10.2 4.6 10 C5.4 6.5 8.4 4 12 4 C16 4 19.2 7 19.5 10.8 C22.1 11.2 24 13.1 24 15.5 C24 18 22 20 19.5 20 Z'
	},
	lightningBolt: { viewBox: 24, svg: 'M14 1 L4 13 H10 L8 23 L20 9 H14 Z' },
	rightArrow: { viewBox: 24, svg: 'M2 8 H13 V3 L22 12 L13 21 V16 H2 Z' },
	fourLeafClover: {
		viewBox: 24,
		svg: 'M12 11 C10 7 7 3 4 4 C1 5 2 10 7 12 C2 14 1 19 4 20 C7 21 10 17 12 13 C14 17 17 21 20 20 C23 19 22 14 17 12 C22 10 23 5 20 4 C17 3 14 7 12 11 Z'
	},
	speechBubble: {
		viewBox: 24,
		svg: 'M5 3 H19 Q22 3 22 6 V14 Q22 17 19 17 H13 L8 22 L9 17 H5 Q2 17 2 14 V6 Q2 3 5 3 Z'
	}
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
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}">${inner}</svg>`;
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

// Catalogs derived from DEFS. Category metadata controls the Design gallery's
// section order; the compact Shape Properties picker remains a single grid.
ShapeLibrary.BRUSH_SHAPES = [
	{ id: 'round', label: 'Round' }, // round tip is a soft radial gradient, not a traced path (see MaskEditor._drawRoundStamp)
	{ id: 'square', label: 'Square' },
	{ id: 'calligraphy', label: 'Calligraphy', brushOnly: true },
	{ id: 'star', label: 'Star' },
	{ id: 'heart', label: 'Heart' }
];

ShapeLibrary.FILL_SHAPE_CATEGORIES = [
	{ id: 'basic', label: 'Basic Shapes' },
	{ id: 'decorative', label: 'Decorative Shapes' }
];

ShapeLibrary.FILL_SHAPES = [
	{ id: 'circle', label: 'Circle', category: 'basic' },
	{ id: 'square', label: 'Square', category: 'basic' },
	{ id: 'triangle', label: 'Triangle', category: 'basic' },
	{ id: 'diamond', label: 'Diamond', category: 'basic' },
	{ id: 'pentagon', label: 'Pentagon', category: 'basic' },
	{ id: 'hexagon', label: 'Hexagon', category: 'basic' },
	{ id: 'octagon', label: 'Octagon', category: 'basic' },
	{ id: 'roundedRectangle', label: 'Rounded Rectangle', category: 'basic' },
	{ id: 'star', label: 'Star', category: 'decorative' },
	{ id: 'puffyStar', label: 'Puffy Star', category: 'decorative' },
	{ id: 'roundedStar', label: 'Rounded Star', category: 'decorative' },
	{ id: 'sparkle', label: 'Sparkle', category: 'decorative' },
	{ id: 'sunburst', label: 'Sunburst', category: 'decorative' },
	{ id: 'heart', label: 'Heart', category: 'decorative' },
	{ id: 'rounderHeart', label: 'Rounder Heart', category: 'decorative' },
	{ id: 'fivePetalFlower', label: '5-Petal Flower', category: 'decorative' },
	{ id: 'eightPetalFlower', label: '8-Petal Flower', category: 'decorative' },
	{ id: 'spiral', label: 'Spiral', category: 'decorative' },
	{ id: 'crescentMoon', label: 'Crescent Moon', category: 'decorative' },
	{ id: 'cloud', label: 'Cloud', category: 'decorative' },
	{ id: 'lightningBolt', label: 'Lightning Bolt', category: 'decorative' },
	{ id: 'rightArrow', label: 'Right Arrow', category: 'decorative' },
	{ id: 'fourLeafClover', label: '4-Leaf Clover', category: 'decorative' },
	{ id: 'speechBubble', label: 'Speech Bubble', category: 'decorative' }
];
