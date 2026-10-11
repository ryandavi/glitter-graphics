'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function createPatternContext() {
	const root = path.join(__dirname, '../..');
	const context = vm.createContext({ structuredClone, BOOT_TASKS: { register() {} }, navigator: { hardwareConcurrency: 4, userAgent: 'node' }, ByteBudgetCache: class extends Map { constructor() { super(); } } });
	for (const file of ['js/core/releases.js', 'js/core/fields.js', 'js/core/area.js', 'js/core/config.js', 'js/core/options.js', 'js/assets/ShapeLibrary.js', 'js/ui/preset-library.js', 'js/paint/pattern-source.js', 'js/paint/pattern-presets.js']) {
		vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
	}
	context.manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/shapes.json')));
	vm.runInContext('ShapeLibrary.applyManifest(manifest)', context);
	return context;
};
