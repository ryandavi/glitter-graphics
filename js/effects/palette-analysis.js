// Generic image segmentation and palette reduction shared by Auto Glitter and Base Image effects.
// Worker-safe globals only: no DOM, canvas, or application state.
(function (root) {
	function segmentImage(pixels, width, height, options) {
		const opaque = [];
		for (let offset = 0; offset < pixels.length; offset += 4) {
			if (pixels[offset + 3] >= options.alphaThreshold) opaque.push(offset);
		}
		if (!opaque.length) throw new Error('The base image has no visible pixels to analyze.');

		const step = Math.max(1, Math.ceil(opaque.length / options.maxSamples));
		const samples = [];
		for (let index = 0; index < opaque.length; index += step) {
			const offset = opaque[index];
			const lab = pixelToLab(pixels, offset);
			const gradient = pixelGradient(pixels, offset, width, height, options.alphaThreshold, lab);
			samples.push({ lab, weight: 1 / (1 + gradient * options.gradientWeight) });
		}

		const candidateCount = Math.min(options.candidateCount, samples.length);
		let centroids = seedCentroids(samples, candidateCount, options);
		for (let iteration = 0; iteration < options.iterations; iteration++) {
			const totals = centroids.map(() => [0, 0, 0, 0]);
			for (const sample of samples) {
				const cluster = nearest(sample.lab, centroids);
				totals[cluster][0] += sample.lab[0] * sample.weight;
				totals[cluster][1] += sample.lab[1] * sample.weight;
				totals[cluster][2] += sample.lab[2] * sample.weight;
				totals[cluster][3] += sample.weight;
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
			if (pixels[offset + 3] < options.alphaThreshold) continue;
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

		const palette = order.map((oldIndex) => ({
			r: rgbTotals[oldIndex][0] / counts[oldIndex],
			g: rgbTotals[oldIndex][1] / counts[oldIndex],
			b: rgbTotals[oldIndex][2] / counts[oldIndex],
			count: counts[oldIndex],
			lab: centroids[oldIndex]
		}));
		const componentMetrics = measureConnectedComponents(rawLabels, width, height, palette.length);
		applyComponentMetrics(palette, componentMetrics);
		return {
			rawLabels,
			centroids: palette.map(entry => entry.lab),
			counts: palette.map(entry => entry.count),
			rgbTotals: palette.map(entry => [entry.r * entry.count, entry.g * entry.count, entry.b * entry.count]),
			componentMetrics,
			palette,
			width,
			height,
			visiblePixelCount: opaque.length
		};
	}

	function reduceSegment(cache, requestedCount, options) {
		let labels = cache.rawLabels.slice();
		let palette = cache.palette.map(clonePaletteEntry);
		({ palette, labels } = reducePalette(palette, labels, cache.visiblePixelCount, requestedCount, options));
		if (options.cleanup.aliasDissolve.enabled) {
			({ palette, labels } = dissolveAliases(palette, labels, cache.width, cache.height, cache.visiblePixelCount, options.cleanup.aliasDissolve));
		}
		if (options.cleanup.despeckle.enabled) {
			const minimum = Math.max(options.cleanup.despeckle.absMin, cache.width * cache.height * options.cleanup.despeckle.shareMin);
			({ palette, labels } = despeckle(palette, labels, cache.width, cache.height, minimum));
		}
		return { labels, palette, visiblePixelCount: cache.visiblePixelCount };
	}

	function reducePalette(palette, labels, visiblePixelCount, requestedCount, options) {
		if (palette.length < 2) return { palette, labels };
		const parent = palette.map((_entry, index) => index);
		const roots = () => palette.map((_entry, index) => index).filter(index => parent[index] === index);
		const merge = (sourceIndex, targetIndex) => {
			const source = palette[sourceIndex];
			const target = palette[targetIndex];
			const combinedCount = source.count + target.count;
			for (const key of ['r', 'g', 'b']) target[key] = (target[key] * target.count + source[key] * source.count) / combinedCount;
			target.lab = target.lab.map((value, channel) => (value * target.count + source.lab[channel] * source.count) / combinedCount);
			target.count = combinedCount;
			if (source.largestComponent > target.largestComponent) target.componentDensity = source.componentDensity;
			target.largestComponent = Math.max(target.largestComponent, source.largestComponent);
			target.componentCount += source.componentCount;
			parent[sourceIndex] = targetIndex;
		};
		const nearestRoot = (sourceIndex, candidates) => candidates.reduce((best, candidate) =>
			distanceSquared(palette[sourceIndex].lab, palette[candidate].lab) < distanceSquared(palette[sourceIndex].lab, palette[best].lab) ? candidate : best,
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
					const neutralPair = labChroma(leftEntry.lab) < options.neutralChromaThreshold && labChroma(rightEntry.lab) < options.neutralChromaThreshold;
					const crossesHighlightBoundary = (leftEntry.lab[0] > options.highlightLightness) !== (rightEntry.lab[0] > options.highlightLightness);
					const coherence = Math.min(componentCoherence(leftEntry), componentCoherence(rightEntry));
					const connectedProtection = neutralPair ? coherence * options.connectedNeutralProtection : 1;
					let threshold = options.mergeDistinctness * (neutralPair
						? 1 + (options.neutralSimilarityScale - 1) * (1 - connectedProtection)
						: 1);
					threshold *= 1 + (1 - coherence) * options.fragmentedSimilarityBoost;
					if (neutralPair && crossesHighlightBoundary) threshold *= options.highlightMergeScale;
					if (distance <= threshold * threshold && distance < closestDistance) {
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
			const source = active.reduce((lowest, index) => paletteImportance(palette[index], visiblePixelCount, options) < paletteImportance(palette[lowest], visiblePixelCount, options) ? index : lowest, active[0]);
			merge(source, nearestRoot(source, active.filter(index => index !== source)));
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
		return { labels, palette: finalRoots.map(root => roundedPaletteEntry(palette[root])) };
	}

	function dissolveAliases(palette, labels, width, height, visiblePixelCount, options) {
		while (palette.length >= 3) {
			let candidate = null;
			for (let alias = 0; alias < palette.length; alias++) {
				if (palette[alias].count / visiblePixelCount >= options.maxShare) continue;
				for (let left = 0; left < palette.length - 1; left++) {
					if (left === alias) continue;
					for (let right = left + 1; right < palette.length; right++) {
						if (right === alias) continue;
						const mixtureDistance = normalizedSegmentDistance(palette[alias].lab, palette[left].lab, palette[right].lab);
						if (mixtureDistance >= options.maxMixtureDistance || (candidate && mixtureDistance >= candidate.mixtureDistance)) continue;
						const boundaryShare = aliasBoundaryShare(labels, width, height, alias, left, right);
						if (boundaryShare > options.minBoundaryShare) candidate = { alias, left, right, mixtureDistance };
					}
				}
			}
			if (!candidate) break;
			const before = labels.slice();
			for (let index = 0; index < labels.length; index++) {
				if (labels[index] !== candidate.alias) continue;
				const leftVotes = neighborhoodVotes(labels, width, height, index, candidate.left);
				const rightVotes = neighborhoodVotes(labels, width, height, index, candidate.right);
				labels[index] = leftVotes === rightVotes
					? (distanceSquared(palette[candidate.alias].lab, palette[candidate.left].lab) <= distanceSquared(palette[candidate.alias].lab, palette[candidate.right].lab) ? candidate.left : candidate.right)
					: (leftVotes > rightVotes ? candidate.left : candidate.right);
			}
			({ palette, labels } = rebuildPalette(palette, before, labels, width, height));
		}
		return { palette, labels };
	}

	function despeckle(palette, labels, width, height, minimumSize) {
		const visited = new Uint8Array(labels.length);
		const queue = new Int32Array(labels.length);
		const before = labels.slice();
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
				if (x > 0) adjacent.push(index - 1);
				if (x + 1 < width) adjacent.push(index + 1);
				if (index >= width) adjacent.push(index - width);
				if (index + width < labels.length) adjacent.push(index + width);
				for (const neighbor of adjacent) {
					if (labels[neighbor] === label && !visited[neighbor]) {
						visited[neighbor] = 1;
						queue[tail++] = neighbor;
					} else if (labels[neighbor] !== 255 && labels[neighbor] !== label) neighbors[labels[neighbor]]++;
				}
			}
			if (tail >= minimumSize) continue;
			let target = 255;
			for (let index = 0; index < neighbors.length; index++) {
				if (neighbors[index] > (target === 255 ? 0 : neighbors[target])) target = index;
			}
			if (target === 255) continue;
			for (let index = 0; index < tail; index++) labels[queue[index]] = target;
		}
		return rebuildPalette(palette, before, labels, width, height);
	}

	function rebuildPalette(sourcePalette, sourceLabels, labels, width, height) {
		const totals = sourcePalette.map(() => ({ r: 0, g: 0, b: 0, lab: [0, 0, 0], count: 0 }));
		for (let index = 0; index < labels.length; index++) {
			const target = labels[index];
			if (target === 255) continue;
			const source = sourcePalette[sourceLabels[index]];
			const total = totals[target];
			total.r += source.r;
			total.g += source.g;
			total.b += source.b;
			total.lab[0] += source.lab[0];
			total.lab[1] += source.lab[1];
			total.lab[2] += source.lab[2];
			total.count++;
		}
		const active = totals.map((_entry, index) => index).filter(index => totals[index].count).sort((left, right) => totals[right].count - totals[left].count);
		const remap = new Uint8Array(totals.length);
		active.forEach((oldIndex, newIndex) => { remap[oldIndex] = newIndex; });
		for (let index = 0; index < labels.length; index++) if (labels[index] !== 255) labels[index] = remap[labels[index]];
		const palette = active.map(index => {
			const total = totals[index];
			return { r: total.r / total.count, g: total.g / total.count, b: total.b / total.count, lab: total.lab.map(value => value / total.count), count: total.count };
		});
		applyComponentMetrics(palette, measureConnectedComponents(labels, width, height, palette.length));
		return { labels, palette: palette.map(roundedPaletteEntry) };
	}

	function normalizedSegmentDistance(point, left, right) {
		const segment = right.map((value, index) => value - left[index]);
		const lengthSquared = distanceSquared(left, right);
		if (lengthSquared <= 1e-12) return Infinity;
		const projection = Math.max(0, Math.min(1, point.reduce((sum, value, index) => sum + (value - left[index]) * segment[index], 0) / lengthSquared));
		const closest = left.map((value, index) => value + segment[index] * projection);
		return Math.sqrt(distanceSquared(point, closest) / lengthSquared);
	}

	function aliasBoundaryShare(labels, width, height, alias, left, right) {
		let pixels = 0;
		let boundary = 0;
		for (let index = 0; index < labels.length; index++) {
			if (labels[index] !== alias) continue;
			pixels++;
			const x = index % width;
			const neighbors = [];
			if (x > 0) neighbors.push(labels[index - 1]);
			if (x + 1 < width) neighbors.push(labels[index + 1]);
			if (index >= width) neighbors.push(labels[index - width]);
			if (index + width < labels.length) neighbors.push(labels[index + width]);
			if (neighbors.includes(left) || neighbors.includes(right)) boundary++;
		}
		return boundary / Math.max(1, pixels);
	}

	function neighborhoodVotes(labels, width, height, index, target) {
		const x = index % width;
		const y = Math.floor(index / width);
		let votes = 0;
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
			if (labels[(y + dy) * width + x + dx] === target) votes++;
		}
		return votes;
	}

	function pixelGradient(pixels, offset, width, height, alphaThreshold, lab) {
		const pixelIndex = offset / 4;
		const x = pixelIndex % width;
		const y = Math.floor(pixelIndex / width);
		let gradient = 0;
		if (x + 1 < width && pixels[offset + 7] >= alphaThreshold) gradient = Math.max(gradient, Math.sqrt(distanceSquared(lab, pixelToLab(pixels, offset + 4))));
		const down = offset + width * 4;
		if (y + 1 < height && pixels[down + 3] >= alphaThreshold) gradient = Math.max(gradient, Math.sqrt(distanceSquared(lab, pixelToLab(pixels, down))));
		return gradient;
	}

	function paletteImportance(entry, visiblePixelCount, options) {
		const share = entry.count / visiblePixelCount;
		const chroma = labChroma(entry.lab);
		const colorWeight = 1 + Math.min(options.maxColorBoost, chroma * options.chromaWeight);
		const neutralWeight = chroma < options.neutralChromaThreshold ? options.neutralImportance : 1;
		const highlightWeight = chroma < options.neutralChromaThreshold && entry.lab[0] > options.highlightLightness ? 1 + ((entry.lab[0] - options.highlightLightness) / (1 - options.highlightLightness)) * options.highlightImportanceBoost : 1;
		const connectedShare = entry.largestComponent / visiblePixelCount;
		const densityWeight = options.componentDensityBase + Math.sqrt(entry.componentDensity) * options.componentDensityScale;
		const connectedWeight = options.coherenceBase + componentCoherence(entry) * options.coherenceScale + Math.min(options.maxConnectedBoost, Math.sqrt(connectedShare) * options.connectedAreaWeight);
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

	function applyComponentMetrics(palette, metrics) {
		palette.forEach((entry, index) => Object.assign(entry, componentFields(metrics[index])));
	}

	function componentFields(entry) {
		return { largestComponent: entry.largest ?? entry.largestComponent, componentCount: entry.count ?? entry.componentCount, componentDensity: entry.density ?? entry.componentDensity };
	}

	function seedCentroids(samples, count, options) {
		const totalWeight = samples.reduce((total, sample) => total + sample.weight, 0);
		const mean = samples.reduce((total, sample) => {
			total[0] += sample.lab[0] * sample.weight;
			total[1] += sample.lab[1] * sample.weight;
			total[2] += sample.lab[2] * sample.weight;
			return total;
		}, [0, 0, 0]).map(value => value / totalWeight);
		const first = samples.reduce((best, sample) => distanceSquared(sample.lab, mean) < distanceSquared(best.lab, mean) ? sample : best, samples[0]);
		const centroids = [first.lab.slice()];
		while (centroids.length < count) {
			let best = samples[0];
			let bestScore = -1;
			for (const sample of samples) {
				const distance = distanceSquared(sample.lab, centroids[nearest(sample.lab, centroids)]);
				const score = distance * sample.weight * (1 + Math.min(options.seedMaxColorBoost, labChroma(sample.lab) * options.seedChromaWeight));
				if (score > bestScore) {
					bestScore = score;
					best = sample;
				}
			}
			if (bestScore <= 1e-10) break;
			centroids.push(best.lab.slice());
		}
		return centroids;
	}

	function clonePaletteEntry(entry) {
		return { ...entry, lab: entry.lab.slice() };
	}

	function roundedPaletteEntry(entry) {
		return { ...entry, r: Math.round(entry.r), g: Math.round(entry.g), b: Math.round(entry.b) };
	}

	function labChroma(lab) {
		return Math.hypot(lab[1], lab[2]);
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
		return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
	}


	const api = { segmentImage, reduceSegment, reducePalette, dissolveAliases, despeckle, rebuildPalette, normalizedSegmentDistance, aliasBoundaryShare, neighborhoodVotes, pixelGradient, paletteImportance, componentCoherence, measureConnectedComponents, enqueueMatching, applyComponentMetrics, componentFields, seedCentroids, clonePaletteEntry, roundedPaletteEntry, labChroma, nearest, distanceSquared, pixelToLab, rgbToOklab };
	root.GlitterPaletteAnalysis = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);

