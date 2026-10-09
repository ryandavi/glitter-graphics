'use strict';

registerLayerType(LayerType.STICKER, {
	assetRefs: (layer) => [{ kind: 'sticker', id: layer.stickerSourceId }],
	describe: (layer, editor) => {
		const sticker = editor.stickerManager.getItemById(layer.stickerSourceId);
		return { name: layer.name || 'Sticker', detail: sticker?.category ? `Sticker · ${sticker.category}` : 'Sticker' };
	},
	defaultCreateOptions: (editor) => {
		const id = CONFIG.tools.stickers.defaultStickerId;
		return id != null && editor.stickerManager.getItemById(id) ? id : null;
	},
	displayName: 'Sticker',
	// The sticker image itself is not a paint slot. Outline, shadow and bevel
	// sizes are canvas pixels, whatever the sticker's scale; sparkles are placed
	// in the sticker's own pixels and scale with it.
	paintSlots: [
		{
			defaults: () => {
				return buildDefaultShadow({
					defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId.sticker,
					includeColorAdjust: true
				});
			},
			key: 'shadow',
			role: 'shadow',
			path: 'stickerData.shadow',
			draftPath: 'stickerData.effectDrafts.shadow',
			glitterDefault: 'shadowGlitterId',
			framePadding: getShadowCanvasPadding,
			panelPrefix: 'stickerShadow',
			modes: ['glitter', 'solid', 'gradient']
		},
		{
			defaults: () => {
				return {
					...buildDefaultBorder({
						config: CONFIG.tools.stickers.outline,
						slot: getPaintSlotDefinition(LayerType.STICKER, 'border'),
						fallbackMode: 'glitter',
						defaultGlitterId: CONFIG.tools.glitter.defaults.borderGlitterId.sticker,
						includeColorAdjust: true
					}),
					fillInterior: CONFIG.tools.stickers.outline.fillInterior,
					unionFrames: CONFIG.tools.stickers.outline.useAllFrames
				};
			},
			key: 'border',
			role: 'border',
			label: 'outline',
			edgeStyles: ['round', 'miter', 'hard'],
			path: 'stickerData.border',
			draftPath: 'stickerData.effectDrafts.border',
			glitterDefault: 'borderGlitterId',
			framePadding: (data) => Math.max(0, data?.widthPx || 0),
			panelPrefix: 'stickerBorder',
			modes: ['glitter', 'solid', 'gradient'],
			fields: { widthPx: 'stickerOutlineWidth' }
		},
		{
			defaults: () => {
				return buildDefaultBevel().highlight;
			},
			key: 'bevelHighlight',
			role: 'bevel',
			label: 'bevel highlight',
			path: 'stickerData.bevel.highlight',
			enabledPath: 'stickerData.bevel.enabled',
			glitterDefault: 'fillGlitterId',
			panelPrefix: 'stickerBevel',
			modes: ['glitter', 'solid', 'gradient']
		},
		{
			defaults: () => {
				return buildDefaultBevel().shade;
			},
			key: 'bevelShade',
			role: 'bevel',
			label: 'bevel shade',
			path: 'stickerData.bevel.shade',
			enabledPath: 'stickerData.bevel.enabled',
			glitterDefault: 'shadowGlitterId',
			panelPrefix: 'stickerBevelShade',
			modes: ['glitter', 'solid', 'gradient']
		},
		{
			defaults: () => {
				return buildDefaultSparkles();
			},
			key: 'sparkles',
			role: 'sparkles',
			path: 'stickerData.sparkles',
			draftPath: 'stickerData.effectDrafts.sparkles',
			glitterDefault: 'sparklesGlitterId',
			framePadding: (data) => getSparkleFramePadding(data),
			panelPrefix: 'stickerSparkles',
			modes: ['glitter', 'solid', 'gradient']
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
	goTo: 'asset',
	addableViaModal: {
		label: 'Sticker',
		icon: 'sticker',
		group: 'layers',
		order: 1,
		description: 'Place an image or animated graphic',
		quickAddId: 'quickActionAddSticker',
		quickAddOrder: 1
	},
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
	frame: (editor, layer) =>
		layer.stickerData && !layer.stickerData.isEmpty && layer.stickerData.url
			? { width: layer.stickerData.width, height: layer.stickerData.height, offsetX: 0, offsetY: 0 }
			: null,
	// The frame is in the sticker's own pixels, so canvas-pixel effect padding
	// is divided by the sticker scale.
	visualBounds: (editor, layer) => {
		const scale = getLayerTransform(layer).scale;
		let padX = 0;
		let padY = 0;
		getLayerPaintSlots(layer).forEach((entry) => {
			if (!entry.renders || !entry.definition.framePadding) return;
			const padding =
				entry.role === 'shadow'
					? getShadowCanvasPadding(entry.data, {
							x: 0,
							y: 0,
							width: layer.stickerData.width * Math.max(0.01, Math.abs(scale.x) / 100),
							height: layer.stickerData.height * Math.max(0.01, Math.abs(scale.y) / 100)
						})
					: entry.definition.framePadding(entry.data);
			const local = entry.role === 'sparkles';
			padX = Math.max(padX, local ? padding : padding / Math.max(0.01, Math.abs(scale.x) / 100));
			padY = Math.max(padY, local ? padding : padding / Math.max(0.01, Math.abs(scale.y) / 100));
		});
		return padFrame(getLayerFrame(editor, layer), padX, padY);
	},
	transformPrefix: 'sticker',
	transformCapabilities: {
		edgeResize: true,
		position: true,
		size: true,
		scaleReadout: true,
		scaleReset: true,
		lockAspect: true,
		fitCanvas: true,
		rotation: true,
		opacity: true,
		flip: true,
		align: true,
		reset: true
	},
	openOnCreate: 'asset',
	toolsOnSelect: [],
	panelEmpty: (layer) => !layer.stickerSourceId
});
