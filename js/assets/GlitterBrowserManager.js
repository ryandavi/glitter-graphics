// Asset lookup, browsing and uploads are independent of layer rendering.
class GlitterBrowserManager extends ContentManager {
	constructor(editor) {
		super(editor);
		this.useBrowser = true;
		this.recolorSources = new Map();
		Object.assign(this.activeFilters, { tones: new Set(), intensities: new Set(), temperatures: new Set(), special: new Set() });
	}

	setupUI() { this.ui = getAssetBrowserUi('glitter'); }

	getLayerType() { return LayerType.GLITTER_FILL; }

	getProjectAssetIds(layers) {
		return layers.flatMap((layer) => getLayerPaintSlots(layer)
			.map(({ data, renders }) => (renders && data.mode === 'glitter' ? data.glitterId : null)));
	}

	async initBrowser() {
		for (const recipe of [...PREFERENCES.get('customGlitter')].reverse()) {
			try { await this.registerCustomGlitter(recipe, { persist: false }); }
			catch (error) { console.warn('Could not restore custom glitter:', error); }
		}
		this.browser = new AssetBrowser(this, 'glitter');
		await this.browser.init('data/glitter-categories.json');
		this.refreshCustomCategory();
		this.editor.glitterRecolor.installLibraryActions();
	}

	async handleUserUpload(file) {
		const done = this.editor.beginActivity('asset-upload', 'Opening fill tile');
		try {
			const item = await this.createUploadedAsset(file, { category: 'custom' });
			if (!item) return null;
			this.userContent.unshift(item);
			this.updateFacetAvailability();
			this.refreshCustomCategory();
			await revealAssetBrowser(this.editor, this, item.id);
			return item;
		} catch (error) {
			this.editor.showError(error.message);
			return null;
		} finally { done(); }
	}

	async registerEmbeddedGlitter(id, payload) {
		const existing = this.getItemById(id);
		if (existing) return existing;
		const blob = await fetch(payload.data).then(response => response.blob());
		const file = new File([blob], payload.upload.fileName || `${id}.png`, { type: payload.upload.mimeType || blob.type });
		const item = await this.createUploadedAsset(file, { id, category: 'custom', name: payload.upload.name });
		if (!item) throw new Error('Invalid embedded fill tile');
		this.userContent.unshift(item);
		this.updateFacetAvailability();
		this.refreshCustomCategory();
		return item;
	}


	async getRecolorSource(item) {
		const sourceId = item.recipe?.sourceId ?? item.id;
		if (!this.recolorSources.has(sourceId)) {
			const promise = (async () => {
				const source = await this.ensureAssetDetails(sourceId);
				if (!source) throw new Error('The source glitter is unavailable');
				const bytes = await fetchGifBytes(source.url);
				return { source, bytes, analysis: GlitterRecolor.analyze(bytes) };
			})();
			this.recolorSources.set(sourceId, promise);
			promise.catch(() => this.recolorSources.delete(sourceId));
		}
		return this.recolorSources.get(sourceId);
	}

	canRecolor(item) {
		return Boolean(item && (item.recipe || CONFIG.tools.glitter.recolor.styles.includes(item.category))
			&& Number.isInteger(item.swatchCount) && item.swatchCount > 0 && item.swatchCount <= CONFIG.tools.glitter.recolor.maxSwatches);
	}

	async registerCustomGlitter(recipe, { data = null, sourceData = null, persist = true } = {}) {
		if (!recipe || typeof recipe.id !== 'string' || !recipe.id.startsWith('custom-') || !recipe.name?.trim() || !recipe.colors || typeof recipe.colors !== 'object') throw new Error('Invalid custom glitter recipe');
		Object.entries(recipe.colors).forEach(([key, value]) => { GlitterRecolor.rgb(key); GlitterRecolor.rgb(value); });
		const existing = this.getItemById(recipe.id);
		if (existing) {
			if (persist && !this.userContent.includes(existing)) {
				this.retiredCustom.delete(recipe.id);
				this.userContent.unshift(existing);
				this.persistCustomGlitter();
				this.refreshCustomCategory();
			}
			return existing;
		}
		if (sourceData && !this.recolorSources.has(recipe.sourceId)) {
			const originalBytes = await fetchGifBytes(sourceData);
			this.recolorSources.set(recipe.sourceId, Promise.resolve({
				bytes: originalBytes, analysis: GlitterRecolor.analyze(originalBytes),
				source: { id: recipe.sourceId, name: recipe.sourceName, attribution: recipe.attribution }
			}));
		}
		let bytes, source, analysis;
		if (data) {
			bytes = await fetchGifBytes(data);
			source = this.getItemById(recipe.sourceId);
			analysis = GlitterRecolor.analyze(bytes);
		} else {
			const original = await this.getRecolorSource({ recipe });
			source = original.source;
			bytes = GlitterRecolor.apply(original.bytes, recipe.colors, original.analysis);
			analysis = GlitterRecolor.analyze(bytes);
		}
		const timing = readGifTiming(bytes);
		const url = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
		const item = this.normalizeAsset({
			...source, ...timing, id: recipe.id, name: recipe.name, url, thumbnailUrl: url,
			category: 'custom', set: null, source: 'custom', originalOrder: null,
			colorCodes: analysis.swatches.map(swatch => `#${swatch.key}`),
			colorWeights: analysis.swatches.map(swatch => swatch.share),
			swatchCount: analysis.swatches.length,
			isAnimated: timing.frameCount > 1, fileSize: bytes.length, hasTransparency: source?.hasTransparency ?? analysis.hasTransparency,
			attribution: recipe.attribution || (source && this.browser?.getAssetAttribution(source)),
			originalName: null, appearances: [], tags: GlitterRecolor.paletteTags(analysis.swatches, CONFIG.tools.glitter.recolor), searchTerms: [], generatedName: null, hue: null, brightness: null, isPixelated: true
		});
		item.recipe = JSON.parse(JSON.stringify(recipe));
		item._detailLoaded = true;
		item.gifBytes = bytes;
		item.sourceBytes = (await this.recolorSources.get(recipe.sourceId))?.bytes;
		await this.ensureAssetImageReady(item);
		this.userContent.unshift(item);
		if (persist) this.persistCustomGlitter();
		this.refreshCustomCategory();
		return item;
	}

	persistCustomGlitter() {
		const saved = this.userContent.filter(item => item.recipe).map(item => item.recipe);
		// Recipes restored from projects may outlive their library source.
		const unavailable = PREFERENCES.get('customGlitter').filter(recipe => !this.getItemById(recipe.id));
		PREFERENCES.set('customGlitter', [...saved, ...unavailable]);
	}

	refreshCustomCategory() {
		if (!this.browser) return;
		const categories = this.browser.categories;
		const index = categories.findIndex(category => category.id === 'custom');
		if (index >= 0) categories.splice(index, 1);
		if (this.userContent.length) categories.unshift({ id: 'custom', name: 'My Glitter', description: 'Your recolored and uploaded fill tiles. Used tiles are included in saved projects.' });
		this.browser.refresh();
	}

	retireCustomGlitter(id) {
		this.retireUserAsset(id);
	}

	refreshUserAssets() {
		this.persistCustomGlitter();
		this.refreshCustomCategory();
	}

	async saveCustomGlitter(recipe, { replaceId = null, target = null } = {}) {
		if (!replaceId && this.userContent.length >= CONFIG.tools.glitter.recolor.maxSavedTiles) throw new Error('My Glitter is full. Delete a tile before saving another.');
		if (replaceId && !this.userContent.some(item => item.id === replaceId)) throw new Error('Only a tile in My Glitter can be replaced');
		const item = await this.registerCustomGlitter(recipe, { persist: false });
		const changed = new Set();
		if (replaceId) {
			for (const layer of this.editor.layers) {
				for (const { data } of getLayerPaintSlots(layer, { includeDrafts: true })) {
					if (data?.glitterId === replaceId) { data.glitterId = item.id; changed.add(layer); }
				}
			}
			this.retireCustomGlitter(replaceId);
		} else if (target) {
			const layer = this.editor.layerManager.getLayerById(target.layerId);
			const slot = layer && getLayerPaintSlot(layer, target.slot);
			if (slot && this.editor.canEditLayer(layer, { notify: true })) {
				slot.glitterId = item.id;
				slot.mode = 'glitter';
				slot.colorAdjust = null;
				changed.add(layer);
			}
		}
		this.persistCustomGlitter();
		if (changed.size) {
			this.editor.requestPreviewUpdate();
			this.editor.loadActiveLayerSettings();
			this.editor.layerManager.renderLayersList();
			this.editor.updateGlitterSelection();
			this.editor.saveState('Recolor glitter');
		}
		this.editor.glitterRecolor.selectedId = item.id;
		await revealAssetBrowser(this.editor, this, item.id);
		this.editor.updateStatus(replaceId ? `Updated ${item.name} on ${changed.size} layers` : `Saved ${item.name} to My Glitter`);
		return item;
	}

	createAssetProvenance(item) {
		if (!item.recipe) return super.createAssetProvenance(item);
		const block = document.createElement('div');
		block.className = 'asset-provenance property-note';
		const credit = Attribution.creditLine(Attribution.resolve(item.attribution));
		block.textContent = `Recolored from ${item.recipe.sourceName || item.recipe.sourceId}${credit ? ' · ' + credit : ''}`;
		return block;
	}

	customizeItemElement(element, item) {
		const controller = this.editor.glitterRecolor;
		const unavailable = Boolean(controller?.pickerSession && !this.canRecolor(item));
		element.classList.toggle('recolor-unavailable', unavailable);
		if (unavailable) {
			element.setAttribute('aria-disabled', 'true');
		} else element.removeAttribute('aria-disabled');
		if (item.isPixelated) {
			element.classList.add('pixelated');
		}
	}

	updateRecolorAvailability() {
		const items = new Map(this.getAllContent().map(item => [String(item.id), item]));
		this.browser.elements.browser.querySelectorAll('.asset-option[data-id]').forEach(element => {
			const item = items.get(element.dataset.id);
			if (item) this.customizeItemElement(element, item);
		});
	}

	matchesChildFilters(item) {
		if (!item.tags) return false;

		const tags = item.tags.map(t => t.toLowerCase());

		// Tone filter
		if (this.activeFilters.tones.size > 0) {
			const hasTone = [...this.activeFilters.tones].some(tone =>
				tags.includes(tone.toLowerCase())
			);
			if (!hasTone) return false;
		}

		if (this.activeFilters.intensities.size > 0) {
			const hasIntensity = [...this.activeFilters.intensities].some((intensity) =>
				tags.includes(intensity.toLowerCase())
			);
			if (!hasIntensity) return false;
		}

		if (this.activeFilters.temperatures.size > 0) {
			const hasTemperature = [...this.activeFilters.temperatures].some((temperature) =>
				tags.includes(temperature.toLowerCase())
			);
			if (!hasTemperature) return false;
		}

		// Special filter
		if (this.activeFilters.special.size > 0) {
			const hasSpecial = [...this.activeFilters.special].some(special =>
				tags.includes(special.toLowerCase())
			);
			if (!hasSpecial) return false;
		}

		return true;
	}

	handleItemClick(item) {
		return this.selectGlitter(item.id);
	}

	async loadContent() {
		this.content = [];
		try {
			await this.loadIndexedManifest({
				indexPath: 'data/glitter.index.json',
				fallbackPath: 'data/glitter.json',
				detailBasePath: 'data/glitter',
				defaults: {
					brightness: null,
					sortOrder: 0,
					hue: null,
					colorCodes: [],
					colorWeights: null,
					frameCount: 0,
					frameRate: 10,
					isVariableFramerate: false,
					isAnimated: false,
					hasTransparency: false,
					width: 0,
					height: 0,
					fileSize: 0,
					category: 'Uncategorized',
					isPixelated: false,
					tags: [],
					source: 'preset'
				}
			});

			dbg(`Loaded ${this.content.length} swatches`);

			// Populate category chips after loading
			this.populateCategoryChips();

		} catch (error) {
			console.error('Failed to load swatches:', error);
			this.editor.showError('Failed to load glitter library');
		}
	}

	async selectGlitter(id) {
		if (this.editor.glitterRecolor?.pickerSession) {
			await this.editor.glitterRecolor.pick(this.getItemById(id));
			return;
		}
		if (this.getItemById(id)?.recipe) {
			this.editor.glitterRecolor.selectedId = id;
			this.browser.refresh();
			if (!this.editor.originalImage) return;
		}
		if (!this.editor.originalImage) {
			this.editor.showError('Please load an image first');
			return;
		}
		if (this.editor.autoGlitterManager?.hasActivePickerSession()) {
			this.editor.autoGlitterManager.selectPickerGlitter(id);
			return;
		}
		if (this.editor.autoGlitterManager?.isSessionActive()) {
			this.editor.updateStatus('Choose a Color Match swatch before selecting glitter');
			return;
		}

		const layer = this.editor.layerManager.getActiveLayer();
		if (!layer) {
			this.editor.updateStatus('Select a layer before choosing a glitter');
			return;
		}
		if (!this.editor.canEditLayer(layer, { notify: true })) return;

		const picker = getLayerManagerForType(this.editor, layer.type)?.slotPicker;
		if (!picker) {
			this.editor.showError('This layer has no glitter paint slot');
			return;
		}
		const glitter = await this.ensureAssetDetails(id);
		if (!glitter) {
			this.editor.showError('Failed to load selected glitter #' + id);
			return;
		}
		await this.ensureAssetImageReady(glitter);
		const target = picker.getTarget(layer);
		if (!picker.applyPick(layer, id)) return;
		await picker.pendingPick;
		this.editor.updateGlitterSelection();
		this.editor.layerManager.renderLayersList();
		this.editor.updateActionButtons();
		this.editor.saveState('Edit glitter');
		this.editor.updateStatus(`Selected ${glitter.name} for the ${picker.typeWord} ${getPaintSlotLabel(layer.type, target)}`);
		window.dispatchEvent(new CustomEvent('layerChanged'));


		if (glitter) {
			this.editor.updateGlitterAssetInfo(glitter);
		}

		// Keep the asset-info thumbnail + swatches in sync with the layer's hue
		// (identity after a fresh pick above, so this clears any prior tint).
		this.editor.refreshGlitterSwatchVisuals(layer);

		// Update helpful message
		this.editor.updateHelpfulMessage();

	}

	updateSelection() {
		const customId = this.editor.glitterRecolor?.selectedId;
		if (customId && this.browser?.currentCategoryId === 'custom') {
			document.querySelectorAll('#glitterBrowser .asset-option').forEach(option => option.classList.toggle('selected', option.dataset.id === customId));
			return;
		}
		const autoGlitterId = this.editor.autoGlitterManager?.getPickerGlitterId();
		if (autoGlitterId != null) {
			document.querySelectorAll('#glitterBrowser .asset-option').forEach((option) => {
				option.classList.toggle('selected', String(option.dataset.id) === String(autoGlitterId));
			});
			return;
		}
		// Delegate to main editor's update method
		this.editor.updateGlitterSelection();
	}

	setupFilterChips() {
		// Static facet chips are wired by ContentManager; dynamic category
		// chips bind when populateCategoryChips creates them.
	}

}
