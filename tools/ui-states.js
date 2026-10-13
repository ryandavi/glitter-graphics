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
const fs = require('fs');
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
async function routeSourceSnapshot(page) {
	const snapshotHtml = process.env.GLITTER_UI_SOURCE_DIR && path.join(process.env.GLITTER_UI_SOURCE_DIR, 'index.html');
	if (snapshotHtml && fs.existsSync(snapshotHtml)) {
		const app = new globalThis.URL(URL);
		await page.route(url => url.origin === app.origin && url.pathname === app.pathname, route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync(snapshotHtml) }));
	}
	if (process.env.GLITTER_UI_SOURCE_DIR) await page.route('**/js/**', (route) => {
		const relative = new globalThis.URL(route.request().url()).pathname.split('/js/')[1];
		const file = path.join(process.env.GLITTER_UI_SOURCE_DIR, 'js', relative);
		return fs.existsSync(file) ? route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(file) }) : route.continue();
	});
}

async function boot(page, css = {}) {
	await routeSourceSnapshot(page);
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
	document.querySelectorAll('.section:is(.collapsible-section, .switch-panel)').forEach((s) => {
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

async function areaStates(page, visit, tag) {
	await page.evaluate(() => {
		const e = window.editor;
		e.mobileManager.closeAllDrawers({ immediate: true });
		e.setTool('area'); e.areaSelection.selectAll();
	});
	await wait(page);
	await visit(`${tag} area bar`);
	const menu = page.locator('#contextAreaMenu');
	if (await menu.count()) {
		await menu.scrollIntoViewIfNeeded(); await menu.click(); await wait(page);
	}
	await visit(`${tag} area menu`);
	if (await menu.count()) await page.keyboard.press('Escape');
	await page.evaluate(() => window.editor.areaSelection.clear());
	await page.evaluate(() => window.editor.setTool('select'));
}

async function desktopStates(page, visit, { set = 'all', viewport = 'desk' } = {}) {
	const full = set === 'all';
	const tag = viewport;
	await visit(`${tag} start-card`);
	const railHandle = page.locator('[data-panel-resize="toolbar"]');
	if (await railHandle.count()) {
		await visit(`${tag} toolbar compact`);
		await page.evaluate(() => setPanelWidth('toolbar', CONFIG.ui.panelResize.panels.toolbar.snaps[0], { persist: false }));
		await visit(`${tag} toolbar expanded`);
		await page.evaluate(() => resetPanelWidth('toolbar'));
	}
	const ids = await addLayers(page);
	await areaStates(page, visit, tag);
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
	for (const tool of ['brush', 'glitterFill', 'text', 'shape', 'select', 'crop']) {
		await page.evaluate(({ t, i }) => { window.editor.layerManager.setActiveLayer(t === 'crop' ? i.shape : i.fill); window.editor.setTool(t); }, { t: tool, i: ids });
		await wait(page);
		await visit(`${tag} tool ${tool}`, { shot: '#designPanel', tall: true });
	}
	await page.evaluate((i) => { window.editor.setTool('select'); window.editor.layerManager.setActiveLayer(i.base); window.editor.autoGlitterManager.open(); }, ids);
	await wait(page, 800);
	await visit(`${tag} auto glitter`, { shot: '#autoGlitterSettingsSection', tall: true });
	await page.evaluate(() => window.editor.autoGlitterManager.cancelSession());
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
	// The Library shows in its window while a picker is armed.
	await page.evaluate(() => {
		const e = window.editor;
		e.layerManager.setActiveLayer(e.layers.find((layer) => layer.type === LayerType.TEXT_GLITTER).id);
		e.textGlitterManager.armPicker('fill');
		document.querySelector('.library-search-action')?.click();
		try { window.editor.glitterLibrary.toggleFiltersUI(true); } catch (e) { /* no filter drawer */ }
	});
	await wait(page, 500);
	await visit(`${tag} library window`);
	await visit(`${tag} library search+filters`, { shot: '#libraryWindow' });
	await page.evaluate(() => {
		try { window.editor.glitterLibrary.toggleFiltersUI(false); } catch (e) { /* no filter drawer */ }
		const input = document.querySelector('#glitterSearchSection [data-browser-role="search"]');
		if (input) { input.value = 'pink'; input.dispatchEvent(new Event('input', { bubbles: true })); }
	});
	await wait(page, 700);
	await visit(`${tag} library query unfolded`, { shot: '#libraryWindow' });
	await page.evaluate(() => document.getElementById('librarySearchToggle')?.click());
	await wait(page, 400);
	if (full) await visit(`${tag} library query folded`);
	await page.evaluate(() => {
		const input = document.querySelector('#glitterSearchSection [data-browser-role="search"]');
		if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
	});
	await wait(page, 500);
	if (full) await visit(`${tag} library folded idle`);
	await page.evaluate(() => window.editor.pickers.closeActive());
	await wait(page, 300);
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
		for (const drawer of ['layers', 'window', 'inspector']) {
			await page.evaluate(name => {
				if (name === 'window') window.editor.textGlitterManager.armPicker('fill');
				else if (name === 'inspector') window.editor.mobileManager.openLeadingSection();
				else window.editor.mobileManager.openDrawer(name);
			}, drawer);
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
	await visit('phone start-card');
	const ids = await addLayers(page);
	await areaStates(page, visit, 'phone');
	await activityStates(page, visit, 'phone');
	for (const [type, id] of Object.entries(ids).filter(([key]) => !key.endsWith('_error'))) {
		await page.evaluate((layerId) => {
			window.editor.mobileManager.closeAllDrawers({ immediate: true });
			window.editor.layerManager.setActiveLayer(layerId);
		}, id);
		await wait(page, 300);
		await visit(`phone ${type} bar`);
		await page.evaluate(() => window.editor.mobileManager.openLeadingSection());
		await wait(page, 400);
		await visit(`phone ${type} sheet`);
	}
	await page.evaluate((i) => {
		window.editor.mobileManager.closeAllDrawers({ immediate: true });
		window.editor.layerManager.setActiveLayer(i.text);
		window.editor.mobileManager.chipBar.render();
		window.editor.mobileManager.chipBar.pressChip(window.editor.mobileManager.chipBar.entries.find(entry => entry.key === 'fill') || window.editor.mobileManager.chipBar.entries[0]);
	}, ids);
	await wait(page, 400);
	await visit('phone Fill section');
	await page.evaluate(() => window.editor.textGlitterManager.armPicker('fill'));
	await wait(page, 400);
	await visit('phone Fill Library');
	await page.evaluate(() => window.editor.libraryWindow.backToSection());
	await wait(page, 300);
	await visit('phone Fill Back');
	await page.evaluate(() => window.editor.mobileManager.openDrawer('layers'));
	await wait(page, 400);
	await visit('phone Layers');

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

async function animatedFilterStates(page, visit, viewport) {
	await page.evaluate(async () => {
		const e = window.editor;
		await e.loadBlankImage(160, 100, '#a348cd');
		const filter = e.layerManager.addLayer(LayerType.FILTER);
		filter.filterData = GlitterFilter.normalizeFilterData({ type: 'scanlines', crawl: 'medium' });
		e.layerManager.setActiveLayer(filter.id);
		e.filterLayerManager.loadLayerSettings(filter);
		e.requestPreviewUpdate();
		if (e.mobileManager.isMobile) e.mobileManager.openLeadingSection();
	});
	await wait(page, 500);
	await visit(`${viewport} animated-filters scanlines`, { shot: '#designPanel', tall: viewport !== 'phone' });
	await page.evaluate(() => {
		const e = window.editor;
		const layer = e.layerManager.getActiveLayer();
		layer.filterData = GlitterFilter.normalizeFilterData({ type: 'hue-cycle' });
		e.filterLayerManager.loadLayerSettings(layer); e.requestPreviewUpdate();
	});
	await wait(page, 600);
	await visit(`${viewport} animated-filters hue-cycle`, { shot: '#designPanel', tall: viewport !== 'phone' });
	await page.evaluate(async () => {
		const e = window.editor;
		e.layerManager.clearSelection();
		if (e.openAnimationLoop) { e.openAnimationLoop(); await e.updateExportDuration(); }
	});
	await wait(page, 500);
	await visit(`${viewport} animated-filters loop-helper`, { shot: '#designPanel', tall: viewport !== 'phone' });
	await page.evaluate(async () => {
		const e = window.editor;
		const hue = e.layers.find((layer) => layer.filterData?.type === 'hue-cycle');
		hue.filterData = GlitterFilter.normalizeFilterData({ type: 'hue-cycle', speed: 1.4 });
		const fixed = e.layerManager.addLayer(LayerType.FILTER);
		fixed.filterData = GlitterFilter.normalizeFilterData({ type: 'dither', shimmer: true, palette: 'bw' });
		const shape = e.layerManager.addLayer(LayerType.SHAPE);
		getLayerFillSlot(shape).mode = 'solid';
		shape.animations = [GlitterAnimation.normalizeAnimation({ type: 'wobble', periodMs: 1400 })];
		e.openAnimationLoop(); await e.updateExportDuration();
		document.getElementById('animationLoopCandidate').value = '800'; e.syncLoopCandidate();
	});
	await wait(page, 300);
	await visit(`${viewport} animated-filters loop-needs-fit`, { shot: '#designPanel', tall: viewport !== 'phone' });
	await page.evaluate(async () => { editor.fitAnimationsToLoop(); await editor.updateExportDuration(); });
	await wait(page, 300);
	await visit(`${viewport} animated-filters loop-fitted`, { shot: '#designPanel', tall: viewport !== 'phone' });
}

async function patternStates(page, visit, viewport) {
	await page.evaluate(async () => {
		await editor.loadBlankImage(400, 300, '#ffffff');
		const layer = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 240, height: 180 });
		editor.layerManager.insertLayer(layer);
		editor.layerManager.setActiveLayer(layer.id);
		document.getElementById('shapeFillPattern').click();
		const type = document.getElementById('shapeFillPatternType');
		type.value = 'motif';
		type.dispatchEvent(new Event('change', { bubbles: true }));
	});
	await page.click('[data-flyout-for="shapeFillSection"] .property-card-title');
	await wait(page);
	await visit(`${viewport} patterns motif`, { shot: '#libraryWindow', tall: true });
}

async function creationStates(page, visit, tag) {
	await page.evaluate(async () => { await editor.loadBlankImage(320, 240, '#ffffff'); editor.viewport.setZoom(1); });
	await wait(page);
	for (const tool of ['shape', 'text', 'line']) {
		await page.evaluate(tool => {
			editor.setTool(tool);
			const rect = editor.previewWrapper.getBoundingClientRect();
			editor.beginCreationGesture(rect.left + 40, rect.top + 50);
			editor.updateCreationGesture(rect.left + 200, rect.top + 170);
		}, tool);
		await visit(`${tag} creation ${tool}`);
		await page.evaluate(() => editor.cancelCreationGesture());
	}
}

async function clippingStates(page, visit, tag) {
	await page.evaluate(async () => {
		await editor.loadBlankImage(320, 240, '#ffffff'); editor.viewport.setZoom(1);
		const base = editor.shapeGlitterManager.createLayer({ shapeId: 'heart', width: 170, height: 170 }); base.name = 'Heart base'; editor.layerManager.insertLayer(base);
		const text = editor.textGlitterManager.createLayer({ text: 'CLIP', position: { x: 160, y: 120 } }); text.textData.fill.mode = 'solid'; text.textData.fill.color = '#ff3366'; text.clipped = true; editor.layerManager.insertLayer(text);
		const top = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 200, height: 40, position: { x: 160, y: 160 } }); top.clipped = true; editor.layerManager.insertLayer(top);
		editor.layerManager.setSelection([text.id, top.id]); editor.requestPreviewUpdate();
		if (editor.mobileManager?.isMobile) editor.mobileManager.openDrawer('layers');
	});
	await wait(page, 500);
	await visit(`${tag} clipping layers`);
	await page.evaluate(() => { editor.refreshInspector(); if (editor.mobileManager?.isMobile) editor.mobileManager.openDrawer('edit'); });
	await wait(page);
	await visit(`${tag} clipping actions`);
}

async function timelineStates(page, visit, viewport) {
	await page.evaluate(async () => {
		await editor.loadBlankImage(200, 160, '#ffffff');
		await editor.ensureTimelineDock();
		PREFERENCES.set('timelineOpen', true);
		await editor.updateExportDuration();
	});
	await wait(page);
	await visit(`${viewport} timeline empty`, { shot: '#timelineDock' });
	await page.evaluate(async () => {
		const circle = editor.shapeGlitterManager.createLayer({ shapeId: 'circle', width: 40, height: 40, position: { x: 40, y: 40 } });
		getLayerFillSlot(circle).mode = 'solid';
		circle.animations = [GlitterAnimation.normalizeAnimation({ type: 'rotate', periodMs: 1600 })];
		editor.layerManager.insertLayer(circle);
		editor.shapeGlitterManager.renderLayer(circle);
		const shape = editor.shapeGlitterManager.createLayer({ shapeId: 'square', width: 60, height: 60, position: { x: 100, y: 80 } });
		getLayerFillSlot(shape).mode = 'solid';
		shape.animations = [GlitterAnimation.normalizeAnimation({ type: 'pulse', periodMs: 1000, iterations: 2, delayMs: 600 }), GlitterAnimation.normalizeAnimation({ type: 'rotate', periodMs: 1200 })];
		editor.layerManager.insertLayer(shape);
		editor.shapeGlitterManager.renderLayer(shape);
		editor.setDocumentLoop({ mode: 'set', durationMs: 4800 });
		await editor.ensureTimelineDock();
		PREFERENCES.set('timelineOpen', true);
		await editor.updateExportDuration();
	});
	await wait(page);
	await page.locator('.timeline-bar').first().focus();
	await visit(`${viewport} timeline`, { shot: '#timelineDock' });
	await page.evaluate(() => { editor.timelineDock.host.style.width = '480px'; editor.timelineDock.resync(); });
	await wait(page);
	await visit(`${viewport} timeline narrow`, { shot: '#timelineDock' });
	await page.evaluate(async () => {
		editor.timelineDock.host.style.removeProperty('width');
		const layer = editor.layers.find(entry => entry.animations?.length > 1);
		layer.animations[0] = GlitterAnimation.normalizeAnimation({ type: 'custom', periodMs: 1600, keys: [
			{ at: 0, values: { tx: 0, rotate: 0 } }, { at: 0.35, values: { tx: 40, rotate: 20 } }, { at: 0.7, values: { tx: -30, rotate: -10 } }
		] });
		editor.layerManager.setActiveLayer(layer.id);
		editor.animationPanel.selectedByLayer.set(layer.id, 0);
		editor.saveState('Custom motion');
		await editor.updateExportDuration();
		editor.animationPanel.load(layer);
		editor.timelineDock.selectMotion(layer.id, 0);
		editor.animationPanel.setPaused(true); editor.animationTicker.seek(500);
	});
	await wait(page);
	await visit(`${viewport} timeline keys`, { shot: '#timelineDock' });
	await page.evaluate(() => { editor.timelineDock.host.style.width = '480px'; editor.timelineDock.resync(); });
	await wait(page);
	await visit(`${viewport} timeline keys narrow`, { shot: '#timelineDock' });
	await page.evaluate(() => {
		editor.timelineDock.host.style.removeProperty('width'); editor.timelineDock.resync();
		editor.timelineDock.openRowSection(editor.timelineDock.keyLane.row);
	});
	await wait(page);
	await visit(`${viewport} timeline key fields`, { shot: '#flyoutSection', tall: true });
}

module.exports = { routeSourceSnapshot, chromium, URL, VIEWPORTS, boot, wait, desktopStates, phoneStates, recolorStates, backgroundRemovalStates, animatedFilterStates, patternStates, creationStates, clippingStates, timelineStates };
