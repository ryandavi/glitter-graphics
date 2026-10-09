'use strict';

// Path layers: Bézier geometry drawn with the Pen or Line tool, painted with
// a fill and a stroke. The body (fill plus stroke, each only while it renders)
// is what the outline, shadow, bevel and sparkles are derived from.
registerLayerType(LayerType.PATH, {
	describe: (layer, editor) => {
		const fill = getLayerFillSlot(layer);
		const paint = fill?.mode !== 'none' ? fill : layer.pathData?.stroke || fill;
		return { name: layer.name || 'Path', detail: `Path · ${describeLayerPaint(editor, paint).modeLabel}` };
	},
	displayName: 'Path',
	paintSlots: [
		{
			defaults: () => {
				return buildDefaultShadow({
					defaultMode: 'glitter',
					defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId.path,
					includeColorAdjust: true
				});
			},
			key: 'shadow',
			role: 'shadow',
			path: 'pathData.shadow',
			draftPath: 'pathData.effectDrafts.shadow',
			glitterDefault: 'shadowGlitterId',
			panelPrefix: 'pathShadow',
			modes: ['glitter', 'solid', 'gradient']
		},
		{
			defaults: () => {
				return buildDefaultBorder({
					config: CONFIG.tools.path.border,
					slot: getPaintSlotDefinition(LayerType.PATH, 'border'),
					includeColorAdjust: true,
					defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId.path
				});
			},
			key: 'border',
			role: 'border',
			label: 'outline',
			edgeStyles: ['round', 'miter', 'hard'],
			path: 'pathData.border',
			draftPath: 'pathData.effectDrafts.border',
			glitterDefault: 'borderGlitterId',
			panelPrefix: 'pathBorder',
			modes: ['glitter', 'solid', 'gradient'],
			fields: { widthPx: 'borderWidth' }
		},
		{
			defaults: () => {
				return buildDefaultFill({ defaultGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId.path });
			},
			key: 'fill',
			role: 'fill',
			path: 'pathData.fill',
			glitterDefault: 'fillGlitterId',
			panelPrefix: 'pathFill',
			modes: ['none', 'glitter', 'solid', 'gradient']
		},
		{
			defaults: () => {
				return buildDefaultStroke({ defaultGlitterId: CONFIG.tools.glitter.defaults.borderGlitterId.path });
			},
			key: 'stroke',
			role: 'stroke',
			path: 'pathData.stroke',
			draftPath: 'pathData.effectDrafts.stroke',
			glitterDefault: 'borderGlitterId',
			panelPrefix: 'pathStroke',
			modes: ['glitter', 'solid', 'gradient']
		},
		{
			defaults: () => {
				return buildDefaultBevel().highlight;
			},
			key: 'bevelHighlight',
			role: 'bevel',
			label: 'bevel highlight',
			path: 'pathData.bevel.highlight',
			enabledPath: 'pathData.bevel.enabled',
			glitterDefault: 'fillGlitterId',
			panelPrefix: 'pathBevel',
			modes: ['glitter', 'solid', 'gradient']
		},
		{
			defaults: () => {
				return buildDefaultBevel().shade;
			},
			key: 'bevelShade',
			role: 'bevel',
			label: 'bevel shade',
			path: 'pathData.bevel.shade',
			enabledPath: 'pathData.bevel.enabled',
			glitterDefault: 'shadowGlitterId',
			panelPrefix: 'pathBevelShade',
			modes: ['glitter', 'solid', 'gradient']
		},
		{
			defaults: () => {
				return buildDefaultSparkles();
			},
			key: 'sparkles',
			role: 'sparkles',
			path: 'pathData.sparkles',
			draftPath: 'pathData.effectDrafts.sparkles',
			glitterDefault: 'sparklesGlitterId',
			framePadding: (data) => getSparkleFramePadding(data),
			panelPrefix: 'pathSparkles',
			modes: ['glitter', 'solid', 'gradient']
		}
	],
	sparkleHost: (editor, layer) => editor.pathLayerManager?.getSparkleHost(layer) || null,
	hasVisibleContent: (layer) => PathGeometry.countPoints(layer.pathData?.subpaths) > 0,
	animatable: true,
	animate: (...args) => animateTransformableLayerPreview(...args),
	animationBox: (editor, layer) => {
		const frame = getLayerFrame(editor, layer);
		return { width: frame?.width || 1, height: frame?.height || 1 };
	},
	timelineSources: (layer, context) => [
		...context.compositor._createLayerAnimationTimelineSources(layer, context),
		...context.compositor._createSparkleTimelineSources(layer)
	],
	serialization: {
		dataKey: 'pathData',
		omit: ['settings'],
		defaultName: () => 'Path',
		normalize: (editor, layer) => editor.pathLayerManager?.normalizeLayer(layer)
	},
	addedStatusMessage: 'New path layer added',
	goTo: 'fill',
	addableViaModal: {
		label: 'Line',
		icon: 'line',
		group: 'basics',
		order: 4,
		description: 'Add a line or an arrow, in glitter or a color'
	},
	elementClass: 'path-layer-element',
	transformable: true,
	managerKey: 'pathLayerManager',
	scaleDocumentGeometry: (layer, scaleX, scaleY) => PathLayerManager.scaleDocumentGeometry(layer, scaleX, scaleY),
	blendable: true,
	// The fill is None on most open paths, so the thumbnail falls back to the
	// stroke's paint.
	renderSwatch: (layer, context) => {
		const fill = getLayerFillSlot(layer);
		const paint = fill?.mode !== 'none' ? fill : layer.pathData?.stroke || fill;
		if (!context.renderPaint(paint)) context.swatch.classList.add('empty');
		return true;
	},
	frame: (editor, layer) => editor.pathLayerManager?.getBodyFrame(layer) || null,
	visualBounds: (editor, layer) => editor.pathLayerManager?.getVisualFrame(layer) || null,
	// The element is the padded mask canvas, far larger than a thin line's
	// artwork, so the layer is picked on its geometry.
	elementBox: (editor, layer) => editor.pathLayerManager?.getElementBox(layer) || null,
	pickedOnCanvas: true,
	hitTest: (editor, layer, x, y, tolerance) => Boolean(editor.pathLayerManager?.hitTest(layer, x, y, tolerance)),
	// With Select, a double-click or double tap opens the point editor.
	onDoubleClick: (editor, layer) => editor.pathEdit?.begin(layer),
	transformPrefix: 'path',
	transformCapabilities: {
		edgeResize: true,
		position: true,
		size: true,
		// No Scale sliders: a resize is baked into the points on release.
		scaleReadout: false,
		lockAspect: true,
		fitCanvas: true,
		rotation: true,
		opacity: true,
		flip: true,
		align: true,
		reset: true
	},
	createOptionsKey: 'pathLayer',
	toolsOnSelect: [ToolType.SELECT, ToolType.HAND, ToolType.ZOOM, ToolType.PEN, ToolType.LINE]
});
