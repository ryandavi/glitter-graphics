
        class SwatchEditor {
            constructor() {
                this.swatches = [];
                this.categories = [];
                this.tags = [];
                this.currentSwatch = null;
                this.init();
            }

            async init() {
                await this.loadCategories();
                await this.loadTags();
                await this.loadSwatches();
                this.setupDragAndDrop();
            }

            async loadSwatches() {
                const response = await fetch('includes/api.php?action=list&_=' + Date.now());
                this.swatches = await response.json();
                this.renderSwatchList();
            }

            async loadCategories() {
                const response = await fetch('includes/api.php?action=categories');
                this.categories = await response.json();
            }

            async loadTags() {
                const response = await fetch('includes/api.php?action=tags');
                this.tags = await response.json();
            }

            renderSwatchList() {
                const container = document.getElementById('swatchList');
                let html = '';
                let currentCategory = '';

                this.swatches.forEach((swatch, index) => {
                    if (swatch.category_name !== currentCategory) {
                        if (currentCategory) html += '</div>';
                        currentCategory = swatch.category_name;
                        html += `<div class="category-group">
                            <div class="category-label">${currentCategory}</div>`;
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

                if (currentCategory) html += '</div>';
                container.innerHTML = html;

                // Restore scroll position
                if (this.scrollPosition !== undefined) {
                    container.scrollTop = this.scrollPosition;
                }
            }

            async selectSwatch(id) {
                // Save scroll position
                this.scrollPosition = document.getElementById('swatchList').scrollTop;

                const response = await fetch(`includes/api.php?action=get&id=${id}`);
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
                                        `<option value="${cat.id}" ${cat.id == s.category_id ? 'selected' : ''}>${cat.name}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>&nbsp;</label>
                                <div class="checkbox-group">
                                    <input type="checkbox" id="is_pixelated" ${s.is_pixelated ? 'checked' : ''}>
                                    <label for="is_pixelated">Pixelated</label>
                                    
                                    <input type="checkbox" id="is_active" ${s.is_active ? 'checked' : ''}>
                                    <label for="is_active">Active</label>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h3 class="form-section-title">Frame Data</h3>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Frame Count</label>
                                <input type="number" id="frame_count" value="${s.frame_count || ''}">
                            </div>
                            <div class="form-group">
                                <label>Frame Rate (centiseconds)</label>
                                <input type="number" id="frame_rate" value="${s.frame_rate || ''}">
                            </div>
                        </div>
                        <div class="form-group">
                            <div class="checkbox-group">
                                <input type="checkbox" id="is_variable_framerate" ${s.is_variable_framerate ? 'checked' : ''}>
                                <label for="is_variable_framerate">Variable Frame Rate</label>
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h3 class="form-section-title">Color Data</h3>
                        
                        <div class="form-group">
                            <label>Color Codes</label>
                            <div class="color-inputs" id="colorInputs">
                                ${colors.map((color, i) => this.renderColorInput(color.trim(), i)).join('')}
                            </div>
                            <button class="add-color-btn" onclick="app.addColorInput()">+ Add Color</button>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Color Value (brightness)</label>
                                <input type="number" id="color_value" value="${s.color_value !== null ? s.color_value : ''}" min="0" max="1">
                            </div>
                            <div class="form-group">
                                <label>Hue (0-1, neutrals=1.1)</label>
                                <input type="text" id="hue" value="${s.hue || ''}">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>Sort Order</label>
                            <input type="number" id="sort_order" value="${s.sort_order || ''}">
                        </div>
                    </div>
                    
                    <div class="form-section">
                        <h3 class="form-section-title">Tags</h3>
                        <div class="tag-list">
                            ${s.tags.map(tag => `
                                <div class="tag">
                                    ${tag.hex_color ? `<span class="tag-color" style="background: ${tag.hex_color};"></span>` : ''}
                                    ${tag.name}
                                    <button class="tag-remove" onclick="app.removeTag(${tag.id})">×</button>
                                </div>
                            `).join('')}
                        </div>
                        <div class="tag-select-container">
                            <select id="tagSelect">
                                <option value="">Select tag...</option>
                                ${this.groupTagsByCategory().map(group => `
                                    <optgroup label="${group.category}">
                                        ${group.tags.map(tag => `
                                            <option value="${tag.id}" ${s.tags.some(t => t.id == tag.id) ? 'disabled' : ''}>
                                                ${tag.name}
                                            </option>
                                        `).join('')}
                                    </optgroup>
                                `).join('')}
                            </select>
                            <button class="tag-add-btn" onclick="app.addTag()">Add</button>
                        </div>
                    </div>
                `;
            }

            renderColorInput(color, index) {
                return `
                    <div class="color-input-wrapper">
                        <input type="color" value="${color}" onchange="app.updateColorText(${index}, this.value)">
                        <input type="text" value="${color}" onchange="app.updateColorPicker(${index}, this.value)" placeholder="#FF0000">
                        <button class="color-remove-btn" onclick="app.removeColor(${index})">×</button>
                    </div>
                `;
            }

            groupTagsByCategory() {
                const grouped = {};
                this.tags.forEach(tag => {
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

            addColorInput() {
                const container = document.getElementById('colorInputs');
                const index = container.children.length;
                const div = document.createElement('div');
                div.innerHTML = this.renderColorInput('#FF0000', index);
                container.appendChild(div.firstElementChild);
            }

            removeColor(index) {
                const container = document.getElementById('colorInputs');

                const colorGroups = container.querySelectorAll('.color-input-wrapper');

                const colors = Array.from(colorGroups).map(group =>
                    group.querySelector('input[type="text"]').value
                );

                colors.splice(index, 1);

                container.innerHTML = colors
                    .map((color, i) => this.renderColorInput(color, i))
                    .join('');
            }


            updateColorPicker(index, value) {
                if (/^#[0-9A-F]{6}$/i.test(value)) {
                    const container = document.getElementById('colorInputs');
                    const colorInput = container.children[index].querySelector('input[type="color"]');
                    colorInput.value = value.toUpperCase();
                }
            }

            async addTag() {
                const tagId = document.getElementById('tagSelect').value;
                if (!tagId) return;

                const tag = this.tags.find(t => t.id == tagId);
                if (!tag) return;

                // Add to current swatch tags
                this.currentSwatch.tags.push(tag);

                // Update just the tag display, not the entire editor
                this.updateTagDisplay();
            }

            updateTagDisplay() {
                const s = this.currentSwatch;
                const tagListHtml = s.tags.map(tag => `
        <div class="tag">
            ${tag.hex_color ? `<span class="tag-color" style="background: ${tag.hex_color};"></span>` : ''}
            ${tag.name}
            <button class="tag-remove" onclick="app.removeTag(${tag.id})">×</button>
        </div>
    `).join('');

                // Find the tag list container and update it
                const tagListContainer = document.querySelector('.tag-list');
                if (tagListContainer) {
                    tagListContainer.innerHTML = tagListHtml;
                }

                // Update the select to disable already-added tags
                const select = document.getElementById('tagSelect');
                if (select) {
                    const grouped = this.groupTagsByCategory();
                    select.innerHTML = `<option value="">Select tag...</option>` + grouped.map(group => `
            <optgroup label="${group.category}">
                ${group.tags.map(tag => `
                    <option value="${tag.id}" ${s.tags.some(t => t.id == tag.id) ? 'disabled' : ''}>
                        ${tag.name}
                    </option>
                `).join('')}
            </optgroup>
        `).join('');
                }
            }



            removeTag(tagId) {
                this.currentSwatch.tags = this.currentSwatch.tags.filter(t => t.id != tagId);
                this.updateTagDisplay();
            }

            async saveSwatch() {
                if (!this.currentSwatch) return;


                const data = {
                    id: this.currentSwatch.id,
                    name: document.getElementById('name').value,
                    url: document.getElementById('url').value,
                    generated_name: document.getElementById('generated_name').value,
                    category_id: document.getElementById('category_id').value,
                    is_pixelated: document.getElementById('is_pixelated').checked ? 1 : 0,
                    is_active: document.getElementById('is_active').checked ? 1 : 0,
                    frame_count: document.getElementById('frame_count').value,
                    frame_rate: document.getElementById('frame_rate').value,
                    is_variable_framerate: document.getElementById('is_variable_framerate').checked ? 1 : 0,
                    color_value: document.getElementById('color_value').value,
                    hue: document.getElementById('hue').value,
                    sort_order: document.getElementById('sort_order').value,
                    color_codes: this.getColorCodes(),
                    tags: this.currentSwatch.tags.map(t => t.id)
                };



                this.showStatus('Saving...');

                const response = await fetch('includes/api.php?action=update', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    this.showStatus('Saved!', 'success');

                } else {
                    this.showStatus('Error: ' + result.error, 'error');
                }
            }

            getColorCodes() {
                const container = document.getElementById('colorInputs');
                const colors = [];
                for (let child of container.children) {
                    const input = child.querySelector('input[type="text"]');
                    if (input && input.value) {
                        colors.push(input.value.trim());
                    }
                }
                return colors.join(',');
            }

            async deleteSwatch() {
                if (!this.currentSwatch) return;

                if (!confirm('Delete this swatch? This cannot be undone.')) return;

                const formData = new FormData();
                formData.append('id', this.currentSwatch.id);

                await fetch('includes/api.php?action=delete', {
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

                const response = await fetch(`includes/api.php?action=analyze&id=${this.currentSwatch.id}`);
                const analysis = await response.json();

                if (analysis.error) {
                    this.showStatus('Error: ' + analysis.error, 'error');
                    return;
                }

                console.log('Analysis results:', analysis); // DEBUG
                this.analysisResults = analysis;
                this.showAnalyzeModal();
                this.showStatus('Analysis complete!', 'success');
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
                    <div class="analyze-result-value" id="suggestedTagsList">
                        ${availableTags.map(tag => `
                            <div style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: var(--color-bg-tertiary); border-radius: 4px; margin: 2px; font-size: 12px;">
                                <input type="checkbox" id="tag_suggest_${tag.id}" checked style="margin: 0;">
                                <label for="tag_suggest_${tag.id}" style="cursor: pointer;">${tag.name}</label>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        ` : ''}
    `;

                document.getElementById('analyzeResults').innerHTML = resultsHtml;
                document.getElementById('analyzeModal').classList.add('active');
            }

            generateTagsFromColorName(colorName) {
                const words = colorName.toLowerCase().split(/[\s-]+/);
                const tagWords = [
                    // Base colors
                    'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown',
                    'cyan', 'magenta', 'teal', 'lime', 'indigo', 'violet',
                    // Neutrals
                    'white', 'gray', 'grey', 'black', 'beige', 'tan', 'charcoal',
                    // Brightness/value
                    'light', 'dark', 'mid', 'very',
                    // Saturation/tone
                    'bright', 'neon', 'pastel', 'vivid', 'muted', 'desaturated', 'deep',
                    // Temperature
                    'warm', 'cool',
                    // Special
                    'multicolor', 'rainbow'
                ];

                return words.filter(word => tagWords.includes(word));
            }

            removeAnalysisColor(index) {
                const colors = this.analysisResults.color_codes.split(',');
                colors.splice(index, 1);
                this.analysisResults.color_codes = colors.join(',');

                // Re-render the modal
                this.showAnalyzeModal();
            }

            hideAnalyzeModal() {
                document.getElementById('analyzeModal').classList.remove('active');
            }

            applyAnalysis() {
                const analysis = this.analysisResults;

                console.log('=== APPLY ANALYSIS START ===');
                console.log('Current swatch:', this.currentSwatch);
                console.log('Analysis data:', analysis);

                if (document.getElementById('apply_frame_count').checked) {
                    const input = document.getElementById('frame_count');
                    if (input) {
                        input.value = analysis.frame_count || '';
                    }
                }

                if (document.getElementById('apply_frame_rate').checked) {
                    const input = document.getElementById('frame_rate');
                    if (input) {
                        input.value = analysis.frame_rate || '';
                    }
                }

                if (document.getElementById('apply_is_variable_framerate').checked) {
                    const input = document.getElementById('is_variable_framerate');
                    if (input) {
                        input.checked = analysis.is_variable_framerate;
                    }
                }

                if (document.getElementById('apply_color_codes').checked) {
                    const colors = analysis.color_codes ? analysis.color_codes.split(',') : [];
                    const container = document.getElementById('colorInputs');
                    if (container) {
                        container.innerHTML = colors.map((color, i) => this.renderColorInput(color.trim(), i)).join('');
                    }
                }

                if (document.getElementById('apply_color_value').checked) {
                    const input = document.getElementById('color_value');
                    if (input) {
                        input.value = analysis.color_value !== null ? analysis.color_value : '';
                    }
                }

                if (document.getElementById('apply_hue').checked) {
                    const input = document.getElementById('hue');
                    if (input) {
                        input.value = analysis.hue || '';
                    }
                }

                if (document.getElementById('apply_generated_name').checked) {
                    const input = document.getElementById('generated_name');
                    if (input) {
                        input.value = analysis.generated_name || '';
                    }
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

                    // DON'T call renderEditor() - use updateTagDisplay() instead
                    this.updateTagDisplay();
                }

                console.log('=== FINAL INPUT VALUES ===');
                console.log('frame_count:', document.getElementById('frame_count')?.value);
                console.log('generated_name:', document.getElementById('generated_name')?.value);
                console.log('color_value:', document.getElementById('color_value')?.value);

                this.hideAnalyzeModal();
                this.showStatus('Analysis applied!', 'success');
            }

            async exportJSON() {
                this.showStatus('Exporting...');

                const response = await fetch('includes/api.php?action=save_export', {
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
                // Match pattern: images/glitter/{old-category}/{filename}
                const match = currentPath.match(/images\/glitter\/[^\/]+\/(.+)$/);

                if (match) {
                    const filename = match[1];
                    const newPath = `images/glitter/${category}/${filename}`;
                    document.getElementById('newSwatchUrl').value = newPath;
                }
            }

            hideAddModal() {
                document.getElementById('addModal').classList.remove('active');
                document.getElementById('newSwatchName').value = '';
                document.getElementById('newSwatchUrl').value = '';
                document.getElementById('quickCategory').value = '';
            }

            async addSwatch() {
                const name = document.getElementById('newSwatchName').value;
                const url = document.getElementById('newSwatchUrl').value;
                const categorySlug = document.getElementById('quickCategory').value;

                if (!name || !url || !categorySlug) {
                    alert('Please fill in all fields');
                    return;
                }

                // Find category ID from slug
                const category = this.categories.find(c => c.slug === categorySlug);
                if (!category) {
                    alert('Invalid category selected');
                    return;
                }

                const data = {
                    name: name,
                    url: url,
                    category_id: category.id
                };

                const response = await fetch('includes/api.php?action=add', {
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
                    await this.selectSwatch(result.id);
                    this.showStatus('Swatch added!', 'success');
                } else {
                    alert('Error: ' + result.error);
                }
            }

            setupDragAndDrop() {
                let draggedItem = null;
                let scrollInterval = null;
                const sidebar = document.getElementById('swatchList');

                document.addEventListener('dragstart', (e) => {
                    if (e.target.classList.contains('swatch-item')) {
                        draggedItem = e.target;
                        e.target.classList.add('dragging');
                    }
                });

                document.addEventListener('dragend', (e) => {
                    if (e.target.classList.contains('swatch-item')) {
                        e.target.classList.remove('dragging');

                        // Clear scroll interval
                        if (scrollInterval) {
                            clearInterval(scrollInterval);
                            scrollInterval = null;
                        }

                        this.saveOrder();
                    }
                });

                document.addEventListener('dragover', (e) => {
                    e.preventDefault();

                    // Auto-scroll sidebar when dragging near edges
                    if (draggedItem) {
                        const sidebarRect = sidebar.getBoundingClientRect();
                        const mouseY = e.clientY;
                        const scrollThreshold = 50;
                        const scrollSpeed = 10;

                        // Clear existing interval
                        if (scrollInterval) {
                            clearInterval(scrollInterval);
                            scrollInterval = null;
                        }

                        // Scroll up
                        if (mouseY < sidebarRect.top + scrollThreshold) {
                            scrollInterval = setInterval(() => {
                                sidebar.scrollTop -= scrollSpeed;
                            }, 20);
                        }
                        // Scroll down
                        else if (mouseY > sidebarRect.bottom - scrollThreshold) {
                            scrollInterval = setInterval(() => {
                                sidebar.scrollTop += scrollSpeed;
                            }, 20);
                        }
                    }

                    const target = e.target.closest('.swatch-item');
                    if (target && draggedItem && target !== draggedItem) {
                        const container = target.parentElement;
                        const items = [...container.querySelectorAll('.swatch-item')];
                        const dragIndex = items.indexOf(draggedItem);
                        const targetIndex = items.indexOf(target);

                        if (dragIndex < targetIndex) {
                            target.after(draggedItem);
                        } else {
                            target.before(draggedItem);
                        }
                    }
                });
            }

            async saveOrder() {
                const items = document.querySelectorAll('.swatch-item');
                const order = Array.from(items).map(item => item.dataset.id);

                const response = await fetch('includes/api.php?action=reorder', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        order
                    })
                });

                const result = await response.json();
                console.log('Reorder response:', result);

                if (result.success) {
                    this.showStatus('Order saved', 'success');

                    // Reload swatches
                    await this.loadSwatches();
                    await this.selectSwatch(this.currentSwatch.id);

                } else {
                    this.showStatus('Error saving order: ' + (result.error || 'Unknown error'), 'error');
                }
            }

            showManageCategoriesModal() {
                this.renderCategoryList();
                document.getElementById('manageCategoriesModal').classList.add('active');
            }

            hideManageCategoriesModal() {
                document.getElementById('manageCategoriesModal').classList.remove('active');
            }

            async renderCategoryList() {
                await this.loadCategories();

                const html = this.categories.map(cat => `
                    <div class="management-item">
                        <div class="management-item-info">
                            <div class="management-item-name">${cat.name}</div>
                            <div class="management-item-meta">Slug: ${cat.slug} | Sort: ${cat.sort_order}</div>
                        </div>
                        <button class="management-item-delete" onclick="app.deleteCategory(${cat.id}, '${cat.name}')">Delete</button>
                    </div>
                `).join('');

                document.getElementById('categoryList').innerHTML = html;
            }

            async addCategory() {
                const name = document.getElementById('newCategoryName').value;
                const slug = document.getElementById('newCategorySlug').value;
                const description = document.getElementById('newCategoryDescription').value;

                if (!name || !slug) {
                    alert('Name and slug are required');
                    return;
                }

                const data = {
                    name,
                    slug,
                    description
                };

                const response = await fetch('includes/api.php?action=add_category', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    document.getElementById('newCategoryName').value = '';
                    document.getElementById('newCategorySlug').value = '';
                    document.getElementById('newCategoryDescription').value = '';
                    await this.renderCategoryList();
                    this.showStatus('Category added!', 'success');
                } else {
                    alert('Error: ' + result.error);
                }
            }

            async deleteCategory(id, name) {
                if (!confirm(`Delete category "${name}"? This will fail if any swatches use it.`)) return;

                const formData = new FormData();
                formData.append('id', id);

                const response = await fetch('includes/api.php?action=delete_category', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    await this.renderCategoryList();
                    this.showStatus('Category deleted!', 'success');
                } else {
                    alert(result.error);
                }
            }

            showManageTagsModal() {
                this.renderTagList();

                // Populate tag category dropdown
                const select = document.getElementById('newTagCategory');

                fetch('includes/api.php?action=tag_categories')
                    .then(r => r.json())
                    .then(categories => {
                        select.innerHTML = categories
                            .map(cat => `<option value="${cat.id}">${cat.name}</option>`)
                            .join('');
                    });

                document.getElementById('manageTagsModal').classList.add('active');
            }

            hideManageTagsModal() {
                document.getElementById('manageTagsModal').classList.remove('active');
            }

            async renderTagList() {
                await this.loadTags();

                const grouped = this.groupTagsByCategory();

                const html = grouped.map(group => `
                    <div style="margin-bottom: 16px;">
                        <h5 style="font-size: 12px; color: var(--color-text-secondary); text-transform: uppercase; margin-bottom: 8px;">
                            ${group.category}
                        </h5>
                        ${group.tags.map(tag => `
                            <div class="management-item">
                                <div class="management-item-info">
                                    <div class="management-item-name">
                                        ${tag.hex_color ? `<span class="tag-color" style="background: ${tag.hex_color}; display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; border: 1px solid var(--color-border);"></span>` : ''}
                                        ${tag.name}
                                    </div>
                                    <div class="management-item-meta">Slug: ${tag.slug}</div>
                                </div>
                                <button class="management-item-delete" onclick="app.deleteTag(${tag.id}, '${tag.name}')">Delete</button>
                            </div>
                        `).join('')}
                    </div>
                `).join('');

                document.getElementById('tagList').innerHTML = html;
            }

            async addNewTag() {
                const name = document.getElementById('newTagName').value;
                const tagCategoryId = document.getElementById('newTagCategory').value;
                const hexColor = document.getElementById('newTagHexColor').value;

                if (!name || !tagCategoryId) {
                    alert('Name and category are required');
                    return;
                }

                const data = {
                    name,
                    tag_category_id: tagCategoryId,
                    hex_color: hexColor
                };

                const response = await fetch('includes/api.php?action=add_tag', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    document.getElementById('newTagName').value = '';
                    document.getElementById('newTagHexColor').value = '';
                    await this.renderTagList();
                    await this.loadTags(); // Refresh for the main editor
                    this.showStatus('Tag added!', 'success');
                } else {
                    alert('Error: ' + result.error);
                }
            }

            async deleteTag(id, name) {
                if (!confirm(`Delete tag "${name}"? This will remove it from all swatches that use it.`)) return;

                const formData = new FormData();
                formData.append('id', id);

                const response = await fetch('includes/api.php?action=delete_tag', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    await this.renderTagList();
                    await this.loadTags(); // Refresh for the main editor

                    const msg = result.removed_from > 0 ?
                        `Tag deleted! Removed from ${result.removed_from} swatch(es).` :
                        'Tag deleted!';
                    this.showStatus(msg, 'success');
                } else {
                    alert('Error: ' + result.error);
                }
            }

            showStatus(message, type = 'info') {
                const status = document.getElementById('statusMessage');
                status.textContent = message;

                setTimeout(() => {
                    status.textContent = 'Ready';
                }, 3000);
            }
        }

        const app = new SwatchEditor();