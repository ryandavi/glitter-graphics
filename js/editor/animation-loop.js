const EDITOR_ANIMATION_LOOP_METHODS = {
	loopAnalysisContext() {
		return {
			epoch: this.animationRevisionEpoch || 0, revision: this.documentRevision || 0,
			settings: JSON.stringify(this.exportSettings), loop: JSON.stringify(this.documentLoop),
			sources: [this.sceneCompositor?.timingRevision || 0, this.glitterLibrary?.timingRevision || 0, this.stickerLibrary?.timingRevision || 0, this.imageFills?.timingRevision || 0]
		};
	},
	isLoopEstimateCurrent(estimate = this.loopEstimate) {
		return Boolean(estimate && !this.loopEstimatePending && isSameData(estimate.analysisContext, this.loopAnalysisContext()));
	},
	resolveAnimationLoop(estimate = this.loopEstimate) {
		const current = this.isLoopEstimateCurrent(estimate);
		return {
			mode: this.documentLoop.mode,
			duration: this.documentLoop.mode === 'set' ? this.documentLoop.durationMs : current ? estimate.duration : this.lastLoopDuration || 0,
			state: this.loopEstimatePending ? 'pending' : current ? 'current' : this.loopEstimateFailed ? 'failed' : 'unknown',
			estimate: current ? estimate : null
		};
	},
	resolveTimingTarget(target, estimate = this.loopEstimate) {
		const current = this.isLoopEstimateCurrent(estimate);
		const source = current ? estimate.loopFit?.sources.find(source => source.key === target.key) : null;
		const analysis = current ? estimate.sourceAnalysis?.find(entry => entry.key === target.key) : null;
		const exportPeriod = analysis?.resolvedPeriod;
		const exportRun = target.animation && exportPeriod > 0 ? GlitterAnimation.runTiming({ ...target.animation, periodMs: exportPeriod }) : target.run;
		return { period: target.period, run: target.run, exportPeriod, exportRun,
			closes: target.active === false || !source || !(exportPeriod > 0) ? null : sourceSeamError(source, this.resolveAnimationLoop(estimate).duration, exportPeriod) < 1e-8 };
	},
	hasMotionForPlayback() { return Boolean(this.originalImage && listTimingTargets(this).some(target => target.active !== false && this.layerManager.getLayerById(target.layerId)?.visible !== false && (target.kind === 'gifCycle' || target.period > 0))); },
	writeTiming(key, patch, { label = 'Change animation timing', coalesceKey, commit = true, live = false } = {}) {
		if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
		const target = findTimingTarget(this, key);
		if (!target) return false;
		const names = { period: 'period', run: 'run', delayMs: 'run', iterations: 'run', phase: 'phase', direction: 'direction' };
		if (Object.keys(patch).some(name => !target.can[names[name]])) return false;
		const layer = this.layerManager.getLayerById(target.layerId);
		if (['period', 'delayMs', 'phase'].some(name => Object.hasOwn(patch, name) && !Number.isFinite(patch[name]))) return false;
		if (Object.hasOwn(patch, 'iterations') && patch.iterations !== Infinity && !Number.isFinite(patch.iterations)) return false;
		if (Object.hasOwn(patch, 'run') && (!patch.run || !Number.isFinite(patch.run.start) || (patch.run.end !== Infinity && !Number.isFinite(patch.run.end)) || patch.run.end < patch.run.start)) return false;
		if (Object.hasOwn(patch, 'direction') && !ANIMATION_DIRECTION_OPTIONS.some(option => option.value === patch.direction)) return false;
		if (this.previewFrameView?.exact || this.previewFrameView?.done) this.previewFrameView.invalidate();
		ANIMATION_TIMING_KINDS[target.kind].write(this, layer, target, patch);
		const next = ANIMATION_TIMING_KINDS[target.kind].collect(this, layer).find(entry => entry.key === key);
		const values = entry => ({ period: entry.period, run: entry.run, phase: entry.phase, direction: entry.direction });
		if (!next || isSameData(values(target), values(next))) return false;
		if (target.period > 0 && Math.abs(next.period - target.period) > 0.01) {
			layer.loopOriginalPeriods ||= {};
			layer.loopOriginalPeriods[key] ??= target.period;
		}
		if (target.kind === 'motion') this.touchMotion?.(layer, next.animation);
		this.documentRevision = (this.documentRevision || 0) + 1;
		getLayerManagerForType(this, layer.type)?.renderLayer?.(layer);
		this.previewFrameView?.invalidate({ keepFrame: Boolean(this.keyRecording?.active) });
		this.requestPreviewUpdate();
		window.dispatchEvent(new CustomEvent('animationChanged', { detail: { layerId: layer.id } }));
		if (commit && !live) this.commitAnimationTiming(label, { coalesceKey });
		return true;
	},

	setPlayback(playing) {
		if (playing) this.keyRecording?.end();
		this.animationTicker.setPaused(!playing);
		this.syncPlaybackControls();
		if (playing) this.previewImages.previewFrames.clear();
		else if (listTimingTargets(this).some(target => ['gifCycle', 'filterAnimation'].includes(target.kind))) this.ensurePreviewFrameView().then(view => view.paint(this.animationTicker.getPlayheadTime())).catch(error => console.warn('Preview frame loading failed:', error));
		window.dispatchEvent(new CustomEvent('playbackChanged'));
		this.requestPreviewUpdate();
	},
	syncPlaybackControls() {
		const button = document.getElementById('pauseMotionTool');
		const playing = !this.animationTicker.paused;
		const label = playing ? 'Pause motion' : `Resume motion \u00b7 ${formatSeconds(this.animationTicker.getPlayheadTime())}`;
		button?.classList.toggle('active', !playing);
		button?.setAttribute('aria-pressed', String(!playing));
		button?.setAttribute('aria-label', label);
		if (button) { button.title = label; button.querySelector('.name').textContent = label; }
	},

	async ensureKeyRecording() {
		await this.ensurePreviewFrameView();
		const { KeyRecording } = await loadScriptGroup('key-recording');
		this.keyRecording ||= new KeyRecording(this);
		return this.keyRecording;
	},
	async ensurePreviewFrameView() {
		const { PreviewFrameView } = await loadScriptGroup('preview-frames');
		this.previewFrameView ||= new PreviewFrameView(this);
		return this.previewFrameView;
	},
	setDocumentLoop({ mode, durationMs } = CONFIG.project.loop, { commit = true } = {}) {
		const config = CONFIG.export.timeline;
		const loop = mode === 'set' ? {
			mode, durationMs: clampNumber(roundTo(Number(durationMs), config.renderClock.gifDelayQuantumMs), config.setLoopRange.min, config.setLoopRange.max)
		} : { ...CONFIG.project.loop };
		if (commit && this.documentLoop.mode === loop.mode && this.documentLoop.durationMs === loop.durationMs) return;
		this.documentLoop = loop;
		if (loop.mode === 'set') this.animationTicker.setLoop(loop.durationMs);
		this.scheduleExportDuration();
		this.animationPanel?.loadTimingSummary();
		this.requestPreviewUpdate();
		if (commit) this.saveState(mode === 'set' ? 'Set loop length' : 'Automatic loop length');
	},
	setupAnimationLoop() {
		this.setupAnimationTransports();
		document.getElementById('pauseMotionTool')?.addEventListener('click', () => this.setPlayback(this.animationTicker.paused));
		document.getElementById('animationLoopSection')?.addEventListener('panelcollapsechange', event => { if (!event.detail.collapsed) this.updateExportDuration(); });
		const select = document.getElementById('animationLoopCandidate');
		if (select) {
			select.closest('.property-row').querySelector('.property-label').textContent = 'Loop length';
			select.setAttribute('aria-label', 'Loop length');
		}
		select?.addEventListener('change', () => {
			this.setDocumentLoop(select.value === 'auto' ? CONFIG.project.loop : { mode: 'set', durationMs: Number(select.value) });
			this.syncLoopCandidate();
		});
		document.getElementById('fitAnimationsToLoop')?.addEventListener('click', () => this.fitAnimationsToLoop());
		document.getElementById('resetAnimationLoop')?.addEventListener('click', () => this.resetAnimationLoop());
		document.getElementById('animationIncludeContent')?.addEventListener('click', () => this.includeAnimationsInLoop());
		const frames = document.getElementById('animationFrameOptions');
		const root = frames?.closest('.app-menu-popover');
		const panel = root?.querySelector('.app-menu-panel');
		if (panel) setupMenuPopover({ root, trigger: frames, panel, fixed: true, beforeOpen: async () => { this.fillFrameOptionsMenu(panel); await this.ensureFrameOptions(); this.fillFrameOptionsMenu(panel); } });
		document.getElementById('animationOpenTimeline')?.addEventListener('click', () => PREFERENCES.set('timelineOpen', true));
		this.scheduleExportDuration();
	},
	animationContentEnd() {
		return Math.max(0, ...listTimingTargets(this).filter(target => target.active !== false && this.layerManager.getLayerById(target.layerId)?.visible !== false)
			.map(target => Number.isFinite(target.run?.end) ? target.run.end : (target.run?.start || 0) + (target.period || 0)));
	},
	includeAnimationsInLoop() {
		const end = this.animationContentEnd(), current = this.resolveAnimationLoop().duration;
		if (!(end > current)) return false;
		if (end > CONFIG.export.timeline.setLoopRange.max) { this.updateStatus('The content exceeds the maximum loop length. Move or shorten it first.'); return false; }
		this.setDocumentLoop({ mode: 'set', durationMs: Math.ceil(end / CONFIG.export.timeline.renderClock.gifDelayQuantumMs) * CONFIG.export.timeline.renderClock.gifDelayQuantumMs });
		return true;
	},
	setupAnimationTransports() {
		this.animationTransports = [];
		const observer = new IntersectionObserver(entries => {
			for (const entry of entries) {
				const control = this.animationTransports.find(control => control.host === entry.target);
				if (control) {
					control.visible = entry.isIntersecting;
					if (!control.visible) control.cancel();
				}
			}
			this.syncAnimationTransports();
		});
		document.querySelectorAll('.animation-transport').forEach(host => {
			const button = (label, icon, run) => buildIconButton({ className: 'btn-flat is-icon', label, icon, onClick: run });
			const play = button('Play', 'motion-play', () => this.setPlayback(this.animationTicker.paused));
			const start = button('Go to loop start', 'arrow-left', () => this.animationTicker.goToStart());
			const back = button('Previous frame', 'chevron-left', () => this.animationTicker.step(-1));
			const forward = button('Next frame', 'chevron-right', () => this.animationTicker.step(1));
			const exact = button('Preview export', 'frame', async () => { const view = await this.ensurePreviewFrameView(); view.playExact(); this.syncAnimationTransports(); });
			exact.dataset.feature = 'timeline'; exact.hidden = !isFeatureAvailable('timeline');
			const loop = button('Animation loop', 'timeline', () => this.openAnimationLoop());
			for (const [button, label] of [[play, 'Play'], [exact, 'Preview export'], [loop, 'Loop settings']]) {
				button.classList.remove('is-icon'); button.append(buildElement('name', label, 'span'));
			}
			const seek = document.createElement('input'); seek.type = 'range'; seek.min = 0; seek.step = 'any'; seek.id = `${host.id}Seek`;
			const position = buildElement('animation-transport-position');
			const label = buildElement('property-note', 'Scene time', 'label'); label.htmlFor = seek.id;
			const time = document.createElement('output'); time.className = 'property-note'; time.setAttribute('aria-live', 'off');
			position.append(label, time);
			const controls = buildElement('animation-transport-actions'); controls.append(play, start, back, forward);
			const options = buildElement('animation-transport-options'); options.append(exact);
			if (!host.closest('#animationLoopSection')) options.append(loop);
			host.append(controls, position, seek, options);
			const control = { host, play, start, back, forward, exact, loop, seek, time, options, visible: false };
			const cancel = () => {
				if (!control.gesture) return;
				const previous = control.gesture; control.gesture = null;
				if (previous.epoch !== (this.animationRevisionEpoch || 0)) return;
				this.animationTicker.seek(previous.time); this.setPlayback(previous.playing);
				this.animationTicker.setRestPreview(previous.rest);
			};
			control.cancel = cancel;
			seek.addEventListener('pointerdown', () => { control.gesture = {
				time: this.animationTicker.getPlayheadTime(), playing: !this.animationTicker.paused, rest: Boolean(this.animationTicker.restPreview),
				epoch: this.animationRevisionEpoch || 0, layerId: this.activeLayerId
			}; });
			seek.addEventListener('input', () => { const ms = seek.valueAsNumber; this.setPlayback(false); this.animationTicker.seek(ms); });
			seek.addEventListener('pointerup', () => { control.gesture = null; });
			seek.addEventListener('pointercancel', cancel);
			seek.addEventListener('lostpointercapture', cancel);
			seek.addEventListener('blur', cancel);
			this.animationTransports.push(control); observer.observe(host);
		});
		const cancel = () => this.animationTransports.forEach(control => control.cancel());
		window.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;
			const control = this.animationTransports.find(control => control.gesture);
			if (!control) return;
			event.preventDefault(); event.stopImmediatePropagation(); control.cancel();
		}, true);
		window.addEventListener('blur', cancel);
		window.addEventListener('resize', cancel);
		document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
		for (const event of ['playbackChanged', 'animationChanged', 'layerChanged', 'imageLoaded', 'imageRemoved']) window.addEventListener(event, () => this.syncAnimationTransports());
		this.syncAnimationTransports();
	},
	syncAnimationTransports() {
		if (!this.animationTransports) return;
		const available = this.hasMotionForPlayback(), loop = this.resolveAnimationLoop();
		for (const control of this.animationTransports) {
			if (control.gesture && control.gesture.layerId !== this.activeLayerId) control.cancel();
			const label = this.animationTicker.paused ? 'Play' : 'Pause';
			control.play.title = label; control.play.setAttribute('aria-label', label);
			control.play.querySelector('.name').textContent = label;
			control.play.setAttribute('aria-pressed', String(!this.animationTicker.paused));
			control.play.querySelector('use').setAttribute('href', this.animationTicker.paused ? '#icon-motion-play' : '#icon-motion-pause');
			for (const button of [control.play, control.start, control.back, control.forward, control.seek]) button.disabled = !available || !(loop.duration > 0);
			control.seek.max = Math.max(0, loop.duration - 1);
			control.exact.hidden = !isFeatureAvailable('timeline');
			control.options.hidden = control.exact.hidden && !control.loop.isConnected;
			control.exact.disabled = !available || (!this.isLoopEstimateCurrent() && !this.previewFrameView?.exact && !this.previewFrameView?.done);
			control.exact.setAttribute('aria-pressed', String(Boolean(this.previewFrameView?.exact)));
			control.exact.setAttribute('aria-busy', String(Boolean(this.previewFrameView?.done && !this.previewFrameView?.exact)));
			control.exact.title = this.previewFrameView?.done && !this.previewFrameView?.exact ? 'Preparing Preview export' : this.previewFrameView?.exact ? 'Return to authored preview' : 'Preview export';
		}
		this.paintAnimationTransports(this.animationTicker.getPlayheadTime());
		if (available && this.animationTransports.some(control => control.visible)) {
			this.unsubscribeAnimationTransport ||= this.animationTicker.subscribeTick(ms => this.paintAnimationTransports(ms));
		} else { this.unsubscribeAnimationTransport?.(); this.unsubscribeAnimationTransport = null; }
	},
	paintAnimationTransports(ms) {
		for (const control of this.animationTransports) {
			if (!control.visible) continue;
			control.seek.value = ms; control.seek.setAttribute('aria-valuetext', formatSeconds(ms));
			control.time.textContent = `${formatSeconds(ms)} / ${formatSeconds(Number(control.seek.max) + 1)}`;
		}
	},
	openAnimationLoop() {
		['exportSettingsModal', 'exportPreviewModal'].forEach((id) => {
			if (document.getElementById(id)?.classList.contains('visible')) this.modalManager.close(id);
		});
		this.setTool(ToolType.SELECT);
		this.layerManager.clearSelection();
		this.refreshInspector();
		const section = document.getElementById('animationLoopSection');
		setPanelCardCollapsed(section, false);
		if (this.mobileManager?.isMobile) {
			const bar = this.mobileManager.chipBar;
			bar.render();
			const entry = bar.entries.find((candidate) => candidate.element === section);
			if (entry && (this.mobileManager.activeDrawer !== 'inspector' || this.mobileManager.sheetSection?.element !== section)) bar.pressChip(entry);
		}
		section.scrollIntoView({ block: 'nearest' });
		document.getElementById('animationLoopCandidate')?.focus({ preventScroll: true });
		this.updateExportDuration();
	},
	// A Cycle row sets how long one pass of the GIF its section shows takes.
	// `getKey` addresses the document timing target, independent of estimates.
	bindGifCycleControl(id, getKey) {
		const slider = document.getElementById(id);
		if (!slider) return;
		const control = { slider, getKey, source: null };
		control.binding = bindSlider(slider, document.getElementById(`${id}Value`), {
			parseValue: Number,
			cost: FIELDS.gifCycle.cost,
			formatValue: (seconds) => (control.source
				? `${formatUnit(formatSeconds(seconds * 1000, { unit: false }), FIELDS.gifCycle.unit)} (${Math.round(seconds * 1000 / control.source.fileCycleDuration * 100)}%)`
				: ''),
			resetValue: () => (control.source ? this.getGifCycleDefault(control.source) : undefined),
			resetButton: document.getElementById(`reset${id.charAt(0).toUpperCase()}${id.slice(1)}`),
			apply: async (seconds) => {
				const source = control.source;
				const layer = source && this.layerManager.getLayerById(source.ownerLayerId);
				if (!layer) return;
				this.writeTiming(source.key, { period: seconds * 1000 }, { live: true });
				getLayerManagerForType(this, layer.type)?.renderLayer?.(layer);
				this.requestPreviewUpdate();
				// The run lasts until the retimed image is on screen, so a slow
				// file waits for the value to settle.
				await this.previewImages.retimedPreviewsSettled();
			},
			onCommit: () => this.commitAnimationTiming('Change cycle')
		});
		(this.gifCycleControls ||= []).push(control);
	},
	// The slider value that puts a GIF back on its own timing.
	getGifCycleDefault(source) {
		return roundTo(source.fileCycleDuration, CONFIG.export.timeline.renderClock.gifDelayQuantumMs) / 1000;
	},
	// File timing ranges become available after their shared decode completes.
	syncGifCycleControls() {
		(this.gifCycleControls || []).forEach((control) => {
			const key = control.getKey();
			const target = listTimingTargets(this).find(entry => entry.key === key && entry.kind === 'gifCycle' && entry.can.period);
			control.source = target ? { ...target, ownerLayerId: target.layerId, naturalPeriod: target.period } : null;
			const { slider, source } = control;
			(slider.closest('[data-gif-cycle-set]') || slider.closest('.property-row')).hidden = !source;
			// The same source means the same estimate: the value on the track
			// is then newer than the one the source was built with.
			if (!source || control.synced === source) return;
			control.synced = source;
			slider.min = String(source.periodRange.min / 1000);
			slider.max = String(source.periodRange.max / 1000);
			const seconds = source.naturalPeriod / 1000;
			writeSliderValue(slider, seconds);
			control.binding.updateDisplay(seconds);
			control.binding.syncResetButton(seconds);
		});
	},
	syncAnimationLoop(estimate, message = 'No animation sources.') {
		this.loopEstimate = estimate;
		this.loopAnalysisRevision = (this.loopAnalysisRevision || 0) + 1;
		this.loopEstimatePending = false;
		this.loopEstimateFailed = !estimate && message !== 'No animation sources.';
		if (estimate?.duration > 0) this.lastLoopDuration = estimate.duration;
		this.syncAnimationTransports();
		this.animationTicker.setLoop(this.documentLoop.mode === 'set' ? this.documentLoop.durationMs : estimate?.duration);
		this.previewFrameView?.invalidate({ keepFrame: Boolean(this.keyRecording?.active) });
		this.syncGifCycleControls();
		this.animationTicker.refresh();
		this.timelineDock?.sync(estimate);
		const status = document.getElementById('animationLoopStatus');
		const sources = document.getElementById('animationLoopSources');
		const select = document.getElementById('animationLoopCandidate');
		if (!status || !sources || !select) return;
		const fit = estimate?.loopFit;
		['animationLoopSourceSet', 'animationLoopLengthSet', 'animationLoopActionSet'].forEach((id) => {
			document.getElementById(id).hidden = !fit?.sources.length;
		});
		status.replaceChildren();
		if (fit?.sources.length) {
			const clean = estimate.exact;
			const value = document.createElement('span'); value.className = 'property-result-value'; value.textContent = `${formatSeconds(estimate.duration)} loop`;
			const badge = document.createElement('span'); badge.className = `badge ${clean ? 'is-accent' : 'is-warning'}`;
			badge.textContent = clean ? 'Seamless' : 'Visible seam';
			badge.title = clean ? 'The loop closes cleanly.' : TimelineView.SEAM_TEXT;
			status.append(value, badge);
		} else status.textContent = message;
		const section = document.getElementById('animationLoopSection');
		if (section?.classList.contains('is-collapsed') || !section?.getClientRects().length) return;
		const analyses = new Map((estimate?.sourceAnalysis || []).map((entry) => [entry.key, entry]));
		const showBefore = (fit?.sources || []).some((source) => this.layerManager.getLayerById(source.ownerLayerId)?.loopOriginalPeriods?.[source.key] != null);
		sources.replaceChildren();
		const head = sources.createTHead().insertRow();
		['Source', 'Cycle', ...(showBefore ? ['Before'] : [])].forEach((label, index) => {
			const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label;
			if (index) cell.className = 'is-numeric';
			if (label === 'Before') cell.title = 'Timing saved before the first speed change';
			head.append(cell);
		});
		const body = sources.createTBody();
		(fit?.sources || []).forEach((source) => {
			const analysis = analyses.get(source.key);
			const period = source.kind === 'authored' ? source.cycleDuration : source.naturalPeriod;
			const resolved = analysis?.resolvedPeriod || period;
			const label = source.displayLabel;
			const title = `Edit ${label}${source.nonLooping ? ' (plays once)' : !source.adjustable ? ' (fixed timing)' : ''}${TimelineView.exportNote({ cycleMs: period, exportCycleMs: resolved })}`;
			const row = body.insertRow();
			const name = document.createElement('th'); name.scope = 'row';
			const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-text';
			button.textContent = label; button.title = title; button.setAttribute('aria-label', title);
			button.disabled = !source.ownerLayerId;
			button.addEventListener('click', () => this.layerManager.setActiveLayer(source.ownerLayerId));
			name.append(button); row.append(name);
			const previousPeriod = this.layerManager.getLayerById(source.ownerLayerId)?.loopOriginalPeriods?.[source.key];
			[period, ...(showBefore ? [previousPeriod] : [])].forEach((value) => {
				const cell = row.insertCell(); cell.className = 'is-numeric';
				cell.textContent = value == null ? '-' : `${formatSeconds(value)}`;
				if (value == null) cell.setAttribute('aria-label', 'No saved timing');
			});
		});
		select.replaceChildren(...(fit?.candidates || []).map((candidate) => {
			const option = document.createElement('option');
			option.value = String(candidate.duration);
			option.textContent = `${formatSeconds(candidate.duration)}${candidate.exact ? '' : ' / ends do not match'}`;
			return option;
		}));
		{
			const automatic = document.createElement('option'); automatic.value = 'auto'; automatic.textContent = 'Automatic';
			select.prepend(automatic);
			select.value = this.documentLoop.mode === 'set' ? String(this.documentLoop.durationMs) : 'auto';
		}
		select.disabled = !select.options.length;
		sources.hidden = !fit?.sources.length;
		sources.parentElement.hidden = sources.hidden;
		this.syncLoopCandidate();
	},
	getLoopCandidate() {
		const loop = this.resolveAnimationLoop();
		return loop.estimate?.loopFit.candidates.find((candidate) => candidate.duration === loop.duration);
	},
	syncLoopCandidate() {
		const fit = this.loopEstimate?.loopFit;
		const candidate = this.getLoopCandidate();
		const note = document.getElementById('animationLoopChanges');
		const button = document.getElementById('fitAnimationsToLoop');
		if (!note || !button) return;
		const notes = [];
		if (candidate) {
			candidate.fits.forEach((entry) => {
				const label = entry.source.displayLabel;
				if (!entry.fitted) notes.push(`Cannot fit ${label} within its available speeds.`);
				else if (Math.abs(entry.fittedPeriod - entry.source.naturalPeriod) > 0.01) notes.push(`${label}: ${formatSeconds(entry.source.naturalPeriod)} to ${formatSeconds(entry.fittedPeriod)}.`);
			});
			if (candidate.fixedSeamError >= 1e-8) notes.push(`Fixed sources (${fit.fixed.map((source) => source.displayLabel).join(', ')}) do not close at this length; editable speeds cannot close their seam.`);
		}
		if (fit?.oneShots.length) notes.push(`Finite animations (${fit.oneShots.map((source) => source.displayLabel).join(', ')}) keep their repeat counts; their speeds are left unchanged.`);
		note.textContent = notes.join('\n') || (candidate ? 'Timing already fits.' : '');
		note.hidden = !fit?.sources.length || !note.textContent;
		document.getElementById('animationLoopChangeSet').hidden = note.hidden;
		button.disabled = !candidate?.canApply;
		this.timelineDock?.syncControls();
		button.hidden = button.disabled;
		const reset = document.getElementById('resetAnimationLoop');
		if (reset) {
			reset.disabled = !this.hasLoopTimingToRestore();
			reset.hidden = reset.disabled;
		}
		const include = document.getElementById('animationIncludeContent');
		if (include) include.hidden = !(this.animationContentEnd() > this.resolveAnimationLoop().duration);
		// Offered here only when there is a timing to choose; the timeline's
		// frame count opens the same menu.
		const frames = document.getElementById('animationFrameOptions')?.closest('.app-menu-popover');
		if (frames) frames.hidden = !this.loopEstimate?.loopFit?.sources.length;
		document.getElementById('animationLoopLengthSet').hidden = !fit?.sources.length;
		document.getElementById('animationLoopActionSet').hidden = button.hidden && (!reset || reset.hidden) && (!frames || frames.hidden);
		this.animationPanel.loadTimingSummary();
	},
	hasLoopTimingToRestore() {
		return listTimingTargets(this).some(target => target.can.period && this.layerManager.getLayerById(target.layerId)?.loopOriginalPeriods?.[target.key] != null);
	},
	// The frame count's menu: what the export would write now, the timings
	// that would write fewer frames, and the way back to the saved timing.
	fillFrameOptionsMenu(panel) {
		if (!this.loopEstimate?.frameOptions && !this.frameMenuPending) { this.frameMenuPending = true; this.ensureFrameOptions().then(() => { if (panel.isConnected) this.fillFrameOptionsMenu(panel); }).finally(() => { this.frameMenuPending = false; }); }
		const options = this.isLoopEstimateCurrent() ? this.loopEstimate.frameOptions : null;
		const labels = CONFIG.export.timeline.frameOptions.labels;
		const heading = buildMenuLabel(options ? `About ${formatCount(options.frameCount, 'frame')} now` : this.loopEstimate?.frameOptionsError ? 'Could not measure frame options. Open this menu to retry.' : 'Measuring the animation');
		const entries = (options?.options || []).map(option => buildMenuItem({
			label: `${labels[option.kind]}: about ${formatCount(option.frameCount, 'frame')}, ${formatSeconds(option.duration)} loop`,
			run: () => this.applyFrameOption(option),
			title: option.fits.map(fit => `${fit.source.displayLabel}: ${formatSeconds(fit.source.naturalPeriod)} to ${formatSeconds(fit.fittedPeriod)}`).join('\n')
		}));
		if (options && !options.optimizable) entries.push(buildMenuItem({ label: 'No timing found with fewer frames' }));
		if (this.hasLoopTimingToRestore()) entries.push(buildMenuItem({
			label: 'Restore previous timing', run: () => this.resetAnimationLoop(), title: 'Restore the timing saved before the first speed change'
		}));
		panel.replaceChildren(heading, ...entries);
	},
	applyFrameOption(option) {
		if (this.isLoopEstimateCurrent() && this.loopEstimate.frameOptions?.options.includes(option)) this.applyLoopFits(option.fits, 'Change animation timing', `Animation timing changed: about ${formatCount(option.frameCount, 'frame')}`);
	},
	async fitAnimationsToLoop() {
		if (!this.isLoopEstimateCurrent()) await this.updateExportDuration();
		const candidate = this.getLoopCandidate();
		if (candidate?.canApply) this.applyLoopFits(candidate.fits, 'Fit animations to loop', 'Animation speeds fitted to the loop');
	},
	restoreAnimationPeriod(source) {
		const target = findTimingTarget(this, source.key);
		const layer = target && this.layerManager.getLayerById(target.layerId);
		const period = layer?.loopOriginalPeriods?.[source.key];
		if (period == null || !target.can.period) return false;
		this.writeTiming(source.key, { period }, { commit: false });
		delete layer.loopOriginalPeriods[source.key];
		if (!Object.keys(layer.loopOriginalPeriods).length) delete layer.loopOriginalPeriods;
		return true;
	},
	commitAnimationTiming(label, options) {
		this.layerManager.renderLayersList();
		this.refreshInspector();
		this.requestPreviewUpdate();
		this.saveState(label, options);
	},
	// Writes fitted periods as one undo step, saving each source's timing
	// from before its first speed change.
	applyLoopFits(fits, label, status) {
		let changed = false;
		fits.forEach((fit) => {
			if (Math.abs(fit.fittedPeriod - fit.source.naturalPeriod) < 0.01) return;
			if (!this.layerManager.getLayerById(fit.source.ownerLayerId)) return;
			changed = this.writeTiming(fit.key, { period: fit.fittedPeriod }, { commit: false }) || changed;
		});
		if (!changed) return;
		this.commitAnimationTiming(label);
		this.updateStatus(status);
	},
	resetAnimationLoop() {
		let changed = false;
		listTimingTargets(this).forEach((source) => {
			changed = this.restoreAnimationPeriod(source) || changed;
		});
		if (!changed) return;
		this.commitAnimationTiming('Restore previous animation timing');
		this.updateStatus('Restored previous animation timing');
	}
};
