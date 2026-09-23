// ============================================
// TRANSFORM GESTURES
// Pointer math shared by single-layer (LayerTransform) and group
// (GroupTransformManager) handle drags.
// ============================================
// Every handle gesture is relative to where it was grabbed, like Figma and
// Photoshop: nothing moves on pointerdown, and grabbing a handle a few pixels
// off its center (or on its outset) never makes the layer jump.
// - A drag starts only once the pointer travels dragThresholdPx screen pixels,
//   so a click on a handle can't nudge, scale or rotate the layer.
// - Scale handles follow the pointer's movement: the dragged point is the true
//   frame corner (or edge midpoint) at grab time plus the pointer delta.
// - Rotation adds the pointer's change in angle around the pivot to the start
//   rotation. Shift snaps the result to 15° steps.
// The pivot is a parameter (today the frame center), so a layer-owned anchor
// can later supply it without changing this math.

const ROTATION_SNAP_DEG = 15;

function hasPassedDragThreshold(startClient, event) {
	return Math.hypot(event.clientX - startClient.x, event.clientY - startClient.y)
		>= CONFIG.ui.stickerHandles.dragThresholdPx;
}

function normalizeRotationDeg(angle) {
	let next = angle % 360;
	if (next < 0) next += 360;
	return next;
}

function pointerAngleDeg(pivot, point) {
	return Math.atan2(point.y - pivot.y, point.x - pivot.x) * (180 / Math.PI);
}

// Signed change in pointer angle around the pivot, in (-180, 180].
function rotationDeltaDeg(pivot, grabPoint, point) {
	let delta = pointerAngleDeg(pivot, point) - pointerAngleDeg(pivot, grabPoint);
	if (delta > 180) delta -= 360;
	if (delta <= -180) delta += 360;
	return delta;
}

function snapRotationDeg(angle, shiftKey) {
	return shiftKey ? Math.round(angle / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG : angle;
}

// Rotate `point` about `pivot` by `deltaDeg`: keeps the pivot fixed on screen
// while a layer placed by its center turns.
function rotatePointAbout(point, pivot, deltaDeg) {
	const rad = deltaDeg * Math.PI / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const dx = point.x - pivot.x;
	const dy = point.y - pivot.y;
	return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

// Where the grabbed handle's true point is now: its position at grab time
// plus the pointer's movement since.
function anchoredHandlePoint(handleStart, grabPoint, point) {
	return { x: handleStart.x + point.x - grabPoint.x, y: handleStart.y + point.y - grabPoint.y };
}

// Canvas-space point of a handle on a frame, from getFrameMetrics-style
// metrics (corners in tl, tr, br, bl order). Corners are the frame corners;
// edges are edge midpoints.
function getFrameHandlePoint(metrics, handleType) {
	const [tl, tr, br, bl] = metrics.corners;
	const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
	switch (handleType) {
		case 'corner-tl': return tl;
		case 'corner-tr': return tr;
		case 'corner-br': return br;
		case 'corner-bl': return bl;
		case 'edge-top': return mid(tl, tr);
		case 'edge-right': return mid(tr, br);
		case 'edge-bottom': return mid(br, bl);
		case 'edge-left': return mid(bl, tl);
		default: return { x: metrics.centerX, y: metrics.centerY };
	}
}
