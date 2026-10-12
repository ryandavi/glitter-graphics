'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const context = vm.createContext({ navigator: { hardwareConcurrency: 4 } });
vm.runInContext(fs.readFileSync(path.join(root, 'js/core/releases.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/core/fields.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/core/area.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/core/config.js'), 'utf8') + '\nthis.config = CONFIG;', context);
function sources(folder) {
	return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => {
		const file = `${folder}/${entry.name}`;
		if (entry.isDirectory()) return ['dist', 'vendor', 'fixtures', 'node_modules'].includes(entry.name) ? [] : sources(file);
		if (!/\.js$/.test(file) || file === 'js/core/config.js' || file === 'tests/unit/config-usage-unit.js') return [];
		return [fs.readFileSync(path.join(root, file), 'utf8')];
	});
}
const corpus = ['js', 'tools', 'tests'].flatMap(sources).join('\n');
const unused = [];
function walk(value, prefix = '') {
	for (const [key, child] of Object.entries(value)) {
		const name = prefix ? `${prefix}.${key}` : key;
		// Boot budgets are selected by profile; array indices are data, not property names.
		if (Array.isArray(value) || name.startsWith('app.boot.budgets.')) continue;
		if (!new RegExp(`\\b${key}\\b`).test(corpus)) unused.push(name);
		if (child && typeof child === 'object') walk(child, name);
	}
}
walk(context.config);
assert.deepStrictEqual(unused, [], `Unused CONFIG keys: ${unused.join(', ')}`);
console.log('PASS CONFIG keys have consumers');
