self.onmessage = ({ data }) => {
	try {
		const pixels = new Uint8ClampedArray(data.pixels);
		const result = analyzeImage(pixels, data.width, data.height, data.colorCount, data.options, data.swatches);
		self.postMessage(result, [result.labels.buffer]);
	} catch (error) {
		self.postMessage({ error: error?.message || 'Image analysis failed.' });
	}
};

function analyzeImage(pixels, width, height, requestedCount, options, swatches) {
	const alphaThreshold = options.alphaThreshold;
	const opaque = [];
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (pixels[offset + 3] >= alphaThreshold) opaque.push(offset);
	}
	if (!opaque.length) throw new Error('The base image has no visible pixels to analyze.');

	const step = Math.max(1, Math.ceil(opaque.length / options.maxSamples));
	const samples = [];
	for (let index = 0; index < opaque.length; index += step) {
		const offset = opaque[index];
		samples.push(pixelToLab(pixels, offset));
	}

	const candidateCount = Math.min(
		Math.max(requestedCount * options.candidateMultiplier, requestedCount + options.candidatePadding),
		samples.length
	);
	let centroids = seedCentroids(samples, candidateCount, options);
	for (let iteration = 0; iteration < options.iterations; iteration++) {
		const totals = centroids.map(() => [0, 0, 0, 0]);
		for (const sample of samples) {
			const cluster = nearest(sample, centroids);
			totals[cluster][0] += sample[0];
			totals[cluster][1] += sample[1];
			totals[cluster][2] += sample[2];
			totals[cluster][3]++;
		}
		centroids = centroids.map((centroid, index) => totals[index][3]
			? totals[index].slice(0, 3).map(value => value / totals[index][3])
			: centroid);
	}

	const rawLabels = new Uint8Array(width * height);
	rawLabels.fill(255);
	const counts = new Uint32Array(centroids.length);
	const rgbTotals = centroids.map(() => [0, 0, 0]);
	for (let pixelIndex = 0, offset = 0; offset < pixels.length; pixelIndex++, offset += 4) {
		if (pixels[offset + 3] < alphaThreshold) continue;
		const cluster = nearest(pixelToLab(pixels, offset), centroids);
		rawLabels[pixelIndex] = cluster;
		counts[cluster]++;
		rgbTotals[cluster][0] += pixels[offset];
		rgbTotals[cluster][1] += pixels[offset + 1];
		rgbTotals[cluster][2] += pixels[offset + 2];
	}

	const order = [...counts.keys()].filter(index => counts[index] > 0).sort((a, b) => counts[b] - counts[a]);
	const remap = new Uint8Array(centroids.length);
	order.forEach((oldIndex, newIndex) => { remap[oldIndex] = newIndex; });
	for (let index = 0; index < rawLabels.length; index++) {
		if (rawLabels[index] !== 255) rawLabels[index] = remap[rawLabels[index]];
	}

	let palette = order.map((oldIndex) => {
		const count = counts[oldIndex];
		return {
			r: Math.round(rgbTotals[oldIndex][0] / count),
			g: Math.round(rgbTotals[oldIndex][1] / count),
			b: Math.round(rgbTotals[oldIndex][2] / count),
			count,
			lab: centroids[oldIndex]
		};
	});
	const componentMetrics = measureConnectedComponents(rawLabels, width, height, palette.length);
	palette.forEach((entry, index) => {
		entry.largestComponent = componentMetrics[index].largest;
		entry.componentCount = componentMetrics[index].count;
		entry.componentDensity = componentMetrics[index].density;
	});
	palette = reducePalette(palette, rawLabels, opaque.length, requestedCount, options).palette;
	assignSuggestedSwatches(palette, swatches, options);
	return { labels: rawLabels, palette, visiblePixelCount: opaque.length };
}

function reducePalette(palette, labels, visiblePixelCount, requestedCount, options) {
	if (palette.length < 2) return { palette, labels };
	const parent = palette.map((_entry, index) => index);

	const roots = () => palette.map((_entry, index) => index).filter((index) => parent[index] === index);
	const merge = (sourceIndex, targetIndex) => {
		const source = palette[sourceIndex];
		const target = palette[targetIndex];
		const combinedCount = source.count + target.count;
		target.r = (target.r * target.count + source.r * source.count) / combinedCount;
		target.g = (target.g * target.count + source.g * source.count) / combinedCount;
		target.b = (target.b * target.count + source.b * source.count) / combinedCount;
		target.lab = target.lab.map((value, channel) =>
			(value * target.count + source.lab[channel] * source.count) / combinedCount);
		target.count = combinedCount;
		if (source.largestComponent > target.largestComponent) target.componentDensity = source.componentDensity;
		target.largestComponent = Math.max(target.largestComponent, source.largestComponent);
		target.componentCount += source.componentCount;
		parent[sourceIndex] = targetIndex;
	};
	const nearestRoot = (sourceIndex, candidates) => candidates.reduce((best, candidate) =>
		distanceSquared(palette[sourceIndex].lab, palette[candidate].lab) < distanceSquared(palette[sourceIndex].lab, palette[best].lab)
			? candidate
			: best,
	 candidates[0]);

	while (true) {
		const active = roots();
		let closestPair = null;
		let closestDistance = Infinity;
		for (let left = 0; left < active.length - 1; left++) {
			for (let right = left + 1; right < active.length; right++) {
				const leftEntry = palette[active[left]];
				const rightEntry = palette[active[right]];
				const distance = distanceSquared(leftEntry.lab, rightEntry.lab);
				const neutralPair = labChroma(leftEntry.lab) < options.neutralChromaThreshold
					&& labChroma(rightEntry.lab) < options.neutralChromaThreshold;
				const crossesHighlightBoundary = (leftEntry.lab[0] > options.highlightLightness)
					!== (rightEntry.lab[0] > options.highlightLightness);
				const coherence = Math.min(componentCoherence(leftEntry), componentCoherence(rightEntry));
				const neutralRange = options.neutralSimilarityThreshold - options.similarityThreshold;
				const connectedProtection = neutralPair ? coherence * options.connectedNeutralProtection : 1;
				let threshold = options.similarityThreshold + (neutralPair ? neutralRange * (1 - connectedProtection) : 0);
				threshold *= 1 + (1 - coherence) * options.fragmentedSimilarityBoost;
				if (neutralPair && crossesHighlightBoundary) threshold *= options.highlightMergeScale;
				threshold *= threshold;
				if (distance <= threshold && distance < closestDistance) {
					closestDistance = distance;
					closestPair = [active[left], active[right]];
				}
			}
		}
		if (!closestPair) break;
		const [left, right] = closestPair;
		const source = paletteImportance(palette[left], visiblePixelCount, options) <= paletteImportance(palette[right], visiblePixelCount, options) ? left : right;
		merge(source, source === left ? right : left);
	}

	while (roots().length > requestedCount) {
		const active = roots();
		const source = active.reduce((lowest, index) =>
			paletteImportance(palette[index], visiblePixelCount, options) < paletteImportance(palette[lowest], visiblePixelCount, options) ? index : lowest,
		active[0]);
		merge(source, nearestRoot(source, active.filter((index) => index !== source)));
	}

	const resolve = (index) => {
		let current = index;
		while (parent[current] !== current) current = parent[current];
		return current;
	};
	const finalRoots = roots().sort((left, right) => palette[right].count - palette[left].count);
	const rootToNew = new Map(finalRoots.map((root, index) => [root, index]));
	for (let index = 0; index < labels.length; index++) {
		if (labels[index] !== 255) labels[index] = rootToNew.get(resolve(labels[index]));
	}
	return {
		labels,
		palette: finalRoots.map((root) => ({
			...palette[root],
			r: Math.round(palette[root].r),
			g: Math.round(palette[root].g),
			b: Math.round(palette[root].b)
		}))
	};
}

function paletteImportance(entry, visiblePixelCount, options) {
	const share = entry.count / visiblePixelCount;
	const chroma = labChroma(entry.lab);
	const colorWeight = 1 + Math.min(options.maxColorBoost, chroma * options.chromaWeight);
	const neutralWeight = chroma < options.neutralChromaThreshold ? options.neutralImportance : 1;
	const highlightWeight = chroma < options.neutralChromaThreshold && entry.lab[0] > options.highlightLightness
		? 1 + ((entry.lab[0] - options.highlightLightness) / (1 - options.highlightLightness)) * options.highlightImportanceBoost
		: 1;
	const connectedShare = entry.largestComponent / visiblePixelCount;
	const densityWeight = options.componentDensityBase + Math.sqrt(entry.componentDensity) * options.componentDensityScale;
	const connectedWeight = options.coherenceBase
		+ componentCoherence(entry) * options.coherenceScale
		+ Math.min(options.maxConnectedBoost, Math.sqrt(connectedShare) * options.connectedAreaWeight);
	return Math.sqrt(share) * colorWeight * neutralWeight * highlightWeight * connectedWeight * densityWeight;
}

function componentCoherence(entry) {
	return Math.sqrt(entry.largestComponent / Math.max(1, entry.count)) * Math.sqrt(entry.componentDensity);
}

function measureConnectedComponents(labels, width, height, paletteSize) {
	const visited = new Uint8Array(labels.length);
	const queue = new Int32Array(labels.length);
	const metrics = Array.from({ length: paletteSize }, () => ({ largest: 0, count: 0, density: 0 }));
	for (let start = 0; start < labels.length; start++) {
		const label = labels[start];
		if (label === 255 || visited[start]) continue;
		let head = 0;
		let tail = 1;
		let size = 0;
		let minX = width;
		let minY = height;
		let maxX = -1;
		let maxY = -1;
		queue[0] = start;
		visited[start] = 1;
		while (head < tail) {
			const pixelIndex = queue[head++];
			const x = pixelIndex % width;
			const y = Math.floor(pixelIndex / width);
			size++;
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
			if (x > 0) tail = enqueueMatching(pixelIndex - 1, label, labels, visited, queue, tail);
			if (x + 1 < width) tail = enqueueMatching(pixelIndex + 1, label, labels, visited, queue, tail);
			if (pixelIndex >= width) tail = enqueueMatching(pixelIndex - width, label, labels, visited, queue, tail);
			if (pixelIndex + width < labels.length) tail = enqueueMatching(pixelIndex + width, label, labels, visited, queue, tail);
		}
		metrics[label].count++;
		if (size > metrics[label].largest) {
			metrics[label].largest = size;
			metrics[label].density = size / ((maxX - minX + 1) * (maxY - minY + 1));
		}
	}
	return metrics;
}

function enqueueMatching(index, label, labels, visited, queue, tail) {
	if (visited[index] || labels[index] !== label) return tail;
	visited[index] = 1;
	queue[tail] = index;
	return tail + 1;
}

function seedCentroids(samples, count, options) {
	const mean = samples.reduce((total, sample) => {
		total[0] += sample[0];
		total[1] += sample[1];
		total[2] += sample[2];
		return total;
	}, [0, 0, 0]).map((value) => value / samples.length);
	const first = samples.reduce((best, sample) =>
		distanceSquared(sample, mean) < distanceSquared(best, mean) ? sample : best,
	 samples[0]);
	const centroids = [first.slice()];
	while (centroids.length < count) {
		let best = samples[0];
		let bestScore = -1;
		for (const sample of samples) {
			const distance = distanceSquared(sample, centroids[nearest(sample, centroids)]);
			const chroma = labChroma(sample);
			const score = distance * (1 + Math.min(options.maxColorBoost, chroma * options.chromaWeight));
			if (score > bestScore) {
				bestScore = score;
				best = sample;
			}
		}
		if (bestScore <= 1e-10) break;
		centroids.push(best.slice());
	}
	return centroids;
}

function assignSuggestedSwatches(palette, swatches, options) {
	const preparedSwatches = swatches.map((swatch) => ({
		...swatch,
		colors: swatch.colors.map(hexToLab),
		primary: hexToLab(swatch.colors[0])
	}));
	for (const entry of palette) {
		let bestIndex = -1;
		let bestColor = null;
		let bestDistance = Infinity;
		for (let index = 0; index < preparedSwatches.length; index++) {
			const colors = preparedSwatches[index].colors;
			const closestColor = colors.reduce((closest, color) =>
				distanceSquared(entry.lab, color) < distanceSquared(entry.lab, closest) ? color : closest,
			 colors[0]);
			const distance = glitterMatchDistance(entry.lab, preparedSwatches[index], closestColor, options);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = index;
				bestColor = closestColor;
			}
		}
		entry.suggestedGlitterId = bestIndex >= 0 ? preparedSwatches[bestIndex].id : null;
		entry.suggestedColorAdjust = options.tuneGlitterHue ? getHueAdjustment(bestColor, entry.lab, options) : null;
	}
}

function glitterMatchDistance(target, swatch, closestColor, options) {
	return distanceSquared(target, swatch.primary) * options.swatchPrimaryWeight
		+ distanceSquared(target, closestColor) * (1 - options.swatchPrimaryWeight);
}

function getHueAdjustment(source, target, options) {
	if (!source || labChroma(source) < options.hueMinChroma || labChroma(target) < options.hueMinChroma) return null;
	const sourceHue = Math.atan2(source[2], source[1]) * 180 / Math.PI;
	const targetHue = Math.atan2(target[2], target[1]) * 180 / Math.PI;
	let hue = Math.round(targetHue - sourceHue);
	while (hue > 180) hue -= 360;
	while (hue < -180) hue += 360;
	hue = Math.max(-options.maxHueShift, Math.min(options.maxHueShift, hue));
	return Math.abs(hue) >= 2 ? { hue, saturation: 100, brightness: 100 } : null;
}

function labChroma(lab) {
	return Math.hypot(lab[1], lab[2]);
}

function hexToLab(value) {
	const hex = String(value || '').replace('#', '');
	if (!/^[0-9a-f]{6}$/i.test(hex)) return rgbToOklab(128, 128, 128);
	return rgbToOklab(
		parseInt(hex.slice(0, 2), 16),
		parseInt(hex.slice(2, 4), 16),
		parseInt(hex.slice(4, 6), 16)
	);
}

function nearest(color, centroids) {
	let bestIndex = 0;
	let bestDistance = Infinity;
	for (let index = 0; index < centroids.length; index++) {
		const distance = distanceSquared(color, centroids[index]);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index;
		}
	}
	return bestIndex;
}

function distanceSquared(a, b) {
	const dl = a[0] - b[0];
	const da = a[1] - b[1];
	const db = a[2] - b[2];
	return dl * dl + da * da + db * db;
}

function pixelToLab(pixels, offset) {
	return rgbToOklab(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
}

function rgbToOklab(red, green, blue) {
	const linear = value => {
		value /= 255;
		return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
	};
	const r = linear(red);
	const g = linear(green);
	const b = linear(blue);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}
