const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const assetPattern = /(<(?:script|link)\b[^>]*?\b(?:src|href))="([^"?#]+)(?:\?v=[^"]*)?"/gu;
let updatedCount = 0;
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node tools/bump-cache.js [--check]');
let stale = false;

function writeChanged(file, original, next) {
	if (next === original) return;
	stale = true;
	if (!check) fs.writeFileSync(file, next, 'utf8');
}

function stamp(match, prefix, assetPath, suffix, sourceDir = root) {
	if (/^(?:[a-z]+:|\/\/)/iu.test(assetPath)) return match;
	const absolutePath = path.resolve(sourceDir, assetPath);
	if (!absolutePath.startsWith(root + path.sep) || !fs.existsSync(absolutePath)) return match;
	const hash = crypto.createHash('md5').update(fs.readFileSync(absolutePath)).digest('hex').slice(0, 8);
	updatedCount += 1;
	return `${prefix}${assetPath}?v=${hash}${suffix}`;
}

const source = fs.readFileSync(indexPath, 'utf8');
const updated = source.replace(assetPattern, (match, attribute, assetPath) => {
	// Fetch preloads share CONFIG's manifest version with the runtime request.
	if (/\bas="fetch"/u.test(attribute)) return match;
	return stamp(match, `${attribute}="`, assetPath, '"');
});

writeChanged(indexPath, source, updated);

function walk(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const target = path.join(directory, entry.name);
		return entry.isDirectory() ? (entry.name === 'dist' ? [] : walk(target)) : [target];
	});
}

const runtimePattern = /((?:(?:new\s+Worker|loadScriptOnce)\(\s*|\b(?:workerScript|runtimeModule):\s*)['"])([^'"?#]+)(?:\?v=[^'"]*)?(['"])/gu;
const importPattern = /(['"])([^'"?#]+\.js)(?:\?v=[^'"]*)?(['"])/gu;
walk(path.join(root, 'js')).filter((file) => file.endsWith('.js')).forEach((file) => {
	const original = fs.readFileSync(file, 'utf8');
	let next = original.replace(runtimePattern, (match, prefix, assetPath, suffix) => {
		return stamp(match, prefix, assetPath, suffix);
	});
	next = next.replace(/importScripts\(([^)]*)\)/gu, (call, args) => {
		const stampedArgs = args.replace(importPattern, (match, quote, assetPath, closingQuote) => (
			stamp(match, quote, assetPath, closingQuote, path.dirname(file))
		));
		return `importScripts(${stampedArgs})`;
	});
	writeChanged(file, original, next);
});

process.exitCode = require('./build-shell').main(check ? ['--check'] : []);
if (check && stale) {
	process.stderr.write('Asset hashes are out of date; run node tools/build.js\n');
	process.exitCode = 1;
}

process.stdout.write(`Stamped ${updatedCount} local asset references\n`);
