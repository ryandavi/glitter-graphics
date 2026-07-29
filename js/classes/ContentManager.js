// ============================================
// CONTENT MANAGER BASE CLASS
// Handles common functionality for content pickers (glitter/stickers)
// ============================================
class ContentManager {
	constructor(editor) {
		this.editor = editor;

		// Content arrays
		this.content = [];
		this.userContent = [];
		this.assetDetailPromises = new Map();
		this.assetDetailBasePath = null;

		this.browser = null;
		this.useBrowser = false; // Toggle for browser mode
		this.filterSheetHeight = null;

		// Base filter state - children can extend this
		this.activeFilters = {
			search: '',
			nameOnly: false,
			categories: new Set(),
			tags: new Set(),
			colors: new Set(),
			animated: null
		};

		// UI references - children define specific IDs in setupUI()
		this.ui = {
			panel: null,
			searchInput: null,
			filterToggle: null,
			filtersContainer: null,
			clearFiltersBtn: null,
			closeFiltersBtn: null,
			activeFilterSummary: null,
			searchNameOnly: null
		};

	}

	async init() {
		this.setupUI();
		this.setupEventListeners();
		await this.loadContent();
		this.updateFacetAvailability();
		await this.initBrowser();
		this.updateClearFiltersButton();
	}

	async initBrowser() {
		// Must be implemented by child with proper element IDs
		throw new Error('initBrowser() must be implemented by child class');
	}

	// ===== UI SETUP (must be overridden by child) =====
	setupUI() {
		throw new Error('setupUI() must be implemented by child class');
	}

	// ===== EVENT LISTENERS =====

	setupEventListeners() {
		// Base listeners that all content managers need
		this.ui.filtersContainer?.querySelectorAll('.filter-chip').forEach((chip) => {
			chip.setAttribute('role', 'button');
			chip.setAttribute('tabindex', '0');
			chip.setAttribute('aria-pressed', 'false');
			if (!chip.textContent.trim() && chip.title) chip.setAttribute('aria-label', chip.title);
			chip.addEventListener('click', () => this.toggleFilterChip(chip));
			chip.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				chip.click();
			});
		});

		// Search input
		if (this.ui.searchInput) {
			this.ui.searchInput.addEventListener('input', (e) => {
				this.handleSearch(e.target.value);
			});
		}

		// Filter toggle button
		if (this.ui.filterToggle) {
			this.ui.filterToggle.addEventListener('click', () => {
				this.toggleFiltersUI();
			});
		}
		this.ui.closeFiltersBtn?.addEventListener('click', () => this.toggleFiltersUI(false));

		// Clear filters button
		if (this.ui.clearFiltersBtn) {
			this.ui.clearFiltersBtn.addEventListener('click', () => {
				this.clearFilters();
			});
		}
		// Name Only Checkbox
		if (this.ui.searchNameOnly) {
			this.ui.searchNameOnly.addEventListener('change', (e) => {
				this.activeFilters.nameOnly = e.target.checked;
				this.browser.refresh();        // ← REPLACE WITH THIS
				this.updateClearFiltersButton();
			});
		}

		// Child classes can add more listeners by overriding and calling super.setupEventListeners()
	}


	getLayerType() {
		return null;
	}

	scrollToContent(contentId) {
		this.browser.navigateToItem(contentId);
	}

	normalizeBooleanValue(value, fallback = false) {
		if (value === undefined || value === null || value === '') {
			return fallback;
		}

		if (typeof value === 'string') {
			const normalized = value.toLowerCase();
			if (normalized === 'true') return true;
			if (normalized === 'false') return false;
		}

		return Boolean(Number(value));
	}

	normalizeNumberValue(value, fallback = 0) {
		if (value === undefined || value === null || value === '') {
			return fallback;
		}

		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	normalizeArrayValue(value, fallback = []) {
		return Array.isArray(value) ? value : fallback;
	}

	normalizeAsset(raw, defaults = {}) {
		const colorCodes = Array.isArray(raw.colorCodes)
			? raw.colorCodes
			: (defaults.colorCodes || []);

		return {
			...defaults,
			id: raw.id ?? defaults.id ?? null,
			name: raw.name ?? defaults.name ?? 'Unnamed',
			filename: raw.filename ?? defaults.filename ?? null,
			url: raw.url ?? defaults.url ?? null,
			thumbnailUrl: raw.thumbnailUrl ?? raw.url ?? defaults.thumbnailUrl ?? null,
			category: raw.category ?? defaults.category ?? 'Uncategorized',
			attribution: raw.attribution ?? defaults.attribution ?? null,
			stickerText: raw.stickerText ?? defaults.stickerText ?? null,
			tags: this.normalizeArrayValue(raw.tags, defaults.tags || []),
			searchTerms: this.normalizeArrayValue(raw.searchTerms, defaults.searchTerms || []),
			colors: this.normalizeArrayValue(raw.colors, defaults.colors || []),
			generatedName: raw.generatedName ?? defaults.generatedName ?? null,
			brightness: raw.brightness ?? defaults.brightness ?? null,
			sortOrder: this.normalizeNumberValue(raw.sortOrder, defaults.sortOrder ?? 0),
			hue: raw.hue ?? defaults.hue ?? null,
			colorCodes,
			colorWeights: Array.isArray(raw.colorWeights) ? raw.colorWeights : (defaults.colorWeights ?? null),
			paletteType: raw.paletteType ?? defaults.paletteType ?? null,
			frameCount: this.normalizeNumberValue(raw.frameCount, defaults.frameCount ?? 0),
			frameRate: this.normalizeNumberValue(raw.frameRate, defaults.frameRate ?? 10),
			isVariableFramerate: this.normalizeBooleanValue(raw.isVariableFramerate, defaults.isVariableFramerate ?? false),
			isAnimated: this.normalizeBooleanValue(raw.isAnimated, defaults.isAnimated ?? false),
			hasTransparency: this.normalizeBooleanValue(raw.hasTransparency, defaults.hasTransparency ?? false),
			width: this.normalizeNumberValue(raw.width, defaults.width ?? 0),
			height: this.normalizeNumberValue(raw.height, defaults.height ?? 0),
			fileSize: this.normalizeNumberValue(raw.fileSize, defaults.fileSize ?? 0),
			isPixelated: this.normalizeBooleanValue(raw.isPixelated, defaults.isPixelated ?? false),
			isActive: this.normalizeBooleanValue(raw.isActive, defaults.isActive ?? true),
			featured: this.normalizeBooleanValue(raw.featured, defaults.featured ?? false),
			source: raw.source ?? defaults.source ?? null,
		};
	}

	async loadIndexedManifest({ indexPath, fallbackPath, detailBasePath, defaults }) {
		let records = null;
		let indexed = false;
		try {
			const response = await fetch(`${indexPath}?v=${CONFIG.app.assets.manifestVersion}`);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			records = await response.json();
			indexed = true;
		} catch (error) {
			dbg(`[assets] Falling back to ${fallbackPath}: ${error.message}`);
			const response = await fetch(fallbackPath);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			records = await response.json();
		}

		this.assetDetailBasePath = indexed ? detailBasePath : null;
		this.content = records.map((record) => {
			const asset = this.normalizeAsset(record, defaults);
			asset._detailLoaded = !indexed;
			return asset;
		});
		return this.content;
	}

	async ensureAssetDetails(assetOrId) {
		const asset = typeof assetOrId === 'object' ? assetOrId : this.getItemById(assetOrId);
		if (!asset || !this.content.includes(asset) || asset._detailLoaded || !this.assetDetailBasePath) return asset;
		if (!this.assetDetailPromises.has(asset.id)) {
			const promise = fetch(
				`${this.assetDetailBasePath}/${encodeURIComponent(asset.id)}.json?v=${CONFIG.app.assets.manifestVersion}`
			)
				.then((response) => {
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					return response.json();
				})
				.then((detail) => {
					const normalized = this.normalizeAsset({ ...asset, ...detail }, asset);
					Object.assign(asset, normalized, { _detailLoaded: true });
					return asset;
				})
				.catch((error) => {
					this.assetDetailPromises.delete(asset.id);
					throw error;
				});
			this.assetDetailPromises.set(asset.id, promise);
		}
		return this.assetDetailPromises.get(asset.id);
	}

	populateCategoryChips() {
		if (!this.ui.categoryChips || this.ui.categoryChips.children.length > 0) return;

		// Get unique categories
		const categories = new Set();
		[...this.content, ...this.userContent].forEach(sticker => {
			if (sticker.category) categories.add(sticker.category);
		});

		// Create chips
		Array.from(categories).forEach(category => {
			const chip = document.createElement('button');
			chip.type = 'button';
			chip.className = 'filter-chip text-filter-chip';
			chip.dataset.value = category;  // Changed from dataset.category
			chip.dataset.filter = 'category';
			chip.textContent = category.charAt(0).toUpperCase() + category.slice(1);
			chip.title = category;
			chip.setAttribute('aria-pressed', 'false');

			chip.addEventListener('click', () => this.toggleFilterChip(chip));

			this.ui.categoryChips.appendChild(chip);
		});
	}

	// ===== SEARCH & FILTERS =====

	toggleFilterChip(chip) {
		const filterType = chip.dataset.filter; // 'color', 'tone', 'special', 'category', 'tags'
		const value = chip.dataset.value || chip.dataset.color;

		const filterKey = this.getFilterKey(filterType);
		if (!filterKey || !(filterKey in this.activeFilters)) {
			dbg(`Unknown filter type: ${filterType}`);
			return;
		}

		if (filterKey === 'animated') {
			const nextValue = chip.dataset.animated === 'true';
			this.activeFilters.animated = this.activeFilters.animated === nextValue ? null : nextValue;
		} else {
			const filterSet = this.activeFilters[filterKey];
			if (filterSet.has(value)) {
				filterSet.delete(value);
			} else {
				filterSet.add(value);
			}
		}
		this.syncFilterControls();

		// Re-render and update UI
		this.browser.refresh();

		this.updateClearFiltersButton();
	}

	applyFilters() {
		const allContent = this.getAllContent();

		const filtered = allContent.filter(item => {
			// Search filter - delegates to child for custom logic
			if (this.activeFilters.search) {
				if (!this.matchesSearch(item)) return false;
			}

			// Category filter
			if (this.activeFilters.categories.size > 0) {
				if (!this.activeFilters.categories.has(item.category)) {
					return false;
				}
			}

			// Tag filter (generic tags)
			if (this.activeFilters.tags.size > 0) {
				const hasMatchingTag = item.tags?.some(tag =>
					this.activeFilters.tags.has(tag)
				);
				if (!hasMatchingTag) return false;
			}

			// Color filter - delegates to child for custom storage
			if (this.activeFilters.colors.size > 0) {
				if (!this.matchesColors(item)) return false;
			}

			// Child-specific filters (tones, special, animated, etc.)
			if (!this.matchesChildFilters(item)) return false;

			return true;
		});

		if (this.activeFilters.search) {
			filtered.sort((left, right) => this.getSearchScore(right) - this.getSearchScore(left));
		}

		return filtered;
	}

	normalizeSearchText(value) {
		return String(value || '')
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();
	}

	getSearchText(item) {
		const name = this.normalizeSearchText(item.name);
		if (this.activeFilters.nameOnly) return { name, document: name };

		const document = [
			item.name,
			item.generatedName,
			item.stickerText,
			...(item.tags || []),
			...(item.searchTerms || [])
		].map((value) => this.normalizeSearchText(value)).filter(Boolean).join(' ');
		return { name, document };
	}

	searchTermMatches(tokens, term) {
		return tokens.some((token) => token === term || (term.length >= 2 && token.startsWith(term)));
	}

	matchesSearch(item) {
		const query = this.normalizeSearchText(this.activeFilters.search);
		if (!query) return true;
		const { document } = this.getSearchText(item);
		const tokens = document.split(' ');
		return query.split(' ').every((term) => this.searchTermMatches(tokens, term));
	}

	getSearchScore(item) {
		const query = this.normalizeSearchText(this.activeFilters.search);
		if (!query) return 0;
		const terms = query.split(' ');
		const { name, document } = this.getSearchText(item);
		const nameTokens = name.split(' ');
		const documentTokens = document.split(' ');
		let score = 0;
		if (name === query) score += 100;
		else if (name.startsWith(query)) score += 60;
		score += terms.reduce((total, term) => {
			if (nameTokens.includes(term)) return total + 12;
			if (this.searchTermMatches(nameTokens, term)) return total + 8;
			if (documentTokens.includes(term)) return total + 3;
			return total + (this.searchTermMatches(documentTokens, term) ? 1 : 0);
		}, 0);
		return score;
	}

	matchesColors(item) {
		if (!item.tags) return false;

		const tags = item.tags.map((tag) => tag.toLowerCase());
		return [...this.activeFilters.colors].some(color =>
			this.getColorAliases(color).some((candidate) => tags.includes(candidate))
		);
	}

	matchesChildFilters(item) {
		return true; // Override in child classes
	}

	customizeItemElement(element, item) {
		// Override in child classes to add custom classes/attributes
	}

	createItemElement(item, onSelect = null) {
		const option = document.createElement('div');
		option.className = 'choice-card asset-option';
		option.title = item.name;

		// Set both data-id and data-index for compatibility
		option.dataset.id = item.id;

		// Allow children to add custom classes/attributes
		this.customizeItemElement(option, item);

		// Add image
		const img = document.createElement('img');
		img.src = item.thumbnailUrl || item.url;
		option.appendChild(img);

		// Wire up click handler (delegate to child)
		option.addEventListener('click', () => onSelect ? onSelect(item) : this.handleItemClick(item));

		return option;
	}

	handleItemClick(item) {
		throw new Error('handleItemClick() must be implemented by child class');
	}

	setupFilterChips() {
		// Override in child classes
	}

	getAllContent() {
		return [...this.content, ...this.userContent];
	}

	handleSearch(query) {
		this.activeFilters.search = query.toLowerCase().trim();
		this.browser.handleSearch(query);
		this.updateClearFiltersButton();
	}

	toggleFiltersUI(forceVisible = null) {
		if (!this.ui.filtersContainer || !this.ui.filterToggle) return;

		const isVisible = forceVisible == null
			? !this.ui.filtersContainer.classList.contains('visible')
			: Boolean(forceVisible);
		this.ui.filtersContainer.classList.toggle('visible', isVisible);
		this.ui.filterToggle.classList.toggle('active', isVisible);
		this.ui.filterToggle.setAttribute('aria-expanded', String(isVisible));
		this.ui.filterToggle.title = isVisible ? 'Close filters' : 'Open filters';

		const searchSection = this.ui.searchInput?.closest('.gallery-search-section');
		searchSection?.classList.toggle('filters-open', isVisible);
		searchSection?.classList.toggle('filters-returning', !isVisible);
		this.updateClearFiltersButton();

		const mobileManager = this.editor.mobileManager;
		if (!mobileManager?.isMobile || mobileManager.activeDrawer !== 'design') return;

		if (isVisible) {
			if (this.filterSheetHeight == null) this.filterSheetHeight = mobileManager.sheetHeight;
			mobileManager.setSheetHeight(85);
			return;
		}

		if (this.filterSheetHeight != null) {
			mobileManager.setSheetHeight(this.filterSheetHeight);
			this.filterSheetHeight = null;
		}
	}

	hasActiveFilters() {
		for (let key in this.activeFilters) {
			const val = this.activeFilters[key];
			if (key === 'nameOnly' && !this.activeFilters.search) continue;
			if (val instanceof Set) {
				if (val.size > 0) return true;
				continue; // an empty Set is not an active filter
			}
			if (key === 'animated' && val !== null) return true;
			if (val !== null && val !== '' && val !== false) return true;
		}

		return false;
	}

	updateClearFiltersButton() {
		const hasActive = this.hasActiveFilters();
		if (this.ui.clearFiltersBtn) this.ui.clearFiltersBtn.disabled = !hasActive;

		const filterCount = Object.entries(this.activeFilters).reduce((count, [key, value]) => {
			if (key === 'search') return count;
			if (key === 'nameOnly' && !this.activeFilters.search) return count;
			if (value instanceof Set) return count + value.size;
			if (key === 'animated') return count + (value !== null ? 1 : 0);
			return count + (value !== null && value !== '' && value !== false ? 1 : 0);
		}, 0);
		const searchSection = this.ui.searchInput?.closest('.glitter-search, .sticker-search');
		searchSection?.classList.toggle('has-active-search', Boolean(this.activeFilters.search));
		searchSection?.classList.toggle('has-active-filters', filterCount > 0);
		this.renderActiveFilterSummary();
		this.updateFilterResultsCount();

		if (this.ui.filterToggle) {
			const isOpen = this.ui.filtersContainer?.classList.contains('visible');
			this.ui.filterToggle.classList.toggle('has-active-filters', filterCount > 0);
			this.ui.filterToggle.title = filterCount > 0
				? `${isOpen ? 'Close' : 'Open'} filters — ${filterCount} active`
				: `${isOpen ? 'Close' : 'Open'} filters`;
		}
	}

	updateFilterResultsCount() {
		if (!this.ui.closeFiltersBtn) return;
		const count = this.applyFilters().length;
		this.ui.closeFiltersBtn.textContent = `Show ${count} result${count === 1 ? '' : 's'}`;
		this.ui.closeFiltersBtn.setAttribute('aria-label', `Close filters and show ${count} result${count === 1 ? '' : 's'}`);
	}

	getFilterKey(filterType) {
		return {
			color: 'colors',
			tone: 'tones',
			intensity: 'intensities',
			temperature: 'temperatures',
			special: 'special',
			category: 'categories',
			tag: 'tags',
			vibe: 'vibes',
			animated: 'animated'
		}[filterType] || null;
	}

	getColorAliases(color) {
		return {
			neutral: ['neutral', 'grayscale', 'black', 'white', 'gray'],
			earth: ['brown', 'beige', 'tan', 'cream'],
			metallic: ['silver', 'gold', 'bronze']
		}[color] || [color];
	}

	itemMatchesFacet(item, key, value) {
		if (key === 'animated') return item.isAnimated === value;
		if (key === 'categories') return item.category === value;
		const tags = (item.tags || []).map((tag) => tag.toLowerCase());
		if (key === 'colors') return this.getColorAliases(value).some((candidate) => tags.includes(candidate));
		return tags.includes(String(value).toLowerCase());
	}

	updateFacetAvailability() {
		const content = this.getAllContent();
		this.ui.filtersContainer?.querySelectorAll('.filter-chip').forEach((chip) => {
			const key = this.getFilterKey(chip.dataset.filter);
			if (!key) return;
			const value = key === 'animated'
				? chip.dataset.animated === 'true'
				: (chip.dataset.value || chip.dataset.color);
			const count = content.reduce((total, item) => total + (this.itemMatchesFacet(item, key, value) ? 1 : 0), 0);
			chip.hidden = count === 0;
			chip.dataset.count = String(count);
			const baseLabel = chip.dataset.filterLabel || chip.title || chip.textContent.trim();
			if (baseLabel) {
				chip.dataset.filterLabel = baseLabel;
				chip.title = `${baseLabel} (${count})`;
				chip.setAttribute('aria-label', `${baseLabel}, ${count} item${count === 1 ? '' : 's'}`);
			}
			chip.querySelector('.filter-chip-count')?.remove();
		});
	}

	syncFilterControls() {
		this.ui.filtersContainer?.querySelectorAll('.filter-chip').forEach((chip) => {
			const key = this.getFilterKey(chip.dataset.filter);
			const value = chip.dataset.value || chip.dataset.color;
			const active = key && this.activeFilters[key] instanceof Set
				? this.activeFilters[key].has(value)
				: (chip.dataset.filter === 'animated' && this.activeFilters.animated === (chip.dataset.animated === 'true'));
			chip.classList.toggle('active', Boolean(active));
			chip.setAttribute('aria-pressed', String(Boolean(active)));
		});
		if (this.ui.searchNameOnly) this.ui.searchNameOnly.checked = Boolean(this.activeFilters.nameOnly);
	}

	removeFilter(key, value = null) {
		if (!(key in this.activeFilters)) return;
		const active = this.activeFilters[key];
		if (active instanceof Set) active.delete(value);
		else if (key === 'animated') this.activeFilters.animated = null;
		else if (typeof active === 'boolean') this.activeFilters[key] = false;
		else this.activeFilters[key] = '';

		if (key === 'search') {
			if (this.ui.searchInput) this.ui.searchInput.value = '';
			this.browser.handleSearch('');
		}
		this.syncFilterControls();
		if (!this.activeFilters.search && this.browser.state === 'SEARCH_RESULTS') this.browser.setState('CATEGORY_LIST');
		else this.browser.refresh();
		this.updateClearFiltersButton();
	}

	renderActiveFilterSummary() {
		const summary = this.ui.activeFilterSummary;
		if (!summary) return;
		const filters = [];
		const labelAliases = { neutral: 'Neutrals', earth: 'Earth tones', metallic: 'Metallics' };
		const humanize = (value) => labelAliases[value] || String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
		if (this.activeFilters.search) filters.push({ key: 'search', label: `Search: “${this.ui.searchInput?.value.trim() || this.activeFilters.search}”` });
		Object.entries(this.activeFilters).forEach(([key, value]) => {
			if (key === 'search' || key === 'nameOnly') return;
			if (value instanceof Set) value.forEach((entry) => filters.push({ key, value: entry, label: humanize(entry) }));
			else if (key === 'animated' && value !== null) filters.push({ key, label: value ? 'Animated' : 'Static' });
			else if (value !== null && value !== '' && value !== false) filters.push({ key, label: humanize(value) });
		});
		if (this.activeFilters.search && this.activeFilters.nameOnly) filters.push({ key: 'nameOnly', label: 'Name only' });
		summary.replaceChildren(...filters.map((filter) => {
			const chip = document.createElement('button');
			chip.type = 'button';
			chip.className = 'active-filter-summary-chip';
			chip.setAttribute('aria-label', `Remove ${filter.label} filter`);
			const label = document.createElement('span');
			label.textContent = filter.label;
			const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			icon.setAttribute('class', 'icon');
			icon.setAttribute('aria-hidden', 'true');
			const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
			use.setAttribute('href', '#icon-x-mark');
			icon.appendChild(use);
			chip.append(label, icon);
			chip.addEventListener('click', () => this.removeFilter(filter.key, filter.value));
			return chip;
		}));
		summary.hidden = filters.length === 0;
	}

	clearFilters() {
		// Clear all filter values
		for (let key in this.activeFilters) {
			const val = this.activeFilters[key];

			if (val && val instanceof Set) {
				val.clear();
			} else if (typeof val === 'string') {
				this.activeFilters[key] = '';
			} else if (typeof val === 'boolean') {
				this.activeFilters[key] = false;
			} else {
				this.activeFilters[key] = null;
			}
		}

		// Name
		if (this.ui.searchNameOnly) this.ui.searchNameOnly.checked = false;

		// Clear search input
		if (this.ui.searchInput) {
			this.ui.searchInput.value = '';
		}

		this.syncFilterControls();

		// Re-render and update button state
		this.browser.handleSearch('');
		this.browser.setState('CATEGORY_LIST');

		this.updateClearFiltersButton();
	}
	// ===== UTILITY METHODS =====

	getItemById(id) {
		return this.content.find(item => item.id === id) ||
			this.userContent.find(item => item.id === id);
	}



	// ===== ABSTRACT METHODS (must be implemented by children) =====

	async loadContent() {
		throw new Error('loadContent() must be implemented by child class');
	}


}
