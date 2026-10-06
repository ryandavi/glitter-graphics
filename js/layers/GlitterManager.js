// ============================================
// GLITTER MANAGER CLASS
// Glitter-fill layer settings, masks and rendering
// ============================================
class GlitterManager {

	constructor(editor) {
		this.editor = editor;

		this.layerElements = new Map();
		this.layerTransforms = new Map();
		this.maskBoundsCache = new Map();
		// Encoded mask PNG per fill layer: { key, url, pending, fullApplied }.
		// Keyed by layer id and a content key, so an undo that restores the same
		// layer keeps its URL, and an in-flight encode lands on whichever layer
		// object is current. Entries for deleted layers are revoked on render.
		this.maskImages = new Map();
		// One decoded data URL per derived effect mask. A changed mask is decoded
		// before it replaces the visible one, so painting never flashes unmasked.
		this.effectMaskImages = new Map();
		this.pickerSession = null;

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

	getLayerType() {
		return LayerType.GLITTER_FILL;
	}

	setupUI() {
		this.ui = {
			gallerySection: document.getElementById('designGallerySection'),
			pickerStrip: document.getElementById('galleryPickerStrip'),
			pickerStripTitle: document.getElementById('galleryPickerStripTitle'),
			pickerStripDetail: document.getElementById('galleryPickerStripDetail'),
			pickerStripDone: document.getElementById('galleryPickerStripDone'),
			resetEffects: document.getElementById('resetGlitterEffects')

		};
	}

	setupEventListeners() {

		this.fieldHost = this.createFieldHost();
		bindFieldControls(this.fieldHost);
		this.ui.resetEffects?.addEventListener('click', () => {
			const layer = this.fieldHost.getLayer();
			if (!layer) return;
			layer.border = null;
			layer.shadow = null;
			layer.sparkles = null;
			delete layer.effectDrafts;
			this.renderLayer(layer, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
			syncFieldControls(this.fieldHost, layer);
			this.editor.layerManager.renderLayersList();
			this.editor.saveState('Reset fill effects');
		});
		this.ui.pickerStripDone?.addEventListener('click', () => {
			if (this.hasActivePickerSession()) this.handlePickerDone();
		});
	}

	// slot: null for the fill itself, 'sparkles' for the sparkles slot.
	armAssetPicker(slot = null) {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.GLITTER_FILL) return;
		pickerOpenSession(this, { layerId: layer.id, slot }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => revealAssetBrowser(this.editor, this.editor.glitterLibrary, getLayerPaintSlot(layer, slot || 'fill')?.glitterId)
		});
	}

	// The slot data the next gallery pick writes to.
	resolveSelectedGlitterId(layer) {
		return this.getGlitterSelectionSlot(layer)?.glitterId ?? null;
	}

	getGlitterSelectionSlot(layer) {
		const slot = this.hasActivePickerSession() ? this.pickerSession.slot : null;
		return (slot && getLayerPaintSlot(layer, slot)) || layer.fill;
	}

	hasActivePickerSession() {
		const layer = this.editor.layerManager.getActiveLayer();
		return Boolean(layer?.type === LayerType.GLITTER_FILL && this.pickerSession?.layerId === layer.id);
	}

	updatePickerStrip() {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.GLITTER_FILL) return;
		if (this.pickerSession && this.pickerSession.layerId !== layer.id) pickerCloseSession(this);
		const armed = this.hasActivePickerSession();
		const copy = formatPickerStripText(layer, (armed && this.pickerSession.slot) || 'fill', 'fill layer');
		renderPickerStrip({ ownsStrip: true, visible: true, armed, hint: !armed, ...copy });
	}

	handlePickerDone() {
		const focusId = getPaintSlotChipId(LayerType.GLITTER_FILL, this.pickerSession?.slot) || 'glitterFillGlitterChip';
		this.closePickerSession();
		returnFromPickerToProperties(this.editor, { section: 'glitterSettings', focusId });
	}

	closePickerSession() {
		pickerCloseSession(this, {
			refresh: () => this.updatePickerStrip(),
			updateSelection: () => this.editor.updateGlitterSelection()
		});
	}

	createLayer(options = {}) {
		// skipLimitCheck: Auto Glitter session layers may transiently overlap
		// the previous batch they replace; the session enforces capacity itself.
		if (!options.skipLimitCheck && !this.editor.layerManager.requireLayerCapacity()) return null;

		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: this.getLayerType(),
			visible: true,
			locked: Boolean(LAYER_UI_CONFIG[this.getLayerType()]?.lockedOnCreate),
			opacity: FIELDS.layerOpacity.value,
			maskVersion: 0,
			maskHasContent: false,
			selections: [],
			fill: this.getDefaultFill(),
			settings: {
				threshold: FIELDS.threshold.value,
				feather: FIELDS.feather.value,
				contiguous: false,
				invert: false,
				multiSelect: false
			},
			border: null,
			shadow: null,
			sparkles: null
		};
		layer.transform = createDefaultTransform({
			position: {
				x: (this.editor.originalCanvas?.width || 0) / 2,
				y: (this.editor.originalCanvas?.height || 0) / 2
			}
		});

		return layer;
	}

	getDefaultFill() {
		return {
			...buildDefaultFill({ defaultGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId.glitterLayer }),
			gradient: normalizeEffectGradient(CONFIG.rendering.gradient)
		};
	}

	getDefaultBorder() {
		return buildDefaultBorder({
			config: CONFIG.tools.glitter.border,
			slot: getPaintSlotDefinition(LayerType.GLITTER_FILL, 'border'),
			fallbackMode: 'glitter',
			defaultGlitterId: CONFIG.tools.glitter.defaults.borderGlitterId.glitterLayer,
			includeColorAdjust: true
		});
	}

	getDefaultShadow() {
		return buildDefaultShadow({
			defaultMode: 'glitter',
			defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId.glitterLayer,
			includeColorAdjust: true
		});
	}

	getSlotDefaults(key) {
		if (key === 'border') return this.getDefaultBorder();
		if (key === 'shadow') return this.getDefaultShadow();
		if (key === 'sparkles') return buildDefaultSparkles();
		return this.getDefaultFill();
	}

	// Runs where a fill layer enters the document (deserialize, project load).
	normalizeLayer(layer) {
		if (layer?.type !== LayerType.GLITTER_FILL) return;
		layer.transform = cloneTransform(layer.transform || LAYER_UI_CONFIG[LayerType.GLITTER_FILL].defaultTransform(this.editor));
		layer.fill = mergeSlotEffectDefaults(layer.fill, this.getDefaultFill());
		normalizeSlotTextureCoordinates(layer.fill);
		if (layer.border) layer.border = mergeSlotEffectDefaults(layer.border, this.getDefaultBorder());
		if (layer.shadow) layer.shadow = mergeSlotEffectDefaults(layer.shadow, this.getDefaultShadow());
		normalizeSlotTextureCoordinates(layer.border);
		normalizeSlotTextureCoordinates(layer.shadow);
		layer.sparkles = normalizeSparklesData(layer.sparkles);
	}

	getMaskDimensions() {
		return {
			width: this.editor.originalCanvas?.width || 1,
			height: this.editor.originalCanvas?.height || 1
		};
	}

	getMaskLocalPoint(layer, point) {
		return canvasPointToLayerLocal(layer, point, this.getMaskDimensions());
	}

	_getMaskBounds(layer) {
		if (!layer || !this.editor.originalCanvas) return null;
		const key = this.editor.maskCompositor.getCacheKey(layer);
		const cached = this.maskBoundsCache.get(layer.id);
		if (cached?.key === key) return cached.bounds;

		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const mask = this.editor.maskCompositor.getMaskData(layer);
		let minX = width;
		let minY = height;
		let maxX = -1;
		let maxY = -1;
		for (let y = 0; y < height; y++) {
			const row = y * width;
			for (let x = 0; x < width; x++) {
				if (!mask[row + x]) continue;
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
			}
		}
		const bounds = maxX < minX ? null : {
			x: minX,
			y: minY,
			width: maxX - minX + 1,
			height: maxY - minY + 1
		};
		this.maskBoundsCache.set(layer.id, { key, bounds });
		return bounds;
	}

	_expandRect(rect, left, top = left, right = left, bottom = top) {
		if (!rect) return null;
		return {
			x: rect.x - left,
			y: rect.y - top,
			width: rect.width + left + right,
			height: rect.height + top + bottom
		};
	}

	getMaskFrame(layer) {
		const bounds = this._getMaskBounds(layer);
		if (!bounds) return null;
		const border = getLayerPaintSlots(layer).find((entry) => entry.renders && entry.role === 'border');
		const padding = border ? getBorderOutsidePadding(border.data) : 0;
		return frameFromCanvasRect(
			this._expandRect(bounds, padding),
			this.editor.originalCanvas.width,
			this.editor.originalCanvas.height
		);
	}

	getMaskVisualFrame(layer) {
		const bounds = this._getMaskBounds(layer);
		if (!bounds) return null;
		const body = this.getMaskFrame(layer);
		let rect = body ? {
			x: body.offsetX + this.editor.originalCanvas.width / 2 - body.width / 2,
			y: body.offsetY + this.editor.originalCanvas.height / 2 - body.height / 2,
			width: body.width,
			height: body.height
		} : bounds;
		const shadow = getLayerPaintSlots(layer).find((entry) => entry.renders && entry.role === 'shadow');
		if (shadow) {
			const shadowRect = getShadowSlotBounds(bounds, shadow.data);
			rect = unionRects(rect, shadowRect);
		}
		return frameFromCanvasRect(rect, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
	}

	hitTest(layer, x, y, tolerance = 0) {
		if (!hasMaskContent(layer) || !this.editor.originalCanvas) return false;
		if (layer.fill?.mode === 'none' || layer.opacity <= 0) return false;
		const point = this.getMaskLocalPoint(layer, { x, y });
		const width = this.editor.originalCanvas.width;
		const height = this.editor.originalCanvas.height;
		const transform = getLayerTransform(layer);
		const smallestScale = Math.max(0.01, Math.min(
			Math.abs((transform.scale.x || 100) / 100),
			Math.abs((transform.scale.y || 100) / 100)
		));
		const border = getLayerPaintSlots(layer).find((entry) => entry.renders && entry.role === 'border');
		const radius = Math.ceil(tolerance / smallestScale + (border ? getBorderOutsidePadding(border.data) : 0));
		const centerX = Math.floor(point.x);
		const centerY = Math.floor(point.y);
		const mask = this.editor.maskCompositor.getMaskData(layer);
		for (let localY = centerY - radius; localY <= centerY + radius; localY++) {
			if (localY < 0 || localY >= height) continue;
			for (let localX = centerX - radius; localX <= centerX + radius; localX++) {
				if (localX < 0 || localX >= width) continue;
				if (mask[localY * width + localX]) return true;
			}
		}
		return false;
	}

	// Sparkles read the layer's painted mask, in document px.
	getSparkleHost(layer) {
		const canvas = this.editor.originalCanvas;
		if (!canvas?.width || !this.editor.maskCompositor) return null;
		return {
			key: `fill:${layer.id}:${this.editor.maskCompositor.getCacheKey(layer)}`,
			width: canvas.width,
			height: canvas.height,
			loadPixels: () => this.editor.maskCompositor.getMaskCanvas(layer)
		};
	}

	// The declared field host owns fill paint and selection edits.
	createFieldHost() {
		const active = () => {
			const layer = this.editor.layerManager.getActiveLayer();
			return layer?.type === LayerType.GLITTER_FILL ? layer : null;
		};
		const render = (layer) => this.renderLayer(layer, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
		return {
			type: LayerType.GLITTER_FILL,
			editor: this.editor,
			getLayer: active,
			ensureSlot: (layer, key) => ensureLayerPaintSlot(layer, key, () => this.getSlotDefaults(key)),
			getSlotDefaults: (key) => this.getSlotDefaults(key),
			apply: (layer, mutate, change) => {
				mutate();
				const glitter = this.editor.glitterLibrary.getItemById(layer.fill.glitterId);
				if (layer.fill.mode !== 'glitter' && layer.name === glitter?.name) layer.name = null;
				this.editor.requestPreviewUpdate();
				if (change.live) return;
				syncFieldControls(this.fieldHost, layer);
				this.editor.layerManager.renderLayersList();
				this.editor.saveState('Edit fill effect');
			},
			render,
			commit: () => this.editor.saveState('Edit fill layer'),
			afterFieldChange: (layer, _slot, binding) => {
				if (binding.id === 'multiSelect') this.editor.handleMultiSelectChange(layer.settings.multiSelect);
				if (binding.id === 'invert') {
					if (layer.maskVersion || this.editor.paintMaskStore.getPaintMask(layer.id)) this.editor.paintMaskStore.commitPaintState(layer);
					this.editor.maskEditor?.loadLayer(layer);
				}
				this.editor.updateColorPickerControls();
				this.editor.updateHelpfulMessage();
			},
			armPicker: (key) => this.armAssetPicker(key),
			getArmedSlot: () => (this.hasActivePickerSession() ? this.pickerSession.slot || null : null)
		};
	}

	loadLayerSettings(layer) {
		if (layer?.type !== LayerType.GLITTER_FILL) return;
		syncFieldControls(this.fieldHost, layer);
		this.editor.loadTransformSettings(layer, 'glitter');
		this.editor.updateSelectedColorsDisplay();
		this.editor.updateColorPickerControls();
		this.editor.maskEditor?.loadLayer(layer);
	}

	// ===== FILTERING =====

	// ===== LOADING & PARSING =====

	// ===== SELECTION LOGIC =====

	// ===== RENDERING (CANVAS/DOM) =====

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
		this.pruneMaskImages();

		layersToShow.forEach((layer) => {
			if (layer.type === layerType) this.renderLayer(layer, width, height);
		});
	}

	// Hidden layers keep their URL; only layers gone from the document drop it.
	pruneMaskImages() {
		const existing = new Set(this.editor.layerManager.layers.map((layer) => layer.id));
		Array.from(this.maskImages.keys()).forEach((layerId) => {
			if (!existing.has(layerId)) this.revokeMaskImage(layerId);
		});
	}

	clearElements() {
		Array.from(this.layerElements.keys()).forEach((layerId) => this.removeLayerElement(layerId));
	}

	getSlotStack(layer) {
		return buildSlotStack(layer, (entry) => {
			const source = resolvePaintSlotPreviewSource(this.editor, layer, entry);
			return entry.key === 'fill' && source ? { ...source, opacity: 1 } : source;
		});
	}

	getSlotMask(layer, item, fillMask, baseKey = this.editor.maskCompositor.getCacheKey(layer)) {
		if (item.key === 'fill') return { canvas: fillMask, cacheKey: `${baseKey}|fill` };
		if (item.role === 'border') {
			const data = item.data;
			return {
				canvas: createBorderMaskCanvas(fillMask, data, { underlap: layerOutlineUnderlapsFill(layer) }),
				cacheKey: `${baseKey}|border:${data.widthPx}:${getBorderPlacement(data)}:${getBorderEdgeStyle(data)}:${Boolean(data.fillEnclosed)}:${layerOutlineUnderlapsFill(layer)}`
			};
		}
		if (item.role === 'shadow') {
			fillMask._shadowBounds = this._getMaskBounds(layer);
			return {
				canvas: createShadowSlotMaskCanvas(fillMask, item.data),
				cacheKey: `${baseKey}|shadow:${getShadowMaskKey(item.data)}`
			};
		}
		return null;
	}

	renderSlotMasks(layer, fillMask = null) {
		const mask = fillMask || this.editor.maskCompositor.getMaskCanvas(layer);
		const masks = { fill: mask, renderWidth: mask.width, renderHeight: mask.height };
		getLayerPaintSlots(layer).forEach((entry) => {
			if (!entry.renders || entry.key === 'fill' || entry.role === 'sparkles') return;
			const item = { key: entry.key, role: entry.role, data: entry.data };
			const slotMask = this.getSlotMask(layer, item, mask)?.canvas || null;
			masks[entry.key] = entry.role === 'shadow' && slotMask
				? createOffsetMaskCanvas(slotMask, getShadowSlotOffset(entry.data).x, getShadowSlotOffset(entry.data).y)
				: slotMask;
		});
		return masks;
	}

	getEffectMaskUrl(layer, item, mask) {
		if (!mask?.canvas) return null;
		const slotKey = `${layer.id}|${item.key}`;
		const cached = this.effectMaskImages.get(slotKey);
		if (cached?.key === mask.cacheKey) return cached.url || null;
		if (cached?.pendingKey !== mask.cacheKey) {
			const url = mask.canvas.toDataURL('image/png');
			this.effectMaskImages.set(slotKey, { ...cached, pendingKey: mask.cacheKey });
			const image = new Image();
			image.onload = () => {
				const pending = this.effectMaskImages.get(slotKey);
				if (pending?.pendingKey !== mask.cacheKey) return;
				this.effectMaskImages.set(slotKey, { key: mask.cacheKey, url });
				const current = this.editor.layerManager.getLayerById(layer.id);
				if (current?.type === LayerType.GLITTER_FILL) {
					this.renderLayer(current, this.editor.originalCanvas.width, this.editor.originalCanvas.height);
				}
			};
			image.src = url;
		}
		return cached?.url || null;
	}

	renderLayer(layer, width = this.editor.originalCanvas?.width, height = this.editor.originalCanvas?.height, options = {}) {
		if (layer.type !== LayerType.GLITTER_FILL) return;
		if (layer.fill.mode === 'glitter' && !this.editor.glitterLibrary.getItemById(layer.fill.glitterId)) return;

		let wrapper = this.layerElements.get(layer.id);
		let stack = wrapper?.querySelector('.glitter-fill-stack');

		if (!wrapper) {
			// 1. Create the WRAPPER
			// This handles the drop-shadow filter and selection
			wrapper = document.createElement('div');
			wrapper.className = 'glitter-element';
			wrapper.dataset.layerId = layer.id;
			wrapper.setAttribute('role', 'img');
		}

		if (!stack) {
			// Reconcile effects in place so changing a control never restarts an
			// animated glitter source or briefly drops its decoded mask.
			stack = document.createElement('div');
			stack.className = 'glitter-fill-stack';
			wrapper.replaceChildren(stack);
		}

		const draftMask = Boolean(options.draftMask);
		const fillMask = this.editor.maskCompositor.getMaskCanvas(layer, { draft: draftMask });
		const fillMaskKey = this.editor.maskCompositor.getCacheKey(layer, { draft: draftMask });

		const maskObjectUrl = this.getMaskObjectUrlForLayer(layer, width, height, options);
		reconcileSlotStack(stack, this.getSlotStack(layer), {
			spanClassName: 'glitter-fill-content', width, height, layer, glitterLibrary: this,
			getMask: (item) => {
				const mask = this.getSlotMask(layer, item, fillMask, fillMaskKey);
				if (!mask?.canvas) return null;
				return { canvas: mask.canvas, url: item.key === 'fill' ? maskObjectUrl : this.getEffectMaskUrl(layer, item, mask) };
			}
		});
		const inner = stack.querySelector('[data-span-key="fill"]');
		if (inner) {
			inner.classList.add('glitter-background', 'visible');
			// Unconditional: a no-op for full-res masks, but required when the
			// currently-applied mask is a downscaled G-1c draft.
			inner.style.maskSize = '100% 100%';
			inner.style.webkitMaskSize = '100% 100%';
		}
		// 3. Assemble
		if (!wrapper.parentNode) {
			this.editor.canvasElementsContainer.appendChild(wrapper);
		}

		// Store reference
		this.layerElements.set(layer.id, wrapper);
		if (!this.layerTransforms.has(layer.id)) {
			const transform = new LayerTransform(layer, this.editor);
			transform.element = wrapper;
			this.layerTransforms.set(layer.id, transform);
		}
		syncLayerAnimationPreview(wrapper, layer, this.editor.animationTicker);
		// Sparkles sit beside the masked paint (inside the animation wrapper
		// when there is one), behind ones before it.
		reconcileSparkleLayers(stack, layer, { editor: this.editor, width, height, behindAnchor: inner });

		const transform = this.layerTransforms.get(layer.id);
		if (transform) {
			transform.layer = layer;
			transform.element = wrapper;
			transform.applyTransform(wrapper, { width, height });
			if (
				layer.id === this.editor.layerManager.activeLayerId &&
				this.editor.currentTool === ToolType.SELECT &&
				!this.editor.layerManager.hasMultiSelection() &&
				isLayerTransformable(layer) &&
				!layer.locked
			) {
				if (!transform.isDraggingHandle) transform.createTransformHandles();
			} else {
				transform.removeTransformHandles();
			}
		}

		// Update selection highlight for this layer if it's active
		this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);

	}

	// ===== MASKING UTILITIES =====

	releaseLayerResources(layer) {
		if (!layer || layer.type !== LayerType.GLITTER_FILL) return;

		this.removeLayerElement(layer.id);
		this.revokeMaskImage(layer.id);
		this.editor.paintMaskStore?.removePaintMask(layer.id);
		this.editor.maskCompositor?.invalidate(layer.id);
		this.maskBoundsCache.delete(layer.id);
	}

	removeLayerElement(layerId) {
		const transform = this.layerTransforms.get(layerId);
		if (transform) {
			transform.destroy?.();
			this.layerTransforms.delete(layerId);
		}
		removeManagedLayerElement(this.layerElements, layerId);
	}

	updateTransform(layerId, updates) {
		const transform = this.layerTransforms.get(layerId);
		const layer = this.editor.layerManager.getLayerById(layerId);
		const element = this.layerElements.get(layerId);
		if (!transform || !layer || !element) return;
		transform.updateTransform(updates);
		transform.applyTransform(element, this.getMaskDimensions());
		if (transform.transformHandles) transform.updateHandlePositions();
	}

	centerHorizontal(layerId) {
		movableCenterHorizontal(this, layerId, (layer) => this.editor.loadTransformSettings(layer, 'glitter'));
	}

	centerVertical(layerId) {
		movableCenterVertical(this, layerId, (layer) => this.editor.loadTransformSettings(layer, 'glitter'));
	}

	alignToCanvas(layerId, mode) {
		movableAlignToCanvas(this, layerId, mode, (layer) => this.editor.loadTransformSettings(layer, 'glitter'));
	}

	resetTransform(layerId) {
		movableResetTransform(this, layerId, (layer) => this.editor.loadTransformSettings(layer, 'glitter'));
	}

	createTransformHandles(layerId) {
		movableCreateTransformHandles(this, layerId);
	}

	removeTransformHandles() {
		movableRemoveTransformHandles(this);
	}

	// LayerTransform calls this after every live transform edit. The stack stays
	// in mask-local pixels and is scaled inside the already-sized wrapper so
	// effect offsets and texture registration transform with the mask.
	syncElementScale(layer, wrapper = this.layerElements.get(layer?.id)) {
		const stack = wrapper?.querySelector('.glitter-fill-stack');
		if (!stack || !layer || !this.editor.originalCanvas) return;
		const transform = getLayerTransform(layer);
		stack.style.width = `${this.editor.originalCanvas.width}px`;
		stack.style.height = `${this.editor.originalCanvas.height}px`;
		stack.style.transformOrigin = '0 0';
		stack.style.transform = `scale(${(transform.scale.x || 100) / 100}, ${(transform.scale.y || 100) / 100})`;
		const fillMask = this.editor.maskCompositor.getMaskCanvas(layer);
		syncSlotStackTextureOrigins(stack, this.getSlotStack(layer), layer, (item) => (
			this.getSlotMask(layer, item, fillMask)?.canvas || fillMask
		));
	}

	revokeMaskImage(layerId) {
		const currentUrl = this.maskImages.get(layerId)?.url;
		if (currentUrl) {
			URL.revokeObjectURL(currentUrl);
		}
		this.maskImages.delete(layerId);
		Array.from(this.effectMaskImages.keys()).forEach((key) => {
			if (key.startsWith(`${layerId}|`)) this.effectMaskImages.delete(key);
		});
	}

	async ensureLayersPreviewAssetsReady(layers) {
		const glitterIds = new Set(layers
			.filter((layer) => layer.visible)
			.flatMap((layer) => getLayerSlotGlitterIds(layer)));

		await Promise.all([...glitterIds].map((id) => {
			const glitter = this.editor.glitterLibrary.getItemById(id);
			return glitter ? this.editor.glitterLibrary.ensureAssetImageReady(glitter) : null;
		}));
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
		const currentCache = this.maskImages.get(layer.id);

		if (currentCache?.key === cacheKey) {
			return currentCache.url || null;
		}

		const requestStart = this.maskRequestStarts.get(layer.id);
		this.maskRequestStarts.delete(layer.id);

		const canvasStart = performance.now();
		const maskCanvas = this.editor.maskCompositor.getMaskCanvas(layer, { draft: draftMask });
		dbg(`[G-1] getMaskCanvas (${draftMask ? 'brush-draft' : 'full'}): ${(performance.now() - canvasStart).toFixed(1)}ms`);

		this.maskImages.set(layer.id, {
			key: cacheKey,
			url: currentCache?.url || null,
			pending: true,
			fullApplied: false
		});

		// G-1c: for a full-accuracy request (color-picker clicks — NOT brush
		// live-painting, which already gets its speed from MaskCompositor's own
		// draft mode skipping feather/caching), encode a downscaled draft PNG
		// first so glitter appears almost immediately, then silently replace it
		// with the full-resolution encode when that lands. Skipped when the
		// mask is already small enough that downscaling wouldn't help.
		const longestSide = Math.max(maskCanvas.width, maskCanvas.height);
		if (!draftMask && !currentCache?.url && longestSide > 512) {
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
		const draftCanvas = createAppCanvas(0, 0, 'layers/GlitterManager');
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

		const latestCache = this.maskImages.get(layer.id);
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

			const cacheNow = this.maskImages.get(layer.id);
			if (!cacheNow || cacheNow.key !== cacheKey || (isDraft && cacheNow.fullApplied)) {
				URL.revokeObjectURL(nextUrl);
				this._decrementMaskPending(layer.id);
				return;
			}

			const previousUrl = cacheNow.url;
			this.maskImages.set(layer.id, {
				key: cacheKey,
				url: nextUrl,
				pending: cacheNow.pending,
				fullApplied: isDraft ? Boolean(cacheNow.fullApplied) : true
			});

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

	// Pure: MaskCompositor caches the result per layer id.
	buildSelectionMask(layer) { return buildColorSelectionMask(this.editor, layer); }

	// Canvas resize: color-selection seeds live in canvas space, so they move
	// with the content. The painted part of the mask moves in PaintMaskStore.
	reanchorSelectionsForCanvasResize(offsetX, offsetY, layers) {
		(layers || []).forEach((layer) => {
			if (layer.type !== LayerType.GLITTER_FILL) return;
			// The sampled color (r/g/b) is unchanged; only the seed pixel moves.
			(layer.selections || []).forEach((sel) => {
				if (typeof sel.x === 'number') sel.x += offsetX;
				if (typeof sel.y === 'number') sel.y += offsetY;
			});
			this.editor.maskCompositor?.invalidate(layer.id);
		});
	}

	scaleSelectionsForCanvasResize(newWidth, newHeight, scaleX, scaleY, layers) {
		(layers || []).forEach((layer) => {
			if (layer.type !== LayerType.GLITTER_FILL) return;
			(layer.selections || []).forEach((selection) => {
				if (typeof selection.x === 'number') selection.x = Math.max(0, Math.min(newWidth - 1, Math.round(selection.x * scaleX)));
				if (typeof selection.y === 'number') selection.y = Math.max(0, Math.min(newHeight - 1, Math.round(selection.y * scaleY)));
			});
			this.editor.maskCompositor?.invalidate(layer.id);
		});
	}

	// Structural canvas resize shifts the authored mask inside a newly-sized
	// local surface. Compensate the layer placement for that local re-anchor so
	// a transformed mask follows the canvas content exactly once.
	reanchorTransformsForCanvasResize(oldWidth, oldHeight, newWidth, newHeight, offsetX, offsetY, layers) {
		(layers || []).forEach((layer) => {
			if (layer.type !== LayerType.GLITTER_FILL || !layer.transform) return;
			const transform = getLayerTransform(layer);
			const localShiftX = oldWidth / 2 + offsetX - newWidth / 2;
			const localShiftY = oldHeight / 2 + offsetY - newHeight / 2;
			const scaleX = ((transform.scale.x || 100) / 100) * (transform.flipX ? -1 : 1);
			const scaleY = ((transform.scale.y || 100) / 100) * (transform.flipY ? -1 : 1);
			const rotation = (transform.rotation || 0) * Math.PI / 180;
			const scaledX = localShiftX * scaleX;
			const scaledY = localShiftY * scaleY;
			const worldShiftX = scaledX * Math.cos(rotation) - scaledY * Math.sin(rotation);
			const worldShiftY = scaledX * Math.sin(rotation) + scaledY * Math.cos(rotation);
			transform.position.x += offsetX - worldShiftX;
			transform.position.y += offsetY - worldShiftY;
		});
	}

	floodFill(mask, startX, startY, targetColor, thresholdSq) { return floodColorSelection(this.editor, mask, startX, startY, targetColor, thresholdSq); }

	applyFeatherToMask(mask, radius) { return featherColorSelection(this.editor, mask, radius); }

	colorDistanceSq(r1, g1, b1, r2, g2, b2) { return selectionColorDistanceSq(r1, g1, b1, r2, g2, b2); }

	buildExportPlan(layer, context) {
		return context.compositor._buildGlitterFillExportPlan(layer);
	}
	selectGlitter(...args) { return this.editor.glitterLibrary.selectGlitter(...args); }
	updateSelection(...args) { return this.editor.glitterLibrary.updateSelection(...args); }
	getItemById(id) { return this.editor.glitterLibrary.getItemById(id); }
	async init() { this.setupUI(); this.setupEventListeners(); }
}
