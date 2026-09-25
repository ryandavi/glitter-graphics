// Sources for content/src pages. See content/AUTHORING.md.
//
//   node tools/cite.js add <url> [--key k] [--title "..."]   add a draft source, print its [@key]
//   node tools/cite.js find <text>                           search existing sources before adding one
//
// `add` reads the page title and asks the Wayback Machine for the nearest
// capture. A Wayback URL is split into the original URL and its capture
// date. Anything it can't reach is left for you to fill in; the source stays
// "status": "draft" until you confirm it.
const registry = require('./content-registry');

const stopWords = new Set(['a', 'an', 'the', 'of', 'to', 'on', 'in', 'and', 'for', 'how', 'is', 'who', 'was', 'what', 'with', 'your', 'my', 'from', 'by', 'at', 'it', 'www', 'com', 'html', 'htm', 'index', 'php']);

function waybackParts(url) {
	const match = url.match(/^https?:\/\/web\.archive\.org\/web\/(\d{4})(\d{2})?(\d{2})?\d*\/(.+)$/u);
	if (!match) return null;
	const [, year, month, day, original] = match;
	return { original: /^https?:/u.test(original) ? original : `http://${original}`, date: [year, month, day].filter(Boolean).join('-') };
}

function decodeEntities(text) {
	return text.replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&#0?39;|&#x27;/gu, "'").replace(/&nbsp;/gu, ' ');
}

async function fetchTitle(url) {
	try {
		const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
		if (!response.ok) return { status: response.status };
		const html = await response.text();
		const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu);
		return { status: response.status, title: title ? decodeEntities(title[1]).replace(/\s+/gu, ' ').trim() : null };
	} catch (error) {
		return { error: error.message };
	}
}

async function nearestCapture(url) {
	try {
		const response = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) });
		const data = await response.json();
		const closest = data?.archived_snapshots?.closest;
		if (!closest?.available) return null;
		const stamp = closest.timestamp;
		return { url: closest.url.replace(/^http:/u, 'https:'), date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` };
	} catch {
		return null;
	}
}

function suggestKey(sources, entities, { url, title, date }) {
	const owner = registry.entityForUrl(entities, url);
	const host = (() => {
		try {
			return new URL(url).hostname.replace(/^www\./u, '').split('.')[0];
		} catch {
			return 'source';
		}
	})();
	const author = owner || registry.normalize(host).replace(/ /gu, '-');
	const words = registry.normalize(title || '').split(' ').filter(word => word && !stopWords.has(word) && !author.split('-').includes(word));
	const parts = [author, date ? date.slice(0, 4) : null].filter(Boolean);
	for (let count = 1; count <= Math.max(1, words.length); count += 1) {
		const key = [...parts, ...words.slice(0, count)].join('-').slice(0, 48).replace(/-+$/u, '');
		if (key && !sources[key]) return key;
	}
	let suffix = 2;
	while (sources[`${parts.join('-')}-${suffix}`]) suffix += 1;
	return `${parts.join('-')}-${suffix}`;
}

async function add(url, options) {
	const sources = registry.loadSources();
	const entities = registry.loadEntities();
	const existing = Object.entries(sources).find(([, source]) => source.url === url || source.archive?.url === url);
	if (existing) {
		process.stdout.write(`Already cited as [@${existing[0]}]\n`);
		return 0;
	}
	const wayback = waybackParts(url);
	const original = wayback ? wayback.original : url;
	const source = { status: 'draft', title: options.title || null, url: original };
	const page = await fetchTitle(url);
	if (!source.title) source.title = page.title || original.replace(/^https?:\/\//u, '');
	if (wayback) {
		source.archive = { url, date: wayback.date };
		const live = await fetchTitle(original);
		source.note = live.status && live.status < 400 ? '' : 'The original no longer loads: check it, then set "status": "dead".';
	} else {
		const capture = await nearestCapture(original);
		if (capture) source.archive = capture;
		if (page.error || (page.status && page.status >= 400)) source.note = `The page did not load (${page.error || page.status}): check it, then set "status": "dead".`;
	}
	if (!source.note) delete source.note;
	const key = options.key || suggestKey(sources, entities, { url: original, title: source.title, date: source.archive?.date });
	if (!registry.SLUG_PATTERN.test(key) || sources[key]) {
		process.stderr.write(`Key "${key}" is taken or not lowercase-with-hyphens; pass --key.\n`);
		return 1;
	}
	const shared = registry.loadSources(registry.sourcesPath, { local: false });
	shared[key] = source;
	const sorted = Object.fromEntries(Object.keys(shared).sort().map(name => [name, shared[name]]));
	registry.writeJson(registry.sourcesPath, sorted);
	process.stdout.write(`Added draft source [@${key}]\n${JSON.stringify(source, null, '\t')}\nCite it with [@${key}]. Fill in "author" and "publisher" if known, then remove "status": "draft".\n`);
	return 0;
}

function find(query) {
	const sources = registry.loadSources();
	const entities = registry.loadEntities();
	const needle = registry.normalize(query);
	const hits = Object.entries(sources).filter(([key, source]) => {
		const author = String(source.author || '').replace(/^@([a-z0-9-]+)$/u, (whole, slug) => entities[slug]?.name || slug);
		const haystack = [key, source.title, source.url, source.archive?.url, author, source.publisher, source.cite].filter(Boolean).join(' ');
		return registry.normalize(haystack).includes(needle) || haystack.includes(query);
	});
	if (!hits.length) {
		process.stdout.write(`No source matches "${query}". Add one with node tools/cite.js add <url>.\n`);
		return 1;
	}
	for (const [key, source] of hits) {
		const title = String(source.title || source.cite || '').replace(/\{@([a-z0-9-]+)\|([^}]*)\}/gu, '$2').replace(/\{@([a-z0-9-]+)\}/gu, (whole, slug) => entities[slug]?.name || slug).replace(/\{[^}]*\}/gu, '').slice(0, 80);
		process.stdout.write(`[@${key}]  ${title}${source.status === 'draft' ? '  (draft)' : ''}\n`);
	}
	return 0;
}

function parseOptions(args) {
	const options = { positional: [] };
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === '--key') options.key = args[++index];
		else if (args[index] === '--title') options.title = args[++index];
		else options.positional.push(args[index]);
	}
	return options;
}

async function main(args = process.argv.slice(2)) {
	const [command, ...rest] = args;
	const options = parseOptions(rest);
	if (command === 'add' && options.positional[0]) return add(options.positional[0], options);
	if (command === 'find' && options.positional.length) return find(options.positional.join(' '));
	process.stdout.write([
		'usage:',
		'  node tools/cite.js add <url> [--key k] [--title "..."]',
		'  node tools/cite.js find <text>',
		''
	].join('\n'));
	return command ? 1 : 0;
}

if (require.main === module) main().then(code => { process.exitCode = code; });

module.exports = { waybackParts, suggestKey, main };
