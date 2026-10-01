// ============================================
// GLITTER MANAGER CLASS
// Handles glitter library, filtering, rendering, and logic
// ============================================
class GlitterManager extends ContentManager {
	// Every glitter a visible paint slot of any layer draws with (fills,
	// outlines, shadows, sparkles, the canvas background).
	getProjectAssetIds(layers) {
		return layers.flatMap((layer) => getLayerPaintSlots(layer)
			.map(({ data, renders }) => (renders && data.mode === 'glitter' ? data.glitterId : null)));
	}

	constructor(editor) {
		super(editor);

		// Add glitter-specific filters to base activeFilters
		Object.assign(this.activeFilters, {
			tones: new Set(),
			intensities: new Set(),
			temperatures: new Set(),
			special: new Set()
		});

		this.useBrowser = true;
		this.layerElements = new Map();
		this.layerTransforms = new Map();
		this.maskBoundsCache = new Map();
		// Encoded mask PNG per fill layer: { key, url, pending, fullApplied }.
		// Keyed by layer id and a content key, so an undo that restores the same
		// layer keeps its URL, and an in-flight encode lands on whichever layer
		// object is current. Entries for deleted layers are revoked on render.
		this.maskImages = new Map();
		// One decoded data URL per derived effect mask. A changed mask is decoded
		// before it replaces the visible one, so painting never flashes unmasked.
		this.effectMaskImages = new Map();
		this.pickerSession = null;

		// G-1: tracks in-flight mask encodes per layer (for the busy cursor / status)
		// and the timestamp of the click that kicked off the current mask request
		// (for click->applied latency instrumentation).
		this.maskPendingCounts = new Map();
		this.maskRequestStarts = new Map();

	}

	// ===== G-1: mask pipeline instrumentation & busy-state helpers =====

	markMaskRequestStart(layerId) {
		this.maskRequestStarts.set(layerId, performance.now());
	}

	isMaskPending(layerId) {
		return (this.maskPendingCounts.get(layerId) || 0) > 0;
	}

	_incrementMaskPending(layerId) {
		const next = (this.maskPendingCounts.get(layerId) || 0) + 1;
		this.maskPendingCounts.set(layerId, next);
		this.editor.onMaskPendingChange?.(layerId, true);
	}

	_decrementMaskPending(layerId) {
		const next = (this.maskPendingCounts.get(layerId) || 0) - 1;
		if (next <= 0) {
			this.maskPendingCounts.delete(layerId);
			this.editor.onMaskPendingChange?.(layerId, false);
		} else {
			this.maskPendingCounts.set(layerId, next);
		}
	}

async initBrowser() {
	this.browser = new AssetBrowser(this, 'glitter');
	
	await this.browser.init('data/glitter-categories.json');
}

	getLayerType() {
		return LayerType.GLITTER_FILL;
	}

	setupUI() {
		this.ui = {
			...getAssetBrowserUi('glitter'),
			gallerySection: document.getElementById('designGallerySection'),
			pickerStrip: document.getElementById('galleryPickerStrip'),
			pickerStripTitle: document.getElementById('galleryPickerStripTitle'),
			pickerStripDetail: document.getElementById('galleryPickerStripDetail'),
			pickerStripDone: document.getElementById('galleryPickerStripDone'),
			resetEffects: document.getElementById('resetGlitterEffects')

		};
	}

	setupEventListeners() {
		// Call parent to setup base listeners
		super.setupEventListeners();

		// Setup filter chips
		this.setupFilterChips();
		this.setupFillSourceControls();
		this.fieldHost = this.createFieldHost();
		bindFieldControls(this.fieldHost);
		this.ui.resetEffects?.addEventListener('click', () => {
			const layer = this.fieldHost.getLayer();
			if (!layer) return;
			layer.border = null;
			layer.shadow = null;
			layer.sparkles = null;
			delete layer.effectDrafts;
			this.renderLayer(layer, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
			syncFieldControls(this.fieldHost, layer);
			this.editor.layerManager.renderLayersList();
			this.editor.saveState('Reset fill effects');
		});
		this.ui.pickerStripDone?.addEventListener('click', () => {
			if (this.hasActivePickerSession()) this.handlePickerDone();
		});
	}

	// slot: null for the fill itself, 'sparkles' for the sparkles slot.
	armAssetPicker(slot = null) {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.GLITTER_FILL) return;
		pickerOpenSession(this, { layerId: layer.id, slot }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => revealAssetBrowser(this.editor, this, (slot ? layer[slot] : layer.fill)?.glitterId)
		});
	}

	// The slot data the next gallery pick writes to.
	getGlitterSelectionSlot(layer) {
		const slot = this.hasActivePickerSession() ? this.pickerSession.slot : null;
		return slot && layer[slot] ? layer[slot] : layer.fill;
	}

	hasActivePickerSession() {
		const layer = this.editor.layerManager.getActiveLayer();
		return Boolean(layer?.type === LayerType.GLITTER_FILL && this.pickerSession?.layerId === layer.id);
	}

	updatePickerStrip() {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.GLITTER_FILL) return;
		if (this.pickerSession && this.pickerSession.layerId !== layer.id) pickerCloseSession(this);
		const armed = this.hasActivePickerSession();
		const copy = formatPickerStripText((armed && this.pickerSession.slot) || 'fill', layer.name, 'fill layer');
		renderPickerStrip({ ownsStrip: true, visible: true, armed, hint: !armed, ...copy });
	}

	handlePickerDone() {
		const focusIds = { border: 'glitterBorderGlitterChip', shadow: 'glitterShadowGlitterChip', sparkles: 'glitterSparklesGlitterChip' };
		const focusId = focusIds[this.pickerSession?.slot] || 'glitterAssetThumbnail';
		this.closePickerSession();
		returnFromPickerToProperties(this.editor, { section: 'glitterSettings', focusId });
	}

	closePickerSession() {
		pickerCloseSession(this, {
			refresh: () => this.updatePickerStrip(),
			updateSelection: () => this.editor.updateGlitterSelection()
		});
	}

	setupFillSourceControls() {
		if (!document.getElementById('glitterFillSolid')) return;
		const active = () => {
			const layer = this.editor.layerManager.getActiveLayer();
			return layer?.type === LayerType.GLITTER_FILL ? layer : null;
		};
		const refreshLayerPresentation = (layer) => {
			const selectedGlitter = this.getItemById(layer.fill.glitterId);
			if (layer.fill.mode !== 'glitter' && layer.name === selectedGlitter?.name) layer.name = null;
			this.renderLayer(layer, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
			this.editor.layerManager.renderLayersList();
			this.updatePickerStrip();
		};
		['glitter', 'solid'].forEach((mode) => document.getElementById(`glitterFill${mode[0].toUpperCase()}${mode.slice(1)}`).addEventListener('click', () => {
			const layer = active();
			if (!layer) return;
			layer.fill.mode = mode;
			syncPaintSlotSourceUI(document.getElementById(`glitterFill${mode[0].toUpperCase()}${mode.slice(1)}`), mode);
			refreshLayerPresentation(layer);
			this.editor.saveState('Edit glitter');
		}));
		const color = document.getElementById('glitterFillColor');
		color.addEventListener('input', () => { const layer = active(); if (!layer) return; layer.fill.mode = 'solid'; layer.fill.color = color.value; refreshLayerPresentation(layer); });
		color.addEventListener('change', () => this.editor.saveState('Edit glitter'));
		installEffectGradientEditor({
			prefix: 'glitterFill',
			getData: () => active()?.fill || null,
			onUpdate: (commit) => { const layer = active(); if (!layer) return; refreshLayerPresentation(layer); if (commit) this.editor.saveState('Edit glitter'); }
		});
		bindSlotTextureCoordinateControls({
			prefix: 'glitterFill',
			getLayer: active,
			getData: (layer) => layer.fill,
			render: refreshLayerPresentation,
			save: () => this.editor.saveState('Edit glitter')
		});
	}

	setupFilterChips() {
		// Static facet chips are wired by ContentManager; dynamic category
		// chips bind when populateCategoryChips creates them.
	}


	createLayer(options = {}) {
		// skipLimitCheck: Auto Glitter session layers may transiently overlap
		// the previous batch they replace; the session enforces capacity itself.
		if (!options.skipLimitCheck && !this.editor.layerManager.requireLayerCapacity()) return null;

		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: this.getLayerType(),
			visible: true,
			locked: false,
			opacity: FIELDS.layerOpacity.value,
			maskVersion: 0,
			maskHasContent: false,
			selections: [],
			fill: this.getDefaultFill(),
			settings: {
				threshold: FIELDS.threshold.value,
				feather: FIELDS.feather.value,
				contiguous: false,
				invert: false,
				multiSelect: false
			},
			border: null,
			shadow: null,
			sparkles: null
		};
		layer.transform = createDefaultTransform({
			position: {
				x: (this.editor.originalCanvas?.width || 0) / 2,
				y: (this.editor.originalCanvas?.height || 0) / 2
			}
		});

		return layer;
	}

	getDefaultFill() {
		return {
			...buildDefaultFill({ defaultGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId.glitterLayer }),
			gradient: normalizeEffectGradient(CONFIG.rendering.gradient)
		};
	}

	getDefaultBorder() {
		return buildDefaultBorder({
			config: CONFIG.tools.glitter.border,
			slot: getPaintSlotDefinition(LayerType.GLITTER_FILL, 'border'),
			fallbackMode: 'glitter',
			defaultGlitterId: CONFIG.tools.glitter.defaults.borderGlitterId.glitterLayer,
			includeColorAdjust: true
		});
	}

	getDefaultShadow() {
		return buildDefaultShadow({
			defaultMode: 'glitter',
			defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId.glitterLayer,
			includeColorAdjust: true
		});
	}

	getSlotDefaults(key) {
		if (key === 'border') return this.getDefaultBorder();
		if (key === 'shadow') return this.getDefaultShadow();
		if (key === 'sparkles') return buildDefaultSparkles();
		return this.getDefaultFill();
	}

	// Runs where a fill layer enters the document (deserialize, project load).
	normalizeLayer(layer) {
		if (layer?.type !== LayerType.GLITTER_FILL) return;
		layer.transform = cloneTransform(layer.transform || LAYER_UI_CONFIG[LayerType.GLITTER_FILL].defaultTransform(this.editor));
		layer.fill = mergeSlotEffectDefaults(layer.fill, this.getDefaultFill());
		normalizeSlotTextureCoordinates(layer.fill);
		if (layer.border) layer.border = mergeSlotEffectDefaults(layer.border, this.getDefaultBorder());
		if (layer.shadow) layer.shadow = mergeSlotEffectDefaults(layer.shadow, this.getDefaultShadow());
		normalizeSlotTextureCoordinates(layer.border);
		normalizeSlotTextureCoordinates(layer.shadow);
		layer.sparkles = normalizeSparklesData(layer.sparkles);
	}

	getMaskDimensions() {
		return {
			width: this.editor.originalCanvas?.width || 1,
			height: this.editor.originalCanvas?.height || 1
		};
	}

	getMaskLocalPoint(layer, point) {
		return canvasPointToLayerLocal(layer, point, this.getMaskDimensions());
	}

	_getMaskBounds(layer) {
		if (!layer || !this.editor.originalCanvas) return null;
		const key = this.editor.maskCompositor.getCacheKey(layer);
		const cached = this.maskBoundsCache.get(layer.id);
		if (cached?.key === key) return cached.bounds;

		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const mask = this.editor.maskCompositor.getMaskData(layer);
		let minX = width;
		let minY = height;
		let maxX = -1;
		let maxY = -1;
		for (let y = 0; y < height; y++) {
			const row = y * width;
			for (let x = 0; x < width; x++) {
				if (!mask[row + x]) continue;
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
			}
		}
		const bounds = maxX < minX ? null : {
			x: minX,
			y: minY,
			width: maxX - minX + 1,
			height: maxY - minY + 1
		};
		this.maskBoundsCache.set(layer.id, { key, bounds });
		return bounds;
	}

	_expandRect(rect, left, top = left, right = left, bottom = top) {
		if (!rect) return null;
		return {
			x: rect.x - left,
			y: rect.y - top,
			width: rect.width + left + right,
			height: rect.height + top + bottom
		};
	}

	getMaskFrame(layer) {
		const bounds = this._getMaskBounds(layer);
		if (!bounds) return null;
		const border = getLayerPaintSlots(layer).find((entry) => entry.renders && entry.role === 'border');
		const padding = border ? getBorderOutsidePadding(border.data) : 0;
		return frameFromCanvasRect(
			this._expandRect(bounds, padding),
			this.editor.originalCanvas.width,
			this.editor.originalCanvas.height
		);
	}

	getMaskVisualFrame(layer) {
		const bounds = this._getMaskBounds(layer);
		if (!bounds) return null;
		const body = this.getMaskFrame(layer);
		let rect = body ? {
			x: body.offsetX + this.editor.originalCanvas.width / 2 - body.width / 2,
			y: body.offsetY + this.editor.originalCanvas.height / 2 - body.height / 2,
			width: body.width,
			height: body.height
		} : bounds;
		const shadow = getLayerPaintSlots(layer).find((entry) => entry.renders && entry.role === 'shadow');
		if (shadow) {
			const reach = getShadowReach(shadow.data);
			const shadowRect = this._expandRect(bounds, reach);
			shadowRect.x += Number(shadow.data.offsetX) || 0;
			shadowRect.y += Number(shadow.data.offsetY) || 0;
			rect = unionRects(rect, shadowRect);
		}
		return frameFromCanvasRect(rect, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
	}

	hitTest(layer, x, y, tolerance = 0) {
		if (!hasMaskContent(layer) || !this.editor.originalCanvas) return false;
		if (layer.fill?.mode === 'none' || layer.opacity <= 0) return false;
		const point = this.getMaskLocalPoint(layer, { x, y });
		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const transform = getLayerTransform(layer);
		const smallestScale = Math.max(0.01, Math.min(
			Math.abs((transform.scale.x || 100) / 100),
			Math.abs((transform.scale.y || 100) / 100)
		));
		const border = getLayerPaintSlots(layer).find((entry) => entry.renders && entry.role === 'border');
		const radius = Math.ceil(tolerance / smallestScale + (border ? getBorderOutsidePadding(border.data) : 0));
		const centerX = Math.floor(point.x);
		const centerY = Math.floor(point.y);
		const mask = this.editor.maskCompositor.getMaskData(layer);
		for (let localY = centerY - radius; localY <= centerY + radius; localY++) {
			if (localY < 0 || localY >= height) continue;
			for (let localX = centerX - radius; localX <= centerX + radius; localX++) {
				if (localX < 0 || localX >= width) continue;
				if (mask[localY * width + localX]) return true;
			}
		}
		return false;
	}

	// Sparkles read the layer's painted mask, in document px.
	getSparkleHost(layer) {
		const canvas = this.editor.originalCanvas;
		if (!canvas?.width || !this.editor.maskCompositor) return null;
		return {
			key: `fill:${layer.id}:${this.editor.maskCompositor.getCacheKey(layer)}`,
			width: canvas.width,
			height: canvas.height,
			loadPixels: () => this.editor.maskCompositor.getMaskCanvas(layer)
		};
	}

	// How the declared field binder edits a fill layer's effect slots. The fill
	// itself keeps its legacy bindings (editor-panels.js).
	createFieldHost() {
		const active = () => {
			const layer = this.editor.layerManager.getActiveLayer();
			return layer?.type === LayerType.GLITTER_FILL ? layer : null;
		};
		const render = (layer) => this.renderLayer(layer, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
		return {
			type: LayerType.GLITTER_FILL,
			editor: this.editor,
			getLayer: active,
			ensureSlot: (layer, key) => ensureLayerPaintSlot(layer, key, () => this.getSlotDefaults(key)),
			getSlotDefaults: (key) => this.getSlotDefaults(key),
			apply: (layer, mutate, change) => {
				mutate();
				render(layer);
				if (change.live) return;
				syncFieldControls(this.fieldHost, layer);
				this.editor.layerManager.renderLayersList();
				this.editor.saveState('Edit fill effect');
			},
			render,
			commit: () => this.editor.saveState('Edit fill effect'),
			armPicker: (key) => this.armAssetPicker(key),
			getArmedSlot: () => (this.hasActivePickerSession() ? this.pickerSession.slot || null : null)
		};
	}

	customizeItemElement(element, item) {
		if (item.isPixelated) {
			element.classList.add('pixelated');
		}
	}

	// ===== FILTERING =====


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



	// ===== LOADING & PARSING =====

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

	// ===== SELECTION LOGIC =====

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
		} else if (layer.type === LayerType.TEXT_GLITTER && this.editor.textGlitterManager) {
			// Picking a new swatch is a clean slate — drop that slot's hue/sat/bright.
			// Intent capture: picking a glitter for a solid-mode slot IS the
			// statement "I want glitter here", so flip the slot to glitter.
			// Otherwise the gallery click writes the glitter id, highlights
			// the swatch, and saves history with zero visible change.
			const target = this.editor.textGlitterManager.getGlitterSelectionTarget(layer) || 'fill';
			const slotData = this.editor.textGlitterManager.ensureEffectData(layer, target);
			if (slotData) {
				slotData.glitterId = id;
				slotData.mode = 'glitter';
				slotData.colorAdjust = null;
			}
		} else if (layer.type === LayerType.SHAPE) {
			// Each slot (fill, border, shadow) stores its own glitterId.
			const sgm = this.editor.shapeGlitterManager;
			const target = sgm?.getGlitterSelectionTarget?.() || 'fill';
			if (sgm) {
				const slotData = sgm.ensureEffectData(layer, target);
				slotData.mode = 'glitter';
				slotData.glitterId = id;
				// Fresh swatch → reset that slot's hue/sat/bright.
				slotData.colorAdjust = null;
			}
		} else if (layer.type === LayerType.STICKER) {
			const target = this.editor.stickerManager?.getGlitterSelectionTarget(layer);
			const effect = target ? layer.stickerData?.[target] : null;
			if (!effect) return;
			effect.glitterId = id;
			effect.mode = 'glitter';
			effect.colorAdjust = null;
		} else if (layer.type === LayerType.GLITTER_FILL) {
			// Auto Glitter layers use their swatch as the initial name. Keep that
			// generated name live, while preserving names the user entered.
			const slot = this.getGlitterSelectionSlot(layer);
			if (slot === layer.fill) {
				if (layer.name === previousGlitter?.name) layer.name = glitter.name;
				layer.fill.glitterId = id;
				layer.fill.mode = 'glitter';
				// Picking a new swatch is a clean slate: drop any hue/sat/bright shift so
				// the new glitter shows its true colors, and sync the HSB sliders to match.
				layer.fill.colorAdjust = normalizeColorAdjust(null);
				this.editor.applyColorAdjustToSliders('glitter', layer.fill.colorAdjust);
			} else {
				slot.glitterId = id;
				slot.mode = 'glitter';
				slot.colorAdjust = null;
				this.renderLayer(layer, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
				syncFieldControls(this.fieldHost, layer);
			}
		}

		this.editor.updateGlitterSelection();
		this.editor.layerManager.renderLayersList();
		if (layer.type === LayerType.GLITTER_FILL) this.updatePickerStrip();

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
			if (target === 'border' || target === 'shadow' || target === 'backgroundFill') {
				const targetName = target === 'backgroundFill' ? 'background' : target;
				this.editor.updateStatus(`Selected ${glitter.name} for the text ${targetName}`);
			} else {
				this.editor.updateStatus(`Selected ${glitter.name} for the text fill`);
			}
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

	// ===== RENDERING (CANVAS/DOM) =====

	updateSelection() {
		const autoGlitterId = this.editor.autoGlitterManager?.getPickerGlitterId();
		if (autoGlitterId != null) {
			document.querySelectorAll('#glitterItemGrid .asset-option, #glitterSearchResults .asset-option').forEach((option) => {
				option.classList.toggle('selected', String(option.dataset.id) === String(autoGlitterId));
			});
			return;
		}
		// Delegate to main editor's update method
		this.editor.updateGlitterSelection();
	}

	renderContent(layersToShow) {
		// Reconcile instead of ContentManager's clear-and-rebuild: recreating a
		// glitter element restarts its animated GIF background and reloads its
		// mask blob, which flashes the layer unmasked for a frame.
		const layerType = this.getLayerType();
		const width = this.editor.originalCanvas?.width;
		const height = this.editor.originalCanvas?.height;

		const keep = new Set();
		layersToShow.forEach((layer) => {
			if (layer.type === layerType) keep.add(layer.id);
		});

		Array.from(this.layerElements.keys()).forEach((layerId) => {
			if (!keep.has(layerId)) this.removeLayerElement(layerId);
		});
		this.pruneMaskImages();

		layersToShow.forEach((layer) => {
			if (layer.type === layerType) this.renderLayer(layer, width, height);
		});
	}

	// Hidden layers keep their URL; only layers gone from the document drop it.
	pruneMaskImages() {
		const existing = new Set(this.editor.layerManager.layers.map((layer) => layer.id));
		Array.from(this.maskImages.keys()).forEach((layerId) => {
			if (!existing.has(layerId)) this.revokeMaskImage(layerId);
		});
	}

	clearElements() {
		Array.from(this.layerElements.keys()).forEach((layerId) => this.removeLayerElement(layerId));
	}

	getSlotStack(layer) {
		return buildSlotStack(layer, (entry) => {
			const source = resolvePaintSlotPreviewSource(this.editor, layer, entry);
			return entry.key === 'fill' && source ? { ...source, opacity: 1 } : source;
		});
	}

	getSlotMask(layer, item, fillMask, baseKey = this.editor.maskCompositor.getCacheKey(layer)) {
		if (item.key === 'fill') return { canvas: fillMask, cacheKey: `${baseKey}|fill` };
		if (item.role === 'border') {
			const data = item.data;
			return {
				canvas: createBorderMaskCanvas(fillMask, data),
				cacheKey: `${baseKey}|border:${data.widthPx}:${getBorderPlacement(data)}:${getBorderEdgeStyle(data)}:${Boolean(data.fillEnclosed)}`
			};
		}
		if (item.role === 'shadow') {
			const spread = Math.round(item.data.spread || 0);
			const blur = Math.round(item.data.blur || 0);
			return {
				canvas: createShadowMaskCanvas(fillMask, spread, blur),
				cacheKey: `${baseKey}|shadow:${spread}:${blur}`
			};
		}
		return null;
	}

	renderSlotMasks(layer, fillMask = null) {
		const mask = fillMask || this.editor.maskCompositor.getMaskCanvas(layer);
		const masks = { fill: mask, renderWidth: mask.width, renderHeight: mask.height };
		getLayerPaintSlots(layer).forEach((entry) => {
			if (!entry.renders || entry.key === 'fill' || entry.role === 'sparkles') return;
			const item = { key: entry.key, role: entry.role, data: entry.data };
			const slotMask = this.getSlotMask(layer, item, mask)?.canvas || null;
			masks[entry.key] = entry.role === 'shadow' && slotMask
				? createOffsetMaskCanvas(slotMask, entry.data.offsetX || 0, entry.data.offsetY || 0)
				: slotMask;
		});
		return masks;
	}

	getEffectMaskUrl(layer, item, mask) {
		if (!mask?.canvas) return null;
		const slotKey = `${layer.id}|${item.key}`;
		const cached = this.effectMaskImages.get(slotKey);
		if (cached?.key === mask.cacheKey) return cached.url || null;
		if (cached?.pendingKey !== mask.cacheKey) {
			const url = mask.canvas.toDataURL('image/png');
			this.effectMaskImages.set(slotKey, { ...cached, pendingKey: mask.cacheKey });
			const image = new Image();
			image.onload = () => {
				const pending = this.effectMaskImages.get(slotKey);
				if (pending?.pendingKey !== mask.cacheKey) return;
				this.effectMaskImages.set(slotKey, { key: mask.cacheKey, url });
				const current = this.editor.layerManager.getLayerById(layer.id);
				if (current?.type === LayerType.GLITTER_FILL) {
					this.renderLayer(current, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
				}
			};
			image.src = url;
		}
		return cached?.url || null;
	}

	renderLayer(layer, width = this.editor.originalCanvas?.width, height = this.editor.originalCanvas?.height, options = {}) {
		if (layer.type !== LayerType.GLITTER_FILL) return;
		if (layer.fill.mode === 'glitter' && !this.getItemById(layer.fill.glitterId)) return;

		let wrapper = this.layerElements.get(layer.id);
		let stack = wrapper?.querySelector('.glitter-fill-stack');

		if (!wrapper) {
			// 1. Create the WRAPPER
			// This handles the drop-shadow filter and selection
			wrapper = document.createElement('div');
			wrapper.className = 'glitter-element';
			wrapper.dataset.layerId = layer.id;
			wrapper.setAttribute('role', 'img');
		}

		if (!stack) {
			// Reconcile effects in place so changing a control never restarts an
			// animated glitter source or briefly drops its decoded mask.
			stack = document.createElement('div');
			stack.className = 'glitter-fill-stack';
			wrapper.replaceChildren(stack);
		}

		const draftMask = Boolean(options.draftMask);
		const fillMask = this.editor.maskCompositor.getMaskCanvas(layer, { draft: draftMask });
		const fillMaskKey = this.editor.maskCompositor.getCacheKey(layer, { draft: draftMask });

		const maskObjectUrl = this.getMaskObjectUrlForLayer(layer, width, height, options);
		reconcileSlotStack(stack, this.getSlotStack(layer), {
			spanClassName: 'glitter-fill-content', width, height, layer, glitterLibrary: this,
			getMask: (item) => {
				const mask = this.getSlotMask(layer, item, fillMask, fillMaskKey);
				if (!mask?.canvas) return null;
				return { canvas: mask.canvas, url: item.key === 'fill' ? maskObjectUrl : this.getEffectMaskUrl(layer, item, mask) };
			}
		});
		const inner = stack.querySelector('[data-span-key="fill"]');
		if (inner) {
			inner.classList.add('glitter-background', 'visible');
			// Unconditional: a no-op for full-res masks, but required when the
			// currently-applied mask is a downscaled G-1c draft.
			inner.style.maskSize = '100% 100%';
			inner.style.webkitMaskSize = '100% 100%';
		}
		// 3. Assemble
		if (!wrapper.parentNode) {
			this.editor.canvasElementsContainer.appendChild(wrapper);
		}

		// Store reference
		this.layerElements.set(layer.id, wrapper);
		if (!this.layerTransforms.has(layer.id)) {
			const transform = new LayerTransform(layer, this.editor);
			transform.element = wrapper;
			this.layerTransforms.set(layer.id, transform);
		}
		syncLayerAnimationPreview(wrapper, layer, this.editor.animationTicker);
		// Sparkles sit beside the masked paint (inside the animation wrapper
		// when there is one), behind ones before it.
		reconcileSparkleLayers(stack, layer, { editor: this.editor, width, height, behindAnchor: inner });

		const transform = this.layerTransforms.get(layer.id);
		if (transform) {
			transform.layer = layer;
			transform.element = wrapper;
			transform.applyTransform(wrapper, { width, height });
			if (
				layer.id === this.editor.layerManager.activeLayerId &&
				this.editor.currentTool === ToolType.SELECT &&
				!this.editor.layerManager.hasMultiSelection() &&
				isLayerTransformable(layer) &&
				!layer.locked
			) {
				if (!transform.isDraggingHandle) transform.createTransformHandles();
			} else {
				transform.removeTransformHandles();
			}
		}

		// Update selection highlight for this layer if it's active
		this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);

	}

	// ===== MASKING UTILITIES =====

	releaseLayerResources(layer) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL) return;

		this.removeLayerElement(layer.id);
		this.revokeMaskImage(layer.id);
		this.editor.paintMaskStore?.removePaintMask(layer.id);
		this.editor.maskCompositor?.invalidate(layer.id);
		this.maskBoundsCache.delete(layer.id);
	}

	removeLayerElement(layerId) {
		const transform = this.layerTransforms.get(layerId);
		if (transform) {
			transform.destroy?.();
			this.layerTransforms.delete(layerId);
		}
		removeManagedLayerElement(this.layerElements, layerId);
	}

	updateTransform(layerId, updates) {
		const transform = this.layerTransforms.get(layerId);
		const layer = this.editor.layerManager.getLayerById(layerId);
		const element = this.layerElements.get(layerId);
		if (!transform || !layer || !element) return;
		transform.updateTransform(updates);
		transform.applyTransform(element, this.getMaskDimensions());
		if (transform.transformHandles) transform.updateHandlePositions();
	}

	centerHorizontal(layerId) {
		movableCenterHorizontal(this, layerId, (layer) => this.editor.loadTransformSettings(layer, 'glitter'));
	}

	centerVertical(layerId) {
		movableCenterVertical(this, layerId, (layer) => this.editor.loadTransformSettings(layer, 'glitter'));
	}

	alignToCanvas(layerId, mode) {
		movableAlignToCanvas(this, layerId, mode, (layer) => this.editor.loadTransformSettings(layer, 'glitter'));
	}

	resetTransform(layerId) {
		movableResetTransform(this, layerId, (layer) => this.editor.loadTransformSettings(layer, 'glitter'));
	}

	createTransformHandles(layerId) {
		movableCreateTransformHandles(this, layerId);
	}

	removeTransformHandles() {
		movableRemoveTransformHandles(this);
	}

	// LayerTransform calls this after every live transform edit. The stack stays
	// in mask-local pixels and is scaled inside the already-sized wrapper so
	// effect offsets and texture registration transform with the mask.
	syncElementScale(layer, wrapper = this.layerElements.get(layer?.id)) {
		const stack = wrapper?.querySelector('.glitter-fill-stack');
		if (!stack || !layer || !this.editor.originalCanvas) return;
		const transform = getLayerTransform(layer);
		stack.style.width = `${this.editor.originalCanvas.width}px`;
		stack.style.height = `${this.editor.originalCanvas.height}px`;
		stack.style.transformOrigin = '0 0';
		stack.style.transform = `scale(${(transform.scale.x || 100) / 100}, ${(transform.scale.y || 100) / 100})`;
		const fillMask = this.editor.maskCompositor.getMaskCanvas(layer);
		syncSlotStackTextureOrigins(stack, this.getSlotStack(layer), layer, (item) => (
			this.getSlotMask(layer, item, fillMask)?.canvas || fillMask
		));
	}

	revokeMaskImage(layerId) {
		const currentUrl = this.maskImages.get(layerId)?.url;
		if (currentUrl) {
			URL.revokeObjectURL(currentUrl);
		}
		this.maskImages.delete(layerId);
		Array.from(this.effectMaskImages.keys()).forEach((key) => {
			if (key.startsWith(`${layerId}|`)) this.effectMaskImages.delete(key);
		});
	}

	async ensureLayersPreviewAssetsReady(layers) {
		const glitterIds = new Set(layers
			.filter((layer) => layer.visible)
			.flatMap((layer) => getLayerSlotGlitterIds(layer)));

		await Promise.all([...glitterIds].map((id) => {
			const glitter = this.getItemById(id);
			return glitter ? this.ensureAssetImageReady(glitter) : null;
		}));
	}

	applyMaskObjectUrl(layerId, url) {
		const wrapper = this.layerElements.get(layerId);
		const inner = wrapper?.querySelector('.glitter-background');
		if (!inner) return;

		inner.style.maskImage = `url(${url})`;
		inner.style.webkitMaskImage = `url(${url})`;
		// Unconditional: a no-op for full-res masks, but required when this is
		// a downscaled G-1c draft (canvas is smaller than the element).
		inner.style.maskSize = '100% 100%';
		inner.style.webkitMaskSize = '100% 100%';
		inner.style.visibility = '';
	}

	getMaskObjectUrlForLayer(layer, width, height, options = {}) {
		const draftMask = Boolean(options.draftMask);
		const cacheKey = `${this.editor.maskCompositor.getCacheKey(layer, { draft: draftMask })}|${width}x${height}`;
		const currentCache = this.maskImages.get(layer.id);

		if (currentCache?.key === cacheKey) {
			return currentCache.url || null;
		}

		const requestStart = this.maskRequestStarts.get(layer.id);
		this.maskRequestStarts.delete(layer.id);

		const canvasStart = performance.now();
		const maskCanvas = this.editor.maskCompositor.getMaskCanvas(layer, { draft: draftMask });
		dbg(`[G-1] getMaskCanvas (${draftMask ? 'brush-draft' : 'full'}): ${(performance.now() - canvasStart).toFixed(1)}ms`);

		this.maskImages.set(layer.id, {
			key: cacheKey,
			url: currentCache?.url || null,
			pending: true,
			fullApplied: false
		});

		// G-1c: for a full-accuracy request (color-picker clicks — NOT brush
		// live-painting, which already gets its speed from MaskCompositor's own
		// draft mode skipping feather/caching), encode a downscaled draft PNG
		// first so glitter appears almost immediately, then silently replace it
		// with the full-resolution encode when that lands. Skipped when the
		// mask is already small enough that downscaling wouldn't help.
		const longestSide = Math.max(maskCanvas.width, maskCanvas.height);
		if (!draftMask && longestSide > 512) {
			this._encodeDraftMask(layer, maskCanvas, cacheKey);
		}

		this._encodeFullMask(layer, maskCanvas, cacheKey, requestStart);

		return currentCache?.url || null;
	}

	_encodeDraftMask(layer, sourceCanvas, cacheKey) {
		this._incrementMaskPending(layer.id);

		const maxSide = 512;
		const longest = Math.max(sourceCanvas.width, sourceCanvas.height);
		const scale = maxSide / longest;
		const draftCanvas = createAppCanvas(0, 0, 'layers/GlitterManager');
		draftCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
		draftCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
		draftCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0, draftCanvas.width, draftCanvas.height);

		const blobStart = performance.now();
		draftCanvas.toBlob((blob) => {
			dbg(`[G-1] draft toBlob: ${(performance.now() - blobStart).toFixed(1)}ms`);
			this._applyEncodedMaskBlob(layer, blob, cacheKey, { isDraft: true });
		}, 'image/png');
	}

	_encodeFullMask(layer, sourceCanvas, cacheKey, requestStart) {
		this._incrementMaskPending(layer.id);

		const blobStart = performance.now();
		sourceCanvas.toBlob((blob) => {
			dbg(`[G-1] full toBlob: ${(performance.now() - blobStart).toFixed(1)}ms`);
			this._applyEncodedMaskBlob(layer, blob, cacheKey, { isDraft: false, requestStart });
		}, 'image/png');
	}

	_applyEncodedMaskBlob(layer, blob, cacheKey, meta = {}) {
		const { isDraft = false, requestStart } = meta;

		if (!blob) {
			this._decrementMaskPending(layer.id);
			return;
		}

		const latestCache = this.maskImages.get(layer.id);
		if (!latestCache || latestCache.key !== cacheKey || (isDraft && latestCache.fullApplied)) {
			// Superseded by a newer click/generation, or the full-res encode for
			// this generation already won — never let a stale/lower-quality
			// draft regress an already-applied full-res mask.
			this._decrementMaskPending(layer.id);
			return;
		}

		const nextUrl = URL.createObjectURL(blob);

		// Decode the blob before touching the style and keep the old URL
		// alive until the swap lands — otherwise the element renders a
		// frame with a missing mask (visible flash while painting/picking).
		const decodeStart = performance.now();
		const img = new Image();
		img.onload = () => {
			dbg(`[G-1] ${isDraft ? 'draft' : 'full'} decode: ${(performance.now() - decodeStart).toFixed(1)}ms`);

			const cacheNow = this.maskImages.get(layer.id);
			if (!cacheNow || cacheNow.key !== cacheKey || (isDraft && cacheNow.fullApplied)) {
				URL.revokeObjectURL(nextUrl);
				this._decrementMaskPending(layer.id);
				return;
			}

			const previousUrl = cacheNow.url;
			this.maskImages.set(layer.id, {
				key: cacheKey,
				url: nextUrl,
				pending: cacheNow.pending,
				fullApplied: isDraft ? Boolean(cacheNow.fullApplied) : true
			});

			this.applyMaskObjectUrl(layer.id, nextUrl);

			if (previousUrl && previousUrl !== nextUrl) {
				URL.revokeObjectURL(previousUrl);
			}

			if (requestStart != null) {
				dbg(`[G-1] click -> applied (${isDraft ? 'draft' : 'full'}): ${(performance.now() - requestStart).toFixed(1)}ms`);
			}

			this._decrementMaskPending(layer.id);
		};
		img.onerror = () => {
			URL.revokeObjectURL(nextUrl);
			this._decrementMaskPending(layer.id);
		};
		img.src = nextUrl;
	}

	getSelectionCacheKey(layer) {
		return JSON.stringify([
			layer.selections,
			layer.settings.threshold,
			layer.settings.contiguous
		]);
	}

	// Pure: MaskCompositor caches the result per layer id.
	buildSelectionMask(layer) {
		const buildStart = performance.now();
		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const len = width * height;
		const mask = new Uint8Array(len);
		const thresholdSq = layer.settings.threshold * layer.settings.threshold;
		const data = this.editor.originalImageData.data;
		const alphaChannel = this.editor.originalAlphaChannel;

		layer.selections.forEach(sel => {
			if (layer.settings.contiguous) {
				const floodStart = performance.now();
				this.floodFill(mask, sel.x, sel.y, sel, thresholdSq);
				dbg(`[G-1] floodFill: ${(performance.now() - floodStart).toFixed(1)}ms`);
				return;
			}

			const scanStart = performance.now();
			for (let i = 0; i < len; i++) {
				if (mask[i] === 255) continue;

				if (sel.isTransparent) {
					if (alphaChannel[i] < CONFIG.tools.selection.transparency.alphaThreshold) {
						mask[i] = 255;
					}
					continue;
				}

				if (alphaChannel[i] < CONFIG.tools.selection.transparency.alphaThreshold) continue;

				const idx = i * 4;
				const r = data[idx];
				const g = data[idx + 1];
				const b = data[idx + 2];

				if (this.colorDistanceSq(r, g, b, sel.r, sel.g, sel.b) <= thresholdSq) {
					mask[i] = 255;
				}
			}
			dbg(`[G-1] non-contiguous scan: ${(performance.now() - scanStart).toFixed(1)}ms`);
		});

		dbg(`[G-1] buildSelectionMask total: ${(performance.now() - buildStart).toFixed(1)}ms`);
		return mask;
	}

	// Canvas resize: color-selection seeds live in canvas space, so they move
	// with the content. The painted part of the mask moves in PaintMaskStore.
	reanchorSelectionsForCanvasResize(offsetX, offsetY, layers) {
		(layers || []).forEach((layer) => {
			if (layer.type !== LayerType.GLITTER_FILL) return;
			// The sampled color (r/g/b) is unchanged; only the seed pixel moves.
			(layer.selections || []).forEach((sel) => {
				if (typeof sel.x === 'number') sel.x += offsetX;
				if (typeof sel.y === 'number') sel.y += offsetY;
			});
			this.editor.maskCompositor?.invalidate(layer.id);
		});
	}

	scaleSelectionsForCanvasResize(newWidth, newHeight, scaleX, scaleY, layers) {
		(layers || []).forEach((layer) => {
			if (layer.type !== LayerType.GLITTER_FILL) return;
			(layer.selections || []).forEach((selection) => {
				if (typeof selection.x === 'number') selection.x = Math.max(0, Math.min(newWidth - 1, Math.round(selection.x * scaleX)));
				if (typeof selection.y === 'number') selection.y = Math.max(0, Math.min(newHeight - 1, Math.round(selection.y * scaleY)));
			});
			this.editor.maskCompositor?.invalidate(layer.id);
		});
	}

	// Structural canvas resize shifts the authored mask inside a newly-sized
	// local surface. Compensate the layer placement for that local re-anchor so
	// a transformed mask follows the canvas content exactly once.
	reanchorTransformsForCanvasResize(oldWidth, oldHeight, newWidth, newHeight, offsetX, offsetY, layers) {
		(layers || []).forEach((layer) => {
			if (layer.type !== LayerType.GLITTER_FILL || !layer.transform) return;
			const transform = getLayerTransform(layer);
			const localShiftX = oldWidth / 2 + offsetX - newWidth / 2;
			const localShiftY = oldHeight / 2 + offsetY - newHeight / 2;
			const scaleX = ((transform.scale.x || 100) / 100) * (transform.flipX ? -1 : 1);
			const scaleY = ((transform.scale.y || 100) / 100) * (transform.flipY ? -1 : 1);
			const rotation = (transform.rotation || 0) * Math.PI / 180;
			const scaledX = localShiftX * scaleX;
			const scaledY = localShiftY * scaleY;
			const worldShiftX = scaledX * Math.cos(rotation) - scaledY * Math.sin(rotation);
			const worldShiftY = scaledX * Math.sin(rotation) + scaledY * Math.cos(rotation);
			transform.position.x += offsetX - worldShiftX;
			transform.position.y += offsetY - worldShiftY;
		});
	}

	floodFill(mask, startX, startY, targetColor, thresholdSq) {
		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const totalPixels = width * height;
		const data = this.editor.originalImageData.data;
		const alphaChannel = this.editor.originalAlphaChannel;

		// The stack contains the 1D index of the pixel
		const stack = [startY * width + startX];

		while (stack.length > 0) {
			const idx = stack.pop();

			// 1. Skip if this pixel is already marked in the mask
			if (mask[idx] === 255) continue;

			const r = data[idx * 4];
			const g = data[idx * 4 + 1];
			const b = data[idx * 4 + 2];
			const alpha = alphaChannel[idx];

			let isMatch = false;

			// 2. DECISION LOGIC: 
			// If we are looking for transparency vs looking for a specific color
			if (targetColor.isTransparent) {
				// Match only if the current pixel is also transparent
				isMatch = (alpha < CONFIG.tools.selection.transparency.alphaThreshold);
			} else {
				// Match only if the current pixel is OPAQUE and the color is within the threshold
				isMatch = (alpha >= CONFIG.tools.selection.transparency.alphaThreshold &&
					this.colorDistanceSq(r, g, b, targetColor.r, targetColor.g, targetColor.b) <= thresholdSq);
			}

			if (isMatch) {
				// Mark the pixel as part of the mask
				mask[idx] = 255;

				// 3. ADD NEIGHBORS (Right, Left, Down, Up)
				// Check bounds to prevent wrapping around the edges of the image

				// Right
				if ((idx + 1) % width !== 0 && mask[idx + 1] === 0) {
					stack.push(idx + 1);
				}
				// Left
				if (idx % width !== 0 && mask[idx - 1] === 0) {
					stack.push(idx - 1);
				}
				// Down
				if (idx + width < totalPixels && mask[idx + width] === 0) {
					stack.push(idx + width);
				}
				// Up
				if (idx - width >= 0 && mask[idx - width] === 0) {
					stack.push(idx - width);
				}
			}
		}
	}

	applyFeatherToMask(mask, radius) {
		if (radius <= 0) return;

		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const horizontal = new Float32Array(mask.length);

		for (let y = 0; y < height; y++) {
			const rowOffset = y * width;
			const prefix = new Uint32Array(width + 1);

			for (let x = 0; x < width; x++) {
				prefix[x + 1] = prefix[x] + mask[rowOffset + x];
			}

			for (let x = 0; x < width; x++) {
				const left = Math.max(0, x - radius);
				const right = Math.min(width - 1, x + radius);
				const count = right - left + 1;
				const sum = prefix[right + 1] - prefix[left];
				horizontal[rowOffset + x] = sum / count;
			}
		}

		for (let x = 0; x < width; x++) {
			const prefix = new Float32Array(height + 1);

			for (let y = 0; y < height; y++) {
				prefix[y + 1] = prefix[y] + horizontal[y * width + x];
			}

			for (let y = 0; y < height; y++) {
				const top = Math.max(0, y - radius);
				const bottom = Math.min(height - 1, y + radius);
				const count = bottom - top + 1;
				const sum = prefix[bottom + 1] - prefix[top];
				mask[y * width + x] = Math.round(sum / count);
			}
		}
	}

	colorDistanceSq(r1, g1, b1, r2, g2, b2) {
		return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
	}

	buildExportPlan(layer, context) {
		return context.compositor._buildGlitterFillExportPlan(layer);
	}
}
