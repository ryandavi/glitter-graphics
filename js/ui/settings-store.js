'use strict';

// Each entry that has a row in the Export Settings modal carries its label,
// description and control (see js/ui/settings-renderer.js); `element` is the
// control's id. EXPORT_SETTINGS_LAYOUT below places the rows.
const EXPORT_SETTINGS_SCHEMA = Object.freeze({
	svgTextMode: { label: 'SVG Text', description: 'Paths preserve lettering without installing fonts. Editable text requires the font; warped text always uses paths.', control: { type: 'select', options: [{ value: 'paths', label: 'Convert to paths' }, { value: 'editable', label: 'Editable text' }] }, storageKey: 'exportSvgTextMode', element: 'exportSvgTextMode', default: () => CONFIG.export.defaults.svgTextMode, validate: (value) => ['paths', 'editable'].includes(value) ? value : CONFIG.export.defaults.svgTextMode },
	outputMode: { storageKey: 'exportOutputMode', default: () => CONFIG.export.defaults.outputMode, validate: (value) => ['still', 'animation'].includes(value) ? value : CONFIG.export.defaults.outputMode },
	stillFormat: { storageKey: 'exportStillFormat', default: () => CONFIG.export.defaults.stillFormat, validate: (value) => getExportFormats('still').includes(value) ? value : CONFIG.export.defaults.stillFormat },
	animationFormat: { storageKey: 'exportAnimationFormat', default: () => CONFIG.export.defaults.animationFormat, validate: (value) => getExportFormats('animation').includes(value) ? value : CONFIG.export.defaults.animationFormat },
	stillFrame: { label: 'Frame', description: 'Choose the animation moment used for this still image.', control: { type: 'select', options: [{ value: 'first', label: 'First frame' }, { value: 'current', label: 'Current frame' }] }, storageKey: 'exportStillFrame', element: 'exportStillFrame', default: () => CONFIG.export.defaults.stillFrame, validate: (value) => ['first', 'current'].includes(value) ? value : CONFIG.export.defaults.stillFrame },
	outputScale: { label: 'Export Size', description: 'Export smaller than the canvas. The project keeps its full size.', control: { type: 'number', min: CONFIG.export.limits.minOutputScale, max: 100, step: 5, value: CONFIG.export.defaults.outputScale, inputMode: 'numeric', ariaLabel: 'Export size as a percent of the canvas', unit: '%' }, storageKey: 'exportOutputScale', element: 'exportOutputScale', kind: 'integer', default: () => CONFIG.export.defaults.outputScale, validate: (value) => clampNumber(value, CONFIG.export.limits.minOutputScale, 100, CONFIG.export.defaults.outputScale, true) },
	targetSize: { label: 'File Size Limit', description: 'If the file comes out larger, it is exported again with fewer frames, fewer colors or a smaller size until it fits. Your settings here are not changed.', control: { type: 'select', options: () => [{ value: 'none', label: 'No limit' }, ...CONFIG.export.sizeTargets.map((target) => ({ value: target.id, label: `${target.service} · ${formatSizeLimit(target.limitKB)}` })), { value: 'custom', label: 'Custom' }] }, storageKey: 'exportTargetSize', element: 'exportTargetSize', default: () => CONFIG.export.defaults.targetSize, validate: (value) => value === 'custom' || CONFIG.export.sizeTargets.some((target) => target.id === value) ? value : CONFIG.export.defaults.targetSize },
	targetSizeKB: { label: 'Limit', description: '', control: { type: 'number', min: CONFIG.export.fit.minTargetKB, max: CONFIG.export.fit.maxTargetKB, step: 10, value: CONFIG.export.defaults.targetSizeKB, inputMode: 'numeric', ariaLabel: 'Largest file size in kilobytes', unit: 'KB' }, storageKey: 'exportTargetSizeKB', element: 'exportTargetSizeKB', kind: 'integer', default: () => CONFIG.export.defaults.targetSizeKB, validate: (value) => clampNumber(value, CONFIG.export.fit.minTargetKB, CONFIG.export.fit.maxTargetKB, CONFIG.export.defaults.targetSizeKB, true) },
	jpegQuality: { label: 'JPG Quality', description: 'Higher looks better and makes a larger file.', control: { type: 'number', min: 1, max: 100, step: 1, value: CONFIG.export.defaults.jpegQuality, unit: '%' }, storageKey: 'exportJpegQuality', element: 'exportJpegQuality', kind: 'integer', default: () => CONFIG.export.defaults.jpegQuality, validate: (value) => clampNumber(value, 1, 100, CONFIG.export.defaults.jpegQuality, true) },
	mp4LengthMode: { label: 'Video Length', description: 'Choose a specific video length or preserve a whole number of animation loops.', control: { type: 'select', options: [{ value: 'duration', label: 'Exact duration' }, { value: 'loops', label: 'Complete loops' }] }, storageKey: 'exportMp4LengthMode', element: 'exportMp4LengthMode', default: () => CONFIG.export.mp4.lengthMode, validate: (value) => ['duration', 'loops'].includes(value) ? value : CONFIG.export.mp4.lengthMode },
	mp4TargetDuration: { label: 'Duration', description: 'The MP4 ends exactly at this time, even if that falls partway through an animation loop.', control: { type: 'number', min: CONFIG.export.mp4.minDurationSeconds, max: CONFIG.export.mp4.maxDurationSeconds, step: 0.5, value: CONFIG.export.mp4.targetDurationSeconds, inputMode: 'decimal', ariaLabel: 'Video duration in seconds', unit: 'sec' }, storageKey: 'exportMp4TargetDuration', element: 'exportMp4TargetDuration', kind: 'number', default: () => CONFIG.export.mp4.targetDurationSeconds, validate: (value) => clampNumber(value, CONFIG.export.mp4.minDurationSeconds, CONFIG.export.mp4.maxDurationSeconds, CONFIG.export.mp4.targetDurationSeconds) },
	mp4LoopCount: { label: 'Complete Loops', description: 'The video ends after this many complete animation loops.', control: { type: 'number', min: CONFIG.export.mp4.minLoopCount, max: CONFIG.export.mp4.maxLoopCount, step: 1, value: CONFIG.export.mp4.loopCount, inputMode: 'numeric', ariaLabel: 'Number of complete animation loops', unit: '×' }, storageKey: 'exportMp4LoopCount', element: 'exportMp4LoopCount', kind: 'integer', default: () => CONFIG.export.mp4.loopCount, validate: (value) => clampNumber(value, CONFIG.export.mp4.minLoopCount, CONFIG.export.mp4.maxLoopCount, CONFIG.export.mp4.loopCount, true) },
	mp4Quality: { label: 'MP4 Quality', description: 'Higher looks better and makes a larger file.', control: { type: 'select', options: () => Object.entries(CONFIG.export.mp4.qualityPresets).map(([value, preset]) => ({ value, label: preset.label })) }, storageKey: 'exportMp4Quality', element: 'exportMp4Quality', default: () => CONFIG.export.mp4.defaultQuality, validate: (value) => CONFIG.export.mp4.qualityPresets[value] ? value : CONFIG.export.mp4.defaultQuality },
	quality: { label: 'Color Accuracy', description: 'How carefully colors are matched. Best takes longest to export.', control: { type: 'select', options: [{ value: '1', label: 'Best (slowest)' }, { value: '10', label: 'Good' }, { value: '20', label: 'Fast' }] }, storageKey: 'exportQuality', element: 'exportQuality', kind: 'integer', default: () => CONFIG.export.defaults.quality, validate: (value) => clampNumber(value, 1, 30, CONFIG.export.defaults.quality, true) },
	ditherEnabled: { label: 'Dithering', description: 'Mixes dots of the colors it has to suggest the ones it does not. Off is sharpest for flat art.', control: { type: 'switch' }, storageKey: 'exportDitherEnabled', element: 'exportDitherEnabled', kind: 'checkbox', default: () => CONFIG.export.defaults.ditherEnabled, validate: Boolean },
	ditherType: { label: 'Pattern', description: '', control: { type: 'select', options: [{ value: 'FloydSteinberg-serpentine', label: 'Smooth (Floyd-Steinberg)' }, { value: 'FloydSteinberg', label: 'Classic (Floyd-Steinberg)' }, { value: 'FalseFloydSteinberg', label: 'Rough (False Floyd-Steinberg)' }, { value: 'Stucki', label: 'Soft (Stucki)' }, { value: 'Atkinson', label: 'Airy (Atkinson)' }, { value: 'Bayer', label: 'Grid (Bayer)' }, { value: 'Halftone', label: 'Dots (Halftone)' }] }, storageKey: 'exportDitherType', element: 'exportDitherType', default: () => CONFIG.export.defaults.ditherType, validate: (value) => typeof value === 'string' && value ? value : CONFIG.export.defaults.ditherType },
	colorCount: { label: 'Colors', description: 'Automatic picks the best colors for each frame. A fixed number uses one palette for the whole animation: fewer colors give more texture and a smaller file.', control: { type: 'select', options: [{ value: 'auto', label: 'Automatic' }, { value: '256', label: '256 · Cleanest' }, { value: '128', label: '128 · Classic web' }, { value: '64', label: '64 · Textured' }, { value: '32', label: '32 · Crunchy' }] }, storageKey: 'exportColorCount', element: 'exportColorCount', default: () => CONFIG.export.defaults.colorCount, validate: (value) => value === 'auto' || [32, 64, 128, 256].includes(Number(value)) ? (value === 'auto' ? value : Number(value)) : CONFIG.export.defaults.colorCount },
	ditherAmount: { label: 'Strength', description: 'How strongly the dots show.', control: { type: 'range', min: 0, max: 100, step: 5, value: CONFIG.export.defaults.ditherAmount, outputId: 'exportDitherAmountValue', outputText: `${CONFIG.export.defaults.ditherAmount}%`, describedBy: 'exportDitherAmountDescription' }, storageKey: 'exportDitherAmount', element: 'exportDitherAmount', kind: 'integer', default: () => CONFIG.export.defaults.ditherAmount, validate: (value) => clampNumber(value, 0, 100, CONFIG.export.defaults.ditherAmount, true) },
	ditherScale: { label: 'Pattern Scale', description: 'Bigger dots without lowering the picture\'s resolution.', control: { type: 'select', options: [{ value: '1', label: '1× Fine' }, { value: '2', label: '2×' }, { value: '3', label: '3×' }, { value: '4', label: '4× Chunky' }] }, storageKey: 'exportDitherScale', element: 'exportDitherScale', kind: 'integer', default: () => CONFIG.export.defaults.ditherScale, validate: (value) => clampNumber(value, 1, 4, CONFIG.export.defaults.ditherScale, true) },
	ditherTemporalMode: { label: 'Pattern Motion', description: 'Stable keeps the dots still. Animated moves them every frame.', control: { type: 'select', options: 'ditherTemporalMode' }, storageKey: 'exportDitherTemporalMode', element: 'exportDitherTemporalMode', default: () => CONFIG.export.defaults.ditherTemporalMode, validate: (value) => isOptionValue('ditherTemporalMode', value) ? value : CONFIG.export.defaults.ditherTemporalMode },
	ditherEdgeProtection: { label: 'Edge Protection', description: 'Keeps dots from spilling across hard edges such as text and outlines.', control: { type: 'switch' }, storageKey: 'exportDitherEdgeProtection', element: 'exportDitherEdgeProtection', kind: 'checkbox', default: () => CONFIG.export.defaults.ditherEdgeProtection, validate: Boolean },
	paletteStyle: { label: 'Style', description: 'Which colors win when there are too many to keep. Vivid Web favors bright pinks, blues and glitter highlights.', control: { type: 'select', options: 'paletteStyle' }, storageKey: 'exportPaletteStyle', element: 'exportPaletteStyle', default: () => CONFIG.export.defaults.paletteStyle, validate: (value) => isOptionValue('paletteStyle', value) ? value : CONFIG.export.defaults.paletteStyle },
	ditherPreset: { label: 'GIF Look', description: 'Sets the colors and texture in one step. Open Customize to change them yourself.', control: { type: 'select', options: 'gifLook' }, storageKey: 'exportDitherPreset', element: 'exportDitherPreset', default: () => CONFIG.export.defaults.ditherPreset, validate: (value) => isOptionValue('gifLook', value) ? value : CONFIG.export.defaults.ditherPreset },
	baseImage: { label: 'Include Base Image', description: 'Off exports only what you added on top. The project is not changed.', control: { type: 'switch' }, storageKey: 'exportBaseImage', element: 'exportBaseImage', kind: 'checkbox', default: () => CONFIG.export.defaults.baseImage, validate: Boolean },
	frameDelay: { label: 'Default Frame Time', description: 'Used for animations that carry no timing of their own. Animated GIFs keep theirs.', control: { type: 'select', options: [{ value: '50', label: '50ms (20 FPS)' }, { value: '67', label: '67ms (15 FPS)' }, { value: '83', label: '83ms (12 FPS)' }, { value: '100', label: '100ms (10 FPS)' }, { value: '110', label: '110ms (9 FPS)' }, { value: '125', label: '125ms (8 FPS)' }, { value: '167', label: '167ms (6 FPS)' }] }, storageKey: 'exportFrameDelay', element: 'exportFrameDelay', kind: 'integer', default: () => CONFIG.export.defaults.frameDelay, validate: (value) => Number.isFinite(value) && value >= 20 ? Math.round(value) : 20 },
	maxFrames: { label: 'Frame Limit', description: 'A target, not a hard cap: motion that needs more frames keeps them.', control: { type: 'select', options: [{ value: '30', label: '30 frames' }, { value: '60', label: '60 frames' }, { value: '90', label: '90 frames' }, { value: '120', label: '120 frames' }, { value: 'unlimited', label: 'Unlimited' }] }, storageKey: 'exportMaxFrames', element: 'exportMaxFrames', parse: (value) => value === 'unlimited' ? CONFIG.export.limits.maxFramesHardLimit : parseInt(value), default: () => CONFIG.export.defaults.maxFrames, validate: (value) => clampNumber(value, 1, CONFIG.export.limits.maxFramesHardLimit, CONFIG.export.defaults.maxFrames, true) },
	transparency: { label: 'Transparency', description: 'Keep see-through areas see-through. Off fills them with the matte color.', control: { type: 'switch' }, storageKey: 'exportTransparency', element: 'exportTransparency', kind: 'checkbox', default: () => CONFIG.export.defaults.transparency, validate: Boolean },
	matteColor: { label: 'Matte Color', description: 'Fills the transparent areas.', control: { type: 'color', value: CONFIG.export.defaults.matteColor }, storageKey: 'exportMatteColor', element: 'exportMatteColor', default: () => CONFIG.export.defaults.matteColor, validate: (value) => /^#[0-9A-Fa-f]{6}$/.test(value) ? value : CONFIG.export.defaults.matteColor },
	watermarkEnabled: { label: 'Watermark', description: 'Add a cheeky little watermark overlay to the exported result.', control: { type: 'switch', ariaControls: 'watermarkSelectionRow' }, storageKey: 'exportWatermarkEnabled', element: 'exportWatermarkEnabled', kind: 'checkbox', default: () => CONFIG.export.defaults.watermarkEnabled, validate: Boolean },
	watermark: { label: 'Watermark Style', description: 'Added to the exported file only, never to the canvas.', control: { type: 'select', options: () => CONFIG.export.watermark.options.map(({ url, label }) => ({ value: url, label })) }, storageKey: 'exportWatermark', element: 'exportWatermark', default: () => CONFIG.export.defaults.watermark, validate: (value) => CONFIG.export.watermark.options.some((option) => option.url === value) ? value : CONFIG.export.defaults.watermark },
	exportFrameSkip: { label: 'Keep Fewer Frames', description: 'Drops frames for a smaller file. The remaining frames are held longer, so speed and length stay the same.', control: { type: 'select', options: [{ value: '1', label: 'Off' }, { value: '2', label: 'Every 2nd frame' }, { value: '3', label: 'Every 3rd frame' }, { value: '4', label: 'Every 4th frame' }] }, storageKey: 'exportFrameSkip', element: 'exportFrameSkip', kind: 'integer', default: () => CONFIG.export.defaults.frameSkip, validate: (value) => Number.isFinite(value) && value >= 1 ? Math.round(value) : CONFIG.export.defaults.frameSkip },
	exportReverse: { label: 'Reverse Animation', description: 'Play the animation backwards.', control: { type: 'switch' }, storageKey: 'exportReverse', element: 'exportReverse', kind: 'checkbox', default: () => CONFIG.export.defaults.reverse, validate: Boolean },
	smartFrameReduction: { label: 'Smart Frame Reduction', description: 'Merges frames that look alike, and brings animations with nearly matching speeds into step so the loop stays short.', control: { type: 'switch' }, storageKey: 'exportSmartFrameReduction', element: 'exportSmartFrameReduction', kind: 'checkbox', default: () => CONFIG.export.defaults.smartFrameReduction, validate: Boolean },
	exportFidelity: { storageKey: 'exportFidelity', element: 'exportFidelity', kind: 'integer', default: () => CONFIG.export.defaults.exportFidelity, validate: (value) => clampNumber(value, 0, CONFIG.export.timeline.fidelityStops.length - 1, CONFIG.export.defaults.exportFidelity, true) },
	// 'auto' defers to the Export fidelity stop's own sampling rate. Without it the
	// stored number always won, which made the goal's fidelity setting inert.
	maxSamplingFps: { label: 'Motion Detail', description: 'How often the animation is checked for change. Higher keeps fast motion, takes longer and makes a larger file.', control: { type: 'select', options: [{ value: 'auto', label: 'Automatic' }, { value: '15', label: 'Standard (15 samples/sec)' }, { value: '24', label: 'Smooth (24 samples/sec)' }, { value: '30', label: 'Finest (30 samples/sec)' }] }, storageKey: 'exportMaxSamplingFps', element: 'exportMaxSamplingFps', default: () => CONFIG.export.defaults.maxSamplingFps, parse: (value) => value === 'auto' ? 'auto' : parseInt(value), validate: (value) => value === 'auto' ? 'auto' : clampNumber(value, 1, CONFIG.export.timeline.maxSamplingFps, CONFIG.export.defaults.maxSamplingFps, true) },
	visualErrorThreshold: { label: 'Max Frame Difference', description: 'Frames that differ by less than this are merged. Blank follows Export Fidelity; 0 merges only identical frames.', control: { type: 'number', min: 0, max: 100, step: 0.1, placeholder: 'Auto', unit: '%' }, storageKey: 'exportVisualErrorThreshold', element: 'exportVisualErrorThreshold', default: () => CONFIG.export.defaults.visualErrorThreshold, parse: (value) => value === '' ? 'auto' : parseFloat(value) / 100, format: (value) => value === 'auto' ? '' : value * 100, validate: (value) => value === 'auto' ? 'auto' : clampNumber(value, 0, 1, CONFIG.export.defaults.visualErrorThreshold) }
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
		{ title: 'Format', section: 'format', rows: [
			// Type and Format are buttons, not inputs, so their reverts are bound
			// by the export settings code (data-revert-for names the control).
			{ field: { label: 'Export Type', control: { type: 'segmented', id: 'exportModeControl', ariaLabel: 'Export type', revertFor: 'exportModeControl', options: [
				{ label: 'Still Image', attrs: { 'data-export-mode': 'still' } },
				{ label: 'Animation', active: true, attrs: { 'data-export-mode': 'animation' } }
			] } } },
			{ field: { label: 'Format', description: 'Export an animated GIF.', control: { type: 'segmented', id: 'exportFormatControl', ariaLabel: 'Export format', revertFor: 'exportFormatControl', options: [
				formatOption('png', 'PNG', 'still'),
				formatOption('jpeg', 'JPG', 'still'),
				formatOption('gif', 'GIF', 'still'), formatOption('svg', 'SVG', 'still'),
				formatOption('gif', 'GIF', 'animation', { active: true }),
				formatOption('mp4', 'MP4', 'animation', { attrs: { hidden: '' } })
			] } }, descId: 'exportFormatDescription' },
			field('stillFrame', { rowId: 'exportStillFrameRow', hidden: true }),
			field('svgTextMode', { formatSection: 'svg', hidden: true }),
			field('mp4LengthMode', { formatSection: 'mp4', hidden: true }),
			field('mp4TargetDuration', { rowId: 'exportMp4TargetDurationRow', formatSection: 'mp4', hidden: true }),
			field('mp4LoopCount', { rowId: 'exportMp4LoopCountRow', formatSection: 'mp4', hidden: true }),
			{ host: 'tplExportMp4EstimateRow' },
		] },
		{ title: 'Size', section: 'size', rows: [
			field('outputScale', { aliases: 'resize dimensions scale smaller pixels percent', statusId: 'exportOutputSize' }),
			field('targetSize', { aliases: 'file size limit fit under kb mb discord tumblr optimize custom size kilobytes' }),
			field('targetSizeKB', { rowId: 'exportTargetSizeKBRow', revealedBy: 'exportTargetSize', aliases: 'custom size kilobytes kb' }),
		] },
		{ title: 'Contents', section: 'contents', rows: [
			field('transparency', { rowId: 'transparencySettingsRow', aliases: 'matte background fill' }),
			field('matteColor', { rowId: 'matteColorRow', revealedBy: 'exportTransparency', aliases: 'matte background fill' }),
			field('baseImage', { aliases: 'photo background original artwork behind' }),
			field('watermarkEnabled', { aliases: 'watermark style preview' }),
			field('watermark', { rowId: 'watermarkSelectionRow', revealedBy: 'exportWatermarkEnabled', aliases: 'watermark style preview', afterHeader: 'tplExportWatermarkPreview' })
		] },
		{ title: 'Quality', section: 'quality', rows: [
			field('jpegQuality', { rowId: 'exportJpegQualityRow', hidden: true }),
			field('mp4Quality', { formatSection: 'mp4', hidden: true }),
			{ governed: {
				id: 'exportGifLookSet', formatSection: 'gif',
				disclosureLabel: 'Customize', railId: 'exportGifLookRail', label: 'Settings controlled by GIF Look',
				// The look writes these rows, so its own revert restores them.
				rowReverts: false,
				header: field('ditherPreset', { filterPin: true, afterDescription: 'tplExportGifLookPreview' }),
				rows: [
					field('colorCount'),
					field('paletteStyle'),
					field('ditherEnabled', { rowId: 'ditherEnabledRow', inactiveReason: needsDithering }),
					field('ditherType', { rowId: 'ditherTypeRow' }),
					field('ditherAmount', { rowId: 'ditherAmountRow', descId: 'exportDitherAmountDescription' }),
					field('ditherScale', { rowId: 'ditherScaleRow', inactiveReason: 'Only the Grid and Dots patterns can be scaled.' }),
					field('ditherTemporalMode', { rowId: 'ditherTemporalModeRow', inactiveReason: 'Only the Grid and Dots patterns can move.' }),
					field('ditherEdgeProtection', { rowId: 'ditherEdgeProtectionRow' })
				]
			} }
		] },
		{ title: 'Animation', section: 'animation', rows: [
			field('exportReverse'),
			{ governed: {
				id: 'exportFidelitySet',
				railId: 'exportFidelityRail', label: 'Settings controlled by Export Fidelity',
				header: {
					field: { ...EXPORT_SETTINGS_SCHEMA.exportFidelity, label: 'Export Fidelity',
						control: { type: 'steppedSlider', stops: () => CONFIG.export.timeline.fidelityStops,
							endLabels: CONFIG.export.timeline.fidelityEndLabels,
							outputId: 'exportFidelityValue', describedBy: 'exportFidelityEstimate' } },
					statusId: 'exportFidelityEstimate', filterPin: true
				},
				between: [{ field: { label: 'Animation Loop', description: 'Closes this window and opens the Animation loop panel, which shows what sets the loop length and can match animation speeds to it.', control: { type: 'button', id: 'openAnimationLoop', label: 'Open Animation Loop' } } }],
				rows: [
					{ host: 'tplExportFidelitySummary' },
					field('maxSamplingFps'),
					field('visualErrorThreshold'),
					field('maxFrames'),
					field('smartFrameReduction'),
					field('exportFrameSkip'),
					field('frameDelay', { formatSection: 'gif' }),
					field('quality', { formatSection: 'gif', aliases: 'color quality encoder accuracy precision' })
				]
			} }
		] }
	];
})();

// The app Settings modal. Its values live in two stores (editor settings and
// PREFERENCES), so the rows declare their fields here, each with the default
// its revert restores.
const APP_SETTINGS_LAYOUT = (() => {
	const toggle = (key, label, description, { id = key, invert = false, ...options } = {}) => ({
		...(PREFERENCE_SCHEMA[key] ? { preference: key, invert } : {}),
		field: { id, label, description, control: { type: 'switch' },
			...(PREFERENCE_SCHEMA[key] ? { default: invert ? !PREFERENCE_SCHEMA[key].default() : PREFERENCE_SCHEMA[key].default() } : {}) }, ...options
	});
	const preference = (key) => PREFERENCE_SCHEMA[key].default();
	const action = (label, description, button, options = {}) => ({ field: { label, description, control: { type: 'button', ...button } }, ...options });
	const choice = (id, label, description, options) => ({ field: { id, label, description, control: { type: 'select', options } } });
	const pixels = (id, label, description, min) => ({ field: { id, label, description, control: { type: 'number', min, max: 4096, step: 10, inputMode: 'numeric', unit: 'px' } } });
	return [
		{ title: 'Interface', section: 'interface', rows: [
			{ field: { id: 'interfaceTheme', label: 'Theme', description: 'Choose the editor interface appearance.', control: { type: 'select', options: 'interfaceTheme' }, default: 'dark' } },
			toggle('showHints', 'Helpful Hints', 'Show contextual hints based on active tool and selected layer.', { id: 'showHelpfulHints' }),
			toggle('showAllControls', 'Show All Controls', 'Keep every Advanced section open, in panels and in these windows.', { }),
			toggle('confirmDestructiveActions', 'Confirm Before Deleting', 'Ask before deleting layers or clearing paint.', { }),
			toggle('reduceMotion', 'Reduce Motion', 'Turn off interface transitions and animated previews. Exported animation is unaffected.', { aliases: 'animation accessibility motion transitions' }),
			toggle('showWelcomeOnStartup', 'Welcome on Startup', 'Show the Welcome screen when Glitter Editor starts.', { hidden: !CONFIG.app.startup.showWelcome }),
			toggle('balanceSidebars', 'Balance Sidebar Widths', 'Keep the Inspector as wide as the toolbar and Layers together. Dragging the Inspector turns this off.', { aliases: 'panels layout symmetric widths resize' })
		] },
		{ title: 'Canvas', section: 'canvas', rows: [
			toggle('autoSelect', 'Auto-Select Layers', 'Clicking the canvas selects the layer under the pointer. Turn off to keep the current selection while dragging on the canvas.', { id: 'autoSelectLayers', aliases: 'click pick layer canvas' }),
			toggle('snappingEnabled', 'Snapping', 'Align layers to the canvas edges, its center, and other layers while dragging.', { aliases: 'snap align guides magnetic' }),
			toggle('panInertia', 'Pan Momentum', 'Let the canvas keep gliding after a flick with the Hand tool. Turn off for panning that stops the moment you let go.', { aliases: 'momentum pan flick scroll' }),
			toggle('pixelGrid', 'Pixel Grid', 'Show a one-screen-pixel grid at 600% zoom and above.', { aliases: 'pixels zoom grid photoshop' }),
			{ preference: 'filterPreviewLevel', field: { id: 'filterPreviewLevel', label: 'Pixel Filter Preview', description: 'Choose whether pixel-only filter layers render on the canvas. Animated previews use more memory and may fall back to Still.', control: { type: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'still', label: 'Still' }, { value: 'animated', label: 'Animated (uses more memory)' }] }, default: preference('filterPreviewLevel') } },
			toggle('crispMaskEdges', 'Smooth Edges', 'Smooth the edges of text, shapes and new brush strokes. Off keeps them pixel-crisp.', { id: 'antialiasMaskEdges', invert: true, aliases: 'antialias aliasing crisp pixel' })
		] },
		{ title: 'Resizing Layers', section: 'resizing', rows: [
			toggle('scaleEffects', 'Scale Outlines & Effects', 'Scale outline widths, dotted spacing, and shadow offsets when stickers, text or shapes are resized.', { id: 'scaleEffectsOnTransform' }),
			toggle('scaleCorners', 'Scale Corners', 'Scale shape and frame corner radii when resizing layers.', { }),
			toggle('scaleTextures', 'Scale Textures', 'Scale the glitter pattern with text and shapes. Off resizes the artwork and keeps the pattern size.', { id: 'scaleTexturesOnTransform' })
		] },
		{ title: 'Reset', section: 'reset', rows: [
			action('Brush & Eraser', 'Restore Brush and Eraser tip, stroke and pressure settings to their defaults.', { id: 'resetToolSettings', label: 'Reset Tools' }),
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

// Render a settings body before binding its controls on first open.
function renderSettingsModals(id) {
	if (id === 'exportSettingsModal') renderSettingsGroups(document.getElementById('exportSettingsGroups'), EXPORT_SETTINGS_LAYOUT);
	if (id === 'settingsModal') renderSettingsGroups(document.getElementById('settingsGroups'), APP_SETTINGS_LAYOUT);
}

class SettingsStore {
	constructor(schema) {
		this.schema = schema;
		this.boundElements = new WeakSet();
	}

	load(source = {}) {
		return Object.fromEntries(Object.entries(this.schema).map(([key, spec]) => {
			const value = Object.prototype.hasOwnProperty.call(source, spec.storageKey)
				? source[spec.storageKey]
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
