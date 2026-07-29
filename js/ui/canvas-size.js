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
			this.canvasSizeAnchorIndex = parseInt(cell.dataset.anchorIndex, 10);
			anchorGrid.querySelectorAll('.anchor-cell').forEach((el) => {
				const idx = parseInt(el.dataset.anchorIndex, 10);
				const selected = idx === this.canvasSizeAnchorIndex;
				el.classList.toggle('active', selected);
				el.setAttribute('aria-checked', selected ? 'true' : 'false');
				el.textContent = selected ? '•' : GlitterEditor.CANVAS_ANCHORS[idx].arrow;
			});
			this.updateCanvasResizePreview();
		});

		// Live on-canvas preview of the prospective bounds as the user edits.
		widthInput.addEventListener('input', () => {
			this.updateCanvasSizeValidation();
			this.updateCanvasResizePreview();
		});
		heightInput.addEventListener('input', () => {
			this.updateCanvasSizeValidation();
			this.updateCanvasResizePreview();
		});
		relativeInput?.addEventListener('change', () => {
			this.syncCanvasSizeInputs();
			this.updateCanvasResizePreview();
		});
		extensionMode?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-extension-mode]');
			if (button) this.setCanvasExtensionMode(button.dataset.extensionMode);
		});

		resetBtn?.addEventListener('click', () => {
			this.syncCanvasSizeInputs();
			this.hideCanvasResizePreview();
		});
		applyBtn.addEventListener('click', () => this.applyCanvasSize());

		// Keep the inputs showing the live canvas size whenever an image loads or
		// the panel could become visible.
		window.addEventListener('imageLoaded', () => {
			this.syncCanvasSizeInputs();
			this.syncCanvasExtensionControls();
		});
		this.setupDocumentSizeModeControls();
		this.syncCanvasSizeInputs();
		this.syncCanvasExtensionControls();
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
		const resolved = mode === 'canvas' ? 'canvas' : 'image';
		document.getElementById('scaleDesignPanel').hidden = resolved !== 'image';
		document.getElementById('canvasSizePanel').hidden = resolved !== 'canvas';
		document.querySelectorAll('#documentSizeMode [data-size-mode]').forEach((button) => {
			const active = button.dataset.sizeMode === resolved;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
		if (resolved === 'canvas') this.updateCanvasResizePreview();
		else this.hideCanvasResizePreview();
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
	}

,
	syncCanvasExtensionControls() {
		if (!this.originalImage) return;
		const presetColor = this.baseImageSource?.preset?.color;
		const backgroundColor = this.layers.find((layer) => layer.type === LayerType.BASE_IMAGE)?.background?.color;
		const colorInput = document.getElementById('canvasExtensionColor');
		if (colorInput) colorInput.value = presetColor || backgroundColor || '#ffffff';
		this.setCanvasExtensionMode(this.baseImageSource?.kind === 'preset' ? 'color' : 'transparent');
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

,
	setupScaleDesignControls() {
		const widthInput = document.getElementById('scaleDesignWidth');
		const heightInput = document.getElementById('scaleDesignHeight');
		const percentInput = document.getElementById('scaleDesignPercent');
		const presets = document.getElementById('scaleDesignPresets');
		const applyBtn = document.getElementById('scaleDesignApply');
		const resetBtn = document.getElementById('scaleDesignReset');
		if (!widthInput || !heightInput || !percentInput || !presets || !applyBtn) return;

		presets.replaceChildren(...CONFIG.canvas.scalePresets.map((percent) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'segmented-option';
			button.dataset.scalePercent = String(percent);
			button.textContent = `${percent}%`;
			return button;
		}));

		widthInput.addEventListener('input', () => this.updateScaleDesignFromDimension('width'));
		heightInput.addEventListener('input', () => this.updateScaleDesignFromDimension('height'));
		percentInput.addEventListener('input', () => this.updateScaleDesignFromPercent());
		presets.addEventListener('click', (event) => {
			const button = event.target.closest('[data-scale-percent]');
			if (!button) return;
			percentInput.value = button.dataset.scalePercent;
			this.updateScaleDesignFromPercent();
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
		this.updateScaleDesignPresetState(100);
		this.updateScaleDesignPresetAvailability();
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
		document.getElementById('scaleDesignPercent').value = this._formatScaleDesignPercent(scale * 100);
		this.updateScaleDesignPresetState(scale * 100);
		this.updateScaleDesignPresetAvailability();
	}

,
	updateScaleDesignPresetAvailability() {
		if (!this.originalImage) return;
		const maximum = Math.min(
			CONFIG.canvas.limits.maxWidth / this.originalCanvas.width,
			CONFIG.canvas.limits.maxHeight / this.originalCanvas.height
		) * 100;
		document.querySelectorAll('#scaleDesignPresets [data-scale-percent]').forEach((button) => {
			const unavailable = Number(button.dataset.scalePercent) > maximum + 0.01;
			button.disabled = unavailable;
			button.title = unavailable
				? `Maximum for this design is ${this._formatScaleDesignPercent(maximum)}% (${CONFIG.canvas.limits.maxWidth} × ${CONFIG.canvas.limits.maxHeight} px limit)`
				: '';
		});
	}

,
	updateScaleDesignPresetState(percent) {
		document.querySelectorAll('#scaleDesignPresets [data-scale-percent]').forEach((button) => {
			const active = Math.abs(Number(button.dataset.scalePercent) - percent) < 0.01;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
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
