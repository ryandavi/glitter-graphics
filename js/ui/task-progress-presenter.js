class TaskProgressPresenter {
	constructor(editor, card, onCancel) {
		this.editor = editor;
		this.card = card;
		this.onCancel = onCancel;
		this.bar = this.card.querySelector('.export-progress-bar');
		for (const name of ['Fill', 'Text', 'Detail', 'Time', 'Percent', 'Announcement', 'Cancel']) {
			this[name === 'Cancel' ? 'cancelButton' : name.toLowerCase()] = this.card.querySelector(`[id$="${name}"]`);
		}
		this.cancelButton.addEventListener('click', () => this.cancel());
		this.detail.classList.add('export-progress-detail');
		this.time.classList.add('export-progress-time');
		this.percent.classList.add('export-progress-percent');
	}

	static createCard(prefix) {
		const card = document.getElementById('exportProgress').cloneNode(true);
		card.id = prefix;
		card.classList.remove('visible', 'is-indeterminate');
		card.querySelectorAll('[id]').forEach(node => { node.id = node.id.replace('exportProgress', prefix); });
		document.getElementById('exportProgress').after(card);
		return card;
	}

	show({ title, detail }) {
		this.bar.setAttribute('aria-label', `${title} progress`);
		this.cancelled = false;
		this.active = true;
		this.cancelButton.disabled = false;
		this.started = Date.now();
		this.value = 0;
		this.determinate = false;
		this.estimate = null;
		this.phase = '';
		this.text.textContent = title;
		this.detail.textContent = detail;
		this.time.textContent = '';
		this.announcement.textContent = '';
		this.fill.style.setProperty('--export-progress-offset', '-100%');
		this.percent.textContent = '';
		this.bar.removeAttribute('aria-valuenow');
		this.bar.setAttribute('aria-valuetext', this.detail.textContent);
		this.card.classList.add('visible', 'is-indeterminate');
		this.claimSlot(true);
		clearInterval(this.timer);
		this.timer = window.setInterval(() => this.updateTime(), CONFIG.ui.taskProgress.timerRefreshMs);
	}


	update(percent, message, current = 0, total = 0, info = {}) {
		if (this.cancelled) return;
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
		const label = info.phase || message;
		if (label !== this.phase) {
			this.phase = label;
			this.announcement.textContent = label;
		}
		this.detail.textContent = info.detail || message || label;
		this.bar.setAttribute('aria-valuetext', this.detail.textContent);
		this.updateTime();
	}

	updateTime() {
		if (this.cancelled) { this.time.textContent = ''; return; }
		const elapsed = Date.now() - this.started;
		const config = CONFIG.ui.taskProgress;
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
		if (!this.active || this.cancelled) return;
		this.cancelled = true;
		this.cancelButton.disabled = true;
		this.detail.textContent = 'Cancelling\u2026';
		this.announcement.textContent = this.detail.textContent;
		this.bar.setAttribute('aria-valuetext', this.detail.textContent);
		this.time.textContent = '';
		this.onCancel?.();
	}

	hide() {
		this.active = false;
		clearInterval(this.timer);
		this.timer = null;
		this.card.classList.remove('visible', 'is-indeterminate');
		this.claimSlot(false);
	}

	// The card shares the top-center zone with the activity pill and the hint;
	// while a task runs, its card replaces the pill and the hint.
	claimSlot(claimed) {
		this.editor.activeProgressCards ||= new Set();
		if (claimed) this.editor.activeProgressCards.add(this.card);
		else this.editor.activeProgressCards.delete(this.card);
		this.editor.notifications.suspendActivity(this.editor.activeProgressCards.size > 0);
		this.editor.updateHelpfulMessage();
	}
}
