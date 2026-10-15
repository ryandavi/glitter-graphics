const EDITOR_ANIMATION_LOOP_METHODS = {
	hasMotionForPlayback() { return Boolean(this.originalImage && listTimingTargets(this).some(target => target.active !== false && this.layerManager.getLayerById(target.layerId)?.visible !== false && (target.kind === 'gifCycle' || target.period > 0))); },
	writeTiming(key, patch, { label = 'Change animation timing', coalesceKey, commit = true, live = false } = {}) {
		const target = listTimingTargets(this).find(entry => entry.key === key);
		if (!target) return false;
		const names = { period: 'period', run: 'run', delayMs: 'run', iterations: 'run', phase: 'phase', direction: 'direction' };
		if (Object.keys(patch).some(name => !target.can[names[name]])) return false;
		const layer = this.layerManager.getLayerById(target.layerId);
		if (['period', 'delayMs', 'phase'].some(name => patch[name] != null && !Number.isFinite(patch[name]))) return false;
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
		this.requestPreviewUpdate();
		if (commit) this.saveState(mode === 'set' ? 'Set loop length' : 'Automatic loop length');
	},
	setupAnimationLoop() {
		document.getElementById('animationLoopSection')?.addEventListener('panelcollapsechange', event => { if (!event.detail.collapsed) this.syncAnimationLoop(this.loopEstimate); });
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
		const frames = document.getElementById('animationFrameOptions');
		const root = frames?.closest('.app-menu-popover');
		const panel = root?.querySelector('.app-menu-panel');
		if (panel) setupMenuPopover({ root, trigger: frames, panel, fixed: true, beforeOpen: async () => { this.fillFrameOptionsMenu(panel); await this.ensureFrameOptions(); this.fillFrameOptionsMenu(panel); } });
		document.getElementById('animationOpenTimeline')?.addEventListener('click', () => PREFERENCES.set('timelineOpen', true));
		this.scheduleExportDuration();
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
		const duration = this.documentLoop.mode === 'set' ? this.documentLoop.durationMs : this.loopEstimate?.duration;
		return this.loopEstimate?.loopFit.candidates.find((candidate) => candidate.duration === duration);
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
		// Offered here only when there is a timing to choose; the timeline's
		// frame count opens the same menu.
		const frames = document.getElementById('animationFrameOptions')?.closest('.app-menu-popover');
		if (frames) frames.hidden = !this.loopEstimate?.loopFit?.sources.length;
		document.getElementById('animationLoopLengthSet').hidden = !fit?.sources.length;
		document.getElementById('animationLoopActionSet').hidden = button.hidden && (!reset || reset.hidden) && (!frames || frames.hidden) && !isFeatureAvailable('timeline');
		const layer = this.layerManager.getActiveLayer();
		if (layer) { const prefix = this.animationPanel.prefixByType.get(layer.type); if (prefix) this.animationPanel.loadTimingStrip(prefix, layer); }
	},
	hasLoopTimingToRestore() {
		return listTimingTargets(this).some(target => target.can.period && this.layerManager.getLayerById(target.layerId)?.loopOriginalPeriods?.[target.key] != null);
	},
	// The frame count's menu: what the export would write now, the timings
	// that would write fewer frames, and the way back to the saved timing.
	fillFrameOptionsMenu(panel) {
		if (!this.loopEstimate?.frameOptions && !this.frameMenuPending) { this.frameMenuPending = true; this.ensureFrameOptions().then(() => { if (panel.isConnected) this.fillFrameOptionsMenu(panel); }).finally(() => { this.frameMenuPending = false; }); }
		const options = !this.loopEstimatePending && this.loopEstimate?.documentRevision === this.documentRevision ? this.loopEstimate?.frameOptions : null;
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
		if (!this.loopEstimatePending && this.loopEstimate?.documentRevision === this.documentRevision && this.loopEstimate?.frameOptions?.options.includes(option)) this.applyLoopFits(option.fits, 'Change animation timing', `Animation timing changed: about ${formatCount(option.frameCount, 'frame')}`);
	},
	async fitAnimationsToLoop() {
		if (this.loopEstimatePending) await this.refreshLoopEstimate();
		const candidate = this.getLoopCandidate();
		if (candidate?.canApply) this.applyLoopFits(candidate.fits, 'Fit animations to loop', 'Animation speeds fitted to the loop');
	},
	restoreAnimationPeriod(source) {
		const target = listTimingTargets(this).find(target => target.key === source.key);
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
		fits.forEach((fit) => {
			if (Math.abs(fit.fittedPeriod - fit.source.naturalPeriod) < 0.01) return;
			if (!this.layerManager.getLayerById(fit.source.ownerLayerId)) return;
			this.writeTiming(fit.key, { period: fit.fittedPeriod }, { commit: false });
		});
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
