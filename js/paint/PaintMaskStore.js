'use strict';

// ============================================
// PAINT MASK STORE
// Owns the brush-painted part of every glitter-fill mask: one live add/sub
// canvas pair per layer (paintMasks), plus versioned alpha snapshots
// (paintHistory) that undo states reference through layer.maskVersion. A
// history state never holds pixels; it names a version, and restorePaintState
// blits that version back into the live buffers. prunePaintHistory drops the
// versions no history state references and then evicts the oldest ones past
// CONFIG.canvas.limits.paintHistoryMaxMB, never a live layer's current one.
// MaskCompositor combines these buffers with the color selection.
// ============================================
class PaintMaskStore {
	constructor(editor) {
		this.editor = editor;
		this.paintMasks = new Map();
		this.paintHistory = new Map();
		this.paintHistoryBytes = 0;
		this.paintHistoryByteLimit = CONFIG.canvas.limits.paintHistoryMaxMB * 1024 * 1024;
		this.nextPaintVersion = 1;
	}

	getPaintMask(layerId) {
		return this.paintMasks.get(layerId) || null;
	}

	ensurePaintMask(layerId) {
		if (this.paintMasks.has(layerId)) {
			return this.paintMasks.get(layerId);
		}

		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const paint = {
			add: createAppCanvas(0, 0, 'paint/PaintMaskStore'),
			sub: createAppCanvas(0, 0, 'paint/PaintMaskStore'),
			version: 0,
			liveRevision: 0,
			hasContent: false
		};

		paint.add.width = width;
		paint.add.height = height;
		paint.sub.width = width;
		paint.sub.height = height;

		this.paintMasks.set(layerId, paint);
		return paint;
	}

	removePaintMask(layerId) {
		this.paintMasks.delete(layerId);
	}

	// Drop all live paint buffers so restorePaintState recreates them at the
	// current canvas size. Used when an undo/redo changes the canvas dimensions:
	// the existing buffers are the wrong size and blitAlphaToCanvas assumes the
	// destination matches the (per-entry, correctly-sized) snapshot.
	discardLivePaintBuffers() {
		this.paintMasks.clear();
		this.editor.maskCompositor?.reset();
	}

	// Structural canvas resize (canvas-resize.js): re-anchor every live paint
	// buffer onto a new canvas-sized buffer and re-snapshot paint at the new
	// dimensions so the history baseline references valid (new-size) snapshots.
	// The fill layers' selection seeds move in GlitterManager.
	reanchorForCanvasResize(newWidth, newHeight, offsetX, offsetY, layers) {
		this.paintMasks.forEach((paint) => {
			paint.add = this._reanchorCanvas(paint.add, newWidth, newHeight, offsetX, offsetY);
			paint.sub = this._reanchorCanvas(paint.sub, newWidth, newHeight, offsetX, offsetY);
			paint.liveRevision++;
		});

		// Re-capture paint at the new size (old snapshots were captured at the old
		// dimensions and would blit inconsistently after the history reset).
		(layers || []).forEach((layer) => {
			if (layer.type === LayerType.GLITTER_FILL && this.paintMasks.has(layer.id)) {
				this.commitPaintState(layer);
			}
		});
	}

	// Design scaling resamples canvas-sized paint buffers. Nearest-neighbor plus
	// the normal mask threshold keeps painted edges binary.
	scaleForCanvasResize(newWidth, newHeight, scaleX, scaleY, layers) {
		this.paintMasks.forEach((paint) => {
			paint.add = this._scaleCanvas(paint.add, newWidth, newHeight);
			paint.sub = this._scaleCanvas(paint.sub, newWidth, newHeight);
			paint.liveRevision++;
		});

		(layers || []).forEach((layer) => {
			if (layer.type === LayerType.GLITTER_FILL && this.paintMasks.has(layer.id)) {
				this.commitPaintState(layer);
			}
		});
	}

	_scaleCanvas(source, newWidth, newHeight) {
		const canvas = createAppCanvas(0, 0, 'paint/PaintMaskStore');
		canvas.width = newWidth;
		canvas.height = newHeight;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(source, 0, 0, newWidth, newHeight);
		return canvas;
	}

	_reanchorCanvas(source, newWidth, newHeight, offsetX, offsetY) {
		const canvas = createAppCanvas(0, 0, 'paint/PaintMaskStore');
		canvas.width = newWidth;
		canvas.height = newHeight;
		canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, offsetX, offsetY);
		return canvas;
	}

	clearAllPaintData() {
		this.paintMasks.clear();
		this.paintHistory.clear();
		this.paintHistoryBytes = 0;
		this.nextPaintVersion = 1;
		this.editor.maskCompositor?.reset();
	}

	paintCanvasHasContent(canvas) {
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] > 0) {
				return true;
			}
		}
		return false;
	}

	// Registers uncommitted paint content so the mask pipeline rebuilds (cache
	// keys include paint.version) WITHOUT snapshotting into paintHistory —
	// Auto Glitter session reconciles run per live change and would otherwise
	// spam full-size snapshots. commitPaintState() finalizes with a real one.
	markPaintTransient(layer) {
		const paint = this.paintMasks.get(layer.id);
		if (!paint) return;
		paint.version = this.nextPaintVersion++;
		paint.liveRevision = 0;
		paint.hasContent = true;
		layer.maskHasContent = true;
		this.editor.maskCompositor?.invalidate(layer.id);
	}

	commitPaintState(layer) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL) {
			return 0;
		}

		const paint = this.paintMasks.get(layer.id);
		if (!paint) {
			return layer.maskVersion || 0;
		}

		const snapshot = this.capturePaintSnapshot(paint);
		const version = this.nextPaintVersion++;
		paint.version = version;
		paint.liveRevision = 0;
		paint.hasContent = snapshot.hasContent;

		this.storePaintSnapshot(layer.id, {
			version,
			add: snapshot.add,
			sub: snapshot.sub,
			hasContent: snapshot.hasContent,
			bytes: snapshot.bytes,
			timestamp: performance.now()
		});

		layer.maskVersion = version;
		layer.maskHasContent = snapshot.hasContent;
		this.editor.maskCompositor?.invalidate(layer.id);

		return version;
	}

	storePaintSnapshot(layerId, snapshot) {
		const snapshots = this.paintHistory.get(layerId) || [];
		snapshots.push(snapshot);
		this.paintHistoryBytes += snapshot.bytes;
		this.paintHistory.set(layerId, snapshots);
	}

	findPaintSnapshot(layerId, version) {
		const snapshots = this.paintHistory.get(layerId);
		if (!snapshots?.length) {
			return null;
		}

		for (let i = snapshots.length - 1; i >= 0; i--) {
			if (snapshots[i].version === version) {
				return snapshots[i];
			}
		}

		return null;
	}

	restorePaintState(layers) {
		const activeIds = new Set();

		layers.forEach((layer) => {
			if (layer.type !== LayerType.GLITTER_FILL) {
				return;
			}

			activeIds.add(layer.id);

			if (!layer.maskVersion) {
				this.removePaintMask(layer.id);
				layer.maskHasContent = false;
				layer.maskVersion = 0;
				this.editor.maskCompositor?.invalidate(layer.id);
				return;
			}

			const snapshot = this.findPaintSnapshot(layer.id, layer.maskVersion);
			if (!snapshot) {
				this.removePaintMask(layer.id);
				layer.maskHasContent = false;
				layer.maskVersion = 0;
				this.editor.maskCompositor?.invalidate(layer.id);
				return;
			}

			const paint = this.ensurePaintMask(layer.id);
			this.blitAlphaToCanvas(paint.add, snapshot.add);
			this.blitAlphaToCanvas(paint.sub, snapshot.sub);
			paint.version = snapshot.version;
			paint.liveRevision = 0;
			paint.hasContent = snapshot.hasContent;
			layer.maskHasContent = snapshot.hasContent;
			this.editor.maskCompositor?.invalidate(layer.id);
		});

		this.paintMasks.forEach((_, layerId) => {
			if (!activeIds.has(layerId)) {
				this.paintMasks.delete(layerId);
			}
		});
	}

	clearPaintForLayer(layer) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL) {
			return false;
		}

		if (!layer.maskHasContent && !this.paintMasks.has(layer.id) && !layer.maskVersion) {
			return false;
		}

		const paint = this.ensurePaintMask(layer.id);
		paint.add.getContext('2d', { willReadFrequently: true }).clearRect(0, 0, paint.add.width, paint.add.height);
		paint.sub.getContext('2d', { willReadFrequently: true }).clearRect(0, 0, paint.sub.width, paint.sub.height);
		paint.liveRevision++;
		this.commitPaintState(layer);
		this.editor.maskCompositor?.invalidate(layer.id);
		return true;
	}

	clonePaintData(sourceLayer, clonedLayer) {
		if (!sourceLayer || !clonedLayer || sourceLayer.type !== LayerType.GLITTER_FILL) {
			return;
		}

		const sourceVersion = sourceLayer.maskVersion || 0;
		if (!sourceVersion && !this.paintMasks.has(sourceLayer.id)) {
			clonedLayer.maskVersion = 0;
			clonedLayer.maskHasContent = false;
			return;
		}

		let snapshot = sourceVersion ? this.findPaintSnapshot(sourceLayer.id, sourceVersion) : null;
		if (!snapshot) {
			const livePaint = this.paintMasks.get(sourceLayer.id);
			if (!livePaint) {
				clonedLayer.maskVersion = 0;
				clonedLayer.maskHasContent = false;
				return;
			}
			snapshot = this.capturePaintSnapshot(livePaint);
		}

		const clonedPaint = this.ensurePaintMask(clonedLayer.id);
		this.blitAlphaToCanvas(clonedPaint.add, snapshot.add);
		this.blitAlphaToCanvas(clonedPaint.sub, snapshot.sub);
		clonedPaint.hasContent = snapshot.hasContent;
		clonedPaint.liveRevision = 0;
		this.commitPaintState(clonedLayer);
	}

	capturePaintSnapshot(paint) {
		const add = this.extractAlphaFromCanvas(paint.add);
		const sub = this.extractAlphaFromCanvas(paint.sub);
		const hasContent = add.some((value) => value > 0) || sub.some((value) => value > 0);
		return {
			add,
			sub,
			hasContent,
			bytes: add.byteLength + sub.byteLength
		};
	}

	extractAlphaFromCanvas(canvas) {
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		const alpha = new Uint8Array(canvas.width * canvas.height);
		for (let i = 0; i < alpha.length; i++) {
			alpha[i] = imageData[i * 4 + 3];
		}
		return alpha;
	}

	blitAlphaToCanvas(canvas, alpha) {
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		const imageData = ctx.createImageData(canvas.width, canvas.height);
		for (let i = 0; i < alpha.length; i++) {
			imageData.data[i * 4 + 3] = alpha[i];
		}
		ctx.putImageData(imageData, 0, 0);
	}

	prunePaintHistory() {
		const referenced = this.collectReferencedMaskVersions();
		let nextByteTotal = 0;

		this.paintHistory.forEach((snapshots, layerId) => {
			const keepVersions = referenced.get(layerId);
			const keptSnapshots = snapshots.filter((snapshot) => keepVersions?.has(snapshot.version));
			if (keptSnapshots.length > 0) {
				this.paintHistory.set(layerId, keptSnapshots);
				nextByteTotal += keptSnapshots.reduce((sum, snapshot) => sum + snapshot.bytes, 0);
			} else {
				this.paintHistory.delete(layerId);
			}
		});

		this.paintHistoryBytes = nextByteTotal;

		if (this.paintHistoryBytes <= this.paintHistoryByteLimit) {
			return;
		}

		const orderedSnapshots = [];
		this.paintHistory.forEach((snapshots, layerId) => {
			snapshots.forEach((snapshot) => {
				orderedSnapshots.push({ layerId, snapshot });
			});
		});

		orderedSnapshots.sort((left, right) => left.snapshot.timestamp - right.snapshot.timestamp);

		// Over budget: evict oldest first. Everything left is referenced by some
		// history state (unreferenced snapshots were dropped above), so eviction
		// trades deep-undo paint fidelity for bounded memory — restorePaintState
		// clears paint gracefully when a snapshot is missing. Never evict a live
		// layer's current version; that one backs the state the user is looking at.
		const liveVersions = new Map();
		(this.editor.layerManager?.layers || []).forEach((layer) => {
			if (layer.type === LayerType.GLITTER_FILL && layer.maskVersion) {
				liveVersions.set(layer.id, layer.maskVersion);
			}
		});

		for (const entry of orderedSnapshots) {
			if (this.paintHistoryBytes <= this.paintHistoryByteLimit) {
				break;
			}

			if (liveVersions.get(entry.layerId) === entry.snapshot.version) {
				continue;
			}

			const snapshots = this.paintHistory.get(entry.layerId);
			if (!snapshots) continue;

			const filtered = snapshots.filter((snapshot) => snapshot.version !== entry.snapshot.version);
			this.paintHistory.set(entry.layerId, filtered);
			this.paintHistoryBytes -= entry.snapshot.bytes;
		}
	}

	collectReferencedMaskVersions() {
		const referenced = new Map();
		const history = this.editor.historyManager?.history || [];

		history.forEach((state) => {
			state.layers.forEach((layer) => {
				if (layer.type !== LayerType.GLITTER_FILL || !layer.maskVersion) {
					return;
				}

				if (!referenced.has(layer.id)) {
					referenced.set(layer.id, new Set());
				}

				referenced.get(layer.id).add(layer.maskVersion);
			});
		});

		return referenced;
	}
}
