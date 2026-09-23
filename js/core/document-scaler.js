// Document scaling mutates editable layer geometry while the editor owns the
// canvas-sized pixel buffers. Keep these values in sync so scaling does not
// flatten the layer stack or change the visual density of authored effects.
function scaleDocumentLayerState(layer, scaleX, scaleY, uniformScale, options = {}) {
	if (!layer) return;
	const shouldScaleTextures = options.scaleTextures !== false;
	const shouldScaleEffects = options.scaleEffects !== false;

	const scalePosition = (transform) => {
		if (!transform?.position) return;
		transform.position.x *= scaleX;
		transform.position.y *= scaleY;
	};
	const scalePixel = (value, factor = uniformScale, minimum = 0) => {
		if (!Number.isFinite(Number(value))) return value;
		return Math.max(minimum, Math.round(Number(value) * factor));
	};
	const scaleTexture = (value, factor = uniformScale) => Number.isFinite(Number(value))
		? Math.max(1, roundSlotTextureScale(Number(value) * factor))
		: value;
	// Paint slots (and their parked drafts) rescale their declared pixel
	// fields and texture scale. Sticker slots scale with the sticker's own
	// transform, so they are compensated only for the options that are off.
	const scalesWithTransform = Boolean(LAYER_UI_CONFIG[layer.type]?.contentScalesWithTransform);
	const slotFactor = (enabled) => {
		if (scalesWithTransform) return enabled ? 1 : 1 / uniformScale;
		return enabled ? uniformScale : 1;
	};
	const effectFactor = slotFactor(shouldScaleEffects);
	const textureFactor = slotFactor(shouldScaleTextures);
	getLayerPaintSlots(layer, { includeDrafts: true }).forEach(({ definition, data, draft }) => {
		const pixels = definition.documentPixels;
		if (pixels && effectFactor !== 1) {
			const host = pixels.hostKeys ? (draft ? null : readPaintSlotPath(layer, pixels.hostKeys)) : data;
			if (host) {
				(pixels.fields || []).forEach((field) => { host[field] = scalePixel(host[field], effectFactor, pixels.minimum ?? 0); });
				(pixels.signedFields || []).forEach((field) => { host[field] = scalePixel(host[field], effectFactor, -Infinity); });
			}
		}
		if (textureFactor !== 1 && 'scale' in data) data.scale = scaleTexture(data.scale, textureFactor);
	});

	switch (layer.type) {
		case LayerType.BASE_IMAGE:
			if (shouldScaleEffects && layer.background?.pixelEffects?.pixelSize > 1) {
				layer.background.pixelEffects.pixelSize = scalePixel(layer.background.pixelEffects.pixelSize, uniformScale, 1);
			}
			break;
		case LayerType.STICKER:
			scalePosition(getLayerTransform(layer));
			if (layer.transform?.scale) {
				layer.transform.scale.x *= uniformScale;
				layer.transform.scale.y *= uniformScale;
			}
			break;
		case LayerType.TEXT_GLITTER: {
			const data = layer.textData;
			if (!data) break;
			scalePosition(getLayerTransform(layer));
			data.fontSize = scalePixel(data.fontSize, uniformScale, 1);
			data.letterSpacing = scalePixel(data.letterSpacing, uniformScale, -Infinity);
			if (Number.isFinite(Number(data.boxWidth))) data.boxWidth = scalePixel(data.boxWidth, uniformScale, 1);
			if (Number.isFinite(Number(data.boxHeight))) data.boxHeight = scalePixel(data.boxHeight, uniformScale, 1);
			break;
		}
		case LayerType.SHAPE: {
			const data = layer.shapeData;
			if (!data) break;
			scalePosition(getLayerTransform(layer));
			data.width = scalePixel(data.width, uniformScale, 1);
			data.height = scalePixel(data.height, uniformScale, 1);
			break;
		}
	}
}

function scaleDocumentLayerStates(layers, scaleX, scaleY, uniformScale, options = {}) {
	(layers || []).forEach((layer) => scaleDocumentLayerState(layer, scaleX, scaleY, uniformScale, options));
}
