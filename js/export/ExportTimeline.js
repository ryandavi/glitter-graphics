// Export timeline planning primitives. Loaded before SceneCompositor and the exporters.
class AuthoredAnimationSource {
	constructor({ key, label = null, rowLabel = null, ownerLayerId = null, effectSlot = null, frameCount = 0, frameDurations = [], fallbackDuration = 100, fileCycleDuration = null, periodRange = null, resolvePeriod = null, setPeriod = null, retimeDelays = null }) {
		this.kind = 'authored';
		this.key = key;
		this.label = label;
		this.rowLabel = rowLabel;
		this.ownerLayerId = ownerLayerId;
		this.effectSlot = effectSlot;
		this.frameCount = Math.max(0, Math.floor(Number(frameCount) || 0));
		this.isStatic = this.frameCount <= 1;
		this.frameDurations = Array.from({ length: this.frameCount }, (_, index) => AuthoredAnimationSource.normalizeDuration(
			frameDurations[index],
			fallbackDuration
		));
		this.cumulativeBoundaries = [0];
		this.frameDurations.forEach((duration) => {
			this.cumulativeBoundaries.push(this.cumulativeBoundaries.at(-1) + duration);
		});
		this.cycleDuration = this.isStatic ? Infinity : this.cumulativeBoundaries.at(-1);
		this.cycleMarks = this.cumulativeBoundaries.slice(1, -1).map(ms => ms / this.cycleDuration);
		// A GIF whose cycle can be set reads like any source with a speed:
		// loop fitting takes its period, range and setter by the same names.
		// The kind stays authored, so only a user action ever calls the setter.
		this.naturalPeriod = this.cycleDuration;
		Object.assign(this, { fileCycleDuration, periodRange, resolvePeriod, setPeriod, retimeDelays });
	}

	// A copy playing one pass in `period`, as its setter would leave it.
	get displayLabel() { return this.label || String(this.key); }

	atPeriod(period) {
		return new AuthoredAnimationSource({ ...this, frameDurations: this.retimeDelays?.(period) || this.frameDurations });
	}

	static normalizeDuration(duration, fallback = 100) {
		return normalizeFrameDuration(duration, fallback);
	}

	frameIndexAt(timestamp) {
		if (this.isStatic || !Number.isFinite(this.cycleDuration)) return 0;
		const cycleTime = ((timestamp % this.cycleDuration) + this.cycleDuration) % this.cycleDuration;
		let low = 0;
		let high = this.frameDurations.length;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if (this.cumulativeBoundaries[middle + 1] <= cycleTime) low = middle + 1;
			else high = middle;
		}
		return Math.min(low, Math.max(0, this.frameCount - 1));
	}

	sampleAt(timestamp) {
		return { frameIndex: this.frameIndexAt(timestamp) };
	}

	boundariesUntil(duration) {
		if (this.isStatic || !Number.isFinite(this.cycleDuration)) return [];
		const boundaries = [];
		for (let offset = 0; offset < duration; offset += this.cycleDuration) {
			for (let index = 1; index < this.cumulativeBoundaries.length; index++) {
				const timestamp = offset + this.cumulativeBoundaries[index];
				if (timestamp > 0 && timestamp < duration) boundaries.push(timestamp);
			}
		}
		return boundaries;
	}

	// Every native frame occurrence inside [0, duration), as half-open intervals.
	// `clipped` marks an occurrence the composite seam cut short: a deliberately
	// truncated terminal fragment must not force an absurd global cadence just to
	// be sampled.
	occurrencesUntil(duration) {
		if (this.isStatic || !Number.isFinite(this.cycleDuration)) return [];
		const occurrences = [];
		for (let offset = 0; offset < duration; offset += this.cycleDuration) {
			for (let index = 0; index < this.frameDurations.length; index++) {
				const start = offset + this.cumulativeBoundaries[index];
				if (start >= duration) break;
				const end = offset + this.cumulativeBoundaries[index + 1];
				occurrences.push({ index, start, end: Math.min(end, duration), clipped: end > duration });
			}
		}
		return occurrences;
	}
}

class ProceduralAnimationSource {
	constructor({ key, label = null, rowLabel = null, ownerLayerId = null, effectSlot = null, naturalPeriod, phase = 0, direction = 'normal', cycleMarks, keyTrack = null, preferredSamplingRate, sampler, resolvedPeriod = null, setPeriod = null, setRun = null, setPhase = null, setDirection = null, periodRange = null, resolvePeriod = null, nonLooping = false, run = null, closesAt = null }) {
		this.kind = 'procedural';
		this.key = key;
		this.label = label;
		this.rowLabel = rowLabel;
		this.ownerLayerId = ownerLayerId;
		this.effectSlot = effectSlot;
		this.naturalPeriod = Math.max(1, Number(naturalPeriod));
		this.resolvedPeriod = Number.isFinite(resolvedPeriod) ? Math.max(1, Number(resolvedPeriod)) : this.naturalPeriod;
		this.phase = Number(phase) || 0;
		this.direction = direction;
		this.cycleMarks = cycleMarks;
		this.keyTrack = keyTrack;
		this.preferredSamplingRate = Math.max(1, Number(preferredSamplingRate));
		this.sampler = sampler;
		Object.assign(this, { setPeriod, setRun, setPhase, setDirection, periodRange, resolvePeriod, nonLooping, run, closesAt });
	}

	withPeriod(resolvedPeriod) {
		return new ProceduralAnimationSource({
			key: this.key,
			label: this.label,
			rowLabel: this.rowLabel, cycleMarks: this.cycleMarks, keyTrack: this.keyTrack, direction: this.direction,
			ownerLayerId: this.ownerLayerId,
			effectSlot: this.effectSlot,
			naturalPeriod: this.naturalPeriod,
			phase: this.phase,
			preferredSamplingRate: this.preferredSamplingRate,
			sampler: this.sampler,
			resolvedPeriod,
			setPeriod: this.setPeriod, setRun: this.setRun, setPhase: this.setPhase, setDirection: this.setDirection, periodRange: this.periodRange, resolvePeriod: this.resolvePeriod, nonLooping: this.nonLooping,
			run: this.run, closesAt: this.closesAt
		});
	}

	// A copy with `period` as its own, as its setter would leave it.
	get displayLabel() { return this.label || String(this.key); }

	atPeriod(period) {
		return new ProceduralAnimationSource({ ...this, naturalPeriod: period, resolvedPeriod: period });
	}

	sampleAt(timestamp) {
		return this.sampler(timestamp, this.resolvedPeriod, this.phase);
	}
}

function sourceSeamError(source, duration, period = source.resolvedPeriod || source.cycleDuration) {
	if (source.run && source.closesAt) return source.closesAt(duration, period) ? 0 : 1;
	const remainder = duration % period;
	return Math.min(remainder, period - remainder) / period;
}

function loopSeamForDuration(sources, duration) {
	const errors = sources.filter(source => source.kind === 'procedural' || Number.isFinite(source.cycleDuration))
		.map(source => sourceSeamError(source, duration));
	const completedSources = errors.filter(error => error < 1e-8).length;
	return { duration, exact: completedSources === errors.length, seamError: errors.reduce((sum, error) => sum + error, 0), completedSources };
}

// Period fitting always runs against the duration the format will actually
// represent, never an earlier ideal one — quantizing the clock after the fit
// would reopen a seam the planner believed closed.
function fitProceduralPeriods(procedural, duration, tolerance) {
	const fits = procedural.map((source) => {
		const room = duration - (source.run?.start || 0);
		const cycles = Math.max(1, Math.round(room / source.naturalPeriod));
		const fittedPeriod = source.nonLooping ? source.naturalPeriod : room / cycles;
		const drift = Math.abs(fittedPeriod - source.naturalPeriod) / source.naturalPeriod;
		return { source, cycles, fittedPeriod, drift, fitted: fittedPeriod > 0 && drift <= tolerance };
	});
	return {
		fits,
		maximumDrift: fits.length ? Math.max(...fits.map((fit) => fit.drift)) : 0,
		totalDrift: fits.reduce((sum, fit) => sum + fit.drift, 0),
		// The fallback is per source, not all-or-nothing: an effect that cannot fit
		// keeps its configured period and crosses the seam out of phase.
		toleranceMisses: fits.filter((fit) => !fit.fitted).length
	};
}

// Timing only. Writable sources own their representable periods and setters;
// fixed procedural steps have the same closure constraints as uploaded GIFs.
function planLoopFit(timelines, { config, maxLoopDurationMs = config.maxLoopDurationMs, fallbackDuration = 100, loopDurationMs = null } = {}) {
	const planner = new CompositeTimelinePlanner(config);
	const animated = timelines.filter((source) => source.kind === 'procedural' || Number.isFinite(source.cycleDuration));
	const oneShots = animated.filter((source) => source.nonLooping);
	const repeating = animated.filter((source) => !source.nonLooping);
	const adjustable = repeating.filter((source) => typeof source.setPeriod === 'function');
	const fixed = repeating.filter((source) => typeof source.setPeriod !== 'function').map((source) => ({
		source, cycleDuration: source.kind === 'procedural' ? source.naturalPeriod : source.cycleDuration
	}));
	const fixedLoop = planner._chooseLoopDuration(fixed, fallbackDuration, maxLoopDurationMs);
	const durations = repeating.length
		? planner._loopCandidateDurations(fixed, [...adjustable, ...oneShots], fixedLoop, maxLoopDurationMs)
		: oneShots.length ? planner._loopCandidateDurations([], oneShots, fixedLoop, maxLoopDurationMs) : new Set();
	if (Number.isFinite(loopDurationMs)) durations.add(loopDurationMs);
	const candidates = [...durations].sort((a, b) => a - b).map((duration) => {
		const fits = fitProceduralPeriods(adjustable, duration, Infinity).fits.map((fit) => {
			const { source } = fit;
			const range = source.periodRange || { min: 1, max: Infinity };
			const room = duration - (source.run?.start || 0);
			// Consider other cycle counts when the nearest period is out of range.
			const minCycles = Math.max(1, Math.ceil(room / range.max));
			const maxCycles = Math.floor(room / range.min);
			let best = null;
			for (let cycles = minCycles; cycles <= maxCycles; cycles++) {
				const requested = room / cycles;
				const fittedPeriod = source.resolvePeriod ? source.resolvePeriod(requested) : requested;
				if (fittedPeriod < range.min || fittedPeriod > range.max || Math.abs(fittedPeriod - requested) > 0.01) continue;
				const drift = Math.abs(fittedPeriod - source.naturalPeriod) / source.naturalPeriod;
				if (!best || drift < best.drift) best = { source, cycles, fittedPeriod, drift, fitted: true };
			}
			return best || { ...fit, fitted: false };
		});
		const fixedSeamError = fixed.reduce((sum, entry) => {
			return sum + sourceSeamError(entry.source, duration, entry.cycleDuration);
		}, 0);
		const cannotFit = fits.filter((fit) => !fit.fitted);
		return {
			duration, fits, cannotFit, fixedSeamError,
			exact: fixedSeamError < 1e-8 && !cannotFit.length
				&& fits.every((fit) => sourceSeamError(fit.source, duration, fit.fittedPeriod) < 1e-8)
				&& oneShots.every((source) => sourceSeamError(source, duration) < 1e-8),
			canApply: !cannotFit.length && fits.some((fit) => Math.abs(fit.fittedPeriod - fit.source.naturalPeriod) > 0.01),
			maximumDrift: fits.length ? Math.max(...fits.map((fit) => fit.drift)) : 0
		};
	});
	return { candidates, fixed: fixed.map((entry) => entry.source), oneShots, fixedLoop, sources: animated };
}

// Timings that would export fewer frames. Each loop candidate that closes is
// applied to copies of the sources and planned by `plan`, the export's own
// planner, so an option's frame count is the one that fit would produce.
// Speed changes are measured against `originalPeriod`, the timing from before
// any fit, and capped. The option nearest that timing is listed first.
async function planFrameOptions(timelines, loopFit, currentFrameCount, { config, plan, originalPeriod = (source) => source.naturalPeriod }) {
	const adjustable = loopFit.sources.filter((source) => typeof source.setPeriod === 'function' && !source.nonLooping);
	const candidates = loopFit.candidates.filter((candidate) => candidate.exact && candidate.canApply).map((candidate) => {
		const fits = candidate.fits.filter((fit) => Math.abs(fit.fittedPeriod - fit.source.naturalPeriod) > 0.01);
		const periods = new Map(fits.map((fit) => [fit.source, fit.fittedPeriod]));
		const speedChange = adjustable.reduce((most, source) => {
			const original = originalPeriod(source);
			return Math.max(most, Math.abs((periods.get(source) ?? source.naturalPeriod) - original) / original);
		}, 0);
		return { fits, periods, speedChange, duration: candidate.duration };
	}).filter((candidate) => candidate.speedChange <= config.maximumSpeedChange)
		// A shorter loop is where the frames are saved.
		.sort((left, right) => left.duration - right.duration)
		.slice(0, config.candidateLimit);
	const saving = [];
	for (const candidate of candidates) {
		const result = await plan(timelines.map((source) => (candidate.periods.has(source) ? source.atPeriod(candidate.periods.get(source)) : source)));
		if (!result.loopSeam.exact || result.frameCount > currentFrameCount * (1 - config.minimumSaving)) continue;
		saving.push({ fits: candidate.fits, speedChange: candidate.speedChange, duration: result.totalDuration, frameCount: result.frameCount });
	}
	const first = (...keys) => [...saving].sort((left, right) => keys.reduce((order, key) => order || left[key] - right[key], 0))[0];
	const options = [];
	if (saving.length) {
		const closest = first('speedChange', 'frameCount');
		const fewest = first('frameCount', 'speedChange');
		if (closest !== fewest) options.push({ kind: 'closest', ...closest });
		options.push({ kind: 'fewest', ...fewest });
	}
	return { frameCount: currentFrameCount, optimizable: options.length > 0, options };
}

// A committed clock is the single owner of displayed time: its frame-start
// timestamps in [0, duration) are what sources get sampled at and what the
// encoder gets told, with no second rounding downstream. It carries timing
// metadata only — candidate evaluation never renders a pixel.
class RenderClock {
	static preferredRate(context) {
		const preferred = context.procedural.reduce((rate, source) => Math.max(rate, source.preferredSamplingRate), 0);
		return Math.max(1, Math.min(context.maxSamplingFps, preferred || context.maxSamplingFps));
	}

	static preferredInterval(context) {
		return 1000 / RenderClock.preferredRate(context);
	}

	static firstIndexAtOrAfter(timestamps, time) {
		let low = 0;
		let high = timestamps.length;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if (timestamps[middle] < time) low = middle + 1;
			else high = middle;
		}
		return low;
	}

	static authoredCoverage(authored, timestamps, duration) {
		let authoredOccurrencesMissed = 0;
		let clippedOccurrencesMissed = 0;
		authored.forEach((source) => {
			source.occurrencesUntil(duration).forEach((occurrence) => {
				const index = RenderClock.firstIndexAtOrAfter(timestamps, occurrence.start);
				if (index < timestamps.length && timestamps[index] < occurrence.end) return;
				if (occurrence.clipped) clippedOccurrencesMissed++;
				else authoredOccurrencesMissed++;
			});
		});
		return { authoredOccurrencesMissed, clippedOccurrencesMissed };
	}

	// Frame-start sampling means an authored transition can appear late but never
	// early, so the error that matters is how long after its native boundary the
	// first output frame starts — not the distance to the nearest sample.
	static boundaryLateness(authored, timestamps, duration) {
		let maximum = 0;
		authored.forEach((source) => {
			source.boundariesUntil(duration).forEach((boundary) => {
				const index = RenderClock.firstIndexAtOrAfter(timestamps, boundary);
				const displayed = index < timestamps.length ? timestamps[index] : duration;
				maximum = Math.max(maximum, displayed - boundary);
			});
		});
		return maximum;
	}

	static build(mode, targetDuration, delays, context, { outputFps = null, timestamps = null, duration = null } = {}) {
		let starts = timestamps;
		if (!starts) {
			starts = new Array(delays.length);
			let elapsed = 0;
			for (let index = 0; index < delays.length; index++) {
				starts[index] = elapsed;
				elapsed += delays[index];
			}
		}
		const realizedDuration = duration ?? delays.reduce((sum, delay) => sum + delay, 0);
		const minimumDelay = Math.min(...delays);
		const maximumDelay = Math.max(...delays);
		const preferredInterval = RenderClock.preferredInterval(context);
		// A variable-delay GIF can average near the preference while still holding
		// a visibly long step, so smoothness is judged on the worst actual gap.
		const cadenceShortfall = context.procedural.length ? Math.max(0, maximumDelay - preferredInterval) : 0;
		const lateness = RenderClock.boundaryLateness(context.authored, starts, realizedDuration);
		return {
			mode,
			targetDuration,
			duration: realizedDuration,
			frameCount: delays.length,
			timestamps: starts,
			delays,
			outputFps,
			candidateRank: context.candidateRank,
			lockAuthored: Boolean(context.lockAuthored),
			lockedRateAllowance: context.lockedRateAllowance || 1,
			procedural: fitProceduralPeriods(context.procedural, realizedDuration, context.tolerance),
			diagnostics: {
				...RenderClock.authoredCoverage(context.authored, starts, realizedDuration),
				maximumAuthoredBoundaryLateness: lateness,
				minimumDelay,
				maximumDelay,
				delaySpread: maximumDelay - minimumDelay,
				averageFps: realizedDuration > 0 ? delays.length * 1000 / realizedDuration : 0,
				preferredInterval,
				cadenceShortfall,
				cadenceShortfallBucket: Math.ceil((cadenceShortfall / preferredInterval) / context.cadenceShortfallTolerance),
				// Lateness under one preferred interval is the unavoidable cost of
				// frame-start sampling, so it only separates candidates once it grows
				// beyond that — otherwise every ranking would just demand the finest
				// possible cadence and export cost would never be consulted.
				latenessBucket: Math.ceil(Math.max(0, lateness - preferredInterval) / preferredInterval)
			}
		};
	}

	// Explicit lexicographic constraints and tie-breaks rather than an opaque
	// weighted score: authored coverage first, then source-timing fidelity, then
	// cadence quality, and only then export cost. Authored source mutation is
	// never one of the tradeoffs.
	static rankKeys(clock) {
		const diagnostics = clock.diagnostics;
		return [
			diagnostics.authoredOccurrencesMissed,
			// Glitter-locked: a frame animation's frames play for their own time
			// before motion fit or smoothness is considered.
			clock.lockAuthored ? Math.round(diagnostics.maximumAuthoredBoundaryLateness) : 0,
			// ...and no faster than the preferred rate unless the frames need it,
			// so exact glitter does not cost a bigger file on its own.
			clock.lockAuthored && diagnostics.averageFps > (1000 / diagnostics.preferredInterval) * clock.lockedRateAllowance ? 1 : 0,
			clock.procedural.toleranceMisses,
			// Loop candidates arrive already ordered by the source-level rule
			// (lowest maximum period drift, then total drift, then shortest loop);
			// clock quality may break ties inside a candidate but must not erase
			// that ordering between candidates.
			clock.candidateRank,
			diagnostics.cadenceShortfallBucket,
			Math.round(diagnostics.delaySpread),
			diagnostics.latenessBucket,
			clock.frameCount,
			Math.round(clock.duration * 1e3)
		];
	}

	static isBetter(candidate, best) {
		if (!best) return true;
		const left = RenderClock.rankKeys(candidate);
		const right = RenderClock.rankKeys(best);
		for (let index = 0; index < left.length; index++) {
			if (left[index] !== right[index]) return left[index] < right[index];
		}
		return false;
	}
}

// GIF delay units are centiseconds. Spending the loop's whole centisecond budget
// across N frames keeps the realized duration identical for every candidate, so
// only cadence and cost vary — and every delay is one the encoder emits back
// unchanged.
class GifRenderClockPlanner {
	constructor(config) {
		this.config = config;
	}

	realize(targetDuration, context) {
		const quantum = this.config.gifDelayQuantumMs;
		const minimumUnits = Math.max(1, Math.round(this.config.gifMinimumDelayMs / quantum));
		const maximumUnits = Math.max(minimumUnits, Math.round(this.config.gifMaximumDelayMs / quantum));
		const totalUnits = Math.max(minimumUnits, Math.ceil((context.minimumDuration || 0) / quantum), Math.round(targetDuration / quantum));
		const duration = totalUnits * quantum;
		const preferredInterval = RenderClock.preferredInterval(context);
		const frameCounts = new Set();
		for (let units = minimumUnits; units <= Math.min(maximumUnits, totalUnits); units++) {
			frameCounts.add(Math.floor(totalUnits / units));
			frameCounts.add(Math.ceil(totalUnits / units));
		}
		frameCounts.add(Math.round(duration / preferredInterval));
		frameCounts.add(Math.ceil(duration / preferredInterval));
		let best = null;
		[...frameCounts].sort((left, right) => left - right).forEach((frameCount) => {
			if (frameCount < 1 || frameCount > context.frameLimit) return;
			if (Math.floor(totalUnits / frameCount) < minimumUnits) return;
			const delays = new Array(frameCount);
			for (let index = 0; index < frameCount; index++) {
				delays[index] = (Math.floor((index + 1) * totalUnits / frameCount) - Math.floor(index * totalUnits / frameCount)) * quantum;
			}
			const candidate = RenderClock.build('gif', targetDuration, delays, context);
			if (RenderClock.isBetter(candidate, best)) best = candidate;
		});
		if (context.lockAuthored) {
			this.lockedDelaySets(totalUnits, duration, preferredInterval, minimumUnits, context).forEach((delays) => {
				const candidate = RenderClock.build('gif', targetDuration, delays, context);
				if (RenderClock.isBetter(candidate, best)) best = candidate;
			});
		}
		return best;
	}

	// Glitter-locked clocks: every frame animation's frame change starts an
	// output frame, and the stretch between two changes is split as evenly as
	// the centisecond grid allows. The variants differ only in how finely each
	// stretch is split; ranking picks between them on cadence and cost.
	lockedDelaySets(totalUnits, duration, preferredInterval, minimumUnits, context) {
		const quantum = this.config.gifDelayQuantumMs;
		const points = new Set([0, totalUnits]);
		for (const source of context.authored) {
			for (const boundary of source.boundariesUntil(duration)) {
				const units = Math.round(boundary / quantum);
				// A change off the grid cannot start a GIF frame exactly.
				if (Math.abs(boundary / quantum - units) > 1e-6) return [];
				points.add(units);
			}
		}
		if (points.size <= 2) return [];
		// Changes closer than the shortest delay a viewer honours share a frame.
		const kept = [0];
		[...points].sort((left, right) => left - right).slice(1).forEach((point) => {
			if (point - kept.at(-1) >= minimumUnits) kept.push(point);
			else if (point === totalUnits && kept.length > 1) kept[kept.length - 1] = point;
		});
		const gaps = kept.slice(1).map((point, index) => point - kept[index]);
		const preferredUnits = preferredInterval / quantum;
		const rules = [
			() => 1,
			(gap) => Math.floor(gap / preferredUnits),
			(gap) => Math.round(gap / preferredUnits),
			(gap) => Math.ceil(gap / preferredUnits)
		];
		const seen = new Set();
		return rules.map((rule) => gaps.flatMap((gap) => {
			const parts = Math.max(1, Math.min(Math.floor(gap / minimumUnits), rule(gap)));
			return Array.from({ length: parts }, (_, index) => (Math.floor((index + 1) * gap / parts) - Math.floor(index * gap / parts)) * quantum);
		})).filter((delays) => {
			const signature = delays.join(',');
			if (delays.length > context.frameLimit || seen.has(signature)) return false;
			seen.add(signature);
			return true;
		});
	}
}

// MP4 runs a fixed cadence, so the representable durations are frameCount /
// outputFps — an arbitrary target is not one of them, and the realized duration
// is what procedural fitting and seam reporting then use.
class Mp4RenderClockPlanner {
	constructor(config) {
		this.config = config;
	}

	realize(targetDuration, context) {
		const stops = new Set(this.config.mp4OutputFpsStops);
		stops.add(Math.max(1, Math.floor(RenderClock.preferredRate(context))));
		let best = null;
		[...stops].sort((left, right) => left - right).forEach((outputFps) => {
			if (outputFps < 1 || outputFps > context.maxSamplingFps) return;
			const frameCount = Math.max(1, Math.ceil((context.minimumDuration || 0) * outputFps / 1000), Math.round(targetDuration * outputFps / 1000));
			if (frameCount > context.frameLimit) return;
			const interval = 1000 / outputFps;
			// Timestamps come from the frame index, never repeated addition, so no
			// accumulated error can drag a sample across a source boundary.
			const timestamps = Array.from({ length: frameCount }, (_, index) => index * interval);
			const delays = new Array(frameCount).fill(interval);
			const candidate = RenderClock.build('mp4', targetDuration, delays, context, {
				outputFps,
				timestamps,
				duration: frameCount * 1000 / outputFps
			});
			if (RenderClock.isBetter(candidate, best)) best = candidate;
		});
		return best;
	}
}

class CompositeFrameReducer {
	static hash(frame) {
		// Sampled, not exhaustive — same
		// strided-prefilter idea as difference() below. Safe because callers only
		// use this hash to decide whether to run the full equals() check; a real
		// duplicate's sampled bytes always match too, so this can't miss one, it
		// can only occasionally send a non-duplicate to equals() for real proof.
		let hash = 2166136261;
		const data = frame.data;
		const stride = Math.max(4, Math.floor(data.length / 4096 / 4) * 4);
		for (let index = 0; index < data.length; index += stride) {
			hash ^= data[index];
			hash = Math.imul(hash, 16777619);
		}
		return `${frame.width}x${frame.height}:${hash >>> 0}`;
	}

	static equals(left, right) {
		if (left.width !== right.width || left.height !== right.height || left.data.length !== right.data.length) return false;
		for (let index = 0; index < left.data.length; index++) {
			if (left.data[index] !== right.data[index]) return false;
		}
		return true;
	}

	static difference(left, right, sampled = false) {
		if (left.width !== right.width || left.height !== right.height || left.data.length !== right.data.length) return 1;
		const dataA = left.data;
		const dataB = right.data;
		const stride = sampled ? Math.max(4, Math.floor(dataA.length / 4096 / 4) * 4) : 4;
		let error = 0;
		let peakError = 0;
		let samples = 0;
		for (let index = 0; index < dataA.length; index += stride) {
			const red = Math.abs(dataA[index] - dataB[index]);
			const green = Math.abs(dataA[index + 1] - dataB[index + 1]);
			const blue = Math.abs(dataA[index + 2] - dataB[index + 2]);
			const alpha = Math.abs(dataA[index + 3] - dataB[index + 3]);
			const pixelError = (red + green + blue + alpha) / (255 * 4);
			error += pixelError;
			peakError = Math.max(peakError, pixelError);
			samples++;
		}
		// Whole-canvas averages erase the tiny, bright flashes that define glitter.
		// A small peak term protects those intentional details without outweighing
		// the mean error for broad motion or gradients.
		return samples ? Math.max(error / samples, peakError * 0.09) : 0;
	}

	reduce(input, { enabled, visualErrorThreshold, preferredFrameBudget, hardFrameLimit, maximumCadenceGap = Infinity, lockAuthoredFrames = false }) {
		const frames = [...input.frames];
		const frameDurations = [...input.frameDurations];
		const selections = input.selections.map((selection) => new Map(selection));
		let exactDuplicatesMerged = 0;
		let nearDuplicatesMerged = 0;
		let maximumVisualError = 0;
		let effectiveVisualErrorThreshold = Math.max(0, visualErrorThreshold || 0);
		let budgetCompromiseRequired = false;

		if (enabled) {
			const hashes = frames.map(CompositeFrameReducer.hash);
			for (let index = 1; index < frames.length; index++) {
				if (hashes[index] === hashes[index - 1] && CompositeFrameReducer.equals(frames[index], frames[index - 1])) {
					frameDurations[index - 1] += frameDurations[index];
					frames.splice(index, 1);
					frameDurations.splice(index, 1);
					selections.splice(index, 1);
					hashes.splice(index, 1);
					exactDuplicatesMerged++;
					index--;
				}
			}

			// Two frames showing the same frame of every frame animation; merging
			// any others would move a glitter frame change off its own time.
			const sameAuthoredFrames = (left, right) => [...selections[left]].every(([key, selected]) => selections[right].get(key)?.frameIndex === selected?.frameIndex);
			const mergeWithinThreshold = (threshold, cadenceGap, locked = false) => {
				let best = null;
				for (let index = 1; index < frames.length; index++) {
					const sampledPrev = CompositeFrameReducer.difference(frames[index], frames[index - 1], true);
					const hasNext = index < frames.length - 1;
					const sampledNext = hasNext ? CompositeFrameReducer.difference(frames[index], frames[index + 1], true) : Infinity;
					const sampledScore = Math.min(sampledPrev, sampledNext);
					if (sampledScore > threshold * 1.5) continue;
					const prev = CompositeFrameReducer.difference(frames[index], frames[index - 1]);
					const next = hasNext ? CompositeFrameReducer.difference(frames[index], frames[index + 1]) : Infinity;
					const score = Math.min(prev, next);
					const materialChange = hasNext && prev > threshold * 4 && next > threshold * 4;
					// Slow continuous motion looks near-duplicate without being
					// temporally redundant: a merge that stretches a delay past the
					// cadence the render clock committed to would re-irregularize the
					// motion the master clock was planned to keep smooth.
					let mergePrevious = prev <= next;
					if (frameDurations[index] + frameDurations[mergePrevious ? index - 1 : index + 1] > cadenceGap) {
						mergePrevious = !mergePrevious;
						const neighbour = mergePrevious ? index - 1 : index + 1;
						if (neighbour >= frames.length || frameDurations[index] + frameDurations[neighbour] > cadenceGap) continue;
					}
					if (locked && !sameAuthoredFrames(index, mergePrevious ? index - 1 : index + 1)) continue;
					if (!materialChange && score < threshold && (!best || score < best.score)) {
						best = { index, score, mergePrevious };
					}
				}
				if (!best) return false;
				if (best.mergePrevious) frameDurations[best.index - 1] += frameDurations[best.index];
				else frameDurations[best.index + 1] += frameDurations[best.index];
				frames.splice(best.index, 1);
				frameDurations.splice(best.index, 1);
				selections.splice(best.index, 1);
				nearDuplicatesMerged++;
				maximumVisualError = Math.max(maximumVisualError, best.score);
				return true;
			};

			if (effectiveVisualErrorThreshold > 0) {
				while (frames.length > preferredFrameBudget && mergeWithinThreshold(effectiveVisualErrorThreshold, maximumCadenceGap, lockAuthoredFrames)) {}
			}

			// The hard limit is a resource ceiling, not a quality preference, so it
			// is allowed to spend cadence once nothing else can bring the count down.
			while (frames.length > hardFrameLimit && frames.length > 1) {
				budgetCompromiseRequired = true;
				effectiveVisualErrorThreshold = Math.min(1, Math.max(0.001, effectiveVisualErrorThreshold * 1.5));
				const merged = mergeWithinThreshold(effectiveVisualErrorThreshold, Infinity);
				if (!merged && effectiveVisualErrorThreshold >= 1) break;
			}
		}

		return {
			frames,
			frameDurations,
			selections,
			exactDuplicatesMerged,
			nearDuplicatesMerged,
			framesRemoved: exactDuplicatesMerged + nearDuplicatesMerged,
			maximumVisualError,
			effectiveVisualErrorThreshold,
			budgetCompromiseRequired,
			preferredBudgetMet: frames.length <= preferredFrameBudget
		};
	}
}

// Owns the whole timing decision: it generates source-valid loop candidates,
// asks the format-specific clock planner to realize each one, re-validates the
// sources against the duration that format actually produced, and commits loop
// duration, fitted procedural periods and render clock together.
class CompositeTimelinePlanner {
	constructor(config = {}) {
		this.config = config;
		this.reducer = new CompositeFrameReducer();
		this.renderClockPlanners = {
			gif: new GifRenderClockPlanner(config.renderClock),
			mp4: new Mp4RenderClockPlanner(config.renderClock)
		};
	}

	_gcd(left, right) {
		return right ? this._gcd(right, left % right) : left;
	}

	_lcmBounded(left, right, limit) {
		const value = left / this._gcd(left, right) * right;
		return value > limit ? null : value;
	}

	_chooseLoopDuration(timelines, fallbackDuration, maximumDuration) {
		const animated = timelines.filter((timeline) => Number.isFinite(timeline.cycleDuration));
		if (!animated.length) return { duration: fallbackDuration, exact: true, seamError: 0, completedSources: 0 };
		// maximumDuration bounds the search for a shared multiple across several
		// sources, but a single slow source must still complete one full cycle
		// even if that cycle alone exceeds the cap — otherwise it gets truncated
		// mid-motion and smart reduction collapses the leftover sliver to a few
		// frames that don't resemble the animation at all.
		const longestCycle = Math.max(...animated.map((timeline) => timeline.cycleDuration));
		const effectiveMaximum = Math.max(maximumDuration, longestCycle);
		let common = animated[0].cycleDuration;
		for (let index = 1; index < animated.length; index++) {
			common = this._lcmBounded(common, animated[index].cycleDuration, effectiveMaximum);
			if (common == null) break;
		}
		if (common != null && common <= effectiveMaximum) {
			return { duration: common, exact: true, seamError: 0, completedSources: animated.length };
		}

		const candidates = new Set([effectiveMaximum]);
		animated.forEach((timeline) => {
			for (let multiple = timeline.cycleDuration; multiple <= effectiveMaximum; multiple += timeline.cycleDuration) {
				candidates.add(multiple);
			}
		});
		let best = null;
		candidates.forEach((duration) => {
			if (duration < fallbackDuration) return;
			let error = 0;
			let completedSources = 0;
			animated.forEach((timeline) => {
				const remainder = duration % timeline.cycleDuration;
				const distance = Math.min(remainder, timeline.cycleDuration - remainder);
				error += distance / timeline.cycleDuration;
				if (distance === 0) completedSources++;
			});
			const score = error / animated.length - (duration / effectiveMaximum) * 0.001;
			if (!best || score < best.score) best = { duration, score, seamError: error / animated.length, completedSources };
		});
		return { duration: best.duration, exact: false, seamError: best.seamError, completedSources: best.completedSources };
	}

	// Source-valid loop candidates. An exact authored closure can be repeated —
	// 2×, 3× — to give procedural fitting more room, but a best-fit seam duration
	// is a compromise, not a base loop, so its multiples are not closures and are
	// never searched.
	_loopCandidateDurations(authored, procedural, authoredLoop, maximumDuration) {
		const sources = [...authored.map((entry) => entry.source || entry), ...procedural];
		const minimum = Math.max(0, ...sources.map((source) => Number.isFinite(source.run?.end) ? source.run.end
			: source.run?.start > 0 ? source.run.start + source.naturalPeriod : 0));
		const candidates = new Set([authoredLoop.duration]);
		if (authored.length) {
			if (authored.some((entry) => entry.source?.run?.start > 0)) {
				candidates.clear();
				authored.forEach((entry) => {
					const start = entry.source?.run?.start || 0;
					const first = start + Math.max(1, Math.ceil((minimum - start) / entry.cycleDuration)) * entry.cycleDuration;
					for (let duration = first; duration <= Math.max(maximumDuration, first); duration += entry.cycleDuration) candidates.add(duration);
				});
				return candidates;
			}
			const first = Math.max(1, Math.ceil(minimum / authoredLoop.duration)) * authoredLoop.duration;
			const limit = Math.max(maximumDuration, first);
			if (!authoredLoop.exact) {
				if (authoredLoop.duration < minimum) candidates.clear();
				if (!candidates.size) candidates.add(Math.max(minimum, limit));
				return candidates;
			}
			candidates.clear();
			for (let duration = first; duration <= limit; duration += authoredLoop.duration) candidates.add(duration);
			return candidates;
		}
		candidates.clear();
		const repeating = procedural.filter((source) => !source.nonLooping);
		if (!repeating.length) return new Set([minimum || authoredLoop.duration]);
		repeating.forEach((source) => {
			const start = source.run?.start || 0;
			const first = start + Math.max(1, Math.ceil((minimum - start) / source.naturalPeriod)) * source.naturalPeriod;
			const limit = source.run || minimum > 0 ? Math.max(maximumDuration, first) : maximumDuration;
			for (let duration = first; duration <= limit; duration += source.naturalPeriod) candidates.add(duration);
		});
		if (!candidates.size) candidates.add(maximumDuration);
		return candidates;
	}

	// Authored-only exports keep their exact-boundary clock: GIF supports variable
	// frame delays and there is no continuously evaluated motion needing a regular
	// composite cadence.
	_authoredClock(timelines, duration, maxSamplingFps, context) {
		const timestamps = this._buildTimestamps(timelines, duration, maxSamplingFps);
		const starts = timestamps.slice(0, -1);
		const delays = starts.map((timestamp, index) => timestamps[index + 1] - timestamp);
		return RenderClock.build('authored', duration, delays, context, { timestamps: starts });
	}

	_planRenderClock(options) {
		const timelines = options.timelines;
		const authored = timelines.filter((timeline) => timeline.kind === 'authored' && Number.isFinite(timeline.cycleDuration));
		const procedural = timelines.filter((timeline) => timeline.kind === 'procedural');
		const authoredLoop = this._chooseLoopDuration(authored, options.fallbackDuration, options.maxLoopDurationMs);
		const setLoop = Number.isFinite(options.loopDurationMs);
		const authoredDuration = setLoop ? options.loopDurationMs : authoredLoop.duration;
		const context = {
			authored,
			procedural,
			minimumDuration: setLoop ? 0 : Math.max(0, ...procedural.map((source) => Number.isFinite(source.run?.end) ? source.run.end : 0)),
			maxSamplingFps: options.maxSamplingFps,
			frameLimit: options.hardFrameLimit,
			resolveFrameLimit: options.resolveFrameLimit,
			tolerance: this.config.proceduralPeriodTolerance,
			cadenceShortfallTolerance: this.config.renderClock.cadenceShortfallTolerance,
			candidateRank: 0,
			lockAuthored: Boolean(this.config.renderClock.glitterLocked) && authored.some((source) => !source.isStatic),
			lockedRateAllowance: this.config.renderClock.lockedRateAllowance || 1.25
		};
		if (!procedural.length) {
			const clock = this._authoredClock(timelines, authoredDuration, options.maxSamplingFps, context);
			return {
				clock,
				timelines,
				loop: setLoop ? loopSeamForDuration(authored, clock.duration) : authoredLoop,
				fits: []
			};
		}

		const shortlistSize = this.config.renderClock.loopCandidateShortlist;
		const shortlist = [...(setLoop ? [options.loopDurationMs] : this._loopCandidateDurations(authored, procedural, authoredLoop, options.maxLoopDurationMs))]
			.map((duration) => ({ duration, ...fitProceduralPeriods(procedural, duration, context.tolerance) }))
			.sort((left, right) => (left.maximumDrift - right.maximumDrift)
				|| (left.totalDrift - right.totalDrift)
				|| (left.duration - right.duration))
			.slice(0, shortlistSize);
		const planner = this.renderClockPlanners[options.outputFormat] || this.renderClockPlanners.gif;
		let clock = null;
		shortlist.forEach((candidate, candidateRank) => {
			const realized = planner.realize(candidate.duration, {
				...context,
				candidateRank,
				// The clock owns frame count, so it is bounded by the same resource
				// ceiling that used to be enforced afterwards by pre-render thinning.
				frameLimit: context.resolveFrameLimit(candidate.duration)
			});
			if (realized && RenderClock.isBetter(realized, clock)) clock = realized;
		});
		if (!clock) {
			return {
				clock: this._authoredClock(timelines, authoredDuration, options.maxSamplingFps, context),
				timelines,
				loop: setLoop ? loopSeamForDuration(timelines, authoredDuration) : authoredLoop,
				fits: []
			};
		}

		const replacements = new Map();
		const fits = clock.procedural.fits.map((fit) => {
			const resolvedPeriod = fit.fitted ? fit.fittedPeriod : fit.source.naturalPeriod;
			replacements.set(fit.source, fit.source.withPeriod(resolvedPeriod));
			return {
				key: fit.source.key,
				label: fit.source.displayLabel,
				requestedPeriod: fit.source.naturalPeriod,
				resolvedPeriod,
				cycles: clock.duration / resolvedPeriod,
				driftPercent: fit.drift * 100,
				fitted: fit.fitted
			};
		});
		const resolvedSources = timelines.map((timeline) => replacements.get(timeline) || timeline);
		return { clock, timelines: resolvedSources, loop: loopSeamForDuration(resolvedSources, clock.duration), fits };
	}

	_buildTimestamps(timelines, duration, maxSamplingFps) {
		// Authored-only clock: the native boundaries are the output timestamps.
		// Once any procedural source is present this is not used — the master
		// render clock owns displayed time instead.
		const minimumInterval = 1000 / Math.max(1, maxSamplingFps);
		const candidates = new Set([0, duration]);
		let needsSamplingGrid = false;
		timelines.forEach((timeline) => {
			if (timeline.kind !== 'authored') return;
			if (timeline.frameDurations.some((frameDuration) => frameDuration < minimumInterval)) {
				needsSamplingGrid = true;
				return;
			}
			timeline.boundariesUntil(duration).forEach((time) => candidates.add(time));
		});
		// The sampling limit applies to each source, not to the combined event
		// stream. Independent low-rate animations can change close together and
		// both changes must survive or one layer visibly holds on its old frame.
		if (needsSamplingGrid) {
			const samplingInterval = 1000 / maxSamplingFps;
			for (let timestamp = samplingInterval; timestamp < duration; timestamp += samplingInterval) {
				candidates.add(timestamp);
			}
		}
		return [...candidates].sort((left, right) => left - right);
	}

	// A fixed frame budget merges a long loop down to the same frame count as a
	// short one, so scale the floor by the resolved loop duration: never merge
	// below what minFrameRateFps needs to stay smooth over that duration.
	_frameBudgets(duration, options) {
		const durationFrameFloor = Number.isFinite(duration)
			? Math.ceil((duration / 1000) * (this.config.minFrameRateFps || 0))
			: 0;
		const preferredFrameBudget = Math.min(
			options.hardFrameLimit,
			Math.max(options.preferredFrameBudget, durationFrameFloor)
		);
		const preRenderBudgetMultiplier = options.preRenderBudgetMultiplier || this.config.preRenderBudgetMultiplier;
		const preRenderBudget = options.smartReduction && options.preRenderSampling
			? Math.min(options.hardFrameLimit, Math.max(
				preferredFrameBudget,
				Math.ceil(preferredFrameBudget * preRenderBudgetMultiplier)
			))
			: options.hardFrameLimit;
		return { preferredFrameBudget, preRenderBudget };
	}

	_selectionSignature(selection) {
		return [...selection.entries()].map(([key, entry]) => `${key}:${JSON.stringify(entry)}`).join(',');
	}

	_collapseSelectionDuplicates(entries) {
		const collapsed = [];
		entries.forEach((entry) => {
			const previous = collapsed.at(-1);
			if (previous && this._selectionSignature(previous.selection) === this._selectionSignature(entry.selection)) {
				previous.duration += entry.duration;
				return;
			}
			collapsed.push({ ...entry, selection: new Map(entry.selection) });
		});
		return collapsed;
	}

	_limitPreRenderCandidates(entries, budget) {
		if (entries.length <= budget) return entries;
		const totalDuration = entries.reduce((sum, entry) => sum + entry.duration, 0);
		const interval = totalDuration / budget;
		const integerInterval = Math.floor(interval);
		const remainder = Number.isInteger(totalDuration) ? totalDuration - integerInterval * budget : 0;
		const sampled = [];
		let sourceIndex = 0;
		let sourceStart = 0;
		let assignedDuration = 0;
		for (let bucket = 0; bucket < budget; bucket++) {
			const duration = Number.isInteger(totalDuration)
				? integerInterval + (bucket < remainder ? 1 : 0)
				: (bucket === budget - 1 ? totalDuration - assignedDuration : interval);
			const sampleTime = assignedDuration + duration / 2;
			while (sourceIndex < entries.length - 1
				&& sampleTime >= sourceStart + entries[sourceIndex].duration) {
				sourceStart += entries[sourceIndex].duration;
				sourceIndex++;
			}
			sampled.push({
				...entries[sourceIndex],
				timestamp: entries[0].timestamp + assignedDuration,
				duration,
				selection: new Map(entries[sourceIndex].selection)
			});
			assignedDuration += duration;
		}
		const sampledDuration = sampled.reduce((sum, entry) => sum + entry.duration, 0);
		sampled.at(-1).duration += totalDuration - sampledDuration;
		return sampled;
	}

	_applyManualSampling(entries, every) {
		if (every <= 1 || entries.length <= 1) return entries;
		const sampled = [];
		for (let index = 0; index < entries.length; index += every) {
			const entry = { ...entries[index], selection: new Map(entries[index].selection) };
			entry.duration = entries.slice(index, Math.min(index + every, entries.length))
				.reduce((sum, candidate) => sum + candidate.duration, 0);
			sampled.push(entry);
		}
		return sampled;
	}

	planSchedule(options) {
		const sourceTimelines = options.timelines || [];
		const fallbackDuration = AuthoredAnimationSource.normalizeDuration(options.fallbackDuration, 100);
		const timingResolution = this._planRenderClock({
			timelines: sourceTimelines,
			fallbackDuration,
			maxLoopDurationMs: options.maxLoopDurationMs,
			loopDurationMs: options.loopDurationMs,
			maxSamplingFps: options.maxSamplingFps,
			hardFrameLimit: options.hardFrameLimit,
			resolveFrameLimit: (duration) => this._frameBudgets(duration, options).preRenderBudget,
			outputFormat: options.outputFormat === 'mp4' ? 'mp4' : 'gif'
		});
		const timelines = timingResolution.timelines;
		const loop = timingResolution.loop;
		const clock = timingResolution.clock;
		const fittedChanges = timingResolution.fits.filter((fit) => fit.fitted && Math.abs(fit.requestedPeriod - fit.resolvedPeriod) >= 0.01);
		if (fittedChanges.length) {
			options.onStatus?.(`Fit ${formatCount(fittedChanges.length, 'procedural period')} to the composite loop.`);
		}
		if (!loop.exact) options.onStatus?.('Loop optimized with a best-fit seam; the exact common loop was too long.');
		// Every source is sampled at the committed clock's own frame-start
		// timestamps, always against its native timeline, so a late authored
		// transition stays a local output quantization and never accumulates.
		let entries = clock.timestamps.map((timestamp, index) => ({
			timestamp,
			duration: clock.delays[index],
			selection: new Map(timelines.map((timeline) => [timeline.key, timeline.sampleAt(timestamp)]))
		}));
		const originalFrameCount = entries.length;
		entries = this._collapseSelectionDuplicates(entries);
		const selectionDuplicatesMerged = originalFrameCount - entries.length;
		entries = this._applyManualSampling(entries, Math.max(1, options.manualFrameSkip || 1));
		const manuallySampledFrameCount = entries.length;
		const { preferredFrameBudget, preRenderBudget } = this._frameBudgets(loop.duration, options);
		// Pre-render thinning re-buckets timestamps and reuses a neighbour's
		// source state, so it may only run on the authored-boundary clock. When a
		// render clock owns displayed time it was already planned under this same
		// budget, so the committed clock stays the only clock.
		const clockOwnsCadence = clock.mode !== 'authored';
		if (!clockOwnsCadence) entries = this._limitPreRenderCandidates(entries, preRenderBudget);
		const preRenderFramesSkipped = manuallySampledFrameCount - entries.length;
		if (options.reverse) entries.reverse();
		const totalDuration = entries.reduce((sum, entry) => sum + entry.duration, 0);
		const sourceFrameSelections = new Map();
		timelines.filter((timeline) => timeline.kind === 'authored').forEach((timeline) => {
			sourceFrameSelections.set(timeline.key, entries.map((entry) => entry.selection.get(timeline.key)?.frameIndex ?? 0));
		});
		const resolvedTimelines = new Map(timelines.map((timeline) => [timeline.key, timeline]));
		const sourceAnalysis = sourceTimelines
			.filter((timeline) => timeline.kind === 'procedural' || Number.isFinite(timeline.cycleDuration))
			.map((timeline) => {
				const resolved = resolvedTimelines.get(timeline.key) || timeline;
				if (timeline.kind === 'procedural') {
					return {
						kind: 'procedural',
						key: timeline.key,
						label: timeline.label || String(timeline.key),
						ownerLayerId: timeline.ownerLayerId,
						effectSlot: timeline.effectSlot,
						requestedPeriod: timeline.naturalPeriod,
						resolvedPeriod: resolved.resolvedPeriod,
						cycleCount: loop.duration / resolved.resolvedPeriod,
						periodChanged: Math.abs(timeline.naturalPeriod - resolved.resolvedPeriod) >= 0.01
					};
				}
				const nativeFps = timeline.frameCount * 1000 / timeline.cycleDuration;
				return {
					kind: 'authored',
					key: timeline.key,
					label: timeline.label || String(timeline.key),
					ownerLayerId: timeline.ownerLayerId,
					effectSlot: timeline.effectSlot,
					frameCount: timeline.frameCount,
					nativeFps,
					nativeCycleDuration: timeline.cycleDuration,
					variableTiming: new Set(timeline.frameDurations).size > 1
				};
			});

		return {
			entries,
			frameDurations: entries.map((entry) => entry.duration),
			totalDuration,
			frameCount: entries.length,
			sourceFrameSelections,
			sourceAnalysis,
			loopSeam: {
				exact: loop.exact,
				error: loop.seamError,
				completedSources: loop.completedSources,
				duration: loop.duration
			},
			timingResolution: {
				proceduralPeriodFits: timingResolution.fits
			},
			renderClock: {
				mode: clock.mode,
				targetDuration: clock.targetDuration,
				duration: clock.duration,
				frameCount: clock.frameCount,
				outputFps: clock.outputFps,
				delays: clock.delays,
				timestamps: clock.timestamps,
				...clock.diagnostics,
				framesBeforeReduction: entries.length,
				framesAfterReduction: entries.length
			},
			reduction: {
				smartReductionEnabled: Boolean(options.smartReduction),
				originalFrameCount,
				selectionDuplicatesMerged,
				manuallySampledFrameCount,
				preRenderFramesSkipped,
				renderedFrameCount: 0,
				outputFrameCount: entries.length,
				exactDuplicatesMerged: 0,
				nearDuplicatesMerged: 0,
				framesRemoved: 0,
				maximumVisualError: 0,
				effectiveVisualErrorThreshold: options.visualErrorThreshold,
				durationPreserved: Math.abs(totalDuration - loop.duration) < 0.001,
				preferredBudgetMet: entries.length <= preferredFrameBudget,
				budgetCompromiseRequired: entries.length > options.hardFrameLimit
			}
		};
	}

	async plan(options) {
		const schedulePlan = this.planSchedule(options);
		const entries = schedulePlan.entries;
		// gif.js retains every added frame until render(), so the materialized GIF
		// path remains bounded by the schedule budget before pixel reduction.
		const frames = [];
		for (let index = 0; index < entries.length; index++) {
			frames.push(await options.renderFrame(entries[index].timestamp, entries[index].selection, entries.length));
		}
		const maximumCadenceGap = schedulePlan.renderClock.mode !== 'authored'
			? Math.max(...entries.map((entry) => entry.duration))
			: Infinity;
		const reduced = this.reducer.reduce({
			frames,
			frameDurations: entries.map((entry) => entry.duration),
			selections: entries.map((entry) => entry.selection)
		}, {
			enabled: options.smartReduction,
			visualErrorThreshold: options.visualErrorThreshold,
			preferredFrameBudget: this._frameBudgets(schedulePlan.loopSeam.duration, options).preferredFrameBudget,
			hardFrameLimit: options.hardFrameLimit,
			maximumCadenceGap,
			lockAuthoredFrames: Boolean(this.config.renderClock.glitterLocked)
		});
		const totalDuration = reduced.frameDurations.reduce((sum, duration) => sum + duration, 0);
		const authoredKeys = schedulePlan.sourceAnalysis
			.filter((source) => source.kind === 'authored')
			.map((source) => source.key);
		const sourceFrameSelections = new Map(authoredKeys.map((key) => [
			key,
			reduced.selections.map((selection) => selection.get(key)?.frameIndex ?? 0)
		]));
		return {
			...schedulePlan,
			frames: reduced.frames,
			frameDurations: reduced.frameDurations,
			totalDuration,
			frameCount: reduced.frames.length,
			sourceFrameSelections,
			renderClock: {
				...schedulePlan.renderClock,
				framesBeforeReduction: entries.length,
				framesAfterReduction: reduced.frames.length
			},
			reduction: {
				...schedulePlan.reduction,
				renderedFrameCount: entries.length,
				outputFrameCount: reduced.frames.length,
				exactDuplicatesMerged: reduced.exactDuplicatesMerged,
				nearDuplicatesMerged: reduced.nearDuplicatesMerged,
				framesRemoved: reduced.framesRemoved,
				maximumVisualError: reduced.maximumVisualError,
				effectiveVisualErrorThreshold: reduced.effectiveVisualErrorThreshold,
				durationPreserved: Math.abs(totalDuration - schedulePlan.loopSeam.duration) < 0.001,
				preferredBudgetMet: reduced.preferredBudgetMet,
				budgetCompromiseRequired: reduced.budgetCompromiseRequired
			}
		};
	}
}
