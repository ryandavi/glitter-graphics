'use strict';

// Text case and style mappings (js/core/text-content.js): every textCase
// option maps, the old-web style tables, and source indexes for graphemes
// whose drawn form differs in UTF-16 length from what was typed.

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const context = vm.createContext({ console, structuredClone, Math, Intl, navigator: { hardwareConcurrency: 4, userAgent: 'node' } });
for (const file of ['js/core/releases.js', 'js/core/fields.js', 'js/core/area.js', 'js/core/config.js', 'js/core/text-content.js', 'js/core/options.js']) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const run = source => vm.runInContext(source, context);
const style = (text, mode) => run(`applyTextCase(${JSON.stringify(text)}, ${JSON.stringify(mode)})`);

assert.equal(style('Leet Speak!', 'leet'), 'L33t 5p34k!');
assert.equal(style('Hi 5!', 'fullwidth'), 'Ｈｉ　５！');
assert.equal(style('Tiny caps', 'smallcaps'), 'Tɪɴʏ ᴄᴀᴘꜱ');
assert.equal(style('abcdefghijklmnopqrstuvwxyz', 'smallcaps').length, 26, 'every lowercase letter maps to one code unit');
assert.equal(style('héllo ★', 'fullwidth'), 'ｈéｌｌｏ　★', 'non-ASCII draws as typed');

// Each option label is its own mapping, so the menu previews the style.
const labels = JSON.parse(run(`JSON.stringify(getOptions('textCase'))`));
for (const [value, plain] of [['leet', 'leet'], ['fullwidth', 'fullwidth'], ['smallcaps', 'tiny caps'], ['alternating', 'alternating']]) {
	assert.equal(labels.find(option => option.value === value).label, style(plain, value), `${value} label`);
}
for (const option of labels) assert.equal(typeof style('Glitter', option.value), 'string', `${option.value} maps`);

// A surrogate pair typed (an emoji) keeps its two source code units; a
// fullwidth glyph replaces one typed code unit with one drawn code unit.
const content = JSON.parse(run(`JSON.stringify(getTextContent('a\u{1f496}b', 'fullwidth'))`));
assert.deepEqual(content.map(glyph => [glyph.char, glyph.sourceIndex, glyph.sourceEnd, glyph.displayIndex]), [
	['ａ', 0, 1, 0], ['\u{1f496}', 1, 3, 1], ['ｂ', 3, 4, 3]
]);
console.log('PASS text case and style mappings, labels and source indexes');
