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

		this.browser = null;
		this.useBrowser = false; // Toggle for browser mode

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
			searchNameOnly: null
		};

		this.layerElements = new Map(); // layerId -> HTMLElement
	}

	async init() {
		this.setupUI();
		this.setupEventListeners();
		await this.loadContent();
		await this.initBrowser();
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

		// Clear filters button
		if (this.ui.clearFiltersBtn) {
			this.ui.clearFiltersBtn.addEventListener('click', () => {
				this.clearFilters();
			});
		}
		this.ui.clearActiveFiltersBtn?.addEventListener('click', () => this.clearFilters());

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
			colors: this.normalizeArrayValue(raw.colors, defaults.colors || []),
			generatedName: raw.generatedName ?? defaults.generatedName ?? null,
			brightness: raw.brightness ?? defaults.brightness ?? null,
			sortOrder: this.normalizeNumberValue(raw.sortOrder, defaults.sortOrder ?? 0),
			hue: raw.hue ?? defaults.hue ?? null,
			colorCodes,
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

	populateCategoryChips() {
		if (!this.ui.categoryChips || this.ui.categoryChips.children.length > 0) return;

		// Get unique categories
		const categories = new Set();
		[...this.content, ...this.userContent].forEach(sticker => {
			if (sticker.category) categories.add(sticker.category);
		});

		// Create chips
		Array.from(categories).forEach(category => {
			const chip = document.createElement('div');
			chip.className = 'filter-chip text-filter-chip';
			chip.dataset.value = category;  // Changed from dataset.category
			chip.dataset.filter = 'category';
			chip.textContent = category.charAt(0).toUpperCase() + category.slice(1);
			chip.title = category;

			chip.addEventListener('click', () => this.toggleFilterChip(chip));

			this.ui.categoryChips.appendChild(chip);
		});
	}

	clearElements() {
		this.layerElements.forEach((element, layerId) => {
			if (element.parentNode) {
				element.parentNode.removeChild(element);
			}
		});
		this.layerElements.clear();
	}

	renderContent(layersToShow) {
		const layerType = this.getLayerType();
		// Clear existing elements for this content type
		this.clearElements();

		layersToShow.forEach(layer => {
			if (layer.type === layerType) {
				this.renderLayer(layer);
			}
		});
	}

	// ===== SEARCH & FILTERS =====

	toggleFilterChip(chip) {
		const filterType = chip.dataset.filter; // 'color', 'tone', 'special', 'category', 'tags'
		const value = chip.dataset.value || chip.dataset.color;

		// Map filter types to activeFilters properties
		const filterMap = {
			'color': 'colors',
			'tone': 'tones',
			'special': 'special',
			'category': 'categories',
			'tag': 'tags',
			'vibe': 'vibes'
		};

		const filterKey = filterMap[filterType];
		if (!filterKey || !this.activeFilters[filterKey]) {
			console.warn(`Unknown filter type: ${filterType}`);
			return;
		}

		// Toggle chip active state
		chip.classList.toggle('active');

		// Update the corresponding filter Set
		const filterSet = this.activeFilters[filterKey];
		if (filterSet.has(value)) {
			filterSet.delete(value);
		} else {
			filterSet.add(value);
		}

		// Re-render and update UI
		this.browser.refresh();

		this.updateClearFiltersButton();
	}

	applyFilters() {
		const allContent = this.getAllContent();

		return allContent.filter(item => {
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
	}

	matchesSearch(item) {
		const query = this.activeFilters.search.toLowerCase();
		const name = item.name.toLowerCase();

		if (this.activeFilters.nameOnly) {
			return name.includes(query);
		} else {
			const tagsString = (item.tags || []).join(' ').toLowerCase();
			return name.includes(query) || tagsString.includes(query);
		}
	}

	matchesColors(item) {
		if (!item.tags) return false;

		return [...this.activeFilters.colors].some(color =>
			item.tags.some(tag => tag.toLowerCase() === color.toLowerCase())
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
		option.className = 'asset-option';
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

	toggleFiltersUI() {
		if (!this.ui.filtersContainer || !this.ui.filterToggle) return;

		const isVisible = this.ui.filtersContainer.classList.toggle('visible');
		this.ui.filterToggle.classList.toggle('active', isVisible);
	}

	hasActiveFilters() {
		for (let key in this.activeFilters) {
			const val = this.activeFilters[key];
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
		if (this.ui.clearActiveFiltersBtn) this.ui.clearActiveFiltersBtn.hidden = !hasActive;

		const filterCount = Object.entries(this.activeFilters).reduce((count, [key, value]) => {
			if (key === 'search') return count;
			if (value instanceof Set) return count + value.size;
			if (key === 'animated') return count + (value !== null ? 1 : 0);
			return count + (value !== null && value !== '' && value !== false ? 1 : 0);
		}, 0);
		const searchSection = this.ui.searchInput?.closest('.glitter-search, .sticker-search');
		searchSection?.classList.toggle('has-active-search', Boolean(this.activeFilters.search));
		searchSection?.classList.toggle('has-active-filters', filterCount > 0);
		this.renderActiveFilterSummary();

		if (this.ui.filterToggle) {
			this.ui.filterToggle.classList.toggle('has-active-filters', filterCount > 0);
			this.ui.filterToggle.title = filterCount > 0
				? `${filterCount} active filter${filterCount === 1 ? '' : 's'}`
				: 'Toggle filters';
		}
	}

	renderActiveFilterSummary() {
		const summary = this.ui.activeFilterSummary;
		if (!summary) return;
		const labels = [];
		const humanize = (value) => String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
		if (this.activeFilters.search) labels.push(`Search: “${this.ui.searchInput?.value.trim() || this.activeFilters.search}”`);
		Object.entries(this.activeFilters).forEach(([key, value]) => {
			if (key === 'search' || key === 'nameOnly') return;
			if (value instanceof Set) value.forEach((entry) => labels.push(humanize(entry)));
			else if (key === 'animated' && value !== null) labels.push(value ? 'Animated' : 'Static');
			else if (value !== null && value !== '' && value !== false) labels.push(humanize(value));
		});
		if (this.activeFilters.nameOnly) labels.push('Name only');
		summary.replaceChildren(...labels.map((label) => {
			const chip = document.createElement('span');
			chip.className = 'active-filter-summary-chip';
			chip.textContent = label;
			return chip;
		}));
		summary.hidden = labels.length === 0;
	}

	clearFilters() {
		// Clear all filter values
		for (let key in this.activeFilters) {
			const val = this.activeFilters[key];

			if (val && val instanceof Set) {
				val.clear();
			} else if (typeof val === 'string') {
				this.activeFilters[key] = '';
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

		// Clear all active filter chips in the panel
		if (this.ui.filtersContainer) {
			this.ui.filtersContainer.querySelectorAll('.filter-chip').forEach(chip => {
				chip.classList.remove('active');
			});
		}

		// Re-render and update button state
		this.browser.setState('CATEGORY_LIST');

		this.updateClearFiltersButton();

		// Close filter drawer
		if (this.ui.filtersContainer) {
			this.ui.filtersContainer.classList.remove('visible');
		}
		if (this.ui.filterToggle) {
			this.ui.filterToggle.classList.remove('active');
		}
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
