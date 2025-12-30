const CONFIG = {
	// app
	maxLayers: 25,
	historyLimit: 30,
	defaultTool: "select",

	// image
	maxImageWidth: 800,
	maxImageHeight: 800,
	maxFileSizeMB: 10,
	defaultCanvasPreset: { width: 400, height: 400, color: '#ffffff' },

	// selection
	defaultThreshold: 50,
	defaultFeather: 0,
	defaultScale: 100,
	defaultOpacity: 100,
	alphaThreshold: 254,
	sliderDebounceMs: 150,

	// Mobile
	mobileStickerHitAreaPadding: 20, // Extra pixels for easier touch targets
	mobileAutoCloseDesignDrawer: true, // Close design drawer after selecting glitter/sticker
	mobileOpenDrawOnLayerAdd: true,
	mobileBreakpoint: 800, // Width in pixels where mobile mode activates



	// glitter
	defaultGlitterId: 111,

	// Preview - selected outline
	selectedGlitterOffset: 2,
	selectedGlitterWidth: 2,


	// Layer List
	exportFrameRateSource: 'first-layer',
	createDefaultLayerOnLoad: false,
	createBaseImageLayerOnLoad: true,

	allowTransparentSelection: true, // If true, allows picking/filling with transparency

	// Layer list - drag
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


	// settings (defaults)
	defaultExportQuality: 10,
	defaultExportDitherEnabled: true,
	defaultExportDitherType: 'FloydSteinberg',
	defaultExportFrameDelay: 110,
	defaultExportMaxFrames: 60,
	defaultExportBaseImage: true,
	defaultExportTransparency: true,
	defaultExportMatteColor: '#ffffff',
	defaultExportFrameSkip: 1,
	defaultExportReverse: false,
	defaultExportSmartFrameReduction: true,
	defaultShowHints: true,




	// watermark
	defaultExportWatermarkEnabled: false,
	watermarkUrl: 'images/watermark/2.png', // Set your watermark URL here
	watermarkPosition: 'bottom-right', // 'top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'center'
	watermarkPaddingX: 5, // pixels from edge
	watermarkPaddingY: 5, // pixels from edge
	watermarkOpacity: 100, // 0-100
	watermarkScale: 100, // percentage

	// debug
	forceIOSExportPreview: false,  // Set to true to test iOS export modal on desktop
	autoSelect: true,
	autoCreateGlitterLayer: true,

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

// Layer UI Configuration - Single source of truth for what UI elements each layer type needs
const LAYER_UI_CONFIG = {
	// Special states (not layer types)
	NO_IMAGE: {
		designPanelSections: ['welcomeSection'],
		mobileSettingsSections: [],
		panelMode: 'welcome'
	},
	NO_LAYER: {
		designPanelSections: ['noLayerSettingsSection'],
		mobileSettingsSections: [],
		panelMode: 'no-layer'
	},

	// Layer types
	[LayerType.BASE_IMAGE]: {
		designPanelSections: ['baseLayerSettingsSection'],
		mobileSettingsSections: [],
		panelMode: 'base-layer',
		onActivate: (editor, layer) => {
			editor.showLayerSettingsEmptyState();
		}
	},

	[LayerType.GLITTER_FILL]: {
		designPanelSections: ['glitterSearchSection', 'glitterOptions', 'glitterSettingsSection', 'layerSettingsSection'],
		mobileSettingsSections: ['tool', 'glitter'],
		panelMode: 'glitter',
		onActivate: (editor, layer) => {
			// Auto-switch to color picker if layer has no selections yet
			if ((!layer.selections || layer.selections.length === 0) && layer.selectedGlitterId) {
				editor.setTool(ToolType.COLOR_PICKER);
			}
			editor.updateGlitterSelection();
			editor.hideLayerSettingsEmptyState();
			editor.hideGlitterSettingsEmptyState();
			editor.loadActiveLayerSettings();
		}
	},

	[LayerType.STICKER]: {
		designPanelSections: ['stickersSearchSection', 'stickersOptions', 'stickerSettingsSection'],
		mobileSettingsSections: ['sticker'],
		panelMode: 'sticker',
		onActivate: (editor, layer) => {
			editor.setTool(ToolType.SELECT);
			editor.hideStickerSettingsEmptyState();
			editor.loadStickerSettings(layer);
			editor.updateStickerSelection();
		}
	}
};
// ============================================
// DEBUG CONFIGURATION
// Set enabled: true to auto-load preset stickers for testing
// ============================================
const DEBUG_CONFIG = {
	enabled: false,  // Set to true to enable debug mode

	// Blank canvas settings (loads automatically if enabled)
	canvas: {
		width: 800,
		height: 800,
		color: '#ffffff'
	},

	// Preset sticker layers - just specify ID and position
	// System will fill in all other defaults automatically
	stickers: [
		{ id: 1, x: 200, y: 200 },
		{ id: 2, x: 400, y: 400 },
		{ id: 3, x: 600, y: 600 }
	]
};











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
		this.canvasElementsContainer = document.getElementById('canvasElementsContainer');

		// Ensure the canvas is the base layer and glitter sits on top
		this.previewCanvas.style.zIndex = '1';
		this.canvasElementsContainer.style.zIndex = '10';
		this.canvasElementsContainer.style.pointerEvents = 'none'; // Allows clicking through to canvas

		this.originalCtx = this.originalCanvas.getContext('2d', { willReadFrequently: true });
		this.previewCtx = this.previewCanvas.getContext('2d', { willReadFrequently: true });



		this.originalImage = null;

		this.originalImage = null;
		this.originalImageData = null;
		this.originalAlphaChannel = null;
		this.content = [];

		this.exporter = null;


		this.touchGestureActive = false;

		this.exportStartTime = 0;
		this.exportCancelled = false;

		// Preview mode
		this.showAllLayers = true;

		// Global settings mode
		this.refineGlobal = CONFIG.refineGlobalDefault;
		this.glitterGlobal = CONFIG.glitterGlobalDefault;


		this.isSaved = false;

		this.currentTool = null;
		this.history = [];
		this.historyIndex = -1;

		// Flag to prevent layer picking immediately after drag
		this.justCompletedDrag = false;

		// Initialize Managers
		this.viewport = new ViewportManager(this.previewContainer, this.previewWrapper);
		this.layerManager = new LayerManager(this);
		this.stickerManager = new StickerManager(this);
		this.glitterManager = new GlitterManager(this);
		this.mobileManager = new MobileManager(this);


		this.showHints = CONFIG.defaultShowHints;
		this.currentHintDismissed = false;


		this.setTool(CONFIG.defaultTool);

		this.setupEventListeners();

		this.initializeCollapsibleSections();
		this.initializeShortcutsModal();
		this.initializeExportSettings();
	}

	// ===== DEBUG CONFIGURATION LOADER =====
	async loadDebugConfig() {
		if (!DEBUG_CONFIG.enabled) return;

		console.log('[DEBUG] Loading debug configuration...');

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

			console.log(`[DEBUG] Loaded sticker: ${stickerInfo.name} at (${stickerPreset.x}, ${stickerPreset.y})`);
		}

		// 3. Update UI
		this.layerManager.renderLayersList();
		this.updatePreview();
		this.updateActionButtons();
		this.saveState();

		console.log('[DEBUG] Debug configuration loaded successfully');
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
		// Initialize sticker manager
		this.stickerManager = new StickerManager(this);
		this.exporter = new GifExporter();
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


	// ===== SETTINGS PERSISTENCE =====

	saveSettingsToStorage() {
		const settings = {
			showHelpfulHints: this.showHints,
			exportQuality: this.exportSettings.quality,
			exportDitherEnabled: this.exportSettings.ditherEnabled,
			exportDitherType: this.exportSettings.ditherType,
			exportTransparency: this.exportSettings.transparency,
			exportMatteColor: this.exportSettings.matteColor,
			exportWatermarkEnabled: this.exportSettings.watermarkEnabled,
			exportFrameDelay: this.exportSettings.frameDelay,
			exportMaxFrames: this.exportSettings.maxFrames,
			exportFrameSkip: this.exportSettings.exportFrameSkip,
			exportReverse: this.exportSettings.exportReverse
		};

		try {
			localStorage.setItem('glitterEditorSettings', JSON.stringify(settings));
		} catch (e) {
			console.warn('Failed to save settings to localStorage:', e);
		}
	}

	loadSettingsFromStorage() {
		try {
			const saved = localStorage.getItem('glitterEditorSettings');
			if (saved) {
				return JSON.parse(saved);
			}
		} catch (e) {
			console.warn('Failed to load settings from localStorage:', e);
		}
		return null;
	}


	// ===== EXPORT SETTINGS =====

	initializeExportSettings() {
		// Load saved settings or use defaults
		const savedSettings = this.loadSettingsFromStorage();

		// Initialize this.exportSettings with saved or default values
		this.exportSettings = {
			quality: savedSettings?.exportQuality ?? CONFIG.defaultExportQuality,
			ditherEnabled: savedSettings?.exportDitherEnabled ?? CONFIG.defaultExportDitherEnabled,
			ditherType: savedSettings?.exportDitherType ?? CONFIG.defaultExportDitherType,
			frameDelay: savedSettings?.exportFrameDelay ?? CONFIG.defaultExportFrameDelay,
			maxFrames: savedSettings?.exportMaxFrames ?? CONFIG.defaultExportMaxFrames,
			baseImage: CONFIG.defaultExportBaseImage, // Not persisted
			transparency: savedSettings?.exportTransparency ?? CONFIG.defaultExportTransparency,
			matteColor: savedSettings?.exportMatteColor ?? CONFIG.defaultExportMatteColor,
			watermarkEnabled: savedSettings?.exportWatermarkEnabled ?? CONFIG.defaultExportWatermarkEnabled,
			exportFrameSkip: savedSettings?.exportFrameSkip ?? CONFIG.defaultExportFrameSkip,
			exportReverse: savedSettings?.exportReverse ?? CONFIG.defaultExportReverse,
			smartFrameReduction: CONFIG.defaultExportSmartFrameReduction
		};

		// Update this.showHints
		this.showHints = savedSettings?.showHelpfulHints ?? CONFIG.defaultShowHints;

		// Sync UI to match exportSettings
		this.syncExportSettingsToUI();

		// Setup listeners
		this.setupExportSettingsListeners();
	}

	syncExportSettingsToUI() {
		const uiElements = {
			exportQuality: { value: this.exportSettings.quality },
			exportDitherEnabled: { checked: this.exportSettings.ditherEnabled },
			exportDitherType: { value: this.exportSettings.ditherType },
			exportBaseImage: { checked: this.exportSettings.baseImage },
			exportTransparency: { checked: this.exportSettings.transparency },
			exportMatteColor: { value: this.exportSettings.matteColor },
			exportFrameDelay: { value: this.exportSettings.frameDelay },
			exportMaxFrames: { value: this.exportSettings.maxFrames },
			exportWatermarkEnabled: { checked: this.exportSettings.watermarkEnabled },
			exportFrameSkip: { value: this.exportSettings.exportFrameSkip },
			exportReverse: { checked: this.exportSettings.exportReverse },
			showHelpfulHints: { checked: this.showHints }
		};

		Object.entries(uiElements).forEach(([id, props]) => {
			const element = document.getElementById(id);
			if (!element) return;

			if ('value' in props) element.value = props.value;
			if ('checked' in props) element.checked = props.checked;
		});

		// Update visibility states
		const ditherTypeRow = document.getElementById('ditherTypeRow');
		if (ditherTypeRow) {
			ditherTypeRow.classList.toggle('disabled', !this.exportSettings.ditherEnabled);
		}

		const matteColorRow = document.getElementById('matteColorRow');
		if (matteColorRow) {
			matteColorRow.classList.toggle('disabled', this.exportSettings.transparency);
		}
	}


	setupExportSettingsListeners() {

		// Map UI elements to exportSettings properties
		const settingsMap = [
			{ id: 'exportQuality', prop: 'quality', parse: (v) => parseInt(v) },
			{ id: 'exportDitherEnabled', prop: 'ditherEnabled', parse: (v) => v },
			{ id: 'exportDitherType', prop: 'ditherType', parse: (v) => v },
			{ id: 'exportBaseImage', prop: 'baseImage', parse: (v) => v },
			{ id: 'exportTransparency', prop: 'transparency', parse: (v) => v },
			{ id: 'exportMatteColor', prop: 'matteColor', parse: (v) => v },
			{ id: 'exportFrameDelay', prop: 'frameDelay', parse: (v) => parseInt(v) },
			{ id: 'exportMaxFrames', prop: 'maxFrames', parse: (v) => parseInt(v) },
			{ id: 'exportWatermarkEnabled', prop: 'watermarkEnabled', parse: (v) => v },
			{ id: 'exportFrameSkip', prop: 'exportFrameSkip', parse: (v) => parseInt(v) },
			{ id: 'exportReverse', prop: 'exportReverse', parse: (v) => v }
		];

		settingsMap.forEach(({ id, prop, parse }) => {
			const element = document.getElementById(id);
			if (!element) return;

			element.addEventListener('change', (e) => {
				const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
				this.exportSettings[prop] = parse(value);
				this.saveSettingsToStorage();

				// Update dependent UI states
				if (id === 'exportDitherEnabled') {
					const ditherTypeRow = document.getElementById('ditherTypeRow');
					if (ditherTypeRow) ditherTypeRow.classList.toggle('disabled', !value);
				}
				if (id === 'exportTransparency') {
					const matteColorRow = document.getElementById('matteColorRow');
					if (matteColorRow) matteColorRow.classList.toggle('disabled', value);
				}
			});
		});

		// Helpful hints setting
		const showHintsInput = document.getElementById('showHelpfulHints');
		if (showHintsInput) {
			showHintsInput.addEventListener('change', (e) => {
				this.showHints = e.target.checked;
				this.updateHelpfulMessage();
				this.saveSettingsToStorage();
			});
		}
	}

	setupExportListeners() {
		const exportGif = document.getElementById('exportGif');
		if (exportGif) {
			exportGif.addEventListener('click', () => this.exportAnimatedGif());
		}
	}



	updateSidePanelUI(layer) {
		// 1. Define ALL possible sections to hide them first
		const allSections = [
			'welcomeSection',
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

		// 3. Determine which config to use
		let config;
		if (!this.originalImage) {
			config = LAYER_UI_CONFIG.NO_IMAGE;
		} else if (!layer) {
			config = LAYER_UI_CONFIG.NO_LAYER;
		} else {
			config = LAYER_UI_CONFIG[layer.type];
		}

		// 4. Show the appropriate sections
		if (config) {
			config.designPanelSections.forEach(id => {
				const el = document.getElementById(id);
				if (el) el.classList.add('visible');
			});

			// 5. Set panel mode
			const designPanel = document.getElementById('designPanel');
			if (designPanel) {
				designPanel.dataset.panelMode = config.panelMode;
			}
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
		document.querySelectorAll('.asset-option').forEach(opt => {
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

		// Query all glitter options in BOTH traditional grid AND asset browser
		const glitterOptions = document.querySelectorAll(
			'.asset-options .asset-option, #glitterItemGrid .asset-option, #glitterSearchResults .asset-option'
		);

		glitterOptions.forEach(opt => {
			// Compare IDs instead of indices
			const isSelected = layer && layer.type === LayerType.GLITTER_FILL &&
				parseInt(opt.dataset.id) === layer.selectedGlitterId;
			opt.classList.toggle('selected', isSelected);
		});

		// Update helpful message
		this.updateHelpfulMessage();

	}

	updateStickerSelection() {
		const layer = this.layerManager.getActiveLayer();

		// Get all sticker options (from asset browser)
		const stickerOptions = document.querySelectorAll('.asset-options .asset-option');

		// Early return if no sticker layer is active
		if (!layer || layer.type !== LayerType.STICKER || !layer.stickerSourceId) {
			// Clear all selections
			stickerOptions.forEach(opt => opt.classList.remove('selected'));
			return;
		}

		// Mark the matching sticker as selected
		stickerOptions.forEach(opt => {
			// Convert both to strings for comparison (or both to numbers)
			const isSelected = String(opt.dataset.id) === String(layer.stickerSourceId);
			opt.classList.toggle('selected', isSelected);
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
	}


	// ===== EVENT LISTENERS =====

	setupEventListeners() {
		this.setupToolbarListeners();
		this.setupZoomListeners();
		this.setupPanListeners();
		this.setupStickerCenterListeners();
		this.setupColorPickerContextListeners();
		this.setupLayerSettingsListeners();
		this.setupSliderListeners();
		this.setupStickerSettingsListeners();
		this.setupExportListeners();
		this.setupImageListeners();
		this.setupModalListeners();
		this.setupPreviewListeners();
		this.setupGlobalListeners();
		this.setupHelpfulMessageListeners();
	}

	// ===== HELPER: Attach slider with live update and reset =====
	setupSlider(sliderId, valueId, suffix, updateCallback, resetValue) {
		const slider = document.getElementById(sliderId);
		const valueDisplay = document.getElementById(valueId);
		const resetBtn = document.getElementById('reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1));

		if (!slider || !valueDisplay) return;

		// Live value display
		slider.addEventListener('input', (e) => {
			valueDisplay.textContent = e.target.value + suffix;
			if (resetBtn) {
				resetBtn.disabled = parseInt(slider.value) === resetValue;
			}
			if (updateCallback) updateCallback(e);
		});

		// Reset button
		if (resetBtn) {
			resetBtn.addEventListener('click', () => {
				slider.value = resetValue;
				valueDisplay.textContent = resetValue + suffix;
				slider.dispatchEvent(new Event('input'));
				slider.dispatchEvent(new Event('change'));
				resetBtn.disabled = true;
			});
			resetBtn.disabled = parseInt(slider.value) === resetValue;
		}
	}

	// ===== HELPER: Attach checkbox that syncs with another checkbox =====
	syncCheckboxes(sourceId, targetId) {
		const source = document.getElementById(sourceId);
		const target = document.getElementById(targetId);

		if (!source || !target) return;

		source.addEventListener('change', (e) => {
			target.checked = e.target.checked;
		});
	}



	// ===== TOOLBAR LISTENERS =====
	setupToolbarListeners() {
		const tools = [
			{ id: 'selectTool', type: ToolType.SELECT },
			{ id: 'colorPickerTool', type: ToolType.COLOR_PICKER },
			{ id: 'handTool', type: ToolType.HAND },
			{ id: 'zoomTool', type: ToolType.ZOOM }
		];

		tools.forEach(({ id, type }) => {
			const btn = document.getElementById(id);
			if (btn) btn.addEventListener('click', () => this.setTool(type));
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

	// ===== ZOOM CONTROL LISTENERS =====
	setupZoomListeners() {
		const controls = [
			{ id: 'zoomIn', handler: () => this.viewport.zoomIn() },
			{ id: 'zoomOut', handler: () => this.viewport.zoomOut() },
			{ id: 'zoomPercentage', handler: () => this.viewport.resetZoom() },
			{ id: 'fitScreen', handler: () => this.viewport.zoomToFit() },
			{ id: 'fillScreen', handler: () => this.viewport.zoomToFill() }
		];

		controls.forEach(({ id, handler }) => {
			const btn = document.getElementById(id);
			if (btn) btn.addEventListener('click', handler);
		});
	}

	setupPanListeners() {
		const controls = [
			{ id: 'centerCanvasHorizontal', handler: () => this.viewport.centerHorizontal() },
			{ id: 'centerCanvasVertical', handler: () => this.viewport.centerVertical() }
		];

		controls.forEach(({ id, handler }) => {
			const btn = document.getElementById(id);
			if (btn) btn.addEventListener('click', handler);
		});
	}

	setupStickerCenterListeners() {
		const centerStickerHorizontal = document.getElementById('centerStickerHorizontal');
		const centerStickerVertical = document.getElementById('centerStickerVertical');

		if (centerStickerHorizontal) {
			centerStickerHorizontal.addEventListener('click', () => {
				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					this.stickerManager.centerHorizontal(layer.id);
				}
			});
		}

		if (centerStickerVertical) {
			centerStickerVertical.addEventListener('click', () => {
				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					this.stickerManager.centerVertical(layer.id);
				}
			});
		}
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
				this.saveActiveLayerSettings(true, false);
				this.debouncedSliderUpdate('threshold');
			});

			contextThreshold.addEventListener('change', () => {
				this.saveState();
			});
		}

		// Multi-select checkbox
		if (contextMultiSelect) {
			contextMultiSelect.addEventListener('change', (e) => {
				const multiSelect = document.getElementById('multiSelect');
				if (multiSelect) multiSelect.checked = e.target.checked;

				const layer = this.layerManager.getActiveLayer();
				if (!e.target.checked && layer && layer.selections.length > 1) {
					layer.selections = [layer.selections[0]];
				}

				this.saveActiveLayerSettings();
				this.updatePreview();
				this.updateSelectedColorsDisplay();
				this.updateColorPickerControls();
				this.saveState();
			});
		}

		// Contiguous checkbox
		if (contextContiguous) {
			contextContiguous.addEventListener('change', (e) => {
				const contiguous = document.getElementById('contiguous');
				if (contiguous) contiguous.checked = e.target.checked;

				this.saveActiveLayerSettings();
				this.updatePreview();
				this.saveState();
			});
		}
	}

	setupLayerSettingsListeners() {
		const contiguous = document.getElementById('contiguous');
		const invert = document.getElementById('invert');
		const multiSelect = document.getElementById('multiSelect');
		const refineGlobal = document.getElementById('refineGlobal');
		const glitterGlobal = document.getElementById('glitterGlobal');

		if (contiguous) {
			contiguous.addEventListener('change', (e) => {
				const contextContiguous = document.getElementById('contextContiguous');
				if (contextContiguous) contextContiguous.checked = e.target.checked;

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
				const contextMultiSelect = document.getElementById('contextMultiSelect');
				if (contextMultiSelect) contextMultiSelect.checked = e.target.checked;

				const layer = this.layerManager.getActiveLayer();
				if (!e.target.checked && layer && layer.selections.length > 1) {
					layer.selections = [layer.selections[0]];
				}

				this.saveActiveLayerSettings();
				this.updatePreview();
				this.updateSelectedColorsDisplay();
				this.updateColorPickerControls();
				this.saveState();
			});
		}

		if (refineGlobal) {
			refineGlobal.addEventListener('change', (e) => {
				this.refineGlobal = e.target.checked;
				if (this.refineGlobal) {
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
					this.saveActiveLayerSettings(false, true);
					this.updatePreview();
					this.saveState();
					this.updateStatus('Global scale/opacity applied');
				}
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
		}, CONFIG.defaultThreshold);

		const threshold = document.getElementById('threshold');
		if (threshold) {
			threshold.addEventListener('input', () => {
				this.saveActiveLayerSettings(true, false);
				this.debouncedSliderUpdate('threshold');
			});
			threshold.addEventListener('change', () => this.saveState());
		}

		// Feather
		this.setupSlider('feather', 'featherValue', '', null, CONFIG.defaultFeather);
		const feather = document.getElementById('feather');
		if (feather) {
			feather.addEventListener('input', () => {
				this.saveActiveLayerSettings(true, false);
				this.debouncedSliderUpdate('feather');
			});
			feather.addEventListener('change', () => this.saveState());
		}

		// Scale
		this.setupSlider('scale', 'scaleValue', '%', null, CONFIG.defaultScale);
		const scale = document.getElementById('scale');
		if (scale) {
			scale.addEventListener('input', () => {
				this.saveActiveLayerSettings(false, true);
				this.debouncedSliderUpdate('scale');
			});
			scale.addEventListener('change', () => this.saveState());
		}

		// Opacity
		this.setupSlider('opacity', 'opacityValue', '%', null, CONFIG.defaultOpacity);
		const opacity = document.getElementById('opacity');
		if (opacity) {
			opacity.addEventListener('input', () => {
				this.saveActiveLayerSettings(false, true);
				this.debouncedSliderUpdate('opacity');
			});
			opacity.addEventListener('change', () => this.saveState());
		}
	}

	setupStickerSettingsListeners() {
		this.setupStickerPositionListeners();
		this.setupStickerRotationListeners();
		this.setupStickerScaleListeners();
		this.setupStickerOpacityListeners();
		this.setupStickerFlipListeners();
	}

	setupStickerPositionListeners() {
		const posX = document.getElementById('stickerPosX');
		const posY = document.getElementById('stickerPosY');

		const updatePosition = () => {
			const layer = this.layerManager.getActiveLayer();
			if (!layer || layer.type !== LayerType.STICKER || !this.stickerManager) return;

			this.stickerManager.updateTransform(layer.id, {
				position: {
					x: parseFloat(posX.value),
					y: parseFloat(posY.value)
				}
			});
		};

		if (posX) {
			posX.addEventListener('input', updatePosition);
			posX.addEventListener('change', () => this.saveState());
		}

		if (posY) {
			posY.addEventListener('input', updatePosition);
			posY.addEventListener('change', () => this.saveState());
		}
	}

	setupStickerRotationListeners() {
		const rotation = document.getElementById('stickerRotation');
		const rotationValue = document.getElementById('stickerRotationValue');
		const resetBtn = document.getElementById('resetStickerRotation');

		if (rotation && rotationValue) {
			rotation.addEventListener('input', (e) => {
				const value = parseFloat(e.target.value);
				rotationValue.textContent = Math.round(value) + '°';

				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					this.stickerManager.updateTransform(layer.id, { rotation: value });
				}
			});

			rotation.addEventListener('change', () => this.saveState());
		}

		if (resetBtn) {
			resetBtn.addEventListener('click', () => {
				if (rotation) rotation.value = CONFIG.defaultStickerRotation;
				if (rotationValue) rotationValue.textContent = CONFIG.defaultStickerRotation + '°';

				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					this.stickerManager.updateTransform(layer.id, { rotation: CONFIG.defaultStickerRotation });
					this.saveState();
				}
			});
		}
	}
	setupStickerScaleListeners() {
		const scaleX = document.getElementById('stickerScaleX');
		const scaleXValue = document.getElementById('stickerScaleXValue');
		const scaleY = document.getElementById('stickerScaleY');
		const scaleYValue = document.getElementById('stickerScaleYValue');
		const proportionalScale = document.getElementById('stickerProportionalScale');
		const resetScaleX = document.getElementById('resetStickerScaleX');
		const resetScaleY = document.getElementById('resetStickerScaleY');

		// Scale X
		if (scaleX && scaleXValue) {
			scaleX.addEventListener('input', (e) => {
				const value = parseFloat(e.target.value);
				scaleXValue.textContent = Math.round(value) + '%';

				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					if (proportionalScale && proportionalScale.checked) {
						if (scaleY && scaleYValue) {
							scaleY.value = value;
							scaleYValue.textContent = Math.round(value) + '%';
						}
						this.stickerManager.updateTransform(layer.id, {
							scale: { x: value, y: value }
						});
					} else {
						this.stickerManager.updateTransform(layer.id, {
							scale: { x: value }
						});
					}
				}
			});

			scaleX.addEventListener('change', () => this.saveState());
		}

		// Scale Y
		if (scaleY && scaleYValue) {
			scaleY.addEventListener('input', (e) => {
				const value = parseFloat(e.target.value);
				scaleYValue.textContent = Math.round(value) + '%';

				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					if (proportionalScale && proportionalScale.checked) {
						if (scaleX && scaleXValue) {
							scaleX.value = value;
							scaleXValue.textContent = Math.round(value) + '%';
						}
						this.stickerManager.updateTransform(layer.id, {
							scale: { x: value, y: value }
						});
					} else {
						this.stickerManager.updateTransform(layer.id, {
							scale: { y: value }
						});
					}
				}
			});

			scaleY.addEventListener('change', () => this.saveState());
		}

		// Proportional scale toggle
		if (proportionalScale) {
			proportionalScale.addEventListener('change', (e) => {
				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER) {
					layer.stickerData.transform.proportionalScale = e.target.checked;
					this.saveState();
				}
			});
		}

		// Reset Scale X
		if (resetScaleX) {
			resetScaleX.addEventListener('click', () => {
				if (scaleX) scaleX.value = CONFIG.defaultStickerScale;
				if (scaleXValue) scaleXValue.textContent = CONFIG.defaultStickerScale + '%';

				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					if (proportionalScale && proportionalScale.checked) {
						if (scaleY && scaleYValue) {
							scaleY.value = CONFIG.defaultStickerScale;
							scaleYValue.textContent = CONFIG.defaultStickerScale + '%';
						}
						this.stickerManager.updateTransform(layer.id, {
							scale: { x: CONFIG.defaultStickerScale, y: CONFIG.defaultStickerScale }
						});
					} else {
						this.stickerManager.updateTransform(layer.id, {
							scale: { x: CONFIG.defaultStickerScale }
						});
					}
					this.saveState();
				}
			});
		}

		// Reset Scale Y
		if (resetScaleY) {
			resetScaleY.addEventListener('click', () => {
				if (scaleY) scaleY.value = CONFIG.defaultStickerScale;
				if (scaleYValue) scaleYValue.textContent = CONFIG.defaultStickerScale + '%';

				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					if (proportionalScale && proportionalScale.checked) {
						if (scaleX && scaleXValue) {
							scaleX.value = CONFIG.defaultStickerScale;
							scaleXValue.textContent = CONFIG.defaultStickerScale + '%';
						}
						this.stickerManager.updateTransform(layer.id, {
							scale: { x: CONFIG.defaultStickerScale, y: CONFIG.defaultStickerScale }
						});
					} else {
						this.stickerManager.updateTransform(layer.id, {
							scale: { y: CONFIG.defaultStickerScale }
						});
					}
					this.saveState();
				}
			});
		}
	}

	setupStickerOpacityListeners() {
		const opacity = document.getElementById('stickerOpacity');
		const opacityValue = document.getElementById('stickerOpacityValue');
		const resetBtn = document.getElementById('resetStickerOpacity');

		if (opacity && opacityValue) {
			opacity.addEventListener('input', (e) => {
				const value = parseFloat(e.target.value);
				opacityValue.textContent = Math.round(value) + '%';

				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					this.stickerManager.updateTransform(layer.id, { opacity: value });
				}
			});

			opacity.addEventListener('change', () => this.saveState());
		}

		if (resetBtn) {
			resetBtn.addEventListener('click', () => {
				if (opacity) opacity.value = CONFIG.defaultStickerOpacity;
				if (opacityValue) opacityValue.textContent = CONFIG.defaultStickerOpacity + '%';

				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					this.stickerManager.updateTransform(layer.id, { opacity: CONFIG.defaultStickerOpacity });
					this.saveState();
				}
			});
		}
	}

	setupStickerFlipListeners() {
		const flipX = document.getElementById('stickerFlipX');
		const flipY = document.getElementById('stickerFlipY');

		if (flipX) {
			flipX.addEventListener('change', (e) => {
				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					this.stickerManager.updateTransform(layer.id, { flipX: e.target.checked });
					this.saveState();
				}
			});
		}

		if (flipY) {
			flipY.addEventListener('change', (e) => {
				const layer = this.layerManager.getActiveLayer();
				if (layer && layer.type === LayerType.STICKER && this.stickerManager) {
					this.stickerManager.updateTransform(layer.id, { flipY: e.target.checked });
					this.saveState();
				}
			});
		}
	}





	setupImageListeners() {
		const imageUpload = document.getElementById('imageUpload');
		const imageDropzone = document.getElementById('imageDropzone');
		const imageClearBtn = document.getElementById('imageClearBtn');

		// New Canvas button
		const openNewCanvasBtn = document.getElementById('openNewCanvasBtn');
		if (openNewCanvasBtn) {
			openNewCanvasBtn.addEventListener('click', () => {
				const modal = document.getElementById('newCanvasModal');
				if (modal) {
					modal.classList.add('visible');
					this.initializeNewCanvasModal(); // <-- ADD THIS LINE
				}
			});
		}

		if (imageUpload) {
			imageUpload.addEventListener('change', (e) => this.loadImage(e));
		}

		if (imageDropzone) {
			imageDropzone.addEventListener('click', () => {
				imageUpload.click();
			});

			imageDropzone.addEventListener('dragover', (e) => {
				e.preventDefault();
				imageDropzone.classList.add('drag-over');
			});

			imageDropzone.addEventListener('dragleave', () => {
				imageDropzone.classList.remove('drag-over');
			});

			imageDropzone.addEventListener('drop', async (e) => {
				e.preventDefault();
				imageDropzone.classList.remove('drag-over');

				const file = e.dataTransfer.files[0];
				if (file && file.type.startsWith('image/')) {
					const fakeEvent = { target: { files: [file] } };
					await this.loadImage(fakeEvent);
				}
			});
		}

		if (imageClearBtn) {
			imageClearBtn.addEventListener('click', () => {
				if (confirm('Are you sure you want to remove the image? This will clear the image and all layers.')) {
					this.clearImage();
				}
			});
		}
	}


	initializeNewCanvasModal() {
		const widthInput = document.getElementById('newCanvasWidth');
		const heightInput = document.getElementById('newCanvasHeight');
		const colorInput = document.getElementById('newCanvasColor');
		const presetButtons = document.querySelectorAll('.new-canvas-preset-btn');
		const backgroundRadios = document.querySelectorAll('input[name="canvasBackground"]');
		const colorRow = document.getElementById('canvasColorRow');

		// Reset to defaults
		if (widthInput) widthInput.value = CONFIG.defaultCanvasPreset.width;
		if (heightInput) heightInput.value = CONFIG.defaultCanvasPreset.height;
		if (colorInput) colorInput.value = CONFIG.defaultCanvasPreset.color;

		// Reset background to "Color" option
		const colorRadio = document.querySelector('input[name="canvasBackground"][value="color"]');
		if (colorRadio) colorRadio.checked = true;

		// Enable color row since we default to color background
		if (colorRow) colorRow.classList.remove('disabled');

		// Find and activate matching preset
		let matchingPreset = null;
		presetButtons.forEach(btn => {
			btn.classList.remove('active');
			const width = parseInt(btn.dataset.width);
			const height = parseInt(btn.dataset.height);
			if (width === CONFIG.defaultCanvasPreset.width && height === CONFIG.defaultCanvasPreset.height) {
				matchingPreset = btn;
			}
		});

		if (matchingPreset) {
			matchingPreset.classList.add('active');
		}

		// Update orientation buttons based on default dimensions
		this.updateOrientationButtons(CONFIG.defaultCanvasPreset.width, CONFIG.defaultCanvasPreset.height);
	}

	setupNewCanvasModalListeners() {
		const createBtn = document.getElementById('createCanvasBtn');
		const cancelBtn = document.getElementById('createCanvasCloseBtn');

		const widthInput = document.getElementById('newCanvasWidth');
		const heightInput = document.getElementById('newCanvasHeight');
		const colorInput = document.getElementById('newCanvasColor');
		const orientationPortrait = document.getElementById('orientationPortrait');
		const orientationLandscape = document.getElementById('orientationLandscape');
		const presetButtons = document.querySelectorAll('.new-canvas-preset-btn');
		const backgroundRadios = document.querySelectorAll('input[name="canvasBackground"]');
		const colorRow = document.getElementById('canvasColorRow');

		// Preset buttons
		presetButtons.forEach(btn => {
			btn.addEventListener('click', () => {
				const width = parseInt(btn.dataset.width);
				const height = parseInt(btn.dataset.height);

				if (widthInput) widthInput.value = width;
				if (heightInput) heightInput.value = height;

				presetButtons.forEach(b => b.classList.remove('active'));
				btn.classList.add('active');

				this.updateOrientationButtons(width, height);
			});
		});

		// Orientation toggle - Portrait
		if (orientationPortrait) {
			orientationPortrait.addEventListener('click', () => {
				const width = parseInt(widthInput.value);
				const height = parseInt(heightInput.value);

				if (width === height) return;

				if (width > height) {
					widthInput.value = height;
					heightInput.value = width;
				}

				this.updateOrientationButtons(parseInt(widthInput.value), parseInt(heightInput.value));
			});
		}

		// Orientation toggle - Landscape
		if (orientationLandscape) {
			orientationLandscape.addEventListener('click', () => {
				const width = parseInt(widthInput.value);
				const height = parseInt(heightInput.value);

				if (width === height) return;

				if (height > width) {
					widthInput.value = height;
					heightInput.value = width;
				}

				this.updateOrientationButtons(parseInt(widthInput.value), parseInt(heightInput.value));
			});
		}

		// Dimension inputs
		if (widthInput && heightInput) {
			const updateOrientation = () => {
				this.updateOrientationButtons(parseInt(widthInput.value), parseInt(heightInput.value));
			};

			widthInput.addEventListener('input', updateOrientation);
			heightInput.addEventListener('input', updateOrientation);
		}

		// Background type toggle
		backgroundRadios.forEach(radio => {
			radio.addEventListener('change', (e) => {
				if (colorRow) {
					colorRow.classList.toggle('disabled', radio.value !== 'color');
				}
			});
		});

		// Create button
		if (createBtn) {
			createBtn.addEventListener('click', async () => {
				const width = parseInt(widthInput.value);
				const height = parseInt(heightInput.value);
				const backgroundType = document.querySelector('input[name="canvasBackground"]:checked').value;
				const color = backgroundType === 'color' ? colorInput.value : 'transparent';

				await this.loadBlankImage(width, height, color);
				this.modalManager.close('newCanvasModal');
			});
		}

		if (cancelBtn) {
			cancelBtn.addEventListener('click', () => {
				this.modalManager.close('newCanvasModal');
			});
		}
	}

	updateOrientationButtons(width, height) {
		const portraitBtn = document.getElementById('orientationPortrait');
		const landscapeBtn = document.getElementById('orientationLandscape');

		if (!portraitBtn || !landscapeBtn) return;

		// Check if square
		const isSquare = width === height;

		// Disable buttons if square
		portraitBtn.disabled = isSquare;
		landscapeBtn.disabled = isSquare;

		// Remove active from both
		portraitBtn.classList.remove('active');
		landscapeBtn.classList.remove('active');

		// Only set active state if not square
		if (!isSquare) {
			if (height > width) {
				portraitBtn.classList.add('active');
			} else if (width > height) {
				landscapeBtn.classList.add('active');
			}
		}
	}

	setupModalListeners() {
		this.modalManager = new ModalManager();

		// Simple modals (inline content)
		this.modalManager
			.register('shortcutsModal', {
				openBtnId: 'shortcutsBtn',
				closeBtnId: 'closeShortcutsModal',
				resetScrollOnOpen: true
			})
			.register('settingsModal', {
				openBtnId: 'settingsBtn',
				closeBtnId: 'closeSettingsModal',
				resetScrollOnOpen: true
			});

		// External content modals with utils.js initialization
		this.modalManager
			.register('aboutModal', {
				openBtnId: 'aboutBtn',
				closeBtnId: 'closeAboutModal',
				externalContentUrl: 'modals/about.html',
				cacheContent: true,
				resetScrollOnOpen: true,
				onContentLoaded: (modalBody) => {
					// Initialize pixel-scaled images
					initPixelScalerInContainer(modalBody);

					// Initialize references (sup ↔ reference list interaction)
					initModalReferences(modalBody, {
						referenceListSelector: 'ol#AboutReferencesList'
					});

					// Initialize smooth scrolling for TOC and anchors
					const modal = document.getElementById('aboutModal');
					initModalSmoothScroll(modal);

					// Initialize tooltips for dynamically loaded content
					initTooltipsInContainer(modalBody);


				}
			})
			.register('guideModal', {
				openBtnId: 'guideBtn',
				closeBtnId: 'closeGuideModal',
				externalContentUrl: 'modals/guide.html',
				cacheContent: true,
				resetScrollOnOpen: true,
				onContentLoaded: (modalBody) => {
					// Initialize pixel-scaled images (for screenshots)
					initPixelScalerInContainer(modalBody);

					// Initialize smooth scrolling for TOC navigation
					const modal = document.getElementById('guideModal');
					initModalSmoothScroll(modal);
				}
			});

		// Layer type picker modal (no open button - opened programmatically)
		this.modalManager.register('layerTypePickerModal', {
			closeBtnId: 'closeLayerTypePickerModal',
			resetScrollOnOpen: false
		});

		// Sticker upload modal - ONLY uploadStickerBtn opens this
		this.modalManager.register('stickerUploadModal', {
			openBtnId: 'uploadStickerBtn',
			closeBtnId: 'closeStickerUploadModal',
			resetScrollOnOpen: false
		});

		// New canvas modal
		this.modalManager.register('newCanvasModal', {
			closeBtnId: 'closeNewCanvasModal',
			resetScrollOnOpen: true,
			onOpen: () => this.initializeNewCanvasModal()
		});

		// Setup modal-specific interactions
		this.setupLayerTypePickerListeners();
		this.setupLayerPanelListeners();
		this.setupStickerUploadModalListeners();
		this.setupNewCanvasModalListeners();
	}

	setupLayerTypePickerListeners() {
		const layerTypeButtons = document.querySelectorAll('.layer-type-option');

		layerTypeButtons.forEach(btn => {
			btn.addEventListener('click', () => {
				const type = btn.dataset.layerType;

				// Map dataset value to LayerType enum
				let layerType;
				switch (type) {
					case 'sticker':
						layerType = LayerType.STICKER;
						break;
					case 'glitter-fill':
						layerType = LayerType.GLITTER_FILL;
						break;
					default:
						console.error('Unknown layer type:', type);
						return;
				}

				// Close modal FIRST, then add layer
				this.modalManager.close('layerTypePickerModal');

				// Small delay to ensure modal close completes
				requestAnimationFrame(() => {
					this.layerManager.addLayer(layerType);
				});
			});
		});
	}

	setupStickerUploadModalListeners() {
		// Note: Modal open/close is handled by ModalManager
		// uploadStickerBtn opens the modal via ModalManager.register()

		const dropzone = document.getElementById('stickerUploadDropzone');
		const input = document.getElementById('stickerUploadInput');

		// Dropzone click
		if (dropzone && input) {
			dropzone.addEventListener('click', () => {
				input.click();
			});
		}

		// File selection
		if (input) {
			input.addEventListener('change', async (e) => {
				const file = e.target.files[0];
				if (file) {
					await this.stickerManager.handleUserUpload(file);
					this.modalManager.close('stickerUploadModal');
					input.value = '';
				}
			});
		}

		// Drag and drop
		if (dropzone) {
			dropzone.addEventListener('dragover', (e) => {
				e.preventDefault();
				dropzone.classList.add('drag-over');
			});

			dropzone.addEventListener('dragleave', () => {
				dropzone.classList.remove('drag-over');
			});

			dropzone.addEventListener('drop', async (e) => {
				e.preventDefault();
				dropzone.classList.remove('drag-over');

				const file = e.dataTransfer.files[0];
				if (file) {
					await this.stickerManager.handleUserUpload(file);
					this.modalManager.close('stickerUploadModal');
				}
			});
		}
	}

	setupLayerPanelListeners() {
		// Add layer buttons - open layer type picker
		const addLayerBtn = document.getElementById('addLayerBtn');
		if (addLayerBtn) {
			addLayerBtn.addEventListener('click', () => {
				this.modalManager.open('layerTypePickerModal');
			});
		}

		const mobileAddBtn = document.getElementById('mobileAddLayerBtn');
		if (mobileAddBtn) {
			mobileAddBtn.addEventListener('click', () => {
				// Close all mobile menus first
				if (this.mobileManager && this.mobileManager.isMobile) {
					this.mobileManager.closeAllDrawers();
					this.mobileManager.closeSettings();
				}
				this.modalManager.open('layerTypePickerModal');
			});
		}

		// Bottom bar quick-add buttons - create layers directly
		const layersBarAddGlitter = document.getElementById('layersBarAddGlitter');
		const layersBarAddSticker = document.getElementById('layersBarAddSticker');

		if (layersBarAddGlitter) {
			layersBarAddGlitter.addEventListener('click', () => {
				this.layerManager.addLayer(LayerType.GLITTER_FILL);
			});
		}

		if (layersBarAddSticker) {
			layersBarAddSticker.addEventListener('click', () => {
				// Create new sticker layer (NOT upload modal)
				this.layerManager.addLayer(LayerType.STICKER);
			});
		}

		// Bottom bar action buttons
		const layersBarGoToSelected = document.getElementById('layersBarGoToSelected');
		const layersBarCloneSelected = document.getElementById('layersBarCloneSelected');
		const layersBarDeleteSelected = document.getElementById('layersBarDeleteSelected');

		if (layersBarGoToSelected) {
			layersBarGoToSelected.addEventListener('click', () => {
				const selectedLayer = this.layerManager.getActiveLayer();
				if (!selectedLayer || selectedLayer.type === LayerType.BASE_IMAGE) return;

				if (selectedLayer.type === LayerType.GLITTER_FILL) {
					this.layerManager.goToGlitter(selectedLayer.id);
				} else if (selectedLayer.type === LayerType.STICKER) {
					this.layerManager.goToSticker(selectedLayer.id);
				}
			});
		}

		if (layersBarCloneSelected) {
			layersBarCloneSelected.addEventListener('click', () => {
				const selectedLayer = this.layerManager.getActiveLayer();
				if (!selectedLayer || selectedLayer.type === LayerType.BASE_IMAGE) return;
				this.layerManager.cloneLayer(selectedLayer.id);
			});
		}

		if (layersBarDeleteSelected) {
			layersBarDeleteSelected.addEventListener('click', () => {
				const selectedLayer = this.layerManager.getActiveLayer();
				if (!selectedLayer || selectedLayer.type === LayerType.BASE_IMAGE) return;

				// Add delete confirmation
				if (confirm('Delete this layer?')) {
					this.layerManager.deleteLayer(selectedLayer.id);
				}
			});
		}
	}

	togglePreview() {
		this.showAllLayers = !this.showAllLayers;

		const previewToggle = document.getElementById('previewModeToggle');
		if (previewToggle) {
			previewToggle.classList.toggle('active', !this.showAllLayers);
		}

		this.updatePreview();
		this.updateActionButtons(); // Updates the button title
	}

	setupPreviewListeners() {
		const previewToggle = document.getElementById('previewModeToggle');
		const transparencyToggle = document.getElementById('transparencyToggle');
		const boundsToggle = document.getElementById('boundsToggle');

		if (previewToggle) {
			previewToggle.addEventListener('click', () => this.togglePreview());
		}

		if (transparencyToggle) {
			transparencyToggle.addEventListener('click', () => {
				const isActive = transparencyToggle.classList.toggle('active');
				this.previewContainer.classList.toggle('transparent-bg', isActive);

				if (isActive) {
					this.updateTransparencyGrid();
				} else {
					this.previewContainer.style.backgroundSize = '';
					this.previewContainer.style.backgroundPosition = '';
				}
			});
		}

		if (boundsToggle) {
			boundsToggle.addEventListener('click', () => {
				const isActive = boundsToggle.classList.toggle('active');
				this.previewContainer.classList.toggle('bounds', isActive);
			});
		}

		this.previewContainer.addEventListener('pointerdown', (e) => {
			this.handlePreviewContainerClick(e);
		});

		// Prevent right-click context menu on preview area
		this.previewContainer.addEventListener('contextmenu', (e) => {
			// Always prevent on canvas
			if (e.target === this.previewCanvas) {
				e.preventDefault();
				return;
			}

			// When zoom tool is active, prevent anywhere in container for zoom out functionality
			if (this.currentTool === ToolType.ZOOM) {
				e.preventDefault();
			}
		});
	}

	// ===== GLOBAL LISTENERS =====
	setupGlobalListeners() {
		// Keyboard
		document.addEventListener('keydown', (e) => this.handleKeyboard(e));
		document.addEventListener('keyup', (e) => this.handleKeyUp(e));

		// Viewport changes
		window.addEventListener('viewportChanged', () => {
			this.updateZoomUI();
			this.updateTransparencyGrid();
			this.updateStatusBar();
		});

		// Prevent leaving if unsaved
		window.addEventListener('beforeunload', (e) => {
			if ((this.originalImage || this.historyIndex > 0) && !this.isSaved) {
				e.preventDefault();
				e.returnValue = '';
			}
		});


		// Scroll zoom
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
	}

	updateResetButton(sliderId) {
		const resetBtn = document.getElementById('reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1));
		const slider = document.getElementById(sliderId);
		const defaultValue = CONFIG['default' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1)];
		if (resetBtn) {
			resetBtn.disabled = parseInt(slider.value) === defaultValue;
		}
	}

	async loadBlankImage(width, height, color = CONFIG.defaultCanvasPreset.color) {
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

		const fakeEvent = {
			target: {
				files: [file]
			}
		};

		await this.loadImage(fakeEvent);
		this.updateStatus(`Created ${width}×${height} canvas`);
	}

	setTool(tool) {
	if (this.currentTool === tool) return;
	
	this.currentTool = tool;
	this.currentHintDismissed = false; // Reset dismissed flag when tool changes


		// Remove all tool classes from body
		document.body.classList.remove('tool-select', 'tool-hand', 'tool-colorPicker', 'tool-zoom');

		// Add current tool class
		document.body.classList.add(`tool-${tool}`);

		// 1. Update Toolbar Buttons
		document.querySelectorAll('.toolbar-group button').forEach(btn => {
			btn.classList.remove('active');
		});

		// Fix: The tool name needs to match the button ID exactly
		const toolButtonIds = {
			'select': 'selectTool',
			'hand': 'handTool',
			'colorPicker': 'colorPickerTool',
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

		// NEW: Manage sticker pointer-events based on tool
		// When in Hand or Zoom tool, stickers should not capture touch events
		const allStickers = this.canvasElementsContainer.querySelectorAll('.sticker-element');
		if (tool === ToolType.HAND || tool === ToolType.ZOOM) {
			// Disable sticker interaction - viewport gestures only
			allStickers.forEach(sticker => {
				sticker.style.pointerEvents = 'none';
			});
		} else {
			// Enable sticker interaction
			allStickers.forEach(sticker => {
				sticker.style.pointerEvents = 'auto';
			});
		}

		// 3. Update Context Toolbars
		this.updateContextToolbars();


		// Update helpful message
		this.updateHelpfulMessage();

		this.updateStatus(`Active tool: ${tool}`);

	}


	updateContextToolbars() {
		const zoomControls = document.getElementById('zoomControls');
		const panControls = document.getElementById('panControls');
		const stickerCenterControls = document.getElementById('stickerCenterControls');
		const colorPickerControls = document.getElementById('colorPickerControls');

		// Hide all first
		if (zoomControls) zoomControls.classList.remove('visible');
		if (panControls) panControls.classList.remove('visible');
		if (stickerCenterControls) stickerCenterControls.classList.remove('visible');
		if (colorPickerControls) colorPickerControls.classList.remove('visible');

		const layer = this.layerManager.getActiveLayer();

		console.log(`0Updating context toolbars` + colorPickerControls);

		// Show appropriate toolbar based on current tool and layer state
		if (this.currentTool === ToolType.ZOOM && zoomControls) {
			zoomControls.classList.add('visible');
		} else if (this.currentTool === ToolType.HAND && panControls) {
			panControls.classList.add('visible');
		} else if (this.currentTool === ToolType.SELECT && stickerCenterControls) {
			if (layer && layer.type === LayerType.STICKER) {
				stickerCenterControls.classList.add('visible');
			}
		} else if (this.currentTool === ToolType.COLOR_PICKER && colorPickerControls) {
			if (layer && layer.type === LayerType.GLITTER_FILL && layer.selections && layer.selections.length > 0) {
				this.updateColorPickerControls();
				colorPickerControls.classList.add('visible');
			}
		}
	}

	// ===== HELPFUL MESSAGES =====


updateHelpfulMessage() {
	const message = document.getElementById('helpfulMessage');
	const text = document.getElementById('helpfulMessageText');
	const description = document.getElementById('helpfulMessageDescription');
	const activeLayer = this.layerManager.getActiveLayer();
	const currentTool = this.currentTool;
	const isMobile = this.mobileManager && this.mobileManager.isMobile;
	
	// Check if hints are enabled
	if (!this.showHints) {
		message.classList.remove('visible');
		return;
	}
	
	// Don't show hints before image is loaded
	if (!this.originalImage) {
		message.classList.remove('visible');
		return;
	}
	
	let hint = '';
	let context = '';
	
	// PRIORITY 1: Critical layer states that need attention (always show these first)
	
	// Empty sticker layer
	if (activeLayer && activeLayer.type === LayerType.STICKER && !activeLayer.stickerSourceId) {
		hint = 'No sticker chosen—select a sticker from the gallery to place on your canvas';
	}
	// Glitter layer with selection but no glitter chosen
	else if (activeLayer && activeLayer.type === LayerType.GLITTER_FILL && 
		activeLayer.selections && activeLayer.selections.length > 0 && 
		!activeLayer.selectedGlitterId) {
		hint = 'No glitter selected—choose a glitter style from the gallery to apply it';
	}
	// Empty glitter layer (no selection)
	else if (activeLayer && activeLayer.type === LayerType.GLITTER_FILL && 
		(!activeLayer.selections || activeLayer.selections.length === 0) &&
		currentTool !== ToolType.COLOR_PICKER) {
		hint = 'Selection is empty—switch to color picker to add glitter to this layer';
	}
	
	// PRIORITY 2: Tool-specific actions (what you can do RIGHT NOW)
	
	else if (currentTool === ToolType.ZOOM) {
		if (isMobile) {
			hint = 'Pinch to zoom in and out';
		} else {
			hint = 'Click to zoom in • Shift+click to zoom out';
		}
	}
	
	else if (currentTool === ToolType.HAND) {
		if (isMobile) {
			hint = 'Use one or two fingers to pan around the canvas';
		} else {
			hint = 'Click and drag to move around the canvas';
		}
	}
	
	else if (currentTool === ToolType.COLOR_PICKER) {
		if (!activeLayer || activeLayer.type === LayerType.BASE_IMAGE) {
			hint = 'Click anywhere on your image to create a glitter fill layer';
			context = 'Glitter fills are based on color selection from your base image.';
		} else if (activeLayer.type === LayerType.GLITTER_FILL) {
			if (!activeLayer.selections || activeLayer.selections.length === 0) {
				if (!activeLayer.selectedGlitterId) {
					hint = 'Choose a glitter style from the gallery, then click colors to fill';
				} else {
					hint = 'Click colors on your image to select areas for glitter';
					context = 'Threshold determines how similar colors need to be to get selected together.';
				}
			} else if (document.getElementById('multiSelect')?.checked && activeLayer.selections.length === 1) {
				hint = 'Multi-select is on—click more colors to expand your selection';
			} else {
				// Has selections, show enhancement tip
				hint = 'Click more colors to add to selection, or adjust settings to refine';
				context = 'Threshold controls color tolerance. Feather softens edges.';
			}
		} else if (activeLayer.type === LayerType.STICKER) {
			hint = 'Switch to select tool to move stickers, or add a glitter layer';
		}
	}
	
	else if (currentTool === ToolType.SELECT) {
		if (!activeLayer) {
			hint = 'Add a sticker layer to move items around, or use color picker for glitter';
		} else if (activeLayer.type === LayerType.STICKER && activeLayer.stickerSourceId) {
			// Sticker is placed - show manipulation tips
			if (isMobile) {
				hint = 'Drag to move, pinch to scale and rotate';
				context = 'Or tap settings button to adjust position, flip, and opacity.';
			} else {
				hint = 'Drag to move your sticker';
				context = 'Use the settings panel to rotate, scale, flip, or adjust opacity.';
			}
		} else if (activeLayer.type === LayerType.GLITTER_FILL || activeLayer.type === LayerType.BASE_IMAGE) {
			hint = 'Switch to color picker to add or modify glitter, or add a sticker layer';
		}
	}
	
	// PRIORITY 3: Enhancement tips for complete layers (only if no tool action shown)
	
	// Glitter layer complete with selections and glitter
	else if (activeLayer && activeLayer.type === LayerType.GLITTER_FILL && 
		activeLayer.selections && activeLayer.selections.length > 0 && 
		activeLayer.selectedGlitterId) {
		if (isMobile) {
			hint = 'Tap settings to adjust scale, opacity, or refine your selection';
			context = 'Threshold controls color tolerance—higher values select more similar colors.';
		} else {
			hint = 'Use the settings panel to adjust scale, opacity, threshold, or feather';
			context = 'Threshold controls color tolerance. Feather softens edges.';
		}
	}
	
	// Update visibility and text
	if (hint && !this.currentHintDismissed) {
		text.textContent = hint;
		description.textContent = context;
		message.classList.add('visible');
	} else {
		message.classList.remove('visible');
	}
}


setupHelpfulMessageListeners() {
	// Close button - just dismiss current hint
	const closeBtn = document.getElementById('helpfulMessageClose');
	if (closeBtn) {
		closeBtn.addEventListener('click', () => {
			this.currentHintDismissed = true;
			document.getElementById('helpfulMessage')?.classList.remove('visible');
		});
	}
	
	// Disable button - turn off hints entirely
	const disableBtn = document.getElementById('helpfulMessageDisable');
	if (disableBtn) {
		disableBtn.addEventListener('click', () => {
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
			document.getElementById('helpfulMessage')?.classList.remove('visible');
		});
	}
}




	updateColorPickerControls() {
		console.log(`Updating color picker controls`);
		const layer = this.layerManager.getActiveLayer();
		if (!layer || layer.type !== LayerType.GLITTER_FILL) return;

		console.log(`Updating color picker controls for layer ${layer.id}`);

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
		if (e.key === 'Alt') {
			if (this.currentTool === ToolType.ZOOM) {
				this.previewContainer.classList.remove('zoom-out-mode');
			}
		}
	}

	handleKeyboard(e) {
		// Don't trigger shortcuts when typing in input fields
		const activeElement = document.activeElement;
		const isTyping = activeElement && (
			activeElement.tagName === 'INPUT' ||
			activeElement.tagName === 'TEXTAREA' ||
			activeElement.isContentEditable
		);

		// Allow Escape to work in inputs (to blur/close things)
		// Allow Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z for undo/redo
		if (isTyping && e.key !== 'Escape' &&
			!((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z'))) {
			return;
		}

		if (e.key === 'Alt' && this.currentTool === ToolType.ZOOM) {
			this.previewContainer.classList.add('zoom-out-mode');
		}

		if (e.key === 'Escape') {
			// Let ModalManager handle modal closing
			if (this.modalManager.closeTopModal()) {
				return; // A modal was closed, we're done
			}

			// No modal was open, switch to select tool
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

		// Delete or Backspace: Delete selected layer
		if (e.key === 'Delete' || e.key === 'Backspace') {
			const selectedLayer = this.layerManager.getActiveLayer();

			// Only delete if a layer is selected and it's not the base image
			if (selectedLayer && selectedLayer.type !== LayerType.BASE_IMAGE) {
				e.preventDefault(); // Prevent browser back navigation on Backspace

				if (confirm('Delete this layer?')) {
					this.layerManager.deleteLayer(selectedLayer.id);
				}
			}
			return;
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
					selectedGlitterId: layer.selectedGlitterId, // CHANGED
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
					selectedGlitterId: layerData.selectedGlitterId, // CHANGED
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

		this.previewWrapper.classList.remove('hasImage');

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
		this.canvasElementsContainer.innerHTML = '';

		// UX: Reset to empty state properly
		this.showLayerSettingsEmptyState();
		this.showGlitterSettingsEmptyState();
		this.collapseLayerSettings();
		this.collapseGlitterSettings();

		// reset selected colors
		document.getElementById('selectedColorsEmpty').classList.add('visible');
		document.getElementById('selectedColorsDisplay').innerHTML = '';

		this.glitterManager.clearFilters();

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
			this.previewWrapper.classList.add('hasImage');

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
			this.canvasElementsContainer.innerHTML = '';

			// 1. Create Base Image Layer
			if (CONFIG.createBaseImageLayerOnLoad) {
				const layer = this.layerManager.createBaseImageLayer(LayerType.BASE_IMAGE);
				this.layers.push(layer);
				// Set it active immediately
				// this.layerManager.setActiveLayer(layer.id);
			}

			// 2. Create Default Glitter Layer (Optional)
			if (CONFIG.createDefaultLayerOnLoad) {
				const layer = this.createLayer();
				this.layers.push(layer);
				// If created, this becomes the new active layer
				this.layerManager.setActiveLayer(layer.id);
			} else {
				// 3. If NO default layer is created, check if we have a Base Layer
				if (this.layers.length > 0) {
					// Ensure the existing Base Layer stays selected and UI updates
					// this.layerManager.setActiveLayer(this.layers[0].id);
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
						selectedGlitterId: layer.selectedGlitterId,
						settings: { ...layer.settings }
					};
				}),
				activeLayerId: this.activeLayerId
			}];
			this.historyIndex = 0;

			// 5. reset saved
			this.isSaved = false;

			this.updateSidePanelUI();
			this.layerManager.renderLayersList();
			this.updateHistoryButtons();
			this.updateActionButtons();
			this.updateStatusBar();
			this.updateHelpfulMessage();

			// 6. Update Preview
			this.previewCtx.putImageData(this.originalImageData, 0, 0);

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


	// ===== CLICK HANDLERS =====
	handlePreviewContainerClick(e) {
		// Allow right-click for zoom tool, block other non-left clicks
		if (e.pointerType === 'mouse' && e.button !== 0) {
			// Allow right-click (button 2) only for zoom tool
			if (!(e.button === 2 && this.currentTool === ToolType.ZOOM)) {
				return;
			}
		}

		if (e.target.closest('[class*="-controls"]')) {
			return;
		}


		const hitSticker = e.target.closest('.sticker-element');

		// Check if click is within the canvas area using viewport coordinates
		const canvasCoords = this.viewport.screenToCanvas(e.clientX, e.clientY);
		const hitCanvas = this.viewport.isWithinCanvas(canvasCoords.x, canvasCoords.y);

		// We treat stickers and the canvas as the "Image Area"
		const hitImageArea = hitCanvas || hitSticker;

		// Gatekeeper: If they clicked a button/sidebar, stop here.
		const isWorkspace = e.target === this.previewContainer || e.target === this.previewWrapper || hitImageArea;
		if (!isWorkspace) return;

		switch (this.currentTool) {
			case ToolType.SELECT:
				if (hitSticker) return;
				if (hitImageArea && hitCanvas) {
					// Call handleCanvasClick to trigger layer picking
					this.handleCanvasClick(e);
				} else if (!hitImageArea) {
					this.layerManager.setActiveLayer(null);
				}
				break;

			case ToolType.COLOR_PICKER:
				if (hitImageArea) {
					// EXPLICITLY call the picking logic here
					this.handleCanvasClick(e);
				} else {
					this.setTool(ToolType.SELECT);
					// this.updateStatus('Click on the preview to select a color');
				}
				break;

			case ToolType.HAND:
				// Start panning
				this.viewport.startPan(e.clientX, e.clientY);
				break;

			case ToolType.ZOOM:
				if (this.originalImage) {
					this.handleCanvasZoomClick(e);
				}
				break;
		}
	}

	handleCanvasClick(event) {
		if (!this.originalImageData) return;

		// CRITICAL: Always use the canvas rect, regardless of what element was clicked
		const rect = this.previewCanvas.getBoundingClientRect();

		// Calculate click position relative to the canvas element on screen
		const clickX = event.clientX - rect.left;
		const clickY = event.clientY - rect.top;

		// Account for the difference between the element's CSS size and its actual pixel resolution
		const scaleX = this.previewCanvas.width / rect.width;
		const scaleY = this.previewCanvas.height / rect.height;

		const x = Math.floor(clickX * scaleX);
		const y = Math.floor(clickY * scaleY);

		// Bounds check
		if (x < 0 || x >= this.previewCanvas.width || y < 0 || y >= this.previewCanvas.height) {
			return;
		}

		// Select Tool: Pick layer at click location
		if (this.currentTool === ToolType.SELECT) {
			if (CONFIG.autoSelect === true && !this.justCompletedDrag) {
				this.layerManager.handleLayerPick(x, y);
			}
			return;
		}

		// Color Picker Tool
		if (this.currentTool === ToolType.COLOR_PICKER) {
			this.handleColorPickerClick(x, y, event);
			return;
		}
	}

	handleCanvasZoomClick(event) {
		// Disable click-to-zoom on mobile
		if (this.isMobile) return;

		if (this.currentTool !== ToolType.ZOOM || !this.originalImage) return;

		// Photoshop Alt-Click OR right-click to zoom out
		if (event.altKey || event.button === 2) {
			this.viewport.zoomOut(event.clientX, event.clientY);
		} else {
			this.viewport.zoomIn(event.clientX, event.clientY);
		}

		// Optional: Update status to show new zoom
		this.updateStatus(`Zoom: ${this.viewport.getZoomPercentage()}%`);
	}


	handleColorPickerClick(x, y, event) {
		let layer = this.layerManager.getActiveLayer();

		// If no layer selected, try to select a layer at this location
		if (!layer) {
			for (let i = this.layerManager.layers.length - 1; i >= 0; i--) {
				const testLayer = this.layerManager.layers[i];
				if (!testLayer.visible) continue;

				let isHit = false;

				if (testLayer.type === LayerType.GLITTER_FILL) {
					if (testLayer.selections && testLayer.selections.length > 0) {
						isHit = this.layerManager.isPixelInLayerSelection(testLayer, x, y);
					}
				} else if (testLayer.type === LayerType.BASE_IMAGE) {
					if (this.originalImage) {
						isHit = true;
					}
				}

				if (isHit) {
					this.layerManager.setActiveLayer(testLayer.id);
					layer = testLayer;
					break;
				}
			}

			if (!layer) {
				this.updateStatus('Please select the Base Image or a Glitter Layer.');
				return;
			}
		}

		// Handle based on selected layer type
		if (layer.type === LayerType.GLITTER_FILL) {
			// Always add to glitter layer
			this.glitterFillSelector(x, y, event);

		} else if (layer.type === LayerType.BASE_IMAGE) {
			// Check config for auto-creation
			if (CONFIG.autoCreateGlitterLayer) {
				const newLayer = this.glitterManager.createLayer();
				this.layerManager.insertLayer(newLayer);
				this.glitterFillSelector(x, y, event);
			} else {
				this.updateStatus('Please create a glitter layer first');
			}

		} else if (layer.type === LayerType.STICKER) {
			// Check if click is actually on the sticker
			const hitSticker = this.layerManager.isPointInSticker(layer, x, y);

			if (hitSticker) {
				// Clicking on sticker itself - disabled
				this.updateStatus('Color Picker disabled on Sticker layers.');
				return;
			}

			// Clicking outside sticker - find/create glitter layer at this location
			let glitterLayer = null;

			for (let i = this.layerManager.layers.length - 1; i >= 0; i--) {
				const testLayer = this.layerManager.layers[i];
				if (!testLayer.visible || testLayer.type !== LayerType.GLITTER_FILL) continue;

				if (testLayer.selections && testLayer.selections.length > 0) {
					const isHit = this.layerManager.isPixelInLayerSelection(testLayer, x, y);
					if (isHit) {
						glitterLayer = testLayer;
						break;
					}
				}
			}

			if (glitterLayer) {
				this.layerManager.setActiveLayer(glitterLayer.id);
			} else {
				const newLayer = this.glitterManager.createLayer();
				this.layerManager.insertLayer(newLayer);
			}

			this.glitterFillSelector(x, y, event);
		}
	}

	glitterFillSelector(x, y, event) {
		let layer = this.layerManager.getActiveLayer();

		if (!layer) {
			this.updateStatus('Please select the Base Image or a Glitter Layer.');
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
			this.updateStatus('Color Picker disabled on Sticker layers.');
			return;
		}

		const pixelIndex = y * this.originalCanvas.width + x;
		const alpha = this.originalAlphaChannel[pixelIndex];
		const isTransparent = alpha < CONFIG.alphaThreshold;

		// 1. Config Check: Block if transparent and selection isn't allowed
		if (isTransparent && !CONFIG.allowTransparentSelection) {
			this.updateStatus('Cannot select transparent pixels');
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



		// 6. Auto-Switch to Select Tool (if configured)
		if (CONFIG.autoSwitchAfterPick && this.currentTool === ToolType.COLOR_PICKER) {
			this.setTool(ToolType.SELECT);
		}

		// 5. UI & Preview Updates (Crucial: These must happen after pushing the data)
		this.layerManager.renderLayersList();
		this.saveState(); // For Undo/Redo
		this.updatePreview(); // To show the new glitter fill immediately
		this.updateActionButtons();
		this.updateSelectedColorsDisplay(); // To show "Transparent" or the RGB values in the sidebar

		// Update context toolbars (show color picker controls if we now have selections)
		this.updateContextToolbars();

		// Update helpful message
		this.updateHelpfulMessage();

	}

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
		this.canvasElementsContainer.innerHTML = '';

		// ADD: Clear sticker elements
		if (this.stickerManager) {
			this.stickerManager.layerElements.forEach((element, layerId) => {
				if (element.parentNode) {
					element.parentNode.removeChild(element);
				}
			});
			this.stickerManager.layerElements.clear();
		}
	}

	// ===== PREVIEW & RENDERING =====

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
		this.glitterManager.renderContent(layersToShow);

		this.stickerManager.renderContent(layersToShow);

		// Use the manager to update scales
		this.glitterManager.updatePreviewScale();
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
	// Filter visible layers
	const visibleLayers = this.layers.filter(l => {
		if (!l.visible) return false;
		if (l.type === LayerType.GLITTER_FILL) {
			return l.selections && l.selections.length > 0;
		} else if (l.type === LayerType.STICKER) {
			return !l.stickerData.isEmpty;
		} else if (l.type === LayerType.BASE_IMAGE) {
			return true;
		}
		return false;
	});

	if (visibleLayers.length === 0) {
		this.showError('No visible layers with content to export!');
		return;
	}

	const exportBtn = document.getElementById('exportGif');
	exportBtn.disabled = true;
	this.showExportProgress();

	// USE this.exportSettings directly - no DOM reading!
	console.log('Export settings:', this.exportSettings);

	const exportParams = {
		visibleLayers: visibleLayers,
		glitterGifs: this.glitterManager.content,
		canvasData: {
			width: this.originalCanvas.width,
			height: this.originalCanvas.height,
			originalData: new Uint8ClampedArray(this.originalImageData.data),
			originalAlpha: this.originalAlphaChannel,
			alphaThreshold: CONFIG.alphaThreshold
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
			parseGif: (url) => this.glitterManager.parseGifFromUrl(url),
			createMask: (layer) => {
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




// everything inside IIFE
(async () => {
	const editor = new GlitterEditor();
	await editor.init();

	// Initialize tooltip manager
	const tooltips = new TooltipManager();

	// Load debug configuration if enabled
	if (DEBUG_CONFIG.enabled) {
		await editor.loadDebugConfig();
	}

	// Make editor globally accessible (optional, useful for debugging)
	window.editor = editor;
})();
