(function (root) {
	'use strict';

	const Tone = root.GlitterToneAdjust || (typeof require === 'function' ? require('./tone-adjust.js') : null);
	const Blur = root.GlitterBlur || (typeof require === 'function' ? require('./blur.js') : null);
	const PixelEffects = root.GlitterPixelEffects || (typeof require === 'function' ? require('./pixel-effects.js') : null);

	const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

	function sharpen(imageData, amount = 1) {
		const source = new Uint8ClampedArray(imageData.data);
		const width = imageData.width;
		const height = imageData.height;
		const strength = Math.max(0, Number(amount) || 0);
		for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
			const offset = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel++) {
				const neighbors = source[offset - 4 + channel] + source[offset + 4 + channel]
					+ source[offset - width * 4 + channel] + source[offset + width * 4 + channel];
				imageData.data[offset + channel] = clampByte(source[offset + channel] * (1 + 4 * strength) - neighbors * strength);
			}
		}
		return imageData;
	}

	function noise(imageData, amount = 0, seed = '') {
		let state = 2166136261;
		for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
		const scale = Math.max(0, Number(amount) || 0) * 255;
		for (let offset = 0; offset < imageData.data.length; offset += 4) {
			state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
			const delta = ((state >>> 0) / 4294967295 - 0.5) * scale;
			for (let channel = 0; channel < 3; channel++) imageData.data[offset + channel] = clampByte(imageData.data[offset + channel] + delta);
		}
		return imageData;
	}

	function rgbSplit(imageData, offsetValue = 0) {
		const source = new Uint8ClampedArray(imageData.data);
		const width = imageData.width;
		const height = imageData.height;
		const shift = Math.max(0, Math.round(Number(offsetValue) || 0));
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const target = (y * width + x) * 4;
			const red = (y * width + Math.max(0, x - shift)) * 4;
			const blue = (y * width + Math.min(width - 1, x + shift)) * 4;
			imageData.data[target] = source[red];
			imageData.data[target + 2] = source[blue + 2];
		}
		return imageData;
	}

	function gradientMap(imageData, stops) {
		const normalized = [...(stops || [])].sort((a, b) => (a.offset ?? a.at) - (b.offset ?? b.at)).map((entry) => {
			const hex = String(entry.color || '#000000').replace('#', '');
			return { at: Number(entry.offset ?? entry.at), rgb: [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) || 0) };
		});
		if (!normalized.length) return imageData;
		for (let offset = 0; offset < imageData.data.length; offset += 4) {
			const value = (0.2126 * imageData.data[offset] + 0.7152 * imageData.data[offset + 1] + 0.0722 * imageData.data[offset + 2]) / 255;
			let rightIndex = normalized.findIndex((entry) => entry.at >= value);
			if (rightIndex < 0) rightIndex = normalized.length - 1;
			const right = normalized[rightIndex];
			const left = normalized[Math.max(0, rightIndex - 1)];
			const mix = right.at === left.at ? 0 : (value - left.at) / (right.at - left.at);
			for (let channel = 0; channel < 3; channel++) imageData.data[offset + channel] = clampByte(left.rgb[channel] + (right.rgb[channel] - left.rgb[channel]) * mix);
		}
		return imageData;
	}

	function runPixelEffects(imageData, settings, context) {
		const normalized = PixelEffects.normalizeSettings(settings, context.pixelConfig.pixelEffects);
		const animation = normalized.paletteEnabled && normalized.paletteMode === 'dither' && normalized.dither.shimmer
			? PixelEffects.getShimmerAnimation(normalized.dither.algorithm, context.pixelConfig.pixelEffects)
			: null;
		const frame = animation ? ((Math.floor(context.frameIndex || 0) % animation.frames) + animation.frames) % animation.frames : 0;
		const output = PixelEffects.applyPixelEffects(imageData.data, imageData.width, imageData.height, normalized, context.pixelConfig, frame);
		imageData.data.set(output);
		return imageData;
	}

	// Posterize and Dither share the palette analysis settings; a Pixel Size
	// above 1 runs the palette on mosaic cells.
	function paletteSettings(params, context, paletteMode) {
		const defaults = context.pixelDefaults;
		const pixelSize = Number(params.pixelSize) || 1;
		return {
			...defaults, pixelateEnabled: pixelSize > 1, pixelSize, paletteEnabled: true, paletteMode,
			colorCount: params.colors ?? defaults.colorCount,
			paletteStyle: params.style ?? defaults.paletteStyle,
			mergeDistinctness: params.merge ?? defaults.mergeDistinctness,
			detail: params.detail ?? defaults.detail,
			cleanEdges: params.cleanEdges ?? defaults.cleanEdges
		};
	}

	function ditherSettings(params, context) {
		const defaults = context.pixelDefaults.dither;
		return {
			...paletteSettings(params, context, 'dither'),
			dither: {
				...defaults,
				algorithm: params.algorithm ?? defaults.algorithm, strength: params.strength ?? defaults.strength,
				scale: params.scale ?? defaults.scale, angle: params.angle ?? defaults.angle,
				palette: params.palette ?? defaults.palette, duotone: params.duotone ?? defaults.duotone,
				shimmer: Boolean(params.shimmer)
			}
		};
	}

	const FILTER_OPS = Object.freeze({
		tone: Object.freeze({
			id: 'tone', params: Object.freeze({ tone: Object.freeze({ kind: 'tone' }) }),
			css: (params) => Tone.toneCssFilterString(params.tone),
			pixel: (imageData, params, context = {}) => Tone.applyToneToImageData(imageData, params.tone, context.alphaThreshold || 0),
			isActive: (params) => !Tone.isIdentityTone(params.tone)
		}),
		fill: Object.freeze({
			id: 'fill', params: Object.freeze({ color: Object.freeze({ kind: 'color' }), mode: Object.freeze({ kind: 'blendMode' }), opacity: Object.freeze({ min: 0, max: 1 }) }),
			css: (params) => ({ background: params.color, mixBlendMode: params.mode, opacity: params.opacity }),
			pixel: (imageData, params, context = {}) => context.paintOverlay?.(imageData, { kind: 'fill', ...params }),
			isActive: (params) => Number(params.opacity) > 0
		}),
		gradient: Object.freeze({
			id: 'gradient', params: Object.freeze({ gradient: Object.freeze({ kind: 'gradient' }), mode: Object.freeze({ kind: 'blendMode' }), opacity: Object.freeze({ min: 0, max: 1 }) }),
			css: (params, context = {}) => ({ backgroundImage: context.gradientCss?.(params.gradient), mixBlendMode: params.mode, opacity: params.opacity }),
			pixel: (imageData, params, context = {}) => context.paintOverlay?.(imageData, { kind: 'gradient', ...params }),
			isActive: (params) => Number(params.opacity) > 0
		}),
		grain: Object.freeze({
			id: 'grain', params: Object.freeze({ amount: Object.freeze({ min: 0, max: 1 }), size: Object.freeze({ min: 0, max: 100 }), roughness: Object.freeze({ min: 0, max: 1 }), monochrome: Object.freeze({ kind: 'boolean' }), mode: Object.freeze({ kind: 'blendMode' }) }),
			css: (params) => ({ mixBlendMode: params.mode, opacity: params.amount }),
			pixel: (imageData, params, context = {}) => context.paintOverlay?.(imageData, { kind: 'grain', ...params }),
			isActive: (params) => Number(params.amount) > 0
		}),
		blur: Object.freeze({
			id: 'blur', params: Object.freeze({ radius: Object.freeze({ min: 0, max: 64 }), mode: Object.freeze({ kind: 'blendMode' }), opacity: Object.freeze({ min: 0, max: 1 }) }),
			css: (params, context = {}) => ({ backdropFilter: Blur.cssBlurString(params, context.viewScale || 1), WebkitBackdropFilter: Blur.cssBlurString(params, context.viewScale || 1), mixBlendMode: params.mode, opacity: params.opacity }),
			pixel: (imageData, params) => Blur.applyBlurToImageData(imageData, params.radius),
			isActive: (params) => Number(params.radius) > 0 && Number(params.opacity ?? 1) > 0
		}),
		caption: Object.freeze({
			id: 'caption', params: Object.freeze({ text: Object.freeze({ kind: 'string' }) }),
			css: (params) => ({ text: params.text }),
			pixel: (imageData, params, context = {}) => context.drawCaption?.(imageData, params),
			isActive: (params) => Boolean(params.text)
		}),
		jpeg: Object.freeze({
			id: 'jpeg', params: Object.freeze({ quality: Object.freeze({ min: 1, max: 100 }), generations: Object.freeze({ min: 1, max: 8 }), blockSize: Object.freeze({ min: 1, max: 12 }), chromaBleed: Object.freeze({ min: 0, max: 1 }) }),
			pixel: (imageData, params, context = {}) => context.jpegRoundTrip(imageData, params),
			isActive: () => true
		}),
		sharpen: Object.freeze({ id: 'sharpen', params: Object.freeze({ amount: Object.freeze({ min: 0, max: 2 }) }), pixel: (imageData, params) => sharpen(imageData, params.amount), isActive: (params) => Number(params.amount) > 0 }),
		noise: Object.freeze({ id: 'noise', params: Object.freeze({ amount: Object.freeze({ min: 0, max: 1 }) }), pixel: (imageData, params, context = {}) => noise(imageData, params.amount, context.seed), isActive: (params) => Number(params.amount) > 0 }),
		pixelate: Object.freeze({ id: 'pixelate', params: Object.freeze({ size: Object.freeze({ min: 1, max: 8 }) }), pixel: (imageData, params, context = {}) => runPixelEffects(imageData, { ...context.pixelDefaults, pixelateEnabled: true, paletteEnabled: false, pixelSize: params.size }, context), isActive: (params) => Number(params.size) > 1 }),
		posterize: Object.freeze({
			id: 'posterize',
			params: Object.freeze({
				colors: Object.freeze({ min: 2, max: 12 }), style: Object.freeze({ kind: 'string' }), merge: Object.freeze({ min: 0.01, max: 0.12 }),
				detail: Object.freeze({ min: 1, max: 64 }), cleanEdges: Object.freeze({ kind: 'boolean' }), pixelSize: Object.freeze({ min: 1, max: 8 })
			}),
			pixel: (imageData, params, context = {}) => runPixelEffects(imageData, paletteSettings(params, context, 'posterize'), context),
			isActive: () => true
		}),
		dither: Object.freeze({
			id: 'dither',
			params: Object.freeze({
				colors: Object.freeze({ min: 2, max: 12 }), algorithm: Object.freeze({ kind: 'string' }), strength: Object.freeze({ min: 0, max: 100 }),
				scale: Object.freeze({ min: 1, max: 4 }), angle: Object.freeze({ min: 0, max: 360 }), palette: Object.freeze({ kind: 'string' }),
				duotone: Object.freeze({ kind: 'colors' }), shimmer: Object.freeze({ kind: 'boolean' }), style: Object.freeze({ kind: 'string' }),
				merge: Object.freeze({ min: 0.01, max: 0.12 }), pixelSize: Object.freeze({ min: 1, max: 8 })
			}),
			pixel: (imageData, params, context = {}) => runPixelEffects(imageData, ditherSettings(params, context), context),
			isActive: () => true
		}),
		rgbSplit: Object.freeze({ id: 'rgbSplit', params: Object.freeze({ offset: Object.freeze({ min: 0, max: 40 }) }), pixel: (imageData, params) => rgbSplit(imageData, params.offset), isActive: (params) => Number(params.offset) > 0 }),
		gradientMap: Object.freeze({ id: 'gradientMap', params: Object.freeze({ stops: Object.freeze({ kind: 'gradientStops' }) }), pixel: (imageData, params) => gradientMap(imageData, params.stops), isActive: () => true })
	});

	function get(id) {
		return FILTER_OPS[id] || null;
	}

	function list() {
		return Object.values(FILTER_OPS);
	}

	const api = { FILTER_OPS, get, list };
	root.GlitterFilterOps = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
