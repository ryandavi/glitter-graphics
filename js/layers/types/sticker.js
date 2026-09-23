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
		}
	],
	// Color adjust of the sticker image itself.
	fields: [
		{ path: 'stickerData.colorAdjust.hue', field: 'hue', id: 'stickerHue', colorAdjust: true },
		{ path: 'stickerData.colorAdjust.saturation', field: 'saturation', id: 'stickerSaturation', colorAdjust: true },
		{ path: 'stickerData.colorAdjust.brightness', field: 'brightness', id: 'stickerBrightness', colorAdjust: true }
	],
	contentScalesWithTransform: true,
	hasVisibleContent: (layer) => !layer.stickerData || !layer.stickerData.isEmpty,
	animatable: true,
	serialization: {
		custom: { serialize: 'serializeSticker', deserialize: 'deserializeSticker' }
	},
	addedStatusMessage: 'New sticker layer added',
	goTo: 'sticker',
	addableViaModal: {
		label: 'Sticker',
		icon: 'sticker',
		description: 'Place an image or animated graphic',
		quickAddId: 'quickActionAddSticker',
		quickAddOrder: 2
	},
	designPanelSections: ['stickersSearchSection', 'stickersOptions', 'glitterSearchSection', 'glitterOptions', 'stickerSettingsSection'],
	mobileSettingsSections: ['sticker'],
	panelMode: 'sticker',
	elementClass: 'sticker-element',
	transformable: true,
	managerKey: 'stickerManager',
	blendable: true,
	// The image box; the shadow only widens the visual bounds. An empty
	// sticker has no frame, so it can't be clicked.
	frame: (editor, layer) => (layer.stickerData && !layer.stickerData.isEmpty && layer.stickerData.url
		? { width: layer.stickerData.width, height: layer.stickerData.height, offsetX: 0, offsetY: 0 }
		: null),
	visualBounds: (editor, layer) => padFrame(getLayerFrame(editor, layer), getLayerSlotFramePadding(layer)),
	transformPrefix: 'sticker',
	transformCapabilities: {
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
