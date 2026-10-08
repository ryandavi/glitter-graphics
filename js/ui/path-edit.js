'use strict';

// The path point editor: the Pen tool's session (editor.pathEdit).
//
// It edits "a set of subpaths in canvas px" through a host
// ({ layerId, getLayer(), read(), write(subpaths, { label, coalesceKey,
// render }), render() }) and never touches layer data itself.
// PathLayerManager.createEditHost supplies one; anything else that owns
// points can supply another.
//
// `session` is transient UI state: the layer id and point addresses
// ("subpath:point" keys), never object references, because undo rebuilds the
// layer objects. revalidate() re-reads it after every history restore.
//
// Two modes. `draw` appends points to one end of an open subpath (a new
// path, or an existing one continued from an endpoint). `edit` selects, moves
// and reshapes points. Mouse and pen arrive through handlePointerDown, touch
// through the tool's toolDrag route and taps; both run press / move / release.
//
// During a drag the geometry lives in `drag.current` and the chrome is drawn
// from it every frame. The painted layer follows through the host, until one
// of its redraws overruns the raster budget: from then on that drag moves the
// chrome only and the layer is redrawn once on release.
class PathEditSession {
	constructor(editor) {
		this.editor = editor;
		this.session = null;
		this.chrome = new PathChrome(editor);
		const coarse = PathChrome.isCoarse();
		// What a click places while drawing: 'corner' or 'curve'.
		this.nextPointType = CONFIG.tools.path.nextPoint[coarse ? 'coarse' : 'fine'];
		this.lastClick = null;
		this.previewFrame = null;
		this.bindPanel();
		const container = editor.previewContainer;
		container?.addEventListener('pointermove', (event) => this.handleHover(event));
		container?.addEventListener('pointerleave', () => this.clearHover());
	}

	// ===== SESSION LIFECYCLE =====

	getLayer() {
		return this.session?.host.getLayer() || null;
	}

	// Start editing a path's points. Switches to the Pen, which owns the
	// session.
	begin(layer) {
		if (layer?.type !== LayerType.PATH) return false;
		if (this.session?.layerId === layer.id) return true;
		if (!this.editor.canEditLayer(layer, { notify: true }) || !layer.visible) return false;
		this.end();
		if (this.editor.layerManager.activeLayerId !== layer.id || this.editor.layerManager.hasMultiSelection()) {
			this.editor.layerManager.selectLayerFromCanvas(layer.id);
		}
		this.openSession(layer.id, { mode: 'edit' });
		if (this.editor.currentTool !== ToolType.PEN) this.editor.setTool(ToolType.PEN);
		this.refresh();
		this.editor.updateStatus('Editing path points');
		return true;
	}

	openSession(layerId, { mode, drawEnd = null, created = false }) {
		this.session = {
			layerId,
			host: this.editor.pathLayerManager.createEditHost(layerId),
			mode,
			drawEnd,
			selection: new Set(),
			drag: null,
			pointer: null,
			hover: null,
			created
		};
		this.chrome.show();
	}

	// Leave the session. A path left with fewer than two points is removed,
	// as committing empty text removes its layer.
	end({ keepTool = true } = {}) {
		const session = this.session;
		if (!session) {
			if (!keepTool && this.editor.currentTool === ToolType.PEN) this.editor.setTool(ToolType.SELECT);
			return;
		}
		this.cancelDrag();
		this.session = null;
		this.lastClick = null;
		this.chrome.hide();
		this.editor.clearSmartGuides();
		this.editor.previewContainer?.removeAttribute('data-path-hover');
		const layer = session.host.getLayer();
		if (layer && PathGeometry.countPoints(layer.pathData.subpaths) < 2) {
			this.editor.layerManager.deleteLayer(layer.id, { skipHistory: true });
			if (!session.created || session.historyCommitted) this.editor.saveState('Edit path');
			this.editor.requestPreviewUpdate();
		}
		this.syncPanel();
		this.editor.updateContextToolbars();
		if (!keepTool && this.editor.currentTool === ToolType.PEN) this.editor.setTool(ToolType.SELECT);
	}

	// The Pen was picked: a selected path opens for editing.
	onToolActivated() {
		if (this.session) return;
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type === LayerType.PATH && !this.editor.layerManager.hasMultiSelection()
			&& layer.visible && this.editor.canEditLayer(layer)) {
			this.openSession(layer.id, { mode: 'edit' });
			this.refresh();
		}
	}

	// After a history restore, or anything else that may have changed the
	// layer behind the session: drop what no longer exists.
	revalidate() {
		const session = this.session;
		if (!session) return;
		const layer = session.host.getLayer();
		if (!layer || !layer.visible || !this.editor.canEditLayer(layer)) {
			this.end();
			return;
		}
		const subpaths = layer.pathData.subpaths;
		session.selection = new Set(Array.from(session.selection).filter((key) => {
			const [s, p] = key.split(':').map(Number);
			return Boolean(subpaths[s]?.points[p]);
		}));
		if (session.mode === 'draw') {
			const subpath = subpaths[session.drawEnd.subpath];
			if (!subpath || subpath.closed || !subpath.points.length) {
				session.mode = 'edit';
				session.drawEnd = null;
			} else {
				session.selection = new Set([this.getDrawEndKey(subpath)]);
			}
		}
		this.refresh();
	}

	// A manager edited the geometry behind the session (Close, Reverse).
	syncAfterExternalEdit(layerId) {
		if (this.session?.layerId !== layerId) return;
		this.session.selection.clear();
		this.session.mode = 'edit';
		this.session.drawEnd = null;
	}

	// ===== MODEL =====

	read() {
		const session = this.session;
		if (!session) return [];
		return session.drag?.current || session.host.read();
	}

	getDrawEndIndex(subpath) {
		return this.session.drawEnd.atStart ? 0 : subpath.points.length - 1;
	}

	getDrawEndKey(subpath) {
		return `${this.session.drawEnd.subpath}:${this.getDrawEndIndex(subpath)}`;
	}

	// The point a drawing path would close onto: its other end.
	getCloseAddress(subpaths) {
		const session = this.session;
		if (session?.mode !== 'draw') return null;
		const subpath = subpaths[session.drawEnd.subpath];
		if (!subpath || subpath.points.length < 3) return null;
		return { subpath: session.drawEnd.subpath, point: session.drawEnd.atStart ? subpath.points.length - 1 : 0 };
	}

	buildModel() {
		const session = this.session;
		const subpaths = this.read();
		const model = {
			subpaths,
			selection: session.selection,
			drawEnd: session.mode === 'draw' ? session.drawEnd : null,
			hover: session.drag ? null : session.hover,
			closeTarget: null,
			preview: null,
			marquee: session.drag?.kind === 'marquee' ? session.drag.box : null
		};
		// The next segment follows a mouse or pen while drawing. Touch has no
		// hover, so the path is drawn up to its last placed point.
		if (session.mode === 'draw' && session.pointer && !session.drag) {
			const subpath = subpaths[session.drawEnd.subpath];
			const end = subpath?.points[this.getDrawEndIndex(subpath)];
			if (end) {
				const lead = end[session.drawEnd.atStart ? 'in' : 'out'];
				const close = session.pointer.close ? this.getCloseAddress(subpaths) : null;
				const target = close ? subpaths[close.subpath].points[close.point] : session.pointer;
				if (close) model.closeTarget = `${close.subpath}:${close.point}`;
				model.preview = {
					from: { x: end.x, y: end.y },
					control: lead ? { x: end.x + lead.x, y: end.y + lead.y } : null,
					to: { x: target.x, y: target.y }
				};
			}
		}
		return model;
	}

	// Redraw the chrome from current state (the path manager calls this after
	// every render of the layer).
	syncChrome() {
		const session = this.session;
		if (!session) return;
		if (!session.host.getLayer()) {
			this.end();
			return;
		}
		this.chrome.setModel(this.buildModel());
	}

	refresh() {
		if (!this.session) return;
		this.syncChrome();
		this.syncPanel();
		this.syncToolbar();
		this.editor.updateContextToolbars();
	}

	// Write a finished edit: one history step.
	commit(subpaths, label, coalesceKey = null) {
		const session = this.session;
		if (!session) return;
		subpaths.forEach((subpath) => PathGeometry.solveAutoHandles(subpath));
		session.drag = null;
		const provisional = session.created && !session.historyCommitted && PathGeometry.countPoints(subpaths) < 2;
		session.host.write(subpaths, { label: provisional ? null : label, coalesceKey });
		if (!provisional) session.historyCommitted = true;
		this.refresh();
	}

	// ===== LIVE DRAGS =====

	// The chrome follows the pointer every frame; the layer's masks follow
	// until a redraw overruns the raster budget.
	schedulePreview() {
		if (this.previewFrame) return;
		this.previewFrame = requestAnimationFrame(() => {
			this.previewFrame = null;
			this.flushPreview();
		});
	}

	flushPreview() {
		const drag = this.session?.drag;
		if (!drag?.current) return;
		drag.current.forEach((subpath) => PathGeometry.solveAutoHandles(subpath));
		if (!drag.chromeOnly && drag.kind !== 'marquee') {
			const started = performance.now();
			this.session.host.write(PathGeometry.cloneSubpaths(drag.current), { render: true });
			if (performance.now() - started > CONFIG.ui.live.rasterBudgetMs) drag.chromeOnly = true;
		}
		this.syncChrome();
	}

	cancelDrag() {
		const session = this.session;
		const drag = session?.drag;
		if (this.previewFrame) cancelAnimationFrame(this.previewFrame);
		this.previewFrame = null;
		this.releasePointerListeners?.();
		if (!drag) return;
		session.drag = null;
		this.editor.clearSmartGuides();
		if (drag.selectionBefore) session.selection = drag.selectionBefore;
		if (drag.modeBefore) {
			session.mode = drag.modeBefore.mode;
			session.drawEnd = drag.modeBefore.drawEnd;
		}
		if (drag.newLayer) {
			// The press that started this path never finished: no path.
			this.session = null;
			this.chrome.hide();
			this.editor.layerManager.deleteLayer(session.layerId, { skipHistory: true });
			this.editor.requestPreviewUpdate();
			this.syncPanel();
			this.editor.updateContextToolbars();
			return;
		}
		if (drag.origin && drag.kind !== 'marquee') session.host.write(drag.origin, { render: true });
		this.refresh();
	}

	// ===== POINTER INPUT =====

	toCanvasPoint(input) {
		return this.editor.viewport.screenToCanvas(input.clientX, input.clientY);
	}

	// Mouse and pen: the Pen tool's onCanvasPointerDown.
	handlePointerDown(event) {
		if (this.session?.drag) return;
		event.preventDefault();
		const pointerId = event.pointerId;
		this.press(event);
		if (!this.session?.drag) return;
		const onMove = (moveEvent) => {
			if (moveEvent.pointerId === pointerId) this.move(moveEvent);
		};
		const onUp = (upEvent) => {
			if (upEvent.pointerId !== pointerId) return;
			this.releasePointerListeners?.();
			this.release(upEvent);
		};
		const onCancel = (cancelEvent) => {
			if (cancelEvent.pointerId === pointerId) this.cancelDrag();
		};
		this.releasePointerListeners = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			this.releasePointerListeners = null;
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
	}

	// Touch: a tap is a press and release in place; a one-finger drag starts
	// where the finger went down. Two fingers never reach the session.
	handleTap(action) {
		const input = { clientX: action.clientX, clientY: action.clientY, pointerType: 'touch' };
		this.press(input);
		if (this.session?.drag) this.release(input);
	}

	beginTouchDrag(point) {
		this.press({ ...point, pointerType: 'touch' });
		if (this.session?.drag) this.session.drag.moved = true;
	}

	moveTouchDrag(point) {
		if (this.session?.drag) this.move({ ...point, pointerType: 'touch' });
	}

	endTouchDrag(point) {
		if (this.session?.drag) this.release({ ...point, pointerType: 'touch' });
	}

	handleHover(event) {
		const session = this.session;
		if (!session || session.drag || event.pointerType === 'touch' || this.editor.currentTool !== ToolType.PEN) return;
		if (event.target.closest?.('.ui-ignore-gestures')) {
			this.clearHover();
			return;
		}
		const hit = this.chrome.hitTest(event.clientX, event.clientY, event.pointerType);
		session.hover = hit;
		if (session.mode === 'draw') {
			const subpaths = this.read();
			const close = this.isOverCloseTarget(event, subpaths);
			const point = close ? null : this.resolvePlacement(this.toCanvasPoint(event), event, subpaths, { guides: false });
			session.pointer = close ? { close: true } : point;
		} else {
			session.pointer = null;
		}
		this.editor.previewContainer.dataset.pathHover = session.mode === 'draw' ? 'draw' : (hit?.kind || 'empty');
		this.syncChrome();
	}

	clearHover() {
		const session = this.session;
		if (!session || session.drag) return;
		session.hover = null;
		session.pointer = null;
		this.syncChrome();
	}

	isOverCloseTarget(input, subpaths) {
		const close = this.getCloseAddress(subpaths);
		if (!close) return false;
		const config = CONFIG.tools.path.chrome;
		const radius = PathChrome.isCoarse(input.pointerType) ? config.closeRadiusCoarse : config.closeRadius;
		return this.chrome.distanceToAnchor(input.clientX, input.clientY, close.subpath, close.point) <= radius;
	}

	// ===== SNAPPING =====

	// Where an anchor lands: on a whole pixel (the preference
	// roundLayerPosition's callers read), pulled onto a nearby snap target.
	// `exclude` holds the keys of the points being moved.
	snapAnchor(point, input, subpaths, { exclude = null, guides = true } = {}) {
		const rounded = CONFIG.tools.stickers.transform.roundValues
			? { x: Math.round(point.x), y: Math.round(point.y) }
			: { x: point.x, y: point.y };
		if (!PREFERENCES.get('snappingEnabled') || input.ctrlKey || input.metaKey) {
			if (guides) this.editor.clearSmartGuides();
			return rounded;
		}
		const targets = this.editor.collectSnapTargets('point', this.session ? [this.session.layerId] : []);
		if (CONFIG.snapping.targets.point.ownPoints) {
			subpaths.forEach((subpath, s) => subpath.points.forEach((other, p) => {
				if (exclude?.has(`${s}:${p}`)) return;
				targets.x.push(other.x);
				targets.y.push(other.y);
			}));
		}
		const threshold = CONFIG.snapping.threshold / Math.max(0.01, this.editor.viewport.currentZoom);
		const nearest = (value, candidates) => {
			let best = null;
			candidates.forEach((candidate) => {
				const distance = Math.abs(candidate - value);
				if (distance <= threshold && (best == null || distance < Math.abs(best - value))) best = candidate;
			});
			return best;
		};
		const x = nearest(point.x, targets.x);
		const y = nearest(point.y, targets.y);
		if (guides) this.editor.renderSmartGuides(x ?? undefined, y ?? undefined);
		const snapped = { x: x ?? rounded.x, y: y ?? rounded.y };
		return CONFIG.tools.stickers.transform.roundValues
			? { x: Math.round(snapped.x), y: Math.round(snapped.y) } : snapped;
	}

	// Where the next drawn point goes: Shift holds the segment to angle steps
	// from the last point; otherwise it snaps like any anchor.
	resolvePlacement(canvasPoint, input, subpaths, options = {}) {
		const session = this.session;
		const subpath = session?.mode === 'draw' ? subpaths[session.drawEnd.subpath] : null;
		const previous = subpath?.points[this.getDrawEndIndex(subpath)];
		if (input.shiftKey && previous) {
			if (options.guides !== false) this.editor.clearSmartGuides();
			const constrained = PathGeometry.constrainAngle(previous, canvasPoint, CONFIG.tools.path.line.angleStepDeg);
			return CONFIG.tools.stickers.transform.roundValues
				? { x: Math.round(constrained.x), y: Math.round(constrained.y) } : constrained;
		}
		return this.snapAnchor(canvasPoint, input, subpaths, options);
	}

	// ===== PRESS / MOVE / RELEASE =====

	press(input) {
		const canvasPoint = this.toCanvasPoint(input);
		if (!this.session) {
			this.startNewPath(canvasPoint, input);
			return;
		}
		const session = this.session;
		if (!session.host.getLayer()) {
			this.end();
			return;
		}
		const subpaths = PathGeometry.cloneSubpaths(session.host.read());
		const base = {
			startClient: { x: input.clientX, y: input.clientY },
			startCanvas: canvasPoint,
			origin: PathGeometry.cloneSubpaths(subpaths),
			current: subpaths,
			moved: false,
			selectionBefore: new Set(session.selection),
			modeBefore: { mode: session.mode, drawEnd: session.drawEnd }
		};
		session.pointer = null;
		session.hover = null;

		if (session.mode === 'draw') {
			if (this.isOverCloseTarget(input, subpaths)) {
				this.closeDrawing(subpaths);
				return;
			}
			const subpath = subpaths[session.drawEnd.subpath];
			const endIndex = this.getDrawEndIndex(subpath);
			const hit = this.chrome.hitTest(input.clientX, input.clientY, input.pointerType);
			// A press on the point just placed reshapes it; it never stacks a
			// second point on top.
			if (hit?.kind === 'anchor' && hit.subpath === session.drawEnd.subpath && hit.point === endIndex) {
				session.drag = { ...base, kind: 'place', address: [hit.subpath, hit.point], existing: true };
				return;
			}
			this.placePoint(canvasPoint, input, base);
			return;
		}

		const hit = this.chrome.hitTest(input.clientX, input.clientY, input.pointerType);
		if (hit?.kind === 'handle') {
			session.drag = { ...base, kind: 'handle', address: [hit.subpath, hit.point], side: hit.side };
		} else if (hit?.kind === 'anchor') {
			const key = `${hit.subpath}:${hit.point}`;
			const wasSelected = session.selection.has(key);
			if (input.shiftKey) {
				if (wasSelected) session.selection.delete(key);
				else session.selection.add(key);
			} else if (!wasSelected) {
				session.selection = new Set([key]);
			}
			session.drag = { ...base, kind: 'points', address: [hit.subpath, hit.point], key, wasSelected };
		} else if (hit?.kind === 'segment') {
			session.drag = { ...base, kind: 'segment', subpath: hit.subpath, segment: hit.segment, t: hit.t };
		} else {
			session.drag = { ...base, kind: 'marquee', additive: Boolean(input.shiftKey), box: null };
		}
		this.syncChrome();
		this.syncPanel();
		this.syncToolbar();
	}

	// The first press of the Pen on empty canvas: a path is a real layer from
	// its first point; history starts when the second point is placed.
	startNewPath(canvasPoint, input) {
		const editor = this.editor;
		if (!editor.viewport.isWithinCanvas(canvasPoint.x, canvasPoint.y) && input.pointerType === 'touch') return;
		const point = this.snapAnchor(canvasPoint, input, []);
		const layer = editor.layerManager.addLayer(LayerType.PATH, {
			skipHistory: true,
			pathLayer: { subpaths: [{ closed: false, points: [{ ...point, type: this.nextPointType === 'curve' ? 'auto' : 'corner' }] }] }
		});
		if (!layer) return;
		this.openSession(layer.id, { mode: 'draw', drawEnd: { subpath: 0, atStart: false }, created: true });
		const session = this.session;
		session.selection = new Set(['0:0']);
		session.drag = {
			kind: 'place',
			address: [0, 0],
			newLayer: true,
			startClient: { x: input.clientX, y: input.clientY },
			startCanvas: canvasPoint,
			origin: null,
			current: PathGeometry.cloneSubpaths(session.host.read()),
			moved: false
		};
		this.refresh();
	}

	placePoint(canvasPoint, input, base) {
		const session = this.session;
		const subpaths = base.current;
		const subpath = subpaths[session.drawEnd.subpath];
		const target = this.resolvePlacement(canvasPoint, input, subpaths);
		const point = { x: target.x, y: target.y, in: null, out: null, type: this.nextPointType === 'curve' ? 'auto' : 'corner' };
		if (session.drawEnd.atStart) subpath.points.unshift(point);
		else subpath.points.push(point);
		const index = this.getDrawEndIndex(subpath);
		session.selection = new Set([`${session.drawEnd.subpath}:${index}`]);
		session.drag = { ...base, kind: 'place', address: [session.drawEnd.subpath, index] };
		this.flushPreview();
	}

	move(input) {
		const session = this.session;
		const drag = session?.drag;
		if (!drag) return;
		if (!drag.moved) {
			const distance = Math.hypot(input.clientX - drag.startClient.x, input.clientY - drag.startClient.y);
			if (distance < CONFIG.tools.path.chrome.dragThresholdPx) return;
			drag.moved = true;
		}
		const canvasPoint = this.toCanvasPoint(input);
		const subpaths = drag.current;
		const step = CONFIG.tools.path.line.angleStepDeg;

		if (drag.kind === 'place') {
			// Dragging off a new point pulls its handles: the leading one
			// follows the pointer, the trailing one mirrors it. Alt moves the
			// leading handle alone.
			const point = subpaths[drag.address[0]].points[drag.address[1]];
			const tip = input.shiftKey ? PathGeometry.constrainAngle(point, canvasPoint, step) : canvasPoint;
			const vector = { x: tip.x - point.x, y: tip.y - point.y };
			const lead = session.drawEnd.atStart ? 'in' : 'out';
			const trail = lead === 'in' ? 'out' : 'in';
			point[lead] = vector;
			if (input.altKey) {
				point.type = 'corner';
			} else {
				point[trail] = { x: -vector.x, y: -vector.y };
				point.type = 'smooth';
			}
		} else if (drag.kind === 'handle') {
			const point = subpaths[drag.address[0]].points[drag.address[1]];
			const tip = input.shiftKey ? PathGeometry.constrainAngle(point, canvasPoint, step) : canvasPoint;
			point[drag.side] = { x: tip.x - point.x, y: tip.y - point.y };
			// Alt breaks the pair; a derived point becomes one the user shaped.
			if (input.altKey) point.type = 'corner';
			else if (point.type === 'auto') point.type = 'smooth';
			PathGeometry.constrainHandles(point, drag.side);
		} else if (drag.kind === 'points') {
			const grabbed = drag.origin[drag.address[0]].points[drag.address[1]];
			let target = { x: grabbed.x + canvasPoint.x - drag.startCanvas.x, y: grabbed.y + canvasPoint.y - drag.startCanvas.y };
			if (input.shiftKey) {
				// Shift keeps the move on one axis.
				if (Math.abs(target.x - grabbed.x) >= Math.abs(target.y - grabbed.y)) target.y = grabbed.y;
				else target.x = grabbed.x;
			}
			if (!session.selection.has(drag.key)) session.selection.add(drag.key);
			target = this.snapAnchor(target, input, drag.origin, { exclude: session.selection });
			const dx = target.x - grabbed.x;
			const dy = target.y - grabbed.y;
			session.selection.forEach((key) => {
				const [s, p] = key.split(':').map(Number);
				const from = drag.origin[s]?.points[p];
				const to = subpaths[s]?.points[p];
				if (!from || !to) return;
				to.x = from.x + dx;
				to.y = from.y + dy;
			});
		} else if (drag.kind === 'segment') {
			const origin = drag.origin[drag.subpath];
			const subpath = subpaths[drag.subpath];
			const count = subpath.points.length;
			const a = subpath.points[drag.segment];
			const b = subpath.points[(drag.segment + 1) % count];
			const handles = PathGeometry.dragSegment(
				PathGeometry.getSegment(origin, drag.segment),
				drag.t,
				{ x: canvasPoint.x - drag.startCanvas.x, y: canvasPoint.y - drag.startCanvas.y }
			);
			a.out = handles.out;
			b.in = handles.in;
			// A smooth neighbour's far handle turns to stay in line, keeping
			// its length; a mirrored or derived pair becomes smooth.
			[[a, 'out'], [b, 'in']].forEach(([point, side]) => {
				if (point.type === 'mirrored' || point.type === 'auto') point.type = 'smooth';
				PathGeometry.constrainHandles(point, side);
			});
		} else if (drag.kind === 'marquee') {
			const box = {
				left: Math.min(drag.startCanvas.x, canvasPoint.x),
				right: Math.max(drag.startCanvas.x, canvasPoint.x),
				top: Math.min(drag.startCanvas.y, canvasPoint.y),
				bottom: Math.max(drag.startCanvas.y, canvasPoint.y)
			};
			drag.box = box;
			const selection = new Set(drag.additive ? drag.selectionBefore : []);
			subpaths.forEach((subpath, s) => subpath.points.forEach((point, p) => {
				if (point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom) selection.add(`${s}:${p}`);
			}));
			session.selection = selection;
		}
		this.schedulePreview();
	}

	release(input) {
		const session = this.session;
		const drag = session?.drag;
		if (!drag) return;
		if (this.previewFrame) cancelAnimationFrame(this.previewFrame);
		this.previewFrame = null;
		this.editor.clearSmartGuides();
		const subpaths = drag.current;
		const doubleClick = this.registerClick(input, drag);

		if (drag.kind === 'place') {
			if (!drag.moved && drag.existing) {
				// A second click on the point just placed switches it between a
				// corner and a curve the path flows through.
				const point = subpaths[drag.address[0]].points[drag.address[1]];
				const subpath = subpaths[drag.address[0]];
				const isEnd = !subpath.closed && (drag.address[1] === 0 || drag.address[1] === subpath.points.length - 1);
				if (isEnd || doubleClick) {
					if (point.in || point.out) PathGeometry.removeHandles(subpath, drag.address[1]);
					else PathGeometry.setPointType(subpath, drag.address[1], 'smooth');
					if (doubleClick) {
						session.mode = 'edit';
						session.drawEnd = null;
					}
				} else if (point.type === 'auto') PathGeometry.removeHandles(subpath, drag.address[1]);
				else {
					point.in = null;
					point.out = null;
					point.type = 'auto';
				}
				this.commit(subpaths, 'Change point type');
				return;
			}
			this.commit(subpaths, drag.existing ? 'Edit point' : 'Add point');
			return;
		}
		if (drag.kind === 'handle') {
			if (drag.moved) this.commit(subpaths, 'Edit point');
			else this.finishClick();
			return;
		}
		if (drag.kind === 'points') {
			if (drag.moved) {
				this.commit(subpaths, 'Move points');
				return;
			}
			const [s, p] = drag.address;
			const subpath = subpaths[s];
			if (doubleClick && !input.shiftKey) {
				// Double-click: Corner <-> Smooth.
				const point = subpath.points[p];
				if (point.in || point.out) PathGeometry.removeHandles(subpath, p);
				else PathGeometry.setPointType(subpath, p, 'smooth');
				session.mode = 'edit';
				session.drawEnd = null;
				this.commit(subpaths, 'Change point type');
				return;
			}
			// A click on an open path's endpoint continues the path from it.
			const isEnd = !subpath.closed && (p === 0 || p === subpath.points.length - 1);
			if (isEnd && !input.shiftKey && subpath.points.length > 0) {
				session.mode = 'draw';
				session.drawEnd = { subpath: s, atStart: p === 0 && subpath.points.length > 1 };
				session.selection = new Set([drag.key]);
				this.editor.updateStatus('Click to continue the path');
			}
			this.finishClick();
			return;
		}
		if (drag.kind === 'segment') {
			if (drag.moved) {
				this.commit(subpaths, 'Bend segment');
				return;
			}
			// A click on a segment adds a point without changing the curve.
			const index = PathGeometry.insertPoint(subpaths[drag.subpath], drag.segment, drag.t);
			session.selection = new Set([`${drag.subpath}:${index}`]);
			this.commit(subpaths, 'Add point');
			return;
		}
		// Marquee: a drag selected points; a click on empty canvas clears the
		// selection, and with nothing selected leaves the path.
		if (!drag.moved) {
			if (drag.selectionBefore.size) {
				session.selection = new Set();
				this.finishClick();
			} else {
				session.drag = null;
				this.end();
			}
			return;
		}
		this.finishClick();
	}

	finishClick() {
		if (!this.session) return;
		this.session.drag = null;
		this.refresh();
	}

	// Whether this release is the second click of a double-click on one spot.
	registerClick(input, drag) {
		if (drag.moved || input.pointerType === 'touch') {
			this.lastClick = null;
			return false;
		}
		const gestures = CONFIG.ui.gestures;
		const now = Date.now();
		const previous = this.lastClick;
		const isDouble = Boolean(previous) && now - previous.time <= gestures.doubleTapMs
			&& Math.hypot(input.clientX - previous.x, input.clientY - previous.y) <= gestures.tapSlopPx;
		this.lastClick = isDouble ? null : { time: now, x: input.clientX, y: input.clientY };
		return isDouble;
	}

	// ===== DRAWING =====

	// Join the drawing end to the path's other end. A path drawn in this
	// session takes a closed path's defaults: a fill and no stroke.
	closeDrawing(subpaths) {
		const session = this.session;
		subpaths[session.drawEnd.subpath].closed = true;
		session.mode = 'edit';
		session.drawEnd = null;
		session.selection = new Set();
		const layer = session.host.getLayer();
		if (session.created && layer && layer.pathData.fill.mode === 'none') {
			const manager = this.editor.pathLayerManager;
			const fill = layer.pathData.fill;
			fill.mode = manager.getDefaultFill().mode;
			if (fill.mode === 'glitter' && !fill.glitterId) fill.glitterId = getPaintSlotDefaultGlitterId(LayerType.PATH, getPaintSlotDefinition(LayerType.PATH, 'fill'));
			toggleSlotEffect(layer, getPaintSlotDefinition(LayerType.PATH, 'stroke'), false, () => manager.getDefaultStroke());
		}
		this.commit(subpaths, 'Close path');
		this.editor.updateStatus('Path closed');
	}

	// Stop adding points and leave the path open.
	finishDrawing() {
		const session = this.session;
		if (session?.mode !== 'draw') return;
		this.cancelDrag();
		if (!this.session) return;
		session.mode = 'edit';
		session.drawEnd = null;
		session.pointer = null;
		const layer = session.host.getLayer();
		if (!layer || PathGeometry.countPoints(layer.pathData.subpaths) < 2) {
			this.end();
			return;
		}
		this.refresh();
		this.editor.updateStatus('Path finished');
	}

	// ===== COMMANDS =====

	// Delete / Backspace: the last point while drawing, the selected points
	// while editing.
	deleteSelection() {
		const session = this.session;
		if (!session) return;
		this.cancelDrag();
		if (!this.session) return;
		const subpaths = PathGeometry.cloneSubpaths(session.host.read());
		if (session.mode === 'draw') {
			const subpath = subpaths[session.drawEnd.subpath];
			if (PathGeometry.countPoints(subpaths) <= 1) {
				this.end();
				return;
			}
			PathGeometry.deletePoint(subpath, this.getDrawEndIndex(subpath));
			session.selection = new Set([this.getDrawEndKey(subpath)]);
			this.commit(subpaths, 'Delete point');
			return;
		}
		if (!session.selection.size) return;
		const bySubpath = new Map();
		session.selection.forEach((key) => {
			const [s, p] = key.split(':').map(Number);
			if (!bySubpath.has(s)) bySubpath.set(s, []);
			bySubpath.get(s).push(p);
		});
		bySubpath.forEach((indices, s) => {
			indices.sort((a, b) => b - a).forEach((p) => PathGeometry.deletePoint(subpaths[s], p));
		});
		const remaining = subpaths.filter((subpath) => subpath.points.length > 0);
		session.selection = new Set();
		if (PathGeometry.countPoints(remaining) < 2) {
			session.host.write(remaining, {});
			this.end();
			return;
		}
		this.commit(remaining, 'Delete points');
	}

	nudge(event) {
		const session = this.session;
		if (!session?.selection.size || session.drag) return;
		const config = CONFIG.tools.path.nudge;
		const step = event.shiftKey ? config.fastStep : config.step;
		const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
		const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
		const subpaths = PathGeometry.cloneSubpaths(session.host.read());
		session.selection.forEach((key) => {
			const [s, p] = key.split(':').map(Number);
			const point = subpaths[s]?.points[p];
			if (!point) return;
			point.x += dx;
			point.y += dy;
		});
		this.commit(subpaths, 'Move points', `path-nudge:${session.layerId}`);
	}

	// Enter opens the selected path with Select, finishes a path being drawn,
	// and leaves the session otherwise.
	canHandleEnter() {
		if (this.session) return true;
		if (this.editor.currentTool !== ToolType.SELECT || this.editor.layerManager.hasMultiSelection()) return false;
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.PATH) return false;
		// A focused control keeps its own Enter.
		const active = document.activeElement;
		return !active || active === document.body || !active.closest('button, a, select, summary, [role="button"], [role="option"]');
	}

	handleEnter() {
		const session = this.session;
		if (!session) {
			this.begin(this.editor.layerManager.getActiveLayer());
			return;
		}
		if (session.mode === 'draw') this.finishDrawing();
		else this.end({ keepTool: false });
	}

	// Escape: finish drawing, then clear the point selection, then leave.
	handleEscape() {
		const session = this.session;
		if (!session) return;
		if (session.drag) {
			this.cancelDrag();
			return;
		}
		if (session.mode === 'draw') {
			this.finishDrawing();
			return;
		}
		if (session.selection.size) {
			session.selection = new Set();
			this.refresh();
			return;
		}
		this.end({ keepTool: false });
	}

	toggleClosed() {
		const session = this.session;
		if (!session) return;
		this.cancelDrag();
		if (!this.session) return;
		const subpaths = PathGeometry.cloneSubpaths(session.host.read());
		if (session.mode === 'draw') {
			if (this.getCloseAddress(subpaths)) this.closeDrawing(subpaths);
			return;
		}
		const closed = subpaths.every((subpath) => subpath.closed);
		subpaths.forEach((subpath) => { subpath.closed = !closed && subpath.points.length > 2; });
		this.commit(subpaths, closed ? 'Open path' : 'Close path');
	}

	setSelectionType(type) {
		const session = this.session;
		if (!session?.selection.size) return;
		const subpaths = PathGeometry.cloneSubpaths(session.host.read());
		session.selection.forEach((key) => {
			const [s, p] = key.split(':').map(Number);
			if (subpaths[s]?.points[p]) PathGeometry.setPointType(subpaths[s], p, type);
		});
		this.commit(subpaths, 'Change point type');
	}

	setNextPointType(type) {
		this.nextPointType = type === 'curve' ? 'curve' : 'corner';
		this.syncToolbar();
	}

	// ===== PANEL AND CONTEXT BAR =====

	getSingleSelection(subpaths = this.read()) {
		const session = this.session;
		if (!session || session.selection.size !== 1) return null;
		const [s, p] = Array.from(session.selection)[0].split(':').map(Number);
		const point = subpaths[s]?.points[p];
		return point ? { s, p, point } : null;
	}

	// The type the selection shares, or null when it is mixed. A derived
	// (curve) point reads as Smooth.
	getSelectionType(subpaths = this.read()) {
		const session = this.session;
		if (!session?.selection.size) return null;
		const types = new Set(Array.from(session.selection).map((key) => {
			const [s, p] = key.split(':').map(Number);
			const type = subpaths[s]?.points[p]?.type;
			return type === 'auto' ? 'smooth' : type;
		}));
		return types.size === 1 ? Array.from(types)[0] : null;
	}

	bindPanel() {
		const id = (x) => document.getElementById(x);
		this.ui = {
			section: id('pathPointSection'),
			x: id('pathPointX'),
			y: id('pathPointY'),
			remove: id('pathPointDelete')
		};
		[['x', this.ui.x], ['y', this.ui.y]].forEach(([axis, input]) => {
			input?.addEventListener('change', () => {
				const value = parseFloat(input.value);
				const session = this.session;
				if (!session || Number.isNaN(value)) return;
				const subpaths = PathGeometry.cloneSubpaths(session.host.read());
				const single = this.getSingleSelection(subpaths);
				if (!single) return;
				single.point[axis] = value;
				this.commit(subpaths, 'Move points');
			});
		});
		getOptions('pathPointType').forEach(({ value }) => {
			id(`pathPointType${panelCap(value)}`)?.addEventListener('click', () => this.setSelectionType(value));
		});
		this.ui.remove?.addEventListener('click', () => this.deleteSelection());
	}

	// The Point card shows while points are selected; X and Y belong to one
	// point.
	syncPanel() {
		const session = this.session;
		const section = this.ui.section;
		if (!section) return;
		const subpaths = session ? this.read() : [];
		const count = session?.selection.size || 0;
		section.hidden = !count;
		if (!count) return;
		const single = this.getSingleSelection(subpaths);
		[['x', this.ui.x], ['y', this.ui.y]].forEach(([axis, input]) => {
			if (!input) return;
			input.disabled = !single;
			if (document.activeElement !== input) input.value = single ? String(Math.round(single.point[axis] * 100) / 100) : '';
		});
		const type = this.getSelectionType(subpaths);
		getOptions('pathPointType').forEach(({ value }) => {
			const button = document.getElementById(`pathPointType${panelCap(value)}`);
			if (!button) return;
			button.classList.toggle('active', value === type);
			button.setAttribute('aria-pressed', String(value === type));
		});
	}

	syncToolbar() {
		const session = this.session;
		const setActive = (groupId, current) => {
			document.querySelectorAll(`#${groupId} [data-value]`).forEach((button) => {
				const active = button.dataset.value === current;
				button.classList.toggle('active', active);
				button.setAttribute('aria-pressed', String(active));
			});
		};
		setActive('contextPathNextPoint', this.nextPointType);
		if (!session) return;
		const subpaths = this.read();
		const drawing = session.mode === 'draw';
		const hasSelection = session.selection.size > 0;
		const nextPoint = document.getElementById('contextPathNextPoint');
		const pointType = document.getElementById('contextPathPointType');
		// Drawing chooses what the next click places; editing sets the type of
		// the points that are selected.
		if (nextPoint) nextPoint.hidden = !drawing;
		if (pointType) pointType.hidden = drawing || !hasSelection;
		setActive('contextPathPointType', this.getSelectionType(subpaths));
		const remove = document.getElementById('contextPathDelete');
		if (remove) remove.hidden = !drawing && !hasSelection;
		const close = document.getElementById('contextPathClose');
		if (close) {
			const closed = subpaths.length > 0 && subpaths.every((subpath) => subpath.closed);
			const label = closed ? 'Open' : 'Close';
			const name = close.querySelector('.name');
			if (name) name.textContent = label;
			close.disabled = drawing ? !this.getCloseAddress(subpaths) : !closed && !subpaths.some((subpath) => subpath.points.length > 2);
		}
	}
}
