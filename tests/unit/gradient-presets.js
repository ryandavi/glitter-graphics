'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const context = vm.createContext({
	console,
	structuredClone,
	CONFIG: { rendering: { gradient: { type: 'linear', angle: 180, interpolation: 'linear', smoothSubdivisions: 8, stops: [] } } },
	effectGradientToCss: () => '',
	normalizeEffectGradient(value) {
		return {
			type: value.type || 'linear',
			angle: value.angle ?? 180,
			interpolation: value.interpolation || 'linear',
			smoothSubdivisions: value.smoothSubdivisions || 8,
			stops: value.stops.map((entry) => ({ ...entry }))
		};
	}
});

for (const file of ['js/ui/preset-library.js', 'js/paint/gradient-presets.js']) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const library = context.GRADIENT_PRESETS;
if (!library || library.id !== 'gradients') throw new Error('Gradient preset library did not register');
if (library.groups.map((group) => group.id).join(',') !== 'rainbow,pride,web,duotone') throw new Error('Gradient preset groups are incomplete');
if (library.entries.length < 30) throw new Error(`Expected the full starter preset set, got ${library.entries.length}`);

for (const entry of library.entries) {
	const value = entry.value;
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

process.stdout.write(`PASS ${library.entries.length} gradient presets\n`);
