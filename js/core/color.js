'use strict';

function hexToRgb(value) {
	const normalized = String(value).replace(/^#/, '').toLowerCase();
	if (!/^[0-9a-f]{6}$/.test(normalized)) throw new Error('Enter a six-digit hex color');
	return [0, 2, 4].map(offset => parseInt(normalized.slice(offset, offset + 2), 16));
}

function rgbToHex(rgb) {
	return '#' + rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('');
}

const GlitterColor = Object.freeze({ hexToRgb, rgbToHex });
if (typeof globalThis !== 'undefined') globalThis.GlitterColor = GlitterColor;
if (typeof module !== 'undefined' && module.exports) module.exports = GlitterColor;
