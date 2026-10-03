// Document scaling mutates editable layer geometry while the editor owns the
// canvas-sized pixel buffers. Keep these values in sync so scaling does not
// flatten the layer stack or change the visual density of authored effects.
//
// What rescales is declared, not listed here: every field binding with a
// `documentScale` class, on the layer type (`fields`) and on its paint slots
// (including the parked drafts of switched-off effects). 'geometry' always
// follows the document; 'effect' and 'texture' follow the matching option.

// Rescale one declared field in place. Pixel fields land on whole pixels at or
// above the field's minimum; texture scales keep their configured precision.
function scaleFieldBinding(root, binding, factor) {
	if (!factor || factor === 1) return;
	const value = readFieldPath(root, binding.keys);
	if (value == null || !Number.isFinite(Number(value)) || (binding.when && !binding.when(Number(value), root))) return;
	writeFieldPath(root, binding.keys, binding.documentScale === 'texture'
		? Math.max(1, roundSlotTextureScale(Number(value) * factor))
		: Math.max(getFieldDocumentMinimum(binding), Math.round(Number(value) * factor)));
}

// Sparkles on content that scales with its layer transform (stickers) are
// placed in that content's own pixels, so they already follow the transform.
// Every other slot field is in canvas pixels.
function slotFieldsFollowTransform(layer, definition) {
	return Boolean(LAYER_UI_CONFIG[layer.type]?.contentScalesWithTransform) && definition.role === 'sparkles';
}

// Rescale the canvas-pixel fields of a layer's switched-on paint slots by the
// factor for each field's `documentScale` class ({ effect, texture }). A
// finished sticker resize uses it to carry outline, shadow and bevel sizes
// along with the sticker.
function scaleLayerSlotFields(layer, factors) {
	getLayerPaintSlots(layer).forEach(({ definition, data, present }) => {
		if (!present || slotFieldsFollowTransform(layer, definition)) return;
		definition.fields.forEach((binding) => scaleFieldBinding(data, binding, factors[binding.documentScale]));
	});
}

function scaleDocumentLayerState(layer, scaleX, scaleY, uniformScale, options = {}) {
	if (!layer) return;
	const config = LAYER_UI_CONFIG[layer.type];
	const shouldScaleTextures = options.scaleTextures !== false;
	const shouldScaleEffects = options.scaleEffects !== false;

	const scalesWithTransform = Boolean(config?.contentScalesWithTransform);
	// A field that already follows the document through the layer transform is
	// compensated only for the options that are off.
	const optionFactor = (enabled, followsTransform) => {
		if (followsTransform) return enabled ? 1 : 1 / uniformScale;
		return enabled ? uniformScale : 1;
	};
	const factorsFor = (followsTransform) => ({
		geometry: uniformScale,
		effect: optionFactor(shouldScaleEffects, followsTransform),
		texture: optionFactor(shouldScaleTextures, followsTransform)
	});

	if (isTransformableLayerType(layer.type)) {
		const transform = getLayerTransform(layer);
		// transform.anchor is frame-relative, so document resizing does not scale it.
		if (scalesWithTransform && transform?.scale) {
			transform.scale.x *= uniformScale;
			transform.scale.y *= uniformScale;
			snapLayerScaleToWholePixels(layer);
		}
		if (transform?.position) {
			// Same whole-pixel rule LayerTransform.updateTransform applies; after
			// the scale because a sticker rounds by its new size.
			const x = transform.position.x * scaleX;
			const y = transform.position.y * scaleY;
			const next = CONFIG.tools.stickers.transform.roundValues ? roundLayerPosition(layer, x, y, options.elementBox?.(layer)) : { x, y };
			transform.position.x = next.x;
			transform.position.y = next.y;
		}
	}
	const layerFactors = factorsFor(scalesWithTransform);
	(config?.fields || []).forEach((binding) => scaleFieldBinding(layer, binding, layerFactors[binding.documentScale]));
	getLayerPaintSlots(layer, { includeDrafts: true }).forEach(({ definition, data }) => {
		const factors = factorsFor(slotFieldsFollowTransform(layer, definition));
		definition.fields.forEach((binding) => scaleFieldBinding(data, binding, factors[binding.documentScale]));
	});
}

function scaleDocumentLayerStates(layers, scaleX, scaleY, uniformScale, options = {}) {
	(layers || []).forEach((layer) => scaleDocumentLayerState(layer, scaleX, scaleY, uniformScale, options));
}
