'use strict';

// Modal and settings system contract.
//
// These modals share one shell, one chrome bar and the property-panel row vocabulary;
// the checks below pin the parts that silently drifted before: control widths
// decided by option text, a tab strip that resized the window, toggles that no
// keyboard could reach, and "disabled" rows that Tab could still edit.

const { chromium } = require("playwright");
const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const results = [];
function check(name, cond, detail='') {
	results.push({ name, ok: !!cond, detail });
}
async function verifySteppedSlider(page, width) {
	const state = await page.evaluate(() => {
		const input = document.getElementById('exportFidelity');
		const output = document.getElementById('exportFidelityValue');
		const ticks = [...input.parentElement.querySelectorAll('.stepped-slider-ticks > span')];
		const rect = input.getBoundingClientRect();
		const thumbSize = parseFloat(getComputedStyle(input).getPropertyValue('--slider-thumb-size'));
		const positions = CONFIG.export.timeline.fidelityStops.map((stop, index, stops) => {
			input.value = String(index);
			input.dispatchEvent(new Event('input', { bubbles: true }));
			input.dispatchEvent(new Event('change', { bubbles: true }));
			const dot = ticks[index].getBoundingClientRect();
			const thumbCenter = rect.left + thumbSize / 2 + index / (stops.length - 1) * (rect.width - thumbSize);
			return { error: Math.abs(dot.left + dot.width / 2 - thumbCenter),
				label: output.textContent === stop.label && input.getAttribute('aria-valuetext') === output.textContent,
				current: ticks.filter(tick => tick.classList.contains('is-current')).length === 1 && ticks[index].classList.contains('is-current') };
		});
		return { count: ticks.length, stopCount: CONFIG.export.timeline.fidelityStops.length, positions,
			captions: [...input.closest('.stepped-slider').querySelectorAll('.stepped-slider-captions > span')].map(el => el.textContent),
			status: document.getElementById('exportFidelityEstimate').getAttribute('role') };
	});
	check(`stepped slider has one aligned dot per stop at ${width}px`, state.count === state.stopCount && state.positions.every(stop => stop.error <= 1), JSON.stringify(state));
	check(`stepped slider keeps its value text and current dot in sync at ${width}px`, state.positions.every(stop => stop.label && stop.current), JSON.stringify(state));
	check(`stepped slider has end captions and an announced estimate at ${width}px`, state.captions.join('|') === 'Best quality|Smallest file' && state.status === 'status', JSON.stringify(state));
	await page.locator('#exportFidelity').press('ArrowLeft');
	check(`keyboard steps one named stop at ${width}px`, await page.evaluate(() => {
		const input = document.getElementById('exportFidelity');
		return Number(input.value) === CONFIG.export.timeline.fidelityStops.length - 2
			&& input.getAttribute('aria-valuetext') === CONFIG.export.timeline.fidelityStops[Number(input.value)].label;
	}));
	await page.click('[data-revert-for="exportFidelity"]');
	check(`revert restores Balanced and its dot at ${width}px`, await page.evaluate(() => {
		const input = document.getElementById('exportFidelity');
		return Number(input.value) === CONFIG.export.defaults.exportFidelity
			&& document.getElementById('exportFidelityValue').textContent === 'Balanced'
			&& input.parentElement.querySelectorAll('.stepped-slider-ticks > span')[Number(input.value)].classList.contains('is-current');
	}));
}
(async () => {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await context.addInitScript(() => localStorage.setItem('glitterEditor_welcomeModalSeen', 'true'));
	const page = await context.newPage();
	if (process.env.GLITTER_CSS) {
		await page.route('**/css/style.css*', (route) => route.fulfill({ path: process.env.GLITTER_CSS, contentType: 'text/css' }));
	}
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
		// Selects, number fields and action buttons fill the same control column.
		const controls = [...document.querySelectorAll('#settingsGroups .settings-row > .property-row > :is(select, .input-unit, button:not(.property-revert))')]
			.filter(control => control.offsetParent !== null);
		return controls.map(control => {
			const rect = control.getBoundingClientRect();
			return { w: Math.round(rect.width), right: Math.round(rect.right) };
		});
	});
	const controlWidths = [...new Set(widths.map(w => w.w))];
	const controlEdges = [...new Set(widths.map(w => w.right))];
	check('value controls share one width and one right edge', widths.length > 0 && controlWidths.length === 1 && controlEdges.length === 1,
		JSON.stringify({ controlWidths, controlEdges }));

	// ---- resets are the panel's reverts ------------------------------------
	// A row revert is inert at the default and restores its control through the
	// control's own change event; a card reset replays the lit reverts in it.
	const resetState = () => page.evaluate(() => ({
		row: !document.querySelector('[data-revert-for="panInertia"]').disabled,
		group: !document.querySelector('[data-section="canvas"] .property-card-reset').disabled,
		value: PREFERENCES.get('panInertia'),
		theme: document.documentElement.dataset.theme
	}));
	const resetInitial = await resetState();
	check('reverts are inert at the defaults', !resetInitial.row && !resetInitial.group, JSON.stringify(resetInitial));
	await page.click('label:has(#panInertia) .property-switch');
	const resetChanged = await resetState();
	check('changing a setting lights its revert and its card reset',
		resetChanged.row && resetChanged.group && resetChanged.value !== resetInitial.value, JSON.stringify(resetChanged));
	await page.click('[data-revert-for="panInertia"]');
	const resetReverted = await resetState();
	check('a row revert restores the default', !resetReverted.row && !resetReverted.group && resetReverted.value === resetInitial.value,
		JSON.stringify(resetReverted));
	await page.selectOption('#interfaceTheme', 'light');
	await page.click('[data-section="interface"] .property-card-reset');
	const resetGroup = await resetState();
	check('a card reset restores its rows without a confirmation',
		resetGroup.theme === 'dark' && await page.evaluate(() => document.getElementById('interfaceTheme').value === 'dark'
			&& document.querySelector('[data-section="interface"] .property-card-reset').disabled),
		JSON.stringify(resetGroup));

	// ---- a confirmed reset returns to the modal that asked -----------------
	const preferenceEdits = await page.evaluate(() => {
		const pairs = [['showHelpfulHints', 'showHints'], ['showWelcomeOnStartup', 'showWelcomeOnStartup'],
			['confirmDestructiveActions', 'confirmDestructiveActions'], ['scaleEffectsOnTransform', 'scaleEffects'],
			['scaleTexturesOnTransform', 'scaleTextures'], ['scaleCorners', 'scaleCorners']];
		for (const [id, key] of pairs) {
			const input = document.getElementById(id);
			input.checked = !PREFERENCE_SCHEMA[key].default();
			input.dispatchEvent(new Event('change', { bubbles: true }));
		}
		PREFERENCES.set('welcomeLastSeenRelease', 'test-release');
		window.editor.saveSettingsToStorage();
		const stored = readStored(STORAGE_KEYS.preferences.key, {});
		const exported = readStored(STORAGE_KEYS.exportSettings.key, {});
		return pairs.every(([, key]) => stored[key] === !PREFERENCE_SCHEMA[key].default())
			&& Object.keys(exported).every(key => Object.values(EXPORT_SETTINGS_SCHEMA).some(spec => spec.storageKey === key))
			&& ['showHints', 'showWelcomeOnStartup', 'confirmDestructiveActions', 'antialiasEdges', 'scaleEffectsOnTransform', 'scaleTexturesOnTransform']
				.every(key => !Object.hasOwn(window.editor, key));
	});
	check('app settings persist only through preferences and export settings contain only export keys', preferenceEdits);
	const scrollTop = await page.evaluate(() => { const body = document.querySelector('#settingsModal .modal-body'); editor.modalManager.setScrollPosition(body, 120); return body.scrollTop; });
	await page.click('#settingsModal .reset-all-settings-btn');
	await page.waitForTimeout(300);
	check('settings stays visible and inert behind confirmation', await page.evaluate(() => document.getElementById('settingsModal').classList.contains('visible') && document.getElementById('settingsModal').inert));
	await page.click('#confirmationConfirmBtn');
	await page.waitForTimeout(600);
	const afterConfirm = await page.evaluate(() => [...document.querySelectorAll('.modal-overlay.visible')].map((modal) => modal.id));
	check('settings remains open after a confirmed reset', afterConfirm.length === 1 && afterConfirm[0] === 'settingsModal', JSON.stringify(afterConfirm));
	check('settings scroll survives confirmation', await page.evaluate(() => document.querySelector('#settingsModal .modal-body').scrollTop) === scrollTop);
	check('Reset Everything restores every preference and clears the seen release', await page.evaluate(() =>
		['showHints', 'showWelcomeOnStartup', 'confirmDestructiveActions', 'scaleEffects', 'scaleTextures', 'scaleCorners', 'welcomeLastSeenRelease']
			.every(key => PREFERENCES.get(key) === PREFERENCE_SCHEMA[key].default())));

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


	// Preview cells are integer device-pixel blocks, including fractional ratios.
	for (const ratio of [1, 1.25, 1.5, 2]) {
		await page.evaluate(value => Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value }), ratio);
		const preview = await page.evaluate(() => {
			editor.renderExportDitherPreview();
			const canvas = document.getElementById('exportDitherPreview');
			const rect = canvas.getBoundingClientRect();
			const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
			const cell = Math.max(1, Math.round(CONFIG.export.ditherPreview.zoom * devicePixelRatio));
			let uniform = true;
			const colors = new Set();
			for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
				const index = (y * canvas.width + x) * 4;
				const origin = (Math.floor(y / cell) * cell * canvas.width + Math.floor(x / cell) * cell) * 4;
				for (let channel = 0; channel < 4; channel++) if (pixels[index + channel] !== pixels[origin + channel]) uniform = false;
				colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
			}
			return { uniform, colors: colors.size, sized: canvas.width === Math.round(rect.width * devicePixelRatio) && canvas.height === Math.round(rect.height * devicePixelRatio), fullWidth: Math.abs(rect.width + parseFloat(getComputedStyle(canvas).marginLeft) + parseFloat(getComputedStyle(canvas).marginRight) - canvas.parentElement.getBoundingClientRect().width) < 2 };
		});
		check(`preview uses crisp blocks at pixel ratio ${ratio}`, preview.uniform && preview.sized && preview.fullWidth, JSON.stringify(preview));
		check(`Dithering off uses the full palette at pixel ratio ${ratio}`, preview.colors > 16, JSON.stringify(preview));
	}
	await page.evaluate(() => Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 }));
	check('a static project has a plain one-frame estimate', await page.evaluate(async () => { await editor.updateExportDuration(); return document.getElementById('exportFidelityEstimate').textContent === 'Nothing in this project is animated, so the GIF has one frame.'; }));
	await verifySteppedSlider(page, 1440);

	const gifLook = await page.evaluate(() => {
		const set = document.getElementById('exportGifLookSet');
		return {
			collapsed: !set.classList.contains('is-open'),
			railVisible: getComputedStyle(document.getElementById('exportGifLookRail')).display !== 'none',
			summary: document.querySelector('[data-governed-summary]').textContent
		};
	});
	check('GIF Look collapsed by default with a summary', gifLook.collapsed && !gifLook.railVisible && gifLook.summary.length > 0,
		JSON.stringify(gifLook));

	await page.click('#exportGifLookSet [data-advanced-toggle]');
	await page.waitForTimeout(200);
	const expanded = await page.evaluate(() => ({
		collapsed: !document.getElementById('exportGifLookSet').classList.contains('is-open'),
		railVisible: getComputedStyle(document.getElementById('exportGifLookRail')).display !== 'none',
		expanded: document.querySelector('#exportGifLookSet [data-advanced-toggle]').getAttribute('aria-expanded')
	}));
	check('Customize expands the governed rows', !expanded.collapsed && expanded.railVisible && expanded.expanded === 'true', JSON.stringify(expanded));

	// ---- inactive rows carry real disabled + a reason ---------------------
	const inactive = await page.evaluate(() => {
		const row = document.getElementById('ditherTypeRow');
		return {
			isInactive: row.classList.contains('is-inactive'),
			selectDisabled: document.getElementById('exportDitherType').disabled,
			reason: document.querySelector('#ditherEnabledRow [data-inactive-reason-text]').textContent,
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
		collapsed: !document.getElementById('exportGifLookSet').classList.contains('is-open'),
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
	check('watermark style is hidden until Watermark is on', wm.hidden && !wm.inactive && !wm.disabled, JSON.stringify(wm));

	// ---- Color Accuracy belongs in Animation Advanced ---------------------------
	const precision = await page.evaluate(() => {
		const row = document.getElementById('exportQuality').closest('.settings-row');
		return {
			inRail: !!row.closest('[data-advanced-content]'),
			group: row.closest('.settings-group').querySelector('.property-card-label').textContent,
			label: row.querySelector('.property-label').textContent
		};
	});
	check('Color Accuracy sits in Animation Advanced',
		precision.inRail && precision.group === 'Animation' && precision.label === 'Color Accuracy', JSON.stringify(precision));


	// A parent keeps the hidden child's search terms; toggles reveal one row.
	for (const [query, id] of [['matte', 'exportTransparency'], ['watermark', 'exportWatermarkEnabled'], ['limit', 'exportTargetSize'], ['dither', 'exportDitherEnabled']]) {
		await page.fill('#exportSettingsSearch', query);
		await page.waitForTimeout(250);
		check(`search ${query} finds its parent`, await page.locator(`#${id}`).evaluate(el => { const row = el.closest('.settings-row'); return row.offsetParent !== null && !row.classList.contains('is-filtered-out'); }));
	}
	await page.fill('#exportSettingsSearch', '');
	await page.selectOption('#exportTargetSize', 'custom');
	check('Custom reveals Limit', await page.locator('#exportTargetSizeKB').isVisible());
	await page.$eval('#exportTransparency', el => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
	check('Transparency off reveals Matte Color', await page.locator('#exportMatteColor').isVisible());
	await page.$eval('#exportWatermarkEnabled', el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
	check('Watermark on reveals its style and preview', await page.locator('#exportWatermark').isVisible() && await page.locator('#exportWatermarkPreview').isVisible());
	await page.click('#exportGifLookSet [data-advanced-toggle]');
	await page.selectOption('#exportDitherType', 'Stucki');
	check('diffusion cannot scale or move', await page.locator('#exportDitherScale').isDisabled() && await page.locator('#exportDitherTemporalMode').isDisabled());
	await page.selectOption('#exportDitherType', 'Bayer');
	check('Grid can scale and move', await page.locator('#exportDitherScale').isEnabled() && await page.locator('#exportDitherTemporalMode').isEnabled());
	await page.evaluate(() => { PREFERENCES.set('showAllControls', true); editor.applyShowAllControls(); });
	await page.selectOption('#exportDitherPreset', 'clean');
	await page.$eval('#exportFidelity', el => { el.value = '3'; el.dispatchEvent(new Event('change', { bubbles: true })); });
	check('Show All Controls survives preset and fidelity changes', await page.evaluate(() => ['exportGifLookSet', 'exportFidelitySet'].every(id => document.getElementById(id).classList.contains('is-open'))));
	await page.evaluate(() => { PREFERENCES.set('showAllControls', false); editor.applyShowAllControls(); editor.setGifLookExpanded(false); });
	const transparencyStable = await page.evaluate(() => {
		for (const target of Object.values(EXPORT_TARGETS)) {
			setActiveExportTarget(editor.exportSettings, target.id);
			for (let i = 0; i < 3; i++) {
				editor.updateExportFormatUI();
				if (document.getElementById('transparencySettingsRow').hidden !== (!target.supportsTransparency || target.isVector)) return false;
				if (document.querySelector('[data-section="animation"]').hidden !== !target.supportsAnimationSettings) return false;
			}
		}
		setActiveExportTarget(editor.exportSettings, 'animation:gif'); editor.syncExportSettingsToUI();
		return true;
	});
	check('format visibility is stable through repeated refreshes', transparencyStable);

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
	check('shortcuts shell is 720 wide', after.w === 720, JSON.stringify(after));

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
	await verifySteppedSlider(page, 360);

	await page.evaluate(() => {
		const editor = window.editor;
		editor.interfaceTheme = 'light';
		editor.applyInterfaceTheme();
		editor.saveSettingsToStorage();
	});
	await page.reload({ waitUntil: 'networkidle' });
	check('theme survives reload through its early-paint key', await page.evaluate(() =>
		document.documentElement.dataset.theme === 'light' && window.editor.interfaceTheme === 'light'
			&& readStored(STORAGE_KEYS.theme.key, null) === 'light'
			&& !Object.hasOwn(readStored(STORAGE_KEYS.exportSettings.key, {}), 'interfaceTheme')));
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
