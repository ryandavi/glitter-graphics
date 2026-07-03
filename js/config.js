const CONFIG = {
	// ========================================
	// APPLICATION
	// ========================================
	siteName: 'ryandavi.com glitter editor',
	maxLayers: 25,
	historyLimit: 30,
	defaultTool: "select",
	createDefaultLayerOnLoad: false,
	createBaseImageLayerOnLoad: true,

	// ========================================
	// CANVAS & IMAGE
	// ========================================
	maxImageWidth: 800,
	maxImageHeight: 800,
	maxFileSizeMB: 10,
	defaultCanvasPreset: { width: 400, height: 400, color: '#ffffff' },
	baseGridSize: 20,

	// Artboard
	showArtboardBorder: false,
	artboardBorderColor: '#00ffff',
	artboardBorderWidth: 2,
	artboardBorderStyle: 'dashed',

	// ========================================
	// LAYERS
	// ========================================
	exportFrameRateSource: 'first-layer',
	layerSettingsOpenByDefault: false,

	// Layer List Drag
	scrollZoneSize: 50,
	scrollSpeed: 10,

	// ========================================
	// TOOLS - Selection
	// ========================================
	defaultThreshold: 50,
	defaultFeather: 0,
	defaultScale: 100,
	defaultOpacity: 100,
	alphaThreshold: 254,
	sliderDebounceMs: 150,
	allowTransparentSelection: true,

	// ========================================
	// TOOLS - Glitter
	// ========================================
	defaultGlitterId: 111,
	glitterSettingsOpenByDefault: false,
	refineGlobalDefault: false,
	glitterGlobalDefault: false,

	// Preview - Selected Outline
	selectedGlitterOffset: 2,
	selectedGlitterWidth: 2,

	// ========================================
	// TOOLS - Stickers
	// ========================================
	maxStickers: 50,
	maxStickerUploadSize: 10 * 1024 * 1024,
	allowedStickerTypes: ['image/png', 'image/jpeg', 'image/gif'],
	defaultStickerOpacity: 100,
	defaultStickerScale: 100,
	defaultStickerRotation: 0,
	rotationSnapTolerance: 5,
	roundStickerTransforms: true,

	// ========================================
	// UI - Zoom
	// ========================================
	zoomLevels: [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16],

	// ========================================
	// UI - Gallery
	// ========================================
	defaultGalleryTab: 'glitter',

	// ========================================
	// MOBILE
	// ========================================
	mobileBreakpoint: 800,
	mobileStickerHitAreaPadding: 20,
	mobileAutoCloseDesignDrawer: true,
	mobileOpenDrawOnLayerAdd: true,

	// ========================================
	// EXPORT
	// ========================================
	defaultExportBaseImage: true,
	defaultExportGlitter: true,
	defaultExportStickers: true,
	defaultExportTransparency: true,
	defaultExportMatteColor: '#ffffff',

	// Quality & Rendering
	defaultExportQuality: 10,
	defaultExportDitherEnabled: true,
	defaultExportDitherType: 'FloydSteinberg',

	// Frame Control
	defaultExportFrameDelay: 110,
	defaultExportMaxFrames: 60,
	maxFramesHardLimit: 1000,
	defaultExportFrameSkip: 1,
	defaultExportReverse: false,
	defaultExportSmartFrameReduction: true,

	// Watermark
	defaultExportWatermarkEnabled: false,
	watermarkUrl: 'images/watermark/2.png',
	watermarkPosition: 'bottom-right',
	watermarkPaddingX: 5,
	watermarkPaddingY: 5,
	watermarkOpacity: 100,
	watermarkScale: 100,

	// UI
	defaultShowHints: true,

	// ========================================
	// DEBUG
	// ========================================
	forceIOSExportPreview: false,
	autoSelect: true,
	autoCreateGlitterLayer: true,
	debug: false,


	// ========================================
	// UI - Sticker Handles
	// ========================================
	stickerHandles: {
		enabled: true,
		cornerSize: 8,
		rotationHandleRadius: 5,
		rotationHandleDistance: 30,
		handleFill: '#ffffff',
		handleStroke: 'var(--color-bg-secondary)',
		handleStrokeWidth: 1.5,
		boundingBoxColor: 'var(--color-accent)',
		boundingBoxWidth: 1.5,
		handleHitboxPadding: 8,
		minScale: 10,
		maxScale: 500,
	},

	// ========================================
	// SHORTCUTS
	// ========================================
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

const LAYER_UI_CONFIG = {
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

			const stickerContent = document.getElementById('stickerSettingsContent');
			if (layer.stickerSourceId) {
				editor.hideStickerSettingsEmptyState();
				editor.loadStickerSettings(layer);
			} else {
				if (stickerContent) stickerContent.classList.remove('visible');
				editor.showStickerSettingsEmptyState();
			}

			editor.updateStickerSelection();
		}
	}
};

const ASSET_TYPE_CONFIG = {
	glitter: {
		prefix: 'glitterAsset',
		managerKey: 'glitterManager',
		renderThumbnail: (thumbnail, asset) => {
			thumbnail.className = 'asset-info-thumbnail glitter-bg';
			thumbnail.style.backgroundImage = `url(${asset.url})`;
			thumbnail.innerHTML = '';
		},
		getExtraBadges: (asset) => {
			return [];
		}
	},
	sticker: {
		prefix: 'stickerAsset',
		managerKey: 'stickerManager',
		renderThumbnail: (thumbnail, asset) => {
			thumbnail.className = 'asset-info-thumbnail';
			thumbnail.style.backgroundImage = '';
			thumbnail.innerHTML = `<img src="${asset.thumbnailUrl || asset.url}" alt="${asset.name}">`;
		},
		getExtraBadges: (asset) => {
			const badges = [];

			if (asset.stickerText) {
				badges.push({
					class: 'badge-text',
					text: `Text: "${asset.stickerText}"`
				});
			}

			return badges;
		}
	}
};

const DEBUG_CONFIG = {
	enabled: false,

	canvas: {
		width: 800,
		height: 800,
		color: '#ffffff'
	},

	stickers: [
		{ id: 1, x: 200, y: 200 },
		{ id: 2, x: 400, y: 400 },
		{ id: 3, x: 600, y: 600 }
	]
};
