// ============================================
// STICKER MANAGER CLASS
// Handles all sticker-related operations
// Now uses LayerTransform for all transform operations
// ============================================
class StickerManager extends ContentManager {
	constructor(editor) {
		super(editor);

		// Add sticker-specific filters to base activeFilters
		Object.assign(this.activeFilters, {
			vibes: new Set()
		});

		this.useBrowser = true;
		this.layerElements = new Map();

		// Store LayerTransform instances for each layer
		this.layerTransforms = new Map(); // layerId -> LayerTransform
		this.pickerSession = null;
	}

	async initBrowser() {
		this.browser = new AssetBrowser(this, getAssetBrowserElementIds('sticker'), getAssetBrowserSchema('sticker').title);

		await this.browser.init('data/sticker-categories.json');
	}

	getLayerType() {
		return LayerType.STICKER;
	}

	renderContent(layersToShow) {
		reconcileLayerElements(
			this.layerElements,
			layersToShow,
			this.getLayerType(),
			(layer) => this.renderLayer(layer)
		);
	}

	clearElements() {
		Array.from(this.layerElements.keys()).forEach((layerId) => this.removeLayerElement(layerId));
	}

	removeLayerElement(layerId) {
		removeManagedLayerElement(this.layerElements, layerId);
	}

	setupUI() {
		this.ui = {
			...getAssetBrowserUi('sticker'),
			fitCanvas: document.getElementById('stickerFitCanvas'),
			fillCanvas: document.getElementById('stickerFillCanvas'),
			assetThumbnail: document.getElementById('stickerAssetThumbnail')
		};
		// Shared gallery picker strip (same DOM the text and shape pickers use).
		this.ui.gallerySection = document.getElementById('designGallerySection');
		this.ui.pickerStrip = document.getElementById('galleryPickerStrip');
		this.ui.pickerStripTitle = document.getElementById('galleryPickerStripTitle');
		this.ui.pickerStripDetail = document.getElementById('galleryPickerStripDetail');
		this.ui.pickerStripDone = document.getElementById('galleryPickerStripDone');
		this.ui.resetEffects = document.getElementById('resetStickerEffects');
	}

	// How the declared field binder (ui/paint-slot-controls.js) edits a sticker:
	// its image color adjust and its shadow slot.
	createFieldHost() {
		return {
			type: LayerType.STICKER,
			editor: this.editor,
			getLayer: () => {
				const layer = this.editor.layerManager.getActiveLayer();
				return layer?.type === LayerType.STICKER ? layer : null;
			},
			ensureSlot: (layer, key) => (layer.stickerData[key] ||= this.getDefaultShadow()),
			getSlotDefaults: () => this.getDefaultShadow(),
			apply: (layer, mutate, change) => {
				mutate();
				this.renderLayer(layer);
				if (change.live) return;
				this.loadLayerSettings(layer);
				this.editor.saveState('Edit sticker');
			},
			render: (layer) => this.renderLayer(layer),
			commit: () => this.editor.saveState('Edit sticker'),
			armPicker: (key) => this.armPicker(key),
			afterFieldChange: (layer, key, binding) => {
				if (!key && binding.colorAdjust) this.refreshColorAdjustVisuals(layer);
			}
		};
	}

	setupEventListeners() {
		// Call parent to setup base listeners
		super.setupEventListeners();

		// Setup filter chips
		this.setupFilterChips();
		this.ui.fitCanvas?.addEventListener('click', () => this.scaleActiveStickerToCanvas('fit'));
		this.ui.fillCanvas?.addEventListener('click', () => this.scaleActiveStickerToCanvas('fill'));
		this.fieldHost = this.createFieldHost();
		bindFieldControls(this.fieldHost);
		this.ui.resetEffects?.addEventListener('click', () => {
			const layer = this.fieldHost.getLayer();
			if (!layer) return;
			layer.stickerData.shadow = null;
			delete layer.stickerData.effectDrafts;
			delete layer.animation;
			this.renderLayer(layer);
			this.loadLayerSettings(layer);
			this.editor.animationPanel?.load(layer);
			this.editor.saveState('Edit sticker');
		});
		// Shared picker strip: Done (only acts while a sticker is armed) + global Esc.
		this.ui.pickerStripDone?.addEventListener('click', () => {
			if (this.editor.layerManager.getActiveLayer()?.type === LayerType.STICKER && this.pickerSession) this.closePicker();
		});
		document.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || !this.pickerSession) return;
			if (this.editor.layerManager.getActiveLayer()?.type !== LayerType.STICKER) return;
			const active = document.activeElement;
			if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
			if (this.editor.modalManager?.isAnyOpen?.()) return;
			event.preventDefault();
			this.closePicker();
		});
	}

	getDefaultShadow() {
		return buildDefaultShadow({ defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId.sticker, includeColorAdjust: true });
	}

	refreshColorAdjustVisuals(layer) {
		const filter = buildCssColorFilter(layer?.stickerData?.colorAdjust);
		const image = this.layerElements.get(layer?.id)?.querySelector('img.sticker-image');
		if (image) image.style.filter = filter;
		if (this.ui.assetThumbnail && this.editor.layerManager.getActiveLayer()?.id === layer?.id) {
			this.ui.assetThumbnail.style.filter = filter;
		}
		this.editor.refreshLayerSwatchFilter(layer);
	}

	// 'fit' = contain (whole sticker visible), 'fill' = cover (canvas fully
	// covered). Both center the sticker and scale proportionally.
	scaleActiveStickerToCanvas(mode) {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.STICKER || layer.stickerData?.isEmpty) return;
		const width = Math.max(1, layer.stickerData.width);
		const height = Math.max(1, layer.stickerData.height);
		const pick = mode === 'fill' ? Math.max : Math.min;
		const scale = clampLayerScale(pick(
			this.editor.originalCanvas.width / width,
			this.editor.originalCanvas.height / height
		) * 100);
		this.updateTransform(layer.id, {
			position: { x: this.editor.originalCanvas.width / 2, y: this.editor.originalCanvas.height / 2 },
			scale: { x: scale, y: scale },
			proportionalScale: true
		});
		this.editor.loadTransformSettings(layer, 'sticker');
		this.editor.saveState('Edit sticker');
	}

	armPicker(slot) {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.STICKER || !layer.stickerData[slot]) return;
		pickerOpenSession(this, { kind: 'glitter', layerId: layer.id, slot }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => revealAssetBrowser(this.editor, this.editor.glitterManager)
		});
	}

	armAssetPicker() {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.STICKER) return;
		pickerOpenSession(this, { kind: 'asset', layerId: layer.id }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => revealAssetBrowser(this.editor, this)
		});
	}

	closePicker() {
		const focusId = this.pickerSession?.kind === 'glitter'
			? `sticker${this.pickerSession.slot[0].toUpperCase()}${this.pickerSession.slot.slice(1)}GlitterChip`
			: 'stickerAssetThumbnail';
		this.closePickerSession();
		returnFromPickerToProperties(this.editor, { section: 'stickerSettings', focusId });
	}

	closePickerSession() {
		pickerCloseSession(this, {
			refresh: () => this.updatePickerStrip(),
			updateSelection: () => this.editor.updateGlitterSelection()
		});
	}

	// Only drives the strip while a sticker is active; the text manager hides it
	// for every other layer type (all three are called from app.updateSidePanelUI).
	// picker-mode on the gallery section swaps the sticker browser for the
	// glitter browser (see the design-panel sticker rules in _panels.scss).
	updatePickerStrip() {
		if (!this.ui.pickerStrip || this.editor.layerManager.getActiveLayer()?.type !== LayerType.STICKER) return;
		const layer = this.editor.layerManager.getActiveLayer();
		const assetArmed = this.pickerSession?.kind === 'asset' && this.pickerSession.layerId === layer.id;
		const glitterArmed = this.pickerSession?.kind !== 'asset' && this.pickerSession?.layerId === layer.id && layer.stickerData?.[this.pickerSession.slot];
		const armed = Boolean(assetArmed || glitterArmed);
		const stripText = glitterArmed
			? formatPickerStripText(this.pickerSession.slot, layer.name, 'sticker')
			: formatAssetPickerStripText('sticker', layer.name);
		renderPickerStrip({ ownsStrip: true, visible: true, armed, hint: !armed, pickerMode: glitterArmed, ...stripText });
	}

	getGlitterSelectionTarget(layer = this.editor.layerManager.getActiveLayer()) {
		return pickerSelectionTarget(this, layer, {
			isValid: (session) => layer?.type === LayerType.STICKER && session.kind !== 'asset'
		});
	}

	loadLayerSettings(layer) {
		if (layer?.type !== LayerType.STICKER) return;
		if (this.pickerSession && this.pickerSession.layerId !== layer.id) this.closePicker();
		syncFieldControls(this.fieldHost, layer);
		this.refreshColorAdjustVisuals(layer);
		this.updatePickerStrip();
	}

	// The shadow is the sticker's own image used as a mask, painted with the
	// shadow slot and shifted by its offset.
	reconcileStickerEffectSpan(layer, element) {
		const shadow = buildSlotStack(layer, (entry) => resolvePaintSlotPreviewSource(this.editor, layer, entry))
			.find((item) => item.role === 'shadow');
		let span = element.querySelector('.sticker-effect-shadow');
		if (!shadow) {
			span?.remove();
			return;
		}
		if (!span) {
			span = document.createElement('span');
			span.className = 'sticker-effect-layer sticker-effect-shadow';
			element.prepend(span);
		}
		if (span.dataset.maskUrl !== layer.stickerData.url) {
			span.style.maskImage = `url(${layer.stickerData.url})`;
			span.style.webkitMaskImage = `url(${layer.stickerData.url})`;
			span.dataset.maskUrl = layer.stickerData.url;
		}
		span.style.maskSize = '100% 100%';
		span.style.webkitMaskSize = '100% 100%';
		span.style.transform = `translate(${shadow.offsetX}px, ${shadow.offsetY}px)`;
		applyPaintSourceToElement(span, shadow.source, {
			glitterLibrary: this.editor.glitterManager,
			layer,
			maskCanvas: { width: layer.stickerData.width || 0, height: layer.stickerData.height || 0 }
		});
	}

	setupFilterChips() {
		// Static facet chips are wired by ContentManager; dynamic category
		// chips bind when populateCategoryChips creates them.
	}

	matchesChildFilters(item) {
		// Animated filter
		if (this.activeFilters.animated !== null) {
			if (item.isAnimated !== this.activeFilters.animated) {
				return false;
			}
		}

		// Vibe filter - check tags array (case insensitive)
		if (this.activeFilters.vibes.size > 0) {
			if (!item.tags) return false;

			const tags = item.tags.map(t => t.toLowerCase());
			const hasVibe = [...this.activeFilters.vibes].some(vibe =>
				tags.includes(vibe.toLowerCase())
			);
			if (!hasVibe) return false;
		}

		return true;
	}

	customizeItemElement(element, item) {
		if (item.isAnimated) element.classList.add('animated');
		if (item.hasTransparency) element.classList.add('has-transparency');
		if (item.isPixelated !== false) element.classList.add('pixelated');
	}

	async handleItemClick(item) {
		await this.addStickerToCanvas(item.id);

		// Update helpful message
		this.editor.updateHelpfulMessage();
	}

	// ===== LOADING =====

	async loadContent() {
		try {
			await this.loadIndexedManifest({
				indexPath: 'data/stickers.index.json',
				fallbackPath: 'data/stickers.json',
				detailBasePath: 'data/stickers',
				defaults: {
				category: 'Uncategorized',
				tags: [],
				colors: [],
				isAnimated: false,
				hasTransparency: false,
				// Records exported before the sticker `is_pixelated` column existed
				// carry no flag; crisp upscaling is what they have always rendered
				// with, so absent means pixelated.
				isPixelated: true,
				width: 0,
				height: 0,
				frameCount: 1,
				frameRate: 10,
				isVariableFramerate: false,
				fileSize: 0,
				frames: null,
				sortOrder: 0,
				featured: false,
				source: 'preset'
				}
			});

			dbg(`Loaded ${this.content.length} preset stickers`);

			// Populate category chips after loading
			this.populateCategoryChips();
		} catch (error) {
			console.error('Failed to load preset stickers:', error);
			this.editor.showError('Failed to load sticker library');
		}
	}

	populateCategoryChips() {
		if (!this.ui.categoryChips) return;

		// Get unique categories from content
		const categories = [...new Set(this.content.map(item => item.category))].sort();


		// Categories come from asset data, so the name goes in as textContent and
		// the raw value through dataset - never interpolated into markup.
		this.ui.categoryChips.replaceChildren();
		categories.forEach(cat => {
			const chip = document.createElement('div');
			chip.className = 'filter-chip';
			chip.dataset.filter = 'category';
			chip.dataset.value = cat;
			chip.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
			chip.addEventListener('click', () => this.toggleFilterChip(chip));
			this.ui.categoryChips.appendChild(chip);
		});
	}

	// ===== UPLOAD HANDLING =====

	validateUpload(file) {
		if (!CONFIG.tools.stickers.allowedTypes.includes(file.type)) {
			this.editor.showError('Please upload a valid image file (PNG, GIF, or JPG)');
			return false;
		}

		if (file.size > CONFIG.tools.stickers.maxUploadSize) {
			const maxMB = Math.round(CONFIG.tools.stickers.maxUploadSize / 1024 / 1024);
			this.editor.showError(`File is too large. Maximum size is ${maxMB}MB.`);
			return false;
		}

		return true;
	}

	async handleUserUpload(file, options = {}) {
		// 1. Validate
		if (!this.validateUpload(file)) {
			return null;
		}

		// 2. Create blob URL
		const blobUrl = URL.createObjectURL(file);
		const uploadId = `user-upload-${Date.now()}`;

		// 3. Create entry with loading state
		const userSticker = {
			id: uploadId,
			name: file.name.replace(/\.[^/.]+$/, ''),
			url: blobUrl,
			source: 'user-upload',
			category: 'user-uploads',

			// File info
			fileSize: file.size,
			mimeType: file.type,
			uploadedAt: Date.now(),

			// Initially unknown - will be detected
			isAnimated: false,
			hasTransparency: false,
			isPixelated: true,
			width: 0,
			height: 0,
			frameCount: null,
			frames: null,

			// State
			isLoading: true,
			error: null
		};

		this.userContent.push(userSticker);

		if (options.navigate !== false) {
			setTimeout(() => {
				this.browser.setState('CATEGORY_DETAIL', 'user-uploads');
			}, 50);
		}

		// 4. Process asynchronously
		try {
			await this.processUploadedSticker(userSticker, file);
		} catch (error) {
			userSticker.error = error.message;
			userSticker.isLoading = false;
			this.browser.refresh();
		}

		return userSticker;
	}

	async registerEmbeddedSticker(stickerData) {
		if (!stickerData?.id || !stickerData?.data) {
			return null;
		}

		const existingIndex = this.userContent.findIndex((item) => item.id === stickerData.id);
		if (existingIndex >= 0) {
			const existing = this.userContent[existingIndex];
			if (existing?.url?.startsWith('blob:')) {
				URL.revokeObjectURL(existing.url);
			}
			this.userContent.splice(existingIndex, 1);
		}

		const blob = await fetch(stickerData.data).then((response) => response.blob());
		const file = new File(
			[blob],
			stickerData.fileName || stickerData.name || `${stickerData.id}.png`,
			{ type: stickerData.mimeType || blob.type || 'image/png' }
		);

		const userSticker = {
			id: stickerData.id,
			name: stickerData.name || file.name.replace(/\.[^/.]+$/, ''),
			url: URL.createObjectURL(file),
			source: 'user-upload',
			category: 'user-uploads',
			fileSize: file.size,
			mimeType: file.type,
			uploadedAt: Date.now(),
			isAnimated: false,
			hasTransparency: false,
			isPixelated: true,
			width: 0,
			height: 0,
			frameCount: null,
			frames: null,
			isLoading: true,
			error: null
		};

		this.userContent.push(userSticker);
		await this.processUploadedSticker(userSticker, file);
		return userSticker;
	}

	async processUploadedSticker(userSticker, file) {
		const img = new Image();

		await new Promise((resolve, reject) => {
			img.onload = resolve;
			img.onerror = () => reject(new Error('Failed to load image'));
			img.src = userSticker.url;
		});

		// Store dimensions
		userSticker.width = img.naturalWidth;
		userSticker.height = img.naturalHeight;

		// Detect if animated GIF
		if (file.type === 'image/gif') {
			try {
				const frames = await this.editor.glitterManager.parseGifFromUrl(userSticker.url);
				userSticker.isAnimated = frames.frames.length > 1;
				userSticker.frameCount = frames.frames.length;
				userSticker.frames = frames;
				userSticker.frameRate = frames.frameRate;
				userSticker.isVariableFramerate = frames.isVariableFramerate;
			} catch (error) {
				console.warn('Failed to parse GIF frames:', error);
			}
		}

		// Detect transparency
		const canvas = createAppCanvas(0, 0, 'layers/StickerManager');
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(img, 0, 0);

		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		userSticker.hasTransparency = this.detectActualTransparency(imageData);
		userSticker.isPixelated = await this.classifyRendering(imageData, file.type, userSticker.hasTransparency);

		// Mark as loaded
		userSticker.isLoading = false;

		// Refresh to update the item from loading state to loaded
		this.updateFacetAvailability();
		this.browser.refresh();

		dbg('Processed uploaded sticker:', userSticker);
	}

	// The admin decides is_pixelated for library assets, but an upload never
	// passes through it, so it classifies itself with the same weighted model.
	// The rules and weights are fetched from data/rendering-rules.json rather
	// than restated here — a second copy of the numbers is exactly the drift
	// this is meant to prevent. If they cannot be loaded the upload keeps the
	// pixelated default instead of guessing.
	loadRenderingRules() {
		if (!this.renderingRulesPromise) {
			this.renderingRulesPromise = fetch(
				`${CONFIG.tools.stickers.renderingRulesPath}?v=${CONFIG.app.assets.manifestVersion}`
			)
				.then((response) => {
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					return response.json();
				})
				.catch((error) => {
					console.warn('Rendering rules unavailable; upload keeps the pixelated default:', error);
					return null;
				});
		}

		return this.renderingRulesPromise;
	}

	// Mirrors GifAnalyzer::renderingVerdict(). Two differences are inherent and
	// harmless: canvas reports alpha on 0-255 where GD uses 0-127, so the level
	// count here is finer against the same floor, and an animated upload is
	// read from its first frame rather than a sample of three — a GIF's
	// indexed_gif weight settles it either way.
	async classifyRendering(imageData, mimeType, hasTransparency) {
		const rules = await this.loadRenderingRules();
		if (!rules) return true;

		const data = imageData.data;
		const alphaLevels = new Set();
		const colorBuckets = new Set();
		let visiblePixels = 0;
		let softPixels = 0;
		for (let index = 0; index < data.length; index += 4) {
			const alpha = data[index + 3];
			if (alpha === 0) continue;
			visiblePixels++;
			// Same 12-bit packing the analyzer buckets colors with.
			colorBuckets.add(((data[index] >> 4) << 8) | ((data[index + 1] >> 4) << 4) | (data[index + 2] >> 4));
			if (alpha < 255) {
				softPixels++;
				alphaLevels.add(alpha);
			}
		}

		const coverage = visiblePixels > 0 ? softPixels / visiblePixels : 0;
		const weights = rules.weights;
		const evidence = [];
		if (alphaLevels.size >= rules.softEdge.minAlphaLevels && coverage >= rules.softEdge.minCoverage) {
			evidence.push(weights.soft_edge_ramp);
		} else if (hasTransparency) {
			evidence.push(weights.hard_alpha_cutout);
		} else {
			evidence.push(weights.no_alpha_channel);
		}
		if (rules.smoothMimeTypes.includes(mimeType)) evidence.push(weights.lossy_photographic_format);
		if (mimeType === 'image/gif') evidence.push(weights.indexed_gif);
		evidence.push(colorBuckets.size >= rules.richPaletteBuckets ? weights.rich_palette : weights.limited_palette);

		// Ties stay pixelated, matching the analyzer.
		return evidence.reduce((total, weight) => total + weight, 0) <= 0;
	}

	detectActualTransparency(imageData) {
		// Scan actual pixel alpha values (not just palette)
		const data = imageData.data;
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] < 255) {
				return true;
			}
		}
		return false;
	}

	// ===== LAYER CREATION =====

	async createStickerLayer(stickerSourceId) {
		const sticker = await this.ensureAssetDetails(stickerSourceId);
		if (!sticker) {
			console.error('Sticker not found:', stickerSourceId);
			return null;
		}

		// Use factory method
		const layer = this.createLayer(stickerSourceId);
		if (!layer) return null;  // Factory returns null if max reached

		// Add to layer manager
		this.editor.layerManager.insertLayer(layer);
		this.editor.layerManager.setActiveLayer(layer.id);
		this.editor.layerManager.renderLayersList();

		// Render the sticker
		this.renderLayer(layer);

		// Save state
		this.editor.saveState('Edit sticker');
		this.editor.updateActionButtons();

		return layer;
	}

	createLayer(stickerSourceId = null) {
		if (!this.editor.layerManager.requireLayerCapacity()) return null;
		const sticker = stickerSourceId ? this.getItemById(stickerSourceId) : null;
		const transform = createDefaultTransform({
			position: {
				x: this.editor.originalCanvas.width / 2,
				y: this.editor.originalCanvas.height / 2
			}
		});

		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: this.getLayerType(),
			name: sticker?.name || 'New Sticker',
			visible: true,
			locked: false,
			opacity: CONFIG.layers.defaultOpacity,
			blendMode: CONFIG.layers.defaultBlendMode,
			stickerSourceId: stickerSourceId,
			transform,

			stickerData: {
				isEmpty: !sticker,
				url: sticker?.url || null,
				// Fixed canonical/native-resolution source; `url` is the
				// currently-displayed source and may be swapped to a variant.
				// See StickerManager.commitResolutionSwap.
				baseUrl: sticker?.url || null,
				variantUrls: sticker?.variantUrls || null,
				name: sticker?.name || 'Select a Sticker',
				source: sticker?.source || null,
				isAnimated: sticker?.isAnimated || false,
				isPixelated: sticker?.isPixelated !== false,
				frameCount: sticker?.frameCount || 1,
				width: sticker?.width || 100,
				height: sticker?.height || 100,
				frames: null,
				colorAdjust: { ...COLOR_ADJUST_IDENTITY },
				element: null,
				maskEnabled: false,
				shadow: null
			}
		};

		return layer;
	}

	async addStickerToCanvas(stickerId) {
		if (!this.editor.originalImage) {
			this.editor.showError('Please load an image first');
			return;
		}

		const activeLayer = this.editor.layerManager.getActiveLayer();
		const stickerInfo = await this.ensureAssetDetails(stickerId);

		if (!stickerInfo) return;

		// LOGIC: If active layer is a STICKER layer, replace it.
		// Otherwise, create a NEW layer.
		if (activeLayer && activeLayer.type === LayerType.STICKER) {
			if (!this.editor.canEditLayer(activeLayer, { notify: true })) return;
			// Replace the sticker in the current layer
			activeLayer.name = stickerInfo.name;
			activeLayer.stickerSourceId = stickerInfo.id;

			// Update data
			activeLayer.stickerData.isEmpty = false;
			activeLayer.stickerData.baseUrl = stickerInfo.url;
			activeLayer.stickerData.variantUrls = stickerInfo.variantUrls || null;
			activeLayer.stickerData.name = stickerInfo.name;
			activeLayer.stickerData.source = stickerInfo.source;
			activeLayer.stickerData.width = stickerInfo.width;
			activeLayer.stickerData.height = stickerInfo.height;
			activeLayer.stickerData.isAnimated = stickerInfo.isAnimated;
			activeLayer.stickerData.isPixelated = stickerInfo.isPixelated !== false;
			activeLayer.stickerData.frameCount = stickerInfo.frameCount || 1;

			// Pick the resolution that matches the layer's current (possibly
			// scaled-up) size, not always the base — same rule commitResolutionSwap
			// applies after a resize gesture.
			const scalePercent = activeLayer.transform?.scale?.x ?? 100;
			const renderedWidth = stickerInfo.width * (scalePercent / 100);
			activeLayer.stickerData.url = StickerVariants.pickBestUrl(
				stickerInfo.url, stickerInfo.width, stickerInfo.variantUrls, renderedWidth
			);

			// Clear cached frame data when changing sticker
			activeLayer.stickerData.frames = null;
			activeLayer.stickerData.staticImageData = null;

			// New sticker → its colors are unrelated to the old ones, so a prior
			// hue/sat/bright tweak would apply to the wrong palette. Reset it.
			activeLayer.stickerData.colorAdjust = { ...COLOR_ADJUST_IDENTITY };

			// Render
			this.renderLayer(activeLayer);
			this.editor.layerManager.renderLayersList();
			this.editor.updateStickerSelection();
			this.editor.updateStatus('Sticker replaced');
			this.editor.saveState('Edit sticker');

			// Hide empty state and load settings
			this.editor.setSettingsEmptyState('stickerSettings', false);
			this.editor.loadStickerSettings(activeLayer);

		} else {
			// Create NEW layer
			await this.createStickerLayer(stickerId);
			this.editor.updateStickerSelection();
			this.editor.updateStatus('Sticker added');
		}
	}

	// ===== RESOLUTION SWAP =====

	// Called once a resize gesture ends (LayerTransform.handleHandlePointerUp).
	// While actively dragging it's fine to look blurry at the sticker's
	// current resolution, matching Twitter's own behavior; this picks the
	// best-fitting variant for the settled size and swaps in, or does nothing
	// if the sticker has no variants (everything pre-migration).
	async commitResolutionSwap(layer) {
		if (layer.type !== LayerType.STICKER || layer.stickerData.isEmpty) return;
		const { baseUrl, variantUrls, width: nativeWidth } = layer.stickerData;
		if (!baseUrl || !variantUrls || !Object.keys(variantUrls).length) return;

		const scalePercent = layer.transform?.scale?.x ?? 100;
		const renderedWidth = nativeWidth * (scalePercent / 100);
		const bestUrl = StickerVariants.pickBestUrl(baseUrl, nativeWidth, variantUrls, renderedWidth);
		if (bestUrl === layer.stickerData.url) return;

		try {
			await AssetImageCache.get(bestUrl);
		} catch (error) {
			return; // Keep the current source if the variant fails to load.
		}
		layer.stickerData.url = bestUrl;
		this.renderLayer(layer);
	}

	// ===== RENDERING =====

	updateSelection() {
		// Delegate to main editor's update method
		this.editor.updateStickerSelection();
	}

	renderLayer(layer) {
		if (layer.type !== LayerType.STICKER) return;

		if (layer.stickerData.isEmpty || !layer.stickerData.url) {
			this.removeStickerElement(layer.id);
			return;
		}

		let element = this.layerElements.get(layer.id);
		const transform = this.layerTransforms.get(layer.id) || new LayerTransform(layer, this.editor);
		transform.removeHoverOutline();
		let img = element?.querySelector('img.sticker-image');
		const isNew = !element;
		if (isNew) {
			element = document.createElement('div');
			element.className = 'sticker-element';
			element.dataset.layerId = layer.id;
			img = document.createElement('img');
			img.className = 'sticker-image';
			img.draggable = false;
			element.appendChild(img);
			this.editor.canvasElementsContainer.appendChild(element);
			this.layerElements.set(layer.id, element);
		}

		// Reassigning an identical URL restarts animated GIFs in some browsers.
		if (img.dataset.sourceUrl !== layer.stickerData.url) {
			img.src = layer.stickerData.url;
			img.dataset.sourceUrl = layer.stickerData.url;
		}
		img.style.filter = buildCssColorFilter(layer.stickerData.colorAdjust);
		// The canvas stack declares image-rendering: pixelated and every child
		// inherits it, so smooth art needs the class toggle to opt back out.
		element.classList.toggle('pixelated', layer.stickerData.isPixelated !== false);
		this.reconcileStickerEffectSpan(layer, element);

		// The map entry owns the live handles. Keep it across DOM refreshes so
		// sidebar updates always target the live element.
		transform.layer = layer;
		transform.element = element;

		// Apply initial transform
		const dimensions = {
			width: layer.stickerData.width,
			height: layer.stickerData.height
		};
		transform.applyTransform(element, dimensions);
		syncLayerAnimationPreview(element, layer, this.editor.animationTicker);

		if (isNew) transform.setupMouseDrag(element);

		// Store References
		layer.stickerData.element = element;
		this.layerTransforms.set(layer.id, transform);

		// Update selection highlight
		this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);

		// Create transform handles only for true single-layer selection.
		if (
			layer.id === this.editor.layerManager.activeLayerId &&
			this.editor.currentTool === ToolType.SELECT &&
			!this.editor.layerManager.hasMultiSelection()
		) {
			transform.createTransformHandles();
		}
	}

	// ===== TRANSFORM UPDATES (Delegation to LayerTransform) =====

updateTransform(layerId, updates) {
    const transform = this.layerTransforms.get(layerId);
    if (!transform) return;

    // Delegate to LayerTransform
    transform.updateTransform(updates);

    // Re-apply transform to element
		const layer = this.editor.layerManager.getLayerById(layerId);
    if (layer) {
        const element = this.layerElements.get(layerId);
        if (element) {
            const dimensions = {
                width: layer.stickerData.width,
                height: layer.stickerData.height
            };
            transform.applyTransform(element, dimensions);
            
            // MOVED: Update handles AFTER applying transform
            if (transform.transformHandles) {
                transform.updateHandlePositions();
            }
        }
    }
}

	// ===== CENTERING METHODS (Delegation to LayerTransform) =====

	centerHorizontal(layerId) {
		movableCenterHorizontal(this, layerId, (layer) => this.editor.loadStickerSettings(layer));
	}

	centerVertical(layerId) {
		movableCenterVertical(this, layerId, (layer) => this.editor.loadStickerSettings(layer));
	}

	alignToCanvas(layerId, mode) {
		movableAlignToCanvas(this, layerId, mode, (layer) => this.editor.loadTransformSettings?.(layer, 'sticker'));
	}

	resetTransform(layerId) {
		movableResetTransform(this, layerId, (layer) => this.editor.loadTransformSettings?.(layer, 'sticker'));
	}

	// ===== TRANSFORM HANDLES (Delegation to LayerTransform) =====

	createTransformHandles(layerId) {
		movableCreateTransformHandles(this, layerId);
	}

	removeTransformHandles() {
		movableRemoveTransformHandles(this);
	}

	// ===== LAYER REMOVAL =====

	removeSticker(layerId) {
		// Remove transform handles first
		const transform = this.layerTransforms.get(layerId);
		if (transform) {
			transform.removeTransformHandles();
		}

		// Remove DOM element
		this.removeStickerElement(layerId);

		// Clean up maps
		this.layerElements.delete(layerId);
	}

	releaseLayerResources(layer) {
		if (!layer?.id) return;
		this.removeSticker(layer.id);
	}

	removeStickerElement(layerId) {
		const element = this.layerElements.get(layerId);
		if (element && element.parentNode) {
			element.parentNode.removeChild(element);
		}

		// Clean up transform instance
		const transform = this.layerTransforms.get(layerId);
		if (transform) {
			transform.destroy();
			this.layerTransforms.delete(layerId);
		}
	}

	// ===== SERIALIZATION =====

	serializeSticker(layer) {
		// For undo/redo - exclude non-serializable data
		const stickerData = {
			...layer.stickerData,
			element: null,    // Can't serialize DOM
			frames: null,      // Don't need frames for undo/redo - reload from URL on restore
			staticImageData: null
		};
		delete stickerData.blendMode;
		return {
			...layer,
			blendMode: GlitterBlendModes.forLayer(layer),
			transform: cloneTransform(getLayerTransform(layer)),
			stickerSourceId: layer.stickerSourceId,
			stickerData
		};
	}

	async deserializeSticker(serialized) {
		// Restore into a copy: the serialized object is a history snapshot, and the
		// live layer must not alias it.
		const layerData = structuredClone(serialized);
		layerData.blendMode = GlitterBlendModes.forLayer(layerData);
		if (layerData.animation) layerData.animation = GlitterAnimation.normalizeAnimation(layerData.animation);
		if (layerData.stickerData) {
			delete layerData.stickerData.blendMode;
			layerData.stickerData.frames = null;
			layerData.stickerData.staticImageData = null;
		}
		layerData.transform ||= createDefaultTransform();
		// Handle empty sticker layers (no sticker selected yet)
		if (!layerData.stickerSourceId) {
			return layerData;
		}

		// Restore sticker layer from serialized data
		const sticker = this.getItemById(layerData.stickerSourceId);
		if (!sticker) {
			const missingId = layerData.stickerSourceId;
			layerData._missingAssets = [...(layerData._missingAssets || []), `sticker ${missingId}`];
			layerData.stickerSourceId = null;
			layerData.stickerData = {
				...(layerData.stickerData || {}),
				isEmpty: true,
				url: null,
				name: 'Missing Sticker'
			};
			return layerData;
		}

		// Serialized blob URLs belong to the session that saved the project. Always
		// bind the layer to the freshly resolved library/embedded asset URL.
		layerData.stickerData.url = sticker.url;
		layerData.stickerData.baseUrl = sticker.url;
		layerData.stickerData.variantUrls = sticker.variantUrls || null;
		layerData.stickerData.name = sticker.name;
		layerData.stickerData.source = sticker.source;
		// Geometry belongs to the saved layer, not to asynchronously hydrated
		// library metadata. Replacing it here made undo resize a sticker whenever
		// its detail record finished loading after the snapshot was captured.
		layerData.stickerData.width = layerData.stickerData.width || sticker.width;
		layerData.stickerData.height = layerData.stickerData.height || sticker.height;
		layerData.stickerData.frameCount = layerData.stickerData.frameCount || sticker.frameCount || 1;
		// The library asset owns this flag, so a project saved before an admin
		// change picks up the corrected rendering on reopen.
		layerData.stickerData.isPixelated = sticker.isPixelated !== false;
		layerData.stickerData.colorAdjust = normalizeColorAdjust(layerData.stickerData.colorAdjust);
		// Sticker borders were removed; drop them from older snapshots/projects.
		layerData.stickerData.border = null;
		if (layerData.stickerData.shadow) layerData.stickerData.shadow = { ...this.getDefaultShadow(), ...layerData.stickerData.shadow };

		return layerData;
	}

	// ===== CLEANUP =====

	destroy() {
		// Remove all sticker elements
		this.layerElements.forEach((element, layerId) => {
			if (element.parentNode) {
				element.parentNode.removeChild(element);
			}
		});

		// Clean up all transform instances
		this.layerTransforms.forEach(transform => {
			transform.destroy();
		});

		// Revoke blob URLs for user uploads
		this.userContent.forEach(sticker => {
			if (sticker.url.startsWith('blob:')) {
				URL.revokeObjectURL(sticker.url);
			}
		});

		// Clear maps
		this.layerElements.clear();
		this.layerTransforms.clear();
	}
}
