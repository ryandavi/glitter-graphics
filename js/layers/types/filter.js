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
		description: 'Adjust the appearance of every layer below'
	},
	showDesignGallery: false,
	designPanelSections: ['filterSettingsSection'],
	mobileSettingsSections: ['filter'],
	panelMode: 'filter',
	elementClass: 'filter-layer-overlay',
	transformable: false,
	managerKey: 'filterLayerManager',
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
