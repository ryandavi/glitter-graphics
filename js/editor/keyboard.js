'use strict';

const EDITOR_KEYBOARD_METHODS = {
	handleKeyUp(e) {
		this.shiftHeld = e.shiftKey;
		if (e.code === 'Space' && this.temporaryHandToolActive) {
			this.endTemporaryHandTool();
		}
		if (e.key === 'Alt') {
			if (this.currentTool === ToolType.ZOOM) {
				this.previewContainer.classList.remove('zoom-out-mode');
			}
		}
	},
	endTemporaryHandTool() {
		if (!this.temporaryHandToolActive) return;
		this.temporaryHandToolActive = false;
		if (this.currentTool === ToolType.HAND) {
			this.setTool(this.toolBeforeTemporaryHand || ToolType.SELECT, { resumeTemporary: true });
		}
		this.toolBeforeTemporaryHand = null;
	},
	handleKeyboard(e) {
		// Track Shift so slider drags (which fire modifier-less 'input' events) can
		// snap — mirrors the rotation handle's Shift-to-snap.
		this.shiftHeld = e.shiftKey;

		// Don't trigger shortcuts when typing in input fields
		const isTyping = focusKeyClaim().typing;

		if (e.code === 'Space' && !isTyping && !e.repeat && this.originalImage && !this.temporaryHandToolActive) {
			e.preventDefault();
			this.toolBeforeTemporaryHand = this.currentTool;
			this.temporaryHandToolActive = true;
			this.setTool(ToolType.HAND);
			return;
		}

		// Arrow keys nudge the selected movable layer (sticker/text/shape) before
		// the typing guard runs: a selected layer treats arrows as "move me", the
		// sticker behavior. If focus is parked in the text layer's own content field
		// (post-create / post-edit), blur it so moving takes over — the same as
		// clicking off the field. A focused control that uses the arrows itself
		// keeps them.
		if (!this.autoGlitterManager?.isSessionActive() && /^Arrow/.test(e.key) && dispatchKeyboardCommand(this, e, { isTyping: false })) return;

		// Typing shortcuts follow the command registry's policy.
		if (isTyping && e.key !== 'Escape' && !matchShortcut(e)?.allowWhileTyping) return;

		if (e.key === 'Alt' && this.currentTool === ToolType.ZOOM) {
			this.previewContainer.classList.add('zoom-out-mode');
		}

		if (e.key === 'Escape') {
			handleEscape(this, e);
			return;
		}

		dispatchKeyboardCommand(this, e, { isTyping });
	},
	tryArrowNudge(e) {
		if (this.currentTool !== ToolType.SELECT) return false;
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' &&
			e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
		const active = document.activeElement;
		const focusOwnsKey = focusClaimsArrowKey(e.key, active);
		if (focusOwnsKey && active !== this.textGlitterManager?.ui?.textInput) return false;

		const hasMultiSelection = this.layerManager.hasMultiSelection();
		if (hasMultiSelection && !this.layerManager.canTransformMultiSelection()) {
			e.preventDefault();
			this.showError('This selection cannot move because it includes a locked, pinned, empty, or Base Image layer');
			return true;
		}
		const layer = this.layerManager.getActiveLayer();
		const ctx = this.getMovableLayerContext(layer);
		const transform = this.getLayerTransformData(layer);
		if (!hasMultiSelection && (!ctx || !ctx.manager || !transform || !this.canTransformLayer(layer))) return false;

		// The text layer's own content field gives up focus so moving takes over.
		if (focusOwnsKey) active.blur();

		e.preventDefault();
		const step = e.shiftKey ? CONFIG.ui.nudge.fastStep : CONFIG.ui.nudge.step;
		const deltaX = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
		const deltaY = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;

		if (hasMultiSelection) {
			this.groupTransformManager?.nudge(deltaX, deltaY);
		} else {
			ctx.manager.updateTransform(layer.id, {
				position: {
					x: transform.position.x + deltaX,
					y: transform.position.y + deltaY
				}
			});

			this.loadTransformSettings(layer, ctx.prefix);
		}
		this.scheduleNudgeSave();
		return true;
	},
	scheduleNudgeSave() {
		clearTimeout(this._nudgeSaveTimer);
		const ids = this.layerManager.getSelectedLayers().map(layer => layer.id).join(',');
		const coalesceKey = this.historyManager.burstCoalesceKey(`nudge:${ids}`);
		this.registerPendingCommit('nudge', () => {
			clearTimeout(this._nudgeSaveTimer);
			this._nudgeSaveTimer = null;
			// A timer-delimited burst is one step; a later burst always pushes.
			this.saveState('Move layer', { coalesceKey });
		});
		this._nudgeSaveTimer = setTimeout(() => this.runPendingCommit('nudge'), CONFIG.ui.history.coalesceMs);
	},
	registerPendingCommit(key, commit) {
		this._pendingCommits ||= new Map();
		this._pendingCommits.set(key, commit);
	},
	cancelPendingCommit(key) {
		this._pendingCommits?.delete(key);
	},
	runPendingCommit(key) {
		const commit = this._pendingCommits?.get(key);
		if (!commit) return;
		this._pendingCommits.delete(key);
		this._commitsInFlight ||= new Set();
		const result = Promise.resolve().then(commit);
		this._commitsInFlight.add(result);
		result.then(() => this._commitsInFlight.delete(result), () => this._commitsInFlight.delete(result));
		return result;
	},
	async flushPendingCommits() {
		while (this._pendingCommits?.size || this._commitsInFlight?.size) {
			for (const key of this._pendingCommits?.keys() || []) this.runPendingCommit(key);
			await Promise.all(this._commitsInFlight || []);
		}
	}
};
