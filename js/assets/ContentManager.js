// ============================================
// CONTENT MANAGER BASE CLASS
// Handles common functionality for content pickers (glitter/stickers)
// ============================================

// Words people type that the Library spells differently: spelling variants,
// and color names that land on the color tags the admin color-weights write.
const LIBRARY_SEARCH_ALIASES = Object.freeze({
	grey: ['gray'], gray: ['grey'], colour: ['color'], colours: ['colors'],
	magenta: ['pink'], fuchsia: ['pink'], rose: ['pink'],
	violet: ['purple'], lilac: ['purple'], lavender: ['purple'],
	crimson: ['red'], scarlet: ['red'], maroon: ['red'],
	navy: ['blue'], cyan: ['blue', 'teal'], aqua: ['blue', 'teal'], turquoise: ['teal', 'blue'],
	lime: ['green'], mint: ['green'], emerald: ['green'],
	amber: ['orange', 'yellow'], peach: ['orange', 'pink'],
	golden: ['gold'], sparkly: ['sparkle'], glittery: ['glitter']
});

// True when `a` becomes `b` with one insertion, deletion, substitution or
// swap of neighbouring letters.
function isOneEditApart(a, b) {
	if (a === b || Math.abs(a.length - b.length) > 1) return false;
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	if (a.length === b.length) {
		if (a.slice(i + 1) === b.slice(i + 1)) return true;
		return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
	}
	const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
	return shorter.slice(i) === longer.slice(i + 1);
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class ContentManager {
	constructor(editor) {
		this.editor = editor;

		// Content arrays
		this.content = [];
		this.userContent = [];
		// Assets removed from the Library may still be needed by layers or undo.
		this.retiredCustom = new Map();
		this.assetDetailPromises = new Map();
		this.assetImageReadyPromises = new Map();
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
			this.ui.searchInput.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') this.recordSearch();
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					this.clearSearch();
				}
			});
			// `change` fires when the field loses focus with a new value.
			this.ui.searchInput.addEventListener('change', () => this.recordSearch());
			this.ui.searchInput.addEventListener('focus', () => this.renderRecentSearches());
		}

		this.ui.searchClear?.addEventListener('click', () => {
			this.clearSearch();
			this.ui.searchInput?.focus();
		});

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

	ensureAssetImageReady(asset) {
		if (!asset?.url) return Promise.resolve();
		const existing = this.assetImageReadyPromises.get(asset.url);
		if (existing) return existing;

		const promise = loadImageElement(asset.url).catch(error => {
			this.assetImageReadyPromises.delete(asset.url);
			throw error;
		});
		this.assetImageReadyPromises.set(asset.url, promise);
		return promise;
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
			originalName: typeof raw.originalName === 'string' ? raw.originalName : null,
			appearances: this.normalizeArrayValue(raw.appearances).filter(entry => entry && typeof entry.set === 'string' && typeof entry.originalName === 'string'),
			filename: raw.filename ?? defaults.filename ?? null,
			url: raw.url ?? defaults.url ?? null,
			thumbnailUrl: raw.thumbnailUrl ?? raw.url ?? defaults.thumbnailUrl ?? null,
			category: raw.category ?? defaults.category ?? 'Uncategorized',
			set: raw.set ?? defaults.set ?? null,
			attribution: Attribution.coerce(raw.attribution ?? defaults.attribution, `asset ${raw.id ?? ''}`),
			stickerText: raw.stickerText ?? defaults.stickerText ?? null,
			tags: this.normalizeArrayValue(raw.tags, defaults.tags || []),
			searchTerms: this.normalizeArrayValue(raw.searchTerms, defaults.searchTerms || []),
			colors: this.normalizeArrayValue(raw.colors, defaults.colors || []),
			generatedName: raw.generatedName ?? defaults.generatedName ?? null,
			brightness: raw.brightness ?? defaults.brightness ?? null,
			sortOrder: this.normalizeNumberValue(raw.sortOrder, defaults.sortOrder ?? 0),
			originalOrder: raw.originalOrder == null ? null : this.normalizeNumberValue(raw.originalOrder, null),
			hue: raw.hue ?? defaults.hue ?? null,
			colorCodes,
			colorWeights: Array.isArray(raw.colorWeights) ? raw.colorWeights : (defaults.colorWeights ?? null),
			paletteType: raw.paletteType ?? defaults.paletteType ?? null,
			swatchCount: this.normalizeNumberValue(raw.swatchCount, defaults.swatchCount ?? 0),
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
			// Sticker multi-resolution: {"512": {url,width,height}, ...}, keyed
			// by measured width. Only ever populated via the lazy detail fetch
			// (excluded from the slim index) — see StickerManager.pickVariantUrl.
			// An empty list (the detail JSON's []) is stored as null: both mean no variants.
			sliced: this.normalizeBooleanValue(raw.sliced, defaults.sliced ?? false),
			slice: raw.slice ?? defaults.slice ?? null,
			variantUrls: raw.variantUrls && typeof raw.variantUrls === 'object' && Object.keys(raw.variantUrls).length ? raw.variantUrls : (defaults.variantUrls ?? null),
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

	// Per-collection credit block for the asset browser. A category or set
	// carries an optional `attribution` in its *-categories.json entry; every
	// asset in it inherits it (a set's resolves over a category's, and
	// item-level attribution over both).
	getCollectionAttribution(category) { return category?.attribution; }

	getCategoryLabel(category) {
		return this.browser?.getCategoryPath(category) || category.charAt(0).toUpperCase() + category.slice(1);
	}

	createAssetProvenance(item) {
		if (item.source === 'user-upload') {
			const block = document.createElement('div');
			block.className = 'asset-provenance property-note';
			block.textContent = `Uploaded by you${item.filename ? ' ? ' + item.filename : ''}`;
			return block;
		}
		const category = this.browser?.getCategoryById(item.set || item.category);
		const attr = this.browser ? this.browser.getAssetAttribution(item) : Attribution.resolve(item.attribution);
		if (!item.originalName && !attr && !item.appearances?.length) return null;
		const block = document.createElement('div');
		block.className = 'asset-provenance property-note';
		if (item.originalName) {
			const original = document.createElement('div');
			original.textContent = `Original name: ${item.originalName}`;
			block.appendChild(original);
		}
		const credit = document.createElement('div');
		if (item.appearances?.length) {
			const first = `First published by ${attr?.author || 'Unknown'} in ${category?.name || item.category}${item.originalName ? ' as ' + item.originalName : ''}.`;
			const later = item.appearances.map(entry => {
				const set = this.browser?.getCategoryById(entry.set);
				return `Also in ${set?.attribution?.author ? set.attribution.author + "'s " : ''}${set?.name || entry.set} as ${entry.originalName}.`;
			});
			credit.textContent = [first, ...later].join(' ');
		} else credit.textContent = Attribution.creditLine(attr);
		if (credit.textContent) block.appendChild(credit);
		return block;
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
			chip.textContent = this.getCategoryLabel(category);
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
		const name = this.normalizeSearchText([item.name, item.originalName, ...(item.appearances || []).map(entry => entry.originalName)].filter(Boolean).join(' '));
		if (this.activeFilters.nameOnly) return { name, document: name };

		const document = [
			item.name,
			item.originalName,
			...(item.appearances || []).map(entry => entry.originalName),
			item.generatedName,
			item.stickerText,
			item.set && this.browser?.getCategoryById(item.set)?.name,
			...(item.tags || []),
			...(item.searchTerms || [])
		].map((value) => this.normalizeSearchText(value)).filter(Boolean).join(' ');
		return { name, document };
	}

	// A typed term plus the words it stands for (aliases, color groups).
	getSearchTermVariants(term) {
		return [...new Set([term, ...(LIBRARY_SEARCH_ALIASES[term] || []), ...this.getColorAliases(term)])];
	}

	// 3 exact word, 2 word prefix, 1 one typo away (terms of 4+ letters), 0 none.
	searchTermMatchLevel(tokens, term) {
		let level = 0;
		for (const variant of this.getSearchTermVariants(term)) {
			if (tokens.includes(variant)) return 3;
			if (variant.length >= 2 && tokens.some((token) => token.startsWith(variant))) level = 2;
		}
		if (level) return level;
		return term.length >= 4 && tokens.some((token) => isOneEditApart(token, term)) ? 1 : 0;
	}

	matchesSearch(item) {
		const query = this.normalizeSearchText(this.activeFilters.search);
		if (!query) return true;
		const { document } = this.getSearchText(item);
		const tokens = document.split(' ');
		return query.split(' ').every((term) => this.searchTermMatchLevel(tokens, term) > 0);
	}

	// Near misses (a term matched only through a typo) always sort below every
	// exact or prefix result.
	getSearchScore(item) {
		const query = this.normalizeSearchText(this.activeFilters.search);
		if (!query) return 0;
		const terms = query.split(' ');
		const { name, document } = this.getSearchText(item);
		const nameTokens = name.split(' ');
		const documentTokens = document.split(' ');
		let score = 0;
		let nearMiss = false;
		if (name === query) score += 100;
		else if (name.startsWith(query)) score += 60;
		terms.forEach((term) => {
			const inName = this.searchTermMatchLevel(nameTokens, term);
			const inDocument = this.searchTermMatchLevel(documentTokens, term);
			if (inName === 3) score += 12;
			else if (inName === 2) score += 8;
			else if (inDocument === 3) score += 3;
			else if (inDocument === 2) score += 1;
			else nearMiss = true;
		});
		return nearMiss ? score - 1000 : score;
	}

	// The visible name inside a card, for match highlighting. Kinds whose
	// cards show a name override this.
	getSearchNameElement(option) {
		return null;
	}

	// Mark each name word the search matched (exact or prefix).
	highlightSearchMatch(option) {
		const element = this.getSearchNameElement(option);
		const query = this.normalizeSearchText(this.activeFilters.search);
		if (!element || !query) return;
		const variants = query.split(' ')
			.flatMap((term) => this.getSearchTermVariants(term))
			.filter((term) => term.length >= 2)
			.sort((a, b) => b.length - a.length);
		if (!variants.length) return;
		const pattern = new RegExp(`(^|[^a-z0-9])(${variants.map(escapeRegExp).join('|')})`, 'gi');
		const text = element.textContent;
		const nodes = [];
		let last = 0;
		for (const match of text.matchAll(pattern)) {
			const start = match.index + match[1].length;
			if (start > last) nodes.push(document.createTextNode(text.slice(last, start)));
			const mark = document.createElement('mark');
			mark.className = 'search-match';
			mark.textContent = match[2];
			nodes.push(mark);
			last = start + match[2].length;
		}
		if (!nodes.length) return;
		if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
		element.replaceChildren(...nodes);
	}

	// ===== RECENT SEARCHES =====
	// Per Library kind, in PREFERENCES. A search is recorded when it is
	// committed: Enter, leaving the field, or picking a result.

	getRecentSearches() {
		const list = this.libraryKind ? PREFERENCES.get('librarySearches')?.[this.libraryKind] : null;
		return Array.isArray(list) ? list : [];
	}

	recordSearch(query = this.ui.searchInput?.value) {
		const text = String(query || '').trim();
		if (!this.libraryKind || text.length < 2) return;
		const list = this.getRecentSearches().filter((entry) => entry.toLowerCase() !== text.toLowerCase());
		PREFERENCES.set('librarySearches', {
			...PREFERENCES.get('librarySearches'),
			[this.libraryKind]: [text, ...list].slice(0, CONFIG.ui.library.recentSearchCount)
		});
		this.renderRecentSearches();
	}

	// Chips under an empty search field; hidden while there is a query.
	renderRecentSearches() {
		const host = this.ui.recentSearches;
		if (!host) return;
		const list = this.getRecentSearches();
		const show = list.length > 0 && !this.ui.searchInput?.value.trim() && this.ui.activeFilterSummary?.hidden !== false;
		host.hidden = !show;
		if (!show) return;
		const label = document.createElement('span');
		label.className = 'recent-searches-label';
		label.textContent = 'Recent';
		host.replaceChildren(label, ...list.map((entry) => {
			const chip = document.createElement('button');
			chip.type = 'button';
			chip.className = 'filter-chip text-filter-chip';
			const text = document.createElement('span');
			text.textContent = entry;
			chip.appendChild(text);
			chip.title = `Search for “${entry}”`;
			chip.addEventListener('click', () => {
				if (!this.ui.searchInput) return;
				this.ui.searchInput.value = entry;
				this.handleSearch(entry);
				this.recordSearch(entry);
				this.ui.searchInput.focus();
			});
			return chip;
		}));
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

	// The card's own body. Kinds whose thumbnail isn't an image (font
	// samples, shape icons) override this; it must not be a <button>, because
	// the favorite heart is one.
	createItemCard(item) {
		const option = document.createElement('div');
		option.className = 'choice-card asset-option';
		const img = document.createElement('img');
		img.src = item.thumbnailUrl || item.url;
		option.appendChild(img);
		return option;
	}

	createItemElement(item, onSelect = null) {
		const option = this.createItemCard(item);
		option.title ||= item.name;
		option.dataset.id = item.id;
		option.tabIndex = 0;

		// Allow children to add custom classes/attributes
		this.customizeItemElement(option, item);
		const origin = item.source === 'user-upload' ? { icon: 'upload', label: 'Uploaded by you' }
			: item.recipe ? { icon: 'recolor', label: 'Recolored by you' } : null;
		if (origin) {
			const mark = document.createElement('span');
			mark.className = 'asset-origin-mark';
			mark.title = origin.label;
			mark.setAttribute('role', 'img');
			mark.setAttribute('aria-label', origin.label);
			mark.appendChild(createIcon(origin.icon));
			option.appendChild(mark);
			option.title += ` · ${origin.label}`;
		}
		if (this.activeFilters.search) this.highlightSearchMatch(option);
		if (this.libraryKind) option.appendChild(this.createFavoriteToggle(item));
		if (this.userContent.includes(item)) {
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'asset-delete-button';
			remove.title = 'Delete from Library';
			remove.setAttribute('aria-label', `Delete ${item.name} from Library`);
			remove.appendChild(createIcon('trash'));
			remove.addEventListener('click', event => {
				event.stopPropagation();
				this.deleteUserAsset(item.id);
			});
			option.appendChild(remove);
		}

		const select = async () => {
			await (onSelect ? onSelect(item) : this.handleItemClick(item));
			this.recordRecent(item.id);
			if (this.activeFilters.search) this.recordSearch();
		};
		option.addEventListener('click', (event) => {
			if (event.target.closest('.asset-favorite-toggle, .asset-delete-button')) return;
			select();
		});
		option.addEventListener('keydown', (event) => {
			if (event.target !== option || (event.key !== 'Enter' && event.key !== ' ')) return;
			event.preventDefault();
			select();
		});

		return option;
	}

	createCollectionPreview(category) {
		if (!category) return null;
		const item = this.browser.getCategoryPreviewItems(category)[0];
		const url = category.icon || item?.thumbnailUrl || item?.url;
		if (!url) return null;
		const image = document.createElement('img');
		image.src = url;
		image.alt = '';
		image.className = 'asset-browser-rail-icon';
		image.style.imageRendering = item?.isPixelated ? 'pixelated' : 'auto';
		return image;
	}

	async createUploadedAsset(file, { id = `user-upload-${crypto.randomUUID()}`, category, name = null } = {}) {
		if (!this.validateUpload(file)) return null;
		const item = {
			id, name: name || file.name.replace(/\.[^/.]+$/, ''), url: URL.createObjectURL(file),
			source: 'user-upload', category, filename: file.name, fileSize: file.size,
			mimeType: file.type, uploadedAt: Date.now(), isAnimated: false, hasTransparency: false,
			isPixelated: true, width: 0, height: 0, frameCount: 1, frameRate: 0,
			tags: [], searchTerms: [], isLoading: true, error: null, _detailLoaded: true
		};
		try {
			await this.processUploadedImage(item, file);
			return item;
		} catch (error) {
			URL.revokeObjectURL(item.url);
			throw error;
		}
	}

	validateUpload(file) {
		if (!CONFIG.tools.assetUpload.allowedTypes.includes(file.type)) {
			this.editor.showError('Please upload a PNG, JPG, or GIF image');
			return false;
		}

		if (file.size > CONFIG.tools.assetUpload.maxUploadSize) {
			const maxMB = Math.round(CONFIG.tools.assetUpload.maxUploadSize / 1024 / 1024);
			this.editor.showError(`File is too large. Maximum size is ${maxMB}MB.`);
			return false;
		}

		return true;
	}

	async processUploadedImage(item, file) {
		const img = await loadImageElement(item.url);

		// Store dimensions
		item.width = img.naturalWidth;
		item.height = img.naturalHeight;

		// Detect if animated GIF
		if (file.type === 'image/gif') {
			try {
				const timing = readGifTiming(await fetchGifBytes(item.url));
				item.isAnimated = timing.frameCount > 1;
				item.frameCount = timing.frameCount;
				item.frameRate = timing.frameRate;
				item.isVariableFramerate = timing.isVariableFramerate;
			} catch (error) {
				console.warn('Failed to parse GIF frames:', error);
			}
		}

		// Detect transparency
		const canvas = createAppCanvas(0, 0, 'assets/ContentManager');
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(img, 0, 0);

		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		item.hasTransparency = this.detectActualTransparency(imageData);
		item.isPixelated = await this.classifyRendering(imageData, file.type, item.hasTransparency);

		// Mark as loaded
		item.isLoading = false;
	}

	loadRenderingRules() {
		if (!this.renderingRulesPromise) {
			this.renderingRulesPromise = fetch(
				`${CONFIG.tools.assetUpload.renderingRulesPath}?v=${CONFIG.app.assets.manifestVersion}`
			)
				.then((response) => {
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					return response.json();
				})
				.catch((error) => {
					console.warn('Rendering rules unavailable; upload keeps the pixelated default:', error);
					return null;
				});
		}

		return this.renderingRulesPromise;
	}

	async classifyRendering(imageData, mimeType, hasTransparency) {
		const rules = await this.loadRenderingRules();
		if (!rules) return true;

		const data = imageData.data;
		const alphaLevels = new Set();
		const colorBuckets = new Set();
		let visiblePixels = 0;
		let softPixels = 0;
		for (let index = 0; index < data.length; index += 4) {
			const alpha = data[index + 3];
			if (alpha === 0) continue;
			visiblePixels++;
			// Same 12-bit packing the analyzer buckets colors with.
			colorBuckets.add(((data[index] >> 4) << 8) | ((data[index + 1] >> 4) << 4) | (data[index + 2] >> 4));
			if (alpha < 255) {
				softPixels++;
				alphaLevels.add(alpha);
			}
		}

		const coverage = visiblePixels > 0 ? softPixels / visiblePixels : 0;
		const weights = rules.weights;
		const evidence = [];
		if (alphaLevels.size >= rules.softEdge.minAlphaLevels && coverage >= rules.softEdge.minCoverage) {
			evidence.push(weights.soft_edge_ramp);
		} else if (hasTransparency) {
			evidence.push(weights.hard_alpha_cutout);
		} else {
			evidence.push(weights.no_alpha_channel);
		}
		if (rules.smoothMimeTypes.includes(mimeType)) evidence.push(weights.lossy_photographic_format);
		if (mimeType === 'image/gif') evidence.push(weights.indexed_gif);
		evidence.push(colorBuckets.size >= rules.richPaletteBuckets ? weights.rich_palette : weights.limited_palette);

		// Ties stay pixelated, matching the analyzer.
		return evidence.reduce((total, weight) => total + weight, 0) <= 0;
	}

	detectActualTransparency(imageData) {
		// Scan actual pixel alpha values (not just palette)
		const data = imageData.data;
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] < 255) {
				return true;
			}
		}
		return false;
	}

	// ===== RECENTS + FAVORITES =====
	// Per Library kind, by asset id, in PREFERENCES (never in projects). Ids
	// that no longer resolve are skipped when read and dropped on the next write.

	get libraryKind() {
		return this.browser?.prefix || null;
	}

	getLibraryIds(preference) {
		const ids = PREFERENCES.get(preference)?.[this.libraryKind];
		return Array.isArray(ids) ? ids : [];
	}

	setLibraryIds(preference, ids) {
		const known = ids.filter((id) => this.getItemById(id));
		PREFERENCES.set(preference, { ...PREFERENCES.get(preference), [this.libraryKind]: known });
	}

	resolveLibraryIds(ids) {
		return ids.filter(id => !this.retiredCustom.has(id)).map((id) => this.getItemById(id)).filter(Boolean);
	}

	getRecentItems() {
		return this.resolveLibraryIds(this.getLibraryIds('libraryRecents'));
	}

	// Ids of this kind's assets that layers in the open project use, top
	// layer first. Derived from the layers each time; nothing is stored.
	getProjectAssetIds() {
		return [];
	}

	getProjectItems() {
		const layers = [...(this.editor.layerManager?.layers || [])].reverse();
		const ids = [...new Set(this.getProjectAssetIds(layers).filter((id) => id != null))];
		return this.resolveLibraryIds(ids);
	}

	recordRecent(id) {
		if (!this.libraryKind || !this.getItemById(id)) return;
		const ids = this.getLibraryIds('libraryRecents').filter((entry) => String(entry) !== String(id));
		this.setLibraryIds('libraryRecents', [id, ...ids].slice(0, CONFIG.ui.library.recentCount));
		this.browser?.updateShortcuts();
	}

	isFavorite(id) {
		return this.getLibraryIds('libraryFavorites').some((entry) => String(entry) === String(id));
	}

	// Favorites in the order they were hearted, newest first, limited to `items`.
	getFavoriteItems(items = this.getAllContent()) {
		const allowed = new Set(items);
		return this.resolveLibraryIds(this.getLibraryIds('libraryFavorites')).filter((item) => allowed.has(item));
	}

	toggleFavorite(id) {
		if (!this.libraryKind) return;
		const favorite = this.isFavorite(id);
		const ids = this.getLibraryIds('libraryFavorites').filter((entry) => String(entry) !== String(id));
		this.setLibraryIds('libraryFavorites', favorite ? ids : [id, ...ids]);
		this.ui.panel?.querySelectorAll(`.asset-option[data-id="${CSS.escape(String(id))}"] > .asset-favorite-toggle`)
			.forEach((toggle) => this.syncFavoriteToggle(toggle, !favorite));
		this.browser?.handleFavoritesChanged();
	}

	createFavoriteToggle(item) {
		const toggle = document.createElement('button');
		toggle.type = 'button';
		toggle.className = 'asset-favorite-toggle';
		toggle.appendChild(createIcon('heart'));
		this.syncFavoriteToggle(toggle, this.isFavorite(item.id));
		toggle.addEventListener('click', (event) => {
			event.stopPropagation();
			this.toggleFavorite(item.id);
		});
		return toggle;
	}

	syncFavoriteToggle(toggle, favorite) {
		const label = favorite ? 'Remove from Favorites' : 'Add to Favorites';
		toggle.classList.toggle('active', favorite);
		toggle.setAttribute('aria-pressed', String(favorite));
		toggle.setAttribute('aria-label', label);
		toggle.title = label;
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

	clearSearch() {
		if (this.ui.searchInput) this.ui.searchInput.value = '';
		this.activeFilters.search = '';
		this.browser.setState('CATEGORY_LIST');
		this.updateClearFiltersButton();
	}

	handleSearch(query) {
		this.activeFilters.search = query.toLowerCase().trim();
		this.browser.handleSearch();
		this.updateClearFiltersButton();
		this.renderRecentSearches();
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
		if (!mobileManager?.isMobile || mobileManager.activeDrawer !== 'window') return;

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
		const searchSection = this.ui.searchInput?.closest('.glitter-search');
		searchSection?.classList.toggle('has-active-search', Boolean(this.activeFilters.search));
		searchSection?.classList.toggle('has-active-filters', filterCount > 0);
		if (this.ui.searchClear) this.ui.searchClear.hidden = !this.ui.searchInput?.value;
		this.renderActiveFilterSummary();
		this.renderRecentSearches();
		this.updateFilterResultsCount();
		// The Library header mirrors this state; the admin has no Library.
		window.syncLibrarySearchState?.();

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
			animated: 'animated',
			stretchable: 'stretchable'
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
		if (key === 'stretchable') return Boolean(item.sliced);
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
			this.browser.handleSearch();
		}
		this.syncFilterControls();
		if (!this.activeFilters.search && this.browser.state === 'SEARCH_RESULTS') this.browser.setState('CATEGORY_LIST');
		else this.browser.refresh();
		this.updateClearFiltersButton();
	}

	getFilterValueLabel(key, value) {
		const labelAliases = { neutral: 'Neutrals', earth: 'Earth tones', metallic: 'Metallics' };
		return labelAliases[value] || String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
	}

	renderActiveFilterSummary() {
		const summary = this.ui.activeFilterSummary;
		if (!summary) return;
		const filters = [];
		const humanize = (value, key) => this.getFilterValueLabel(key, value);
		if (this.activeFilters.search) filters.push({ key: 'search', label: `Search: “${this.ui.searchInput?.value.trim() || this.activeFilters.search}”` });
		Object.entries(this.activeFilters).forEach(([key, value]) => {
			if (key === 'search' || key === 'nameOnly') return;
			if (value instanceof Set) value.forEach((entry) => filters.push({ key, value: entry, label: humanize(entry, key) }));
			else if (key === 'animated' && value !== null) filters.push({ key, label: value ? 'Animated' : 'Static' });
			else if (value !== null && value !== '' && value !== false) filters.push({ key, label: humanize(value, key) });
		});
		if (this.activeFilters.search && this.activeFilters.nameOnly) filters.push({ key: 'nameOnly', label: 'Name only' });
		summary.replaceChildren(...filters.map((filter) => {
			const chip = document.createElement('button');
			chip.type = 'button';
			chip.className = 'filter-chip is-removable';
			chip.classList.toggle('is-search-term', filter.key === 'search');
			chip.title = filter.label;
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

	clearFilters(options = {}) {
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
		if (options.refreshBrowser !== false) {
			this.browser.setState('CATEGORY_LIST');
		}

		this.updateClearFiltersButton();
	}
	// ===== UTILITY METHODS =====

	async deleteUserAsset(id) {
		const item = this.userContent.find(asset => asset.id === id);
		if (!item) return false;
		const confirmed = await this.editor.confirmAction({
			title: 'Delete from Library?', tone: 'danger', confirmLabel: 'Delete',
			subject: { label: 'Asset', value: item.name },
			message: 'Layers using this asset will keep working. Undo cannot restore it to the Library.'
		});
		if (!confirmed || !this.userContent.includes(item)) return false;
		this.retireUserAsset(id);
		this.editor.updateStatus('Asset deleted from Library');
		return true;
	}

	retireUserAsset(id) {
		const item = this.userContent.find(asset => asset.id === id);
		if (!item) return;
		this.retiredCustom.set(id, item);
		this.userContent = this.userContent.filter(asset => asset.id !== id);
		for (const preference of ['libraryFavorites', 'libraryRecents']) {
			this.setLibraryIds(preference, this.getLibraryIds(preference).filter(assetId => assetId !== id));
		}
		this.updateFacetAvailability();
		this.refreshUserAssets();
	}

	refreshUserAssets() { this.browser?.refresh(); }
	getRenderContent() { return [...this.getAllContent(), ...this.retiredCustom.values()]; }

	getItemById(id) {
		return this.content.find(item => item.id === id) ||
			this.userContent.find(item => item.id === id) || this.retiredCustom.get(id);
	}



	// ===== ABSTRACT METHODS (must be implemented by children) =====

	async loadContent() {
		throw new Error('loadContent() must be implemented by child class');
	}


}
