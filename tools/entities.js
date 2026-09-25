// Registry helpers for writing content/src pages. See content/AUTHORING.md.
//
//   node tools/entities.js find "neonlove.net"   which slug is this? (names, aliases, domains)
//   node tools/entities.js icons                 sites with no logo yet, most-mentioned first
//   node tools/entities.js tag history           tag the first untagged mention per section (shows a diff)
//   node tools/entities.js tag history --write   ...and write it
const fs = require('fs');
const path = require('path');
const registry = require('./content-registry');
const { tokenize, buildTree, walk } = require('./modal-tokenize');

const sourceDir = path.join(registry.root, 'content', 'src');

function describe(slug, entry, entities) {
	const facts = [entry.kind];
	if (entry.status === 'draft') facts.push('DRAFT');
	if (entry.host) facts.push(`on ${entities[entry.host]?.name || entry.host}`);
	if (entry.owner) facts.push(`by ${entities[entry.owner]?.name || entry.owner}`);
	if (entry.person) facts.push(`used by ${entities[entry.person]?.name || entry.person}`);
	if (entry.aka?.length) facts.push(`also called ${entry.aka.join(', ')}`);
	if (entry.aliases?.length) facts.push(`aka ${entry.aliases.join(', ')}`);
	return `{@${slug}}  ${entry.name}  (${facts.join('; ')})`;
}

function find(query) {
	const entities = registry.loadEntities();
	const hits = registry.findEntities(entities, query);
	if (!hits.length) {
		process.stdout.write(`No entity matches "${query}". Add it to content/entities.json with "kind", "name" and "status": "draft".\n`);
		return 1;
	}
	for (const hit of hits) process.stdout.write(`${describe(hit.slug, hit.entry, entities)}\n`);
	return 0;
}

function sourceFiles() {
	return fs.readdirSync(sourceDir).filter(file => file.endsWith('.src.html')).map(file => path.join(sourceDir, file));
}

function icons() {
	const entities = registry.loadEntities();
	const files = registry.iconFiles();
	const counts = new Map();
	for (const file of sourceFiles()) {
		for (const match of fs.readFileSync(file, 'utf8').matchAll(/\{@([a-z0-9-]+)|\|@([a-z0-9-]+)/gu)) {
			const slug = match[1] || match[2];
			counts.set(slug, (counts.get(slug) || 0) + 1);
		}
	}
	const generic = Object.entries(entities)
		.filter(([slug, entry]) => entry.kind === 'site' && !registry.resolveIcon(entities, slug, files))
		.map(([slug, entry]) => ({ slug, name: entry.name, count: counts.get(slug) || 0 }))
		.filter(item => item.count > 0)
		.sort((left, right) => right.count - left.count || left.slug.localeCompare(right.slug));
	process.stdout.write('Sites with no logo yet (no icon), by mentions in content/src.\n');
	process.stdout.write(`Add images/modal/history/platform-icons/<slug>.svg (mask) or <slug>.color.svg, then rebuild.\n\n`);
	for (const item of generic) process.stdout.write(`${String(item.count).padStart(4)}  ${item.slug}  (${item.name})\n`);
	return 0;
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

// Name or alias -> slugs. Names shared by two entities are ambiguous and
// never tagged automatically. "term" entities (GIF, Dollz) are ordinary words.
function nameIndex(entities) {
	const index = new Map();
	for (const [slug, entry] of Object.entries(entities)) {
		if ((entry.tags || []).includes('term')) continue;
		for (const name of [entry.name, ...(entry.aliases || [])]) {
			if (!name || name.length < 3) continue;
			if (!index.has(name)) index.set(name, new Set());
			index.get(name).add(slug);
		}
	}
	return index;
}

// Replace every token (and the bodies of links and dead links) with spaces, so
// only plain prose is left to match against, at the same offsets.
function maskTokens(text) {
	let masked = text.replace(/\{(link|dead|goto|open):[^}]*\}[\s\S]*?\{\/\1\}/gu, match => ' '.repeat(match.length));
	masked = masked.replace(/\{[^{}]*\}|\[@[^\]]*\]/gu, match => ' '.repeat(match.length));
	return masked;
}

// Tags the first untagged mention of each entity per section (h2-h5), the
// same rule the bare-name lint checks. Skips link text, the TOC, reference
// lists, code, times and attribute values.
function planTags(source, entities) {
	const index = nameIndex(entities);
	const names = [...index.keys()].sort((left, right) => right.length - left.length);
	if (!names.length) return { edits: [], ambiguous: [] };
	const pattern = new RegExp(`(?<![\\w@|-])(?:${names.map(escapeRegex).join('|')})(?![\\w-])`, 'gu');
	const tree = buildTree(tokenize(source));
	const edits = [];
	const ambiguous = new Set();
	let section = 0;
	const tagged = new Set();
	walk(tree, node => {
		if (node.type === 'element' && /^h[2-5]$/u.test(node.tag)) {
			section += 1;
			tagged.clear();
		}
		if (node.type !== 'text') return;
		for (let ancestor = node.parent; ancestor && ancestor.type === 'element'; ancestor = ancestor.parent) {
			const classes = String(ancestor.attrs.class || '').split(/\s+/u);
			if (['code', 'time', 'script', 'style', 'a'].includes(ancestor.tag) || classes.includes('toc')) return;
			if (String(ancestor.attrs.id || '').endsWith('ReferencesList') || classes.includes('general-references-list')) return;
		}
		const raw = node.value;
		for (const match of raw.matchAll(/\{@([a-z0-9-]+)|\|@([a-z0-9-]+)/gu)) tagged.add(match[1] || match[2]);
		const masked = maskTokens(raw);
		for (const match of masked.matchAll(pattern)) {
			const slugs = index.get(match[0]);
			if (slugs.size > 1) {
				ambiguous.add(`${match[0]} (${[...slugs].join(', ')})`);
				continue;
			}
			const slug = [...slugs][0];
			if (tagged.has(slug)) continue;
			tagged.add(slug);
			const replacement = match[0] === entities[slug].name ? `{@${slug}}` : `{@${slug}|${match[0]}}`;
			edits.push({ start: node.open.start + match.index, end: node.open.start + match.index + match[0].length, text: match[0], replacement, section });
		}
	});
	return { edits, ambiguous: [...ambiguous] };
}

function tag(name, write) {
	const file = path.join(sourceDir, `${name}.src.html`);
	if (!fs.existsSync(file)) {
		process.stderr.write(`No source content/src/${name}.src.html\n`);
		return 1;
	}
	const entities = registry.loadEntities();
	const source = fs.readFileSync(file, 'utf8');
	const { edits, ambiguous } = planTags(source, entities);
	let output = source;
	for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
		output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
	}
	for (const edit of edits) {
		const line = source.slice(0, edit.start).split('\n').length;
		const lineStart = source.lastIndexOf('\n', edit.start - 1) + 1;
		const context = source.slice(Math.max(lineStart, edit.start - 30), edit.start).replace(/\s+/gu, ' ');
		process.stdout.write(`content/src/${name}.src.html(${line}): …${context}- ${edit.text} + ${edit.replacement}\n`);
	}
	for (const item of ambiguous) process.stdout.write(`skipped ambiguous name: ${item}\n`);
	process.stdout.write(`${edits.length} mention(s) to tag${write ? ', written' : '; rerun with --write to apply'}.\n`);
	if (write && edits.length) fs.writeFileSync(file, output, 'utf8');
	return 0;
}

function main(args = process.argv.slice(2)) {
	const [command, ...rest] = args;
	if (command === 'find' && rest.length) return find(rest.join(' '));
	if (command === 'icons') return icons();
	if (command === 'tag' && rest[0]) return tag(rest[0], rest.includes('--write'));
	process.stdout.write([
		'usage:',
		'  node tools/entities.js find "<text>"      which slug is this?',
		'  node tools/entities.js icons              sites with no logo yet',
		'  node tools/entities.js tag <page> [--write]  tag untagged names, first mention per section',
		''
	].join('\n'));
	return command ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { planTags, nameIndex, main };
