'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'admin/js/glitter_color_order.js'), 'utf8') + '\nthis.glitterColorOrder = glitterColorOrder; this.sortByGlitterColor = sortByGlitterColor;', context);
const { glitterColorOrder: key, sortByGlitterColor: sort } = context;
// The editor shows library order and never sorts by color.
assert(!/glitterColorOrder|sortByGlitterColor/.test(fs.readFileSync(path.join(root, 'js/paint/color-selection.js'), 'utf8')));
assert(!/glitter_color_order/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8')));
const items = JSON.parse(fs.readFileSync(path.join(root, 'data/glitter.index.json')));
const sorted = sort(items);
assert.strictEqual(items.length, 202);
assert.notStrictEqual(sorted, items);
for (let index = 1; index < sorted.length; index++) {
	const previous = key(sorted[index - 1]), current = key(sorted[index]);
	assert(previous[0] <= current[0], 'Bands are not contiguous');
	if (previous[0] === current[0]) assert(previous[1] <= current[1], 'Band is not light to dark');
}
const patterns = sorted.filter(item => item.tags.some(tag => /^(pattern|multicolor)$/i.test(tag)));
assert(patterns.length > 0);
assert.deepStrictEqual(sorted.slice(-patterns.length).map(item => item.id), patterns.map(item => item.id));
const ties = [{ id: 3, colorCodes: ['#ff0000'] }, { id: 1, colorCodes: ['#ff0000'] }, { id: 2, colorCodes: ['#ff0000'] }];
assert.deepStrictEqual(Array.from(sort(ties), item => item.id), [3, 1, 2]);
assert.strictEqual(key({ colorCodes: ['#85858a'] })[0], 9, 'Gray blue cast escaped neutrals');
assert.strictEqual(key({})[0], 10);
assert.strictEqual(key({ tags: ['pAtTeRn'] })[0], 15);
assert.strictEqual(key({ colorCodes: ['#f0d2b4'] })[0], 11, 'Cream escaped earth tones');
console.log('PASS color order: real bands, end band, stable ties and neutrals; absent from the editor');
