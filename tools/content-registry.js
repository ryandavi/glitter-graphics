// Shared loaders for content/entities.json and content/sources.json, used by
// build-modals, modal-lint, entities.js and cite.js. The field rules are in
// content/AUTHORING.md.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const entitiesPath = path.join(root, 'content', 'entities.json');
const sourcesPath = path.join(root, 'content', 'sources.json');
// Sources for pages that aren't public yet (git-excluded, like their pages).
// Read together with sources.json; tools only ever write to sources.json.
const localSourcesPath = path.join(root, 'content', 'sources.local.json');
const iconDir = path.join(root, 'images', 'modal', 'history', 'platform-icons');

const KINDS = {
	site: 'Site',
	software: 'Software',
	org: 'Organization',
	work: 'Work',
	person: 'Person',
	handle: 'Handle'
};
const ENTITY_FIELDS = new Set(['kind', 'status', 'name', 'sortName', 'aliases', 'host', 'owner', 'person', 'domains', 'closed', 'gloss', 'icon', 'aka', 'tags']);
const SOURCE_FIELDS = new Set(['status', 'author', 'title', 'url', 'link', 'dead', 'publisher', 'archive', 'note', 'notes', 'general', 'description', 'type', 'date']);
const DEAD_STATES = new Set(['domain-repurposed', 'host-closed', 'page-offline', 'service-closed']);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadEntities(file = entitiesPath) {
	return Object.fromEntries(Object.entries(readJson(file)).filter(([slug]) => !slug.startsWith('_')));
}

function loadSources(file = sourcesPath, { local = file === sourcesPath } = {}) {
	const read = target => fs.existsSync(target) ? Object.entries(readJson(target)).filter(([key]) => !key.startsWith('_')) : [];
	return Object.fromEntries([...read(file), ...(local ? read(localSourcesPath) : [])]);
}

// Registry problems that make rendering meaningless. Drafts are reported
// separately so writing never blocks on them.
function validateEntities(entities) {
	const problems = [];
	for (const [slug, entry] of Object.entries(entities)) {
		const fail = message => problems.push(`entities.json "${slug}": ${message}`);
		if (!SLUG_PATTERN.test(slug)) fail('slug must be lowercase words joined by hyphens.');
		if (!KINDS[entry.kind]) fail(`unknown kind "${entry.kind}".`);
		if (!entry.name) fail('missing name.');
		for (const field of Object.keys(entry)) if (!ENTITY_FIELDS.has(field)) fail(`unknown field "${field}".`);
		for (const field of ['host', 'owner', 'person']) {
			if (entry[field] && !entities[entry[field]]) fail(`${field} "${entry[field]}" is not an entity.`);
		}
		if (entry.host && entities[entry.host] && entities[entry.host].kind !== 'site') fail(`host "${entry.host}" must be a site.`);
		if (entry.person && entities[entry.person] && entities[entry.person].kind !== 'person') fail(`person "${entry.person}" must be a person.`);
		if (entry.sortName && entry.kind !== 'person') fail('sortName is for persons only.');
		if (entry.closed && !DEAD_STATES.has(entry.closed)) fail(`closed must be one of ${[...DEAD_STATES].join(', ')}.`);
		if (entry.status && entry.status !== 'draft') fail('status can only be "draft".');
		if (entry.aka && (entry.kind !== 'person' || !Array.isArray(entry.aka))) fail('aka is a list, for persons only.');
	}
	return problems;
}

function validateSources(sources) {
	const problems = [];
	for (const [key, source] of Object.entries(sources)) {
		const fail = message => problems.push(`sources.json "${key}": ${message}`);
		if (!SLUG_PATTERN.test(key)) fail('key must be lowercase words joined by hyphens.');
		for (const field of Object.keys(source)) if (!SOURCE_FIELDS.has(field)) fail(`unknown field "${field}".`);
		if (!source.title === !source.description) fail('needs a title, or a description for an untitled item (not both).');
		if (source.type && source.type !== 'book') fail('type can only be "book".');
		if (source.date && !/^\d{4}$/u.test(source.date)) fail('date is a year (books only).');
		if (source.status && !['live', 'dead', 'draft'].includes(source.status)) fail('status must be live, dead or draft.');
		if (source.dead && source.dead.state && !DEAD_STATES.has(source.dead.state)) fail(`dead.state must be one of ${[...DEAD_STATES].join(', ')}.`);
		if (source.general && !Array.isArray(source.general)) fail('general must be a list of document names.');
	}
	return problems;
}

// Icon file names in the icon folder: "<name>.svg" is a currentColor mask,
// "<name>.color.svg" is drawn as is.
function iconFiles(dir = iconDir) {
	const files = new Map();
	if (!fs.existsSync(dir)) return files;
	for (const file of fs.readdirSync(dir)) {
		const match = file.match(/^(.+?)(\.color)?\.svg$/u);
		if (match) files.set(match[1], { file, color: Boolean(match[2]) });
	}
	return files;
}

// Own icon, else an icon file named after the slug, else the host's. No
// generic glyph: an icon means "this place has a logo", never "this is a link".
function resolveIcon(entities, slug, files = iconFiles(), seen = new Set()) {
	const entry = entities[slug];
	if (!entry || seen.has(slug)) return null;
	seen.add(slug);
	if (entry.icon && files.has(entry.icon)) return entry.icon;
	if (files.has(slug)) return slug;
	if (entry.host) {
		const hostIcon = resolveIcon(entities, entry.host, files, seen);
		if (hostIcon) return hostIcon;
	}
	return null;
}

// The entity whose domains best match a URL (longest matching domain wins).
function entityForUrl(entities, url) {
	let best = null;
	for (const [slug, entry] of Object.entries(entities)) {
		for (const domain of entry.domains || []) {
			if (url.includes(domain) && (!best || domain.length > best.domain.length)) best = { slug, domain };
		}
	}
	return best ? best.slug : null;
}

function normalize(text) {
	return String(text).normalize('NFKD').replace(/[̀-ͯ]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
}

// Fuzzy lookup over slugs, names, aliases and domains: exact, then prefix,
// then substring, then small edit distance.
function findEntities(entities, query, limit = 10) {
	const needle = normalize(query);
	if (!needle) return [];
	const scored = [];
	for (const [slug, entry] of Object.entries(entities)) {
		const labels = [slug, entry.name, entry.sortName, ...(entry.aliases || []), ...(entry.aka || []), ...(entry.domains || [])].filter(Boolean);
		let best = Infinity;
		for (const label of labels) {
			const value = normalize(label);
			const compact = value.replace(/ /gu, '');
			let score;
			if (value === needle || compact === needle.replace(/ /gu, '')) score = 0;
			else if (value.startsWith(needle)) score = 1;
			else if (value.includes(needle) || compact.includes(needle.replace(/ /gu, ''))) score = 2;
			else {
				const distance = editDistance(value, needle);
				score = distance <= Math.max(1, Math.floor(needle.length / 5)) ? 3 + distance : Infinity;
			}
			best = Math.min(best, score);
		}
		if (best < Infinity) scored.push({ slug, entry, score: best });
	}
	return scored.sort((left, right) => left.score - right.score || left.slug.localeCompare(right.slug)).slice(0, limit);
}

function editDistance(left, right) {
	if (Math.abs(left.length - right.length) > 3) return Infinity;
	const previous = Array.from({ length: right.length + 1 }, (value, index) => index);
	for (let row = 1; row <= left.length; row += 1) {
		let diagonal = previous[0];
		previous[0] = row;
		for (let column = 1; column <= right.length; column += 1) {
			const saved = previous[column];
			previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
			diagonal = saved;
		}
	}
	return previous[right.length];
}

function writeJson(file, value) {
	fs.writeFileSync(file, `${JSON.stringify(value, null, '\t')}\n`, 'utf8');
}

module.exports = {
	root,
	entitiesPath,
	sourcesPath,
	localSourcesPath,
	iconDir,
	KINDS,
	DEAD_STATES,
	SLUG_PATTERN,
	loadEntities,
	loadSources,
	validateEntities,
	validateSources,
	iconFiles,
	resolveIcon,
	entityForUrl,
	findEntities,
	normalize,
	writeJson
};
