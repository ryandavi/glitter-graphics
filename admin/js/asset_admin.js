// ============================================
// ASSET EDITOR BASE CLASS
// Shared functionality for all asset types
// ============================================
class AssetEditor {
    constructor(config) {
        // Config object defines asset-specific behavior
        this.config = config;
        
        // Data arrays
        this.assets = [];
        this.categories = [];
        this.tags = [];
        this.tagCategories = [];
        this.currentAsset = null;
        
        // UI state
        this.scrollPosition = undefined;
        
        this.init();
    }

    async init() {
        await this.loadCategories();
        await this.loadTags();
        await this.loadTagCategories();
        await this.loadAssets();
        
        if (this.config.enableSorting) {
            this.setupDragAndDrop();
        }
        
        this.setupCategoryFormHelpers();
    }

    // ===== LOADING METHODS =====

    async loadAssets() {
        const response = await fetch(`includes/api.php?action=list&type=${this.config.assetType}&_=` + Date.now());
        this.assets = await response.json();
        this.renderAssetList();
    }

    async loadCategories() {
        const response = await fetch(`includes/api.php?action=categories&type=${this.config.assetType}`);
        this.categories = await response.json();
    }

    async loadTags() {
        const response = await fetch(`includes/api.php?action=tags&type=${this.config.assetType}`);
        this.tags = await response.json();
    }

    async loadTagCategories() {
        const response = await fetch(`includes/api.php?action=tag_categories&type=${this.config.assetType}`);
        this.tagCategories = await response.json();
    }

    // ===== ASSET LIST RENDERING =====

    renderAssetList() {
        const container = document.getElementById(this.config.listContainerId);
        let html = '';
        let currentCategory = '';

        this.assets.forEach((asset, index) => {
            if (asset.category_name !== currentCategory) {
                if (currentCategory) html += '</div>';
                currentCategory = asset.category_name;
                html += `<div class="category-group">
                    <div class="category-label">${currentCategory}</div>`;
            }

            const active = this.currentAsset && this.currentAsset.id === asset.id ? 'active' : '';
            const draggable = this.config.enableSorting ? 'draggable="true"' : '';
            const dragHandle = this.config.enableSorting ? '<span class="drag-handle">⋮⋮</span>' : '';
            
            html += `
                <div class="swatch-item ${active}" 
                     data-id="${asset.id}" 
                     ${draggable}
                     onclick="app.selectAsset(${asset.id})">
                    ${dragHandle}
                    ${this.renderAssetThumbnail(asset)}
                    <span class="swatch-name">${asset.name}</span>
                </div>
            `;
        });

        if (currentCategory) html += '</div>';
        container.innerHTML = html;

        // Restore scroll position
        if (this.scrollPosition !== undefined) {
            container.scrollTop = this.scrollPosition;
        }
    }

    // Override in child class for custom thumbnail rendering
    renderAssetThumbnail(asset) {
        return `<div class="swatch-thumb" style="background-image: url('${CONFIG.image_base_path}${asset.url}');"></div>`;
    }

    // ===== ASSET SELECTION & EDITING =====

    async selectAsset(id) {
        // Save scroll position
        this.scrollPosition = document.getElementById(this.config.listContainerId).scrollTop;

        const response = await fetch(`includes/api.php?action=get&id=${id}&type=${this.config.assetType}`);
        this.currentAsset = await response.json();
        this.renderEditor();
        this.renderAssetList(); // Update active state

        // Restore scroll position in content
        document.getElementById('contentScroll').scrollTop = 0;
    }

    // Must be overridden by child class
    renderEditor() {
        throw new Error('renderEditor() must be implemented by child class');
    }

    // ===== SAVE/DELETE OPERATIONS =====

    async saveAsset() {
        if (!this.currentAsset) return;

        // Get data from child class
        const data = this.getAssetDataFromForm();
        
        this.showStatus('Saving...');

        const response = await fetch(`includes/api.php?action=update&type=${this.config.assetType}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            this.showStatus('Saved!', 'success');
            await this.loadAssets();
        } else {
            this.showStatus('Error: ' + result.error, 'error');
        }
    }

    // Must be overridden by child class
    getAssetDataFromForm() {
        throw new Error('getAssetDataFromForm() must be implemented by child class');
    }

    async deleteAsset() {
        if (!this.currentAsset) return;

        if (!confirm(`Delete this ${this.config.assetLabel.toLowerCase()}? This cannot be undone.`)) return;

        const formData = new FormData();
        formData.append('id', this.currentAsset.id);

        const response = await fetch(`includes/api.php?action=delete&type=${this.config.assetType}`, {
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

        const response = await fetch(`includes/api.php?action=add&type=${this.config.assetType}`, {
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
        const response = await fetch(`includes/api.php?action=categories&type=${this.config.assetType}`);
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

        const response = await fetch(`includes/api.php?action=add_category&type=${this.config.assetType}`, {
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

        const response = await fetch(`includes/api.php?action=delete_category&type=${this.config.assetType}`, {
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
        console.log('Category not found - ID:', id, 'Categories:', this.categories);
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

        const response = await fetch(`includes/api.php?action=update_category&type=${this.config.assetType}`, {
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
        document.getElementById('manageTagsModal').classList.add('active');
        this.renderTagList();
        this.renderTagCategorySelect();
    }

    hideManageTagsModal() {
        document.getElementById('manageTagsModal').classList.remove('active');
    }

    renderTagCategorySelect() {
        const select = document.getElementById('newTagCategory');
        select.innerHTML = this.tagCategories.map(cat =>
            `<option value="${cat.id}">${cat.name}</option>`
        ).join('');
    }

    async renderTagList() {
        const response = await fetch(`includes/api.php?action=tags&type=${this.config.assetType}`);
        const tags = await response.json();

        const grouped = {};
        tags.forEach(tag => {
            if (!grouped[tag.category_name]) {
                grouped[tag.category_name] = [];
            }
            grouped[tag.category_name].push(tag);
        });

        // Target the MODAL's tag list, not the editor's tag list
        const container = document.querySelector('#manageTagsModal .tag-management-list');
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

        const response = await fetch(`includes/api.php?action=add_tag&type=${this.config.assetType}`, {
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

        const response = await fetch(`includes/api.php?action=delete_tag&type=${this.config.assetType}`, {
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
    }

    removeTag(tagId) {
        this.currentAsset.tags = this.currentAsset.tags.filter(t => t.id != tagId);
        this.updateTagDisplay();
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

        const response = await fetch(`includes/api.php?action=save_export&type=${this.config.assetType}`, {
            method: 'POST'
        });

        const result = await response.json();

        if (result.success) {
            this.showStatus(`Saved to ${result.path} (${result.bytes} bytes)`, 'success');
        } else {
            alert('Error: ' + result.error);
            this.showStatus('Export failed', 'error');
        }
    }

    async exportCategoriesJSON() {
        this.showStatus('Exporting categories...');

        const response = await fetch(`includes/api.php?action=save_categories_export&type=${this.config.assetType}`, {
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
            e.preventDefault();
            const afterElement = this.getDragAfterElement(container, e.clientY);
            if (afterElement == null) {
                container.appendChild(draggedElement);
            } else {
                container.insertBefore(draggedElement, afterElement);
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
        const items = document.querySelectorAll('.swatch-item');
        const order = Array.from(items).map(item => parseInt(item.dataset.id));

        const response = await fetch(`includes/api.php?action=reorder&type=${this.config.assetType}`, {
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

    // ===== STATUS MESSAGE =====

    showStatus(message, type = 'info') {
        const status = document.getElementById('statusMessage');
        status.textContent = message;

        setTimeout(() => {
            status.textContent = 'Ready';
        }, 3000);
    }
}