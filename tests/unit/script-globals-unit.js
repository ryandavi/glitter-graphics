'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const espree = require('espree');
const root = path.resolve(__dirname, '../..');
const names = new Map();
for (const file of Object.values(require('../../tools/script-manifest').scriptManifest).flat()) {
	if (file.startsWith('js/vendor/')) continue;
	const ast = espree.parse(fs.readFileSync(path.join(root, file), 'utf8'), { ecmaVersion: 2022, sourceType: 'script' });
	for (const node of ast.body) {
		const declared = node.type === 'VariableDeclaration' ? node.declarations.map(entry => entry.id) : /^(Function|Class)Declaration$/.test(node.type) ? [node.id] : [];
		for (const id of declared) {
			if (id?.type !== 'Identifier') continue;
			assert(!names.has(id.name), `${id.name} is declared by both ${names.get(id.name)} and ${file}`);
			names.set(id.name, file);
		}
	}
}
const math = require('../../js/core/math.js');
const { scriptManifest, bundleConfig } = require('../../tools/script-manifest');
const bundleAst = espree.parse(fs.readFileSync(path.join(root, bundleConfig.output), 'utf8'), { ecmaVersion: 2022, sourceType: 'script' });
assert(bundleAst.body[0].type === 'ExpressionStatement' && !bundleAst.body[0].directive, 'Bundle must start outside a directive prologue');
const bundledNames = new Set(bundleAst.body.flatMap(node => node.type === 'VariableDeclaration'
	? node.declarations.map(entry => entry.id.name)
	: /^(Function|Class)Declaration$/u.test(node.type) ? [node.id.name] : []));
for (const [name, file] of names) {
	if (scriptManifest.boot.includes(file)) assert(bundledNames.has(name), `Bundle lost top-level global ${name} from ${file}`);
}
assert.strictEqual(math.clampNumber(NaN, 3, 9), 3);
assert.strictEqual(math.clampNumber(6.6, 3, 9, 3, true), 7);
assert.strictEqual(math.clamp01(-1), 0);
assert.strictEqual(math.lerp(2, 4, 0.5), 3);
assert.strictEqual(math.roundTo(7, 5), 5);
assert.strictEqual(math.indexAtOrBefore([], 0), -1);
assert.strictEqual(math.indexAtOrBefore([10, 20, 30], 9), -1);
assert.strictEqual(math.indexAtOrBefore([10, 20, 30], 20 - 5e-7), 1);
assert.strictEqual(math.indexAtOrBefore([10, 20, 30], 20 - 5e-7, 0), 0);
assert.strictEqual(math.indexAtOrBefore([10, 20, 30], 100), 2);
assert(math.isSameData({ a: [1, { b: null }], c: false }, { c: false, a: [1, { b: null }] }));
assert(!math.isSameData([1, 2], [2, 1]));
assert(!math.isSameData([], new Array(3)));
assert(!math.isSameData({ a: undefined }, {}));
assert(!math.isSameData(null, {}));
const color = require('../../js/core/color.js');
assert.deepStrictEqual(color.hexToRgb('#ff60ba'), [255, 96, 186]);
assert.strictEqual(color.rgbToHex([255, 96, 186]), '#ff60ba');
assert.throws(() => color.hexToRgb('pink'));
// The phone layout's width is declared in CONFIG; Sass cannot read it, so the
// stylesheet's copy has to match.
const breakpoint = fs.readFileSync(path.join(root, 'js/core/config.js'), 'utf8').match(/mobile: \{[^}]*?breakpoint: (\d+)/);
const sassBreakpoint = fs.readFileSync(path.join(root, 'css/_mixins.scss'), 'utf8').match(/\$mobile-breakpoint: (\d+)px/);
assert(breakpoint && sassBreakpoint, 'the phone breakpoint is declared in CONFIG.ui.mobile and css/_mixins.scss');
assert.strictEqual(sassBreakpoint[1], breakpoint[1], 'css/_mixins.scss $mobile-breakpoint matches CONFIG.ui.mobile.breakpoint');
async function checkGroupBoundaries() {
	const { ESLint } = require('eslint');
	const { scriptManifest, getGroupGlobals } = require('../../tools/script-manifest');
	const eslint = new ESLint({ cwd: root });
	const groups = getGroupGlobals();
	const lint = async (source, file) => (await eslint.lintText(source, { filePath: path.join(root, file) }))[0].messages;
	const bootFile = 'js/core/dom.js';
	assert.strictEqual((await lint('GifExporter; Math; VideoEncoder;', bootFile)).length, 0, 'Boot lost shared/native globals');
	for (const [id, files] of Object.entries(scriptManifest)) {
		if (id === 'head' || id === 'boot') continue;
		const global = groups[id][0];
		if (!global) continue;
		for (const source of [`${global};`, `typeof ${global};`]) {
			assert((await lint(source, bootFile)).some(message => message.ruleId === 'no-undef'), `Boot may reference ${id} global ${global}`);
		}
		assert((await lint(`window.${global};`, bootFile)).some(message => message.ruleId === 'no-restricted-properties'), `Boot may bypass the boundary through window.${global}`);
		assert.strictEqual((await lint(`${global}; GifExporter;`, files.at(-1))).length, 0, `${id} lost its own/shared globals`);
	}
	assert((await lint('HtmlSceneExporter;', 'js/export/GifExportEncoder.js')).some(message => message.ruleId === 'no-undef'), 'A lazy group may reach into another lazy group');
	console.log(`PASS shared math, the phone breakpoint, ${names.size} unique script globals and script-group lint boundaries`);
}
checkGroupBoundaries().catch(error => { console.error(error); process.exitCode = 1; });
