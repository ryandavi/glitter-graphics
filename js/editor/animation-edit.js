'use strict';

const EDITOR_ANIMATION_EDIT_METHODS = {
	getAnimations(layer) {
		return Array.isArray(layer?.animations) ? layer.animations : [];
	},
	selectedMotionIndex(layer) {
		const animations = this.getAnimations(layer);
		return Math.max(0, animations.findIndex(animation => animation.id === this.motionSelection.get(layer?.id).motionId));
	},
	selectedMotion(layer) {
		return this.getAnimations(layer)[this.selectedMotionIndex(layer)] || null;
	},
	canEditKeys(layer, animation) {
		return isFeatureAvailable('customMotion') && this.layers.includes(layer)
			&& layer.animations?.includes(animation) && GlitterAnimation.MOTION_REGISTRY[animation?.type]?.keyed
			&& this.canEditLayer(layer);
	},
	keyIndex(animation) {
		const keys = GlitterAnimation.normalizeKeys(animation?.keys);
		const layer = this.layers.find(layer => layer.animations?.includes(animation));
		const at = this.motionSelection.get(layer?.id).keyAt;
		const index = keys.findIndex((key) => key.at === at);
		return index < 0 ? (keys.length ? 0 : -1) : index;
	},
	keyPeriod(layer, animation) {
		return animation.periodMs;
	},
	keyProgress(layer, animation) {
		return GlitterAnimation.cycleProgress({ ...animation, periodMs: this.keyPeriod(layer, animation) }, this.animationTicker.getPlayheadTime(), { fill: false });
	},
	conversion(animation) {
		const revision = this.documentRevision, cached = (this.convertedAnimations ||= new WeakMap()).get(animation);
		if (cached && cached.revision === revision) return cached.result;
		const result = GlitterAnimation.convertToKeys(animation);
		(this.convertedAnimations ||= new WeakMap()).set(animation, { revision, result });
		return result;
	},
	selectKey(layer, animation, at, options = {}) { this.motionSelection.select(layer.id, animation.id, { keyAt: at, ...options }); },
	selectMotion(layer, index) { if (layer) this.motionSelection.select(layer.id, typeof index === 'string' ? index : layer.animations?.[index]?.id); },
	setKeySelection(animation, at) { const layer = this.layers.find(layer => layer.animations?.includes(animation)); if (layer) this.motionSelection.select(layer.id, animation.id, { keyAt: at }); },
	touchMotion(layer, animation) {
		if (!animation) return;
		const key = GlitterAnimation.sourceKey(layer.id, animation);
		this.animationRevisions ||= new Map();
		this.animationRevisions.set(key, (this.animationRevisions.get(key) || 0) + 1);
	},
	animationTimingActions(key, { live = false } = {}) {
		const model = TimelineView.buildModel(this.loopEstimate, this.layers, this);
		const row = model.groups.flatMap(group => group.rows).find(row => row.key === key);
		if (!row?.source) return [];
		const actions = TimelineView.barActions(row, model, {
			playhead: this.animationTicker.getPlayheadTime(), clipboard: this.timingClipboard,
			write: (key, patch) => this.writeTiming(key, patch, { live: true }),
			copy: () => this.copyTiming(key)
		});
		return actions.map(action => ({ ...action, disabled: action.disabled || (action.id === 'fit' && !this.isLoopEstimateCurrent()), run: () => {
			const revision = this.documentRevision, restored = action.id === 'reset' && this.restoreAnimationPeriod({ key });
			action.run();
			const changed = restored || revision !== this.documentRevision;
			if (!live && action.commits !== false && changed) this.commitAnimationTiming(action.label);
			return changed;
		} }));
	},
	copyTiming(key) {
		const target = findTimingTarget(this, key);
		if (target) this.timingClipboard = { cycle: target.period, phase: target.phase, direction: target.direction, run: target.run && { ...target.run } };
	},
	pasteTiming(key) {
		const target = findTimingTarget(this, key), timing = this.timingClipboard;
		if (!target || !timing) return false;
		const patch = {};
		if (target.can.period) patch.period = timing.cycle;
		if (target.can.run && timing.run) patch.run = { ...timing.run };
		if (target.can.phase && timing.phase != null) patch.phase = timing.phase;
		if (target.can.direction && timing.direction) patch.direction = timing.direction;
		return this.writeTiming(key, patch, { label: 'Paste timing' });
	},
	playOnce(key) { return this.runTimingAction(key, 'once'); },
	repeatForever(key) { return this.runTimingAction(key, 'forever'); },
	startAt(key, ms) { const target = findTimingTarget(this, key); return target && this.writeTiming(key, { run: { ...target.run, start: ms } }, { label: 'Change Starts at' }); },
	endAt(key, ms) { const target = findTimingTarget(this, key); return target && this.writeTiming(key, { run: { ...target.run, end: ms } }, { label: 'Change Lasts' }); },
	stretchDuration(key, durationMs) {
		const target = findTimingTarget(this, key);
		if (!target?.can.period || !target.can.run || !Number.isFinite(durationMs) || durationMs <= 0) return false;
		const row = { cycleMs: target.period, startMs: target.run.start, phase: target.phase, source: { run: target.run, periodRange: target.periodRange, resolvePeriod: target.resolvePeriod } };
		const count = TimelineView.durationRepeats(row, this.resolveAnimationLoop().duration, FIELDS.animIterations.max);
		const value = TimelineView.durationFromEdge(row, count, row.startMs + durationMs);
		return value && this.writeTiming(key, { period: value.period, run: value.run }, { label: 'Stretch duration' });
	},
	fillLoop(key) { return this.runTimingAction(key, 'fill'); },
	resetTiming(key) { return this.runTimingAction(key, 'reset'); },
	fitToLoop(key) { return this.runTimingAction(key, 'fit'); },
	resetCycle(key) { return this.runTimingAction(key, 'reset-speed'); },
	runTimingAction(key, id) {
		const action = this.animationTimingActions(key, { live: true }).find(action => action.id === id);
		if (!action || action.disabled) return false;
		if (!action.run()) return false;
		this.commitAnimationTiming(action.label); return true;
	},
	setAnimationsEnabled(layer, enabled) {
		if (!this.canEditLayer(layer)) return;
		layer.animationsEnabled = Boolean(enabled);
		if (enabled && !layer.animations?.length) layer.animations = [this.createMotion(layer)];
		this.renderAnimationEdit(layer);
		this.saveState(enabled ? 'Show animations' : 'Hide animations');
	},
	setAnimationType(layer, motionId, type) {
		if (!this.canEditLayer(layer)) return;
		const index = layer.animations?.findIndex(animation => animation.id === motionId), animation = layer.animations?.[index];
		const feature = GlitterAnimation.MOTION_REGISTRY[type]?.feature;
		if (!animation || (feature && !isFeatureAvailable(feature))) return;
		const next = this.createMotion(layer, type);
		for (const key of ['id', 'enabled', 'periodMs', 'delayMs', 'iterations', 'phase', 'direction', 'fillMode', 'snapMode']) next[key] = animation[key];
		layer.animations[index] = GlitterAnimation.normalizeAnimation(next);
		this.touchMotion(layer, layer.animations[index]);
		this.renderAnimationEdit(layer); this.saveState('Change animation type');
	},
	setMotionField(layer, motionId, field, value, { live = false } = {}) {
		if (typeof layer === 'string') {
			const id = layer, options = value || {}; value = field; field = motionId; motionId = id; live = Boolean(options.live);
			layer = this.layers.find(layer => layer.animations?.some(entry => entry.id === id));
		}
		if (!layer) return false;
		const animation = layer.animations?.find(entry => entry.id === motionId);
		if (!animation || !this.canEditLayer(layer)) return false;
		const timing = { periodMs: 'period', delayMs: 'delayMs', phase: 'phase', direction: 'direction', iterations: 'iterations' };
		if (timing[field]) return this.writeTiming(GlitterAnimation.sourceKey(layer.id, animation), { [timing[field]]: value }, { live });
		animation[field] = value; this.touchMotion(layer, animation); this.renderAnimationLayer(layer);
		if (!live) this.saveState('Change animation');
		return true;
	},
	setAnimationVisible(layer, motionId, visible) {
		const animation = layer.animations?.find(entry => entry.id === motionId);
		if (!animation || !this.canEditLayer(layer)) return false;
		animation.enabled = Boolean(visible); this.renderAnimationEdit(layer); this.saveState(visible ? 'Show animation' : 'Hide animation'); return true;
	},

	renderAnimationLayer(layer) {
		this.previewFrameView?.invalidate({ keepFrame: Boolean(this.keyRecording?.active) });
		getLayerManagerForType(this, layer.type)?.renderLayer?.(layer);
		this.requestPreviewUpdate();
		this.documentRevision = (this.documentRevision || 0) + 1;
		window.dispatchEvent(new CustomEvent('animationChanged', { detail: { layerId: layer.id } }));
	},
	renderAnimationEdit(layer) {
		this.renderAnimationLayer(layer);
		this.animationPanel?.load(layer);
	},
	commitMotionEdit(label, options) { this.saveState(label, options); },
	createMotion(layer, type = CONFIG.tools.animation.defaultType) {
		const animation = GlitterAnimation.normalizeAnimation({ type, id: this.layerManager.generateLayerId() });
		if (layer.type === LayerType.STICKER && layer.stickerData?.isPixelated !== false) animation.snapMode = 'pixel-snap';
		return animation;
	},
	addAnimation(layer, type = CONFIG.tools.animation.defaultType) {
		if (!this.layers.includes(layer) || !this.canEditLayer(layer) || this.getAnimations(layer).length >= CONFIG.tools.animation.maxStackSize) return;
		const feature = GlitterAnimation.MOTION_REGISTRY[type]?.feature;
		if (feature && !isFeatureAvailable(feature)) return;
		layer.animations ||= []; layer.animations.push(this.createMotion(layer, type));
		this.selectMotion(layer, layer.animations.length - 1); this.renderAnimationEdit(layer);
		this.timelineDock?.expandLayer(layer.id);
		this.saveState('Add animation');
	},
	duplicateAnimation(layer, index = this.selectedMotionIndex(layer)) {
		if (typeof index === 'string') index = layer.animations?.findIndex(animation => animation.id === index);
		if (!this.canEditLayer(layer) || !this.getAnimations(layer)[index] || layer.animations.length >= CONFIG.tools.animation.maxStackSize) return;
		const original = layer.animations[index], duplicate = { ...structuredClone(original), id: this.layerManager.generateLayerId() };
		const before = layer.loopOriginalPeriods?.[GlitterAnimation.sourceKey(layer.id, original)];
		if (before != null) layer.loopOriginalPeriods[GlitterAnimation.sourceKey(layer.id, duplicate)] = before;
		layer.animations.splice(index + 1, 0, duplicate);
		this.selectMotion(layer, index + 1); this.renderAnimationEdit(layer); this.saveState('Duplicate animation');
	},
	deleteAnimation(layer, index = this.selectedMotionIndex(layer)) {
		if (typeof index === 'string') index = layer.animations?.findIndex(animation => animation.id === index);
		if (!this.canEditLayer(layer) || !this.getAnimations(layer)[index]) return;
		this.animationRevisions?.delete(GlitterAnimation.sourceKey(layer.id, layer.animations[index]));
		delete layer.loopOriginalPeriods?.[GlitterAnimation.sourceKey(layer.id, layer.animations[index])];

		layer.animations.splice(index, 1);
		this.selectMotion(layer, Math.max(0, Math.min(index, layer.animations.length - 1)));
		this.renderAnimationEdit(layer); this.saveState('Delete animation');
	},
	moveAnimation(layer, from, to) {
		const animations = this.getAnimations(layer);
		if (!this.layers.includes(layer) || !this.canEditLayer(layer) || !Number.isInteger(from) || !Number.isInteger(to)
			|| from === to || from < 0 || to < 0 || from >= animations.length || to >= animations.length) return false;
		const [entry] = animations.splice(from, 1);
		animations.splice(to, 0, entry);
		this.selectMotion(layer, to);
		this.renderAnimationEdit(layer);
		this.saveState('Reorder animations');
		return true;
	},
	toggleAnimation(layer, index) {
		if (typeof index === 'string') index = layer.animations?.findIndex(animation => animation.id === index);
		const animation = this.getAnimations(layer)[index];
		if (!animation || !this.layers.includes(layer) || !this.canEditLayer(layer)) return false;
		animation.enabled = animation.enabled === false;
		this.renderAnimationEdit(layer);
		this.saveState(animation.enabled ? 'Show animation' : 'Hide animation');
		return true;
	},
	setKeys(layer, animation, keys, { commit = true, rollback = false, label = 'Edit motion key', at, coalesceKey } = {}) {
		if (!this.canEditKeys(layer, animation) && !(rollback && this.layers.includes(layer) && layer.animations?.includes(animation))) return false;
		const next = GlitterAnimation.normalizeKeys(keys);
		if (isSameData(next, GlitterAnimation.normalizeKeys(animation.keys))) return false;
		if (!rollback) {
			const before = GlitterAnimation.normalizeKeys(animation.keys);
			for (const id of Object.keys(GlitterAnimation.POSE_CHANNELS)) {
				if (before.some(key => Object.hasOwn(key.values, id))) continue;
				if (!next.some(key => Object.hasOwn(key.values, id))) continue;
				for (const key of next) if (!Object.hasOwn(key.values, id)) key.values[id] = GlitterAnimation.keyRestSample(animation, key.at)[id];
			}
		}
		animation.keys = next;
		this.touchMotion(layer, animation);
		if (at != null) this.setKeySelection(animation, at);
		if (!rollback) {
			this.selectMotion(layer, layer.animations.indexOf(animation));
		}
		this.renderAnimationLayer(layer);
		this.requestPreviewUpdate();
		this.animationPanel?.load(layer);
		this.previewFrameView?.invalidate({ keepFrame: Boolean(this.keyRecording?.active) });
		if (commit) this.saveState(label, { coalesceKey });
		return true;
	},
	beginKeyRetime(layer, entry, at) {
		const keys = GlitterAnimation.normalizeKeys(entry.keys);
		let finished = false;
		return {
			move: requested => finished || !this.canEditKeys(layer, entry) ? null : this.retimeKey(layer, entry, this.keyIndex(entry), requested, { commit: false }),
			finish: cancelled => {
				if (finished) return;
				finished = true;
				if (cancelled) this.setKeys(layer, entry, keys, { commit: false, rollback: true, at });
				else if (!isSameData(keys, GlitterAnimation.normalizeKeys(entry.keys))) this.saveState('Retime motion key');
			}
		};
	},
	retimeKey(layer, animation, index, requested, options = {}) {
		const keys = GlitterAnimation.normalizeKeys(animation.keys);
		if (!keys[index] || !Number.isFinite(requested)) return null;
		const tolerance = CONFIG.ui.timeline.keyPositionTolerance;
		const at = clampNumber(requested, 0, 1);
		const others = keys.filter((_key, candidate) => candidate !== index);
		const distance = (a, b) => Math.abs(a - b);
		const candidates = [at, ...others.flatMap((key) => [Math.max(0, key.at - tolerance), Math.min(1, key.at + tolerance)])];
		const position = candidates.filter((candidate) => others.every((key) => distance(candidate, key.at) >= tolerance - 1e-9))
			.sort((a, b) => distance(a, at) - distance(b, at))[0];
		if (position == null) return null;
		keys[index].at = position;
		this.setKeys(layer, animation, keys, { ...options, at: position, label: 'Retime motion key' });
		return position;
	},
	addKey(layer, animation) {
		if (!this.canEditKeys(layer, animation)) return;
		const keys = GlitterAnimation.normalizeKeys(animation.keys);
		const held = this.animationTicker.paused;
		const progress = held ? this.keyProgress(layer, animation) : null;
		if (held && !progress) return;
		const index = this.keyIndex(animation), selectedAt = keys[index]?.at || 0;
		const at = progress ? progress.eased : selectedAt === 1 ? ((keys[index - 1]?.at || 0) + 1) / 2 : (selectedAt + (keys[index + 1]?.at ?? 1)) / 2;
		const existing = keys.find((key) => Math.abs(key.at - at) < CONFIG.ui.timeline.keyPositionTolerance);
		if (existing) { this.motionSelection.select(layer.id, animation.id, { keyAt: existing.at }); return; }
		if (keys.length >= CONFIG.tools.animation.maxKeys) { this.updateStatus(`Maximum of ${CONFIG.tools.animation.maxKeys} motion keys`); return; }
		const selected = keys[this.keyIndex(animation)];
		const channels = selected && Object.keys(selected.values).length ? Object.keys(selected.values) : CONFIG.tools.animation.defaultKeyChannels;
		const sample = GlitterAnimation.keyRestSample(animation, at);
		keys.push({ at, easing: 'linear', values: Object.fromEntries(channels.map((id) => [id, sample[id]])) });
		this.setKeys(layer, animation, keys, { label: 'Add motion key', at });
	},
	editKeyEasing(layer, animation, at, easing) {
		this.setKeySelection(animation, at);
		this.editMotionKey(layer, animation, key => { key.easing = easing; });
	},
	duplicateKey(layer, animation, at) {
		if (!this.canEditKeys(layer, animation)) return;
		const keys = GlitterAnimation.normalizeKeys(animation.keys), original = keys.find(key => key.at === at);
		if (!original || keys.length >= CONFIG.tools.animation.maxKeys) return;
		const tolerance = CONFIG.ui.timeline.keyPositionTolerance;
		let next = at + tolerance;
		for (const key of keys) if (key.at >= at && Math.abs(key.at - next) < tolerance - 1e-9) next = key.at + tolerance;
		if (next > 1) return;
		keys.push({ ...original, at: next, values: { ...original.values } });
		this.setKeys(layer, animation, keys, { at: next, label: 'Duplicate motion key' });
	},
	deleteKey(layer, animation, index = this.keyIndex(animation)) {
		const keys = GlitterAnimation.normalizeKeys(animation.keys);
		if (!keys[index]) return;
		keys.splice(index, 1);
		this.setKeys(layer, animation, keys, { label: 'Delete motion key', at: keys[Math.min(index, keys.length - 1)]?.at });
	},
	convertToCustom(layer, animation) {
		const index = this.getAnimations(layer).indexOf(animation);
		if (index < 0 || !isFeatureAvailable('customMotion') || !this.layers.includes(layer) || !this.canEditLayer(layer)) return;
		const result = this.conversion(animation);
		if (!result) return;
		layer.animations[index] = result.animation;
		this.touchMotion(layer, result.animation);
		this.selectMotion(layer, index);
		this.renderAnimationEdit(layer);
		this.saveState('Convert to custom motion');
		const channel = GlitterAnimation.POSE_CHANNELS[result.error?.channel];
		this.updateStatus(channel
			? `Converted to an approximate custom motion: ${channel.label} is within ${Number((result.error.value * channel.displayScale).toPrecision(2))}${channel.unit || '%'}`
			: 'Converted to a custom motion');
	},
	editMotionKey(layer, animation, change, options) {
		if (!this.canEditKeys(layer, animation)) return false;
		const keys = GlitterAnimation.normalizeKeys(animation.keys), key = keys[this.keyIndex(animation)];
		if (!key) return false;
		change(key, keys);
		return this.setKeys(layer, animation, keys, options);
	},
	holdMotionProperty(animation, key, property) {
		const rest = GlitterAnimation.keyRestSample(animation, key.at);
		for (const id of property.channels) if (!Object.hasOwn(key.values, id)) key.values[id] = rest[id];
	},
};
