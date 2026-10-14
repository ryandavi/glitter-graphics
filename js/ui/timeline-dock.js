'use strict';

class TimelineDock {
	constructor(editor, host) {
		this.editor = editor;
		this.host = host;
		this.config = CONFIG.ui.timeline;
		this.selectedKey = null;
		this.listedIds = new Set();
		this.collapsed = new Map();
		this.rowsByKey = new Map();
		this.rowNodesByKey = new Map();
		this.stale = false;
		host.style.setProperty('--timeline-ruler-height', `${this.config.rulerHeight}px`);
		host.style.setProperty('--timeline-grip', `${this.config.gripPx}px`);
		this.resizeHandle = this.element('timeline-resize-handle');
		// The same bar as a panel section: icon, name, detail, actions.
		this.header = this.element('section-header section-header-with-action');
		this.title = this.element('section-header-title', undefined, 'h3');
		const icon = this.element('section-header-title-icon icon-wrapper sm', undefined, 'span');
		icon.appendChild(createIcon('timeline'));
		this.title.append(icon, this.element('section-header-title-text', 'Timeline', 'span'));
		// What the export would write, and whether it closes.
		this.summary = this.element('timeline-summary');
		this.summary.append(this.buildFrameReadout());
		const actions = this.element('section-header-actions');
		const action = 'section-header-action btn-icon-simple icon-wrapper sm visible';
		// Shows the same state as the view menu's Pause motion.
		this.play = this.button(action, 'Pause motion', 'motion-pause', () => editor.animationPanel.setPaused(!editor.animationTicker.paused));
		this.time = this.element('timeline-time', undefined, 'span');
		const transport = this.element('timeline-transport');
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
		const windowActions = this.element('timeline-window-actions');
		windowActions.append(this.minimize, this.button(action, 'Close timeline', 'x-mark', () => editor.toggleTimeline()));
		actions.append(this.zoom, this.buildOptionsMenu(), windowActions);
		this.header.append(this.title, transport, this.summary, actions);
		// The ruler stays above the scrolling rows and follows their sideways
		// scroll; the playhead is one line over both.
		this.ruler = this.element('timeline-ruler');
		this.body = this.element('timeline-body');
		this.playhead = this.element('timeline-playhead');
		this.playheadTime = this.element('timeline-playhead-time badge'); this.playhead.appendChild(this.playheadTime);
		this.hoverGuide = this.element('timeline-hover-guide'); this.hoverGuide.hidden = true;
		this.hoverTime = this.element('timeline-playhead-time badge'); this.hoverGuide.appendChild(this.hoverTime);
		this.labelHandle = this.element('timeline-label-handle');
		this.stage = this.element('timeline-stage');
		// Where a drag snapped, drawn like the playhead.
		this.snapGuide = this.element('timeline-snap-guide'); this.snapGuide.hidden = true;
		this.stage.append(this.ruler, this.body, this.playhead, this.hoverGuide, this.snapGuide, this.labelHandle);
		const section = this.element('timeline-section section');
		section.append(this.header, this.stage);
		host.replaceChildren(this.resizeHandle, section);
		this.frameView = new TimelineFrameView(this);
		this.keyLane = new TimelineKeyLane(this);
		this.keyRecording = new TimelineKeyRecording(this);
		this.bindResize();
		this.bindLabelResize();
		this.host.addEventListener('wheel', event => {
			if (!event.ctrlKey && !event.metaKey && event.target.closest('.timeline-ruler') && this.available) {
				const unit = event.deltaMode === 1 ? this.config.wheelLinePx : event.deltaMode === 2 ? this.viewWidth : 1;
				this.body.scrollLeft += (event.deltaX || event.deltaY) * unit;
				event.preventDefault();
				return;
			}
			if ((!event.ctrlKey && !event.metaKey) || !this.available) return;
			event.preventDefault();
			event.stopPropagation();
			if (!this.model?.loopMs || !event.deltaY) return;
			const box = this.body.getBoundingClientRect();
			const x = this.body.scrollLeft + clampNumber(event.clientX - box.left - this.labelColumn, 0, this.viewWidth);
			const unit = event.deltaMode === 1 ? this.config.wheelLinePx : event.deltaMode === 2 ? this.viewWidth : 1;
			const zoom = TimelineView.wheelZoom(this.wheelTravel || 0, event.deltaY * unit, this.config.wheelZoomPx);
			this.wheelTravel = zoom.remainder;
			for (let step = 0; step < Math.abs(zoom.steps); step++) this.stepZoom(-Math.sign(zoom.steps), x);
		}, { passive: false, capture: true });
		this.bindPlayhead();
		this.bindGestures();
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
			this.revealActive();
		});
		window.addEventListener('interfaceThemeChanged', () => {
			if (!this.available || !this.rulerTicks) return;
			this.syncRulerStyle();
			this.paintRuler();
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

	// The frame count is a button: it lists the timings that would export
	// fewer frames, and is marked while one exists.
	buildFrameReadout() {
		const root = this.element('timeline-frames app-menu');
		this.readout = this.element('timeline-readout', undefined, 'button');
		this.readout.type = 'button'; this.readout.hidden = true;
		this.readout.setAttribute('aria-haspopup', 'menu');
		this.readout.setAttribute('aria-expanded', 'false');
		const panel = this.element('app-menu-panel'); panel.hidden = true;
		panel.setAttribute('role', 'menu');
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
		const root = this.element('section-header-action app-menu visible');
		const trigger = this.button('btn-icon-simple app-menu-trigger icon-wrapper sm', 'Timeline options', 'ellipsis-vertical', () => {});
		trigger.setAttribute('aria-haspopup', 'true');
		trigger.setAttribute('aria-expanded', 'false');
		const panel = this.element('app-menu-panel'); panel.hidden = true;
		panel.setAttribute('role', 'menu');
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
		// An open dock keeps the preview clock running for its playhead.
		this.editor.animationTicker.refresh();
		this.syncPlayback();
		if (changed) this.editor.viewport.handleWindowResize();
	}

	// A held playhead belongs to the open dock: closed, a paused preview
	// shows its rest pose again.
	close() {
		if (!this.isOpen) return;
		this.scrubDrag.finish(true);
		this.stopEdgeScroll();
		this.keyRecording.end();
		this.keyLane.finish(true);
		this.finishDrag(true);
		this.menu?.close();
		this.frameMenu.close();
		this.optionsMenu.close();
		this.frameView.invalidate();
		this.host.hidden = true;
		this.syncClock();
		this.editor.animationPanel.syncKeyAdd();
		if (this.resizeFrame != null) cancelAnimationFrame(this.resizeFrame);
		this.resizeFrame = null;
		document.removeEventListener('keydown', this.onEscapeFrame, true);
		const ticker = this.editor.animationTicker;
		if (ticker.paused) ticker.setPaused(true);
		else ticker.refresh();
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
		const timed = this.available && this.model?.groups.length && this.model.loopMs > 0
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
			if (!ticker.paused || !ticker.holding) this.editor.animationPanel.setPaused(true);
		};
		const scrub = event => {
			const { loopMs, frameStarts } = this.model;
			const ms = TimelineView.xToTime(event.clientX - this.rulerTrack.getBoundingClientRect().left, this.scale);
			const inside = Math.max(0, Math.min(loopMs - 1, ms));
			// Alt suspends snapping for the drag.
			ticker.seek(event.altKey || !PREFERENCES.get('timelineSnap') ? inside : TimelineView.nearestFrameStart(frameStarts, inside));
		};
		this.scrubDrag = bindPointerDrag(this.stage, {
			canStart: event => this.available && !this.stale && this.model?.loopMs
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
		let index = this.frameIndex ?? -1;
		if (index >= starts.length || (index >= 0 && starts[index] > ms + 1e-6)) index = -1;
		while (index + 1 < starts.length && starts[index + 1] <= ms + 1e-6) index++;
		if (index !== this.frameIndex) {
			this.frameIndex = index;
			this.frameStart = index < 0 ? ms : starts[index];
			const width = index < 0 ? 0 : TimelineView.timeToX((starts[index + 1] ?? loopMs) - starts[index], this.scale);
			this.playhead.style.setProperty('--timeline-frame-width', `${width}px`);
		}
		this.playhead.style.setProperty('--timeline-frame-left', `${TimelineView.timeToX(this.frameStart - Math.min(ms, loopMs), this.scale)}px`);
		const rest = this.editor.animationTicker.paused && (this.frameView.blocked || !this.editor.animationTicker.holding);
		this.host.classList.toggle('shows-rest', rest);
		this.playheadTime.hidden = this.scrubPointer == null && !this.drag;
		const hundredth = Math.round(ms / 10);
		if (this.displayTime === hundredth && this.displayLoop === loopMs && this.displayRest === rest) return;
		this.displayTime = hundredth; this.displayLoop = loopMs; this.displayRest = rest;
		const text = `${formatSeconds(ms, { unit: false })} / ${formatSeconds(loopMs)}${rest ? ' · rest pose' : ''}`;
		if (this.time.textContent === text) return;
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
		this.syncHeightSeparator = bindSeparator(handle, {
			orientation: 'horizontal', label: 'Resize timeline', canUse: () => this.available,
			reset: () => PREFERENCES.reset('timelineHeight'),
			change: delta => {
				PREFERENCES.set('timelineHeight', this.applyHeight(this.host.getBoundingClientRect().height - delta));
				refit();
			}
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
		this.syncLabelSeparator = bindSeparator(handle, {
			orientation: 'vertical', label: 'Resize timeline labels', canUse: () => this.available,
			reset: () => PREFERENCES.reset('timelineLabelWidth'),
			change: delta => {
				PREFERENCES.set('timelineLabelWidth', this.applyLabelWidth(current() + delta));
				this.resync();
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
		this.editablePending = Boolean(this.timingCommit);
		clearTimeout(this.staleTimer);
		this.staleTimer = setTimeout(() => { if (this.stale && !this.editablePending) this.host.classList.add('is-stale'); }, this.config.staleShowMs);
		this.frameMenu.close();
		this.readout.disabled = true;
		this.fit.disabled = true;
		this.keyLane.syncState();
		this.editor.animationPanel.syncKeyAdd();
	}

	syncControls() {
		if (!this.available) return;
		this.editor.animationPanel.syncKeyAdd();
		this.fit.disabled = this.stale || !this.editor.getLoopCandidate()?.canApply;
		this.exact.disabled = this.stale || !this.model?.loopMs;
		this.zoom.disabled = !this.model?.loopMs || this.fitScale >= this.config.pxPerSecondStops.at(-1);
		const range = Math.log(this.config.pxPerSecondStops.at(-1) / this.fitScale);
		this.zoom.value = range > 0 ? Math.max(0, Math.min(1, Math.log(this.scale / this.fitScale) / range)) : 0;
		this.zoom.title = this.scale <= this.fitScale ? 'Zoom to fit; double-click to fit' : `${Math.round(this.scale)} px/s; double-click to fit`;
	}

	sync(estimate) {
		if (!this.available) return;
		if (this.drag || this.keyLane.drag) { this.syncPending = true; return; }
		this.syncPending = false;
		const model = TimelineView.buildModel(estimate, this.editor.layers, this.listedIds);
		const signature = TimelineView.modelSignature(model) + JSON.stringify(this.show);
		const unchanged = signature === this.modelSignature && !this.rowsPending && Boolean(this.rulerTrack);
		this.modelSignature = signature;
		if (unchanged) {
			for (const group of model.groups) for (let index = 0; index < group.rows.length; index++) {
				const fresh = group.rows[index], previous = this.rowsByKey.get(String(fresh.key));
				if (previous) { Object.assign(previous, fresh); group.rows[index] = previous; }
			}
		} else {
			this.menu?.close(); this.menuPanel?.remove(); this.frameMenu.close();
		}
		this.model = model;
		this.rowsByKey = new Map(this.model.groups.flatMap(group => group.rows).map(row => [String(row.key), row]));
		this.listedIds = new Set(this.model.groups.map(group => group.layerId));
		clearTimeout(this.staleTimer);
		this.editablePending = false;
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
		const keyWasFocused = Boolean(document.activeElement?.closest('.timeline-key-track'));
		this.rulerTrack = null;
		this.ruler.replaceChildren();
		this.ruler.hidden = true;
		this.playhead.hidden = true;
		this.snapGuide.hidden = true;
		this.labelHandle.hidden = true;
		this.frameIndex = null;
		this.time.textContent = ''; this.displayTime = null;
		this.rowNodesByKey.clear();
		this.body.replaceChildren();
		this.stage.classList.toggle('is-empty', !this.model.groups.length);
		if (!this.model.groups.length) {
			const layer = this.editor.layerManager.getActiveLayer();
			const animatable = layer && LAYER_UI_CONFIG[layer.type]?.animatable;
			this.body.appendChild(buildPropertyEmpty({
				visible: true, icon: 'timeline', title: 'Nothing is animated yet',
				text: animatable ? 'Animated glitter, stickers, sparkles and motions each get a row here.' : 'Select a layer to animate it.'
			}));
			if (animatable) this.body.appendChild(this.button('btn-flat', 'Add animation', 'plus', () => this.editor.animationPanel.addAnimation(this.editor.layerManager.getActiveLayer())));
			this.syncControls();
			return;
		}
		const { loopMs } = this.model;
		this.labelHandle.hidden = false;
		// With every animated layer hidden there are rows and nothing to time.
		const timed = loopMs > 0;
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
		if (timed) {
			this.ruler.appendChild(this.buildRuler());
			this.ruler.hidden = false;
		}
		for (const group of this.model.groups) this.body.appendChild(this.buildGroup(group));
		const name = this.body.querySelector('.timeline-group-name');
		if (name) this.stage.style.setProperty('--timeline-measured-label-inset', `${name.offsetLeft}px`);
		this.body.scrollTop = scrollTop;
		this.scrollToTimeX(scrollLeft);
		if (rulerFocused) this.rulerTrack?.focus({ preventScroll: true });
		if (focusedKey) this.rowNodesByKey.get(focusedKey)?.querySelector('.timeline-bar').focus({ preventScroll: true });
		this.syncScroll();
		this.syncControls();
		this.syncSelection();
		if (keyWasFocused) this.keyLane.focusSelected();
	}

	syncReadout(estimate) {
		this.readout.hidden = true;
		this.readout.disabled = false;
		const { loopMs, frameCount, outputFormat, exact, groups } = this.model;
		if (!groups.length || !(loopMs > 0)) return;
		const optimizable = estimate.frameOptions.optimizable;
		this.readout.replaceChildren();
		if (!exact || optimizable) this.readout.appendChild(createIcon('triangle-exclamation'));
		this.readout.appendChild(this.element('timeline-readout-text', `${frameCount} frames · ${outputFormat.toUpperCase()}`, 'span'));
		this.readout.hidden = false;
		this.readout.classList.toggle('is-warning', !exact || optimizable);
		this.readout.title = [!exact ? TimelineView.SEAM_TEXT : '',
			optimizable ? 'A change of timing would export fewer frames.' : '', 'Press for frame options.'].filter(Boolean).join(' ');
		this.readout.setAttribute('aria-label', `${frameCount} frames · ${outputFormat.toUpperCase()}. ${this.readout.title}`);
	}

	buildRuler() {
		const view = this.element('timeline-ruler-view');
		const track = this.element('timeline-ruler-track');
		track.tabIndex = 0;
		track.setAttribute('role', 'slider');
		track.setAttribute('aria-label', 'Playhead');
		track.setAttribute('aria-valuemin', '0');
		track.setAttribute('aria-valuemax', formatSeconds(this.model.loopMs, { unit: false }));
		this.rulerTrack = track;
		const canvas = document.createElement('canvas'); canvas.className = 'timeline-ruler-ticks';
		this.rulerTicks = { canvas };
		this.syncRulerStyle();
		const loop = this.element('timeline-loop-end', formatSeconds(this.model.loopMs));
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
			this.openContextMenu(view, track, [
				{ label: 'Set loop end here', disabled: this.stale || ms <= 0, run: () => this.editor.setDocumentLoop({ mode: 'set', durationMs: ms }) },
				{ label: 'Automatic loop length', checked: this.editor.documentLoop.mode === 'auto', run: () => this.editor.setDocumentLoop(CONFIG.project.loop) },
				{ label: 'Zoom to fit', run: () => this.setZoom('fit') }
			], event);
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

	buildGroup(group) {
		const node = this.element('timeline-group'); node.dataset.layerId = group.layerId;
		const collapsed = Boolean(this.collapsed.get(group.layerId));
		node.classList.toggle('is-collapsed', collapsed);
		// A row like the ones under it: the layer in the label column, and
		// the span of its animations on the track.
		const header = this.element('timeline-group-header');
		const label = this.element('timeline-group-label list-row');
		const toggle = () => {
			const collapsed = !node.classList.contains('is-collapsed');
			this.collapsed.set(group.layerId, collapsed);
			node.classList.toggle('is-collapsed', collapsed);
			chevron.setAttribute('aria-expanded', String(!collapsed));
			chevron.querySelector('use').setAttribute('href', collapsed ? '#icon-chevron-right' : '#icon-chevron-down');
			if (this.keyLane.host?.closest('.timeline-group') === node) {
				if (collapsed) this.keyLane.finish(true);
				else { this.keyLane.syncState(); this.keyLane.paint(this.editor.animationTicker.getPlayheadTime()); }
			}
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
		const lock = this.button(`${rowAction} lock timeline-group-lock`, '', 'lock', () => {
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
		label.addEventListener('contextmenu', event => {
			event.preventDefault();
			const state = manager.getLayerRowState(layer);
			this.openContextMenu(node, select, [
				{ label: 'Select layer', run: () => manager.setActiveLayer(layer.id) },
				{ label: layer.visible ? 'Hide' : 'Show', disabled: state.visibility.disabled, run: () => manager.toggleLayerVisibility(layer.id) },
				{ label: isLayerFullyLocked(layer) ? 'Unlock' : 'Lock', disabled: state.lock.disabled, run: () => manager.pressLayerLock(layer) },
				{ label: node.classList.contains('is-collapsed') ? 'Expand rows' : 'Collapse rows', run: toggle },
				{ label: 'Delete layer', disabled: state.delete.disabled, run: () => manager.deleteLayerFromRow(layer) }
			], event);
		});
		const track = this.element('timeline-track timeline-group-track');
		if (group.rows.length) {
			const span = this.element('timeline-group-span');
			const start = Math.min(...group.rows.map(row => row.startMs));
			span.style.left = `${TimelineView.timeToX(start, this.scale)}px`;
			span.style.width = `${TimelineView.timeToX(Math.max(...group.rows.map(row => row.endMs)) - start, this.scale)}px`;
			track.appendChild(span);
		} else track.appendChild(this.element('timeline-group-note', 'Hidden: not in the loop', 'span'));
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


	buildRow(row) {
		const node = this.element('timeline-row'); node.dataset.sourceKey = row.key;
		this.rowNodesByKey.set(String(row.key), node);
		const select = () => {
			this.selectedKey = String(row.key);
			const index = TimelineView.motionIndex(row);
			if (index != null) this.editor.animationPanel.selectMotion(this.editor.layerManager.getLayerById(row.layerId), index);
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
		bar.title = TimelineView.barTitle(row, this.model.loopMs);
		this.placeBar(node, bar, row);
		bar.appendChild(this.buildMarks(row, row.startMs, row.endMs));
		const kindIcon = row.kind === 'authored' ? LAYER_UI_CONFIG[this.editor.layerManager.getLayerById(row.layerId).type]?.icon || 'glitter' : TimelineView.motionIndex(row) != null ? 'motion-play' : 'sparkles';
		const icon = this.element('timeline-bar-icon icon-wrapper sm', undefined, 'span'); icon.append(createIcon(kindIcon)); bar.append(icon);
		bar.dataset.drag = 'body';
		for (const side of ['left', 'right']) if (TimelineView.edgeDrag(row, side)) {
			const handle = this.element(`timeline-bar-handle is-${side}`, undefined, 'span');
			handle.dataset.drag = side;
			handle.title = TimelineView.handleTitle(row, side);
			bar.appendChild(handle);
		}
		this.buildNotches(row, bar);
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
				action.run(); this.updateRowTiming(row); this.renderTiming(row); this.commitTiming(action.label);
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
			const seam = this.element('timeline-bar-seam');
			seam.title = TimelineView.seamTitle(row, this.model.loopMs); seam.appendChild(createIcon('triangle-exclamation'));
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

	buildMarks(row, start, end, marks = this.element('timeline-bar-marks')) {
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
				const mark = marks.children[count] || this.element(keyed ? 'timeline-key-dot' : 'timeline-cycle-mark');
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
		if (TimelineView.motionIndex(row) != null) section = document.getElementById(`${prefix}AnimationSection`);
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
		return this.available && (!this.stale || this.editablePending) && row && !isLayerFullyLocked(this.editor.layerManager.getLayerById(row.layerId));
	}

	commitTiming(label, options) {
		this.timingCommit = true;
		try { this.editor.commitAnimationTiming(label, options); }
		finally { this.timingCommit = false; }
	}

	updateRowTiming(row) {
		const layer = this.editor.layerManager.getLayerById(row.layerId), index = TimelineView.motionIndex(row);
		if (index != null && layer.animations[index]) {
			const animation = layer.animations[index]; row.source.run = GlitterAnimation.runTiming(animation);
			row.phase = row.source.phase = animation.phase; row.direction = row.source.direction = animation.direction;
			row.cycleMs = row.exportCycleMs = animation.periodMs;
			row.startMs = row.source.run.start; row.endMs = Math.min(row.source.run.end, this.model.loopMs);
		}
		this.relayout();
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
		const actions = TimelineView.barActions(row, this.model, {
			playhead: this.editor.animationTicker.getPlayheadTime(), clipboard: this.timingClipboard,
			copy: row => { this.timingClipboard = { cycle: row.cycleMs, run: row.source.run && { ...row.source.run }, phase: row.phase, direction: row.direction }; }
		});
		const index = TimelineView.motionIndex(row), layer = this.editor.layerManager.getLayerById(row.layerId), panel = this.editor.animationPanel;
		if (index != null) {
			const animation = layer.animations[index];
			if (GlitterAnimation.MOTION_REGISTRY[animation.type].convertible) actions.push({ id: 'convert', group: 'Animation', label: 'Convert to custom', commits: false, disabled: !panel.conversion(animation), run: () => panel.convertToCustom(layer, animation) });
			actions.push({ id: 'duplicate', group: 'Animation', label: 'Duplicate animation', disabled: layer.animations.length >= CONFIG.tools.animation.maxStackSize, commits: false, run: () => panel.duplicateAnimation(layer, index) }, { id: 'delete', group: 'Animation', label: 'Delete animation', commits: false, run: () => panel.deleteAnimation(layer, index) });
		}
		return actions;
	}

	openContextMenu(root, trigger, actions, event) {
		if (!this.available) return;
		this.menu?.close(); this.menuPanel?.remove();
		const panel = this.element('app-menu-panel'); panel.hidden = true; panel.setAttribute('role', 'menu');
		for (const action of actions) {
			if (action.labelOnly) { panel.appendChild(buildMenuLabel(action.label)); continue; }
			const item = buildMenuItem({ label: action.label, current: action.checked != null, run: action.run });
			item.disabled = Boolean(action.disabled); if (action.checked != null) item.setAttribute('aria-current', String(action.checked)); panel.appendChild(item);
		}
		root.appendChild(panel); this.menuPanel = panel;
		this.menu = setupMenuPopover({ root, trigger, panel, fixed: true, bindTrigger: false });
		const anchor = event && { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY };
		this.menu.open({ anchor });
	}

	openBarMenu(row, node, bar, anchor = null) {
		if (!this.canEdit(row)) return;
		this.menu?.close();
		this.menuPanel?.remove();
		if (!anchor) {
			const rect = bar.getBoundingClientRect(), view = this.body.getBoundingClientRect();
			const left = Math.max(rect.left, view.left + this.labelColumn);
			anchor = { left, right: left, top: rect.top, bottom: rect.bottom };
		}
		const actions = this.barActions(row);
		if (!actions.length) return;
		const panel = this.element('app-menu-panel'); panel.hidden = true;
		panel.setAttribute('role', 'menu');
		let group = null;
		for (const action of actions) {
			if (action.group !== group) { if (group) panel.appendChild(buildMenuSeparator()); panel.appendChild(buildMenuLabel(action.group)); group = action.group; }
			const item = buildMenuItem({ label: action.label, current: action.checked != null, run: () => {
				if (!this.canEdit(row)) return;
				if (action.changesPeriod) this.editor.rememberAnimationPeriod(row.source);
				if (action.id === 'reset') this.editor.restoreAnimationPeriod(row.source);
				action.run();
				if (action.commits === false) return;
				this.updateRowTiming(row);
				this.renderTiming(row);
				this.commitTiming(action.commitLabel || action.label);
			} });
			item.disabled = Boolean(action.disabled);
			if (action.checked != null) item.setAttribute('aria-current', String(action.checked));
			panel.appendChild(item);
		}
		node.appendChild(panel);
		this.menuPanel = panel;
		this.menu = setupMenuPopover({ root: node, trigger: bar, panel, fixed: true, bindTrigger: false });
		this.menu.open({ anchor });
	}

	bindGestures() {
		this.pointerDrag = bindPointerDrag(this.stage, {
			threshold: this.config.dragThresholdPx, axis: 'x', clickHost: this.host,
			start: event => {
				if (!this.available || this.stale || this.drag) return false;
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
					kind, row, node, initial, count, loopMs: this.model.loopMs, trackLeft: track.getBoundingClientRect().left,
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
			if (event.target.closest('.timeline-loop-end') && this.available && !this.stale) this.editor.setDocumentLoop(CONFIG.project.loop);
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
		else drag.row.source[setter](value);
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
			const bar = drag.node.querySelector('.timeline-bar');
			this.placeBar(drag.node, bar, row);
			this.buildMarks(row, row.startMs, row.endMs, bar.querySelector('.timeline-bar-marks'));
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
		if (cancelled) this.writeDrag(drag, drag.initial);
		else if (JSON.stringify(drag.value) !== JSON.stringify(drag.initial)) {
			if (DRAG_KINDS[drag.kind].capability === 'period') {
				const period = drag.kind === 'duration' ? drag.value.period : drag.value;
				const before = drag.kind === 'duration' ? drag.initial.period : drag.initial;
				if (period !== before) this.editor.rememberAnimationPeriod(drag.row.source);
			}
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
		row.source.run = row.source.setRun(next) || next;
		row.startMs = row.source.run.start; row.endMs = Math.min(row.source.run.end, this.model.loopMs);
		const node = this.rowNodesByKey.get(String(row.key));
		if (node) {
			const bar = node.querySelector('.timeline-bar');
			this.placeBar(node, bar, row);
			this.buildMarks(row, row.startMs, row.endMs, bar.querySelector('.timeline-bar-marks'));
		}
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
			const row = this.model?.groups.find(group => group.layerId === layerId)?.rows.find(entry => TimelineView.motionIndex(entry) === index);
			if (row) { this.selectedKey = String(row.key); this.pendingMotion = null; }
		}
		if (this.selectedKey && !this.rowsByKey.has(this.selectedKey)) {
			const layer = this.editor.layerManager.getActiveLayer();
			const group = this.model?.groups.find(entry => entry.layerId === layer?.id);
			const index = this.editor.animationPanel.selectedMotionIndex(layer);
			const row = group?.rows.find(entry => TimelineView.motionIndex(entry) === index) || group?.rows[0];
			this.selectedKey = row ? String(row.key) : null;
		}
		for (const node of this.body.querySelectorAll('.timeline-row')) {
			const selected = node.dataset.sourceKey === this.selectedKey;
			node.classList.toggle('is-selected', selected);
			node.querySelector('.timeline-bar').setAttribute('aria-pressed', String(selected));
			const row = this.rowFor(node), lane = node.querySelector('.timeline-row-lane');
			const layer = this.editor.layerManager.getLayerById(row.layerId);
			const showKeys = selected && row.layerId === this.editor.activeLayerId && Boolean(row.source.keyTrack)
				&& row.source.keyTrack.entry === this.editor.animationPanel.selectedMotion(layer);
			if (!showKeys && lane === this.keyLane.host) this.keyLane.finish(true);
			lane.hidden = !showKeys;
			if (showKeys) this.keyLane.mount(row, lane);
		}
		for (const group of this.body.querySelectorAll('.timeline-group')) {
			group.querySelector('.timeline-group-label').classList.toggle('active', group.dataset.layerId === this.editor.activeLayerId);
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

	relayout() {
		if (!this.model?.groups.length || !this.rulerTrack) return;
		const style = getComputedStyle(this.body);
		this.labelColumn = parseFloat(style.getPropertyValue('--timeline-label-column'));
		this.builtWidth = this.body.clientWidth;
		this.viewWidth = Math.max(1, this.builtWidth - this.labelColumn);
		const columns = this.labelColumn + parseFloat(style.getPropertyValue('--timeline-info-column'));
		this.fitScale = Math.max(this.config.minPxPerSecond, Math.max(1, this.builtWidth - columns) / (this.model.loopMs * (1 + this.nextLoopShare) / 1000));
		const zoom = PREFERENCES.get('timelineZoom');
		this.scale = zoom === 'fit' ? this.fitScale : Math.max(this.fitScale, zoom);
		this.trackWidth = TimelineView.timeToX(this.model.loopMs * (1 + this.nextLoopShare), this.scale);
		this.stage.style.setProperty('--timeline-track-width', `${this.trackWidth}px`);
		this.stage.style.setProperty('--timeline-loop-x', `${TimelineView.timeToX(this.model.loopMs, this.scale)}px`);
		for (const group of this.model.groups) {
			const groupNode = [...this.body.children].find(node => node.dataset.layerId === group.layerId);
			const span = groupNode?.querySelector('.timeline-group-span');
			if (span) {
				const start = Math.min(...group.rows.map(row => row.startMs));
				span.style.left = `${TimelineView.timeToX(start, this.scale)}px`;
				span.style.width = `${TimelineView.timeToX(Math.max(...group.rows.map(row => row.endMs)) - start, this.scale)}px`;
			}
			for (const row of group.rows) {
				const node = this.rowNodesByKey.get(String(row.key)), bar = node.querySelector('.timeline-bar');
				this.placeBar(node, bar, row);
				this.buildMarks(row, row.startMs, row.endMs, bar.querySelector('.timeline-bar-marks'));
				this.buildNotches(row, bar);
				const ghost = node.querySelector('.timeline-bar-ghost');
				if (ghost) {
					ghost.style.left = `${TimelineView.timeToX(this.model.loopMs, this.scale)}px`;
					ghost.style.width = `${TimelineView.timeToX(this.model.loopMs * this.nextLoopShare, this.scale)}px`;
					if (!row.nonLooping) this.buildMarks(row, this.model.loopMs, this.model.loopMs * (1 + this.nextLoopShare), ghost.querySelector('.timeline-bar-marks'));
				}
			}
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
			const notch = this.element('timeline-period-notch', undefined, 'span');
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
