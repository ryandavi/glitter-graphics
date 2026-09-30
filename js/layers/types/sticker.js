'use strict';

registerLayerType(LayerType.STICKER, {
	displayName: 'Sticker',
	// The sticker image itself is not a paint slot. Its shadow scales with the
	// sticker transform, so document scaling compensates rather than rescales.
	paintSlots: [
		{
			key: 'shadow', role: 'shadow', path: 'stickerData.shadow', draftPath: 'stickerData.effectDrafts.shadow',
			glitterDefault: 'shadowGlitterId', framePadding: getShadowCanvasPadding,
			panelPrefix: 'stickerShadow', modes: ['glitter', 'solid']
		},
		{
			key: 'border', role: 'border', path: 'stickerData.border', draftPath: 'stickerData.effectDrafts.border',
			glitterDefault: 'borderGlitterId', framePadding: (data) => Math.max(0, data?.widthPx || 0),
			panelPrefix: 'stickerBorder', modes: ['glitter', 'solid'], fields: { widthPx: 'stickerOutlineWidth' }
		},
		{
			key: 'bevelHighlight', role: 'bevel', path: 'stickerData.bevel.highlight', enabledPath: 'stickerData.bevel.enabled',
			glitterDefault: 'fillGlitterId', panelPrefix: 'stickerBevel', modes: ['glitter', 'solid']
		},
		{
			key: 'bevelShade', role: 'bevel', path: 'stickerData.bevel.shade', enabledPath: 'stickerData.bevel.enabled',
			glitterDefault: 'shadowGlitterId', panelPrefix: 'stickerBevelShade', modes: ['glitter', 'solid']
		},
		{
			key: 'sparkles', role: 'sparkles', path: 'stickerData.sparkles', draftPath: 'stickerData.effectDrafts.sparkles',
			glitterDefault: 'sparklesGlitterId', framePadding: (data) => getSparkleFramePadding(data),
			panelPrefix: 'stickerSparkles', modes: ['glitter', 'solid']
		}
	],
	// Sparkles read the sticker's own image; the base URL, so a resolution
	// variant swap never moves the stars.
	sparkleHost: (editor, layer) => {
		const data = layer.stickerData;
		const url = data?.baseUrl || data?.url;
		if (!data || data.isEmpty || !url) return null;
		return {
			key: `sticker:${url}`,
			width: data.width,
			height: data.height,
			loadPixels: () => loadSparkleImageHostPixels(url, data.isAnimated)
		};
	},
	// Color adjust of the sticker image itself.
	fields: [
		{ path: 'stickerData.colorAdjust.hue', field: 'hue', id: 'stickerHue', colorAdjust: true },
		{ path: 'stickerData.colorAdjust.saturation', field: 'saturation', id: 'stickerSaturation', colorAdjust: true },
		{ path: 'stickerData.colorAdjust.brightness', field: 'brightness', id: 'stickerBrightness', colorAdjust: true }
	],
	contentScalesWithTransform: true,
	hasVisibleContent: (layer) => !layer.stickerData || !layer.stickerData.isEmpty,
	animatable: true,
	animate: (...args) => animateTransformableLayerPreview(...args),
	animationBox: (_editor, layer) => ({ width: layer.stickerData.width, height: layer.stickerData.height }),
	timelineSources: (layer, context) => [
		...context.compositor._createLayerAnimationTimelineSources(layer, context),
		...context.compositor._createSparkleTimelineSources(layer)
	],
	serialization: {
		custom: { serialize: 'serializeSticker', deserialize: 'deserializeSticker' }
	},
	addedStatusMessage: 'New sticker layer added',
	goTo: 'sticker',
	addableViaModal: {
		label: 'Sticker',
		icon: 'sticker',
		group: 'basics',
		order: 2,
		description: 'Place an image or animated graphic',
		quickAddId: 'quickActionAddSticker',
		quickAddOrder: 2
	},
	library: 'sticker',
	designPanelSections: ['stickerSettingsSection'],
	mobileSettingsSections: ['sticker'],
	panelMode: 'sticker',
	elementClass: 'sticker-element',
	transformable: true,
	managerKey: 'stickerManager',
	blendable: true,
	renderSwatch: (layer, context) => {
		context.swatch.classList.add('sticker');
		if (layer.stickerData?.isEmpty || !layer.stickerData?.url) {
			context.swatch.classList.add('empty');
			if (!context.compact) context.swatch.innerHTML = '<span>?</span>';
		} else {
			context.swatch.style.backgroundImage = `url(${layer.stickerData.url})`;
			context.swatch.style.filter = buildCssColorFilter(layer.stickerData.colorAdjust);
			if (layer.stickerData.isPixelated !== false) context.swatch.classList.add('pixelated');
		}
		return true;
	},
	// The image box; the shadow only widens the visual bounds. An empty
	// sticker has no frame, so it can't be clicked.
	frame: (editor, layer) => (layer.stickerData && !layer.stickerData.isEmpty && layer.stickerData.url
		? { width: layer.stickerData.width, height: layer.stickerData.height, offsetX: 0, offsetY: 0 }
		: null),
	visualBounds: (editor, layer) => padFrame(getLayerFrame(editor, layer), getLayerSlotFramePadding(layer)),
	transformPrefix: 'sticker',
	transformCapabilities: {
		edgeResize: true,
		panelRedesign: true,
		position: true,
		size: true,
		scaleReadout: true,
		scaleReset: true,
		lockAspect: true,
		rotation: true,
		opacity: true,
		flip: true,
		align: true,
		reset: true
	},
	autoOpenDesignDrawerOnCreate: true,
	onActivate: (editor, layer) => {
		editor.setTool(ToolType.SELECT);

		const stickerContent = document.getElementById('stickerSettingsContent');
		if (layer.stickerSourceId) {
			editor.setSettingsEmptyState('stickerSettings', false);
			editor.loadStickerSettings(layer);
		} else {
			if (stickerContent) stickerContent.classList.remove('visible');
			editor.setSettingsEmptyState('stickerSettings', true);
		}

		editor.updateStickerSelection();
	}
});
