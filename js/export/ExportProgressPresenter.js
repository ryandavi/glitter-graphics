class ExportProgressPresenter {
	constructor(editor) {
		this.editor = editor;
		this.card = document.getElementById('exportProgress');
		this.bar = this.card.querySelector('.export-progress-bar');
		for (const name of ['Fill', 'Text', 'Detail', 'Time', 'Percent', 'Announcement', 'Cancel']) {
			this[name === 'Cancel' ? 'cancelButton' : name.toLowerCase()] = document.getElementById(`exportProgress${name}`);
		}
	}

	show(target) {
		this.target = target;
		this.editor.exportCancelled = false;
		this.cancelButton.disabled = false;
		this.started = Date.now();
		this.value = 0;
		this.determinate = false;
		this.estimate = null;
		this.phase = '';
		this.text.textContent = `Exporting ${target.label}`;
		this.detail.textContent = 'Preparing export';
		this.time.textContent = '';
		this.announcement.textContent = '';
		this.fill.style.setProperty('--export-progress-offset', '-100%');
		this.percent.textContent = '';
		this.bar.removeAttribute('aria-valuenow');
		this.bar.setAttribute('aria-valuetext', this.detail.textContent);
		this.card.classList.add('visible', 'is-indeterminate');
		clearInterval(this.timer);
		this.timer = window.setInterval(() => this.updateTime(), CONFIG.export.progress.timerRefreshMs);
	}


	update(percent, message, current = 0, total = 0, info = {}) {
		if (this.editor.exportCancelled) return;
		this.value = Math.max(this.value, Math.max(0, Math.min(100, percent)));
		const becameDeterminate = !this.determinate && !info.indeterminate;
		this.determinate ||= !info.indeterminate;
		if (becameDeterminate) this.fill.style.transition = 'none';
		this.card.classList.toggle('is-indeterminate', !this.determinate);
		this.percent.textContent = this.determinate ? `${Math.round(this.value)}%` : '';
		if (this.determinate) this.bar.setAttribute('aria-valuenow', String(Math.round(this.value)));
		else this.bar.removeAttribute('aria-valuenow');
		this.fill.style.setProperty('--export-progress-offset', `${this.value - 100}%`);
		if (becameDeterminate) {
			// The first measured value must not animate backwards from the waiting chip.
			void this.fill.offsetWidth;
			this.fill.style.removeProperty('transition');
		}
		const phase = EXPORT_PROGRESS_PHASES[info.phaseKey];
		let label = phase?.label || info.phase || 'Preparing export';
		if (info.phaseKey === 'encoding') label += ` ${this.target.label}`;
		if (label !== this.phase) {
			this.phase = label;
			this.announcement.textContent = label;
		}
		current = info.phaseCurrent ?? current;
		total = info.phaseTotal ?? total;
		this.detail.textContent = info.detail || message || (phase?.noun && total > 0
			? `${phase.countLabel || label} ${phase.noun} ${current} of ${total}` : label);
		this.bar.setAttribute('aria-valuetext', this.detail.textContent);
		this.updateTime();
	}

	updateTime() {
		if (this.editor.exportCancelled) { this.time.textContent = ''; return; }
		const elapsed = Date.now() - this.started;
		const config = CONFIG.export.progress;
		if (this.value >= 100) { this.time.textContent = ''; return; }
		if (this.determinate && elapsed >= config.estimateAfterMs && this.value > config.estimateAfterPercent) {
			const remaining = elapsed * (100 - this.value) / this.value;
			if (this.estimate === null || remaining <= this.estimate
				|| remaining > this.estimate * config.estimateIncreaseFactor + config.estimateIncreaseMarginMs) this.estimate = remaining;
			this.time.textContent = this.estimate < config.almostDoneMs ? 'Almost done'
				: this.estimate < 60000 ? `About ${Math.round(this.estimate / 1000 / config.estimateRoundSeconds) * config.estimateRoundSeconds}s left`
					: `About ${Math.round(this.estimate / 60000)} min left`;
		} else {
			this.time.textContent = elapsed >= config.slowPhaseNoticeMs
				? this.editor.mobileManager.isMobile || Input.hasTouch || Input.isCoarse ? 'Keep this tab open' : 'Still working\u2026'
				: '';
		}
	}

	cancel() {
		if (!this.editor.exportInProgress || this.editor.exportCancelled) return;
		this.editor.exportCancelled = true;
		this.cancelButton.disabled = true;
		this.detail.textContent = 'Cancelling\u2026';
		this.announcement.textContent = this.detail.textContent;
		this.bar.setAttribute('aria-valuetext', this.detail.textContent);
		this.time.textContent = '';
	}

	hide() {
		clearInterval(this.timer);
		this.timer = null;
		this.card.classList.remove('visible', 'is-indeterminate');
	}
}
