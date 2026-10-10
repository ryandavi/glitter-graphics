// Declarative sidebar panel structure consumed by js/ui/panel-renderer.js.
// Structure, ordering, and capabilities only — markup lives in the index.html
// tpl-* <template>s, slider ranges in FIELDS (js/core/fields.js). Stamped
// element ids keep the names managers bind by; paintSlot ids derive as
// idPrefix + capitalized role, the grammar the paint-slot binder reads.
//
// One grammar, five levels (docs/UI-CONVENTIONS.md):
//
//   panel    a PANEL_SCHEMAS entry: `groups` (plus `effects` and `motion`,
//            which the renderer turns into the Effects and Motion groups)
//   group    { title, sections, note?, actions?, role? }. `role: 'actions'`
//            marks the group of a panel's own buttons: it comes last, and
//            the phone bar lists it as More.
//   section  { kind: 'section' | 'paintSlot' | 'transform' | 'mount', title,
//              sets, advanced? }. `advanced` is a list of sets under the
//              section's one "Advanced" disclosure. `presentation: 'flyout'`
//              leaves one line in the panel and opens the section in the
//              window beside it. `key` names a section where its title must
//              be free to change (it defaults to the paint slot, then the
//              title). A paintSlot names its `slot` and `idPrefix`; its
//              source modes are the layer type's (`paintSlots[].modes`). Its
//              `summaryValue` is the id of
//              the one slider whose value its summary states (an outline's
//              width). `chips: 'buttons'` puts the section's buttons in the
//              phone bar themselves, instead of one chip for the section.
//   set      { label?, rows }, or { actions } for a set of buttons. `collapse:
//            'open' | 'closed'` makes a labelled set's name a toggle.
//   row      { kind: 'slider' | 'select' | 'segmented' | 'toggle' | 'field' |
//              'numberPair' | 'note' | 'assetInfo' | 'presetGrid' | 'host' … }
//
// Every row sits in a set and every set in a section: the renderer builds
// exactly what is written and wraps nothing. `label` is a row's visible text;
// `ariaLabel` is given only where the accessible name must differ. `revert:
// true` adds a revert to the schema's default; a string names the ids a
// manager-owned revert restores. A paintSlot always builds Source, then
// Opacity, then its own `sets`; `before` sets (presets) lead it.
const sentenceCaseOption = (value) => {
	const words = value.split('-').join(' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
};

const LAYER_BLEND_MODE_OPTIONS = CONFIG.layers.blendModes.map((value) => ({
	value,
	label: sentenceCaseOption(value),
	selected: value === CONFIG.layers.defaultBlendMode
}));

function createPaletteControlRows(prefix, options = {}) {
	const styleDefault = options.styleDefault || CONFIG.tools.autoGlitter.defaults.paletteStyle;
	return [
		{ kind: 'segmented', id: `${prefix}PaletteStyle`, classes: options.styleClasses, label: 'Style', ariaLabel: 'Palette style', revert: true,
			options: getOptions('analysisPaletteStyle').map((entry) => ({
				...entry,
				active: entry.value === styleDefault,
				attrs: options.styleTitles?.[entry.value] ? { title: options.styleTitles[entry.value] } : undefined
			})) },
		{ kind: 'slider', id: `${prefix}ColorCount`, slider: 'paletteColorCount', label: options.colorLabel || 'Colors' },
		{ kind: 'slider', id: `${prefix}MergeDistinctness`, slider: 'paletteMerge', label: options.mergeLabel, valueScale: 'percent' }
	];
}

const TEXT_BACKGROUND_PRESET_OPTIONS = [
	{ value: '', label: 'Choose a preset…' },
	{ value: 'instagram', label: 'Instagram', selected: true },
	{ value: 'tight', label: 'Tight highlight' },
	{ value: 'separateLines', label: 'Separate lines' },
	{ value: 'connectedBlock', label: 'Connected block' },
	{ value: 'textBounds', label: 'Text bounds' },
	{ value: 'textBox', label: 'Text box' },
	{ value: 'labelPill', label: 'Label / pill' }
];

const ANIMATION_PRESET_OPTIONS = Object.values(GlitterAnimation.MOTION_REGISTRY)
	.filter((motion) => motion.targets.includes('layer')).map((motion) => ({
		value: motion.id, label: motion.label, group: motion.group,
		selected: motion.id === CONFIG.tools.animation.defaultType
	}));

const ANCHOR_SELECT_OPTIONS = Object.freeze([
	...ANCHOR_POINTS.map((anchor) => ({ value: `${anchor.fx},${anchor.fy}`, label: anchor.label })),
	{ value: 'custom', label: 'Custom', disabled: true }
]);

// The Layer section of an Appearance group: the whole-layer rows (opacity,
// and blend where the type has one). A section of their own, so no row floats
// between two others.
function createLayerSectionSpec(opacityId, blendId) {
	const rows = [{ kind: 'slider', id: opacityId, slider: 'layerOpacity' }];
	if (blendId) {
		rows.push({ kind: 'select', id: blendId, label: 'Blend', ariaLabel: 'Layer blend mode', classes: 'layer-blend-mode', revert: true, options: LAYER_BLEND_MODE_OPTIONS });
	}
	return { kind: 'section', title: 'Layer', sets: [{ rows }] };
}

// Option buttons for a registry option list. Call it from a getter: the frame
// and sparkle registries (js/paint/) load after this file.
function createRegistryOptionEntries(name, idPrefix) {
	return getOptions(name).map((option) => ({
		id: `${idPrefix}${option.value.charAt(0).toUpperCase()}${option.value.slice(1)}`,
		label: option.label,
		value: option.value
	}));
}

// Everything behind a Sparkles section's presets, under its Advanced. Control
// ids are the slot's panelPrefix + the suffixes the binder reads
// (ui/paint-slot-controls.js). Sets marked data-sparkle-emitter show only for
// the emitters they list.
function createSparkleAdvancedSets(p) {
	return [
		{ label: 'Placement', rows: [
			{ kind: 'segmented', label: 'Place', hint: 'Scatter over the layer, trace its edges, or put stars on its bright highlights (Kira Kira)',
				get options() { return createRegistryOptionEntries('sparkleEmitter', `${p}Emitter`); } },
			{ kind: 'segmented', label: 'Layering', options: [
				{ id: `${p}OrderBehind`, label: 'Behind', value: 'behind' },
				{ id: `${p}OrderFront`, label: 'In front', value: 'front' }
			] }
		] },
		{ label: 'Shapes', classes: 'sparkle-glyph-set', attrs: { 'data-sparkle-emitter': 'inside edges' }, rows: [
			{ kind: 'sparkleGlyphs', idPrefix: p }
		] },
		{ label: 'Highlights', attrs: { 'data-sparkle-emitter': 'highlights' }, rows: [
			{ kind: 'slider', id: `${p}Sensitivity`, slider: 'sparkleSensitivity', title: 'Higher finds more, dimmer highlights. It never brightens the image.' },
			{ kind: 'slider', id: `${p}Spacing`, slider: 'sparkleSpacing', title: 'Minimum distance between stars' },
			{ kind: 'segmented', label: 'Style', get options() { return createRegistryOptionEntries('sparkleStyle', `${p}Style`); } },
			{ kind: 'toggle', id: `${p}Halo`, label: 'Halo', title: 'A soft glow under the strongest stars' }
		] },
		{ label: 'Particles', rows: [
			{ kind: 'slider', id: `${p}Count`, slider: 'sparkleCount' },
			{ kind: 'slider', id: `${p}SizeMin`, slider: 'sparkleSizeMin' },
			{ kind: 'slider', id: `${p}SizeMax`, slider: 'sparkleSizeMax' }
		] },
		{ label: 'Motion', rows: [
			{ kind: 'segmented', label: 'Motion', display: 'select', get options() { return createRegistryOptionEntries('sparkleBehavior', `${p}Behavior`); } },
			{ kind: 'slider', id: `${p}Cycle`, slider: 'sparkleCycle', title: 'Length of one sparkle cycle; each sparkle blinks one to three times per cycle' }
		] },
		{ actions: [
			{ id: `${p}Shuffle`, label: 'Shuffle', title: 'Place the sparkles somewhere new' }
		] }
	];
}

// The Sparkles section (a `sparkles` paint slot). Every host shares it.
// overrides: the Sparkles layer's section is its content, so it has no
// on/off switch and stays in the panel.
function createSparklesSectionSpec(idPrefix, overrides = {}) {
	return {
		kind: 'paintSlot', slot: 'sparkles', idPrefix, title: 'Sparkles', presentation: 'flyout',
		attrs: { 'data-sparkle-controls': idPrefix },
		texturePosition: true,
		toggle: true, activeMode: 'solid',
		color: '#ffffff', chipTitle: 'Choose sparkle glitter',
		before: [{ label: 'Presets', collapse: 'open', rows: [
			{ kind: 'presetGrid', id: `${idPrefix}Presets`, label: 'Sparkle presets', classes: 'property-inset sparkle-presets' }
		] }],
		get advanced() { return createSparkleAdvancedSets(idPrefix); },
		...overrides
	};
}

// The Style section that leads a layer's Appearance: a preset grid of whole
// looks (js/paint/style-presets.js), filled and bound by
// syncStylePresetGrid (ui/paint-slot-controls.js).
function createStylePresetSectionSpec(prefix) {
	// Collapsed by default: the header names the applied look (or Custom), so
	// a styled layer still reads at a glance.
	return { kind: 'section', title: 'Style', collapsed: true, presentation: 'flyout',
		summary: { id: `${prefix}StyleSummary` }, sets: [
		{ rows: [
			{ kind: 'presetGrid', id: `${prefix}StylePresets`, label: 'Style presets', classes: 'property-inset style-presets' }
		] }
	] };
}

// Bevel has two paints: the section's own source is the highlight, and Shade
// is a second source in a set of its own.
function createBevelSectionSpecs(idPrefix) {
	return [
		{ kind: 'paintSlot', slot: 'bevelHighlight', idPrefix, title: 'Bevel & gloss', presentation: 'flyout',
			toggle: true, texturePosition: true, sourceLabel: 'Highlight', activeMode: 'solid',
			color: '#ffffff', chipTitle: 'Choose highlight glitter',
			sets: [
				{ paint: { id: `${idPrefix}ShadeCard`, slot: 'bevelShade', idPrefix: `${idPrefix}Shade`, sourceLabel: 'Shade',
					texturePosition: true, activeMode: 'solid', color: '#000000', chipTitle: 'Choose shade glitter' } },
				{ label: 'Shape', rows: [
					{ kind: 'select', id: `${idPrefix}Profile`, label: 'Profile', ariaLabel: 'Bevel profile', revert: true,
						options: getOptions('bevelProfile').map((option) => ({ ...option, selected: option.value === 'smooth' })) },
					{ kind: 'slider', id: `${idPrefix}Size`, slider: 'bevelSize', rowId: `${idPrefix}SizeRow` },
					{ kind: 'slider', id: `${idPrefix}Depth`, slider: 'bevelDepth' },
					{ kind: 'slider', id: `${idPrefix}Soften`, slider: 'bevelSoften' }
				] },
				{ label: 'Light', rows: [
					{ kind: 'slider', id: `${idPrefix}Angle`, slider: 'bevelAngle', rowId: `${idPrefix}AngleRow` },
					{ kind: 'slider', id: `${idPrefix}Altitude`, slider: 'bevelAltitude', rowId: `${idPrefix}AltitudeRow` }
				] }
			]
		}
	];
}

// Outline is the same section on every layer type: Stroke, then Placement.
// `stroke` and `placement` are that type's rows.
function createOutlineSectionSpec(idPrefix, stroke, placement) {
	const edges = placement.filter((row) => row.label === 'Edges');
	return { kind: 'paintSlot', slot: 'border', idPrefix, title: 'Outline', presentation: 'flyout',
		summaryValue: stroke[0].id,
		toggle: true, texturePosition: true, activeMode: 'glitter',
		color: '#000000', chipTitle: 'Choose outline glitter',
		sets: [
			{ label: 'Stroke', rows: [...stroke, ...edges] },
			{ label: 'Placement', rows: placement.filter((row) => row.label !== 'Edges') }
		]
	};
}

function createBorderEdgeOptions(idPrefix) {
	const slot = Object.values(LAYER_UI_CONFIG).flatMap(type => type.paintSlots || []).find(slot => slot.panelPrefix === idPrefix);
	return getOptions('borderEdgeStyle').filter(option => !slot?.edgeStyles || slot.edgeStyles.includes(option.value))
		.map(({ value, label, suffix }) => ({ id: `${idPrefix}${suffix}`, value, label, active: value === 'round' }));
}

// The Edges / Placement / Layering choices a vector outline has.
function createOutlinePlacementRows(idPrefix) {
	return [
		{ kind: 'segmented', label: 'Edges', revert: true, get options() { return createBorderEdgeOptions(idPrefix); } },
		{ kind: 'segmented', label: 'Placement', display: 'select', revert: true, options: [
			{ id: `${idPrefix}PositionOutside`, label: 'Outside', active: true, value: 'outside' },
			{ id: `${idPrefix}PositionCenter`, label: 'On edge', value: 'center' },
			{ id: `${idPrefix}PositionInside`, label: 'Inside', value: 'inside' }
		] },
		{ kind: 'segmented', label: 'Layering', revert: true, options: [
			{ id: `${idPrefix}OrderBehind`, label: 'Behind', active: true, value: 'behind' },
			{ id: `${idPrefix}OrderFront`, label: 'On top', value: 'front' }
		] }
	];
}

function createShadowSectionSpec(idPrefix, { baseline = false } = {}) {
	return { kind: 'paintSlot', slot: 'shadow', idPrefix, title: 'Shadow', presentation: 'flyout',
		toggle: true, texturePosition: true, activeMode: 'glitter',
		color: '#000000', chipTitle: 'Choose shadow glitter',
		sets: [
			{ rows: [{ kind: 'segmented', label: 'Type', revert: true, options: getOptions('shadowKind').map(({ value, label, suffix }) => ({ id: `${idPrefix}${suffix}`, value, label, active: value === 'drop' })) }] },
			{ rows: [
				...(baseline ? [{ kind: 'segmented', label: 'Anchor', rowId: `${idPrefix}CastAnchorRow`, hidden: true, revert: true, options: getOptions('shadowCastAnchor').map(({ value, label }) => ({ id: `${idPrefix}CastAnchor${sentenceCaseOption(value)}`, value, label, active: value === 'baseline' })) }] : []),
				{ kind: 'slider', id: `${idPrefix}CastLength`, slider: baseline ? 'textCastLength' : 'shadowCastLength', hidden: true },
				{ kind: 'slider', id: `${idPrefix}CastLean`, slider: baseline ? 'textCastLean' : 'shadowCastLean', hidden: true },
				...(baseline ? [{ kind: 'slider', id: `${idPrefix}CastBlur`, slider: 'textCastBlur', hidden: true }] : [])
			] },
			{ label: 'Offset', rows: [
				{ kind: 'slider', id: `${idPrefix}OffsetX`, slider: 'shadowOffsetX' },
				{ kind: 'slider', id: `${idPrefix}OffsetY`, slider: 'shadowOffsetY' }
			] },
			{ label: 'Softness', rows: [
				{ kind: 'slider', id: `${idPrefix}Spread`, slider: 'shadowSpread' },
				{ kind: 'slider', id: `${idPrefix}Blur`, slider: 'shadowBlur', title: 'Softens the edge. With no offset, a soft glow.' }
			] }
		]
	};
}

function createAnimationSectionSpec(prefix) {
	const id = (suffix) => `${prefix}Anim${suffix}`;
	const sliders = (keys, hidden = false) => GlitterAnimation.ANIMATION_CONTROLS.filter((control) => keys.includes(control.key))
		.map((control) => ({ kind: 'slider', id: id(control.suffix), slider: control.field, rowId: id(`${control.suffix}Row`), hidden }));
	return {
		// Toggle-gated like every effect section: the shared `is-collapsed`
		// accordion (syncPanelEffectToggle) hides the whole body.
		kind: 'section', title: 'Animation', badge: 'beta', classes: 'animation-module', presentation: 'flyout',
		summary: { id: id('Summary'), text: 'Off' },
		toggle: { id: id('Enabled'), label: '', title: 'Enable animation' },
		sets: [
			{ rows: [
				{ kind: 'host', id: id('Stack'), classes: 'segmented-control animation-stack', attrs: { hidden: 'hidden' } },
				{ kind: 'select', id: id('Type'), label: 'Preset', ariaLabel: 'Animation type', options: ANIMATION_PRESET_OPTIONS,
					stepper: {
						prev: { id: id('PresetPrev'), label: 'Previous preset', icon: 'chevron-left', title: 'Previous preset' },
						next: { id: id('PresetNext'), label: 'Next preset', icon: 'chevron-right', title: 'Next preset' }
					} },
				{ kind: 'note', id: id('LoopHint'), classes: 'animation-loop-hint' }
			] },
			{ label: 'Movement', rows: [
				...GlitterAnimation.ANIMATION_CONTROLS.filter((control) => control.field && !['gap', 'delayMs', 'phase', 'anchorX', 'anchorY'].includes(control.key))
					.map((control) => ({ kind: 'slider', id: id(control.suffix), slider: control.field, rowId: id(`${control.suffix}Row`) })),
				{ kind: 'select', id: id('Repeat'), label: 'Repeat', rowId: id('RepeatRow'), hidden: true,
					hint: 'None leaves the canvas before it returns. Wrap enters the opposite edge as it leaves. Tile fills the canvas with copies.',
					options: [{ value: 'none', label: 'None' }, { value: 'wrap', label: 'Wrap' }, { value: 'tile', label: 'Tile' }] },
				...sliders(['gap'], true)
			] }
		],
		advancedId: id('Advanced'),
		advanced: [
			{ label: 'Timing', rows: [
				{ kind: 'select', id: id('Easing'), label: 'Easing', options: [
					{ value: 'linear', label: 'Linear' }, { value: 'ease', label: 'Ease' }, { value: 'easeIn', label: 'Ease in' },
					{ value: 'easeOut', label: 'Ease out' }, { value: 'easeInOut', label: 'Ease in-out' },
					{ value: 'bounceOut', label: 'Bounce out' }, { value: 'elasticOut', label: 'Elastic out' }, { value: 'steps', label: 'Steps' }
				] },
				{ kind: 'field', id: id('Steps'), type: 'number', label: 'Steps', ...FIELDS.animSteps, rowId: id('StepsRow') },
				{ kind: 'select', id: id('Direction'), label: 'Direction', options: [
					{ value: 'normal', label: 'Normal' }, { value: 'reverse', label: 'Reverse' },
					{ value: 'alternate', label: 'Alternate' }, { value: 'alternate-reverse', label: 'Alternate reverse' }
				] },
				{ kind: 'select', id: id('Iterations'), label: 'Iterations', options: [
					{ value: 'Infinity', label: '∞' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '5', label: '5' }, { value: '10', label: '10' }
				] }
			] },
			{ label: 'Start', rows: [
				...sliders(['delayMs', 'phase']),
				{ kind: 'select', id: id('FillMode'), label: 'Fill', ariaLabel: 'Fill mode',
					hint: 'Whether the layer holds its start pose before a delay, and its end pose after a limited number of iterations finishes. Has no effect with no delay and infinite iterations.',
					options: [
						{ value: 'none', label: 'None' }, { value: 'forwards', label: 'Forwards' },
						{ value: 'backwards', label: 'Backwards' }, { value: 'both', label: 'Both' }
					] }
			] },
			{ label: 'Pivot', rows: [
				{ kind: 'select', id: id('Anchor'), label: 'Anchor', options: ANCHOR_SELECT_OPTIONS },
				{ kind: 'note', id: id('AnchorNote'), classes: 'animation-anchor-note' },
				...sliders(['anchorX', 'anchorY'], true),
				{ kind: 'select', id: id('SnapMode'), label: 'Motion', ariaLabel: 'Motion sampling', options: [
					{ value: 'smooth', label: 'Smooth' }, { value: 'pixel-snap', label: 'Pixel snap' }, { value: 'step', label: 'Step' }
				] }
			] },
			{ classes: 'animation-stack-actions', actions: [
				{ id: id('Add'), label: 'Add animation', icon: 'plus' },
				{ id: id('Remove'), label: 'Remove', icon: 'trash' }
			] }
		]
	};
}

const PANEL_SCHEMAS = {
	glitterRecolor: {
		prefix: 'recolor', section: { id: 'glitterRecolorSettings', bare: true },
		groups: [
			{ title: 'Name', sections: [{ kind: 'section', sets: [{ rows: [{ kind: 'field', id: 'recolorName', label: 'Name', maxlength: 100, revert: true }, { kind: 'host', id: 'recolorCredit' }] }] }] },
			{ title: 'Colors', sections: [{ kind: 'section', sets: [{ rows: [
				{ kind: 'host', id: 'recolorSwatches' }
			] }] }] },
			{ title: 'Adjust all', sections: [{ kind: 'section', sets: [
				{ rows: [{ kind: 'field', type: 'color', id: 'recolorAll', label: 'All colors' }, { kind: 'note', text: 'Set the main color and shift the other hues with it.' }] },
				{ rows: ['Hue', 'Saturation', 'Lightness', 'Contrast'].map(axis => ({ kind: 'slider', id: `recolor${axis}`, slider: `recolor${axis}` })) },
				{ id: 'recolorPending', classes: 'is-split', actions: [{ id: 'recolorCancelAdjust', label: 'Cancel' }, { id: 'recolorApplyAdjust', label: 'Apply', primary: true }] }
			] }] }
		]
	},
	// The "nothing selected" panel (`section.bare`) carries two mutually
	// exclusive `.settings-subsection` blocks: what can be added, shown above
	// Canvas Properties, and the multi-selection groups. syncNoLayerPanelState
	// toggles #noLayerDefaultGroups vs #multiLayerSelectionGroup by id.
	noSelection: {
		prefix: 'noLayer',
		section: { id: 'noLayerSettingsSection', bare: true },
		preamble: [
			{ kind: 'host', tag: 'span', id: 'noLayerEmptyText', text: 'Nothing selected', attrs: { hidden: 'hidden' } },
			{ kind: 'note', id: 'noLayerEmptySubtext', classes: 'no-selection-intro',
				text: 'Pick a layer to edit it, or add content below.' }
		],
		subsections: [
			{ id: 'noLayerDefaultGroups', groups: [
				{ title: 'Add', sections: [
					{ kind: 'section', title: 'Quick add', chips: 'buttons', sets: [
						{ rows: [{ kind: 'host', id: 'quickAddOptions', classes: 'layer-type-options quick-add' }] }
					] },
					// The project (name, save, open) is in the app header; document
					// sizing belongs to Canvas Properties.
				] }
			] },
			{ id: 'multiLayerSelectionGroup', hidden: true, groups: [
				{ title: 'Appearance', sections: [
					{ kind: 'section', title: 'Layers', sets: [
						{ rows: [{ kind: 'slider', id: 'multiSelectionOpacity', slider: 'multiSelectionOpacity', label: 'Opacity' }] }
					] }
				] },
				{ title: 'Layout', sections: [
					{ kind: 'section', title: 'Align', sets: [
						{ rows: [
							{ kind: 'segmented', id: 'multiSelectionAlignScope', label: 'Align to', ariaLabel: 'Alignment reference', options: [
								{ label: 'Selection', active: true, attrs: { 'data-scope': 'selection' } },
								{ label: 'Canvas', attrs: { 'data-scope': 'canvas' } }
							] }
						] },
						{ label: 'Align', rows: [
							{ kind: 'segmented', label: 'Horizontal', ariaLabel: 'Align horizontally', options: [
								{ icon: 'align-left', label: 'Align left', attrs: { 'data-multi-align': 'left' } },
								{ icon: 'align-center-x', label: 'Align horizontal centers', attrs: { 'data-multi-align': 'centerX' } },
								{ icon: 'align-right', label: 'Align right', attrs: { 'data-multi-align': 'right' } }
							] },
							{ kind: 'segmented', label: 'Vertical', ariaLabel: 'Align vertically', options: [
								{ icon: 'align-top', label: 'Align top', attrs: { 'data-multi-align': 'top' } },
								{ icon: 'align-center-y', label: 'Align vertical centers', attrs: { 'data-multi-align': 'centerY' } },
								{ icon: 'align-bottom', label: 'Align bottom', attrs: { 'data-multi-align': 'bottom' } }
							] },
							{ kind: 'segmented', label: 'Distribute', ariaLabel: 'Distribute selected layers', options: [
								{ icon: 'distribute-x', label: 'Distribute horizontally', attrs: { 'data-multi-distribute': 'horizontal' } },
								{ icon: 'distribute-y', label: 'Distribute vertically', attrs: { 'data-multi-distribute': 'vertical' } }
							] }
						] }
					] }
				] },
				{ title: 'Actions', role: 'actions', actions: [
					{ classes: 'multi-selection-actions', actions: [
						{ id: 'multiSelectionDuplicateBtn', label: 'Duplicate' },
						{ id: 'multiSelectionDeleteBtn', label: 'Delete' }
					] }
				] }
			] }
		]
	},
	// A tool panel: its middle group is its own (Colors), between the sticky
	// preview band and the sticky Create / Cancel band.
	autoGlitterSession: {
		prefix: 'autoGlitter',
		sectionPrefix: 'autoGlitterSettings',
		section: { id: 'autoGlitterSettingsSection', icon: 'magic-wand', tab: 'Auto Glitter', title: 'Auto Glitter', badge: 'beta' },
		groups: [
			{ title: 'Preview', region: 'header', sections: [
				{ kind: 'section', classes: 'auto-glitter-preview-card', sets: [
					{ rows: [
						{ kind: 'segmented', id: 'autoGlitterPreviewMode', ariaLabel: 'Preview mode', options: [
							{ label: 'Original', value: 'original' }, { label: 'Flat', value: 'flat' }, { label: 'Glitter', value: 'glitter', active: true }
						] }
					] }
				] },
				{ kind: 'section', id: 'autoGlitterExisting', classes: 'auto-glitter-existing', hidden: true, sets: [
					{ rows: [
						{ kind: 'note', id: 'autoGlitterExistingSummary' },
						{ kind: 'radioSegmented', id: 'autoGlitterRerunMode', classes: 'auto-glitter-rerun-mode', ariaLabel: 'How to handle the previous Auto Glitter layers', options: [
							{ id: 'autoGlitterEditCurrent', label: 'Edit', value: 'edit' },
							{ id: 'autoGlitterReplacePrevious', label: 'Replace', value: 'replace' },
							{ id: 'autoGlitterAddAnother', label: 'Add', value: 'add' }
						] }
					] }
				] }
			] },
			{ title: 'Colors', region: 'scroll', sections: [
				{ kind: 'section', title: 'Palette', sets: [
					{ rows: [
						...createPaletteControlRows('autoGlitter', {
							styleDefault: CONFIG.tools.autoGlitter.defaults.paletteStyle,
							styleClasses: 'auto-glitter-palette-style',
							mergeLabel: 'Merge',
							styleTitles: {
								natural: 'Preserve the image\'s color balance without boosting saturation',
								balanced: 'Gently favor colorful regions and boost glitter saturation',
								vibrant: 'Prioritize colorful accents and strongly boost glitter saturation'
							}
						}),
						{ kind: 'note', text: 'Natural follows the image; Balanced and Vibrant progressively emphasize color.' },
						{ kind: 'note', id: 'autoGlitterCapacity' }
					] }
				], advanced: [
					{ label: 'Regions', rows: [
						{ kind: 'slider', id: 'autoGlitterDetail', slider: 'paletteDetail', label: 'Detail', title: 'Absorb connected regions smaller than this many pixels' },
						{ kind: 'toggle', id: 'autoGlitterCleanEdges', label: 'Clean edges', checked: true, revert: true, title: 'Absorb anti-aliased blend colors into their neighboring regions' },
						{ kind: 'toggle', id: 'autoGlitterTuneHue', label: 'Tune matched glitter hue', checked: true, revert: true, title: 'Apply a small hue correction to improve the closest glitter match' }
					] }
				] },
				{ kind: 'section', title: 'Color matches', classes: 'auto-glitter-review', sets: [
					{ rows: [
						{ kind: 'note', id: 'autoGlitterStatus', attrs: { role: 'status', 'aria-live': 'polite' }, text: 'Finding the image\'s distinct colors…' },
						{ kind: 'host', id: 'autoGlitterResults', classes: 'property-inset property-list auto-glitter-results', attrs: { 'aria-label': 'Detected color regions and glitter matches' } }
					] }
				] }
			] },
			{ title: 'Actions', role: 'actions', region: 'footer', actions: [
				{ classes: 'auto-glitter-actions is-split', actions: [
					{ id: 'cancelAutoGlitterBtn', label: 'Cancel' },
					{ id: 'autoGlitterCreateBtn', label: 'Create layers', primary: true }
				] }
			] }
		]
	},
	[LayerType.FILTER]: {
		prefix: 'filter',
		sectionPrefix: 'filterSettings',
		section: { id: 'filterSettingsSection', icon: 'sliders', tab: 'Filter', title: 'Filter Properties' },
		groups: [
			{ title: 'Content', sections: [
				{ kind: 'section', title: 'Looks', sets: [
					{ rows: [
						{ kind: 'select', id: 'filterLooksGroup', label: 'Category', ariaLabel: 'Filter look category', options: [] }
					] },
					{ rows: [
						{ kind: 'presetGrid', id: 'filterLooksPicker', label: 'Filter looks', classes: 'property-inset filter-looks-picker' }
					] },
					{ rows: [
						{ kind: 'assetInfo', info: 'filterCurrentLookInfo', thumbnail: 'filterCurrentLookThumbnail',
							name: 'filterCurrentLookName', badges: 'filterCurrentLookBadges', change: 'filterCurrentLookShow',
							changeLabel: 'Show', title: 'Show the current look in the library', compact: true, hidden: true }
					] },
					// The chosen look's own settings: FilterLayerManager writes the
					// label and fills the rows.
					{ id: 'filterCustomize', label: { id: 'filterCustomizeTitle' }, rows: [] },
					{ rows: [
						{ kind: 'note', id: 'filterSnapshotStatus', hidden: true, attrs: { role: 'status', 'aria-live': 'polite' } }
					] },
					{ id: 'filterSnapshotActions', hidden: true, actions: [
						{ id: 'filterRenderPreview', label: 'Preview animation' }
					] }
				] }
			] },
			{ title: 'Appearance', sections: [
				createLayerSectionSpec('filterLayerOpacity', 'filterLayerBlendMode')
			] }
		]
	},
	[LayerType.FRAME]: {
		prefix: 'frame',
		sectionPrefix: 'frameSettings',
		section: { id: 'frameSettingsSection', icon: 'frame', tab: 'Frame', title: 'Frame Properties' },
		groups: [
			{ title: 'Content', sections: [
				// Both kinds share one shape: Kind, then a grid of choices, then
				// that kind's options.
				{ kind: 'section', title: 'Frame', summary: { id: 'frameContentSummary' }, sets: [
					{ rows: [
						{ kind: 'segmented', label: 'Kind', get options() { return createRegistryOptionEntries('frameKind', 'frameKind'); } }
					] },
					{ label: 'Presets', collapse: 'open', attrs: { 'data-frame-kind': 'style' }, rows: [
						{ kind: 'presetGrid', id: 'framePresets', label: 'Frame presets', classes: 'property-inset frame-presets' }
					] },
					{ label: 'Customize', attrs: { 'data-frame-kind': 'style' }, rows: [
						{ kind: 'segmented', label: 'Style', display: 'select', get options() { return createRegistryOptionEntries('frameStyle', 'frameStyle'); } },
						{ kind: 'slider', id: 'frameShade', slider: 'frameShade', rowId: 'frameShadeRow', title: 'How much lighter and darker the bevel sides are' }
					] },
					{ label: 'Frames', attrs: { 'data-frame-kind': 'image', hidden: 'hidden' }, rows: [
						{ kind: 'presetGrid', id: 'frameImagePicker', label: 'Frame images', classes: 'property-inset frame-images' },
						{ kind: 'assetInfo', info: 'frameImageInfo', thumbnail: 'frameImageThumbnail', name: 'frameImageName', badges: 'frameImageBadges', change: 'frameImageChange', compact: true, hidden: true, title: 'Choose another frame image' }
					] },
					{ attrs: { 'data-frame-kind': 'image', hidden: 'hidden' }, rows: [
						{ kind: 'segmented', label: 'Fit', get options() { return createRegistryOptionEntries('frameFit', 'frameFit'); } }
					] },
					// Fit to canvas leads the set: it decides whether the sizes
					// under it follow the canvas or the frame's own box.
					{ label: 'Size', rows: [
						{ kind: 'toggle', id: 'framePinned', label: 'Fit to canvas', title: 'Follow the canvas edges. Turn off to move and resize the frame freely.' },
						{ kind: 'slider', id: 'frameThickness', slider: 'frameThickness', rowId: 'frameThicknessRow' },
						{ kind: 'slider', id: 'frameSliceScale', slider: 'frameSliceScale', rowId: 'frameSliceScaleRow' },
						{ kind: 'slider', id: 'frameRadius', slider: 'frameRadius', rowId: 'frameRadiusRow' },
						{ kind: 'slider', id: 'frameInset', slider: 'frameInset', rowId: 'frameInsetRow' }
					] }
				] }
			] },
			{ title: 'Appearance', sections: [
				createLayerSectionSpec('frameLayerOpacity', 'frameLayerBlendMode'),
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'frameFill', title: 'Fill', presentation: 'flyout',
					texturePosition: true,
					activeMode: 'glitter',
					color: CONFIG.tools.frames.defaults.color, chipTitle: 'Choose frame glitter' }
			] },
			{ title: 'Layout', sections: [{ kind: 'transform' }] }
		],
		effects: [createSparklesSectionSpec('frameSparkles')]
	},
	[LayerType.SPARKLES]: {
		prefix: 'sparkleLayer',
		sectionPrefix: 'sparkleLayerSettings',
		section: { id: 'sparkleLayerSettingsSection', icon: 'sparkles', tab: 'Sparkles', title: 'Sparkles Properties' },
		groups: [
			{ title: 'Content', sections: [
				createSparklesSectionSpec('layerSparkles', { toggle: false, presentation: null })
			] },
			{ title: 'Appearance', sections: [
				createLayerSectionSpec('sparkleLayerOpacity', 'sparkleLayerBlendMode')
			] }
		]
	},
	[LayerType.BASE_IMAGE]: {
		prefix: 'baseBackground',
		sectionPrefix: 'baseLayerSettings',
		section: { id: 'baseLayerSettingsSection', icon: 'paint-bucket', tab: 'Canvas', title: 'Canvas Properties' },
		groups: [
			{ title: 'Appearance', sections: [
				// The canvas layer is a single paint; its only opacity is the
				// whole-layer opacity.
				createLayerSectionSpec('baseBackgroundOpacity'),
				{ kind: 'paintSlot', slot: 'background', idPrefix: 'baseBackground', title: 'Background', presentation: 'flyout',
					texturePosition: true, noSlotOpacity: true,
					activeMode: 'image', color: '#ffffff',
					hidePrimaryModes: ['image'],
					chipTitle: 'Choose background glitter',
					imageAsset: {
						info: 'baseBackgroundImageInfo', thumbnail: 'baseBackgroundImageThumbnail',
						name: 'baseBackgroundImageName', badges: 'baseBackgroundImageBadges',
						change: 'baseBackgroundImageChange', title: 'Replace base image', compact: true
					}
				}
			] },
			{ title: 'Layout', sections: [
				{ kind: 'mount', id: 'baseCanvasSizeHost' }
			] },
			{ title: 'Actions', role: 'actions',
				note: 'Turn the image colors into editable glitter fill layers.',
				actions: [{ actions: [
					{ id: 'autoGlitterImageBtn', label: 'Auto Glitter', icon: 'magic-wand', badge: 'beta', primary: true, title: 'Turn the image colors into editable glitter fill layers' }
				] }] }
		],
		effects: [createSparklesSectionSpec('canvasSparkles')]
	},
	// A tool panel: it opens with what the tool uses (the tip), its middle
	// group is its own (Stroke), and it ends with Actions.
	brush: {
		prefix: 'brush',
		sectionPrefix: 'brushSettings',
		section: { id: 'brushSettingsSection', icon: 'brush', tab: 'Mask', title: 'Mask Settings' },
		groups: [
			{ title: 'Content', sections: [
				{ kind: 'section', title: 'Tip', summary: 'asset', sets: [
					{ rows: [
						{ kind: 'assetInfo', info: 'brushTipInfo', thumbnail: 'brushTipThumbnail',
							name: 'brushTipName', badges: 'brushTipBadges', change: 'brushTipChange',
							title: 'Choose another brush tip', compact: true },
						{ kind: 'toggle', id: 'brushAntialiasToggle', label: 'Antialias edges',
							title: 'Smooth the edges of mask strokes. Off gives crisp pixel edges; a shared setting with text and shapes.' },
						{ kind: 'note', id: 'brushAntialiasNote', hidden: true }
					] }
				] }
			] },
			{ title: 'Stroke', sections: [
				{ kind: 'section', title: 'Dynamics', sets: [
					{ label: 'Tip', rows: [
						{ kind: 'slider', id: 'maskBrushSize', slider: 'maskBrushSize' },
						{ kind: 'slider', id: 'maskBrushSoftness', slider: 'maskBrushSoftness' },
						{ kind: 'slider', id: 'maskBrushFlow', slider: 'maskBrushFlow' }
					] },
					{ label: 'Path', rows: [
						{ kind: 'slider', id: 'maskBrushSpacing', slider: 'maskBrushSpacing', title: 'Distance between stamps along a stroke, as a percentage of brush size. Higher values create more space.' },
						{ kind: 'slider', id: 'maskBrushSmoothing', slider: 'maskBrushSmoothing', title: 'Stabilizes shaky strokes by easing the brush toward the cursor. Higher values are smoother but add lag.' },
						{ kind: 'toggle', id: 'maskBrushPressure', label: 'Pressure sensitivity', title: 'Vary flow with pen pressure (no effect on mouse/touch)', checked: true }
					] }
				] },
				{ kind: 'section', title: 'Scatter & jitter', sets: [
					{ rows: [{ kind: 'host', id: 'brushDynamicsHost', classes: 'brush-dynamics' }] }
				] }
			] },
			{ title: 'Actions', role: 'actions',
				note: 'Brush and Eraser keep separate tip and stroke settings. The copy and reset labels follow the active tool.',
				actions: [{ actions: [
					{ id: 'maskCopyOppositeSettings', label: 'Copy eraser settings', title: 'Copy the other tool\'s settings into this one' },
					{ id: 'maskResetCurrentSettings', label: 'Reset brush', title: 'Restore this tool\'s settings to their defaults' },
					{ id: 'clearMaskPaint', label: 'Clear paint', title: 'Remove all painted strokes (color selections stay)' }
				] }] }
		]
	},
	[LayerType.GLITTER_FILL]: {
		prefix: 'glitter',
		sectionPrefix: 'glitterSettings',
		section: { id: 'glitterSettingsSection', icon: 'glitter', tab: 'Fill', title: 'Fill Properties' },
		controls: { id: 'glitterSettingsControls', emptyId: 'glitterSettingsEmpty', empty: { icon: 'glitter', text: 'Select a glitter fill from the gallery to get started.' } },
		groups: [
			{ title: 'Content', sections: [
				{ kind: 'section', title: 'Mask', classes: 'fill-mask-summary', sets: [
					{ rows: [
						{ kind: 'note', text: 'Pick the colors glitter covers with the Glitter Fill tool, or paint the mask with the Glitter Brush and Eraser.' }
					] },
					{ classes: 'is-split', actions: [
						{ id: 'fillMaskPickColors', label: 'Pick colors', title: 'Switch to the Glitter Fill tool' },
						{ id: 'fillMaskPaint', label: 'Paint mask', title: 'Switch to the Glitter Brush' }
					] }
				] }
			] },
			{ title: 'Appearance', sections: [
				// A Fill layer is a single masked paint, so its only opacity is the
				// whole-layer opacity.
				createLayerSectionSpec('opacity', 'glitterLayerBlendMode'),
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'glitterFill', title: 'Fill', presentation: 'flyout',
					texturePosition: true, noSlotOpacity: true,
					activeMode: 'glitter', color: '#ff4fa3',
					chipTitle: 'Choose fill glitter',

				}
			] },
			{ title: 'Layout', sections: [{ kind: 'transform' }] }
		],
		effects: [
			createOutlineSectionSpec('glitterBorder',
				[{ kind: 'slider', id: 'glitterBorderWidth', slider: 'borderWidth' }],
				[
					...createOutlinePlacementRows('glitterBorder'),
					{ kind: 'toggle', id: 'glitterBorderFillEnclosed', label: 'Fill enclosed areas', title: 'Fill transparent areas completely enclosed by the fill mask' }
				]),
			createShadowSectionSpec('glitterShadow'),
			createSparklesSectionSpec('glitterSparkles')
		],
		effectsReset: { id: 'resetGlitterEffects', title: 'Disable all fill effects and clear their saved settings' },
		motion: [createAnimationSectionSpec('glitter')],
		// A tool panel (Glitter Fill): its group is its own (Selection).
		auxiliarySections: [{
			prefix: 'layer',
			sectionPrefix: 'layerSettings',
			section: { id: 'layerSettingsSection', icon: 'paint-bucket', tab: 'Selection', title: 'Glitter Fill Settings' },
			controls: {
				id: 'layerSettingsControls', emptyId: 'layerSettingsEmpty',
				empty: { icon: 'paint-bucket', titleId: 'layerSettingsEmptyText', title: 'No layer selected', textId: 'layerSettingsEmptySubtext', text: '' }
			},
			groups: [
				{ title: 'Selection', sections: [
					{ kind: 'section', title: 'Options', sets: [
						{ rows: [
							{ kind: 'toggle', id: 'contiguous', label: 'Contiguous', title: 'Select only connected pixels of the same color' },
							{ kind: 'toggle', id: 'invert', label: 'Invert', title: "Invert this layer's mask — glitter covers everything except the selected and painted areas" },
							{ kind: 'toggle', id: 'multiSelect', label: 'Multi-select', title: 'Select multiple colors on the same layer' }
						] }
					] },
					{ kind: 'section', title: 'Color selections', classes: 'color-selection', sets: [
						{ rows: [
							{ kind: 'host', id: 'selectedColorsDisplay', classes: 'selected-colors-display' },
							{ kind: 'note', id: 'selectedColorsEmptyNote', classes: 'color-selection-empty-note', text: 'Pick a color on the canvas to add it.' }
						] }
					] },
					{ kind: 'section', title: 'Refine', sets: [
						{ rows: [
							{ kind: 'slider', id: 'threshold', slider: 'threshold' },
							{ kind: 'slider', id: 'feather', slider: 'feather' },
							{ kind: 'note', id: 'selectionRefineNote', text: 'Color tolerance includes colors similar to the one you picked. Edge feather softens the selection boundary.' }
						] }
					] }
				] }
			]
		}]
	},
	[LayerType.STICKER]: {
		prefix: 'sticker',
		sectionPrefix: 'stickerSettings',
		section: { id: 'stickerSettingsSection', icon: 'sticker', tab: 'Sticker', title: 'Sticker Properties' },
		controls: { id: 'stickerSettingsControls', emptyId: 'stickerSettingsEmpty', empty: { icon: 'sticker', text: 'Select a sticker to edit its properties.' } },
		groups: [
			{ title: 'Content', sections: [
				{ kind: 'section', title: 'Asset', summary: 'asset', classes: 'sticker-asset-module', sets: [
					{ rows: [
						{ kind: 'assetInfo', info: 'stickerAssetInfo', thumbnail: 'stickerAssetThumbnail',
							name: 'stickerAssetName', badges: 'stickerAssetBadges', change: 'stickerAssetChange',
							size: 'stickerAssetSize', frames: 'stickerAssetFrames', title: 'Choose another sticker' },
						{ kind: 'toggle', id: 'stickerSliceEnabled', label: 'Smart stretch', checked: true }
					] },
					{ actions: [{ id: 'stickerRemoveBackground', label: 'Remove background', icon: 'eraser' }] }
				], advanced: [
					{ label: 'Color adjust', classes: 'advanced-color-adjust-group', rows: [
						{ kind: 'slider', id: 'stickerHue', slider: 'hue' },
						{ kind: 'slider', id: 'stickerSaturation', slider: 'saturation' },
						{ kind: 'slider', id: 'stickerBrightness', slider: 'brightness' }
					] }
				] }
			] },
			{ title: 'Appearance', sections: [
				createStylePresetSectionSpec('sticker'),
				createLayerSectionSpec('stickerLayerOpacity', 'stickerLayerBlendMode')
			] },
			{ title: 'Layout', sections: [{ kind: 'transform' }] }
		],
		effects: [
			// Stickers have no Placement or Layering choice, so the Placement set
			// holds the fill switches.
			createOutlineSectionSpec('stickerBorder',
				[{ kind: 'slider', id: 'stickerBorderWidth', slider: 'stickerOutlineWidth' }],
				[
					{ kind: 'segmented', label: 'Edges', revert: true, get options() { return createBorderEdgeOptions('stickerBorder'); } },
					{ kind: 'toggle', id: 'stickerBorderFillEnclosed', label: 'Fill enclosed areas', title: 'Fill transparent areas that are completely enclosed by the sticker silhouette' },
					{ kind: 'toggle', id: 'stickerBorderFillInterior', label: 'Backing plate', checked: true, title: 'Extend the outline paint behind the full sticker as a solid backing' },
					{ kind: 'toggle', id: 'stickerBorderUnionFrames', label: 'Use all animation frames', checked: true, title: 'Build one stable outline from the union of every GIF frame' }
				]),
			createShadowSectionSpec('stickerShadow'),
			...createBevelSectionSpecs('stickerBevel'),
			createSparklesSectionSpec('stickerSparkles')
		],
		effectsReset: { id: 'resetStickerEffects', title: 'Disable all sticker effects and clear their saved settings' },
		motion: [createAnimationSectionSpec('sticker')]
	},
	[LayerType.TEXT_GLITTER]: {
		prefix: 'text',
		sectionPrefix: 'textSettings',
		section: { id: 'textSettingsSection', icon: 'text', tab: 'Text', title: 'Text Properties' },
		groups: [
			// Type it, choose the face, set the metrics, then place it.
			{ title: 'Content', sections: [
				{ kind: 'section', title: 'Text', sets: [
					{ rows: [
						{ kind: 'textarea', id: 'textLayerInput', classes: 'text-input-group', rows: 4, maxlength: CONFIG.tools.text.maxTextLength, placeholder: 'Type your glitter text' },
						// One click inserts at the caret; the manager fills it from
						// CONFIG.tools.text.symbols.
						{ kind: 'host', id: 'textSymbols', classes: 'property-inset text-symbol-grid', attrs: { role: 'group', 'aria-label': 'Insert a symbol' } }
					] },
					{ classes: 'text-actions-group', actions: [
						{ id: 'textSplit', label: 'Split text', title: 'Split into characters, words or lines', menu: true },
						...(CONFIG.debug.enabled ? [{ id: 'textCopyStyleAsPreset', label: 'Copy style as preset', title: 'Copy the current style for the preset registry' }] : []),
						{ id: 'textFitBoxToContent', label: 'Fit box to text', title: 'Resize the box to exactly fit the current text (keeps existing line breaks/wraps)' }
					] }
				] },
				// Everything about how the letters are set, in one section: the
				// face, its metrics, then how lines sit in the box.
				{ kind: 'section', title: 'Type', summary: 'asset', classes: 'text-font-module', sets: [
					{ rows: [
						// The current font; Change opens the Library's Fonts.
						{ kind: 'assetInfo', info: 'textFontInfo', thumbnail: 'textFontThumbnail',
							name: 'textFontName', badges: 'textFontBadges', change: 'textFontChange',
							title: 'Choose another font', compact: true },
						{ kind: 'slider', id: 'textFontSize', slider: 'textFontSize', label: 'Size' },
						// One letter each, styled as what it applies, so four
						// options fit the row.
						{ kind: 'segmented', label: 'Style', ariaLabel: 'Text style', classes: 'text-style-group', revert: true, options: [
							{ id: 'textFontBold', label: 'Bold', text: 'B', contentTag: 'strong' },
							{ id: 'textFontItalic', label: 'Italic', text: 'I', contentTag: 'em' },
							{ id: 'textUnderline', label: 'Underline', text: 'U', contentTag: 'u' },
							{ id: 'textStrikethrough', label: 'Strikethrough', text: 'S', contentTag: 's' }
						] },
						{ kind: 'segmented', label: 'Align', ariaLabel: 'Horizontal text alignment', classes: 'text-align-group', options: getOptions('textAlign').map(option => ({ label: option.label, icon: option.icon, attrs: { 'data-text-align': option.value } })) }
					] }
				],
				// Set once for a piece of text and then left alone.
				advanced: [
					{ label: 'Letters', rows: [
						{ kind: 'select', id: 'textCaseSelect', label: 'Case', ariaLabel: 'Text case', classes: 'text-case-select', revert: true, options: getOptions('textCase') },
						{ kind: 'toggle', id: 'textColorEmoji', label: 'Color emoji', checked: CONFIG.tools.text.defaultColorEmoji, revert: true, title: 'Keep system emoji colors instead of filling emoji like letters' }
					] },
					{ label: 'Spacing', rows: [
						{ kind: 'slider', id: 'textLetterSpacing', slider: 'textLetterSpacing', label: 'Letter' },
						{ kind: 'slider', id: 'textLineHeight', slider: 'textLineHeight', label: 'Line', classes: 'text-line-height-row' }
					] },
					{ label: 'Box', rows: [
						{ kind: 'segmented', label: 'Orientation', ariaLabel: 'Text orientation', options: getOptions('textOrientation').map(option => ({ label: option.label, attrs: { 'data-text-orientation': option.value } })) },
						{ kind: 'segmented', label: 'Mode', ariaLabel: 'Text box mode', classes: 'text-box-mode-group', stacked: true, revert: true, options: getOptions('textBoxMode').map(option => ({ label: option.label, attrs: { 'data-text-box-mode': option.value } })) },
						{ kind: 'note', id: 'textBoxModeHint', text: 'Point text hugs the copy. Switch to Box for wrapping and edge resizing.' },
						{ kind: 'segmented', label: 'Vertical', ariaLabel: 'Vertical text alignment', classes: 'text-valign-group', rowClasses: 'text-valign-row', options: getOptions('textVerticalAlign').map(option => ({ label: option.label, icon: option.icon, attrs: { 'data-text-valign': option.value } })) }
					] }
				] },
				// Warp bends glyph placement (js/paint/text-warp.js): presets first,
				// Bend tunes the chosen one. Collapsed by default with the warp's
				// name in the header.
				{ kind: 'section', title: 'Warp', collapsed: true, presentation: 'flyout',
					summary: { id: 'textWarpSummary' }, sets: [
					{ rows: [
						{ kind: 'presetGrid', id: 'textWarpPresets', label: 'Text warp presets', classes: 'property-inset text-warp-presets' },
						{ kind: 'slider', id: 'textWarpBend', slider: 'textWarpBend', rowId: 'textWarpBendRow', title: 'How strongly the text bends. Negative values bend the other way.' }
					] }
				] }
			] },
			{ title: 'Appearance', sections: [
				createStylePresetSectionSpec('text'),
				createLayerSectionSpec('textLayerOpacity', 'textLayerBlendMode'),
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'textFill', title: 'Fill', presentation: 'flyout',
					texturePosition: true,
					activeMode: 'glitter', color: '#000000',
					chipTitle: 'Choose fill glitter'
				}
			] },
			{ title: 'Layout', sections: [{ kind: 'transform' }] }
		],
		effects: [
			{ kind: 'paintSlot', slot: 'backgroundFill', idPrefix: 'textBackground', title: 'Background', presentation: 'flyout',
				toggle: true, texturePosition: true, activeMode: 'glitter',
				color: '#000000', chipTitle: 'Choose background glitter',
				before: [
					{ rows: [
						{ kind: 'select', id: 'textBackgroundPreset', label: 'Preset', options: TEXT_BACKGROUND_PRESET_OPTIONS }
					] }
				],
				sets: [
					{ label: 'Shape', rows: [
						{ kind: 'numberPair', label: 'Padding', items: [
							{ id: 'textBackgroundPaddingH', slider: 'textBackgroundPaddingH', mark: 'H', label: 'Horizontal padding' },
							{ id: 'textBackgroundPaddingV', slider: 'textBackgroundPaddingV', mark: 'V', label: 'Vertical padding' }
						] },
						{ kind: 'slider', id: 'textBackgroundRadius', slider: 'textBackgroundRadius', title: 'How rounded the background corners are.' }
					] },
					{ label: 'Lines', rows: [
						{ kind: 'segmented', label: 'Mode', revert: true, hint: 'Lines: one shape per text line. Text bounds: one shape around all visible text. Text box: one shape filling the box (box-mode text only).', options: [
							{ id: 'textBackgroundModeLines', label: 'Lines', active: true, value: 'lines' },
							{ id: 'textBackgroundModeBounds', label: 'Text bounds', value: 'text-bounds' },
							{ id: 'textBackgroundModeBox', label: 'Text box', value: 'text-box' }
						] },
						{ kind: 'segmented', label: 'Line connection', stacked: true, revert: true, hint: 'Separate: each line\'s own shape. Merge: nearby lines combine into a stepped shape. Connected: a more permissive merge.', options: [
							{ id: 'textBackgroundConnectionSeparate', label: 'Separate', active: true, value: 'separate' },
							{ id: 'textBackgroundConnectionMerge', label: 'Merge', value: 'merge-adjacent' },
							{ id: 'textBackgroundConnectionConnected', label: 'Connected', value: 'connected' }
						] },
						{ kind: 'numberPair', label: 'Merge', title: 'How close two lines of text need to be before their highlight boxes merge into one shape.', items: [
							{ id: 'textBackgroundMergeDistance', slider: 'textBackgroundMergeDistance', mark: 'D', label: 'Merge distance' },
							{ id: 'textBackgroundSpacing', slider: 'textBackgroundSpacing', mark: 'S', label: 'Spacing sensitivity', title: 'How much tighter/looser-than-normal line spacing shifts the merge threshold.' }
						] }
					] }
				]
			},
			createOutlineSectionSpec('textBorder',
				[{ kind: 'slider', id: 'textBorderWidth', slider: 'textBorderWidth' }],
				[
					...createOutlinePlacementRows('textBorder'),
					{ kind: 'toggle', id: 'textBorderFillEnclosed', label: 'Fill enclosed areas', title: 'Fill transparent areas that are completely enclosed by the text silhouette' }
				]),
			createShadowSectionSpec('textShadow', { baseline: true }),
			...createBevelSectionSpecs('textBevel'),
			createSparklesSectionSpec('textSparkles')
		],
		effectsReset: { id: 'resetTextEffects', title: 'Disable all text effects and clear their saved settings' },
		motion: [createAnimationSectionSpec('text')]
	},
	[LayerType.SHAPE]: {
		prefix: 'shape',
		sectionPrefix: 'shapeSettings',
		section: { id: 'shapeSettingsSection', icon: 'square', tab: 'Shape', title: 'Shape Properties' },
		groups: [
			{ title: 'Content', sections: [
				{ kind: 'section', title: 'Asset', summary: 'asset', classes: 'shape-asset-module', sets: [
					{ rows: [
						{ kind: 'assetInfo', info: 'shapeAssetInfo', thumbnail: 'shapeAssetThumbnail',
							name: 'shapeAssetName', badges: 'shapeAssetBadges', change: 'shapeAssetChange',
							title: 'Choose another shape', compact: true },
						{ kind: 'slider', id: 'shapeRadius', slider: 'shapeRadius', rowId: 'shapeRadiusRow', hidden: true }
					] },
					{ actions: [
						{ id: 'shapeConvertToPath', label: 'Convert to path', icon: 'pen', title: 'Turn this shape into a path whose points you can edit with the Pen' }
					] }
				] }
			] },
			{ title: 'Appearance', sections: [
				createStylePresetSectionSpec('shape'),
				createLayerSectionSpec('shapeLayerOpacity', 'shapeLayerBlendMode'),
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'shapeFill', title: 'Fill', presentation: 'flyout',
					texturePosition: true,
					activeMode: 'solid',
					color: '#ff66cc', chipTitle: 'Choose fill glitter',
					imageAsset: {
						info: 'shapeFillImageInfo', thumbnail: 'shapeFillImageThumbnail',
						name: 'shapeFillImageName', badges: 'shapeFillImageBadges',
						change: 'shapeFillImageChange', title: 'Choose fill image', compact: true
					},
					// The image source's own Advanced sets: `data-paint-source-mode`
					// shows them for that source only.
					advanced: [
						{ id: 'shapeFillImageControls', label: 'Placement', hidden: true, attrs: { 'data-paint-source-mode': 'image' }, rows: [
							{ kind: 'select', id: 'shapeFillImageFit', label: 'Fit', ariaLabel: 'Image fit', options: CONFIG.tools.shapes.imageFill.fitUIOptions },
							{ kind: 'slider', id: 'shapeFillImageScale', slider: 'shapeImageScale' },
							{ kind: 'segmented', label: 'Horizontal', ariaLabel: 'Horizontal image alignment', options: [
								{ label: 'Left', icon: 'align-left', attrs: { 'data-fill-align': '0' } },
								{ label: 'Center', icon: 'align-center-x', active: true, attrs: { 'data-fill-align': '50' } },
								{ label: 'Right', icon: 'align-right', attrs: { 'data-fill-align': '100' } }
							] },
							{ kind: 'segmented', label: 'Vertical', ariaLabel: 'Vertical image alignment', options: [
								{ label: 'Top', icon: 'align-top', attrs: { 'data-fill-valign': '0' } },
								{ label: 'Middle', icon: 'align-center-y', active: true, attrs: { 'data-fill-valign': '50' } },
								{ label: 'Bottom', icon: 'align-bottom', attrs: { 'data-fill-valign': '100' } }
							] },
							{ kind: 'slider', id: 'shapeFillImageOffsetX', slider: 'shapeImageOffsetX' },
							{ kind: 'slider', id: 'shapeFillImageOffsetY', slider: 'shapeImageOffsetY' }
						] },
						{ label: 'Rendering', hidden: true, attrs: { 'data-paint-source-mode': 'image' }, rows: [
							{ kind: 'segmented', label: 'Sampling', ariaLabel: 'Image rendering', options: [
								{ label: 'Smooth', active: true, attrs: { 'data-fill-rendering': 'smooth' } },
								{ label: 'Pixelated', attrs: { 'data-fill-rendering': 'pixelated' } }
							] }
						] }
					] }
			] },
			{ title: 'Layout', sections: [{ kind: 'transform' }] }
		],
		effects: [
			createOutlineSectionSpec('shapeBorder',
				[
					{ kind: 'slider', id: 'shapeBorderWidth', slider: 'borderWidth' },
					{ kind: 'segmented', label: 'Style', options: getOptions('borderStyle').map((option) => ({
						...option,
						id: `shapeBorderStyle${option.value.charAt(0).toUpperCase()}${option.value.slice(1)}`,
						active: option.value === 'solid'
					})) },
					{ kind: 'slider', id: 'shapeBorderDotSpacing', slider: 'borderDotSpacing', rowId: 'shapeBorderDotSpacingRow', hidden: true }
				],
				[
					...createOutlinePlacementRows('shapeBorder'),
					{ kind: 'toggle', id: 'shapeBorderFillEnclosed', label: 'Fill enclosed areas', title: 'Fill transparent areas that are completely enclosed by the shape silhouette' }
				]),
			createShadowSectionSpec('shapeShadow'),
			...createBevelSectionSpecs('shapeBevel'),
			createSparklesSectionSpec('shapeSparkles')
		],
		effectsReset: { id: 'resetShapeEffects', title: 'Disable all shape effects and clear their saved settings' },
		motion: [createAnimationSectionSpec('shape')]
	},
	[LayerType.PATH]: {
		prefix: 'path',
		sectionPrefix: 'pathSettings',
		section: { id: 'pathSettingsSection', icon: 'pen', tab: 'Path', title: 'Path Properties' },
		groups: [
			{ title: 'Content', sections: [
				{ kind: 'section', title: 'Path', summary: { id: 'pathSummary' }, sets: [
					{ label: 'Presets', collapse: 'open', rows: [
						{ kind: 'presetGrid', id: 'pathStrokePresets', label: 'Line presets', classes: 'property-inset stroke-presets' }
					] },
					{ actions: [
						{ id: 'pathEditPoints', label: 'Edit points', icon: 'pen', title: 'Move, add and remove points (Enter, or double-click the path)' },
						{ id: 'pathToggleClosed', label: 'Close path', title: 'Join the last point to the first, or open a closed path' }
					] },
					{ actions: [
						{ id: 'pathReverse', label: 'Reverse', title: 'Swap the start and end of the path' },
						{ id: 'pathSwapEnds', label: 'Swap ends', title: 'Swap the shapes on the start and end of the line' }
					] }
				] },
				// One selected point, while its points are being edited
				// (js/ui/path-edit.js).
				{ kind: 'section', id: 'pathPointSection', title: 'Point', hidden: true, sets: [
					{ rows: [
						{ kind: 'numberPair', label: 'Position', items: [
							{ id: 'pathPointX', mark: 'X', label: 'Point X', unit: 'px', step: 1 },
							{ id: 'pathPointY', mark: 'Y', label: 'Point Y', unit: 'px', step: 1 }
						] },
						{ kind: 'segmented', label: 'Type', get options() {
							return getOptions('pathPointType').map(({ value, label, icon }) => ({ id: `pathPointType${panelCap(value)}`, value, label, icon }));
						} }
					] },
					{ actions: [{ id: 'pathPointDelete', label: 'Delete point', icon: 'trash' }] }
				] }
			] },
			{ title: 'Appearance', sections: [
				createLayerSectionSpec('pathLayerOpacity', 'pathLayerBlendMode'),
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'pathFill', title: 'Fill', presentation: 'flyout',
					texturePosition: true,
					activeMode: 'none',
					color: '#ff66cc', chipTitle: 'Choose fill glitter' },
				{ kind: 'paintSlot', slot: 'stroke', idPrefix: 'pathStroke', title: 'Stroke', presentation: 'flyout',
					summaryValue: 'pathStrokeWidth',
					toggle: true, texturePosition: true, activeMode: 'glitter',
					color: CONFIG.tools.path.stroke.color, chipTitle: 'Choose stroke glitter',
					sets: [
						{ label: 'Line', rows: [
							{ kind: 'slider', id: 'pathStrokeWidth', slider: 'strokeWidth' },
							{ kind: 'segmented', label: 'Edges', revert: true, get options() {
								return createBorderEdgeOptions('pathStroke').filter((option) => option.value !== 'hard');
							} },
							{ kind: 'segmented', label: 'Cap', rowId: 'pathStrokeCapRow', revert: true, get options() { return getOptions('strokeCap').map(({ value, label, suffix, icon }) => ({ id: `pathStroke${suffix}`, value, label, icon, active: value === CONFIG.tools.path.stroke.cap })); } }
						] },
						{ label: 'Dashes', rows: [
							{ kind: 'segmented', label: 'Style', revert: true, get options() {
								return getOptions('strokeDashStyle').map(({ value, label, suffix }) => ({ id: `pathStroke${suffix}`, value, label, active: value === 'solid' }));
							} },
							{ kind: 'slider', id: 'pathStrokeDash', slider: 'strokeDash' },
							{ kind: 'slider', id: 'pathStrokeGap', slider: 'strokeGap' },
							{ kind: 'slider', id: 'pathStrokeDashOffset', slider: 'strokeDashOffset', title: 'Slides the dashes along the line' }
						] },
						{ id: 'pathStrokeEnds', label: 'Start', rows: [
							{ kind: 'presetGrid', id: 'pathStrokeStartShapes', label: 'Start of line', classes: 'property-inset stroke-ornaments' },
							{ kind: 'slider', id: 'pathStrokeStartSize', slider: 'strokeOrnamentSize', label: 'Start size', title: 'Size of the start shape, as a share of the line width' },
						] },
						{ id: 'pathStrokeEndSet', label: 'End', rows: [
							{ kind: 'presetGrid', id: 'pathStrokeEndShapes', label: 'End of line', classes: 'property-inset stroke-ornaments' },
							{ kind: 'slider', id: 'pathStrokeEndSize', slider: 'strokeOrnamentSize', label: 'End size', title: 'Size of the end shape, as a share of the line width' }
						] }
					] }
			] },
			{ title: 'Layout', sections: [{ kind: 'transform' }] }
		],
		effects: [
			createOutlineSectionSpec('pathBorder',
				[{ kind: 'slider', id: 'pathBorderWidth', slider: 'borderWidth' }],
				[
					...createOutlinePlacementRows('pathBorder'),
					{ kind: 'toggle', id: 'pathBorderFillEnclosed', label: 'Fill enclosed areas', title: 'Fill transparent areas that are completely enclosed by the path' }
				]),
			createShadowSectionSpec('pathShadow'),
			...createBevelSectionSpecs('pathBevel'),
			createSparklesSectionSpec('pathSparkles')
		],
		effectsReset: { id: 'resetPathEffects', title: 'Disable all path effects and clear their saved settings' },
		motion: [createAnimationSectionSpec('path')]
	},
	// The New Canvas modal's form. Its modal body carries `.property-panel`, so
	// this headerless section renders the same sections and rows as the
	// sidebar. A form lists `sections` with no group: a modal body is one
	// column. document-start.js owns every value: the numberPair matches the
	// document-size W/H fields, and Background is the same Color / Transparent
	// segment plus color row as the canvas extension fill.
	newCanvas: {
		prefix: 'newCanvas',
		form: true,
		section: { id: 'newCanvasSettingsSection', bare: true },
		sections: [
			{ kind: 'section', title: 'Dimensions', sets: [
				{ rows: [
					{ kind: 'numberPair', label: 'Size', items: [
						{ id: 'newCanvasWidth', mark: 'W', label: 'Width', min: CONFIG.canvas.limits.minSize, max: CONFIG.canvas.limits.maxWidth, step: 1, inputMode: 'numeric' },
						{ id: 'newCanvasHeight', mark: 'H', label: 'Height', min: CONFIG.canvas.limits.minSize, max: CONFIG.canvas.limits.maxHeight, step: 1, inputMode: 'numeric' }
					] },
					{ kind: 'segmented', id: 'newCanvasOrientation', label: 'Orientation', ariaLabel: 'Canvas orientation', options: [
						{ id: 'orientationPortrait', icon: 'portrait', label: 'Portrait', showLabel: true, value: 'portrait' },
						{ id: 'orientationLandscape', icon: 'landscape', label: 'Landscape', showLabel: true, value: 'landscape' }
					] }
				] }
			] },
			{ kind: 'section', title: 'Background', sets: [
				{ rows: [
					{ kind: 'segmented', id: 'newCanvasBackground', label: 'Fill', ariaLabel: 'Canvas background', options: [
						{ label: 'Color', value: 'color', active: true },
						{ label: 'Transparent', value: 'transparent' }
					] },
					{ kind: 'field', id: 'newCanvasColor', rowId: 'canvasColorRow', label: 'Color',
						type: 'color', value: CONFIG.canvas.defaults.blankDocument.color }
				] }
			] }
		]
	},
	// The document-size form (Image Size / Canvas Size). ONE self-contained
	// "Size" section, mounted into #baseCanvasSizeHost at boot;
	// refreshInspector and BaseBackgroundManager relocate this single node to
	// #baseCanvasSizeHost for Canvas Properties. Defined last so its mount host
	// (from the noSelection schema) already exists. canvas-size.js owns every
	// value and range, and shows the sets of the chosen operation: a mode's own
	// set by id, anything else by `data-size-mode-note`.
	documentSize: {
		prefix: 'documentSize',
		mountInto: 'baseCanvasSizeHost',
		content: {
			kind: 'section', id: 'documentSizeGroup', title: 'Size', classes: 'document-size-group',
			summary: { id: 'noLayerSizeSummary', text: 'Image' },
			sets: [
				{ rows: [
					{ kind: 'segmented', id: 'documentSizeMode', label: 'Operation', ariaLabel: 'Sizing operation',
						classes: 'document-size-mode', options: [
							{ label: 'Image', active: true, attrs: { 'data-size-mode': 'image', 'aria-pressed': 'true' } },
							{ label: 'Canvas', attrs: { 'data-size-mode': 'canvas', 'aria-pressed': 'false' } }
						] },
					{ kind: 'note', attrs: { 'data-size-modes': 'image' }, text: 'Resize the canvas and everything in the design. Proportions stay linked.' },
					{ kind: 'note', hidden: true, attrs: { 'data-size-modes': 'canvas' }, text: 'Crop or extend the canvas without scaling content.' },
				] },
				{ attrs: { 'data-size-modes': 'canvas' }, id: 'canvasSizePanel', classes: 'document-size-panel canvas-size-controls', hidden: true, rows: [
					{ kind: 'select', id: 'canvasBoundsSource', label: 'Fit', options: CANVAS_BOUNDS_SOURCES.map((source) => ({ value: source.id, label: source.label })) },
					{ kind: 'select', id: 'canvasBoundsRatio', label: 'Ratio', options: [] },
					{ kind: 'numberPair', label: 'Size', revert: 'canvasSizeWidth canvasSizeHeight', items: [
						{ id: 'canvasSizeWidth', mark: 'W', label: 'Width', min: 1, max: CONFIG.canvas.limits.maxWidth, step: 1, inputMode: 'numeric' },
						{ id: 'canvasSizeHeight', mark: 'H', label: 'Height', min: 1, max: CONFIG.canvas.limits.maxHeight, step: 1, inputMode: 'numeric' }
					] },
					{ kind: 'note', id: 'canvasSizeLimitMessage', classes: 'canvas-size-limit-message', attrs: { role: 'status' } },
					{ kind: 'labeled', label: 'Anchor', stacked: true, revert: 'canvasSizeAnchor', control: { kind: 'host', id: 'canvasSizeAnchor',
						classes: 'anchor-grid', attrs: { role: 'radiogroup', 'aria-label': 'Canvas resize anchor' } } },
					{ kind: 'toggle', id: 'canvasSizeRelative', label: 'Relative', revert: 'canvasSizeRelative' }
				] },
				{ attrs: { 'data-size-modes': 'image' }, id: 'scaleDesignPanel', classes: 'document-size-panel scale-design-controls', rows: [
					{ kind: 'numberPair', label: 'Size', revert: 'scaleDesignWidth scaleDesignHeight', items: [
						{ id: 'scaleDesignWidth', mark: 'W', label: 'Width', min: 1, max: CONFIG.canvas.limits.maxWidth, step: 1, inputMode: 'numeric' },
						{ id: 'scaleDesignHeight', mark: 'H', label: 'Height', min: 1, max: CONFIG.canvas.limits.maxHeight, step: 1, inputMode: 'numeric' }
					] },
					{ kind: 'slider', id: 'scaleDesignPercent', slider: 'documentScale', label: 'Scale' }
				] },
				{ attrs: { 'data-size-modes': 'image' }, rows: [
					{ kind: 'toggle', id: 'scaleDesignTextures', label: 'Scale textures', checked: true, revert: 'scaleDesignTextures' },
					{ kind: 'toggle', id: 'scaleDesignEffects', label: 'Scale effects', checked: true, revert: 'scaleDesignEffects' }
				] },
				{ attrs: { 'data-size-modes': 'canvas' }, rows: [
					{ kind: 'field', id: 'artworkCropPadding', rowId: 'canvasBoundsPaddingRow', label: 'Padding', type: 'number', unit: 'px', min: 0, step: 1, value: 0, revert: 'artworkCropPadding' }
				] },
				// Extension fill applies to both structural resizes that can grow the
				// canvas beyond its current bounds — Canvas Size, and Artwork padding
				// that pushes past the old edges — so it's one shared set shown for
				// either mode.
				{ hidden: true, attrs: { 'data-size-modes': 'canvas' }, rows: [
					{ kind: 'segmented', id: 'canvasExtensionMode', label: 'Extension', ariaLabel: 'Canvas extension fill',
						classes: 'canvas-extension-mode', revert: 'canvasExtensionMode', options: [
							{ label: 'Transparent', active: true, attrs: { 'data-extension-mode': 'transparent', 'aria-pressed': 'true' } },
							{ label: 'Color', attrs: { 'data-extension-mode': 'color', 'aria-pressed': 'false' } }
						] },
					{ kind: 'field', id: 'canvasExtensionColor', rowId: 'canvasExtensionColorRow', label: 'Fill color',
						type: 'color', value: '#ffffff', hidden: true, revert: 'canvasExtensionColor' }
				] },
				{ attrs: { 'data-size-modes': 'canvas' }, id: 'canvasSizeActions', classes: 'canvas-size-actions is-split', hidden: true, actions: [
					{ id: 'canvasSizeReset', label: 'Reset', command: 'canvasBoundsCancel' },
					{ id: 'canvasSizeApply', label: 'Apply', primary: true, command: 'canvasBoundsApply' }
				] },
				{ attrs: { 'data-size-modes': 'image' }, id: 'scaleDesignActions', classes: 'scale-design-actions is-split', actions: [
					{ id: 'scaleDesignReset', label: 'Reset', command: 'documentScaleReset' },
					{ id: 'scaleDesignApply', label: 'Scale image', primary: true, command: 'documentScaleApply' }
				] },
			]
		}
	}
};
