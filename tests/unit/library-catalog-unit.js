'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'js/assets/LibraryCatalog.js'), 'utf8') + '\nthis.LibraryCatalog = LibraryCatalog;', context);
const { categories, items } = require('../fixtures/glitter-catalog.json');
const catalog = new context.LibraryCatalog(categories);
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepStrictEqual(plain(catalog.getRoots().map(style => style.id)), ['sparkle', 'ember', 'noise']);
for (const [style, count, sets] of [['sparkle', 5, { 'set-a': 2, 'set-b': 1 }], ['ember', 3, { 'set-a': 1 }], ['noise', 4, { 'set-b': 1 }]]) {
	assert.strictEqual(catalog.getRootItems(style, items).length, count);
	assert.strictEqual(catalog.getRootCount(catalog.getCategoryById(style), catalog.getCategoryCounts(items)), count);
	assert.deepStrictEqual(plain(catalog.getSetCounts(style, items)), sets);
	assert.deepStrictEqual(catalog.getRootItems(style, items).map(item => item.sortOrder), Array.from({ length: count }, (_, index) => index));
}
assert.strictEqual(catalog.getCreatorItems('alice', items).length, 3);
assert.strictEqual(catalog.getCreatorItems('bob', items).length, 2);
assert.strictEqual(catalog.getCreatorItems('__unknown', items).length, 7);
assert.strictEqual(catalog.getCreators(items).at(-1).id, '__unknown');
assert.deepStrictEqual(plain(catalog.getStylesByCreator('alice', items).map(style => style.id)), ['sparkle', 'ember']);
assert.strictEqual(catalog.getSharedSet(catalog.getRootItems('sparkle', items)), null);

// Live manifests validate references and shape without pinning editorial data.
const liveCategories = require('../../data/glitter-categories.json');
const liveItems = require('../../data/glitter.index.json');
const liveCatalog = new context.LibraryCatalog(liveCategories);
assert(liveCategories.every(category => !('parent' in category)));
assert.strictEqual(new Set(liveItems.map(item => item.id)).size, liveItems.length);
assert(liveItems.every(item => item.name && item.url && Array.isArray(item.tags) && liveCatalog.getRoots().some(style => style.id === item.category)));
assert(liveItems.every(item => !item.set || liveCatalog.isSet(liveCatalog.getCategoryById(item.set))));

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
