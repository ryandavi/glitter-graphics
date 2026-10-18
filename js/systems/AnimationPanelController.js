'use strict';

class AnimationPanelController {
	constructor(editor) {
		this.editor = editor;
		this.prefixByType = new Map(Object.entries(LAYER_UI_CONFIG)
			.filter(([, config]) => config.animatable && config.transformPrefix)
			.map(([type, config]) => [type, config.transformPrefix]));

		this.keyStrips = new Map();
		this.prefixByType.forEach((_prefix, type) => this._bind(type));
		window.addEventListener('motionselectionchange', event => { const layer = this.editor.layerManager.getActiveLayer(); if (layer?.id === event.detail.layerId) this.load(layer); });
	}

	setPaused(paused) { this.editor.setPlayback(!paused); }


	_id(prefix, suffix) {
		return document.getElementById(`${prefix}Anim${suffix}`);
	}

	_active(type) {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === type ? layer : null;
	}

	_animations(...args) { return this.editor.getAnimations(...args); }

	_selectedIndex(...args) { return this.editor.selectedMotionIndex(...args); }

	_selected(...args) { return this.editor.selectedMotion(...args); }

	selectedMotion(layer) { return this._selected(layer); }
	selectedMotionIndex(layer) { return this._selectedIndex(layer); }
	selectMotion(...args) { return this.editor.selectMotion(...args); }
	setKeySelection(...args) { return this.editor.setKeySelection(...args); }
	keyAddControl(layer) {
		const prefix = this.prefixByType.get(layer?.type);
		return prefix ? this._id(prefix, 'KeyAdd') : null;
	}
	syncKeyAdd(layer = this.editor.layerManager.getActiveLayer(), animation = this.selectedMotion(layer)) {
		if (!layer || !GlitterAnimation.MOTION_REGISTRY[animation?.type]?.keyed) { this.keyAddContext = null; return true; }
		const held = this.editor.animationTicker.paused;
		const progress = this.keyProgress(layer, animation);
		const disabled = !this.canEditKeys(layer, animation) || (held && !progress);
		const add = this.keyAddControl(layer);
		if (add) {
			add.disabled = disabled;
			add.title = disabled ? 'Move the playhead inside this animation' : held ? 'Add a key at the playhead' : 'Add a key halfway to the next key';
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

	canEditKeys(...args) { return this.editor.canEditKeys(...args); }

	keyIndex(...args) { return this.editor.keyIndex(...args); }

	selectKey(...args) { return this.editor.selectKey(...args); }

	keyPeriod(...args) { return this.editor.keyPeriod(...args); }

	keyProgress(...args) { return this.editor.keyProgress(...args); }

	setKeys(...args) { return this.editor.setKeys(...args); }

	beginKeyRetime(...args) { return this.editor.beginKeyRetime(...args); }

	retimeKey(...args) { return this.editor.retimeKey(...args); }

	addKey(...args) { return this.editor.addKey(...args); }

	editKeyEasing(...args) { return this.editor.editKeyEasing(...args); }

	duplicateKey(...args) { return this.editor.duplicateKey(...args); }

	deleteKey(...args) { return this.editor.deleteKey(...args); }

	// Replaces one preset entry with the keys measured from it, in place in
	// the stack. Timing, anchor and the rest transform are untouched.
	convertToCustom(...args) { return this.editor.convertToCustom(...args); }

	conversion(...args) { return this.editor.conversion(...args); }

	_loadConvertControl(prefix, layer, animation) {
		const set = this._id(prefix, 'ConvertActions'), button = this._id(prefix, 'Convert');
		if (!set || !button) return;
		set.hidden = !animation || !GlitterAnimation.MOTION_REGISTRY[animation.type]?.convertible || !isFeatureAvailable('customMotion');
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
		if (desktopNote) desktopNote.hidden = !keyed || !this.editor.mobileManager.isMobile;
		const stripRow = this._id(prefix, 'KeyStrip')?.closest('.property-row');
		if (stripRow) stripRow.hidden = !keyed;
		const show = { KeyStripNote: keyed, KeySet: keyed, KeyActions: keyed, KeyValues: Boolean(key), KeyValueActions: Boolean(key) && !properties.every(held) };
		for (const [suffix, visible] of Object.entries(show)) {
			const node = this._id(prefix, suffix);
			if (node) node.hidden = !visible;
		}
		if (!keyed) { this.keyAddContext = null; return; }
		const stripHost = this._id(prefix, 'KeyStrip');
		if (stripHost) {
			let strip = this.keyStrips.get(prefix);
			if (!strip) { strip = new KeyStrip(stripHost, this.editor, { layer, entry: animation }); this.keyStrips.set(prefix, strip); }
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
		const record = this._id(prefix, 'KeyRecord'), recording = this.editor.keyRecording;
		if (record) {
			const active = recording?.active && recording.entry === animation;
			record.disabled = !active && (this.editor.mobileManager.isMobile || !editable || (recording && !recording.canBegin(layer, animation)));
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
	_editKey(...args) { return this.editor.editMotionKey(...args); }

	// Keys every channel of a property the key does not hold yet, where the
	// motion has it at this key.
	_holdProperty(...args) { return this.editor.holdMotionProperty(...args); }

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
					if (changed) this.editor.commitMotionEdit(label);
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
			const trigger = event.currentTarget;
			openActionMenu({ root: trigger.closest('.app-menu'), trigger, actions: GlitterAnimation.POSE_PROPERTIES.filter((property) => !property.channels.some((id) => Object.hasOwn(key.values, id))).map((property) => ({
				label: property.label, run: () => {
					const current = target();
					this._editKey(current.layer, current.animation, (entry) => this._holdProperty(current.animation, entry, property));
				}
			})) });
		});
		this._id(prefix, 'KeyAdd')?.addEventListener('click', () => { const { layer, animation } = target(); this.addKey(layer, animation); });
		this._id(prefix, 'KeyDelete')?.addEventListener('click', () => { const { layer, animation } = target(); if (animation) this.deleteKey(layer, animation); });
		this._id(prefix, 'Convert')?.addEventListener('click', () => { const { layer, animation } = target(); if (animation) this.convertToCustom(layer, animation); });
		this._id(prefix, 'KeyRecord')?.addEventListener('click', async () => {
			const { layer, animation } = target(), recording = await this.editor.ensureKeyRecording();
			if (recording.active) recording.end(); else recording.begin(layer, animation);
		});
	}

	_createDefault(...args) { return this.editor.createMotion(...args); }

	addAnimation(...args) { return this.editor.addAnimation(...args); }

	duplicateAnimation(...args) { return this.editor.duplicateAnimation(...args); }

	deleteAnimation(...args) { return this.editor.deleteAnimation(...args); }

	moveAnimation(...args) { return this.editor.moveAnimation(...args); }

	toggleAnimation(...args) { return this.editor.toggleAnimation(...args); }

	_renderStack(prefix, layer) {
		const host = this._id(prefix, 'Stack');
		if (!host) return;
		if (isReordering(host)) { host._pendingRender = true; return; }
		host.dataset.layerId = layer.id;
		const currentLayer = () => this.editor.layerManager.getLayerById(host.dataset.layerId);
		if (!LIST_REORDERS.has(host)) {
			bindListReorder(host, {
				item: '.animation-stack-item', handle: '.list-row-handle',
				keyboardFocus: next => next.to,
				ids: row => [Number(row.dataset.animationIndex)],
				canDrag: () => this.editor.canEditLayer(currentLayer()),
				resolve: ({ ids, target, place }) => {
					const from = ids[0], insertion = Number(target.dataset.animationIndex) + Number(place === 'below');
					const to = insertion - Number(from < insertion);
					return from !== to && to >= 0 && to < this._animations(currentLayer()).length ? { from, to } : null;
				},
				commit: ({ from, to }) => this.moveAnimation(currentLayer(), from, to)
			});
			host.addEventListener('listreorderend', () => {
				if (host._pendingRender) { host._pendingRender = false; this._renderStack(prefix, currentLayer()); }
			});
		}
		const animations = this._animations(layer);
		host.hidden = !animations.length;
		const rows = reconcileKeyedChildren(host, animations, { key: animation => `${layer.id}/${animation.id}`, build: animation => {
			const row = document.createElement('div'); row.className = 'list-row animation-stack-item';
			row.dataset.motionId = animation.id; row.tabIndex = 0;
			const button = buildElement('list-row-content', undefined, 'span');
			const description = GlitterAnimation.describe(animation), text = buildElement('list-row-text', null, 'span');
			text.append(buildElement('list-row-name', description.name, 'span'), buildElement('list-row-meta', description.detail, 'span')); button.append(text);
			row.setAttribute('role', 'option');
			const index = () => Number(row.dataset.animationIndex);
			const select = () => { this.selectMotion(currentLayer(), row.dataset.motionId); this.load(currentLayer()); };
			row.addEventListener('click', event => { if (!event.target.closest('button')) select(); });
			row.addEventListener('keydown', event => { if (event.target === row && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); select(); } });
			const enabled = buildIconButton({ className: 'btn-icon-simple icon-wrapper sm list-row-action', label: animation.enabled === false ? 'Show animation' : 'Hide animation', icon: animation.enabled === false ? 'eye-slash' : 'eye' });
			enabled.setAttribute('aria-pressed', String(animation.enabled !== false));
			enabled.addEventListener('click', () => this.toggleAnimation(currentLayer(), index()));
			const grip = buildIconButton({ label: 'Drag to reorder; arrow keys move this animation' });
			const mark = buildElement('drag-handle-mark', undefined, 'span'); mark.setAttribute('aria-hidden', 'true'); grip.append(mark);
			grip.classList.add('list-row-handle');
			const menu = buildIconButton({ className: 'btn-icon-simple icon-wrapper sm list-row-action', label: 'Animation actions', icon: 'ellipsis-vertical' });
			const menuRoot = buildElement('app-menu');
			menuRoot.append(menu);
			menu.addEventListener('click', () => openActionMenu({ root: menuRoot, trigger: menu, actions: [
				...this.editor.animationTimingActions(GlitterAnimation.sourceKey(currentLayer().id, { id: row.dataset.motionId })),
				{ label: 'Duplicate animation', disabled: !this.editor.canEditLayer(currentLayer()) || currentLayer().animations.length >= CONFIG.tools.animation.maxStackSize, run: () => this.editor.duplicateAnimation(currentLayer(), index()) },
				{ label: 'Delete animation', disabled: !this.editor.canEditLayer(currentLayer()), run: () => this.editor.deleteAnimation(currentLayer(), index()) }
			] }));
			row.append(grip, enabled, button, menuRoot); return row;
		} });
		rows.forEach((row, index) => {
			const animation = animations[index], description = GlitterAnimation.describe(animation), selected = index === this._selectedIndex(layer);
			row.dataset.animationIndex = index; row.classList.toggle('active', selected); row.setAttribute('aria-selected', String(selected));
			row.querySelector('.list-row-name').textContent = description.name;
			row.querySelector('.list-row-meta').textContent = description.detail;
			const enabled = row.querySelector('.list-row-action'), shown = animation.enabled !== false;
			enabled.title = shown ? 'Hide animation' : 'Show animation'; enabled.setAttribute('aria-label', enabled.title);
			enabled.setAttribute('aria-pressed', String(shown)); enabled.querySelector('use').setAttribute('href', shown ? '#icon-eye' : '#icon-eye-slash');
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

	_renderLayer(layer) { this.editor.touchMotion(layer, this._selected(layer)); this.editor.renderAnimationLayer(layer); }

	_render(layer, commitLabel) {
		this._renderLayer(layer);
		this.load(layer);
		if (commitLabel) this.editor.commitMotionEdit(commitLabel);
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
			this.editor.setAnimationsEnabled(layer, event.target.checked);
		});
		this._id(prefix, 'Type')?.addEventListener('change', (event) => {
			const layer = this._active(type);
			const animation = this._selected(layer);
			if (!animation) return;
			const feature = GlitterAnimation.MOTION_REGISTRY[event.target.value]?.feature;
			if (feature && !isFeatureAvailable(feature)) { this.load(layer); return; }
			this.editor.setAnimationType(layer, animation.id, event.target.value);
		});
		this._id(prefix, 'Add')?.addEventListener('click', () => {
			const layer = this._active(type);
			if (!layer || !this.editor.canEditLayer(layer) || this._animations(layer).length >= CONFIG.tools.animation.maxStackSize) return;
			this.addAnimation(layer, CONFIG.tools.animation.defaultType);
		});
		this._id(prefix, 'Remove')?.addEventListener('click', () => {
			const layer = this._active(type); if (layer) this.deleteAnimation(layer);
		});
		this._id(prefix, 'IncludeInLoop')?.addEventListener('click', () => this.editor.includeAnimationsInLoop());
		const cyclePreset = (direction) => {
			const select = this._id(prefix, 'Type');
			if (!select?.options.length) return;
			const options = [...select.options].filter((option) => !option.disabled && !GlitterAnimation.MOTION_REGISTRY[option.value]?.keyed && (!option.dataset.feature || isFeatureAvailable(option.dataset.feature)));
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
					} else this.editor.setMotionField(layer, animation.id, field, Number((value / scale).toFixed(6)), { live: true });
					if (field === 'anchorX' || field === 'anchorY') this._renderLayer(layer);
					this._syncSummary(prefix, GlitterAnimation.getLayerAnimations(layer), animation);
				},
				onCommit: () => {
					const layer = this._active(type);
					this.editor.commitMotionEdit(this._anchorDefinition(this._selected(layer)).stores === 'layer' && (field === 'anchorX' || field === 'anchorY') ? 'Change anchor' : `Change ${FIELDS[spec].label}`);
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
				} else this.editor.setMotionField(layer, animation.id, field, event.target.value, { live: true });
				this._render(layer);
				this.editor.commitMotionEdit(field === 'anchor' && this._anchorDefinition(animation).stores === 'layer' ? 'Change anchor' : `Change ${suffix.replace(/([a-z])([A-Z])/g, '$1 $2')}`);
			});
		});
		const applyRepeats = () => {
			const layer = this._active(type);
			const animation = this._selected(layer);
			if (!animation) return;
			const spec = FIELDS.animIterations;
			const iterations = this._id(prefix, 'PlaysForever').checked
				? Infinity
				: clampNumber(this._id(prefix, 'Iterations').valueAsNumber, spec.min, spec.max, spec.value);
			this.editor.writeTiming(GlitterAnimation.sourceKey(layer.id, animation), { iterations }, { live: true });
			this._render(layer, `Change ${spec.label}`);
		};
		this._id(prefix, 'Iterations')?.addEventListener('change', applyRepeats);
		this._id(prefix, 'Plays')?.addEventListener('change', applyRepeats);
		for (const suffix of ['TrimEnd', 'StretchDuration']) this._id(prefix, suffix)?.addEventListener('change', event => {
			const layer = this._active(type), animation = this._selected(layer); if (!animation) return;
			const key = GlitterAnimation.sourceKey(layer.id, animation), value = event.target.valueAsNumber * 1000;
			if (suffix === 'TrimEnd') this.editor.endAt(key, event.target.value === '' ? Infinity : value);
			else this.editor.stretchDuration(key, value);
			this.load(layer);
		});
		for (const suffix of ['Steps', 'KeySteps']) this._id(prefix, suffix)?.addEventListener('change', (event) => {
			const layer = this._active(type);
			const animation = this._selected(layer);
			if (!animation) return;
			animation.steps = Math.max(FIELDS.animSteps.min, Math.min(FIELDS.animSteps.max, Number(event.target.value) || FIELDS.animSteps.value));
			this._render(layer, `Change ${FIELDS.animSteps.label}`);
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
		this.editor.keyRecording?.validate();
		const prefix = this.prefixByType.get(layer?.type);
		if (!prefix) return;
		const enabled = layer.animationsEnabled !== false && Boolean(layer.animations?.length);
		// Same contract as every other effect module (shadow, border, pixel
		// effects): the card's own is-collapsed accordion shows/hides the body,
		// so there's no separate content wrapper to toggle by hand here.
		syncPanelEffectToggle(this._id(prefix, 'Enabled'), enabled);
		const data = GlitterAnimation.normalizeAnimation(this._selected(layer) || { type: CONFIG.tools.animation.defaultType });
		this._id(prefix, 'Enabled').closest('.animation-module').classList.toggle('is-empty', !layer.animations?.length);
		this._id(prefix, 'StackEmpty').hidden = Boolean(layer.animations?.length);
		this._id(prefix, 'PreviewCard').closest('.property-row').hidden = !layer.animations?.length;
		this._loadKeyControls(prefix, layer, data);
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
		this._id(prefix, 'PlaysForever').checked = forever;
		this._id(prefix, 'PlaysTimes').checked = !forever;
		this._id(prefix, 'IterationsRow').hidden = forever;
		const run = GlitterAnimation.runTiming(data);
		this._id(prefix, 'TrimEnd').value = Number.isFinite(run.end) ? run.end / 1000 : '';
		this._id(prefix, 'StretchDuration').value = Number.isFinite(run.end) ? Math.max(0, run.end - run.start) / 1000 : '';
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
		if (stepsRow) stepsRow.hidden = motion.keyed || (data.easing !== 'steps' && data.snapMode !== 'step');
		const easingRow = this._id(prefix, 'Easing')?.closest('.property-row');
		if (easingRow) easingRow.hidden = Boolean(motion.keyed);
		['AnchorX', 'AnchorY'].forEach((suffix) => {
			const row = this._id(prefix, `${suffix}Row`);
			if (row) row.hidden = this._selectedAnchorPreset(layer, data) !== 'custom';
		});
		this._syncSummary(prefix, GlitterAnimation.getLayerAnimations(layer), data);
		this.loadTimingSummary(layer);
		for (const [suffix, easing] of [['Easing', data.easing], ['KeyEasing', GlitterAnimation.normalizeKeys(data.keys)[this.keyIndex(this._selected(layer))]?.easing || 'linear']]) {
			const control = this._id(prefix, suffix); if (!control) continue;
			const option = control.querySelector('option[value="steps"]'), preview = option?.querySelector('svg');
			if (preview && preview.dataset.steps !== String(data.steps)) {
				const next = buildEasingCurve('steps', data.steps); next.classList.add('asset-browser-rail-preview');
				preview.replaceWith(next);
			}
			control.value = easing;
		}
	}

	loadTimingSummary(layer = this.editor.layerManager.getActiveLayer()) {
		const prefix = this.prefixByType.get(layer?.type); if (!prefix) return;
		const summary = this._id(prefix, 'TimingSummary'); if (!summary) return;
		const animation = this._selected(layer), loop = this.editor.resolveAnimationLoop();
		const target = listTimingTargets(this.editor, [layer]).find(target => target.kind === 'motion' && animation && target.motionId === animation.id);
		summary.hidden = !target;
		if (target) {
			const name = GlitterAnimation.describe(animation).name;
			const end = Number.isFinite(target.run.end) ? `ends at ${formatSeconds(target.run.end)}` : 'repeats to the loop end';
			summary.textContent = `${name}: starts at ${formatSeconds(target.run.start)}; ${end}.`;
		}
		const beyond = target && loop.duration > 0 && (target.run.start >= loop.duration || Number.isFinite(target.run.end) && target.run.end > loop.duration);
		const hint = this._id(prefix, 'TimingHint');
		if (hint) {
			hint.hidden = !beyond;
			hint.textContent = !beyond ? '' : target.run.start >= loop.duration
				? 'This motion starts after the loop ends. Extend the loop to see it.'
				: 'The loop ends before this motion finishes. Extend the loop to see the full motion.';
		}
		const include = this._id(prefix, 'IncludeInLoop'); if (include) include.hidden = !beyond;
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
