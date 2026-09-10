importScripts('../effects/palette-analysis.js?v=1');

let segmentCache = null;

self.onmessage = ({ data }) => {
	const requestId = data.requestId;
	try {
		if (data.type === 'segment') {
			segmentCache = GlitterPaletteAnalysis.segmentImage(new Uint8ClampedArray(data.pixels), data.width, data.height, data.options);
			self.postMessage({ type: 'segmented', requestId, visiblePixelCount: segmentCache.visiblePixelCount });
			return;
		}
		if (data.type === 'reduce') {
			if (!segmentCache) throw new Error('The image must be segmented before reducing its palette.');
			const result = GlitterPaletteAnalysis.reduceSegment(segmentCache, data.colorCount, data.options);
			assignSuggestedSwatches(result.palette, data.swatches, data.options);
			self.postMessage({ type: 'result', requestId, ...result }, [result.labels.buffer]);
			return;
		}
		throw new Error('Unknown Auto Glitter worker request.');
	} catch (error) {
		self.postMessage({ type: 'error', requestId, error: error?.message || 'Image analysis failed.' });
	}
};

function assignSuggestedSwatches(palette, swatches, options) {
	const preparedSwatches = swatches.map(swatch => ({
		...swatch,
		colors: swatch.colors.map(hexToLab),
		weights: Array.isArray(swatch.weights) && swatch.weights.length === swatch.colors.length
			? swatch.weights
			: swatch.colors.map(() => 1 / swatch.colors.length),
		primary: hexToLab(swatch.colors[0]),
		averageChroma: getAverageChroma(swatch.colors.map(hexToLab), swatch.weights)
	}));
	const neutralSwatches = preparedSwatches.filter(swatch => swatch.averageChroma < options.hueMinChroma * 0.25);
	for (const entry of palette) {
		let bestIndex = -1;
		let bestColor = null;
		let bestDistance = Infinity;
		const candidatesForEntry = GlitterPaletteAnalysis.labChroma(entry.lab) < options.hueMinChroma && neutralSwatches.length
			? neutralSwatches
			: preparedSwatches;
		for (let index = 0; index < candidatesForEntry.length; index++) {
			const swatch = candidatesForEntry[index];
			const eligible = swatch.colors.map((color, colorIndex) => ({ color, colorIndex }))
				.filter(item => swatch.colors.length === 1 || swatch.weights[item.colorIndex] >= options.swatchMinCoverage);
			const candidates = eligible.length ? eligible : [{ color: swatch.colors[0], colorIndex: 0 }];
			const closest = candidates.reduce((best, item) => {
				const penalty = 1 + options.swatchCoverageBias * (1 - swatch.weights[item.colorIndex]);
				const distance = GlitterPaletteAnalysis.distanceSquared(entry.lab, item.color) * penalty;
				return distance < best.distance ? { ...item, distance, penalty } : best;
			}, { color: candidates[0].color, colorIndex: candidates[0].colorIndex, distance: Infinity, penalty: 1 });
			const closestColor = closest.color;
			const distance = GlitterPaletteAnalysis.distanceSquared(entry.lab, swatch.primary) * options.swatchPrimaryWeight
				+ GlitterPaletteAnalysis.distanceSquared(entry.lab, closestColor) * closest.penalty * (1 - options.swatchPrimaryWeight);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = index;
				bestColor = closestColor;
			}
		}
		entry.suggestedGlitterId = bestIndex >= 0 ? candidatesForEntry[bestIndex].id : null;
		entry.suggestedColorAdjust = getSuggestedColorAdjust(bestColor, entry.lab, options);
	}
}

function getAverageChroma(colors, weights) {
	const normalizedWeights = Array.isArray(weights) && weights.length === colors.length
		? weights.map(weight => Math.max(0, Number(weight) || 0))
		: colors.map(() => 1);
	const totalWeight = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
	const effectiveWeights = totalWeight > 0 ? normalizedWeights : colors.map(() => 1);
	const effectiveTotal = totalWeight > 0 ? totalWeight : colors.length;
	return colors.reduce((sum, color, index) => sum + GlitterPaletteAnalysis.labChroma(color) * effectiveWeights[index], 0) / effectiveTotal;
}

function getSuggestedColorAdjust(source, target, options) {
	const targetChroma = GlitterPaletteAnalysis.labChroma(target);
	const saturation = targetChroma < options.hueMinChroma ? options.neutralMatchSaturation : options.matchedSaturation;
	let hue = 0;
	if (options.tuneGlitterHue && source && GlitterPaletteAnalysis.labChroma(source) >= options.hueMinChroma && targetChroma >= options.hueMinChroma) {
		const sourceHue = Math.atan2(source[2], source[1]) * 180 / Math.PI;
		const targetHue = Math.atan2(target[2], target[1]) * 180 / Math.PI;
		hue = Math.round(targetHue - sourceHue);
		while (hue > 180) hue -= 360;
		while (hue < -180) hue += 360;
		hue = Math.max(-options.maxHueShift, Math.min(options.maxHueShift, hue));
		if (Math.abs(hue) < 2) hue = 0;
	}
	return hue !== 0 || saturation !== 100 ? { hue, saturation, brightness: 100 } : null;
}

function hexToLab(value) {
	const hex = String(value || '').replace('#', '');
	if (!/^[0-9a-f]{6}$/i.test(hex)) return GlitterPaletteAnalysis.rgbToOklab(128, 128, 128);
	return GlitterPaletteAnalysis.rgbToOklab(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
}
