class FilterLayerManager {
	constructor(editor) {
		this.editor = editor;
		this.layerElements = new Map();
		this.layerTransforms = new Map();
		this.grainTileCache = new Map();
		this.setupUI();
		this.setupEventListeners();
		this.renderLookPicker();
	}

	getLayerType() {
		return LayerType.FILTER;
	}

	createLayer(options = {}) {
		return this.normalizeLayer({
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.FILTER,
			name: 'Filter',
			visible: true,
			locked: false,
			opacity: 100,
			filterData: options.filterData || { type: CONFIG.tools.filter.defaultType }
		});
	}

	normalizeLayer(layer) {
		if (!layer || layer.type !== LayerType.FILTER) return null;
		layer.opacity = Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 100;
		layer.filterData = GlitterFilter.normalizeFilterData(layer.filterData);
		return layer;
	}

	setupUI() {
		const get = (id) => document.getElementById(id);
		this.ui = {
			opacity: get('filterLayerOpacity'), looks: get('filterLooksPicker'),
			customize: get('filterCustomize'), customizeControls: get('filterCustomizeControls')
		};
	}

	getActiveLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === LayerType.FILTER ? layer : null;
	}

	update(key, value, commit = false) {
		if (this.loadingSettings) return;
		const layer = this.getActiveLayer();
		if (!layer) return;
		if (key === 'opacity') layer.opacity = value;
		else layer.filterData[key] = value;
		this.editor.layerManager.renderLayersList();
		this.editor.requestPreviewUpdate();
		if (commit) this.editor.saveState('Edit filter');
	}

	bindRange(control, key) {
		if (!control) return;
		const spec = FIELDS[control.dataset.role];
		const suffix = spec?.unit || '';
		bindSlider(control, document.getElementById(`${control.id}Value`), {
			suffix,
			parseValue: (value) => Number(value),
			apply: (value) => this.update(key, value),
			onCommit: () => this.editor.saveState('Edit filter'),
			resetValue: spec?.value,
			resetButton: document.getElementById(`reset${control.id.charAt(0).toUpperCase()}${control.id.slice(1)}`)
		});
	}

	setupEventListeners() {
		this.bindRange(this.ui.opacity, 'opacity');
	}

	chooseLook(entry) {
		const layer = this.getActiveLayer();
		if (!layer) return;
		layer.filterData = GlitterFilter.normalizeFilterData(GlitterFilters.looksLibrary.apply(entry));
		this.loadLayerSettings(layer);
		this.editor.requestPreviewUpdate();
		this.editor.layerManager.renderLayersList();
		this.editor.saveState('Choose look');
	}

	loadLayerSettings(layer) {
		if (!layer || layer.type !== LayerType.FILTER) return;
		this.loadingSettings = true;
		writeSliderValue(this.ui.opacity, layer.opacity);
		this.loadingSettings = false;
		this.renderLookPicker();
		this.renderCustomizeControls(layer);
	}

	renderLookPicker() {
		if (!this.ui.looks) return;
		GlitterPresetLibrary.renderPresetGrid(this.ui.looks, GlitterFilters.looksLibrary, {
			activeId: this.getActiveLayer()?.filterData?.type,
			onChoose: (entry) => this.chooseLook(entry)
		});
	}

	renderCustomizeControls(layer) {
		const filter = GlitterFilters.get(layer.filterData.type);
		const fields = Object.entries(filter.fields);
		this.ui.customize.hidden = !fields.length;
		this.ui.customizeControls.replaceChildren();
		fields.forEach(([key, field]) => {
			if (field.kind === 'preset') {
				const grid = buildPanelItem({ kind: 'presetGrid', label: `${filter.label} presets`, classes: 'property-inset property-scrollbox filter-preset-picker' });
				this.ui.customizeControls.appendChild(grid);
				const library = GlitterPresetLibrary.getPresetLibrary(field.libraryId);
				GlitterPresetLibrary.renderPresetGrid(grid, library, { activeId: layer.filterData[key], onChoose: (entry) => {
					library.apply(entry, layer.filterData);
					this.loadLayerSettings(layer);
					this.editor.layerManager.renderLayersList();
					this.editor.requestPreviewUpdate();
					this.editor.saveState('Choose filter preset');
				} });
				return;
			}
			let item;
			if (field.kind === 'number') item = { kind: 'slider', id: field.controlId, slider: field.specId, revert: true };
			else if (field.kind === 'boolean') item = { kind: 'checkboxList', items: [{ id: field.controlId, label: field.label, checked: field.default }] };
			else if (field.kind === 'color') item = { kind: 'field', id: field.controlId, label: field.label, type: 'color', value: field.default, revert: true };
			else if (field.kind === 'select') item = { kind: 'select', id: field.controlId, label: field.label, visibleLabel: field.label, options: GlitterFilters.fieldOptions(field) };
			if (!item) return;
			const node = buildPanelItem(item);
			this.ui.customizeControls.appendChild(node);
			const control = document.getElementById(field.controlId);
			if (field.kind === 'number') {
				writeSliderValue(control, layer.filterData[key]);
				this.bindRange(control, key);
			} else if (field.kind === 'boolean') {
				control.checked = Boolean(layer.filterData[key]);
				control.addEventListener('change', () => this.update(key, control.checked, true));
			} else {
				control.value = layer.filterData[key];
				const apply = (commit) => {
					const active = this.getActiveLayer();
					if (!active) return;
					const next = { ...active.filterData, [key]: control.value };
					if (active.filterData.type === 'tint' && key === 'color') next.presetId = 'custom';
					active.filterData = GlitterFilter.normalizeFilterData(next);
					this.editor.layerManager.renderLayersList();
					this.editor.requestPreviewUpdate();
					if (commit) {
						this.loadLayerSettings(active);
						this.editor.saveState('Edit filter');
					}
				};
				if (field.kind === 'color') control.addEventListener('input', () => apply(false));
				control.addEventListener('change', () => apply(true));
			}
		});
		syncPropertyReverts(this.ui.customizeControls);
	}

	renderContent(layersToShow) {
		reconcileLayerElements(this.layerElements, layersToShow, LayerType.FILTER, (layer) => this.renderLayer(layer));
	}

	renderLayer(layer) {
		let element = this.layerElements.get(layer.id);
		if (!element) {
			element = document.createElement('div');
			element.className = 'filter-layer-overlay ui-ignore-gestures';
			element.dataset.layerId = layer.id;
			this.editor.canvasElementsContainer.append(element);
			this.layerElements.set(layer.id, element);
		}
		const width = this.editor.previewCanvas?.width || 1;
		const height = this.editor.previewCanvas?.height || 1;
		const viewScale = this.editor.viewport?.currentZoom || 1;
		const blendMode = GlitterBlendModes.forLayer(layer);
		const signature = `${JSON.stringify(layer.filterData)}|${layer.opacity}|${blendMode}|${this.editor.layerManager.getLayerZIndex(layer.id)}|${width}|${height}|${viewScale}`;
		if (element.dataset.renderSignature === signature) return element;
		element.dataset.renderSignature = signature;
		const layerZIndex = this.editor.layerManager.getLayerZIndex(layer.id);
		const layerOpacity = layer.opacity / 100;
		element.style.zIndex = '';
		element.style.opacity = '';
		element.style.backdropFilter = '';
		element.style.webkitBackdropFilter = '';
		// Not applied as element.style.mixBlendMode on this container: it paints
		// no content of its own (children paint the tint/vignette/grain overlays,
		// and tone/blur adjust the backdrop directly via CSS filter), so a
		// container-level blend mode would be a no-op at best. Each paint op
		// gets the override directly instead - see overlayLayerStyles.
		const children = GlitterFilter.overlayLayerStyles(layer.filterData, { width, height, seed: layer.id, viewScale, tileCache: this.grainTileCache, blendMode });
		const retained = new Set();
		const caption = GlitterFilter.resolve(layer.filterData).caption;
		if (caption) {
			let child = element.querySelector('.filter-layer-name');
			if (!child) child = document.createElement('div');
			child.className = 'filter-layer-name';
			child.textContent = caption;
			const spec = GlitterFilter.nameCaptionSpec(caption, { width, height });
			child.style.fontSize = `${spec.fontPx}px`;
			child.style.transform = `translateY(${spec.y - height / 2}px)`;
			child.style.zIndex = layerZIndex;
			child.style.opacity = layerOpacity;
			element.append(child);
		} else element.querySelector('.filter-layer-name')?.remove();
		children.forEach((spec, index) => {
			const key = `${spec.className}-${index}`;
			let child = element.querySelector(`[data-filter-child="${key}"]`);
			if (!child) {
				child = document.createElement('div');
				child.dataset.filterChild = key;
				element.append(child);
			}
			child.className = spec.className;
			child.dataset.filterChild = key;
			child.removeAttribute('style');
			Object.assign(child.style, spec.style);
			child.style.zIndex = layerZIndex;
			child.style.opacity = Number(spec.style.opacity ?? 1) * layerOpacity;
			element.append(child);
			retained.add(child);
		});
		element.querySelectorAll('[data-filter-child]').forEach((child) => {
			if (!retained.has(child)) child.remove();
		});
		return element;
	}

	removeLayerElement(layerId) {
		removeManagedLayerElement(this.layerElements, layerId);
	}

	releaseLayerResources(layer) {
		this.removeLayerElement(layer?.id);
	}

	clearElements() {
		this.layerElements.forEach((element) => element.remove());
		this.layerElements.clear();
		this.grainTileCache.clear();
	}

	buildExportPlan(layer, context) {
		return context.compositor._buildFilterExportPlan(layer);
	}
}
