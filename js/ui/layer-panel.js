const LAYER_PANEL_METHODS = {
setupLayerTypePickerListeners() {
		const optionsContainer = document.querySelector('#layerTypePickerModal .layer-type-options');
		if (!optionsContainer) return;

		this.renderLayerTypePickerOptions(optionsContainer);

		optionsContainer.addEventListener('click', (event) => {
			const button = event.target.closest('.layer-type-option');
			if (!button) return;

			this.modalManager.close('layerTypePickerModal');
			requestAnimationFrame(() => {
				this.createLayerByType(button.dataset.layerType);
			});
		});
	}

,
	createLayerByType(layerType) {
		if (!LAYER_UI_CONFIG[layerType]?.addableViaModal) {
			dbg(`Unknown add-layer type: ${layerType}`);
			return;
		}

		this.layerManager.addLayer(layerType);
	}

,
	createLayerTypeOptionButton(type, { iconSizeClass = 'xl', id = null } = {}) {
		const modalConfig = LAYER_UI_CONFIG[type]?.addableViaModal;
		if (!modalConfig) return null;

		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'layer-type-option';
		button.dataset.layerType = type;
		if (id) {
			button.id = id;
		}
		button.innerHTML = `
			<span class="layer-type-icon icon-wrapper ${iconSizeClass}">
				<svg class="icon">
					<use href="#icon-${modalConfig.icon}"></use>
				</svg>
			</span>
			<span class="layer-type-name">${modalConfig.label}</span>
			<span class="layer-type-description">${modalConfig.description}</span>
		`;
		return button;
	}

,
	renderLayerTypePickerOptions(container, options = {}) {
		container.innerHTML = '';
		const iconSizeClass = options.iconSizeClass || 'xl';
		const idMap = options.idMap || {};

		getAddableLayerTypes().forEach((type) => {
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

		// Dropzone click
		if (dropzone && input) {
			dropzone.addEventListener('click', () => {
				input.click();
			});
		}

		// File selection
		if (input) {
			input.addEventListener('change', async (e) => {
				const file = e.target.files[0];
				if (file) {
					await this.stickerManager.handleUserUpload(file);
					this.modalManager.close('stickerUploadModal');
					input.value = '';
				}
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

				const file = e.dataTransfer.files[0];
				if (file) {
					await this.stickerManager.handleUserUpload(file);
					this.modalManager.close('stickerUploadModal');
				}
			});
		}
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
			this.renderLayerTypePickerOptions(quickAddOptions, {
				iconSizeClass: '',
				idMap: {
					[LayerType.GLITTER_FILL]: 'quickActionAddGlitter',
					[LayerType.STICKER]: 'quickActionAddSticker',
					[LayerType.TEXT_GLITTER]: 'quickActionAddText',
					[LayerType.SHAPE]: 'quickActionAddShape'
				}
			});

			quickAddOptions.addEventListener('click', (event) => {
				const button = event.target.closest('.layer-type-option');
				if (!button) return;
				this.createLayerByType(button.dataset.layerType);
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
		this.multiSelectionAlignScope = 'canvas';

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
