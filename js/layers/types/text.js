'use strict';

registerLayerType(LayerType.TEXT_GLITTER, {
	assetRefs: (layer) => [{ kind: 'font', id: layer.textData?.fontId }],
	rasterizesScale: true,
	describe: (layer, editor) => ({
		name: layer.name || 'Text',
		detail: `Text · ${describeLayerPaint(editor, getLayerFillSlot(layer)).modeLabel}`
	}),
	displayName: 'Text',
	paintSlots: [
		{
			defaults: () => {
				return buildDefaultFill({
					defaultGlitterId: CONFIG.tools.glitter.defaults.backgroundGlitterId
				});
			},
			key: 'backgroundFill',
			role: 'background',
			label: 'background',
			path: 'textData.textBackground.fill',
			enabledPath: 'textData.textBackground.enabled',
			sourceLabel: 'backgroundFill',
			glitterDefault: 'backgroundGlitterId',
			panelPrefix: 'textBackground',
			modes: ['glitter', 'solid']
		},
		{
			defaults: () => {
				const shadow = buildDefaultShadow({
					defaultMode: 'glitter',
					defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId.text,
					castAnchor: 'baseline'
				});
				delete shadow.castLength;
				delete shadow.castLean;
				return {
					...shadow,
					castLengthRatio: FIELDS.textCastLength.value / 100,
					castLeanRatio: FIELDS.textCastLean.value / 100,
					castBlurRatio: FIELDS.textCastBlur.value / 100
				};
			},
			key: 'shadow',
			role: 'shadow',
			path: 'textData.shadow',
			draftPath: 'textData.effectDrafts.shadow',
			glitterDefault: 'shadowGlitterId',
			panelPrefix: 'textShadow',
			modes: ['glitter', 'solid'],
			fields: {
				castLength: false,
				castLean: false,
				castLengthRatio: 'textCastLength',
				castLeanRatio: 'textCastLean',
				castBlurRatio: 'textCastBlur'
			}
		},
		{
			defaults: () => {
				return buildDefaultBorder({
					config: CONFIG.tools.text.border,
					slot: getPaintSlotDefinition(LayerType.TEXT_GLITTER, 'border'),
					fallbackMode: 'glitter',
					defaultGlitterId: CONFIG.tools.glitter.defaults.borderGlitterId.text
				});
			},
			key: 'border',
			role: 'border',
			edgeStyles: ['round', 'miter', 'hard'],
			path: 'textData.border',
			draftPath: 'textData.effectDrafts.border',
			glitterDefault: 'borderGlitterId',
			panelPrefix: 'textBorder',
			modes: ['glitter', 'solid'],
			fields: { widthPx: 'textBorderWidth' }
		},
		{
			defaults: () => {
				return buildDefaultFill({ defaultGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId.text });
			},
			key: 'fill',
			role: 'fill',
			path: 'textData.fill',
			glitterDefault: 'fillGlitterId',
			panelPrefix: 'textFill',
			modes: ['none', 'glitter', 'solid']
		},
		{
			defaults: () => {
				return buildDefaultBevel().highlight;
			},
			key: 'bevelHighlight',
			role: 'bevel',
			label: 'bevel highlight',
			path: 'textData.bevel.highlight',
			enabledPath: 'textData.bevel.enabled',
			glitterDefault: 'fillGlitterId',
			panelPrefix: 'textBevel',
			modes: ['glitter', 'solid']
		},
		{
			defaults: () => {
				return buildDefaultBevel().shade;
			},
			key: 'bevelShade',
			role: 'bevel',
			label: 'bevel shade',
			path: 'textData.bevel.shade',
			enabledPath: 'textData.bevel.enabled',
			glitterDefault: 'shadowGlitterId',
			panelPrefix: 'textBevelShade',
			modes: ['glitter', 'solid']
		},
		{
			defaults: () => {
				return buildDefaultSparkles();
			},
			key: 'sparkles',
			role: 'sparkles',
			path: 'textData.sparkles',
			draftPath: 'textData.effectDrafts.sparkles',
			glitterDefault: 'sparklesGlitterId',
			framePadding: (data) => getSparkleFramePadding(data),
			panelPrefix: 'textSparkles',
			modes: ['glitter', 'solid']
		}
	],
	sparkleHost: (editor, layer) => editor.textGlitterManager?.getSparkleHost(layer) || null,
	fields: [
		{
			path: 'textData.fontSize',
			field: 'textFontSize',
			id: 'textFontSize',
			geometry: true,
			documentScale: 'geometry',
			minimum: 1
		},
		{
			path: 'textData.letterSpacing',
			field: 'textLetterSpacing',
			id: 'textLetterSpacing',
			geometry: true,
			documentScale: 'geometry'
		},
		{ path: 'textData.lineHeight', field: 'textLineHeight', id: 'textLineHeight', factor: 100, geometry: true },
		{ path: 'textData.warp.bend', field: 'textWarpBend', id: 'textWarpBend', geometry: true },
		{ path: 'textData.boxWidth', documentScale: 'geometry', minimum: 1 },
		{ path: 'textData.boxHeight', documentScale: 'geometry', minimum: 1 },
		{
			path: 'textData.textBackground.horizontalPadding',
			field: 'textBackgroundPaddingH',
			id: 'textBackgroundPaddingH',
			geometry: true,
			documentScale: 'geometry'
		},
		{
			path: 'textData.textBackground.verticalPadding',
			field: 'textBackgroundPaddingV',
			id: 'textBackgroundPaddingV',
			geometry: true,
			documentScale: 'geometry'
		},
		{
			path: 'textData.textBackground.cornerRadius',
			field: 'textBackgroundRadius',
			id: 'textBackgroundRadius',
			geometry: true,
			documentScale: 'geometry'
		},
		{
			path: 'textData.textBackground.mergeDistance',
			field: 'textBackgroundMergeDistance',
			id: 'textBackgroundMergeDistance',
			geometry: true,
			documentScale: 'geometry'
		},
		{
			path: 'textData.textBackground.lineSpacingSensitivity',
			field: 'textBackgroundSpacing',
			id: 'textBackgroundSpacing',
			geometry: true
		}
	],
	hasVisibleContent: (layer) => Boolean(layer.textData?.text?.trim()),
	animatable: true,
	animate: (...args) => animateTransformableLayerPreview(...args),
	animationBox: (_editor, layer) => ({ width: layer.textData.width, height: layer.textData.height }),
	timelineSources: (layer, context) => [
		...context.compositor._createLayerAnimationTimelineSources(layer, context),
		...context.compositor._createSparkleTimelineSources(layer)
	],
	serialization: {
		dataKey: 'textData',
		omit: ['settings'],
		defaultName: (editor, data) => editor.textGlitterManager?.getLayerName(data?.text || ''),
		normalize: (editor, layer) => editor.textGlitterManager?.normalizeLayer(layer),
		hydrate: async (editor, layer) => {
			if (layer.textData?.fontId) await FontLibrary.ensureLoaded(layer.textData.fontId);
		}
	},
	addedStatusMessage: 'New text layer added',
	goTo: 'glitter',
	addableViaModal: {
		label: 'Text',
		icon: 'text',
		group: 'basics',
		order: 1,
		description: 'Add editable text with glitter, color, or a gradient',
		quickAddId: 'quickActionAddText',
		quickAddOrder: 1
	},
	// No layerSettingsSection / 'tool': Selection Settings only applies to
	// color-picked glitter fills — text layers hide it instead of showing an
	// explanatory empty state.
	library: 'glitter',
	designPanelSections: ['textSettingsSection'],
	mobileSettingsSections: ['text'],
	panelMode: 'text',
	elementClass: 'text-glitter-element',
	transformable: true,
	managerKey: 'textGlitterManager',
	blendable: true,
	renderSwatch: (layer, context) => {
		if (!context.renderPaint(getLayerFillSlot(layer))) context.swatch.classList.add('empty');
		context.swatch.classList.add('text-layer');
		if (!context.compact) context.swatch.innerHTML = '<span class="layer-swatch-text-overlay">T</span>';
		return true;
	},
	frame: (editor, layer) => editor.textGlitterManager?.getTextBodyFrame(layer) || null,
	visualBounds: (editor, layer) => editor.textGlitterManager?.getTextVisualFrame(layer) || null,
	transformPrefix: 'text',
	transformCapabilities: {
		edgeResize: true,
		position: true,
		size: true,
		scaleReadout: true,
		lockAspect: true,
		rotation: true,
		opacity: true,
		flip: true,
		align: true,
		reset: true
	},
	createOptionsKey: 'textLayer',
	autoOpenDesignDrawerOnCreate: false,
	// Reopening the side panel after every tap-created layer is desktop
	// convenience, not a mobile ask - Editor.finishLayerCreation() reads this.
	mobileCreateBehavior: { skipReload: true },
	onActivate: (editor, layer) => {
		const validTools = new Set([ToolType.SELECT, ToolType.HAND, ToolType.ZOOM, ToolType.BRUSH]);
		if (!validTools.has(editor.currentTool)) {
			editor.setTool(ToolType.SELECT);
		}

		editor.updateGlitterSelection();
		editor.textGlitterManager?.loadLayerSettings(layer);
	}
});
