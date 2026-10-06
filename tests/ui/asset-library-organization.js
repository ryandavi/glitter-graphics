'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'data/glitter.index.json'), 'utf8'))[0];
const categories = [
	{ id: 'sparkle', name: 'Classic Sparkle', parent: null },
	{ id: 'stardrops', name: "Stardrops' Open Directory", parent: 'sparkle', attribution: { author: 'Mica', authorId: 'mica', source: 'Stardrops', sourceId: 'stardrops' } },
	{ id: 'sparkelies', name: 'Sparkelies', parent: 'sparkle', attribution: { author: 'DAN-411', authorId: 'dan', source: 'Sparkelies', sourceId: 'sparkelies' } },
	{ id: 'bring-on-the-glitter', name: 'Bring On The Glitter', parent: 'sparkle', attribution: { author: 'Aylana', authorId: 'aylana', source: 'Bring On The Glitter', sourceId: 'bring-on-the-glitter' } },
	{ id: 'clear', name: 'Clear', parent: 'transparent', attribution: { author: 'Aylana', authorId: 'aylana', source: 'Second source', sourceId: 'other-source' } },
	{ id: 'transparent', name: 'Transparent', parent: null },
	{ id: 'empty', name: 'Empty', parent: null },
].map(category => ({ icon: source.url, ...category }));
const items = [
	{ id: 9001, name: 'Unknown glitter', category: 'sparkle' },
	{ originalOrder: 20, id: 9002, name: 'Spark Button', category: 'stardrops', originalName: 'Sparkbutton-gray', appearances: [{ set: 'bring-on-the-glitter', originalName: 'blue-08' }] },
	{ originalOrder: 30, id: 9003, name: 'Ruby', category: 'sparkelies', originalName: 'ruby', appearances: [{ set: 'bring-on-the-glitter', originalName: 'red-02' }] },
	{ originalOrder: 10, id: 9004, name: 'Muted Pink', category: 'bring-on-the-glitter', originalName: 'pink-001' },
	{ tags: ['Pink'], id: 9005, name: 'Clear Pink', category: 'clear', originalName: 'clear-01' },
].map(item => ({ ...source, tags: [], searchTerms: [], ...item }));

async function openPage(browser, before = false, real = false) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	if (!real) await page.route('**/data/glitter.index.json*', route => route.fulfill({ json: items }));
	if (!real) await page.route('**/data/glitter-categories.json*', route => route.fulfill({ json: categories }));
	if (!real) await page.route('**/data/glitter/900*.json*', route => {
		const id = Number(new URL(route.request().url()).pathname.match(/(900\d)\.json/)[1]);
		return route.fulfill({ json: items.find(item => item.id === id) });
	});
	if (before) {
		for (const file of ['js/assets/AssetBrowser.js', 'js/ui/asset-browser-markup.js']) {
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
		b.setState('CATEGORY_DETAIL', 'sparkelies');
		if (!before) b.setHeader.element.querySelector('details').open = true;
	}, before);
	await shot('Set credit');
	await page.evaluate(before => {
		const b = window.editor.glitterLibrary.browser;
		b.browseView = 'creator'; b.setState('CATEGORY_LIST');
		if (!before) {
			const select = b.rail.rows[0].querySelector('select');
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
			console.log('PASS real wall counts/density and five before/after captures');
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
			expect(b.rail.selection.root === 'sparkle' && b.rail.selection.set === null, 'Must open on first root All');
			expect(b.elements.categoryGrid.querySelectorAll('.category-card').length === 0, 'Glitter still has cards');
			expect(b.wallItems.length === 4, 'Root wall must include its sets');
			expect(b.rail.rows[0].querySelector('option[value="sparkle"]').textContent.includes('4'), 'Root count is wrong');
			const choose = (row, id) => { const select = b.rail.rows[row].querySelector('select'); select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); };
			const clickSet = id => choose(1, id);
			clickSet('bring-on-the-glitter');
			expect(b.setHeader.element.textContent.includes('by Aylana'), 'Missing set header');
			expect(!b.setHeader.element.querySelector('details').open, 'Credit must start closed');
			expect(b.carriedLead.querySelectorAll('.asset-option').length === 2, 'Missing carried-over tiles');
			expect(!b.carriedLead.querySelector('.asset-grid .asset-grid'), 'Carried grid is nested');
			expect(b.wallItems.length === 1, 'Set wall includes borrowed tiles');
			library.content.push({ ...library.getItemById(9004), id: 9901, originalOrder: 1, colorCodes: ['#000000'], _glitterColorOrder: null });
			library.content.push({ ...library.getItemById(9004), id: 9902, originalOrder: null, colorCodes: ['#ffffff'], _glitterColorOrder: null });
			b.refresh();
			b.setHeader.element.querySelector('button').click();
			expect(b.wallItems.map(item => item.id).join() === '9901,9004,9902', 'Original order must sort recorded values before missing values');
			library.content = library.content.filter(item => item.id < 9900);
			expect(b.setHeader.originalOrder, 'Original order toggle failed');
			clickSet('');
			expect(b.rail.selection.set === null && !b.setHeader.originalOrder && b.wallItems.length === 4, 'All sets must reset set and order');
			clickSet('sparkelies');
			choose(0, 'transparent');
			expect(b.rail.selection.set === null && b.wallItems.length === 1, 'Root switch must reset set');
			library.activeFilters.colors.add('pink');
			b.refresh();
			expect(b.rail.rows[0].querySelector('select').options.length === 1 && b.rail.selection.root === 'transparent', 'Color-filtered roots/counts are wrong');
			expect(!library.activeFilters.categories.size, 'Rail must not write category filters');
			library.activeFilters.colors.clear();
			library.activeFilters.special.add('multicolor');
			b.refresh();
			expect(!b.rail.rows[0].querySelector('select').options.length && b.elements.emptyState.classList.contains('visible'), 'Zero-count chips must hide');
			library.clearFilters();
			library.activeFilters.search = 'blue-08';
			b.setState('SEARCH_RESULTS');
			expect(b.rail.element.hidden && b.setHeader.element.hidden, 'Search must hide rails');
			expect(library.applyFilters().length === 1, 'Search should match later original name once');
			expect(b.elements.searchResults.textContent.includes("Classic Sparkle › Stardrops' Open Directory"), 'Search group lacks path');
			library.activeFilters.nameOnly = true;
			expect(library.applyFilters().length === 1, 'Name-only search lost original names');
			library.activeFilters.search = 'pink-001';
			expect(library.applyFilters()[0].id === 9004, 'Search must match home original name');
			library.clearFilters();
			b.setState('CATEGORY_LIST');
			expect(!b.rail.element.hidden, 'Clearing search did not restore rails');
			b.browseView = 'creator'; b.setState('CATEGORY_LIST');
			expect(b.rail.rows[0].querySelector('select').options.length === 4, 'Expected three creators and Unknown');
			choose(0, 'aylana');
			expect(b.wallItems.length === 2, 'Creator All must cross styles');
			clickSet('bring-on-the-glitter');
			expect(b.wallItems.length === 1 && b.setHeader.element.textContent.includes('Aylana'), 'Creator set must use same header');
			choose(0, '__unknown');
			expect(b.wallItems.length === 1 && b.wallItems[0].id === 9001, 'Unknown leaked attributed tiles');
			b.browseView = 'style'; b.setState('CATEGORY_LIST');
			PREFERENCES.set('libraryFavorites', { glitter: [9003] });
			b.handleFavoritesChanged();
			choose(0, '__favorites');
			expect(b.wallItems.length === 1 && b.wallItems[0].id === 9003, 'Favorites rail failed');
			await b.navigateToItem(9002);
			expect(b.rail.selection.root === 'sparkle' && b.rail.selection.set === 'stardrops', 'Go-to-asset did not light chips');
			expect(b.elements.itemGrid.querySelector('[data-id="9002"]'), 'Go-to-asset did not render tile');
			const stickers = e.stickerLibrary.browser;
			expect(stickers.elements.categoryGrid.querySelector('.category-card'), 'Stickers lost folder cards');
			stickers.elements.categoryGrid.querySelector('.category-card').click();
			expect(stickers.state === 'CATEGORY_DETAIL', 'Sticker folder cannot open');
			const brushes = e.brushTipManager?.browser || e.brushTipLibrary?.browser;
			expect(brushes, 'Brush library missing');
			if (brushes) {
				expect(brushes.elements.categoryGrid.querySelector('.category-card'), 'Brush tips lost folder cards');
				brushes.elements.categoryGrid.querySelector('.category-card').click();
				expect(brushes.state === 'CATEGORY_DETAIL', 'Brush folder cannot open');
			}
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
			return 'Hierarchy, creators, paths, search, filtered counts, lineage, carried-over rows, navigation and picker routing';
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
			if (!b.projectLead.querySelector('[data-id="9002"]')) throw new Error('Project shortcuts did not update immediately');
			if (b.elements.itemGrid.querySelector('[data-id="10050"]') !== tile || b.scrollContainer.scrollTop !== scrollTop) throw new Error('Project update rebuilt or moved the wall');
			const projectTile = b.projectLead.querySelector('[data-id="9002"]');
			b.updateShortcuts();
			if (b.projectLead.querySelector('[data-id="9002"]') !== projectTile) throw new Error('Unchanged project shortcut was recreated');
			PREFERENCES.set('libraryFavorites', { glitter: [9002, 9003] });
			b.handleFavoritesChanged();
			b.rail.select('__favorites');
			const kept = b.elements.itemGrid.querySelector('[data-id="9003"]');
			library.toggleFavorite(9002);
			if (b.elements.itemGrid.querySelector('[data-id="9003"]') !== kept) throw new Error('Removing a favorite rebuilt the remaining tiles');
			library.toggleFavorite(9003);
			if (b.rail.selection.root !== '__favorites' || b.wallItems.length) throw new Error('Removing the last favorite navigated away');
			library.toggleFavorite(9002);
			if (!b.elements.itemGrid.querySelector('[data-id="9002"]') || b.elements.emptyState.classList.contains('visible')) throw new Error('Adding a favorite did not update the empty Favorites wall');
		});
		await page.locator('#glitterBrowser .asset-browser-rail select').first().selectOption('transparent');
		await page.reload({ waitUntil: 'networkidle' });
		await page.waitForFunction(() => window.editor?.glitterLibrary?.browser?.rail);
		assert.strictEqual(await page.evaluate(() => window.editor.glitterLibrary.browser.rail.selection.root), 'transparent', 'Remembered root was lost');
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
		await page.setViewportSize({ width: 390, height: 844 });
		assert.strictEqual(await rootSelect.evaluate(select => select.scrollWidth <= select.clientWidth), true, 'Mobile category field overflows');
		await page.waitForFunction(() => !window.editor.glitterLibrary.browser.shortcutDisclosure.open);
		await page.evaluate(() => { window.editor.glitterLibrary.browser.shortcutDisclosure.open = true; });
		assert.strictEqual(await page.locator('#glitterBrowser .asset-browser-shortcuts').evaluate(details => details.open), true, 'Mobile shortcuts cannot expand');
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.waitForFunction(() => window.editor.glitterLibrary.browser.shortcutDisclosure.open);
		assert.deepStrictEqual(errors, [], 'App raised browser errors: ' + JSON.stringify(errors));
		if (process.argv.includes('--screenshots')) await captureComparison(browser);
		console.log('PASS ' + result);
	} finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exit(1); });
