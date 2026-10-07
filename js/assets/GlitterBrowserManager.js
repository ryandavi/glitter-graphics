// Asset lookup, browsing and uploads are independent of layer rendering.
class GlitterBrowserManager extends ContentManager {
	constructor(editor) {
		super(editor);
		this.useBrowser = true;
		Object.assign(this.activeFilters, { tones: new Set(), intensities: new Set(), temperatures: new Set(), special: new Set() });
	}

	setupUI() { this.ui = getAssetBrowserUi('glitter'); }

	getLayerType() { return LayerType.GLITTER_FILL; }

	getProjectAssetIds(layers) {
		return layers.flatMap((layer) => getLayerPaintSlots(layer)
			.map(({ data, renders }) => (renders && data.mode === 'glitter' ? data.glitterId : null)));
	}

	async initBrowser() {
		this.browser = new AssetBrowser(this, 'glitter');
		await this.browser.init('data/glitter-categories.json');
	}

	customizeItemElement(element, item) {
		if (item.isPixelated) {
			element.classList.add('pixelated');
		}
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
		this.selectGlitter(item.id);
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
			this.editor.showError('Please select a glitter or text layer');
			return;
		}
		if (!this.editor.canEditLayer(layer, { notify: true })) return;

		// Types whose paints are all declared slots route picks through their
		// SlotGlitterPicker (js/ui/picker-session.js).
		const slotPicker = getLayerManagerForType(this.editor, layer.type)?.slotPicker || null;
		if (!slotPicker && layer.type !== LayerType.BASE_IMAGE && layer.type !== LayerType.GLITTER_FILL && layer.type !== LayerType.TEXT_GLITTER && layer.type !== LayerType.SHAPE && layer.type !== LayerType.STICKER) {
			this.editor.showError('You can only add glitter to a background or supported layer effect');
			return;
		}
		if (slotPicker) {
			const glitter = await this.ensureAssetDetails(id);
			if (!glitter) {
				this.editor.showError('Failed to load selected glitter #' + id);
				return;
			}
			await this.ensureAssetImageReady(glitter);
			if (!slotPicker.applyPick(layer, id)) return;
			this.editor.updateGlitterSelection();
			this.editor.layerManager.renderLayersList();
			this.editor.saveState('Edit glitter');
			this.editor.updateStatus(`Selected ${glitter.name}`);
			return;
		}
		const slotHost = {
			[LayerType.TEXT_GLITTER]: this.editor.textGlitterManager,
			[LayerType.SHAPE]: this.editor.shapeGlitterManager,
			[LayerType.STICKER]: this.editor.stickerManager
		}[layer.type];
		const previousGlitter = layer.type === LayerType.GLITTER_FILL
			? this.getItemById(layer.fill.glitterId)
			: null;
		const glitter = await this.ensureAssetDetails(id);

		if (!glitter) {
			this.editor.showError('Failed to load selected glitter #' + id);
			return;
		}

		// Keep the current fill painted until the browser has decoded the first
		// frame of its replacement. Preview shows the GIF file itself; its tile
		// size comes from the manifest, so no frames are decoded here.
		await this.ensureAssetImageReady(glitter);

		if (layer.type === LayerType.BASE_IMAGE) {
			const sparkles = this.editor.baseBackgroundManager?.getGlitterSelectionTarget() === 'sparkles'
				? layer.background.sparkles
				: null;
			if (sparkles) {
				sparkles.glitterId = id;
				sparkles.mode = 'glitter';
				sparkles.colorAdjust = null;
			} else {
				layer.background.glitterId = id;
				layer.background.mode = 'glitter';
				layer.background.colorAdjust = normalizeColorAdjust(null);
			}
		} else if (slotHost) {
			// Text, shape and sticker: the pick goes to the armed slot (text and
			// shape fall back to their fill), resolved through its declared path.
			// Picking a glitter for a solid slot is the statement "I want glitter
			// here", so the slot flips to glitter, and a new swatch starts with no
			// hue/sat/bright shift.
			const target = slotHost.getGlitterSelectionTarget(layer);
			const slotData = target ? slotHost.fieldHost.ensureSlot(layer, target) : null;
			if (!slotData) return;
			slotData.glitterId = id;
			slotData.mode = 'glitter';
			slotData.colorAdjust = null;
		} else if (layer.type === LayerType.GLITTER_FILL) {
			// Auto Glitter layers use their swatch as the initial name. Keep that
			// generated name live, while preserving names the user entered.
			const slot = this.editor.glitterManager.getGlitterSelectionSlot(layer);
			if (slot === layer.fill) {
				if (layer.name === previousGlitter?.name) layer.name = glitter.name;
				layer.fill.glitterId = id;
				layer.fill.mode = 'glitter';
				// Picking a new swatch is a clean slate: drop any hue/sat/bright shift so
				// the new glitter shows its true colors, and sync the HSB sliders to match.
				layer.fill.colorAdjust = normalizeColorAdjust(null);
				syncFieldControls(this.editor.glitterManager.fieldHost, layer);
			} else {
				slot.glitterId = id;
				slot.mode = 'glitter';
				slot.colorAdjust = null;
				this.editor.glitterManager.renderLayer(layer, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
				syncFieldControls(this.editor.glitterManager.fieldHost, layer);
			}
		}

		this.editor.updateGlitterSelection();
		this.editor.layerManager.renderLayersList();
		if (layer.type === LayerType.GLITTER_FILL) this.editor.glitterManager.updatePickerStrip();

		if (layer.type === LayerType.BASE_IMAGE) {
			this.editor.requestPreviewUpdate();
			this.editor.baseBackgroundManager?.loadLayerSettings(layer);
			this.editor.baseBackgroundManager?.updatePickerStrip();
		} else if (layer.type === LayerType.TEXT_GLITTER) {
			await this.editor.textGlitterManager?.refreshLayer(layer, {
				saveHistory: false,
				refreshLayerList: false,
				refreshPreview: false
			});
		} else if (layer.type === LayerType.SHAPE) {
			this.editor.shapeGlitterManager?.renderLayer(layer);
			this.editor.shapeGlitterManager?.loadLayerSettings(layer);
			this.editor.shapeGlitterManager?.updatePickerStrip();
		} else if (layer.type === LayerType.STICKER) {
			this.editor.stickerManager?.renderLayer(layer);
			this.editor.stickerManager?.loadLayerSettings(layer);
		} else if (hasMaskContent(layer)) {
			this.editor.requestPreviewUpdate();
		}

		this.editor.updateActionButtons();
		this.editor.saveState('Edit glitter');
		if (layer.type === LayerType.TEXT_GLITTER && this.editor.textGlitterManager) {
			const target = this.editor.textGlitterManager.getGlitterSelectionTarget(layer);
			this.editor.updateStatus(`Selected ${glitter.name} for the text ${getPaintSlotLabel(layer.type, target)}`);
		} else {
			this.editor.updateStatus(`Selected ${glitter.name}`);
		}
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
