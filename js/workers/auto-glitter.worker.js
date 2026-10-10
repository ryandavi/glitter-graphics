importScripts('../effects/palette-analysis.js?v=41b8b251');

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
			if (data.options.foldSharedMatches) foldSharedMatches(result);
			self.postMessage({ type: 'result', requestId, ...result }, [result.labels.buffer]);
			return;
		}
		throw new Error('Unknown Auto Glitter worker request.');
	} catch (error) {
		self.postMessage({ type: 'error', requestId, error: error?.message || 'Image analysis failed.' });
	}
};

function assignSuggestedSwatches(palette, swatches, options) {
	const preparedSwatches = swatches.map(swatch => {
		const colors = swatch.colors.map(hexToLab);
		const weights = normalizeWeights(swatch.weights, colors.length);
		return { ...swatch, colors, weights, primary: colors[0], averageChroma: colors.reduce((sum, color, index) => sum + GlitterPaletteAnalysis.labChroma(color) * weights[index], 0) };
	});
	// One batch reads best on one frame timing: swatches off the pool's most
	// common timing must be clearly closer in color to win.
	const timingCounts = new Map();
	preparedSwatches.forEach(swatch => timingCounts.set(swatch.timing, (timingCounts.get(swatch.timing) || 0) + 1));
	const commonTiming = [...timingCounts].reduce((best, entry) => entry[1] > best[1] ? entry : best, [null, 0])[0];
	const timingPenalty = swatch => swatch.timing === commonTiming ? 1 : 1 + (options.swatchTimingBias || 0);
	const neutralSwatches = preparedSwatches.filter(swatch => swatch.averageChroma < options.hueMinChroma * 0.25);
	const scoreSwatches = (entry) => {
		const candidatesForEntry = GlitterPaletteAnalysis.labChroma(entry.lab) < options.hueMinChroma && neutralSwatches.length
			? neutralSwatches
			: preparedSwatches;
		return candidatesForEntry.map((swatch) => {
			const eligible = swatch.colors.map((color, colorIndex) => ({ color, colorIndex }))
				.filter(item => swatch.colors.length === 1 || swatch.weights[item.colorIndex] >= options.swatchMinCoverage);
			const candidates = eligible.length ? eligible : [{ color: swatch.colors[0], colorIndex: 0 }];
			const closest = candidates.reduce((best, item) => {
				const penalty = 1 + options.swatchCoverageBias * (1 - swatch.weights[item.colorIndex]);
				const distance = GlitterPaletteAnalysis.distanceSquared(entry.lab, item.color) * penalty;
				return distance < best.distance ? { ...item, distance, penalty } : best;
			}, { color: candidates[0].color, colorIndex: candidates[0].colorIndex, distance: Infinity, penalty: 1 });
			const cost = (GlitterPaletteAnalysis.distanceSquared(entry.lab, swatch.primary) * options.swatchPrimaryWeight
				+ GlitterPaletteAnalysis.distanceSquared(entry.lab, closest.color) * closest.penalty * (1 - options.swatchPrimaryWeight)) * timingPenalty(swatch);
			return { swatch, color: closest.color, cost };
		});
	};
	// Regions claim swatches closest match first. A swatch already claimed costs
	// `swatchReusePenalty` more per claim, so two regions share one glitter only
	// when nothing else in the pool is near.
	const claims = new Map();
	const pending = palette.map(entry => ({ entry, matches: scoreSwatches(entry) }));
	while (pending.length) {
		let pick = null;
		pending.forEach((item, position) => {
			for (const match of item.matches) {
				const cost = match.cost + (claims.get(match.swatch) || 0) * (options.swatchReusePenalty || 0);
				if (!pick || cost < pick.cost) pick = { position, match, cost };
			}
		});
		if (!pick) break;
		const [{ entry }] = pending.splice(pick.position, 1);
		claims.set(pick.match.swatch, (claims.get(pick.match.swatch) || 0) + 1);
		entry.suggestedGlitterId = pick.match.swatch.id;
		entry.suggestedColorAdjust = getSuggestedColorAdjust(pick.match.color, entry.lab, options);
	}
	pending.forEach(({ entry }) => {
		entry.suggestedGlitterId = null;
		entry.suggestedColorAdjust = getSuggestedColorAdjust(null, entry.lab, options);
	});
}

// Regions left on one glitter with one adjustment would make identical
// layers; they become one region. Two always remain.
function foldSharedMatches(result) {
	const { palette, labels } = result;
	const target = palette.map((_entry, index) => index);
	let remaining = palette.length;
	for (let index = 1; index < palette.length && remaining > 2; index++) {
		const entry = palette[index];
		if (entry.suggestedGlitterId == null) continue;
		const match = palette.findIndex((other, otherIndex) => otherIndex < index && target[otherIndex] === otherIndex
			&& other.suggestedGlitterId === entry.suggestedGlitterId
			&& JSON.stringify(other.suggestedColorAdjust) === JSON.stringify(entry.suggestedColorAdjust));
		if (match < 0) continue;
		const kept = palette[match];
		const combinedCount = kept.count + entry.count;
		for (const key of ['r', 'g', 'b']) kept[key] = Math.round((kept[key] * kept.count + entry[key] * entry.count) / combinedCount);
		kept.lab = kept.lab.map((value, channel) => (value * kept.count + entry.lab[channel] * entry.count) / combinedCount);
		kept.count = combinedCount;
		target[index] = match;
		remaining--;
	}
	if (remaining === palette.length) return;
	const order = target.map((_value, index) => index).filter(index => target[index] === index).sort((left, right) => palette[right].count - palette[left].count);
	const remap = target.map(index => order.indexOf(index));
	for (let index = 0; index < labels.length; index++) if (labels[index] !== 255) labels[index] = remap[labels[index]];
	result.palette = order.map(index => palette[index]);
}

// Shares of the swatch each color covers, summing to one; equal shares where
// the catalog has none.
function normalizeWeights(weights, length) {
	const values = Array.isArray(weights) && weights.length === length ? weights.map(weight => Math.max(0, Number(weight) || 0)) : [];
	const total = values.reduce((sum, weight) => sum + weight, 0);
	return total > 0 ? values.map(weight => weight / total) : Array.from({ length }, () => 1 / length);
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
