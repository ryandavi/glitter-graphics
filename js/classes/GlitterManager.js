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
				this.content.push({
					id: config.id,
					url: config.url,
					name: config.name || 'Unnamed',
					generatedName: config.generatedName || null,
					frames: null,
					brightness: config.brightness || null,
					sortOrder: config.sortOrder || 0,
					hue: config.hue || null,
					colorCodes: config.colorCodes || [],
					frameCount: config.frameCount || 0,
					frameRate: config.frameRate || 10,
					isVariableFramerate: config.isVariableFramerate || false,
					category: config.category || 'Uncategorized',
					isPixelated: config.isPixelated || false,
					tags: config.tags || []
				});
			});

			console.log(`Loaded ${this.content.length} swatches`);

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
	}

	randomizeGlitter(category = null) {
		const layers = this.editor.layers;
		if (layers.length === 0) return;

		let availableGlitters = this.content;
		if (category) {
			availableGlitters = this.content.filter(g =>
				g.category.toLowerCase() === category.toLowerCase()
			);
			if (availableGlitters.length === 0) return;
		}

		// Apply Replacements
		layers.forEach(layer => {
			if (layer.type !== LayerType.GLITTER_FILL) return;

			const oldGlitterId = layer.selectedGlitterId;
			// Filter out current so we get a change
			const choices = availableGlitters.filter((g, idx) => {
				const gIndex = this.content.findIndex(gl => gl.url === g.url);
				return gIndex !== oldIndex;
			});

			if (choices.length > 0) {
				const randomGlitter = choices[Math.floor(Math.random() * choices.length)];
				layer.selectedGlitterId = randomGlitter.id;
			}
		});

		this.editor.layerManager.renderLayersList();
		this.editor.updateGlitterSelection();
		this.editor.updatePreview();
		this.editor.saveState();
	}

	// ===== RENDERING (CANVAS/DOM) =====

	renderContent(layersToShow) {
		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;

		const layerType = this.getLayerType();
		// Clear existing elements for this content type
		this.clearElements();

		layersToShow.forEach(layer => {
			if (layer.type === layerType) {
				this.renderLayer(layer, width, height);
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

		// 1. Create the WRAPPER
		// This handles the drop-shadow filter and selection
		const wrapper = document.createElement('div');
		wrapper.className = 'glitter-element';
		wrapper.dataset.layerId = layer.id;
		wrapper.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);

		// 2. Create the INNER Background
		// This handles the glitter texture and the MASK
		const inner = document.createElement('div');
		inner.className = 'glitter-background visible';
		if (glitter.isPixelated) inner.classList.add('pixelated');

		// Apply glitter texture
		inner.style.backgroundImage = `url(${glitter.url})`;
		inner.style.opacity = layer.settings.opacity / 100;

		const glitterScale = layer.settings.scale / 100;
		const baseSize = (glitter.frames && glitter.frames.width) ? glitter.frames.width : 50;
		inner.style.backgroundSize = `${Math.round(baseSize * glitterScale)}px`;

		// Generate Mask
		const mask = this.createMaskForLayer(layer);
		if (layer.settings.feather > 0) {
			this.applyFeatherToMask(mask, layer.settings.feather);
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

		const maskDataURL = maskCanvas.toDataURL();
		inner.style.maskImage = `url(${maskDataURL})`;
		inner.style.webkitMaskImage = `url(${maskDataURL})`;

		// 3. Assemble
		wrapper.appendChild(inner);
		this.editor.canvasElementsContainer.appendChild(wrapper);

		// Store reference
		this.layerElements.set(layer.id, wrapper);

		// Update selection highlight for this layer if it's active
		this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);

	}

	updatePreviewScale() {
		document.querySelectorAll('.glitter-bg-layer').forEach(bg => {
			bg.style.width = this.editor.originalCanvas.width + 'px';
			bg.style.height = this.editor.originalCanvas.height + 'px';

			const layerId = bg.dataset.layerId;
			const layer = this.editor.layerManager.layers.find(l => l.id === layerId);

			if (layer && layer.type === LayerType.GLITTER_FILL) {
				const glitter = this.getItemById(layer.selectedGlitterId);
				if (glitter) {
					const glitterScale = layer.settings.scale / 100;
					const baseSize = (glitter.frames && glitter.frames.width) ?
						glitter.frames.width : 50;
					const scaledGlitterSize = Math.round(baseSize * glitterScale);
					bg.style.backgroundSize = `${scaledGlitterSize}px`;
				}
			}
		});
	}

	// ===== MASKING UTILITIES =====

	createMaskForLayer(layer) {
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

		return mask;
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
		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const tempMask = new Uint8Array(mask);

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				let sum = 0, count = 0;
				for (let dy = -radius; dy <= radius; dy++) {
					for (let dx = -radius; dx <= radius; dx++) {
						const nx = x + dx, ny = y + dy;
						if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
							sum += tempMask[ny * width + nx];
							count++;
						}
					}
				}
				mask[y * width + x] = Math.round(sum / count);
			}
		}
	}

	colorDistanceSq(r1, g1, b1, r2, g2, b2) {
		return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
	}
}