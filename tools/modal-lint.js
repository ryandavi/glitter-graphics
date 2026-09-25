const fs = require('fs');
const path = require('path');
const { tokenize, buildTree, walk, textContent, closest } = require('./modal-tokenize');
const { loadEntities } = require('./content-registry');

const root = path.resolve(__dirname, '..');
const defaultFiles = [
	'modals/history.html',
	'modals/personal-web.html',
	'modals/aylana.html',
	'modals/preservation.html',
	'modals/about.html',
	'modals/welcome.html',
	'modals/guide.html'
];
// Prose-style rules apply to the long-form articles only; the guide and the
// welcome screen get the token and structure rules.
const articleFiles = new Set(['history', 'personal-web', 'aylana', 'preservation', 'about']);
const PROSE_RULES = new Set(['em-dash', 'bare-name', 'bare-date']);
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function classes(node) {
	return new Set(String(node.attrs.class || '').split(/\s+/u).filter(Boolean));
}

function hasClass(node, name) {
	return node && node.type === 'element' && classes(node).has(name);
}

function isInside(node, predicate) {
	return Boolean(closest(node, predicate));
}

function elementToken(node) {
	return node.open;
}

function positionAt(token, localOffset = 0) {
	let line = token.line;
	let col = token.col;
	for (const character of token.raw.slice(0, localOffset)) {
		if (character === '\n') {
			line += 1;
			col = 1;
		} else {
			col += 1;
		}
	}
	return { line, col };
}

function finding(context, nodeOrToken, severity, rule, message, localOffset = 0) {
	const token = nodeOrToken.open || nodeOrToken;
	const position = positionAt(token, localOffset);
	return {
		file: context.file,
		line: position.line,
		col: position.col,
		severity,
		rule,
		message
	};
}

function createContext(relativeFile, source, registry) {
	const tokens = tokenize(source);
	const tree = buildTree(tokens);
	const elements = [];
	const textNodes = [];
	walk(tree, node => {
		if (node.type === 'element') elements.push(node);
		if (node.type === 'text') textNodes.push(node);
	});
	const references = elements.find(node => node.tag === 'ol' && String(node.attrs.id || '').endsWith('ReferencesList')) || null;
	return {
		file: relativeFile.replace(/\\/gu, '/'),
		source,
		tokens,
		tree,
		elements,
		textNodes,
		references,
		registry
	};
}

function ruleSlugUnknown(context) {
	const results = [];
	for (const node of context.elements) {
		for (const attribute of ['data-entity', 'data-host']) {
			const value = node.attrs[attribute];
			if (value && value !== true && !context.registry[value]) {
				results.push(finding(context, node, 'error', 'slug-unknown', `Unknown entity "${value}" in ${attribute}.`));
			}
		}
	}
	return results;
}

function ruleTimePrecision(context) {
	const results = [];
	for (const node of context.elements.filter(item => item.tag === 'time')) {
		const datetime = node.attrs.datetime;
		if (!datetime || datetime === true) continue;
		const match = String(datetime).match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u);
		const visible = textContent(node).trim();
		if (!match || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 12)) || (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 31))) {
			results.push(finding(context, node, 'error', 'time-precision', `Non-ISO datetime "${datetime}".`));
			continue;
		}
		if (match[3]) {
			const day = String(Number(match[3]));
			if (!new RegExp(`(?<!\\d)0?${day}(?!\\d)`, 'u').test(visible)) {
				results.push(finding(context, node, 'error', 'time-precision', `Day-precision datetime "${datetime}" has no visible day number.`));
			}
		} else if (match[2]) {
			if (!monthNames.some(month => new RegExp(`\\b(?:${month}|${month.slice(0, 3)}\\.?)\\b`, 'iu').test(visible))) {
				results.push(finding(context, node, 'error', 'time-precision', `Month-precision datetime "${datetime}" has no visible month name.`));
			}
		}
	}
	return results;
}

function citations(context) {
	const values = [];
	for (const node of context.elements.filter(item => item.tag === 'sup')) {
		const value = textContent(node);
		for (const match of value.matchAll(/\[(\d+)\]/gu)) values.push({ number: Number(match[1]), node, offset: match.index });
	}
	return values;
}

function referenceItems(context) {
	return context.references ? context.references.children.filter(node => node.type === 'element' && node.tag === 'li') : [];
}

function ruleCiteMissing(context) {
	const count = referenceItems(context).length;
	return citations(context)
		.filter(citation => citation.number < 1 || citation.number > count)
		.map(citation => finding(context, citation.node, 'error', 'cite-missing', `Citation [${citation.number}] has no numbered reference.`));
}

function ruleRefsShape(context) {
	if (!context.references) return [];
	const results = [];
	for (const child of context.references.children) {
		if (child.type === 'text' && !child.value.trim()) continue;
		if (child.type === 'comment') continue;
		if (child.type !== 'element' || child.tag !== 'li') {
			results.push(finding(context, child.open, 'error', 'refs-shape', 'References list contains a direct child other than <li>.'));
		}
	}
	return results;
}

function quotedReferenceLink(node, context) {
	// A link (or dead-link stand-in for one) whose text sits inside quotation marks is a cited title.
	const anchor = closest(node, ancestor => ancestor.type === 'element' && (ancestor.tag === 'a' || hasClass(ancestor, 'dead-link')));
	if (!anchor || !anchor.close) return false;
	const before = context.source.slice(0, anchor.open.start).match(/[^\s]$/u);
	const after = context.source.slice(anchor.close.end).match(/^\s*([^\s])/u);
	return Boolean(before && after && ['"', '“'].includes(before[0]) && ['"', '”'].includes(after[1]));
}

// Link text that is only a file or web address (style guide: an image-file link keeps a name in its text
// plain, and a displayed URL is not prose).
function addressLinkText(node) {
	const anchor = closest(node, ancestor => ancestor.type === 'element' && ancestor.tag === 'a');
	if (!anchor) return false;
	if (/\.(?:gif|jpe?g|png|webp|svg)(?:[?#].*)?$/iu.test(String(anchor.attrs.href || ''))) return true;
	return /^[\w.-]+\.[a-z]{2,}(?:\/|$)/iu.test(textContent(anchor).trim());
}

function ruleEmDash(context) {
	const results = [];
	const pattern = /—|&mdash;|&#8212;|&#x2014;/giu;
	for (const node of context.textNodes) {
		if (quotedReferenceLink(node, context)) continue;
		// A runtime placeholder such as <strong data-app-version>—</strong> is replaced by script, not prose.
		if (isInside(node, ancestor => ancestor.type === 'element' && ancestor.attrs && 'data-app-version' in ancestor.attrs)) continue;
		for (const match of node.value.matchAll(pattern)) {
			results.push(finding(context, node, 'error', 'em-dash', 'Use punctuation other than an em dash here.', match.index));
		}
	}
	return results;
}

function ruleLinkAttrs(context) {
	const results = [];
	for (const node of context.elements.filter(item => item.tag === 'a')) {
		const names = classes(node);
		if (names.has('doc-inline-link')) continue;
		const href = String(node.attrs.href || '');
		if (node.attrs.target === '_blank') {
			const rel = new Set(String(node.attrs.rel || '').split(/\s+/u));
			if (!rel.has('noopener') || !rel.has('noreferrer')) {
				results.push(finding(context, node, 'error', 'link-attrs', 'target="_blank" requires rel="noopener noreferrer".'));
			}
		}
		if (/^https?:\/\//iu.test(href) && !names.has('external')) {
			results.push(finding(context, node, 'error', 'link-attrs', 'Absolute HTTP(S) link is missing class="external".'));
		}
	}
	return results;
}

function ruleDeadLinkHref(context) {
	// data-href only records the old URL for readers of the source (no runtime consumer). A host marker
	// that wraps just a site entity (<span class="dead-link host-closed"><span class="entity" data-entity="tripod">Tripod</span></span>)
	// has no URL of its own to record, so it is exempt.
	const hostMarker = node => {
		const kids = (node.children || []).filter(child => child.type === 'element' || String(child.value || '').trim());
		return kids.length === 1 && hasClass(kids[0], 'entity');
	};
	return context.elements
		.filter(node => hasClass(node, 'dead-link') && !node.attrs['data-href'] && !hostMarker(node))
		.map(node => finding(context, node, 'warning', 'dead-link-href', 'dead-link element is missing data-href.'));
}

function ruleTocSync(context) {
	const results = [];
	if (!context.elements.some(node => hasClass(node, 'toc'))) return results;
	const ids = new Map();
	for (const node of context.elements) {
		if (node.attrs.id && node.attrs.id !== true && !ids.has(node.attrs.id)) ids.set(node.attrs.id, node);
	}
	const tocLinks = context.elements.filter(node => node.tag === 'a' && /^#/u.test(String(node.attrs.href || '')) && isInside(node, ancestor => hasClass(ancestor, 'toc')));
	const linkedIds = new Set();
	for (const link of tocLinks) {
		const id = String(link.attrs.href).slice(1);
		linkedIds.add(id);
		if (!ids.has(id)) results.push(finding(context, link, 'error', 'toc-sync', `TOC target "#${id}" does not exist.`));
	}
	for (const node of context.elements.filter(item => /^h[2-5]$/u.test(item.tag) && item.attrs.id && item.attrs.id !== true)) {
		if (!linkedIds.has(node.attrs.id)) results.push(finding(context, node, 'error', 'toc-sync', `Heading "#${node.attrs.id}" is missing from the TOC.`));
	}
	return results;
}

function ruleIdDup(context) {
	const seen = new Map();
	const results = [];
	for (const node of context.elements) {
		const id = node.attrs.id;
		if (!id || id === true) continue;
		if (seen.has(id)) results.push(finding(context, node, 'error', 'id-dup', `Duplicate id "${id}".`));
		else seen.set(id, node);
	}
	return results;
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

// One alternation of every registry name and alias, longest first, so a
// long name wins over a short name inside it, plus the slugs each name means.
const bareNamePatterns = new WeakMap();
function bareNamePattern(registry) {
	if (bareNamePatterns.has(registry)) return bareNamePatterns.get(registry);
	const slugsByName = new Map();
	for (const [slug, entry] of Object.entries(registry)) {
		// A "term" entity (GIF, Dollz) is also an everyday word; untagged mentions are fine.
		if ((entry.tags || []).includes('term')) continue;
		for (const name of [entry.name, ...(entry.aliases || [])]) {
			if (!name || name.length < 3) continue;
			if (!slugsByName.has(name)) slugsByName.set(name, []);
			slugsByName.get(name).push(slug);
		}
	}
	const sorted = [...slugsByName.keys()].sort((left, right) => right.length - left.length || left.localeCompare(right));
	const pattern = sorted.length ? new RegExp(`(?<![\\w-])(?:${sorted.map(escapeRegex).join('|')})(?![\\w-])`, 'gu') : null;
	const result = { pattern, slugsByName };
	bareNamePatterns.set(registry, result);
	return result;
}

// The first untagged mention of an entity in a section (h2-h5) that has no
// tagged mention before it: the same rule `node tools/entities.js tag`
// fixes. Link and dead-link text, the TOC, references and code are exempt.
function ruleBareName(context) {
	const results = [];
	const { pattern, slugsByName } = bareNamePattern(context.registry);
	if (!pattern) return results;
	const blockedClasses = new Set(['entity', 'file-name', 'draft-marker', 'dead-link', 'toc', 'general-references-list']);
	const seen = new Set();
	walk(context.tree, node => {
		if (node.type === 'element') {
			if (/^h[2-5]$/u.test(node.tag)) seen.clear();
			if (node.attrs['data-entity'] && node.attrs['data-entity'] !== true) seen.add(node.attrs['data-entity']);
			return;
		}
		if (node.type !== 'text') return;
		if (isInside(node, ancestor => ancestor.type === 'element' && (
			['time', 'script', 'style', 'code', 'a'].includes(ancestor.tag) ||
			[...classes(ancestor)].some(name => blockedClasses.has(name)) ||
			String(ancestor.attrs.id || '').endsWith('ReferencesList')
		))) return;
		if (quotedReferenceLink(node, context) || addressLinkText(node)) return;
		for (const match of node.value.matchAll(pattern)) {
			const name = match[0];
			const slugs = slugsByName.get(name) || [];
			if (slugs.some(slug => seen.has(slug))) continue;
			slugs.forEach(slug => seen.add(slug));
			const start = Math.max(0, match.index - 20);
			const end = Math.min(node.value.length, match.index + name.length + 20);
			const contextText = node.value.slice(start, end).replace(/\s+/gu, ' ').trim().slice(0, 40);
			results.push(finding(context, node, 'warning', 'bare-name', `Bare name "${name}" near "${contextText}". Tag it with {@${slugs[0]}} (node tools/entities.js tag fixes these).`, match.index));
		}
	});
	return results;
}

function ruleBareDate(context) {
	const results = [];
	const monthPattern = monthNames.join('|');
	const pattern = new RegExp(`\\b(?:[0-3]?\\d\\s+(?:${monthPattern})\\s+)?(?:199\\d|200\\d|201\\d|202\\d)\\b`, 'giu');
	for (const node of context.textNodes) {
		if (isInside(node, ancestor => ancestor.type === 'element' && (ancestor.tag === 'time' || hasClass(ancestor, 'file-name')))) continue;
		for (const match of node.value.matchAll(pattern)) {
			const surrounding = node.value.slice(Math.max(0, match.index - 20), Math.min(node.value.length, match.index + match[0].length + 20));
			if (/\d+×\d+/u.test(surrounding)) continue;
			if (/\b[^\s<>]+\.[A-Za-z0-9]{2,5}\b/u.test(surrounding)) continue;
			results.push(finding(context, node, 'warning', 'bare-date', `Date "${match[0]}" is outside <time>.`, match.index));
		}
	}
	return results;
}

function ruleCiteUnused(context) {
	const used = new Set(citations(context).map(citation => citation.number));
	return referenceItems(context).flatMap((node, index) => used.has(index + 1) ? [] : [
		finding(context, node, 'warning', 'cite-unused', `Reference [${index + 1}] is never cited.`)
	]);
}

function ruleCiteOrder(context) {
	const first = [];
	const seen = new Set();
	for (const citation of citations(context)) {
		if (!seen.has(citation.number)) {
			seen.add(citation.number);
			first.push(citation);
		}
	}
	const results = [];
	for (let index = 0; index < first.length; index += 1) {
		if (first[index].number !== index + 1) {
			results.push(finding(context, first[index].node, 'warning', 'cite-order', `First citation is [${first[index].number}]; expected [${index + 1}].`));
		}
	}
	return results;
}

function ruleTooltipDup(context) {
	// One gloss per term per document. Two different terms may share a gloss (Angelfire and Tripod), so only
	// a repeated term is reported.
	const results = [];
	const terms = new Map();
	for (const node of context.elements) {
		if (!hasClass(node, 'context') || !node.attrs['data-tooltip']) continue;
		const term = textContent(node).replace(/\s+/gu, ' ').trim().toLowerCase();
		if (!term) continue;
		if (terms.has(term)) results.push(finding(context, node, 'warning', 'tooltip-dup', `Context term "${textContent(node).trim()}" is repeated.`));
		else terms.set(term, node);
	}
	return results;
}

function ruleUsenetCode(context) {
	return context.elements
		.filter(node => node.tag === 'code' && /news:/iu.test(textContent(node)))
		.map(node => finding(context, node, 'warning', 'usenet-code', 'Write a newsgroup as {usenet:alt.example}, not <code>news:…</code>.'));
}

function ruleTokenize() {
	return [];
}

const RULES = {
	tokenize: { severity: 'error', run: ruleTokenize },
	'slug-unknown': { severity: 'error', run: ruleSlugUnknown },
	'time-precision': { severity: 'error', run: ruleTimePrecision },
	'cite-missing': { severity: 'error', run: ruleCiteMissing },
	'refs-shape': { severity: 'error', run: ruleRefsShape },
	'em-dash': { severity: 'error', run: ruleEmDash },
	'link-attrs': { severity: 'error', run: ruleLinkAttrs },
	'dead-link-href': { severity: 'warning', run: ruleDeadLinkHref },
	'toc-sync': { severity: 'error', run: ruleTocSync },
	'id-dup': { severity: 'error', run: ruleIdDup },
	'bare-name': { severity: 'warning', run: ruleBareName },
	'bare-date': { severity: 'warning', run: ruleBareDate },
	'cite-unused': { severity: 'warning', run: ruleCiteUnused },
	'cite-order': { severity: 'warning', run: ruleCiteOrder },
	'tooltip-dup': { severity: 'warning', run: ruleTooltipDup },
	'usenet-code': { severity: 'warning', run: ruleUsenetCode }
};

function isArticle(file) {
	return articleFiles.has(path.basename(file).replace(/(?:\.src)?\.html$/u, ''));
}

function lintSource(file, source, options = {}) {
	const registry = options.registry || loadEntities();
	const prose = options.prose ?? isArticle(file);
	let context;
	try {
		context = createContext(file, source, registry);
	} catch (error) {
		return [{
			file: file.replace(/\\/gu, '/'),
			line: error.line || 1,
			col: error.col || 1,
			severity: 'error',
			rule: 'tokenize',
			message: error.message.replace(/ at \d+:\d+$/u, '')
		}];
	}
	const selected = options.rule ? [options.rule] : Object.keys(RULES).filter(name => prose || !PROSE_RULES.has(name));
	return selected.flatMap(name => RULES[name].run(context));
}

function lintFiles(files = defaultFiles, options = {}) {
	const registry = options.registry || (options.registryPath ? loadEntities(options.registryPath) : loadEntities());
	const results = [];
	for (const file of files) {
		const absoluteFile = path.resolve(root, file);
		if (!fs.existsSync(absoluteFile)) continue;
		const relativeFile = path.relative(root, absoluteFile);
		results.push(...lintSource(relativeFile, fs.readFileSync(absoluteFile, 'utf8'), { ...options, registry }));
	}
	return results.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.col - right.col || left.rule.localeCompare(right.rule));
}

function summary(findings) {
	const severities = { error: 0, warning: 0 };
	const rules = new Map();
	for (const item of findings) {
		severities[item.severity] += 1;
		rules.set(item.rule, (rules.get(item.rule) || 0) + 1);
	}
	const ruleText = [...rules.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([rule, count]) => `${rule}=${count}`).join(', ') || 'none';
	return `Summary: ${severities.error} errors, ${severities.warning} warnings; rules: ${ruleText}`;
}

function parseArgs(args) {
	const files = [];
	let json = false;
	let rule = null;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === '--json') json = true;
		else if (args[index] === '--rule') {
			rule = args[index + 1];
			index += 1;
		} else files.push(args[index]);
	}
	if (rule && !RULES[rule]) throw new Error(`Unknown rule "${rule}".`);
	return { files: files.length ? files : defaultFiles, json, rule };
}

function main(args = process.argv.slice(2)) {
	const options = parseArgs(args);
	const findings = lintFiles(options.files, { rule: options.rule });
	if (options.json) {
		process.stdout.write(`${JSON.stringify(findings, null, '\t')}\n`);
	} else {
		for (const item of findings) process.stdout.write(`${item.file}(${item.line},${item.col}): ${item.severity} ${item.rule}: ${item.message}\n`);
		process.stdout.write(`${summary(findings)}\n`);
	}
	return findings.some(item => item.severity === 'error') ? 1 : 0;
}

if (require.main === module) {
	try {
		process.exitCode = main();
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	}
}

module.exports = { RULES, PROSE_RULES, createContext, lintSource, lintFiles, summary, main };
