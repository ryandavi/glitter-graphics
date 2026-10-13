'use strict';

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
			const heading = this.dock.element('timeline-key-heading');
			this.heading = this.dock.element('', 'One cycle · 0% to 100%', 'span'); heading.append(this.heading);
			const record = this.dock.button('btn-flat', 'Edit keys on the canvas', null, () => {
				const recording = this.dock.keyRecording;
				if (recording.active) recording.end(); else recording.begin(this.layer, this.entry);
			});
			this.record = record; heading.append(record);
			const add = this.dock.button('btn-flat', 'Add a key at the playhead', 'plus', () => this.panel.addKey(this.layer, this.entry));
			add.append(document.createTextNode('Add key')); heading.append(add);
			this.track = this.dock.element('timeline-key-track');
			this.track.setAttribute('role', 'group'); this.track.setAttribute('aria-label', 'Motion keys inside one cycle');
			this.track.addEventListener('pointerdown', event => this.begin(event));
			this.marker = this.dock.element('timeline-key-playhead');
			this.note = this.dock.element('property-note', 'Editing this motion; Done previews all animations.');
			this.host.replaceChildren(heading, this.track, this.note);
			this.add = add;
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
			button.style.left = `${TimelineView.keyToX(key.at, 100, 1)}%`;
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
		const zero = keys.find(key => key.at === 0);
		const ghost = this.dock.element('timeline-key is-ghost', undefined, 'span');
		ghost.style.left = '100%'; ghost.hidden = !zero; ghost.title = '100% repeats the key at 0%';
		this.track.replaceChildren(this.marker, ...this.buttons, ghost);
		if (focused) this.focusSelected();
		this.paint(this.dock.editor.animationTicker.getPlayheadTime());
	}

	focusSelected() { this.buttons?.[this.panel.keyIndex(this.entry)]?.focus({ preventScroll: true }); }

	paint(time) {
		if (!this.host?.isConnected || this.host.hidden) return;
		const recording = this.dock.keyRecording, active = recording?.active && recording.entry === this.entry;
		this.record.textContent = active ? 'Done' : 'Edit keys'; this.record.disabled = !active && !recording?.canBegin(this.layer, this.entry);
		this.heading.textContent = active ? 'Recording keys · one cycle' : 'One cycle · 0% to 100%'; this.note.hidden = !active;
		const progress = GlitterAnimation.cycleProgress({ ...this.entry, periodMs: this.row.exportCycleMs }, time, { fill: false });
		this.marker.hidden = !progress;
		if (progress) this.marker.style.left = `${TimelineView.keyToX(((progress.eased % 1) + 1) % 1, 100, 1)}%`;
		this.add.disabled = !this.editable || !progress || this.dock.host.classList.contains('is-stale');
		const prefix = this.panel.prefixByType.get(this.layer?.type);
		const add = prefix && this.panel._id(prefix, 'KeyAdd');
		if (add) add.disabled = this.add.disabled;
	}

	begin(event) {
		const button = event.target.closest('[data-key-at]');
		if (event.button !== 0 || !button || !this.editable || this.dock.host.classList.contains('is-stale') || this.drag) return;
		event.preventDefault(); event.stopPropagation();
		const box = this.track.getBoundingClientRect();
		const keys = GlitterAnimation.normalizeKeys(this.entry.keys);
		const at = Number(button.dataset.keyAt);
		this.drag = { pointerId: event.pointerId, x: event.clientX, box, keys, at, layer: this.layer, entry: this.entry, button, track: this.track, moved: false };
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
		let at = TimelineView.xToKey(event.clientX - drag.box.left, drag.box.width, 1);
		if (PREFERENCES.get('timelineSnap') && !event.altKey) {
			const targets = [0, 1, ...drag.keys.filter(key => key.at !== drag.at).map(key => key.at)];
			at = TimelineView.snapTime(at, targets.map(ms => ({ ms })), CONFIG.ui.timeline.snapPx / drag.box.width).ms;
		}
		const next = this.panel.retimeKey(drag.layer, drag.entry, this.panel.keyIndex(drag.entry), at, { commit: false });
		if (next == null) return;
		drag.button.dataset.keyAt = next;
		drag.button.style.left = `${TimelineView.keyToX(next, 100, 1)}%`;
	}

	finish(cancel) {
		const drag = this.drag;
		if (!drag) return;
		this.drag = null;
		if (drag.track.hasPointerCapture(drag.pointerId)) drag.track.releasePointerCapture(drag.pointerId);
		if (!drag.moved) return;
		if (drag.moved) {
			this.suppressClick = true;
			setTimeout(() => { this.suppressClick = false; }, 0);
			if (cancel) this.panel.setKeys(drag.layer, drag.entry, drag.keys, { commit: false, rollback: true, at: drag.at });
			else if (JSON.stringify(drag.keys) !== JSON.stringify(GlitterAnimation.normalizeKeys(drag.entry.keys))) this.dock.editor.saveState('Retime motion key');
		}
		this.refresh();
	}
}
