'use strict';

class TimelineKeyRecording {
	constructor(dock) {
		this.dock = dock; this.editor = dock.editor; this.panel = this.editor.animationPanel;
		this.editor.timelineKeyRecording = this;
		this.blockedPointers = new Set();
		this.clickPointers = new Set();
		this.pointerDrag = bindPointerDrag(null, {
			bindPress: false, threshold: dock.config.dragThresholdPx, capture: () => this.drag.handle,
			move: event => this.move(event), end: cancelled => this.finish(cancelled), suppress: () => this.suppressClick()
		});
		this.sessionEvents = [];
		const listen = (target, type, listener, capture = false) => this.sessionEvents.push({ target, type, listener, capture });
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(window, type, event => {
			if (type === 'pointerup' && this.clickPointers.delete(event.pointerId)) this.suppressClick();
			if (type !== 'lostpointercapture') this.blockedPointers.delete(event.pointerId);
		});
		listen(window, 'blur', () => {
			this.finish(true);
			this.blockedPointers.clear(); this.clickPointers.clear();
		});
		window.addEventListener('resize', () => this.validate());
		listen(document, 'keydown', event => {
			if (!this.active || event.key !== 'Escape' || this.editor.modalManager.isAnyOpen() || focusKeyClaim().typing) return;
			event.preventDefault(); event.stopImmediatePropagation();
			if (this.drag) this.finish(true); else this.end();
		}, true);
		listen(document, 'pointerdown', event => {
			this.clickPointers.delete(event.pointerId);
			if (this.blockedPointers.size && event.pointerType === 'touch') { this.blockedPointers.add(event.pointerId); this.consume(event); return; }
			if (this.drag && event.pointerId !== this.drag.pointerId) {
				if (event.pointerType === 'touch') { this.blockedPointers.add(this.drag.pointerId); this.blockedPointers.add(event.pointerId); this.consume(event); }
				this.finish(true);
			}
		}, true);
		for (const type of ['input', 'change']) listen(document, type, event => {
			if (!this.active) return;
			if (this.drag) this.finish(true);
			if (!this.panel.ownsKeyControl(this.layer, event.target)) this.end();
		}, true);
		this.modalObserver = new MutationObserver(() => { if (this.active && this.editor.modalManager.isAnyOpen()) this.end(); });
		this.modalObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
	}

	get active() { return Boolean(this.entry); }
	handles(layer) { return this.active && layer === this.layer && this.editor.currentTool === ToolType.SELECT; }
	canBegin(layer, entry) {
		return this.dock.available && this.panel.canEditKeys(layer, entry) && !layer.isPreview
			&& Boolean(this.editor.getMovableLayerContext(layer)) && !this.editor.layerManager.hasMultiSelection();
	}
	validate() {
		if (!this.active) return false;
		if (!this.canBegin(this.layer, this.entry) || this.editor.layerManager.getActiveLayer() !== this.layer
			|| this.panel.selectedMotion(this.layer) !== this.entry || JSON.stringify(this.layer.transform) !== this.restToken
			|| JSON.stringify(this.transform.getFrame()) !== this.frameToken
			|| (this.editor.currentTool !== ToolType.SELECT && !this.editor.temporaryHandToolActive)) { this.end(); return false; }
		return true;
	}
	begin(layer, entry) {
		if (!this.canBegin(layer, entry)) return;
		this.end();
		if (this.editor.currentTool !== ToolType.SELECT) this.editor.setTool(ToolType.SELECT);
		const context = this.editor.getMovableLayerContext(layer);
		this.layer = layer; this.entry = entry; this.transform = context.manager.layerTransforms.get(layer.id);
		this.unsubscribeSeek = this.editor.animationTicker.subscribeSeek(() => { if (this.drag) this.finish(true); });
		this.dock.syncClock();
		for (const { target, type, listener, capture } of this.sessionEvents) target.addEventListener(type, listener, capture);
		this.periodMs = this.panel.keyPeriod(layer, entry);
		this.restToken = JSON.stringify(layer.transform); this.frameToken = JSON.stringify(this.transform.getFrame());
		this.disabledControls = new Map();
		this.dock.frameView.invalidate({ keepFrame: true }); this.dock.frameView.seek();
		this.editor.animationPanel.setPaused(true);
		this.editor.previewContainer.classList.remove('alt-duplicate-armed');
		this.syncControls();
		this.transform.createTransformHandles();
		this.refresh();
		this.dock.syncKeys();
	}
	end() {
		if (!this.active || this.ending) return;
		this.ending = true;
		this.finish(true);
		const layer = this.layer, transform = this.transform;
		this.entry = null; this.layer = null;
		this.unsubscribeSeek?.(); this.unsubscribeSeek = null;
		this.dock.syncClock();
		for (const { target, type, listener, capture } of this.sessionEvents) target.removeEventListener(type, listener, capture);
		this.blockedPointers.clear(); this.clickPointers.clear();
		for (const [control, disabled] of this.disabledControls || []) if (control.isConnected) control.disabled = disabled;
		this.disabledControls = null;
		this.note?.remove(); this.note = null;
		if (this.editor.notifications.mode === this.mode) this.editor.notifications.setMode(null);
		this.dock.frameView.invalidate({ keepFrame: this.dock.available });
		if (!this.dock.available && this.editor.animationTicker.paused) this.editor.animationTicker.setPaused(true);
		transform?.createTransformHandles();
		if (this.editor.layers.includes(layer)) this.panel.load(layer);
		this.dock.syncKeys();
		this.editor.requestPreviewUpdate();
		// The held frame still shows the isolated motion; recompose it with the full stack.
		this.editor.animationTicker.refresh();
		this.ending = false;
	}
	selectionWillChange(ids, activeId) { if (this.active && (ids.length !== 1 || activeId !== this.layer.id)) this.end(); }
	previewAnimations(layer) { return this.active && layer === this.layer ? [{ ...this.entry, periodMs: this.periodMs }] : null; }
	previewLayers(layers) {
		return layers.map(layer => {
			const animations = this.previewAnimations(layer);
			return animations ? { ...layer, animations } : layer;
		});
	}
	pose() {
		return GlitterAnimation.sampleAt(this.previewAnimations(this.layer)[0],
			this.editor.animationTicker.getPlayheadTime(), getLayerAnimationSamplingContext(this.editor, this.layer));
	}
	position() {
		return GlitterAnimation.cycleProgress({ ...this.entry, periodMs: this.periodMs },
			this.editor.animationTicker.getPlayheadTime(), { fill: false });
	}

	syncControls() {
		if (!this.active) return;
		const controls = this.panel.transformControls(this.layer);
		for (const node of controls.filter(Boolean)) for (const control of node.querySelectorAll('button, input, select')) {
			if (!this.disabledControls.has(control)) this.disabledControls.set(control, control.disabled);
			control.disabled = true;
		}
		const host = controls[0];
		if (host && !this.note?.isConnected) {
			this.note = buildPanelItem({ kind: 'note', text: 'Done exits key recording and enables the rest transform.' });
			host.append(this.note);
		}
	}
	refresh() {
		if (!this.validate()) return;
		this.syncControls();
		this.paint();
	}
	paint(time) {
		if (!this.active) return;
		if (time != null && time === this.paintedTime && this.entry.keys === this.paintedKeys) return;
		this.paintedTime = time; this.paintedKeys = this.entry.keys;
		const progress = this.position(), percent = progress ? Number((((progress.eased % 1 + 1) % 1) * 100).toFixed(1)) : null;
		const badge = `${this.layer.name} · ${percent == null ? 'Outside run' : `${percent}%`}`;
		if (this.mode?.badge !== badge) {
			this.mode = { label: 'Recording keys', icon: 'timeline', badge, exitLabel: 'Done', onExit: () => this.end() };
			this.editor.notifications.setMode(this.mode);
		}
		this.transform.updateHandlePositions();
	}
	chromeModel(transform) {
		if (!this.handles(transform.layer)) return null;
		const geometry = PoseGeometry.frame(this.editor, transform, this.pose());
		if (!geometry) return null;
		const disabled = !this.drag && (geometry.singular || !this.position());
		return { frame: geometry.frame, disabled, keepHandles: Boolean(this.drag), badge: { text: 'Recording keys', mode: 'keys' } };
	}
	filterHandles(layer, handles) {
		return this.handles(layer)
			? handles.filter(handle => !['anchor', 'text-mode'].includes(handle) && !handle.startsWith('radius-')) : handles;
	}
	consume(event) { event.preventDefault(); event.stopImmediatePropagation(); event.stopPropagation(); }
	suppressClick() {
		this.editor.ignoreNextClick = true;
		setTimeout(() => { this.editor.ignoreNextClick = false; }, 0);
	}
	routeTouch(event) {
		if (!this.active || this.editor.currentTool !== ToolType.SELECT) return false;
		const type = this.transform.chrome?.hitTest(event.clientX, event.clientY, 'touch');
		if (!type) return false;
		this.beginDrag(this.transform, type, event, event.target.closest('[data-handle-type]') || this.transform.chrome.box);
		return true;
	}
	beginDrag(transform, handleType, event, handle) {
		this.consume(event);
		this.clickPointers.add(event.pointerId);
		if (!this.validate() || this.drag || !this.position()) return;
		if (!['move', 'rotation'].includes(handleType) && !handleType.startsWith('rotate-')
			&& !handleType.startsWith('corner-') && !handleType.startsWith('edge-')) return;
		const sample = this.pose(), geometry = PoseGeometry.frame(this.editor, transform, sample);
		if (!geometry || geometry.singular || !geometry.inverseParent) {
			this.editor.updateStatus('This pose has no invertible scale. Edit its key values first.'); return;
		}
		const keys = GlitterAnimation.normalizeKeys(this.entry.keys), at = (this.position().eased % 1 + 1) % 1;
		if (keys.length >= CONFIG.tools.animation.maxKeys
			&& !keys.some(key => Math.min(Math.abs(key.at - at), 1 - Math.abs(key.at - at)) < CONFIG.ui.timeline.keyPositionTolerance)) {
			this.editor.updateStatus(`Maximum of ${CONFIG.tools.animation.maxKeys} motion keys`); return;
		}
		const point = this.editor.viewport.screenToCanvas(event.clientX, event.clientY);
		this.drag = { transform, handleType: handleType.startsWith('rotate-') ? 'rotation' : handleType, handle, pointerId: event.pointerId,
			x: event.clientX, y: event.clientY, point, sample, geometry, keys, at,
			time: this.editor.animationTicker.getPlayheadTime(), zoom: this.editor.viewport.currentZoom, moved: false };
		this.pointerDrag.begin(event);
	}
	write(values, { commit = false, coalesceKey } = {}) {
		const drag = this.drag, position = drag ? { eased: drag.at } : this.position();
		if (!position) return false;
		const at = (position.eased % 1 + 1) % 1, keys = GlitterAnimation.normalizeKeys(drag?.keys || this.entry.keys);
		let key = keys.find(key => Math.min(Math.abs(key.at - at), 1 - Math.abs(key.at - at)) < CONFIG.ui.timeline.keyPositionTolerance);
		if (!key) { key = { at, easing: 'linear', values: {} }; keys.push(key); }
		Object.assign(key.values, values);
		return this.panel.setKeys(this.layer, this.entry, keys, { commit, at: key.at, label: 'Record motion key', coalesceKey });
	}
	move(event) {
		const drag = this.drag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!this.validate() || this.editor.viewport.currentZoom !== drag.zoom) { this.finish(true); return; }
		if (!drag.moved) {
			drag.transform.isDraggingHandle = true;
			drag.transform.dragStartState = { transform: structuredClone(this.layer.transform) };
		}
		drag.moved = true;
		this.editor.animationTicker.heldMs = drag.time;
		const point = this.editor.viewport.screenToCanvas(event.clientX, event.clientY), { geometry, sample } = drag;
		const startPoint = PoseGeometry.point(geometry.inverseParent, drag.point), nextPoint = PoseGeometry.point(geometry.inverseParent, point);
		let values;
		if (drag.handleType === 'move') {
			let delta = { x: nextPoint.x - startPoint.x, y: nextPoint.y - startPoint.y };
			if (event.shiftKey) { if (Math.abs(delta.x) > Math.abs(delta.y)) delta.y = 0; else delta.x = 0; }
			const bounds = {
				minX: Math.min(...geometry.corners.map(p => p.x)), maxX: Math.max(...geometry.corners.map(p => p.x)),
				minY: Math.min(...geometry.corners.map(p => p.y)), maxY: Math.max(...geometry.corners.map(p => p.y))
			};
			const worldDelta = PoseGeometry.vector(geometry.parent, delta), current = { x: geometry.frame.centerX, y: geometry.frame.centerY };
			const snapped = this.editor.snapTransformPosition(
				{ layer: this.layer, getFrameMetrics: () => bounds, getTransform: () => ({ position: current }) },
				{ x: current.x + worldDelta.x, y: current.y + worldDelta.y }, { ctrlKey: event.ctrlKey || event.metaKey }
			);
			delta = PoseGeometry.vector(geometry.inverseParent, { x: snapped.x - current.x, y: snapped.y - current.y });
			values = { tx: sample.tx + delta.x, ty: sample.ty + delta.y };
		} else if (drag.handleType === 'rotation') {
			const pivot = { x: geometry.origin.x + sample.tx, y: geometry.origin.y + sample.ty };
			const local = p => PoseGeometry.vector(geometry.inverseBasis, { x: p.x - pivot.x, y: p.y - pivot.y });
			const angle = sample.rotate + rotationDeltaDeg({ x: 0, y: 0 }, local(startPoint), local(nextPoint));
			values = { rotate: snapRotationDeg(angle, event.shiftKey) };
		} else values = this.scaleValues(drag, nextPoint, startPoint, event);
		if (values && Object.entries(values).some(([id, value]) => Math.abs(value - sample[id]) > CONFIG.ui.timeline.keySingularTolerance)) this.write(values);
		else this.panel.setKeys(this.layer, this.entry, drag.keys, { commit: false, rollback: true, at: drag.at });
		this.dock.frameView.invalidate({ keepFrame: true }); this.dock.frameView.seek();
		this.editor.requestPreviewUpdate(); this.paint();
	}
	scaleValues(drag, point, grab, event) {
		const { geometry, sample, handleType } = drag;
		const indices = { 'corner-tl': [0, 2], 'corner-tr': [1, 3], 'corner-br': [2, 0], 'corner-bl': [3, 1] };
		const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
		const pairs = { 'edge-top': [midpoint(geometry.rest.corners[0], geometry.rest.corners[1]), midpoint(geometry.rest.corners[2], geometry.rest.corners[3])],
			'edge-bottom': [midpoint(geometry.rest.corners[2], geometry.rest.corners[3]), midpoint(geometry.rest.corners[0], geometry.rest.corners[1])],
			'edge-left': [midpoint(geometry.rest.corners[0], geometry.rest.corners[3]), midpoint(geometry.rest.corners[1], geometry.rest.corners[2])],
			'edge-right': [midpoint(geometry.rest.corners[1], geometry.rest.corners[2]), midpoint(geometry.rest.corners[0], geometry.rest.corners[3])] };
		let [restHandle, restFixed] = indices[handleType] ? indices[handleType].map(index => geometry.rest.corners[index]) : pairs[handleType];
		if (event.altKey) restFixed = { x: geometry.rest.centerX, y: geometry.rest.centerY };
		const fixed = PoseGeometry.point(geometry.matrix, restFixed), startHandle = PoseGeometry.point(geometry.matrix, restHandle);
		const desired = anchoredHandlePoint(startHandle, grab, point);
		const rotate = GlitterAnimation.sampleMatrix({ ...sample, tx: 0, ty: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 });
		const inverse = PoseGeometry.inverse(GlitterAnimation.multiplyMatrices(geometry.basis, rotate));
		const restVector = PoseGeometry.vector(geometry.inverseBasis, { x: restHandle.x - restFixed.x, y: restHandle.y - restFixed.y });
		const skew = GlitterAnimation.sampleMatrix({ ...sample, tx: 0, ty: 0, rotate: 0, scaleX: 1, scaleY: 1 });
		const vector = PoseGeometry.vector(skew, restVector), wanted = PoseGeometry.vector(inverse, { x: desired.x - fixed.x, y: desired.y - fixed.y });
		const horizontal = handleType.startsWith('corner-') || handleType === 'edge-left' || handleType === 'edge-right';
		const vertical = handleType.startsWith('corner-') || handleType === 'edge-top' || handleType === 'edge-bottom';
		let sx = horizontal && Math.abs(vector.x) > CONFIG.ui.timeline.keySingularTolerance ? wanted.x / vector.x : sample.scaleX;
		let sy = vertical && Math.abs(vector.y) > CONFIG.ui.timeline.keySingularTolerance ? wanted.y / vector.y : sample.scaleY;
		if (resolveAspectLock(this.layer.transform, event)) {
			const initial = { x: sample.scaleX * vector.x, y: sample.scaleY * vector.y };
			const factor = horizontal && vertical
				? (wanted.x * initial.x + wanted.y * initial.y) / (initial.x ** 2 + initial.y ** 2)
				: horizontal ? sx / sample.scaleX : sy / sample.scaleY;
			sx = sample.scaleX * factor; sy = sample.scaleY * factor;
		}
		const field = FIELDS.animKeyScale;
		sx = clampNumber(sx, field.min / 100, field.max / 100); sy = clampNumber(sy, field.min / 100, field.max / 100);
		const next = PoseGeometry.world(this.editor, this.layer, { ...sample, scaleX: sx, scaleY: sy, tx: 0, ty: 0 });
		const moved = PoseGeometry.point(next.matrix, restFixed);
		return { scaleX: sx, scaleY: sy, tx: fixed.x - moved.x, ty: fixed.y - moved.y };
	}
	finish(cancel) {
		if (this.pointerDrag.active) { this.pointerDrag.finish(cancel); return; }
		const drag = this.drag;
		if (!drag) return;
		this.drag = null;
		drag.transform.isDraggingHandle = false; drag.transform.dragStartState = null;
		if (drag.moved) {
			if (cancel) this.panel.setKeys(this.layer, this.entry, drag.keys, { commit: false, rollback: true, at: drag.at });
			else if (JSON.stringify(drag.keys) !== JSON.stringify(GlitterAnimation.normalizeKeys(this.entry.keys))) this.editor.saveState('Record motion key');
		}
		this.editor.clearSmartGuides();
		this.refresh();
	}
	nudge(event) {
		if (!this.validate() || !this.position() || this.drag) return;
		const amount = event.shiftKey ? CONFIG.ui.nudge.fastStep : CONFIG.ui.nudge.step, sample = this.pose();
		const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
		if (!direction) return;
		event.preventDefault();
		this.write({ tx: sample.tx + direction[0] * amount, ty: sample.ty + direction[1] * amount }, {
			commit: true, coalesceKey: this.editor.historyManager.burstCoalesceKey('record-key-nudge')
		});
		this.refresh();
	}
}
