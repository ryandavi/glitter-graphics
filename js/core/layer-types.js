// Layer types: the LayerType ids, the LAYER_UI_CONFIG registry that
// js/layers/types/<type>.js files fill through registerLayerType, and the
// predicates and lookups derived from it. Loads after config.js.
const LayerType = {
	GLITTER_FILL: 'glitter-fill',
	STICKER: 'sticker',
	TEXT_GLITTER: 'text-glitter',
	SHAPE: 'shape',
	BASE_IMAGE: 'base-image',
	FILTER: 'filter'
};

// Maps a layer type to its key in CONFIG.tools.glitter.defaults.fillGlitterId
// / borderGlitterId / shadowGlitterId (each keyed per layer type — see
// glitter.defaults). Used wherever a missing/invalid glitterId needs
// substituting without already knowing which manager is involved
// (ProjectSerializer's missing-asset preflight).
const LAYER_TYPE_GLITTER_CONTEXT = {
	[LayerType.GLITTER_FILL]: 'glitterLayer',
	[LayerType.TEXT_GLITTER]: 'text',
	[LayerType.SHAPE]: 'shape',
	[LayerType.BASE_IMAGE]: 'canvasBackground',
	[LayerType.STICKER]: 'sticker'
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

// Each layer type answers this itself (registerLayerType hasVisibleContent).
function layerHasVisibleContent(layer) {
	return Boolean(LAYER_UI_CONFIG[layer?.type]?.hasVisibleContent?.(layer));
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
		designPanelSections: [],
		mobileSettingsSections: [],
		panelMode: 'welcome'
	},
	NO_LAYER: {
		designPanelSections: ['noLayerSettingsSection'],
		mobileSettingsSections: [],
		panelMode: 'no-layer'
	},
	AUTO_GLITTER: {
		designPanelSections: ['glitterSearchSection', 'glitterOptions', 'autoGlitterSettingsSection'],
		mobileSettingsSections: ['autoGlitter'],
		panelMode: 'auto-glitter'
	}
};

// Layer types register themselves from js/layers/types/<type>.js, which load
// right after this file. A definition carries the type's panel wiring, its
// serialization spec, capability flags (transformable, blendable,
// animatable), hasVisibleContent(layer), its paint slots (see
// js/paint/paint-slots.js), declared back to front, and `fields`: bindings of
// its other editable properties onto layer data (see js/core/fields.js).
function registerLayerType(type, definition) {
	if (!Object.values(LayerType).includes(type)) throw new Error(`Unknown layer type ${type}`);
	if (LAYER_UI_CONFIG[type]) throw new Error(`Layer type ${type} is already registered`);
	LAYER_UI_CONFIG[type] = {
		...definition,
		paintSlots: Object.freeze((definition.paintSlots || []).map((slot) => normalizePaintSlotDefinition(slot, type))),
		fields: Object.freeze((definition.fields || []).map((binding) => normalizeFieldBinding(binding, type)))
	};
}

// Derived, single-source-of-truth lookups over LAYER_UI_CONFIG. Adding a new
// LayerType that needs a DOM overlay element, transform handles, or a creation
// factory means filling in the relevant fields above ONCE - these replace what
// would otherwise be hand-maintained, easy-to-forget-one-type selector/dispatch
// lists duplicated across LayerManager/LayerTransform/GestureManager/app.js.
function isTransformableLayerType(type) {
	return Boolean(LAYER_UI_CONFIG[type]?.transformable);
}

function isAnimatableLayerType(type) {
	return Boolean(LAYER_UI_CONFIG[type]?.animatable);
}

// CSS selector matching layer overlay elements. Pass a layerId to scope to one
// layer's element (any type); omit it to match every layer element of the
// matching kind (e.g. rebuilding DOM order). transformableOnly excludes types
// that don't participate in the pointer-transform system (e.g. glitter fill).
function getLayerElementSelector(layerId = null, { transformableOnly = false } = {}) {
	return Object.values(LayerType)
		.map((type) => LAYER_UI_CONFIG[type])
		.filter((cfg) => cfg?.elementClass && (!transformableOnly || cfg.transformable))
		.map((cfg) => `.${cfg.elementClass}${layerId != null ? `[data-layer-id="${layerId}"]` : ''}`)
		.join(', ');
}

function getLayerManagerForType(editor, type) {
	const key = LAYER_UI_CONFIG[type]?.managerKey;
	return key ? editor[key] : null;
}

function getAddableLayerTypes() {
	return Object.values(LayerType).filter((type) => Boolean(LAYER_UI_CONFIG[type]?.addableViaModal));
}

function getQuickAddLayerTypes() {
	return getAddableLayerTypes()
		.filter((type) => Boolean(LAYER_UI_CONFIG[type].addableViaModal.quickAddId))
		.sort((a, b) => LAYER_UI_CONFIG[a].addableViaModal.quickAddOrder - LAYER_UI_CONFIG[b].addableViaModal.quickAddOrder);
}

const LAYER_BADGES = [
	{
		id: 'paint',
		icon: 'brush',
		getState(layer) {
			return layer?.type === LayerType.GLITTER_FILL && layer.maskHasContent
				? { title: 'Painted mask strokes' }
				: null;
		}
	},
	{
		id: 'missing-asset',
		icon: 'circle-info',
		getState(layer) {
			const missing = layer?._missingAssets;
			return missing?.length ? { title: `Missing asset: ${missing.join(', ')}` } : null;
		}
	},
	{
		id: 'effects',
		icon: 'filter',
		getState(layer) {
			const active = [];
			if (layerHasBorderEffect(layer)) active.push('border');
			if (layerHasShadowEffect(layer)) active.push('shadow');
			if (layerHasActiveColorAdjust(layer)) active.push('color adjust');
			return active.length ? { title: `Effects: ${active.join(', ')}` } : null;
		}
	}
];

// The common "every layer element" and "every transformable layer element"
// selectors, computed on first use because the layer types register after
// this file loads.
let allLayerElementSelector = null;
let transformableLayerElementSelector = null;

function getAllLayerElementSelector() {
	allLayerElementSelector ||= getLayerElementSelector();
	return allLayerElementSelector;
}

function getTransformableLayerElementSelector() {
	transformableLayerElementSelector ||= getLayerElementSelector(null, { transformableOnly: true });
	return transformableLayerElementSelector;
}
