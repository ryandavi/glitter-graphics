'use strict';

class BrushTipManager extends ContentManager {
	constructor(editor) {
		super(editor);
		this.useBrowser = true;
		this.pickerSession = null;
		this.activeFilters.tipCategories = new Set();
	}

	setupUI() {
		this.ui = {
			panel: document.getElementById('brushTipOptions'),
			searchInput: document.getElementById('brushTipSearch'),
			filterToggle: document.getElementById('brushTipFilterToggleBtn'),
			filtersContainer: document.getElementById('brushTipFiltersContainer'),
			clearFiltersBtn: document.getElementById('clearBrushTipFiltersBtn'),
			closeFiltersBtn: document.getElementById('closeBrushTipFiltersBtn'),
			activeFilterSummary: document.getElementById('brushTipActiveFilterSummary'),
			categoryChips: document.getElementById('brushTipCategoryChips')
		};
	}

	async loadContent() {
		this.content = BrushLibrary.assets();
		this.populateCategoryChips();
	}

	async initBrowser() {
		this.browser = new AssetBrowser(this, {
			browser: 'brushTipBrowser', backBtn: 'brushTipBrowserBack', title: 'brushTipBrowserTitle',
			content: 'brushTipBrowserContent', categoryGrid: 'brushTipCategoryGrid',
			searchResults: 'brushTipSearchResults', itemGrid: 'brushTipItemGrid',
			sentinel: 'brushTipBrowserSentinel', emptyState: 'brushTipBrowserEmpty',
			emptyText: 'brushTipBrowserEmptyText'
		}, 'Brush Tips');
		await this.browser.init(CONFIG.tools.maskBrush.brushTips.categories);
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
	customizeCollectionCard(card) { card.classList.add('is-raster'); }

	createCollectionIndexLead() {
		const filtered = this.applyFilters();
		const basic = filtered.filter((item) => item.kind === 'vector');
		const raster = filtered.filter((item) => item.kind === 'raster');
		if (!basic.length && !raster.length) return null;
		const lead = document.createElement('div');
		lead.className = 'brush-library-index';
		if (basic.length) {
			const heading = document.createElement('h3');
			heading.className = 'asset-browser-section-title';
			heading.textContent = 'Basic brushes';
			lead.appendChild(heading);
			const grid = document.createElement('div');
			grid.className = 'asset-grid visible brush-basic-grid';
			basic.forEach((item) => grid.appendChild(this.createItemElement(item)));
			lead.appendChild(grid);
		}
		if (raster.length) {
			const setsHeading = document.createElement('h3');
			setsHeading.className = 'asset-browser-section-title raster-sets-title';
			setsHeading.textContent = 'Raster brush sets';
			lead.appendChild(setsHeading);
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

	createCollectionInfo(collection) {
		const pack = BrushLibrary.packById(collection.id);
		if (!pack) return null;
		const attribution = pack.attribution;
		const info = document.createElement('div');
		info.className = 'asset-collection-credit';
		const heading = document.createElement('div');
		heading.className = 'asset-collection-credit-heading';
		heading.textContent = 'Source & usage';
		info.appendChild(heading);
		const byline = document.createElement('div');
		byline.className = 'asset-collection-credit-byline';
		byline.append('Created by ');
		if (attribution.authorUrl) {
			const author = document.createElement('a');
			author.href = attribution.authorUrl;
			author.target = '_blank';
			author.rel = 'noopener';
			author.textContent = attribution.author || 'unknown creator';
			byline.appendChild(author);
		} else byline.append(attribution.author || 'unknown creator');
		info.appendChild(byline);
		const meta = document.createElement('div');
		meta.className = 'asset-collection-credit-meta';
		const license = document.createElement('span');
		license.textContent = attribution.license === 'personal-use' ? 'Personal use' : attribution.license === 'unknown' ? 'License unknown' : attribution.license;
		meta.appendChild(license);
		if (attribution.archivedBy) {
			const archived = document.createElement('span');
			archived.textContent = `Archived by ${attribution.archivedBy}`;
			meta.appendChild(archived);
		}
		info.appendChild(meta);
		if (attribution.notes) {
			const notes = document.createElement('details');
			notes.className = 'asset-collection-credit-notes';
			const summary = document.createElement('summary');
			summary.textContent = 'Archival note';
			const copy = document.createElement('div');
			copy.textContent = attribution.notes;
			notes.append(summary, copy);
			info.appendChild(notes);
		}
		const links = document.createElement('div');
		links.className = 'asset-collection-credit-links';
		[['View archived set', attribution.archiveUrl]].forEach(([label, url]) => {
			if (!url) return;
			const link = document.createElement('a');
			link.href = url;
			link.target = '_blank';
			link.rel = 'noopener';
			link.textContent = label;
			links.appendChild(link);
		});
		if (links.childElementCount) info.appendChild(links);
		return info;
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
		pickerOpenSession(this, { kind: 'brush-tip', layerId: layer?.id ?? null }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => {
				this.editor.updateSidePanelUI(layer);
				revealAssetBrowser(this.editor, this);
			}
		});
		this.updateSelection();
	}

	closePicker() {
		pickerCloseSession(this, { refresh: () => this.updatePickerStrip({ closing: true }), updateSelection: () => this.updateSelection() });
		// Leave the temporary Brush Tips panel mode before returning to settings.
		// This restores Canvas/Shape/Text/etc. Design content from the active layer.
		this.editor.updateSidePanelUI(this.editor.layerManager.getActiveLayer());
		returnFromPickerToProperties(this.editor, { section: 'brushSettings', focusId: 'brushTipThumbnail' });
	}

	updatePickerStrip(options = {}) {
		const toolName = this.editor.maskEditor?.getActiveMode?.() === 'sub' ? 'Eraser' : 'Brush';
		const copy = {
			title: 'Choosing brush tip',
			detail: `For the active ${toolName} tool`
		};
		renderPickerStrip({
			ownsStrip: Boolean(this.pickerSession) || options.closing === true, visible: Boolean(this.pickerSession),
			armed: Boolean(this.pickerSession), library: 'brush-tips', ...copy, showDone: false
		});
		if (!this.pickerSession && !this.editor.pickers.active) {
			document.getElementById('designGallerySection')?.classList.remove('picker-mode');
		}
	}
}
