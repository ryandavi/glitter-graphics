class HistoryManager {
	constructor(editor, limit = CONFIG.historyLimit) {
		this.editor = editor;
		this.limit = limit;
		this.history = [];
		this.historyIndex = -1;
	}

	createStateSnapshot() {
		return {
			layers: this.editor.layers.map((layer) => {
				if (layer.type === LayerType.STICKER && this.editor.stickerManager) {
					return this.editor.stickerManager.serializeSticker(layer);
				}

				if (layer.type === LayerType.TEXT_GLITTER) {
					return {
						id: layer.id,
						type: LayerType.TEXT_GLITTER,
						name: layer.name,
						visible: layer.visible,
						locked: layer.locked,
						selectedGlitterId: layer.selectedGlitterId,
						settings: layer.settings ? { ...layer.settings } : {},
						textData: layer.textData ? JSON.parse(JSON.stringify(layer.textData)) : null
					};
				}

				if (layer.type === LayerType.SHAPE) {
					return {
						id: layer.id,
						type: LayerType.SHAPE,
						name: layer.name,
						visible: layer.visible,
						locked: layer.locked,
						selectedGlitterId: layer.selectedGlitterId,
						settings: layer.settings ? { ...layer.settings } : {},
						shapeData: layer.shapeData ? JSON.parse(JSON.stringify(layer.shapeData)) : null
					};
				}

				if (layer.type === LayerType.BASE_IMAGE) {
					return {
						id: layer.id,
						type: LayerType.BASE_IMAGE,
						visible: layer.visible,
						locked: layer.locked
					};
				}

				return {
					id: layer.id,
					type: layer.type || LayerType.GLITTER_FILL,
					visible: layer.visible,
					locked: layer.locked,
					maskVersion: layer.maskVersion || 0,
					selections: layer.selections ? JSON.parse(JSON.stringify(layer.selections)) : [],
					selectedGlitterId: layer.selectedGlitterId,
					settings: layer.settings ? { ...layer.settings } : {}
				};
			}),
			activeLayerId: this.editor.activeLayerId,
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
					alphaChannel: this.editor.originalAlphaChannel
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
			this.editor.textGlitterManager.pickerSession = null;
			if (this.editor.shapeGlitterManager) this.editor.shapeGlitterManager.pickerSession = null;
		}
		this.editor.layers = [];

		for (const layerData of state.layers) {
			if (layerData.type === LayerType.STICKER && this.editor.stickerManager) {
				const restoredLayer = await this.editor.stickerManager.deserializeSticker(layerData);
				if (restoredLayer) {
					this.editor.layers.push(restoredLayer);
				}
			} else if (layerData.type === LayerType.TEXT_GLITTER) {
				const restoredLayer = {
					id: layerData.id,
					type: LayerType.TEXT_GLITTER,
					name: layerData.name || this.editor.textGlitterManager?.getLayerName(layerData.textData?.text || ''),
					visible: layerData.visible,
					locked: layerData.locked,
					selectedGlitterId: layerData.selectedGlitterId,
					settings: layerData.settings ? { ...layerData.settings } : {},
					textData: layerData.textData ? JSON.parse(JSON.stringify(layerData.textData)) : null
				};

				if (restoredLayer.textData?.fontId && this.editor.textGlitterManager) {
					try {
						await this.editor.textGlitterManager.ensureFontLoaded(restoredLayer.textData.fontId);
					} catch (error) {
						this.editor.textGlitterManager.reportFontLoadError(error);
						throw error;
					}
				}

				this.editor.layers.push(restoredLayer);
			} else if (layerData.type === LayerType.SHAPE) {
				this.editor.layers.push({
					id: layerData.id,
					type: LayerType.SHAPE,
					name: layerData.name || 'Shape',
					visible: layerData.visible,
					locked: layerData.locked,
					selectedGlitterId: layerData.selectedGlitterId,
					settings: layerData.settings ? { ...layerData.settings } : {},
					shapeData: layerData.shapeData ? JSON.parse(JSON.stringify(layerData.shapeData)) : null
				});
			} else if (layerData.type === LayerType.BASE_IMAGE) {
				this.editor.layers.push({
					id: layerData.id,
					type: LayerType.BASE_IMAGE,
					visible: layerData.visible,
					locked: layerData.locked,
					image: null
				});
			} else {
				this.editor.layers.push({
					id: layerData.id,
					type: layerData.type || LayerType.GLITTER_FILL,
					visible: layerData.visible,
					locked: layerData.locked,
					maskVersion: layerData.maskVersion || 0,
					maskHasContent: false,
					selections: layerData.selections ? JSON.parse(JSON.stringify(layerData.selections)) : [],
					selectedGlitterId: layerData.selectedGlitterId,
					settings: layerData.settings ? { ...layerData.settings } : {}
				});
			}
		}

		this.editor.glitterManager?.restorePaintState(this.editor.layers);
		this.editor.activeLayerId = state.activeLayerId;

		this.editor.layerManager.renderLayersList();
		this.editor.loadActiveLayerSettings();
		this.editor.updateGlitterSelection();
		this.editor.updatePreview();
		this.editor.updateActionButtons();

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
		return this.historyIndex > 0;
	}

	canRedo() {
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
