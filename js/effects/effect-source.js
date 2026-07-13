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
			colorAdjust
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
	return {
		type: source.type === 'radial' ? 'radial' : 'linear',
		angle: ((Number(source.angle ?? defaults.angle) % 360) + 360) % 360,
		interpolation: ['linear', 'smooth', 'steps'].includes(source.interpolation)
			? source.interpolation
			: defaults.interpolation,
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
		const segments = CONFIG.rendering.gradient.smoothSubdivisions;
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
	const slot = sourceButton?.closest('.text-effect-subsection') || sourceButton?.closest('.subsection-content-group');
	if (!slot) return;
	const normalizedMode = ['image', 'none', 'glitter', 'solid', 'gradient'].includes(mode) ? mode : 'solid';
	slot.dataset.paintMode = normalizedMode;
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
	const advanced = slot.querySelector('.advanced-disclosure');
	if (advanced) advanced.hidden = normalizedMode !== 'glitter';
	const gradient = slot.querySelector('.effect-gradient-editor');
	if (gradient) {
		gradient.hidden = normalizedMode !== 'gradient';
		if (normalizedMode === 'gradient' && !gradient._liveUpdating && !gradient.contains(document.activeElement)) {
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
	const panel = document.getElementById('tpl-gradient-editor').content.firstElementChild.cloneNode(true);
	group.parentElement.appendChild(panel);
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
	const bar = panel.querySelector('.gradient-preview-bar');
	const markers = panel.querySelector('.gradient-preview-markers');
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
		});
	};
	const render = () => {
		const data = options.getData();
		if (!data) return;
		data.gradient = normalizeEffectGradient(data.gradient);
		panel.hidden = data.mode !== 'gradient';
		panel.querySelectorAll('[data-type]').forEach((item) => item.classList.toggle('active', item.dataset.type === data.gradient.type));
		panel.querySelectorAll('[data-interpolation]').forEach((item) => item.classList.toggle('active', item.dataset.interpolation === data.gradient.interpolation));
		const angle = panel.querySelector('.gradient-angle');
		angle.hidden = data.gradient.type !== 'linear';
		angle.querySelector('input').value = data.gradient.angle;
		angle.querySelector('.gradient-angle-value').innerHTML = formatUnit(data.gradient.angle, '\u00b0');
		markers.replaceChildren(...data.gradient.stops.map((stop, index) => {
			const marker = document.createElement('span');
			marker.className = 'gradient-preview-stop';
			marker.dataset.index = String(index);
			return marker;
		}));
		syncPreview(data.gradient);
		const list = panel.querySelector('.gradient-stops');
		list.replaceChildren(...data.gradient.stops.map((stop, index) => {
			const row = document.getElementById('tpl-gradient-stop').content.firstElementChild.cloneNode(true);
			const inputs = row.querySelectorAll('input');
			inputs[0].value = stop.color;
			inputs[1].value = Math.round(stop.offset * 100);
			inputs[2].value = Math.round(stop.alpha * 100);
			const values = row.querySelectorAll('.gradient-stop-value');
			values[0].textContent = `${inputs[1].value}%`;
			values[1].textContent = `${inputs[2].value}%`;
			row.querySelector('button').disabled = data.gradient.stops.length <= 2;
			inputs[0].addEventListener('input', () => { stop.color = inputs[0].value; syncPreview(data.gradient); update(false); });
			inputs[1].addEventListener('input', () => { stop.offset = Number(inputs[1].value) / 100; inputs[1].nextElementSibling.textContent = `${inputs[1].value}%`; syncPreview(data.gradient); update(false); });
			inputs[2].addEventListener('input', () => { stop.alpha = Number(inputs[2].value) / 100; inputs[2].nextElementSibling.textContent = `${inputs[2].value}%`; syncPreview(data.gradient); update(false); });
			inputs.forEach((input) => input.addEventListener('change', () => { update(true); render(); }));
			row.querySelector('button').addEventListener('click', () => { data.gradient.stops.splice(index, 1); update(true); render(); });
			return row;
		}));
	};
	// Direct manipulation on the strip: drag a handle to move its stop, click
	// bare strip to insert a stop pre-seeded with the sampled color/opacity.
	const preview = panel.querySelector('.gradient-preview');
	preview.addEventListener('pointerdown', (event) => {
		const data = options.getData();
		if (!data) return;
		event.preventDefault();
		data.gradient = normalizeEffectGradient(data.gradient);
		const rect = preview.getBoundingClientRect();
		const offsetAt = (clientX) => Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const handle = event.target.closest('.gradient-preview-stop');
		let stop;
		if (handle) {
			stop = data.gradient.stops[Number(handle.dataset.index)];
		} else {
			const offset = offsetAt(event.clientX);
			stop = { offset, ...sampleEffectGradientAt(data.gradient, offset) };
			data.gradient.stops.push(stop);
			update(true);
			render();
			stop = data.gradient.stops.find((entry) => entry.offset === stop.offset && entry.color === stop.color) || stop;
		}
		if (!stop) return;
		let moved = false;
		const onMove = (moveEvent) => {
			stop.offset = offsetAt(moveEvent.clientX);
			moved = true;
			syncPreview(data.gradient);
			update(false);
		};
		const onUp = () => {
			preview.removeEventListener('pointermove', onMove);
			preview.removeEventListener('pointerup', onUp);
			preview.removeEventListener('pointercancel', onUp);
			if (moved) { update(true); render(); }
		};
		preview.setPointerCapture(event.pointerId);
		preview.addEventListener('pointermove', onMove);
		preview.addEventListener('pointerup', onUp);
		preview.addEventListener('pointercancel', onUp);
	});
	panel._renderEffectGradient = render;
	button.addEventListener('click', () => { update(true); render(); });
	panel.querySelectorAll('[data-type]').forEach((item) => item.addEventListener('click', () => { const data = options.getData(); if (!data) return; data.gradient = normalizeEffectGradient(data.gradient); data.gradient.type = item.dataset.type; update(true); render(); }));
	panel.querySelectorAll('[data-interpolation]').forEach((item) => item.addEventListener('click', () => { const data = options.getData(); if (!data) return; data.gradient = normalizeEffectGradient(data.gradient); data.gradient.interpolation = item.dataset.interpolation; update(true); render(); }));
	const angleInput = panel.querySelector('.gradient-angle input');
	angleInput.addEventListener('input', () => { const data = options.getData(); if (data) { data.gradient.angle = Number(angleInput.value); panel.querySelector('.gradient-angle-value').innerHTML = formatUnit(data.gradient.angle, '\u00b0'); update(false); } });
	angleInput.addEventListener('change', () => update(true));
	panel.querySelector('.gradient-angle-reset').addEventListener('click', () => { const data = options.getData(); if (!data) return; data.gradient.angle = CONFIG.rendering.gradient.angle; update(true); render(); });
	panel.querySelector('.gradient-add').addEventListener('click', () => { const data = options.getData(); if (!data) return; data.gradient = normalizeEffectGradient(data.gradient); const offset = 0.5; data.gradient.stops.push({ offset, ...sampleEffectGradientAt(data.gradient, offset) }); update(true); render(); });
}
