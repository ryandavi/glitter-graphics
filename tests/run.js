'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
	{ file: 'ui/touch-smoke.js', tags: ['quick', 'touch'] },
	{ file: 'ui/touch-handle-verify.js', tags: ['quick', 'touch'] },
	{ file: 'unit/export-timeline-unit.js', tags: ['unit', 'export'] },
	{ file: 'unit/gif-palette-unit.js', tags: ['unit', 'export'] },
	{ file: 'unit/text-background-geometry-unit.js', tags: ['unit', 'effects'] },
	{ file: 'parity/export-compositor-fast-path.js', tags: ['export'] },
	{ file: 'parity/export-transparency-correctness.js', tags: ['export'] },
	{ file: 'parity/export-formats-verify.js', tags: ['export'] },
	{ file: 'unit/viewport-navigation-unit.js', tags: ['unit', 'quick'] },
	{ file: 'unit/gesture-manager-unit.js', tags: ['unit', 'quick', 'touch'] },
	{ file: 'unit/pixel-effects.js', tags: ['unit', 'effects'] },
	{ file: 'unit/auto-glitter-analysis.js', tags: ['unit', 'effects'] },
	{ file: 'unit/shimmer-preview-worker.js', tags: ['unit', 'effects'] },
	{ file: 'unit/mask-geometry-ssot.js', tags: ['unit', 'export'] },
	{ file: 'unit/preview-export-twins.js', tags: ['unit', 'export'] },
	{ file: 'parity/effect-combinatorial-parity.js', tags: ['export', 'effects'] },
	{ file: 'unit/shortcut-coverage.js', tags: ['unit', 'panels'] },
	{ file: 'unit/hint-rules-verify.js', tags: ['unit', 'panels'] },
	{ file: 'unit/notification-policy.js', tags: ['unit', 'panels'] },
	{ file: 'ui/keyboard-shortcuts-verify.js', tags: ['panels'] },
	{ file: 'parity/export-parity.js', tags: ['export'] },
	{ file: 'parity/shape-border-verify.js', tags: ['export', 'shape'] },
	{ file: 'parity/mask-edge-verify.js', tags: ['export', 'mask'] },
	{ file: 'unit/brush-raster-verify.js', tags: ['unit', 'mask'] },
	{ file: 'unit/abr-import-verify.js', tags: ['unit', 'mask'] },
	{ file: 'parity/mp4-export-verify.js', tags: ['export'] },
	{ file: 'parity/effects-consistency-verify.js', tags: ['export', 'effects'] },
	{ file: 'ui/panel-parity.js', tags: ['panels'] },
	{ file: 'ui/pixel-effects-ui-verify.js', tags: ['panels', 'effects'] },
	{ file: 'ui/ux-polish-verify.js', tags: ['panels'] },
	{ file: 'ui/modal-settings-verify.js', tags: ['panels'] },
	{ file: 'ui/document-start-verify.js', tags: ['document'] },
	{ file: 'ui/auto-glitter-reopen-verify.js', tags: ['document', 'effects'] },
	{ file: 'ui/layer-reorder-transform-verify.js', tags: ['layers'] },
	{ file: 'ui/layer-selection-reveal-verify.js', tags: ['layers'] },
	{ file: 'ui/manifest-library-browser.js', tags: ['assets'] },
	{ file: 'ui/lazy-manifest-browser.js', tags: ['assets'] },
	{ file: 'ui/shape-touch-verify.js', tags: ['touch', 'shape'] },
	{ file: 'ui/shimmer-preview-verify.js', tags: ['effects'] },
	{ file: 'admin/admin-color-classifier.php', tags: ['admin'], command: 'php' },
	{ file: 'admin/admin-export-contract.php', tags: ['admin'], command: 'php' },
	{ file: 'admin/admin-workflow.php', tags: ['admin'], command: 'php' },
	{ file: 'admin/manifest-library.php', tags: ['admin', 'assets'], command: 'php' }
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
