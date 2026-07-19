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

		// Store LayerTransform instances for each layer
		this.layerTransforms = new Map(); // layerId -> LayerTransform
		this.pickerSession = null;
	}

	async initBrowser() {
		this.browser = new AssetBrowser(this, {
			browser: 'stickerBrowser',
			backBtn: 'stickerBrowserBack',
			title: 'stickerBrowserTitle',
			content: 'stickerBrowserContent',
			categoryGrid: 'stickerCategoryGrid',
			searchResults: 'stickerSearchResults',
			itemGrid: 'stickerItemGrid',
			sentinel: 'stickerBrowserSentinel',
			emptyState: 'stickerBrowserEmpty',
			emptyText: 'stickerBrowserEmptyText'
		}, 'Stickers');

		await this.browser.init('data/sticker-categories.json');
	}

	getLayerType() {
		return LayerType.STICKER;
	}

	setupUI() {
		this.ui = {
			panel: document.getElementById('stickersOptions'),
			searchInput: document.getElementById('stickersSearch'),
			filterToggle: document.getElementById('stickerFilterToggleBtn'),
			filtersContainer: document.getElementById('stickerFiltersContainer'),
			clearFiltersBtn: document.getElementById('clearStickerFiltersBtn'),
			clearActiveFiltersBtn: document.getElementById('clearActiveStickerFiltersBtn'),
			activeFilterSummary: document.getElementById('stickerActiveFilterSummary'),
			categoryChips: document.getElementById('stickerCategoryChips'),
			searchNameOnly: document.getElementById('searchStickerNameOnly'),
			fitCanvas: document.getElementById('stickerFitCanvas'),
			fillCanvas: document.getElementById('stickerFillCanvas')
		};
		// Shared gallery picker strip (same DOM the text and shape pickers use).
		this.ui.gallerySection = document.getElementById('designGallerySection');
		this.ui.pickerStrip = document.getElementById('galleryPickerStrip');
		this.ui.pickerStripTitle = document.getElementById('galleryPickerStripTitle');
		this.ui.pickerStripDetail = document.getElementById('galleryPickerStripDetail');
		this.ui.pickerStripDone = document.getElementById('galleryPickerStripDone');
		// Shadow slot controls (static markup in index.html, same structure and
		// ids scheme as the shape/text effect slots).
		['Enabled', 'Controls', 'Glitter', 'Solid', 'GlitterInfo', 'GlitterChip', 'GlitterChange',
			'GlitterLabel', 'GlitterBadges', 'GlitterSize', 'GlitterFrames', 'ColorRow', 'Color',
			'OffsetX', 'OffsetXValue', 'OffsetY', 'OffsetYValue', 'Scale', 'ScaleValue',
			'Opacity', 'OpacityValue', 'Hue', 'HueValue', 'Saturation', 'SaturationValue',
			'Brightness', 'BrightnessValue'
		].forEach((suffix) => {
			this.ui['stickerShadow' + suffix] = document.getElementById('stickerShadow' + suffix);
		});
		this.ui.resetEffects = document.getElementById('resetStickerEffects');
		installEffectGradientEditor({
			prefix: 'stickerShadow',
			getData: () => {
				const layer = this.editor.layerManager.getActiveLayer();
				return layer?.type === LayerType.STICKER ? layer.stickerData.shadow : null;
			},
			onUpdate: (commit) => {
				const layer = this.editor.layerManager.getActiveLayer();
				if (layer?.type !== LayerType.STICKER) return;
				this.renderLayer(layer);
				if (commit) this.editor.saveState();
			}
		});
	}

	setupEventListeners() {
		// Call parent to setup base listeners
		super.setupEventListeners();

		// Setup filter chips
		this.setupFilterChips();
		this.ui.fitCanvas?.addEventListener('click', () => this.scaleActiveStickerToCanvas('fit'));
		this.ui.fillCanvas?.addEventListener('click', () => this.scaleActiveStickerToCanvas('fill'));
		this.bindEffectsControls();
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
		return buildDefaultShadow({ config: CONFIG.tools.stickers.shadow, defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId, includeColorAdjust: true });
	}

	bindEffectsControls() {
		const prefix = 'stickerShadow';
		const active = () => {
			const layer = this.editor.layerManager.getActiveLayer();
			return layer?.type === LayerType.STICKER ? layer : null;
		};
		this.ui[prefix + 'Enabled']?.addEventListener('change', () => {
			const layer = active(); if (!layer) return;
			layer.stickerData.effectDrafts ||= {};
			if (this.ui[prefix + 'Enabled'].checked) {
				layer.stickerData.shadow = layer.stickerData.effectDrafts.shadow || this.getDefaultShadow();
				delete layer.stickerData.effectDrafts.shadow;
			} else {
				if (layer.stickerData.shadow) layer.stickerData.effectDrafts.shadow = layer.stickerData.shadow;
				layer.stickerData.shadow = null;
			}
			this.renderLayer(layer); this.loadLayerSettings(layer); this.editor.saveState();
		});
		this.ui.resetEffects?.addEventListener('click', () => {
			const layer = active(); if (!layer) return;
			layer.stickerData.shadow = null;
			delete layer.stickerData.effectDrafts;
			this.renderLayer(layer); this.loadLayerSettings(layer); this.editor.saveState();
		});
		const setMode = (mode) => {
			const layer = active();
			const data = layer?.stickerData.shadow;
			if (!data) return;
			data.mode = mode;
			// Glitter mode is never empty — fall back to the slot's default glitter.
			if (mode === 'glitter' && !data.glitterId) data.glitterId = CONFIG.tools.glitter.defaults.shadowGlitterId;
			this.renderLayer(layer); this.loadLayerSettings(layer); this.editor.saveState();
		};
		this.ui[prefix + 'Glitter']?.addEventListener('click', () => setMode('glitter'));
		this.ui[prefix + 'Solid']?.addEventListener('click', () => setMode('solid'));
		// Glitter chip / Change → arm the gallery picker (strip + Done, like text/shape).
		[this.ui[prefix + 'GlitterChip'], this.ui[prefix + 'GlitterChange']].forEach((btn) => {
			btn?.addEventListener('click', () => this.armPicker('shadow'));
		});
		const attach = (suffix, unit, apply, resetValue) => {
			const slider = this.ui[prefix + suffix];
			if (!slider) return;
			bindSlider(slider, this.ui[prefix + suffix + 'Value'], {
				suffix: unit,
				resetValue,
				resetButton: document.getElementById('reset' + slider.id.charAt(0).toUpperCase() + slider.id.slice(1)),
				apply: (value) => {
					const layer = active();
					const data = layer?.stickerData.shadow;
					if (!data) return;
					apply(value, data, layer);
					this.renderLayer(layer);
				},
				onCommit: () => this.editor.saveState()
			});
		};
		const defaults = this.getDefaultShadow();
		attach('OffsetX', 'px', (value, data) => { data.offsetX = value; }, defaults.offsetX);
		attach('OffsetY', 'px', (value, data) => { data.offsetY = value; }, defaults.offsetY);
		attach('Scale', '%', (value, data) => { data.scale = value; }, 100);
		attach('Opacity', '%', (value, data) => { data.opacity = value; }, 100);
		attach('Hue', '°', (value, data) => { ensureSlotColorAdjust(data).hue = value; this.refreshShadowSwatch(data); }, COLOR_ADJUST_IDENTITY.hue);
		attach('Saturation', '%', (value, data) => { ensureSlotColorAdjust(data).saturation = value; this.refreshShadowSwatch(data); }, COLOR_ADJUST_IDENTITY.saturation);
		attach('Brightness', '%', (value, data) => { ensureSlotColorAdjust(data).brightness = value; this.refreshShadowSwatch(data); }, COLOR_ADJUST_IDENTITY.brightness);
		this.ui[prefix + 'Color']?.addEventListener('input', () => {
			const layer = active();
			if (!layer?.stickerData.shadow) return;
			layer.stickerData.shadow.color = this.ui[prefix + 'Color'].value;
			this.renderLayer(layer);
		});
		this.ui[prefix + 'Color']?.addEventListener('change', () => this.editor.saveState());
	}

	// Live-tint the shadow's glitter chip to match a colorAdjust drag without a
	// full panel reload (same idea as ShapeGlitterManager.refreshSlotSwatch).
	refreshShadowSwatch(shadowData) {
		const chip = this.ui.stickerShadowGlitterChip;
		if (chip) chip.style.filter = buildCssColorFilter(shadowData.colorAdjust);
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
		this.editor.saveState();
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
		const stripText = !armed
			? {}
			: assetArmed
				? formatAssetPickerStripText('sticker', layer.name)
				: formatPickerStripText(this.pickerSession.slot, layer.name, 'sticker');
		renderPickerStrip({ ownsStrip: true, visible: armed, armed, pickerMode: glitterArmed, ...stripText });
	}

	getGlitterSelectionTarget(layer = this.editor.layerManager.getActiveLayer()) {
		return pickerSelectionTarget(this, layer, {
			isValid: (session) => layer?.type === LayerType.STICKER && session.kind !== 'asset'
		});
	}

	loadLayerSettings(layer) {
		if (layer?.type !== LayerType.STICKER) return;
		if (this.pickerSession && this.pickerSession.layerId !== layer.id) this.closePicker();
		const prefix = 'stickerShadow';
		const data = layer.stickerData.shadow;
		syncPanelEffectToggle(this.ui[prefix + 'Enabled'], Boolean(data));
		const sd = data || this.getDefaultShadow();
		const set = (suffix, value, unit) => {
			const input = this.ui[prefix + suffix];
			const display = this.ui[prefix + suffix + 'Value'];
			if (input) input.value = value;
			if (display) display.innerHTML = formatUnit(value, unit);
		};
		set('OffsetX', sd.offsetX, 'px');
		set('OffsetY', sd.offsetY, 'px');
		set('Scale', sd.scale ?? 100, '%');
		set('Opacity', sd.opacity ?? 100, '%');
		const adjust = normalizeColorAdjust(sd.colorAdjust);
		set('Hue', adjust.hue, '°');
		set('Saturation', adjust.saturation, '%');
		set('Brightness', adjust.brightness, '%');
		if (this.ui[prefix + 'Color']) this.ui[prefix + 'Color'].value = sd.color || '#000000';
		syncPaintSlotSourceUI(this.ui[prefix + 'Glitter'], sd.mode);
		if (sd.mode === 'glitter') {
			if (!sd.glitterId) sd.glitterId = CONFIG.tools.glitter.defaults.shadowGlitterId;
			const glitter = this.editor.glitterManager.getItemById(sd.glitterId);
			const els = {
				thumbnail: this.ui[prefix + 'GlitterChip'],
				name: this.ui[prefix + 'GlitterLabel'],
				badges: this.ui[prefix + 'GlitterBadges'],
				size: this.ui[prefix + 'GlitterSize'],
				frames: this.ui[prefix + 'GlitterFrames']
			};
			if (glitter) this.editor.renderGlitterAssetDisplay(els, glitter, sd.colorAdjust);
			else this.editor.clearGlitterAssetDisplay?.(els);
		}
		this.updatePickerStrip();
	}

	applyEffectPaint(element, source, effectData) {
		if (!element || !source) return;
		if (source.mode === 'gradient') element.style.backgroundImage = effectGradientToCss(source.gradient);
		else if (source.mode === 'glitter') {
			const glitter = this.editor.glitterManager.getItemById(effectData.glitterId);
			element.style.backgroundImage = glitter ? `url(${glitter.url})` : 'none';
			const baseSize = glitter?.frames?.width || glitter?.width || 50;
			element.style.backgroundSize = `${Math.round(baseSize * (effectData.scale || 100) / 100)}px`;
			element.style.filter = buildCssColorFilter(effectData.colorAdjust);
		} else element.style.backgroundColor = source.color;
		element.style.opacity = String(source.opacity ?? 1);
	}

	createStickerEffectSpan(layer, effectData, className, offsetX, offsetY) {
		const span = document.createElement('span');
		span.className = `sticker-effect-layer ${className}`;
		span.style.maskImage = `url(${layer.stickerData.url})`;
		span.style.webkitMaskImage = `url(${layer.stickerData.url})`;
		span.style.maskSize = '100% 100%';
		span.style.webkitMaskSize = '100% 100%';
		span.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
		this.applyEffectPaint(span, resolveEffectPaintSource(effectData, {
			glitterId: effectData.glitterId,
			glitterAvailable: Boolean(this.editor.glitterManager.getItemById(effectData.glitterId))
		}), effectData);
		return span;
	}

	setupFilterChips() {
		// Wire up color filter chips in sticker container
		if (this.ui.filtersContainer) {
			this.ui.filtersContainer.querySelectorAll('.color-filter-chip').forEach(chip => {
				chip.addEventListener('click', () => this.toggleFilterChip(chip));
			});

			// Wire up vibe filter chips
			this.ui.filtersContainer.querySelectorAll('[data-filter="vibe"]').forEach(chip => {
				chip.addEventListener('click', () => this.toggleFilterChip(chip));
			});
		}

		// Animated filter chips (mutually exclusive - these need special handling)
		document.querySelectorAll('[data-filter="animated"]').forEach(chip => {
			chip.addEventListener('click', () => {
				const isAnimated = chip.dataset.animated === 'true';

				if (chip.classList.contains('active')) {
					// Deactivate
					chip.classList.remove('active');
					this.activeFilters.animated = null;
				} else {
					// Activate and deactivate siblings
					document.querySelectorAll('[data-filter="animated"]').forEach(c => {
						c.classList.remove('active');
					});
					chip.classList.add('active');
					this.activeFilters.animated = isAnimated;
				}

				this.browser.refresh();
				this.updateClearFiltersButton();
			});
		});
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
	}

	async handleItemClick(item) {
		await this.addStickerToCanvas(item.id);

		// Update helpful message
		this.editor.updateHelpfulMessage();
	}

	// ===== LOADING =====

	async loadContent() {
		try {
			const response = await fetch('data/stickers.json');
			const data = await response.json();

			this.content = data.map(item => this.normalizeAsset(item, {
				category: 'Uncategorized',
				tags: [],
				colors: [],
				isAnimated: false,
				hasTransparency: false,
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
			}));

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


		this.ui.categoryChips.innerHTML = categories.map(cat => {
			const name = cat.charAt(0).toUpperCase() + cat.slice(1);
			const slug = cat.toLowerCase().replace(/\s+/g, '-');
			return `
				<div class="filter-chip" data-filter="category" data-value="${cat}">
					${name}
				</div>
			`;
		}).join('');

		// Attach listeners
		this.ui.categoryChips.querySelectorAll('.filter-chip').forEach(chip => {
			chip.addEventListener('click', () => this.toggleFilterChip(chip));
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

	async handleUserUpload(file) {
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
			width: 0,
			height: 0,
			frameCount: null,
			frames: null,

			// State
			isLoading: true,
			error: null
		};

		this.userContent.push(userSticker);

		// Navigate to User Uploads immediately to show loading state
		setTimeout(() => {
			this.browser.setState('CATEGORY_DETAIL', 'user-uploads');
		}, 50);

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
		const canvas = document.createElement('canvas');
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(img, 0, 0);

		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		userSticker.hasTransparency = this.detectActualTransparency(imageData);

		// Mark as loaded
		userSticker.isLoading = false;

		// Refresh to update the item from loading state to loaded
		this.browser.refresh();

		dbg('Processed uploaded sticker:', userSticker);
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
		const sticker = this.getItemById(stickerSourceId);
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
		this.editor.saveState();
		this.editor.updateActionButtons();

		return layer;
	}

	createLayer(stickerSourceId = null) {
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
			stickerSourceId: stickerSourceId,
			transform,

			stickerData: {
				isEmpty: !sticker,
				url: sticker?.url || null,
				name: sticker?.name || 'Select a Sticker',
				source: sticker?.source || null,
				isAnimated: sticker?.isAnimated || false,
				frameCount: sticker?.frameCount || 1,
				width: sticker?.width || 100,
				height: sticker?.height || 100,
				frames: null,

				transform,

				element: null,
				blendMode: 'normal',
				maskEnabled: false,
				shadow: null
			}
		};

		syncLayerTransformReference(layer, transform);
		return layer;
	}

	async addStickerToCanvas(stickerId) {
		if (!this.editor.originalImage) {
			this.editor.showError('Please load an image first');
			return;
		}

		const activeLayer = this.editor.layerManager.getActiveLayer();
		const stickerInfo = this.getItemById(stickerId);

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
			activeLayer.stickerData.url = stickerInfo.url;
			activeLayer.stickerData.name = stickerInfo.name;
			activeLayer.stickerData.source = stickerInfo.source;
			activeLayer.stickerData.width = stickerInfo.width;
			activeLayer.stickerData.height = stickerInfo.height;
			activeLayer.stickerData.isAnimated = stickerInfo.isAnimated;
			activeLayer.stickerData.frameCount = stickerInfo.frameCount || 1;

			// Clear cached frame data when changing sticker
			activeLayer.stickerData.frames = null;
			activeLayer.stickerData.staticImageData = null;

			// Render
			this.renderLayer(activeLayer);
			this.editor.layerManager.renderLayersList();
			this.editor.updateStickerSelection();
			this.editor.updateStatus('Sticker replaced');
			this.editor.saveState();

			// Hide empty state and load settings
			this.editor.hideStickerSettingsEmptyState();
			this.editor.loadStickerSettings(activeLayer);

		} else {
			// Create NEW layer
			await this.createStickerLayer(stickerId);
			this.editor.updateStickerSelection();
			this.editor.updateStatus('Sticker added');
		}
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

		const existingElement = this.layerElements.get(layer.id);
		const transform = this.layerTransforms.get(layer.id) || new LayerTransform(layer, this.editor);
		transform.removeHoverOutline();
		if (existingElement?.parentNode) {
			existingElement.parentNode.removeChild(existingElement);
		}

		// Create DOM element
		const element = document.createElement('div');
		element.className = 'sticker-element';
		element.dataset.layerId = layer.id;

		// Create Image
		const img = document.createElement('img');
		img.src = layer.stickerData.url;
		img.draggable = false;
		img.style.imageRendering = 'pixelated';

		const shadow = layer.stickerData.shadow;
		if (shadow) element.appendChild(this.createStickerEffectSpan(layer, shadow, 'sticker-effect-shadow', shadow.offsetX, shadow.offsetY));
		element.appendChild(img);

		// The map entry owns the live handles. Keep it across DOM refreshes so
		// sidebar updates never target a replacement transform with no handles.
		transform.layer = layer;
		transform.element = element;

		// Apply initial transform
		const dimensions = {
			width: layer.stickerData.width,
			height: layer.stickerData.height
		};
		transform.applyTransform(element, dimensions);

		// Setup interaction
		transform.setupMouseDrag(element);

		// Add to Container
		this.editor.canvasElementsContainer.appendChild(element);

		// Store References
		layer.stickerData.element = element;
		this.layerElements.set(layer.id, element);
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

	// ===== CLONING =====

	cloneStickerElement(sourceLayer, clonedLayer) {
		// Just render the cloned layer normally
		// LayerTransform will handle all the setup
		this.renderLayer(clonedLayer);
	}

	// ===== SERIALIZATION =====

	serializeSticker(layer) {
		// For undo/redo - exclude non-serializable data
		const sourceTransform = getLayerTransform(layer);
		const transform = {
			position: { ...sourceTransform.position },
			rotation: sourceTransform.rotation,
			scale: { ...sourceTransform.scale },
			proportionalScale: sourceTransform.proportionalScale,
			opacity: sourceTransform.opacity,
			flipX: sourceTransform.flipX,
			flipY: sourceTransform.flipY
		};
		return {
			...layer,
			transform,
			stickerSourceId: layer.stickerSourceId,
			stickerData: {
				...layer.stickerData,
				element: null,    // Can't serialize DOM
				frames: null,      // Don't need frames for undo/redo - reload from URL on restore

				// Deep copy transform object for undo/redo
				transform
			}
		};
	}

	async deserializeSticker(layerData) {
		// Handle empty sticker layers (no sticker selected yet)
		if (!layerData.stickerSourceId) {
			syncLayerTransformReference(layerData, layerData.stickerData?.transform || layerData.transform);
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
				name: 'Missing Sticker',
				transform: layerData.stickerData?.transform || layerData.transform
			};
			syncLayerTransformReference(layerData, layerData.stickerData.transform);
			return layerData;
		}

		// Serialized blob URLs belong to the session that saved the project. Always
		// bind the layer to the freshly resolved library/embedded asset URL.
		layerData.stickerData.url = sticker.url;
		layerData.stickerData.name = sticker.name;
		layerData.stickerData.source = sticker.source;
		layerData.stickerData.width = sticker.width || layerData.stickerData.width;
		layerData.stickerData.height = sticker.height || layerData.stickerData.height;
		layerData.stickerData.frameCount = sticker.frameCount || layerData.stickerData.frameCount || 1;
		// Sticker borders were removed; drop them from older snapshots/projects.
		layerData.stickerData.border = null;
		if (layerData.stickerData.shadow) layerData.stickerData.shadow = { ...this.getDefaultShadow(), ...layerData.stickerData.shadow };
		syncLayerTransformReference(layerData, layerData.stickerData.transform || layerData.transform);

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
