'use strict';

const GlitterAnimation = (() => {
	const ANIMATION_TYPES = Object.freeze([
		'breath', 'float', 'sway', 'dim', 'drift', 'twinkle',
		'pulse', 'heartbeat', 'blink', 'bounce', 'shake', 'tremble',
		'wobble', 'jello', 'tada', 'swing', 'rubber-band',
		'move', 'orbit', 'rotate', 'flip', 'zoom', 'ping', 'marquee', 'rainbow'
	]);
	const IDENTITY = Object.freeze({
		tx: 0, ty: 0, rotate: 0, scaleX: 1, scaleY: 1,
		skewX: 0, skewY: 0, opacity: 1, originX: 0.5, originY: 0.5, hue: 0
	});
	const BASE_DEFAULTS = Object.freeze({
		periodMs: 1000, easing: 'linear', steps: 2, direction: 'normal', iterations: Infinity,
		delayMs: 0, phase: 0, fillMode: 'none', amount: 0, angle: 0, distance: 0,
		radius: 0, turns: 0, duty: 50, opacityFloor: 0, overshoot: 0,
		anchor: 'center', anchorX: 0.5, anchorY: 0.5, snapMode: 'smooth'
	});

	function config() {
		return typeof CONFIG !== 'undefined' ? CONFIG.tools.animation : null;
	}

	function normalizeAnimation(value = {}) {
		const cfg = config();
		if (!cfg) throw new Error('CONFIG.tools.animation is required');
		const requested = value && typeof value === 'object' ? value : {};
		const type = ANIMATION_TYPES.includes(requested.type) ? requested.type : cfg.defaultType;
		const normalized = { ...BASE_DEFAULTS, ...cfg.presets[type], ...requested, type };
		if (requested.iterations == null || requested.iterations === 'Infinity') {
			normalized.iterations = cfg.presets[type].iterations;
		}
		return normalized;
	}

	function isActive(value) {
		if (!value || !ANIMATION_TYPES.includes(value.type)) return false;
		const data = normalizeAnimation(value);
		if (['dim', 'twinkle'].includes(data.type)) return data.opacityFloor < 100;
		if (data.type === 'blink') return data.duty > 0 && data.duty < 100;
		if (['orbit', 'ping'].includes(data.type)) return data.radius !== 0;
		if (['rotate', 'flip'].includes(data.type)) return data.turns !== 0;
		if (['move', 'drift', 'marquee'].includes(data.type)) return data.distance !== 0;
		if (data.type === 'rainbow') return true;
		return data.amount !== 0;
	}

	function includesOffCanvas(value) {
		return isActive(value) && normalizeAnimation(value).includeWhenOffCanvas === true;
	}

	function summaryText(value) {
		if (!isActive(value)) return 'Off';
		const data = normalizeAnimation(value);
		return data.type.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
	}

	function loopDurationMs(value) {
		const data = normalizeAnimation(value);
		return Number.isFinite(data.iterations) ? data.periodMs * Math.max(0, data.iterations) : Infinity;
	}

	function hashString(value) {
		let hash = 2166136261;
		for (const character of String(value)) {
			hash ^= character.charCodeAt(0);
			hash = Math.imul(hash, 16777619);
		}
		return hash >>> 0;
	}

	function mulberry32(seed) {
		let value = seed >>> 0;
		return () => {
			value += 0x6D2B79F5;
			let mixed = value;
			mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
			mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
			return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
		};
	}

	function seededRandom01(layerId, tMs, seed = 0) {
		const quantum = config().jitterQuantMs;
		return mulberry32(hashString(layerId) ^ Math.floor(Number(tMs) / quantum) ^ (Number(seed) || 0))();
	}

	function resolveOrigin(data) {
		if (data.anchor === 'custom') return [Number(data.anchorX), Number(data.anchorY)];
		const values = {
			'top-left': [0, 0], 'top-center': [0.5, 0], 'top-right': [1, 0],
			'center-left': [0, 0.5], center: [0.5, 0.5], 'center-right': [1, 0.5],
			'bottom-left': [0, 1], 'bottom-center': [0.5, 1], 'bottom-right': [1, 1]
		};
		return values[data.anchor] || values.center;
	}

	function directedProgress(progress, cycle, direction) {
		const reverse = direction === 'reverse'
			|| (direction === 'alternate' && cycle % 2 === 1)
			|| (direction === 'alternate-reverse' && cycle % 2 === 0);
		return reverse ? 1 - progress : progress;
	}

	function pose(data, progress, tMs, options) {
		let p = GlitterEasing.easingFn(data.easing, { steps: data.steps })(progress);
		if (data.snapMode === 'step' && data.easing !== 'steps') p = GlitterEasing.stepsEase(p, data.steps);
		const out = { ...IDENTITY };
		[out.originX, out.originY] = resolveOrigin(data);
		const amount = Number(data.amount) || 0;
		const wave = Math.sin(Math.PI * p);
		const oscillation = Math.sin(Math.PI * 2 * p);
		const angle = (Number(data.angle) || 0) * Math.PI / 180;
		const vector = (distance) => { out.tx += Math.cos(angle) * distance; out.ty += Math.sin(angle) * distance; };
		const random = (salt = 0) => seededRandom01(options.layerId, tMs, (options.seed || 0) + salt) * 2 - 1;
		switch (data.type) {
			case 'breath': out.scaleX = out.scaleY = 1 + amount / 100 * oscillation; break;
			// Float stays on a deterministic axis; Shake and Tremble own jitter.
			case 'float': {
				const lift = amount * oscillation;
				out.tx += Math.cos(angle) * lift;
				out.ty += Math.sin(angle) * lift;
				break;
			}
			case 'sway': out.rotate = amount * oscillation; break;
			case 'dim': out.opacity = 1 - (1 - data.opacityFloor / 100) * wave; break;
			case 'drift': vector((Number(data.distance) || amount) * p); break;
			case 'twinkle': out.opacity = random(2) < (data.duty / 50 - 1) ? 1 : data.opacityFloor / 100; if (p === 0 || p === 1) out.opacity = 1; break;
			case 'pulse': out.scaleX = out.scaleY = 1 + amount / 100 * wave; break;
			case 'heartbeat': {
				const thump = p < 0.18 ? Math.sin(p / 0.18 * Math.PI) : p < 0.42 ? Math.sin((p - 0.24) / 0.18 * Math.PI) * 0.7 : 0;
				out.scaleX = out.scaleY = 1 + Math.max(0, thump) * amount / 100;
				break;
			}
			case 'blink': out.opacity = p < data.duty / 100 ? 1 : 0; if (p === 1) out.opacity = 1; break;
			case 'bounce': vector(-amount * (1 - p) * wave); break;
			case 'shake': out.tx = random(3) * amount * wave; out.rotate = random(4) * amount * 0.35 * wave; break;
			case 'tremble': out.tx = random(5) * amount * wave; out.ty = random(6) * amount * wave; break;
			case 'wobble': out.tx = amount * 1.5 * oscillation * (1 - p); out.rotate = amount * oscillation * (1 - p); break;
			case 'jello': out.skewX = amount * oscillation * (1 - p); out.skewY = -out.skewX * 0.7; break;
			case 'tada': out.scaleX = out.scaleY = 1 + amount / 100 * wave; out.rotate = amount * 0.45 * Math.sin(8 * Math.PI * p) * wave; break;
			case 'swing': out.rotate = amount * Math.sin(4 * Math.PI * p) * (1 - p); break;
			case 'rubber-band': out.scaleX = 1 + amount / 100 * oscillation * (1 - p); out.scaleY = 1 - amount / 140 * oscillation * (1 - p); break;
			// OpacityFloor is optional here (0 by default = plain move); dialing it
			// up dips opacity in sync with the same `wave` driving the travel, so
			// the layer fades out as it moves away and back in as it returns —
			// a "move + fade" combo without a dedicated preset for it.
			case 'move':
				vector(Number(data.distance) * wave);
				if (data.opacityFloor) out.opacity = 1 - (1 - data.opacityFloor / 100) * wave;
				break;
			// Constant-speed one-way travel, restarting at 0 each loop (unlike
			// drift/move, no wave/amount shaping — a marquee has to hold one
			// speed edge-to-edge). The restart is a hard jump, not a seamless
			// wrap; set Distance past the canvas + layer size so the jump lands
			// while the layer is off-canvas and never reads as a cut.
			case 'marquee': vector(Number(data.distance) * p); break;
			// Centered on the layer's own resting position by default (anchor
			// 'center'); other anchors bias the circle's center toward that
			// corner/edge by up to one radius, so picking an anchor actually moves
			// the orbit instead of being inert (transform-origin alone can't do
			// this — it has no effect on a pure translate).
			case 'orbit': {
				const [anchorX, anchorY] = resolveOrigin(data);
				const centerTx = (anchorX - 0.5) * 2 * data.radius;
				const centerTy = (anchorY - 0.5) * 2 * data.radius;
				out.tx = centerTx + data.radius * Math.cos(2 * Math.PI * p);
				out.ty = centerTy + data.radius * Math.sin(2 * Math.PI * p);
				break;
			}
			// Amount is optional here (0 by default = plain spin); dialing it up
			// pulses scale in sync with the same period, turning the spin into a
			// vortex/spiral without a dedicated preset for it.
			case 'rotate':
				out.rotate = data.turns * 360 * p;
				if (amount) out.scaleX = out.scaleY = 1 + amount / 100 * oscillation;
				break;
			// Axis rides the shared Angle control (snapped to whichever of
			// horizontal/vertical it's closer to) instead of a dedicated axis
			// field, so one preset covers both flip orientations.
			case 'flip': {
				const flipScale = Math.cos(data.turns * 2 * Math.PI * p);
				if (Math.abs(Math.sin(angle)) > Math.abs(Math.cos(angle))) out.scaleY = flipScale;
				else out.scaleX = flipScale;
				break;
			}
			case 'zoom': out.scaleX = out.scaleY = 1 + amount / 100 * wave; break;
			case 'ping': out.scaleX = out.scaleY = 1 + data.radius / 100 * p; out.opacity = 1 - (1 - data.opacityFloor / 100) * p; break;
			// A pure hue cycle — no transform, so it composes with any other
			// preset's motion via the same outer hue-rotate filter/matrix. p is
			// already the eased, direction-adjusted 0..1 progress through the
			// period, so one full 360° turn always lands exactly on a period.
			case 'rainbow': out.hue = 360 * p; break;
		}
		// Pixel-snap only whole-pixel-aligns position, keeping pixel art crisp at
		// rest. Rounding rotation/scale to coarse steps has no such benefit (a
		// rotated bitmap is resampled regardless of angle granularity) and only
		// turns smooth motion choppy, so those stay continuous.
		if (data.snapMode === 'pixel-snap') {
			out.tx = Math.round(out.tx);
			out.ty = Math.round(out.ty);
		}
		out.opacity = Math.max(0, Math.min(1, out.opacity));
		return out;
	}

	function sampleAt(value, tMs, options = {}) {
		const data = normalizeAnimation(value);
		const period = Math.max(1, Number(data.periodMs));
		const localTime = Number(tMs) - Number(data.delayMs);
		let u = localTime / period + Number(data.phase || 0);
		if (u < 0) {
			if (!['backwards', 'both'].includes(data.fillMode)) return { ...IDENTITY, originX: resolveOrigin(data)[0], originY: resolveOrigin(data)[1] };
			u = 0;
		}
		const iterations = data.iterations === Infinity ? Infinity : Math.max(0, Number(data.iterations));
		if (Number.isFinite(iterations) && u >= iterations) {
			if (!['forwards', 'both'].includes(data.fillMode)) return { ...IDENTITY, originX: resolveOrigin(data)[0], originY: resolveOrigin(data)[1] };
			const finalCycle = Math.max(0, Math.ceil(iterations) - 1);
			const finalProgress = directedProgress(iterations - Math.floor(iterations) || 1, finalCycle, data.direction);
			return pose(data, finalProgress, tMs, options);
		}
		const cycle = Math.floor(u);
		const progress = directedProgress(u - cycle, cycle, data.direction);
		return pose(data, progress, tMs, options);
	}

	function isSeamlessLoop(value) {
		const data = normalizeAnimation(value);
		if (Number.isFinite(data.iterations)) return false;
		const a = sampleAt(data, 0, { layerId: '__seam__' });
		const b = sampleAt(data, data.periodMs, { layerId: '__seam__' });
		// hue wraps at 360deg (0deg and 360deg render identically), so it needs a
		// modular comparison instead of the other channels' exact equality.
		const transformSeamless = Object.keys(IDENTITY).filter((key) => key !== 'hue').every((key) => Math.abs(a[key] - b[key]) <= 1e-3);
		const hueSeamless = Math.abs(((a.hue - b.hue) % 360 + 360) % 360) <= 1e-3;
		return transformSeamless && hueSeamless;
	}

	function domTransformString(sample) {
		return `translate(${sample.tx}px, ${sample.ty}px) rotate(${sample.rotate}deg) scale(${sample.scaleX}, ${sample.scaleY}) skew(${sample.skewX}deg, ${sample.skewY}deg)`;
	}

	function applyToContext(ctx, sample, localW, localH) {
		const x = sample.originX * localW;
		const y = sample.originY * localH;
		ctx.translate(sample.tx, sample.ty);
		ctx.translate(x, y);
		ctx.rotate(sample.rotate * Math.PI / 180);
		ctx.scale(sample.scaleX, sample.scaleY);
		ctx.transform(1, Math.tan(sample.skewY * Math.PI / 180), Math.tan(sample.skewX * Math.PI / 180), 1, 0, 0);
		ctx.translate(-x, -y);
	}

	return {
		ANIMATION_TYPES, normalizeAnimation, isActive, includesOffCanvas, summaryText, loopDurationMs,
		isSeamlessLoop, sampleAt, seededRandom01, domTransformString, applyToContext
	};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GlitterAnimation;
