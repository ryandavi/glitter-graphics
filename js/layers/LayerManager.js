
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
		this.selectedLayerIds = new Set();
		this.activeLayerId = null;
		this.selectionCycleState = null;


		// DOM references
		this.layersListContainer = document.getElementById('layersList');
		this.canvasElementsContainer = this.editor.canvasElementsContainer;
		this.baseImageSwatchDataUrl = '';

		this.layersListContainer?.setAttribute('role', 'listbox');
		this.layersListContainer?.setAttribute('aria-label', 'Layers');
		this.setupContainerEvents();
		this.setupKeyboardNavigation();
	}

	// ===== INITIALIZATION =====

	setupContainerEvents() {
		bindLayerVisibilityStroke(this.editor, this.layersListContainer);
		// Layer deselection when clicking empty space
		this.layersListContainer.addEventListener('click', (e) => {
			if (e.target === this.layersListContainer) {
				this.clearSelection();
			}
		});

		bindListReorder(this.layersListContainer, {
			item: '.layer-item', handle: '.list-row-handle',
			ids: row => this.isLayerSelected(row.dataset.layerId) ? [...this.selectedLayerIds] : [row.dataset.layerId],
			canDrag: row => canEditLayerInStack(this.getLayerById(row.dataset.layerId)),
			resolve: ({ ids, target, place }) => {
				const drop = { targetId: target.dataset.layerId, place };
				return this.canDropLayers(ids, drop) ? { ids, ...drop } : null;
			},
			commit: ({ ids, targetId, place }) => this.moveLayers(ids, { targetId, place })
		});
		this.layersListContainer.addEventListener('listreorderend', () => {
			if (this.pendingListRender) { this.pendingListRender = false; this.renderLayersList(); }
		});
	}

	setupKeyboardNavigation() {
		this.layersListContainer?.addEventListener('keydown', (event) => {
			if (event.defaultPrevented || event.target.closest('.list-row-handle') || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
			const items = [...this.layersListContainer.querySelectorAll('.layer-item')];
			if (!items.length) return;
			const currentIndex = Math.max(0, items.indexOf(document.activeElement));
			let nextIndex = currentIndex;
			if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
			if (event.key === 'ArrowDown') nextIndex = Math.min(items.length - 1, currentIndex + 1);
			if (event.key === 'Home') nextIndex = 0;
			if (event.key === 'End') nextIndex = items.length - 1;
			event.preventDefault();
			const item = items[nextIndex];
			this.setActiveLayer(item.dataset.layerId);
			item.focus();
		});

		this.editor.previewCanvas?.addEventListener('keydown', (event) => {
			if (event.key !== 'Tab') return;
			const layers = this.layers.filter((layer) => (
				layer.visible
				&& !layer.locked
				&& isLayerTransformable(layer)
			));
			if (!layers.length) return;
			event.preventDefault();
			const currentIndex = layers.findIndex((layer) => layer.id === this.activeLayerId);
			const delta = event.shiftKey ? -1 : 1;
			const nextIndex = currentIndex < 0
				? (event.shiftKey ? layers.length - 1 : 0)
				: (currentIndex + delta + layers.length) % layers.length;
			this.setActiveLayer(layers[nextIndex].id, { source: 'canvas' });
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
			locked: true,
			opacity: FIELDS.layerOpacity.value,
			background: {
				mode: 'image',
				color: '#ffffff',
				gradient: normalizeEffectGradient(CONFIG.rendering.gradient),
				glitterId: CONFIG.tools.glitter.defaults.fillGlitterId.canvasBackground,
				scale: FIELDS.textureScale.value,
				colorAdjust: null
			}
		};
		this.editor.baseBackgroundManager.normalizeLayer(layer);
		return layer;
	}

	serializeLayer(layer, options = {}) {
		const { includeMaskVersion = true } = options;
		if (!layer) return null;
		const type = layer.type || LayerType.GLITTER_FILL;
		const spec = LAYER_UI_CONFIG[type]?.serialization || {};
		const serialized = {};
		['id', 'type', 'name', 'visible', 'locked'].forEach((key) => {
			if (!spec.omit?.includes(key)) serialized[key] = key === 'type' ? type : layer[key];
		});
		serialized.opacity = layer.opacity;
		serialized.clipped = Boolean(layer.clipped);
		if (layer.loopOriginalPeriods) serialized.loopOriginalPeriods = structuredClone(layer.loopOriginalPeriods);
		if (isTransformableLayerType(type)) serialized.transform = cloneTransform(getLayerTransform(layer));
		if (LAYER_UI_CONFIG[type]?.blendable) serialized.blendMode = GlitterBlendModes.forLayer(layer);
		if (layer.animations?.length && isAnimatableLayerType(type)) {
			serialized.animations = structuredClone(layer.animations);
		}
		if (spec.forceLocked) serialized.locked = true;
		if (!spec.omit?.includes('settings')) serialized.settings = structuredClone(layer.settings || {});
		[spec.dataKey, ...(spec.extraKeys || [])].filter(Boolean).forEach((key) => {
			const fallback = key === 'selections' ? [] : null;
			const value = key === spec.dataKey && spec.runtimeKeys && layer[key]
				? { ...layer[key], ...Object.fromEntries(spec.runtimeKeys.map(name => [name, null])) }
				: layer[key];
			serialized[key] = value == null ? fallback : structuredClone(value);
		});
		if (includeMaskVersion && spec.includeMaskVersion) serialized.maskVersion = layer.maskVersion || 0;
		return this.serializePaintSlots(serialized);
	}

	serializePaintSlots(serialized) {
		// Missing optional paint slots and explicit null have the same document
		// meaning. Canonical snapshots survive hydration without gaining fields.
		for (const { definition, data } of getLayerPaintSlots(serialized)) {
			const parent = readFieldPath(serialized, definition.pathKeys.slice(0, -1));
			if (data == null && parent) writeFieldPath(serialized, definition.pathKeys, null);
		}
		return serialized;
	}

	async deserializeLayer(layerData) {
		if (!layerData) return null;
		const type = layerData.type || LayerType.GLITTER_FILL;
		const spec = LAYER_UI_CONFIG[type]?.serialization || {};
		const defaultTransform = !layerData.transform
			? LAYER_UI_CONFIG[type]?.defaultTransform?.(this.editor, layerData)
			: null;
		const restored = {
			id: layerData.id,
			type,
			visible: layerData.visible,
			locked: spec.forceLocked ? true : layerData.locked,
			opacity: layerData.opacity,
			...(isTransformableLayerType(type) ? { transform: cloneTransform(layerData.transform || defaultTransform) } : {}),
			...(LAYER_UI_CONFIG[type]?.blendable ? { blendMode: GlitterBlendModes.forLayer(layerData) } : {}),
			...(spec.defaults ? structuredClone(spec.defaults) : {})
		};
		if (!spec.omit?.includes('name')) restored.name = layerData.name || spec.defaultName?.(this.editor, layerData[spec.dataKey]);
		if (layerData.loopOriginalPeriods) restored.loopOriginalPeriods = structuredClone(layerData.loopOriginalPeriods);
		if (!spec.omit?.includes('settings')) restored.settings = structuredClone(layerData.settings || {});
		[spec.dataKey, ...(spec.extraKeys || [])].filter(Boolean).forEach((key) => {
			const fallback = key === 'selections' ? [] : null;
			restored[key] = layerData[key] == null ? fallback : structuredClone(layerData[key]);
		});
		if (spec.includeMaskVersion) restored.maskVersion = layerData.maskVersion || 0;
		if (layerData.animations?.length && isAnimatableLayerType(type)) {
			restored.animations = GlitterAnimation.normalizeAnimations(layerData.animations);
		}
		restored.clipped = Boolean(layerData.clipped);
		spec.normalize?.(this.editor, restored);
		try {
			await spec.hydrate?.(this.editor, restored);
		} catch (error) {
			this.editor.textGlitterManager?.reportFontLoadError(error);
			throw error;
		}
		return restored;
	}

	insertLayer(layer, options = {}) {
		layer.clipped = Boolean(layer.clipped);
		if (LAYER_UI_CONFIG[layer.type]?.blendable) layer.blendMode = GlitterBlendModes.forLayer(layer);

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

	// The one gate every way of adding a layer goes through. New layers look
	// their assets up in the Library, so none can be added before it has loaded.
	canAddLayers(count = 1) {
		const occupied = this.layers.filter((layer) => !layer.isPreview).length;
		const remaining = Math.max(0, CONFIG.app.limits.maxLayers - occupied);
		if (!APP_BOOT.isComplete('library')) return { ok: false, remaining, reason: 'The Library is still loading' };
		if (remaining >= count) return { ok: true, remaining };
		return {
			ok: false,
			remaining,
			reason: remaining <= 0
				? `You've reached the ${CONFIG.app.limits.maxLayers}-layer limit. Delete or merge a layer to add another.`
				: `Only ${formatCount(remaining, 'more layer')} can be added (limit is ${CONFIG.app.limits.maxLayers}).`
		};
	}

	requireLayerCapacity(count = 1) {
		const gate = this.canAddLayers(count);
		if (!gate.ok) this.editor.showError(gate.reason);
		return gate.ok;
	}

	// In LayerManager
	addLayer(type = LayerType.GLITTER_FILL, options = {}) {
		if (!this.requireLayerCapacity()) return null;
		const cfg = LAYER_UI_CONFIG[type];
		const manager = getLayerManagerForType(this.editor, type);
		if (!manager) {
			dbg('Invalid layer type');
			return;
		}

		let createOptions = cfg.createOptionsKey ? (options[cfg.createOptionsKey] || {}) : undefined;
		createOptions ??= cfg.defaultCreateOptions?.(this.editor);
		const layer = manager.createLayer(createOptions);

		if (!layer) return;  // Factory returns null if max reached

		this.insertLayer(layer);
		this.setActiveLayer(layer.id);

		this.renderLayersList();
		if (!options.skipHistory) this.editor.saveState('Add layer');
		this.editor.updateActionButtons();

		this.editor.updateStatus(cfg.addedStatusMessage || 'New layer added');
		return layer;
	}

	deleteLayer(layerId, options = {}) {
		this.deleteLayers([layerId], options);
	}

	setLayerVisibility(layerId, visible) {
		const layer = this.getLayerById(layerId);
		if (!layer || layer.visible === visible) return false;
		layer.visible = visible;
		this.editor.pathEdit?.revalidate();

		// Keep the live sticker DOM in sync with the layer visibility toggle.
		const manager = getLayerManagerForType(this.editor, layer.type);
		const element = manager?.layerElements?.get(layerId);
		if (element) element.style.display = visible ? 'block' : 'none';

		document.querySelectorAll('.layer-item[data-layer-id]').forEach(row => {
			if (row.dataset.layerId === layerId) syncLayerRow(row, layer);
		});
		this.editor.requestPreviewUpdate();
		return true;
	}

	toggleLayerVisibility(layerId) {
		const layer = this.getLayerById(layerId);
		if (!layer) return;
		this.setLayerVisibility(layerId, !layer.visible);
		this.editor.saveState(layer.visible ? 'Show layer' : 'Hide layer');
		this.editor.updateStatus(`${layer.visible ? 'Shown' : 'Hidden'}: ${layer.name || LAYER_UI_CONFIG[layer.type]?.displayName || 'Layer'}`);
	}

	setLayerLock(layerId, locked) {
		const layer = this.getLayerById(layerId);
		if (!layer || LAYER_UI_CONFIG[layer.type]?.protectedInStack || Boolean(layer.locked) === locked) return false;
		layer.locked = locked;
		this.editor.pathEdit?.revalidate();
		if (isLayerFullyLocked(layer) && this.activeLayerId === layer.id) {
			this.editor.pickers.closeForLayer(layer.id);
			this.editor.maskEditor?.releaseBrushTool?.({ commitStroke: true });
			if (this.editor.currentTool === ToolType.GLITTER_FILL) this.editor.setTool(ToolType.SELECT);
		}
		return true;
	}

	toggleLayerLock(layerId) {
		const layer = this.getLayerById(layerId);
		if (!layer || !this.setLayerLock(layerId, !layer.locked)) return;
		this.renderLayersList();
		this.editor.syncTransformHandlesForActiveLayer?.();
		this.editor.refreshInspector();
		this.editor.updateActionButtons();
		this.editor.saveState(layer.locked ? 'Lock layer' : 'Unlock layer');
		this.editor.updateStatus(`${layer.locked ? 'Locked' : 'Unlocked'}: ${layer.name || LAYER_UI_CONFIG[layer.type]?.displayName || 'Layer'}`);
	}

	// ===== LAYER SELECTION =====

	isLayerMultiSelectable(layer) {
		return Boolean(layer);
	}

	isLayerMovable(layer) {
		return Boolean(layer && isLayerTransformable(layer) && !layer.locked);
	}

	isLayerSelected(layerId) {
		return this.selectedLayerIds.has(layerId);
	}

	getSelectedLayers(options = {}) {
		const movableOnly = options.movableOnly === true;
		return this.layers.filter((layer) => {
			if (!this.selectedLayerIds.has(layer.id)) return false;
			return !movableOnly || this.isLayerMovable(layer);
		});
	}

	getMultiSelectedMovableLayers() {
		const selectedLayers = this.getSelectedLayers();
		return selectedLayers.length > 0 && selectedLayers.every((layer) => this.isLayerMovable(layer))
			? selectedLayers
			: [];
	}

	hasMultiSelection() {
		return this.getSelectedLayers().length > 1;
	}

	canTransformMultiSelection() {
		return this.hasMultiSelection() && this.getMultiSelectedMovableLayers().length > 1;
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

	toggleLayerSelection(layerId, options = {}) {
		const layer = this.getLayerById(layerId);
		if (!this.isLayerMultiSelectable(layer)) {
			this.setActiveLayer(layerId, options);
			return;
		}

		const nextIds = new Set(this.selectedLayerIds);
		if (nextIds.has(layerId)) {
			nextIds.delete(layerId);
			const remaining = [...nextIds];
			const nextActiveId = remaining.includes(this.activeLayerId)
				? this.activeLayerId
				: (remaining[remaining.length - 1] || null);
			this.setSelection(remaining, { ...options, activeLayerId: nextActiveId });
			return;
		}

		nextIds.add(layerId);
		this.setSelection([...nextIds], { ...options, activeLayerId: layerId });
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
			.map((layer) => layer.id);
		const nextIds = options.additive
			? [...new Set([...this.selectedLayerIds, ...rangeIds])]
			: rangeIds;
		this.setSelection(nextIds, { activeLayerId: layerId });
	}

	restoreSelectionState(activeLayerId, selectedLayerIds = null, options = {}) {
		const fallbackIds = activeLayerId ? [activeLayerId] : [];
		this.setSelection(selectedLayerIds ?? fallbackIds, { ...options, activeLayerId });
	}

	setSelection(layerIds, options = {}) {
		const requestedIds = Array.isArray(layerIds) ? layerIds : [];
		let normalized = requestedIds.filter((layerId, index) => {
			if (!this.layers.some((layer) => layer.id === layerId)) return false;
			return requestedIds.indexOf(layerId) === index;
		});

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
			if (options.source === 'canvas') this.revealLayerInList(nextActiveId);
			return;
		}
		this.editor.timelineKeyRecording?.selectionWillChange(normalized, nextActiveId);

		if (this.editor.textGlitterManager?.editSession?.layerId !== nextActiveId) this.editor.textGlitterManager?.endTextEdit();
		if (this.editor.pathEdit?.session && this.editor.pathEdit.session.layerId !== nextActiveId) this.editor.pathEdit.end();
		this.activeLayerId = nextActiveId;
		this.selectedLayerIds = new Set(normalized);
		this.selectionCycleState = null;

		this.editor.maskEditor?.handleLayerChange(this.activeLayerId);
		this.updateActiveLayerListSelection();
		if (options.source === 'canvas') this.revealLayerInList(this.activeLayerId);
		this.updateMobileLayersSwatch();
		this.updateBottomBarButtons();

		const activeLayer = this.getActiveLayer();
		const selectedCount = this.selectedLayerIds.size;

		this.editor.updateContextToolbars();
		this.updateSelectionHighlight();
		this.editor.requestPreviewUpdate();
		this.editor.syncTransformHandlesForActiveLayer?.();
		if (options.source !== 'history' && selectedCount === 1 && activeLayer) {
			// A type keeps the tools it lists (`toolsOnSelect`); any other tool
			// gives way to Select.
			const config = LAYER_UI_CONFIG[activeLayer.type];
			if (config.toolsOnSelect && !config.toolsOnSelect.includes(this.editor.currentTool)) this.editor.setTool(ToolType.SELECT);
			config.onActivate?.(this.editor, activeLayer);
		}
		this.editor.refreshInspector();

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

		if (options.source !== 'history' && selectedCount > 1) {
			this.editor.updateStatus(`${selectedCount} layers selected`);
		} else if (options.source !== 'history' && activeLayer) {
			const clipBase = getClipBase(this.layers, activeLayer);
			this.editor.updateStatus(`Selected: ${describeLayer(activeLayer, this.editor).name}${clipBase ? ` (clipped to ${describeLayer(clipBase, this.editor).name})` : ''}`);
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

	setActiveLayer(layerId, options = {}) {
		if (!layerId) {
			this.clearSelection();
			return;
		}

		this.setSelection([layerId], { ...options, activeLayerId: layerId });
	}

	selectLayerFromCanvas(layerId) {
		this.setActiveLayer(layerId, { source: 'canvas' });
	}

	revealLayerInList(layerId) {
		if (!layerId || !this.layersListContainer) return;
		if (this.editor.mobileManager?.isMobile && this.editor.mobileManager.activeDrawer !== 'layers') return;
		requestAnimationFrame(() => {
			const item = this.layersListContainer.querySelector(`[data-layer-id="${layerId}"]`);
			if (!item || !item.getClientRects().length) return;
			item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		});
	}

	getBaseLayer() {
		return this.layers.find(layer => layer.type === LayerType.BASE_IMAGE) || null;
	}

	getActiveLayer() {
		return this.getLayerById(this.activeLayerId);
	}

	// The layer the Inspector shows: the selection, or the canvas when nothing
	// is selected. A multi-selection has none.
	getInspectedLayer() {
		if (this.hasMultiSelection()) return null;
		return this.getActiveLayer() || this.getBaseLayer();
	}

	getLayerById(layerId) {
		if (layerId == null) return null;
		return this.layers.find((layer) => layer.id === layerId) || null;
	}

	// ===== LAYER NAVIGATION =====

	// A type's `goTo` names what its source is, in `openOnCreate`'s values.
	goToLayerSource(layerId) {
		const layer = this.getLayerById(layerId);
		const target = layer && LAYER_UI_CONFIG[layer.type]?.goTo;
		if (!target) return;
		this.setActiveLayer(layerId);
		this.editor.openCreateTarget(layer, target);
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
				this.toggleLayerSelection(layer.id, { source: 'canvas' });
				return;
			}

			this.selectLayerFromCanvas(layer.id);

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
		// Layers hit only where nothing else is (LAYER_UI_CONFIG hitTestBehind).
		const behind = [];

		for (let i = this.layers.length - 1; i >= 0; i--) {
			const layer = this.layers[i];
			if (!layer.visible) continue;
			const base = getClipBase(this.layers, layer);
			if (base?.visible === false) continue;
			const hitPoints = base ? this.editor.clipPreview?.getHitPoints(base, x, y) || [] : [{ x, y }];
			if (!hitPoints.length) continue;
			if (excludeLocked && isLayerFullyLocked(layer) && layer.type !== LayerType.BASE_IMAGE) continue;
			if (movableOnly && !this.isLayerMovable(layer)) continue;

			let isHit = false;
			const { hitTest, hitTestBehind } = LAYER_UI_CONFIG[layer.type] || {};

			if (hitTest) {
				const zoom = Math.max(0.01, this.editor.viewport?.currentZoom || 1);
				const hasContent = LAYER_UI_CONFIG[layer.type].hasVisibleContent?.(layer) !== false;
				isHit = hasContent && hitPoints.some(point => hitTest(this.editor, layer, point.x, point.y, CONFIG.ui.stickerHandles.frameHitTolerance / zoom));
				if (!isHit && hasContent && hitTestBehind && hitPoints.some(point => hitTestBehind(this.editor, layer, point.x, point.y))) behind.push(layer);
			} else if (isLayerTransformable(layer)) {
				isHit = hitPoints.some(point => this.isPointInLayer(layer, point.x, point.y));
			} else if (includeBase && layer.type === LayerType.BASE_IMAGE && this.editor.originalImage) {
				isHit = true;
			}

			if (isHit) {
				hits.push(layer);
			}
		}

		const background = hits.at(-1)?.type === LayerType.BASE_IMAGE ? hits.pop() : null;
		return [...hits, ...behind, ...(background ? [background] : [])];
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

	// A transformable layer is hit inside its frame (see getLayerFrame), plus a
	// few screen pixels of tolerance. Empty layers have nothing to hit.
	isPointInLayer(layer, clickX, clickY, tolerancePx = CONFIG.ui.stickerHandles.frameHitTolerance) {
		if (!isLayerTransformable(layer)) return false;
		if (LAYER_UI_CONFIG[layer.type].hasVisibleContent?.(layer) === false) return false;
		if (!getLayerFrame(this.editor, layer)) return false;
		const transform = this.editor.getMovableLayerContext(layer)?.manager?.layerTransforms?.get(layer.id)
			|| new LayerTransform(layer, this.editor);
		const zoom = Math.max(0.01, this.editor.viewport?.currentZoom || 1);
		return transform.containsPoint({ x: clickX, y: clickY }, tolerancePx / zoom);
	}

	isPixelInLayerSelection(layer, x, y) {
		if (
			!this.editor.originalCanvas
			|| layer?.type !== LayerType.GLITTER_FILL
			|| layer.fill?.mode === 'none'
			|| layer.opacity <= 0
		) {
			return false;
		}

		const local = this.editor.glitterManager.getMaskLocalPoint(layer, { x, y });
		const canvasX = Math.floor(local.x);
		const canvasY = Math.floor(local.y);
		if (canvasX < 0 || canvasY < 0 || canvasX >= this.editor.originalCanvas.width || canvasY >= this.editor.originalCanvas.height) {
			return false;
		}

		const pixelIndex = canvasY * this.editor.originalCanvas.width + canvasX;
		return this.editor.maskCompositor.getMaskData(layer)[pixelIndex] > 0;
	}

	// ===== RENDERING =====

	renderLayersList() {
		if (isReordering(this.layersListContainer)) { this.pendingListRender = true; return; }
		const container = this.layersListContainer;
		// The Inspector's bar and the Library's show the same layer name as the list.
		this.editor.syncInspectorHeader?.();
		syncLibraryTitle();

		reconcileKeyedChildren(container, [...this.layers].reverse().filter(layer => !layer.isPreview), {
			key: layer => layer.id,
			build: layer => { const row = buildLayerRow(this.editor, layer, { variant: 'panel' }); row._layer = layer; return row; },
			reuse: (current, layer) => {
				const fresh = buildLayerRow(this.editor, layer, { variant: 'panel' });
				if (current._layer === layer && current.outerHTML === fresh.outerHTML) return current;
				fresh._layer = layer; return fresh;
			}
		});

		// Update layer count displays
		this.updateLayerCount();

		// Update add button states
		const addLayerBtn = document.getElementById('addLayerBtn');
		const addGate = this.canAddLayers();
		[addLayerBtn].forEach((button) => {
			if (!button) return;
			button.disabled = !addGate.ok;
			if (!addGate.ok) button.title = addGate.reason;
		});

		// Update mobile swatch
		this.updateMobileLayersSwatch();

		// Update bottom bar buttons
		this.updateBottomBarButtons();

	}

	updateActiveLayerListSelection() {
		if (!this.layersListContainer) return;

		this.layersListContainer.querySelectorAll('.layer-item').forEach(row => syncLayerRow(row, this.getLayerById(row.dataset.layerId)));
	}

	updateBottomBarButtons() {
		const selectedLayers = this.getSelectedLayers();
		const canAddLayers = this.canAddLayers().ok;
		const canInteractWithSelected = selectedLayers.length > 0
			&& selectedLayers.every((layer) => canEditLayerInStack(layer));
		const hasSingleSelection = selectedLayers.length === 1;
		const canGoToSelected = hasSingleSelection
			&& Boolean(LAYER_UI_CONFIG[selectedLayers[0].type]?.goTo);
		const selectionCount = selectedLayers.length;

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
		const clipBtn = document.getElementById('layersBarClipping');
		if (clipBtn) {
			clipBtn.disabled = !this.editor.canToggleClippingMask();
			clipBtn.title = selectedLayers.every(layer => layer.clipped) ? 'Release Clip (Ctrl+Alt+G)' : 'Clip to Layer Below (Ctrl+Alt+G)';
		}
		const deleteBtn = document.getElementById('layersBarDeleteSelected');

		if (goToBtn) goToBtn.disabled = !canGoToSelected;
		if (cloneBtn) cloneBtn.disabled = !canInteractWithSelected || !canAddLayers;
		if (deleteBtn) deleteBtn.disabled = !canInteractWithSelected;

		if (cloneBtn) {
			cloneBtn.title = selectionCount > 1 ? 'Clone selected layers' : 'Clone selected layer';
		}
		if (deleteBtn) {
			deleteBtn.title = selectionCount > 1 ? 'Delete selected layers' : 'Delete selected layer';
		}
	}

	cloneLayer(layerId, options = {}) {
		const sourceLayer = this.getLayerById(layerId);
		if (!sourceLayer) return null;
		if (!this.requireLayerCapacity()) return null;
		const clonedLayer = this.buildClonedLayer(sourceLayer, options);
		if (!clonedLayer) return null;

		// Insert right after the source (higher index = visually above).
		const sourceIndex = this.layers.findIndex(l => l.id === layerId);
		this.layers.splice(sourceIndex + 1, 0, clonedLayer);
		this.renderClonedLayerPreview(clonedLayer);

		// Make the clone active and re-render
		if (!options.skipSelection) this.setActiveLayer(clonedLayer.id);
		this.renderLayersList();
		this.reorderLayers();

		if (!options.skipHistory) this.editor.saveState('Duplicate layer');
		this.editor.updateActionButtons();

		return clonedLayer;
	}

	// A clone is the source's serialized state under a new id, so it carries
	// every persisted field (opacity, fill, effects, animation) the same way
	// undo and project load do. Painted masks live outside the layer object and
	// are copied separately.
	buildClonedLayer(sourceLayer, options = {}) {
		const positionOffset = options.positionOffset || { x: 20, y: 20 };
		if (!sourceLayer) return null;
		if (isLayerFullyLocked(sourceLayer)) {
			this.editor.showError('Cannot clone locked layer');
			return null;
		}

		const clonedLayer = structuredClone(this.serializeLayer(sourceLayer, { includeMaskVersion: false }));
		clonedLayer.id = this.generateLayerId();
		clonedLayer.locked = false;
		if (isTransformableLayerType(clonedLayer.type)) {
			clonedLayer.transform.position.x += positionOffset.x;
			clonedLayer.transform.position.y += positionOffset.y;
		}
		if (clonedLayer.type === LayerType.GLITTER_FILL) {
			clonedLayer.maskVersion = 0;
			clonedLayer.maskHasContent = false;
			this.editor.paintMaskStore.clonePaintData(sourceLayer, clonedLayer);
		}
		return clonedLayer;
	}

	renderClonedLayerPreview(layer) {
		if (!layer) return;
		const manager = getLayerManagerForType(this.editor, layer.type);
		manager?.renderLayer?.(layer);
	}

	cloneLayers(layerIds, options = {}) {
		const uniqueIds = [...new Set(layerIds)].filter((layerId) => this.layers.some((layer) => layer.id === layerId));
		if (!uniqueIds.length) return null;
		if (!this.requireLayerCapacity(uniqueIds.length)) return null;

		const clones = [];
		this.layers
			.filter((layer) => uniqueIds.includes(layer.id))
			.forEach((sourceLayer) => {
				const clonedLayer = this.buildClonedLayer(sourceLayer, options);
				if (!clonedLayer) return;
				if (LAYER_UI_CONFIG[sourceLayer.type]?.blendable) clonedLayer.blendMode = GlitterBlendModes.forLayer(sourceLayer);
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
		this.editor.requestPreviewUpdate();
		if (!options.skipHistory) this.editor.saveState('Duplicate layer');
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

		if (removableLayers.some((layer) => isLayerFullyLocked(layer))) {
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
			getClippedLayers(this.layers, layer).forEach(clipped => { clipped.clipped = false; });
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
		if (!options.skipHistory) this.editor.saveState('Delete layer');
		this.editor.requestPreviewUpdate();
		this.editor.updateActionButtons();
		if (!options.silent) this.editor.updateStatus(uniqueIds.length > 1 ? 'Layers deleted' : 'Layer deleted');
		return true;
	}
	pressLayerLock(layer) {
		if (layer.type === LayerType.BASE_IMAGE) this.editor.updateStatus('The fixed background can be edited, but not moved or deleted');
		else this.toggleLayerLock(layer.id);
	}

	async deleteLayerFromRow(layer) {
		this.setSelection([layer.id]);
		await this.editor.deleteSelectedLayers();
	}


	updateLayerCount() {
		const count = this.layers.filter((layer) => !layer.isPreview).length;
		const layerCount = document.querySelector('.section-header-title-count');
		if (layerCount) {
			layerCount.setAttribute('data-count', count);
		}

		const mobileLayersCount = document.querySelector('.mobile-layers-count');
		if (mobileLayersCount) {
			mobileLayersCount.setAttribute('data-count', count);
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
		swatch.classList.remove('empty', 'pixelated', 'text-layer', 'sticker', 'glitter', 'baseImage', 'filter');
		swatch.removeAttribute('style');
		swatch.replaceChildren();

		if (!layer) {
			swatch.classList.add('empty');
			return;
		}

		const renderPaint = (source, imageAsset = null) => {
			const mode = source?.mode || 'glitter';
			if (mode === 'solid') {
				swatch.style.backgroundColor = source?.color || '#ff66cc';
				return true;
			}
			if (mode === 'pattern') {
				applyPatternTileStyle(swatch, source.pattern, source.scale);
				swatch.style.backgroundSize = '100% 100%';
				return true;
			}
			if (mode === 'gradient') {
				swatch.style.backgroundImage = effectGradientToCss(source?.gradient);
				return true;
			}
			if (mode === 'image' && imageAsset?.url) {
				swatch.style.backgroundImage = `url(${imageAsset.url})`;
				swatch.style.backgroundSize = 'cover';
				swatch.style.backgroundPosition = 'center';
				return true;
			}
			if (mode === 'none') return false;
			if (mode !== 'glitter') return false;
			const glitter = this.editor.glitterLibrary.getItemById(source?.glitterId);
			if (!glitter) return false;
			swatch.style.backgroundImage = `url(${glitter.url})`;
			swatch.style.filter = buildCssColorFilter(source.colorAdjust);
			swatch.classList.add('glitter');
			if (glitter.isPixelated) swatch.classList.add('pixelated');
			return true;
		};

		const rendered = LAYER_UI_CONFIG[layer.type]?.renderSwatch?.(layer, {
			editor: this.editor,
			swatch,
			compact,
			renderPaint,
			baseImageSwatchDataUrl: this.baseImageSwatchDataUrl
		});
		if (!rendered && !renderPaint(getLayerFillSlot(layer))) swatch.classList.add('empty');
	}

	updateMobileLayersSwatch() {
		const mobileLayersSwatch = document.querySelector('.mobile-layers-swatch');
		if (!mobileLayersSwatch) return;
		const layer = this.getActiveLayer();
		this.renderLayerSwatch(mobileLayersSwatch, layer, { compact: true });
		mobileLayersSwatch.classList.toggle('is-unset', !layer);
		if (!layer) mobileLayersSwatch.classList.remove('empty');
	}

	// ===== LAYER ORDER =====

	_resolveLayerMove(ids, { targetId, place }) {
		if (!['above', 'below'].includes(place)) return null;
		const requested = new Set(ids);
		const moving = this.layers.filter(layer => requested.has(layer.id) && !layer.isPreview && canEditLayerInStack(layer));
		if (!moving.length || moving.some(layer => layer.id === targetId)) return null;
		const movingIds = new Set(moving.map(layer => layer.id));
		const stack = this.layers.filter(layer => !movingIds.has(layer.id)).map(layer => ({ ...layer }));
		const targetIndex = stack.findIndex(layer => layer.id === targetId);
		if (targetIndex < 0 || (targetIndex === 0 && place === 'below' && stack[0].locked)) return null;
		let index = targetIndex + (place === 'above' ? 1 : 0);
		for (const layer of moving) {
			const insertion = getClipInsertion(stack, layer, index);
			stack.splice(insertion.index, 0, { ...layer, clipped: insertion.clipped });
			index = insertion.index + 1;
		}
		if (stack.every((layer, position) => layer.id === this.layers[position].id && Boolean(layer.clipped) === Boolean(this.layers[position].clipped))) return null;
		return stack;
	}

	canDropLayers(ids, drop) {
		return Boolean(this._resolveLayerMove(ids, drop));
	}

	moveLayers(ids, drop) {
		const stack = this._resolveLayerMove(ids, drop);
		if (!stack) return false;
		const byId = new Map(this.layers.map(layer => [layer.id, layer]));
		this.layers = stack.map(item => {
			const layer = byId.get(item.id);
			layer.clipped = item.clipped;
			return layer;
		});
		this.renderLayersList();
		this.reorderLayers();
		this.editor.saveState('Reorder layers');
		return true;
	}

	arrangeLayers(ids, step) {
		const requested = new Set(ids);
		const moving = this.layers.filter(layer => requested.has(layer.id) && !layer.isPreview && canEditLayerInStack(layer));
		if (!moving.length) return false;
		const movingIds = new Set(moving.map(layer => layer.id));
		const others = this.layers.filter(layer => !movingIds.has(layer.id));
		let target, place;
		if (step === 'front') { target = others.at(-1); place = 'above'; }
		else if (step === 'back') { target = others[0]; place = target?.locked ? 'above' : 'below'; }
		else if (step === 'forward') {
			const top = this.layers.indexOf(moving.at(-1));
			target = this.layers.slice(top + 1).find(layer => !movingIds.has(layer.id)); place = 'above';
		} else if (step === 'backward') {
			const bottom = this.layers.indexOf(moving[0]);
			target = this.layers.slice(0, bottom).reverse().find(layer => !movingIds.has(layer.id));
			place = target === this.layers[0] && target?.locked ? 'above' : 'below';
		} else return false;
		return target ? this.moveLayers(moving.map(layer => layer.id), { targetId: target.id, place }) : false;
	}

	// In Preview
	reorderLayers() {
		const container = this.canvasElementsContainer;

		// Keep every transformable preview element in sync with layer order.
		const existingElements = new Map();
		container.querySelectorAll(getAllLayerElementSelector()).forEach(el => {
			existingElements.set(el.dataset.layerId, el);
		});

		const transformHandleNodes = Array.from(container.children).filter(el => el.classList.contains('transform-handles'));
		// Reorder them to match layers array.
		const fragment = document.createDocumentFragment();
		this.layers.forEach(layer => {
			const el = existingElements.get(layer.id);
			if (el) {
				// A z-index on the filter wrapper traps its blended children in a new
				// stacking context. Filter children carry the layer z-index themselves.
				el.style.zIndex = layer.type === LayerType.FILTER
					? ''
					: this.editor.layerManager.getLayerZIndex(layer.id);
				fragment.appendChild(el.closest('.clip-wrapper') || el);
			}
		});

		container.appendChild(fragment);
		transformHandleNodes.forEach(el => {
			if (el.parentNode) {
				container.appendChild(el);
			}
		});
		this.editor.requestPreviewUpdate();
	}
}
