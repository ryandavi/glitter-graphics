'use strict';

class AnimationPanelController {
	constructor(editor) {
		this.editor = editor;
		this.prefixByType = new Map(Object.entries(LAYER_UI_CONFIG)
			.filter(([, config]) => config.animatable && config.transformPrefix)
			.map(([type, config]) => [type, config.transformPrefix]));

		this.selectedByLayer = new Map();
		this.selectedKeys = new WeakMap();
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
		const dock = isFeatureAvailable('timeline') && this.editor.timelineDock?.isOpen ? this.editor.timelineDock : null;
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
		if (seek && this.editor.timelineDock?.available && !this.editor.timelineDock.host.classList.contains('is-stale')) {
			const ticker = this.editor.animationTicker;
			const time = GlitterAnimation.timeAtProgress({ ...animation, periodMs: this.keyPeriod(layer, animation) }, at, ticker.getPlayheadTime());
			if (time != null) { this.setPaused(true); ticker.seek(time); }
		}
		this.load(layer);
		this.editor.timelineDock?.syncKeys();
	}

	keyPeriod(layer, animation) {
		const row = this.editor.timelineDock?.model?.groups.find((group) => group.layerId === layer.id)?.rows.find((entry) => entry.source.keyTrack?.entry === animation);
		return row?.exportCycleMs || animation.periodMs;
	}

	keyProgress(layer, animation) {
		return GlitterAnimation.cycleProgress({ ...animation, periodMs: this.keyPeriod(layer, animation) }, this.editor.animationTicker.getPlayheadTime(), { fill: false });
	}

	setKeys(layer, animation, keys, { commit = true, rollback = false, label = 'Edit motion key', at, coalesceKey } = {}) {
		if (!this.canEditKeys(layer, animation) && !(rollback && this.editor.layers.includes(layer) && layer.animations?.includes(animation))) return false;
		const next = GlitterAnimation.normalizeKeys(keys);
		if (JSON.stringify(next) === JSON.stringify(GlitterAnimation.normalizeKeys(animation.keys))) return false;
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
		const at = ((requested % 1) + 1) % 1;
		const others = keys.filter((_key, candidate) => candidate !== index);
		const distance = (a, b) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
		const candidates = [at, ...others.flatMap((key) => [((key.at - tolerance) % 1 + 1) % 1, (key.at + tolerance) % 1])];
		const position = candidates.filter((candidate) => others.every((key) => distance(candidate, key.at) >= tolerance - 1e-9))
			.sort((a, b) => distance(a, at) - distance(b, at))[0];
		if (position == null) return null;
		keys[index].at = position;
		this.setKeys(layer, animation, keys, { ...options, at: position, label: 'Retime motion key' });
		return position;
	}

	addKey(layer, animation) {
		if (!this.canEditKeys(layer, animation) || !this.editor.timelineDock?.available || this.editor.timelineDock.host.classList.contains('is-stale')) return;
		const progress = this.keyProgress(layer, animation);
		if (!progress) return;
		const at = ((progress.eased % 1) + 1) % 1;
		const keys = GlitterAnimation.normalizeKeys(animation.keys);
		const existing = keys.find((key) => Math.min(Math.abs(key.at - at), 1 - Math.abs(key.at - at)) < CONFIG.ui.timeline.keyPositionTolerance);
		if (existing) { this.selectKey(layer, animation, existing.at); return; }
		if (keys.length >= CONFIG.tools.animation.maxKeys) { this.editor.updateStatus(`Maximum of ${CONFIG.tools.animation.maxKeys} motion keys`); return; }
		const selected = keys[this.keyIndex(animation)];
		const channels = selected && Object.keys(selected.values).length ? Object.keys(selected.values) : CONFIG.tools.animation.defaultKeyChannels;
		const sample = GlitterAnimation.sampleAt({ ...animation, periodMs: this.keyPeriod(layer, animation) }, this.editor.animationTicker.getPlayheadTime(), getLayerAnimationSamplingContext(this.editor, layer));
		keys.push({ at, easing: 'linear', values: Object.fromEntries(channels.map((id) => [id, sample[id]])) });
		this.setKeys(layer, animation, keys, { label: 'Add motion key', at });
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
		const result = GlitterAnimation.convertToKeys(animation);
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

	_loadConvertControl(prefix, layer, animation) {
		const set = this._id(prefix, 'ConvertActions'), button = this._id(prefix, 'Convert');
		if (!set || !button) return;
		set.hidden = !animation || !GlitterAnimation.MOTION_REGISTRY[animation.type]?.convertible || !isFeatureAvailable('timeline');
		if (set.hidden) return;
		const result = GlitterAnimation.convertToKeys(animation);
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
		const show = { KeySet: keyed, KeyActions: keyed, KeyValues: Boolean(key), KeyValueActions: Boolean(key) && !properties.every(held) };
		for (const [suffix, visible] of Object.entries(show)) {
			const node = this._id(prefix, suffix);
			if (node) node.hidden = !visible;
		}
		if (!keyed) return;
		const select = this._id(prefix, 'KeySelect');
		if (select) {
			select.replaceChildren(...keys.map((entry, index) => {
				const option = document.createElement('option');
				option.value = entry.at; option.textContent = `${index + 1} · ${Number((entry.at * 100).toFixed(1))}%`;
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
		const add = this._id(prefix, 'KeyAdd'), remove = this._id(prefix, 'KeyDelete');
		if (add) { add.disabled = !editable || !this.editor.timelineDock?.available || !this.keyProgress(layer, animation); add.title = add.disabled ? 'Open the timeline and move the playhead inside this animation' : 'Add a key at the playhead'; }
		if (remove) remove.disabled = !editable || !key;
		const record = this._id(prefix, 'KeyRecord'), recording = this.editor.timelineKeyRecording;
		if (record) {
			const active = recording?.active && recording.entry === animation;
			record.disabled = !active && (!recording || !recording.canBegin(layer, animation));
			record.querySelector('.name').textContent = active ? 'Done' : 'Edit keys';
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
					before ??= JSON.stringify(GlitterAnimation.normalizeKeys(animation.keys));
					write(layer, animation, value);
				},
				onCommit: () => {
					const { layer, animation } = target(), changed = before != null && animation && before !== JSON.stringify(GlitterAnimation.normalizeKeys(animation.keys));
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
				const button = document.createElement('button');
				button.type = 'button'; button.className = 'app-menu-item';
				button.textContent = property.label;
				button.addEventListener('click', () => {
					const current = target();
					this._editKey(current.layer, current.animation, (entry) => this._holdProperty(current.animation, entry, property));
				});
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

	_renderStack(prefix, layer) {
		const host = this._id(prefix, 'Stack');
		if (!host) return;
		const animations = this._animations(layer);
		host.hidden = animations.length < 2;
		host.replaceChildren();
		animations.forEach((animation, index) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'segmented-option animation-stack-item';
			button.classList.toggle('active', index === this._selectedIndex(layer));
			button.setAttribute('aria-pressed', String(index === this._selectedIndex(layer)));
			button.textContent = `${index + 1}. ${GlitterAnimation.summaryText(animation)}`;
			button.addEventListener('click', () => {
				this.selectedByLayer.set(layer.id, index);
				this.editor.timelineDock?.selectMotion(layer.id, index);
				this.load(layer);
			});
			host.appendChild(button);
		});
		const remove = this._id(prefix, 'Remove');
		if (remove) remove.disabled = animations.length < 2;
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
				layer.animations = [this._createDefault(layer)];
				this.selectedByLayer.set(layer.id, 0);
			} else {
				delete layer.animations;
				this.selectedByLayer.delete(layer.id);
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
			const append = (motionType) => {
				if (!this.editor.layers.includes(layer) || !this.editor.canEditLayer(layer) || this._animations(layer).length >= CONFIG.tools.animation.maxStackSize) return;
				const feature = GlitterAnimation.MOTION_REGISTRY[motionType].feature;
				if (feature && !isFeatureAvailable(feature)) return;
				layer.animations ||= [];
				layer.animations.push(this._createDefault(layer, motionType));
				this.selectedByLayer.set(layer.id, layer.animations.length - 1);
				this._render(layer, true);
			};
			if (!isFeatureAvailable('timeline')) { append(CONFIG.tools.animation.defaultType); return; }
			const trigger = this._id(prefix, 'Add'), root = trigger.closest('.app-menu'), panel = root.querySelector('.app-menu-panel');
			panel.replaceChildren(...[CONFIG.tools.animation.defaultType, 'custom'].map((motionType) => {
				const button = document.createElement('button');
				button.type = 'button'; button.className = 'app-menu-item';
				button.textContent = GlitterAnimation.MOTION_REGISTRY[motionType].label;
				button.addEventListener('click', () => append(motionType));
				return button;
			}));
			root._animationMenu ||= setupMenuPopover({ root, trigger, panel, bindTrigger: false });
			root._animationMenu.open();
		});
		this._id(prefix, 'Remove')?.addEventListener('click', () => {
			const layer = this._active(type);
			if (!layer || this._animations(layer).length < 2) return;
			const index = this._selectedIndex(layer);
			layer.animations.splice(index, 1);
			this.selectedByLayer.set(layer.id, Math.min(index, layer.animations.length - 1));
			this._render(layer, true);
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
		this._id(prefix, 'Steps')?.addEventListener('change', (event) => {
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
		const enabled = GlitterAnimation.isActive(layer.animations);
		// Same contract as every other effect module (shadow, border, pixel
		// effects): the card's own is-collapsed accordion shows/hides the body,
		// so there's no separate content wrapper to toggle by hand here.
		syncPanelEffectToggle(this._id(prefix, 'Enabled'), enabled);
		this._syncSummary(prefix, layer.animations, this._selected(layer));
		this._loadKeyControls(prefix, layer, this._selected(layer));
		if (!enabled) return;
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
				option.hidden = !available;
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
		GlitterAnimation.ANIMATION_CONTROLS.forEach(({ key, suffix }) => {
			const row = this._id(prefix, `${suffix}Row`);
			if (row && !['periodMs', 'delayMs', 'phase', 'anchorX', 'anchorY'].includes(key)) row.hidden = !motion.fields.includes(key) || motion.fieldWhen?.[key]?.(data) === false;
		});
		const stepsRow = this._id(prefix, 'Steps')?.closest('.property-row');
		if (stepsRow) stepsRow.hidden = data.easing !== 'steps';
		['AnchorX', 'AnchorY'].forEach((suffix) => {
			const row = this._id(prefix, `${suffix}Row`);
			if (row) row.hidden = this._selectedAnchorPreset(layer, data) !== 'custom';
		});
		this._syncSummary(prefix, layer.animations, data);
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
