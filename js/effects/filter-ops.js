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

	const luminance = (data, offset) => (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;

	// `shadows` (0 to 1) moves the grain out of the highlights and into the
	// shadows, the way a small sensor's noise sits in the dark areas. Frames
	// after the first fold their index into the seed, so animated grain moves
	// while a still keeps its pattern.
	// `height` sizes the grain to a sensor that many pixels tall: on a taller
	// image each grain spans several pixels, stretched bilinearly the way the
	// camera's own upscale would. Without it every pixel gets its own grain.
	function noise(imageData, amount = 0, seed = '', { shadows = 0, frameIndex = 0, height = 0 } = {}) {
		let state = 2166136261;
		for (const character of String(frameIndex ? `${seed}:${frameIndex}` : seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
		const scale = Math.max(0, Number(amount) || 0) * 255;
		const shadowWeight = Math.max(0, Math.min(1, Number(shadows) || 0));
		const { width, height: imageHeight, data } = imageData;
		const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967295 - 0.5; };
		const factor = Number(height) > 0 ? Math.min(1, Number(height) / imageHeight) : 1;
		const gridWidth = Math.max(1, Math.round(width * factor)), gridHeight = Math.max(1, Math.round(imageHeight * factor));
		let grid = null;
		if (gridWidth < width || gridHeight < imageHeight) {
			grid = new Float32Array(gridWidth * gridHeight);
			for (let cell = 0; cell < grid.length; cell++) grid[cell] = next();
		}
		for (let y = 0, offset = 0; y < imageHeight; y++) {
			let top = 0, bottom = 0, fy = 0;
			if (grid) {
				const sy = Math.max(0, Math.min(gridHeight - 1, (y + 0.5) * gridHeight / imageHeight - 0.5));
				top = Math.floor(sy); bottom = Math.min(gridHeight - 1, top + 1); fy = sy - top;
			}
			for (let x = 0; x < width; x++, offset += 4) {
				let value;
				if (grid) {
					const sx = Math.max(0, Math.min(gridWidth - 1, (x + 0.5) * gridWidth / width - 0.5));
					const left = Math.floor(sx), right = Math.min(gridWidth - 1, left + 1), fx = sx - left;
					const upper = grid[top * gridWidth + left] + (grid[top * gridWidth + right] - grid[top * gridWidth + left]) * fx;
					const lower = grid[bottom * gridWidth + left] + (grid[bottom * gridWidth + right] - grid[bottom * gridWidth + left]) * fx;
					value = upper + (lower - upper) * fy;
				} else {
					value = next();
				}
				const weight = shadowWeight ? 1 - shadowWeight * luminance(data, offset) : 1;
				const delta = value * scale * weight;
				for (let channel = 0; channel < 3; channel++) data[offset + channel] = clampByte(data[offset + channel] + delta);
			}
		}
		return imageData;
	}

	// The resample scale for a sensor `height` pixels tall, eased in by
	// `amount` (0 keeps the image, 1 is the full sensor).
	function sensorScale(imageHeight, height, amount = 1) {
		const full = Math.min(1, Number(height) / imageHeight);
		return 1 + (full - 1) * Math.max(0, Math.min(1, Number(amount ?? 1)));
	}

	// Softens by resolution: averages down to `scale` of the size, then
	// stretches back bilinearly. Unlike Pixelate's blocks, this loses detail
	// the way a low-resolution sensor does.
	function resample(imageData, scale = 1) {
		const width = imageData.width;
		const height = imageData.height;
		const factor = Math.max(0.05, Math.min(1, Number(scale) || 1));
		const smallWidth = Math.max(1, Math.round(width * factor));
		const smallHeight = Math.max(1, Math.round(height * factor));
		if (smallWidth >= width && smallHeight >= height) return imageData;
		const data = imageData.data;
		const small = new Float32Array(smallWidth * smallHeight * 4);
		const counts = new Float32Array(smallWidth * smallHeight);
		for (let y = 0; y < height; y++) {
			const row = Math.min(smallHeight - 1, Math.floor(y * smallHeight / height)) * smallWidth;
			for (let x = 0; x < width; x++) {
				const cell = row + Math.min(smallWidth - 1, Math.floor(x * smallWidth / width));
				const offset = (y * width + x) * 4;
				for (let channel = 0; channel < 4; channel++) small[cell * 4 + channel] += data[offset + channel];
				counts[cell]++;
			}
		}
		for (let cell = 0; cell < counts.length; cell++) for (let channel = 0; channel < 4; channel++) small[cell * 4 + channel] /= counts[cell] || 1;
		for (let y = 0; y < height; y++) {
			const sy = Math.max(0, Math.min(smallHeight - 1, (y + 0.5) * smallHeight / height - 0.5));
			const top = Math.floor(sy), bottom = Math.min(smallHeight - 1, top + 1), fy = sy - top;
			for (let x = 0; x < width; x++) {
				const sx = Math.max(0, Math.min(smallWidth - 1, (x + 0.5) * smallWidth / width - 0.5));
				const left = Math.floor(sx), right = Math.min(smallWidth - 1, left + 1), fx = sx - left;
				const a = (top * smallWidth + left) * 4, b = (top * smallWidth + right) * 4, c = (bottom * smallWidth + left) * 4, d = (bottom * smallWidth + right) * 4;
				const offset = (y * width + x) * 4;
				for (let channel = 0; channel < 4; channel++) {
					const upper = small[a + channel] + (small[b + channel] - small[a + channel]) * fx;
					const lower = small[c + channel] + (small[d + channel] - small[c + channel]) * fx;
					data[offset + channel] = clampByte(upper + (lower - upper) * fy);
				}
			}
		}
		return imageData;
	}

	// Photoshop's Color Balance: each tonal range gets its own shift along
	// Cyan–Red, Magenta–Green and Yellow–Blue (-1 to 1 per channel). The
	// ranges overlap smoothly, weighted by luminance.
	const COLOR_BALANCE_LEVELS = 96;
	function colorBalance(imageData, { shadows = [0, 0, 0], midtones = [0, 0, 0], highlights = [0, 0, 0] } = {}) {
		const data = imageData.data;
		const shift = (values, channel) => Number(values?.[channel]) || 0;
		for (let offset = 0; offset < data.length; offset += 4) {
			const light = luminance(data, offset);
			const shadowWeight = (1 - light) ** 2, highlightWeight = light ** 2, midWeight = 1 - shadowWeight - highlightWeight;
			for (let channel = 0; channel < 3; channel++) {
				const amount = shadowWeight * shift(shadows, channel) + midWeight * shift(midtones, channel) + highlightWeight * shift(highlights, channel);
				data[offset + channel] = clampByte(data[offset + channel] + amount * COLOR_BALANCE_LEVELS);
			}
		}
		return imageData;
	}

	const isBalanced = (params) => ['shadows', 'midtones', 'highlights'].every((range) => (params[range] || []).every((value) => !Number(value)));

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

	// Warp: at full Amount, Bulge and Pinch raise the radius curve to this
	// power (or its inverse), and Twirl turns the centre this many radians.
	const WARP_RADIAL_POWER = 1.5;
	const WARP_TWIRL_RADIANS = Math.PI * 1.5;

	// Funhouse distortions centred in the image the op receives (the canvas,
	// or the filter region). Inverse mapping: each pixel inside the radius
	// samples the source bilinearly, with edges clamped; pixels outside stay.
	// Radius is a share of half the shorter side.
	function warp(imageData, { shape = 'bulge', amount = 0, radius = 1 } = {}) {
		const width = imageData.width;
		const height = imageData.height;
		const strength = Math.max(0, Math.min(1, Number(amount) || 0));
		const reach = Math.max(1, Math.min(width, height) / 2 * Math.max(0, Number(radius) || 0));
		if (!strength) return imageData;
		const source = new Uint8ClampedArray(imageData.data);
		const data = imageData.data;
		const centerX = (width - 1) / 2;
		const centerY = (height - 1) / 2;
		// Bulge and Pinch are one curve: a power above 1 magnifies the centre,
		// its inverse shrinks it.
		const power = (1 + strength * WARP_RADIAL_POWER) ** (shape === 'pinch' ? -1 : 1);
		const turn = strength * WARP_TWIRL_RADIANS;
		const sample = (x, y, target) => {
			const left = Math.max(0, Math.min(width - 1, Math.floor(x)));
			const top = Math.max(0, Math.min(height - 1, Math.floor(y)));
			const right = Math.min(width - 1, left + 1);
			const bottom = Math.min(height - 1, top + 1);
			const fx = Math.max(0, Math.min(1, x - left));
			const fy = Math.max(0, Math.min(1, y - top));
			const a = (top * width + left) * 4, b = (top * width + right) * 4, c = (bottom * width + left) * 4, d = (bottom * width + right) * 4;
			for (let channel = 0; channel < 4; channel++) {
				const upper = source[a + channel] + (source[b + channel] - source[a + channel]) * fx;
				const lower = source[c + channel] + (source[d + channel] - source[c + channel]) * fx;
				data[target + channel] = upper + (lower - upper) * fy;
			}
		};
		const minX = Math.max(0, Math.floor(centerX - reach)), maxX = Math.min(width - 1, Math.ceil(centerX + reach));
		const minY = Math.max(0, Math.floor(centerY - reach)), maxY = Math.min(height - 1, Math.ceil(centerY + reach));
		for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
			const dx = x - centerX, dy = y - centerY;
			const distance = Math.hypot(dx, dy);
			if (distance >= reach || distance === 0) continue;
			const r = distance / reach;
			let sourceX, sourceY;
			if (shape === 'twirl') {
				const angle = turn * (1 - r) ** 2;
				const cos = Math.cos(angle), sin = Math.sin(angle);
				sourceX = centerX + dx * cos - dy * sin;
				sourceY = centerY + dx * sin + dy * cos;
			} else {
				const scale = r ** power / r;
				sourceX = centerX + dx * scale;
				sourceY = centerY + dy * scale;
			}
			sample(sourceX, sourceY, (y * width + x) * 4);
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
			css: (params, context = {}) => ({
				backgroundImage: context.gradientCss?.(params.gradient), mixBlendMode: params.mode, opacity: params.opacity,
				...(params.animation ? {
					animation: `${params.animation.name} ${params.animation.frames * params.animation.frameMs}ms steps(${params.animation.frames}) infinite`,
					'--filter-crawl-distance': `${params.animation.distance}px`
				} : {})
			}),
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
		noise: Object.freeze({
			id: 'noise', params: Object.freeze({ amount: Object.freeze({ min: 0, max: 1 }), shadows: Object.freeze({ min: 0, max: 1 }), height: Object.freeze({ min: 0, max: 4320 }) }),
			pixel: (imageData, params, context = {}) => noise(imageData, params.amount, context.seed, { shadows: params.shadows, frameIndex: context.frameIndex, height: params.height }),
			isActive: (params) => Number(params.amount) > 0
		}),
		// `scale` is a share of the image; `height` instead resamples to a sensor
		// that many pixels tall, eased in by `amount`.
		resample: Object.freeze({
			id: 'resample', params: Object.freeze({ scale: Object.freeze({ min: 0.05, max: 1 }), height: Object.freeze({ min: 1, max: 4320 }), amount: Object.freeze({ min: 0, max: 1 }) }),
			pixel: (imageData, params) => resample(imageData, params.height ? sensorScale(imageData.height, params.height, params.amount) : params.scale),
			isActive: (params) => Boolean(params.height) ? Number(params.amount ?? 1) > 0 : Number(params.scale) < 1
		}),
		colorBalance: Object.freeze({
			id: 'colorBalance', params: Object.freeze({ shadows: Object.freeze({ kind: 'channels' }), midtones: Object.freeze({ kind: 'channels' }), highlights: Object.freeze({ kind: 'channels' }) }),
			pixel: (imageData, params) => colorBalance(imageData, params),
			isActive: (params) => !isBalanced(params)
		}),
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
		warp: Object.freeze({
			id: 'warp',
			params: Object.freeze({ shape: Object.freeze({ kind: 'string' }), amount: Object.freeze({ min: 0, max: 1 }), radius: Object.freeze({ min: 0, max: 1.5 }) }),
			pixel: (imageData, params) => warp(imageData, params),
			isActive: (params) => Number(params.amount) > 0 && Number(params.radius) > 0
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
