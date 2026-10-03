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
		const legacy = source.paletteMode == null && source.enabled != null ? source : null;
		const dither = { ...defaults.dither, ...(source.dither || {}) };
		const duotone = Array.isArray(dither.duotone) && dither.duotone.length === 2 ? dither.duotone : defaults.dither.duotone;
		const pixelSize = clamp(Math.round(finiteNumber(source.pixelSize, defaults.pixelSize)), config.limits.minPixelSize, config.limits.maxPixelSize);
		const globalEnabled = source.enabled !== false;
		const paletteMode = ['posterize', 'dither'].includes(source.paletteMode)
			? source.paletteMode
			: (legacy?.enabled ? 'posterize' : defaults.paletteMode);
		return {
			pixelateEnabled: source.pixelateEnabled == null ? globalEnabled && pixelSize > 1 : Boolean(source.pixelateEnabled),
			paletteEnabled: source.paletteEnabled == null
				? globalEnabled && (Boolean(legacy?.enabled) || ['posterize', 'dither'].includes(source.paletteMode))
				: Boolean(source.paletteEnabled),
			pixelSize,
			paletteMode,
			colorCount: clamp(Math.round(finiteNumber(source.colorCount, defaults.colorCount)), config.limits.minColors, config.limits.maxColors),
			paletteStyle: ['vibrant', 'balanced', 'natural'].includes(source.paletteStyle) ? source.paletteStyle : defaults.paletteStyle,
			mergeDistinctness: clamp(finiteNumber(source.mergeDistinctness, defaults.mergeDistinctness), 0.01, 0.12),
			detail: clamp(Math.round(finiteNumber(source.detail, defaults.detail)), 1, 64),
			cleanEdges: source.cleanEdges == null ? defaults.cleanEdges : Boolean(source.cleanEdges),
			dither: {
				algorithm: ['bayer', 'floyd', 'falsefloyd', 'stucki', 'atkinson', 'halftone'].includes(dither.algorithm) ? dither.algorithm : defaults.dither.algorithm,
				angle: clamp(finiteNumber(dither.angle, defaults.dither.angle), 0, 360),
				strength: clamp(finiteNumber(dither.strength, defaults.dither.strength), 0, 100),
				scale: clamp(Math.round(finiteNumber(dither.scale, defaults.dither.scale || 1)), 1, 4),
				edgeProtection: dither.edgeProtection == null ? defaults.dither.edgeProtection !== false : Boolean(dither.edgeProtection),
				serpentine: dither.serpentine == null ? defaults.dither.serpentine !== false : Boolean(dither.serpentine),
				palette: dither.palette === 'auto' || dither.palette === 'duotone' || config.presets[dither.palette] ? dither.palette : defaults.dither.palette,
				duotone: duotone.map((color, index) => /^#[0-9a-f]{6}$/i.test(color) ? color : defaults.dither.duotone[index]),
				shimmer: Boolean(dither.shimmer)
			}
		};
	}

	// Dithering visits every pixel of every exported frame against palettes of
	// up to 256 colors, so the per-pixel search runs over one flat typed array
	// and allocates nothing. Same distance formula as colorDistance().
	function flattenPalette(palette) {
		const flat = new Float64Array(palette.length * 3);
		for (let index = 0; index < palette.length; index++) {
			flat[index * 3] = palette[index][0];
			flat[index * 3 + 1] = palette[index][1];
			flat[index * 3 + 2] = palette[index][2];
		}
		return flat;
	}

	// Exact nearest palette color for values that are not cacheable (diffusion
	// feeds accumulated error back in, so nearly every lookup is a new color).
	// Entries are walked outward from the closest green, the heaviest channel,
	// and each direction stops once green alone is already farther than the
	// best match. Ties keep the lower palette index, as nearestColorIndex does.
	// Returns the entry's offset into `flat`.
	function createNearestSearch(palette) {
		const flat = flattenPalette(palette);
		const order = palette.map((_, index) => index).sort((left, right) => flat[left * 3 + 1] - flat[right * 3 + 1] || left - right);
		const greens = Float64Array.from(order, (index) => flat[index * 3 + 1]);
		const offsets = Int32Array.from(order, (index) => index * 3);
		const count = order.length;
		return { flat, nearest(r, g, b) {
			let low = 0;
			let high = count;
			while (low < high) {
				const middle = (low + high) >> 1;
				if (greens[middle] < g) low = middle + 1;
				else high = middle;
			}
			let best = 0;
			let bestDistance = Infinity;
			for (let position = low; position < count; position++) {
				const dg = g - greens[position];
				if (dg * dg * 0.59 > bestDistance) break;
				const entry = offsets[position];
				const dr = r - flat[entry];
				const db = b - flat[entry + 2];
				const distance = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
				if (distance < bestDistance || (distance === bestDistance && entry < best)) { bestDistance = distance; best = entry; }
			}
			for (let position = low - 1; position >= 0; position--) {
				const dg = g - greens[position];
				if (dg * dg * 0.59 > bestDistance) break;
				const entry = offsets[position];
				const dr = r - flat[entry];
				const db = b - flat[entry + 2];
				const distance = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
				if (distance < bestDistance || (distance === bestDistance && entry < best)) { bestDistance = distance; best = entry; }
			}
			return best;
		} };
	}

	// The two nearest palette colors for each distinct source color (ties keep
	// the lower palette index). Direct-mapped by exact color (key stored +1 so
	// an empty slot is 0), so flat art is searched once per color, not per pixel.
	function createNearestTwoLookup(palette) {
		const flat = flattenPalette(palette);
		const keys = new Int32Array(65536);
		const first = new Int32Array(65536);
		const second = new Int32Array(65536);
		const ratios = new Float64Array(65536);
		return { first, second, ratios, slotFor(r, g, b) {
			const key = ((r << 16) | (g << 8) | b) + 1;
			const slot = Math.imul(key, 0x9E3779B1) >>> 16;
			if (keys[slot] === key) return slot;
			let bestIndex = 0;
			let nextIndex = -1;
			let bestDistance = Infinity;
			let nextDistance = Infinity;
			for (let index = 0, offset = 0; offset < flat.length; index++, offset += 3) {
				const dr = r - flat[offset];
				const dg = g - flat[offset + 1];
				const db = b - flat[offset + 2];
				const distance = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
				if (distance < bestDistance) {
					nextDistance = bestDistance; nextIndex = bestIndex;
					bestDistance = distance; bestIndex = index;
				} else if (distance < nextDistance) {
					nextDistance = distance; nextIndex = index;
				}
			}
			keys[slot] = key;
			first[slot] = bestIndex;
			second[slot] = flat.length > 3 ? nextIndex : -1;
			ratios[slot] = bestDistance / Math.max(1, bestDistance + nextDistance);
			return slot;
		} };
	}

	function getShimmerAnimation(algorithm, config) {
		return (config.pixelEffects || config).animation.algorithms[algorithm] || null;
	}

	function orderedDither(source, width, height, palette, settings, frameIndex, animation) {
		const output = new Uint8ClampedArray(source.length);
		const strength = settings.dither.strength / 100;
		const shimmer = settings.dither.shimmer && animation ? frameIndex * animation.offsetPerFrame : 0;
		const angle = settings.dither.angle * Math.PI / 180;
		const scale = settings.dither.scale || 1;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		const lookup = createNearestTwoLookup(palette);
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			if (!source[offset + 3]) { output[offset + 3] = source[offset + 3]; continue; }
			const slot = lookup.slotFor(source[offset], source[offset + 1], source[offset + 2]);
			let chosen = lookup.first[slot];
			if (lookup.second[slot] >= 0 && strength > 0) {
				const rx = Math.round((x * cos - y * sin) / scale);
				const ry = Math.round((x * sin + y * cos) / scale);
				const threshold = (BAYER_8[((ry + shimmer) & 7) * 8 + ((rx + shimmer) & 7)] + 0.5) / 64;
				if (lookup.ratios[slot] * strength > threshold) chosen = lookup.second[slot];
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
			: algorithm === 'falsefloyd'
				? [[1, 0, 3 / 8], [0, 1, 3 / 8], [1, 1, 2 / 8]]
				: algorithm === 'stucki'
					? [[1, 0, 8 / 42], [2, 0, 4 / 42], [-2, 1, 2 / 42], [-1, 1, 4 / 42], [0, 1, 8 / 42], [1, 1, 4 / 42], [2, 1, 2 / 42], [-2, 2, 1 / 42], [-1, 2, 2 / 42], [0, 2, 4 / 42], [1, 2, 2 / 42], [2, 2, 1 / 42]]
					: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
		const search = createNearestSearch(palette);
		const flat = search.flat;
		const edgeProtection = settings.dither.edgeProtection;
		for (let y = 0; y < height; y++) {
			const reverse = settings.dither.serpentine && y % 2 === 1;
			for (let step = 0; step < width; step++) {
				const x = reverse ? width - 1 - step : step;
				const offset = (y * width + x) * 4;
				if (!source[offset + 3]) { output[offset + 3] = source[offset + 3]; continue; }
				const red = work[offset];
				const green = work[offset + 1];
				const blue = work[offset + 2];
				const best = search.nearest(red, green, blue);
				const errorRed = red - flat[best];
				const errorGreen = green - flat[best + 1];
				const errorBlue = blue - flat[best + 2];
				output[offset] = flat[best];
				output[offset + 1] = flat[best + 1];
				output[offset + 2] = flat[best + 2];
				output[offset + 3] = source[offset + 3];
				for (let kernel = 0; kernel < kernels.length; kernel++) {
					const nx = x + (reverse ? -kernels[kernel][0] : kernels[kernel][0]);
					const ny = y + kernels[kernel][1];
					if (nx < 0 || nx >= width || ny >= height) continue;
					const next = (ny * width + nx) * 4;
					if (edgeProtection) {
						const dr = source[offset] - source[next];
						const dg = source[offset + 1] - source[next + 1];
						const db = source[offset + 2] - source[next + 2];
						if (dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11 > 32 * 32) continue;
					}
					const weight = kernels[kernel][2];
					work[next] += errorRed * weight * strength;
					work[next + 1] += errorGreen * weight * strength;
					work[next + 2] += errorBlue * weight * strength;
				}
			}
		}
		return output;
	}

	function halftoneDither(source, width, height, palette, settings, frameIndex, animation) {
		const output = new Uint8ClampedArray(source.length);
		const strength = settings.dither.strength / 100;
		const radians = settings.dither.angle * Math.PI / 180;
		const shimmer = settings.dither.shimmer && animation ? frameIndex * animation.offsetPerFrame : 0;
		const cell = 8 * (settings.dither.scale || 1);
		const cos = Math.cos(radians);
		const sin = Math.sin(radians);
		const lookup = createNearestTwoLookup(palette);
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			if (!source[offset + 3]) { output[offset + 3] = source[offset + 3]; continue; }
			const slot = lookup.slotFor(source[offset], source[offset + 1], source[offset + 2]);
			let chosen = lookup.first[slot];
			if (lookup.second[slot] >= 0 && strength > 0) {
				const rx = x * cos - y * sin + shimmer;
				const ry = x * sin + y * cos + shimmer;
				const cx = ((rx % cell) + cell) % cell - cell / 2;
				const cy = ((ry % cell) + cell) % cell - cell / 2;
				const radial = Math.min(1, Math.hypot(cx, cy) / (cell * 0.7));
				if (lookup.ratios[slot] * strength > radial) chosen = lookup.second[slot];
			}
			output.set(palette[chosen], offset);
			output[offset + 3] = source[offset + 3];
		}
		return output;
	}

	function applyPixelEffects(source, width, height, settings, config, frameIndex = 0, paletteOverride = null) {
		const pixelSize = settings.pixelateEnabled ? settings.pixelSize : 1;
		const pixels = pixelize(source, width, height, pixelSize);
		if (!settings.paletteEnabled) return pixels;
		if (settings.paletteMode === 'posterize' && config.autoGlitter && PaletteAnalysis) {
			const result = analyzeShared(pixels, width, height, settings, config.autoGlitter, true);
			return flatten(pixels, result.labels, result.palette);
		}
		const palette = paletteOverride || getPalette(pixels, width, height, settings, config);
		if (settings.paletteMode === 'posterize') return flatten(pixels, buildLabels(pixels, width, height, palette, settings), palette);
		const reduced = pixelSize > 1 ? downsampleCells(source, width, height, pixelSize) : { pixels, width, height };
		const shimmerAnimation = getShimmerAnimation(settings.dither.algorithm, config);
		let dithered;
		if (['floyd', 'falsefloyd', 'stucki', 'atkinson'].includes(settings.dither.algorithm)) {
			dithered = diffusionDither(reduced.pixels, reduced.width, reduced.height, palette, settings, settings.dither.algorithm);
		} else if (settings.dither.algorithm === 'halftone') {
			dithered = halftoneDither(reduced.pixels, reduced.width, reduced.height, palette, settings, frameIndex, shimmerAnimation);
		} else {
			dithered = orderedDither(reduced.pixels, reduced.width, reduced.height, palette, settings, frameIndex, shimmerAnimation);
		}
		return pixelSize > 1
			? upscaleCells(dithered, reduced.width, source, width, height, pixelSize)
			: dithered;
	}

	const api = { applyPixelEffects, buildAutoPalette, buildLabels, flatten, getPalette, getSharedAnalysisOptions, getShimmerAnimation, hexToRgb, normalizeSettings, pixelize };
	root.GlitterPixelEffects = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
