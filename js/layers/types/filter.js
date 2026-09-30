'use strict';

registerLayerType(LayerType.FILTER, {
	displayName: 'Filter',
	hasVisibleContent: (layer) => GlitterFilter.isActive(layer.filterData, layer.opacity),
	serialization: {
		dataKey: 'filterData',
		omit: ['settings'],
		defaultName: () => 'Filter',
		normalize: (editor, layer) => editor.filterLayerManager?.normalizeLayer(layer)
	},
	addedStatusMessage: 'New filter layer added',
	goTo: null,
	addableViaModal: {
		label: 'Filter',
		icon: 'sliders',
		group: 'effects',
		order: 1,
		description: 'Adjust the appearance of every layer below'
	},
	showDesignGallery: false,
	designPanelSections: ['filterSettingsSection'],
	mobileSettingsSections: ['filter'],
	panelMode: 'filter',
	elementClass: 'filter-layer-overlay',
	transformable: false,
	// A pixel size of 1 means off; only a real mosaic rescales. Pixelate keeps
	// it in `size`, which Grain and Light Leak also use for other units.
	fields: [
		{ path: 'filterData.size', field: 'pixelEffectsPixelSize', documentScale: 'effect', when: (value, layer) => layer.filterData?.type === 'pixelate' && value > 1 },
		{ path: 'filterData.pixelSize', field: 'pixelEffectsPixelSize', documentScale: 'effect', when: (value) => value > 1 }
	],
	managerKey: 'filterLayerManager',
	timelineSources: (layer, context) => context.compositor._createFilterTimelineSources(layer),
	blendable: true,
	renderSwatch: (layer, context) => {
		const thumbnail = document.createElement('span');
		GlitterFilter.renderCssThumbnail(thumbnail, layer.filterData, layer.opacity / 100);
		context.swatch.classList.add('filter');
		context.swatch.append(thumbnail);
		return true;
	},
	mobileCreateDrawer: 'edit',
	onActivate: (editor, layer) => {
		editor.setTool(ToolType.SELECT);
		editor.filterLayerManager?.loadLayerSettings(layer);
	}
});
