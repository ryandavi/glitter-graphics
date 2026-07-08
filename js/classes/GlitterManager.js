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
			special: new Set()
		});

		this.useBrowser = true;
		this.paintMasks = new Map();
		this.paintHistory = new Map();
		this.paintHistoryBytes = 0;
		this.paintHistoryByteLimit = Math.max(
			CONFIG.maxImageWidth * CONFIG.maxImageHeight * 2 * CONFIG.historyLimit * 2,
			64 * 1024 * 1024
		);
		this.nextPaintVersion = 1;

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
	this.browser = new AssetBrowser(this, {
		browser: 'glitterBrowser',
		backBtn: 'glitterBrowserBack',
		title: 'glitterBrowserTitle',
		content: 'glitterBrowserContent',
		categoryGrid: 'glitterCategoryGrid',
		searchResults: 'glitterSearchResults',
		itemGrid: 'glitterItemGrid',
		sentinel: 'glitterBrowserSentinel',
		emptyState: 'glitterBrowserEmpty',
		emptyText: 'glitterBrowserEmptyText'
	}, 'Glitter');
	
	await this.browser.init('data/glitter-categories.json');
}

	getLayerType() {
		return LayerType.GLITTER_FILL;
	}

	setupUI() {
		this.ui = {
			panel: document.getElementById('glitterOptions'),
			searchInput: document.getElementById('glitterSearch'),
			filterToggle: document.getElementById('filterToggleBtn'),
			filtersContainer: document.getElementById('filtersContainer'),
			clearFiltersBtn: document.getElementById('clearFiltersBtn'),
			categoryChips: document.getElementById('glitterCategoryChips'),
			searchNameOnly: document.getElementById('searchGlitterNameOnly')

		};
	}

	setupEventListeners() {
		// Call parent to setup base listeners
		super.setupEventListeners();

		// Setup filter chips
		this.setupFilterChips();


	}

	setupFilterChips() {
		// Wire up all filter chips in the filters container
		if (this.ui.filtersContainer) {
			this.ui.filtersContainer.querySelectorAll('.filter-chip').forEach(chip => {
				chip.addEventListener('click', () => this.toggleFilterChip(chip));
			});
		}
	}


	createLayer() {
		if (this.editor.layerManager.layers.length >= CONFIG.maxLayers) {
			this.editor.showError(`Maximum ${CONFIG.maxLayers} layers reached`);
			return null;
		}

		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: this.getLayerType(),
			visible: true,
			locked: false,
			maskVersion: 0,
			maskHasContent: false,
			selections: [],
			selectedGlitterId: CONFIG.defaultFillGlitterId,
			settings: {
				threshold: CONFIG.defaultThreshold,
				feather: CONFIG.defaultFeather,
				scale: CONFIG.defaultScale,
				opacity: CONFIG.defaultOpacity,
				contiguous: false,
				invert: false,
				multiSelect: false
			}
		};

		return layer;
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
			const res = await fetch('data/glitter.json');
			const json = await res.json();

			

			json.forEach(config => {
				this.content.push(this.normalizeAsset(config, {
					frames: null,
					brightness: null,
					sortOrder: 0,
					hue: null,
					colorCodes: [],
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
				}));
			});

			dbg(`Loaded ${this.content.length} swatches`);

			// Populate category chips after loading
			this.populateCategoryChips();

		} catch (error) {
			console.error('Failed to load swatches:', error);
			this.editor.showError('Failed to load glitter library');
		}
	}

	async parseGifFromUrl(url) {
		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const arrayBuffer = await response.arrayBuffer();
			if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('Empty file');

			const uintArray = new Uint8Array(arrayBuffer);
			const reader = new GifReader(uintArray);
			const frameCount = reader.numFrames();

			if (frameCount === 0) throw new Error('GIF has 0 frames');

			const frameInfo = reader.frameInfo(0);
			const width = reader.width;
			const height = reader.height;
			const frames = [];

			for (let i = 0; i < frameCount; i++) {
				const info = reader.frameInfo(i);
				const pixels = new Uint8ClampedArray(width * height * 4);
				reader.decodeAndBlitFrameRGBA(i, pixels);

				// CRITICAL: Must return object with imageData property, not just ImageData
				frames.push({
					imageData: new ImageData(pixels, width, height),
					disposal: info.disposal,
					x: info.x || 0,
					y: info.y || 0,
					width: info.width || width,
					height: info.height || height
				});
			}

			return {
				width,
				height,
				frames,
				frameCount,
				frameDelay: frameInfo.delay * 10 || 100
			};
		} catch (error) {
			console.error(`[parseGifFromUrl] Error loading ${url}:`, error);
			throw error;
		}
	}



	// ===== SELECTION LOGIC =====

	async selectGlitter(id) {
		if (!this.editor.originalImage) {
			this.editor.showError('Please load an image first');
			return;
		}

		const layer = this.editor.layerManager.getActiveLayer();
		if (!layer) {
			this.editor.showError('Please select a glitter or text layer');
			return;
		}

		if (layer.type !== LayerType.GLITTER_FILL && layer.type !== LayerType.TEXT_GLITTER && layer.type !== LayerType.SHAPE) {
			this.editor.showError('You can only add a glitter to a glitter-fill, text, or shape layer');
			return;
		}
		const glitter = this.getItemById(id);

		if (!glitter) {
			this.editor.showError('Failed to load selected glitter #' + id);
			return;
		}

		// Lazy load frames
		if (!glitter.frames) {
			this.editor.updateStatus(`Downloading ${glitter.name} glitter...`);
			document.body.style.cursor = 'wait';

			try {
				const frames = await this.parseGifFromUrl(glitter.url);
				glitter.frames = frames;
			} catch (error) {
				console.error('Failed to load glitter:', error);
				this.editor.showError(`Failed to load ${glitter.name} glitter`);
				document.body.style.cursor = 'default';
				return;
			} finally {
				document.body.style.cursor = 'default';
			}
		}

		if (layer.type === LayerType.TEXT_GLITTER && this.editor.textGlitterManager) {
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
			} else {
				layer.selectedGlitterId = id;
				// Intent capture: picking a glitter for a solid-mode fill IS the
				// statement "I want glitter here", so flip the slot to glitter.
				// Otherwise the gallery click writes selectedGlitterId, highlights
				// the swatch, and saves history with zero visible change.
				this.editor.textGlitterManager.ensureEffectData(layer, 'fill').mode = 'glitter';
				if (layer.settings) layer.settings.colorAdjust = null;
			}
		} else if (layer.type === LayerType.SHAPE) {
			// Each slot has its own glitter: fill uses the layer swatch; border and
			// shadow store their own glitterId so they're independent.
			const sgm = this.editor.shapeGlitterManager;
			const target = sgm?.getGlitterSelectionTarget?.() || 'fill';
			if (target === 'fill') {
				layer.selectedGlitterId = id;
			}
			if (sgm) {
				const slotData = sgm.ensureEffectData(layer, target);
				slotData.mode = 'glitter';
				if (target !== 'fill') slotData.glitterId = id;
				// Fresh swatch → reset that slot's hue/sat/bright.
				slotData.colorAdjust = null;
			}
		} else {
			layer.selectedGlitterId = id;
			// Picking a new swatch is a clean slate: drop any hue/sat/bright shift so
			// the new glitter shows its true colors, and sync the HSB sliders to match.
			if (layer.settings) {
				layer.settings.colorAdjust = normalizeColorAdjust(null);
				this.editor.applyColorAdjustToSliders('glitter', layer.settings.colorAdjust);
			}
		}

		this.editor.updateGlitterSelection();
		this.editor.layerManager.renderLayersList();

		if (layer.type === LayerType.TEXT_GLITTER) {
			await this.editor.textGlitterManager?.refreshLayer(layer, {
				saveHistory: false,
				refreshLayerList: false,
				refreshPreview: false
			});
		} else if (layer.type === LayerType.SHAPE) {
			this.editor.shapeGlitterManager?.renderLayer(layer);
			this.editor.shapeGlitterManager?.loadLayerSettings(layer);
			this.editor.shapeGlitterManager?.updatePickerStrip();
		} else if (hasMaskContent(layer)) {
			this.editor.updatePreview();
		}

		this.editor.updateActionButtons();
		this.editor.saveState();
		if (layer.type === LayerType.TEXT_GLITTER && this.editor.textGlitterManager) {
			const target = this.editor.textGlitterManager.getGlitterSelectionTarget(layer);
			if (target === 'border' || target === 'shadow') {
				this.editor.updateStatus(`Selected ${glitter.name} for the text ${target}`);
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

		layersToShow.forEach((layer) => {
			if (layer.type === layerType) this.renderLayer(layer, width, height);
		});
	}

	renderLayer(layer, width, height, options = {}) {
		if (layer.type !== LayerType.GLITTER_FILL) return;

		const glitter = this.getItemById(layer.selectedGlitterId);
		if (!glitter) return;

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

		if (!inner) {
			// 2. Create the INNER Background
			// This handles the glitter texture and the MASK
			inner = document.createElement('div');
			inner.className = 'glitter-background visible';
			wrapper.replaceChildren(inner);
		}

		inner.className = 'glitter-background visible';
		if (glitter.isPixelated) inner.classList.add('pixelated');

		// Apply glitter texture
		inner.style.backgroundImage = `url(${glitter.url})`;
		inner.style.opacity = layer.settings.opacity / 100;
		// Color adjust (WP4): CSS filter mirrors the export matrix pass. Empty
		// string for an identity/absent adjust clears any previous filter.
		inner.style.filter = buildCssColorFilter(layer.settings.colorAdjust);

		const glitterScale = layer.settings.scale / 100;
		const baseSize = (glitter.frames && glitter.frames.width) ? glitter.frames.width : 50;
		inner.style.backgroundSize = `${Math.round(baseSize * glitterScale)}px`;

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

		// Update selection highlight for this layer if it's active
		this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);

	}

	// ===== MASKING UTILITIES =====

	releaseLayerResources(layer) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL) return;

		this.removeLayerElement(layer.id);
		this.revokeMaskImageCache(layer);
		delete layer._maskCache;
		delete layer._selectionMaskCache;
		this.removePaintMask(layer.id);
		this.editor.maskCompositor?.invalidate(layer.id);
	}

	removeLayerElement(layerId) {
		const element = this.layerElements.get(layerId);
		if (element?.parentNode) {
			element.parentNode.removeChild(element);
		}

		this.layerElements.delete(layerId);
	}

	revokeMaskImageCache(layer) {
		const currentUrl = layer?._maskImageCache?.url;
		if (currentUrl) {
			URL.revokeObjectURL(currentUrl);
		}

		delete layer._maskImageCache;
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
		const currentCache = layer._maskImageCache;

		if (currentCache?.key === cacheKey) {
			return currentCache.url || null;
		}

		const requestStart = this.maskRequestStarts.get(layer.id);
		this.maskRequestStarts.delete(layer.id);

		const canvasStart = performance.now();
		const maskCanvas = this.editor.maskCompositor.getMaskCanvas(layer, { draft: draftMask });
		dbg(`[G-1] getMaskCanvas (${draftMask ? 'brush-draft' : 'full'}): ${(performance.now() - canvasStart).toFixed(1)}ms`);

		layer._maskImageCache = {
			key: cacheKey,
			url: currentCache?.url || null,
			pending: true,
			fullApplied: false
		};

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
		const draftCanvas = document.createElement('canvas');
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

		const latestCache = layer._maskImageCache;
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

			const cacheNow = layer._maskImageCache;
			if (!cacheNow || cacheNow.key !== cacheKey || (isDraft && cacheNow.fullApplied)) {
				URL.revokeObjectURL(nextUrl);
				this._decrementMaskPending(layer.id);
				return;
			}

			const previousUrl = cacheNow.url;
			layer._maskImageCache = {
				key: cacheKey,
				url: nextUrl,
				pending: cacheNow.pending,
				fullApplied: isDraft ? Boolean(cacheNow.fullApplied) : true
			};

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

	createSelectionMaskForLayer(layer) {
		const cacheKey = this.getSelectionCacheKey(layer);
		if (layer._selectionMaskCache?.key === cacheKey) {
			return new Uint8Array(layer._selectionMaskCache.mask);
		}

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
					if (alphaChannel[i] < CONFIG.alphaThreshold) {
						mask[i] = 255;
					}
					continue;
				}

				if (alphaChannel[i] < CONFIG.alphaThreshold) continue;

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

		layer._selectionMaskCache = {
			key: cacheKey,
			mask: new Uint8Array(mask)
		};

		dbg(`[G-1] createSelectionMaskForLayer total: ${(performance.now() - buildStart).toFixed(1)}ms`);
		return new Uint8Array(mask);
	}

	createMaskForLayer(layer) {
		const cacheKey = JSON.stringify([
			layer.selections,
			layer.settings.threshold,
			layer.settings.feather,
			layer.settings.contiguous,
			layer.settings.invert
		]);

		if (layer._maskCache && layer._maskCache.key === cacheKey) {
			return new Uint8Array(layer._maskCache.mask);
		}

		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const len = width * height;
		const mask = this.createSelectionMaskForLayer(layer);
		const alphaChannel = this.editor.originalAlphaChannel;

		if (layer.settings.invert) {
			for (let i = 0; i < len; i++) {
				if (alphaChannel[i] >= CONFIG.alphaThreshold) {
					mask[i] = 255 - mask[i];
				}
			}
		}

		if (layer.settings.feather > 0) {
			this.applyFeatherToMask(mask, layer.settings.feather);
		}

		layer._maskCache = {
			key: cacheKey,
			mask: new Uint8Array(mask)
		};

		return new Uint8Array(mask);
	}

	getPaintMask(layerId) {
		return this.paintMasks.get(layerId) || null;
	}

	ensurePaintMask(layerId) {
		if (this.paintMasks.has(layerId)) {
			return this.paintMasks.get(layerId);
		}

		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const paint = {
			add: document.createElement('canvas'),
			sub: document.createElement('canvas'),
			version: 0,
			liveRevision: 0,
			hasContent: false
		};

		paint.add.width = width;
		paint.add.height = height;
		paint.sub.width = width;
		paint.sub.height = height;

		this.paintMasks.set(layerId, paint);
		return paint;
	}

	removePaintMask(layerId) {
		this.paintMasks.delete(layerId);
	}

	// Drop all live paint buffers so restorePaintState recreates them at the
	// current canvas size. Used when an undo/redo changes the canvas dimensions:
	// the existing buffers are the wrong size and blitAlphaToCanvas assumes the
	// destination matches the (per-entry, correctly-sized) snapshot.
	discardLivePaintBuffers() {
		this.paintMasks.clear();
		this.editor.maskCompositor?.reset();
	}

	// Structural canvas resize support (see GlitterEditor.resizeCanvas): re-anchor
	// every live paint buffer onto a new canvas-sized buffer, shift color-selection
	// seeds, drop stale caches, and re-snapshot paint at the new dimensions so the
	// history baseline references valid (new-size) snapshots.
	reanchorForCanvasResize(newWidth, newHeight, offsetX, offsetY, layers) {
		this.paintMasks.forEach((paint) => {
			paint.add = this._reanchorCanvas(paint.add, newWidth, newHeight, offsetX, offsetY);
			paint.sub = this._reanchorCanvas(paint.sub, newWidth, newHeight, offsetX, offsetY);
			paint.liveRevision++;
		});

		(layers || []).forEach((layer) => {
			if (layer.type !== LayerType.GLITTER_FILL) return;

			// Color-selection seed coords live in canvas space; shift them so the
			// same pixel stays selected. The sampled color (r/g/b) is unchanged.
			(layer.selections || []).forEach((sel) => {
				if (typeof sel.x === 'number') sel.x += offsetX;
				if (typeof sel.y === 'number') sel.y += offsetY;
			});
			layer._selectionMaskCache = null;
			this.editor.maskCompositor?.invalidate(layer.id);
		});

		// Re-capture paint at the new size (old snapshots were captured at the old
		// dimensions and would blit inconsistently after the history reset).
		(layers || []).forEach((layer) => {
			if (layer.type === LayerType.GLITTER_FILL && this.paintMasks.has(layer.id)) {
				this.commitPaintState(layer);
			}
		});
	}

	_reanchorCanvas(source, newWidth, newHeight, offsetX, offsetY) {
		const canvas = document.createElement('canvas');
		canvas.width = newWidth;
		canvas.height = newHeight;
		canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, offsetX, offsetY);
		return canvas;
	}

	clearAllPaintData() {
		this.paintMasks.clear();
		this.paintHistory.clear();
		this.paintHistoryBytes = 0;
		this.nextPaintVersion = 1;
		this.editor.maskCompositor?.reset();
	}

	paintCanvasHasContent(canvas) {
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] > 0) {
				return true;
			}
		}
		return false;
	}

	commitPaintState(layer) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL) {
			return 0;
		}

		const paint = this.paintMasks.get(layer.id);
		if (!paint) {
			return layer.maskVersion || 0;
		}

		const snapshot = this.capturePaintSnapshot(paint);
		const version = this.nextPaintVersion++;
		paint.version = version;
		paint.liveRevision = 0;
		paint.hasContent = snapshot.hasContent;

		this.storePaintSnapshot(layer.id, {
			version,
			add: snapshot.add,
			sub: snapshot.sub,
			hasContent: snapshot.hasContent,
			bytes: snapshot.bytes,
			timestamp: performance.now()
		});

		layer.maskVersion = version;
		layer.maskHasContent = snapshot.hasContent;
		this.editor.maskCompositor?.invalidate(layer.id);

		return version;
	}

	storePaintSnapshot(layerId, snapshot) {
		const snapshots = this.paintHistory.get(layerId) || [];
		snapshots.push(snapshot);
		this.paintHistoryBytes += snapshot.bytes;
		this.paintHistory.set(layerId, snapshots);
	}

	findPaintSnapshot(layerId, version) {
		const snapshots = this.paintHistory.get(layerId);
		if (!snapshots?.length) {
			return null;
		}

		for (let i = snapshots.length - 1; i >= 0; i--) {
			if (snapshots[i].version === version) {
				return snapshots[i];
			}
		}

		return null;
	}

	restorePaintState(layers) {
		const activeIds = new Set();

		layers.forEach((layer) => {
			if (layer.type !== LayerType.GLITTER_FILL) {
				return;
			}

			activeIds.add(layer.id);

			if (!layer.maskVersion) {
				this.removePaintMask(layer.id);
				layer.maskHasContent = false;
				layer.maskVersion = 0;
				this.editor.maskCompositor?.invalidate(layer.id);
				return;
			}

			const snapshot = this.findPaintSnapshot(layer.id, layer.maskVersion);
			if (!snapshot) {
				this.removePaintMask(layer.id);
				layer.maskHasContent = false;
				layer.maskVersion = 0;
				this.editor.maskCompositor?.invalidate(layer.id);
				return;
			}

			const paint = this.ensurePaintMask(layer.id);
			this.blitAlphaToCanvas(paint.add, snapshot.add);
			this.blitAlphaToCanvas(paint.sub, snapshot.sub);
			paint.version = snapshot.version;
			paint.liveRevision = 0;
			paint.hasContent = snapshot.hasContent;
			layer.maskHasContent = snapshot.hasContent;
			this.editor.maskCompositor?.invalidate(layer.id);
		});

		this.paintMasks.forEach((_, layerId) => {
			if (!activeIds.has(layerId)) {
				this.paintMasks.delete(layerId);
			}
		});
	}

	clearPaintForLayer(layer) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL) {
			return false;
		}

		if (!layer.maskHasContent && !this.paintMasks.has(layer.id) && !layer.maskVersion) {
			return false;
		}

		const paint = this.ensurePaintMask(layer.id);
		paint.add.getContext('2d', { willReadFrequently: true }).clearRect(0, 0, paint.add.width, paint.add.height);
		paint.sub.getContext('2d', { willReadFrequently: true }).clearRect(0, 0, paint.sub.width, paint.sub.height);
		paint.liveRevision++;
		this.commitPaintState(layer);
		this.editor.maskCompositor?.invalidate(layer.id);
		return true;
	}

	clonePaintData(sourceLayer, clonedLayer) {
		if (!sourceLayer || !clonedLayer || sourceLayer.type !== LayerType.GLITTER_FILL) {
			return;
		}

		const sourceVersion = sourceLayer.maskVersion || 0;
		if (!sourceVersion && !this.paintMasks.has(sourceLayer.id)) {
			clonedLayer.maskVersion = 0;
			clonedLayer.maskHasContent = false;
			return;
		}

		let snapshot = sourceVersion ? this.findPaintSnapshot(sourceLayer.id, sourceVersion) : null;
		if (!snapshot) {
			const livePaint = this.paintMasks.get(sourceLayer.id);
			if (!livePaint) {
				clonedLayer.maskVersion = 0;
				clonedLayer.maskHasContent = false;
				return;
			}
			snapshot = this.capturePaintSnapshot(livePaint);
		}

		const clonedPaint = this.ensurePaintMask(clonedLayer.id);
		this.blitAlphaToCanvas(clonedPaint.add, snapshot.add);
		this.blitAlphaToCanvas(clonedPaint.sub, snapshot.sub);
		clonedPaint.hasContent = snapshot.hasContent;
		clonedPaint.liveRevision = 0;
		this.commitPaintState(clonedLayer);
	}

	capturePaintSnapshot(paint) {
		const add = this.extractAlphaFromCanvas(paint.add);
		const sub = this.extractAlphaFromCanvas(paint.sub);
		const hasContent = add.some((value) => value > 0) || sub.some((value) => value > 0);
		return {
			add,
			sub,
			hasContent,
			bytes: add.byteLength + sub.byteLength
		};
	}

	extractAlphaFromCanvas(canvas) {
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		const alpha = new Uint8Array(canvas.width * canvas.height);
		for (let i = 0; i < alpha.length; i++) {
			alpha[i] = imageData[i * 4 + 3];
		}
		return alpha;
	}

	blitAlphaToCanvas(canvas, alpha) {
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		const imageData = ctx.createImageData(canvas.width, canvas.height);
		for (let i = 0; i < alpha.length; i++) {
			imageData.data[i * 4 + 3] = alpha[i];
		}
		ctx.putImageData(imageData, 0, 0);
	}

	prunePaintHistory() {
		const referenced = this.collectReferencedMaskVersions();
		let nextByteTotal = 0;

		this.paintHistory.forEach((snapshots, layerId) => {
			const keepVersions = referenced.get(layerId);
			const keptSnapshots = snapshots.filter((snapshot) => keepVersions?.has(snapshot.version));
			if (keptSnapshots.length > 0) {
				this.paintHistory.set(layerId, keptSnapshots);
				nextByteTotal += keptSnapshots.reduce((sum, snapshot) => sum + snapshot.bytes, 0);
			} else {
				this.paintHistory.delete(layerId);
			}
		});

		this.paintHistoryBytes = nextByteTotal;

		if (this.paintHistoryBytes <= this.paintHistoryByteLimit) {
			return;
		}

		const orderedSnapshots = [];
		this.paintHistory.forEach((snapshots, layerId) => {
			snapshots.forEach((snapshot) => {
				orderedSnapshots.push({ layerId, snapshot });
			});
		});

		orderedSnapshots.sort((left, right) => left.snapshot.timestamp - right.snapshot.timestamp);

		// Over budget: evict oldest first. Everything left is referenced by some
		// history state (unreferenced snapshots were dropped above), so eviction
		// trades deep-undo paint fidelity for bounded memory — restorePaintState
		// clears paint gracefully when a snapshot is missing. Never evict a live
		// layer's current version; that one backs the state the user is looking at.
		const liveVersions = new Map();
		(this.editor.layerManager?.layers || []).forEach((layer) => {
			if (layer.type === LayerType.GLITTER_FILL && layer.maskVersion) {
				liveVersions.set(layer.id, layer.maskVersion);
			}
		});

		for (const entry of orderedSnapshots) {
			if (this.paintHistoryBytes <= this.paintHistoryByteLimit) {
				break;
			}

			if (liveVersions.get(entry.layerId) === entry.snapshot.version) {
				continue;
			}

			const snapshots = this.paintHistory.get(entry.layerId);
			if (!snapshots) continue;

			const filtered = snapshots.filter((snapshot) => snapshot.version !== entry.snapshot.version);
			this.paintHistory.set(entry.layerId, filtered);
			this.paintHistoryBytes -= entry.snapshot.bytes;
		}
	}

	collectReferencedMaskVersions() {
		const referenced = new Map();
		const history = this.editor.historyManager?.history || [];

		history.forEach((state) => {
			state.layers.forEach((layer) => {
				if (layer.type !== LayerType.GLITTER_FILL || !layer.maskVersion) {
					return;
				}

				if (!referenced.has(layer.id)) {
					referenced.set(layer.id, new Set());
				}

				referenced.get(layer.id).add(layer.maskVersion);
			});
		});

		return referenced;
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
				isMatch = (alpha < CONFIG.alphaThreshold);
			} else {
				// Match only if the current pixel is OPAQUE and the color is within the threshold
				isMatch = (alpha >= CONFIG.alphaThreshold &&
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
