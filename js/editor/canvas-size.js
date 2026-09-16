const CANVAS_SIZE_CONTROL_METHODS = {
get CANVAS_ANCHORS() {
		return [
			{ fx: 0,   fy: 0,   arrow: '↖' }, { fx: 0.5, fy: 0,   arrow: '↑' }, { fx: 1, fy: 0,   arrow: '↗' },
			{ fx: 0,   fy: 0.5, arrow: '←' }, { fx: 0.5, fy: 0.5, arrow: '•' }, { fx: 1, fy: 0.5, arrow: '→' },
			{ fx: 0,   fy: 1,   arrow: '↙' }, { fx: 0.5, fy: 1,   arrow: '↓' }, { fx: 1, fy: 1,   arrow: '↘' }
		];
	}

,
	setupCanvasSizeControls() {
		const anchorGrid = document.getElementById('canvasSizeAnchor');
		const widthInput = document.getElementById('canvasSizeWidth');
		const heightInput = document.getElementById('canvasSizeHeight');
		const relativeInput = document.getElementById('canvasSizeRelative');
		const extensionMode = document.getElementById('canvasExtensionMode');
		const applyBtn = document.getElementById('canvasSizeApply');
		const resetBtn = document.getElementById('canvasSizeReset');
		const artworkPaddingInput = document.getElementById('artworkCropPadding');
		const artworkCropApplyBtn = document.getElementById('artworkCropApply');
		const artworkCropResetBtn = document.getElementById('artworkCropReset');
		if (!anchorGrid || !widthInput || !heightInput || !applyBtn) return;

		// Center anchor by default.
		this.canvasSizeAnchorIndex = 4;

		anchorGrid.innerHTML = '';
		GlitterEditor.CANVAS_ANCHORS.forEach((anchor, index) => {
			const cell = document.createElement('button');
			cell.type = 'button';
			cell.className = 'anchor-cell';
			cell.dataset.anchorIndex = String(index);
			cell.setAttribute('role', 'radio');
			cell.textContent = index === this.canvasSizeAnchorIndex ? '•' : anchor.arrow;
			cell.classList.toggle('active', index === this.canvasSizeAnchorIndex);
			cell.setAttribute('aria-checked', index === this.canvasSizeAnchorIndex ? 'true' : 'false');
			anchorGrid.appendChild(cell);
		});

		anchorGrid.addEventListener('click', (event) => {
			const cell = event.target.closest('.anchor-cell');
			if (!cell) return;
			this.setCanvasAnchorIndex(parseInt(cell.dataset.anchorIndex, 10));
		});

		// Live on-canvas preview of the prospective bounds as the user edits.
		widthInput.addEventListener('input', () => {
			this.updateCanvasSizeValidation();
			this.updateCanvasResizePreview();
			this.syncDocumentSizeReverts();
		});
		heightInput.addEventListener('input', () => {
			this.updateCanvasSizeValidation();
			this.updateCanvasResizePreview();
			this.syncDocumentSizeReverts();
		});
		relativeInput?.addEventListener('change', () => {
			this.syncCanvasSizeInputs();
			this.updateCanvasResizePreview();
		});
		extensionMode?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-extension-mode]');
			if (button) this.setCanvasExtensionMode(button.dataset.extensionMode);
		});
		// One delegated handler for every per-field revert in the document-size
		// form (data-revert-for = one or more input ids, or the anchor/extension
		// pseudo-fields). Bound to the group node so it survives the node being
		// relocated between the no-selection panel and Canvas Properties.
		document.getElementById('documentSizeGroup')?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-revert-for]');
			if (!button || button.disabled) return;
			event.preventDefault();
			this.handleDocumentSizeRevert(button);
		});

		resetBtn?.addEventListener('click', () => {
			this.syncCanvasSizeInputs();
			this.hideCanvasResizePreview();
		});
		applyBtn.addEventListener('click', () => this.applyCanvasSize());

		artworkPaddingInput?.addEventListener('input', () => {
			this.updateArtworkCropSummary();
			this.syncDocumentSizeReverts();
		});
		artworkCropResetBtn?.addEventListener('click', () => {
			if (artworkPaddingInput) {
				artworkPaddingInput.value = '0';
				artworkPaddingInput.dispatchEvent(new Event('input', { bubbles: true }));
			}
		});
		artworkCropApplyBtn?.addEventListener('click', () => this.cropCanvasToArtwork());

		// Keep the inputs showing the live canvas size whenever an image loads or
		// the panel could become visible.
		window.addEventListener('imageLoaded', () => {
			this.syncCanvasSizeInputs();
			this.syncCanvasExtensionControls();
			this.updateArtworkCropSummary();
		});
		this.setupDocumentSizeModeControls();
		this.syncCanvasSizeInputs();
		this.syncCanvasExtensionControls();
	}

,
	setCanvasAnchorIndex(index) {
		this.canvasSizeAnchorIndex = Number.isFinite(index) ? index : 4;
		const anchorGrid = document.getElementById('canvasSizeAnchor');
		anchorGrid?.querySelectorAll('.anchor-cell').forEach((el) => {
			const idx = parseInt(el.dataset.anchorIndex, 10);
			const selected = idx === this.canvasSizeAnchorIndex;
			el.classList.toggle('active', selected);
			el.setAttribute('aria-checked', selected ? 'true' : 'false');
			el.textContent = selected ? '•' : GlitterEditor.CANVAS_ANCHORS[idx].arrow;
		});
		this.updateCanvasResizePreview();
		this.syncDocumentSizeReverts();
	}

	// Live defaults for the document-size per-field reverts. Width/Height track
	// the current canvas, so the revert means "back to the unedited state" —
	// the panel's Reset button, scoped to one field. (Scale and the extension
	// Fill Color own their own reverts: bindSlider / attachOptionRevert.)
,
	_documentSizeDefaults() {
		const canvas = this.originalCanvas;
		const relative = document.getElementById('canvasSizeRelative')?.checked === true;
		const width = canvas?.width ?? 0;
		const height = canvas?.height ?? 0;
		return {
			canvasSizeWidth: relative ? 0 : width,
			canvasSizeHeight: relative ? 0 : height,
			canvasSizeRelative: false,
			canvasExtensionMode: this.baseImageSource?.kind === 'preset' ? 'color' : 'transparent',
			scaleDesignWidth: width,
			scaleDesignHeight: height,
			scaleDesignTextures: true,
			scaleDesignEffects: true,
			artworkCropPadding: 0
		};
	}

,
	_documentSizeFieldIsDefault(id, defaults) {
		if (id === 'canvasSizeAnchor') return this.canvasSizeAnchorIndex === 4;
		if (id === 'canvasExtensionMode') return (this.canvasExtensionMode || 'transparent') === defaults.canvasExtensionMode;
		const el = document.getElementById(id);
		if (!el || !(id in defaults)) return true;
		if (el.type === 'checkbox') return el.checked === defaults[id];
		return Number(el.value) === Number(defaults[id]);
	}

,
	syncDocumentSizeReverts() {
		const group = document.getElementById('documentSizeGroup');
		if (!group) return;
		const defaults = this._documentSizeDefaults();
		group.querySelectorAll('[data-revert-for]').forEach((button) => {
			const targets = button.dataset.revertFor.split(/\s+/).filter(Boolean);
			button.disabled = targets.every((id) => this._documentSizeFieldIsDefault(id, defaults));
		});
	}

,
	handleDocumentSizeRevert(button) {
		const defaults = this._documentSizeDefaults();
		button.dataset.revertFor.split(/\s+/).filter(Boolean).forEach((id) => {
			if (id === 'canvasSizeAnchor') { this.setCanvasAnchorIndex(4); return; }
			if (id === 'canvasExtensionMode') { this.setCanvasExtensionMode(defaults.canvasExtensionMode); return; }
			const el = document.getElementById(id);
			if (!el || !(id in defaults)) return;
			if (el.type === 'checkbox') {
				el.checked = Boolean(defaults[id]);
				el.dispatchEvent(new Event('change', { bubbles: true }));
			} else {
				el.value = String(defaults[id]);
				el.dispatchEvent(new Event('input', { bubbles: true }));
				el.dispatchEvent(new Event('change', { bubbles: true }));
			}
		});
		this.syncDocumentSizeReverts();
	}

,
	setupDocumentSizeModeControls() {
		const control = document.getElementById('documentSizeMode');
		if (!control) return;
		control.addEventListener('click', (event) => {
			const button = event.target.closest('[data-size-mode]');
			if (button) this.setDocumentSizeMode(button.dataset.sizeMode);
		});
		this.setDocumentSizeMode('image');
	}

,
	setDocumentSizeMode(mode) {
		const resolved = ['canvas', 'artwork'].includes(mode) ? mode : 'image';
		const sizeSummary = document.getElementById('noLayerSizeSummary');
		if (sizeSummary) {
			sizeSummary.textContent = resolved === 'canvas' ? 'Canvas' : resolved === 'artwork' ? 'Artwork' : 'Image';
		}
		// A note's `data-size-mode-note` is one mode, or several space-separated
		// (the shared extension-fill block applies to both Canvas Size and
		// Artwork, since both can grow the canvas beyond its current bounds).
		document.querySelectorAll('#documentSizeGroup [data-size-mode-note]').forEach((note) => {
			note.hidden = !note.dataset.sizeModeNote.split(/\s+/).includes(resolved);
		});
		document.getElementById('scaleDesignPanel').hidden = resolved !== 'image';
		document.getElementById('canvasSizePanel').hidden = resolved !== 'canvas';
		document.getElementById('artworkCropPanel').hidden = resolved !== 'artwork';
		document.getElementById('scaleDesignActions')?.toggleAttribute('hidden', resolved !== 'image');
		document.getElementById('canvasSizeActions')?.toggleAttribute('hidden', resolved !== 'canvas');
		document.getElementById('artworkCropActions')?.toggleAttribute('hidden', resolved !== 'artwork');
		document.querySelectorAll('#documentSizeMode [data-size-mode]').forEach((button) => {
			const active = button.dataset.sizeMode === resolved;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
		if (resolved === 'canvas') this.updateCanvasResizePreview();
		else this.hideCanvasResizePreview();
		if (resolved === 'artwork') this.updateArtworkCropSummary();
		this.syncDocumentSizeReverts();
	}

,
	setCanvasExtensionMode(mode) {
		this.canvasExtensionMode = mode === 'color' ? 'color' : 'transparent';
		document.querySelectorAll('#canvasExtensionMode [data-extension-mode]').forEach((button) => {
			const active = button.dataset.extensionMode === this.canvasExtensionMode;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
		document.getElementById('canvasExtensionColorRow').hidden = this.canvasExtensionMode !== 'color';
		this.syncDocumentSizeReverts();
	}

,
	syncCanvasExtensionControls() {
		if (!this.originalImage) return;
		const presetColor = this.baseImageSource?.preset?.color;
		const backgroundColor = this.layers.find((layer) => layer.type === LayerType.BASE_IMAGE)?.background?.color;
		const colorInput = document.getElementById('canvasExtensionColor');
		if (colorInput) {
			colorInput.value = presetColor || backgroundColor || '#ffffff';
			// Let the shared attachOptionRevert re-evaluate its button state.
			colorInput.dispatchEvent(new Event('input', { bubbles: true }));
		}
		this.setCanvasExtensionMode(this.baseImageSource?.kind === 'preset' ? 'color' : 'transparent');
		this.syncDocumentSizeReverts();
	}

,
	syncCanvasSizeInputs() {
		const widthInput = document.getElementById('canvasSizeWidth');
		const heightInput = document.getElementById('canvasSizeHeight');
		if (!widthInput || !heightInput || !this.originalImage) return;
		const relative = document.getElementById('canvasSizeRelative')?.checked === true;
		widthInput.value = relative ? 0 : this.originalCanvas.width;
		heightInput.value = relative ? 0 : this.originalCanvas.height;
		widthInput.min = relative ? String(1 - this.originalCanvas.width) : '1';
		heightInput.min = relative ? String(1 - this.originalCanvas.height) : '1';
		widthInput.max = relative
			? String(CONFIG.canvas.limits.maxWidth - this.originalCanvas.width)
			: String(CONFIG.canvas.limits.maxWidth);
		heightInput.max = relative
			? String(CONFIG.canvas.limits.maxHeight - this.originalCanvas.height)
			: String(CONFIG.canvas.limits.maxHeight);
		this.updateCanvasSizeValidation();
		this.syncDocumentSizeReverts();
	}

,
	getRequestedCanvasSize() {
		const width = Number(document.getElementById('canvasSizeWidth')?.value);
		const height = Number(document.getElementById('canvasSizeHeight')?.value);
		if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
		const relative = document.getElementById('canvasSizeRelative')?.checked === true;
		return {
			width: Math.round(relative ? this.originalCanvas.width + width : width),
			height: Math.round(relative ? this.originalCanvas.height + height : height)
		};
	}

,
	updateCanvasSizeValidation() {
		const message = document.getElementById('canvasSizeLimitMessage');
		const widthInput = document.getElementById('canvasSizeWidth');
		const heightInput = document.getElementById('canvasSizeHeight');
		if (!message || !widthInput || !heightInput || !this.originalImage) return false;

		const requested = this.getRequestedCanvasSize();
		let error = '';
		if (!requested) {
			error = 'Enter valid width and height values.';
		} else if (requested.width < 1 || requested.height < 1) {
			error = `Canvas dimensions must be at least 1 × 1 px. Requested ${requested.width} × ${requested.height} px.`;
		} else if (requested.width > CONFIG.canvas.limits.maxWidth || requested.height > CONFIG.canvas.limits.maxHeight) {
			error = `Maximum canvas size is ${CONFIG.canvas.limits.maxWidth} × ${CONFIG.canvas.limits.maxHeight} px. Requested ${requested.width} × ${requested.height} px.`;
		}

		message.textContent = error || `Maximum canvas size: ${CONFIG.canvas.limits.maxWidth} × ${CONFIG.canvas.limits.maxHeight} px.`;
		message.classList.toggle('is-error', Boolean(error));
		widthInput.setAttribute('aria-invalid', String(Boolean(error)));
		heightInput.setAttribute('aria-invalid', String(Boolean(error)));
		return !error;
	}

,
	applyCanvasSize() {
		if (!this.originalImage) return;
		const requested = this.getRequestedCanvasSize();
		if (!requested || !this.updateCanvasSizeValidation()) return;

		const newWidth = requested.width;
		const newHeight = requested.height;

		const anchor = GlitterEditor.CANVAS_ANCHORS[this.canvasSizeAnchorIndex] || GlitterEditor.CANVAS_ANCHORS[4];
		const offsetX = Math.round((newWidth - this.originalCanvas.width) * anchor.fx);
		const offsetY = Math.round((newHeight - this.originalCanvas.height) * anchor.fy);

		const extensionColor = this.canvasExtensionMode === 'color'
			? document.getElementById('canvasExtensionColor')?.value || '#ffffff'
			: null;
		this.resizeCanvas(newWidth, newHeight, offsetX, offsetY, { extensionColor });
		this.syncCanvasSizeInputs();
	}

	// The Artwork mode's target rect: the artwork bounds (getArtworkBounds,
	// canvas-resize.js) grown by the Padding field on every side. Shared by the
	// live summary and the apply action so they can never disagree.
,
	getArtworkCropTarget() {
		const bounds = this.getArtworkBounds();
		if (!bounds) return null;
		const padding = Math.max(0, Math.round(Number(document.getElementById('artworkCropPadding')?.value) || 0));
		return {
			bounds,
			padding,
			minX: bounds.minX - padding,
			minY: bounds.minY - padding,
			width: bounds.width + padding * 2,
			height: bounds.height + padding * 2
		};
	}

,
	updateArtworkCropSummary() {
		const host = document.getElementById('artworkCropSummary');
		if (!host) return;
		const target = this.getArtworkCropTarget();
		if (!target) {
			host.textContent = 'Nothing to crop to — canvas has no artwork.';
			host.classList.remove('is-error');
			return;
		}
		const { bounds, padding, width, height } = target;
		const overLimit = width > CONFIG.canvas.limits.maxWidth || height > CONFIG.canvas.limits.maxHeight;
		host.textContent = padding > 0
			? `Artwork is ${bounds.width} × ${bounds.height} px. With ${padding}px padding, the canvas becomes ${width} × ${height} px.`
			: `Artwork is ${bounds.width} × ${bounds.height} px.`;
		if (overLimit) {
			host.textContent += ` Exceeds the ${CONFIG.canvas.limits.maxWidth} × ${CONFIG.canvas.limits.maxHeight} px canvas limit.`;
		}
		host.classList.toggle('is-error', overLimit);
	}

	// Resize the canvas down (or up) to exactly enclose the current artwork,
	// plus any Padding. Reuses resizeCanvas, so this gets the same undoable
	// history checkpoint as every other canvas-size change — no separate
	// confirmation dialog needed — and the same extension-fill choice
	// (canvasExtensionMode/canvasExtensionColor) Canvas Size mode uses for the
	// margins padding adds beyond the old canvas edges.
,
	cropCanvasToArtwork() {
		if (!this.originalImage) return;
		const target = this.getArtworkCropTarget();
		if (!target) {
			this.updateStatus('Nothing to crop to — canvas has no artwork.');
			return;
		}
		const { minX, minY, width, height } = target;
		if (width > CONFIG.canvas.limits.maxWidth || height > CONFIG.canvas.limits.maxHeight) return;
		if (minX === 0 && minY === 0 && width === this.originalCanvas.width && height === this.originalCanvas.height) {
			this.updateStatus('Canvas already matches the artwork bounds.');
			return;
		}
		const extensionColor = this.canvasExtensionMode === 'color'
			? document.getElementById('canvasExtensionColor')?.value || '#ffffff'
			: null;
		this.resizeCanvas(width, height, -minX, -minY, { extensionColor });
		this.syncCanvasSizeInputs();
		this.updateArtworkCropSummary();
	}

,
	setupScaleDesignControls() {
		const widthInput = document.getElementById('scaleDesignWidth');
		const heightInput = document.getElementById('scaleDesignHeight');
		const percentInput = document.getElementById('scaleDesignPercent');
		const applyBtn = document.getElementById('scaleDesignApply');
		const resetBtn = document.getElementById('scaleDesignReset');
		if (!widthInput || !heightInput || !percentInput || !applyBtn) return;

		widthInput.addEventListener('input', () => this.updateScaleDesignFromDimension('width'));
		heightInput.addEventListener('input', () => this.updateScaleDesignFromDimension('height'));
		// Scale is a slider + editable readout, wired like every other panel
		// slider (textureScale, opacity, …) — bindSlider owns its value pill and
		// its reset button.
		this._scaleDesignSlider = bindSlider(percentInput, document.getElementById('scaleDesignPercentValue'), {
			suffix: '%',
			resetValue: 100,
			resetButton: document.getElementById('resetScaleDesignPercent'),
			apply: () => this.updateScaleDesignFromPercent()
		});
		['scaleDesignTextures', 'scaleDesignEffects'].forEach((id) => {
			document.getElementById(id)?.addEventListener('change', () => this.syncDocumentSizeReverts());
		});
		resetBtn?.addEventListener('click', () => this.syncScaleDesignInputs());
		applyBtn.addEventListener('click', () => this.applyScaleDesign());
		window.addEventListener('imageLoaded', () => this.syncScaleDesignInputs());
		this.syncScaleDesignInputs();
	}

,
	_formatScaleDesignPercent(percent) {
		return String(Math.round(percent * 100) / 100);
	}

,
	syncScaleDesignInputs() {
		const widthInput = document.getElementById('scaleDesignWidth');
		const heightInput = document.getElementById('scaleDesignHeight');
		const percentInput = document.getElementById('scaleDesignPercent');
		if (!widthInput || !heightInput || !percentInput || !this.originalImage) return;
		widthInput.value = this.originalCanvas.width;
		heightInput.value = this.originalCanvas.height;
		widthInput.max = String(CONFIG.canvas.limits.maxWidth);
		heightInput.max = String(CONFIG.canvas.limits.maxHeight);
		percentInput.max = this._formatScaleDesignPercent(Math.min(
			CONFIG.canvas.limits.maxWidth / this.originalCanvas.width,
			CONFIG.canvas.limits.maxHeight / this.originalCanvas.height
		) * 100);
		percentInput.value = '100';
		this._scaleDesignSlider?.updateDisplay(100);
		this._scaleDesignSlider?.syncResetButton(100);
		this.syncDocumentSizeReverts();
	}

,
	updateScaleDesignFromDimension(axis) {
		if (!this.originalImage) return;
		const input = document.getElementById(axis === 'width' ? 'scaleDesignWidth' : 'scaleDesignHeight');
		const value = Number(input?.value);
		if (!Number.isFinite(value) || value <= 0) return;
		const original = axis === 'width' ? this.originalCanvas.width : this.originalCanvas.height;
		this.updateScaleDesignFields(value / original * 100);
	}

,
	updateScaleDesignFromPercent() {
		const percent = Number(document.getElementById('scaleDesignPercent')?.value);
		if (!Number.isFinite(percent) || percent <= 0) return;
		this.updateScaleDesignFields(percent);
	}

,
	updateScaleDesignFields(percent) {
		if (!this.originalImage) return;
		const scale = this.clampDocumentScale(percent / 100);
		const width = Math.max(1, Math.round(this.originalCanvas.width * scale));
		const height = Math.max(1, Math.round(this.originalCanvas.height * scale));
		document.getElementById('scaleDesignWidth').value = width;
		document.getElementById('scaleDesignHeight').value = height;
		const pct = Math.round(scale * 100);
		document.getElementById('scaleDesignPercent').value = String(pct);
		this._scaleDesignSlider?.updateDisplay(pct);
		this._scaleDesignSlider?.syncResetButton(pct);
		this.syncDocumentSizeReverts();
	}

,
	clampDocumentScale(scale) {
		const width = this.originalCanvas.width;
		const height = this.originalCanvas.height;
		const minimum = Math.max(1 / width, 1 / height);
		const maximum = Math.min(CONFIG.canvas.limits.maxWidth / width, CONFIG.canvas.limits.maxHeight / height);
		return Math.max(minimum, Math.min(maximum, scale));
	}

,
	applyScaleDesign() {
		if (!this.originalImage) return;
		const enteredPercent = Number(document.getElementById('scaleDesignPercent')?.value);
		if (!Number.isFinite(enteredPercent) || enteredPercent <= 0) {
			this.syncScaleDesignInputs();
			return;
		}
		const scale = this.clampDocumentScale(enteredPercent / 100);
		const newWidth = Math.max(1, Math.round(this.originalCanvas.width * scale));
		const newHeight = Math.max(1, Math.round(this.originalCanvas.height * scale));
		this.scaleDocument(newWidth, newHeight, scale, {
			scaleTextures: document.getElementById('scaleDesignTextures')?.checked !== false,
			scaleEffects: document.getElementById('scaleDesignEffects')?.checked !== false
		});
	}
};
