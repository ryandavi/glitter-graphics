// ============================================
// STICKER MANAGER CLASS
// Handles all sticker-related operations
// ============================================
class StickerManager extends ContentManager {
	constructor(editor) {
		super(editor);

		// Add sticker-specific filters to base activeFilters
		Object.assign(this.activeFilters, {
			vibes: new Set()
		});
	}


	getLayerType() {
		return LayerType.STICKER;
	}

	setupUI() {
		this.ui = {
			panel: document.getElementById('stickersOptions'),
			gridContainer: document.getElementById('stickerGridContainer'),
			emptyState: document.getElementById('stickerSearchEmptyState'),
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

				this.renderPicker();
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
				frames: null,                    // Load on-demand

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
			category: 'User Uploads',  // ADD THIS LINE

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
		this.renderPicker();

		// 4. Process asynchronously
		try {
			await this.processUploadedSticker(userSticker, file);
		} catch (error) {
			console.error('Failed to process uploaded sticker:', error);
			userSticker.error = error.message;
			userSticker.isLoading = false;
			this.renderPicker();
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
		if (this.userContent.length >= CONFIG.maxStickers) {
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
		this.renderPicker();

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

	// In StickerManager
	async createStickerLayer(stickerSourceId) {
		const sticker = this.getItemById(stickerSourceId);
		if (!sticker) {
			console.error('Sticker not found:', stickerSourceId);
			return null;
		}

		// Use factory method
		const layer = this.createLayer(stickerSourceId);
		if (!layer) return null;  // Factory returns null if max reached

		// Add to layer manager (consistent with addLayer)
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
						x: CONFIG.defaultStickerScale.x,
						y: CONFIG.defaultStickerScale.y
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
			activeLayer.stickerData.staticImageData = null;  // ADD THIS
			activeLayer.stickerData.isFlattened = false;     // ADD THIS

			// Clear cached frame data when changing sticker
			activeLayer.stickerData.frames = null;

			// Render
			this.renderLayer(activeLayer);
			this.editor.layerManager.renderLayersList();
			this.editor.updateStickerSelection();
			this.editor.updateStatus('Sticker replaced');
			this.editor.saveState();

		} else {
			// Create NEW layer (when on glitter layer or base layer)
			await this.createStickerLayer(stickerId);
			this.editor.updateStickerSelection();
			this.editor.updateStatus('Sticker added');
		}
	}

	// ===== RENDERING =====

	renderLayer(layer) {
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

		// Create Image
		const img = document.createElement('img');
		img.src = layer.stickerData.url;
		img.draggable = false; // Important: Disable native drag

		img.style.imageRendering = 'pixelated';

		element.appendChild(img);

		// Apply Transform
		this.applyTransform(element, layer);

		// Add to Container
		this.editor.canvasElementsContainer.appendChild(element);

		// Store Reference
		layer.stickerData.element = element;
		this.layerElements.set(layer.id, element);

		// Attach drag listeners
		this.attachDragListeners(element, layer.id);

// Update selection highlight for this layer if it's active
this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);

	}

	applyTransform(element, layer) {
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


	// ===== TRANSFORM UPDATES =====

	updateTransform(layerId, updates) {
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
		const element = this.layerElements.get(layerId);
		if (element) {
			this.applyTransform(element, layer);
		}
	}

	// ===== CENTERING METHODS =====

	centerHorizontal(layerId) {
		const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
		if (!layer || layer.type !== LayerType.STICKER) return;

		// Get canvas center
		const canvasWidth = this.editor.originalCanvas.width;
		const centerX = canvasWidth / 2;

		this.updateTransform(layerId, {
			position: { x: centerX }
		});

		// Update settings UI
		this.editor.loadStickerSettings(layer);
		this.editor.saveState();
	}

	centerVertical(layerId) {
		const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
		if (!layer || layer.type !== LayerType.STICKER) return;

		// Get canvas center
		const canvasHeight = this.editor.originalCanvas.height;
		const centerY = canvasHeight / 2;

		this.updateTransform(layerId, {
			position: { y: centerY }
		});

		// Update settings UI
		this.editor.loadStickerSettings(layer);
		this.editor.saveState();
	}

	// ===== DRAG AND DROP =====

	cloneStickerElement(sourceLayer, clonedLayer) {
		const sourceElement = this.editor.canvasElementsContainer.querySelector(
			`.sticker-element[data-layer-id="${sourceLayer.id}"]`
		);

		if (!sourceElement) return;

		const clonedElement = sourceElement.cloneNode(true);
		clonedElement.dataset.layerId = clonedLayer.id;

		// Remove the 'selected' class if present
		clonedElement.classList.remove('selected');

		// Apply transform to match cloned layer data
		this.applyTransform(clonedElement, clonedLayer);

		// Add to container
		this.editor.canvasElementsContainer.appendChild(clonedElement);

		// Store reference
		this.layerElements.set(clonedLayer.id, clonedElement);

		// Attach drag listeners
		this.attachDragListeners(clonedElement, clonedLayer.id);
	}

setupStickerTouchGestures(element, layerId) {
	// Remove any existing gesture handler
	if (element._touchHandler) {
		element._touchHandler.destroy();
	}
	
	const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
	if (!layer || layer.type !== LayerType.STICKER) return;
	
	const viewport = this.editor.viewport;
	let startTransform = null;
	
	const handler = new TouchGestureHandler(element, {
		// CRITICAL: Only stop propagation if sticker is selected
		preventPropagation: true,
		
		onGestureStart: (gestureType) => {
			const isSelected = this.editor.layerManager.activeLayerId === layerId;
			
			// If not selected, just select it (don't transform yet)
			if (!isSelected) {
				this.editor.layerManager.setActiveLayer(layerId);
				return;
			}
			
			// Store initial transform state only if selected
			startTransform = {
				scale: { ...layer.stickerData.transform.scale },
				rotation: layer.stickerData.transform.rotation,
				position: { ...layer.stickerData.transform.position }
			};
		},
		
		onSinglePan: (deltaX, deltaY, touchX, touchY) => {
			// Only pan if already selected
			const isSelected = this.editor.layerManager.activeLayerId === layerId;
			if (!isSelected || !startTransform) return;
			
			// Convert screen delta to canvas coordinates
			const canvasDeltaX = deltaX / viewport.currentZoom;
			const canvasDeltaY = deltaY / viewport.currentZoom;
			
			this.updateTransform(layerId, {
				position: {
					x: layer.stickerData.transform.position.x + canvasDeltaX,
					y: layer.stickerData.transform.position.y + canvasDeltaY
				}
			});
			
			// Update settings UI
			this.editor.loadStickerSettings(layer);
		},
		
		onPinchZoom: (scale, centerX, centerY) => {
			// Only scale if already selected
			const isSelected = this.editor.layerManager.activeLayerId === layerId;
			if (!isSelected || !startTransform) return;
			
			// Scale the sticker (respecting proportional scale)
			const currentScaleX = layer.stickerData.transform.scale.x;
			const currentScaleY = layer.stickerData.transform.scale.y;
			
			const newScaleX = currentScaleX * scale;
			const newScaleY = layer.stickerData.transform.proportionalScale 
				? newScaleX 
				: currentScaleY * scale;
			
			// Clamp scale values
			const clampedScaleX = Math.max(10, Math.min(500, newScaleX));
			const clampedScaleY = Math.max(10, Math.min(500, newScaleY));
			
			this.updateTransform(layerId, {
				scale: {
					x: clampedScaleX,
					y: clampedScaleY
				}
			});
			
			// Update settings UI
			this.editor.loadStickerSettings(layer);
		},
		
		onRotate: (angleDelta, centerX, centerY) => {
			// Only rotate if already selected
			const isSelected = this.editor.layerManager.activeLayerId === layerId;
			if (!isSelected || !startTransform) return;
			
			// Update rotation incrementally
			const newRotation = (layer.stickerData.transform.rotation + angleDelta) % 360;
			
			this.updateTransform(layerId, {
				rotation: newRotation
			});
			
			// Update settings UI
			this.editor.loadStickerSettings(layer);
		},
		
		onGestureEnd: () => {
			// Save state when all touches are released (only if we were transforming)
			if (startTransform) {
				this.editor.saveState();
			}
			startTransform = null;
		}
	});
	
	// Store handler on element for cleanup
	element._touchHandler = handler;
	
	// Ensure proper touch handling
	element.style.touchAction = 'none';
}

	attachDragListeners(element, layerId) {
		// MOUSE DRAG (existing code - keep as is)
		let isDragging = false;
		let startX = 0;
		let startY = 0;
		let startCanvasX = 0;
		let startCanvasY = 0;

		const handleMouseDown = (e) => {
			if (e.button !== 0) return; // Left click only

			const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
			if (!layer || !layer.visible || layer.locked) return;

			e.preventDefault();
			e.stopPropagation();

			isDragging = true;
			startX = e.clientX;
			startY = e.clientY;

			const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
			startCanvasX = canvasPos.x;
			startCanvasY = canvasPos.y;

			this.editor.layerManager.setActiveLayer(layerId);

			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
		};

		const handleMouseMove = (e) => {
			if (!isDragging) return;

			const layer = this.editor.layerManager.layers.find(l => l.id === layerId);
			if (!layer) return;

			const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
			const deltaX = canvasPos.x - startCanvasX;
			const deltaY = canvasPos.y - startCanvasY;

			const newX = layer.stickerData.transform.position.x + deltaX;
			const newY = layer.stickerData.transform.position.y + deltaY;

			this.updateTransform(layerId, {
				position: { x: newX, y: newY }
			});

			startCanvasX = canvasPos.x;
			startCanvasY = canvasPos.y;

			this.editor.loadStickerSettings(layer);
		};

		const handleMouseUp = () => {
			if (isDragging) {
				isDragging = false;
				this.editor.saveState();
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
			}
		};

		element.addEventListener('mousedown', handleMouseDown);

		// TOUCH GESTURES (new code)
		this.setupStickerTouchGestures(element, layerId);

		// Add touchend handler to save state
		element.addEventListener('touchend', (e) => {
			if (e.touches.length === 0) {
				// All touches released, save state
				this.editor.saveState();
			}
		});
	}

	// ===== LAYER REMOVAL =====

	removeSticker(layerId) {
		// Just remove DOM element
		this.removeStickerElement(layerId);

		// Clean up maps
		this.layerElements.delete(layerId);
	}

	removeStickerElement(layerId) {
		const element = this.layerElements.get(layerId);
		if (element && element.parentNode) {

			// Clean up touch handler
			if (element._touchHandler) {
				element._touchHandler.destroy();
			}


			element.parentNode.removeChild(element);
		}
	}

	// ===== SERIALIZATION =====

serializeSticker(layer) {
	// For undo/redo - exclude non-serializable data
	return {
		...layer,
		stickerSourceId: layer.stickerSourceId, // CRITICAL: Must preserve this
		stickerData: {
			...layer.stickerData,
			element: null,    // Can't serialize DOM
			frames: null      // Don't need frames for undo/redo - reload from URL on restore
		}
	};
}

	async deserializeSticker(layerData) {
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

		// No need to reload frames - browser handles animation natively
		// Frames are only loaded during export if needed

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

		// Revoke blob URLs for user uploads
		this.userContent.forEach(sticker => {
			if (sticker.url.startsWith('blob:')) {
				URL.revokeObjectURL(sticker.url);
			}
		});

		// Clear maps
		this.layerElements.clear();
	}
}
