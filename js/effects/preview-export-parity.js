const PREVIEW_EXPORT_TWINS = [
	{
		feature: 'paint source',
		shared: 'resolveEffectPaintSource',
		preview: ['TextGlitterManager.getEffectPaintSource', 'ShapeGlitterManager.getEffectPaintSource'],
		export: ['GifExporter._getTextEffectSource', 'GifExporter._getShapeEffectSource']
	},
	{
		feature: 'mask dilation',
		shared: 'createDilatedMaskCanvas',
		preview: ['TextGlitterManager.createDilatedMaskCanvas'],
		export: ['GifExporter._createDilatedMaskCanvas']
	},
	{
		feature: 'mask erosion',
		shared: 'createErodedMaskCanvas',
		preview: ['TextGlitterManager.createErodedMaskCanvas'],
		export: ['GifExporter._createErodedMaskCanvas']
	},
	{
		feature: 'mask difference',
		shared: 'createMaskDifferenceCanvas',
		preview: ['TextGlitterManager.createMaskDifferenceCanvas'],
		export: ['GifExporter._createMaskDifferenceCanvas']
	},
	{
		feature: 'border placement',
		shared: 'getBorderPlacement',
		preview: ['TextGlitterManager.getBorderPlacement', 'ShapeGlitterManager.getBorderPlacement'],
		export: ['GifExporter._getBorderPlacement']
	},
	{
		feature: 'border edge style',
		shared: 'getBorderEdgeStyle',
		preview: ['TextGlitterManager.getBorderEdgeStyle', 'ShapeGlitterManager.getBorderEdgeStyle'],
		export: ['GifExporter._getBorderEdgeStyle']
	},
	{
		feature: 'border draw order',
		shared: 'getBorderDrawOrder',
		preview: ['TextGlitterManager.getBorderDrawOrder', 'ShapeGlitterManager.getBorderDrawOrder'],
		export: ['GifExporter._getBorderDrawOrder']
	}
];

const PREVIEW_EXPORT_SWEEP = Object.freeze({
	placements: Object.freeze(['outside', 'center', 'inside']),
	edgeStyles: Object.freeze(['round', 'hard']),
	drawOrders: Object.freeze(['behind', 'front']),
	fillModes: Object.freeze(['solid', 'gradient', 'glitter'])
});
