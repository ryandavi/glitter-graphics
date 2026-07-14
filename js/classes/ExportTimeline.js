// Export timeline planning primitives. Loaded before GifExporter and Mp4Exporter.
class AnimationSourceTimeline {
	constructor({ key, ownerLayerId = null, effectSlot = null, frames = [], frameDurations = [], fallbackDuration = 100 }) {
		this.key = key;
		this.ownerLayerId = ownerLayerId;
		this.effectSlot = effectSlot;
		this.frames = frames;
		this.isStatic = frames.length <= 1;
		this.frameDurations = frames.map((_, index) => AnimationSourceTimeline.normalizeDuration(
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
		let samples = 0;
		for (let index = 0; index < dataA.length; index += stride) {
			const red = Math.abs(dataA[index] - dataB[index]);
			const green = Math.abs(dataA[index + 1] - dataB[index + 1]);
			const blue = Math.abs(dataA[index + 2] - dataB[index + 2]);
			const alpha = Math.abs(dataA[index + 3] - dataB[index + 3]);
			error += (red + green + blue + alpha) / (255 * 4);
			samples++;
		}
		return samples ? error / samples : 0;
	}

	reduce(input, { enabled, visualErrorThreshold, preferredFrameBudget, hardFrameLimit }) {
		const frames = [...input.frames];
		const frameDurations = [...input.frameDurations];
		const selections = input.selections.map((selection) => new Map(selection));
		let exactDuplicatesMerged = 0;
		let nearDuplicatesMerged = 0;
		let maximumVisualError = 0;

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

			while (frames.length > preferredFrameBudget && frames.length > 2) {
				let best = null;
				for (let index = 1; index < frames.length - 1; index++) {
					const sampledPrev = CompositeFrameReducer.difference(frames[index], frames[index - 1], true);
					const sampledNext = CompositeFrameReducer.difference(frames[index], frames[index + 1], true);
					const sampledScore = Math.min(sampledPrev, sampledNext);
					if (sampledScore > visualErrorThreshold * 1.5) continue;
					const prev = CompositeFrameReducer.difference(frames[index], frames[index - 1]);
					const next = CompositeFrameReducer.difference(frames[index], frames[index + 1]);
					const score = Math.min(prev, next);
					const materialChange = prev > visualErrorThreshold * 4 && next > visualErrorThreshold * 4;
					if (!materialChange && score <= visualErrorThreshold && (!best || score < best.score)) {
						best = { index, score, mergePrevious: prev <= next };
					}
				}
				if (!best) break;
				if (best.mergePrevious) frameDurations[best.index - 1] += frameDurations[best.index];
				else frameDurations[best.index + 1] += frameDurations[best.index];
				frames.splice(best.index, 1);
				frameDurations.splice(best.index, 1);
				selections.splice(best.index, 1);
				nearDuplicatesMerged++;
				maximumVisualError = Math.max(maximumVisualError, best.score);
			}
		}

		return {
			frames,
			frameDurations,
			selections,
			exactDuplicatesMerged,
			nearDuplicatesMerged,
			maximumVisualError,
			budgetCompromiseRequired: frames.length > hardFrameLimit,
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
		let common = animated[0].cycleDuration;
		for (let index = 1; index < animated.length; index++) {
			common = this._lcmBounded(common, animated[index].cycleDuration, maximumDuration);
			if (common == null) break;
		}
		if (common != null && common <= maximumDuration) {
			return { duration: common, exact: true, seamError: 0, completedSources: animated.length };
		}

		const candidates = new Set([maximumDuration]);
		animated.forEach((timeline) => {
			for (let multiple = timeline.cycleDuration; multiple <= maximumDuration; multiple += timeline.cycleDuration) {
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
			const score = error / animated.length - (duration / maximumDuration) * 0.001;
			if (!best || score < best.score) best = { duration, score, seamError: error / animated.length, completedSources };
		});
		return { duration: best.duration, exact: false, seamError: best.seamError, completedSources: best.completedSources };
	}

	_buildTimestamps(timelines, duration, maxSamplingFps) {
		const minimumInterval = 1000 / Math.max(1, maxSamplingFps);
		const candidates = new Set([0, duration]);
		timelines.forEach((timeline) => timeline.boundariesUntil(duration).forEach((time) => candidates.add(time)));
		const sorted = [...candidates].sort((left, right) => left - right);
		const selected = [0];
		for (let index = 1; index < sorted.length - 1; index++) {
			if (sorted[index] - selected.at(-1) >= minimumInterval) selected.push(sorted[index]);
		}
		if (duration - selected.at(-1) < minimumInterval && selected.length > 1) selected.pop();
		selected.push(duration);
		return selected;
	}

	estimateLoop(timelines, fallbackDuration, maximumDuration) {
		const normalizedFallback = AnimationSourceTimeline.normalizeDuration(fallbackDuration, 100);
		return this._chooseLoopDuration(timelines, normalizedFallback, maximumDuration);
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
		const timelines = options.timelines || [];
		const fallbackDuration = AnimationSourceTimeline.normalizeDuration(options.fallbackDuration, 100);
		const loop = this._chooseLoopDuration(timelines, fallbackDuration, options.maxLoopDurationMs);
		const timestamps = this._buildTimestamps(timelines, loop.duration, options.maxSamplingFps);
		let entries = [];
		for (let index = 0; index < timestamps.length - 1; index++) {
			const timestamp = timestamps[index];
			const selection = new Map(timelines.map((timeline) => [timeline.key, { frameIndex: timeline.frameIndexAt(timestamp) }]));
			entries.push({
				frame: await options.renderFrame(timestamp, selection),
				duration: timestamps[index + 1] - timestamp,
				selection
			});
		}
		const originalFrameCount = entries.length;
		entries = this._applyManualSampling(entries, Math.max(1, options.manualFrameSkip || 1));
		if (options.reverse) entries.reverse();

		const reduced = this.reducer.reduce({
			frames: entries.map((entry) => entry.frame),
			frameDurations: entries.map((entry) => entry.duration),
			selections: entries.map((entry) => entry.selection)
		}, {
			enabled: options.smartReduction,
			visualErrorThreshold: options.visualErrorThreshold,
			preferredFrameBudget: options.preferredFrameBudget,
			hardFrameLimit: options.hardFrameLimit
		});
		const totalDuration = reduced.frameDurations.reduce((sum, duration) => sum + duration, 0);
		const sourceFrameSelections = new Map();
		timelines.forEach((timeline) => {
			sourceFrameSelections.set(timeline.key, reduced.selections.map((selection) => selection.get(timeline.key)?.frameIndex ?? 0));
		});

		return {
			frames: reduced.frames,
			frameDurations: reduced.frameDurations,
			totalDuration,
			sourceFrameSelections,
			loopSeam: {
				exact: loop.exact,
				error: loop.seamError,
				completedSources: loop.completedSources,
				duration: loop.duration
			},
			reduction: {
				smartReductionEnabled: Boolean(options.smartReduction),
				originalFrameCount,
				manuallySampledFrameCount: entries.length,
				outputFrameCount: reduced.frames.length,
				exactDuplicatesMerged: reduced.exactDuplicatesMerged,
				nearDuplicatesMerged: reduced.nearDuplicatesMerged,
				maximumVisualError: reduced.maximumVisualError,
				durationPreserved: totalDuration === loop.duration,
				preferredBudgetMet: reduced.preferredBudgetMet,
				budgetCompromiseRequired: reduced.budgetCompromiseRequired
			}
		};
	}
}
