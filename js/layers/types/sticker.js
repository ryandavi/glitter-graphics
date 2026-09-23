'use strict';

registerLayerType(LayerType.STICKER, {
	displayName: 'Sticker',
	// The sticker image itself is not a paint slot. Its shadow scales with the
	// sticker transform, so document scaling compensates rather than rescales.
	paintSlots: [
		{
			key: 'shadow', role: 'shadow', path: 'stickerData.shadow', draftPath: 'stickerData.effectDrafts.shadow',
			glitterDefault: 'shadowGlitterId', framePadding: getShadowCanvasPadding,
			documentPixels: { signedFields: ['offsetX', 'offsetY'] }
		}
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
	hitTestMethod: 'isPointInSticker',
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
