const CONFIG = {
	// app
	maxLayers: 15,
	historyLimit: 30,
	defaultTool: "select",

	// image
	maxImageWidth: 1200,
	maxImageHeight: 1200,
	maxFileSizeMB: 10,

	// selection
	defaultThreshold: 50,
	defaultFeather: 0,
	defaultScale: 100,
	defaultOpacity: 100,
	alphaThreshold: 254,
	sliderDebounceMs: 150,

	// glitter
	defaultGlitterIndex: 0,
	glitterGifs: [],

	// layers
	exportFrameRateSource: 'first-layer',
	createDefaultLayerOnLoad: false,
	createBaseImageLayerOnLoad: true,


	scrollZoneSize: 50,
	scrollSpeed: 10,

	// settings
	layerSettingsOpenByDefault: false,
	glitterSettingsOpenByDefault: false,
	refineGlobalDefault: false,
	glitterGlobalDefault: false,

	// transparency grid
	baseGridSize: 20,

	// zoom
	zoomLevels: [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16],


	// Gallery
	defaultGalleryTab: 'glitter', // 'glitter' | 'stickers'

	// Stickers
	maxStickers: 50,
	maxStickerUploadSize: 5 * 1024 * 1024, // 5MB
	allowedStickerTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
	defaultStickerOpacity: 100,
	defaultStickerScale: { x: 100, y: 100 },
	defaultStickerRotation: 0,
	rotationSnapTolerance: 5, // degrees

	// Artboard
	showArtboardBorder: false,
	artboardBorderColor: '#00ffff',
	artboardBorderWidth: 2,
	artboardBorderStyle: 'dashed', // 'solid' | 'dashed'

	// Export (extend existing)
	defaultExportStickers: true,
	defaultExportGlitter: true,


	// export settings (defaults)
	defaultExportQuality: 10,
	defaultExportDitherEnabled: true,
	defaultExportDitherType: 'FloydSteinberg',
	defaultExportFrameDelay: 110,
	defaultExportMaxFrames: 60,
	defaultExportBaseImage: true,
	defaultExportTransparency: true,
	defaultExportMatteColor: '#ffffff',

	// debug
	forceIOSExportPreview: false,  // Set to true to test iOS export modal on desktop

	// shortcuts
	shortcuts: {
		tools: [
			{ key: 'V', action: 'Select Tool' },
			{ key: 'I', action: 'Color Picker Tool' },
			{ key: 'H', action: 'Hand Tool' },
			{ key: 'Z', action: 'Zoom Tool' },
		],
		view: [
			{ key: 'Alt + Click', action: 'Zoom Out (Zoom Tool)' },
			{ key: 'Scroll Wheel', action: 'Zoom In/Out (Zoom Tool)' },
			{ key: 'Ctrl + 0', action: 'Fit Screen' },
			{ key: 'Ctrl + 1', action: 'Reset Zoom (100%)' },
			{ key: 'Ctrl + +/-', action: 'Zoom In/Out' }
		],
		history: [
			{ key: 'Ctrl + Z', action: 'Undo' },
			{ key: 'Ctrl + Shift + Z', action: 'Redo' },
		]
	},

};

const LayerType = {
	GLITTER_FILL: 'glitter-fill',
	STICKER: 'sticker',
	BASE_IMAGE: 'base-image',
};

const ToolType = {
	SELECT: 'select',
	HAND: 'hand',
	COLOR_PICKER: 'colorPicker',
	ZOOM: 'zoom'
};

// ============================================
// STICKER MANAGER CLASS
// Handles all sticker-related operations
// ============================================
class StickerManager {
	constructor(editor) {
		this.editor = editor;

		// Sticker libraries
		this.presetStickers = [];           // Database stickers
		this.userStickers = [];             // Session uploads

		// Active filters for sticker picker UI
		this.activeFilters = {
			search: '',
			categories: new Set(),
			tags: new Set(),
			colors: new Set(),
			animated: null                  // null | true | false
		};

		// Sticker DOM elements (layerId -> HTMLElement)
		this.stickerElements = new Map();

		// Animation frame tracking (layerId -> animationFrameId)
		this.animationFrames = new Map();

		// UI references (set during init)
		this.stickerPanel = null;
		this.stickerGrid = null;

		// Transform state for active sticker editing
		this.activeTransform = null;
		this.transformHandles = null;
	}

	// ===== INITIALIZATION =====

	async init() {
		this.setupUI();
		await this.loadPresetStickers();
		this.renderStickerPicker();
	}




	cloneStickerElement(sourceLayer, clonedLayer) {
		const sourceElement = this.editor.glitterBackgroundsContainer.querySelector(
			`.sticker-element[data-layer-id="${sourceLayer.id}"]`
		);

		if (!sourceElement) return;

		const clonedElement = sourceElement.cloneNode(true);
		clonedElement.dataset.layerId = clonedLayer.id;

		// Remove the 'selected' class if present
		clonedElement.classList.remove('selected');

		// Apply transform to match cloned layer data
		this.applyStickerTransform(clonedElement, clonedLayer);

		// Add to container
		this.editor.glitterBackgroundsContainer.appendChild(clonedElement);

		// Store reference
		this.stickerElements.set(clonedLayer.id, clonedElement);

		// Attach drag listeners
		this.attachDragListeners(clonedElement, clonedLayer.id);
	}

	// In StickerManager class

	attachDragListeners(element, layerId) {
		let isDragging = false;
		let startX, startY;
		let initialStickerX, initialStickerY;

		const startDrag = (clientX, clientY) => {
			// Only allow dragging if Select Tool is active
			if (this.editor.currentTool !== ToolType.SELECT) return;

			// Only allow dragging if this is the active layer
			if (this.editor.layerManager.activeLayerId !== layerId) {
				this.editor.layerManager.setActiveLayer(layerId);
			}

			isDragging = true;
			element.classList.add('dragging');

			startX = clientX;
			startY = clientY;

			const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
			if (!layer) return;

			initialStickerX = layer.stickerData.transform.position.x;
			initialStickerY = layer.stickerData.transform.position.y;
		};

		const onMove = (clientX, clientY) => {
			if (!isDragging) return;

			const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
			if (!layer) return;

			// Calculate Delta
			const dx = clientX - startX;
			const dy = clientY - startY;

			// Adjust for Zoom Level (Crucial for accuracy)
			const zoom = this.editor.viewport.currentZoom;

			// Update Position
			this.updateStickerTransform(layerId, {
				position: {
					x: initialStickerX + (dx / zoom),
					y: initialStickerY + (dy / zoom)
				}
			});

			// Update Settings UI if open
			this.editor.loadStickerSettings(layer);
		};

		const endDrag = () => {
			if (!isDragging) return;
			isDragging = false;
			element.classList.remove('dragging');
			this.editor.saveState(); // Save for Undo
		};

		// --- MOUSE EVENTS ---
		element.addEventListener('mousedown', (e) => {
			if (this.editor.currentTool === ToolType.SELECT) {
				e.stopPropagation(); // Stop Viewport Pan
				e.preventDefault();
				startDrag(e.clientX, e.clientY);
			}
		});

		window.addEventListener('mousemove', (e) => {
			if (isDragging) {
				e.preventDefault();
				onMove(e.clientX, e.clientY);
			}
		});

		window.addEventListener('mouseup', endDrag);


		// --- TOUCH EVENTS (One Finger) ---
		element.addEventListener('touchstart', (e) => {
			if (this.editor.currentTool === ToolType.SELECT && e.touches.length === 1) {
				e.stopPropagation(); // Stop Viewport Pan
				e.preventDefault();
				startDrag(e.touches[0].clientX, e.touches[0].clientY);
			}
		}, { passive: false });

		window.addEventListener('touchmove', (e) => {
			if (isDragging && e.touches.length === 1) {
				e.preventDefault(); // Stop Browser Scroll
				onMove(e.touches[0].clientX, e.touches[0].clientY);
			}
		}, { passive: false });

		window.addEventListener('touchend', endDrag);
	}


	setupUI() {
		// 1. Get the Main Wrapper
		this.stickerPanel = document.getElementById('stickersOptions');

		// 2. Get the specific internal containers
		this.stickerGridContainer = document.getElementById('stickerGridContainer');
		this.stickerSearchEmptyState = document.getElementById('stickerSearchEmptyState');

		// 3. Search inputs
		this.stickerSearch = document.getElementById('stickersSearch');
		this.stickerFilterToggle = document.getElementById('stickerFilterToggleBtn');
		this.stickerFiltersContainer = document.getElementById('stickerFiltersContainer');
		this.clearStickerFiltersBtn = document.getElementById('clearStickerFiltersBtn');
		this.stickerCategoryChips = document.getElementById('stickerCategoryChips');

		// 4. Set up event listeners
		this.setupStickerSearchListeners();
	}

	replaceActiveSticker(stickerId) {
		const activeLayer = this.editor.layerManager.getActiveLayer();
		const stickerInfo = this.getStickerById(stickerId);

		// Only proceed if we have a sticker and the active layer is a sticker layer
		if (!stickerInfo || !activeLayer || activeLayer.type !== LayerType.STICKER) {
			return;
		}

		// Update Layer Metadata
		activeLayer.name = stickerInfo.name;
		activeLayer.stickerSourceId = stickerInfo.id;

		// Update Sticker Data
		activeLayer.stickerData.url = stickerInfo.url;
		activeLayer.stickerData.name = stickerInfo.name;
		activeLayer.stickerData.source = stickerInfo.source;
		activeLayer.stickerData.width = stickerInfo.width;
		activeLayer.stickerData.height = stickerInfo.height;
		activeLayer.stickerData.isAnimated = stickerInfo.isAnimated;
		activeLayer.stickerData.isEmpty = false;

		// Re-render
		this.renderSticker(activeLayer);
		this.editor.layerManager.renderLayersList();
		this.editor.updateStickerSelection(); // ADD THIS
		this.editor.saveState();
	}


	async addNewStickerLayer(stickerId) {
		if (!this.editor.originalImage) {
			this.editor.showError('Please load an image first');
			return;
		}

		// 1. Force creation of a NEW layer
		const layer = await this.createStickerLayer(stickerId);

		if (layer) {
			this.editor.updateStatus('New sticker layer added');
		}
	}



	createEmptyStickerLayer() {
		return {
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.STICKER,
			name: 'New Sticker',
			visible: true,
			locked: false,
			stickerSourceId: null,

			stickerData: {
				isEmpty: true, // FLAG: This layer is waiting for content
				url: null,     // No image yet
				name: 'Select a Sticker',
				source: null,
				isAnimated: false,
				width: 100,
				height: 100,

				// Default Transform
				transform: {
					position: {
						x: this.editor.originalCanvas.width / 2,
						y: this.editor.originalCanvas.height / 2
					},
					rotation: CONFIG.defaultStickerRotation,
					scale: {
						x: CONFIG.defaultStickerScale.x,
						y: CONFIG.defaultStickerScale.y
					},
					proportionalScale: true,
					opacity: CONFIG.defaultStickerOpacity,
					flipX: false,
					flipY: false
				},
				element: null
			}
		};
	}

	// ===== PRESET STICKERS =====

	async loadPresetStickers() {
		try {
			const response = await fetch('data/stickers.json');
			const data = await response.json();

			this.presetStickers = data.map(item => ({
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
				frames: null,                    // Load on-demand

				// Display
				sortOrder: item.sort_order || 0,
				featured: item.featured || false,

				source: 'preset'
			}));

			console.log(`Loaded ${this.presetStickers.length} preset stickers`);
		} catch (error) {
			console.error('Failed to load preset stickers:', error);
			this.editor.showError('Failed to load sticker library');
		}
	}

	// ===== USER UPLOADS =====

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
			name: file.name,
			url: blobUrl,
			source: 'user-upload',

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

		this.userStickers.push(userSticker);
		this.renderStickerPicker();

		// 4. Process asynchronously
		try {
			await this.processUploadedSticker(userSticker, file);
		} catch (error) {
			console.error('Failed to process uploaded sticker:', error);
			userSticker.error = error.message;
			userSticker.isLoading = false;
			this.renderStickerPicker();
		}

		return userSticker;
	}

	validateUpload(file) {
		// Check file type
		if (!CONFIG.allowedStickerTypes.includes(file.type)) {
			this.editor.showError('Invalid file type. Please upload PNG, JPEG, GIF, or WebP.');
			return false;
		}

		// Check file size
		if (file.size > CONFIG.maxStickerUploadSize) {
			const maxMB = CONFIG.maxStickerUploadSize / (1024 * 1024);
			this.editor.showError(`File too large. Maximum size is ${maxMB}MB.`);
			return false;
		}

		// Check sticker count
		if (this.userStickers.length >= CONFIG.maxStickers) {
			this.editor.showError(`Maximum ${CONFIG.maxStickers} uploaded stickers reached.`);
			return false;
		}

		return true;
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
				const frames = await this.editor.parseGifFromUrl(userSticker.url);
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
		this.renderStickerPicker();

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
		// Find sticker in library
		const sticker = this.getStickerById(stickerSourceId);
		if (!sticker) {
			console.error('Sticker not found:', stickerSourceId);
			return null;
		}

		// Create layer object
		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.STICKER,
			name: sticker.name,
			visible: true,
			locked: false,


			stickerSourceId: stickerSourceId,

			stickerData: {
				// Source info
				url: sticker.url,
				name: sticker.name,
				source: sticker.source,

				// Image metadata
				isAnimated: sticker.isAnimated,
				width: sticker.width,
				height: sticker.height,
				frames: null,  // Only load on export, not for display

				// Transform state
				transform: {
					position: {
						x: this.editor.originalCanvas.width / 2,   // Center on canvas
						y: this.editor.originalCanvas.height / 2
					},
					rotation: CONFIG.defaultStickerRotation,
					scale: {
						x: CONFIG.defaultStickerScale.x,
						y: CONFIG.defaultStickerScale.y
					},
					proportionalScale: true,
					opacity: CONFIG.defaultStickerOpacity,
					flipX: false,
					flipY: false
				},

				// Rendering
				element: null,  // Set during render

				// Future
				blendMode: 'normal',
				maskEnabled: false
			}
		};

		// Add to layer manager
		this.editor.layerManager.layers.push(layer);
		this.editor.layerManager.setActiveLayer(layer.id);
		this.editor.layerManager.renderLayersList();

		// Render the sticker (browser handles animation automatically)
		this.renderSticker(layer);

		this.editor.updateStickerSelection(); // ADD THIS

		// Save state
		this.editor.saveState();
		this.editor.updateActionButtons();

		return layer;
	}

	// ===== RENDERING =====

	// 1. New Helper Method
	updateSelectionHighlight(activeLayerId) {
		this.stickerElements.forEach((element, layerId) => {
			if (layerId === activeLayerId) {
				element.classList.add('selected');
			} else {
				element.classList.remove('selected');
			}
		});
	}

	// 2. Update renderSticker to check selection status immediately
	// In StickerManager class -> renderSticker(layer)

	renderSticker(layer) {
		if (layer.type !== LayerType.STICKER) return;

		// ... (checks for empty layer) ...
		if (layer.stickerData.isEmpty || !layer.stickerData.url) {
			this.removeStickerElement(layer.id);
			return;
		}

		// Remove existing element
		this.removeStickerElement(layer.id);

		const element = document.createElement('div');
		element.className = 'sticker-element';
		element.dataset.layerId = layer.id;

		// Selection Highlight Check
		if (this.editor.layerManager.activeLayerId === layer.id) {
			element.classList.add('selected');
		}

		// Create Image
		const img = document.createElement('img');
		img.src = layer.stickerData.url;
		img.draggable = false; // Important: Disable native drag

		//if (layer.stickerData.width < 100 && layer.stickerData.height < 100) {
		img.style.imageRendering = 'pixelated';
		//}

		element.appendChild(img);

		// Apply Transform
		this.applyStickerTransform(element, layer);

		// Add to Container
		this.editor.glitterBackgroundsContainer.appendChild(element);

		// Store Reference
		layer.stickerData.element = element;
		this.stickerElements.set(layer.id, element);

		// ============================================================
		// ATTACH DRAG LISTENERS
		// ============================================================
		this.attachDragListeners(element, layer.id);
	}

	applyStickerTransform(element, layer) {
		const { transform } = layer.stickerData;
		const { width, height } = layer.stickerData;

		// Calculate actual display size
		const displayWidth = width * (transform.scale.x / 100);
		const displayHeight = height * (transform.scale.y / 100);

		// Apply CSS transform
		const transforms = [
			`translate(-50%, -50%)`,                          // Center on position
			`translate(${transform.position.x}px, ${transform.position.y}px)`,
			`rotate(${transform.rotation}deg)`,
			`scaleX(${transform.flipX ? -1 : 1})`,
			`scaleY(${transform.flipY ? -1 : 1})`
		];

		element.style.cssText = `
			position: absolute;
			width: ${displayWidth}px;
			height: ${displayHeight}px;
			transform: ${transforms.join(' ')};
			opacity: ${transform.opacity / 100};
			pointer-events: ${layer.visible ? 'auto' : 'none'};
			display: ${layer.visible ? 'block' : 'none'};
			z-index: ${this.editor.layerManager.getLayerZIndex(layer.id)};
		`;
	}



	// ===== ANIMATION =====

	startStickerAnimation(layerId) {
		// Browser handles animation natively - no manual frame swapping needed
		// This method is only used during export
		return;
	}

	stopStickerAnimation(layerId) {
		// No animation to stop since browser handles it
		// This method is only used during export cleanup
		const frameId = this.animationFrames.get(layerId);
		if (frameId) {
			cancelAnimationFrame(frameId);
			this.animationFrames.delete(layerId);
		}
	}

	// ===== TRANSFORM UPDATES =====

	// REPLACE updateStickerTransform() in StickerManager class

	updateStickerTransform(layerId, updates) {
		const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
		if (!layer || layer.type !== LayerType.STICKER) return;

		const { transform } = layer.stickerData;

		// Apply updates
		if (updates.position) {
			transform.position.x = updates.position.x ?? transform.position.x;
			transform.position.y = updates.position.y ?? transform.position.y;
		}

		if (updates.scale) {
			// When proportional scale is on, both X and Y should always match
			// This is now handled by the event listeners, but we still respect it here
			transform.scale.x = updates.scale.x ?? transform.scale.x;
			transform.scale.y = updates.scale.y ?? transform.scale.y;
		}

		if (updates.rotation !== undefined) {
			transform.rotation = updates.rotation;
		}

		if (updates.opacity !== undefined) {
			transform.opacity = updates.opacity;
		}

		if (updates.flipX !== undefined) {
			transform.flipX = updates.flipX;
		}

		if (updates.flipY !== undefined) {
			transform.flipY = updates.flipY;
		}

		// Re-render with updated transform
		const element = this.stickerElements.get(layerId);
		if (element) {
			this.applyStickerTransform(element, layer);
		}
	}


	// ===== CENTERING METHODS =====

	// ===== CENTERING METHODS =====

	centerStickerHorizontal(layerId) {
		const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
		if (!layer || layer.type !== LayerType.STICKER) return;

		// Get canvas center
		const canvasWidth = this.editor.originalCanvas.width;
		const centerX = canvasWidth / 2;

		this.updateStickerTransform(layerId, {
			position: { x: centerX }
		});

		// Update settings UI
		this.editor.loadStickerSettings(layer);
		this.editor.saveState();
	}

	centerStickerVertical(layerId) {
		const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
		if (!layer || layer.type !== LayerType.STICKER) return;

		// Get canvas center
		const canvasHeight = this.editor.originalCanvas.height;
		const centerY = canvasHeight / 2;

		this.updateStickerTransform(layerId, {
			position: { y: centerY }
		});

		// Update settings UI
		this.editor.loadStickerSettings(layer);
		this.editor.saveState();
	}

	// ===== LAYER REMOVAL =====

	removeSticker(layerId) {
		// No need to stop animation - browser handles it
		// Just remove DOM element
		this.removeStickerElement(layerId);

		// Clean up maps
		this.stickerElements.delete(layerId);
		this.animationFrames.delete(layerId); // Keep for export compatibility
	}

	removeStickerElement(layerId) {
		const element = this.stickerElements.get(layerId);
		if (element && element.parentNode) {
			element.parentNode.removeChild(element);
		}
	}

	// ===== STICKER PICKER UI =====

	renderStickerPicker() {
		// 1. Get Elements
		const container = document.getElementById('stickerGridContainer');
		const emptyState = document.getElementById('stickerSearchEmptyState');

		// Safety Check: If container is missing, we can't render
		if (!container) return;

		// 2. Get Data & Clear Grid
		const filteredStickers = this.applyFilters();
		container.innerHTML = '';

		// 3. Handle Visibility (Empty vs Content)
		if (filteredStickers.length === 0) {
			// Show Empty State, Hide Grid
			if (emptyState) emptyState.classList.add('visible');
			container.classList.remove('visible');
			return; // Stop rendering
		} else {
			// Hide Empty State, Show Grid
			if (emptyState) emptyState.classList.remove('visible');
			container.classList.add('visible');
		}

		// 4. Group by Category
		const byCategory = {};
		filteredStickers.forEach(sticker => {
			const cat = sticker.category || 'uncategorized';
			if (!byCategory[cat]) byCategory[cat] = [];
			byCategory[cat].push(sticker);
		});

		// 5. Render Categories
		Object.keys(byCategory).sort().forEach(categoryName => {
			const stickers = byCategory[categoryName];

			// Category Wrapper
			const categoryDiv = document.createElement('div');
			categoryDiv.className = 'sticker-category';

			// Title
			const title = document.createElement('div');
			title.className = 'category-title';
			title.textContent = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);

			// Grid
			const grid = document.createElement('div');
			grid.className = 'sticker-grid';

			// Individual Stickers
			stickers.forEach(sticker => {
				const option = document.createElement('div');
				option.className = 'sticker-option';
				option.dataset.stickerId = sticker.id;
				option.title = sticker.name;

				// Visual indicators
				if (sticker.isAnimated) {
					option.classList.add('animated');
				}
				if (sticker.width < 100 && sticker.height < 100) {
					option.classList.add('pixelated');
				}

				// Image
				const img = document.createElement('img');
				img.src = sticker.thumbnailUrl || sticker.url;
				img.alt = sticker.name;
				img.draggable = false;

				option.appendChild(img);

				// Interaction
				option.addEventListener('click', () => {
					const activeLayer = this.editor.layerManager.getActiveLayer();
					// If a sticker layer is currently active, replace the image
					if (activeLayer && activeLayer.type === LayerType.STICKER) {
						this.replaceActiveSticker(sticker.id);
					} else {
						// Otherwise, add a new sticker layer
						this.addStickerToCanvas(sticker.id);
					}
				});

				grid.appendChild(option);
			});

			categoryDiv.appendChild(title);
			categoryDiv.appendChild(grid);

			// Append to the Grid Container (not the main panel)
			container.appendChild(categoryDiv);
		});

		// 6. Update Category Chips (if needed)
		this.populateCategoryChips();
	}

	switchGalleryTab(tabName = null) {

		// Update content sections using .visible class
		document.querySelectorAll('.gallery-content').forEach(content => {
			content.classList.toggle('visible', content.dataset.galleryContent === tabName);
		});

		// Update search sections using .visible class
		const glitterSearch = document.getElementById('glitterSearchSection');
		const stickersSearch = document.getElementById('stickersSearchSection');

		if (glitterSearch && stickersSearch) {
			if (tabName === 'glitter') {
				glitterSearch.classList.add('visible');
				stickersSearch.classList.remove('visible');
			} else if (tabName === 'stickers') {
				stickersSearch.classList.add('visible');
				glitterSearch.classList.remove('visible');
			} else {
				glitterSearch.classList.remove('visible');
				stickersSearch.classList.remove('visible');
			}
		}

		// Store current tab
		this.currentTab = tabName;
	}

	setupStickerSearchListeners() {
		// Search input
		if (this.stickerSearch) {
			this.stickerSearch.addEventListener('input', (e) => {
				this.searchStickers(e.target.value);
			});
		}

		// Filter toggle
		if (this.stickerFilterToggle) {
			this.stickerFilterToggle.addEventListener('click', () => {
				this.stickerFiltersContainer.classList.toggle('visible');
				this.stickerFilterToggle.classList.toggle('active');
			});
		}

		// Clear filters
		if (this.clearStickerFiltersBtn) {
			this.clearStickerFiltersBtn.addEventListener('click', () => {
				this.clearStickerFilters();
			});
		}

		// Animated filter chips
		document.querySelectorAll('[data-filter="animated"]').forEach(chip => {
			chip.addEventListener('click', () => {
				const isAnimated = chip.dataset.animated === 'true';

				if (chip.classList.contains('active')) {
					// Deactivate
					chip.classList.remove('active');
					this.activeFilters.animated = null;
				} else {
					// Activate and deactivate siblings
					document.querySelectorAll('[data-filter="animated"]').forEach(c => c.classList.remove('active'));
					chip.classList.add('active');
					this.activeFilters.animated = isAnimated;
				}

				this.renderStickerPicker();
				this.updateClearFiltersButton();
			});
		});
	}

	clearStickerFilters() {
		// Clear search
		if (this.stickerSearch) {
			this.stickerSearch.value = '';
		}

		// Clear filter state
		this.activeFilters = {
			search: '',
			categories: new Set(),
			tags: new Set(),
			colors: new Set(),
			animated: null
		};

		// Clear UI
		document.querySelectorAll('#stickerFiltersContainer .filter-chip').forEach(chip => {
			chip.classList.remove('active');
		});

		this.renderStickerPicker();
		this.updateClearFiltersButton();
	}

	updateClearFiltersButton() {
		const hasFilters =
			this.activeFilters.search !== '' ||
			this.activeFilters.categories.size > 0 ||
			this.activeFilters.tags.size > 0 ||
			this.activeFilters.colors.size > 0 ||
			this.activeFilters.animated !== null;

		if (this.clearStickerFiltersBtn) {
			this.clearStickerFiltersBtn.disabled = !hasFilters;
		}
	}

	populateCategoryChips() {
		if (!this.stickerCategoryChips || this.stickerCategoryChips.children.length > 0) return;

		// Get unique categories
		const categories = new Set();
		[...this.presetStickers, ...this.userStickers].forEach(sticker => {
			if (sticker.category) categories.add(sticker.category);
		});

		// Create chips
		Array.from(categories).sort().forEach(category => {
			const chip = document.createElement('div');
			chip.className = 'filter-chip text-filter-chip';
			chip.dataset.category = category;
			chip.dataset.filter = 'category';
			chip.textContent = category.charAt(0).toUpperCase() + category.slice(1);
			chip.title = category;

			chip.addEventListener('click', () => {
				if (chip.classList.contains('active')) {
					chip.classList.remove('active');
					this.activeFilters.categories.delete(category);
				} else {
					chip.classList.add('active');
					this.activeFilters.categories.add(category);
				}

				this.renderStickerPicker();
				this.updateClearFiltersButton();
			});

			this.stickerCategoryChips.appendChild(chip);
		});
	}

	async addStickerToCanvas(stickerId) {
		if (!this.editor.originalImage) {
			this.editor.showError('Please load an image first');
			return;
		}

		const activeLayer = this.editor.layerManager.getActiveLayer();
		const stickerInfo = this.getStickerById(stickerId);

		if (!stickerInfo) return;

		// LOGIC: If active layer is an Empty Sticker Layer, populate it.
		// Otherwise, create a NEW layer.
		if (activeLayer && activeLayer.type === LayerType.STICKER && activeLayer.stickerData.isEmpty) {

			// Populate the existing layer
			activeLayer.name = stickerInfo.name;
			activeLayer.stickerSourceId = stickerInfo.id;

			// Fill data
			activeLayer.stickerData.isEmpty = false; // It is now full
			activeLayer.stickerData.url = stickerInfo.url;
			activeLayer.stickerData.name = stickerInfo.name;
			activeLayer.stickerData.source = stickerInfo.source;
			activeLayer.stickerData.width = stickerInfo.width;
			activeLayer.stickerData.height = stickerInfo.height;
			activeLayer.stickerData.isAnimated = stickerInfo.isAnimated;

			// Render
			this.renderSticker(activeLayer);
			this.editor.layerManager.renderLayersList(); // Update thumbnail
			this.editor.updateStatus('Sticker placed');
			this.editor.saveState();

		} else {
			// Standard behavior: New Layer
			await this.createStickerLayer(stickerId);
			this.editor.updateStatus('Sticker added');
		}
	}



	applyFilters() {
		const allStickers = [...this.presetStickers, ...this.userStickers];

		return allStickers.filter(sticker => {
			// Search filter
			if (this.activeFilters.search) {
				const query = this.activeFilters.search.toLowerCase();
				const nameMatch = sticker.name.toLowerCase().includes(query);
				const tagMatch = sticker.tags?.some(tag => tag.toLowerCase().includes(query));
				if (!nameMatch && !tagMatch) return false;
			}

			// Category filter
			if (this.activeFilters.categories.size > 0) {
				if (!this.activeFilters.categories.has(sticker.category)) {
					return false;
				}
			}

			// Tag filter
			if (this.activeFilters.tags.size > 0) {
				const hasMatchingTag = sticker.tags?.some(tag =>
					this.activeFilters.tags.has(tag)
				);
				if (!hasMatchingTag) return false;
			}

			// Color filter
			if (this.activeFilters.colors.size > 0) {
				const hasMatchingColor = sticker.colors?.some(color =>
					this.activeFilters.colors.has(color)
				);
				if (!hasMatchingColor) return false;
			}

			// Animated filter
			if (this.activeFilters.animated !== null) {
				if (sticker.isAnimated !== this.activeFilters.animated) {
					return false;
				}
			}

			return true;
		});
	}

	searchStickers(query) {
		this.activeFilters.search = query;
		this.renderStickerPicker();
	}

	getStickerById(id) {
		return this.presetStickers.find(s => s.id === id) ||
			this.userStickers.find(s => s.id === id);
	}

	// ===== SERIALIZATION =====

	serializeSticker(layer) {
		// For undo/redo - exclude non-serializable data
		return {
			...layer,
			stickerData: {
				...layer.stickerData,
				element: null,    // Can't serialize DOM
				frames: null      // Don't need frames for undo/redo - reload from URL on restore
			}
		};
	}

	async deserializeSticker(layerData) {
		// Restore sticker layer from serialized data
		const sticker = this.getStickerById(layerData.stickerSourceId);
		if (!sticker) {
			console.warn('Sticker not found during deserialization:', layerData.stickerSourceId);
			return null;
		}

		// Restore URL if needed
		if (!layerData.stickerData.url) {
			layerData.stickerData.url = sticker.url;
		}

		// No need to reload frames - browser handles animation natively
		// Frames are only loaded during export if needed

		return layerData;
	}

	// ===== CLEANUP =====

	destroy() {
		// Stop all animations
		this.animationFrames.forEach((frameId, layerId) => {
			cancelAnimationFrame(frameId);
		});

		// Remove all sticker elements
		this.stickerElements.forEach((element, layerId) => {
			if (element.parentNode) {
				element.parentNode.removeChild(element);
			}
		});

		// Revoke blob URLs for user uploads
		this.userStickers.forEach(sticker => {
			if (sticker.url.startsWith('blob:')) {
				URL.revokeObjectURL(sticker.url);
			}
		});

		// Clear maps
		this.stickerElements.clear();
		this.animationFrames.clear();
	}
}

// ============================================
// GLITTER MANAGER CLASS
// Handles glitter library, filtering, rendering, and logic
// ============================================
class GlitterManager {
	constructor(editor) {
		this.editor = editor;

		// Data
		this.glitterGifs = [];

		// Filter State
		this.activeFilters = {
			colors: new Set(),
			tones: new Set(), // Kept for compatibility if used in JSON
			special: new Set(),
			search: '',
			nameOnly: false
		};

		// DOM Elements
		this.gridContainer = document.getElementById('glitterGridContainer');
		this.backgroundsContainer = editor.glitterBackgroundsContainer;
	}

	async init() {
		this.setupEventListeners();
		await this.loadGlitterGifs();
	}

	// ===== EVENT LISTENERS =====

	setupEventListeners() {
		// Filter Toggle
		const filterToggleBtn = document.getElementById('filterToggleBtn');
		if (filterToggleBtn) {
			filterToggleBtn.addEventListener('click', () => this.toggleFiltersUI());
		}

		// Clear Filters
		const clearFiltersBtn = document.getElementById('clearFiltersBtn');
		if (clearFiltersBtn) {
			clearFiltersBtn.addEventListener('click', () => this.clearAllFilters());
		}

		// Search Input
		const glitterSearch = document.getElementById('glitterSearch');
		if (glitterSearch) {
			glitterSearch.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
		}

		// Name Only Checkbox
		const searchNameOnly = document.getElementById('searchNameOnly');
		if (searchNameOnly) {
			searchNameOnly.addEventListener('change', (e) => {
				this.activeFilters.nameOnly = e.target.checked;
				this.applyFilters();
				this.updateClearFiltersButton();
			});
		}

		// Static Filter Chips
		document.querySelectorAll('#filtersContainer .filter-chip').forEach(chip => {
			chip.addEventListener('click', () => this.toggleFilter(chip));
		});
	}

	toggleFiltersUI() {
		const container = document.getElementById('filtersContainer');
		const btn = document.getElementById('filterToggleBtn');
		const isVisible = container.classList.toggle('visible');
		btn.classList.toggle('active', isVisible);
	}

	// ===== LOADING & PARSING =====

	async loadGlitterGifs() {
		this.glitterGifs = [];
		try {
			const res = await fetch('data/swatches.json');
			const json = await res.json();

			json.forEach(config => {
				this.glitterGifs.push({
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

			if (this.glitterGifs.length > 0) {
				this.renderGlitterPicker();
			}
		} catch (error) {
			console.error('Failed to load swatches:', error);
			this.editor.showError('Failed to load glitter library');
		}
	}

	async parseGifFromUrl(url) {
		// Used by both selection logic and Export logic
		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const arrayBuffer = await response.arrayBuffer();
			if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('Empty file');

			const uintArray = new Uint8Array(arrayBuffer);
			const reader = new GifReader(uintArray); // Assumes omggif.js is loaded globally
			const frameCount = reader.numFrames();

			if (frameCount === 0) throw new Error('GIF has 0 frames');

			const frameInfo = reader.frameInfo(0);
			const width = reader.width;
			const height = reader.height;
			const frames = [];

			for (let i = 0; i < frameCount; i++) {
				const pixels = new Uint8ClampedArray(width * height * 4);
				reader.decodeAndBlitFrameRGBA(i, pixels);
				frames.push(new ImageData(pixels, width, height));
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

	// ===== PICKER UI & FILTERING =====

	renderGlitterPicker() {
		if (!this.gridContainer) return;
		this.gridContainer.innerHTML = '';

		const categories = {};
		this.glitterGifs.forEach((glitter, index) => {
			if (!categories[glitter.category]) {
				categories[glitter.category] = [];
			}
			categories[glitter.category].push({ glitter, index });
		});

		Object.entries(categories).forEach(([category, items]) => {
			const categoryDiv = document.createElement('div');
			categoryDiv.className = 'glitter-category';
			categoryDiv.dataset.category = category;

			const title = document.createElement('div');
			title.className = 'category-title';
			title.textContent = category;
			categoryDiv.appendChild(title);

			const grid = document.createElement('div');
			grid.className = 'glitter-grid';

			items.forEach(({ glitter, index }) => {
				const option = document.createElement('div');
				option.className = 'glitter-option' + (glitter.isPixelated ? ' pixelated' : '');
				option.title = glitter.name;
				option.dataset.index = index;
				option.dataset.name = glitter.name.toLowerCase();
				option.dataset.category = glitter.category.toLowerCase();
				option.dataset.tags = (glitter.tags || []).join(' ').toLowerCase();
				option.dataset.hue = glitter.hue;

				const img = document.createElement('img');
				img.src = glitter.url;
				option.appendChild(img);
				option.addEventListener('click', () => this.selectGlitter(index));

				grid.appendChild(option);
			});

			categoryDiv.appendChild(grid);
			this.gridContainer.appendChild(categoryDiv);
		});

		this.applyFilters();
	}

	handleSearchInput(searchTerm) {
		this.activeFilters.search = searchTerm.toLowerCase().trim();
		this.applyFilters();
	}

	toggleFilter(chip) {
		const filterType = chip.dataset.filter;
		const value = chip.dataset.value || chip.dataset.color;

		chip.classList.toggle('active');

		if (filterType === 'color') {
			if (this.activeFilters.colors.has(value)) {
				this.activeFilters.colors.delete(value);
			} else {
				this.activeFilters.colors.add(value);
			}
		}
		// Add other filter types here if needed (tone, special)

		this.applyFilters();
		this.updateClearFiltersButton();
	}

	clearAllFilters() {
		this.activeFilters.colors.clear();
		this.activeFilters.search = '';
		this.activeFilters.nameOnly = false;

		const searchInput = document.getElementById('glitterSearch');
		if (searchInput) searchInput.value = '';

		const nameOnlyCheck = document.getElementById('searchNameOnly');
		if (nameOnlyCheck) nameOnlyCheck.checked = false;

		document.querySelectorAll('.filter-chip').forEach(chip => {
			chip.classList.remove('active');
		});

		this.applyFilters();
		this.updateClearFiltersButton();

		// Close filter drawer
		const container = document.getElementById('filtersContainer');
		const btn = document.getElementById('filterToggleBtn');
		if (container) container.classList.remove('visible');
		if (btn) btn.classList.remove('active');
	}

	updateClearFiltersButton() {
		const hasActiveFilters =
			this.activeFilters.colors.size > 0 ||
			this.activeFilters.search !== '' ||
			this.activeFilters.nameOnly;

		const btn = document.getElementById('clearFiltersBtn');
		if (btn) btn.disabled = !hasActiveFilters;
	}

	applyFilters() {
		const categories = document.querySelectorAll('.glitter-category');
		let totalVisibleCount = 0;

		categories.forEach(category => {
			const options = category.querySelectorAll('.glitter-option');
			let visibleCount = 0;

			options.forEach(option => {
				const name = (option.dataset.name || '').toLowerCase();
				const tagsString = (option.dataset.tags || '').toLowerCase();
				const tags = tagsString.split(' ').filter(t => t.length > 0);

				let matches = true;

				// Search filter
				if (this.activeFilters.search) {
					const term = this.activeFilters.search;
					if (this.activeFilters.nameOnly) {
						if (!name.includes(term)) matches = false;
					} else {
						if (!name.includes(term) && !tagsString.includes(term)) {
							matches = false;
						}
					}
				}

				// Color filter
				if (matches && this.activeFilters.colors.size > 0) {
					const hasColor = [...this.activeFilters.colors].some(color => tags.includes(color));
					if (!hasColor) matches = false;
				}

				option.style.display = matches ? 'block' : 'none';
				if (matches) visibleCount++;
			});

			category.style.display = visibleCount > 0 ? 'block' : 'none';
			totalVisibleCount += visibleCount;
		});

		// Toggle Empty State
		const emptyState = document.getElementById('glitterEmptyState');
		if (emptyState && this.gridContainer) {
			if (totalVisibleCount === 0) {
				emptyState.classList.add('visible');
				this.gridContainer.classList.remove('visible');
			} else {
				emptyState.classList.remove('visible');
				this.gridContainer.classList.add('visible');
			}
		}
	}

	// ===== SELECTION LOGIC =====

	async selectGlitter(index) {
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

		layer.selectedGlitterIndex = index;

		const glitter = this.glitterGifs[index];
		if (!glitter) return;

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

		let availableGlitters = this.glitterGifs;
		if (category) {
			availableGlitters = this.glitterGifs.filter(g =>
				g.category.toLowerCase() === category.toLowerCase()
			);
			if (availableGlitters.length === 0) return;
		}

		// Apply Replacements
		layers.forEach(layer => {
			if (layer.type !== LayerType.GLITTER_FILL) return;

			const oldIndex = layer.selectedGlitterIndex;
			// Filter out current so we get a change
			const choices = availableGlitters.filter((g, idx) => {
				const gIndex = this.glitterGifs.findIndex(gl => gl.url === g.url);
				return gIndex !== oldIndex;
			});

			if (choices.length > 0) {
				const randomGlitter = choices[Math.floor(Math.random() * choices.length)];
				layer.selectedGlitterIndex = this.glitterGifs.findIndex(g => g.url === randomGlitter.url);
			}
		});

		this.editor.layerManager.renderLayersList();
		this.editor.updateGlitterSelection();
		this.editor.updatePreview();
		this.editor.saveState();
	}

	// ===== RENDERING (CANVAS/DOM) =====

	renderGlitterBackgrounds(layersToShow) {
		this.backgroundsContainer.innerHTML = '';
		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;

		layersToShow.forEach(layer => {
			if (layer.type !== LayerType.GLITTER_FILL) return;

			const glitter = this.glitterGifs[layer.selectedGlitterIndex];
			if (!glitter) return;

			// Generate Mask
			const mask = this.createMaskForLayer(layer);
			if (layer.settings.feather > 0) {
				this.applyFeatherToMask(mask, layer.settings.feather);
			}

			// Create Mask Canvas
			const maskCanvas = document.createElement('canvas');
			maskCanvas.width = width;
			maskCanvas.height = height;
			const maskCtx = maskCanvas.getContext('2d');
			const maskData = maskCtx.createImageData(width, height);

			for (let i = 0; i < width * height; i++) {
				const maskValue = mask[i];
				const idx = i * 4;
				// Only write alpha where mask exists
				maskData.data[idx + 3] = maskValue;
			}
			maskCtx.putImageData(maskData, 0, 0);

			// Create DOM Element
			const bg = document.createElement('div');
			bg.className = 'glitter-background glitter-bg-layer visible';
			if (glitter.isPixelated) bg.classList.add('pixelated');

			bg.dataset.layerId = layer.id;
			bg.style.backgroundImage = `url(${glitter.url})`;
			bg.style.backgroundSize = 'auto'; // Will be updated by scaling logic
			bg.style.width = width + 'px';
			bg.style.height = height + 'px';
			bg.style.position = 'absolute';
			bg.style.top = '0';
			bg.style.left = '0';


			bg.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);

			bg.style.pointerEvents = 'none';
			bg.style.opacity = layer.settings.opacity / 100;

			// Apply Mask Image
			const maskDataURL = maskCanvas.toDataURL();
			bg.style.maskImage = `url(${maskDataURL})`;
			bg.style.webkitMaskImage = `url(${maskDataURL})`;
			bg.style.maskSize = `${width}px ${height}px`;
			bg.style.webkitMaskSize = `${width}px ${height}px`;
			bg.style.maskRepeat = 'no-repeat';
			bg.style.webkitMaskRepeat = 'no-repeat';

			this.backgroundsContainer.appendChild(bg);
		});
	}

	// --- Helper to create a single glitter element without appending it ---
	createGlitterElement(layer) {
		if (layer.type !== LayerType.GLITTER_FILL) return null;

		const glitter = this.glitterGifs[layer.selectedGlitterIndex];
		if (!glitter) return null;

		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;

		// Generate Mask
		const mask = this.createMaskForLayer(layer);
		if (layer.settings.feather > 0) {
			this.applyFeatherToMask(mask, layer.settings.feather);
		}

		// Create Mask Canvas
		const maskCanvas = document.createElement('canvas');
		maskCanvas.width = width;
		maskCanvas.height = height;
		const maskCtx = maskCanvas.getContext('2d');
		const maskData = maskCtx.createImageData(width, height);

		for (let i = 0; i < width * height; i++) {
			const maskValue = mask[i];
			const idx = i * 4;
			// Only write alpha where mask exists
			maskData.data[idx + 3] = maskValue;
		}
		maskCtx.putImageData(maskData, 0, 0);

		// Create DOM Element
		const bg = document.createElement('div');
		bg.className = 'glitter-background glitter-bg-layer visible';
		if (glitter.isPixelated) bg.classList.add('pixelated');

		bg.dataset.layerId = layer.id;
		bg.style.backgroundImage = `url(${glitter.url})`;

		// Scale logic
		const glitterScale = layer.settings.scale / 100;
		const baseSize = (glitter.frames && glitter.frames.width) ? glitter.frames.width : 50;
		const scaledGlitterSize = Math.round(baseSize * glitterScale);
		bg.style.backgroundSize = `${scaledGlitterSize}px`;

		bg.style.width = width + 'px';
		bg.style.height = height + 'px';
		bg.style.position = 'absolute';
		bg.style.top = '0';
		bg.style.left = '0';
		// Remove explicit z-index here; DOM order will handle it
		// bg.style.zIndex = '100'; 
		bg.style.pointerEvents = 'none';
		bg.style.opacity = layer.settings.opacity / 100;

		// Apply Mask Image
		const maskDataURL = maskCanvas.toDataURL();
		bg.style.maskImage = `url(${maskDataURL})`;
		bg.style.webkitMaskImage = `url(${maskDataURL})`;
		bg.style.maskSize = `${width}px ${height}px`;
		bg.style.webkitMaskSize = `${width}px ${height}px`;
		bg.style.maskRepeat = 'no-repeat';
		bg.style.webkitMaskRepeat = 'no-repeat';

		return bg;
	}


	updatePreviewScale() {
		document.querySelectorAll('.glitter-bg-layer').forEach(bg => {
			bg.style.width = this.editor.originalCanvas.width + 'px';
			bg.style.height = this.editor.originalCanvas.height + 'px';

			const layerId = bg.dataset.layerId;
			const layer = this.editor.layerManager.layers.find(l => l.id === layerId);

			if (layer && layer.type === LayerType.GLITTER_FILL) {
				const glitter = this.glitterGifs[layer.selectedGlitterIndex];
				if (glitter) {
					const glitterScale = layer.settings.scale / 100;
					const baseSize = (glitter.frames && glitter.frames.width) ? glitter.frames.width : 50;
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
					if (alphaChannel[i] < CONFIG.alphaThreshold) continue;

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

		const stack = [startY * width + startX];

		while (stack.length > 0) {
			const idx = stack.pop();
			if (mask[idx] === 255) continue;

			const r = data[idx * 4];
			const g = data[idx * 4 + 1];
			const b = data[idx * 4 + 2];

			if (alphaChannel[idx] >= CONFIG.alphaThreshold &&
				this.colorDistanceSq(r, g, b, targetColor.r, targetColor.g, targetColor.b) <= thresholdSq) {

				mask[idx] = 255;

				if ((idx + 1) % width !== 0 && mask[idx + 1] === 0) stack.push(idx + 1);
				if (idx % width !== 0 && mask[idx - 1] === 0) stack.push(idx - 1);
				if (idx + width < totalPixels && mask[idx + width] === 0) stack.push(idx + width);
				if (idx - width >= 0 && mask[idx - width] === 0) stack.push(idx - width);
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

// ============================================
// VIEWPORT MANAGER CLASS
// Handles all zoom, pan, and coordinate conversion logic
// ============================================
class ViewportManager {
	constructor(previewContainer, previewWrapper) {
		// DOM references
		this.previewContainer = previewContainer;
		this.previewWrapper = previewWrapper;

		// Zoom state
		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.zoomLevels.indexOf(1);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 3; // Fallback

		// Pan state
		this.panX = 0;
		this.panY = 0;
		this.isPanning = false;
		this.panStartX = 0;
		this.panStartY = 0;
		this.lastPanX = 0;
		this.lastPanY = 0;

		// Resize tracking
		this.lastViewportWidth = 0;
		this.lastViewportHeight = 0;
		this.resizeTimeout = null;

		// Touch gesture state
		this.touch = {
			active: false,
			startDistance: 0,
			startZoom: 1,
			anchorScreen: { x: 0, y: 0 },
			anchorCanvas: { x: 0, y: 0 },
			lastCenter: { x: 0, y: 0 },
			startPanX: 0,
			startPanY: 0,
			// Add single finger tracking:
			singleFingerPan: false,
			singleFingerStart: { x: 0, y: 0 }
		};

		// Canvas dimensions (set by editor when image loads)
		this.canvasWidth = 0;
		this.canvasHeight = 0;

		// Initialize
		this.initializeViewportDimensions();
		this.setupEventListeners();
	}

	// ===== INITIALIZATION =====

	initializeViewportDimensions() {
		const rect = this.previewContainer.getBoundingClientRect();
		this.lastViewportWidth = rect.width;
		this.lastViewportHeight = rect.height;
	}

	setupEventListeners() {
		// Window resize
		window.addEventListener('resize', () => this.handleWindowResize());

		// Mouse pan
		this.previewContainer.addEventListener('mousedown', (e) => {
			if (e.button === 0) { // Left click only
				this._handlePanStart(e);
			}
		});

		this.previewContainer.addEventListener('mousemove', (e) => {
			this._handlePanMove(e);
		});

		this.previewContainer.addEventListener('mouseup', () => {
			this.endPan();
		});

		this.previewContainer.addEventListener('mouseleave', () => {
			this.endPan();
		});

		// Touch gestures
		this.setupTouchGestures();
	}

	// ===== PUBLIC API =====

	/**
	 * Set canvas dimensions (called by editor when image loads)
	 */
	setCanvasDimensions(width, height) {
		this.canvasWidth = width;
		this.canvasHeight = height;
	}

	/**
	 * Convert screen coordinates to canvas coordinates
	 * Essential for sticker placement, selection, etc.
	 */
	screenToCanvas(screenX, screenY) {
		const rect = this.previewContainer.getBoundingClientRect();
		const containerX = screenX - rect.left;
		const containerY = screenY - rect.top;

		const canvasX = (containerX - this.panX) / this.currentZoom;
		const canvasY = (containerY - this.panY) / this.currentZoom;

		return { x: canvasX, y: canvasY };
	}

	/**
	 * Check if canvas coordinates are within bounds
	 */
	isWithinCanvas(canvasX, canvasY) {
		return canvasX >= 0 &&
			canvasX < this.canvasWidth &&
			canvasY >= 0 &&
			canvasY < this.canvasHeight;
	}

	/**
	 * Get current zoom percentage
	 */
	getZoomPercentage() {
		return Math.round(this.currentZoom * 100);
	}

	// ===== ZOOM METHODS =====

	setZoom(newZoom, clickX = null, clickY = null) {
		if (!this.canvasWidth) return;

		const oldZoom = this.currentZoom;

		// Clamp zoom
		this.currentZoom = Math.max(
			CONFIG.zoomLevels[0],
			Math.min(CONFIG.zoomLevels[CONFIG.zoomLevels.length - 1], newZoom)
		);

		// Update zoom index for UI
		let closestDiff = Number.MAX_VALUE;
		let closestIndex = 0;
		CONFIG.zoomLevels.forEach((z, i) => {
			const diff = Math.abs(this.currentZoom - z);
			if (diff < closestDiff) {
				closestDiff = diff;
				closestIndex = i;
			}
		});
		this.currentZoomIndex = closestIndex;

		// Get container dimensions
		const containerRect = this.previewContainer.getBoundingClientRect();
		const viewportW = containerRect.width;
		const viewportH = containerRect.height;

		// Determine anchor point
		let anchorContainerX, anchorContainerY;

		if (clickX !== null && clickY !== null) {
			// Mouse zoom: anchor at click position
			anchorContainerX = clickX - containerRect.left;
			anchorContainerY = clickY - containerRect.top;
		} else {
			// Button zoom: anchor at viewport center
			anchorContainerX = viewportW / 2;
			anchorContainerY = viewportH / 2;
		}

		// Convert anchor to canvas coordinates
		const imagePixelX = (anchorContainerX - this.panX) / oldZoom;
		const imagePixelY = (anchorContainerY - this.panY) / oldZoom;

		// Calculate new pan to keep anchor point stationary
		this.panX = anchorContainerX - (imagePixelX * this.currentZoom);
		this.panY = anchorContainerY - (imagePixelY * this.currentZoom);

		// Apply transform and notify
		this.applyTransform();
		this._notifyViewportChanged();
	}

	zoomIn(clickX = null, clickY = null) {
		if (this.currentZoomIndex < CONFIG.zoomLevels.length - 1) {
			this.setZoom(CONFIG.zoomLevels[this.currentZoomIndex + 1], clickX, clickY);
		} else {
			const nextZoom = this.currentZoom * 1.5;
			this.setZoom(nextZoom, clickX, clickY);
		}
	}

	zoomOut(clickX = null, clickY = null) {
		if (this.currentZoomIndex > 0) {
			this.setZoom(CONFIG.zoomLevels[this.currentZoomIndex - 1], clickX, clickY);
		} else {
			const nextZoom = this.currentZoom / 1.5;
			this.setZoom(nextZoom, clickX, clickY);
		}
	}

	zoomToFit() {
		if (!this.canvasWidth) return;

		const containerRect = this.previewContainer.getBoundingClientRect();
		const padding = 40;

		const scaleX = (containerRect.width - padding) / this.canvasWidth;
		const scaleY = (containerRect.height - padding) / this.canvasHeight;
		const fitZoom = Math.min(scaleX, scaleY);

		this.currentZoom = fitZoom;

		// Update zoom index
		this.currentZoomIndex = CONFIG.zoomLevels.findIndex(z => z >= fitZoom);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 0;

		// Center the canvas
		this.panX = (containerRect.width - (this.canvasWidth * fitZoom)) / 2;
		this.panY = (containerRect.height - (this.canvasHeight * fitZoom)) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	zoomToFill() {
		if (!this.canvasWidth) return;

		const containerRect = this.previewContainer.getBoundingClientRect();
		const padding = 40;

		const scaleX = (containerRect.width - padding) / this.canvasWidth;
		const scaleY = (containerRect.height - padding) / this.canvasHeight;
		const fillZoom = Math.max(scaleX, scaleY);

		this.currentZoom = fillZoom;

		// Update zoom index
		this.currentZoomIndex = CONFIG.zoomLevels.findIndex(z => z >= fillZoom);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = CONFIG.zoomLevels.length - 1;

		// Center the canvas
		this.panX = (containerRect.width - (this.canvasWidth * fillZoom)) / 2;
		this.panY = (containerRect.height - (this.canvasHeight * fillZoom)) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	resetZoom() {
		if (!this.canvasWidth) return;

		const containerRect = this.previewContainer.getBoundingClientRect();

		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.zoomLevels.indexOf(1);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 3;

		// Center the canvas
		this.panX = (containerRect.width - this.canvasWidth) / 2;
		this.panY = (containerRect.height - this.canvasHeight) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	resetZoomSmart() {
		if (!this.canvasWidth) return;

		const containerRect = this.previewContainer.getBoundingClientRect();

		// Safety check for hidden container
		if (containerRect.width === 0 || containerRect.height === 0) return;

		const padding = 40;
		const scaleX = (containerRect.width - padding) / this.canvasWidth;
		const scaleY = (containerRect.height - padding) / this.canvasHeight;
		const fitZoom = Math.min(scaleX, scaleY);

		// If image needs to shrink to fit, do it. Otherwise 100%
		if (fitZoom < 1) {
			this.zoomToFit();
		} else {
			this.resetViewport();
		}
	}

	resetViewport() {
		if (!this.canvasWidth) return;

		const containerRect = this.previewContainer.getBoundingClientRect();

		// Sync resize tracking
		this.lastViewportWidth = containerRect.width;
		this.lastViewportHeight = containerRect.height;

		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.zoomLevels.indexOf(1);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 3;

		// Center the canvas
		this.panX = (containerRect.width - this.canvasWidth) / 2;
		this.panY = (containerRect.height - this.canvasHeight) / 2;

		this.applyTransform();
	}

	// ===== CENTERING METHODS =====

	centerHorizontal() {
		if (!this.canvasWidth) return;

		const containerRect = this.previewContainer.getBoundingClientRect();
		const scaledWidth = this.canvasWidth * this.currentZoom;

		// Center horizontally, keep vertical position
		this.panX = (containerRect.width - scaledWidth) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	centerVertical() {
		if (!this.canvasWidth) return;

		const containerRect = this.previewContainer.getBoundingClientRect();
		const scaledHeight = this.canvasHeight * this.currentZoom;

		// Center vertically, keep horizontal position
		this.panY = (containerRect.height - scaledHeight) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	// ===== PAN METHODS =====

	startPan(x, y) {
		if (!this.canvasWidth) return;

		this.isPanning = true;
		this.panStartX = x;
		this.panStartY = y;
		this.lastPanX = this.panX;
		this.lastPanY = this.panY;

		this.previewContainer.classList.add('panning');
	}

	endPan() {
		if (!this.isPanning) return;

		this.isPanning = false;
		this.previewContainer.classList.remove('panning');
	}

	// ===== TOUCH GESTURES =====

	setupTouchGestures() {
		const container = this.previewContainer;

		const getTouchDistance = (touch1, touch2) => {
			const dx = touch2.clientX - touch1.clientX;
			const dy = touch2.clientY - touch1.clientY;
			return Math.sqrt(dx * dx + dy * dy);
		};

		const getTouchCenter = (touch1, touch2) => {
			return {
				x: (touch1.clientX + touch2.clientX) / 2,
				y: (touch1.clientY + touch2.clientY) / 2
			};
		};

		container.addEventListener('touchstart', (e) => {
			if (e.touches.length === 1) {
				// Single finger - prepare for pan
				this.touch.singleFingerPan = true;
				this.touch.singleFingerStart = {
					x: e.touches[0].clientX,
					y: e.touches[0].clientY
				};
				this.touch.startPanX = this.panX;
				this.touch.startPanY = this.panY;
			} else if (e.touches.length === 2) {
				// Two fingers - disable single pan, start pinch/pan
				e.preventDefault();
				this.touch.singleFingerPan = false;

				const center = getTouchCenter(e.touches[0], e.touches[1]);
				const rect = container.getBoundingClientRect();
				const anchorX = center.x - rect.left;
				const anchorY = center.y - rect.top;

				const canvasX = (anchorX - this.panX) / this.currentZoom;
				const canvasY = (anchorY - this.panY) / this.currentZoom;

				this.touch.active = true;
				this.touch.startDistance = getTouchDistance(e.touches[0], e.touches[1]);
				this.touch.startZoom = this.currentZoom;
				this.touch.anchorScreen = { x: anchorX, y: anchorY };
				this.touch.anchorCanvas = { x: canvasX, y: canvasY };
				this.touch.lastCenter = center;
				this.touch.startPanX = this.panX;
				this.touch.startPanY = this.panY;
			}
		}, { passive: false });

		container.addEventListener('touchmove', (e) => {
			// Handle single finger pan
			if (e.touches.length === 1 && this.touch.singleFingerPan) {
				e.preventDefault();

				const deltaX = e.touches[0].clientX - this.touch.singleFingerStart.x;
				const deltaY = e.touches[0].clientY - this.touch.singleFingerStart.y;

				this.panX = this.touch.startPanX + deltaX;
				this.panY = this.touch.startPanY + deltaY;

				this.applyTransform();
				this._notifyViewportChanged();
			}
			// Handle two finger pinch/pan
			else if (this.touch.active && e.touches.length === 2) {
				e.preventDefault();

				const currentCenter = getTouchCenter(e.touches[0], e.touches[1]);
				const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);

				const scale = currentDistance / this.touch.startDistance;
				const distanceChange = Math.abs(currentDistance - this.touch.startDistance);
				const isPanning = distanceChange < 10;

				if (isPanning) {
					// Two-finger pan
					const deltaX = currentCenter.x - this.touch.lastCenter.x;
					const deltaY = currentCenter.y - this.touch.lastCenter.y;

					this.panX += deltaX;
					this.panY += deltaY;
					this.touch.lastCenter = currentCenter;
				} else {
					// Pinch zoom - keep anchor fixed to prevent jumping
					const newZoom = Math.max(0.1, Math.min(16, this.touch.startZoom * scale));

					const newCanvasX = this.touch.anchorCanvas.x * newZoom;
					const newCanvasY = this.touch.anchorCanvas.y * newZoom;

					this.panX = this.touch.anchorScreen.x - newCanvasX;
					this.panY = this.touch.anchorScreen.y - newCanvasY;
					this.currentZoom = newZoom;

					this.currentZoomIndex = CONFIG.zoomLevels.findIndex(z => z >= newZoom);
					if (this.currentZoomIndex === -1) {
						this.currentZoomIndex = CONFIG.zoomLevels.length - 1;
					}
				}

				this.applyTransform();
				this._notifyViewportChanged();
			}
		}, { passive: false });

		container.addEventListener('touchend', (e) => {
			if (e.touches.length === 0) {
				this.touch.singleFingerPan = false;
				this.touch.active = false;
			} else if (e.touches.length < 2) {
				this.touch.active = false;
			}
		});

		container.addEventListener('touchcancel', () => {
			this.touch.active = false;
			this.touch.singleFingerPan = false;
		});
	}

	// ===== RESIZE HANDLING =====

	handleWindowResize() {
		clearTimeout(this.resizeTimeout);
		this.resizeTimeout = setTimeout(() => {
			this.performResizeUpdate();
		}, 100);
	}

	performResizeUpdate() {
		const containerRect = this.previewContainer.getBoundingClientRect();
		const newWidth = containerRect.width;
		const newHeight = containerRect.height;

		// If canvas exists, adjust pan to keep centered
		if (this.canvasWidth) {
			const deltaX = newWidth - this.lastViewportWidth;
			const deltaY = newHeight - this.lastViewportHeight;

			this.panX += deltaX / 2;
			this.panY += deltaY / 2;

			this.applyTransform();
			this._notifyViewportChanged();

			// Optional: auto-fit on resize
			this.zoomToFit();
		}

		// Update stored dimensions
		this.lastViewportWidth = newWidth;
		this.lastViewportHeight = newHeight;
	}

	// ===== TRANSFORM APPLICATION =====

	applyTransform() {
		this.previewWrapper.style.transform =
			`translate(${this.panX}px, ${this.panY}px) scale(${this.currentZoom})`;
	}

	// ===== PRIVATE HELPERS =====

	_handlePanStart(e) {
		// Will be controlled by editor based on current tool
		// Editor will call startPan() when appropriate
	}

	_handlePanMove(e) {
		if (!this.isPanning) return;

		const deltaX = e.clientX - this.panStartX;
		const deltaY = e.clientY - this.panStartY;

		this.panX = this.lastPanX + deltaX;
		this.panY = this.lastPanY + deltaY;

		this.applyTransform();
		e.preventDefault();
	}

	_notifyViewportChanged() {
		// Dispatch custom event for editor to listen to
		window.dispatchEvent(new CustomEvent('viewportChanged', {
			detail: {
				zoom: this.currentZoom,
				zoomPercentage: this.getZoomPercentage(),
				panX: this.panX,
				panY: this.panY
			}
		}));
	}
}

// ============================================
// LAYER MANAGER CLASS
// Handles all layer CRUD operations, selection, reordering, and rendering
// ============================================
class LayerManager {
	constructor(editor) {
		// Reference to main editor for callbacks
		this.editor = editor;

		// Layer state
		this.layers = [];
		this.activeLayerId = null;

		// Drag and drop state (desktop)
		this.draggedLayerId = null;
		this.dropTargetId = null;
		this.dropInsertAbove = false;
		this.dragScrollInterval = null;

		// Touch drag state (mobile)
		this.touchDragStartY = 0;
		this.touchDragLastY = 0;

		// DOM references
		this.layersListContainer = document.getElementById('layersList');
		this.glitterBackgroundsContainer = editor.glitterBackgroundsContainer;

		this.setupContainerEvents();
	}

	// ===== INITIALIZATION =====

	setupContainerEvents() {
		// Layer deselection when clicking empty space
		this.layersListContainer.addEventListener('click', (e) => {
			if (e.target === this.layersListContainer) {
				this.setActiveLayer(null);
			}
		});

		// Handle dragging over empty space at bottom
		this.layersListContainer.addEventListener('dragover', (e) => {
			if (this.draggedLayerId && e.target === this.layersListContainer) {
				e.preventDefault();
				const layerItems = this.layersListContainer.querySelectorAll('.layer-item');
				if (layerItems.length === 0) return;

				const lastItem = layerItems[layerItems.length - 1];
				const lastRect = lastItem.getBoundingClientRect();
			}
		});

		// Drop handler for container
		this.layersListContainer.addEventListener('drop', (e) => {
			if (e.target === this.layersListContainer) {
				this.handleLayerDrop(e, null);
			}
		});
	}


	getLayerZIndex(layerId) {
		const index = this.layers.findIndex(l => l.id === layerId);
		return index !== -1 ? index + 1 : 1;
	}

	// ===== LAYER CRUD =====

	generateLayerId() {
		return `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	createBaseImageLayer() {
		const layer = {
			id: this.generateLayerId(),
			type: LayerType.BASE_IMAGE,
			image: null,
			visible: true,
			locked: true
		};
		return layer;
	}

	createLayer(type = LayerType.GLITTER_FILL) {  // ADD type parameter
		if (this.layers.length >= CONFIG.maxLayers) {
			this.editor.showError(`Maximum ${CONFIG.maxLayers} layers reached`);
			return null;
		}

		// Only create glitter-fill layers here
		// Stickers created via stickerManager.createStickerLayer()
		if (type !== LayerType.GLITTER_FILL) {
			console.error('Use stickerManager.createStickerLayer() for sticker layers');
			return null;
		}

		const layer = {
			id: this.generateLayerId(),
			type: LayerType.GLITTER_FILL,  // ADD THIS
			visible: true,
			locked: false,
			selections: [],
			selectedGlitterIndex: CONFIG.defaultGlitterIndex,
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

	// In LayerManager class

	addLayer(type = LayerType.GLITTER_FILL) {
		// Check max layers
		if (this.layers.length >= CONFIG.maxLayers) {
			this.editor.showError(`Maximum ${CONFIG.maxLayers} layers reached`);
			return;
		}

		let layer;

		if (type === LayerType.STICKER) {
			// Create an EMPTY sticker layer
			layer = this.editor.stickerManager.createEmptyStickerLayer();
		} else {
			// Create a standard glitter layer
			layer = this.createLayer(LayerType.GLITTER_FILL);
		}

		if (!layer) return;

		this.layers.push(layer);
		this.setActiveLayer(layer.id);
		this.renderLayersList();

		// Save state
		this.editor.saveState();
		this.editor.updateActionButtons();

		const msg = type === LayerType.STICKER ? 'Empty sticker layer added' : 'Layer added';
		this.editor.updateStatus(msg);
	}

	deleteLayer(layerId) {


		if (this.layers.length <= 1) {
			this.editor.showError('Cannot delete the last layer');
			return;
		}

		const index = this.layers.findIndex(l => l.id === layerId);
		if (index === -1) return;

		// if layer is locked
		if (this.layers[index].locked) {
			this.editor.showError('Cannot delete locked layer');
			return;
		}

		// ADD: Clean up sticker if it's a sticker layer
		const layer = this.layers[index];
		if (layer.type === LayerType.STICKER && this.editor.stickerManager) {
			this.editor.stickerManager.removeSticker(layerId);
		}

		this.layers.splice(index, 1);

		if (this.activeLayerId === layerId) {
			const newActiveIndex = Math.max(0, index - 1);
			this.setActiveLayer(this.layers[newActiveIndex].id);
		}

		this.renderLayersList();
		this.editor.saveState();
		this.editor.updatePreview();
		this.editor.updateActionButtons();
		this.editor.updateStatus('Layer deleted');
	}

	toggleLayerVisibility(layerId) {
		const layer = this.layers.find(l => l.id === layerId);
		if (!layer) return;

		layer.visible = !layer.visible;

		// ADD: Update sticker element visibility
		if (layer.type === LayerType.STICKER && this.editor.stickerManager) {
			const element = this.editor.stickerManager.stickerElements.get(layerId);
			if (element) {
				element.style.display = layer.visible ? 'block' : 'none';
			}
		}

		this.renderLayersList();
		this.editor.saveState();
		this.editor.updatePreview();
	}

	// ===== LAYER SELECTION =====



	setActiveLayer(layerId) {
		this.activeLayerId = layerId;
		this.renderLayersList();

		const layer = this.layers.find(l => l.id === layerId);

		// ============================================================
		// AUTO-SWITCH TOOL BASED ON LAYER TYPE
		// ============================================================
		if (layer) {
			if (layer.type === LayerType.GLITTER_FILL) {
				// Glitter Fill -> Color Picker (to add more glitter)
				this.editor.setTool(ToolType.COLOR_PICKER);
			} else if (layer.type === LayerType.STICKER) {
				// Sticker -> Select Tool (to move/resize)
				this.editor.setTool(ToolType.SELECT);
			}
		}

		// 1. Update Sticker Highlights
		if (this.editor.stickerManager) {
			this.editor.stickerManager.updateSelectionHighlight(layerId);
		}

		// Update sticker center controls visibility
		const stickerCenterControls = document.getElementById('stickerCenterControls');
		if (stickerCenterControls) {
			const shouldShow = this.editor.currentTool === ToolType.SELECT && layer && layer.type === LayerType.STICKER;

			if (shouldShow) {
				stickerCenterControls.classList.add('visible');
			} else {
				stickerCenterControls.classList.remove('visible');
			}
		}

		// 2. Update Base Image Highlight
		// Strict check: Only add class if layer exists AND is Base Image.
		// Explicitly remove it in all other cases.
		if (this.editor.previewCanvas) {
			const isBaseImage = layer && layer.type === LayerType.BASE_IMAGE;

			// Use 'selected' if that is your global CSS preference, 
			// or 'selected-base' if you want specific styling.
			// We force a boolean (!!isBaseImage) to ensure correct toggle behavior.
			this.editor.previewCanvas.classList.toggle('selected', !!isBaseImage);

			// Safety: Ensure we don't have lingering 'selected' class if you use that generic name too
			if (!isBaseImage) {
				this.editor.previewCanvas.classList.remove('selected');
			}
		}

		// 3. Update Side Panel UI
		this.editor.updateSidePanelUI(layer);

		// 4. Load settings
		if (layer) {
			if (layer.type === LayerType.STICKER) {
				this.editor.hideStickerSettingsEmptyState();
				this.editor.loadStickerSettings(layer);
				this.editor.updateStickerSelection(); // ADD THIS LINE
			} else if (layer.type === LayerType.GLITTER_FILL) {
				this.editor.hideLayerSettingsEmptyState();
				this.editor.hideGlitterSettingsEmptyState();
				this.editor.loadActiveLayerSettings();
				this.editor.updateGlitterSelection();
			}
		} else {
			// No layer selected: Ensure empty states are shown
			this.editor.showLayerSettingsEmptyState();
			this.editor.showGlitterSettingsEmptyState();
			this.editor.showStickerSettingsEmptyState();
		}

		window.dispatchEvent(new CustomEvent('layerChanged', {
			detail: { layerId, layer }
		}));

		this.editor.updatePreview();
	}



	getActiveLayer() {
		return this.layers.find(l => l.id === this.activeLayerId);
	}

	// ===== LAYER NAVIGATION =====

	goToGlitter(layerId) {
		const layer = this.layers.find(l => l.id === layerId);
		if (!layer) return;

		const glitterIndex = layer.selectedGlitterIndex;

		// Select this layer
		this.setActiveLayer(layerId);

		// On mobile, open the glitter drawer first
		if (window.innerWidth <= 800 && this.editor.mobileManager) {
			this.editor.mobileManager.toggleDrawer('glitter');
		}

		// Scroll to the glitter option
		this.scrollToGlitter(glitterIndex);
	}

	scrollToGlitter(glitterIndex) {
		const glitterOption = document.querySelector(`.glitter-option[data-index="${glitterIndex}"]`);
		if (!glitterOption) return;

		const glitterOptions = document.querySelector('.glitter-options');
		if (!glitterOptions) return;

		// Scroll the glitter option into view
		glitterOption.scrollIntoView({
			behavior: 'smooth',
			block: 'center'
		});

		// Brief highlight effect
		glitterOption.classList.add('highlight');
		setTimeout(() => {
			glitterOption.classList.remove('highlight');
		}, 1000);
	}


	goToSticker(layerId) {
		const layer = this.layers.find(l => l.id === layerId);
		if (!layer || layer.type !== LayerType.STICKER) return;

		// Select this layer
		this.setActiveLayer(layerId);

		// On mobile, open the appropriate drawer
		if (window.innerWidth <= 800 && this.editor.mobileManager) {
			// For stickers, we might want to open a sticker picker drawer
			// For now, just open the sticker settings
			this.editor.mobileManager.toggleDrawer('layer-settings');
		}

		// Optionally scroll to the sticker in the sticker picker
		// (similar to how glitter scrolls to the selected glitter)
		const stickerId = layer.stickerSourceId;
		if (stickerId) {
			this.scrollToSticker(stickerId);
		}
	}

	scrollToSticker(stickerId) {
		const stickerOption = document.querySelector(`.sticker-option[data-sticker-id="${stickerId}"]`);
		if (!stickerOption) return;

		const stickerContainer = stickerOption.closest('.sticker-grid-container, #stickerGridContainer');
		if (!stickerContainer) return;

		// Scroll the sticker option into view
		stickerOption.scrollIntoView({
			behavior: 'smooth',
			block: 'center'
		});

		// Brief highlight effect
		stickerOption.classList.add('highlight');
		setTimeout(() => {
			stickerOption.classList.remove('highlight');
		}, 1000);
	}


	// ===== LAYER PICKING (SELECT TOOL) =====

	// In LayerManager class

	handleLayerPick(x, y) {
		// Check layers from top to bottom (visual order)
		for (let i = this.layers.length - 1; i >= 0; i--) {
			const layer = this.layers[i];

			// 1. Skip invisible layers
			if (!layer.visible) continue;

			let isHit = false;

			// 2. Check Hit based on Layer Type
			if (layer.type === LayerType.STICKER) {
				isHit = this.isPointInSticker(layer, x, y);
			}
			else if (layer.type === LayerType.GLITTER_FILL) {
				// Existing logic: Check if pixel matches selection criteria
				if (layer.selections && layer.selections.length > 0) {
					isHit = this.isPixelInLayerSelection(layer, x, y);
				}
			}
			else if (layer.type === LayerType.BASE_IMAGE) {
				// Base image covers the whole canvas (if loaded)
				// Since we iterate top-down, we only hit this if nothing above it was clicked
				if (this.editor.originalImage) {
					isHit = true;
				}
			}

			// 3. If Hit, Select and Return
			if (isHit) {
				this.setActiveLayer(layer.id);

				// UX Feedback
				let name = 'Layer';
				if (layer.type === LayerType.STICKER) name = layer.name;
				else if (layer.type === LayerType.BASE_IMAGE) name = "Base Image";
				else if (layer.type === LayerType.GLITTER_FILL) {
					name = this.editor.glitterManager.glitterGifs[layer.selectedGlitterIndex]?.name || 'Glitter';
				}

				this.editor.updateStatus(`Selected: ${name}`);

				// Visual feedback (flash)
				const flash = document.createElement('div');
				flash.className = 'layer-pick-flash';
				flash.style.left = (x / this.editor.previewCanvas.width * 100) + '%';
				flash.style.top = (y / this.editor.previewCanvas.height * 100) + '%';
				this.editor.previewWrapper.appendChild(flash);
				setTimeout(() => flash.remove(), 300);

				return; // Stop checking lower layers
			}
		}

		// If loop finishes with no hits
		this.setActiveLayer(null);
		this.editor.updateStatus('No layer at this location');
	}

	// --- NEW HELPER METHOD ---
	// Calculates if click (x,y) is inside a rotated/scaled sticker
	isPointInSticker(layer, clickX, clickY) {
		if (layer.stickerData.isEmpty || !layer.stickerData.url) return false;

		const t = layer.stickerData.transform;
		const w = layer.stickerData.width;
		const h = layer.stickerData.height;

		// 1. Translate click relative to sticker center
		let dx = clickX - t.position.x;
		let dy = clickY - t.position.y;

		// 2. Un-rotate (Rotate click point by -angle)
		const angleRad = -t.rotation * (Math.PI / 180);
		const rx = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
		const ry = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);

		// 3. Un-scale
		// Note: transform.scale is in percentage (e.g. 100), so we divide by 100
		const sx = t.scale.x / 100;
		const sy = t.scale.y / 100;

		const lx = rx / sx;
		const ly = ry / sy;

		// 4. Check boundaries
		// Since (0,0) is now the center, we check against +/- half width/height
		const halfW = w / 2;
		const halfH = h / 2;

		return (lx >= -halfW && lx <= halfW && ly >= -halfH && ly <= halfH);
	}

	isPixelInLayerSelection(layer, x, y) {
		const pixelIndex = y * this.editor.originalCanvas.width + x;
		const i = pixelIndex * 4;

		const pixelR = this.editor.originalImageData.data[i];
		const pixelG = this.editor.originalImageData.data[i + 1];
		const pixelB = this.editor.originalImageData.data[i + 2];
		const pixelAlpha = this.editor.originalAlphaChannel[pixelIndex];

		// Check if pixel is transparent
		if (pixelAlpha < CONFIG.alphaThreshold) {
			return false;
		}

		// Check if pixel matches any of this layer's color selections
		const threshold = layer.settings.threshold;
		const invert = layer.settings.invert;

		for (const sel of layer.selections) {
			const distance = Math.sqrt(
				Math.pow(pixelR - sel.r, 2) +
				Math.pow(pixelG - sel.g, 2) +
				Math.pow(pixelB - sel.b, 2)
			);

			const matches = distance <= threshold;
			if (invert ? !matches : matches) {
				return true;
			}
		}

		return false;
	}

	// ===== RENDERING =====

	renderLayersList() {
		const container = this.layersListContainer;

		// Add insertion line if it doesn't exist
		let insertionLine = container.querySelector('.layer-insertion-line');
		if (!insertionLine) {
			insertionLine = document.createElement('div');
			insertionLine.className = 'layer-insertion-line';
			container.appendChild(insertionLine);
		}

		container.innerHTML = '';
		container.appendChild(insertionLine);

		// Render layers in reverse order (visual stacking)
		[...this.layers].reverse().forEach((layer, index) => {
			const layerEl = this.createLayerElement(layer);
			container.appendChild(layerEl);
		});

		// Update layer count displays
		this.updateLayerCount();

		// Update add button states
		const addLayerBtn = document.getElementById('addLayerBtn');
		if (addLayerBtn) {
			addLayerBtn.disabled = this.layers.length >= CONFIG.maxLayers;
		}

		const mobileAddBtn = document.getElementById('mobileAddLayerBtn');
		if (mobileAddBtn) {
			mobileAddBtn.disabled = this.layers.length >= CONFIG.maxLayers;
		}

		// Update mobile swatch
		this.updateMobileLayersSwatch();
	}

	cloneLayer(layerId) {
		const sourceLayer = this.layers.find(l => l.id === layerId);
		if (!sourceLayer) return null;

		// Can't clone locked layers (base image)
		if (sourceLayer.locked) {
			this.editor.showError('Cannot clone locked layer');
			return null;
		}

		// Check max layers
		if (this.layers.length >= CONFIG.maxLayers) {
			this.editor.showError(`Maximum ${CONFIG.maxLayers} layers reached`);
			return null;
		}

		// Create new layer based on type
		let clonedLayer;

		if (sourceLayer.type === LayerType.STICKER) {
			// Clone sticker layer - deep copy the stickerData structure
			clonedLayer = {
				id: this.generateLayerId(),
				type: LayerType.STICKER,
				name: sourceLayer.name, // COPY THE NAME
				visible: sourceLayer.visible,
				locked: false,
				stickerSourceId: sourceLayer.stickerSourceId, // Make sure this is copied!
				stickerData: {
					url: sourceLayer.stickerData.url,
					name: sourceLayer.stickerData.name, // COPY THE NAME IN STICKER DATA TOO
					source: sourceLayer.stickerData.source,
					width: sourceLayer.stickerData.width,
					height: sourceLayer.stickerData.height,
					isEmpty: sourceLayer.stickerData.isEmpty,
					isAnimated: sourceLayer.stickerData.isAnimated,
					frames: sourceLayer.stickerData.frames, // Reference is fine, frames are immutable
					transform: {
						position: {
							x: sourceLayer.stickerData.transform.position.x,
							y: sourceLayer.stickerData.transform.position.y
						},
						scale: {
							x: sourceLayer.stickerData.transform.scale.x,
							y: sourceLayer.stickerData.transform.scale.y
						},
						rotation: sourceLayer.stickerData.transform.rotation,
						opacity: sourceLayer.stickerData.transform.opacity,
						flipX: sourceLayer.stickerData.transform.flipX,
						flipY: sourceLayer.stickerData.transform.flipY
					}
					// Don't copy element - it will be created fresh
				}
			};

			// Clone the DOM element via stickerManager
			this.editor.stickerManager.cloneStickerElement(sourceLayer, clonedLayer);

		} else {
			// Clone glitter layer
			clonedLayer = {
				id: this.generateLayerId(),
				type: LayerType.GLITTER_FILL,
				visible: sourceLayer.visible,
				locked: false,
				selections: sourceLayer.selections.map(sel => ({ ...sel })),
				selectedGlitterIndex: sourceLayer.selectedGlitterIndex,
				settings: { ...sourceLayer.settings }
			};

			// Clone the glitter background element
			const sourceElement = this.glitterBackgroundsContainer.querySelector(
				`[data-layer-id="${sourceLayer.id}"]`
			);
			if (sourceElement) {
				const clonedElement = sourceElement.cloneNode(true);
				clonedElement.dataset.layerId = clonedLayer.id;
				this.glitterBackgroundsContainer.appendChild(clonedElement);
			}
		}

		// Find original layer index and insert clone right after it
		// (Higher index = visually above in the stack)
		const sourceIndex = this.layers.findIndex(l => l.id === layerId);
		this.layers.splice(sourceIndex + 1, 0, clonedLayer);

		// Make the clone active and re-render
		this.setActiveLayer(clonedLayer.id);
		this.renderLayersList();
		this.reorderGlitterBackgrounds();

		this.editor.saveState();
		this.editor.updateActionButtons();

		return clonedLayer;
	}
	createLayerElement(layer) {
		const layerEl = document.createElement('div');
		layerEl.className = 'layer-item';
		layerEl.dataset.layerId = layer.id;

		// Only allow dragging if not locked
		if (!layer.locked) {
			layerEl.draggable = true;
		}

		if (layer.id === this.activeLayerId) {
			layerEl.classList.add('active');
		}

		// 1. Drag Handle
		const dragHandle = document.createElement('div');
		dragHandle.className = 'layer-drag-handle';

		// Only show drag handle icon if not locked
		if (!layer.locked) {
			dragHandle.innerHTML = `
                <svg class="icon" viewBox="0 0 24 24">
                    <path d="M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z" fill="currentColor"/>
                </svg>
            `;
		} else {
			// Optional: You can leave it empty, or add a small lock indicator here too
			dragHandle.style.cursor = 'default';
		}

		// 2. Swatch (Thumbnail)
		const swatch = document.createElement('div');
		swatch.className = 'layer-swatch';

		if (layer.type === LayerType.STICKER) {
			// Sticker Logic
			swatch.classList.add('sticker');
			if (layer.stickerData.isEmpty) {
				swatch.classList.add('empty');
				swatch.innerHTML = '<span>?</span>';
			} else {
				swatch.style.backgroundImage = `url(${layer.stickerData.url})`;
			}
		} else if (layer.type === LayerType.BASE_IMAGE) {
			// --- FIX: Base Image Thumbnail ---
			if (this.editor.originalImage) {
				swatch.style.backgroundImage = `url(${this.editor.originalImage.src})`;
				swatch.classList.add('baseImage');
			}
		} else {
			// Glitter Logic
			const glitter = this.editor.glitterManager.glitterGifs[layer.selectedGlitterIndex];
			if (glitter) {
				swatch.style.backgroundImage = `url(${glitter.url})`;

				swatch.classList.add('glitter');
				if (glitter.isPixelated) swatch.classList.add('pixelated');

			}
		}

		// Double-click swatch behavior
		swatch.addEventListener('click', (e) => {
			e.stopPropagation();
			if (layer.type === LayerType.GLITTER_FILL) {
				this.goToGlitter(layer.id);
			} else if (layer.type === LayerType.STICKER) {
				this.goToSticker(layer.id);
			}
		});



		// 3. Info (Name)
		const info = document.createElement('div');
		info.className = 'layer-info';

		const nameText = document.createElement('div');
		nameText.className = 'layer-name'; // Changed from layer-color for semantics

		if (layer.type === LayerType.STICKER) {
			nameText.textContent = layer.name || 'Sticker';
		} else if (layer.type === LayerType.GLITTER_FILL) {
			const glitter = this.editor.glitterManager.glitterGifs[layer.selectedGlitterIndex];
			nameText.textContent = glitter ? `${glitter.category} - ${glitter.name}` : 'No glitter';
		} else if (layer.type === LayerType.BASE_IMAGE) {
			nameText.textContent = 'Base Image';
		}

		info.appendChild(nameText);

		// 3.5 layer type
		const typeText = document.createElement('div');
		typeText.className = 'layer-type';
		if (layer.type === LayerType.STICKER) {
			typeText.textContent = 'Sticker';
		} else if (layer.type === LayerType.GLITTER_FILL) {
			typeText.textContent = 'Glitter';
		} else if (layer.type === LayerType.BASE_IMAGE) {
			typeText.textContent = 'Image';
		}
		info.appendChild(typeText);


		// 4. Actions
		const actions = document.createElement('div');
		actions.className = 'layer-actions';

		// A. Go To Arrow (Only for Glitter/Stickers)
		if (layer.type !== LayerType.BASE_IMAGE) {
			const arrowBtn = this.createIconButton({
				className: 'layer-action-btn goto-glitter',
				title: layer.type === LayerType.STICKER ? 'Go to sticker' : 'Go to glitter',
				iconType: 'chevron-right',
				onClick: (e) => {
					e.stopPropagation();
					if (layer.type === LayerType.STICKER) {
						this.goToSticker(layer.id);
					} else {
						this.goToGlitter(layer.id);
					}
				}
			});
			actions.appendChild(arrowBtn);
		}


		// Clone Layer
		if (!layer.locked) {
			const cloneBtn = this.createIconButton({
				className: 'layer-action-btn clone',
				title: 'Clone layer',
				iconType: 'clone',
				onClick: (e) => {
					e.stopPropagation();
					this.cloneLayer(layer.id);
				}
			});
			actions.appendChild(cloneBtn);

		}


		// B. Visibility
		const visBtn = this.createIconButton({
			className: 'layer-action-btn visibility' + (!layer.visible ? ' hidden' : ''),
			title: layer.visible ? 'Hide layer' : 'Show layer',
			iconType: 'eye',
			onClick: (e) => {
				e.stopPropagation();
				this.toggleLayerVisibility(layer.id);
			}
		});
		actions.appendChild(visBtn);

		// C. Lock vs Delete
		if (layer.locked) {
			// --- FIX: Show Lock Icon for Base Layer ---

		} else {
			// Show Delete for other layers
			const delBtn = this.createIconButton({
				className: 'layer-action-btn delete',
				title: 'Delete layer',
				iconType: 'x-mark',
				onClick: (e) => {
					e.stopPropagation();
					if (confirm('Delete this layer?')) {
						this.deleteLayer(layer.id);
					}
				}
			});
			actions.appendChild(delBtn);
		}

		layerEl.append(dragHandle, swatch, info, actions);
		layerEl.onclick = () => this.setActiveLayer(layer.id);

		// Attach Drag Events only if not locked
		// Attach Drag Events (even for locked layers, so we can drop AROUND them)
		layerEl.addEventListener('dragover', (e) => this.handleLayerDragOver(e, layer.id));
		layerEl.addEventListener('dragleave', (e) => this.handleLayerDragLeave(e));
		layerEl.addEventListener('drop', (e) => this.handleLayerDrop(e, layer.id));
		layerEl.addEventListener('dragend', (e) => this.handleLayerDragEnd(e));

		// Only attach drag START and touch events if not locked
		if (!layer.locked) {
			layerEl.addEventListener('dragstart', (e) => this.handleLayerDragStart(e, layer.id));

			// Touch
			layerEl.addEventListener('touchstart', (e) => this.handleLayerTouchStart(e, layer.id), { passive: false });
			layerEl.addEventListener('touchmove', (e) => this.handleLayerTouchMove(e), { passive: false });
			layerEl.addEventListener('touchend', (e) => this.handleLayerTouchEnd(e));
		}

		return layerEl;
	}

	createIconButton({ className = '', id = '', disabled = false, title = '', iconType = '', label = '', onClick }) {
		const btn = document.createElement('button');
		btn.className = "btn-icon icon-wrapper " + className;
		if (id) btn.id = id;
		if (disabled) btn.disabled = true;
		if (title) btn.title = title;

		if (iconType) {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.classList.add('icon');
			const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
			use.setAttribute('href', `#icon-${iconType}`);
			svg.appendChild(use);
			btn.appendChild(svg);
		}

		if (label) {
			const span = document.createElement('span');
			span.className = 'name';
			span.textContent = label;
			btn.appendChild(span);
		}

		if (onClick) btn.onclick = onClick;

		return btn;
	}

	updateLayerCount() {
		const layerCount = document.querySelector('.section-header-title-count');
		if (layerCount) {
			layerCount.setAttribute('data-count', this.layers.length);
		}

		const mobileLayersCount = document.querySelector('.mobile-layers-count');
		if (mobileLayersCount) {
			mobileLayersCount.setAttribute('data-count', this.layers.length);
		}
	}

	updateMobileLayersSwatch() {
		const mobileLayersSwatch = document.querySelector('.mobile-layers-swatch');
		if (!mobileLayersSwatch) return;

		const activeLayer = this.getActiveLayer();

		if (!activeLayer) {
			mobileLayersSwatch.classList.add('empty');
			mobileLayersSwatch.classList.remove('pixelated');
			mobileLayersSwatch.style.backgroundImage = '';
			return;
		}

		const glitter = this.editor.glitterManager.glitterGifs[activeLayer.selectedGlitterIndex];
		if (glitter) {
			mobileLayersSwatch.classList.remove('empty');
			mobileLayersSwatch.style.backgroundImage = `url(${glitter.url})`;

			if (glitter.isPixelated) {
				mobileLayersSwatch.classList.add('pixelated');
			} else {
				mobileLayersSwatch.classList.remove('pixelated');
			}
		} else {
			mobileLayersSwatch.classList.add('empty');
			mobileLayersSwatch.classList.remove('pixelated');
			mobileLayersSwatch.style.backgroundImage = '';
		}
	}

	// ===== DRAG AND DROP (DESKTOP) =====

	handleLayerDragStart(event, layerId) {
		// Check if layer is locked
		const layer = this.layers.find(l => l.id === layerId);
		if (layer && layer.locked) {
			event.preventDefault();
			return;
		}

		this.draggedLayerId = layerId;
		event.target.classList.add('dragging');
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/html', event.target.innerHTML);
	}

	handleLayerDragOver(event, targetLayerId) {
		event.preventDefault();

		if (!this.draggedLayerId) return;

		// Call existing scroll handler
		this.handleLayerDragScroll(event);

		const targetElement = event.currentTarget;
		const rect = targetElement.getBoundingClientRect();
		const containerRect = this.layersListContainer.getBoundingClientRect();
		const insertionLine = this.layersListContainer.querySelector('.layer-insertion-line');

		// Calculate drop position
		const midpoint = rect.top + rect.height / 2;
		const insertAbove = event.clientY < midpoint; // Visually above (higher array index)

		const draggedIndex = this.layers.findIndex(l => l.id === this.draggedLayerId);
		const targetIndex = this.layers.findIndex(l => l.id === targetLayerId);

		// ============================================================
		// Lock Constraint Logic
		// ============================================================

		// 1. Don't allow dropping onto itself
		if (targetIndex === draggedIndex) {
			insertionLine.classList.remove('visible');
			return;
		}

		// 2. Prevent dropping BELOW the bottom-most layer if it is locked
		// In the array, index 0 is the bottom. 'insertAbove = false' means visually below.
		if (targetIndex === 0 && this.layers[0].locked && !insertAbove) {
			insertionLine.classList.remove('visible');
			this.dropTargetId = null; // Ensure drop is invalidated
			return;
		}
		// ============================================================

		// Standard adjacency checks (don't show line if dropping exactly where it already is)
		if (targetIndex === draggedIndex - 1 && insertAbove) {
			insertionLine.classList.remove('visible');
			return;
		}
		if (targetIndex === draggedIndex + 1 && !insertAbove) {
			insertionLine.classList.remove('visible');
			return;
		}

		// Calculate Line Position
		event.dataTransfer.dropEffect = 'move';

		let lineY;
		const LAYER_MARGIN_BOTTOM = 6;
		const INSERTION_LINE_HEIGHT = 2;
		const offset = (LAYER_MARGIN_BOTTOM - INSERTION_LINE_HEIGHT) / 2;
		const scrollTop = this.layersListContainer.scrollTop;

		if (insertAbove) {
			lineY = rect.top - containerRect.top + scrollTop - LAYER_MARGIN_BOTTOM + offset;
		} else {
			lineY = rect.bottom - containerRect.top + scrollTop + offset;
		}

		insertionLine.style.top = lineY + 'px';
		insertionLine.classList.add('visible');

		this.dropInsertAbove = insertAbove;
		this.dropTargetId = targetLayerId;
	}

	handleLayerDragLeave(event) {
		const insertionLine = this.layersListContainer.querySelector('.layer-insertion-line');

		// Only hide the visual line, don't clear the drop target
		// This allows drops to work even if you drag slightly outside the container
		if (!this.layersListContainer.contains(event.relatedTarget)) {
			insertionLine.classList.remove('visible');
			// DON'T clear this.dropTargetId here - keep the last valid drop position
		}
	}

	handleLayerDrop(event, targetLayerId) {
		event.preventDefault();

		const insertionLine = this.layersListContainer.querySelector('.layer-insertion-line');
		insertionLine.classList.remove('visible');

		if (!this.draggedLayerId) return;

		// Use stored values from dragover
		targetLayerId = this.dropTargetId;
		const insertAbove = this.dropInsertAbove;

		if (!targetLayerId || this.draggedLayerId === targetLayerId) return;

		const draggedIndex = this.layers.findIndex(l => l.id === this.draggedLayerId);
		const targetIndex = this.layers.findIndex(l => l.id === targetLayerId);

		if (draggedIndex === -1 || targetIndex === -1) return;

		// Remove the dragged layer
		const [draggedLayer] = this.layers.splice(draggedIndex, 1);

		// Recalculate target index after removal
		let newTargetIndex = this.layers.findIndex(l => l.id === targetLayerId);

		// Visual order is reversed!
		// "Above" visually = higher index in array = AFTER target
		// "Below" visually = lower index in array = AT target
		let newIndex = insertAbove ? newTargetIndex + 1 : newTargetIndex;

		// Insert at new position
		this.layers.splice(newIndex, 0, draggedLayer);

		// OPTIMIZED: Just reorder DOM instead of recreating
		this.reorderLayerElements();
		this.reorderGlitterBackgrounds();
		this.editor.saveState();
	}

	handleLayerDragEnd(event) {
		event.target.classList.remove('dragging');
		const insertionLine = this.layersListContainer.querySelector('.layer-insertion-line');
		insertionLine.classList.remove('visible');

		if (this.dragScrollInterval) {
			clearInterval(this.dragScrollInterval);
			this.dragScrollInterval = null;
		}

		this.draggedLayerId = null;
	}

	handleLayerDragScroll(event) {
		if (!this.draggedLayerId) return;

		const rect = this.layersListContainer.getBoundingClientRect();
		const scrollZone = CONFIG.scrollZoneSize;
		const scrollSpeed = CONFIG.scrollSpeed;

		const mouseY = event.clientY - rect.top;
		const listHeight = rect.height;

		// Clear existing interval
		if (this.dragScrollInterval) {
			clearInterval(this.dragScrollInterval);
			this.dragScrollInterval = null;
		}

		// Scroll up when near top
		if (mouseY < scrollZone && mouseY > 0) {
			this.dragScrollInterval = setInterval(() => {
				this.layersListContainer.scrollTop = Math.max(0, this.layersListContainer.scrollTop - scrollSpeed);
			}, 16);
		}
		// Scroll down when near bottom
		else if (mouseY > listHeight - scrollZone && mouseY < listHeight) {
			this.dragScrollInterval = setInterval(() => {
				const maxScroll = this.layersListContainer.scrollHeight - this.layersListContainer.clientHeight;
				this.layersListContainer.scrollTop = Math.min(maxScroll, this.layersListContainer.scrollTop + scrollSpeed);
			}, 16);
		}
	}

	// ===== TOUCH DRAG (MOBILE) =====

	handleLayerTouchStart(event, layerId) {
		// ONLY start drag if touching the drag handle specifically
		if (!event.target.closest('.layer-drag-handle')) {
			return;
		}

		// Check if layer is locked
		const layer = this.layers.find(l => l.id === layerId);
		if (layer && layer.locked) {
			return;
		}

		this.draggedLayerId = layerId;
		event.currentTarget.classList.add('dragging');

		const touch = event.touches[0];
		this.touchDragStartY = touch.clientY;
		this.touchDragLastY = touch.clientY;

		event.preventDefault();
	}

	handleLayerTouchMove(event) {
		if (!this.draggedLayerId) return;

		const touch = event.touches[0];
		this.touchDragLastY = touch.clientY;

		// Find which layer element we're over
		const elements = document.elementsFromPoint(touch.clientX, touch.clientY);

		// Don't target the layer we're currently dragging
		const targetLayer = elements.find(el =>
			el.classList.contains('layer-item') &&
			el.dataset.layerId !== this.draggedLayerId
		);

		const insertionLine = this.layersListContainer.querySelector('.layer-insertion-line');

		if (targetLayer && targetLayer.dataset.layerId) {
			const targetLayerId = targetLayer.dataset.layerId;
			const targetIndex = this.layers.findIndex(l => l.id === targetLayerId);

			const rect = targetLayer.getBoundingClientRect();
			const midpoint = rect.top + rect.height / 2;
			const insertAbove = touch.clientY < midpoint;

			// ============================================================
			// Lock Constraint Logic (Mobile)
			// ============================================================
			// Prevent dropping BELOW the bottom-most layer if it is locked
			if (targetIndex === 0 && this.layers[0].locked && !insertAbove) {
				insertionLine.classList.remove('visible');
				this.dropTargetId = null;
				return; // Exit early
			}
			// ============================================================

			// Show insertion line
			const containerRect = this.layersListContainer.getBoundingClientRect();

			let lineY;
			const LAYER_MARGIN_BOTTOM = 6;
			const INSERTION_LINE_HEIGHT = 2;
			const offset = (LAYER_MARGIN_BOTTOM - INSERTION_LINE_HEIGHT) / 2;
			const scrollTop = this.layersListContainer.scrollTop;

			if (insertAbove) {
				lineY = rect.top - containerRect.top + scrollTop - LAYER_MARGIN_BOTTOM + offset;
			} else {
				lineY = rect.bottom - containerRect.top + scrollTop + offset;
			}

			insertionLine.style.top = lineY + 'px';
			insertionLine.classList.add('visible');

			this.dropTargetId = targetLayerId;
			this.dropInsertAbove = insertAbove;
		} else {
			// Hide line if not over a valid target
			insertionLine.classList.remove('visible');
			this.dropTargetId = null;
		}

		event.preventDefault();
	}

	handleLayerTouchEnd(event) {
		if (!this.draggedLayerId) return;

		// Find the dragged element and remove dragging class
		const draggedElement = document.querySelector(`[data-layer-id="${this.draggedLayerId}"]`);
		if (draggedElement) {
			draggedElement.classList.remove('dragging');
		}

		const insertionLine = this.layersListContainer.querySelector('.layer-insertion-line');
		insertionLine.classList.remove('visible');

		// Perform the actual reordering using stored values
		if (this.dropTargetId && this.draggedLayerId !== this.dropTargetId) {
			const draggedIndex = this.layers.findIndex(l => l.id === this.draggedLayerId);

			// Remove the dragged layer first
			if (draggedIndex !== -1) {
				const [draggedLayer] = this.layers.splice(draggedIndex, 1);

				// Recalculate target index after removal (items might have shifted)
				let newTargetIndex = this.layers.findIndex(l => l.id === this.dropTargetId);

				// "Insert Above" visually means a higher index in the array (rendered bottom-to-top)
				let newIndex = this.dropInsertAbove ? newTargetIndex + 1 : newTargetIndex;

				this.layers.splice(newIndex, 0, draggedLayer);
				this.reorderLayerElements();
				this.reorderGlitterBackgrounds();
				this.editor.saveState();
			}
		}

		this.draggedLayerId = null;
		this.dropTargetId = null;
		this.dropInsertAbove = false;
	}

	// ===== OPTIMIZED REORDERING =====

	reorderLayerElements() {
		const container = this.layersListContainer;
		const insertionLine = container.querySelector('.layer-insertion-line');

		// Get all existing layer elements
		const existingElements = new Map();
		container.querySelectorAll('.layer-item').forEach(el => {
			existingElements.set(el.dataset.layerId, el);
		});

		// Reorder them to match layers array (reversed for display)
		const fragment = document.createDocumentFragment();

		[...this.layers].reverse().forEach(layer => {
			const element = existingElements.get(layer.id);
			if (element) {
				// Update active state
				element.classList.toggle('active', layer.id === this.activeLayerId);
				fragment.appendChild(element);
			}
		});

		// Clear and re-append in correct order
		container.innerHTML = '';
		container.appendChild(insertionLine);
		container.appendChild(fragment);
	}

	reorderGlitterBackgrounds() {
		const container = this.glitterBackgroundsContainer;

		// Get existing background AND sticker elements
		const existingElements = new Map();
		container.querySelectorAll('.glitter-background, .sticker-element').forEach(el => {
			existingElements.set(el.dataset.layerId, el);
		});

		// Reorder them to match layers array
		const fragment = document.createDocumentFragment();

		this.layers.forEach(layer => {
			const el = existingElements.get(layer.id);
			if (el) {
				// Update z-index based on position
				if (layer.type === LayerType.STICKER) {
					el.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);
				}
				fragment.appendChild(el);
			}
		});

		container.innerHTML = '';
		container.appendChild(fragment);
	}
}

// ============================================
// GLITTER EDITOR CLASS
// Contains all the logic for the glitter editor - UI and functionality
// ============================================

class GlitterEditor {
	constructor() {
		this.originalCanvas = document.getElementById('originalCanvas');
		this.previewCanvas = document.getElementById('previewCanvas');
		this.previewContainer = document.getElementById('previewContainer');
		this.previewWrapper = document.getElementById('previewWrapper');
		this.glitterBackgroundsContainer = document.getElementById('glitterBackgroundsContainer');

		// Ensure the canvas is the base layer and glitter sits on top
		this.previewCanvas.style.zIndex = '1';
		this.glitterBackgroundsContainer.style.zIndex = '10';
		this.glitterBackgroundsContainer.style.pointerEvents = 'none'; // Allows clicking through to canvas

		this.originalCtx = this.originalCanvas.getContext('2d', { willReadFrequently: true });
		this.previewCtx = this.previewCanvas.getContext('2d', { willReadFrequently: true });


		this.originalImage = null;
		this.originalImageData = null;
		this.originalAlphaChannel = null;
		this.glitterGifs = [];

		this.exporter = new GifExporter();

		// Export settings
		this.exportSettings = {
			quality: CONFIG.defaultExportQuality,
			ditherEnabled: CONFIG.defaultExportDitherEnabled,
			ditherType: CONFIG.defaultExportDitherType,
			frameDelay: CONFIG.defaultExportFrameDelay,
			maxFrames: CONFIG.defaultExportMaxFrames,
			baseImage: CONFIG.defaultExportBaseImage,
			transparency: CONFIG.defaultExportTransparency,
			matteColor: CONFIG.defaultExportMatteColor
		};

		this.exportStartTime = 0;
		this.exportCancelled = false;



		// Preview mode
		this.showAllLayers = true;

		// Global settings mode
		this.refineGlobal = CONFIG.refineGlobalDefault;
		this.glitterGlobal = CONFIG.glitterGlobalDefault;



		this.currentTool = ToolType.SELECT;
		this.history = [];
		this.historyIndex = -1;

		// Initialize Managers
		this.viewport = new ViewportManager(this.previewContainer, this.previewWrapper);
		this.layerManager = new LayerManager(this);
		this.stickerManager = new StickerManager(this);
		this.glitterManager = new GlitterManager(this); // <--- Make sure this is here

		// REMOVE THIS: this.activeFilters = { ... }; 

		this.setTool(CONFIG.defaultTool);

		this.setupEventListeners();

		this.initializeCollapsibleSections();
		this.initializeShortcutsModal();
		this.initializeExportSettings();
	}

	// Convenience accessors for layer state
	get layers() {
		return this.layerManager.layers;
	}

	set layers(value) {
		this.layerManager.layers = value;
	}

	get activeLayerId() {
		return this.layerManager.activeLayerId;
	}

	set activeLayerId(value) {
		this.layerManager.activeLayerId = value;
	}


	updateSidePanelUI(layer) {
		// 1. Define ALL possible sections to hide them first
		const allSections = [
			'welcomeSection', // <--- IMPORTANT: Ensure this is here
			'noLayerSettingsSection',
			'baseLayerSettingsSection',
			'glitterSettingsSection',
			'layerSettingsSection',
			'glitterOptions',
			'glitterSearchSection',
			'stickerSettingsSection',
			'stickersOptions',
			'stickersSearchSection'
		];

		// 2. Hide everything
		allSections.forEach(id => {
			const el = document.getElementById(id);
			if (el) {
				el.classList.remove('visible');
				el.style.display = '';
			}
		});

		// 3. Determine what to show
		let showIds = [];

		// CASE 1: No Image Loaded (Show Welcome)
		if (!this.originalImage) {
			showIds = ['welcomeSection'];
		}
		// CASE 2: Image Loaded, but No Layer Selected
		else if (!layer) {
			showIds = ['noLayerSettingsSection'];
			this.updateNoLayerMetaInfo();
		}
		// CASE 3: Base Layer Selected
		else if (layer.type === LayerType.BASE_IMAGE) {
			showIds = ['baseLayerSettingsSection'];
		}
		// CASE 4: Glitter Layer
		else if (layer.type === LayerType.GLITTER_FILL) {
			showIds = ['glitterSearchSection', 'glitterOptions', 'glitterSettingsSection', 'layerSettingsSection'];
		}
		// CASE 5: Sticker Layer
		else if (layer.type === LayerType.STICKER) {
			showIds = ['stickersSearchSection', 'stickersOptions', 'stickerSettingsSection'];
		}

		// 4. Show the specific sections
		showIds.forEach(id => {
			const el = document.getElementById(id);
			if (el) el.classList.add('visible');
		});
	}

	// NEW HELPER METHOD
	updateNoLayerMetaInfo() {
		const dimEl = document.getElementById('quickMetaDimensions');
		const countEl = document.getElementById('quickMetaLayerCount');

		if (this.originalImage) {
			if (dimEl) dimEl.textContent = `${this.originalCanvas.width} x ${this.originalCanvas.height}`;
			if (countEl) countEl.textContent = this.layers.length;
		} else {
			if (dimEl) dimEl.textContent = "-- x --";
			if (countEl) countEl.textContent = "0";
		}
	}

	async init() {
		// Initialize sticker manager
		this.stickerManager = new StickerManager(this);
		await this.stickerManager.init();
		await this.glitterManager.init(); // NEW


		this.updateSidePanelUI(null);
	}

	async loadStickerImageData(layer) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = img.naturalWidth;
				canvas.height = img.naturalHeight;
				const ctx = canvas.getContext('2d');
				ctx.drawImage(img, 0, 0);
				resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
			};
			img.onerror = reject;
			img.src = layer.stickerData.url;
		});
	}


	initializeExportSettings() {
		// Set export settings UI to match CONFIG defaults
		const qualitySelect = document.getElementById('exportQuality');
		const ditherEnabledCheckbox = document.getElementById('exportDitherEnabled');
		const ditherTypeSelect = document.getElementById('exportDitherType');
		const ditherTypeRow = document.getElementById('ditherTypeRow');
		const baseImageCheckbox = document.getElementById('exportBaseImage');
		const transparencyCheckbox = document.getElementById('exportTransparency');
		const matteColor = document.getElementById('exportMatteColor');
		const matteColorRow = document.getElementById('matteColorRow');
		const delaySelect = document.getElementById('exportFrameDelay');
		const maxFramesSelect = document.getElementById('exportMaxFrames');

		if (qualitySelect) qualitySelect.value = CONFIG.defaultExportQuality;
		if (ditherEnabledCheckbox) ditherEnabledCheckbox.checked = CONFIG.defaultExportDitherEnabled;
		if (ditherTypeSelect) ditherTypeSelect.value = CONFIG.defaultExportDitherType;
		if (baseImageCheckbox) baseImageCheckbox.checked = CONFIG.defaultExportBaseImage;
		if (transparencyCheckbox) transparencyCheckbox.checked = CONFIG.defaultExportTransparency;
		if (matteColor) matteColor.value = CONFIG.defaultExportMatteColor;
		if (delaySelect) delaySelect.value = CONFIG.defaultExportFrameDelay;
		if (maxFramesSelect) maxFramesSelect.value = CONFIG.defaultExportMaxFrames;

		// Show/hide dither type dropdown based on enabled checkbox
		const updateDitherTypeVisibility = () => {
			if (ditherTypeRow) {
				ditherTypeRow.classList.toggle('disabled', !ditherEnabledCheckbox.checked);
			}
		};

		if (ditherEnabledCheckbox) {
			ditherEnabledCheckbox.addEventListener('change', updateDitherTypeVisibility);
			updateDitherTypeVisibility();
		}

		// Show/hide matte color based on transparency checkbox
		const updateMatteColorVisibility = () => {
			if (matteColorRow && transparencyCheckbox) {
				// Show matte when transparency is disabled
				matteColorRow.classList.toggle('disabled', transparencyCheckbox.checked);
			}
		};

		if (transparencyCheckbox) {
			transparencyCheckbox.addEventListener('change', updateMatteColorVisibility);
		}

		// Initial visibility states
		updateMatteColorVisibility();
	}




	handleCanvasZoomClick(event) {
		if (this.currentTool !== ToolType.ZOOM || !this.originalImage) return;

		if (event.altKey) {
			this.viewport.zoomOut(event.clientX, event.clientY);
		} else {
			this.viewport.zoomIn(event.clientX, event.clientY);
		}
	}

	updateZoomUI() {
		const percentage = this.viewport.getZoomPercentage();
		document.getElementById('zoomPercentage').textContent = `${percentage}%`;
		document.getElementById('statusZoom').textContent = `${percentage}%`;


		document.getElementById('zoomOut').disabled = this.viewport.currentZoomIndex <= 0;
		document.getElementById('zoomIn').disabled = this.viewport.currentZoomIndex >= CONFIG.zoomLevels.length - 1;

		// Update cursor
		this.previewContainer.classList.remove('zoom-cursor', 'hand-cursor');
		if (this.currentTool === ToolType.ZOOM) {
			this.previewContainer.classList.add('zoom-cursor');
		} else if (this.currentTool === ToolType.HAND) {
			this.previewContainer.classList.add('hand-cursor');
		}
	}

	updateTransparencyGrid() {
		if (!this.previewContainer.classList.contains('transparent-bg')) return;

		const baseSize = CONFIG.baseGridSize;
		const size = baseSize * this.viewport.currentZoom;
		const half = size / 2;

		this.previewWrapper.style.backgroundSize = `${size}px ${size}px`;
		this.previewWrapper.style.backgroundPosition =
			`${this.viewport.panX}px ${this.viewport.panY}px, ${this.viewport.panX}px ${this.viewport.panY + half}px, ${this.viewport.panX + half}px ${this.viewport.panY - half}px, ${this.viewport.panX - half}px ${this.viewport.panY}px`;
	}

	// ===== UX: EMPTY STATE MANAGEMENT =====

	showLayerSettingsEmptyState() {
		const empty = document.getElementById('layerSettingsEmpty');
		const controls = document.getElementById('layerSettingsControls');
		if (empty) empty.classList.add('visible');
		if (controls) controls.classList.remove('visible');
	}

	hideLayerSettingsEmptyState() {
		const empty = document.getElementById('layerSettingsEmpty');
		const controls = document.getElementById('layerSettingsControls');
		if (empty) empty.classList.remove('visible');
		if (controls) controls.classList.add('visible');
	}

	showGlitterSettingsEmptyState() {
		const empty = document.getElementById('glitterSettingsEmpty');
		const controls = document.getElementById('glitterSettingsControls');
		if (empty) empty.classList.add('visible');
		if (controls) controls.classList.remove('visible');
	}

	hideGlitterSettingsEmptyState() {
		const empty = document.getElementById('glitterSettingsEmpty');
		const controls = document.getElementById('glitterSettingsControls');
		if (empty) empty.classList.remove('visible');  // ← FIXED
		if (controls) controls.classList.add('visible');
	}

	collapseLayerSettings() {
		const content = document.getElementById('layerSettingsContent');
		const toggle = document.getElementById('layerSettingsToggle');
		if (content) content.classList.remove('visible');
		if (toggle) toggle.classList.add('collapsed');
	}

	collapseGlitterSettings() {
		const content = document.getElementById('glitterSettingsContent');
		const toggle = document.getElementById('glitterSettingsToggle');
		if (content) content.classList.remove('visible');
		if (toggle) toggle.classList.add('collapsed');
	}

	updateGlitterOptionsState() {
		const hasActiveLayer = this.activeLayerId !== null;
		document.querySelectorAll('.glitter-option').forEach(opt => {
			if (hasActiveLayer) {
				opt.classList.remove('disabled');
			} else {
				opt.classList.add('disabled');
			}
		});
	}

	showStickerSettingsEmptyState() {
		const empty = document.getElementById('stickerSettingsEmpty');
		const controls = document.getElementById('stickerSettingsControls');
		if (empty) empty.classList.add('visible');
		if (controls) controls.classList.remove('visible');
	}

	hideStickerSettingsEmptyState() {
		const empty = document.getElementById('stickerSettingsEmpty');
		const controls = document.getElementById('stickerSettingsControls');
		if (empty) empty.classList.remove('visible');
		if (controls) controls.classList.add('visible');
	}

	collapseStickerSettings() {
		const content = document.getElementById('stickerSettingsContent');
		const toggle = document.getElementById('stickerSettingsToggle');
		if (content) content.classList.remove('visible');
		if (toggle) toggle.classList.add('collapsed');
	}

	loadActiveLayerSettings() {
		const layer = this.layerManager.getActiveLayer();
		if (!layer) return;

		// Handle different layer types
		if (layer.type === LayerType.STICKER) {
			// Load sticker settings
			this.loadStickerSettings(layer);
			return;
		}

		// Load glitter layer settings (existing code)
		const s = layer.settings;

		const contiguous = document.getElementById('contiguous');
		const invert = document.getElementById('invert');
		const multiSelect = document.getElementById('multiSelect');
		const threshold = document.getElementById('threshold');
		const thresholdValue = document.getElementById('thresholdValue');
		const feather = document.getElementById('feather');
		const featherValue = document.getElementById('featherValue');
		const scale = document.getElementById('scale');
		const scaleValue = document.getElementById('scaleValue');
		const opacity = document.getElementById('opacity');
		const opacityValue = document.getElementById('opacityValue');

		if (contiguous) contiguous.checked = s.contiguous;
		if (invert) invert.checked = s.invert;
		if (multiSelect) multiSelect.checked = s.multiSelect;

		if (threshold && thresholdValue) {
			threshold.value = s.threshold;
			thresholdValue.textContent = s.threshold;
			this.updateResetButton('threshold');
		}

		if (feather && featherValue) {
			feather.value = s.feather;
			featherValue.textContent = s.feather;
			this.updateResetButton('feather');
		}

		if (scale && scaleValue) {
			scale.value = s.scale;
			scaleValue.textContent = s.scale + '%';
			this.updateResetButton('scale');
		}

		if (opacity && opacityValue) {
			opacity.value = s.opacity;
			opacityValue.textContent = s.opacity + '%';
			this.updateResetButton('opacity');
		}

		this.updateSelectedColorsDisplay();
	}


	loadStickerSettings(layer) {
		if (!layer || layer.type !== LayerType.STICKER) return;

		const transform = layer.stickerData.transform;

		// Position
		const posX = document.getElementById('stickerPosX');
		const posY = document.getElementById('stickerPosY');
		if (posX) posX.value = Math.round(transform.position.x);
		if (posY) posY.value = Math.round(transform.position.y);

		// Rotation
		const rotation = document.getElementById('stickerRotation');
		const rotationValue = document.getElementById('stickerRotationValue');
		if (rotation && rotationValue) {
			rotation.value = transform.rotation;
			rotationValue.textContent = Math.round(transform.rotation) + '°';
		}

		// Scale
		const scaleX = document.getElementById('stickerScaleX');
		const scaleXValue = document.getElementById('stickerScaleXValue');
		const scaleY = document.getElementById('stickerScaleY');
		const scaleYValue = document.getElementById('stickerScaleYValue');
		const proportionalScale = document.getElementById('stickerProportionalScale');

		if (scaleX && scaleXValue) {
			scaleX.value = transform.scale.x;
			scaleXValue.textContent = Math.round(transform.scale.x) + '%';
		}
		if (scaleY && scaleYValue) {
			scaleY.value = transform.scale.y;
			scaleYValue.textContent = Math.round(transform.scale.y) + '%';
		}
		if (proportionalScale) {
			proportionalScale.checked = transform.proportionalScale;
		}

		// Opacity
		const stickerOpacity = document.getElementById('stickerOpacity');
		const stickerOpacityValue = document.getElementById('stickerOpacityValue');
		if (stickerOpacity && stickerOpacityValue) {
			stickerOpacity.value = transform.opacity;
			stickerOpacityValue.textContent = Math.round(transform.opacity) + '%';
		}

		// Flip
		const flipX = document.getElementById('stickerFlipX');
		const flipY = document.getElementById('stickerFlipY');
		if (flipX) flipX.checked = transform.flipX;
		if (flipY) flipY.checked = transform.flipY;
	}



	saveActiveLayerSettings(refineOnly = false, glitterOnly = false) {
		const settings = {
			threshold: parseInt(document.getElementById('threshold').value),
			feather: parseInt(document.getElementById('feather').value),
			scale: parseInt(document.getElementById('scale').value),
			opacity: parseInt(document.getElementById('opacity').value),
			contiguous: document.getElementById('contiguous').checked,
			invert: document.getElementById('invert').checked,
			multiSelect: document.getElementById('multiSelect').checked
		};

		const activeLayer = this.layerManager.getActiveLayer();
		// Only apply to active layer if it is a Glitter Fill layer
		if (activeLayer && activeLayer.type === LayerType.GLITTER_FILL) {
			activeLayer.settings = settings;
		}

		// Handle Global Refine (Threshold/Feather)
		if (this.refineGlobal && refineOnly) {
			this.layers.forEach(layer => {
				// FIX: Only apply to Glitter Fill layers
				if (layer.type === LayerType.GLITTER_FILL && layer.settings) {
					layer.settings.threshold = settings.threshold;
					layer.settings.feather = settings.feather;
				}
			});
		}

		// Handle Global Glitter (Scale/Opacity)
		if (this.glitterGlobal && glitterOnly) {
			this.layers.forEach(layer => {
				// FIX: Only apply to Glitter Fill layers
				if (layer.type === LayerType.GLITTER_FILL && layer.settings) {
					layer.settings.scale = settings.scale;
					layer.settings.opacity = settings.opacity;
				}
			});
		}
	}

	updateGlitterSelection() {
		const layer = this.layerManager.getActiveLayer();

		document.querySelectorAll('.glitter-option').forEach((opt) => {
			// If layer exists, check index. If no layer (null), always false.
			const isSelected = layer ? parseInt(opt.dataset.index) === layer.selectedGlitterIndex : false;
			opt.classList.toggle('selected', isSelected);
		});
	}

	updateStickerSelection() {
		const layer = this.layerManager.getActiveLayer();

		// Early return if no sticker layer is active
		if (!layer || layer.type !== LayerType.STICKER || !layer.stickerSourceId) {
			// Just clear all selections if no valid sticker layer
			document.querySelectorAll('.sticker-option').forEach((opt) => {
				opt.classList.remove('selected');
			});
			return;
		}

		// Now we know we have a valid sticker layer with a source ID
		document.querySelectorAll('.sticker-option').forEach((opt) => {

			const isSelected = layer ? parseInt(opt.dataset.stickerId) === layer.stickerSourceId : false;

			if (isSelected) {
				opt.classList.add('selected');
			} else {
				opt.classList.remove('selected');
			}
		});
	}

	// ===== INITIALIZATION =====
	initializeCollapsibleSections() {

		// ===== LAYER SETTINGS =====
		const layerSettingsHeader = document.getElementById('layerSettingsHeader');
		const layerSettingsContent = document.getElementById('layerSettingsContent');
		const layerSettingsToggle = document.getElementById('layerSettingsToggle');

		// Start collapsed with empty state showing
		layerSettingsToggle.classList.add('collapsed');
		this.showLayerSettingsEmptyState();

		layerSettingsHeader.addEventListener('click', () => {
			const isOpen = layerSettingsContent.classList.toggle('visible');
			layerSettingsToggle.classList.toggle('collapsed', !isOpen);
		});


		// ===== GLITTER SETTINGS =====
		const glitterSettingsHeader = document.getElementById('glitterSettingsHeader');
		const glitterSettingsContent = document.getElementById('glitterSettingsContent');
		const glitterSettingsToggle = document.getElementById('glitterSettingsToggle');

		// Start collapsed with empty state showing
		glitterSettingsToggle.classList.add('collapsed');
		this.showGlitterSettingsEmptyState();

		glitterSettingsHeader.addEventListener('click', () => {
			const isOpen = glitterSettingsContent.classList.toggle('visible');
			glitterSettingsToggle.classList.toggle('collapsed', !isOpen);
		});

		// ===== STICKER SETTINGS =====
		const stickerSettingsHeader = document.getElementById('stickerSettingsHeader');
		const stickerSettingsContent = document.getElementById('stickerSettingsContent');
		const stickerSettingsToggle = document.getElementById('stickerSettingsToggle');

		// Start collapsed with empty state showing
		stickerSettingsToggle.classList.add('collapsed');
		this.showStickerSettingsEmptyState();

		stickerSettingsHeader.addEventListener('click', () => {
			const isOpen = stickerSettingsContent.classList.toggle('visible');
			stickerSettingsToggle.classList.toggle('collapsed', !isOpen);
		});
	}

	initializeShortcutsModal() {
		// Shortcuts Modal
		const shortcutsModal = document.getElementById('shortcutsModal');
		const shortcutsBtn = document.getElementById('shortcutsBtn');
		const closeShortcuts = document.getElementById('closeShortcutsModal');
		const list = document.getElementById('shortcutList');

		Object.entries(CONFIG.shortcuts).forEach(([category, shortcutArray]) => {
			const group = document.createElement('div');
			group.className = 'shortcut-group';

			const title = document.createElement('div');
			title.className = 'shortcut-group-title';
			title.textContent = category.charAt(0).toUpperCase() + category.slice(1);
			group.appendChild(title);

			shortcutArray.forEach(sc => {
				const item = document.createElement('div');
				item.className = 'shortcut-item';

				const action = document.createElement('div');
				action.className = 'shortcut-action';
				action.textContent = sc.action;

				const keys = document.createElement('div');
				keys.className = 'shortcut-keys';

				sc.key.split(' + ').forEach(k => {
					const el = document.createElement('span');
					el.className = 'kbd';
					el.textContent = k;
					keys.appendChild(el);
				});

				item.appendChild(action);
				item.appendChild(keys);
				group.appendChild(item);
			});

			list.appendChild(group);
		});


		// Settings Modal
		const settingsModal = document.getElementById('settingsModal');
		const settingsBtn = document.getElementById('settingsBtn');
		const closeSettings = document.getElementById('closeSettingsModal');

		// About Modal
		const aboutModal = document.getElementById('aboutModal');
		const aboutBtn = document.getElementById('aboutBtn');
		const closeAbout = document.getElementById('closeAboutModal');

		// Layer Type Picker Modal Events
		const layerTypePickerModal = document.getElementById('layerTypePickerModal');
		const closeLayerTypePicker = document.getElementById('closeLayerTypePickerModal');

		// Function to close all modals
		const closeAllModals = () => {
			shortcutsModal.classList.remove('visible');
			aboutModal.classList.remove('visible');
			settingsModal.classList.remove('visible');
			layerTypePickerModal.classList.remove('visible');

		};

		// Shortcuts Modal Events
		shortcutsBtn.addEventListener('click', () => {
			closeAllModals();
			shortcutsModal.classList.add('visible');
		});

		closeShortcuts.addEventListener('click', () => {
			shortcutsModal.classList.remove('visible');
		});

		shortcutsModal.addEventListener('click', (e) => {
			if (e.target === shortcutsModal) {
				shortcutsModal.classList.remove('visible');
			}
		});

		// Settings Modal Events
		settingsBtn.addEventListener('click', () => {
			closeAllModals();
			settingsModal.classList.add('visible');
		});

		closeSettings.addEventListener('click', () => {
			settingsModal.classList.remove('visible');
		});

		settingsModal.addEventListener('click', (e) => {
			if (e.target === settingsModal) {
				settingsModal.classList.remove('visible');
			}
		});

		// About Modal Events
		aboutBtn.addEventListener('click', () => {
			closeAllModals();
			aboutModal.classList.add('visible');
		});

		closeAbout.addEventListener('click', () => {
			aboutModal.classList.remove('visible');
		});

		aboutModal.addEventListener('click', (e) => {
			if (e.target === aboutModal) {
				aboutModal.classList.remove('visible');
			}
		});


		// Layer Type Picker Modal


		const layerTypeButtons = document.querySelectorAll('.layer-type-option');
		const layerModal = document.getElementById('layerTypePickerModal');

		layerTypeButtons.forEach(btn => {
			btn.addEventListener('click', () => {
				// 1. Get the type from your HTML data attribute
				const type = btn.dataset.layerType; // returns "glitter-fill" or "sticker"

				// 2. Map string to LayerType constant
				let layerType;
				if (type === 'sticker') {
					layerType = LayerType.STICKER;
				} else {
					layerType = LayerType.GLITTER_FILL;
				}

				// 3. Add the layer
				this.layerManager.addLayer(layerType);

				// 4. Close the modal
				if (layerModal) layerModal.classList.remove('visible');
			});
		});

		// --- LAYER ACTIONS ---
		const addLayerBtn = document.getElementById('addLayerBtn');
		if (addLayerBtn) {
			addLayerBtn.addEventListener('click', () => {
				// Don't add layer yet. Just open the modal.
				const modal = document.getElementById('layerTypePickerModal');
				if (modal) modal.classList.add('visible');
			});
		}

		// Don't forget the mobile button if you have one!
		const mobileAddBtn = document.getElementById('mobileAddLayerBtn');
		if (mobileAddBtn) {
			mobileAddBtn.addEventListener('click', () => {
				const modal = document.getElementById('layerTypePickerModal');
				if (modal) modal.classList.add('visible');
			});
		}


		closeLayerTypePicker.addEventListener('click', () => {
			layerTypePickerModal.classList.remove('visible');
		});

		layerTypePickerModal.addEventListener('click', (e) => {
			if (e.target === layerTypePickerModal) {
				layerTypePickerModal.classList.remove('visible');
			}
		});
	}

	setupEventListeners() {
		// --- TOOLBAR BUTTONS ---
		const selectTool = document.getElementById('selectTool');
		const colorPickerTool = document.getElementById('colorPickerTool');
		const handTool = document.getElementById('handTool');
		const zoomTool = document.getElementById('zoomTool');
		const undoTool = document.getElementById('undoTool');
		const redoTool = document.getElementById('redoTool');
		const clearAllTool = document.getElementById('clearAllTool');

		if (selectTool) selectTool.addEventListener('click', () => this.setTool(ToolType.SELECT));
		if (colorPickerTool) colorPickerTool.addEventListener('click', () => this.setTool(ToolType.COLOR_PICKER));
		if (handTool) handTool.addEventListener('click', () => this.setTool(ToolType.HAND));
		if (zoomTool) zoomTool.addEventListener('click', () => this.setTool(ToolType.ZOOM));
		if (undoTool) undoTool.addEventListener('click', () => this.undo());
		if (redoTool) redoTool.addEventListener('click', () => this.redo());
		if (clearAllTool) clearAllTool.addEventListener('click', () => this.resetAll());

		// --- ZOOM CONTROLS ---
		const zoomIn = document.getElementById('zoomIn');
		const zoomOut = document.getElementById('zoomOut');
		const zoomPercentage = document.getElementById('zoomPercentage');
		const fitScreen = document.getElementById('fitScreen');
		const fillScreen = document.getElementById('fillScreen');

		if (zoomIn) zoomIn.addEventListener('click', () => this.viewport.zoomIn());
		if (zoomOut) zoomOut.addEventListener('click', () => this.viewport.zoomOut());
		if (zoomPercentage) zoomPercentage.addEventListener('click', () => this.viewport.resetZoom());
		if (fitScreen) fitScreen.addEventListener('click', () => this.viewport.zoomToFit());
		if (fillScreen) fillScreen.addEventListener('click', () => this.viewport.zoomToFill());

		// --- PAN CONTROLS ---
		const centerHorizontal = document.getElementById('centerHorizontal');
		const centerVertical = document.getElementById('centerVertical');

		if (centerHorizontal) centerHorizontal.addEventListener('click', () => this.viewport.centerHorizontal());
		if (centerVertical) centerVertical.addEventListener('click', () => this.viewport.centerVertical());


		// --- STICKER CENTER CONTROLS ---
		const centerStickerHorizontal = document.getElementById('centerStickerHorizontal');
		const centerStickerVertical = document.getElementById('centerStickerVertical');

		if (centerStickerHorizontal) centerStickerHorizontal.addEventListener('click', () => {
			const layer = this.layerManager.getActiveLayer();
			if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
				this.stickerManager.centerStickerHorizontal(layer.id);
			}
		});

		if (centerStickerVertical) centerStickerVertical.addEventListener('click', () => {
			const layer = this.layerManager.getActiveLayer();
			if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
				this.stickerManager.centerStickerVertical(layer.id);
			}
		});



		// --- SCROLL ZOOM ---
		this.previewContainer.addEventListener('wheel', (e) => {
			if (this.currentTool === ToolType.ZOOM && this.originalImage) {
				e.preventDefault();
				if (e.deltaY < 0) {
					this.viewport.zoomIn();
				} else {
					this.viewport.zoomOut();
				}
			}
		}, { passive: false });

		// --- PAN HANDLERS ---
		this.previewContainer.addEventListener('mousedown', (e) => {
			if (this.currentTool === ToolType.HAND || e.code === 'Space') {
				e.preventDefault();
				this.viewport.startPan(e.clientX, e.clientY);
			}
		});

		// --- DISABLE RIGHT CLICK ON PREVIEW ---
		this.previewContainer.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			return false;
		});



		// --- IMAGE HANDLING ---
		const imageClearBtn = document.getElementById('imageClearBtn');
		if (imageClearBtn) imageClearBtn.addEventListener('click', () => this.clearImage());

		const dropzone = document.getElementById('imageDropzone');
		const fileInput = document.getElementById('imageUpload');

		if (dropzone && fileInput) {
			dropzone.addEventListener('click', () => fileInput.click());
			fileInput.addEventListener('change', (e) => this.loadImage(e));

			dropzone.addEventListener('dragover', (e) => {
				e.preventDefault();
				dropzone.classList.add('drag-over');
			});

			dropzone.addEventListener('dragleave', () => {
				dropzone.classList.remove('drag-over');
			});

			dropzone.addEventListener('drop', (e) => {
				e.preventDefault();
				dropzone.classList.remove('drag-over');
				if (e.dataTransfer.files.length > 0) {
					fileInput.files = e.dataTransfer.files;
					this.loadImage({ target: fileInput });
				}
			});
		}

		// --- CANVAS INTERACTION ---
		this.previewWrapper.addEventListener('click', (e) => {
			if (this.currentTool === ToolType.COLOR_PICKER || this.currentTool === ToolType.SELECT) {
				this.handleCanvasClick(e);
			} else if (this.currentTool === ToolType.ZOOM) {
				this.handleCanvasZoomClick(e);
			}
		});

		// ============================================================
		// DESELECT WHEN CLICKING OUTSIDE CANVAS
		// ============================================================
		this.previewContainer.addEventListener('mousedown', (e) => {
			// Check if we are clicking the grey background (container) directly
			// or the wrapper (if it has padding/margins that aren't the canvas)
			if (e.target === this.previewContainer || e.target === this.previewWrapper) {
				// Ensure we aren't panning with the Hand tool (optional, based on preference)
				if (this.currentTool === ToolType.SELECT) {
					this.layerManager.setActiveLayer(null);
				}
			}
		});

		// --- LAYER SETTINGS CONTROLS ---
		const contiguous = document.getElementById('contiguous');
		const invert = document.getElementById('invert');
		const multiSelect = document.getElementById('multiSelect');
		const refineGlobal = document.getElementById('refineGlobal');
		const glitterGlobal = document.getElementById('glitterGlobal');


		if (contiguous) {
			contiguous.addEventListener('change', () => {
				this.saveActiveLayerSettings();
				this.updatePreview();
				this.saveState();
			});
		}

		if (invert) {
			invert.addEventListener('change', () => {
				this.saveActiveLayerSettings();
				this.updatePreview();
				this.saveState();
			});
		}

		if (multiSelect) {
			multiSelect.addEventListener('change', (e) => {
				// If multi-select is disabled, clear all selections except the first
				const layer = this.layerManager.getActiveLayer();
				if (!e.target.checked && layer && layer.selections.length > 1) {
					layer.selections = [layer.selections[0]];
				}
				this.saveActiveLayerSettings();
				this.updatePreview();
				this.updateSelectedColorsDisplay();
				this.saveState();
			});
		}

		if (refineGlobal) {
			refineGlobal.addEventListener('change', (e) => {
				this.refineGlobal = e.target.checked;
				if (this.refineGlobal) {
					// Force sync current input values to all glitter layers
					this.saveActiveLayerSettings(true, false);
					this.updatePreview();
					this.saveState();
					this.updateStatus('Global threshold/feather applied');
				}
			});
		}

		if (glitterGlobal) {
			glitterGlobal.addEventListener('change', (e) => {
				this.glitterGlobal = e.target.checked;
				if (this.glitterGlobal) {
					// Force sync current input values to all glitter layers
					this.saveActiveLayerSettings(false, true);
					this.updatePreview();
					this.saveState();
					this.updateStatus('Global scale/opacity applied');
				}
			});
		}

		// --- THRESHOLD SLIDER ---
		const thresholdSlider = document.getElementById('threshold');
		if (thresholdSlider) {
			thresholdSlider.addEventListener('input', () => {
				this.saveActiveLayerSettings(true, false);
				this.debouncedSliderUpdate('threshold');
			});
			thresholdSlider.addEventListener('change', () => this.saveState());
		}

		// --- FEATHER SLIDER ---
		const featherSlider = document.getElementById('feather');
		if (featherSlider) {
			featherSlider.addEventListener('input', () => {
				this.saveActiveLayerSettings(true, false);
				this.debouncedSliderUpdate('feather');
			});
			featherSlider.addEventListener('change', () => this.saveState());
		}

		// --- SCALE SLIDER ---
		const scaleSlider = document.getElementById('scale');
		if (scaleSlider) {
			scaleSlider.addEventListener('input', () => {
				this.saveActiveLayerSettings(false, true);
				this.debouncedSliderUpdate('scale');
			});
			scaleSlider.addEventListener('change', () => this.saveState());
		}

		// --- OPACITY SLIDER ---
		const opacitySlider = document.getElementById('opacity');
		if (opacitySlider) {
			opacitySlider.addEventListener('input', () => {
				this.saveActiveLayerSettings(false, true);
				this.debouncedSliderUpdate('opacity');
			});
			opacitySlider.addEventListener('change', () => this.saveState());
		}

		// --- PREVIEW MODE TOGGLE ---
		const previewModeToggle = document.getElementById('previewModeToggle');
		if (previewModeToggle) {
			previewModeToggle.addEventListener('click', () => {
				this.showAllLayers = !this.showAllLayers;
				const btn = previewModeToggle;

				btn.classList.toggle('active', !this.showAllLayers);
				btn.title = this.showAllLayers ? 'Show only active layer' : 'Show all layers';
				this.updatePreview();
			});
		}

		// -- BOUNDS TOGGLES ---
		const boundsToggle = document.getElementById('boundsToggle');
		if (boundsToggle) {
			boundsToggle.addEventListener('click', () => {
				const toggle = boundsToggle;
				const isActive = toggle.classList.toggle('active');
				this.previewContainer.classList.toggle('bounds', isActive);
			});
		}

		// --- TRANSPARENCY TOGGLE ---
		const transparencyToggle = document.getElementById('transparencyToggle');
		if (transparencyToggle) {
			transparencyToggle.addEventListener('click', () => {
				const toggle = transparencyToggle;
				const isActive = toggle.classList.toggle('active');
				this.previewContainer.classList.toggle('transparent-bg', isActive);

				if (isActive) {
					this.updateTransparencyGrid();
				} else {
					this.previewContainer.style.backgroundSize = '';
					this.previewContainer.style.backgroundPosition = '';
				}

				this.previewContainer.offsetHeight;
				this.previewContainer.style.transition = '';
			});

			// --- STICKER SETTINGS CONTROLS ---

			// Rotation
			const stickerRotation = document.getElementById('stickerRotation');
			const stickerRotationValue = document.getElementById('stickerRotationValue');
			if (stickerRotation && stickerRotationValue) {
				stickerRotation.addEventListener('input', (e) => {
					const value = parseFloat(e.target.value);
					stickerRotationValue.textContent = Math.round(value) + '°';

					const layer = this.layerManager.getActiveLayer();
					if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
						this.stickerManager.updateStickerTransform(layer.id, {
							rotation: value
						});
					}
				});

				stickerRotation.addEventListener('change', () => this.saveState());
			}

			const resetStickerRotation = document.getElementById('resetStickerRotation');
			if (resetStickerRotation) {
				resetStickerRotation.addEventListener('click', () => {
					if (stickerRotation) stickerRotation.value = CONFIG.defaultStickerRotation;
					if (stickerRotationValue) stickerRotationValue.textContent = CONFIG.defaultStickerRotation + '°';

					const layer = this.layerManager.getActiveLayer();
					if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
						this.stickerManager.updateStickerTransform(layer.id, {
							rotation: CONFIG.defaultStickerRotation
						});
						this.saveState();
					}
				});
			}

			// REPLACE the Scale X and Scale Y event listeners in setupEventListeners()

			// Scale X
			const stickerScaleX = document.getElementById('stickerScaleX');
			const stickerScaleXValue = document.getElementById('stickerScaleXValue');
			const stickerScaleY = document.getElementById('stickerScaleY');
			const stickerScaleYValue = document.getElementById('stickerScaleYValue');

			if (stickerScaleX && stickerScaleXValue) {
				stickerScaleX.addEventListener('input', (e) => {
					const value = parseFloat(e.target.value);
					stickerScaleXValue.textContent = Math.round(value) + '%';

					const layer = this.layerManager.getActiveLayer();
					if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
						// Check if proportional scale is enabled
						const proportionalScale = document.getElementById('stickerProportionalScale');

						if (proportionalScale && proportionalScale.checked) {
							// Update both X and Y together
							if (stickerScaleY && stickerScaleYValue) {
								stickerScaleY.value = value;
								stickerScaleYValue.textContent = Math.round(value) + '%';
							}

							this.stickerManager.updateStickerTransform(layer.id, {
								scale: { x: value, y: value }
							});
						} else {
							// Update only X
							this.stickerManager.updateStickerTransform(layer.id, {
								scale: { x: value }
							});
						}
					}
				});

				stickerScaleX.addEventListener('change', () => this.saveState());
			}

			// Scale Y
			if (stickerScaleY && stickerScaleYValue) {
				stickerScaleY.addEventListener('input', (e) => {
					const value = parseFloat(e.target.value);
					stickerScaleYValue.textContent = Math.round(value) + '%';

					const layer = this.layerManager.getActiveLayer();
					if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
						// Check if proportional scale is enabled
						const proportionalScale = document.getElementById('stickerProportionalScale');

						if (proportionalScale && proportionalScale.checked) {
							// Update both X and Y together
							if (stickerScaleX && stickerScaleXValue) {
								stickerScaleX.value = value;
								stickerScaleXValue.textContent = Math.round(value) + '%';
							}

							this.stickerManager.updateStickerTransform(layer.id, {
								scale: { x: value, y: value }
							});
						} else {
							// Update only Y
							this.stickerManager.updateStickerTransform(layer.id, {
								scale: { y: value }
							});
						}
					}
				});

				stickerScaleY.addEventListener('change', () => this.saveState());
			}

			// Reset Scale X
			const resetStickerScaleX = document.getElementById('resetStickerScaleX');
			if (resetStickerScaleX) {
				resetStickerScaleX.addEventListener('click', () => {
					const proportionalScale = document.getElementById('stickerProportionalScale');

					if (stickerScaleX) stickerScaleX.value = CONFIG.defaultStickerScale.x;
					if (stickerScaleXValue) stickerScaleXValue.textContent = CONFIG.defaultStickerScale.x + '%';

					const layer = this.layerManager.getActiveLayer();
					if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
						if (proportionalScale && proportionalScale.checked) {
							// Reset both when proportional
							if (stickerScaleY) stickerScaleY.value = CONFIG.defaultStickerScale.x;
							if (stickerScaleYValue) stickerScaleYValue.textContent = CONFIG.defaultStickerScale.x + '%';

							this.stickerManager.updateStickerTransform(layer.id, {
								scale: { x: CONFIG.defaultStickerScale.x, y: CONFIG.defaultStickerScale.x }
							});
						} else {
							// Reset only X
							this.stickerManager.updateStickerTransform(layer.id, {
								scale: { x: CONFIG.defaultStickerScale.x }
							});
						}
						this.saveState();
					}
				});
			}

			// Reset Scale Y
			const resetStickerScaleY = document.getElementById('resetStickerScaleY');
			if (resetStickerScaleY) {
				resetStickerScaleY.addEventListener('click', () => {
					const proportionalScale = document.getElementById('stickerProportionalScale');

					if (stickerScaleY) stickerScaleY.value = CONFIG.defaultStickerScale.y;
					if (stickerScaleYValue) stickerScaleYValue.textContent = CONFIG.defaultStickerScale.y + '%';

					const layer = this.layerManager.getActiveLayer();
					if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
						if (proportionalScale && proportionalScale.checked) {
							// Reset both when proportional
							if (stickerScaleX) stickerScaleX.value = CONFIG.defaultStickerScale.y;
							if (stickerScaleXValue) stickerScaleXValue.textContent = CONFIG.defaultStickerScale.y + '%';

							this.stickerManager.updateStickerTransform(layer.id, {
								scale: { x: CONFIG.defaultStickerScale.y, y: CONFIG.defaultStickerScale.y }
							});
						} else {
							// Reset only Y
							this.stickerManager.updateStickerTransform(layer.id, {
								scale: { y: CONFIG.defaultStickerScale.y }
							});
						}
						this.saveState();
					}
				});
			}

			// Proportional Scale (keep existing logic)
			const stickerProportionalScale = document.getElementById('stickerProportionalScale');
			if (stickerProportionalScale) {
				stickerProportionalScale.addEventListener('change', (e) => {
					const layer = this.layerManager.getActiveLayer();
					if (layer && layer.type === LayerType.STICKER) {
						layer.stickerData.transform.proportionalScale = e.target.checked;

						// If enabling proportional, sync Y to X
						if (e.target.checked && stickerScaleX && stickerScaleY) {
							stickerScaleY.value = stickerScaleX.value;
							if (stickerScaleYValue) {
								stickerScaleYValue.textContent = stickerScaleX.value + '%';
							}

							if (this.stickerManager) {
								this.stickerManager.updateStickerTransform(layer.id, {
									scale: {
										x: parseFloat(stickerScaleX.value),
										y: parseFloat(stickerScaleX.value)
									}
								});
							}
						}

						this.saveState();
					}
				});
			}

			// Opacity
			const stickerOpacity = document.getElementById('stickerOpacity');
			const stickerOpacityValue = document.getElementById('stickerOpacityValue');
			if (stickerOpacity && stickerOpacityValue) {
				stickerOpacity.addEventListener('input', (e) => {
					const value = parseFloat(e.target.value);
					stickerOpacityValue.textContent = Math.round(value) + '%';

					const layer = this.layerManager.getActiveLayer();
					if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
						this.stickerManager.updateStickerTransform(layer.id, {
							opacity: value
						});
					}
				});

				stickerOpacity.addEventListener('change', () => this.saveState());
			}

			const resetStickerOpacity = document.getElementById('resetStickerOpacity');
			if (resetStickerOpacity) {
				resetStickerOpacity.addEventListener('click', () => {
					if (stickerOpacity) stickerOpacity.value = CONFIG.defaultStickerOpacity;
					if (stickerOpacityValue) stickerOpacityValue.textContent = CONFIG.defaultStickerOpacity + '%';

					const layer = this.layerManager.getActiveLayer();
					if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
						this.stickerManager.updateStickerTransform(layer.id, {
							opacity: CONFIG.defaultStickerOpacity
						});
						this.saveState();
					}
				});
			}

			// Flip X
			const stickerFlipX = document.getElementById('stickerFlipX');
			if (stickerFlipX) {
				stickerFlipX.addEventListener('change', (e) => {
					const layer = this.layerManager.getActiveLayer();
					if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
						this.stickerManager.updateStickerTransform(layer.id, {
							flipX: e.target.checked
						});
						this.saveState();
					}
				});
			}

			// Flip Y
			const stickerFlipY = document.getElementById('stickerFlipY');
			if (stickerFlipY) {
				stickerFlipY.addEventListener('change', (e) => {
					const layer = this.layerManager.getActiveLayer();
					if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
						this.stickerManager.updateStickerTransform(layer.id, {
							flipY: e.target.checked
						});
						this.saveState();
					}
				});
			}

			// Sticker Settings Toggle (collapsible)
			const stickerSettingsToggle = document.getElementById('stickerSettingsToggle');
			const stickerSettingsContent = document.getElementById('stickerSettingsContent');
			if (stickerSettingsToggle && stickerSettingsContent) {
				stickerSettingsToggle.addEventListener('click', () => {
					const isCollapsed = stickerSettingsToggle.classList.toggle('collapsed');
					stickerSettingsContent.classList.toggle('visible', !isCollapsed);
				});
			}
		}

		// --- EXPORT & GLOBAL ---
		const exportGif = document.getElementById('exportGif');
		if (exportGif) exportGif.addEventListener('click', () => this.exportAnimatedGif());

		// --- EXPORT SETTINGS ---
		const exportQuality = document.getElementById('exportQuality');
		const exportDitherEnabled = document.getElementById('exportDitherEnabled');
		const exportDitherType = document.getElementById('exportDitherType');
		const exportBaseImage = document.getElementById('exportBaseImage');
		const exportTransparency = document.getElementById('exportTransparency');
		const exportMatteColor = document.getElementById('exportMatteColor');
		const exportFrameDelay = document.getElementById('exportFrameDelay');
		const exportMaxFrames = document.getElementById('exportMaxFrames');

		if (exportQuality) {
			exportQuality.addEventListener('change', (e) => {
				this.exportSettings.quality = parseInt(e.target.value);
			});
		}

		if (exportDitherEnabled) {
			exportDitherEnabled.addEventListener('change', (e) => {
				this.exportSettings.ditherEnabled = e.target.checked;
			});
		}

		if (exportDitherType) {
			exportDitherType.addEventListener('change', (e) => {
				this.exportSettings.ditherType = e.target.value;
			});
		}

		if (exportBaseImage) {
			exportBaseImage.addEventListener('change', (e) => {
				this.exportSettings.baseImage = e.target.checked;
			});
		}

		if (exportTransparency) {
			exportTransparency.addEventListener('change', (e) => {
				this.exportSettings.transparency = e.target.checked;
			});
		}

		if (exportMatteColor) {
			exportMatteColor.addEventListener('change', (e) => {
				this.exportSettings.matteColor = e.target.value;
			});
		}

		if (exportFrameDelay) {
			exportFrameDelay.addEventListener('change', (e) => {
				this.exportSettings.frameDelay = parseInt(e.target.value);
			});
		}

		if (exportMaxFrames) {
			exportMaxFrames.addEventListener('change', (e) => {
				this.exportSettings.maxFrames = parseInt(e.target.value);
			});
		}

		// --- EXPORT PROGRESS CANCEL ---
		const exportProgressCancel = document.getElementById('exportProgressCancel');
		if (exportProgressCancel) {
			exportProgressCancel.addEventListener('click', () => {
				this.exportCancelled = true;
				this.hideExportProgress();
				this.updateStatus('Export cancelled');
				const exportBtn = document.getElementById('exportGif');
				if (exportBtn) exportBtn.disabled = false;
			});
		}

		// --- ERROR TOAST ---
		const errorClose = document.getElementById('errorClose');
		if (errorClose) errorClose.addEventListener('click', () => this.hideError());

		// --- KEYBOARD EVENTS ---
		document.addEventListener('keydown', (e) => this.handleKeyboard(e));
		document.addEventListener('keyup', (e) => this.handleKeyUp(e));

		// --- VIEWPORT CHANGES ---
		window.addEventListener('viewportChanged', (e) => {
			this.updateZoomUI();
			this.updateTransparencyGrid();
			this.updateStatusBar();
		});
	}

	setupSliderDisplay(sliderId, displayId, suffix) {
		document.getElementById(sliderId).addEventListener('input', (e) => {
			document.getElementById(displayId).textContent = e.target.value + suffix;
			this.updateResetButton(sliderId);
		});
	}

	setupResetButton(sliderId, defaultValue) {
		const resetBtnId = 'reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1);
		const resetBtn = document.getElementById(resetBtnId);

		resetBtn.addEventListener('click', () => {
			const slider = document.getElementById(sliderId);
			slider.value = defaultValue;
			slider.dispatchEvent(new Event('input'));
			slider.dispatchEvent(new Event('change'));

			if (sliderId === 'feather') {
				this.saveActiveLayerSettings(true, false);
				this.updatePreview();
			} else if (sliderId === 'threshold') {
				this.saveActiveLayerSettings(true, false);
			} else if (sliderId === 'scale' || sliderId === 'opacity') {
				this.saveActiveLayerSettings(false, true);
			}
		});

		this.updateResetButton(sliderId);
	}

	updateResetButton(sliderId) {
		const resetBtn = document.getElementById('reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1));
		const slider = document.getElementById(sliderId);
		const defaultValue = CONFIG['default' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1)];
		if (resetBtn) {
			resetBtn.disabled = parseInt(slider.value) === defaultValue;
		}
	}


	setTool(tool) {
		this.currentTool = tool;

		// 1. Update Toolbar Buttons
		document.querySelectorAll('.toolbar-group button').forEach(btn => {
			btn.classList.remove('active');
		});

		const activeBtn = document.getElementById(`${tool}Tool`);
		if (activeBtn) activeBtn.classList.add('active');

		// 2. Update Cursors
		if (this.previewContainer) {
			this.previewContainer.classList.remove('zoom-cursor', 'hand-cursor', 'zoom-out-mode');
			if (tool === ToolType.ZOOM) {
				this.previewContainer.classList.add('zoom-cursor');
			} else if (tool === ToolType.HAND) {
				this.previewContainer.classList.add('hand-cursor');
			}
		}

		if (this.previewWrapper) {
			this.previewWrapper.classList.remove('color-picker-mode');
			if (tool === ToolType.COLOR_PICKER) {
				this.previewWrapper.classList.add('color-picker-mode');
			}
		}

		// 3. Update Floating Controls (Zoom / Pan / Sticker Center)
		const zoomControls = document.getElementById('zoomControls');
		const panControls = document.getElementById('panControls');
		const stickerCenterControls = document.getElementById('stickerCenterControls');

		// First, hide everything
		if (zoomControls) zoomControls.classList.remove('visible');
		if (panControls) panControls.classList.remove('visible');
		if (stickerCenterControls) stickerCenterControls.classList.remove('visible');

		// Then show only what is needed
		if (tool === ToolType.ZOOM && zoomControls) {
			zoomControls.classList.add('visible');
		} else if (tool === ToolType.HAND && panControls) {
			panControls.classList.add('visible');
		} else if (tool === ToolType.SELECT && stickerCenterControls) {
			// Show sticker center controls only if active layer is a sticker
			const layer = this.layerManager.getActiveLayer();
			if (layer && layer.type === LayerType.STICKER) {
				stickerCenterControls.classList.add('visible');
			}
		}

	}

	handleKeyUp(e) {
		if (e.key === 'Alt') {
			if (this.currentTool === ToolType.ZOOM) {
				this.previewContainer.classList.remove('zoom-out-mode');
			}
		}
	}

	handleKeyboard(e) {
		if (e.key === 'Alt' && this.currentTool === ToolType.ZOOM) {
			this.previewContainer.classList.add('zoom-out-mode');
		}

		if (e.key === 'Escape') {
			// Check if any modal is open
			const shortcutsModal = document.getElementById('shortcutsModal');
			const aboutModal = document.getElementById('aboutModal');
			const settingsModal = document.getElementById('settingsModal');
			const layerTypePickerModal = document.getElementById('layerTypePickerModal');





			if (settingsModal.classList.contains('visible')) {
				settingsModal.classList.remove('visible');
				return;
			}

			if (shortcutsModal.classList.contains('visible')) {
				shortcutsModal.classList.remove('visible');
				return;
			}

			if (aboutModal.classList.contains('visible')) {
				aboutModal.classList.remove('visible');
				return;
			}

			if (layerTypePickerModal.classList.contains('visible')) {
				layerTypePickerModal.classList.remove('visible');
				return;
			}

			// If no modal open, switch to select tool
			this.setTool(ToolType.SELECT);
		}


		if (e.key === 'v' || e.key === 'V') this.setTool(ToolType.SELECT);
		if (e.key === 'i' || e.key === 'I') {
			if (this.originalImage) this.setTool(ToolType.COLOR_PICKER);
		}
		if (e.key === 'h' || e.key === 'H') {
			if (this.originalImage) this.setTool(ToolType.HAND);
		}
		if (e.key === 'z' || e.key === 'Z') {
			if (!e.ctrlKey && !e.metaKey && this.originalImage) this.setTool(ToolType.ZOOM);
		}

		if (this.originalImage) {
			if ((e.ctrlKey || e.metaKey) && e.key === '0') {
				e.preventDefault();
				this.zoomToFit();
			}
			if ((e.ctrlKey || e.metaKey) && e.key === '1') {
				e.preventDefault();
				this.resetZoom();
			}
			if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
				e.preventDefault();
				this.zoomIn();
			}
			if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
				e.preventDefault();
				this.zoomOut();
			}
		}

		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			this.undo();
		}

		if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
			e.preventDefault();
			this.redo();
		}
	}

	// ===== HISTORY =====

	saveState() {
		const state = {
			layers: this.layers.map(layer => {
				// 1. STICKER LAYERS
				if (layer.type === LayerType.STICKER && this.stickerManager) {
					return this.stickerManager.serializeSticker(layer);
				}

				// 2. BASE IMAGE LAYERS (New fix)
				// Base layers don't have selections or settings to save
				if (layer.type === LayerType.BASE_IMAGE) {
					return {
						id: layer.id,
						type: LayerType.BASE_IMAGE,
						visible: layer.visible,
						locked: layer.locked
					};
				}

				// 3. GLITTER FILL LAYERS (Default)
				return {
					id: layer.id,
					type: layer.type || LayerType.GLITTER_FILL,
					visible: layer.visible,
					// Safely handle selections: if undefined, save as empty array
					selections: layer.selections ? JSON.parse(JSON.stringify(layer.selections)) : [],
					selectedGlitterIndex: layer.selectedGlitterIndex,
					// Safely handle settings
					settings: layer.settings ? { ...layer.settings } : {}
				};
			}),
			activeLayerId: this.activeLayerId
		};

		this.history = this.history.slice(0, this.historyIndex + 1);

		if (this.history.length >= CONFIG.historyLimit) {
			this.history.shift();
		} else {
			this.historyIndex++;
		}

		this.history.push(state);
		this.updateHistoryButtons();
	}

	async restoreState(state) {
		// Restore layers with async sticker deserialization
		this.layers = [];

		for (const layerData of state.layers) {
			if (layerData.type === LayerType.STICKER && this.stickerManager) {
				// 1. Sticker Layer
				const restoredLayer = await this.stickerManager.deserializeSticker(layerData);
				if (restoredLayer) {
					this.layers.push(restoredLayer);
				}
			} else if (layerData.type === LayerType.BASE_IMAGE) {
				// 2. Base Image Layer (New fix)
				this.layers.push({
					id: layerData.id,
					type: LayerType.BASE_IMAGE,
					visible: layerData.visible,
					locked: layerData.locked,
					image: null // Image is global (this.originalImage), this layer is just for z-index/visibility
				});
			} else {
				// 3. Glitter-fill layer (existing)
				this.layers.push({
					id: layerData.id,
					type: layerData.type || LayerType.GLITTER_FILL,
					visible: layerData.visible,
					// Safe parsing for selections
					selections: layerData.selections ? JSON.parse(JSON.stringify(layerData.selections)) : [],
					selectedGlitterIndex: layerData.selectedGlitterIndex,
					settings: layerData.settings ? { ...layerData.settings } : {}
				});
			}
		}

		this.activeLayerId = state.activeLayerId;

		this.layerManager.renderLayersList();
		this.loadActiveLayerSettings();
		this.updateGlitterSelection();
		this.updatePreview();
		this.updateActionButtons();
	}
	async undo() {
		if (this.historyIndex > 0) {
			this.historyIndex--;
			await this.restoreState(this.history[this.historyIndex]);
			this.updateHistoryButtons();
		}
	}

	async redo() {
		if (this.historyIndex < this.history.length - 1) {
			this.historyIndex++;
			await this.restoreState(this.history[this.historyIndex]);
			this.updateHistoryButtons();
		}
	}

	updateHistoryButtons() {
		document.getElementById('undoTool').disabled = this.historyIndex <= 0;
		document.getElementById('redoTool').disabled = this.historyIndex >= this.history.length - 1;
	}

	updateActionButtons() {
		const hasImage = this.originalImage !== null;

		// Check if any layers have content (glitter selections OR stickers)
		const hasAnySelection = this.layers.some(l => {
			if (l.type === LayerType.STICKER) {
				return true; // Sticker layers always have content
			} else if (l.type === LayerType.GLITTER_FILL) {
				return l.selections && l.selections.length > 0;
			}
			return false;
		});

		const clearAllTool = document.getElementById('clearAllTool');
		const exportGif = document.getElementById('exportGif');
		const imageClearBtn = document.getElementById('imageClearBtn');
		const colorPickerTool = document.getElementById('colorPickerTool');
		const handTool = document.getElementById('handTool');
		const zoomTool = document.getElementById('zoomTool');
		const zoomControls = document.getElementById('zoomControls');
		const addBtn = document.getElementById('addLayerBtn');
		const previewToggle = document.getElementById('previewModeToggle');
		const transparencyToggle = document.getElementById('transparencyToggle');
		const boundsToggle = document.getElementById('boundsToggle');

		// --- Reference the container ---
		const previewControls = document.getElementById('previewControls');

		if (clearAllTool) clearAllTool.disabled = !hasImage;
		if (exportGif) exportGif.disabled = !hasAnySelection;

		if (transparencyToggle) transparencyToggle.disabled = !hasImage;
		if (boundsToggle) boundsToggle.disabled = !hasImage;

		// --- Toggle visibility of the controls container ---
		if (previewControls) {
			if (hasImage) {
				previewControls.classList.add('visible');
			} else {
				previewControls.classList.remove('visible');
			}
		}

		if (imageClearBtn) {
			if (hasImage) {
				imageClearBtn.classList.add('visible');
			} else {
				imageClearBtn.classList.remove('visible');
			}
		}

		if (colorPickerTool) colorPickerTool.disabled = !hasImage;
		if (handTool) handTool.disabled = !hasImage;
		if (zoomTool) zoomTool.disabled = !hasImage;

		// UX: Can't add layers until image is loaded
		if (addBtn) {
			addBtn.disabled = !hasImage || this.layers.length >= CONFIG.maxLayers;
			if (!hasImage) {
				addBtn.title = 'Load an image first';
			} else if (this.layers.length >= CONFIG.maxLayers) {
				addBtn.title = `Maximum ${CONFIG.maxLayers} layers`;
			} else {
				addBtn.title = 'Add new layer';
			}

			if (!addBtn.disabled) {
				addBtn.classList.add('visible');
			} else {
				addBtn.classList.remove('visible');
			}
		}

		// UX: Disable preview toggle when no selections
		if (previewToggle) {
			previewToggle.disabled = !hasAnySelection;
			if (!hasAnySelection) {
				previewToggle.title = 'Add glitter or stickers first';
			} else if (this.showAllLayers) {
				previewToggle.title = 'Show only active layer';
			} else {
				previewToggle.title = 'Show all layers';
			}
		}

		// UX: Update export tooltip
		if (exportGif) {
			if (!hasAnySelection) {
				exportGif.title = 'Add glitter or stickers first';
			} else {
				exportGif.title = 'Export GIF';
			}
		}
	}

	resetAll() {
		if (!this.originalImage) return;

		if (confirm('Reset everything? This will clear the image and all layers.')) {
			this.clearImage();
		}
	}

	clearImage() {
		this.originalImage = null;
		this.originalImageData = null;
		this.originalAlphaChannel = null;
		this.layerManager.layers = [];
		this.layerManager.activeLayerId = null;

		// Reset UI
		document.getElementById('imageUpload').value = '';
		document.getElementById('imageDropzone').classList.remove('has-image');

		const dropzoneContent = document.getElementById('dropzoneContent');
		dropzoneContent.classList.add('visible');

		this.updateSidePanelUI(null);

		// remove selected from #previewCanvas
		this.previewCanvas.classList.remove('selected');

		// Clear canvas
		this.originalCanvas.classList.remove('visible');

		// Reset Transparency Toggle & Background
		this.previewContainer.classList.remove('transparent-bg');
		this.previewContainer.style.backgroundSize = '';
		this.previewContainer.style.backgroundPosition = '';
		const transparencyToggle = document.getElementById('transparencyToggle');
		if (transparencyToggle) transparencyToggle.classList.remove('active');

		// Reset Bounds Toggle & Container Class
		this.previewContainer.classList.remove('bounds');
		const boundsToggle = document.getElementById('boundsToggle');
		if (boundsToggle) boundsToggle.classList.remove('active');

		// --- Hide the controls container immediately ---
		const previewControls = document.getElementById('previewControls');
		if (previewControls) previewControls.classList.remove('visible');

		this.clearPreview();
		this.glitterBackgroundsContainer.innerHTML = '';

		// UX: Reset to empty state properly
		this.showLayerSettingsEmptyState();
		this.showGlitterSettingsEmptyState();
		this.collapseLayerSettings();
		this.collapseGlitterSettings();

		// reset selected colors
		document.getElementById('selectedColorsEmpty').classList.add('visible');
		document.getElementById('selectedColorsDisplay').innerHTML = '';

		this.glitterManager.clearAllFilters();

		this.viewport.resetViewport();
		this.updateZoomUI();

		this.layerManager.renderLayersList();
		this.updateHistoryButtons();
		this.updateActionButtons();
		this.setTool(ToolType.SELECT);
		this.updateStatus('Load an image to begin');
		this.updateStatusBar();

		window.dispatchEvent(new Event('imageRemoved'));
	}

	debouncedSliderUpdate(sliderType) {
		clearTimeout(this.sliderTimeout);
		this.sliderTimeout = setTimeout(() => {
			this.updatePreview();
		}, CONFIG.sliderDebounceMs);
	}


	// ===== GLITTER LOADING =====




	// ===== IMAGE LOADING =====

	async loadImage(event) {
		const file = event.target.files[0];
		if (!file) return;

		if (file.size > CONFIG.maxFileSizeMB * 1024 * 1024) {
			this.showError(`Image too large. Maximum size is ${CONFIG.maxFileSizeMB}MB`);
			return;
		}

		const img = new Image();
		img.onload = () => {
			let width = img.width, height = img.height;

			if (width > CONFIG.maxImageWidth || height > CONFIG.maxImageHeight) {
				const scale = Math.min(CONFIG.maxImageWidth / width, CONFIG.maxImageHeight / height);
				width = Math.floor(width * scale);
				height = Math.floor(height * scale);
			}

			this.originalImage = img;
			this.originalCanvas.width = width;
			this.originalCanvas.height = height;
			this.previewCanvas.width = width;
			this.previewCanvas.height = height;

			this.previewWrapper.style.width = width + 'px';
			this.previewWrapper.style.height = height + 'px';

			this.originalCtx.drawImage(img, 0, 0, width, height);
			this.originalImageData = this.originalCtx.getImageData(0, 0, width, height);

			this.originalAlphaChannel = new Uint8Array(width * height);
			for (let i = 0; i < width * height; i++) {
				this.originalAlphaChannel[i] = this.originalImageData.data[i * 4 + 3];
			}

			// Tell viewport about canvas dimensions
			this.viewport.setCanvasDimensions(this.previewCanvas.width, this.previewCanvas.height);
			this.viewport.resetZoomSmart();
			this.updateZoomUI();

			const dropzone = document.getElementById('imageDropzone');
			dropzone.classList.add('has-image');
			document.getElementById('dropzoneContent').classList.remove('visible');
			this.originalCanvas.classList.add('visible');

			// Clear previous layers and glitter
			this.layers = [];
			this.glitterBackgroundsContainer.innerHTML = '';

			// 1. Create Base Image Layer
			if (CONFIG.createBaseImageLayerOnLoad) {
				const layer = this.layerManager.createBaseImageLayer(LayerType.BASE_IMAGE);
				this.layers.push(layer);
				// Set it active immediately
				this.layerManager.setActiveLayer(layer.id);
			}

			// 2. Create Default Glitter Layer (Optional)
			if (CONFIG.createDefaultLayerOnLoad) {
				const layer = this.layerManager.createLayer();
				this.layers.push(layer);
				// If created, this becomes the new active layer
				this.layerManager.setActiveLayer(layer.id);
			} else {
				// 3. If NO default layer is created, check if we have a Base Layer
				if (this.layers.length > 0) {
					// Ensure the existing Base Layer stays selected and UI updates
					this.layerManager.setActiveLayer(this.layers[0].id);
				} else {
					// Only if completely empty do we reset to null
					this.activeLayerId = null;
					this.updateSidePanelUI(null);
				}
			}

			// 4. Reset History
			this.history = [{
				layers: this.layers.map(layer => {
					if (layer.type === LayerType.BASE_IMAGE) {
						return { id: layer.id, type: LayerType.BASE_IMAGE, visible: layer.visible, locked: layer.locked };
					}
					// ... (rest of history mapping logic) ...
					return {
						id: layer.id,
						type: layer.type || LayerType.GLITTER_FILL,
						visible: layer.visible,
						selections: [],
						selectedGlitterIndex: layer.selectedGlitterIndex,
						settings: { ...layer.settings }
					};
				}),
				activeLayerId: this.activeLayerId
			}];
			this.historyIndex = 0;

			this.layerManager.renderLayersList();
			this.updateHistoryButtons();
			this.updateActionButtons();
			this.updateStatusBar();

			this.previewCtx.putImageData(this.originalImageData, 0, 0);
			// this.setTool(ToolType.COLOR_PICKER);
			// this.updateStatus('Click on the preview to select a color');

			window.dispatchEvent(new Event('imageLoaded'));


		};
		img.src = URL.createObjectURL(file);
	}

	updateStatusBar() {
		if (this.originalImage) {
			const dims = `${this.originalCanvas.width} × ${this.originalCanvas.height}px`;
			document.getElementById('statusDimensions').textContent = dims;

			const zoomPct = Math.round(this.viewport.currentZoom * 100);
			document.getElementById('statusZoom').textContent = `${zoomPct}%`;
		} else {
			document.getElementById('statusDimensions').textContent = '';
			document.getElementById('statusZoom').textContent = '';
		}
	}



	handleCanvasClick(event) {
		if (!this.originalImageData) return;

		// ... (Coordinate calculation logic stays the same) ...
		const rect = this.previewCanvas.getBoundingClientRect();
		const clickX = event.clientX - rect.left;
		const clickY = event.clientY - rect.top;
		const scaleX = this.previewCanvas.width / rect.width;
		const scaleY = this.previewCanvas.height / rect.height;
		const x = Math.floor(clickX * scaleX);
		const y = Math.floor(clickY * scaleY);

		if (x < 0 || x >= this.previewCanvas.width || y < 0 || y >= this.previewCanvas.height) {
			return;
		}

		// Select Tool: Pick layer at click location
		if (this.currentTool === ToolType.SELECT) {
			this.layerManager.handleLayerPick(x, y);
			return;
		}

		// Color Picker Tool
		if (this.currentTool === ToolType.COLOR_PICKER) {
			let layer = this.layerManager.getActiveLayer();

			// ============================================================
			// UPDATED LOGIC START
			// ============================================================

			if (!layer) {
				this.updateStatus('Please select the Base Image or a Glitter Layer.');
				return;
			}

			// Case 1: Base Image is Selected -> Create NEW Glitter Layer
			if (layer.type === LayerType.BASE_IMAGE) {
				const newLayer = this.layerManager.createLayer();
				this.layers.push(newLayer);
				this.layerManager.setActiveLayer(newLayer.id);
				this.layerManager.renderLayersList();
				layer = newLayer; // Switch target to the new layer
				this.updateStatus('Created new layer from Base Image');
			}
			// Case 2: Glitter Fill Layer is Selected -> Use it
			else if (layer.type === LayerType.GLITTER_FILL) {
				// Continue using this layer
			}
			// Case 3: Sticker (or other) -> Block
			else {
				this.updateStatus('Color Picker disabled on Sticker layers.');
				return;
			}

			// ============================================================
			// UPDATED LOGIC END
			// ============================================================

			const pixelIndex = y * this.originalCanvas.width + x;
			const alpha = this.originalAlphaChannel[pixelIndex];

			if (alpha < CONFIG.alphaThreshold) {
				this.updateStatus('Cannot select transparent pixels');
				return;
			}

			const i = pixelIndex * 4;
			const r = this.originalImageData.data[i];
			const g = this.originalImageData.data[i + 1];
			const b = this.originalImageData.data[i + 2];

			// Now safe to access settings because we ensured layer is GLITTER_FILL
			const multiSelect = layer.settings.multiSelect;
			if (!multiSelect) layer.selections = [];

			layer.selections.push({ r, g, b, x, y });
			this.layerManager.renderLayersList();
			this.saveState();
			this.updatePreview();
			this.updateActionButtons();
			this.updateSelectedColorsDisplay();

			this.updateStatus(`Selected RGB(${r}, ${g}, ${b}) at (${x}, ${y})`);
		}
	}





	// REPLACE updateSelectedColorsDisplay() in GlitterEditor class

	updateSelectedColorsDisplay() {
		const container = document.getElementById('selectedColorsDisplay');
		if (!container) return;

		const layer = this.layerManager.getActiveLayer();

		// Only show for glitter layers with selections
		if (!layer || layer.type !== LayerType.GLITTER_FILL || !layer.selections || layer.selections.length === 0) {
			document.getElementById('selectedColorsEmpty').classList.add('visible');
			container.innerHTML = '';
			return;
		}

		document.getElementById('selectedColorsEmpty').classList.remove('visible');
		container.innerHTML = '';

		layer.selections.forEach((sel, index) => {
			const chip = document.createElement('div');
			chip.className = 'selected-color-chip';

			const swatch = document.createElement('div');
			swatch.className = 'selected-color-swatch';
			swatch.style.backgroundColor = `rgb(${sel.r}, ${sel.g}, ${sel.b})`;

			const text = document.createElement('span');
			text.textContent = `${sel.r},${sel.g},${sel.b}`;

			const removeBtn = document.createElement('button');
			removeBtn.className = 'selected-color-remove';
			removeBtn.textContent = '×';
			removeBtn.title = 'Remove this color selection';
			removeBtn.onclick = () => this.removeColorSelection(index);

			chip.append(swatch, text, removeBtn);
			container.appendChild(chip);
		});
	}

	removeColorSelection(index) {
		const layer = this.layerManager.getActiveLayer();

		// Only works on glitter layers
		if (!layer || layer.type !== LayerType.GLITTER_FILL || !layer.selections) {
			return;
		}

		layer.selections.splice(index, 1);
		this.layerManager.renderLayersList();
		this.saveState();

		if (layer.selections.length > 0) {
			this.updatePreview();
		} else {
			this.clearPreview();
		}

		this.updateActionButtons();
		this.updateSelectedColorsDisplay();
	}




	clearPreview() {
		if (this.originalImageData) {
			this.previewCtx.putImageData(this.originalImageData, 0, 0);
		} else {
			this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		}

		// Clear glitter backgrounds
		this.glitterBackgroundsContainer.innerHTML = '';

		// ADD: Clear sticker elements
		if (this.stickerManager) {
			this.stickerManager.stickerElements.forEach((element, layerId) => {
				if (element.parentNode) {
					element.parentNode.removeChild(element);
				}
			});
			this.stickerManager.stickerElements.clear();
		}
	}

	// ===== PREVIEW & RENDERING =====

	// In GlitterEditor class
	updatePreview() {
		if (!this.originalImageData) {
			this.clearPreview();
			return;
		}

		const layersToShow = this.showAllLayers
			? this.layers.filter(l => l.visible && (
				(l.type === LayerType.GLITTER_FILL && l.selections.length > 0) ||
				l.type === LayerType.STICKER
			))
			: [this.layerManager.getActiveLayer()].filter(l => l && l.visible && (
				(l.type === LayerType.GLITTER_FILL && l.selections.length > 0) ||
				l.type === LayerType.STICKER
			));

		if (layersToShow.length === 0) {
			this.clearPreview();
			return;
		}

		this.renderPreviewCanvas(layersToShow);

		// Use the manager to render the glitter backgrounds
		this.glitterManager.renderGlitterBackgrounds(layersToShow);

		this.renderStickers(layersToShow);

		// Use the manager to update scales
		this.glitterManager.updatePreviewScale();
	}

	renderStickers(layersToShow) {
		if (!this.stickerManager) return;

		layersToShow.forEach(layer => {
			if (layer.type === LayerType.STICKER) {
				this.stickerManager.renderSticker(layer);
			}
		});
	}



	renderPreviewCanvas(layersToShow) {
		// Clear canvas first
		this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);

		// ============================================================
		// UPDATED LOGIC: BASE IMAGE VISIBILITY
		// ============================================================

		// Find the Base Image layer in the stack
		const baseLayer = this.layers.find(l => l.type === LayerType.BASE_IMAGE);

		// If the base layer exists and is set to hidden, stop here (leave canvas transparent)
		if (baseLayer && !baseLayer.visible) {
			return;
		}

		// Otherwise, draw the original image
		this.previewCtx.putImageData(this.originalImageData, 0, 0);
	}


	// ===== EXPORT PROGRESS =====
	showExportProgress() {
		const progress = document.getElementById('exportProgress');
		const fill = document.getElementById('exportProgressFill');
		const text = document.getElementById('exportProgressText');
		const time = document.getElementById('exportProgressTime');
		progress.classList.add('visible');
		fill.style.width = '0%';
		text.textContent = 'Preparing...';
		time.textContent = '';
		this.exportStartTime = Date.now();
		this.exportCancelled = false;
	}

	updateExportProgress(percent, message, currentFrame = 0, totalFrames = 0) {
		const fill = document.getElementById('exportProgressFill');
		const text = document.getElementById('exportProgressText');
		const time = document.getElementById('exportProgressTime');
		fill.style.width = `${percent}%`;
		text.textContent = message;
		if (percent > 0 && currentFrame > 0 && totalFrames > 0) {
			const elapsed = Date.now() - this.exportStartTime;
			const estimatedTotal = (elapsed / percent) * 100;
			const remaining = estimatedTotal - elapsed;
			if (remaining > 1000) {
				const seconds = Math.ceil(remaining / 1000);
				time.textContent = `~${seconds}s remaining`;
			}
		}
	}

	hideExportProgress() {
		document.getElementById('exportProgress').classList.remove('visible');
	}

	async exportAnimatedGif() {
		const visibleLayers = this.layers.filter(l => l.visible && l.selections.length > 0);

		if (visibleLayers.length === 0) {
			this.showError('No visible layers with selections!');
			return;
		}

		const exportBtn = document.getElementById('exportGif');
		exportBtn.disabled = true;
		this.showExportProgress();

		// Read current settings from DOM
		// Read current settings from DOM
		const qualityInput = document.getElementById('exportQuality');
		const ditherEnabledInput = document.getElementById('exportDitherEnabled');
		const ditherTypeInput = document.getElementById('exportDitherType');
		const baseImageInput = document.getElementById('exportBaseImage');
		const transparencyInput = document.getElementById('exportTransparency');
		const matteColorInput = document.getElementById('exportMatteColor');
		const delayInput = document.getElementById('exportFrameDelay');
		const maxFramesInput = document.getElementById('exportMaxFrames');

		this.exportSettings.quality = qualityInput ? parseInt(qualityInput.value) : CONFIG.defaultExportQuality;
		this.exportSettings.ditherEnabled = ditherEnabledInput ? ditherEnabledInput.checked : CONFIG.defaultExportDitherEnabled;
		this.exportSettings.ditherType = ditherTypeInput ? ditherTypeInput.value : CONFIG.defaultExportDitherType;
		this.exportSettings.frameDelay = delayInput ? parseInt(delayInput.value) : CONFIG.defaultExportFrameDelay;
		this.exportSettings.maxFrames = maxFramesInput ? parseInt(maxFramesInput.value) : CONFIG.defaultExportMaxFrames;
		this.exportSettings.baseImage = baseImageInput ? baseImageInput.checked : CONFIG.defaultExportBaseImage;
		this.exportSettings.transparency = transparencyInput ? transparencyInput.checked : CONFIG.defaultExportTransparency;
		this.exportSettings.matteColor = matteColorInput ? matteColorInput.value : CONFIG.defaultExportMatteColor;

		console.log('Export settings:', this.exportSettings);

		const exportParams = {
			visibleLayers: visibleLayers,
			glitterGifs: this.glitterManager.glitterGifs, // UPDATED
			canvasData: {
				// ... existing data ...
			},
			exportSettings: this.exportSettings,
			callbacks: {
				onStatus: (msg) => this.updateStatus(msg),
				onProgress: (percent, text, currentFrame, totalFrames) => {
					if (this.exportCancelled) throw new Error('Export cancelled');
					this.updateExportProgress(percent, text, currentFrame, totalFrames);
				},
				onComplete: () => {
					exportBtn.disabled = false;
					this.hideExportProgress();
				},
				// UPDATED: Delegate to manager
				parseGif: (url) => this.glitterManager.parseGifFromUrl(url),
				createMask: (layer) => {
					// UPDATED: Delegate to manager
					const mask = this.glitterManager.createMaskForLayer(layer);
					if (layer.settings.feather > 0) {
						this.glitterManager.applyFeatherToMask(mask, layer.settings.feather);
					}
					return mask;
				}
			}
		};

		setTimeout(async () => {
			try {
				await this.exporter.process(exportParams);
			} catch (error) {
				console.error('Export error:', error);
				exportBtn.disabled = false;
				this.hideExportProgress();
				if (error.message !== 'Export cancelled') {
					this.showError('Export failed: ' + error.message);
				}
			}
		}, 50);
	}

	showError(message) {
		const toast = document.getElementById('errorToast');
		document.getElementById('errorText').textContent = message;
		toast.classList.add('visible');

		setTimeout(() => {
			if (toast.classList.contains('visible')) {
				this.hideError();
			}
		}, 5000);
	}

	hideError() {
		document.getElementById('errorToast').classList.remove('visible');
	}

	updateStatus(message) {
		document.getElementById('statusText').textContent = message;
	}
}

// ============================================
// GIF EXPORT MANAGER CLASS
// ============================================
class GifExporter {
	constructor() {
		const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

		this.config = {
			workers: 4,
			// Quality 1 = Best (samples every pixel). Critical for pixel art accuracy.
			quality: 1,
			workerScript: 'js/gif.worker.js', //  isLocal ? 'js/gif.worker.js' : 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js',
			fileName: 'ryandavi-com_glitter.gif',
			timing: { forceDelay: 100, maxFrames: 60 }
		};

		// Reusable canvas elements
		this.canvas = document.createElement('canvas');
		this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

		this.helperCanvas = document.createElement('canvas');
		this.helperCtx = this.helperCanvas.getContext('2d', { willReadFrequently: true });
	}

	gcd(a, b) { return !b ? a : this.gcd(b, a % b); }
	lcm(a, b) { return (a * b) / this.gcd(a, b); }

	_hasTransparency(canvasData) {
		const { originalAlpha, alphaThreshold } = canvasData;
		for (let i = 0; i < originalAlpha.length; i++) {
			if (originalAlpha[i] < alphaThreshold) {
				return true; // Found at least one transparent pixel
			}
		}
		return false; // No transparency in image
	}


	_renderStickerToCanvas(layer, ctx, frameIndex, canvasWidth, canvasHeight) {
		const { transform, frames, isAnimated, width, height, url } = layer.stickerData;

		// Determine which frame to use
		let imageData;
		if (isAnimated && frames) {
			const frameCount = frames.frames.length;
			const stickerFrameIndex = frameIndex % frameCount;
			imageData = frames.frames[stickerFrameIndex].data;
		} else {
			// Static image - need to load it
			// For now, we'll need to pre-load sticker images during export prep
			console.warn('Static sticker export not yet implemented');
			return;
		}

		// Create temporary canvas for the sticker frame
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = width;
		tempCanvas.height = height;
		const tempCtx = tempCanvas.getContext('2d');
		tempCtx.putImageData(imageData, 0, 0);

		// Calculate transform
		const centerX = transform.position.x;
		const centerY = transform.position.y;
		const scaleX = transform.scale.x / 100;
		const scaleY = transform.scale.y / 100;
		const rotation = transform.rotation * Math.PI / 180;

		// Apply transforms to main canvas
		ctx.save();
		ctx.globalAlpha = transform.opacity / 100;

		// Translate to center point
		ctx.translate(centerX, centerY);

		// Rotate
		if (rotation !== 0) {
			ctx.rotate(rotation);
		}

		// Scale
		ctx.scale(
			scaleX * (transform.flipX ? -1 : 1),
			scaleY * (transform.flipY ? -1 : 1)
		);

		// Draw sticker (centered on origin)
		ctx.drawImage(
			tempCanvas,
			-width / 2,
			-height / 2,
			width,
			height
		);

		ctx.restore();
	}


	async process(params) {
		const { visibleLayers, glitterGifs, canvasData, exportSettings, callbacks } = params;

		// 1. Ensure Frames Loaded
		callbacks.onProgress(0, 'Loading glitter frames...', 0, 0);
		await this._loadMissingFrames(visibleLayers, glitterGifs, callbacks);

		// 2. De-Optimize Frames (Flatten disposal methods)
		callbacks.onProgress(5, 'Processing frames...', 0, 0);
		this._deoptimizeGlitterFrames(visibleLayers, glitterGifs);

		// 3. CHECK FOR TRANSPARENCY
		const hasTransparency = this._hasTransparency(canvasData);
		console.log(`[GifExporter] Image has transparency: ${hasTransparency}`);

		// Need a safe key if EITHER the image has transparency OR we're exporting glitter-only
		const needsSafeKey = hasTransparency || !exportSettings.baseImage;

		// Only find a safe key if we actually need transparency
		const safeKey = needsSafeKey
			? this._findSafeTransparencyKey(visibleLayers, glitterGifs, canvasData)
			: null;

		if (safeKey) {
			console.log(`[GifExporter] Selected Safe Transparency Key: RGB(${safeKey.r}, ${safeKey.g}, ${safeKey.b})`);
		}

		// 4. Synchronization
		const totalFrames = this._calculateTotalFrames(visibleLayers, glitterGifs, exportSettings.maxFrames);
		callbacks.onStatus(`Rendering ${totalFrames} frames...`);

		// 5. Prepare Masks
		callbacks.onProgress(10, 'Preparing masks...', 0, totalFrames);
		const maskCanvases = new Map();

		this.helperCanvas.width = canvasData.width;
		this.helperCanvas.height = canvasData.height;

		visibleLayers.forEach(layer => {
			const rawMask = callbacks.createMask(layer);
			const maskCanvas = this._createMaskCanvas(rawMask, canvasData.width, canvasData.height);
			maskCanvases.set(layer.id, maskCanvas);
		});

		// 6. Setup Encoder
		// Disable dithering when we need transparency
		const needsTransparency = hasTransparency && exportSettings.transparency;

		const gifOptions = {
			workers: this.config.workers,
			quality: exportSettings.quality,
			width: canvasData.width,
			height: canvasData.height,
			workerScript: this.config.workerScript,
			dither: needsTransparency
				? false
				: (exportSettings.ditherEnabled ? exportSettings.ditherType : false)
		};

		// Enable transparency if user wants it and we have a safe key
		if (needsTransparency && safeKey) {
			gifOptions.transparent = safeKey.hex;
			gifOptions.background = safeKey.hex;  // MUST BE safeKey.hex, not 0
			console.log('[GifExporter] Transparency enabled with key:', safeKey.hex);
		}

		const gif = new GIF(gifOptions);

		// 7. Render Loop
		this.canvas.width = canvasData.width;
		this.canvas.height = canvasData.height;

		for (let f = 0; f < totalFrames; f++) {
			const frameData = this._renderFrame(f, canvasData, visibleLayers, glitterGifs, maskCanvases, safeKey, exportSettings);

			// Around line 105, REMOVE dispose: 2 again:
			gif.addFrame(frameData, {
				delay: exportSettings.frameDelay,
				copy: true
				// NO dispose property - we're providing full frames
			});
			const progressPercent = 10 + Math.floor((f / totalFrames) * 65);
			callbacks.onProgress(progressPercent, `Rendering frame ${f + 1}/${totalFrames}...`, f + 1, totalFrames);
		}

		// 8. Output
		callbacks.onProgress(75, 'Encoding GIF...', totalFrames, totalFrames);

		gif.on('error', (error) => {
			console.error('GIF encoding error:', error);
			throw new Error('GIF encoding failed: ' + error.message);
		});

		gif.on('abort', () => {
			throw new Error('Export cancelled');
		});

		gif.on('finished', (blob) => this._handleFileSave(blob, callbacks));

		console.log('Starting GIF render:', {
			frames: totalFrames,
			workers: this.config.workers,
			quality: exportSettings.quality,
			key: safeKey
		});

		gif.render();
	}

	// --- HELPER METHODS ---

	_findSafeTransparencyKey(layers, library, canvasData) {
		const candidates = [
			{ name: 'DarkGray1', hex: 0x010101, r: 1, g: 1, b: 1 },
			{ name: 'DarkGray2', hex: 0x020202, r: 2, g: 2, b: 2 },
			{ name: 'DarkGray3', hex: 0x030303, r: 3, g: 3, b: 3 },
			{ name: 'OffGreen1', hex: 0x00FE00, r: 0, g: 254, b: 0 },
			{ name: 'OffGreen2', hex: 0x01FF00, r: 1, g: 255, b: 0 },
			{ name: 'Green', hex: 0x00FF00, r: 0, g: 255, b: 0 },
			{ name: 'Magenta', hex: 0xFF00FF, r: 255, g: 0, b: 255 },
			{ name: 'Blue', hex: 0x0000FF, r: 0, g: 0, b: 255 },
			{ name: 'Red', hex: 0xFF0000, r: 255, g: 0, b: 0 },
			{ name: 'Yellow', hex: 0xFFFF00, r: 255, g: 255, b: 0 },
			{ name: 'Cyan', hex: 0x00FFFF, r: 0, g: 255, b: 255 }
		];

		const glitterFrames = [];
		layers.forEach(layer => {
			const glitter = library[layer.selectedGlitterIndex];
			if (glitter?.frames?.frames) {
				glitterFrames.push(...glitter.frames.frames);
			}
		});

		for (const candidate of candidates) {
			let isSafe = true;

			const imgData = canvasData.originalData;
			const imgLen = imgData.length;

			for (let i = 0; i < imgLen; i += 4) {
				const pixelIndex = i / 4;
				if (canvasData.originalAlpha[pixelIndex] < canvasData.alphaThreshold) continue;

				if (imgData[i] === candidate.r &&
					imgData[i + 1] === candidate.g &&
					imgData[i + 2] === candidate.b) {
					isSafe = false;
					break;
				}
			}

			if (!isSafe) continue;

			for (const frame of glitterFrames) {
				const data = frame.data;
				const len = data.length;

				for (let i = 0; i < len; i += 4) {
					if (data[i + 3] === 0) continue;
					if (data[i] === candidate.r &&
						data[i + 1] === candidate.g &&
						data[i + 2] === candidate.b) {
						isSafe = false;
						break;
					}
				}
				if (!isSafe) break;
			}

			if (isSafe) {
				console.log(`[GifExporter] Found safe transparency key: ${candidate.name} RGB(${candidate.r}, ${candidate.g}, ${candidate.b})`);
				return candidate;
			}
		}

		console.warn('[GifExporter] All candidates failed. Using ultra-dark fallback.');
		return { name: 'Fallback', hex: 0x000001, r: 0, g: 0, b: 1 };
	}

	_renderFrame(frameIndex, canvasData, layers, library, maskCanvases, safeKey, exportSettings) {
		const { width, height, originalData, originalAlpha, alphaThreshold } = canvasData;
		const ctx = this.ctx;
		const hCtx = this.helperCtx;

		// A. Clear canvas
		this.canvas.width = width;
		this.canvas.height = height;
		ctx.clearRect(0, 0, width, height);

		// B. Draw Background Image
		if (exportSettings.baseImage) {
			const bgImage = new ImageData(originalData, width, height);
			ctx.putImageData(bgImage, 0, 0);
		}

		// C. Composite Glitter Layers
		layers.forEach(layer => {
			// Skip non-glitter layers
			if (layer.type !== LayerType.GLITTER_FILL) return;

			const maskCanvas = maskCanvases.get(layer.id);
			if (!maskCanvas) return;

			const glitter = library[layer.selectedGlitterIndex];
			const frames = glitter.frames.frames;
			const fIdx = frameIndex % frames.length;
			const glitterFrame = frames[fIdx];

			// Save state so previous layers don't corrupt this one
			hCtx.save();

			// 1. Pattern Fill
			hCtx.clearRect(0, 0, width, height);

			const patternSource = document.createElement('canvas');
			patternSource.width = glitterFrame.width;
			patternSource.height = glitterFrame.height;
			patternSource.getContext('2d').putImageData(glitterFrame.data, 0, 0);

			const pattern = hCtx.createPattern(patternSource, 'repeat');
			const scale = (layer.settings.scale <= 0 ? 1 : layer.settings.scale) / 100;
			const matrix = new DOMMatrix();
			matrix.scaleSelf(scale, scale);
			pattern.setTransform(matrix);

			hCtx.globalAlpha = layer.settings.opacity / 100;
			hCtx.fillStyle = pattern;
			hCtx.fillRect(0, 0, width, height);

			// 2. Apply Mask
			hCtx.globalCompositeOperation = 'destination-in';
			hCtx.globalAlpha = 1.0;
			hCtx.drawImage(maskCanvas, 0, 0);

			// Restore state (resets composite op and alpha)
			hCtx.restore();

			// 3. Composite onto main canvas
			ctx.drawImage(this.helperCanvas, 0, 0);
		});

		// D. Render Sticker Layers (NEW)
		layers.forEach(layer => {
			if (layer.type === LayerType.STICKER && layer.visible) {
				this._renderStickerToCanvas(layer, ctx, frameIndex, width, height);
			}
		});

		// E. Handle Transparency
		if (exportSettings.transparency && safeKey) {
			const imgData = ctx.getImageData(0, 0, width, height);
			const data = imgData.data;

			for (let i = 0; i < width * height; i++) {
				const pixelIndex = i;
				const alpha = originalAlpha[pixelIndex];

				if (alpha < alphaThreshold) {
					const pIdx = i * 4;
					data[pIdx] = safeKey.r;
					data[pIdx + 1] = safeKey.g;
					data[pIdx + 2] = safeKey.b;
					data[pIdx + 3] = 255;
				}
			}

			ctx.putImageData(imgData, 0, 0);
		}

		return ctx.getImageData(0, 0, width, height);
	}

	_parseHexColor(hex) {
		hex = hex.replace('#', '');
		const r = parseInt(hex.substring(0, 2), 16);
		const g = parseInt(hex.substring(2, 4), 16);
		const b = parseInt(hex.substring(4, 6), 16);
		return { r, g, b };
	}

	_createMaskCanvas(rawMaskData, width, height) {
		const c = document.createElement('canvas');
		c.width = width;
		c.height = height;
		const ctx = c.getContext('2d');

		const imgData = ctx.createImageData(width, height);
		const data = imgData.data;

		for (let i = 0; i < rawMaskData.length; i++) {
			const val = rawMaskData[i];
			const pIdx = i * 4;
			data[pIdx] = 0;
			data[pIdx + 1] = 0;
			data[pIdx + 2] = 0;
			data[pIdx + 3] = val;
		}

		ctx.putImageData(imgData, 0, 0);
		return c;
	}

	_deoptimizeGlitterFrames(layers, library) {
		layers.forEach(layer => {
			const glitter = library[layer.selectedGlitterIndex];
			if (glitter.isFlattened) return;

			const rawFrames = glitter.frames.frames;
			const width = glitter.frames.width;
			const height = glitter.frames.height;

			this.helperCanvas.width = width;
			this.helperCanvas.height = height;
			const ctx = this.helperCanvas.getContext('2d', { willReadFrequently: true });

			const tempC = document.createElement('canvas');
			const tempCtx = tempC.getContext('2d');

			const flattenedFrames = [];
			let previousFrameData = ctx.getImageData(0, 0, width, height);

			// We'll detect transparency from the FIRST FLATTENED FRAME
			let glitterHasTransparency = false;

			for (let i = 0; i < rawFrames.length; i++) {
				const frame = rawFrames[i];
				const dims = { x: frame.x || 0, y: frame.y || 0, w: frame.width || width, h: frame.height || height };

				const patchData = new ImageData(frame.data, dims.w, dims.h);
				tempC.width = dims.w;
				tempC.height = dims.h;
				tempCtx.putImageData(patchData, 0, 0);

				if (frame.disposal === 3) previousFrameData = ctx.getImageData(0, 0, width, height);

				ctx.drawImage(tempC, dims.x, dims.y);

				const flattenedData = ctx.getImageData(0, 0, width, height);

				flattenedFrames.push({
					data: flattenedData,
					width, height
				});

				// Check FIRST FRAME ONLY for actual transparency
				if (i === 0) {
					const checkData = flattenedData.data;
					for (let j = 3; j < checkData.length; j += 4) {
						if (checkData[j] < 255) {
							glitterHasTransparency = true;
							break;
						}
					}
					console.log(`[GifExporter] Glitter "${glitter.name}" has transparency: ${glitterHasTransparency}`);
				}

				// If glitter has transparency anywhere, ALL frames must clear (disposal=2)
				// Otherwise use stacking (disposal=1) for opaque glitter
				const disposal = glitterHasTransparency
					? 2
					: (frame.disposal !== undefined ? frame.disposal : 1);

				if (disposal === 2) ctx.clearRect(dims.x, dims.y, dims.w, dims.h);
				else if (disposal === 3) ctx.putImageData(previousFrameData, 0, 0);
			}

			glitter.frames.frames = flattenedFrames;
			glitter.isFlattened = true;
		});
	}

	async _loadMissingFrames(layers, library, callbacks) {
		for (const layer of layers) {
			const glitter = library[layer.selectedGlitterIndex];
			if (!glitter.frames) {
				callbacks.onStatus(`Loading ${glitter.name}...`);
				try {
					glitter.frames = await callbacks.parseGif(glitter.url);
				} catch (e) {
					throw new Error(`Failed to load ${glitter.name}`);
				}
			}
		}
	}

	_calculateTotalFrames(layers, library, maxFrames) {
		const counts = layers.map(l => {
			const glitter = library[l.selectedGlitterIndex];
			if (!glitter || !glitter.frames || !glitter.frames.frames) {
				console.error('Missing frames for layer', l.id, 'glitter index', l.selectedGlitterIndex);
				return 1;
			}
			return glitter.frames.frames.length;
		});

		let total = counts[0] || 1;
		if (counts.length > 1) {
			total = counts.reduce((acc, val) => this.lcm(acc, val), total);
		}

		const result = Math.min(total, maxFrames);
		console.log('Calculated total frames:', result, 'from counts:', counts);
		return result;
	}

	async _handleFileSave(blob, callbacks) {
		console.log('_handleFileSave called with blob size:', blob.size);
		callbacks.onProgress(100, 'Export complete!', 0, 0);
		callbacks.onStatus('Export complete!');
		callbacks.onComplete();

		// 1. Create File object (Required for navigator.share)
		const file = new File([blob], this.config.fileName, {
			type: 'image/gif',
			lastModified: Date.now()
		});

		// 2. Create Blob URL
		const url = URL.createObjectURL(blob);

		// 3. Hand off to Modal
		this._showExportPreviewModal(url, file);
	}

	_showExportPreviewModal(blobUrl, file) {
		const modal = document.getElementById('exportPreviewModal');
		const img = document.getElementById('exportPreviewImage');
		const instructions = modal.querySelector('.export-preview-instructions');
		const closeBtn = document.getElementById('closeExportPreviewModal');

		// Button Elements
		const shareBtn = document.getElementById('exportPreviewShare');
		const openBtn = document.getElementById('exportPreviewOpen');
		const saveBtn = document.getElementById('exportPreviewSave'); // New Button

		// 1. Environment Detection
		// Force iOS logic if iPhone/iPad detected
		const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
		const canShare = navigator.canShare && navigator.canShare({ files: [file] });

		// 2. Helper to manage Button State (Text + Disabled)
		const configureBtn = (btn, isEnabled, text = null) => {
			if (!btn) return;
			btn.disabled = !isEnabled;
			// Optional: btn.style.display = isEnabled ? 'inline-flex' : 'none'; 
			if (text) {
				const span = btn.querySelector('.name');
				if (span) span.textContent = text;
			}
		};

		// 3. Set Image
		img.src = blobUrl;

		// 4. Configure UI Logic
		if (isIOS) {
			// --- iOS Logic ---

			// DISABLE "Open GIF" & "Save" (Direct download fails/breaks on iOS)
			configureBtn(openBtn, false);
			configureBtn(saveBtn, false);

			if (canShare) {
				// ENABLE "Share" (mapped to Save Image)
				configureBtn(shareBtn, true, "Save Image");

				instructions.innerHTML = `
            <p><strong>Ready!</strong> Tap <strong>"Save Image"</strong> below to save to Photos.</p>
            <p class="text-muted" style="margin-top: 8px; font-size: 12px;">
                <strong>Why can't I just tap and hold?</strong><br>
                iOS doesn't support saving animated GIFs directly from the browser. 
                Using the Share button preserves the animation properly.
            </p>`;
			} else {
				// Fallback (Rare old iOS)
				configureBtn(shareBtn, false);
				instructions.innerHTML = `
            <p>Long-press the image to save.</p>
            <p class="text-muted" style="margin-top: 8px; font-size: 12px;">
                Note: This may save as a still image. Update iOS to use the Share feature for full animation support.
            </p>`;
			}
		}
		else {
			// --- Desktop / Android Logic ---

			// ENABLE "Open GIF" & "Save" (Standard browser features)
			configureBtn(openBtn, true);
			configureBtn(saveBtn, true);

			// Handle Share button (Some desktops like Safari/Edge support it)
			if (canShare) {
				configureBtn(shareBtn, true, "Share");
				instructions.innerHTML = `<p>Save using the buttons below or right-click the image.</p>`;
			} else {
				configureBtn(shareBtn, false);
				instructions.innerHTML = `<p>Use the <strong>Save</strong> button or right-click the image.</p>`;
			}
		}

		// 5. Show Modal
		modal.classList.add('visible');

		// 6. Handlers
		const cleanup = () => {
			modal.classList.remove('visible');
			setTimeout(() => URL.revokeObjectURL(blobUrl), 500);
		};

		closeBtn.onclick = cleanup;
		modal.onclick = (e) => { if (e.target === modal) cleanup(); };

		// Handler: Share (iOS "Save Image")
		shareBtn.onclick = async () => {
			if (shareBtn.disabled || !canShare) return;
			try {
				await navigator.share({
					files: [file],
					title: 'Glitter GIF',
					text: 'Created with Glitter Image Editor'
				});
			} catch (error) {
				if (error.name !== 'AbortError') console.error('Share failed:', error);
			}
		};

		// Handler: Open in New Tab
		openBtn.onclick = () => {
			if (openBtn.disabled) return;
			const win = window.open(blobUrl, '_blank');
			if (!win) alert('Please allow popups to view the full image.');
		};

		// Handler: Save / Download (Desktop)
		saveBtn.onclick = () => {
			if (saveBtn.disabled) return;
			const a = document.createElement('a');
			a.href = blobUrl;
			a.download = this.config.fileName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
		};
	}





}

// ============================================
// MOBILE MANAGER CLASS
// ============================================
class MobileManager {
	constructor(editor) {
		this.editor = editor;
		this.isMobile = window.innerWidth <= 800;
		this.activeTab = 'image'; // image or preview
		this.activeDrawer = null; // glitter or layers or null
		this.resizeObserver = null;

		// 1. Initialize the flag
		this.eventsBound = false;

		if (this.isMobile) {
			this.init();
		}

		this.setupResizeObserver();
		this.setupImageEvents();
	}

	init() {
		console.log('Mobile: Initializing mobile manager');
		this.showMobileControls();
		this.setupEventListeners();
		this.switchTab('image');
		console.log('Mobile: Initialization complete, on image tab');
	}


	showMobileControls() {
		const topNav = document.querySelector('.mobile-top-nav');
		const bottomNav = document.querySelector('.mobile-bottom-nav');

		if (topNav) topNav.classList.add('visible');
		if (bottomNav) bottomNav.classList.add('visible');

		// Update initial state based on whether image exists
		const previewTab = document.querySelector('.mobile-tab-btn[data-tab="preview"]');
		if (previewTab) {
			previewTab.disabled = !this.editor.originalImage;
		}

		this.updateLayerSettingsButtonState();
		this.updateGlitterSettingsButtonState();

		console.log('Mobile: Controls shown');
	}

	setupEventListeners() {
		// 2. Stop if events are already set up
		if (this.eventsBound) return;

		// Tab buttons
		document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				this.switchTab(btn.dataset.tab);
			});
		});

		// Drawer buttons
		document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
			btn.addEventListener('click', (e) => {
				// Prevent immediate propagation to avoid conflicts
				e.stopPropagation();
				this.toggleDrawer(btn.dataset.drawer);
			});
		});


		window.addEventListener('layerChanged', () => {
			this.updateLayerSettingsButtonState();
			this.updateGlitterSettingsButtonState();
		});

		this.updateLayerSettingsButtonState();
		this.updateGlitterSettingsButtonState();

		// Add layer button
		const mobileAddLayerBtn = document.getElementById('mobileAddLayerBtn');
		if (mobileAddLayerBtn) {
			mobileAddLayerBtn.addEventListener('click', () => {
				this.editor.layerManager.addLayer();
			});
		}

		// Close drawer when clicking on section headers
		document.querySelectorAll('.section-header').forEach(header => {
			header.addEventListener('click', (e) => {
				if (!this.isMobile || !this.activeDrawer) return;

				if (e.target.closest('.section-header-action')) return;

				if (header.id === 'layerSettingsHeader' || header.id === 'glitterSettingsHeader') {
					e.preventDefault();
					e.stopPropagation();
					e.stopImmediatePropagation();
					this.closeAllDrawers();
					return;
				}

				if (!header.closest('.collapsible-section')) {
					this.closeAllDrawers();
				}
			}, { capture: true });
		});

		// Prevent action buttons from triggering header click
		document.querySelectorAll('.section-header-action').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
			});
		});

		// 3. Mark events as bound
		this.eventsBound = true;
	}

	setupImageEvents() {
		window.addEventListener('imageLoaded', () => {
			if (this.isMobile) {
				this.editor.previewWrapper.style.opacity = '0';
				this.editor.previewWrapper.style.transition = 'none';

				const previewBtn = document.querySelector('.mobile-tab-btn[data-tab="preview"]');
				if (previewBtn) {
					previewBtn.disabled = false;
				}

				this.switchTab('preview');

				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						this.editor.viewport.performResizeUpdate();
						this.editor.viewport.resetZoomSmart();
						this.editor.updateZoomUI();
						this.editor.previewWrapper.style.transition = '';
						this.editor.previewWrapper.style.opacity = '1';
					});
				});
			}
		});
	}

	setupResizeObserver() {
		let resizeTimer;

		this.resizeObserver = new ResizeObserver(entries => {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				const newWidth = window.innerWidth;
				const nowMobile = newWidth <= 800;

				if (!this.isMobile && nowMobile) {
					// Switching TO Mobile
					console.log('Mobile: Switching to mobile mode');
					this.isMobile = true;
					this.init();

					if (this.editor.originalImage) {
						this.switchTab('preview');
						requestAnimationFrame(() => {
							requestAnimationFrame(() => {
								this.editor.viewport.performResizeUpdate();
								this.editor.viewport.resetViewport();
								this.editor.updateZoomUI();
								this.editor.updateTransparencyGrid();
							});
						});
					}

				} else if (this.isMobile && !nowMobile) {
					// Switching TO Desktop
					console.log('Mobile: Switching to desktop mode');
					this.isMobile = false;
					this.cleanup();

					setTimeout(() => {
						if (this.editor.originalImage) {
							this.editor.viewport.performResizeUpdate();
							this.editor.viewport.resetViewport();
							this.editor.updateZoomUI();
						}
					}, 50);
				}
			}, 250);
		});

		this.resizeObserver.observe(document.body);
	}

	switchTab(tab) {
		console.log('Mobile: Switching to tab:', tab);
		this.activeTab = tab;

		document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.tab === tab);
		});

		this.closeAllDrawers();

		document.body.classList.remove('mobile-image-tab', 'mobile-preview-tab');
		document.body.classList.add(`mobile-${tab}-tab`);
	}

	toggleDrawer(drawer) {
		console.log('Mobile: Toggling drawer:', drawer);

		if (this.activeDrawer === drawer) {
			// Closing
			this.closeAllDrawers();
		} else {
			// Opening
			this.closeAllDrawers();

			// Logic simplified: we rely on single-event binding now.
			setTimeout(() => {
				this.activeDrawer = drawer;

				const camelCase = drawer.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
				const className = camelCase + 'Open';
				document.body.classList.add(className);

				document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
					btn.classList.toggle('active', btn.dataset.drawer === drawer);
				});
			}, 0);
		}
	}

	updateLayerSettingsButtonState() {
		if (!this.isMobile) return;
		const btn = document.getElementById('mobileLayerSettingsBtn');
		if (!btn) return;
		const hasActiveLayer = this.editor.layerManager.getActiveLayer() !== null;
		btn.disabled = !hasActiveLayer;
	}

	updateGlitterSettingsButtonState() {
		if (!this.isMobile) return;
		const btn = document.getElementById('mobileGlitterSettingsBtn');
		if (!btn) return;
		const hasActiveLayer = this.editor.layerManager.getActiveLayer() !== null;
		btn.disabled = !hasActiveLayer;
	}

	openSettingsDrawer() {
		const activeLayer = this.editor.layerManager.getActiveLayer();

		if (activeLayer) {
			document.body.classList.add('settingsOpen');
			document.body.classList.remove('show-glitter-settings');
		} else if (this.editor.layerManager.layers.length > 0) {
			document.body.classList.add('settingsOpen', 'show-glitter-settings');
		} else {
			document.body.classList.add('settingsOpen');
			document.body.classList.remove('show-glitter-settings');
		}
	}

	closeAllDrawers() {
		this.activeDrawer = null;
		document.body.classList.remove(
			'glitterOpen',
			'layersOpen',
			'layerSettingsOpen',
			'glitterSettingsOpen'
		);
		document.querySelectorAll('.mobile-drawer-btn').forEach(btn => {
			btn.classList.remove('active');
		});
	}

	cleanup() {
		// Note: Cleanup does NOT remove event listeners because
		// removing anonymous functions is difficult. 
		// We rely on 'eventsBound' to prevent duplication upon re-init.

		console.log('Mobile: Starting cleanup');

		const topNav = document.querySelector('.mobile-top-nav');
		const bottomNav = document.querySelector('.mobile-bottom-nav');

		if (topNav) topNav.classList.remove('visible');
		if (bottomNav) bottomNav.classList.remove('visible');

		document.body.classList.remove(
			'mobile-image-tab',
			'mobile-preview-tab',
			'glitterOpen',
			'layersOpen',
			'layerSettingsOpen',
			'glitterSettingsOpen'
		);

		console.log('Mobile: Cleanup complete, restored to desktop layout');
	}
}



// everything inside IIFE
(async () => {
	const editor = new GlitterEditor();
	await editor.init();

	// Initialize managers after editor is ready
	const tooltips = new TooltipManager();
	const mobileManager = new MobileManager(editor);
	editor.mobileManager = mobileManager;

	// Make editor globally accessible (optional, useful for debugging)
	window.editor = editor;
})();