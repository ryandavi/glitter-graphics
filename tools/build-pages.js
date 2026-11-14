'use strict';

// Public pages (<slug>/index.html), also fetched by the editor's modals, and
// sitemap.xml. tools/build-modals.js passes compiled fragments in memory.
// The page
// list, titles, descriptions and the one canonical origin live in
// tools/site.json.
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

// ---------- page shell ----------

function menuItem(page, prefix, current) {
	return [
		`\t\t\t\t\t<a class="app-menu-item" role="menuitem" href="${prefix}${page.slug}/"${current ? ' aria-current="page"' : ''}>`,
		`\t\t\t\t\t\t<span class="app-menu-item-icon icon-wrapper sm"><svg class="icon"><use href="#icon-${page.icon}"></use></svg></span>`,
		`\t\t\t\t\t\t<span class="app-menu-item-label">${escapeHtml(page.title)}</span>`,
		'\t\t\t\t\t</a>'
	].join('\n');
}

function headerHtml(page, pages, prefix) {
	return [
		'\t<header class="app-header content-page-header">',
		'\t\t<div class="app-header-left">',
		'\t\t\t<a href="https://ryandavi.com" class="app-header-logo" target="_blank" rel="noopener noreferrer" aria-label="Visit ryandavi.com">',
		'\t\t\t\t<span class="logo" aria-hidden="true"></span>',
		'\t\t\t</a>',
		`\t\t\t<a class="app-header-title" href="${prefix}" title="Open the editor">RYBABY LABS</a>`,
		'\t\t</div>',
		'\t\t<div class="app-header-center">',
		`\t\t\t<span class="app-header-page-title">${escapeHtml(page.title)}</span>`,
		'\t\t</div>',
		'\t\t<div class="app-header-right">',
		`\t\t\t<a class="btn-text-with-icon primary content-page-editor-link" href="${prefix}">Open Editor</a>`,
		'\t\t\t<nav class="app-menu" id="appMenu" aria-label="Pages">',
		'\t\t\t\t<button class="btn-icon-simple icon-wrapper app-menu-trigger" id="appMenuBtn" type="button" title="Menu" aria-label="Menu" aria-haspopup="menu" aria-expanded="false" aria-controls="appMenuPanel">',
		'\t\t\t\t\t<svg class="icon"><use href="#icon-ellipsis-vertical"></use></svg>',
		'\t\t\t\t\t<span class="name">Menu</span>',
		'\t\t\t\t</button>',
		'\t\t\t\t<div class="app-menu-panel" id="appMenuPanel" role="menu" aria-labelledby="appMenuBtn" hidden>',
		...pages.map(item => menuItem(item, prefix, item.slug === page.slug)),
		'\t\t\t\t</div>',
		'\t\t\t</nav>',
		'\t\t</div>',
		'\t</header>'
	].join('\n');
}

function footerHtml(page, pages, prefix, site) {
	const links = pages.map(item => `\t\t\t<li><a href="${prefix}${item.slug}/"${item.slug === page.slug ? ' aria-current="page"' : ''}>${escapeHtml(item.title)}</a></li>`);
	return [
		'\t<footer class="content-page-footer">',
		'\t\t<ul class="content-page-footer-links">',
		`\t\t\t<li><a href="${prefix}">Editor</a></li>`,
		...links,
		'\t\t</ul>',
		`\t\t<p class="content-page-copyright">${escapeHtml(site.copyright)}</p>`,
		'\t</footer>'
	].join('\n');
}

function renderPage(page, body, context) {
	const { site, pages, indexHtml } = context;
	const prefix = '../';
	const canonical = `${site.origin}${page.slug}/`;
	const title = `${page.title} | ${site.siteName}`;
	const source = page.source === 'releases' ? 'js/core/releases.js' : `content/src/${page.source}.src.html`;
	const kinds = page.kinds.map(kind => `doc-page-${kind}`).join(' ');
	const content = [
		headerHtml(page, pages, prefix),
		'\t<div class="content-page-scroll">',
		`\t<main class="doc-page-main ${kinds}" id="main">`,
		`\t\t<article class="doc-content">\n${prefixRelativeUrls(body, prefix)}\n\t\t</article>`,
		'\t</main>',
		footerHtml(page, pages, prefix, site),
		'\t</div>'
	].join('\n');
	return [
		'<!DOCTYPE html>',
		`<!-- GENERATED from ${source} by tools/build-pages.js (npm run build:modals). Do not edit. -->`,
		'<html lang="en" data-theme="dark">',
		'',
		'<head>',
		'\t<meta charset="UTF-8">',
		'\t<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
		`\t<title>${escapeHtml(title)}</title>`,
		`\t<meta name="description" content="${escapeHtml(page.description)}">`,
		`\t<link rel="canonical" href="${canonical}">`,
		`\t<meta property="og:site_name" content="${escapeHtml(site.siteName)}">`,
		`\t<meta property="og:title" content="${escapeHtml(page.title)}">`,
		`\t<meta property="og:description" content="${escapeHtml(page.description)}">`,
		`\t<meta property="og:type" content="${page.source === 'releases' ? 'website' : 'article'}">`,
		`\t<meta property="og:url" content="${canonical}">`,
		`\t<meta property="og:image" content="${site.origin}images/etc/preview-image.gif">`,
		'\t<meta name="twitter:card" content="summary_large_image">',
		`\t<link rel="stylesheet" href="${assetUrl('css/style.css', prefix)}">`,
		// Release notes start open so they read without JavaScript; the page
		// script collapses all but the newest.
		'\t<noscript><style>.advanced-disclosure > .advanced-disclosure-content { display: flex; }</style></noscript>',
		`\t<link rel="icon" href="${assetUrl('images/etc/favicon.ico', prefix)}" type="image/x-icon">`,
		'</head>',
		'',
		'<body class="content-page">',
		spriteFor(content, indexHtml),
		content,
		...pageScripts.map(script => `\t<script src="${assetUrl(script, prefix)}"></script>`),
		'',
		analyticsRegion(indexHtml),
		'</body>',
		'',
		'</html>',
		''
	].join('\n');
}

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
	if (ogUrl !== site.origin) problems.push(`index.html og:url "${ogUrl}" does not match tools/site.json origin "${site.origin}"`);

	const pages = site.pages.filter(page => !page.feature || registries.FEATURES[page.feature]?.stage === 'on');
	const context = { site, pages, indexHtml, registries, publishedModals: new Set(pages.map(page => page.modal).filter(Boolean)) };
	const outputs = new Map();
	for (const page of pages) {
		let body = '';
		if (page.source !== 'releases') {
			const fragment = fragments.get(page.source) ?? compileFragment(page.source);
			body = pageBody(page, fragment, context);
		} else {
			body = pageBody(page, '', context);
		}
		outputs.set(path.join(root, page.slug, 'index.html'), renderPage(page, body, context));
	}
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
	// A page whose feature was turned off must not linger.
	for (const page of site.pages.filter(item => !pages.includes(item))) {
		const file = path.join(root, page.slug, 'index.html');
		if (!fs.existsSync(file)) continue;
		stale.push(`${page.slug}/index.html (feature "${page.feature}" is not on)`);
		if (!check) fs.rmSync(file);
	}
	return { stale, problems, written: check ? [] : stale };
}

module.exports = { buildPages, renderPage, pageBody, prefixRelativeUrls, renderSitemap, loadSite };
