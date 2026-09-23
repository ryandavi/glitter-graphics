'use strict';

// The gallery's asset browsers (glitter, stickers, brush tips): one search +
// filter block and one browser (category grid, search results, item grid,
// lazy-load sentinel) each, rendered from the tpl-asset-search and
// tpl-asset-browser templates into their hosts at boot, before the managers
// bind. Element ids follow ASSET_BROWSER_ID_GRAMMAR; the managers read them
// through getAssetBrowserUi() and getAssetBrowserElementIds().

const ASSET_BROWSER_ID_GRAMMAR = Object.freeze({
	search: '{p}Search',
	filterToggle: '{p}FilterToggleBtn',
	summary: '{p}ActiveFilterSummary',
	filters: '{p}FiltersContainer',
	nameOnly: 'search{P}NameOnly',
	categoryChips: '{p}CategoryChips',
	clear: 'clear{P}FiltersBtn',
	close: 'close{P}FiltersBtn',
	browser: '{p}Browser',
	back: '{p}BrowserBack',
	title: '{p}BrowserTitle',
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
const ASSET_BROWSERS = Object.freeze([
	{
		prefix: 'glitter', searchHost: 'glitterSearchSection', browserHost: 'glitterOptions',
		title: 'Glitter', placeholder: 'Search by name or tag...',
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
			{ kind: 'categories', label: 'Category' },
			{ kind: 'chips', label: 'Vibe', filter: 'special', options: [{ value: 'pattern', label: 'Pattern' }, { value: 'multicolor', label: 'Multicolor' }] }
		]
	},
	{
		prefix: 'sticker', searchHost: 'stickersSearchSection', browserHost: 'stickersOptions',
		title: 'Stickers', placeholder: 'Search stickers...',
		filters: [
			{ kind: 'nameOnly' },
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
		title: 'Brush Tips', placeholder: 'Search brush tips...',
		filters: [{ kind: 'categories', label: 'Category' }]
	}
]);

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
		filterToggle: byId(ids.filterToggle),
		filtersContainer: byId(ids.filters),
		clearFiltersBtn: byId(ids.clear),
		closeFiltersBtn: byId(ids.close),
		activeFilterSummary: byId(ids.summary),
		categoryChips: byId(ids.categoryChips),
		searchNameOnly: byId(ids.nameOnly)
	};
}

// The browser element ids, keyed the way AssetBrowser reads them.
function getAssetBrowserElementIds(prefix) {
	const ids = getAssetBrowserIds(prefix);
	return {
		browser: ids.browser,
		backBtn: ids.back,
		title: ids.title,
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
	const node = panelDiv('filter-section');
	const label = panelDiv('property-group-label');
	label.textContent = section.kind === 'nameOnly' ? 'Filter' : section.label;
	node.appendChild(label);

	if (section.kind === 'nameOnly') {
		const list = panelDiv('property-toggle-list');
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
		list.appendChild(row);
		node.appendChild(list);
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
	node.appendChild(chips);
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
			input.placeholder = schema.placeholder;
			const toggle = role(search, 'filterToggle');
			toggle.id = ids.filterToggle;
			toggle.setAttribute('aria-controls', ids.filters);
			role(search, 'summary').id = ids.summary;
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
			['browser', 'back', 'title', 'content', 'empty', 'emptyText', 'categoryGrid', 'searchResults', 'itemGrid', 'sentinel']
				.forEach((name) => { role(browser, name).id = ids[name]; });
			role(browser, 'title').textContent = schema.title;
			browserHost.appendChild(browser);
		}
	});
}
