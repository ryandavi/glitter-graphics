'use strict';

// Public article fragments and PHP entries, also fetched by editor modals, and
// sitemap.xml. tools/build-modals.js passes compiled fragments in memory.
// Page metadata and the canonical origin live in tools/site.json.
//
// A page is a document like any other: article text, headings and links are
// all in the HTML. Scripts only add the header menu, Mac key labels and the
// release-note toggles.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { tokenize, buildTree, walk } = require('./modal-tokenize');

const root = path.resolve(__dirname, '..');
const sitePath = path.join(root, 'tools', 'site.json');
const indexPath = path.join(root, 'index.html');
const pageScripts = ['js/ui/menu-popover.js', 'js/core/key-labels.js', 'js/site/content-page.js'];
const pageMenuIcons = ['ellipsis-vertical', 'chevron-down'];
const homeScripts = ['js/site/home-page.js'];
// How many glitter tiles the homepage offers for its wordmark.
const homeSwatchCount = 12;

function escapeHtml(value) {
	return String(value).replace(/[&<>"]/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function loadSite() {
	const site = JSON.parse(fs.readFileSync(sitePath, 'utf8'));
	if (!/^https:\/\/[^/]+\/(?:.*\/)?$/u.test(site.origin || '')) throw new Error('tools/site.json "origin" must be an https URL ending in /');
	return site;
}

// The same 8-character content hash tools/bump-cache.js stamps on index.html.
function assetUrl(relativePath, prefix) {
	const hash = crypto.createHash('md5').update(fs.readFileSync(path.join(root, relativePath))).digest('hex').slice(0, 8);
	return `${prefix}${relativePath}?v=${hash}`;
}

// ---------- data from the editor ----------

let timelineData = null;
function getTimeline() {
	if (timelineData) return timelineData;
	const context = { console };
	vm.createContext(context);
	for (const file of ['js/ui/about-timeline-data.js', 'js/ui/about-timeline.js']) {
		vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
	}
	vm.runInContext('globalThis.__timeline = { ABOUT_TIMELINE, ABOUT_TIMELINE_TAG_LABELS, ABOUT_TIMELINE_COUNTRY_LABELS, renderTimelineItemHtml };', context);
	timelineData = context.__timeline;
	return timelineData;
}

// The editor's analytics region, copied as is so both carry the same snippet
// and the staging deploy strips both the same way.
function analyticsRegion(indexHtml) {
	const match = indexHtml.match(/^[\t ]*<!-- site:analytics:start -->[\s\S]*?<!-- site:analytics:end -->/mu);
	if (!match) throw new Error('index.html has no site:analytics region');
	return match[0].replace(/^[\t ]+/gmu, '\t');
}

// Only the sprite symbols a page uses, taken from the editor's sprite.
function spriteFor(html, indexHtml) {
	const ids = new Set([...html.matchAll(/href="#icon-([\w-]+)"/gu)].map(match => match[1]));
	const symbols = [...ids].sort().map(id => {
		const match = indexHtml.match(new RegExp(`<symbol id="icon-${id}"[\\s\\S]*?</symbol>`, 'u'));
		if (!match) throw new Error(`index.html has no icon-${id} symbol`);
		return `\t\t${match[0]}`;
	});
	return `\t<svg style="display: none;" xmlns="http://www.w3.org/2000/svg">\n${symbols.join('\n')}\n\t</svg>`;
}

// ---------- fragment -> page body ----------

function elementRanges(html, predicate) {
	const tree = buildTree(tokenize(html));
	const nodes = [];
	walk(tree, node => {
		if (node.type === 'element' && predicate(node)) nodes.push(node);
	});
	return nodes;
}

function hasClass(node, name) {
	return String(node.attrs.class || '').split(/\s+/u).includes(name);
}

// Applies [start, end, text] edits (offsets into the original html) from the
// end backwards. An edit that contains earlier-applied ones replaces them too,
// so dropping a block drops whatever was rewritten inside it.
function applyEdits(html, edits) {
	const sorted = [...edits].sort((a, b) => b[0] - a[0] || a[1] - b[1]);
	let output = html;
	let applied = [];
	for (const [start, end, text] of sorted) {
		const inside = applied.filter(edit => edit.start >= start && edit.end <= end);
		if (applied.some(edit => edit.start < end && edit.end > start && !inside.includes(edit))) {
			throw new Error(`Overlapping page edits at ${start}-${end}`);
		}
		const shift = inside.reduce((sum, edit) => sum + edit.delta, 0);
		output = output.slice(0, start) + text + output.slice(end + shift);
		applied = applied.filter(edit => !inside.includes(edit));
		applied.push({ start, end, delta: text.length - (end - start) });
	}
	return output;
}

function openTag(node, transform) {
	const attrs = transform(node.open.attrList.map(([name, value]) => [name, value]));
	// Values are raw source text (entities still encoded), so only quotes need care.
	const text = attrs.map(([name, value]) => value === true ? ` ${name}` : ` ${name}="${String(value).replace(/"/gu, '&quot;')}"`).join('');
	return [node.open.start, node.open.end, `<${node.tag}${text}>`];
}

function innerRange(node, text) {
	return [node.open.end, node.close ? node.close.start : node.open.end, text];
}

// The production feature set decides what a page shows: a block for a feature
// that isn't 'on' is dropped, an 'on' one loses its hidden attribute.
function applyFeatures(html, features) {
	const edits = elementRanges(html, node => node.attrs['data-feature']).map(node => {
		if (features[node.attrs['data-feature']]?.stage !== 'on') return [node.open.start, node.close ? node.close.end : node.open.end, ''];
		return openTag(node, attrs => attrs.filter(([name]) => name !== 'data-feature' && name !== 'hidden'));
	});
	return applyEdits(html, edits);
}

// A link to another document whose page isn't published reads as plain text.
function unlinkUnpublished(html, publishedModals) {
	const edits = elementRanges(html, node => hasClass(node, 'doc-inline-link') && node.attrs['data-open-modal'])
		.filter(node => !publishedModals.has(node.attrs['data-open-modal']) && node.close)
		.flatMap(node => [[node.close.start, node.close.end, ''], [node.open.start, node.open.end, '']]);
	return applyEdits(html, edits.sort((a, b) => b[0] - a[0]));
}

// What the editor's onLoaded hooks fill in (js/editor/modals-wiring.js), written
// into the HTML so it reads without JavaScript.
function fillStatic(html, page, registries) {
	const { CONFIG, KEY_LABELS_PC, formatKeyLabel, renderReleaseEntryHtml } = registries;
	const edits = [];
	for (const node of elementRanges(html, () => true)) {
		const { attrs } = node;
		if (attrs['data-app-version'] !== undefined) edits.push(innerRange(node, escapeHtml(CONFIG.app.version)));
		if (attrs['data-version-history'] !== undefined) {
			edits.push(innerRange(node, CONFIG.app.releases.map((release, index) => renderReleaseEntryHtml(release, { open: index === 0 })).join('')));
		}
		if (attrs.id === 'PreservationTimelineList') {
			const timeline = getTimeline();
			edits.push(innerRange(node, timeline.ABOUT_TIMELINE.map(item => timeline.renderTimelineItemHtml(item, timeline.ABOUT_TIMELINE_TAG_LABELS, timeline.ABOUT_TIMELINE_COUNTRY_LABELS)).join('')));
		}
		// Keep editor-only controls inert in the page; modal extraction restores them.
		if (['PreservationTimelineFiltersToggle', 'PreservationTimelineFilters', 'PreservationTimelineSummary'].includes(attrs.id)) {
			const end = node.close ? node.close.end : node.open.end;
			edits.push([node.open.start, end, `<template data-modal-only>${html.slice(node.open.start, end)}</template>`]);
		}
		if ((hasClass(node, 'guide-kbd') || hasClass(node, 'guide-key-label')) && node.close && !attrs['data-key']) {
			const authored = html.slice(node.open.end, node.close.start).trim();
			if (!/[<>]/u.test(authored)) {
				edits.push(innerRange(node, escapeHtml(formatKeyLabel(authored.replace(/&amp;/gu, '&'), KEY_LABELS_PC))));
				edits.push(openTag(node, list => [...list, ['data-key', authored]]));
			}
		}
		if (node.tag === 'img' && attrs['data-pixel-scale'] !== undefined && attrs.width) {
			edits.push(openTag(node, list => {
				const style = list.find(([name]) => name === 'style');
				const width = `width: ${attrs.width}px`;
				if (style) style[1] = `${String(style[1]).replace(/;?\s*$/u, '')}; ${width}`;
				else list.push(['style', width]);
				return list;
			}));
		}
	}
	return applyEdits(html, edits);
}

// Relative URLs in a fragment resolve against the editor root; a page sits one
// folder down.
function prefixRelativeUrls(html, prefix) {
	const relative = value => value && !/^(?:[a-z][a-z0-9+.-]*:|\/|#|\?)/iu.test(value);
	return html
		.replace(/(\s(?:src|href|poster)=")([^"]*)"/gu, (match, head, value) => relative(value) ? `${head}${prefix}${value}"` : match)
		.replace(/(\ssrcset=")([^"]*)"/gu, (match, head, value) => `${head}${value.split(',').map(part => {
			const trimmed = part.trim();
			return relative(trimmed) ? part.replace(trimmed, `${prefix}${trimmed}`) : part;
		}).join(',')}"`);
}

function pageBody(page, fragment, context) {
	if (page.source === 'releases') {
		const { CONFIG, renderReleaseEntryHtml } = context.registries;
		const entries = CONFIG.app.releases.map(release => renderReleaseEntryHtml(release, { open: true })).join('\n');
		return [
			`<h1 class="content-page-title">${escapeHtml(page.title)}</h1>`,
			`<p>Every Glitter Editor release, newest first. You're reading about version <strong>${escapeHtml(CONFIG.app.version)}</strong>.</p>`,
			`<div class="version-history">\n${entries}\n</div>`
		].join('\n');
	}
	let html = fragment.replace(/^<!-- GENERATED[^\n]*-->\n/u, '');
	html = applyFeatures(html, context.registries.FEATURES);
	html = unlinkUnpublished(html, context.publishedModals);
	html = fillStatic(html, page, context.registries);
	return html.trim();
}

// ---------- homepage data ----------

function readData(file) {
	return JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8'));
}

// The homepage fills its wordmark with Library tiles from the credited archival
// sets only, spread across the hue range, and names the set each one came from.
function homeData(site, registries) {
	const credited = new Map(readData('glitter-categories.json')
		.filter(category => category.attribution?.sourceUrl && category.count > 0)
		.map(category => [category.id, category]));
	const tiles = readData('glitter.json');
	const pool = tiles
		.filter(tile => credited.has(tile.set) && tile.isAnimated && !tile.hasTransparency)
		.filter((tile, index, all) => all.findIndex(other => other.name === tile.name) === index)
		.sort((a, b) => a.hue - b.hue);
	if (!pool.length) throw new Error('No credited, animated glitter tiles for the homepage');
	const count = Math.min(homeSwatchCount, pool.length);
	const swatches = Array.from({ length: count }, (_, index) => pool[Math.floor(index * pool.length / count)])
		.map(tile => ({ url: tile.url, name: tile.name, width: tile.width, height: tile.height, set: tile.set }));
	const sets = Object.fromEntries([...new Set(swatches.map(swatch => swatch.set))].map(id => {
		const { name, attribution } = credited.get(id);
		return [id, { name, sourceUrl: attribution.sourceUrl, author: attribution.author, authorUrl: attribution.authorUrl || '' }];
	}));
	const release = registries.CONFIG.app.releases[0];
	return {
		...site.home,
		slug: 'home',
		kinds: ['home'],
		counts: { glitter: tiles.length, stickers: readData('stickers.json').length },
		release: { version: release.version, name: release.name, dateLabel: release.dateLabel },
		swatches,
		sets
	};
}

// ---------- shared PHP page data ----------

function pageEntry(slug) {
	return `<?php\n// GENERATED by tools/build-pages.js. Do not edit.\n$slug = '${slug}';\nrequire dirname(__DIR__) . '/site/page.php';\n`;
}

const homeEntry = `<?php\n// GENERATED by tools/build-pages.js. Do not edit.\n$slug = 'home';\nrequire __DIR__ . '/site/page.php';\n`;

function renderSitemap(site, pages) {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		`\t<url><loc>${site.origin}</loc></url>`,
		...pages.map(page => `\t<url><loc>${site.origin}${page.slug}/</loc></url>`),
		'</urlset>',
		''
	].join('\n');
}

// ---------- build ----------

// A targeted rebuild compiles the other articles without saving fragments.
function buildPages({ fragments = new Map(), registries, compileFragment, check = false }) {
	const site = loadSite();
	const indexHtml = fs.readFileSync(indexPath, 'utf8');
	const problems = [];
	const ogUrl = indexHtml.match(/<meta property="og:url" content="([^"]*)">/u)?.[1];
	// The editor lives at studio/; the origin itself is the homepage.
	if (ogUrl !== `${site.origin}studio/`) problems.push(`index.html og:url "${ogUrl}" is not tools/site.json origin + "studio/"`);

	const pages = site.pages.filter(page => !page.feature || registries.FEATURES[page.feature]?.stage === 'on');
	const context = { site, pages, indexHtml, registries, publishedModals: new Set(pages.map(page => page.modal).filter(Boolean)) };
	const outputs = new Map();
	const bodies = [];
	for (const page of pages) {
		let body = '';
		if (page.source !== 'releases') {
			const fragment = fragments.get(page.source) ?? compileFragment(page.source);
			body = pageBody(page, fragment, context);
		} else {
			body = pageBody(page, '', context);
		}
		outputs.set(path.join(root, page.slug, 'index.php'), pageEntry(page.slug));
		const article = prefixRelativeUrls(body, '../');
		bodies.push(article);
		outputs.set(path.join(root, page.slug, 'content.html'), `<!-- GENERATED by tools/build-pages.js. Do not edit. -->\n${article}\n`);
	}
	outputs.set(path.join(root, 'site', 'generated.json'), JSON.stringify({
		origin: site.origin, siteName: site.siteName, copyright: site.copyright, pages,
		stylesheet: assetUrl('css/style.css', ''), favicon: assetUrl('images/etc/favicon.ico', ''),
		scripts: pageScripts.map(script => assetUrl(script, '')),
		homeScripts: homeScripts.map(script => assetUrl(script, '')),
		home: homeData(site, registries)
	}, null, '\t') + '\n');
	outputs.set(path.join(root, 'index.php'), homeEntry);
	const menuIcons = [...pageMenuIcons, ...pages.map(page => page.icon)];
	outputs.set(path.join(root, 'site', 'sprite.html'), spriteFor(bodies.join('\n') + menuIcons.map(id => `<use href="#icon-${id}"></use>`).join(''), indexHtml) + '\n');
	outputs.set(path.join(root, 'site', 'analytics.html'), analyticsRegion(indexHtml) + '\n');
	outputs.set(path.join(root, 'sitemap.xml'), renderSitemap(site, pages));

	const stale = [];
	for (const [file, content] of outputs) {
		const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
		if (current === content) continue;
		stale.push(path.relative(root, file).replace(/\\/gu, '/'));
		if (!check) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, content, 'utf8');
		}
	}
	const obsolete = [
		...site.pages.map(page => `${page.slug}/index.html`),
		'studio/index.html', '404.html',
		...site.pages.filter(page => !pages.includes(page)).flatMap(page => [`${page.slug}/index.php`, `${page.slug}/content.html`])
	];
	for (const relative of obsolete) {
		const file = path.join(root, relative);
		if (!fs.existsSync(file)) continue;
		stale.push(`${relative} (obsolete)`);
		if (!check) fs.rmSync(file);
	}
	return { stale, problems, written: check ? [] : stale };
}

module.exports = { buildPages, pageBody, prefixRelativeUrls, renderSitemap, loadSite };
