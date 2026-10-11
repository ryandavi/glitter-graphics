'use strict';

const BOOT_TASKS = {
	tasks: new Map(),
	register(id, run, dependsOn = []) {
		if (this.tasks.has(id)) throw new Error(`Duplicate boot task: ${id}`);
		this.tasks.set(id, { run, dependsOn });
	}
};

class BootRunner {
	constructor(config) {
		this.config = config;
		this.editor = null;
		this.tasks = new Map();
		this.completed = new Set();
		this.stages = new Map(config.stages.map(({ id }) => {
			let resolve, reject;
			const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
			// A failed stage may have no waiting caller yet.
			promise.catch(() => {});
			return [id, { promise, resolve, reject }];
		}));
	}

	whenBooted(id) {
		const stage = this.stages.get(id);
		if (!stage) return Promise.reject(new Error(`Unknown boot stage: ${id}`));
		return stage.promise;
	}

	isComplete(id) { return this.completed.has(id); }

	runTask(id) {
		if (!this.tasks.has(id)) {
			const task = BOOT_TASKS.tasks.get(id);
			if (!task) return Promise.reject(new Error(`Unknown boot task: ${id}`));
			this.tasks.set(id, Promise.all(task.dependsOn.map((dependency) => this.runTask(dependency)))
				.then(() => task.run({ boot: this, editor: this.editor })));
		}
		return this.tasks.get(id);
	}

	async run(onStage) {
		for (const stage of this.config.stages) {
			if (stage.id === 'idle') await new Promise((resolve) => {
				if (window.requestIdleCallback) window.requestIdleCallback(resolve, { timeout: this.config.idleTimeoutMs });
				else setTimeout(resolve, 0);
			});
			const results = await Promise.allSettled(stage.tasks.map((id) => this.runTask(id)));
			const failure = results.find((result) => result.status === 'rejected');
			if (failure) {
				this.stages.get(stage.id).reject(failure.reason);
				document.body.classList.add('boot-failed');
				const notifications = this.editor?.notifications || new NotificationCenter();
				notifications.notify('error', `Could not load ${stage.id}: ${failure.reason.message}. Reload to try again.`);
				const start = document.getElementById('workspaceStart');
				start.inert = false;
				if (!this.isComplete('interactive')) start.querySelectorAll('button').forEach((button) => { button.disabled = true; });
				const reload = document.getElementById('bootReload');
				reload.hidden = false;
				reload.disabled = false;
				reload.onclick = () => location.reload();
				document.body.classList.remove('is-booting');
				continue;
			}
			if (stage.id === 'interactive') {
				const indicator = document.querySelector('.workspace-start-loading');
				const elapsed = indicator?.getAnimations().find((animation) => animation.animationName === 'boot-indicator')?.currentTime;
				const { delayMs, minVisibleMs } = this.config.indicator;
				if (elapsed >= delayMs && elapsed < delayMs + minVisibleMs) await new Promise((resolve) => setTimeout(resolve, delayMs + minVisibleMs - elapsed));
			}
			this.completed.add(stage.id);
			document.body.classList.add(`boot-${stage.id}`);
			if (stage.id === 'interactive') {
				document.getElementById('workspaceStart').inert = false;
				// Keep the committed stylesheet usable until its owner recompiles Sass.
				document.body.classList.remove('is-booting');
			}
			this.editor?.updateActionButtons();
			await onStage?.(stage.id, this.editor);
			performance.mark(`glitter:boot:${stage.id}`);
			this.stages.get(stage.id).resolve();
		}
	}
}

const APP_BOOT = new BootRunner(CONFIG.app.boot);
