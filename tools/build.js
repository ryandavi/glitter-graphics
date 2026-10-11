'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check')) throw new Error('Usage: node tools/build.js [--check]');
const check = args.includes('--check');

function run(tool, options = []) {
	const result = spawnSync(process.execPath, [path.join(__dirname, tool), ...options], { stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status || 1);
}

run('build-shell.js', args);
run('build-bundle.js', args);
run('bump-cache.js', args);
if (!check) {
	// Cache refresh can change worker URLs inside boot sources.
	run('build-bundle.js');
	run('build-shell.js');
}
