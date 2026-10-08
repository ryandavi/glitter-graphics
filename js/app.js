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
		APP_MEMORY_LEDGER.trackCanvas(this.originalCanvas, 'Document/originalCanvas');
		APP_MEMORY_LEDGER.trackCanvas(this.previewCanvas, 'Preview/previewCanvas');

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
		this.exportInProgress = false;

		// Render schema-driven panel sections (js/ui/panel-renderer.js +
		// PANEL_SCHEMAS), then the shared transform panels into the hosts the
		// schemas created, BEFORE manager setup — every manager binds against
		// one generated DOM structure, built once (never re-rendered after
		// boot; rebuilding would orphan listeners). MobileManager later moves
		// these same nodes into drawers, so bindings survive re-parenting.
		renderPanelSections(this);
		renderAssetBrowsers();
		setupLibrarySearchToggle(this);
		setupLibraryViewMenu(this);
		this.renderTransformPanels();
		this.contextToolbarRenderer = new ContextToolbarRenderer(this);
		this.contextToolbarRenderer.render();
		renderToolButtons(document.getElementById('toolbarToolsGroup'));
		renderSettingsModals();
		initializeColorEyedroppers(this);

		// ============================================================================
		// MANAGERS
		// ============================================================================
		this.viewport = new ViewportManager(this.previewContainer, this.previewWrapper);
		this.viewport.editor = this;
		this.layerManager = new LayerManager(this);
		this.animationTicker = new AnimationTicker(this);
		this.stickerManager = new StickerManager(this);
		this.paintMaskStore = new PaintMaskStore(this);
		this.glitterManager = new GlitterManager(this);
		this.glitterLibrary = new GlitterBrowserManager(this);
		this.stickerLibrary = new StickerBrowserManager(this);
		this.brushTipManager = new BrushTipManager(this);
		this.baseBackgroundManager = new BaseBackgroundManager(this);
		this.autoGlitterManager = new AutoGlitterManager(this);
		this.textGlitterManager = new TextGlitterManager(this);
		this.shapeGlitterManager = new ShapeGlitterManager(this);
		// The Library's Shapes and Fonts kinds.
		this.shapeBrowserManager = new ShapeBrowserManager(this);
		this.fontBrowserManager = new FontBrowserManager(this);
		this.filterLayerManager = new FilterLayerManager(this);
		this.frameLayerManager = new FrameLayerManager(this);
		this.sparkleLayerManager = new SparkleLayerManager(this);
		this.pathLayerManager = new PathLayerManager(this);
		this.pathEdit = new PathEditSession(this);
		this.cropEdit = new CropEditSession(this);
		this.animationPanel = new AnimationPanelController(this);
		this.pickers = new PickerRegistry(this);
		// Registration order is the picker-strip refresh order: the text
		// manager performs the initial hide for non-text layers.
		[
			this.textGlitterManager,
			this.fontBrowserManager,
			this.shapeGlitterManager,
			this.stickerManager,
			this.glitterManager,
			this.baseBackgroundManager,
			this.brushTipManager,
			this.autoGlitterManager,
			this.frameLayerManager.slotPicker,
			this.sparkleLayerManager.slotPicker,
			this.pathLayerManager.slotPicker
		].forEach((manager) => this.pickers.register(manager));
		this.groupTransformManager = new GroupTransformManager(this);
		this.mobileManager = new MobileManager(this);
		this.maskCompositor = new MaskCompositor(this);
		this.maskEditor = new MaskEditor(this);
		this.historyManager = new HistoryManager(this);
		this.projectSerializer = new ProjectSerializer(this);
		this.templateManager = new TemplateManager(this);
		this.htmlSceneExporter = null;
		this._registerMemoryMeasurements();

		// ============================================================================
		// INITIALIZATION
		// ============================================================================
		this.initializeProjectNameInput();
		const storedTool = readStored(STORAGE_KEYS.lastTool.key, null);
		const rememberedTool = storedTool === 'colorPicker' ? ToolType.GLITTER_FILL : storedTool;
		const initialTool = Object.values(ToolType).includes(rememberedTool) ? rememberedTool : CONFIG.app.startup.tool;
		this.setTool(this.mobileManager.isMobile && initialTool === ToolType.HAND ? ToolType.SELECT : initialTool, { announce: false });
		this.setupEventListeners();
		this.initializeAltDuplicateFeedback();
		this.initializeCollapsibleSections();
		this.initializeAdvancedDisclosures();
		// Rule D: every panel slider's revert reflects whether it is at default.
		initializePropertyReverts();
		initializePanelResize(this);
		this.initializeShortcutsModal();
		this.initializeExportSettings();
		this.initializeModalFilters();
	}

	_registerMemoryMeasurements() {
		APP_MEMORY_LEDGER.register({ id: 'decoded-assets', label: 'Decoded glitter and sticker frames (export)', category: 'Decoded assets', measure: () => this.sceneCompositor?.getDecodedSourceBytes() || 0 });
		APP_MEMORY_LEDGER.register({ id: 'paint-history', label: 'Paint history', category: 'History', measure: () => this.paintMaskStore?.paintHistoryBytes || 0 });
		APP_MEMORY_LEDGER.register({ id: 'undo-history', label: 'Undo history', category: 'History', measure: () => this.historyManager?.getHistoryBytes() || 0 });
		APP_MEMORY_LEDGER.register({ id: 'base-image', label: 'Base image buffers', category: 'Document', measure: () =>
			(this.originalImageData?.data?.byteLength || 0) + (this.originalAlphaChannel?.byteLength || 0) });
	}

	// ===== DEBUG CONFIGURATION LOADER =====
	async loadDebugConfig() {
		if (!DEBUG_CONFIG.enabled) return;

		// Load blank canvas
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

		// Load each sticker preset
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
			layer.transform.position.x = stickerPreset.x;
			layer.transform.position.y = stickerPreset.y;

			// Insert layer
			this.layerManager.insertLayer(layer);

			// Render the sticker
			this.stickerManager.renderLayer(layer);

			dbg(`[DEBUG] Loaded sticker: ${stickerInfo.name} at (${stickerPreset.x}, ${stickerPreset.y})`);
		}

		// Update UI
		this.layerManager.renderLayersList();
		this.requestPreviewUpdate();
		this.updateActionButtons();
		this.saveState('Edit document');

	}

	// ===== UTILITY METHODS =====

	initializeProjectNameInput() {
		const input = document.getElementById('projectNameInput');
		if (!input) return;

		input.placeholder = 'Name...';
		input.value = this.projectName;
		this.syncProjectNameSummary();
		input.addEventListener('input', () => {
			this.setProjectName(input.value, { markDirty: true, syncInput: false });
		});
	}

	// The Project card's title readout (#projectNameSummary) — shows the current
	// name when the card is collapsed.
	syncProjectNameSummary() {
		const summary = document.getElementById('projectNameSummary');
		if (summary) summary.textContent = this.projectName || 'Untitled project';
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
		this.syncProjectNameSummary();

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
		this.exportResultPresenter = new ExportResultPresenter({ onStatus: (message) => this.updateStatus(message), onShow: () => this.modalManager.open('exportPreviewModal') });
		this.exportProgressPresenter = new ExportProgressPresenter(this);
		this.gifEncodingPipeline = new GifEncodingPipeline();
		this.authoredFrameResolver = new AuthoredFrameResolver();
		this.sceneCompositor = new SceneCompositor({
			editor: this,
			authoredFrameResolver: this.authoredFrameResolver,
			resolveShapeFillImage: (imageRef) => this.shapeGlitterManager.getImageFillAsset(imageRef)
		});
		this.exporter = new GifExporter(this.sceneCompositor, {
			resultPresenter: this.exportResultPresenter,
			gifEncodingPipeline: this.gifEncodingPipeline
		});
		this.mp4Exporter = new Mp4Exporter(this.sceneCompositor, this.exportResultPresenter);
		this.stillImageExporter = new StillImageExporter(this.sceneCompositor, this.exportResultPresenter, this.gifEncodingPipeline);
		await Promise.all([
			this.stickerManager.init(),
			this.stickerLibrary.init(),
			this.glitterManager.init(),
			this.glitterLibrary.init(),
			this.brushTipManager.init(),
			this.textGlitterManager.init(),
			this.shapeBrowserManager.init(),
			this.fontBrowserManager.init()
		]);
		this.updateSidePanelUI(null);
		document.body.classList.remove('is-booting');
	}

	// ===== EVENT LISTENERS =====

	setupEventListeners() {
		this.setupToolbarListeners();
		this.setupAutoSelectListener();
		this.setupColorPickerContextListeners();
		this.setupLayerSettingsListeners();
		this.setupMaskEditorListeners();
		Object.values(LayerType).forEach((type) => {
			const prefix = LAYER_UI_CONFIG[type]?.transformPrefix;
			if (prefix) this.setupTransformListeners(prefix, type, () => getLayerManagerForType(this, type));
		});
		this.setupExportListeners();
		this.setupImageListeners();
		this.setupModalListeners();
		this.setupPreviewListeners();
		this.setupGlobalListeners();
		this.setupHelpfulMessageListeners();
		this.setupCanvasSizeControls();
	}

	setupAutoSelectListener() {
		const toggle = document.getElementById('contextAutoSelect');
		if (!toggle) return;
		toggle.checked = PREFERENCES.get('autoSelect');
		toggle.addEventListener('change', () => {
			PREFERENCES.set('autoSelect', toggle.checked);
			// Settings shows the same preference, so it has to agree.
			const settingsInput = document.getElementById('autoSelectLayers');
			if (settingsInput) settingsInput.checked = toggle.checked;
			this.saveSettingsToStorage();
			this.updateStatus(toggle.checked
				? 'Auto-Select on: click an object to select it'
				: 'Auto-Select off: canvas drags keep the selected layer');
		});
	}

	// ===== TOOLBAR LISTENERS =====
	setupToolbarListeners() {
		// One button per registered tool. The Mask Brush's Paint vs Erase lives in
		// its context bar (and X / E); re-selecting it keeps the last mode.
		TOOL_ORDER.forEach((tool) => {
			document.getElementById(getToolButtonId(tool))?.addEventListener('click', () => this.setTool(tool));
		});
		// The Fill layer's Mask card jumps to the two tools that edit its mask.
		document.getElementById('fillMaskPickColors')?.addEventListener('click', () => this.setTool(ToolType.GLITTER_FILL));
		document.getElementById('fillMaskPaint')?.addEventListener('click', () => this.setTool(ToolType.BRUSH));

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
		if (allSelectedLayers.some((layer) => layer.type === LayerType.BASE_IMAGE || isLayerFullyLocked(layer))) {
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
		if (allSelectedLayers.some((layer) => layer.type === LayerType.BASE_IMAGE || isLayerFullyLocked(layer))) {
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
			tone: 'danger', skippable: true
		});
		if (!confirmed) {
			return false;
		}

		if (isPlural) {
			return this.layerManager.deleteLayers(selectedLayers.map((layer) => layer.id));
		}

		return this.layerManager.deleteLayer(selectedLayers[0].id);
	}

	// Mirrors a canonical slider's value onto a compact duplicate (the floating
	// quick-access brush size, mirroring the sidebar's canonical Size slider).

	async loadBlankImage(width, height, color = CONFIG.canvas.defaults.blankDocument.color, options = {}) {
		const canvas = createAppCanvas(0, 0, 'app');
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
		const baseLayer = this.layerManager.getBaseLayer();
		if (baseLayer) {
			baseLayer.background.mode = color === 'transparent' ? 'none' : 'solid';
			if (color !== 'transparent') baseLayer.background.color = color;
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
		if (!TOOLS[tool]) return;

		if (this.currentTool === tool) {
			// Clicking the active tool is still a meaningful exit from a gallery
			// picker (for example Brush while "Choosing brush tip" is showing).
			if (this.pickers?.closeActive({ returnToProperties: false })) {
				this.syncCollapsibleSections?.(this.getPreferredDesignSection(this.layerManager.getActiveLayer()));
			}
			return;
		}
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

		// Picker sessions belong to the tool/context that opened them. End the
		// session before the destination tool computes its preferred panel, so a
		// stale gallery strip cannot override Text, Shape, Brush, or Select UI.
		this.pickers?.closeActive({ returnToProperties: false });

		// The temporary Hand (Space) is a detour, not a tool change: the tool
		// it interrupts keeps its session.
		if (!this.temporaryHandToolActive && !options.resumeTemporary) {
			getSessionDefinition(this)?.end?.(this);
			TOOLS[this.currentTool]?.onDeactivate?.(this, tool, options);
		}
		this.currentTool = tool;
		if (!this.temporaryHandToolActive && options.persist !== false) writeStored(STORAGE_KEYS.lastTool.key, tool);
		this.currentHintDismissed = false; // Reset dismissed flag when tool changes

		// Remove all tool classes from body
		document.body.classList.remove(...TOOL_ORDER.map((name) => `tool-${name}`));

		// Add current tool class
		document.body.classList.add(`tool-${tool}`);

		// Update Toolbar Buttons
		document.querySelectorAll('.toolbar-group button').forEach(btn => {
			btn.classList.remove('active');
		});

		document.getElementById(getToolButtonId(tool))?.classList.add('active');

		// Update Cursors (each tool declares its canvas cursor classes)
		const definition = TOOLS[tool];
		if (this.previewContainer) {
			this.previewContainer.classList.remove('zoom-out-mode', ...TOOL_ORDER.map((name) => TOOLS[name].containerClass).filter(Boolean));
			if (definition?.containerClass) this.previewContainer.classList.add(definition.containerClass);
		}

		if (this.previewWrapper) {
			this.previewWrapper.classList.remove(...TOOL_ORDER.map((name) => TOOLS[name].wrapperClass).filter(Boolean));
			if (definition?.wrapperClass) this.previewWrapper.classList.add(definition.wrapperClass);
		}

		// Transform handles follow the active tool.
		this.syncTransformHandlesForActiveLayer();

		if (!this.temporaryHandToolActive && !options.resumeTemporary) definition?.onActivate?.(this);

		// Update Context Toolbars
		this.updateContextToolbars();

		// Reconcile the sidebar accordion with the new tool: entering Brush/Eraser
		// opens its Settings; leaving a settings tool returns focus to the selected
		// layer's Properties (or the Gallery). Only on an actual tool change (setTool
		// early-returns when unchanged), so it never fights a manual accordion toggle.
		if (this.originalImage) this.updateSidePanelUI(this.layerManager.getActiveLayer());
		else this.syncCollapsibleSections?.(this.getPreferredDesignSection(this.layerManager.getActiveLayer()));

		// Update helpful message
		this.updateHelpfulMessage();

		if (options.announce !== false) this.updateStatus(`${definition.name} tool`);

	}

	updateContextToolbars() {
		const removeBackgroundButton = document.getElementById('contextRemoveBackground');
		if (removeBackgroundButton) removeBackgroundButton.hidden = !this.stickerManager.canRemoveBackground();
		const brushSettingsSection = document.getElementById('brushSettingsSection');
		const toolbarConfigs = CONFIG.ui.contextToolbars;
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
		const context = { layer, tool: this.currentTool, multi: hasMultiSelection };
		const activeToolbar = toolbars.find(({ config, element }) => element && config.when(this, context));
		if (activeToolbar) {
			activeToolbar.element.classList.add('visible');
			this.contextToolbarRenderer.applyPlacement(activeToolbar.element);
			activeToolbar.config.sync?.(this, context);
		}

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
				PREFERENCES.set('showHints', false);

				// Hide message
				helpfulMessage.classList.remove('visible');
			});
		}
	}

	// Arrow-key nudge for the selected movable layer (1px, 10px with Shift).
	// Returns true when it handled the key. Runs ahead of the typing guard so a
	// selected text/shape layer moves like a sticker; the text content field is
	// blurred on the first nudge so continued typing needs a deliberate refocus.
	// Arrows belong to the focused control when it uses them (a field, select,
	// slider, list or grid: focusKeyClaim) and to the layer otherwise.

	// Collapses a burst of arrow-key nudges (held key / rapid presses) into a
	// single history entry, the same debounce pattern sliders use.

	// ===== HISTORY =====

	// A save made while a numeric key step runs shares that step's key, so a
	// held arrow is one undo.
	saveState(label = null, options = {}) {
		this.historyManager.saveState(label, { coalesceKey: currentStepCoalesceKey(), ...options });
		this.filterLayerManager?.noteSceneEdited();
	}

	async restoreState(state) {
		await this.historyManager.restoreState(state);
	}
	async undo() {
		this.textGlitterManager?.endTextEdit();
		await this.historyManager.undo();
		this.pathEdit?.revalidate();
	}

	async redo() {
		this.textGlitterManager?.endTextEdit();
		await this.historyManager.redo();
		this.pathEdit?.revalidate();
	}

	updateHistoryButtons() {
		this.historyManager.updateButtons();
	}

	// Enable each toolbar tool button from its registry availability rule.
	updateToolButtons() {
		const state = {
			hasImage: this.originalImage !== null,
			autoPreviewActive: Boolean(this.autoGlitterManager?.isSessionActive())
		};
		TOOL_ORDER.forEach((tool) => {
			const button = document.getElementById(getToolButtonId(tool));
			if (button) button.disabled = !TOOLS[tool].available(this, state);
		});
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
		const addBtn = document.getElementById('addLayerBtn');
		const previewToggle = document.getElementById('previewModeToggle');
		const transparencyToggle = document.getElementById('transparencyToggle');
		const boundsToggle = document.getElementById('boundsToggle');

		// --- Reference the container ---
		const previewControls = document.getElementById('previewControls');

		if (clearAllTool) clearAllTool.disabled = !hasImage || autoPreviewActive;
		if (layersBarClearAll) layersBarClearAll.disabled = !hasImage || autoPreviewActive;
		if (exportGif) exportGif.disabled = !hasAnySelection || autoPreviewActive || this.exportInProgress;
		if (saveProject) saveProject.disabled = !hasImage || autoPreviewActive;

		if (transparencyToggle) transparencyToggle.disabled = !hasImage;
		if (boundsToggle) boundsToggle.disabled = !hasImage;

		// --- Toggle visibility of the controls container ---
		if (previewControls) previewControls.classList.toggle('visible', hasImage);
		this.updateExportActionUI?.();

		this.updateToolButtons();
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
			tone: 'danger',
			skippable: false,
			message: 'The image and all layers will be cleared.',
			confirmLabel: 'Clear All'
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
		this.exportResultPresenter?.clear();
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
			this.paintMaskStore.clearAllPaintData();
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
		this.viewport.selectionOverlay.clear();

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
		document.querySelector('.color-selection')?.classList.add('is-empty');
		document.getElementById('selectedColorsDisplay').innerHTML = '';

		// ======================
		// Managers & viewport
		// ======================
		this.glitterLibrary.clearFilters();
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
		this.updateStatus(CONFIG.app.status.noDocument);
		this.updateStatusBar();

		// ======================
		// Global event
		// ======================
		window.dispatchEvent(new Event('imageRemoved'));
	}

	// ===== IMAGE LOADING =====

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

		TOOLS[tool]?.onCanvasAction?.(this, { x, y, clientX, clientY, hitCanvas, event, options });
	}

	handlePreviewContainerClick(e) {
		dbg('📍 Click handler fired', e.type);

		// 0. IGNORE IF JUST FINISHED HANDLE DRAGGING
		if (this.ignoreNextClick) {
			dbg('🚫 Ignoring click - just finished handle drag');
			return;
		}

		// IGNORE TRANSFORM HANDLES
		const clickedGroupBoundingBox = e.target.closest('.group-transform-handles .transform-bounding-box');
		if ((e.target.closest('.transform-handles') ||
			e.target.classList.contains('transform-bounding-box')) && !clickedGroupBoundingBox) return;

		// IGNORE UI ELEMENTS
		if (e.target.closest('.ui-ignore-gestures')) {
			return;
		}

		// MOUSE BUTTON CHECKS
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
				else if (this.currentTool === ToolType.SELECT && e.target.closest(getTransformableLayerElementSelector())) {
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

		const hitTransformableOverlay = e.target.closest(getTransformableLayerElementSelector());

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

	// G-1b: fires whenever a mask encode starts/settles for any glitter layer.
	// Recomputed from ground truth (isMaskPending for the CURRENTLY active layer)
	// rather than trusting this event's own layerId/isPending, so switching the
	// active layer mid-encode can't leave the busy cursor stuck.
	onMaskPendingChange(layerId, isPending) {
		this.maskEditor?.onMaskPendingChange(layerId, isPending);
		const activeLayer = this.layerManager.getActiveLayer();
		const activeIsPending = Boolean(activeLayer && this.glitterManager.isMaskPending(activeLayer.id));
		// The brush encodes on every stroke and has its own cursor UI.
		const brushing = this.currentTool === ToolType.BRUSH;
		if (activeIsPending && !brushing) this.beginActivity('glitter-mask', 'Applying glitter');
		else this.endActivity('glitter-mask');
		if (brushing) return;

		const previewContainer = document.getElementById('previewContainer');

		if (previewContainer) {
			previewContainer.style.cursor = activeIsPending ? 'progress' : '';
		}

		if (!isPending && activeLayer && activeLayer.id === layerId) {
			this.updateStatus('Glitter applied');
		}
	}

	clearPreview() {
		this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		this._basePreviewCache = null;
		if (this.originalImageData) this.renderPreviewCanvas([]);

		this.getLayerRenderManagers().forEach((manager) => manager.clearElements());
	}

	// ===== PREVIEW & RENDERING =====
	requestPreviewUpdate() {
		if (this._previewFrame) return;
		this._previewFrame = requestAnimationFrame(() => {
			this._previewFrame = null;
			this.updatePreview();
		});
	}

	getLayerRenderManagers() {
		return [...new Set(Object.values(LAYER_UI_CONFIG)
			.map((config) => config?.managerKey && this[config.managerKey])
			.filter((manager) => manager?.renderContent && manager?.clearElements))];
	}

	updatePreview() {
		if (this._previewFrame) {
			cancelAnimationFrame(this._previewFrame);
			this._previewFrame = null;
		}
		if (!this.originalImageData) {
			this.clearPreview();
			return;
		}

		const layersToShow = this.showAllLayers
			? this.layers.filter(l => l.visible && layerHasVisibleContent(l))
			: [this.layerManager.getActiveLayer()].filter(l => l && l.visible && layerHasVisibleContent(l));

		this.renderPreviewCanvas(layersToShow);
		this.getLayerRenderManagers().forEach((manager) => manager.renderContent(layersToShow));
	}

	renderPreviewCanvas(layersToShow) {
		// ============================================================
		// UPDATED LOGIC: BASE IMAGE VISIBILITY
		// ============================================================

		// Find the Base Image layer in the stack
		const baseLayer = this.layerManager.getBaseLayer();

		// If the base layer exists and is set to hidden, stop here (leave canvas transparent)
		if (baseLayer && !baseLayer.visible) {
			this.clearBasePreviewCanvas();
			return;
		}

		const background = baseLayer?.background;
		const mode = background?.mode || 'image';
		if ((mode === 'image' && this.baseBackgroundManager?.hasBaseImage()) || mode === 'gradient') {
			const width = this.previewCanvas.width;
			const height = this.previewCanvas.height;
			this.renderBasePreviewImageData(baseLayer, this.baseBackgroundManager.getBackgroundSourceImageData(background, width, height));
		} else if (mode === 'solid') {
			const key = `solid:${this.previewCanvas.width}x${this.previewCanvas.height}:${background.color}:${baseLayer.opacity}`;
			if (this._basePreviewCache?.key === key) return;
			this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
			this.previewCtx.save();
			this.previewCtx.globalAlpha = baseLayer.opacity / 100;
			this.previewCtx.fillStyle = background.color;
			this.previewCtx.fillRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
			this.previewCtx.restore();
			this._basePreviewCache = { key };
		} else {
			this.clearBasePreviewCanvas();
		}
	}

	renderBasePreviewImageData(baseLayer, processed) {
		if (!processed) return;
		const { background, opacity } = baseLayer;
		const key = `${processed.width}x${processed.height}:${opacity}:${JSON.stringify(background.colorAdjust)}`;
		if (this._basePreviewCache?.key === key && this._basePreviewCache.source === processed) return;
		const image = new ImageData(new Uint8ClampedArray(processed.data), processed.width, processed.height);
		applyColorAdjustToImageData(image, background.colorAdjust);
		if (opacity < 100) {
			for (let offset = 3; offset < image.data.length; offset += 4) image.data[offset] = Math.round(image.data[offset] * opacity / 100);
		}
		this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		this.previewCtx.putImageData(image, 0, 0);
		this._basePreviewCache = { key, source: processed, image };
	}

	clearBasePreviewCanvas() {
		if (this._basePreviewCache?.key === 'transparent') return;
		this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
		this._basePreviewCache = { key: 'transparent' };
	}

	// ===== EXPORT PROGRESS =====

	showError(message) {
		this.notifications.notify('error', message);
	}

	updateStatus(message) {
		this.notifications.notify('status', message);
	}

	// Work that takes time before it shows on the canvas. Call the returned
	// `done` from a `finally`.
	beginActivity(key, label) {
		return this.notifications.beginActivity(key, label);
	}

	updateActivity(key, changes) {
		this.notifications.updateActivity(key, changes);
	}

	endActivity(key) {
		this.notifications.endActivity(key);
	}
}

Object.assign(
	GlitterEditor.prototype,
	EDITOR_SETTINGS_METHODS,
	EDITOR_DOCUMENT_IO_METHODS,
	EDITOR_EXPORT_FLOW_METHODS,
	EDITOR_KEYBOARD_METHODS,
	EDITOR_PANEL_METHODS,
	EDITOR_FILL_TOOL_METHODS,
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

Object.defineProperty(GlitterEditor.prototype, 'canvasBounds', Object.getOwnPropertyDescriptor(CANVAS_SIZE_CONTROL_METHODS, 'canvasBounds'));

// everything inside IIFE
(async () => {
	performance.mark('glitter:scripts-parsed');
	// Raster brush packs sit on top of the vector tips; a failure here must not
	// block the editor (the Basic vector tips still work).
	await Promise.all([
		ShapeLibrary.loadManifest(),
		BrushLibrary.loadManifest().catch((error) => {
			console.warn('Raster brush packs unavailable:', error);
		})
	]);
	performance.mark('glitter:manifests-loaded');
	const editor = new GlitterEditor();
	performance.mark('glitter:constructor-done');
	await editor.init();
	performance.mark('glitter:init-done');

	// Load debug configuration if enabled
	if (DEBUG_CONFIG.enabled) {
		await editor.loadDebugConfig();
	}

	// Make editor globally accessible (optional, useful for debugging)
	window.editor = editor;
	performance.mark('glitter:editor-ready');
})();
