'use strict';

registerLayerType(LayerType.BASE_IMAGE, {
	displayName: 'Base Image',
	// The canvas background is one whole-layer paint. Image and gradient modes
	// run through the base pixel pipeline instead of the slot paint path; its
	// color adjust is a canvas setting, not a layer effect.
	paintSlots: [
		{ key: 'background', role: 'fill', path: 'background', wholeLayer: true, sourceLabel: 'background', glitterDefault: 'fillGlitterId', countsAsEffect: false }
	],
	hasVisibleContent: () => true,
	serialization: {
		dataKey: 'background',
		omit: ['name', 'settings'],
		forceLocked: true,
		defaults: { image: null },
		normalize: (editor, layer) => editor.baseBackgroundManager?.normalizeLayer(layer)
	},
	goTo: null,
	designPanelSections: ['glitterSearchSection', 'glitterOptions', 'baseLayerSettingsSection'],
	mobileSettingsSections: ['background'],
	panelMode: 'base-layer',
	onActivate: (editor, layer) => {
		editor.baseBackgroundManager?.loadLayerSettings(layer);
	}
});
