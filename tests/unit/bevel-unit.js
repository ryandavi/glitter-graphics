'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'js/paint/bevel.js'), 'utf8');
const context = {
	FIELDS: {
		bevelSize: { min: 1, max: 64, value: 6 },
		bevelDepth: { min: 0, max: 100, value: 60 },
		bevelAngle: { min: 0, max: 359, value: 135 },
		bevelAltitude: { min: 0, max: 90, value: 35 },
		bevelSoften: { min: 0, max: 20, value: 1 }
	},
	Math,
	Object
};
vm.runInNewContext(`${source}; globalThis.exports = { BEVEL_PROFILES, getBevelProfile, normalizeBevelData };`, context);
const bevel = context.exports;
assert.deepStrictEqual(Object.keys(bevel.BEVEL_PROFILES), ['smooth', 'chisel', 'pillow', 'emboss', 'gloss']);
Object.values(bevel.BEVEL_PROFILES).forEach((profile) => {
	if (profile.gloss) return;
	assert.strictEqual(typeof profile.slope, 'function', `${profile.id} must provide a slope function`);
	for (const t of [0, 0.25, 0.5, 0.75, 1]) {
		const value = profile.slope(t);
		assert(Number.isFinite(value) && value >= -1 && value <= 1, `${profile.id} slope must stay normalized`);
	}
});
assert(Math.abs(bevel.BEVEL_PROFILES.emboss.slope(0.499) - bevel.BEVEL_PROFILES.emboss.slope(0.501)) < 0.01,
	'Emboss slope must remain continuous through its midpoint');
const normalized = bevel.normalizeBevelData({ size: 999, depth: -1, angle: 999, altitude: -5, soften: 99, profile: 'missing' });
assert.strictEqual(normalized.size, 64);
assert.strictEqual(normalized.depth, 0);
assert.strictEqual(normalized.angle, 359);
assert.strictEqual(normalized.altitude, 0);
assert.strictEqual(normalized.soften, 20);
assert.strictEqual(normalized.profile, 'smooth');
process.stdout.write('Bevel profile conformance passed (5 profiles)\n');
