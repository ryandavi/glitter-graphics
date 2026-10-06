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
		this.schema = schema;
		this.browseView = 'style';
		this.currentCreatorId = null;
		this.setOrigin = null;
		this.state = 'CATEGORY_LIST';
		this.currentCategoryId = null;
		this.currentOffset = 0;
		this.batchSize = 20;
		this.searchDebounceTimer = null;

		this.categories = [];

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
		// Assets the open project already uses, for "match the other one".
		// Same one-row strip as Recent.
		this.projectLead = document.createElement('div');
		this.projectLead.className = 'asset-browser-recent asset-browser-project';
		this.projectLead.hidden = true;
		this.elements.categoryGrid.before(this.projectLead);
		// Each strip is one row: as many items as the panel width fits.
		const fitRows = () => this._fitLeadRows();
		new ResizeObserver(fitRows).observe(this.recentLead);
		new ResizeObserver(fitRows).observe(this.projectLead);
		this.indexLead = document.createElement('div');
		this.indexLead.className = 'asset-browser-index-lead';
		this.indexLead.hidden = true;
		this.elements.categoryGrid.before(this.indexLead);

		this.carriedLead = document.createElement('div');
		this.carriedLead.className = 'asset-browser-carried';
		this.carriedLead.hidden = true;
		this.elements.itemGrid.after(this.carriedLead);
		this.viewControl = document.createElement('div');
		this.viewControl.className = 'segmented-control asset-browser-views';
		this.viewControl.setAttribute('aria-label', 'Browse library by');
		this.viewControl.hidden = true;
		for (const [view, label] of [['style', 'Style'], ['creator', 'Creator']]) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'segmented-option';
			button.textContent = label;
			button.dataset.view = view;
			button.addEventListener('click', () => { this.browseView = view; this.setOrigin = null; this.setState('CATEGORY_LIST'); });
			this.viewControl.appendChild(button);
		}
		this.elements.content.before(this.viewControl);

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
		// Arrow keys move between cards; Enter or Space picks (createItemElement).
		GlitterPresetLibrary.bindPickerNavigation(this.elements.browser, '.asset-option');
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

			const category = this.getCategoryById(this.currentCategoryId);
			if (this.state === 'CATEGORY_DETAIL' && this.setOrigin) {
				this.currentCreatorId = this.setOrigin;
				this.setOrigin = null;
				this.setState('CREATOR_DETAIL');
			} else if (this.state === 'CATEGORY_DETAIL' && category?.parent) {
				this.setState('CATEGORY_DETAIL', category.parent);
			} else this.setState('CATEGORY_LIST');

			// Scroll to top when changing states
			if (this.scrollContainer) {
				this.scrollContainer.scrollTop = 0;
			}


		});
	}

	navigateToCategory(categoryId) {
		if (!categoryId || !this.categories.some((category) => category.id === categoryId)) return false;
		this.setOrigin = null;
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
		return this.state === 'SEARCH_RESULTS' || (this.state === 'CREATOR_DETAIL' && this.currentCreatorId === '__unknown') || (this.state === 'CATEGORY_LIST' && this.layout === 'grouped');
	}

	isPagedState() {
		return this.state === 'CATEGORY_DETAIL' || this.isListingState();
	}

	setState(newState, categoryId = null) {
		clearTimeout(this.searchDebounceTimer);
		if (newState === 'CATEGORY_LIST') this.setOrigin = null;
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
		this.carriedLead.hidden = true;
		this.projectLead.hidden = true;
		this.updateViewControl();
		this.indexLead.hidden = true;
		this.recentLead.hidden = true;

		if (this.state === 'CATEGORY_LIST') {
			this.renderCategoryList();
		} else if (this.state === 'CATEGORY_DETAIL') {
			this.renderCategoryDetail();
		} else if (this.state === 'CREATOR_DETAIL') {
			this.renderCreatorDetail();
		} else if (this.state === 'SEARCH_RESULTS') {
			this.renderSearchResults();
		}
	}

	refresh() {
		this.currentOffset = 0;
		this.elements.itemGrid.innerHTML = '';
		this.elements.searchResults.innerHTML = '';

		this.render();
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
		this.setOrigin = null;
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
		this._renderProjectLead();
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

		this.populateCategoryCards();
	}

	// The last picks, newest first. Rebuilt only when the list is drawn, so a
	// pick never reshuffles the strip under the pointer.
	_renderRecentLead() {
		this._renderLeadRow(this.recentLead, 'Recent', this.contentManager.getRecentItems());
	}

	_renderProjectLead() {
		this._renderLeadRow(this.projectLead, 'In this project', this.contentManager.getProjectItems());
	}

	_renderLeadRow(lead, title, items) {
		const filtered = new Set(this.getFilteredItems());
		const shown = items.filter((item) => filtered.has(item));
		lead.replaceChildren();
		if (!shown.length) { lead.hidden = true; return; }
		const heading = document.createElement('h3');
		heading.className = 'asset-browser-section-title property-block-title';
		heading.textContent = title;
		const grid = document.createElement('div');
		grid.className = 'asset-grid visible asset-browser-recent-grid';
		shown.forEach((item) => grid.appendChild(this.createItemElement(item)));
		lead.append(heading, grid);
		lead.hidden = false;
		this._fitLeadRows();
		this.contentManager.updateSelection?.();
	}

	// The grid's resolved auto-fill tracks are the count that fits one row;
	// later items hide rather than wrap or scroll.
	_fitLeadRows() {
		[this.recentLead, this.projectLead].forEach((lead) => {
			const grid = lead?.querySelector('.asset-browser-recent-grid');
			const tracks = grid ? getComputedStyle(grid).gridTemplateColumns : 'none';
			if (!tracks || tracks === 'none') return;
			const fits = tracks.trim().split(/\s+/).length;
			Array.from(grid.children).forEach((item, index) => {
				item.style.display = index < fits ? '' : 'none';
			});
		});
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
		return [this.indexLead, this.recentLead, this.projectLead].some((lead) => lead.querySelector('.asset-option'));
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
		this.elements.categoryGrid.replaceChildren();
		const items = this.getFilteredItems();
		const counts = this.getCategoryCounts(items);
		const favorites = this.getFavoritesCategory(items);
		if (favorites) this.elements.categoryGrid.appendChild(this.createCategoryCard(favorites, favorites.count));
		if (this.browseView === 'creator') {
			this.getCreators(items).forEach(creator => this.elements.categoryGrid.appendChild(this.createCreatorCard(creator)));
		} else {
			this.categories.filter(category => !category.parent).forEach(category => {
				const count = this.getRootCount(category, counts);
				if (count) this.elements.categoryGrid.appendChild(this.createCategoryCard(category, count));
			});
		}
		if (!this.elements.categoryGrid.children.length) {
			this.elements.categoryGrid.classList.remove('visible');
			if (!this.hasLeadItems()) this.showEmptyState('No items found');
		}
	}

	updateCategoryCounts() { this.render(); }

	createCategoryCard(category, count) {
		const card = tplClone('tpl-category-card');
		card.dataset.categoryId = category.id;
		if (category.color) card.style.setProperty('--category-color', category.color);
		card.classList.toggle('is-favorites', category.id === LIBRARY_FAVORITES_ID);

		// Glitter categories tile their icon as a repeating background; every
		// other library shows it as a contained thumbnail.
		const image = card.querySelector('.category-card-image');
		if (this.schema.tileCategoryIcon) {
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
		if (category.attribution?.author) {
			const byline = document.createElement('div');
			byline.className = 'category-card-byline';
			byline.textContent = 'by ' + category.attribution.author;
			card.querySelector('.category-card-count').before(byline);
		}
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
		this.elements.title.textContent = this.getCategoryPath(category.id);
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

		const children = this.categories.filter(child => child.parent === category.id);
		this.elements.categoryGrid.replaceChildren();
		const counts = this.getCategoryCounts(this.getFilteredItems());
		children.forEach(child => {
			if (counts[child.id]) this.elements.categoryGrid.appendChild(this.createCategoryCard(child, counts[child.id]));
		});
		if (this.elements.categoryGrid.children.length) this.elements.categoryGrid.classList.add('visible');
		if (children.length && this.getCategoryItems(category.id).length) {
			this.collectionInfo.appendChild(this.createHeading('More ' + category.name));
			this.collectionInfo.hidden = false;
		}
		this.renderCarriedItems(category);

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
			if (!this.elements.categoryGrid.children.length && this.carriedLead.hidden) this.showEmptyState('No items in this category');
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

		const group = (id, groupItems) => ({ id, name: this.getCategoryPath(id), items: groupItems });
		if (this.state === 'CREATOR_DETAIL') return this.getUnknownGroups(items);
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

	getCategoryPath(id) {
		const category = this.getCategoryById(id);
		const parent = category?.parent && this.getCategoryById(category.parent);
		return parent ? parent.name + ' › ' + category.name : (category?.name || id);
	}

	getRootCount(category, counts) {
		return (counts[category.id] || 0) + this.categories.filter(child => child.parent === category.id)
			.reduce((sum, child) => sum + (counts[child.id] || 0), 0);
	}

	getAssetAttribution(item) {
		return Attribution.resolve(this.getCategoryById(item.category)?.attribution, item.attribution);
	}

	getCreators(items = this.getFilteredItems()) {
		const creators = new Map();
		items.forEach(item => {
			const attr = this.getAssetAttribution(item);
			const id = attr?.authorId || '__unknown';
			if (!creators.has(id)) creators.set(id, { id, name: id === '__unknown' ? 'Unknown' : (attr.author || id), items: [] });
			creators.get(id).items.push(item);
		});
		return [...creators.values()];
	}

	updateViewControl() {
		this.viewControl.hidden = !this.schema.creatorView || this.state !== 'CATEGORY_LIST' || this.getCreators(this.contentManager.getAllContent()).filter(creator => creator.id !== '__unknown').length < 2;
		this.viewControl.querySelectorAll('button').forEach(button => {
			const active = button.dataset.view === this.browseView;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
	}

	createHeading(text) {
		const heading = document.createElement('h3');
		heading.className = 'asset-browser-section-title property-block-title';
		heading.textContent = text;
		return heading;
	}

	createCreatorCard(creator) {
		const card = this.createCategoryCard({ id: creator.id, name: creator.name, icon: creator.items[0]?.thumbnailUrl || creator.items[0]?.url }, creator.items.length);
		const replacement = card.cloneNode(true);
		replacement.addEventListener('click', () => { this.currentCreatorId = creator.id; this.setState('CREATOR_DETAIL'); });
		return replacement;
	}

	renderCreatorDetail() {
		const creator = this.getCreators(this.contentManager.getAllContent()).find(entry => entry.id === this.currentCreatorId);
		this.elements.backBtn.disabled = false;
		this.elements.title.textContent = creator?.name || 'Unknown';
		if (this.currentCreatorId === '__unknown') {
			this.elements.searchResults.classList.add('visible');
			this.elements.searchResults.replaceChildren();
			this.loadListingItems();
			return;
		}
		this.elements.categoryGrid.replaceChildren();
		const items = this.getFilteredItems().filter(item => this.getAssetAttribution(item)?.authorId === this.currentCreatorId);
		const counts = this.getCategoryCounts(items);
		const categories = this.categories.filter(category => counts[category.id]);
		const sources = new Set(categories.map(category => category.attribution?.sourceId || ''));
		const ordered = [...sources].flatMap(source => categories.filter(category => (category.attribution?.sourceId || '') === source));
		let lastSource = null;
		ordered.forEach(category => {
			const source = category.attribution?.sourceId || '';
			if (sources.size > 1 && source !== lastSource) this.elements.categoryGrid.appendChild(this.createHeading(category.attribution?.source || source || 'Other sets'));
			lastSource = source;
			const card = this.createCategoryCard(category, counts[category.id]);
			card.addEventListener('click', () => { this.setOrigin = this.currentCreatorId; });
			this.elements.categoryGrid.appendChild(card);
		});
		if (categories.length) this.elements.categoryGrid.classList.add('visible');
		else this.showEmptyState('No items found');
	}

	getUnknownGroups(items) {
		const groups = new Map();
		items.filter(item => !this.getAssetAttribution(item)?.authorId).forEach(item => {
			const category = this.getCategoryById(item.category);
			const root = category?.parent ? this.getCategoryById(category.parent) : category;
			const id = root?.id || item.category;
			if (!groups.has(id)) groups.set(id, { id, name: root?.name || id, items: [] });
			groups.get(id).items.push(item);
		});
		return [...groups.values()];
	}

	renderCarriedItems(category) {
		const items = this.getFilteredItems().filter(item => (item.appearances || []).some(entry => entry.set === category.id));
		this.carriedLead.replaceChildren();
		this.carriedLead.hidden = !items.length;
		if (!items.length) return;
		this.carriedLead.appendChild(this.createHeading('Carried over from earlier sets'));
		const grid = document.createElement('div');
		grid.className = 'asset-grid visible';
		items.forEach(item => {
			const card = this.createItemElement(item);
			const entry = document.createElement('div');
			entry.className = 'asset-browser-carried-item';
			const tile = document.createElement('div');
			tile.className = 'asset-grid visible';
			tile.appendChild(card);
			const label = document.createElement('div');
			label.className = 'category-card-byline';
			label.textContent = 'From ' + (this.getCategoryById(item.category)?.name || item.category);
			entry.append(tile, label);
			grid.appendChild(entry);
		});
		this.carriedLead.appendChild(grid);
	}

	// ===== INTEGRATION CALLBACKS =====

	getFilteredItems() {
		return this.contentManager.applyFilters();
	}

	createItemElement(item) {
		return this.contentManager.createItemElement(item);
	}
}
