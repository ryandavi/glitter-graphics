'use strict';

// Sidebar structural-parity harness.
// Captures every [id] element inside the design-panel settings sections
// (tag, classes, nearest [id] ancestor, input ranges) plus, per layer type,
// the hidden/active state of every control through a full paint-slot mode
// sweep. The committed baseline is the zero-behavior-change contract: after
// a template migration the diff must be empty — any delta is a defect, not
// a judgment call.
//
//   node tests/ui/panel-parity.js            diff current DOM against baseline
//   node tests/ui/panel-parity.js --capture  (re)write the baseline
//
// The baseline regenerates only when a WP intentionally adds template-stamped
// IDs; it must never lose or alter existing entries.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const VIEWPORT = { width: 1400, height: 1000 };
const BASELINE_PATH = path.join(__dirname, '..', 'fixtures', 'panel-parity-baseline.json');
const MAX_REPORTED_DIFFS = 200;

// Migration scope: the settings sections the template plan rewrites. The
// asset galleries (glitterOptions/stickersOptions/font cards) are dynamic
// data-driven content and out of scope.
const SECTION_IDS = [
	'welcomeSection',
	'noLayerSettingsSection',
	'baseLayerSettingsSection',
	'glitterSettingsSection',
	'brushSettingsSection',
	'stickerSettingsSection',
	'textSettingsSection',
	'shapeSettingsSection',
	'filterSettingsSection',
	'layerSettingsSection'
];

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

async function openEditor(page) {
	await page.goto(APP_URL, { waitUntil: 'networkidle' });
	await page.evaluate(() => {
		document.querySelectorAll('.modal-overlay.visible').forEach((node) => node.classList.remove('visible'));
	});
	await page.evaluate(async () => {
		await window.editor.loadBlankImage(500, 400, '#ffffff');
	});
	await page.waitForFunction(() => Boolean(window.editor?.originalImage));
}

async function settle(page) {
	await page.evaluate(() => new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(resolve));
	}));
}

// Structural fingerprint, captured once at boot with no layers: id, tag,
// sorted classes, nearest [id] ancestor (catches re-parenting), and input
// ranges/defaults (catches FIELDS drift).
async function captureStructure(page) {
	return page.evaluate((sectionIds) => {
		document.querySelectorAll('.paint-slot-card[data-slot]').forEach((slot) => {
			const glitterMode = slot.querySelector('.segmented-option[data-mode="glitter"]');
			if (!glitterMode) return;
			if (!slot.querySelector('.asset-info')) throw new Error(`Paint slot ${slot.dataset.slot} has no asset-info block`);
			if (!slot.querySelector('.asset-info-change')) throw new Error(`Paint slot ${slot.dataset.slot} has no Change button`);
		});
		const entries = [];
		sectionIds.forEach((sectionId) => {
			const section = document.getElementById(sectionId);
			if (!section) return;
			[section, ...section.querySelectorAll('[id]')].forEach((el) => {
				if (!el.id) return;
				const parent = el === section
					? (el.parentElement?.closest('[id]')?.id || null)
					: (el.parentElement?.closest('[id]')?.id || null);
				const entry = {
					id: el.id,
					tag: el.tagName.toLowerCase(),
					classes: [...el.classList].sort().join(' '),
					parent
				};
				if (el.tagName === 'INPUT') {
					entry.input = {
						type: el.type,
						min: el.min || null,
						max: el.max || null,
						step: el.step || null,
						value: el.type === 'checkbox' ? String(el.checked) : el.value
					};
				}
				entries.push(entry);
			});
		});
		return entries;
	}, SECTION_IDS);
}

// Per-id [hidden] map over the sections relevant to the active layer, plus a
// paint-slot mode sweep: click every source segmented option and record the
// slot's dataset.paintMode and descendant hidden/active state after each.
async function captureLayerState(page) {
	return page.evaluate(async (sectionIds) => {
		const raf2 = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const scope = sectionIds
			.map((id) => document.getElementById(id))
			.filter(Boolean);

		// Expose effect controls before capturing.
		for (const section of scope) {
			for (const toggle of section.querySelectorAll('input[type="checkbox"][id$="Enabled"]')) {
				if (!toggle.checked) {
					toggle.checked = true;
					toggle.dispatchEvent(new Event('change', { bubbles: true }));
				}
			}
		}
		await raf2();

		const visibilityMap = () => {
			const map = {};
			scope.forEach((section) => {
				[section, ...section.querySelectorAll('[id]')].forEach((el) => {
					if (el.id) map[el.id] = el.hidden ? 'hidden' : 'shown';
				});
			});
			return map;
		};

		const slotState = (slotRoot) => {
			const state = { paintMode: slotRoot.dataset.paintMode || null, controls: {} };
			slotRoot.querySelectorAll('[id]').forEach((el) => {
				let value = el.hidden ? 'hidden' : 'shown';
				if (el.classList.contains('segmented-option')) {
					value += el.classList.contains('active') ? '+active' : '';
				}
				state.controls[el.id] = value;
			});
			return state;
		};

		const sweep = {};
		const groups = [];
		scope.forEach((section) => {
			section.querySelectorAll('.glitter-source > .segmented-control').forEach((group) => {
				if (group.querySelector('.segmented-option[id]')) groups.push(group);
			});
		});
		for (const group of groups) {
			const buttons = [...group.querySelectorAll('.segmented-option[id]')];
			const groupKey = buttons[0].id;
			sweep[groupKey] = {};
			for (const button of buttons) {
				button.click();
				await raf2();
				const slotRoot = button.closest('.paint-slot-card')
					|| button.closest('.subsection-content-group')
					|| button.closest('.glitter-source');
				sweep[groupKey][button.id] = slotRoot ? slotState(slotRoot) : null;
			}
		}

		return { visibility: visibilityMap(), slotSweep: sweep };
	}, SECTION_IDS);
}

const LAYER_SETUPS = {
	FILTER: async (page) => {
		await page.evaluate(async () => {
			const editor = window.editor;
			const raf2 = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			editor.brushTipManager.openPicker();
			if (!editor.brushTipManager.pickerSession || !document.getElementById('galleryPickerStrip')?.classList.contains('is-armed')) throw new Error('Brush-tip picker did not arm for the filter-selection regression setup');
			const layer = editor.filterLayerManager.createLayer();
			layer.filterData = GlitterFilter.normalizeFilterData({ type: 'instagram', presetId: 'clarendon' });
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			const section = document.getElementById('filterSettingsSection');
			if (editor.brushTipManager.pickerSession || document.getElementById('galleryPickerStrip')?.classList.contains('is-armed')) throw new Error('Selecting a filter did not close the brush-tip picker');
			if (!section?.classList.contains('visible')) throw new Error('Filter Properties did not become visible');
			if (!document.getElementById('filterSettingsContent')?.classList.contains('visible')) throw new Error('Filter Properties did not open');
			if (document.getElementById('designPanel')?.dataset.galleryVisible !== 'false') throw new Error('Filter did not opt out of the Design Gallery');
			const lookOptions = [...document.querySelectorAll('#filterLooksPicker .preset-grid-option')];
			if (lookOptions[0]?.dataset.presetId !== 'instagram:rio' || lookOptions.at(-1)?.dataset.presetId !== 'instagram:hefe') throw new Error('Instagram look order is incorrect');
			if (!document.querySelector('#filterLooksPicker [data-preset-id="instagram:clarendon"].active')) throw new Error('Loaded Instagram look is not active');
			const lookGroups = document.getElementById('filterLooksGroup');
			if (lookGroups.closest('.property-set')?.querySelector('.property-label')?.textContent !== 'Category') throw new Error('Filter look category dropdown is not in its own labelled property set');
			if (document.getElementById('filterLooksPicker').contains(lookGroups) || document.getElementById('filterLooksPicker').closest('.property-set') === lookGroups.closest('.property-set')) throw new Error('Filter look group dropdown is nested inside the preset grid property set');
			if ([...lookGroups.options].map((option) => option.textContent).join(',') !== 'All,Adjust,Stylize,Web & Film,Instagram') throw new Error('Filter look groups are incorrect');
			if (document.getElementById('filterCurrentLookName')?.textContent !== 'Clarendon') throw new Error('Current Look summary is not synced to Clarendon');
			if (document.getElementById('filterCustomizeTitle')?.textContent !== 'Clarendon Settings') throw new Error('Filter settings heading does not identify Clarendon');
			lookGroups.value = '';
			lookGroups.dispatchEvent(new Event('change'));
			const allLookOptions = [...document.querySelectorAll('#filterLooksPicker .preset-grid-option')];
			if (allLookOptions[0]?.dataset.presetId !== 'basic' || allLookOptions.at(-1)?.dataset.presetId !== 'instagram:hefe' || allLookOptions.some((option) => option.dataset.presetId === 'instagram')) throw new Error('Flattened Filter look order is incorrect');
			if (!document.getElementById('filterLooksPicker').closest('.property-card')) throw new Error('Looks grid is not grouped inside the Looks card');
			if (document.getElementById('filterLooksPicker').classList.contains('property-scrollbox')) throw new Error('Looks grid still uses nested scrollbox styling');
			if (document.getElementById('filterLayerOpacity')?.closest('.property-row')?.querySelector('.property-label')?.textContent !== 'Opacity') throw new Error('Filter opacity does not use the shared label');
			if (!document.getElementById('filterStrengthValue')?.textContent.endsWith('%')) throw new Error('Instagram strength unit is missing');
			editor.filterLayerManager.chooseLook(GlitterFilters.looksLibrary.get('tint'));
			const filterUnits = ['filterTintAmountValue'].map((id) => document.getElementById(id)?.textContent);
			if (!filterUnits[0]?.endsWith('%')) throw new Error(`Filter control units are missing: ${filterUnits.join(', ')}`);
			if (document.querySelector('#filterCustomizeControls .property-actions')) throw new Error('Tint quick picks still use a nested property-actions row');
			if (document.getElementById('filterTintMode')) throw new Error('Tint still exposes a separate blend mode');
			const expectedBlendModes = CONFIG.layers.blendModes.join(',');
			['glitterLayerBlendMode', 'stickerLayerBlendMode', 'textLayerBlendMode', 'shapeLayerBlendMode'].forEach((id) => {
				const control = document.getElementById(id);
				if (!control) throw new Error(`${id} is missing`);
				if ([...control.options].map((option) => option.value).join(',') !== expectedBlendModes) throw new Error(`${id} has the wrong blend modes`);
				if (control.value !== CONFIG.layers.defaultBlendMode) throw new Error(`${id} does not default to Normal`);
				if (control.closest('.property-row')?.querySelector('.property-label')?.textContent !== 'Blend') throw new Error(`${id} is not labelled Blend`);
			});
			if (document.getElementById('filterTintAmount')?.closest('.property-row')?.querySelector('.property-label')?.textContent !== 'Density') throw new Error('Tint strength is not labelled Density');
			const tintPresets = [...document.getElementById('filterTintPreset').options];
			if (tintPresets[0]?.value !== 'warming-85' || tintPresets.at(-1)?.value !== 'custom') throw new Error('Tint preset order is incorrect');
			editor.filterLayerManager.chooseLook(GlitterFilters.looksLibrary.get('instagram:rio'));
			layer.filterData = GlitterFilter.normalizeFilterData({ type: 'instagram', presetId: 'clarendon' });
			editor.filterLayerManager.loadLayerSettings(layer);
			editor.layerManager.renderLayersList();
			const firstPreset = document.querySelector('#filterLooksPicker .preset-grid-option');
			if (firstPreset?.dataset.presetId !== 'instagram:rio') throw new Error('Rio de Janeiro is not the first Instagram look');
			if (!firstPreset.querySelector('.filter-css-thumbnail') || firstPreset.querySelector('canvas')) throw new Error('Instagram look thumbnail is not CSS-only');
			if (document.querySelector('#filterCustomizeControls .preset-grid-option')) throw new Error('Instagram Settings still render a nested preset grid');
			if (!document.querySelector('.layer-swatch.filter .filter-css-thumbnail') || document.querySelector('.layer-swatch.filter canvas')) throw new Error('Filter layer thumbnail is not CSS-only');
			const filterType = document.querySelector(`[data-layer-id="${layer.id}"] .layer-type`)?.textContent;
			if (filterType !== 'Filter · Clarendon') throw new Error(`Filter layer summary is incorrect: ${filterType}`);

			const shape = editor.shapeGlitterManager.createLayer({ shapeId: 'square' });
			editor.layerManager.insertLayer(shape);
			editor.layerManager.setActiveLayer(shape.id);
			await raf2();
			const filterIndex = editor.layers.findIndex((entry) => entry.id === layer.id);
			editor.layers.splice(filterIndex, 1);
			editor.layers.push(layer);
			editor.layerManager.reorderLayerItems();
			editor.layerManager.reorderLayers();
			const filterElement = editor.filterLayerManager.layerElements.get(layer.id);
			if (filterElement?.style.zIndex) throw new Error('Reordering created a stacking context on the filter wrapper');
			await raf2();
			if (filterElement?.querySelector('.filter-layer-fill')?.style.mixBlendMode !== 'overlay') throw new Error('Filter blend mode did not survive layer reordering');
			if (section.classList.contains('visible')) throw new Error('Filter Properties remained visible for another layer type');
			editor.layerManager.setActiveLayer(layer.id);
		});
	},
	SHAPE: async (page) => {
		await page.evaluate(async () => {
			const editor = window.editor;
			const raf2 = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const layer = editor.shapeGlitterManager.createLayer({
				shapeId: 'square',
				width: 120,
				height: 90,
				position: { x: 250, y: 200 }
			});
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			await raf2();
			const blend = document.getElementById('shapeLayerBlendMode');
			blend.value = 'multiply';
			blend.dispatchEvent(new Event('change', { bubbles: true }));
			await raf2();
			if (layer.blendMode !== 'multiply') throw new Error('Shape Blend did not update the layer');
			const wrapper = editor.shapeGlitterManager.layerElements.get(layer.id);
			if (wrapper?.style.mixBlendMode !== 'multiply') throw new Error('Shape Blend did not update the preview wrapper');
			const restored = await editor.layerManager.deserializeLayer(editor.layerManager.serializeLayer(layer));
			if (restored.blendMode !== 'multiply') throw new Error('Shape Blend did not survive serialization');
		});
	},
	TEXT_GLITTER: async (page) => {
		await page.evaluate(async () => {
			const editor = window.editor;
			const layer = editor.textGlitterManager.createLayer({
				text: 'Parity',
				position: { x: 160, y: 150 },
				align: 'center'
			});
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
			await editor.textGlitterManager.refreshLayer(layer, { saveHistory: false });
		});
	},
	STICKER: async (page) => {
		await page.waitForFunction(() => window.editor?.stickerManager?.content?.length > 0);
		await page.evaluate(() => {
			const editor = window.editor;
			const layer = editor.stickerManager.createLayer(editor.stickerManager.content[0].id);
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
		});
	},
	GLITTER_FILL: async (page) => {
		await page.waitForFunction(() => window.editor?.glitterManager?.content?.length > 0);
		await page.evaluate(() => {
			const editor = window.editor;
			const layer = editor.glitterManager.createLayer();
			editor.layerManager.insertLayer(layer);
			layer.fill.glitterId = editor.glitterManager.content[0].id;
			editor.layerManager.setActiveLayer(layer.id);
		});
	}
};

async function capture(browser) {
	const snapshot = { structure: null, states: {} };

	{
		const page = await browser.newPage({ viewport: VIEWPORT });
		try {
			await openEditor(page);
			await settle(page);
			await page.evaluate(() => {
				const image = document.getElementById('imagePanelSection');
				const layers = document.getElementById('layersPanelSection');
				document.getElementById('imagePanelHeader')?.click();
				if (image?.classList.contains('is-open') || image?.querySelector(':scope > .section-content')?.classList.contains('visible')) {
					throw new Error('Image section did not use the shared collapsed state');
				}
				if (!layers?.classList.contains('is-open')) throw new Error('Collapsing Image also collapsed independent Layers section');
				document.getElementById('imagePanelHeader')?.click();
			});
			snapshot.structure = await captureStructure(page);
			await page.evaluate(() => {
				const glitter = window.editor.glitterManager?.getAllContent?.()[0];
				if (!glitter) throw new Error('No glitter asset available for Change-button verification');
				window.editor.updateGlitterAssetInfo(glitter);
				document.getElementById('glitterAssetChange')?.click();
				if (!document.getElementById('designGallerySection')?.classList.contains('is-open')) {
					throw new Error('Glitter Fill Change button did not open the Design Gallery');
				}
				const sticker = window.editor.stickerManager?.getAllContent?.()[0];
				if (!sticker) throw new Error('No sticker asset available for Change-button verification');
				window.editor.updateStickerAssetInfo(sticker);
				const stickerChange = document.getElementById('stickerAssetChange');
				if (!stickerChange) throw new Error('Sticker Asset is missing its Change button');
				stickerChange.click();
			});
		} finally {
			await page.close();
		}
	}

	for (const [type, setup] of Object.entries(LAYER_SETUPS)) {
		const page = await browser.newPage({ viewport: VIEWPORT });
		try {
			await openEditor(page);
			await setup(page);
			await settle(page);
			snapshot.states[type] = await captureLayerState(page);
		} finally {
			await page.close();
		}
	}

	return snapshot;
}

function flatten(value, prefix, out) {
	if (value === null || typeof value !== 'object') {
		out.set(prefix, value === null ? 'null' : String(value));
		return;
	}
	if (Array.isArray(value)) {
		// Structure entries are keyed by id (stable identity), not index, so an
		// inserted element doesn't cascade-shift every later entry in the diff.
		value.forEach((entry, index) => {
			const key = entry && typeof entry === 'object' && entry.id ? entry.id : String(index);
			flatten(entry, `${prefix}[${key}]`, out);
		});
		if (prefix.endsWith('structure')) {
			out.set(`${prefix}.__order`, value.map((entry) => entry.id).join(' > '));
		}
		return;
	}
	Object.entries(value).forEach(([key, entry]) => flatten(entry, `${prefix}.${key}`, out));
}

function diff(baseline, current) {
	const before = new Map();
	const after = new Map();
	flatten(baseline, '', before);
	flatten(current, '', after);
	const problems = [];
	before.forEach((value, key) => {
		if (!after.has(key)) problems.push(`MISSING  ${key} (baseline: ${value})`);
		else if (after.get(key) !== value) problems.push(`CHANGED  ${key}: ${value} -> ${after.get(key)}`);
	});
	after.forEach((value, key) => {
		if (!before.has(key)) problems.push(`ADDED    ${key} = ${value}`);
	});
	return problems;
}

async function main() {
	const captureMode = process.argv.includes('--capture');
	const browser = await chromium.launch({ headless: true });
	try {
		const snapshot = await capture(browser);
		assert(snapshot.structure.length > 100, `Suspiciously small structure capture (${snapshot.structure.length} entries) — did the app boot?`);

		if (captureMode) {
			fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
			fs.writeFileSync(BASELINE_PATH, JSON.stringify(snapshot, null, '\t') + '\n');
			console.log(`Baseline written: ${BASELINE_PATH}`);
			console.log(`  structure entries: ${snapshot.structure.length}`);
			Object.entries(snapshot.states).forEach(([type, state]) => {
				console.log(`  ${type}: ${Object.keys(state.visibility).length} ids, ${Object.keys(state.slotSweep).length} slot groups`);
			});
			return;
		}

		assert(fs.existsSync(BASELINE_PATH), `No baseline at ${BASELINE_PATH} — run with --capture first`);
		const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
		const problems = diff(baseline, snapshot);
		if (problems.length) {
			console.error(`Panel parity FAILED: ${problems.length} diff(s) against baseline\n`);
			problems.slice(0, MAX_REPORTED_DIFFS).forEach((line) => console.error(line));
			if (problems.length > MAX_REPORTED_DIFFS) {
				console.error(`… and ${problems.length - MAX_REPORTED_DIFFS} more`);
			}
			process.exit(1);
		}
		console.log('Panel parity: no differences against baseline.');
		console.log(`  structure entries: ${snapshot.structure.length}`);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error?.stack || String(error));
	process.exit(1);
});
