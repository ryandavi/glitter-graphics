'use strict';

class BrushTipManager extends ContentManager {
	constructor(editor) {
		super(editor);
		this.useBrowser = true;
		this.pickerSession = null;
		this.activeFilters.tipCategories = new Set();
	}

	setupUI() {
		this.ui = getAssetBrowserUi('brushTip');
	}

	async loadContent() {
		this.content = BrushLibrary.assets();
		this.populateCategoryChips();
	}

	async initBrowser() {
		this.browser = new AssetBrowser(this, 'brushTip');
		const categories = BrushLibrary.collections();
		await this.browser.init([
			{ id: 'basic', name: 'Basic brushes', browseFirst: true },
			{ id: 'raster', name: 'Raster brush sets', previews: categories[0]?.previews },
			...categories.map(category => ({ ...category, parent: 'raster' }))
		]);
	}

	getLayerType() { return null; }
	setupFilterChips() {}
	getFilterKey(filterType) {
		return filterType === 'brush-category' ? 'tipCategories' : super.getFilterKey(filterType);
	}
	matchesChildFilters(item) {
		return this.activeFilters.tipCategories.size === 0
			|| item.categories?.some((category) => this.activeFilters.tipCategories.has(category));
	}
	itemMatchesFacet(item, key, value) {
		if (key === 'tipCategories') return item.categories?.includes(value);
		return super.itemMatchesFacet(item, key, value);
	}
	customizeItemElement(el, item) { el.classList.add(item.kind === 'raster' ? 'is-raster' : 'is-vector'); }
	customizeCollectionCard(card, category) { card.classList.toggle('is-raster', category.id !== 'basic'); }

	getBrowseCategories(selection, catalog) {
		// Packs stay closed until selected, even on Everything home.
		return !selection.set && (selection.root === LIBRARY_ALL_ID || selection.root === 'raster')
			? catalog.getSets('raster') : null;
	}

	createCollectionIndexLead() {
		const filtered = this.applyFilters();
		const basic = filtered.filter((item) => item.kind === 'vector');
		if (!basic.length) return null;
		const lead = document.createElement('div');
		lead.className = 'brush-library-index';
		lead.dataset.categoryId = 'basic';
		if (basic.length) {
			const heading = document.createElement('h3');
			heading.className = 'asset-browser-section-title property-block-title';
			heading.textContent = 'Basic brushes';
			lead.appendChild(heading);
			const grid = document.createElement('div');
			grid.className = 'asset-grid visible brush-basic-grid';
			basic.forEach((item) => grid.appendChild(this.createItemElement(item)));
			lead.appendChild(grid);
		}
		return lead;
	}

	populateCategoryChips() {
		if (!this.ui.categoryChips) return;
		const labels = { basic: 'Basic', ornament: 'Ornament', sparkle: 'Sparkle', heart: 'Heart' };
		const categories = [...new Set(this.content.flatMap((item) => item.categories || []))].sort();
		this.ui.categoryChips.replaceChildren();
		categories.forEach((category) => {
			const chip = document.createElement('button');
			chip.type = 'button';
			chip.className = 'filter-chip text-filter-chip';
			chip.dataset.filter = 'brush-category';
			chip.dataset.value = category;
			chip.textContent = labels[category] || category;
			chip.title = chip.textContent;
			chip.setAttribute('aria-pressed', 'false');
			chip.addEventListener('click', () => this.toggleFilterChip(chip));
			this.ui.categoryChips.appendChild(chip);
		});
	}

	getCollectionAttribution(collection) {
		return BrushLibrary.packById(collection.id)?.attribution;
	}

	updateSelection() {
		const selected = this.editor.maskEditor.getBrushShape();
		this.ui.panel?.querySelectorAll('.asset-option').forEach((el) => {
			const active = el.dataset.id === selected;
			el.classList.toggle('active', active);
			el.setAttribute('aria-selected', String(active));
		});
	}

	handleItemClick(item) {
		this.editor.maskEditor.setBrushShape(item.id);
		this.closePicker();
	}

	openPicker() {
		const layer = this.editor.layerManager.getActiveLayer();
		const target = this.editor.maskEditor?.getActiveMode?.() === 'sub' ? 'Eraser' : 'Brush';
		pickerOpenSession(this, { kind: 'brush-tip', layerId: layer?.id ?? null, library: 'brushTip', label: 'Brush tip', target }, {
			reveal: () => {
				this.editor.updateSidePanelUI(layer);
				revealAssetBrowser(this.editor, this, this.editor.maskEditor.getBrushShape());
			}
		});
		this.updateSelection();
	}

	handlePickerDone() {
		this.closePicker();
	}

	closePicker() {
		this.closePickerSession();
		// Leave the temporary Brush Tips panel mode before returning to settings.
		// This restores Canvas/Shape/Text/etc. Design content from the active layer.
		this.editor.updateSidePanelUI(this.editor.layerManager.getActiveLayer());
		returnFromPickerToProperties(this.editor, { section: 'brushSettings', focusId: 'brushTipThumbnail' });
	}

	closePickerSession() {
		return pickerCloseSession(this, { updateSelection: () => this.updateSelection() });
	}
}
