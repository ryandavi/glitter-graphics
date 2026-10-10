// ============================================
// ASSET BROWSER CLASS
// One Library kind's browser: shared tree navigation, home covers or grouped
// tiles, search, Quick picks and Favorites. Items come from its ContentManager.
// ============================================

// Favorites is a pseudo-category: never a real category id, never saved in
// projects (favorites live in PREFERENCES).
const LIBRARY_FAVORITES_ID = '__favorites';
// The picker's home, shown as covers or grouped tiles. Never a category id.
const LIBRARY_ALL_ID = '__all';

class AssetBrowser {
	constructor(contentManager, prefix) {
		const schema = getAssetBrowserSchema(prefix);
		const elementIds = getAssetBrowserElementIds(prefix);
		this.contentManager = contentManager;
		this.prefix = prefix;
		this.schema = schema;
		this.browseView = 'style';
		this.state = 'CATEGORY_LIST';
		this.currentCategoryId = null;
		this.currentOffset = 0;
		this.batchSize = 20;
		this.searchDebounceTimer = null;

		this.categories = [];

		// HTML element references
		this.elements = {
			browser: document.getElementById(elementIds.browser),
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
		this.elements.content.prepend(this.setHeader.element);
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
		if (schema.categoryHeading) {
			this.categoryHeading = this.createHeading(schema.categoryHeading);
			this.categoryHeading.classList.add('asset-browser-category-heading');
			this.categoryHeading.hidden = true;
			this.elements.categoryGrid.before(this.categoryHeading);
		}

		this.carriedLead = document.createElement('div');
		this.carriedLead.className = 'asset-browser-carried';
		this.carriedLead.hidden = true;
		this.elements.itemGrid.after(this.carriedLead);
		this.viewControl = document.createElement('div');
		this.viewControl.className = 'segmented-control asset-browser-views';
		this.viewControl.setAttribute('aria-label', 'Browse library by');
		this.viewControl.hidden = true;
		this.addViewOption('style', schema.browseLabel);
		this.addViewOption('creator', 'Creator');
		// The browser's navigation sits above the scrolling content: browse-by,
		// then the style or creator picker.
		this.toolbar = document.createElement('div');
		this.toolbar.className = 'asset-browser-toolbar';
		this.toolbar.hidden = true;
		this.toolbar.appendChild(this.viewControl);
		this.elements.content.before(this.toolbar);

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
		this.catalog = new LibraryCatalog(this.categories, (...layers) => Attribution.resolve(...layers));
		if (this.prefix === 'glitter') this.elements.browser.classList.add('asset-browser-wall');
		for (const event of ['layerChanged', 'imageLoaded', 'imageRemoved']) {
			window.addEventListener(event, () => this.updateShortcuts());
		}
		this.rail = new AssetBrowserRail(this.catalog, () => this.setState('CATEGORY_LIST'), this.schema, category => this.contentManager.createCollectionPreview?.(category, true));
		this.addViewOption('favorites', 'Favorites');
		this.toolbar.appendChild(this.rail.element);
		let homeView = this.getHomeView();
		PREFERENCES.onChange('libraryHome', () => {
			const next = this.getHomeView();
			if (next === homeView) return;
			homeView = next;
			if (this.state === 'CATEGORY_LIST' && this.browseView !== 'favorites' && this.rail.selection.root === LIBRARY_ALL_ID) this.refresh();
		});
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
		button.addEventListener('click', () => { this.browseView = view; this.setState('CATEGORY_LIST'); });
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

	// Search results and Everything home list tiles under category headings.
	isListingState() {
		return this.state === 'SEARCH_RESULTS' || Boolean(this.wallGroups);
	}

	// The wall as one flat grid (a grouped wall is a listing).
	isWallState() {
		return this.state === 'CATEGORY_LIST' && !this.homeCategories && !this.wallGroups;
	}

	isPagedState() {
		return this.isWallState() || this.isListingState();
	}

	setState(newState, categoryId = null) {
		clearTimeout(this.searchDebounceTimer);
		this.state = newState;
		if (newState === 'CATEGORY_DETAIL' && categoryId) {
			this.browseView = 'style';
			this.rail.mode = 'style';
			// A set is reached through the first style that holds its items.
			const root = this.catalog.isSet(this.catalog.getCategoryById(categoryId))
				? this.catalog.getRoots().find(style => this.catalog.getSetCounts(style.id, this.getFilteredItems())[categoryId])
				: this.catalog.getRootOf(categoryId);
			this.rail.selection = { root: root?.id, set: root?.id === categoryId ? null : categoryId };
			this.state = 'CATEGORY_LIST';
		}
		this.currentCategoryId = categoryId;
		this.currentOffset = 0;

		// Scroll to top when changing states
		if (this.scrollContainer) {
			this.scrollContainer.scrollTop = 0;
		}

		this.render();
	}

	render() {
		// Narrowing is cross-library, regardless of the saved home or rail view.
		this.state = this.contentManager.hasActiveFilters() ? 'SEARCH_RESULTS' : 'CATEGORY_LIST';
		if (this.assetOptions) {
			this.assetOptions.dataset.browserState = this.state.toLowerCase().replace('_', '-');
		}
		// Hide all content containers first
		this.elements.emptyState.classList.remove('visible');
		this.elements.categoryGrid.classList.remove('visible');
		this.elements.searchResults.classList.remove('visible');
		this.elements.itemGrid.classList.remove('visible');
		this.setHeader.element.hidden = true;
		this.carriedLead.hidden = true;
		this.updateViewControl();
		this.indexLead.hidden = true;
		if (this.categoryHeading) this.categoryHeading.hidden = true;
		this.shortcuts.hidden = true;
		this.wallGroups = null;
		this.homeCategories = false;
		const search = this.state === 'SEARCH_RESULTS';
		this.toolbar.hidden = search;
		this.rail.element.hidden = search || this.browseView === 'favorites';
		if (search) { this.setHeader.render(null, []); this.renderSearchResults(); }
		else this.renderRail();
	}

	renderRail() {
		const items = this.getFilteredItems();
		let wall;
		let category = null;
		let groups = null;
		if (this.browseView === 'favorites') {
			this.currentCategoryId = LIBRARY_FAVORITES_ID;
			wall = this.contentManager.getFavoriteItems(items);
		} else {
			const selection = this.rail.render(items, this.browseView);
			this.currentCategoryId = selection.set || selection.root;
			// A style is one color-ordered wall. Home's styles, and a creator's
			// sets, are unrelated to each other, so each keeps its own heading
			// and color order.
			wall = this.rail.getItems(items, selection, this.browseView);
			if (selection.root === LIBRARY_ALL_ID) {
				groups = () => this.browseView === 'creator' ? this.getCreatorGroups(wall) : this.getStyleGroups(wall);
			} else {
				if (!selection.set && this.browseView === 'creator') groups = () => this.getSetGroups(wall);
				category = this.getHeaderCategory(selection, wall);
			}
		}
		this.elements.itemGrid.classList.toggle('brush-basic-grid', this.prefix === 'brushTip' && this.currentCategoryId === 'basic');
		this._renderShortcuts(true);
		const browseCategories = this.browseView === 'style'
			? this.contentManager.getBrowseCategories?.(this.rail.selection, this.catalog) : null;
		if (browseCategories) {
			this.renderHomeCategories(items, browseCategories);
			return;
		}
		if (this.browseView !== 'favorites' && this.rail.selection.root === LIBRARY_ALL_ID && this.getHomeView() === 'categories') {
			this.renderHomeCategories(items);
			return;
		}
		this.setHeader.render(category, wall);
		this.wallItems = this.sortItems(wall);
		this.wallGroups = groups ? groups() : null;
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

	// What the set header introduces: the picked set, or a style that has
	// something to say for itself. A style whose shown tiles all come from one
	// set carries that set's credit.
	getHeaderCategory(selection, wall) {
		const category = selection.set ? this.catalog.getCategoryById(selection.set)
			: this.browseView === 'style' ? this.catalog.getCategoryById(selection.root) : null;
		if (!category) return null;
		const attribution = this.contentManager.getCollectionAttribution?.(category) || category.attribution
			|| this.catalog.getSharedSet(wall)?.attribution;
		return selection.set || category.description || attribution ? { ...category, attribution } : null;
	}

	getHomeView() {
		return getLibraryHomeView(this.prefix);
	}

	renderHomeCategories(items, categories = null) {
		this.homeCategories = true;
		this.wallItems = [];
		this.setHeader.render(null, []);
		this.elements.categoryGrid.replaceChildren();
		this.elements.itemGrid.replaceChildren();
		this.elements.searchResults.replaceChildren();
		if (this.browseView === 'style' && this.rail.selection.root === LIBRARY_ALL_ID) this._renderIndexLead();
		const creators = this.browseView === 'creator';
		const counts = this.getCategoryCounts(items);
		const roots = creators ? this.getCreators(items).map(creator => ({
			id: creator.id, name: creator.name, count: creator.items.length,
			icon: creator.items[0]?.thumbnailUrl || creator.items[0]?.url
		})) : (categories || this.catalog.getRoots()).map(root => ({ ...root, count: this.getRootCount(root, counts) }));
		roots.filter(root => root.count && (this.indexLead.hidden || root.id !== this.indexLead.firstElementChild?.dataset.categoryId)).forEach(root => {
			this.elements.categoryGrid.appendChild(this.createCategoryCard(root, root.count, () => {
				if (creators) this.rail.select(root.id);
				else this.navigateToCategory(root.id);
			}));
		});
		if (this.elements.categoryGrid.children.length) {
			this.elements.categoryGrid.classList.add('visible');
			if (this.categoryHeading) this.categoryHeading.hidden = false;
		}
		else if (!this.hasLeadItems()) this.showEmptyState('No items found');
	}

	getCreatorGroups(items) {
		return this.getCreators(items).map(creator => ({ id: creator.id, name: creator.name, items: this.sortItems(creator.items) }));
	}

	sortItems(items) {
		return this.setHeader.sort(items);
	}

	// `items` under one heading per style. Null when one style holds them all.
	getStyleGroups(items) {
		const groups = this.catalog.getRoots()
			.map(root => ({ id: root.id, name: root.name, items: this.sortItems(this.catalog.getRootItems(root.id, items)) }))
			.filter(group => group.items.length);
		return groups.length > 1 ? groups : null;
	}

	// `items` under one heading per style, in category order. Null when they
	// are all one style.
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
			.map(([id, setItems]) => ({ id, name: this.getCategoryPath(id), items: this.sortItems(setItems) }));
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

	// Reconcile Favorites without rebuilding the remaining tiles or other walls.
	handleFavoritesChanged() {
		if (this.state === 'SEARCH_RESULTS') return;
		if (this.browseView !== 'favorites') return;
		this.preserveScrollPosition(() => {
			this.wallItems = this.sortItems(this.contentManager.getFavoriteItems(this.getFilteredItems()));
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
	}

	// `scope` is a rail selection to stay in when it holds the item; otherwise
	// the item's own style opens.
	async navigateToItem(itemId, scope = null) {
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

		const input = this.contentManager.ui.searchInput;
		if (input) input.value = '';
		this.contentManager.activeFilters.search = '';
		this.contentManager.updateClearFiltersButton();
		if (scope && this.rail.getItems([item], scope, 'style').length) {
			this.browseView = 'style';
			this.rail.mode = 'style';
			this.rail.selection = { ...scope };
			this.setState('CATEGORY_LIST');
		} else {
			this.setState('CATEGORY_DETAIL', item.category);
		}

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 50));

		// Load items until we find our target
		await this.loadUntilItemFound(item);

		// Scroll to the item
		this.scrollToItem(item);
	}

	// Find the requested card in its grid or grouped search listing.
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

	// Project assets first, then recents. Updates reuse tiles and leave the
	// paged wall intact. They belong to the Style home only; narrower views
	// keep their tiles together.
	_renderShortcuts(resetOrder = false) {
		const filtered = new Set(this.getFilteredItems());
		const top = this.state === 'CATEGORY_LIST' && this.browseView === 'style' && this.rail.selection.root === LIBRARY_ALL_ID;
		let items = top ? [...new Set([...this.contentManager.getProjectItems(), ...this.contentManager.getRecentItems()])]
			.filter((item) => filtered.has(item)) : [];
		const grid = this.shortcutGrid;
		// Picking updates recency and project membership, but must not move a
		// shortcut under the pointer. Reapply priority when home is opened.
		if (!resetOrder) {
			const byId = new Map([...filtered].map(item => [String(item.id), item]));
			const retained = top ? [...grid.children].map(tile => byId.get(tile.dataset.id)).filter(Boolean) : [];
			const retainedIds = new Set(retained.map(item => String(item.id)));
			items = [...retained, ...items.filter(item => !retainedIds.has(String(item.id)))];
		}
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
		if (this.state === 'SEARCH_RESULTS') return;
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

	createCategoryCard(category, count, onClick = () => this.setState('CATEGORY_DETAIL', category.id)) {
		const card = tplClone('tpl-category-card');
		card.dataset.categoryId = category.id;
		if (category.color) card.style.setProperty('--category-color', category.color);

		const image = card.querySelector('.category-card-image');
		if (category.icon) {
			const img = document.createElement('img');
			img.src = category.icon;
			img.draggable = false;
			img.alt = '';
			image.appendChild(img);
		} else {
			const samples = this.getCategoryPreviewItems(category);
			image.classList.add('category-card-previews');
			image.dataset.previewCount = samples.length;
			for (const item of samples) {
				const cell = document.createElement('span');
				cell.className = 'category-card-preview';
				if (this.schema.tileCategoryIcon) {
					cell.style.backgroundImage = `url("${item.url}")`;
					cell.style.imageRendering = item.isPixelated ? 'pixelated' : 'auto';
				} else {
					const img = document.createElement('img');
					img.src = item.thumbnailUrl || item.url;
					img.draggable = false;
					img.alt = '';
					cell.appendChild(img);
				}
				image.appendChild(cell);
			}
		}

		card.querySelector('.category-card-name').textContent = category.name;
		card.querySelector('.category-card-count').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
		card.title = `${category.name} (${count})`;
		this.contentManager.customizeCollectionCard?.(card, category);

		card.addEventListener('click', onClick);

		return card;
	}

	getCategoryPreviewItems(category) {
		const items = this.contentManager.getAllContent().filter(item => !item.isLoading && !item.error);
		const previews = (category.previews || []).map(id => items.find(item => String(item.id) === String(id))).filter(Boolean);
		const members = category.parent || this.catalog.isSet(category)
			? this.getCategoryItems(category.id, items) : this.catalog.getRootItems(category.id, items);
		return (previews.length ? previews : members).slice(0, 4);
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

	// ===== SEARCH RESULTS VIEW =====

	renderSearchResults() {
		// Update header
		const query = this.contentManager.activeFilters.search;
		const resultCount = this.getFilteredItems().length;
		const line = AssetSetHeader.createTitleLine(`${resultCount} result${resultCount === 1 ? '' : 's'}${query ? ` for “${query}”` : ''}`);
		this.setHeader.element.replaceChildren(line);
		this.setHeader.element.setAttribute('aria-live', 'polite');
		this.setHeader.element.hidden = false;

		// Show search results container
		this.elements.searchResults.classList.add('visible');

		// Clear and load
		this.elements.searchResults.innerHTML = '';
		this.currentOffset = 0;
		this.loadListingItems();
	}

	handleSearch() {
		clearTimeout(this.searchDebounceTimer);

		this.searchDebounceTimer = setTimeout(() => {
			this.setState('CATEGORY_LIST');
		}, 300);
	}

	// ===== LAZY LOADING =====

	getPagedItemCount() {
		if (this.isWallState()) return this.wallItems.length;
		if (this.isListingState()) return this.getListingItems().length;
		return 0;
	}

	loadNextBatch() {
		if (this.isWallState()) this.loadRailItems();
		else if (this.isListingState()) this.loadListingItems();
	}

	loadMoreItems() {
		if (this.currentOffset < this.getPagedItemCount()) this.loadNextBatch();
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

	// Search preserves score order and groups by the asset's home category.
	getListingGroups() {
		if (this.wallGroups) return this.wallGroups;
		const byCategory = new Map();
		this.getFilteredItems().forEach(item => {
			if (!byCategory.has(item.category)) byCategory.set(item.category, []);
			byCategory.get(item.category).push(item);
		});
		return [...byCategory.entries()].map(([id, items]) => ({ id, name: this.getCategoryPath(id), items }));
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

		const batch = entries.slice(this.currentOffset, this.currentOffset + this.batchSize);

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

					const header = AssetSetHeader.createTitleLine(group.name, group.items.length);
					header.classList.add('category-section-header');
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
			this.elements.emptyClearFilters.hidden = !this.contentManager.hasActiveFilters();
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
		this.viewControl.hidden = this.state === 'SEARCH_RESULTS';
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
			card.title = `${item.name} · from ${this.getCategoryById(item.set || item.category)?.name || item.category}`;
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
