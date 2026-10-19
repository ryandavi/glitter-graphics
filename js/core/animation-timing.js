'use strict';

const TIMING_TARGET_OWNERS = new WeakMap();

const ANIMATION_TIMING_KINDS = {
	appear: {
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
