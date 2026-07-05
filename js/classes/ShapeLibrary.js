// ============================================
// SHAPE LIBRARY
// ============================================
// Single source of truth for all vector shape geometry and their gallery icons
// (WP5a, docs/TOOL-EXPANSION-PLAN.md). Both the Mask Brush tip picker and the
// Shape tool consume this — adding a new shape or brush tip is one entry here.
//
// - trace(id, ctx, halfW, halfH, options): traces a shape centered on the
//   current path origin into a box of half-width halfW and half-height halfH.
//   The brush calls it with halfW === halfH (a uniform stamp radius); the Shape
//   tool passes independent half-extents for a rectangular bounding box.
// - BRUSH_SHAPES / FILL_SHAPES: catalogs (id, label, icon) for the two pickers,
//   using the same gallery-card conventions as the font/sticker pickers. `icon`
//   is inline SVG markup drawn with fill: currentColor (theme-aware) in a
//   0 0 24 24 viewBox.
//
// Note: brush tip id 'round' and fill shape id 'circle' are the same geometry
// (an ellipse) — kept as distinct ids so the brush's existing stored settings
// and CONFIG.maskBrush.defaultShape ('round') stay valid.

const SHAPE_ICONS = {
	circle: '<circle cx="12" cy="12" r="9"/>',
	square: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/>',
	calligraphy: '<ellipse cx="12" cy="12" rx="10" ry="3.4" transform="rotate(-45 12 12)"/>',
	star: '<path d="M12 2 L14.7 8.6 L21.8 9.2 L16.4 13.8 L18.1 20.8 L12 17 L5.9 20.8 L7.6 13.8 L2.2 9.2 L9.3 8.6 Z"/>',
	heart: '<path d="M12 21 C12 21 3 14.6 3 8.8 C3 5.6 5.4 3.5 8 3.5 C10 3.5 11.4 4.8 12 6 C12.6 4.8 14 3.5 16 3.5 C18.6 3.5 21 5.6 21 8.8 C21 14.6 12 21 12 21 Z"/>'
};

const ShapeLibrary = {
	// Trace a shape's outline path centered on the current origin. Call
	// ctx.beginPath() before and ctx.fill()/clip() after — this only adds to the
	// path. `options.fit` controls how point-list shapes (star, heart) map into a
	// non-square box: 'contain' (default) preserves aspect ratio and fits inside;
	// 'fill' stretches to fill the box independently on each axis.
	trace(id, ctx, halfW, halfH, options = {}) {
		switch (id) {
			case 'round':
			case 'circle':
				ctx.ellipse(0, 0, halfW, halfH, 0, 0, Math.PI * 2);
				return;
			case 'square':
				ctx.rect(-halfW, -halfH, halfW * 2, halfH * 2);
				return;
			case 'calligraphy':
				// A flat nib at a fixed 45°: a thin ellipse rotated up-left → down-right.
				ctx.ellipse(0, 0, halfW, halfH * 0.32, -Math.PI / 4, 0, Math.PI * 2);
				return;
			case 'star':
				this._traceFitted(ctx, this._starPoints(), halfW, halfH, options.fit);
				return;
			case 'heart':
				this._traceFitted(ctx, this._heartPoints(), halfW, halfH, options.fit);
				return;
			default:
				ctx.ellipse(0, 0, halfW, halfH, 0, 0, Math.PI * 2);
		}
	},

	_starPoints() {
		const points = [];
		const spikes = 5;
		const innerRatio = 0.42;
		for (let i = 0; i < spikes * 2; i++) {
			const mag = (i % 2 === 0) ? 1 : innerRatio;
			const angle = (Math.PI / spikes) * i - Math.PI / 2;
			points.push([Math.cos(angle) * mag, Math.sin(angle) * mag]);
		}
		return points;
	},

	_heartPoints() {
		const points = [];
		const steps = 48;
		for (let i = 0; i < steps; i++) {
			const t = (i / steps) * Math.PI * 2;
			const x = 16 * Math.pow(Math.sin(t), 3);
			const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
			points.push([x, y]);
		}
		return points;
	},

	// Normalize a point list to be centered, then scale it into the half-extent
	// box. 'contain' uses a single uniform scale (min of the two axes) so the
	// shape keeps its aspect ratio — this reproduces the brush's original
	// aspect-preserving fit exactly when halfW === halfH.
	_traceFitted(ctx, points, halfW, halfH, fit = 'contain') {
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (const [x, y] of points) {
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;
		const halfPx = (maxX - minX) / 2 || 1;
		const halfPy = (maxY - minY) / 2 || 1;

		let scaleX;
		let scaleY;
		if (fit === 'fill') {
			scaleX = halfW / halfPx;
			scaleY = halfH / halfPy;
		} else {
			scaleX = scaleY = Math.min(halfW / halfPx, halfH / halfPy);
		}

		points.forEach(([x, y], index) => {
			const px = (x - centerX) * scaleX;
			const py = (y - centerY) * scaleY;
			if (index === 0) {
				ctx.moveTo(px, py);
			} else {
				ctx.lineTo(px, py);
			}
		});
		ctx.closePath();
	},

	isFillShape(id) {
		return this.FILL_SHAPES.some((shape) => shape.id === id);
	},

	isBrushShape(id) {
		return this.BRUSH_SHAPES.some((shape) => shape.id === id);
	}
};

// Brush tip catalog (gallery order). 'round' uses the circle icon/geometry.
// calligraphy is brushOnly — a directional nib that isn't a meaningful fill shape.
ShapeLibrary.BRUSH_SHAPES = [
	{ id: 'round', label: 'Round', icon: SHAPE_ICONS.circle },
	{ id: 'square', label: 'Square', icon: SHAPE_ICONS.square },
	{ id: 'calligraphy', label: 'Calligraphy', icon: SHAPE_ICONS.calligraphy, brushOnly: true },
	{ id: 'star', label: 'Star', icon: SHAPE_ICONS.star },
	{ id: 'heart', label: 'Heart', icon: SHAPE_ICONS.heart }
];

// Fill shape catalog for the Shape tool. Same icons, no calligraphy.
ShapeLibrary.FILL_SHAPES = [
	{ id: 'circle', label: 'Circle', icon: SHAPE_ICONS.circle },
	{ id: 'square', label: 'Square', icon: SHAPE_ICONS.square },
	{ id: 'star', label: 'Star', icon: SHAPE_ICONS.star },
	{ id: 'heart', label: 'Heart', icon: SHAPE_ICONS.heart }
];
