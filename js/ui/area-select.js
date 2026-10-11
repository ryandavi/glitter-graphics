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
		this.polygon = null;
		this.modify = null;
		this.modifyAmounts = {};
		this.wand = { tolerance: FIELDS.threshold.value, contiguous: true };
		// The last pointer position and modifiers over the workspace, for the cursor.
		this.hover = null;
		const track = (event) => {
			if (event.pointerType === 'touch') return;
			this.hover = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey };
			this.syncCursor();
			if (this.polygon) this.move(event);
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
		this.cancelDrag();
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
		return modeFromModifiers(input, this.mode);
	}

	// The cursor names what a press would do: move the area, or draw in a mode.
	syncCursor() {
		if (!this.hover || this.editor.currentTool !== ToolType.AREA) return;
		const drag = this.drag;
		const mode = drag ? drag.mode : this.resolveMode(this.hover);
		const moves = drag ? drag.moving : ['box', 'trace'].includes(AREA_SHAPES[this.shape].gesture) && mode === 'new' && this.area.contains(this.editor.viewport.screenToCanvas(this.hover.clientX, this.hover.clientY));
		this.editor.previewContainer.dataset.areaCursor = moves ? 'move' : mode;
	}

	// Called by the area whenever it changes.
	onAreaChanged() {
		if (this.modify && this.area.ops !== this.modify.baseOps) this.cancelModify();
		this.chrome.render();
		this.syncToolbar();
		this.syncCursor();
		this.editor.updateHelpfulMessage?.();
		this.editor.updateContextToolbars?.();
	}

	syncToolbar() {
		const renderer = this.editor.contextToolbarRenderer;
		if (!renderer) return;
		const empty = this.area.isEmpty;
		['contextAreaFill', 'contextAreaErase', 'contextAreaDeselect'].forEach((id) => renderer.setEnabled(id, !empty));
		// The tools that work inside the area carry its Deselect while it exists.
		['maskBrushDeselect', 'contextFillDeselect'].forEach((id) => {
			const button = document.getElementById(id);
			if (button) button.hidden = empty || !toolUsesArea(this.editor.currentTool);
		});
		renderer.setSegmentedValue('contextAreaShape', this.shape);
		renderer.setSegmentedValue('contextAreaMode', this.mode);
		const controls = AREA_SHAPES[this.shape].controls || [];
		Object.values(AREA_SHAPES).flatMap(shape => shape.controls || []).forEach(id => {
			const input = document.getElementById(id);
			if (input) input.closest('.context-slider-group, .context-checkbox-group').hidden = !controls.includes(id);
		});
		const tolerance = document.getElementById('contextAreaTolerance');
		if (tolerance) writeSliderValue(tolerance, this.wand.tolerance);
		renderer.setValue('contextAreaToleranceValue', this.wand.tolerance);
		const contiguous = document.getElementById('contextAreaContiguous');
		if (contiguous) contiguous.checked = this.wand.contiguous;
		if (this.modify) {
			renderer.setSegmentedValue('contextAreaModifyKind', this.modify.kind);
			writeSliderValue(document.getElementById('contextAreaModifyAmount'), this.modify.amount);
			renderer.setValue('contextAreaModifyAmountValue', `${this.modify.amount}px`);
		}
	}

	press(input) {
		if (this.modify) return;
		if (AREA_SHAPES[this.shape].gesture === 'corners') { this.addPolygonCorner(input); return; }
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
			moving: ['box', 'trace'].includes(AREA_SHAPES[this.shape].gesture) && mode === 'new' && this.area.contains(start),
			applied: { x: 0, y: 0 },
			// Space is held: the pointer carries the shape being drawn.
			space: false,
			// A modifier that chose the mode only shapes the drag once it has
			// been let go and pressed again.
			shiftFromPress: Boolean(input.shiftKey),
			altFromPress: Boolean(input.altKey),
			points: null, key: {}, baseOps: this.area.ops, redoStack: this.area.history.redoStack
		};
	}

	move(input) {
		if (this.polygon) {
			this.polygon.hover = this.polygonPoint(input);
			this.previewPolygon();
			return;
		}
		const drag = this.drag;
		if (!drag || (!drag.moved && !hasPassedDragThreshold(drag.client, input))) return;
		drag.moved = true;
		if (AREA_SHAPES[this.shape].gesture === 'pick') return;
		if (!input.shiftKey) drag.shiftFromPress = false;
		if (!input.altKey) drag.altFromPress = false;
		const point = this.editor.viewport.screenToCanvas(input.clientX, input.clientY);
		if (drag.moving) {
			let x = Math.round(point.x - drag.start.x);
			let y = Math.round(point.y - drag.start.y);
			if (input.shiftKey) { if (Math.abs(x) >= Math.abs(y)) y = 0; else x = 0; }
			this.shiftArea(x - drag.applied.x, y - drag.applied.y, { key: drag.key });
			const bounds = this.area.getBounds();
			if (bounds) this.reportGeometry(`${bounds.minX}, ${bounds.minY} px`);
			drag.applied = { x, y };
			return;
		}
		if (drag.space) {
			const carry = (entry) => ({ x: entry.x + point.x - drag.last.x, y: entry.y + point.y - drag.last.y });
			drag.start = carry(drag.start);
			drag.trace = drag.trace.map(carry);
		}
		drag.last = point;
		const shape = AREA_SHAPES[this.shape];
		const options = { square: Boolean(input.shiftKey) && !drag.shiftFromPress, fromCenter: Boolean(input.altKey) && !drag.altFromPress };
		drag.points = shape.gesture === 'trace' ? [this.traceLasso(drag, point)] : shape.build(drag.start, point, options);
		this.chrome.setDraft({ ops: this.area.combine(drag.points, drag.mode) });
		if (shape.gesture === 'box') {
			const box = areaBox(drag.start, point, options);
			this.reportGeometry(`${box.right - box.left} × ${box.bottom - box.top} px`);
		}
	}

	release(input) {
		const drag = this.drag;
		if (!drag) return;
		if (input) this.move(input);
		this.drag = null;
		this.chrome.setDraft(null);
		if (!drag.moved) {
			if (AREA_SHAPES[this.shape].gesture === 'pick') this.pickColor(drag.start, drag.mode);
			else if (drag.mode === 'new') this.area.clear();
		} else if (drag.points) {
			this.area.apply(drag.points, drag.mode);
		}
	}

	cancelDrag() {
		this.cancelPolygon();
		const drag = this.drag;
		if (!drag) return;
		this.drag = null;
		this.chrome.setDraft(null);
		if (drag.moving && this.area.history.undoStack.at(-1)?.key === drag.key) {
			this.area.history.undoStack.pop();
			this.area.history.redoStack = drag.redoStack;
			this.area.ops = drag.baseOps;
			this.area.changed();
		}
	}

	shiftArea(dx, dy, options) {
		this.area.moveBy(dx, dy, options);
	}

	reportGeometry(text) {
		if (text === this.geometryStatus) return;
		this.geometryStatus = text;
		this.editor.updateStatus(text);
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


	// Mouse and pen: the tool's onCanvasPointerDown.
	handlePointerDown(event) {
		if (event.pointerType === 'touch' || event.button !== 0 || this.editor.currentTool !== ToolType.AREA) return;
		event.preventDefault(); event.stopPropagation();
		this.press(event);
		if (!this.drag) return;
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
	handleTap(input) {
		if (this.modify) return;
		const gesture = AREA_SHAPES[this.shape].gesture;
		if (gesture === 'corners') this.addPolygonCorner({ ...input, pointerType: 'touch' });
		else if (gesture === 'pick') this.pickColor({ x: input.x, y: input.y }, this.mode);
		else if (this.mode === 'new') this.area.clear();
	}

	nudge(event) {
		const step = event.shiftKey ? CONFIG.ui.nudge.fastStep : CONFIG.ui.nudge.step;
		const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
		const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
		const now = performance.now();
		if (!this.nudgeKey || now - this.nudgeTime > CONFIG.ui.history.coalesceMs) this.nudgeKey = {};
		this.nudgeTime = now;
		this.shiftArea(dx, dy, { key: this.nudgeKey });
	}

	pickColor(point, mode) {
		if (mode === 'new' && this.area.contains(point)) {
			this.area.clear();
			return;
		}
		const target = getColorSelectionTarget(this.editor, point.x, point.y);
		if (!target) return;
		const { width, height } = this.area.getDocumentSize();
		const mask = new Uint8Array(width * height);
		matchColorSelection(this.editor, mask, target, this.wand.tolerance ** 2, this.wand.contiguous, null);
		this.area.applyCoverage(mask, mode);
	}

	polygonPoint(input) {
		let point = Number.isFinite(input.clientX) ? this.editor.viewport.screenToCanvas(input.clientX, input.clientY) : { x: input.x, y: input.y };
		const last = this.polygon?.points.at(-1);
		if (last && input.shiftKey) {
			const angle = Math.round(Math.atan2(point.y - last.y, point.x - last.x) / (Math.PI / 4)) * Math.PI / 4;
			const length = Math.hypot(point.x - last.x, point.y - last.y);
			point = { x: last.x + Math.cos(angle) * length, y: last.y + Math.sin(angle) * length };
		}
		return { x: Math.round(point.x), y: Math.round(point.y) };
	}

	addPolygonCorner(input) {
		const point = this.polygonPoint(input);
		if (!this.polygon) this.polygon = { mode: this.resolveMode(input), points: [], hover: point };
		const points = this.polygon.points;
		const radius = input.pointerType === 'touch' ? CONFIG.tools.area.polygonTouchCloseRadius : CONFIG.tools.area.polygonCloseRadius;
		if (points.length >= 3 && (Math.hypot(point.x - points[0].x, point.y - points[0].y) * this.editor.viewport.currentZoom <= radius || (this.polygonClick && performance.now() - this.polygonClick.time < CONFIG.tools.area.polygonDoubleClickMs && Math.hypot(point.x - this.polygonClick.point.x, point.y - this.polygonClick.point.y) * this.editor.viewport.currentZoom <= radius))) {
			this.closePolygon(); return;
		}
		if (!points.length || point.x !== points.at(-1).x || point.y !== points.at(-1).y) points.push(point);
		this.polygonClick = { point, time: performance.now() };
		this.polygon.hover = point;
		this.previewPolygon(); this.editor.updateHelpfulMessage();
	}
	previewPolygon() { this.chrome.setDraft({ ops: this.area.combine([[...this.polygon.points, this.polygon.hover]], this.polygon.mode) }); }
	closePolygon() {
		if (!this.polygon || this.polygon.points.length < 3) return;
		const polygon = this.polygon;
		this.cancelPolygon(); this.area.apply([polygon.points], polygon.mode);
	}
	removeLastCorner() {
		if (!this.polygon) return;
		this.polygon.points.pop();
		if (!this.polygon.points.length) this.cancelPolygon(); else this.previewPolygon();
	}
	cancelPolygon() {
		if (!this.polygon) return;
		this.polygon = null; this.polygonClick = null; this.chrome.setDraft(null);
		this.editor.updateHelpfulMessage();
	}

	beginModify(kind) {
		if (this.modify) { this.setModifyKind(kind); return; }
		if (this.area.isEmpty || this.editor.currentTool !== ToolType.AREA) return;
		this.cancelDrag();
		this.modify = { kind, amount: this.modifyAmounts[kind] || FIELDS.areaModifyAmount.value, baseOps: this.area.ops, source: this.area.getDistanceField(FIELDS.areaModifyAmount.max + 2), empty: true };
		const session = SESSIONS.find(entry => entry.id === 'areaModify');
		this.editor.notifications.setMode({ ...session.mode, confirmLabel: 'Apply (Enter)', onConfirm: () => this.applyModify(), exitLabel: 'Cancel (Esc)', onExit: () => this.cancelModify() });
		this.previewModify(); this.editor.updateContextToolbars(); this.editor.updateHelpfulMessage();
	}
	setModifyKind(kind) {
		if (!this.modify) return;
		this.modify.kind = kind; this.modify.amount = this.modifyAmounts[kind] || FIELDS.areaModifyAmount.value;
		this.scheduleModify();
	}
	setModifyAmount(value, phase) {
		if (!this.modify) return;
		this.modify.amount = Math.max(FIELDS.areaModifyAmount.min, Math.min(FIELDS.areaModifyAmount.max, Math.round(value)));
		if (this.modifySlow && AREA_MODIFIERS[this.modify.kind].passes && phase === 'input') { this.editor.updateStatus('Release to preview'); this.syncToolbar(); return; }
		this.scheduleModify();
	}
	scheduleModify() {
		if (!this.modifyFrame) this.modifyFrame = requestAnimationFrame(() => { this.modifyFrame = null; if (this.modify) this.previewModify(); });
		this.syncToolbar();
	}
	previewModify() {
		const start = performance.now();
		const modify = this.modify;
		if (!modify) return;
		modify.coverage = this.area.modifyCoverage(modify.source, modify.kind, modify.amount);
		const { width, height } = this.area.getDocumentSize();
		modify.rings = traceMaskContours(modify.coverage, width, height, 0);
		modify.empty = !modify.rings.length;
		this.chrome.setDraft({ ops: modify.empty ? [] : [{ op: 'add', rings: modify.rings }] });
		this.editor.notifications.setConfirmEnabled(!modify.empty);
		if (modify.empty) this.editor.updateStatus('Nothing is left at this amount');
		const elapsed = performance.now() - start;
		if (AREA_MODIFIERS[modify.kind].passes && elapsed > CONFIG.tools.area.smoothPreviewBudgetMs) this.modifySlow = true;
		dbg(`[Area] ${AREA_MODIFIERS[modify.kind].label} preview ${width} × ${height}: ${elapsed.toFixed(1)}ms`);
		this.syncToolbar();
	}
	nudgeModifyAmount(event) {
		const step = event.shiftKey ? CONFIG.ui.nudge.fastStep : CONFIG.ui.nudge.step;
		this.setModifyAmount(this.modify.amount + (['ArrowUp', 'ArrowRight'].includes(event.key) ? step : -step));
	}
	applyModify() {
		if (!this.modify) return;
		if (this.modifyFrame) { cancelAnimationFrame(this.modifyFrame); this.modifyFrame = null; }
		this.previewModify();
		if (this.modify.empty) return;
		const modify = this.modify;
		this.modifyAmounts[modify.kind] = modify.amount;
		this.cancelModify(); this.area.replace([{ op: 'add', rings: modify.rings }], { label: AREA_MODIFIERS[modify.kind].label });
	}
	cancelModify() {
		if (!this.modify) return;
		cancelAnimationFrame(this.modifyFrame); this.modifyFrame = null;
		this.modify = null; this.chrome.setDraft(null); this.editor.notifications.setMode(null);
		this.editor.updateContextToolbars(); this.editor.updateHelpfulMessage();
	}

	async selectLayerPixels(layers, mode = 'new') {
		this.cancelDrag(); this.cancelModify();
		const request = this.layerRequest = {};
		const document = this.editor.originalImageData;
		const activity = this.editor.beginActivity('select-layer', 'Selecting layer');
		try {
			const { width, height } = this.area.getDocumentSize();
			const coverage = new Uint8Array(width * height);
			for (const layer of layers) {
				const copy = { ...layer, visible: true, opacity: FIELDS.layerOpacity.value, blendMode: CONFIG.layers.defaultBlendMode, animations: null };
				for (const slot of getLayerPaintSlots(layer).filter(slot => ['shadow', 'sparkles'].includes(slot.role))) {
					const path = slot.definition.path.split('.');
					let target = copy;
					for (const key of path.slice(0, -1)) { target[key] = { ...target[key] }; target = target[key]; }
					target[path.at(-1)] = null;
				}
				const composed = await this.editor.sceneCompositor.composeFrameAt(this.editor.getSceneSnapshotParams([copy], { timestamp: 0, exportSettings: this.editor.getSceneSnapshotSettings({ baseImage: true }) }));
				for (let i = 0; i < coverage.length; i++) if (composed.imageData.data[i * 4 + 3] >= CONFIG.rendering.maskAlphaThreshold) coverage[i] = 255;
			}
			if (request !== this.layerRequest || document !== this.editor.originalImageData) return;
			if (!this.area.applyCoverage(coverage, mode)) { this.editor.showError('Nothing on this layer to select'); return; }
			if (!toolUsesArea(this.editor.currentTool)) COMMANDS.toolArea.run(this.editor);
		} catch (error) { dbg('[Area] Layer selection failed', error); this.editor.showError('Could not select this layer’s pixels'); }
		finally { activity(); }
	}
	toPath() {
		if (this.area.isEmpty) return;
		const { width, height } = this.area.getDocumentSize();
		const rings = this.area.ops.length === 1 && this.area.ops[0].op === 'add' ? this.area.ops[0].rings : traceMaskContours(this.area.getCoverage(), width, height, CONFIG.rendering.maskContourTolerancePx);
		const layer = this.editor.layerManager.addLayer(LayerType.PATH, { pathLayer: { name: 'Area', subpaths: rings.map(points => ({ closed: true, points })), stroke: null } });
		if (layer) this.editor.finishLayerCreation(layer);
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
