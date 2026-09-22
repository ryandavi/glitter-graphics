'use strict';

const OPTION_REGISTRY = Object.create(null);

function defineOptions(name, options) {
	if (OPTION_REGISTRY[name]) throw new Error(`Options already defined: ${name}`);
	const normalized = options.map((option) => Object.freeze(typeof option === 'string' ? { value: option, label: option } : { ...option }));
	OPTION_REGISTRY[name] = Object.freeze(normalized);
	return OPTION_REGISTRY[name];
}

function getOptions(name) {
	return OPTION_REGISTRY[name] || Object.freeze([]);
}

function getOptionValues(name) {
	return getOptions(name).map((option) => option.value);
}

function isOptionValue(name, value) {
	return getOptions(name).some((option) => option.value === value);
}

defineOptions('paintMode', [
	{ value: 'none', label: 'None' },
	{ value: 'solid', label: 'Color' },
	{ value: 'gradient', label: 'Gradient' },
	{ value: 'glitter', label: 'Glitter' },
	{ value: 'image', label: 'Image' }
]);
defineOptions('paletteStyle', [
	{ value: 'vivid', label: 'Vivid Web' },
	{ value: 'balanced', label: 'Balanced' },
	{ value: 'natural', label: 'Natural' },
	{ value: 'websafe', label: 'Web Safe' }
]);
defineOptions('ditherTemporalMode', [
	{ value: 'stable', label: 'Stable' },
	{ value: 'animated', label: 'Animated shimmer' }
]);
defineOptions('borderPlacement', [
	{ value: 'inside', label: 'Inside' },
	{ value: 'center', label: 'Center' },
	{ value: 'outside', label: 'Outside' }
]);
defineOptions('borderEdgeStyle', [{ value: 'round', label: 'Rounded' }, { value: 'hard', label: 'Hard' }]);
defineOptions('borderDrawOrder', [{ value: 'behind', label: 'Behind' }, { value: 'front', label: 'In Front' }]);
