function cloneTransform(transform = null, overrides = {}) {
	const source = transform || CONFIG.tools.stickers.defaults.transform || {};
	return {
		position: {
			x: overrides.position?.x ?? source.position?.x ?? 0,
			y: overrides.position?.y ?? source.position?.y ?? 0
		},
		rotation: overrides.rotation ?? source.rotation ?? 0,
		scale: {
			x: overrides.scale?.x ?? source.scale?.x ?? 100,
			y: overrides.scale?.y ?? source.scale?.y ?? 100
		},
		proportionalScale: overrides.proportionalScale ?? source.proportionalScale ?? true,
		opacity: overrides.opacity ?? source.opacity ?? 100,
		flipX: overrides.flipX ?? source.flipX ?? false,
		flipY: overrides.flipY ?? source.flipY ?? false
	};
}

function createDefaultTransform(overrides = {}) {
	return cloneTransform(CONFIG.tools.stickers.defaults.transform, overrides);
}

function getLegacyTransformHost(layer) {
	if (!layer) return null;
	if (layer.stickerData) return layer.stickerData;
	if (layer.textData) return layer.textData;
	if (layer.shapeData) return layer.shapeData;
	return null;
}

function syncLayerTransformReference(layer, transform = null) {
	if (!layer) return null;

	const host = getLegacyTransformHost(layer);
	const resolved = transform || layer.transform || host?.transform || createDefaultTransform();

	layer.transform = resolved;
	if (host) {
		host.transform = resolved;
	}

	return resolved;
}

function getLayerTransform(layer) {
	if (!layer) return null;
	return syncLayerTransformReference(layer);
}

function computeLayerTransform(transform, dimensions = {}) {
	const resolved = cloneTransform(transform);
	const width = Number(dimensions.width) || 0;
	const height = Number(dimensions.height) || 0;
	const scaleX = (resolved.scale.x || 100) / 100;
	const scaleY = (resolved.scale.y || 100) / 100;

	return {
		position: {
			x: resolved.position.x,
			y: resolved.position.y
		},
		centerX: resolved.position.x,
		centerY: resolved.position.y,
		width,
		height,
		displayWidth: width * scaleX,
		displayHeight: height * scaleY,
		scaleX,
		scaleY,
		signedScaleX: scaleX * (resolved.flipX ? -1 : 1),
		signedScaleY: scaleY * (resolved.flipY ? -1 : 1),
		rotationDeg: resolved.rotation,
		rotationRad: resolved.rotation * Math.PI / 180,
		opacity: (resolved.opacity ?? 100) / 100,
		flipX: Boolean(resolved.flipX),
		flipY: Boolean(resolved.flipY)
	};
}

