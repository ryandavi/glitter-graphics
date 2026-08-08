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
            showRecentSection: true,
            tagModalId: 'tagModal',
            ...config
        };

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

        this.bindHistoryNavigation();
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
			const stamp = recent ? this.assetTouchedAt(asset) : null;
			return `<div class="swatch-item ${active}" data-id="${asset.id}" ${recent ? 'data-recent="true"' : ''} ${draggable}
				tabindex="0" onclick="app.selectAsset(${asset.id})">
				${this.config.enableSorting && !recent ? '<span class="drag-handle">⋮⋮</span>' : ''}
				${this.renderAssetThumbnail(asset)}
				<span class="swatch-name">${this.escapeHtml(asset.name)}</span>
				${stamp ? `<time class="swatch-meta" datetime="${this.escapeHtml(new Date(stamp).toISOString())}"
					title="${this.escapeHtml(new Date(stamp).toLocaleString())}">${this.escapeHtml(this.relativeTime(stamp))}</time>` : ''}
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
			// One list for both "I just added this" and "I just edited this" —
			// an addition is the most recent touch a record can have, so a
			// last-touched ordering surfaces it without a second section.
			const recent = assets.filter(asset => Number(asset.is_active))
				.sort((a, b) => this.assetTouchedAt(b) - this.assetTouchedAt(a))
				.slice(0, CONFIG.admin_recent_limit);
			if (recent.length) {
				const key = `${this.config.assetType}:__recent`;
				const isOpen = localStorage.getItem(`adminCategory:${key}`) !== 'closed';
				html += `<details class="category-group recent-group" data-state-key="${this.escapeHtml(key)}" ${isOpen ? 'open' : ''}>
					<summary class="category-label">Recent <span class="count-badge">${recent.length}</span></summary>
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

	// Last human touch. updated_at is only written by edits and approvals —
	// analysis writes analyzed_at — so a Bulk Analyze does not reshuffle this.
	// Rows predating the column fall back to when they were added.
	assetTouchedAt(asset) {
		const stamp = asset.updated_at || asset.created_at;
		const parsed = stamp ? Date.parse(String(stamp).replace(' ', 'T')) : NaN;
		return Number.isNaN(parsed) ? 0 : parsed;
	}

	// Coarse on purpose: the list is ordered, so the label only has to say
	// "how long ago" well enough to spot today's work.
	relativeTime(timestamp) {
		const minutes = Math.round((Date.now() - timestamp) / 60000);
		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes}m`;
		if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
		if (minutes < 60 * 24 * 7) return `${Math.round(minutes / (60 * 24))}d`;
		return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

    // Mirrors the editor: an asset flagged pixelated upscales crisp, anything
    // else gets the browser's smoothing, so admin previews show the rendering
    // the canvas will actually use. Asset types without the column (shapes,
    // fonts) and records predating it keep the crisp default.
    renderingClass(asset) {
        return Number(asset?.is_pixelated ?? 1) ? '' : ' rendering-smooth';
    }

    // Override in child class for custom thumbnail rendering
    renderAssetThumbnail(asset) {
        return `<div class="swatch-thumb${this.renderingClass(asset)}" style="background-image: url('${CONFIG.image_base_path}${asset.url}');"></div>`;
    }

    // ===== URL STATE =====
    // Selecting an asset is a navigation, so it gets a history entry: refresh
    // reopens the same asset and Back returns to the previous one. Modals are
    // deliberately excluded — a dialog is not a destination, and putting one
    // in history makes Back close a dialog instead of undoing navigation.
    pushAssetUrl(id) {
        const url = new URL(window.location.href);
        if (String(url.searchParams.get('asset')) === String(id)) return;
        url.searchParams.delete('ingest');
        url.searchParams.set('asset', id);
        window.history.pushState({ assetId: Number(id) }, '', url);
    }

    bindHistoryNavigation() {
        window.addEventListener('popstate', async event => {
            const assetId = Number(event.state?.assetId ?? new URLSearchParams(window.location.search).get('asset'));
            if (!assetId || !this.assets.some(asset => Number(asset.id) === assetId)) return;
            if (Number(this.currentAsset?.id) === assetId) return;
            await this.selectAsset(assetId, { pushHistory: false });
        });
    }

    // ===== ASSET SELECTION & EDITING =====

    async selectAsset(id, { pushHistory = true } = {}) {
        if (this.dirty && !confirm('Discard unsaved changes?')) return;
        // Save scroll position
        this.scrollPosition = document.getElementById(this.config.listContainerId).scrollTop;

        if (pushHistory) this.pushAssetUrl(id);
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
        this.loadStoredAnalysis();

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
        // Sections are named for what the user is trying to answer, not for
        // which table the columns live in. Order is declared here, not
        // inferred from FIELDS declaration order.
        const sectionLabels = { basic: 'Identity', organization: 'Organization', color: 'Color', tech: 'File & animation', publishing: 'Publishing' };
        const ordered = Object.keys(sectionLabels).filter(key => sections.has(key))
            .concat([...sections.keys()].filter(key => !(key in sectionLabels)));
        editor.innerHTML = `<div class="editor-title-row">
                <h1>${this.escapeHtml(this.currentAsset.name)}</h1>
                <button class="btn btn-secondary btn-sm" type="button" onclick="app.analyzeCurrentAsset()">Auto-Analyze</button>
            </div>
            ${ordered.map(section => `<details class="admin-section" open>
                <summary class="admin-section-title">${sectionLabels[section] || section}</summary>
                <div class="property-list">${this.renderFieldGroups(sections.get(section)).join('')}</div>
            </details>`).join('')}
            <details class="admin-section" open>
                <summary class="admin-section-title">Tags</summary>
                <div class="tag-section"><div class="tag-list" id="tagList"></div>
                    <input type="search" id="tagSearch" placeholder="Search tag names and aliases" oninput="app.updateTagDisplay()">
                    <select id="tagSelect" onchange="app.addTag(); this.value='';"></select>
                    <div id="tagSearchHint" class="tag-search-hint"></div>
                </div>
            </details>`;
        this.updateTagDisplay();
    }

    // Renders one row per field, except fields sharing a `group` key
    // (e.g. width/height), which combine into a single compact row.
    renderFieldGroups(fields) {
        const rendered = [];
        const seen = new Set();
        for (const field of fields) {
            if (seen.has(field.key)) continue;
            if (field.group) {
                const groupFields = fields.filter(candidate => candidate.group === field.group);
                groupFields.forEach(candidate => seen.add(candidate.key));
                rendered.push(this.renderFieldGroupRow(groupFields));
            } else {
                seen.add(field.key);
                rendered.push(this.renderField(field));
            }
        }
        return rendered;
    }

    renderFieldGroupRow(fields) {
        const inputs = fields.map((field, index) =>
            `${index > 0 ? '<span class="property-pair-sep">×</span>' : ''}<input type="number" id="${field.key}" value="${this.escapeHtml(this.currentAsset[field.key] ?? '')}" aria-label="${this.escapeHtml(field.label)}">`).join('');
        return `<div class="property-row">
            <span class="property-label">${this.escapeHtml(fields[0].groupLabel || fields[0].label)}</span>
            <div class="property-control property-control-pair">${inputs}</div>
        </div>`;
    }

    renderField(field) {
        const html = this.renderFieldControl(field);
        if (!field.hint) return html;
        return html + this.propertyRow(field.label, `<small class="property-hint">${this.escapeHtml(field.hint)}</small>`, { continued: true });
    }

    renderFieldControl(field) {
        const value = this.currentAsset[field.key];
        if (field.input === 'checkbox') {
            return this.propertyRow(field.label, `<input type="checkbox" class="field-switch" id="${field.key}" ${Number(value) ? 'checked' : ''}>`, { htmlFor: field.key });
        }
        if (field.input === 'select') {
            const options = this.categories.filter(category => category.id)
                .map(category => `<option value="${category.id}" ${Number(category.id) === Number(value) ? 'selected' : ''}>${this.escapeHtml(category.name)}</option>`).join('');
            return this.propertyRow(field.label, `<select id="${field.key}">${options}</select>`, { htmlFor: field.key });
        }
        if (field.input === 'textarea') {
            return this.propertyRow(field.label, `<textarea id="${field.key}" rows="3">${this.escapeHtml(value ?? '')}</textarea>`, { htmlFor: field.key, tall: true });
        }
        // Observation hosts, filled by loadStoredAnalysis() on selection.
        if (field.input === 'analysis') {
            return `<div id="storedAnalysis" class="stored-analysis"></div>`;
        }
        if (field.input === 'analysisMeta') {
            return `<div id="analysisProvenance" class="stored-analysis"></div>`;
        }
        // Auto reports what the classifier makes of the palette as it stands,
        // so it moves when colors are edited; picking a type pins it.
        if (field.input === 'paletteType') {
            const auto = this.currentAsset.palette_type_auto;
            const options = [`<option value="">${auto ? `Auto — ${this.paletteTypeLabel(auto)}` : 'Auto'}</option>`]
                .concat((CONFIG.palette_types || []).map(type =>
                    `<option value="${type}" ${type === value ? 'selected' : ''}>${this.escapeHtml(this.paletteTypeLabel(type))}</option>`));
            return this.propertyRow(field.label, `<select id="${field.key}">${options.join('')}</select>`, { htmlFor: field.key });
        }
        // Renaming moves the file on disk, so it applies on its own button
        // rather than with the form's Save — the URL row below then reflects
        // where the file actually is.
        if (field.input === 'rename') {
            const url = String(this.currentAsset.url || '');
            const base = url.slice(url.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
            const extension = url.slice(url.lastIndexOf('.'));
            return this.propertyRow(field.label, `<div class="rename-control">
                <input type="text" id="renameBase" value="${this.escapeHtml(base)}" spellcheck="false" aria-label="File name without extension">
                <span class="rename-extension">${this.escapeHtml(extension)}</span>
                <button class="btn btn-quiet btn-sm" type="button" onclick="app.fillRenameFromName()">Use display name</button>
                <button class="btn btn-secondary btn-sm" type="button" onclick="app.renameAssetFile()">Rename</button>
            </div>`, { htmlFor: 'renameBase', tall: true });
        }
        if (field.input === 'colors') {
            const colors = value ? String(value).split(',') : [];
            const weights = this.currentAsset.color_weights ? String(this.currentAsset.color_weights).split(',') : [];
            return this.propertyRow(field.label, `<div class="color-inputs" id="colorInputs">${colors.map((color, index) => this.renderColorField(color, weights[index])).join('')}</div>
                <button class="btn btn-quiet btn-sm" type="button" onclick="app.addColorInput()">+ Add color</button>`, { tall: true });
        }
        const inputType = field.input === 'number' ? 'number' : 'text';
        const input = `<input type="${inputType}" id="${field.key}" value="${this.escapeHtml(value ?? '')}" ${field.step ? `step="${field.step}"` : ''}>`;
        const row = this.propertyRow(field.label, input, { htmlFor: field.key });
        // The URL field keeps its input inline like every other row; the
        // preview follows as a continuation row under the same control column.
        if (field.key === 'url' && value) {
            return row + this.propertyRow(field.label, `<img src="${CONFIG.image_base_path}${this.escapeHtml(value)}" class="preview-image${this.renderingClass(this.currentAsset)}" alt="Preview">`, { continued: true });
        }
        return row;
    }

    // Palette types are stored as slugs; older records may hold a slug the
    // current vocabulary no longer offers, so this formats whatever it gets.
    paletteTypeLabel(type) {
        return String(type).split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    // The one row primitive every admin form composes from.
    propertyRow(label, controlHtml, { htmlFor = null, tall = false, continued = false } = {}) {
        const classes = ['property-row', tall ? 'property-row-tall' : '', continued ? 'property-row-continued' : ''].filter(Boolean).join(' ');
        const labelTag = htmlFor
            ? `<label class="property-label" for="${htmlFor}">${this.escapeHtml(label)}</label>`
            : `<span class="property-label">${this.escapeHtml(label)}</span>`;
        return `<div class="${classes}">${labelTag}<div class="property-control">${controlHtml}</div></div>`;
    }

    // Read-only observed value, same alignment as an editable row.
    propertyValueRow(label, valueHtml) {
        return `<div class="property-row"><span class="property-label">${this.escapeHtml(label)}</span><div class="property-value">${valueHtml}</div></div>`;
    }

    // The analyzed weight rides on the row so editing the list preserves each
    // color's measured coverage instead of flattening everything to uniform.
    // Handlers take the element, never a row index: an index baked in at
    // render time points at the wrong row as soon as one is removed.
    renderColorField(color, weight = null) {
        const hasWeight = weight != null && weight !== '';
        return `<div class="color-input-wrapper" data-weight="${hasWeight ? Number(weight) : ''}">
            <input type="color" value="${this.escapeHtml(color)}" onchange="app.syncColorInputs(this)" aria-label="Color">
            <input type="text" value="${this.escapeHtml(color)}" onchange="app.syncColorInputs(this)" aria-label="Color hex">
            <span class="color-coverage">${hasWeight ? `${Math.round(Number(weight) * 100)}%` : ''}</span>
            <button class="color-remove-btn" type="button" onclick="app.removeColorInput(this)" aria-label="Remove color">×</button>
        </div>`;
    }

    syncColorInputs(source) {
        const row = source.closest('.color-input-wrapper');
        const picker = row?.querySelector('input[type="color"]');
        const text = row?.querySelector('input[type="text"]');
        if (!picker || !text) return;
        if (source === picker) text.value = picker.value;
        else picker.value = text.value;
        this.setDirty(true);
    }

    addColorInput() {
        document.getElementById('colorInputs')?.insertAdjacentHTML('beforeend', this.renderColorField('#000000'));
        this.setDirty(true);
    }

    removeColorInput(button) {
        button.closest('.color-input-wrapper')?.remove();
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
        this.showStatus('Error: ' + this.errorMessage(result), 'error');
    }
}

    getAssetDataFromForm() {
        const data = { id: this.currentAsset.id };
        for (const field of this.constructor.FIELDS || []) {
            // Observed values and the rename control are never posted back —
            // the first are derived, the second applies through its own action.
            if (!field.input || ['analysis', 'analysisMeta', 'rename'].includes(field.input)) continue;
            const input = document.getElementById(field.key);
            const key = field.dbKey || field.key;
            if (!input && field.input !== 'colors') continue;
            if (field.input === 'checkbox') data[key] = input.checked ? 1 : 0;
            else if (field.input === 'paletteType') data[key] = input.value;
            else if (field.input === 'number' || field.input === 'select') data[key] = input.value === '' ? null : Number(input.value);
            else if (field.input === 'colors') {
                // Each row carries its own analyzed weight; only rows added by
                // hand (no measured coverage) fall back to an even share.
                const rows = [...document.querySelectorAll('#colorInputs .color-input-wrapper')]
                    .map(row => ({
                        hex: row.querySelector('input[type="text"]').value.trim(),
                        weight: row.dataset.weight === '' ? null : Number(row.dataset.weight)
                    }))
                    .filter(row => row.hex);
                const unweighted = rows.filter(row => row.weight == null).length;
                const remainder = Math.max(0, 1 - rows.reduce((total, row) => total + (row.weight ?? 0), 0));
                const fallback = unweighted ? remainder / unweighted : 0;
                data[key] = rows.map(row => row.hex).join(',');
                data.color_weights = rows
                    .map(row => Math.max(0.01, row.weight ?? fallback).toFixed(2))
                    .join(',');
            } else data[key] = input.value || (field.nullable ? null : '');
        }
        data.tags = this.currentAsset.tags.map(tag => Number(tag.id));
        return data;
    }

	// Mirrors AssetNaming::filename in PHP: spaces become `_` (the segment
	// separator), a hyphen inside a segment survives. The server sanitizes
	// again on the way in — this is only so the field shows what you'll get.
	filenameFromDisplayName(name) {
		return String(name).trim().toLowerCase()
			.replace(/\s+/g, '_')
			.replace(/[^a-z0-9_-]+/g, '')
			.replace(/-{2,}/g, '-')
			.replace(/_{2,}/g, '_')
			.replace(/^[-_]+|[-_]+$/g, '');
	}

	fillRenameFromName() {
		const input = document.getElementById('renameBase');
		const source = document.getElementById('name')?.value ?? this.currentAsset?.name ?? '';
		const derived = this.filenameFromDisplayName(source);
		if (!input || !derived) return;
		input.value = derived;
		input.focus();
	}

	async renameAssetFile() {
		const input = document.getElementById('renameBase');
		if (!this.currentAsset || !input) return;
		const base = input.value.trim();
		if (!base) {
			this.showStatus('Enter a file name.', 'error');
			return;
		}
		// The rename writes the record's url; unsaved form edits would be
		// clobbered by the reload that follows, so they go first.
		if (this.dirty && !confirm('Renaming reloads this record and discards unsaved changes. Continue?')) return;

		const response = await adminFetch(`includes/api.php?action=rename_file&type=${this.config.assetType}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: this.currentAsset.id, filename: base })
		});
		const result = await response.json();
		if (!result.success) {
			this.showStatus('Error: ' + this.errorMessage(result), 'error');
			return;
		}
		if (!result.renamed) {
			this.showStatus('File name unchanged.');
			return;
		}
		this.setDirty(false);
		await this.loadAssets();
		await this.selectAsset(this.currentAsset.id, { pushHistory: false });
		this.showStaleStatus(`Renamed to ${result.filename}.`);
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
            alert('Error: ' + this.errorMessage(result));
        }
    }

    // ===== ADD ASSET MODAL =====

    async showAddModal(itemId = null) {
        if (!this.ingestReview) {
            this.ingestReview = new IngestReview(this, document.getElementById('addModal'));
        }
        await this.ingestReview.open(itemId);
        if (this.pendingDropFiles?.length) {
            const files = this.pendingDropFiles;
            this.pendingDropFiles = null;
            await this.ingestReview.upload(files);
        }
    }

    hideAddModal() {
        this.requestDeactivateModal(document.getElementById('addModal'));
    }

    updateFilePath() {
        // Canonical paths are previewed from server-provided category records.
    }

    handleFileSelection(event) {
        if (event.target.files.length) this.uploadFiles([...event.target.files]);
    }

    async addAsset() {
        await this.showAddModal();
    }

    // ===== CATEGORY MANAGEMENT =====

    showManageCategoriesModal() {
        if (!this.categoryManager) {
            this.categoryManager = new CategoryManager(this, document.getElementById('categoryModal'));
        }
        this.categoryManager.open();
    }

    hideCategoryModal() {
        this.deactivateModal(document.getElementById('categoryModal'));
    }

    // ===== TAG MANAGEMENT =====

    showManageTagsModal() {
        const modal = document.getElementById(this.config.tagModalId || 'tagModal');
        if (!this.tagManager) this.tagManager = new TagManager(this, modal);
        this.tagManager.open();
    }

    hideManageTagsModal() {
        const modal = document.getElementById(this.config.tagModalId || 'tagModal');
        this.deactivateModal(modal);
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
            const msg = result.removed_from ?
                `Tag deleted! Removed from ${result.removed_from} ${this.config.assetLabel.toLowerCase()}(s).` :
                'Tag deleted!';
            this.showStatus(msg, 'success');
        } else {
            alert('Error: ' + this.errorMessage(result));
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
        const tagListHtml = s.tags.map(tag => `<span class="tag">
                ${tag.hex_color ? `<span class="tag-color" style="--tag-color:${this.escapeHtml(tag.hex_color)}"></span>` : ''}
                <span>${this.escapeHtml(tag.name)}</span>
                <button type="button" onclick="app.removeTag(${tag.id})" class="tag-remove" aria-label="Remove tag ${this.escapeHtml(tag.name)}">×</button>
            </span>`).join('');

        document.getElementById('tagList').innerHTML = tagListHtml;

        const tagSelect = document.getElementById('tagSelect');
        const query = document.getElementById('tagSearch')?.value.trim().toLowerCase() || '';
        const availableTags = this.tags.filter(t => {
            if (s.tags.find(st => Number(st.id) === Number(t.id))) return false;
            if (!query) return true;
            return [t.name, ...(t.aliases || [])].some(value => String(value).toLowerCase().includes(query));
        });
        const groupedTags = this.groupTagsByCategory(availableTags);

        tagSelect.innerHTML = `
            <option value="">Add tag...</option>
            ${groupedTags.map(group => `
                <optgroup label="${group.category}">
                    ${group.tags.map(tag => `<option value="${tag.id}">${tag.name}</option>`).join('')}
                </optgroup>
            `).join('')}
        `;
        const hint = document.getElementById('tagSearchHint');
        if (hint) {
            const exact = this.tags.some(tag =>
                String(tag.name).toLowerCase() === query
                || (tag.aliases || []).some(alias => String(alias).toLowerCase() === query)
            );
            const probable = query && this.tags.find(tag => {
                const canonical = String(tag.name).toLowerCase();
                return `${canonical}s` === query || `${query}s` === canonical
                    || (canonical.endsWith('y') && `${canonical.slice(0, -1)}ies` === query)
                    || (query.endsWith('y') && `${query.slice(0, -1)}ies` === canonical);
            });
            hint.innerHTML = query && !exact
                ? `${probable ? `<span>Possible duplicate of ${this.escapeHtml(probable.name)}.</span>` : ''}<button type="button" class="btn btn-quiet btn-sm" onclick="app.createTagFromSearch()">Create tag “${this.escapeHtml(query)}”</button>`
                : '';
        }
    }

    async createTagFromSearch() {
        const query = document.getElementById('tagSearch')?.value.trim();
        if (!query) return;
        this.showManageTagsModal();
        await this.tagManager.load();
        this.tagManager.openForm();
        this.tagManager.form.elements.name.value = query;
        this.tagManager.updateDuplicateWarning();
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
            alert('Error: ' + this.errorMessage(result));
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
            alert('Error: ' + this.errorMessage(result));
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
		document.addEventListener('input', event => {
			const modal = event.target.closest('.modal.active[data-confirm-discard]');
			if (modal) modal._adminDirty = true;
		});
		document.addEventListener('change', event => {
			const modal = event.target.closest('.modal.active[data-confirm-discard]');
			if (modal) modal._adminDirty = true;
		});
		document.addEventListener('keydown', event => {
			const activeModals = [...document.querySelectorAll('.modal.active')];
			const modal = activeModals[activeModals.length - 1];
			if (!modal) return;
			if (modal.querySelector('dialog[open]')) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				this.requestDeactivateModal(modal);
				return;
			}
			if (event.key !== 'Tab') return;
			const focusable = [...modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
				.filter(element => !element.disabled && element.offsetParent !== null);
			if (!focusable.length) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		});
	}

	activateModal(modal) {
		if (!modal.classList.contains('active')) modal._adminOpener = document.activeElement;
		modal._adminDirty = false;
		modal.classList.add('active');
		requestAnimationFrame(() => {
			modal.querySelector('button, input, select, textarea, a[href]')?.focus();
		});
	}

	deactivateModal(modal) {
		modal.classList.remove('active');
		modal._adminDirty = false;
		if (modal._adminOpener?.isConnected) modal._adminOpener.focus();
		modal._adminOpener = null;
	}

	requestDeactivateModal(modal) {
		if (modal._adminDirty && !confirm('Discard your changes? The information entered in this dialog will be lost.')) return false;
		this.deactivateModal(modal);
		return true;
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

	errorMessage(payload) {
		if (!payload) return 'Unknown error';
		if (typeof payload === 'string') return payload;
		if (typeof payload.error === 'string') return payload.error;
		return payload.error?.message || payload.message || 'Unknown error';
	}

	async uploadFiles(files) {
		await this.showAddModal();
		await this.ingestReview.upload(files);
	}

	async analyzeCurrentAsset() {
		if (!this.currentAsset) return;
		this.showStatus(`Analyzing ${this.config.assetLabel.toLowerCase()}…`);
		const response = await adminFetch(`includes/api.php?action=analyze&id=${this.currentAsset.id}&type=${this.config.assetType}`);
		const analysis = await response.json();
		if (analysis.error) {
			this.showStatus(`Analysis failed: ${this.errorMessage(analysis)}`, 'error');
			return;
		}
		this.showAnalyzeModal(analysis);
		this.loadStoredAnalysis(); // the analyze call persisted a new observation
	}

	async analyzeBulk() {
		const includeColors = this.config.assetType !== 'glitter';
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
			if (result.error) throw new Error(this.errorMessage(result));
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
					${this.renderComparison(
						`<span class="analyze-result-value">${this.escapeHtml(format(oldValue))}</span>`,
						`<span class="analyze-result-value">${this.escapeHtml(format(newValue))}</span>`
					)}
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
		results.insertAdjacentHTML('beforeend', this.renderColorProposals(analysis));
		if (analysis.normalized?.palette && this.shouldShowAnalysisPalette()) {
			results.insertAdjacentHTML('beforeend', this.renderAnalysisPalette(analysis.normalized.palette));
		}
		if (!results.children.length) {
			results.innerHTML = '<p class="analysis-no-changes">No changes detected.</p>';
		}
		this.analysisResults = analysis;
		this.updateAnalysisActions();
		const modal = document.getElementById('analyzeModal');
		this.activateModal(modal);
		modal._adminDirty = Boolean(results.querySelector('input[type="checkbox"]:checked:not(:disabled)'));
	}

	// Asset editors render an editable Colors list, so repeating the observed
	// swatches would show the same colors twice. Hosts without that list
	// (the intake queue) call renderAnalysisPalette with swatches enabled.
	shouldShowAnalysisPalette() {
		return false;
	}

	// Proposed colors are applied one at a time and additively: colors already
	// in the list are shown for context but cannot be re-added, so applying
	// can never duplicate an entry or discard a hand-picked color.
	renderColorProposals(analysis) {
		if (!(this.constructor.FIELDS || []).some(field => field.input === 'colors')) return '';
		const proposed = String(analysis.color_codes || '').split(',').map(value => value.trim()).filter(Boolean);
		if (!proposed.length) return '';
		const weights = String(analysis.color_weights || '').split(',').map(Number);
		const existing = this.currentColorHexes();
		const rows = proposed.map((hex, index) => {
			const already = existing.includes(hex.toUpperCase());
			const weight = Number.isFinite(weights[index]) ? weights[index] : null;
			return `<label class="analyze-color-option ${already ? 'is-present' : ''}">
				<input type="checkbox" data-apply-color="${this.escapeHtml(hex)}" data-color-weight="${weight ?? ''}" ${already ? 'disabled' : 'checked'}>
				<span class="swatch-chip" style="--swatch-color:${this.escapeHtml(hex)}"><i></i><code>${this.escapeHtml(hex)}</code><small>${weight == null ? '' : `${Math.round(weight * 100)}%`}</small></span>
				<em>${already ? 'already added' : 'add'}</em>
			</label>`;
		}).join('');
		return `<div class="analyze-result-item analyze-colors">
			<div class="analyze-result-content">
				<div class="analyze-result-label">Colors</div>
				<div class="analyze-color-options">${rows}</div>
			</div>
		</div>`;
	}

	currentColorHexes() {
		return [...document.querySelectorAll('#colorInputs input[type="text"]')]
			.map(input => input.value.trim().toUpperCase()).filter(Boolean);
	}

	updateAnalysisActions() {
		const modal = document.getElementById('analyzeModal');
		const hasChanges = Boolean(modal.querySelector('#analyzeResults input[type="checkbox"]:not(:disabled)'));
		const hasPalette = Boolean(modal.querySelector('.analysis-palette'));
		const apply = modal.querySelector('[data-apply-analysis]');
		const close = modal.querySelector('[data-close-analysis]');
		apply.hidden = !hasChanges;
		close.textContent = hasChanges ? 'Cancel' : 'Close';
		// Only promise a palette when one is actually rendered — glitter hides
		// it here because its Color section already lists the same colors.
		modal.querySelector('[data-analysis-help]').textContent = hasChanges
			? 'Only values that differ from the current record are available to apply. Palette observations are stored automatically.'
			: hasPalette
				? 'No editable values changed. The palette observation below was stored automatically.'
				: 'Nothing to apply — the stored analysis already matches this record. Colors and palette are shown in the editor under Color.';
	}

	// Loaded once per asset selection. The stored analysis is an observation,
	// so it is displayed like any other set of read-only property rows.
	async loadStoredAnalysis() {
		const host = document.getElementById('storedAnalysis');
		if (!host) return;
		const assetId = this.currentAsset.id;
		host.innerHTML = '<div class="loading-state">Loading stored analysis…</div>';
		try {
			const result = await AdminAPI.json(`includes/api.php?action=analysis_view&type=${this.config.assetType}&id=${assetId}`);
			if (Number(this.currentAsset?.id) !== Number(assetId)) return;
			if (!result.analysis) {
				host.innerHTML = '<div class="empty-row">Not analyzed yet — run Auto-Analyze.</div>';
				return;
			}
			const analysis = result.analysis;
			host.innerHTML = this.renderAnalysisPalette(analysis.palette, this.shouldShowAnalysisPalette());
			// Provenance belongs with the file, not with color. Dimensions,
			// frames and transparency are already editable fields in that
			// section — repeating them read-only here was pure duplication.
			const meta = document.getElementById('analysisProvenance');
			if (meta) {
				meta.innerHTML = this.propertyValueRow('Analyzed', this.escapeHtml(result.analyzed_at || 'Unknown'))
					+ this.propertyValueRow('Type', this.escapeHtml(analysis.file.mime || 'Unknown'));
			}
		} catch (error) {
			host.innerHTML = `<div class="field-error">${this.escapeHtml(error.message)}</div>`;
		}
	}

	formatBytes(bytes) {
		const value = Number(bytes) || 0;
		if (value < 1024) return `${value} B`;
		if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
		return `${(value / (1024 * 1024)).toFixed(1)} MB`;
	}

	// `withSwatches` is false where the type already renders an editable
	// color list (glitter) — the observed palette and the editable palette
	// are the same colors, and showing both reads as two sources of truth.
	renderAnalysisPalette(palette, withSwatches = true) {
		if (!palette) return '';
		const swatches = withSwatches
			? `<div class="property-row property-row-tall"><span class="property-label">Observed colors</span><div class="property-value">${this.renderSwatchChips(palette.colors || [])}</div></div>`
			: '';
		// "Observed", not "Palette type": the published type is the editable
		// field in the Color section, and this is what the analyzer measured.
		const observed = palette.type
			? `<div class="property-row analysis-palette"><span class="property-label">Observed type</span><div class="property-value"><span class="badge badge-info">${this.escapeHtml(this.paletteTypeLabel(palette.type))}</span></div></div>
				${palette.explanation ? `<div class="property-row property-row-continued"><span class="property-label">Observed type</span><div class="property-value"><small class="property-hint">${this.escapeHtml(palette.explanation)} Confidence ${Math.round(Number(palette.confidence || 0) * 100)}%.</small></div></div>` : ''}`
			: '';
		return `${observed}${swatches}`;
	}

	// Every analyze proposal — plain values and color lists alike — uses this
	// same labelled two-column shape so the modal reads as one pattern.
	renderComparison(currentHtml, proposedHtml) {
		return `<div class="analyze-comparison">
			<div><small>Current</small>${currentHtml}</div>
			<div><small>Proposed</small>${proposedHtml}</div>
		</div>`;
	}

	// One swatch presentation for every host: analyze modal, stored
	// analysis, and the intake palette all call this.
	renderSwatchChips(colors) {
		const chips = colors.map(color => {
			const hex = typeof color === 'string' ? color : color.hex;
			const weight = typeof color === 'string' ? null : color.weight;
			return `<span class="swatch-chip" style="--swatch-color:${this.escapeHtml(hex)}"><i></i><code>${this.escapeHtml(hex)}</code>${weight == null ? '' : `<small>${Math.round(Number(weight) * 100)}%</small>`}</span>`;
		}).join('');
		return `<div class="swatch-chips">${chips}</div>`;
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
		if (params.has('ingest')) {
			const ingestId = Number(params.get('ingest'));
			await this.showAddModal(Number.isFinite(ingestId) && ingestId > 0 ? ingestId : null);
			return;
		}
		const assetId = Number(params.get('asset'));
		if (assetId && this.assets.some(asset => Number(asset.id) === assetId)) {
			// Already the current URL — seed history state without a new entry.
			window.history.replaceState({ assetId }, '', window.location.href);
			await this.selectAsset(assetId, { pushHistory: false });
			return;
		}
		const addUrl = params.get('addUrl');
		if (!addUrl) return;
		await this.showAddModal();
		const existing = this.ingestReview.modal.querySelector('.register-existing');
		existing.open = true;
		const input = existing.querySelector('[data-existing-url]');
		input.value = addUrl;
		input.focus();
		existing.scrollIntoView({ block: 'nearest' });
	}

	hideAnalyzeModal() {
		this.requestDeactivateModal(document.getElementById('analyzeModal'));
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
		this.applySelectedColors();
		this.updateTagDisplay();
		this.setDirty(true);
		document.getElementById('analyzeModal')._adminDirty = false;
		this.hideAnalyzeModal();
		// analyzeAsset persisted a fresh observation, so the Color section's
		// stored-analysis rows are now stale.
		this.loadStoredAnalysis();
	}

	// Appends only the checked, not-yet-present colors. Existing entries and
	// their weights are untouched.
	applySelectedColors() {
		const container = document.getElementById('colorInputs');
		if (!container) return;
		const selected = [...document.querySelectorAll('[data-apply-color]:checked:not(:disabled)')];
		if (!selected.length) return;
		const existing = this.currentColorHexes();
		for (const input of selected) {
			const hex = input.dataset.applyColor.trim();
			if (existing.includes(hex.toUpperCase())) continue;
			existing.push(hex.toUpperCase());
			const weight = input.dataset.colorWeight === '' ? null : Number(input.dataset.colorWeight);
			container.insertAdjacentHTML('beforeend', this.renderColorField(hex, weight));
		}
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
		if (!result.success) throw new Error(this.errorMessage(result));
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
