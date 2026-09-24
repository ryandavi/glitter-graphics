'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'js/export/ProjectSerializer.js'), 'utf8');
const context = vm.createContext({
	LayerType: { STICKER: 'sticker', TEXT_GLITTER: 'text', SHAPE: 'shape', GLITTER_FILL: 'glitter', BASE_IMAGE: 'base' },
	FIELDS: { layerOpacity: { value: 100 } }
});
vm.runInContext(`${source}\nglobalThis.ProjectSerializerForTest = ProjectSerializer;`, context);
const Serializer = context.ProjectSerializerForTest;
const serializer = Object.create(Serializer.prototype);

const migrated = serializer.runMigrations({
	format: Serializer.FORMAT,
	version: 3,
	layers: [
		{ type: 'sticker', transform: {}, animation: { type: 'sway', anchor: 'bottom-center' } },
		{ type: 'sticker', transform: {}, animation: { type: 'rotate', anchor: 'custom', anchorX: 0, anchorY: 0.25 } },
		{ type: 'sticker', transform: {}, animation: { type: 'orbit', anchor: 'top-right', anchorX: 0.2, anchorY: 0.3 } }
	]
});

assert.strictEqual(migrated.version, 4);
assert.deepStrictEqual({ ...migrated.layers[0].transform.anchor }, { x: 0.5, y: 1 });
assert.deepStrictEqual({ ...migrated.layers[1].transform.anchor }, { x: 0, y: 0.25 });
assert.deepStrictEqual({ ...migrated.layers[2].transform.anchor }, { x: 0.5, y: 0.5 });
assert.strictEqual(migrated.layers[2].animation.orbitCenter, 'top-right');
assert.strictEqual(migrated.layers[2].animation.orbitCenterX, 1);
assert.strictEqual(migrated.layers[2].animation.orbitCenterY, 0);
assert(!('anchor' in migrated.layers[2].animation));

console.log('PASS transform-anchor project migration');
