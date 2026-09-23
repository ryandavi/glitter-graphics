'use strict';

registerLayerType(LayerType.TEXT_GLITTER, {
	displayName: 'Text',
	paintSlots: [
		{
			key: 'backgroundFill', role: 'background', path: 'textData.textBackground.fill', enabledPath: 'textData.textBackground.enabled',
			sourceLabel: 'backgroundFill', glitterDefault: 'backgroundGlitterId',
			panelPrefix: 'textBackground', modes: ['glitter', 'solid']
		},
		{
			key: 'shadow', role: 'shadow', path: 'textData.shadow', draftPath: 'textData.effectDrafts.shadow',
			glitterDefault: 'shadowGlitterId', panelPrefix: 'textShadow', modes: ['glitter', 'solid']
		},
		{
			key: 'border', role: 'border', path: 'textData.border', draftPath: 'textData.effectDrafts.border',
			glitterDefault: 'borderGlitterId', panelPrefix: 'textBorder', modes: ['glitter', 'solid'],
			fields: { widthPx: 'textBorderWidth' }
		},
		{ key: 'fill', role: 'fill', path: 'textData.fill', glitterDefault: 'fillGlitterId', panelPrefix: 'textFill', modes: ['none', 'glitter', 'solid'] }
	],
	fields: [
		{ path: 'textData.fontSize', field: 'textFontSize', id: 'textFontSize', geometry: true, documentScale: 'geometry', minimum: 1 },
		{ path: 'textData.letterSpacing', field: 'textLetterSpacing', id: 'textLetterSpacing', geometry: true, documentScale: 'geometry' },
		{ path: 'textData.lineHeight', field: 'textLineHeight', id: 'textLineHeight', factor: 100, geometry: true },
		{ path: 'textData.boxWidth', documentScale: 'geometry', minimum: 1 },
		{ path: 'textData.boxHeight', documentScale: 'geometry', minimum: 1 },
		{ path: 'textData.textBackground.horizontalPadding', field: 'textBackgroundPaddingH', id: 'textBackgroundPaddingH', geometry: true, documentScale: 'effect' },
		{ path: 'textData.textBackground.verticalPadding', field: 'textBackgroundPaddingV', id: 'textBackgroundPaddingV', geometry: true, documentScale: 'effect' },
		{ path: 'textData.textBackground.cornerRadius', field: 'textBackgroundRadius', id: 'textBackgroundRadius', geometry: true, documentScale: 'effect' },
		{ path: 'textData.textBackground.mergeDistance', field: 'textBackgroundMergeDistance', id: 'textBackgroundMergeDistance', geometry: true, documentScale: 'effect' },
		{ path: 'textData.textBackground.lineSpacingSensitivity', field: 'textBackgroundSpacing', id: 'textBackgroundSpacing', geometry: true }
	],
	hasVisibleContent: (layer) => Boolean(layer.textData?.text?.trim()),
	animatable: true,
	serialization: {
		dataKey: 'textData',
		omit: ['settings'],
		defaultName: (editor, data) => editor.textGlitterManager?.getLayerName(data?.text || ''),
		normalize: (editor, layer) => editor.textGlitterManager?.normalizeLayer(layer),
		hydrate: async (editor, layer) => {
			if (layer.textData?.fontId) await FontLibrary.ensureLoaded(layer.textData.fontId);
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
	frame: (editor, layer) => editor.textGlitterManager?.getTextBodyFrame(layer) || null,
	visualBounds: (editor, layer) => editor.textGlitterManager?.getTextVisualFrame(layer) || null,
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
