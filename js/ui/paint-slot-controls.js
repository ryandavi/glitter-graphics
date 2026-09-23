function syncPaintSlotSourceUI(sourceButton, mode) {
	const slot = sourceButton?.closest('.paint-slot-card') || sourceButton?.closest('.subsection-content-group');
	if (!slot) return;
	const normalizedMode = isOptionValue('paintMode', mode) ? mode : 'solid';
	const previousMode = slot.dataset.paintMode;
	slot.dataset.paintMode = normalizedMode;
	if (normalizedMode !== 'none') slot.dataset.lastPaintMode = normalizedMode;

	// Fill slot, on an actual mode change: for Gradient the fill's Opacity row
	// joins the Type/Blend/Angle `.property-set` (no lone Scale to keep it
	// company); for every other mode it lives back in `.paint-slot-primary-row`
	// beside Scale. Kept off the drag hot path via the mode-change guard.
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
	const slotToggle = slot.querySelector(':scope > .subsection-title input[data-paint-slot-toggle]');
	if (slotToggle) slotToggle.checked = normalizedMode !== 'none';
	sourceButton.closest('.segmented-control')?.querySelectorAll('.segmented-option').forEach((button) => {
		const buttonMode = button.dataset.mode;
		if (buttonMode) button.classList.toggle('active', buttonMode === normalizedMode);
	});
	slot.querySelectorAll('.glitter-source-glitter').forEach((element) => { element.hidden = normalizedMode !== 'glitter'; });
	slot.querySelectorAll('.glitter-source-solid').forEach((element) => { element.hidden = normalizedMode !== 'solid'; });
	slot.querySelectorAll('[data-paint-source-mode]').forEach((element) => {
		element.hidden = element.dataset.paintSourceMode !== normalizedMode;
	});
	const primaryRow = slot.querySelector('.paint-slot-primary-row');
	const opacity = primaryRow?.querySelector('.paint-slot-opacity');
	const hidePrimaryModes = new Set((slot.dataset.hidePrimaryModes || '').split(/\s+/).filter(Boolean));
	if (primaryRow) primaryRow.hidden = normalizedMode === 'none' || hidePrimaryModes.has(normalizedMode) || !opacity;
	// Two module-level Advanced disclosures share the slot: the glitter source's
	// own (color adjust / texture position) is glitter-only; the gradient
	// editor's `.gradient-advanced` (Smoothing) is gradient-only — and the
	// editor's render() narrows it further to the Smooth blend.
	const advanced = slot.querySelector('.advanced-disclosure.glitter-source-glitter');
	if (advanced) advanced.hidden = normalizedMode !== 'glitter';
	const gradientAdvanced = slot.querySelector('.gradient-advanced');
	if (gradientAdvanced && normalizedMode !== 'gradient') gradientAdvanced.hidden = true;
	const flatAdvanced = slot.querySelector('.paint-slot-advanced-flat');
	if (flatAdvanced) flatAdvanced.hidden = normalizedMode !== 'glitter';
	// The gradient editor is two `.property-set` chunks — the stop table and the
	// Type/Blend/Angle options — plus the preview in the Source set (that one is
	// handled by the `[data-paint-source-mode]` loop above).
	const gradientStops = slot.querySelector('.gradient-stop-set');
	const gradient = slot.querySelector('.effect-gradient-editor');
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

	const offsetSpec = FIELDS.textureOffsetX || {};
	const clampOffset = (n) => Math.max(offsetSpec.min ?? -500, Math.min(offsetSpec.max ?? 500, Math.round(n)));
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
			input.addEventListener('keydown', (event) => {
				if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
				event.preventDefault();
				const step = event.shiftKey ? 10 : 1;
				const current = parseFloat(input.value || '0') || 0;
				input.value = String(clampOffset(current + (event.key === 'ArrowUp' ? step : -step)));
				input.dispatchEvent(new Event('input'));
				input.dispatchEvent(new Event('change'));
			});
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
	// Only the redesigned panels render this button.
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
//                                changes the painted footprint.
//   render(layer)                re-render only (gradient and texture drags)
//   commit(layer)                record history after a live gesture ends
//   armPicker(key)               point the glitter gallery at a slot
//   getArmedSlot(layer)          optional: the slot the gallery is armed for
//   onSlotDisabled(layer, key)   optional, runs inside the toggle's mutation
//   afterFieldChange(layer, key, binding)  optional; key is null for type fields

const BORDER_OPTION_CONTROLS = Object.freeze([
	{ key: 'style', geometry: true, read: (data) => (data?.style === 'dotted' ? 'dotted' : 'solid'), options: { solid: 'StyleSolid', dotted: 'StyleDotted' } },
	{ key: 'edgeStyle', geometry: true, read: getBorderEdgeStyle, options: { round: 'EdgeRounded', hard: 'EdgeHard' } },
	{ key: 'placement', geometry: true, read: getBorderPlacement, options: { outside: 'PositionOutside', center: 'PositionCenter', inside: 'PositionInside' } },
	{ key: 'drawOrder', read: getBorderDrawOrder, options: { behind: 'OrderBehind', front: 'OrderFront' } }
]);

function fieldControlCap(value) {
	return value.charAt(0).toUpperCase() + value.slice(1);
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
// (Enter, blur, a step) records history. Arrow keys step by 1, Shift by 10.
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
	input.addEventListener('keydown', (event) => {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		event.stopImmediatePropagation();
		const step = event.shiftKey ? 10 : 1;
		input.value = String(clamp((parseFloat(input.value || '0') || 0) + (event.key === 'ArrowUp' ? step : -step)));
		input.dispatchEvent(new Event('input'));
		input.dispatchEvent(new Event('change'));
	});
}

function bindFieldControl(control, binding, handlers) {
	if (control.type === 'number') {
		bindFieldNumberInput(control, binding.spec, handlers);
		return;
	}
	bindSlider(control, document.getElementById(`${control.id}Value`), {
		resetValue: binding.spec?.value,
		resetButton: document.getElementById(`reset${fieldControlCap(control.id)}`),
		apply: (value) => handlers.apply(value),
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
			apply: (value) => {
				const layer = host.getLayer();
				if (!layer) return undefined;
				const result = host.apply(layer, () => writeFieldValue(layer, binding, value), { live: true, geometry: binding.geometry });
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
		const withLayer = (run) => {
			const layer = host.getLayer();
			return layer ? run(layer) : undefined;
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

		const color = byId(`${prefix}Color`);
		color?.addEventListener('input', () => withLayer((layer) => host.apply(layer, () => {
			host.ensureSlot(layer, key).color = color.value;
		}, { live: true })));
		color?.addEventListener('change', () => withLayer((layer) => host.commit(layer)));

		definition.fields.forEach((binding) => {
			const control = byId(`${prefix}${binding.suffix}`);
			if (!control) return;
			bindFieldControl(control, binding, {
				apply: (value) => withLayer((layer) => {
					const result = host.apply(layer, () => writeFieldValue(host.ensureSlot(layer, key), binding, value), { live: true, geometry: binding.geometry });
					refreshSlotFieldSwatch(host, layer, definition, binding);
					host.afterFieldChange?.(layer, key, binding);
					return result;
				}),
				commit: () => withLayer((layer) => host.commit(layer))
			});
		});

		if (definition.role === 'border') {
			BORDER_OPTION_CONTROLS.forEach((option) => {
				Object.entries(option.options).forEach(([value, suffix]) => {
					byId(`${prefix}${suffix}`)?.addEventListener('click', () => withLayer((layer) => {
						if (option.read(host.ensureSlot(layer, key)) === value) return undefined;
						return host.apply(layer, () => { host.ensureSlot(layer, key)[option.key] = value; }, { geometry: option.geometry });
					}));
				});
			});
		}

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
			const glitter = editor.glitterManager?.getItemById(shown.glitterId);
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

		if (definition.role === 'border') {
			BORDER_OPTION_CONTROLS.forEach((option) => {
				const current = option.read(shown);
				Object.entries(option.options).forEach(([value, suffix]) => {
					byId(`${prefix}${suffix}`)?.classList.toggle('active', current === value);
				});
			});
			if (byId(`${prefix}StyleDotted`)) {
				const dotted = BORDER_OPTION_CONTROLS[0].read(shown) === 'dotted';
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

function syncFieldControls(host, layer) {
	if (!layer) return;
	syncLayerFieldControls(host, layer);
	syncPaintSlotControls(host, layer);
}
