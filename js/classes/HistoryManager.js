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
			activeLayerId: this.editor.activeLayerId
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
		this.editor.layers = [];

		for (const layerData of state.layers) {
			if (layerData.type === LayerType.STICKER && this.editor.stickerManager) {
				const restoredLayer = await this.editor.stickerManager.deserializeSticker(layerData);
				if (restoredLayer) {
					this.editor.layers.push(restoredLayer);
				}
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
