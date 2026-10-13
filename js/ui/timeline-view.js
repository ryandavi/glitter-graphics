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
			loopMs, exact: estimate?.exact, frameStarts: estimate?.renderClock?.frameStarts || [],
			frameCount: estimate?.renderClock?.frameCount || 0, outputFormat: estimate?.outputFormat,
			groups: [...layers].reverse().filter(layer => groups.has(layer.id) || (layer.visible === false && kept.has(layer.id))).map(layer => ({
				layerId: layer.id, name: layer.name, locked: isLayerFullyLocked(layer), rows: groups.get(layer.id) || []
			}))
		};
	},
	timeToX(ms, pxPerSecond) { return ms * pxPerSecond / 1000; },
	xToTime(px, pxPerSecond) { return px * 1000 / pxPerSecond; },
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
