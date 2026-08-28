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
// Definitions are loaded from data/shapes.json before the editor is created.
// Geometry, labels, categories, and picker availability live in that manifest;
// ShapeLibrary remains the synchronous renderer after boot.
//
// trace(id, ctx, halfW, halfH, {fit}) FILLS the shape centered on the current
// origin, scaled so its content bounds fit a box of half-width halfW / half-
// height halfH. `fit`: 'contain' (uniform, aspect-preserving — the brush) or
// 'fill' (stretch to the box — the Shape tool). Callers set fillStyle and any
// filter beforehand; trace does the fill.

const ShapeLibrary = {
	// id -> definition. `svg` is an SVG path `d` in a `viewBox`×`viewBox` box.
	DEFS: {},
	manifestPromise: null,

	async loadManifest() {
		if (this.manifestPromise) return this.manifestPromise;

		this.manifestPromise = (async () => {
			const response = await fetch(CONFIG.tools.shapes.manifest, { cache: 'no-store' });
			if (!response.ok) {
				throw new Error(`Failed to load shapes manifest (${response.status})`);
			}
			const manifest = await response.json();
			this.applyManifest(manifest);
			return manifest;
		})();

		try {
			return await this.manifestPromise;
		} catch (error) {
			this.manifestPromise = null;
			throw error;
		}
	},

	applyManifest(manifest) {
		if (!Array.isArray(manifest?.categories) || !Array.isArray(manifest?.shapes)) {
			throw new Error('Shapes manifest must contain categories and shapes arrays');
		}

		const categoryIds = new Set();
		manifest.categories.forEach((category) => {
			if (!/^[a-z][a-z0-9-]*$/.test(category?.id) || !category?.label || categoryIds.has(category.id)) {
				throw new Error('Shapes manifest contains an invalid or duplicate category');
			}
			categoryIds.add(category.id);
		});

		const ids = new Set();
		const shapeOrders = new Set();
		const brushOrders = new Set();
		const allowedPrimitives = new Set(['circle', 'square', 'calligraphy']);
		const defs = {};
		manifest.shapes.forEach((shape) => {
			if (!/^[a-z][A-Za-z0-9-]*$/.test(shape?.id) || !shape?.label || ids.has(shape.id)) {
				throw new Error('Shapes manifest contains an invalid or duplicate shape');
			}
			if (!Number.isFinite(shape.viewBox) || shape.viewBox <= 0) {
				throw new Error(`Shape "${shape.id}" needs a positive viewBox`);
			}
			if (!Array.isArray(shape.uses) || !shape.uses.length || shape.uses.some((use) => use !== 'shape' && use !== 'brush')) {
				throw new Error(`Shape "${shape.id}" needs shape or brush usage`);
			}
			if ((shape.primitive && !allowedPrimitives.has(shape.primitive)) || (!shape.primitive && !shape.svgPath)) {
				throw new Error(`Shape "${shape.id}" needs a primitive or SVG path`);
			}
			if (shape.sourceBounds && (
				!Array.isArray(shape.sourceBounds) ||
				shape.sourceBounds.length !== 4 ||
				shape.sourceBounds.some((value) => !Number.isFinite(value)) ||
				shape.sourceBounds[2] <= 0 ||
				shape.sourceBounds[3] <= 0
			)) {
				throw new Error(`Shape "${shape.id}" has invalid source bounds`);
			}
			if (shape.uses.includes('shape') && !categoryIds.has(shape.category)) {
				throw new Error(`Shape "${shape.id}" needs a valid category`);
			}
			if (shape.uses.includes('shape') && (!Number.isInteger(shape.shapeOrder) || shape.shapeOrder < 0 || shapeOrders.has(shape.shapeOrder))) {
				throw new Error(`Shape "${shape.id}" needs a unique non-negative shape order`);
			}
			if (shape.uses.includes('brush') && (!Number.isInteger(shape.brushOrder) || shape.brushOrder < 0 || brushOrders.has(shape.brushOrder))) {
				throw new Error(`Shape "${shape.id}" needs a unique non-negative brush order`);
			}
			ids.add(shape.id);
			if (shape.uses.includes('shape')) shapeOrders.add(shape.shapeOrder);
			if (shape.uses.includes('brush')) brushOrders.add(shape.brushOrder);
			defs[shape.id] = {
				viewBox: shape.viewBox,
				primitive: shape.primitive || null,
				svg: shape.svgPath || null,
				sourceBounds: shape.sourceBounds || null,
				// Sheet artwork is normalized into a square viewBox without
				// changing its proportions. Keep that invariant when a shape is
				// placed in a non-square layer frame.
				preserveAspect: Boolean(shape.sourceBounds)
			};
		});
		if (!defs.circle || !defs[CONFIG.tools.shapes.defaultShapeId]) {
			throw new Error('Shapes manifest is missing a required default shape');
		}

		this.DEFS = defs;
		const categories = manifest.categories.map((category) => ({ ...category }));
		const fillShapes = manifest.shapes
			.filter((shape) => shape.uses.includes('shape'))
			.sort((a, b) => a.shapeOrder - b.shapeOrder)
			.map(({ id, label, category }) => ({ id, label, category }));
		const brushShapes = manifest.shapes
			.filter((shape) => shape.uses.includes('brush'))
			.sort((a, b) => a.brushOrder - b.brushOrder)
			.map(({ id, label }) => ({ id, label }));
		this.FILL_SHAPE_CATEGORIES.splice(0, this.FILL_SHAPE_CATEGORIES.length, ...categories);
		this.FILL_SHAPES.splice(0, this.FILL_SHAPES.length, ...fillShapes);
		this.BRUSH_SHAPES.splice(0, this.BRUSH_SHAPES.length, ...brushShapes);
	},

	// Build (once) the Path2D and its rasterized content bounds for a shape.
	// Bounds are found by scanning alpha, so fitting is accurate for ANY path —
	// including user-supplied SVGs — with no hand-measured numbers.
	_geometry(id) {
		const def = this.DEFS[id] || this.DEFS.circle;
		if (def._geom) return def._geom;
		const path = this._buildPath(def);
		const bounds = def.sourceBounds
			? this._getNormalizedSourceBounds(def)
			: this._computeBounds(path, def.viewBox || 24);
		def._geom = { path, bounds };
		return def._geom;
	},

	_buildPath(def) {
		if (def.svg) {
			const sourcePath = new Path2D(def.svg);
			if (!def.sourceBounds) return sourcePath;
			const path = new Path2D();
			path.addPath(sourcePath, this._getSourceTransform(def));
			return path;
		}
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

	_getSourceTransform(def) {
		const [x, y, width, height] = def.sourceBounds;
		const viewBox = def.viewBox || 24;
		const padding = viewBox / 24;
		const available = viewBox - (padding * 2);
		const scale = Math.min(available / width, available / height);
		const offsetX = padding + ((available - (width * scale)) / 2);
		const offsetY = padding + ((available - (height * scale)) / 2);
		return new DOMMatrix([
			scale,
			0,
			0,
			scale,
			offsetX - (x * scale),
			offsetY - (y * scale)
		]);
	},

	_getNormalizedSourceBounds(def) {
		const [x, y, width, height] = def.sourceBounds;
		const matrix = this._getSourceTransform(def);
		return {
			minX: (x * matrix.a) + matrix.e,
			minY: (y * matrix.d) + matrix.f,
			maxX: ((x + width) * matrix.a) + matrix.e,
			maxY: ((y + height) * matrix.d) + matrix.f
		};
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
		const def = this.DEFS[id] || this.DEFS.circle;
		const geom = this._geometry(id);
		const bw = (geom.bounds.maxX - geom.bounds.minX) || 1;
		const bh = (geom.bounds.maxY - geom.bounds.minY) || 1;
		const cx = (geom.bounds.minX + geom.bounds.maxX) / 2;
		const cy = (geom.bounds.minY + geom.bounds.maxY) / 2;

		let sx = (2 * halfW) / bw;
		let sy = (2 * halfH) / bh;
		if (def.preserveAspect || (options.fit || 'contain') === 'contain') {
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

	// The shape's drawable element(s) in its native `viewBox`-unit space — a
	// <path> (with the sheet-normalize matrix when the def carries sourceBounds),
	// or a primitive rect/ellipse/circle. Shared by getIconSvg / getContentSvg.
	_shapeInnerSvg(def) {
		const vb = def.viewBox || 24;
		if (def.svg) {
			if (def.sourceBounds) {
				const m = this._getSourceTransform(def);
				return `<path d="${def.svg}" transform="matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})"/>`;
			}
			return `<path d="${def.svg}"/>`;
		}
		if (def.primitive === 'square') {
			return `<rect x="0" y="0" width="${vb}" height="${vb}"/>`;
		}
		if (def.primitive === 'calligraphy') {
			return `<ellipse cx="${vb / 2}" cy="${vb / 2}" rx="${vb / 2}" ry="${vb * 0.16}" transform="rotate(-45 ${vb / 2} ${vb / 2})"/>`;
		}
		return `<circle cx="${vb / 2}" cy="${vb / 2}" r="${vb / 2}"/>`;
	},

	// Full <svg> markup for a picker thumbnail — same geometry as trace(), so the
	// thumbnail matches the stamped/filled result. fill:currentColor is theme-aware.
	// The explicit width/height attributes match the viewBox so WebKit computes a
	// 1:1 intrinsic aspect ratio: without them Safari falls back to the 300x150
	// replaced-element default and the artwork renders off-centre in its (square)
	// CSS box. CSS width/height still override the rendered size.
	getIconSvg(id) {
		const def = this.DEFS[id] || this.DEFS.circle;
		const vb = def.viewBox || 24;
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${vb}" height="${vb}" viewBox="0 0 ${vb} ${vb}">${this._shapeInnerSvg(def)}</svg>`;
	},

	// Like getIconSvg, but the viewBox is tightened to the shape's rasterized
	// content bounds — no design-box padding, and centred on the content, not the
	// box. Scaling this into a square viewport (default preserveAspectRatio =
	// contain + centre) reproduces exactly what trace() / the brush stamp does
	// with fit:'contain', so the brush cursor outline matches the stamp for
	// off-centre or non-square tips (heart, calligraphy).
	getContentSvg(id) {
		const def = this.DEFS[id] || this.DEFS.circle;
		const { minX, minY, maxX, maxY } = this._geometry(id).bounds;
		const bw = (maxX - minX) || 1;
		const bh = (maxY - minY) || 1;
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" viewBox="${minX} ${minY} ${bw} ${bh}">${this._shapeInnerSvg(def)}</svg>`;
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

ShapeLibrary.BRUSH_SHAPES = [];
ShapeLibrary.FILL_SHAPE_CATEGORIES = [];
ShapeLibrary.FILL_SHAPES = [];
