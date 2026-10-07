'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'js/assets/LibraryCatalog.js'), 'utf8') + '\nthis.LibraryCatalog = LibraryCatalog;', context);
const categories = JSON.parse(fs.readFileSync(path.join(root, 'data/glitter-categories.json')));
const items = JSON.parse(fs.readFileSync(path.join(root, 'data/glitter.index.json')));
const catalog = new context.LibraryCatalog(categories);
const plain = value => JSON.parse(JSON.stringify(value));

// Styles are flat; sets are separate entries that hold no tiles of their own.
assert(categories.every(category => !('parent' in category)), 'A category still exports a parent');
assert.deepStrictEqual(plain(catalog.getRoots().map(style => style.id)), ['sparkle', 'star-dust', 'ember', 'transparent', 'noise', 'noise-2', 'etc', 'unsorted']);
assert.deepStrictEqual(plain(categories.filter(category => catalog.isSet(category)).map(set => set.id)), ['stardrops', 'sparkelies', 'bring-on-the-glitter', 'flashites']);
assert(items.every(item => catalog.getRoots().some(style => style.id === item.category)), 'A tile is filed in something that is not a style');
assert(items.every(item => !item.set || catalog.isSet(catalog.getCategoryById(item.set))), 'A tile points at something that is not a set');
assert(catalog.getRoots().every(style => !style.attribution), 'A glitter style still carries a credit');
assert(items.every(item => !item.attribution), 'A tile still carries its own copy of a set credit');

const expected = {
	sparkle: { total: 104, stardrops: 7, sparkelies: 16, 'bring-on-the-glitter': 59 },
	'star-dust': { total: 25, 'bring-on-the-glitter': 25 },
	ember: { total: 14, 'bring-on-the-glitter': 10 },
	transparent: { total: 9, 'bring-on-the-glitter': 5 },
	noise: { total: 8 },
	'noise-2': { total: 26, 'bring-on-the-glitter': 26 },
	etc: { total: 16, sparkelies: 1, 'bring-on-the-glitter': 6 },
};
for (const [id, { total, ...sets }] of Object.entries(expected)) {
	assert.strictEqual(catalog.getRootItems(id, items).length, total, id);
	assert.strictEqual(catalog.getRootCount(catalog.getCategoryById(id), catalog.getCategoryCounts(items)), total, id);
	assert.deepStrictEqual(plain(catalog.getSetCounts(id, items)), sets, id);
	for (const [set, count] of Object.entries(sets)) {
		assert.strictEqual(catalog.getCategoryItems(set, catalog.getRootItems(id, items)).length, count, `${id}/${set}`);
	}
}
for (const [set, count] of [['stardrops', 7], ['sparkelies', 17], ['bring-on-the-glitter', 131], ['flashites', 0]]) {
	assert.strictEqual(catalog.getCategoryItems(set, items).length, count, set);
	assert.strictEqual(catalog.getCategoryById(set).count, count, `${set} exported count`);
}

// The Christmas tiles sit in Classic Sparkle and are still Bring On The Glitter.
const christmas = items.filter(item => item.tags.includes('Christmas'));
assert.strictEqual(christmas.length, 6);
assert(christmas.every(item => item.category === 'sparkle' && item.set === 'bring-on-the-glitter' && catalog.getAssetAttribution(item).authorId === 'aylana'));

assert.deepStrictEqual(plain(catalog.getCreators(items).map(creator => creator.id).sort()), ['__unknown', 'aylana', 'dan', 'mica']);
assert.strictEqual(catalog.getCreators(items).at(-1).id, '__unknown', 'Unknown must be last');
assert.strictEqual(catalog.getCreatorItems('dan', items).length, 17);
assert.strictEqual(catalog.getCreatorItems('aylana', items).length, 131);
assert.strictEqual(catalog.getCreatorItems('__unknown', items).length, 47);
assert.deepStrictEqual(plain(catalog.getStylesByCreator('aylana', items).map(style => style.id)), ['sparkle', 'star-dust', 'ember', 'transparent', 'noise-2', 'etc']);
assert.deepStrictEqual(plain(catalog.getStylesByCreator('mica', items).map(style => style.id)), ['sparkle']);
assert.strictEqual(catalog.getSharedSet(catalog.getRootItems('star-dust', items)).id, 'bring-on-the-glitter');
assert.strictEqual(catalog.getSharedSet(catalog.getRootItems('sparkle', items)), null);
assert.strictEqual(catalog.getSharedSet(catalog.getRootItems('noise', items)), null);
assert(catalog.getUnknownGroups(items).every(group => group.items.every(item => !catalog.getAssetAttribution(item).authorId)));
assert.strictEqual(catalog.getCategoryById('noise-2').name, 'Chunky Noise');
assert(!items.some(item => /sparkSquare\.gif$/i.test(item.url)), 'Inactive Spark Square is still public');
const opal = items.find(item => item.url === 'images/glitter/sparkelies/opal.gif');
assert.strictEqual(opal.category, 'etc');
assert.strictEqual(catalog.getAssetAttribution(opal).authorId, 'dan');

// Each style's exported order is its own run from zero: the wall order.
for (const style of catalog.getRoots()) {
	assert.deepStrictEqual(catalog.getRootItems(style.id, items).map(item => item.sortOrder), catalog.getRootItems(style.id, items).map((item, index) => index), `${style.id} order`);
}

// Credit layers: the item's own over its set's over its style's.
const fixture = new context.LibraryCatalog([
	{ id: 'root', name: 'Root', attribution: { author: 'Style', authorId: 'style' } },
	{ id: 'nested', parent: 'root', name: 'Nested' },
	{ id: 'solo', name: 'Solo' },
	{ id: 'set', kind: 'set', name: 'Set', attribution: { author: 'Set', authorId: 'set' } },
	{ id: 'idle', kind: 'set', name: 'Idle' },
]);
const edgeItems = [
	{ id: 1, category: 'root' },
	{ id: 2, category: 'missing' },
	{ id: 3, category: 'root', set: 'set' },
	{ id: 4, category: 'nested', set: 'set', attribution: { authorId: 'own' } },
	{ id: 5, category: 'solo', set: 'gone' },
];
assert.deepStrictEqual(plain(fixture.getRoots().map(style => style.id)), ['root', 'solo']);
assert.strictEqual(fixture.getRootItems('root', edgeItems).length, 3);
assert.deepStrictEqual(plain(fixture.getSetCounts('root', edgeItems)), { set: 2, nested: 1 });
assert.deepStrictEqual(plain(fixture.getSetCounts('solo', edgeItems)), { gone: 1 });
assert.strictEqual(fixture.getCategoryItems('idle', edgeItems).length, 0);
assert.strictEqual(fixture.getCategoryItems('nested', edgeItems).length, 1);
assert.strictEqual(fixture.getAssetAttribution(edgeItems[0]).authorId, 'style');
assert.strictEqual(fixture.getAssetAttribution(edgeItems[2]).authorId, 'set');
assert.strictEqual(fixture.getAssetAttribution(edgeItems[3]).authorId, 'own');
assert.strictEqual(fixture.getAssetAttribution(edgeItems[4]).authorId, undefined);
assert.strictEqual(fixture.getCategoryPath('nested'), 'Root › Nested');
assert.strictEqual(fixture.getCategoryPath('missing'), 'missing');
assert.strictEqual(fixture.getRootOf('nested').id, 'root');
assert.strictEqual(fixture.getRootOf('missing'), null);
console.log('PASS catalog: flat styles, sets across styles, credit layers, creators, exported order and missing references');
