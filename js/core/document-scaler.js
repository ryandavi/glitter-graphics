// Document scaling mutates editable layer geometry while the editor owns the
// canvas-sized pixel buffers. Keep these values in sync so scaling does not
// flatten the layer stack or change the visual density of authored effects.
//
// What rescales is declared, not listed here: every field binding with a
// `documentScale` class, on the layer type (`fields`) and on its paint slots
// (including the parked drafts of switched-off effects). 'geometry' always
// follows the document; 'effect' and 'texture' follow the matching option.
function scaleDocumentLayerState(layer, scaleX, scaleY, uniformScale, options = {}) {
	if (!layer) return;
	const config = LAYER_UI_CONFIG[layer.type];
	const shouldScaleTextures = options.scaleTextures !== false;
	const shouldScaleEffects = options.scaleEffects !== false;

	const scalePixel = (value, factor, minimum) => Math.max(minimum, Math.round(Number(value) * factor));
	const scaleTexture = (value, factor) => Math.max(1, roundSlotTextureScale(Number(value) * factor));
	// Content that scales with its layer transform (stickers) already follows
	// the document through that transform, so its fields are compensated only
	// for the options that are off.
	const scalesWithTransform = Boolean(config?.contentScalesWithTransform);
	const optionFactor = (enabled) => {
		if (scalesWithTransform) return enabled ? 1 : 1 / uniformScale;
		return enabled ? uniformScale : 1;
	};
	const factors = {
		geometry: uniformScale,
		effect: optionFactor(shouldScaleEffects),
		texture: optionFactor(shouldScaleTextures)
	};
	const scaleBinding = (root, binding) => {
		const factor = factors[binding.documentScale];
		if (!factor || factor === 1) return;
		const value = readFieldPath(root, binding.keys);
		if (value == null || !Number.isFinite(Number(value)) ||(binding.when && !binding.when(Number(value)))) return;
		writeFieldPath(root, binding.keys, binding.documentScale === 'texture'
			? scaleTexture(value, factor)
			: scalePixel(value, factor, getFieldDocumentMinimum(binding)));
	};

	if (config?.transformable) {
		const transform = getLayerTransform(layer);
		if (transform?.position) {
			transform.position.x *= scaleX;
			transform.position.y *= scaleY;
		}
		if (scalesWithTransform && transform?.scale) {
			transform.scale.x *= uniformScale;
			transform.scale.y *= uniformScale;
		}
	}
	(config?.fields || []).forEach((binding) => scaleBinding(layer, binding));
	getLayerPaintSlots(layer, { includeDrafts: true }).forEach(({ definition, data }) => {
		definition.fields.forEach((binding) => scaleBinding(data, binding));
	});
}

function scaleDocumentLayerStates(layers, scaleX, scaleY, uniformScale, options = {}) {
	(layers || []).forEach((layer) => scaleDocumentLayerState(layer, scaleX, scaleY, uniformScale, options));
}
