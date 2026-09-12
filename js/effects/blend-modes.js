(function (root) {
	const BLEND_MODES = Object.freeze([
		'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
		'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
		'exclusion', 'hue', 'saturation', 'color', 'luminosity'
	]);

	function isBlendMode(value) {
		return BLEND_MODES.includes(value);
	}

	function normalize(value) {
		return isBlendMode(value) ? value : 'normal';
	}

	function forLayer(layer) {
		return normalize(layer?.blendMode ?? layer?.stickerData?.blendMode);
	}

	function cssToGCO(value) {
		return value === 'normal' ? 'source-over' : (isBlendMode(value) ? value : 'source-over');
	}

	function colorBurn(backdrop, source) {
		if (source === 0) return 0;
		if (backdrop === 255) return 255;
		return Math.round(255 * (1 - Math.min(1, (1 - backdrop / 255) / (source / 255))));
	}

	// Chromium's canvas color-burn mishandles opaque dark pixels when the source
	// is an otherwise-transparent canvas. Composite the isolated layer pixels
	// directly so export matches CSS mix-blend-mode and Photoshop.
	function compositeColorBurn(destination, source) {
		if (!destination?.data || !source?.data || destination.data.length !== source.data.length) return destination;
		for (let offset = 0; offset < destination.data.length; offset += 4) {
			const sourceAlpha = source.data[offset + 3] / 255;
			if (sourceAlpha <= 0) continue;
			const backdropAlpha = destination.data[offset + 3] / 255;
			const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
			for (let channel = 0; channel < 3; channel++) {
				const backdrop = destination.data[offset + channel];
				const sourceColor = source.data[offset + channel];
				const blended = colorBurn(backdrop, sourceColor);
				const premultiplied = sourceAlpha * ((1 - backdropAlpha) * sourceColor + backdropAlpha * blended)
					+ (1 - sourceAlpha) * backdropAlpha * backdrop;
				destination.data[offset + channel] = outputAlpha > 0 ? Math.round(premultiplied / outputAlpha) : 0;
			}
			destination.data[offset + 3] = Math.round(outputAlpha * 255);
		}
		return destination;
	}

	function labelOf(value) {
		return String(value || '').split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
	}

	const api = { BLEND_MODES, isBlendMode, normalize, forLayer, cssToGCO, compositeColorBurn, labelOf };
	root.GlitterBlendModes = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
