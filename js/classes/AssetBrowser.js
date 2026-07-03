// ============================================
// ASSET BROWSER CLASS
// Uses existing HTML structure
// ============================================
class AssetBrowser {
constructor(contentManager, elementIds, displayName) {
	this.contentManager = contentManager;
	this.displayName = displayName;
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
		emptyText: document.getElementById(elementIds.emptyText)
	};
	
	// Store parent containers
	this.assetOptions = this.elements.browser.closest('.asset-options');
	this.scrollContainer = this.elements.browser.closest('.asset-options'); // The actual scrollable element // this.elements.content; //
	
	this.observer = null;
}

	async init(categoriesJsonPath) {
		await this.loadCategories(categoriesJsonPath);
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
			if (entries[0].isIntersecting && this.state !== 'CATEGORY_LIST') {
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
		this.elements.backBtn.addEventListener('click', () => {
			// If in search, clear the search input which will trigger return to category list
			if (this.state === 'SEARCH_RESULTS') {
				const searchInput = this.contentManager.ui.searchInput;
				if (searchInput) {
					searchInput.value = '';
					this.contentManager.activeFilters.search = '';
				}
			}
			
			this.setState('CATEGORY_LIST');

			// Scroll to top when changing states
			if (this.scrollContainer) {
				this.scrollContainer.scrollTop = 0;
			}


		});
	}
	// ===== STATE MANAGEMENT =====

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
		if (this.state === 'CATEGORY_LIST' && this.categoriesRendered) {
			this.updateCategoryCounts();
		} else {
			this.render();
		}
	}


async navigateToItem(itemId) {
	// Find which category contains this item
	const allItems = this.contentManager.getAllContent();
	const item = allItems.find(i => i.id === itemId);
	
	if (!item) {
		console.warn('[Browser] Item not found:', itemId);
		return;
	}
	
	// Navigate to the category
	this.setState('CATEGORY_DETAIL', item.category);
	
	// Wait for initial render
	await new Promise(resolve => setTimeout(resolve, 50));
	
	// Load items until we find our target
	await this.loadUntilItemFound(itemId);
	
	// Scroll to the item
	this.scrollToItem(itemId);
}

async loadUntilItemFound(itemId) {
	const maxAttempts = 50; // Prevent infinite loop
	let attempts = 0;
	
	while (attempts < maxAttempts) {
		// Check if item is in DOM
		const element = this.elements.itemGrid.querySelector(`[data-id="${itemId}"]`);
		if (element) {
			return; // Found it!
		}
		
		// Load more items
		const allItems = this.getFilteredItems();
		const categoryItems = allItems.filter(i => i.category === this.currentCategoryId);
		
		// If we've loaded everything, stop
		if (this.currentOffset >= categoryItems.length) {
			console.warn('[Browser] Item not found after loading all items');
			return;
		}
		
		// Load next batch
		this.loadCategoryItems();
		
		// Wait for render
		await new Promise(resolve => setTimeout(resolve, 50));
		attempts++;
	}
}

scrollToItem(itemId) {
	const element = this.elements.itemGrid.querySelector(`[data-id="${itemId}"]`);
	if (!element) {
		console.warn('[Browser] Could not scroll to item:', itemId);
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


	populateCategoryCards() {
		// Clear grid
		this.elements.categoryGrid.innerHTML = '';

		const filteredItems = this.getFilteredItems();
		const categoryCounts = this.getCategoryCounts(filteredItems);

		let hasCategories = false;
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
			this.showEmptyState('No items found');
		}
	}

updateCategoryCounts() {
	// Make sure we're showing the right container
	this.elements.emptyState.classList.remove('visible');
	this.elements.searchResults.classList.remove('visible');
	this.elements.itemGrid.classList.remove('visible');
	this.elements.categoryGrid.classList.add('visible');
	
	const filteredItems = this.getFilteredItems();
	const categoryCounts = this.getCategoryCounts(filteredItems);
	
	let hasVisibleCategories = false;
	
	// Update existing cards and track which categories are already rendered
	const renderedCategories = new Set();
	this.elements.categoryGrid.querySelectorAll('.category-card').forEach(card => {
		const categoryId = card.dataset.categoryId;
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
		this.showEmptyState('No items found');
	}
}

	createCategoryCard(category, count) {
		const card = document.createElement('div');
		card.className = 'category-card';
		card.dataset.categoryId = category.id;
		card.style.setProperty('--category-color', category.color);
		
		// Different rendering for glitter vs stickers
		const isGlitter = this.displayName === 'Glitter';
		
		if (isGlitter) {
			card.innerHTML = `
				<div class="category-card-image category-card-glitter-bg" style="background-image: url('${category.icon}')"></div>
				<div class="category-card-name">${category.name}</div>
				<div class="category-card-count">${count} ${count === 1 ? 'item' : 'items'}</div>
			`;
		} else {
			card.innerHTML = `
				<div class="category-card-image">
					<img src="${category.icon}" draggable="false" alt="${category.name}">
				</div>
				<div class="category-card-name">${category.name}</div>
				<div class="category-card-count">${count} ${count === 1 ? 'item' : 'items'}</div>
			`;
		}
		
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

	// ===== CATEGORY DETAIL VIEW =====

renderCategoryDetail() {
	const category = this.categories.find(c => c.id === this.currentCategoryId);
	if (!category) {
		this.setState('CATEGORY_LIST');
		return;
	}
	
	// Update header
	this.elements.backBtn.disabled = false;
	this.elements.title.textContent = category.name;
	
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
	this.elements.backBtn.disabled = false; // CHANGED: Enable back button
	this.elements.title.textContent = `Search: "${this.contentManager.activeFilters.search}"`;
	
	// Show search results container
	this.elements.searchResults.classList.add('visible');
	
	// Clear and load
	this.elements.searchResults.innerHTML = '';
	this.loadSearchItems();
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

loadMoreItems() {
	if (this.state === 'CATEGORY_DETAIL') {
		const allItems = this.getFilteredItems();
		const categoryItems = allItems.filter(item => item.category === this.currentCategoryId);
		
		// Only load if there are more items
		if (this.currentOffset < categoryItems.length) {
			this.loadCategoryItems();
		}
	} else if (this.state === 'SEARCH_RESULTS') {
		const allItems = this.getFilteredItems();
		
		// Only load if there are more items
		if (this.currentOffset < allItems.length) {
			this.loadSearchItems();
		}
	}
}

	loadCategoryItems() {
		const allItems = this.getFilteredItems();
		const categoryItems = allItems.filter(item => item.category === this.currentCategoryId);
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
		
		dbg('[Browser] Checking viewport fill:', {
			sentinelTop: sentinelRect.top,
			scrollBottom: scrollRect.bottom,
			buffer: bufferZone,
			threshold: scrollRect.bottom + bufferZone,
			isSentinelNear: isSentinelNearViewport,
			currentOffset: this.currentOffset
		});
		
		// If sentinel is within our buffer zone, keep loading
		if (isSentinelNearViewport) {
			dbg('[Browser] Sentinel within buffer zone, loading more...');
			
			// Check if there are more items to load based on current state
			if (this.state === 'CATEGORY_DETAIL') {
				const allItems = this.getFilteredItems();
				const categoryItems = allItems.filter(item => item.category === this.currentCategoryId);
				
				if (this.currentOffset < categoryItems.length) {
					this.loadCategoryItems(); // This will recursively call checkAndLoadMore again
				} else {
					dbg('[Browser] No more items to load');
				}
			} else if (this.state === 'SEARCH_RESULTS') {
				const allItems = this.getFilteredItems();
				
				if (this.currentOffset < allItems.length) {
					this.loadSearchItems(); // This will recursively call checkAndLoadMore again
				} else {
					dbg('[Browser] No more items to load');
				}
			}
		} else {
			dbg('[Browser] Viewport filled - sentinel well beyond view');
		}
	});
}

loadSearchItems() {
	const allItems = this.getFilteredItems();
	
	// Group by category
	const grouped = {};
	allItems.forEach(item => {
		const catId = item.category;
		if (!grouped[catId]) grouped[catId] = [];
		grouped[catId].push(item);
	});
	
	if (Object.keys(grouped).length === 0) {
		this.elements.searchResults.classList.remove('visible');
		this.showEmptyState('No results found');
		return;
	}
	
	// Flatten all items while maintaining category grouping
	const flatItems = [];
	Object.keys(grouped).forEach(catId => {
		grouped[catId].forEach(item => {
			flatItems.push({ ...item, _categoryId: catId });
		});
	});
	
	// Get current batch
	const batch = flatItems.slice(this.currentOffset, this.currentOffset + this.batchSize);
	
	if (batch.length === 0) {
		return; // No more items
	}
	
	// Track which category we're currently building
	let currentCategoryId = null;
	let currentSection = null;
	let currentGrid = null;
	
	batch.forEach(item => {
		// If we're starting a new category, create section + header
		if (item._categoryId !== currentCategoryId) {
			currentCategoryId = item._categoryId;
			
			// Check if this category section already exists
			currentSection = this.elements.searchResults.querySelector(`[data-category-id="${currentCategoryId}"]`);
			
			if (!currentSection) {
				// Create new section
				const category = this.categories.find(c => c.id === currentCategoryId);
				const categoryName = category ? category.name : currentCategoryId;
				const totalCount = grouped[currentCategoryId].length;
				
				currentSection = document.createElement('div');
				currentSection.className = 'category-section';
				currentSection.dataset.categoryId = currentCategoryId;
				
				const header = document.createElement('div');
				header.className = 'category-section-header';
				header.textContent = `${categoryName} (${totalCount})`;
				currentSection.appendChild(header);
				
				currentGrid = document.createElement('div');
				currentGrid.className = 'asset-grid visible';
				currentSection.appendChild(currentGrid);
				
				this.elements.searchResults.appendChild(currentSection);
			} else {
				// Use existing grid
				currentGrid = currentSection.querySelector('.asset-grid');
			}
		}
		
		// Add item to current grid
		const element = this.createItemElement(item);
		currentGrid.appendChild(element);
	});
	
this.currentOffset += batch.length;

// Update selection state for newly rendered items
this.contentManager.updateSelection();

// Check if we need to load more
this.checkAndLoadMore();
}

	showEmptyState(message) {
		this.elements.emptyText.textContent = message;
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
