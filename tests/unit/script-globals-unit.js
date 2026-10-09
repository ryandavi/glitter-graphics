'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const espree = require('espree');
const root = path.resolve(__dirname, '../..');
const names = new Map();
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const match of index.matchAll(/<script\s+src="(js\/[^"?]+)(?:\?[^" ]*)?"/g)) {
	const file = match[1];
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
assert.strictEqual(math.clampNumber(NaN, 3, 9), 3);
assert.strictEqual(math.clampNumber(6.6, 3, 9, 3, true), 7);
assert.strictEqual(math.clamp01(-1), 0);
assert.strictEqual(math.lerp(2, 4, 0.5), 3);
assert.strictEqual(math.roundTo(7, 5), 5);
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
console.log(`PASS shared math, the phone breakpoint and ${names.size} unique script globals`);
