'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
	{ file: 'touch-smoke.js', tags: ['quick', 'touch'] },
	{ file: 'touch-handle-verify.js', tags: ['quick', 'touch'] },
	{ file: 'export-timeline-unit.js', tags: ['unit', 'export'] },
	{ file: 'pixel-effects.js', tags: ['unit', 'effects'] },
	{ file: 'auto-glitter-analysis.js', tags: ['unit', 'effects'] },
	{ file: 'shimmer-preview-worker.js', tags: ['unit', 'effects'] },
	{ file: 'mask-geometry-ssot.js', tags: ['unit', 'export'] },
	{ file: 'preview-export-twins.js', tags: ['unit', 'export'] },
	{ file: 'effect-combinatorial-parity.js', tags: ['export', 'effects'] },
	{ file: 'shortcut-coverage.js', tags: ['unit', 'panels'] },
	{ file: 'hint-rules-verify.js', tags: ['unit', 'panels'] },
	{ file: 'notification-policy.js', tags: ['unit', 'panels'] },
	{ file: 'keyboard-shortcuts-verify.js', tags: ['panels'] },
	{ file: 'export-parity.js', tags: ['export'] },
	{ file: 'shape-border-verify.js', tags: ['export', 'shape'] },
	{ file: 'mask-edge-verify.js', tags: ['export', 'mask'] },
	{ file: 'mp4-export-verify.js', tags: ['export'] },
	{ file: 'effects-consistency-verify.js', tags: ['export', 'effects'] },
	{ file: 'panel-parity.js', tags: ['panels'] },
	{ file: 'pixel-effects-ui-verify.js', tags: ['panels', 'effects'] },
	{ file: 'ux-polish-verify.js', tags: ['panels'] },
	{ file: 'document-start-verify.js', tags: ['document'] },
	{ file: 'auto-glitter-reopen-verify.js', tags: ['document', 'effects'] },
	{ file: 'layer-reorder-transform-verify.js', tags: ['layers'] },
	{ file: 'layer-selection-reveal-verify.js', tags: ['layers'] },
	{ file: 'manifest-library-browser.js', tags: ['assets'] },
	{ file: 'lazy-manifest-browser.js', tags: ['assets'] },
	{ file: 'shape-touch-verify.js', tags: ['touch', 'shape'] },
	{ file: 'shimmer-preview-verify.js', tags: ['effects'] },
	{ file: 'admin-color-classifier.php', tags: ['admin'], command: 'php' },
	{ file: 'admin-export-contract.php', tags: ['admin'], command: 'php' },
	{ file: 'admin-workflow.php', tags: ['admin'], command: 'php' },
	{ file: 'manifest-library.php', tags: ['admin', 'assets'], command: 'php' }
];

function readTag(argv) {
	const index = argv.indexOf('--tag');
	if (index === -1) return null;
	if (!argv[index + 1]) {
		throw new Error('Expected a tag after --tag');
	}
	return argv[index + 1];
}

function main() {
	const tag = readTag(process.argv.slice(2));
	const selected = tag ? SUITES.filter((suite) => suite.tags.includes(tag)) : SUITES;
	if (!selected.length) {
		throw new Error(`No test suites are tagged "${tag}"`);
	}

	for (const suite of selected) {
		const command = suite.command || process.execPath;
		const testPath = path.join(__dirname, suite.file);
		process.stdout.write(`\n==> ${suite.file} [${suite.tags.join(', ')}]\n`);
		const result = spawnSync(command, [testPath], {
			cwd: path.join(__dirname, '..'),
			env: process.env,
			stdio: 'inherit'
		});
		if (result.error) throw result.error;
		if (result.status !== 0) process.exit(result.status || 1);
	}

	process.stdout.write(`\nPASS ${selected.length} suite${selected.length === 1 ? '' : 's'}\n`);
}

try {
	main();
} catch (error) {
	process.stderr.write(`FAIL ${error.message}\n`);
	process.exit(1);
}
