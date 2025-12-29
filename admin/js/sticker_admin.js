// ============================================
// STICKER EDITOR CLASS
// Extends AssetEditor for sticker-specific functionality
// ============================================
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
            categoryIdField: 'sticker_category_id'
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
                            <input type="checkbox" id="is_active" ${s.is_active ? 'checked' : ''}>
                            <label for="is_active">Active</label>
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Attribution (optional)</label>
                    <input type="text" id="attribution" value="${s.attribution || ''}" placeholder="Artist name or source">
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
                        <label>&nbsp;</label>
                        <div class="checkbox-group">
                            <input type="checkbox" id="is_animated" ${s.is_animated ? 'checked' : ''}>
                            <label for="is_animated">Animated</label>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>&nbsp;</label>
                        <div class="checkbox-group">
                            <input type="checkbox" id="has_transparency" ${s.has_transparency ? 'checked' : ''}>
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
        sticker_category_id: parseInt(document.getElementById('category_id').value), // Must be sticker_category_id
        attribution: document.getElementById('attribution').value || null,
        width: parseInt(document.getElementById('width').value) || 0,
        height: parseInt(document.getElementById('height').value) || 0,
        file_size: parseInt(document.getElementById('file_size').value) || 0,
        frame_count: parseInt(document.getElementById('frame_count').value) || 1,
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
        const response = await fetch(`includes/api.php?action=analyze&id=${this.currentAsset.id}&type=sticker`);
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

async showAnalyzeModal(analysis) {
    const modal = document.getElementById('analyzeModal');
    const resultsDiv = document.getElementById('analyzeResults');

    // Get actual image dimensions and file size from the file
    const imagePath = CONFIG.image_base_path + this.currentAsset.url;
    const imageData = await this.getImageData(imagePath, analysis.frame_count);

    // Merge analysis with image data
    const fullAnalysis = {
        ...analysis,
        ...imageData
    };

    const fields = [
        { key: 'width', label: 'Width (px)', value: fullAnalysis.width || 'N/A' },
        { key: 'height', label: 'Height (px)', value: fullAnalysis.height || 'N/A' },
        { key: 'frame_count', label: 'Frame Count', value: fullAnalysis.frame_count || 1 },
        { key: 'file_size', label: 'File Size (bytes)', value: fullAnalysis.file_size || 'N/A' },
        { key: 'is_animated', label: 'Animated', value: fullAnalysis.is_animated ? 'Yes' : 'No' },
        { key: 'has_transparency', label: 'Has Transparency', value: fullAnalysis.has_transparency ? 'Yes' : 'No' }
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

    this.pendingAnalysis = fullAnalysis;
    modal.classList.add('active');
}

    // Helper to get image dimensions and file size
async getImageData(imagePath, frameCount) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            // Create canvas to check transparency
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            
            // Check for transparency
            let hasTransparency = false;
            try {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                
                // Check alpha channel
                for (let i = 3; i < data.length; i += 4) {
                    if (data[i] < 255) {
                        hasTransparency = true;
                        break;
                    }
                }
            } catch (e) {
                console.warn('Could not check transparency:', e);
                hasTransparency = false;
            }
            
            // Fetch file size
            fetch(imagePath)
                .then(response => response.blob())
                .then(blob => {
                    resolve({
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        file_size: blob.size,
                        is_animated: frameCount > 1,
                        has_transparency: hasTransparency
                    });
                })
                .catch(() => {
                    resolve({
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        file_size: null,
                        is_animated: frameCount > 1,
                        has_transparency: hasTransparency
                    });
                });
        };
        
        img.onerror = () => {
            resolve({
                width: null,
                height: null,
                file_size: null,
                is_animated: false,
                has_transparency: false
            });
        };
        
        img.src = imagePath;
    });
}

    hideAnalyzeModal() {
        document.getElementById('analyzeModal').classList.remove('active');
        this.pendingAnalysis = null;
    }

    applyAnalysis() {
        if (!this.pendingAnalysis) return;

        const checkboxes = document.querySelectorAll('#analyzeResults input[type="checkbox"]:checked');
        const selectedFields = Array.from(checkboxes).map(cb => cb.value);

        selectedFields.forEach(field => {
            const input = document.getElementById(field);
            if (input) {
                if (input.type === 'checkbox') {
                    input.checked = this.pendingAnalysis[field];
                } else {
                    input.value = this.pendingAnalysis[field];
                }
            }
        });

        this.hideAnalyzeModal();
        this.showStatus('Analysis applied!', 'success');
    }
}

// Initialize the editor
const app = new StickerEditor();