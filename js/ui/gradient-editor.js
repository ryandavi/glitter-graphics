function installEffectGradientEditor(options) {
	const solid = document.getElementById(`${options.prefix}Solid`);
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
	const moduleAdvanced = slotCard?.querySelector('.advanced-disclosure.glitter-source-glitter');
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
