'use strict';

registerLayerType(LayerType.GLITTER_FILL, {
	displayName: 'Fill Layer',
	paintSlots: [
		{ key: 'fill', role: 'fill', path: 'fill', wholeLayer: true, sourceLabel: null, glitterDefault: 'fillGlitterId' }
	],
	hasVisibleContent: (layer) => hasMaskContent(layer),
	animatable: true,
	serialization: {
		extraKeys: ['selections', 'fill', 'autoGlitter'],
		includeMaskVersion: true,
		defaults: { maskHasContent: false },
		normalize: (editor, layer) => editor.glitterManager?.normalizeLayer(layer)
	},
	addedStatusMessage: 'New fill layer added',
	goTo: 'glitter',
	addableViaModal: {
		label: 'Fill Layer',
		icon: 'glitter',
		description: 'Paint glitter, color, or a gradient onto the canvas',
		quickAddId: 'quickActionAddGlitter',
		quickAddOrder: 4
	},
	designPanelSections: ['brushTipSearchSection', 'brushTipOptions', 'glitterSearchSection', 'glitterOptions', 'glitterSettingsSection'],
	mobileSettingsSections: ['glitter'],
	panelMode: 'glitter',
	elementClass: 'glitter-element',
	managerKey: 'glitterManager',
	blendable: true,
	autoOpenDesignDrawerOnCreate: true,
	onActivate: (editor, layer) => {
		if (!layer.locked && !hasMaskContent(layer) && layer.fill?.glitterId && editor.currentTool !== ToolType.BRUSH) {
			editor.setTool(ToolType.COLOR_PICKER);
		}
		editor.updateGlitterSelection();
		editor.setSettingsEmptyState('layerSettings', false);
		editor.setSettingsEmptyState('glitterSettings', false);
		editor.loadActiveLayerSettings();
	}
});
