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
	maxImageWidth: 1024,
	maxImageHeight: 1024,
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
	designPanelAccordion: true,

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
	maskBrush: {
		defaultSize: 40,
		minSize: 1,
		maxSize: 300,
		defaultSoftness: 0,
		defaultFlow: 100,
		// Brush tip shape. One of the ids in MaskEditor.BRUSH_SHAPES
		// (round, square, calligraphy, star, heart). Only affects painting; the
		// stamped result is baked into the mask, so export needs no shape info.
		defaultShape: 'round',
		stampSpacing: 0.25,
		// Stroke smoothing/stabilization, 0 = off (default). Surfaced as a 0–100%
		// slider; MaskEditor maps it to an EMA follow factor.
		defaultSmoothing: 0,
		overlayColor: '#ff2d8a',
		overlayOpacity: 0.75,
		overlayStripeOpacityBoost: 0.15,
		cursorStroke: '#ffffff',
		livePreviewThrottle: 'raf'
	},

	// ========================================
	// TOOLS - Glitter
	// ========================================
	defaultGlitterId: 111,
	// Text effect slots default to glitter mode (not solid). Border and shadow
	// each carry their own default glitter id so they can be tuned independently
	// of the fill's default (e.g. a darker glitter for shadows later).
	defaultBorderGlitterId: 111,
	defaultShadowGlitterId: 111,
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
	// TOOLS - Text Layers
	// ========================================
	textLayers: {
		fontsManifest: 'data/fonts.json',
		defaultFontId: 'luckiest-guy',
		defaultText: 'glitter',
		defaultBoxMode: 'auto',
		defaultVerticalAlign: 'top',
		minBoxSize: 4,
		defaultFontSize: 64,
		minFontSize: 12,
		maxFontSize: 256,
		defaultLetterSpacing: 0,
		minLetterSpacing: -5,
		maxLetterSpacing: 40,
		lineHeight: 1.1,
		maskPadding: 8,
		maxTextLength: 200,
		crispEdges: true
	},

	// ========================================
	// UI - Zoom
	// ========================================
	zoomLevels: [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16],

	gestures: {
		tapMaxMs: 300,
		tapSlopPx: 10,
		secondFingerGraceMs: 150,
		doubleTapMs: 300,
		doubleTapSlopPx: 30,
		inertia: {
			enabled: true,
			decay: 0.92
		}
	},

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
			{ key: 'T', action: 'Text Tool' },
			{ key: 'I', action: 'Color Fill Tool' },
			{ key: 'B', action: 'Mask Brush Tool' },
			{ key: 'H', action: 'Hand Tool' },
			{ key: 'Z', action: 'Zoom Tool' },
		],
		brush: [
			{ key: 'X', action: 'Swap Paint/Erase (Mask Brush)' },
			{ key: '[ / ]', action: 'Decrease/Increase Brush Size' },
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
	TEXT_GLITTER: 'text-glitter',
	BASE_IMAGE: 'base-image',
};

const ToolType = {
	SELECT: 'select',
	TEXT: 'text',
	HAND: 'hand',
	COLOR_PICKER: 'colorPicker',
	BRUSH: 'brush',
	ZOOM: 'zoom'
};

function hasMaskContent(layer) {
	return Boolean(
		layer &&
		layer.type === LayerType.GLITTER_FILL &&
		(
			(Array.isArray(layer.selections) && layer.selections.length > 0) ||
			layer.maskHasContent
		)
	);
}

function layerHasVisibleContent(layer) {
	switch (layer?.type) {
		case LayerType.STICKER:
			return !layer.stickerData || !layer.stickerData.isEmpty;
		case LayerType.TEXT_GLITTER:
			return Boolean(layer.textData?.text?.trim());
		case LayerType.GLITTER_FILL:
			return hasMaskContent(layer);
		case LayerType.BASE_IMAGE:
			return true;
		default:
			return false;
	}
}

// Sidebar panel naming convention (keep new panels consistent with this):
//   "<Thing> Properties" — attributes of the SELECTED LAYER/object
//                          (Glitter Properties, Sticker Properties, Text Properties).
//   "<Tool> Settings"     — configuration of a TOOL/action, not a specific layer
//                          (Brush Settings, Color Fill Settings).
// The visible titles live in index.html (.section-header-title-text); the guide
// (modals/guide.html) must mirror them. Section *ids* are historically all
// `*SettingsSection` regardless of title — that's internal only, don't rename.
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
			if (!hasMaskContent(layer) && layer.selectedGlitterId && editor.currentTool !== ToolType.BRUSH) {
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
	},

	[LayerType.TEXT_GLITTER]: {
		// No layerSettingsSection / 'tool': Selection Settings only applies to
		// color-picked glitter fills — text layers hide it instead of showing an
		// explanatory empty state.
		designPanelSections: ['glitterSearchSection', 'glitterOptions', 'textSettingsSection'],
		mobileSettingsSections: ['glitter', 'text'],
		panelMode: 'text',
		onActivate: (editor, layer) => {
			const validTools = new Set([ToolType.SELECT, ToolType.HAND, ToolType.ZOOM, ToolType.BRUSH]);
			if (!validTools.has(editor.currentTool)) {
				editor.setTool(ToolType.SELECT);
			}

			editor.updateGlitterSelection();
			editor.textGlitterManager?.loadLayerSettings(layer);
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
