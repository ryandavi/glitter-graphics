'use strict';

registerLayerType(LayerType.TEXT_GLITTER, {
	clippable: true,
	clipBase: true,
	onDoubleClick: (editor, layer) => editor.textGlitterManager.beginTextEdit(layer),
	vectorGeometry: async (editor, layer) => {
		const data = layer.textData;
		await FontLibrary.ensureLoaded(data.fontId);
		const entry = editor.textGlitterManager.getMeasurementEntry(layer);
		return { masks: await editor.textGlitterManager.renderSlotMasks(layer), editableText: !isTextWarpActive(data.warp), fill: data.fill, offset: { x: entry.layoutOffsetX - entry.width / 2, y: entry.layoutOffsetY - entry.height / 2 },
			text: { family: FontLibrary.getFamily(FontLibrary.getFont(data.fontId)), size: data.fontSize, weight: data.fontWeight, style: data.fontStyle, spacing: data.letterSpacing, decoration: [data.decoration?.underline ? 'underline' : '', data.decoration?.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none', runs: entry.layout.runs } };
	},
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
			modes: STANDARD_PAINT_MODES
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
			modes: STANDARD_PAINT_MODES,
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
			label: 'outline',
			edgeStyles: ['round', 'miter', 'hard'],
			path: 'textData.border',
			draftPath: 'textData.effectDrafts.border',
			glitterDefault: 'borderGlitterId',
			panelPrefix: 'textBorder',
			modes: STANDARD_PAINT_MODES,
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
			modes: ['none', ...STANDARD_PAINT_MODES]
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
			modes: STANDARD_PAINT_MODES
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
			modes: STANDARD_PAINT_MODES
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
			modes: STANDARD_PAINT_MODES
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
		{ path: 'textData.boxWidth', documentScale: 'geometry', documentScaleAxis: 'x', minimum: 1 },
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
	animate: (...args) => paintLayerAnimationPreview(...args),
	animationBox: (_editor, layer) => ({ width: layer.textData.width, height: layer.textData.height }),
	timelineSources: (layer, context) => [
		...context.compositor._createLayerAnimationTimelineSources(layer, context),
		...context.compositor.createSparkleTimelineSources(layer)
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
	goTo: 'fill',
	addableViaModal: {
		label: 'Text',
		icon: 'text',
		group: 'layers',
		order: 4,
		description: 'Add editable text with glitter, color, or a gradient',
		quickAddId: 'quickActionAddText',
		quickAddOrder: 4
	},
	// No layerSettingsSection / 'tool': Selection Settings only applies to
	// color-picked glitter fills — text layers hide it instead of showing an
	// explanatory empty state.
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
	selectionChrome: {
		handles: ['text-mode'],
		hoverMode: (editor, layer, point, tolerance) => editor.textGlitterManager.getTextHoverMode(layer, point, tolerance),
		describe: (editor, layer) => ({ baselines: editor.textGlitterManager.getTextWorldBaselines(layer), textMode: layer.textData.boxMode }),
		onPointerDown: (editor, layer, handleType, event) => {
			if (handleType !== 'text-mode') return false;
			event.preventDefault();
			event.stopPropagation();
			const manager = editor.textGlitterManager;
			manager.toggleTextBoxMode(layer).catch(error => manager.reportFontLoadError(error));
			return true;
		}
	},
	transformPrefix: 'text',
	transformCapabilities: {
		edgeResize: true,
		position: true,
		size: true,
		scaleReadout: true,
		lockAspect: true,
		fitCanvas: true,
		rotation: true,
		opacity: true,
		flip: true,
		align: true,
		reset: true
	},
	createOptionsKey: 'textLayer',
	// Opens once the first typing ends (TextGlitterManager.commitTextEdit).
	openOnCreate: 'fill',
	toolsOnSelect: [ToolType.SELECT, ToolType.HAND, ToolType.ZOOM, ToolType.BRUSH]
});
