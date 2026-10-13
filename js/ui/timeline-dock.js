'use strict';

class TimelineDock {
	constructor(editor, host) {
		this.editor = editor;
		this.host = host;
		this.config = CONFIG.ui.timeline;
		this.selectedKey = null;
		for (const [key, value] of Object.entries({
			'row-height': this.config.rowHeight, 'group-height': this.config.groupHeight,
			'label-width': this.config.labelWidth, 'info-width': this.config.infoWidth
		})) host.style.setProperty(`--timeline-${key}`, `${value}px`);
		this.resizeHandle = this.element('timeline-resize-handle');
		this.resizeHandle.tabIndex = 0;
		this.resizeHandle.setAttribute('role', 'separator');
		this.resizeHandle.setAttribute('aria-orientation', 'horizontal');
		this.resizeHandle.setAttribute('aria-label', 'Resize timeline');
		this.header = this.element('timeline-header');
		const title = this.element('timeline-title', 'Timeline');
		this.readout = this.element('timeline-readout');
		this.readout.setAttribute('aria-live', 'polite');
		const actions = this.element('timeline-actions');
		this.fit = this.button('btn-icon icon-wrapper', 'Fit animations to loop', 'magic-wand', () => {
			if (!host.classList.contains('is-stale')) editor.fitAnimationsToLoop();
		});
		actions.append(this.fit,
			this.button('btn-icon icon-wrapper', 'Zoom timeline out', 'minus', () => this.stepZoom(-1)),
			this.button('btn-icon icon-wrapper', 'Zoom timeline in', 'plus', () => this.stepZoom(1)),
			this.button('btn-icon icon-wrapper', 'Close timeline', 'x-mark', () => editor.toggleTimeline()));
		this.header.append(title, this.readout, actions);
		this.body = this.element('timeline-body');
		host.replaceChildren(this.resizeHandle, this.header, this.body);
		this.bindResize();
		this.body.addEventListener('wheel', event => {
			if ((!event.ctrlKey && !event.metaKey) || !this.available || !this.model?.loopMs) return;
			if (!event.target.closest('.timeline-track, .timeline-ruler')) return;
			event.preventDefault();
			const track = this.body.querySelector('.timeline-track');
			const x = event.clientX - track.getBoundingClientRect().left;
			this.stepZoom(event.deltaY < 0 ? 1 : -1, x);
		}, { passive: false });
		this.observer = new ResizeObserver(() => {
			if (!this.available) return;
			if (!this.resizing) this.applyHeight(PREFERENCES.get('timelineHeight'));
			if (editor.loopEstimate) this.sync(editor.loopEstimate);
			else this.markStale();
		});
		this.observer.observe(host);
		window.addEventListener('layerChanged', () => {
			if (this.available) this.syncSelection();
		});
	}

	element(className, text) {
		const node = document.createElement('div');
		node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	button(className, label, icon, run) {
		const button = document.createElement('button');
		button.type = 'button'; button.className = className;
		button.title = label; button.setAttribute('aria-label', label);
		if (icon) button.appendChild(createIcon(icon));
		button.addEventListener('click', event => { if (this.available) run(event); });
		return button;
	}

	get isOpen() { return !this.host.hidden; }
	get available() { return this.isOpen && isFeatureAvailable('timeline'); }

	open() {
		if (!isFeatureAvailable('timeline')) return;
		const changed = !this.isOpen;
		this.host.hidden = false;
		this.applyHeight(PREFERENCES.get('timelineHeight'));
		this.sync(this.editor.loopEstimate);
		if (changed) this.editor.viewport.handleWindowResize();
	}

	close() {
		if (!this.isOpen) return;
		this.host.hidden = true;
		this.editor.viewport.handleWindowResize();
	}

	applyHeight(value) {
		const max = Math.max(this.config.minHeight, this.host.parentElement.clientHeight * this.config.maxHeightFraction);
		const height = Math.round(Math.max(this.config.minHeight, Math.min(max, value)));
		this.host.style.setProperty('--timeline-height', `${height}px`);
		this.resizeHandle.setAttribute('aria-valuemin', String(this.config.minHeight));
		this.resizeHandle.setAttribute('aria-valuemax', String(Math.round(max)));
		this.resizeHandle.setAttribute('aria-valuenow', String(height));
		return height;
	}

	bindResize() {
		const handle = this.resizeHandle;
		handle.addEventListener('pointerdown', event => {
			if (!this.available || event.button !== 0) return;
			event.preventDefault();
			const start = this.host.getBoundingClientRect().height;
			const startY = event.clientY;
			this.resizing = true;
			handle.setPointerCapture(event.pointerId);
			handle.classList.add('is-dragging');
			const move = next => {
				if (next.pointerId !== event.pointerId || !this.available) return;
				this.applyHeight(start + startY - next.clientY);
				this.editor.viewport.handleWindowResize();
			};
			const finish = (cancel = false) => {
				if (!this.resizing) return;
				this.resizing = false;
				if (cancel) this.applyHeight(start);
				else PREFERENCES.set('timelineHeight', this.host.getBoundingClientRect().height);
				handle.classList.remove('is-dragging');
				handle.removeEventListener('pointermove', move);
				handle.removeEventListener('pointerup', up);
				handle.removeEventListener('pointercancel', cancelPointer);
				document.removeEventListener('keydown', key, true);
				window.removeEventListener('blur', cancelPointer);
				if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
				this.editor.viewport.handleWindowResize();
			};
			const up = next => { if (next.pointerId === event.pointerId) finish(); };
			const cancelPointer = () => finish(true);
			const key = next => { if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); finish(true); } };
			handle.addEventListener('pointermove', move);
			handle.addEventListener('pointerup', up);
			handle.addEventListener('pointercancel', cancelPointer);
			document.addEventListener('keydown', key, true);
			window.addEventListener('blur', cancelPointer);
		});
		const reset = () => {
			PREFERENCES.reset('timelineHeight');
			this.applyHeight(PREFERENCES.get('timelineHeight'));
			this.editor.viewport.handleWindowResize();
		};
		handle.addEventListener('dblclick', () => { if (this.available) reset(); });
		handle.addEventListener('keydown', event => {
			if (!this.available) return;
			if (event.key === 'Home' || event.key === 'Escape') { event.preventDefault(); reset(); }
			if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
			event.preventDefault(); event.stopPropagation();
			const step = event.shiftKey ? CONFIG.ui.panelResize.fastKeyStep : CONFIG.ui.panelResize.keyStep;
			const height = this.applyHeight(this.host.getBoundingClientRect().height + (event.key === 'ArrowUp' ? step : -step));
			PREFERENCES.set('timelineHeight', height);
			this.editor.viewport.handleWindowResize();
		});
	}

	markStale() {
		if (!this.available) return;
		this.host.classList.add('is-stale');
		this.fit.disabled = true;
	}

	syncControls() {
		if (!this.available) return;
		this.fit.disabled = this.host.classList.contains('is-stale') || !this.editor.getLoopCandidate()?.canApply;
	}

	sync(estimate) {
		if (!this.available) return;
		const scrollTop = this.body.scrollTop;
		const scrollLeft = this.body.scrollLeft;
		this.host.classList.remove('is-stale');
		this.model = TimelineView.buildModel(estimate, this.editor.layers);
		this.body.replaceChildren();
		this.readout.replaceChildren();
		if (!this.model.groups.length) {
			this.body.appendChild(this.element('property-empty', 'Nothing in this project is animated.'));
			this.syncControls();
			return;
		}
		const { loopMs, frameCount, outputFormat, exact } = this.model;
		this.readout.appendChild(document.createTextNode(`${(loopMs / 1000).toFixed(2)} s loop · about ${frameCount} frames, ${outputFormat.toUpperCase()} `));
		const badge = this.element(`badge ${exact ? 'is-accent' : 'is-warning'}`, exact ? 'Seamless' : 'Visible seam');
		this.readout.appendChild(badge);
		const style = getComputedStyle(this.body);
		const columns = parseFloat(style.getPropertyValue('--timeline-label-column')) + parseFloat(style.getPropertyValue('--timeline-info-column'));
		this.fitScale = Math.max(1, this.body.clientWidth - columns) / (loopMs * (1 + this.config.nextLoopFraction) / 1000);
		const zoom = PREFERENCES.get('timelineZoom');
		this.scale = zoom === 'fit' ? this.fitScale : zoom;
		this.trackWidth = TimelineView.timeToX(loopMs * (1 + this.config.nextLoopFraction), this.scale);
		this.body.style.setProperty('--timeline-track-width', `${this.trackWidth}px`);
		this.body.style.setProperty('--timeline-loop-x', `${TimelineView.timeToX(loopMs, this.scale)}px`);
		this.body.appendChild(this.buildRuler());
		for (const group of this.model.groups) this.body.appendChild(this.buildGroup(group));
		this.body.scrollTop = scrollTop;
		this.body.scrollLeft = scrollLeft;
		this.syncControls();
		this.syncSelection();
	}

	buildRuler() {
		const ruler = this.element('timeline-ruler');
		const track = this.element('timeline-ruler-track');
		const canvas = document.createElement('canvas'); canvas.className = 'timeline-ruler-ticks';
		const height = this.config.rowHeight + this.config.groupHeight;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.ceil(this.trackWidth * ratio); canvas.height = Math.ceil(height * ratio);
		canvas.style.width = `${this.trackWidth}px`; canvas.style.height = `${height}px`;
		const ctx = canvas.getContext('2d');
		ctx.scale(ratio, ratio);
		const style = getComputedStyle(this.host);
		ctx.fillStyle = style.getPropertyValue('--color-text-secondary');
		ctx.strokeStyle = style.getPropertyValue('--color-border');
		ctx.font = `${style.getPropertyValue('--font-size-xs')} ${style.fontFamily}`;
		const step = TimelineView.tickStep(this.scale, this.config.labelWidth / 2);
		for (let ms = 0; ms < this.model.loopMs * (1 + this.config.nextLoopFraction); ms += step) {
			const x = TimelineView.timeToX(ms, this.scale);
			ctx.fillText(`${ms / 1000}s`, x + 2, height / 2);
			ctx.fillRect(x, height - this.config.minTickPx * 2, 1, this.config.minTickPx * 2);
		}
		const starts = this.model.frameStarts;
		starts.forEach((ms, index) => {
			const gap = Math.min(index ? ms - starts[index - 1] : Infinity, index < starts.length - 1 ? starts[index + 1] - ms : Infinity);
			if (TimelineView.timeToX(gap, this.scale) >= this.config.minTickPx) ctx.fillRect(TimelineView.timeToX(ms, this.scale), height - this.config.minTickPx, 1, this.config.minTickPx);
		});
		const loop = this.element('timeline-loop-end', `${(this.model.loopMs / 1000).toFixed(2)} s`);
		track.append(canvas, loop);
		ruler.append(track);
		return ruler;
	}

	buildGroup(group) {
		const node = this.element('timeline-group'); node.dataset.layerId = group.layerId;
		node.classList.toggle('is-locked', group.locked);
		const collapsed = Boolean(PREFERENCES.get('timelineCollapsed')[group.layerId]);
		node.classList.toggle('is-collapsed', collapsed);
		const header = this.element('timeline-group-header list-row');
		const chevron = this.button('btn-icon-simple icon-wrapper', `Toggle ${group.name} timeline rows`, collapsed ? 'chevron-right' : 'chevron-down', () => {
			PREFERENCES.set('timelineCollapsed', { ...PREFERENCES.get('timelineCollapsed'), [group.layerId]: !node.classList.contains('is-collapsed') });
			this.sync(this.editor.loopEstimate);
		});
		chevron.setAttribute('aria-expanded', String(!collapsed));
		const name = this.button('btn-text timeline-group-name', `Select ${group.name}`, null, () => this.editor.layerManager.setActiveLayer(group.layerId));
		name.textContent = group.name;
		header.append(chevron, name); node.appendChild(header);
		for (const row of group.rows) node.appendChild(this.buildRow(row));
		return node;
	}

	rowInfo(row) {
		const period = `${(row.cycleMs / 1000).toFixed(2)} s`;
		if (row.kind === 'authored') return `${row.frameCount} frames · ${period}`;
		return `${period}${row.nonLooping ? ` · x${row.source.run ? ((row.source.run.end - row.source.run.start) / row.cycleMs + row.phase).toFixed(2).replace(/\.?0+$/, '') : ''}` : ''}`;
	}

	seamTitle(row) {
		if (row.nonLooping) return 'Still holding its last pose when the loop restarts.';
		const time = TimelineView.timeToCycle({ ...row, cycleMs: row.exportCycleMs, endMs: Infinity }, this.model.loopMs);
		return `Ends ${(time.progress * row.exportCycleMs / 1000).toFixed(2)} s into a ${(row.exportCycleMs / 1000).toFixed(2)} s cycle, so it jumps when the loop restarts.`;
	}

	buildRow(row) {
		const node = this.element('timeline-row'); node.dataset.sourceKey = row.key;
		const select = () => {
			this.selectedKey = String(row.key);
			this.editor.layerManager.setActiveLayer(row.layerId);
			this.syncSelection();
		};
		const label = this.button('timeline-row-label btn-text', `Select ${row.label}`, null, select); label.textContent = row.label;
		const track = this.element('timeline-track');
		const bar = this.button(`timeline-bar is-${row.kind}`, `${row.label}: ${this.rowInfo(row)}`, null, select);
		bar.classList.toggle('is-seam', !row.closes);
		bar.classList.toggle('is-trimmed', row.nonLooping === true);
		bar.title += `${row.exportCycleMs !== row.cycleMs ? `. Export uses ${(row.exportCycleMs / 1000).toFixed(2)} s.` : ''}${!row.closes ? ` ${this.seamTitle(row)}` : ''}`;
		const left = TimelineView.timeToX(row.startMs, this.scale);
		const width = TimelineView.timeToX(Math.max(0, row.endMs - row.startMs), this.scale);
		node.style.setProperty('--timeline-bar-left', `${left}px`);
		bar.style.left = `${left}px`; bar.style.width = `${width}px`;
		bar.appendChild(this.buildMarks(row, row.startMs, row.endMs));
		track.appendChild(bar);
		if (!row.closes) {
			const seam = this.element('timeline-bar-seam');
			seam.title = this.seamTitle(row); seam.appendChild(createIcon('triangle-exclamation'));
			track.appendChild(seam);
		}
		const ghostEnd = this.model.loopMs * (1 + this.config.nextLoopFraction);
		const ghost = this.element('timeline-bar-ghost');
		ghost.style.left = `${TimelineView.timeToX(this.model.loopMs, this.scale)}px`;
		ghost.style.width = `${TimelineView.timeToX(ghostEnd - this.model.loopMs, this.scale)}px`;
		if (!row.nonLooping) ghost.appendChild(this.buildMarks(row, this.model.loopMs, ghostEnd));
		track.appendChild(ghost);
		const info = this.element('timeline-row-info', this.rowInfo(row)); info.title = bar.title;
		if (row.exportCycleMs !== row.cycleMs) info.title = `Export uses ${(row.exportCycleMs / 1000).toFixed(2)} s.`;
		const lane = this.element('timeline-row-lane'); lane.hidden = true;
		node.append(label, track, info, lane);
		return node;
	}

	buildMarks(row, start, end) {
		const marks = this.element('timeline-bar-marks');
		const drawing = { ...row, cycleMs: row.exportCycleMs, endMs: end };
		const cyclePx = TimelineView.timeToX(drawing.cycleMs, this.scale);
		const atStart = TimelineView.timeToCycle({ ...drawing, endMs: Infinity }, Math.max(start, row.startMs));
		const rawProgress = TimelineView.isReversed(drawing, atStart.index) ? 1 - atStart.progress : atStart.progress;
		marks.style.setProperty('--cycle-px', `${cyclePx}px`);
		marks.style.setProperty('--cycle-offset-px', `${-rawProgress * cyclePx}px`);
		const positions = [0, ...row.cycleMarks, 1];
		const gap = Math.min(...positions.slice(1).map((value, index) => value - positions[index]));
		if (gap * cyclePx < this.config.minTickPx || Math.ceil((end - start) / drawing.cycleMs + 1) * row.cycleMarks.length > this.config.maxMarksPerBar) return marks;
		const first = Math.floor((start - row.startMs) / drawing.cycleMs + row.phase);
		const last = Math.ceil((end - row.startMs) / drawing.cycleMs + row.phase);
		for (let index = first; index <= last; index++) {
			for (const progress of row.cycleMarks) {
				const ms = TimelineView.cycleToTime(drawing, index, progress);
				if (ms <= start || ms >= end) continue;
				const mark = this.element('timeline-cycle-mark');
				mark.style.left = `${TimelineView.timeToX(ms - start, this.scale)}px`; marks.appendChild(mark);
			}
		}
		return marks;
	}

	syncSelection() {
		for (const node of this.body.querySelectorAll('.timeline-row')) {
			const selected = node.dataset.sourceKey === this.selectedKey;
			node.classList.toggle('is-selected', selected);
			node.querySelector('.timeline-bar').setAttribute('aria-pressed', String(selected));
		}
		for (const group of this.body.querySelectorAll('.timeline-group')) group.classList.toggle('active', group.dataset.layerId === this.editor.activeLayerId);
	}

	stepZoom(direction, anchorX) {
		if (!this.model?.loopMs) return;
		const stops = this.config.pxPerSecondStops.filter(value => value > this.fitScale);
		const next = direction > 0 ? stops.find(value => value > this.scale) : stops.findLast(value => value < this.scale);
		this.setZoom(next || (direction < 0 ? 'fit' : PREFERENCES.get('timelineZoom')), anchorX);
	}

	setZoom(pxPerSecond, anchorX) {
		if (!this.available) return;
		const oldScale = this.scale;
		const time = anchorX == null ? null : TimelineView.xToTime(anchorX, oldScale);
		const oldScroll = this.body.scrollLeft;
		PREFERENCES.set('timelineZoom', pxPerSecond);
		this.sync(this.editor.loopEstimate);
		if (time != null) this.body.scrollLeft = oldScroll + TimelineView.timeToX(time, this.scale) - anchorX;
	}
}
