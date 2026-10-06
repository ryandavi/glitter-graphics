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
	{ id: 9002, name: 'Spark Button', category: 'stardrops', originalName: 'Sparkbutton-gray', appearances: [{ set: 'bring-on-the-glitter', originalName: 'blue-08' }] },
	{ id: 9003, name: 'Ruby', category: 'sparkelies', originalName: 'ruby', appearances: [{ set: 'bring-on-the-glitter', originalName: 'red-02' }] },
	{ id: 9004, name: 'Muted Pink', category: 'bring-on-the-glitter', originalName: 'pink-001' },
	{ id: 9005, name: 'Clear Pink', category: 'clear', originalName: 'clear-01' },
].map(item => ({ ...source, tags: [], searchTerms: [], ...item }));

async function openPage(browser, before = false) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	await page.route('**/data/glitter.index.json*', route => route.fulfill({ json: items }));
	await page.route('**/data/glitter-categories.json*', route => route.fulfill({ json: categories }));
	await page.route('**/data/glitter/900*.json*', route => {
		const id = Number(new URL(route.request().url()).pathname.match(/(900\d)\.json/)[1]);
		return route.fulfill({ json: items.find(item => item.id === id) });
	});
	if (before) await page.route('**/js/assets/AssetBrowser.js*', route => route.fulfill({ contentType: 'application/javascript', body: execFileSync('git', ['show', 'HEAD:js/assets/AssetBrowser.js'], { cwd: root }) }));
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
	for (const [name, state, category] of [['Style index', 'CATEGORY_LIST', null], ['Style root', 'CATEGORY_DETAIL', 'sparkle'], ['Set with lineage', 'CATEGORY_DETAIL', 'bring-on-the-glitter']]) {
		await page.evaluate(({ state, category }) => window.editor.glitterLibrary.browser.setState(state, category), { state, category });
		await page.waitForTimeout(120);
		const file = name.replaceAll(' ', '-').toLowerCase() + '.png';
		await page.locator('#designPanel').screenshot({ path: path.join(directory, file) });
		index.push({ name, file });
	}
	if (!before) {
		await page.evaluate(() => { const b = window.editor.glitterLibrary.browser; b.browseView = 'creator'; b.setState('CATEGORY_LIST'); });
		await page.locator('#designPanel').screenshot({ path: path.join(directory, 'creators.png') });
		index.push({ name: 'Creators', file: 'creators.png' });
	}
	fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify(index, null, 2));
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	try {
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
			expect(b.elements.categoryGrid.querySelectorAll('.category-card').length === 2, 'Index should show only nonempty roots');
			expect(b.elements.categoryGrid.querySelector('[data-category-id="sparkle"] .category-card-count').textContent === '4 items', 'Root count must include its sets');
			b.setState('CATEGORY_DETAIL', 'sparkle');
			expect(b.elements.categoryGrid.querySelectorAll('.category-card').length === 3, 'Root should show set cards');
			expect(b.collectionInfo.textContent.includes('More Classic Sparkle'), 'Missing own-tiles heading');
			expect(b.elements.itemGrid.querySelectorAll('.asset-option').length === 1, 'Root must show only own tiles');
			b.setState('CATEGORY_DETAIL', 'bring-on-the-glitter');
			expect(b.elements.title.textContent === 'Classic Sparkle › Bring On The Glitter', 'Set path missing');
			expect(b.carriedLead.querySelectorAll('.asset-option').length === 2, 'Carried-over row should show earlier-source tiles');
			expect(b.elements.itemGrid.querySelectorAll('.asset-option').length === 1, 'Borrowed tiles were counted as owned');
			expect(b.carriedLead.textContent.includes("From Stardrops' Open Directory"), 'Borrowed tile origin missing');
			b.elements.backBtn.click();
			expect(b.currentCategoryId === 'sparkle', 'Set back should return to its root');
			b.elements.backBtn.click();
			expect(b.state === 'CATEGORY_LIST', 'Root back should return to index');
			library.activeFilters.search = 'blue-08';
			b.setState('SEARCH_RESULTS');
			expect(library.applyFilters().length === 1, 'Search should match the later original name once');
			expect(b.elements.searchResults.textContent.includes("Classic Sparkle › Stardrops' Open Directory"), 'Search group lacks home path');
			library.activeFilters.nameOnly = true;
			expect(library.applyFilters().length === 1, 'Name-only search should retain original names');
			library.activeFilters.search = 'pink-001';
			expect(library.applyFilters()[0].id === 9004, 'Search must match home original name');
			library.clearFilters();
			library.activeFilters.categories.add('clear');
			b.setState('CATEGORY_LIST');
			expect(b.elements.categoryGrid.querySelectorAll('.category-card').length === 1 && b.elements.categoryGrid.querySelector('[data-category-id="transparent"] .category-card-count').textContent === '1 item', 'Filtered root counts include hidden sets');
			library.clearFilters();
			b.browseView = 'creator'; b.setState('CATEGORY_LIST');
			expect(b.elements.categoryGrid.querySelectorAll('.category-card').length === 4, 'Expected three creators and Unknown');
			b.elements.categoryGrid.querySelector('[data-category-id="aylana"]').click();
			expect(b.state === 'CREATOR_DETAIL', 'Creator card did not open creator page');
			expect(b.elements.categoryGrid.querySelectorAll('h3').length === 2, 'Multiple source headings missing');
			b.elements.categoryGrid.querySelector('[data-category-id="bring-on-the-glitter"]').click();
			b.elements.backBtn.click();
			expect(b.state === 'CREATOR_DETAIL' && b.currentCreatorId === 'aylana', 'Set back must retain creator origin');
			b.elements.backBtn.click();
			b.elements.categoryGrid.querySelector('[data-category-id="__unknown"]').click();
			expect(b.elements.searchResults.querySelectorAll('.asset-option').length === 1, 'Unknown page leaked attributed tiles');
			expect(b.elements.searchResults.textContent.includes('Classic Sparkle'), 'Unknown page lacks root heading');
			const provenance = library.createAssetProvenance(library.getItemById(9002)).textContent;
			expect(provenance.includes('Original name: Sparkbutton-gray') && provenance.includes('First published by Mica') && provenance.includes("Also in Aylana's Bring On The Glitter as blue-08"), 'Lineage text is incomplete');
			b.browseView = 'style'; b.setState('CATEGORY_LIST');
			await library.selectGlitter(9004);
			expect(e.layerManager.getActiveLayer().fill.glitterId === 9004, 'Browser pick did not update fill layer');
			library.clearFilters();
			b.setState('CATEGORY_DETAIL', 'sparkelies');
			await new Promise(resolve => setTimeout(resolve, 350));
			expect(b.currentCategoryId === 'sparkelies', 'A cleared search timer undid category navigation');
			return 'Hierarchy, creators, paths, search, filtered counts, lineage, carried-over rows, navigation and picker routing';
		});
		assert.deepStrictEqual(errors, [], 'App raised browser errors');
		if (process.argv.includes('--screenshots')) {
			await screenshots(page, path.join(root, '.tmp/asset-library/after'), false);
			const baseline = await openPage(browser, true);
			await screenshots(baseline.page, path.join(root, '.tmp/asset-library/before'), true);
			assert.deepStrictEqual(baseline.errors, []);
		}
		console.log('PASS ' + result);
	} finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exit(1); });
