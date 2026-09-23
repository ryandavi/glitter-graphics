// ============================================
// GLITTER MANAGER CLASS
// Handles glitter library, filtering, rendering, and logic
// ============================================
class GlitterManager extends ContentManager {
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
		// Encoded mask PNG per fill layer: { key, url, pending, fullApplied }.
		// Keyed by layer id and a content key, so an undo that restores the same
		// layer keeps its URL, and an in-flight encode lands on whichever layer
		// object is current. Entries for deleted layers are revoked on render.
		this.maskImages = new Map();
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
	this.browser = new AssetBrowser(this, getAssetBrowserElementIds('glitter'), getAssetBrowserSchema('glitter').title);
	
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
			pickerStripDone: document.getElementById('galleryPickerStripDone')

		};
	}

	setupEventListeners() {
		// Call parent to setup base listeners
		super.setupEventListeners();

		// Setup filter chips
		this.setupFilterChips();
		this.setupFillSourceControls();
		this.ui.pickerStripDone?.addEventListener('click', () => {
			if (this.hasActivePickerSession()) this.handlePickerDone();
		});
	}

	armAssetPicker() {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.GLITTER_FILL) return;
		pickerOpenSession(this, { layerId: layer.id }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => revealAssetBrowser(this.editor, this, layer.fill.glitterId)
		});
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
		const copy = formatPickerStripText('fill', layer.name, 'fill layer');
		renderPickerStrip({ ownsStrip: true, visible: true, armed, hint: !armed, ...copy });
	}

	handlePickerDone() {
		this.closePickerSession();
		returnFromPickerToProperties(this.editor, { section: 'glitterSettings', focusId: 'glitterAssetThumbnail' });
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
			}
		};

		return layer;
	}

	getDefaultFill() {
		return {
			...buildDefaultFill({ defaultGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId.glitterLayer }),
			gradient: normalizeEffectGradient(CONFIG.rendering.gradient)
		};
	}

	// Runs where a fill layer enters the document (deserialize, project load).
	normalizeLayer(layer) {
		if (layer?.type !== LayerType.GLITTER_FILL) return;
		layer.fill = mergeSlotEffectDefaults(layer.fill, this.getDefaultFill());
		normalizeSlotTextureCoordinates(layer.fill);
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

		if (layer.type !== LayerType.BASE_IMAGE && layer.type !== LayerType.GLITTER_FILL && layer.type !== LayerType.TEXT_GLITTER && layer.type !== LayerType.SHAPE && layer.type !== LayerType.STICKER) {
			this.editor.showError('You can only add glitter to a background or supported layer effect');
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
			layer.background.glitterId = id;
			layer.background.mode = 'glitter';
			layer.background.colorAdjust = normalizeColorAdjust(null);
		} else if (layer.type === LayerType.TEXT_GLITTER && this.editor.textGlitterManager) {
			const target = this.editor.textGlitterManager.getGlitterSelectionTarget(layer);
			// Picking a new swatch is a clean slate — drop that slot's hue/sat/bright.
			if (target === 'border') {
				const border = this.editor.textGlitterManager.ensureEffectData(layer, 'border');
				border.glitterId = id;
				border.mode = 'glitter';
				border.colorAdjust = null;
			} else if (target === 'shadow') {
				const shadow = this.editor.textGlitterManager.ensureEffectData(layer, 'shadow');
				shadow.glitterId = id;
				shadow.mode = 'glitter';
				shadow.colorAdjust = null;
			} else if (target === 'backgroundFill') {
				const background = this.editor.textGlitterManager.ensureEffectData(layer, 'backgroundFill');
				background.glitterId = id;
				background.mode = 'glitter';
				background.colorAdjust = null;
			} else {
				// Intent capture: picking a glitter for a solid-mode fill IS the
				// statement "I want glitter here", so flip the slot to glitter.
				// Otherwise the gallery click writes the glitter id, highlights
				// the swatch, and saves history with zero visible change.
				const fill = this.editor.textGlitterManager.ensureEffectData(layer, 'fill');
				fill.glitterId = id;
				fill.mode = 'glitter';
				fill.colorAdjust = null;
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
			if (layer.name === previousGlitter?.name) layer.name = glitter.name;
			layer.fill.glitterId = id;
			layer.fill.mode = 'glitter';
			// Picking a new swatch is a clean slate: drop any hue/sat/bright shift so
			// the new glitter shows its true colors, and sync the HSB sliders to match.
			layer.fill.colorAdjust = normalizeColorAdjust(null);
			this.editor.applyColorAdjustToSliders('glitter', layer.fill.colorAdjust);
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

	renderLayer(layer, width, height, options = {}) {
		if (layer.type !== LayerType.GLITTER_FILL) return;
		if (layer.fill.mode === 'glitter' && !this.getItemById(layer.fill.glitterId)) return;

		let wrapper = this.layerElements.get(layer.id);
		let inner = wrapper?.querySelector('.glitter-background');

		if (!wrapper) {
			// 1. Create the WRAPPER
			// This handles the drop-shadow filter and selection
			wrapper = document.createElement('div');
			wrapper.className = 'glitter-element';
			wrapper.dataset.layerId = layer.id;
		}

		wrapper.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);
		wrapper.style.mixBlendMode = GlitterBlendModes.forLayer(layer);

		if (!inner) {
			// 2. Create the INNER Background
			// This handles the glitter texture and the MASK
			inner = document.createElement('div');
			inner.className = 'glitter-background visible';
			wrapper.replaceChildren(inner);
		}

		inner.className = 'glitter-background visible';
		const [entry] = getLayerPaintSlots(layer);
		applyPaintSourceToElement(inner, resolvePaintSlotPreviewSource(this.editor, layer, entry), { glitterLibrary: this });

		const maskObjectUrl = this.getMaskObjectUrlForLayer(layer, width, height, options);
		if (maskObjectUrl) {
			inner.style.maskImage = `url(${maskObjectUrl})`;
			inner.style.webkitMaskImage = `url(${maskObjectUrl})`;
			// Unconditional: a no-op for full-res masks, but required when the
			// currently-applied mask is a downscaled G-1c draft.
			inner.style.maskSize = '100% 100%';
			inner.style.webkitMaskSize = '100% 100%';
			inner.style.visibility = '';
		} else {
			// No decoded mask yet (first render of this layer): keep the element
			// hidden until applyMaskObjectUrl reveals it — an unmasked frame
			// paints glitter over the whole canvas.
			inner.style.maskImage = 'none';
			inner.style.webkitMaskImage = 'none';
			inner.style.visibility = 'hidden';
		}

		// 3. Assemble
		if (!wrapper.parentNode) {
			this.editor.canvasElementsContainer.appendChild(wrapper);
		}

		// Store reference
		this.layerElements.set(layer.id, wrapper);
		syncLayerAnimationPreview(wrapper, layer, this.editor.animationTicker);

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
	}

	removeLayerElement(layerId) {
		removeManagedLayerElement(this.layerElements, layerId);
	}

	revokeMaskImage(layerId) {
		const currentUrl = this.maskImages.get(layerId)?.url;
		if (currentUrl) {
			URL.revokeObjectURL(currentUrl);
		}
		this.maskImages.delete(layerId);
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
}
