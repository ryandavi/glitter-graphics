'use strict';

const DRAG_KINDS = {
	left: { capability: 'run', setter: 'setRun', commitLabel: 'Trim animation', label: 'Starts at', text: (row, run) => formatSeconds(run.start) },
	move: { capability: 'run', setter: 'setRun', commitLabel: 'Move animation', label: 'Starts at', text: (row, run) => formatSeconds(run.start) },
	right: { capability: 'run', setter: 'setRun', commitLabel: 'Trim animation', label: 'Repeats', text: (row, run) => TimelineView.repeatsText(TimelineView.repeats(row, run)) },
	slip: { capability: 'phase', setter: 'setPhase', commitLabel: 'Slip animation', label: 'Start offset', text: (row, value) => `${Number((value * 100).toFixed(1))}%` },
	period: { capability: 'period', setter: 'setPeriod', commitLabel: 'Change animation speed', label: 'Cycle', text: (row, ms) => formatSeconds(ms) },
	duration: {
		capability: 'period', commitLabel: 'Change animation length', label: 'Lasts',
		setter: (dock, value, row) => { row.source.setPeriod(value.period); row.source.setRun(value.run); },
		text: (row, value) => TimelineView.durationText(row, value)
	},
	loop: { setter: (dock, value) => dock.editor.setDocumentLoop(value, { commit: false }), commitLabel: 'Set loop length', label: 'Loop', text: (row, ms) => formatSeconds(ms) },
	key: { label: 'Key at', text: (row, value) => `${Number((value * 100).toFixed(1))}%` }
};

const TimelineView = {
	SEAM_TEXT: 'Visible seam: the end does not match the start.',
	// `kept` names the layers already listed: one of them that is now hidden
	// keeps its group, without rows, so it can be shown again from there.
	buildModel(estimate, layers, kept = new Set()) {
		const loopMs = estimate?.duration || 0;
		const analyses = new Map((estimate?.sourceAnalysis || []).map(entry => [entry.key, entry]));
		const owners = new Map(layers.map(layer => [layer.id, layer]));
		const groups = new Map();
		(estimate?.loopFit?.sources || []).forEach(source => {
			if (!source.ownerLayerId) return;
			const cycleMs = source.kind === 'authored' ? source.cycleDuration : source.naturalPeriod;
			if (!Number.isFinite(cycleMs) || cycleMs <= 0) return;
			const exportCycleMs = analyses.get(source.key)?.resolvedPeriod ?? cycleMs;
			if (!Number.isFinite(exportCycleMs) || exportCycleMs <= 0) return;
			const rows = groups.get(source.ownerLayerId) || [];
			rows.push({
				key: source.key, layerId: source.ownerLayerId, effectSlot: source.effectSlot,
				label: source.rowLabel || source.label, kind: source.kind, cycleMs, exportCycleMs,
				originalPeriod: owners.get(source.ownerLayerId)?.loopOriginalPeriods?.[source.key],
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
	// A bar's box on its track. A bar too short to hold its two grips and a
	// body keeps the body: it is drawn at a least width and its grips sit
	// outside its ends. The left grip stays inside where the track would clip it.
	barBox(row, scale, config) {
		const left = this.timeToX(row.startMs, scale);
		const width = Math.max(config.barMinPx, this.timeToX(Math.max(0, row.endMs - row.startMs), scale));
		const gripsOutside = !this.hasGripRoom(width, config);
		return { left, width, gripsOutside, leftGripInside: gripsOutside && left < config.gripPx };
	},
	hasGripRoom(width, config) { return width >= 3 * config.gripPx; },
	// What a press on a bar's body drags: a motion moves and Alt slips it, a
	// source with only a start offset slips, anything else has no drag.
	bodyDrag(row, alt) {
		if (row.can.run) return alt && row.can.phase ? 'slip' : 'move';
		return row.can.phase ? 'slip' : null;
	},
	// A motion edge sets its length at the same count; Shift trims at the same speed.
	edgeDrag(row, side, shift = false) {
		if (side === 'left') return row.can.run ? 'left' : null;
		if (!row.can.run) return row.can.period ? 'period' : null;
		if (!row.can.period) return 'right';
		return shift ? 'right' : 'duration';
	},
	// The smallest scroll that shows a span, shared by both dock axes.
	revealScroll(start, end, scroll, view) {
		return start < scroll ? start : end > scroll + view ? end - view : scroll;
	},
	motionIndex(row) {
		const match = /^animation-(\d+)$/.exec(row?.effectSlot);
		return match ? Number(match[1]) : null;
	},
	// How many times a run plays its cycle; Infinity to the loop's end.
	repeats(row, run = row.source.run) {
		return run && Number.isFinite(run.end) ? (run.end - run.start) / row.cycleMs + row.phase : Infinity;
	},
	repeatsText(count) { return Number.isFinite(count) ? String(Number(count.toFixed(2))) : 'forever'; },
	durationText(row, { period, run }) {
		if (!Number.isFinite(run.end)) return 'forever';
		const count = this.repeats({ ...row, cycleMs: period }, run);
		return `${formatSeconds(run.end - run.start)} · ${this.repeatsText(count)} × ${formatSeconds(period)}`;
	},
	rowInfo(row) {
		if (row.kind === 'authored') return `${row.frameCount} frames · ${formatSeconds(row.cycleMs)}`;
		return Number.isFinite(row.source.run?.end)
			? this.durationText(row, { period: row.cycleMs, run: row.source.run }) : formatSeconds(row.cycleMs);
	},
	// What a selected bar can do, for the status bar.
	rowHint(row) {
		const body = this.bodyDrag(row, false);
		return [
			body === 'move' ? 'Drag to move' : body === 'slip' ? 'Drag to slip' : null,
			row.can.run ? 'left edge changes start' : null,
			this.edgeDrag(row, 'right') === 'duration' ? 'right edge sets length'
				: this.edgeDrag(row, 'right') === 'period' ? 'right edge stretches cycle' : row.can.run ? 'right edge trims repeats' : null,
			row.can.run && row.can.period ? 'Shift-edge changes repeats' : null,
			body === 'move' && row.can.phase ? 'Alt-drag slips' : null,
			'Enter selects',
			row.can.run || row.can.phase || row.can.period ? 'right-click or Shift+F10 for more' : null
		].filter(Boolean).join(' · ');
	},
	SNAP_RANKS: { playhead: 0, edge: 0, key: 0, cycle: 0, loop: 1, frame: 2, ruler: 3 },
	SNAP_WORDS: {
		playhead: 'playhead', edge: 'another bar', cycle: 'whole cycle', loop: target => target.ms === 0 ? 'loop start' : 'loop end',
		fit: 'fits the animations', frame: 'frame', ruler: target => formatSeconds(target.ms),
		period: 'fits the loop', phase: 'quarter', key: 'another key'
	},
	// The words beside a drag: the value, what it was, and what it snapped to.
	// `value` and `initial` are the drag's own: a run for an edge or a move, a
	// fraction for a slip or a key, milliseconds for a cycle or the loop.
	dragReadout(kind, row, value, initial, target) {
		const { label, text } = DRAG_KINDS[kind];
		const now = text(row, value), before = text(row, initial);
		const word = target && this.SNAP_WORDS[target.kind];
		const snap = typeof word === 'function' ? word(target) : word;
		return `${label} ${now}${now === before ? '' : ` (was ${before})`}${snap ? ` · ${snap}` : ''}`;
	},
	// A key lives at a fraction of its motion's cycle; the lane draws it at the
	// time the motion reaches that fraction in one cycle of the bar. A motion
	// that steps has no such time, so its keys sit at their linear place.
	keyDrawing(row) { return { ...row, cycleMs: row.exportCycleMs, endMs: Infinity }; },
	keyEntry(row, entry) { return { ...entry, periodMs: row.exportCycleMs }; },
	// The cycle the lane opens: the one a moment is in, or the first whole one.
	keyCycle(row, ms) {
		const inside = this.timeToCycle({ ...this.keyDrawing(row), endMs: row.endMs }, ms);
		if (inside) return inside.index;
		const first = Math.ceil(row.phase - 1e-9) + 0;
		return row.startMs + (first + 1 - row.phase) * row.exportCycleMs <= (row.source.run?.end ?? Infinity) + 1e-6 ? first : Math.floor(row.phase);
	},
	cycleSpan(row, index) {
		const start = row.startMs + (index - row.phase) * row.exportCycleMs;
		return { start, end: start + row.exportCycleMs };
	},
	keyToTime(row, entry, at, index) {
		const { start, end } = this.cycleSpan(row, index);
		const runEnd = row.source.run?.end ?? Infinity;
		// A moment inside both the cycle and the run, for the search to start from.
		const reference = Math.max(row.startMs, Math.min((start + end) / 2, runEnd - 1e-6));
		const timed = reference >= start && reference < end ? GlitterAnimation.timeAtProgress(this.keyEntry(row, entry), at, reference) : null;
		if (timed != null) return { ms: Math.max(start, Math.min(end, timed)), untimed: false };
		return { ms: this.cycleToTime(this.keyDrawing(row), index, at), untimed: true };
	},
	timeToKey(row, entry, ms, index) {
		const { start, end } = this.cycleSpan(row, index);
		const time = Math.max(start, Math.min(end - 1e-6, ms));
		const data = this.keyEntry(row, entry);
		const stepped = data.easing === 'steps' || data.snapMode === 'step';
		const progress = stepped ? null : GlitterAnimation.cycleProgress(data, time, { fill: false });
		const at = progress ? progress.eased : this.timeToCycle(this.keyDrawing(row), Math.max(row.startMs, time))?.progress ?? 0;
		return Math.max(0, Math.min(1, ((at % 1) + 1) % 1));
	},
	snapTime(ms, targets, thresholdMs) {
		const nearby = targets.filter(target => Math.abs(target.ms - ms) <= thresholdMs);
		const rank = target => target.rank ?? this.SNAP_RANKS[target.kind] ?? 0;
		nearby.sort((a, b) => rank(a) - rank(b) || Math.abs(a.ms - ms) - Math.abs(b.ms - ms));
		return { ms: nearby[0]?.ms ?? ms, target: nearby[0] || null };
	},
	snapTargets(model, row, kind, playheadMs, view) {
		const target = (ms, kind) => ({ ms, kind });
		if (kind === 'loop') return (model.loopFit?.candidates || []).map(candidate => ({
			ms: candidate.duration, kind: 'fit', exact: candidate.exact, rank: candidate.exact ? 0 : 1
		}));
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
		for (const group of model.groups) {
			if (view?.collapsed.get(group.layerId)) continue;
			for (const other of group.rows) {
				if (other.key !== row.key) targets.push(target(other.startMs, 'edge'), target(other.endMs, 'edge'));
			}
		}
		if (kind === 'right') {
			const drawing = { ...row, endMs: Infinity };
			targets.push(...this.cycleStarts(drawing, model.loopMs).map(ms => target(ms, 'cycle')), target(model.loopMs, 'loop'));
		} else {
			targets.push(target(0, 'loop'), target(model.loopMs, 'loop'));
			const { minor } = this.tickStep(view.scale, view.config);
			for (let ms = 0; ms <= view.endMs; ms += minor) targets.push(target(ms, 'ruler'));
			if (view.frames) targets.push(...model.frameStarts.map(ms => target(ms, 'frame')));
		}
		return targets;
	},
	durationRepeats(row, loopMs, maxCount) {
		const count = this.repeats(row);
		return Number.isFinite(count) ? count
			: Math.min(maxCount, Math.max(1, Math.round((loopMs - row.startMs) / row.cycleMs + row.phase)));
	},
	durationFromEdge(row, count, edgeMs) {
		// The offset has already consumed part of the first repeat.
		const remaining = count - row.phase;
		if (!(remaining > 0)) return null;
		const range = row.source.periodRange;
		let period = clampNumber((edgeMs - row.startMs) / remaining, range.min, range.max);
		if (row.source.resolvePeriod) period = row.source.resolvePeriod(period);
		return { period, run: { start: row.startMs, end: row.startMs + remaining * period } };
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
			if (fit) actions.push({ id: 'fit', label: 'Fit to loop', changesPeriod: true, run: () => writePeriod(fit.fittedPeriod) });
			actions.push({ id: 'match', label: 'Match cycle to...', commitLabel: 'Match cycle', choices: model.groups.flatMap(group => group.rows).filter(other => other.key !== row.key && other.cycleMs >= row.source.periodRange.min && other.cycleMs <= row.source.periodRange.max).map(other => ({ id: `match-${other.key}`, label: `${other.label} (${formatSeconds(other.cycleMs)})`, changesPeriod: true, run: () => writePeriod(other.cycleMs) })) });
			if (row.source.fileCycleDuration) actions.push({ id: 'reset-speed', label: 'Reset speed', changesPeriod: true, run: () => writePeriod(row.source.fileCycleDuration) });
		}
		if (row.can.run) actions.push({ id: 'fill', label: 'Fill the loop', run: () => row.source.setRun({ start: 0, end: Infinity }) });
		if (row.can.run || row.can.phase || row.can.period) actions.push({ id: 'reset', label: 'Reset timing', run: () => {
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
	tickStep(pxPerSecond, config) {
		const major = config.tickSteps.find(ms => this.timeToX(ms, pxPerSecond) >= config.tickLabelMinPx) || config.tickSteps.at(-1);
		return { major, minor: major / (this.timeToX(major / 5, pxPerSecond) >= config.minTickPx ? 5 : 2) };
	},
	tickLabel(ms) { return formatSeconds(ms).replace(/\.00 s$/, ' s').replace(/(\.\d)0 s$/, '$1 s'); },
	frameCells(starts, loopMs, scale, minPx) {
		const cells = [];
		starts.forEach((start, index) => {
			const end = Math.min(starts[index + 1] ?? loopMs, loopMs);
			if (end <= start) return;
			const plain = this.timeToX(end - start, scale) < minPx;
			if (plain && cells.at(-1)?.plain) cells.at(-1).end = end;
			else cells.push({ start, end, index, plain });
		});
		return cells;
	}
};
