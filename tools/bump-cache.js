const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const source = fs.readFileSync(indexPath, 'utf8');
const assetPattern = /(<(?:script|link)\b[^>]*?\b(?:src|href))="([^"?#]+)(?:\?v=[^"]*)?"/gu;
let updatedCount = 0;

const updated = source.replace(assetPattern, (match, attribute, assetPath) => {
	if (/^(?:[a-z]+:|\/\/)/iu.test(assetPath)) return match;
	const absolutePath = path.resolve(root, assetPath);
	if (!absolutePath.startsWith(root + path.sep) || !fs.existsSync(absolutePath)) return match;
	const hash = crypto.createHash('md5').update(fs.readFileSync(absolutePath)).digest('hex').slice(0, 8);
	updatedCount += 1;
	return `${attribute}="${assetPath}?v=${hash}"`;
});

fs.writeFileSync(indexPath, updated, 'utf8');
process.stdout.write(`Stamped ${updatedCount} local assets in index.html\n`);
