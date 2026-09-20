const fs = require('fs');
const path = require('path');
const { tokenize, buildTree, walk, textContent, closest } = require('./modal-tokenize');
const { compile } = require('./build-modals');

const root = path.resolve(__dirname, '..');
const entities = JSON.parse(fs.readFileSync(path.join(root, 'content', 'entities.json'), 'utf8'));
const categoryPlatforms = new Set(['independent', 'other', 'tool', 'franchise']);
const allSteps = ['time', 'file', 'refs', 'entities', 'helpers', 'toc'];

function isIso(value) {
	const match = String(value).match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u);
	if (!match) return false;
	if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 12)) return false;
	if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 31)) return false;
	return true;
}

function safeTokenText(value) {
	return value.length > 0 && !/[<{}|\r\n]/u.test(value);
}

function plainInner(node) {
	if (!node.children.every(child => child.type === 'text')) return null;
	return node.children.map(child => child.value).join('');
}

function numberedReferences(tree) {
	const lists = [];
	walk(tree, node => {
		if (node.type === 'element' && node.tag === 'ol' && String(node.attrs.id || '').endsWith('ReferencesList')) lists.push(node);
	});
	return lists;
}

function decodeKeyText(value) {
	const named = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ', trade: '' };
	return value
		.replace(/&#x([0-9a-f]+);/giu, (match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/gu, (match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
		.replace(/&([a-z]+);/giu, (match, name) => Object.prototype.hasOwnProperty.call(named, name.toLowerCase()) ? named[name.toLowerCase()] : ' ');
}

function slugify(value) {
	const slug = decodeKeyText(value)
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/-+/gu, '-')
		.replace(/^-|-$/gu, '')
		.slice(0, 40)
		.replace(/-$/u, '');
	return slug || 'ref';
}

function firstElement(node, tag) {
	let result = null;
	walk(node, child => {
		if (!result && child.type === 'element' && child.tag === tag) result = child;
	});
	return result;
}

function keyBaseForItem(source, item) {
	const anchor = firstElement(item, 'a');
	if (anchor) {
		const leading = source.slice(item.open.end, anchor.open.start).trim();
		if (leading === '"' || leading === '“' || leading === '&quot;') return slugify(textContent(anchor));
	}
	const words = decodeKeyText(textContent(item)).trim().split(/\s+/u).filter(Boolean).slice(0, 5).join(' ');
	return slugify(words);
}

function makeKeys(source, items) {
	const used = new Map();
	return items.map(item => {
		const base = keyBaseForItem(source, item);
		const count = (used.get(base) || 0) + 1;
		used.set(base, count);
		return count === 1 ? base : `${base}-${count}`;
	});
}

function applyReplacements(source, replacements, start = 0, end = source.length) {
	const relevant = replacements.filter(item => item.start >= start && item.end <= end).sort((left, right) => left.start - right.start);
	let output = '';
	let cursor = start;
	for (const replacement of relevant) {
		if (replacement.start < cursor) continue;
		output += source.slice(cursor, replacement.start);
		output += replacement.value;
		cursor = replacement.end;
	}
	output += source.slice(cursor, end);
	return output;
}

function createStats() {
	return {
		converted: { time: 0, file: 0, citations: 0, references: 0, site: 0, user: 0, person: 0, tool: 0, franchise: 0, usenet: 0, tip: 0, link: 0, dead: 0, toc: 0 },
		raw: {
			timeMarkup: 0,
			timeNonIso: 0,
			timeNoncanonical: 0,
			fileMarkup: 0,
			fileNoncanonical: 0,
			referenceMultiline: 0,
			referenceAttributes: 0,
			referenceNoncanonical: 0,
			citationRawTarget: 0,
			citationAdjacentSplit: 0,
			citationNoncanonical: 0,
			entityPlatformDiffers: 0,
			entityCastDiffers: 0,
			entityTextMarkup: 0,
			entityCompound: 0,
			entityOther: 0,
			tocMismatch: 0
		}
	};
}

function decompileHelpers(source, stats) {
	const tree = buildTree(tokenize(source));
	const elements = [];
	walk(tree, node => {
		if (node.type === 'element') elements.push(node);
	});
	const replacements = [];
	for (const node of elements) {
		const body = node.close ? plainInner(node) : null;
		if (body == null || !body || /[<\r\n]/u.test(body)) continue;
		let candidate = null;
		let kind = null;
		if (node.tag === 'span' && String(node.attrs.class || '').split(/\s+/u).includes('dead-link') && node.close.raw === '</span>') {
			const className = node.attrs.class;
			const siteMatch = className.match(/^site-name dead-link (domain-repurposed|host-closed|page-offline|service-closed)$/u);
			const hostMatch = className.match(/^dead-link (domain-repurposed|host-closed|page-offline|service-closed) host-([a-z0-9-]+)$/u);
			const plainMatch = className.match(/^dead-link (domain-repurposed|host-closed|page-offline|service-closed)$/u);
			const state = (siteMatch || hostMatch || plainMatch || [])[1];
			const platform = siteMatch ? node.attrs['data-platform'] : null;
			const host = hostMatch ? hostMatch[2] : null;
			const href = node.attrs['data-href'];
			const tooltip = node.attrs['data-tooltip'];
			const names = node.attrList.map(item => item[0]).join(',');
			const prefix = siteMatch ? 'class,data-platform' : hostMatch ? 'class,data-host' : 'class';
			const expectedNames = `${prefix}${href ? ',data-href' : ''},data-tooltip`;
			if (state && tooltip && names === expectedNames && !/[|{}<\r\n]/u.test(tooltip) && (!href || !/[|{}<>\r\n]/u.test(href))) {
				candidate = `{dead:${state}${platform ? `|platform=${platform}` : ''}${host ? `|host=${host}` : ''}${href ? `|href=${href}` : ''}|tip=${tooltip}}${body}{/dead}`;
				kind = 'dead';
			}
		} else if (node.tag === 'span' && node.open.raw === '<span class="usenet-address">' && node.close.raw === '</span>' && node.attrList.length === 1) {
			if (!/[|{}]/u.test(body)) {
				candidate = `{usenet:${body}}`;
				kind = 'usenet';
			}
		} else if ((node.tag === 'strong' || node.tag === 'span') && node.close.raw === `</${node.tag}>`) {
			const tooltip = node.attrs['data-tooltip'];
			const platform = node.attrs['data-platform'];
			const person = node.attrs['data-person'];
			const names = node.attrList.map(item => item[0]).join(',');
			const plainNames = platform ? 'class,data-platform,data-tooltip' : 'class,data-tooltip';
			const plain = node.attrs.class === 'context' && names === plainNames;
			const personContext = node.tag === 'strong' && node.attrs.class === 'context person' && person && names === 'class,data-person,data-platform,data-tooltip';
			if ((plain || personContext) && tooltip && !/["|{}<\r\n]/u.test(tooltip)) {
				const options = personContext ? `|person=${person}` : `${platform ? `|platform=${platform}` : ''}${node.tag === 'span' ? '|tag=span' : ''}`;
				candidate = `{tip:${tooltip}${options}}${body}{/tip}`;
				kind = 'tip';
			}
		} else if (node.tag === 'a' && node.close.raw === '</a>') {
			const variants = new Map([
				['external', 'external'],
				['external archive-link archive-wayback', 'archive-wayback'],
				['external archive-link archive-index', 'archive-index'],
				['external archive-link archive-mirror', 'archive-mirror'],
				['external archive-link historical-snapshot', 'historical-snapshot']
			]);
			const siteName = String(node.attrs.class || '').endsWith(' site-name');
			const baseClass = siteName ? node.attrs.class.slice(0, -' site-name'.length) : node.attrs.class;
			const variant = variants.get(baseClass);
			const href = node.attrs.href;
			const names = node.attrList.map(item => item[0]).join(',');
			const identityNames = siteName ? `${node.attrs['data-username'] ? ',data-platform,data-username' : ',data-platform'}` : '';
			const hrefFirst = names === `href,class,target,rel${identityNames}`;
			const classFirst = names === `class,href,target,rel${identityNames}`;
			if (variant && href && (hrefFirst || classFirst) && (!siteName || node.attrs['data-platform']) && !/["|{}<>\r\n]/u.test(href)) {
				const options = `${siteName ? `|platform=${node.attrs['data-platform']}${node.attrs['data-username'] ? `|user=${node.attrs['data-username']}` : ''}` : ''}${classFirst ? '|class-first' : ''}`;
				candidate = `{link:${variant}|${href}${options}}${body}{/link}`;
				kind = 'link';
			}
		}
		if (!candidate) continue;
		const compiled = compile(candidate, { header: false });
		const raw = source.slice(node.open.start, node.close.end);
		const baseline = compile(raw, { header: false });
		if (baseline.diagnostics.some(item => item.severity === 'error') || compiled.diagnostics.some(item => item.severity === 'error') || compiled.output !== baseline.output) continue;
		replacements.push({ start: node.open.start, end: node.close.end, value: candidate });
		stats.converted[kind] += 1;
	}
	return applyReplacements(source, replacements);
}

function canonicalEntity(node, source) {
	const classes = String(node.attrs.class || '').split(/\s+/u).filter(Boolean);
	const relevant = classes.includes('site-name') || classes.includes('username') || classes.includes('person');
	if (!relevant) return null;
	if (node.tag !== 'span' || !node.close) return { reason: 'entityCompound' };
	const value = plainInner(node);
	if (value == null) return { reason: 'entityTextMarkup' };
	const raw = source.slice(node.open.start, node.close.end);
	let candidate = null;
	let kind = null;
	if (classes.includes('site-name')) {
		if (node.attrs['data-platform'] === 'tool' && node.attrList.length === 2 && node.open.raw === '<span class="site-name" data-platform="tool">' && safeTokenText(value)) {
			candidate = `{tool:${value}}`;
			kind = 'tool';
		} else if (node.attrs['data-platform'] === 'franchise' && node.attrList.length === 2 && node.open.raw === '<span class="site-name" data-platform="franchise">' && safeTokenText(value)) {
			candidate = `{franchise:${value}}`;
			kind = 'franchise';
		} else {
			const platform = node.attrs['data-platform'];
			const username = node.attrs['data-username'];
			const expectedOpen = username
				? `<span class="site-name" data-platform="${platform}" data-username="${username}">`
				: `<span class="site-name" data-platform="${platform}">`;
			if (!platform || node.open.raw !== expectedOpen || !safeTokenText(value)) return { reason: 'entityCompound' };
			const entry = entities.platforms[platform];
			if (!entry || platform.startsWith('_')) return { reason: 'entityOther' };
			if (username && (!entities.usernames[username] || username.startsWith('_'))) return { reason: 'entityOther' };
			const short = !username && !categoryPlatforms.has(platform) && value === entry.label;
			candidate = short ? `{site:${platform}}` : `{site:${platform}|${value}${username ? `|user=${username}` : ''}}`;
			kind = 'site';
		}
	} else if (classes.includes('username')) {
		const slug = node.attrs['data-username'];
		const entry = entities.usernames[slug];
		if (!entry || slug.startsWith('_')) return { reason: 'entityOther' };
		if (node.attrs['data-platform'] !== entry.platform) return { reason: 'entityPlatformDiffers' };
		const expectedClass = `username${entry.cast ? ' username-cast' : ''}`;
		if (node.attrs.class !== expectedClass) return { reason: 'entityCastDiffers' };
		const expectedOpen = `<span class="${expectedClass}" data-username="${slug}" data-platform="${entry.platform}">`;
		if (node.open.raw !== expectedOpen || !safeTokenText(value)) return { reason: 'entityCompound' };
		candidate = value === entry.display ? `{user:${slug}}` : `{user:${slug}|${value}}`;
		kind = 'user';
	} else {
		const slug = node.attrs['data-person'];
		const entry = entities.persons[slug];
		if (!entry || slug.startsWith('_')) return { reason: 'entityOther' };
		if (node.attrs['data-platform'] !== entry.platform) return { reason: 'entityPlatformDiffers' };
		const expectedOpen = `<span class="person" data-person="${slug}" data-platform="${entry.platform}">`;
		if (node.open.raw !== expectedOpen || !safeTokenText(value)) return { reason: 'entityCompound' };
		candidate = value === entry.display ? `{person:${slug}}` : `{person:${slug}|${value}}`;
		kind = 'person';
	}
	const compiled = compile(candidate, { header: false });
	if (compiled.diagnostics.some(item => item.severity === 'error') || compiled.output !== raw) return { reason: 'entityOther' };
	return { candidate, kind };
}

function firstMismatch(expected, actual) {
	const expectedLines = expected.split('\n');
	const actualLines = actual.split('\n');
	const length = Math.max(expectedLines.length, actualLines.length);
	for (let index = 0; index < length; index += 1) {
		if (expectedLines[index] === actualLines[index]) continue;
		return `@@ line ${index + 1} @@\n-${expectedLines[index] == null ? '<missing>' : expectedLines[index]}\n+${actualLines[index] == null ? '<missing>' : actualLines[index]}`;
	}
	return '';
}

function findTocNode(source, id = null) {
	const tokens = tokenize(source);
	const tree = buildTree(tokens);
	const tocNodes = [];
	walk(tree, node => {
		if (node.type === 'element' && node.tag === 'div' && node.close && String(node.attrs.class || '').split(/\s+/u).includes('toc') && (!id || node.attrs.id === id)) tocNodes.push(node);
	});
	return tocNodes;
}

function decompileToc(source, stats, originalSource = source) {
	const tocNodes = findTocNode(source);
	if (tocNodes.length !== 1 || !tocNodes[0].attrs.id) {
		stats.raw.tocMismatch += tocNodes.length;
		return { source, diff: tocNodes.length ? 'Expected exactly one TOC block with an id.' : '' };
	}
	const node = tocNodes[0];
	const candidate = applyReplacements(source, [{ start: node.open.start, end: node.close.end, value: `{toc:${node.attrs.id}}` }]);
	const baseline = compile(source, { header: false });
	const compiled = compile(candidate, { header: false });
	if (!baseline.diagnostics.some(item => item.severity === 'error') && !compiled.diagnostics.some(item => item.severity === 'error') && compiled.output === baseline.output) {
		stats.converted.toc += 1;
		return { source: candidate, diff: '' };
	}
	stats.raw.tocMismatch += 1;
	const originalNode = findTocNode(originalSource, node.attrs.id)[0];
	const rawBlock = originalNode ? originalSource.slice(originalNode.open.start, originalNode.close.end) : source.slice(node.open.start, node.close.end);
	return {
		source: applyReplacements(source, [{ start: node.open.start, end: node.close.end, value: rawBlock }]),
		diff: firstMismatch(baseline.output, compiled.output)
	};
}

function decompileDetailed(source, options = {}) {
	const steps = new Set(options.steps || allSteps);
	const stats = createStats();
	let tokens;
	let tree;
	try {
		tokens = tokenize(source);
		tree = buildTree(tokens);
	} catch (error) {
		const failure = new Error(`Tokenizer failed at ${error.line || 1}:${error.col || 1}: ${error.message}`);
		failure.line = error.line || 1;
		failure.col = error.col || 1;
		throw failure;
	}
	const elements = [];
	walk(tree, node => {
		if (node.type === 'element') elements.push(node);
	});
	const elementary = [];

	if (steps.has('time')) {
		for (const node of elements.filter(item => item.tag === 'time' && item.close)) {
			const value = plainInner(node);
			const datetime = node.attrs.datetime;
			if (value == null) {
				stats.raw.timeMarkup += 1;
				continue;
			}
			if (!isIso(datetime)) {
				stats.raw.timeNonIso += 1;
				continue;
			}
			if (node.attrList.length !== 1 || node.attrList[0][0] !== 'datetime' || node.open.raw !== `<time datetime="${datetime}">` || node.close.raw !== '</time>' || !safeTokenText(value)) {
				stats.raw.timeNoncanonical += 1;
				continue;
			}
			const compactYear = /^\d{4}$/u.test(datetime) && value === datetime;
			elementary.push({
				start: node.open.start,
				end: node.close.end,
				value: compactYear ? `{y:${datetime}}` : `{date:${datetime}|${value}}`,
				kind: 'time'
			});
			stats.converted.time += 1;
		}
	}

	if (steps.has('file')) {
		const variants = new Map([
			['file-name', 'file'],
			['file-name file-name-directory', 'dir'],
			['file-name file-name-page', 'page']
		]);
		for (const node of elements.filter(item => item.tag === 'span' && String(item.attrs.class || '').split(/\s+/u).includes('file-name') && item.close)) {
			const value = plainInner(node);
			if (value == null) {
				stats.raw.fileMarkup += 1;
				continue;
			}
			const kind = variants.get(node.attrs.class);
			const expectedOpen = kind ? `<span class="${node.attrs.class}">` : null;
			if (!kind || node.attrList.length !== 1 || node.attrList[0][0] !== 'class' || node.open.raw !== expectedOpen || node.close.raw !== '</span>' || !safeTokenText(value)) {
				stats.raw.fileNoncanonical += 1;
				continue;
			}
			elementary.push({ start: node.open.start, end: node.close.end, value: `{${kind}:${value}}`, kind: 'file' });
			stats.converted.file += 1;
		}
	}

	if (steps.has('entities')) {
		for (const node of elements) {
			const result = canonicalEntity(node, source);
			if (!result) continue;
			if (result.candidate) {
				elementary.push({ start: node.open.start, end: node.close.end, value: result.candidate, kind: 'entity' });
				stats.converted[result.kind] += 1;
			} else {
				stats.raw[result.reason] += 1;
			}
		}
	}

	const replacements = [...elementary];
	if (steps.has('refs')) {
		const lists = numberedReferences(tree);
		if (lists.length > 1) throw new Error('Decompiler found more than one numbered references list.');
		const list = lists[0] || null;
		const items = list ? list.children.filter(node => node.type === 'element' && node.tag === 'li' && node.close) : [];
		const keys = makeKeys(source, items);
		const convertible = items.map((item, index) => {
			const raw = source.slice(item.open.start, item.close.end);
			if (item.attrList.length) {
				stats.raw.referenceAttributes += 1;
				return false;
			}
			if (/\r|\n/u.test(raw)) {
				stats.raw.referenceMultiline += 1;
				return false;
			}
			if (item.open.raw !== '<li>' || item.close.raw !== '</li>') {
				stats.raw.referenceNoncanonical += 1;
				return false;
			}
			const body = applyReplacements(source, elementary, item.open.end, item.close.start);
			replacements.push({ start: item.open.start, end: item.close.end, value: `{ref ${keys[index]}}${body}{/ref}`, kind: 'reference' });
			stats.converted.references += 1;
			return true;
		});

		const citationCandidates = [];
		for (const node of elements.filter(item => item.tag === 'sup' && item.close && (!list || !closest(item, ancestor => ancestor === list)))) {
			const value = plainInner(node);
			if (value == null || itemHasAttributes(node) || node.open.raw !== '<sup>' || node.close.raw !== '</sup>') {
				stats.raw.citationNoncanonical += 1;
				continue;
			}
			const matches = [...value.matchAll(/\[(\d+)\]/gu)];
			if (!matches.length || matches.map(match => match[0]).join('') !== value) {
				stats.raw.citationNoncanonical += 1;
				continue;
			}
			const numbers = matches.map(match => Number(match[1]));
			for (const number of numbers) {
				if (number < 1 || number > items.length) throw new Error(`Citation [${number}] has no reference-list entry.`);
			}
			if (!numbers.every(number => convertible[number - 1])) {
				stats.raw.citationRawTarget += numbers.length;
				continue;
			}
			citationCandidates.push({ node, numbers });
		}
		let previousCandidate = null;
		let previousConverted = false;
		for (const candidate of citationCandidates) {
			const { node, numbers } = candidate;
			const adjacent = previousCandidate && previousCandidate.node.close.end === node.open.start;
			if (adjacent && previousConverted) {
				stats.raw.citationAdjacentSplit += numbers.length;
				previousCandidate = candidate;
				previousConverted = false;
				continue;
			}
			replacements.push({ start: node.open.start, end: node.close.end, value: numbers.map(number => `[@${keys[number - 1]}]`).join(''), kind: 'citation' });
			stats.converted.citations += numbers.length;
			previousCandidate = candidate;
			previousConverted = true;
		}
	}

	const outerReferences = replacements.filter(item => item.kind === 'reference');
	const filtered = replacements.filter(item => item.kind === 'reference' || !outerReferences.some(outer => item.start >= outer.start && item.end <= outer.end));
	let output = applyReplacements(source, filtered);
	if (steps.has('helpers')) output = decompileHelpers(output, stats);
	let tocDiff = '';
	if (steps.has('toc')) {
		const result = decompileToc(output, stats, source);
		output = result.source;
		tocDiff = result.diff;
	}
	for (const kind of ['site', 'user', 'person', 'tool', 'franchise']) {
		stats.converted[kind] = [...output.matchAll(new RegExp(`\\{${kind}:`, 'gu'))].length;
	}
	return { source: output, stats, tocDiff };
}

function itemHasAttributes(node) {
	return node.attrList.length > 0;
}

function decompile(source, options = {}) {
	return decompileDetailed(source, options).source;
}

function parseArgs(args) {
	let input = null;
	let out = null;
	let steps = null;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === '--out') out = path.resolve(root, args[++index]);
		else if (args[index] === '--steps') steps = args[++index].split(',').filter(Boolean);
		else if (args[index].startsWith('--')) throw new Error(`Unknown option "${args[index]}".`);
		else if (input) throw new Error('Only one input modal may be decompiled at a time.');
		else input = path.resolve(root, args[index]);
	}
	if (!input) throw new Error('Usage: node tools/decompile-modal.js <input> [--out <path>] [--steps time,file,refs,entities,helpers,toc]');
	if (steps && steps.some(step => !allSteps.includes(step))) throw new Error(`Unknown decompiler step in "${steps.join(',')}".`);
	return { input, out, steps };
}

function main(args = process.argv.slice(2)) {
	const options = parseArgs(args);
	const result = decompile(fs.readFileSync(options.input, 'utf8'), { steps: options.steps || undefined });
	if (options.out) {
		fs.mkdirSync(path.dirname(options.out), { recursive: true });
		fs.writeFileSync(options.out, result, 'utf8');
		process.stdout.write(`Wrote ${path.relative(root, options.out)}.\n`);
	} else {
		process.stdout.write(result);
	}
	return 0;
}

if (require.main === module) {
	try {
		process.exitCode = main();
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	}
}

module.exports = { decompile, decompileDetailed, slugify, makeKeys, parseArgs };
