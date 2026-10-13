'use strict';

class TimelineDock {
	constructor(editor, host) {
		this.editor = editor;
		this.host = host;
		this.config = CONFIG.ui.timeline;
		this.selectedKey = null;
		this.listedIds = new Set();
		for (const [key, value] of Object.entries({
			'row-height': this.config.rowHeight, 'group-height': this.config.groupHeight, 'ruler-height': this.config.rulerHeight,
			'group-media': this.config.groupMedia, 'info-width': this.config.infoWidth, 'grip': this.config.gripPx, 'key-size': this.config.keySize
		})) host.style.setProperty(`--timeline-${key}`, `${value}px`);
		this.resizeHandle = this.element('timeline-resize-handle');
		this.resizeHandle.tabIndex = 0;
		this.resizeHandle.setAttribute('role', 'separator');
		this.resizeHandle.setAttribute('aria-orientation', 'horizontal');
		this.resizeHandle.setAttribute('aria-label', 'Resize timeline');
		// The same bar as a panel section: icon, name, detail, actions.
		this.header = this.element('section-header section-header-with-action');
		this.title = this.element('section-header-title', undefined, 'h3');
		const icon = this.element('section-header-title-icon icon-wrapper sm', undefined, 'span');
		icon.appendChild(createIcon('timeline'));
		this.title.append(icon, this.element('section-header-title-text', 'Timeline', 'span'));
		// What the export would write, and whether it closes.
		this.summary = this.element('timeline-summary');
		this.readout = this.element('timeline-readout', undefined, 'span');
		this.readout.setAttribute('aria-live', 'polite');
		this.summary.append(this.readout);
		const actions = this.element('section-header-actions');
		const action = 'section-header-action btn-icon-simple icon-wrapper sm visible';
		// Shows the same state as the view menu's Pause motion.
		this.play = this.button(action, 'Pause motion', 'motion-pause', () => editor.animationPanel.setPaused(!editor.animationTicker.paused));
		this.time = this.element('timeline-time', undefined, 'span');
		const transport = this.element('timeline-transport');
		transport.append(this.play, this.time);
		this.minimize = this.button(action, 'Collapse timeline', 'chevron-down', () => this.toggleMinimized());
		this.snap = this.button(action, 'Snap timeline', 'magnet', () => {
			PREFERENCES.set('timelineSnap', !PREFERENCES.get('timelineSnap'));
			this.syncSnap();
		});
		this.syncSnap();
		this.zoomOut = this.button(action, 'Zoom timeline out', 'minus', () => this.stepZoom(-1));
		this.zoomIn = this.button(action, 'Zoom timeline in', 'plus', () => this.stepZoom(1));
		actions.append(this.snap, this.zoomOut, this.zoomIn,
			this.buildOptionsMenu(),
			this.minimize,
			this.button(action, 'Close timeline', 'x-mark', () => editor.toggleTimeline()));
		this.header.append(this.title, transport, this.summary, actions);
		// The bar is the toggle, as on a panel section.
		this.header.addEventListener('click', event => {
			if (this.available && !event.target.closest('button')) this.toggleMinimized();
		});
		// The ruler stays above the scrolling rows and follows their sideways
		// scroll; the playhead is one line over both.
		this.ruler = this.element('timeline-ruler');
		this.body = this.element('timeline-body');
		this.playhead = this.element('timeline-playhead');
		this.labelHandle = this.element('timeline-label-handle');
		this.labelHandle.tabIndex = 0;
		this.labelHandle.setAttribute('role', 'separator');
		this.labelHandle.setAttribute('aria-orientation', 'vertical');
		this.labelHandle.setAttribute('aria-label', 'Resize timeline labels');
		this.stage = this.element('timeline-stage');
		// Where a drag snapped, drawn like the playhead.
		this.snapGuide = this.element('timeline-snap-guide'); this.snapGuide.hidden = true;
		this.stage.append(this.ruler, this.body, this.playhead, this.snapGuide, this.labelHandle);
		const section = this.element('timeline-section section');
		section.append(this.header, this.stage);
		host.replaceChildren(this.resizeHandle, section);
		this.frameView = new TimelineFrameView(this);
		this.keyLane = new TimelineKeyLane(this);
		this.keyRecording = new TimelineKeyRecording(this);
		this.bindResize();
		this.bindLabelResize();
		this.stage.addEventListener('wheel', event => {
			if ((!event.ctrlKey && !event.metaKey) || !this.available || !this.model?.loopMs) return;
			if (!event.target.closest('.timeline-track, .timeline-ruler')) return;
			event.preventDefault();
			const track = this.body.querySelector('.timeline-track');
			const x = event.clientX - track.getBoundingClientRect().left;
			this.stepZoom(event.deltaY < 0 ? 1 : -1, x);
		}, { passive: false });
		this.bindPlayhead();
		this.bindGestures();
		this.observer = new ResizeObserver(() => {
			if (!this.available) return;
			if (!this.resizing) this.applyHeight(PREFERENCES.get('timelineHeight'));
			if (!this.resizingLabels) this.applyLabelWidth(PREFERENCES.get('timelineLabelWidth'));
			this.resync();
		});
		this.observer.observe(host);
		// Reset Panels restores these from outside the dock.
		PREFERENCES.onChange('timelineHeight', value => { if (this.available && !this.resizing) { this.applyHeight(value); this.editor.viewport.handleWindowResize(); } });
		PREFERENCES.onChange('timelineLabelWidth', value => { if (this.available && !this.resizingLabels) { this.applyLabelWidth(value); this.resync(); } });
		PREFERENCES.onChange('timelineShow', () => { this.applyShow(); this.resync(); });
		window.addEventListener('layerChanged', () => {
			if (!this.available) return;
			this.syncSelection();
			this.revealActive();
		});
	}

	element(className, text, tag = 'div') {
		const node = document.createElement(tag);
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

	// The header's one menu: the two whole-timeline actions, then what the
	// rows draw. The view choices are stored together as `timelineShow`.
	buildOptionsMenu() {
		const root = this.element('section-header-action app-menu visible');
		const trigger = this.button('btn-icon-simple app-menu-trigger icon-wrapper sm', 'Timeline options', 'ellipsis-vertical', () => {});
		trigger.setAttribute('aria-haspopup', 'true');
		trigger.setAttribute('aria-expanded', 'false');
		const panel = this.element('app-menu-panel'); panel.hidden = true;
		panel.setAttribute('role', 'menu');
		const item = (label, run) => {
			const button = this.button('app-menu-item', label, null, run);
			button.setAttribute('role', 'menuitem');
			button.removeAttribute('title');
			const current = this.element('app-menu-item-current', undefined, 'span');
			current.setAttribute('aria-hidden', 'true');
			current.appendChild(createIcon('check'));
			button.append(this.element('app-menu-item-label', label, 'span'), current);
			return button;
		};
		this.zoomFit = item('Zoom to fit', () => this.setZoom('fit'));
		this.exact = item('Play exact', () => this.frameView.playExact());
		this.exact.title = 'Play the frames the export would write';
		this.fit = item('Fit animations to loop', () => {
			if (!this.host.classList.contains('is-stale')) this.editor.fitAnimationsToLoop();
		});
		const separator = this.element('app-menu-separator'); separator.setAttribute('role', 'separator');
		this.showItems = Object.entries(this.config.showLabels).map(([key, label]) => {
			const button = item(label, () => {
				PREFERENCES.set('timelineShow', { ...this.show, [key]: !this.show[key] });
			});
			button.dataset.show = key;
			return button;
		});
		panel.append(this.zoomFit, this.exact, this.fit, separator, this.element('app-menu-group-label', 'Show'), ...this.showItems);
		root.append(trigger, panel);
		setupMenuPopover({ root, trigger, panel, fixed: true });
		this.applyShow();
		return root;
	}

	// The stored choices over the defaults, so a choice added later has a value.
	get show() { return { ...this.config.show, ...PREFERENCES.get('timelineShow') }; }

	// How much of the next pass the tracks draw past the loop line.
	get nextLoopShare() { return this.show.nextLoop ? this.config.nextLoopFraction : 0; }

	// Frame ticks, by choice or because the zoom is close enough to work in frames.
	get showsFrames() {
		const { loopMs, frameCount } = this.model;
		return this.show.frames || (frameCount > 0 && TimelineView.timeToX(loopMs / frameCount, this.scale) >= this.config.frameTickAutoPx);
	}

	applyShow() {
		const show = this.show;
		for (const button of this.showItems) {
			button.setAttribute('aria-current', String(show[button.dataset.show]));
			this.host.classList.toggle(`shows-${button.dataset.show}`, show[button.dataset.show]);
		}
	}

	get isOpen() { return !this.host.hidden; }
	get available() { return this.isOpen && isFeatureAvailable('timeline'); }

	open() {
		if (!isFeatureAvailable('timeline')) return;
		const changed = !this.isOpen;
		this.host.hidden = false;
		this.applyMinimized();
		this.applyHeight(PREFERENCES.get('timelineHeight'));
		this.applyLabelWidth(PREFERENCES.get('timelineLabelWidth'));
		this.sync(this.editor.loopEstimate);
		const activeLayer = this.editor.layerManager.getActiveLayer();
		if (activeLayer) this.editor.animationPanel.load(activeLayer);
		// An open dock keeps the preview clock running for its playhead.
		this.editor.animationTicker.refresh();
		this.syncPlayback();
		if (changed) this.editor.viewport.handleWindowResize();
	}

	// A held playhead belongs to the open dock: closed, a paused preview
	// shows its rest pose again.
	close() {
		if (!this.isOpen) return;
		this.keyRecording.end();
		this.keyLane.finish(true);
		this.finishDrag(true);
		this.menu?.close();
		this.frameView.invalidate();
		this.host.hidden = true;
		const ticker = this.editor.animationTicker;
		if (ticker.paused) ticker.seek(0);
		else ticker.refresh();
		this.editor.viewport.handleWindowResize();
	}

	syncPlayback() {
		const paused = this.editor.animationTicker.paused;
		const label = paused ? 'Resume motion' : 'Pause motion';
		this.play.title = label;
		this.play.setAttribute('aria-label', label);
		this.play.querySelector('use').setAttribute('href', paused ? '#icon-motion-play' : '#icon-motion-pause');
	}

	// The ruler is the playhead's control: press or drag to move it, and with
	// focus Left and Right step one output frame and Home returns to the
	// start. Space plays and pauses from anywhere in the rows.
	bindPlayhead() {
		const ticker = this.editor.animationTicker;
		const hold = () => {
			if (!ticker.paused || !ticker.holding) this.editor.animationPanel.setPaused(true);
		};
		const scrub = event => {
			const { loopMs, frameStarts } = this.model;
			const ms = TimelineView.xToTime(event.clientX - this.rulerTrack.getBoundingClientRect().left, this.scale);
			const inside = Math.max(0, Math.min(loopMs - 1, ms));
			// Alt suspends snapping for the drag.
			ticker.seek(event.altKey || !PREFERENCES.get('timelineSnap') ? inside : TimelineView.nearestFrameStart(frameStarts, inside));
		};
		this.stage.addEventListener('pointerdown', event => {
			if (event.button !== 0 || !this.available || this.host.classList.contains('is-stale') || !this.model?.loopMs || !event.target.closest('.timeline-ruler-track') || event.target.closest('.timeline-loop-end')) return;
			event.preventDefault();
			this.rulerTrack.focus({ preventScroll: true });
			this.stage.setPointerCapture(event.pointerId);
			this.scrubPointer = event.pointerId;
			hold();
			scrub(event);
		});
		this.stage.addEventListener('pointermove', event => {
			if (event.pointerId === this.scrubPointer && this.available && this.model?.loopMs) scrub(event);
		});
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
			this.stage.addEventListener(type, event => {
				if (event.pointerId === this.scrubPointer) this.scrubPointer = null;
			});
		}
		this.body.addEventListener('scroll', () => this.syncScroll());
		this.stage.addEventListener('keydown', event => {
			if (!this.available || !this.model?.loopMs || event.ctrlKey || event.metaKey || event.altKey) return;
			const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
			if (event.key === ' ') this.editor.animationPanel.setPaused(!ticker.paused);
			else if (!event.target.closest('.timeline-ruler-track') || (!step && event.key !== 'Home')) return;
			else {
				hold();
				ticker.seek(step ? TimelineView.stepFrame(this.model.frameStarts, ticker.getPlayheadTime(), step) : 0);
			}
			event.preventDefault();
			// The canvas shortcuts on these keys belong to the canvas.
			event.stopPropagation();
		});
		// A button under the focus would otherwise take the release as a press.
		this.stage.addEventListener('keyup', event => {
			if (event.key !== ' ' || !this.available || !this.model?.loopMs) return;
			event.preventDefault();
			event.stopPropagation();
		});
	}

	syncScroll() {
		if (!this.rulerTrack) return;
		this.rulerTrack.style.transform = `translateX(${-this.body.scrollLeft}px)`;
		this.paintPlayhead(this.editor.animationTicker.getPlayheadTime());
	}

	paintPlayhead(ms) {
		if (!this.available || !this.rulerTrack) return;
		this.keyRecording.refresh();
		this.keyLane.paint(ms);
		this.frameView.paint(ms);
		const { loopMs } = this.model;
		const x = TimelineView.timeToX(Math.min(ms, loopMs), this.scale) - this.body.scrollLeft;
		this.playhead.style.transform = `translateX(${x}px)`;
		// The label column covers whatever has scrolled under it.
		this.playhead.hidden = x < 0;
		// The output frame under the playhead, from its start to the next one's:
		// the last frame ends on the loop line.
		const starts = this.model.frameStarts;
		const index = starts.findLastIndex(start => start <= ms + 1e-6);
		if (index !== this.frameIndex) {
			this.frameIndex = index;
			this.frameStart = index < 0 ? ms : starts[index];
			this.playhead.style.setProperty('--timeline-frame-width', `${index < 0 ? 0 : TimelineView.timeToX((starts[index + 1] ?? loopMs) - starts[index], this.scale)}px`);
		}
		this.playhead.style.setProperty('--timeline-frame-left', `${TimelineView.timeToX(this.frameStart - Math.min(ms, loopMs), this.scale)}px`);
		const text = `${(ms / 1000).toFixed(2)} / ${(loopMs / 1000).toFixed(2)} s`;
		if (this.time.textContent === text) return;
		this.time.textContent = text;
		this.rulerTrack.setAttribute('aria-valuenow', (ms / 1000).toFixed(2));
		this.rulerTrack.setAttribute('aria-valuetext', `${(ms / 1000).toFixed(2)} s`);
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
		const refit = () => this.editor.viewport.handleWindowResize();
		let startHeight = 0;
		let startY = 0;
		bindResizeHandleDrag(handle, {
			canStart: () => this.available,
			start: event => {
				startHeight = this.host.getBoundingClientRect().height;
				startY = event.clientY;
				this.resizing = true;
			},
			move: event => {
				if (!this.available) return;
				this.applyHeight(startHeight + startY - event.clientY);
				refit();
			},
			end: cancelled => {
				this.resizing = false;
				if (cancelled) this.applyHeight(startHeight);
				else PREFERENCES.set('timelineHeight', this.host.getBoundingClientRect().height);
				refit();
			}
		});
		const reset = () => PREFERENCES.reset('timelineHeight');
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

	// The label column, as wide as the stored preference where the dock has
	// the room.
	applyLabelWidth(value) {
		const max = Math.max(this.config.labelMinWidth, this.host.clientWidth * this.config.labelMaxFraction);
		const width = Math.round(Math.max(this.config.labelMinWidth, Math.min(max, value)));
		this.host.style.setProperty('--timeline-label-width', `${width}px`);
		this.labelHandle.setAttribute('aria-valuemin', String(this.config.labelMinWidth));
		this.labelHandle.setAttribute('aria-valuemax', String(Math.round(max)));
		this.labelHandle.setAttribute('aria-valuenow', String(width));
		return width;
	}

	bindLabelResize() {
		const handle = this.labelHandle;
		const current = () => Number(handle.getAttribute('aria-valuenow'));
		let startWidth = 0;
		let startX = 0;
		bindResizeHandleDrag(handle, {
			canStart: () => this.available,
			bodyClass: 'is-resizing-panel',
			start: event => {
				startWidth = current();
				startX = event.clientX;
				this.resizingLabels = true;
			},
			move: event => {
				if (this.available) this.applyLabelWidth(startWidth + event.clientX - startX);
			},
			// The tracks refit once, when the drag ends.
			end: cancelled => {
				this.resizingLabels = false;
				if (cancelled) this.applyLabelWidth(startWidth);
				else PREFERENCES.set('timelineLabelWidth', current());
				this.resync();
			}
		});
		const reset = () => PREFERENCES.reset('timelineLabelWidth');
		handle.addEventListener('dblclick', () => { if (this.available) reset(); });
		handle.addEventListener('keydown', event => {
			if (!this.available) return;
			if (event.key === 'Home' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); reset(); }
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
			event.preventDefault(); event.stopPropagation();
			const step = event.shiftKey ? CONFIG.ui.panelResize.fastKeyStep : CONFIG.ui.panelResize.keyStep;
			PREFERENCES.set('timelineLabelWidth', this.applyLabelWidth(current() + (event.key === 'ArrowRight' ? step : -step)));
			this.resync();
		});
	}

	resync() {
		if (!this.available) return;
		if (this.editor.loopEstimate) this.sync(this.editor.loopEstimate);
		else this.markStale();
	}

	markStale() {
		if (!this.available) return;
		this.keyLane.finish(true);
		this.keyRecording.validate();
		this.frameView.invalidate({ keepFrame: this.keyRecording.active });
		this.host.classList.add('is-stale');
		this.fit.disabled = true;
	}

	syncControls() {
		if (!this.available) return;
		this.fit.disabled = this.host.classList.contains('is-stale') || !this.editor.getLoopCandidate()?.canApply;
		this.exact.disabled = this.host.classList.contains('is-stale') || !this.model?.loopMs;
		const fit = PREFERENCES.get('timelineZoom') === 'fit';
		this.zoomFit.disabled = this.zoomOut.disabled = fit || !this.model?.loopMs;
		this.zoomIn.disabled = !this.model?.loopMs || !this.config.pxPerSecondStops.some(value => value > this.fitScale && value > this.scale);
	}

	sync(estimate) {
		if (!this.available) return;
		if (this.drag || this.keyLane.drag) return;
		this.menu?.close();
		this.menuPanel?.remove();
		const scrollTop = this.body.scrollTop;
		const scrollLeft = this.body.scrollLeft;
		const rulerFocused = Boolean(this.rulerTrack) && document.activeElement === this.rulerTrack;
		const focusedKey = document.activeElement?.closest('.timeline-row')?.dataset.sourceKey;
		const keyWasFocused = Boolean(document.activeElement?.closest('.timeline-key-track'));
		this.rulerTrack = null;
		this.ruler.replaceChildren();
		this.ruler.hidden = true;
		this.playhead.hidden = true;
		this.snapGuide.hidden = true;
		this.labelHandle.hidden = true;
		this.frameIndex = null;
		this.time.textContent = '';
		this.host.classList.remove('is-stale');
		this.model = TimelineView.buildModel(estimate, this.editor.layers, this.listedIds);
		for (const group of this.model.groups) for (const row of group.rows) row.originalPeriod = this.editor.layerManager.getLayerById(group.layerId)?.loopOriginalPeriods?.[row.key];
		this.listedIds = new Set(this.model.groups.map(group => group.layerId));
		this.body.replaceChildren();
		this.readout.textContent = '';
		this.seamBadge?.remove();
		this.seamBadge = null;
		this.stage.classList.toggle('is-empty', !this.model.groups.length);
		if (!this.model.groups.length) {
			this.body.appendChild(buildPropertyEmpty({
				visible: true, icon: 'timeline', title: 'Nothing is animated yet',
				text: 'Animated glitter, stickers, sparkles and motions each get a row here.'
			}));
			this.syncControls();
			return;
		}
		const { loopMs, frameCount, outputFormat, exact } = this.model;
		this.labelHandle.hidden = false;
		// With every animated layer hidden there are rows and nothing to time.
		const timed = loopMs > 0;
		if (timed) {
			this.readout.textContent = `about ${frameCount} frames, ${outputFormat.toUpperCase()}`;
			this.seamBadge = this.element(`badge ${exact ? 'is-accent' : 'is-warning'}`, exact ? 'Seamless' : 'Visible seam', 'span');
			this.summary.appendChild(this.seamBadge);
		}
		const style = getComputedStyle(this.body);
		this.labelColumn = parseFloat(style.getPropertyValue('--timeline-label-column'));
		const columns = this.labelColumn + parseFloat(style.getPropertyValue('--timeline-info-column'));
		this.fitScale = timed ? Math.max(1, this.body.clientWidth - columns) / (loopMs * (1 + this.nextLoopShare) / 1000) : 1;
		const zoom = PREFERENCES.get('timelineZoom');
		this.scale = zoom === 'fit' ? this.fitScale : zoom;
		this.trackWidth = TimelineView.timeToX(loopMs * (1 + this.nextLoopShare), this.scale);
		this.stage.style.setProperty('--timeline-track-width', `${this.trackWidth}px`);
		this.stage.style.setProperty('--timeline-loop-x', `${TimelineView.timeToX(loopMs, this.scale)}px`);
		if (timed) {
			this.ruler.appendChild(this.buildRuler());
			this.ruler.hidden = false;
		}
		for (const group of this.model.groups) this.body.appendChild(this.buildGroup(group));
		this.body.scrollTop = scrollTop;
		this.body.scrollLeft = scrollLeft;
		if (rulerFocused) this.rulerTrack?.focus({ preventScroll: true });
		if (focusedKey) Array.from(this.body.querySelectorAll('.timeline-row')).find(node => node.dataset.sourceKey === focusedKey)?.querySelector('.timeline-bar').focus({ preventScroll: true });
		this.syncScroll();
		this.syncControls();
		this.syncSelection();
		if (keyWasFocused) this.keyLane.focusSelected();
	}

	buildRuler() {
		const view = this.element('timeline-ruler-view');
		const track = this.element('timeline-ruler-track');
		track.tabIndex = 0;
		track.setAttribute('role', 'slider');
		track.setAttribute('aria-label', 'Playhead');
		track.setAttribute('aria-valuemin', '0');
		track.setAttribute('aria-valuemax', (this.model.loopMs / 1000).toFixed(2));
		this.rulerTrack = track;
		const canvas = document.createElement('canvas'); canvas.className = 'timeline-ruler-ticks';
		const height = this.config.rulerHeight;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.ceil(this.trackWidth * ratio); canvas.height = Math.ceil(height * ratio);
		canvas.style.width = `${this.trackWidth}px`; canvas.style.height = `${height}px`;
		const ctx = canvas.getContext('2d');
		ctx.scale(ratio, ratio);
		const style = getComputedStyle(this.host);
		const text = style.getPropertyValue('--color-text-secondary');
		const line = style.getPropertyValue('--color-border');
		ctx.font = `${style.getPropertyValue('--font-size-xs')} ${style.fontFamily}`;
		ctx.textBaseline = 'middle';
		const step = TimelineView.tickStep(this.scale, this.config.labelWidth / 2);
		for (let ms = 0; ms < this.model.loopMs * (1 + this.nextLoopShare); ms += step) {
			const x = TimelineView.timeToX(ms, this.scale);
			ctx.fillStyle = text;
			ctx.fillText(`${ms / 1000}s`, x + this.config.minTickPx, height / 2);
			ctx.fillStyle = line;
			ctx.fillRect(x, 0, 1, height);
		}
		const starts = this.showsFrames ? this.model.frameStarts : [];
		starts.forEach((ms, index) => {
			const gap = Math.min(index ? ms - starts[index - 1] : Infinity, index < starts.length - 1 ? starts[index + 1] - ms : Infinity);
			if (TimelineView.timeToX(gap, this.scale) >= this.config.minTickPx) ctx.fillRect(TimelineView.timeToX(ms, this.scale), height - this.config.minTickPx, 1, this.config.minTickPx);
		});
		const loop = this.element('timeline-loop-end', `${(this.model.loopMs / 1000).toFixed(2)} s`);
		loop.dataset.drag = 'loop';
		loop.title = 'Drag to set loop length; double-click for Automatic';
		track.append(canvas, loop);
		view.append(track);
		return view;
	}

	buildGroup(group) {
		const node = this.element('timeline-group'); node.dataset.layerId = group.layerId;
		const collapsed = Boolean(PREFERENCES.get('timelineCollapsed')[group.layerId]);
		node.classList.toggle('is-collapsed', collapsed);
		// A row like the ones under it: the layer in the label column, and
		// the span of its animations on the track.
		const header = this.element('timeline-group-header');
		const label = this.element('timeline-group-label list-row');
		const toggle = () => {
			PREFERENCES.set('timelineCollapsed', { ...PREFERENCES.get('timelineCollapsed'), [group.layerId]: !node.classList.contains('is-collapsed') });
			this.sync(this.editor.loopEstimate);
		};
		const chevron = this.button('btn-icon-simple icon-wrapper sm', `Toggle ${group.name} timeline rows`, collapsed ? 'chevron-right' : 'chevron-down', toggle);
		chevron.setAttribute('aria-expanded', String(!collapsed));
		// The chevron folds the rows; the rest of the row selects the layer.
		header.addEventListener('click', event => {
			if (this.available && !event.target.closest('button')) this.editor.layerManager.setActiveLayer(group.layerId);
		});
		const manager = this.editor.layerManager;
		const layer = manager.getLayerById(group.layerId);
		// The Layers list's own state buttons, on the same layer.
		const rowAction = 'btn-icon-simple icon-wrapper sm list-row-action';
		const visibility = this.button(`${rowAction} timeline-group-visibility`, '', 'eye', () => {
			manager.toggleLayerVisibility(layer.id);
			this.applyRowState(node, layer);
		});
		const lock = this.button(`${rowAction} timeline-group-lock`, '', 'lock', () => {
			manager.pressLayerLock(layer);
			this.applyRowState(node, layer);
		});
		const actions = this.element('list-row-actions');
		actions.append(lock, this.button(`${rowAction} timeline-group-delete`, '', 'trash', () => manager.deleteLayerFromRow(layer)));
		const select = this.button('timeline-group-select', `Select ${group.name}`, null, () => this.editor.layerManager.setActiveLayer(group.layerId));
		const swatch = this.element('layer-swatch list-row-media');
		manager.renderLayerSwatch(swatch, layer, { compact: true });
		select.appendChild(swatch);
		const name = this.element('timeline-group-name', group.name, 'span'); name.title = group.name;
		label.append(chevron, visibility, select, name, actions);
		const track = this.element('timeline-track timeline-group-track');
		if (group.rows.length) {
			const span = this.element('timeline-group-span');
			const start = Math.min(...group.rows.map(row => row.startMs));
			span.style.left = `${TimelineView.timeToX(start, this.scale)}px`;
			span.style.width = `${TimelineView.timeToX(Math.max(...group.rows.map(row => row.endMs)) - start, this.scale)}px`;
			track.appendChild(span);
		} else track.appendChild(this.element('timeline-group-note', 'Hidden', 'span'));
		header.append(label, track); node.appendChild(header);
		this.applyRowState(node, layer);
		for (const row of group.rows) node.appendChild(this.buildRow(row));
		return node;
	}

	applyRowState(node, layer) {
		const state = this.editor.layerManager.getLayerRowState(layer);
		node.classList.toggle('is-hidden', !layer.visible);
		node.classList.toggle('is-locked', isLayerFullyLocked(layer));
		for (const [key, { icon, title, active = false, disabled = false }] of Object.entries(state)) {
			const button = node.querySelector(`.timeline-group-${key}`);
			button.title = title; button.setAttribute('aria-label', title);
			button.classList.toggle('active', active); button.disabled = disabled;
			if (icon) button.querySelector('use').setAttribute('href', `#icon-${icon}`);
		}
	}

	seamTitle(row) {
		if (row.nonLooping) return 'Still holding its last pose when the loop restarts.';
		const time = TimelineView.timeToCycle({ ...row, cycleMs: row.exportCycleMs, endMs: Infinity }, this.model.loopMs);
		return `Ends ${(time.progress * row.exportCycleMs / 1000).toFixed(2)} s into a ${(row.exportCycleMs / 1000).toFixed(2)} s cycle, so it jumps when the loop restarts.`;
	}

	buildRow(row) {
		const node = this.element('timeline-row'); node.dataset.sourceKey = row.key;
		const select = () => {
			if (this.suppressClick) return;
			this.selectedKey = String(row.key);
			if (row.effectSlot?.startsWith('animation-')) this.editor.animationPanel.selectedByLayer.set(row.layerId, Number(row.effectSlot.slice('animation-'.length)));
			this.editor.layerManager.setActiveLayer(row.layerId);
			this.editor.refreshInspector();
			this.openRowSection(row);
			this.syncSelection();
		};
		const label = this.button('timeline-row-label btn-text', `Select ${row.label}`, null, select); label.textContent = row.label;
		const track = this.element('timeline-track');
		const bar = this.button(`timeline-bar is-${row.kind}`, `${row.label}: ${TimelineView.rowInfo(row)}`, null, select);
		bar.classList.toggle('is-seam', !row.closes);
		const body = TimelineView.bodyDrag(row, false);
		bar.classList.toggle('is-movable', body === 'move');
		bar.classList.toggle('is-slippable', body === 'slip');
		bar.title += `${row.exportCycleMs !== row.cycleMs ? `. Export uses ${TimelineView.seconds(row.exportCycleMs)}.` : ''}${!row.closes ? ` ${this.seamTitle(row)}` : ''}`;
		if (body === 'move') bar.title += row.can.phase ? ' Drag to move it. Alt-drag to slip the motion inside it.' : ' Drag to move it.';
		else if (body === 'slip') bar.title += ' Drag to slip the motion inside it.';
		this.placeBar(node, bar, row);
		bar.appendChild(this.buildMarks(row, row.startMs, row.endMs));
		bar.dataset.drag = 'body';
		for (const side of ['left', 'right']) if (row.can.run) {
			const handle = this.element(`timeline-bar-handle is-${side}`, undefined, 'span');
			handle.dataset.drag = side;
			handle.title = side === 'left' ? 'Drag to change when it starts. Alt: no snapping' : 'Drag to change how many times it repeats. Alt: no snapping';
			bar.appendChild(handle);
		}
		if (row.can.period) {
			const drawing = { ...row, cycleMs: row.exportCycleMs, endMs: Infinity };
			for (const ms of TimelineView.cycleStarts(drawing, this.model.loopMs)) {
				if (TimelineView.timeToX(ms - row.startMs, this.scale) < this.config.minTickPx) continue;
				const notch = this.element('timeline-period-notch', undefined, 'span');
				notch.dataset.drag = 'period';
				notch.dataset.notchIndex = String(TimelineView.timeToCycle(drawing, ms + 1e-6).index);
				notch.style.left = `${TimelineView.timeToX(ms - row.startMs, this.scale)}px`;
				notch.title = 'Drag to change the cycle length';
				bar.appendChild(notch);
			}
		}
		bar.addEventListener('focus', () => this.syncHint(row));
		bar.addEventListener('blur', () => this.syncHint(null));
		bar.addEventListener('contextmenu', event => { event.preventDefault(); this.openBarMenu(row, node, bar); });
		bar.addEventListener('keydown', event => {
			if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
				event.preventDefault(); event.stopPropagation(); this.openBarMenu(row, node, bar);
			} else if (event.altKey || event.ctrlKey || event.metaKey) return;
			else if (event.key === 'Enter') {
				event.preventDefault(); event.stopPropagation(); this.openBarMenu(row, node, bar);
			} else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
				event.preventDefault(); event.stopPropagation(); this.nudgeRow(row, event);
			} else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
				// Between bars, past any folded layer.
				const bars = Array.from(this.body.querySelectorAll('.timeline-group:not(.is-collapsed) .timeline-bar'));
				const next = { ArrowUp: bars[bars.indexOf(bar) - 1], ArrowDown: bars[bars.indexOf(bar) + 1], Home: bars[0], End: bars.at(-1) }[event.key];
				event.preventDefault(); event.stopPropagation();
				next?.focus();
			}
		});
		track.appendChild(bar);
		if (!row.closes) {
			const seam = this.element('timeline-bar-seam');
			seam.title = this.seamTitle(row); seam.appendChild(createIcon('triangle-exclamation'));
			track.appendChild(seam);
		}
		if (this.nextLoopShare) {
			const ghostEnd = this.model.loopMs * (1 + this.nextLoopShare);
			const ghost = this.element('timeline-bar-ghost');
			ghost.style.left = `${TimelineView.timeToX(this.model.loopMs, this.scale)}px`;
			ghost.style.width = `${TimelineView.timeToX(ghostEnd - this.model.loopMs, this.scale)}px`;
			if (!row.nonLooping) ghost.appendChild(this.buildMarks(row, this.model.loopMs, ghostEnd));
			track.appendChild(ghost);
		}
		const info = this.element('timeline-row-info', TimelineView.rowInfo(row)); info.title = bar.title;
		if (row.exportCycleMs !== row.cycleMs) info.title = `Export uses ${TimelineView.seconds(row.exportCycleMs)}.`;
		const lane = this.element('timeline-row-lane'); lane.hidden = true;
		node.append(label, track, info, lane);
		return node;
	}

	// A bar on its track, at least wide enough to grab.
	placeBar(node, bar, row) {
		const box = TimelineView.barBox(row, this.scale, this.config);
		node.style.setProperty('--timeline-bar-left', `${box.left}px`);
		bar.style.left = `${box.left}px`; bar.style.width = `${box.width}px`;
		bar.classList.toggle('has-outside-grips', box.gripsOutside);
		bar.classList.toggle('keeps-left-grip', box.leftGripInside);
	}

	buildMarks(row, start, end) {
		const marks = this.element('timeline-bar-marks');
		marks.setAttribute('aria-hidden', 'true');
		const drawing = { ...row, cycleMs: row.exportCycleMs, endMs: end };
		const cyclePx = TimelineView.timeToX(drawing.cycleMs, this.scale);
		const atStart = TimelineView.timeToCycle({ ...drawing, endMs: Infinity }, Math.max(start, row.startMs));
		const rawProgress = TimelineView.isReversed(drawing, atStart.index) ? 1 - atStart.progress : atStart.progress;
		marks.style.setProperty('--cycle-px', `${cyclePx}px`);
		marks.style.setProperty('--cycle-offset-px', `${-rawProgress * cyclePx}px`);
		// A keyed motion's marks are its keys, repeated with each cycle.
		const keyed = Boolean(row.source.keyTrack);
		if (keyed ? !this.show.cycles : !this.showsFrames) return marks;
		const positions = [0, ...row.cycleMarks, 1];
		const gap = Math.min(...positions.slice(1).map((value, index) => value - positions[index]));
		if (gap * cyclePx < this.config.minTickPx || Math.ceil((end - start) / drawing.cycleMs + 1) * row.cycleMarks.length > this.config.maxMarksPerBar) return marks;
		const first = Math.floor((start - row.startMs) / drawing.cycleMs + row.phase);
		const last = Math.ceil((end - row.startMs) / drawing.cycleMs + row.phase);
		for (let index = first; index <= last; index++) {
			for (const progress of row.cycleMarks) {
				const ms = TimelineView.cycleToTime(drawing, index, progress);
				if (ms <= start || ms >= end) continue;
				const mark = this.element(keyed ? 'timeline-key-dot' : 'timeline-cycle-mark');
				mark.style.left = `${TimelineView.timeToX(ms - start, this.scale)}px`; marks.appendChild(mark);
			}
		}
		return marks;
	}

	syncSnap() {
		const enabled = PREFERENCES.get('timelineSnap');
		this.snap.classList.toggle('active', enabled);
		this.snap.setAttribute('aria-pressed', String(enabled));
	}

	openRowSection(row) {
		const layer = this.editor.layerManager.getLayerById(row.layerId);
		const prefix = LAYER_UI_CONFIG[layer.type].transformPrefix;
		const section = row.effectSlot?.startsWith('animation-') ? document.getElementById(`${prefix}AnimationSection`)
			: row.effectSlot ? document.querySelector(`#${prefix}SettingsSection [data-slot="${row.effectSlot}"]`) || Array.from(document.querySelectorAll('.flyout-host:not([hidden]) [data-slot]')).find(card => card.dataset.slot === row.effectSlot && card.id.startsWith(prefix))
				: document.querySelector('.panel-controls.visible .section');
		if (!section) return;
		if (section.dataset.flyoutKey && this.editor.pickers.flyout !== section.dataset.flyoutKey) this.editor.pickers.toggleFlyout(section.dataset.flyoutKey);
		setPanelCardCollapsed(section, false);
		section.scrollIntoView({ block: 'nearest' });
	}

	rowFor(node) { return this.model?.groups.flatMap(group => group.rows).find(row => String(row.key) === node?.dataset.sourceKey); }

	canEdit(row) {
		return this.available && !this.host.classList.contains('is-stale') && row && !isLayerFullyLocked(this.editor.layerManager.getLayerById(row.layerId));
	}

	commitTiming(label, options) {
		this.editor.layerManager.renderLayersList();
		this.editor.refreshInspector();
		this.editor.requestPreviewUpdate();
		this.editor.saveState(label, options);
	}

	renderTiming(row) {
		this.frameView.invalidate();
		if (row) {
			const layer = this.editor.layerManager.getLayerById(row.layerId);
			getLayerManagerForType(this.editor, layer.type).renderLayer(layer);
		}
		this.editor.requestPreviewUpdate();
	}

	openBarMenu(row, node, bar, choices = null) {
		if (!this.canEdit(row)) return;
		this.menu?.close();
		this.menuPanel?.remove();
		const actions = choices || TimelineView.barActions(row, this.model);
		if (!actions.length) return;
		const panel = this.element('app-menu-panel'); panel.hidden = true;
		panel.setAttribute('role', 'menu');
		for (const action of actions) {
			if (action.choices && !action.choices.length) continue;
			const item = this.button('app-menu-item', action.label, null, () => {
				if (!this.canEdit(row)) return;
				if (action.choices) {
					// The popover closes after a menu item click.
					queueMicrotask(() => this.openBarMenu(row, node, bar, action.choices));
					return;
				}
				if (action.id === 'fit') this.rememberPeriod(row);
				action.run();
				if (action.id === 'reset') {
					const layer = this.editor.layerManager.getLayerById(row.layerId);
					if (layer.loopOriginalPeriods) {
						delete layer.loopOriginalPeriods[row.key];
						if (!Object.keys(layer.loopOriginalPeriods).length) delete layer.loopOriginalPeriods;
					}
				}
				this.renderTiming(row);
				this.commitTiming(action.label);
			});
			item.textContent = action.label;
			item.setAttribute('role', 'menuitem');
			panel.appendChild(item);
		}
		node.appendChild(panel);
		this.menuPanel = panel;
		this.menu = setupMenuPopover({ root: node, trigger: bar, panel, fixed: true, bindTrigger: false });
		this.menu.open();
	}

	rememberPeriod(row) {
		const layer = this.editor.layerManager.getLayerById(row.layerId);
		layer.loopOriginalPeriods ||= {};
		layer.loopOriginalPeriods[row.key] ??= row.cycleMs;
	}

	bindGestures() {
		this.host.addEventListener('click', event => {
			if (this.suppressClick) { event.preventDefault(); event.stopPropagation(); this.suppressClick = false; }
		}, true);
		this.stage.addEventListener('pointerdown', event => {
			if (event.button !== 0 || !this.available || this.host.classList.contains('is-stale') || this.drag) return;
			const target = event.target.closest('[data-drag]');
			if (!target) return;
			this.keyRecording.end();
			const node = target.closest('.timeline-row');
			const row = this.rowFor(node);
			let kind = target.dataset.drag;
			if (kind !== 'loop') {
				if (!this.canEdit(row)) {
					// The click still selects; a locked layer says why nothing moves.
					const layer = row && this.editor.layerManager.getLayerById(row.layerId);
					if (layer && isLayerFullyLocked(layer)) this.editor.canEditLayer(layer, { notify: true });
					return;
				}
				// Alt picks slip over move here, and means nothing more to that drag.
				if (kind === 'body') kind = TimelineView.bodyDrag(row, event.altKey);
				if (!kind || !row.can[{ left: 'run', right: 'run', move: 'run', slip: 'phase', period: 'period' }[kind]]) return;
			}
			event.preventDefault();
			this.menu?.close();
			node?.querySelector('.timeline-bar').focus({ preventScroll: true });
			const track = kind === 'loop' ? this.rulerTrack : node.querySelector('.timeline-track');
			const initial = kind === 'loop' ? { ...this.editor.documentLoop } : kind === 'period' ? row.cycleMs : kind === 'slip' ? row.phase : { ...row.source.run };
			this.drag = { kind, row, node, initial, loopMs: this.model.loopMs, trackLeft: track.getBoundingClientRect().left, x: event.clientX, pointerId: event.pointerId, notch: Number(target.dataset.notchIndex), moved: false };
		});
		window.addEventListener('pointermove', event => {
			const drag = this.drag;
			if (!drag || event.pointerId !== drag.pointerId) return;
			if (!this.available) { this.finishDrag(true); return; }
			if (!drag.moved && Math.abs(event.clientX - drag.x) < this.config.dragThresholdPx) return;
			if (!drag.moved) {
				this.stage.setPointerCapture(event.pointerId);
				this.frameView.invalidate();
				this.frameView.blocked = true;
				this.host.dataset.dragging = drag.kind;
				drag.node?.classList.add('is-dragging');
			}
			drag.moved = true;
			const { row, kind } = drag;
			const delta = TimelineView.xToTime(event.clientX - drag.x, this.scale);
			let time = TimelineView.xToTime(event.clientX - drag.trackLeft, this.scale);
			const snap = PREFERENCES.get('timelineSnap') && (kind === 'slip' || !event.altKey);
			const threshold = TimelineView.xToTime(this.config.snapPx, this.scale);
			// What the value snapped to, while that still holds after clamping.
			let value, target = null;
			const snapped = (wanted, targets, within) => {
				const result = snap ? TimelineView.snapTime(wanted, targets, within) : { ms: wanted, target: null };
				target = result.target;
				return result.ms;
			};
			if (kind === 'slip') {
				value = snapped(TimelineView.phaseFromSlip(row, delta), TimelineView.snapTargets(this.model, row, kind), threshold / row.cycleMs) % 1;
			} else if (kind === 'period') {
				const wanted = snapped(TimelineView.periodFromNotch(row, drag.notch, time), TimelineView.snapTargets(this.model, row, kind), threshold / Math.max(1, drag.notch - row.phase));
				value = clampNumber(wanted, row.source.periodRange.min, row.source.periodRange.max);
				if (row.source.resolvePeriod) value = row.source.resolvePeriod(value);
				if (value !== wanted) target = null;
			} else {
				if (kind === 'move') time = row.startMs + delta;
				const wanted = time = snapped(time, TimelineView.snapTargets(this.model, row, kind, this.editor.animationTicker.getPlayheadTime()), threshold);
				if (kind === 'move' || kind === 'left') time = clampNumber(time, 0, FIELDS.animDelay.max * 1000);
				if (time !== wanted) target = null;
				if (kind === 'loop') value = { mode: 'set', durationMs: time };
				else if (kind === 'right') value = TimelineView.runFromRightEdge(row, time, this.model.loopMs);
				else if (kind === 'left') value = TimelineView.runFromLeftEdge(row, time);
				else value = TimelineView.runFromBodyMove(row, time - row.startMs);
			}
			this.writeDrag(drag, value);
			this.paintDrag(drag, value, target);
		});
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) window.addEventListener(type, event => {
			if (event.pointerId === this.drag?.pointerId) this.finishDrag(type !== 'pointerup');
		});
		document.addEventListener('keydown', event => {
			if (event.key !== 'Escape' || (!this.drag && !this.frameView.exact && !this.frameView.done)) return;
			event.preventDefault(); event.stopPropagation(); this.finishDrag(true); this.frameView.invalidate();
		}, true);
		this.stage.addEventListener('dblclick', event => {
			if (event.target.closest('.timeline-loop-end') && this.available && !this.host.classList.contains('is-stale')) this.editor.setDocumentLoop(CONFIG.project.loop);
		});
	}

	writeDrag(drag, value) {
		drag.value = value;
		if (drag.kind === 'loop') this.editor.setDocumentLoop(value, { commit: false });
		else {
			const setter = { slip: 'setPhase', period: 'setPeriod' }[drag.kind] || 'setRun';
			drag.row.source[setter](value);
			this.renderTiming(drag.row);
		}
	}

	paintDrag(drag, value, target) {
		const { kind } = drag;
		// Where the dragged edge is, and where the snap landed, in time.
		let edge, guide = target?.ms, anchor = drag.node;
		if (kind === 'loop') {
			edge = this.editor.documentLoop.durationMs;
			this.stage.style.setProperty('--timeline-loop-x', `${TimelineView.timeToX(edge, this.scale)}px`);
			anchor = this.ruler;
		} else {
			const row = { ...drag.row };
			if (kind === 'slip') { row.phase = value; guide = null; }
			else if (kind === 'period') { row.cycleMs = row.exportCycleMs = value; edge = guide = row.startMs + (drag.notch - row.phase) * value; }
			else { row.startMs = value.start; row.endMs = Math.min(value.end, this.model.loopMs); }
			const bar = drag.node.querySelector('.timeline-bar');
			this.placeBar(drag.node, bar, row);
			bar.querySelector('.timeline-bar-marks').replaceWith(this.buildMarks(row, row.startMs, row.endMs));
			edge ??= kind === 'right' ? row.endMs : row.startMs;
		}
		const text = kind === 'loop' ? TimelineView.dragReadout(kind, null, edge, drag.initial.durationMs ?? drag.loopMs, target)
			: TimelineView.dragReadout(kind, drag.row, value, drag.initial, target);
		this.paintDragFeedback(text, edge, anchor, target ? guide : null);
	}

	// The readout sits above the dragged edge, inside the dock; the guide marks
	// the moment a snap landed on. The key lane draws its drags through here too.
	paintDragFeedback(text, edgeMs, anchor, guideMs) {
		if (!this.dragReadout) { this.dragReadout = this.element('timeline-drag-readout badge'); this.host.appendChild(this.dragReadout); }
		this.dragReadout.textContent = text;
		const box = this.host.getBoundingClientRect();
		const origin = this.stage.getBoundingClientRect().left + this.labelColumn - this.body.scrollLeft - box.left;
		const x = origin + TimelineView.timeToX(edgeMs, this.scale);
		this.dragReadout.style.left = `${Math.min(this.host.clientWidth - this.dragReadout.offsetWidth, Math.max(0, x))}px`;
		this.dragReadout.style.top = `${Math.max(0, anchor.getBoundingClientRect().top - box.top - this.dragReadout.offsetHeight)}px`;
		const guideX = guideMs == null ? -1 : TimelineView.timeToX(guideMs, this.scale) - this.body.scrollLeft;
		this.snapGuide.hidden = guideX < 0;
		if (guideX >= 0) this.snapGuide.style.transform = `translateX(${guideX}px)`;
	}

	clearDragFeedback() {
		this.dragReadout?.remove(); this.dragReadout = null;
		this.snapGuide.hidden = true;
	}

	finishDrag(cancelled) {
		const drag = this.drag;
		if (!drag) return;
		this.drag = null;
		this.clearDragFeedback();
		delete this.host.dataset.dragging;
		drag.node?.classList.remove('is-dragging');
		if (this.stage.hasPointerCapture(drag.pointerId)) this.stage.releasePointerCapture(drag.pointerId);
		if (!drag.moved) {
			if (cancelled) {
				this.suppressClick = true;
				setTimeout(() => { this.suppressClick = false; }, 0);
			}
			return;
		}
		this.suppressClick = true;
		setTimeout(() => { this.suppressClick = false; }, 0);
		if (cancelled) this.writeDrag(drag, drag.initial);
		else if (JSON.stringify(drag.value) !== JSON.stringify(drag.initial)) this.commitTiming({ left: 'Trim animation', right: 'Trim animation', move: 'Move animation', slip: 'Slip animation', period: 'Change animation speed', loop: 'Set loop length' }[drag.kind]);
		this.frameView.seek();
		this.editor.scheduleExportDuration();
		if (cancelled) this.editor.updateExportDuration();
	}

	nudgeRow(row, event) {
		if (!row.can.run || !this.available || isLayerFullyLocked(this.editor.layerManager.getLayerById(row.layerId))) return;
		const direction = event.key === 'ArrowRight' ? 1 : -1;
		const end = row.source.run.end;
		const next = event.shiftKey ? TimelineView.runFromRightEdge(row, (Number.isFinite(end) ? end : this.model.loopMs) + direction * row.cycleMs, this.model.loopMs)
			: TimelineView.runFromBodyMove(row, clampNumber(row.startMs + direction * (this.model.frameStarts[1] || row.cycleMs), 0, FIELDS.animDelay.max * 1000) - row.startMs);
		if (next.start === row.source.run.start && next.end === row.source.run.end) return;
		row.source.setRun(next);
		row.source.run = next; row.startMs = next.start; row.endMs = Math.min(next.end, this.model.loopMs);
		this.renderTiming(row);
		this.commitTiming(event.shiftKey ? 'Trim animation' : 'Move animation', { coalesceKey: this.editor.historyManager.burstCoalesceKey('timeline-nudge') });
	}

	selectMotion(layerId, index) {
		if (!this.available) return;
		this.pendingMotion = { layerId, index };
		this.syncSelection();
	}

	syncKeys() { if (this.available) this.keyLane.refresh(); }

	syncSelection() {
		if (this.pendingMotion) {
			const { layerId, index } = this.pendingMotion;
			const row = this.model?.groups.find(group => group.layerId === layerId)?.rows.find(entry => entry.effectSlot === `animation-${index}`);
			if (row) { this.selectedKey = String(row.key); this.pendingMotion = null; }
		}
		if (this.selectedKey && !this.model?.groups.some(group => group.rows.some(row => String(row.key) === this.selectedKey))) {
			const layer = this.editor.layerManager.getActiveLayer();
			const group = this.model?.groups.find(entry => entry.layerId === layer?.id);
			const row = group?.rows.find(entry => entry.effectSlot === `animation-${this.editor.animationPanel._selectedIndex(layer)}`) || group?.rows[0];
			this.selectedKey = row ? String(row.key) : null;
		}
		for (const node of this.body.querySelectorAll('.timeline-row')) {
			const selected = node.dataset.sourceKey === this.selectedKey;
			node.classList.toggle('is-selected', selected);
			node.querySelector('.timeline-bar').setAttribute('aria-pressed', String(selected));
			const row = this.rowFor(node), lane = node.querySelector('.timeline-row-lane');
			const layer = this.editor.layerManager.getLayerById(row.layerId);
			const showKeys = selected && row.layerId === this.editor.activeLayerId && Boolean(row.source.keyTrack)
				&& row.source.keyTrack.entry === this.editor.animationPanel._selected(layer);
			if (!showKeys && lane === this.keyLane.host) this.keyLane.finish(true);
			lane.hidden = !showKeys;
			if (showKeys) this.keyLane.mount(row, lane);
		}
		for (const group of this.body.querySelectorAll('.timeline-group')) group.querySelector('.timeline-group-label').classList.toggle('active', group.dataset.layerId === this.editor.activeLayerId);
	}

	// What the focused bar can do, in the status bar.
	syncHint(row) {
		const text = row && this.canEdit(row) ? TimelineView.rowHint(row) : '';
		if (text === this.hint) return;
		this.hint = text;
		this.editor.updateStatus(text);
	}

	// A layer picked on the canvas or in the Layers list scrolls into view.
	revealActive() {
		const label = this.body.querySelector('.timeline-group-label.active');
		if (!label) return;
		const box = label.getBoundingClientRect();
		const view = this.body.getBoundingClientRect();
		if (box.top < view.top) this.body.scrollTop -= view.top - box.top;
		else if (box.bottom > view.bottom) this.body.scrollTop += box.bottom - view.bottom;
	}

	// Minimized, the dock is its bar: the transport and the readout stay.
	applyMinimized() {
		const minimized = PREFERENCES.get('timelineMinimized');
		this.host.classList.toggle('is-minimized', minimized);
		this.minimize.classList.toggle('collapsed', minimized);
		this.minimize.setAttribute('aria-expanded', String(!minimized));
		const label = minimized ? 'Expand timeline' : 'Collapse timeline';
		this.minimize.title = label;
		this.minimize.setAttribute('aria-label', label);
	}

	toggleMinimized() {
		PREFERENCES.set('timelineMinimized', !PREFERENCES.get('timelineMinimized'));
		this.applyMinimized();
		this.editor.viewport.handleWindowResize();
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
