'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const context = vm.createContext({
	console,
	structuredClone,
	CONFIG: { rendering: { gradient: { type: 'linear', angle: 180, interpolation: 'linear', smoothSubdivisions: 8, stops: [{ offset: 0, color: '#ff4fa3', alpha: 1 }, { offset: 1, color: '#6554ff', alpha: 1 }] } } },
	FIELDS: { gradientSmoothing: { min: 2, max: 32 } }
});

for (const file of ['js/paint/effect-source.js', 'js/ui/preset-library.js', 'js/paint/gradient-presets.js']) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const library = context.GRADIENT_PRESETS;
if (!library || library.id !== 'gradients') throw new Error('Gradient preset library did not register');
if (library.groups.map((group) => group.id).join(',') !== 'duotone,rainbow,pride,web') throw new Error('Gradient preset groups are incomplete');
if (library.entries.length < 30) throw new Error(`Expected the full starter preset set, got ${library.entries.length}`);

const seenValues = new Map();
for (const entry of library.entries) {
	const value = entry.value;
	// findGradientPresetId returns the first match, so a duplicate would
	// highlight the wrong tile (Pride 6 once lit up Rainbow Bands).
	const key = JSON.stringify([value.type || 'linear', value.interpolation, value.stops]);
	if (seenValues.has(key)) throw new Error(`${entry.id} duplicates ${seenValues.get(key)}`);
	seenValues.set(key, entry.id);
	if (!['linear', 'steps', 'smooth'].includes(value.interpolation)) throw new Error(`${entry.id} has invalid interpolation`);
	if (!Array.isArray(value.stops) || value.stops.length < 2) throw new Error(`${entry.id} has too few stops`);
	let previous = -1;
	for (const colorStop of value.stops) {
		if (colorStop.offset < previous || colorStop.offset < 0 || colorStop.offset > 1) throw new Error(`${entry.id} has invalid stop ordering`);
		if (!/^#[0-9a-f]{6}$/i.test(colorStop.color) || colorStop.alpha !== 1) throw new Error(`${entry.id} has an invalid color stop`);
		previous = colorStop.offset;
	}
}

const bi = library.get('bi');
if (bi.value.stops.map((entry) => entry.offset).join(',') !== '0,0.4,0.6,1') throw new Error('Bisexual flag weights are not 2:1:2');
const originalEight = library.get('original-8');
const expectedOriginalEight = '#d6006e,#e4002b,#fe5000,#ffcd00,#00843d,#009aa6,#003da5,#a634b2';
if (originalEight.value.stops.slice(0, -1).map((entry) => entry.color).join(',') !== expectedOriginalEight) {
	throw new Error('Original 8 preset does not use the Gilbert Baker palette');
}
const target = context.normalizeEffectGradient({ type: 'linear', angle: 45, interpolation: 'linear', stops: [{ offset: 0, color: '#000000', alpha: 1 }, { offset: 1, color: '#ffffff', alpha: 1 }] });
library.apply('trans', target);
if (target.angle !== 45 || target.interpolation !== 'steps') throw new Error('Applying a flag did not preserve a customized angle');
target.stops[0].color = '#123456';
if (library.get('trans').value.stops[0].color === '#123456') throw new Error('Preset values were applied by reference');

library.apply('intersex', target);
if (target.type !== 'radial') throw new Error('Intersex preset did not apply its radial type');
library.apply('spectrum', target);
if (target.type !== 'linear') throw new Error('A preset without a type inherited the previous radial type');
if (context.findGradientPresetId(target) !== 'spectrum') throw new Error('Applied preset is not recognized as active');

const basic = library.get('basic');
if (library.entries[0] !== basic || basic.value.stops.map((entry) => entry.color).join(',') !== '#ff4fa3,#6554ff') {
	throw new Error('Basic preset must lead the list and match the CONFIG default gradient');
}
library.apply('pride-6', target);
if (context.findGradientPresetId(target) !== 'pride-6') throw new Error('Pride 6 is not recognized as active');

// Reverse under Steps mirrors whole bands: Pride 6 reversed is the same six
// equal bands in the opposite order, closing stop kept.
const bandsOf = (value) => {
	const stops = context.getEffectGradientRenderStops(value);
	const out = [];
	for (let index = 0; index < stops.length - 1; index += 2) out.push(`${stops[index].color}@${(stops[index + 1].offset - stops[index].offset).toFixed(3)}`);
	return out;
};
const pride = { ...library.get('pride-6').value };
const reversedPride = { ...pride, stops: context.reverseEffectGradientStops(pride) };
if (bandsOf(reversedPride).join() !== bandsOf(pride).reverse().join()) throw new Error(`Steps reverse broke the bands: ${bandsOf(reversedPride).join()}`);
if (reversedPride.stops.length !== pride.stops.length || reversedPride.stops.at(-1).offset !== 1) throw new Error('Steps reverse dropped the closing stop');
const biFlag = { ...library.get('bi').value };
const reversedBi = context.reverseEffectGradientStops(biFlag);
if (reversedBi.map((entry) => `${entry.color}@${entry.offset.toFixed(2)}`).join() !== '#0038a8@0.00,#9b4f96@0.40,#d60270@0.60,#d60270@1.00') throw new Error('Steps reverse lost the 2:1:2 weights');
const linearReverse = context.reverseEffectGradientStops(library.get('sunset').value);
if (linearReverse[0].color !== '#7b2cbf' || linearReverse.at(-1).color !== '#ff2d55' || linearReverse[1].offset.toFixed(3) !== (1 / 3).toFixed(3)) throw new Error('Linear reverse did not mirror the stops');

process.stdout.write(`PASS ${library.entries.length} gradient presets\n`);
