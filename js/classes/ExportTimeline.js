// Export timeline planning primitives. Loaded before GifExporter and Mp4Exporter.
class AnimationSourceTimeline {
	constructor({ key, label = null, ownerLayerId = null, effectSlot = null, frames = [], frameDurations = [], fallbackDuration = 100 }) {
		this.key = key;
		this.label = label;
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

	_resolveCadenceClusters(timelines, enabled) {
		const unchanged = { timelines, normalized: false, groups: [] };
		if (!enabled
			|| !Number.isFinite(this.config.nearCadenceTolerance)
			|| !Number.isFinite(this.config.cadenceClusterSpanTolerance)) return unchanged;
		const steady = timelines.map((timeline, index) => {
			if (!Number.isFinite(timeline.cycleDuration)) return null;
			const cadence = timeline.frameDurations[0];
			return timeline.frameDurations.every((duration) => duration === cadence)
				? { timeline, index, cadence }
				: null;
		}).filter(Boolean).sort((left, right) => left.cadence - right.cadence);
		if (steady.length < 2) return unchanged;

		const clusters = [];
		steady.forEach((entry) => {
			const cluster = clusters.at(-1);
			const adjacent = cluster ? cluster.at(-1).cadence : null;
			const clusterMinimum = cluster ? cluster[0].cadence : null;
			const joinsAdjacent = cluster && (entry.cadence - adjacent) / adjacent <= this.config.nearCadenceTolerance;
			const fitsCluster = cluster && (entry.cadence - clusterMinimum) / clusterMinimum <= this.config.cadenceClusterSpanTolerance;
			if (joinsAdjacent && fitsCluster) cluster.push(entry);
			else clusters.push([entry]);
		});

		const replacements = new Map();
		const groups = [];
		clusters.forEach((cluster) => {
			const sourceCadences = [...new Set(cluster.map((entry) => entry.cadence))];
			if (sourceCadences.length < 2) return;
			// The weighted median minimizes how many source timelines are retimed.
			// The upper entry on an even split selects the slower cadence.
			const cadence = cluster[Math.floor(cluster.length / 2)].cadence;
			cluster.forEach(({ timeline, index }) => {
				if (timeline.frameDurations[0] === cadence) return;
				replacements.set(index, new AnimationSourceTimeline({
					key: timeline.key,
					label: timeline.label,
					ownerLayerId: timeline.ownerLayerId,
					effectSlot: timeline.effectSlot,
					frames: timeline.frames,
					frameDurations: timeline.frames.map(() => cadence),
					fallbackDuration: cadence
				}));
			});
			groups.push({ sourceCadences, cadence });
		});
		if (!groups.length) return unchanged;
		return {
			timelines: timelines.map((timeline, index) => replacements.get(index) || timeline),
			normalized: true,
			groups
		};
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

	_reconcileRates(timelines, config = {}) {
		const animated = timelines.filter((timeline) => Number.isFinite(timeline.cycleDuration));
		const unchanged = { timelines, reconciled: false, gridIntervalMs: null, layers: [] };
		if (!config.enabled || animated.length < 2) return unchanged;
		const sourceData = animated.map((timeline) => ({
			timeline,
			interval: timeline.cycleDuration / timeline.frames.length
		}));
		const minimumInterval = Math.min(...sourceData.map((source) => source.interval));
		const forcedFps = Number(config.gridSource);
		const candidates = Number.isFinite(forcedFps) && forcedFps > 0
			? [1000 / forcedFps]
			: [
				minimumInterval,
				minimumInterval / 2,
				minimumInterval / 3,
				...sourceData.map((source) => source.interval),
				...(config.niceIntervalsMs || [])
			];
		const weights = config.weights || {};
		let best = null;
		[...new Set(candidates.filter((value) => Number.isFinite(value) && value > 0).map((value) => Number(value.toFixed(6))))]
			.forEach((gridIntervalMs) => {
				const layers = sourceData.map(({ timeline, interval }) => {
					const multiple = Math.max(1, Math.round(interval / gridIntervalMs));
					const adjustedInterval = multiple * gridIntervalMs;
					const drift = Math.abs(adjustedInterval - interval) / interval;
					return {
						timeline,
						multiple,
						adjustedInterval,
						drift,
						snapped: drift <= config.maxCycleDriftRatio
					};
				});
				const snapped = layers.filter((layer) => layer.snapped);
				let gridLoopFrames = 1;
				snapped.forEach((layer) => {
					gridLoopFrames = this._lcmBounded(gridLoopFrames, layer.multiple * layer.timeline.frames.length, Number.MAX_SAFE_INTEGER) || Number.MAX_SAFE_INTEGER;
				});
				const drifts = layers.map((layer) => layer.drift);
				const maximumDrift = Math.max(...drifts);
				const meanDrift = drifts.reduce((sum, drift) => sum + drift, 0) / drifts.length;
				const unsnappedCount = layers.length - snapped.length;
				const score = (weights.frames || 1) * gridLoopFrames
					+ (weights.maxDrift || 0) * maximumDrift
					+ (weights.meanDrift || 0) * meanDrift
					+ (weights.unsnapped || 0) * unsnappedCount;
				if (!best || score < best.score) best = { gridIntervalMs, layers, score };
			});
		if (!best || !best.layers.some((layer) => layer.snapped)) return unchanged;

		const replacements = new Map();
		best.layers.forEach((layer) => {
			if (!layer.snapped) return;
			const frameDurations = layer.timeline.frameDurations.map((duration) =>
				Math.max(best.gridIntervalMs, Math.round(duration / best.gridIntervalMs) * best.gridIntervalMs)
			);
			replacements.set(layer.timeline, new AnimationSourceTimeline({
				key: layer.timeline.key,
				label: layer.timeline.label,
				ownerLayerId: layer.timeline.ownerLayerId,
				effectSlot: layer.timeline.effectSlot,
				frames: layer.timeline.frames,
				frameDurations,
				fallbackDuration: best.gridIntervalMs
			}));
		});
		return {
			timelines: timelines.map((timeline) => replacements.get(timeline) || timeline),
			reconciled: true,
			gridIntervalMs: best.gridIntervalMs,
			layers: best.layers.map((layer) => ({
				key: layer.timeline.key,
				nativeFps: 1000 / layer.interval,
				exportFps: layer.snapped ? 1000 / layer.adjustedInterval : 1000 / layer.interval,
				driftPercent: layer.drift * 100,
				snapped: layer.snapped
			}))
		};
	}

	_buildTimestamps(timelines, duration, maxSamplingFps) {
		const minimumInterval = 1000 / Math.max(1, maxSamplingFps);
		const candidates = new Set([0, duration]);
		let needsSamplingGrid = false;
		timelines.forEach((timeline) => {
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
			for (let timestamp = minimumInterval; timestamp < duration; timestamp += minimumInterval) {
				candidates.add(timestamp);
			}
		}
		return [...candidates].sort((left, right) => left - right);
	}

	estimateLoop(timelines, fallbackDuration, maximumDuration, normalizeCadenceGroups = false, rateReconciliation = null) {
		const normalizedFallback = AnimationSourceTimeline.normalizeDuration(fallbackDuration, 100);
		const resolved = this._resolveCadenceClusters(timelines, normalizeCadenceGroups);
		const initialLoop = this._chooseLoopDuration(resolved.timelines, normalizedFallback, maximumDuration);
		if (initialLoop.exact) return initialLoop;
		const reconciliation = this._reconcileRates(resolved.timelines, rateReconciliation || {});
		return this._chooseLoopDuration(reconciliation.timelines, normalizedFallback, maximumDuration);
	}

	_selectionSignature(selection) {
		return [...selection.values()].map((entry) => entry.frameIndex).join(',');
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
		const fallbackDuration = AnimationSourceTimeline.normalizeDuration(options.fallbackDuration, 100);
		const timingResolution = this._resolveCadenceClusters(sourceTimelines, options.normalizeCadenceGroups);
		let timelines = timingResolution.timelines;
		let loop = this._chooseLoopDuration(timelines, fallbackDuration, options.maxLoopDurationMs);
		let rateReconciliation = { timelines, reconciled: false, gridIntervalMs: null, layers: [] };
		if (!loop.exact) {
			rateReconciliation = this._reconcileRates(timelines, options.rateReconciliation || {});
			if (rateReconciliation.reconciled) {
				timelines = rateReconciliation.timelines;
				loop = this._chooseLoopDuration(timelines, fallbackDuration, options.maxLoopDurationMs);
				const snappedChanges = rateReconciliation.layers
					.filter((layer) => layer.snapped && Math.abs(layer.nativeFps - layer.exportFps) >= 0.01)
					.map((layer) => `${layer.key} ${Math.round(layer.nativeFps)} → ${Math.round(layer.exportFps)} fps`);
				const gridFps = Math.round(1000 / rateReconciliation.gridIntervalMs);
				if (snappedChanges.length) options.onStatus?.(`Matched layer frame rates to a shared ${gridFps} fps grid (${snappedChanges.join(', ')}) so the loop stays short.`);
			}
		}
		if (!loop.exact) options.onStatus?.('Loop optimized with a best-fit seam; the exact common loop was too long.');
		const timestamps = this._buildTimestamps(timelines, loop.duration, options.maxSamplingFps);
		let entries = [];
		for (let index = 0; index < timestamps.length - 1; index++) {
			const timestamp = timestamps[index];
			const selection = new Map(timelines.map((timeline) => [timeline.key, { frameIndex: timeline.frameIndexAt(timestamp) }]));
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
		const preRenderBudgetMultiplier = options.preRenderBudgetMultiplier || this.config.preRenderBudgetMultiplier;
		const preRenderBudget = options.smartReduction && options.preRenderSampling
			? Math.min(options.hardFrameLimit, Math.max(
				options.preferredFrameBudget,
				Math.ceil(options.preferredFrameBudget * preRenderBudgetMultiplier)
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
			preferredFrameBudget: options.preferredFrameBudget,
			hardFrameLimit: options.hardFrameLimit
		});
		const totalDuration = reduced.frameDurations.reduce((sum, duration) => sum + duration, 0);
		const sourceFrameSelections = new Map();
		timelines.forEach((timeline) => {
			sourceFrameSelections.set(timeline.key, reduced.selections.map((selection) => selection.get(timeline.key)?.frameIndex ?? 0));
		});
		const resolvedTimelines = new Map(timelines.map((timeline) => [timeline.key, timeline]));
		const sourceAnalysis = sourceTimelines
			.filter((timeline) => Number.isFinite(timeline.cycleDuration))
			.map((timeline) => {
				const resolved = resolvedTimelines.get(timeline.key) || timeline;
				const nativeFps = timeline.frames.length * 1000 / timeline.cycleDuration;
				const resolvedFps = resolved.frames.length * 1000 / resolved.cycleDuration;
				const timingChanged = timeline.frameDurations.some((duration, index) =>
					Math.abs(duration - resolved.frameDurations[index]) >= 0.01);
				return {
					key: timeline.key,
					label: timeline.label || String(timeline.key),
					ownerLayerId: timeline.ownerLayerId,
					effectSlot: timeline.effectSlot,
					frameCount: timeline.frames.length,
					nativeFps,
					resolvedFps,
					nativeCycleDuration: timeline.cycleDuration,
					resolvedCycleDuration: resolved.cycleDuration,
					variableTiming: new Set(timeline.frameDurations).size > 1,
					timingChanged
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
				cadenceGroupsNormalized: timingResolution.normalized,
				groups: timingResolution.groups,
				rateReconciliation: rateReconciliation.reconciled ? {
					gridIntervalMs: rateReconciliation.gridIntervalMs,
					layers: rateReconciliation.layers
				} : null
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
