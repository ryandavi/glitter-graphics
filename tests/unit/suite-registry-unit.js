'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SUITES } = require('../run');
// _diag2 prints export byte diagnostics; it has no assertions or suite result.
const helpers = new Set(['parity/export-harness.js', 'parity/preview-export-parity.js', 'parity/_diag2.js']);
const registered = new Set(SUITES.map(suite => suite.file));
assert.strictEqual(registered.size, SUITES.length, 'Suite registrations must be unique');
for (const folder of ['unit', 'parity', 'ui', 'admin']) {
	for (const name of fs.readdirSync(path.join(__dirname, '..', folder))) {
		if (!/\.(js|php)$/.test(name)) continue;
		const file = `${folder}/${name}`;
		if (spawnSync('git', ['check-ignore', '--quiet', `tests/${file}`], { cwd: path.resolve(__dirname, '../..') }).status === 0) continue;
		assert(registered.has(file) || helpers.has(file), `Unregistered suite: ${file}`);
	}
}
for (const file of registered) assert(fs.existsSync(path.join(__dirname, '..', file)), `Missing suite: ${file}`);
console.log('PASS every suite is registered exactly once');
