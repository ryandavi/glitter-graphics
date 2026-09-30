'use strict';

registerLayerType(LayerType.GLITTER_FILL, {
	displayName: 'Fill Layer',
	paintSlots: [
		{ key: 'fill', role: 'fill', path: 'fill', wholeLayer: true, sourceLabel: null, glitterDefault: 'fillGlitterId' },
		{
			key: 'sparkles', role: 'sparkles', path: 'sparkles', draftPath: 'effectDrafts.sparkles',
			glitterDefault: 'sparklesGlitterId', panelPrefix: 'glitterSparkles', modes: ['glitter', 'solid']
		}
	],
	// Sparkles scatter inside the painted mask.
	sparkleHost: (editor, layer) => editor.glitterManager?.getSparkleHost(layer) || null,
	hasVisibleContent: (layer) => hasMaskContent(layer),
	animatable: true,
	animate: (...args) => animateCanvasLayerPreview(...args),
	animationBox: (_editor, _layer, canvas) => ({ x: 0, y: 0, width: canvas.width, height: canvas.height }),
	timelineSources: (layer, context) => [
		...context.compositor._createLayerAnimationTimelineSources(layer, context),
		...context.compositor._createSparkleTimelineSources(layer)
	],
	serialization: {
		extraKeys: ['selections', 'fill', 'autoGlitter', 'sparkles', 'effectDrafts'],
		includeMaskVersion: true,
		defaults: { maskHasContent: false },
		normalize: (editor, layer) => editor.glitterManager?.normalizeLayer(layer)
	},
	addedStatusMessage: 'New fill layer added',
	goTo: 'glitter',
	addableViaModal: {
		label: 'Fill Layer',
		icon: 'glitter',
		group: 'basics',
		order: 4,
		description: 'Paint glitter, color, or a gradient onto the canvas',
		quickAddId: 'quickActionAddGlitter',
		quickAddOrder: 5
	},
	library: 'glitter',
	designPanelSections: ['glitterSettingsSection'],
	mobileSettingsSections: ['glitter'],
	panelMode: 'glitter',
	elementClass: 'glitter-element',
	managerKey: 'glitterManager',
	blendable: true,
	autoOpenDesignDrawerOnCreate: true,
	onActivate: (editor, layer) => {
		if (!layer.locked && !hasMaskContent(layer) && layer.fill?.glitterId && editor.currentTool !== ToolType.BRUSH) {
			editor.setTool(ToolType.GLITTER_FILL);
		}
		editor.updateGlitterSelection();
		editor.setSettingsEmptyState('layerSettings', false);
		editor.setSettingsEmptyState('glitterSettings', false);
		editor.loadActiveLayerSettings();
	}
});
