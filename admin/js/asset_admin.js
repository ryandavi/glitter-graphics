// ============================================
// ASSET EDITOR BASE CLASS
// Shared functionality for all asset types
// ============================================
var adminFetch = window.adminFetch || ((...args) => AdminAPI.fetch(...args));
window.adminFetch = adminFetch;

class AssetEditor {
    constructor(config) {
        // Config object defines asset-specific behavior
        this.config = {
            enableSorting: false,
            showRecentSection: null,
            tagModalId: 'tagModal',
            ...config
        };
        if (this.config.showRecentSection === null) {
            this.config.showRecentSection = !this.config.enableSorting;
        }
        
        // Data arrays
        this.assets = [];
        this.categories = [];
        this.tags = [];
        this.tagCategories = [];
        this.currentAsset = null;
        this.dirty = false;
        this.analysisResults = null;
        this.filterText = '';
        this.exportStale = false;
        
        // UI state
        this.scrollPosition = undefined;
        
        this.init();
    }

    async init() {
        await this.loadCategories();
        await this.loadTags();
        await this.loadTagCategories();
        await this.loadAssets();
        this.setupSharedUi();
        
        if (this.config.enableSorting) {
            this.setupDragAndDrop();
        }
        
        this.setupCategoryFormHelpers();
        await this.openRequestedAsset();
    }

    // ===== LOADING METHODS =====

    async loadAssets() {
        const response = await adminFetch(`includes/api.php?action=list&type=${this.config.assetType}&_=` + Date.now());
        this.assets = await response.json();
        this.renderAssetList();
    }

    async loadCategories() {
        const response = await adminFetch(`includes/api.php?action=categories&type=${this.config.assetType}`);
        this.categories = await response.json();
    }

    async loadTags() {
        const response = await adminFetch(`includes/api.php?action=tags&type=${this.config.assetType}`);
        this.tags = await response.json();
    }

    async loadTagCategories() {
        const response = await adminFetch(`includes/api.php?action=tag_categories&type=${this.config.assetType}`);
        this.tagCategories = await response.json();
    }

    // ===== ASSET LIST RENDERING =====

	renderAssetList() {
		const container = document.getElementById(this.config.listContainerId);
		const query = this.filterText.toLowerCase();
		const assets = this.assets.filter(asset => !query || [
			asset.name,
			asset.category_name,
			asset.tag_names
		].join(' ').toLowerCase().includes(query));
		const renderItem = (asset, recent = false) => {
			const active = this.currentAsset && this.currentAsset.id == asset.id ? 'active' : '';
			const draggable = this.config.enableSorting && !recent ? 'draggable="true"' : '';
			return `<div class="swatch-item ${active}" data-id="${asset.id}" ${recent ? 'data-recent="true"' : ''} ${draggable}
				tabindex="0" onclick="app.selectAsset(${asset.id})">
				${this.config.enableSorting && !recent ? '<span class="drag-handle">⋮⋮</span>' : ''}
				${this.renderAssetThumbnail(asset)}
				<span class="swatch-name">${this.escapeHtml(asset.name)}</span>
			</div>`;
		};
		let html = '';
		const pending = assets.filter(asset => !Number(asset.is_active));
		if (pending.length) {
			html += `<details class="category-group pending-group" open>
				<summary class="category-label">Pending <span class="count-badge">${pending.length}</span></summary>
				<div class="category-items">${pending.map(asset => renderItem(asset, true)).join('')}</div>
			</details>`;
		}
		if (this.config.showRecentSection) {
			const recent = assets.filter(asset => Number(asset.is_active)).sort((a, b) => b.id - a.id).slice(0, 10);
			if (recent.length) {
				html += `<details class="category-group" open>
					<summary class="category-label">Recently Added (${recent.length})</summary>
					<div class="category-items">${recent.map(asset => renderItem(asset, true)).join('')}</div>
				</details>`;
			}
		}
		const groups = new Map();
		for (const asset of assets.filter(asset => Number(asset.is_active))) {
			if (!groups.has(asset.category_name)) groups.set(asset.category_name, []);
			groups.get(asset.category_name).push(asset);
		}
		for (const [category, group] of groups) {
			const key = `${this.config.assetType}:${group[0].category_slug || category}`;
			const isOpen = localStorage.getItem(`adminCategory:${key}`) !== 'closed';
			html += `<details class="category-group" data-state-key="${this.escapeHtml(key)}" ${isOpen ? 'open' : ''}>
				<summary class="category-label">${this.escapeHtml(category)} (${group.length})</summary>
				<div class="category-items">${group.map(asset => renderItem(asset)).join('')}</div>
			</details>`;
		}
		container.innerHTML = html || '<p class="empty-list">No matching assets</p>';
		container.querySelectorAll('details[data-state-key]').forEach(details => {
			details.addEventListener('toggle', () => localStorage.setItem(`adminCategory:${details.dataset.stateKey}`, details.open ? 'open' : 'closed'));
		});
		if (this.scrollPosition !== undefined) container.scrollTop = this.scrollPosition;
	}

    // Override in child class for custom thumbnail rendering
    renderAssetThumbnail(asset) {
        return `<div class="swatch-thumb" style="background-image: url('${CONFIG.image_base_path}${asset.url}');"></div>`;
    }

    // ===== ASSET SELECTION & EDITING =====

    async selectAsset(id) {
        if (this.dirty && !confirm('Discard unsaved changes?')) return;
        // Save scroll position
        this.scrollPosition = document.getElementById(this.config.listContainerId).scrollTop;

        const response = await adminFetch(`includes/api.php?action=get&id=${id}&type=${this.config.assetType}`);
        this.currentAsset = await response.json();
        this.renderEditor();
        if (!Number(this.currentAsset.is_active)) {
            const editor = document.getElementById('editorContent');
            editor.insertAdjacentHTML('afterbegin', `<div class="pending-actions">
				<strong>Pending review</strong>
				<button class="btn btn-primary" type="button" onclick="app.approveAsset()">Approve</button>
				<button class="btn btn-danger" type="button" onclick="app.rejectAsset()">Reject</button>
			</div>`);
        }
        this.setDirty(false);
        this.bindDirtyTracking();
        this.renderAssetList(); // Update active state

        // Restore scroll position in content
        document.getElementById('contentScroll').scrollTop = 0;
        if (!Number(this.currentAsset.is_active)) {
            await this.analyzeCurrentAsset();
            document.querySelectorAll('#analyzeResults [id^="suggested_tag_"]:not(:disabled)').forEach(input => {
                input.checked = true;
            });
        }
    }

    renderEditor() {
        const editor = document.getElementById('editorContent');
        document.getElementById('emptyState').style.display = 'none';
        editor.style.display = 'block';
        const sections = new Map();
        for (const field of this.constructor.FIELDS || []) {
            if (!field.input) continue;
            const section = field.section || 'basic';
            if (!sections.has(section)) sections.set(section, []);
            sections.get(section).push(field);
        }
        const sectionLabels = { basic: 'Basic Info', tech: 'Technical Properties', color: 'Color Properties' };
        editor.innerHTML = `<h1>${this.escapeHtml(this.currentAsset.name)}</h1>
            <button class="analyze-btn" type="button" onclick="app.analyzeCurrentAsset()">Auto-Analyze ${this.escapeHtml(this.config.assetLabel)}</button>
            ${[...sections].map(([section, fields]) => `<div class="form-section">
                <h3 class="form-section-title">${sectionLabels[section] || section}</h3>
                <div class="field-schema-grid">${fields.map(field => this.renderField(field)).join('')}</div>
            </div>`).join('')}
            <div class="form-section">
                <h3 class="form-section-title">Tags</h3>
                <div class="tag-section"><div class="tag-list" id="tagList"></div>
                    <select id="tagSelect" onchange="app.addTag(); this.value='';"></select>
                </div>
            </div>`;
        this.updateTagDisplay();
    }

    renderField(field) {
        const value = this.currentAsset[field.key];
        if (field.input === 'checkbox') {
            return `<label class="form-group checkbox-group"><input type="checkbox" id="${field.key}" ${Number(value) ? 'checked' : ''}> ${this.escapeHtml(field.label)}</label>`;
        }
        if (field.input === 'select') {
            return `<label class="form-group"><span>${this.escapeHtml(field.label)}</span><select id="${field.key}">
                ${this.categories.map(category => `<option value="${category.id}" ${Number(category.id) === Number(value) ? 'selected' : ''}>${this.escapeHtml(category.name)}</option>`).join('')}
            </select></label>`;
        }
        if (field.input === 'colors') {
            const colors = value ? String(value).split(',') : [];
            const weights = this.currentAsset.color_weights ? String(this.currentAsset.color_weights).split(',') : [];
            return `<div class="form-group field-span-full"><span>${this.escapeHtml(field.label)}</span>
                <div class="color-inputs" id="colorInputs">${colors.map((color, index) => this.renderColorField(color, index, weights[index])).join('')}</div>
                <button class="btn btn-secondary" type="button" onclick="app.addColorInput()">Add Color</button>
            </div>`;
        }
        const inputType = field.input === 'number' ? 'number' : 'text';
        const preview = field.key === 'url' && value ? `<img src="${CONFIG.image_base_path}${this.escapeHtml(value)}" class="preview-image" alt="Preview">` : '';
        return `<label class="form-group ${field.full ? 'field-span-full' : ''}"><span>${this.escapeHtml(field.label)}</span>
            <input type="${inputType}" id="${field.key}" value="${this.escapeHtml(value ?? '')}" ${field.step ? `step="${field.step}"` : ''}>
            ${preview}
        </label>`;
    }

    renderColorField(color, index, weight = null) {
        return `<div class="color-input-wrapper">
            <input type="color" value="${this.escapeHtml(color)}" onchange="app.syncColorInputs(${index})">
            <input type="text" value="${this.escapeHtml(color)}" onchange="app.syncColorInputs(${index})">
            ${weight !== null ? `<span class="color-coverage">${Math.round(Number(weight) * 100)}%</span>` : ''}
            <button class="color-remove-btn" type="button" onclick="app.removeColorInput(${index})">×</button>
        </div>`;
    }

    syncColorInputs(index) {
        const row = document.querySelectorAll('.color-input-wrapper')[index];
        const picker = row?.querySelector('input[type="color"]');
        const text = row?.querySelector('input[type="text"]');
        if (!picker || !text) return;
        if (document.activeElement === picker) text.value = picker.value;
        else picker.value = text.value;
        this.setDirty(true);
    }

    addColorInput() {
        const container = document.getElementById('colorInputs');
        container.insertAdjacentHTML('beforeend', this.renderColorField('#000000', container.children.length));
        this.setDirty(true);
    }

    removeColorInput(index) {
        document.getElementById('colorInputs')?.children[index]?.remove();
        this.setDirty(true);
    }

    // ===== SAVE/DELETE OPERATIONS =====

    async saveAsset() {
    if (!this.currentAsset) return;

    // SAVE SCROLL POSITION
    const contentScroll = document.getElementById('contentScroll');
    const scrollTop = contentScroll ? contentScroll.scrollTop : 0;

    // Get data from child class
    const data = this.getAssetDataFromForm();
    
    this.showStatus('Saving...');

    const response = await adminFetch(`includes/api.php?action=update&type=${this.config.assetType}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });

    const result = await response.json();

    if (result.success) {
        this.setDirty(false);
        this.showStaleStatus('Saved.');
        await this.loadAssets();
        
        // RESTORE SCROLL POSITION
        setTimeout(() => {
            const contentScroll = document.getElementById('contentScroll');
            if (contentScroll) contentScroll.scrollTop = scrollTop;
        }, 0);
    } else {
        this.showStatus('Error: ' + result.error, 'error');
    }
}

    getAssetDataFromForm() {
        const data = { id: this.currentAsset.id };
        for (const field of this.constructor.FIELDS || []) {
            if (!field.input) continue;
            const input = document.getElementById(field.key);
            const key = field.dbKey || field.key;
            if (field.input === 'checkbox') data[key] = input.checked ? 1 : 0;
            else if (field.input === 'number' || field.input === 'select') data[key] = input.value === '' ? null : Number(input.value);
            else if (field.input === 'colors') {
                const colors = [...document.querySelectorAll('#colorInputs input[type="text"]')].map(node => node.value.trim()).filter(Boolean);
                data[key] = colors.join(',');
                const oldColors = String(this.currentAsset.color_codes || '').split(',').filter(Boolean);
                const oldWeights = String(this.currentAsset.color_weights || '').split(',').filter(Boolean);
                data.color_weights = colors.length === oldColors.length && colors.every((color, index) => color === oldColors[index]) && oldWeights.length === colors.length
                    ? oldWeights.join(',')
                    : colors.map(() => (1 / colors.length).toFixed(2)).join(',');
            } else data[key] = input.value || (field.nullable ? null : '');
        }
        data.tags = this.currentAsset.tags.map(tag => Number(tag.id));
        return data;
    }

    async deleteAsset() {
        if (!this.currentAsset) return;

        if (!confirm(`Delete this ${this.config.assetLabel.toLowerCase()}? This cannot be undone.`)) return;

        const formData = new FormData();
        formData.append('id', this.currentAsset.id);

        const response = await adminFetch(`includes/api.php?action=delete&type=${this.config.assetType}`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            this.currentAsset = null;
            document.getElementById('editorContent').style.display = 'none';
            document.getElementById('emptyState').style.display = 'flex';
            await this.loadAssets();
            this.showStatus(`${this.config.assetLabel} deleted!`, 'success');
        } else {
            alert('Error: ' + result.error);
        }
    }

    // ===== ADD ASSET MODAL =====

    showAddModal() {
        const modal = document.getElementById('addModal');
        const quickCategory = document.getElementById('quickCategory');

        const options = this.categories.map(cat =>
            `<option value="${cat.slug}" data-id="${cat.id}">${cat.name}</option>`
        ).join('');

        quickCategory.innerHTML = '<option value="">Select category...</option>' + options;
        quickCategory.onchange = () => {
            if (!quickCategory.value || !this.pendingDropFiles?.length) return;
            const files = this.pendingDropFiles;
            this.pendingDropFiles = null;
            this.uploadFiles(files);
        };

        modal.classList.add('active');
    }

    hideAddModal() {
        document.getElementById('addModal').classList.remove('active');
    }

    updateFilePath() {
        const select = document.getElementById('quickCategory');
        const urlInput = document.getElementById(`new${this.config.assetLabel}Url`);
        const nameInput = document.getElementById(`new${this.config.assetLabel}Name`);

        if (select.value && nameInput.value) {
            const filename = nameInput.value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            urlInput.value = `images/${this.config.assetType}/${select.value}/${filename}.gif`;
        }
    }

    handleFileSelection(event) {
        const file = event.target.files[0];
        if (!file) return;

        const select = document.getElementById('quickCategory');
        const urlInput = document.getElementById(`new${this.config.assetLabel}Url`);

        if (!select.value) {
            alert('Please select a category first');
            event.target.value = '';
            return;
        }

        const ext = file.name.split('.').pop();
        const filename = file.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        urlInput.value = `images/${this.config.assetType}/${select.value}/${filename}.${ext}`;
        if (event.target.files.length) this.uploadFiles([...event.target.files]);
    }

    async addAsset() {
        const name = document.getElementById(`new${this.config.assetLabel}Name`).value.trim();
        const url = document.getElementById(`new${this.config.assetLabel}Url`).value.trim();
        const categorySlug = document.getElementById('quickCategory').value;

        if (!name || !url || !categorySlug) {
            alert('Please fill in all fields');
            return;
        }

        const select = document.getElementById('quickCategory');
        const categoryId = select.options[select.selectedIndex].dataset.id;

        const data = {
            name: name,
            filename: url.split('/').pop(),
            url: url,
            category_id: parseInt(categoryId)
        };

        this.showStatus('Adding...');

        const response = await adminFetch(`includes/api.php?action=add&type=${this.config.assetType}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            this.hideAddModal();
            await this.loadAssets();
            this.showStatus(`${this.config.assetLabel} added!`, 'success');

            // Clear form
            document.getElementById(`new${this.config.assetLabel}Name`).value = '';
            document.getElementById(`new${this.config.assetLabel}Url`).value = '';
            document.getElementById('quickCategory').value = '';
        } else {
            alert('Error: ' + result.error);
        }
    }

    // ===== CATEGORY MANAGEMENT =====

    showManageCategoriesModal() {
        document.getElementById('categoryModal').classList.add('active');
        this.renderCategoriesList();
    }

    hideCategoryModal() {
        document.getElementById('categoryModal').classList.remove('active');
    }

    async renderCategoriesList() {
        const response = await adminFetch(`includes/api.php?action=categories&type=${this.config.assetType}`);
        const categories = await response.json();

        const container = document.getElementById('categoriesList');
        
        if (categories.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No categories yet</p>';
            return;
        }

        container.innerHTML = categories.map(cat => `
            <div class="category-item">
                ${cat.color ? `<div class="category-color-preview" style="background: ${cat.color}"></div>` : ''}
                ${cat.icon ? `<img src="${CONFIG.image_base_path}${cat.icon}" alt="" class="category-icon-preview">` : ''}
                <div class="category-info">
                    <strong>${cat.name}</strong>
                    <span class="category-slug">${cat.slug}</span>
                </div>
                <div class="category-actions">
                    <button class="btn btn-sm" onclick="app.editCategory(${cat.id})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="app.deleteCategory(${cat.id})">Delete</button>
                </div>
            </div>
        `).join('');
    }

    setupCategoryFormHelpers() {
        const nameInput = document.getElementById('newCategoryName');
        const slugInput = document.getElementById('newCategorySlug');

        if (nameInput && slugInput) {
            nameInput.addEventListener('input', (e) => {
                if (!slugInput.dataset.manuallyEdited) {
                    slugInput.value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                }
            });

            slugInput.addEventListener('input', () => {
                slugInput.dataset.manuallyEdited = 'true';
            });
        }
    }

    async addCategory() {
        const name = document.getElementById('newCategoryName').value.trim();
        const slug = document.getElementById('newCategorySlug').value.trim();
        const description = document.getElementById('newCategoryDescription').value.trim();
        const icon = document.getElementById('newCategoryIcon').value.trim();
        const color = document.getElementById('newCategoryColor').value;
        const sortOrder = parseInt(document.getElementById('newCategorySortOrder').value) || 0;

        if (!name || !slug) {
            alert('Name and slug are required');
            return;
        }

        const data = { name, slug, description, icon, color, sort_order: sortOrder };

        const response = await adminFetch(`includes/api.php?action=add_category&type=${this.config.assetType}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            document.getElementById('newCategoryName').value = '';
            document.getElementById('newCategorySlug').value = '';
            document.getElementById('newCategoryDescription').value = '';
            document.getElementById('newCategoryIcon').value = '';
            document.getElementById('newCategorySortOrder').value = '0';
            delete document.getElementById('newCategorySlug').dataset.manuallyEdited;
            
            await this.loadCategories();
            await this.renderCategoriesList();
            this.showStatus('Category added!', 'success');
        } else {
            alert(result.error);
        }
    }

    async deleteCategory(id) {
        if (!confirm('Delete this category? This will fail if any assets use it.')) return;

        const formData = new FormData();
        formData.append('id', id);

        const response = await adminFetch(`includes/api.php?action=delete_category&type=${this.config.assetType}`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            await this.renderCategoriesList();
            this.showStatus('Category deleted!', 'success');
        } else {
            alert(result.error);
        }
    }

editCategory(id) {
    // Convert to int to ensure type match
    const category = this.categories.find(c => parseInt(c.id) === parseInt(id));
    if (!category) {
        this.showStatus('Category not found', 'error');
        return;
    }

    document.getElementById('editCategoryId').value = category.id;
    document.getElementById('editCategoryName').value = category.name;
    document.getElementById('editCategorySlug').value = category.slug;
    document.getElementById('editCategoryDescription').value = category.description || '';
    document.getElementById('editCategoryIcon').value = category.icon || '';
    document.getElementById('editCategoryColor').value = category.color || '#ff69b4';
    document.getElementById('editCategorySortOrder').value = category.sort_order || 0;

    document.getElementById('editCategoryModal').classList.add('active');
}

    hideEditCategoryModal() {
        document.getElementById('editCategoryModal').classList.remove('active');
    }

    async saveCategory() {
        const id = parseInt(document.getElementById('editCategoryId').value);
        const name = document.getElementById('editCategoryName').value.trim();
        const slug = document.getElementById('editCategorySlug').value.trim();
        const description = document.getElementById('editCategoryDescription').value.trim();
        const icon = document.getElementById('editCategoryIcon').value.trim();
        const color = document.getElementById('editCategoryColor').value;
        const sortOrder = parseInt(document.getElementById('editCategorySortOrder').value) || 0;

        const data = { id, name, slug, description, icon, color, sort_order: sortOrder };

        const response = await adminFetch(`includes/api.php?action=update_category&type=${this.config.assetType}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            this.hideEditCategoryModal();
            await this.loadCategories();
            await this.renderCategoriesList();
            this.showStatus('Category updated!', 'success');
        } else {
            alert(result.error);
        }
    }

    // ===== TAG MANAGEMENT =====

    showManageTagsModal() {
        const modal = document.getElementById(this.config.tagModalId || 'tagModal');
        modal.classList.add('active');
        this.renderTagList();
        this.renderTagCategorySelect();
    }

    hideManageTagsModal() {
        const modal = document.getElementById(this.config.tagModalId || 'tagModal');
        modal.classList.remove('active');
    }

    renderTagCategorySelect() {
        const select = document.getElementById('newTagCategory');
        select.innerHTML = this.tagCategories.map(cat =>
            `<option value="${cat.id}">${cat.name}</option>`
        ).join('');
    }

    async renderTagList() {
        const response = await adminFetch(`includes/api.php?action=tags&type=${this.config.assetType}`);
        const tags = await response.json();

        const grouped = {};
        tags.forEach(tag => {
            if (!grouped[tag.category_name]) {
                grouped[tag.category_name] = [];
            }
            grouped[tag.category_name].push(tag);
        });

        // Target the MODAL's tag list, not the editor's tag list
        const container = document.querySelector(`#${this.config.tagModalId || 'tagModal'} .tag-management-list`);
        if (!container) {
            console.error('Tag management list container not found in modal');
            return;
        }
        
        container.innerHTML = Object.entries(grouped).map(([category, categoryTags]) => `
            <div>
                <h5>${category}</h5>
                ${categoryTags.map(tag => `
                    <div class="management-item">
                        <div class="management-item-info">
                            <div class="management-item-name">
                                ${tag.hex_color ? `<span class="tag-color" style="background: ${tag.hex_color}; display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; border: 1px solid var(--border-primary);"></span>` : ''}
                                ${tag.name}
                            </div>
                        </div>
                        <button class="management-item-delete" onclick="app.deleteTag(${tag.id})">Delete</button>
                    </div>
                `).join('')}
            </div>
        `).join('');
    }

    async addNewTag() {
        const name = document.getElementById('newTagName').value.trim();
        const categoryId = parseInt(document.getElementById('newTagCategory').value);
        const hexColor = document.getElementById('newTagHexColor').value.trim();

        if (!name || !categoryId) {
            alert('Name and category are required');
            return;
        }

        const data = { name, category_id: categoryId };
        if (hexColor) data.hex_color = hexColor;

        const response = await adminFetch(`includes/api.php?action=add_tag&type=${this.config.assetType}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            document.getElementById('newTagName').value = '';
            document.getElementById('newTagHexColor').value = '';
            await this.loadTags();
            await this.renderTagList();
            this.showStatus('Tag added!', 'success');
        } else {
            alert(result.error);
        }
    }

    async deleteTag(id) {
        if (!confirm('Delete this tag? It will be removed from all assets.')) return;

        const formData = new FormData();
        formData.append('id', id);

        const response = await adminFetch(`includes/api.php?action=delete_tag&type=${this.config.assetType}`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            await this.loadTags();
            await this.renderTagList();
            const msg = result.removed_from ?
                `Tag deleted! Removed from ${result.removed_from} ${this.config.assetLabel.toLowerCase()}(s).` :
                'Tag deleted!';
            this.showStatus(msg, 'success');
        } else {
            alert('Error: ' + result.error);
        }
    }

    // ===== TAG EDITING (for current asset) =====

    async addTag() {
        const tagId = document.getElementById('tagSelect').value;
        if (!tagId) return;

        const tag = this.tags.find(t => t.id == tagId);
        if (!tag) return;

        this.currentAsset.tags.push(tag);
        this.updateTagDisplay();
        this.setDirty(true);
    }

    removeTag(tagId) {
        this.currentAsset.tags = this.currentAsset.tags.filter(t => t.id != tagId);
        this.updateTagDisplay();
        this.setDirty(true);
    }

    updateTagDisplay() {
        const s = this.currentAsset;
        const tagListHtml = s.tags.map(tag => `
            <div class="tag">
                ${tag.hex_color ? `<div class="tag-color" style="background: ${tag.hex_color}"></div>` : ''}
                <span>${tag.name}</span>
                <button onclick="app.removeTag(${tag.id})" class="tag-remove">×</button>
            </div>
        `).join('');

        document.getElementById('tagList').innerHTML = tagListHtml;

        const tagSelect = document.getElementById('tagSelect');
        const availableTags = this.tags.filter(t => !s.tags.find(st => st.id === t.id));
        const groupedTags = this.groupTagsByCategory(availableTags);

        tagSelect.innerHTML = `
            <option value="">Add tag...</option>
            ${groupedTags.map(group => `
                <optgroup label="${group.category}">
                    ${group.tags.map(tag => `<option value="${tag.id}">${tag.name}</option>`).join('')}
                </optgroup>
            `).join('')}
        `;
    }

    groupTagsByCategory(tags) {
        const grouped = {};
        tags.forEach(tag => {
            if (!grouped[tag.category_name]) {
                grouped[tag.category_name] = [];
            }
            grouped[tag.category_name].push(tag);
        });

        return Object.entries(grouped).map(([category, tags]) => ({
            category,
            tags
        }));
    }

    // ===== EXPORT =====

    async exportJSON() {
        this.showStatus('Exporting...');

        const response = await adminFetch(`includes/api.php?action=save_export&type=${this.config.assetType}`, {
            method: 'POST'
        });

        const result = await response.json();

        if (result.success) {
            this.exportStale = false;
            this.showStatus(`Saved to ${result.path} (${result.bytes} bytes)`, 'success');
        } else {
            alert('Error: ' + result.error);
            this.showStatus('Export failed', 'error');
        }
    }

    async exportCategoriesJSON() {
        this.showStatus('Exporting categories...');

        const response = await adminFetch(`includes/api.php?action=save_categories_export&type=${this.config.assetType}`, {
            method: 'POST'
        });

        const result = await response.json();

        if (result.success) {
            this.showStatus(`Categories saved to ${result.path} (${result.bytes} bytes)`, 'success');
        } else {
            alert('Error: ' + result.error);
            this.showStatus('Category export failed', 'error');
        }
    }

    // ===== DRAG AND DROP (for sorting) =====

    setupDragAndDrop() {
        const container = document.getElementById(this.config.listContainerId);
        let draggedElement = null;

        container.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('swatch-item')) {
                draggedElement = e.target;
                e.target.classList.add('dragging');
            }
        });

        container.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('swatch-item')) {
                e.target.classList.remove('dragging');
                this.saveOrder();
            }
        });

        container.addEventListener('dragover', (e) => {
            if (!draggedElement) return;
            e.preventDefault();
            const group = e.target.closest('.category-items');
            if (!group || group !== draggedElement.parentElement) return;
            const afterElement = this.getDragAfterElement(group, e.clientY);
            if (afterElement == null) {
                group.appendChild(draggedElement);
            } else {
                group.insertBefore(draggedElement, afterElement);
            }
        });
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.swatch-item:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    async saveOrder() {
        const items = document.querySelectorAll(`#${this.config.listContainerId} .category-items .swatch-item:not([data-recent])`);
        const order = Array.from(items).map(item => parseInt(item.dataset.id));
        if (new Set(order).size !== order.length) {
            this.showStatus('Order not saved: duplicate asset ids detected', 'error');
            return;
        }

        const response = await adminFetch(`includes/api.php?action=reorder&type=${this.config.assetType}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
        });

        const result = await response.json();
        if (result.success) {
            this.showStatus('Order saved!', 'success');
            await this.loadAssets();
        }
    }

	setupSharedUi() {
		const list = document.getElementById(this.config.listContainerId);
		const filter = document.createElement('input');
		filter.type = 'search';
		filter.className = 'asset-list-filter';
		filter.placeholder = `Filter ${this.config.assetLabelPlural.toLowerCase()}…`;
		filter.addEventListener('input', () => {
			this.filterText = filter.value;
			this.renderAssetList();
		});
		list.parentElement.insertBefore(filter, list);
		list.addEventListener('keydown', event => {
			if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
			const items = [...list.querySelectorAll('.swatch-item')];
			const index = items.indexOf(document.activeElement);
			const next = items[index + (event.key === 'ArrowDown' ? 1 : -1)];
			if (next) {
				event.preventDefault();
				next.focus();
			}
		});
		const sidebar = list.closest('.sidebar') || list.parentElement;
		sidebar.addEventListener('dragenter', event => {
			if ([...event.dataTransfer.types].includes('Files')) sidebar.classList.add('upload-drag-active');
		});
		sidebar.addEventListener('dragleave', event => {
			if (!sidebar.contains(event.relatedTarget)) sidebar.classList.remove('upload-drag-active');
		});
		sidebar.addEventListener('dragover', event => {
			if ([...event.dataTransfer.types].includes('Files')) event.preventDefault();
		});
		sidebar.addEventListener('drop', event => {
			if (!event.dataTransfer.files.length) return;
			event.preventDefault();
			sidebar.classList.remove('upload-drag-active');
			this.showAddModal();
			this.pendingDropFiles = [...event.dataTransfer.files];
			this.showStatus('Choose a category, then use the file input to upload the dropped files.');
		});
		window.addEventListener('beforeunload', event => {
			if (!this.dirty) return;
			event.preventDefault();
			event.returnValue = '';
		});
	}

	bindDirtyTracking() {
		const editor = document.getElementById('editorContent');
		editor.querySelectorAll('input, select, textarea').forEach(input => {
			input.addEventListener('input', () => this.setDirty(true));
			input.addEventListener('change', () => this.setDirty(true));
		});
	}

	setDirty(dirty) {
		this.dirty = dirty;
	}

	showStaleStatus(prefix) {
		this.exportStale = true;
		this.showStatus(`${prefix} data/${this.config.assetType === 'glitter' ? 'glitter' : 'stickers'}.json is stale — Export JSON to publish.`, 'warning', 8000);
	}

	escapeHtml(value) {
		const node = document.createElement('div');
		node.textContent = value ?? '';
		return node.innerHTML;
	}

	async uploadFiles(files) {
		const select = document.getElementById('quickCategory');
		const categoryId = select?.options[select.selectedIndex]?.dataset.id;
		if (!categoryId) {
			alert('Please select a category first');
			return;
		}
		for (let index = 0; index < files.length; index++) {
			this.showStatus(`Uploading ${index + 1} of ${files.length}: ${files[index].name}`);
			const body = new FormData();
			body.append('file', files[index]);
			body.append('category_id', categoryId);
			const response = await adminFetch(`includes/api.php?action=upload&type=${this.config.assetType}`, { method: 'POST', body });
			const result = await response.json();
			if (!result.success) {
				this.showStatus(result.duplicate ? `Duplicate: ${result.existing.name}` : `Upload failed: ${result.error}`, 'error', 6000);
			}
		}
		await this.loadAssets();
		this.hideAddModal();
		this.showStaleStatus('Uploads are pending approval.');
	}

	async analyzeCurrentAsset() {
		if (!this.currentAsset) return;
		this.showStatus(`Analyzing ${this.config.assetLabel.toLowerCase()}…`);
		const response = await adminFetch(`includes/api.php?action=analyze&id=${this.currentAsset.id}&type=${this.config.assetType}`);
		const analysis = await response.json();
		if (analysis.error) {
			this.showStatus(`Analysis failed: ${analysis.error}`, 'error');
			return;
		}
		this.showAnalyzeModal(analysis);
	}

	async analyzeBulk() {
		const includeColors = this.config.assetType !== 'glitter' || document.getElementById('bulkIncludeColors')?.checked !== false;
		if (!confirm(`Analyze all ${this.config.assetLabelPlural.toLowerCase()} in batches?`)) return;
		const ids = this.assets.filter(asset => Number(asset.is_active)).map(asset => Number(asset.id));
		const size = 10;
		let updated = 0;
		for (let offset = 0; offset < ids.length; offset += size) {
			this.showStatus(`Analyzing ${Math.min(offset + size, ids.length)} of ${ids.length}…`);
			const response = await adminFetch(`includes/api.php?action=analyze_all&type=${this.config.assetType}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: ids.slice(offset, offset + size), include_colors: includeColors })
			});
			const result = await response.json();
			if (result.error) throw new Error(result.error);
			updated += result.updated;
		}
		await this.loadAssets();
		this.showStaleStatus(`Analyzed ${updated} assets.`);
	}

	showAnalyzeModal(analysis) {
		const fields = this.constructor.FIELDS || [];
		const results = document.getElementById('analyzeResults');
		const changedFields = fields.filter(field =>
			field.analyze && !this.analysisValuesEqual(field, this.currentAsset[field.key], analysis[field.key])
		);
		const suggestions = (analysis.suggested_tags || []).filter(suggestion =>
			!suggestion.tag_id || !this.currentAsset.tags.some(tag => Number(tag.id) === Number(suggestion.tag_id))
		);
		results.innerHTML = changedFields.map(field => {
			const oldValue = this.currentAsset[field.key];
			const newValue = analysis[field.key];
			const format = field.analyze.format || (value => value ?? 'N/A');
			return `<div class="analyze-result-item">
				<input type="checkbox" id="apply_${field.key}" checked>
				<div class="analyze-result-content">
					<div class="analyze-result-label">${this.escapeHtml(field.label)}</div>
					<div class="analyze-comparison"><span>Current: ${this.escapeHtml(format(oldValue))}</span><span>Proposed: ${this.escapeHtml(format(newValue))}</span></div>
				</div>
			</div>`;
		}).join('') + suggestions.map(tag => {
			const index = analysis.suggested_tags.indexOf(tag);
			return `
			<label class="analyze-result-item suggested-tag ${tag.tag_id ? '' : 'disabled'}">
				<input type="checkbox" id="suggested_tag_${index}" ${tag.tag_id ? '' : 'disabled'}>
				<span><strong>${this.escapeHtml(tag.name)}</strong> — ${this.escapeHtml(tag.reason)}${tag.tag_id ? '' : ' (create tag first)'}</span>
			</label>`;
		}).join('');
		if (!results.children.length) {
			results.innerHTML = '<p class="analysis-no-changes">No changes detected.</p>';
		}
		this.analysisResults = analysis;
		document.getElementById('analyzeModal').classList.add('active');
	}

	analysisValuesEqual(field, oldValue, newValue) {
		if (field.input === 'checkbox') {
			return Boolean(Number(oldValue)) === Boolean(Number(newValue));
		}
		if (field.input === 'number') {
			if ((oldValue == null || oldValue === '') && (newValue == null || newValue === '')) return true;
			return Math.abs(Number(oldValue) - Number(newValue)) < 0.0005;
		}
		return String(oldValue ?? '') === String(newValue ?? '');
	}

	async openRequestedAsset() {
		const params = new URLSearchParams(window.location.search);
		const assetId = Number(params.get('asset'));
		if (assetId && this.assets.some(asset => Number(asset.id) === assetId)) {
			await this.selectAsset(assetId);
			return;
		}
		const addUrl = params.get('addUrl');
		if (!addUrl) return;
		this.showAddModal();
		const parts = addUrl.split('/');
		const categorySlug = parts.length >= 4 ? parts[2] : '';
		const category = this.categories.find(item => item.slug === categorySlug);
		const categorySelect = document.getElementById('quickCategory');
		if (category) categorySelect.value = category.slug;
		const label = this.config.assetLabel;
		const filename = parts.at(-1) || '';
		document.getElementById(`new${label}Url`).value = addUrl;
		document.getElementById(`new${label}Name`).value = filename
			.replace(/\.[^.]+$/, '')
			.replace(/[-_]+/g, ' ')
			.replace(/\b\w/g, letter => letter.toUpperCase());
	}

	hideAnalyzeModal() {
		document.getElementById('analyzeModal').classList.remove('active');
	}

	applyAnalysis() {
		for (const field of (this.constructor.FIELDS || []).filter(field => field.analyze)) {
			const checkbox = document.getElementById(`apply_${field.key}`);
			const input = document.getElementById(field.key);
			if (!checkbox?.checked || !input) continue;
			if (input.type === 'checkbox') input.checked = Boolean(Number(this.analysisResults[field.key]));
			else input.value = this.analysisResults[field.key] ?? '';
		}
		(this.analysisResults.suggested_tags || []).forEach((suggestion, index) => {
			if (!document.getElementById(`suggested_tag_${index}`)?.checked || !suggestion.tag_id) return;
			const tag = this.tags.find(candidate => Number(candidate.id) === Number(suggestion.tag_id));
			if (tag && !this.currentAsset.tags.some(existing => Number(existing.id) === Number(tag.id))) this.currentAsset.tags.push(tag);
		});
		this.updateTagDisplay();
		this.setDirty(true);
		this.hideAnalyzeModal();
	}

	async approveAsset() {
		const active = document.getElementById('is_active');
		if (active) active.checked = true;
		await this.saveAsset();
	}

	async rejectAsset() {
		if (!this.currentAsset || !confirm('Reject this pending asset and delete its file?')) return;
		const body = new FormData();
		body.append('id', this.currentAsset.id);
		const response = await adminFetch(`includes/api.php?action=reject&type=${this.config.assetType}`, { method: 'POST', body });
		const result = await response.json();
		if (!result.success) throw new Error(result.error);
		this.currentAsset = null;
		this.setDirty(false);
		await this.loadAssets();
		document.getElementById('editorContent').style.display = 'none';
		document.getElementById('emptyState').style.display = 'flex';
		this.showStatus('Pending asset rejected.', 'success');
	}

    // ===== STATUS MESSAGE =====

    showStatus(message, type = 'info', duration = 3000) {
        const status = document.getElementById('statusMessage');
        status.textContent = message;
        status.className = `status-message ${type}`;

        setTimeout(() => {
            status.textContent = this.exportStale
                ? `data/${this.config.assetType === 'glitter' ? 'glitter' : 'stickers'}.json is stale — Export JSON to publish.`
                : 'Ready';
        }, duration);
    }
}
