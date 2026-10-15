'use strict';

class TimelineDock {
	constructor(editor, host) {
		this.editor = editor;
		this.host = host;
		this.config = CONFIG.ui.timeline;
		this.selectedKey = null;
		this.collapsed = new Map();
		this.rowsByKey = new Map();
		this.rowNodesByKey = new Map();
		this.curves = new Map();
		this.stale = false;
		host.style.setProperty('--timeline-label-min', `${this.config.labelMinWidth}px`);
		host.style.setProperty('--timeline-ruler-height', `${this.config.rulerHeight}px`);
		host.style.setProperty('--timeline-grip', `${this.config.gripPx}px`);
		this.resizeHandle = buildElement('timeline-resize-handle');
		// The same bar as a panel section: icon, name, detail, actions.
		this.header = buildElement('section-header section-header-with-action');
		this.title = buildElement('section-header-title', undefined, 'h3');
		const icon = buildElement('section-header-title-icon icon-wrapper sm', undefined, 'span');
		icon.appendChild(createIcon('timeline'));
		this.title.append(icon, buildElement('section-header-title-text', 'Timeline', 'span'));
		// What the export would write, and whether it closes.
		this.summary = buildElement('timeline-summary');
		this.summary.append(this.buildFrameReadout());
		const actions = buildElement('section-header-actions');
		const action = 'section-header-action btn-icon-simple icon-wrapper sm visible';
		// Shows the same state as the view menu's Pause motion.
		this.play = this.button(action, 'Pause motion', 'motion-pause', () => editor.setPlayback(editor.animationTicker.paused));
		this.time = buildElement('timeline-time', undefined, 'span');
		this.time.tabIndex = 0; this.time.setAttribute('role', 'button'); this.time.title = 'Go to time';
		this.time.addEventListener('keydown', event => { if (event.target === this.time && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); this.editTime(); } });
		this.time.addEventListener('click', () => this.editTime());
		const transport = buildElement('timeline-transport'); this.transport = transport;
		this.exact = this.button(action, 'Play exact export frames', 'frame', () => this.frameView.playExact());
		this.exact.setAttribute('aria-pressed', 'false');
		transport.append(this.play, this.exact, this.time);
		this.minimize = this.button(action, 'Collapse timeline', 'chevron-down', () => this.toggleMinimized());
		this.zoom = document.createElement('input'); this.zoom.type = 'range'; this.zoom.className = 'timeline-zoom';
		this.zoom.min = 0; this.zoom.max = 1; this.zoom.step = 'any'; this.zoom.setAttribute('aria-label', 'Timeline zoom');
		this.zoom.addEventListener('input', () => {
			const max = this.config.pxPerSecondStops.at(-1), value = Number(this.zoom.value);
			this.setZoom(value === 0 ? 'fit' : Math.exp(Math.log(this.fitScale) + value * Math.log(Math.max(this.fitScale, max) / this.fitScale)));
		});
		this.zoom.addEventListener('dblclick', () => this.setZoom('fit'));
		const windowActions = buildElement('timeline-window-actions');
		windowActions.append(this.minimize, this.button(action, 'Close timeline', 'x-mark', () => editor.toggleTimeline()));
		this.addAnimation = this.button(action, 'Add animation', 'plus', () => editor.addAnimation(editor.layerManager.getActiveLayer()));
		actions.append(this.addAnimation, this.zoom, this.buildOptionsMenu(), windowActions);
		this.header.append(this.title, transport, this.summary, actions);
		// The ruler stays above the scrolling rows and follows their sideways
		// scroll; the playhead is one line over both.
		this.ruler = buildElement('timeline-ruler');
		this.body = buildElement('timeline-body');
		this.playhead = buildElement('timeline-playhead');
		this.playheadTime = buildElement('timeline-playhead-time badge'); this.playhead.appendChild(this.playheadTime);
		this.hoverGuide = buildElement('timeline-hover-guide'); this.hoverGuide.hidden = true;
		this.hoverTime = buildElement('timeline-playhead-time badge'); this.hoverGuide.appendChild(this.hoverTime);
		this.labelHandle = buildElement('timeline-label-handle');
		this.stage = buildElement('timeline-stage');
		// Where a drag snapped, drawn like the playhead.
		this.snapGuide = buildElement('timeline-snap-guide'); this.snapGuide.hidden = true;
		this.stage.append(this.ruler, this.body, this.playhead, this.hoverGuide, this.snapGuide, this.labelHandle);
		const section = buildElement('timeline-section section');
		section.append(this.header, this.stage);
		host.replaceChildren(this.resizeHandle, section);
		this.frameView = editor.previewFrameView;
		window.addEventListener('playbackChanged', () => { this.syncPlayback(); this.syncClock(); });
		window.addEventListener('motionselectionchange', event => { const { layerId, motionId } = event.detail; this.selectedKey = GlitterAnimation.sourceKey(layerId, { id: motionId }); this.syncSelection(); this.syncKeys(); });
		window.addEventListener('animationChanged', event => { this.keyRecording.validate(); this.frameView.invalidate({ keepFrame: this.keyRecording.active }); if (this.available && !this.timingEdit) { this.expandLayer(event.detail.layerId); this.sync(this.editor.loopEstimate); } });
		this.keyLane = new TimelineKeyLane(this);
		this.keyRecording = editor.keyRecording;
		this.bindResize();
		this.bindLabelResize();
		this.host.addEventListener('wheel', event => {
			if (!event.ctrlKey && !event.metaKey && event.target.closest('.timeline-ruler') && this.available) {
				const pixels = VIEWPORT_INPUT.wheelPixels(event, { lineSize: this.config.wheelLinePx, pageSize: this.viewWidth });
				this.body.scrollLeft += pixels.x || pixels.y;
				event.preventDefault();
				return;
			}
			if ((!event.ctrlKey && !event.metaKey) || !this.available) return;
			event.preventDefault();
			event.stopPropagation();
			if (!this.hasTimedRows || !this.model?.loopMs || !event.deltaY) return;
			const box = this.body.getBoundingClientRect();
			const x = this.body.scrollLeft + clampNumber(event.clientX - box.left - this.labelColumn, 0, this.viewWidth);
			const pixels = VIEWPORT_INPUT.wheelPixels(event, { lineSize: this.config.wheelLinePx, pageSize: this.viewWidth });
			const zoom = TimelineView.wheelZoom(this.wheelTravel || 0, pixels.y, this.config.wheelZoomPx);
			this.wheelTravel = zoom.remainder;
			for (let step = 0; step < Math.abs(zoom.steps); step++) this.stepZoom(-Math.sign(zoom.steps), x);
		}, { passive: false, capture: true });
		this.bindPlayhead();
		this.bindGestures();
		this.bindStackReorder();
		bindLayerVisibilityStroke(editor, this.body);
		this.body.addEventListener('click', event => {
			if (!this.available || event.target.closest('.timeline-bar, .timeline-row-label, .timeline-group-header, .timeline-row-lane, button')) return;
			this.selectedKey = null; this.syncSelection();
		});
		this.observer = new ResizeObserver(() => {
			if (!this.available) return;
			if (!this.resizing) this.applyHeight(PREFERENCES.get('timelineHeight'));
			if (!this.resizingLabels) this.applyLabelWidth(PREFERENCES.get('timelineLabelWidth'));
			if (this.body.clientWidth !== this.builtWidth) this.requestResync();
		});
		this.observer.observe(host);
		// Reset Panels restores these from outside the dock.
		PREFERENCES.onChange('timelineHeight', value => {
			if (!this.available || this.resizing) return;
			this.applyHeight(value);
			this.editor.viewport.handleWindowResize();
		});
		PREFERENCES.onChange('timelineLabelWidth', value => { if (this.available && !this.resizingLabels) { this.applyLabelWidth(value); this.resync(); } });
		PREFERENCES.onChange('timelineShow', () => { this.applyShow(); this.resync(); });
		PREFERENCES.onChange('timelineSnap', () => this.syncViewChoices());
		PREFERENCES.onChange('timelineFollow', () => { this.followSuspended = false; this.syncViewChoices(); });
		window.addEventListener('layerChanged', () => {
			if (!this.available) return;
			if (!this.model?.groups.length) { this.resync(); return; }
			this.syncSelection();
			this.syncControls();
			this.revealActive();
		});
		window.addEventListener('interfaceThemeChanged', () => {
			if (!this.available || !this.rulerTicks) return;
			this.syncRulerStyle();
			this.paintRuler();
		});
	}


	button(className, label, icon, run) {
		return buildIconButton({ className, label, icon, onClick: event => { if (this.available) run(event); } });
	}

	// The frame count is a button: it lists the timings that would export
	// fewer frames, and is marked while one exists.
	buildFrameReadout() {
		const root = buildElement('timeline-frames app-menu');
		this.readout = buildElement('timeline-readout', undefined, 'button');
		this.readout.type = 'button'; this.readout.hidden = true;
		this.readout.setAttribute('aria-haspopup', 'menu');
		this.readout.setAttribute('aria-expanded', 'false');
		const panel = buildMenuPanel();
		root.append(this.readout, panel);
		this.frameMenu = setupMenuPopover({ root, trigger: this.readout, panel, fixed: true, beforeOpen: () => {
			this.editor.fillFrameOptionsMenu(panel);
			if (this.model && !this.model.exact) {
				panel.prepend(buildMenuItem({ label: TimelineView.SEAM_TEXT }));
			}
		} });
		return root;
	}

	// The header's one menu: the two whole-timeline actions, then what the
	// rows draw. The view choices are stored together as `timelineShow`.
	buildOptionsMenu() {
		const root = buildElement('section-header-action app-menu visible');
		const trigger = this.button('btn-icon-simple app-menu-trigger icon-wrapper sm', 'Timeline options', 'ellipsis-vertical', () => {});
		trigger.setAttribute('aria-haspopup', 'true');
		trigger.setAttribute('aria-expanded', 'false');
		const panel = buildMenuPanel();
		const item = (label, run) => buildMenuItem({ label, current: true, run: () => { if (this.available) run(); } });
		this.fit = item('Fit animations to loop', () => {
			if (!this.stale) this.editor.fitAnimationsToLoop();
		});
		const separator = buildMenuSeparator;
		this.viewChoices = ['timelineSnap', 'timelineFollow'].map((key, index) => {
			const button = item(index ? 'Follow playhead' : 'Snap', () => PREFERENCES.set(key, !PREFERENCES.get(key)));
			button.setAttribute('role', 'menuitemcheckbox'); button.dataset.preference = key;
			return button;
		});
		this.syncViewChoices();
		this.showItems = Object.entries(this.config.showLabels).map(([key, label]) => {
			const button = item(label, () => {
				PREFERENCES.set('timelineShow', { ...this.show, [key]: !this.show[key] });
			});
			button.dataset.show = key;
			button.setAttribute('role', 'menuitemcheckbox');
			return button;
		});
		panel.append(
			this.fit, separator(), ...this.viewChoices,
			separator(), buildMenuLabel('Show'), ...this.showItems
		);
		root.append(trigger, panel);
		this.optionsMenu = setupMenuPopover({ root, trigger, panel, fixed: true, keepOpenSelector: '[role="menuitemcheckbox"]' });
		this.applyShow();
		return root;
	}

	// The stored choices over the defaults, so a choice added later has a value.
	get show() { return { ...this.config.show, ...PREFERENCES.get('timelineShow') }; }

	// How much of the next pass the tracks draw past the loop line.
	get nextLoopShare() { return this.show.nextLoop ? this.config.nextLoopFraction : 0; }

	get showsFrames() { return this.show.frames; }

	applyShow() {
		const show = this.show;
		for (const button of this.showItems) {
			button.setAttribute('aria-current', String(show[button.dataset.show]));
			button.setAttribute('aria-checked', String(show[button.dataset.show]));
			this.host.classList.toggle(`shows-${button.dataset.show}`, show[button.dataset.show]);
		}
	}

	get isOpen() { return !this.host.hidden; }
	get available() { return this.isOpen && isFeatureAvailable('timeline'); }
	get hasTimedRows() { return this.model?.groups.some(group => group.rows.some(row => row.source)); }

	open() {
		if (!isFeatureAvailable('timeline')) return;
		const changed = !this.isOpen;
		this.host.hidden = false;
		document.addEventListener('keydown', this.onEscapeFrame, true);
		this.applyMinimized();
		this.applyHeight(PREFERENCES.get('timelineHeight'));
		this.applyLabelWidth(PREFERENCES.get('timelineLabelWidth'));
		this.sync(this.editor.loopEstimate);
		const activeLayer = this.editor.layerManager.getActiveLayer();
		if (activeLayer) this.editor.animationPanel.load(activeLayer);
		this.syncPlayback();
		if (changed) this.editor.viewport.handleWindowResize();
	}

	close() {
		if (!this.isOpen) return;
		this.scrubDrag.finish(true);
		this.stopEdgeScroll();
		this.keyLane.finish(true);
		this.finishDrag(true);
		this.menu?.close();
		this.frameMenu.close();
		this.optionsMenu.close();
		this.host.hidden = true;
		this.syncClock();
		this.editor.animationPanel.syncKeyAdd();
		if (this.resizeFrame != null) cancelAnimationFrame(this.resizeFrame);
		this.resizeFrame = null;
		document.removeEventListener('keydown', this.onEscapeFrame, true);
		this.editor.viewport.handleWindowResize();
	}

	syncPlayback() {
		const paused = this.editor.animationTicker.paused;
		if (!paused) this.followSuspended = false;
		const label = paused ? 'Resume motion' : 'Pause motion';
		this.play.title = label;
		this.play.setAttribute('aria-label', label);
		this.play.querySelector('use').setAttribute('href', paused ? '#icon-motion-play' : '#icon-motion-pause');
		this.keyLane.syncState();
	}

	syncClock() {
		const timed = this.available && this.hasTimedRows && this.model.loopMs > 0
			&& (!PREFERENCES.get('timelineMinimized') || this.frameView.exact || this.keyRecording.active);
		if (!timed) {
			this.unsubscribeTick?.(); this.unsubscribeTick = null;
			this.unsubscribeSeek?.(); this.unsubscribeSeek = null;
		} else if (!this.unsubscribeTick) {
			const ticker = this.editor.animationTicker;
			this.unsubscribeSeek = ticker.subscribeSeek(() => {
				this.frameView.seek();
			});
			this.unsubscribeTick = ticker.subscribeTick(ms => this.paintPlayhead(ms));
		}
	}

	// The ruler is the playhead's control: press or drag to move it, and with
	// focus Left and Right step one output frame and Home returns to the
	// start. Space plays and pauses from anywhere in the rows.
	bindPlayhead() {
		const ticker = this.editor.animationTicker;
		const hold = () => {
			if (!ticker.paused || !ticker.holding) this.editor.setPlayback(false);
		};
		const scrub = event => {
			const { loopMs, frameStarts } = this.model;
			const ms = TimelineView.xToTime(event.clientX - this.rulerTrack.getBoundingClientRect().left, this.scale);
			const inside = Math.max(0, Math.min(loopMs - 1, ms));
			// Alt suspends snapping for the drag.
			ticker.seek(event.altKey || !PREFERENCES.get('timelineSnap') ? inside : TimelineView.nearestFrameStart(frameStarts, inside));
		};
		this.scrubDrag = bindPointerDrag(this.stage, {
			canStart: event => this.available && this.model?.loopMs
				&& event.target.closest('.timeline-ruler-track') && !event.target.closest('.timeline-loop-end'),
			start: event => {
				this.rulerTrack.focus({ preventScroll: true });
				this.scrubPointer = event.pointerId;
				hold(); scrub(event);
				this.trackEdgePointer(event);
			},
			move: event => {
				if (!this.available || !this.model?.loopMs) { this.scrubDrag.finish(true); return; }
				scrub(event); this.trackEdgePointer(event);
			},
			end: () => { this.scrubPointer = null; this.stopEdgeScroll(); }
		});
		this.body.addEventListener('scroll', () => {
			const left = this.body.scrollLeft;
			if (left !== this.lastScrollLeft && left !== this.writtenScrollLeft && !ticker.paused) this.followSuspended = true;
			this.lastScrollLeft = left;
			this.syncScroll(left !== this.writtenScrollLeft);
		});
		this.bindEdgeScroll(scrub);
		this.stage.addEventListener('keydown', event => {
			if (!this.available || !this.model?.loopMs || event.ctrlKey || event.metaKey || event.altKey) return;
			const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
			if (event.key === ' ') this.editor.setPlayback(ticker.paused);
			else if (!event.target.closest('.timeline-ruler-track') || (!step && event.key !== 'Home')) return;
			else {
				hold();
				if (step) ticker.step(step); else ticker.goToStart();
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

	syncScroll(paintPlayhead = true) {
		if (!this.rulerTrack) return;
		this.rulerTrack.style.transform = `translateX(${-this.body.scrollLeft}px)`;
		this.paintRuler();
		if (paintPlayhead) this.paintPlayhead(this.editor.animationTicker.getPlayheadTime());
	}

	scrollToTimeX(left) {
		this.body.scrollLeft = clampNumber(left, 0, Math.max(0, this.body.scrollWidth - this.body.clientWidth));
		this.writtenScrollLeft = this.body.scrollLeft;
		this.lastScrollLeft = this.writtenScrollLeft;
	}

	revealTime(ms, { page = false } = {}) {
		if (!(this.viewWidth > 0) || this.body.scrollWidth <= this.body.clientWidth) return;
		const x = TimelineView.timeToX(ms, this.scale), left = this.body.scrollLeft;
		const margin = Math.min(this.config.followMarginPx, this.viewWidth / 2);
		if (x >= left && x <= left + this.viewWidth - margin) return;
		this.scrollToTimeX(page ? x - margin : TimelineView.revealScroll(x, x + margin, left, this.viewWidth));
	}

	// One clock scrolls all held timeline drags; their coordinates include its travel.
	bindEdgeScroll(scrub) {
		const stop = () => {
			cancelAnimationFrame(this.edgeFrame);
			this.edgeFrame = null; this.edgeEvent = null; this.stagePointer = null;
		};
		this.stopEdgeScroll = stop;
		const tick = now => {
			this.edgeFrame = null;
			if (!this.available || this.stagePointer == null || !this.edgeEvent || !(this.drag?.moved || this.keyLane.drag?.moved || this.scrubPointer != null)) return;
			const event = this.edgeEvent;
			const box = this.body.getBoundingClientRect();
			const left = box.left + this.labelColumn;
			const direction = event.clientX < left + this.config.edgeScrollPx ? -1 : event.clientX > box.right - this.config.edgeScrollPx ? 1 : 0;
			const before = this.body.scrollLeft;
			this.scrollToTimeX(before + direction * this.config.edgeScrollPxPerSecond * Math.min(now - this.edgeTime, 50) / 1000);
			this.edgeTime = now;
			if (this.body.scrollLeft !== before) {
				this.syncScroll();
				if (this.scrubPointer != null) scrub(event);
				else if (this.keyLane.drag) this.keyLane.move(event);
				else this.moveDrag(event);
			}
			this.edgeFrame = requestAnimationFrame(tick);
		};
		this.trackEdgePointer = event => {
			this.stagePointer = event.pointerId;
			this.edgeEvent = event;
			if (this.edgeFrame == null) { this.edgeTime = performance.now(); this.edgeFrame = requestAnimationFrame(tick); }
		};
	}

	// The ticks are drawn for the stretch in view only: a canvas as wide as a
	// long loop at a close zoom is more than a browser will allocate.
	paintRuler() {
		const { canvas, text, line, font } = this.rulerTicks;
		const height = this.config.rulerHeight;
		const ratio = window.devicePixelRatio || 1;
		const left = this.body.scrollLeft;
		const width = Math.max(0, Math.min(this.trackWidth - left, this.ruler.clientWidth - this.labelColumn));
		const pixelWidth = Math.ceil(width * ratio), pixelHeight = Math.ceil(height * ratio);
		if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
		if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
		canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
		canvas.style.transform = `translateX(${left}px)`;
		const ctx = canvas.getContext('2d');
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(ratio, 0, 0, ratio, -left * ratio, 0);
		ctx.font = font;
		ctx.textBaseline = 'middle';
		const { major, minor } = TimelineView.tickStep(this.scale, this.config);
		const strip = this.showsFrames ? this.config.outputFrameStripHeight : 0;
		const tickBottom = height - strip;
		const end = Math.min(this.model.loopMs * (1 + this.nextLoopShare), TimelineView.xToTime(left + width, this.scale));
		// From the step before the left edge: its label may still be in view.
		for (let ms = Math.floor(TimelineView.xToTime(left, this.scale) / major) * major; ms < end; ms += minor) {
			const x = TimelineView.timeToX(ms, this.scale);
			const labeled = ms % major === 0;
			if (labeled) {
				ctx.fillStyle = text;
				ctx.fillText(TimelineView.tickLabel(ms), x + this.config.rulerTextInsetPx, tickBottom / 2);
			}
			ctx.fillStyle = line;
			const tickHeight = labeled ? tickBottom : this.config.minorTickHeight;
			ctx.fillRect(x, tickBottom - tickHeight, 1, tickHeight);
		}
		if (strip) for (const cell of TimelineView.frameCells(this.model.frameStarts, this.model.loopMs, this.scale, this.config.minTickPx)) {
			const x = TimelineView.timeToX(cell.start, this.scale), right = TimelineView.timeToX(cell.end, this.scale);
			if (right <= left || x >= left + width) continue;
			ctx.fillStyle = cell.plain || cell.index % 2 === 0 ? line : text;
			ctx.fillRect(x, tickBottom, right - x, strip);
		}
	}

	paintPlayhead(ms) {
		if (!this.available || !this.rulerTrack) return;
		if (PREFERENCES.get('timelineMinimized')) {
			this.keyRecording.paint(ms);
			if (this.frameView.exact || this.keyRecording.active) this.frameView.paint(ms);
			return;
		}
		const paused = this.editor.animationTicker.paused;
		const moved = ms !== this.lastPlayheadMs;
		if (PREFERENCES.get('timelineFollow') && this.stagePointer == null && !this.host.classList.contains('is-minimized')) {
			const x = TimelineView.timeToX(ms, this.scale), left = this.body.scrollLeft;
			const inside = x >= left && x <= left + this.viewWidth - this.config.followMarginPx;
			if (inside) this.followSuspended = false;
			if (!inside && !this.followSuspended && (!paused || moved)) this.revealTime(ms, { page: !paused });
		}
		this.lastPlayheadMs = ms;
		this.editor.animationPanel.paintKeyAdd(ms);
		this.keyRecording.paint(ms);
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
		const index = indexAtOrBefore(starts, ms);
		if (index !== this.frameIndex) {
			this.frameIndex = index;
			this.frameStart = index < 0 ? ms : starts[index];
			const width = index < 0 ? 0 : TimelineView.timeToX((starts[index + 1] ?? loopMs) - starts[index], this.scale);
			this.playhead.style.setProperty('--timeline-frame-width', `${width}px`);
		}
		this.playhead.style.setProperty('--timeline-frame-left', `${TimelineView.timeToX(this.frameStart - Math.min(ms, loopMs), this.scale)}px`);
		const rest = this.editor.animationTicker.paused && (this.frameView.blocked || this.editor.animationTicker.restPreview || !this.editor.animationTicker.holding);
		this.host.classList.toggle('shows-rest', rest);
		this.playheadTime.hidden = this.scrubPointer == null && !this.drag;
		const hundredth = Math.round(ms / 10);
		if (this.displayTime === hundredth && this.displayLoop === loopMs && this.displayRest === rest) return;
		this.displayTime = hundredth; this.displayLoop = loopMs; this.displayRest = rest;
		const text = `${formatSeconds(ms, { unit: false })} / ${formatSeconds(loopMs)}${rest ? ' · rest pose' : ''}`;
		if (this.time.querySelector('input') || this.time.textContent === text) return;
		this.time.textContent = text;
		this.playheadTime.textContent = formatSeconds(ms);
		this.rulerTrack.setAttribute('aria-valuenow', formatSeconds(ms, { unit: false }));
		this.rulerTrack.setAttribute('aria-valuetext', formatSeconds(ms));
	}

	applyHeight(value) {
		const max = Math.max(this.config.minHeight, this.host.parentElement.clientHeight * this.config.maxHeightFraction);
		const height = Math.round(Math.max(this.config.minHeight, Math.min(max, value)));
		this.host.style.setProperty('--timeline-height', `${height}px`);
		this.syncHeightSeparator(this.config.minHeight, Math.round(max), height);
		return height;
	}

	bindResize() {
		const handle = this.resizeHandle;
		const refit = () => this.editor.viewport.handleWindowResize();
		this.syncHeightSeparator = bindSizeHandle(handle, {
			orientation: 'horizontal', label: 'Resize timeline', direction: -1,
			canUse: () => this.available, read: () => this.host.getBoundingClientRect().height,
			apply: value => this.applyHeight(value), persist: value => PREFERENCES.set('timelineHeight', value),
			reset: () => PREFERENCES.reset('timelineHeight'),
			onChange: phase => { this.resizing = phase === 'start' || phase === 'move'; refit(); }
		});
	}

	// The label column, as wide as the stored preference where the dock has
	// the room.
	applyLabelWidth(value) {
		const max = Math.max(this.config.labelMinWidth, this.host.clientWidth * this.config.labelMaxFraction);
		const width = Math.round(Math.max(this.config.labelMinWidth, Math.min(max, value)));
		this.host.style.setProperty('--timeline-label-width', `${width}px`);
		this.syncLabelSeparator(this.config.labelMinWidth, Math.round(max), width);
		return width;
	}

	bindLabelResize() {
		const handle = this.labelHandle;
		const current = () => Number(handle.getAttribute('aria-valuenow'));
		this.syncLabelSeparator = bindSizeHandle(handle, {
			orientation: 'vertical', label: 'Resize timeline labels', bodyClass: 'is-resizing-panel',
			canUse: () => this.available, read: current, apply: value => this.applyLabelWidth(value),
			persist: value => PREFERENCES.set('timelineLabelWidth', value),
			reset: () => PREFERENCES.reset('timelineLabelWidth'),
			onChange: phase => {
				this.resizingLabels = phase === 'start' || phase === 'move';
				if (!this.resizingLabels) this.resync();
			}
		});
	}

	resync() {
		if (!this.available) return;
		if (this.editor.loopEstimate) this.sync(this.editor.loopEstimate);
		else this.markStale();
	}

	requestResync() {
		if (this.resizeFrame != null) return;
		this.resizeFrame = requestAnimationFrame(() => { this.resizeFrame = null; this.resync(); });
	}

	markStale() {
		if (!this.available) return;
		this.keyLane.finish(true);
		this.keyRecording.validate();
		this.frameView.invalidate({ keepFrame: this.keyRecording.active });
		this.stale = true;

		clearTimeout(this.staleTimer);
		this.staleTimer = setTimeout(() => { if (this.stale) this.host.classList.add('is-stale'); }, this.config.staleShowMs);
		this.frameMenu.close();
		this.readout.disabled = true;
		this.fit.disabled = true;
		this.keyLane.syncState();
		this.editor.animationPanel.syncKeyAdd();
	}

	syncControls() {
		if (!this.available) return;
		this.transport.hidden = !this.hasTimedRows;
		this.zoom.hidden = !this.hasTimedRows;
		const layer = this.editor.layerManager.getActiveLayer();
		const reason = !layer ? 'Select a layer to add an animation' : !isAnimatableLayerType(layer.type) ? 'This layer cannot take animations'
			: !this.editor.canEditLayer(layer) ? 'Unlock the layer to add an animation'
				: (layer.animations?.length || 0) >= CONFIG.tools.animation.maxStackSize ? 'The animation stack is full' : '';
		this.addAnimation.disabled = Boolean(reason); this.addAnimation.title = reason || 'Add animation';
		this.editor.animationPanel.syncKeyAdd();
		this.fit.disabled = this.stale || !this.editor.getLoopCandidate()?.canApply;
		this.exact.disabled = this.stale || !this.hasTimedRows || !this.model?.loopMs;
		this.zoom.disabled = !this.hasTimedRows || !this.model?.loopMs || this.fitScale >= this.config.pxPerSecondStops.at(-1);
		const range = Math.log(this.config.pxPerSecondStops.at(-1) / this.fitScale);
		this.zoom.value = range > 0 ? Math.max(0, Math.min(1, Math.log(this.scale / this.fitScale) / range)) : 0;
		this.zoom.title = this.scale <= this.fitScale ? 'Zoom to fit; double-click to fit' : `${Math.round(this.scale)} px/s; double-click to fit`;
	}

	sync(estimate) {
		if (!this.available) return;
		if (this.drag || this.keyLane.drag || this.isStackReordering()) { this.syncPending = true; return; }
		this.syncPending = false;
		const model = TimelineView.buildModel(estimate, this.editor.layers, this.editor);
		const signature = [this.editor.documentRevision, this.editor.loopAnalysisRevision, ...Object.values(this.show), ...this.editor.layers.map(layer => `${layer.id}:${layer.visible}:${layer.locked}:${layer.animationsEnabled}`)].join('|');
		const unchanged = signature === this.modelSignature && !this.rowsPending && Boolean(this.body.querySelector('.timeline-group'));
		this.modelSignature = signature;
		for (const group of model.groups) for (let index = 0; index < group.rows.length; index++) {
			const fresh = group.rows[index], previous = this.rowsByKey.get(String(fresh.key));
			if (previous) { Object.assign(previous, fresh); group.rows[index] = previous; }
		}
		if (this.modelDocumentRevision !== this.editor.documentRevision) { this.menu?.close(); this.frameMenu.close(); }
		this.modelDocumentRevision = this.editor.documentRevision;
		this.model = model;
		this.rowsByKey = new Map(this.model.groups.flatMap(group => group.rows).map(row => [String(row.key), row]));
		clearTimeout(this.staleTimer);

		this.host.classList.remove('is-stale');
		this.stale = false;
		this.syncReadout(estimate);
		this.syncClock();
		if (PREFERENCES.get('timelineMinimized')) {
			this.rowsPending = true;
			this.syncControls();
			return;
		}
		this.rowsPending = false;
		if (unchanged) {
			this.relayout(); this.syncSelection(); this.syncControls(); return;
		}
		const scrollTop = this.body.scrollTop;
		const scrollLeft = this.body.scrollLeft;
		const rulerFocused = Boolean(this.rulerTrack) && document.activeElement === this.rulerTrack;
		const focusedKey = document.activeElement?.closest('.timeline-row')?.dataset.sourceKey;
		const rowFocused = document.activeElement?.matches('.timeline-row');
		const focusedLayerId = document.activeElement?.closest('.timeline-group-label')?.dataset.layerId;
		const keyWasFocused = Boolean(document.activeElement?.closest('.timeline-key-track'));
		this.rulerTrack = null;
		this.rulerTicks = null;
		this.ruler.replaceChildren();
		this.ruler.hidden = false;
		this.playhead.hidden = true;
		this.snapGuide.hidden = true;
		this.labelHandle.hidden = true;
		this.frameIndex = null;
		this.time.textContent = ''; this.displayTime = null;
		this.rowNodesByKey.clear();
		this.hasRows = this.model.groups.some(group => group.rows.length);
		this.stage.classList.toggle('is-empty', !this.hasRows);
		if (!this.hasTimedRows && !this.editor.layers.some(layer => layer.animations?.length)) this.ruler.appendChild(buildElement('property-note', 'Nothing moves yet. Select a layer and press + to add an animation.'));
		if (!this.model.groups.length) {
			reconcileKeyedChildren(this.body, [], { key: group => group.layerId, build: group => this.buildGroup(group) });
			this.syncControls();
			return;
		}
		const { loopMs } = this.model;
		this.labelHandle.hidden = !this.hasRows;
		// With every animated layer hidden there are rows and nothing to time.
		const timed = loopMs > 0 && this.hasTimedRows;
		this.measure();
		if (timed) {
			this.ruler.appendChild(this.buildRuler());
			this.ruler.hidden = false;
		}
		reconcileKeyedChildren(this.body, this.model.groups, {
			key: group => group.layerId, build: group => this.buildGroup(group), reuse: (node, group) => this.reuseGroup(node, group)
		});
		for (const key of this.curves.keys()) if (!this.rowsByKey.has(String(key))) this.curves.delete(key);
		this.body.scrollTop = scrollTop;
		this.scrollToTimeX(scrollLeft);
		if (rulerFocused) this.rulerTrack?.focus({ preventScroll: true });
		if (focusedKey) {
			const row = this.rowNodesByKey.get(focusedKey);
			(rowFocused ? row : row?.querySelector('.timeline-bar'))?.focus({ preventScroll: true });
		}
		if (focusedLayerId) this.body.querySelector(`[data-layer-id="${focusedLayerId}"] .timeline-group-label`)?.focus({ preventScroll: true });
		this.syncScroll();
		this.syncControls();
		this.syncSelection();
		if (keyWasFocused) this.keyLane.focusSelected();
		this.paintPlayhead(this.editor.animationTicker.getPlayheadTime());
	}

	syncReadout(estimate) {
		this.readout.hidden = true;
		this.readout.disabled = false;
		const { loopMs, frameCount, outputFormat, exact, groups } = this.model;
		if (!this.hasTimedRows || !groups.length || !(loopMs > 0)) return;
		const optimizable = estimate?.frameOptions?.optimizable;
		this.readout.replaceChildren();
		if (!exact || optimizable) this.readout.appendChild(createIcon('triangle-exclamation'));
		this.readout.appendChild(buildElement('timeline-readout-text', `${frameCount} frames · ${(outputFormat || 'gif').toUpperCase()}`, 'span'));
		this.readout.hidden = false;
		this.readout.classList.toggle('is-warning', !exact || optimizable);
		this.readout.title = [!exact ? TimelineView.SEAM_TEXT : '',
			optimizable ? 'A change of timing would export fewer frames.' : '', 'Press for frame options.'].filter(Boolean).join(' ');
		this.readout.setAttribute('aria-label', `${frameCount} frames · ${(outputFormat || 'gif').toUpperCase()}. ${this.readout.title}`);
	}

	editTime() {
		if (this.time.querySelector('input')) return;
		const input = document.createElement('input'); input.type = 'number'; input.step = '0.01'; input.min = '0'; input.max = String(this.model.loopMs / 1000);
		input.value = String(Number((this.editor.animationTicker.getPlayheadTime() / 1000).toFixed(2))); input.setAttribute('aria-label', 'Time in seconds');
		let finished = false;
		const finish = apply => {
			if (finished) return; finished = true;
			const seconds = input.valueAsNumber; this.time.replaceChildren(); this.displayTime = null;
			if (apply && Number.isFinite(seconds)) { this.editor.setPlayback(false); this.editor.animationTicker.seek(clampNumber(seconds * 1000, 0, this.model.loopMs - 1)); }
			this.paintPlayhead(this.editor.animationTicker.getPlayheadTime());
		};
		input.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finish(event.key === 'Enter'); } });
		input.addEventListener('blur', () => finish(false)); this.time.replaceChildren(input); input.focus(); input.select();
	}

	buildRuler() {
		const view = buildElement('timeline-ruler-view');
		const track = buildElement('timeline-ruler-track');
		track.tabIndex = 0;
		track.setAttribute('role', 'slider');
		track.setAttribute('aria-label', 'Playhead');
		track.setAttribute('aria-valuemin', '0');
		track.setAttribute('aria-valuemax', formatSeconds(this.model.loopMs, { unit: false }));
		this.rulerTrack = track;
		const canvas = document.createElement('canvas'); canvas.className = 'timeline-ruler-ticks';
		this.rulerTicks = { canvas };
		this.syncRulerStyle();
		const loop = buildElement('timeline-loop-end', formatSeconds(this.model.loopMs));
		loop.dataset.drag = 'loop';
		loop.title = 'Drag to set loop length; double-click for Automatic';
		loop.prepend(createIcon('repeat'));
		track.addEventListener('pointermove', event => {
			if (this.scrubPointer != null || this.drag) { this.hoverGuide.hidden = true; return; }
			const x = clampNumber(event.clientX - track.getBoundingClientRect().left, 0, this.trackWidth);
			this.hoverGuide.hidden = false; this.hoverGuide.style.transform = `translateX(${x - this.body.scrollLeft}px)`;
			this.hoverTime.textContent = formatSeconds(TimelineView.xToTime(x, this.scale));
		});
		track.addEventListener('pointerleave', () => { this.hoverGuide.hidden = true; });
		track.addEventListener('contextmenu', event => {
			event.preventDefault();
			const ms = clampNumber(TimelineView.xToTime(event.clientX - track.getBoundingClientRect().left, this.scale), 0, this.model.loopMs * (1 + this.nextLoopShare));
			this.menu = openActionMenu({ root: view, trigger: track, actions: [
				{ label: 'Move playhead here', run: () => { this.editor.setPlayback(false); this.editor.animationTicker.seek(ms); } },
				{ label: 'Set loop end here', disabled: ms <= 0, run: () => this.editor.setDocumentLoop({ mode: 'set', durationMs: ms }) },
				{ label: 'Automatic loop length', checked: this.editor.documentLoop.mode === 'auto', run: () => this.editor.setDocumentLoop(CONFIG.project.loop) },
				{ label: 'Zoom to fit', run: () => this.setZoom('fit') }
			], event });
		});
		track.append(canvas, loop);
		view.append(track);
		return view;
	}

	syncRulerStyle() {
		const style = getComputedStyle(this.host);
		Object.assign(this.rulerTicks, {
			text: style.getPropertyValue('--color-text-secondary'), line: style.getPropertyValue('--color-border'),
			font: `${style.getPropertyValue('--font-size-xs')} ${style.fontFamily}`
		});
	}

	expandLayer(layerId) {
		this.collapsed.delete(layerId);
		const node = [...this.body.children].find(group => group.dataset.layerId === String(layerId));
		if (!node) return;
		node.classList.remove('is-collapsed'); node._syncChevron();
		if (this.keyLane.host?.closest('.timeline-group') === node) {
			this.keyLane.syncState(); this.keyLane.paint(this.editor.animationTicker.getPlayheadTime());
		}
	}

	isStackReordering() {
		return isReordering(this.body) || [...this.body.querySelectorAll('.timeline-group-rows')].some(isReordering);
	}

	bindStackReorder() {
		const manager = this.editor.layerManager;
		bindListReorder(this.body, {
			item: '.timeline-group', handle: '.timeline-group-header .list-row-handle',
			rowIds: row => [row.dataset.layerId],
			ids: row => manager.isLayerSelected(row.dataset.layerId) ? [...manager.selectedLayerIds] : [row.dataset.layerId],
			canDrag: (row, event) => this.available && event.target.closest('.timeline-group-header')?.parentElement === row && canEditLayerInStack(manager.getLayerById(row.dataset.layerId)),
			resolve: ({ ids, target, place }) => {
				const drop = { targetId: target.dataset.layerId, place };
				return manager.canDropLayers(ids, drop) ? { ids, ...drop } : null;
			},
			commit: ({ ids, targetId, place }) => manager.moveLayers(ids, { targetId, place })
		});
		this.body.addEventListener('listreorderend', () => { if (this.syncPending && !this.isStackReordering()) this.resync(); });
	}

	buildGroup(group) {
		const node = buildElement('timeline-group'); node.dataset.layerId = group.layerId;
		node.classList.toggle('is-collapsed', Boolean(group.rows.length && this.collapsed.get(group.layerId)));
		node.classList.toggle('is-hidden', !group.visible); node.classList.toggle('is-locked', group.locked);
		const layer = this.editor.layerManager.getLayerById(group.layerId);
		const header = buildElement('timeline-group-header');
		const label = buildLayerRow(this.editor, layer, { variant: 'timeline' });
		const chevron = label.querySelector('.timeline-group-chevron');
		const syncChevron = () => {
			const collapsed = node.classList.contains('is-collapsed');
			chevron.setAttribute('aria-expanded', String(!collapsed));
			chevron.setAttribute('aria-label', `Toggle ${describeLayer(this.editor.layerManager.getLayerById(group.layerId), this.editor).name} timeline rows`);
			// An empty group has nothing to open: a disabled closed chevron.
			chevron.querySelector('use').setAttribute('href', collapsed || chevron.disabled ? '#icon-chevron-right' : '#icon-chevron-down');
		};
		chevron.addEventListener('click', () => {
			if (!this.available || chevron.disabled) return;
			const collapsed = !node.classList.contains('is-collapsed');
			this.collapsed.set(group.layerId, collapsed); node.classList.toggle('is-collapsed', collapsed); syncChevron();
			if (this.keyLane.host?.closest('.timeline-group') === node) {
				if (collapsed) this.keyLane.finish(true);
				else { this.keyLane.syncState(); this.keyLane.paint(this.editor.animationTicker.getPlayheadTime()); }
			}
		});
		label.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight');
		label.addEventListener('keydown', event => {
			if (event.target !== label || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
			event.preventDefault(); event.stopPropagation();
			if (node.classList.contains('is-collapsed') === (event.key === 'ArrowRight')) chevron.click();
		});
		node._syncChevron = syncChevron;
		header.append(label); node.appendChild(header);
		this.syncGroupChevron(node, group);
		const rows = buildElement('timeline-group-rows');
		this.reconcileRows(rows, group);
		node.appendChild(rows);
		this.layoutGroup(node, group);
		bindListReorder(rows, {
			item: '.timeline-row[data-motion-index]', handle: '.list-row-handle', scroller: this.body,
			ids: row => [Number(row.dataset.motionIndex)],
			keyboardFocus: next => next.to,
			canDrag: () => this.available && this.editor.canEditLayer(this.editor.layerManager.getLayerById(group.layerId)),
			resolve: ({ ids, target, place }) => {
				const from = ids[0], insertion = Number(target.dataset.motionIndex) + Number(place === 'below');
				const to = insertion - Number(from < insertion);
				return from !== to && to >= 0 && to < this.editor.layerManager.getLayerById(group.layerId).animations.length ? { from, to } : null;
			},
			commit: ({ from, to }) => this.editor.moveAnimation(this.editor.layerManager.getLayerById(group.layerId), from, to)
		});
		return node;
	}


	syncGroupChevron(node, group) {
		const empty = !group.rows.length, chevron = node.querySelector('.timeline-group-chevron');
		chevron.disabled = empty; chevron.setAttribute('aria-disabled', String(empty)); chevron.classList.toggle('is-empty', empty);
		if (empty) { this.collapsed.delete(group.layerId); node.classList.remove('is-collapsed'); }
		node._syncChevron();
		if (empty) chevron.removeAttribute('aria-expanded');
	}

	reuseGroup(node, group) {
		node.classList.toggle('is-hidden', !group.visible); node.classList.toggle('is-locked', group.locked);
		syncLayerRow(node.querySelector('.timeline-group-label'), this.editor.layerManager.getLayerById(group.layerId));
		node.querySelector('.timeline-group-chevron').setAttribute('aria-label', `Toggle ${group.name} timeline rows`);
		this.syncGroupChevron(node, group);
		this.reconcileRows(node.querySelector('.timeline-group-rows'), group);
		this.layoutGroup(node, group);
		return node;
	}

	reconcileRows(container, group) {
		const signature = row => [row.key, row.label, row.enabled, Boolean(row.source), Boolean(row.source?.keyTrack), group.locked, ...Object.values(row.can), ...Object.values(this.show)].join('|');
		const build = row => { const node = this.buildRow(row); node._rowSignature = signature(row); return node; };
		reconcileKeyedChildren(container, group.rows, {
			key: row => row.key, build,
			reuse: (node, row) => {
				if (node._rowSignature !== signature(row)) return build(row);
				if (row.animation) node.dataset.motionIndex = this.editor.layerManager.getLayerById(row.layerId).animations.indexOf(row.animation);
				this.rowNodesByKey.set(String(row.key), node);
				row.curve = this.resolveCurve(row);
				this.layoutRow(node, row); return node;
			}
		});
	}

	resolveCurve(row) {
		if (!row.source || !row.animation) return null;
		const signature = `${this.editor.animationRevisionEpoch}|${this.editor.animationRevisions?.get(row.key)}|${row.cycleMs}|${row.phase}|${row.direction}`;
		let cached = this.curves.get(row.curveKey);
		if (!cached || cached.signature !== signature) {
			cached = { signature, curve: TimelineView.motionCurve(row.source, row.cycleMs) }; this.curves.set(row.curveKey, cached);
		}
		return cached.curve;
	}

	buildRow(row) {
		row.curve = this.resolveCurve(row);
		const node = buildElement('timeline-row'); node.dataset.sourceKey = row.key;
		node.tabIndex = 0;
		node.classList.toggle('is-inactive', !row.source);
		node.classList.toggle('has-motion', Boolean(row.animation));
		if (row.animation) node.dataset.motionIndex = this.editor.layerManager.getLayerById(row.layerId).animations?.findIndex(animation => animation.id === TimelineView.motionId(row));
		this.rowNodesByKey.set(String(row.key), node);
		node.addEventListener('keydown', event => {
			if (!row.animation || !this.canEdit(row)) return;
			const layer = this.editor.layerManager.getLayerById(row.layerId), index = layer.animations.indexOf(row.animation);
			if (['Delete', 'Backspace'].includes(event.key)) this.editor.deleteAnimation(layer, index);
			else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') this.editor.duplicateAnimation(layer, index);
			else return; event.preventDefault(); event.stopPropagation();
		});
		const select = () => {
			this.selectedKey = String(row.key);
			const index = this.editor.layerManager.getLayerById(row.layerId).animations?.findIndex(animation => animation.id === TimelineView.motionId(row));
			if (index >= 0) this.editor.motionSelection.select(row.layerId, this.editor.layerManager.getLayerById(row.layerId)?.animations?.[index]?.id);
			this.editor.layerManager.setActiveLayer(row.layerId);
			this.editor.refreshInspector();
			this.openRowSection(row);
			this.syncSelection();
		};
		const label = buildElement('timeline-row-label');
		const name = buildElement('list-row-content', row.label); name.title = row.label;
		if (row.animation) {
			const layer = this.editor.layerManager.getLayerById(row.layerId);
			const grip = buildIconButton({ className: 'list-row-handle', label: `Reorder ${row.label}` });
			const mark = buildElement('drag-handle-mark', undefined, 'span'); mark.setAttribute('aria-hidden', 'true'); grip.append(mark);
			grip.disabled = !this.editor.canEditLayer(layer);
			const eye = this.button('btn-icon-simple icon-wrapper sm timeline-motion-enabled', row.enabled ? 'Hide animation' : 'Show animation', row.enabled ? 'eye' : 'eye-slash', () => this.editor.toggleAnimation(layer, layer.animations.findIndex(animation => animation.id === TimelineView.motionId(row))));
			eye.disabled = !this.editor.canEditLayer(layer); eye.setAttribute('aria-pressed', String(row.enabled));
			label.append(grip, eye);
		} else {
			const grip = buildElement('list-row-handle', undefined, 'span'); grip.setAttribute('aria-hidden', 'true'); label.append(grip);
			const slot = buildElement('icon-wrapper sm timeline-motion-placeholder', undefined, 'span');
			slot.setAttribute('aria-hidden', 'true'); label.append(slot);
		}
		label.append(name);
		label.addEventListener('click', event => { if (!event.target.closest('button')) select(); });
		node.addEventListener('keydown', event => { if (event.target === node && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); select(); } });
		const track = buildElement('timeline-track');
		const lane = buildElement('timeline-row-lane'); lane.hidden = true;
		if (!row.source) {
			const info = buildElement('timeline-row-info', TimelineView.rowInfo(row));
			node.append(label, track, info, lane);
			return node;
		}
		const bar = this.button(`timeline-bar is-${row.kind}`, `${row.label}: ${TimelineView.rowInfo(row)}`, null, select);
		bar.classList.toggle('is-seam', !row.closes);
		const body = TimelineView.bodyDrag(row, false);
		bar.classList.toggle('is-movable', body === 'move');
		bar.classList.toggle('is-slippable', body === 'slip');
		bar.title = TimelineView.barTitle(row, this.model.loopMs);
		const kindIcon = row.kind === 'authored' ? LAYER_UI_CONFIG[this.editor.layerManager.getLayerById(row.layerId).type]?.icon || 'glitter' : TimelineView.motionId(row) != null ? 'motion-play' : 'sparkles';
		const icon = buildElement('timeline-bar-icon icon-wrapper sm', undefined, 'span'); icon.append(createIcon(kindIcon)); bar.append(icon);
		bar.dataset.drag = 'body';
		for (const side of ['left', 'right']) if (TimelineView.edgeDrag(row, side)) {
			const handle = buildElement(`timeline-bar-handle is-${side}`, undefined, 'span');
			handle.dataset.drag = side;
			handle.title = TimelineView.handleTitle(row, side);
			bar.appendChild(handle);
		}
		bar.addEventListener('focus', () => this.syncHint(row));
		bar.addEventListener('blur', () => this.syncHint(null));
		bar.addEventListener('contextmenu', event => {
			event.preventDefault();
			const anchor = event.clientX || event.clientY ? { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY } : null;
			this.openBarMenu(row, node, bar, anchor);
		});
		bar.addEventListener('keydown', event => {
			if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
				event.preventDefault(); event.stopPropagation(); this.openBarMenu(row, node, bar);
			} else if (event.altKey && ['[', ']'].includes(event.key)) {
				event.preventDefault(); event.stopPropagation();
				const action = this.barActions(row).find(action => action.id === (event.key === '[' ? 'start' : 'end'));
				if (!this.canEdit(row) || !action || action.disabled) return;
				this.applyRowEdit(row, action.label, action.run);
			} else if (event.altKey || event.ctrlKey || event.metaKey) return;
			else if (event.key === 'Enter') {
				event.preventDefault(); event.stopPropagation(); select();
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
			const seam = buildElement('timeline-bar-seam');
			seam.title = TimelineView.seamTitle(row, this.model.loopMs); seam.appendChild(createIcon('triangle-exclamation'));
			track.appendChild(seam);
		}
		const info = buildElement('timeline-row-info', TimelineView.rowInfo(row)); info.title = bar.title;
		node.append(label, track, info, lane);
		this.layoutRow(node, row);
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

	buildMarks(row, start, end, marks = buildElement('timeline-bar-marks')) {
		marks.setAttribute('aria-hidden', 'true');
		const drawing = { ...row, cycleMs: row.exportCycleMs, endMs: end };
		const cyclePx = TimelineView.timeToX(drawing.cycleMs, this.scale);
		const atStart = TimelineView.timeToCycle({ ...drawing, endMs: Infinity }, Math.max(start, row.startMs));
		const rawProgress = TimelineView.isReversed(drawing, atStart.index) ? 1 - atStart.progress : atStart.progress;
		marks.style.setProperty('--motion-curve', row.curve || 'none');
		marks.style.setProperty('--cycle-px', `${cyclePx}px`);
		marks.style.setProperty('--cycle-offset-px', `${-rawProgress * cyclePx}px`);
		// A keyed motion's marks are its keys, repeated with each cycle.
		const keyed = Boolean(row.source.keyTrack);
		if (keyed ? !this.show.cycles : !this.showsFrames) { marks.replaceChildren(); return marks; }
		const positions = [...new Set([0, ...row.cycleMarks, 1])].sort((a, b) => a - b);
		const gap = Math.min(...positions.slice(1).map((value, index) => value - positions[index]));
		if (gap * cyclePx < this.config.minTickPx || Math.ceil((end - start) / drawing.cycleMs + 1) * row.cycleMarks.length > this.config.maxMarksPerBar) {
			marks.replaceChildren(); return marks;
		}
		const first = Math.floor((start - row.startMs) / drawing.cycleMs + row.phase);
		const last = Math.ceil((end - row.startMs) / drawing.cycleMs + row.phase);
		let count = 0;
		for (let index = first; index <= last; index++) {
			for (const progress of row.cycleMarks) {
				const ms = TimelineView.cycleToTime(drawing, index, progress);
				if (ms <= start || ms >= end) continue;
				const mark = marks.children[count] || buildElement(keyed ? 'timeline-key-dot' : 'timeline-cycle-mark');
				if (keyed) { const key = row.source.keyTrack.entry?.keys?.find(key => key.at === progress); mark.dataset.shape = ANIMATION_EASING_OPTIONS.find(option => option.value === (key?.easing || 'linear')).shape; }
				mark.style.left = `${TimelineView.timeToX(ms - start, this.scale)}px`;
				if (!mark.parentElement) marks.appendChild(mark);
				count++;
			}
		}
		while (marks.children.length > count) marks.lastElementChild.remove();
		return marks;
	}

	syncViewChoices() {
		for (const button of this.viewChoices) {
			const enabled = PREFERENCES.get(button.dataset.preference);
			button.setAttribute('aria-checked', String(enabled));
			button.setAttribute('aria-current', String(enabled));
		}
	}

	openRowSection(row) {
		const layer = this.editor.layerManager.getLayerById(row.layerId);
		const prefix = LAYER_UI_CONFIG[layer.type].transformPrefix;
		let section;
		if (TimelineView.motionId(row) != null) section = document.getElementById(`${prefix}AnimationSection`);
		else if (row.effectSlot) {
			section = document.querySelector(`#${prefix}SettingsSection [data-slot="${row.effectSlot}"]`)
				|| Array.from(document.querySelectorAll('.flyout-host:not([hidden]) [data-slot]'))
					.find(card => card.dataset.slot === row.effectSlot && card.id.startsWith(prefix));
		} else section = document.querySelector('.panel-controls.visible .section');
		if (!section) return;
		if (section.dataset.flyoutKey && this.editor.pickers.flyout !== section.dataset.flyoutKey) this.editor.pickers.toggleFlyout(section.dataset.flyoutKey);
		setPanelCardCollapsed(section, false);
		section.scrollIntoView({ block: 'nearest' });
	}

	rowFor(node) { return this.rowsByKey.get(node?.dataset.sourceKey); }

	resetDocumentView() { this.collapsed.clear(); }

	canEdit(row) {
		return this.available && row && (!isLayerFullyLocked(this.editor.layerManager.getLayerById(row.layerId)) || this.editor.layerManager.getLayerById(row.layerId).type === LayerType.BASE_IMAGE);
	}

	commitTiming(label, options) {
		this.timingCommit = true;
		try { this.editor.commitAnimationTiming(label, options); }
		finally { this.timingCommit = false; }
	}

	applyRowEdit(row, label, edit, options) {
		if (!this.canEdit(row)) return;
		this.timingEdit = true;
		try { edit(); } finally { this.timingEdit = false; }
		const target = listTimingTargets(this.editor).find(entry => entry.key === row.key);
		if (target) {
			row.cycleMs = row.exportCycleMs = target.period;
			row.phase = target.phase || 0; row.direction = target.direction || 'normal';
			row.startMs = target.run?.start || 0; row.endMs = Math.min(target.run?.end ?? Infinity, this.model.loopMs);
			row.source = { ...row.source, run: target.run, naturalPeriod: target.period };
			this.layoutRow(this.rowNodesByKey.get(String(row.key)), row);
		}
		this.renderTiming(row);
		this.commitTiming(label, options);
	}

	renderTiming(row) {
		this.frameView.invalidate();
		if (row) {
			const layer = this.editor.layerManager.getLayerById(row.layerId);
			getLayerManagerForType(this.editor, layer.type).renderLayer(layer);
		}
		this.editor.requestPreviewUpdate();
	}

	barActions(row) {
		const actions = this.editor.animationTimingActions(row.key, { live: true });
		const layer = this.editor.layerManager.getLayerById(row.layerId), index = layer.animations?.findIndex(animation => animation.id === TimelineView.motionId(row)), panel = this.editor.animationPanel;
		if (index >= 0) {
			const animation = layer.animations[index];
			if (GlitterAnimation.MOTION_REGISTRY[animation.type].convertible) actions.push({ id: 'convert', group: 'Animation', label: 'Convert to custom', commits: false, disabled: !panel.conversion(animation), run: () => this.editor.convertToCustom(layer, animation) });
			actions.push({ id: 'duplicate', group: 'Animation', label: 'Duplicate animation', disabled: layer.animations.length >= CONFIG.tools.animation.maxStackSize, commits: false, run: () => this.editor.duplicateAnimation(layer, index) }, { id: 'delete', group: 'Animation', label: 'Delete animation', commits: false, run: () => this.editor.deleteAnimation(layer, index) });
		}
		return actions;
	}

	openBarMenu(row, node, bar, anchor = null) {
		if (!this.canEdit(row)) return;
		if (!anchor) {
			const rect = bar.getBoundingClientRect(), view = this.body.getBoundingClientRect();
			const left = Math.max(rect.left, view.left + this.labelColumn);
			anchor = { left, right: left, top: rect.top, bottom: rect.bottom };
		}
		const actions = this.barActions(row);
		if (!actions.length) return;
		this.menu = openActionMenu({ root: node, trigger: bar, anchor, actions: actions.map(action => ({ ...action, run: () => {
			if (!this.canEdit(row)) return;
			if (action.commits === false) { action.run(); return; }
			this.applyRowEdit(row, action.commitLabel || action.label, () => {
				if (action.id === 'reset') this.editor.restoreAnimationPeriod(row.source);
				action.run();
			});
		} })) });
	}

	bindGestures() {
		this.pointerDrag = bindPointerDrag(this.stage, {
			threshold: this.config.dragThresholdPx, axis: 'x', clickHost: this.host,
			start: event => {
				if (!this.available || this.drag) return false;
				const target = event.target.closest('[data-drag]');
				if (!target) return false;
				this.keyRecording.end();
				const node = target.closest('.timeline-row');
				const row = this.rowFor(node);
				let kind = target.dataset.drag;
				if (kind !== 'loop') {
					if (!this.canEdit(row)) {
						// The click still selects; a locked layer says why nothing moves.
						const layer = row && this.editor.layerManager.getLayerById(row.layerId);
						if (layer && isLayerFullyLocked(layer)) this.editor.canEditLayer(layer, { notify: true });
						return false;
					}
					// Alt picks slip over move here, and means nothing more to that drag.
					if (kind === 'body') kind = TimelineView.bodyDrag(row, event.altKey);
					else if (kind === 'left' || kind === 'right') kind = TimelineView.edgeDrag(row, kind, event.shiftKey);
					if (!kind || !row.can[DRAG_KINDS[kind].capability]) return false;
				}
				event.preventDefault();
				this.menu?.close();
				node?.querySelector('.timeline-bar').focus({ preventScroll: true });
				const track = kind === 'loop' ? this.rulerTrack : node.querySelector('.timeline-track');
				const count = kind === 'duration' ? TimelineView.durationRepeats(row, this.model.loopMs, FIELDS.animIterations.max) : null;
				if (kind === 'duration' && !(count > row.phase)) return false;
				const initial = kind === 'loop' ? { ...this.editor.documentLoop }
					: kind === 'duration' ? { period: row.cycleMs, run: { ...row.source.run } }
						: kind === 'period' ? row.cycleMs : kind === 'slip' ? row.phase : { ...row.source.run };
				this.drag = {
					kind, row, node, initial, count, originalPeriods: row ? structuredClone(this.editor.layerManager.getLayerById(row.layerId).loopOriginalPeriods) : null, loopMs: this.model.loopMs, trackLeft: track.getBoundingClientRect().left,
					x: event.clientX, pointerId: event.pointerId, edge: target.dataset.drag === 'right',
					notch: target.dataset.drag === 'right'
						? (row.endMs - row.startMs) / row.cycleMs + row.phase : Number(target.dataset.notchIndex),
					scrollLeft: this.body.scrollLeft, moved: false
				};
				this.drag.targets = TimelineView.snapTargets(this.model, row, kind, this.editor.animationTicker.getPlayheadTime(), {
					scale: this.scale, config: this.config, frames: this.showsFrames, collapsed: this.collapsed,
					endMs: this.model.loopMs * (1 + this.nextLoopShare)
				});
			},
			move: event => { this.moveDrag(event); if (this.drag) this.trackEdgePointer(event); },
			end: cancelled => this.finishDrag(cancelled)
		});
		this.onEscapeFrame = event => {
			if (event.key !== 'Escape' || this.drag || (!this.frameView.exact && !this.frameView.done)) return;
			event.preventDefault(); event.stopPropagation(); this.frameView.invalidate();
		};
		this.stage.addEventListener('dblclick', event => {
			if (event.target.closest('.timeline-loop-end') && this.available) this.editor.setDocumentLoop(CONFIG.project.loop);
		});
	}

	moveDrag(event) {
		const drag = this.drag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!this.available) { this.finishDrag(true); return; }
		if (!drag.moved) {
			this.frameView.invalidate();
			this.frameView.blocked = true;
			this.host.dataset.dragging = drag.kind;
			drag.node?.classList.add('is-dragging');
			if (['period', 'slip', 'duration'].includes(drag.kind)) drag.node?.classList.add('is-changing-cycles');
		}
		drag.moved = true;
		const { row, kind } = drag;
		const delta = TimelineView.xToTime(event.clientX - drag.x + this.body.scrollLeft - drag.scrollLeft, this.scale);
		let time = TimelineView.xToTime(event.clientX - drag.trackLeft + this.body.scrollLeft - drag.scrollLeft, this.scale);
		const snap = PREFERENCES.get('timelineSnap') && (kind === 'slip' || !event.altKey);
		const threshold = TimelineView.xToTime(this.config.snapPx, this.scale);
		for (const target of drag.targets) if (target.kind === 'playhead') target.ms = this.editor.animationTicker.getPlayheadTime();
		// What the value snapped to, while that still holds after clamping.
		let value, target = null;
		const snapped = (wanted, targets, within) => {
			const result = snap ? TimelineView.snapTime(wanted, targets, within) : { ms: wanted, target: null };
			target = result.target;
			return result.ms;
		};
		if (kind === 'slip') {
			value = snapped(TimelineView.phaseFromSlip(row, delta), drag.targets, threshold / row.cycleMs) % 1;
		} else if (kind === 'period') {
			const wanted = snapped(TimelineView.periodFromNotch(row, drag.notch, time), drag.targets, threshold / Math.max(1, drag.notch - row.phase));
			value = clampNumber(wanted, row.source.periodRange.min, row.source.periodRange.max);
			if (row.source.resolvePeriod) value = row.source.resolvePeriod(value);
			if (value !== wanted) target = null;
		} else if (kind === 'duration') {
			const wanted = snapped(time, drag.targets, threshold);
			value = TimelineView.durationFromEdge(row, drag.count, wanted);
			if (Math.abs(value.run.end - wanted) > 1e-6) target = null;
		} else {
			if (kind === 'move') time = row.startMs + delta;
			const wanted = time = snapped(time, drag.targets, threshold);
			if (kind === 'move' || kind === 'left') time = clampNumber(time, 0, FIELDS.animDelay.max * 1000);
			if (time !== wanted) target = null;
			if (kind === 'loop') value = { mode: 'set', durationMs: time };
			else if (kind === 'right') value = TimelineView.runFromRightEdge(row, time, this.model.loopMs);
			else if (kind === 'left') value = TimelineView.runFromLeftEdge(row, time);
			else value = TimelineView.runFromBodyMove(row, time - row.startMs);
		}
		this.writeDrag(drag, value);
		this.paintDrag(drag, value, target);
	}

	writeDrag(drag, value) {
		drag.value = value;
		const { setter } = DRAG_KINDS[drag.kind];
		if (typeof setter === 'function') setter(this, value, drag.row);
		else this.editor.writeTiming(drag.row.key, { [setter]: value }, { live: true });
		if (drag.row) this.renderTiming(drag.row);
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
			else if (kind === 'duration') {
				row.cycleMs = row.exportCycleMs = value.period;
				row.source = { ...row.source, run: value.run };
				row.endMs = Math.min(value.run.end, this.model.loopMs);
				edge = value.run.end;
			}
			else if (kind === 'period') {
				row.cycleMs = row.exportCycleMs = value; edge = guide = row.startMs + (drag.notch - row.phase) * value;
				if (drag.edge && row.can.run && Number.isFinite(row.source.run.end)) row.endMs = Math.min(this.model.loopMs, edge);
			}
			else { row.startMs = value.start; row.endMs = Math.min(value.end, this.model.loopMs); }
			this.layoutRow(drag.node, drag.row, { drawing: row });
			edge ??= kind === 'right' ? row.endMs : row.startMs;
		}
		const text = kind === 'loop' ? TimelineView.dragReadout(kind, null, edge, drag.initial.durationMs ?? drag.loopMs, target)
			: TimelineView.dragReadout(kind, drag.row, value, drag.initial, target);
		this.paintDragFeedback(text, edge, anchor, target ? guide : null);
	}

	// The readout sits above the dragged edge, inside the dock; the guide marks
	// the moment a snap landed on. The key lane draws its drags through here too.
	paintDragFeedback(text, edgeMs, anchor, guideMs) {
		if (!this.dragReadout) { this.dragReadout = buildElement('timeline-drag-readout badge'); this.host.appendChild(this.dragReadout); }
		this.dragReadout.textContent = text;
		const box = this.host.getBoundingClientRect();
		const origin = this.stage.getBoundingClientRect().left + this.labelColumn - this.body.scrollLeft - box.left;
		const x = origin + TimelineView.timeToX(edgeMs, this.scale);
		this.dragReadout.style.left = `${Math.min(this.host.clientWidth - this.dragReadout.offsetWidth, Math.max(0, x))}px`;
		this.dragReadout.style.top = `${Math.max(0, anchor.getBoundingClientRect().top - box.top - this.dragReadout.offsetHeight)}px`;
		const guideX = guideMs == null ? -Infinity : TimelineView.timeToX(guideMs, this.scale) - this.body.scrollLeft;
		this.snapGuide.hidden = guideX < 0;
		if (!this.snapGuide.hidden) this.snapGuide.style.transform = `translateX(${guideX}px)`;
	}

	clearDragFeedback() {
		this.dragReadout?.remove(); this.dragReadout = null;
		this.snapGuide.hidden = true;
	}

	finishDrag(cancelled) {
		if (this.pointerDrag?.active) { this.pointerDrag.finish(cancelled); return; }
		const drag = this.drag;
		if (!drag) return;
		this.drag = null;
		this.stopEdgeScroll();
		this.clearDragFeedback();
		delete this.host.dataset.dragging;
		drag.node?.classList.remove('is-dragging', 'is-changing-cycles');
		if (!drag.moved) {
			if (this.syncPending) this.resync();
			return;
		}
		if (cancelled) {
			this.writeDrag(drag, drag.initial);
			if (drag.row) { const layer = this.editor.layerManager.getLayerById(drag.row.layerId); if (drag.originalPeriods) layer.loopOriginalPeriods = drag.originalPeriods; else delete layer.loopOriginalPeriods; }
		}
		else if (!isSameData(drag.value, drag.initial)) {

			this.commitTiming(DRAG_KINDS[drag.kind].commitLabel);
		}
		this.frameView.seek();
		this.editor.scheduleExportDuration();
		if (cancelled) this.editor.updateExportDuration();
		if (this.syncPending) this.resync();
	}

	nudgeRow(row, event) {
		if (!row.can.run || !this.canEdit(row)) return;
		const direction = event.key === 'ArrowRight' ? 1 : -1;
		const end = row.source.run.end;
		const next = event.shiftKey
			? TimelineView.runFromRightEdge(row, (Number.isFinite(end) ? end : this.model.loopMs) + direction * row.cycleMs, this.model.loopMs)
			: TimelineView.runFromBodyMove(row,
				clampNumber(row.startMs + direction * (this.model.frameStarts[1] || row.cycleMs), 0, FIELDS.animDelay.max * 1000) - row.startMs);
		if (next.start === row.source.run.start && next.end === row.source.run.end) return;
		this.applyRowEdit(row, event.shiftKey ? 'Trim animation' : 'Move animation', () => this.editor.writeTiming(row.key, { run: next }, { live: true }), { coalesceKey: this.editor.historyManager.burstCoalesceKey('timeline-nudge') });
	}

	selectMotion(layerId, index) {
		const layer = this.editor.layerManager.getLayerById(layerId);
		this.editor.motionSelection.select(layerId, layer?.animations?.[index]?.id);
	}

	syncKeys() { if (this.available) this.keyLane.refresh(); }

	syncSelection() {
		const layer = this.editor.layerManager.getActiveLayer();
		const motionId = this.editor.motionSelection.get(layer?.id).motionId;
		const group = this.model?.groups.find(group => group.layerId === layer?.id);
		const selected = group?.rows.find(row => TimelineView.motionId(row) === motionId);
		if (selected && (!this.rowsByKey.has(this.selectedKey) || TimelineView.motionId(this.rowsByKey.get(this.selectedKey)) != null)) this.selectedKey = String(selected.key);
		else if (!this.rowsByKey.has(this.selectedKey)) this.selectedKey = group?.rows[0]?.key;

		for (const node of this.body.querySelectorAll('.timeline-row')) {
			const selected = node.dataset.sourceKey === this.selectedKey;
			node.classList.toggle('is-selected', selected);
			node.querySelector('.timeline-bar')?.setAttribute('aria-pressed', String(selected));
			const row = this.rowFor(node), lane = node.querySelector('.timeline-row-lane');
			const layer = this.editor.layerManager.getLayerById(row.layerId);
			const showKeys = selected && row.layerId === this.editor.activeLayerId && Boolean(row.source?.keyTrack)
				&& row.source.keyTrack.entry === this.editor.selectedMotion(layer);
			if (!showKeys && lane === this.keyLane.host) this.keyLane.finish(true);
			lane.hidden = !showKeys;
			if (showKeys) this.keyLane.mount(row, lane);
		}
		for (const group of this.body.querySelectorAll('.timeline-group')) {
			syncLayerRow(group.querySelector('.timeline-group-label'), this.editor.layerManager.getLayerById(group.dataset.layerId));
			group.querySelector('.timeline-group-header').classList.toggle('is-selected', this.editor.layerManager.isLayerSelected(group.dataset.layerId));
		}
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
		const top = this.body.scrollTop;
		this.body.scrollTop = TimelineView.revealScroll(box.top - view.top + top, box.bottom - view.top + top, top, this.body.clientHeight);
	}

	// Minimized, the dock is its bar: the transport and the readout stay.
	applyMinimized() {
		const minimized = PREFERENCES.get('timelineMinimized');
		this.host.classList.toggle('is-minimized', minimized);
		this.minimize.querySelector('use').setAttribute('href', minimized ? '#icon-chevron-right' : '#icon-chevron-down');
		this.minimize.setAttribute('aria-expanded', String(!minimized));
		const label = minimized ? 'Expand timeline' : 'Collapse timeline';
		this.minimize.title = label;
		this.minimize.setAttribute('aria-label', label);
	}

	toggleMinimized() {
		PREFERENCES.set('timelineMinimized', !PREFERENCES.get('timelineMinimized'));
		this.applyMinimized();
		if (!PREFERENCES.get('timelineMinimized') && this.rowsPending) this.resync();
		this.syncClock();
		this.editor.viewport.handleWindowResize();
	}

	measure() {
		const { loopMs } = this.model;
		const timed = this.model.loopMs > 0 && this.hasTimedRows;
		const style = getComputedStyle(this.body);
		this.labelColumn = parseFloat(style.getPropertyValue('--timeline-label-column'));
		const columns = this.labelColumn + parseFloat(style.getPropertyValue('--timeline-info-column'));
		this.builtWidth = this.body.clientWidth;
		this.viewWidth = Math.max(1, this.builtWidth - this.labelColumn);
		this.body.style.setProperty('--scroll-region-inset-start', `${this.labelColumn}px`);
		this.fitScale = timed
			? Math.max(this.config.minPxPerSecond, Math.max(1, this.builtWidth - columns) / (loopMs * (1 + this.nextLoopShare) / 1000))
			: this.config.minPxPerSecond;
		const zoom = PREFERENCES.get('timelineZoom');
		// A stored zoom is never further out than fit: a shorter loop or a wider
		// dock can leave it there.
		this.scale = zoom === 'fit' ? this.fitScale : Math.max(this.fitScale, zoom);
		this.trackWidth = TimelineView.timeToX(loopMs * (1 + this.nextLoopShare), this.scale);
		this.stage.style.setProperty('--timeline-track-width', `${this.trackWidth}px`);
		this.stage.style.setProperty('--timeline-loop-x', `${TimelineView.timeToX(loopMs, this.scale)}px`);
	}

	layoutRow(node, row, { drawing = row } = {}) {
		const bar = node?.querySelector('.timeline-bar');
		if (!bar) return;
		this.placeBar(node, bar, drawing);
		let marks = bar.querySelector('.timeline-bar-marks');
		if (!marks) { marks = buildElement('timeline-bar-marks'); bar.prepend(marks); }
		this.buildMarks(drawing, drawing.startMs, drawing.endMs, marks);
		this.buildNotches(drawing, bar);
		bar.title = TimelineView.barTitle(drawing, this.model.loopMs);
		bar.setAttribute('aria-label', `${drawing.label}: ${TimelineView.rowInfo(drawing)}`);
		const info = node.querySelector('.timeline-row-info');
		info.textContent = TimelineView.rowInfo(drawing); info.title = bar.title;
		let ghost = node.querySelector('.timeline-bar-ghost');
		if (!this.nextLoopShare) { ghost?.remove(); return; }
		if (!ghost) { ghost = buildElement('timeline-bar-ghost'); bar.parentElement.append(ghost); }
		ghost.style.left = `${TimelineView.timeToX(this.model.loopMs, this.scale)}px`;
		ghost.style.width = `${TimelineView.timeToX(this.model.loopMs * this.nextLoopShare, this.scale)}px`;
		if (drawing.nonLooping) ghost.replaceChildren();
		else {
			let marks = ghost.querySelector('.timeline-bar-marks');
			if (!marks) { marks = buildElement('timeline-bar-marks'); ghost.append(marks); }
			this.buildMarks(drawing, this.model.loopMs, this.model.loopMs * (1 + this.nextLoopShare), marks);
		}
	}

	layoutGroup(node, group) {
		if (!node || !group) return;
		let track = node.querySelector('.timeline-group-track');
		if (!this.hasRows) { track?.remove(); return; }
		if (!track) { track = buildElement('timeline-track timeline-group-track'); node.querySelector('.timeline-group-header').append(track); }
		const timed = group.rows.filter(row => row.source);
		let span = track.querySelector('.timeline-group-span');
		if (!timed.length) { span?.remove(); return; }
		if (!span) { span = buildElement('timeline-group-span'); track.append(span); }
		const start = Math.min(...timed.map(row => row.startMs));
		span.style.left = `${TimelineView.timeToX(start, this.scale)}px`;
		span.style.width = `${TimelineView.timeToX(Math.max(...timed.map(row => row.endMs)) - start, this.scale)}px`;
	}

	relayout() {
		if (!this.model?.groups.length) return;
		this.measure();
		for (const group of this.model.groups) {
			this.layoutGroup([...this.body.children].find(node => node.dataset.layerId === group.layerId), group);
			for (const row of group.rows) this.layoutRow(this.rowNodesByKey.get(String(row.key)), row);
		}
		this.frameIndex = null;
		this.keyLane.layout?.(); this.syncScroll(); this.syncControls();
	}

	buildNotches(row, bar) {
		bar.querySelectorAll('.timeline-period-notch').forEach(node => node.remove());
		if (!row.can.period || !TimelineView.hasGripRoom(TimelineView.timeToX(row.exportCycleMs, this.scale), this.config)) return;
		const drawing = { ...row, cycleMs: row.exportCycleMs };
		for (const ms of TimelineView.cycleStarts(drawing, this.model.loopMs)) {
			if (TimelineView.timeToX(ms - row.startMs, this.scale) < this.config.minTickPx) continue;
			const notch = buildElement('timeline-period-notch', undefined, 'span');
			notch.dataset.drag = 'period';
			notch.dataset.notchIndex = String(TimelineView.timeToCycle(drawing, ms + 1e-6).index);
			notch.style.left = `${TimelineView.timeToX(ms - row.startMs, this.scale)}px`;
			notch.title = 'Drag to change the cycle length'; bar.appendChild(notch);
		}
	}

	stepZoom(direction, anchorX) {
		if (!this.model?.loopMs) return;
		if (anchorX == null) {
			const x = TimelineView.timeToX(this.editor.animationTicker.getPlayheadTime(), this.scale);
			const left = this.body.scrollLeft;
			anchorX = x >= left && x <= left + this.viewWidth ? x : left + this.viewWidth / 2;
		}
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
		const scale = pxPerSecond === 'fit' ? this.fitScale : Math.max(this.fitScale, pxPerSecond);
		if (scale === oldScale) { this.syncControls(); return; }
		this.relayout();
		if (time != null) this.scrollToTimeX(oldScroll + TimelineView.timeToX(time, this.scale) - anchorX);
	}
}
