'use strict';

// Recoloring changes palette bytes only: image indexes, timing and disposal
// remain the source GIF's. The same file serves preview and export.
(function (root) {
	const Color = root.GlitterColor || (typeof require === 'function' ? require('../core/color.js') : null);
	const hex = rgb => Color.rgbToHex(rgb).slice(1);
	const rgb = Color.hexToRgb;
	function analyze(bytes) {
		const reader = new root.GifReader(bytes);
		if (!reader.numFrames()) throw new Error('GIF has no frames');
		const tables = new Map();
		const counts = new Map();
		let hasTransparency = false;
		for (let frame = 0; frame < reader.numFrames(); frame++) {
			const info = reader.frameInfo(frame);
			let table = tables.get(info.palette_offset);
			if (!table) {
				table = { offset: info.palette_offset, size: info.palette_size, opaque: new Set() };
				tables.set(table.offset, table);
			}
			// A shared table index may be transparent in one frame and opaque in
			// another. Patch it if any frame uses it opaquely; alpha is an index.
			for (let index = 0; index < table.size; index++) if (index !== info.transparent_index) table.opaque.add(index);
			const pixels = new Uint8Array(reader.width * reader.height * 4);
			reader.decodeAndBlitFrameRGBA(frame, pixels);
			for (let offset = 0; offset < pixels.length; offset += 4) {
				if (!pixels[offset + 3]) { hasTransparency = true; continue; }
				const key = hex(Array.from(pixels.subarray(offset, offset + 3)));
				counts.set(key, (counts.get(key) || 0) + 1);
			}
		}
		const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
		const swatches = [...counts].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count, share: count / total }));
		return { width: reader.width, height: reader.height, frameCount: reader.numFrames(), hasTransparency, tables: [...tables.values()], swatches };
	}
	function apply(bytes, colors, analysis = analyze(bytes)) {
		const output = new Uint8Array(bytes);
		const mapping = new Map(Object.entries(colors).map(([key, value]) => [hex(rgb(key)), rgb(value)]));
		for (const table of analysis.tables) for (const index of table.opaque) {
			const offset = table.offset + index * 3;
			const target = mapping.get(hex(Array.from(bytes.subarray(offset, offset + 3))));
			if (target) output.set(target, offset);
		}
		return output;
	}
	const lch = (value) => {
		const [lightness, a, b] = root.GlitterPaletteAnalysis.rgbToOklab(...rgb(value));
		return [lightness, Math.hypot(a, b), Math.atan2(b, a)];
	};
	function fromLch(lightness, chroma, hue) {
		const l = Math.max(0, Math.min(1, lightness));
		const linearRgb = (c) => {
			const a = c * Math.cos(hue), b = c * Math.sin(hue);
			const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
			const m = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
			const s = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
			return [4.0767416621 * ll - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * ll + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * ll - 0.7034186147 * m + 1.707614701 * s];
		};
		const inGamut = channels => channels.every(channel => channel >= -1e-7 && channel <= 1 + 1e-7);
		let channels = linearRgb(Math.max(0, chroma));
		if (!inGamut(channels)) {
			let low = 0, high = Math.max(0, chroma);
			for (let step = 0; step < 24; step++) {
				const middle = (low + high) / 2;
				if (inGamut(linearRgb(middle))) low = middle;
				else high = middle;
			}
			channels = linearRgb(low);
		}
		return hex(channels.map(channel => 255 * (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055)).map(channel => Math.max(0, Math.min(255, channel))));
	}
	function adjust(colors, swatches, { hue = 0, saturation = 0, lightness = 0, contrast = 0 } = {}) {
		if (!hue && !saturation && !lightness && !contrast) return { ...colors };
		const entries = swatches.map(swatch => ({ ...swatch, lch: lch(colors[swatch.key] || swatch.key) }));
		const mean = entries.reduce((sum, entry) => sum + entry.lch[0] * entry.share, 0);
		return Object.fromEntries(entries.map(entry => {
			const [l, c, h] = entry.lch;
			return [entry.key, fromLch(mean + (l - mean) * (1 + contrast / 100) + lightness / 100, c * (1 + saturation / 100), h + hue * Math.PI / 180)];
		}));
	}
	function shiftAll(colors, swatches, target) {
		const dominant = swatches[0].key;
		const delta = lch(target)[2] - lch(colors[dominant] || dominant)[2];
		const shifted = Object.fromEntries(swatches.map(({ key }) => {
			const [l, c, h] = lch(colors[key] || key);
			return [key, fromLch(l, c, h + delta)];
		}));
		shifted[dominant] = hex(rgb(target));
		return shifted;
	}
	function paletteTags(swatches, options) {
		const weights = new Map();
		for (const swatch of swatches) {
			const [r, g, b] = rgb(swatch.key), max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
			let family = 'neutral';
			if (max && delta / max >= options.neutralSaturation) {
				const sector = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
				const hue = (sector * 60 + 360) % 360;
				family = hue < 15 || hue >= 345 ? 'red' : hue < 45 ? 'orange' : hue < 75 ? 'yellow' : hue < 165 ? 'green' : hue < 255 ? 'blue' : hue < 315 ? 'purple' : 'pink';
			}
			weights.set(family, (weights.get(family) || 0) + swatch.share);
		}
		return [...weights].filter(([, share]) => share >= options.colorTagMinShare).map(([family]) => family);
	}
	const api = { analyze, apply, hex, rgb, lch, fromLch, adjust, shiftAll, paletteTags };
	root.GlitterRecolor = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
