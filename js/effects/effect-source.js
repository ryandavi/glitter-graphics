function resolveEffectPaintSource(effectData, options = {}) {
	if (!effectData) {
		return null;
	}

	if (options.allowNone && effectData.mode === 'none') {
		return null;
	}

	const glitterId = options.glitterId ?? effectData.glitterId ?? null;
	const scale = options.scale ?? effectData.scale ?? 100;
	const opacity = options.opacity ?? effectData.opacity ?? 100;
	const colorAdjust = options.colorAdjust ?? effectData.colorAdjust;
	const textureAnchor = options.textureAnchor ?? effectData.textureAnchor;
	const textureOffsetX = options.textureOffsetX ?? effectData.textureOffsetX;
	const textureOffsetY = options.textureOffsetY ?? effectData.textureOffsetY;
	const solidColor = options.solidColor ?? effectData.color ?? '#000000';
	const glitterAvailable = typeof options.glitterAvailable === 'function'
		? options.glitterAvailable(glitterId)
		: options.glitterAvailable !== false;
	const wantsGlitter = effectData.mode
		? effectData.mode === 'glitter'
		: Boolean(glitterId);

	if (effectData.mode === 'gradient') {
		return {
			mode: 'gradient',
			gradient: normalizeEffectGradient(effectData.gradient),
			opacity: opacity / 100
		};
	}

	if (wantsGlitter && glitterId && glitterAvailable) {
		return {
			mode: 'glitter',
			glitterId,
			scale,
			opacity: opacity / 100,
			colorAdjust,
			textureAnchor,
			textureOffsetX,
			textureOffsetY
		};
	}

	return {
		mode: 'solid',
		color: solidColor,
		opacity: opacity / 100
	};
}

function normalizeEffectGradient(gradient) {
	const defaults = CONFIG.rendering.gradient;
	const source = gradient || defaults;
	const stops = Array.isArray(source.stops) && source.stops.length >= 2
		? source.stops
		: defaults.stops;
	const smoothing = CONFIG.ui.sliders.gradientSmoothing;
	const subdivisions = Math.round(Number(source.smoothSubdivisions ?? defaults.smoothSubdivisions));
	return {
		type: source.type === 'radial' ? 'radial' : 'linear',
		angle: ((Number(source.angle ?? defaults.angle) % 360) + 360) % 360,
		interpolation: ['linear', 'smooth', 'steps'].includes(source.interpolation)
			? source.interpolation
			: defaults.interpolation,
		smoothSubdivisions: Number.isFinite(subdivisions)
			? Math.max(smoothing.min, Math.min(smoothing.max, subdivisions))
			: defaults.smoothSubdivisions,
		stops: stops.map((stop) => ({
			offset: Math.max(0, Math.min(1, Number(stop.offset))),
			color: /^#[0-9a-f]{6}$/i.test(stop.color || '') ? stop.color : '#000000',
			alpha: Math.max(0, Math.min(1, Number(stop.alpha)))
		})).sort((a, b) => a.offset - b.offset)
	};
}

function parseHexColor(color) {
	const hex = color.slice(1);
	return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

// Interpolation is implemented purely as stop-list expansion so the CSS
// preview and the canvas export consume identical literal stops — the feature
// cannot diverge between the two paint paths.
//   linear — the stops as authored (native gradient blending).
//   smooth — smoothstep-eased blend, approximated with subdivided stops.
//   steps  — each stop's color holds until the next stop (hard bands).
function getEffectGradientRenderStops(gradient) {
	const data = normalizeEffectGradient(gradient);
	const stops = data.stops;
	if (data.interpolation === 'steps') {
		const expanded = [];
		stops.forEach((stop, index) => {
			expanded.push({ offset: stop.offset, color: stop.color, alpha: stop.alpha });
			const next = stops[index + 1];
			if (next) expanded.push({ offset: next.offset, color: stop.color, alpha: stop.alpha });
		});
		return expanded;
	}
	if (data.interpolation === 'smooth') {
		const segments = data.smoothSubdivisions;
		const expanded = [];
		stops.forEach((stop, index) => {
			expanded.push({ offset: stop.offset, color: stop.color, alpha: stop.alpha });
			const next = stops[index + 1];
			if (!next || next.offset - stop.offset <= 0.001) return;
			const from = parseHexColor(stop.color);
			const to = parseHexColor(next.color);
			for (let step = 1; step < segments; step++) {
				const t = step / segments;
				const eased = t * t * (3 - 2 * t);
				const channel = (i) => Math.round(from[i] + (to[i] - from[i]) * eased);
				expanded.push({
					offset: stop.offset + (next.offset - stop.offset) * t,
					color: `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`,
					alpha: stop.alpha + (next.alpha - stop.alpha) * eased
				});
			}
		});
		return expanded;
	}
	return stops;
}

// Linear sample of the authored stops at an offset — used to seed a new stop
// added from the editor's preview bar so it appears without a visible change.
function sampleEffectGradientAt(gradient, offset) {
	const stops = normalizeEffectGradient(gradient).stops;
	let before = stops[0];
	let after = stops[stops.length - 1];
	stops.forEach((stop) => {
		if (stop.offset <= offset) before = stop;
	});
	for (let i = stops.length - 1; i >= 0; i--) {
		if (stops[i].offset >= offset) after = stops[i];
	}
	const span = after.offset - before.offset;
	const t = span > 0 ? (offset - before.offset) / span : 0;
	const from = parseHexColor(before.color);
	const to = parseHexColor(after.color);
	return {
		color: `#${[0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * t).toString(16).padStart(2, '0')).join('')}`,
		alpha: before.alpha + (after.alpha - before.alpha) * t
	};
}

function getEffectGradientGeometry(gradient, rect) {
	const data = normalizeEffectGradient(gradient);
	const cx = rect.x + rect.width / 2;
	const cy = rect.y + rect.height / 2;
	if (data.type === 'radial') {
		return { ...data, cx, cy, radius: Math.hypot(rect.width, rect.height) / 2 };
	}
	const radians = data.angle * Math.PI / 180;
	const dx = Math.sin(radians);
	const dy = -Math.cos(radians);
	const length = Math.abs(rect.width * dx) + Math.abs(rect.height * dy);
	return {
		...data,
		x0: cx - dx * length / 2,
		y0: cy - dy * length / 2,
		x1: cx + dx * length / 2,
		y1: cy + dy * length / 2
	};
}

// One CSS stop list shared by the layer paint and the editor's preview bar.
function effectGradientCssStops(gradient) {
	return getEffectGradientRenderStops(gradient).map((stop) => {
		const rgb = parseHexColor(stop.color);
		return `rgba(${rgb.join(', ')}, ${stop.alpha}) ${Math.round(stop.offset * 1000) / 10}%`;
	}).join(', ');
}

function effectGradientToCss(gradient) {
	const data = normalizeEffectGradient(gradient);
	const stops = effectGradientCssStops(data);
	return data.type === 'radial'
		? `radial-gradient(circle at center, ${stops})`
		: `linear-gradient(${data.angle}deg, ${stops})`;
}

function createEffectCanvasGradient(ctx, gradient, rect) {
	const data = getEffectGradientGeometry(gradient, rect);
	const paint = data.type === 'radial'
		? ctx.createRadialGradient(data.cx, data.cy, 0, data.cx, data.cy, data.radius)
		: ctx.createLinearGradient(data.x0, data.y0, data.x1, data.y1);
	getEffectGradientRenderStops(data).forEach((stop) => {
		const alpha = Math.round(stop.alpha * 255).toString(16).padStart(2, '0');
		paint.addColorStop(stop.offset, `${stop.color}${alpha}`);
	});
	return paint;
}

function syncPaintSlotSourceUI(sourceButton, mode) {
	const slot = sourceButton?.closest('.paint-slot-card') || sourceButton?.closest('.subsection-content-group');
	if (!slot) return;
	const normalizedMode = ['image', 'none', 'glitter', 'solid', 'gradient'].includes(mode) ? mode : 'solid';
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

	// (`.paint-slot-primary-row` still holds Scale + Opacity for Glitter, a lone
	// Opacity for Solid; for Gradient it collapses — Opacity moved out above.)
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
	const scale = primaryRow?.querySelector('.paint-slot-scale');
	if (scale) scale.hidden = normalizedMode !== 'glitter';
	const opacity = primaryRow?.querySelector('.paint-slot-opacity');
	const hidePrimaryModes = new Set((slot.dataset.hidePrimaryModes || '').split(/\s+/).filter(Boolean));
	if (primaryRow) primaryRow.hidden = normalizedMode === 'none' || hidePrimaryModes.has(normalizedMode) || (normalizedMode !== 'glitter' && !opacity);
	// Two module-level Advanced disclosures share the slot: the glitter source's
	// own (colour adjust / texture position) is glitter-only; the gradient
	// editor's `.gradient-advanced` (Smoothing) is gradient-only — and the
	// editor's render() narrows it further to the Smooth blend.
	const advanced = slot.querySelector('.advanced-disclosure:not(.gradient-advanced)');
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

function installEffectGradientEditor(options) {
	const solid = document.getElementById(`${options.prefix}UseColor`) || document.getElementById(`${options.prefix}Solid`);
	const group = solid?.closest('.segmented-control');
	if (!group || document.getElementById(`${options.prefix}Gradient`)) return;
	const button = document.createElement('button');
	button.type = 'button';
	button.id = `${options.prefix}Gradient`;
	button.className = 'segmented-option';
	button.dataset.mode = 'gradient';
	button.textContent = 'Gradient';
	group.appendChild(button);
	const fragment = document.getElementById('tpl-gradient-editor').content.cloneNode(true);
	const source = group.parentElement; // .paint-slot-source
	const slotCard = group.closest('.paint-slot-card') || group.closest('.subsection-content-group');
	const paintMain = source.closest('.paint-slot-main') || slotCard;
	const previewBar = fragment.querySelector('.gradient-preview');
	const stopSet = fragment.querySelector('.gradient-stop-set');
	const panel = fragment.querySelector('.effect-gradient-editor');
	const advanced = fragment.querySelector('.gradient-advanced');

	// Lay the editor out the way the glitter source is: NO set inside a set.
	//   - the preview bar joins the Source `.property-set` as a mode-toggled
	//     display block (like `.asset-info`);
	//   - the stop table and the Type/Blend/Angle(/Opacity) options are two
	//     sibling `.property-set` chunks of `.paint-slot-main`, hairline-divided
	//     by the shared `.property-set + .property-set` rule (no manual divider);
	//   - the Smoothing disclosure sits at module level next to the glitter
	//     Advanced.
	source.appendChild(previewBar);
	const primarySet = slotCard?.querySelector('.paint-slot-primary-row')?.closest('.property-set');
	if (primarySet) { primarySet.before(stopSet); primarySet.before(panel); }
	else { paintMain.appendChild(stopSet); paintMain.appendChild(panel); }
	const moduleAdvanced = slotCard?.querySelector('.advanced-disclosure:not(.gradient-advanced)');
	if (advanced) (moduleAdvanced ? moduleAdvanced.before(advanced) : slotCard?.appendChild(advanced));
	const defaults = CONFIG.rendering.gradient;
	const update = (commit) => {
		const data = options.getData();
		if (!data) return;
		data.mode = 'gradient';
		if (commit) data.gradient = normalizeEffectGradient(data.gradient);
		panel._liveUpdating = !commit;
		try {
			syncPaintSlotSourceUI(button, data.mode);
			options.onUpdate(commit);
		} finally {
			panel._liveUpdating = false;
		}
	};
	const preview = previewBar;
	const bar = previewBar.querySelector('.gradient-preview-bar');
	const markers = previewBar.querySelector('.gradient-preview-markers');
	const list = stopSet.querySelector('.gradient-stops');
	const angleRow = panel.querySelector('.gradient-angle');
	const angleInput = angleRow.querySelector('input');
	const angleValue = angleRow.querySelector('.gradient-angle-value');
	const angleReset = angleRow.querySelector('.gradient-angle-reset');
	const typeReset = panel.querySelector('.gradient-type-reset');
	const blendReset = panel.querySelector('.gradient-blend-reset');
	const smoothingRow = advanced?.querySelector('.gradient-smoothing');
	const smoothingInput = smoothingRow?.querySelector('input');
	const smoothingValue = smoothingRow?.querySelector('.gradient-smoothing-value');
	const smoothingReset = smoothingRow?.querySelector('.gradient-smoothing-reset');
	const editorBehavior = CONFIG.ui.gradientEditor;

	// Which stop the list rows and one bar handle highlight. Transient UI state
	// only: never serialized; re-clamped whenever the stop count changes.
	panel._selectedStop = 0;
	const applySelection = () => {
		Array.from(markers.children).forEach((marker) => marker.classList.toggle('is-selected', Number(marker.dataset.index) === panel._selectedStop));
		Array.from(list.children).forEach((row) => row.classList.toggle('is-selected', Number(row.dataset.index) === panel._selectedStop));
	};
	const getSortedStopIndex = (stops, targetIndex) => stops
		.map((stop, index) => ({ stop, index }))
		.sort((a, b) => a.stop.offset - b.stop.offset || a.index - b.index)
		.findIndex((entry) => entry.index === targetIndex);
	const focusSelectedMarker = () => markers.children[panel._selectedStop]?.focus({ preventScroll: true });

	// Light refresh used during marker drags: repaint the strip and reposition
	// the existing handles without rebuilding them (rebuilding would break
	// pointer capture on the dragged handle).
	const syncPreview = (gradient) => {
		bar.style.backgroundImage = `linear-gradient(90deg, ${effectGradientCssStops(gradient)})`;
		Array.from(markers.children).forEach((marker) => {
			const stop = gradient.stops[Number(marker.dataset.index)];
			if (!stop) return;
			marker.style.left = `${stop.offset * 100}%`;
			marker.style.setProperty('--stop-color', stop.color);
			marker.setAttribute('aria-valuenow', String(Math.round(stop.offset * 100)));
			marker.setAttribute('aria-valuetext', `${Math.round(stop.offset * 100)}%`);
		});
	};
	const render = () => {
		const data = options.getData();
		if (!data) return;
		data.gradient = normalizeEffectGradient(data.gradient);
		const gradient = data.gradient;
		const isGradient = data.mode === 'gradient';
		panel.hidden = !isGradient;
		stopSet.hidden = !isGradient;
		panel._selectedStop = Math.max(0, Math.min(gradient.stops.length - 1, panel._selectedStop));

		panel.querySelectorAll('[data-type]').forEach((item) => item.classList.toggle('active', item.dataset.type === gradient.type));
		panel.querySelectorAll('[data-interpolation]').forEach((item) => item.classList.toggle('active', item.dataset.interpolation === gradient.interpolation));
		typeReset.disabled = gradient.type === defaults.type;
		blendReset.disabled = gradient.interpolation === defaults.interpolation;

		// Angle steers a linear gradient only; a radial one has no direction.
		angleRow.hidden = gradient.type !== 'linear';
		angleInput.value = gradient.angle;
		angleValue.innerHTML = formatUnit(gradient.angle, '\u00b0');
		angleReset.disabled = gradient.angle === defaults.angle;

		// Smoothing only feeds the 'smooth' blend's subdivided approximation, so
		// the whole Advanced disclosure appears only in that mode.
		advanced.hidden = gradient.interpolation !== 'smooth';
		smoothingInput.value = gradient.smoothSubdivisions;
		smoothingValue.innerHTML = formatUnit(gradient.smoothSubdivisions, '×');
		smoothingReset.disabled = gradient.smoothSubdivisions === defaults.smoothSubdivisions;

		markers.replaceChildren(...gradient.stops.map((stop, index) => {
			const marker = document.createElement('span');
			marker.className = 'gradient-preview-stop';
			marker.dataset.index = String(index);
			marker.tabIndex = 0;
			marker.setAttribute('role', 'slider');
			marker.setAttribute('aria-label', `Gradient stop ${index + 1} position`);
			marker.setAttribute('aria-valuemin', '0');
			marker.setAttribute('aria-valuemax', '100');
			marker.setAttribute('aria-orientation', 'horizontal');
			return marker;
		}));
		syncPreview(gradient);

		list.replaceChildren(...gradient.stops.map((stop, index) => {
			const row = document.getElementById('tpl-gradient-stop').content.firstElementChild.cloneNode(true);
			row.dataset.index = String(index);
			const inputs = row.querySelectorAll('input');
			const [colorInput, offsetInput, alphaInput] = inputs;
			const hex = row.querySelector('.gradient-stop-hex');
			const removeButton = row.querySelector('.gradient-stop-remove');
			colorInput.value = stop.color;
			hex.textContent = stop.color.toUpperCase();
			offsetInput.value = Math.round(stop.offset * 100);
			alphaInput.value = Math.round(stop.alpha * 100);
			removeButton.disabled = gradient.stops.length <= 2;
			const select = () => { panel._selectedStop = index; applySelection(); };
			colorInput.addEventListener('input', () => { stop.color = colorInput.value; hex.textContent = colorInput.value.toUpperCase(); select(); syncPreview(gradient); update(false); });
			offsetInput.addEventListener('input', () => { stop.offset = Math.max(0, Math.min(1, Number(offsetInput.value) / 100)); select(); syncPreview(gradient); update(false); });
			alphaInput.addEventListener('input', () => { stop.alpha = Math.max(0, Math.min(1, Number(alphaInput.value) / 100)); select(); syncPreview(gradient); update(false); });
			inputs.forEach((input) => input.addEventListener('change', () => { update(true); render(); }));
			inputs.forEach((input) => input.addEventListener('focus', select));
			removeButton.addEventListener('click', () => {
				if (gradient.stops.length <= 2) return;
				gradient.stops.splice(index, 1);
				if (panel._selectedStop > index) panel._selectedStop -= 1;
				update(true);
				render();
			});
			return row;
		}));
		applySelection();
	};
	// Direct manipulation on the strip: drag a handle to move its stop, click
	// bare strip to insert a stop pre-seeded with the sampled color/opacity.
	preview.addEventListener('pointerdown', (event) => {
		let data = options.getData();
		if (!data) return;
		event.preventDefault();
		data.gradient = normalizeEffectGradient(data.gradient);
		const rect = bar.getBoundingClientRect();
		const offsetAt = (pointerEvent) => {
			const raw = Math.max(0, Math.min(1, (pointerEvent.clientX - rect.left) / rect.width));
			if (pointerEvent.shiftKey) {
				return Math.round(raw / editorBehavior.snapStep) * editorBehavior.snapStep;
			}
			const magneticOffset = editorBehavior.magneticOffsets.reduce((closest, offset) => (
				Math.abs(offset - raw) < Math.abs(closest - raw) ? offset : closest
			));
			return Math.abs(magneticOffset - raw) * rect.width <= editorBehavior.magneticThresholdPx
				? magneticOffset
				: raw;
		};
		const handle = event.target.closest('.gradient-preview-stop');
		let stop;
		let stopIndex;
		let added = false;
		if (handle) {
			stopIndex = Number(handle.dataset.index);
			panel._selectedStop = stopIndex;
			stop = data.gradient.stops[stopIndex];
			if (event.altKey) {
				data.gradient.stops.splice(stopIndex + 1, 0, { ...stop });
				stopIndex += 1;
				panel._selectedStop = stopIndex;
				update(false);
				render();
				data = options.getData();
				stop = data?.gradient?.stops?.[stopIndex];
				added = true;
			}
			applySelection();
		} else {
			const offset = offsetAt(event);
			stop = { offset, ...sampleEffectGradientAt(data.gradient, offset) };
			data.gradient.stops.push(stop);
			update(false);
			render();
			data = options.getData();
			if (!data) return;
			stop = data.gradient.stops.find((entry) => entry.offset === stop.offset && entry.color === stop.color) || stop;
			stopIndex = Math.max(0, data.gradient.stops.indexOf(stop));
			panel._selectedStop = stopIndex;
			stop = data.gradient.stops[stopIndex];
			added = true;
			applySelection();
		}
		if (!stop) return;
		let moved = false;
		const onMove = (moveEvent) => {
			data = options.getData();
			stop = data?.gradient?.stops?.[stopIndex];
			if (!stop) return;
			stop.offset = offsetAt(moveEvent);
			moved = true;
			syncPreview(data.gradient);
			update(false);
		};
		const onUp = () => {
			preview.removeEventListener('pointermove', onMove);
			preview.removeEventListener('pointerup', onUp);
			preview.removeEventListener('pointercancel', onUp);
			if (moved || added) {
				const stops = options.getData()?.gradient?.stops;
				if (stops?.[stopIndex]) panel._selectedStop = getSortedStopIndex(stops, stopIndex);
				update(true);
				render();
			}
		};
		preview.setPointerCapture(event.pointerId);
		preview.addEventListener('pointermove', onMove);
		preview.addEventListener('pointerup', onUp);
		preview.addEventListener('pointercancel', onUp);
	});
	preview.addEventListener('keydown', (event) => {
		const handle = event.target.closest('.gradient-preview-stop');
		if (!handle) return;
		const isArrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key);
		const isDelete = event.key === 'Delete' || event.key === 'Backspace';
		if (!isArrow && !isDelete) return;
		event.preventDefault();
		event.stopPropagation();

		const data = options.getData();
		if (!data) return;
		data.gradient = normalizeEffectGradient(data.gradient);
		const index = Number(handle.dataset.index);
		if (isDelete) {
			if (data.gradient.stops.length <= 2) return;
			data.gradient.stops.splice(index, 1);
			panel._selectedStop = Math.min(index, data.gradient.stops.length - 1);
		} else {
			const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
			const step = event.shiftKey ? editorBehavior.snapStep : editorBehavior.keyboardStep;
			const stop = data.gradient.stops[index];
			stop.offset = Math.max(0, Math.min(1, Math.round((stop.offset + direction * step) * 1000) / 1000));
			panel._selectedStop = getSortedStopIndex(data.gradient.stops, index);
		}
		update(true);
		render();
		focusSelectedMarker();
	});
	panel._renderEffectGradient = render;
	button.addEventListener('click', () => { update(true); render(); });

	// One helper for every "back to the CONFIG default" affordance in the editor.
	const resetField = (key) => {
		const data = options.getData();
		if (!data) return;
		data.gradient = normalizeEffectGradient(data.gradient);
		data.gradient[key] = defaults[key];
		update(true);
		render();
	};
	panel.querySelectorAll('[data-type]').forEach((item) => item.addEventListener('click', () => {
		const data = options.getData();
		if (!data) return;
		data.gradient = normalizeEffectGradient(data.gradient);
		data.gradient.type = item.dataset.type;
		update(true);
		render();
	}));
	panel.querySelectorAll('[data-interpolation]').forEach((item) => item.addEventListener('click', () => {
		const data = options.getData();
		if (!data) return;
		data.gradient = normalizeEffectGradient(data.gradient);
		data.gradient.interpolation = item.dataset.interpolation;
		update(true);
		render();
	}));
	typeReset.addEventListener('click', () => resetField('type'));
	blendReset.addEventListener('click', () => resetField('interpolation'));

	angleInput.addEventListener('input', () => {
		const data = options.getData();
		if (!data) return;
		data.gradient.angle = Number(angleInput.value);
		angleValue.innerHTML = formatUnit(data.gradient.angle, '\u00b0');
		update(false);
	});
	angleInput.addEventListener('change', () => update(true));
	angleReset.addEventListener('click', () => resetField('angle'));

	smoothingInput.addEventListener('input', () => {
		const data = options.getData();
		if (!data) return;
		data.gradient.smoothSubdivisions = Number(smoothingInput.value);
		smoothingValue.innerHTML = formatUnit(data.gradient.smoothSubdivisions, '×');
		update(false);
	});
	smoothingInput.addEventListener('change', () => update(true));
	smoothingReset.addEventListener('click', () => resetField('smoothSubdivisions'));

	stopSet.querySelector('.gradient-add').addEventListener('click', () => {
		const data = options.getData();
		if (!data) return;
		data.gradient = normalizeEffectGradient(data.gradient);
		const selectedIndex = Math.max(0, Math.min(data.gradient.stops.length - 1, panel._selectedStop));
		const adjacentIndex = selectedIndex < data.gradient.stops.length - 1
			? selectedIndex + 1
			: selectedIndex - 1;
		const offset = (data.gradient.stops[selectedIndex].offset + data.gradient.stops[adjacentIndex].offset) / 2;
		data.gradient.stops.push({ offset, ...sampleEffectGradientAt(data.gradient, offset) });
		panel._selectedStop = selectedIndex < adjacentIndex ? adjacentIndex : selectedIndex;
		update(true);
		render();
	});
	// Reverse: mirror every stop's position; normalize re-sorts on commit.
	stopSet.querySelector('.gradient-reverse').addEventListener('click', () => {
		const data = options.getData();
		if (!data) return;
		data.gradient = normalizeEffectGradient(data.gradient);
		data.gradient.stops.forEach((stop) => { stop.offset = 1 - stop.offset; });
		update(true);
		render();
	});

	// Make the Angle + Smoothing readouts type-editable. `advanced` has been
	// re-parented out of `panel`, so it needs its own pass.
	if (typeof initializeEditablePropertyValues === 'function') {
		initializeEditablePropertyValues(panel);
		if (advanced) initializeEditablePropertyValues(advanced);
	}
}
