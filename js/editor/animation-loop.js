const EDITOR_ANIMATION_LOOP_METHODS = {
	setDocumentLoop({ mode, durationMs } = CONFIG.project.loop, { commit = true } = {}) {
		const config = CONFIG.export.timeline;
		const loop = mode === 'set' ? {
			mode, durationMs: clampNumber(roundTo(Number(durationMs), config.renderClock.gifDelayQuantumMs), config.setLoopRange.min, config.setLoopRange.max)
		} : { ...CONFIG.project.loop };
		if (commit && this.documentLoop.mode === loop.mode && this.documentLoop.durationMs === loop.durationMs) return;
		this.documentLoop = loop;
		this.scheduleExportDuration();
		this.requestPreviewUpdate();
		if (commit) this.saveState(mode === 'set' ? 'Set loop length' : 'Automatic loop length');
	},
	setupAnimationLoop() {
		const select = document.getElementById('animationLoopCandidate');
		if (select && isFeatureEnabled('loopLength')) {
			select.closest('.property-row').querySelector('.property-label').textContent = 'Loop length';
			select.setAttribute('aria-label', 'Loop length');
		}
		select?.addEventListener('change', () => {
			if (isFeatureEnabled('loopLength')) this.setDocumentLoop(select.value === 'auto' ? CONFIG.project.loop : { mode: 'set', durationMs: Number(select.value) });
			this.syncLoopCandidate();
		});
		document.getElementById('fitAnimationsToLoop')?.addEventListener('click', () => this.fitAnimationsToLoop());
		document.getElementById('resetAnimationLoop')?.addEventListener('click', () => this.resetAnimationLoop());
		const frames = document.getElementById('animationFrameOptions');
		const root = frames?.closest('.app-menu-popover');
		const panel = root?.querySelector('.app-menu-panel');
		if (panel) setupMenuPopover({ root, trigger: frames, panel, fixed: true, beforeOpen: () => this.fillFrameOptionsMenu(panel) });
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
	// It writes through that source's own setter, the one Fit and Restore call,
	// so there is one writer and one range. `getKey` returns the timeline key of
	// the GIF the section is showing, or null.
	bindGifCycleControl(id, getKey) {
		const slider = document.getElementById(id);
		if (!slider) return;
		const control = { slider, getKey, source: null };
		control.binding = bindSlider(slider, document.getElementById(`${id}Value`), {
			parseValue: Number,
			cost: FIELDS.gifCycle.cost,
			formatValue: (seconds) => (control.source
				? `${formatUnit(seconds.toFixed(2), FIELDS.gifCycle.unit)} (${Math.round(seconds * 1000 / control.source.fileCycleDuration * 100)}%)`
				: ''),
			resetValue: () => (control.source ? this.getGifCycleDefault(control.source) : undefined),
			resetButton: document.getElementById(`reset${id.charAt(0).toUpperCase()}${id.slice(1)}`),
			apply: async (seconds) => {
				const source = control.source;
				const layer = source && this.layers.find((entry) => entry.id === source.ownerLayerId);
				if (!layer) return;
				source.setPeriod(seconds * 1000);
				getLayerManagerForType(this, layer.type)?.renderLayer?.(layer);
				this.requestPreviewUpdate();
				// The run lasts until the retimed image is on screen, so a slow
				// file waits for the value to settle.
				await this.animationPanel.retimedPreviewsSettled();
			},
			onCommit: () => this.saveState('Change animation speed')
		});
		(this.gifCycleControls ||= []).push(control);
	},
	// The slider value that puts a GIF back on its own timing.
	getGifCycleDefault(source) {
		return roundTo(source.fileCycleDuration, CONFIG.export.timeline.renderClock.gifDelayQuantumMs) / 1000;
	},
	// Rows follow the estimate, which is where the sources and their ranges
	// come from. While it is being recomputed a row keeps the source it has,
	// unless its section now shows a different GIF.
	syncGifCycleControls() {
		(this.gifCycleControls || []).forEach((control) => {
			const key = control.getKey();
			if (key == null || this.loopEstimate) {
				control.source = key == null ? null : this.loopEstimate.loopFit.sources.find((source) => source.key === key && source.fileCycleDuration && typeof source.setPeriod === 'function') || null;
			} else if (control.source?.key !== key) control.source = null;
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
		this.animationTicker.setLoop(estimate?.duration);
		this.syncGifCycleControls();
		if (isFeatureAvailable('timeline')) this.timelineDock?.sync(estimate);
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
			const value = document.createElement('span'); value.className = 'property-result-value'; value.textContent = `${(estimate.duration / 1000).toFixed(2)} s loop`;
			const badge = document.createElement('span'); badge.className = `badge ${clean ? 'is-accent' : 'is-warning'}`;
			badge.textContent = clean ? 'Seamless' : 'Visible seam';
			badge.title = clean ? 'The loop closes cleanly.' : 'The end does not match the start.';
			status.append(value, badge);
		} else status.textContent = message;
		const analyses = new Map((estimate?.sourceAnalysis || []).map((entry) => [entry.key, entry]));
		const showBefore = (fit?.sources || []).some((source) => this.layers.find((layer) => layer.id === source.ownerLayerId)?.loopOriginalPeriods?.[source.key] != null);
		sources.replaceChildren();
		const head = sources.createTHead().insertRow();
		['Source', 'Current', ...(showBefore ? ['Before'] : [])].forEach((label, index) => {
			const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label;
			if (index) cell.className = 'is-numeric';
			if (label === 'Before') cell.title = 'Timing saved before the first fit';
			head.append(cell);
		});
		const body = sources.createTBody();
		(fit?.sources || []).forEach((source) => {
			const analysis = analyses.get(source.key);
			const period = source.kind === 'authored' ? source.cycleDuration : source.naturalPeriod;
			const resolved = analysis?.resolvedPeriod || period;
			const label = source.label || source.key;
			const title = `Edit ${label}${source.nonLooping ? ' (plays once)' : typeof source.setPeriod !== 'function' ? ' (fixed timing)' : ''}${Math.abs(resolved - period) > 0.01 ? `. Export uses ${(resolved / 1000).toFixed(2)} s.` : ''}`;
			const row = body.insertRow();
			const name = document.createElement('th'); name.scope = 'row';
			const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-text';
			button.textContent = label; button.title = title; button.setAttribute('aria-label', title);
			button.disabled = !source.ownerLayerId;
			button.addEventListener('click', () => this.layerManager.setActiveLayer(source.ownerLayerId));
			name.append(button); row.append(name);
			const previousPeriod = this.layers.find((layer) => layer.id === source.ownerLayerId)?.loopOriginalPeriods?.[source.key];
			[period, ...(showBefore ? [previousPeriod] : [])].forEach((value) => {
				const cell = row.insertCell(); cell.className = 'is-numeric';
				cell.textContent = value == null ? '-' : `${(value / 1000).toFixed(2)} s`;
				if (value == null) cell.setAttribute('aria-label', 'No saved timing');
			});
		});
		const loopLengthEnabled = isFeatureEnabled('loopLength');
		const previous = select.value;
		select.replaceChildren(...(fit?.candidates || []).map((candidate) => {
			const option = document.createElement('option');
			option.value = String(candidate.duration);
			option.textContent = `${(candidate.duration / 1000).toFixed(2)} s${candidate.exact ? '' : ' / ends do not match'}`;
			return option;
		}));
		if (loopLengthEnabled) {
			const automatic = document.createElement('option'); automatic.value = 'auto'; automatic.textContent = 'Automatic';
			select.prepend(automatic);
			select.value = this.documentLoop.mode === 'set' ? String(this.documentLoop.durationMs) : 'auto';
		} else {
			if (Array.from(select.options).some((option) => option.value === previous)) select.value = previous;
			else if (Array.from(select.options).some((option) => Number(option.value) === estimate?.duration)) select.value = String(estimate.duration);
		}
		select.disabled = !select.options.length;
		sources.hidden = !fit?.sources.length;
		sources.parentElement.hidden = sources.hidden;
		this.syncLoopCandidate();
	},
	getLoopCandidate() {
		const duration = isFeatureEnabled('loopLength')
			? (this.documentLoop.mode === 'set' ? this.documentLoop.durationMs : this.loopEstimate?.duration)
			: Number(document.getElementById('animationLoopCandidate')?.value);
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
				const label = entry.source.label || entry.source.key;
				if (!entry.fitted) notes.push(`Cannot fit ${label} within its available speeds.`);
				else if (Math.abs(entry.fittedPeriod - entry.source.naturalPeriod) > 0.01) notes.push(`${label}: ${(entry.source.naturalPeriod / 1000).toFixed(2)} s to ${(entry.fittedPeriod / 1000).toFixed(2)} s.`);
			});
			if (candidate.fixedSeamError >= 1e-8) notes.push(`Fixed sources (${fit.fixed.map((source) => source.label || source.key).join(', ')}) do not close at this length; editable speeds cannot close their seam.`);
		}
		if (fit?.oneShots.length) notes.push(`Finite animations (${fit.oneShots.map((source) => source.label || source.key).join(', ')}) keep their repeat counts; their speeds are left unchanged.`);
		note.textContent = notes.join('\n') || (candidate ? 'Timing already fits.' : '');
		note.hidden = !fit?.sources.length || !note.textContent;
		document.getElementById('animationLoopChangeSet').hidden = note.hidden;
		button.disabled = !candidate?.canApply;
		if (isFeatureAvailable('timeline')) this.timelineDock?.syncControls();
		button.hidden = button.disabled;
		const reset = document.getElementById('resetAnimationLoop');
		if (reset) {
			reset.disabled = !this.hasLoopTimingToRestore();
			reset.hidden = reset.disabled;
		}
		// Offered here only when there is a timing to choose; the timeline's
		// frame count opens the same menu.
		const frames = document.getElementById('animationFrameOptions')?.closest('.app-menu-popover');
		if (frames) frames.hidden = !this.loopEstimate?.frameOptions.options.length;
		document.getElementById('animationLoopLengthSet').hidden = isFeatureEnabled('loopLength') ? !fit?.sources.length : !fit?.candidates.some((entry) => entry.canApply);
		document.getElementById('animationLoopActionSet').hidden = button.hidden && (!reset || reset.hidden) && (!frames || frames.hidden);
	},
	hasLoopTimingToRestore() {
		return (this.loopEstimate?.loopFit.sources || []).some((source) => {
			const before = this.layers.find((layer) => layer.id === source.ownerLayerId)?.loopOriginalPeriods?.[source.key];
			return typeof source.setPeriod === 'function' && before != null && Math.abs(before - source.naturalPeriod) > 0.01;
		});
	},
	// The frame count's menu: what the export would write now, the timings
	// that would write fewer frames, and the way back to the saved timing.
	fillFrameOptionsMenu(panel) {
		const options = this.loopEstimate?.frameOptions;
		const labels = CONFIG.export.timeline.frameOptions.labels;
		const item = (label, run = null, title = '') => {
			const button = document.createElement('button');
			button.type = 'button'; button.className = 'app-menu-item'; button.textContent = label;
			button.setAttribute('role', 'menuitem');
			if (title) button.title = title;
			if (run) button.addEventListener('click', run);
			else button.disabled = true;
			return button;
		};
		const heading = document.createElement('div');
		heading.className = 'app-menu-group-label';
		heading.textContent = options ? `About ${options.frameCount} ${options.frameCount === 1 ? 'frame' : 'frames'} now` : 'Measuring the animation';
		const seconds = (ms) => `${(ms / 1000).toFixed(2)} s`;
		const entries = (options?.options || []).map((option) => item(
			`${labels[option.kind]}: about ${option.frameCount} ${option.frameCount === 1 ? 'frame' : 'frames'}, ${seconds(option.duration)} loop`,
			() => this.applyFrameOption(option),
			option.fits.map((fit) => `${fit.source.label || fit.source.key}: ${seconds(fit.source.naturalPeriod)} to ${seconds(fit.fittedPeriod)}`).join('\n')
		));
		if (options && !options.optimizable) entries.push(item('No timing found with fewer frames'));
		if (this.hasLoopTimingToRestore()) entries.push(item('Restore previous timing', () => this.resetAnimationLoop(), 'Restore the timing saved before the first loop fit'));
		panel.replaceChildren(heading, ...entries);
	},
	applyFrameOption(option) {
		if (this.loopEstimate?.frameOptions.options.includes(option)) this.applyLoopFits(option.fits, 'Change animation timing', `Animation timing changed: about ${option.frameCount} ${option.frameCount === 1 ? 'frame' : 'frames'}`);
	},
	fitAnimationsToLoop() {
		const candidate = this.getLoopCandidate();
		if (candidate?.canApply) this.applyLoopFits(candidate.fits, 'Fit animations to loop', 'Animation speeds fitted to the loop');
	},
	// Writes fitted periods as one undo step, saving each source's timing
	// from before its first fit.
	applyLoopFits(fits, label, status) {
		// A queued estimate is invalidated on every document commit or restore,
		// so these setters always belong to the current layer objects.
		fits.forEach((fit) => {
			if (Math.abs(fit.fittedPeriod - fit.source.naturalPeriod) < 0.01) return;
			const layer = this.layers.find((entry) => entry.id === fit.source.ownerLayerId);
			if (!layer) return;
			layer.loopOriginalPeriods ||= {};
			layer.loopOriginalPeriods[fit.source.key] ??= fit.source.naturalPeriod;
			fit.source.setPeriod(fit.fittedPeriod);
		});
		this.layerManager.renderLayersList();
		this.refreshInspector();
		this.requestPreviewUpdate();
		this.saveState(label);
		this.updateStatus(status);
	},
	resetAnimationLoop() {
		let changed = false;
		(this.loopEstimate?.loopFit.sources || []).forEach((source) => {
			const layer = this.layers.find((entry) => entry.id === source.ownerLayerId);
			const period = layer?.loopOriginalPeriods?.[source.key];
			if (period == null || typeof source.setPeriod !== 'function') return;
			source.setPeriod(period);
			delete layer.loopOriginalPeriods[source.key];
			if (!Object.keys(layer.loopOriginalPeriods).length) delete layer.loopOriginalPeriods;
			changed = true;
		});
		if (!changed) return;
		document.getElementById('animationLoopCandidate').value = '';
		this.layerManager.renderLayersList();
		this.refreshInspector();
		this.requestPreviewUpdate();
		this.saveState('Restore previous animation timing');
		this.updateStatus('Restored animation timing from before fitting');
	}
};
