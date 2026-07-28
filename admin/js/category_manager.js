class CategoryManager {
	constructor(editor, modal) {
		this.editor = editor;
		this.modal = modal;
		this.rows = [];
		this.query = '';
		this.editing = null;
		this.formDirty = false;
		this.mount();
	}

	mount() {
		const content = this.modal.querySelector('.modal-content');
		const body = this.modal.querySelector('.modal-body');
		content.classList.add('modal-width-xl', 'manager-modal');
		body.classList.add('manager-scroll-body');
		this.modal.querySelector('.modal-header h3').textContent = 'Manage Categories';
		body.insertAdjacentHTML('beforebegin', `
			<div class="manager-toolbar category-manager-toolbar">
				<label class="search-field"><span class="visually-hidden">Search categories</span><input type="search" data-category-search placeholder="Search categories"></label>
				<button type="button" class="btn btn-secondary" data-category-export>Export categories JSON</button>
				<button type="button" class="btn btn-primary" data-category-new>New category</button>
			</div>
		`);
		body.innerHTML = `
			<div class="category-table" data-category-table></div>
			<dialog class="manager-dialog" data-category-dialog>
				<form method="dialog" class="manager-form" novalidate>
					<header class="manager-dialog-header"><h4 data-form-title>New category</h4><button type="button" class="close-btn" data-form-close aria-label="Close">×</button></header>
					<div class="manager-dialog-content">
						<div class="property-list">
							<div class="property-row"><label class="property-label" for="category-name">Name</label><div class="property-control"><input type="text" id="category-name" name="name" required></div></div>
							<div class="property-row"><label class="property-label" for="category-slug">Slug</label><div class="property-control"><input type="text" id="category-slug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*"></div></div>
							<div class="property-row property-row-continued"><span class="property-label">Slug</span><div class="property-value"><code data-path-preview></code><span class="field-error" data-slug-error></span></div></div>
							<div class="property-row property-row-tall"><label class="property-label" for="category-description">Description</label><div class="property-control"><textarea id="category-description" name="description" rows="3"></textarea></div></div>
							<div class="property-row"><label class="property-label" for="category-icon">Icon path</label><div class="property-control"><input type="text" id="category-icon" name="icon"></div></div>
							<div class="property-row"><label class="property-label" for="category-color">Color</label><div class="property-control"><input type="color" id="category-color" name="color" value="#ff69b4"></div></div>
							<div class="property-row"><label class="property-label" for="category-sort-order">Sort order</label><div class="property-control"><input type="number" id="category-sort-order" name="sort_order" min="0" value="0"></div></div>
						</div>
					</div>
					<footer class="manager-dialog-footer"><button type="button" class="btn btn-secondary" data-form-close>Cancel</button><button type="submit" class="btn btn-primary">Save category</button></footer>
				</form>
			</dialog>
		`;
		this.search = this.modal.querySelector('[data-category-search]');
		this.table = this.modal.querySelector('[data-category-table]');
		this.dialog = this.modal.querySelector('[data-category-dialog]');
		this.form = this.dialog.querySelector('form');
		this.modal.querySelector('[data-category-export]').addEventListener('click', () => this.editor.exportCategoriesJSON());
		this.search.addEventListener('input', () => {
			this.query = this.search.value.trim().toLowerCase();
			this.render();
		});
		this.modal.querySelector('[data-category-new]').addEventListener('click', () => this.openForm());
		this.modal.querySelectorAll('[data-form-close]').forEach(button => button.addEventListener('click', () => this.requestCloseForm()));
		this.form.addEventListener('input', () => {
			this.formDirty = true;
		});
		this.form.addEventListener('change', () => {
			this.formDirty = true;
		});
		this.dialog.addEventListener('cancel', event => {
			event.preventDefault();
			this.requestCloseForm();
		});
		this.form.elements.name.addEventListener('input', () => {
			if (!this.form.elements.slug.dataset.manual) this.form.elements.slug.value = this.slugify(this.form.elements.name.value);
			this.updatePath();
		});
		this.form.elements.slug.addEventListener('input', () => {
			this.form.elements.slug.value = this.form.elements.slug.value.toLowerCase();
			this.form.elements.slug.dataset.manual = 'true';
			this.updatePath();
		});
		this.form.addEventListener('submit', event => {
			event.preventDefault();
			this.save();
		});
	}

	async open(options = {}) {
		this.onCreated = options.onCreated || null;
		this.editor.activateModal(this.modal);
		await this.load();
		this.search.focus();
	}

	async load() {
		this.rows = await AdminAPI.json(`includes/api.php?action=categories&type=${this.editor.config.assetType}`);
		this.render();
	}

	render() {
		const rows = this.rows.filter(row => !this.query || [row.name, row.slug, row.folder_url].some(value => String(value || '').toLowerCase().includes(this.query)));
		if (!rows.length) {
			this.table.innerHTML = '<div class="empty-row">No categories match this search.</div>';
			return;
		}
		this.table.innerHTML = `
			<div class="category-table-head"><span></span><span>Category</span><span>Canonical folder</span><span>Usage</span><span>Status</span><span></span></div>
			${rows.map(row => `
				<div class="category-table-row ${row.folder_status === 'unregistered' ? 'row-muted' : ''}" data-category-id="${row.id || ''}" ${row.id && !this.query ? 'draggable="true"' : ''}>
					<span class="drag-handle" title="Drag to reorder">${row.id && !this.query ? '⋮⋮' : ''}</span>
					<div class="category-cell-name">
						<span class="category-color-dot ${row.icon ? 'has-thumbnail' : ''}" style="--category-color:${this.escape(row.color || 'transparent')}" ${row.icon ? `title="${this.escape(row.icon)}"` : ''}>
							${row.icon ? `<img src="${CONFIG.image_base_path}${this.escape(row.icon)}" alt="" loading="lazy">` : ''}
						</span>
						<span><strong>${this.escape(row.name)}</strong><small>${this.escape(row.slug)}</small></span>
					</div>
					<code>${this.escape(row.folder_url)}</code>
					<span>${row.active_count} active · ${row.pending_count} pending</span>
					<span class="badge badge-${row.folder_status === 'present' ? 'success' : row.folder_status === 'missing' ? 'critical' : 'info'}">${this.escape(row.folder_status)}</span>
					<div class="row-actions">
						${row.id ? `<button type="button" class="btn btn-quiet btn-sm" data-edit="${row.id}">Edit</button>
						<button type="button" class="btn btn-quiet btn-sm" data-delete="${row.id}">Delete</button>` : `<button type="button" class="btn btn-secondary btn-sm" data-from-folder="${this.escape(row.slug)}" title="Create a category record for this unregistered folder">Register</button>`}
					</div>
				</div>
			`).join('')}
		`;
		this.table.querySelectorAll('.category-color-dot img').forEach(image => image.addEventListener('error', () => {
			image.parentElement.classList.remove('has-thumbnail');
			image.remove();
		}));
		this.bindDragSort();
		this.table.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => this.openForm(this.rows.find(row => Number(row.id) === Number(button.dataset.edit)))));
		this.table.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => this.remove(Number(button.dataset.delete))));
		this.table.querySelectorAll('[data-from-folder]').forEach(button => button.addEventListener('click', () => {
			const slug = button.dataset.fromFolder;
			this.openForm({ name: slug.replaceAll('-', ' ').replace(/\b\w/g, value => value.toUpperCase()), slug, folder_status: 'unregistered' });
		}));
	}

	// Drag sorting replaces hand-editing sort_order on every row. Disabled
	// while a search filter is active — the visible order is not the real one.
	bindDragSort() {
		let dragged = null;
		this.table.querySelectorAll('.category-table-row[draggable="true"]').forEach(row => {
			row.addEventListener('dragstart', () => {
				dragged = row;
				row.classList.add('dragging');
			});
			row.addEventListener('dragend', () => {
				row.classList.remove('dragging');
				dragged = null;
				this.saveOrder();
			});
		});
		this.table.addEventListener('dragover', event => {
			if (!dragged) return;
			event.preventDefault();
			const target = event.target.closest('.category-table-row[draggable="true"]');
			if (!target || target === dragged) return;
			const { top, height } = target.getBoundingClientRect();
			target.parentNode.insertBefore(dragged, event.clientY < top + height / 2 ? target : target.nextSibling);
		});
	}

	async saveOrder() {
		const order = [...this.table.querySelectorAll('.category-table-row[data-category-id]')]
			.map(row => Number(row.dataset.categoryId)).filter(Boolean);
		if (!order.length) return;
		await AdminAPI.json(`includes/api.php?action=reorder_categories&type=${this.editor.config.assetType}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ order })
		});
		await this.editor.loadCategories();
		this.editor.showStatus('Category order saved.', 'success');
	}

	openForm(row = null) {
		this.editing = row?.id ? row : null;
		this.form.reset();
		delete this.form.elements.slug.dataset.manual;
		this.form.querySelector('[data-slug-error]').textContent = '';
		this.form.querySelector('[data-form-title]').textContent = this.editing ? 'Edit category' : 'New category';
		for (const field of ['name', 'slug', 'description', 'icon', 'color', 'sort_order']) {
			if (row?.[field] != null) this.form.elements[field].value = row[field];
		}
		this.form.elements.slug.disabled = false;
		if (this.editing) this.form.elements.slug.dataset.manual = 'true';
		this.updatePath();
		this.formDirty = false;
		this.dialog.showModal();
		this.form.elements.name.focus();
	}

	async save() {
		const values = Object.fromEntries(new FormData(this.form));
		values.sort_order = Number(values.sort_order || 0);
		if (this.editing) values.id = Number(this.editing.id);
		if (this.form.elements.slug.disabled) values.slug = this.editing.slug;
		const action = this.editing ? 'update_category' : 'add_category';
		try {
			const result = await AdminAPI.json(`includes/api.php?action=${action}&type=${this.editor.config.assetType}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values)
			});
			this.formDirty = false;
			this.dialog.close();
			await this.editor.loadCategories();
			await this.load();
			this.editor.showStatus(this.editing ? 'Category updated.' : 'Category created.', 'success');
			const category = result.category || null;
			if (!this.editing && category && this.onCreated) {
				await this.onCreated(category);
				this.onCreated = null;
			}
			return category;
		} catch (error) {
			this.form.querySelector('[data-slug-error]').textContent = error.message;
			this.form.elements.slug.focus();
		}
	}

	requestCloseForm() {
		if (this.formDirty && !confirm('Discard your changes? The information entered in this dialog will be lost.')) return false;
		this.formDirty = false;
		this.dialog.close();
		return true;
	}

	async remove(id) {
		const row = this.rows.find(item => Number(item.id) === Number(id));
		if (!confirm(`Delete category "${row?.name || id}"? No files or assets will be deleted.`)) return;
		const body = new FormData();
		body.append('id', id);
		await AdminAPI.json(`includes/api.php?action=delete_category&type=${this.editor.config.assetType}`, { method: 'POST', body });
		await this.editor.loadCategories();
		await this.load();
	}

	updatePath() {
		const slug = this.form.elements.slug.value || 'category-slug';
		const row = this.rows.find(item => item.folder_url && item.slug === slug);
		const root = row?.folder_url?.replace(`${row.slug}/`, '') || `images/${this.editor.config.assetType}/`;
		this.form.querySelector('[data-path-preview]').textContent = `${root}${slug}/`;
	}

	slugify(value) {
		return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}

	escape(value) {
		return this.editor.escapeHtml(value);
	}
}
