'use strict';

class AnimationPanelController {
	constructor(editor) {
		this.editor = editor;
		this.prefixByType = new Map(Object.entries(LAYER_UI_CONFIG)
			.filter(([, config]) => config.animatable && config.transformPrefix)
			.map(([type, config]) => [type, config.transformPrefix]));

		this.selectedByLayer = new Map();
		this.selectedKeys = new WeakMap();
		this.converted = new WeakMap();
		this.keyStrips = new Map();
		this.previewFrames = new Map();
		// Least recently asked for first.
		this.retimedPreviews = new Map();
		this.retimedUrls = new Set();
		this.shownPreviews = new WeakMap();
		APP_MEMORY_LEDGER.register({
			id: 'retimed-gifs', label: 'Retimed preview GIFs', category: 'Preview caches',
			measure: () => Array.from(this.retimedPreviews.values()).reduce((sum, entry) => sum + entry.bytes, 0)
		});
		this.prefixByType.forEach((_prefix, type) => this._bind(type));
		this.pauseButton = document.getElementById('pauseMotionTool');
		this.pauseButton?.addEventListener('click', () => this.setPaused(!this.editor.animationTicker.paused));
	}

	// With the timeline open a pause holds the playhead; otherwise it shows
	// the rest pose.
	setPaused(paused) {
		if (!paused) this.editor.timelineKeyRecording?.end();
		const dock = this.editor.timelineDock?.available ? this.editor.timelineDock : null;
		this.editor.animationTicker.setPaused(paused, { hold: Boolean(dock) });
		dock?.syncPlayback();
		if (this.pauseButton) {
			this.pauseButton.classList.toggle('active', paused);
			this.pauseButton.setAttribute('aria-pressed', String(paused));
			this.pauseButton.title = paused ? 'Resume motion' : 'Pause motion';
			this.pauseButton.querySelector('.name').textContent = paused ? 'Resume motion' : 'Pause motion';
		}
		if (!paused) this.previewFrames.clear();
		this.editor.requestPreviewUpdate();
	}

	// The URL a preview element shows for an animated source: a still while
	// motion is paused, a retimed copy when this use of the GIF stores a cycle
	// length, otherwise the file. `use` is `{ element, timingRecord,
	// sourceIdentity }` as the export's authored descriptor names them.
	getPreviewImageUrl(url, use = null) {
		if (!url) return url;
		if (!this.editor.animationTicker.paused) {
			if (use?.timingRecord?.gifCycleMs) return this.getRetimedPreviewUrl(url, use);
			if (use?.element) this.shownPreviews.delete(use.element);
			return url;
		}
		let entry = this.previewFrames.get(url);
		if (!entry) {
			entry = { url: null };
			this.previewFrames.set(url, entry);
			this.loadPreviewFrame(url).then(frameUrl => {
				entry.url = frameUrl;
				if (this.previewFrames.get(url) === entry && this.editor.animationTicker.paused) this.editor.requestPreviewUpdate();
			}).catch(error => {
				entry.url = url;
				console.warn('Could not pause preview image:', error);
			});
		}
		return entry.url || url;
	}

	// A copy of the file with the export's own delays for this use written
	// into it. Until that copy has decoded, the element keeps the URL it
	// already shows; the copy then replaces it in one swap.
	getRetimedPreviewUrl(url, use) {
		const gifCycleMs = use.timingRecord.gifCycleMs;
		const key = `${gifCycleMs}|${url}`;
		let entry = this.retimedPreviews.get(key);
		if (entry) this.retimedPreviews.delete(key);
		else {
			entry = { url: null, bytes: 0, settled: false };
			// The record may change again before the file has loaded.
			entry.ready = this.buildRetimedPreview(url, { sourceIdentity: use.sourceIdentity, timingRecord: { gifCycleMs } }).then((built) => {
				Object.assign(entry, built, { settled: true });
				if (this.retimedPreviews.get(key) !== entry) this.releaseRetimedPreview(entry);
				else this.editor.requestPreviewUpdate();
			});
		}
		this.retimedPreviews.set(key, entry);
		while (this.retimedPreviews.size > CONFIG.memory.retimedGifEntries) {
			const [oldest, evicted] = this.retimedPreviews.entries().next().value;
			this.retimedPreviews.delete(oldest);
			this.releaseRetimedPreview(evicted);
		}
		const shown = this.shownPreviews.get(use.element);
		const kept = !entry.settled && shown?.source === url && (shown.url === url || this.retimedUrls.has(shown.url));
		const next = kept ? shown.url : entry.url || url;
		if (use.element) this.shownPreviews.set(use.element, { source: url, url: next });
		return next;
	}

	async buildRetimedPreview(url, use) {
		let objectUrl = null;
		try {
			const bytes = await fetchGifBytes(url);
			const timing = this.editor.sceneCompositor.getAuthoredPassTiming(use, readGifTiming(bytes), CONFIG.export.defaults.frameDelay);
			if (timing.delays === timing.file) return {};
			const retimed = retimeGifBytes(bytes, timing.delays);
			objectUrl = URL.createObjectURL(new Blob([retimed], { type: 'image/gif' }));
			await loadImageElement(objectUrl);
			this.retimedUrls.add(objectUrl);
			return { url: objectUrl, bytes: retimed.byteLength };
		} catch (error) {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			console.warn('Could not retime preview image:', error);
			return {};
		}
	}

	releaseRetimedPreview(entry) {
		if (!entry.url) return;
		this.retimedUrls.delete(entry.url);
		URL.revokeObjectURL(entry.url);
		entry.url = null;
	}

	// Resolves once every retimed copy asked for so far has decoded.
	retimedPreviewsSettled() {
		return Promise.all(Array.from(this.retimedPreviews.values(), (entry) => entry.ready));
	}

	async loadPreviewFrame(url) {
		const bytes = await fetchGifBytes(url);
		const canvas = createAppCanvas(0, 0, 'systems/AnimationPanelController');
		if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) {
			const reader = openGifReader(bytes);
			canvas.width = reader.width;
			canvas.height = reader.height;
			const pixels = new Uint8ClampedArray(reader.width * reader.height * 4);
			reader.decodeAndBlitFrameRGBA(0, pixels);
			canvas.getContext('2d').putImageData(new ImageData(pixels, reader.width, reader.height), 0, 0);
		} else {
			const image = await loadImageElement(url);
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			canvas.getContext('2d').drawImage(image, 0, 0);
		}
		return canvas.toDataURL('image/png');
	}

	_id(prefix, suffix) {
		return document.getElementById(`${prefix}Anim${suffix}`);
	}

	_active(type) {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === type ? layer : null;
	}

	_animations(layer) {
		return Array.isArray(layer?.animations) ? layer.animations : [];
	}

	_selectedIndex(layer) {
		const animations = this._animations(layer);
		const requested = this.selectedByLayer.get(layer?.id) || 0;
		return Math.max(0, Math.min(animations.length - 1, requested));
	}

	_selected(layer) {
		return this._animations(layer)[this._selectedIndex(layer)] || null;
	}

	selectedMotion(layer) { return this._selected(layer); }
	selectedMotionIndex(layer) { return this._selectedIndex(layer); }
	selectMotion(layer, index) { this.selectedByLayer.set(layer.id, index); }
	setKeySelection(animation, at) { this.selectedKeys.set(animation, at); }
	keyAddControl(layer) {
		const prefix = this.prefixByType.get(layer?.type);
		return prefix ? this._id(prefix, 'KeyAdd') : null;
	}
	syncKeyAdd(layer = this.editor.layerManager.getActiveLayer(), animation = this.selectedMotion(layer)) {
		if (!layer || !GlitterAnimation.MOTION_REGISTRY[animation?.type]?.keyed) { this.keyAddContext = null; return true; }
		const dock = this.editor.timelineDock;
		const progress = this.keyProgress(layer, animation);
		const disabled = !this.canEditKeys(layer, animation) || (dock?.available && (dock.stale || !progress));
		const add = this.keyAddControl(layer);
		if (add) {
			add.disabled = disabled;
			add.title = disabled ? 'Move the playhead inside this animation' : dock?.available ? 'Add a key at the playhead' : 'Add a key halfway to the next key';
		}
		const run = GlitterAnimation.runTiming({ ...animation, periodMs: this.keyPeriod(layer, animation) });
		this.keyAddContext = { layer, animation, run, disabled, inside: Boolean(progress) };
		return disabled;
	}
	paintKeyAdd(time) {
		const context = this.keyAddContext;
		if (!context || context.layer !== this.editor.layerManager.getActiveLayer()) return;
		const inside = time >= context.run.start && time < context.run.end;
		if (inside !== context.inside) this.syncKeyAdd(context.layer, context.animation);
	}
	ownsKeyControl(layer, control) {
		const prefix = this.prefixByType.get(layer?.type);
		return Boolean(prefix && control.id?.startsWith(`${prefix}AnimKey`));
	}
	transformControls(layer) {
		const prefix = this.prefixByType.get(layer?.type);
		if (!prefix) return [];
		return [
			document.querySelector(`[data-transform-prefix="${prefix}"]`),
			document.getElementById(`${prefix}LayerOpacity`)?.closest('.property-row')
		];
	}

	canEditKeys(layer, animation) {
		return isFeatureAvailable('timeline') && this.editor.layers.includes(layer)
			&& layer.animations?.includes(animation) && GlitterAnimation.MOTION_REGISTRY[animation?.type]?.keyed
			&& this.editor.canEditLayer(layer);
	}

	keyIndex(animation) {
		const keys = GlitterAnimation.normalizeKeys(animation?.keys);
		const at = this.selectedKeys.get(animation);
		const index = keys.findIndex((key) => key.at === at);
		return index < 0 ? (keys.length ? 0 : -1) : index;
	}

	selectKey(layer, animation, at, { seek = false } = {}) {
		this.selectedKeys.set(animation, at);
		this.selectedByLayer.set(layer.id, layer.animations.indexOf(animation));
		this.editor.timelineDock?.selectMotion(layer.id, this._selectedIndex(layer));
		if (seek && this.editor.timelineDock?.available && !this.editor.timelineDock.stale) {
			const ticker = this.editor.animationTicker;
			const time = GlitterAnimation.timeAtProgress({ ...animation, periodMs: this.keyPeriod(layer, animation) }, at, ticker.getPlayheadTime());
			if (time != null) { this.setPaused(true); ticker.seek(time); }
		}
		this.load(layer);
		this.editor.timelineDock?.syncKeys();
	}

	keyPeriod(layer, animation) {
		const index = layer.animations?.indexOf(animation);
		return this.editor.loopEstimate?.sourceAnalysis.find(entry => entry.key === `__anim_${layer.id}_${index}`)?.resolvedPeriod || animation.periodMs;
	}

	keyProgress(layer, animation) {
		return GlitterAnimation.cycleProgress({ ...animation, periodMs: this.keyPeriod(layer, animation) }, this.editor.animationTicker.getPlayheadTime(), { fill: false });
	}

	setKeys(layer, animation, keys, { commit = true, rollback = false, label = 'Edit motion key', at, coalesceKey } = {}) {
		if (!this.canEditKeys(layer, animation) && !(rollback && this.editor.layers.includes(layer) && layer.animations?.includes(animation))) return false;
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
		if (at != null) this.selectedKeys.set(animation, at);
		if (!rollback) {
			this.selectedByLayer.set(layer.id, layer.animations.indexOf(animation));
			this.editor.timelineDock?.selectMotion(layer.id, this._selectedIndex(layer));
		}
		this._renderLayer(layer);
		this.editor.requestPreviewUpdate();
		this.load(layer);
		this.editor.timelineDock?.frameView.invalidate({ keepFrame: Boolean(this.editor.timelineKeyRecording?.active) });
		this.editor.timelineDock?.syncKeys();
		if (commit) this.editor.saveState(label, { coalesceKey });
		return true;
	}

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
	}

	addKey(layer, animation) {
		if (!this.canEditKeys(layer, animation)) return;
		const keys = GlitterAnimation.normalizeKeys(animation.keys);
		const dock = this.editor.timelineDock;
		const progress = dock?.available && !dock.stale ? this.keyProgress(layer, animation) : null;
		if (dock?.available && !progress) return;
		const index = this.keyIndex(animation), selectedAt = keys[index]?.at || 0;
		const at = progress ? progress.eased : selectedAt === 1 ? ((keys[index - 1]?.at || 0) + 1) / 2 : (selectedAt + (keys[index + 1]?.at ?? 1)) / 2;
		const existing = keys.find((key) => Math.abs(key.at - at) < CONFIG.ui.timeline.keyPositionTolerance);
		if (existing) { this.selectKey(layer, animation, existing.at); return; }
		if (keys.length >= CONFIG.tools.animation.maxKeys) { this.editor.updateStatus(`Maximum of ${CONFIG.tools.animation.maxKeys} motion keys`); return; }
		const selected = keys[this.keyIndex(animation)];
		const channels = selected && Object.keys(selected.values).length ? Object.keys(selected.values) : CONFIG.tools.animation.defaultKeyChannels;
		const sample = GlitterAnimation.keyRestSample(animation, at);
		keys.push({ at, easing: 'linear', values: Object.fromEntries(channels.map((id) => [id, sample[id]])) });
		this.setKeys(layer, animation, keys, { label: 'Add motion key', at });
	}

	editKeyEasing(layer, animation, at, easing) {
		this.selectedKeys.set(animation, at);
		this._editKey(layer, animation, key => { key.easing = easing; });
	}

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
	}

	deleteKey(layer, animation, index = this.keyIndex(animation)) {
		const keys = GlitterAnimation.normalizeKeys(animation.keys);
		if (!keys[index]) return;
		keys.splice(index, 1);
		this.setKeys(layer, animation, keys, { label: 'Delete motion key', at: keys[Math.min(index, keys.length - 1)]?.at });
	}

	// Replaces one preset entry with the keys measured from it, in place in
	// the stack. Timing, anchor and the rest transform are untouched.
	convertToCustom(layer, animation) {
		const index = this._animations(layer).indexOf(animation);
		if (index < 0 || !isFeatureAvailable('timeline') || !this.editor.layers.includes(layer) || !this.editor.canEditLayer(layer)) return;
		const result = this.conversion(animation);
		if (!result) return;
		layer.animations[index] = result.animation;
		this.selectedByLayer.set(layer.id, index);
		this._render(layer);
		this.editor.saveState('Convert to custom motion');
		const channel = GlitterAnimation.POSE_CHANNELS[result.error?.channel];
		this.editor.updateStatus(channel
			? `Converted to an approximate custom motion: ${channel.label} is within ${Number((result.error.value * channel.displayScale).toPrecision(2))}${channel.unit || '%'}`
			: 'Converted to a custom motion');
	}

	conversion(animation) {
		const json = JSON.stringify(animation), cached = this.converted.get(animation);
		if (cached?.json === json) return cached.result;
		const result = GlitterAnimation.convertToKeys(animation);
		this.converted.set(animation, { json, result });
		return result;
	}

	_loadConvertControl(prefix, layer, animation) {
		const set = this._id(prefix, 'ConvertActions'), button = this._id(prefix, 'Convert');
		if (!set || !button) return;
		set.hidden = !animation || !GlitterAnimation.MOTION_REGISTRY[animation.type]?.convertible || !isFeatureAvailable('timeline');
		if (set.hidden) return;
		const result = this.conversion(animation);
		button.disabled = !result || !this.editor.canEditLayer(layer);
		button.title = result
			? (result.error ? `Replace this preset with ${result.animation.keys.length} editable keys that closely follow it` : `Replace this preset with ${result.animation.keys.length} editable keys`)
			: 'Keys cannot follow this animation with its current settings. Try another easing.';
	}

	_loadKeyControls(prefix, layer, data) {
		const animation = this._selected(layer);
		this._loadConvertControl(prefix, layer, animation);
		const keyed = GlitterAnimation.MOTION_REGISTRY[data?.type]?.keyed === true;
		const editable = keyed && this.canEditKeys(layer, animation);
		const keys = keyed ? GlitterAnimation.normalizeKeys(animation.keys) : [];
		const key = keys[this.keyIndex(animation)];
		const held = (property) => Boolean(key) && property.channels.some((id) => Object.hasOwn(key.values, id));
		const properties = GlitterAnimation.POSE_PROPERTIES;
		const desktopNote = this._id(prefix, 'KeyDesktopNote');
		if (desktopNote) desktopNote.hidden = !keyed || editable;
		const show = { KeySet: keyed, KeyActions: keyed, KeyValues: Boolean(key), KeyValueActions: Boolean(key) && !properties.every(held) };
		for (const [suffix, visible] of Object.entries(show)) {
			const node = this._id(prefix, suffix);
			if (node) node.hidden = !visible;
		}
		if (!keyed) { this.keyAddContext = null; return; }
		const stripHost = this._id(prefix, 'KeyStrip');
		if (stripHost) {
			let strip = this.keyStrips.get(prefix);
			if (!strip) { strip = new KeyStrip(stripHost, this, { layer, entry: animation }); this.keyStrips.set(prefix, strip); }
			if (strip.drag && (strip.context.layer !== layer || strip.context.entry !== animation)) strip.pointerDrag.finish(true);
			strip.context.layer = layer; strip.context.entry = animation; strip.update();
		}
		const select = this._id(prefix, 'KeySelect');
		if (select) {
			select.replaceChildren(...keys.map((entry, index) => {
				const option = document.createElement('option');
				option.value = entry.at; option.textContent = `${index + 1} · ${formatSeconds(entry.at * this.keyPeriod(layer, animation))}`;
				option.title = GlitterAnimation.POSE_PROPERTIES.filter(property => property.channels.some(id => Object.hasOwn(entry.values, id))).map(property => property.label).join(', ');
				return option;
			}));
			select.value = key?.at ?? ''; select.disabled = !editable || !key;
		}
		for (const suffix of ['KeyPrev', 'KeyNext']) {
			const step = this._id(prefix, suffix);
			if (step) step.disabled = !editable || keys.length < 2;
		}
		const position = this._id(prefix, 'KeyPosition');
		if (position) { syncSlider(position, key ? Number((key.at * 100).toFixed(1)) : 0); position.disabled = !editable || !key; }
		const easing = this._id(prefix, 'KeyEasing');
		if (easing) { easing.value = key?.easing || 'linear'; easing.disabled = !editable || !key; }
		const keySteps = this._id(prefix, 'KeySteps'), keyStepsRow = this._id(prefix, 'KeyStepsRow');
		if (keySteps) { keySteps.value = data.steps; keySteps.disabled = !editable; }
		if (keyStepsRow) keyStepsRow.hidden = key?.easing !== 'steps';
		// A pair with one channel keyed shows the other where the motion has it.
		let rest = null;
		for (const property of properties) {
			const row = this._id(prefix, `${this._keyPropertyName(property)}Row`);
			if (!row) continue;
			row.hidden = !held(property);
			if (row.hidden) continue;
			this._keyPropertyInputs(prefix, property).forEach((input, index) => {
				const channel = GlitterAnimation.POSE_CHANNELS[property.channels[index]];
				const stored = Object.hasOwn(key.values, channel.id) ? key.values[channel.id] : (rest ||= GlitterAnimation.keyRestSample(animation, key.at))[channel.id];
				const value = Number((stored * channel.displayScale).toFixed(2));
				if (input.type === 'range') syncSlider(input, value); else input.value = value;
				input.disabled = !editable;
			});
			row.querySelector('.property-revert').disabled = !editable;
		}
		const empty = this._id(prefix, 'KeyEmpty');
		if (empty) empty.hidden = !key || properties.some(held);
		const addValue = this._id(prefix, 'KeyAddValue');
		if (addValue) addValue.disabled = !editable;
		const remove = this._id(prefix, 'KeyDelete');
		this.syncKeyAdd(layer, animation);
		if (remove) remove.disabled = !editable || !key;
		const record = this._id(prefix, 'KeyRecord'), recording = this.editor.timelineKeyRecording;
		if (record) {
			const active = recording?.active && recording.entry === animation;
			record.disabled = !active && (!recording || !recording.canBegin(layer, animation));
			record.querySelector('.name').textContent = active ? 'Done' : KEY_POSE_ACTION.label;
			record.classList.toggle('active', Boolean(active));
		}
	}

	_keyPropertyName(property) { return `KeyProp${property.id.charAt(0).toUpperCase()}${property.id.slice(1)}`; }

	// A property's inputs, in the order of its channels.
	_keyPropertyInputs(prefix, property) {
		const name = this._keyPropertyName(property);
		return (property.channels.length > 1 ? ['X', 'Y'].map((axis) => this._id(prefix, `${name}${axis}`)) : [this._id(prefix, name)]).filter(Boolean);
	}

	// Rewrites the selected key through `change(key, keys)`.
	_editKey(layer, animation, change, options) {
		if (!this.canEditKeys(layer, animation)) return false;
		const keys = GlitterAnimation.normalizeKeys(animation.keys), key = keys[this.keyIndex(animation)];
		if (!key) return false;
		change(key, keys);
		return this.setKeys(layer, animation, keys, options);
	}

	// Keys every channel of a property the key does not hold yet, where the
	// motion has it at this key.
	_holdProperty(animation, key, property) {
		const rest = GlitterAnimation.keyRestSample(animation, key.at);
		for (const id of property.channels) if (!Object.hasOwn(key.values, id)) key.values[id] = rest[id];
	}

	_bindKeys(type, prefix) {
		const target = () => { const layer = this._active(type); return { layer, animation: this._selected(layer) }; };
		// A slider's drag is one history entry, saved on release if it changed anything.
		const live = (slider, label, write) => {
			let before = null;
			bindSlider(slider, document.getElementById(`${slider.id}Value`), {
				parseValue: Number, cost: FIELDS[slider.dataset.role]?.cost,
				apply: (value) => {
					const { layer, animation } = target();
					if (!this.canEditKeys(layer, animation)) return;
					before ??= GlitterAnimation.normalizeKeys(animation.keys);
					write(layer, animation, value);
				},
				onCommit: () => {
					const { layer, animation } = target(), changed = before != null && animation && !isSameData(before, GlitterAnimation.normalizeKeys(animation.keys));
					before = null;
					if (changed) this.editor.saveState(label);
					else if (layer) this.load(layer);
				}
			});
		};
		this._id(prefix, 'KeySelect')?.addEventListener('change', (event) => {
			const { layer, animation } = target();
			if (this.canEditKeys(layer, animation)) this.selectKey(layer, animation, Number(event.target.value), { seek: true });
		});
		for (const [suffix, direction] of [['KeyPrev', -1], ['KeyNext', 1]]) this._id(prefix, suffix)?.addEventListener('click', () => {
			const { layer, animation } = target();
			if (!this.canEditKeys(layer, animation)) return;
			const keys = GlitterAnimation.normalizeKeys(animation.keys);
			if (keys.length) this.selectKey(layer, animation, keys[(this.keyIndex(animation) + direction + keys.length) % keys.length].at, { seek: true });
		});
		const position = this._id(prefix, 'KeyPosition');
		if (position) live(position, 'Retime motion key', (layer, animation, value) => this.retimeKey(layer, animation, this.keyIndex(animation), value / 100, { commit: false }));
		this._id(prefix, 'KeyEasing')?.addEventListener('change', (event) => {
			const { layer, animation } = target();
			this._editKey(layer, animation, (key) => { key.easing = event.target.value; });
		});
		for (const property of GlitterAnimation.POSE_PROPERTIES) {
			const row = this._id(prefix, `${this._keyPropertyName(property)}Row`);
			if (!row) continue;
			this._keyPropertyInputs(prefix, property).forEach((input, index) => {
				const channel = GlitterAnimation.POSE_CHANNELS[property.channels[index]], field = FIELDS[channel.field];
				const write = (key, animation, value) => {
					this._holdProperty(animation, key, property);
					key.values[channel.id] = clampNumber(value, field.min, field.max) / channel.displayScale;
				};
				if (input.type === 'range') {
					live(input, 'Edit motion key', (layer, animation, value) => this._editKey(layer, animation, (key) => write(key, animation, value), { commit: false }));
					return;
				}
				input.addEventListener('change', () => {
					const { layer, animation } = target(), value = input.valueAsNumber;
					if (!this.canEditKeys(layer, animation)) return;
					if (!Number.isFinite(value)) { this.load(layer); return; }
					this._editKey(layer, animation, (key) => write(key, animation, value));
				});
			});
			row.querySelector('.property-revert').addEventListener('click', () => {
				const { layer, animation } = target();
				this._editKey(layer, animation, (key) => { for (const id of property.channels) delete key.values[id]; });
			});
		}
		// Lists what the key does not hold yet.
		this._id(prefix, 'KeyAddValue')?.addEventListener('click', (event) => {
			const { layer, animation } = target();
			if (!this.canEditKeys(layer, animation)) return;
			const key = GlitterAnimation.normalizeKeys(animation.keys)[this.keyIndex(animation)];
			if (!key) return;
			const trigger = event.currentTarget, root = trigger.closest('.app-menu'), panel = root.querySelector('.app-menu-panel');
			panel.replaceChildren(...GlitterAnimation.POSE_PROPERTIES.filter((property) => !property.channels.some((id) => Object.hasOwn(key.values, id))).map((property) => {
				const button = buildMenuItem({ label: property.label, run: () => {
					const current = target();
					this._editKey(current.layer, current.animation, (entry) => this._holdProperty(current.animation, entry, property));
				} });
				return button;
			}));
			root._animationMenu ||= setupMenuPopover({ root, trigger, panel, bindTrigger: false });
			root._animationMenu.open();
		});
		this._id(prefix, 'KeyAdd')?.addEventListener('click', () => { const { layer, animation } = target(); this.addKey(layer, animation); });
		this._id(prefix, 'KeyDelete')?.addEventListener('click', () => { const { layer, animation } = target(); if (animation) this.deleteKey(layer, animation); });
		this._id(prefix, 'Convert')?.addEventListener('click', () => { const { layer, animation } = target(); if (animation) this.convertToCustom(layer, animation); });
		this._id(prefix, 'KeyRecord')?.addEventListener('click', () => {
			const { layer, animation } = target(), recording = this.editor.timelineKeyRecording;
			if (recording?.active) recording.end(); else recording?.begin(layer, animation);
		});
	}

	_createDefault(layer, type = CONFIG.tools.animation.defaultType) {
		const animation = GlitterAnimation.normalizeAnimation({ type });
		if (layer.type === LayerType.STICKER && layer.stickerData?.isPixelated !== false) animation.snapMode = 'pixel-snap';
		return animation;
	}

	addAnimation(layer, type = CONFIG.tools.animation.defaultType) {
		if (!this.editor.layers.includes(layer) || !this.editor.canEditLayer(layer) || this._animations(layer).length >= CONFIG.tools.animation.maxStackSize) return;
		const feature = GlitterAnimation.MOTION_REGISTRY[type]?.feature;
		if (feature && !isFeatureAvailable(feature)) return;
		layer.animations ||= []; layer.animations.push(this._createDefault(layer, type));
		this.selectedByLayer.set(layer.id, layer.animations.length - 1); this._render(layer);
		this.editor.saveState('Add animation');
	}

	duplicateAnimation(layer, index = this._selectedIndex(layer)) {
		if (!this.editor.canEditLayer(layer) || !this._animations(layer)[index] || layer.animations.length >= CONFIG.tools.animation.maxStackSize) return;
		layer.animations.splice(index + 1, 0, structuredClone(layer.animations[index]));
		this.selectedByLayer.set(layer.id, index + 1); this._render(layer); this.editor.saveState('Duplicate animation');
	}

	deleteAnimation(layer, index = this._selectedIndex(layer)) {
		if (!this.editor.canEditLayer(layer) || !this._animations(layer)[index]) return;
		layer.animations.splice(index, 1);
		this.selectedByLayer.set(layer.id, Math.max(0, Math.min(index, layer.animations.length - 1)));
		this._render(layer); this.editor.saveState('Delete animation');
	}

	_renderStack(prefix, layer) {
		const host = this._id(prefix, 'Stack');
		if (!host) return;
		const animations = this._animations(layer);
		host.hidden = !animations.length;
		host.replaceChildren();
		animations.forEach((animation, index) => {
			const row = document.createElement('div'); row.className = 'list-row animation-stack-item';
			row.classList.toggle('active', index === this._selectedIndex(layer));
			const button = document.createElement('button'); button.type = 'button'; button.className = 'list-row-content btn-text';
			button.append(createIcon('motion-play'));
			const text = document.createElement('span'); text.textContent = `${GlitterAnimation.MOTION_REGISTRY[animation.type].label} · ${formatSeconds(animation.periodMs)} · ${TimelineView.repeatsText(animation.iterations)}`; button.append(text);
			button.setAttribute('aria-pressed', String(index === this._selectedIndex(layer)));
			button.addEventListener('click', () => { this.selectMotion(layer, index); this.editor.timelineDock?.selectMotion(layer.id, index); this.load(layer); });
			const enabled = buildIconButton({ label: animation.enabled === false ? 'Enable animation' : 'Disable animation', icon: animation.enabled === false ? 'eye-slash' : 'eye' });
			enabled.setAttribute('aria-pressed', String(animation.enabled !== false));
			enabled.addEventListener('click', () => { if (!this.editor.canEditLayer(layer)) return; animation.enabled = animation.enabled === false; this._render(layer); this.editor.saveState('Toggle animation'); });
			const grip = buildIconButton({ icon: 'grip-vertical', label: 'Drag to reorder; arrow keys move this animation' });
			const reorder = destination => {
				if (!this.editor.canEditLayer(layer) || destination === index || destination < 0 || destination >= animations.length) return;
				animations.splice(index, 1); animations.splice(destination, 0, animation); this.selectMotion(layer, destination); this._render(layer); this.editor.saveState('Reorder animations');
			};
			grip.draggable = true;
			grip.addEventListener('dragstart', event => { this.stackDrag = { layer, index }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); });
			row.addEventListener('dragover', event => { if (this.stackDrag?.layer === layer) event.preventDefault(); });
			row.addEventListener('drop', event => { if (this.stackDrag?.layer !== layer) return; event.preventDefault(); const origin = this.stackDrag.index; this.stackDrag = null; if (origin === index || !this.editor.canEditLayer(layer)) return; const [entry] = animations.splice(origin, 1); animations.splice(index, 0, entry); this.selectMotion(layer, index); this._render(layer); this.editor.saveState('Reorder animations'); });
			grip.addEventListener('dragend', () => { this.stackDrag = null; });
			grip.addEventListener('keydown', event => { if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); reorder(index + (event.key === 'ArrowDown' ? 1 : -1)); });
			row.append(button, enabled, grip); host.appendChild(row);
		});
		const remove = this._id(prefix, 'Remove');
		if (remove) remove.disabled = !animations.length;
		const add = this._id(prefix, 'Add');
		if (add) {
			const atLimit = animations.length >= CONFIG.tools.animation.maxStackSize;
			add.disabled = atLimit;
			add.title = atLimit ? `Maximum of ${CONFIG.tools.animation.maxStackSize} animations` : '';
		}
	}

	_renderLayer(layer) {
		const manager = getLayerManagerForType(this.editor, layer.type);
		manager?.renderLayer?.(layer);
	}

	_render(layer, commit = false) {
		this._renderLayer(layer);
		this.editor.timelineDock?.selectMotion(layer.id, this._selectedIndex(layer));
		this.load(layer);
		if (commit) this.editor.saveState('Edit animation');
	}

	_updateLayerAnchor(layer, anchor) {
		const manager = getLayerManagerForType(this.editor, layer.type);
		if (manager?.updateTransform) manager.updateTransform(layer.id, { anchor });
		else {
			layer.transform = { ...getLayerTransform(layer), anchor };
			this._renderLayer(layer);
		}
		const prefix = LAYER_UI_CONFIG[layer.type]?.transformPrefix;
		if (prefix) this.editor.loadTransformSettings?.(layer, prefix);
	}

	_bind(type) {
		const prefix = this.prefixByType.get(type);
		this._bindKeys(type, prefix);
		this._id(prefix, 'Enabled')?.addEventListener('change', (event) => {
			const layer = this._active(type);
			if (!layer) return;
			if (event.target.checked) {
				if (layer.animations?.length) layer.animations.forEach(animation => { animation.enabled = true; });
				else layer.animations = [this._createDefault(layer)];
				this.selectedByLayer.set(layer.id, 0);
			} else {
				layer.animations?.forEach(animation => { animation.enabled = false; });
			}
			this._render(layer, true);
		});
		this._id(prefix, 'Type')?.addEventListener('change', (event) => {
			const layer = this._active(type);
			const animation = this._selected(layer);
			if (!animation) return;
			const feature = GlitterAnimation.MOTION_REGISTRY[event.target.value]?.feature;
			if (feature && !isFeatureAvailable(feature)) { this.load(layer); return; }
			layer.animations[this._selectedIndex(layer)] = this._createDefault(layer, event.target.value);
			this._render(layer, true);
		});
		this._id(prefix, 'Add')?.addEventListener('click', () => {
			const layer = this._active(type);
			if (!layer || !this.editor.canEditLayer(layer) || this._animations(layer).length >= CONFIG.tools.animation.maxStackSize) return;
			const append = motionType => this.addAnimation(layer, motionType);
			if (!isFeatureAvailable('timeline')) { append(CONFIG.tools.animation.defaultType); return; }
			const trigger = this._id(prefix, 'Add'), root = trigger.closest('.app-menu'), panel = root.querySelector('.app-menu-panel');
			panel.replaceChildren(...[CONFIG.tools.animation.defaultType, 'custom'].map((motionType) => {
				return buildMenuItem({ label: GlitterAnimation.MOTION_REGISTRY[motionType].label, run: () => append(motionType) });
			}));
			root._animationMenu ||= setupMenuPopover({ root, trigger, panel, bindTrigger: false });
			root._animationMenu.open();
		});
		this._id(prefix, 'Remove')?.addEventListener('click', () => {
			const layer = this._active(type); if (layer) this.deleteAnimation(layer);
		});
		const cyclePreset = (direction) => {
			const select = this._id(prefix, 'Type');
			if (!select?.options.length) return;
			const options = [...select.options].filter((option) => !option.disabled && (!option.dataset.feature || isFeatureAvailable(option.dataset.feature)));
			if (!options.length) return;
			const current = options.findIndex((option) => option.selected);
			const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
			select.value = options[(start + direction + options.length) % options.length].value;
			select.dispatchEvent(new Event('change', { bubbles: true }));
		};
		this._id(prefix, 'PresetPrev')?.addEventListener('click', () => cyclePreset(-1));
		this._id(prefix, 'PresetNext')?.addEventListener('click', () => cyclePreset(1));
		GlitterAnimation.ANIMATION_CONTROLS.filter((control) => control.field).forEach(({ suffix, key: field, field: spec, scale }) => {
			const slider = this._id(prefix, suffix);
			if (!slider) return;
			bindSlider(slider, this._id(prefix, `${suffix}Value`), {
				suffix: FIELDS[spec]?.unit || '',
				parseValue: Number,
				apply: (value) => {
					const layer = this._active(type);
					const animation = this._selected(layer);
					if (!animation) return;
					if (field === 'anchorX' || field === 'anchorY') {
						const key = field.endsWith('X') ? 'x' : 'y';
						if (this._anchorDefinition(animation).stores === 'motion') animation[`orbitCenter${key.toUpperCase()}`] = value / scale;
						else this._updateLayerAnchor(layer, { ...getLayerTransform(layer).anchor, [key]: value / scale });
					} else animation[field] = Number((value / scale).toFixed(6));
					this._renderLayer(layer);
					this._syncSummary(prefix, layer.animations, animation);
				},
				onCommit: () => {
					const layer = this._active(type);
					this.editor.saveState(this._anchorDefinition(this._selected(layer)).stores === 'layer' && (field === 'anchorX' || field === 'anchorY') ? 'Change anchor' : 'Edit animation');
				}
			});
		});
		GlitterAnimation.ANIMATION_CONTROLS.filter((control) => !control.field).forEach(({ suffix, key: field }) => {
			this._id(prefix, suffix)?.addEventListener('change', (event) => {
				const layer = this._active(type);
				const animation = this._selected(layer);
				if (!animation) return;
				if (field === 'anchor') {
					if (event.target.value === 'custom') return;
					const [x, y] = event.target.value.split(',').map(Number);
					if (this._anchorDefinition(animation).stores === 'motion') {
						animation.orbitCenter = event.target.value;
						animation.orbitCenterX = x;
						animation.orbitCenterY = y;
					}
					else {
						this._updateLayerAnchor(layer, { x, y });
					}
				} else animation[field] = event.target.value;
				this._render(layer);
				this.editor.saveState(field === 'anchor' && this._anchorDefinition(animation).stores === 'layer' ? 'Change anchor' : 'Edit animation');
			});
		});
		const applyRepeats = () => {
			const layer = this._active(type);
			const animation = this._selected(layer);
			if (!animation) return;
			const spec = FIELDS.animIterations;
			animation.iterations = this._id(prefix, 'IterationsForever').checked
				? Infinity
				: Number(clampNumber(this._id(prefix, 'Iterations').valueAsNumber, spec.min, spec.max, spec.value).toFixed(2));
			this._render(layer, true);
		};
		this._id(prefix, 'Iterations')?.addEventListener('change', applyRepeats);
		this._id(prefix, 'IterationsForever')?.addEventListener('change', applyRepeats);
		for (const suffix of ['Steps', 'KeySteps']) this._id(prefix, suffix)?.addEventListener('change', (event) => {
			const layer = this._active(type);
			const animation = this._selected(layer);
			if (!animation) return;
			animation.steps = Math.max(FIELDS.animSteps.min, Math.min(FIELDS.animSteps.max, Number(event.target.value) || FIELDS.animSteps.value));
			this._render(layer, true);
		});
	}

	_syncSummary(prefix, animations, selected = animations?.[0]) {
		const summary = this._id(prefix, 'Summary');
		if (summary) summary.textContent = GlitterAnimation.summaryText(animations);
		const hint = this._id(prefix, 'LoopHint');
		if (!hint) return;
		const context = getLayerAnimationSamplingContext(this.editor, this.editor.layerManager.getActiveLayer());
		const loop = Number.isFinite(selected?.iterations)
			? 'Plays a fixed number of times'
			: (GlitterAnimation.isSeamlessLoop(selected, context) ? 'Loops seamlessly' : 'Restarts abruptly each loop');
		// Duration is the cycle length; a traveling preset also reads as a speed.
		const speed = selected ? Math.round(GlitterAnimation.travelSpeed(selected, context)) : 0;
		hint.textContent = speed > 0 ? `${loop} · about ${speed} px/s` : loop;
	}

	load(layer) {
		this.editor.timelineKeyRecording?.validate();
		const prefix = this.prefixByType.get(layer?.type);
		if (!prefix) return;
		const enabled = Boolean(layer.animations?.some(animation => animation.enabled !== false));
		// Same contract as every other effect module (shadow, border, pixel
		// effects): the card's own is-collapsed accordion shows/hides the body,
		// so there's no separate content wrapper to toggle by hand here.
		syncPanelEffectToggle(this._id(prefix, 'Enabled'), enabled);
		this._syncSummary(prefix, layer.animations, this._selected(layer));
		this._loadKeyControls(prefix, layer, this._selected(layer));
		if (!layer.animations?.length) return;
		const data = GlitterAnimation.normalizeAnimation(this._selected(layer));
		this._renderStack(prefix, layer);
		const anchorControl = this._id(prefix, 'Anchor');
		const anchorRow = anchorControl?.closest('.property-row');
		const anchorLabel = anchorRow?.querySelector('.property-label');
		const anchor = this._anchorDefinition(data);
		if (anchorLabel) anchorLabel.textContent = anchor.label;
		const note = this._id(prefix, 'AnchorNote');
		if (note) note.textContent = anchor.note;
		const typeControl = this._id(prefix, 'Type');
		if (typeControl) {
			for (const option of typeControl.options) if (option.dataset.feature) {
				const available = isFeatureAvailable(option.dataset.feature);
				option.hidden = !available && option.value !== data.type;
				option.disabled = !available;
			}
			typeControl.value = data.type;
		}
		GlitterAnimation.ANIMATION_CONTROLS.filter((control) => !control.field).forEach(({ suffix, key }) => {
			const control = this._id(prefix, suffix);
			if (control) control.value = key === 'anchor' ? this._selectedAnchorPreset(layer, data) : data[key];
		});
		const iterations = this._id(prefix, 'Iterations');
		const forever = !Number.isFinite(data.iterations);
		if (iterations) { iterations.value = forever ? FIELDS.animIterations.value : data.iterations; iterations.disabled = forever; }
		const repeatForever = this._id(prefix, 'IterationsForever');
		if (repeatForever) repeatForever.checked = forever;
		const steps = this._id(prefix, 'Steps');
		if (steps) steps.value = data.steps;
		GlitterAnimation.ANIMATION_CONTROLS.filter((control) => control.field).forEach(({ suffix, key: field, field: spec, scale }) => {
			const control = this._id(prefix, suffix);
			if (!control) return;
			let source = data[field];
			if (field === 'anchorX' || field === 'anchorY') {
				const key = field.endsWith('X') ? 'x' : 'y';
				source = this._anchorDefinition(data).stores === 'motion' ? data[`orbitCenter${key.toUpperCase()}`] : getLayerTransform(layer).anchor[key];
			}
			const value = source * scale;
			writeSliderValue(control, value);
			const readout = this._id(prefix, `${suffix}Value`);
			if (!readout) return;
			const rounded = Number(value.toFixed(Math.max(1, stepDecimals(FIELDS[spec].step))));
			readout.innerHTML = formatUnit(rounded, FIELDS[spec]?.unit || '');
		});
		const motion = GlitterAnimation.MOTION_REGISTRY[data.type];
		const stepOption = this._id(prefix, 'SnapMode')?.querySelector('option[value="step"]');
		if (stepOption) { stepOption.hidden = Boolean(motion.keyed); stepOption.disabled = Boolean(motion.keyed); }
		GlitterAnimation.ANIMATION_CONTROLS.forEach(({ key, suffix }) => {
			const row = this._id(prefix, `${suffix}Row`);
			if (row && !['periodMs', 'delayMs', 'phase', 'anchorX', 'anchorY'].includes(key)) row.hidden = !motion.fields.includes(key) || motion.fieldWhen?.[key]?.(data) === false;
		});
		const stepsRow = this._id(prefix, 'Steps')?.closest('.property-row');
		if (stepsRow) stepsRow.hidden = motion.keyed || data.easing !== 'steps';
		const easingRow = this._id(prefix, 'Easing')?.closest('.property-row');
		if (easingRow) easingRow.hidden = Boolean(motion.keyed);
		['AnchorX', 'AnchorY'].forEach((suffix) => {
			const row = this._id(prefix, `${suffix}Row`);
			if (row) row.hidden = this._selectedAnchorPreset(layer, data) !== 'custom';
		});
		this._syncSummary(prefix, layer.animations, data);
		this.loadTimingStrip(prefix, layer);
		for (const [suffix, easing] of [['Easing', data.easing], ['KeyEasing', GlitterAnimation.normalizeKeys(data.keys)[this.keyIndex(this._selected(layer))]?.easing || 'linear']]) {
			const control = this._id(prefix, suffix); if (!control) continue;
			control.parentElement.querySelector('.easing-curve')?.remove(); control.after(buildEasingCurve(easing, data.steps));
		}
	}

	loadTimingStrip(prefix, layer) {
		const host = this._id(prefix, 'TimingStrip'); if (!host) return;
		const model = TimelineView.buildModel(this.editor.loopEstimate, this.editor.layers);
		const row = model.groups.find(group => group.layerId === layer.id)?.rows.find(row => TimelineView.motionIndex(row) === this._selectedIndex(layer));
		host.replaceChildren(); host.hidden = !row || !model.loopMs; if (host.hidden) return;
		const available = isFeatureAvailable('timeline'), bar = document.createElement(available ? 'button' : 'div');
		if (available) { bar.type = 'button'; bar.addEventListener('click', async () => { PREFERENCES.set('timelineOpen', true); const dock = await this.editor.ensureTimelineDock(); dock.open(); dock.selectMotion(layer.id, this._selectedIndex(layer)); }); }
		bar.className = 'timeline-bar animation-timing-bar'; bar.title = TimelineView.barTitle(row, model.loopMs);
		const box = TimelineView.barBox(row, 100000 / model.loopMs, CONFIG.ui.timeline);
		bar.style.left = `${box.left}%`; bar.style.width = `${Math.min(100 - box.left, box.width)}%`;
		bar.style.setProperty('--cycle-share', `${row.exportCycleMs / Math.max(1, row.endMs - row.startMs) * 100}%`);
		bar.classList.toggle('is-seam', !row.closes); if (!row.closes) bar.append(createIcon('triangle-exclamation'));
		host.title = `Loop ${formatSeconds(model.loopMs)}`; host.append(bar);
	}

	_anchorDefinition(animation) {
		return GlitterAnimation.MOTION_REGISTRY[animation?.type || CONFIG.tools.animation.defaultType].anchor;
	}

	_selectedAnchorPreset(layer, animation) {
		return this._anchorDefinition(animation).stores === 'motion'
			? this._orbitPreset(animation) : this._anchorPreset(getLayerTransform(layer).anchor);
	}

	_anchorPreset(anchor) {
		const values = [0, 0.5, 1];
		const x = values.find((value) => Math.abs(value - anchor.x) < 1e-6);
		const y = values.find((value) => Math.abs(value - anchor.y) < 1e-6);
		if (x == null || y == null) return 'custom';
		return `${x},${y}`;
	}

	_orbitPreset(animation) {
		if (animation.orbitCenter === 'custom') return 'custom';
		const [x, y] = GlitterAnimation.resolveOrigin(animation, 'orbitCenter');
		return this._anchorPreset({ x, y });
	}
}
