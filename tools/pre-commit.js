'use strict';

// Pre-commit: regenerate everything CI verifies for freshness, then stage it.
// Runs the same steps as the CI freshness checks: both Sass compiles and tools/build.js.
// Installed by `npm run hooks:install` (sets core.hooksPath to .githooks).

const { spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sass = path.join(root, 'node_modules', 'sass', 'sass.js');
const STYLESHEETS = [['css/style.scss', 'css/style.css'], ['admin/css/swatch_admin.scss', 'admin/css/swatch_admin.css']];
// Pure outputs that cannot carry a "GENERATED ... do not edit" header (JSON).
const HEADERLESS_OUTPUTS = new Set(['site/generated.json', '.vscode/content.code-snippets']);

// A dirty pure output is stale in the commit even when an earlier build already rewrote it.
function isPureOutput(file) {
	if (HEADERLESS_OUTPUTS.has(file) || STYLESHEETS.some(([, output]) => output === file)) return true;
	const fd = fs.openSync(path.join(root, file), 'r');
	try {
		const head = Buffer.alloc(300);
		return /generated\b[^\n]*do not edit/iu.test(head.toString('utf8', 0, fs.readSync(fd, head, 0, 300, 0)));
	} finally { fs.closeSync(fd); }
}

function git(...args) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function run(label, file, args) {
	const result = spawnSync(process.execPath, [file, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
	if (result.status !== 0) {
		process.stdout.write(result.stdout || '');
		console.error(`\npre-commit: ${label} failed; commit aborted.`);
		process.exit(1);
	}
}

// Every tracked-modified or untracked (not ignored) path, with a content hash.
function dirtyFiles() {
	const listed = git('ls-files', '--modified', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
	const map = new Map();
	for (const file of listed) {
		const full = path.join(root, file);
		if (fs.existsSync(full) && fs.statSync(full).isFile()) map.set(file, crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex'));
	}
	return map;
}

if (!fs.existsSync(sass)) {
	console.error('pre-commit: node_modules/sass is missing; run `npm ci` first.');
	process.exit(1);
}

const before = dirtyFiles();
for (const [source, output] of STYLESHEETS) run(`Sass ${source}`, sass, [source, output, '--no-source-map']);
run('node tools/build.js', path.join(root, 'tools', 'build.js'), []);
const after = dirtyFiles();

// Stage what this hook changed, plus every dirty pure output (an earlier Live Sass
// compile or manual build leaves those dirty but unchanged by this run).
const stage = [...after].filter(([file, hash]) => before.get(file) !== hash || isPureOutput(file)).map(([file]) => file);
if (stage.length) {
	git('add', '--', ...stage);
	console.log(`pre-commit: staged regenerated files:\n  ${stage.join('\n  ')}`);
}

run('node tools/build.js --check', path.join(root, 'tools', 'build.js'), ['--check']);
