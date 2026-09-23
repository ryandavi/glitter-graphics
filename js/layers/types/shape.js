'use strict';

registerLayerType(LayerType.SHAPE, {
	displayName: 'Shape',
	paintSlots: [
		{
			key: 'shadow', role: 'shadow', path: 'shapeData.shadow', draftPath: 'shapeData.effectDrafts.shadow',
			glitterDefault: 'shadowGlitterId', documentPixels: { signedFields: ['offsetX', 'offsetY'] }
		},
		{
			key: 'border', role: 'border', path: 'shapeData.border', draftPath: 'shapeData.effectDrafts.border',
			glitterDefault: 'borderGlitterId', documentPixels: { fields: ['widthPx', 'dotSpacingPx'], minimum: 1 }
		},
		{ key: 'fill', role: 'fill', path: 'shapeData.fill', glitterDefault: 'fillGlitterId' }
	],
	hasVisibleContent: (layer) => Boolean(layer.shapeData),
	animatable: true,
	serialization: {
		dataKey: 'shapeData',
		omit: ['settings'],
		defaultName: () => 'Shape',
		normalize: (editor, layer) => editor.shapeGlitterManager?.normalizeLayer(layer)
	},
	addedStatusMessage: 'New shape layer added',
	goTo: 'glitter',
	addableViaModal: {
		label: 'Shape',
		icon: 'square',
		description: 'Add a shape with an image, glitter, color, or a gradient',
		quickAddId: 'quickActionAddShape',
		quickAddOrder: 3
	},
	// Like text: the glitter gallery picks the shared swatch, plus a dedicated
	// Shape Properties panel. Selection Settings doesn't apply.
	designPanelSections: ['glitterSearchSection', 'glitterOptions', 'shapesOptions', 'shapeSettingsSection'],
	mobileSettingsSections: ['shape'],
	panelMode: 'shape',
	elementClass: 'shape-glitter-element',
	transformable: true,
	managerKey: 'shapeGlitterManager',
	blendable: true,
	hitTestMethod: 'isPointInShape',
	transformPrefix: 'shape',
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
	createOptionsKey: 'shapeLayer',
	// Unlike text/glitter/sticker, tapping the Shape tool repeatedly to place
	// several shapes shouldn't keep yanking the Design drawer open on mobile.
	autoOpenDesignDrawerOnCreate: false,
	mobileCreateBehavior: { skipReload: true },
	onActivate: (editor, layer) => {
		const validTools = new Set([ToolType.SELECT, ToolType.HAND, ToolType.ZOOM, ToolType.SHAPE]);
		if (!validTools.has(editor.currentTool)) {
			editor.setTool(ToolType.SELECT);
		}

		editor.updateGlitterSelection();
		editor.shapeGlitterManager?.loadLayerSettings(layer);
	}
});
