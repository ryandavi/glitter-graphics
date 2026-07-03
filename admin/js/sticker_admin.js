// ============================================
// STICKER EDITOR CLASS
// Extends AssetEditor for sticker-specific functionality
// ============================================
var adminFetch = window.adminFetch || ((...args) => AdminAPI.fetch(...args));
window.adminFetch = adminFetch;

class StickerEditor extends AssetEditor {
    constructor() {
        // Configure sticker-specific settings
        const config = {
            assetType: 'sticker',
            assetLabel: 'Sticker',
            assetLabelPlural: 'Stickers',
            enableSorting: false,  // Can be enabled in future
            enableAnalyze: true,   // Auto-detect dimensions/animation
            listContainerId: 'stickerList',
            categoryIdField: 'sticker_category_id',
            tagModalId: 'tagModal'
        };

        super(config);
    }

    // ===== ASSET-SPECIFIC RENDERING =====

    renderEditor() {
        document.getElementById('emptyState').style.display = 'none';
        const editor = document.getElementById('editorContent');
        editor.style.display = 'block';

        const s = this.currentAsset;

        editor.innerHTML = `
            <h1>${s.name}</h1>
            
            <button class="analyze-btn" onclick="app.analyzeCurrentSticker()">
                🔍 Auto-Analyze Sticker
            </button>
            
            <div class="form-section">
                <h3 class="form-section-title">Basic Info</h3>
                
                <div class="form-row">
                    <div class="form-group">
                        <label>Name</label>
                        <input type="text" id="name" value="${s.name || ''}">
                    </div>
                    <div class="form-group">
                        <label>Filename</label>
                        <input type="text" id="filename" value="${s.filename || ''}">
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
                                `<option value="${cat.id}" ${cat.id == s.sticker_category_id ? 'selected' : ''}>${cat.name}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>&nbsp;</label>
                        <div class="checkbox-group">
                            <input type="checkbox" id="is_active" ${s.is_active === '1'  ? 'checked' : ''}>
                            <label for="is_active">Active</label>
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Attribution (optional)</label>
                    <input type="text" id="attribution" value="${s.attribution || ''}" placeholder="Artist name or source">
                </div>

                <div class="form-group">
                    <label>Sticker Text (optional)</label>
                    <input type="text" id="sticker_text" value="${s.sticker_text || ''}" placeholder="Text present in the sticker" maxlength="255">
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
                        <input type="number" id="frame_count" value="${s.frame_count || 1}" min="1">
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
                            <input type="checkbox" id="is_animated" ${s.is_animated === '1'  ? 'checked' : ''}>
                            <label for="is_animated">Animated</label>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>&nbsp;</label>
                        <div class="checkbox-group">
                            <input type="checkbox" id="has_transparency" ${s.has_transparency === '1'  ? 'checked' : ''}>
                            <label for="has_transparency">Has Transparency</label>
                        </div>
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

    // ===== GET FORM DATA =====

    getAssetDataFromForm() {
        return {
            id: this.currentAsset.id,
            name: document.getElementById('name').value,
            filename: document.getElementById('filename').value,
            url: document.getElementById('url').value,
            sticker_category_id: parseInt(document.getElementById('category_id').value),
            attribution: document.getElementById('attribution').value || null,
            sticker_text: document.getElementById('sticker_text').value || null,
            width: parseInt(document.getElementById('width').value) || 0,
            height: parseInt(document.getElementById('height').value) || 0,
            file_size: parseInt(document.getElementById('file_size').value) || 0,
            frame_count: parseInt(document.getElementById('frame_count').value) || 1,
            frame_rate: parseInt(document.getElementById('frame_rate').value) || 10,
            is_variable_framerate: document.getElementById('is_variable_framerate').checked ? 1 : 0,
            is_animated: document.getElementById('is_animated').checked ? 1 : 0,
            has_transparency: document.getElementById('has_transparency').checked ? 1 : 0,
            is_active: document.getElementById('is_active').checked ? 1 : 0,
            tags: this.currentAsset.tags.map(t => t.id)
        };
    }

    // ===== ANALYZE STICKER =====

    async analyzeCurrentSticker() {
        if (!this.currentAsset) return;

        this.showStatus('Analyzing sticker...');

        try {
            const response = await adminFetch(`includes/api.php?action=analyze&id=${this.currentAsset.id}&type=sticker`);
            const analysis = await response.json();

            if (analysis.error) {
                alert('Analysis failed: ' + analysis.error);
                this.showStatus('Analysis failed', 'error');
                return;
            }

            // Show modal with results
            this.showAnalyzeModal(analysis);

        } catch (error) {
            alert('Analysis error: ' + error.message);
            this.showStatus('Analysis error', 'error');
        }
    }

    async analyzeBulk() {
        if (!confirm('This will analyze ALL sticker assets and update their technical properties. This may take several minutes. Continue?')) {
            return;
        }

        this.showStatus('Starting bulk analysis...');

        try {
            const response = await adminFetch('includes/api.php?action=analyze_all&type=sticker', {
                method: 'POST'
            });

            const result = await response.json();

            if (result.success) {
                this.showStatus(`Bulk analysis complete! Updated ${result.updated} sticker assets.`, 'success');
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

    async showAnalyzeModal(analysis) {
        const modal = document.getElementById('analyzeModal');
        const resultsDiv = document.getElementById('analyzeResults');

        const fields = [
            { key: 'width', label: 'Width (px)', value: analysis.width || 'N/A' },
            { key: 'height', label: 'Height (px)', value: analysis.height || 'N/A' },
            { key: 'file_size', label: 'File Size (bytes)', value: analysis.file_size || 'N/A' },
            { key: 'frame_count', label: 'Frame Count', value: analysis.frame_count || 1 },
            { key: 'frame_rate', label: 'Frame Rate (centiseconds)', value: analysis.frame_rate !== null && analysis.frame_rate !== undefined ? analysis.frame_rate : 'N/A' },
            { key: 'is_variable_framerate', label: 'Variable Frame Rate', value: analysis.is_variable_framerate ? 'Yes' : 'No' },
            { key: 'is_animated', label: 'Animated', value: analysis.is_animated ? 'Yes' : 'No' },
            { key: 'has_transparency', label: 'Has Transparency', value: analysis.has_transparency ? 'Yes' : 'No' }
        ];

        resultsDiv.innerHTML = fields.map(field => `
            <div class="analyze-result-item">
                <input type="checkbox" id="apply_${field.key}" checked>
                <div class="analyze-result-content">
                    <div class="analyze-result-label">${field.label}</div>
                    <div class="analyze-result-value">${field.value}</div>
                </div>
            </div>
        `).join('');

        this.analysisResults = analysis;
        modal.classList.add('active');
    }

    hideAnalyzeModal() {
        document.getElementById('analyzeModal').classList.remove('active');
    }

    applyAnalysis() {
        const analysis = this.analysisResults;

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
            document.getElementById('frame_count').value = analysis.frame_count || 1;
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

        this.hideAnalyzeModal();
        this.showStatus('Analysis applied!', 'success');
    }
}

// Initialize
const app = new StickerEditor();
