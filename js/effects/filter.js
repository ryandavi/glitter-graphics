(function (root) {
	const Tone = root.GlitterToneAdjust || (typeof require === 'function' ? require('./tone-adjust.js') : null);
	const Grain = root.GlitterGrain || (typeof require === 'function' ? require('./grain.js') : null);
	const Blur = root.GlitterBlur || (typeof require === 'function' ? require('./blur.js') : null);
	const BlendModes = root.GlitterBlendModes || (typeof require === 'function' ? require('./blend-modes.js') : null);
	const Ops = root.GlitterFilterOps || (typeof require === 'function' ? require('./filter-ops.js') : null);
	const Filters = root.GlitterFilters || (typeof require === 'function' ? require('./filters.js') : null);
	const FILTER_TYPES = Filters.FILTER_TYPES;

	function config() {
		return CONFIG.tools.filter;
	}

	function clamp(value, minimum, maximum) {
		return Math.min(maximum, Math.max(minimum, value));
	}

	function number(value, fallback) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	function normalizeFilterData(value) {
		const source = value || {};
		return Filters.normalize(source.type, source);
	}

	function isActive(value, opacity = 100) {
		if (number(opacity, 100) <= 0) return false;
		return Filters.recipe(normalizeFilterData(value)).some((entry) => Ops.get(entry.op)?.isActive?.(entry.params));
	}

	function summaryText(value) {
		const data = normalizeFilterData(value);
		const filter = Filters.get(data.type);
		return filter.summary?.(data) || filter.label;
	}

	function resolve(value) {
		const resolved = { tone: null, blur: null, ops: [], caption: null, steps: Filters.recipe(normalizeFilterData(value)) };
		resolved.steps.forEach((entry) => {
			if (entry.op === 'tone') resolved.tone = entry.params.tone;
			else if (entry.op === 'blur' && !entry.params.composite) resolved.blur = entry.params;
			else if (entry.op === 'caption') resolved.caption = entry.params.text;
			else resolved.ops.push({ kind: entry.op, ...entry.params });
		});
		return resolved;
	}

	function toneCssFilter(value) {
		return Tone.toneCssFilterString(resolve(value).tone);
	}

	function gradientCss(gradient) {
		const percent = (value) => Math.round(value * 100000) / 1000;
		const stops = gradient.stops.map((entry) => `${entry.color} ${gradient.type === 'repeating-linear' ? entry.at * gradient.size : percent(entry.at)}${gradient.type === 'repeating-linear' ? 'px' : '%'}`).join(', ');
		if (gradient.type === 'repeating-linear') return `repeating-linear-gradient(${gradient.angle}deg, ${stops})`;
		if (gradient.type === 'linear') return `linear-gradient(${gradient.angle}deg, ${stops})`;
		if (gradient.sizing === 'farthest-corner') return `radial-gradient(circle farthest-corner at ${percent(gradient.center[0])}% ${percent(gradient.center[1])}%, ${stops})`;
		const radiusX = (gradient.radiusX || gradient.radius) * 100;
		const radiusY = (gradient.radiusY || gradient.radius) * 100;
		return `radial-gradient(ellipse ${radiusX}% ${radiusY}% at ${gradient.center[0] * 100}% ${gradient.center[1] * 100}%, ${stops})`;
	}

	function tileDataUrl(tile) {
		if (typeof tile.toDataURL === 'function') return tile.toDataURL();
		if (typeof document === 'undefined') return '';
		const canvas = createAppCanvas(0, 0, 'effects/filter');
		canvas.width = tile.width;
		canvas.height = tile.height;
		const context = canvas.getContext('2d');
		if (tile.data) context.putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0);
		else context.drawImage(tile, 0, 0);
		return canvas.toDataURL();
	}

	// 'normal' means "no override" (it's also the unset default), so each op
	// keeps its own built-in mode (e.g. vignette's luminance-picked screen/
	// multiply) until the user chooses something else.
	function resolveOpMode(op, blendMode) {
		return blendMode && blendMode !== 'normal' ? blendMode : op.mode;
	}

	function overlayLayerStyles(value, { seed = '', viewScale = 1, tileCache = null, blendMode = null } = {}) {
		const resolved = resolve(value);
		const styles = [];
		const filters = [Tone.toneCssFilterString(resolved.tone), Blur.cssBlurString(resolved.blur, viewScale)].filter(Boolean).join(' ');
		for (const op of resolved.ops) {
			const mode = resolveOpMode(op, blendMode);
			const params = { ...op, mode };
			if (op.kind === 'fill') styles.push({ className: 'filter-layer-fill', style: Ops.get('fill').css(params) });
			if (op.kind === 'gradient') styles.push({ className: 'filter-layer-gradient', style: Ops.get('gradient').css(params, { gradientCss }) });
			if (op.kind === 'grain') {
				const signature = `${Grain.tileSignature(op, seed)}|${config().grainTilePx}`;
				if (tileCache && !tileCache.has(signature)) tileCache.set(signature, Grain.buildTile(op, seed, config().grainTilePx));
				const tile = tileCache?.get(signature) || Grain.buildTile(op, seed, config().grainTilePx);
				styles.push({ className: 'filter-layer-grain', style: {
				backgroundImage: `url(${tileDataUrl(tile)})`,
				backgroundRepeat: 'repeat', backgroundSize: `${config().grainTilePx * viewScale}px`, mixBlendMode: mode, opacity: op.amount
				} });
			}
			if (op.kind === 'blur') styles.push({ className: 'filter-layer-backdrop', style: Ops.get('blur').css(params, { viewScale }) });
		}
		// CSSgram filters the composited image after its ::before/::after blends.
		if (filters) {
			const backdropStyle = { backdropFilter: filters, WebkitBackdropFilter: filters };
			// Tone/blur (no ops) is the only paint on this layer, so it's safe to
			// blend directly here. When ops are also present (Tint/Vignette/Grain/
			// Instagram) they already carry the chosen mode themselves - blending
			// this backdrop too would double it up against the same real backdrop.
			if (!resolved.ops.length) backdropStyle.mixBlendMode = resolveOpMode({ mode: 'normal' }, blendMode);
			styles.push({ className: 'filter-layer-backdrop', style: backdropStyle });
		}
		return styles;
	}

	// Reused across calls (see EXPORT-PERFORMANCE-PLAN.md Part 2b): one canvas
	// per named role instead of a fresh allocation per call. Safe because
	// renderToCanvas is only ever invoked from SceneCompositor.js (verified — no
	// live-preview call site) with layers rendered strictly sequentially, never
	// re-entrantly or in parallel, so a given slot can't be clobbered mid-use by
	// another renderToCanvas call. If that ever changes (e.g. parallel layer
	// rendering), this pooling breaks and needs revisiting.
	const scratchCanvasSlots = new Map();
	function getScratchCanvas(slot, width, height) {
		let canvas = scratchCanvasSlots.get(slot);
		if (!canvas) {
			canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : createAppCanvas(0, 0, 'effects/filter');
			scratchCanvasSlots.set(slot, canvas);
		}
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		return canvas;
	}

	// Reused across calls (see EXPORT-PERFORMANCE-PLAN.md Part 2a): both are
	// fully consumed within renderToCanvas's color-burn branch (composited is
	// written back via context.putImageData before the function returns) and
	// never stored past that call, so pooling is safe. renderToCanvas is only
	// ever invoked sequentially from SceneCompositor.js, never re-entrantly.
	let colorBurnScaledSourceScratch = null;
	let colorBurnCompositedScratch = null;
	function getColorBurnScratch(slot, width, height, sourceData) {
		const current = slot === 'source' ? colorBurnScaledSourceScratch : colorBurnCompositedScratch;
		const scratch = (current && current.width === width && current.height === height)
			? current
			: new ImageData(width, height);
		if (slot === 'source') colorBurnScaledSourceScratch = scratch; else colorBurnCompositedScratch = scratch;
		scratch.data.set(sourceData);
		return scratch;
	}

	function paintGradient(context, width, height, spec) {
		if (spec.type === 'repeating-linear') {
			const size = Math.max(1, number(spec.size, 4));
			const tile = getScratchCanvas('repeatingGradient', size, size);
			const tileContext = tile.getContext('2d');
			tileContext.clearRect(0, 0, size, size);
			const gradient = tileContext.createLinearGradient(0, 0, 0, size);
			spec.stops.forEach((entry) => gradient.addColorStop(clamp(entry.at, 0, 1), entry.color));
			tileContext.fillStyle = gradient;
			tileContext.fillRect(0, 0, size, size);
			context.fillStyle = context.createPattern(tile, 'repeat');
			context.fillRect(0, 0, width, height);
			return;
		}
		if (spec.type === 'linear') {
			const radians = (spec.angle - 90) * Math.PI / 180;
			const length = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
			const centerX = width / 2;
			const centerY = height / 2;
			const gradient = context.createLinearGradient(centerX - Math.cos(radians) * length / 2, centerY - Math.sin(radians) * length / 2, centerX + Math.cos(radians) * length / 2, centerY + Math.sin(radians) * length / 2);
			spec.stops.forEach((entry) => gradient.addColorStop(clamp(entry.at, 0, 1), entry.color));
			context.fillStyle = gradient;
			context.fillRect(0, 0, width, height);
			return;
		}
		const centerX = spec.center[0] * width;
		const centerY = spec.center[1] * height;
		const stopScale = Math.max(1, ...spec.stops.map((entry) => entry.at));
		const farthestCorner = Math.max(
			Math.hypot(centerX, centerY), Math.hypot(width - centerX, centerY),
			Math.hypot(centerX, height - centerY), Math.hypot(width - centerX, height - centerY)
		);
		const radiusX = (spec.sizing === 'farthest-corner' ? farthestCorner : (spec.radiusX || spec.radius) * width) * stopScale;
		const radiusY = (spec.sizing === 'farthest-corner' ? farthestCorner : (spec.radiusY || spec.radius) * height) * stopScale;
		context.save();
		context.translate(centerX, centerY);
		context.scale(radiusX / radiusY, 1);
		const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radiusY);
		spec.stops.forEach((entry) => gradient.addColorStop(clamp(entry.at / stopScale, 0, 1), entry.color));
		context.fillStyle = gradient;
		context.fillRect(-centerX * radiusY / radiusX, -centerY, width * radiusY / radiusX, height);
		context.restore();
	}

	function renderToCanvas(context, width, height, value, strength, options = {}) {
		if (!isActive(value, strength * 100)) return;
		const resolved = resolve(value);
		const pre = context.getImageData(0, 0, width, height);
		const sourceCanvas = getScratchCanvas('source', width, height);
		const sourceContext = sourceCanvas.getContext('2d');
		sourceContext.putImageData(pre, 0, 0);
		if (options.renderSource) options.renderSource(sourceContext);
		const post = sourceContext.getImageData(0, 0, width, height);
		const canvas = getScratchCanvas('ops', width, height);
		const scratch = canvas.getContext('2d');
		scratch.putImageData(post, 0, 0);
		for (const op of resolved.ops) {
			scratch.save();
			scratch.globalCompositeOperation = BlendModes.cssToGCO(resolveOpMode(op, options.blendMode));
			scratch.globalAlpha = op.kind === 'grain' ? op.amount : op.opacity;
			if (op.kind === 'fill') {
				scratch.fillStyle = op.color;
				scratch.fillRect(0, 0, width, height);
			} else if (op.kind === 'gradient') {
				paintGradient(scratch, width, height, op.gradient);
			} else if (op.kind === 'grain') {
				const signature = `${Grain.tileSignature(op, options.seed)}|${config().grainTilePx}`;
				if (options.tileCache && !options.tileCache.has(signature)) options.tileCache.set(signature, Grain.buildTile(op, options.seed, config().grainTilePx));
				const tile = options.tileCache?.get(signature) || Grain.buildTile(op, options.seed, config().grainTilePx);
				const pattern = scratch.createPattern(tile, 'repeat');
				scratch.fillStyle = pattern;
				scratch.fillRect(0, 0, width, height);
			} else if (op.kind === 'blur') {
				const blurred = scratch.getImageData(0, 0, width, height);
				Ops.get('blur').pixel(blurred, op);
				const blurredCanvas = getScratchCanvas('compositeBlur', width, height);
				blurredCanvas.getContext('2d').putImageData(blurred, 0, 0);
				scratch.drawImage(blurredCanvas, 0, 0);
			}
			scratch.restore();
		}
		const rendered = scratch.getImageData(0, 0, width, height);
		if (resolved.tone) Tone.applyToneToImageData(rendered, resolved.tone, options.alphaThreshold || 0);
		if (resolved.blur) Blur.applyBlurToImageData(rendered, resolved.blur.radius);
		const amount = clamp(number(strength, 1), 0, 1);
		// Ops (Tint/Vignette/Grain/Instagram) already blended against the real
		// backdrop above; blending the whole result again here would double it
		// up, so only tone/blur-only filters (Basic/Invert/Grayscale/Sepia/Blur)
		// use the layer's chosen blend mode for this final composite - the rest
		// stay a plain opacity cross-fade, matching the live CSS preview.
		const blendMode = resolved.ops.length ? 'normal' : BlendModes.normalize(options.blendMode);
		let composited;
		if (blendMode === 'normal') {
			composited = rendered;
			for (let index = 0; index < pre.data.length; index += 4) {
				for (let channel = 0; channel < 4; channel++) composited.data[index + channel] = Math.round(pre.data[index + channel] + (rendered.data[index + channel] - pre.data[index + channel]) * amount);
			}
		} else if (blendMode === 'color-burn') {
			// Chromium's canvas color-burn mishandles opaque dark pixels when the
			// source is otherwise-transparent; composite the pixels directly (see
			// BlendModes.compositeColorBurn) instead of drawing through canvas.
			const scaledSource = getColorBurnScratch('source', width, height, rendered.data);
			for (let index = 3; index < scaledSource.data.length; index += 4) scaledSource.data[index] = Math.round(scaledSource.data[index] * amount);
			composited = getColorBurnScratch('composited', width, height, pre.data);
			BlendModes.compositeColorBurn(composited, scaledSource);
		} else {
			const preCanvas = getScratchCanvas('preBlend', width, height);
			const blendCtx = preCanvas.getContext('2d');
			blendCtx.putImageData(pre, 0, 0);
			const renderedCanvas = getScratchCanvas('renderedBlend', width, height);
			renderedCanvas.getContext('2d').putImageData(rendered, 0, 0);
			blendCtx.globalAlpha = amount;
			blendCtx.globalCompositeOperation = BlendModes.cssToGCO(blendMode);
			blendCtx.drawImage(renderedCanvas, 0, 0);
			composited = blendCtx.getImageData(0, 0, width, height);
		}
		const threshold = options.alphaThreshold || 0;
		if (options.keepAlpha) {
			for (let index = 0; index < pre.data.length; index += 4) {
				if (pre.data[index + 3] < threshold) {
					composited.data[index] = pre.data[index];
					composited.data[index + 1] = pre.data[index + 1];
					composited.data[index + 2] = pre.data[index + 2];
					composited.data[index + 3] = pre.data[index + 3];
				}
			}
		}
		context.putImageData(composited, 0, 0);
	}

	function drawCaption(context, spec) {
		context.save();
		context.font = spec.font;
		context.fillStyle = spec.color;
		context.textAlign = spec.textAlign;
		context.textBaseline = spec.textBaseline;
		context.shadowColor = spec.shadowColor;
		context.shadowOffsetX = spec.shadowOffsetX;
		context.shadowOffsetY = spec.shadowOffsetY;
		context.shadowBlur = spec.shadowBlur;
		context.fillText(spec.text, spec.x, spec.y);
		context.restore();
	}

	function nameCaptionSpec(text, { width, height } = {}) {
		const caption = config().nameCaption;
		const available = width * caption.maxWidthFraction;
		const estimated = Math.max(1, String(text).length * caption.fontPx * 0.58);
		const fontPx = Math.max(caption.minFontPx, Math.min(caption.fontPx, caption.fontPx * available / estimated));
		return { text, x: width / 2, y: height / 2, font: `${fontPx}px ${caption.fontFamily}`, fontPx, color: caption.color,
			shadowColor: caption.shadow.color, shadowOffsetX: caption.shadow.offsetX, shadowOffsetY: caption.shadow.offsetY, shadowBlur: caption.shadow.blur,
			textAlign: 'center', textBaseline: 'middle' };
	}

	const api = { FILTER_TYPES, normalizeFilterData, isActive, summaryText, resolve, toneCssFilter, gradientCss, overlayLayerStyles, renderToCanvas, drawCaption, nameCaptionSpec };
	root.GlitterFilter = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
