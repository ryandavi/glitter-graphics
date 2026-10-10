// ============================================
// AREA CHROME
// The marching ants around the Select Area region.
// ============================================
// One canvas in the screen-space SelectionOverlay, redrawn by one syncer. The
// area is rasterized straight into screen pixels, so the outline is the true
// edge of the combined shapes (added, subtracted, inverted) and stays one CSS
// pixel wide at any zoom. The dashes are stroked along every shape and shown
// only through that outline, so they travel around the area at any angle.
// The document outside the area is dimmed. It takes no pointer events.
class AreaChrome {
	constructor(editor) {
		this.editor = editor;
		this.canvas = null;
		// A shape being dragged out, previewed with the area before it commits.
		this.draft = null;
		this.fill = createAppCanvas(0, 0, 'transforms/area-chrome');
		this.outline = createAppCanvas(0, 0, 'transforms/area-chrome');
		this.ants = createAppCanvas(0, 0, 'transforms/area-chrome');
		// Each shape's outline in device px, and the document's own.
		this.paths = [];
		this.documentPath = [];
		this.ratio = 1;
		this.phase = 0;
		this.timer = null;
		this.syncer = () => this.draw();
	}

	get overlay() {
		return this.editor.viewport.selectionOverlay;
	}

	setDraft(draft) {
		this.draft = draft;
		this.render();
	}

	// Shows, redraws or removes the chrome to match the area and the draft.
	render() {
		const visible = !this.editor.areaSelection.isEmpty || Boolean(this.draft);
		if (!visible) return this.hide();
		// A document reset empties the overlay and its syncers.
		if (!this.canvas?.isConnected) {
			this.canvas = document.createElement('canvas');
			this.canvas.className = 'area-chrome';
			this.canvas.setAttribute('aria-hidden', 'true');
			this.overlay.append(this.canvas);
			this.overlay.addSyncer(this.syncer);
		}
		this.draw();
		if (!this.timer && !PREFERENCES.get('reduceMotion')) {
			this.timer = setInterval(() => this.march(), CONFIG.tools.area.antsStepMs);
		}
	}

	hide() {
		clearInterval(this.timer);
		this.timer = null;
		if (!this.canvas) return;
		this.overlay.removeSyncer(this.syncer);
		this.canvas.remove();
		this.canvas = null;
	}

	draw() {
		if (!this.canvas?.isConnected) return;
		const overlay = this.overlay;
		const ratio = this.ratio = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(overlay.element.clientWidth * ratio));
		const height = Math.max(1, Math.round(overlay.element.clientHeight * ratio));
		[this.canvas, this.fill, this.outline, this.ants].forEach((canvas) => ensureCanvasSize(canvas, width, height));

		const area = this.editor.areaSelection;
		const view = overlay.getMapping();
		const toDevice = (point) => {
			const screen = overlay.toScreen(point, view);
			return { x: Math.round(screen.x * ratio), y: Math.round(screen.y * ratio) };
		};
		const ops = this.draft ? area.combine(this.draft.points, this.draft.mode) : area.ops;
		const fillCtx = this.fill.getContext('2d');
		resetCanvasContext(fillCtx, width, height, false);
		fillCtx.fillStyle = '#000';
		area.trace(fillCtx, toDevice, ops);

		const size = area.getDocumentSize();
		this.documentPath = [{ x: 0, y: 0 }, { x: size.width, y: 0 }, { x: size.width, y: size.height }, { x: 0, y: size.height }].map(toDevice);
		this.paths = ops.map((entry) => (entry.points ? entry.points.map(toDevice) : this.documentPath));

		// The outline is the ring one CSS pixel outside the filled area.
		const outlineCtx = this.outline.getContext('2d');
		resetCanvasContext(outlineCtx, width, height, false);
		for (let step = 1; step <= this.getLineWidth(); step++) {
			[[step, 0], [-step, 0], [0, step], [0, -step]].forEach(([x, y]) => outlineCtx.drawImage(this.fill, x, y));
		}
		outlineCtx.globalCompositeOperation = 'destination-out';
		outlineCtx.drawImage(this.fill, 0, 0);
		this.paint();
	}

	getLineWidth() {
		return Math.max(1, Math.round(this.ratio));
	}

	march() {
		this.phase = (this.phase + 1) % (CONFIG.tools.area.antsDash * 2);
		this.paint();
	}

	tracePath(ctx, points) {
		ctx.beginPath();
		points.forEach((point, index) => { if (index) ctx.lineTo(point.x, point.y); else ctx.moveTo(point.x, point.y); });
		ctx.closePath();
	}

	paint() {
		if (!this.canvas) return;
		const { width, height } = this.canvas;
		const dash = CONFIG.tools.area.antsDash * this.ratio;

		// White under black dashes along every shape, kept only on the outline.
		const antsCtx = this.ants.getContext('2d');
		resetCanvasContext(antsCtx, width, height, false);
		// Wide enough to cover the ring, which sits just outside each edge.
		antsCtx.lineWidth = this.getLineWidth() * 2 + 2;
		this.paths.forEach((points) => {
			this.tracePath(antsCtx, points);
			antsCtx.setLineDash([]);
			antsCtx.strokeStyle = '#fff';
			antsCtx.stroke();
			antsCtx.setLineDash([dash, dash]);
			antsCtx.lineDashOffset = -this.phase * this.ratio;
			antsCtx.strokeStyle = '#000';
			antsCtx.stroke();
		});
		antsCtx.setLineDash([]);
		antsCtx.globalCompositeOperation = 'destination-in';
		antsCtx.drawImage(this.outline, 0, 0);

		const ctx = this.canvas.getContext('2d');
		resetCanvasContext(ctx, width, height, false);
		ctx.fillStyle = `rgba(0, 0, 0, ${CONFIG.tools.area.outsideDim})`;
		this.tracePath(ctx, this.documentPath);
		ctx.fill();
		ctx.globalCompositeOperation = 'destination-out';
		ctx.drawImage(this.fill, 0, 0);
		ctx.globalCompositeOperation = 'source-over';
		ctx.drawImage(this.ants, 0, 0);
	}
}
