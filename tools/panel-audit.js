'use strict';
// Property-panel refactor guard. Captures the behavioural contract of the design
// sidebar: every [id], its tag/type/slider range, plus a hidden/visible sweep of
// every paint-source mode and effect toggle across all layer types. Classes and
// wrapper nesting are deliberately NOT captured - those are what the refactor
// changes. Anything else changing is a defect.
//
//   node tools/panel-audit.js --capture [out.json]
//   node tools/panel-audit.js --diff <baseline.json>

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.GLITTER_PORT || 8899;
const URL = process.env.GLITTER_URL || `http://localhost:${PORT}/index.html`;
const CHROME = process.env.CHROME_PATH
	|| '/Users/amberellis/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const SECTIONS = [
	'noLayerSettingsSection', 'baseLayerSettingsSection', 'glitterSettingsSection',
	'brushSettingsSection', 'stickerSettingsSection', 'textSettingsSection',
	'shapeSettingsSection', 'layerSettingsSection', 'autoGlitterSettingsSection'
];

function serve() {
	const child = spawn('python3', ['-m', 'http.server', String(PORT)], {
		cwd: path.join(__dirname, '..'), stdio: 'ignore', detached: true
	});
	return () => { try { process.kill(-child.pid); } catch (e) { /* already gone */ } };
}

async function boot(page) {
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
	await page.goto(URL, { waitUntil: 'networkidle' });
	await page.evaluate(() => document.querySelectorAll('.modal-overlay.visible').forEach((n) => n.classList.remove('visible')));
	await page.evaluate(async () => { await window.editor.loadBlankImage(500, 400, '#ffffff'); });
	await page.waitForFunction(() => Boolean(window.editor?.originalImage));
	return errors;
}

// Every id in scope with the properties that define its behaviour.
async function captureIds(page) {
	return page.evaluate((sections) => {
		const out = {};
		sections.forEach((sectionId) => {
			const section = document.getElementById(sectionId);
			if (!section) return;
			[section, ...section.querySelectorAll('[id]')].forEach((el) => {
				if (!el.id || out[el.id]) return;
				const entry = { tag: el.tagName.toLowerCase(), section: sectionId };
				if (el.type) entry.type = el.type;
				if (el.tagName === 'INPUT' && el.type === 'range') {
					entry.range = `${el.min}/${el.max}/${el.step || ''}/${el.getAttribute('value')}`;
				}
				if (el.tagName === 'SELECT') entry.options = Array.from(el.options).map((o) => o.value).join(',');
				if (el.dataset.role) entry.role = el.dataset.role;
				if (el.dataset.mode) entry.mode = el.dataset.mode;
				out[el.id] = entry;
			});
		});
		return out;
	}, SECTIONS);
}

// Visibility of every id, after a given interaction. Catches conditional-display
// regressions that an id census cannot.
async function captureVisibility(page) {
	return page.evaluate((sections) => {
		const out = {};
		sections.forEach((sectionId) => {
			const section = document.getElementById(sectionId);
			if (!section) return;
			section.querySelectorAll('[id]').forEach((el) => {
				let node = el;
				let visible = true;
				while (node && node !== document.body) {
					const cs = getComputedStyle(node);
					if (cs.display === 'none' || cs.visibility === 'hidden' || node.hidden) { visible = false; break; }
					node = node.parentElement;
				}
				out[el.id] = visible;
			});
		});
		return out;
	}, SECTIONS);
}

// Force every collapsible open so visibility reflects conditional logic, not
// collapse state (which the refactor intentionally changes).
async function expandAll(page) {
	await page.evaluate(() => {
		document.querySelectorAll('.section.collapsible-section').forEach((s) => {
			s.classList.add('visible', 'is-open');
			s.querySelector(':scope > .section-content')?.classList.add('visible');
		});
		document.querySelectorAll('.collapsed').forEach((n) => n.classList.remove('collapsed'));
		document.querySelectorAll('.is-collapsed').forEach((n) => n.classList.remove('is-collapsed'));
		document.querySelectorAll('[data-advanced]').forEach((n) => n.classList.add('is-open'));
		document.querySelectorAll('.text-effect-controls').forEach((n) => n.classList.add('visible'));
	});
	await page.waitForTimeout(120);
}

async function addLayers(page) {
	await page.evaluate(async () => {
		await window.editor.textGlitterManager?.addTextLayer?.();
	});
	await page.waitForTimeout(300);
}

// Structural health metrics the refactor is meant to move.
async function captureMetrics(page) {
	return page.evaluate((sections) => {
		const out = {};
		sections.forEach((id) => {
			const s = document.getElementById(id);
			if (!s) return;
			const visible = (el) => {
				if (!el.getClientRects().length) return false;
				let node = el;
				while (node && node !== document.body) {
					const cs = getComputedStyle(node);
					if (cs.display === 'none' || cs.visibility === 'hidden' || node.hidden) return false;
					node = node.parentElement;
				}
				return true;
			};
			const boxes = Array.from(s.querySelectorAll('*')).filter((n) => {
				const cs = getComputedStyle(n);
				return visible(n) && (parseFloat(cs.borderTopWidth) > 0 || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent'));
			}).length;
			// deepest chain of nested collapsibles
			const sel = '.collapsible-section, [data-collapsible-subsection], .subsection-section-group, [data-panel-group], [data-advanced]';
			let deepest = 0;
			s.querySelectorAll(sel).forEach((n) => {
				let d = 0; let p = n;
				while (p && p !== document.body) { if (p.matches(sel)) d++; p = p.parentElement; }
				if (d > deepest) deepest = d;
			});
			// containers rendering with no visible meaningful content
			let shells = 0;
			const shellCandidates = [
				'.subsection-content-group', '.subsection-card-body', '.paint-slot-main',
				'.property-set', '.property-toggle-list', '.settings-action-row',
				'.property-actions', '.advanced-disclosure-content'
			].join(',');
			s.querySelectorAll(shellCandidates).forEach((el) => {
				if (!visible(el)) return;
				const kids = Array.from(el.children).filter((c) => !/label|title/.test(c.className));
				if (!kids.length) return;
				if (kids.some(visible)) return;
				const cs = getComputedStyle(el);
				if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.paddingTop) > 0) shells++;
			});
			out[id] = {
				scrollHeight: s.querySelector('.section-content')?.scrollHeight || 0,
				boxes, deepestCollapsibleChain: deepest, shells,
				collapsibleCards: s.querySelectorAll('[data-collapsible-subsection]').length,
				sliders: s.querySelectorAll('input[type=range]').length
			};
		});
		return out;
	}, SECTIONS);
}

async function run() {
	const stop = serve();
	await new Promise((r) => setTimeout(r, 900));
	const browser = await chromium.launch({ executablePath: CHROME });
	const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
	try {
		const errors = await boot(page);
		await addLayers(page);
		await expandAll(page);
		const ids = await captureIds(page);
		const states = {};
		states.base = await captureVisibility(page);

		// Paint-source sweep on every slot that has one.
		const slots = await page.evaluate(() => Array.from(document.querySelectorAll('.text-effect-subsection[data-slot], [data-role="paint-slot"]'))
			.map((s) => s.querySelector('.segmented-control')?.id || s.dataset.slot).filter(Boolean));
		for (const mode of ['glitter', 'solid', 'none', 'gradient']) {
			await page.evaluate((m) => {
				document.querySelectorAll(`[data-role="paint-slot"] .segmented-option[data-mode="${m}"], .text-effect-subsection .segmented-option[data-mode="${m}"]`)
					.forEach((b) => b.click());
			}, mode);
			await page.waitForTimeout(280);
			await expandAll(page);
			states[`mode:${mode}`] = await captureVisibility(page);
		}
		// Effect toggles on.
		await page.evaluate(() => document.querySelectorAll('input[data-effect-toggle]').forEach((c) => { if (!c.checked) c.click(); }));
		await page.waitForTimeout(320);
		await expandAll(page);
		states['effects:on'] = await captureVisibility(page);

		const metrics = await captureMetrics(page);
		return { ids, states, metrics, errors, slots };
	} finally {
		await browser.close();
		stop();
	}
}

function diff(current, baseline) {
	const problems = [];
	const notes = [];
	const curIds = Object.keys(current.ids);
	const baseIds = Object.keys(baseline.ids);
	baseIds.filter((id) => !curIds.includes(id)).forEach((id) => problems.push(`LOST id: ${id} (${baseline.ids[id].section})`));
	curIds.filter((id) => !baseIds.includes(id)).forEach((id) => notes.push(`new id: ${id} (${current.ids[id].section})`));
	curIds.filter((id) => baseIds.includes(id)).forEach((id) => {
		const a = current.ids[id];
		const b = baseline.ids[id];
		['tag', 'type', 'range', 'options'].forEach((key) => {
			if (a[key] !== b[key]) problems.push(`CHANGED ${id}.${key}: ${b[key]} -> ${a[key]}`);
		});
		if (a.section !== b.section) problems.push(`MOVED ${id}: ${b.section} -> ${a.section}`);
	});
	Object.keys(baseline.states).forEach((state) => {
		const cur = current.states[state] || {};
		const base = baseline.states[state];
		Object.keys(base).forEach((id) => {
			if (!(id in cur)) return;
			if (cur[id] !== base[id]) problems.push(`VISIBILITY ${state} ${id}: ${base[id]} -> ${cur[id]}`);
		});
	});
	current.errors.forEach((e) => problems.push(`RUNTIME ${e}`));
	Object.entries(current.metrics).forEach(([section, metrics]) => {
		if (metrics.shells > 0) problems.push(`EMPTY SHELLS ${section}: ${metrics.shells}`);
	});
	return { problems, notes };
}

(async () => {
	const args = process.argv.slice(2);
	const result = await run();
	if (args[0] === '--capture') {
		const out = args[1] || path.join(__dirname, '..', 'tests', 'fixtures', 'property-panel-baseline.json');
		fs.writeFileSync(out, JSON.stringify(result, null, '\t'));
		console.log(`captured ${Object.keys(result.ids).length} ids -> ${out}`);
		console.log(JSON.stringify(result.metrics, null, 1));
		if (result.errors.length) console.log('runtime errors:', result.errors);
		return;
	}
	const baselinePath = args[1] || path.join(__dirname, '..', 'tests', 'fixtures', 'property-panel-baseline.json');
	const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
	const { problems, notes } = diff(result, baseline);
	console.log('--- metrics ---');
	Object.entries(result.metrics).forEach(([id, m]) => {
		const b = baseline.metrics[id] || {};
		console.log(`${id.padEnd(30)} h:${String(b.scrollHeight || 0).padStart(5)}->${String(m.scrollHeight).padStart(5)}  boxes:${String(b.boxes || 0).padStart(4)}->${String(m.boxes).padStart(4)}  chain:${b.deepestCollapsibleChain || 0}->${m.deepestCollapsibleChain}  collapsibles:${b.collapsibleCards || 0}->${m.collapsibleCards}  shells:${b.shells || 0}->${m.shells}`);
	});
	if (notes.length) console.log(`\n--- ${notes.length} new ids ---\n` + notes.join('\n'));
	if (problems.length) {
		console.log(`\n!!! ${problems.length} PROBLEMS !!!\n` + problems.slice(0, 80).join('\n'));
		process.exitCode = 1;
	} else {
		console.log('\nOK - no lost ids, no spec changes, no visibility regressions, no runtime errors.');
	}
})();
