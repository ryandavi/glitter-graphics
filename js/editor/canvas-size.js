const CANVAS_SIZE_CONTROL_METHODS = {
	get canvasBounds() { return this.documentSize?.bounds || null; },

	ensureCanvasBounds() {
		if (!this.documentSize.bounds) this.documentSize.bounds = new CanvasBounds(this, () => this.syncCanvasBoundsViews());
		return this.documentSize.bounds;
	},

	documentSizeDefaults() {
		return { operation: 'image', scale: { percent: 100, textures: true, effects: true }, anchor: 'center', relative: false, bounds: null };
	},

	setupCanvasSizeControls() {
		this.documentSize = this.documentSizeDefaults();
		const bind = (id, event, setter) => document.getElementById(id)?.addEventListener(event, (event) => setter(event.target));
		const grid = document.getElementById('canvasSizeAnchor');
		grid?.replaceChildren(...ANCHOR_POINTS.map((anchor) => {
			const button = document.createElement('button');
			button.type = 'button'; button.className = 'anchor-cell'; button.dataset.anchor = anchor.id;
			button.setAttribute('role', 'radio'); button.title = anchor.label;
			button.addEventListener('click', () => this.setCanvasAnchor(anchor.id));
			return button;
		}));
		['width', 'height'].forEach((axis) => {
			bind(`canvasSize${axis === 'width' ? 'Width' : 'Height'}`, 'input', (input) => this.setCanvasBoundsDimension(axis, input.value === '' ? NaN : Number(input.value)));
			bind(`scaleDesign${axis === 'width' ? 'Width' : 'Height'}`, 'input', (input) => this.setDocumentScale({ percent: Number(input.value) / this.originalCanvas[axis] * 100 }));
		});
		bind('canvasSizeRelative', 'change', (input) => this.setCanvasRelative(input.checked));
		bind('canvasBoundsSource', 'change', (input) => this.ensureCanvasBounds().setSource(input.value));
		bind('canvasBoundsRatio', 'change', (input) => this.setCanvasBoundsRatio(input.value));
		bind('artworkCropPadding', 'input', (input) => this.ensureCanvasBounds().setPadding(Number(input.value)));
		bind('canvasExtensionColor', 'input', (input) => this.ensureCanvasBounds().setExtension({ color: input.value }));
		['textures', 'effects'].forEach((key) => bind(`scaleDesign${key === 'textures' ? 'Textures' : 'Effects'}`, 'change', (input) => this.setDocumentScale({ [key]: input.checked })));
		document.getElementById('documentSizeMode')?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-size-mode]');
			if (button) this.setDocumentSizeMode(button.dataset.sizeMode);
		});
		document.getElementById('canvasExtensionMode')?.addEventListener('click', (event) => {
			const button = event.target.closest('[data-extension-mode]');
			if (button) this.ensureCanvasBounds().setExtension({ mode: button.dataset.extensionMode });
		});
		this._scaleDesignSlider = bindSlider(document.getElementById('scaleDesignPercent'), document.getElementById('scaleDesignPercentValue'), {
			suffix: '%', resetValue: FIELDS.documentScale.value, resetButton: document.getElementById('resetScaleDesignPercent'),
			apply: (percent) => this.setDocumentScale({ percent })
		});
		this.bindDocumentSizeReverts();
		window.addEventListener('imageLoaded', () => this.resetDocumentSize());
		this.syncCanvasBoundsViews();
	},

	bindDocumentSizeReverts() {
		const fields = {
			canvasSizeWidth: { read: () => this.canvasBounds?.rect.width || this.originalCanvas.width, default: () => this.originalCanvas.width, set: (value) => this.setCanvasBoundsDimension('width', value, false) },
			canvasSizeHeight: { read: () => this.canvasBounds?.rect.height || this.originalCanvas.height, default: () => this.originalCanvas.height, set: (value) => this.setCanvasBoundsDimension('height', value, false) },
			canvasSizeAnchor: { read: () => this.documentSize.anchor, default: () => 'center', set: (value) => this.setCanvasAnchor(value) },
			canvasSizeRelative: { read: () => this.documentSize.relative, default: () => false, set: (value) => this.setCanvasRelative(value) },
			canvasExtensionMode: { read: () => this.canvasBounds?.extension.mode || new CanvasBounds(this).defaults().extension.mode, default: () => new CanvasBounds(this).defaults().extension.mode, set: (value) => this.ensureCanvasBounds().setExtension({ mode: value }) },
			canvasExtensionColor: { read: () => this.canvasBounds?.extension.color || new CanvasBounds(this).defaults().extension.color, default: () => new CanvasBounds(this).defaults().extension.color, set: (value) => this.ensureCanvasBounds().setExtension({ color: value }) },
			scaleDesignWidth: { read: () => this.documentSize.scale.percent, default: () => 100, set: (percent) => this.setDocumentScale({ percent }) },
			scaleDesignHeight: { read: () => this.documentSize.scale.percent, default: () => 100, set: (percent) => this.setDocumentScale({ percent }) },
			scaleDesignTextures: { read: () => this.documentSize.scale.textures, default: () => true, set: (textures) => this.setDocumentScale({ textures }) },
			scaleDesignEffects: { read: () => this.documentSize.scale.effects, default: () => true, set: (effects) => this.setDocumentScale({ effects }) },
			artworkCropPadding: { read: () => this.canvasBounds?.padding || 0, default: () => 0, set: (value) => this.ensureCanvasBounds().setPadding(value) }
		};
		this._sizeReverts = [];
		document.querySelectorAll('#documentSizeGroup [data-revert-for]').forEach((button) => {
			const models = button.dataset.revertFor.split(/\s+/).map((id) => fields[id]).filter(Boolean);
			if (!models.length) return;
			const sync = attachOptionRevert(button.parentElement, null, { button, model: {
				isDefault: () => models.every((model) => model.read() === model.default()),
				reset: () => models.forEach((model) => model.set(model.default()))
			} });
			this._sizeReverts.push(sync);
		});
	},

	resetDocumentSize() {
		const operation = this.documentSize?.operation || 'image';
		this.documentSize = this.documentSizeDefaults();
		this.documentSize.operation = operation;
		if (this.currentTool === ToolType.CROP) this.setTool(ToolType.SELECT);
		const ratio = document.getElementById('canvasBoundsRatio');
		if (ratio) ratio.replaceChildren();
		this.syncCanvasBoundsViews();
	},
	setCanvasAnchor(anchor) {
		this.documentSize.anchor = anchor;
		const bounds = this.ensureCanvasBounds();
		const point = ANCHOR_POINTS.find((point) => point.id === anchor);
		bounds.setRect({ ...bounds.rect, x: (this.originalCanvas.width - bounds.rect.width) * point.fx, y: (this.originalCanvas.height - bounds.rect.height) * point.fy });
	},
	setCanvasRelative(relative) { this.documentSize.relative = relative; this.syncCanvasBoundsViews(); },
	setCanvasBoundsDimension(axis, value, relative = this.documentSize.relative) {
		const bounds = this.ensureCanvasBounds();
		const size = { width: bounds.rect.width, height: bounds.rect.height, [axis]: value + (relative ? this.originalCanvas[axis] : 0) };
		if (bounds.ratio) size[axis === 'width' ? 'height' : 'width'] = axis === 'width' ? size.width * bounds.ratio.h / bounds.ratio.w : size.height * bounds.ratio.w / bounds.ratio.h;
		bounds.setSize(size.width, size.height, ANCHOR_POINTS.find((point) => point.id === this.documentSize.anchor));
	},
	setCanvasBoundsRatio(id) {
		const option = getCanvasRatioOptions(this).find((option) => option.id === id);
		if (!option) return;
		const bounds = this.ensureCanvasBounds();
		if (option.width) { bounds.setRatio(null); bounds.setSize(option.width, option.height); }
		else bounds.setRatio(option.ratio);
	},
	setDocumentSizeMode(operation) {
		this.documentSize.operation = operation === 'canvas' ? 'canvas' : 'image';
		if (operation === 'canvas' && this.originalImage) this.ensureCanvasBounds();
		else {
			if (this.currentTool === ToolType.CROP) this.setTool(ToolType.SELECT);
			this.canvasBounds?.clear();
		}
		this.syncCanvasBoundsViews();
	},
	setDocumentScale(changes) {
		Object.assign(this.documentSize.scale, changes);
		if ('percent' in changes) this.documentSize.scale.percent = this.clampDocumentScale(changes.percent / 100) * 100;
		this.syncCanvasBoundsViews();
	},
	clampDocumentScale(scale) {
		const { width, height } = this.originalCanvas;
		return Math.max(Math.max(1 / width, 1 / height), Math.min(Math.min(CONFIG.canvas.limits.maxWidth / width, CONFIG.canvas.limits.maxHeight / height), scale));
	},
	applyScaleDesign() {
		if (!this.originalImage) return;
		const { percent, textures, effects } = this.documentSize.scale;
		const scale = percent / 100;
		const width = Math.round(this.originalCanvas.width * scale), height = Math.round(this.originalCanvas.height * scale);
		const result = validateCanvasSize(width, height);
		if (!result.ok) { this.showError(result.message); return; }
		this.scaleDocument(width, height, scale, { scaleTextures: textures, scaleEffects: effects });
	},
	applyCanvasBounds() {
		if (!this.canvasBounds) return;
		const result = this.canvasBounds.apply();
		if (!result.ok) this.showError(result.message);
		else if (this.currentTool === ToolType.CROP) this.setTool(ToolType.SELECT);
	},
	cancelCanvasBounds({ keepTool = false } = {}) {
		this.cropEdit.end();
		if (!keepTool && this.currentTool === ToolType.CROP) this.setTool(ToolType.SELECT);
		this.syncCanvasBoundsViews();
	},

	openCanvasBoundsMenu(triggerId, options, apply) {
		const trigger = document.getElementById(triggerId);
		let root = trigger.closest('.app-menu');
		if (!root) {
			root = document.createElement('div'); root.className = 'app-menu app-menu-popover';
			trigger.before(root); root.appendChild(trigger);
			const panel = document.createElement('div'); panel.className = 'app-menu-panel'; panel.hidden = true;
			root.appendChild(panel);
			root._popover = setupMenuPopover({ root, trigger, panel, fixed: true, bindTrigger: false });
		}
		const panel = root.querySelector('.app-menu-panel');
		panel.replaceChildren(...options.map((option) => {
			const button = document.createElement('button'); button.type = 'button'; button.className = 'app-menu-item'; button.textContent = option.label;
			button.addEventListener('click', () => apply(option.id)); return button;
		}));
		root._popover.open();
	},

	syncCanvasBoundsViews() {
		if (!this.documentSize) return;
		const { operation, scale, relative, anchor } = this.documentSize;
		const bounds = this.canvasBounds;
		const result = bounds?.validate();
		const rect = bounds?.rect || { width: this.originalCanvas.width, height: this.originalCanvas.height };
		['Width', 'Height'].forEach((axis) => {
			const node = document.getElementById(`canvasSize${axis}`);
			const size = this.originalCanvas[axis.toLowerCase()];
			if (node) { node.min = relative ? 1 - size : 1; node.max = CONFIG.canvas.limits[`max${axis}`] - (relative ? size : 0); }
		});
		const write = (id, value) => { const node = document.getElementById(id); if (node) node.value = Number.isNaN(value) ? '' : value; };
		const check = (id, value) => { const node = document.getElementById(id); if (node) node.checked = value; };
		write('canvasSizeWidth', rect.width - (relative ? this.originalCanvas.width : 0));
		write('canvasSizeHeight', rect.height - (relative ? this.originalCanvas.height : 0));
		write('canvasBoundsSource', bounds?.source || 'custom');
		write('artworkCropPadding', bounds?.padding || 0);
		check('canvasSizeRelative', relative);
		write('scaleDesignWidth', Math.round(this.originalCanvas.width * scale.percent / 100));
		write('scaleDesignHeight', Math.round(this.originalCanvas.height * scale.percent / 100));
		writeSliderValue(document.getElementById('scaleDesignPercent'), scale.percent);
		this._scaleDesignSlider?.updateDisplay(Math.round(scale.percent * 100) / 100);
		this._scaleDesignSlider?.syncResetButton(scale.percent);
		check('scaleDesignTextures', scale.textures); check('scaleDesignEffects', scale.effects);
		const summary = document.getElementById('noLayerSizeSummary'); if (summary) summary.textContent = operation === 'canvas' ? 'Canvas' : 'Image';
		document.querySelectorAll('#documentSizeGroup [data-size-modes]').forEach((node) => { node.hidden = !node.dataset.sizeModes.split(' ').includes(operation); });
		document.querySelectorAll('#documentSizeGroup [data-size-mode]').forEach((button) => {
			const active = button.dataset.sizeMode === operation; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
		});
		document.querySelectorAll('#canvasSizeAnchor [data-anchor]').forEach((button) => {
			const point = ANCHOR_POINTS.find((point) => point.id === button.dataset.anchor);
			const active = point.id === anchor; button.classList.toggle('active', active); button.setAttribute('aria-checked', String(active)); button.textContent = active ? '\u2022' : point.arrow;
		});
		const extension = bounds?.extension || new CanvasBounds(this).defaults().extension;
		write('canvasExtensionColor', extension.color);
		document.querySelectorAll('#canvasExtensionMode [data-extension-mode]').forEach((button) => {
			const active = button.dataset.extensionMode === extension.mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
		});
		const colorRow = document.getElementById('canvasExtensionColorRow'); if (colorRow) colorRow.hidden = extension.mode !== 'color';
		const paddingRow = document.getElementById('canvasBoundsPaddingRow'); if (paddingRow) paddingRow.hidden = bounds?.source === 'custom' || !bounds;
		const note = document.getElementById('canvasSizeLimitMessage'); if (note) note.textContent = result?.message || '';
		['canvasSizeApply', 'contextCropDone'].forEach((id) => { const node = document.getElementById(id); if (node) node.disabled = !bounds || !result?.ok; });
		if (this.originalImage) {
			const ratio = document.getElementById('canvasBoundsRatio');
			if (ratio) {
				const options = getCanvasRatioOptions(this);
				if (Array.from(ratio.options, (option) => option.value).join('|') !== options.map((option) => option.id).join('|')) ratio.replaceChildren(...options.map((option) => new Option(option.label, option.id)));
				ratio.value = bounds?.ratio ? options.find((option) => option.ratio && option.ratio.w / option.ratio.h === bounds.ratio.w / bounds.ratio.h).id : 'free';
			}
		}
		this._sizeReverts?.forEach((sync) => sync?.());
		this.cropEdit?.render();
	}
};
