// ============================================
// AREA CHROME
// The marching ants around the Select Area region.
// ============================================
// One canvas in the screen-space SelectionOverlay, redrawn by one syncer. The
// area is rasterized straight into screen pixels, so the outline is the true
// edge of the combined shapes (added, subtracted, inverted) and stays one
// pixel wide at any zoom. The moving dashes are a stripe pattern shown only
// through that outline. It takes no pointer events.
class AreaChrome {
	constructor(editor) {
		this.editor = editor;
		this.canvas = null;
		// A shape being dragged out, previewed with the area before it commits.
		this.draft = null;
		this.fill = createAppCanvas(0, 0, 'transforms/area-chrome');
		this.outline = createAppCanvas(0, 0, 'transforms/area-chrome');
		this.pattern = null;
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
		const ratio = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(overlay.element.clientWidth * ratio));
		const height = Math.max(1, Math.round(overlay.element.clientHeight * ratio));
		[this.canvas, this.fill, this.outline].forEach((canvas) => ensureCanvasSize(canvas, width, height));

		const area = this.editor.areaSelection;
		const view = overlay.getMapping();
		const toDevice = (point) => {
			const screen = overlay.toScreen(point, view);
			return { x: Math.round(screen.x * ratio), y: Math.round(screen.y * ratio) };
		};
		const ops = !this.draft ? area.ops : this.draft.mode === 'new' ? [{ op: 'add', points: this.draft.points }]
			: [...area.ops, { op: this.draft.mode === 'subtract' ? 'subtract' : 'add', points: this.draft.points }];
		const fillCtx = this.fill.getContext('2d');
		resetCanvasContext(fillCtx, width, height, false);
		fillCtx.fillStyle = '#000';
		area.trace(fillCtx, toDevice, ops);

		// The outline is the ring one device pixel outside the filled area.
		const outlineCtx = this.outline.getContext('2d');
		resetCanvasContext(outlineCtx, width, height, false);
		[[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([x, y]) => outlineCtx.drawImage(this.fill, x, y));
		outlineCtx.globalCompositeOperation = 'destination-out';
		outlineCtx.drawImage(this.fill, 0, 0);
		this.paint();
	}

	march() {
		this.phase = (this.phase + 1) % CONFIG.tools.area.antsStripe;
		this.paint();
	}

	paint() {
		if (!this.canvas) return;
		const ctx = this.canvas.getContext('2d');
		const { width, height } = this.canvas;
		resetCanvasContext(ctx, width, height, false);
		ctx.drawImage(this.outline, 0, 0);
		ctx.globalCompositeOperation = 'source-in';
		ctx.fillStyle = this.getPattern(ctx);
		ctx.translate(this.phase, 0);
		ctx.fillRect(-this.phase, 0, width + this.phase, height);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
	}

	// Diagonal black and white stripes: through a one-pixel outline they read
	// as dashes on any background, on edges of every direction.
	getPattern(ctx) {
		if (this.pattern) return this.pattern;
		const size = CONFIG.tools.area.antsStripe;
		const tile = createAppCanvas(size, size, 'transforms/area-chrome');
		const tileCtx = tile.getContext('2d');
		for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
			tileCtx.fillStyle = (x + y) % size < size / 2 ? '#000' : '#fff';
			tileCtx.fillRect(x, y, 1, 1);
		}
		this.pattern = ctx.createPattern(tile, 'repeat');
		return this.pattern;
	}
}
