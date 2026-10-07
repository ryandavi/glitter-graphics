'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'data/glitter.index.json'), 'utf8'))[0];
const categories = [
	{ id: 'sparkle', name: 'Classic Sparkle' },
	{ id: 'transparent', name: 'Transparent' },
	{ id: 'empty', name: 'Empty' },
	{ id: 'stardrops', kind: 'set', name: "Stardrops' Open Directory", attribution: { author: 'Mica', authorId: 'mica', source: 'Stardrops', sourceId: 'stardrops' } },
	{ id: 'sparkelies', kind: 'set', name: 'Sparkelies', attribution: { author: 'DAN-411', authorId: 'dan', source: 'Sparkelies', sourceId: 'sparkelies' } },
	{ id: 'bring-on-the-glitter', kind: 'set', name: 'Bring On The Glitter', attribution: { author: 'Aylana', authorId: 'aylana', source: 'Bring On The Glitter', sourceId: 'bring-on-the-glitter' } },
	{ id: 'second-source', kind: 'set', name: 'Second source', attribution: { author: 'Aylana', authorId: 'aylana', source: 'Second source', sourceId: 'other-source' } },
].map(category => ({ icon: source.url, ...category }));
const items = [
	{ id: 9001, name: 'Unknown glitter', category: 'sparkle' },
	{ originalOrder: 20, id: 9002, name: 'Spark Button', category: 'sparkle', set: 'stardrops', originalName: 'Sparkbutton-gray', appearances: [{ set: 'bring-on-the-glitter', originalName: 'blue-08' }] },
	{ originalOrder: 30, id: 9003, name: 'Ruby', category: 'sparkle', set: 'sparkelies', originalName: 'ruby', appearances: [{ set: 'bring-on-the-glitter', originalName: 'red-02' }] },
	{ originalOrder: 10, id: 9004, name: 'Muted Pink', category: 'sparkle', set: 'bring-on-the-glitter', originalName: 'pink-001' },
	{ tags: ['Pink'], id: 9005, name: 'Clear Pink', category: 'transparent', set: 'second-source', originalName: 'clear-01' },
].map(item => ({ ...source, tags: [], searchTerms: [], ...item }));

async function openPage(browser, before = false, real = false) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	if (!real) await page.route('**/data/glitter.index.json*', route => route.fulfill({ json: items }));
	if (!real) await page.route('**/data/glitter-categories.json*', route => route.fulfill({ json: categories }));
	if (!real) await page.route('**/data/glitter/900*.json*', route => {
		const id = Number(new URL(route.request().url()).pathname.match(/(900\d)\.json/)[1]);
		return route.fulfill({ json: items.find(item => item.id === id) });
	});
	if (before && process.env.GLITTER_TEST_BASELINE) {
		const baseline = process.env.GLITTER_TEST_BASELINE;
		await page.route('**/css/style.css*', route => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(baseline, 'style.css')) }));
		await page.route('**/glitter/', route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(baseline, 'index.html')) }));
		for (const file of ['js/assets/AssetBrowser.js', 'js/assets/AssetBrowserRail.js', 'js/assets/BrushTipManager.js', 'js/assets/ShapeBrowserManager.js', 'js/assets/FontBrowserManager.js', 'js/ui/asset-browser-markup.js']) {
			await page.route('**/' + file + '*', route => route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(baseline, file)) }));
		}
	} else if (before) {
		await page.route('**/css/style.css*', route => route.fulfill({ contentType: 'text/css', body: execFileSync('git', ['show', 'HEAD:css/style.css'], { cwd: root }) }));
		await page.route('**/glitter/', route => route.fulfill({ contentType: 'text/html', body: execFileSync('git', ['show', 'HEAD:index.html'], { cwd: root }) }));
		for (const file of ['js/assets/AssetBrowser.js', 'js/assets/AssetBrowserRail.js', 'js/assets/AssetBrowserFolders.js', 'js/assets/BrushTipManager.js', 'js/ui/asset-browser-markup.js']) {
			await page.route('**/' + file + '*', route => route.fulfill({ contentType: 'application/javascript', body: execFileSync('git', ['show', 'HEAD:' + file], { cwd: root }) }));
		}
	}
	if (!before && process.env.GLITTER_TEST_CSS) await page.route('**/css/style.css*', route => route.fulfill({ contentType: 'text/css', body: fs.readFileSync(process.env.GLITTER_TEST_CSS) }));
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.goto(process.env.GLITTER_URL || 'http://localhost/glitter/', { waitUntil: 'networkidle' });
	await page.waitForFunction(() => window.editor?.glitterLibrary.browser && window.editor?.stickerLibrary.browser);
	await page.evaluate(async () => {
		const e = window.editor;
		await e.loadBlankImage(240, 180, '#ffffff');
		e.layerManager.insertLayer(e.glitterManager.createLayer());
		e.layerManager.setActiveLayer(e.layers.at(-1).id);
		e.setCollapsibleSectionOpen('designGallery', true, true);
		document.querySelectorAll('.modal-overlay.visible').forEach(modal => modal.classList.remove('visible'));
	});
	return { page, errors };
}

async function screenshots(page, directory, before) {
	fs.mkdirSync(directory, { recursive: true });
	const index = [];
	const shot = async name => {
		await page.waitForTimeout(180);
		const file = name.replaceAll(' ', '-').toLowerCase() + '.png';
		await page.locator('#designPanel').screenshot({ path: path.join(directory, file) });
		index.push({ name, file });
	};
	await page.evaluate(() => window.editor.glitterLibrary.browser.setState('CATEGORY_DETAIL', 'sparkle'));
	if (!before) {
		const wall = await page.evaluate(() => {
			const b = window.editor.glitterLibrary.browser;
			while (b.currentOffset < b.getPagedItemCount()) b.loadNextBatch();
			return { count: b.wallItems.length, ids: b.wallItems.map(item => item.id), columns: getComputedStyle(b.elements.itemGrid).gridTemplateColumns, gap: getComputedStyle(b.elements.itemGrid).gap };
		});
		assert.strictEqual(wall.count, 104, 'Real Classic Sparkle wall must have 104 tiles');
		assert.strictEqual(wall.gap, '2px', 'Wall density did not apply');
		assert(wall.columns.split(' ').length >= 4, 'Wall is not dense enough');
	}
	await shot('Root All');
	await page.evaluate(before => {
		const b = window.editor.glitterLibrary.browser;
		b.navigateToCategory('sparkelies');
	}, before);
	await shot('Set credit');
	await page.evaluate(before => {
		const b = window.editor.glitterLibrary.browser;
		b.browseView = 'creator'; b.setState('CATEGORY_LIST');
		if (!before) {
			const select = b.rail.field;
			select.value = 'aylana';
			select.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}, before);
	await shot('Creator view');
	await page.evaluate(() => {
		const library = window.editor.glitterLibrary;
		library.activeFilters.search = 'pink'; library.browser.setState('SEARCH_RESULTS');
	});
	await shot('Search results');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.evaluate(() => {
		const e = window.editor;
		e.glitterLibrary.activeFilters.search = '';
		e.glitterLibrary.browser.browseView = 'style';
		e.glitterLibrary.browser.setState('CATEGORY_DETAIL', 'sparkle');
		e.mobileManager.openDrawer('design');
	});
	await shot('Mobile drawer');
	for (const width of [1280, 390]) {
		await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
		for (const prefix of ['glitter', 'sticker', 'brushTip', 'shape', 'font']) {
			await page.evaluate(({ prefix, before, width }) => {
				const e = window.editor;
				const manager = { glitter: e.glitterLibrary, sticker: e.stickerLibrary, brushTip: e.brushTipManager, shape: e.shapeBrowserManager, font: e.fontBrowserManager }[prefix];
				manager.activeFilters.search = '';
				const b = manager.browser;
				b.browseView = 'style';
				if (!before) b.rail.selection = { root: LIBRARY_ALL_ID, set: null };
				b.setState('CATEGORY_LIST');
				document.getElementById('designGallerySection').dataset.pickerLibrary = prefix;
				syncLibraryView();
				if (width === 390) e.mobileManager.openDrawer('design');
				else e.mobileManager.closeAllDrawers();
			}, { prefix, before, width });
			await shot(`${prefix} home ${width}`);
		}
	}
	if (!before || process.env.GLITTER_TEST_BASELINE) {
		for (const theme of ['dark', 'light']) {
			for (const width of [1280, 390]) {
				await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
				for (const prefix of ['glitter', 'sticker', 'brushTip', 'shape', 'font']) {
					await page.evaluate(({ prefix, theme, width }) => {
						const e = window.editor;
						const manager = { glitter: e.glitterLibrary, sticker: e.stickerLibrary, brushTip: e.brushTipManager, shape: e.shapeBrowserManager, font: e.fontBrowserManager }[prefix];
						document.documentElement.dataset.theme = theme;
						PREFERENCES.set('libraryHome', { ...PREFERENCES.get('libraryHome'), [prefix]: 'categories' });
						manager.setLibraryIds('libraryRecents', manager.getAllContent().slice(0, 3).map(item => item.id));
						manager.browser.browseView = 'style'; manager.browser.rail.select(LIBRARY_ALL_ID);
						document.getElementById('designGallerySection').dataset.pickerLibrary = prefix; syncLibraryView();
						if (width === 390) e.mobileManager.openDrawer('design');
						else e.mobileManager.closeAllDrawers();
					}, { prefix, theme, width });
					await shot(`${prefix} categories ${theme} ${width}`);
				}
			}
		}
	}
	if (!before || process.env.GLITTER_TEST_BASELINE) {
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.evaluate(async () => {
			document.documentElement.dataset.theme = 'dark';
			window.editor.mobileManager.closeAllDrawers();
			await window.editor.fontBrowserManager.ensureSamplesLoaded();
		});
		for (const prefix of ['shape', 'font']) {
			await page.evaluate(prefix => {
				document.getElementById('designGallerySection').dataset.pickerLibrary = prefix; syncLibraryView();
				window.editor.setCollapsibleSectionOpen('designGallery', true, true);
			}, prefix);
			await page.locator(`#${prefix}Browser .asset-browser-rail select`).click();
			await shot(`${prefix} category picker`);
			await page.locator(`#${prefix}Browser .asset-browser-rail select`).click();
		}
		await page.evaluate(() => {
			const section = document.getElementById('designGallerySection');
			section.dataset.pickerLibrary = 'font'; section.classList.add('library-search-open'); syncLibraryView();
			window.editor.fontBrowserManager.ui.filterToggle.click();
		});
		await shot('Font source filters');
	}
	fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify(index, null, 2));
}

async function captureComparison(browser) {
	for (const before of [true, false]) {
		const opened = await openPage(browser, before, true);
		await screenshots(opened.page, path.join(root, '.tmp/asset-library', before ? 'before' : 'after'), before);
		assert.deepStrictEqual(opened.errors, []);
		await opened.page.close();
	}
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
		if (process.argv.includes('--screenshots-only')) {
			await captureComparison(browser);
			console.log('PASS real wall counts/density and library before/after captures');
			return;
		}
		const { page, errors } = await openPage(browser);
		const result = await page.evaluate(async () => {
			const e = window.editor, library = e.glitterLibrary, b = library.browser;
			const expect = (condition, message) => { if (!condition) throw new Error(message); };
			const selectionEditor = { originalCanvas: { width: 2, height: 2 }, originalImageData: { data: new Uint8ClampedArray([255,0,0,255, 0,0,255,255, 0,0,255,255, 255,0,0,255]) }, originalAlphaChannel: new Uint8Array([255,255,255,255]) };
			const selection = { settings: { threshold: 0, contiguous: false }, selections: [{ x: 0, y: 0, r: 255, g: 0, b: 0 }] };
			expect(String(buildColorSelectionMask(selectionEditor, selection)) === '255,0,0,255', 'Noncontiguous color selection changed');
			selection.settings.contiguous = true;
			expect(String(buildColorSelectionMask(selectionEditor, selection)) === '255,0,0,0', 'Contiguous color selection changed');
			const feathered = new Uint8Array([255,0,0,0]);
			featherColorSelection(selectionEditor, feathered, 1);
			expect(String(feathered) === '64,64,64,64', 'Selection feather changed');
			expect(library instanceof ContentManager && !(e.glitterManager instanceof ContentManager), 'Glitter owners were not split');
			expect(e.stickerLibrary instanceof ContentManager && !(e.stickerManager instanceof ContentManager), 'Sticker owners were not split');
			expect(!b.viewControl.hidden, 'Creator view control is hidden');
			// Row 0 picks a root's first entry; row 1 picks a set (or '' for all) under the current root.
			const choose = (row, id) => {
				const select = b.rail.field;
				const root = row ? b.rail.selection.root : id;
				const option = [...select.options].find(entry => entry.dataset.root === root && (!row || (entry.dataset.set || '') === id));
				select.value = option.value;
				select.dispatchEvent(new Event('change', { bubbles: true }));
			};
			expect(b.rail.selection.root === '__all' && b.rail.selection.set === null, 'Must open on All styles');
			expect(b.homeCategories && b.elements.categoryGrid.querySelectorAll('.category-card').length === 2, 'Glitter must open on compact style covers');
			PREFERENCES.set('libraryHome', { glitter: 'everything' });
			expect(b.wallGroups && b.elements.searchResults.querySelectorAll('.category-section').length === b.wallGroups.length, 'Everything must group by style');
			for (const group of b.wallGroups) {
				const heading = b.elements.searchResults.querySelector(`[data-category-id="${group.id}"] .category-section-header`);
				expect(heading.querySelector('.asset-set-header-title').textContent === group.name, 'Grouped heading lost category name');
				expect(heading.querySelector('.asset-set-header-count').textContent === `${group.items.length} ${group.items.length === 1 ? 'item' : 'items'}`, 'Grouped count must use items formatting');
				expect(!heading.querySelector('button') && getComputedStyle(heading).textTransform === 'none', 'Grouped headings must be sentence case without order controls');
			}
			choose(0, 'sparkle');
			expect(b.wallItems.length === 4 && !b.wallGroups, 'Style wall must hold every set\'s tiles');
			expect(b.wallItems.map(item => item.id).join() === '9001,9002,9003,9004', 'Wall must keep library order');
			expect(b.rail.field.querySelector('option[value="sparkle"]').textContent.includes('4'), 'Root count is wrong');
			const clickSet = id => choose(1, id);
			clickSet('bring-on-the-glitter');
			expect(b.setHeader.element.textContent.includes('By Aylana'), 'Missing set header');
			expect(b.setHeader.element.querySelector('.asset-collection-credit') && !b.setHeader.element.querySelector('details'), 'Credit must be always visible');
			expect(b.carriedLead.querySelectorAll('.asset-option').length === 2, 'Missing carried-over tiles');
			expect(!b.carriedLead.querySelector('.asset-grid .asset-grid'), 'Carried grid is nested');
			expect(b.wallItems.length === 1, 'Set wall includes borrowed tiles');
			library.content.push({ ...library.getItemById(9004), id: 9902, originalOrder: null });
			library.content.push({ ...library.getItemById(9004), id: 9901, originalOrder: 1 });
			b.refresh();
			expect(b.wallItems.map(item => item.id).join() === '9004,9902,9901', 'Set wall must keep library order');
			b.setHeader.element.querySelector('button').click();
			expect(b.wallItems.map(item => item.id).join() === '9901,9004,9902', 'Original order must sort recorded values before missing values');
			library.content = library.content.filter(item => item.id < 9900);
			expect(b.setHeader.originalOrder, 'Original order toggle failed');
			clickSet('');
			expect(b.rail.selection.set === null && !b.setHeader.originalOrder && b.wallItems.length === 4, 'All sets must reset set and order');
			clickSet('sparkelies');
			choose(0, 'transparent');
			expect(b.rail.selection.root === 'transparent' && b.rail.selection.set === null && b.wallItems.length === 1, 'A style that is all one set stands alone');
			expect(b.setHeader.element.textContent.includes('Transparent') && b.setHeader.element.textContent.includes('By Aylana'), 'A one-set style must carry the set credit');
			library.activeFilters.colors.add('pink');
			b.refresh();
			expect(b.rail.field.options.length === 2 && b.rail.selection.root === 'transparent', 'Color-filtered roots/counts are wrong');
			expect(!library.activeFilters.categories.size, 'Rail must not write category filters');
			library.activeFilters.colors.clear();
			library.activeFilters.special.add('multicolor');
			b.refresh();
			expect(!b.rail.field.options.length && b.elements.emptyState.classList.contains('visible'), 'Zero-count chips must hide');
			library.clearFilters();
			library.activeFilters.search = 'blue-08';
			b.setState('SEARCH_RESULTS');
			expect(b.rail.element.hidden && b.setHeader.element.hidden, 'Search must hide rails');
			expect(library.applyFilters().length === 1, 'Search should match later original name once');
			expect(b.elements.searchResults.textContent.includes('Classic Sparkle'), 'Search group lacks its style');
			library.activeFilters.search = 'sparkelies';
			expect(library.applyFilters().length === 1 && library.applyFilters()[0].id === 9003, 'Search must match a set name');
			library.activeFilters.search = 'blue-08';
			library.activeFilters.nameOnly = true;
			expect(library.applyFilters().length === 1, 'Name-only search lost original names');
			library.activeFilters.search = 'pink-001';
			expect(library.applyFilters()[0].id === 9004, 'Search must match home original name');
			library.clearFilters();
			b.setState('CATEGORY_LIST');
			expect(!b.rail.element.hidden, 'Clearing search did not restore rails');
			b.browseView = 'creator'; b.setState('CATEGORY_LIST');
			expect(new Set([...b.rail.field.options].map(option => option.dataset.root)).size === 5, 'Expected All creators, three creators and Unknown');
			expect(b.rail.field.querySelectorAll('optgroup').length === 2 && b.rail.field.querySelector(':scope > option').value === '__all', 'Creator home must precede grouped creators');
			choose(0, 'aylana');
			expect(b.wallItems.length === 2, 'Creator All must cross styles');
			clickSet('sparkle');
			expect(b.wallItems.length === 1 && b.setHeader.element.textContent.includes('Aylana'), 'Creator style must carry the set credit');
			choose(0, '__unknown');
			expect(b.wallItems.length === 1 && b.wallItems[0].id === 9001, 'Unknown leaked attributed tiles');
			b.browseView = 'style'; b.setState('CATEGORY_LIST');
			PREFERENCES.set('libraryFavorites', { glitter: [9003] });
			b.browseView = 'favorites'; b.setState('CATEGORY_LIST');
			expect(b.rail.element.hidden && b.wallItems.length === 1 && b.wallItems[0].id === 9003, 'Favorites view failed');
			await b.navigateToItem(9002);
			expect(b.rail.selection.root === 'sparkle' && b.rail.selection.set === null, 'Go-to-asset did not open the style');
			expect(b.elements.itemGrid.querySelector('[data-id="9002"]'), 'Go-to-asset did not render tile');
			const browsers = [b, e.stickerLibrary.browser, e.brushTipManager.browser, e.shapeBrowserManager.browser, e.fontBrowserManager.browser];
			for (const browser of browsers) {
				browser.browseView = 'style';
				browser.rail.mode = 'style';
				browser.rail.selection = { root: LIBRARY_ALL_ID, set: null };
				browser.setState('CATEGORY_LIST');
				expect(!browser.toolbar.hidden && !browser.rail.element.hidden && browser.rail.upButton.disabled, `${browser.prefix}: home toolbar`);
				expect(browser.viewControl.querySelector('[data-view="favorites"]'), `${browser.prefix}: Favorites segment missing`);
				const manager = browser.contentManager;
				const first = manager.getAllContent()[0];
				expect(first, `${browser.prefix}: empty fixture`);
				const savedRecents = PREFERENCES.get('libraryRecents');
				PREFERENCES.set('libraryRecents', { ...savedRecents, [browser.prefix]: [first.id] });
				browser.updateShortcuts();
				expect(!browser.shortcuts.hidden, `${browser.prefix}: home Quick picks missing`);
				for (const view of ['categories', 'everything']) {
					PREFERENCES.set('libraryHome', { ...PREFERENCES.get('libraryHome'), [browser.prefix]: view });
					expect(browser.homeCategories === (view === 'categories' || browser.prefix === 'brushTip'), `${browser.prefix}: home option failed`);
					if (view === 'categories' || browser.prefix === 'brushTip') {
						const cover = browser.elements.categoryGrid.querySelector('.category-card');
						expect(cover, `${browser.prefix}: covers missing`);
						expect(cover.classList.contains('action-card') && /\d+ items?$/.test(cover.querySelector('.category-card-count').textContent), `${browser.prefix}: cover conventions`);
						cover.click();
						expect(browser.rail.selection.root !== LIBRARY_ALL_ID && browser.shortcuts.hidden, `${browser.prefix}: cover navigation`);
						while (!browser.rail.upButton.disabled) browser.rail.upButton.click();
						expect(browser.rail.selection.root === LIBRARY_ALL_ID, `${browser.prefix}: Up from cover`);
					} else {
						while (browser.currentOffset < browser.getPagedItemCount()) browser.loadNextBatch();
						expect(browser.getPagedItemCount() === manager.applyFilters().length, `${browser.prefix}: Everything cut off assets`);
					}
				}
				await browser.navigateToItem(first.id);
				expect(browser.findItemElement(first) && browser.shortcuts.hidden, `${browser.prefix}: go-to-asset`);
				while (!browser.rail.upButton.disabled) browser.rail.upButton.click();
				expect(browser.rail.selection.root === LIBRARY_ALL_ID, `${browser.prefix}: Up to home`);
				PREFERENCES.set('libraryFavorites', { ...PREFERENCES.get('libraryFavorites'), [browser.prefix]: [first.id] });
				browser.viewControl.querySelector('[data-view="favorites"]').click();
				expect(browser.wallItems.length === 1 && browser.rail.element.hidden && browser.shortcuts.hidden, `${browser.prefix}: Favorites`);
				browser.viewControl.querySelector('[data-view="style"]').click();
				manager.activeFilters.search = first.name;
				browser.setState('SEARCH_RESULTS');
				expect(browser.toolbar.hidden && browser.shortcuts.hidden && browser.elements.searchResults.classList.contains('visible'), `${browser.prefix}: search`);
				browser.elements.backBtn.click();
				expect(browser.state === 'CATEGORY_LIST' && !browser.toolbar.hidden, `${browser.prefix}: search return`);
			}
			const fonts = e.fontBrowserManager;
			const system = fonts.ui.filtersContainer.querySelector('[data-filter="font-source"][data-value="system"]');
			const bundled = fonts.ui.filtersContainer.querySelector('[data-filter="font-source"][data-value="bundled"]');
			expect(system && bundled, 'Font Source filter missing');
			system.click();
			expect(fonts.applyFilters().length > 0 && fonts.applyFilters().every(item => item.font.system), 'System Source filter failed');
			bundled.click();
			expect(fonts.applyFilters().length === fonts.content.length, 'Combined font sources must show all');
			system.click();
			expect(fonts.applyFilters().length > 0 && fonts.applyFilters().every(item => !item.font.system), 'Bundled Source filter failed');
			fonts.activeFilters.scripts.add('ja');
			expect(fonts.applyFilters().every(item => !item.font.system && item.scripts.includes('ja')), 'Source did not combine with Language');
			fonts.clearFilters();
			expect(!fonts.activeFilters.sources.size && fonts.applyFilters().length === fonts.content.length, 'Source clear failed');
			for (const manager of [e.shapeBrowserManager, fonts]) {
				const b = manager.browser;
				b.browseView = 'style'; b.rail.select(LIBRARY_ALL_ID);
				for (const category of b.categories) {
					const option = [...b.rail.field.options].find(row => row.dataset.root === category.id);
					expect(option.querySelector('.asset-browser-rail-preview'), `${b.prefix}: category preview missing`);
					if (b.prefix === 'font') {
						expect(option.querySelector('svg path'), 'Font picker must use outlined lettering');
						expect(option.textContent.trim().startsWith(category.name), 'Font preview polluted native option label');
					} else expect(option.querySelector('svg'), 'Shape picker must use SVG geometry');
				}
			}
			const stickerManager = e.stickerLibrary;
			const upload = { ...stickerManager.content[0], id: 'test-upload', category: 'user-uploads', isAnimated: true, isPixelated: true };
			stickerManager.userContent.push(upload);
			stickerManager.browser.browseView = 'style';
			stickerManager.browser.rail.select(LIBRARY_ALL_ID);
			expect(stickerManager.browser.rail.field.options[1].dataset.root === 'user-uploads', 'User Uploads must be first');
			await stickerManager.browser.navigateToItem(upload.id);
			const uploadCard = stickerManager.browser.findItemElement(upload);
			expect(uploadCard.classList.contains('animated') && uploadCard.classList.contains('pixelated'), 'Sticker thumbnail flags lost');
			stickerManager.userContent = stickerManager.userContent.filter(item => item !== upload);
			stickerManager.browser.refresh();
			expect(e.shapeBrowserManager.browser.elements.browser.querySelector('.asset-option .brush-shape-option-icon'), 'Shape icon cards lost');
			expect(e.fontBrowserManager.browser.elements.browser.querySelector('.asset-option .text-font-option-sample'), 'Font sample cards lost');
			const brushes = e.brushTipManager.browser;
			PREFERENCES.set('libraryHome', { ...PREFERENCES.get('libraryHome'), brushTip: 'categories' });
			brushes.rail.select(LIBRARY_ALL_ID);
			expect(!brushes.indexLead.hidden && brushes.indexLead.querySelector('.brush-basic-grid'), 'Basic brushes missing above covers');
			const pack = brushes.categories.find(category => category.parent === 'raster');
			expect(brushes.rail.field.options[1].dataset.root === 'basic', 'Basic brushes must precede Raster sets in the dropdown');
			for (const view of ['categories', 'everything']) {
				PREFERENCES.set('libraryHome', { ...PREFERENCES.get('libraryHome'), brushTip: view });
				brushes.rail.select(LIBRARY_ALL_ID);
				const cards = [...brushes.elements.categoryGrid.children];
				expect(cards.length === brushes.catalog.getSets('raster').length, 'Brush Home must show each Raster set as a card');
				expect(cards.every(card => card.dataset.categoryId !== 'raster'), 'Brush Home must not wrap packs in one Raster card');
				expect(!brushes.elements.itemGrid.children.length && !brushes.elements.searchResults.children.length, 'Brush Home expanded raster assets');
				cards[0].click();
				expect(brushes.rail.selection.set && brushes.elements.itemGrid.querySelector('.asset-option'), 'Pack card must open its brushes');
			}
			expect(brushes.rail.field.querySelector('optgroup[label="Raster brush sets"] option[value="raster"]'), 'All Raster brush sets missing');
			expect(brushes.rail.field.querySelector(`option[value="raster/${pack.id}"]`), 'Raster subtype missing');
			brushes.navigateToCategory(pack.id);
			expect(brushes.setHeader.element.querySelector('.asset-collection-credit'), 'Brush pack credit missing');
			brushes.rail.upButton.click();
			expect(brushes.rail.selection.root === 'raster' && !brushes.rail.selection.set, 'Brush subtype Up skipped Raster all');
			expect(brushes.homeCategories && brushes.elements.categoryGrid.children.length, 'Raster All must show pack cards');
			expect(brushes.indexLead.hidden && !brushes.elements.itemGrid.children.length && !brushes.elements.searchResults.children.length, 'Raster All expanded brushes');
			brushes.rail.upButton.click();
			expect(brushes.rail.selection.root === LIBRARY_ALL_ID, 'Raster All Up missed home');
			b.browseView = 'style'; b.rail.select(LIBRARY_ALL_ID);
			const provenance = library.createAssetProvenance(library.getItemById(9002)).textContent;
			expect(provenance.includes('Original name: Sparkbutton-gray') && provenance.includes('First published by Mica') && provenance.includes("Also in Aylana's Bring On The Glitter as blue-08"), 'Lineage text is incomplete');
			b.browseView = 'style'; b.setState('CATEGORY_LIST');
			e.glitterManager.armAssetPicker();
			await library.selectGlitter(9004);
			expect(e.layerManager.getActiveLayer().fill.glitterId === 9004, 'Browser pick did not update fill layer');
			e.glitterManager.closePickerSession?.();
			const auto = e.autoGlitterManager;
			const savedAuto = { session: auto.session, result: auto.result, pickerSession: auto.pickerSession, renderReviewResults: auto.renderReviewResults };
			auto.session = {};
			auto.result = { palette: [{ selectedGlitterId: 9004 }] };
			auto.pickerSession = { paletteIndex: 0 };
			auto.renderReviewResults = () => {};
			b.navigateToCategory('sparkelies');
			await library.selectGlitter(9003);
			expect(auto.result.palette[0].selectedGlitterId === 9003 && e.layerManager.getActiveLayer().fill.glitterId === 9004, 'Auto Glitter pick leaked into layer');
			expect(b.elements.itemGrid.querySelector('[data-id="9003"]')?.classList.contains('selected'), 'Auto Glitter selection missing');
			Object.assign(auto, savedAuto);
			library.clearFilters();
			b.setState('CATEGORY_DETAIL', 'sparkelies');
			await new Promise(resolve => setTimeout(resolve, 350));
			expect(b.currentCategoryId === 'sparkelies', 'A cleared search timer undid category navigation');
			return 'All five libraries: home options, paging, category/creator/Favorites/search navigation, kind-specific cards, Quick picks, lineage and picker routing';
		});
		await page.evaluate(async () => {
			const library = window.editor.glitterLibrary, b = library.browser;
			library.setLibraryIds('libraryRecents', [9002, 9003]);
			b.browseView = 'style'; b.rail.select(LIBRARY_ALL_ID);
			const order = () => [...b.shortcutGrid.children].map(tile => tile.dataset.id).join();
			const before = order();
			const picked = b.shortcutGrid.querySelector('[data-id="9003"]');
			picked.click();
			await new Promise(resolve => setTimeout(resolve, 250));
			if (order() !== before || b.shortcutGrid.querySelector('[data-id="9003"]') !== picked) throw new Error('Clicking Quick picks moved or recreated its tile');
			if (library.getLibraryIds('libraryRecents')[0] !== 9003) throw new Error('Stable Quick picks stopped saving recency');
		});
		await page.evaluate(() => {
			const library = window.editor.glitterLibrary, b = library.browser;
			for (let i = 0; i < 120; i++) library.content.push({ ...library.content[0], id: 10000 + i, category: 'sparkle' });
			b.navigateToCategory('sparkle');
			while (b.currentOffset < b.wallItems.length) b.loadNextBatch();
			b.scrollContainer.scrollTop = 300;
			const tile = b.elements.itemGrid.querySelector('[data-id="10050"]');
			const scrollTop = b.scrollContainer.scrollTop, offset = b.currentOffset;
			library.toggleFavorite(9003);
			if (b.elements.itemGrid.querySelector('[data-id="10050"]') !== tile || b.currentOffset !== offset || b.scrollContainer.scrollTop !== scrollTop) throw new Error('Favorite update rebuilt or moved the current wall');
			window.editor.layerManager.getActiveLayer().fill.glitterId = 9002;
			window.dispatchEvent(new CustomEvent('layerChanged'));
			if (!b.shortcuts.hidden) throw new Error('Project shortcuts appeared off home');
			if (b.elements.itemGrid.querySelector('[data-id="10050"]') !== tile || b.scrollContainer.scrollTop !== scrollTop) throw new Error('Project update rebuilt or moved the wall');
			b.rail.select(LIBRARY_ALL_ID);
			if (!b.shortcuts.querySelector('[data-id="9002"]')) throw new Error('Project shortcuts did not update on home');
			const projectTile = b.shortcuts.querySelector('[data-id="9002"]');
			b.updateShortcuts();
			if (b.shortcuts.querySelector('[data-id="9002"]') !== projectTile) throw new Error('Unchanged project shortcut was recreated');
			PREFERENCES.set('libraryFavorites', { glitter: [9002, 9003] });
			b.browseView = 'favorites'; b.setState('CATEGORY_LIST');
			const kept = b.elements.itemGrid.querySelector('[data-id="9003"]');
			library.toggleFavorite(9002);
			if (b.elements.itemGrid.querySelector('[data-id="9003"]') !== kept) throw new Error('Removing a favorite rebuilt the remaining tiles');
			library.toggleFavorite(9003);
			if (b.browseView !== 'favorites' || b.wallItems.length) throw new Error('Removing the last favorite navigated away');
			library.toggleFavorite(9002);
			if (!b.elements.itemGrid.querySelector('[data-id="9002"]') || b.elements.emptyState.classList.contains('visible')) throw new Error('Adding a favorite did not update the empty Favorites wall');
		});
		await page.evaluate(() => window.editor.glitterLibrary.browser.viewControl.querySelector('[data-view="style"]').click());
		await page.locator('#glitterBrowser .asset-browser-rail select').first().selectOption('sparkle/sparkelies');
		await page.reload({ waitUntil: 'networkidle' });
		await page.waitForFunction(() => window.editor?.glitterLibrary?.browser?.rail);
		assert.strictEqual(await page.evaluate(() => window.editor.glitterLibrary.browser.rail.selection.root), '__all', 'Library must reopen on All styles');
		await page.evaluate(async () => {
			const e = window.editor;
			await e.loadBlankImage(240, 180, '#ffffff');
			e.layerManager.insertLayer(e.glitterManager.createLayer());
			e.layerManager.setActiveLayer(e.layers.at(-1).id);
			e.setCollapsibleSectionOpen('designGallery', true, true);
			document.querySelectorAll('.modal-overlay.visible').forEach(modal => modal.classList.remove('visible'));
		});
		const rootSelect = page.locator('#glitterBrowser .asset-browser-rail select').first();
		await rootSelect.focus();
		await rootSelect.selectOption('sparkle');
		assert.strictEqual(await rootSelect.evaluate(select => select === document.activeElement), true, 'Selection lost keyboard focus');
		await page.evaluate(() => {
			const e = window.editor, section = document.getElementById('designGallerySection');
			for (const manager of [e.glitterLibrary, e.stickerLibrary, e.brushTipManager, e.shapeBrowserManager, e.fontBrowserManager]) {
				const b = manager.browser;
				section.dataset.pickerLibrary = b.prefix; syncLibraryView();
				PREFERENCES.set('libraryHome', { ...PREFERENCES.get('libraryHome'), [b.prefix]: 'categories' });
				manager.setLibraryIds('libraryRecents', manager.getAllContent().slice(0, 3).map(item => item.id));
				b.browseView = 'style'; b.rail.select(LIBRARY_ALL_ID);
				const cover = b.elements.categoryGrid.querySelector('.category-card');
				const asset = b.shortcutGrid.querySelector('.asset-option');
				if (cover.getBoundingClientRect().width <= asset.getBoundingClientRect().width) throw new Error(`${b.prefix}: category cover is not larger than assets`);
				if (getComputedStyle(b.shortcuts).borderBottomStyle !== 'solid') throw new Error(`${b.prefix}: Quick picks lack a boundary`);
			}
			const shape = e.shapeBrowserManager.browser;
			for (const theme of ['dark', 'light']) {
				document.documentElement.dataset.theme = theme;
				const svg = shape.elements.categoryGrid.querySelector('.brush-shape-option-icon svg');
				if (getComputedStyle(svg).fill !== getComputedStyle(shape.elements.categoryGrid.querySelector('.action-card-title')).color) throw new Error(`${theme}: shape cover ignores theme color`);
			}
			document.documentElement.dataset.theme = 'dark';
			const current = document.querySelector('#libraryViewMenuPanel [data-home-view="categories"] .app-menu-item-current use');
			if (current?.getAttribute('href') !== '#icon-check') throw new Error('Home menu lacks its check icon');
			for (const mark of document.querySelectorAll('#libraryViewMenuPanel .app-menu-item-current')) {
				if (mark.querySelector('use')?.getAttribute('href') !== '#icon-check') throw new Error('Library menu checkmarks are inconsistent');
			}
			section.dataset.pickerLibrary = 'glitter'; syncLibraryView();
			e.glitterLibrary.browser.navigateToCategory('sparkle');
		});
		await page.setViewportSize({ width: 390, height: 844 });
		assert.strictEqual(await rootSelect.evaluate(select => select.scrollWidth <= select.clientWidth), true, 'Mobile category field overflows');
		for (const prefix of ['glitter', 'sticker', 'brushTip', 'shape', 'font']) {
			await page.evaluate(prefix => {
				const e = window.editor;
				document.getElementById('designGallerySection').dataset.pickerLibrary = prefix;
				syncLibraryView();
				e.mobileManager.openDrawer('design');
			}, prefix);
			const picker = page.locator(`#${prefix}Browser .asset-browser-rail select`);
			assert.strictEqual(await picker.isVisible(), true, `${prefix}: phone picker hidden`);
			assert.strictEqual(await picker.evaluate(select => select.scrollWidth <= select.clientWidth), true, `${prefix}: phone picker overflows`);
		}
		await page.evaluate(() => {
			document.getElementById('designGallerySection').dataset.pickerLibrary = 'glitter'; syncLibraryView();
			const b = window.editor.glitterLibrary.browser;
			PREFERENCES.set('libraryHome', { ...PREFERENCES.get('libraryHome'), glitter: 'categories' });
			b.rail.select(LIBRARY_ALL_ID);
			const columns = () => getComputedStyle(b.elements.categoryGrid).gridTemplateColumns.split(' ').length;
			PREFERENCES.set('libraryTileSize', 's');
			const small = columns();
			PREFERENCES.set('libraryTileSize', 'l');
			if (small <= columns()) throw new Error('Phone covers ignore tile size');
			PREFERENCES.set('libraryTileSize', 'm');
			PREFERENCES.set('libraryHome', { ...PREFERENCES.get('libraryHome'), glitter: 'everything' });
		});
		await page.evaluate(() => {
			const section = document.getElementById('designGallerySection');
			section.dataset.pickerLibrary = 'font'; syncLibraryView();
			const glitterHome = getLibraryHomeView('glitter');
			document.querySelector('#libraryViewMenuPanel [data-home-view="categories"]').click();
			if (getLibraryHomeView('font') !== 'categories' || getLibraryHomeView('glitter') !== glitterHome) throw new Error('Home menu wrote the wrong kind');
			section.dataset.pickerLibrary = 'glitter'; syncLibraryView();
		});
		await page.waitForTimeout(0);
		assert.strictEqual(await page.locator('#libraryViewMenuPanel [data-home-view="everything"]').getAttribute('aria-current'), 'true', 'Home menu did not sync to the active kind');
		await page.reload({ waitUntil: 'networkidle' });
		await page.waitForFunction(() => window.editor?.fontBrowserManager?.browser?.rail);
		assert.deepStrictEqual(await page.evaluate(() => ({ font: getLibraryHomeView('font'), glitter: getLibraryHomeView('glitter') })), { font: 'categories', glitter: 'everything' }, 'Per-kind home choices were not remembered');
		await page.setViewportSize({ width: 1280, height: 900 });
		const shortcuts = page.locator('#glitterBrowser .asset-browser-shortcuts');
		await page.evaluate(() => PREFERENCES.set('libraryQuickPicks', false));
		assert.strictEqual(await shortcuts.isVisible(), false, 'Quick picks preference did not hide the row');
		await page.evaluate(() => PREFERENCES.set('libraryQuickPicks', true));
		await page.evaluate(() => PREFERENCES.set('libraryTileSize', 'l'));
		assert.strictEqual(await page.locator('#designGallerySection').getAttribute('data-tile-size'), 'l', 'Tile size preference did not reach the Library');
		await page.evaluate(() => PREFERENCES.set('libraryTileSize', 'm'));
		assert.deepStrictEqual(errors, [], 'App raised browser errors: ' + JSON.stringify(errors));
		if (process.argv.includes('--screenshots')) await captureComparison(browser);
		console.log('PASS ' + result);
	} finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exit(1); });
