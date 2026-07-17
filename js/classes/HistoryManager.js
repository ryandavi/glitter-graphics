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

	saveState() {
		const state = this.createStateSnapshot();

		this.history = this.history.slice(0, this.historyIndex + 1);

		if (this.history.length >= this.limit) {
			this.history.shift();
		} else {
			this.historyIndex++;
		}

		this.history.push(state);
		this.editor.glitterManager?.prunePaintHistory();
		this.updateButtons();
	}

	async restoreState(state) {
		this.editor.maskEditor?.handleStateRestore();

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
		if (this.editor.textGlitterManager) {
			this.editor.textGlitterManager.closePickerSession();
			this.editor.shapeGlitterManager?.closePickerSession();
			this.editor.stickerManager?.closePickerSession();
			this.editor.glitterManager?.closePickerSession();
			this.editor.baseBackgroundManager?.closePickerSession();
		}
		this.editor.layers = [];

		for (const layerData of state.layers) {
			const restoredLayer = await this.editor.layerManager.deserializeLayer(layerData);
			if (restoredLayer) {
				this.editor.layers.push(restoredLayer);
			}
		}

		this.editor.glitterManager?.restorePaintState(this.editor.layers);
		this.editor.layerManager.restoreSelectionState(state.activeLayerId, state.selectedLayerIds);

		this.editor.layerManager.renderLayersList();
		this.editor.updatePreview();
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

		this.editor.glitterManager?.prunePaintHistory();
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
		}

		if (redoButton) {
			redoButton.disabled = !this.canRedo();
		}
	}
}
