const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const scriptManifest = require('../js/script-manifest.json');
const owners = new Map();

for (const [group, files] of Object.entries(scriptManifest)) {
	if (!Array.isArray(files)) throw new Error(`Script group ${group} must be an ordered array`);
	for (const file of files) {
		if (typeof file !== 'string' || !/^js\/[a-zA-Z0-9_/-]+\.js$/u.test(file)) throw new Error(`Invalid script path in ${group}: ${file}`);
		if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing script in ${group}: ${file}`);
		if (owners.has(file)) throw new Error(`Script ${file} belongs to both ${owners.get(file)} and ${group}`);
		owners.set(file, group);
	}
}
if (!scriptManifest.head || !scriptManifest.boot) throw new Error('The script manifest requires head and boot groups');

function getScriptUrls(group) {
	if (!scriptManifest[group]) throw new Error(`Unknown script group: ${group}`);
	return scriptManifest[group].map((file) => {
		const hash = crypto.createHash('md5').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 8);
		return `${file}?v=${hash}`;
	});
}

function getGroupGlobals() {
	const espree = require('espree');
	const groups = {};
	const bindings = (node) => {
		if (!node) return [];
		if (node.type === 'Identifier') return [node.name];
		if (node.type === 'RestElement') return bindings(node.argument);
		if (node.type === 'AssignmentPattern') return bindings(node.left);
		if (node.type === 'ArrayPattern') return node.elements.flatMap(bindings);
		if (node.type === 'ObjectPattern') return node.properties.flatMap(property => bindings(property.value || property.argument));
		return [];
	};
	for (const [id, files] of Object.entries(scriptManifest)) {
		const names = files.flatMap(file => {
			const ast = espree.parse(fs.readFileSync(path.join(root, file), 'utf8'), { ecmaVersion: 2022, sourceType: 'script' });
			const declared = ast.body.flatMap(node => node.type === 'VariableDeclaration'
				? node.declarations.flatMap(entry => bindings(entry.id))
				: /^(Function|Class)Declaration$/u.test(node.type) ? bindings(node.id) : []);
			const visit = (node) => {
				if (!node || typeof node !== 'object') return;
				const target = node.type === 'AssignmentExpression' && node.left;
				if (target?.type === 'MemberExpression' && !target.computed
					&& ['root', 'window', 'self', 'globalThis'].includes(target.object.name)) declared.push(target.property.name);
				for (const value of Object.values(node)) {
					if (Array.isArray(value)) value.forEach(visit);
					else if (value && typeof value === 'object') visit(value);
				}
			};
			visit(ast);
			return declared;
		});
		// gif.js publishes its constructor through a UMD wrapper.
		if (files.includes('js/vendor/gif.js')) names.push('GIF');
		groups[id] = names;
	}
	groups.head.push('SCRIPT_GROUP_URLS');
	return groups;
}

module.exports = { scriptManifest, getScriptUrls, getGroupGlobals };
