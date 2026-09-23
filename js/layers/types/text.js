'use strict';

registerLayerType(LayerType.TEXT_GLITTER, {
	displayName: 'Text',
	paintSlots: [
		{
			key: 'backgroundFill', role: 'background', path: 'textData.textBackground.fill', enabledPath: 'textData.textBackground.enabled',
			sourceLabel: 'backgroundFill', glitterDefault: 'backgroundGlitterId',
			documentPixels: { hostPath: 'textData.textBackground', fields: ['horizontalPadding', 'verticalPadding', 'cornerRadius', 'mergeDistance'] }
		},
		{
			key: 'shadow', role: 'shadow', path: 'textData.shadow', draftPath: 'textData.effectDrafts.shadow',
			glitterDefault: 'shadowGlitterId', documentPixels: { signedFields: ['offsetX', 'offsetY'] }
		},
		{
			key: 'border', role: 'border', path: 'textData.border', draftPath: 'textData.effectDrafts.border',
			glitterDefault: 'borderGlitterId', documentPixels: { fields: ['widthPx'], minimum: 1 }
		},
		{ key: 'fill', role: 'fill', path: 'textData.fill', glitterDefault: 'fillGlitterId' }
	],
	hasVisibleContent: (layer) => Boolean(layer.textData?.text?.trim()),
	animatable: true,
	serialization: {
		dataKey: 'textData',
		omit: ['settings'],
		defaultName: (editor, data) => editor.textGlitterManager?.getLayerName(data?.text || ''),
		normalize: (editor, layer) => editor.textGlitterManager?.normalizeLayer(layer),
		hydrate: async (editor, layer) => {
			if (layer.textData?.fontId) await editor.textGlitterManager?.ensureFontLoaded(layer.textData.fontId);
		}
	},
	addedStatusMessage: 'New text layer added',
	goTo: 'glitter',
	addableViaModal: {
		label: 'Text',
		icon: 'text',
		description: 'Add editable text with glitter, color, or a gradient',
		quickAddId: 'quickActionAddText',
		quickAddOrder: 1
	},
	// No layerSettingsSection / 'tool': Selection Settings only applies to
	// color-picked glitter fills — text layers hide it instead of showing an
	// explanatory empty state.
	designPanelSections: ['glitterSearchSection', 'glitterOptions', 'textSettingsSection'],
	mobileSettingsSections: ['text'],
	panelMode: 'text',
	elementClass: 'text-glitter-element',
	transformable: true,
	managerKey: 'textGlitterManager',
	blendable: true,
	hitTestMethod: 'isPointInText',
	transformPrefix: 'text',
	transformCapabilities: {
		panelRedesign: true,
		position: true,
		size: true,
		scaleReadout: true,
		lockAspect: true,
		rotation: true,
		opacity: true,
		flip: true,
		align: true,
		reset: true
	},
	createOptionsKey: 'textLayer',
	autoOpenDesignDrawerOnCreate: true,
	// Reopening the side panel after every tap-created layer is desktop
	// convenience, not a mobile ask - Editor.finishLayerCreation() reads this.
	mobileCreateBehavior: { skipReload: true },
	onActivate: (editor, layer) => {
		const validTools = new Set([ToolType.SELECT, ToolType.HAND, ToolType.ZOOM, ToolType.BRUSH]);
		if (!validTools.has(editor.currentTool)) {
			editor.setTool(ToolType.SELECT);
		}

		editor.updateGlitterSelection();
		editor.textGlitterManager?.loadLayerSettings(layer);
	}
});
