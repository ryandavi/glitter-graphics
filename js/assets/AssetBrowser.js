// ============================================
// ASSET BROWSER CLASS
// One Library kind's browser (ASSET_BROWSERS entry): category folders or a
// grouped listing, search results, the Recent strip and the Favorites
// pseudo-category. Items come from its ContentManager.
// ============================================

// Favorites is a pseudo-category: never a real category id, never saved in
// projects (favorites live in PREFERENCES).
const LIBRARY_FAVORITES_ID = '__favorites';

class AssetBrowser {
	constructor(contentManager, prefix) {
		const schema = getAssetBrowserSchema(prefix);
		const elementIds = getAssetBrowserElementIds(prefix);
		this.contentManager = contentManager;
		this.prefix = prefix;
		this.displayName = schema.title;
		this.layout = schema.layout || 'folders';
		this.state = 'CATEGORY_LIST';
		this.currentCategoryId = null;
		this.currentOffset = 0;
		this.batchSize = 20;
		this.searchDebounceTimer = null;

		this.categories = [];
		this.categoriesRendered = false;

		// HTML element references
		this.elements = {
			browser: document.getElementById(elementIds.browser),
			backBtn: document.getElementById(elementIds.backBtn),
			title: document.getElementById(elementIds.title),
			content: document.getElementById(elementIds.content),
			categoryGrid: document.getElementById(elementIds.categoryGrid),
			searchResults: document.getElementById(elementIds.searchResults),
			itemGrid: document.getElementById(elementIds.itemGrid),
			sentinel: document.getElementById(elementIds.sentinel),
			emptyState: document.getElementById(elementIds.emptyState),
			emptyText: document.getElementById(elementIds.emptyText),
			emptyClearFilters: document.getElementById(elementIds.emptyState)?.querySelector('.property-empty-action')
		};
		this.collectionInfo = document.createElement('div');
		this.collectionInfo.className = 'asset-browser-collection-info';
		this.collectionInfo.hidden = true;
		this.elements.itemGrid.before(this.collectionInfo);
		this.recentLead = document.createElement('div');
		this.recentLead.className = 'asset-browser-recent';
		this.recentLead.hidden = true;
		this.elements.categoryGrid.before(this.recentLead);
		this.indexLead = document.createElement('div');
		this.indexLead.className = 'asset-browser-index-lead';
		this.indexLead.hidden = true;
		this.elements.categoryGrid.before(this.indexLead);

		// Store parent containers
		this.assetOptions = this.elements.browser.closest('.asset-options');
		this.scrollContainer = this.elements.browser.closest('.asset-options'); // The actual scrollable element // this.elements.content; //

		this.observer = null;
	}

	// `categories` is a categories JSON path, or the category list itself when
	// the kind derives it from its own manifest (fonts, shapes).
	async init(categories) {
		if (Array.isArray(categories)) this.categories = categories;
		else await this.loadCategories(categories);
		this.setupIntersectionObserver();
		this.setupEventListeners();
		this.setState('CATEGORY_LIST');

		// Show browser
		this.elements.browser.classList.add('visible');
	}

	async loadCategories(path) {
		try {
			const response = await fetch(path);
			this.categories = await response.json();
			dbg('[Browser] Loaded categories:', this.categories);
		} catch (error) {
			console.error('Failed to load categories:', error);
			this.categories = [];
		}
	}

	setupIntersectionObserver() {
		this.observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && this.isPagedState()) {
					dbg('[Browser] Sentinel intersecting, loading more...');
					this.loadMoreItems();
				}
			},
			{
				root: this.scrollContainer, // Use the actual scroll container
				rootMargin: '200px',
				threshold: 0
			}
		);

		this.observer.observe(this.elements.sentinel);
	}

	setupEventListeners() {
		this.elements.emptyClearFilters?.addEventListener('click', () => this.contentManager.clearFilters());
		this.elements.backBtn.addEventListener('click', () => {
			// If in search, clear the search input which will trigger return to category list
			if (this.state === 'SEARCH_RESULTS') {
				const searchInput = this.contentManager.ui.searchInput;
				if (searchInput) {
					searchInput.value = '';
					this.contentManager.activeFilters.search = '';
				}
				this.contentManager.updateClearFiltersButton();
			}

			this.setState('CATEGORY_LIST');

			// Scroll to top when changing states
			if (this.scrollContainer) {
				this.scrollContainer.scrollTop = 0;
			}


		});
	}

	navigateToCategory(categoryId) {
		if (!categoryId || !this.categories.some((category) => category.id === categoryId)) return false;
		const searchInput = this.contentManager.ui.searchInput;
		if (searchInput) searchInput.value = '';
		this.contentManager.activeFilters.search = '';
		this.contentManager.updateClearFiltersButton();
		this.setState('CATEGORY_DETAIL', categoryId);
		return true;
	}

	// ===== STATE MANAGEMENT =====

	// Search results, and a grouped kind's category list, are one listing of
	// items under category headings.
	isListingState() {
		return this.state === 'SEARCH_RESULTS' || (this.state === 'CATEGORY_LIST' && this.layout === 'grouped');
	}

	isPagedState() {
		return this.state === 'CATEGORY_DETAIL' || this.isListingState();
	}

	setState(newState, categoryId = null) {
		this.state = newState;
		this.currentCategoryId = categoryId;
		this.currentOffset = 0;

		// Update data attribute on parent
		if (this.assetOptions) {
			this.assetOptions.dataset.browserState = newState.toLowerCase().replace('_', '-');
		}

		// Scroll to top when changing states
		if (this.scrollContainer) {
			this.scrollContainer.scrollTop = 0;
		}

		this.render();
	}

	render() {
		// Hide all content containers first
		this.elements.emptyState.classList.remove('visible');
		this.elements.categoryGrid.classList.remove('visible');
		this.elements.searchResults.classList.remove('visible');
		this.elements.itemGrid.classList.remove('visible');
		this.collectionInfo.hidden = true;
		this.indexLead.hidden = true;
		this.recentLead.hidden = true;

		if (this.state === 'CATEGORY_LIST') {
			this.renderCategoryList();
		} else if (this.state === 'CATEGORY_DETAIL') {
			this.renderCategoryDetail();
		} else if (this.state === 'SEARCH_RESULTS') {
			this.renderSearchResults();
		}
	}

	refresh() {
		this.currentOffset = 0;
		this.elements.itemGrid.innerHTML = '';
		this.elements.searchResults.innerHTML = '';

		// If on category list, just update counts instead of recreating
		if (this.state === 'CATEGORY_LIST' && this.layout === 'folders' && this.categoriesRendered) {
			this.updateCategoryCounts();
		} else {
			this.render();
		}
	}

	// A favorite was added or removed: the category list shows the Favorites
	// folder or group, so redraw it. An open Favorites folder keeps its items
	// until it is reopened, so un-hearting doesn't pull a card from under the
	// pointer.
	handleFavoritesChanged() {
		if (this.state !== 'CATEGORY_LIST') return;
		if (this.layout === 'grouped') this.render();
		else this.updateCategoryCounts();
	}

	async navigateToItem(itemId) {
		// Find which category contains this item
		const allItems = this.contentManager.getAllContent();
		const item = allItems.find(i => i.id === itemId);

		if (!item) {
			console.warn('[Browser] Item not found:', itemId);
			return;
		}

		// Source navigation must reveal the requested asset even when the current
		// gallery filters exclude it.
		if (!this.getFilteredItems().includes(item)) {
			this.contentManager.clearFilters({ refreshBrowser: false });
		}

		// A grouped kind lists everything; a folder kind opens the item's folder.
		if (this.layout === 'grouped') this.setState('CATEGORY_LIST');
		else this.setState('CATEGORY_DETAIL', item.category);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 50));

		// Load items until we find our target
		await this.loadUntilItemFound(item);

		// Scroll to the item
		this.scrollToItem(item);
	}

	// The item's card in its home category (a grouped listing can also show it
	// under Favorites).
	findItemElement(item) {
		const selector = `[data-id="${CSS.escape(String(item.id))}"]`;
		if (!this.isListingState()) return this.elements.itemGrid.querySelector(selector);
		const section = this.elements.searchResults.querySelector(
			`.category-section[data-category-id="${CSS.escape(String(item.category))}"]`
		);
		return section?.querySelector(selector) || null;
	}

	async loadUntilItemFound(item) {
		const maxAttempts = 50; // Prevent infinite loop
		let attempts = 0;

		while (attempts < maxAttempts) {
			if (this.findItemElement(item)) return;

			// If we've loaded everything, stop
			if (this.currentOffset >= this.getPagedItemCount()) {
				console.warn('[Browser] Item not found after loading all items');
				return;
			}

			this.loadNextBatch();

			// Wait for render
			await new Promise(resolve => setTimeout(resolve, 50));
			attempts++;
		}
	}

	scrollToItem(item) {
		const element = this.findItemElement(item);
		if (!element) {
			console.warn('[Browser] Could not scroll to item:', item.id);
			return;
		}

		// Scroll into view
		element.scrollIntoView({
			behavior: 'smooth',
			block: 'center'
		});

		// Highlight effect
		element.classList.add('highlight');
		setTimeout(() => {
			element.classList.remove('highlight');
		}, 1000);
	}

	// ===== CATEGORY LIST VIEW =====

	renderCategoryList() {
		// Update header
		this.elements.backBtn.disabled = true;
		this.elements.title.textContent = this.displayName;
		this._renderRecentLead();
		this._renderIndexLead();

		if (this.layout === 'grouped') {
			this.elements.searchResults.classList.add('visible');
			this.elements.searchResults.innerHTML = '';
			this.currentOffset = 0;
			this.loadListingItems();
			return;
		}

		// Show category grid
		this.elements.categoryGrid.classList.add('visible');

		// Only render categories once, then just update counts
		if (!this.categoriesRendered) {
			this.populateCategoryCards();
			this.categoriesRendered = true;
		} else {
			this.updateCategoryCounts();
		}
	}

	// The last picks, newest first. Rebuilt only when the list is drawn, so a
	// pick never reshuffles the strip under the pointer.
	_renderRecentLead() {
		const filtered = new Set(this.getFilteredItems());
		const recent = this.contentManager.getRecentItems().filter((item) => filtered.has(item));
		this.recentLead.replaceChildren();
		if (!recent.length) { this.recentLead.hidden = true; return; }
		const heading = document.createElement('h3');
		heading.className = 'asset-browser-section-title property-block-title';
		heading.textContent = 'Recent';
		const grid = document.createElement('div');
		grid.className = 'asset-grid visible asset-browser-recent-grid';
		recent.forEach((item) => grid.appendChild(this.createItemElement(item)));
		this.recentLead.append(heading, grid);
		this.recentLead.hidden = false;
		this.contentManager.updateSelection?.();
	}

	_renderIndexLead() {
		this.indexLead.replaceChildren();
		const lead = this.contentManager.createCollectionIndexLead?.();
		if (!lead) { this.indexLead.hidden = true; return; }
		this.indexLead.appendChild(lead);
		this.indexLead.hidden = false;
		this.contentManager.updateSelection?.();
	}

	hasLeadItems() {
		return Boolean(this.indexLead.querySelector('.asset-option') || this.recentLead.querySelector('.asset-option'));
	}

	getFavoritesCategory(items = this.getFilteredItems()) {
		const favorites = this.getCategoryItems(LIBRARY_FAVORITES_ID, items);
		if (!favorites.length) return null;
		return {
			id: LIBRARY_FAVORITES_ID,
			name: 'Favorites',
			icon: favorites[0].thumbnailUrl || favorites[0].url,
			count: favorites.length
		};
	}

	populateCategoryCards() {
		// Clear grid
		this.elements.categoryGrid.innerHTML = '';

		const filteredItems = this.getFilteredItems();
		const categoryCounts = this.getCategoryCounts(filteredItems);

		let hasCategories = false;
		const favorites = this.getFavoritesCategory(filteredItems);
		if (favorites) {
			hasCategories = true;
			this.elements.categoryGrid.appendChild(this.createCategoryCard(favorites, favorites.count));
		}
		this.categories.forEach(category => {
			const count = categoryCounts[category.id] || 0;
			if (count === 0) return;

			hasCategories = true;
			const card = this.createCategoryCard(category, count);
			this.elements.categoryGrid.appendChild(card);
		});

		// Show empty state if no categories
		if (!hasCategories) {
			this.elements.categoryGrid.classList.remove('visible');
			if (!this.hasLeadItems()) this.showEmptyState('No items found');
		}
	}

	updateCategoryCounts() {
		this._renderRecentLead();
		this._renderIndexLead();
		// Make sure we're showing the right container
		this.elements.emptyState.classList.remove('visible');
		this.elements.searchResults.classList.remove('visible');
		this.elements.itemGrid.classList.remove('visible');
		this.elements.categoryGrid.classList.add('visible');

		const filteredItems = this.getFilteredItems();
		const categoryCounts = this.getCategoryCounts(filteredItems);

		// Favorites changes its cover and count as hearts change: rebuild it.
		this.elements.categoryGrid.querySelector(`.category-card[data-category-id="${LIBRARY_FAVORITES_ID}"]`)?.remove();
		const favorites = this.getFavoritesCategory(filteredItems);
		let hasVisibleCategories = Boolean(favorites);
		if (favorites) this.elements.categoryGrid.prepend(this.createCategoryCard(favorites, favorites.count));

		// Update existing cards and track which categories are already rendered
		const renderedCategories = new Set();
		this.elements.categoryGrid.querySelectorAll('.category-card').forEach(card => {
			const categoryId = card.dataset.categoryId;
			if (categoryId === LIBRARY_FAVORITES_ID) return;
			renderedCategories.add(categoryId);
			const count = categoryCounts[categoryId] || 0;
			const countEl = card.querySelector('.category-card-count');

			if (count === 0) {
				card.style.display = 'none';
			} else {
				card.style.display = '';
				countEl.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
				hasVisibleCategories = true;
			}
		});

		// Add cards for new categories that now have items
		this.categories.forEach(category => {
			const count = categoryCounts[category.id] || 0;

			// If this category has items but no card yet, create one
			if (count > 0 && !renderedCategories.has(category.id)) {
				const card = this.createCategoryCard(category, count);
				this.elements.categoryGrid.appendChild(card);
				hasVisibleCategories = true;
			}
		});

		// Show empty state if no visible categories
		if (!hasVisibleCategories) {
			this.elements.categoryGrid.classList.remove('visible');
			if (!this.hasLeadItems()) this.showEmptyState('No items found');
		}
	}

	createCategoryCard(category, count) {
		const card = tplClone('tpl-category-card');
		card.dataset.categoryId = category.id;
		if (category.color) card.style.setProperty('--category-color', category.color);
		card.classList.toggle('is-favorites', category.id === LIBRARY_FAVORITES_ID);

		// Glitter categories tile their icon as a repeating background; every
		// other library shows it as a contained thumbnail.
		const image = card.querySelector('.category-card-image');
		if (this.prefix === 'glitter') {
			image.classList.add('category-card-glitter-bg');
			image.style.backgroundImage = `url('${category.icon}')`;
		} else if (category.icon) {
			const img = document.createElement('img');
			img.src = category.icon;
			img.draggable = false;
			img.alt = category.name;
			image.appendChild(img);
		}

		card.querySelector('.category-card-name').textContent = category.name;
		card.querySelector('.category-card-count').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
		if (category.id !== LIBRARY_FAVORITES_ID) this.contentManager.customizeCollectionCard?.(card, category);

		card.addEventListener('click', () => {
			this.setState('CATEGORY_DETAIL', category.id);
		});

		return card;
	}

	getCategoryCounts(items) {
		const counts = {};
		items.forEach(item => {
			const catId = item.category;
			counts[catId] = (counts[catId] || 0) + 1;
		});
		return counts;
	}

	getCategoryItems(categoryId, items = this.getFilteredItems()) {
		if (categoryId === LIBRARY_FAVORITES_ID) return this.contentManager.getFavoriteItems(items);
		return items.filter((item) => item.category === categoryId);
	}

	getCategoryById(categoryId) {
		if (categoryId === LIBRARY_FAVORITES_ID) return { id: LIBRARY_FAVORITES_ID, name: 'Favorites' };
		return this.categories.find((category) => category.id === categoryId) || null;
	}

	// ===== CATEGORY DETAIL VIEW =====

	renderCategoryDetail() {
		const category = this.getCategoryById(this.currentCategoryId);
		if (!category) {
			this.setState('CATEGORY_LIST');
			return;
		}

		// Update header
		this.elements.backBtn.disabled = false;
		this.elements.title.textContent = category.name;
		this.collectionInfo.replaceChildren();
		if (category.description) {
			const description = document.createElement('p');
			description.className = 'asset-browser-collection-description';
			description.textContent = category.description;
			this.collectionInfo.appendChild(description);
		}
		const info = category.id === LIBRARY_FAVORITES_ID ? null : this.contentManager.createCollectionInfo?.(category);
		if (info) this.collectionInfo.appendChild(info);
		this.collectionInfo.hidden = !this.collectionInfo.childElementCount;

		// Show item grid
		this.elements.itemGrid.classList.add('visible');

		// Clear and load
		this.elements.itemGrid.innerHTML = '';
		this.currentOffset = 0;

		// Initial load with viewport check
		this.loadCategoryItems();
	}

	// ===== SEARCH RESULTS VIEW =====

	renderSearchResults() {
		// Update header
		this.elements.backBtn.disabled = false;
		const query = this.contentManager.activeFilters.search;
		const resultCount = this.getFilteredItems().length;
		this.elements.title.textContent = `${resultCount} result${resultCount === 1 ? '' : 's'} for “${query}”`;
		this.elements.title.setAttribute('aria-live', 'polite');

		// Show search results container
		this.elements.searchResults.classList.add('visible');

		// Clear and load
		this.elements.searchResults.innerHTML = '';
		this.currentOffset = 0;
		this.loadListingItems();
	}

	handleSearch(query) {
		clearTimeout(this.searchDebounceTimer);

		this.searchDebounceTimer = setTimeout(() => {
			if (query && query.trim() !== '') {
				this.setState('SEARCH_RESULTS');
			} else {
				this.setState('CATEGORY_LIST');
			}
		}, 300);
	}

	// ===== LAZY LOADING =====

	getPagedItemCount() {
		if (this.state === 'CATEGORY_DETAIL') return this.getCategoryItems(this.currentCategoryId).length;
		if (this.isListingState()) return this.getListingItems().length;
		return 0;
	}

	loadNextBatch() {
		if (this.state === 'CATEGORY_DETAIL') this.loadCategoryItems();
		else if (this.isListingState()) this.loadListingItems();
	}

	loadMoreItems() {
		if (this.currentOffset < this.getPagedItemCount()) this.loadNextBatch();
	}

	loadCategoryItems() {
		const categoryItems = this.getCategoryItems(this.currentCategoryId);
		const batch = categoryItems.slice(this.currentOffset, this.currentOffset + this.batchSize);

		if (batch.length === 0 && this.currentOffset === 0) {
			this.elements.itemGrid.classList.remove('visible');
			this.showEmptyState('No items in this category');
			return;
		}

		if (batch.length === 0) {
			return; // No more items to load
		}

		batch.forEach(item => {
			const element = this.createItemElement(item);
			this.elements.itemGrid.appendChild(element);
		});

		this.currentOffset += batch.length;

		// Update selection state for newly rendered items
		this.contentManager.updateSelection();

		// Check if we need to load more to fill viewport
		this.checkAndLoadMore();
	}

	checkAndLoadMore() {
		// Wait for DOM to update
		requestAnimationFrame(() => {
			const sentinelRect = this.elements.sentinel.getBoundingClientRect();
			const scrollRect = this.scrollContainer.getBoundingClientRect();

			// Check if sentinel is within viewport + buffer zone (like our IntersectionObserver rootMargin)
			const bufferZone = 400; // Load until sentinel is well beyond viewport
			const isSentinelNearViewport = sentinelRect.top < (scrollRect.bottom + bufferZone);

			// If sentinel is within our buffer zone, keep loading
			if (isSentinelNearViewport && this.isPagedState() && this.currentOffset < this.getPagedItemCount()) {
				this.loadNextBatch(); // This will recursively call checkAndLoadMore again
			}
		});
	}

	// Listing groups in display order. Search keeps result-score order (groups
	// in first-appearance order); a grouped category list follows the category
	// order, with Favorites first.
	getListingGroups() {
		const items = this.getFilteredItems();
		const byCategory = new Map();
		items.forEach((item) => {
			if (!byCategory.has(item.category)) byCategory.set(item.category, []);
			byCategory.get(item.category).push(item);
		});

		const group = (id, groupItems) => ({ id, name: this.getCategoryById(id)?.name || id, items: groupItems });
		if (this.state === 'SEARCH_RESULTS') {
			return [...byCategory.entries()].map(([id, groupItems]) => group(id, groupItems));
		}

		const groups = [];
		const favorites = this.getCategoryItems(LIBRARY_FAVORITES_ID, items);
		if (favorites.length) groups.push(group(LIBRARY_FAVORITES_ID, favorites));
		this.categories.forEach((category) => {
			if (byCategory.has(category.id)) groups.push(group(category.id, byCategory.get(category.id)));
		});
		byCategory.forEach((groupItems, id) => {
			if (!this.categories.some((category) => category.id === id)) groups.push(group(id, groupItems));
		});
		return groups;
	}

	getListingItems(groups = this.getListingGroups()) {
		return groups.flatMap((entry) => entry.items.map((item) => ({ item, group: entry })));
	}

	loadListingItems() {
		const groups = this.getListingGroups();
		const entries = this.getListingItems(groups);

		if (entries.length === 0) {
			this.elements.searchResults.classList.remove('visible');
			if (this.state === 'SEARCH_RESULTS' || !this.hasLeadItems()) {
				this.showEmptyState(this.state === 'SEARCH_RESULTS' ? 'No results found' : 'No items found');
			}
			return;
		}

		// A grouped kind is a small collection: its category list renders whole.
		const size = this.state === 'CATEGORY_LIST' ? entries.length : this.batchSize;
		const batch = entries.slice(this.currentOffset, this.currentOffset + size);

		if (batch.length === 0) {
			return; // No more items
		}

		let currentGroupId = null;
		let currentGrid = null;

		batch.forEach(({ item, group }) => {
			if (group.id !== currentGroupId) {
				currentGroupId = group.id;
				let section = this.elements.searchResults.querySelector(`.category-section[data-category-id="${CSS.escape(String(group.id))}"]`);

				if (!section) {
					section = document.createElement('div');
					section.className = 'category-section';
					section.dataset.categoryId = group.id;

					const header = document.createElement('div');
					header.className = 'category-section-header';
					header.textContent = `${group.name} (${group.items.length})`;
					section.appendChild(header);

					const grid = document.createElement('div');
					grid.className = 'asset-grid visible';
					section.appendChild(grid);

					this.elements.searchResults.appendChild(section);
				}
				currentGrid = section.querySelector('.asset-grid');
			}

			currentGrid.appendChild(this.createItemElement(item));
		});

		this.currentOffset += batch.length;

		// Update selection state for newly rendered items
		this.contentManager.updateSelection();

		// Check if we need to load more
		this.checkAndLoadMore();
	}

	showEmptyState(message) {
		this.elements.emptyText.textContent = message;
		if (this.elements.emptyClearFilters) {
			this.elements.emptyClearFilters.hidden = this.state === 'CATEGORY_DETAIL' || !this.contentManager.hasActiveFilters();
		}
		this.elements.emptyState.classList.add('visible');
	}

	// ===== INTEGRATION CALLBACKS =====

	getFilteredItems() {
		return this.contentManager.applyFilters();
	}

	createItemElement(item) {
		return this.contentManager.createItemElement(item);
	}
}
