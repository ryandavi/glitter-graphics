(function (root) {
	const BLUR_IDENTITY = Object.freeze({ radius: 0 });

	function normalizeBlur(value) {
		return { radius: Math.max(0, Number(value?.radius) || 0) };
	}

	function isIdentityBlur(value) {
		return normalizeBlur(value).radius <= 0;
	}

	function cssBlurString(value, viewScale = 1) {
		const radius = normalizeBlur(value).radius * (Number(viewScale) || 1);
		return radius > 0 ? `blur(${radius}px)` : '';
	}

	function boxPass(source, target, width, height, radius, horizontal) {
		const span = radius * 2 + 1;
		const outer = horizontal ? height : width;
		const inner = horizontal ? width : height;
		for (let line = 0; line < outer; line++) {
			const totals = [0, 0, 0, 0];
			for (let sample = -radius; sample <= radius; sample++) {
				const position = Math.min(inner - 1, Math.max(0, sample));
				const offset = horizontal ? (line * width + position) * 4 : (position * width + line) * 4;
				const alpha = source[offset + 3] / 255;
				for (let channel = 0; channel < 3; channel++) totals[channel] += source[offset + channel] * alpha;
				totals[3] += source[offset + 3];
			}
			for (let position = 0; position < inner; position++) {
				const offset = horizontal ? (line * width + position) * 4 : (position * width + line) * 4;
				const alpha = totals[3] / span;
				target[offset + 3] = Math.round(alpha);
				for (let channel = 0; channel < 3; channel++) target[offset + channel] = alpha > 0 ? Math.round((totals[channel] / span) * 255 / alpha) : 0;
				const removePosition = Math.min(inner - 1, Math.max(0, position - radius));
				const addPosition = Math.min(inner - 1, Math.max(0, position + radius + 1));
				const remove = horizontal ? (line * width + removePosition) * 4 : (removePosition * width + line) * 4;
				const add = horizontal ? (line * width + addPosition) * 4 : (addPosition * width + line) * 4;
				const removeAlpha = source[remove + 3] / 255;
				const addAlpha = source[add + 3] / 255;
				for (let channel = 0; channel < 3; channel++) totals[channel] += source[add + channel] * addAlpha - source[remove + channel] * removeAlpha;
				totals[3] += source[add + 3] - source[remove + 3];
			}
		}
	}

	function applyBlurToImageData(imageData, radius) {
		const sigma = Math.max(0, Number(radius) || 0);
		if (!sigma) return imageData;
		const passes = 3;
		let lowerWidth = Math.floor(Math.sqrt(12 * sigma * sigma / passes + 1));
		if (lowerWidth % 2 === 0) lowerWidth--;
		const upperWidth = lowerWidth + 2;
		const upperPasses = Math.round((12 * sigma * sigma - passes * lowerWidth * lowerWidth - 4 * passes * lowerWidth - 3 * passes) / (-4 * lowerWidth - 4));
		const radii = Array.from({ length: passes }, (_, index) => Math.max(0, Math.round(((index < upperPasses ? lowerWidth : upperWidth) - 1) / 2)));
		let source = new Uint8ClampedArray(imageData.data);
		let horizontal = new Uint8ClampedArray(source.length);
		let vertical = new Uint8ClampedArray(source.length);
		for (const size of radii) {
			if (!size) continue;
			boxPass(source, horizontal, imageData.width, imageData.height, size, true);
			boxPass(horizontal, vertical, imageData.width, imageData.height, size, false);
			[source, vertical] = [vertical, source];
		}
		imageData.data.set(source);
		return imageData;
	}

	const api = { BLUR_IDENTITY, normalizeBlur, isIdentityBlur, cssBlurString, applyBlurToImageData };
	root.GlitterBlur = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
