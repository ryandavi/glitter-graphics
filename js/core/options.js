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
defineOptions('gifLook', [
	{ value: 'clean', label: 'Clean · Automatic' },
	{ value: 'classic', label: 'Classic Web' },
	{ value: 'textured', label: 'Textured 64' },
	{ value: 'crunchy', label: 'Crunchy Pixel' },
	{ value: 'shimmer', label: 'Sparkle Noise' },
	{ value: 'custom', label: 'Custom' }
]);
// Theme picker. Values must match CONFIG.ui.themes (the load-time allow-list).
defineOptions('interfaceTheme', [
	{ value: 'dark', label: 'Default Dark', group: 'Dark themes' },
	{ value: 'llama', label: 'Llama', group: 'Dark themes' },
	{ value: 'cyber-chrome', label: 'Cyber Chrome', group: 'Dark themes' },
	{ value: 'light', label: 'Default Light', group: 'Light themes' },
	{ value: 'bubblegum', label: 'Bubblegum', group: 'Light themes' },
	{ value: 'bliss', label: 'Bliss', group: 'Light themes' },
	{ value: 'dew', label: 'Dew', group: 'Light themes' },
	{ value: 'aqua', label: 'Aqua', group: 'Light themes' },
	{ value: 'p2p', label: 'P2P', group: 'Light themes' },
	{ value: 'homepage', label: 'Homepage', group: 'Light themes' },
	{ value: 'buddy-list', label: 'Buddy List', group: 'Light themes' }
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
