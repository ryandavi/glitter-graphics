'use strict';

const NOTIFY_POLICY = Object.freeze({
	status: Object.freeze({ target: 'status', ttl: null }),
	error: Object.freeze({ target: 'toast', ttl: 5000, queue: true }),
	confirm: Object.freeze({ target: 'modal', ttl: null })
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
			errorClose: 'errorClose'
		});
		this.toast = nodes.toast;
		this.errorText = nodes.errorText;
		this.statusText = nodes.statusText;
		nodes.errorClose?.addEventListener('click', () => this.dismissError());
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
