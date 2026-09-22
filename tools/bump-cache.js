const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const assetPattern = /(<(?:script|link)\b[^>]*?\b(?:src|href))="([^"?#]+)(?:\?v=[^"]*)?"/gu;
let updatedCount = 0;

function stamp(match, prefix, assetPath, suffix, sourceDir = root) {
	if (/^(?:[a-z]+:|\/\/)/iu.test(assetPath)) return match;
	const absolutePath = path.resolve(sourceDir, assetPath);
	if (!absolutePath.startsWith(root + path.sep) || !fs.existsSync(absolutePath)) return match;
	const hash = crypto.createHash('md5').update(fs.readFileSync(absolutePath)).digest('hex').slice(0, 8);
	updatedCount += 1;
	return `${prefix}${assetPath}?v=${hash}${suffix}`;
}

const source = fs.readFileSync(indexPath, 'utf8');
const updated = source.replace(assetPattern, (match, attribute, assetPath) => stamp(match, `${attribute}="`, assetPath, '"'));

fs.writeFileSync(indexPath, updated, 'utf8');

function walk(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const target = path.join(directory, entry.name);
		return entry.isDirectory() ? walk(target) : [target];
	});
}

const runtimePattern = /((?:new\s+Worker|loadScriptOnce)\(\s*['"])([^'"?#]+)(?:\?v=[^'"]*)?(['"])/gu;
const importPattern = /(['"])([^'"?#]+\.js)(?:\?v=[^'"]*)?(['"])/gu;
walk(path.join(root, 'js')).filter((file) => file.endsWith('.js')).forEach((file) => {
	const original = fs.readFileSync(file, 'utf8');
	let next = original.replace(runtimePattern, (match, prefix, assetPath, suffix) => {
		const sourceDir = prefix.startsWith('new Worker') || prefix.startsWith('loadScriptOnce') ? root : path.dirname(file);
		return stamp(match, prefix, assetPath, suffix, sourceDir);
	});
	next = next.replace(/importScripts\(([^)]*)\)/gu, (call, args) => {
		const stampedArgs = args.replace(importPattern, (match, quote, assetPath, closingQuote) => (
			stamp(match, quote, assetPath, closingQuote, path.dirname(file))
		));
		return `importScripts(${stampedArgs})`;
	});
	if (next !== original) fs.writeFileSync(file, next, 'utf8');
});

process.stdout.write(`Stamped ${updatedCount} local asset references\n`);
