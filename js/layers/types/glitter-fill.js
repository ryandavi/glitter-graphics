'use strict';

registerLayerType(LayerType.GLITTER_FILL, {
	describe: (layer, editor) => {
		const fill = describeLayerPaint(editor, getLayerFillSlot(layer));
		return {
			name: layer.name || fill.glitter?.name || fill.name || `${fill.modeLabel} Fill`,
			detail: `Fill · ${fill.mode === 'none' ? 'None' : fill.modeLabel}`
		};
	},
	displayName: 'Fill Layer',
	paintSlots: [
		{
			defaults: () => {
				return buildDefaultShadow({
					defaultMode: 'glitter',
					defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId.glitterLayer,
					includeColorAdjust: true
				});
			},
			key: 'shadow',
			role: 'shadow',
			path: 'shadow',
			draftPath: 'effectDrafts.shadow',
			glitterDefault: 'shadowGlitterId',
			panelPrefix: 'glitterShadow',
			modes: ['glitter', 'solid', 'gradient']
		},
		{
			defaults: () => {
				return buildDefaultBorder({
					config: CONFIG.tools.glitter.border,
					slot: getPaintSlotDefinition(LayerType.GLITTER_FILL, 'border'),
					fallbackMode: 'glitter',
					defaultGlitterId: CONFIG.tools.glitter.defaults.borderGlitterId.glitterLayer,
					includeColorAdjust: true
				});
			},
			key: 'border',
			role: 'border',
			label: 'outline',
			edgeStyles: ['round', 'miter', 'hard'],
			path: 'border',
			draftPath: 'effectDrafts.border',
			glitterDefault: 'borderGlitterId',
			panelPrefix: 'glitterBorder',
			modes: ['glitter', 'solid', 'gradient'],
			fields: { widthPx: 'borderWidth' }
		},
		{
			defaults: () => {
				return {
					...buildDefaultFill({ defaultGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId.glitterLayer }),
					gradient: normalizeEffectGradient(CONFIG.rendering.gradient)
				};
			},
			key: 'fill',
			role: 'fill',
			path: 'fill',
			wholeLayer: true,
			sourceLabel: null,
			glitterDefault: 'fillGlitterId',
			panelPrefix: 'glitterFill',
			modes: ['glitter', 'solid', 'gradient'],
			fields: { opacity: false }
		},
		{
			defaults: () => {
				return buildDefaultSparkles();
			},
			key: 'sparkles',
			role: 'sparkles',
			path: 'sparkles',
			draftPath: 'effectDrafts.sparkles',
			glitterDefault: 'sparklesGlitterId',
			panelPrefix: 'glitterSparkles',
			modes: ['glitter', 'solid', 'gradient']
		}
	],
	fields: [
		{ path: 'settings.threshold', field: 'threshold', id: 'threshold' },
		{ path: 'settings.feather', field: 'feather', id: 'feather' },
		{ path: 'settings.contiguous', id: 'contiguous' },
		{ path: 'settings.invert', id: 'invert' },
		{ path: 'settings.multiSelect', id: 'multiSelect' },
		{ path: 'opacity', field: 'layerOpacity', id: 'opacity' }
	],
	// Sparkles scatter inside the painted mask.
	sparkleHost: (editor, layer) => editor.glitterManager?.getSparkleHost(layer) || null,
	hasVisibleContent: (layer) => hasMaskContent(layer),
	animatable: true,
	animate: (...args) => animateTransformableLayerPreview(...args),
	animationBox: (_editor, _layer, canvas) => ({ width: canvas.width, height: canvas.height }),
	timelineSources: (layer, context) => [
		...context.compositor._createLayerAnimationTimelineSources(layer, context),
		...context.compositor._createSparkleTimelineSources(layer)
	],
	serialization: {
		extraKeys: ['selections', 'fill', 'border', 'shadow', 'autoGlitter', 'sparkles', 'effectDrafts'],
		includeMaskVersion: true,
		defaults: { maskHasContent: false },
		normalize: (editor, layer) => editor.glitterManager?.normalizeLayer(layer)
	},
	addedStatusMessage: 'New fill layer added',
	goTo: 'glitter',
	addableViaModal: {
		label: 'Fill Layer',
		icon: 'glitter',
		group: 'layers',
		order: 2,
		description: 'Paint glitter, color, or a gradient onto the canvas',
		quickAddId: 'quickActionAddGlitter',
		quickAddOrder: 2
	},
	designPanelSections: ['glitterSettingsSection'],
	panelMode: 'glitter',
	elementClass: 'glitter-element',
	managerKey: 'glitterManager',
	blendable: true,
	// An empty fill has nothing to grab; it gets handles once it has a mask.
	transformable: (layer) => hasMaskContent(layer),
	defaultTransform: (editor) =>
		createDefaultTransform({
			position: {
				x: (editor.originalCanvas?.width || 0) / 2,
				y: (editor.originalCanvas?.height || 0) / 2
			}
		}),
	// The mask is a canvas-sized surface placed by the transform; its frame is
	// the painted pixels inside it.
	elementBox: (editor) => editor.glitterManager?.getMaskDimensions() || null,
	pickedOnCanvas: true,
	// Moving the surface leaves part of the canvas unpaintable, so a new Fill
	// layer starts pinned in place. The lock never blocks painting the mask.
	lockScope: 'position',
	lockedOnCreate: true,
	frame: (editor, layer) => editor.glitterManager?.getMaskFrame(layer) || null,
	visualBounds: (editor, layer) => editor.glitterManager?.getMaskVisualFrame(layer) || null,
	hitTest: (editor, layer, x, y, tolerance) => Boolean(editor.glitterManager?.hitTest(layer, x, y, tolerance)),
	transformPrefix: 'glitter',
	transformCapabilities: {
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
	openOnCreate: 'fill',
	onActivate: (editor, layer) => {
		if (!hasMaskContent(layer) && layer.fill?.glitterId && editor.currentTool !== ToolType.BRUSH) {
			editor.setTool(ToolType.GLITTER_FILL);
		}
		editor.updateGlitterSelection();
		editor.setSettingsEmptyState('layerSettings', false);
		editor.setSettingsEmptyState('glitterSettings', false);
		editor.loadActiveLayerSettings();
	}
});
