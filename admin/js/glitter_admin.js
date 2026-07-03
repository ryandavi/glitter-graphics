// ============================================
// GLITTER EDITOR CLASS
// Extends AssetEditor for glitter-specific functionality
// ============================================
var adminFetch = window.adminFetch || ((...args) => AdminAPI.fetch(...args));
window.adminFetch = adminFetch;

class GlitterEditor extends AssetEditor {
    constructor() {
        super({
            assetType: 'glitter',
            assetLabel: 'Glitter',
            assetLabelPlural: 'Glitter',
            enableSorting: true,
            showRecentSection: false,
            listContainerId: 'swatchList',
            categoryIdField: 'glitter_category_id',
            tagModalId: 'tagModal'
        });

        this.analysisResults = null;
    }

    renderAssetList() {
        const container = document.getElementById(this.config.listContainerId);
        let html = '';
        let currentCategory = '';
        let currentCategoryAssets = [];

        this.assets.forEach((asset) => {
            if (asset.category_name !== currentCategory) {
                if (currentCategoryAssets.length > 0) {
                    html += this.renderAssetGroup(currentCategory, currentCategoryAssets);
                }

                currentCategory = asset.category_name;
                currentCategoryAssets = [];
            }

            currentCategoryAssets.push(asset);
        });

        if (currentCategoryAssets.length > 0) {
            html += this.renderAssetGroup(currentCategory, currentCategoryAssets);
        }

        container.innerHTML = html;

        if (this.scrollPosition !== undefined) {
            container.scrollTop = this.scrollPosition;
        }
    }

    renderAssetGroup(label, assets) {
        const categorySlug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-');

        return `
            <details class="category-group" id="category-${categorySlug}" open>
                <summary class="category-label">${label}</summary>
                <div class="category-items">
                    ${assets.map((asset) => this.renderAssetListItem(asset)).join('')}
                </div>
            </details>
        `;
    }

    renderAssetListItem(asset) {
        const active = this.currentAsset && this.currentAsset.id === asset.id ? 'active' : '';

        return `
            <div class="swatch-item ${active}"
                 data-id="${asset.id}"
                 draggable="true"
                 onclick="app.selectAsset(${asset.id})">
                <span class="drag-handle">::</span>
                ${this.renderAssetThumbnail(asset)}
                <span class="swatch-name">${asset.name}</span>
            </div>
        `;
    }

    renderEditor() {
        document.getElementById('emptyState').style.display = 'none';
        const editor = document.getElementById('editorContent');
        editor.style.display = 'block';

        const s = this.currentAsset;
        const colors = s.color_codes ? s.color_codes.split(',') : [];

        editor.innerHTML = `
            <h1>${s.name}</h1>

            <button class="analyze-btn" onclick="app.analyzeCurrentAsset()">
                Auto-Analyze Glitter
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
                            ${this.categories.map((cat) =>
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
                        ${colors.map((color, index) => this.renderColorInput(color.trim(), index)).join('')}
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
                <button class="color-remove-btn" onclick="app.removeColorInput(${index})">x</button>
            </div>
        `;
    }

    syncColorInputs(index) {
        const wrapper = document.querySelectorAll('.color-input-wrapper')[index];
        if (!wrapper) {
            return;
        }

        const colorPicker = wrapper.querySelector('input[type="color"]');
        const textInput = wrapper.querySelector('input[type="text"]');
        if (!colorPicker || !textInput) {
            return;
        }

        if (document.activeElement === colorPicker) {
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
        const row = container.children[index];
        if (!row) {
            return;
        }

        row.remove();
    }

    getAssetDataFromForm() {
        const colorInputs = document.querySelectorAll('#colorInputs input[type="text"]');
        const colorCodes = Array.from(colorInputs)
            .map((input) => input.value.trim())
            .filter(Boolean)
            .join(',');

        return {
            id: this.currentAsset.id,
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
            tags: this.currentAsset.tags.map((tag) => tag.id)
        };
    }

    async analyzeCurrentAsset() {
        if (!this.currentAsset) {
            return;
        }

        this.showStatus('Analyzing glitter...');

        try {
            const response = await adminFetch(`includes/api.php?action=analyze&id=${this.currentAsset.id}&type=glitter`);
            const analysis = await response.json();

            if (analysis.error) {
                alert('Analysis failed: ' + analysis.error);
                this.showStatus('Analysis failed', 'error');
                return;
            }

            this.showAnalyzeModal(analysis);
        } catch (error) {
            alert('Analysis error: ' + error.message);
            this.showStatus('Analysis error', 'error');
        }
    }

    async analyzeBulk() {
        if (!confirm('This will analyze ALL glitter assets and update their technical properties. This may take several minutes. Continue?')) {
            return;
        }

        this.showStatus('Starting bulk analysis...');

        try {
            const response = await adminFetch('includes/api.php?action=analyze_all&type=glitter', {
                method: 'POST'
            });

            const result = await response.json();

            if (result.success) {
                this.showStatus(`Bulk analysis complete! Updated ${result.updated} glitter assets.`, 'success');
                await this.loadAssets();
                if (this.currentAsset) {
                    await this.selectAsset(this.currentAsset.id);
                }
            } else {
                this.showStatus('Error: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            this.showStatus('Error: ' + error.message, 'error');
        }
    }

    showAnalyzeModal(analysis) {
        const modal = document.getElementById('analyzeModal');
        const resultsDiv = document.getElementById('analyzeResults');
        const colors = analysis.color_codes ? analysis.color_codes.split(',') : [];
        const suggestedTags = this.generateTagsFromColorName(analysis.generated_name || '');
        const currentTagIds = this.currentAsset.tags.map((tag) => tag.id);
        const availableTags = this.tags.filter((tag) =>
            suggestedTags.includes(tag.name.toLowerCase()) &&
            !currentTagIds.includes(tag.id)
        );

        resultsDiv.innerHTML = `
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
                            ${colors.map((color, index) => `
                                <div class="analyze-colors-preview-swatch">
                                    <div class="analyze-color-box" style="background: ${color};"></div>
                                    <span style="font-size: 11px; color: var(--color-text-secondary);">${color}</span>
                                    <button onclick="app.removeAnalysisColor(${index})" style="padding: 2px 6px; font-size: 11px; background: var(--color-danger); color: white; border: none; border-radius: 3px; cursor: pointer;">x</button>
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
                            ${availableTags.map((tag) => `
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

        this.analysisResults = analysis;
        modal.classList.add('active');
    }

    hideAnalyzeModal() {
        document.getElementById('analyzeModal').classList.remove('active');
    }

    applyAnalysis() {
        const analysis = this.analysisResults;
        if (!analysis) {
            return;
        }

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
            document.getElementById('is_variable_framerate').checked = !!analysis.is_variable_framerate;
        }

        if (document.getElementById('apply_is_animated').checked) {
            document.getElementById('is_animated').checked = !!analysis.is_animated;
        }

        if (document.getElementById('apply_has_transparency').checked) {
            document.getElementById('has_transparency').checked = !!analysis.has_transparency;
        }

        if (document.getElementById('apply_color_codes').checked) {
            const colors = analysis.color_codes ? analysis.color_codes.split(',') : [];
            document.getElementById('colorInputs').innerHTML = colors
                .map((color, index) => this.renderColorInput(color.trim(), index))
                .join('');
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

        const applyTagsCheckbox = document.getElementById('apply_suggested_tags');
        if (applyTagsCheckbox && applyTagsCheckbox.checked) {
            const tagCheckboxes = document.querySelectorAll('[id^="tag_suggest_"]:checked');
            tagCheckboxes.forEach((checkbox) => {
                const tagId = parseInt(checkbox.id.replace('tag_suggest_', ''));
                const tag = this.tags.find((item) => item.id == tagId);

                if (tag && !this.currentAsset.tags.find((item) => item.id == tagId)) {
                    this.currentAsset.tags.push(tag);
                }
            });

            this.updateTagDisplay();
        }

        this.hideAnalyzeModal();
        this.showStatus('Analysis applied!', 'success');
    }

    removeAnalysisColor(index) {
        if (!this.analysisResults || !this.analysisResults.color_codes) {
            return;
        }

        const colors = this.analysisResults.color_codes.split(',');
        colors.splice(index, 1);
        this.analysisResults.color_codes = colors.join(',');
        this.showAnalyzeModal(this.analysisResults);
    }

    generateTagsFromColorName(colorName) {
        if (!colorName) {
            return [];
        }

        const words = colorName.toLowerCase().split(/[\s-_]+/);
        return words.filter((word) => word.length > 3);
    }

    setupDragAndDrop() {
        const container = document.getElementById(this.config.listContainerId);
        let draggedElement = null;

        container.addEventListener('dragstart', (event) => {
            const item = event.target.closest('.swatch-item');
            if (!item) {
                return;
            }

            draggedElement = item;
            item.classList.add('dragging');
        });

        container.addEventListener('dragend', (event) => {
            const item = event.target.closest('.swatch-item');
            if (!item) {
                return;
            }

            item.classList.remove('dragging');
            draggedElement = null;
            this.saveOrder();
        });

        container.addEventListener('dragover', (event) => {
            event.preventDefault();
            if (!draggedElement) {
                return;
            }

            const afterElement = this.getDragAfterElement(container, event.clientY);
            if (afterElement == null) {
                const categoryContainer = draggedElement.closest('.category-items');
                if (categoryContainer) {
                    categoryContainer.appendChild(draggedElement);
                }
                return;
            }

            afterElement.parentNode.insertBefore(draggedElement, afterElement);
        });
    }

    async saveOrder() {
        const items = document.querySelectorAll(`#${this.config.listContainerId} .category-items .swatch-item`);
        const order = Array.from(items).map((item) => parseInt(item.dataset.id));
        if (!order.length) {
            return;
        }

        const response = await adminFetch('includes/api.php?action=reorder&type=glitter', {
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
}

const app = new GlitterEditor();
