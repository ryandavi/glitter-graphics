class HistoryManager {
	constructor(editor, limit = CONFIG.app.limits.historyLimit) {
		this.editor = editor;
		this.limit = limit;
		this.history = [];
		this.historyIndex = -1;
		this.serial = 0;
		this.restoreQueue = Promise.resolve();
		this.coalescingOpen = false;
		this.burstSerial = 0;
	}

	nextSerial() { return ++this.serial; }

	burstCoalesceKey(group) {
		const now = performance.now();
		if (!this.activeBurst || this.activeBurst.group !== group || now - this.activeBurst.time > CONFIG.ui.history.coalesceMs) {
			this.activeBurst = { group, key: `${group}:${++this.burstSerial}` };
		}
		this.activeBurst.time = now;
		return this.activeBurst.key;
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
		const state = { ...this.createStateSnapshot(), label, coalesceKey, serial: this.nextSerial() };
		// Serialized layers are the bytes a state holds on its own (UTF-16).
		state.bytes = JSON.stringify(state.layers).length * 2;

		this.history = this.history.slice(0, this.historyIndex + 1);
		const current = this.history[this.historyIndex];
		if (this.coalescingOpen && coalesceKey && current?.coalesceKey === coalesceKey) {
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
		this.coalescingOpen = true;
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

	async restoreState(state, touchedState = null) {
		this.coalescingOpen = false;
		this.activeBurst = null;
		this.editor.maskEditor?.handleStateRestore();

		// Restore canvas dimensions + base image FIRST, before paint/layers: the
		// paint snapshots referenced below were captured at their own canvas size,
		// and ensurePaintMask sizes new buffers to the current canvas — so the
		// canvas must already be at the snapshot's size when restorePaintState runs.
		if (state.canvas) {
			this.editor.applyCanvasStateFromHistory(state.canvas);
		}
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
		const touchedIds = touchedState?.selectedLayerIds?.filter(id => restoredLayers.some(layer => layer.id === id));
		const selection = touchedIds?.length ? touchedIds : state.selectedLayerIds;
		const activeId = touchedIds?.length ? touchedState.activeLayerId : state.activeLayerId;
		this.editor.layerManager.restoreSelectionState(activeId, selection, { source: 'history' });

		this.editor.layerManager.renderLayersList();
		this.editor.requestPreviewUpdate();
		this.editor.scheduleExportDuration();
		// The selection may be the same layers in another state (a lock, a
		// rename, an emptied source), so the Inspector refreshes regardless. A
		// picker session is not snapshotted: the refresh ends one whose layer
		// or paint the restore removed, and keeps the rest armed.
		this.editor.refreshInspector();
		this.editor.syncTransformHandlesForActiveLayer?.();
		this.editor.updateActionButtons();

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
			TOOLS[this.editor.currentTool].onActivate(this.editor);
		} else {
			this.editor.maskEditor?.updateToolButtonState();
		}
	}

	// The steps of the open session, when it keeps its own (a pending crop).
	// They are not document history: leaving the session drops them.
	sessionHistory(direction) {
		const session = getSessionDefinition(this.editor);
		if (session?.history) return session.history(this.editor, direction);
		return !session || session.id === 'area' ? this.editor.areaSelection?.history.claim(direction) : null;
	}

	undo() { return this.enqueueRestore('undo'); }
	redo() { return this.enqueueRestore('redo'); }

	enqueueRestore(direction) {
		if (this.editor.modalManager?.isAnyOpen()) return Promise.resolve();
		if (ESCAPE_HANDLERS.find(entry => entry.id === 'drag').handle(this.editor)) return Promise.resolve();
		const result = this.restoreQueue.then(() => this.stepHistory(direction));
		// A failed restore rejects its caller, but does not poison later requests.
		this.restoreQueue = result.catch(() => {});
		return result;
	}

	async stepHistory(direction) {
		await this.editor.flushPendingCommits();
		if (!this.sessionHistory(direction)) this.editor.textGlitterManager?.endTextEdit();
		if (!(direction === 'undo' ? this.canUndo() : this.canRedo())) return;
		const session = this.sessionHistory(direction);
		this.coalescingOpen = false;
		if (session) {
			const label = session[`${direction}Stack`]?.at(-1)?.label;
			await session[direction]();
			if (label) this.editor.updateStatus(`${direction === 'undo' ? 'Undo' : 'Redo'}: ${label}`);
			this.updateButtons();
			return;
		}
		const previousIndex = this.historyIndex;
		this.historyIndex += direction === 'undo' ? -1 : 1;
		try {
			const touchedState = this.history[direction === 'undo' ? previousIndex : this.historyIndex];
			await this.restoreState(this.history[this.historyIndex], touchedState);
			if (touchedState.label) this.editor.updateStatus(`${direction === 'undo' ? 'Undo' : 'Redo'}: ${touchedState.label}`);
		} catch (error) {
			this.historyIndex = previousIndex;
			throw error;
		} finally { this.updateButtons(); }
	}

	reset(initialState = null) {
		this.coalescingOpen = false;
		this.activeBurst = null;
		if (initialState) {
			this.history = [{ ...initialState, serial: this.nextSerial() }];
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
		const session = this.sessionHistory('undo');
		if (session) return session.canUndo;
		const textSession = this.editor.textGlitterManager?.editSession;
		if (textSession && (textSession.created || textSession.dirty || textSession.initialText !== this.editor.layerManager.getLayerById(textSession.layerId)?.textData.text)) return true;
		return this.historyIndex > 0;
	}

	canRedo() {
		if (this.editor.autoGlitterManager?.isSessionActive()) return false;
		const session = this.sessionHistory('redo');
		if (session) return session.canRedo;
		return this.historyIndex >= 0 && this.historyIndex < this.history.length - 1;
	}

	updateButtons() {
		const undoButton = document.getElementById('undoTool');
		const redoButton = document.getElementById('redoTool');
		const undoSession = this.sessionHistory('undo');
		const redoSession = this.sessionHistory('redo');

		if (undoButton) {
			undoButton.disabled = !this.canUndo();
			const label = this.canUndo() ? (undoSession ? undoSession.undoStack?.at(-1)?.label : this.history[this.historyIndex]?.label) : null;
			undoButton.title = label ? `Undo ${label}` : 'Undo';
		}

		if (redoButton) {
			redoButton.disabled = !this.canRedo();
			const label = this.canRedo() ? (redoSession ? redoSession.redoStack?.at(-1)?.label : this.history[this.historyIndex + 1]?.label) : null;
			redoButton.title = label ? `Redo ${label}` : 'Redo';
		}
	}
}
