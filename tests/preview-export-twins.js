'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sources = {
	TextGlitterManager: fs.readFileSync(path.join(root, 'js/classes/TextGlitterManager.js'), 'utf8'),
	ShapeGlitterManager: fs.readFileSync(path.join(root, 'js/classes/ShapeGlitterManager.js'), 'utf8'),
	GifExporter: fs.readFileSync(path.join(root, 'js/classes/GifExporter.js'), 'utf8')
};
const paritySource = fs.readFileSync(path.join(root, 'js/effects/PARITY.js'), 'utf8');
const context = {};
vm.runInNewContext(`${paritySource}\nglobalThis.twins = PREVIEW_EXPORT_TWINS;`, context);

for (const twin of context.twins) {
	for (const member of [...twin.preview, ...twin.export]) {
		const [className, methodName] = member.split('.');
		const source = sources[className];
		if (!source) throw new Error(`${twin.feature}: missing source for ${className}`);
		const methodIndex = source.indexOf(`\n\t${methodName}(`);
		if (methodIndex === -1) throw new Error(`${twin.feature}: missing ${member}`);
		const methodWindow = source.slice(methodIndex, methodIndex + 900);
		if (!methodWindow.includes(twin.shared)) {
			throw new Error(`${twin.feature}: ${member} no longer delegates to ${twin.shared}`);
		}
	}
}

process.stdout.write(`Preview/export twin verification passed (${context.twins.length} contracts)\n`);
