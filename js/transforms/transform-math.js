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
		flipX: overrides.flipX ?? source.flipX ?? false,
		flipY: overrides.flipY ?? source.flipY ?? false
	};
}

function createDefaultTransform(overrides = {}) {
	return cloneTransform(CONFIG.tools.stickers.defaults.transform, overrides);
}

// `layer.transform` is the only transform address, and a transformable layer
// always has one from the moment it enters the document. Layer types without a
// transform read an identity placement that is never stored.
function getLayerTransform(layer) {
	if (!layer) return null;
	return layer.transform || createDefaultTransform();
}

// Single source of truth for layer scale limits (percent units). Every scale
// write funnels through LayerTransform.updateTransform, which clamps with this;
// drag paths that derive *position* from a scale must also clamp locally first
// so the anchor math and the stored scale agree.
function clampLayerScale(value) {
	const limits = CONFIG.ui.stickerHandles.scaleLimits;
	const min = limits.enabled ? limits.min : limits.hardMin;
	const max = limits.enabled ? limits.max : limits.hardMax;
	return Math.max(min, Math.min(max, value));
}

// Canvas overlays inherit the viewport transform, so screen-sized UI distances
// must be expressed in canvas units before they are positioned.
function screenPixelsToCanvasUnits(value, zoom) {
	return value / Math.max(0.01, Number(zoom) || 1);
}

// A layer is placed by its center, so an odd-sized layer centered on a whole
// pixel has its top-left corner on a half pixel and straddles the document's
// pixel grid (blurry or doubled edges when zoomed in, and preview/export
// disagree). When the layer is axis-aligned, shift the rendered center so the
// top-left corner lands on a whole pixel. Other rotations resample anyway.
// Preview, export, and the selection frame all place layers through this.
function snapLayerCenter(centerX, centerY, displayWidth, displayHeight, rotationDeg) {
	const quarterTurns = rotationDeg / 90;
	if (Math.abs(quarterTurns - Math.round(quarterTurns)) > 1e-9) {
		return { x: centerX, y: centerY };
	}
	const swapped = Math.abs(Math.round(quarterTurns)) % 2 === 1;
	const boxWidth = swapped ? displayHeight : displayWidth;
	const boxHeight = swapped ? displayWidth : displayHeight;
	return {
		x: Math.round(centerX - boxWidth / 2) + boxWidth / 2,
		y: Math.round(centerY - boxHeight / 2) + boxHeight / 2
	};
}

// `transform` with `position` replaced by the rendered (snapped) center, for
// geometry that must agree with what is on screen, such as hit testing.
function withRenderedPosition(transform, dimensions) {
	const metrics = computeLayerTransform(transform, dimensions);
	return { ...transform, position: { x: metrics.centerX, y: metrics.centerY } };
}

function computeLayerTransform(transform, dimensions = {}) {
	const resolved = cloneTransform(transform);
	const width = Number(dimensions.width) || 0;
	const height = Number(dimensions.height) || 0;
	const scaleX = (resolved.scale.x || 100) / 100;
	const scaleY = (resolved.scale.y || 100) / 100;
	const center = snapLayerCenter(
		resolved.position.x,
		resolved.position.y,
		width * scaleX,
		height * scaleY,
		resolved.rotation
	);

	return {
		position: {
			x: resolved.position.x,
			y: resolved.position.y
		},
		// Rendered center: `position` after pixel-grid snapping.
		centerX: center.x,
		centerY: center.y,
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
		flipX: Boolean(resolved.flipX),
		flipY: Boolean(resolved.flipY)
	};
}
