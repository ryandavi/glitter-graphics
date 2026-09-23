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

	if (effectData.mode === 'image') {
		const imageAsset = typeof options.imageResolver === 'function'
			? options.imageResolver(effectData.imageRef)
			: null;
		if (!imageAsset?.image) return null;
		return {
			mode: 'image',
			imageRef: effectData.imageRef,
			image: imageAsset.image,
			url: imageAsset.url || imageAsset.dataUrl || imageAsset.image.src,
			fit: normalizeImageFit(effectData.fit),
			imageScalePercent: normalizeImageScalePercent(effectData.imageScalePercent),
			offsetXPercent: normalizeImagePositionPercent(effectData.offsetXPercent),
			offsetYPercent: normalizeImagePositionPercent(effectData.offsetYPercent),
			tile: Boolean(effectData.tile ?? CONFIG.tools.shapes.imageFill.defaultTile),
			imageRendering: normalizeImageRendering(effectData.imageRendering),
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

function normalizeImageFit(fit) {
	const config = CONFIG.tools.shapes.imageFill;
	return config.fitOptions.some((option) => option.value === fit) ? fit : config.defaultFit;
}

function normalizeImagePositionPercent(value) {
	const number = Number(value);
	return Number.isFinite(number)
		? Math.max(0, Math.min(100, number))
		: FIELDS.shapeImageOffsetX.value;
}

function normalizeImageScalePercent(value) {
	const slider = FIELDS.shapeImageScale;
	const number = Number(value);
	return Number.isFinite(number)
		? Math.max(slider.min, Math.min(slider.max, number))
		: FIELDS.shapeImageScale.value;
}

function normalizeImageRendering(value) {
	return value === 'pixelated' ? 'pixelated' : CONFIG.tools.shapes.imageFill.defaultRendering;
}

// CSS background placement and canvas drawImage share this exact geometry.
// dx/dy are relative to the supplied box, not the padded mask surface.
function computeImageFitPlacement(fit, imageWidth, imageHeight, boxWidth, boxHeight, positionXPercent, positionYPercent, imageScalePercent) {
	const iw = Math.max(1, Number(imageWidth) || 1);
	const ih = Math.max(1, Number(imageHeight) || 1);
	const bw = Math.max(0, Number(boxWidth) || 0);
	const bh = Math.max(0, Number(boxHeight) || 0);
	let dw = iw;
	let dh = ih;
	const normalizedFit = normalizeImageFit(fit);
	if (normalizedFit === 'fill') {
		dw = bw;
		dh = bh;
	} else if (normalizedFit === 'cover' || normalizedFit === 'contain' || normalizedFit === 'scale-down') {
		const containScale = Math.min(bw / iw, bh / ih);
		const scale = normalizedFit === 'cover'
			? Math.max(bw / iw, bh / ih)
			: normalizedFit === 'scale-down' ? Math.min(1, containScale) : containScale;
		dw = iw * scale;
			dh = ih * scale;
	}
	const imageScale = normalizeImageScalePercent(imageScalePercent) / 100;
	dw *= imageScale;
	dh *= imageScale;
	const x = normalizeImagePositionPercent(positionXPercent) / 100;
	const y = normalizeImagePositionPercent(positionYPercent) / 100;
	return { dx: (bw - dw) * x, dy: (bh - dh) * y, dw, dh };
}

function getImageFillPlacement(source, paintBox) {
	const box = paintBox || { x: 0, y: 0, width: 0, height: 0 };
	const placement = computeImageFitPlacement(
		source.fit,
		source.image.naturalWidth || source.image.width,
		source.image.naturalHeight || source.image.height,
		box.width,
		box.height,
		source.offsetXPercent,
		source.offsetYPercent,
		source.imageScalePercent
	);
	return {
		dx: box.x + placement.dx,
		dy: box.y + placement.dy,
		dw: placement.dw,
		dh: placement.dh
	};
}

function normalizeEffectGradient(gradient) {
	const defaults = CONFIG.rendering.gradient;
	const source = gradient || defaults;
	const stops = Array.isArray(source.stops) && source.stops.length >= 2
		? source.stops
		: defaults.stops;
	const smoothing = FIELDS.gradientSmoothing;
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
