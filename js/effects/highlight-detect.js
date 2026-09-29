(function (root) {
	'use strict';

	// Finds the bright specks a Kira Kira sparkle sits on. DOM-free so a worker
	// can import it. Input is RGBA pixels; transparent pixels count as dark, so
	// a sticker's bright edge against its transparent surround still reads as a
	// highlight.
	//
	// score = brightness x local contrast x peakiness x seeded jitter
	//   local contrast: L minus the mean of a wide neighbourhood. A white speck
	//     on a dark CD scores high; the middle of a white wall scores ~0.
	//   peakiness: the small-radius mean minus the wide mean, so small bright
	//     blobs beat large bright areas.
	// Candidates are local maxima above a threshold that Sensitivity lowers. A
	// greedy minimum-distance pass (radius varied +-30% per pick) keeps them
	// irregular but never clustered, and never on a grid.

	const WIDE_RADIUS_FRACTION = 1 / 24;
	const THRESHOLD_MAX = 0.3;
	const THRESHOLD_MIN = 0.015;
	const STRENGTH_SPAN = 0.9;

	function luminance(data, width, height) {
		const out = new Float32Array(width * height);
		for (let i = 0, p = 0; i < out.length; i++, p += 4) {
			out[i] = (0.21 * data[p] + 0.72 * data[p + 1] + 0.07 * data[p + 2]) / 255 * (data[p + 3] / 255);
		}
		return out;
	}

	// Summed-area table with a zero row and column, so any box mean costs four
	// reads whatever its radius.
	function integral(values, width, height) {
		const stride = width + 1;
		const table = new Float64Array(stride * (height + 1));
		for (let y = 0; y < height; y++) {
			let row = 0;
			for (let x = 0; x < width; x++) {
				row += values[y * width + x];
				table[(y + 1) * stride + x + 1] = table[y * stride + x + 1] + row;
			}
		}
		return table;
	}

	function boxMean(table, width, height, x, y, radius) {
		const stride = width + 1;
		const x0 = Math.max(0, x - radius);
		const y0 = Math.max(0, y - radius);
		const x1 = Math.min(width, x + radius + 1);
		const y1 = Math.min(height, y + radius + 1);
		const sum = table[y1 * stride + x1] - table[y0 * stride + x1] - table[y1 * stride + x0] + table[y0 * stride + x0];
		return sum / ((x1 - x0) * (y1 - y0));
	}

	function thresholdFor(sensitivity) {
		const t = Math.max(0, Math.min(100, Number(sensitivity) || 0)) / 100;
		return THRESHOLD_MAX * Math.pow(1 - t, 1.6) + THRESHOLD_MIN;
	}

	// pixels: { data, width, height }. options.random is a seeded 0..1
	// generator (GlitterAnimation.mulberry32), so a layout repeats exactly.
	// Returns [{ x, y, strength }] in pixel units of the input, strongest
	// first, strength 0..1.
	function detect(pixels, options = {}) {
		const { data, width, height } = pixels || {};
		if (!data || !width || !height) return [];
		const maxCount = Math.max(0, Math.floor(Number(options.maxCount) || 0));
		if (!maxCount) return [];
		if (typeof options.random !== 'function') throw new Error('highlight-detect: options.random is required');
		const spacing = Math.max(1, Number(options.spacing) || 1);
		const random = options.random;
		const threshold = thresholdFor(options.sensitivity);
		const L = luminance(data, width, height);
		const table = integral(L, width, height);
		const wide = Math.max(3, Math.round(Math.min(width, height) * WIDE_RADIUS_FRACTION));
		const score = new Float32Array(width * height);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const i = y * width + x;
				const l = L[i];
				if (l <= 0) continue;
				const wideMean = boxMean(table, width, height, x, y, wide);
				const contrast = l - wideMean;
				if (contrast <= 0) continue;
				const peak = boxMean(table, width, height, x, y, 1) - wideMean;
				if (peak <= 0) continue;
				score[i] = l * Math.sqrt(contrast * peak);
			}
		}

		const candidates = [];
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const i = y * width + x;
				const value = score[i];
				if (value <= threshold) continue;
				let isPeak = true;
				for (let dy = -1; dy <= 1 && isPeak; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						if (!dx && !dy) continue;
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
						const neighbour = score[ny * width + nx];
						// Plateaus keep their first pixel in scan order.
						if (neighbour > value || (neighbour === value && ny * width + nx < i)) { isPeak = false; break; }
					}
				}
				if (isPeak) candidates.push({ x, y, value });
			}
		}
		candidates.sort((a, b) => b.value - a.value || a.y - b.y || a.x - b.x);

		const picked = [];
		for (const candidate of candidates) {
			if (picked.length >= maxCount) break;
			// Not every valid highlight sparkles.
			const jittered = candidate.value * (0.75 + 0.25 * random());
			if (jittered <= threshold) continue;
			const blocked = picked.some((other) => {
				const dx = other.x - candidate.x;
				const dy = other.y - candidate.y;
				return dx * dx + dy * dy < other.radius * other.radius;
			});
			if (blocked) continue;
			picked.push({
				x: Math.max(0, Math.min(width - 1, candidate.x + Math.round((random() - 0.5) * 2))),
				y: Math.max(0, Math.min(height - 1, candidate.y + Math.round((random() - 0.5) * 2))),
				radius: spacing * (0.7 + 0.6 * random()),
				strength: Math.max(0, Math.min(1, (jittered - threshold) / STRENGTH_SPAN))
			});
		}
		return picked.map(({ x, y, strength }) => ({ x, y, strength }));
	}

	// Per-pixel mean of several same-size RGBA frames, so an animated host is
	// detected on its persistently bright spots and flicker is ignored.
	function meanFrames(frames) {
		const first = frames?.[0];
		if (!first) return null;
		const { width, height } = first;
		const sum = new Float32Array(width * height * 4);
		frames.forEach((frame) => {
			for (let i = 0; i < sum.length; i++) sum[i] += frame.data[i];
		});
		const data = new Uint8ClampedArray(sum.length);
		for (let i = 0; i < sum.length; i++) data[i] = Math.round(sum[i] / frames.length);
		return { data, width, height };
	}

	const api = { detect, meanFrames, thresholdFor };
	root.GlitterHighlightDetect = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
