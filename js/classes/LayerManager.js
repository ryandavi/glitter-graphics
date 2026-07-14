
// ============================================
// LAYER MANAGER CLASS
// Handles all layer CRUD operations, selection, reordering, and rendering
// ============================================

// Insertion-line geometry for layer drag & drop.
// LAYER_MARGIN_BOTTOM must match the .layer-item margin-bottom in style.css.
const LAYER_MARGIN_BOTTOM = 6;
const INSERTION_LINE_HEIGHT = 2;

class LayerManager {
	constructor(editor) {
		// Reference to main editor for callbacks
		this.editor = editor;

		// Layer state
		this.layers = [];
		this.activeLayerId = null;
		this.selectionCycleState = null;

		// Drag and drop state (desktop)
		this.draggedLayerId = null;
		this.dropTargetId = null;
		this.dropInsertAbove = false;
		this.dragScrollInterval = null;

		// Touch drag state (mobile)
		this.touchDragStartY = 0;
		this.touchDragLastY = 0;
		this.touchDragPointerId = null;
		this.touchDragPointerElement = null;

		// DOM references
		this.layersListContainer = document.getElementById('layersList');
		this.canvasElementsContainer = this.editor.canvasElementsContainer;
		this.baseImageSwatchDataUrl = '';

		this.setupContainerEvents();
	}

	// ===== INITIALIZATION =====

	setupContainerEvents() {
		// Layer deselection when clicking empty space
		this.layersListContainer.addEventListener('click', (e) => {
			if (e.target === this.layersListContainer) {
				this.clearSelection();
			}
		});

		// Allow dropping on empty space in the container (drop handler below)
		this.layersListContainer.addEventListener('dragover', (e) => {
			if (this.draggedLayerId && e.target === this.layersListContainer) {
				e.preventDefault();
			}
		});

		// Drop handler for container
		this.layersListContainer.addEventListener('drop', (e) => {
			if (e.target === this.layersListContainer) {
				this.handleLayerDrop(e, null);
			}
		});
	}

	get selectedLayerIds() {
		return this.editor.selectedLayerIds;
	}

	set selectedLayerIds(value) {
		this.editor.selectedLayerIds = value;
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
			locked: true,
			selectedGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId,
			background: {
				mode: 'image',
				color: '#ffffff',
				gradient: normalizeEffectGradient(CONFIG.rendering.gradient),
				scale: CONFIG.tools.effects.defaults.scale,
				opacity: 100,
				colorAdjust: null
			}
		};
		return layer;
	}

	serializeLayer(layer, options = {}) {
		const { includeMaskVersion = true } = options;
		if (!layer) return null;

		if (layer.type === LayerType.STICKER && this.editor.stickerManager) {
			return this.editor.stickerManager.serializeSticker(layer);
		}

		if (layer.type === LayerType.TEXT_GLITTER) {
			return {
				id: layer.id,
				type: LayerType.TEXT_GLITTER,
				name: layer.name,
				visible: layer.visible,
				locked: layer.locked,
				selectedGlitterId: layer.selectedGlitterId,
				settings: layer.settings ? { ...layer.settings } : {},
				textData: layer.textData ? JSON.parse(JSON.stringify(layer.textData)) : null
			};
		}

		if (layer.type === LayerType.SHAPE) {
			return {
				id: layer.id,
				type: LayerType.SHAPE,
				name: layer.name,
				visible: layer.visible,
				locked: layer.locked,
				selectedGlitterId: layer.selectedGlitterId,
				settings: layer.settings ? { ...layer.settings } : {},
				shapeData: layer.shapeData ? JSON.parse(JSON.stringify(layer.shapeData)) : null
			};
		}

		if (layer.type === LayerType.BASE_IMAGE) {
			return {
				id: layer.id,
				type: LayerType.BASE_IMAGE,
				visible: layer.visible,
				locked: true,
				selectedGlitterId: layer.selectedGlitterId,
				background: layer.background ? JSON.parse(JSON.stringify(layer.background)) : null
			};
		}

		const serialized = {
			id: layer.id,
			type: layer.type || LayerType.GLITTER_FILL,
			name: layer.name,
			visible: layer.visible,
			locked: layer.locked,
			selections: layer.selections ? JSON.parse(JSON.stringify(layer.selections)) : [],
			selectedGlitterId: layer.selectedGlitterId,
			settings: layer.settings ? { ...layer.settings } : {}
		};
		serialized.fill = layer.fill ? JSON.parse(JSON.stringify(layer.fill)) : null;

		if (includeMaskVersion) {
			serialized.maskVersion = layer.maskVersion || 0;
		}

		return serialized;
	}

	async deserializeLayer(layerData) {
		if (!layerData) return null;

		if (layerData.type === LayerType.STICKER && this.editor.stickerManager) {
			return this.editor.stickerManager.deserializeSticker(layerData);
		}

		if (layerData.type === LayerType.TEXT_GLITTER) {
			const restoredLayer = {
				id: layerData.id,
				type: LayerType.TEXT_GLITTER,
				name: layerData.name || this.editor.textGlitterManager?.getLayerName(layerData.textData?.text || ''),
				visible: layerData.visible,
				locked: layerData.locked,
				selectedGlitterId: layerData.selectedGlitterId,
				settings: layerData.settings ? { ...layerData.settings } : {},
				textData: layerData.textData ? JSON.parse(JSON.stringify(layerData.textData)) : null
			};

			this.editor.textGlitterManager?.normalizeLayer(restoredLayer);

			if (restoredLayer.textData?.fontId && this.editor.textGlitterManager) {
				try {
					await this.editor.textGlitterManager.ensureFontLoaded(restoredLayer.textData.fontId);
				} catch (error) {
					this.editor.textGlitterManager.reportFontLoadError(error);
					throw error;
				}
			}

			return restoredLayer;
		}

		if (layerData.type === LayerType.SHAPE) {
			const restoredLayer = {
				id: layerData.id,
				type: LayerType.SHAPE,
				name: layerData.name || 'Shape',
				visible: layerData.visible,
				locked: layerData.locked,
				selectedGlitterId: layerData.selectedGlitterId,
				settings: layerData.settings ? { ...layerData.settings } : {},
				shapeData: layerData.shapeData ? JSON.parse(JSON.stringify(layerData.shapeData)) : null
			};
			this.editor.shapeGlitterManager?.normalizeLayer(restoredLayer);
			return restoredLayer;
		}

		if (layerData.type === LayerType.BASE_IMAGE) {
			const layer = {
				id: layerData.id,
				type: LayerType.BASE_IMAGE,
				visible: layerData.visible,
				locked: true,
				selectedGlitterId: layerData.selectedGlitterId || CONFIG.tools.glitter.defaults.fillGlitterId,
				background: layerData.background ? JSON.parse(JSON.stringify(layerData.background)) : null,
				image: null
			};
			layer.background ||= {
				mode: 'image', color: '#ffffff', gradient: normalizeEffectGradient(CONFIG.rendering.gradient),
				scale: CONFIG.tools.effects.defaults.scale, opacity: 100, colorAdjust: null
			};
			layer.background.gradient = normalizeEffectGradient(layer.background.gradient);
			return layer;
		}

		const restored = {
			id: layerData.id,
			type: layerData.type || LayerType.GLITTER_FILL,
			name: layerData.name,
			visible: layerData.visible,
			locked: layerData.locked,
			maskVersion: layerData.maskVersion || 0,
			maskHasContent: false,
			selections: layerData.selections ? JSON.parse(JSON.stringify(layerData.selections)) : [],
			selectedGlitterId: layerData.selectedGlitterId,
			settings: layerData.settings ? { ...layerData.settings } : {}
		};
		restored.fill = layerData.fill ? JSON.parse(JSON.stringify(layerData.fill)) : null;
		return restored;
	}




	insertLayer(layer, options = {}) {
		const { suppressDesignGalleryFocus = false } = options;

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

		// Sticker and glitter-fill layers are gallery-driven picks — keep the
		// Design Gallery open (instead of jumping to the layer's Settings
		// section) so adding one doesn't cost an extra click to browse for the
		// next. Text layers have no gallery step, so they keep the default
		// (jump straight to Text Settings, see getPreferredDesignSection).
		if (!suppressDesignGalleryFocus && (layer.type === LayerType.STICKER || layer.type === LayerType.GLITTER_FILL)) {
			this.editor.setCollapsibleSectionOpen?.('designGallery', true, true);
		}
	}

	// In LayerManager
	addLayer(type = LayerType.GLITTER_FILL, options = {}) {
		const cfg = LAYER_UI_CONFIG[type];
		const manager = getLayerManagerForType(this.editor, type);
		if (!manager) {
			dbg('Invalid layer type');
			return;
		}

		let createOptions = cfg.createOptionsKey ? (options[cfg.createOptionsKey] || {}) : undefined;
		if (type === LayerType.STICKER && createOptions == null) {
			const configured = CONFIG.tools.stickers.defaultStickerId;
			createOptions = configured != null && manager.getItemById(configured) ? configured : null;
		}
		const layer = manager.createLayer(createOptions);

		if (!layer) return;  // Factory returns null if max reached

		this.insertLayer(layer);
		this.setActiveLayer(layer.id);

		// On mobile, open design panel for gallery-driven layer types (not Shape -
		// see LAYER_UI_CONFIG[type].autoOpenDesignDrawerOnCreate).
		if (this.editor.mobileManager && this.editor.mobileManager.isMobile && CONFIG.ui.mobile.openDrawOnLayerAdd) {
			if (cfg.autoOpenDesignDrawerOnCreate) {
				this.editor.mobileManager.openDrawer('design');
			}
		}

		this.renderLayersList();
		this.editor.saveState();
		this.editor.updateActionButtons();

		if (type === LayerType.TEXT_GLITTER) {
			if (!this.editor.mobileManager?.isMobile) {
				requestAnimationFrame(() => {
					this.editor.textGlitterManager?.focusTextInput(true);
				});
			}
		}

		this.editor.updateStatus(cfg.addedStatusMessage || 'New layer added');
		return layer;
	}


	deleteLayer(layerId, options = {}) {
		this.deleteLayers([layerId], options);
	}

	toggleLayerVisibility(layerId) {
		const layer = this.getLayerById(layerId);
		if (!layer) return;

		layer.visible = !layer.visible;

		// Keep the live sticker DOM in sync with the layer visibility toggle.
		const manager = getLayerManagerForType(this.editor, layer.type);
		const element = manager?.layerElements?.get(layerId);
		if (element) {
			element.style.display = layer.visible ? 'block' : 'none';
		}

		this.renderLayersList();
		this.editor.saveState();
		this.editor.updatePreview();
		this.editor.updateStatus(`${layer.visible ? 'Shown' : 'Hidden'}: ${layer.name || LAYER_UI_CONFIG[layer.type]?.displayName || 'Layer'}`);
	}

	toggleLayerLock(layerId) {
		const layer = this.getLayerById(layerId);
		if (!layer || layer.type === LayerType.BASE_IMAGE) return;
		layer.locked = !layer.locked;
		if (layer.locked && this.selectedLayerIds.size > 1) {
			const remaining = [...this.selectedLayerIds].filter((id) => id !== layer.id);
			this.setSelection(remaining, { activeLayerId: remaining.at(-1) || null });
		}
		if (layer.locked && this.activeLayerId === layer.id) {
			this.editor.textGlitterManager?.closePickerSession();
			this.editor.shapeGlitterManager?.closePickerSession();
			this.editor.glitterManager?.closePickerSession?.();
			this.editor.stickerManager?.closePickerSession?.();
			this.editor.maskEditor?.releaseBrushTool?.({ commitStroke: true });
			if (this.editor.currentTool === ToolType.COLOR_PICKER) this.editor.setTool(ToolType.SELECT);
		}
		this.renderLayersList();
		this.editor.syncTransformHandlesForActiveLayer?.();
		this.editor.updateSidePanelUI(this.getActiveLayer());
		this.editor.updateActionButtons();
		this.editor.saveState();
		this.editor.updateStatus(`${layer.locked ? 'Locked' : 'Unlocked'}: ${layer.name || LAYER_UI_CONFIG[layer.type]?.displayName || 'Layer'}`);
	}

	// ===== LAYER SELECTION =====

	isLayerMultiSelectable(layer) {
		return Boolean(layer && isTransformableLayerType(layer.type) && !layer.locked);
	}

	isLayerSelected(layerId) {
		return this.selectedLayerIds.has(layerId);
	}

	getSelectedLayers(options = {}) {
		const movableOnly = options.movableOnly === true;
		return this.layers.filter((layer) => {
			if (!this.selectedLayerIds.has(layer.id)) return false;
			return !movableOnly || this.isLayerMultiSelectable(layer);
		});
	}

	getMultiSelectedMovableLayers() {
		return this.getSelectedLayers({ movableOnly: true });
	}

	hasMultiSelection() {
		return this.getMultiSelectedMovableLayers().length > 1;
	}

	clearSelection() {
		this.setSelection([]);
	}

	focusLayerInSelection(layerId) {
		if (!this.selectedLayerIds.has(layerId)) {
			this.setActiveLayer(layerId);
			return;
		}

		this.setSelection([...this.selectedLayerIds], {
			activeLayerId: layerId
		});
	}

	toggleLayerSelection(layerId) {
		const layer = this.getLayerById(layerId);
		if (!this.isLayerMultiSelectable(layer)) {
			this.setActiveLayer(layerId);
			return;
		}

		const nextIds = new Set(this.selectedLayerIds);
		if (nextIds.has(layerId)) {
			nextIds.delete(layerId);
			const remaining = [...nextIds];
			const nextActiveId = remaining.includes(this.activeLayerId)
				? this.activeLayerId
				: (remaining[remaining.length - 1] || null);
			this.setSelection(remaining, { activeLayerId: nextActiveId });
			return;
		}

		nextIds.add(layerId);
		this.setSelection([...nextIds], { activeLayerId: layerId });
	}

	selectLayerRange(layerId, options = {}) {
		const targetIndex = this.layers.findIndex((layer) => layer.id === layerId);
		const anchorIndex = this.layers.findIndex((layer) => layer.id === this.activeLayerId);
		if (targetIndex < 0 || anchorIndex < 0) {
			this.setActiveLayer(layerId);
			return;
		}

		const start = Math.min(anchorIndex, targetIndex);
		const end = Math.max(anchorIndex, targetIndex);
		const rangeIds = this.layers
			.slice(start, end + 1)
			.filter((layer) => this.isLayerMultiSelectable(layer))
			.map((layer) => layer.id);
		const nextIds = options.additive
			? [...new Set([...this.selectedLayerIds, ...rangeIds])]
			: rangeIds;
		this.setSelection(nextIds, { activeLayerId: layerId });
	}

	restoreSelectionState(activeLayerId, selectedLayerIds = null) {
		const fallbackIds = activeLayerId ? [activeLayerId] : [];
		this.setSelection(selectedLayerIds ?? fallbackIds, { activeLayerId });
	}

	setSelection(layerIds, options = {}) {
		const requestedIds = Array.isArray(layerIds) ? layerIds : [];
		let normalized = requestedIds.filter((layerId, index) => {
			if (!this.layers.some((layer) => layer.id === layerId)) return false;
			return requestedIds.indexOf(layerId) === index;
		});

		if (normalized.length > 1) {
			normalized = normalized.filter((layerId) => this.isLayerMultiSelectable(this.getLayerById(layerId)));
		}

		let nextActiveId = options.activeLayerId ?? this.activeLayerId;
		if (normalized.length === 0) {
			nextActiveId = null;
		} else if (!normalized.includes(nextActiveId)) {
			nextActiveId = normalized[normalized.length - 1];
		}

		const sameActive = this.activeLayerId === nextActiveId;
		const currentIds = [...this.selectedLayerIds];
		const sameSelection = currentIds.length === normalized.length
			&& currentIds.every((layerId) => normalized.includes(layerId));
		if (sameActive && sameSelection) {
			return;
		}

		this.activeLayerId = nextActiveId;
		this.selectedLayerIds = new Set(normalized);
		this.selectionCycleState = null;

		// D-1c: any layer change ends an armed gallery picker session. The
		// session is layer-bound, so leaving its layer must return the gallery
		// to browse mode (a click applies to the new active layer's own fill).
		this.editor.textGlitterManager?.closePickerSession();
		this.editor.shapeGlitterManager?.closePickerSession();
		this.editor.glitterManager?.closePickerSession?.();
		this.editor.stickerManager?.closePickerSession?.();
		this.editor.baseBackgroundManager?.closePickerSession?.();
		this.editor.maskEditor?.handleLayerChange(this.activeLayerId);
		this.updateActiveLayerListSelection();
		this.updateMobileLayersSwatch();
		this.updateBottomBarButtons();

		const activeLayer = this.getActiveLayer();
		const selectedCount = this.selectedLayerIds.size;

		this.editor.updateContextToolbars();
		this.updateSelectionHighlight();
		this.editor.updatePreview();
		this.editor.syncTransformHandlesForActiveLayer?.();
		this.editor.updateSidePanelUI(activeLayer);

		if (selectedCount === 1 && activeLayer) {
			const config = LAYER_UI_CONFIG[activeLayer.type];
			if (config?.onActivate) {
				config.onActivate(this.editor, activeLayer);
			}
		} else if (selectedCount === 0) {
			this.editor.showLayerSettingsEmptyState();
			this.editor.showGlitterSettingsEmptyState();
			this.editor.showStickerSettingsEmptyState();
		}

		if (this.activeLayerId) {
			document.body.classList.add('has-active-layer');
		} else {
			document.body.classList.remove('has-active-layer');
		}

		window.dispatchEvent(new CustomEvent('layerChanged', {
			detail: {
				activeLayerId: this.activeLayerId,
				selectedLayerIds: [...this.selectedLayerIds]
			}
		}));

		if (selectedCount > 1) {
			this.editor.updateStatus(`${selectedCount} layers selected`);
		} else if (activeLayer?.type === LayerType.STICKER) {
			this.editor.updateStatus(`Selected sticker: ${activeLayer.name || 'Sticker'}`);
		} else if (activeLayer?.type === LayerType.TEXT_GLITTER) {
			this.editor.updateStatus(`Selected text: ${activeLayer.name || 'Text'}`);
		} else if (activeLayer?.type === LayerType.SHAPE) {
			this.editor.updateStatus(`Selected shape: ${activeLayer.name || 'Shape'}`);
		}

		this.editor.currentHintDismissed = false;
		this.editor.updateHelpfulMessage();
	}

	updateSelectionHighlight() {
		// Clear ALL previous selection highlights
		const previewContainer = this.editor.previewCanvas?.parentElement;
		if (previewContainer) {
			previewContainer.querySelectorAll('.selected').forEach(el => {
				el.classList.remove('selected');
			});
		}

		this.getSelectedLayers().forEach((layer) => {
			if (layer.type === LayerType.BASE_IMAGE && this.editor.previewCanvas) {
				this.editor.previewCanvas.classList.add('selected');
				return;
			}

			const manager = getLayerManagerForType(this.editor, layer.type);
			const element = manager?.layerElements?.get(layer.id);
			if (element) {
				element.classList.add('selected');
			}
		});
	}


	setActiveLayer(layerId) {
		if (!layerId) {
			this.clearSelection();
			return;
		}

		this.setSelection([layerId], { activeLayerId: layerId });
	}


	getActiveLayer() {
		return this.getLayerById(this.activeLayerId);
	}

	getLayerById(layerId) {
		if (layerId == null) return null;
		return this.layers.find((layer) => layer.id === layerId) || null;
	}

	// ===== LAYER NAVIGATION =====

	goToGlitter(layerId) {
		const layer = this.getLayerById(layerId);
		if (!layer || LAYER_UI_CONFIG[layer.type]?.goTo !== 'glitter') return;

		// Select this layer
		this.setActiveLayer(layerId);

		// On mobile, open the design drawer
		if (this.editor.mobileManager && this.editor.mobileManager.isMobile) {
			this.editor.mobileManager.openDrawer('design');
		}

		// Scroll to the glitter in the picker
		if (layer.selectedGlitterId !== undefined) {
			this.editor.glitterManager.scrollToContent(layer.selectedGlitterId);
		}
	}

	goToSticker(layerId) {
		const layer = this.getLayerById(layerId);
		if (!layer || LAYER_UI_CONFIG[layer.type]?.goTo !== 'sticker') return;

		// Select this layer
		this.setActiveLayer(layerId);

		// On mobile, open the design drawer
		if (this.editor.mobileManager && this.editor.mobileManager.isMobile) {
			this.editor.mobileManager.openDrawer('design');
		}

		// Scroll to the sticker in the picker
		if (layer.stickerSourceId) {
			this.editor.stickerManager.scrollToContent(layer.stickerSourceId);
		}
	}

	goToLayerSource(layerId) {
		const layer = this.getLayerById(layerId);
		if (!layer) return;

		const goToTarget = LAYER_UI_CONFIG[layer.type]?.goTo;
		if (goToTarget === 'sticker') {
			this.goToSticker(layerId);
		} else if (goToTarget === 'glitter') {
			this.goToGlitter(layerId);
		}
	}



	// ===== LAYER PICKING (SELECT TOOL) =====

	// In LayerManager class

	handleLayerPick(x, y, options = {}) {
		// Prevent layer picking during touch gestures
		if (this.editor.touchGestureActive) {
			const gestureManager = this.editor.viewport?.gestureManager;
			if (gestureManager && gestureManager.pointers.size === 0) {
				gestureManager.resetGestureState();
			} else {
			dbg('🎯 LAYER PICK: Blocked - touch gesture active');
			return;
			}
		}

		// NEW: Prevent layer picking when transform handles are being interacted with
		if (this.editor.stickerManager && this.editor.stickerManager.isDraggingHandle) {
			return;
		}

		const hitStack = this.getLayersAtPoint(x, y, { includeBase: true, excludeLocked: true });
		const layer = options.cycleDeep
			? this.getNextLayerFromHitStack(hitStack, { currentLayerId: this.activeLayerId })
			: (hitStack[0] || null);
		if (layer) {
			if (options.toggleSelection && this.isLayerMultiSelectable(layer)) {
				this.toggleLayerSelection(layer.id);
				return;
			}

			this.setActiveLayer(layer.id);

			let name = 'Layer';
			if (layer.type === LayerType.STICKER) name = layer.name;
			else if (layer.type === LayerType.TEXT_GLITTER) name = layer.name || 'Text';
			else if (layer.type === LayerType.BASE_IMAGE) name = "Base Image";
			else if (layer.type === LayerType.SHAPE) name = layer.name || 'Shape';
			else if (layer.type === LayerType.GLITTER_FILL) {
				const fillMode = layer.fill?.mode || 'glitter';
				const glitter = fillMode === 'glitter'
					? this.editor.glitterManager.getItemById(layer.selectedGlitterId)
					: null;
				name = layer.name || glitter?.name || `${panelCap(fillMode)} Fill`;
			}

			this.editor.updateStatus(`Selected: ${name}`);

			const flash = document.createElement('div');
			flash.className = 'layer-pick-flash';
			flash.style.left = (x / this.editor.previewCanvas.width * 100) + '%';
			flash.style.top = (y / this.editor.previewCanvas.height * 100) + '%';
			this.editor.previewWrapper.appendChild(flash);
			setTimeout(() => flash.remove(), 300);

			return;
		}

		// If loop finishes with no hits
		this.clearSelection();
		this.editor.updateStatus('No layer at this location');
	}

	getLayersAtPoint(x, y, options = {}) {
		const includeBase = options.includeBase !== false;
		const movableOnly = options.movableOnly === true;
		const excludeLocked = options.excludeLocked === true;
		const hits = [];

		for (let i = this.layers.length - 1; i >= 0; i--) {
			const layer = this.layers[i];
			if (!layer.visible) continue;
			if (excludeLocked && layer.locked && layer.type !== LayerType.BASE_IMAGE) continue;
			if (movableOnly && !this.isLayerMultiSelectable(layer)) continue;

			let isHit = false;
			const hitTestMethod = LAYER_UI_CONFIG[layer.type]?.hitTestMethod;

			if (hitTestMethod) {
				isHit = this[hitTestMethod](layer, x, y);
			} else if (layer.type === LayerType.GLITTER_FILL) {
				isHit = this.isPixelInLayerSelection(layer, x, y);
			} else if (includeBase && layer.type === LayerType.BASE_IMAGE && this.editor.originalImage) {
				isHit = true;
			}

			if (isHit) {
				hits.push(layer);
			}
		}

		return hits;
	}

	getTopVisibleLayerAtPoint(x, y, options = {}) {
		return this.getLayersAtPoint(x, y, options)[0] || null;
	}

	getNextLayerFromHitStack(hitStack, options = {}) {
		if (!Array.isArray(hitStack) || hitStack.length === 0) {
			return null;
		}

		const currentLayerId = options.currentLayerId ?? null;
		const currentIndex = hitStack.findIndex((layer) => layer.id === currentLayerId);
		if (currentIndex === -1) {
			return hitStack[0];
		}

		return hitStack[(currentIndex + 1) % hitStack.length];
	}

	isPointInTransformBox(transform, width, height, clickX, clickY) {
		let dx = clickX - transform.position.x;
		let dy = clickY - transform.position.y;

		const angleRad = -transform.rotation * (Math.PI / 180);
		const rx = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
		const ry = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);

		const sx = transform.scale.x / 100;
		const sy = transform.scale.y / 100;
		const lx = rx / sx;
		const ly = ry / sy;

		const halfW = width / 2;
		const halfH = height / 2;

		return (lx >= -halfW && lx <= halfW && ly >= -halfH && ly <= halfH);
	}

	// Calculates if click (x,y) is inside a rotated/scaled sticker
	isPointInSticker(layer, clickX, clickY) {
		if (layer.stickerData.isEmpty || !layer.stickerData.url) return false;

		const t = getLayerTransform(layer);
		const w = layer.stickerData.width;
		const h = layer.stickerData.height;

		return this.isPointInTransformBox(t, w, h, clickX, clickY);
	}

	isPointInText(layer, clickX, clickY) {
		if (!layer.textData?.text?.trim()) return false;

		const t = getLayerTransform(layer);

		// Hit-test the visible frame (box rect / ink bounds), not the padded mask canvas
		const frame = this.editor.textGlitterManager?.getTextFrame?.(layer);
		if (!frame) {
			return this.isPointInTransformBox(t, layer.textData.width, layer.textData.height, clickX, clickY);
		}

		const rotationRad = (t.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);
		const offsetX = frame.offsetX * (t.scale.x / 100);
		const offsetY = frame.offsetY * (t.scale.y / 100);
		const frameCenter = {
			x: t.position.x + offsetX * cos - offsetY * sin,
			y: t.position.y + offsetX * sin + offsetY * cos
		};

		return this.isPointInTransformBox(
			{ ...t, position: frameCenter },
			frame.width,
			frame.height,
			clickX,
			clickY
		);
	}

	isPointInShape(layer, clickX, clickY) {
		if (layer.type !== LayerType.SHAPE) return false;
		const t = getLayerTransform(layer);
		const measurement = this.editor.shapeGlitterManager?.getMeasurementEntry(layer);
		const w = measurement?.width || layer.shapeData.renderWidth || layer.shapeData.width;
		const h = measurement?.height || layer.shapeData.renderHeight || layer.shapeData.height;
		return this.isPointInTransformBox(t, w, h, clickX, clickY);
	}

	isPixelInLayerSelection(layer, x, y) {
		if (
			!this.editor.originalCanvas
			|| layer?.type !== LayerType.GLITTER_FILL
			|| layer.fill?.mode === 'none'
			|| (layer.settings?.opacity ?? 100) <= 0
		) {
			return false;
		}

		const canvasX = Math.floor(x);
		const canvasY = Math.floor(y);
		if (canvasX < 0 || canvasY < 0 || canvasX >= this.editor.originalCanvas.width || canvasY >= this.editor.originalCanvas.height) {
			return false;
		}

		const pixelIndex = canvasY * this.editor.originalCanvas.width + canvasX;
		return this.editor.maskCompositor.getMaskData(layer)[pixelIndex] > 0;
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
		const mobileAddLayerBtn = document.getElementById('mobileAddLayerBtn');
		[addLayerBtn, mobileAddLayerBtn].forEach((button) => {
			if (button) button.disabled = this.layers.length >= CONFIG.app.limits.maxLayers;
		});

		// Update mobile swatch
		this.updateMobileLayersSwatch();

		// Update bottom bar buttons
		this.updateBottomBarButtons();

	}

	updateActiveLayerListSelection() {
		if (!this.layersListContainer) return;

		this.layersListContainer.querySelectorAll('.layer-item').forEach(item => {
			item.classList.remove('active', 'selected');
		});

		this.selectedLayerIds.forEach((layerId) => {
			const item = this.layersListContainer.querySelector(`[data-layer-id="${layerId}"]`);
			if (item) {
				item.classList.add('selected');
			}
		});

		if (this.activeLayerId) {
			const activeItem = this.layersListContainer.querySelector(`[data-layer-id="${this.activeLayerId}"]`);
			if (activeItem) {
				activeItem.classList.add('active');
			}
		}
	}


	updateBottomBarButtons() {
		const selectedLayers = this.getSelectedLayers();
		const canAddLayers = this.layers.length < CONFIG.app.limits.maxLayers;
		const canInteractWithSelected = selectedLayers.length > 0
			&& selectedLayers.every((layer) => layer.type !== LayerType.BASE_IMAGE && !layer.locked);
		const hasSingleSelection = selectedLayers.length === 1;
		const movableSelectionCount = this.getMultiSelectedMovableLayers().length;

		// Add buttons - only check max layers
		const addGlitterBtn = document.getElementById('layersBarAddGlitter');
		const addStickerBtn = document.getElementById('layersBarAddSticker');
		const addTextBtn = document.getElementById('layersBarAddText');
		if (addGlitterBtn) addGlitterBtn.disabled = !canAddLayers;
		if (addStickerBtn) addStickerBtn.disabled = !canAddLayers;
		if (addTextBtn) addTextBtn.disabled = !canAddLayers;

		// Buttons requiring selection (but not base)
		const goToBtn = document.getElementById('layersBarGoToSelected');
		const cloneBtn = document.getElementById('layersBarCloneSelected');
		const deleteBtn = document.getElementById('layersBarDeleteSelected');

		if (goToBtn) goToBtn.disabled = !hasSingleSelection || !canInteractWithSelected;
		if (cloneBtn) cloneBtn.disabled = !canInteractWithSelected || !canAddLayers;
		if (deleteBtn) deleteBtn.disabled = !canInteractWithSelected;

		if (cloneBtn) {
			cloneBtn.title = movableSelectionCount > 1 ? 'Clone selected layers' : 'Clone selected layer';
		}
		if (deleteBtn) {
			deleteBtn.title = movableSelectionCount > 1 ? 'Delete selected layers' : 'Delete selected layer';
		}
	}

	cloneLayer(layerId, options = {}) {
		const positionOffset = options.positionOffset || { x: 20, y: 20 };
		const sourceLayer = this.getLayerById(layerId);
		if (!sourceLayer) return null;

		// Can't clone locked layers (base image)
		if (sourceLayer.locked) {
			this.editor.showError('Cannot clone locked layer');
			return null;
		}

		// Check max layers
		if (this.layers.length >= CONFIG.app.limits.maxLayers) {
			this.editor.showError(`Maximum ${CONFIG.app.limits.maxLayers} layers reached`);
			return null;
		}

		// Create new layer based on type
		let clonedLayer;

		if (sourceLayer.type === LayerType.STICKER) {
			const sourceTransform = getLayerTransform(sourceLayer);
			const clonedTransform = cloneTransform(sourceTransform, {
				position: {
					x: sourceTransform.position.x + positionOffset.x,
					y: sourceTransform.position.y + positionOffset.y
				}
			});
			// Clone sticker layer - deep copy the stickerData structure
			clonedLayer = {
				id: this.generateLayerId(),
				type: LayerType.STICKER,
				name: sourceLayer.name, // COPY THE NAME
				visible: sourceLayer.visible,
				locked: false,
				stickerSourceId: sourceLayer.stickerSourceId, // Make sure this is copied!
				transform: clonedTransform,
				stickerData: {
					url: sourceLayer.stickerData.url,
					name: sourceLayer.stickerData.name,
					source: sourceLayer.stickerData.source,
					width: sourceLayer.stickerData.width,
					height: sourceLayer.stickerData.height,
					isEmpty: sourceLayer.stickerData.isEmpty,
					isAnimated: sourceLayer.stickerData.isAnimated,
					// Never share the frames object with the source layer — the exporter
					// no longer mutates shared frame data, and the clone reloads
					// animation data on demand so each layer keeps its own frame cache.
					frames: null,
					transform: clonedTransform
					// Don't copy element - it will be created fresh
				}
			};

			// Clone the DOM element via stickerManager
			this.editor.stickerManager.cloneStickerElement(sourceLayer, clonedLayer);

		} else if (sourceLayer.type === LayerType.TEXT_GLITTER) {
			clonedLayer = {
				id: this.generateLayerId(),
				type: LayerType.TEXT_GLITTER,
				name: sourceLayer.name,
				visible: sourceLayer.visible,
				locked: false,
				selectedGlitterId: sourceLayer.selectedGlitterId,
				settings: { ...sourceLayer.settings },
				textData: JSON.parse(JSON.stringify(sourceLayer.textData))
			};
			const transform = getLayerTransform(clonedLayer);
			transform.position.x += positionOffset.x;
			transform.position.y += positionOffset.y;
		} else if (sourceLayer.type === LayerType.SHAPE) {
			clonedLayer = {
				id: this.generateLayerId(),
				type: LayerType.SHAPE,
				name: sourceLayer.name,
				visible: sourceLayer.visible,
				locked: false,
				selectedGlitterId: sourceLayer.selectedGlitterId,
				settings: { ...sourceLayer.settings },
				shapeData: JSON.parse(JSON.stringify(sourceLayer.shapeData))
			};
			// Nudge so the copy is visible, mirroring the other clone paths' intent.
			const transform = getLayerTransform(clonedLayer);
			transform.position.x += positionOffset.x;
			transform.position.y += positionOffset.y;
		} else {
			// Clone fill layer
			clonedLayer = {
				id: this.generateLayerId(),
				type: LayerType.GLITTER_FILL,
				name: sourceLayer.name,
				visible: sourceLayer.visible,
				locked: false,
				maskVersion: 0,
				maskHasContent: false,
				selections: sourceLayer.selections.map(sel => ({ ...sel })),
				selectedGlitterId: sourceLayer.selectedGlitterId,
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

			this.editor.glitterManager.clonePaintData(sourceLayer, clonedLayer);
		}

		// Find original layer index and insert clone right after it
		// (Higher index = visually above in the stack)
		const sourceIndex = this.layers.findIndex(l => l.id === layerId);
		this.layers.splice(sourceIndex + 1, 0, clonedLayer);
		if (sourceLayer.type === LayerType.TEXT_GLITTER || sourceLayer.type === LayerType.SHAPE) {
			this.renderClonedLayerPreview(clonedLayer);
		}

		// Make the clone active and re-render
		if (!options.skipSelection) this.setActiveLayer(clonedLayer.id);
		this.renderLayersList();
		this.reorderLayers();

		if (!options.skipHistory) this.editor.saveState();
		this.editor.updateActionButtons();

		return clonedLayer;
	}

	buildClonedLayer(sourceLayer, options = {}) {
		const positionOffset = options.positionOffset || { x: 20, y: 20 };
		if (!sourceLayer) return null;
		if (sourceLayer.locked) {
			this.editor.showError('Cannot clone locked layer');
			return null;
		}

		if (sourceLayer.type === LayerType.STICKER) {
			const sourceTransform = getLayerTransform(sourceLayer);
			const clonedTransform = cloneTransform(sourceTransform, {
				position: {
					x: sourceTransform.position.x + positionOffset.x,
					y: sourceTransform.position.y + positionOffset.y
				}
			});

			return {
				id: this.generateLayerId(),
				type: LayerType.STICKER,
				name: sourceLayer.name,
				visible: sourceLayer.visible,
				locked: false,
				stickerSourceId: sourceLayer.stickerSourceId,
				transform: clonedTransform,
				stickerData: {
					url: sourceLayer.stickerData.url,
					name: sourceLayer.stickerData.name,
					source: sourceLayer.stickerData.source,
					width: sourceLayer.stickerData.width,
					height: sourceLayer.stickerData.height,
					isEmpty: sourceLayer.stickerData.isEmpty,
					isAnimated: sourceLayer.stickerData.isAnimated,
					frames: null,
					transform: clonedTransform
				}
			};
		}

		if (sourceLayer.type === LayerType.TEXT_GLITTER) {
			const clonedLayer = {
				id: this.generateLayerId(),
				type: LayerType.TEXT_GLITTER,
				name: sourceLayer.name,
				visible: sourceLayer.visible,
				locked: false,
				selectedGlitterId: sourceLayer.selectedGlitterId,
				settings: { ...sourceLayer.settings },
				textData: JSON.parse(JSON.stringify(sourceLayer.textData))
			};
			const transform = getLayerTransform(clonedLayer);
			transform.position.x += positionOffset.x;
			transform.position.y += positionOffset.y;
			return clonedLayer;
		}

		if (sourceLayer.type === LayerType.SHAPE) {
			const clonedLayer = {
				id: this.generateLayerId(),
				type: LayerType.SHAPE,
				name: sourceLayer.name,
				visible: sourceLayer.visible,
				locked: false,
				selectedGlitterId: sourceLayer.selectedGlitterId,
				settings: { ...sourceLayer.settings },
				shapeData: JSON.parse(JSON.stringify(sourceLayer.shapeData))
			};
			const transform = getLayerTransform(clonedLayer);
			transform.position.x += positionOffset.x;
			transform.position.y += positionOffset.y;
			return clonedLayer;
		}

		const clonedLayer = {
			id: this.generateLayerId(),
			type: LayerType.GLITTER_FILL,
			name: sourceLayer.name,
			visible: sourceLayer.visible,
			locked: false,
			maskVersion: 0,
			maskHasContent: false,
			selections: sourceLayer.selections.map((sel) => ({ ...sel })),
			selectedGlitterId: sourceLayer.selectedGlitterId,
			settings: { ...sourceLayer.settings }
		};

		this.editor.glitterManager.clonePaintData(sourceLayer, clonedLayer);
		return clonedLayer;
	}

	renderClonedLayerPreview(layer) {
		if (!layer) return;

		if (layer.type === LayerType.STICKER) {
			this.editor.stickerManager?.renderLayer(layer);
			return;
		}

		if (layer.type === LayerType.TEXT_GLITTER) {
			this.editor.textGlitterManager?.renderLayer(layer);
			return;
		}

		if (layer.type === LayerType.SHAPE) {
			this.editor.shapeGlitterManager?.renderLayer(layer);
			return;
		}

		if (layer.type === LayerType.GLITTER_FILL) {
			this.editor.glitterManager?.renderLayer(
				layer,
				this.editor.previewCanvas?.width,
				this.editor.previewCanvas?.height
			);
		}
	}

	cloneLayers(layerIds, options = {}) {
		const uniqueIds = [...new Set(layerIds)].filter((layerId) => this.layers.some((layer) => layer.id === layerId));
		if (!uniqueIds.length) return null;
		if (this.layers.length + uniqueIds.length > CONFIG.app.limits.maxLayers) {
			this.editor.showError(`Maximum ${CONFIG.app.limits.maxLayers} layers reached`);
			return null;
		}

		const clones = [];
		this.layers
			.filter((layer) => uniqueIds.includes(layer.id))
			.forEach((sourceLayer) => {
				const clonedLayer = this.buildClonedLayer(sourceLayer, options);
				if (!clonedLayer) return;
				const sourceIndex = this.layers.findIndex((layer) => layer.id === sourceLayer.id);
				this.layers.splice(sourceIndex + 1, 0, clonedLayer);
				clones.push(clonedLayer);
			});

		if (!clones.length) return null;

		clones.forEach((layer) => {
			this.renderClonedLayerPreview(layer);
		});

		if (!options.skipSelection) {
			this.setSelection(clones.map((layer) => layer.id), {
				activeLayerId: clones[clones.length - 1].id
			});
		}
		this.renderLayersList();
		this.reorderLayers();
		this.editor.updatePreview();
		if (!options.skipHistory) this.editor.saveState();
		this.editor.updateActionButtons();

		return clones.length === 1 ? clones[0] : clones;
	}

	deleteLayers(layerIds, options = {}) {
		const uniqueIds = [...new Set(layerIds)].filter((layerId) => this.layers.some((layer) => layer.id === layerId));
		if (!uniqueIds.length) return false;
		if (this.layers.length - uniqueIds.length < 1) {
			this.editor.showError('Cannot delete the last layer');
			return false;
		}

		const removableLayers = uniqueIds
			.map((layerId) => this.getLayerById(layerId))
			.filter(Boolean);

		if (removableLayers.some((layer) => layer.locked)) {
			this.editor.showError('Cannot delete locked layer');
			return false;
		}

		const fallbackIndex = Math.max(0, Math.min(
			...removableLayers.map((layer) => this.layers.findIndex((entry) => entry.id === layer.id))
		));

		if (this.editor.currentTool === ToolType.BRUSH) {
			removableLayers.forEach((layer) => {
				this.editor.maskEditor?.handleLayerDeleted(layer.id);
			});
		}

		removableLayers.forEach((layer) => {
			const manager = getLayerManagerForType(this.editor, layer.type);
			if (manager?.releaseLayerResources) {
				manager.releaseLayerResources(layer);
			} else if (manager?.removeLayerElement) {
				manager.removeLayerElement(layer.id);
			}
		});

		this.layers = this.layers.filter((layer) => !uniqueIds.includes(layer.id));
		const nextLayer = this.layers[Math.min(fallbackIndex, this.layers.length - 1)] || null;
		this.setSelection(nextLayer ? [nextLayer.id] : [], {
			activeLayerId: nextLayer?.id || null
		});
		this.renderLayersList();
		if (!options.skipHistory) this.editor.saveState();
		this.editor.updatePreview();
		this.editor.updateActionButtons();
		if (!options.silent) this.editor.updateStatus(uniqueIds.length > 1 ? 'Layers deleted' : 'Layer deleted');
		return true;
	}
	createLayerElement(layer) {
		const layerEl = document.createElement('div');
		layerEl.className = 'layer-item';
		layerEl.dataset.layerId = layer.id;
		layerEl.classList.toggle('is-hidden', !layer.visible);
		layerEl.classList.toggle('is-locked', Boolean(layer.locked));

		// Only allow dragging if not locked
		if (!layer.locked) {
			layerEl.draggable = true;
		}

		if (this.isLayerSelected(layer.id)) {
			layerEl.classList.add('selected');
		}
		if (layer.id === this.activeLayerId) {
			layerEl.classList.add('active');
		}

		// 1. Drag Handle (icon shown active only for unlocked layers)
		const dragHandle = document.createElement('div');
		dragHandle.className = 'layer-drag-handle';
		dragHandle.innerHTML = `
				<div class="icon icon-wrapper ${!layer.locked ? 'active' : ''}">
					<svg class="icon">
						<use href="#icon-grip-vertical"></use>
					</svg>
				</div>
		`;

		// 2. Swatch (Thumbnail)
		const swatch = document.createElement('div');
		swatch.className = 'layer-swatch';
		this.renderLayerSwatch(swatch, layer);

		// Double-click swatch behavior
		swatch.addEventListener('click', (e) => {
			e.stopPropagation();
			this.goToLayerSource(layer.id);
		});



		// 3. Info (Name & Type)
		const info = document.createElement('div');
		info.className = 'layer-info';

		const nameText = document.createElement('div');
		nameText.className = 'layer-name';
		nameText.title = 'Double-click to rename';
		nameText.addEventListener('dblclick', (event) => {
			event.stopPropagation();
			if (layer.type === LayerType.BASE_IMAGE || layer.locked) return;
			const input = document.createElement('input');
			input.className = 'layer-name-input';
			input.type = 'text';
			input.maxLength = 80;
			input.value = layer.name || nameText.textContent;
			nameText.replaceWith(input);
			input.focus();
			input.select();
			let finished = false;
			const finish = (commit) => {
				if (finished) return;
				finished = true;
				const nextName = input.value.trim();
				if (commit && nextName && nextName !== layer.name) {
					layer.name = nextName;
					this.editor.saveState();
				}
				this.renderLayersList();
			};
			input.addEventListener('blur', () => finish(true));
			input.addEventListener('keydown', (keyEvent) => {
				if (keyEvent.key === 'Enter') { keyEvent.preventDefault(); input.blur(); }
				if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); finish(false); }
			});
		});

		const metaRow = document.createElement('div');
		metaRow.className = 'layer-meta';

		const typeText = document.createElement('div');
		typeText.className = 'layer-type';
		const getFillDisplay = (paint, glitterId) => {
			const mode = paint?.mode || 'glitter';
			const modeLabel = mode === 'none' ? 'No' : panelCap(mode);
			const glitter = mode === 'glitter'
				? this.editor.glitterManager.getItemById(glitterId)
				: null;
			const formatColor = (color) => /^#[0-9a-f]{6}$/i.test(color || '') ? color.toUpperCase() : null;
			let name = null;
			if (mode === 'solid') {
				name = formatColor(paint?.color) || 'Solid Fill';
			} else if (mode === 'gradient') {
				const stops = normalizeEffectGradient(paint?.gradient).stops;
				const first = formatColor(stops[0]?.color);
				const last = formatColor(stops.at(-1)?.color);
				name = first && last ? `${first} → ${last}` : 'Gradient Fill';
			} else if (mode === 'none') {
				name = 'Transparent';
			}
			return { mode, modeLabel, glitter, name };
		};

		switch (layer.type) {
			case LayerType.STICKER: {
				const sticker = this.editor.stickerManager.getItemById(layer.stickerSourceId); // Changed this line
				nameText.textContent = layer.name || 'Sticker';
				typeText.textContent = sticker?.category ? `Sticker / ${sticker.category}` : 'Sticker';
				break;
			}
			case LayerType.GLITTER_FILL: {
				const fill = getFillDisplay(layer.fill, layer.selectedGlitterId);
				nameText.textContent = layer.name
					|| fill.glitter?.name
					|| fill.name
					|| `${fill.modeLabel} Fill`;
				typeText.textContent = `Fill / ${fill.mode === 'none' ? 'None' : fill.modeLabel}`;
				break;
			}
			case LayerType.TEXT_GLITTER: {
				const fill = getFillDisplay(layer.textData?.fill, layer.selectedGlitterId);
				nameText.textContent = layer.name || 'Text';
				typeText.textContent = `Text / ${fill.modeLabel} Fill`;
				break;
			}
			case LayerType.SHAPE: {
				const fill = getFillDisplay(layer.shapeData?.fill, layer.selectedGlitterId);
				nameText.textContent = layer.name || 'Shape';
				typeText.textContent = `Shape / ${fill.modeLabel} Fill`;
				break;
			}
			case LayerType.BASE_IMAGE:
				nameText.textContent = 'Base Image';
				typeText.textContent = `Fixed Background / ${layer.background?.mode === 'none' ? 'Transparent' : panelCap(layer.background?.mode || 'image')}`;
				break;
			default:
				nameText.textContent = 'Unknown Layer';
				typeText.textContent = 'Unknown';
		}

		metaRow.appendChild(typeText);

		LAYER_BADGES.forEach((badgeConfig) => {
			const state = badgeConfig.getState?.(layer);
			if (!state) {
				return;
			}

			const badge = document.createElement('span');
			badge.className = 'layer-badge';
			badge.title = state.title;
			badge.setAttribute('aria-label', state.title);

			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.classList.add('icon');
			const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
			use.setAttribute('href', `#icon-${badgeConfig.icon}`);
			svg.appendChild(use);
			badge.appendChild(svg);
			metaRow.appendChild(badge);
		});

		info.append(nameText, metaRow);




		// 4. Actions
		const actions = document.createElement('div');
		actions.className = 'layer-actions';

		// Visibility is always first and uses a distinct state icon.
		const visBtn = this.createIconButton({
			className: 'layer-action-btn visibility' + (!layer.visible ? ' hidden' : ''),
			title: layer.visible ? 'Hide layer' : 'Show layer',
			iconType: layer.visible ? 'eye' : 'eye-slash',
			onClick: (e) => {
				e.stopPropagation();
				this.toggleLayerVisibility(layer.id);
			}
		});
		actions.appendChild(visBtn);

		const isBaseLayer = layer.type === LayerType.BASE_IMAGE;
		const lockBtn = this.createIconButton({
			className: `layer-action-btn lock${layer.locked ? ' active' : ''}${isBaseLayer ? ' permanent' : ''}`,
			title: isBaseLayer ? 'Fixed background — editable, but cannot be moved, reordered, or deleted' : (layer.locked ? 'Unlock layer' : 'Lock layer'),
			iconType: layer.locked ? 'lock' : 'unlock',
			onClick: (e) => {
				e.stopPropagation();
				if (isBaseLayer) this.editor.updateStatus('The fixed background can be edited, but not moved or deleted');
				else this.toggleLayerLock(layer.id);
			}
		});
		actions.appendChild(lockBtn);

		// Source navigation follows state controls and precedes destructive actions.
		const sourceType = LAYER_UI_CONFIG[layer.type]?.goTo;
		const arrowBtn = this.createIconButton({
			className: `layer-action-btn goto-glitter${sourceType ? '' : ' unavailable'}`,
			title: sourceType ? (sourceType === 'sticker' ? 'Show sticker in Design' : 'Show glitter in Design') : 'No source asset for this layer',
			iconType: 'chevron-right',
			disabled: !sourceType,
			onClick: (e) => {
				e.stopPropagation();
				this.goToLayerSource(layer.id);
			}
		});
		actions.appendChild(arrowBtn);

		const cannotDelete = isBaseLayer || layer.locked;
		const delBtn = this.createIconButton({
				className: `layer-action-btn delete${cannotDelete ? ' unavailable' : ''}`,
				title: isBaseLayer ? 'Base layer cannot be deleted' : (layer.locked ? 'Unlock layer to delete it' : 'Delete layer'),
				iconType: 'x-mark',
				disabled: cannotDelete,
				onClick: async (e) => {
					e.stopPropagation();
					const confirmed = await this.editor.confirmAction({
						title: 'Delete Layer',
						message: 'This layer and everything on it will be permanently removed.',
						confirmLabel: 'Delete'
					});
					if (confirmed) {
						this.deleteLayer(layer.id);
					}
				}
			});
		actions.appendChild(delBtn);

		layerEl.append(dragHandle, swatch, info, actions);
		layerEl.onclick = (event) => {
			// Dispatch custom event for mobile manager
			window.dispatchEvent(new CustomEvent('layerItemClick', {
				detail: { layerId: layer.id }
			}));

			if (event.shiftKey && this.isLayerMultiSelectable(layer)) {
				this.selectLayerRange(layer.id, { additive: event.ctrlKey || event.metaKey });
				return;
			}

			if ((event.ctrlKey || event.metaKey) && this.isLayerMultiSelectable(layer)) {
				this.toggleLayerSelection(layer.id);
				return;
			}

			this.setActiveLayer(layer.id);
		};

		// Attach Drag Events only if not locked
		// Attach Drag Events (even for locked layers, so we can drop AROUND them)
		layerEl.addEventListener('dragover', (e) => this.handleLayerDragOver(e, layer.id));
		layerEl.addEventListener('dragleave', (e) => this.handleLayerDragLeave(e));
		layerEl.addEventListener('drop', (e) => this.handleLayerDrop(e, layer.id));
		layerEl.addEventListener('dragend', (e) => this.handleLayerDragEnd(e));

		// Only attach drag START and touch/pointer reorder events if not locked
		if (!layer.locked) {
			layerEl.addEventListener('dragstart', (e) => this.handleLayerDragStart(e, layer.id));

			layerEl.addEventListener('pointerdown', (e) => this.handleLayerTouchStart(e, layer.id));
			layerEl.addEventListener('pointermove', (e) => this.handleLayerTouchMove(e));
			layerEl.addEventListener('pointerup', (e) => this.handleLayerTouchEnd(e));
			layerEl.addEventListener('pointercancel', (e) => this.handleLayerTouchCancel(e));
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

	updateBaseImageSwatchCache() {
		if (!this.editor.originalCanvas || !this.editor.originalImage) {
			this.baseImageSwatchDataUrl = '';
			return;
		}

		this.baseImageSwatchDataUrl = this.editor.originalCanvas.toDataURL();
	}

	clearBaseImageSwatchCache() {
		this.baseImageSwatchDataUrl = '';
	}

	renderLayerSwatch(swatch, layer, options = {}) {
		const compact = Boolean(options.compact);
		swatch.classList.remove('empty', 'pixelated', 'text-layer', 'sticker', 'glitter', 'baseImage');
		swatch.removeAttribute('style');
		swatch.replaceChildren();

		if (!layer) {
			swatch.classList.add('empty');
			return;
		}

		const renderPaint = (source, glitterId, colorAdjust) => {
			const mode = source?.mode || 'glitter';
			if (mode === 'solid') {
				swatch.style.backgroundColor = source?.color || '#ff66cc';
				return true;
			}
			if (mode === 'gradient') {
				swatch.style.backgroundImage = effectGradientToCss(source?.gradient);
				return true;
			}
			if (mode === 'none') return false;
			if (mode !== 'glitter') return false;
			const glitter = this.editor.glitterManager.getItemById(glitterId);
			if (!glitter) return false;
			swatch.style.backgroundImage = `url(${glitter.url})`;
			swatch.style.filter = buildCssColorFilter(colorAdjust);
			swatch.classList.add('glitter');
			if (glitter.isPixelated) swatch.classList.add('pixelated');
			return true;
		};

		if (layer.type === LayerType.STICKER) {
			swatch.classList.add('sticker');
			if (layer.stickerData?.isEmpty || !layer.stickerData?.url) {
				swatch.classList.add('empty');
				if (!compact) swatch.innerHTML = '<span>?</span>';
			} else {
				swatch.style.backgroundImage = `url(${layer.stickerData.url})`;
			}
			return;
		}

		if (layer.type === LayerType.TEXT_GLITTER) {
			if (!renderPaint(layer.textData?.fill, layer.selectedGlitterId, layer.settings?.colorAdjust)) swatch.classList.add('empty');
			swatch.classList.add('text-layer');
			if (!compact) swatch.innerHTML = '<span class="layer-swatch-text-overlay">T</span>';
			return;
		}

		if (layer.type === LayerType.SHAPE) {
			if (!renderPaint(layer.shapeData?.fill, layer.selectedGlitterId, layer.shapeData?.fill?.colorAdjust)) swatch.classList.add('empty');
			const shapeSvg = ShapeLibrary.getIconSvg(layer.shapeData?.shapeId);
			const shapeMask = `url("data:image/svg+xml;base64,${btoa(shapeSvg)}")`;
			swatch.style.maskImage = shapeMask;
			swatch.style.webkitMaskImage = shapeMask;
			swatch.style.maskRepeat = swatch.style.webkitMaskRepeat = 'no-repeat';
			swatch.style.maskPosition = swatch.style.webkitMaskPosition = 'center';
			swatch.style.maskSize = swatch.style.webkitMaskSize = '80% 80%';
			return;
		}

		if (layer.type === LayerType.BASE_IMAGE) {
			const background = layer.background || { mode: 'image' };
			if (background.mode === 'image' && this.editor.baseBackgroundManager?.hasBaseImage() && this.editor.originalImage) {
				swatch.style.backgroundImage = `url(${this.baseImageSwatchDataUrl || this.editor.originalImage.src})`;
				swatch.classList.add('baseImage');
			} else if (!renderPaint(background, layer.selectedGlitterId, background.colorAdjust)) {
				swatch.classList.add('empty');
			}
			return;
		}

		if (!renderPaint(layer.fill, layer.selectedGlitterId, layer.settings?.colorAdjust)) swatch.classList.add('empty');
	}

	updateMobileLayersSwatch() {
		const mobileLayersSwatch = document.querySelector('.mobile-layers-swatch');
		if (!mobileLayersSwatch) return;
		this.renderLayerSwatch(mobileLayersSwatch, this.getActiveLayer(), { compact: true });
	}

	// ===== DRAG AND DROP (DESKTOP) =====

	handleLayerDragStart(event, layerId) {
		// Check if layer is locked
		const layer = this.getLayerById(layerId);
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
		const scrollZone = CONFIG.layers.reorder.autoScroll.zoneSize;
		const scrollSpeed = CONFIG.layers.reorder.autoScroll.speed;

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
		if (event.pointerType !== 'touch') {
			return;
		}

		// ONLY start drag if touching the drag handle specifically
		if (!event.target.closest('.layer-drag-handle')) {
			return;
		}

		// Check if layer is locked
		const layer = this.getLayerById(layerId);
		if (layer && layer.locked) {
			return;
		}

		this.draggedLayerId = layerId;
		this.touchDragPointerId = event.pointerId;
		this.touchDragPointerElement = event.currentTarget;
		event.currentTarget.classList.add('dragging');
		event.currentTarget.setPointerCapture?.(event.pointerId);

		this.touchDragStartY = event.clientY;
		this.touchDragLastY = event.clientY;

		event.preventDefault();
		event.stopPropagation();
	}

	handleLayerTouchMove(event) {
		if (event.pointerType !== 'touch' || !this.draggedLayerId || event.pointerId !== this.touchDragPointerId) {
			return;
		}

		this.touchDragLastY = event.clientY;

		// Find which layer element we're over
		const elements = document.elementsFromPoint(event.clientX, event.clientY);

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
			const insertAbove = event.clientY < midpoint;

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
		if (event.pointerType !== 'touch' || event.pointerId !== this.touchDragPointerId) {
			return;
		}

		event.preventDefault();
		this.touchDragPointerElement?.releasePointerCapture?.(event.pointerId);

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
		this.touchDragPointerId = null;
		this.touchDragPointerElement = null;
	}

	handleLayerTouchCancel(event) {
		if (event.pointerType !== 'touch' || event.pointerId !== this.touchDragPointerId) {
			return;
		}

		event.preventDefault();
		this.touchDragPointerElement?.releasePointerCapture?.(event.pointerId);

		const draggedElement = document.querySelector(`[data-layer-id="${this.draggedLayerId}"]`);
		if (draggedElement) {
			draggedElement.classList.remove('dragging');
		}

		const insertionLine = this.layersListContainer.querySelector('.layer-insertion-line');
		insertionLine.classList.remove('visible');

		this.draggedLayerId = null;
		this.dropTargetId = null;
		this.dropInsertAbove = false;
		this.touchDragPointerId = null;
		this.touchDragPointerElement = null;
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
				element.classList.toggle('selected', this.isLayerSelected(layer.id));
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

		// Keep every transformable preview element in sync with layer order.
		const existingElements = new Map();
		container.querySelectorAll(ALL_LAYER_ELEMENT_SELECTOR).forEach(el => {
			existingElements.set(el.dataset.layerId, el);
		});

		const transformHandleNodes = Array.from(container.children).filter(el => el.classList.contains('transform-handles'));
		const layerElements = Array.from(container.children).filter(el => el.matches(ALL_LAYER_ELEMENT_SELECTOR));

		layerElements.forEach(el => el.remove());

		// Reorder them to match layers array.
		const fragment = document.createDocumentFragment();
		this.layers.forEach(layer => {
			const el = existingElements.get(layer.id);
			if (el) {
				el.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);
				fragment.appendChild(el);
			}
		});

		container.appendChild(fragment);
		transformHandleNodes.forEach(el => {
			if (el.parentNode) {
				container.appendChild(el);
			}
		});
	}
}
