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

		// ADD THIS:
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
			gridContainer: null,
			emptyState: null,
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
    
    // Initialize browser if enabled
    if (this.useBrowser) {
        await this.initBrowser();
    } else {
        this.renderPicker();
    }
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

		// Name Only Checkbox
		if (this.ui.searchNameOnly) {
			this.ui.searchNameOnly.addEventListener('change', (e) => {
				this.activeFilters.nameOnly = e.target.checked;
				this.renderPicker();
				this.updateClearFiltersButton();
			});
		}

		// Child classes can add more listeners by overriding and calling super.setupEventListeners()
	}


	getLayerType() {
		return null;
	}

scrollToContent(contentId) {
	if (this.browser) {
		// Use browser's navigation
		this.browser.navigateToItem(contentId);
	} else {
		// Fallback to old method
		if (!this.ui.gridContainer) return;

		const assetOption = this.ui.gridContainer.querySelector(`.asset-option[data-id="${contentId}"]`);
		if (!assetOption) {
			console.warn(`${this.getLayerType?.() ?? 'Layer'} with id ${contentId} not found in picker`);
			return;
		}

		assetOption.scrollIntoView({
			behavior: 'smooth',
			block: 'center'
		});

		assetOption.classList.add('highlight');
		setTimeout(() => {
			assetOption.classList.remove('highlight');
		}, 1000);
	}
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
		if (this.browser) {
			this.browser.refresh();
		} else {
			this.renderPicker();
		}
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

	createItemElement(item) {
		const option = document.createElement('div');
		option.className = 'asset-option';
		option.title = item.name;

		// Set both data-id and data-index for compatibility
		option.dataset.id = item.id;

		// Allow children to add custom classes/attributes
		this.customizeItemElement(option, item);

		// Add image
		const img = document.createElement('img');
		img.src = item.url;
		option.appendChild(img);

		// Wire up click handler (delegate to child)
		option.addEventListener('click', () => {
			this.handleItemClick(item);
		});

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

		if (this.browser) {
			this.browser.handleSearch(query);
		} else {
			this.renderPicker();
		}

		this.updateClearFiltersButton();
	}

	toggleFiltersUI() {
		if (!this.ui.filtersContainer || !this.ui.filterToggle) return;

		const isVisible = this.ui.filtersContainer.classList.toggle('visible');
		this.ui.filterToggle.classList.toggle('active', isVisible);
	}

	hasActiveFilters() {
		// Check if any filters are active
		if (this.activeFilters.search !== '') return true;

		for (let key in this.activeFilters) {
			const val = this.activeFilters[key];
			if (val instanceof Set && val.size > 0) return true;
			if (val !== null && val !== '' && val !== false) return true;
		}

		return false;
	}

	updateClearFiltersButton() {
		if (!this.ui.clearFiltersBtn) return;
		this.ui.clearFiltersBtn.disabled = !this.hasActiveFilters();
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
		if (this.browser) {
			this.browser.setState('CATEGORY_LIST'); // CHANGED: Reset to category list
		} else {
			this.renderPicker();
		}
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

	updatePickerVisibility(visibleCount) {
		if (!this.ui.gridContainer) return;

		const hasContent = visibleCount > 0;

		if (this.ui.emptyState) {
			this.ui.emptyState.classList.toggle('visible', !hasContent);
		}

		this.ui.gridContainer.classList.toggle('visible', hasContent);
	}



	// ===== PICKER RENDERING =====

	renderPicker() {
		if (!this.ui.gridContainer) return;
		this.ui.gridContainer.innerHTML = '';

		// Get filtered content
		const filteredContent = this.applyFilters();

		// Group by category
		const categories = this.groupByCategory(filteredContent);

		// Sort categories - User Uploads first, then alphabetically
		const sortedCategories = Object.entries(categories).sort(([catA], [catB]) => {
			if (catA === 'User Uploads') return -1;
			if (catB === 'User Uploads') return 1;
			return catA.localeCompare(catB);
		});

		// Render each category
		sortedCategories.forEach(([category, items]) => {
			const categoryDiv = this.createCategoryElement(category);
			const grid = categoryDiv.querySelector('.asset-grid');

			items.forEach(item => {
				const option = this.createItemElement(item);
				grid.appendChild(option);
			});

			this.ui.gridContainer.appendChild(categoryDiv);
		});

		// Update visibility
		this.updatePickerVisibility(filteredContent.length);
	}

	groupByCategory(items) {
		const categories = {};
		items.forEach(item => {
			const category = item.category || 'Uncategorized';
			if (!categories[category]) {
				categories[category] = [];
			}
			categories[category].push(item);
		});
		return categories;
	}

	createCategoryElement(categoryName) {
		const categoryDiv = document.createElement('div');
		categoryDiv.className = 'asset-category';
		categoryDiv.dataset.category = categoryName;

		const title = document.createElement('div');
		title.className = 'category-title';
		title.textContent = categoryName;
		categoryDiv.appendChild(title);

		const grid = document.createElement('div');
		grid.className = 'asset-grid';
		categoryDiv.appendChild(grid);

		return categoryDiv;
	}

	// ===== ABSTRACT METHODS (must be implemented by children) =====

	async loadContent() {
		throw new Error('loadContent() must be implemented by child class');
	}


}