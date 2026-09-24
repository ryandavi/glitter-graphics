function cloneTransform(transform = null, overrides = {}) {
	const source = transform || CONFIG.tools.stickers.defaults.transform || {};
	return {
		position: {
			x: overrides.position?.x ?? source.position?.x ?? 0,
			y: overrides.position?.y ?? source.position?.y ?? 0
		},
		anchor: {
			x: overrides.anchor?.x ?? source.anchor?.x ?? CONFIG.tools.stickers.defaults.transform.anchor.x,
			y: overrides.anchor?.y ?? source.anchor?.y ?? CONFIG.tools.stickers.defaults.transform.anchor.y
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

// Layer frames. Every transformable type declares two layer-local boxes in
// its registerLayerType definition, each { width, height, offsetX, offsetY }
// in unscaled layer units with the offset measured from the element center:
// - frame: the object's body (content, border and background plate, no
//   shadow). Handles, hit-testing, alignment, snapping, group bounds.
// - visualBounds: every painted pixel (the frame plus shadow and effect
//   padding). Export culling and crop-to-artwork.
function getLayerFrame(editor, layer) {
	return LAYER_UI_CONFIG[layer?.type]?.frame?.(editor, layer) || null;
}

function getLayerVisualBounds(editor, layer) {
	return LAYER_UI_CONFIG[layer?.type]?.visualBounds?.(editor, layer) || getLayerFrame(editor, layer);
}

// The anchor belongs to the displayed frame, after flip and before rotation.
// Layer position remains the element center; changing the anchor alone never
// changes rendered pixels.
// Placement numbers shared by the anchor point and its inverse. They use the
// stored position, not the pixel-snapped rendered center, so repeated anchor
// edits can't drift by half pixels.
function getAnchorGeometry(editor, layer) {
	const transform = getLayerTransform(layer);
	const frame = getLayerFrame(editor, layer);
	if (!transform || !frame) return null;
	const dimensions = LAYER_UI_CONFIG[layer.type]?.managerKey
		? editor[LAYER_UI_CONFIG[layer.type].managerKey]?.layerTransforms?.get(layer.id)?.getDimensions?.() || frame
		: frame;
	const metrics = computeLayerTransform(transform, dimensions);
	return {
		transform,
		frame,
		metrics,
		cos: Math.cos(metrics.rotationRad),
		sin: Math.sin(metrics.rotationRad),
		// Layer-local offset of anchor (0.5, 0.5) from the position.
		centerX: metrics.signedScaleX * (frame.offsetX || 0),
		centerY: metrics.signedScaleY * (frame.offsetY || 0),
		width: metrics.scaleX * frame.width,
		height: metrics.scaleY * frame.height
	};
}

function getLayerAnchorPoint(editor, layer) {
	const geometry = getAnchorGeometry(editor, layer);
	if (!geometry) {
		const transform = getLayerTransform(layer);
		return transform?.position ? { ...transform.position } : null;
	}
	const { transform, cos, sin } = geometry;
	const localX = geometry.centerX + (transform.anchor.x - 0.5) * geometry.width;
	const localY = geometry.centerY + (transform.anchor.y - 0.5) * geometry.height;
	return {
		x: transform.position.x + localX * cos - localY * sin,
		y: transform.position.y + localX * sin + localY * cos
	};
}

// Inverse of getLayerAnchorPoint: the anchor fractions that would put the
// anchor on a canvas point, plus the frame's displayed size for snapping.
function getLayerAnchorFromPoint(editor, layer, point) {
	const geometry = getAnchorGeometry(editor, layer);
	if (!geometry) return null;
	const { transform, cos, sin } = geometry;
	const dx = point.x - transform.position.x;
	const dy = point.y - transform.position.y;
	const localX = dx * cos + dy * sin;
	const localY = -dx * sin + dy * cos;
	return {
		x: 0.5 + (localX - geometry.centerX) / Math.max(0.01, geometry.width),
		y: 0.5 + (localY - geometry.centerY) / Math.max(0.01, geometry.height),
		width: geometry.width,
		height: geometry.height
	};
}

function withAnchorFixed(editor, layer, mutate) {
	const before = getLayerAnchorPoint(editor, layer);
	mutate(getLayerTransform(layer));
	const after = getLayerAnchorPoint(editor, layer);
	if (!before || !after) return;
	const transform = getLayerTransform(layer);
	transform.position.x += before.x - after.x;
	transform.position.y += before.y - after.y;
}

function getLayerAnimationOrigin(editor, layer, dimensions) {
	if (!layer || layer.type === LayerType.GLITTER_FILL) return { x: 0.5, y: 0.5 };
	const transform = getLayerTransform(layer);
	if (!editor) return { ...transform.anchor };
	const frame = getLayerFrame(editor, layer);
	const width = Math.max(1, Number(dimensions?.width) || Number(frame?.width) || 1);
	const height = Math.max(1, Number(dimensions?.height) || Number(frame?.height) || 1);
	if (!frame) return { ...transform.anchor };
	const signX = transform.flipX ? -1 : 1;
	const signY = transform.flipY ? -1 : 1;
	return {
		x: 0.5 + ((frame.offsetX || 0) + signX * (transform.anchor.x - 0.5) * frame.width) / width,
		y: 0.5 + ((frame.offsetY || 0) + signY * (transform.anchor.y - 0.5) * frame.height) / height
	};
}

// Frame for a rect in a centered mask canvas's pixel space.
function frameFromCanvasRect(rect, canvasWidth, canvasHeight) {
	if (!rect) return null;
	return {
		width: rect.width,
		height: rect.height,
		offsetX: rect.x + rect.width / 2 - canvasWidth / 2,
		offsetY: rect.y + rect.height / 2 - canvasHeight / 2
	};
}

function unionRects(a, b) {
	if (!a) return b || null;
	if (!b) return a;
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y
	};
}

function padFrame(frame, padding) {
	if (!frame || !(padding > 0)) return frame;
	return { ...frame, width: frame.width + padding * 2, height: frame.height + padding * 2 };
}
