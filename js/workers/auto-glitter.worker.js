importScripts('../effects/palette-analysis.js?v=5de64065');

importScripts('../effects/color-adjust.js?v=7bd60e2a');

let segmentCache = null;

self.onmessage = ({ data }) => {
	const requestId = data.requestId;
	try {
		if (data.type === 'segment') {
			const imageData = { data: new Uint8ClampedArray(data.pixels), width: data.width, height: data.height };
			applyColorAdjustToImageData(imageData, data.sourceAdjust);
			segmentCache = GlitterPaletteAnalysis.segmentImage(imageData.data, data.width, data.height, data.options);
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
		const rgb = swatch.colors.map(hexToRgb);
		const colors = rgb.map(color => GlitterPaletteAnalysis.rgbToOklab(...color));
		const weights = normalizeWeights(swatch.weights, colors.length);
		const eligible = colors.map((_color, index) => index).filter(index => colors.length === 1 || weights[index] >= options.swatchMinCoverage);
		return { ...swatch, rgb, weights, eligible: eligible.length ? eligible : [0], adjusted: new Map(), averageChroma: colors.reduce((sum, color, index) => sum + GlitterPaletteAnalysis.labChroma(color) * weights[index], 0) };
	});
	// One batch reads best on one frame timing: swatches off the pool's most
	// common timing must be clearly closer in color to win.
	const timingCounts = new Map();
	preparedSwatches.forEach(swatch => timingCounts.set(swatch.timing, (timingCounts.get(swatch.timing) || 0) + 1));
	const commonTiming = [...timingCounts].reduce((best, entry) => entry[1] > best[1] ? entry : best, [null, 0])[0];
	const timingPenalty = swatch => swatch.timing === commonTiming ? 1 : 1 + (options.swatchTimingBias || 0);
	const neutralSwatches = preparedSwatches.filter(swatch => swatch.averageChroma < options.hueMinChroma * 0.25);
	const scoreSwatches = (entry) => {
		const neutral = GlitterPaletteAnalysis.labChroma(entry.lab) < options.hueMinChroma;
		const candidatesForEntry = neutral && neutralSwatches.length ? neutralSwatches : preparedSwatches;
		// The closest color wins as the glitter is; correction then refines it.
		return candidatesForEntry.map(swatch => ({ swatch, cost: swatchCost(swatch, COLOR_ADJUST_IDENTITY, entry.lab, options) * timingPenalty(swatch) }));
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
		entry.suggestedColorAdjust = getSuggestedColorAdjust(pick.match.swatch, entry.lab, options);
	}
	pending.forEach(({ entry }) => {
		entry.suggestedGlitterId = null;
		entry.suggestedColorAdjust = getSuggestedColorAdjust(null, entry.lab, options);
	});
}

// The swatch's colors under an adjustment, through the matrix the preview
// and the export apply: a hue-rotate degree is not an OKLab hue degree, and it
// moves lightness with it.
function swatchColorsAt(swatch, adjust) {
	const key = `${adjust.hue},${adjust.saturation},${adjust.brightness}`;
	let colors = swatch.adjusted.get(key);
	if (!colors) {
		const matrix = composeColorAdjustMatrix(adjust);
		const channel = (color, row) => Math.min(255, Math.max(0, Math.round(matrix[row] * color[0] + matrix[row + 1] * color[1] + matrix[row + 2] * color[2])));
		colors = swatch.rgb.map(color => GlitterPaletteAnalysis.rgbToOklab(channel(color, 0), channel(color, 3), channel(color, 6)));
		swatch.adjusted.set(key, colors);
	}
	return colors;
}

// Distance from a region to a swatch: mostly its main color, partly whichever
// of its colors is nearest, a color that covers little of it counting for less.
function swatchCost(swatch, adjust, target, options) {
	const colors = swatchColorsAt(swatch, adjust);
	const closest = swatch.eligible.reduce((best, index) => Math.min(best,
		GlitterPaletteAnalysis.distanceSquared(target, colors[index]) * (1 + options.swatchCoverageBias * (1 - swatch.weights[index]))), Infinity);
	return GlitterPaletteAnalysis.distanceSquared(target, colors[0]) * options.swatchPrimaryWeight + closest * (1 - options.swatchPrimaryWeight);
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

// The matched swatch's adjustment: hue, then saturation and brightness, each
// moved toward the region as far as its own limit allows and no further than
// the gain is worth. Every candidate is scored as it renders. A neutral region
// takes its glitter's color away, and the palette style scales the result.
function getSuggestedColorAdjust(swatch, target, options) {
	const neutral = GlitterPaletteAnalysis.labChroma(target) < options.hueMinChroma;
	const tone = options.matchTone;
	let best = { hue: 0, saturation: neutral ? options.neutralMatchSaturation : 100, brightness: 100 };
	if (swatch) {
		const base = { ...best };
		const score = (candidate) => swatchCost(swatch, candidate, target, options) * (1
			+ options.swatchHueShiftBias * Math.abs(candidate.hue) / 180
			+ tone.shiftBias * (Math.abs(candidate.saturation - base.saturation) + Math.abs(candidate.brightness - base.brightness)) / 100);
		let bestCost = score(best);
		const consider = (axis, value) => {
			const candidate = { ...best, [axis]: value };
			const cost = score(candidate);
			if (cost < bestCost) { best = candidate; bestCost = cost; }
		};
		// Coarse steps across the limit, then each degree around the best of them.
		if (!neutral && swatch.averageChroma >= options.hueMinChroma) {
			for (let shift = options.hueSearchStep; shift <= options.maxHueShift; shift += options.hueSearchStep) { consider('hue', shift); consider('hue', -shift); }
			const coarse = best.hue;
			for (let offset = 1; offset < options.hueSearchStep; offset++) {
				for (const hue of [coarse + offset, coarse - offset]) if (Math.abs(hue) <= options.maxHueShift) consider('hue', hue);
			}
		}
		const limits = { saturation: neutral ? 0 : options.maxSaturationShift, brightness: options.maxBrightnessShift };
		for (let round = 0; round < tone.rounds; round++) {
			for (const [axis, limit] of Object.entries(limits)) {
				for (let shift = tone.step; shift <= limit; shift += tone.step) { consider(axis, base[axis] + shift); consider(axis, Math.max(0, base[axis] - shift)); }
			}
		}
	}
	if (!neutral) best.saturation = Math.min(tone.saturationCeiling, Math.round(best.saturation * options.matchedSaturation / 100));
	return isIdentityColorAdjust(best) ? null : best;
}

function hexToRgb(value) {
	const hex = String(value || '').replace('#', '');
	if (!/^[0-9a-f]{6}$/i.test(hex)) return [128, 128, 128];
	return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}
