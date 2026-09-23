// Preview and export read one slot stack (buildSlotStack) and one set of
// paint helpers. Each entry names the shared function and the preview/export
// members that must call it; tests/unit/preview-export-twins.js checks that.
// Members are Class.method, or paintSlots.functionName for js/paint/paint-slots.js.
const PREVIEW_EXPORT_TWINS = [
	{
		feature: 'slot stack order',
		shared: 'buildSlotStack',
		preview: ['TextGlitterManager.getSlotStack', 'ShapeGlitterManager.getSlotStack'],
		export: ['SceneCompositor._renderSlotStackToCanvas', 'SceneCompositor._renderStickerEffects']
	},
	{
		feature: 'paint source',
		shared: 'resolvePaintSlotSource',
		preview: ['paintSlots.resolvePaintSlotPreviewSource'],
		export: ['SceneCompositor._getSlotSource']
	},
	{
		feature: 'text slot masks',
		shared: 'getSlotMask',
		preview: ['TextGlitterManager.reconcileTextSpans'],
		export: ['TextGlitterManager.renderSlotMasks']
	},
	{
		feature: 'shape border mask',
		shared: 'getBorderMaskCanvas',
		preview: ['ShapeGlitterManager.getSlotMask'],
		export: ['ShapeGlitterManager.renderSlotMasks']
	},
	{
		feature: 'image fill placement',
		shared: 'getImageFillPlacement',
		preview: ['paintSlots.applyPaintSourceToElement'],
		export: ['SceneCompositor._paintSourceInto']
	},
	{
		feature: 'texture registration',
		shared: 'getSlotTexturePatternOrigin',
		preview: ['paintSlots.applyPaintSourceToElement'],
		export: ['SceneCompositor._paintSourceInto']
	}
];

const PREVIEW_EXPORT_SWEEP = Object.freeze({
	placements: Object.freeze(['outside', 'center', 'inside']),
	edgeStyles: Object.freeze(['round', 'hard']),
	drawOrders: Object.freeze(['behind', 'front']),
	fillModes: Object.freeze(['solid', 'gradient', 'glitter', 'image'])
});
