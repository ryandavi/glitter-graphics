const EDITOR_ANIMATION_LOOP_METHODS = {
	setupAnimationLoop() {
		document.getElementById('animationLoopCandidate')?.addEventListener('change', () => this.syncLoopCandidate());
		document.getElementById('fitAnimationsToLoop')?.addEventListener('click', () => this.fitAnimationsToLoop());
		document.getElementById('resetAnimationLoop')?.addEventListener('click', () => this.resetAnimationLoop());
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

	syncAnimationLoop(estimate, message = 'No animation sources.') {
		this.loopEstimate = estimate;
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
			const clean = estimate.exact && !fit.oneShots.length;
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
		const previous = select.value;
		select.replaceChildren(...(fit?.candidates || []).map((candidate) => {
			const option = document.createElement('option');
			option.value = String(candidate.duration);
			option.textContent = `${(candidate.duration / 1000).toFixed(2)} s${candidate.exact ? '' : ' / ends do not match'}`;
			return option;
		}));
		if (Array.from(select.options).some((option) => option.value === previous)) select.value = previous;
		else if (Array.from(select.options).some((option) => Number(option.value) === estimate?.duration)) select.value = String(estimate.duration);
		select.disabled = !select.options.length;
		sources.hidden = !fit?.sources.length;
		sources.parentElement.hidden = sources.hidden;
		this.syncLoopCandidate();
	},

	getLoopCandidate() {
		const duration = Number(document.getElementById('animationLoopCandidate')?.value);
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
			if (!fit.fixedLoop.exact) notes.push(`Fixed sources (${fit.fixed.map((source) => source.label || source.key).join(', ')}) share no loop within the limit. This is the closest loop; editable speeds cannot close its seam.`);
		}
		if (fit?.oneShots.length) notes.push(`One-shot animations (${fit.oneShots.map((source) => source.label || source.key).join(', ')}) do not repeat; their speeds are left unchanged.`);
		note.textContent = notes.join('\n') || (candidate ? 'Timing already fits.' : '');
		note.hidden = !fit?.sources.length || !note.textContent;
		document.getElementById('animationLoopChangeSet').hidden = note.hidden;
		button.disabled = !candidate?.canApply;
		button.hidden = button.disabled;
		const reset = document.getElementById('resetAnimationLoop');
		if (reset) {
			reset.disabled = !(fit?.sources || []).some((source) => {
				const before = this.layers.find((layer) => layer.id === source.ownerLayerId)?.loopOriginalPeriods?.[source.key];
				return typeof source.setPeriod === 'function' && before != null && Math.abs(before - source.naturalPeriod) > 0.01;
			});
			reset.hidden = reset.disabled;
		}
		document.getElementById('animationLoopLengthSet').hidden = !fit?.candidates.some((entry) => entry.canApply);
		document.getElementById('animationLoopActionSet').hidden = button.hidden && (!reset || reset.hidden);
	},

	fitAnimationsToLoop() {
		const candidate = this.getLoopCandidate();
		if (!candidate?.canApply) return;
		// A queued estimate is invalidated on every document commit or restore,
		// so these setters always belong to the current layer objects.
		candidate.fits.forEach((fit) => {
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
		this.saveState('Fit animations to loop');
		this.updateStatus('Animation speeds fitted to the loop');
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
