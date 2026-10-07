'use strict';
// The UI states the styling tools visit: every layer panel, every tool, the
// effect and paint-source sweeps, the Library, the export menu, each modal and
// the phone drawer. `tools/ui-ab.js` compares two stylesheets in each state;
// `tools/ui-contact-sheet.js` screenshots them.
//
// A state is reported through `visit(name, hints)`. Hints only matter to the
// contact sheet: `shot` is the selector to capture (the viewport when absent)
// and `tall` grows the viewport first so a scrolling panel shows whole.

const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const URL = process.env.GLITTER_URL || 'http://localhost/glitter/';

const VIEWPORTS = {
	desk: { width: 1440, height: 900 },
	laptop: { width: 1280, height: 680 },
	phone: { width: 390, height: 844 }
};

const MODALS = ['newCanvasModal', 'settingsModal', 'exportSettingsModal', 'shortcutsModal', 'layerTypePickerModal', 'aboutModal', 'guideModal', 'historyModal', 'welcomeModal', 'stickerUploadModal', 'exportPreviewModal'];
const PHONE_MODALS = ['settingsModal', 'newCanvasModal', 'exportSettingsModal', 'layerTypePickerModal', 'shortcutsModal'];

const wait = (page, ms = 350) => page.waitForTimeout(ms);

// `css` maps a route name to a stylesheet body; the page's own style.css is
// replaced by `css.main` when given, so a scratch compile can be viewed without
// touching the committed file.
async function boot(page, css = {}) {
	for (const [name, body] of Object.entries(css)) {
		if (name === 'main') continue;
		await page.route(`**/css/__ab_${name}.css*`, (r) => r.fulfill({ contentType: 'text/css', body }));
	}
	if (css.main) await page.route('**/css/style.css*', (r) => r.fulfill({ contentType: 'text/css', body: css.main }));
	// Sparkle positions and ids are random; pin them so two runs match.
	await page.addInitScript(() => {
		let s = 1234567;
		Math.random = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
	});
	await page.goto(URL, { waitUntil: 'networkidle' });
	await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' });
	await page.evaluate(() => window.editor.modalManager.closeAll({ force: true }));
}

const closeModals = async (page) => {
	await page.evaluate(() => {
		try { window.editor.modalManager.closeAll?.(); } catch (e) { /* none open */ }
		window.editor.modalManager.closeAll({ force: true });
	});
	await wait(page, 250);
};

const forceOpen = (page) => page.evaluate(() => {
	document.querySelectorAll('.section.collapsible-section').forEach((s) => {
		s.classList.add('visible', 'is-open');
		s.querySelector(':scope > .section-content')?.classList.add('visible');
	});
	document.querySelectorAll('.is-collapsed').forEach((n) => n.classList.remove('is-collapsed'));
	document.querySelectorAll('[data-advanced]').forEach((n) => n.classList.add('is-open'));
});

const toggleEffects = (page, on) => page.evaluate((want) => {
	document.querySelectorAll('input[data-effect-toggle]').forEach((c) => { if (c.checked !== want) c.click(); });
	document.querySelectorAll('.is-collapsed').forEach((n) => n.classList.remove('is-collapsed'));
}, on);

async function addLayers(page) {
	await page.evaluate(async () => { await window.editor.loadBlankImage(500, 400, '#ffffff'); });
	await page.waitForFunction(() => Boolean(window.editor?.originalImage));
	await page.waitForFunction(() => window.editor?.stickerLibrary?.content?.length > 0 && window.editor?.glitterLibrary?.content?.length > 0);
	return page.evaluate(async () => {
		const e = window.editor;
		const ids = {};
		const text = e.textGlitterManager.createLayer({ text: 'Parity', position: { x: 160, y: 150 }, align: 'center' });
		e.layerManager.insertLayer(text);
		e.layerManager.setActiveLayer(text.id);
		await e.textGlitterManager.refreshLayer(text, { saveHistory: false });
		ids.text = text.id;
		const shape = e.shapeGlitterManager.createLayer({ shapeId: 'square', width: 120, height: 90, position: { x: 250, y: 200 } });
		e.layerManager.insertLayer(shape);
		ids.shape = shape.id;
		const sticker = e.stickerManager.createLayer(e.stickerLibrary.content[0].id);
		e.layerManager.insertLayer(sticker);
		ids.sticker = sticker.id;
		const fill = e.glitterManager.createLayer();
		e.layerManager.insertLayer(fill);
		fill.fill.glitterId = e.glitterLibrary.content[0].id;
		ids.fill = fill.id;
		for (const type of ['FILTER', 'FRAME', 'SPARKLES']) {
			try {
				const r = e.layerManager.addLayer(LayerType[type], {});
				ids[type.toLowerCase()] = r?.id ?? r;
			} catch (err) { ids[`${type}_error`] = String(err.message); }
		}
		ids.base = e.layers.find((l) => l.type === LayerType.BASE_IMAGE || l.isBase || l.type === 'base')?.id ?? e.layers[0].id;
		return ids;
	});
}

const openConfirm = async (page) => {
	page.evaluate(() => window.editor.confirmAction({ title: 'Delete layer', message: 'Delete this layer? This cannot be undone.', subject: 'Layer 1', details: ['one', 'two'], destructive: true })).catch(() => {});
	await wait(page, 600);
};

// `set` narrows the run: 'all' is every state the A/B comparison needs,
// 'sheet' is the subset worth a screenshot.
async function activityStates(page, visit, tag) {
	await page.evaluate(() => window.editor.notifications.setMode({ label: 'Auto Glitter', icon: 'sparkles', badge: 'Beta', exitLabel: 'Exit', onExit: () => {} }));
	await visit(`${tag} activity mode idle`, { shot: '#previewControls' });
	await page.evaluate(() => { window.editor.beginActivity('sheet', 'Rendering preview'); window.editor.notifications.activityShown = true; window.editor.notifications.renderActivity(); });
	await visit(`${tag} activity mode busy`, { shot: '#previewControls' });
	await page.evaluate(() => window.editor.notifications.setMode(null));
	await visit(`${tag} activity preview`, { shot: '#previewControls' });
	await page.evaluate(() => { window.editor.endActivity('sheet'); window.editor.notifications.activityShown = false; window.editor.notifications.renderActivity(); });
}

async function desktopStates(page, visit, { set = 'all', viewport = 'desk' } = {}) {
	const full = set === 'all';
	const tag = viewport;
	await visit(`${tag} start-card`);
	const ids = await addLayers(page);
	await activityStates(page, visit, tag);
	await wait(page, 600);
	for (const [name, id] of Object.entries(ids)) {
		if (name.endsWith('_error') || id == null) { console.log(`(skip ${name}: ${id})`); continue; }
		await page.evaluate((i) => window.editor.layerManager.setActiveLayer(i), id);
		await wait(page);
		await visit(`${tag} layer ${name}`, { shot: '#designPanel', tall: true });
	}
	await page.evaluate((i) => window.editor.layerManager.setActiveLayer(i.text), ids);
	await wait(page);
	await visit(`${tag} app text-selected`);
	await visit(`${tag} layers panel`, { shot: '.layers-panel' });
	await page.evaluate((i) => window.editor.layerManager.setSelection([i.text, i.shape, i.sticker]), ids);
	await wait(page);
	await visit(`${tag} multi-select`, { shot: '#designPanel', tall: true });
	await page.evaluate(() => window.editor.layerManager.setSelection([]));
	await wait(page);
	await visit(`${tag} no-selection`, { shot: '#designPanel', tall: true });
	for (const tool of ['brush', 'glitterFill', 'text', 'shape', 'select']) {
		await page.evaluate(({ t, i }) => { window.editor.layerManager.setActiveLayer(i.fill); window.editor.setTool(t); }, { t: tool, i: ids });
		await wait(page);
		await visit(`${tag} tool ${tool}`, { shot: '#designPanel', tall: true });
	}
	await page.evaluate((i) => window.editor.layerManager.setActiveLayer(i.text), ids);
	await forceOpen(page);
	await wait(page);
	if (full) await visit(`${tag} all-open effects-off`);
	await toggleEffects(page, true);
	await forceOpen(page);
	await wait(page, 700);
	await visit(`${tag} all-open effects-on`, { shot: '#designPanel', tall: true });
	if (full) {
		for (const mode of ['none', 'solid', 'gradient', 'glitter', 'image']) {
			await page.evaluate((m) => document.querySelectorAll(`.segmented-option[data-mode="${m}"]`).forEach((o) => { try { o.click(); } catch (e) { /* inert */ } }), mode);
			await forceOpen(page);
			await wait(page, 500);
			await visit(`${tag} all-open mode ${mode}`);
		}
		for (const w of [250, 300, 390, 520]) {
			await page.evaluate((px) => { const p = document.getElementById('designPanel'); p.style.width = `${px}px`; p.style.minWidth = `${px}px`; p.style.flex = `0 0 ${px}px`; }, w);
			await wait(page);
			await visit(`${tag} all-open width ${w}`);
		}
		await page.evaluate(() => { const p = document.getElementById('designPanel'); p.style.width = ''; p.style.minWidth = ''; p.style.flex = ''; });
		for (const theme of ['light', 'aqua']) {
			await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
			await wait(page);
			await visit(`${tag} all-open theme ${theme}`);
		}
		await page.evaluate(() => { delete document.documentElement.dataset.theme; });
	}
	await toggleEffects(page, false);
	await wait(page);
	if (full) await visit(`${tag} all-open effects-off-again`);
	await page.evaluate(() => {
		const g = document.getElementById('designGallerySection');
		g?.classList.add('is-open', 'visible');
		g?.querySelector(':scope > .section-content')?.classList.add('visible');
		document.querySelector('.library-search-action')?.click();
		try { window.editor.glitterLibrary.toggleFiltersUI(true); } catch (e) { /* no filter drawer */ }
	});
	await wait(page, 500);
	await visit(`${tag} library search+filters`, { shot: '#designPanel' });
	await page.evaluate(() => {
		try { window.editor.glitterLibrary.toggleFiltersUI(false); } catch (e) { /* no filter drawer */ }
		const input = document.querySelector('#glitterSearchSection [data-browser-role="search"]');
		if (input) { input.value = 'pink'; input.dispatchEvent(new Event('input', { bubbles: true })); }
	});
	await wait(page, 700);
	await visit(`${tag} library query unfolded`, { shot: '#designPanel' });
	await page.evaluate(() => document.getElementById('librarySearchToggle')?.click());
	await wait(page, 400);
	if (full) await visit(`${tag} library query folded`);
	await page.evaluate(() => {
		const input = document.querySelector('#glitterSearchSection [data-browser-role="search"]');
		if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
	});
	await wait(page, 500);
	if (full) await visit(`${tag} library folded idle`);
	await page.evaluate(() => document.getElementById('exportMenuBtn')?.click());
	await wait(page, 300);
	await visit(`${tag} export menu open`);
	await page.evaluate(() => document.getElementById('exportMenuBtn')?.click());
	await wait(page, 200);
	for (const id of MODALS) {
		try {
			await page.evaluate((m) => window.editor.modalManager.open(m), id);
			await wait(page, 900);
			await visit(`${tag} modal ${id}`);
			if (full && (id === 'settingsModal' || id === 'exportSettingsModal')) {
				await page.evaluate((m) => {
					const i = document.querySelector(`#${m} input[type="search"], #${m} .search-input`);
					if (i) { i.value = 'color'; i.dispatchEvent(new Event('input', { bubbles: true })); }
					document.querySelectorAll(`#${m} [data-advanced]`).forEach((n) => n.classList.add('is-open'));
				}, id);
				await wait(page, 400);
				await visit(`${tag} modal ${id} filtered+advanced`);
			}
		} catch (e) { console.log(`(modal ${id}: ${e.message.split('\n')[0]})`); }
		await closeModals(page);
	}
	try {
		await openConfirm(page);
		await visit(`${tag} modal confirmation`);
	} catch (e) { console.log(`(confirm: ${e.message})`); }
	await closeModals(page);
}

async function phoneStates(page, visit, { set = 'all' } = {}) {
	const full = set === 'all';
	if (set === 'drawers') {
		const ids = await addLayers(page);
		await page.evaluate(i => window.editor.layerManager.setActiveLayer(i.text), ids);
		for (const drawer of ['layers', 'design', 'edit']) {
			await page.evaluate(name => window.editor.mobileManager.openDrawer(name), drawer);
			for (const height of [28, 50, 85]) {
				await page.evaluate(h => window.editor.mobileManager.setSheetHeight(h), height);
				await wait(page, 700);
				await visit(`phone drawer ${drawer} ${height}`);
			}
			await page.evaluate(() => window.editor.mobileManager.closeAllDrawers({ immediate: true }));
			await wait(page, 400);
		}
		return;
	}
	const tab = async (label) => {
		try { await page.locator('button').filter({ hasText: new RegExp(`^\\s*${label}`) }).first().tap({ timeout: 3000 }); } catch (e) { console.log(`(phone tab ${label}: not tappable)`); }
		await wait(page, 600);
	};
	await visit('phone start-card');
	const ids = await addLayers(page);
	await activityStates(page, visit, 'phone');
	await page.evaluate((i) => window.editor.layerManager.setActiveLayer(i.text), ids);
	await wait(page, 600);
	await visit('phone text');
	for (const label of ['Edit', 'Library', 'Layers']) {
		await tab(label);
		await visit(`phone tab ${label}`);
	}
	await tab('Edit');
	await forceOpen(page);
	await wait(page, 500);
	if (full) await visit('phone edit all-open effects-off');
	await toggleEffects(page, true);
	await forceOpen(page);
	await wait(page, 700);
	await visit('phone edit all-open effects-on');
	for (const id of PHONE_MODALS) {
		try {
			await page.evaluate((m) => window.editor.modalManager.open(m), id);
			await wait(page, 800);
			await visit(`phone modal ${id}`);
		} catch (e) { console.log(`(phone modal ${id}: ${e.message.split('\n')[0]})`); }
		await closeModals(page);
	}
	try {
		await openConfirm(page);
		await visit('phone modal confirmation');
	} catch (e) { console.log(`(confirm: ${e.message})`); }
	await closeModals(page);
}

async function recolorStates(page, visit, viewport) {
	await page.waitForFunction(() => window.editor?.glitterLibrary?.browser);
	await closeModals(page);
	await page.evaluate(() => editor.glitterRecolor.open(editor.glitterLibrary.getItemById(111)));
	await page.evaluate(() => editor.glitterRecolor.setFrame(0));
	await wait(page);
	await visit(`${viewport} recolor original`);
	await page.evaluate(() => {
		const field = document.getElementById('recolorAll'); field.value = '#18b7c9'; field.dispatchEvent(new Event('input')); field.dispatchEvent(new Event('change'));
	});
	await visit(`${viewport} recolor teal`);
	await page.evaluate(() => {
		const slider = document.getElementById('recolorLightness'); slider.value = 15; slider.dispatchEvent(new Event('input'));
	});
	await visit(`${viewport} recolor pending adjustment`);
}

async function backgroundRemovalStates(page, visit, viewport) {
	await page.evaluate(async () => {
		await editor.loadBlankImage(320, 240, '#ffffff');
		await loadScriptOnce('js/systems/BackgroundRemover.js');
		editor.stickerManager.backgroundRemover ||= new BackgroundRemover(editor);
		editor.stickerManager.backgroundRemover.progress.show({ title: 'Removing background', detail: 'Downloading background remover (1/3)' });
	});
	await visit(`${viewport} background removal processing`);
	await page.evaluate(() => {
		const progress = editor.stickerManager.backgroundRemover.progress;
		progress.started -= CONFIG.ui.taskProgress.slowPhaseNoticeMs;
		progress.update(0, 'Removing background…', 0, 0, { indeterminate: true });
	});
	await visit(`${viewport} background removal still working`);
	await page.evaluate(async () => {
		const remover = editor.stickerManager.backgroundRemover;
		remover.progress.hide();
		remover.node('Before').src = 'images/stickers/character/cunty-coffee-cup.png';
		remover.node('After').src = remover.node('Before').src;
		await Promise.all([remover.node('Before').decode(), remover.node('After').decode()]);
		await editor.modalManager.open('backgroundRemovalModal');
	});
	await visit(`${viewport} background removal preview`);
}

module.exports = { chromium, URL, VIEWPORTS, boot, wait, desktopStates, phoneStates, recolorStates, backgroundRemovalStates };
