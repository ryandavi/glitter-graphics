'use strict';

const TimelineView = {
	// `kept` names the layers already listed: one of them that is now hidden
	// keeps its group, without rows, so it can be shown again from there.
	buildModel(estimate, layers, kept = new Set()) {
		const loopMs = estimate?.duration || 0;
		const analyses = new Map((estimate?.sourceAnalysis || []).map(entry => [entry.key, entry]));
		const groups = new Map();
		(estimate?.loopFit?.sources || []).forEach(source => {
			if (!source.ownerLayerId) return;
			const cycleMs = source.kind === 'authored' ? source.cycleDuration : source.naturalPeriod;
			if (!Number.isFinite(cycleMs)) return;
			const exportCycleMs = analyses.get(source.key)?.resolvedPeriod || cycleMs;
			const rows = groups.get(source.ownerLayerId) || [];
			rows.push({
				key: source.key, layerId: source.ownerLayerId, effectSlot: source.effectSlot,
				label: source.rowLabel || source.label, kind: source.kind, cycleMs, exportCycleMs,
				startMs: source.run?.start || 0, endMs: Math.min(source.run?.end ?? Infinity, loopMs),
				phase: source.phase || 0, direction: source.direction || 'normal',
				frameCount: source.frameCount, cycleMarks: source.cycleMarks || [],
				closes: sourceSeamError(source, loopMs, exportCycleMs) < 1e-8, nonLooping: source.nonLooping,
				can: { period: typeof source.setPeriod === 'function', run: typeof source.setRun === 'function', phase: typeof source.setPhase === 'function' },
				source
			});
			groups.set(source.ownerLayerId, rows);
		});
		return {
			loopMs, loopFit: estimate?.loopFit, exact: estimate?.exact, frameStarts: estimate?.renderClock?.frameStarts || [],
			frameCount: estimate?.renderClock?.frameCount || 0, outputFormat: estimate?.outputFormat,
			groups: [...layers].reverse().filter(layer => groups.has(layer.id) || (layer.visible === false && kept.has(layer.id))).map(layer => ({
				layerId: layer.id, name: layer.name, locked: isLayerFullyLocked(layer), rows: groups.get(layer.id) || []
			}))
		};
	},
	timeToX(ms, pxPerSecond) { return ms * pxPerSecond / 1000; },
	xToTime(px, pxPerSecond) { return px * 1000 / pxPerSecond; },
	keyToX(at, width, trackLength) { return at / trackLength * width; },
	xToKey(x, width, trackLength) { return Math.max(0, Math.min(trackLength, x / width * trackLength)); },
	snapTime(ms, targets, thresholdMs) {
		const nearby = targets.filter(target => Math.abs(target.ms - ms) <= thresholdMs);
		nearby.sort((a, b) => (a.exact === true ? 0 : 1) - (b.exact === true ? 0 : 1) || Math.abs(a.ms - ms) - Math.abs(b.ms - ms));
		return { ms: nearby[0]?.ms ?? ms, target: nearby[0] || null };
	},
	snapTargets(model, row, kind, playheadMs) {
		const target = (ms, kind) => ({ ms, kind });
		if (kind === 'loop') return (model.loopFit?.candidates || []).map(candidate => ({ ms: candidate.duration, kind: 'loop', exact: candidate.exact }));
		if (kind === 'slip') return [0, 0.25, 0.5, 0.75, 1].map(ms => target(ms, 'phase'));
		if (kind === 'period') {
			const room = model.loopMs - row.startMs;
			const range = row.source.periodRange;
			if (!range || room <= 0) return [];
			const result = [];
			for (let n = Math.max(1, Math.ceil(room / range.max)); n <= Math.floor(room / range.min); n++) result.push(target(room / n, 'period'));
			return result;
		}
		const targets = [target(playheadMs, 'playhead')];
		for (const group of model.groups) for (const other of group.rows) {
			if (other.key !== row.key) targets.push(target(other.startMs, 'edge'), target(other.endMs, 'edge'));
		}
		if (kind === 'right') {
			const drawing = { ...row, endMs: Infinity };
			targets.push(...this.cycleStarts(drawing, model.loopMs).map(ms => target(ms, 'cycle')), target(model.loopMs, 'loop'));
		} else targets.push(...model.frameStarts.map(ms => target(ms, 'frame')));
		return targets;
	},
	runFromRightEdge(row, timeMs, loopMs) {
		return { start: row.startMs, end: timeMs >= loopMs ? Infinity : Math.max(row.startMs + row.cycleMs * Number.EPSILON, timeMs) };
	},
	runFromLeftEdge(row, timeMs) {
		return { start: Math.max(0, Math.min(timeMs, (row.source.run?.end ?? Infinity) - 1)), end: row.source.run?.end ?? Infinity };
	},
	runFromBodyMove(row, deltaMs) {
		const start = Math.max(0, row.startMs + deltaMs);
		return { start, end: Number.isFinite(row.source.run?.end) ? row.source.run.end + start - row.startMs : Infinity };
	},
	phaseFromSlip(row, deltaMs) { return ((row.phase - deltaMs / row.cycleMs) % 1 + 1) % 1; },
	periodFromNotch(row, notchIndex, timeMs) { return (timeMs - row.startMs) / (notchIndex - row.phase); },
	barActions(row, model) {
		const actions = [];
		const writePeriod = period => row.source.setPeriod(row.source.resolvePeriod ? row.source.resolvePeriod(period) : period);
		if (row.can.period) {
			const fit = model.loopFit?.candidates.find(candidate => candidate.duration === model.loopMs)?.fits.find(entry => entry.source.key === row.key && entry.fitted);
			if (fit) actions.push({ id: 'fit', label: 'Fit to loop', run: () => writePeriod(fit.fittedPeriod) });
			actions.push({ id: 'match', label: 'Match cycle to...', choices: model.groups.flatMap(group => group.rows).filter(other => other.key !== row.key && other.cycleMs >= row.source.periodRange.min && other.cycleMs <= row.source.periodRange.max).map(other => ({ id: `match-${other.key}`, label: `${other.label} (${(other.cycleMs / 1000).toFixed(2)} s)`, run: () => writePeriod(other.cycleMs) })) });
			if (row.source.fileCycleDuration) actions.push({ id: 'reset-speed', label: 'Reset speed', run: () => writePeriod(row.source.fileCycleDuration) });
		}
		if (row.can.run) actions.push({ id: 'fill', label: 'Fill the loop', run: () => row.source.setRun({ start: 0, end: Infinity }) });
		if (row.can.run || row.can.phase || row.can.period) actions.push({ id: 'reset', label: 'Reset timing', run: () => {
			if (row.can.period && row.originalPeriod != null) writePeriod(row.originalPeriod);
			if (row.can.run) row.source.setRun({ start: 0, end: Infinity });
			if (row.can.phase) row.source.setPhase(0);
		} });
		return actions;
	},
	cycleStarts(row, untilMs) {
		const starts = [];
		const end = Math.min(row.endMs, untilMs);
		for (let index = Math.floor(row.phase) + 1; ; index++) {
			const time = this.cycleToTime(row, index, this.isReversed(row, index) ? 1 : 0);
			if (time >= end) break;
			if (time > row.startMs) starts.push(time);
		}
		return starts;
	},
	isReversed(row, index) {
		return row.direction === 'reverse' || (row.direction === 'alternate' && index % 2 !== 0)
			|| (row.direction === 'alternate-reverse' && index % 2 === 0);
	},
	timeToCycle(row, ms) {
		if (ms < row.startMs || ms >= row.endMs) return null;
		const u = (ms - row.startMs) / row.cycleMs + row.phase;
		const index = Math.floor(u);
		const progress = u - index;
		return { index, progress: this.isReversed(row, index) ? 1 - progress : progress };
	},
	cycleToTime(row, index, progress) {
		return row.startMs + (index + (this.isReversed(row, index) ? 1 - progress : progress) - row.phase) * row.cycleMs;
	},
	// The start of the output frame nearest a moment: where a playhead snaps.
	nearestFrameStart(frameStarts, ms) {
		return frameStarts.reduce((best, start) => (Math.abs(start - ms) < Math.abs(best - ms) ? start : best), frameStarts.length ? frameStarts[0] : ms);
	},
	// One output frame on from a moment, or back. Stepping back from inside a
	// frame lands on that frame's own start first. Both directions wrap.
	stepFrame(frameStarts, ms, direction) {
		if (!frameStarts.length) return ms;
		const index = Math.max(0, frameStarts.findLastIndex(start => start <= ms + 1e-6));
		if (direction < 0 && ms - frameStarts[index] > 1e-6) return frameStarts[index];
		return frameStarts[(index + direction + frameStarts.length) % frameStarts.length];
	},
	tickStep(pxPerSecond, minPx) {
		return [100, 200, 500, 1000, 2000, 5000].find(ms => this.timeToX(ms, pxPerSecond) >= minPx) || 5000;
	}
};
