'use strict';

// Sidebar structural-parity harness.
// Captures every [id] element inside the design-panel settings sections
// (tag, classes, nearest [id] ancestor, input ranges) plus, per layer type,
// the hidden/active state of every control through a full paint-slot mode
// sweep. The committed baseline is the zero-behavior-change contract: after
// a template migration the diff must be empty — any delta is a defect, not
// a judgment call.
//
//   node tests/panel-parity.js            diff current DOM against baseline
//   node tests/panel-parity.js --capture  (re)write the baseline
//
// The baseline regenerates only when a WP intentionally adds template-stamped
// IDs; it must never lose or alter existing entries.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.GLITTER_URL || 'http://localhost/glitter/';
const VIEWPORT = { width: 1400, height: 1000 };
const BASELINE_PATH = path.join(__dirname, 'fixtures', 'panel-parity-baseline.json');
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
// ranges/defaults (catches CONFIG.ui.sliders drift).
async function captureStructure(page) {
	return page.evaluate((sectionIds) => {
		document.querySelectorAll('.paint-slot-card[data-slot]').forEach((slot) => {
			const glitterMode = slot.querySelector('.segmented-option[data-mode="glitter"]');
			if (!glitterMode) return;
			if (!slot.querySelector('.asset-info')) throw new Error(`Paint slot ${slot.dataset.slot} has no asset-info block`);
			if (!slot.querySelector('.text-effect-source-change')) throw new Error(`Paint slot ${slot.dataset.slot} has no Change button`);
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
	SHAPE: async (page) => {
		await page.evaluate(() => {
			const editor = window.editor;
			const layer = editor.shapeGlitterManager.createLayer({
				shapeId: 'square',
				width: 120,
				height: 90,
				position: { x: 250, y: 200 }
			});
			editor.layerManager.insertLayer(layer);
			editor.layerManager.setActiveLayer(layer.id);
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
			layer.selectedGlitterId = editor.glitterManager.content[0].id;
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
