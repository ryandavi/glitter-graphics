// Shared, deterministic pixel pipeline for Base Image preview and export.
// Pure pixel math keeps Safari/iOS support and makes both renderers byte-equal.
(function (root) {
	const PaletteAnalysis = root.GlitterPaletteAnalysis || (typeof require === 'function' ? require('./palette-analysis.js') : null);
	const BAYER_8 = [
		0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31,
		8, 56, 4, 52, 11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23,
		2, 50, 14, 62, 1, 49, 13, 61, 34, 18, 46, 30, 33, 17, 45, 29,
		10, 58, 6, 54, 9, 57, 5, 53, 42, 26, 38, 22, 41, 25, 37, 21
	];

	function clamp(value, minimum, maximum) {
		return Math.min(maximum, Math.max(minimum, value));
	}

	function finiteNumber(value, fallback) {
		if (value == null || value === '') return fallback;
		const number = Number(value);
		return Number.isFinite(number) ? number : fallback;
	}

	function hexToRgb(value) {
		const hex = String(value || '#000000').replace('#', '');
		return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) || 0);
	}

	function colorDistance(left, right) {
		const dr = left[0] - right[0];
		const dg = left[1] - right[1];
		const db = left[2] - right[2];
		return dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
	}

	function nearestColorIndex(color, palette) {
		let best = 0;
		let distance = Infinity;
		for (let index = 0; index < palette.length; index++) {
			const next = colorDistance(color, palette[index]);
			if (next < distance) {
				distance = next;
				best = index;
			}
		}
		return best;
	}

	function pixelize(source, width, height, pixelSize) {
		const size = clamp(Math.round(pixelSize), 1, 64);
		const output = new Uint8ClampedArray(source);
		if (size === 1) return output;
		for (let y = 0; y < height; y += size) {
			for (let x = 0; x < width; x += size) {
				const sampleX = Math.min(width - 1, x + Math.floor(size / 2));
				const sampleY = Math.min(height - 1, y + Math.floor(size / 2));
				const sample = (sampleY * width + sampleX) * 4;
				for (let py = y; py < Math.min(height, y + size); py++) {
					for (let px = x; px < Math.min(width, x + size); px++) {
						const offset = (py * width + px) * 4;
						output[offset] = source[sample];
						output[offset + 1] = source[sample + 1];
						output[offset + 2] = source[sample + 2];
						output[offset + 3] = source[offset + 3];
					}
				}
			}
		}
		return output;
	}

	function downsampleCells(source, width, height, pixelSize) {
		const size = Math.max(1, Math.round(pixelSize));
		const reducedWidth = Math.ceil(width / size);
		const reducedHeight = Math.ceil(height / size);
		const pixels = new Uint8ClampedArray(reducedWidth * reducedHeight * 4);
		for (let y = 0; y < reducedHeight; y++) for (let x = 0; x < reducedWidth; x++) {
			const sampleX = Math.min(width - 1, x * size + Math.floor(size / 2));
			const sampleY = Math.min(height - 1, y * size + Math.floor(size / 2));
			const sample = (sampleY * width + sampleX) * 4;
			const offset = (y * reducedWidth + x) * 4;
			pixels[offset] = source[sample];
			pixels[offset + 1] = source[sample + 1];
			pixels[offset + 2] = source[sample + 2];
			pixels[offset + 3] = source[sample + 3];
		}
		return { pixels, width: reducedWidth, height: reducedHeight };
	}

	function upscaleCells(reduced, reducedWidth, source, width, height, pixelSize) {
		const size = Math.max(1, Math.round(pixelSize));
		const output = new Uint8ClampedArray(source.length);
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			const sample = (Math.floor(y / size) * reducedWidth + Math.floor(x / size)) * 4;
			output[offset] = reduced[sample];
			output[offset + 1] = reduced[sample + 1];
			output[offset + 2] = reduced[sample + 2];
			output[offset + 3] = source[offset + 3];
		}
		return output;
	}

	function buildAutoPalette(source, colorCount, settings) {
		const visible = [];
		const maxSamples = settings.maxSamples;
		let visibleCount = 0;
		for (let offset = 0; offset < source.length; offset += 4) if (source[offset + 3] > 0) visibleCount++;
		if (!visibleCount) return [[0, 0, 0]];
		const step = Math.max(1, Math.ceil(visibleCount / maxSamples));
		let cursor = 0;
		for (let offset = 0; offset < source.length; offset += 4) {
			if (!source[offset + 3]) continue;
			if (cursor++ % step === 0) visible.push([source[offset], source[offset + 1], source[offset + 2]]);
		}
		const count = Math.min(Math.max(2, Math.round(colorCount)), visible.length);
		const centroids = [visible[Math.floor(visible.length / 2)].slice()];
		while (centroids.length < count) {
			let candidate = visible[0];
			let farthest = -1;
			for (const color of visible) {
				const distance = Math.min(...centroids.map((centroid) => colorDistance(color, centroid)));
				if (distance > farthest) { farthest = distance; candidate = color; }
			}
			centroids.push(candidate.slice());
		}
		for (let iteration = 0; iteration < settings.iterations; iteration++) {
			const totals = centroids.map(() => [0, 0, 0, 0]);
			for (const color of visible) {
				const index = nearestColorIndex(color, centroids);
				const chroma = Math.max(...color) - Math.min(...color);
				const styleWeight = settings.paletteStyle === 'vibrant' ? 1 + chroma / 255 : (settings.paletteStyle === 'natural' ? 1 : 1 + chroma / 510);
				for (let channel = 0; channel < 3; channel++) totals[index][channel] += color[channel] * styleWeight;
				totals[index][3] += styleWeight;
			}
			for (let index = 0; index < centroids.length; index++) if (totals[index][3]) {
				for (let channel = 0; channel < 3; channel++) centroids[index][channel] = totals[index][channel] / totals[index][3];
			}
		}
		const distinctness = Number(settings.mergeDistinctness);
		for (let left = centroids.length - 1; left > 0; left--) {
			for (let right = 0; right < left; right++) {
				if (colorDistance(centroids[left], centroids[right]) <= Math.pow(distinctness * 255, 2)) {
					centroids.splice(left, 1);
					break;
				}
			}
		}
		return centroids.map((color) => color.map(Math.round));
	}

	function flatten(source, labels, palette) {
		const output = new Uint8ClampedArray(source.length);
		for (let index = 0; index < labels.length; index++) {
			const offset = index * 4;
			const label = labels[index];
			if (label !== 255) {
				output[offset] = Math.round(palette[label][0] ?? palette[label].r);
				output[offset + 1] = Math.round(palette[label][1] ?? palette[label].g);
				output[offset + 2] = Math.round(palette[label][2] ?? palette[label].b);
			}
			output[offset + 3] = source[offset + 3];
		}
		return output;
	}

	function buildLabels(source, width, height, palette, settings) {
		const labels = new Uint8Array(width * height);
		labels.fill(255);
		for (let index = 0; index < labels.length; index++) {
			const offset = index * 4;
			if (source[offset + 3]) labels[index] = nearestColorIndex([source[offset], source[offset + 1], source[offset + 2]], palette);
		}
		if (!settings.cleanEdges || settings.detail <= 1) return labels;
		const visited = new Uint8Array(labels.length);
		const queue = new Int32Array(labels.length);
		for (let start = 0; start < labels.length; start++) {
			const label = labels[start];
			if (label === 255 || visited[start]) continue;
			let head = 0;
			let tail = 1;
			queue[0] = start;
			visited[start] = 1;
			const neighbors = new Uint32Array(palette.length);
			while (head < tail) {
				const index = queue[head++];
				const x = index % width;
				const adjacent = [];
				if (x) adjacent.push(index - 1);
				if (x + 1 < width) adjacent.push(index + 1);
				if (index >= width) adjacent.push(index - width);
				if (index + width < labels.length) adjacent.push(index + width);
				for (const neighbor of adjacent) {
					if (labels[neighbor] === label && !visited[neighbor]) { visited[neighbor] = 1; queue[tail++] = neighbor; }
					else if (labels[neighbor] !== 255 && labels[neighbor] !== label) neighbors[labels[neighbor]]++;
				}
			}
			if (tail >= settings.detail) continue;
			let target = 255;
			for (let index = 0; index < neighbors.length; index++) if (neighbors[index] > (target === 255 ? 0 : neighbors[target])) target = index;
			if (target !== 255) for (let index = 0; index < tail; index++) labels[queue[index]] = target;
		}
		return labels;
	}

	function getSharedAnalysisOptions(settings, autoConfig, cleanup) {
		return {
			...autoConfig.analysis,
			...autoConfig.paletteStyles[settings.paletteStyle],
			mergeDistinctness: settings.mergeDistinctness,
			tuneGlitterHue: false,
			maxSamples: autoConfig.limits.maxSamples,
			cleanup: {
				aliasDissolve: { ...autoConfig.cleanup.aliasDissolve, enabled: cleanup && settings.cleanEdges },
				despeckle: { ...autoConfig.cleanup.despeckle, enabled: cleanup && autoConfig.cleanup.despeckle.enabled, absMin: settings.detail }
			}
		};
	}

	function analyzeShared(source, width, height, settings, autoConfig, cleanup) {
		const options = getSharedAnalysisOptions(settings, autoConfig, cleanup);
		const segment = PaletteAnalysis.segmentImage(source, width, height, options);
		return PaletteAnalysis.reduceSegment(segment, settings.colorCount, options);
	}

	function getPalette(source, width, height, settings, config) {
		const pixelConfig = config.pixelEffects || config;
		const selection = settings.dither.palette;
		if (selection === 'duotone') return settings.dither.duotone.map(hexToRgb);
		if (selection !== 'auto') return (pixelConfig.presets[selection] || pixelConfig.presets.bw).map(hexToRgb);
		if (config.autoGlitter && PaletteAnalysis) {
			return analyzeShared(source, width, height, settings, config.autoGlitter, false).palette.map((entry) => [entry.r, entry.g, entry.b]);
		}
		return buildAutoPalette(source, settings.colorCount, { ...settings, maxSamples: pixelConfig.analysis.maxSamples, iterations: pixelConfig.analysis.iterations });
	}

	function normalizeSettings(value, config) {
		const defaults = config.defaults;
		const source = value || {};
		const legacy = source.enabled == null ? null : source;
		const dither = { ...defaults.dither, ...(source.dither || {}) };
		const duotone = Array.isArray(dither.duotone) && dither.duotone.length === 2 ? dither.duotone : defaults.dither.duotone;
		return {
			pixelSize: clamp(Math.round(finiteNumber(source.pixelSize, defaults.pixelSize)), config.limits.minPixelSize, config.limits.maxPixelSize),
			paletteMode: ['off', 'posterize', 'dither'].includes(source.paletteMode) ? source.paletteMode : (legacy?.enabled ? 'posterize' : defaults.paletteMode),
			colorCount: clamp(Math.round(finiteNumber(source.colorCount, defaults.colorCount)), config.limits.minColors, config.limits.maxColors),
			paletteStyle: ['vibrant', 'balanced', 'natural'].includes(source.paletteStyle) ? source.paletteStyle : defaults.paletteStyle,
			mergeDistinctness: clamp(finiteNumber(source.mergeDistinctness, defaults.mergeDistinctness), 0.01, 0.12),
			detail: clamp(Math.round(finiteNumber(source.detail, defaults.detail)), 1, 64),
			cleanEdges: source.cleanEdges == null ? defaults.cleanEdges : Boolean(source.cleanEdges),
			dither: {
				algorithm: ['bayer', 'floyd', 'atkinson', 'halftone'].includes(dither.algorithm) ? dither.algorithm : defaults.dither.algorithm,
				angle: clamp(finiteNumber(dither.angle, defaults.dither.angle), 0, 360),
				strength: clamp(finiteNumber(dither.strength, defaults.dither.strength), 0, 100),
				palette: dither.palette === 'auto' || dither.palette === 'duotone' || config.presets[dither.palette] ? dither.palette : defaults.dither.palette,
				duotone: duotone.map((color, index) => /^#[0-9a-f]{6}$/i.test(color) ? color : defaults.dither.duotone[index]),
				shimmer: Boolean(dither.shimmer)
			}
		};
	}

	function nearestTwo(color, palette) {
		return palette.map((entry, index) => ({ index, distance: colorDistance(color, entry) }))
			.sort((left, right) => left.distance - right.distance).slice(0, 2);
	}

	function orderedDither(source, width, height, palette, settings, frameIndex) {
		const output = new Uint8ClampedArray(source.length);
		const strength = settings.dither.strength / 100;
		const shimmer = settings.dither.shimmer ? frameIndex * 13 : 0;
		const angle = settings.dither.angle * Math.PI / 180;
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			if (!source[offset + 3]) { output[offset + 3] = source[offset + 3]; continue; }
			const color = [source[offset], source[offset + 1], source[offset + 2]];
			const pair = nearestTwo(color, palette);
			let chosen = pair[0].index;
			if (pair.length > 1 && strength > 0) {
				const rx = Math.round(x * Math.cos(angle) - y * Math.sin(angle));
				const ry = Math.round(x * Math.sin(angle) + y * Math.cos(angle));
				const threshold = (BAYER_8[((ry + shimmer) & 7) * 8 + ((rx + shimmer) & 7)] + 0.5) / 64;
				const ratio = pair[0].distance / Math.max(1, pair[0].distance + pair[1].distance);
				if (ratio * strength > threshold) chosen = pair[1].index;
			}
			output.set(palette[chosen], offset);
			output[offset + 3] = source[offset + 3];
		}
		return output;
	}

	function diffusionDither(source, width, height, palette, settings, algorithm) {
		const work = new Float32Array(source.length);
		for (let index = 0; index < source.length; index++) work[index] = source[index];
		const output = new Uint8ClampedArray(source.length);
		const strength = settings.dither.strength / 100;
		const kernels = algorithm === 'atkinson'
			? [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]]
			: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
		for (let y = 0; y < height; y++) {
			const reverse = y % 2 === 1;
			for (let step = 0; step < width; step++) {
				const x = reverse ? width - 1 - step : step;
				const offset = (y * width + x) * 4;
				if (!source[offset + 3]) { output[offset + 3] = source[offset + 3]; continue; }
				const current = [work[offset], work[offset + 1], work[offset + 2]];
				const chosen = palette[nearestColorIndex(current, palette)];
				output.set(chosen, offset);
				output[offset + 3] = source[offset + 3];
				for (const [dx, dy, weight] of kernels) {
					const nx = x + (reverse ? -dx : dx);
					const ny = y + dy;
					if (nx < 0 || nx >= width || ny >= height) continue;
					const next = (ny * width + nx) * 4;
					for (let channel = 0; channel < 3; channel++) work[next + channel] += (current[channel] - chosen[channel]) * weight * strength;
				}
			}
		}
		return output;
	}

	function halftoneDither(source, width, height, palette, settings, frameIndex) {
		const output = new Uint8ClampedArray(source.length);
		const strength = settings.dither.strength / 100;
		const radians = settings.dither.angle * Math.PI / 180;
		const shimmer = settings.dither.shimmer ? frameIndex * 0.75 : 0;
		const cell = 8;
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			if (!source[offset + 3]) { output[offset + 3] = source[offset + 3]; continue; }
			const color = [source[offset], source[offset + 1], source[offset + 2]];
			const pair = nearestTwo(color, palette);
			let chosen = pair[0].index;
			if (pair.length > 1 && strength > 0) {
				const rx = x * Math.cos(radians) - y * Math.sin(radians) + shimmer;
				const ry = x * Math.sin(radians) + y * Math.cos(radians) + shimmer;
				const cx = ((rx % cell) + cell) % cell - cell / 2;
				const cy = ((ry % cell) + cell) % cell - cell / 2;
				const radial = Math.min(1, Math.hypot(cx, cy) / (cell * 0.7));
				const ratio = pair[0].distance / Math.max(1, pair[0].distance + pair[1].distance);
				if (ratio * strength > radial) chosen = pair[1].index;
			}
			output.set(palette[chosen], offset);
			output[offset + 3] = source[offset + 3];
		}
		return output;
	}

	function applyPixelEffects(source, width, height, settings, config, frameIndex = 0, paletteOverride = null) {
		const pixels = pixelize(source, width, height, settings.pixelSize);
		if (settings.paletteMode === 'off') return pixels;
		if (settings.paletteMode === 'posterize' && config.autoGlitter && PaletteAnalysis) {
			const result = analyzeShared(pixels, width, height, settings, config.autoGlitter, true);
			return flatten(pixels, result.labels, result.palette);
		}
		const palette = paletteOverride || getPalette(pixels, width, height, settings, config);
		if (settings.paletteMode === 'posterize') return flatten(pixels, buildLabels(pixels, width, height, palette, settings), palette);
		const reduced = settings.pixelSize > 1 ? downsampleCells(source, width, height, settings.pixelSize) : { pixels, width, height };
		let dithered;
		if (settings.dither.algorithm === 'floyd' || settings.dither.algorithm === 'atkinson') {
			dithered = diffusionDither(reduced.pixels, reduced.width, reduced.height, palette, settings, settings.dither.algorithm);
		} else if (settings.dither.algorithm === 'halftone') {
			dithered = halftoneDither(reduced.pixels, reduced.width, reduced.height, palette, settings, frameIndex);
		} else {
			dithered = orderedDither(reduced.pixels, reduced.width, reduced.height, palette, settings, frameIndex);
		}
		return settings.pixelSize > 1
			? upscaleCells(dithered, reduced.width, source, width, height, settings.pixelSize)
			: dithered;
	}

	const api = { applyPixelEffects, buildAutoPalette, buildLabels, flatten, getPalette, getSharedAnalysisOptions, hexToRgb, normalizeSettings, pixelize };
	root.GlitterPixelEffects = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
