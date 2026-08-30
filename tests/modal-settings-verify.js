'use strict';

// Modal and settings system contract.
//
// These modals share one shell, one chrome bar and one settings-row component;
// the checks below pin the parts that silently drifted before: control widths
// decided by option text, a tab strip that resized the window, toggles that no
// keyboard could reach, and "disabled" rows that Tab could still edit.

const { chromium } = require("playwright");
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const results = [];
function check(name, cond, detail='') {
	results.push({ name, ok: !!cond, detail });
}
(async () => {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await context.addInitScript(() => localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'));
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', e => errors.push('pageerror: ' + e.message));
	page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.editor != null, null, { timeout: 20000 });
	await page.waitForTimeout(600);

	// ---- switches are focusable ------------------------------------------
	await page.evaluate(() => window.editor.modalManager.open('settingsModal'));
	await page.waitForTimeout(300);
	const switchState = await page.evaluate(() => {
		const input = document.getElementById('showHelpfulHints');
		const style = getComputedStyle(input);
		input.focus();
		return { display: style.display, focused: document.activeElement === input, opacity: style.opacity };
	});
	check('switch input is focusable', switchState.focused && switchState.display !== 'none', JSON.stringify(switchState));

	// ---- fixed shell height ----------------------------------------------
	const settingsBox = await page.evaluate(() => {
		const el = document.querySelector('#settingsModal > .modal-content');
		const r = el.getBoundingClientRect();
		return { w: Math.round(r.width), h: Math.round(r.height), cls: el.className };
	});
	check('settings shell is 720 wide', settingsBox.w === 720, JSON.stringify(settingsBox));
	check('settings shell has fixed height', settingsBox.h === 720, JSON.stringify(settingsBox));

	// ---- control widths are uniform --------------------------------------
	const widths = await page.evaluate(() => {
		const rows = [...document.querySelectorAll('#settingsGroups .settings-row-control')];
		return rows.map(r => ({
			kind: r.querySelector('select') ? 'select' : r.querySelector('.switch') ? 'switch' : r.querySelector('button') ? 'button' : 'other',
			w: Math.round(r.getBoundingClientRect().width)
		}));
	});
	const selectWidths = [...new Set(widths.filter(w => w.kind === 'select').map(w => w.w))];
	check('value controls share one width', selectWidths.length === 1 && selectWidths[0] === 200, JSON.stringify(selectWidths));

	// ---- new settings present --------------------------------------------
	const newSettings = await page.evaluate(() => ['autoSelectLayers','snappingEnabled','panInertia','reduceMotion','resetToolbarPlacement']
		.map(id => [id, !!document.getElementById(id)]));
	check('new settings rendered', newSettings.every(([,ok]) => ok), JSON.stringify(newSettings));

	// ---- reduce motion applies -------------------------------------------
	await page.$eval('#reduceMotion', el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
	await page.waitForTimeout(120);
	const rm = await page.evaluate(() => ({
		attr: document.documentElement.dataset.reduceMotion,
		pref: PREFERENCES.get('reduceMotion')
	}));
	check('reduce motion toggles', rm.attr === 'true' && rm.pref === true, JSON.stringify(rm));
	await page.$eval('#reduceMotion', el => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });

	// ---- auto-select two-way sync ----------------------------------------
	await page.$eval('#autoSelectLayers', el => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
	await page.waitForTimeout(100);
	const sync = await page.evaluate(() => ({
		pref: PREFERENCES.get('autoSelect'),
		canvas: document.getElementById('contextAutoSelect')?.checked
	}));
	check('auto-select mirrors to canvas control', sync.pref === false && sync.canvas === false, JSON.stringify(sync));
	await page.$eval('#autoSelectLayers', el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });

	// ---- export settings --------------------------------------------------
	await page.evaluate(() => window.editor.modalManager.close('settingsModal'));
	await page.waitForTimeout(250);
	await page.evaluate(() => window.editor.modalManager.open('exportSettingsModal'));
	await page.waitForTimeout(400);

	const gifLook = await page.evaluate(() => {
		const set = document.getElementById('exportGifLookSet');
		return {
			collapsed: set.classList.contains('is-collapsed'),
			railVisible: getComputedStyle(document.getElementById('exportGifLookRail')).display !== 'none',
			summary: document.querySelector('[data-governed-summary]').textContent,
			toggleLabel: document.querySelector('[data-governed-toggle-label]').textContent
		};
	});
	check('GIF Look collapsed by default with a summary', gifLook.collapsed && !gifLook.railVisible && gifLook.summary.length > 0,
		JSON.stringify(gifLook));

	await page.click('[data-governed-toggle]');
	await page.waitForTimeout(200);
	const expanded = await page.evaluate(() => ({
		collapsed: document.getElementById('exportGifLookSet').classList.contains('is-collapsed'),
		railVisible: getComputedStyle(document.getElementById('exportGifLookRail')).display !== 'none',
		label: document.querySelector('[data-governed-toggle-label]').textContent
	}));
	check('Customize expands the rail', !expanded.collapsed && expanded.railVisible && expanded.label === 'Done', JSON.stringify(expanded));

	// ---- inactive rows carry real disabled + a reason ---------------------
	const inactive = await page.evaluate(() => {
		const row = document.getElementById('ditherTypeRow');
		return {
			isInactive: row.classList.contains('is-inactive'),
			selectDisabled: document.getElementById('exportDitherType').disabled,
			reason: row.querySelector('[data-inactive-reason-text]').textContent,
			pointerEvents: getComputedStyle(row).pointerEvents
		};
	});
	check('dither rows are genuinely disabled with a reason',
		inactive.isInactive && inactive.selectDisabled && inactive.reason.length > 0 && inactive.pointerEvents !== 'none',
		JSON.stringify(inactive));

	// turning dithering on re-enables them
	await page.$eval('#exportDitherEnabled', el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
	await page.waitForTimeout(200);
	const reenabled = await page.evaluate(() => ({
		isInactive: document.getElementById('ditherTypeRow').classList.contains('is-inactive'),
		selectDisabled: document.getElementById('exportDitherType').disabled,
		preset: document.getElementById('exportDitherPreset').value
	}));
	check('turning Dithering on reactivates its rows', !reenabled.isInactive && !reenabled.selectDisabled, JSON.stringify(reenabled));
	check('editing a governed value switches the look to Custom', reenabled.preset === 'custom', JSON.stringify(reenabled));

	// ---- picking a preset collapses and re-applies -------------------------
	await page.selectOption('#exportDitherPreset', 'textured');
	await page.waitForTimeout(300);
	const preset = await page.evaluate(() => ({
		collapsed: document.getElementById('exportGifLookSet').classList.contains('is-collapsed'),
		colors: document.getElementById('exportColorCount').value,
		type: document.getElementById('exportDitherType').value,
		summary: document.querySelector('[data-governed-summary]').textContent,
		stored: window.editor.exportSettings.ditherPreset
	}));
	check('picking a look writes its values and re-collapses',
		preset.collapsed && preset.colors === '64' && preset.type === 'Bayer' && preset.stored === 'textured',
		JSON.stringify(preset));

	// ---- watermark row is inactive, not hidden ----------------------------
	const wm = await page.evaluate(() => {
		const row = document.getElementById('watermarkSelectionRow');
		return { hidden: row.hidden, inactive: row.classList.contains('is-inactive'), disabled: document.getElementById('exportWatermark').disabled };
	});
	check('watermark style is shown inactive, not hidden', !wm.hidden && wm.inactive && wm.disabled, JSON.stringify(wm));

	// ---- Encoder Precision moved out of the rail ---------------------------
	const precision = await page.evaluate(() => {
		const row = document.getElementById('exportQuality').closest('.settings-row');
		return {
			inRail: !!row.closest('.governed-rail'),
			group: row.closest('.settings-group').querySelector('.settings-group-title-text').textContent,
			label: row.querySelector('.settings-row-label-main').textContent
		};
	});
	check('Encoder Precision sits in Optimization, not the GIF Look rail',
		!precision.inRail && precision.group === 'Optimization', JSON.stringify(precision));

	// ---- base image control exists and is wired ---------------------------
	const baseImage = await page.evaluate(() => {
		const el = document.getElementById('exportBaseImage');
		el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true }));
		return { exists: !!el, setting: window.editor.exportSettings.baseImage };
	});
	check('Include Base Image is surfaced and bound', baseImage.exists && baseImage.setting === false, JSON.stringify(baseImage));
	await page.$eval('#exportBaseImage', el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });

	// ---- search doesn't index buttons/badges -------------------------------
	await page.fill('#exportSettingsSearch', 'reset');
	await page.waitForTimeout(250);
	const searchReset = await page.evaluate(() => ({
		matches: [...document.querySelectorAll('#exportSettingsGroups .settings-row')].filter(r => !r.classList.contains('is-filtered-out') && !r.hidden).length,
		status: document.getElementById('exportSettingsSearchStatus').textContent
	}));
	check('searching "reset" no longer matches every group', searchReset.matches === 0, JSON.stringify(searchReset));

	// ---- searching a governed row reveals rail + pinned preset -------------
	await page.fill('#exportSettingsSearch', 'halftone');
	await page.waitForTimeout(250);
	const governedSearch = await page.evaluate(() => {
		const railRow = document.getElementById('ditherTypeRow');
		const presetRow = document.querySelector('[data-filter-pin]');
		return {
			railRowVisible: !railRow.classList.contains('is-filtered-out') && railRow.offsetParent !== null,
			presetVisible: !presetRow.classList.contains('is-filtered-out'),
			filtering: document.querySelector('#exportSettingsModal').classList.contains('is-filtering')
		};
	});
	check('a search match inside a collapsed rail is revealed',
		governedSearch.railRowVisible && governedSearch.presetVisible, JSON.stringify(governedSearch));
	await page.fill('#exportSettingsSearch', '');
	await page.waitForTimeout(200);

	// ---- shortcuts modal: no resize on scope switch ------------------------
	await page.evaluate(() => window.editor.modalManager.close('exportSettingsModal'));
	await page.waitForTimeout(250);
	await page.evaluate(() => window.editor.modalManager.open('shortcutsModal'));
	await page.waitForTimeout(400);
	const before = await page.evaluate(() => {
		const r = document.querySelector('#shortcutsModal > .modal-content').getBoundingClientRect();
		return { w: Math.round(r.width), h: Math.round(r.height) };
	});
	await page.click('#shortcutGesturesTab');
	await page.waitForTimeout(300);
	const after = await page.evaluate(() => {
		const r = document.querySelector('#shortcutsModal > .modal-content').getBoundingClientRect();
		return { w: Math.round(r.width), h: Math.round(r.height), selected: document.querySelector('#shortcutScopeControl .active')?.dataset.shortcutView,
			gestureGroups: document.querySelectorAll('#shortcutList .shortcut-group[data-shortcut-kind="gesture"]:not([hidden])').length };
	});
	check('shortcuts modal does not resize when scope changes',
		before.w === after.w && before.h === after.h, JSON.stringify({ before, after }));
	check('scope control switches the list', after.selected === 'gesture' && after.gestureGroups > 0, JSON.stringify(after));
	check('shortcuts shell is 880 wide', after.w === 880, JSON.stringify(after));

	// ---- nav bars share a height -------------------------------------------
	await page.evaluate(() => window.editor.modalManager.close('shortcutsModal'));
	await page.waitForTimeout(200);
	await page.evaluate(() => window.editor.modalManager.open('guideModal'));
	await page.waitForTimeout(1500);
	const navHeights = await page.evaluate(() => {
		const guide = document.querySelector('#guideModal .modal-nav');
		return { guide: guide ? Math.round(guide.getBoundingClientRect().height) : null, hidden: guide?.hidden };
	});
	await page.evaluate(() => window.editor.modalManager.close('guideModal'));
	await page.waitForTimeout(200);
	await page.evaluate(() => window.editor.modalManager.open('shortcutsModal'));
	await page.waitForTimeout(300);
	const shortcutNav = await page.evaluate(() => Math.round(document.querySelector('#shortcutsModal .modal-nav').getBoundingClientRect().height));
	check('guide and shortcuts nav bars are the same height',
		navHeights.guide === shortcutNav, JSON.stringify({ guide: navHeights.guide, shortcuts: shortcutNav, guideHidden: navHeights.hidden }));

	// ---- narrow viewport: no horizontal overflow ---------------------------
	await page.evaluate(() => window.editor.modalManager.close('shortcutsModal'));
	await page.setViewportSize({ width: 360, height: 720 });
	await page.waitForTimeout(300);
	await page.evaluate(() => window.editor.modalManager.open('exportSettingsModal'));
	await page.waitForTimeout(400);
	const overflow = await page.evaluate(() => {
		const body = document.querySelector('#exportSettingsModal .modal-body');
		return { scrollW: body.scrollWidth, clientW: body.clientWidth };
	});
	check('export settings does not scroll sideways at 360px',
		overflow.scrollW <= overflow.clientW + 1, JSON.stringify(overflow));

	await browser.close();

	let failed = 0;
	for (const r of results) {
		if (!r.ok) failed++;
		console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ->  ' + r.detail}`);
	}
	if (errors.length) {
		console.log('\nRUNTIME ERRORS:');
		[...new Set(errors)].forEach(e => console.log('  ' + e));
	}
	console.log(`\n${results.length - failed}/${results.length} checks passed`);
	process.exit(failed || errors.length ? 1 : 0);
})();
