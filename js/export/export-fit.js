'use strict';

// Fitting an export under a file-size target, as plain rules: which settings
// to lower for the next attempt, and what to say about the result. DOM-free so
// the rules run under node; the export flow runs the attempts.

// Settings that only change how composed GIF frames are encoded. Attempts that
// differ in these alone re-encode the same frames (GifExporter).
const GIF_ENCODE_ONLY_SETTINGS = Object.freeze([
	'colorCount', 'paletteStyle', 'quality', 'ditherPreset', 'ditherEnabled', 'ditherType',
	'ditherAmount', 'ditherScale', 'ditherTemporalMode', 'ditherEdgeProtection',
	'targetSize', 'targetSizeKB'
]);

// One entry per setting a fit may lower.
// - size(value): a number that is smaller for a smaller file.
// - factor(value, estimate): the expected share of the full-size file.
// - describe(value): how the result names the change.
// - companions: settings the step also writes so that its value takes effect.
const FIT_LEVERS = Object.freeze({
	exportFidelity: {
		size: (value) => -Number(value),
		factor: (value, estimate) => estimate.fidelityStops[value] ?? 1,
		describe: (value) => `${CONFIG.export.timeline.fidelityStops[value].label} fidelity`,
		// A stop only governs these two while they follow it.
		companions: { maxSamplingFps: 'auto', visualErrorThreshold: 'auto' }
	},
	ditherEnabled: {
		size: (value) => (value ? 1 : 0),
		factor: (value, estimate) => (value ? 1 : estimate.ditherOff),
		describe: () => 'dithering off'
	},
	colorCount: {
		size: (value) => (value === 'auto' ? CONFIG.export.limits.colorAnalysis.paletteSize : Number(value)),
		factor: (value, estimate) => estimate.colorHalving ** Math.log2(CONFIG.export.limits.colorAnalysis.paletteSize / FIT_LEVERS.colorCount.size(value)),
		describe: (value) => `${value} colors`
	},
	jpegQuality: {
		size: Number,
		factor: (value, estimate) => (value / 100) ** estimate.jpegQualityExponent,
		describe: (value) => `JPG quality ${value}`
	},
	mp4Bitrate: {
		size: Number,
		factor: () => 1,
		describe: (value) => `${Math.round(value / 1000)} kbps`
	},
	outputScale: {
		size: Number,
		factor: (value, estimate) => (value / 100) ** estimate.scaleExponent,
		describe: (value) => `${value}% size`
	}
});

function formatSizeLimit(limitKB) {
	return limitKB >= 1024 ? `${Number((limitKB / 1024).toFixed(1))} MB` : `${Math.round(limitKB)} KB`;
}

// A size target as a fit goal: { id, label, limitBytes }. The label reads
// after "under": "10 MB for Discord".
function describeSizeTarget(target) {
	return { id: target.id, label: `${formatSizeLimit(target.limitKB)} for ${target.service}`, limitBytes: target.limitKB * 1024 };
}

// The standing Target Size of the export settings, or null.
function resolveFitTarget(settings) {
	if (settings.targetSize === 'custom') {
		return { id: 'custom', label: formatSizeLimit(settings.targetSizeKB), limitBytes: settings.targetSizeKB * 1024 };
	}
	const target = CONFIG.export.sizeTargets.find((entry) => entry.id === settings.targetSize);
	return target ? describeSizeTarget(target) : null;
}

// The bitrate an MP4 attempt encodes at: the fit's own, or the quality preset's.
function resolveMp4Bitrate(settings) {
	return settings.mp4Bitrate || CONFIG.export.mp4.qualityPresets[settings.mp4Quality].bitrate;
}

// The ladder for one export: cumulative overrides per step, step 0 being the
// settings as they are.
function buildFitLadder(target, settings) {
	const steps = [{}];
	let overrides = {};
	CONFIG.export.fit.ladder.forEach((step) => {
		const [key, value] = Object.entries(step)[0];
		const lever = FIT_LEVERS[key];
		const current = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : settings[key];
		if (!target.fitLevers.includes(key) || !(lever.size(value) < lever.size(current))) return;
		overrides = { ...overrides, ...lever.companions, [key]: value };
		steps.push(overrides);
	});
	return steps;
}

function estimateFitFactor(target, settings, overrides) {
	const estimate = CONFIG.export.fit.estimate;
	const state = { ...settings, ...overrides };
	return target.fitLevers.reduce((factor, key) => factor * FIT_LEVERS[key].factor(state[key], estimate), 1);
}

// What a fit changed, for the result: "75% size, 128 colors".
function describeFitOverrides(overrides) {
	return Object.keys(FIT_LEVERS)
		.filter((key) => Object.prototype.hasOwnProperty.call(overrides, key))
		.map((key) => FIT_LEVERS[key].describe(overrides[key]))
		.join(', ');
}

// Decides the next attempt from the measured ones. `attempts` is
// [{ step, overrides, bytes }], the first being the export as set.
// Returns { step, overrides } to export next, or { done, best, reached }
// naming the attempt to keep.
function planFitAttempt({ target, settings, limitBytes, attempts }) {
	const fit = CONFIG.export.fit;
	const goal = limitBytes * fit.margin;
	const fits = (attempt) => attempt.bytes <= limitBytes;
	const pick = (list, better) => list.reduce((chosen, attempt) => (chosen === null || better(attempt, chosen) ? attempt : chosen), null);
	// The largest file that fits, else the smallest that does not.
	const best = pick(attempts.filter(fits), (a, b) => a.bytes > b.bytes) || pick(attempts, (a, b) => a.bytes < b.bytes);
	const finish = () => ({ done: true, best: attempts.indexOf(best), reached: fits(best) });
	if (attempts.length >= fit.maxAttempts) return finish();

	const last = attempts[attempts.length - 1];
	const bitrate = target.fitLevers.includes('mp4Bitrate') ? resolveMp4Bitrate({ ...settings, ...last.overrides }) : 0;
	if (bitrate) {
		// Bitrate sets an MP4's size almost directly, so it is solved, not stepped.
		if (fits(last)) return finish();
		if (bitrate > fit.minMp4Bitrate) {
			const next = Math.max(fit.minMp4Bitrate, Math.floor(bitrate * goal / last.bytes));
			return { step: last.step, overrides: { ...last.overrides, mp4Bitrate: next } };
		}
	}

	const ladder = buildFitLadder(target, settings);
	const failing = attempts.filter((attempt) => !fits(attempt));
	const passing = attempts.filter(fits);
	const low = pick(failing, (a, b) => a.step > b.step);
	const high = pick(passing, (a, b) => a.step < b.step);
	const from = low ? low.step + 1 : 1;
	const to = high ? high.step - 1 : ladder.length - 1;
	if (from > to || (high && high.bytes >= limitBytes * fit.acceptRatio)) return finish();

	// Predict from the measured attempt nearest the candidate.
	const predict = (step) => {
		const reference = !low || (high && high.step - step < step - low.step) ? high : low;
		return reference.bytes * estimateFitFactor(target, settings, ladder[step]) / estimateFitFactor(target, settings, ladder[reference.step]);
	};
	let step = from;
	while (step <= to && predict(step) > goal) step++;
	if (step > to) {
		// Nothing between is predicted to fit: keep the fit there is, or go to
		// the floor when there is none.
		if (high) return finish();
		step = to;
	}
	return { step, overrides: { ...ladder[step], ...(bitrate ? { mp4Bitrate: bitrate } : {}) } };
}

// The fit as Export Ready reports it.
function summarizeFit({ goal, attempts, best, reached }) {
	return {
		label: goal.label,
		reached,
		changes: describeFitOverrides(attempts[best].overrides),
		attempts: attempts.map((attempt, index) => ({
			changes: describeFitOverrides(attempt.overrides) || 'As set',
			bytes: attempt.bytes,
			fits: attempt.bytes <= goal.limitBytes,
			chosen: index === best
		}))
	};
}
