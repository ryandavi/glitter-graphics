(function (root) {
	const BLEND_MODES = Object.freeze([
		'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
		'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
		'exclusion', 'hue', 'saturation', 'color', 'luminosity'
	]);

	function isBlendMode(value) {
		return BLEND_MODES.includes(value);
	}

	function cssToGCO(value) {
		return value === 'normal' ? 'source-over' : (isBlendMode(value) ? value : 'source-over');
	}

	function labelOf(value) {
		return String(value || '').split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
	}

	const api = { BLEND_MODES, isBlendMode, cssToGCO, labelOf };
	root.GlitterBlendModes = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
