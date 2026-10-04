function syncPaintSlotSourceUI(sourceButton, mode) {
	const slot = sourceButton?.closest('.paint-slot-card') || sourceButton?.closest('.property-card');
	if (!slot) return;
	const normalizedMode = isOptionValue('paintMode', mode) ? mode : 'solid';
	const previousMode = slot.dataset.paintMode;
	slot.dataset.paintMode = normalizedMode;
	if (normalizedMode !== 'none') slot.dataset.lastPaintMode = normalizedMode;

	// Fill slot, on an actual mode change: for Gradient the fill's Opacity row
	// joins the Type/Blend/Angle `.property-set` (no lone Scale to keep it
	// company); for every other mode it lives back in its own set
	// (`.paint-slot-primary-row`). Kept off the drag hot path via the mode-change guard.
	if (slot.dataset.slot === 'fill' && previousMode !== normalizedMode) {
		const opacityRow = slot.querySelector('.paint-slot-opacity');
		const optionSet = slot.querySelector('.effect-gradient-editor');
		if (opacityRow && optionSet) {
			if (normalizedMode === 'gradient') {
				const angle = optionSet.querySelector('.gradient-angle');
				if (angle) angle.after(opacityRow);
				else optionSet.appendChild(opacityRow);
			} else {
				slot.querySelector('.paint-slot-primary-row')?.appendChild(opacityRow);
			}
		}
	}

	// The primary row holds opacity only. Glitter texture scale lives beside
	// anchor and offset inside the glitter-only Advanced disclosure.
	const slotToggle = slot.querySelector(':scope > .property-card-title input[data-paint-slot-toggle]');
	if (slotToggle) slotToggle.checked = normalizedMode !== 'none';
	sourceButton.closest('.segmented-control')?.querySelectorAll('.segmented-option').forEach((button) => {
		const buttonMode = button.dataset.mode;
		if (buttonMode) button.classList.toggle('active', buttonMode === normalizedMode);
	});
	// A slot's parts are the ones inside it that belong to no slot nested in
	// it, plus the Advanced sets that name it as their owner (a second source
	// such as Bevel's Shade keeps its sets in its section's one Advanced).
	const parts = (selector) => [
		...Array.from(slot.querySelectorAll(selector)).filter((element) => !element.dataset.paintSlotOwner && element.closest('.paint-slot-card') === slot),
		...(slot.id ? document.querySelectorAll(`${selector}[data-paint-slot-owner="${slot.id}"]`) : [])
	];
	parts('.glitter-source-glitter').forEach((element) => { element.hidden = normalizedMode !== 'glitter'; });
	parts('.glitter-source-solid').forEach((element) => { element.hidden = normalizedMode !== 'solid'; });
	parts('[data-paint-source-mode]').forEach((element) => {
		element.hidden = element.dataset.paintSourceMode !== normalizedMode;
	});
	const primaryRow = slot.querySelector('.paint-slot-primary-row');
	const opacity = primaryRow?.querySelector('.paint-slot-opacity');
	const hidePrimaryModes = new Set((slot.dataset.hidePrimaryModes || '').split(/\s+/).filter(Boolean));
	if (primaryRow) primaryRow.hidden = normalizedMode === 'none' || hidePrimaryModes.has(normalizedMode) || !opacity;
	// The section's one Advanced holds a set per source: the glitter sets are
	// handled above, and the gradient editor's `.gradient-advanced` (Smoothing)
	// is gradient-only — its render() narrows it further to the Smooth blend.
	// The disclosure itself goes while every set in it is hidden.
	const gradientAdvanced = parts('.gradient-advanced')[0];
	if (gradientAdvanced && normalizedMode !== 'gradient') gradientAdvanced.hidden = true;
	// The gradient editor is two `.property-set` chunks — the stop table and the
	// Type/Blend/Angle options — plus the preview in the Source set (that one is
	// handled by the `[data-paint-source-mode]` loop above).
	const gradientStops = parts('.gradient-stop-set')[0];
	const gradient = parts('.effect-gradient-editor')[0];
	if (gradientStops) gradientStops.hidden = normalizedMode !== 'gradient';
	if (gradient) {
		gradient.hidden = normalizedMode !== 'gradient';
		const editingHere = gradient.contains(document.activeElement) || gradientStops?.contains(document.activeElement);
		if (normalizedMode === 'gradient' && !gradient._liveUpdating && !editingHere) {
			gradient._renderEffectGradient?.();
		}
	}
}

function bindSlotTextureCoordinateControls(options) {
	const { prefix, getLayer, getData, render, save } = options;
	const defaults = CONFIG.rendering.textureCoordinates;
	const getActive = () => {
		const layer = getLayer();
		return layer ? { layer, data: normalizeSlotTextureCoordinates(getData(layer)) } : null;
	};
	const setAnchor = (anchor) => {
		const active = getActive();
		if (!active) return;
		active.data.textureAnchor = anchor;
		syncSlotTextureCoordinateControls(prefix, active.data);
		render(active.layer);
		save();
	};
	document.getElementById(`${prefix}TextureAnchorArtwork`)?.addEventListener('click', () => setAnchor('artwork'));
	document.getElementById(`${prefix}TextureAnchorCanvas`)?.addEventListener('click', () => setAnchor('canvas'));

	const offsetSpec = FIELDS.textureOffsetX;
	const clampOffset = (n) => Math.max(offsetSpec.min, Math.min(offsetSpec.max, Math.round(n)));
	const syncOffsetReset = (data) => {
		const button = document.getElementById(`${prefix}ResetTexturePosition`);
		if (button) {
			button.disabled = (data.textureOffsetX || 0) === defaults.defaultOffsetX
				&& (data.textureOffsetY || 0) === defaults.defaultOffsetY;
		}
	};

	[['X', 'textureOffsetX'], ['Y', 'textureOffsetY']].forEach(([axis, key]) => {
		const input = document.getElementById(`${prefix}TextureOffset${axis}`);
		if (!input) return;
		if (input.type === 'number') {
			// Redesigned panels: real number field (buildNumberFieldPair).
			const write = (commit) => {
				const active = getActive();
				if (!active) return;
				const raw = parseFloat(input.value);
				if (Number.isNaN(raw)) return;
				active.data[key] = clampOffset(raw);
				render(active.layer);
				syncOffsetReset(active.data);
				if (commit) save();
			};
			input.addEventListener('input', () => write(false));
			input.addEventListener('change', () => write(true));
		} else {
			// Other panels: the slider pair (buildPairRow), with per-axis revert.
			bindSlider(input, document.getElementById(`${prefix}TextureOffset${axis}Value`), {
				suffix: 'px',
				resetValue: axis === 'X' ? defaults.defaultOffsetX : defaults.defaultOffsetY,
				resetButton: document.getElementById(`reset${prefix.charAt(0).toUpperCase() + prefix.slice(1)}TextureOffset${axis}`),
				apply: (next) => {
					const active = getActive();
					if (!active) return;
					active.data[key] = next;
					render(active.layer);
				},
				onCommit: save
			});
		}
	});

	// One revert for the Offset pair (Anchor keeps its own). Resets X and Y only.
	// Nested slots (Bevel Shade) do not render this button.
	document.getElementById(`${prefix}ResetTexturePosition`)?.addEventListener('click', () => {
		const active = getActive();
		if (!active) return;
		active.data.textureOffsetX = defaults.defaultOffsetX;
		active.data.textureOffsetY = defaults.defaultOffsetY;
		syncSlotTextureCoordinateControls(prefix, active.data);
		render(active.layer);
		save();
	});
}

function syncSlotTextureCoordinateControls(prefix, data) {
	const normalized = normalizeSlotTextureCoordinates(data);
	if (!normalized) return;
	['artwork', 'canvas'].forEach((anchor) => {
		const button = document.getElementById(`${prefix}TextureAnchor${anchor.charAt(0).toUpperCase() + anchor.slice(1)}`);
		const active = normalized.textureAnchor === anchor;
		button?.classList.toggle('active', active);
		button?.setAttribute('aria-pressed', String(active));
	});
	[['X', normalized.textureOffsetX], ['Y', normalized.textureOffsetY]].forEach(([axis, value]) => {
		const input = document.getElementById(`${prefix}TextureOffset${axis}`);
		if (!input) return;
		if (input.type === 'number') {
			// Don't yank the field out from under someone mid-edit.
			if (document.activeElement !== input) input.value = Math.round(value);
		} else {
			syncSlider(input, value, { unit: 'px' });
		}
	});
	const defaults = CONFIG.rendering.textureCoordinates;
	const resetOffset = document.getElementById(`${prefix}ResetTexturePosition`);
	if (resetOffset) {
		resetOffset.disabled = normalized.textureOffsetX === defaults.defaultOffsetX
			&& normalized.textureOffsetY === defaults.defaultOffsetY;
	}
}


// ===== DECLARED FIELD BINDING =====
//
// One binder for every editable property a layer type declares: its `fields`
// and its paint slots (js/layers/types/, js/paint/paint-slots.js). Controls
// are found by id: a type field's `id`; a slot field's panelPrefix + suffix;
// the slot's toggle (`Enabled`), source modes (`Glitter`, `Solid`, ...),
// glitter chip, color and border options off the same prefix. Every edit goes
// through the manager's host, so a manager keeps only how its layer
// re-renders and records history.
//
// host:
//   type                         layer type whose declarations to bind
//   editor
//   getLayer()                   the active layer of that type, or null
//   ensureSlot(layer, key)       slot data, created from defaults when missing
//   getSlotDefaults(key)         a fresh default slot, shown while it is off
//   apply(layer, mutate, change) run mutate() and re-render; may return a
//                                promise. change.live: mid-gesture, no history.
//                                Otherwise the host records history and
//                                resyncs the panel. change.geometry: the edit
//                                changes the painted footprint. change.ticket:
//                                a live edit's latest-wins ticket (slider.js);
//                                an async apply stops drawing once
//                                ticket.isCurrent() is false.
//   render(layer)                re-render only (gradient and texture drags)
//   commit(layer)                record history after a live gesture ends
//   armPicker(key)               point the glitter gallery at a slot
//   getArmedSlot(layer)          optional: the slot the gallery is armed for
//   onSlotDisabled(layer, key)   optional, runs inside the toggle's mutation
//   afterFieldChange(layer, key, binding)  optional; key is null for type fields

function fieldControlCap(value) {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

// value -> control id suffix for every option of a registry list.
function optionControlSuffixes(name, prefix) {
	return Object.fromEntries(getOptions(name).map(({ value }) => [value, `${prefix}${fieldControlCap(value)}`]));
}

// Enum options a slot role carries, each a group of buttons whose ids are the
// slot's panelPrefix + suffix. Sparkles options are read lazily: the behavior
// list comes from the motion library, which loads after this file.
const SLOT_OPTION_CONTROLS = Object.freeze({
	border: Object.freeze([
		{ key: 'style', geometry: true, read: getBorderStyle, options: optionControlSuffixes('borderStyle', 'Style') },
		{ key: 'edgeStyle', geometry: true, read: getBorderEdgeStyle, options: Object.fromEntries(getOptions('borderEdgeStyle').map(({ value, suffix }) => [value, suffix])) },
		{ key: 'placement', geometry: true, read: getBorderPlacement, options: { outside: 'PositionOutside', center: 'PositionCenter', inside: 'PositionInside' } },
		{ key: 'drawOrder', read: getBorderDrawOrder, options: { behind: 'OrderBehind', front: 'OrderFront' } }
	]),
	sparkles: Object.freeze([
		{ key: 'emitter', read: (data) => data.emitter, get options() { return optionControlSuffixes('sparkleEmitter', 'Emitter'); } },
		{ key: 'style', read: (data) => data.style, get options() { return optionControlSuffixes('sparkleStyle', 'Style'); } },
		{ key: 'behavior', read: (data) => data.behavior, get options() { return optionControlSuffixes('sparkleBehavior', 'Behavior'); } },
		{ key: 'drawOrder', read: (data) => data.drawOrder, options: { behind: 'OrderBehind', front: 'OrderFront' } }
	])
});

function syncSlotOptionButtons(prefix, role, data) {
	(SLOT_OPTION_CONTROLS[role] || []).forEach((option) => {
		const current = option.read(data);
		Object.entries(option.options).forEach(([value, suffix]) => {
			const button = document.getElementById(`${prefix}${suffix}`);
			if (!button) return;
			button.classList.toggle('active', current === value);
			button.setAttribute('aria-pressed', String(current === value));
		});
	});
}

// Sparkles controls beyond the declared fields and option groups: the preset
// grid, the Scatter shape chips, the halo switch and Shuffle.
function bindSparkleSlotControls(host, definition, withLayer) {
	const prefix = definition.panelPrefix;
	const key = definition.key;
	Object.values(SPARKLE_GLYPHS).filter((glyph) => glyph.pickable).forEach((glyph) => {
		document.getElementById(`${prefix}Glyph${fieldControlCap(glyph.id)}`)?.addEventListener('click', () => withLayer((layer) => {
			const data = host.ensureSlot(layer, key);
			const glyphs = { ...data.glyphs };
			if (glyphs[glyph.id]) {
				if (Object.keys(glyphs).length === 1) return undefined;
				delete glyphs[glyph.id];
			} else {
				glyphs[glyph.id] = 1;
			}
			return host.apply(layer, () => { data.glyphs = glyphs; }, {});
		}));
	});
	document.getElementById(`${prefix}Halo`)?.addEventListener('change', (event) => withLayer((layer) => (
		host.apply(layer, () => { host.ensureSlot(layer, key).halo = event.target.checked; }, {})
	)));
	document.getElementById(`${prefix}Shuffle`)?.addEventListener('click', () => withLayer((layer) => (
		host.apply(layer, () => { host.ensureSlot(layer, key).seed = Math.floor(Math.random() * 1e9) + 1; }, {})
	)));
}

function syncSparkleSlotControls(host, definition, layer, data) {
	const prefix = definition.panelPrefix;
	Object.values(SPARKLE_GLYPHS).filter((glyph) => glyph.pickable).forEach((glyph) => {
		const chip = document.getElementById(`${prefix}Glyph${fieldControlCap(glyph.id)}`);
		if (!chip) return;
		const on = Boolean(data.glyphs?.[glyph.id]);
		chip.classList.toggle('active', on);
		chip.setAttribute('aria-pressed', String(on));
	});
	const halo = document.getElementById(`${prefix}Halo`);
	if (halo) halo.checked = Boolean(data.halo);
	document.querySelectorAll(`[data-sparkle-controls="${prefix}"] [data-sparkle-emitter]`).forEach((element) => {
		element.hidden = !element.dataset.sparkleEmitter.split(' ').includes(data.emitter);
	});
	const grid = document.getElementById(`${prefix}Presets`);
	if (grid) {
		GlitterPresetLibrary.renderPresetGrid(grid, SPARKLE_PRESETS, {
			activeId: findSparklePresetId(data),
			contextId: prefix,
			onChoose: (entry) => {
				const active = host.getLayer();
				if (active) host.apply(active, () => SPARKLE_PRESETS.apply(entry, host.ensureSlot(active, definition.key)), {});
			}
		});
	}
}

// Control value -> stored value. Color adjust axes create the identity
// object first so untouched axes stay at identity.
function writeFieldValue(root, binding, controlValue) {
	const value = binding.factor ? controlValue / binding.factor : controlValue;
	if (binding.colorAdjust) {
		const owner = binding.keys.length > 2 ? readFieldPath(root, binding.keys.slice(0, -2)) : root;
		if (owner) ensureSlotColorAdjust(owner)[binding.keys[binding.keys.length - 1]] = value;
		return;
	}
	writeFieldPath(root, binding.keys, value);
}

// Stored value -> control value, falling back to the spec default.
function readFieldControlValue(root, binding) {
	const stored = readFieldPath(root, binding.keys);
	if (stored == null) return binding.spec?.value;
	return binding.factor ? Math.round(stored * binding.factor) : stored;
}

// A number input bound to one field: typing previews, a committed value
// (Enter, blur, a key step) records history.
function bindFieldNumberInput(input, spec, handlers) {
	const clamp = (n) => Math.max(spec?.min ?? -Infinity, Math.min(spec?.max ?? Infinity, Math.round(n)));
	const write = (commit) => {
		const raw = parseFloat(input.value);
		if (Number.isNaN(raw)) return;
		handlers.apply(clamp(raw));
		if (commit) handlers.commit();
	};
	input.addEventListener('input', () => write(false));
	input.addEventListener('change', () => write(true));
}

function bindFieldControl(control, binding, handlers) {
	if (control.type === 'number') {
		bindFieldNumberInput(control, binding.spec, handlers);
		return;
	}
	bindSlider(control, document.getElementById(`${control.id}Value`), {
		resetValue: binding.spec?.value,
		resetButton: document.getElementById(`reset${fieldControlCap(control.id)}`),
		cost: binding.spec?.cost,
		apply: (value, slider, event, ticket) => handlers.apply(value, ticket),
		onCommit: () => handlers.commit()
	});
}

function syncFieldControl(control, value) {
	if (value == null) return;
	if (control.type === 'number') {
		// Don't yank the field out from under someone mid-edit.
		if (document.activeElement !== control) control.value = Math.round(value);
		return;
	}
	syncSlider(control, value);
}

function syncBevelProfileControls(prefix, profileValue) {
	const gloss = getBevelProfile(profileValue).gloss === true;
	[`${prefix}SizeRow`, `${prefix}AngleRow`, `${prefix}AltitudeRow`, `${prefix}ShadeCard`].forEach((id) => {
		const element = document.getElementById(id);
		if (element) element.hidden = gloss;
	});
}

// Color adjust drags retint the slot's glitter chip, and the layers-list
// swatch when the slot is the layer's own fill, without a panel reload.
function refreshSlotFieldSwatch(host, layer, definition, binding) {
	if (!binding.colorAdjust) return;
	const chip = document.getElementById(`${definition.panelPrefix}GlitterChip`);
	const data = readFieldPath(layer, definition.pathKeys);
	if (chip) chip.style.filter = buildCssColorFilter(data?.colorAdjust);
	if (data && data === getLayerFillSlot(layer)) host.editor.refreshLayerSwatchFilter(layer);
}

function bindLayerFieldControls(host) {
	(LAYER_UI_CONFIG[host.type]?.fields || []).forEach((binding) => {
		const control = binding.id && document.getElementById(binding.id);
		if (!control) return;
		bindFieldControl(control, binding, {
			apply: (value, ticket) => {
				const layer = host.getLayer();
				if (!layer) return undefined;
				const result = host.apply(layer, () => writeFieldValue(layer, binding, value), { live: true, geometry: binding.geometry, ticket });
				host.afterFieldChange?.(layer, null, binding);
				return result;
			},
			commit: () => {
				const layer = host.getLayer();
				if (layer) host.commit(layer);
			}
		});
	});
}

function bindPaintSlotControls(host) {
	const byId = (id) => document.getElementById(id);
	(LAYER_UI_CONFIG[host.type]?.paintSlots || []).forEach((definition) => {
		const prefix = definition.panelPrefix;
		if (!prefix) return;
		const key = definition.key;
		// Every slot edit can move the layer onto or off a style preset, so the
		// Style card's highlight and header follow once the edit lands.
		const withLayer = (run) => {
			const layer = host.getLayer();
			if (!layer) return undefined;
			const result = run(layer);
			Promise.resolve(result).then(() => syncStylePresetSelection(host, host.getLayer())).catch(() => {});
			return result;
		};

		byId(`${prefix}Enabled`)?.addEventListener('change', (event) => withLayer((layer) => {
			const enabled = event.target.checked;
			return host.apply(layer, () => {
				toggleSlotEffect(layer, definition, enabled, () => host.getSlotDefaults(key));
				if (!enabled) host.onSlotDisabled?.(layer, key);
			}, { geometry: true });
		}));

		// Changing the source never clears the slot's glitter, so switching back
		// shows the last one picked. A glitter source is never empty.
		(definition.modes || []).forEach((mode) => {
			byId(`${prefix}${fieldControlCap(mode)}`)?.addEventListener('click', () => withLayer((layer) => {
				if (readFieldPath(layer, definition.pathKeys)?.mode === mode) return undefined;
				return host.apply(layer, () => {
					const data = host.ensureSlot(layer, key);
					data.mode = mode;
					if (mode === 'glitter' && !data.glitterId) data.glitterId = getPaintSlotDefaultGlitterId(host.type, definition);
				}, {});
			}));
		});

		[`${prefix}GlitterChip`, `${prefix}GlitterChange`].forEach((id) => {
			byId(id)?.addEventListener('click', () => withLayer(() => host.armPicker(key)));
		});

		// A color drag repaints once per frame; closing the picker applies the
		// final color before it commits.
		const color = byId(`${prefix}Color`);
		color?.addEventListener('input', () => {
			const value = color.value;
			scheduleLiveApply(color.id, 'style', (ticket) => withLayer((layer) => host.apply(layer, () => {
				host.ensureSlot(layer, key).color = value;
			}, { live: true, ticket })));
		});
		color?.addEventListener('change', () => {
			const commit = () => withLayer((layer) => host.commit(layer));
			const settled = flushLiveApply(color.id);
			if (settled) settled.then(commit, commit);
			else commit();
		});

		definition.fields.forEach((binding) => {
			const control = byId(`${prefix}${binding.suffix}`);
			if (!control) return;
			bindFieldControl(control, binding, {
				apply: (value, ticket) => withLayer((layer) => {
					const result = host.apply(layer, () => writeFieldValue(host.ensureSlot(layer, key), binding, value), { live: true, geometry: binding.geometry, ticket });
					refreshSlotFieldSwatch(host, layer, definition, binding);
					host.afterFieldChange?.(layer, key, binding);
					return result;
				}),
				commit: () => withLayer((layer) => host.commit(layer))
			});
		});

		(SLOT_OPTION_CONTROLS[definition.role] || []).forEach((option) => {
			Object.entries(option.options).forEach(([value, suffix]) => {
				byId(`${prefix}${suffix}`)?.addEventListener('click', () => withLayer((layer) => {
					if (option.read(host.ensureSlot(layer, key)) === value) return undefined;
					return host.apply(layer, () => { host.ensureSlot(layer, key)[option.key] = value; }, { geometry: option.geometry });
				}));
			});
		});
		if (definition.role === 'border') {
			byId(`${prefix}FillEnclosed`)?.addEventListener('change', (event) => withLayer((layer) => (
				host.apply(layer, () => { host.ensureSlot(layer, key).fillEnclosed = event.target.checked; }, { geometry: true })
			)));
		}
		if (definition.role === 'bevel') {
			byId(`${prefix}Profile`)?.addEventListener('change', (event) => withLayer((layer) => {
				const profile = getBevelProfile(event.target.value).id;
				syncBevelProfileControls(prefix, profile);
				return host.apply(layer, () => { host.ensureSlot(layer, key).profile = profile; }, { geometry: true });
			}));
		}
		if (definition.role === 'sparkles') bindSparkleSlotControls(host, definition, withLayer);

		bindSlotTextureCoordinateControls({
			prefix,
			getLayer: () => host.getLayer(),
			getData: (layer) => host.ensureSlot(layer, key),
			render: (layer) => host.render(layer),
			save: () => withLayer((layer) => host.commit(layer))
		});
		installEffectGradientEditor({
			prefix,
			getData: () => withLayer((layer) => host.ensureSlot(layer, key)) || null,
			onUpdate: (commit) => withLayer((layer) => {
				host.render(layer);
				if (commit) host.commit(layer);
			})
		});
	});
}

function bindFieldControls(host) {
	bindLayerFieldControls(host);
	bindPaintSlotControls(host);
}

// Highlight the glitter chip of the slot the gallery is armed for.
function syncPaintSlotPickerTargets(host, layer) {
	const armed = layer ? host.getArmedSlot?.(layer) ?? null : null;
	(LAYER_UI_CONFIG[host.type]?.paintSlots || []).forEach((definition) => {
		if (!definition.panelPrefix) return;
		[`${definition.panelPrefix}GlitterChip`, `${definition.panelPrefix}GlitterChange`].forEach((id) => {
			document.getElementById(id)?.classList.toggle('target-active', armed === definition.key);
		});
	});
}

function syncPaintSlotControls(host, layer) {
	const byId = (id) => document.getElementById(id);
	const editor = host.editor;
	syncPaintSlotPickerTargets(host, layer);
	(LAYER_UI_CONFIG[host.type]?.paintSlots || []).forEach((definition) => {
		const prefix = definition.panelPrefix;
		if (!prefix) return;
		const data = readFieldPath(layer, definition.pathKeys);
		const enabled = definition.enabledKeys ? Boolean(readFieldPath(layer, definition.enabledKeys)) : Boolean(data);
		const shown = data || host.getSlotDefaults(definition.key);
		if (data && data.mode === 'glitter' && !data.glitterId) {
			data.glitterId = getPaintSlotDefaultGlitterId(host.type, definition);
		}

		syncPanelEffectToggle(byId(`${prefix}Enabled`), enabled);
		const modeButton = (definition.modes || []).map((mode) => byId(`${prefix}${fieldControlCap(mode)}`)).find(Boolean);
		if (modeButton) syncPaintSlotSourceUI(modeButton, shown.mode || 'solid');

		const chip = byId(`${prefix}GlitterChip`);
		const change = byId(`${prefix}GlitterChange`);
		if (shown.mode === 'glitter' && chip) {
			const glitter = editor.glitterLibrary?.getItemById(shown.glitterId);
			const els = {
				thumbnail: chip,
				name: byId(`${prefix}GlitterLabel`),
				badges: byId(`${prefix}GlitterBadges`),
				size: byId(`${prefix}GlitterSize`),
				frames: byId(`${prefix}GlitterFrames`)
			};
			if (glitter) editor.renderGlitterAssetDisplay(els, glitter, shown.colorAdjust);
			else editor.clearGlitterAssetDisplay(els);
			const title = glitter
				? `Current ${definition.role} glitter: ${glitter.name}. Click to choose another glitter.`
				: `Pick a glitter for the ${definition.role}`;
			chip.title = title;
			if (change) change.title = title;
		}

		const color = byId(`${prefix}Color`);
		if (color) color.value = shown.color || '#000000';

		definition.fields.forEach((binding) => {
			const control = byId(`${prefix}${binding.suffix}`);
			if (control) syncFieldControl(control, readFieldControlValue(shown, binding));
		});

		syncSlotOptionButtons(prefix, definition.role, shown);
		if (definition.role === 'bevel') {
			const profile = byId(`${prefix}Profile`);
			if (profile) profile.value = getBevelProfile(shown.profile).id;
			syncBevelProfileControls(prefix, shown.profile);
		}
		if (definition.role === 'sparkles') syncSparkleSlotControls(host, definition, layer, shown);
		if (definition.role === 'border') {
			const fillEnclosed = byId(`${prefix}FillEnclosed`);
			if (fillEnclosed) fillEnclosed.checked = Boolean(shown.fillEnclosed);
			if (byId(`${prefix}StyleDotted`)) {
				const dotted = getBorderStyle(shown) === 'dotted';
				const row = byId(`${prefix}DotSpacingRow`);
				const spacing = byId(`${prefix}DotSpacing`);
				if (row) row.hidden = !dotted;
				if (spacing) spacing.disabled = !dotted;
			}
		}

		syncSlotTextureCoordinateControls(prefix, shown);
	});
}

function syncLayerFieldControls(host, layer) {
	(LAYER_UI_CONFIG[host.type]?.fields || []).forEach((binding) => {
		const control = binding.id && document.getElementById(binding.id);
		if (control) syncFieldControl(control, readFieldControlValue(layer, binding));
	});
}

// The Style card's header names the matched look, or Custom once any value
// it wrote has been changed (a style is many values, so there's no nearest
// tile to keep highlighted the way a warp keeps its type).
function syncStylePresetSummary(host, activeId) {
	const summary = document.getElementById(`${PANEL_SCHEMAS[host.type].prefix}StyleSummary`);
	if (summary) summary.textContent = activeId ? STYLE_PRESETS[host.type].get(activeId)?.label || '' : 'Custom';
}

// Live edits only move the highlight; the grid itself is rebuilt on load.
function syncStylePresetSelection(host, layer) {
	const library = STYLE_PRESETS[host.type];
	const grid = library && layer && document.getElementById(`${PANEL_SCHEMAS[host.type].prefix}StylePresets`);
	if (!grid) return;
	const activeId = findStylePresetId(layer);
	syncStylePresetSummary(host, activeId);
	GlitterPresetLibrary.setPresetGridActive(grid, library, { activeId, contextId: host.type });
}

// The Style card's preset grid (js/paint/style-presets.js). A preset is one
// edit through the host, so it takes one history step and the host's own
// re-measure / geometry rules; any slot it switches off closes an armed picker.
function syncStylePresetGrid(host, layer) {
	const library = STYLE_PRESETS[host.type];
	const grid = library && document.getElementById(`${PANEL_SCHEMAS[host.type].prefix}StylePresets`);
	if (!grid) return;
	setStylePresetGlitterResolver((glitterId) => host.editor.glitterLibrary?.getItemById(glitterId)?.url || null);
	setStylePresetPreviewResolver((kind, entry) => (kind === 'sticker' ? null : getStylePresetPreview(host.editor, STYLE_PRESET_TARGETS[kind], entry)));
	const activeId = findStylePresetId(layer);
	syncStylePresetSummary(host, activeId);
	GlitterPresetLibrary.renderPresetGrid(grid, library, {
		activeId,
		contextId: host.type,
		onChoose: (entry) => {
			const target = host.getLayer();
			if (!target || !host.editor.canEditLayer(target, { notify: true })) return;
			host.apply(target, () => library.apply(entry, {
				layer: target,
				context: {
					getSlotDefaults: (key) => host.getSlotDefaults(key),
					glitterAvailable: (glitterId) => Boolean(host.editor.glitterLibrary?.getItemById(glitterId)),
					onSlotDisabled: (key) => host.onSlotDisabled?.(target, key)
				}
			}), { geometry: true });
		}
	});
}

function syncFieldControls(host, layer) {
	if (!layer) return;
	syncLayerFieldControls(host, layer);
	syncPaintSlotControls(host, layer);
	syncStylePresetGrid(host, layer);
}
