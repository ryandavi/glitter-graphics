'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const sources = {
	TextGlitterManager: fs.readFileSync(path.join(root, 'js/layers/TextGlitterManager.js'), 'utf8'),
	ShapeGlitterManager: fs.readFileSync(path.join(root, 'js/layers/ShapeGlitterManager.js'), 'utf8'),
	AnimationTicker: fs.readFileSync(path.join(root, 'js/systems/AnimationTicker.js'), 'utf8'),
	SceneCompositor: fs.readFileSync(path.join(root, 'js/export/SceneCompositor.js'), 'utf8'),
	HtmlSceneExporter: fs.readFileSync(path.join(root, 'js/export/HtmlSceneExporter.js'), 'utf8'),
	paintSlots: fs.readFileSync(path.join(root, 'js/paint/paint-slots.js'), 'utf8')
};
const paritySource = fs.readFileSync(path.join(root, 'tests/parity/preview-export-parity.js'), 'utf8');
const context = {};
vm.runInNewContext(`${paritySource}\nglobalThis.twins = PREVIEW_EXPORT_TWINS;`, context);

// Class methods are tab-indented; paint-slots.js members are top-level functions.
function memberBody(className, methodName) {
	const source = sources[className];
	if (!source) return null;
	const [starts, end] = className === 'paintSlots'
		? [[`\nfunction ${methodName}(`], '\n}\n']
		: [[`\n\t${methodName}(`, `\n\tasync ${methodName}(`], '\n\t}\n'];
	const index = starts.map((start) => source.indexOf(start)).find((found) => found !== -1) ?? -1;
	if (index === -1) return null;
	const close = source.indexOf(end, index);
	return source.slice(index, close === -1 ? undefined : close);
}

for (const twin of context.twins) {
	for (const member of [...twin.preview, ...twin.export]) {
		const [className, methodName] = member.split('.');
		if (!sources[className]) throw new Error(`${twin.feature}: missing source for ${className}`);
		const body = memberBody(className, methodName);
		if (body === null) throw new Error(`${twin.feature}: missing ${member}`);
		if (!body.includes(twin.shared)) {
			throw new Error(`${twin.feature}: ${member} no longer delegates to ${twin.shared}`);
		}
	}
}

process.stdout.write(`Preview/export twin verification passed (${context.twins.length} contracts)\n`);
