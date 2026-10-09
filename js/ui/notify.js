'use strict';

const NOTIFY_POLICY = Object.freeze({
	status: Object.freeze({ target: 'status', ttl: null }),
	error: Object.freeze({ target: 'toast', ttl: 5000, queue: true }),
	confirm: Object.freeze({ target: 'modal', ttl: null }),
	// Work that has not become visible yet. Shown in the canvas pill, the one
	// busy signal that exists on mobile (the status bar is hidden there).
	activity: Object.freeze({ target: 'pill', ttl: null })
});

class NotificationCenter {
	constructor() {
		this.queue = [];
		this.activeToken = null;
		this.timer = null;
		const nodes = els({
			toast: 'errorToast',
			errorText: 'errorText',
			statusText: 'statusText',
			errorClose: 'errorClose',
			pill: 'canvasActivity',
			pillMode: 'canvasActivityMode',
			pillModeIcon: 'canvasActivityModeIcon',
			pillModeLabel: 'canvasActivityModeLabel',
			pillModeBadge: 'canvasActivityModeBadge',
			pillStatus: 'canvasActivityStatus',
			pillActions: 'canvasActivityActions',
			pillExit: 'canvasActivityExit',
			pillConfirm: 'canvasActivityConfirm'
		});
		this.toast = nodes.toast;
		this.errorText = nodes.errorText;
		this.statusText = nodes.statusText;
		nodes.errorClose?.addEventListener('click', () => this.dismissError());

		this.pill = nodes;
		this.activities = new Map();
		this.mode = null;
		this.activityShown = false;
		this.activityShownAt = 0;
		this.activityShowTimer = null;
		this.activityHideTimer = null;
		this.activitySuspended = false;
		initializeInlineProcessingStatus(nodes.pillStatus);
		nodes.pillExit?.addEventListener('click', () => this.mode?.onExit?.());
		nodes.pillConfirm?.addEventListener('click', () => this.mode?.onConfirm?.());
	}

	// Returns an idempotent `done`. Beginning a key that is already running
	// replaces its label and keeps its place, so a superseded run never stacks,
	// and an older run's `done` cannot end the newer one.
	beginActivity(key, label) {
		const token = Symbol(key);
		this.activities.delete(key);
		this.activities.set(key, { token, label, current: 0, total: 0, startedAt: Date.now() });
		this.syncActivity();
		return () => {
			if (this.activities.get(key)?.token === token) this.endActivity(key);
		};
	}

	updateActivity(key, changes = {}) {
		const entry = this.activities.get(key);
		if (!entry) return;
		Object.assign(entry, changes);
		this.syncActivity();
	}

	endActivity(key) {
		if (this.activities.delete(key)) this.syncActivity();
	}

	// A session mode (Auto Glitter, Crop) occupies the pill for as long as it
	// lasts: { label, icon, badge, exitLabel, onExit, confirmLabel, onConfirm },
	// or null to leave the mode. Leaving and committing a mode live here, not in
	// its context bar.
	setMode(mode) {
		this.mode = mode || null;
		const { pill, pillMode, pillModeIcon, pillModeLabel, pillModeBadge, pillActions, pillExit, pillConfirm } = this.pill;
		const hasActions = Boolean(this.mode?.onExit || this.mode?.onConfirm);
		if (pillActions) pillActions.hidden = !hasActions;
		pill?.classList.toggle('has-actions', hasActions);
		if (pillConfirm) {
			pillConfirm.hidden = !this.mode?.onConfirm;
			pillConfirm.disabled = false;
			// Icon only: the label is the tooltip and the accessible name.
			pillConfirm.title = pillConfirm.querySelector('.name').textContent = this.mode?.confirmLabel || 'Done';
		}
		if (pillMode) {
			pillMode.hidden = !this.mode;
			// The label gives way in a narrow workspace; the name stays reachable.
			pillMode.title = this.mode?.label || '';
		}
		if (pillExit) pillExit.hidden = !this.mode?.onExit;
		if (this.mode) {
			pillModeIcon?.setAttribute('href', `#icon-${this.mode.icon}`);
			if (pillModeLabel) {
				pillModeLabel.style.width = '';
				pillModeLabel.textContent = this.mode.label;
				this.modeLabelMeasureCtx ||= createAppCanvas(1, 1, 'ui/notify').getContext('2d');
				this.modeLabelMeasureCtx.font = getComputedStyle(pillModeLabel).font;
				pillModeLabel.style.width = `${Math.ceil(this.modeLabelMeasureCtx.measureText(this.mode.label).width)}px`;
			}
			if (pillModeBadge) {
				pillModeBadge.hidden = !this.mode.badge;
				pillModeBadge.textContent = this.mode.badge || '';
			}
			if (pillExit) pillExit.title = pillExit.querySelector('.name').textContent = this.mode.exitLabel || 'Exit';
		}
		this.renderActivity();
	}

	setConfirmEnabled(enabled) {
		if (this.pill.pillConfirm) this.pill.pillConfirm.disabled = !enabled;
	}

	// The export card takes over the pill's slot while it is open.
	suspendActivity(suspended) {
		this.activitySuspended = Boolean(suspended);
		this.renderActivity();
	}

	// Work shorter than showDelayMs shows nothing; once shown, the spinner
	// stays for minVisibleMs so it never flashes.
	syncActivity() {
		const { showDelayMs, minVisibleMs } = CONFIG.ui.activity;
		if (this.activities.size) {
			clearTimeout(this.activityHideTimer);
			this.activityHideTimer = null;
			if (this.activityShown) this.renderActivity();
			else if (!this.activityShowTimer) {
				this.activityShowTimer = setTimeout(() => {
					this.activityShowTimer = null;
					if (!this.activities.size) return;
					this.activityShown = true;
					this.activityShownAt = Date.now();
					this.renderActivity();
				}, showDelayMs);
			}
			return;
		}
		clearTimeout(this.activityShowTimer);
		this.activityShowTimer = null;
		if (!this.activityShown || this.activityHideTimer) return;
		this.activityHideTimer = setTimeout(() => {
			this.activityHideTimer = null;
			if (this.activities.size) return;
			this.activityShown = false;
			this.renderActivity();
		}, Math.max(0, minVisibleMs - (Date.now() - this.activityShownAt)));
	}

	renderActivity() {
		const { pill, pillStatus } = this.pill;
		if (!pill) return;
		const entry = Array.from(this.activities.values()).pop();
		const active = this.activityShown && Boolean(entry);
		if (active) {
			const stale = Date.now() - entry.startedAt > CONFIG.ui.activity.staleWarningMs;
			if (stale) dbg('Activity still running:', entry.label);
		}
		// While the spinner runs out its minimum time the last label stays put.
		if (active || !this.activityShown) {
			setInlineProcessingStatus(pillStatus, {
				active,
				label: active && entry.total > 0 ? `${entry.label} ${entry.current}/${entry.total}` : entry?.label
			});
		}
		pill.classList.toggle('has-mode', Boolean(this.mode));
		pill.classList.toggle('is-busy', Boolean(this.mode && this.activityShown));
		this.pill.pillModeIcon?.parentElement?.parentElement?.classList.toggle('inline-processing-spinner', Boolean(this.mode && this.activityShown));
		const label = this.pill.pillModeLabel;
		if (label && this.mode) {
			label.textContent = this.activityShown ? pillStatus?.querySelector('.inline-processing-label')?.textContent || this.mode.label : this.mode.label;
		}
		pill.hidden = this.activitySuspended || !(this.mode || this.activityShown);
	}

	notify(kind, message) {
		const policy = NOTIFY_POLICY[kind];
		if (!policy) throw new Error(`Unknown notification kind: ${kind}`);
		if (policy.target === 'status') {
			if (this.statusText) this.statusText.textContent = message;
			return;
		}
		if (policy.target === 'toast') {
			this.queue.push(String(message));
			this.drainErrors();
		}
	}

	drainErrors() {
		if (this.activeToken || !this.queue.length) return;
		const token = Symbol('error-toast');
		this.activeToken = token;
		if (this.errorText) this.errorText.textContent = this.queue.shift();
		this.toast?.classList.add('visible');
		this.timer = setTimeout(() => {
			if (this.activeToken !== token) return;
			this.dismissError();
		}, NOTIFY_POLICY.error.ttl);
	}

	dismissError() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.toast?.classList.remove('visible');
		this.activeToken = null;
		setTimeout(() => this.drainErrors(), 0);
	}
}
