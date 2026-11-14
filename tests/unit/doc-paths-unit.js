'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../..');
const tracked = execFileSync('git', ['ls-files', 'CONTRIBUTING.md', 'docs/*.md', 'tests/README.md', 'admin/README.md', 'content/AUTHORING.md'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
// Docs may name gitignored local-only paths (docs/local/, docs/plans/, ...); those never exist in CI.
const ignored = (candidate) => {
	try { execFileSync('git', ['check-ignore', '-q', '--no-index', candidate], { cwd: root }); return true; } catch { return false; }
};
const missing = [];
for (const file of tracked) {
	const text = fs.readFileSync(path.join(root, file), 'utf8');
	for (const match of text.matchAll(/`([^`\n]+)`/g)) {
		const candidate = match[1];
		if (!/^(?:js|css|admin|tools|tests|content|data|modals|docs|\.github)\/[\w./!*-]+$/.test(candidate)) continue;
		if (ignored(candidate.replace(/\*.*$/, ''))) continue;
		if (candidate.includes('*')) {
			const directory = candidate.slice(0, candidate.indexOf('*')).replace(/[^/]*$/, '');
			if (!fs.existsSync(path.join(root, directory))) missing.push(`${file}: ${candidate}`);
		} else if (!fs.existsSync(path.join(root, candidate))) missing.push(`${file}: ${candidate}`);
	}
}
assert.deepStrictEqual(missing, [], `Missing documented paths: ${missing.join(', ')}`);
console.log('PASS documented repository paths exist');
