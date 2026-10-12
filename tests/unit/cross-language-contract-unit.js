'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const php = read('admin/includes/attributionSchema.php');
const fields = name => [...php.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`))[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const context = vm.createContext({});
vm.runInContext(read('js/core/attribution.js') + '\nthis.attribution = Attribution;', context);
assert.deepStrictEqual(fields('ATTRIBUTION_FIELDS'), Array.from(context.attribution.FIELDS));
assert.deepStrictEqual(fields('ATTRIBUTION_LICENSES'), Array.from(context.attribution.LICENSES, row => row[0]));
const jsMax = read('js/core/config.js').match(/nineSlice:\s*\{\s*maxTiles:\s*(\d+)/)[1];
const phpMax = read('admin/includes/config.php').match(/'nineSlice'\s*=>\s*\['maxTiles'\s*=>\s*(\d+)/)[1];
assert.strictEqual(jsMax, phpMax, 'Nine-slice tile limits must match');
for (const service of ['assetAPI.php', 'manifestLibraryService.php']) {
	const source = read(`admin/includes/${service}`);
	assert(source.includes("'/attributionSchema.php'"), `${service} must load the shared schema`);
	assert(!/\b(?:const ATTRIBUTION_FIELDS|\$fields = \['author')/.test(source), `${service} must not redeclare attribution`);
}
console.log('PASS PHP and JS attribution and tile contracts match');
