'use strict';

// The Library: one entry per pickable asset kind (glitter, stickers, brush
// tips, shapes, fonts). Each kind gets one search + filter block and one
// browser (tree picker, home covers, grouped tiles, search and paging),
// rendered from the tpl-asset-search and tpl-asset-browser templates into its
// hosts at boot, before the managers bind. Element ids follow
// ASSET_BROWSER_ID_GRAMMAR; the managers read them through getAssetBrowserUi()
// and getAssetBrowserElementIds(). The Library holds assets (files with
// attribution); presets are values and stay in Properties next to what they
// change.

const ASSET_BROWSER_ID_GRAMMAR = Object.freeze({
	search: '{p}Search',
	searchClear: '{p}SearchClear',
	filterToggle: '{p}FilterToggleBtn',
	summary: '{p}ActiveFilterSummary',
	recentSearches: '{p}RecentSearches',
	filters: '{p}FiltersContainer',
	nameOnly: 'search{P}NameOnly',
	categoryChips: '{p}CategoryChips',
	clear: 'clear{P}FiltersBtn',
	close: 'close{P}FiltersBtn',
	browser: '{p}Browser',
	content: '{p}BrowserContent',
	empty: '{p}BrowserEmpty',
	emptyText: '{p}BrowserEmptyText',
	categoryGrid: '{p}CategoryGrid',
	searchResults: '{p}SearchResults',
	itemGrid: '{p}ItemGrid',
	sentinel: '{p}BrowserSentinel'
});

const ASSET_BROWSER_COLOR_CHIPS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']
	.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }));

// Filter sections, in order:
//   { kind: 'nameOnly' }                 the "Search by name only" toggle
//   { kind: 'categories', label }        chips the manager fills from its data
//   { kind: 'chips', label, filter, swatch?, attribute?, options: [{ value, label }] }
//     static chips; `swatch` draws color dots without text, `attribute`
//     names the data-* key holding the value (default 'color')
// `home` supplies the default home view; libraryHome overrides it per kind.
// `browseLabel` names the first segment and the category picker.
const ASSET_BROWSERS = Object.freeze([
	{
		prefix: 'glitter', searchHost: 'glitterSearchSection', browserHost: 'glitterOptions',
		pickerDefault: (editor) => {
			const session = editor.pickers.active?.pickerSession;
			if (session?.defaultAssetId != null) return session.defaultAssetId;
			const layer = editor.layerManager.getLayerById(session?.layerId) || editor.layerManager.getInspectedLayer();
			return getPaintSlotDefaultGlitterId(layer?.type, getPaintSlotDefinition(layer?.type, session?.slot || 'fill'));
		},
		title: 'Glitter', home: 'categories', browseLabel: 'Style', placeholder: 'Search by name or tag...',
		creatorView: true, tileCategoryIcon: true,
		filters: [
			{ kind: 'nameOnly' },
			{ kind: 'chips', label: 'Colors', filter: 'color', swatch: true, options: [
				...ASSET_BROWSER_COLOR_CHIPS,
				{ value: 'neutral', label: 'Neutrals' }, { value: 'earth', label: 'Earth tones' }, { value: 'metallic', label: 'Metallics' }
			] },
			{ kind: 'chips', label: 'Tone', filter: 'tone', options: [
				{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'pastel', label: 'Pastel' },
				{ value: 'neon', label: 'Neon' }, { value: 'jewel', label: 'Jewel Tone' }
			] },
			{ kind: 'chips', label: 'Intensity', filter: 'intensity', options: [{ value: 'vivid', label: 'Vivid' }, { value: 'muted', label: 'Muted' }] },
			{ kind: 'chips', label: 'Temperature', filter: 'temperature', options: [{ value: 'warm', label: 'Warm' }, { value: 'cool', label: 'Cool' }] },
			{ kind: 'chips', label: 'Vibe', filter: 'special', options: [{ value: 'pattern', label: 'Pattern' }, { value: 'multicolor', label: 'Multicolor' }] }
		]
	},
	{
		prefix: 'sticker', searchHost: 'stickersSearchSection', browserHost: 'stickersOptions',
		pickerDefault: () => CONFIG.tools.stickers.defaultStickerId,
		title: 'Stickers', home: 'categories', browseLabel: 'Style', placeholder: 'Search stickers...',
		creatorView: true,
		filters: [
			{ kind: 'nameOnly' },
			{ kind: 'chips', label: 'Stretch', filter: 'stretchable', options: [{ value: 'stretchable', label: 'Stretchable' }] },
			{ kind: 'chips', label: 'Motion', filter: 'animated', attribute: 'animated', options: [{ value: 'true', label: 'Animated' }, { value: 'false', label: 'Static' }] },
			{ kind: 'chips', label: 'Colors', filter: 'color', swatch: true, options: ASSET_BROWSER_COLOR_CHIPS },
			{ kind: 'chips', label: 'Vibe', filter: 'vibe', options: [
				{ value: 'glitter', label: 'Glitter' }, { value: 'emo', label: 'Emo' }, { value: 'love', label: 'Love' }, { value: 'cute', label: 'Cute' }
			] },
			{ kind: 'categories', label: 'Category' }
		]
	},
	{
		prefix: 'brushTip', searchHost: 'brushTipSearchSection', browserHost: 'brushTipOptions',
		pickerDefault: () => CONFIG.tools.maskBrush.defaultShape,
		title: 'Brush Tips', home: 'categories', browseLabel: 'Browse', categoryHeading: 'Raster brush sets', placeholder: 'Search brush tips...',
		filters: [{ kind: 'categories', label: 'Category' }]
	},
	{
		prefix: 'shape', searchHost: 'shapesSearchSection', browserHost: 'shapesOptions',
		pickerDefault: () => CONFIG.tools.shapes.defaultShapeId,
		title: 'Shapes', home: 'everything', browseLabel: 'Browse', placeholder: 'Search shapes...',
		filters: [{ kind: 'categories', label: 'Category' }]
	},
	{
		prefix: 'font', searchHost: 'fontsSearchSection', browserHost: 'fontsOptions',
		pickerDefault: () => CONFIG.tools.text.defaultFontId,
		title: 'Fonts', home: 'everything', browseLabel: 'Browse', placeholder: 'Search fonts...',
		filters: [
			{ kind: 'chips', label: 'Source', filter: 'font-source', attribute: 'value', options: [
				{ value: 'system', label: 'System' }, { value: 'bundled', label: 'Bundled' }
			] },
			{ kind: 'categories', label: 'Category' },
			{ kind: 'chips', label: 'Language', filter: 'script', attribute: 'value', options: [
				{ value: 'latin', label: 'Latin' }, { value: 'ja', label: 'Japanese' },
				{ value: 'ko', label: 'Korean' }, { value: 'zh', label: 'Chinese' }
			] }
		]
	}
]);

function getLibraryHomeView(prefix) {
	const value = PREFERENCES.get('libraryHome')[prefix];
	return ['categories', 'everything'].includes(value) ? value : getAssetBrowserSchema(prefix)?.home;
}

function getAssetBrowserIds(prefix) {
	const cap = prefix.charAt(0).toUpperCase() + prefix.slice(1);
	return Object.fromEntries(Object.entries(ASSET_BROWSER_ID_GRAMMAR).map(([role, pattern]) => [
		role, pattern.replaceAll('{p}', prefix).replaceAll('{P}', cap)
	]));
}

function getAssetBrowserSchema(prefix) {
	return ASSET_BROWSERS.find((schema) => schema.prefix === prefix) || null;
}

// The search and filter elements, keyed the way ContentManager's `ui` reads them.
function getAssetBrowserUi(prefix) {
	const ids = getAssetBrowserIds(prefix);
	const byId = (id) => document.getElementById(id);
	return {
		panel: byId(getAssetBrowserSchema(prefix)?.browserHost),
		searchInput: byId(ids.search),
		searchClear: byId(ids.searchClear),
		filterToggle: byId(ids.filterToggle),
		filtersContainer: byId(ids.filters),
		clearFiltersBtn: byId(ids.clear),
		closeFiltersBtn: byId(ids.close),
		activeFilterSummary: byId(ids.summary),
		recentSearches: byId(ids.recentSearches),
		categoryChips: byId(ids.categoryChips),
		searchNameOnly: byId(ids.nameOnly)
	};
}

// The browser element ids, keyed the way AssetBrowser reads them.
function getAssetBrowserElementIds(prefix) {
	const ids = getAssetBrowserIds(prefix);
	return {
		browser: ids.browser,
		content: ids.content,
		categoryGrid: ids.categoryGrid,
		searchResults: ids.searchResults,
		itemGrid: ids.itemGrid,
		sentinel: ids.sentinel,
		emptyState: ids.empty,
		emptyText: ids.emptyText
	};
}

function buildAssetBrowserFilterSection(section, ids) {
	const node = tplClone('tpl-group');
	const label = node.querySelector('.property-group-label');
	label.textContent = section.kind === 'nameOnly' ? 'Filter' : section.label;
	const card = panelDiv('property-card');
	const body = panelDiv('property-card-body');
	const set = panelDiv('property-set');
	node.appendChild(card);
	card.appendChild(body);
	body.appendChild(set);

	if (section.kind === 'nameOnly') {
		const row = document.createElement('label');
		row.className = 'property-row is-toggle';
		const text = document.createElement('span');
		text.className = 'property-label';
		text.textContent = 'Search by name only';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.id = ids.nameOnly;
		const toggle = document.createElement('span');
		toggle.className = 'property-switch';
		toggle.setAttribute('aria-hidden', 'true');
		row.append(text, input, toggle);
		set.appendChild(row);
		return node;
	}

	const chips = panelDiv(section.swatch ? 'color-filter-chips' : 'filter-chips');
	if (section.kind === 'categories') {
		chips.id = ids.categoryChips;
	} else {
		section.options.forEach((option) => {
			const chip = panelDiv(`filter-chip ${section.swatch ? 'color-filter-chip' : 'text-filter-chip'}`);
			chip.dataset[section.attribute || 'color'] = option.value;
			chip.dataset.filter = section.filter;
			chip.title = option.label;
			if (!section.swatch) chip.textContent = option.label;
			chips.appendChild(chip);
		});
	}
	const row = panelDiv('property-row is-stacked');
	row.appendChild(chips);
	set.appendChild(row);
	return node;
}

function renderAssetBrowsers() {
	ASSET_BROWSERS.forEach((schema) => {
		const ids = getAssetBrowserIds(schema.prefix);
		const role = (root, name) => (root.dataset.browserRole === name ? root : root.querySelector(`[data-browser-role="${name}"]`));

		const searchHost = document.getElementById(schema.searchHost);
		if (searchHost && !searchHost.children.length) {
			const search = tplClone('tpl-asset-search');
			const input = role(search, 'search');
			input.id = ids.search;
			role(search, 'searchClear').id = ids.searchClear;
			input.placeholder = schema.placeholder;
			const toggle = role(search, 'filterToggle');
			toggle.id = ids.filterToggle;
			toggle.setAttribute('aria-controls', ids.filters);
			role(search, 'summary').id = ids.summary;
			role(search, 'recentSearches').id = ids.recentSearches;
			role(search, 'filters').id = ids.filters;
			role(search, 'clear').id = ids.clear;
			role(search, 'close').id = ids.close;
			const sections = role(search, 'filterSections');
			schema.filters.forEach((section) => sections.appendChild(buildAssetBrowserFilterSection(section, ids)));
			searchHost.appendChild(search);
		}

		const browserHost = document.getElementById(schema.browserHost);
		if (browserHost && !browserHost.children.length) {
			const browser = tplClone('tpl-asset-browser');
			['browser', 'content', 'empty', 'emptyText', 'categoryGrid', 'searchResults', 'itemGrid', 'sentinel']
				.forEach((name) => { role(browser, name).id = ids[name]; });
			browserHost.appendChild(browser);
		}
	});
}

// `/` (desktop): unfold the Library's search row if needed and focus it.
function focusLibrarySearch() {
	const section = document.getElementById('designGallerySection');
	const host = document.getElementById(getAssetBrowserSchema(section?.dataset.library)?.searchHost);
	if (!host) return;
	if (!section.classList.contains('library-search-open')) {
		document.getElementById('librarySearchToggle')?.click();
	}
	const input = host.querySelector('[data-browser-role="search"]');
	input?.focus();
	input?.select();
}

// Library header search button: unfolds the active kind's search row, which
// library/_browser.scss keeps folded on every screen. Folding is always allowed, even
// mid-search; the active-filter chips and the button's accent dot stay.
function setupLibrarySearchToggle() {
	const button = document.getElementById('librarySearchToggle');
	const section = document.getElementById('designGallerySection');
	if (!button || !section) return;
	button.addEventListener('click', () => {
		const open = !section.classList.contains('library-search-open');
		section.classList.toggle('library-search-open', open);
		button.classList.toggle('active', open);
		button.setAttribute('aria-expanded', String(open));
		button.title = open ? 'Hide search' : 'Search';
		const host = document.getElementById(getAssetBrowserSchema(section.dataset.library)?.searchHost);
		if (open) {
			host?.querySelector('[data-browser-role="search"]')?.focus();
		} else if (host?.classList.contains('filters-open')) {
			// The filter sheet lives in the folded row; close it through its
			// own button so the manager restores the drawer height.
			host.querySelector('[data-browser-role="close"]')?.click();
		}
	});
}

// Library header view menu: per-kind home view, shared tile size and Quick
// picks. They live in PREFERENCES; the section carries grid settings for the
// stylesheet (`data-tile-size`, `.quick-picks-off`).
function setupLibraryViewMenu() {
	const root = document.getElementById('libraryViewMenu');
	const panel = document.getElementById('libraryViewMenuPanel');
	const section = document.getElementById('designGallerySection');
	if (!root || !panel || !section) return;
	setupMenuPopover({ root, trigger: document.getElementById('libraryViewMenuBtn'), panel, fixed: true });
	const sync = () => {
		const size = PREFERENCES.get('libraryTileSize');
		const quickPicks = PREFERENCES.get('libraryQuickPicks');
		const kind = section.dataset.library;
		panel.querySelectorAll('[data-home-view]').forEach(item => {
			item.disabled = !kind;
			item.setAttribute('aria-current', String(item.dataset.homeView === getLibraryHomeView(kind)));
		});
		section.dataset.tileSize = size;
		section.classList.toggle('quick-picks-off', !quickPicks);
		panel.querySelectorAll('[data-tile-size]').forEach((item) => {
			item.setAttribute('aria-current', String(item.dataset.tileSize === size));
		});
		panel.querySelector('[data-quick-picks]')?.setAttribute('aria-current', String(quickPicks));
	};
	panel.addEventListener('click', (event) => {
		const item = event.target.closest('.app-menu-item');
		if (!item) return;
		if (item.dataset.tileSize) PREFERENCES.set('libraryTileSize', item.dataset.tileSize);
		else if (item.dataset.homeView && section.dataset.library) {
			PREFERENCES.set('libraryHome', { ...PREFERENCES.get('libraryHome'), [section.dataset.library]: item.dataset.homeView });
		} else if (item.hasAttribute('data-quick-picks')) PREFERENCES.set('libraryQuickPicks', !PREFERENCES.get('libraryQuickPicks'));
	});
	new MutationObserver(sync).observe(section, { attributes: true, attributeFilter: ['data-library'] });
	PREFERENCES.onChange('libraryHome', sync);
	PREFERENCES.onChange('libraryTileSize', sync);
	PREFERENCES.onChange('libraryQuickPicks', sync);
	sync();
}
