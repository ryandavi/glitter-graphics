'use strict';

registerLayerType(LayerType.BASE_IMAGE, {
	displayName: 'Base Image',
	// The canvas background is one whole-layer paint. Image and gradient modes
	// draw into the base canvas instead of the slot paint path; its color
	// adjust is a canvas setting, not a layer effect.
	paintSlots: [
		{ key: 'background', role: 'fill', path: 'background', wholeLayer: true, sourceLabel: 'background', glitterDefault: 'fillGlitterId', countsAsEffect: false },
		{
			key: 'sparkles', role: 'sparkles', path: 'background.sparkles', draftPath: 'background.effectDrafts.sparkles',
			glitterDefault: 'sparklesGlitterId', panelPrefix: 'canvasSparkles', modes: ['glitter', 'solid']
		}
	],
	// Kira Kira on the photo: the base image is always a still, so it is
	// detected once per image.
	sparkleHost: (editor, layer) => editor.baseBackgroundManager?.getSparkleHost(layer) || null,
	hasVisibleContent: () => true,
	serialization: {
		dataKey: 'background',
		omit: ['name', 'settings'],
		forceLocked: true,
		defaults: { image: null },
		normalize: (editor, layer) => editor.baseBackgroundManager?.normalizeLayer(layer)
	},
	managerKey: 'baseBackgroundManager',
	timelineSources: (layer, context) => (context.includeBaseImage ? context.compositor._createSparkleTimelineSources(layer) : []),
	renderSwatch: (layer, context) => {
		const background = getLayerFillSlot(layer) || { mode: 'image' };
		if (background.mode === 'image' && context.editor.baseBackgroundManager?.hasBaseImage() && context.editor.originalImage) {
			context.swatch.style.backgroundImage = `url(${context.baseImageSwatchDataUrl || context.editor.originalImage.src})`;
			context.swatch.classList.add('baseImage');
		} else if (!context.renderPaint(background)) {
			context.swatch.classList.add('empty');
		}
		return true;
	},
	goTo: null,
	designPanelSections: ['glitterSearchSection', 'glitterOptions', 'baseLayerSettingsSection'],
	mobileSettingsSections: ['background'],
	panelMode: 'base-layer',
	onActivate: (editor, layer) => {
		editor.baseBackgroundManager?.loadLayerSettings(layer);
	}
});
