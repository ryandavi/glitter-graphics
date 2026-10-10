'use strict';

registerLayerType(LayerType.BASE_IMAGE, {
	describe: (layer) => ({ name: 'Base Image', detail: `Background · ${layer.background?.mode === 'none' ? 'Transparent' : panelCap(layer.background?.mode || 'image')}` }),
	displayName: 'Base Image',
	// The canvas background is one whole-layer paint. Image and gradient modes
	// draw into the base canvas instead of the slot paint path; its color
	// adjust is a canvas setting, not a layer effect.
	paintSlots: [
		{ key: 'background', role: 'fill', path: 'background', wholeLayer: true, sourceLabel: 'background', glitterDefault: 'fillGlitterId', countsAsEffect: false, modes: ['image', 'none', 'glitter', 'solid', 'gradient'] },
		{
			key: 'sparkles', role: 'sparkles', path: 'background.sparkles', draftPath: 'background.effectDrafts.sparkles',
			glitterDefault: 'sparklesGlitterId', panelPrefix: 'canvasSparkles', modes: ['glitter', 'solid', 'gradient']
		}
	],
	// Kira Kira on the photo reads the still base (the first frame of an
	// animated one), so it is detected once per image.
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
});
