'use strict';

const ANCHOR_POINTS = Object.freeze([
	{ id: 'top-left', fx: 0, fy: 0, label: 'Top left' },
	{ id: 'top-center', fx: 0.5, fy: 0, label: 'Top' },
	{ id: 'top-right', fx: 1, fy: 0, label: 'Top right' },
	{ id: 'center-left', fx: 0, fy: 0.5, label: 'Left' },
	{ id: 'center', fx: 0.5, fy: 0.5, label: 'Center' },
	{ id: 'center-right', fx: 1, fy: 0.5, label: 'Right' },
	{ id: 'bottom-left', fx: 0, fy: 1, label: 'Bottom left' },
	{ id: 'bottom-center', fx: 0.5, fy: 1, label: 'Bottom' },
	{ id: 'bottom-right', fx: 1, fy: 1, label: 'Bottom right' }
].map(Object.freeze));

const OPTION_REGISTRY = Object.create(null);

const ANIMATION_EASING_OPTIONS = [
	{ value: 'linear', label: 'Linear', shape: 'diamond' }, { value: 'ease', label: 'Ease', shape: 'rounded' }, { value: 'easeIn', label: 'Ease in', shape: 'rounded' },
	{ value: 'easeOut', label: 'Ease out', shape: 'rounded' }, { value: 'easeInOut', label: 'Ease in-out', shape: 'rounded' },
	{ value: 'bounceOut', label: 'Bounce out', shape: 'rounded' }, { value: 'elasticOut', label: 'Elastic out', shape: 'rounded' }, { value: 'steps', label: 'Steps', shape: 'square' }
];

const ANIMATION_DIRECTION_OPTIONS = defineOptions('animationDirection', [
	{ value: 'normal', label: 'Normal' }, { value: 'reverse', label: 'Reverse' },
	{ value: 'alternate', label: 'Ping-pong' }, { value: 'alternate-reverse', label: 'Reverse ping-pong' }
]);

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

// A stroke's joins reuse borderEdgeStyle (Smooth, Sharp); these are its own.
defineOptions('strokeCap', [
	{ value: 'flat', label: 'Flat', suffix: 'CapFlat', icon: 'cap-flat' },
	{ value: 'round', label: 'Round', suffix: 'CapRound', icon: 'cap-round' },
	{ value: 'square', label: 'Square', suffix: 'CapSquare', icon: 'cap-square' }
]);
defineOptions('strokeDashStyle', [
	{ value: 'solid', label: 'Solid', suffix: 'DashSolid' },
	{ value: 'dashed', label: 'Dashed', suffix: 'DashDashed' },
	{ value: 'dotted', label: 'Dotted', suffix: 'DashDotted' }
]);
defineOptions('pathPointType', [
	{ value: 'corner', label: 'Corner', icon: 'point-corner' },
	{ value: 'smooth', label: 'Smooth', icon: 'point-smooth' },
	{ value: 'mirrored', label: 'Mirrored', icon: 'point-mirrored' }
]);

defineOptions('paintMode', [
	{ value: 'none', label: 'None' },
	{ value: 'solid', label: 'Color' },
	{ value: 'gradient', label: 'Gradient' },
	{ value: 'pattern', label: 'Pattern' },
	{ value: 'glitter', label: 'Glitter' },
	{ value: 'image', label: 'Image' }
]);
const STANDARD_PAINT_MODES = Object.freeze(['glitter', 'solid', 'gradient', 'pattern']);
defineOptions('patternType', [
	{ value: 'checker', label: 'Checker' }, { value: 'gingham', label: 'Gingham' },
	{ value: 'grid', label: 'Grid' }, { value: 'brick', label: 'Brick' },
	{ value: 'stripes', label: 'Stripes' }, { value: 'zigzag', label: 'Zigzag' },
	{ value: 'motif', label: 'Motif' }
]);
defineOptions('patternTileType', [
	{ value: 'grid', label: 'Grid' }, { value: 'brick-row', label: 'Brick by row' },
	{ value: 'brick-column', label: 'Brick by column' }, { value: 'hex-row', label: 'Hex by row' },
	{ value: 'hex-column', label: 'Hex by column' }
]);
defineOptions('patternBrickOffset', [
	{ value: '0.5', label: '1/2' }, { value: '0.3333333333333333', label: '1/3' },
	{ value: '0.6666666666666666', label: '2/3' }, { value: '0.25', label: '1/4' }, { value: '0.75', label: '3/4' }
]);
defineOptions('patternOverlap', [
	{ value: 'row', label: 'Lower rows in front' }, { value: 'row-reverse', label: 'Upper rows in front' },
	{ value: 'column', label: 'Right columns in front' }, { value: 'column-reverse', label: 'Left columns in front' }
]);
defineOptions('patternDirection', [
	{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' },
	{ value: 'diagonal-up', label: 'Diagonal up' }, { value: 'diagonal-down', label: 'Diagonal down' }
]);
defineOptions('patternScroll', [
	{ value: 'none', label: 'Off', x: 0, y: 0 },
	{ value: 'up', label: 'Up', x: 0, y: -1 }, { value: 'down', label: 'Down', x: 0, y: 1 },
	{ value: 'left', label: 'Left', x: -1, y: 0 }, { value: 'right', label: 'Right', x: 1, y: 0 },
	{ value: 'up-left', label: 'Up left', x: -1, y: -1 }, { value: 'up-right', label: 'Up right', x: 1, y: -1 },
	{ value: 'down-left', label: 'Down left', x: -1, y: 1 }, { value: 'down-right', label: 'Down right', x: 1, y: 1 }
]);
defineOptions('paletteStyle', [
	{ value: 'vivid', label: 'Vivid Web' },
	{ value: 'balanced', label: 'Balanced' },
	{ value: 'natural', label: 'Natural' },
	{ value: 'websafe', label: 'Web Safe' }
]);
defineOptions('analysisPaletteStyle', [
	{ value: 'natural', label: 'Natural' },
	{ value: 'vibrant', label: 'Vibrant' }
]);
defineOptions('gifLook', [
	{ value: 'clean', label: 'Clean · Automatic' },
	{ value: 'classic', label: 'Classic Web' },
	{ value: 'textured', label: 'Textured' },
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
defineOptions('textOrientation', [
	{ value: 'horizontal', label: 'Horizontal' },
	{ value: 'stacked', label: 'Stacked' }
]);
defineOptions('textBoxMode', [
	{ value: 'point', label: 'Point', hint: 'Point text hugs the glyphs. Corner handles scale it.' },
	{ value: 'autoHeight', label: 'Auto Height', hint: 'Width stays fixed; height follows the wrapped text.' },
	{ value: 'fixed', label: 'Fixed', hint: 'Text wraps inside the frame. Edge handles resize the box.' }
]);
defineOptions('textAlign', ['left', 'center', 'right', 'justify'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1), icon: `text-align-${value}` })));
defineOptions('textVerticalAlign', ['top', 'middle', 'bottom'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1), icon: `text-align-${value}` })));

if (typeof module !== 'undefined' && module.exports) module.exports = { ANCHOR_POINTS };

function parseAnchorValue(value) {
	const point = ANCHOR_POINTS.find((point) => `${point.fx},${point.fy}` === value);
	return point ? { fx: point.fx, fy: point.fy } : null;
}
