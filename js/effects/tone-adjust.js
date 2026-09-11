(function (root) {
	const TONE_IDENTITY = Object.freeze({
		brightness: 1,
		contrast: 1,
		saturate: 1,
		sepia: 0,
		grayscale: 0,
		hueRotate: 0,
		invert: 0
	});
	const ORDER = ['brightness', 'contrast', 'saturate', 'sepia', 'grayscale', 'hueRotate', 'invert'];

	function finite(value, fallback) {
		const number = Number(value);
		return Number.isFinite(number) ? number : fallback;
	}

	function clamp(value, minimum, maximum) {
		return Math.min(maximum, Math.max(minimum, value));
	}

	function normalizeTone(value) {
		const source = value || {};
		const tone = {
			brightness: Math.max(0, finite(source.brightness, 1)),
			contrast: Math.max(0, finite(source.contrast, 1)),
			saturate: Math.max(0, finite(source.saturate ?? source.saturation, 1)),
			sepia: clamp(finite(source.sepia, 0), 0, 1),
			grayscale: clamp(finite(source.grayscale, 0), 0, 1),
			hueRotate: finite(source.hueRotate ?? source.hue, 0),
			invert: clamp(finite(source.invert, 0), 0, 1)
		};
		const aliases = { saturation: 'saturate', hue: 'hueRotate' };
		const requestedOrder = Array.isArray(source.order) ? source.order : Object.keys(source);
		tone.order = [...new Set(requestedOrder.map((key) => aliases[key] || key).filter((key) => ORDER.includes(key)))];
		ORDER.forEach((key) => { if (!tone.order.includes(key)) tone.order.push(key); });
		return tone;
	}

	function isIdentityTone(value) {
		const tone = normalizeTone(value);
		return ORDER.every((key) => tone[key] === TONE_IDENTITY[key]);
	}

	function identityAffine() {
		return { m: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), t: new Float64Array(3) };
	}

	function multiply(left, right) {
		const output = new Float64Array(9);
		for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
			output[row * 3 + column] = left[row * 3] * right[column]
				+ left[row * 3 + 1] * right[3 + column]
				+ left[row * 3 + 2] * right[6 + column];
		}
		return output;
	}

	function matrixFor(key, amount) {
		if (key === 'brightness') return { m: new Float64Array([amount, 0, 0, 0, amount, 0, 0, 0, amount]), t: new Float64Array(3) };
		if (key === 'contrast') return { m: new Float64Array([amount, 0, 0, 0, amount, 0, 0, 0, amount]), t: new Float64Array(3).fill(127.5 * (1 - amount)) };
		if (key === 'invert') return { m: new Float64Array([1 - 2 * amount, 0, 0, 0, 1 - 2 * amount, 0, 0, 0, 1 - 2 * amount]), t: new Float64Array(3).fill(255 * amount) };
		if (key === 'saturate') {
			return { m: new Float64Array([
				0.213 + 0.787 * amount, 0.715 - 0.715 * amount, 0.072 - 0.072 * amount,
				0.213 - 0.213 * amount, 0.715 + 0.285 * amount, 0.072 - 0.072 * amount,
				0.213 - 0.213 * amount, 0.715 - 0.715 * amount, 0.072 + 0.928 * amount
			]), t: new Float64Array(3) };
		}
		if (key === 'grayscale') {
			const gray = matrixFor('saturate', 0).m;
			const m = new Float64Array(9);
			for (let index = 0; index < 9; index++) m[index] = (index % 4 === 0 ? 1 : 0) * (1 - amount) + gray[index] * amount;
			return { m, t: new Float64Array(3) };
		}
		if (key === 'sepia') {
			const sepia = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
			const m = new Float64Array(9);
			for (let index = 0; index < 9; index++) m[index] = (index % 4 === 0 ? 1 : 0) * (1 - amount) + sepia[index] * amount;
			return { m, t: new Float64Array(3) };
		}
		const radians = amount * Math.PI / 180;
		const cosine = Math.cos(radians);
		const sine = Math.sin(radians);
		return { m: new Float64Array([
			0.213 + cosine * 0.787 - sine * 0.213, 0.715 - cosine * 0.715 - sine * 0.715, 0.072 - cosine * 0.072 + sine * 0.928,
			0.213 - cosine * 0.213 + sine * 0.143, 0.715 + cosine * 0.285 + sine * 0.140, 0.072 - cosine * 0.072 - sine * 0.283,
			0.213 - cosine * 0.213 - sine * 0.787, 0.715 - cosine * 0.715 + sine * 0.715, 0.072 + cosine * 0.928 + sine * 0.072
		]), t: new Float64Array(3) };
	}

	function composeToneAffine(value) {
		const tone = normalizeTone(value);
		let result = identityAffine();
		for (const key of tone.order) {
			if (tone[key] === TONE_IDENTITY[key]) continue;
			const operation = matrixFor(key, tone[key]);
			const transformedOffset = new Float64Array(3);
			for (let row = 0; row < 3; row++) transformedOffset[row] = operation.m[row * 3] * result.t[0]
				+ operation.m[row * 3 + 1] * result.t[1] + operation.m[row * 3 + 2] * result.t[2] + operation.t[row];
			result = { m: multiply(operation.m, result.m), t: transformedOffset };
		}
		return result;
	}

	function applyToneToImageData(imageData, value, alphaThreshold = 0) {
		if (isIdentityTone(value)) return imageData;
		const { m, t } = composeToneAffine(value);
		const data = imageData.data;
		for (let index = 0; index < data.length; index += 4) {
			if (data[index + 3] < alphaThreshold) continue;
			const red = data[index];
			const green = data[index + 1];
			const blue = data[index + 2];
			data[index] = Math.round(clamp(m[0] * red + m[1] * green + m[2] * blue + t[0], 0, 255));
			data[index + 1] = Math.round(clamp(m[3] * red + m[4] * green + m[5] * blue + t[1], 0, 255));
			data[index + 2] = Math.round(clamp(m[6] * red + m[7] * green + m[8] * blue + t[2], 0, 255));
		}
		return imageData;
	}

	function toneCssFilterString(value) {
		const tone = normalizeTone(value);
		const units = { brightness: '', contrast: '', saturate: '', sepia: '', grayscale: '', hueRotate: 'deg', invert: '' };
		const names = { saturate: 'saturate', hueRotate: 'hue-rotate' };
		return tone.order.filter((key) => tone[key] !== TONE_IDENTITY[key])
			.map((key) => `${names[key] || key}(${tone[key]}${units[key]})`).join(' ');
	}

	const api = { TONE_IDENTITY, normalizeTone, isIdentityTone, composeToneAffine, applyToneToImageData, toneCssFilterString };
	root.GlitterToneAdjust = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
