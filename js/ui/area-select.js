'use strict';

// The Select Area tool: routes pointer gestures to the area selection
// (js/systems/AreaSelection.js) and runs its commands.
// - A drag draws the current shape. Shift held at the press adds to the area,
//   Alt subtracts from it and both keep only the overlap, whatever the mode
//   in the context bar says.
// - Pressed again during a rectangle or ellipse drag, Shift keeps it square
//   and Alt draws it from the center. Space held during a drag moves the
//   shape being drawn.
// - In New mode a drag that starts inside the area moves it; Shift keeps the
//   move on one axis.
// - A click without a drag deselects, as it does in Photoshop.
class AreaSelectSession {
	constructor(editor) {
		this.editor = editor;
		this.chrome = new AreaChrome(editor);
		this.shape = 'rect';
		this.mode = 'new';
		this.drag = null;
		// The last pointer position and modifiers over the workspace, for the cursor.
		this.hover = null;
		const track = (event) => {
			if (event.pointerType === 'touch') return;
			this.hover = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey };
			this.syncCursor();
		};
		const modifier = (event) => {
			if (!this.hover || (event.key !== 'Shift' && event.key !== 'Alt')) return;
			this.hover.shiftKey = event.shiftKey;
			this.hover.altKey = event.altKey;
			this.syncCursor();
		};
		editor.previewContainer.addEventListener('pointermove', track);
		document.addEventListener('keydown', modifier);
		document.addEventListener('keyup', modifier);
	}

	get area() {
		return this.editor.areaSelection;
	}

	setShape(shape) {
		this.shape = shape;
		this.syncToolbar();
	}

	setMode(mode) {
		this.mode = mode;
		this.syncToolbar();
		this.syncCursor();
	}

	// The mode a press would draw in: the modifiers held, or the bar's mode.
	resolveMode(input) {
		if (input.shiftKey && input.altKey) return 'intersect';
		return input.shiftKey ? 'add' : input.altKey ? 'subtract' : this.mode;
	}

	// The cursor names what a press would do: move the area, or draw in a mode.
	syncCursor() {
		if (!this.hover || this.editor.currentTool !== ToolType.AREA) return;
		const drag = this.drag;
		const mode = drag ? drag.mode : this.resolveMode(this.hover);
		const moves = drag ? drag.moving : mode === 'new' && this.area.contains(this.editor.viewport.screenToCanvas(this.hover.clientX, this.hover.clientY));
		this.editor.previewContainer.dataset.areaCursor = moves ? 'move' : mode;
	}

	// Called by the area whenever it changes.
	onAreaChanged() {
		this.chrome.render();
		this.syncToolbar();
		this.syncCursor();
		this.editor.updateHelpfulMessage?.();
	}

	syncToolbar() {
		const renderer = this.editor.contextToolbarRenderer;
		if (!renderer) return;
		const empty = this.area.isEmpty;
		['contextAreaFill', 'contextAreaErase', 'contextAreaCrop', 'contextAreaInvert', 'contextAreaDeselect'].forEach((id) => renderer.setEnabled(id, !empty));
		// The tools that work inside the area carry its Deselect while it exists.
		['maskBrushDeselect', 'contextFillDeselect'].forEach((id) => {
			const button = document.getElementById(id);
			if (button) button.hidden = empty;
		});
		renderer.setSegmentedValue('contextAreaShape', this.shape);
		renderer.setSegmentedValue('contextAreaMode', this.mode);
	}

	press(input) {
		const mode = this.resolveMode(input);
		const start = this.editor.viewport.screenToCanvas(input.clientX, input.clientY);
		this.drag = {
			mode,
			start,
			last: start,
			client: { x: input.clientX, y: input.clientY },
			trace: [],
			moved: false,
			// A drag that starts inside the area moves it, by `applied` so far.
			moving: mode === 'new' && this.area.contains(start),
			applied: { x: 0, y: 0 },
			// Space is held: the pointer carries the shape being drawn.
			space: false,
			// A modifier that chose the mode only shapes the drag once it has
			// been let go and pressed again.
			shiftFromPress: Boolean(input.shiftKey),
			altFromPress: Boolean(input.altKey),
			points: null
		};
	}

	move(input) {
		const drag = this.drag;
		if (!drag || (!drag.moved && !hasPassedDragThreshold(drag.client, input))) return;
		drag.moved = true;
		if (!input.shiftKey) drag.shiftFromPress = false;
		if (!input.altKey) drag.altFromPress = false;
		const point = this.editor.viewport.screenToCanvas(input.clientX, input.clientY);
		if (drag.moving) {
			let x = Math.round(point.x - drag.start.x);
			let y = Math.round(point.y - drag.start.y);
			if (input.shiftKey) { if (Math.abs(x) >= Math.abs(y)) y = 0; else x = 0; }
			this.shiftArea(x - drag.applied.x, y - drag.applied.y);
			drag.applied = { x, y };
			return;
		}
		if (drag.space) {
			const carry = (entry) => ({ x: entry.x + point.x - drag.last.x, y: entry.y + point.y - drag.last.y });
			drag.start = carry(drag.start);
			drag.trace = drag.trace.map(carry);
		}
		drag.last = point;
		drag.points = this.shape === 'lasso'
			? this.traceLasso(drag, point)
			: this.buildBoxShape(drag.start, point, { square: Boolean(input.shiftKey) && !drag.shiftFromPress, fromCenter: Boolean(input.altKey) && !drag.altFromPress });
		this.chrome.setDraft({ mode: drag.mode, points: drag.points });
	}

	release(input) {
		const drag = this.drag;
		if (!drag) return;
		if (input) this.move(input);
		this.drag = null;
		this.chrome.setDraft(null);
		if (!drag.moved) {
			if (drag.mode === 'new') this.area.clear();
		} else if (drag.points) {
			this.area.apply(drag.points, drag.mode);
		}
	}

	cancelDrag() {
		const drag = this.drag;
		if (!drag) return;
		this.drag = null;
		this.chrome.setDraft(null);
		if (drag.moving) this.shiftArea(-drag.applied.x, -drag.applied.y);
	}

	shiftArea(dx, dy) {
		if (dx || dy) this.area.transformPoints((point) => ({ x: point.x + dx, y: point.y + dy }));
	}

	// A lasso keeps a point each time the pointer has moved far enough on
	// screen, so its detail follows the zoom.
	traceLasso(drag, point) {
		const last = drag.trace[drag.trace.length - 1] || drag.start;
		const spacing = CONFIG.tools.area.lassoSpacing / this.editor.viewport.currentZoom;
		if (!drag.trace.length) drag.trace.push(drag.start);
		if (Math.hypot(point.x - last.x, point.y - last.y) >= spacing) drag.trace.push(point);
		return drag.trace.length >= 3 ? [...drag.trace] : [...drag.trace, point, point].slice(0, 3);
	}

	buildBoxShape(start, point, { square, fromCenter }) {
		let width = point.x - start.x;
		let height = point.y - start.y;
		if (square) {
			const side = Math.max(Math.abs(width), Math.abs(height));
			width = side * (Math.sign(width) || 1);
			height = side * (Math.sign(height) || 1);
		}
		const left = fromCenter ? start.x - Math.abs(width) : Math.min(start.x, start.x + width);
		const top = fromCenter ? start.y - Math.abs(height) : Math.min(start.y, start.y + height);
		const right = fromCenter ? start.x + Math.abs(width) : Math.max(start.x, start.x + width);
		const bottom = fromCenter ? start.y + Math.abs(height) : Math.max(start.y, start.y + height);
		// Whole pixels, so a rectangle fills exactly the pixels it frames.
		const box = { left: Math.round(left), top: Math.round(top), right: Math.round(right), bottom: Math.round(bottom) };
		if (this.shape === 'rect') {
			return [{ x: box.left, y: box.top }, { x: box.right, y: box.top }, { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom }];
		}
		const centerX = (box.left + box.right) / 2;
		const centerY = (box.top + box.bottom) / 2;
		const segments = CONFIG.tools.area.ellipseSegments;
		return Array.from({ length: segments }, (_, index) => {
			const angle = index / segments * Math.PI * 2;
			return { x: centerX + Math.cos(angle) * (box.right - box.left) / 2, y: centerY + Math.sin(angle) * (box.bottom - box.top) / 2 };
		});
	}

	// Mouse and pen: the tool's onCanvasPointerDown.
	handlePointerDown(event) {
		if (event.pointerType === 'touch' || event.button !== 0 || this.editor.currentTool !== ToolType.AREA) return;
		event.preventDefault(); event.stopPropagation();
		this.press(event);
		const node = event.currentTarget;
		node.setPointerCapture?.(event.pointerId);
		const move = (next) => this.move(next);
		const end = (next) => { this.release(next); cleanup(); };
		const cancel = () => { this.cancelDrag(); cleanup(); };
		// Space belongs to the drag while it lasts, not to the temporary Hand tool.
		const space = (key) => {
			if (key.code !== 'Space' || !this.drag) return;
			key.preventDefault(); key.stopImmediatePropagation();
			this.drag.space = key.type === 'keydown';
		};
		const cleanup = () => {
			node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', end); node.removeEventListener('pointercancel', cancel);
			window.removeEventListener('keydown', space, true); window.removeEventListener('keyup', space, true);
		};
		node.addEventListener('pointermove', move); node.addEventListener('pointerup', end); node.addEventListener('pointercancel', cancel);
		window.addEventListener('keydown', space, true); window.addEventListener('keyup', space, true);
	}

	// A touch tap: the click that deselects.
	handleTap() {
		if (this.mode === 'new') this.area.clear();
	}

	nudge(event) {
		const step = event.shiftKey ? CONFIG.ui.nudge.fastStep : CONFIG.ui.nudge.step;
		const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
		const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
		this.shiftArea(dx, dy);
	}

	fill() { this.paintArea('add'); }
	erase() { this.paintArea('sub'); }
	invert() { this.area.invert(); }
	deselect() { this.cancelDrag(); this.area.clear(); }
	selectAll() { this.cancelDrag(); this.area.selectAll(); }

	crop() {
		if (!this.area.isEmpty) this.editor.cropTo('area');
	}

	// Fill or Erase the whole area on the fill layer it lands on. Fill makes
	// a layer when there is none, as the first brush stroke does.
	paintArea(mode) {
		const editor = this.editor;
		const area = this.area;
		if (area.isEmpty) return;
		const anchor = area.getAnchorPoint();
		const layer = editor.resolveFillLayer(anchor.x, anchor.y, { create: mode === 'add', deferHistory: true });
		if (!layer) {
			editor.showError(mode === 'sub' ? 'Nothing to erase here. Select a fill layer first' : 'Select or create an editable fill layer');
			return;
		}
		if (mode === 'sub' && !hasMaskContent(layer)) {
			editor.showError('Nothing to erase on this layer yet');
			return;
		}
		area.stampPaint(layer, editor.paintMaskStore.ensurePaintMask(layer.id), mode);
		editor.maskEditor.commitPaintEdit(layer, mode === 'add' ? 'Fill area' : 'Erase area');
		editor.updateStatus(mode === 'add' ? 'Area filled with glitter' : 'Area erased');
	}
}
