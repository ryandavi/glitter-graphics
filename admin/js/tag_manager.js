class TagManager {
	constructor(editor, modal) {
		this.editor = editor;
		this.modal = modal;
		this.tags = [];
		this.candidates = [];
		this.query = '';
		this.filter = 'all';
		this.editing = null;
		this.mount();
	}

	mount() {
		const content = this.modal.querySelector('.modal-content');
		const body = this.modal.querySelector('.modal-body');
		content.classList.add('modal-width-xl', 'manager-modal');
		body.classList.add('manager-scroll-body');
		body.insertAdjacentHTML('beforebegin', `
			<div class="manager-toolbar tag-manager-toolbar">
				<label class="search-field"><span class="visually-hidden">Search tags</span><input type="search" data-tag-search placeholder="Search names and aliases"></label>
				<select data-facet-filter><option value="all">All facets</option></select>
				<label><input type="checkbox" data-unused> Unused</label>
				<label><input type="checkbox" data-duplicates> Possible duplicates</label>
				<button type="button" class="btn btn-secondary" data-batch-move>Move selected</button>
				<button type="button" class="btn btn-primary" data-add-tag>Add tag</button>
			</div>
		`);
		body.innerHTML = `
			<div data-tag-list class="tag-taxonomy-list"></div>
			<dialog class="manager-dialog" data-tag-dialog>
				<form method="dialog" class="manager-form">
					<header class="manager-dialog-header"><h4>Add tag</h4><button type="button" class="close-btn" data-tag-close aria-label="Close">×</button></header>
					<div class="manager-dialog-content">
						<div class="property-list">
							<div class="property-row"><label class="property-label" for="tag-name">Name</label><div class="property-control"><input id="tag-name" name="name" required></div></div>
							<span class="field-error" data-tag-warning></span>
							<div class="property-row"><label class="property-label" for="tag-facet">Facet</label><div class="property-control"><select id="tag-facet" name="category_id" required></select></div></div>
							<div class="property-row"><label class="property-label" for="tag-hex-color">Hex color (optional)</label><div class="property-control"><input id="tag-hex-color" name="hex_color" placeholder="#ff69b4"></div></div>
						</div>
					</div>
					<footer class="manager-dialog-footer"><button type="button" class="btn btn-secondary" data-tag-close>Cancel</button><button class="btn btn-primary" data-tag-submit>Create tag</button></footer>
				</form>
			</dialog>
		`;
		this.list = this.modal.querySelector('[data-tag-list]');
		this.facet = this.modal.querySelector('[data-facet-filter]');
		this.dialog = this.modal.querySelector('[data-tag-dialog]');
		this.form = this.dialog.querySelector('form');
		this.modal.querySelector('[data-tag-search]').addEventListener('input', event => {
			this.query = event.target.value.trim().toLowerCase();
			this.render();
		});
		this.facet.addEventListener('change', () => {
			this.filter = this.facet.value;
			this.render();
		});
		this.modal.querySelector('[data-unused]').addEventListener('change', () => this.render());
		this.modal.querySelector('[data-duplicates]').addEventListener('change', () => this.render());
		this.modal.querySelector('[data-add-tag]').addEventListener('click', () => this.openForm());
		this.modal.querySelector('[data-batch-move]').addEventListener('click', () => this.batchMove());
		this.modal.querySelectorAll('[data-tag-close]').forEach(button => button.addEventListener('click', () => this.dialog.close()));
		this.form.elements.name.addEventListener('input', () => this.updateDuplicateWarning());
		this.form.addEventListener('submit', event => {
			event.preventDefault();
			this.create();
		});
	}

	async open() {
		this.editor.activateModal(this.modal);
		await this.load();
	}

	async load() {
		[this.tags, this.candidates] = await Promise.all([
			AdminAPI.json(`includes/api.php?action=tags&type=${this.editor.config.assetType}`),
			AdminAPI.json(`includes/api.php?action=tag_duplicate_candidates&type=${this.editor.config.assetType}`)
		]);
		this.facet.innerHTML = '<option value="all">All facets</option>' + this.editor.tagCategories.map(category => `<option value="${this.escape(category.name)}">${this.escape(category.name)}</option>`).join('');
		this.render();
	}

	render() {
		const unusedOnly = this.modal.querySelector('[data-unused]').checked;
		const duplicatesOnly = this.modal.querySelector('[data-duplicates]').checked;
		const duplicateIds = new Set(this.candidates.flatMap(candidate => [Number(candidate.target.id), Number(candidate.source.id)]));
		const tags = this.tags.filter(tag => {
			const text = [tag.name, ...(tag.aliases || [])].join(' ').toLowerCase();
			return (!this.query || text.includes(this.query))
				&& (this.filter === 'all' || tag.category_name === this.filter)
				&& (!unusedOnly || !Number(tag.usage_count))
				&& (!duplicatesOnly || duplicateIds.has(Number(tag.id)));
		});
		const groups = Map.groupBy ? Map.groupBy(tags, tag => tag.category_name) : tags.reduce((map, tag) => map.set(tag.category_name, [...(map.get(tag.category_name) || []), tag]), new Map());
		if (!tags.length) {
			this.list.innerHTML = '<div class="empty-row">No tags match these filters.</div>';
			return;
		}
		this.list.innerHTML = [...groups].map(([facet, rows]) => `
			<details class="tag-facet" open>
				<summary>${this.escape(facet)} <span class="count-badge count-badge-neutral">${rows.length}</span></summary>
				<div class="tag-table">
					${rows.map(tag => `
						<div class="tag-table-row">
							<input type="checkbox" data-tag-select value="${tag.id}" aria-label="Select ${this.escape(tag.name)}">
							<span class="tag-color-dot" style="--tag-color:${this.escape(tag.hex_color || 'transparent')}"></span>
							<div><strong>${this.escape(tag.name)}</strong>${tag.aliases.length ? `<small>Aliases: ${tag.aliases.map(value => this.escape(value)).join(', ')}</small>` : ''}</div>
							<span>${tag.usage_count} assets</span>
							<div class="row-actions">
								<button type="button" class="btn btn-quiet btn-sm" data-edit-tag="${tag.id}">Edit</button>
								<button type="button" class="btn btn-quiet btn-sm" data-alias="${tag.id}">Add alias</button>
								${duplicateIds.has(Number(tag.id)) ? `<button type="button" class="btn btn-secondary btn-sm" data-merge="${tag.id}">Merge</button>` : ''}
								${Number(tag.usage_count) === 0 ? `<button type="button" class="btn btn-quiet btn-sm" data-tag-delete="${tag.id}">Delete</button>` : ''}
							</div>
						</div>
					`).join('')}
				</div>
			</details>
		`).join('');
		this.list.querySelectorAll('[data-alias]').forEach(button => button.addEventListener('click', () => this.addAlias(Number(button.dataset.alias))));
		this.list.querySelectorAll('[data-edit-tag]').forEach(button => button.addEventListener('click', () => this.openForm(this.tags.find(tag => Number(tag.id) === Number(button.dataset.editTag)))));
		this.list.querySelectorAll('[data-merge]').forEach(button => button.addEventListener('click', () => this.merge(Number(button.dataset.merge))));
		this.list.querySelectorAll('[data-tag-delete]').forEach(button => button.addEventListener('click', () => this.editor.deleteTag(Number(button.dataset.tagDelete)).then(() => this.load())));
	}

	openForm(tag = null) {
		this.editing = tag;
		this.form.reset();
		this.form.elements.category_id.innerHTML = this.editor.tagCategories.map(category => `<option value="${category.id}">${this.escape(category.name)}</option>`).join('');
		this.form.querySelector('h4').textContent = tag ? 'Edit tag' : 'Add tag';
		this.form.querySelector('[data-tag-submit]').textContent = tag ? 'Save tag' : 'Create tag';
		if (tag) {
			this.form.elements.name.value = tag.name;
			const category = this.editor.tagCategories.find(item => item.name === tag.category_name);
			if (category) this.form.elements.category_id.value = category.id;
			this.form.elements.hex_color.value = tag.hex_color || '';
			this.form.elements.hex_color.disabled = true;
		} else {
			this.form.elements.hex_color.disabled = false;
		}
		this.dialog.showModal();
		this.form.elements.name.focus();
	}

	updateDuplicateWarning() {
		const value = this.form.elements.name.value.trim().toLowerCase();
		const match = this.tags.find(tag => this.probablePair(value, tag.name.toLowerCase()) || (tag.aliases || []).some(alias => alias.toLowerCase() === value));
		this.form.querySelector('[data-tag-warning]').textContent = match ? `Possible duplicate of "${match.name}". Consider adding an alias or merging.` : '';
	}

	async create() {
		const data = Object.fromEntries(new FormData(this.form));
		if (this.editing) data.id = this.editing.id;
		await AdminAPI.json(`includes/api.php?action=${this.editing ? 'tag_update' : 'add_tag'}&type=${this.editor.config.assetType}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data)
		});
		this.dialog.close();
		await this.editor.loadTags();
		await this.load();
	}

	async batchMove() {
		const ids = [...this.list.querySelectorAll('[data-tag-select]:checked')].map(input => Number(input.value));
		if (!ids.length) {
			this.editor.showStatus('Select tags to move.', 'error');
			return;
		}
		const labels = this.editor.tagCategories.map(category => `${category.id}: ${category.name}`).join('\n');
		const categoryId = Number(prompt(`Move ${ids.length} tag(s) to which facet?\n\n${labels}`));
		if (!this.editor.tagCategories.some(category => Number(category.id) === categoryId)) return;
		await AdminAPI.json(`includes/api.php?action=tag_update&type=${this.editor.config.assetType}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids, category_id: categoryId })
		});
		await this.editor.loadTags();
		await this.load();
	}

	async addAlias(tagId) {
		const tag = this.tags.find(item => Number(item.id) === tagId);
		const alias = prompt(`Add a search alias for "${tag.name}"`);
		if (!alias) return;
		await AdminAPI.json(`includes/api.php?action=tag_alias_add&type=${this.editor.config.assetType}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tag_id: tagId, alias })
		});
		await this.load();
	}

	async merge(tagId) {
		const candidate = this.candidates.find(item => Number(item.target.id) === tagId || Number(item.source.id) === tagId);
		if (!candidate) return;
		const target = candidate.target;
		const source = candidate.source;
		if (!confirm(`Merge "${source.name}" into "${target.name}"?\n\n${source.usage_count} asset assignments will move. "${source.name}" will remain as a search alias.`)) return;
		await AdminAPI.json(`includes/api.php?action=tag_merge&type=${this.editor.config.assetType}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ target_id: target.id, source_ids: [source.id] })
		});
		await this.editor.loadTags();
		await this.load();
	}

	probablePair(a, b) {
		const short = a.length <= b.length ? a : b;
		const long = short === a ? b : a;
		return long === `${short}s` || (short.endsWith('y') && long === `${short.slice(0, -1)}ies`);
	}

	escape(value) {
		return this.editor.escapeHtml(value);
	}
}
