(function (root) {
	const Tone = root.GlitterToneAdjust || (typeof require === 'function' ? require('./tone-adjust.js') : null);
	const Grain = root.GlitterGrain || (typeof require === 'function' ? require('./grain.js') : null);
	const Blur = root.GlitterBlur || (typeof require === 'function' ? require('./blur.js') : null);
	const BlendModes = root.GlitterBlendModes || (typeof require === 'function' ? require('./blend-modes.js') : null);
	const Presets = root.FILTER_PRESETS || (typeof require === 'function' ? require('../core/filter-presets.js') : null);
	const FILTER_TYPES = Object.freeze(['basic', 'invert', 'grayscale', 'sepia', 'tint', 'vignette', 'grain', 'blur', 'instagram']);

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
		const type = FILTER_TYPES.includes(source.type) ? source.type : config().defaultType;
		const defaults = config().types[type];
		const normalized = { type };
		Object.keys(defaults).forEach((key) => {
			normalized[key] = source[key] == null ? structuredClone(defaults[key]) : structuredClone(source[key]);
		});
		if (type === 'instagram' && !Presets[normalized.presetId]) normalized.presetId = defaults.presetId;
		if (type === 'instagram') {
			normalized.strength = clamp(number(normalized.strength, defaults.strength), 0, 100);
			normalized.showName = Boolean(normalized.showName);
		} else if (type === 'basic') {
			['brightness', 'contrast', 'saturation'].forEach((key) => { normalized[key] = clamp(number(normalized[key], defaults[key]), -100, 100); });
			normalized.hue = clamp(number(normalized.hue, defaults.hue), -180, 180);
		} else if (['invert', 'grayscale', 'sepia', 'tint', 'vignette', 'grain'].includes(type)) {
			normalized.amount = clamp(number(normalized.amount, defaults.amount), 0, 100);
		}
		if (type === 'tint') {
			normalized.color = /^#[0-9a-f]{6}$/i.test(normalized.color) ? normalized.color : defaults.color;
			const matchingPreset = Object.entries(config().tintPresets).find(([, preset]) => preset.color?.toLowerCase() === normalized.color.toLowerCase())?.[0];
			const requestedPreset = Object.hasOwn(source, 'presetId') ? source.presetId : (source.color == null ? defaults.presetId : matchingPreset || 'custom');
			normalized.presetId = config().tintPresets[requestedPreset] ? requestedPreset : 'custom';
			if (normalized.presetId !== 'custom') normalized.color = config().tintPresets[normalized.presetId].color;
			normalized.mode = defaults.mode;
		} else if (type === 'vignette') {
			normalized.midpoint = clamp(number(normalized.midpoint, defaults.midpoint), 0, 100);
			normalized.roundness = clamp(number(normalized.roundness, defaults.roundness), -100, 100);
			normalized.feather = clamp(number(normalized.feather, defaults.feather), 1, 100);
			normalized.color = /^#[0-9a-f]{6}$/i.test(normalized.color) ? normalized.color : defaults.color;
		} else if (type === 'grain') {
			normalized.size = clamp(number(normalized.size, defaults.size), 0, 100);
			normalized.roughness = clamp(number(normalized.roughness, defaults.roughness), 0, 100);
			normalized.monochrome = normalized.monochrome !== false;
			normalized.mode = BlendModes.isBlendMode(normalized.mode) ? normalized.mode : defaults.mode;
		} else if (type === 'blur') {
			normalized.radius = clamp(number(normalized.radius, defaults.radius), 0, 64);
		}
		return normalized;
	}

	function presetFor(data) {
		return Presets[data.presetId] || null;
	}

	function isActive(value, opacity = 100) {
		if (number(opacity, 100) <= 0) return false;
		const data = normalizeFilterData(value);
		if (data.type === 'instagram') return Boolean(presetFor(data)) && (data.strength > 0 || data.showName);
		if (data.type === 'basic') return Boolean(data.brightness || data.contrast || data.saturation || data.hue);
		if (['invert', 'grayscale', 'sepia', 'tint', 'vignette', 'grain'].includes(data.type)) return number(data.amount, 0) > 0;
		return data.type === 'blur' && number(data.radius, 0) > 0;
	}

	function summaryText(value) {
		const data = normalizeFilterData(value);
		if (data.type === 'instagram') return presetFor(data)?.name || presetFor(data)?.instagramName || 'Instagram';
		if (data.type === 'basic') {
			const labels = [['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturation', 'Saturation'], ['hue', 'Hue']]
				.filter(([key]) => number(data[key], 0) !== 0)
				.map(([key, label]) => `${label} ${data[key] > 0 ? '+' : ''}${data[key]}${key === 'hue' ? '°' : ''}`);
			return labels.join(', ') || 'Basic';
		}
		if (data.type === 'grayscale') return `Grayscale ${Math.round(data.amount)}%`;
		if (data.type === 'sepia') return `Sepia ${Math.round(data.amount)}%`;
		if (data.type === 'grain') return `Grain ${Math.round(data.amount)}%`;
		if (data.type === 'blur') return data.radius > 0 ? `Blur ${data.radius}px` : 'Off';
		if (data.type === 'tint') return config().tintPresets[data.presetId]?.label || 'Custom Tint';
		return data.type.charAt(0).toUpperCase() + data.type.slice(1);
	}

	function lerpTone(value, amount) {
		const tone = Tone.normalizeTone(value);
		const output = { order: [...tone.order] };
		for (const key of Object.keys(Tone.TONE_IDENTITY)) output[key] = Tone.TONE_IDENTITY[key] + (tone[key] - Tone.TONE_IDENTITY[key]) * amount;
		return output;
	}

	function vignetteGradient(data) {
		const midpoint = clamp(number(data.midpoint, 55) / 100, 0, 1);
		const feather = clamp(number(data.feather, 60) / 100, 0.01, 1);
		const edgeStart = clamp(midpoint - (1 - midpoint) * feather * 0.25, 0, 1);
		const roundness = clamp(number(data.roundness, 0) / 100, -1, 1);
		return {
			type: 'radial', center: [0.5, 0.5], radius: 0.72,
			radiusX: 0.72 * (roundness < 0 ? 1 + roundness * 0.45 : 1),
			radiusY: 0.72 * (roundness > 0 ? 1 - roundness * 0.45 : 1),
			shape: Math.abs(roundness) > 0.05 ? 'ellipse' : 'circle',
			stops: [{ at: edgeStart, color: 'transparent' }, { at: 1, color: data.color }]
		};
	}

	function resolve(value) {
		const data = normalizeFilterData(value);
		if (data.type === 'instagram') {
			const preset = presetFor(data);
			if (!preset) return { tone: null, blur: null, ops: [], caption: null };
			const strength = clamp(number(data.strength, 100) / 100, 0, 1);
			return {
				tone: lerpTone(preset.tone, strength),
				blur: null,
				ops: preset.ops.map((op) => ({ ...structuredClone(op), opacity: number(op.opacity, 1) * strength })),
				caption: data.showName ? (preset.name || preset.instagramName) : null
			};
		}
		if (data.type === 'basic') return { tone: { brightness: 1 + data.brightness / 100, contrast: 1 + data.contrast / 100, saturate: 1 + data.saturation / 100, hueRotate: data.hue }, blur: null, ops: [], caption: null };
		if (['invert', 'grayscale', 'sepia'].includes(data.type)) return { tone: { [data.type]: data.amount / 100 }, blur: null, ops: [], caption: null };
		if (data.type === 'tint') return { tone: null, blur: null, ops: [{ kind: 'fill', color: data.color, mode: data.mode, opacity: data.amount / 100 }], caption: null };
		if (data.type === 'vignette') return { tone: null, blur: null, ops: [{ kind: 'gradient', mode: 'multiply', opacity: data.amount / 100, gradient: vignetteGradient(data) }], caption: null };
		if (data.type === 'grain') return { tone: null, blur: null, ops: [{ kind: 'grain', mode: data.mode, amount: data.amount / 100, size: data.size, roughness: data.roughness / 100, monochrome: data.monochrome }], caption: null };
		return { tone: null, blur: { radius: data.radius }, ops: [], caption: null };
	}

	function toneCssFilter(value) {
		return Tone.toneCssFilterString(resolve(value).tone);
	}

	function gradientCss(gradient) {
		const percent = (value) => Math.round(value * 100000) / 1000;
		const stops = gradient.stops.map((entry) => `${entry.color} ${percent(entry.at)}%`).join(', ');
		if (gradient.type === 'linear') return `linear-gradient(${gradient.angle}deg, ${stops})`;
		if (gradient.sizing === 'farthest-corner') return `radial-gradient(circle farthest-corner at ${percent(gradient.center[0])}% ${percent(gradient.center[1])}%, ${stops})`;
		const radiusX = (gradient.radiusX || gradient.radius) * 100;
		const radiusY = (gradient.radiusY || gradient.radius) * 100;
		return `radial-gradient(ellipse ${radiusX}% ${radiusY}% at ${gradient.center[0] * 100}% ${gradient.center[1] * 100}%, ${stops})`;
	}

	function tileDataUrl(tile) {
		if (typeof tile.toDataURL === 'function') return tile.toDataURL();
		if (typeof document === 'undefined') return '';
		const canvas = document.createElement('canvas');
		canvas.width = tile.width;
		canvas.height = tile.height;
		const context = canvas.getContext('2d');
		if (tile.data) context.putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0);
		else context.drawImage(tile, 0, 0);
		return canvas.toDataURL();
	}

	function overlayLayerStyles(value, { seed = '', viewScale = 1, tileCache = null } = {}) {
		const resolved = resolve(value);
		const styles = [];
		const filters = [Tone.toneCssFilterString(resolved.tone), Blur.cssBlurString(resolved.blur, viewScale)].filter(Boolean).join(' ');
		for (const op of resolved.ops) {
			if (op.kind === 'fill') styles.push({ className: 'filter-layer-fill', style: { background: op.color, mixBlendMode: op.mode, opacity: op.opacity } });
			if (op.kind === 'gradient') styles.push({ className: 'filter-layer-gradient', style: { backgroundImage: gradientCss(op.gradient), mixBlendMode: op.mode, opacity: op.opacity } });
			if (op.kind === 'grain') {
				const signature = `${Grain.tileSignature(op, seed)}|${config().grainTilePx}`;
				if (tileCache && !tileCache.has(signature)) tileCache.set(signature, Grain.buildTile(op, seed, config().grainTilePx));
				const tile = tileCache?.get(signature) || Grain.buildTile(op, seed, config().grainTilePx);
				styles.push({ className: 'filter-layer-grain', style: {
				backgroundImage: `url(${tileDataUrl(tile)})`,
				backgroundRepeat: 'repeat', backgroundSize: `${config().grainTilePx * viewScale}px`, mixBlendMode: op.mode, opacity: op.amount
				} });
			}
		}
		// CSSgram filters the composited image after its ::before/::after blends.
		if (filters) styles.push({ className: 'filter-layer-backdrop', style: { backdropFilter: filters, WebkitBackdropFilter: filters } });
		return styles;
	}

	function createScratch(width, height) {
		const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}

	function paintGradient(context, width, height, spec) {
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
		const sourceCanvas = createScratch(width, height);
		const sourceContext = sourceCanvas.getContext('2d');
		sourceContext.putImageData(pre, 0, 0);
		if (options.renderSource) options.renderSource(sourceContext);
		const post = sourceContext.getImageData(0, 0, width, height);
		const canvas = createScratch(width, height);
		const scratch = canvas.getContext('2d');
		scratch.putImageData(post, 0, 0);
		for (const op of resolved.ops) {
			scratch.save();
			scratch.globalCompositeOperation = BlendModes.cssToGCO(op.mode);
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
			}
			scratch.restore();
		}
		const rendered = scratch.getImageData(0, 0, width, height);
		if (resolved.tone) Tone.applyToneToImageData(rendered, resolved.tone, options.alphaThreshold || 0);
		if (resolved.blur) Blur.applyBlurToImageData(rendered, resolved.blur.radius);
		const amount = clamp(number(strength, 1), 0, 1);
		const safeKey = options.safeKey;
		const threshold = options.alphaThreshold || 0;
		for (let index = 0; index < pre.data.length; index += 4) {
			const keyPixel = safeKey && pre.data[index] === safeKey.r && pre.data[index + 1] === safeKey.g && pre.data[index + 2] === safeKey.b;
			if (options.keepAlpha && (pre.data[index + 3] < threshold || keyPixel)) {
				rendered.data[index] = safeKey?.r || 0;
				rendered.data[index + 1] = safeKey?.g || 0;
				rendered.data[index + 2] = safeKey?.b || 0;
				rendered.data[index + 3] = pre.data[index + 3];
				continue;
			}
			for (let channel = 0; channel < 4; channel++) rendered.data[index + channel] = Math.round(pre.data[index + channel] + (rendered.data[index + channel] - pre.data[index + channel]) * amount);
		}
		context.putImageData(rendered, 0, 0);
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

	function renderCssThumbnail(element, value, strength = 1) {
		if (!element) return;
		const data = normalizeFilterData(value);
		const resolved = resolve(data);
		FILTER_TYPES.forEach((type) => element.classList.remove(`filter-css-thumbnail-${type}`));
		element.classList.add('filter-css-thumbnail', `filter-css-thumbnail-${data.type}`);
		element.style.opacity = clamp(number(strength, 1), 0, 1);
		element.replaceChildren();

		const base = document.createElement('span');
		base.className = 'filter-css-thumbnail-base';
		const toneFilter = Tone.toneCssFilterString(resolved.tone);
		if (toneFilter) base.style.filter = toneFilter;
		if (resolved.blur) base.style.filter = `${base.style.filter} ${Blur.cssBlurString(resolved.blur, 1)}`.trim();
		element.appendChild(base);

		resolved.ops.forEach((op) => {
			const overlay = document.createElement('span');
			overlay.className = `filter-css-thumbnail-overlay filter-css-thumbnail-${op.kind}`;
			overlay.style.mixBlendMode = op.mode;
			overlay.style.opacity = op.kind === 'grain' ? op.amount : op.opacity;
			if (op.kind === 'fill') overlay.style.background = op.color;
			else if (op.kind === 'gradient') overlay.style.backgroundImage = gradientCss(op.gradient);
			element.appendChild(overlay);
		});
	}

	function nameCaptionSpec(text, { width, height, stackIndex = 0 } = {}) {
		const caption = config().nameCaption;
		const available = width * caption.maxWidthFraction;
		const estimated = Math.max(1, String(text).length * caption.fontPx * 0.58);
		const fontPx = Math.max(caption.minFontPx, Math.min(caption.fontPx, caption.fontPx * available / estimated));
		const step = fontPx + caption.shadow.blur + 4;
		const direction = stackIndex === 0 ? 0 : (stackIndex % 2 ? 1 : -1) * Math.ceil(stackIndex / 2);
		return { text, x: width / 2, y: height / 2 + direction * step, font: `${fontPx}px ${caption.fontFamily}`, fontPx, color: caption.color,
			shadowColor: caption.shadow.color, shadowOffsetX: caption.shadow.offsetX, shadowOffsetY: caption.shadow.offsetY, shadowBlur: caption.shadow.blur,
			textAlign: 'center', textBaseline: 'middle' };
	}

	const api = { FILTER_TYPES, normalizeFilterData, isActive, summaryText, resolve, toneCssFilter, overlayLayerStyles, renderToCanvas, drawCaption, renderCssThumbnail, nameCaptionSpec };
	root.GlitterFilter = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
