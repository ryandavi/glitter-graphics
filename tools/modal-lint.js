const fs = require('fs');
const path = require('path');
const { tokenize, buildTree, walk, textContent, closest } = require('./modal-tokenize');

const root = path.resolve(__dirname, '..');
const defaultFiles = [
	'modals/history.html',
	'modals/personal-web.html',
	'modals/aylana.html',
	'modals/about.html'
];
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

function registryEntries(registry, category) {
	return Object.entries(registry[category] || {}).filter(([key]) => !key.startsWith('_'));
}

function parsePlatformSlugs(source) {
	const slugs = new Set(['independent', 'other', 'tool']);
	const icons = source.match(/\$history-platform-icons\s*:\s*\(([\s\S]*?)\);/u);
	if (icons) {
		for (const match of icons[1].matchAll(/"([^"]+)"\s*:/gu)) slugs.add(match[1]);
	}
	const defaults = source.match(/\$history-website-defaults\s*:([\s\S]*?);/u);
	if (defaults) {
		for (const match of defaults[1].matchAll(/"([^"]+)"/gu)) slugs.add(match[1]);
	}
	return slugs;
}

function createContext(relativeFile, source, registry, platformSlugs) {
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
		registry,
		platformSlugs
	};
}

function ruleSlugUnknown(context) {
	const results = [];
	const allowedPlatforms = new Set([
		...context.platformSlugs,
		...registryEntries(context.registry, 'platforms').map(([key]) => key)
	]);
	const allowedUsernames = new Set(registryEntries(context.registry, 'usernames').map(([key]) => key));
	const allowedPersons = new Set(registryEntries(context.registry, 'persons').map(([key]) => key));
	for (const node of context.elements) {
		const checks = [
			['data-platform', allowedPlatforms, 'platform'],
			['data-username', allowedUsernames, 'username'],
			['data-person', allowedPersons, 'person']
		];
		for (const [attribute, allowed, label] of checks) {
			const value = node.attrs[attribute];
			if (value && value !== true && !allowed.has(value)) {
				results.push(finding(context, node, 'error', 'slug-unknown', `Unknown ${label} "${value}".`));
			}
		}
	}
	return results;
}

function rulePlatformMissing(context) {
	const results = [];
	for (const node of context.elements) {
		const names = classes(node);
		if (['site-name', 'username', 'person'].some(name => names.has(name)) && !node.attrs['data-platform']) {
			results.push(finding(context, node, 'error', 'platform-missing', `${node.tag}.${[...names].join('.')} is missing data-platform.`));
		}
	}
	return results;
}

function ruleRegistryConflict(context) {
	const seen = new Map();
	const results = [];
	for (const node of context.elements) {
		if (!hasClass(node, 'username')) continue;
		const username = node.attrs['data-username'];
		if (!username || username === true) continue;
		if (!seen.has(username)) seen.set(username, { platforms: new Set(), cast: new Set(), node });
		const record = seen.get(username);
		if (node.attrs['data-platform']) record.platforms.add(node.attrs['data-platform']);
		record.cast.add(hasClass(node, 'username-cast'));
	}
	for (const [username, record] of seen) {
		const conflicts = [];
		if (record.platforms.size > 1) conflicts.push(`platforms ${[...record.platforms].join(', ')}`);
		if (record.cast.size > 1) conflicts.push('both cast and non-cast markup');
		if (conflicts.length) results.push(finding(context, record.node, 'error', 'registry-conflict', `Username "${username}" appears with ${conflicts.join(' and ')}.`));
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
	// that wraps just a platform name (<span class="dead-link host-closed"><span class="site-name">Tripod</span></span>)
	// has no URL of its own to record, so it is exempt.
	const hostMarker = node => {
		const kids = (node.children || []).filter(child => child.type === 'element' || String(child.value || '').trim());
		return kids.length === 1 && hasClass(kids[0], 'site-name');
	};
	return context.elements
		.filter(node => hasClass(node, 'dead-link') && !node.attrs['data-href'] && !hostMarker(node))
		.map(node => finding(context, node, 'warning', 'dead-link-href', 'dead-link element is missing data-href.'));
}

function ruleTocSync(context) {
	const results = [];
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

function bareNameCandidates(registry) {
	const names = new Set();
	for (const [, entry] of registryEntries(registry, 'platforms')) if (entry.label) names.add(entry.label);
	for (const category of ['usernames', 'persons']) {
		for (const [, entry] of registryEntries(registry, category)) {
			if (entry.display) names.add(entry.display);
			for (const alias of entry.aliases || []) names.add(alias);
		}
	}
	return [...names].filter(name => name.length >= 3).sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function ruleBareName(context) {
	const results = [];
	const blockedClasses = new Set(['site-name', 'username', 'person', 'file-name']);
	for (const node of context.textNodes) {
		if (isInside(node, ancestor => ancestor.type === 'element' && (
			['time', 'script', 'style'].includes(ancestor.tag) ||
			[...classes(ancestor)].some(name => blockedClasses.has(name)) ||
			(hasClass(ancestor, 'context') && ancestor.attrs['data-platform']) ||
			hasClass(ancestor, 'toc')
		))) continue;
		if (quotedReferenceLink(node, context) || addressLinkText(node)) continue;
		for (const name of bareNameCandidates(context.registry)) {
			const pattern = new RegExp(`(?<![\\w-])${escapeRegex(name)}(?![\\w-])`, 'gu');
			for (const match of node.value.matchAll(pattern)) {
				const start = Math.max(0, match.index - 20);
				const end = Math.min(node.value.length, match.index + name.length + 20);
				const contextText = node.value.slice(start, end).replace(/\s+/gu, ' ').trim().slice(0, 40);
				results.push(finding(context, node, 'warning', 'bare-name', `Bare name "${name}" near "${contextText}".`, match.index));
			}
		}
	}
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
		.map(node => finding(context, node, 'warning', 'usenet-code', 'Use class="usenet-address" instead of <code> for a Usenet address.'));
}

function ruleTokenize() {
	return [];
}

const RULES = {
	tokenize: { severity: 'error', run: ruleTokenize },
	'slug-unknown': { severity: 'error', run: ruleSlugUnknown },
	'platform-missing': { severity: 'error', run: rulePlatformMissing },
	'registry-conflict': { severity: 'error', run: ruleRegistryConflict },
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

function lintSource(file, source, options = {}) {
	const registry = options.registry || JSON.parse(fs.readFileSync(path.join(root, 'content', 'entities.json'), 'utf8'));
	const platformSlugs = options.platformSlugs || parsePlatformSlugs(fs.readFileSync(path.join(root, 'css', '_modals.scss'), 'utf8'));
	let context;
	try {
		context = createContext(file, source, registry, platformSlugs);
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
	const selected = options.rule ? [options.rule] : Object.keys(RULES);
	return selected.flatMap(name => RULES[name].run(context));
}

function lintFiles(files = defaultFiles, options = {}) {
	const registry = options.registry || JSON.parse(fs.readFileSync(options.registryPath || path.join(root, 'content', 'entities.json'), 'utf8'));
	const scss = fs.readFileSync(path.join(root, 'css', '_modals.scss'), 'utf8');
	const platformSlugs = parsePlatformSlugs(scss);
	const results = [];
	for (const file of files) {
		const absoluteFile = path.resolve(root, file);
		if (!fs.existsSync(absoluteFile)) continue;
		const relativeFile = path.relative(root, absoluteFile);
		results.push(...lintSource(relativeFile, fs.readFileSync(absoluteFile, 'utf8'), { ...options, registry, platformSlugs }));
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

module.exports = { RULES, createContext, lintSource, lintFiles, parsePlatformSlugs, summary, main };
