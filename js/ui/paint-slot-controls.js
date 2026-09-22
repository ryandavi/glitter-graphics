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

	const offsetSpec = CONFIG.ui.sliders.textureOffsetX || {};
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
			input.value = value;
			const valueEl = document.getElementById(`${prefix}TextureOffset${axis}Value`);
			if (valueEl) valueEl.innerHTML = formatUnit(value, 'px');
		}
	});
	const defaults = CONFIG.rendering.textureCoordinates;
	const resetOffset = document.getElementById(`${prefix}ResetTexturePosition`);
	if (resetOffset) {
		resetOffset.disabled = normalized.textureOffsetX === defaults.defaultOffsetX
			&& normalized.textureOffsetY === defaults.defaultOffsetY;
	}
}

// A redesigned effect Offset pair (buildNumberFieldPair, ids `${prefix}OffsetX/Y`)
// bound straight to an effect-data object's offsetX/offsetY. No per-row revert -
// like Transform Position; the module's Enabled switch and "Reset Effects" cover
// resetting. `getData` returns the effect data (may be null when the effect is
// off, in which case edits are ignored). `applyValue(layer, mutate)` is an
// optional hook: when the offset changes the mask footprint (shapes grow their
// mask canvas asymmetrically), the manager wraps the write so the object stays
// anchored — it owns the mutate + re-render; otherwise the write goes straight
// in and `render` runs.
function bindEffectOffsetPair(options) {
	const { prefix, slider = 'shadowOffsetX', getLayer, getData, render, save, applyValue } = options;
	const spec = CONFIG.ui.sliders[slider] || {};
	const clamp = (n) => Math.max(spec.min ?? -Infinity, Math.min(spec.max ?? Infinity, Math.round(n)));
	[['X', 'offsetX'], ['Y', 'offsetY']].forEach(([axis, key]) => {
		const input = document.getElementById(`${prefix}Offset${axis}`);
		if (!input) return;
		const write = (commit) => {
			const layer = getLayer();
			const data = layer && getData(layer);
			if (!data) return;
			const raw = parseFloat(input.value);
			if (Number.isNaN(raw)) return;
			const next = clamp(raw);
			// A geometry mutation may normalize the layer before applying the value.
			// Reacquire the slot so the write always targets live layer state.
			const mutate = () => {
				const liveData = getData(layer);
				if (liveData) liveData[key] = next;
			};
			if (applyValue) {
				applyValue(layer, mutate);
			} else {
				mutate();
				render(layer);
			}
			if (commit) save();
		};
		input.addEventListener('input', () => write(false));
		input.addEventListener('change', () => write(true));
		input.addEventListener('keydown', (event) => {
			if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
			event.preventDefault();
			const step = event.shiftKey ? 10 : 1;
			input.value = String(clamp((parseFloat(input.value || '0') || 0) + (event.key === 'ArrowUp' ? step : -step)));
			input.dispatchEvent(new Event('input'));
			input.dispatchEvent(new Event('change'));
		});
	});
}

function syncEffectOffsetPair(prefix, data) {
	[['X', 'offsetX'], ['Y', 'offsetY']].forEach(([axis, key]) => {
		const input = document.getElementById(`${prefix}Offset${axis}`);
		if (input && document.activeElement !== input) input.value = Math.round((data && data[key]) || 0);
	});
}
