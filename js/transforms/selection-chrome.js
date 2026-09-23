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

// Resize cursors turn with the layer, in 45° steps.
function getHandleCursor(handleType, rotation) {
	if (handleType === 'rotation') return ROTATION_CURSOR;
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
	return handleType;
}

class SelectionChrome {
	constructor(overlay, { layerId, className = 'transform-handles', handles, titles = {} }) {
		this.overlay = overlay;
		this.handles = handles;
		this.screen = null;

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
		// Rotation last so it paints above the other handles.
		this.wrappers.forEach((wrapper) => container.appendChild(wrapper));

		overlay.append(container);
	}

	// Hit squares are screen pixels, larger on coarse pointers.
	getHitSize(handleType) {
		const config = CONFIG.ui.stickerHandles;
		const sizes = window.matchMedia?.('(pointer: coarse)').matches ? config.handleHitSizeCoarse : config.handleHitSize;
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
		const points = {
			'corner-tl': at(main, -main.hw - outset, -main.hh - outset),
			'corner-tr': at(main, main.hw + outset, -main.hh - outset),
			'corner-br': at(main, main.hw + outset, main.hh + outset),
			'corner-bl': at(main, -main.hw - outset, main.hh + outset),
			'edge-top': at(resize, 0, -resize.hh - outset),
			'edge-right': at(resize, resize.hw + outset, 0),
			'edge-bottom': at(resize, 0, resize.hh + outset),
			'edge-left': at(resize, -resize.hw - outset, 0),
			rotation: at(main, 0, -main.hh - config.rotationHandleDistance)
		};

		// On touch, a small layer's handles would cover its body; drop the ones
		// that span a too-short side so a finger can still grab the layer.
		const isTouch = navigator.maxTouchPoints > 0;
		const compactWidth = isTouch && main.hw * 2 < config.touchMinHandleSpan;
		const compactHeight = isTouch && main.hh * 2 < config.touchMinHandleSpan;
		const isEnabled = (handleType) => {
			if (handleType.startsWith('corner-')) return !(compactWidth || compactHeight);
			if (handleType === 'edge-left' || handleType === 'edge-right') return !compactWidth;
			if (handleType === 'edge-top' || handleType === 'edge-bottom' || handleType === 'rotation') return !compactHeight;
			return true;
		};

		const placed = [];
		this.wrappers.forEach((wrapper, handleType) => {
			const point = points[handleType];
			const size = this.getHitSize(handleType);
			const enabled = isEnabled(handleType);
			overlay.placePoint(wrapper, point);
			wrapper.style.width = `${size}px`;
			wrapper.style.height = `${size}px`;
			wrapper.style.cursor = getHandleCursor(handleType, rotation);
			wrapper.style.pointerEvents = enabled ? 'auto' : 'none';
			if (enabled) placed.push({ handleType, x: point.x, y: point.y, half: size / 2 });
		});

		if (this.stalk) {
			overlay.placeStalk(this.stalk, at(main, 0, -main.hh), config.rotationHandleDistance, rotation);
		}

		this.screen = { center: main.center, hw: main.hw, hh: main.hh, cos, sin, handles: placed };
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

		if (pointerType === 'touch' && Math.abs(localX) <= screen.hw / 2 && Math.abs(localY) <= screen.hh / 2) {
			return 'move';
		}

		let best = null;
		screen.handles.forEach((handle) => {
			if (Math.abs(x - handle.x) > handle.half || Math.abs(y - handle.y) > handle.half) return;
			const distance = Math.hypot(x - handle.x, y - handle.y);
			if (!best || distance < best.distance) best = { handleType: handle.handleType, distance };
		});
		if (best) return best.handleType;
		return Math.abs(localX) <= screen.hw && Math.abs(localY) <= screen.hh ? 'move' : null;
	}

	// Route every pointerdown on the chrome through hitTest. `element` is the
	// node that received it (for pointer capture).
	onPointerDown(callback) {
		this.element.addEventListener('pointerdown', (event) => {
			const element = event.target.closest('[data-handle-type]');
			if (!element) return;
			const handleType = this.hitTest(event.clientX, event.clientY, event.pointerType) || element.dataset.handleType;
			callback(handleType, event, element);
		});
	}

	remove() {
		this.element.remove();
		this.screen = null;
	}
}
