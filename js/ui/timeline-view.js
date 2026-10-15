'use strict';

const DRAG_KINDS = {
	left: { capability: 'run', setter: 'run', commitLabel: 'Trim animation', label: FIELDS.animDelay.label, text: (row, run) => formatSeconds(run.start) },
	move: { capability: 'run', setter: 'run', commitLabel: 'Move animation', label: FIELDS.animDelay.label, text: (row, run) => formatSeconds(run.start) },
	right: { capability: 'run', setter: 'run', commitLabel: 'Trim animation', label: FIELDS.animIterations.label, text: (row, run) => TimelineView.repeatsText(TimelineView.repeats(row, run)) },
	slip: { capability: 'phase', setter: 'phase', commitLabel: 'Slip animation', label: FIELDS.animPhase.label, text: (row, value) => `${Number((value * 100).toFixed(1))}%` },
	period: { capability: 'period', setter: 'period', commitLabel: 'Change cycle', label: FIELDS.animDuration.label, text: (row, ms) => formatSeconds(ms) },
	duration: {
		capability: 'period', commitLabel: 'Change animation length', label: 'Lasts',
		setter: (dock, value, row) => { dock.editor.writeTiming(row.key, { period: value.period, run: value.run }, { live: true }); },
		text: (row, value) => TimelineView.durationText(row, value)
	},
	loop: { setter: (dock, value) => dock.editor.setDocumentLoop(value, { commit: false }), commitLabel: 'Set loop length', label: 'Loop', text: (row, ms) => formatSeconds(ms) },
	key: { label: 'Key at', text: (row, value) => `${Number((value * 100).toFixed(1))}%` }
};

const TimelineView = {
	SEAM_TEXT: 'Visible seam: the end does not match the start.',
	buildModel(estimate, layers, editor) {
		const loopMs = estimate?.duration || 0;
		const analyses = new Map((estimate?.sourceAnalysis || []).map(entry => [entry.key, entry]));
		const owners = new Map(layers.map(layer => [layer.id, layer]));
		const groups = new Map();
		const sourceMap = new Map((estimate?.loopFit?.sources || []).map(source => [source.key, source]));
		const targets = editor ? listTimingTargets(editor, layers) : [];
		const entries = editor ? targets.filter(target => target.active !== false && owners.get(target.layerId)?.visible !== false && target.period > 0).map(target => ({ target, source: sourceMap.get(target.key) })) : (estimate?.loopFit?.sources || []).map(source => ({ source }));
		entries.forEach(({ source, target }) => {
			const layerId = target?.layerId || source.ownerLayerId;
			const cycleMs = target?.period ?? (source.kind === 'authored' ? source.cycleDuration : source.naturalPeriod);
			const exportCycleMs = analyses.get(target?.key || source.key)?.resolvedPeriod ?? cycleMs;
			if (!Number.isFinite(cycleMs) || cycleMs <= 0 || !Number.isFinite(exportCycleMs) || exportCycleMs <= 0 || !layerId) return;
			const run = target?.run || source?.run;
			const rows = groups.get(layerId) || [];
			rows.push({
				key: target?.key || source.key, layerId, effectSlot: target?.slot || source?.effectSlot,
				label: target?.label || source.rowLabel || source.label, kind: target ? (target.kind === 'gifCycle' ? 'authored' : 'procedural') : source.kind,
				cycleMs, exportCycleMs, originalPeriod: owners.get(layerId)?.loopOriginalPeriods?.[target?.key || source.key],
				startMs: run?.start || 0, endMs: Math.min(run?.end ?? Infinity, loopMs),
				phase: target?.phase ?? source?.phase ?? 0, direction: target?.direction || source?.direction || 'normal',
				frameCount: source?.frameCount, cycleMarks: source?.cycleMarks || [],
				closes: source ? sourceSeamError(source, loopMs, exportCycleMs) < 1e-8 : true, nonLooping: Number.isFinite(run?.end),
				can: target?.can || { period: source.adjustable === true, run: Boolean(source.run), phase: Boolean(source.run), direction: Boolean(source.run) }, target, curveKey: target?.key || source.key,
				source: { ...source, run, naturalPeriod: cycleMs, periodRange: target?.periodRange || source?.periodRange, resolvePeriod: target?.resolvePeriod || source?.resolvePeriod, fileCycleDuration: target?.fileCycleDuration || source?.fileCycleDuration }
			});
			groups.set(layerId, rows);
		});
		return {
			loopMs, loopFit: estimate?.loopFit, exact: estimate?.exact, frameStarts: estimate?.renderClock?.frameStarts || [],
			frameCount: estimate?.renderClock?.frameCount || 0, outputFormat: estimate?.outputFormat,
			groups: [...layers].reverse().filter(layer => !layer.isPreview).map(layer => {
				const sourceRows = groups.get(layer.id) || [];
				const motions = (layer.animations || []).map((animation) => {
					const effectSlot = GlitterAnimation.slotKey(animation), description = GlitterAnimation.describe(animation);
					const active = layer.animationsEnabled !== false && animation.enabled !== false && layer.visible !== false && sourceRows.find(row => row.effectSlot === effectSlot);
					return { ...(active || {
						key: GlitterAnimation.sourceKey(layer.id, animation), layerId: layer.id, effectSlot, kind: 'procedural',
						cycleMs: animation.periodMs, exportCycleMs: animation.periodMs, startMs: 0, endMs: 0,
						phase: animation.phase, direction: animation.direction, cycleMarks: [], closes: true,
						can: { period: false, run: false, phase: false }, curve: null, source: null
					}), label: description.name, animation, curveInputs: JSON.stringify({ animation, period: active?.cycleMs, phase: animation.phase }), enabled: animation.enabled !== false };
				});
				return {
					layerId: layer.id, name: describeLayer(layer, editor).name, visible: layer.visible !== false,
					locked: isLayerFullyLocked(layer) && !sourceRows.some(row => Object.values(row.can).some(Boolean)), stackLocked: Boolean(layer.locked),
					rows: [...sourceRows.filter(row => this.motionId(row) == null), ...motions]
				};
			})
		};
	},
	motionCurve(source, cycleMs) {
		if (source.kind !== 'procedural' || !source.sampler || !/^motion-.+/.test(source.effectSlot)) return null;
		const count = CONFIG.ui.timeline.curveSamples;
		const samples = Array.from({ length: count + 1 }, (_, i) => source.sampler((source.run?.start || 0) + (Math.ceil(source.phase || 0) - (source.phase || 0) + i / count) * cycleMs, cycleMs)?.sample);
		if (!samples.every(Boolean)) return null;
		let best = null;
		for (const id of Object.keys(GlitterAnimation.POSE_CHANNELS)) {
			const values = samples.map(sample => sample[id]), min = Math.min(...values), max = Math.max(...values);
			const range = (max - min) / CONFIG.tools.animation.convert.tolerance[id];
			if (range > (best?.range || 0)) best = { range, min, max, values };
		}
		if (!best) return null;
		const points = best.values.map((value, i) => `${i / count * 100},${90 - (value - best.min) / (best.max - best.min) * 80}`).join(' ');
		return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="white" stroke-opacity=".35" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`)}")`;
	},
	modelSignature(model) {
		return JSON.stringify({ ...model, loopFit: undefined, groups: model.groups.map(group => ({ ...group, rows: group.rows.map(row => ({ ...row, source: row.source && { run: row.source.run, keys: row.source.keyTrack?.entry?.keys }, curve: undefined, curveInputs: undefined })) })) });
	},
	wheelZoom(travel, delta, threshold) {
		const total = travel && Math.sign(travel) !== Math.sign(delta) ? delta : travel + delta;
		const steps = Math.trunc(total / threshold);
		return { steps, remainder: total - steps * threshold };
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
	motionId(row) {
		return row?.effectSlot?.startsWith('motion-') ? row.effectSlot.slice(7) : null;
	},
	// How many times a run plays its cycle; Infinity to the loop's end.
	repeats(row, run = row.source.run) {
		return run ? GlitterAnimation.repeatsForRun(row, run) : Infinity;
	},
	repeatsText(count) { return Number.isFinite(count) ? String(Number(count.toFixed(2))) : 'forever'; },
	durationText(row, { period, run }) {
		if (!Number.isFinite(run.end)) return 'forever';
		const count = this.repeats({ ...row, cycleMs: period }, run);
		return `${formatSeconds(run.end - run.start)} · ${this.repeatsText(count)} × ${formatSeconds(period)}`;
	},
	seamTitle(row, loopMs) {
		if (row.startMs > loopMs) return 'Starts after the loop ends, so it never plays.';
		if (row.nonLooping) return 'Still holding its last pose when the loop restarts.';
		const time = TimelineView.timeToCycle({ ...row, cycleMs: row.exportCycleMs, endMs: Infinity }, loopMs);
		if (!time) return 'Starts after the loop ends, so it never plays.';
		return `Ends ${formatSeconds(time.progress * row.exportCycleMs)} into a ${formatSeconds(row.exportCycleMs)} cycle, so it jumps when the loop restarts.`;
	},

	exportNote(rowOrSource, analysis) {
		const period = rowOrSource.cycleMs ?? rowOrSource.naturalPeriod;
		const resolved = rowOrSource.exportCycleMs ?? analysis?.resolvedPeriod ?? period;
		return Math.abs(resolved - period) > 0.01 ? `. Export uses ${formatSeconds(resolved)}.` : '';
	},

	barTitle(row, loopMs) {
		let text = `${row.label}: ${this.rowInfo(row)}`;
		const body = this.bodyDrag(row, false);
		text += this.exportNote(row);
		if (!row.closes) text += ` ${TimelineView.seamTitle(row, loopMs)}`;
		if (body === 'move') text += row.can.phase ? ' Drag to move it. Alt-drag to slip the motion inside it.' : ' Drag to move it.';
		else if (body === 'slip') text += ' Drag to slip the motion inside it.';
		return text;
	},
	handleTitle(row, side) {
		let text = '';
			if (side === 'left') text = 'Drag to change when it starts.';
			else {
				const kind = TimelineView.edgeDrag(row, side);
				text = kind === 'duration' ? 'Drag to set how long it lasts, keeping its repeat count.'
					: kind === 'period' ? 'Drag to stretch the cycle.' : 'Drag to trim repeats.';
				if (row.can.run && row.can.period) {
					text += ' Shift: change repeats at the same speed.';
				}
			}
			text += ' Alt: no snapping';
		return text;
	},
	rowInfo(row) {
		if (!row.source && row.animation) return GlitterAnimation.describe(row.animation).detail;
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
	// Key positions are times within a cycle; direction only reverses their placement.
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
		return { ms: this.cycleToTime(this.keyDrawing(row), index, at), untimed: false };
	},
	timeToKey(row, entry, ms, index) {
		const span = this.cycleSpan(row, index);
		const fraction = clampNumber((ms - span.start) / row.exportCycleMs, 0, 1);
		return this.isReversed(row, index) ? 1 - fraction : fraction;
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
	barActions(row, model, context = {}) {
		const actions = [];
		const write = patch => context.write?.(row.key, patch);
		const playhead = context.playhead ?? 0;
		if (row.can.run) {
			actions.push({ id: 'once', label: 'Play once', checked: Math.abs(this.repeats(row) - 1) < 1e-6, run: () => write({ run: { start: row.startMs, end: row.startMs + (1 - row.phase) * row.cycleMs } }) },
				{ id: 'forever', label: 'Repeat forever', checked: !Number.isFinite(row.source.run.end), run: () => write({ run: { start: row.startMs, end: Infinity } }) },
				{ id: 'start', label: 'Start at playhead', run: () => write({ run: { start: clampNumber(playhead, 0, FIELDS.animDelay.max * 1000), end: row.source.run.end } }) },
				{ id: 'end', label: 'End at playhead', disabled: playhead <= row.startMs, run: () => write({ run: { start: row.startMs, end: playhead } }) });
		}
		if (row.can.direction) for (const { value: direction, label } of ANIMATION_DIRECTION_OPTIONS) actions.push({ id: `direction-${direction}`, label, checked: row.direction === direction, run: () => write({ direction }) });
		const writePeriod = period => write({ period });
		if (row.can.period) {
			const fit = model.loopFit?.candidates.find(candidate => candidate.duration === model.loopMs)?.fits.find(entry => entry.source.key === row.key && entry.fitted);
			if (fit) actions.push({ id: 'fit', label: 'Fit to loop', changesPeriod: true, run: () => writePeriod(fit.fittedPeriod) });
			if (row.source.fileCycleDuration) actions.push({ id: 'reset-speed', label: 'Original cycle', changesPeriod: true, run: () => writePeriod(row.source.fileCycleDuration) });
		}
		if (row.can.run) actions.push({ id: 'fill', label: 'Fill the loop', run: () => write({ run: { start: 0, end: Infinity } }) });
		if (row.can.run || row.can.phase || row.can.period) actions.push({ id: 'reset', label: 'Reset timing', run: () => {
			if (row.can.run) write({ run: { start: 0, end: Infinity } });
			if (row.can.phase) write({ phase: 0 });
			if (row.can.direction) write({ direction: 'normal' });
		} });
		if (context.copy) actions.push({ id: 'copy', label: 'Copy timing', commits: false, run: () => context.copy(row) }, { id: 'paste', label: 'Paste timing', disabled: !context.clipboard, changesPeriod: row.can.period, run: () => {
			const timing = context.clipboard;
			if (row.can.period) writePeriod(clampNumber(timing.cycle, row.source.periodRange.min, row.source.periodRange.max));
			if (row.can.phase) write({ phase: timing.phase });
			if (row.can.direction) write({ direction: timing.direction });
			if (row.can.run && timing.run) write({ run: { ...timing.run } });
		} });
		return actions.map(action => ({ ...action, group: ['once', 'forever', 'start', 'end'].includes(action.id) ? 'Run' : action.id.startsWith('direction-') ? 'Direction' : ['copy', 'paste'].includes(action.id) ? 'Timing clipboard' : 'Loop' }));
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
		return GlitterAnimation.isReversedCycle(row.direction, index);
	},
	timeToCycle(row, ms) {
		if (ms < row.startMs || ms >= row.endMs) return null;
		const { cycle: index, progress } = GlitterAnimation.cycleAt({ ...row, start: row.startMs }, ms);
		return { index, progress };
	},
	cycleToTime(row, index, progress) {
		return GlitterAnimation.timeAtCycle({ ...row, start: row.startMs }, index, progress);
	},
	// The start of the output frame nearest a moment: where a playhead snaps.
	nearestFrameStart(frameStarts, ms) {
		if (!frameStarts.length) return ms;
		const index = Math.max(0, indexAtOrBefore(frameStarts, ms, 0));
		const next = frameStarts[index + 1];
		return next !== undefined && Math.abs(next - ms) < Math.abs(frameStarts[index] - ms) ? next : frameStarts[index];
	},
	// One output frame on from a moment, or back. Stepping back from inside a
	// frame lands on that frame's own start first. Both directions wrap.
	stepFrame(frameStarts, ms, direction) {
		if (!frameStarts.length) return ms;
		const index = Math.max(0, indexAtOrBefore(frameStarts, ms));
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
