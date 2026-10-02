'use strict';
// A/B computed-style comparison: the required check for a styling change that
// is meant to be invisible. Loads the app once per viewport, then in every
// state from tools/ui-states.js swaps the stylesheet between A and B on the
// SAME DOM and reports each element whose computed style or box differs.
//
//   npx sass css/style.scss <scratch>/b.css --no-source-map
//   node tools/ui-ab.js <a.css> <b.css> [--only name] [--max N] [--agg] [--rects] [--allow file.json]
//
// A is usually a compile of the commit being changed; B is the candidate.
// `--allow` names a JSON list of accepted differences, each
// `{ el, prop, val?, why }` with regex strings matched against the element
// label, the property and "old -> new". Exit code 1 when anything differs.

const fs = require('fs');
const { chromium, VIEWPORTS, boot, desktopStates, phoneStates } = require('./ui-states');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (flag(name) ? args[args.indexOf(name) + 1] : null);
const [A, B] = args;
if (!A || !B || A.startsWith('--') || B.startsWith('--')) {
	console.error('usage: node tools/ui-ab.js <a.css> <b.css> [--only name] [--max N] [--agg] [--rects] [--allow file.json]');
	process.exit(2);
}
const only = option('--only');
const MAX = Number(option('--max') || 25);
const css = { a: fs.readFileSync(A), b: fs.readFileSync(B) };
const allowFile = option('--allow');
const allow = allowFile
	? JSON.parse(fs.readFileSync(allowFile, 'utf8')).map((r) => ({ el: new RegExp(r.el), prop: new RegExp(r.prop), val: r.val ? new RegExp(r.val) : null }))
	: [];

// Logical twins of physical properties, and properties that only restate the
// box (the rect is compared separately).
const IGNORE = /^(border-block|border-inline|column-rule|outline-color|row-rule|text-decoration-color|text-emphasis|-webkit-text-fill|-webkit-text-stroke|margin-inline|margin-block|padding-inline|padding-block|caret-color|min-block|max-block|scroll-|transition|animation|-webkit-transition|-webkit-animation|will-change|perspective-origin|transform-origin|inline-size|block-size|width|height|inset|top|left|right|bottom|min-inline|max-inline)/;

async function useCss(page, which) {
	await page.evaluate((w) => new Promise((resolve) => {
		const link = document.querySelector('link[data-ab]') || document.querySelector('link[rel="stylesheet"][href*="css/style.css"]');
		const next = link.cloneNode();
		next.dataset.ab = '1';
		next.href = `css/__ab_${w}.css?${Date.now()}`;
		next.onload = () => { link.remove(); requestAnimationFrame(() => requestAnimationFrame(resolve)); };
		next.onerror = () => resolve();
		link.after(next);
	}), which);
}

const snap = (page, slot) => page.evaluate(({ ignoreSrc, slot }) => {
	const ignore = new RegExp(ignoreSrc);
	const names = window.__abNames || (window.__abNames = (() => {
		const cs = getComputedStyle(document.body);
		const n = [];
		for (let i = 0; i < cs.length; i++) { const p = cs[i]; if (!p.startsWith('--') && !ignore.test(p)) n.push(p); }
		return n;
	})());
	const out = [];
	const walk = (el, key) => {
		const tag = el.tagName;
		if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'LINK' || tag === 'META') return;
		if (el.classList.contains('sparkle-particle') || el.classList.contains('layer-anim-wrapper')) return;
		const cs = getComputedStyle(el);
		const hidden = cs.display === 'none';
		const r = el.getBoundingClientRect();
		const vals = hidden ? ['display:none'] : names.map((p) => cs.getPropertyValue(p));
		const rect = `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}`;
		const pseudo = [];
		if (!hidden) for (const which of ['::before', '::after']) {
			const ps = getComputedStyle(el, which);
			if (ps.content === 'none' || ps.content === 'normal') { pseudo.push(null); continue; }
			pseudo.push(names.map((p) => ps.getPropertyValue(p)));
		}
		const parent = el.parentElement?.classList[0] || el.parentElement?.tagName.toLowerCase() || '';
		out.push({ key, label: `${parent}>${tag.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].join('.')}`, vals, rect, pseudo });
		if (hidden || tag === 'svg' || tag === 'SVG') return;
		let i = 0;
		for (const child of el.children) walk(child, `${key}/${i++}`);
	};
	walk(document.body, 'b');
	if (slot === 'a') { window.__abA = out; return { count: out.length }; }
	const a = window.__abA;
	const diffs = [];
	if (a.length !== out.length) diffs.push({ el: 'DOM', props: { length: [a.length, out.length] } });
	const n = Math.min(a.length, out.length);
	for (let i = 0; i < n; i++) {
		const x = a[i];
		const y = out[i];
		const d = {};
		if (x.vals.length !== y.vals.length) d.display = [x.vals.length === 1 ? 'none' : 'shown', y.vals.length === 1 ? 'none' : 'shown'];
		else for (let j = 0; j < x.vals.length; j++) if (x.vals[j] !== y.vals[j]) d[x.vals.length === 1 ? 'display' : names[j]] = [x.vals[j], y.vals[j]];
		for (let k = 0; k < 2; k++) {
			const px = x.pseudo[k];
			const py = y.pseudo[k];
			const tagp = k ? '::after ' : '::before ';
			if (!px && !py) continue;
			if (!px || !py) { d[`${tagp}content`] = [px ? 'present' : 'none', py ? 'present' : 'none']; continue; }
			for (let j = 0; j < px.length; j++) if (px[j] !== py[j]) d[tagp + names[j]] = [px[j], py[j]];
		}
		if (x.rect !== y.rect) d.__rect = [x.rect, y.rect];
		if (Object.keys(d).length) diffs.push({ el: y.label, key: y.key, props: d });
	}
	return { count: out.length, diffs };
}, { ignoreSrc: IGNORE.source, slot });

let total = 0;
const AGG = new Map();
const T0 = Date.now();
const summary = [];

const comparer = (page) => async (name) => {
	if (only && !name.includes(only)) return;
	await useCss(page, 'a');
	await snap(page, 'a');
	await useCss(page, 'b');
	const res = await snap(page, 'b');
	let diffs = res.diffs;
	for (const d of diffs) {
		for (const k of Object.keys(d.props)) {
			if (allow.some((r) => r.el.test(d.el) && r.prop.test(k) && (!r.val || r.val.test(`${d.props[k][0]} -> ${d.props[k][1]}`)))) delete d.props[k];
		}
	}
	diffs = diffs.filter((d) => Object.keys(d.props).length);
	for (const d of diffs) {
		const sig = d.el.replace(/#[^.]*/, '').split('.').slice(0, 4).join('.');
		for (const [k, [x, y]] of Object.entries(d.props)) {
			if (k === '__rect') continue;
			const key = `${sig} | ${k} | ${String(x).slice(0, 70)} -> ${String(y).slice(0, 70)}`;
			const e = AGG.get(key) || { n: 0, where: name, id: d.el.slice(0, 90) };
			e.n++;
			AGG.set(key, e);
		}
	}
	// A rect-only difference is downstream of a real one; it is listed last.
	const real = diffs.filter((d) => Object.keys(d.props).some((k) => k !== '__rect'));
	total += diffs.length;
	process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${name}: ${diffs.length}\n`);
	summary.push(`${diffs.length ? 'DIFF' : 'ok  '} ${name}: ${res.count} els, ${real.length} style diffs, ${diffs.length - real.length} rect-only`);
	if (!diffs.length) return;
	console.log(`\n=== ${name}: ${real.length} style diffs, ${diffs.length - real.length} rect-only`);
	const shown = flag('--agg') ? [] : (flag('--rects') ? diffs.filter((d) => !real.includes(d)) : (real.length ? real : diffs));
	shown.slice(0, MAX).forEach((d) => {
		console.log(`  ${d.el}`);
		Object.entries(d.props).slice(0, 8).forEach(([k, [x, y]]) => console.log(`      ${k}: ${String(x).slice(0, 90)}  ->  ${String(y).slice(0, 90)}`));
	});
};

(async () => {
	const browser = await chromium.launch({ headless: true });
	for (const phone of [false, true]) {
		const ctx = await browser.newContext(phone ? { viewport: VIEWPORTS.phone, hasTouch: true, isMobile: true } : { viewport: VIEWPORTS.desk });
		const page = await ctx.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await boot(page, css);
		await (phone ? phoneStates : desktopStates)(page, comparer(page));
		if (errors.length) console.log(`PAGE ERRORS (${phone ? 'phone' : 'desk'}):`, [...new Set(errors)].slice(0, 5));
		await ctx.close();
	}
	if (flag('--agg')) {
		console.log('=== AGGREGATE');
		[...AGG.entries()].sort((p, q) => q[1].n - p[1].n).slice(0, 400).forEach(([k, e]) => console.log(`${String(e.n).padStart(5)}  ${k}    [${e.where} :: ${e.id}]`));
	}
	console.log(`\n${summary.join('\n')}`);
	console.log(`\nTOTAL differing elements: ${total}`);
	await browser.close();
	process.exit(total ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
