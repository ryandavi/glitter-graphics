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
const catalog = new context.LibraryCatalog(categories, (category, item) => ({ ...category, ...item }));
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepStrictEqual(plain(catalog.getRoots().map(root => root.id)), ['sparkle', 'star-dust', 'ember', 'transparent', 'flashites', 'noise', 'noise-2', 'etc', 'unsorted']);
for (const [id, count] of [['sparkle', 104], ['ember', 14], ['star-dust', 25], ['transparent', 9], ['noise', 8], ['noise-2', 26], ['etc', 16]]) {
	assert.strictEqual(catalog.getRootItems(id, items).length, count);
	assert.strictEqual(catalog.getRootCount(catalog.getCategoryById(id), catalog.getCategoryCounts(items)), count);
}
assert.strictEqual(catalog.getCategoryById('christmas'), null);
const christmas = items.filter(item => item.tags.includes('Christmas'));
assert.strictEqual(christmas.length, 6);
assert(christmas.every(item => item.category === 'sparkle' && catalog.getAssetAttribution(item).authorId === 'aylana'));
assert.strictEqual(catalog.getRootOf('sparkle').id, 'sparkle');
assert.deepStrictEqual(plain(catalog.getCreators(items).map(creator => creator.id)), ['aylana', 'mica', 'dan', '__unknown']);
assert.strictEqual(catalog.getCreatorItems('dan', items).length, 17);
assert.strictEqual(catalog.getCategoryById('noise-2').name, 'Chunky Noise');
assert.strictEqual(catalog.getCategoryById('etc').name, 'Other');
assert.strictEqual(catalog.getCategoryById('sparkle-2'), null);
assert(!items.some(item => item.category === 'sparkle-2'));
const opal = items.find(item => item.url === 'images/glitter/sparkelies/opal.gif');
assert.strictEqual(opal.category, 'etc');
assert.strictEqual(catalog.getAssetAttribution(opal).authorId, 'dan');
assert(!catalog.getSetsByCreator('aylana', items).some(set => set.id === 'christmas'));
assert(catalog.getSetsByCreator('aylana', items).some(set => set.id === 'star-dust'), 'Standalone source collection missing from Creator filters');
assert.strictEqual(catalog.getCategoryById('ember').name, 'VelvetEmbers');
assert.strictEqual(catalog.getRootOf('velvet-embers').id, 'ember');
assert(catalog.getRootItems('ember', items).filter(item => item.category === 'ember').every(item => !catalog.getAssetAttribution(item).authorId), 'Found VelvetEmbers tiles gained an invented credit');
assert(catalog.getRootItems('ember', items).filter(item => item.category === 'velvet-embers').every(item => catalog.getAssetAttribution(item).authorId === 'aylana'), 'Sourced VelvetEmbers tiles lost attribution');
assert(!items.some(item => /sparkSquare\.gif$/i.test(item.url)), 'Inactive Spark Square is still public');
const noiseNames = ['blue-01', 'blue-02', 'blue-03', 'gold-04', 'gold-06', 'gold-07', 'green-01', 'green-07', 'green-08', 'green-09', 'nude-01', 'pink-01', 'pink-001', 'pink-002', 'pink-003', 'purple-001'];
const etcNames = ['brown-01', 'brown-02', 'brown-06', 'silver-03', 'silver-01', 'nude-03'];
for (const item of items.filter(item => item.url.startsWith('images/glitter/bring-on-the-glitter/'))) {
	if (/^black-/.test(item.originalName) || noiseNames.includes(item.originalName)) {
		assert.strictEqual(item.category, 'noise-2', item.originalName);
		assert.strictEqual(catalog.getAssetAttribution(item).authorId, 'aylana');
	} else if (etcNames.includes(item.originalName)) {
		assert.strictEqual(item.category, 'etc', item.originalName);
		assert.strictEqual(catalog.getAssetAttribution(item).authorId, 'aylana');
	}
}
assert.strictEqual(catalog.getRootCount(catalog.getCategoryById('sparkle'), catalog.getCategoryCounts(christmas)), 6);
assert(catalog.getUnknownGroups(items).every(group => group.items.every(item => !catalog.getAssetAttribution(item).authorId)));
const fixture = new context.LibraryCatalog([{ id: 'root', name: 'Root' }, { id: 'empty', parent: 'root', name: 'Empty' }, { id: 'solo', name: 'Solo' }]);
const edgeItems = [{ id: 1, category: 'root' }, { id: 2, category: 'missing' }];
assert.strictEqual(fixture.getRootItems('root', edgeItems).length, 1);
assert.strictEqual(fixture.getSets('solo').length, 0);
assert.strictEqual(fixture.getCategoryItems('empty', edgeItems).length, 0);
assert.strictEqual(fixture.getCategoryPath('missing'), 'missing');
assert.strictEqual(fixture.getRootOf('missing'), null);
assert.strictEqual(fixture.getUnknownGroups(edgeItems).length, 2);
console.log('PASS catalog: real library counts, hierarchy, creators, filtered subsets and missing categories');
