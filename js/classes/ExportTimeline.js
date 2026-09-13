// Export timeline planning primitives. Loaded before GifExporter and Mp4Exporter.
class AuthoredAnimationSource {
	constructor({ key, label = null, ownerLayerId = null, effectSlot = null, frames = [], frameDurations = [], fallbackDuration = 100 }) {
		this.kind = 'authored';
		this.key = key;
		this.label = label;
		this.ownerLayerId = ownerLayerId;
		this.effectSlot = effectSlot;
		this.frames = frames;
		this.isStatic = frames.length <= 1;
		this.frameDurations = frames.map((_, index) => AuthoredAnimationSource.normalizeDuration(
			frameDurations[index],
			fallbackDuration
		));
		this.cumulativeBoundaries = [0];
		this.frameDurations.forEach((duration) => {
			this.cumulativeBoundaries.push(this.cumulativeBoundaries.at(-1) + duration);
		});
		this.cycleDuration = this.isStatic ? Infinity : this.cumulativeBoundaries.at(-1);
	}

	static normalizeDuration(duration, fallback = 100) {
		const value = Number.isFinite(duration) && duration > 0 ? duration : fallback;
		return Math.max(20, Math.round(value || 100));
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
		return Math.min(low, this.frames.length - 1);
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
}

class ProceduralAnimationSource {
	constructor({ key, label = null, ownerLayerId = null, effectSlot = null, naturalPeriod, phase = 0, preferredSamplingRate, sampler, resolvedPeriod = null }) {
		this.kind = 'procedural';
		this.key = key;
		this.label = label;
		this.ownerLayerId = ownerLayerId;
		this.effectSlot = effectSlot;
		this.naturalPeriod = Math.max(1, Number(naturalPeriod));
		this.resolvedPeriod = Number.isFinite(resolvedPeriod) ? Math.max(1, Number(resolvedPeriod)) : this.naturalPeriod;
		this.phase = Number(phase) || 0;
		this.preferredSamplingRate = Math.max(1, Number(preferredSamplingRate));
		this.sampler = sampler;
	}

	withPeriod(resolvedPeriod) {
		return new ProceduralAnimationSource({
			key: this.key,
			label: this.label,
			ownerLayerId: this.ownerLayerId,
			effectSlot: this.effectSlot,
			naturalPeriod: this.naturalPeriod,
			phase: this.phase,
			preferredSamplingRate: this.preferredSamplingRate,
			sampler: this.sampler,
			resolvedPeriod
		});
	}

	sampleAt(timestamp) {
		return this.sampler(timestamp, this.resolvedPeriod, this.phase);
	}
}

class CompositeFrameReducer {
	static hash(frame) {
		let hash = 2166136261;
		const data = frame.data;
		for (let index = 0; index < data.length; index++) {
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

	reduce(input, { enabled, visualErrorThreshold, preferredFrameBudget, hardFrameLimit }) {
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

			const mergeWithinThreshold = (threshold) => {
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
					if (!materialChange && score < threshold && (!best || score < best.score)) {
						best = { index, score, mergePrevious: prev <= next };
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
				while (frames.length > preferredFrameBudget && mergeWithinThreshold(effectiveVisualErrorThreshold)) {}
			}

			while (frames.length > hardFrameLimit && frames.length > 1) {
				budgetCompromiseRequired = true;
				effectiveVisualErrorThreshold = Math.min(1, Math.max(0.001, effectiveVisualErrorThreshold * 1.5));
				const merged = mergeWithinThreshold(effectiveVisualErrorThreshold);
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

class CompositeTimelinePlanner {
	constructor(config = {}) {
		this.config = config;
		this.reducer = new CompositeFrameReducer();
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

	_scoreProceduralCandidate(duration, procedural) {
		const fits = procedural.map((source) => {
			const cycles = Math.max(1, Math.round(duration / source.naturalPeriod));
			const fittedPeriod = duration / cycles;
			const drift = Math.abs(fittedPeriod - source.naturalPeriod) / source.naturalPeriod;
			return { source, cycles, fittedPeriod, drift };
		});
		return {
			duration,
			fits,
			maximumDrift: fits.length ? Math.max(...fits.map((fit) => fit.drift)) : 0,
			totalDrift: fits.reduce((sum, fit) => sum + fit.drift, 0)
		};
	}

	_isBetterProceduralCandidate(candidate, best) {
		if (!best) return true;
		if (candidate.maximumDrift !== best.maximumDrift) return candidate.maximumDrift < best.maximumDrift;
		if (candidate.totalDrift !== best.totalDrift) return candidate.totalDrift < best.totalDrift;
		return candidate.duration < best.duration;
	}

	_fitProceduralSources(timelines, fallbackDuration, maximumDuration) {
		const authored = timelines.filter((timeline) => timeline.kind === 'authored' && Number.isFinite(timeline.cycleDuration));
		const procedural = timelines.filter((timeline) => timeline.kind === 'procedural');
		const authoredLoop = this._chooseLoopDuration(authored, fallbackDuration, maximumDuration);
		if (!procedural.length) return { timelines, loop: authoredLoop, fits: [] };

		const candidates = new Set();
		if (authored.length) {
			const candidateMaximum = Math.max(maximumDuration, authoredLoop.duration);
			for (let duration = authoredLoop.duration; duration <= candidateMaximum; duration += authoredLoop.duration) candidates.add(duration);
		} else {
			procedural.forEach((source) => {
				for (let duration = source.naturalPeriod; duration <= maximumDuration; duration += source.naturalPeriod) candidates.add(duration);
			});
			if (!candidates.size) candidates.add(maximumDuration);
		}

		let best = null;
		candidates.forEach((duration) => {
			const candidate = this._scoreProceduralCandidate(duration, procedural);
			if (this._isBetterProceduralCandidate(candidate, best)) best = candidate;
		});
		const tolerance = this.config.proceduralPeriodTolerance;
		const replacements = new Map();
		const fits = best.fits.map((fit) => {
			const fitted = fit.drift <= tolerance;
			const resolvedPeriod = fitted ? fit.fittedPeriod : fit.source.naturalPeriod;
			replacements.set(fit.source, fit.source.withPeriod(resolvedPeriod));
			return {
				key: fit.source.key,
				label: fit.source.label || String(fit.source.key),
				requestedPeriod: fit.source.naturalPeriod,
				resolvedPeriod,
				cycles: best.duration / resolvedPeriod,
				driftPercent: fit.drift * 100,
				fitted
			};
		});
		const fittedCount = fits.filter((fit) => fit.fitted).length;
		return {
			timelines: timelines.map((timeline) => replacements.get(timeline) || timeline),
			loop: {
				duration: best.duration,
				exact: authoredLoop.exact && fittedCount === procedural.length,
				seamError: authoredLoop.seamError + fits.filter((fit) => !fit.fitted).reduce((sum, fit) => sum + fit.driftPercent / 100, 0),
				completedSources: authoredLoop.completedSources + fittedCount
			},
			fits
		};
	}

	_buildTimestamps(timelines, duration, maxSamplingFps) {
		const minimumInterval = 1000 / Math.max(1, maxSamplingFps);
		const candidates = new Set([0, duration]);
		let needsSamplingGrid = false;
		let proceduralSamplingRate = 0;
		timelines.forEach((timeline) => {
			if (timeline.kind === 'procedural') {
				proceduralSamplingRate = Math.max(proceduralSamplingRate, timeline.preferredSamplingRate);
				return;
			}
			if (timeline.frameDurations.some((frameDuration) => frameDuration < minimumInterval)) {
				needsSamplingGrid = true;
				return;
			}
			timeline.boundariesUntil(duration).forEach((time) => candidates.add(time));
		});
		// The sampling limit applies to each source, not to the combined event
		// stream. Independent low-rate animations can change close together and
		// both changes must survive or one layer visibly holds on its old frame.
		const samplingRate = needsSamplingGrid
			? maxSamplingFps
			: Math.min(maxSamplingFps, proceduralSamplingRate);
		if (samplingRate > 0) {
			const samplingInterval = 1000 / samplingRate;
			for (let timestamp = samplingInterval; timestamp < duration; timestamp += samplingInterval) {
				candidates.add(timestamp);
			}
		}
		return [...candidates].sort((left, right) => left - right);
	}

	estimateLoop(timelines, fallbackDuration, maximumDuration) {
		const normalizedFallback = AuthoredAnimationSource.normalizeDuration(fallbackDuration, 100);
		return this._fitProceduralSources(timelines, normalizedFallback, maximumDuration).loop;
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

	async plan(options) {
		const sourceTimelines = options.timelines || [];
		const fallbackDuration = AuthoredAnimationSource.normalizeDuration(options.fallbackDuration, 100);
		const timingResolution = this._fitProceduralSources(sourceTimelines, fallbackDuration, options.maxLoopDurationMs);
		const timelines = timingResolution.timelines;
		const loop = timingResolution.loop;
		const fittedChanges = timingResolution.fits.filter((fit) => fit.fitted && Math.abs(fit.requestedPeriod - fit.resolvedPeriod) >= 0.01);
		if (fittedChanges.length) {
			options.onStatus?.(`Fit ${fittedChanges.length} procedural ${fittedChanges.length === 1 ? 'period' : 'periods'} to the composite loop.`);
		}
		if (!loop.exact) options.onStatus?.('Loop optimized with a best-fit seam; the exact common loop was too long.');
		const timestamps = this._buildTimestamps(timelines, loop.duration, options.maxSamplingFps);
		let entries = [];
		for (let index = 0; index < timestamps.length - 1; index++) {
			const timestamp = timestamps[index];
			const selection = new Map(timelines.map((timeline) => [timeline.key, timeline.sampleAt(timestamp)]));
			entries.push({
				timestamp,
				duration: timestamps[index + 1] - timestamp,
				selection
			});
		}
		const originalFrameCount = entries.length;
		entries = this._collapseSelectionDuplicates(entries);
		const selectionDuplicatesMerged = originalFrameCount - entries.length;
		entries = this._applyManualSampling(entries, Math.max(1, options.manualFrameSkip || 1));
		const manuallySampledFrameCount = entries.length;
		// A fixed frame budget merges a long loop down to the same frame count as a
		// short one, so scale the floor by the resolved loop duration: never merge
		// below what minFrameRateFps needs to stay smooth over that duration.
		const durationFrameFloor = Number.isFinite(loop.duration)
			? Math.ceil((loop.duration / 1000) * (this.config.minFrameRateFps || 0))
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
		entries = this._limitPreRenderCandidates(entries, preRenderBudget);
		const preRenderFramesSkipped = manuallySampledFrameCount - entries.length;
		if (options.reverse) entries.reverse();
		for (let index = 0; index < entries.length; index++) {
			entries[index].frame = await options.renderFrame(entries[index].timestamp, entries[index].selection, entries.length);
		}
		const renderedFrameCount = entries.length;

		const reduced = this.reducer.reduce({
			frames: entries.map((entry) => entry.frame),
			frameDurations: entries.map((entry) => entry.duration),
			selections: entries.map((entry) => entry.selection)
		}, {
			enabled: options.smartReduction,
			visualErrorThreshold: options.visualErrorThreshold,
			preferredFrameBudget,
			hardFrameLimit: options.hardFrameLimit
		});
		const totalDuration = reduced.frameDurations.reduce((sum, duration) => sum + duration, 0);
		const sourceFrameSelections = new Map();
		timelines.filter((timeline) => timeline.kind === 'authored').forEach((timeline) => {
			sourceFrameSelections.set(timeline.key, reduced.selections.map((selection) => selection.get(timeline.key)?.frameIndex ?? 0));
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
				const nativeFps = timeline.frames.length * 1000 / timeline.cycleDuration;
				return {
					kind: 'authored',
					key: timeline.key,
					label: timeline.label || String(timeline.key),
					ownerLayerId: timeline.ownerLayerId,
					effectSlot: timeline.effectSlot,
					frameCount: timeline.frames.length,
					nativeFps,
					nativeCycleDuration: timeline.cycleDuration,
					variableTiming: new Set(timeline.frameDurations).size > 1
				};
			});

		return {
			frames: reduced.frames,
			frameDurations: reduced.frameDurations,
			totalDuration,
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
			reduction: {
				smartReductionEnabled: Boolean(options.smartReduction),
				originalFrameCount,
				selectionDuplicatesMerged,
				manuallySampledFrameCount,
				preRenderFramesSkipped,
				renderedFrameCount,
				outputFrameCount: reduced.frames.length,
				exactDuplicatesMerged: reduced.exactDuplicatesMerged,
				nearDuplicatesMerged: reduced.nearDuplicatesMerged,
				framesRemoved: reduced.framesRemoved,
				maximumVisualError: reduced.maximumVisualError,
				effectiveVisualErrorThreshold: reduced.effectiveVisualErrorThreshold,
				durationPreserved: Math.abs(totalDuration - loop.duration) < 0.001,
				preferredBudgetMet: reduced.preferredBudgetMet,
				budgetCompromiseRequired: reduced.budgetCompromiseRequired
			}
		};
	}
}
