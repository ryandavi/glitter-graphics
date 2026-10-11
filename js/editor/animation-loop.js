const EDITOR_ANIMATION_LOOP_METHODS = {
	setupAnimationLoop() {
		document.getElementById('openAnimationLoop')?.addEventListener('click', () => this.openAnimationLoop());
		document.getElementById('animationLoopCandidate')?.addEventListener('change', () => this.syncLoopCandidate());
		document.getElementById('fitAnimationsToLoop')?.addEventListener('click', () => this.fitAnimationsToLoop());
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
		status.textContent = fit?.sources.length
			? `${(estimate.duration / 1000).toFixed(2)} s, ${estimate.exact && !fit.oneShots.length ? 'seamless' : 'ends do not match'}`
			: message;
		const analyses = new Map((estimate?.sourceAnalysis || []).map((entry) => [entry.key, entry]));
		sources.replaceChildren(...(fit?.sources || []).map((source) => {
			const analysis = analyses.get(source.key);
			const period = source.kind === 'authored' ? source.cycleDuration : source.naturalPeriod;
			const resolved = analysis?.resolvedPeriod || period;
			const row = document.createElement('button');
			row.type = 'button'; row.className = 'btn-flat list-row';
			const text = document.createElement('span'); text.className = 'list-row-text';
			const name = document.createElement('span'); name.className = 'list-row-name'; name.textContent = source.label || source.key;
			const detail = document.createElement('span'); detail.className = 'list-row-meta';
			detail.textContent = `${(period / 1000).toFixed(2)} s / ${(estimate.duration / resolved).toFixed(2)} plays${source.nonLooping ? ' / one-shot' : typeof source.setPeriod !== 'function' ? ' / fixed' : ''}${Math.abs(resolved - period) > 0.01 ? ` / export fits to ${(resolved / 1000).toFixed(2)} s` : ''}`;
			text.append(name, detail); row.append(text);
			row.title = `${name.textContent}: ${detail.textContent}`;
			row.setAttribute('aria-label', row.title);
			row.disabled = !source.ownerLayerId;
			row.addEventListener('click', () => this.layerManager.setActiveLayer(source.ownerLayerId));
			return row;
		}));
		const previous = select.value;
		select.replaceChildren(...(fit?.candidates || []).map((candidate) => {
			const option = document.createElement('option');
			option.value = String(candidate.duration);
			option.textContent = `${(candidate.duration / 1000).toFixed(2)} s${candidate.exact ? '' : ' / ends do not match'}`;
			return option;
		}));
		if (Array.from(select.options).some((option) => option.value === previous)) select.value = previous;
		select.disabled = !select.options.length;
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
		note.textContent = notes.join(' ') || (candidate ? 'Editable animation speeds already fit this loop.' : 'Add animated artwork or an animated look to plan a loop.');
		button.disabled = !candidate?.canApply;
	},

	fitAnimationsToLoop() {
		const candidate = this.getLoopCandidate();
		if (!candidate?.canApply) return;
		// A queued estimate is invalidated on every document commit or restore,
		// so these setters always belong to the current layer objects.
		candidate.fits.forEach((fit) => fit.source.setPeriod(fit.fittedPeriod));
		this.layerManager.renderLayersList();
		this.refreshInspector();
		this.requestPreviewUpdate();
		this.saveState('Fit animations to loop');
		this.updateStatus('Animation speeds fitted to the loop');
	}
};
