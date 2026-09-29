'use strict';

// A canvas-sized layer whose only content is a sparkles slot: whole-picture
// weather that can sit in front of everything. The same slot, engine and
// panel card as the Sparkles effect on any other layer.
registerLayerType(LayerType.SPARKLES, {
	displayName: 'Sparkles',
	paintSlots: [
		{ key: 'sparkles', role: 'sparkles', path: 'sparkles', glitterDefault: 'sparklesGlitterId', panelPrefix: 'layerSparkles', modes: ['glitter', 'solid'] }
	],
	// The whole canvas, no pixels: Highlights of the whole scene wait for a
	// scene snapshot.
	sparkleHost: (editor, layer) => editor.sparkleLayerManager?.getSparkleHost(layer) || null,
	hasVisibleContent: (layer) => layerHasPaintSlotRole(layer, 'sparkles'),
	timelineSources: (layer, context) => context.compositor._createSparkleTimelineSources(layer),
	serialization: {
		extraKeys: ['sparkles'],
		omit: ['settings'],
		defaultName: () => 'Sparkles',
		normalize: (editor, layer) => editor.sparkleLayerManager?.normalizeLayer(layer)
	},
	addedStatusMessage: 'New sparkles layer added',
	goTo: null,
	addableViaModal: {
		label: 'Sparkles',
		icon: 'sparkles',
		description: 'Snow, hearts or sparkles over the whole picture'
	},
	showDesignGallery: true,
	designPanelSections: ['glitterSearchSection', 'glitterOptions', 'sparkleLayerSettingsSection'],
	mobileSettingsSections: ['sparkleLayer'],
	panelMode: 'sparkles',
	elementClass: 'sparkle-layer-element',
	transformable: false,
	managerKey: 'sparkleLayerManager',
	blendable: true,
	renderSwatch: (layer, context) => {
		const data = layer.sparkles;
		if (!data || !context.renderPaint(data)) context.swatch.classList.add('empty');
		context.swatch.classList.add('sparkle-layer-swatch');
		return true;
	},
	mobileCreateDrawer: 'edit',
	onActivate: (editor, layer) => {
		editor.setTool(ToolType.SELECT);
		editor.updateGlitterSelection();
		editor.sparkleLayerManager?.loadLayerSettings(layer);
	}
});
