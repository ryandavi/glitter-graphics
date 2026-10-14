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

function indexAtOrBefore(sorted, value, epsilon = 1e-6) {
	let low = 0, high = sorted.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (sorted[middle] <= value + epsilon) low = middle + 1;
		else high = middle;
	}
	return low - 1;
}

function isSameData(a, b) {
	if (a === b) return true;
	if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && isSameData(a[key], b[key]));
}

const GlitterMath = Object.freeze({ clamp, clamp01, lerp, clampNumber, roundTo, indexAtOrBefore, isSameData });
if (typeof globalThis !== 'undefined') globalThis.GlitterMath = GlitterMath;

if (typeof module !== 'undefined' && module.exports) {
	module.exports = GlitterMath;
}
