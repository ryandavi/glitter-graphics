'use strict';

// The Select Area tool: routes pointer gestures to the area selection
// (js/systems/AreaSelection.js) and runs its commands.
// - A drag draws the current shape. Shift held at the press adds to the area
//   and Alt subtracts from it, whatever the mode in the context bar says.
// - Pressed again during a rectangle or ellipse drag, Shift keeps it square
//   and Alt draws it from the center.
// - A click without a drag deselects, as it does in Photoshop.
class AreaSelectSession {
	constructor(editor) {
		this.editor = editor;
		this.chrome = new AreaChrome(editor);
		this.shape = 'rect';
		this.mode = 'new';
		this.drag = null;
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
	}

	// Called by the area whenever it changes.
	onAreaChanged() {
		this.chrome.render();
		this.syncToolbar();
		this.editor.updateHelpfulMessage?.();
	}

	syncToolbar() {
		const renderer = this.editor.contextToolbarRenderer;
		if (!renderer) return;
		const empty = this.area.isEmpty;
		['contextAreaFill', 'contextAreaErase', 'contextAreaInvert', 'contextAreaDeselect'].forEach((id) => renderer.setEnabled(id, !empty));
		const brushDeselect = document.getElementById('maskBrushDeselect');
		if (brushDeselect) brushDeselect.hidden = empty;
		renderer.setSegmentedValue('contextAreaShape', this.shape);
		renderer.setSegmentedValue('contextAreaMode', this.mode);
	}

	press(input) {
		this.drag = {
			mode: input.shiftKey ? 'add' : input.altKey ? 'subtract' : this.mode,
			start: this.editor.viewport.screenToCanvas(input.clientX, input.clientY),
			client: { x: input.clientX, y: input.clientY },
			trace: [],
			moved: false,
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
		if (!this.drag) return;
		this.drag = null;
		this.chrome.setDraft(null);
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
		const cleanup = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', end); node.removeEventListener('pointercancel', cancel); };
		node.addEventListener('pointermove', move); node.addEventListener('pointerup', end); node.addEventListener('pointercancel', cancel);
	}

	// A touch tap: the click that deselects.
	handleTap() {
		if (this.mode === 'new') this.area.clear();
	}

	nudge(event) {
		const step = event.shiftKey ? CONFIG.ui.nudge.fastStep : CONFIG.ui.nudge.step;
		const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
		const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
		this.area.transformPoints((point) => ({ x: point.x + dx, y: point.y + dy }));
	}

	fill() { this.paintArea('add'); }
	erase() { this.paintArea('sub'); }
	invert() { this.area.invert(); }
	deselect() { this.cancelDrag(); this.area.clear(); }

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
