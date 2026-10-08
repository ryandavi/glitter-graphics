'use strict';

// Sparkles: the `sparkles` paint-slot role. A slot scatters small animated
// glyphs (glints, stars, hearts) over its host layer, placed at random but
// repeatably from the slot's seed. The particles live inside the host's
// element, so they move, scale and animate with it.
//
// One layout, two painters (preview and export must match):
//   layout   computeSparkleLayout(data, host) -> particles in host-local px.
//            Pure, seeded with GlitterAnimation.mulberry32. The emitter picks
//            positions: `inside` scatters over the host's opaque pixels,
//            `edges` along the host's outline (its box edge when it has no
//            pixels), `highlights` (Kira Kira) puts one star on each
//            detected highlight (js/effects/highlight-detect.js).
//   motion   sampleSparkleFrame(data, layout, t) samples each particle with a
//            GlitterAnimation motion (particle targets only), period
//            cycleMs / blinks, so every particle returns to its start when
//            the slot's cycle ends and GIF loops close. Bounds-dependent motions
//            use the emitter area and each glyph's visual extent.
//   preview  reconcileSparkleLayer: a .sparkle-layer of masked spans in the
//            host element, transformed each frame by AnimationTicker.
//   export   drawSparkleFrame: the same particles, glyph masks, transforms and
//            paint, drawn by SceneCompositor into the host's surface.
//
// The host supplies its pixels through its type definition's
// sparkleHost(editor, layer) hook: { key, width, height, loadPixels() }.

// ===== GLYPHS =====

// Each glyph draws white into an s x s box. `soft` glyphs keep their partial
// alpha (the halo); every other mask is binarized like all mask sources.
// `pickable` glyphs appear in the Scatter shape chips.
const SPARKLE_GLYPHS = (() => {
	const ray = (ctx, s, angle, length, width) => {
		const half = Math.max(0.9, width);
		ctx.save();
		ctx.translate(s / 2, s / 2);
		ctx.rotate(angle);
		ctx.beginPath();
		ctx.moveTo(0, -length);
		ctx.lineTo(half, 0);
		ctx.lineTo(0, length);
		ctx.lineTo(-half, 0);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	};
	const disc = (ctx, s, radius) => {
		ctx.beginPath();
		ctx.arc(s / 2, s / 2, Math.max(0.8, radius), 0, Math.PI * 2);
		ctx.fill();
	};
	const rays = (ctx, s, specs) => specs.forEach(([degrees, length, width]) => ray(ctx, s, degrees * Math.PI / 180, length * s, width * s));
	const definitions = {
		glint: { label: 'Glint', pickable: true, draw: (ctx, s) => { rays(ctx, s, [[0, 0.5, 0.09], [90, 0.5, 0.09]]); disc(ctx, s, s * 0.08); } },
		sparkle: {
			label: 'Sparkle', pickable: true,
			draw: (ctx, s) => {
				const c = s / 2;
				ctx.beginPath();
				ctx.moveTo(c, 0);
				ctx.quadraticCurveTo(c, c, s, c);
				ctx.quadraticCurveTo(c, c, c, s);
				ctx.quadraticCurveTo(c, c, 0, c);
				ctx.quadraticCurveTo(c, c, c, 0);
				ctx.fill();
			}
		},
		star: {
			label: 'Star', pickable: true,
			draw: (ctx, s) => {
				const c = s / 2;
				ctx.beginPath();
				for (let i = 0; i < 10; i++) {
					const radius = i % 2 ? s * 0.2 : s * 0.5;
					const angle = -Math.PI / 2 + i * Math.PI / 5;
					ctx.lineTo(c + Math.cos(angle) * radius, c + Math.sin(angle) * radius * 1.05 + s * 0.03);
				}
				ctx.closePath();
				ctx.fill();
			}
		},
		heart: {
			label: 'Heart', pickable: true,
			draw: (ctx, s) => {
				ctx.beginPath();
				ctx.moveTo(s * 0.5, s * 0.92);
				ctx.bezierCurveTo(s * 0.1, s * 0.62, s * -0.02, s * 0.36, s * 0.14, s * 0.18);
				ctx.bezierCurveTo(s * 0.28, s * 0.02, s * 0.46, s * 0.1, s * 0.5, s * 0.26);
				ctx.bezierCurveTo(s * 0.54, s * 0.1, s * 0.72, s * 0.02, s * 0.86, s * 0.18);
				ctx.bezierCurveTo(s * 1.02, s * 0.36, s * 0.9, s * 0.62, s * 0.5, s * 0.92);
				ctx.fill();
			}
		},
		dot: { label: 'Dot', pickable: true, draw: (ctx, s) => disc(ctx, s, s * 0.3) },
		snowflake: {
			label: 'Snowflake', pickable: true,
			draw: (ctx, s) => { rays(ctx, s, [[0, 0.5, 0.07], [60, 0.5, 0.07], [120, 0.5, 0.07]]); disc(ctx, s, s * 0.1); }
		},
		// Kira Kira stars: long thin rays, the Glare "streaks" look.
		kira4: {
			label: 'Kira 4', pickable: false,
			draw: (ctx, s) => { rays(ctx, s, [[0, 0.5, 0.06], [90, 0.5, 0.06], [45, 0.2, 0.035], [135, 0.2, 0.035]]); disc(ctx, s, s * 0.07); }
		},
		kira6: {
			label: 'Kira 6', pickable: false,
			draw: (ctx, s) => { rays(ctx, s, [[0, 0.5, 0.05], [60, 0.42, 0.045], [120, 0.42, 0.045]]); disc(ctx, s, s * 0.07); }
		},
		kira8: {
			label: 'Kira 8', pickable: false,
			draw: (ctx, s) => { rays(ctx, s, [[0, 0.5, 0.05], [90, 0.5, 0.05], [45, 0.34, 0.04], [135, 0.34, 0.04]]); disc(ctx, s, s * 0.08); }
		},
		halo: {
			label: 'Halo', pickable: false, soft: true,
			draw: (ctx, s) => {
				const gradient = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
				gradient.addColorStop(0, `rgba(255,255,255,${CONFIG.tools.sparkles.haloAlpha})`);
				gradient.addColorStop(0.35, `rgba(255,255,255,${CONFIG.tools.sparkles.haloAlpha * 0.45})`);
				gradient.addColorStop(1, 'rgba(255,255,255,0)');
				ctx.fillStyle = gradient;
				ctx.fillRect(0, 0, s, s);
			}
		}
	};
	return Object.freeze(Object.fromEntries(Object.entries(definitions).map(([id, entry]) => [
		id,
		Object.freeze({ id, soft: false, ...entry })
	])));
})();

// Kira Kira style tiers: highlight strength -> glyph. Weak highlights get a
// small glint, strong ones a long multi-ray star.
const SPARKLE_STYLE_TIERS = Object.freeze({
	kira: [[0.25, 'glint'], [0.55, 'kira4'], [0.8, 'kira6'], [Infinity, 'kira8']],
	glint: [[Infinity, 'glint']],
	soft: [[0.4, 'dot'], [Infinity, 'sparkle']]
});

// Particle motions come from the one motion library: every motion that
// declares a particle target.
const SPARKLE_BEHAVIORS = Object.freeze(Object.values(GlitterAnimation.MOTION_REGISTRY)
	.filter((motion) => motion.targets.includes('particle'))
	.map((motion) => Object.freeze({ value: motion.id, label: motion.particleLabel || motion.label })));
defineOptions('sparkleBehavior', SPARKLE_BEHAVIORS);

// ===== DATA =====

function buildDefaultSparkles() {
	const defaults = CONFIG.tools.sparkles.defaults;
	const coordinates = CONFIG.rendering.textureCoordinates;
	return {
		mode: defaults.mode,
		color: defaults.color,
		glitterId: null,
		gradient: normalizeEffectGradient(null),
		scale: FIELDS.textureScale.value,
		opacity: FIELDS.slotOpacity.value,
		colorAdjust: null,
		textureAnchor: coordinates.defaultAnchor,
		textureOffsetX: coordinates.defaultOffsetX,
		textureOffsetY: coordinates.defaultOffsetY,
		emitter: defaults.emitter,
		behavior: defaults.behavior,
		glyphs: { ...defaults.glyphs },
		count: FIELDS.sparkleCount.value,
		sizeMin: FIELDS.sparkleSizeMin.value,
		sizeMax: FIELDS.sparkleSizeMax.value,
		cycleMs: FIELDS.sparkleCycle.value,
		sensitivity: FIELDS.sparkleSensitivity.value,
		spacing: FIELDS.sparkleSpacing.value,
		style: defaults.style,
		halo: defaults.halo,
		drawOrder: defaults.drawOrder,
		seed: defaults.seed
	};
}

// Fills in any key an older or partial slot is missing, keeping its values.
function normalizeSparklesData(data) {
	if (!data) return null;
	const merged = mergeSlotEffectDefaults(data, buildDefaultSparkles());
	if (!isOptionValue('sparkleEmitter', merged.emitter)) merged.emitter = CONFIG.tools.sparkles.defaults.emitter;
	if (!isOptionValue('sparkleStyle', merged.style)) merged.style = CONFIG.tools.sparkles.defaults.style;
	if (!isOptionValue('sparkleBehavior', merged.behavior)) merged.behavior = CONFIG.tools.sparkles.defaults.behavior;
	const glyphs = Object.fromEntries(Object.entries(merged.glyphs || {})
		.filter(([id, weight]) => SPARKLE_GLYPHS[id]?.pickable && Number(weight) > 0));
	merged.glyphs = Object.keys(glyphs).length ? glyphs : { ...CONFIG.tools.sparkles.defaults.glyphs };
	normalizeSlotTextureCoordinates(merged);
	return merged;
}

function getSparkleSizeRange(data) {
	const a = Math.max(1, Math.round(Number(data.sizeMin) || 1));
	const b = Math.max(1, Math.round(Number(data.sizeMax) || 1));
	return [Math.min(a, b), Math.max(a, b)];
}

// Pixels a slot may paint past its host box: half the largest halo, at the
// largest scale any particle motion reaches.
function getSparkleFramePadding(data) {
	if (!data) return 0;
	const [, largest] = getSparkleSizeRange(data);
	return Math.ceil(largest * Math.max(CONFIG.tools.sparkles.haloScale, 1.25) / 2) + 2;
}

// The layer's sparkles slots that draw something, in declaration order.
function getLayerSparkleEntries(layer) {
	return getLayerPaintSlots(layer).filter((entry) => entry.role === 'sparkles' && entry.renders);
}

function getSparkleSampleKey(layer, entry) {
	return `${layer.id}:${entry.key}`;
}

// ===== LAYOUT =====

function getSparkleLayoutKey(data) {
	const glyphs = Object.keys(data.glyphs || {}).sort().map((id) => `${id}=${data.glyphs[id]}`).join(',');
	return JSON.stringify([
		data.emitter, data.count, ...getSparkleSizeRange(data), data.seed, glyphs,
		data.emitter === 'highlights' ? [data.sensitivity, data.spacing, data.style, Boolean(data.halo)] : null
	]);
}

function pickWeightedGlyph(glyphs, random) {
	const entries = Object.entries(glyphs);
	const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
	let roll = random() * total;
	for (const [id, weight] of entries) {
		roll -= Number(weight);
		if (roll < 0) return id;
	}
	return entries[entries.length - 1][0];
}

function pickStyleGlyph(style, strength) {
	return SPARKLE_STYLE_TIERS[style].find(([limit]) => strength < limit)[1];
}

function finishSparkleParticle(particle, random, tilt) {
	const [low, high] = CONFIG.tools.sparkles.blinksPerCycle;
	particle.blinks = low + Math.floor(random() * (high - low + 1));
	particle.phase = random();
	particle.rotation = (random() - 0.5) * tilt;
	return particle;
}

// Opaque analysis pixels with a transparent (or out-of-bounds) 4-neighbor,
// as a flat [x0, y0, x1, y1, ...] list.
function collectSparkleEdgePoints(pixels) {
	const { data, width, height } = pixels;
	const threshold = CONFIG.rendering.maskAlphaThreshold;
	const opaque = (x, y) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= threshold;
	const points = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (opaque(x, y) && (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1))) points.push(x, y);
		}
	}
	return points;
}

// host: { width, height, pixels } in host-local px; pixels (optional) is the
// host downscaled to analysis size, { data, width, height }.
function computeSparkleLayout(data, host) {
	const config = CONFIG.tools.sparkles;
	const random = GlitterAnimation.mulberry32(GlitterAnimation.hashString(`sparkles:${data.seed}`));
	const width = Math.max(1, host.width);
	const height = Math.max(1, host.height);
	const pixels = host.pixels || null;
	const scaleX = pixels ? pixels.width / width : 1;
	const scaleY = pixels ? pixels.height / height : 1;
	const count = Math.max(0, Math.min(config.maxCount, Math.round(Number(data.count) || 0)));
	const [low, high] = getSparkleSizeRange(data);
	const particles = [];

	if (data.emitter === 'highlights') {
		if (!pixels) return particles;
		const peaks = GlitterHighlightDetect.detect(pixels, {
			maxCount: count,
			spacing: Math.max(1, Number(data.spacing) || 1) * scaleX,
			sensitivity: data.sensitivity,
			random
		});
		peaks.forEach((peak) => {
			particles.push(finishSparkleParticle({
				x: (peak.x + 0.5) / scaleX,
				y: (peak.y + 0.5) / scaleY,
				size: Math.round(low + (high - low) * peak.strength),
				glyph: pickStyleGlyph(data.style, peak.strength),
				halo: Boolean(data.halo) && (data.style === 'soft' || peak.strength >= config.haloStrength),
				strength: peak.strength
			}, random, config.tiltDegrees / 3));
		});
	} else {
		let pickPoint;
		let accept = () => true;
		if (data.emitter === 'edges') {
			const edges = pixels ? collectSparkleEdgePoints(pixels) : null;
			if (edges && !edges.length) return particles;
			pickPoint = edges
				? () => {
					const i = Math.floor(random() * edges.length / 2) * 2;
					return [(edges[i] + random()) / scaleX, (edges[i + 1] + random()) / scaleY];
				}
				: () => {
					// A point on the box's perimeter.
					let d = random() * 2 * (width + height);
					if (d < width) return [d, 0];
					d -= width;
					if (d < height) return [width, d];
					d -= height;
					if (d < width) return [width - d, height];
					return [0, height - (d - width)];
				};
		} else {
			pickPoint = () => [random() * width, random() * height];
			accept = (x, y) => {
				if (!pixels) return true;
				const px = Math.min(pixels.width - 1, Math.floor(x * scaleX));
				const py = Math.min(pixels.height - 1, Math.floor(y * scaleY));
				return pixels.data[(py * pixels.width + px) * 4 + 3] >= CONFIG.rendering.maskAlphaThreshold;
			};
		}
		const minGap = (low + high) / 4;
		const attempts = count * 40;
		for (let attempt = 0; attempt < attempts && particles.length < count; attempt++) {
			const [x, y] = pickPoint();
			const size = Math.round(low + (high - low) * Math.pow(random(), 1.5));
			const glyph = pickWeightedGlyph(data.glyphs, random);
			if (!accept(x, y)) continue;
			// Crowding relaxes as attempts run out, so small hosts still fill.
			const gap = minGap * (1 - attempt / attempts);
			if (particles.some((other) => Math.hypot(other.x - x, other.y - y) < gap)) continue;
			particles.push(finishSparkleParticle({ x, y, size, glyph, halo: false, strength: 1 }, random, config.tiltDegrees));
		}
	}
	particles.forEach((particle, index) => {
		particle.index = index;
		particle.areaHeight = height;
		particle.areaWidth = width;
	});
	return particles;
}

// A wrapping particle's center stays within the emitter area plus its own
// half extent, so it leaves one edge fully before entering the other.
function getSparkleWrapMargin(particle) {
	return (particle.halo ? getSparkleHaloSize(particle) : particle.size) / 2;
}

// ===== MOTION =====

// Every particle's pose at time tMs (the slot's cycle clock). Preview and
// export both call this with the same layout and time. Particles sample the
// cycle-local time: each particle's period divides the cycle, so progress is
// unchanged, and time-seeded motions (twinkle's flicker) repeat every cycle
// instead of drifting, so the loop closes exactly.
function sampleSparkleFrame(data, layout, tMs, sampleKey) {
	const cycle = Math.max(1, Number(data.cycleMs) || FIELDS.sparkleCycle.value);
	const base = GlitterAnimation.normalizeAnimation({ type: data.behavior });
	const localTime = ((Number(tMs) || 0) % cycle + cycle) % cycle;
	return layout.map((particle) => {
		const margin = getSparkleWrapMargin(particle);
		const context = GlitterAnimation.createSamplingContext({ area: { width: particle.areaWidth, height: particle.areaHeight }, rest: { left: particle.x - margin, top: particle.y - margin, right: particle.x + margin, bottom: particle.y + margin }, id: `${sampleKey}:${particle.index}`, seed: data.seed });
		const sample = GlitterAnimation.sampleAt({
			...base,
			...GlitterAnimation.MOTION_REGISTRY[base.type].particleData?.(context),
			periodMs: cycle / particle.blinks,
			phase: particle.phase,
			delayMs: 0,
			direction: 'normal',
			iterations: Infinity,
			fillMode: 'none',
			snapMode: 'smooth'
		}, localTime, context);
		return {
			particle,
			tx: sample.tx,
			ty: sample.ty,
			rotate: particle.rotation + sample.rotate,
			scaleX: sample.scaleX,
			scaleY: sample.scaleY,
			opacity: sample.opacity
		};
	});
}

function getSparkleHaloSize(particle) {
	return Math.max(2, Math.round(particle.size * CONFIG.tools.sparkles.haloScale));
}

// Box of a particle (or its halo) relative to the host: top-left corner and
// side. Integers, so preview spans and export canvases align.
function getSparkleParticleBox(particle, size = particle.size) {
	return {
		left: Math.round(particle.x - size / 2),
		top: Math.round(particle.y - size / 2),
		size
	};
}

// ===== GLYPH MASKS =====

const SPARKLE_MASK_CACHE = new Map();

function getSparkleGlyphMask(glyphId, size) {
	const key = `${glyphId}:${size}`;
	let mask = SPARKLE_MASK_CACHE.get(key);
	if (mask) return mask;
	const glyph = SPARKLE_GLYPHS[glyphId] || SPARKLE_GLYPHS.dot;
	const canvas = createAppCanvas(size, size, 'paint/sparkles');
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#ffffff';
	glyph.draw(ctx, size);
	if (!glyph.soft && shouldUseCrispMaskEdges()) binarizeCanvasAlpha(ctx);
	mask = { canvas, url: null };
	SPARKLE_MASK_CACHE.set(key, mask);
	return mask;
}

function getSparkleGlyphMaskUrl(glyphId, size) {
	const mask = getSparkleGlyphMask(glyphId, size);
	mask.url ||= mask.canvas.toDataURL('image/png');
	return mask.url;
}

// ===== HOST PIXELS AND LAYOUT CACHE =====

// Host pixels are read once per host content key and downscaled to analysis
// size; layouts are cached per host key + layout key. Both are small LRUs.
const SPARKLE_PIXEL_CACHE = new Map();
const SPARKLE_LAYOUT_CACHE = new Map();
const SPARKLE_CACHE_LIMIT = 24;

function touchSparkleCache(cache, key, value) {
	cache.delete(key);
	cache.set(key, value);
	while (cache.size > SPARKLE_CACHE_LIMIT) cache.delete(cache.keys().next().value);
	return value;
}

function getSparkleHost(editor, layer) {
	return LAYER_UI_CONFIG[layer?.type]?.sparkleHost?.(editor, layer) || null;
}

// Draw any drawable (canvas, image, ImageData) into the analysis canvas that
// covers the host box, and read it back.
function readSparkleAnalysisPixels(source, hostWidth, hostHeight) {
	if (!source) return null;
	const maxSide = CONFIG.tools.sparkles.analysisMaxSide;
	const factor = Math.min(1, maxSide / Math.max(hostWidth, hostHeight));
	const width = Math.max(1, Math.round(hostWidth * factor));
	const height = Math.max(1, Math.round(hostHeight * factor));
	let drawable = source;
	if (!(source instanceof HTMLCanvasElement) && !(source instanceof HTMLImageElement)) {
		const imageData = source instanceof ImageData ? source : new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
		drawable = createAppCanvas(imageData.width, imageData.height, 'paint/sparkles');
		drawable.getContext('2d').putImageData(imageData, 0, 0);
	}
	const canvas = createAppCanvas(width, height, 'paint/sparkles');
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(drawable, 0, 0, width, height);
	const pixels = ctx.getImageData(0, 0, width, height);
	canvas.width = canvas.height = 0;
	if (drawable !== source) drawable.width = drawable.height = 0;
	return { data: pixels.data, width, height };
}

function loadSparkleHostPixels(host) {
	const key = `${host.key}|${host.width}x${host.height}`;
	const cached = SPARKLE_PIXEL_CACHE.get(key);
	if (cached) return touchSparkleCache(SPARKLE_PIXEL_CACHE, key, cached);
	const promise = Promise.resolve()
		.then(() => host.loadPixels())
		.then((source) => readSparkleAnalysisPixels(source, host.width, host.height))
		.catch((error) => {
			console.warn('Sparkles: could not read host pixels', error);
			return null;
		});
	return touchSparkleCache(SPARKLE_PIXEL_CACHE, key, promise);
}

function getSparkleLayoutCacheKey(host, data) {
	return `${host.key}|${host.width}x${host.height}|${getSparkleLayoutKey(data)}`;
}

// The layout if it is ready, else null (and it starts building; onReady runs
// once it is). The preview uses this so a slow host never blocks a render.
function peekSparkleLayout(editor, layer, entry, onReady = null) {
	const host = getSparkleHost(editor, layer);
	if (!host) return null;
	const key = getSparkleLayoutCacheKey(host, entry.data);
	const cached = SPARKLE_LAYOUT_CACHE.get(key);
	if (cached?.layout) return cached.layout;
	if (!cached) {
		const data = { ...entry.data, glyphs: { ...entry.data.glyphs } };
		const state = { layout: null, promise: null };
		state.promise = loadSparkleHostPixels(host).then((pixels) => {
			state.layout = computeSparkleLayout(data, { width: host.width, height: host.height, pixels });
			return state.layout;
		});
		touchSparkleCache(SPARKLE_LAYOUT_CACHE, key, state);
		if (onReady) state.promise.then(onReady);
	} else if (onReady) {
		cached.promise.then(onReady);
	}
	return null;
}

// Export waits for every layout before composing any frame.
async function prepareSparkleLayouts(editor, layers) {
	const pending = [];
	layers.forEach((layer) => {
		getLayerSparkleEntries(layer).forEach((entry) => {
			if (peekSparkleLayout(editor, layer, entry)) return;
			const host = getSparkleHost(editor, layer);
			const state = host && SPARKLE_LAYOUT_CACHE.get(getSparkleLayoutCacheKey(host, entry.data));
			if (state?.promise) pending.push(state.promise);
		});
	});
	await Promise.all(pending);
}

// Hosts whose pixels come from a finished canvas (text and shape masks)
// paint it with the fill's solid color so highlight detection sees the
// letters' own brightness; other fills read as white.
function paintSparkleMaskHost(maskCanvas, fill) {
	const canvas = createAppCanvas(maskCanvas.width, maskCanvas.height, 'paint/sparkles');
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = fill?.mode === 'solid' ? fill.color : '#ffffff';
	if (fill?.mode === 'gradient') {
		ctx.fillStyle = createEffectCanvasGradient(ctx, normalizeEffectGradient(fill.gradient), { x: 0, y: 0, width: canvas.width, height: canvas.height });
	}
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.globalCompositeOperation = 'destination-in';
	ctx.drawImage(maskCanvas, 0, 0);
	return canvas;
}

function getSparkleMaskHostKey(fill) {
	if (fill?.mode === 'solid') return `solid:${fill.color}`;
	if (fill?.mode === 'gradient') return `gradient:${JSON.stringify(fill.gradient)}`;
	return 'white';
}

// A still or animated image host (stickers). Animated GIFs are detected on
// the mean of their frames: persistently bright spots win and flicker is
// ignored, so the stars stay put while the GIF plays.
function loadSparkleImageHostPixels(url, isAnimated) {
	if (isAnimated) {
		return decodeGifFromUrl(url).then((decoded) => GlitterHighlightDetect.meanFrames(
			decoded.frames.map((frame) => frame.imageData)
		));
	}
	return loadImageElement(url);
}

// ===== EXPORT =====

// Draw one slot's particles at time tMs into ctx, in host-local px mapped by
// (offsetX, offsetY, scaleX, scaleY). The scale applies before each
// particle's rotation, so a surface later stretched back to the host box (a
// sticker image drawn at its own pixel density) shows the same shapes as the
// preview. paintParticle(maskCanvas, textureOrigin) returns a canvas the size
// of the mask with the slot paint inside it; the compositor supplies it so
// glitter frames resolve like any other slot.
function drawSparkleFrame(ctx, data, layout, tMs, sampleKey, paintParticle, { offsetX = 0, offsetY = 0, scaleX = 1, scaleY = 1 } = {}) {
	sampleSparkleFrame(data, layout, tMs, sampleKey).forEach((item) => {
		if (item.opacity <= 0 || item.scaleX === 0 || item.scaleY === 0) return;
		const { particle } = item;
		const box = getSparkleParticleBox(particle);
		ctx.save();
		ctx.globalAlpha *= item.opacity;
		ctx.translate(offsetX, offsetY);
		ctx.scale(scaleX, scaleY);
		ctx.translate(box.left + box.size / 2 + item.tx, box.top + box.size / 2 + item.ty);
		ctx.rotate(item.rotate * Math.PI / 180);
		ctx.scale(item.scaleX, item.scaleY);
		if (particle.halo) {
			const haloSize = getSparkleHaloSize(particle);
			const halo = getSparkleParticleBox(particle, haloSize);
			const painted = paintParticle(getSparkleGlyphMask('halo', haloSize).canvas, { x: -halo.left, y: -halo.top });
			ctx.drawImage(painted, -haloSize / 2, -haloSize / 2, haloSize, haloSize);
		}
		const painted = paintParticle(getSparkleGlyphMask(particle.glyph, box.size).canvas, { x: -box.left, y: -box.top });
		ctx.drawImage(painted, -box.size / 2, -box.size / 2, box.size, box.size);
		ctx.restore();
	});
}

// ===== DOM PREVIEW =====

// Paint spans are sized in percent of their particle box, so a particle
// placed in percent of a stretched host (fitBox) stretches with it.
function applySparkleMask(span, url, offset, size, particleSize) {
	const percent = (value) => `${value / particleSize * 100}%`;
	span.style.left = percent(offset.x);
	span.style.top = percent(offset.y);
	span.style.width = percent(size);
	span.style.height = percent(size);
	span.style.maskImage = `url(${url})`;
	span.style.webkitMaskImage = `url(${url})`;
	span.style.maskSize = '100% 100%';
	span.style.webkitMaskSize = '100% 100%';
}

function paintSparkleSpan(span, source, glitterLibrary, layer, size, origin) {
	applyPaintSourceToElement(span, source, {
		glitterLibrary,
		layer,
		maskCanvas: { width: size, height: size, _textureOrigin: origin }
	});
}

// fitBox: the host element is sized to its scaled box instead of scaled by
// CSS (stickers), so particles are placed in percent of the host box.
function reconcileSparkleParticles(container, layout, source, options) {
	const { glitterLibrary, layer, width, height, fitBox } = options;
	const x = (value) => (fitBox ? `${value / width * 100}%` : `${value}px`);
	const y = (value) => (fitBox ? `${value / height * 100}%` : `${value}px`);
	const existing = Array.from(container.children);
	layout.forEach((particle, index) => {
		let element = existing[index];
		if (!element) {
			element = document.createElement('span');
			element.className = 'sparkle-particle';
			container.appendChild(element);
		}
		const box = getSparkleParticleBox(particle);
		element.style.left = x(box.left);
		element.style.top = y(box.top);
		element.style.width = x(box.size);
		element.style.height = y(box.size);
		let halo = element.querySelector(':scope > .sparkle-halo');
		let glyph = element.querySelector(':scope > .sparkle-glyph');
		if (particle.halo && !halo) {
			halo = document.createElement('span');
			halo.className = 'sparkle-paint sparkle-halo';
			element.prepend(halo);
		} else if (!particle.halo && halo) {
			halo.remove();
			halo = null;
		}
		if (!glyph) {
			glyph = document.createElement('span');
			glyph.className = 'sparkle-paint sparkle-glyph';
			element.appendChild(glyph);
		}
		if (halo) {
			const haloSize = getSparkleHaloSize(particle);
			const haloBox = getSparkleParticleBox(particle, haloSize);
			applySparkleMask(halo, getSparkleGlyphMaskUrl('halo', haloSize), { x: haloBox.left - box.left, y: haloBox.top - box.top }, haloSize, box.size);
			paintSparkleSpan(halo, source, glitterLibrary, layer, haloSize, { x: -haloBox.left, y: -haloBox.top });
		}
		applySparkleMask(glyph, getSparkleGlyphMaskUrl(particle.glyph, box.size), { x: 0, y: 0 }, box.size, box.size);
		paintSparkleSpan(glyph, source, glitterLibrary, layer, box.size, { x: -box.left, y: -box.top });
	});
	existing.slice(layout.length).forEach((element) => element.remove());
}

function paintSparkleParticleFrame(container, data, layout, tMs, sampleKey) {
	const elements = container.children;
	sampleSparkleFrame(data, layout, tMs, sampleKey).forEach((item, index) => {
		const element = elements[index];
		if (!element) return;
		element.style.transform = `translate(${item.tx}px, ${item.ty}px) rotate(${item.rotate}deg) scale(${item.scaleX}, ${item.scaleY})`;
		element.style.opacity = String(item.opacity);
	});
}

// Reconcile every sparkles slot of a layer inside `parent` (the host's
// content surface, sized width x height in host-local px). Slots drawn behind
// go before behindAnchor (default: first among parent's children), slots in
// front go last; callers run this after reconciling their own content.
function reconcileSparkleLayers(parent, layer, options) {
	const { editor, width, height, behindAnchor = null, fitBox = false } = options;
	if (!parent) return;
	const ticker = editor.animationTicker;
	const entries = getLayerSparkleEntries(layer);
	const keep = new Set(entries.map((entry) => entry.key));
	parent.querySelectorAll(':scope > .sparkle-layer').forEach((container) => {
		if (keep.has(container.dataset.slotKey)) return;
		ticker?.unregister(`${layer.id}:sparkles:${container.dataset.slotKey}`);
		container.remove();
	});
	entries.forEach((entry) => {
		let container = parent.querySelector(`:scope > .sparkle-layer[data-slot-key="${entry.key}"]`);
		if (!container) {
			container = document.createElement('div');
			container.className = 'sparkle-layer';
			container.dataset.slotKey = entry.key;
		}
		container.style.width = fitBox ? '100%' : `${width}px`;
		container.style.height = fitBox ? '100%' : `${height}px`;
		container.dataset.order = entry.data.drawOrder === 'behind' ? 'behind' : 'front';
		if (entry.data.drawOrder === 'behind') {
			const anchor = behindAnchor?.parentNode === parent ? behindAnchor : parent.firstChild;
			if (container !== anchor) parent.insertBefore(container, anchor);
		} else if (parent.lastChild !== container) {
			parent.appendChild(container);
		}

		const layout = peekSparkleLayout(editor, layer, entry, () => editor.requestPreviewUpdate());
		if (!layout) return;
		const source = resolvePaintSlotPreviewSource(editor, layer, entry);
		reconcileSparkleParticles(container, source ? layout : [], source, { glitterLibrary: editor.glitterLibrary, layer, width, height, fitBox });
		const data = entry.data;
		const sampleKey = getSparkleSampleKey(layer, entry);
		ticker?.register(`${layer.id}:sparkles:${entry.key}`, {
			getData: () => data,
			getLayer: () => layer,
			getWrapper: () => container,
			paint: (tMs) => paintSparkleParticleFrame(container, data, layout, tMs, sampleKey)
		});
	});
}

// ===== PRESETS =====

// Presets set where, what, how many and how they move, plus a sparkle color
// for the solid source. The paint source mode stays the user's.
const SPARKLE_PRESETS = GlitterPresetLibrary.createPresetLibrary({
	id: 'sparkles',
	groups: [
		{ id: 'scatter', label: 'Scatter' },
		{ id: 'weather', label: 'Weather' },
		{ id: 'kira', label: 'Kira Kira' }
	],
	entries: [
		{ id: 'blingee-sparkle', label: 'Blingee Sparkle', group: 'scatter', value: {
			emitter: 'inside', behavior: 'glint', glyphs: { sparkle: 3, glint: 2, dot: 1 },
			count: 16, sizeMin: 8, sizeMax: 22, cycleMs: 2400, color: '#ffffff'
		} },
		{ id: 'glint-burst', label: 'Glint Burst', group: 'scatter', value: {
			emitter: 'inside', behavior: 'glint', glyphs: { glint: 1 },
			count: 28, sizeMin: 6, sizeMax: 16, cycleMs: 1200, color: '#ffffff'
		} },
		{ id: 'star-field', label: 'Star Field', group: 'scatter', value: {
			emitter: 'inside', behavior: 'twinkle', glyphs: { star: 2, dot: 3 },
			count: 40, sizeMin: 4, sizeMax: 12, cycleMs: 3000, color: '#fff6b0'
		} },
		{ id: 'winter-snow', label: 'Winter Snow', group: 'weather', value: {
			emitter: 'inside', behavior: 'fall', glyphs: { snowflake: 2, dot: 3 },
			count: 45, sizeMin: 4, sizeMax: 14, cycleMs: 6000, color: '#ffffff'
		} },
		{ id: 'falling-hearts', label: 'Falling Hearts', group: 'weather', value: {
			emitter: 'inside', behavior: 'fall', glyphs: { heart: 1 },
			count: 18, sizeMin: 8, sizeMax: 20, cycleMs: 5000, color: '#ff6fb5'
		} },
		{ id: 'confetti', label: 'Confetti', group: 'weather', value: {
			emitter: 'inside', behavior: 'fall', glyphs: { star: 1, dot: 2, heart: 1 },
			count: 50, sizeMin: 4, sizeMax: 10, cycleMs: 3600, color: '#ffd84a'
		} },
		{ id: 'fairy-dust', label: 'Fairy Dust', group: 'weather', value: {
			emitter: 'edges', behavior: 'twinkle', glyphs: { sparkle: 2, dot: 3 },
			count: 36, sizeMin: 4, sizeMax: 12, cycleMs: 2400, color: '#fff1a8'
		} },
		{ id: 'kira-kira', label: 'Kira Kira', group: 'kira', value: {
			emitter: 'highlights', behavior: 'glint', style: 'kira', halo: true,
			sensitivity: 55, count: 24, spacing: 20, sizeMin: 10, sizeMax: 34, cycleMs: 2400, color: '#ffffff'
		} },
		{ id: 'purikura', label: 'Purikura', group: 'kira', value: {
			emitter: 'highlights', behavior: 'glint', style: 'soft', halo: true,
			sensitivity: 65, count: 36, spacing: 14, sizeMin: 8, sizeMax: 22, cycleMs: 1800, color: '#ffe4f5'
		} },
		{ id: 'diamond-glint', label: 'Diamond Glint', group: 'kira', value: {
			emitter: 'highlights', behavior: 'glint', style: 'kira', halo: false,
			sensitivity: 40, count: 12, spacing: 30, sizeMin: 14, sizeMax: 44, cycleMs: 2000, color: '#ffffff'
		} },
		{ id: 'soft-shine', label: 'Soft Shine', group: 'kira', value: {
			emitter: 'highlights', behavior: 'pulse', style: 'soft', halo: true,
			sensitivity: 50, count: 18, spacing: 24, sizeMin: 10, sizeMax: 26, cycleMs: 3200, color: '#fffbe8'
		} }
	],
	renderThumbnail(entry, element) {
		element.classList.add('is-drawn');
		element.style.backgroundImage = `url(${getSparklePresetThumbnail(entry)})`;
	},
	apply(entry, target, value) {
		if (target) Object.assign(target, value);
	}
});

const SPARKLE_THUMBNAIL_CACHE = new Map();

// A few of the preset's glyphs, drawn once per preset on a transparent tile;
// the preset grid supplies the dark backdrop.
function getSparklePresetThumbnail(entry) {
	if (SPARKLE_THUMBNAIL_CACHE.has(entry.id)) return SPARKLE_THUMBNAIL_CACHE.get(entry.id);
	const size = 48;
	const canvas = createAppCanvas(size, size, 'paint/sparkles');
	const ctx = canvas.getContext('2d');
	const value = entry.value;
	const glyphs = value.emitter === 'highlights'
		? SPARKLE_STYLE_TIERS[value.style].map(([, glyph]) => glyph)
		: Object.keys(value.glyphs);
	const spots = [[0.3, 0.32, 0.5], [0.72, 0.28, 0.32], [0.62, 0.7, 0.42], [0.25, 0.74, 0.26]];
	spots.forEach(([x, y, scale], index) => {
		const glyphSize = Math.round(size * scale);
		const mask = getSparkleGlyphMask(glyphs[index % glyphs.length], glyphSize).canvas;
		const tinted = createAppCanvas(glyphSize, glyphSize, 'paint/sparkles');
		const tintCtx = tinted.getContext('2d');
		tintCtx.fillStyle = value.color || '#ffffff';
		tintCtx.fillRect(0, 0, glyphSize, glyphSize);
		tintCtx.globalCompositeOperation = 'destination-in';
		tintCtx.drawImage(mask, 0, 0);
		ctx.drawImage(tinted, Math.round(x * size - glyphSize / 2), Math.round(y * size - glyphSize / 2));
		tinted.width = tinted.height = 0;
	});
	const url = canvas.toDataURL('image/png');
	canvas.width = canvas.height = 0;
	SPARKLE_THUMBNAIL_CACHE.set(entry.id, url);
	return url;
}

// The preset a slot currently matches, if any (presets are copied, never
// referenced, so this compares values).
function findSparklePresetId(data) {
	if (!data) return null;
	const same = (a, b) => (a && typeof a === 'object' ? JSON.stringify(a) === JSON.stringify(b) : a === b);
	return SPARKLE_PRESETS.entries.find((entry) => Object.entries(entry.value)
		.every(([key, value]) => same(value, data[key])))?.id || null;
}
