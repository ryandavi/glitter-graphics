class HistoryManager {
	constructor(editor, limit = CONFIG.app.limits.historyLimit) {
		this.editor = editor;
		this.limit = limit;
		this.history = [];
		this.historyIndex = -1;
	}

	createStateSnapshot() {
		return {
			// Ephemeral Auto Glitter session layers (isPreview) never enter
			// history — they are removed or committed before any undoable edit.
			layers: this.editor.layers.filter((layer) => !layer.isPreview)
				.map((layer) => this.editor.layerManager.serializeLayer(layer)),
			activeLayerId: this.editor.activeLayerId,
			selectedLayerIds: [...(this.editor.selectedLayerIds || [])],
			// Canvas dimensions + base-image pixels, so a Canvas Size / crop resize
			// is undoable. originalImageData/originalAlphaChannel are REPLACE-ONLY
			// (never mutated in place — see GlitterEditor.resizeCanvas / loadImage),
			// so storing the reference is safe and shares one buffer across every
			// snapshot between two resizes (no per-save copy).
			canvas: this.editor.originalImageData
				? {
					width: this.editor.originalCanvas.width,
					height: this.editor.originalCanvas.height,
					imageData: this.editor.originalImageData,
					alphaChannel: this.editor.originalAlphaChannel,
					baseImageSource: this.editor.baseImageSource,
					originalImage: this.editor.originalImage
				}
				: null
		};
	}

	saveState(label = null, { coalesceKey = null } = {}) {
		const state = { ...this.createStateSnapshot(), label, coalesceKey };
		// Serialized layers are the bytes a state holds on its own (UTF-16).
		state.bytes = JSON.stringify(state.layers).length * 2;

		this.history = this.history.slice(0, this.historyIndex + 1);
		const current = this.history[this.historyIndex];
		if (coalesceKey && current?.coalesceKey === coalesceKey) {
			this.history[this.historyIndex] = state;
			this.editor.paintMaskStore?.prunePaintHistory();
			this.editor.shapeGlitterManager?.pruneImageFillAssets();
			this.updateButtons();
			return;
		}

		if (this.history.length >= this.limit) {
			this.history.shift();
		} else {
			this.historyIndex++;
		}

		this.history.push(state);
		this.trimToByteBudget();
		this.editor.paintMaskStore?.prunePaintHistory();
		this.editor.shapeGlitterManager?.pruneImageFillAssets();
		this.updateButtons();
	}

	// Bytes undo history holds: each state's serialized layers, plus base-image
	// buffers from before a canvas resize or image change. Those are shared
	// between states, so each counts once, and the current one belongs to the
	// document, not history.
	getHistoryBytes() {
		const buffers = new Set([this.editor.originalImageData]);
		return this.history.reduce((total, state) => {
			let bytes = total + (state.bytes || 0);
			const imageData = state.canvas?.imageData;
			if (imageData && !buffers.has(imageData)) {
				buffers.add(imageData);
				bytes += (imageData.data?.byteLength || 0) + (state.canvas.alphaChannel?.byteLength || 0);
			}
			return bytes;
		}, 0);
	}

	// Past the device's history budget, drop the oldest steps (keeping at least
	// CONFIG.memory.minHistorySteps) and say so once per session.
	trimToByteBudget() {
		const budget = getMemoryBudget().historyBytes;
		let trimmed = 0;
		while (
			this.history.length > CONFIG.memory.minHistorySteps
			&& this.historyIndex > 0
			&& this.getHistoryBytes() > budget
		) {
			this.history.shift();
			this.historyIndex--;
			trimmed++;
		}
		if (trimmed && !this.trimNoticeShown) {
			this.trimNoticeShown = true;
			this.editor.updateStatus('This project is large, so older undo steps were cleared.');
		}
	}

	async restoreState(state) {
		this.editor.maskEditor?.handleStateRestore();
		const previousLayers = this.editor.layers;

		// Restore canvas dimensions + base image FIRST, before paint/layers: the
		// paint snapshots referenced below were captured at their own canvas size,
		// and ensurePaintMask sizes new buffers to the current canvas — so the
		// canvas must already be at the snapshot's size when restorePaintState runs.
		if (state.canvas) {
			this.editor.applyCanvasStateFromHistory(state.canvas);
		}
		// D-1c: the picker session is transient UI state that isn't snapshotted;
		// the armed slot may not even exist in the restored layer set. Drop it
		// here — the full UI refresh at the end of this method repaints the
		// gallery in browse mode.
		this.editor.pickers?.closeAll();
		const restoredLayers = [];

		for (const layerData of state.layers) {
			const restoredLayer = await this.editor.layerManager.deserializeLayer(layerData);
			if (restoredLayer) {
				restoredLayers.push(restoredLayer);
			}
		}

		// Keep the current layer collection renderable across async font/image
		// preparation, then commit the restored collection in one step.
		await this.editor.glitterManager?.ensureLayersPreviewAssetsReady(restoredLayers);
		this.editor.layers = restoredLayers;
		this.editor.paintMaskStore?.restorePaintState(this.editor.layers);
		this.editor.layerManager.restoreSelectionState(state.activeLayerId, state.selectedLayerIds);

		this.editor.layerManager.renderLayersList();
		this.editor.requestPreviewUpdate();
		this.editor.loadActiveLayerSettings();
		this.editor.syncTransformHandlesForActiveLayer?.();
		this.editor.updateActionButtons();
		this.editor.updateGlitterSelection();

		requestAnimationFrame(() => {
			const activeLayer = this.editor.layerManager.getActiveLayer();
			if (!activeLayer) return;
			this.editor.syncTransformHandlesForActiveLayer?.();
			const ctx = this.editor.getMovableLayerContext?.(activeLayer);
			if (ctx?.prefix) {
				this.editor.loadTransformSettings?.(activeLayer, ctx.prefix);
			}
		});

		// Re-enter mask editing against the restored layer if Brush/Eraser is
		// still the active tool; otherwise just resync its button state.
		if (this.editor.currentTool === ToolType.BRUSH) {
			this.editor.maskEditor?.onToolChanged(ToolType.BRUSH);
		} else {
			this.editor.maskEditor?.updateToolButtonState();
		}
	}

	async undo() {
		if (!this.canUndo()) {
			return;
		}

		this.historyIndex--;
		await this.restoreState(this.history[this.historyIndex]);
		this.updateButtons();
	}

	async redo() {
		if (!this.canRedo()) {
			return;
		}

		this.historyIndex++;
		await this.restoreState(this.history[this.historyIndex]);
		this.updateButtons();
	}

	reset(initialState = null) {
		if (initialState) {
			this.history = [initialState];
			this.historyIndex = 0;
		} else {
			this.history = [];
			this.historyIndex = -1;
		}

		this.editor.paintMaskStore?.prunePaintHistory();
		this.editor.shapeGlitterManager?.pruneImageFillAssets();
		this.updateButtons();
	}

	canUndo() {
		// A restore while an Auto Glitter session is open would rebuild the
		// layer stack under the ephemeral preview batch.
		if (this.editor.autoGlitterManager?.isSessionActive()) return false;
		return this.historyIndex > 0;
	}

	canRedo() {
		if (this.editor.autoGlitterManager?.isSessionActive()) return false;
		return this.historyIndex >= 0 && this.historyIndex < this.history.length - 1;
	}

	updateButtons() {
		const undoButton = document.getElementById('undoTool');
		const redoButton = document.getElementById('redoTool');

		if (undoButton) {
			undoButton.disabled = !this.canUndo();
			const label = this.canUndo() ? this.history[this.historyIndex]?.label : null;
			undoButton.title = label ? `Undo ${label}` : 'Undo';
		}

		if (redoButton) {
			redoButton.disabled = !this.canRedo();
			const label = this.canRedo() ? this.history[this.historyIndex + 1]?.label : null;
			redoButton.title = label ? `Redo ${label}` : 'Redo';
		}
	}
}
