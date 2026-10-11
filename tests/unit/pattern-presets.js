'use strict';

const vm = require('vm');
const assert = require('assert');
const context = require('../fixtures/pattern-source-context')();
const entries = vm.runInContext('PATTERN_PRESETS.entries', context);
assert.strictEqual(new Set(entries.map((entry) => entry.id)).size, entries.length);
for (const entry of entries) {
	context.entry = entry;
	assert.strictEqual(vm.runInContext('findPatternPresetId(normalizeEffectPattern(entry.value))', context), entry.id);
	assert.strictEqual(vm.runInContext("findPatternPresetId({ ...entry.value, color: '#112233', backgroundColor: '#445566', scroll: 'left' })", context), entry.id);
	assert(vm.runInContext('!entry.value.shapeId || ShapeLibrary.FILL_SHAPES.some(shape => shape.id === entry.value.shapeId)', context));
	assert(vm.runInContext("(() => { const target = normalizeEffectPattern({ scroll: 'up', scrollCycleMs: 4000 }); PATTERN_PRESETS.apply(entry, target); return target.scroll === 'up' && target.scrollCycleMs === 4000; })()", context));
}
console.log(`PASS pattern presets: ${entries.length} unique recipes, matching, shapes and retained scroll`);
