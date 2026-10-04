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

defineOptions('shadowCastAnchor', [
	{ value: 'baseline', label: 'Baseline' },
	{ value: 'bottom', label: 'Bottom edge' }
]);

defineOptions('shadowKind', [
	{ value: 'drop', label: 'Drop', suffix: 'KindDrop' },
	{ value: 'extrude', label: 'Extrude', suffix: 'KindExtrude' },
	{ value: 'cast', label: 'Cast', suffix: 'KindCast' }
]);

defineOptions('borderEdgeStyle', [
	{ value: 'round', label: 'Smooth', suffix: 'EdgeRounded' },
	{ value: 'miter', label: 'Sharp', suffix: 'EdgeSharp' },
	{ value: 'hard', label: 'Pixel', suffix: 'EdgeHard' }
]);

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
defineOptions('analysisPaletteStyle', [
	{ value: 'natural', label: 'Natural' },
	{ value: 'balanced', label: 'Balanced' },
	{ value: 'vibrant', label: 'Vibrant' }
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
defineOptions('borderDrawOrder', [{ value: 'behind', label: 'Behind' }, { value: 'front', label: 'In Front' }]);
defineOptions('borderStyle', [{ value: 'solid', label: 'Solid' }, { value: 'dotted', label: 'Dotted' }]);
defineOptions('stickerOutlineStyle', [{ value: 'smooth', label: 'Smooth' }, { value: 'pixel', label: 'Pixel' }]);
defineOptions('bevelProfile', [
	{ value: 'smooth', label: 'Smooth' },
	{ value: 'chisel', label: 'Chisel' },
	{ value: 'pillow', label: 'Pillow' },
	{ value: 'emboss', label: 'Emboss' },
	{ value: 'gloss', label: 'Gloss' }
]);
// Where a Sparkles slot places its particles (js/paint/sparkles.js).
defineOptions('sparkleEmitter', [
	{ value: 'inside', label: 'Scatter' },
	{ value: 'edges', label: 'Edges' },
	{ value: 'highlights', label: 'Highlights' }
]);
// How an image frame (js/paint/frames.js) fills the frame box.
defineOptions('frameFit', [
	{ value: 'stretch', label: 'Stretch' },
	{ value: 'contain', label: 'Fit' },
	{ value: 'slice', label: 'Smart Stretch' }
]);
// How the Highlights (Kira Kira) emitter turns highlight strength into glyphs.
defineOptions('sparkleStyle', [
	{ value: 'kira', label: 'Kira' },
	{ value: 'glint', label: 'Glint' },
	{ value: 'soft', label: 'Soft' }
]);

defineOptions('textCase', [
	{ value: 'none', label: 'As Typed' }, { value: 'upper', label: 'UPPERCASE' },
	{ value: 'lower', label: 'lowercase' }, { value: 'title', label: 'Title Case' },
	{ value: 'alternating', label: 'aLtErNaTiNg' }
]);
defineOptions('textBoxMode', [
	{ value: 'point', label: 'Point', hint: 'Point text hugs the glyphs. Corner handles scale it.' },
	{ value: 'autoHeight', label: 'Auto Height', hint: 'Width stays fixed; height follows the wrapped text.' },
	{ value: 'fixed', label: 'Fixed', hint: 'Text wraps inside the frame. Edge handles resize the box.' }
]);
defineOptions('textAlign', ['left', 'center', 'right', 'justify'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1), icon: value === 'justify' ? 'text-align-left' : `text-align-${value}` })));
defineOptions('textVerticalAlign', ['top', 'middle', 'bottom'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1), icon: `text-align-${value}` })));
