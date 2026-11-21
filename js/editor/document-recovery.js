'use strict';

// Decides when the recovery copy is written. `schedule()` after each edit
// writes `debounceMs` after the last one, and never later than `maxWaitMs`
// into a run of edits. One write runs at a time: an edit during a write marks
// the copy dirty and it is written once more when that write ends. While
// `canWrite()` is false the copy stays dirty and is retried after a debounce.
class RecoveryScheduler {
	constructor({ write, canWrite = () => true, debounceMs, maxWaitMs, clock = RecoveryScheduler.realClock }) {
		Object.assign(this, { write, canWrite, debounceMs, maxWaitMs, clock });
		this.pending = false;
		this.firstPendingAt = null;
		this.timer = null;
		this.running = null;
	}

	static realClock = Object.freeze({
		now: () => Date.now(),
		setTimeout: (callback, ms) => setTimeout(callback, ms),
		clearTimeout: id => clearTimeout(id)
	});

	schedule() {
		const now = this.clock.now();
		this.pending = true;
		this.firstPendingAt ??= now;
		this.arm(Math.min(this.debounceMs, this.firstPendingAt + this.maxWaitMs - now));
	}

	arm(ms) {
		this.clock.clearTimeout(this.timer);
		this.timer = this.clock.setTimeout(() => { this.timer = null; this.flush(); }, Math.max(0, ms));
	}

	// Writes now if the copy is dirty. Resolves when every write it started ends.
	flush() {
		this.clock.clearTimeout(this.timer);
		this.timer = null;
		if (this.running || !this.pending) return this.idle();
		this.running = this.drain().finally(() => { this.running = null; });
		return this.running;
	}

	async drain() {
		while (this.pending) {
			if (!this.canWrite()) {
				this.arm(this.debounceMs);
				return;
			}
			this.pending = false;
			this.firstPendingAt = null;
			try {
				await this.write();
			} catch (error) {
				console.warn('Recovery write failed:', error);
			}
		}
	}

	// Drops a write that has not started; one already running finishes.
	cancel() {
		this.clock.clearTimeout(this.timer);
		this.timer = null;
		this.pending = false;
		this.firstPendingAt = null;
	}

	idle() {
		return this.running || Promise.resolve();
	}
}

// Recovery drafts (docs/plans/SESSION-RECOVERY-PLAN.md): every document
// writes to its own draft in RECOVERY_STORE, and the start card offers the
// newest few to resume. Starting something new never asks and never replaces
// another draft; the oldest drafts past CONFIG.app.recovery.keepDrafts age
// out. Recovery never touches `isSaved`, which keeps meaning "saved to a file".
const EDITOR_RECOVERY_METHODS = {
	setupRecovery() {
		const { debounceMs, maxWaitMs } = CONFIG.app.recovery;
		this.recoveryDraftId = null;
		this.recovery = new RecoveryScheduler({
			write: () => this.writeRecovery(),
			canWrite: () => this.canWriteRecovery(),
			debounceMs,
			maxWaitMs
		});
		// Best effort: the browser may not wait for an async write. The
		// debounce is the real guarantee.
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') this.flushRecoveryOnLeave();
		});
		window.addEventListener('pagehide', () => this.flushRecoveryOnLeave());
		PREFERENCES.onChange('recoverUnsavedWork', (enabled) => {
			if (enabled) this.writeRecoveryNow();
			else this.discardAllRecovery();
		});
		this.refreshWorkspaceStartResume();
	},

	// Each opened document gets its own draft; a resume keeps the draft it came
	// from. A document that brings content of its own (a photo, an image) is
	// written at once; a blank canvas or a project already in a file waits for
	// its first edit, so opening and closing one never ages out real work.
	startRecoveryDraft({ draftId = null, saved = false } = {}) {
		this.recoveryDraftId = draftId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
		if (draftId || (!saved && this.baseImageSource?.kind !== 'preset')) this.writeRecoveryNow();
	},

	isRecoveryEnabled() {
		return RECOVERY_STORE.available && PREFERENCES.get('recoverUnsavedWork');
	},

	// Called whenever the document becomes unsaved (the `isSaved` setter).
	scheduleRecoveryWrite() {
		if (!this.recovery || !this.originalImage || !this.isRecoveryEnabled()) return;
		this.recovery.schedule();
	},

	writeRecoveryNow() {
		if (!this.recovery || !this.originalImage || !this.isRecoveryEnabled()) return Promise.resolve();
		this.recovery.schedule();
		return this.recovery.flush();
	},

	// Sessions with a commit step of their own end in a saveState, which
	// schedules the write; an export or a brush stroke is waited out the same way.
	canWriteRecovery() {
		return !this.exportInProgress && !this.maskEditor.strokeActive && !getSessionDefinition(this)?.holdsEdits;
	},

	// Tabs write separate drafts, so a tab leaving only finishes its own.
	flushRecoveryOnLeave() {
		if (this.recovery?.pending) this.recovery.flush();
	},

	async writeRecovery() {
		if (!this.originalImage || !this.recoveryDraftId || !this.isRecoveryEnabled()) return;
		const id = this.recoveryDraftId;
		const fileSaved = this.isSaved;
		const project = await this.projectSerializer.serialize();
		const thumbnail = await this.captureRecoveryThumbnail().catch((error) => {
			console.warn('Recovery thumbnail failed:', error);
			return null;
		});
		if (!this.isRecoveryEnabled()) return;
		await RECOVERY_STORE.write({
			id,
			project,
			thumbnail,
			name: project.name,
			canvas: { ...project.canvas },
			appVersion: project.appVersion,
			savedAt: Date.now(),
			fileSaved
		}, { keep: CONFIG.app.recovery.keepDrafts });
		// Chromium grants this silently from site engagement and never prompts;
		// elsewhere the Settings row asks, so a prompt follows the user's own click.
		if (!this.storagePersistAttempted && navigator.userAgentData) {
			this.storagePersistAttempted = true;
			await this.requestStoragePersistence();
		}
	},

	async requestStoragePersistence() {
		let persisted = false;
		try { persisted = Boolean(await navigator.storage?.persist?.()); } catch { /* Refused or unsupported. */ }
		this.refreshProtectDraftsRow(persisted);
		return persisted;
	},

	// The Settings "Protect Drafts" row: status line plus its button.
	async refreshProtectDraftsRow(known = null) {
		const status = document.getElementById('protectDraftsStatus');
		const button = document.getElementById('protectDrafts');
		if (!status || !button) return;
		const supported = typeof navigator.storage?.persist === 'function';
		let persisted = known;
		if (persisted === null && supported) {
			try { persisted = await navigator.storage.persisted(); } catch { persisted = false; }
		}
		button.disabled = !supported || Boolean(persisted);
		status.textContent = !supported ? 'This browser cannot protect drafts.'
			: persisted ? 'Drafts are protected from automatic cleanup.'
				: 'The browser may clear drafts when storage runs low.';
	},

	// After a file save the draft stays (Resume is still the quickest way
	// back) but no longer reads "Not saved to a file".
	async noteRecoveryFileSaved() {
		if (!this.recovery || !this.recoveryDraftId || !this.isRecoveryEnabled()) return;
		await this.recovery.idle();
		if (this.isSaved && !this.recovery.pending) await RECOVERY_STORE.patch(this.recoveryDraftId, { fileSaved: true });
	},

	// The scene at rest, scaled to fit CONFIG.app.recovery.thumbnailSize. Its
	// own compositor, so a write never shares scratch canvases with the
	// eyedropper or an export.
	async captureRecoveryThumbnail() {
		this.recoveryCompositor ||= new SceneCompositor({ editor: this, resolveImageFill: imageRef => this.imageFills.get(imageRef) });
		const layers = this.layers.filter(layer => layer.visible && !layer.isPreview && layerHasVisibleContent(layer));
		const composed = await this.recoveryCompositor.composeFrameAt(this.getSceneSnapshotParams(layers, { timestamp: 0, rest: true }));
		const source = document.createElement('canvas');
		source.width = composed.imageData.width;
		source.height = composed.imageData.height;
		source.getContext('2d').putImageData(composed.imageData, 0, 0);
		const scale = Math.min(1, CONFIG.app.recovery.thumbnailSize / Math.max(source.width, source.height));
		const target = document.createElement('canvas');
		downscaleCanvas(source, target, Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)),
			[document.createElement('canvas'), document.createElement('canvas')]);
		const encode = type => new Promise(resolve => target.toBlob(resolve, type, 0.85));
		const webp = await encode('image/webp');
		return webp?.type === 'image/webp' ? webp : encode('image/png');
	},

	async resumeRecovery(id) {
		const record = await RECOVERY_STORE.read(id);
		if (!record?.project) {
			this.refreshWorkspaceStartResume();
			return false;
		}
		const done = this.beginActivity('resume-project', 'Opening recovered work');
		try {
			await this.whenBooted('library');
			const loaded = await this.projectSerializer.load(record.project, { saved: record.fileSaved === true, draftId: id });
			if (loaded) this.updateStatus('Recovered work opened');
			return loaded;
		} catch (error) {
			console.error('Recovery load failed:', error);
			this.showError(error.message || 'Failed to open project.');
			await this.discardRecovery(id);
			return false;
		} finally {
			done();
		}
	},

	// A write still pending for this draft is dropped first, so it cannot
	// bring the draft back.
	async discardRecovery(id) {
		if (id === this.recoveryDraftId) {
			this.recovery?.cancel();
			await this.recovery?.idle();
		}
		await RECOVERY_STORE.remove(id);
		this.refreshWorkspaceStartResume();
	},

	async discardAllRecovery() {
		this.recovery?.cancel();
		await this.recovery?.idle();
		await RECOVERY_STORE.clear();
		this.renderWorkspaceStartResume([]);
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = { RecoveryScheduler };
