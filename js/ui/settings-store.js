'use strict';

// Each entry that has a row in the Export Settings modal carries its label,
// description and control (see js/ui/settings-renderer.js); `element` is the
// control's id. EXPORT_SETTINGS_LAYOUT below places the rows.
const EXPORT_SETTINGS_SCHEMA = Object.freeze({
	outputMode: { storageKey: 'exportOutputMode', default: () => CONFIG.export.defaults.outputMode, validate: (value) => ['still', 'animation'].includes(value) ? value : CONFIG.export.defaults.outputMode },
	stillFormat: { storageKey: 'exportStillFormat', default: () => CONFIG.export.defaults.stillFormat, validate: (value) => getExportFormats('still').includes(value) ? value : CONFIG.export.defaults.stillFormat },
	animationFormat: { storageKey: 'exportAnimationFormat', default: () => CONFIG.export.defaults.animationFormat, validate: (value) => getExportFormats('animation').includes(value) ? value : CONFIG.export.defaults.animationFormat },
	stillFrame: { label: 'Frame', description: 'Choose the animation moment used for this still image.', control: { type: 'select', options: [{ value: 'first', label: 'First frame' }, { value: 'current', label: 'Current frame' }] }, storageKey: 'exportStillFrame', element: 'exportStillFrame', default: () => CONFIG.export.defaults.stillFrame, validate: (value) => ['first', 'current'].includes(value) ? value : CONFIG.export.defaults.stillFrame },
	jpegQuality: { label: 'JPG Quality', description: 'Controls JPEG compression quality.', control: { type: 'number', min: 1, max: 100, step: 1, value: CONFIG.export.defaults.jpegQuality, unit: '%' }, storageKey: 'exportJpegQuality', element: 'exportJpegQuality', kind: 'integer', default: () => CONFIG.export.defaults.jpegQuality, validate: (value) => clampNumber(value, 1, 100, CONFIG.export.defaults.jpegQuality, true) },
	mp4LengthMode: { label: 'Video Length', description: 'Choose a specific video length or preserve a whole number of animation loops.', control: { type: 'select', options: [{ value: 'duration', label: 'Exact duration' }, { value: 'loops', label: 'Complete loops' }] }, storageKey: 'exportMp4LengthMode', element: 'exportMp4LengthMode', default: () => CONFIG.export.mp4.lengthMode, validate: (value) => ['duration', 'loops'].includes(value) ? value : CONFIG.export.mp4.lengthMode },
	mp4TargetDuration: { label: 'Duration', description: 'The MP4 ends exactly at this time, even if that falls partway through an animation loop.', control: { type: 'number', min: CONFIG.export.mp4.minDurationSeconds, max: CONFIG.export.mp4.maxDurationSeconds, step: 0.5, value: CONFIG.export.mp4.targetDurationSeconds, inputMode: 'decimal', ariaLabel: 'Video duration in seconds', unit: 'sec' }, storageKey: 'exportMp4TargetDuration', element: 'exportMp4TargetDuration', kind: 'number', default: () => CONFIG.export.mp4.targetDurationSeconds, validate: (value) => clampNumber(value, CONFIG.export.mp4.minDurationSeconds, CONFIG.export.mp4.maxDurationSeconds, CONFIG.export.mp4.targetDurationSeconds) },
	mp4LoopCount: { label: 'Complete Loops', description: 'The video ends after this many complete animation loops.', control: { type: 'number', min: CONFIG.export.mp4.minLoopCount, max: CONFIG.export.mp4.maxLoopCount, step: 1, value: CONFIG.export.mp4.loopCount, inputMode: 'numeric', ariaLabel: 'Number of complete animation loops', unit: '×' }, storageKey: 'exportMp4LoopCount', element: 'exportMp4LoopCount', kind: 'integer', default: () => CONFIG.export.mp4.loopCount, validate: (value) => clampNumber(value, CONFIG.export.mp4.minLoopCount, CONFIG.export.mp4.maxLoopCount, CONFIG.export.mp4.loopCount, true) },
	mp4Quality: { label: 'MP4 Quality', description: 'Higher quality uses a higher video bitrate and creates a larger file.', control: { type: 'select', options: () => Object.entries(CONFIG.export.mp4.qualityPresets).map(([value, preset]) => ({ value, label: preset.label })) }, storageKey: 'exportMp4Quality', element: 'exportMp4Quality', default: () => CONFIG.export.mp4.defaultQuality, validate: (value) => CONFIG.export.mp4.qualityPresets[value] ? value : CONFIG.export.mp4.defaultQuality },
	quality: { label: 'Encoder Precision', description: 'How carefully the GIF encoder matches subtle color differences. Higher precision takes longer to export but does not change the image dimensions.', control: { type: 'select', options: [{ value: '1', label: 'Best (slowest)' }, { value: '10', label: 'Good' }, { value: '20', label: 'Fast' }] }, storageKey: 'exportQuality', element: 'exportQuality', kind: 'integer', default: () => CONFIG.export.defaults.quality, validate: (value) => clampNumber(value, 1, 30, CONFIG.export.defaults.quality, true) },
	ditherEnabled: { label: 'Dithering', description: 'Blends the chosen GIF palette into a deliberate pixel texture. Turn off for flat art and the sharpest edges.', control: { type: 'switch' }, storageKey: 'exportDitherEnabled', element: 'exportDitherEnabled', kind: 'checkbox', default: () => CONFIG.export.defaults.ditherEnabled, validate: Boolean },
	ditherType: { label: 'Pattern', description: 'Different algorithms produce different dithering textures.', control: { type: 'select', options: [{ value: 'FloydSteinberg-serpentine', label: 'Floyd-Steinberg · Smooth' }, { value: 'FloydSteinberg', label: 'Floyd-Steinberg · Classic' }, { value: 'FalseFloydSteinberg', label: 'False Floyd-Steinberg' }, { value: 'Stucki', label: 'Stucki' }, { value: 'Atkinson', label: 'Atkinson' }, { value: 'Bayer', label: 'Ordered · Bayer' }, { value: 'Halftone', label: 'Halftone' }] }, storageKey: 'exportDitherType', element: 'exportDitherType', default: () => CONFIG.export.defaults.ditherType, validate: (value) => typeof value === 'string' && value ? value : CONFIG.export.defaults.ditherType },
	colorCount: { label: 'GIF Colors', description: 'Automatic preserves the encoder’s clean per-frame color choices. Fixed counts use one stable animation palette; fewer colors create stronger texture and smaller files.', control: { type: 'select', options: [{ value: 'auto', label: 'Automatic' }, { value: '256', label: '256 · Cleanest' }, { value: '128', label: '128 · Classic web' }, { value: '64', label: '64 · Textured' }, { value: '32', label: '32 · Crunchy' }] }, storageKey: 'exportColorCount', element: 'exportColorCount', default: () => CONFIG.export.defaults.colorCount, validate: (value) => value === 'auto' || [32, 64, 128, 256].includes(Number(value)) ? (value === 'auto' ? value : Number(value)) : CONFIG.export.defaults.colorCount },
	ditherAmount: { label: 'Strength', description: 'Lower values soften noisy dots; 100% gives full error diffusion or pattern contrast.', control: { type: 'range', min: 0, max: 100, step: 5, value: CONFIG.export.defaults.ditherAmount, outputId: 'exportDitherAmountValue', outputText: `${CONFIG.export.defaults.ditherAmount}%`, describedBy: 'exportDitherAmountDescription' }, storageKey: 'exportDitherAmount', element: 'exportDitherAmount', kind: 'integer', default: () => CONFIG.export.defaults.ditherAmount, validate: (value) => clampNumber(value, 0, 100, CONFIG.export.defaults.ditherAmount, true) },
	ditherScale: { label: 'Pattern Scale', description: 'Enlarges ordered and halftone patterns without lowering the artwork resolution. Diffusion remains naturally one-pixel grain.', control: { type: 'select', options: [{ value: '1', label: '1× Fine' }, { value: '2', label: '2×' }, { value: '3', label: '3×' }, { value: '4', label: '4× Chunky' }] }, storageKey: 'exportDitherScale', element: 'exportDitherScale', kind: 'integer', default: () => CONFIG.export.defaults.ditherScale, validate: (value) => clampNumber(value, 1, 4, CONFIG.export.defaults.ditherScale, true) },
	ditherTemporalMode: { label: 'Pattern Motion', description: 'Stable avoids crawling. Animated intentionally shifts ordered and halftone patterns between frames.', control: { type: 'select', options: 'ditherTemporalMode' }, storageKey: 'exportDitherTemporalMode', element: 'exportDitherTemporalMode', default: () => CONFIG.export.defaults.ditherTemporalMode, validate: (value) => isOptionValue('ditherTemporalMode', value) ? value : CONFIG.export.defaults.ditherTemporalMode },
	ditherEdgeProtection: { label: 'Edge Protection', description: 'Stops diffusion crossing strong boundaries, keeping text, transparency edges, and outlines cleaner.', control: { type: 'switch' }, storageKey: 'exportDitherEdgeProtection', element: 'exportDitherEdgeProtection', kind: 'checkbox', default: () => CONFIG.export.defaults.ditherEdgeProtection, validate: Boolean },
	paletteStyle: { label: 'Palette Bias', description: 'Vivid Web gives saturated pinks, blues, and glitter highlights more influence when choosing shared colors.', control: { type: 'select', options: 'paletteStyle' }, storageKey: 'exportPaletteStyle', element: 'exportPaletteStyle', default: () => CONFIG.export.defaults.paletteStyle, validate: (value) => isOptionValue('paletteStyle', value) ? value : CONFIG.export.defaults.paletteStyle },
	ditherPreset: { label: 'GIF Look', description: 'A look sets the palette and texture settings below in one step. Changing any of them switches the look to Custom.', control: { type: 'select', options: 'gifLook' }, storageKey: 'exportDitherPreset', element: 'exportDitherPreset', default: () => CONFIG.export.defaults.ditherPreset, validate: (value) => isOptionValue('gifLook', value) ? value : CONFIG.export.defaults.ditherPreset },
	baseImage: { label: 'Include Base Image', description: 'Render the Base Image beneath the other layers. Turn off to export only the glitter, stickers, text, and shapes without changing your project.', control: { type: 'switch' }, storageKey: 'exportBaseImage', element: 'exportBaseImage', kind: 'checkbox', default: () => CONFIG.export.defaults.baseImage, validate: Boolean },
	frameDelay: { label: 'Fallback Frame Time', description: 'Used only when a source has no usable timing metadata. GIF source timing is preserved.', control: { type: 'select', options: [{ value: '50', label: '50ms (20 FPS)' }, { value: '67', label: '67ms (15 FPS)' }, { value: '83', label: '83ms (12 FPS)' }, { value: '100', label: '100ms (10 FPS)' }, { value: '110', label: '110ms (9 FPS)' }, { value: '125', label: '125ms (8 FPS)' }, { value: '167', label: '167ms (6 FPS)' }] }, storageKey: 'exportFrameDelay', element: 'exportFrameDelay', kind: 'integer', default: () => CONFIG.export.defaults.frameDelay, validate: (value) => Number.isFinite(value) && value >= 20 ? Math.round(value) : 20 },
	maxFrames: { label: 'Frame Limit', description: 'A target for how many pictures make up the animation. More frames can make motion smoother, but may increase export time and file size. Important motion is kept even when it exceeds this target.', control: { type: 'select', options: [{ value: '30', label: '30 frames' }, { value: '60', label: '60 frames' }, { value: '90', label: '90 frames' }, { value: '120', label: '120 frames' }, { value: 'unlimited', label: 'Unlimited' }] }, storageKey: 'exportMaxFrames', element: 'exportMaxFrames', parse: (value) => value === 'unlimited' ? CONFIG.export.limits.maxFramesHardLimit : parseInt(value), default: () => CONFIG.export.defaults.maxFrames, validate: (value) => clampNumber(value, 1, CONFIG.export.limits.maxFramesHardLimit, CONFIG.export.defaults.maxFrames, true) },
	transparency: { label: 'Transparency', description: 'Preserve transparent areas from the original image if it has it. When disabled, transparent areas use the matte color.', control: { type: 'switch' }, storageKey: 'exportTransparency', element: 'exportTransparency', kind: 'checkbox', default: () => CONFIG.export.defaults.transparency, validate: Boolean },
	matteColor: { label: 'Matte Color', description: 'Background color for transparent areas when transparency is disabled.', control: { type: 'color', value: CONFIG.export.defaults.matteColor }, storageKey: 'exportMatteColor', element: 'exportMatteColor', default: () => CONFIG.export.defaults.matteColor, validate: (value) => /^#[0-9A-Fa-f]{6}$/.test(value) ? value : CONFIG.export.defaults.matteColor },
	watermarkEnabled: { label: 'Watermark', description: 'Add a cheeky little watermark overlay to the exported result.', control: { type: 'switch', ariaControls: 'watermarkSelectionRow' }, storageKey: 'exportWatermarkEnabled', element: 'exportWatermarkEnabled', kind: 'checkbox', default: () => CONFIG.export.defaults.watermarkEnabled, validate: Boolean },
	watermark: { label: 'Watermark Style', description: 'The preview is export-only and is not added to the canvas.', control: { type: 'select', options: () => CONFIG.export.watermark.options.map(({ url, label }) => ({ value: url, label })) }, storageKey: 'exportWatermark', element: 'exportWatermark', default: () => CONFIG.export.defaults.watermark, validate: (value) => CONFIG.export.watermark.options.some((option) => option.url === value) ? value : CONFIG.export.defaults.watermark },
	exportFrameSkip: { label: 'Keep Fewer Frames', description: 'An optional manual shortcut for smaller files. Skipped frame time is added to the frames that remain, so the speed and length stay the same.', control: { type: 'select', options: [{ value: '1', label: 'Off' }, { value: '2', label: 'Every 2nd frame' }, { value: '3', label: 'Every 3rd frame' }, { value: '4', label: 'Every 4th frame' }] }, storageKey: 'exportFrameSkip', element: 'exportFrameSkip', kind: 'integer', default: () => CONFIG.export.defaults.frameSkip, validate: (value) => Number.isFinite(value) && value >= 1 ? Math.round(value) : CONFIG.export.defaults.frameSkip },
	exportReverse: { label: 'Reverse Animation', description: 'Play animation backwards.', control: { type: 'switch' }, storageKey: 'exportReverse', element: 'exportReverse', kind: 'checkbox', default: () => CONFIG.export.defaults.reverse, validate: Boolean },
	smartFrameReduction: { label: 'Smart Frame Reduction', description: 'Combines frames that look alike and may align nearby source rates to avoid excessively long loops.', control: { type: 'switch' }, storageKey: 'exportSmartFrameReduction', element: 'exportSmartFrameReduction', kind: 'checkbox', default: () => CONFIG.export.defaults.smartFrameReduction, validate: Boolean },
	exportFidelity: { storageKey: 'exportFidelity', element: 'exportFidelity', kind: 'integer', default: () => CONFIG.export.defaults.exportFidelity, validate: (value) => clampNumber(value, 0, CONFIG.export.timeline.fidelityStops.length - 1, CONFIG.export.defaults.exportFidelity, true) },
	// 'auto' defers to the Export fidelity stop's own sampling rate. Without it the
	// stored number always won, which made the goal's fidelity setting inert.
	maxSamplingFps: { label: 'Motion Detail', description: 'How often the animation is checked for visual changes. Higher settings preserve faster motion, but can take longer and create a larger file. Slower source animations keep their original timing.', control: { type: 'select', options: [{ value: 'auto', label: 'Match fidelity setting' }, { value: '15', label: 'Standard (15 samples/sec)' }, { value: '24', label: 'Smooth (24 samples/sec)' }, { value: '30', label: 'Finest (30 samples/sec)' }] }, storageKey: 'exportMaxSamplingFps', element: 'exportMaxSamplingFps', default: () => CONFIG.export.defaults.maxSamplingFps, parse: (value) => value === 'auto' ? 'auto' : parseInt(value), validate: (value) => value === 'auto' ? 'auto' : clampNumber(value, 1, CONFIG.export.timeline.maxSamplingFps, CONFIG.export.defaults.maxSamplingFps, true) },
	visualErrorThreshold: { label: 'Max frame difference', description: 'Overrides the fidelity setting\'s visual difference limit. Set 0 for exact-pixel deduplication only.', control: { type: 'number', min: 0, max: 100, step: 0.1, placeholder: 'Auto', unit: '%' }, storageKey: 'exportVisualErrorThreshold', element: 'exportVisualErrorThreshold', default: () => CONFIG.export.defaults.visualErrorThreshold, parse: (value) => value === '' ? 'auto' : parseFloat(value) / 100, format: (value) => value === 'auto' ? '' : value * 100, validate: (value) => value === 'auto' ? 'auto' : clampNumber(value, 0, 1, CONFIG.export.defaults.visualErrorThreshold) }
});

// Row order and row-level state for the Export Settings modal. Labels,
// descriptions and controls come from EXPORT_SETTINGS_SCHEMA; widgets that are
// not a plain row are <template>s in index.html. Row visibility by format uses
// data-export-format-section (formatSection) and hidden, as updateExportActionUI
// expects.
const EXPORT_SETTINGS_LAYOUT = (() => {
	const field = (key, options = {}) => ({ field: EXPORT_SETTINGS_SCHEMA[key], ...options });
	const needsDithering = 'Turn on Dithering to change this.';
	// One button per format in each mode; updateExportFormatUI shows the
	// current mode's and marks the active one.
	const formatOption = (format, label, mode, extra = {}) => ({
		label, ...extra, attrs: { 'data-export-format': format, 'data-export-mode': mode, ...extra.attrs }
	});
	return [
		{ title: 'Output', section: 'output', rows: [
			// Type and Format are buttons, not inputs, so their reverts are bound
			// by the export settings code (data-revert-for names the control).
			{ field: { label: 'Export Type', control: { type: 'segmented', id: 'exportModeControl', ariaLabel: 'Export type', revertFor: 'exportModeControl', options: [
				{ label: 'Still Image', attrs: { 'data-export-mode': 'still' } },
				{ label: 'Animation', active: true, attrs: { 'data-export-mode': 'animation' } }
			] } } },
			{ field: { label: 'Format', description: 'Export an animated GIF.', control: { type: 'segmented', id: 'exportFormatControl', ariaLabel: 'Export format', revertFor: 'exportFormatControl', options: [
				formatOption('png', 'PNG', 'still'),
				formatOption('jpeg', 'JPG', 'still'),
				formatOption('gif', 'GIF', 'still'),
				formatOption('gif', 'GIF', 'animation', { active: true }),
				formatOption('mp4', 'MP4', 'animation', { attrs: { hidden: '' } })
			] } }, descId: 'exportFormatDescription' },
			field('stillFrame', { rowId: 'exportStillFrameRow', hidden: true }),
			field('transparency', { rowId: 'transparencySettingsRow', formatSection: 'gif' }),
			field('matteColor', { rowId: 'matteColorRow', inactiveReason: 'Turn off Transparency to use a matte color.' }),
			field('baseImage', { aliases: 'photo background original artwork behind' }),
			field('watermarkEnabled'),
			field('watermark', { rowId: 'watermarkSelectionRow', inactiveReason: 'Turn on Watermark to choose a style.', afterHeader: 'tplExportWatermarkPreview' })
		] },
		{ title: 'Playback', section: 'playback', rows: [
			field('mp4LengthMode', { formatSection: 'mp4', hidden: true }),
			field('mp4TargetDuration', { rowId: 'exportMp4TargetDurationRow', formatSection: 'mp4', hidden: true }),
			field('mp4LoopCount', { rowId: 'exportMp4LoopCountRow', formatSection: 'mp4', hidden: true }),
			{ host: 'tplExportMp4EstimateRow' },
			field('frameDelay', { formatSection: 'gif' }),
			field('exportReverse')
		] },
		{ title: 'Quality', section: 'quality', rows: [
			field('jpegQuality', { rowId: 'exportJpegQualityRow', hidden: true }),
			field('mp4Quality', { formatSection: 'mp4', hidden: true }),
			{ governed: {
				id: 'exportGifLookSet', formatSection: 'gif',
				railId: 'exportGifLookRail', label: 'Settings controlled by GIF Look',
				// The look writes these rows, so its own revert restores them.
				rowReverts: false,
				header: field('ditherPreset', { filterPin: true, afterDescription: 'tplExportGifLookPreview' }),
				rows: [
					field('colorCount'),
					field('paletteStyle'),
					field('ditherEnabled'),
					field('ditherType', { rowId: 'ditherTypeRow', inactiveReason: needsDithering }),
					field('ditherAmount', { rowId: 'ditherAmountRow', inactiveReason: needsDithering, descId: 'exportDitherAmountDescription' }),
					field('ditherScale', { rowId: 'ditherScaleRow', inactiveReason: needsDithering }),
					field('ditherTemporalMode', { rowId: 'ditherTemporalModeRow', inactiveReason: needsDithering }),
					field('ditherEdgeProtection', { rowId: 'ditherEdgeProtectionRow', inactiveReason: needsDithering })
				]
			} }
		] },
		{ title: 'Optimization', section: 'optimization', rows: [
			field('quality', { formatSection: 'gif', aliases: 'color quality encoder accuracy precision' }),
			{ governed: {
				id: 'exportFidelitySet',
				railId: 'exportFidelityRail', label: 'Settings controlled by Export fidelity',
				// Slider with stop ticks and a live estimate: a custom widget.
				header: { host: 'tplExportFidelityHeader', revert: { ...EXPORT_SETTINGS_SCHEMA.exportFidelity, label: 'Export fidelity' } },
				rows: [
					field('maxSamplingFps'),
					field('visualErrorThreshold'),
					field('maxFrames'),
					field('smartFrameReduction'),
					field('exportFrameSkip')
				]
			} }
		] }
	];
})();

// The app Settings modal. Its values live in two stores (editor settings and
// PREFERENCES), so the rows declare their fields here, each with the default
// its revert restores.
const APP_SETTINGS_LAYOUT = (() => {
	const toggle = (id, label, description, { default: value, ...options } = {}) => ({ field: { id, label, description, control: { type: 'switch' }, default: value }, ...options });
	const preference = (key) => PREFERENCE_SCHEMA[key].default();
	const action = (label, description, button, options = {}) => ({ field: { label, description, control: { type: 'button', ...button } }, ...options });
	const choice = (id, label, description, options) => ({ field: { id, label, description, control: { type: 'select', options } } });
	const pixels = (id, label, description, min) => ({ field: { id, label, description, control: { type: 'number', min, max: 4096, step: 10, inputMode: 'numeric', unit: 'px' } } });
	return [
		{ title: 'Interface', section: 'interface', rows: [
			{ field: { id: 'interfaceTheme', label: 'Theme', description: 'Choose the editor interface appearance.', control: { type: 'select', options: 'interfaceTheme' }, default: 'dark' } },
			toggle('showAllControls', 'Show All Controls', 'Keep More and Advanced controls visible in property panels.', { default: preference('showAllControls') }),
			toggle('showHelpfulHints', 'Helpful Hints', 'Show contextual hints based on active tool and selected layer.', { default: CONFIG.ui.hints.enabledByDefault }),
			toggle('showWelcomeOnStartup', 'Welcome on Startup', 'Show the Welcome screen when Glitter Editor starts.', { default: true, hidden: !CONFIG.app.startup.showWelcome }),
			toggle('confirmDestructiveActions', 'Confirm Destructive Actions', 'Ask before deleting layers or clearing paint.', { default: true }),
			toggle('reduceMotion', 'Reduce Motion', 'Turn off interface transitions and animated previews. Exported animation is unaffected.', { default: preference('reduceMotion'), aliases: 'animation accessibility motion transitions' })
		] },
		{ title: 'Tools & Workspace', section: 'tools', rows: [
			{ field: { id: 'filterPreviewLevel', label: 'Pixel Filter Preview', description: 'Choose whether pixel-only filter layers render on the canvas. Animated previews use more memory and may fall back to Still.', control: { type: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'still', label: 'Still' }, { value: 'animated', label: 'Animated (uses more memory)' }] }, default: preference('filterPreviewLevel') } },
			toggle('autoSelectLayers', 'Auto-Select Layers', 'Clicking the canvas selects the layer under the pointer. Turn off to keep the current selection while dragging on the canvas.', { default: preference('autoSelect'), aliases: 'click pick layer canvas' }),
			toggle('snappingEnabled', 'Snapping', 'Align layers to the canvas edges, its center, and other layers while dragging.', { default: preference('snappingEnabled'), aliases: 'snap align guides magnetic' }),
			toggle('panInertia', 'Pan Momentum', 'Let the canvas keep gliding after a flick with the Hand tool. Turn off for panning that stops the moment you let go.', { default: preference('panInertia'), aliases: 'momentum pan flick scroll' }),
			toggle('pixelGrid', 'Pixel Grid', 'Show a one-screen-pixel grid at 600% zoom and above.', { default: preference('pixelGrid'), aliases: 'pixels zoom grid photoshop' }),
			toggle('antialiasMaskEdges', 'Antialias Edges', 'Smooth rendered edges on text and shapes, plus edges of future Fill layer mask strokes. Aliasing = Pixelated edge, Anti-Aliasing = Smooth edge.', { default: !preference('crispMaskEdges') }),
			toggle('scaleEffectsOnTransform', 'Scale Outlines & Effects', 'Scale outline widths, dotted spacing, and shadow offsets when text or shapes are resized.', { default: preference('scaleEffects') }),
			toggle('scaleTexturesOnTransform', 'Transform Textures', 'Scale glitter texture size with text and shapes. Turn off to resize the artwork while keeping the repeat size unchanged.', { default: preference('scaleTextures') }),
			action('Brush & Eraser Defaults', 'Restore saved Brush and Eraser tip, stroke, and pressure settings.', { id: 'resetToolSettings', label: 'Reset Tools' }),
			action('Panel Layout', 'Return collapsible property and tool cards to their default open or closed state.', { id: 'resetPanelLayout', label: 'Reset Panels' }),
			action('Toolbar Position', 'Return the floating tool bar to its default position at the bottom of the canvas.', { id: 'resetToolbarPlacement', label: 'Reset Toolbar' }, { aliases: 'context bar position moved dragged floating' })
		] },
		// Localhost-only experiment: HtmlSceneExporter reveals the group and
		// binds every control by id.
		{ title: 'Experimental HTML Scene', badge: 'Localhost', id: 'htmlSceneSettingsGroup', hidden: true, rows: [
			toggle('htmlSceneResponsive', 'Responsive Scene', 'Keep the artboard aspect ratio while it grows and shrinks with its container.'),
			choice('htmlSceneStickerSizing', 'Responsive Stickers', 'Scale the whole composition, or keep sticker dimensions fixed while their center positions remain proportional.', [{ value: 'scale', label: 'Scale with scene' }, { value: 'fixed', label: 'Keep pixel size' }]),
			pixels('htmlSceneMaxWidth', 'Maximum Width', 'Limit how wide a responsive scene can grow in its destination.', 100),
			choice('htmlSceneBackground', 'Background', 'Match the current Canvas Background source or export one of its saved fill sources directly. The Base Image remains separate and optional.', [{ value: 'canvas', label: 'Match Canvas' }, { value: 'transparent', label: 'Transparent' }, { value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }, { value: 'glitter', label: 'Glitter' }]),
			{ field: { id: 'htmlSceneCustomBackground', label: 'Solid Color', control: { type: 'color' } } },
			toggle('htmlSceneIncludeBaseImage', 'Include Base Image', 'Embed the original Base Image beneath the stickers. Canvas pixel effects are not baked into this image.'),
			choice('htmlSceneAlignment', 'Scene Alignment', 'Align the scene vertically inside a taller modal hero or cropped scene shell.', [{ value: 'center', label: 'Center' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }]),
			pixels('htmlSceneMinHeight', 'Minimum Height', 'Add vertical room around a contained scene. In Cover mode, this becomes the cropped hero height.', 0),
			choice('htmlSceneFit', 'Scene Fit', 'Keep the whole scene visible or enlarge it to cover the hero height and crop the overflow.', [{ value: 'contain', label: 'Contain' }, { value: 'cover', label: 'Cover and crop' }]),
			choice('htmlSceneBackgroundRepeat', 'Glitter Repeat', 'Control tiling when the HTML background source is glitter.', [{ value: 'repeat', label: 'Repeat' }, { value: 'no-repeat', label: 'No repeat' }, { value: 'repeat-x', label: 'Repeat horizontally' }, { value: 'repeat-y', label: 'Repeat vertically' }]),
			choice('htmlSceneOverflow', 'Outside Stickers', 'Choose whether stickers extending past the artboard remain visible.', [{ value: 'hidden', label: 'Clip to scene' }, { value: 'visible', label: 'Allow overflow' }]),
			choice('htmlSceneImageRendering', 'Image Rendering', 'Keep classic sticker pixels crisp or let the browser smooth scaled art.', [{ value: 'pixelated', label: 'Pixelated' }, { value: 'auto', label: 'Smooth' }]),
			toggle('htmlSceneEmbedAssets', 'Embed Assets', 'Embed sticker and glitter files for portable output. Off uses their existing paths; uploaded session-only assets still embed automatically.', { aliases: 'asset path url portable standalone' }),
			{ field: { label: 'Sticker HTML', description: 'Optional links, alt text, titles, and CSS classes for each visible sticker.', control: { type: 'host', id: 'htmlSceneStickerMetadata', className: 'html-scene-sticker-list' } }, aliases: 'link url href alt text title tooltip class css' },
			{ field: { label: 'Export Scene', description: 'Copy an embeddable scene with scoped CSS or download a complete standalone HTML page. This experimental sticker-only format ignores Filter layers.', control: { type: 'actions', actions: [
				{ id: 'copyHtmlSceneSnippet', label: 'Copy Snippet' },
				{ id: 'exportHtmlScene', label: 'Export HTML', primary: true }
			] } }, statusId: 'htmlSceneStatus' }
		] }
	];
})();

// Render both settings modals. Runs before anything binds their controls.
function renderSettingsModals() {
	renderSettingsGroups(document.getElementById('exportSettingsGroups'), EXPORT_SETTINGS_LAYOUT);
	renderSettingsGroups(document.getElementById('settingsGroups'), APP_SETTINGS_LAYOUT);
}

function clampNumber(value, minimum, maximum, fallback, integer = false) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	const clamped = Math.min(maximum, Math.max(minimum, numeric));
	return integer ? Math.round(clamped) : clamped;
}

class SettingsStore {
	constructor(schema) {
		this.schema = schema;
		this.boundElements = new WeakSet();
	}

	load(source = {}) {
		const migratedSource = { ...source };
		if (!Object.prototype.hasOwnProperty.call(migratedSource, 'exportOutputMode')) {
			migratedSource.exportOutputMode = 'animation';
			migratedSource.exportAnimationFormat = getExportFormats('animation').includes(migratedSource.exportFormat)
				? migratedSource.exportFormat
				: CONFIG.export.defaults.animationFormat;
		}
		if (!Object.prototype.hasOwnProperty.call(migratedSource, 'exportFidelity')) {
			const legacyPreset = migratedSource.exportOptimizationPreset ?? migratedSource.optimizationPreset;
			const legacyStops = { highFidelity: 1, balanced: 2, smallFile: 3 };
			if (Object.prototype.hasOwnProperty.call(legacyStops, legacyPreset)) migratedSource.exportFidelity = legacyStops[legacyPreset];
		}
		return Object.fromEntries(Object.entries(this.schema).map(([key, spec]) => {
			const value = Object.prototype.hasOwnProperty.call(migratedSource, spec.storageKey)
				? migratedSource[spec.storageKey]
				: spec.default();
			return [key, spec.validate(value)];
		}));
	}

	validate(values) {
		Object.entries(this.schema).forEach(([key, spec]) => {
			values[key] = spec.validate(values[key]);
		});
		return values;
	}

	serialize(values) {
		return Object.fromEntries(Object.entries(this.schema).map(([key, spec]) => [
			spec.storageKey,
			values[key]
		]));
	}

	syncToUI(values) {
		Object.entries(this.schema).forEach(([key, spec]) => {
			if (!spec.element) return;
			const element = el(spec.element);
			if (!element) return;
			if (spec.kind === 'checkbox') element.checked = Boolean(values[key]);
			else element.value = spec.format ? spec.format(values[key]) : values[key];
		});
	}

	bindListeners(values, onChange) {
		Object.entries(this.schema).forEach(([key, spec]) => {
			if (!spec.element) return;
			const element = el(spec.element);
			if (!element || this.boundElements.has(element)) return;
			this.boundElements.add(element);
			element.addEventListener('change', () => {
				const rawValue = spec.kind === 'checkbox' ? element.checked : element.value;
				const parsed = spec.parse ? spec.parse(rawValue) : spec.kind === 'number'
					? parseFloat(rawValue)
					: spec.kind === 'integer' ? parseInt(rawValue) : rawValue;
				values[key] = spec.validate(parsed);
				onChange?.(key, values[key], element);
			});
		});
	}

	reset(values) {
		Object.entries(this.schema).forEach(([key, spec]) => {
			values[key] = spec.default();
		});
		return this.validate(values);
	}
}
