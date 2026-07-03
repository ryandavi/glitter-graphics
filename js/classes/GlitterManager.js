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

    // ADD THIS:
    this.useBrowser = true;

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
			selections: [],
			selectedGlitterId: CONFIG.defaultGlitterId,
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
			this.editor.showError('Please select a glitter fill layer');
			return;
		}

		if (layer.type !== LayerType.GLITTER_FILL) {
			this.editor.showError('You can only add a glitter to a glitter-fill layer');
			return;
		}

		layer.selectedGlitterId = id; // this.content[index].id;
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

		this.editor.updateGlitterSelection();
		this.editor.layerManager.renderLayersList();

		if (layer.selections.length > 0) {
			this.editor.updatePreview();
		}

		this.editor.updateActionButtons();
		this.editor.saveState();
		this.editor.updateStatus(`Selected ${glitter.name}`);
		window.dispatchEvent(new CustomEvent('layerChanged'));


		if (glitter) {
			this.editor.updateGlitterAssetInfo(glitter);
		}

		// Update helpful message
		this.editor.updateHelpfulMessage();

	}

	// ===== RENDERING (CANVAS/DOM) =====

	renderContent(layersToShow) {
		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;

		const layerType = this.getLayerType();
		const visibleLayerIds = new Set();

		layersToShow.forEach(layer => {
			if (layer.type === layerType) {
				visibleLayerIds.add(layer.id);
				this.renderLayer(layer, width, height);
			}
		});

		this.layerElements.forEach((element, layerId) => {
			if (!visibleLayerIds.has(layerId)) {
				this.removeLayerElement(layerId);
			}
		});

	}

updateSelection() {
	// Delegate to main editor's update method
	this.editor.updateGlitterSelection();
}

	renderLayer(layer, width, height) {
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

		const glitterScale = layer.settings.scale / 100;
		const baseSize = (glitter.frames && glitter.frames.width) ? glitter.frames.width : 50;
		inner.style.backgroundSize = `${Math.round(baseSize * glitterScale)}px`;

		const maskObjectUrl = this.getMaskObjectUrlForLayer(layer, width, height);
		if (maskObjectUrl) {
			inner.style.maskImage = `url(${maskObjectUrl})`;
			inner.style.webkitMaskImage = `url(${maskObjectUrl})`;
		} else {
			inner.style.maskImage = 'none';
			inner.style.webkitMaskImage = 'none';
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
	}

	getMaskObjectUrlForLayer(layer, width, height) {
		const mask = this.createMaskForLayer(layer);
		const cacheKey = `${layer._maskCache?.key || ''}|${width}x${height}`;
		const currentCache = layer._maskImageCache;

		if (currentCache?.key === cacheKey) {
			return currentCache.url || null;
		}

		const maskCanvas = document.createElement('canvas');
		maskCanvas.width = width;
		maskCanvas.height = height;
		const maskCtx = maskCanvas.getContext('2d');
		const maskData = maskCtx.createImageData(width, height);
		for (let i = 0; i < width * height; i++) {
			maskData.data[i * 4 + 3] = mask[i];
		}
		maskCtx.putImageData(maskData, 0, 0);

		layer._maskImageCache = {
			key: cacheKey,
			url: currentCache?.url || null,
			pending: true
		};

		maskCanvas.toBlob((blob) => {
			const latestCache = layer._maskImageCache;
			if (!blob) {
				if (latestCache?.key === cacheKey) {
					layer._maskImageCache = {
						key: cacheKey,
						url: latestCache.url || null,
						pending: false
					};
				}
				return;
			}

			const nextUrl = URL.createObjectURL(blob);
			if (!latestCache || latestCache.key !== cacheKey) {
				URL.revokeObjectURL(nextUrl);
				return;
			}

			if (latestCache.url && latestCache.url !== nextUrl) {
				URL.revokeObjectURL(latestCache.url);
			}

			layer._maskImageCache = {
				key: cacheKey,
				url: nextUrl,
				pending: false
			};

			this.applyMaskObjectUrl(layer.id, nextUrl);
		}, 'image/png');

		return currentCache?.url || null;
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

		const mask = new Uint8Array(len);
		const thresholdSq = layer.settings.threshold * layer.settings.threshold;
		const data = this.editor.originalImageData.data;
		const alphaChannel = this.editor.originalAlphaChannel;

		layer.selections.forEach(sel => {
			if (layer.settings.contiguous) {
				this.floodFill(mask, sel.x, sel.y, sel, thresholdSq);
			} else {
				for (let i = 0; i < len; i++) {
					if (mask[i] === 255) continue;

					// --- NEW LOGIC START ---
					if (sel.isTransparent) {
						// If we selected transparency, only match other transparent pixels
						if (alphaChannel[i] < CONFIG.alphaThreshold) {
							mask[i] = 255;
						}
						continue; // Skip the color math below
					}

					// If we selected a color, IGNORE transparent pixels
					if (alphaChannel[i] < CONFIG.alphaThreshold) continue;
					// --- NEW LOGIC END ---

					const idx = i * 4;
					const r = data[idx];
					const g = data[idx + 1];
					const b = data[idx + 2];

					if (this.colorDistanceSq(r, g, b, sel.r, sel.g, sel.b) <= thresholdSq) {
						mask[i] = 255;
					}
				}
			}
		});

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
