
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
		this.canvasElementsContainer = this.editor.canvasElementsContainer;

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




	insertLayer(layer) {
		// Insert above the currently selected layer, or at the top if none selected
		if (this.activeLayerId) {
			const activeIndex = this.layers.findIndex(l => l.id === this.activeLayerId);
			if (activeIndex !== -1) {
				// Insert above (higher index = visually above)
				this.layers.splice(activeIndex + 1, 0, layer);
			} else {
				// Fallback if active layer not found
				this.layers.push(layer);
			}
		} else {
			// No active layer - add to top
			this.layers.push(layer);
		}

		this.setActiveLayer(layer.id);
		this.renderLayersList();
	}

	// In LayerManager
addLayer(type = LayerType.GLITTER_FILL) {
    let layer;

    if (type === LayerType.STICKER) {
        layer = this.editor.stickerManager.createLayer();
    } else if (type === LayerType.GLITTER_FILL) {
        layer = this.editor.glitterManager.createLayer();
    } else {
        console.log('Invalid layer type');
    }

    if (!layer) return;  // Factory returns null if max reached

    this.insertLayer(layer);
    this.setActiveLayer(layer.id);

    // On mobile, open design panel when glitter or sticker layer is added
    if (this.editor.mobileManager && this.editor.mobileManager.isMobile && CONFIG.mobileOpenDrawOnLayerAdd) {
        if (type === LayerType.GLITTER_FILL || type === LayerType.STICKER) {
            this.editor.mobileManager.toggleDrawer('design');
        }
    }

    this.renderLayersList();
    this.editor.saveState();
    this.editor.updateActionButtons();

    const msg = type === LayerType.STICKER ?
        'New sticker layer added' :
        'New glitter fill layer added';
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
			const element = this.editor.stickerManager.layerElements.get(layerId);
			if (element) {
				element.style.display = layer.visible ? 'block' : 'none';
			}
		}

		this.renderLayersList();
		this.editor.saveState();
		this.editor.updatePreview();
	}

	// ===== LAYER SELECTION =====

	updateSelectionHighlight(layerId) {
		// Clear ALL previous selection highlights
		const previewContainer = this.editor.previewCanvas?.parentElement;
		if (previewContainer) {
			previewContainer.querySelectorAll('.selected').forEach(el => {
				el.classList.remove('selected');
			});
		}

		// Apply selection highlight to the specified layer
		const layer = this.layers.find(l => l.id === layerId);
		if (!layer) return;

		if (layer.type === LayerType.BASE_IMAGE && this.editor.previewCanvas) {
			this.editor.previewCanvas.classList.add('selected');
		} else if (layer.type === LayerType.STICKER) {
			const element = this.editor.stickerManager.layerElements.get(layer.id);
			if (element) element.classList.add('selected');
		} else if (layer.type === LayerType.GLITTER_FILL) {
			const element = this.editor.glitterManager.layerElements.get(layer.id);
			if (element) element.classList.add('selected');
		}
	}


setActiveLayer(layerId) {
	if (this.activeLayerId === layerId) {
		return;
	}

	this.activeLayerId = layerId;
	this.renderLayersList();

	const layer = this.layers.find(l => l.id === layerId);

	// Update context toolbars
	this.editor.updateContextToolbars();

	// Update selection highlight
	this.updateSelectionHighlight(layerId);

	// Update preview (important for solo mode)
	this.editor.updatePreview();

	// Update Side Panel UI
	this.editor.updateSidePanelUI(layer);

	// Execute layer-specific activation logic
	if (layer) {
		const config = LAYER_UI_CONFIG[layer.type];
		if (config && config.onActivate) {
			config.onActivate(this.editor, layer);
		}
	} else {
		// No layer selected: Ensure empty states are shown
		this.editor.showLayerSettingsEmptyState();
		this.editor.showGlitterSettingsEmptyState();
		this.editor.showStickerSettingsEmptyState();
	}

	// Add/remove body class for mobile settings drawer visibility
	if (layerId) {
		document.body.classList.add('has-active-layer');
	} else {
		document.body.classList.remove('has-active-layer');
	}

	window.dispatchEvent(new CustomEvent('layerChanged'));

	if (layer && layer.type === LayerType.STICKER) {
		this.editor.updateStatus(`Selected sticker: ${layer.name || 'Sticker'}`);
	}
}


	getActiveLayer() {
		return this.layers.find(l => l.id === this.activeLayerId);
	}

	// ===== LAYER NAVIGATION =====

goToGlitter(layerId) {
	const layer = this.layers.find(l => l.id === layerId);
	if (!layer || layer.type !== LayerType.GLITTER_FILL) return;

	// Select this layer
	this.setActiveLayer(layerId);

	// On mobile, open the design drawer
	if (this.editor.mobileManager && this.editor.mobileManager.isMobile) {
		this.editor.mobileManager.toggleDrawer('design');
	}

	// Scroll to the glitter in the picker
	if (layer.selectedGlitterId !== undefined) {
		this.editor.glitterManager.scrollToContent(layer.selectedGlitterId);
	}
}

goToSticker(layerId) {
	const layer = this.layers.find(l => l.id === layerId);
	if (!layer || layer.type !== LayerType.STICKER) return;

	// Select this layer
	this.setActiveLayer(layerId);

	// On mobile, open the design drawer
	if (this.editor.mobileManager && this.editor.mobileManager.isMobile) {
		this.editor.mobileManager.toggleDrawer('design');
	}

	// Scroll to the sticker in the picker
	if (layer.stickerSourceId) {
		this.editor.stickerManager.scrollToContent(layer.stickerSourceId);
	}
}



	// ===== LAYER PICKING (SELECT TOOL) =====

	// In LayerManager class

	handleLayerPick(x, y) {

	// Prevent layer picking during touch gestures
	if (this.editor.touchGestureActive) {
		console.log('🎯 LAYER PICK: Blocked - touch gesture active');
		return;
	}

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
					const glitter = this.editor.glitterManager.getItemById(layer.selectedGlitterId);
					name = glitter?.name || 'Glitter';
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

		// Update bottom bar buttons
		this.updateBottomBarButtons();

	}


	updateBottomBarButtons() {
		const selectedLayer = this.getActiveLayer();
		const canAddLayers = this.layers.length < CONFIG.maxLayers;
		const canInteractWithSelected = selectedLayer && selectedLayer.type !== LayerType.BASE_IMAGE;

		// Add buttons - only check max layers
		const addGlitterBtn = document.getElementById('layersBarAddGlitter');
		const addStickerBtn = document.getElementById('layersBarAddSticker');
		if (addGlitterBtn) addGlitterBtn.disabled = !canAddLayers;
		if (addStickerBtn) addStickerBtn.disabled = !canAddLayers;

		// Buttons requiring selection (but not base)
		const goToBtn = document.getElementById('layersBarGoToSelected');
		const cloneBtn = document.getElementById('layersBarCloneSelected');
		const deleteBtn = document.getElementById('layersBarDeleteSelected');

		if (goToBtn) goToBtn.disabled = !canInteractWithSelected;
		if (cloneBtn) cloneBtn.disabled = !canInteractWithSelected || !canAddLayers;
		if (deleteBtn) deleteBtn.disabled = !canInteractWithSelected;
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
						proportionalScale: sourceLayer.stickerData.transform.proportionalScale,
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
				selectedGlitterId: sourceLayer.selectedGlitterId, // CHANGED
				settings: { ...sourceLayer.settings }
			};

			// Clone the glitter background element
			const sourceElement = this.canvasElementsContainer.querySelector(
				`[data-layer-id="${sourceLayer.id}"]`
			);
			if (sourceElement) {
				const clonedElement = sourceElement.cloneNode(true);
				clonedElement.dataset.layerId = clonedLayer.id;
				this.canvasElementsContainer.appendChild(clonedElement);
			}
		}

		// Find original layer index and insert clone right after it
		// (Higher index = visually above in the stack)
		const sourceIndex = this.layers.findIndex(l => l.id === layerId);
		this.layers.splice(sourceIndex + 1, 0, clonedLayer);

		// Make the clone active and re-render
		this.setActiveLayer(clonedLayer.id);
		this.renderLayersList();
		this.reorderLayers();

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
			const glitter = this.editor.glitterManager.getItemById(layer.selectedGlitterId);
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



		// 3. Info (Name & Type)
		const info = document.createElement('div');
		info.className = 'layer-info';

		const nameText = document.createElement('div');
		nameText.className = 'layer-name';

		const typeText = document.createElement('div');
		typeText.className = 'layer-type';

		switch (layer.type) {
			case LayerType.STICKER: {
				const sticker = this.editor.stickerManager.getItemById(layer.stickerSourceId); // Changed this line
				nameText.textContent = layer.name || 'Sticker';
				typeText.textContent = sticker?.category ? `Sticker / ${sticker.category}` : 'Sticker';
				break;
			}
			case LayerType.GLITTER_FILL: {
				const glitter = this.editor.glitterManager.getItemById(layer.selectedGlitterId);
				nameText.textContent = glitter ? glitter.name : 'No glitter';
				typeText.textContent = glitter?.category ? `Glitter / ${glitter.category}` : 'Glitter';
				break;
			}
			case LayerType.BASE_IMAGE:
				nameText.textContent = 'Base Image';
				typeText.textContent = 'Image';
				break;
			default:
				nameText.textContent = 'Unknown Layer';
				typeText.textContent = 'Unknown';
		}

		info.append(nameText, typeText);




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
layerEl.onclick = () => {
	// Dispatch custom event for mobile manager
	window.dispatchEvent(new CustomEvent('layerItemClick', {
		detail: { layerId: layer.id }
	}));
	
	this.setActiveLayer(layer.id);
};

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
		btn.className = "btn-icon-simple icon-wrapper " + className;
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

	// Handle different layer types
	if (activeLayer.type === LayerType.GLITTER_FILL) {
		// Check if glitter has been selected
		if (activeLayer.selectedGlitterId === undefined || activeLayer.selectedGlitterId === null) {
			mobileLayersSwatch.classList.add('empty');
			mobileLayersSwatch.classList.remove('pixelated');
			mobileLayersSwatch.style.backgroundImage = '';
			return;
		}

		const glitter = this.editor.glitterManager.getItemById(activeLayer.selectedGlitterId);
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
	} else if (activeLayer.type === LayerType.STICKER) {
		// Check if sticker has been selected
		if (!activeLayer.stickerSourceId) {
			mobileLayersSwatch.classList.add('empty');
			mobileLayersSwatch.classList.remove('pixelated');
			mobileLayersSwatch.style.backgroundImage = '';
			return;
		}

		const sticker = this.editor.stickerManager.getItemById(activeLayer.stickerSourceId);
		if (sticker) {
			mobileLayersSwatch.classList.remove('empty');
			mobileLayersSwatch.style.backgroundImage = `url(${sticker.url})`;
			if (sticker.isPixelated) {
				mobileLayersSwatch.classList.add('pixelated');
			} else {
				mobileLayersSwatch.classList.remove('pixelated');
			}
		} else {
			mobileLayersSwatch.classList.add('empty');
			mobileLayersSwatch.classList.remove('pixelated');
			mobileLayersSwatch.style.backgroundImage = '';
		}
	} else if (activeLayer.type === LayerType.BASE_IMAGE) {
		// Show a preview of the canvas
		if (this.editor.originalCanvas) {
			const canvas = this.editor.originalCanvas;
			mobileLayersSwatch.classList.remove('empty');
			mobileLayersSwatch.style.backgroundImage = `url(${canvas.toDataURL()})`;
			mobileLayersSwatch.classList.remove('pixelated');
		} else {
			mobileLayersSwatch.classList.add('empty');
			mobileLayersSwatch.classList.remove('pixelated');
			mobileLayersSwatch.style.backgroundImage = '';
		}
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
		this.reorderLayerItems();
		this.reorderLayers();
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
				this.reorderLayerItems();
				this.reorderLayers();
				this.editor.saveState();
			}
		}

		this.draggedLayerId = null;
		this.dropTargetId = null;
		this.dropInsertAbove = false;
	}

	// ===== OPTIMIZED REORDERING =====

	// In Layer Panel
	reorderLayerItems() {
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

	// In Preview
	reorderLayers() {
		const container = this.canvasElementsContainer;

		// Get existing background AND sticker elements
		const existingElements = new Map();
		container.querySelectorAll('.glitter-element, .sticker-element').forEach(el => {
			existingElements.set(el.dataset.layerId, el);
		});

		// Reorder them to match layers array
		const fragment = document.createDocumentFragment();

		this.layers.forEach(layer => {
			const el = existingElements.get(layer.id);
			if (el) {
				// =======================================================
				// THE FIX:
				// Remove the conditional check. Update the z-index for 
				// every element (glitter or sticker) found.
				// =======================================================
				el.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);

				fragment.appendChild(el);
			}
		});

		container.innerHTML = '';
		container.appendChild(fragment);
	}
}