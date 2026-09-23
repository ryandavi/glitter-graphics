// Declarative sidebar panel structure consumed by js/ui/panel-renderer.js.
// Structure, ordering, and capabilities
// only — markup lives in the index.html tpl-* <template>s, slider ranges in
// FIELDS (js/core/fields.js). Stamped element ids preserve the legacy names
// (managers keep binding by id); paintSlot ids derive as idPrefix +
// capitalized role, the grammar the paint-slot binder reads. Panels not listed here are still static index.html
// markup awaiting migration.
const LAYER_BLEND_MODE_OPTIONS = CONFIG.layers.blendModes.map((value) => ({
	value,
	label: value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
	selected: value === CONFIG.layers.defaultBlendMode
}));

const TEXT_BACKGROUND_PRESET_OPTIONS = [
	{ value: '', label: 'Choose a preset…' },
	{ value: 'instagram', label: 'Instagram', selected: true },
	{ value: 'tight', label: 'Tight Highlight' },
	{ value: 'separateLines', label: 'Separate Lines' },
	{ value: 'connectedBlock', label: 'Connected Block' },
	{ value: 'textBounds', label: 'Text Bounds' },
	{ value: 'textBox', label: 'Text Box' },
	{ value: 'labelPill', label: 'Label / Pill' }
];

const ANIMATION_PRESET_GROUPS = {
	Ambient: ['breath', 'float', 'sway', 'dim', 'drift', 'twinkle', 'pulse'],
	Attention: ['heartbeat', 'blink', 'bounce', 'shake', 'tremble', 'wobble', 'jello', 'tada', 'swing', 'rubber-band'],
	Movement: ['move', 'orbit', 'rotate', 'flip', 'zoom', 'ping', 'marquee'],
	Color: ['rainbow']
};
const ANIMATION_PRESET_GROUP_BY_TYPE = Object.fromEntries(
	Object.entries(ANIMATION_PRESET_GROUPS).flatMap(([group, types]) => types.map((type) => [type, group]))
);
const ANIMATION_PRESET_OPTIONS = Object.keys(CONFIG.tools.animation.presets).map((value) => ({
	value,
	label: value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
	selected: value === CONFIG.tools.animation.defaultType,
	group: ANIMATION_PRESET_GROUP_BY_TYPE[value]
}));

function createAnimationPanelSpec(prefix) {
	const id = (suffix) => `${prefix}Anim${suffix}`;
	return {
		kind: 'card', title: 'Animation', badge: 'beta', classes: 'panel-module animation-module',
		titleSummary: { id: id('Summary'), text: 'Off' },
		toggle: { id: id('Enabled'), label: '', title: 'Enable Animation' },
		// No `content` wrapper: items sit directly on the card, exactly like every
		// other toggle-gated effect module (pixel effects, shadow, border). That
		// gets the animation card the same shared contract for free \u2014 the
		// standard `is-collapsed` accordion (toggled by the generic effect-toggle
		// listener, `syncPanelEffectToggle`) hides the whole body including the
		// trailing `advanced` block, which renders as a sibling of
		// `.subsection-card-body`, not nested inside it.
		items: [
			{ kind: 'set', items: [
				{ kind: 'select', id: id('Type'), label: 'Animation type', visibleLabel: 'Preset', options: ANIMATION_PRESET_OPTIONS,
					stacked: false,
					stepper: {
						prev: { id: id('PresetPrev'), label: 'Previous preset', icon: 'chevron-left', title: 'Previous preset' },
						next: { id: id('PresetNext'), label: 'Next preset', icon: 'chevron-right', title: 'Next preset' }
					} },
				{ kind: 'host', id: id('LoopHint'), classes: 'property-note animation-loop-hint' }
			] },
			{ kind: 'set', label: 'Motion', items: [
				{ kind: 'slider', id: id('PeriodMs'), slider: 'animSpeed', label: 'Speed' },
				{ kind: 'slider', id: id('Amount'), slider: 'animAmount', rowId: id('AmountRow') },
				{ kind: 'slider', id: id('Angle'), slider: 'animAngle', rowId: id('AngleRow'), hidden: true },
				{ kind: 'slider', id: id('Distance'), slider: 'animDistance', rowId: id('DistanceRow'), hidden: true },
				{ kind: 'slider', id: id('Radius'), slider: 'animRadius', rowId: id('RadiusRow'), hidden: true },
				{ kind: 'slider', id: id('Turns'), slider: 'animTurns', rowId: id('TurnsRow'), hidden: true },
				{ kind: 'slider', id: id('Duty'), slider: 'animDuty', rowId: id('DutyRow'), hidden: true },
				{ kind: 'slider', id: id('OpacityFloor'), slider: 'animOpacityFloor', rowId: id('OpacityFloorRow'), hidden: true }
			] },
			{ kind: 'advanced', id: id('Advanced'), items: [
				{ kind: 'set', items: [
					{ kind: 'select', id: id('Easing'), visibleLabel: 'Easing', label: 'Easing', options: [
						{ value: 'linear', label: 'Linear' }, { value: 'ease', label: 'Ease' }, { value: 'easeIn', label: 'Ease in' },
						{ value: 'easeOut', label: 'Ease out' }, { value: 'easeInOut', label: 'Ease in-out' },
						{ value: 'bounceOut', label: 'Bounce out' }, { value: 'elasticOut', label: 'Elastic out' }, { value: 'steps', label: 'Steps' }
					] },
					{ kind: 'field', id: id('Steps'), type: 'number', label: 'Steps', min: 2, max: 60, step: 1, value: 2, rowId: id('StepsRow') },
					{ kind: 'select', id: id('Direction'), visibleLabel: 'Direction', label: 'Direction', options: [
						{ value: 'normal', label: 'Normal' }, { value: 'reverse', label: 'Reverse' },
						{ value: 'alternate', label: 'Alternate' }, { value: 'alternate-reverse', label: 'Alternate reverse' }
					] },
					{ kind: 'select', id: id('Iterations'), visibleLabel: 'Iterations', label: 'Iterations', options: [
						{ value: 'Infinity', label: '\u221e' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '5', label: '5' }, { value: '10', label: '10' }
					] }
				] },
				{ kind: 'set', items: [
					{ kind: 'slider', id: id('DelayMs'), slider: 'animDelay' },
					{ kind: 'slider', id: id('Phase'), slider: 'animPhase' },
					{ kind: 'select', id: id('FillMode'), visibleLabel: 'Fill', label: 'Fill mode',
						hint: 'Whether the layer holds its start pose before a delay, and its end pose after a limited number of iterations finishes. Has no effect with no delay and infinite iterations.',
						options: [
							{ value: 'none', label: 'None' }, { value: 'forwards', label: 'Forwards' },
							{ value: 'backwards', label: 'Backwards' }, { value: 'both', label: 'Both' }
						] }
				] },
				{ kind: 'set', items: [
					{ kind: 'select', id: id('Anchor'), visibleLabel: 'Anchor', label: 'Anchor', options: [
						{ value: 'top-left', label: 'Top left' }, { value: 'top-center', label: 'Top center' }, { value: 'top-right', label: 'Top right' },
						{ value: 'center-left', label: 'Center left' }, { value: 'center', label: 'Center' }, { value: 'center-right', label: 'Center right' },
						{ value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-center', label: 'Bottom center' }, { value: 'bottom-right', label: 'Bottom right' },
						{ value: 'custom', label: 'Custom' }
					] },
					{ kind: 'slider', id: id('AnchorX'), slider: 'animAnchorX', rowId: id('AnchorXRow'), hidden: true },
					{ kind: 'slider', id: id('AnchorY'), slider: 'animAnchorY', rowId: id('AnchorYRow'), hidden: true },
					{ kind: 'select', id: id('SnapMode'), visibleLabel: 'Motion', label: 'Motion sampling', options: [
						{ value: 'smooth', label: 'Smooth' }, { value: 'pixel-snap', label: 'Pixel snap' }, { value: 'step', label: 'Step' }
					] }
				] }
			] }
		]
	};
}

const PANEL_SCHEMAS = {
	// The "nothing selected" panel: sits under the shared Design gallery header
	// (so it renders headerless — `section.bare`) and carries two mutually
	// exclusive `.settings-subsection` blocks. syncNoLayerPanelState toggles
	// #noLayerDefaultGroups vs #multiLayerSelectionGroup by id; every control id
	// and its listener is preserved from the pre-schema static markup.
	noSelection: {
		prefix: 'noLayer',
		section: { id: 'noLayerSettingsSection', bare: true, classes: 'panel-redesign' },
		preamble: [
			{ kind: 'host', tag: 'span', id: 'noLayerEmptyText', text: 'Design', attrs: { hidden: 'hidden' } },
			{ kind: 'host', id: 'noLayerEmptySubtext', classes: 'property-note no-selection-intro',
				text: 'Nothing selected. Pick a layer to edit it, or add content below.' }
		],
		subsections: [
			// One L1 group holding the default-state cards, exactly like Text's
			// "Content" group — so Quick add / Project / Size all get the ordinary
			// `.property-card` treatment (not the `.property-block-list` override).
			{ id: 'noLayerDefaultGroups', items: [
				{ kind: 'group', title: 'Start', collapsible: false, items: [
					{ kind: 'card', title: 'Quick add', items: [
						{ kind: 'host', id: 'quickAddOptions', classes: 'layer-type-options quick-add' }
					] },
					{ kind: 'card', title: 'Project', collapsible: true,
					titleSummary: { id: 'projectNameSummary', text: 'Untitled project' }, items: [
						{ kind: 'field', id: 'projectNameInput', label: 'Name', type: 'text',
							maxlength: 60, spellcheck: false, placeholder: 'Name...' },
						{ kind: 'actionRow', classes: 'canvas-project-actions is-split', actions: [
							{ id: 'openProjectSidebarBtn', label: 'Open Project', icon: 'open-project' },
							{ id: 'saveProject', label: 'Save Project', icon: 'save', primary: true, disabled: true }
						] }
					] },
					// The document-size fragment card mounts here at boot and is
					// relocated to #baseCanvasSizeHost when Canvas Properties is shown.
					{ kind: 'host', id: 'noLayerCanvasSizeHost' }
				] }
			] },
			{ id: 'multiLayerSelectionGroup', hidden: true, groups: [
				{ title: 'Appearance', collapsible: false, items: [
					{ kind: 'card', items: [
						{ kind: 'slider', id: 'multiSelectionOpacity', slider: 'multiSelectionOpacity', label: 'Opacity' }
					] }
				] },
				{ title: 'Align', collapsible: false, items: [
					{ kind: 'card', items: [
						{ kind: 'segmented', id: 'multiSelectionAlignScope', visibleLabel: 'Align to',
							label: 'Alignment reference', stacked: false, options: [
								{ label: 'Selection', active: true, attrs: { 'data-scope': 'selection' } },
								{ label: 'Canvas', attrs: { 'data-scope': 'canvas' } }
							] },
						{ kind: 'segmented', visibleLabel: 'Horizontal', label: 'Align horizontally',
							classes: 'transform-segmented-control', stacked: false, options: [
								{ icon: 'align-left', label: 'Align left', attrs: { 'data-multi-align': 'left' } },
								{ icon: 'align-center-x', label: 'Align horizontal centers', attrs: { 'data-multi-align': 'centerX' } },
								{ icon: 'align-right', label: 'Align right', attrs: { 'data-multi-align': 'right' } }
							] },
						{ kind: 'segmented', visibleLabel: 'Vertical', label: 'Align vertically',
							classes: 'transform-segmented-control', stacked: false, options: [
								{ icon: 'align-top', label: 'Align top', attrs: { 'data-multi-align': 'top' } },
								{ icon: 'align-center-y', label: 'Align vertical centers', attrs: { 'data-multi-align': 'centerY' } },
								{ icon: 'align-bottom', label: 'Align bottom', attrs: { 'data-multi-align': 'bottom' } }
							] },
						{ kind: 'segmented', visibleLabel: 'Distribute', label: 'Distribute selected layers',
							classes: 'transform-segmented-control', stacked: false, options: [
								{ icon: 'distribute-x', label: 'Distribute horizontally', attrs: { 'data-multi-distribute': 'horizontal' } },
								{ icon: 'distribute-y', label: 'Distribute vertically', attrs: { 'data-multi-distribute': 'vertical' } }
							] }
					] }
				] },
				// Panel-end actions: a group-level actionRow (no card wrapper) — the
				// renderer stamps `.section-actions`, so no surface / border above.
				{ title: 'Actions', collapsible: false, items: [
					{ kind: 'actionRow', classes: 'multi-selection-actions', actions: [
						{ id: 'multiSelectionDuplicateBtn', label: 'Duplicate' },
						{ id: 'multiSelectionDeleteBtn', label: 'Delete' }
					] }
				] }
			] }
		]
	},
	autoGlitterSession: {
		prefix: 'autoGlitter',
		sectionPrefix: 'autoGlitterSettings',
		mobileKey: 'autoGlitter',
		section: { id: 'autoGlitterSettingsSection', classes: 'panel-redesign', icon: 'magic-wand', iconName: 'Auto Glitter', title: 'Auto Glitter', badge: 'beta' },
		groups: [
			{ title: 'Preview', region: 'header', static: true, bare: true, items: [
				{ kind: 'card', classes: 'auto-glitter-preview-card', bare: true, items: [
					{ kind: 'segmented', id: 'autoGlitterPreviewMode', label: 'Preview mode', options: [
						{ label: 'Original', value: 'original' }, { label: 'Flat', value: 'flat' }, { label: 'Glitter', value: 'glitter', active: true }
					] }
				] },
				{ kind: 'card', id: 'autoGlitterExisting', classes: 'auto-glitter-existing', hidden: true, items: [
					{ kind: 'host', id: 'autoGlitterExistingSummary', classes: 'property-note' },
					{ kind: 'radioSegmented', id: 'autoGlitterRerunMode', classes: 'auto-glitter-rerun-mode', label: 'How to handle the previous Auto Glitter layers', options: [
						{ id: 'autoGlitterEditCurrent', label: 'Edit', value: 'edit' },
						{ id: 'autoGlitterReplacePrevious', label: 'Replace', value: 'replace' },
						{ id: 'autoGlitterAddAnother', label: 'Add', value: 'add' }
					] }
				] }
			] },
			{ title: 'Palette', region: 'scroll', collapsible: false, items: [
				{ kind: 'card', items: [
					{ kind: 'segmented', id: 'autoGlitterPaletteStyle', classes: 'auto-glitter-palette-style', label: 'Palette style', visibleLabel: 'Style', revert: true, options: [
						{ label: 'Faithful', value: 'natural', active: true, attrs: { title: 'Preserve the image\'s color balance without boosting saturation' } },
						{ label: 'Balanced', value: 'balanced', attrs: { title: 'Gently favor colorful regions and boost glitter saturation' } },
						{ label: 'Vibrant', value: 'vibrant', attrs: { title: 'Prioritize colorful accents and strongly boost glitter saturation' } }
					] },
					{ kind: 'host', classes: 'property-note', text: 'Faithful follows the image; Balanced and Vibrant progressively emphasize color.' },
					{ kind: 'slider', id: 'autoGlitterColorCount', slider: 'autoGlitterColorCount', label: 'Colors' },
					{ kind: 'slider', id: 'autoGlitterMergeDistinctness', slider: 'autoGlitterMergeDistinctness', label: 'Merge', valueScale: 'percent' },
					{ kind: 'host', id: 'autoGlitterCapacity', classes: 'property-note' }
				] }
			] },
			{ title: 'Color Matches', region: 'scroll', collapsible: false, items: [
				{ kind: 'card', classes: 'auto-glitter-review', items: [
					{ kind: 'host', id: 'autoGlitterStatus', classes: 'property-note', attrs: { role: 'status', 'aria-live': 'polite' }, text: 'Finding the image\'s distinct colors…' },
					{ kind: 'host', id: 'autoGlitterResults', classes: 'property-inset property-list auto-glitter-results', attrs: { 'aria-label': 'Detected color regions and glitter matches' } }
				] }
			] },
			{ title: 'Advanced', region: 'scroll', collapsible: false, items: [
				{ kind: 'card', items: [
					{ kind: 'slider', id: 'autoGlitterDetail', slider: 'autoGlitterDetail', label: 'Detail', title: 'Absorb connected regions smaller than this many pixels' },
					{ kind: 'checkboxList', items: [
						{ id: 'autoGlitterCleanEdges', label: 'Clean Edges', checked: true, revert: true, title: 'Absorb anti-aliased blend colors into their neighboring regions' },
						{ id: 'autoGlitterTuneHue', label: 'Tune Matched Glitter Hue', checked: true, revert: true, title: 'Apply a small hue correction to improve the closest glitter match' }
					] }
				] }
			] },
			{ title: 'Finish', region: 'footer', static: true, bare: true, items: [
				{ kind: 'actionRow', classes: 'auto-glitter-actions is-split', actions: [
					{ id: 'cancelAutoGlitterBtn', label: 'Cancel', secondary: true },
					{ id: 'autoGlitterCreateBtn', label: 'Create Layers', primary: true }
				] }
			] }
		]
	},
	[LayerType.FILTER]: {
		prefix: 'filter',
		sectionPrefix: 'filterSettings',
		mobileKey: 'filter',
		section: { id: 'filterSettingsSection', classes: 'panel-redesign', icon: 'sliders', iconName: 'Filter', title: 'Filter Properties' },
		groups: [
			{ title: 'Appearance', collapsible: false, items: [
				{ kind: 'slider', id: 'filterLayerOpacity', slider: 'layerOpacity', label: 'Opacity' },
				{ kind: 'select', id: 'filterLayerBlendMode', label: 'Layer blend mode', visibleLabel: 'Blend', classes: 'layer-blend-mode', revert: true, options: LAYER_BLEND_MODE_OPTIONS },
				{ kind: 'card', title: 'Filter', flatBody: true, items: [
					{ kind: 'set', items: [
						{ kind: 'select', id: 'filterType', label: 'Filter type', visibleLabel: 'Type', options: [
						{ label: 'Basic', value: 'basic', active: true },
						{ label: 'Invert', value: 'invert' }, { label: 'Grayscale', value: 'grayscale' },
						{ label: 'Sepia', value: 'sepia' }, { label: 'Tint', value: 'tint' },
						{ label: 'Vignette', value: 'vignette' }, { label: 'Grain', value: 'grain' }, { label: 'Blur', value: 'blur' },
						{ label: 'Instagram', value: 'instagram' }
					] }
					] },
					{ kind: 'set', id: 'filterInstagramSettings', classes: 'filter-type-settings', hidden: true, label: 'Preset', items: [
						{ kind: 'host', id: 'filterPresetPicker', classes: 'property-inset property-scrollbox filter-preset-picker' },
						{ kind: 'slider', id: 'filterStrength', slider: 'filterInstagramStrength', revert: true },
						{ kind: 'checkboxList', items: [{ id: 'filterShowName', label: 'Show Filter Name' }] }
					] },
					{ kind: 'set', id: 'filterBasicSettings', classes: 'filter-type-settings', label: 'Adjustments', items: [
						{ kind: 'slider', id: 'filterBrightness', slider: 'filterBrightness', revert: true },
						{ kind: 'slider', id: 'filterContrast', slider: 'filterContrast', revert: true },
						{ kind: 'slider', id: 'filterSaturation', slider: 'filterSaturation', revert: true },
						{ kind: 'slider', id: 'filterHue', slider: 'filterHue', revert: true }
					] },
					{ kind: 'set', id: 'filterInvertSettings', classes: 'filter-type-settings', hidden: true, items: [{ kind: 'slider', id: 'filterInvertAmount', slider: 'filterInvertAmount', revert: true }] },
					{ kind: 'set', id: 'filterGrayscaleSettings', classes: 'filter-type-settings', hidden: true, items: [{ kind: 'slider', id: 'filterGrayscaleAmount', slider: 'filterGrayscaleAmount', revert: true }] },
					{ kind: 'set', id: 'filterSepiaSettings', classes: 'filter-type-settings', hidden: true, items: [{ kind: 'slider', id: 'filterSepiaAmount', slider: 'filterSepiaAmount', revert: true }] },
					{ kind: 'set', id: 'filterTintSettings', classes: 'filter-type-settings', hidden: true, items: [
						{ kind: 'select', id: 'filterTintPreset', label: 'Tint preset', visibleLabel: 'Preset', options: [] },
						{ kind: 'field', id: 'filterTintColor', label: 'Color', type: 'color', value: '#ec8a00', revert: true },
						{ kind: 'slider', id: 'filterTintAmount', slider: 'filterTintAmount', revert: true }
					] },
					{ kind: 'set', id: 'filterVignetteSettings', classes: 'filter-type-settings', hidden: true, items: [
						{ kind: 'slider', id: 'filterVignetteAmount', slider: 'filterVignetteAmount', revert: true },
						{ kind: 'slider', id: 'filterVignetteMidpoint', slider: 'filterVignetteMidpoint', revert: true },
						{ kind: 'slider', id: 'filterVignetteRoundness', slider: 'filterVignetteRoundness', revert: true },
						{ kind: 'slider', id: 'filterVignetteFeather', slider: 'filterVignetteFeather', revert: true },
						{ kind: 'field', id: 'filterVignetteColor', label: 'Color', type: 'color', value: '#000000', revert: true }
					] },
					{ kind: 'set', id: 'filterGrainSettings', classes: 'filter-type-settings', hidden: true, items: [
						{ kind: 'slider', id: 'filterGrainAmount', slider: 'filterGrainAmount', revert: true },
						{ kind: 'slider', id: 'filterGrainSize', slider: 'filterGrainSize', revert: true },
						{ kind: 'slider', id: 'filterGrainRoughness', slider: 'filterGrainRoughness', revert: true },
						{ kind: 'checkboxList', items: [{ id: 'filterGrainMono', label: 'Monochrome', checked: true }] }
					] },
					{ kind: 'set', id: 'filterBlurSettings', classes: 'filter-type-settings', hidden: true, items: [{ kind: 'slider', id: 'filterBlurRadius', slider: 'filterBlurRadius', revert: true }] }
				] }
			] }
		]
	},
	[LayerType.BASE_IMAGE]: {
		prefix: 'baseBackground',
		sectionPrefix: 'baseLayerSettings',
		mobileKey: 'background',
		section: { id: 'baseLayerSettingsSection', icon: 'paint-bucket', iconName: 'Canvas', title: 'Canvas Properties', classes: 'panel-redesign' },
		groups: [
			{ title: 'Appearance', collapsible: false, items: [
				// The canvas layer is a single paint; its only opacity IS the
				// whole-layer opacity. Keeps legacy id `baseBackgroundOpacity`.
				{ kind: 'slider', id: 'baseBackgroundOpacity', slider: 'layerOpacity', label: 'Layer Opacity' },
				{ kind: 'paintSlot', slot: 'background', idPrefix: 'baseBackground', title: 'Background',
					redesign: true, sourceSelect: true, sourceRevert: true, colorRevert: true,
					texturePosition: true, noSlotOpacity: true,
					modes: ['image', 'none', 'glitter', 'solid'], activeMode: 'image', color: '#ffffff',
					modeLabels: { none: 'Transparent' },
					hidePrimaryModes: ['image'],
					chipTitle: 'Choose background glitter',
					imageAsset: {
						info: 'baseBackgroundImageInfo', thumbnail: 'baseBackgroundImageThumbnail',
						name: 'baseBackgroundImageName', badges: 'baseBackgroundImageBadges',
						change: 'baseBackgroundImageChange', title: 'Replace base image', compact: true, redesign: true
					}
				}
			] },
			{ title: 'Canvas', collapsible: false, items: [
				{ kind: 'host', id: 'baseCanvasSizeHost' }
			] },

			{ title: 'Effects', collapsible: false, items: [
				{ kind: 'card', classes: 'pixelate-effect-card panel-module', title: 'Pixelate', collapsible: true, toggle: { id: 'pixelEffectsPixelateEnabled', label: 'Enabled' }, items: [
					{ kind: 'slider', id: 'pixelEffectsPixelSize', slider: 'pixelEffectsPixelSize', title: '1 is off; larger values create crisp mosaic cells before palette processing' },
					{ kind: 'host', classes: 'property-note', text: 'Larger cell sizes create a crisp mosaic before palette processing.' }
				] },
				{ kind: 'card', classes: 'pixel-effects-card panel-module', title: 'Palette', collapsible: true,
					toggle: { id: 'pixelEffectsPaletteEnabled', label: 'Enabled' },
					summaryFrom: 'pixelEffectsPaletteMode', items: [
					{ kind: 'set', items: [
						{ kind: 'segmented', id: 'pixelEffectsPaletteMode', visibleLabel: 'Mode', label: 'Palette effect', options: [
							{ label: 'Posterize', value: 'posterize', active: true }, { label: 'Dither', value: 'dither' }
						] },
						{ kind: 'processingStatus', id: 'pixelEffectsStatus', classes: 'pixel-effects-status' }
					] },
					{ kind: 'set', id: 'pixelEffectsPaletteControls', label: 'Colors', hidden: true, items: [
						{ kind: 'segmented', id: 'pixelEffectsPaletteStyle', label: 'Palette style', visibleLabel: 'Style', revert: true, options: [
							{ label: 'Vibrant', value: 'vibrant' }, { label: 'Balanced', value: 'balanced', active: true }, { label: 'Natural', value: 'natural' }
						] },
						{ kind: 'slider', id: 'pixelEffectsColorCount', slider: 'pixelEffectsColorCount' },
						{ kind: 'slider', id: 'pixelEffectsMergeDistinctness', slider: 'pixelEffectsMergeDistinctness', valueScale: 'percent' }
					] },
					{ kind: 'advanced', id: 'pixelEffectsPosterizeControls', label: 'Cleanup', hidden: true, items: [
						{ kind: 'slider', id: 'pixelEffectsDetail', slider: 'pixelEffectsDetail' },
						{ kind: 'checkboxList', items: [{ id: 'pixelEffectsCleanEdges', label: 'Clean Edges', checked: true, title: 'Absorb tiny connected regions into their neighbors' }] }
					] },
					{ kind: 'set', id: 'pixelEffectsDitherControls', classes: 'pixel-effects-dither-controls', label: 'Dither', hidden: true, items: [
						{ kind: 'select', id: 'pixelEffectsAlgorithm', label: 'Dither algorithm', visibleLabel: 'Algorithm', revert: true, options: [
							{ label: 'Bayer', value: 'bayer', active: true }, { label: 'Floyd–Steinberg', value: 'floyd' }, { label: 'Atkinson', value: 'atkinson' }, { label: 'Halftone', value: 'halftone' }
						] },
						{ kind: 'select', id: 'pixelEffectsDitherPalette', label: 'Dither palette', visibleLabel: 'Color Palette', revert: true, options: [
							{ label: 'Auto (Image Colors)', value: 'auto', active: true }, { label: 'Black & White', value: 'bw' }, { label: 'Game Boy', value: 'gameboy' }, { label: 'CGA', value: 'cga' }, { label: 'Sepia', value: 'sepia' }, { label: 'Duotone', value: 'duotone' }
						] },
						{ kind: 'host', id: 'pixelEffectsDuotone', classes: 'property-color-row pixel-effects-duotone' }
					] },
					{ kind: 'set', classes: 'pixel-effects-dither-controls', label: 'Pattern', hidden: true, items: [
						{ kind: 'slider', id: 'pixelEffectsStrength', slider: 'pixelEffectsStrength' },
						{ kind: 'slider', id: 'pixelEffectsDitherScale', slider: 'pixelEffectsDitherScale' },
						{ kind: 'slider', id: 'pixelEffectsAngle', slider: 'pixelEffectsAngle' }
					] },
					{ kind: 'set', classes: 'pixel-effects-dither-controls', label: 'Shimmer', hidden: true, items: [
						{ kind: 'checkboxList', items: [{ id: 'pixelEffectsShimmer', label: 'Animate Dither', title: 'Animate the Bayer or Halftone pattern in the preview and exported GIF' }] },
						{ kind: 'host', id: 'pixelEffectsShimmerHint', classes: 'property-note', text: 'Bayer and Halftone only. Animates the preview and exported GIF; may increase file size.' }
					] }
				] },
				{ kind: 'actionRow', classes: 'pixel-effects-actions', actions: [
					{ id: 'resetPixelEffects', label: 'Reset Effects', secondary: true, title: 'Restore all Pixelate and Palette settings to their defaults' }
				] }
			] },
			{ title: 'Actions', collapsible: false, items: [
				{ kind: 'host', classes: 'property-note', text: 'Turn the image colors into editable glitter fill layers.' },
				{ kind: 'actionRow', actions: [
					{ id: 'autoGlitterImageBtn', label: 'Auto Glitter', icon: 'magic-wand', badge: 'beta', primary: true, title: 'Turn the image colors into editable glitter fill layers' }
				] }
			] },


		]
	},
	brush: {
		prefix: 'brush',
		sectionPrefix: 'brushSettings',
		mobileKey: 'brush',
		section: {
			id: 'brushSettingsSection', classes: 'panel-redesign', icon: 'brush', iconName: 'Brush', title: 'Mask Settings',
			titleIconId: 'brushSettingsTitleIcon', titleTextId: 'brushSettingsTitleText'
		},
		groups: [
			{ title: 'Brush Tip', collapsible: false, items: [
				{ kind: 'card', title: 'Tip', collapsible: true, moduleSummary: 'asset', classes: 'panel-module', items: [
					{ kind: 'assetInfo', info: 'brushTipInfo', thumbnail: 'brushTipThumbnail',
						name: 'brushTipName', badges: 'brushTipBadges', change: 'brushTipChange',
						title: 'Choose another brush tip', compact: true, redesign: true },
					{ kind: 'checkboxList', items: [
						{ id: 'brushAntialiasToggle', label: 'Antialias Edges',
							title: 'Smooth the edges of mask strokes. Off gives crisp pixel edges; a shared setting with text and shapes.' }
					] },
					{ kind: 'host', id: 'brushAntialiasNote', classes: 'property-note', attrs: { hidden: 'hidden' } }
				] }
			] },
			{ title: 'Stroke', collapsible: false, items: [
				{ kind: 'card', title: 'Dynamics', items: [
					{ kind: 'slider', id: 'maskBrushSize', slider: 'maskBrushSize' },
					{ kind: 'slider', id: 'maskBrushSoftness', slider: 'maskBrushSoftness' },
					{ kind: 'slider', id: 'maskBrushFlow', slider: 'maskBrushFlow' },
					{ kind: 'slider', id: 'maskBrushSpacing', slider: 'maskBrushSpacing', title: 'Distance between stamps along a stroke, as a percentage of brush size. Higher values create more space.' },
					{ kind: 'slider', id: 'maskBrushSmoothing', slider: 'maskBrushSmoothing', title: 'Stabilizes shaky strokes by easing the brush toward the cursor. Higher values are smoother but add lag.' },
					{ kind: 'checkboxList', items: [
						{ id: 'maskBrushPressure', label: 'Pressure Sensitivity', title: 'Vary flow with pen pressure (no effect on mouse/touch)', checked: true }
					] }
				] },
				{ kind: 'card', title: 'Scatter & Jitter', items: [
					{ kind: 'host', id: 'brushDynamicsHost', classes: 'brush-dynamics', wrapInContent: true }
				] }
			] },
			{ title: 'Actions', collapsible: false, items: [
				{ kind: 'host', classes: 'property-note', text: 'Brush and Eraser keep separate tip and stroke settings. The copy and reset labels follow the active tool.' },
				{ kind: 'actionRow', actions: [
					{ id: 'maskCopyOppositeSettings', label: 'Copy Eraser Settings', title: 'Copy the other tool\'s settings into this one' },
					{ id: 'maskResetCurrentSettings', label: 'Reset Brush', title: 'Restore this tool\'s settings to their defaults' },
					{ id: 'clearMaskPaint', label: 'Clear Paint', title: 'Remove all painted strokes (color selections stay)' }
				] }
			] }
		]
	},
	[LayerType.GLITTER_FILL]: {
		prefix: 'glitter',
		sectionPrefix: 'glitterSettings',
		mobileKey: 'glitter',
		section: { id: 'glitterSettingsSection', classes: 'panel-redesign', icon: 'glitter', iconName: 'Glitter', title: 'Fill Properties' },
		controls: { id: 'glitterSettingsControls', emptyId: 'glitterSettingsEmpty', empty: { icon: 'glitter', text: 'Select a glitter fill from the gallery to get started.' } },
		groups: [
			{ title: 'Appearance', collapsible: false, items: [
				// A Fill layer is a single masked paint, so its only opacity IS the
				// whole-layer opacity. Keeps legacy id `opacity` (panels.js binding).
				{ kind: 'slider', id: 'opacity', valueId: 'opacityValue', slider: 'layerOpacity', label: 'Layer Opacity' },
				{ kind: 'select', id: 'glitterLayerBlendMode', label: 'Layer blend mode', visibleLabel: 'Blend', classes: 'layer-blend-mode', revert: true, options: LAYER_BLEND_MODE_OPTIONS },
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'glitterFill', title: 'Fill', redesign: true,
					sourceSelect: true, sourceRevert: true, colorRevert: true,
					texturePosition: true, noSlotOpacity: true,
					modes: ['glitter', 'solid'], activeMode: 'glitter', color: '#ff4fa3',
					chipTitle: 'Choose fill glitter', assetIdPrefix: 'glitterAsset',
					assetIds: {
						thumbnail: 'glitterAssetThumbnail', name: 'glitterAssetName',
						badges: 'glitterAssetBadges', change: 'glitterAssetChange',
						size: 'glitterAssetSize', frames: 'glitterAssetFrames'
					},
					primaryIds: { scale: 'scale' },
					advancedIds: { hue: 'glitterHue', saturation: 'glitterSaturation', brightness: 'glitterBrightness' }
				}
			] },
			{ title: 'Mask', collapsible: false, items: [
				{ kind: 'card', classes: 'fill-mask-summary', items: [
					{ kind: 'host', classes: 'property-note', text: 'Edit color selections with the Color Picker, or paint the mask with the Brush and Eraser.' }
				] }
			] }
		],
		effects: [createAnimationPanelSpec('glitter')],
		auxiliarySections: [{
			prefix: 'layer',
			sectionPrefix: 'layerSettings',
			mobileKey: 'tool',
			section: { id: 'layerSettingsSection', classes: 'panel-redesign', icon: 'paint-bucket', iconName: 'Sliders', title: 'Color Fill Settings' },
			controls: {
				id: 'layerSettingsControls', emptyId: 'layerSettingsEmpty',
				empty: { icon: 'paint-bucket', titleId: 'layerSettingsEmptyText', title: 'No layer selected', textId: 'layerSettingsEmptySubtext', text: '' }
			},
			groups: [
				{ title: 'Selection', collapsible: false, items: [
					{ kind: 'card', title: 'Options', items: [
						{ kind: 'checkboxList', items: [
							{ id: 'contiguous', label: 'Contiguous', title: 'Select only connected pixels of the same color' },
							{ id: 'invert', label: 'Invert', title: "Invert this layer's mask — glitter covers everything except the selected and painted areas" },
							{ id: 'multiSelect', label: 'Multi-Select', title: 'Select multiple colors on the same layer' }
						] }
					] },
					{ kind: 'card', title: 'Color Selections', classes: 'color-selection', items: [
						{ kind: 'content', items: [
							{ kind: 'host', id: 'selectedColorsDisplay', classes: 'selected-colors-display' },
							{ kind: 'host', id: 'selectedColorsEmptyNote', classes: 'property-note color-selection-empty-note', text: 'Pick a color on the canvas to add it.' }
						] }
					] },
					{ kind: 'card', title: 'Refine', items: [
						{ kind: 'host', id: 'selectionRefineNote', classes: 'property-note', text: 'Color Tolerance includes colors similar to the one you picked. Edge Feather softens the selection boundary.' },
						{ kind: 'slider', id: 'threshold', slider: 'threshold' },
						{ kind: 'slider', id: 'feather', slider: 'feather' }
					] }
				] }
			]
		}]
	},
	[LayerType.STICKER]: {
		prefix: 'sticker',
		sectionPrefix: 'stickerSettings',
		mobileKey: 'sticker',
		section: { id: 'stickerSettingsSection', classes: 'panel-redesign', icon: 'sticker', iconName: 'Sticker', title: 'Sticker Properties' },
		controls: { id: 'stickerSettingsControls', emptyId: 'stickerSettingsEmpty', empty: { icon: 'sticker', text: 'Select a sticker to edit its properties.' } },
			groups: [
				{ title: 'Content', collapsible: false, items: [
					{ kind: 'card', title: 'Asset', collapsible: true, moduleSummary: 'asset', classes: 'panel-module sticker-asset-module', items: [
						{ kind: 'assetInfo', info: 'stickerAssetInfo', thumbnail: 'stickerAssetThumbnail',
							name: 'stickerAssetName', badges: 'stickerAssetBadges', change: 'stickerAssetChange',
							size: 'stickerAssetSize', frames: 'stickerAssetFrames', title: 'Choose another sticker', redesign: true },
						{ kind: 'colorAdjust', label: 'Adjust color' }
					] }
				] },
			{ title: 'Appearance', collapsible: false, items: [
				{ kind: 'slider', id: 'stickerLayerOpacity', slider: 'layerOpacity', label: 'Layer Opacity' },
				{ kind: 'select', id: 'stickerLayerBlendMode', label: 'Layer blend mode', visibleLabel: 'Blend', classes: 'layer-blend-mode', revert: true, options: LAYER_BLEND_MODE_OPTIONS }
			] },
			{ title: 'Transform', collapsible: false, items: [
				{ kind: 'transformHost' }
			] }
		],
		effects: [
			{ kind: 'paintSlot', slot: 'shadow', idPrefix: 'stickerShadow', title: 'Shadow', redesign: true,
				sourceSelect: true, sourceRevert: true, colorRevert: true,
				texturePosition: true,
				toggle: true, sourceLabel: 'Source', modes: ['glitter', 'solid'], activeMode: 'glitter',
				color: '#000000', chipTitle: 'Choose glitter',
				afterSource: [{ kind: 'numberPair', label: 'Offset', items: [
					{ id: 'stickerShadowOffsetX', slider: 'shadowOffsetX', mark: 'X', label: 'Offset X' },
					{ id: 'stickerShadowOffsetY', slider: 'shadowOffsetY', mark: 'Y', label: 'Offset Y' }
				] }]
			},
			{ kind: 'actionRow', classes: 'layer-effects-actions', actions: [
				{ id: 'resetStickerEffects', label: 'Reset Effects', secondary: true, title: 'Disable all sticker effects and clear their saved settings' }
			] },
			createAnimationPanelSpec('sticker')
		]
	},
	[LayerType.TEXT_GLITTER]: {
		prefix: 'text',
		sectionPrefix: 'textSettings',
		mobileKey: 'text',
		section: { id: 'textSettingsSection', classes: 'panel-redesign', icon: 'text', iconName: 'Text', title: 'Text Properties' },
		groups: [
			// Text is schema-native like every other property panel: type it,
			// choose the face, set the metrics, then place it.
			{ title: 'Content', collapsible: false, items: [
				{ kind: 'card', title: 'Text', items: [
					{ kind: 'textarea', id: 'textLayerInput', classes: 'text-input-group', rows: 4, maxlength: 200, placeholder: 'Type your glitter text' },
					{ kind: 'segmented', visibleLabel: 'Mode', label: 'Text box mode', classes: 'text-box-mode-group', revert: true, options: [
						{ label: 'Point', active: true, attrs: { 'data-text-box-mode': 'auto' } },
						{ label: 'Box', attrs: { 'data-text-box-mode': 'fixed' } }
					] },
					{ kind: 'host', id: 'textBoxModeHint', classes: 'property-note', text: 'Point text hugs the copy. Switch to Box for wrapping and edge resizing.' },
					{ kind: 'actionRow', classes: 'text-fit-box-group card-foot', actions: [
						{ id: 'textFitBoxToContent', label: 'Fit box to text', title: 'Resize the box to exactly fit the current text (keeps existing line breaks/wraps)' }
					] }
				] },
				{ kind: 'card', title: 'Font', items: [
					{ kind: 'host', id: 'textFontPicker', classes: 'property-inset property-scrollbox text-font-picker' },
					{ kind: 'segmented', visibleLabel: 'Style', label: 'Text style', classes: 'text-style-group', revert: true, options: [
						{ id: 'textFontBold', label: 'Bold', contentTag: 'strong' },
						{ id: 'textFontItalic', label: 'Italic', contentTag: 'em' }
					] },
					{ kind: 'select', id: 'textCaseSelect', label: 'Text case', visibleLabel: 'Case', classes: 'text-case-select', revert: true, options: [
						{ value: 'none', label: 'As Typed' }, { value: 'upper', label: 'UPPERCASE' },
						{ value: 'lower', label: 'lowercase' }, { value: 'title', label: 'Title Case' }
					] },
					{ kind: 'slider', id: 'textFontSize', slider: 'textFontSize', label: 'Size' }
				] },
				{ kind: 'card', title: 'Spacing', items: [
					{ kind: 'twoColumn', items: [
						{ kind: 'slider', id: 'textLetterSpacing', slider: 'textLetterSpacing', label: 'Letter' },
						{ kind: 'slider', id: 'textLineHeight', slider: 'textLineHeight', label: 'Line', classes: 'text-line-height-row' }
					] }
				] },
				{ kind: 'card', title: 'Alignment', items: [
					{ kind: 'segmented', visibleLabel: 'Horizontal', label: 'Horizontal text alignment', classes: 'text-align-group', options: [
						{ label: 'Left', icon: 'text-align-left', active: true, attrs: { 'data-text-align': 'left' } },
						{ label: 'Center', icon: 'text-align-center', attrs: { 'data-text-align': 'center' } },
						{ label: 'Right', icon: 'text-align-right', attrs: { 'data-text-align': 'right' } }
					] },
					{ kind: 'segmented', visibleLabel: 'Vertical', label: 'Vertical text alignment', classes: 'text-valign-group', rowClasses: 'text-valign-row', options: [
						{ label: 'Top', icon: 'text-align-top', active: true, attrs: { 'data-text-valign': 'top' } },
						{ label: 'Middle', icon: 'text-align-middle', attrs: { 'data-text-valign': 'middle' } },
						{ label: 'Bottom', icon: 'text-align-bottom', attrs: { 'data-text-valign': 'bottom' } }
					] }
				] }
			] },
			{ title: 'Appearance', collapsible: false, items: [
				{ kind: 'slider', id: 'textLayerOpacity', slider: 'layerOpacity', label: 'Layer Opacity' },
				{ kind: 'select', id: 'textLayerBlendMode', label: 'Layer blend mode', visibleLabel: 'Blend', classes: 'layer-blend-mode', revert: true, options: LAYER_BLEND_MODE_OPTIONS },
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'textFill', title: 'Fill', redesign: true,
					sourceSelect: true, sourceRevert: true, colorRevert: true,
					texturePosition: true,
					modes: ['none', 'glitter', 'solid'], activeMode: 'glitter', color: '#000000',
					chipTitle: 'Choose fill glitter'
				}
			] },
			{ title: 'Transform', collapsible: false, items: [{ kind: 'transformHost' }] }
		],
		effects: [
			{ kind: 'paintSlot', slot: 'textBackground', idPrefix: 'textBackground', title: 'Background', redesign: true,
				sourceSelect: true, sourceRevert: true, colorRevert: true,
				texturePosition: true,
				toggle: true, sourceLabel: 'Source', modes: ['glitter', 'solid'], activeMode: 'glitter',
				color: '#000000', chipTitle: 'Choose background source',
				afterSource: [
					{ kind: 'select', id: 'textBackgroundPreset', label: 'Preset', visibleLabel: 'Preset', options: TEXT_BACKGROUND_PRESET_OPTIONS },
					{ kind: 'set', label: 'Padding', items: [
						{ kind: 'numberPair', label: 'Padding', items: [
							{ id: 'textBackgroundPaddingH', slider: 'textBackgroundPaddingH', mark: 'H', label: 'Horizontal Padding' },
							{ id: 'textBackgroundPaddingV', slider: 'textBackgroundPaddingV', mark: 'V', label: 'Vertical Padding' }
						] }
					] },
					{ kind: 'set', label: 'Shape', items: [
						{ kind: 'slider', id: 'textBackgroundRadius', slider: 'textBackgroundRadius', title: 'How rounded the background corners are.' }
					] }
				],
				post: [
					{ kind: 'set', label: 'Mode', items: [
						{ kind: 'stackRow', revert: true, groups: [
							{ label: 'Mode', hint: 'Lines: one shape per text line. Text Bounds: one shape around all visible text. Text Box: one shape filling the box (box-mode text only).', options: [
								{ id: 'textBackgroundModeLines', label: 'Lines', active: true, value: 'lines' },
								{ id: 'textBackgroundModeBounds', label: 'Text Bounds', value: 'text-bounds' },
								{ id: 'textBackgroundModeBox', label: 'Text Box', value: 'text-box' }
							] },
							{ label: 'Line Connection', hint: 'Separate: each line\'s own shape. Merge Adjacent: nearby lines combine into a stepped shape. Connected: a more permissive merge.', options: [
								{ id: 'textBackgroundConnectionSeparate', label: 'Separate', active: true, value: 'separate' },
								{ id: 'textBackgroundConnectionMerge', label: 'Merge', value: 'merge-adjacent' },
								{ id: 'textBackgroundConnectionConnected', label: 'Connected', value: 'connected' }
							] }
						] }
					] },
					{ kind: 'set', label: 'Merge', items: [
						{ kind: 'numberPair', label: 'Merge', title: 'How close two lines of text need to be before their highlight boxes merge into one shape.', items: [
							{ id: 'textBackgroundMergeDistance', slider: 'textBackgroundMergeDistance', mark: 'D', label: 'Merge Distance' },
							{ id: 'textBackgroundSpacing', slider: 'textBackgroundSpacing', mark: 'S', label: 'Spacing Sensitivity', title: 'How much tighter/looser-than-normal line spacing shifts the merge threshold.' }
						] }
					] }
				]
			},
			{ kind: 'paintSlot', slot: 'border', idPrefix: 'textBorder', title: 'Border', redesign: true,
				sourceSelect: true, sourceRevert: true, colorRevert: true,
				texturePosition: true,
				toggle: true, sourceLabel: 'Source', modes: ['glitter', 'solid'], activeMode: 'glitter',
				color: '#000000', chipTitle: 'Choose border source',
				afterSource: [
					{ kind: 'set', label: 'Stroke', items: [
						{ kind: 'slider', id: 'textBorderWidth', slider: 'textBorderWidth' }
					] }
				],
				post: [
					{ kind: 'set', label: 'Placement', items: [
					{ kind: 'stackRow', revert: true, groups: [
						{ label: 'Edges', options: [
							{ id: 'textBorderEdgeRounded', label: 'Rounded', active: true, value: 'round' },
							{ id: 'textBorderEdgeHard', label: 'Hard', value: 'hard' }
						] },
						{ label: 'Placement', control: 'select', options: [
							{ id: 'textBorderPositionOutside', label: 'Outside', active: true, value: 'outside' },
							{ id: 'textBorderPositionCenter', label: 'On Edge', value: 'center' },
							{ id: 'textBorderPositionInside', label: 'Inside', value: 'inside' }
						] },
						{ label: 'Layering', options: [
							{ id: 'textBorderOrderBehind', label: 'Behind text', active: true, value: 'behind' },
							{ id: 'textBorderOrderFront', label: 'On top', value: 'front' }
						] }
					] }
					] }
				]
			},
			{ kind: 'paintSlot', slot: 'shadow', idPrefix: 'textShadow', title: 'Shadow', redesign: true,
				sourceSelect: true, sourceRevert: true, colorRevert: true,
				texturePosition: true,
				toggle: true, sourceLabel: 'Source', modes: ['glitter', 'solid'], activeMode: 'glitter',
				color: '#000000', chipTitle: 'Choose shadow source',
				afterSource: [{ kind: 'numberPair', label: 'Offset', items: [
					{ id: 'textShadowOffsetX', slider: 'shadowOffsetX', mark: 'X', label: 'Offset X' },
					{ id: 'textShadowOffsetY', slider: 'shadowOffsetY', mark: 'Y', label: 'Offset Y' }
				] }]
			},
			{ kind: 'actionRow', classes: 'layer-effects-actions', actions: [
				{ id: 'resetTextEffects', label: 'Reset Effects', secondary: true, title: 'Disable all text effects and clear their saved settings' }
			] },
			createAnimationPanelSpec('text')
		]
	},
	[LayerType.SHAPE]: {
		prefix: 'shape',
		sectionPrefix: 'shapeSettings',
		mobileKey: 'shape',
		section: { id: 'shapeSettingsSection', classes: 'panel-redesign', icon: 'square', iconName: 'Shape', title: 'Shape Properties' },
		groups: [
			{ title: 'Content', collapsible: false, items: [
				{ kind: 'card', title: 'Asset', collapsible: true, moduleSummary: 'asset', classes: 'panel-module shape-asset-module', items: [
					{ kind: 'assetInfo', info: 'shapeAssetInfo', thumbnail: 'shapeAssetThumbnail',
						name: 'shapeAssetName', badges: 'shapeAssetBadges', change: 'shapeAssetChange',
						title: 'Choose another shape', compact: true, redesign: true },
					{ kind: 'slider', id: 'shapeRadius', slider: 'shapeRadius', rowId: 'shapeRadiusRow', hidden: true }
				] }
			] },
			// The shared transform panel emits its own Opacity card into the host;
			// this group adopts it after renderTransformPanels runs
			// (finalizePanelSchemaSections), mirroring the old shape branch of
			// the pre-schema panel order.
			{ title: 'Appearance', collapsible: false, items: [
				{ kind: 'slider', id: 'shapeLayerOpacity', slider: 'layerOpacity', label: 'Layer Opacity' },
				{ kind: 'select', id: 'shapeLayerBlendMode', label: 'Layer blend mode', visibleLabel: 'Blend', classes: 'layer-blend-mode', revert: true, options: LAYER_BLEND_MODE_OPTIONS },
				{ kind: 'paintSlot', slot: 'fill', idPrefix: 'shapeFill', title: 'Fill', redesign: true,
					sourceSelect: true, sourceRevert: true, colorRevert: true,
					texturePosition: true,
					modes: ['none', 'image', 'glitter', 'solid'], activeMode: 'solid',
					color: '#ff66cc', chipTitle: 'Choose fill glitter',
					imageAsset: {
						info: 'shapeFillImageInfo', thumbnail: 'shapeFillImageThumbnail',
						name: 'shapeFillImageName', badges: 'shapeFillImageBadges',
						change: 'shapeFillImageChange', title: 'Choose fill image', compact: true, redesign: true
					},
					sourceAdvanced: [
						{ kind: 'advanced', id: 'shapeFillImageAdvanced', label: 'Advanced', hidden: true,
							attrs: { 'data-paint-source-mode': 'image' }, items: [
							{ kind: 'set', id: 'shapeFillImageControls', label: 'Placement', items: [
							{ kind: 'select', id: 'shapeFillImageFit', label: 'Image fit', visibleLabel: 'Fit', options: CONFIG.tools.shapes.imageFill.fitUIOptions },
							{ kind: 'slider', id: 'shapeFillImageScale', slider: 'shapeImageScale' },
							{ kind: 'segmented', visibleLabel: 'Horizontal', label: 'Horizontal image alignment', options: [
								{ label: 'Left', icon: 'align-left', attrs: { 'data-fill-align': '0' } },
								{ label: 'Center', icon: 'align-center-x', active: true, attrs: { 'data-fill-align': '50' } },
								{ label: 'Right', icon: 'align-right', attrs: { 'data-fill-align': '100' } }
							] },
							{ kind: 'segmented', visibleLabel: 'Vertical', label: 'Vertical image alignment', options: [
								{ label: 'Top', icon: 'align-top', attrs: { 'data-fill-valign': '0' } },
								{ label: 'Middle', icon: 'align-center-y', active: true, attrs: { 'data-fill-valign': '50' } },
								{ label: 'Bottom', icon: 'align-bottom', attrs: { 'data-fill-valign': '100' } }
							] },
							{ kind: 'slider', id: 'shapeFillImageOffsetX', slider: 'shapeImageOffsetX' },
							{ kind: 'slider', id: 'shapeFillImageOffsetY', slider: 'shapeImageOffsetY' }
							] },
							{ kind: 'set', label: 'Rendering', items: [
								{ kind: 'segmented', visibleLabel: 'Sampling', label: 'Image rendering', options: [
									{ label: 'Smooth', active: true, attrs: { 'data-fill-rendering': 'smooth' } },
									{ label: 'Pixelated', attrs: { 'data-fill-rendering': 'pixelated' } }
								] }
							] }
						] }
					] }
			] },
			{ title: 'Transform', collapsible: false, items: [{ kind: 'transformHost' }] }
		],
		effects: [
			{ kind: 'paintSlot', slot: 'border', idPrefix: 'shapeBorder', title: 'Border', redesign: true,
				sourceSelect: true, sourceRevert: true, colorRevert: true, hideAdvanced: true,
				texturePosition: true,
				toggle: true, sourceLabel: 'Source',
				modes: ['glitter', 'solid'], activeMode: 'solid',
				color: '#000000', chipTitle: 'Choose glitter',
				afterSource: [
					{ kind: 'set', label: 'Stroke', items: [
						{ kind: 'slider', id: 'shapeBorderWidth', slider: 'borderWidth' },
						{ kind: 'optionGroup', label: 'Style', glitterSource: true, revert: true, options: [
							{ id: 'shapeBorderStyleSolid', label: 'Solid', active: true, value: 'solid' },
							{ id: 'shapeBorderStyleDotted', label: 'Dotted', value: 'dotted' }
						] },
						{ kind: 'slider', id: 'shapeBorderDotSpacing', slider: 'borderDotSpacing', rowId: 'shapeBorderDotSpacingRow', hidden: true }
					] }
				],
				post: [
					{ kind: 'set', label: 'Placement', items: [
					{ kind: 'stackRow', revert: true, groups: [
						{ label: 'Edges', options: [
							{ id: 'shapeBorderEdgeRounded', label: 'Rounded', active: true, value: 'round' },
							{ id: 'shapeBorderEdgeHard', label: 'Hard', value: 'hard' }
						] },
						{ label: 'Placement', control: 'select', options: [
							{ id: 'shapeBorderPositionOutside', label: 'Outside', active: true, value: 'outside' },
							{ id: 'shapeBorderPositionCenter', label: 'On Edge', value: 'center' },
							{ id: 'shapeBorderPositionInside', label: 'Inside', value: 'inside' }
						] },
						{ label: 'Layering', options: [
							{ id: 'shapeBorderOrderBehind', label: 'Behind', active: true, value: 'behind' },
							{ id: 'shapeBorderOrderFront', label: 'On Top', value: 'front' }
						] }
					] }
					] }
				]
			},
			{ kind: 'paintSlot', slot: 'shadow', idPrefix: 'shapeShadow', title: 'Shadow', redesign: true,
				sourceSelect: true, sourceRevert: true, colorRevert: true,
				texturePosition: true,
				toggle: true, sourceLabel: 'Source',
				modes: ['glitter', 'solid'], activeMode: 'glitter',
				color: '#000000', chipTitle: 'Choose glitter',
				afterSource: [
					{ kind: 'numberPair', label: 'Offset', items: [
						{ id: 'shapeShadowOffsetX', slider: 'shadowOffsetX', mark: 'X', label: 'Offset X' },
						{ id: 'shapeShadowOffsetY', slider: 'shadowOffsetY', mark: 'Y', label: 'Offset Y' }
					] }
				]
			},
			{ kind: 'actionRow', classes: 'layer-effects-actions', actions: [
				{ id: 'resetShapeEffects', label: 'Reset Effects', secondary: true, title: 'Disable all shape effects and clear their saved settings' }
			] },
			createAnimationPanelSpec('shape')
		]
	},
	// The document-size form (Image Size / Canvas Size). ONE self-contained
	// "Size" card, mounted into #noLayerCanvasSizeHost at boot; updateSidePanelUI
	// and BaseBackgroundManager relocate this single node to #baseCanvasSizeHost
	// for Canvas Properties. Defined last so its mount host (from the noSelection
	// schema) already exists. canvas-size.js still owns every value/range and
	// toggles #canvasSizePanel / #scaleDesignPanel by id.
	documentSize: {
		fragment: true,
		prefix: 'documentSize',
		fragmentId: 'documentSizeGroup',
		fragmentHost: 'noLayerCanvasSizeHost',
		fragmentClasses: 'document-size-group',
		fragmentCard: { title: 'Size', collapsible: true, summaryId: 'noLayerSizeSummary', summaryText: 'Image' },
		items: [
			// Operation and its mode-specific explanation form one property set;
			// the selected mode panel begins the next divided set of controls.
			{ kind: 'set', items: [
				{ kind: 'segmented', id: 'documentSizeMode', visibleLabel: 'Operation', label: 'Sizing operation',
					classes: 'document-size-mode', stacked: false, options: [
						{ label: 'Image', active: true, attrs: { 'data-size-mode': 'image', 'aria-pressed': 'true' } },
						{ label: 'Canvas', attrs: { 'data-size-mode': 'canvas', 'aria-pressed': 'false' } },
						{ label: 'Artwork', attrs: { 'data-size-mode': 'artwork', 'aria-pressed': 'false' } }
					] },
				{ kind: 'host', classes: 'property-note', attrs: { 'data-size-mode-note': 'image' }, text: 'Resize the canvas and everything in the design. Proportions stay linked.' },
				{ kind: 'host', classes: 'property-note', attrs: { 'data-size-mode-note': 'canvas', hidden: 'hidden' }, text: 'Crop or extend the canvas without scaling content.' },
				{ kind: 'host', classes: 'property-note', attrs: { 'data-size-mode-note': 'artwork', hidden: 'hidden' }, text: 'Crop or extend the canvas to fit the artwork, with optional padding.' }
			] },
			// `#canvasSizePanel` / `#scaleDesignPanel` / `#artworkCropPanel` are
			// zero-padding `.property-set` wrappers (canvas-size.js toggles their
			// `hidden`); Operation → mode panel and the inner groups are all
			// hairline-divided by the shared `.property-set + .property-set` rule,
			// the same as the Transform grid. The Reset/Apply rows are top-level
			// card items so buildPanelItem lifts them to card footers.
			{ kind: 'content', id: 'canvasSizePanel', classes: 'document-size-panel canvas-size-controls', hidden: true, items: [
				{ kind: 'set', items: [
					{ kind: 'host', id: 'canvasSizeLimitMessage', classes: 'property-note canvas-size-limit-message', attrs: { role: 'status' } },
					{ kind: 'numberPair', label: 'Size', reset: { revertFor: 'canvasSizeWidth canvasSizeHeight', title: 'Reset size' }, items: [
						{ id: 'canvasSizeWidth', mark: 'W', label: 'Width', step: 1, inputMode: 'numeric' },
						{ id: 'canvasSizeHeight', mark: 'H', label: 'Height', step: 1, inputMode: 'numeric' }
					] },
					{ kind: 'checkboxList', items: [ { id: 'canvasSizeRelative', label: 'Relative', revert: 'canvasSizeRelative' } ] },
					{ kind: 'labeled', label: 'Anchor', stacked: true, revert: 'canvasSizeAnchor', control: { kind: 'host', id: 'canvasSizeAnchor',
						classes: 'anchor-grid', attrs: { role: 'radiogroup', 'aria-label': 'Canvas resize anchor' } } }
				] }
			] },
			{ kind: 'content', id: 'scaleDesignPanel', classes: 'document-size-panel scale-design-controls', items: [
				{ kind: 'set', items: [
					{ kind: 'numberPair', label: 'Size', reset: { revertFor: 'scaleDesignWidth scaleDesignHeight', title: 'Reset size' }, items: [
						{ id: 'scaleDesignWidth', mark: 'W', label: 'Width', step: 1, inputMode: 'numeric' },
						{ id: 'scaleDesignHeight', mark: 'H', label: 'Height', step: 1, inputMode: 'numeric' }
					] },
					{ kind: 'slider', id: 'scaleDesignPercent', slider: 'documentScale', label: 'Scale' }
				] },
				{ kind: 'set', items: [
					{ kind: 'checkboxList', items: [
						{ id: 'scaleDesignTextures', label: 'Scale Textures', checked: true, revert: 'scaleDesignTextures' },
						{ id: 'scaleDesignEffects', label: 'Scale Effects', checked: true, revert: 'scaleDesignEffects' }
					] }
				] }
			] },
			{ kind: 'content', id: 'artworkCropPanel', classes: 'document-size-panel artwork-crop-controls', hidden: true, items: [
				{ kind: 'set', items: [
					{ kind: 'host', id: 'artworkCropSummary', classes: 'property-note artwork-crop-summary', attrs: { role: 'status' } },
					{ kind: 'field', id: 'artworkCropPadding', label: 'Padding', type: 'number', unit: 'px', min: 0, step: 1, value: 0, revert: 'artworkCropPadding' }
				] }
			] },
			// Extension fill applies to both structural resizes that can grow the
			// canvas beyond its current bounds — Canvas Size, and Artwork padding
			// that pushes past the old edges — so it's one shared block (not
			// duplicated per panel) shown for either mode.
			{ kind: 'set', hidden: true, attrs: { 'data-size-mode-note': 'canvas artwork' }, items: [
				{ kind: 'segmented', id: 'canvasExtensionMode', visibleLabel: 'Extension', label: 'Canvas extension fill',
					classes: 'canvas-extension-mode', stacked: false, revertFor: 'canvasExtensionMode', options: [
						{ label: 'Transparent', active: true, attrs: { 'data-extension-mode': 'transparent', 'aria-pressed': 'true' } },
						{ label: 'Color', attrs: { 'data-extension-mode': 'color', 'aria-pressed': 'false' } }
					] },
				{ kind: 'field', id: 'canvasExtensionColor', rowId: 'canvasExtensionColorRow', label: 'Fill Color',
					type: 'color', value: '#ffffff', hidden: true, revert: true }
			] },
			{ kind: 'actionRow', id: 'canvasSizeActions', classes: 'canvas-size-actions is-split', hidden: true, actions: [
				{ id: 'canvasSizeReset', label: 'Reset' },
				{ id: 'canvasSizeApply', label: 'Resize Canvas', primary: true }
			] },
			{ kind: 'actionRow', id: 'scaleDesignActions', classes: 'scale-design-actions is-split', actions: [
				{ id: 'scaleDesignReset', label: 'Reset' },
				{ id: 'scaleDesignApply', label: 'Scale Image', primary: true }
			] },
			{ kind: 'actionRow', id: 'artworkCropActions', classes: 'artwork-crop-actions is-split', hidden: true, actions: [
				{ id: 'artworkCropReset', label: 'Reset' },
				{ id: 'artworkCropApply', label: 'Crop to Artwork', primary: true }
			] }
		]
	}
};
