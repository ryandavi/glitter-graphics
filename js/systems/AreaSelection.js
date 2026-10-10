'use strict';

// ============================================
// AREA SELECTION
// The region drawn with the Select Area tool: where Fill and Erase act, and
// the only place the Glitter Brush and Eraser change pixels while it exists.
// ============================================
// The area is a list of operations in document px, applied in order:
// { op: 'add' | 'subtract', points } closes a polygon (a rectangle is four
// points, an ellipse a many-sided polygon, a lasso its own trace), and
// { op: 'invert' } flips everything inside the document. Points make a canvas
// resize, crop or document scale a plain point transform.
//
// It is working state, like the tool's own options: not in undo history and
// not in the project file. Fill and Erase are ordinary paint commits.
//
// Masks rasterize the operations into a target space and binarize them, so
// clipping a stroke is exact and can be repeated without eroding its edge.
class AreaSelection {
	constructor(editor) {
		this.editor = editor;
		this.ops = [];
		this.revision = 0;
		this.masks = new Map();
		this.scratch = createAppCanvas(0, 0, 'systems/AreaSelection');
	}

	get isEmpty() {
		return this.ops.length === 0;
	}

	// mode: 'new' replaces the area, 'add' and 'subtract' combine with it.
	apply(points, mode = 'new') {
		if (points.length < 3) return;
		if (mode === 'subtract' && this.isEmpty) return;
		if (mode === 'new') this.ops = [];
		this.ops.push({ op: mode === 'subtract' ? 'subtract' : 'add', points });
		this.changed();
	}

	invert() {
		if (this.isEmpty) return;
		if (this.ops[this.ops.length - 1].op === 'invert') this.ops.pop();
		else this.ops.push({ op: 'invert' });
		this.changed();
	}

	clear() {
		if (this.isEmpty) return;
		this.ops = [];
		this.changed();
	}

	// Canvas resize, crop and document scale move the document under the area.
	transformPoints(map) {
		if (this.isEmpty) return;
		this.ops.forEach((entry) => { if (entry.points) entry.points = entry.points.map(map); });
		this.changed();
	}

	changed() {
		this.revision++;
		this.masks.clear();
		this.editor.areaSelect?.onAreaChanged();
	}

	getDocumentSize() {
		return { width: this.editor.originalCanvas.width, height: this.editor.originalCanvas.height };
	}

	// Fills the area into `ctx`. `mapPoint` takes a document point into the
	// target space; an inversion flips the document's own outline there.
	trace(ctx, mapPoint, ops = this.ops) {
		const { width, height } = this.getDocumentSize();
		const documentOutline = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
		ctx.save();
		ops.forEach(({ op, points = documentOutline }) => {
			ctx.globalCompositeOperation = op === 'add' ? 'source-over' : op === 'subtract' ? 'destination-out' : 'xor';
			ctx.beginPath();
			points.forEach((point, index) => {
				const mapped = mapPoint(point);
				if (index) ctx.lineTo(mapped.x, mapped.y); else ctx.moveTo(mapped.x, mapped.y);
			});
			ctx.closePath();
			ctx.fill();
		});
		ctx.restore();
	}

	// A binarized, document-sized mask of the area in one target space, kept
	// until the area changes. Two spaces at most are live: the document and
	// the fill layer being painted.
	_getMask(key, mapPoint) {
		let mask = this.masks.get(key);
		if (mask) return mask;
		if (this.masks.size >= 2) this.masks.delete(this.masks.keys().next().value);
		const { width, height } = this.getDocumentSize();
		mask = createAppCanvas(width, height, 'systems/AreaSelection');
		const ctx = mask.getContext('2d', { willReadFrequently: true });
		ctx.fillStyle = '#fff';
		this.trace(ctx, mapPoint);
		binarizeCanvasAlpha(ctx, width, height);
		this.masks.set(key, mask);
		return mask;
	}

	getDocumentMask() {
		return this._getMask('document', (point) => point);
	}

	// The area on a fill layer's paint surface, which the layer transform
	// places on the document.
	getLayerMask(layer) {
		return this._getMask(`${layer.id}:${JSON.stringify(layer.transform)}`, (point) => this.editor.glitterManager.getMaskLocalPoint(layer, point));
	}

	contains(point) {
		const { width, height } = this.getDocumentSize();
		const x = Math.floor(point.x);
		const y = Math.floor(point.y);
		if (this.isEmpty || x < 0 || y < 0 || x >= width || y >= height) return false;
		return this.getDocumentMask().getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data[3] > 0;
	}

	// A document point inside the area's drawn shapes, for resolving which
	// fill layer an action lands on.
	getAnchorPoint() {
		const points = this.ops.flatMap((entry) => (entry.op === 'add' ? entry.points : []));
		const { width, height } = this.getDocumentSize();
		if (!points.length) return { x: Math.floor(width / 2), y: Math.floor(height / 2) };
		const clamp = (value, max) => Math.max(0, Math.min(max - 1, Math.round(value)));
		return {
			x: clamp(points.reduce((sum, point) => sum + point.x, 0) / points.length, width),
			y: clamp(points.reduce((sum, point) => sum + point.y, 0) / points.length, height)
		};
	}

	// Limits a brush stroke to the area: each paint canvas keeps what the
	// stroke painted inside it, and takes back `before` (the canvas as the
	// stroke began) everywhere else.
	clipPaint(layer, paint, before) {
		if (this.isEmpty) return;
		const mask = this.getLayerMask(layer);
		const { width, height } = mask;
		ensureCanvasSize(this.scratch, width, height);
		const scratchCtx = this.scratch.getContext('2d', { willReadFrequently: true });
		[['add', before.add], ['sub', before.sub]].forEach(([name, original]) => {
			resetCanvasContext(scratchCtx, width, height);
			scratchCtx.drawImage(original, 0, 0);
			scratchCtx.globalCompositeOperation = 'destination-out';
			scratchCtx.drawImage(mask, 0, 0);
			const ctx = paint[name].getContext('2d', { willReadFrequently: true });
			ctx.save();
			ctx.globalCompositeOperation = 'destination-in';
			ctx.drawImage(mask, 0, 0);
			ctx.globalCompositeOperation = 'source-over';
			ctx.drawImage(this.scratch, 0, 0);
			ctx.restore();
		});
	}

	// Fill ('add') or Erase ('sub') the whole area on a paint surface: the
	// area goes into one canvas and comes out of the other, as a brush dab does.
	stampPaint(layer, paint, mode) {
		const mask = this.getLayerMask(layer);
		const target = (mode === 'add' ? paint.add : paint.sub).getContext('2d', { willReadFrequently: true });
		const opposite = (mode === 'add' ? paint.sub : paint.add).getContext('2d', { willReadFrequently: true });
		target.drawImage(mask, 0, 0);
		opposite.save();
		opposite.globalCompositeOperation = 'destination-out';
		opposite.drawImage(mask, 0, 0);
		opposite.restore();
	}
}
