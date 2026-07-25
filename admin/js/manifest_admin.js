class ManifestAdmin {
	constructor(config) {
		this.config = config;
		this.manifest = null;
		this.health = null;
		this.current = null;
		this.originalId = null;
		this.dirty = false;
		this.taxonomyDirty = false;
		this.shapeFilter = 'all';
		this.bind();
		this.load();
	}

	bind() {
		document.getElementById('addManifestItem').addEventListener('click', () => this.add());
		document.getElementById('saveManifestItem').addEventListener('click', () => this.save());
		document.getElementById('deleteManifestItem').addEventListener('click', () => this.remove());
		document.getElementById('manageManifestCategories')?.addEventListener('click', () => this.openCategories());
		document.getElementById('saveManifestCategories')?.addEventListener('click', () => this.applyCategories());
		document.getElementById('addManifestTaxonomy')?.addEventListener('click', () => this.addTaxonomyEntry());
		document.getElementById('manifestTaxonomyEditor')?.addEventListener('click', (event) => this.handleTaxonomyAction(event));
		document.getElementById('manifestTaxonomyEditor')?.addEventListener('input', () => {
			this.taxonomyDirty = true;
		});
		document.getElementById('shapeUsageFilter')?.addEventListener('change', (event) => {
			this.shapeFilter = event.target.value;
			this.renderList();
		});
		document.querySelectorAll('[data-close-categories]').forEach((button) => {
			button.addEventListener('click', () => this.requestCloseCategories());
		});
		document.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || !document.getElementById('manifestCategoriesModal')?.classList.contains('active')) return;
			event.preventDefault();
			this.requestCloseCategories();
		});
	}

	async load(selectId = null) {
		try {
			const data = await AdminAPI.json(`includes/manifestApi.php?action=get&library=${this.config.library}&_=${Date.now()}`);
			this.manifest = data.manifest;
			this.health = data.health;
			await this.loadFontFaces();
			this.renderList();
			this.renderHealth();
			if (selectId) this.select(selectId);
		} catch (error) {
			this.status(error.message, 'error');
		}
	}

	items() {
		return this.config.library === 'fonts' ? this.manifest.fonts : this.manifest.shapes;
	}

	async loadFontFaces() {
		if (this.config.library !== 'fonts') return;
		await Promise.all(this.manifest.fonts.filter((font) => !font.system && font.file).map(async (font) => {
			try {
				const face = new FontFace(font.name, `url("../${font.file}")`, { weight: String(font.weight) });
				await face.load();
				document.fonts.add(face);
			} catch (_error) {
				// The health report owns missing-file feedback.
			}
		}));
	}

	renderList() {
		const host = document.getElementById('libraryList');
		const itemHtml = (item) => {
			const active = this.current && item.id === this.current.id ? 'active' : '';
			const preview = this.config.library === 'fonts'
				? `<span class="swatch-thumb" style="display:flex;align-items:center;justify-content:center;${this.fontPreviewStyle(item)}">${this.fontPreviewGlyph(item)}</span>`
				: `<span class="swatch-thumb">${this.shapeSvg(item)}</span>`;
			return `<button type="button" class="swatch-item btn btn-quiet ${active}" style="width:100%;text-align:left" data-manifest-id="${this.escape(item.id)}">
				${preview}<span class="swatch-name">${this.escape(item.label || item.name)}</span>
			</button>`;
		};

		if (this.config.library === 'shapes') {
			if (this.shapeFilter === 'brush' || this.shapeFilter === 'brush-only') {
				const shapes = this.manifest.shapes.filter((shape) =>
					shape.uses.includes('brush') && (this.shapeFilter !== 'brush-only' || !shape.uses.includes('shape'))
				);
				host.innerHTML = `<details class="category-group" open>
					<summary class="category-label">${this.shapeFilter === 'brush-only' ? 'Brush Only' : 'Brush Picker'} (${shapes.length})</summary>
					<div class="category-items">${shapes.map(itemHtml).join('')}</div>
				</details>`;
			} else {
				const categories = this.manifest.categories.map((category) => {
					const items = this.manifest.shapes.filter((shape) => shape.uses.includes('shape') && shape.category === category.id);
					return `<details class="category-group" open>
						<summary class="category-label">${this.escape(category.label)} (${items.length})</summary>
						<div class="category-items">${items.map(itemHtml).join('')}</div>
					</details>`;
				});
				const brushOnly = this.manifest.shapes.filter((shape) => shape.uses.includes('brush') && !shape.uses.includes('shape'));
				if (this.shapeFilter === 'all' && brushOnly.length) {
					categories.push(`<details class="category-group" open>
						<summary class="category-label">Brush Only (${brushOnly.length})</summary>
						<div class="category-items">${brushOnly.map(itemHtml).join('')}</div>
					</details>`);
				}
				host.innerHTML = categories.join('');
			}
		} else {
			host.innerHTML = this.manifest.fonts.map(itemHtml).join('');
		}
		host.querySelectorAll('[data-manifest-id]').forEach((button) => {
			button.addEventListener('click', () => this.select(button.dataset.manifestId));
		});
	}

	renderHealth() {
		const host = document.getElementById('libraryHealth');
		const issues = this.health?.issues || [];
		const summary = this.config.library === 'fonts'
			? `${this.health.registered} registered / ${this.health.files} files / ${this.health.tags} tags`
			: `${this.health.registered} shapes / ${this.health.categories} categories`;
		if (!issues.length) {
			host.innerHTML = `<span class="badge badge-success">Manifest valid</span><p>${this.escape(summary)}</p>`;
			return;
		}
		host.innerHTML = `<span class="badge badge-warning">${issues.length} issue${issues.length === 1 ? '' : 's'}</span>
			<p>${this.escape(summary)}</p>
			${issues.map((issue) => `<p>
				${this.escape(issue.issue === 'missing_file' ? `Missing: ${issue.file}` : `Unregistered: ${issue.file}`)}
				${issue.issue === 'unregistered_file' ? `<button type="button" class="btn btn-quiet btn-sm" data-register-font="${this.escape(issue.file)}">Register</button>` : ''}
			</p>`).join('')}`;
		host.querySelectorAll('[data-register-font]').forEach((button) => {
			button.addEventListener('click', () => this.registerFont(button.dataset.registerFont));
		});
	}

	select(id) {
		if (this.dirty && !confirm('Discard unsaved manifest changes?')) return;
		const item = this.items().find((entry) => entry.id === id);
		if (!item) return;
		this.current = structuredClone(item);
		this.originalId = item.id;
		this.renderEditor();
		this.setDirty(false);
		this.renderList();
	}

	add() {
		if (this.dirty && !confirm('Discard unsaved manifest changes?')) return;
		if (this.config.library === 'fonts') {
			this.current = {
				id: this.uniqueId('new-font'),
				name: 'New Font',
				file: 'fonts/new-font.woff2',
				weight: 400,
				fallback: 'sans-serif',
				featured: false,
				scripts: ['latin'],
				tags: []
			};
		} else {
			this.current = {
				id: this.uniqueId('new-shape'),
				label: 'New Shape',
				viewBox: 24,
				uses: ['shape'],
				category: this.manifest.categories[0]?.id || '',
				shapeOrder: this.nextOrder('shape'),
				svgPath: ''
			};
		}
		this.originalId = null;
		this.renderEditor();
		this.setDirty(true);
	}

	registerFont(file) {
		const stem = file.split('/').pop().replace(/\.[^.]+$/, '');
		const id = this.uniqueId(stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'font');
		this.current = {
			id,
			name: stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
			file,
			weight: 400,
			fallback: 'sans-serif',
			featured: false,
			scripts: ['latin'],
			tags: []
		};
		this.originalId = null;
		this.renderEditor();
		this.setDirty(true);
	}

	renderEditor() {
		document.getElementById('emptyState').style.display = 'none';
		const editor = document.getElementById('editorContent');
		editor.style.display = 'block';
		editor.innerHTML = this.config.library === 'fonts' ? this.fontEditor() : this.shapeEditor();
		editor.querySelectorAll('input, select, textarea').forEach((control) => {
			control.addEventListener('input', () => this.setDirty(true));
			control.addEventListener('change', () => {
				this.setDirty(true);
				this.syncConditionalFields();
			});
		});
		document.getElementById('deleteManifestItem').disabled = false;
	}

	fontEditor() {
		const font = this.current;
		return `<div class="editor-title-row"><h1>${this.escape(font.name)}</h1></div>
			<div class="font-specimen-list">
				${this.fontSpecimenRows(font)}
			</div>
			<details class="admin-section" open>
				<summary class="admin-section-title">Font definition</summary>
				${this.row('ID', this.input('id', font.id))}
				${this.row('Name', this.input('name', font.name))}
				${this.row('System font', this.checkbox('system', font.system))}
				${this.row('File', this.input('file', font.file || '', 'text', Boolean(font.system)))}
				${this.row('Family stack', this.input('family', font.family || '', 'text', !font.system))}
				${this.row('Weight', this.input('weight', font.weight, 'number'))}
				${this.row('Fallback', this.input('fallback', font.fallback || 'sans-serif'))}
				${this.row('Fallback font ID', this.input('fallbackFontId', font.fallbackFontId || ''))}
				${this.row('Scripts', this.input('scripts', (font.scripts || []).join(', ')))}
				${this.row('Featured', this.checkbox('featured', font.featured))}
			</details>
			<details class="admin-section" open>
				<summary class="admin-section-title">Tags</summary>
				${this.fontTagRows(font)}
			</details>`;
	}

	fontSpecimenRows(font) {
		return (font.scripts || []).map((script) => {
			const specimen = this.fontSpecimen(script);
			return `<div class="font-specimen-row">
				<span class="font-specimen-label">${this.escape(specimen.label)}</span>
				<div class="font-specimen-text" lang="${this.escape(specimen.lang)}" style="${this.fontPreviewStyle(font)}">${this.escape(specimen.text)}</div>
			</div>`;
		}).join('');
	}

	fontSpecimen(script) {
		const specimens = {
			latin: {
				label: 'Latin',
				lang: 'en',
				glyph: 'Ag',
				text: 'Glitter makes everything better!'
			},
			ja: {
				label: 'Japanese',
				lang: 'ja',
				glyph: 'あ',
				text: 'きらきら輝く文字を作ろう'
			},
			ko: {
				label: 'Korean',
				lang: 'ko',
				glyph: '한',
				text: '반짝이는 글자를 만들어 보세요'
			},
			zh: {
				label: 'Simplified Chinese',
				lang: 'zh-Hans',
				glyph: '字',
				text: '让文字闪闪发光'
			}
		};
		return specimens[script] || {
			label: String(script).toUpperCase(),
			lang: script,
			glyph: 'Aa',
			text: 'Font specimen'
		};
	}

	fontPreviewGlyph(font) {
		const scripts = font.scripts || [];
		const script = scripts.includes('latin') ? 'latin' : scripts[0];
		return script ? this.fontSpecimen(script).glyph : 'Aa';
	}

	fontTagRows(font) {
		return this.manifest.tagGroups.map((group) => {
			const controls = group.tags.map((tag) => `<label>
				<input type="checkbox" name="fontTag" value="${this.escape(tag.id)}" ${(font.tags || []).includes(tag.id) ? 'checked' : ''}>
				${this.escape(tag.label)}
			</label>`).join(' ');
			return this.row(group.label, controls, true);
		}).join('');
	}

	shapeEditor() {
		const shape = this.current;
		const categories = this.manifest.categories.map((category) =>
			`<option value="${this.escape(category.id)}" ${shape.category === category.id ? 'selected' : ''}>${this.escape(category.label)}</option>`
		).join('');
		return `<div class="editor-title-row"><h1>${this.escape(shape.label)}</h1></div>
			<div class="property-row property-row-tall">
				<span class="property-label">Preview</span>
				<div class="property-control"><span class="swatch-thumb">${this.shapeSvg(shape)}</span></div>
			</div>
			<details class="admin-section" open>
				<summary class="admin-section-title">Shape definition</summary>
				${this.row('ID', this.input('id', shape.id))}
				${this.row('Label', this.input('label', shape.label))}
				${this.row('ViewBox', this.input('viewBox', shape.viewBox, 'number'))}
				${this.row('Shape picker', this.checkbox('useShape', shape.uses.includes('shape')))}
				${this.row('Brush picker', this.checkbox('useBrush', shape.uses.includes('brush')))}
				${this.row('Category', `<select name="category" ${shape.uses.includes('shape') ? '' : 'disabled'}>${categories}</select>`)}
				${this.row('Shape order', this.input('shapeOrder', shape.shapeOrder ?? this.nextOrder('shape'), 'number', !shape.uses.includes('shape')))}
				${this.row('Brush order', this.input('brushOrder', shape.brushOrder ?? this.nextOrder('brush'), 'number', !shape.uses.includes('brush')))}
				${this.row('Primitive', `<select name="primitive">
					<option value="" ${shape.primitive ? '' : 'selected'}>SVG path</option>
					${['circle', 'square', 'calligraphy'].map((primitive) => `<option value="${primitive}" ${shape.primitive === primitive ? 'selected' : ''}>${primitive}</option>`).join('')}
				</select>`)}
				${this.row('SVG path', `<textarea name="svgPath" rows="8">${this.escape(shape.svgPath || '')}</textarea>`, true)}
			</details>`;
	}

	readEditor() {
		const form = document.getElementById('editorContent');
		const value = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() || '';
		const checked = (name) => Boolean(form.querySelector(`[name="${name}"]`)?.checked);
		if (this.config.library === 'fonts') {
			const item = {
				id: value('id'),
				name: value('name'),
				weight: Number(value('weight')),
				fallback: value('fallback'),
				featured: checked('featured'),
				scripts: value('scripts').split(',').map((script) => script.trim().toLowerCase()).filter(Boolean),
				tags: Array.from(form.querySelectorAll('[name="fontTag"]:checked'), (input) => input.value)
			};
			if (checked('system')) {
				item.system = true;
				item.family = value('family');
			} else {
				item.file = value('file');
			}
			if (value('fallbackFontId')) item.fallbackFontId = value('fallbackFontId');
			return item;
		}

		const uses = [];
		if (checked('useShape')) uses.push('shape');
		if (checked('useBrush')) uses.push('brush');
		const item = {
			id: value('id'),
			label: value('label'),
			viewBox: Number(value('viewBox')),
			uses
		};
		if (uses.includes('shape')) {
			item.category = value('category');
			item.shapeOrder = Number(value('shapeOrder'));
		}
		if (uses.includes('brush')) item.brushOrder = Number(value('brushOrder'));
		if (value('primitive')) item.primitive = value('primitive');
		else item.svgPath = value('svgPath');
		return item;
	}

	syncConditionalFields() {
		const editor = document.getElementById('editorContent');
		if (this.config.library === 'fonts') {
			const system = Boolean(editor.querySelector('[name="system"]')?.checked);
			editor.querySelector('[name="file"]').disabled = system;
			editor.querySelector('[name="family"]').disabled = !system;
			return;
		}
		const useShape = Boolean(editor.querySelector('[name="useShape"]')?.checked);
		const useBrush = Boolean(editor.querySelector('[name="useBrush"]')?.checked);
		editor.querySelector('[name="category"]').disabled = !useShape;
		editor.querySelector('[name="shapeOrder"]').disabled = !useShape;
		editor.querySelector('[name="brushOrder"]').disabled = !useBrush;
	}

	async save() {
		try {
			let item = null;
			if (this.current) {
				item = this.readEditor();
				const items = this.items();
				const index = this.originalId ? items.findIndex((entry) => entry.id === this.originalId) : -1;
				if (index >= 0) items[index] = item;
				else items.push(item);
			}
			const data = await AdminAPI.json(`includes/manifestApi.php?action=save&library=${this.config.library}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ manifest: this.manifest })
			});
			this.manifest = data.manifest;
			this.health = data.health;
			if (item) {
				this.current = structuredClone(item);
				this.originalId = item.id;
			}
			this.setDirty(false);
			this.renderList();
			this.renderHealth();
			this.status('Manifest saved', 'success');
		} catch (error) {
			this.status(error.message, 'error');
		}
	}

	async remove() {
		if (!this.current || !confirm(`Delete ${this.current.label || this.current.name} from the manifest?`)) return;
		const items = this.items();
		const index = items.findIndex((entry) => entry.id === this.originalId);
		if (index >= 0) items.splice(index, 1);
		try {
			const data = await AdminAPI.json(`includes/manifestApi.php?action=save&library=${this.config.library}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ manifest: this.manifest })
			});
			this.manifest = data.manifest;
			this.health = data.health;
			this.current = null;
			this.originalId = null;
			this.setDirty(false);
			document.getElementById('editorContent').style.display = 'none';
			document.getElementById('emptyState').style.display = '';
			document.getElementById('deleteManifestItem').disabled = true;
			this.renderList();
			this.renderHealth();
			this.status('Manifest entry deleted', 'success');
		} catch (error) {
			this.status(error.message, 'error');
		}
	}

	openCategories() {
		if (this.current && this.dirty) this.current = this.readEditor();
		this.renderTaxonomyEditor();
		this.taxonomyDirty = false;
		document.getElementById('manifestCategoriesModal').classList.add('active');
	}

	requestCloseCategories() {
		if (this.taxonomyDirty && !confirm('Discard unapplied changes? Your changes in this dialog will be lost.')) return false;
		this.closeCategories();
		return true;
	}

	closeCategories() {
		document.getElementById('manifestCategoriesModal').classList.remove('active');
		this.taxonomyDirty = false;
	}

	renderTaxonomyEditor() {
		const host = document.getElementById('manifestTaxonomyEditor');
		if (this.config.library === 'fonts') {
			host.innerHTML = this.manifest.tagGroups.map((group) => this.fontTagGroupEditor(group)).join('');
			return;
		}
		host.innerHTML = this.manifest.categories.map((category) => this.shapeCategoryEditor(category)).join('');
	}

	fontTagGroupEditor(group) {
		return `<section class="manifest-taxonomy-group" data-font-tag-group>
			<div class="manifest-taxonomy-heading">
				<strong>Tag group</strong>
				<button type="button" class="btn btn-quiet btn-sm" data-remove-tag-group>Remove group</button>
			</div>
			<div class="manifest-taxonomy-fields">
				<label>ID ${this.taxonomyInput('tagGroupId', group.id, 'style')}</label>
				<label>Label ${this.taxonomyInput('tagGroupLabel', group.label, 'Style')}</label>
			</div>
			<div class="manifest-taxonomy-tags" data-font-tags>
				${group.tags.map((tag) => this.fontTagEditor(tag)).join('')}
			</div>
			<button type="button" class="btn btn-secondary btn-sm" data-add-font-tag>Add tag</button>
		</section>`;
	}

	fontTagEditor(tag) {
		return `<div class="manifest-taxonomy-row" data-font-tag>
			<label>ID ${this.taxonomyInput('tagId', tag.id, 'display')}</label>
			<label>Label ${this.taxonomyInput('tagLabel', tag.label, 'Display')}</label>
			<button type="button" class="btn btn-quiet btn-sm" data-remove-font-tag aria-label="Remove tag">&times;</button>
		</div>`;
	}

	shapeCategoryEditor(category) {
		return `<div class="manifest-taxonomy-row manifest-category-row" data-shape-category>
			<label>ID ${this.taxonomyInput('categoryId', category.id, 'basic')}</label>
			<label>Label ${this.taxonomyInput('categoryLabel', category.label, 'Basic Shapes')}</label>
			<button type="button" class="btn btn-quiet btn-sm" data-remove-shape-category aria-label="Remove category">&times;</button>
		</div>`;
	}

	taxonomyInput(name, value, placeholder) {
		return `<input type="text" name="${name}" value="${this.escape(value)}" placeholder="${this.escape(placeholder)}">`;
	}

	addTaxonomyEntry() {
		const host = document.getElementById('manifestTaxonomyEditor');
		this.taxonomyDirty = true;
		if (this.config.library === 'fonts') {
			const id = this.uniqueTaxonomyId('new-group', 'tagGroupId');
			host.insertAdjacentHTML('beforeend', this.fontTagGroupEditor({ id, label: 'New Group', tags: [] }));
			return;
		}
		const id = this.uniqueTaxonomyId('new-category', 'categoryId');
		host.insertAdjacentHTML('beforeend', this.shapeCategoryEditor({ id, label: 'New Category' }));
	}

	handleTaxonomyAction(event) {
		const button = event.target.closest('button');
		if (!button) return;
		let changed = true;
		if (button.matches('[data-remove-tag-group]')) {
			button.closest('[data-font-tag-group]').remove();
		} else if (button.matches('[data-add-font-tag]')) {
			const group = button.closest('[data-font-tag-group]');
			const id = this.uniqueTaxonomyId('new-tag', 'tagId');
			group.querySelector('[data-font-tags]').insertAdjacentHTML('beforeend', this.fontTagEditor({ id, label: 'New Tag' }));
		} else if (button.matches('[data-remove-font-tag]')) {
			button.closest('[data-font-tag]').remove();
		} else if (button.matches('[data-remove-shape-category]')) {
			button.closest('[data-shape-category]').remove();
		} else {
			changed = false;
		}
		if (changed) this.taxonomyDirty = true;
	}

	uniqueTaxonomyId(base, inputName) {
		const ids = new Set(Array.from(
			document.querySelectorAll(`#manifestTaxonomyEditor [name="${inputName}"]`),
			(input) => input.value
		));
		let id = base;
		let suffix = 2;
		while (ids.has(id)) id = `${base}-${suffix++}`;
		return id;
	}

	applyCategories() {
		const host = document.getElementById('manifestTaxonomyEditor');
		const value = (row, name) => row.querySelector(`[name="${name}"]`)?.value.trim() || '';
		if (this.config.library === 'fonts') {
			this.manifest.tagGroups = Array.from(host.querySelectorAll('[data-font-tag-group]'), (group) => ({
				id: value(group, 'tagGroupId'),
				label: value(group, 'tagGroupLabel'),
				tags: Array.from(group.querySelectorAll('[data-font-tag]'), (tag) => ({
					id: value(tag, 'tagId'),
					label: value(tag, 'tagLabel')
				}))
			}));
			this.closeCategories();
			this.setDirty(true);
			if (this.current) this.renderEditor();
			return;
		}
		this.manifest.categories = Array.from(host.querySelectorAll('[data-shape-category]'), (category) => ({
			id: value(category, 'categoryId'),
			label: value(category, 'categoryLabel')
		}));
		this.closeCategories();
		this.setDirty(true);
		this.renderList();
		if (this.current) this.renderEditor();
	}

	setDirty(dirty) {
		this.dirty = dirty;
		document.getElementById('saveManifestItem').disabled = !dirty;
	}

	nextOrder(usage) {
		const key = usage === 'shape' ? 'shapeOrder' : 'brushOrder';
		const values = this.items().filter((item) => item.uses.includes(usage)).map((item) => Number(item[key]));
		return values.length ? Math.max(...values) + 1 : 0;
	}

	uniqueId(base) {
		const ids = new Set(this.items().map((item) => item.id));
		let id = base;
		let suffix = 2;
		while (ids.has(id)) id = `${base}-${suffix++}`;
		return id;
	}

	row(label, control, tall = false) {
		return `<div class="property-row ${tall ? 'property-row-tall' : ''}">
			<span class="property-label">${this.escape(label)}</span>
			<div class="property-control">${control}</div>
		</div>`;
	}

	input(name, value, type = 'text', disabled = false) {
		return `<input type="${type}" name="${name}" value="${this.escape(value ?? '')}" ${disabled ? 'disabled' : ''}>`;
	}

	checkbox(name, checked) {
		return `<input type="checkbox" class="field-switch" name="${name}" ${checked ? 'checked' : ''}>`;
	}

	fontPreviewStyle(font) {
		if (font.system) return `font-family:${this.escape(font.family || font.fallback)};`;
		return `font-family:'${this.escape(font.name)}',${this.escape(font.fallback)};`;
	}

	shapeSvg(shape) {
		const viewBox = Number(shape.viewBox) || 24;
		let inner = '';
		if (shape.svgPath) inner = `<path d="${this.escape(shape.svgPath)}"/>`;
		else if (shape.primitive === 'square') inner = `<rect width="${viewBox}" height="${viewBox}"/>`;
		else if (shape.primitive === 'calligraphy') inner = `<ellipse cx="${viewBox / 2}" cy="${viewBox / 2}" rx="${viewBox / 2}" ry="${viewBox * 0.16}" transform="rotate(-45 ${viewBox / 2} ${viewBox / 2})"/>`;
		else inner = `<circle cx="${viewBox / 2}" cy="${viewBox / 2}" r="${viewBox / 2}"/>`;
		return `<svg viewBox="0 0 ${viewBox} ${viewBox}" style="width:100%;height:100%;fill:currentColor" aria-hidden="true">${inner}</svg>`;
	}

	status(message, type = '') {
		const status = document.getElementById('statusMessage');
		status.textContent = message;
		status.className = `status-message ${type}`;
	}

	escape(value) {
		const node = document.createElement('div');
		node.textContent = String(value ?? '');
		return node.innerHTML;
	}
}

const app = new ManifestAdmin(CONFIG);
