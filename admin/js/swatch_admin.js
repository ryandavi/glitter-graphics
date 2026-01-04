// ============================================
// GLITTER EDITOR CLASS
// ============================================
class GlitterEditor {
    constructor() {
        this.swatches = [];
        this.currentSwatch = null;
        this.categories = [];
        this.tags = [];
        this.tagCategories = [];
        this.scrollPosition = undefined;
        this.analysisResults = null;

        this.init();
    }

    async init() {
        await this.loadCategories();
        await this.loadSwatches();
        await this.loadTags();
        this.setupDragAndDrop();
    }

    async loadCategories() {
        const response = await fetch('includes/api.php?action=categories&type=glitter');
        this.categories = await response.json();
    }

    async loadSwatches() {
        const response = await fetch('includes/api.php?action=list&type=glitter');
        this.swatches = await response.json();
        this.renderSwatchList();
    }

    async loadTags() {
        const tagsResponse = await fetch('includes/api.php?action=tags&type=glitter');
        this.tags = await tagsResponse.json();

        const tagCategoriesResponse = await fetch('includes/api.php?action=tag_categories&type=glitter');
        this.tagCategories = await tagCategoriesResponse.json();
    }

    renderSwatchList() {
        const container = document.getElementById('swatchList');
        let html = '';
        let currentCategory = null;

        this.swatches.forEach(swatch => {
            if (swatch.category_slug !== currentCategory) {
                if (currentCategory) html += '</div></details>';
                currentCategory = swatch.category_slug;
                html += `<details open>
                    <summary>${swatch.category_name}</summary>
                    <div class="category-swatches">`;
            }

            const active = this.currentSwatch && this.currentSwatch.id === swatch.id ? 'active' : '';

            html += `
            <div class="swatch-item ${active}" 
                 data-id="${swatch.id}" 
                 draggable="true"
                 onclick="app.selectSwatch(${swatch.id})">
                <span class="drag-handle">⋮⋮</span>
                <div class="swatch-thumb" style="background-image: url('${CONFIG.image_base_path}${swatch.url}');"></div>
                <span class="swatch-name">${swatch.name}</span>
            </div>
        `;
        });

        if (currentCategory) html += '</div></details>';
        container.innerHTML = html;

        // Restore scroll position
        if (this.scrollPosition !== undefined) {
            container.scrollTop = this.scrollPosition;
        }
    }

    async selectSwatch(id) {
        // Save scroll position
        this.scrollPosition = document.getElementById('swatchList').scrollTop;

        const response = await fetch(`includes/api.php?action=get&id=${id}&type=glitter`);
        this.currentSwatch = await response.json();
        this.renderEditor();
        this.renderSwatchList(); // Update active state

        // Restore scroll position in content
        document.getElementById('contentScroll').scrollTop = 0;
    }

    renderEditor() {
        document.getElementById('emptyState').style.display = 'none';
        const editor = document.getElementById('editorContent');
        editor.style.display = 'block';

        const s = this.currentSwatch;
        const colors = s.color_codes ? s.color_codes.split(',') : [];

        editor.innerHTML = `
                    <h1>${s.name}</h1>
                    
                    <button class="analyze-btn" onclick="app.analyzeCurrentSwatch()">
                        🔍 Auto-Analyze Glitter
                    </button>
                    
                    <div class="form-section">
                        <h3 class="form-section-title">Basic Info</h3>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Name</label>
                                <input type="text" id="name" value="${s.name || ''}">
                            </div>
                            <div class="form-group">
                                <label>Generated Name</label>
                                <input type="text" id="generated_name" value="${s.generated_name || ''}">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>URL</label>
                            
                            <input type="text" id="url" value="${s.url || ''}">
                            <img src="${CONFIG.image_base_path}${s.url}" class="preview-image" alt="Preview">
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Category</label>
                                <select id="category_id">
                                    ${this.categories.map(cat =>
            `<option value="${cat.id}" ${cat.id == s.glitter_category_id ? 'selected' : ''}>${cat.name}</option>`
        ).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>&nbsp;</label>
                                <div class="checkbox-group">
                                    <input type="checkbox" id="is_pixelated" ${s.is_pixelated === '1' ? 'checked' : ''}>
                                    <label for="is_pixelated">Pixelated</label>
                                    
                                    <input type="checkbox" id="is_active" ${s.is_active === '1' ? 'checked' : ''}>
                                    <label for="is_active">Active</label>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h3 class="form-section-title">Technical Properties</h3>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Width (px)</label>
                                <input type="number" id="width" value="${s.width || ''}" min="0">
                            </div>
                            <div class="form-group">
                                <label>Height (px)</label>
                                <input type="number" id="height" value="${s.height || ''}" min="0">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>File Size (bytes)</label>
                                <input type="number" id="file_size" value="${s.file_size || ''}" min="0">
                            </div>
                            <div class="form-group">
                                <label>Frame Count</label>
                                <input type="number" id="frame_count" value="${s.frame_count || ''}" min="1">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Frame Rate (centiseconds)</label>
                                <input type="number" id="frame_rate" value="${s.frame_rate || ''}" min="0">
                            </div>
                            <div class="form-group">
                                <label>&nbsp;</label>
                                <div class="checkbox-group">
                                    <input type="checkbox" id="is_variable_framerate" ${s.is_variable_framerate === '1' ? 'checked' : ''}>
                                    <label for="is_variable_framerate">Variable Frame Rate</label>
                                </div>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>&nbsp;</label>
                                <div class="checkbox-group">
                                    <input type="checkbox" id="is_animated" ${s.is_animated === '1' ? 'checked' : ''}>
                                    <label for="is_animated">Animated</label>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>&nbsp;</label>
                                <div class="checkbox-group">
                                    <input type="checkbox" id="has_transparency" ${s.has_transparency === '1' ? 'checked' : ''}>
                                    <label for="has_transparency">Has Transparency</label>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h3 class="form-section-title">Color Data</h3>
                        
                        <div class="form-group color-codes">
                            <label>Color Codes</label>
                            <div class="color-inputs" id="colorInputs">
                                ${colors.map((color, i) => this.renderColorInput(color.trim(), i)).join('')}
                            </div>
                            <button class="add-color-btn" onclick="app.addColorInput()">+ Add Color</button>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Color Value (brightness)</label>
                                <input type="number" id="color_value" value="${s.color_value !== null ? s.color_value : ''}" step="0.001">
                            </div>
                            <div class="form-group">
                                <label>Hue</label>
                                <input type="number" id="hue" value="${s.hue || ''}" step="0.001">
                            </div>
                        </div>
                    </div>

                    <div class="form-section">
                        <h3 class="form-section-title">Tags</h3>
                        <div class="tag-section">
                            <div class="tag-list" id="tagList"></div>
                            <select id="tagSelect" onchange="app.addTag(); this.value='';">
                                <!-- Populated by updateTagDisplay -->
                            </select>
                        </div>
                    </div>
                `;

        this.updateTagDisplay();
    }

    renderColorInput(color, index) {
        return `
            <div class="color-input-wrapper">
                <input type="color" value="${color}" onchange="app.syncColorInputs(${index})">
                <input type="text" value="${color}" onchange="app.syncColorInputs(${index})">
                <button class="color-remove-btn" onclick="app.removeColorInput(${index})">×</button>
            </div>
        `;
    }

    syncColorInputs(index) {
        const wrapper = document.querySelectorAll('.color-input-wrapper')[index];
        const colorPicker = wrapper.querySelector('input[type="color"]');
        const textInput = wrapper.querySelector('input[type="text"]');

        if (event.target === colorPicker) {
            textInput.value = colorPicker.value;
        } else {
            colorPicker.value = textInput.value;
        }
    }

    addColorInput() {
        const container = document.getElementById('colorInputs');
        const index = container.children.length;
        container.insertAdjacentHTML('beforeend', this.renderColorInput('#000000', index));
    }

    removeColorInput(index) {
        const container = document.getElementById('colorInputs');
        container.children[index].remove();
    }

    updateTagDisplay() {
        // Update tag list
        const tagList = document.getElementById('tagList');
        if (tagList && this.currentSwatch) {
            tagList.innerHTML = this.currentSwatch.tags.map(tag => `
                <div class="tag">
                    ${tag.name}
                    <button onclick="app.removeTag(${tag.id})">×</button>
                </div>
            `).join('');
        }

        // Update tag select
        const tagSelect = document.getElementById('tagSelect');
        if (tagSelect) {
            const availableTags = this.tags.filter(tag =>
                !this.currentSwatch.tags.find(t => t.id == tag.id)
            );

            tagSelect.innerHTML = `
            <option value="">Add a tag...</option>
            ${this.tagCategories.map(category => `
                <optgroup label="${category.name}">
                    ${availableTags.filter(tag => tag.tag_category_id == category.id).map(tag => `
                        <option value="${tag.id}">${tag.name}</option>
                    `).join('')}
                </optgroup>
            `).join('')}
        `;
        }
    }

    addTag() {
        const tagId = parseInt(document.getElementById('tagSelect').value);
        if (!tagId) return;

        const tag = this.tags.find(t => t.id === tagId);
        if (tag && !this.currentSwatch.tags.find(t => t.id === tagId)) {
            this.currentSwatch.tags.push(tag);
            this.updateTagDisplay();
        }
    }

    removeTag(tagId) {
        this.currentSwatch.tags = this.currentSwatch.tags.filter(t => t.id != tagId);
        this.updateTagDisplay();
    }

    async saveSwatch() {
        if (!this.currentSwatch) return;

        // SAVE SCROLL POSITION
        const contentScroll = document.getElementById('contentScroll');
        const scrollTop = contentScroll ? contentScroll.scrollTop : 0;

        // Collect color codes from the multiple color inputs
        const colorInputs = document.querySelectorAll('#colorInputs input[type="text"]');
        const colorCodes = Array.from(colorInputs).map(input => input.value).join(',');

        const data = {
            id: this.currentSwatch.id,
            name: document.getElementById('name').value,
            url: document.getElementById('url').value,
            generated_name: document.getElementById('generated_name').value,
            glitter_category_id: parseInt(document.getElementById('category_id').value),
            is_pixelated: document.getElementById('is_pixelated').checked ? 1 : 0,
            is_active: document.getElementById('is_active').checked ? 1 : 0,
            hue: parseFloat(document.getElementById('hue').value) || null,
            color_value: parseFloat(document.getElementById('color_value').value) || null,
            color_codes: colorCodes,
            frame_count: parseInt(document.getElementById('frame_count').value) || 0,
            frame_rate: parseInt(document.getElementById('frame_rate').value) || 10,
            is_variable_framerate: document.getElementById('is_variable_framerate').checked ? 1 : 0,
            width: parseInt(document.getElementById('width').value) || 0,
            height: parseInt(document.getElementById('height').value) || 0,
            file_size: parseInt(document.getElementById('file_size').value) || 0,
            is_animated: document.getElementById('is_animated').checked ? 1 : 0,
            has_transparency: document.getElementById('has_transparency').checked ? 1 : 0,
            tags: this.currentSwatch.tags.map(t => t.id)
        };

        this.showStatus('Saving...');

        const response = await fetch('includes/api.php?action=update&type=glitter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            this.showStatus('Saved!', 'success');
            // Reload the list from server to get proper category grouping
            await this.loadSwatches();
            // Re-select current item to update editor
            await this.selectSwatch(this.currentSwatch.id);

            // RESTORE SCROLL POSITION
            setTimeout(() => {
                const contentScroll = document.getElementById('contentScroll');
                if (contentScroll) contentScroll.scrollTop = scrollTop;
            }, 0);
        } else {
            this.showStatus('Error: ' + result.error, 'error');
        }
    }

    async deleteSwatch() {
        if (!this.currentSwatch) return;

        if (!confirm('Delete this swatch? This cannot be undone.')) return;

        const formData = new FormData();
        formData.append('id', this.currentSwatch.id);

        await fetch('includes/api.php?action=delete&type=glitter', {
            method: 'POST',
            body: formData
        });

        this.currentSwatch = null;
        document.getElementById('editorContent').style.display = 'none';
        document.getElementById('emptyState').style.display = 'block';

        await this.loadSwatches();
        this.showStatus('Deleted', 'success');
    }

    async analyzeCurrentSwatch() {
        if (!this.currentSwatch) return;

        this.showStatus('Analyzing...');

        const response = await fetch(`includes/api.php?action=analyze&id=${this.currentSwatch.id}&type=glitter`);
        const analysis = await response.json();

        if (analysis.error) {
            this.showStatus('Error: ' + analysis.error, 'error');
            return;
        }

        this.analysisResults = analysis;
        this.showAnalyzeModal();
        this.showStatus('Analysis complete!', 'success');
    }

    async analyzeBulk() {
        if (!confirm('This will analyze ALL glitter assets and update their technical properties. This may take several minutes. Continue?')) {
            return;
        }

        this.showStatus('Starting bulk analysis...');

        try {
            const response = await fetch('includes/api.php?action=analyze_all&type=glitter', {
                method: 'POST'
            });

            const result = await response.json();

            if (result.success) {
                this.showStatus(`Bulk analysis complete! Updated ${result.updated} glitter assets.`, 'success');
                await this.loadSwatches();
                if (this.currentSwatch) {
                    await this.selectSwatch(this.currentSwatch.id);
                }
            } else {
                this.showStatus('Error: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            this.showStatus('Error: ' + error.message, 'error');
        }
    }

    showAnalyzeModal() {
        const analysis = this.analysisResults;
        const colors = analysis.color_codes ? analysis.color_codes.split(',') : [];

        // Generate suggested tags from color name
        const suggestedTags = this.generateTagsFromColorName(analysis.generated_name || '');

        // Filter out tags already applied to current swatch
        const currentTagIds = this.currentSwatch.tags.map(t => t.id);
        const availableTags = this.tags.filter(tag => {
            return suggestedTags.includes(tag.name.toLowerCase()) &&
                !currentTagIds.includes(tag.id);
        });

        const resultsHtml = `
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_width" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Width</div>
                <div class="analyze-result-value">${analysis.width || 'N/A'} px</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_height" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Height</div>
                <div class="analyze-result-value">${analysis.height || 'N/A'} px</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_file_size" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">File Size</div>
                <div class="analyze-result-value">${analysis.file_size || 'N/A'} bytes</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_frame_count" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Frame Count</div>
                <div class="analyze-result-value">${analysis.frame_count || 'N/A'}</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_frame_rate" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Frame Rate</div>
                <div class="analyze-result-value">${analysis.frame_rate !== null && analysis.frame_rate !== undefined ? analysis.frame_rate : 'N/A'} centiseconds</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_is_variable_framerate" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Variable Frame Rate</div>
                <div class="analyze-result-value">${analysis.is_variable_framerate ? 'Yes' : 'No'}</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_is_animated" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Animated</div>
                <div class="analyze-result-value">${analysis.is_animated ? 'Yes' : 'No'}</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_has_transparency" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Has Transparency</div>
                <div class="analyze-result-value">${analysis.has_transparency ? 'Yes' : 'No'}</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_color_codes" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Color Codes</div>
                <div class="analyze-result-value">
                    ${colors.length} color(s) detected
                    <div class="analyze-colors-preview" id="analyzeColorsPreview">
                        ${colors.map((c, i) => `
                            <div class="analyze-colors-preview-swatch">
                                <div class="analyze-color-box" style="background: ${c};"></div>
                                <span style="font-size: 11px; color: var(--color-text-secondary);">${c}</span>
                                <button onclick="app.removeAnalysisColor(${i})" style="padding: 2px 6px; font-size: 11px; background: var(--color-danger); color: white; border: none; border-radius: 3px; cursor: pointer;">×</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_color_value" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Color Value (Brightness)</div>
                <div class="analyze-result-value">${analysis.color_value !== null ? analysis.color_value : 'N/A'}</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_hue" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Hue</div>
                <div class="analyze-result-value">${analysis.hue || 'N/A'}</div>
            </div>
        </div>
        
        <div class="analyze-result-item">
            <input type="checkbox" id="apply_generated_name" checked>
            <div class="analyze-result-content">
                <div class="analyze-result-label">Generated Name</div>
                <div class="analyze-result-value">${analysis.generated_name || 'N/A'}</div>
            </div>
        </div>
        
        ${availableTags.length > 0 ? `
            <div class="analyze-result-item">
                <input type="checkbox" id="apply_suggested_tags" checked>
                <div class="analyze-result-content">
                    <div class="analyze-result-label">Suggested Tags</div>
                    <div class="analyze-result-value">
                        ${availableTags.map(tag => `
                            <label style="display: inline-block; margin-right: 12px;">
                                <input type="checkbox" id="tag_suggest_${tag.id}" checked>
                                ${tag.name}
                            </label>
                        `).join('')}
                    </div>
                </div>
            </div>
        ` : ''}
    `;

        document.getElementById('analyzeResults').innerHTML = resultsHtml;
        document.getElementById('analyzeModal').classList.add('active');
    }

    hideAnalyzeModal() {
        document.getElementById('analyzeModal').classList.remove('active');
    }

    applyAnalysis() {
        const analysis = this.analysisResults;

        // Apply technical properties
        if (document.getElementById('apply_width').checked) {
            document.getElementById('width').value = analysis.width || '';
        }

        if (document.getElementById('apply_height').checked) {
            document.getElementById('height').value = analysis.height || '';
        }

        if (document.getElementById('apply_file_size').checked) {
            document.getElementById('file_size').value = analysis.file_size || '';
        }

        if (document.getElementById('apply_frame_count').checked) {
            document.getElementById('frame_count').value = analysis.frame_count || '';
        }

        if (document.getElementById('apply_frame_rate').checked) {
            document.getElementById('frame_rate').value = analysis.frame_rate || '';
        }

        if (document.getElementById('apply_is_variable_framerate').checked) {
            document.getElementById('is_variable_framerate').checked = analysis.is_variable_framerate;
        }

        if (document.getElementById('apply_is_animated').checked) {
            document.getElementById('is_animated').checked = analysis.is_animated;
        }

        if (document.getElementById('apply_has_transparency').checked) {
            document.getElementById('has_transparency').checked = analysis.has_transparency;
        }

        if (document.getElementById('apply_color_codes').checked) {
            const colors = analysis.color_codes ? analysis.color_codes.split(',') : [];
            const container = document.getElementById('colorInputs');
            if (container) {
                container.innerHTML = colors.map((color, i) => this.renderColorInput(color.trim(), i)).join('');
            }
        }

        if (document.getElementById('apply_color_value').checked) {
            document.getElementById('color_value').value = analysis.color_value !== null ? analysis.color_value : '';
        }

        if (document.getElementById('apply_hue').checked) {
            document.getElementById('hue').value = analysis.hue || '';
        }

        if (document.getElementById('apply_generated_name').checked) {
            document.getElementById('generated_name').value = analysis.generated_name || '';
        }

        // Apply suggested tags
        const applyTagsCheckbox = document.getElementById('apply_suggested_tags');
        if (applyTagsCheckbox && applyTagsCheckbox.checked) {
            const tagCheckboxes = document.querySelectorAll('[id^="tag_suggest_"]:checked');
            tagCheckboxes.forEach(checkbox => {
                const tagId = parseInt(checkbox.id.replace('tag_suggest_', ''));
                const tag = this.tags.find(t => t.id == tagId);

                if (tag && !this.currentSwatch.tags.find(t => t.id == tagId)) {
                    this.currentSwatch.tags.push(tag);
                }
            });

            this.updateTagDisplay();
        }

        this.hideAnalyzeModal();
        this.showStatus('Analysis applied!', 'success');
    }

    removeAnalysisColor(index) {
        const colors = this.analysisResults.color_codes.split(',');
        colors.splice(index, 1);
        this.analysisResults.color_codes = colors.join(',');
        this.showAnalyzeModal();
    }

    generateTagsFromColorName(colorName) {
        if (!colorName) return [];
        
        const words = colorName.toLowerCase().split(/[\s-_]+/);
        return words.filter(word => word.length > 3);
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
        const response = await fetch('includes/api.php?action=categories&type=glitter');
        const categories = await response.json();

        const container = document.getElementById('categoriesList');
        
        if (categories.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No categories yet</p>';
            return;
        }

        container.innerHTML = categories.map(cat => `
            <div class="category-item">
                ${cat.color ? `<div class="category-color-preview" style="background: ${cat.color}"></div>` : ''}
                ${cat.icon ? `<img src="${CONFIG.image_base_path}${cat.icon}" alt="${cat.name}" class="category-icon">` : ''}
                <div class="category-info">
                    <div class="category-name">${cat.name}</div>
                    <div class="category-slug">${cat.slug}</div>
                </div>
                <div class="category-actions">
                    <button class="btn btn-sm" onclick="app.editCategory(${cat.id})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="app.deleteCategory(${cat.id})">Delete</button>
                </div>
            </div>
        `).join('');
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

        const response = await fetch('includes/api.php?action=add_category&type=glitter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            // Clear form
            document.getElementById('newCategoryName').value = '';
            document.getElementById('newCategorySlug').value = '';
            document.getElementById('newCategoryDescription').value = '';
            document.getElementById('newCategoryIcon').value = '';
            document.getElementById('newCategoryColor').value = '#ff69b4';
            document.getElementById('newCategorySortOrder').value = '0';

            // Reload categories
            await this.loadCategories();
            this.renderCategoriesList();
            this.showStatus('Category added successfully', 'success');
        } else {
            alert('Error: ' + result.error);
        }
    }

    async editCategory(id) {
        const response = await fetch('includes/api.php?action=categories&type=glitter');
        const categories = await response.json();
        const category = categories.find(c => parseInt(c.id) === parseInt(id));

        if (!category) {
            alert('Category not found');
            return;
        }

        // Populate edit form
        document.getElementById('editCategoryId').value = category.id;
        document.getElementById('editCategoryName').value = category.name;
        document.getElementById('editCategorySlug').value = category.slug;
        document.getElementById('editCategoryDescription').value = category.description || '';
        document.getElementById('editCategoryIcon').value = category.icon || '';
        document.getElementById('editCategoryColor').value = category.color || '#ff69b4';
        document.getElementById('editCategorySortOrder').value = category.sort_order || 0;

        // Show edit modal
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

        if (!name || !slug) {
            alert('Name and slug are required');
            return;
        }

        const data = { id, name, slug, description, icon, color, sort_order: sortOrder };

        const response = await fetch('includes/api.php?action=update_category&type=glitter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            this.hideEditCategoryModal();
            await this.loadCategories();
            this.renderCategoriesList();
            this.showStatus('Category updated successfully', 'success');
        } else {
            alert('Error: ' + result.error);
        }
    }

    async deleteCategory(id) {
        if (!confirm('Delete this category? All glitter in this category will need to be reassigned.')) {
            return;
        }

        const formData = new FormData();
        formData.append('id', id);

        const response = await fetch('includes/api.php?action=delete_category&type=glitter', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            await this.loadCategories();
            this.renderCategoriesList();
            this.showStatus('Category deleted', 'success');
        } else {
            alert('Error: ' + result.error);
        }
    }

    // ===== TAG MANAGEMENT =====

    showManageTagsModal() {
        document.getElementById('tagModal').classList.add('active');
        this.renderTagManagementList();
    }

    hideManageTagsModal() {
        document.getElementById('tagModal').classList.remove('active');
    }

    async renderTagManagementList() {
        const container = document.querySelector('.tag-management-list');
        
        if (this.tagCategories.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">No tag categories yet</p>';
            return;
        }

        container.innerHTML = this.tagCategories.map(category => {
            const tagsInCategory = this.tags.filter(tag => tag.tag_category_id == category.id);
            
            return `
                <div class="tag-category-section">
                    <h5>${category.name}</h5>
                    ${tagsInCategory.length > 0 ? `
                        <div class="tag-management-items">
                            ${tagsInCategory.map(tag => `
                                <div class="tag-management-item">
                                    <span>${tag.name}</span>
                                    ${tag.hex_color ? `<span class="tag-color-preview" style="background: ${tag.hex_color}"></span>` : ''}
                                    <button class="btn btn-sm btn-danger" onclick="app.deleteTag(${tag.id})">Delete</button>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<p style="color: var(--text-secondary); font-size: 12px;">No tags in this category</p>'}
                </div>
            `;
        }).join('');
    }

    async addNewTag() {
        const name = document.getElementById('newTagName').value.trim();
        const categoryId = parseInt(document.getElementById('newTagCategory').value);
        const hexColor = document.getElementById('newTagHexColor').value.trim();

        if (!name || !categoryId) {
            alert('Name and category are required');
            return;
        }

        const data = { 
            name, 
            tag_category_id: categoryId,
            hex_color: hexColor || null
        };

        const response = await fetch('includes/api.php?action=add_tag&type=glitter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            // Clear form
            document.getElementById('newTagName').value = '';
            document.getElementById('newTagCategory').value = '';
            document.getElementById('newTagHexColor').value = '';

            // Reload tags
            await this.loadTags();
            this.renderTagManagementList();
            this.showStatus('Tag added successfully', 'success');
        } else {
            alert('Error: ' + result.error);
        }
    }

    async deleteTag(id) {
        if (!confirm('Delete this tag?')) {
            return;
        }

        const formData = new FormData();
        formData.append('id', id);

        const response = await fetch('includes/api.php?action=delete_tag&type=glitter', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            await this.loadTags();
            this.renderTagManagementList();
            this.showStatus('Tag deleted', 'success');
        } else {
            alert('Error: ' + result.error);
        }
    }

    // ===== ADD NEW GLITTER =====

    showAddModal() {
        const modal = document.getElementById('addModal');
        const quickCategory = document.getElementById('quickCategory');

        // Build options with both id and slug
        const options = this.categories.map(cat =>
            `<option value="${cat.slug}" data-id="${cat.id}">${cat.name}</option>`
        ).join('');

        quickCategory.innerHTML = '<option value="">Select category...</option>' + options;

        modal.classList.add('active');
    }

    hideAddModal() {
        document.getElementById('addModal').classList.remove('active');
    }

    handleFileSelection(event) {
        const file = event.target.files[0];
        if (!file) return;

        const category = document.getElementById('quickCategory').value;
        if (!category) {
            alert('Please select a category first');
            event.target.value = '';
            return;
        }

        const path = `images/glitter/${category}/${file.name}`;
        document.getElementById('newSwatchUrl').value = path;
        event.target.value = '';
    }

    updateFilePath() {
        const category = document.getElementById('quickCategory').value;
        const currentPath = document.getElementById('newSwatchUrl').value;

        if (!category || !currentPath) return;

        // Extract filename from current path
        const match = currentPath.match(/images\/glitter\/[^\/]+\/(.+)$/);

        if (match) {
            const filename = match[1];
            const newPath = `images/glitter/${category}/${filename}`;
            document.getElementById('newSwatchUrl').value = newPath;
        }
    }

    async addSwatch() {
        const name = document.getElementById('newSwatchName').value.trim();
        const url = document.getElementById('newSwatchUrl').value.trim();
        const categorySlug = document.getElementById('quickCategory').value;

        if (!name || !url || !categorySlug) {
            alert('Please fill in all fields');
            return;
        }

        const select = document.getElementById('quickCategory');
        const categoryId = select.options[select.selectedIndex].dataset.id;

        const data = {
            name: name,
            url: url,
            category_id: parseInt(categoryId)
        };

        this.showStatus('Adding...');

        const response = await fetch('includes/api.php?action=add&type=glitter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            this.hideAddModal();
            await this.loadSwatches();
            this.showStatus('Glitter added!', 'success');

            // Clear form
            document.getElementById('newSwatchName').value = '';
            document.getElementById('newSwatchUrl').value = '';
            document.getElementById('quickCategory').value = '';
        } else {
            alert('Error: ' + result.error);
        }
    }

    // ===== EXPORT =====

    async exportJSON() {
        this.showStatus('Exporting...');

        const response = await fetch('includes/api.php?action=save_export&type=glitter', {
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

        const response = await fetch('includes/api.php?action=save_categories_export&type=glitter', {
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

    // ===== DRAG AND DROP =====

    setupDragAndDrop() {
        const container = document.getElementById('swatchList');
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
                const categoryContainer = draggedElement.closest('.category-swatches');
                if (categoryContainer) {
                    categoryContainer.appendChild(draggedElement);
                }
            } else {
                afterElement.parentNode.insertBefore(draggedElement, afterElement);
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

        const response = await fetch('includes/api.php?action=reorder&type=glitter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
        });

        const result = await response.json();
        if (result.success) {
            this.showStatus('Order saved', 'success');
        }
    }

    // ===== UTILITIES =====

    showStatus(message, type = 'info') {
        const status = document.getElementById('statusMessage');
        status.textContent = message;
        status.className = `status-message ${type}`;
        setTimeout(() => {
            status.textContent = '';
            status.className = 'status-message';
        }, 3000);
    }
}

// Initialize
const app = new GlitterEditor();