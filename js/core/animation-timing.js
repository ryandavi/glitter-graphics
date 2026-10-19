'use strict';

const TIMING_TARGET_OWNERS = new WeakMap();

const ANIMATION_TIMING_KINDS = {
	appear: {
		movePatch(target, delta) { return { run: { start: target.run.start + delta, end: target.run.end + delta } }; },
		moveSnapshot(target) { return { appear: target.appear && { ...target.appear } }; },
		collect(editor, layer) {
			return supportsLayerAppear(layer) ? [{ key: `__appear_${layer.id}`, label: 'Layer visibility',
				appear: layer.appear || null, run: { start: layer.appear?.start || 0, end: layer.appear?.end ?? Infinity },
				active: Boolean(layer.appear), can: { run: true, appear: true } }] : [];
		},
		write(editor, layer, target, patch) {
			if (!Object.hasOwn(patch, 'appear') && !patch.run) return;
			const value = Object.hasOwn(patch, 'appear') ? patch.appear : patch.run && { start: patch.run.start, end: patch.run.end === Infinity ? null : patch.run.end };
			const appear = normalizeLayerAppear(value);
			if (appear) layer.appear = appear;
			else delete layer.appear;
		}
	},
	motion: {
		movePatch(target, delta) { return { delayMs: target.run.start + delta }; },
		moveSnapshot(target) { return { delayMs: target.animation.delayMs }; },
		collect(editor, layer) {
			return (layer.animations || []).map(animation => ({
				key: GlitterAnimation.sourceKey(layer.id, animation), slot: GlitterAnimation.slotKey(animation), motionId: animation.id,
				label: GlitterAnimation.describe(animation).name, period: animation.periodMs,
				periodRange: { min: FIELDS.animDuration.min * 1000, max: FIELDS.animDuration.max * 1000 },
				run: GlitterAnimation.runTiming(animation), phase: animation.phase, direction: animation.direction,
				animation, active: layer.animationsEnabled !== false && GlitterAnimation.isActive(animation),
				can: { period: true, run: true, phase: true, direction: true }
			}));
		},
		write(editor, layer, target, patch) {
			const animation = layer.animations.find(animation => animation.id === target.motionId);
			const data = { ...animation };
			const previousRun = GlitterAnimation.runTiming(data);
			if (patch.period != null) data.periodMs = clampNumber(patch.period, target.periodRange.min, target.periodRange.max);
			if (patch.delayMs != null) data.delayMs = clampNumber(patch.delayMs, 0, CONFIG.export.timeline.maxTimelineMs);
			if (patch.iterations != null) data.iterations = Number.isFinite(patch.iterations) ? clampNumber(patch.iterations, FIELDS.animIterations.min, FIELDS.animIterations.max) : Infinity;
			if (patch.phase != null) data.phase = ((Number(patch.phase) % 1) + 1) % 1;
			if (data.phase !== animation.phase && patch.iterations == null && !patch.run && Number.isFinite(previousRun.end)) {
				const iterations = GlitterAnimation.repeatsForRun({ cycleMs: data.periodMs, phase: data.phase }, { start: data.delayMs, end: previousRun.end });
				if (iterations < FIELDS.animIterations.min || iterations > FIELDS.animIterations.max) return;
				data.iterations = iterations;
			}
			if (patch.direction && ANIMATION_DIRECTION_OPTIONS.some(option => option.value === patch.direction)) data.direction = patch.direction;
			if (patch.run) {
				data.delayMs = clampNumber(patch.run.start, 0, CONFIG.export.timeline.maxTimelineMs);
				data.iterations = GlitterAnimation.iterationsForRun(data, patch.run);
			}
			Object.assign(animation, data);
		}
	},
	sparkles: {
		collect(editor, layer) {
			return getLayerSparkleEntries(layer).map(entry => ({ key: `__sparkles_${getSparkleSampleKey(layer, entry)}`, slot: entry.key, record: entry.data,
				label: 'Sparkles', period: entry.data.cycleMs, periodRange: { min: FIELDS.sparkleCycle.min, max: FIELDS.sparkleCycle.max }, can: { period: true } }));
		},
		write(editor, layer, target, patch) { if (patch.period != null) target.record.cycleMs = clampNumber(patch.period, target.periodRange.min, target.periodRange.max); }
	},
	patternScroll: {
		collect(editor, layer) {
			return getLayerPaintSlots(layer).filter(entry => entry.renders && entry.data.mode === 'pattern' && normalizeEffectPattern(entry.data.pattern).scroll !== 'none').map(entry => ({
				key: `__pattern_${getPaintSlotSourceKey(layer, entry)}`, slot: entry.key, record: entry.data.pattern,
				label: 'Pattern scroll', period: normalizeEffectPattern(entry.data.pattern).scrollCycleMs, periodRange: { min: FIELDS.patternScrollCycle.min, max: FIELDS.patternScrollCycle.max }, can: { period: true }
			}));
		},
		write(editor, layer, target, patch) { if (patch.period != null) target.record.scrollCycleMs = clampNumber(patch.period, target.periodRange.min, target.periodRange.max); }
	},
	filterAnimation: {
		collect(editor, layer) {
			if (!layer.filterData || !GlitterFilter.isActive(layer.filterData, layer.opacity)) return [];
			const animation = GlitterFilter.animation(layer.filterData), control = GlitterFilters.get(layer.filterData.type).periodControl;
			if (!animation && !control) return [];
			return [{ key: `__filter_anim_${layer.id}`, label: GlitterFilter.summaryText(layer.filterData), period: animation ? animation.frames * animation.frameMs : null, active: Boolean(animation),
				periodRange: control?.range(layer.filterData), resolvePeriod: control ? ms => control.resolve(ms, layer.filterData) : null, can: { period: Boolean(control) } }];
		},
		write(editor, layer, target, patch) {
			if (patch.period == null) return;
			const control = GlitterFilters.get(layer.filterData.type).periodControl;
			control.set(layer.filterData, control.resolve(clampNumber(patch.period, target.periodRange.min, target.periodRange.max), layer.filterData));
		}
	},
	gifCycle: {
		collect(editor, layer) {
			if (!isFeatureEnabled('gifCycle')) return [];
			return editor.sceneCompositor.describeAuthoredTiming(layer).map(({ descriptor, timing }) => {
				const fileCycleDuration = timing?.file.reduce((sum, duration) => sum + duration, 0);
				return { key: descriptor.key, slot: descriptor.effectSlot, record: descriptor.timingRecord, label: descriptor.rowLabel || descriptor.label,
					period: timing?.delays.reduce((sum, duration) => sum + duration, 0), fileCycleDuration, periodRange: timing?.range || null,
					resolvePeriod: ms => roundTo(ms, CONFIG.export.timeline.renderClock.gifDelayQuantumMs), can: { period: Boolean(timing?.range && descriptor.timingRecord) } };
			});
		},
		write(editor, layer, target, patch) {
			if (patch.period == null) return;
			const quantum = CONFIG.export.timeline.renderClock.gifDelayQuantumMs;
			const cycle = clampNumber(roundTo(patch.period, quantum), target.periodRange.min, target.periodRange.max);
			if (cycle === roundTo(target.fileCycleDuration, quantum)) delete target.record.gifCycleMs;
			else target.record.gifCycleMs = cycle;
		}
	}
};

function listTimingTargets(editor, layers = editor.layers) {
	const targets = layers.flatMap(layer => Object.entries(ANIMATION_TIMING_KINDS).flatMap(([kind, spec]) => spec.collect(editor, layer).map(target => ({
		...target, kind, layerId: layer.id, rowLabel: target.label,
		can: Object.fromEntries(Object.entries(target.can).map(([name, enabled]) => [name, enabled && (!isLayerFullyLocked(layer) || layer.type === LayerType.BASE_IMAGE)]))
	}))));
	const cached = TIMING_TARGET_OWNERS.get(editor);
	const owners = layers === editor.layers || !cached || cached.epoch !== editor.animationRevisionEpoch ? new Map() : cached.owners;
	for (const target of targets) owners.set(target.key, { layerId: target.layerId, kind: target.kind });
	TIMING_TARGET_OWNERS.set(editor, { epoch: editor.animationRevisionEpoch, owners });
	return targets;
}

function findTimingTarget(editor, key) {
	const cached = TIMING_TARGET_OWNERS.get(editor);
	const owner = cached && cached.epoch === editor.animationRevisionEpoch && cached.owners.get(key);
	if (!owner) return listTimingTargets(editor).find(target => target.key === key);
	const layer = editor.layerManager.getLayerById(owner.layerId);
	const target = layer && ANIMATION_TIMING_KINDS[owner.kind].collect(editor, layer).find(target => target.key === key);
	if (!target) { cached.owners.delete(key); return null; }
	return { ...target, kind: owner.kind, layerId: layer.id, rowLabel: target.label,
		can: Object.fromEntries(Object.entries(target.can).map(([name, enabled]) => [name, enabled && (!isLayerFullyLocked(layer) || layer.type === LayerType.BASE_IMAGE)])) };
}

function isTimingPatchAllowed(target, patch) {
	if (!target || !patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
	const names = { period: 'period', run: 'run', appear: 'appear', delayMs: 'run', iterations: 'run', phase: 'phase', direction: 'direction' };
	if (Object.keys(patch).some(name => !target.can[names[name]])) return false;
	if (['period', 'delayMs', 'phase'].some(name => Object.hasOwn(patch, name) && !Number.isFinite(patch[name]))) return false;
	if (Object.hasOwn(patch, 'iterations') && patch.iterations !== Infinity && !Number.isFinite(patch.iterations)) return false;
	if (Object.hasOwn(patch, 'run') && (!patch.run || !Number.isFinite(patch.run.start) || (patch.run.end !== Infinity && !Number.isFinite(patch.run.end)) || patch.run.end < patch.run.start)) return false;
	if (Object.hasOwn(patch, 'appear') && (Object.hasOwn(patch, 'run') || patch.appear !== null && (!patch.appear || !Number.isFinite(patch.appear.start) || patch.appear.end !== null && (!Number.isFinite(patch.appear.end) || patch.appear.end < patch.appear.start)))) return false;
	return !Object.hasOwn(patch, 'direction') || ANIMATION_DIRECTION_OPTIONS.some(option => option.value === patch.direction);
}

function timingTargetValues(target) {
	return { period: target.period, run: target.run, appear: target.appear, phase: target.phase, direction: target.direction };
}

// Explicit batch actions copy authored layer data through the existing serializer,
// which excludes decoded artwork and mask/history buffers. Gestures use timing-only copies below.
function planTimingBatch(editor, updates) {
	const reject = reason => ({ changes: [], reason });
	if (!Array.isArray(updates) || !updates.length || updates.some(update => !update || typeof update.key !== 'string') || new Set(updates.map(update => update.key)).size !== updates.length) return reject('Select distinct timing sources to edit.');
	const copies = new Map(), changes = [];
	const near = (a, b) => a === b || Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6;
	for (const update of updates) {
		const { key, patch, restoreOriginal = false } = update, target = findTimingTarget(editor, key);
		if (!isTimingPatchAllowed(target, patch) || !Object.values(target.can).some(Boolean)) return reject('Every selected timing source must exist, be editable and support the requested values.');
		const layer = editor.layerManager.getLayerById(target.layerId), spec = ANIMATION_TIMING_KINDS[target.kind];
		if (restoreOriginal && (layer.loopOriginalPeriods?.[key] == null || !Object.hasOwn(patch, 'period') || !near(patch.period, layer.loopOriginalPeriods[key]))) return reject('The saved cycle is no longer available.');
		if (!copies.has(layer.id)) copies.set(layer.id, editor.layerManager.serializeLayer(layer, { includeMaskVersion: false }));
		const copy = copies.get(layer.id), copiedTarget = spec.collect(editor, copy).find(entry => entry.key === key);
		if (copy === layer || !copiedTarget || copiedTarget.record && copiedTarget.record === target.record || copiedTarget.animation && copiedTarget.animation === target.animation) return reject('This timing source cannot be edited as a batch.');
		spec.write(editor, copy, copiedTarget, patch);
		const next = spec.collect(editor, copy).find(entry => entry.key === key);
		if (!next) return reject('A selected timing source is unavailable.');
		if (Object.hasOwn(patch, 'period') && !near(next.period, target.resolvePeriod ? target.resolvePeriod(patch.period) : patch.period)
			|| Object.hasOwn(patch, 'phase') && !near(next.phase, ((patch.phase % 1) + 1) % 1)
			|| Object.hasOwn(patch, 'delayMs') && !near(next.run.start, patch.delayMs)
			|| Object.hasOwn(patch, 'iterations') && !near(next.animation?.iterations, patch.iterations)
			|| Object.hasOwn(patch, 'direction') && next.direction !== patch.direction
			|| patch.run && (!near(next.run.start, patch.run.start) || !near(next.run.end, patch.run.end))
			|| Object.hasOwn(patch, 'appear') && (patch.appear === null ? next.appear !== null : !near(next.run.start, patch.appear.start) || !near(next.run.end, patch.appear.end ?? Infinity))) return reject('The requested timing exceeds a selected source’s limits. No timing was changed.');
		changes.push({ key, layerId: layer.id, patch, restoreOriginal, next: timingTargetValues(next), changed: restoreOriginal || !isSameData(timingTargetValues(target), timingTargetValues(next)), activityChanged: Boolean(next.active) !== Boolean(target.active) });
	}
	return { changes, reason: '' };
}

function timingPastePatch(target, timing) {
	if (!target || !timing) return { patch: {}, reason: 'Copy timing from a bar first.', summary: '' };
	const patch = {}, applied = [], omitted = [];
	const add = (name, label, value) => {
		if (target.can[name]) { patch[name] = value; applied.push(label); } else omitted.push(label);
	};
	if (Number.isFinite(timing.cycle) && timing.cycle > 0) add('period', FIELDS.animDuration.label, timing.cycle);
	if (target.can.appear && timing.kind === 'appear' && timing.appear === null) { patch.appear = null; applied.push('Always visible'); }
	else if (timing.run) add('run', 'Starts/ends', { ...timing.run });
	if (timing.phase != null) add('phase', FIELDS.animPhase.label, timing.phase);
	if (timing.direction) add('direction', 'Direction', timing.direction);
	return { patch, reason: applied.length ? '' : 'The destination has no editable timing values in common with the copy.',
		summary: `${applied.length ? `Paste ${applied.join(', ')}` : 'No compatible values'}${omitted.length ? `. Not supported here: ${omitted.join(', ')}` : ''}.` };
}

// Preflight uses the kind's writer on timing-only copies. No pixel/history buffers are copied.
function planTimingMoves(editor, keys, operation, value = 0) {
	const reject = reason => ({ changes: [], reason });
	if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length) return reject('Select timing bars to coordinate.');
	if (!['move', 'align-start', 'align-end', 'stagger'].includes(operation) || !Number.isFinite(value) || operation === 'stagger' && value < 0) return reject('Enter a valid time interval.');
	const targets = keys.map(key => findTimingTarget(editor, key));
	if (targets.some(target => !target)) return reject('A selected timing source no longer exists.');
	if (targets.some(target => !target.can.run || !ANIMATION_TIMING_KINDS[target.kind].movePatch)) return reject('Every selected bar must support movement and belong to an unlocked layer.');
	if (operation === 'align-end' && targets.some(target => !Number.isFinite(target.run.end) || target.run.end <= target.run.start)) return reject('Align ends needs a finite, nonempty run for every selected bar.');
	const start = Math.min(...targets.map(target => target.run.start));
	const end = Math.max(...targets.map(target => target.run.end));
	const changes = [];
	for (const [index, target] of targets.entries()) {
		const delta = operation === 'move' ? value : operation === 'align-start' ? start - target.run.start
			: operation === 'align-end' ? end - target.run.end : start + index * value - target.run.start;
		const run = { start: target.run.start + delta, end: target.run.end + delta };
		if (!Number.isFinite(run.start) || run.end !== Infinity && (!Number.isFinite(run.end) || run.end < run.start)) return reject('A selected bar has no valid played interval.');
		const spec = ANIMATION_TIMING_KINDS[target.kind], patch = spec.movePatch(target, delta);
		if (!isTimingPatchAllowed(target, patch)) return reject('The requested movement is unavailable for a selected bar.');
		const layer = editor.layerManager.getLayerById(target.layerId);
		const copy = { ...layer, animations: layer.animations?.map(animation => ({ ...animation })) };
		spec.write(editor, copy, target, patch);
		const next = spec.collect(editor, copy).find(entry => entry.key === target.key);
		if (!next || Math.abs(next.run.start - run.start) > 1e-6 || next.run.end !== run.end && Math.abs(next.run.end - run.end) > 1e-6) return reject('That movement exceeds the timing limits. No selected bar was changed.');
		changes.push({ key: target.key, layerId: target.layerId, patch, run, delta, activityChanged: Boolean(next.active) !== Boolean(target.active) });
	}
	return { changes, reason: '' };
}

function publishTimingWrites(editor, layers, { timingOnly = false } = {}) {
	layers = [...layers];
	for (const layer of layers) getLayerManagerForType(editor, layer.type)?.renderLayer?.(layer);
	editor.previewFrameView?.invalidate({ keepFrame: Boolean(editor.keyRecording?.active) });
	editor.requestPreviewUpdate();
	window.dispatchEvent(new CustomEvent('animationChanged', { detail: { layerId: layers[0].id, layerIds: layers.map(layer => layer.id), timingOnly } }));
}

function captureTimingMoves(editor, keys) {
	return { epoch: editor.animationRevisionEpoch, entries: keys.map(key => {
		const target = findTimingTarget(editor, key);
		return { target, layer: editor.layerManager.getLayerById(target.layerId), animation: target.animation, patch: ANIMATION_TIMING_KINDS[target.kind].moveSnapshot(target) };
	}) };
}
