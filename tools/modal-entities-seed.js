const fs = require('fs');
const path = require('path');
const { tokenize, buildTree, walk, textContent } = require('./modal-tokenize');

const root = path.resolve(__dirname, '..');
const registryPath = path.join(root, 'content', 'entities.json');
const defaultFiles = [
	'modals/history.html',
	'modals/personal-web.html',
	'modals/aylana.html',
	'modals/about.html'
];

function classList(node) {
	return new Set(String(node.attrs.class || '').split(/\s+/u).filter(Boolean));
}

function visibleText(node) {
	return textContent(node).replace(/\s+/gu, ' ').trim();
}

function addCount(collection, key, value) {
	if (!key || !value) return;
	if (!collection.has(key)) collection.set(key, new Map());
	const values = collection.get(key);
	if (!values.has(value)) values.set(value, { count: 0, order: values.size });
	values.get(value).count += 1;
}

function mostCommon(values) {
	if (!values || !values.size) return null;
	return [...values.entries()].sort((left, right) =>
		right[1].count - left[1].count || left[1].order - right[1].order || left[0].localeCompare(right[0])
	)[0][0];
}

function sortedObject(entries) {
	return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

function extractRegistry(files = defaultFiles, base = root) {
	const platformLabels = new Map();
	const platformFallbacks = new Map();
	const usernameDisplays = new Map();
	const usernamePlatforms = new Map();
	const usernameCast = new Set();
	const personDisplays = new Map();
	const personPlatforms = new Map();
	const platformSlugs = new Set();

	for (const relativeFile of files) {
		const absoluteFile = path.resolve(base, relativeFile);
		if (!fs.existsSync(absoluteFile)) continue;
		const tree = buildTree(tokenize(fs.readFileSync(absoluteFile, 'utf8')));
		walk(tree, node => {
			if (node.type !== 'element') return;
			const classes = classList(node);
			const platform = node.attrs['data-platform'];
			const username = node.attrs['data-username'];
			const person = node.attrs['data-person'];
			const display = visibleText(node);
			if (platform && platform !== true) {
				platformSlugs.add(platform);
				addCount(platformFallbacks, platform, display);
				if (classes.has('site-name') && !username) addCount(platformLabels, platform, display);
			}
			if (username && username !== true) {
				addCount(usernameDisplays, username, display);
				if (platform && platform !== true) addCount(usernamePlatforms, username, platform);
				if (classes.has('username-cast')) usernameCast.add(username);
			}
			if (person && person !== true) {
				addCount(personDisplays, person, display);
				if (platform && platform !== true) addCount(personPlatforms, person, platform);
			}
		});
	}

	const platforms = [];
	for (const slug of platformSlugs) {
		platforms.push([slug, { label: mostCommon(platformLabels.get(slug)) || mostCommon(platformFallbacks.get(slug)) || slug }]);
	}
	const usernames = [];
	for (const [username, displays] of usernameDisplays) {
		const display = mostCommon(displays);
		const aliases = [...displays.keys()].filter(value => value !== display);
		const entry = {
			display,
			aliases,
			platform: mostCommon(usernamePlatforms.get(username))
		};
		if (usernameCast.has(username)) entry.cast = true;
		usernames.push([username, entry]);
	}
	const persons = [];
	for (const [person, displays] of personDisplays) {
		persons.push([person, {
			display: mostCommon(displays),
			platform: mostCommon(personPlatforms.get(person))
		}]);
	}
	return {
		platforms: sortedObject(platforms),
		usernames: sortedObject(usernames),
		persons: sortedObject(persons)
	};
}

function preservePrivate(generated, existing) {
	if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return generated;
	const result = generated && typeof generated === 'object' && !Array.isArray(generated) ? generated : {};
	for (const [key, value] of Object.entries(existing)) {
		if (key.startsWith('_')) {
			result[key] = value;
		} else if (result[key] && typeof value === 'object' && !Array.isArray(value)) {
			preservePrivate(result[key], value);
		}
	}
	return result;
}

function mergeRegistry(existing, generated) {
	const result = JSON.parse(JSON.stringify(existing));
	for (const category of ['platforms', 'usernames', 'persons']) {
		if (!result[category] || typeof result[category] !== 'object') result[category] = {};
		for (const [key, value] of Object.entries(generated[category])) {
			if (!Object.prototype.hasOwnProperty.call(result[category], key)) result[category][key] = value;
		}
		result[category] = sortedObject(Object.entries(result[category]));
	}
	return result;
}

function missingEntries(registry, generated) {
	const missing = [];
	for (const category of ['platforms', 'usernames', 'persons']) {
		for (const key of Object.keys(generated[category])) {
			if (!registry[category] || !Object.prototype.hasOwnProperty.call(registry[category], key)) missing.push(`${category}.${key}`);
		}
	}
	return missing;
}

function serializeRegistry(registry) {
	return `${JSON.stringify(registry, null, '\t')}\n`;
}

function run(args = process.argv.slice(2), options = {}) {
	const outputPath = options.registryPath || registryPath;
	const files = options.files || defaultFiles;
	const base = options.root || root;
	const flags = args.filter(argument => argument.startsWith('--'));
	if (flags.length > 1 || flags.some(flag => !['--merge', '--force', '--check'].includes(flag))) {
		throw new Error('Usage: node tools/modal-entities-seed.js [--merge|--force|--check]');
	}
	const mode = flags[0] || 'create';
	const generated = extractRegistry(files, base);
	const exists = fs.existsSync(outputPath);
	const existing = exists ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) : null;

	if (mode === '--check') {
		if (!existing) {
			process.stderr.write(`Missing registry: ${path.relative(base, outputPath)}\n`);
			return 1;
		}
		const missing = missingEntries(existing, generated);
		for (const entry of missing) process.stderr.write(`Missing registry entry: ${entry}\n`);
		if (!missing.length) process.stdout.write('Entity registry contains every document entry.\n');
		return missing.length ? 1 : 0;
	}

	if (mode === 'create' && exists) {
		process.stdout.write('Entity registry already exists; left unchanged.\n');
		return 0;
	}
	let result = generated;
	if (mode === '--merge' && existing) result = mergeRegistry(existing, generated);
	if (existing) result = preservePrivate(result, existing);
	if (mode === '--force') process.stderr.write('Warning: regenerating extracted entity registry fields from source documents.\n');
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, serializeRegistry(result), 'utf8');
	process.stdout.write(`Wrote ${path.relative(base, outputPath)}.\n`);
	return 0;
}

if (require.main === module) {
	try {
		process.exitCode = run();
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	}
}

module.exports = {
	defaultFiles,
	extractRegistry,
	mergeRegistry,
	missingEntries,
	preservePrivate,
	run,
	serializeRegistry
};
