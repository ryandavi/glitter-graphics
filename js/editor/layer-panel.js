const LAYER_PANEL_METHODS = {
setupLayerTypePickerListeners() {
		const optionsContainer = document.querySelector('#layerTypePickerModal .layer-type-options');
		if (!optionsContainer) return;

		this.renderAddMenu(optionsContainer);

		optionsContainer.addEventListener('click', async (event) => {
			const button = event.target.closest('.layer-type-option');
			if (!button) return;

			this.modalManager.close('layerTypePickerModal');
			if (button.dataset.addKind === 'command') {
				const command = ADD_MENU_COMMANDS.find((entry) => entry.id === button.dataset.addId);
				requestAnimationFrame(() => command?.run(this));
				return;
			}
			if (button.dataset.addKind === 'template') {
				requestAnimationFrame(() => this.templateManager?.previewOverlay(button.dataset.addId));
				return;
			}
			requestAnimationFrame(() => {
				this.createLayerByType(button.dataset.layerType, button._createOptions);
			});
		});
	}

,
	createAddMenuButton(entry) {
		const button = tplClone('tpl-layer-type-option');
		button.classList.add('is-horizontal');
		button.dataset.addKind = entry.kind;
		button.dataset.addId = entry.id;
		if (entry.type) button.dataset.layerType = entry.type;
		button.querySelector('.layer-type-icon').classList.add('xl');
		button.querySelector('use').setAttribute('href', `#icon-${entry.icon}`);
		button.querySelector('.layer-type-name').textContent = entry.label;
		button.querySelector('.layer-type-description').textContent = entry.description;
		button._createOptions = entry.createOptions || null;
		return button;
	}

,
	async renderAddMenu(container) {
		const staticEntries = getAddMenuEntries();
		let templateEntries = [];
		try {
			templateEntries = (await TemplateLibrary.list('overlay')).map((template, index) => ({
				kind: 'template',
				id: template.id,
				group: 'generate',
				order: 10 + index,
				label: template.label,
				icon: template.icon || 'image',
				description: template.description
			}));
		} catch (error) {
			console.warn('Templates unavailable:', error);
		}
		const entries = [...staticEntries, ...templateEntries];
		container.replaceChildren();
		container.classList.add('add-menu-groups');
		ADD_MENU_GROUPS.forEach((group) => {
			const groupEntries = entries.filter((entry) => entry.group === group.id);
			if (!groupEntries.length) return;
			const section = document.createElement('section');
			section.className = 'add-menu-group';
			const title = document.createElement('h3');
			title.className = 'add-menu-group-title';
			title.textContent = group.label;
			const grid = document.createElement('div');
			grid.className = 'layer-type-options';
			groupEntries.forEach((entry) => grid.appendChild(this.createAddMenuButton(entry)));
			section.append(title, grid);
			container.appendChild(section);
		});
	}

,
	createLayerByType(layerType, createOptions = null) {
		if (!LAYER_UI_CONFIG[layerType]?.addableViaModal) {
			dbg(`Unknown add-layer type: ${layerType}`);
			return;
		}

		const layer = layerType === LayerType.TEXT_GLITTER
			? createTextAt(this, createOptions?.textLayer || {})
			: this.layerManager.addLayer(layerType, createOptions || {});
		if (layer && createOptions?.shapeLayer?.openImagePicker) {
			requestAnimationFrame(() => this.shapeGlitterManager?.chooseFillImage());
		}
	}

,
	createLayerTypeOptionButton(type, { iconSizeClass = 'xl', id = null, entry = null } = {}) {
		const modalConfig = LAYER_UI_CONFIG[type]?.addableViaModal;
		if (!modalConfig) return null;

		const button = tplClone('tpl-layer-type-option');
		button.dataset.layerType = type;
		if (id) {
			button.id = id;
		}
		button.querySelector('.layer-type-icon').classList.add(iconSizeClass);
		button.querySelector('use').setAttribute('href', `#icon-${entry?.icon || modalConfig.icon}`);
		button.querySelector('.layer-type-name').textContent = entry?.label || modalConfig.label;
		button.querySelector('.layer-type-description').textContent = entry?.description || modalConfig.description;
		button._createOptions = entry?.createOptions || null;
		return button;
	}

,
	renderLayerTypePickerOptions(container, options = {}) {
		container.innerHTML = '';
		const iconSizeClass = options.iconSizeClass || 'xl';
		if (options.entries) {
			options.entries.forEach((entry) => {
				const button = this.createLayerTypeOptionButton(entry.type, { iconSizeClass, id: entry.id, entry });
				if (button) container.appendChild(button);
			});
			return;
		}
		const idMap = options.idMap || {};
		const layerTypes = options.layerTypes || getAddableLayerTypes();

		layerTypes.forEach((type) => {
			const id = idMap[type] || null;
			const button = this.createLayerTypeOptionButton(type, { iconSizeClass, id });
			if (button) {
				container.appendChild(button);
			}
		});
	}

,
	setupStickerUploadModalListeners() {
		// Note: Modal open/close is handled by ModalManager
		// uploadStickerBtn opens the modal via ModalManager.register()

		const dropzone = document.getElementById('stickerUploadDropzone');
		const input = document.getElementById('stickerUploadInput');

		const uploadAndUse = async (files) => {
			const library = this.assetUploadLibrary || this.stickerLibrary;
			for (const file of files) {
				const item = await library.handleUserUpload(file);
				if (item && !item.error && this.originalImage) await library.handleItemClick(item);
			}
			this.modalManager.close('stickerUploadModal');
		};

		// Dropzone click
		if (dropzone && input) {
			dropzone.addEventListener('click', () => {
				input.click();
			});
		}

		// File selection
		if (input) {
			input.addEventListener('change', async (e) => {
				const files = [...e.target.files];
				input.value = '';
				if (files.length) await uploadAndUse(files);
			});
		}

		// Drag and drop
		if (dropzone) {
			dropzone.addEventListener('dragover', (e) => {
				e.preventDefault();
				dropzone.classList.add('drag-over');
			});

			dropzone.addEventListener('dragleave', () => {
				dropzone.classList.remove('drag-over');
			});

			dropzone.addEventListener('drop', async (e) => {
				e.preventDefault();
				dropzone.classList.remove('drag-over');

				const files = [...e.dataTransfer.files];
				if (files.length) await uploadAndUse(files);
			});
		}
	}

,
	getMultiSelectionLayerOpacity(layer) {
		if (!layer || layer.type === LayerType.BASE_IMAGE) return null;
		// v2 opacity model: one canonical whole-layer opacity for every type.
		return Number.isFinite(layer.opacity) ? layer.opacity : 100;
	}

,
	setMultiSelectionLayerOpacity(layer, value) {
		if (!layer || layer.type === LayerType.BASE_IMAGE) return;
		layer.opacity = value;
	}

,
	syncMultiSelectionOpacity(layers = []) {
		const input = document.getElementById('multiSelectionOpacity');
		const value = document.getElementById('multiSelectionOpacityValue');
		const reset = document.getElementById('resetMultiSelectionOpacity');
		if (!input || !value || !reset) return;
		const opacities = layers.map((layer) => this.getMultiSelectionLayerOpacity(layer)).filter(Number.isFinite);
		const editable = opacities.length === layers.length
			&& layers.every((layer) => layer.type !== LayerType.BASE_IMAGE && !isLayerFullyLocked(layer));
		const mixed = opacities.some((opacity) => opacity !== opacities[0]);
		input.value = mixed ? 100 : (opacities[0] ?? 100);
		value.textContent = mixed ? 'Mixed' : `${input.value}%`;
		input.disabled = !editable;
		reset.disabled = !editable || (!mixed && Number(input.value) === 100);
	}

,
	setupLayerPanelListeners() {
		// Add layer buttons - open layer type picker
		['addLayerBtn', 'mobileAddLayerBtn'].forEach((id) => {
			const addLayerBtn = document.getElementById(id);
			if (addLayerBtn) addLayerBtn.addEventListener('click', () => {
				this.modalManager.open('layerTypePickerModal');
			});
		});

		const quickAddOptions = document.getElementById('quickAddOptions');
		if (quickAddOptions) {
			const quickAddEntries = getQuickAddLayerEntries();
			this.renderLayerTypePickerOptions(quickAddOptions, {
				iconSizeClass: '',
				entries: quickAddEntries
			});

			quickAddOptions.addEventListener('click', (event) => {
				const button = event.target.closest('.layer-type-option');
				if (!button) return;
				this.createLayerByType(button.dataset.layerType, button._createOptions);
			});
		}

		// Bottom bar quick-add buttons - create layers directly
		const layersBarAddGlitter = document.getElementById('layersBarAddGlitter');
		const layersBarAddSticker = document.getElementById('layersBarAddSticker');
		const layersBarAddText = document.getElementById('layersBarAddText');

		if (layersBarAddGlitter) {
			layersBarAddGlitter.addEventListener('click', () => {
				this.createLayerByType(LayerType.GLITTER_FILL);
			});
		}

		if (layersBarAddSticker) {
			layersBarAddSticker.addEventListener('click', () => {
				this.createLayerByType(LayerType.STICKER);
			});
		}

		if (layersBarAddText) {
			layersBarAddText.addEventListener('click', () => {
				this.createLayerByType(LayerType.TEXT_GLITTER);
			});
		}

		// Bottom bar action buttons
		const layersBarGoToSelected = document.getElementById('layersBarGoToSelected');
		const layersBarCloneSelected = document.getElementById('layersBarCloneSelected');
		const layersBarDeleteSelected = document.getElementById('layersBarDeleteSelected');
		const layersBarClearAll = document.getElementById('layersBarClearAll');

		if (layersBarGoToSelected) {
			layersBarGoToSelected.addEventListener('click', () => {
				const selectedLayer = this.layerManager.getActiveLayer();
				if (!selectedLayer || selectedLayer.type === LayerType.BASE_IMAGE) return;
				this.layerManager.goToLayerSource(selectedLayer.id);
			});
		}

		if (layersBarCloneSelected) {
			layersBarCloneSelected.addEventListener('click', () => {
				this.cloneSelectedLayers();
			});
		}

		if (layersBarDeleteSelected) {
			layersBarDeleteSelected.addEventListener('click', async () => {
				await this.deleteSelectedLayers();
			});
		}
		layersBarClearAll?.addEventListener('click', () => this.resetAll());

		const multiDuplicateBtn = document.getElementById('multiSelectionDuplicateBtn');
		const multiDeleteBtn = document.getElementById('multiSelectionDeleteBtn');
		const multiOpacity = document.getElementById('multiSelectionOpacity');
		this.multiSelectionAlignScope = 'selection';

		const applyMultiOpacity = (commit = false) => {
			const layers = this.layerManager.getSelectedLayers();
			if (layers.length < 2 || multiOpacity?.disabled) return;
			const opacity = Number(multiOpacity.value);
			layers.forEach((layer) => this.setMultiSelectionLayerOpacity(layer, opacity));
			this.syncMultiSelectionOpacity(layers);
			this.requestPreviewUpdate();
			if (commit) this.saveState('Change selected layer opacity');
		};
		multiOpacity?.addEventListener('input', () => applyMultiOpacity(false));
		multiOpacity?.addEventListener('change', () => applyMultiOpacity(true));
		// The reset button (#resetMultiSelectionOpacity, stamped by buildSliderRow)
		// is driven by the shared property-revert handler — it writes the slider
		// default and fires input/change, which the listeners above pick up.

		if (multiDuplicateBtn) {
			multiDuplicateBtn.addEventListener('click', () => {
				this.cloneSelectedLayers();
			});
		}

		if (multiDeleteBtn) {
			multiDeleteBtn.addEventListener('click', async () => {
				await this.deleteSelectedLayers();
			});
		}

		document.querySelectorAll('#multiSelectionAlignScope [data-scope]').forEach((button) => button.addEventListener('click', () => {
			this.multiSelectionAlignScope = button.dataset.scope;
			document.querySelectorAll('#multiSelectionAlignScope [data-scope]').forEach((item) => item.classList.toggle('active', item === button));
		}));
		document.querySelectorAll('[data-multi-align]').forEach((button) => button.addEventListener('click', () => {
			const method = this.multiSelectionAlignScope === 'selection' ? 'alignToSelection' : 'alignToCanvas';
			this.groupTransformManager?.[method]?.(button.dataset.multiAlign);
		}));
		document.querySelectorAll('[data-multi-distribute]').forEach((button) => button.addEventListener('click', () => {
			this.groupTransformManager?.distribute(button.dataset.multiDistribute);
		}));
	}
};
