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
		? Math.max(1, Number(value) * factor)
		: value;
	const scaleShadow = (shadow) => {
		if (!shadow) return;
		if (shouldScaleEffects) {
			shadow.offsetX = scalePixel(shadow.offsetX, uniformScale, -Infinity);
			shadow.offsetY = scalePixel(shadow.offsetY, uniformScale, -Infinity);
		}
		if (shouldScaleTextures) shadow.scale = scaleTexture(shadow.scale);
	};
	const scaleBorder = (border, includeDots = false) => {
		if (!border) return;
		if (shouldScaleEffects) {
			border.widthPx = scalePixel(border.widthPx, uniformScale, 1);
			if (includeDots) border.dotSpacingPx = scalePixel(border.dotSpacingPx, uniformScale, 1);
		}
		if (shouldScaleTextures) border.scale = scaleTexture(border.scale);
	};
	const scaleEffectDrafts = (drafts, includeDots = false) => {
		if (!drafts) return;
		scaleBorder(drafts.border, includeDots);
		scaleShadow(drafts.shadow);
		if (shouldScaleTextures && drafts.fill) drafts.fill.scale = scaleTexture(drafts.fill.scale);
	};
	const compensateStickerShadow = (shadow) => {
		if (!shadow) return;
		if (!shouldScaleEffects) {
			shadow.offsetX = scalePixel(shadow.offsetX, 1 / uniformScale, -Infinity);
			shadow.offsetY = scalePixel(shadow.offsetY, 1 / uniformScale, -Infinity);
		}
		if (!shouldScaleTextures) shadow.scale = scaleTexture(shadow.scale, 1 / uniformScale);
	};

	switch (layer.type) {
		case LayerType.BASE_IMAGE:
			if (shouldScaleTextures && layer.background?.mode === 'glitter') {
				layer.background.scale = scaleTexture(layer.background.scale);
			}
			if (shouldScaleEffects && layer.background?.pixelEffects?.pixelSize > 1) {
				layer.background.pixelEffects.pixelSize = scalePixel(layer.background.pixelEffects.pixelSize, uniformScale, 1);
			}
			break;
		case LayerType.GLITTER_FILL:
			if (shouldScaleTextures && layer.settings) layer.settings.scale = scaleTexture(layer.settings.scale);
			break;
		case LayerType.STICKER:
			scalePosition(getLayerTransform(layer));
			compensateStickerShadow(layer.stickerData?.shadow);
			compensateStickerShadow(layer.stickerData?.effectDrafts?.shadow);
			if (layer.stickerData?.transform?.scale) {
				layer.stickerData.transform.scale.x *= uniformScale;
				layer.stickerData.transform.scale.y *= uniformScale;
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
			scaleBorder(data.border);
			scaleShadow(data.shadow);
			scaleEffectDrafts(data.effectDrafts);
			if (shouldScaleTextures && layer.settings) layer.settings.scale = scaleTexture(layer.settings.scale);
			break;
		}
		case LayerType.SHAPE: {
			const data = layer.shapeData;
			if (!data) break;
			scalePosition(getLayerTransform(layer));
			data.width = scalePixel(data.width, uniformScale, 1);
			data.height = scalePixel(data.height, uniformScale, 1);
			if (shouldScaleTextures && data.fill) data.fill.scale = scaleTexture(data.fill.scale);
			scaleBorder(data.border, true);
			scaleShadow(data.shadow);
			scaleEffectDrafts(data.effectDrafts, true);
			if (shouldScaleTextures && layer.settings) layer.settings.scale = scaleTexture(layer.settings.scale);
			break;
		}
	}
}

function scaleDocumentLayerStates(layers, scaleX, scaleY, uniformScale, options = {}) {
	(layers || []).forEach((layer) => scaleDocumentLayerState(layer, scaleX, scaleY, uniformScale, options));
}
