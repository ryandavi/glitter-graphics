// ============================================
// SELECTION CHROME
// One renderer and one hit test for transform handles, shared by single-layer
// (LayerTransform) and group (GroupTransformManager) selection.
// ============================================
// An owner describes its chrome as data on every update:
//   {
//     frame: { centerX, centerY, width, height, rotation },  // canvas units
//     resizeFrame: { ...same },  // optional: where edge handles sit (area text's box)
//   }
// and lists its handle types once at creation ('corner-tl'..'corner-bl',
// 'edge-top'..'edge-left', 'rotation'; the bounding box is always 'move').
// SelectionChrome turns that into positioned elements in the screen-space
// selection overlay and answers "which handle is under this pointer" from the
// same numbers, so what is drawn and what is grabbed can't disagree. New handle
// kinds (rotation zones outside the corners, radius handles, a size badge)
// extend the handle list here instead of adding a system per owner.

const CHROME_CURSORS = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];

function getRotationZoneCursor(handleType, rotation) {
	const cornerAngle = { 'rotate-tl': 0, 'rotate-tr': 90, 'rotate-br': 180, 'rotate-bl': 270 }[handleType] || 0;
	return getRotationCursor(cornerAngle + rotation);
}

// Resize cursors turn with the layer, in 45° steps.
function getHandleCursor(handleType, rotation) {
	if (handleType === 'rotation') return getRotationCursor(45 + rotation);
	if (handleType.startsWith('rotate-')) return getRotationZoneCursor(handleType, rotation);
	const baseIndex = {
		'corner-tl': 0, 'corner-tr': 2, 'corner-br': 4, 'corner-bl': 6,
		'edge-top': 1, 'edge-bottom': 1, 'edge-left': 3, 'edge-right': 3
	}[handleType];
	if (baseIndex === undefined) return 'move';
	const steps = Math.round(normalizeRotationDeg(rotation) / 45) % 8;
	return CHROME_CURSORS[(baseIndex + steps) % 8];
}

function handleKind(handleType) {
	if (handleType.startsWith('corner-')) return 'corner';
	if (handleType.startsWith('edge-')) return 'edge';
	if (handleType.startsWith('rotate-')) return 'rotate';
	if (handleType.startsWith('radius-')) return 'radius';
	return handleType;
}

class SelectionChrome {
	constructor(overlay, { layerId, className = 'transform-handles', handles, titles = {} }) {
		this.overlay = overlay;
		this.handles = handles;
		this.screen = null;
		this.badgeEdge = null;

		const container = document.createElement('div');
		container.className = className;
		container.dataset.layerId = layerId;
		this.element = container;

		const box = document.createElement('div');
		box.className = 'transform-bounding-box';
		box.dataset.handleType = 'move';
		if (titles.move) box.title = titles.move;
		container.appendChild(box);
		this.box = box;

		this.wrappers = new Map();
		handles.forEach((handleType) => {
			const kind = handleKind(handleType);
			const wrapper = document.createElement('div');
			wrapper.className = 'transform-handle-wrapper';
			wrapper.style.zIndex = '2';
			wrapper.dataset.handleType = handleType;
			if (titles[kind]) wrapper.title = titles[kind];
			const handle = document.createElement('div');
			const suffix = kind === 'rotation' ? '' : ` ${handleType}`;
			handle.className = `transform-handle transform-handle-${kind}${suffix}`;
			wrapper.appendChild(handle);
			this.wrappers.set(handleType, wrapper);
		});

		if (handles.includes('rotation')) {
			this.stalk = document.createElement('div');
			this.stalk.className = 'transform-rotation-line';
			container.appendChild(this.stalk);
		}
		this.badge = document.createElement('div');
		this.badge.className = 'selection-badge ui-ignore-gestures';
		this.badge.hidden = true;
		container.appendChild(this.badge);
		// Rotation last so it paints above the other handles.
		this.wrappers.forEach((wrapper) => container.appendChild(wrapper));

		overlay.append(container);
	}

	// Hit squares are screen pixels, larger on coarse pointers.
	getHitSize(handleType) {
		const config = CONFIG.ui.stickerHandles;
		const coarse = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
		const sizes = coarse ? config.handleHitSizeCoarse : config.handleHitSize;
		return sizes[handleKind(handleType)] || sizes.corner;
	}

	render(model) {
		const overlay = this.overlay;
		const view = overlay.getMapping();
		const config = CONFIG.ui.stickerHandles;
		const frame = model.frame;
		const resizeFrame = model.resizeFrame || frame;
		const rotation = Number(frame.rotation) || 0;
		const rad = rotation * Math.PI / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const toScreenFrame = (source) => {
			const center = overlay.toScreen({ x: source.centerX, y: source.centerY }, view);
			return { center, hw: Math.abs(source.width) * view.zoom / 2, hh: Math.abs(source.height) * view.zoom / 2 };
		};
		const main = toScreenFrame(frame);
		const resize = resizeFrame === frame ? main : toScreenFrame(resizeFrame);
		// Local offsets from a screen-space center, rotated with the frame.
		const at = (base, x, y) => ({
			x: base.center.x + x * cos - y * sin,
			y: base.center.y + x * sin + y * cos
		});

		overlay.placeFrame(this.box, frame, view);

		// Handles sit just outside the frame; the frame itself stays exact, so
		// the outset can't change transform geometry.
		const outset = config.outwardOffset;
		const diagonal = outset + config.rotateZoneSize / 2 + 4;
		const points = {
			'corner-tl': at(main, -main.hw - outset, -main.hh - outset),
			'corner-tr': at(main, main.hw + outset, -main.hh - outset),
			'corner-br': at(main, main.hw + outset, main.hh + outset),
			'corner-bl': at(main, -main.hw - outset, main.hh + outset),
			'edge-top': at(resize, 0, -resize.hh - outset),
			'edge-right': at(resize, resize.hw + outset, 0),
			'edge-bottom': at(resize, 0, resize.hh + outset),
			'edge-left': at(resize, -resize.hw - outset, 0),
			rotation: at(main, 0, -main.hh - config.rotationHandleDistance),
			'rotate-tl': at(main, -main.hw - diagonal, -main.hh - diagonal),
			'rotate-tr': at(main, main.hw + diagonal, -main.hh - diagonal),
			'rotate-br': at(main, main.hw + diagonal, main.hh + diagonal),
			'rotate-bl': at(main, -main.hw - diagonal, main.hh + diagonal)
		};
		// Stalk base on the top edge. When unrotated, center it on a device pixel
		// so the 1px stalk and the odd-sized circle share one crisp center line.
		const stalkBase = at(main, 0, -main.hh);
		if (rotation % 360 === 0) {
			stalkBase.x = SelectionOverlay.snapToPixelCenter(stalkBase.x);
			stalkBase.y = SelectionOverlay.snap(stalkBase.y);
			points.rotation = { x: stalkBase.x, y: stalkBase.y - config.rotationHandleDistance };
		}
		if (model.anchorPoint) {
			// Pixel-centered like the rotation handle, so the marker's 1px
			// crosshair renders crisp.
			const anchor = overlay.toScreen(model.anchorPoint, view);
			points.anchor = rotation % 360 === 0
				? { x: SelectionOverlay.snapToPixelCenter(anchor.x), y: SelectionOverlay.snapToPixelCenter(anchor.y) }
				: anchor;
		}
		Object.entries(model.radiusPoints || {}).forEach(([key, point]) => {
			points[key] = overlay.toScreen(point, view);
		});

		// On touch, a small layer's handles would cover its body; drop the ones
		// that span a too-short side so a finger can still grab the layer.
		const isTouch = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
		const minSpan = isTouch ? config.touchMinHandleSpan : config.minChromeSpan;
		const compactWidth = main.hw * 2 < minSpan;
		const compactHeight = main.hh * 2 < minSpan;
		const isEnabled = (handleType) => {
			if (handleType.startsWith('corner-')) return isTouch
				? !(compactWidth || compactHeight)
				: !(compactWidth && compactHeight);
			if (handleType === 'edge-left' || handleType === 'edge-right') return !compactWidth;
			if (handleType === 'edge-top' || handleType === 'edge-bottom') return !compactHeight;
			if (handleType === 'rotation') return !compactHeight && (config.rotationHandle === 'always' || (config.rotationHandle === 'coarse' && isTouch));
			if (handleType.startsWith('rotate-')) return !isTouch;
			if (handleType.startsWith('radius-')) return Boolean(points[handleType]);
			if (handleType === 'anchor') return Boolean(points.anchor);
			return true;
		};

		const placed = [];
		this.wrappers.forEach((wrapper, handleType) => {
			const point = points[handleType];
			if (!point) {
				wrapper.hidden = true;
				wrapper.style.pointerEvents = 'none';
				return;
			}
			const size = this.getHitSize(handleType);
			const enabled = isEnabled(handleType);
			// The rotation handle and anchor arrive already pixel-centered (the
			// rotation handle on the stalk's center line); snapping them to a
			// whole pixel again would put their 1px lines half a pixel off.
			if (handleType === 'rotation' || handleType === 'anchor') {
				wrapper.style.left = `${point.x}px`;
				wrapper.style.top = `${point.y}px`;
			} else {
				overlay.placePoint(wrapper, point);
			}
			let width = size;
			let height = size;
			if (handleType === 'edge-top' || handleType === 'edge-bottom') width = Math.max(size, resize.hw * 2 - this.getHitSize('corner-tl'));
			if (handleType === 'edge-left' || handleType === 'edge-right') height = Math.max(size, resize.hh * 2 - this.getHitSize('corner-tl'));
			wrapper.style.width = `${width}px`;
			wrapper.style.height = `${height}px`;
			wrapper.style.transform = `translate(-50%, -50%) rotate(${handleType.startsWith('edge-') ? rotation : 0}deg)`;
			wrapper.style.cursor = getHandleCursor(handleType, rotation);
			wrapper.style.pointerEvents = enabled ? 'auto' : 'none';
			wrapper.hidden = !enabled;
			if (handleType === 'anchor') wrapper.classList.toggle('is-subtle', Boolean(model.anchorSubtle));
			if (enabled) placed.push({ handleType, kind: handleKind(handleType), x: point.x, y: point.y, halfX: width / 2, halfY: height / 2 });
		});

		const stalkVisible = Boolean(this.stalk) && !compactHeight
			&& (config.rotationHandle === 'always' || (config.rotationHandle === 'coarse' && isTouch));
		if (this.stalk) {
			overlay.placeStalk(this.stalk, stalkBase, config.rotationHandleDistance, rotation);
			this.stalk.hidden = !stalkVisible;
		}

		if (model.badge?.text) {
			this.placeBadge(model.badge, main, at, cos, sin, stalkVisible);
		} else {
			this.badge.hidden = true;
			this.badgeEdge = null;
		}

		this.screen = { center: main.center, hw: main.hw, hh: main.hh, cos, sin, handles: placed };
	}

	// The badge sits outside the edge that faces down on screen, centered on it
	// and tilted with it (at most 45°, so it never reads upside down), the way
	// Figma attaches its size label. Ties (exact 45° turns) break in a fixed
	// order, so an unrotated layer always gets the bottom edge. Only while
	// rotating does the previous edge stick for a few degrees, so the badge
	// can't flicker between two edges as the angle crosses 45°.
	placeBadge(badge, main, at, cos, sin, stalkVisible) {
		const config = CONFIG.ui.stickerHandles;
		const corners = [at(main, -main.hw, -main.hh), at(main, main.hw, -main.hh), at(main, main.hw, main.hh), at(main, -main.hw, main.hh)];
		const edges = [
			{ key: 'bottom', a: corners[2], b: corners[3], normal: { x: -sin, y: cos } },
			{ key: 'right', a: corners[1], b: corners[2], normal: { x: cos, y: sin } },
			{ key: 'left', a: corners[3], b: corners[0], normal: { x: -cos, y: -sin } },
			{ key: 'top', a: corners[0], b: corners[1], normal: { x: sin, y: -cos } }
		];
		const sticky = badge.mode === 'angle' ? this.badgeEdge : null;
		const choose = (direction) => {
			let best = edges[0];
			edges.forEach((edge) => {
				if (edge.normal.y * direction > best.normal.y * direction + 1e-6) best = edge;
			});
			const previous = edges.find((edge) => edge.key === sticky);
			return previous && previous.normal.y * direction >= best.normal.y * direction - Math.sin(5 * Math.PI / 180) ? previous : best;
		};

		this.badge.textContent = badge.text;
		this.badge.dataset.mode = badge.mode;
		this.badge.hidden = false;
		const halfHeight = this.badge.offsetHeight / 2;
		const place = (edge) => {
			// Clear the rotation handle when the badge lands on its edge.
			const clearance = edge.key === 'top' && stalkVisible
				? config.rotationHandleDistance + this.getHitSize('rotation') / 4
				: 0;
			const distance = config.badgeGap + halfHeight + clearance;
			return {
				x: (edge.a.x + edge.b.x) / 2 + edge.normal.x * distance,
				y: (edge.a.y + edge.b.y) / 2 + edge.normal.y * distance
			};
		};
		let edge = choose(1);
		let point = place(edge);
		if (point.y + halfHeight > this.overlay.element.clientHeight) {
			edge = choose(-1);
			point = place(edge);
		}
		this.badgeEdge = edge.key;
		let angle = Math.atan2(edge.b.y - edge.a.y, edge.b.x - edge.a.x) * 180 / Math.PI;
		if (angle > 90) angle -= 180;
		if (angle < -90) angle += 180;
		if (Math.abs(angle) < 1e-6) angle = 0;
		this.badge.style.left = `${SelectionOverlay.snap(point.x)}px`;
		this.badge.style.top = `${SelectionOverlay.snap(point.y)}px`;
		this.badge.style.setProperty('--badge-angle', `${angle}deg`);
	}

	// Which part of the chrome is under a client point: the handle whose hit
	// square contains it (nearest center wins where squares overlap), else
	// 'move' inside the frame, else null. On touch the middle half of the frame
	// always moves, so handles never swallow a drag on a small layer.
	hitTest(clientX, clientY, pointerType) {
		const screen = this.screen;
		if (!screen) return null;
		const origin = this.overlay.element.getBoundingClientRect();
		const x = clientX - origin.left;
		const y = clientY - origin.top;
		const dx = x - screen.center.x;
		const dy = y - screen.center.y;
		const localX = dx * screen.cos + dy * screen.sin;
		const localY = -dx * screen.sin + dy * screen.cos;

		let best = null;
		// Same order as the handles paint (later handles sit on top), so what
		// is drawn on top is what gets grabbed. The anchor's hit square is
		// smaller than a corner's, so a corner under it stays grabbable.
		const priorities = { radius: 0, anchor: 1, corner: 2, edge: 3, rotate: 4, rotation: 4 };
		screen.handles.forEach((handle) => {
			const halfX = handle.halfX ?? handle.half;
			const halfY = handle.halfY ?? handle.half;
			if (Math.abs(x - handle.x) > halfX || Math.abs(y - handle.y) > halfY) return;
			const distance = Math.hypot(x - handle.x, y - handle.y);
			const priority = priorities[handle.kind] ?? 9;
			if (!best || priority < best.priority || (priority === best.priority && distance < best.distance)) best = { handleType: handle.handleType, priority, distance };
		});
		if (best) return best.handleType;
		if (pointerType === 'touch' && Math.abs(localX) <= screen.hw / 2 && Math.abs(localY) <= screen.hh / 2) return 'move';
		return Math.abs(localX) <= screen.hw && Math.abs(localY) <= screen.hh ? 'move' : null;
	}

	// Route every pointerdown on the chrome through hitTest. `element` is the
	// node that received it (for pointer capture).
	onPointerDown(callback) {
		this.element.addEventListener('pointerdown', (event) => {
			const element = event.target.closest('[data-handle-type]');
			if (!element) return;
			const directType = element.dataset.handleType;
			const handleType = directType !== 'move'
				? directType
				: (this.hitTest(event.clientX, event.clientY, event.pointerType) || directType);
			callback(handleType, event, element);
		});
	}

	remove() {
		this.element.remove();
		this.screen = null;
	}
}
