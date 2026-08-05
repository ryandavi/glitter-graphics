// ============================================
// GLITTER EDITOR CLASS
// Contains all the logic for the glitter editor - UI and functionality
// ============================================

class GlitterEditor {
	constructor() {
		// ============================================================================
		// DOM REFERENCES
		// ============================================================================
		this.originalCanvas = document.getElementById('originalCanvas');
		this.previewCanvas = document.getElementById('previewCanvas');
		this.previewContainer = document.getElementById('previewContainer');
		this.previewWrapper = document.getElementById('previewWrapper');
		this.canvasElementsContainer = document.getElementById('canvasElementsContainer');

		// ============================================================================
		// CANVAS SETUP
		// ============================================================================
		this.previewCanvas.style.zIndex = '1';
		this.canvasElementsContainer.style.zIndex = '10';
		this.canvasElementsContainer.style.pointerEvents = 'none'; // Allows clicking through to canvas

		this.originalCtx = this.originalCanvas.getContext('2d', { willReadFrequently: true });
		this.previewCtx = this.previewCanvas.getContext('2d', { willReadFrequently: true });

		// ============================================================================
		// IMAGE DATA
		// ============================================================================
		this.originalImage = null;
		this.originalImageData = null;
		this.originalAlphaChannel = null;

		// ============================================================================
		// CONTENT & LAYERS
		// ============================================================================
		this.content = [];
		this.selectedLayerIds = new Set();

		// ============================================================================
		// TOOL & HISTORY
		// ============================================================================
		this.currentTool = null;

		// ============================================================================
		// DISPLAY SETTINGS
		// ============================================================================
		this.showAllLayers = true;
		this.showHints = CONFIG.ui.hints.enabledByDefault;
		this.currentHintDismissed = false;

		// ============================================================================
		// STATE FLAGS
		// ============================================================================
		this.isSaved = false;
		this.projectName = '';
		this.baseImageSource = null;
		this.touchGestureActive = false;
		this.justCompletedDrag = false; // Flag to prevent layer picking immediately after drag
		this.pendingConfirmationResolve = null;
		this.pendingConfirmationValue = false;
		this.pendingAutoGlitterTool = null;
		this.autoGlitterToolPrompt = null;
		this.notifications = new NotificationCenter();

		// ============================================================================
		// EXPORT STATE
		// ============================================================================
		this.exportStartTime = 0;
		this.exportCancelled = false;

		// Render schema-driven panel sections (js/ui/panel-renderer.js +
		// PANEL_SCHEMAS), then the shared transform panels into the hosts the
		// schemas created, BEFORE manager setup — every manager binds against
		// one generated DOM structure, built once (never re-rendered after
		// boot; rebuilding would orphan listeners). MobileManager later moves
		// these same nodes into drawers, so bindings survive re-parenting.
		renderPanelSections(this);
		this.renderTransformPanels();
		this.contextToolbarRenderer = new ContextToolbarRenderer(this);
		this.contextToolbarRenderer.render();

		// ============================================================================
		// MANAGERS
		// ============================================================================
		this.viewport = new ViewportManager(this.previewContainer, this.previewWrapper);
		this.viewport.editor = this;
		this.layerManager = new LayerManager(this);
		this.stickerManager = new StickerManager(this);
		this.glitterManager = new GlitterManager(this);
		this.baseBackgroundManager = new BaseBackgroundManager(this);
		this.autoGlitterManager = new AutoGlitterManager(this);
		this.textGlitterManager = new TextGlitterManager(this);
		this.shapeGlitterManager = new ShapeGlitterManager(this);
		this.pickers = new PickerRegistry(this);
		[
			this.glitterManager,
			this.baseBackgroundManager,
			this.textGlitterManager,
			this.shapeGlitterManager,
			this.stickerManager
		].forEach((manager) => this.pickers.register(manager));
		this.groupTransformManager = new GroupTransformManager(this);
		this.mobileManager = new MobileManager(this);
		this.maskCompositor = new MaskCompositor(this);
		this.maskEditor = new MaskEditor(this);
		this.historyManager = new HistoryManager(this);
		this.projectSerializer = new ProjectSerializer(this);
		this.htmlSceneExporter = new HtmlSceneExporter(this);

		// ============================================================================
		// INITIALIZATION
		// ============================================================================
		this.initializeProjectNameInput();
		const rememberedTool = sessionStorage.getItem('glitter:lastTool');
		const initialTool = Object.values(ToolType).includes(rememberedTool) ? rememberedTool : CONFIG.app.startup.tool;
		this.setTool(this.mobileManager.isMobile && initialTool === ToolType.HAND ? ToolType.SELECT : initialTool);
		this.setupEventListeners();
		this.initializeAltDuplicateFeedback();
		this.initializeCollapsibleSections();
		this.initializeAdvancedDisclosures();
		this.initializeShortcutsModal();
		this.initializeExportSettings();
		this.htmlSceneExporter.initialize();
		this.initializeModalFilters();
	}

	initializeAltDuplicateFeedback() {
		const sync = (armed) => this.previewContainer?.classList.toggle(
			'alt-duplicate-armed', Boolean(armed) && this.currentTool === ToolType.SELECT
		);
		document.addEventListener('keydown', (event) => {
			if (event.key === 'Alt' && !event.repeat) sync(true);
		});
		document.addEventListener('keyup', (event) => {
			if (event.key === 'Alt') sync(false);
		});
		window.addEventListener('blur', () => {
			sync(false);
			this.endTemporaryHandTool();
		});
		document.getElementById('statusZoom')?.addEventListener('dblclick', () => {
			if (this.originalImage) this.viewport.resetZoom({ animate: true });
		});
		this.previewContainer?.addEventListener('dblclick', (event) => {
			if (this.currentTool !== ToolType.SELECT || !event.target.closest(TRANSFORMABLE_LAYER_ELEMENT_SELECTOR)) return;
			const layer = this.layerManager.getActiveLayer();
			if (layer?.type !== LayerType.TEXT_GLITTER) return;
			this.textGlitterManager?.focusTextInput?.(true);
		});
	}

	setDuplicateDragFeedback(active, count = 1) {
		this.previewContainer?.classList.toggle('duplicate-drag-active', Boolean(active));
		this.duplicateDragStatus = active ? (count > 1 ? `Duplicating ${count} layers` : 'Duplicating layer') : '';
		const status = document.getElementById('statusText');
		if (status) status.textContent = this.duplicateDragStatus;
	}

	addDuplicateGhost(sourceTransform, targetTransform) {
		if (!sourceTransform?.element || !targetTransform || targetTransform.refreshElementReference?.()) return null;
		const ghost = sourceTransform.element.cloneNode(true);
		ghost.removeAttribute('id');
		ghost.removeAttribute('data-layer-id');
		ghost.querySelectorAll?.('[id], [data-layer-id]').forEach((node) => {
			node.removeAttribute('id');
			node.removeAttribute('data-layer-id');
		});
		ghost.dataset.duplicateGhost = '';
		ghost.style.pointerEvents = 'none';
		sourceTransform.element.parentElement?.appendChild(ghost);
		this._duplicateGhosts ||= new Map();
		this._duplicateGhosts.set(targetTransform, ghost);
		this.syncDuplicateGhost(targetTransform);

		let frames = 0;
		const retireWhenReady = () => {
			if (!ghost.isConnected) return;
			if (targetTransform.refreshElementReference?.() || frames++ > 300) {
				ghost.remove();
				this._duplicateGhosts?.delete(targetTransform);
				return;
			}
			requestAnimationFrame(retireWhenReady);
		};
		requestAnimationFrame(retireWhenReady);
		return ghost;
	}

	syncDuplicateGhost(targetTransform) {
		const ghost = this._duplicateGhosts?.get(targetTransform);
		if (!ghost?.isConnected) return;
		targetTransform.applyTransform(ghost, targetTransform.getDimensions());
		ghost.style.pointerEvents = 'none';
	}

	syncDuplicateGhosts() {
		this._duplicateGhosts?.forEach((_ghost, transform) => this.syncDuplicateGhost(transform));
	}

	// ===== DEBUG CONFIGURATION LOADER =====
	async loadDebugConfig() {
		if (!DEBUG_CONFIG.enabled) return;


		// 1. Load blank canvas
		await this.loadBlankImage(
			DEBUG_CONFIG.canvas.width,
			DEBUG_CONFIG.canvas.height,
			DEBUG_CONFIG.canvas.color
		);

		// Wait for image to fully load
		await new Promise(resolve => {
			const checkImage = setInterval(() => {
				if (this.originalImage) {
					clearInterval(checkImage);
					resolve();
				}
			}, 50);
		});

		// 2. Load each sticker preset
		for (const stickerPreset of DEBUG_CONFIG.stickers) {
			const stickerId = stickerPreset.id;
			const stickerInfo = this.stickerManager.getItemById(stickerId);

			if (!stickerInfo) {
				console.warn(`[DEBUG] Sticker ID ${stickerId} not found, skipping`);
				continue;
			}

			// Create the sticker layer with default settings
			const layer = this.stickerManager.createLayer(stickerId);

			// Override position from preset
			layer.stickerData.transform.position.x = stickerPreset.x;
			layer.stickerData.transform.position.y = stickerPreset.y;

			// Insert layer
			this.layerManager.insertLayer(layer);

			// Render the sticker
			this.stickerManager.renderLayer(layer);

			dbg(`[DEBUG] Loaded sticker: ${stickerInfo.name} at (${stickerPreset.x}, ${stickerPreset.y})`);
		}

		// 3. Update UI
		this.layerManager.renderLayersList();
		this.requestPreviewUpdate();
		this.updateActionButtons();
		this.saveState('Edit document');

	}

	// ===== UTILITY METHODS =====

	// Execute async function with element disabled
	async withDisabled(element, asyncFn) {
		if (!element) return;
		element.disabled = true;
		try {
			await asyncFn();
		} finally {
			element.disabled = false;
		}
	}

	initializeProjectNameInput() {
		const input = document.getElementById('projectNameInput');
		if (!input) return;

		input.placeholder = 'Name...';
		input.value = this.projectName;
		input.addEventListener('input', () => {
			this.setProjectName(input.value, { markDirty: true, syncInput: false });
		});
	}

	setProjectName(name, options = {}) {
		const {
			markDirty = true,
			syncInput = true
		} = options;
		this.projectName = typeof name === 'string' ? name : '';

		if (syncInput) {
			const input = document.getElementById('projectNameInput');
			if (input && input.value !== this.projectName) {
				input.value = this.projectName;
			}
		}

		if (markDirty && (this.originalImage || this.historyManager.canUndo())) {
			this.isSaved = false;
		}
	}

	getProjectFileName(ext) {
		const baseName = sanitizeFileName(this.projectName) || CONFIG.export.core.defaultBaseName;
		return `${baseName}.${ext}`;
	}

	getProjectDownloadName() {
		const baseName = sanitizeFileName(this.projectName);
		if (!baseName) return `${CONFIG.export.core.defaultBaseName}.${CONFIG.project.extension}`;
		const suffix = sanitizeFileName(CONFIG.project.fileNameSuffix) || '';
		return `${baseName}${suffix}.${CONFIG.project.extension}`;
	}

	// Common layer update pattern
	updateLayerAndSave(updatePreview = true) {
		this.saveActiveLayerSettings();
		if (updatePreview) {
			this.requestPreviewUpdate();
		}
		this.saveState('Edit document');
	}

	// Layer type helpers
	isGlitterLayer(layer) {
		return layer && layer.type === LayerType.GLITTER_FILL;
	}

	isStickerLayer(layer) {
		return layer && layer.type === LayerType.STICKER;
	}

	isTextLayer(layer) {
		return layer && layer.type === LayerType.TEXT_GLITTER;
	}

	// ===== GETTERS & SETTERS =====
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

	// ===== INITIALIZATION =====

	async init() {
		initPixelScaler();
		initTooltips();
		installClipboardHandlers(this);
		this.exporter = new GifExporter();
		this.mp4Exporter = new Mp4Exporter(this.exporter);
		await this.stickerManager.init();
		await this.glitterManager.init(); // NEW
		await this.textGlitterManager.init();
		this.updateSidePanelUI(null);
	}

	// ===== SETTINGS PERSISTENCE =====



	// ===== INITIALIZATION =====

	// ===== EVENT LISTENERS =====

	setupEventListeners() {
		this.setupToolbarListeners();
		this.setupAutoSelectListener();
		this.setupColorPickerContextListeners();
		this.setupLayerSettingsListeners();
		this.setupSliderListeners();
		this.setupColorAdjustListeners();
		this.setupMaskEditorListeners();
		this.setupTransformListeners('sticker', LayerType.STICKER, () => this.stickerManager);
		this.setupTransformListeners('text', LayerType.TEXT_GLITTER, () => this.textGlitterManager);
		this.setupTransformListeners('shape', LayerType.SHAPE, () => this.shapeGlitterManager);
		this.setupExportListeners();
		this.setupImageListeners();
		this.setupModalListeners();
		this.setupPreviewListeners();
		this.setupGlobalListeners();
		this.setupHelpfulMessageListeners();
		this.setupCanvasSizeControls();
		this.setupScaleDesignControls();
	}

	setupAutoSelectListener() {
		const toggle = document.getElementById('contextAutoSelect');
		if (!toggle) return;
		toggle.checked = PREFERENCES.get('autoSelect');
		toggle.addEventListener('change', () => {
			PREFERENCES.set('autoSelect', toggle.checked);
			this.saveSettingsToStorage();
			this.updateStatus(toggle.checked
				? 'Auto-Select on: click an object to select it'
				: 'Auto-Select off: canvas drags keep the selected layer');
		});
	}



	// ===== HELPER: Attach slider with live update and reset =====
	setupSlider(sliderId, valueId, suffix, updateCallback, resetValue) {
		const slider = document.getElementById(sliderId);
		const valueDisplay = document.getElementById(valueId);
		const resetBtn = document.getElementById('reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1));

		if (!slider || !valueDisplay) return;

		const appBindingConfig = {
			threshold: {
				onApply: () => {
					this.saveActiveLayerSettings();
					this.debouncedSliderUpdate();
				},
				onCommit: () => this.saveState('Edit document')
			},
			feather: {
				onApply: () => {
					this.saveActiveLayerSettings();
					this.debouncedSliderUpdate();
				},
				onCommit: () => this.saveState('Edit document')
			},
			scale: {
				onApply: () => {
					this.saveActiveLayerSettings();
					this.debouncedSliderUpdate();
				},
				onCommit: () => this.saveState('Edit document')
			},
			opacity: {
				onApply: () => {
					this.saveActiveLayerSettings();
					this.debouncedSliderUpdate();
				},
				onCommit: () => this.saveState('Edit document')
			}
		};
		const binding = appBindingConfig[sliderId] || null;

		bindSlider(slider, valueDisplay, {
			suffix,
			resetValue,
			resetButton: resetBtn,
			apply: (value, sliderEl, event) => {
				if (typeof updateCallback === 'function') {
					updateCallback(event || { target: sliderEl });
				}
				binding?.onApply?.(value, sliderEl);
			},
			onCommit: binding?.onCommit ? (value, sliderEl, event) => binding.onCommit(value, sliderEl, event) : null
		});
	}

	// ===== HELPER: Attach checkbox that syncs with another checkbox =====
	syncCheckboxes(id1, id2, bidirectional = true) {
		const elem1 = document.getElementById(id1);
		const elem2 = document.getElementById(id2);

		if (!elem1 || !elem2) return;

		let syncing = false;

		elem1.addEventListener('change', (e) => {
			if (syncing) return;
			syncing = true;
			elem2.checked = e.target.checked;
			elem2.dispatchEvent(new Event('change'));
			syncing = false;
		});

		if (bidirectional) {
			elem2.addEventListener('change', (e) => {
				if (syncing) return;
				syncing = true;
				elem1.checked = e.target.checked;
				elem1.dispatchEvent(new Event('change'));
				syncing = false;
			});
		}
	}


	// ===== TOOLBAR LISTENERS =====
	setupToolbarListeners() {
		const tools = [
			{ id: 'selectTool', type: ToolType.SELECT },
			{ id: 'textTool', type: ToolType.TEXT },
			{ id: 'shapeTool', type: ToolType.SHAPE },
			{ id: 'colorPickerTool', type: ToolType.COLOR_PICKER },
			{ id: 'handTool', type: ToolType.HAND },
			{ id: 'zoomTool', type: ToolType.ZOOM }
		];

		tools.forEach(({ id, type }) => {
			const btn = document.getElementById(id);
			if (btn) btn.addEventListener('click', () => this.setTool(type));
		});

		// Brush and Eraser are both the Mask Brush tool with a different paint mode,
		// so each button sets the tool then forces its own mode.
		document.getElementById('brushTool')?.addEventListener('click', () => {
			this.setTool(ToolType.BRUSH);
			this.maskEditor?.setMode('add');
		});
		document.getElementById('eraserTool')?.addEventListener('click', () => {
			this.setTool(ToolType.BRUSH);
			this.maskEditor?.setMode('sub');
		});

		const actions = [
			{ id: 'undoTool', handler: () => this.undo() },
			{ id: 'redoTool', handler: () => this.redo() },
			{ id: 'clearAllTool', handler: () => this.resetAll() }
		];

		actions.forEach(({ id, handler }) => {
			const btn = document.getElementById(id);
			if (btn) btn.addEventListener('click', handler);
		});
	}


	getSelectedActionableLayers() {
		return this.layerManager.getSelectedLayers().filter((layer) => layer.type !== LayerType.BASE_IMAGE);
	}

	cloneSelectedLayers() {
		const allSelectedLayers = this.layerManager.getSelectedLayers();
		if (allSelectedLayers.some((layer) => layer.type === LayerType.BASE_IMAGE || layer.locked)) {
			this.showError('Unlock protected layers or remove them from the selection before duplicating');
			return null;
		}
		const selectedLayers = this.getSelectedActionableLayers();
		if (!selectedLayers.length) return null;

		if (selectedLayers.length > 1) {
			return this.layerManager.cloneLayers(selectedLayers.map((layer) => layer.id));
		}

		return this.layerManager.cloneLayer(selectedLayers[0].id);
	}

	async deleteSelectedLayers() {
		const allSelectedLayers = this.layerManager.getSelectedLayers();
		if (allSelectedLayers.some((layer) => layer.type === LayerType.BASE_IMAGE || layer.locked)) {
			this.showError('Unlock protected layers or remove them from the selection before deleting');
			return false;
		}
		const selectedLayers = this.getSelectedActionableLayers();
		if (!selectedLayers.length) return false;

		const isPlural = selectedLayers.length > 1;
		const confirmed = await this.confirmAction({
			title: isPlural ? 'Delete Layers' : 'Delete Layer',
			message: isPlural
				? 'These layers and everything on them will be permanently removed.'
				: 'This layer and everything on it will be permanently removed.',
			confirmLabel: 'Delete',
			destructive: true
		});
		if (!confirmed) {
			return false;
		}

		if (isPlural) {
			return this.layerManager.deleteLayers(selectedLayers.map((layer) => layer.id));
		}

		return this.layerManager.deleteLayer(selectedLayers[0].id);
	}

	setupColorPickerContextListeners() {
		const contextThreshold = document.getElementById('contextThreshold');
		const contextThresholdValue = document.getElementById('contextThresholdValue');
		const contextMultiSelect = document.getElementById('contextMultiSelect');
		const contextContiguous = document.getElementById('contextContiguous');

		// Threshold slider
		if (contextThreshold && contextThresholdValue) {
			contextThreshold.addEventListener('input', (e) => {
				const value = e.target.value;
				contextThresholdValue.textContent = value;

				// Sync with design panel
				const threshold = document.getElementById('threshold');
				const thresholdValue = document.getElementById('thresholdValue');
				if (threshold) threshold.value = value;
				if (thresholdValue) thresholdValue.textContent = value;

				this.updateResetButton('threshold');

				// Save and debounce preview update
				this.saveActiveLayerSettings();
				this.debouncedSliderUpdate();
			});

			contextThreshold.addEventListener('change', () => {
				this.saveState('Edit document');
			});
		}

		// Multi-select is handled by bidirectional sync
		if (contextMultiSelect) {
			contextMultiSelect.addEventListener('change', (e) => {
				this.handleMultiSelectChange(e.target.checked);
			});
		}

		// Contiguous is handled by bidirectional sync
		if (contextContiguous) {
			contextContiguous.addEventListener('change', () => {
				this.updateLayerAndSave();
			});
		}
	}

	handleMultiSelectChange(checked) {
		const layer = this.layerManager.getActiveLayer();
		if (!layer) return;

		// Update layer directly
		layer.settings.multiSelect = checked;

		// If turning off multi-select and we have multiple selections, keep only first
		if (!checked && layer.selections && layer.selections.length > 1) {
			layer.selections = [layer.selections[0]];
		}

		// Update the count
		const contextSelectionCount = document.getElementById('contextSelectionCount');
		if (contextSelectionCount) {
			const count = layer.selections ? layer.selections.length : 0;
			contextSelectionCount.textContent = count > 1 ? count : '';
		}

		this.requestPreviewUpdate();
		this.updateSelectedColorsDisplay();
		this.saveState('Edit document');
	}


	setupLayerSettingsListeners() {
		const contiguous = document.getElementById('contiguous');
		const invert = document.getElementById('invert');
		const multiSelect = document.getElementById('multiSelect');

		// Sync contiguous checkboxes bidirectionally
		this.syncCheckboxes('contiguous', 'contextContiguous');

		if (contiguous) {
			contiguous.addEventListener('change', () => {
				this.updateLayerAndSave();
			});
		}

		if (invert) {
			invert.addEventListener('change', async () => {
				const layer = this.layerManager.getActiveLayer();
				if (!layer) {
					return;
				}

				if (this.mobileManager?.isMobile) {
					const confirmed = await this.confirmAction({
						title: 'Invert Mask?',
						message: invert.checked
							? 'Invert this layer mask so glitter fills everything except the selected and painted areas?'
							: 'Return this layer mask to its normal, non-inverted state?',
						confirmLabel: 'Apply'
					});
					if (!confirmed) {
						invert.checked = Boolean(layer.settings?.invert);
						this.maskEditor?.loadLayer(layer);
						return;
					}
				}

				this.saveActiveLayerSettings();
				if (layer && layer.type === LayerType.GLITTER_FILL && (layer.maskVersion || this.glitterManager.getPaintMask(layer.id))) {
					this.glitterManager.commitPaintState(layer);
				}
				this.requestPreviewUpdate();
				this.layerManager.renderLayersList();
				this.updateActionButtons();
				this.maskEditor?.loadLayer(layer);
				this.saveState('Edit document');
			});
		}

		// Sync multi-select checkboxes bidirectionally
		this.syncCheckboxes('multiSelect', 'contextMultiSelect');

		if (multiSelect) {
			multiSelect.addEventListener('change', (e) => {
				this.handleMultiSelectChange(e.target.checked);
			});
		}

		// Multi-select checkbox
		document.getElementById('multiSelect')?.addEventListener('change', () => {
			this.updateHelpfulMessage();
		});
	}

	setupSliderListeners() {
		// Threshold
		this.setupSlider('threshold', 'thresholdValue', '', (e) => {
			// Sync with context toolbar
			const contextThreshold = document.getElementById('contextThreshold');
			const contextThresholdValue = document.getElementById('contextThresholdValue');
			if (contextThreshold) contextThreshold.value = e.target.value;
			if (contextThresholdValue) contextThresholdValue.textContent = e.target.value;
		}, CONFIG.tools.selection.defaults.threshold);

		this.setupSlider('feather', 'featherValue', '', null, CONFIG.tools.selection.defaults.feather);
		this.setupSlider('scale', 'scaleValue', '%', null, CONFIG.tools.effects.defaults.scale);
		this.setupSlider('opacity', 'opacityValue', '%', null, CONFIG.tools.effects.defaults.opacity);
	}

	setupMaskEditorListeners() {
		this.setupSlider('maskBrushSize', 'maskBrushSizeValue', 'px', () => {
			this.maskEditor?._updateBrushCursorSize();
		}, CONFIG.tools.maskBrush.defaults.size);

		this.setupSlider('maskBrushSoftness', 'maskBrushSoftnessValue', '%', () => {
			this.maskEditor?.renderOverlay();
		}, CONFIG.tools.maskBrush.defaults.softness);

		this.setupSlider('maskBrushFlow', 'maskBrushFlowValue', '%', () => {
			this.maskEditor?.renderOverlay();
		}, CONFIG.tools.maskBrush.defaults.flow);

		// Spacing is a percentage of brush size; it only affects future stamps
		// (the resulting stroke is baked into the mask), so no live re-render.
		this.setupSlider('maskBrushSpacing', 'maskBrushSpacingValue', '%', null,
			Math.round(CONFIG.tools.maskBrush.stroke.stampSpacing * 100));

		// Smoothing (EMA stabilizer); affects the live stroke only, no re-render.
		this.setupSlider('maskBrushSmoothing', 'maskBrushSmoothingValue', '%', null,
			CONFIG.tools.maskBrush.defaults.smoothing ?? 0);

		this.syncQuickSlider('maskBrushSize', 'maskBrushSizeQuick', 'maskBrushSizeQuickValue', 'px');

		this.maskEditor?.setupUIListeners();
	}

	// Mirrors a canonical slider's value onto a compact duplicate (the floating
	// quick-access brush size, mirroring the sidebar's canonical Size slider).
	syncQuickSlider(canonicalId, quickId, quickValueId, suffix) {
		const canonical = document.getElementById(canonicalId);
		const quick = document.getElementById(quickId);
		const quickValue = document.getElementById(quickValueId);
		if (!canonical || !quick) return;

		quick.min = canonical.min;
		quick.max = canonical.max;
		quick.value = canonical.value;
		if (quickValue) quickValue.innerHTML = formatUnit(canonical.value, suffix);

		let syncing = false;
		canonical.addEventListener('input', () => {
			if (syncing) return;
			syncing = true;
			quick.value = canonical.value;
			if (quickValue) quickValue.innerHTML = formatUnit(canonical.value, suffix);
			syncing = false;
		});

		quick.addEventListener('input', () => {
			if (syncing) return;
			syncing = true;
			canonical.value = quick.value;
			if (quickValue) quickValue.innerHTML = formatUnit(quick.value, suffix);
			canonical.dispatchEvent(new Event('input'));
			syncing = false;
		});
	}








	getResetValueForSlider(sliderId) {
		const resetValues = {
			threshold: CONFIG.tools.selection.defaults.threshold,
			feather: CONFIG.tools.selection.defaults.feather,
			scale: CONFIG.tools.effects.defaults.scale,
			opacity: CONFIG.tools.effects.defaults.opacity,
			glitterHue: CONFIG.tools.glitter.defaults.colorAdjust.hue,
			glitterSaturation: CONFIG.tools.glitter.defaults.colorAdjust.saturation,
			glitterBrightness: CONFIG.tools.glitter.defaults.colorAdjust.brightness
		};
		return resetValues[sliderId];
	}

	updateResetButton(sliderId) {
		const resetBtn = document.getElementById('reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1));
		const slider = document.getElementById(sliderId);
		const defaultValue = this.getResetValueForSlider(sliderId);
		if (resetBtn && slider && defaultValue !== undefined) {
			resetBtn.disabled = parseInt(slider.value) === defaultValue;
		}
	}

	async loadBlankImage(width, height, color = CONFIG.canvas.defaults.blankDocument.color, options = {}) {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');

		// Handle transparent background
		if (color === 'transparent') {
			// Leave canvas transparent (don't fill)
		} else {
			ctx.fillStyle = color;
			ctx.fillRect(0, 0, width, height);
		}

		const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
		const fileName = color === 'transparent'
			? `blank_${width}x${height}_transparent.png`
			: `blank_${width}x${height}.png`;
		const file = new File([blob], fileName, { type: 'image/png' });

		await this.loadImageFile(file, {
			...options,
			source: {
				kind: 'preset',
				preset: { width, height, color }
			}
		});
		const baseLayer = this.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
		const normalizedBase = this.baseBackgroundManager?.normalizeLayer(baseLayer);
		if (normalizedBase) {
			normalizedBase.background.mode = color === 'transparent' ? 'none' : 'solid';
			if (color !== 'transparent') normalizedBase.background.color = color;
			// loadImageFile establishes the new project's initial history snapshot;
			// replace it with the authored background mode, not the PNG transport.
			this.historyManager.reset(this.historyManager.createStateSnapshot());
			this.requestPreviewUpdate();
			this.layerManager.renderLayersList();
		}
		this.updateStatus(`Created ${width}×${height} canvas`);
		return true;
	}

	setTool(tool, options = {}) {
		if (tool === ToolType.BRUSH && !this.maskEditor?.canActivate()) return;

		if (this.currentTool === tool) return;
		if (this.autoGlitterManager?.isSessionActive() && !this.autoGlitterManager.allowsPreviewTool(tool)) {
			this.pendingAutoGlitterTool = tool;
			if (!this.autoGlitterToolPrompt) {
				const temporaryRequest = this.temporaryHandToolActive;
				this.autoGlitterToolPrompt = this.autoGlitterManager.requestDiscardSession().then((discarded) => {
					const targetTool = this.pendingAutoGlitterTool;
					this.pendingAutoGlitterTool = null;
					this.autoGlitterToolPrompt = null;
					if (!discarded || !targetTool) return;
					if (temporaryRequest && targetTool === ToolType.HAND && !this.temporaryHandToolActive) return;
					this.setTool(targetTool);
				});
			}
			return;
		}

		this.currentTool = tool;
		if (!this.temporaryHandToolActive && options.persist !== false) sessionStorage.setItem('glitter:lastTool', tool);
		this.currentHintDismissed = false; // Reset dismissed flag when tool changes


		// Remove all tool classes from body
		document.body.classList.remove('tool-select', 'tool-text', 'tool-shape', 'tool-hand', 'tool-colorPicker', 'tool-zoom', 'tool-brush');

		// Add current tool class
		document.body.classList.add(`tool-${tool}`);

		// 1. Update Toolbar Buttons
		document.querySelectorAll('.toolbar-group button').forEach(btn => {
			btn.classList.remove('active');
		});

		// Fix: The tool name needs to match the button ID exactly
		const toolButtonIds = {
			'select': 'selectTool',
			'text': 'textTool',
			'shape': 'shapeTool',
			'hand': 'handTool',
			'colorPicker': 'colorPickerTool',
			'brush': 'brushTool',
			'zoom': 'zoomTool'
		};

		const activeBtn = document.getElementById(toolButtonIds[tool]);
		if (activeBtn) {
			activeBtn.classList.add('active');
		}

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

		// NEW: Handle transform handles visibility
		this.syncTransformHandlesForActiveLayer();

		// Sync mask editing with the active tool (enter/exit brush painting)
		this.maskEditor?.onToolChanged(tool);

		// 3. Update Context Toolbars
		this.updateContextToolbars();

		// Reconcile the sidebar accordion with the new tool: entering Brush/Eraser
		// opens its Settings; leaving a settings tool returns focus to the selected
		// layer's Properties (or the Gallery). Only on an actual tool change (setTool
		// early-returns when unchanged), so it never fights a manual accordion toggle.
		this.syncCollapsibleSections?.(this.getPreferredDesignSection(this.layerManager.getActiveLayer()));

		// Update helpful message
		this.updateHelpfulMessage();

		this.updateStatus(`Active tool: ${tool}`);

	}


	updateContextToolbars() {
		const brushSettingsSection = document.getElementById('brushSettingsSection');
		const toolbarConfigs = CONFIG.ui.contextToolbars || [];
		const toolbars = toolbarConfigs.map((config) => ({
			config,
			element: document.getElementById(config.id)
		}));

		// Hide all first
		toolbars.forEach(({ element }) => element?.classList.remove('visible'));
		if (brushSettingsSection) brushSettingsSection.classList.remove('visible');
		if (!this.originalImage) return;
		if (this.autoGlitterManager?.isSessionActive() && !this.autoGlitterManager.allowsPreviewTool(this.currentTool)) return;

		const layer = this.layerManager.getActiveLayer();
		const hasMultiSelection = this.layerManager.hasMultiSelection();
		const activeToolbar = toolbars.find(({ config, element }) => {
			if (!element || config.tool !== this.currentTool) return false;
			if (hasMultiSelection && config.allowMultiSelection) return true;
			if (config.layerTypes && (!layer || !config.layerTypes.includes(layer.type))) return false;
			if (config.requiresStickerSource && layer?.type === LayerType.STICKER && !layer.stickerSourceId) return false;
			if (config.requiresSelections && !layer?.selections?.length) return false;
			return true;
		});

		activeToolbar?.element.classList.add('visible');
		if (activeToolbar?.config.id === 'layerCenterControls') {
			const canTransformSelection = (hasMultiSelection && this.layerManager.canTransformMultiSelection()) || Boolean(
				layer
				&& isTransformableLayerType(layer.type)
				&& !layer.locked
				&& (layer.type !== LayerType.STICKER || layer.stickerSourceId)
			);
			['centerLayerHorizontal', 'centerLayerVertical', 'duplicateLayerSelection'].forEach((id) => {
				const button = document.getElementById(id);
				if (button) button.hidden = !canTransformSelection;
			});
		}

		if (this.currentTool === ToolType.SELECT && layer?.type === LayerType.STICKER && !hasMultiSelection) {
			if (layer.stickerSourceId) {
				this.setSettingsEmptyState('stickerSettings', false);
				this.loadStickerSettings(layer);
			} else {
				this.setSettingsEmptyState('stickerSettings', true);
			}
		}
		if (activeToolbar?.config.id === 'colorPickerControls') this.updateColorPickerControls();

		if (this.currentTool === ToolType.BRUSH) {
			if (brushSettingsSection) {
				brushSettingsSection.classList.add('visible');
				this.syncCollapsibleSections?.('brushSettings');
			}
		}

		this.syncToolSettingsSectionVisibility?.(layer);

		// On mobile the brush settings section is tool-scoped, so relocate it into
		// the settings drawer while brushing instead of letting it show in the
		// Design drawer (it keeps the .visible class set/cleared just above).
		this.mobileManager?.syncToolSettingsPlacement?.();
		this.mobileManager?.syncBrushSettingsPlacement?.();
	}

	// ===== HELPFUL MESSAGES =====

	updateHelpfulMessage() {
		updateHelpfulMessageFromRules(this);
	}


	setupHelpfulMessageListeners() {
		const helpfulMessage = document.getElementById('helpfulMessage');

		// Prevent clicks from propagating to canvas/tools below
		if (helpfulMessage) {
			helpfulMessage.addEventListener('mousedown', (e) => {
				e.stopPropagation();
			});
			helpfulMessage.addEventListener('pointerdown', (e) => {
				e.stopPropagation();
			});

			// CLICK-TO-DISMISS: Click anywhere on message to dismiss
			// EXCEPT on the "Don't show hints" button
			helpfulMessage.addEventListener('click', (e) => {
				e.stopPropagation();

				// Don't dismiss if clicking the "Don't show hints" button
				if (e.target.closest('#helpfulMessageDisable')) {
					return; // Let the button handle it
				}

				// Dismiss the current hint
				this.currentHintDismissed = true;
				helpfulMessage.classList.remove('visible');
			});
		}

		// Close button - now redundant but keep for explicit close action
		const closeBtn = document.getElementById('helpfulMessageClose');
		if (closeBtn) {
			closeBtn.addEventListener('click', (e) => {
				e.stopPropagation(); // Prevent double-handling

				// Dismiss the current hint
				this.currentHintDismissed = true;
				helpfulMessage.classList.remove('visible');

				// The parent click handler will dismiss
			});
		}

		// Disable button - turn off hints entirely
		const disableBtn = document.getElementById('helpfulMessageDisable');
		if (disableBtn) {
			disableBtn.addEventListener('click', (e) => {
				e.stopPropagation(); // Prevent the parent click handler

				// Disable hints
				this.showHints = false;

				// Update checkbox in settings
				const showHintsInput = document.getElementById('showHelpfulHints');
				if (showHintsInput) {
					showHintsInput.checked = false;
				}

				// Save to storage
				this.saveSettingsToStorage();

				// Hide message
				helpfulMessage.classList.remove('visible');
			});
		}
	}

	updateColorPickerControls() {
		dbg(`Updating color picker controls`);
		const layer = this.layerManager.getActiveLayer();
		if (!layer || layer.type !== LayerType.GLITTER_FILL) return;

		dbg(`Updating color picker controls for layer ${layer.id}`);

		const contextThreshold = document.getElementById('contextThreshold');
		const contextThresholdValue = document.getElementById('contextThresholdValue');
		const contextMultiSelect = document.getElementById('contextMultiSelect');
		const contextContiguous = document.getElementById('contextContiguous');
		const contextSelectionCount = document.getElementById('contextSelectionCount');

		if (contextThreshold && contextThresholdValue) {
			contextThreshold.value = layer.settings.threshold;
			contextThresholdValue.textContent = layer.settings.threshold;
		}

		if (contextMultiSelect) {
			contextMultiSelect.checked = layer.settings.multiSelect;
		}

		if (contextContiguous) {
			contextContiguous.checked = layer.settings.contiguous;
		}

		if (contextSelectionCount) {
			const count = layer.selections ? layer.selections.length : 0;
			contextSelectionCount.textContent = count > 1 ? count : '';
		}
	}

	handleKeyUp(e) {
		this.shiftHeld = e.shiftKey;
		if (e.code === 'Space' && this.temporaryHandToolActive) {
			this.endTemporaryHandTool();
		}
		if (e.key === 'Alt') {
			if (this.currentTool === ToolType.ZOOM) {
				this.previewContainer.classList.remove('zoom-out-mode');
			}
		}
	}

	endTemporaryHandTool() {
		if (!this.temporaryHandToolActive) return;
		this.temporaryHandToolActive = false;
		if (this.currentTool === ToolType.HAND) {
			this.setTool(this.toolBeforeTemporaryHand || ToolType.SELECT);
		}
		this.toolBeforeTemporaryHand = null;
	}

	handleKeyboard(e) {
		// Track Shift so slider drags (which fire modifier-less 'input' events) can
		// snap — mirrors the rotation handle's Shift-to-snap.
		this.shiftHeld = e.shiftKey;

		// Don't trigger shortcuts when typing in input fields
		const activeElement = document.activeElement;
		const isTyping = activeElement && (
			activeElement.tagName === 'INPUT' ||
			activeElement.tagName === 'TEXTAREA' ||
			activeElement.isContentEditable
		);

		if (e.code === 'Space' && !isTyping && !e.repeat && this.originalImage && !this.temporaryHandToolActive) {
			e.preventDefault();
			this.toolBeforeTemporaryHand = this.currentTool;
			this.temporaryHandToolActive = true;
			this.setTool(ToolType.HAND);
			return;
		}

		// Arrow keys nudge the selected movable layer (sticker/text/shape) before
		// the typing guard runs: a selected layer treats arrows as "move me", the
		// sticker behavior. If focus is parked in the text layer's own content field
		// (post-create / post-edit), blur it so moving takes over — the same as
		// clicking off the field. Arrows in any OTHER input still fall through to the
		// guard for normal caret navigation.
		if (!this.autoGlitterManager?.isSessionActive() && this.tryArrowNudge(e)) return;

		// Allow Escape to work in inputs (to blur/close things)
		// Allow Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+S while typing.
		const isDocumentShortcut = (e.ctrlKey || e.metaKey) &&
			(e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y' || e.key === 's' || e.key === 'S');
		if (isTyping && e.key !== 'Escape' &&
			!isDocumentShortcut) {
			return;
		}

		if (e.key === 'Alt' && this.currentTool === ToolType.ZOOM) {
			this.previewContainer.classList.add('zoom-out-mode');
		}

		if (e.key === 'Escape') {
			if (this.autoGlitterManager?.isSessionActive()) {
				this.autoGlitterManager.requestDiscardSession();
				e.preventDefault();
				return;
			}
			const activeGradientEditor = document.activeElement?.closest?.('.effect-gradient-editor');
			if (activeGradientEditor) {
				document.activeElement.blur();
				e.preventDefault();
				return;
			}
			if (this.pickers.closeActive()) {
				e.preventDefault();
				return;
			}
			// Let ModalManager handle modal closing
			if (this.modalManager.closeTopModal()) {
				return; // A modal was closed, we're done
			}

			const activeLayer = this.layerManager.getActiveLayer();
			const activeTransform = this.getMovableLayerContext(activeLayer)?.manager?.layerTransforms?.get(activeLayer?.id);
			if (this.groupTransformManager?.cancelActiveDrag?.() || activeTransform?.cancelActiveDrag?.()) {
				e.preventDefault();
				return;
			}

			// No modal was open, switch to select tool
			if (this.layerManager.hasMultiSelection()) this.layerManager.clearSelection();
			this.setTool(ToolType.SELECT);
		}

		if (this.autoGlitterManager?.isSessionActive()) {
			let handled = true;
			if (e.key === 'h' || e.key === 'H') this.setTool(ToolType.HAND);
			else if (!e.ctrlKey && !e.metaKey && (e.key === 'z' || e.key === 'Z')) this.setTool(ToolType.ZOOM);
			else if ((e.ctrlKey || e.metaKey) && e.key === '0') this.viewport.zoomToFit({ animate: true });
			else if ((e.ctrlKey || e.metaKey) && e.key === '1') this.viewport.resetZoom({ animate: true });
			else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) this.viewport.zoomIn(null, null, { animate: true });
			else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) this.viewport.zoomOut(null, null, { animate: true });
			else handled = false;
			if (handled || ((e.ctrlKey || e.metaKey) && /[aszy]/i.test(e.key))) e.preventDefault();
			return;
		}

		dispatchKeyboardCommand(this, e, { isTyping });
	}

	// Arrow-key nudge for the selected movable layer (1px, 10px with Shift).
	// Returns true when it handled the key. Runs ahead of the typing guard so a
	// selected text/shape layer moves like a sticker; the text content field is
	// blurred on the first nudge so continued typing needs a deliberate refocus.
	// Any other focused input keeps its arrows (returns false, falls through).
	tryArrowNudge(e) {
		if (this.currentTool !== ToolType.SELECT) return false;
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' &&
			e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;

		const hasMultiSelection = this.layerManager.hasMultiSelection();
		if (hasMultiSelection && !this.layerManager.canTransformMultiSelection()) {
			e.preventDefault();
			this.showError('This selection cannot move because it includes a locked, Base Image, or Glitter Fill layer');
			return true;
		}
		const layer = this.layerManager.getActiveLayer();
		const ctx = this.getMovableLayerContext(layer);
		const transform = this.getLayerTransformData(layer);
		if (!hasMultiSelection && (!ctx || !ctx.manager || !transform || this.isLayerContentLocked(layer))) return false;

		// Only override input focus for the text layer's own content field —
		// leave unrelated inputs (search boxes, numeric fields) to their carets.
		const active = document.activeElement;
		const isField = active && (active.tagName === 'INPUT' ||
			active.tagName === 'TEXTAREA' || active.isContentEditable);
		if (isField) {
			if (active !== this.textGlitterManager?.ui?.textInput) return false;
			active.blur();
		}

		e.preventDefault();
		const step = e.shiftKey ? 10 : 1;
		const deltaX = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
		const deltaY = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;

		if (hasMultiSelection) {
			this.groupTransformManager?.nudge(deltaX, deltaY);
		} else {
			ctx.manager.updateTransform(layer.id, {
				position: {
					x: transform.position.x + deltaX,
					y: transform.position.y + deltaY
				}
			});

			this.loadTransformSettings(layer, ctx.prefix);
		}
		this.scheduleNudgeSave();
		return true;
	}

	// Collapses a burst of arrow-key nudges (held key / rapid presses) into a
	// single history entry, the same debounce pattern sliders use.
	scheduleNudgeSave() {
		clearTimeout(this._nudgeSaveTimer);
		const layerIds = this.layerManager.getSelectedLayers().map((layer) => layer.id).join(',');
		this._nudgeSaveTimer = setTimeout(
			() => this.saveState('Move layer', { coalesceKey: `nudge:${layerIds}` }),
			CONFIG.tools.selection.timing.sliderDebounceMs
		);
	}

	// ===== HISTORY =====

	saveState(label = null, options = {}) {
		this.historyManager.saveState(label, options);
	}

	async restoreState(state) {
		await this.historyManager.restoreState(state);
	}
	async undo() {
		await this.historyManager.undo();
	}

	async redo() {
		await this.historyManager.redo();
	}

	updateHistoryButtons() {
		this.historyManager.updateButtons();
	}

	updateActionButtons() {
		const hasImage = this.originalImage !== null;
		const autoPreviewActive = Boolean(this.autoGlitterManager?.isSessionActive());

		const hasAnySelection = this.layers.some((layer) => layerHasVisibleContent(layer));
		const selectedLayer = this.layerManager.getActiveLayer();
		const canSoloSelectedLayer = Boolean(selectedLayer?.visible && layerHasVisibleContent(selectedLayer));

		const clearAllTool = document.getElementById('clearAllTool');
		const layersBarClearAll = document.getElementById('layersBarClearAll');
		const exportGif = document.getElementById('exportGif');
		const saveProject = document.getElementById('saveProject');
		const selectTool = document.getElementById('selectTool');
		const textTool = document.getElementById('textTool');
		const shapeTool = document.getElementById('shapeTool');
		const colorPickerTool = document.getElementById('colorPickerTool');
		const handTool = document.getElementById('handTool');
		const zoomTool = document.getElementById('zoomTool');
		const brushTool = document.getElementById('brushTool');
		const eraserTool = document.getElementById('eraserTool');
		const zoomControls = document.getElementById('zoomControls');
		const addBtn = document.getElementById('addLayerBtn');
		const previewToggle = document.getElementById('previewModeToggle');
		const transparencyToggle = document.getElementById('transparencyToggle');
		const boundsToggle = document.getElementById('boundsToggle');

		// --- Reference the container ---
		const previewControls = document.getElementById('previewControls');

		if (clearAllTool) clearAllTool.disabled = !hasImage || autoPreviewActive;
		if (layersBarClearAll) layersBarClearAll.disabled = !hasImage || autoPreviewActive;
		if (exportGif) exportGif.disabled = !hasAnySelection || autoPreviewActive;
		if (saveProject) saveProject.disabled = !hasImage || autoPreviewActive;

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

		if (selectTool) selectTool.disabled = !hasImage || autoPreviewActive;
		if (textTool) textTool.disabled = !hasImage || autoPreviewActive;
		if (shapeTool) shapeTool.disabled = !hasImage || autoPreviewActive;
		if (colorPickerTool) colorPickerTool.disabled = !hasImage || autoPreviewActive;
		if (handTool) handTool.disabled = !hasImage;
		if (zoomTool) zoomTool.disabled = !hasImage;
		this.maskEditor?.updateToolButtonState();
		if (brushTool) brushTool.disabled ||= autoPreviewActive;
		if (eraserTool) eraserTool.disabled ||= autoPreviewActive;
		const layersPanel = document.getElementById('layersPanel');
		if (layersPanel) layersPanel.inert = autoPreviewActive;

		// UX: Can't add layers until image is loaded
		if (addBtn) {
			const gate = this.layerManager.canAddLayers();
			addBtn.disabled = !hasImage || autoPreviewActive || !gate.ok;
			if (!hasImage) {
				addBtn.title = 'Load an image first';
			} else if (autoPreviewActive) {
				addBtn.title = 'Exit Auto Glitter before adding layers';
			} else if (!gate.ok) {
				addBtn.title = gate.reason;
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
			previewToggle.disabled = autoPreviewActive || (this.showAllLayers && !canSoloSelectedLayer);
			if (autoPreviewActive) {
				previewToggle.title = 'Layer preview controls are unavailable in Auto Glitter';
			} else if (this.showAllLayers && !canSoloSelectedLayer) {
				previewToggle.title = 'Select a visible layer first';
			} else if (this.showAllLayers) {
				previewToggle.title = 'Show only selected layer';
			} else {
				previewToggle.title = 'Show all layers';
			}
		}

		// UX: Update export tooltip
		if (exportGif) {
			if (autoPreviewActive) {
				exportGif.title = 'Create or exit the Auto Glitter preview before exporting';
			} else if (!hasAnySelection) {
				exportGif.title = 'Add glitter or stickers first';
			} else {
				exportGif.title = 'Export GIF';
			}
		}
	}

	async resetAll() {
		if (!this.originalImage) return;

		const confirmed = await this.confirmAction({
			title: 'Clear All',
			message: 'The image and all layers will be cleared.',
			confirmLabel: 'Clear All',
			destructive: true
		});
		if (confirmed) {
			this.clearImage();
		}
	}

	clearImage() {
		if (this.autoGlitterManager?.isSessionActive()) this.autoGlitterManager.endSessionUI();

		// ======================
		// Core image + data state
		// ======================
		this.exporter?.clearPreviewBlobUrl?.();
		if (this.originalImage && this.originalImage.src.startsWith('blob:')) {
			URL.revokeObjectURL(this.originalImage.src);
		}
		this.originalImage = null;
		this.originalImageData = null;
		this.originalAlphaChannel = null;
		this.baseImageSource = null;
		this.maskEditor?.exitEditMode({ commitStroke: false });
		this.layerManager.clearBaseImageSwatchCache();

		if (this.glitterManager) {
			this.layerManager.layers.forEach(layer => {
				this.glitterManager.releaseLayerResources(layer);
			});
			this.glitterManager.clearAllPaintData();
		}

		this.layerManager.layers = [];
		this.layerManager.activeLayerId = null;

		// Reset history — old states reference layers of the removed image
		this.historyManager.reset();

		// ======================
		// Preview + canvas state
		// ======================
		this.previewWrapper.classList.remove('hasImage');
		this.previewCanvas.classList.remove('selected');
		this.originalCanvas.classList.remove('visible');

		this.clearPreview();
		this.canvasElementsContainer.innerHTML = '';

		// ======================
		// Upload / dropzone UI
		// ======================
		document.getElementById('imageUpload').value = '';

		// ======================
		// Preview container toggles
		// ======================
		this.previewContainer.classList.remove('transparent-bg', 'bounds');
		this.previewContainer.style.backgroundSize = '';
		this.previewContainer.style.backgroundPosition = '';

		const transparencyToggle = document.getElementById('transparencyToggle');
		if (transparencyToggle) transparencyToggle.classList.remove('active');

		const boundsToggle = document.getElementById('boundsToggle');
		if (boundsToggle) boundsToggle.classList.remove('active');

		const previewControls = document.getElementById('previewControls');
		if (previewControls) previewControls.classList.remove('visible');
		// Context bars retain their last tool state until explicitly reconciled.
		// Reset can leave SELECT selected, so setTool(SELECT) below may early-return.
		this.updateContextToolbars();

		// ======================
		// Side panels & empty states
		// ======================
		// Apply the no-document layout before reconciling panel content so the
		// start workspace never flashes stale side panels during reset.
		this.syncDocumentStartState();
		this.updateSidePanelUI(null);

		this.setSettingsEmptyState('layerSettings', true, { title: 'No layer selected', subtext: '' });
		this.setSettingsEmptyState('glitterSettings', true);
		this.collapseSettingsSection('layerSettings');
		this.collapseSettingsSection('glitterSettings');

		// ======================
		// Selected colors
		// ======================
		document.getElementById('selectedColorsEmpty').classList.add('visible');
		document.getElementById('selectedColorsDisplay').innerHTML = '';

		// ======================
		// Managers & viewport
		// ======================
		this.glitterManager.clearFilters();
		this.viewport.resetViewport();
		this.updateZoomUI();
		this.setProjectName('', { markDirty: false });

		// ======================
		// UI refresh + tool state
		// ======================
		this.updateHelpfulMessage();
		this.layerManager.renderLayersList();
		this.updateHistoryButtons();
		this.updateActionButtons();

		this.setTool(ToolType.SELECT);
		this.updateStatus('Load an image to begin');
		this.updateStatusBar();

		// ======================
		// Global event
		// ======================
		window.dispatchEvent(new Event('imageRemoved'));
	}


	debouncedSliderUpdate() {
		clearTimeout(this.sliderTimeout);
		this.sliderTimeout = setTimeout(() => {
			this.requestPreviewUpdate();
		}, CONFIG.tools.selection.timing.sliderDebounceMs);
	}


	// ===== IMAGE LOADING =====
	getConstrainedCanvasSize(width, height) {
		const scale = Math.min(
			1,
			CONFIG.canvas.limits.maxWidth / width,
			CONFIG.canvas.limits.maxHeight / height
		);
		return {
			width: Math.max(1, Math.floor(width * scale)),
			height: Math.max(1, Math.floor(height * scale)),
			resized: scale < 1
		};
	}

	confirmOversizedImageResize({ fileName, width, height, targetWidth, targetHeight, action = 'Open' }) {
		return this.confirmAction({
			title: 'Resize this image?',
			message: `This image is larger than the ${CONFIG.canvas.limits.maxWidth} × ${CONFIG.canvas.limits.maxHeight}px canvas limit.`,
			subject: {
				label: 'File',
				value: fileName || 'Untitled image'
			},
			facts: [
				{ label: 'Original', value: `${width} × ${height}px` },
				{ label: 'After resize', value: `${targetWidth} × ${targetHeight}px` }
			],
			outro: 'The original file on your device will not be changed.',
			confirmLabel: `Resize & ${action}`,
			cancelLabel: 'Cancel'
		});
	}

	async replaceBaseImageFile(file) {
		if (!file || !this.originalImageData) return false;
		if (file.size > CONFIG.canvas.limits.maxFileSizeMB * 1024 * 1024) {
			this.showError(`Image too large. Maximum size is ${CONFIG.canvas.limits.maxFileSizeMB}MB`);
			return false;
		}
		const objectUrl = URL.createObjectURL(file);
		const image = await new Promise((resolve) => {
			const next = new Image();
			next.onload = () => resolve(next);
			next.onerror = () => resolve(null);
			next.src = objectUrl;
		});
		if (!image) {
			URL.revokeObjectURL(objectUrl);
			this.showError('Could not load that image. The file may be corrupt or unsupported.');
			return false;
		}
		const fittedSize = this.getConstrainedCanvasSize(image.width, image.height);
		if (fittedSize.resized) {
			const confirmed = await this.confirmOversizedImageResize({
				fileName: file.name,
				width: image.width,
				height: image.height,
				targetWidth: fittedSize.width,
				targetHeight: fittedSize.height,
				action: 'Replace'
			});
			if (!confirmed) {
				URL.revokeObjectURL(objectUrl);
				return false;
			}
		}
		if (this.autoGlitterManager?.isSessionActive()) this.autoGlitterManager.endSessionUI();
		const { width, height } = fittedSize;
		const offsetX = Math.round((width - this.originalCanvas.width) / 2);
		const offsetY = Math.round((height - this.originalCanvas.height) / 2);
		const previousImageUrl = this.originalImage?.src?.startsWith('blob:') ? this.originalImage.src : null;
		this.resizeCanvas(width, height, offsetX, offsetY, { saveHistory: false, updateStatus: false });
		this.originalCtx.clearRect(0, 0, width, height);
		this.originalCtx.drawImage(image, 0, 0, width, height);
		this.originalImage = image;
		this.originalImageData = this.originalCtx.getImageData(0, 0, width, height);
		this.originalAlphaChannel = new Uint8Array(width * height);
		for (let i = 0; i < this.originalAlphaChannel.length; i++) this.originalAlphaChannel[i] = this.originalImageData.data[i * 4 + 3];
		this.baseImageSource = { kind: 'file', file, renderedWidth: width, renderedHeight: height, hasBaseImage: true };
		if (previousImageUrl && previousImageUrl !== objectUrl) URL.revokeObjectURL(previousImageUrl);
		this.layerManager.updateBaseImageSwatchCache();
		const layer = this.layers.find((entry) => entry.type === LayerType.BASE_IMAGE);
		if (layer) {
			const normalized = this.baseBackgroundManager?.normalizeLayer(layer);
			if (normalized) normalized.background.mode = 'image';
		}
		this.requestPreviewUpdate();
		this.layerManager.renderLayersList();
		if (layer) this.baseBackgroundManager?.loadLayerSettings(layer);
		this.saveState('Edit document');
		this.updateStatus('Base image replaced');
		return true;
	}

	async loadImage(event) {
		const file = event.target.files[0];
		if (!file) return;
		try {
			// Once a project exists, every image-upload surface means “replace the
			// protected background image”; it must never clear the layer stack.
			if (this.originalImage && this.layers?.some((layer) => layer.type === LayerType.BASE_IMAGE)) {
				return await this.replaceBaseImageFile(file);
			}
			return await this.loadImageFile(file);
		} finally {
			if (event.target && 'value' in event.target) event.target.value = '';
		}
	}

	async loadImageFile(file, options = {}) {
		if (!file) return false;

		if (file.size > CONFIG.canvas.limits.maxFileSizeMB * 1024 * 1024) {
			this.showError(`Image too large. Maximum size is ${CONFIG.canvas.limits.maxFileSizeMB}MB`);
			return false;
		}

		return this.loadImageFromBlob(file, {
			...options,
			fileName: options.fileName || file.name,
			source: options.source || {
				kind: 'file',
				file
			}
		});
	}

	async loadImageFromBlob(blob, options = {}) {
		if (!blob) return false;

		const {
			fileName = 'image.png',
			source = null,
			preserveProjectName = false
		} = options;

		const objectUrl = URL.createObjectURL(blob);
		const img = await new Promise((resolve, reject) => {
			const image = new Image();
			image.onerror = () => {
				URL.revokeObjectURL(objectUrl);
				reject(new Error('Could not load that image. The file may be corrupt or unsupported.'));
			};
			image.onload = () => resolve(image);
			image.src = objectUrl;
		}).catch((error) => {
			this.showError(error.message);
			return null;
		});

		if (!img) {
			return false;
		}
		const fittedSize = this.getConstrainedCanvasSize(img.width, img.height);
		if (fittedSize.resized && source?.kind !== 'preset') {
			const confirmed = await this.confirmOversizedImageResize({
				fileName,
				width: img.width,
				height: img.height,
				targetWidth: fittedSize.width,
				targetHeight: fittedSize.height
			});
			if (!confirmed) {
				URL.revokeObjectURL(objectUrl);
				return false;
			}
		}

		this.exporter?.clearPreviewBlobUrl?.();
		if (this.originalImage && this.originalImage.src.startsWith('blob:')) {
			URL.revokeObjectURL(this.originalImage.src);
		}
		if (this.autoGlitterManager?.isSessionActive()) this.autoGlitterManager.endSessionUI();

		const { width, height } = fittedSize;

		this.originalImage = img;
		this.originalCanvas.width = width;
		this.originalCanvas.height = height;
		this.previewCanvas.width = width;
		this.previewCanvas.height = height;

		this.previewWrapper.style.width = width + 'px';
		this.previewWrapper.style.height = height + 'px';
		this.previewWrapper.classList.add('hasImage');

		this.originalCtx.drawImage(img, 0, 0, width, height);
		this.originalImageData = this.originalCtx.getImageData(0, 0, width, height);
		this.baseImageSource = source?.kind === 'preset'
			? {
				kind: 'preset',
				preset: { ...source.preset },
				hasBaseImage: false,
				renderedWidth: width,
				renderedHeight: height
			}
			: {
				kind: source?.kind || 'file',
				hasBaseImage: source?.hasBaseImage !== false,
				file: blob instanceof File ? blob : new File([blob], fileName, { type: blob.type || 'image/png' }),
				renderedWidth: width,
				renderedHeight: height
			};

		this.originalAlphaChannel = new Uint8Array(width * height);
		for (let i = 0; i < width * height; i++) {
			this.originalAlphaChannel[i] = this.originalImageData.data[i * 4 + 3];
		}

		this.layerManager.updateBaseImageSwatchCache();
		this.viewport.setCanvasDimensions(this.previewCanvas.width, this.previewCanvas.height);
		this.viewport.resetZoomSmart();
		this.updateZoomUI();

		this.originalCanvas.classList.add('visible');

		if (this.glitterManager) {
			this.layerManager.layers.forEach((layer) => {
				this.glitterManager.releaseLayerResources(layer);
			});
			this.glitterManager.clearAllPaintData();
		}
		this.layers = [];
		this.canvasElementsContainer.innerHTML = '';

			if (CONFIG.app.startup.layers.createBaseImage) {
			const layer = this.layerManager.createBaseImageLayer(LayerType.BASE_IMAGE);
			this.layers.push(layer);
		}

		if (CONFIG.app.startup.layers.createDefaultGlitterFill) {
			const layer = this.createLayer();
			this.layers.push(layer);
			this.layerManager.setActiveLayer(layer.id);
		} else if (this.layers.length === 0) {
			this.activeLayerId = null;
			this.updateSidePanelUI(null);
		}

		this.historyManager.reset(this.historyManager.createStateSnapshot());
		this.isSaved = false;
		if (!preserveProjectName) {
			this.setProjectName('', { markDirty: false });
		}

		this.updateSidePanelUI();
		this.layerManager.renderLayersList();
		this.updateHistoryButtons();
		this.updateActionButtons();
		this.updateStatusBar();
		this.updateHelpfulMessage();

		this.previewCtx.putImageData(this.originalImageData, 0, 0);
		this.textGlitterManager?.ensureFontLoaded(CONFIG.tools.text.defaultFontId).catch(() => {});
		window.dispatchEvent(new Event('imageLoaded'));
		return true;
	}

	async saveProjectFile() {
		if (!this.originalImage) {
			this.showError('Load an image before saving a project.');
			return;
		}

		try {
			const blob = await this.projectSerializer.serializeToBlob();
			downloadBlob(blob, this.getProjectDownloadName());
			this.isSaved = true;
			this.updateStatus('Project saved');
		} catch (error) {
			console.error('Project save failed:', error);
			this.showError(error.message || 'Failed to save project.');
		}
	}

	async openProjectFile(file) {
		if (!file) return false;
		try {
			return await this.projectSerializer.loadFile(file);
		} catch (error) {
			console.error('Project load failed:', error);
			this.showError(error.message || 'Failed to open project.');
			return false;
		}
	}

	// ===== CANVAS SIZE (Photoshop-style) =====

	// The 9 anchor cells, row-major. `fx`/`fy` are the fraction of the size
	// delta applied as the content offset (0 = pin to that edge, 1 = pin to the
	// opposite edge). `arrow` is the glyph shown in the cell; the active cell is
	// rendered as a filled dot instead.

	// Editable document scaling. Base pixels and painted masks are resampled with
	// nearest-neighbor; layer geometry stays live and history retains old buffers.

	updateStatusBar() {
		if (this.originalImage) {
			document.getElementById('statusDimensions').innerHTML = formatDimensions(this.originalCanvas.width, this.originalCanvas.height);

			const zoomPct = Math.round(this.viewport.currentZoom * 100);
			const count = this.layerManager?.getSelectedLayers().length || 0;
			document.getElementById('statusZoom').innerHTML = count > 1
				? `${formatUnit(zoomPct, '%')}<span class="setting-separator"> · </span>${count} layers selected`
				: formatUnit(zoomPct, '%');
		} else {
			document.getElementById('statusDimensions').textContent = '';
			document.getElementById('statusZoom').textContent = '';
		}
	}

	// ===== CLICK HANDLERS =====

	handleWorkspaceAction(clientX, clientY, options = {}) {
		const tool = options.tool || this.currentTool;
		const event = options.event || null;
		const canvasPoint = this.viewport.screenToCanvas(clientX, clientY);
		const hitCanvas = this.viewport.isWithinCanvas(canvasPoint.x, canvasPoint.y);
		const x = Math.round(canvasPoint.x);
		const y = Math.round(canvasPoint.y);

		switch (tool) {
			case ToolType.SELECT:
				if (hitCanvas) {
					this.handleLayerSelectAction(x, y, {
						toggleSelection: Boolean(event?.shiftKey),
						cycleDeep: Boolean(event?.altKey)
					});
				} else {
					this.layerManager.clearSelection();
				}
				break;

			case ToolType.TEXT:
				if (!hitCanvas) {
					return;
				}
				{
					// Figma parity: clicking existing text with the text tool edits it;
					// any other layer under the click is no obstacle — text goes on top.
					const hitLayer = this.layerManager.getTopVisibleLayerAtPoint?.(x, y, { includeBase: false });
					if (hitLayer?.type === LayerType.TEXT_GLITTER) {
						this.layerManager.selectLayerFromCanvas(hitLayer.id);
						this.textGlitterManager?.focusTextInput(true);
						return;
					}

					const layer = this.layerManager.addLayer(LayerType.TEXT_GLITTER, {
						textLayer: {
							position: { x, y },
							align: 'left',
							anchorPosition: { x, y },
							boxMode: 'auto'
						}
					});

					this.finishLayerCreation(layer, {
						onDesktopReload: () => this.textGlitterManager?.focusTextInput(true)
					});
				}
				break;

			case ToolType.SHAPE:
				// Tap-to-create parity with desktop's plain click (startShapeDrag's
				// isClick path); drag-to-size stays desktop-only (mouse pointerdown).
				if (!hitCanvas || !this.originalImage) {
					return;
				}
				{
					const layer = this.layerManager.addLayer(LayerType.SHAPE, {
						shapeLayer: {
							shapeId: this.shapeGlitterManager.getActiveShapeId(),
							position: { x, y }
						}
					});

					this.finishLayerCreation(layer);
				}
				break;

			case ToolType.COLOR_PICKER:
				if (hitCanvas) {
					this.handleColorPickAction(x, y, event);
				} else {
					this.setTool(ToolType.SELECT);
				}
				break;

			case ToolType.HAND:
				this.viewport.startPan(clientX, clientY);
				break;

			case ToolType.ZOOM:
				if (this.originalImage) {
					this.handleZoomAction(clientX, clientY, {
						zoomOut: options.zoomOut || false
					});
				}
				break;
		}
	}


	handlePreviewContainerClick(e) {
		dbg('📍 Click handler fired', e.type);

		// 0. IGNORE IF JUST FINISHED HANDLE DRAGGING
		if (this.ignoreNextClick) {
			dbg('🚫 Ignoring click - just finished handle drag');
			return;
		}

		// 1. IGNORE TRANSFORM HANDLES
		const clickedGroupBoundingBox = e.target.closest('.group-transform-handles .transform-bounding-box');
		if ((e.target.closest('.transform-handles') ||
			e.target.classList.contains('transform-bounding-box')) && !clickedGroupBoundingBox) return;

		// 2. IGNORE UI ELEMENTS
		if (e.target.closest('.ui-ignore-gestures')) {
			return;
		}

		// 3. MOUSE BUTTON CHECKS
		if (e.button === 1) return; // Ignore middle mouse button
		// Ignore right-click for all tools EXCEPT zoom tool
		if (e.button === 2 && this.currentTool !== ToolType.ZOOM) {
			return;
		}

		// 4. EVENT TYPE FILTERING - Different tools need different events
		// HAND tool needs pointerdown to start dragging
		// Other tools need click to prevent double-firing

		if (this.currentTool === ToolType.HAND) {
			// Hand tool: ONLY respond to pointerdown (ignore click)
			if (e.type === 'click') {
				dbg('🚫 HAND tool: Ignoring click event (already handled by pointerdown)');
				return;
			}
		} else {
			// Other tools (SELECT, COLOR_PICKER, ZOOM): ONLY respond to click
			// EXCEPT: ZOOM tool with right-click needs pointerdown (right-click doesn't fire 'click')
			// EXCEPT: SELECT tool on sticker elements - let mousedown pass through to sticker handlers
			if (e.type === 'pointerdown' || e.type === 'mousedown') {
				// Allow pointerdown for zoom tool with right-click
				if (this.currentTool === ToolType.ZOOM && e.button === 2) {
					dbg('✅ ZOOM tool: Allowing right-click pointerdown');
					// Continue to handle this event
				}
				// CRITICAL FIX: Allow mousedown on transformable overlays to pass through
				else if (this.currentTool === ToolType.SELECT && e.target.closest(TRANSFORMABLE_LAYER_ELEMENT_SELECTOR)) {
					dbg('✅ SELECT tool: Allowing transformable overlay mousedown to pass through');
					// Don't return - let it fall through, but don't process it here
					// The sticker's own mousedown handler will handle it
					return;
				}
				else {
					dbg('🚫 Click-based tool: Ignoring pointerdown (waiting for click)');
					return;
				}
			}
		}

		const hitTransformableOverlay = e.target.closest(TRANSFORMABLE_LAYER_ELEMENT_SELECTOR);

		// Check if click is within the canvas area using viewport coordinates
		const canvasCoords = this.viewport.screenToCanvas(e.clientX, e.clientY);
		const hitCanvas = this.viewport.isWithinCanvas(canvasCoords.x, canvasCoords.y);

		// We treat transformable overlays and the canvas as the "Image Area"
		const hitImageArea = hitCanvas || hitTransformableOverlay;

		// Gatekeeper: If they clicked a button/sidebar, stop here
		const isWorkspace = e.target === this.previewContainer || e.target === this.previewWrapper || hitImageArea;
		if (!isWorkspace) return;

		if (
			this.currentTool === ToolType.SELECT &&
			hitTransformableOverlay &&
			!this.layerManager.hasMultiSelection() &&
			!e.shiftKey &&
			!e.altKey
		) return;

		this.handleWorkspaceAction(e.clientX, e.clientY, {
			tool: this.currentTool,
			event: e,
			zoomOut: e.altKey || e.button === 2
		});
	}
	handleColorPickAction(x, y, event = null) {
		if (this.currentTool !== ToolType.COLOR_PICKER) return;

		let layer = this.layerManager.getActiveLayer();

		// If no layer selected, try to select a layer at this location
		if (!layer) {
			for (let i = this.layerManager.layers.length - 1; i >= 0; i--) {
				const testLayer = this.layerManager.layers[i];
				if (!testLayer.visible) continue;

				let isHit = false;

				if (testLayer.type === LayerType.GLITTER_FILL) {
					if (hasMaskContent(testLayer)) {
						isHit = this.layerManager.isPixelInLayerSelection(testLayer, x, y);
					}
				} else if (testLayer.type === LayerType.BASE_IMAGE) {
					if (this.originalImage) {
						isHit = true;
					}
				}

				if (isHit) {
					this.layerManager.selectLayerFromCanvas(testLayer.id);
					layer = testLayer;
					break;
				}
			}

			if (!layer) {
				this.showError('Please select the Base Image or a Glitter Layer.');
				return;
			}
		}

		// Handle based on selected layer type
		if (layer.type === LayerType.GLITTER_FILL) {
			if (!this.canEditLayer(layer, { notify: true })) return;

			// fill normally
			this.glitterFillSelector(x, y, event);

		} else if (layer.type === LayerType.BASE_IMAGE) {

			if (CONFIG.app.behavior.autoCreateGlitterLayer) {
				const newLayer = this.glitterManager.createLayer();
				this.layerManager.insertLayer(newLayer);
				this.glitterFillSelector(x, y, event);
			} else {
				this.showError('Please create a glitter layer first');
			}

		} else if (layer.type === LayerType.STICKER) {
			const hitSticker = this.layerManager.isPointInSticker(layer, x, y);

			if (hitSticker) {

				if (CONFIG.app.behavior.autoCreateGlitterLayer) {
					const newLayer = this.glitterManager.createLayer();
					this.layerManager.insertLayer(newLayer);
					this.glitterFillSelector(x, y, event);
				} else {
					this.updateStatus('Color Fill disabled on Sticker layers.');
				}
				return;
			}

			let glitterLayer = null;

			for (let i = this.layerManager.layers.length - 1; i >= 0; i--) {
				const testLayer = this.layerManager.layers[i];
				if (!testLayer.visible || testLayer.type !== LayerType.GLITTER_FILL) continue;

				if (hasMaskContent(testLayer)) {
					const isHit = this.layerManager.isPixelInLayerSelection(testLayer, x, y);
					if (isHit) {
						glitterLayer = testLayer;
						break;
					}
				}
			}

			if (glitterLayer) {
				this.layerManager.selectLayerFromCanvas(glitterLayer.id);
			} else {
				const newLayer = this.glitterManager.createLayer();
				this.layerManager.insertLayer(newLayer);
			}

			this.glitterFillSelector(x, y, event);
		}
	}

	handleLayerSelectAction(x, y, options = {}) {
		if (this.currentTool !== ToolType.SELECT) return;
		if (this.autoGlitterManager?.isSessionActive()) {
			this.autoGlitterManager.handleCanvasSelect(x, y);
			return;
		}
		if (!PREFERENCES.get('autoSelect') || this.justCompletedDrag) return;

		this.layerManager.handleLayerPick(x, y, options);
	}

	handleZoomAction(clientX, clientY, options = {}) {
		if (this.currentTool !== ToolType.ZOOM || !this.originalImage) return;

		if (options.zoomOut) {
			this.viewport.zoomOut(clientX, clientY, { animate: true });
		} else {
			this.viewport.zoomIn(clientX, clientY, { animate: true });
		}

		this.updateStatus(`Zoom: ${this.viewport.getZoomPercentage()}%`);
	}



	glitterFillSelector(x, y, event) {
		let layer = this.layerManager.getActiveLayer();

		if (!layer) {
			this.showError('Please select the Base Image or a Glitter Layer.');
			return;
		}

		// Case 1: Base Image is Selected -> Create NEW Glitter Layer
		if (layer.type === LayerType.BASE_IMAGE) {
			const newLayer = this.glitterManager.createLayer();
			this.layerManager.insertLayer(newLayer);  // Use the new method
			layer = newLayer; // Switch target to the new layer
			this.updateStatus('Created new layer from Base Image');
		}
		// Case 2: Glitter Fill Layer is Selected -> Use it
		else if (layer.type === LayerType.GLITTER_FILL) {
			// Continue using this layer
		}
		// Case 3: Sticker (or other) -> Block
		else {
			this.updateStatus('Color Fill disabled on Sticker layers.');
			return;
		}

		const pixelIndex = y * this.originalCanvas.width + x;
		const alpha = this.originalAlphaChannel[pixelIndex];
		const isTransparent = alpha < CONFIG.tools.selection.transparency.alphaThreshold;

		// 1. Config Check: Block if transparent and selection isn't allowed
		if (isTransparent && !CONFIG.tools.selection.transparency.allowTransparentSelection) {
			this.showError('Cannot select transparent pixels');
			return;
		}

		const i = pixelIndex * 4;

		// 2. Data Extraction
		// If it's transparent, we force RGB to 0 to be clean, 
		// because the 'isTransparent' flag will do the heavy lifting in the mask logic.
		const r = isTransparent ? 0 : this.originalImageData.data[i];
		const g = isTransparent ? 0 : this.originalImageData.data[i + 1];
		const b = isTransparent ? 0 : this.originalImageData.data[i + 2];

		// 3. Multi-Select Logic with Shift Key Support
		const shiftPressed = event && event.shiftKey;

		// If Shift is pressed, enable multi-select
		if (shiftPressed && !layer.settings.multiSelect) {
			layer.settings.multiSelect = true;

			// Update UI checkboxes
			const multiSelect = document.getElementById('multiSelect');
			const contextMultiSelect = document.getElementById('contextMultiSelect');
			if (multiSelect) multiSelect.checked = true;
			if (contextMultiSelect) contextMultiSelect.checked = true;

			this.updateStatus('Multi-select enabled');
		}

		// If multi-select is off (and shift wasn't pressed), clear previous selections
		const multiSelect = layer.settings.multiSelect;
		if (!multiSelect) layer.selections = [];

		// 4. Save the Selection
		layer.selections.push({
			r, g, b, x, y,
			isTransparent: isTransparent
		});

		// 5. UI & Preview Updates (Crucial: These must happen after pushing the data)
		this.saveState('Edit document'); // For Undo/Redo

		// G-1b: paint the chip/status/toolbar feedback on this frame, *before*
		// kicking off the (potentially slow) mask pipeline, so the click never
		// looks like dead air. updatePreview is deferred a frame so the browser
		// actually gets to paint the above first.
		this.updateActionButtons();
		this.updateSelectedColorsDisplay(); // To show "Transparent" or the RGB values in the sidebar
		this.updateContextToolbars();
		this.updateHelpfulMessage();
		this.updateStatus('Applying glitter…');

		this.glitterManager.markMaskRequestStart(layer.id);
		this.requestPreviewUpdate();

	}

	// G-1b: fires whenever a mask encode starts/settles for any glitter layer.
	// Recomputed from ground truth (isMaskPending for the CURRENTLY active layer)
	// rather than trusting this event's own layerId/isPending, so switching the
	// active layer mid-encode can't leave the busy cursor stuck.
	onMaskPendingChange(layerId, isPending) {
		if (this.currentTool === ToolType.BRUSH) return; // brush has its own cursor UI

		const previewContainer = document.getElementById('previewContainer');
		const activeLayer = this.layerManager.getActiveLayer();
		const activeIsPending = Boolean(activeLayer && this.glitterManager.isMaskPending(activeLayer.id));

		if (previewContainer) {
			previewContainer.style.cursor = activeIsPending ? 'progress' : '';
		}

		if (!isPending && activeLayer && activeLayer.id === layerId) {
			this.updateStatus('Glitter applied');
		}
	}

	updateSelectedColorsDisplay() {
		const container = document.getElementById('selectedColorsDisplay');
		if (!container) return;

		const layer = this.layerManager.getActiveLayer();

		// Only show for glitter layers with selections
		if (!layer || layer.type !== LayerType.GLITTER_FILL || !layer.selections || layer.selections.length === 0) {
			document.getElementById('selectedColorsEmpty')?.classList.add('visible');
			container.innerHTML = '';
			return;
		}

		document.getElementById('selectedColorsEmpty')?.classList.remove('visible');
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
			removeBtn.type = 'button';
			removeBtn.textContent = '×';
			removeBtn.title = 'Remove this color selection';
			removeBtn.setAttribute('aria-label', `Remove color ${sel.r}, ${sel.g}, ${sel.b}`);
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
		this.saveState('Edit document');

		if (hasMaskContent(layer)) {
			this.requestPreviewUpdate();
		} else {
			this.clearPreview();
		}

		this.updateActionButtons();
		this.updateSelectedColorsDisplay();
		this.updateContextToolbars();
		this.updateHelpfulMessage();
	}

	clearPreview() {
		this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		if (this.originalImageData) this.renderPreviewCanvas([]);

		// Clear glitter backgrounds
		this.canvasElementsContainer.innerHTML = '';
		if (this.glitterManager) {
			this.glitterManager.layerElements.clear();
		}

		// Clear sticker elements
		if (this.stickerManager) {
			this.stickerManager.layerElements.forEach((element, layerId) => {
				if (element.parentNode) {
					element.parentNode.removeChild(element);
				}
			});
			this.stickerManager.layerElements.clear();
		}

		if (this.textGlitterManager) {
			this.textGlitterManager.clearElements();
		}
	}

	// ===== PREVIEW & RENDERING =====
	requestPreviewUpdate(scope = 'all') {
		this._pendingPreviewScope = this._pendingPreviewScope == null || this._pendingPreviewScope === scope
			? scope
			: 'all';
		if (this._previewFrame) return;
		this._previewFrame = requestAnimationFrame(() => {
			this._previewFrame = null;
			const pendingScope = this._pendingPreviewScope;
			this._pendingPreviewScope = null;
			this.updatePreview(pendingScope);
		});
	}

	updatePreview() {
		if (this._previewFrame) {
			cancelAnimationFrame(this._previewFrame);
			this._previewFrame = null;
			this._pendingPreviewScope = null;
		}
		if (!this.originalImageData) {
			this.clearPreview();
			return;
		}

		const layersToShow = this.showAllLayers
			? this.layers.filter(l => l.visible && layerHasVisibleContent(l))
			: [this.layerManager.getActiveLayer()].filter(l => l && l.visible && layerHasVisibleContent(l));

		if (layersToShow.length === 0) {
			this.renderPreviewCanvas(layersToShow);
			this.glitterManager.renderContent(layersToShow);
			this.stickerManager.renderContent(layersToShow);
			this.textGlitterManager.renderContent(layersToShow);
			this.shapeGlitterManager.renderContent(layersToShow);
			return;
		}

		this.renderPreviewCanvas(layersToShow);

		// Use the manager to render the glitter backgrounds
		this.glitterManager.renderContent(layersToShow);

		this.stickerManager.renderContent(layersToShow);
		this.textGlitterManager.renderContent(layersToShow);
		this.shapeGlitterManager.renderContent(layersToShow);
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

		const background = this.baseBackgroundManager?.normalizeLayer(baseLayer)?.background;
		const mode = background?.mode || 'image';
		if ((mode === 'image' && this.baseBackgroundManager?.hasBaseImage()) || mode === 'gradient') {
			const width = this.previewCanvas.width;
			const height = this.previewCanvas.height;
			const source = this.baseBackgroundManager.getBackgroundSourceImageData(background, width, height);
			const settings = background.pixelEffects;
			const processed = !settings.pixelateEnabled && !settings.paletteEnabled
				? source
				: this.baseBackgroundManager.getPreviewImageData(source, width, height, settings);
			this.renderBasePreviewImageData(background, processed);
		} else if (mode === 'solid') {
			this.previewCtx.save();
			this.previewCtx.globalAlpha = background.opacity / 100;
			this.previewCtx.fillStyle = background.color;
			this.previewCtx.fillRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
			this.previewCtx.restore();
		}
	}

	renderBasePreviewImageData(background, processed) {
		if (!processed) return;
		const image = new ImageData(new Uint8ClampedArray(processed.data), processed.width, processed.height);
		applyColorAdjustToImageData(image, background.colorAdjust);
		if (background.opacity < 100) {
			for (let offset = 3; offset < image.data.length; offset += 4) image.data[offset] = Math.round(image.data[offset] * background.opacity / 100);
		}
		this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		this.previewCtx.putImageData(image, 0, 0);
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

	validateExportSettings() {
		this.settingsStore.validate(this.exportSettings);
	}

	async exportAnimatedGif() {
		// Filter visible layers (ephemeral Auto Glitter previews never export)
		const visibleLayers = this.layers.filter(l => {
			if (!l.visible || l.isPreview) return false;
			return layerHasVisibleContent(l);
		});

		if (visibleLayers.length === 0) {
			this.showError('No visible layers with content to export!');
			return;
		}

		// Validate export settings before proceeding
		this.validateExportSettings();
		const format = this.exportSettings.format;
		const activeExporter = format === 'mp4' ? this.mp4Exporter : this.exporter;
		activeExporter.setFileName(this.getProjectFileName(format));

		const exportBtn = document.getElementById('exportGif');
		exportBtn.disabled = true;
		this.showExportProgress();

		// USE this.exportSettings directly - no DOM reading!
		dbg('Export settings:', this.exportSettings);

		const exportParams = {
			visibleLayers: visibleLayers,
			glitterGifs: this.glitterManager.content,
			canvasData: {
				width: this.originalCanvas.width,
				height: this.originalCanvas.height,
				originalData: new Uint8ClampedArray(this.originalImageData.data),
				originalAlpha: this.originalAlphaChannel,
				alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold,
				hasBaseImage: this.baseBackgroundManager?.hasBaseImage() ?? true
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
					this.isSaved = true;
					this.hideExportProgress();
				},
				onError: (error) => {
					// Fired by gif.js encoder events, outside our try/catch below
					exportBtn.disabled = false;
					this.hideExportProgress();
					if (error.message !== 'Export cancelled') {
						this.showError('Export failed: ' + error.message);
					}
				},
				parseGif: (url) => this.glitterManager.parseGifFromUrl(url),
				createMask: (layer) => this.maskCompositor.getMaskData(layer),
				renderTextMask: (layer) => this.textGlitterManager.renderTextMask(layer),
				renderShapeMask: (layer) => this.shapeGlitterManager.buildMaskEntry(layer),
				ensureTextFont: (fontId) => this.textGlitterManager.ensureFontLoaded(fontId)
			}
		};

		setTimeout(async () => {
			try {
				await activeExporter.process(exportParams);
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
		this.notifications.notify('error', message);
	}

	hideError() {
		this.notifications.dismissError();
	}

	updateStatus(message) {
		this.notifications.notify('status', message);
	}
}

Object.assign(
	GlitterEditor.prototype,
	EDITOR_SETTINGS_METHODS,
	EDITOR_PANEL_METHODS,
	EDITOR_DISCLOSURE_METHODS,
	TRANSFORM_PANEL_METHODS,
	TRANSFORM_INTERACTION_METHODS,
	DOCUMENT_START_METHODS,
	MODAL_METHODS,
	LAYER_PANEL_METHODS,
	CANVAS_GESTURE_METHODS,
	CANVAS_SIZE_CONTROL_METHODS,
	CANVAS_RESIZE_METHODS
);
GlitterEditor.CANVAS_ANCHORS = CANVAS_SIZE_CONTROL_METHODS.CANVAS_ANCHORS;

// everything inside IIFE
(async () => {
	await ShapeLibrary.loadManifest();
	const editor = new GlitterEditor();
	await editor.init();

	// Load debug configuration if enabled
	if (DEBUG_CONFIG.enabled) {
		await editor.loadDebugConfig();
	}

	// Make editor globally accessible (optional, useful for debugging)
	window.editor = editor;
})();
