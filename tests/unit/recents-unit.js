'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../js/core/recents.js'), 'utf8'), context);
const recent = (...args) => JSON.parse(JSON.stringify(context.pushRecent(...args)));
const same = (a, b) => a === b;
const list = ['a', 'b', 'a', 'c'];
assert.deepStrictEqual(recent(list, 'a', 3, same), ['a', 'b', 'c']);
assert.deepStrictEqual(list, ['a', 'b', 'a', 'c'], 'Recency must not mutate its input');
assert.deepStrictEqual(recent([], 'a', 6, same), ['a']);
assert.deepStrictEqual(recent(list, 'd', 2, same), ['d', 'a']);
assert.deepStrictEqual(recent(list, 'd', 0, same), []);
assert.deepStrictEqual(recent(['Pink', 'blue'], 'PINK', 5, (a, b) => a.toLowerCase() === b.toLowerCase()), ['PINK', 'blue']);
assert.deepStrictEqual(recent([1, '2'], '1', 12, (a, b) => String(a) === String(b)), ['1', '2']);
assert.deepStrictEqual(recent([{ width: 88, height: 31 }, { width: 31, height: 88 }],
	{ width: 88, height: 31 }, 6, (a, b) => a.width === b.width && a.height === b.height),
	[{ width: 88, height: 31 }, { width: 31, height: 88 }]);
console.log('Recents unit verification passed');
