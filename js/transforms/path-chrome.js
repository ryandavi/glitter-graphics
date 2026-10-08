// ============================================
// PATH CHROME
// The point editor's on-canvas chrome: outline, anchors, handles, tangent
// lines, the next-segment preview and the point marquee.
// ============================================
// One SVG in the screen-space SelectionOverlay, redrawn by one syncer, so
// every size is a plain CSS pixel at any zoom. It takes no pointer events: the
// edit session (js/ui/path-edit.js) hit-tests through hitTest, which reads the
// same screen numbers the last draw placed, so what is drawn and what is hit
// cannot disagree.
//
// The model it draws ({ subpaths, selection, drawEnd, preview, hover,
// closeTarget, marquee }) is in canvas px; `selection`, `hover` and
// `closeTarget` name points by "subpath:point" keys.
class PathChrome {
	constructor(editor) {
		this.editor = editor;
		this.svg = null;
		this.model = null;
		// Screen positions of the last draw, for hit-testing.
		this.screen = { anchors: [], handles: [], view: null };
		this.syncer = () => this.draw();
	}

	get overlay() {
		return this.editor.viewport.selectionOverlay;
	}

	show() {
		if (this.svg) return;
		this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		this.svg.setAttribute('class', 'path-chrome');
		this.svg.setAttribute('aria-hidden', 'true');
		this.overlay.append(this.svg);
		this.overlay.addSyncer(this.syncer);
	}

	hide() {
		if (!this.svg) return;
		this.overlay.removeSyncer(this.syncer);
		this.svg.remove();
		this.svg = null;
		this.model = null;
		this.screen = { anchors: [], handles: [], view: null };
	}

	setModel(model) {
		this.model = model;
		this.draw();
	}

	static isCoarse(pointerType) {
		if (pointerType) return pointerType === 'touch';
		return Boolean(window.matchMedia?.('(pointer: coarse)').matches);
	}

	// Handles show for selected points and for their neighbours' facing
	// handles, so a selected segment end can be shaped from both sides.
	getVisibleHandles(model) {
		const visible = new Set();
		model.selection.forEach((key) => {
			const [s, p] = key.split(':').map(Number);
			const subpath = model.subpaths[s];
			if (!subpath?.points[p]) return;
			const count = subpath.points.length;
			visible.add(`${s}:${p}:in`);
			visible.add(`${s}:${p}:out`);
			const previous = subpath.closed ? (p - 1 + count) % count : p - 1;
			const next = subpath.closed ? (p + 1) % count : p + 1;
			if (subpath.points[previous] && previous !== p) visible.add(`${s}:${previous}:out`);
			if (subpath.points[next] && next !== p) visible.add(`${s}:${next}:in`);
		});
		return visible;
	}

	draw() {
		if (!this.svg || !this.model) return;
		const model = this.model;
		const config = CONFIG.tools.path.chrome;
		const overlay = this.overlay;
		const view = overlay.getMapping();
		const toScreen = (point) => overlay.toScreen(point, view);
		const number = (value) => Math.round(value * 100) / 100;
		const parts = [];
		const anchors = [];
		const handles = [];

		// Outline: the geometry itself, traced in screen px.
		const outline = [];
		const pen = {
			moveTo: (x, y) => { const p = toScreen({ x, y }); outline.push(`M${number(p.x)} ${number(p.y)}`); },
			lineTo: (x, y) => { const p = toScreen({ x, y }); outline.push(`L${number(p.x)} ${number(p.y)}`); },
			bezierCurveTo: (x1, y1, x2, y2, x, y) => {
				const a = toScreen({ x: x1, y: y1 });
				const b = toScreen({ x: x2, y: y2 });
				const p = toScreen({ x, y });
				outline.push(`C${number(a.x)} ${number(a.y)} ${number(b.x)} ${number(b.y)} ${number(p.x)} ${number(p.y)}`);
			},
			closePath: () => outline.push('Z')
		};
		PathGeometry.trace(pen, model.subpaths);
		if (outline.length) {
			const d = outline.join(' ');
			parts.push(`<path class="path-chrome-outline-halo" d="${d}"/><path class="path-chrome-outline" d="${d}"/>`);
		}

		if (model.preview) {
			const from = toScreen(model.preview.from);
			const c1 = toScreen(model.preview.control || model.preview.from);
			const to = toScreen(model.preview.to);
			parts.push(`<path class="path-chrome-preview" d="M${number(from.x)} ${number(from.y)} C${number(c1.x)} ${number(c1.y)} ${number(to.x)} ${number(to.y)} ${number(to.x)} ${number(to.y)}"/>`);
		}

		const visibleHandles = this.getVisibleHandles(model);
		const handleRadius = config.handleSize / 2;
		const anchorHalf = config.anchorSize / 2;
		const anchorParts = [];
		model.subpaths.forEach((subpath, s) => {
			subpath.points.forEach((point, p) => {
				const at = toScreen(point);
				const key = `${s}:${p}`;
				['in', 'out'].forEach((side) => {
					const handle = point[side];
					if (!handle || !visibleHandles.has(`${key}:${side}`)) return;
					const tip = toScreen({ x: point.x + handle.x, y: point.y + handle.y });
					handles.push({ subpath: s, point: p, side, x: tip.x, y: tip.y });
					const hovered = model.hover?.kind === 'handle' && model.hover.subpath === s && model.hover.point === p && model.hover.side === side;
					parts.push(`<line class="path-chrome-tangent" x1="${number(at.x)}" y1="${number(at.y)}" x2="${number(tip.x)}" y2="${number(tip.y)}"/>`);
					parts.push(`<circle class="path-chrome-handle${hovered ? ' is-hover' : ''}" cx="${number(tip.x)}" cy="${number(tip.y)}" r="${handleRadius}"/>`);
				});
				anchors.push({ subpath: s, point: p, x: at.x, y: at.y });
				const classes = ['path-chrome-anchor'];
				if (model.selection.has(key)) classes.push('is-selected');
				if (model.closeTarget === key) classes.push('is-close-target');
				if (model.hover?.kind === 'anchor' && model.hover.subpath === s && model.hover.point === p) classes.push('is-hover');
				if (model.drawEnd && model.drawEnd.subpath === s && p === (model.drawEnd.atStart ? 0 : subpath.points.length - 1)) classes.push('is-draw-end');
				// Corners are squares; points with handles are round.
				const round = point.in || point.out ? anchorHalf : 0;
				const x = SelectionOverlay.snap(at.x - anchorHalf);
				const y = SelectionOverlay.snap(at.y - anchorHalf);
				anchorParts.push(`<rect class="${classes.join(' ')}" x="${x}" y="${y}" width="${config.anchorSize}" height="${config.anchorSize}" rx="${round}"/>`);
			});
		});
		parts.push(...anchorParts);

		if (model.marquee) {
			const a = toScreen({ x: model.marquee.left, y: model.marquee.top });
			const b = toScreen({ x: model.marquee.right, y: model.marquee.bottom });
			parts.push(`<rect class="path-chrome-marquee" x="${number(a.x)}" y="${number(a.y)}" width="${number(b.x - a.x)}" height="${number(b.y - a.y)}"/>`);
		}

		this.svg.innerHTML = parts.join('');
		this.screen = { anchors, handles, view };
	}

	// Screen px from a client point to a drawn anchor (Infinity when it is not
	// on screen).
	distanceToAnchor(clientX, clientY, subpath, point) {
		if (!this.svg) return Infinity;
		const anchor = this.screen.anchors.find((entry) => entry.subpath === subpath && entry.point === point);
		if (!anchor) return Infinity;
		const rect = this.overlay.element.getBoundingClientRect();
		return Math.hypot(anchor.x - (clientX - rect.left), anchor.y - (clientY - rect.top));
	}

	// What a press at a client point takes hold of: an anchor, a visible
	// handle, or a segment ({ kind, subpath, point | segment, side?, t? }), or
	// null for empty canvas. Anchors win over handles, handles over segments.
	hitTest(clientX, clientY, pointerType) {
		if (!this.svg || !this.model) return null;
		const config = CONFIG.tools.path.chrome;
		const coarse = PathChrome.isCoarse(pointerType);
		const radius = coarse ? config.hitRadiusCoarse : config.hitRadius;
		const rect = this.overlay.element.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		const nearest = (items) => {
			let best = null;
			items.forEach((item) => {
				const distance = Math.hypot(item.x - x, item.y - y);
				if (distance <= radius && (!best || distance < best.distance)) best = { ...item, distance };
			});
			return best;
		};
		const anchor = nearest(this.screen.anchors);
		if (anchor) return { kind: 'anchor', subpath: anchor.subpath, point: anchor.point };
		const handle = nearest(this.screen.handles);
		if (handle) return { kind: 'handle', subpath: handle.subpath, point: handle.point, side: handle.side };
		const view = this.screen.view || this.overlay.getMapping();
		const canvasPoint = { x: (x - view.originX) / view.zoom, y: (y - view.originY) / view.zoom };
		const segment = PathGeometry.nearestPoint(this.model.subpaths, canvasPoint);
		const segmentRadius = coarse ? config.segmentHitRadiusCoarse : config.segmentHitRadius;
		if (segment && segment.distance * view.zoom <= segmentRadius) {
			return { kind: 'segment', subpath: segment.subpath, segment: segment.segment, t: segment.t };
		}
		return null;
	}
}
