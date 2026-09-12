class FilterLayerManager {
	constructor(editor) {
		this.editor = editor;
		this.layerElements = new Map();
		this.layerTransforms = new Map();
		this.grainTileCache = new Map();
		this.setupUI();
		this.setupEventListeners();
		this.renderPresetPicker();
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
			type: get('filterType'), opacity: get('filterLayerOpacity'), presetPicker: get('filterPresetPicker'),
			strength: get('filterStrength'), showName: get('filterShowName'),
			brightness: get('filterBrightness'), contrast: get('filterContrast'), saturation: get('filterSaturation'), hue: get('filterHue'),
			invertAmount: get('filterInvertAmount'), grayscaleAmount: get('filterGrayscaleAmount'), sepiaAmount: get('filterSepiaAmount'),
			tintPreset: get('filterTintPreset'), tintColor: get('filterTintColor'), tintAmount: get('filterTintAmount'),
			vignetteAmount: get('filterVignetteAmount'), vignetteMidpoint: get('filterVignetteMidpoint'),
			vignetteRoundness: get('filterVignetteRoundness'), vignetteFeather: get('filterVignetteFeather'), vignetteColor: get('filterVignetteColor'),
			grainAmount: get('filterGrainAmount'), grainSize: get('filterGrainSize'), grainRoughness: get('filterGrainRoughness'), grainMono: get('filterGrainMono'),
			blurRadius: get('filterBlurRadius')
		};
		if (this.ui.tintPreset && !this.ui.tintPreset.options.length) {
			Object.entries(CONFIG.tools.filter.tintPresets).forEach(([id, preset]) => this.ui.tintPreset.add(new Option(preset.label, id)));
		}
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
		const suffix = CONFIG.ui.sliders[control.dataset.role]?.unit || '';
		bindSlider(control, document.getElementById(`${control.id}Value`), {
			suffix,
			parseValue: (value) => Number(value),
			apply: (value) => this.update(key, value),
			onCommit: () => this.editor.saveState('Edit filter')
		});
	}

	setupEventListeners() {
		this.ui.type?.addEventListener('change', () => {
			const layer = this.getActiveLayer();
			if (!layer) return;
			layer.filterData = GlitterFilter.normalizeFilterData({ type: this.ui.type.value });
			this.loadLayerSettings(layer);
			this.editor.requestPreviewUpdate();
			this.editor.layerManager.renderLayersList();
			this.editor.saveState('Edit filter');
		});
		this.bindRange(this.ui.opacity, 'opacity');
		[['strength', 'strength'], ['brightness', 'brightness'], ['contrast', 'contrast'], ['saturation', 'saturation'], ['hue', 'hue'],
			['invertAmount', 'amount'], ['grayscaleAmount', 'amount'], ['sepiaAmount', 'amount'], ['tintAmount', 'amount'],
			['vignetteAmount', 'amount'], ['vignetteMidpoint', 'midpoint'], ['vignetteRoundness', 'roundness'], ['vignetteFeather', 'feather'],
			['grainAmount', 'amount'], ['grainSize', 'size'], ['grainRoughness', 'roughness'], ['blurRadius', 'radius']]
			.forEach(([control, key]) => this.bindRange(this.ui[control], key));
		[['showName', 'showName'], ['grainMono', 'monochrome']].forEach(([control, key]) => this.ui[control]?.addEventListener('change', () => this.update(key, this.ui[control].checked, true)));
		this.ui.tintPreset?.addEventListener('change', () => this.applyTintPreset(this.ui.tintPreset.value));
		this.ui.tintColor?.addEventListener('input', () => {
			const layer = this.getActiveLayer();
			if (!layer || layer.filterData.type !== 'tint') return;
			layer.filterData.presetId = 'custom';
			this.ui.tintPreset.value = 'custom';
			this.update('color', this.ui.tintColor.value);
		});
		this.ui.tintColor?.addEventListener('change', () => this.update('color', this.ui.tintColor.value, true));
		[['vignetteColor', 'color']].forEach(([control, key]) => {
			this.ui[control]?.addEventListener('input', () => this.update(key, this.ui[control].value));
			this.ui[control]?.addEventListener('change', () => this.update(key, this.ui[control].value, true));
		});
	}

	applyTintPreset(presetId) {
		const layer = this.getActiveLayer();
		if (!layer || layer.filterData.type !== 'tint') return;
		const preset = CONFIG.tools.filter.tintPresets[presetId];
		if (!preset) return;
		layer.filterData.presetId = presetId;
		if (preset.color) layer.filterData.color = preset.color;
		this.loadLayerSettings(layer);
		this.editor.requestPreviewUpdate();
		this.editor.saveState('Choose tint preset');
	}

	loadLayerSettings(layer) {
		if (!layer || layer.type !== LayerType.FILTER) return;
		this.normalizeLayer(layer);
		const data = layer.filterData;
		this.ui.type.value = data.type;
		const settingsIds = {
			instagram: 'filterInstagramSettings', basic: 'filterBasicSettings', invert: 'filterInvertSettings',
			grayscale: 'filterGrayscaleSettings', sepia: 'filterSepiaSettings', tint: 'filterTintSettings',
			vignette: 'filterVignetteSettings', grain: 'filterGrainSettings', blur: 'filterBlurSettings'
		};
		Object.entries(settingsIds).forEach(([type, id]) => { document.getElementById(id).hidden = type !== data.type; });
		// Blend mode only has paint to act on for tint/vignette/grain - the rest
		// adjust the backdrop in place via CSS filter and have nothing to blend.
		const blendRow = document.getElementById('filterLayerBlendMode')?.closest('.property-row');
		if (blendRow) blendRow.hidden = !['tint', 'vignette', 'grain'].includes(data.type);
		const values = {
			opacity: layer.opacity, strength: data.strength, brightness: data.brightness, contrast: data.contrast, saturation: data.saturation, hue: data.hue,
			invertAmount: data.amount, grayscaleAmount: data.amount, sepiaAmount: data.amount, tintAmount: data.amount,
			vignetteAmount: data.amount, vignetteMidpoint: data.midpoint, vignetteRoundness: data.roundness, vignetteFeather: data.feather,
			grainAmount: data.amount, grainSize: data.size, grainRoughness: data.roughness, blurRadius: data.radius
		};
		this.loadingSettings = true;
		Object.entries(values).forEach(([control, value]) => {
			if (this.ui[control] && value != null) {
				writeSliderValue(this.ui[control], value);
				this.ui[control].dispatchEvent(new Event('input'));
			}
		});
		if (this.ui.showName) this.ui.showName.checked = Boolean(data.showName);
		if (this.ui.grainMono) this.ui.grainMono.checked = data.monochrome !== false;
		if (this.ui.tintPreset && data.type === 'tint') this.ui.tintPreset.value = data.presetId;
		if (this.ui.tintColor && data.type === 'tint') this.ui.tintColor.value = data.color;
		if (this.ui.vignetteColor && data.type === 'vignette') this.ui.vignetteColor.value = data.color;
		this.loadingSettings = false;
		this.renderPresetPicker();
	}

	renderPresetPicker() {
		if (!this.ui.presetPicker) return;
		const active = this.getActiveLayer()?.filterData?.presetId;
		this.ui.presetPicker.replaceChildren();
		Object.entries(FILTER_PRESETS).forEach(([id, preset]) => {
			const card = document.createElement('button');
			card.type = 'button';
			card.className = 'choice-card filter-preset-option';
			card.classList.toggle('active', id === active);
			card.dataset.presetId = id;
			const chip = document.createElement('span');
			chip.className = 'filter-preset-swatch';
			GlitterFilter.renderCssThumbnail(chip, { type: 'instagram', presetId: id, strength: 100, showName: false });
			const name = document.createElement('span');
			name.textContent = preset.name || preset.instagramName;
			card.append(chip, name);
			card.addEventListener('click', () => {
				const layer = this.getActiveLayer();
				if (!layer || layer.filterData.type !== 'instagram') return;
				layer.filterData.presetId = id;
				this.renderPresetPicker();
				this.editor.layerManager.renderLayersList();
				this.editor.requestPreviewUpdate();
				this.editor.saveState('Choose filter');
			});
			this.ui.presetPicker.append(card);
		});
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
}
