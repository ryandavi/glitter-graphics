'use strict';

// ============================================
// AREA SELECTION
// The region drawn with the Select Area tool: where Fill and Erase act, and
// the only place the Glitter Brush and Eraser change pixels while it exists.
// ============================================
// The area is a list of operations in document px, applied in order:
// { op: 'add' | 'subtract' | 'intersect', rings } closes polygons (a
// rectangle is four points, an ellipse a many-sided polygon, a lasso its own
// trace), and { op: 'invert' } flips everything inside the document. Points
// make a canvas resize, crop or document scale a plain point transform.
//
// Working state has its own undo steps ordered with document history, and
// stays out of project files. Fill and Erase are ordinary paint commits.
//
// Masks rasterize the operations into a target space and binarize them, so
// clipping a stroke is exact and can be repeated without eroding its edge.

// Area operations with every point passed through `map`: a copy, so a color
// pick keeps the area it was made in while the live area moves on.
function mapAreaOps(ops, map = (point) => ({ ...point })) {
	return ops.map((entry) => (entry.rings ? { ...entry, rings: entry.rings.map(ring => ring.map(map)) } : { ...entry }));
}

class AreaSelection {
	constructor(editor) {
		this.editor = editor;
		this.ops = [];
		this.revision = 0;
		this.masks = new Map();
		this.coverage = new WeakMap();
		this.measurements = new WeakMap();
		this.history = {
			undoStack: [], redoStack: [], lastCleared: null,
			claim: direction => this.claimHistory(direction),
			undo: () => this.stepHistory('undo'), redo: () => this.stepHistory('redo'),
			get canUndo() { return this.undoStack.length > 0; },
			get canRedo() { return this.redoStack.length > 0; }
		};
		this.scratch = createAppCanvas(0, 0, 'systems/AreaSelection');
	}

	get isEmpty() {
		return this.ops.length === 0;
	}

	// The operations the area would hold after a shape is drawn in `mode`:
	// 'new' replaces the area, 'add', 'subtract' and 'intersect' combine with
	// it. Subtracting from or intersecting with no area leaves none.
	combine(rings, mode = 'new') {
		if (mode === 'new' || (mode === 'add' && this.isEmpty)) return [{ op: 'add', rings }];
		return this.isEmpty ? [] : [...this.ops, { op: mode, rings }];
	}

	apply(rings, mode = 'new') {
		rings = rings.filter(ring => ring.length >= 3);
		if (!rings.length) return false;
		const ops = this.combine(rings, mode);
		if (!ops.length) return false;
		this.commit(ops);
		return true;
	}

	applyCoverage(coverage, mode = 'new') {
		const { width, height } = this.getDocumentSize();
		return this.apply(traceMaskContours(coverage, width, height, 0), mode);
	}

	commit(nextOps, { key = null, label = 'Area' } = {}) {
		const history = this.history;
		const serial = this.editor.historyManager.nextSerial();
		const top = history.undoStack.at(-1);
		if (!key || top?.key !== key || this.editor.historyManager.history[this.editor.historyManager.historyIndex]?.serial > top.serial) {
			history.undoStack.push({ ops: this.ops, serial, key, label });
			if (history.undoStack.length > CONFIG.tools.area.historyLimit) history.undoStack.shift();
		} else { top.serial = serial; top.label = label; }
		history.redoStack = [];
		this.ops = nextOps;
		this.changed();
	}

	replace(ops, options) { this.commit(ops, options); }
	selectAll() {
		const { width, height } = this.getDocumentSize();
		this.apply([[{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]]);
	}
	invert() {
		if (this.isEmpty) return;
		this.commit(this.ops.at(-1).op === 'invert' ? this.ops.slice(0, -1) : [...this.ops, { op: 'invert' }]);
	}
	clear() {
		if (this.isEmpty) return;
		this.history.lastCleared = this.ops;
		this.commit([]);
	}
	reselect() {
		if (this.isEmpty && this.history.lastCleared) this.commit(this.history.lastCleared);
	}
	reset() {
		this.editor.areaSelect?.cancelDrag();
		this.editor.areaSelect?.cancelModify();
		this.ops = [];
		this.history.undoStack = []; this.history.redoStack = []; this.history.lastCleared = null;
		this.changed();
	}
	claimHistory(direction) {
		const doc = this.editor.historyManager;
		const entry = this.history[`${direction}Stack`].at(-1);
		if (!entry) return null;
		const state = doc.history[doc.historyIndex + (direction === 'redo' ? 1 : 0)];
		return (direction === 'undo' ? entry.serial > (state?.serial || 0) : !state || entry.serial < state.serial) ? this.history : null;
	}
	stepHistory(direction) {
		const entry = this.history[`${direction}Stack`].pop();
		if (!entry) return;
		this.history[direction === 'undo' ? 'redoStack' : 'undoStack'].push({ ...entry, ops: this.ops });
		this.ops = entry.ops;
		this.changed();
	}
	moveBy(dx, dy, options) {
		if ((dx || dy) && !this.isEmpty) this.commit(mapAreaOps(this.ops, point => ({ x: point.x + dx, y: point.y + dy })), options);
	}
	transformPoints(map) {
		this.ops = mapAreaOps(this.ops, map);
		for (const stack of [this.history.undoStack, this.history.redoStack]) for (const entry of stack) entry.ops = mapAreaOps(entry.ops, map);
		if (this.history.lastCleared) this.history.lastCleared = mapAreaOps(this.history.lastCleared, map);
		this.changed();
	}

	changed() {
		this.revision++;
		this.masks.clear();
		this.editor.areaSelect?.onAreaChanged();
		this.editor.historyManager?.updateButtons();
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
		ops.forEach(({ op, rings = [documentOutline] }) => {
			ctx.globalCompositeOperation = op === 'invert' ? AREA_INVERT_COMPOSITE : AREA_MODES[op].composite;
			ctx.beginPath();
			rings.forEach(points => {
				points.forEach((point, index) => {
					const mapped = mapPoint(point);
					if (index) ctx.lineTo(mapped.x, mapped.y); else ctx.moveTo(mapped.x, mapped.y);
				});
				ctx.closePath();
			});
			ctx.fill('nonzero');
		});
		ctx.restore();
	}

	// A binarized, document-sized mask of the area in one target space, kept
	// until the area changes. Two spaces at most are live: the document and
	// the fill layer being painted.
	_getMask(key, mapPoint) {
		let mask = this.masks.get(key);
		if (mask) { this.masks.delete(key); this.masks.set(key, mask); return mask; }
		if (this.masks.size >= 2) this.masks.delete(this.masks.keys().next().value);
		mask = this._rasterize(mapPoint);
		this.masks.set(key, mask);
		return mask;
	}

	_rasterize(mapPoint, ops = this.ops) {
		const { width, height } = this.getDocumentSize();
		const mask = createAppCanvas(width, height, 'systems/AreaSelection');
		const ctx = mask.getContext('2d', { willReadFrequently: true });
		ctx.fillStyle = '#fff';
		this.trace(ctx, mapPoint, ops);
		binarizeCanvasAlpha(ctx, width, height);
		return mask;
	}

	// One byte per document pixel, nonzero inside `ops`: the area a color pick
	// was made in (js/paint/color-selection.js). Kept per operation list, so a
	// threshold drag rasterizes it once.
	getCoverage(ops = this.ops) {
		const { width, height } = this.getDocumentSize();
		let cached = this.coverage.get(ops);
		if (cached?.width === width && cached.height === height) return cached.data;
		const pixels = this._rasterize((point) => point, ops).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
		const data = new Uint8Array(width * height);
		for (let index = 0; index < data.length; index++) data[index] = pixels[index * 4 + 3];
		cached = { width, height, data };
		this.coverage.set(ops, cached);
		return data;
	}

	// The smallest document rectangle that holds the area, or null.
	getBounds() { return this.getMeasurements().bounds; }
	getMeasurements() {
		const { width, height } = this.getDocumentSize();
		const cached = this.measurements.get(this.ops);
		if (cached?.width === width && cached.height === height) return cached;
		const coverage = this.getCoverage();
		let minX = width, minY = height, maxX = -1, maxY = -1, sumX = 0, sumY = 0, count = 0;
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			if (!coverage[y * width + x]) continue;
			minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
			sumX += x; sumY += y; count++;
		}
		let anchor = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
		if (count) {
			const cx = sumX / count, cy = sumY / count;
			anchor = { x: Math.round(cx), y: Math.round(cy) };
			if (!coverage[anchor.y * width + anchor.x]) {
				let nearest = Infinity;
				for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
					if (!coverage[y * width + x]) continue;
					const distance = (x - cx) ** 2 + (y - cy) ** 2;
					if (distance < nearest) { nearest = distance; anchor = { x, y }; }
				}
			}
		}
		const result = { width, height, anchor, bounds: count ? { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null };
		this.measurements.set(this.ops, result);
		return result;
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
		return this.getCoverage()[y * width + x] > 0;
	}

	// A document point inside the area's drawn shapes, for resolving which
	// fill layer an action lands on.
	getAnchorPoint() { return this.getMeasurements().anchor; }

	getDistanceField(margin) {
		const bounds = this.getBounds();
		if (!bounds) return null;
		const size = this.getDocumentSize();
		const x = Math.max(0, bounds.minX - margin), y = Math.max(0, bounds.minY - margin);
		const width = Math.min(size.width, bounds.minX + bounds.width + margin) - x;
		const height = Math.min(size.height, bounds.minY + bounds.height + margin) - y;
		const canvas = createAppCanvas(width, height, 'systems/AreaSelection');
		canvas.getContext('2d').drawImage(this.getDocumentMask(), x, y, width, height, 0, 0, width, height);
		return { x, y, width, height, canvas, field: createSignedDistanceField(canvas) };
	}

	modifyCoverage(source, kind, amount) {
		const size = this.getDocumentSize();
		const result = new Uint8Array(size.width * size.height);
		if (!source) return result;
		let field = source.field;
		const passes = AREA_MODIFIERS[kind].passes || [kind];
		let coverage;
		passes.forEach((pass, index) => {
			coverage = new Uint8Array(field.distance.length);
			const test = AREA_MODIFIERS[pass].test;
			let changed = false;
			for (let i = 0; i < coverage.length; i++) {
				const inside = test(field.distance[i], amount);
				coverage[i] = inside ? 255 : 0;
				if (inside !== Boolean(field.inside[i])) changed = true;
			}
			if (index + 1 < passes.length && changed) {
				const ctx = source.canvas.getContext('2d', { willReadFrequently: true });
				const image = ctx.createImageData(source.width, source.height);
				for (let i = 0; i < coverage.length; i++) image.data[i * 4 + 3] = coverage[i];
				ctx.putImageData(image, 0, 0);
				field = createSignedDistanceField(source.canvas);
			}
		});
		for (let y = 0; y < source.height; y++) result.set(coverage.subarray(y * source.width, (y + 1) * source.width), (source.y + y) * size.width + source.x);
		return result;
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
