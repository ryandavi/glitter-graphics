'use strict';

// Assembles the folder a deploy uploads: the tracked files under the paths in
// tools/site.json, with per-environment changes applied to index.html. Only
// tracked files are copied, so local-only pages never reach a server.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const site = require('./site.json');

function option(args, name) {
	return args.includes(name) ? args[args.indexOf(name) + 1] : null;
}

function trackedFiles(entry) {
	return execFileSync('git', ['ls-files', '-z', '--', entry], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
		.split('\0').filter(Boolean);
}

function removeRegion(source, name) {
	const pattern = new RegExp(`^[\\t ]*<!-- site:${name}:start -->[\\s\\S]*?^[\\t ]*<!-- site:${name}:end -->\\n?`, 'mu');
	if (!pattern.test(source)) throw new Error(`Missing site:${name} marker pair in index.html`);
	return source.replace(pattern, '');
}

function applyEnvironment(source, environment) {
	return environment.analytics ? source : removeRegion(source, 'analytics');
}

function main(args = process.argv.slice(2)) {
	const name = option(args, '--env');
	const environment = site.environments[name];
	if (!environment) throw new Error(`--env must be one of: ${Object.keys(site.environments).join(', ')}`);
	const out = path.resolve(root, option(args, '--out') || path.join('.tmp', 'site', name));
	// The output folder is emptied first, so it must be a folder of its own.
	if (!path.relative(root, out) || root.startsWith(out)) throw new Error(`Refusing to build into ${out}`);

	fs.rmSync(out, { recursive: true, force: true });
	let count = 0;
	let bytes = 0;
	for (const entry of site.publish) {
		const files = trackedFiles(entry);
		if (!files.length) throw new Error(`tools/site.json publishes "${entry}", which matches no tracked file`);
		for (const file of files) {
			const target = path.join(out, file);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			if (file === 'index.html') {
				fs.writeFileSync(target, applyEnvironment(fs.readFileSync(path.join(root, file), 'utf8'), environment));
			} else {
				fs.copyFileSync(path.join(root, file), target);
			}
			count += 1;
			bytes += fs.statSync(target).size;
		}
	}
	process.stdout.write(`Built ${name} site: ${count} files, ${(bytes / 1024 / 1024).toFixed(1)} MB in ${path.relative(root, out)}\n`);
	return 0;
}

if (require.main === module) {
	try {
		process.exitCode = main();
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	}
}

module.exports = { applyEnvironment };
