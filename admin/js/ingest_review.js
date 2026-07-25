class IngestReview {
	constructor(editor, modal) {
		this.editor = editor;
		this.modal = modal;
		this.items = [];
		this.mount();
	}

	mount() {
		this.modal.querySelector('.modal-content').classList.add('modal-width-xl');
		this.modal.querySelector('.modal-header h3').textContent = 'Add assets';
		this.modal.querySelector('.modal-body').innerHTML = `
			<section class="ingest-upload-panel">
				<label class="drop-zone" data-drop-zone>
					<strong>Drop files here, or click to choose</strong>
					<span>GIF, PNG, or JPEG · files stay private until you approve them</span>
					<input type="file" accept="image/gif,image/png,image/jpeg" multiple data-ingest-files>
				</label>
				<div class="upload-progress" data-upload-progress></div>
				<details class="register-existing">
					<summary>Register a file already on disk</summary>
					<div class="property-list">
						<div class="property-row">
							<label class="property-label" for="ingest-existing-url">File URL</label>
							<div class="property-control">
								<input type="text" id="ingest-existing-url" data-existing-url placeholder="images/${this.editor.config.assetType}/category/file.gif">
								<button type="button" class="btn btn-secondary btn-sm" data-existing-review>Review</button>
							</div>
						</div>
					</div>
				</details>
			</section>
			<section class="ingest-queue" data-ingest-queue></section>
		`;
		this.files = this.modal.querySelector('[data-ingest-files]');
		this.queue = this.modal.querySelector('[data-ingest-queue]');
		this.progress = this.modal.querySelector('[data-upload-progress]');
		this.files.addEventListener('change', () => this.upload([...this.files.files]));
		const drop = this.modal.querySelector('[data-drop-zone]');
		drop.addEventListener('dragover', event => {
			event.preventDefault();
			drop.classList.add('drag-active');
		});
		drop.addEventListener('dragleave', () => drop.classList.remove('drag-active'));
		drop.addEventListener('drop', event => {
			event.preventDefault();
			drop.classList.remove('drag-active');
			this.upload([...event.dataTransfer.files]);
		});
		this.modal.querySelector('[data-existing-review]').addEventListener('click', () => this.registerExisting());
		this.modal.querySelector('[data-approve-all]').addEventListener('click', () => this.approveAllReady());
	}

	async open(itemId = null) {
		this.editor.activateModal(this.modal);
		await this.load();
		if (itemId) this.queue.querySelector(`[data-ingest-id="${itemId}"]`)?.scrollIntoView({ block: 'center' });
	}

	async upload(files) {
		let batchId = null;
		for (let index = 0; index < files.length; index++) {
			this.progress.textContent = `Uploading ${index + 1} of ${files.length}: ${files[index].name}`;
			const body = new FormData();
			body.append('file', files[index]);
			if (batchId) body.append('batch_id', batchId);
			try {
				const result = await AdminAPI.json(`includes/api.php?action=ingest_upload&type=${this.editor.config.assetType}`, { method: 'POST', body });
				if (result.batch_id) batchId = result.batch_id;
				if (result.duplicate) this.editor.showStatus(`Duplicate: ${result.existing.name}`, 'error');
			} catch (error) {
				this.editor.showStatus(`${files[index].name}: ${error.message}`, 'error', 6000);
			}
		}
		this.progress.textContent = '';
		this.files.value = '';
		await this.load();
	}

	async load() {
		this.items = await AdminAPI.json(`includes/api.php?action=ingest_list&type=${this.editor.config.assetType}`);
		this.render();
		this.modal._adminDirty = false;
	}

	render() {
		const active = this.items.filter(item => !['approved', 'rejected'].includes(item.status));
		if (!active.length) {
			this.queue.innerHTML = '';
			this.updateChrome(active);
			return;
		}
		const categoryOptions = this.editor.categories.filter(category => category.id).map(category => `<option value="${category.id}">${this.editor.escapeHtml(category.name)}</option>`).join('');
		const tagOptions = this.editor.tags.map(tag => `<option value="${tag.id}">${this.editor.escapeHtml(tag.category_name)} · ${this.editor.escapeHtml(tag.name)}</option>`).join('');
		// Batch tools are a shortcut for repetitive batches, not part of the
		// core flow — they stay hidden until something is actually selected.
		const batchBar = active.length > 1 ? `<div class="ingest-batch-toolbar" data-batch-toolbar hidden>
			<span class="ingest-batch-label" data-batch-count></span>
			<select data-batch-category aria-label="Category for selected files"><option value="">Set category…</option>${categoryOptions}</select>
			<select data-batch-tags multiple aria-label="Tags for selected files">${tagOptions}</select>
			<button type="button" class="btn btn-secondary btn-sm" data-apply-batch>Apply to selected</button>
		</div>` : '';
		this.queue.innerHTML = batchBar + active.map(item => {
			const palette = item.analysis?.palette;
			const categories = this.editor.categories.filter(category => category.id).map(category => `<option value="${category.id}" ${Number(category.id) === Number(item.suggested_category_id) ? 'selected' : ''}>${this.editor.escapeHtml(category.name)}</option>`).join('');
			const row = (label, control, options) => this.editor.propertyRow(label, control, options);
			return `
				<article class="ingest-item" data-ingest-id="${item.id}">
					<div class="ingest-preview">${this.preview(item)}</div>
					<div class="ingest-body">
						<div class="ingest-item-header">
							<label class="batch-select"><input type="checkbox" data-ingest-select> Select</label>
							<strong class="ingest-filename">${this.editor.escapeHtml(item.original_filename)}</strong>
							<span class="badge badge-status-${this.editor.escapeHtml(item.status)}">${this.editor.escapeHtml(item.status)}</span>
							<div class="ingest-actions">
								<button type="button" class="btn btn-quiet btn-sm" data-reject>Reject</button>
								<button type="button" class="btn btn-primary btn-sm" data-approve ${item.status !== 'ready' ? 'disabled' : ''}>Approve</button>
							</div>
						</div>
						<div class="property-list">
							${row('Name', '<input type="text" data-ingest-name value="' + this.editor.escapeHtml(item.suggested_name || '') + '">')}
							${row('Category', `<select data-ingest-category><option value="">Choose category</option>${categories}</select>
								<button type="button" class="btn btn-quiet btn-sm" data-new-category title="Create a new category">+ New</button>`)}
							${row('Final URL', '<code data-url-preview>Choose a category to preview</code>', { continued: true })}
							${palette ? this.palette(palette) : ''}
							${item.suggested_tags.length ? row('Suggested tags', `<div class="suggested-tags">${item.suggested_tags.map(tag => `<label class="tag tag-selectable ${tag.tag_id ? '' : 'is-disabled'}"><input type="checkbox" value="${tag.tag_id || ''}" ${tag.tag_id ? 'checked' : 'disabled'}><span>${this.editor.escapeHtml(tag.name)}</span><small>${this.editor.escapeHtml(tag.reason)}</small></label>`).join('')}</div>`, { tall: true }) : ''}
						</div>
						<div class="batch-tags" data-batch-tag-display></div>
						${item.error ? `<div class="field-error">${this.editor.escapeHtml(item.error)}</div>` : ''}
					</div>
				</article>
			`;
		}).join('');
		this.queue.querySelectorAll('.ingest-item').forEach(row => this.bindRow(row));
		this.queue.querySelector('[data-apply-batch]')?.addEventListener('click', () => this.applyBatch());
		this.queue.querySelectorAll('[data-ingest-select]').forEach(input =>
			input.addEventListener('change', () => this.updateSelectionUi()));
		this.updateSelectionUi();
		this.updateChrome(active);
	}

	updateSelectionUi() {
		const toolbar = this.queue.querySelector('[data-batch-toolbar]');
		if (!toolbar) return;
		const count = this.queue.querySelectorAll('[data-ingest-select]:checked').length;
		toolbar.hidden = count === 0;
		toolbar.querySelector('[data-batch-count]').textContent = `${count} selected`;
	}

	// The upload panel is the whole screen when there is nothing to review,
	// and shrinks to a single "add more" affordance once a queue exists.
	updateChrome(active) {
		const panel = this.modal.querySelector('.ingest-upload-panel');
		panel.classList.toggle('is-compact', active.length > 0);
		const ready = active.filter(item => item.status === 'ready').length;
		const approveAll = this.modal.querySelector('[data-approve-all]');
		approveAll.hidden = ready < 2;
		approveAll.textContent = `Approve ${ready} ready`;
		approveAll.disabled = ready === 0;
	}

	async approveAllReady() {
		const rows = [...this.queue.querySelectorAll('.ingest-item')]
			.map(row => ({ row, item: this.items.find(candidate => Number(candidate.id) === Number(row.dataset.ingestId)) }))
			.filter(entry => entry.item?.status === 'ready' && Number(entry.row.querySelector('[data-ingest-category]').value));
		if (!rows.length) {
			this.editor.showStatus('Choose a category for at least one file first.', 'error');
			return;
		}
		if (!confirm(`Approve ${rows.length} file(s)? They become part of the library on the next Export JSON.`)) return;
		for (const entry of rows) await this.approve(entry.row, entry.item, { reload: false });
		await this.editor.loadAssets();
		await this.load();
		this.editor.showStaleStatus(`Approved ${rows.length} asset(s).`);
	}

	bindRow(row) {
		const item = this.items.find(candidate => Number(candidate.id) === Number(row.dataset.ingestId));
		const category = row.querySelector('[data-ingest-category]');
		const updateUrl = () => {
			const selected = this.editor.categories.find(value => Number(value.id) === Number(category.value));
			row.querySelector('[data-url-preview]').textContent = selected
				? `${selected.folder_url}${this.editor.escapeHtml(item.incoming_filename)}`
				: 'Choose a category to preview';
		};
		category.addEventListener('change', updateUrl);
		updateUrl();
		row.querySelector('[data-new-category]').addEventListener('click', async () => {
			if (!this.editor.categoryManager) this.editor.categoryManager = new CategoryManager(this.editor, document.getElementById('categoryModal'));
			await this.editor.categoryManager.open({
				onCreated: async created => {
					this.editor.hideCategoryModal();
					await this.load();
					const refreshed = this.queue.querySelector(`[data-ingest-id="${item.id}"]`);
					const select = refreshed?.querySelector('[data-ingest-category]');
					if (select) {
						select.value = String(created.id);
						select.dispatchEvent(new Event('change'));
					}
				}
			});
		});
		row.querySelector('[data-approve]').addEventListener('click', () => this.approve(row, item));
		row.querySelector('[data-reject]').addEventListener('click', () => this.reject(item));
	}

	async approve(row, item, { reload = true } = {}) {
		const categoryId = Number(row.querySelector('[data-ingest-category]').value);
		if (!categoryId) {
			this.editor.showStatus('Choose a category before approving.', 'error');
			return;
		}
		const tags = [
			...row.querySelectorAll('.suggested-tags input:checked')
		].map(input => Number(input.value)).filter(Boolean).concat(JSON.parse(row.dataset.batchTags || '[]'));
		const result = await AdminAPI.json(`includes/api.php?action=ingest_approve&type=${this.editor.config.assetType}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: item.id,
				name: row.querySelector('[data-ingest-name]').value.trim(),
				category_id: categoryId,
				tags
			})
		});
		if (!reload) return;
		await this.editor.loadAssets();
		await this.load();
		this.editor.showStaleStatus(`Approved asset ${result.id}.`);
	}

	applyBatch() {
		const selected = [...this.queue.querySelectorAll('.ingest-item')].filter(row => row.querySelector('[data-ingest-select]').checked);
		if (!selected.length) {
			this.editor.showStatus('Select intake items first.', 'error');
			return;
		}
		const categoryId = this.queue.querySelector('[data-batch-category]').value;
		const tags = [...this.queue.querySelector('[data-batch-tags]').selectedOptions].map(option => Number(option.value));
		selected.forEach(row => {
			if (categoryId) {
				const select = row.querySelector('[data-ingest-category]');
				select.value = categoryId;
				select.dispatchEvent(new Event('change'));
			}
			row.dataset.batchTags = JSON.stringify(tags);
			row.querySelector('[data-batch-tag-display]').textContent = tags.length
				? `${tags.length} batch tag${tags.length === 1 ? '' : 's'} will be applied`
				: '';
		});
	}

	async reject(item) {
		if (!confirm(`Reject "${item.original_filename}" and remove its private incoming file?`)) return;
		await AdminAPI.json(`includes/api.php?action=ingest_reject&type=${this.editor.config.assetType}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: item.id })
		});
		await this.load();
	}

	async registerExisting() {
		const url = this.modal.querySelector('[data-existing-url]').value.trim();
		if (!url) return;
		await AdminAPI.json(`includes/api.php?action=register_existing&type=${this.editor.config.assetType}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url })
		});
		this.editor.showStatus('Existing file registered for review.', 'success');
		await this.editor.loadAssets();
	}

	// Same palette presentation the asset editor uses — one component, two hosts.
	palette(palette) {
		return this.editor.renderAnalysisPalette(palette);
	}

	preview(item) {
		return `<img src="includes/ingestPreview.php?type=${encodeURIComponent(this.editor.config.assetType)}&id=${item.id}" alt="" loading="lazy">`;
	}
}
