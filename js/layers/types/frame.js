'use strict';

registerLayerType(LayerType.FRAME, {
	assetRefs: (layer) => [{ kind: 'sticker', id: layer.frameData?.image?.stickerId }],
	displayName: 'Frame',
	// The style kind paints its ring with the fill slot; the image kind draws
	// a frame sticker instead (js/paint/frames.js FRAME_KINDS).
	paintSlots: [
		{
			defaults: () => {
				const defaults = CONFIG.tools.frames.defaults;
				return {
					...buildDefaultFill({ defaultGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId.frame }),
					mode: defaults.fillMode,
					color: defaults.color
				};
			},
			key: 'fill',
			role: 'fill',
			path: 'frameData.fill',
			glitterDefault: 'fillGlitterId',
			sourceLabel: null,
			panelPrefix: 'frameFill',
			modes: ['glitter', 'solid', 'gradient']
		},
		{
			defaults: () => {
				return buildDefaultSparkles();
			},
			key: 'sparkles',
			role: 'sparkles',
			path: 'frameData.sparkles',
			draftPath: 'frameData.effectDrafts.sparkles',
			glitterDefault: 'sparklesGlitterId',
			framePadding: (data) => getSparkleFramePadding(data),
			panelPrefix: 'frameSparkles',
			modes: ['glitter', 'solid', 'gradient']
		}
	],
	sparkleHost: (editor, layer) => editor.frameLayerManager?.getSparkleHost(layer) || null,
	fields: [
		{
			path: 'frameData.widthPx',
			field: 'frameThickness',
			id: 'frameThickness',
			geometry: true,
			documentScale: 'geometry'
		},
		{ path: 'frameData.inset', field: 'frameInset', id: 'frameInset', geometry: true, documentScale: 'geometry' },
		{ path: 'frameData.radius', field: 'frameRadius', id: 'frameRadius', geometry: true, documentScale: 'corner' },
		{
			path: 'frameData.sliceScale',
			field: 'frameSliceScale',
			id: 'frameSliceScale',
			geometry: true,
			documentScale: 'geometry'
		},
		{ path: 'frameData.shade', field: 'frameShade', id: 'frameShade' },
		{ path: 'frameData.width', documentScale: 'geometry', minimum: 1 },
		{ path: 'frameData.height', documentScale: 'geometry', minimum: 1 }
	],
	hasVisibleContent: (layer) =>
		Boolean(layer.frameData) && (layer.frameData.kind !== 'image' || Boolean(layer.frameData.image?.url)),
	timelineSources: (layer, context) => context.compositor._createSparkleTimelineSources(layer),
	serialization: {
		dataKey: 'frameData',
		omit: ['settings'],
		defaultName: () => 'Frame',
		normalize: (editor, layer) => editor.frameLayerManager?.normalizeLayer(layer)
	},
	addedStatusMessage: 'New frame layer added',
	goTo: null,
	addableViaModal: {
		label: 'Frame',
		icon: 'frame',
		group: 'decorate',
		order: 1,
		description: 'Put a border or an ornate frame around the picture'
	},
	library: 'glitter',
	designPanelSections: ['frameSettingsSection'],
	mobileSettingsSections: ['frame'],
	panelMode: 'frame',
	elementClass: 'frame-layer-element',
	// Pinned frames follow the canvas and have no handles; unpinned ones move
	// and resize like shapes.
	transformable: (layer) => !layer?.frameData?.pinned,
	managerKey: 'frameLayerManager',
	blendable: true,
	renderSwatch: (layer, context) => {
		const data = layer.frameData;
		if (data?.kind === 'image' && data.image?.url) {
			context.swatch.style.backgroundImage = `url(${data.image.url})`;
			context.swatch.classList.add('sticker');
			if (data.image.isPixelated !== false) context.swatch.classList.add('pixelated');
			return true;
		}
		if (!context.renderPaint(getLayerFillSlot(layer))) context.swatch.classList.add('empty');
		context.swatch.classList.add('frame-layer');
		return true;
	},
	frame: (editor, layer) => editor.frameLayerManager?.getFrameBox(layer) || null,
	// Picked on its painted pixels, pinned or not, so clicks inside the frame
	// reach the picture.
	hitTest: (editor, layer, x, y, tolerance) => Boolean(editor.frameLayerManager?.hitTest(layer, x, y, tolerance)),
	visualBounds: (editor, layer) => padFrame(getLayerFrame(editor, layer), getLayerSlotFramePadding(layer)),
	transformPrefix: 'frame',
	transformCapabilities: {
		edgeResize: true,
		position: true,
		size: true,
		scaleReadout: false,
		lockAspect: true,
		rotation: true,
		opacity: true,
		align: true,
		reset: true
	},
	openOnCreate: 'panel',
	onActivate: (editor, layer) => {
		editor.setTool(ToolType.SELECT);
		editor.updateGlitterSelection();
		editor.frameLayerManager?.loadLayerSettings(layer);
	}
});
