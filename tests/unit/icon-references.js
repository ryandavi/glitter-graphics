'use strict';

// Every icon the app references must exist in the one SVG sprite in
// index.html: `#icon-KEY` in markup, `icon: 'KEY'` in schemas and registries
// (TOOLS, PANEL_SCHEMAS, context toolbars), createIcon('KEY'), iconType, and
// the action registry in content/icon-registry.json. Dynamic references
// (`#icon-${...}`) are skipped; their keys come from the checked sources.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const sprite = new Set(Array.from(read('index.html').matchAll(/<symbol[^>]*\bid="icon-([a-z0-9-]+)"/g), (match) => match[1]));
assert(sprite.size > 0, 'No icon symbols found in index.html');

const files = ['index.html'];
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((entry) => {
	const relative = path.join(dir, entry.name);
	if (entry.isDirectory()) {
		if (entry.name !== 'vendor') walk(relative);
	} else if (/\.(js|html)$/.test(entry.name)) {
		files.push(relative);
	}
});
['js', 'modals', 'content/src'].forEach(walk);

const patterns = [
	/#icon-([a-z0-9-]+)(?![a-z0-9-]|\$)/g,
	/\bicon: ['"]([a-z0-9-]+)['"]/g,
	/createIcon\(['"]([a-z0-9-]+)['"]/g,
	/\biconType: ['"]([a-z0-9-]+)['"]/g,
	/\biconType: [^,\n]*\? ['"]([a-z0-9-]+)['"] : ['"]([a-z0-9-]+)['"]/g
];

const missing = [];
let references = 0;
files.forEach((file) => {
	const text = read(file);
	patterns.forEach((pattern) => {
		for (const match of text.matchAll(pattern)) {
			match.slice(1).filter(Boolean).forEach((key) => {
				references += 1;
				if (!sprite.has(key)) missing.push(`${file.replace(/\\/g, '/')}: ${key}`);
			});
		}
	});
});

const registry = JSON.parse(read('content/icon-registry.json'));
Object.entries(registry.actions).forEach(([action, key]) => {
	references += 1;
	if (!sprite.has(key)) missing.push(`content/icon-registry.json (${action}): ${key}`);
});

assert(references > 100, `Only ${references} icon references found; the scan patterns are probably broken`);
assert.deepStrictEqual(missing, [], `Icons missing from the index.html sprite:\n${missing.join('\n')}`);
console.log(`PASS ${references} icon references resolve to the sprite (${sprite.size} symbols)`);
