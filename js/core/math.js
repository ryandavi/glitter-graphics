'use strict';

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value) {
	return clamp(Number(value) || 0, 0, 1);
}

function lerp(start, end, amount) {
	return start + (end - start) * amount;
}

function clampNumber(value, minimum, maximum, fallback = minimum, integer = false) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	const result = clamp(numeric, minimum, maximum);
	return integer ? Math.round(result) : result;
}

function roundTo(value, step = 1) {
	return Math.round(value / step) * step;
}

const GlitterMath = Object.freeze({ clamp, clamp01, lerp, clampNumber, roundTo });
if (typeof globalThis !== 'undefined') globalThis.GlitterMath = GlitterMath;

if (typeof module !== 'undefined' && module.exports) {
	module.exports = GlitterMath;
}
