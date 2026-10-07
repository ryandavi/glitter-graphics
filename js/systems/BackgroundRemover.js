'use strict';

class BackgroundRemover {
	constructor(editor) {
		this.editor = editor;
		this.worker = null;
		this.job = null;
		this.progress = new TaskProgressPresenter(editor, TaskProgressPresenter.createCard('backgroundRemovalProgress'), () => this.finish());
		const host = document.createElement('div');
		host.innerHTML = `<div class="modal-overlay" id="backgroundRemovalModal">
			<div class="modal-content modal-dialog">
				<div class="modal-header"><div class="modal-title"><span class="modal-title-text">Remove background</span></div>
					<button type="button" class="btn-icon modal-close" id="backgroundRemovalClose" aria-label="Close">${createIcon('x-mark').outerHTML}</button></div>
				<div class="modal-body">
					<div id="backgroundRemovalComparison"><div class="background-removal-images">
						<figure><figcaption>Before</figcaption><img id="backgroundRemovalBefore" alt="Original sticker"></figure>
						<figure><figcaption>After</figcaption><img id="backgroundRemovalAfter" alt="Sticker with background removed"></figure>
					</div></div>
				</div>
				<div class="modal-footer"><button type="button" class="btn-text-with-icon" id="backgroundRemovalDiscard">Discard</button>
					<button type="button" class="btn-text-with-icon primary" id="backgroundRemovalKeep">Keep</button></div>
			</div></div>`;
		document.body.appendChild(host.firstElementChild);
		this.modal = document.getElementById('backgroundRemovalModal');
		this.node = id => document.getElementById(`backgroundRemoval${id}`);
		editor.modalManager.register('backgroundRemovalModal', {
			closeBtnId: ['backgroundRemovalClose', 'backgroundRemovalDiscard'], initialFocusSelector: '#backgroundRemovalDiscard',
			beforeClose: () => !this.job?.keeping, onClose: () => this.finish()
		});
		this.node('Keep').addEventListener('click', () => this.keep());
	}

	async run(layer, item) {
		if (this.job) return;
		clearTimeout(this.idleTimer);
		const job = this.job = { layer, item, done: this.editor.beginActivity('background-removal', 'Downloading background remover') };
		this.progress.show({ title: 'Removing background', detail: 'Preparing background remover' });
		try {
			if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('This browser cannot remove backgrounds. Try a recent Chrome or Firefox browser.');
			const blob = await fetch(item.url).then(response => response.blob());
			if (this.job !== job) return;
			this.worker ||= new Worker('js/workers/background-removal-worker.js?v=1e9fe4e6');
			const result = await new Promise((resolve, reject) => {
				job.reject = reject;
				this.worker.onmessage = ({ data }) => {
					if (this.job !== job) return;
					if (data.type === 'progress') {
						this.progress.update(0, data.label, 0, 0, { indeterminate: true, phase: data.label });
						this.editor.updateActivity('background-removal', { label: data.label });
					} else if (data.type === 'result') resolve(data.blob);
					else reject(new Error(data.message));
				};
				this.worker.onerror = () => reject(new Error('Could not start the background remover. Check your connection and try again.'));
				const config = CONFIG.tools.backgroundRemoval;
				this.worker.postMessage({ blob, config: { ...config, runtimePath: new URL(config.runtimePath, document.baseURI).href, runtimeModule: new URL(config.runtimeModule, document.baseURI).href } });
			});
			if (this.job !== job) return;
			job.blob = result;
			job.url = URL.createObjectURL(result);
			this.node('Before').src = item.url;
			this.node('After').src = job.url;
			await this.node('After').decode();
			if (this.job !== job) return;
			job.done();
			this.progress.hide();
			await this.editor.modalManager.open('backgroundRemovalModal');
		} catch (error) {
			if (this.job !== job) return;
			this.releaseWorker();
			this.finish();
			this.editor.showError(error.message);
		}
	}

	async keep() {
		const job = this.job;
		if (!job?.blob || job.keeping) return;
		const { layer, item } = job;
		if (!this.editor.layerManager.layers.includes(layer) || layer.stickerSourceId !== item.id || !this.editor.canEditLayer(layer, { notify: true })) {
			this.editor.showError('The sticker changed while processing. Run Remove background again.');
			await this.editor.modalManager.close('backgroundRemovalModal');
			return;
		}
		job.keeping = true;
		this.node('Keep').disabled = true;
		try {
			const cutout = await this.editor.stickerLibrary.registerCutout(job.blob, item);
			await this.editor.stickerManager.replaceWithCutout(layer, item.id, cutout);
			job.keeping = false;
			await this.editor.modalManager.close('backgroundRemovalModal');
		} catch (error) { this.editor.showError(error.message); }
		finally { job.keeping = false; this.node('Keep').disabled = false; }
	}

	releaseWorker() { this.worker?.terminate(); this.worker = null; }

	finish() {
		const job = this.job;
		if (!job) return;
		this.job = null;
		this.progress.hide();
		job.done();
		if (!job.blob) { this.releaseWorker(); job.reject?.(new Error('Cancelled')); }
		if (job.url) URL.revokeObjectURL(job.url);
		this.node('Before').removeAttribute('src');
		this.node('After').removeAttribute('src');
		// Release inference memory after inactivity; cached downloads survive.
		this.idleTimer = setTimeout(() => this.releaseWorker(), CONFIG.tools.backgroundRemoval.idleReleaseMs);
	}
}
