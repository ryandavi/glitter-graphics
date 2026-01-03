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
			categoryChips: document.getElementById('stickerCategoryChips'),
			searchNameOnly: document.getElementById('searchStickerNameOnly')
		};
	}

	setupEventListeners() {
		// Call parent to setup base listeners
		super.setupEventListeners();

		// Setup filter chips
		this.setupFilterChips();
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

	handleItemClick(item) {
		this.addStickerToCanvas(item.id);

		// Update helpful message
		this.editor.updateHelpfulMessage();
	}

	// ===== LOADING =====

	async loadContent() {
		try {
			const response = await fetch('data/stickers.json');
			const data = await response.json();

			this.content = data.map(item => ({
				id: item.id,
				name: item.name,
				filename: item.filename,
				url: item.url,
				thumbnailUrl: item.thumbnail_url || item.url,

				// Metadata
				category: item.category,
				tags: item.tags || [],
				colors: item.colors || [],

				// Technical properties
				isAnimated: item.is_animated || false,
				hasTransparency: item.has_transparency || false,
				width: item.width,
				height: item.height,
				frameCount: item.frame_count || 1,
				fileSize: item.file_size,

				// Pre-parsed data (optional)
				frames: null,

				// Display
				sortOrder: item.sort_order || 0,
				featured: item.featured || false,

				source: 'preset'
			}));

			console.log(`Loaded ${this.content.length} preset stickers`);

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

		console.log('Processed uploaded sticker:', userSticker);
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

		return {
			id: this.editor.layerManager.generateLayerId(),
			type: this.getLayerType(),
			name: sticker?.name || 'New Sticker',
			visible: true,
			locked: false,
			stickerSourceId: stickerSourceId,

			stickerData: {
				isEmpty: !sticker,
				url: sticker?.url || null,
				name: sticker?.name || 'Select a Sticker',
				source: sticker?.source || null,
				isAnimated: sticker?.isAnimated || false,
				width: sticker?.width || 100,
				height: sticker?.height || 100,
				frames: null,

				transform: {
					position: {
						x: this.editor.originalCanvas.width / 2,
						y: this.editor.originalCanvas.height / 2
					},
					rotation: CONFIG.defaultStickerRotation,
					scale: {
						x: CONFIG.defaultStickerScale,
						y: CONFIG.defaultStickerScale
					},
					proportionalScale: true,
					opacity: CONFIG.defaultStickerOpacity,
					flipX: false,
					flipY: false
				},

				element: null,
				blendMode: 'normal',
				maskEnabled: false
			}
		};
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

			// Clear cached frame data when changing sticker
			activeLayer.stickerData.frames = null;
			activeLayer.stickerData.staticImageData = null;
			activeLayer.stickerData.isFlattened = false;

			// Render
			this.renderLayer(activeLayer);
			this.editor.layerManager.renderLayersList();
			this.editor.updateStickerSelection();
			this.editor.updateStatus('Sticker replaced');
			this.editor.saveState();

			// Dispatch layerChanged event
			window.dispatchEvent(new CustomEvent('layerChanged'));

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

		// Remove existing element
		this.removeStickerElement(layer.id);

		// Create DOM element
		const element = document.createElement('div');
		element.className = 'sticker-element';
		element.dataset.layerId = layer.id;

		// Create Image
		const img = document.createElement('img');
		img.src = layer.stickerData.url;
		img.draggable = false;
		img.style.imageRendering = 'pixelated';

		element.appendChild(img);

		// CREATE LayerTransform instance
		const transform = new LayerTransform(layer, this.editor);
		transform.element = element;

		// Apply initial transform
		const dimensions = {
			width: layer.stickerData.width,
			height: layer.stickerData.height
		};
		transform.applyTransform(element, dimensions);

		// Setup interaction
		transform.setupMouseDrag(element);
		transform.setupTouchGestures(element);

		// Add to Container
		this.editor.canvasElementsContainer.appendChild(element);

		// Store References
		layer.stickerData.element = element;
		this.layerElements.set(layer.id, element);
		this.layerTransforms.set(layer.id, transform);

		// Update selection highlight
		this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);

		// Create transform handles if active and in SELECT tool
		if (layer.id === this.editor.layerManager.activeLayerId && 
			this.editor.currentTool === ToolType.SELECT) {
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
		const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
		if (layer) {
			const element = this.layerElements.get(layerId);
			if (element) {
				const dimensions = {
					width: layer.stickerData.width,
					height: layer.stickerData.height
				};
				transform.applyTransform(element, dimensions);
			}
		}
	}

	// ===== CENTERING METHODS (Delegation to LayerTransform) =====

	centerHorizontal(layerId) {
		const transform = this.layerTransforms.get(layerId);
		if (!transform) return;

		transform.centerHorizontal();

		const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
		if (layer) {
			this.editor.loadStickerSettings(layer);
		}
	}

	centerVertical(layerId) {
		const transform = this.layerTransforms.get(layerId);
		if (!transform) return;

		transform.centerVertical();

		const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
		if (layer) {
			this.editor.loadStickerSettings(layer);
		}
	}

	// ===== TRANSFORM HANDLES (Delegation to LayerTransform) =====

	createTransformHandles(layerId) {
		const transform = this.layerTransforms.get(layerId);
		if (!transform) return;

		transform.createTransformHandles();
	}

	removeTransformHandles() {
		// Remove handles from all transforms
		this.layerTransforms.forEach(transform => {
			transform.removeTransformHandles();
		});
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

	removeStickerElement(layerId) {
		const element = this.layerElements.get(layerId);
		if (element && element.parentNode) {
			element.parentNode.removeChild(element);
		}

		// Clean up transform instance
		const transform = this.layerTransforms.get(layerId);
		if (transform) {
			transform.destroy();  // This handles _touchHandler cleanup
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
		return {
			...layer,
			stickerSourceId: layer.stickerSourceId,
			stickerData: {
				...layer.stickerData,
				element: null,    // Can't serialize DOM
				frames: null,      // Don't need frames for undo/redo - reload from URL on restore

				// Deep copy transform object for undo/redo
				transform: {
					position: { ...layer.stickerData.transform.position },
					rotation: layer.stickerData.transform.rotation,
					scale: { ...layer.stickerData.transform.scale },
					proportionalScale: layer.stickerData.transform.proportionalScale,
					opacity: layer.stickerData.transform.opacity,
					flipX: layer.stickerData.transform.flipX,
					flipY: layer.stickerData.transform.flipY
				}
			}
		};
	}

	async deserializeSticker(layerData) {
		// Handle empty sticker layers (no sticker selected yet)
		if (!layerData.stickerSourceId) {
			return layerData;
		}

		// Restore sticker layer from serialized data
		const sticker = this.getItemById(layerData.stickerSourceId);
		if (!sticker) {
			console.warn('Sticker not found during deserialization:', layerData.stickerSourceId);
			return null;
		}

		// Restore URL if needed
		if (!layerData.stickerData.url) {
			layerData.stickerData.url = sticker.url;
		}

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