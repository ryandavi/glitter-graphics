const LAYER_PANEL_METHODS = {
setupLayerTypePickerListeners() {
		const modal = document.getElementById('layerTypePickerModal');
		const container = modal?.querySelector('.layer-type-options');
		if (!container) return;

		this.renderAddMenu(container);
		GlitterPresetLibrary.bindPickerNavigation(container, '.layer-type-option');
		container.addEventListener('click', (event) => {
			const button = event.target.closest('.layer-type-option');
			if (!button || button.disabled) return;
			this.modalManager.close('layerTypePickerModal');
			// After the modal has handed focus back.
			requestAnimationFrame(() => this.runAddEntry(button));
		});

		// The search field leads into the cards: Down moves to the first match,
		// Enter adds it.
		const search = document.getElementById('addMenuSearch');
		search?.addEventListener('keydown', (event) => {
			if (event.key !== 'ArrowDown' && event.key !== 'Enter') return;
			const first = [...container.querySelectorAll('.layer-type-option')]
				.find((option) => option.getClientRects().length && !option.disabled);
			if (!first) return;
			event.preventDefault();
			if (event.key === 'ArrowDown') first.focus();
			else if (search.value.trim()) first.click();
		});
	},

	// What the Add menu opens to: availability from the current document, the
	// spot new layers go, and an empty search.
	syncAddMenu() {
		const modal = document.getElementById('layerTypePickerModal');
		if (!modal) return;
		modal.querySelectorAll('.layer-type-option[data-add-kind="command"]').forEach((button) => {
			const command = ADD_MENU_COMMANDS.find((entry) => entry.id === button.dataset.addId);
			this.syncAddEntryAvailability(button, command?.availability?.(this));
		});
		const note = document.getElementById('addMenuPlacement');
		if (note) {
			const gate = this.layerManager.canAddLayers();
			const active = this.layerManager.getLayerById(this.activeLayerId);
			note.textContent = !gate.ok ? gate.reason
				: active ? `New layers go above ${describeLayer(active, this).name}.`
				: 'New layers go on top.';
			note.classList.toggle('is-warning', !gate.ok);
		}
		this.addMenuFilter?.reset();
	},

	syncAddEntryAvailability(button, availability) {
		const available = availability?.available !== false;
		const detail = button.querySelector('.layer-type-description');
		button.disabled = !available;
		button.title = available ? '' : availability.message;
		if (detail) detail.textContent = available ? button.dataset.description : availability.message;
	},

	// One card for an Add entry (getAddMenuEntries), used by the Add menu and
	// by Quick add. `layout` is the group's card form (ADD_MENU_GROUPS).
	createAddEntryButton(entry, { layout = 'tiles', id = null, iconSizeClass = 'xl' } = {}) {
		const button = tplClone('tpl-layer-type-option');
		if (id) button.id = id;
		if (layout === 'list') button.classList.add('is-horizontal');
		button.dataset.addKind = entry.kind;
		button.dataset.addId = entry.id;
		button.dataset.description = entry.description || '';
		button.dataset.searchAliases = entry.keywords || '';
		if (entry.type) button.dataset.layerType = entry.type;
		if (entry.phoneChip === false) button.dataset.phoneChip = 'false';
		button._createOptions = entry.createOptions || null;

		const media = button.querySelector('.layer-type-icon');
		if (layout === 'previews' && entry.sample) {
			media.replaceWith(buildAddEntrySample(entry.sample));
		} else {
			if (iconSizeClass) media.classList.add(iconSizeClass);
			button.querySelector('use').setAttribute('href', `#icon-${entry.icon}`);
		}
		button.querySelector('.layer-type-name').textContent = entry.label;
		button.querySelector('.layer-type-description').textContent = entry.description || '';
		return button;
	},

	// What a card does, wherever it is shown.
	runAddEntry(button) {
		const kind = button.dataset.addKind;
		if (kind === 'command') {
			ADD_MENU_COMMANDS.find((entry) => entry.id === button.dataset.addId)?.run(this);
		} else if (kind === 'template') {
			this.templateManager?.previewOverlay(button.dataset.addId);
		} else {
			this.createLayerByType(button.dataset.layerType, button._createOptions);
		}
	},

	async renderAddMenu(container) {
		const entries = await listAddMenuEntries();
		container.replaceChildren();
		container.classList.add('add-menu-groups');
		ADD_MENU_GROUPS.forEach((group) => {
			const groupEntries = entries.filter((entry) => entry.group === group.id);
			if (!groupEntries.length) return;
			const section = document.createElement('section');
			section.className = `add-menu-group is-${group.layout}`;
			section.dataset.addGroup = group.id;
			const title = document.createElement('h3');
			title.className = 'add-menu-group-title';
			title.textContent = group.label;
			const grid = document.createElement('div');
			grid.className = 'layer-type-options';
			groupEntries.forEach((entry) => grid.appendChild(this.createAddEntryButton(entry, { layout: group.layout })));
			section.append(title, grid);
			container.appendChild(section);
		});
		this.addMenuFilter ??= createModalFilter({
			root: '#layerTypePickerModal',
			inputSelector: '#addMenuSearch',
			clearSelector: '[data-modal-filter-clear]',
			statusSelector: '#addMenuSearchStatus',
			emptySelector: '#addMenuSearchEmpty',
			itemSelector: '.layer-type-option',
			groupSelector: '.add-menu-group',
			groupTitleSelector: '.add-menu-group-title',
			singularLabel: 'result',
			pluralLabel: 'results'
		});
		this.addMenuFilter?.refresh();
		if (document.getElementById('layerTypePickerModal')?.classList.contains('visible')) this.syncAddMenu();
	},

	createLayerByType(layerType, createOptions = null) {
		if (!APP_BOOT.isComplete('library')) return;
		if (!LAYER_UI_CONFIG[layerType]?.addableViaModal) {
			dbg(`Unknown add-layer type: ${layerType}`);
			return;
		}

		const layer = layerType === LayerType.TEXT_GLITTER
			? createTextAt(this, createOptions?.textLayer || {})
			: this.layerManager.addLayer(layerType, createOptions || {});
		if (layer && createOptions?.shapeLayer?.openImagePicker) {
			requestAnimationFrame(() => this.shapeGlitterManager?.chooseFillImage());
		} else if (layer && layerType !== LayerType.TEXT_GLITTER) {
			// After the creation flow has settled on its tool and panel.
			requestAnimationFrame(() => this.openCreateTarget(layer));
		}
	},

	setupStickerUploadModalListeners() {
		// Note: Modal open/close is handled by ModalManager
		// uploadStickerBtn opens the modal via ModalManager.register()

		const dropzone = document.getElementById('stickerUploadDropzone');
		const input = document.getElementById('stickerUploadInput');

		const uploadAndUse = async (files) => {
			const library = this.assetUploadLibrary || this.stickerLibrary;
			await openEditorFiles(this, files, { uploadLibrary: library });
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
	},

	getMultiSelectionLayerOpacity(layer) {
		if (!canEditLayerInStack(layer)) return null;
		// v2 opacity model: one canonical whole-layer opacity for every type.
		return Number.isFinite(layer.opacity) ? layer.opacity : 100;
	},

	setMultiSelectionLayerOpacity(layer, value) {
		if (!canEditLayerInStack(layer)) return;
		layer.opacity = value;
	},

	syncMultiSelectionOpacity(layers = []) {
		const input = document.getElementById('multiSelectionOpacity');
		const value = document.getElementById('multiSelectionOpacityValue');
		const reset = document.getElementById('resetMultiSelectionOpacity');
		if (!input || !value || !reset) return;
		const opacities = layers.map((layer) => this.getMultiSelectionLayerOpacity(layer)).filter(Number.isFinite);
		const editable = opacities.length === layers.length
			&& layers.every((layer) => canEditLayerInStack(layer));
		const mixed = opacities.some((opacity) => opacity !== opacities[0]);
		input.value = mixed ? 100 : (opacities[0] ?? 100);
		value.textContent = mixed ? 'Mixed' : `${input.value}%`;
		input.disabled = !editable;
		reset.disabled = !editable || (!mixed && Number(input.value) === 100);
	},

	syncMultiSelectionBlendMode(layers = []) {
		const control = document.getElementById('multiSelectionBlendMode');
		if (!control) return;
		const modes = layers.map((layer) => GlitterBlendModes.forLayer(layer));
		const mixed = modes.some((mode) => mode !== modes[0]);
		control.value = mixed ? '' : (modes[0] ?? CONFIG.layers.defaultBlendMode);
		control.disabled = layers.length < 2 || !layers.every((layer) => canEditLayerInStack(layer) && LAYER_UI_CONFIG[layer.type]?.blendable);
		syncPropertyReverts(control.closest('.property-row'));
		const reset = control.closest('.property-row').querySelector('.property-option-revert');
		if (reset && control.disabled) reset.disabled = true;
	},

	getMultiSelectionAppearanceTargets() {
		const source = this.layerManager.getActiveLayer();
		if (!source || !getLayerManagerForType(this, source.type)?.fieldHost) return [];
		return this.layerManager.getSelectedLayers().filter((layer) => layer.id !== source.id && layer.type === source.type && canEditLayerInStack(layer));
	},

	// Stagger's popover: Offset (Cycle or Start), Step and Reverse. Without a
	// visible selection panel (the command on a closed inspector) it applies
	// the defaults.
	openStaggerMenu() {
		const layers = this.layerManager.getSelectedLayers(), defaults = staggerDefaults(this, layers);
		if (defaults.count < 2) { this.updateStatus('Stagger needs two or more selected layers with motion.'); return; }
		const trigger = document.getElementById('multiSelectionStagger'), root = trigger?.closest('.app-menu-popover');
		const panel = root && (root._staggerPanel ||= root.querySelector('.app-menu-panel'));
		if (!trigger?.offsetParent || !panel) { this.staggerAnimations(layers, defaults); return; }
		if (root._staggerMenu?.isOpen()) { root._staggerMenu.close(); return; }
		let offset = defaults.offset;
		const offsetRow = buildPanelItem({ kind: 'segmented', label: 'Offset', ariaLabel: 'Stagger offset', options: [
			{ label: 'Cycle', attrs: { 'data-stagger-offset': 'cycle' } }, { label: 'Start', attrs: { 'data-stagger-offset': 'start' } }
		] }, {});
		const cycleRow = buildPanelItem({ kind: 'field', type: 'number', ...FIELDS.staggerCycleStep, value: Math.round(1000 / defaults.count) / 10 }, {});
		const startRow = buildPanelItem({ kind: 'field', type: 'number', ...FIELDS.staggerStartStep }, {});
		const reverseRow = buildPanelItem({ kind: 'toggle', label: 'Reverse order' }, {});
		const note = buildElement('property-note');
		note.setAttribute('aria-live', 'polite');
		const sync = () => {
			offsetRow.querySelectorAll('[data-stagger-offset]').forEach(button => {
				const active = button.dataset.staggerOffset === offset;
				button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
			});
			cycleRow.hidden = offset !== 'cycle'; startRow.hidden = offset !== 'start';
			note.textContent = offset === 'cycle' ? 'Each layer is one step further into its cycle, so loops stay seamless.' : 'Each layer starts one step after the one before.';
		};
		offsetRow.querySelectorAll('[data-stagger-offset]').forEach(button => button.addEventListener('click', () => { offset = button.dataset.staggerOffset; sync(); }));
		const apply = buildIconButton({ className: 'btn-flat primary', label: 'Apply', onClick: () => {
			const step = offset === 'cycle' ? cycleRow.querySelector('input').valueAsNumber / 100 : startRow.querySelector('input').valueAsNumber * 1000;
			const result = this.staggerAnimations(this.layerManager.getSelectedLayers(), { offset, step, reverse: reverseRow.querySelector('input').checked });
			if (result.reason) note.textContent = result.reason;
			else root._staggerMenu.close({ focusTrigger: true });
		} });
		apply.textContent = 'Apply';
		const cancel = buildIconButton({ className: 'btn-flat', label: 'Cancel', onClick: () => root._staggerMenu.close({ focusTrigger: true }) });
		cancel.textContent = 'Cancel';
		const buttons = buildElement('property-row is-control'), pair = buildElement('property-pair');
		pair.append(cancel, apply); buttons.append(pair);
		panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Stagger animations');
		panel.replaceChildren(buildMenuLabel(`${defaults.count} layers with motion, in reading order`), offsetRow, cycleRow, startRow, reverseRow, note, buttons);
		sync();
		root._staggerMenu ||= setupMenuPopover({ root, trigger, panel, fixed: true, bindTrigger: false, itemSelector: 'input, button:not([disabled])' });
		root._staggerMenu.open();
	},

	async runMultiSelectionAction(label, action) {
		if (this._multiSelectionActionActive) return;
		this._multiSelectionActionActive = true;
		const done = this.beginActivity('multi-selection', label);
		try {
			if (!await action()) return;
			this.layerManager.renderLayersList();
			this.syncTransformHandlesForActiveLayer();
			this.refreshInspector();
			this.updateActionButtons();
			this.requestPreviewUpdate();
			this.saveState(label);
			this.updateStatus(label);
		} catch (error) {
			this.showError(`${label}: ${error.message}`);
		} finally {
			this._multiSelectionActionActive = false;
			done();
		}
	},

	async copyMultiSelectionAppearance() {
		const source = this.layerManager.getActiveLayer();
		const targets = this.getMultiSelectionAppearanceTargets();
		if (!targets.length) return false;
		const slots = getStylePresetSlotDefinitions(source.type).filter((definition) => readFieldPath(source, definition.pathKeys)?.mode !== 'image');
		const values = slots.map((definition) => ({
			definition,
			value: structuredClone(readFieldPath(source, definition.pathKeys)),
			enabled: definition.enabledKeys ? Boolean(readFieldPath(source, definition.enabledKeys)) : null
		}));
		const adjustments = LAYER_UI_CONFIG[source.type].fields.filter((binding) => binding.colorAdjust)
			.map((binding) => ({ binding, value: readFieldPath(source, binding.pathKeys) }));
		const host = getLayerManagerForType(this, source.type).fieldHost;
		for (const layer of targets) {
			await host.apply(layer, () => {
				layer.opacity = source.opacity;
				if (LAYER_UI_CONFIG[layer.type].blendable) layer.blendMode = GlitterBlendModes.forLayer(source);
				adjustments.forEach(({ binding, value }) => writeFieldPath(layer, binding.pathKeys, value));
				values.forEach(({ definition, value, enabled }) => {
					if (readFieldPath(layer, definition.pathKeys)?.mode === 'image') return;
					writeFieldPath(layer, definition.pathKeys, structuredClone(value));
					if (definition.enabledKeys) writeFieldPath(layer, definition.enabledKeys, enabled);
					const drafts = definition.draftKeys && readFieldPath(layer, definition.draftKeys.slice(0, -1));
					if (drafts) delete drafts[definition.draftKeys.at(-1)];
				});
			}, { geometry: true, live: true });
		}
		return true;
	},

	setupLayerPanelListeners() {
		// Add layer buttons - open layer type picker
		['addLayerBtn'].forEach((id) => {
			const addLayerBtn = document.getElementById(id);
			if (addLayerBtn) addLayerBtn.addEventListener('click', () => {
				this.modalManager.open('layerTypePickerModal');
			});
		});

		const quickAddOptions = document.getElementById('quickAddOptions');
		if (quickAddOptions) {
			quickAddOptions.replaceChildren(...getQuickAddLayerEntries()
				.map((entry) => this.createAddEntryButton(entry, { id: entry.quickAddId, iconSizeClass: '' })));

			quickAddOptions.addEventListener('click', (event) => {
				const button = event.target.closest('.layer-type-option');
				if (button) this.runAddEntry(button);
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
		document.getElementById('layersBarClipping')?.addEventListener('click', () => this.toggleClippingMask());
		const layersBarDeleteSelected = document.getElementById('layersBarDeleteSelected');
		const layersBarClearAll = document.getElementById('layersBarClearAll');

		if (layersBarGoToSelected) {
			layersBarGoToSelected.addEventListener('click', () => {
				const selectedLayer = this.layerManager.getActiveLayer();
				if (!selectedLayer || LAYER_UI_CONFIG[selectedLayer.type]?.protectedInStack) return;
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

		document.getElementById('multiSelectionClipBtn')?.addEventListener('click', () => this.toggleClippingMask());
		const multiDuplicateBtn = document.getElementById('multiSelectionDuplicateBtn');
		const multiDeleteBtn = document.getElementById('multiSelectionDeleteBtn');
		const multiOpacity = document.getElementById('multiSelectionOpacity');
		this.multiSelectionAlignScope = 'selection';
		document.querySelectorAll('[data-multi-visible], [data-multi-lock]').forEach((button) => button.addEventListener('click', () => {
			this.runMultiSelectionAction(button.dataset.multiVisible !== undefined
				? (button.dataset.multiVisible === 'true' ? 'Show selected layers' : 'Hide selected layers')
				: (button.dataset.multiLock === 'true' ? 'Lock selected layers' : 'Unlock selected layers'), () => {
				const layers = this.layerManager.getSelectedLayers();
				if (layers.length < 2) return false;
				let changed = false;
				layers.forEach((layer) => {
					const didChange = button.dataset.multiVisible !== undefined
						? this.layerManager.setLayerVisibility(layer.id, button.dataset.multiVisible === 'true')
						: this.layerManager.setLayerLock(layer.id, button.dataset.multiLock === 'true');
					changed = didChange || changed;
				});
				return changed;
			});
		}));
		document.querySelectorAll('[data-multi-size]').forEach((button) => button.addEventListener('click', () => {
			this.runMultiSelectionAction(`Match selected layer ${button.dataset.multiSize}`, async () => {
				if (!this.layerManager.canTransformMultiSelection()) return false;
				const source = this.layerManager.getActiveLayer();
				const sourceContext = this.getMovableLayerContext(source);
				const size = sourceContext && this.getTransformSizeState(source, sourceContext.prefix);
				if (!size?.visible) return false;
				let changed = false;
				for (const layer of this.layerManager.getSelectedLayers()) {
					if (layer.id === source.id) continue;
					const { prefix, manager } = this.getMovableLayerContext(layer);
					const axis = button.dataset.multiSize;
					if (this.getTransformSizeState(layer, prefix)?.[axis] === size[axis]) continue;
					const startScale = { ...getLayerTransform(layer).scale };
					manager.renderLayer(layer);
					if (this.applyTransformSizeFromPanel(prefix, layer, manager, axis, size[axis])) {
						await manager.commitScale?.(layer, startScale);
						this.redrawSettledScale(layer, manager);
						changed = true;
					}
				}
				return changed;
			});
		}));
		document.querySelectorAll('[data-multi-flip]').forEach((button) => button.addEventListener('click', () => {
			this.runMultiSelectionAction('Flip selected layers', () => {
				if (!this.layerManager.canTransformMultiSelection()) return false;
				const property = button.dataset.multiFlip;
				this.layerManager.getSelectedLayers().forEach((layer) => {
					const { manager } = this.getMovableLayerContext(layer);
					manager.renderLayer(layer);
					this.applyTransformEditWithAnchor(layer, manager, () => manager.updateTransform(layer.id, { [property]: !getLayerTransform(layer)[property] }));
				});
				return true;
			});
		}));
		document.getElementById('multiSelectionCopyAppearance')?.addEventListener('click', () => {
			this.runMultiSelectionAction('Copy selected layer appearance', () => this.copyMultiSelectionAppearance());
		});
		document.getElementById('multiSelectionStagger')?.addEventListener('click', () => COMMANDS.staggerAnimations.run(this));
		document.getElementById('multiSelectionRandomizeStart')?.addEventListener('click', () => COMMANDS.randomizeGifStarts.run(this));

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
		const multiBlendMode = document.getElementById('multiSelectionBlendMode');
		multiBlendMode?.addEventListener('change', () => {
			const layers = this.layerManager.getSelectedLayers();
			if (layers.length < 2 || !layers.every((layer) => canEditLayerInStack(layer) && LAYER_UI_CONFIG[layer.type]?.blendable)) return;
			if (!CONFIG.layers.blendModes.includes(multiBlendMode.value)) return;
			const mode = GlitterBlendModes.normalize(multiBlendMode.value);
			if (layers.every((layer) => GlitterBlendModes.forLayer(layer) === mode)) return;
			layers.forEach((layer) => { layer.blendMode = mode; });
			this.syncMultiSelectionBlendMode(layers);
			this.requestPreviewUpdate();
			this.saveState('Change selected layer blend mode');
		});
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
