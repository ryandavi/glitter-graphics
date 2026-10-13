'use strict';

// The selected Custom bar's keys, as a row under it: one cycle of the bar
// opened up on the dock's own ruler. A key sits at the time the motion reaches
// it in that cycle, so the dock's playhead crosses the lane where the pose is.
class TimelineKeyLane {
	constructor(dock) {
		this.dock = dock;
		this.panel = dock.editor.animationPanel;
		window.addEventListener('pointermove', event => this.move(event));
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) window.addEventListener(type, event => {
			if (event.pointerId === this.drag?.pointerId) this.finish(type !== 'pointerup');
		});
		window.addEventListener('blur', () => this.finish(true));
		window.addEventListener('resize', () => { if (!this.dock.available) this.finish(true); });
		document.addEventListener('keydown', event => {
			if (event.key !== 'Escape' || !this.drag) return;
			event.preventDefault(); event.stopImmediatePropagation(); this.finish(true);
		}, true);
	}

	get layer() { return this.dock.editor.layerManager.getLayerById(this.row?.layerId); }
	get entry() { return this.row?.source.keyTrack?.entry; }
	get editable() { return this.dock.available && this.panel.canEditKeys(this.layer, this.entry); }

	mount(row, host) {
		if (this.drag && (row.source.keyTrack.entry !== this.entry || host !== this.host)) this.finish(true);
		this.row = row;
		if (host !== this.host) {
			this.host = host;
			const action = 'btn-icon-simple icon-wrapper sm';
			const label = this.dock.element('timeline-key-label');
			this.record = this.dock.button(action, '', 'hand-pointer', () => {
				const recording = this.dock.keyRecording;
				if (recording.active) recording.end(); else recording.begin(this.layer, this.entry);
			});
			this.add = this.dock.button(action, 'Add a key at the playhead', 'plus', () => this.panel.addKey(this.layer, this.entry));
			label.append(this.dock.element('timeline-key-name', 'Keys', 'span'), this.record, this.add);
			const cell = this.dock.element('timeline-track timeline-key-cell');
			// The cycle the keys are drawn in.
			this.track = this.dock.element('timeline-key-track');
			this.track.setAttribute('role', 'group'); this.track.setAttribute('aria-label', 'Motion keys inside one cycle');
			this.track.addEventListener('pointerdown', event => this.begin(event));
			cell.appendChild(this.track);
			this.cell = cell;
			this.host.replaceChildren(label, cell);
		}
		this.refresh();
	}

	refresh() {
		if (!this.host?.isConnected || this.drag) return;
		const keys = GlitterAnimation.normalizeKeys(this.entry.keys);
		const focused = Boolean(document.activeElement?.closest('.timeline-key-track'));
		const selected = this.panel.keyIndex(this.entry);
		this.buttons = keys.map((key, index) => {
			const label = `Key at ${Number((key.at * 100).toFixed(1))}%, ${key.easing} outgoing easing`;
			const button = this.dock.button('timeline-key btn-icon-simple', label, null, () => {
				if (!this.suppressClick) this.panel.selectKey(this.layer, this.entry, key.at, { seek: true });
			});
			button.dataset.keyAt = key.at;
			button.classList.toggle('active', index === selected);
			button.setAttribute('aria-pressed', String(index === selected));
			button.disabled = !this.editable;
			button.addEventListener('keydown', event => {
				if (!this.editable || event.ctrlKey || event.metaKey || event.altKey) return;
				if (!['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
				event.preventDefault(); event.stopPropagation();
				if (this.drag) return;
				this.panel.selectedKeys.set(this.entry, Number(button.dataset.keyAt));
				const current = this.panel.keyIndex(this.entry);
				if (event.key === 'Delete' || event.key === 'Backspace') this.panel.deleteKey(this.layer, this.entry, current);
				else {
					const step = event.shiftKey ? CONFIG.ui.timeline.keyFastNudgeStep : CONFIG.ui.timeline.keyNudgeStep;
					const coalesceKey = this.dock.editor.historyManager.burstCoalesceKey(`motion-key-nudge:${this.row.layerId}`);
					this.panel.retimeKey(this.layer, this.entry, current, Number(button.dataset.keyAt) + (event.key === 'ArrowRight' ? step : -step), { coalesceKey });
				}
			});
			return button;
		});
		this.ghost = this.dock.element('timeline-key is-ghost', undefined, 'span');
		this.ghost.hidden = !keys.some(key => key.at === 0); this.ghost.title = '100% repeats the key at 0%';
		this.track.replaceChildren(...this.buttons, this.ghost);
		this.cycle = null;
		if (focused) this.focusSelected();
		this.paint(this.dock.editor.animationTicker.getPlayheadTime());
	}

	focusSelected() { this.buttons?.[this.panel.keyIndex(this.entry)]?.focus({ preventScroll: true }); }

	// Where one key is drawn, from the start of the lane's cycle.
	place(node, at) {
		const { scale } = this.dock;
		const time = TimelineView.keyToTime(this.row, this.entry, at, this.cycle);
		node.style.left = `${TimelineView.timeToX(time.ms - TimelineView.cycleSpan(this.row, this.cycle).start, scale)}px`;
		node.classList.toggle('is-untimed', time.untimed);
		return time.ms;
	}

	layout() {
		const { scale } = this.dock;
		const span = TimelineView.cycleSpan(this.row, this.cycle);
		this.track.style.left = `${TimelineView.timeToX(span.start, scale)}px`;
		this.track.style.width = `${TimelineView.timeToX(span.end - span.start, scale)}px`;
		for (const button of this.buttons) this.place(button, Number(button.dataset.keyAt));
		// 100% is where the cycle ends: its right edge, or its left when reversed.
		this.ghost.style.left = `${TimelineView.timeToX(TimelineView.cycleToTime(TimelineView.keyDrawing(this.row), this.cycle, 1) - span.start, scale)}px`;
	}

	paint(time) {
		if (!this.host?.isConnected || this.host.hidden) return;
		const recording = this.dock.keyRecording, active = Boolean(recording?.active && recording.entry === this.entry);
		const title = active ? 'Done editing keys on the canvas' : 'Edit keys on the canvas';
		this.record.title = title; this.record.setAttribute('aria-label', title);
		this.record.classList.toggle('active', active); this.record.setAttribute('aria-pressed', String(active));
		this.record.disabled = !active && !recording?.canBegin(this.layer, this.entry);
		// The lane follows the playhead from cycle to cycle, and holds during a drag.
		const cycle = this.drag ? this.cycle : TimelineView.keyCycle(this.row, time);
		const layout = `${cycle}|${this.dock.scale}|${this.row.startMs}|${this.row.phase}|${this.row.exportCycleMs}|${this.entry.easing}|${this.entry.direction}`;
		if (layout !== this.laidOut || this.cycle == null) { this.cycle = cycle; this.laidOut = layout; this.layout(); }
		const progress = GlitterAnimation.cycleProgress(TimelineView.keyEntry(this.row, this.entry), time, { fill: false });
		this.add.disabled = !this.editable || !progress || this.dock.host.classList.contains('is-stale');
		const prefix = this.panel.prefixByType.get(this.layer?.type);
		const add = prefix && this.panel._id(prefix, 'KeyAdd');
		if (add) add.disabled = this.add.disabled;
	}

	begin(event) {
		const button = event.target.closest('[data-key-at]');
		if (event.button !== 0 || !button || !this.editable || this.dock.host.classList.contains('is-stale') || this.drag) return;
		event.preventDefault(); event.stopPropagation();
		const keys = GlitterAnimation.normalizeKeys(this.entry.keys);
		const at = Number(button.dataset.keyAt);
		this.drag = { pointerId: event.pointerId, x: event.clientX, left: this.cell.getBoundingClientRect().left, keys, at, layer: this.layer, entry: this.entry, button, track: this.track, moved: false };
		this.panel.selectKey(this.layer, this.entry, at);
		for (const item of this.buttons) {
			const selected = item === button;
			item.classList.toggle('active', selected); item.setAttribute('aria-pressed', String(selected));
		}
		button.focus({ preventScroll: true });
	}

	move(event) {
		const drag = this.drag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!this.editable) { this.finish(true); return; }
		if (!drag.moved && Math.abs(event.clientX - drag.x) < CONFIG.ui.timeline.dragThresholdPx) return;
		if (!drag.moved) drag.track.setPointerCapture(event.pointerId);
		drag.moved = true;
		const { scale, editor } = this.dock;
		const span = TimelineView.cycleSpan(this.row, this.cycle);
		let ms = TimelineView.xToTime(event.clientX - drag.left, scale), target = null;
		if (PREFERENCES.get('timelineSnap') && !event.altKey) {
			const targets = [
				{ ms: editor.animationTicker.getPlayheadTime(), kind: 'playhead' }, { ms: span.start, kind: 'cycle' }, { ms: span.end, kind: 'cycle' },
				...drag.keys.filter(key => key.at !== drag.at).map(key => ({ ms: TimelineView.keyToTime(this.row, drag.entry, key.at, this.cycle).ms, kind: 'key' }))
			].filter(entry => entry.ms >= span.start && entry.ms <= span.end);
			({ ms, target } = TimelineView.snapTime(ms, targets, TimelineView.xToTime(CONFIG.ui.timeline.snapPx, scale)));
		}
		const wanted = TimelineView.timeToKey(this.row, drag.entry, ms, this.cycle);
		const next = this.panel.retimeKey(drag.layer, drag.entry, this.panel.keyIndex(drag.entry), wanted, { commit: false });
		if (next == null) return;
		// Another key in the way moves this one off the snap.
		if (Math.abs(next - wanted) > 1e-9) target = null;
		drag.button.dataset.keyAt = next;
		const time = this.place(drag.button, next);
		this.dock.paintDragFeedback(TimelineView.dragReadout('key', this.row, next, drag.at, target), time, this.host, target ? target.ms : null);
	}

	finish(cancel) {
		const drag = this.drag;
		if (!drag) return;
		this.drag = null;
		this.dock.clearDragFeedback();
		if (drag.track.hasPointerCapture(drag.pointerId)) drag.track.releasePointerCapture(drag.pointerId);
		if (!drag.moved) return;
		this.suppressClick = true;
		setTimeout(() => { this.suppressClick = false; }, 0);
		if (cancel) this.panel.setKeys(drag.layer, drag.entry, drag.keys, { commit: false, rollback: true, at: drag.at });
		else if (JSON.stringify(drag.keys) !== JSON.stringify(GlitterAnimation.normalizeKeys(drag.entry.keys))) this.dock.editor.saveState('Retime motion key');
		this.refresh();
	}
}
