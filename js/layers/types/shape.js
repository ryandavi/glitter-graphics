'use strict';

registerLayerType(LayerType.SHAPE, {
	displayName: 'Shape',
	paintSlots: [
		{
			key: 'shadow', role: 'shadow', path: 'shapeData.shadow', draftPath: 'shapeData.effectDrafts.shadow',
			glitterDefault: 'shadowGlitterId', panelPrefix: 'shapeShadow', modes: ['glitter', 'solid']
		},
		{
			key: 'border', role: 'border', path: 'shapeData.border', draftPath: 'shapeData.effectDrafts.border',
			glitterDefault: 'borderGlitterId', panelPrefix: 'shapeBorder', modes: ['glitter', 'solid'],
			fields: { widthPx: 'borderWidth', dotSpacingPx: 'borderDotSpacing' }
		},
		{
			key: 'fill', role: 'fill', path: 'shapeData.fill', glitterDefault: 'fillGlitterId',
			panelPrefix: 'shapeFill', modes: ['none', 'image', 'glitter', 'solid'],
			fields: { imageScalePercent: 'shapeImageScale', offsetXPercent: 'shapeImageOffsetX', offsetYPercent: 'shapeImageOffsetY' }
		},
		{
			key: 'sparkles', role: 'sparkles', path: 'shapeData.sparkles', draftPath: 'shapeData.effectDrafts.sparkles',
			glitterDefault: 'sparklesGlitterId', framePadding: (data) => getSparkleFramePadding(data),
			panelPrefix: 'shapeSparkles', modes: ['glitter', 'solid']
		}
	],
	sparkleHost: (editor, layer) => editor.shapeGlitterManager?.getSparkleHost(layer) || null,
	fields: [
		{ path: 'shapeData.cornerRadiusPx', field: 'shapeRadius', id: 'shapeRadius', geometry: true, documentScale: 'geometry' },
		{ path: 'shapeData.width', documentScale: 'geometry', minimum: 1 },
		{ path: 'shapeData.height', documentScale: 'geometry', minimum: 1 }
	],
	hasVisibleContent: (layer) => Boolean(layer.shapeData),
	animatable: true,
	animate: (...args) => animateTransformableLayerPreview(...args),
	animationBox: (_editor, layer) => ({ width: layer.shapeData.width, height: layer.shapeData.height }),
	timelineSources: (layer, context) => [
		...context.compositor._createLayerAnimationTimelineSources(layer, context),
		...context.compositor._createSparkleTimelineSources(layer)
	],
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
		quickAddOrder: 3,
		quickAddVariants: [{
			id: 'quickActionAddPhotoShape',
			order: 4,
			label: 'Photo in Shape',
			icon: 'open-image',
			description: 'Crop a photo inside a shape',
			createOptions: { shapeLayer: { fillMode: 'image', openImagePicker: true } }
		}]
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
	renderSwatch: (layer, context) => {
		const fill = getLayerFillSlot(layer);
		const imageAsset = context.editor.shapeGlitterManager?.getImageFillAsset(fill?.imageRef);
		if (!context.renderPaint(fill, imageAsset)) context.swatch.classList.add('empty');
		const shapeSvg = ShapeLibrary.getIconSvg(layer.shapeData?.shapeId);
		const shapeMask = `url("data:image/svg+xml;base64,${btoa(shapeSvg)}")`;
		context.swatch.style.maskImage = shapeMask;
		context.swatch.style.webkitMaskImage = shapeMask;
		context.swatch.style.maskRepeat = context.swatch.style.webkitMaskRepeat = 'no-repeat';
		context.swatch.style.maskPosition = context.swatch.style.webkitMaskPosition = 'center';
		context.swatch.style.maskSize = context.swatch.style.webkitMaskSize = '80% 80%';
		return true;
	},
	frame: (editor, layer) => editor.shapeGlitterManager?.getShapeBodyFrame(layer) || null,
	visualBounds: (editor, layer) => editor.shapeGlitterManager?.getShapeVisualFrame(layer) || null,
	supportsCornerRadius: (layer) => layer?.shapeData?.shapeId === 'square',
	transformPrefix: 'shape',
	transformCapabilities: {
		edgeResize: true,
		panelRedesign: true,
		position: true,
		size: true,
		// No Scale sliders: a shape's size is its pixel W/H. A percentage would
		// sit as an unbaked CSS stretch; handles bake theirs on release.
		scaleReadout: false,
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
