'use strict';

// One spec per editable property: label, unit, range, step and default.
// Panel rows stamp their range and default from here (panel-renderer.js),
// the managers' slot and layer defaults read `value` from here (slot-effects.js,
// the layer type definitions), and bindSlider/syncSlider read the unit the
// renderer stamps onto the control. A layer type's `fields` and its paint
// slots' `fields` say which data path each spec edits (js/layers/types/).
//
// `scale: 'log'` maps the DOM track geometrically onto [min, max] (slider.js);
// `value` is always the real value. Loads before config.js.
const FIELDS = Object.freeze({
	animSpeed: { label: 'Speed', unit: 'ms', min: 120, max: 20000, step: 10, value: 1400 },
	animAmount: { label: 'Intensity', unit: '', min: 0, max: 200, step: 1, value: 10 },
	animAngle: { label: 'Angle', unit: '\u00b0', min: 0, max: 359, step: 1, value: 0 },
	animDistance: { label: 'Distance', unit: 'px', min: 0, max: 2000, step: 1, value: 60 },
	animRadius: { label: 'Radius', unit: 'px', min: 0, max: 1000, step: 1, value: 40 },
	animTurns: { label: 'Turns', unit: '×', min: 1, max: 8, step: 1, value: 1 },
	animDuty: { label: 'Duty cycle', unit: '%', min: 5, max: 95, step: 1, value: 50 },
	animOpacityFloor: { label: 'Opacity floor', unit: '%', min: 0, max: 95, step: 1, value: 0 },
	animDelay: { label: 'Delay', unit: 'ms', min: 0, max: 20000, step: 10, value: 0 },
	animPhase: { label: 'Start offset', unit: '%', min: 0, max: 100, step: 1, value: 0 },
	animAnchorX: { label: 'Anchor X', unit: '%', min: 0, max: 100, step: 1, value: 50 },
	animAnchorY: { label: 'Anchor Y', unit: '%', min: 0, max: 100, step: 1, value: 50 },
	filterInstagramStrength: { label: 'Strength', unit: '%', min: 0, max: 100, step: 1, value: 100 },
	filterBrightness: { label: 'Brightness', unit: '%', min: -100, max: 100, step: 1, value: 0 },
	filterContrast: { label: 'Contrast', unit: '%', min: -100, max: 100, step: 1, value: 0 },
	filterSaturation: { label: 'Saturation', unit: '%', min: -100, max: 100, step: 1, value: 0 },
	filterHue: { label: 'Hue', unit: '°', min: -180, max: 180, step: 1, value: 0 },
	filterInvertAmount: { label: 'Amount', unit: '%', min: 0, max: 100, step: 1, value: 100 },
	filterGrayscaleAmount: { label: 'Amount', unit: '%', min: 0, max: 100, step: 1, value: 100 },
	filterSepiaAmount: { label: 'Amount', unit: '%', min: 0, max: 100, step: 1, value: 100 },
	filterTintAmount: { label: 'Density', unit: '%', min: 0, max: 100, step: 1, value: 40 },
	filterVignetteAmount: { label: 'Amount', unit: '%', min: 0, max: 100, step: 1, value: 45 },
	filterVignetteMidpoint: { label: 'Midpoint', unit: '%', min: 0, max: 100, step: 1, value: 55 },
	filterVignetteRoundness: { label: 'Roundness', unit: '%', min: -100, max: 100, step: 1, value: 0 },
	filterVignetteFeather: { label: 'Feather', unit: '%', min: 1, max: 100, step: 1, value: 60 },
	filterGrainAmount: { label: 'Amount', unit: '%', min: 0, max: 100, step: 1, value: 25 },
	filterGrainSize: { label: 'Size', unit: '%', min: 0, max: 100, step: 1, value: 25 },
	filterGrainRoughness: { label: 'Roughness', unit: '%', min: 0, max: 100, step: 1, value: 50 },
	filterBlurRadius: { label: 'Radius', unit: 'px', min: 0, max: 64, step: 1, value: 1 },
	autoGlitterColorCount: { label: 'Colors', unit: '', min: 2, max: 12, step: 1, value: 5 },
	autoGlitterMergeDistinctness: { label: 'Combine Similar', unit: '', min: 0.01, max: 0.12, step: 0.005, value: 0.045 },
	autoGlitterDetail: { label: 'Detail', unit: 'px', min: 1, max: 64, step: 1, value: 4 },
	pixelEffectsPixelSize: { label: 'Pixel Size', unit: 'px', min: 1, max: 8, step: 1, value: 1 },
	pixelEffectsColorCount: { label: 'Colors', unit: '', min: 2, max: 12, step: 1, value: 5 },
	pixelEffectsMergeDistinctness: { label: 'Combine Similar', unit: '', min: 0.01, max: 0.12, step: 0.005, value: 0.045 },
	pixelEffectsDetail: { label: 'Detail', unit: 'px', min: 1, max: 64, step: 1, value: 4 },
	pixelEffectsStrength: { label: 'Strength', unit: '%', min: 0, max: 100, step: 1, value: 100 },
	pixelEffectsDitherScale: { label: 'Texture Scale', unit: '×', min: 1, max: 4, step: 1, value: 1 },
	pixelEffectsAngle: { label: 'Angle', unit: '°', min: 0, max: 360, step: 1, value: 45 },
	maskBrushSize: { label: 'Size', unit: 'px', min: 1, max: 1000, value: 40, scale: 'log' },
	maskBrushSoftness: { label: 'Softness', unit: '%', min: 0, max: 100, value: 0 },
	maskBrushFlow: { label: 'Flow', unit: '%', min: 1, max: 100, value: 100 },
	maskBrushSpacing: { label: 'Spacing', unit: '%', min: 1, max: 200, value: 1 },
	maskBrushSmoothing: { label: 'Smoothing', unit: '%', min: 0, max: 100, value: 0 },
	textureScale: { label: 'Texture Scale', unit: '%', min: 25, max: 300, value: 100 },
	textureOffsetX: { label: 'Offset X', unit: 'px', min: -500, max: 500, step: 1, value: 0 },
	textureOffsetY: { label: 'Offset Y', unit: 'px', min: -500, max: 500, step: 1, value: 0 },
	slotOpacity: { label: 'Opacity', unit: '%', min: 0, max: 100, value: 100 },
	layerOpacity: { label: 'Layer Opacity', unit: '%', min: 0, max: 100, value: 100 },
	gradientSmoothing: { label: 'Smoothing', unit: '×', min: 3, max: 16, step: 1, value: 8 },
	hue: { label: 'Hue', unit: '°', min: -180, max: 180, value: 0 },
	saturation: { label: 'Saturation', unit: '%', min: 0, max: 200, value: 100 },
	brightness: { label: 'Brightness', unit: '%', min: 25, max: 200, value: 100 },
	borderWidth: { label: 'Width', unit: 'px', min: 1, max: 100, value: 6 },
	textBorderWidth: { label: 'Width', unit: 'px', min: 1, max: 24, value: 4 },
	borderDotSpacing: { label: 'Dot Spacing', unit: 'px', min: 1, max: 60, value: 10 },
	shapeRadius: { label: 'Radius', unit: 'px', min: 0, max: 100, value: 0 },
	shapeImageOffsetX: { label: 'Horizontal Offset', unit: '%', min: 0, max: 100, step: 1, value: 50 },
	shapeImageOffsetY: { label: 'Vertical Offset', unit: '%', min: 0, max: 100, step: 1, value: 50 },
	shapeImageScale: { label: 'Scale', unit: '%', min: 10, max: 500, step: 1, value: 100 },
	shadowOffsetX: { label: 'Offset X', unit: 'px', min: -60, max: 60, value: 6 },
	shadowOffsetY: { label: 'Offset Y', unit: 'px', min: -60, max: 60, value: 6 },
	// A new text background uses the Instagram preset, whose geometry is these
	// defaults (TEXT_BACKGROUND_PRESETS in config.js), so the reverts return there.
	textBackgroundPaddingH: { label: 'Horizontal Padding', unit: 'px', min: 0, max: 200, value: 20 },
	textBackgroundPaddingV: { label: 'Vertical Padding', unit: 'px', min: 0, max: 200, value: 10 },
	textBackgroundRadius: { label: 'Radius', unit: 'px', min: 0, max: 100, value: 16 },
	textBackgroundMergeDistance: { label: 'Merge Distance', unit: 'px', min: 0, max: 120, value: 20 },
	textBackgroundSpacing: { label: 'Spacing Sensitivity', unit: '%', min: 0, max: 100, value: 60 },
	threshold: { label: 'Color Tolerance', unit: '', min: 0, max: 255, value: 50 },
	feather: { label: 'Edge Feather', unit: 'px', min: 0, max: 50, value: 0 },
	textFontSize: { label: 'Font Size', unit: 'px', min: 12, max: 256, value: 64 },
	textLetterSpacing: { label: 'Letter Spacing', unit: 'px', min: -20, max: 40, value: 0 },
	textLineHeight: { label: 'Line Height', unit: '%', min: 50, max: 250, value: 100 },
	transformScale: { label: 'Scale', unit: '%', min: 10, max: 500, value: 100 },
	transformRotation: { label: 'Rotation', unit: '°', min: 0, max: 360, step: 1, value: 0 },
	transformOpacity: { label: 'Opacity', unit: '%', min: 0, max: 100, value: 100 },
	multiSelectionOpacity: { label: 'Opacity', unit: '%', min: 0, max: 100, step: 1, value: 100 },
	documentScale: { label: 'Scale', unit: '%', min: 10, max: 500, step: 1, value: 100 }
});
Object.values(FIELDS).forEach(Object.freeze);

// ===== FIELD BINDINGS =====
// A binding says which data path one spec edits:
//   path           dotted path from the binding's root (the layer, or a slot)
//   field          FIELDS key; omitted for values with no panel control
//   id             panel control id (layer-level bindings; slot bindings
//                  derive theirs from the slot's panelPrefix + suffix)
//   factor         stored value = control value / factor (line height is a
//                  ratio shown as a percent)
//   geometry       changes the layer's painted footprint
//   documentScale  'geometry' always rescales with the document; 'effect' and
//                  'texture' follow the scaler's effects / textures options
//   minimum        floor after document scaling (defaults to the spec's lower
//                  bound, or unbounded for signed specs)

function splitFieldPath(path) {
	return path ? Object.freeze(String(path).split('.')) : null;
}

function readFieldPath(root, keys) {
	if (!keys) return null;
	let value = root;
	for (const key of keys) {
		if (value == null) return null;
		value = value[key];
	}
	return value ?? null;
}

function writeFieldPath(root, keys, value) {
	let target = root;
	for (let i = 0; i < keys.length - 1; i++) {
		if (target[keys[i]] == null) target[keys[i]] = {};
		target = target[keys[i]];
	}
	target[keys[keys.length - 1]] = value;
}

function normalizeFieldBinding(binding, owner) {
	if (!binding?.path) throw new Error(`Field binding without a path on ${owner}`);
	if (binding.field && !FIELDS[binding.field]) throw new Error(`Unknown field spec ${binding.field} on ${owner}`);
	return Object.freeze({
		...binding,
		keys: splitFieldPath(binding.path),
		spec: binding.field ? FIELDS[binding.field] : null
	});
}

function getFieldDocumentMinimum(binding) {
	if (binding.minimum != null) return binding.minimum;
	const min = binding.spec?.min;
	if (min == null) return 0;
	return min < 0 ? -Infinity : min;
}
