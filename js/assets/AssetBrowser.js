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
		this.folderView = this.layout === 'folders' ? new AssetBrowserFolders(this) : null;
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
		this.setHeader = new AssetSetHeader(() => this.refresh());
		this.elements.categoryGrid.before(this.setHeader.element);
		// Quick picks: what the open project already uses (for "match the other
		// one"), then recents. One row, as many tiles as the panel width fits.
		// The Library view menu shows or hides it (libraryQuickPicks).
		this.shortcuts = document.createElement('div');
		this.shortcuts.className = 'asset-browser-shortcuts';
		this.shortcuts.hidden = true;
		this.shortcutGrid = document.createElement('div');
		this.shortcutGrid.className = 'asset-grid visible';
		this.shortcuts.append(this.createHeading('Quick picks'), this.shortcutGrid);
		this.elements.categoryGrid.before(this.shortcuts);
		new ResizeObserver(() => this._fitShortcutRow()).observe(this.shortcuts);
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
		this.addViewOption('style', 'Style');
		this.addViewOption('creator', 'Creator');
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
		this.catalog = new LibraryCatalog(this.categories, (category, item) => Attribution.resolve(category, item));
		if (this.layout === 'rail') {
			this.elements.browser.classList.add('asset-browser-wall');
			for (const event of ['layerChanged', 'imageLoaded', 'imageRemoved']) {
				window.addEventListener(event, () => this.updateShortcuts());
			}
			this.rail = new AssetBrowserRail(this.catalog, selection => {
				this.rememberRoot(selection.root);
				this.setState('CATEGORY_LIST');
			});
			this.rail.selection.root = PREFERENCES.get('libraryRoots')[this.prefix] || this.catalog.getRoots()[0]?.id;
			// The wall's navigation is one pinned toolbar: browse-by, then the
			// root and set pickers. Favorites is a view of its own, not a root.
			this.addViewOption('favorites', 'Favorites');
			this.toolbar = document.createElement('div');
			this.toolbar.className = 'asset-browser-toolbar';
			this.toolbar.append(this.viewControl, this.rail.element);
			this.elements.categoryGrid.before(this.toolbar, this.setHeader.element);
		}
		this.setupIntersectionObserver();
		this.setupEventListeners();
		this.setState('CATEGORY_LIST');

		// Show browser
		this.elements.browser.classList.add('visible');
	}

	addViewOption(view, label) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'segmented-option';
		button.textContent = label;
		button.dataset.view = view;
		button.addEventListener('click', () => { this.browseView = view; this.folderView?.resetOrigin(); this.setState('CATEGORY_LIST'); });
		this.viewControl.appendChild(button);
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

			if (this.folderView) this.folderView.back();
			else this.setState('CATEGORY_LIST');

			// Scroll to top when changing states
			if (this.scrollContainer) {
				this.scrollContainer.scrollTop = 0;
			}


		});
	}

	navigateToCategory(categoryId) {
		if (!categoryId || !this.categories.some((category) => category.id === categoryId)) return false;
		this.folderView?.resetOrigin();
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
		return this.state === 'SEARCH_RESULTS' || Boolean(this.wallGroups) || this.folderView?.isUnknownListing() || (this.state === 'CATEGORY_LIST' && this.layout === 'grouped');
	}

	// The wall as one flat grid (a grouped wall is a listing).
	isWallState() {
		return Boolean(this.rail) && this.state !== 'SEARCH_RESULTS' && !this.wallGroups;
	}

	isPagedState() {
		return Boolean(this.rail && this.state !== 'SEARCH_RESULTS') || this.state === 'CATEGORY_DETAIL' || this.isListingState();
	}

	setState(newState, categoryId = null) {
		clearTimeout(this.searchDebounceTimer);
		if (newState === 'CATEGORY_LIST') this.folderView?.resetOrigin();
		this.state = newState;
		if (this.rail && newState === 'CATEGORY_DETAIL' && categoryId) {
			this.browseView = 'style';
			this.rail.mode = 'style';
			const root = this.catalog.getRootOf(categoryId);
			this.rail.selection = { root: root?.id, set: root?.id === categoryId ? null : categoryId };
			this.rememberRoot(root?.id);
			this.state = 'CATEGORY_LIST';
		}
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
		this.setHeader.element.hidden = true;
		this.carriedLead.hidden = true;
		this.updateViewControl();
		this.indexLead.hidden = true;
		this.shortcuts.hidden = true;
		this.wallGroups = null;

		if (this.rail) {
			const search = this.state === 'SEARCH_RESULTS';
			this.elements.browser.querySelector('.asset-browser-header').hidden = !search;
			this.toolbar.hidden = search;
			this.rail.element.hidden = search || this.browseView === 'favorites';
			if (search) { this.setHeader.render(null, []); this.renderSearchResults(); }
			else this.renderRail();
			return;
		}
		if (this.state !== 'CATEGORY_DETAIL') this.setHeader.render(null, []);
		if (this.state === 'CATEGORY_LIST') {
			this.renderCategoryList();
		} else if (this.state === 'CATEGORY_DETAIL') {
			this.renderCategoryDetail();
		} else if (this.folderView?.isCreatorDetail()) {
			this.folderView.renderCreatorDetail();
		} else if (this.state === 'SEARCH_RESULTS') {
			this.renderSearchResults();
		}
	}

	rememberRoot(root) {
		if (!root || this.browseView !== 'style') return;
		const roots = PREFERENCES.get('libraryRoots');
		if (roots[this.prefix] !== root) PREFERENCES.set('libraryRoots', { ...roots, [this.prefix]: root });
	}

	renderRail() {
		this._renderShortcuts();
		const items = this.getFilteredItems();
		let wall;
		let category = null;
		let grouped = false;
		if (this.browseView === 'favorites') {
			this.currentCategoryId = LIBRARY_FAVORITES_ID;
			wall = this.contentManager.getFavoriteItems(items);
		} else {
			const selection = this.rail.render(items, this.browseView);
			this.currentCategoryId = selection.set || selection.root;
			category = selection.set ? this.catalog.getCategoryById(selection.set) : null;
			wall = this.browseView === 'creator' ? this.catalog.getCreatorItems(selection.root, items) : this.catalog.getRootItems(selection.root, items);
			if (selection.set) wall = this.catalog.getCategoryItems(selection.set, wall);
			// A style is one color-ordered wall. A creator's sets are unrelated
			// to each other, so each keeps its own heading and color order.
			else grouped = this.browseView === 'creator';
		}
		this.setHeader.render(category, wall);
		this.wallItems = this.setHeader.sort(wall);
		this.wallGroups = grouped ? this.getSetGroups(wall) : null;
		this.elements.itemGrid.replaceChildren();
		this.elements.searchResults.replaceChildren();
		this.currentOffset = 0;
		if (category) this.renderCarriedItems(category);
		if (this.wallGroups) {
			this.elements.searchResults.classList.add('visible');
			this.loadListingItems();
			return;
		}
		this.elements.itemGrid.classList.add('visible');
		this.loadRailItems();
	}

	// `items` under one heading per set, in category order. Null when they
	// are all one set.
	getSetGroups(items) {
		const bySet = new Map();
		items.forEach(item => {
			if (!bySet.has(item.category)) bySet.set(item.category, []);
			bySet.get(item.category).push(item);
		});
		if (bySet.size < 2) return null;
		const order = id => {
			const index = this.categories.findIndex(category => category.id === id);
			return index < 0 ? Infinity : index;
		};
		return [...bySet.entries()].sort((a, b) => order(a[0]) - order(b[0]))
			.map(([id, setItems]) => ({ id, name: this.getCategoryPath(id), items: this.setHeader.sort(setItems) }));
	}

	loadRailItems() {
		const batch = this.wallItems.slice(this.currentOffset, this.currentOffset + this.batchSize);
		if (!this.wallItems.length) { this.showEmptyState(this.browseView === 'favorites' ? 'No favorites yet' : 'No items found'); return; }
		batch.forEach(item => this.elements.itemGrid.appendChild(this.createItemElement(item)));
		this.currentOffset += batch.length;
		this.contentManager.updateSelection?.();
		this.checkAndLoadMore();
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
		if (this.state === 'SEARCH_RESULTS') return;
		if (this.rail) {
			if (this.browseView !== 'favorites') return;
			this.preserveScrollPosition(() => {
				this.wallItems = this.setHeader.sort(this.contentManager.getFavoriteItems(this.getFilteredItems()));
				const existing = new Map([...this.elements.itemGrid.children].map(tile => [String(tile.dataset.id), tile]));
				const shown = this.wallItems.slice(0, Math.max(this.currentOffset, this.batchSize));
				const tiles = shown.map(item => existing.get(String(item.id)) || this.createItemElement(item));
				for (const child of [...this.elements.itemGrid.children]) if (!tiles.includes(child)) child.remove();
				tiles.forEach((tile, index) => {
					if (this.elements.itemGrid.children[index] !== tile) this.elements.itemGrid.insertBefore(tile, this.elements.itemGrid.children[index] || null);
				});
				this.currentOffset = tiles.length;
				this.elements.emptyState.classList.remove('visible');
				if (!this.wallItems.length) this.showEmptyState('No favorites yet');
				else this.checkAndLoadMore();
				this.contentManager.updateSelection?.();
			});
			return;
		}
		if (this.state !== 'CATEGORY_LIST') return;
		if (this.layout === 'grouped') this.render();
		else this.updateCategoryCounts();
	}

	async navigateToItem(itemId) {
		this.folderView?.resetOrigin();
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
		this._renderShortcuts();
		if (!this.shortcuts.hidden) this.contentManager.updateSelection?.();
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

	// Project assets first, then recents. Updates reuse tiles and leave the
	// paged wall intact.
	_renderShortcuts() {
		const filtered = new Set(this.getFilteredItems());
		const items = [...new Set([...this.contentManager.getProjectItems(), ...this.contentManager.getRecentItems()])]
			.filter((item) => filtered.has(item));
		const grid = this.shortcutGrid;
		const existing = new Map([...grid.children].map(tile => [String(tile.dataset.id), tile]));
		const tiles = items.map(item => existing.get(String(item.id)) || this.createItemElement(item));
		for (const child of [...grid.children]) if (!tiles.includes(child)) child.remove();
		tiles.forEach((tile, index) => {
			if (grid.children[index] !== tile) grid.insertBefore(tile, grid.children[index] || null);
		});
		this.shortcuts.hidden = !items.length;
		this._fitShortcutRow();
	}

	updateShortcuts() {
		if (!this.rail || this.state === 'SEARCH_RESULTS') return;
		this.preserveScrollPosition(() => this._renderShortcuts());
		this.contentManager.updateSelection?.();
	}

	preserveScrollPosition(update) {
		const host = this.scrollContainer;
		const scrollTop = host.scrollTop;
		const top = host.getBoundingClientRect().top;
		const anchors = scrollTop > 0 ? [...host.querySelectorAll('.asset-option')].map(tile => ({ tile, rect: tile.getBoundingClientRect() }))
			.filter(({ rect }) => rect.height && rect.bottom > top) : [];
		const overflowAnchor = host.style.overflowAnchor;
		host.style.overflowAnchor = 'none';
		update();
		const anchor = anchors.find(({ tile }) => tile.isConnected);
		host.scrollTop = anchor ? scrollTop + anchor.tile.getBoundingClientRect().top - anchor.rect.top : scrollTop;
		host.style.overflowAnchor = overflowAnchor;
	}

	// The grid's resolved auto-fill tracks are the count that fits one row;
	// later items hide rather than wrap or scroll.
	_fitShortcutRow() {
		const grid = this.shortcutGrid;
		if (!grid.clientWidth) return;
		const fits = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
		Array.from(grid.children).forEach((item, index) => {
			item.style.display = index < fits ? '' : 'none';
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
		return [this.indexLead, this.shortcuts].some((lead) => lead.querySelector('.asset-option'));
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
			this.getCreators(items).forEach(creator => this.elements.categoryGrid.appendChild(this.folderView.createCreatorCard(creator)));
		} else {
			this.catalog.getRoots().forEach(category => {
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

	createCategoryCard(category, count, onClick = () => this.setState('CATEGORY_DETAIL', category.id)) {
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

		card.addEventListener('click', onClick);

		return card;
	}

	getCategoryCounts(items) {
		return this.catalog.getCategoryCounts(items);
	}

	getCategoryItems(categoryId, items = this.getFilteredItems()) {
		if (categoryId === LIBRARY_FAVORITES_ID) return this.contentManager.getFavoriteItems(items);
		return this.catalog.getCategoryItems(categoryId, items);
	}

	getCategoryById(categoryId) {
		if (categoryId === LIBRARY_FAVORITES_ID) return { id: LIBRARY_FAVORITES_ID, name: 'Favorites' };
		return this.catalog.getCategoryById(categoryId);
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
		this.setHeader.render(category.id === LIBRARY_FAVORITES_ID ? null : { ...category, attribution: this.contentManager.getCollectionAttribution?.(category) }, this.getCategoryItems(category.id));

		const children = this.catalog.getSets(category.id);
		this.elements.categoryGrid.replaceChildren();
		const counts = this.getCategoryCounts(this.getFilteredItems());
		children.forEach(child => {
			if (counts[child.id]) this.elements.categoryGrid.appendChild(this.createCategoryCard(child, counts[child.id]));
		});
		if (this.elements.categoryGrid.children.length) this.elements.categoryGrid.classList.add('visible');
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
		if (this.isWallState()) return this.wallItems.length;
		if (this.state === 'CATEGORY_DETAIL') return this.getCategoryItems(this.currentCategoryId).length;
		if (this.isListingState()) return this.getListingItems().length;
		return 0;
	}

	loadNextBatch() {
		if (this.isWallState()) this.loadRailItems();
		else if (this.state === 'CATEGORY_DETAIL') this.loadCategoryItems();
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
		this.contentManager.updateSelection?.();

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

		if (this.wallGroups) return this.wallGroups;
		const group = (id, groupItems) => ({ id, name: this.getCategoryPath(id), items: groupItems });
		if (this.folderView?.isCreatorDetail()) return this.getUnknownGroups(items);
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
		const size = this.state === 'CATEGORY_LIST' && !this.rail ? entries.length : this.batchSize;
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
		this.contentManager.updateSelection?.();

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
		return id === LIBRARY_FAVORITES_ID ? 'Favorites' : this.catalog.getCategoryPath(id);
	}

	getRootCount(category, counts) {
		return this.catalog.getRootCount(category, counts);
	}

	getAssetAttribution(item) {
		return this.catalog.getAssetAttribution(item);
	}

	getCreators(items = this.getFilteredItems()) {
		return this.catalog.getCreators(items);
	}

	updateViewControl() {
		const creators = Boolean(this.schema.creatorView) && this.getCreators(this.contentManager.getAllContent()).filter(creator => creator.id !== '__unknown').length >= 2;
		// The wall always offers Favorites; a folder kind only switches Style / Creator.
		this.viewControl.hidden = this.state !== 'CATEGORY_LIST' || !(creators || this.rail);
		this.viewControl.querySelectorAll('button').forEach(button => {
			const active = button.dataset.view === this.browseView;
			if (button.dataset.view === 'creator') button.hidden = !creators;
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

	getUnknownGroups(items) {
		return this.catalog.getUnknownGroups(items);
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
			card.title = `${item.name} · from ${this.getCategoryById(item.category)?.name || item.category}`;
			grid.appendChild(card);
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
