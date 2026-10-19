'use strict';

// A separate compositor keeps asynchronous preview work off the export's
// reusable canvases. Playback uses the preview ticker's existing clock.
class PreviewFrameView {
	constructor(editor) {
		this.editor = editor;
		this.canvas = createAppCanvas(0, 0, 'systems/PreviewFrameView');
		this.canvas.className = 'timeline-frame-view';
		this.canvas.hidden = true;
		this.canvas.setAttribute('aria-hidden', 'true');
		this.editor.previewWrapper.appendChild(this.canvas);
		this.compositor = new SceneCompositor({ editor: this.editor, resolveImageFill: imageRef => this.editor.imageFills.get(imageRef) });
		this.generation = 0;
		this.queue = Promise.resolve();
		this.frames = [];
		APP_MEMORY_LEDGER.register({ id: 'timeline-frames', label: 'Preview frames', category: 'Preview caches', measure: () => this.frames.reduce((bytes, frame) => bytes + frame.width * frame.height * 4, 0) + this.compositor.getDecodedSourceBytes() });
		this.editor.animationTicker.subscribeSeek(() => this.seek());
		document.addEventListener('keydown', event => { if (event.key === 'Escape' && (this.exact || this.done)) { event.preventDefault(); event.stopPropagation(); this.invalidate(); } }, true);
		this.editor.previewWrapper.addEventListener('pointerdown', () => {
			if (this.editor.keyRecording?.active) return;
			this.invalidate();
			this.blocked = true;
			const ticker = this.editor.animationTicker;
			if (ticker.paused && ticker.holding) ticker.setRestPreview(true);
		}, true);
	}

	invalidate({ keepFrame = false } = {}) {
		this.unsubscribeClock?.(); this.unsubscribeClock = null;
		if (this.exact) this.editor.animationTicker.setLoop(this.normalLoopMs);
		this.generation++;
		this.pending = null;
		this.prepared = null;
		this.params = null;
		this.lastTime = null;
		this.exact = null;
		window.dispatchEvent(new CustomEvent('playbackChanged'));
		this.frames.forEach(frame => frame.close());
		this.frames = [];
		this.done?.(); this.done = null;
		this.editor.timelineDock?.exact?.classList.remove('active');
		this.editor.timelineDock?.exact?.setAttribute('aria-pressed', 'false');
		this.editor.timelineDock?.exact?.setAttribute('aria-current', 'false');
		if (!keepFrame) {
			this.canvas.hidden = true;
			this.canvas.width = this.canvas.height = 0;
			this.editor.previewWrapper.classList.remove('timeline-frame-active');
		}
		this.compositor.releaseDecodedSources();
	}

	seek() { this.blocked = false; }

	paint(ms) {
		const ticker = this.editor.animationTicker;
		if (!Boolean(this.editor.originalImage) || this.editor.exportInProgress || this.blocked || ticker.reducedMotion?.matches || PREFERENCES.get('reduceMotion')) { this.hide(); return; }
		if (this.exact) {
			const elapsed = ms % this.exact.totalDuration;
			const index = Math.max(0, indexAtOrBefore(this.exact.starts, elapsed, 0));
			if (index !== this.drawnIndex || this.canvas.hidden) { this.draw(this.frames[index]); this.drawnIndex = index; }
			return;
		}
		if (!ticker.paused || !ticker.holding || ticker.restPreview) {
			this.hide();
			this.lastTime = null;
			return;
		}
		if (this.lastTime === ms || (this.editor.loopEstimatePending && !this.editor.keyRecording?.active)) return;
		this.lastTime = ms;
		this.pending = { ms, generation: this.generation };
		if (this.scrubbing) return;
		this.scrubbing = true;
		this.queue = this.queue.then(() => this.scrub()).finally(() => { this.scrubbing = false; });
	}

	paramsFor(generation, exact = false) {
		let layers = this.editor.layers.filter(layer => layer.visible !== false);
		if (this.editor.keyRecording?.active) layers = this.editor.keyRecording.previewLayers(layers);
		const params = this.editor.getSceneSnapshotParams(layers);
		params.callbacks.isCancelled = () => generation !== this.generation;
		if (exact) {
			const side = Math.max(params.canvasData.width, params.canvasData.height);
			params.exportSettings.outputScale = Math.min(CONFIG.export.defaults.outputScale, CONFIG.export.defaults.outputScale * CONFIG.ui.timeline.frameViewMaxSide / side);
		}
		return params;
	}

	async scrub() {
		let generation = this.generation;
		try {
			while (this.pending) {
				const request = this.pending;
				this.pending = null;
				generation = request.generation;
				const { ms } = request;
				if (generation !== this.generation) continue;
				if (!this.prepared) {
					const params = this.paramsFor(generation);
					const prepared = await this.compositor.prepareContext(params);
					if (generation !== this.generation) continue;
					this.params = params; this.prepared = prepared;
				}
				const frame = await this.compositor.composeFrameAt({ ...this.params, preparedContext: this.prepared, timestamp: ms, rest: false });
				const ticker = this.editor.animationTicker;
				if (generation !== this.generation || this.pending || !Boolean(this.editor.originalImage) || !ticker.paused || !ticker.holding || ticker.restPreview || ticker.getCurrentTime() !== ms || this.blocked) continue;
				this.resize(frame.width, frame.height);
				this.canvas.getContext('2d').putImageData(frame.imageData, 0, 0);
				this.canvas.hidden = false;
				this.editor.previewWrapper.classList.add('timeline-frame-active');
			}
		} catch (error) {
			if (generation === this.generation) {
				this.editor.showError('Could not draw this frame. Try seeking again.');
				console.warn('Preview frame composition failed:', error);
			}
			this.lastTime = null;
		}
	}

	draw(frame) {
		this.resize(frame.width, frame.height);
		const ctx = this.canvas.getContext('2d');
		ctx.clearRect(0, 0, frame.width, frame.height);
		ctx.drawImage(frame, 0, 0);
		this.canvas.hidden = false;
		this.editor.previewWrapper.classList.add('timeline-frame-active');
	}

	resize(width, height) {
		if (this.canvas.width !== width) this.canvas.width = width;
		if (this.canvas.height !== height) this.canvas.height = height;
	}

	hide() {
		this.canvas.hidden = true;
		this.editor.previewWrapper.classList.remove('timeline-frame-active');
	}

	playExact() {
		this.editor.keyRecording?.end();
		if (this.exact || this.done) { this.invalidate(); return; }
		if (!Boolean(this.editor.originalImage) || !this.editor.isLoopEstimateCurrent()) return;
		this.invalidate();
		this.blocked = false;
		const generation = this.generation;
		this.done = this.editor.beginActivity('timeline-exact', 'Preparing exact playback');
		this.queue = this.queue.then(async () => {
			const frames = [];
			try {
				if (generation !== this.generation) return;
				const params = this.paramsFor(generation, true);
				params.schedule = true;
				params.outputFormat = this.editor.loopEstimate?.outputFormat;
				const result = await this.compositor.planAnimation(params);
				if (generation !== this.generation) return;
				const { plan } = result;
				const budget = getMemoryBudget().previewCacheBytes * CONFIG.memory.timelineFrameBudgetFraction;
				if (plan.width * plan.height * plan.entries.length * 4 > budget) {
					this.editor.updateStatus('This loop is too large for exact playback. Shorten it or use the normal preview.');
					return;
				}
				for (let index = 0; index < plan.entries.length; index++) {
					if (generation !== this.generation) return;
					const canvas = await result.renderScheduleEntry(plan.entries[index], index);
					const bitmap = await createImageBitmap(canvas);
					frames.push(bitmap);
					this.editor.updateActivity('timeline-exact', { current: index + 1, total: plan.entries.length });
					if ((index + 1) % CONFIG.export.progress.yieldEveryFrames === 0) await new Promise(resolve => setTimeout(resolve, 0));
				}
				if (generation !== this.generation) return;
				this.frames = frames.splice(0);
				let start = 0;
				this.exact = { totalDuration: plan.totalDuration, entries: plan.entries.map(entry => { const item = { start, timestamp: entry.timestamp }; start += entry.duration; return item; }) };
				this.exact.starts = this.exact.entries.map(entry => entry.start);
				window.dispatchEvent(new CustomEvent('playbackChanged'));
				this.drawnIndex = null;
				this.editor.timelineDock?.exact?.classList.add('active');
				this.editor.timelineDock?.exact?.setAttribute('aria-pressed', 'true');
				this.editor.timelineDock?.exact?.setAttribute('aria-current', 'true');
				this.normalLoopMs = this.editor.animationTicker.loopMs;
				this.editor.animationTicker.setLoop(plan.totalDuration);
				this.editor.animationTicker.seek(0);
				this.editor.setPlayback(true);
				this.unsubscribeClock = this.editor.animationTicker.subscribeTick(() => {});
			} catch (error) {
				if (generation === this.generation) {
					this.editor.showError('Could not prepare exact playback. Try again.');
					console.warn('Exact timeline playback failed:', error);
				}
			} finally {
				frames.forEach(frame => frame.close());
				if (generation === this.generation) { this.done?.(); this.done = null; window.dispatchEvent(new CustomEvent('playbackChanged')); }
			}
		});
	}
}

SCRIPT_GROUP_EXPORTS.set('preview-frames', { PreviewFrameView });
