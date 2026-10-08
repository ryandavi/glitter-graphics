'use strict';

const GlitterAnimation = (() => {
	const motion = (pose, options = {}) => Object.freeze({
		needsBounds: false,
		targets: ['layer'],
		fields: [],
		anchor: { stores: 'layer', label: 'Anchor', note: 'Also sets the layer transform anchor.' },
		activeWhen: (data) => data.amount !== 0,
		...options,
		pose
	});
	const MOTION_DEFINITIONS = Object.freeze({
		breath: motion(({ out, amount, oscillation }) => { out.scaleX = out.scaleY = 1 + amount / 100 * oscillation; }, { label: 'Breath', group: 'Ambient', fields: ['amount'] }),
		float: motion(({ out, amount, oscillation, angle }) => {
			const lift = amount * oscillation;
			out.tx += Math.cos(angle) * lift;
			out.ty += Math.sin(angle) * lift;
		}, { label: 'Float', group: 'Ambient', fields: ['amount', 'angle'], targets: ['layer', 'particle'], particleLabel: 'Float' }),
		sway: motion(({ out, amount, oscillation }) => { out.rotate = amount * oscillation; }, { label: 'Sway', group: 'Ambient', fields: ['amount'] }),
		dim: motion(({ out, data, wave }) => { out.opacity = 1 - (1 - data.opacityFloor / 100) * wave; }, { label: 'Dim', group: 'Ambient', fields: ['opacityFloor'], activeWhen: (data) => data.opacityFloor < 100 }),
		drift: motion(({ data, p, vector }) => vector(Number(data.distance) * p), { label: 'Drift', group: 'Ambient', fields: ['angle', 'distance'], activeWhen: (data) => data.distance !== 0 }),
		twinkle: motion(({ out, data, p, random }) => {
			out.opacity = random(2) < (data.duty / 50 - 1) ? 1 : data.opacityFloor / 100;
			if (p === 0 || p === 1) out.opacity = 1;
		}, { label: 'Twinkle', group: 'Ambient', fields: ['duty', 'opacityFloor'], targets: ['layer', 'particle'], activeWhen: (data) => data.opacityFloor < 100, particleLabel: 'Twinkle' }),
		// A flash: grows from nothing and shrinks back within the first `duty`
		// percent of the cycle, turning by `amount` degrees, then stays hidden.
		glint: motion(({ out, data, amount, p }) => {
			const window = Math.max(0.05, Math.min(1, data.duty / 100));
			const flare = p < window ? Math.sin(Math.PI * p / window) : 0;
			out.scaleX = out.scaleY = flare;
			out.opacity = flare > 0 ? 1 : 0;
			out.rotate = p < window ? amount * (p / window - 0.5) : 0;
		}, { label: 'Glint', group: 'Ambient', fields: ['amount', 'duty'], targets: ['layer', 'particle'], activeWhen: () => true, particleLabel: 'Glint' }),
		pulse: motion(({ out, amount, wave }) => { out.scaleX = out.scaleY = 1 + amount / 100 * wave; }, { label: 'Pulse', group: 'Ambient', fields: ['amount'], targets: ['layer', 'particle'], particleLabel: 'Pulse' }),
		heartbeat: motion(({ out, amount, p }) => {
			const thump = p < 0.18 ? Math.sin(p / 0.18 * Math.PI) : p < 0.42 ? Math.sin((p - 0.24) / 0.18 * Math.PI) * 0.7 : 0;
			out.scaleX = out.scaleY = 1 + Math.max(0, thump) * amount / 100;
		}, { label: 'Heartbeat', group: 'Attention', fields: ['amount'] }),
		blink: motion(({ out, data, p }) => { out.opacity = p < data.duty / 100 ? 1 : 0; if (p === 1) out.opacity = 1; }, { label: 'Blink', group: 'Attention', fields: ['duty'], activeWhen: (data) => data.duty > 0 && data.duty < 100 }),
		bounce: motion(({ amount, p, wave, vector }) => vector(-amount * (1 - p) * wave), { label: 'Bounce', group: 'Attention', fields: ['amount', 'angle'] }),
		shake: motion(({ out, amount, wave, random }) => { out.tx = random(3) * amount * wave; out.rotate = random(4) * amount * 0.35 * wave; }, { label: 'Shake', group: 'Attention', fields: ['amount'] }),
		tremble: motion(({ out, amount, wave, random }) => { out.tx = random(5) * amount * wave; out.ty = random(6) * amount * wave; }, { label: 'Tremble', group: 'Attention', fields: ['amount'] }),
		wobble: motion(({ out, amount, oscillation, p }) => { out.tx = amount * 1.5 * oscillation * (1 - p); out.rotate = amount * oscillation * (1 - p); }, { label: 'Wobble', group: 'Attention', fields: ['amount'] }),
		jello: motion(({ out, amount, oscillation, p }) => { out.skewX = amount * oscillation * (1 - p); out.skewY = -out.skewX * 0.7; }, { label: 'Jello', group: 'Attention', fields: ['amount'] }),
		tada: motion(({ out, amount, wave, p }) => { out.scaleX = out.scaleY = 1 + amount / 100 * wave; out.rotate = amount * 0.45 * Math.sin(8 * Math.PI * p) * wave; }, { label: 'Tada', group: 'Attention', fields: ['amount'] }),
		swing: motion(({ out, amount, p }) => { out.rotate = amount * Math.sin(4 * Math.PI * p) * (1 - p); }, { label: 'Swing', group: 'Attention', fields: ['amount'] }),
		'rubber-band': motion(({ out, amount, oscillation, p }) => { out.scaleX = 1 + amount / 100 * oscillation * (1 - p); out.scaleY = 1 - amount / 140 * oscillation * (1 - p); }, { label: 'Rubber band', group: 'Attention', fields: ['amount'] }),
		// OpacityFloor adds a fade synchronized with the movement wave.
		move: motion(({ out, data, wave, vector }) => { vector(Number(data.distance) * wave); if (data.opacityFloor) out.opacity = 1 - (1 - data.opacityFloor / 100) * wave; }, { label: 'Move', group: 'Movement', fields: ['angle', 'distance', 'opacityFloor'], activeWhen: (data) => data.distance !== 0 }),
		// The orbit center offsets the path independently of the transform anchor.
		orbit: motion(({ out, data, p }) => {
			const [anchorX, anchorY] = resolveOrigin(data, 'orbitCenter');
			out.tx = (anchorX - 0.5) * 2 * data.radius + data.radius * Math.cos(2 * Math.PI * p);
			out.ty = (anchorY - 0.5) * 2 * data.radius + data.radius * Math.sin(2 * Math.PI * p);
		}, { label: 'Orbit', group: 'Movement', fields: ['radius'], targets: ['layer', 'particle'], activeWhen: (data) => data.radius !== 0, anchor: { stores: 'motion', label: 'Orbit center', note: 'Sets the center of the orbit path.' }, particleLabel: 'Orbit' }),
		// Amount adds a scale pulse to the spin.
		rotate: motion(({ out, data, amount, oscillation, p }) => { out.rotate = data.turns * 360 * p; if (amount) out.scaleX = out.scaleY = 1 + amount / 100 * oscillation; }, { label: 'Rotate', group: 'Movement', fields: ['amount', 'turns'], targets: ['layer', 'particle'], activeWhen: (data) => data.turns !== 0, particleLabel: 'Spin' }),
		// Angle selects the closest horizontal or vertical flip axis.
		flip: motion(({ out, data, angle, p }) => {
			const flipScale = Math.cos(data.turns * 2 * Math.PI * p);
			if (Math.abs(Math.sin(angle)) > Math.abs(Math.cos(angle))) out.scaleY = flipScale;
			else out.scaleX = flipScale;
		}, { label: 'Flip', group: 'Movement', fields: ['angle', 'turns'], activeWhen: (data) => data.turns !== 0 }),
		zoom: motion(({ out, amount, wave }) => { out.scaleX = out.scaleY = 1 + amount / 100 * wave; }, { label: 'Zoom', group: 'Movement', fields: ['amount'] }),
		ping: motion(({ out, data, p }) => { out.scaleX = out.scaleY = 1 + data.radius / 100 * p; out.opacity = 1 - (1 - data.opacityFloor / 100) * p; }, { label: 'Ping', group: 'Movement', fields: ['radius', 'opacityFloor'], activeWhen: (data) => data.radius !== 0 }),
		// Repeated copies exchange places at the wrap, including shadows.
		marquee: motion(wrapMotion({ repeat: true }), { label: 'Marquee', group: 'Movement', fields: ['angle'], needsBounds: true, offCanvas: true, activeWhen: () => true }),
		fall: motion(wrapMotion({ angle: 90 }), { label: 'Fall', group: 'Movement', targets: ['particle'], needsBounds: true, activeWhen: () => true }),
		rise: motion(wrapMotion({ angle: 270 }), { label: 'Rise', group: 'Movement', targets: ['particle'], needsBounds: true, activeWhen: () => true }),
		ricochet: motion(({ out, data, options, p, angle }) => {
			const room = [options.area.width - (options.rest.right - options.rest.left), options.area.height - (options.rest.bottom - options.rest.top)];
			const turns = Math.max(1, Math.round(data.turns));
			const longest = Math.max(...room);
			const components = [Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))].map((value) => value < 1e-6 ? 0 : value);
			const smallest = Math.min(...components.filter((value) => value > 0));
			['tx', 'ty'].forEach((key, axis) => {
				if (room[axis] <= 0 || !components[axis]) return;
				const trips = Math.min(data.maxTrips, Math.max(1, Math.round(turns * longest / room[axis] * components[axis] / smallest)));
				const direction = (axis ? Math.sin(angle) : Math.cos(angle)) < 0 ? -1 : 1;
				out[key] = reflect(axis ? options.rest.top : options.rest.left, room[axis], trips * direction, p);
			});
		}, { particleData: (context) => ({ angle: mulberry32(hashString(context.id) ^ Number(context.seed))() * 360 }), label: 'Ricochet', group: 'Movement', fields: ['turns', 'angle'], targets: ['layer', 'particle'], needsBounds: true, offCanvas: true, activeWhen: () => true }),
		wander: motion(({ out, data, options, p }) => {
			const random = mulberry32(hashString(options.id) ^ Number(options.seed));
			['x', 'y'].forEach((axis) => {
				const room = axis === 'x' ? options.area.width - (options.rest.right - options.rest.left) : options.area.height - (options.rest.bottom - options.rest.top);
				if (room <= 0) return;
				const wave = data.harmonics[axis].reduce((sum, { frequency, weight }) => {
					const phase = random() * Math.PI * 2;
					return sum + weight * (Math.sin(Math.PI * 2 * frequency * p + phase) - Math.sin(phase));
				}, 0);
				out[axis === 'x' ? 'tx' : 'ty'] = data.amount / 100 * room / 2 * wave;
			});
		}, { label: 'Wander', group: 'Ambient', fields: ['amount'], targets: ['layer', 'particle'], needsBounds: true }),
		// Hue wraps at a full turn; both renderers compose it with static color.
		rainbow: motion(({ out, p }) => { out.hue = 360 * p; }, { label: 'Rainbow', group: 'Color', fields: [], activeWhen: () => true })
	});
	const MOTION_REGISTRY = Object.freeze(Object.fromEntries(Object.entries(MOTION_DEFINITIONS).map(([id, definition]) => [
		id,
		Object.freeze({ id, ...definition })
	])));
	const ANIMATION_CONTROLS = Object.freeze([
		['periodMs', 'PeriodMs', 'animSpeed', 1], ['amount', 'Amount', 'animAmount', 1],
		['angle', 'Angle', 'animAngle', 1], ['distance', 'Distance', 'animDistance', 1],
		['radius', 'Radius', 'animRadius', 1], ['turns', 'Turns', 'animTurns', 1],
		['duty', 'Duty', 'animDuty', 1], ['opacityFloor', 'OpacityFloor', 'animOpacityFloor', 1],
		['delayMs', 'DelayMs', 'animDelay', 1], ['phase', 'Phase', 'animPhase', 100],
		['anchorX', 'AnchorX', 'animAnchorX', 100], ['anchorY', 'AnchorY', 'animAnchorY', 100],
		['easing', 'Easing'], ['direction', 'Direction'], ['fillMode', 'FillMode'],
		['anchor', 'Anchor'], ['snapMode', 'SnapMode']
	].map(([key, suffix, field, scale = 1]) => Object.freeze({ key, suffix, field, scale })));
	const ANIMATION_TYPES = Object.freeze(Object.keys(MOTION_REGISTRY));
	const IDENTITY = Object.freeze({
		tx: 0, ty: 0, rotate: 0, scaleX: 1, scaleY: 1,
		skewX: 0, skewY: 0, opacity: 1, originX: 0.5, originY: 0.5, hue: 0
	});
	const BASE_DEFAULTS = Object.freeze({
		periodMs: 1000, easing: 'linear', steps: 2, direction: 'normal', iterations: Infinity,
		delayMs: 0, phase: 0, fillMode: 'none', amount: 0, angle: 0, distance: 0,
		radius: 0, turns: 0, duty: 50, opacityFloor: 0,
		orbitCenter: 'center', orbitCenterX: 0.5, orbitCenterY: 0.5, snapMode: 'smooth'
	});
	function mod(value, span) { return ((value % span) + span) % span; }

	function wrap(u0, span, progress) { return span > 0 ? mod(u0 + span * progress, span) - u0 : 0; }

	function reflect(start, room, trips, progress) {
		return room > 0 ? room - Math.abs(mod(start + 2 * room * trips * progress, 2 * room) - room) - start : 0;
	}

	function wrapMotion({ angle: fixedAngle, repeat = false } = {}) {
		return ({ out, data, options, p }) => {
			const angle = (fixedAngle ?? data.angle) * Math.PI / 180;
			const dx = Math.cos(angle), dy = Math.sin(angle);
			const project = ({ left, top, right, bottom }) => {
				const values = [left * dx + top * dy, right * dx + top * dy, left * dx + bottom * dy, right * dx + bottom * dy];
				return [Math.min(...values), Math.max(...values)];
			};
			const [cMin, cMax] = project({ left: 0, top: 0, right: options.area.width, bottom: options.area.height });
			const [lMin, lMax] = project(options.restVisual);
			const span = repeat ? Math.max(cMax - cMin, lMax - lMin) : cMax - cMin + lMax - lMin;
			const offset = wrap(lMax - cMin, span, p);
			out.tx = dx * offset;
			out.ty = dy * offset;
			if (repeat) out.copies = [0, -1, 1].map((index) => ({ x: dx * span * index, y: dy * span * index }));
		};
	}

	function createSamplingContext({ area, rest, restVisual = rest, id = '', seed = 0, origin = [0.5, 0.5] } = {}) {
		const validBox = (box) => box && ['left', 'top', 'right', 'bottom'].every((key) => Number.isFinite(box[key])) && box.right >= box.left && box.bottom >= box.top;
		const bounded = area && Number.isFinite(area.width) && Number.isFinite(area.height) && area.width > 0 && area.height > 0 && validBox(rest) && validBox(restVisual);
		return { area: bounded ? { ...area } : null, rest: bounded ? { ...rest } : null, restVisual: bounded ? { ...restVisual } : null, id, seed, origin };
	}

	function splitSample(sample) {
		return {
			move: { x: sample.tx, y: sample.ty },
			local: { ...sample, tx: 0, ty: 0, ...(sample.matrix ? { matrix: { ...sample.matrix, e: 0, f: 0 } } : {}) }
		};
	}

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

	function normalizeAnimations(value = []) {
		const values = Array.isArray(value) ? value : (value ? [value] : []);
		return values
			.filter((animation) => animation && typeof animation === 'object')
			.map((animation) => normalizeAnimation(animation));
	}

	function isActive(value) {
		if (Array.isArray(value)) return value.some((animation) => isActive(animation));
		if (!value || !ANIMATION_TYPES.includes(value.type)) return false;
		const data = normalizeAnimation(value);
		return MOTION_REGISTRY[data.type].activeWhen(data);
	}

	function includesOffCanvas(value) {
		if (Array.isArray(value)) return value.some((animation) => includesOffCanvas(animation));
		return isActive(value) && MOTION_REGISTRY[value.type].offCanvas === true;
	}

	function summaryText(value) {
		if (Array.isArray(value)) {
			const active = value.filter((animation) => isActive(animation));
			if (!active.length) return 'Off';
			if (active.length > 1) return `${active.length} animations`;
			return summaryText(active[0]);
		}
		if (!isActive(value)) return 'Off';
		const data = normalizeAnimation(value);
		return MOTION_REGISTRY[data.type].label;
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

	function resolveOrigin(data, field = 'anchor') {
		const value = data[field];
		if (value === 'custom') return [Number(data[`${field}X`]), Number(data[`${field}Y`])];
		if (/^-?\d*\.?\d+,-?\d*\.?\d+$/.test(value)) return value.split(',').map(Number);
		const anchors = typeof ANCHOR_POINTS !== 'undefined' ? ANCHOR_POINTS : require('../core/options.js').ANCHOR_POINTS;
		const anchor = anchors.find((anchor) => anchor.id === value) || anchors.find((anchor) => anchor.id === 'center');
		return [anchor.fx, anchor.fy];
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
		[out.originX, out.originY] = options.origin || [0.5, 0.5];
		const amount = Number(data.amount) || 0;
		const wave = Math.sin(Math.PI * p);
		const oscillation = Math.sin(Math.PI * 2 * p);
		const angle = (Number(data.angle) || 0) * Math.PI / 180;
		const vector = (distance) => { out.tx += Math.cos(angle) * distance; out.ty += Math.sin(angle) * distance; };
		const random = (salt = 0) => seededRandom01(options.id, tMs, (options.seed || 0) + salt) * 2 - 1;
		if (MOTION_REGISTRY[data.type].needsBounds && !createSamplingContext(options).area) return out;
		MOTION_REGISTRY[data.type].pose({ out, data, p, tMs, options, amount, wave, oscillation, angle, vector, random });
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
		if (Array.isArray(value)) {
			return composeSamples(
				normalizeAnimations(value).filter((animation) => isActive(animation)).map((animation) => sampleAt(animation, tMs, options)),
				options
			);
		}
		const data = normalizeAnimation(value);
		const period = Math.max(1, Number(data.periodMs));
		const localTime = Number(tMs) - Number(data.delayMs);
		let u = localTime / period + Number(data.phase || 0);
		if (u < 0) {
			if (!['backwards', 'both'].includes(data.fillMode)) return { ...IDENTITY, originX: options.origin?.[0] ?? 0.5, originY: options.origin?.[1] ?? 0.5 };
			u = 0;
		}
		const iterations = data.iterations === Infinity ? Infinity : Math.max(0, Number(data.iterations));
		if (Number.isFinite(iterations) && u >= iterations) {
			if (!['forwards', 'both'].includes(data.fillMode)) return { ...IDENTITY, originX: options.origin?.[0] ?? 0.5, originY: options.origin?.[1] ?? 0.5 };
			const finalCycle = Math.max(0, Math.ceil(iterations) - 1);
			const finalProgress = directedProgress(iterations - Math.floor(iterations) || 1, finalCycle, data.direction);
			return pose(data, finalProgress, tMs, options);
		}
		const cycle = Math.floor(u);
		const progress = directedProgress(u - cycle, cycle, data.direction);
		return pose(data, progress, tMs, options);
	}

	function multiplyMatrices(left, right) {
		return {
			a: left.a * right.a + left.c * right.b,
			b: left.b * right.a + left.d * right.b,
			c: left.a * right.c + left.c * right.d,
			d: left.b * right.c + left.d * right.d,
			e: left.a * right.e + left.c * right.f + left.e,
			f: left.b * right.e + left.d * right.f + left.f
		};
	}

	function sampleMatrix(sample) {
		const radians = sample.rotate * Math.PI / 180;
		const skewX = Math.tan(sample.skewX * Math.PI / 180);
		const skewY = Math.tan(sample.skewY * Math.PI / 180);
		const translate = { a: 1, b: 0, c: 0, d: 1, e: sample.tx, f: sample.ty };
		const rotate = { a: Math.cos(radians), b: Math.sin(radians), c: -Math.sin(radians), d: Math.cos(radians), e: 0, f: 0 };
		const scale = { a: sample.scaleX, b: 0, c: 0, d: sample.scaleY, e: 0, f: 0 };
		const skew = { a: 1, b: skewY, c: skewX, d: 1, e: 0, f: 0 };
		return multiplyMatrices(multiplyMatrices(multiplyMatrices(translate, rotate), scale), skew);
	}

	function composeSamples(samples, options = {}) {
		const active = (samples || []).filter(Boolean);
		const origin = options.origin || [active[0]?.originX ?? 0.5, active[0]?.originY ?? 0.5];
		const matrix = active.reduce(
			(composed, sample) => multiplyMatrices(composed, sample.matrix || sampleMatrix(sample)),
			{ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
		);
		let copies = [{ x: 0, y: 0 }];
		let preceding = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
		active.forEach((sample) => {
			if (sample.copies) copies = copies.flatMap((copy) => sample.copies.map(({ x, y }) => ({ x: copy.x + preceding.a * x + preceding.c * y, y: copy.y + preceding.b * x + preceding.d * y })));
			preceding = multiplyMatrices(preceding, sample.matrix || sampleMatrix(sample));
		});
		copies = copies.filter((copy, index) => !copies.slice(0, index).some((other) => Math.hypot(copy.x - other.x, copy.y - other.y) < 1e-6));
		return {
			...IDENTITY,
			tx: matrix.e,
			ty: matrix.f,
			opacity: active.reduce((opacity, sample) => opacity * sample.opacity, 1),
			hue: active.reduce((hue, sample) => hue + sample.hue, 0),
			originX: origin[0],
			originY: origin[1],
			matrix,
			...(active.some((sample) => sample.copies) ? { copies } : {})
		};
	}

	function isSeamlessLoop(value, samplingContext = {}) {
		const data = normalizeAnimation(value);
		if (Number.isFinite(data.iterations)) return false;
		const context = { id: '__seam__', seed: 0, ...samplingContext };
		const a = sampleAt(data, 0, context);
		const b = sampleAt(data, data.periodMs, context);
		// hue wraps at 360deg (0deg and 360deg render identically), so it needs a
		// modular comparison instead of the other channels' exact equality.
		const transformSeamless = Object.keys(IDENTITY).filter((key) => key !== 'hue').every((key) => Math.abs(a[key] - b[key]) <= 1e-3);
		const hueSeamless = Math.abs(((a.hue - b.hue) % 360 + 360) % 360) <= 1e-3;
		return transformSeamless && hueSeamless;
	}

	function domTransformString(sample) {
		if (sample.matrix) {
			const { a, b, c, d } = sample.matrix;
			return `matrix(${a}, ${b}, ${c}, ${d}, ${sample.tx}, ${sample.ty})`;
		}
		return `translate(${sample.tx}px, ${sample.ty}px) rotate(${sample.rotate}deg) scale(${sample.scaleX}, ${sample.scaleY}) skew(${sample.skewX}deg, ${sample.skewY}deg)`;
	}

	function applyToContext(ctx, sample, localW, localH) {
		const x = sample.originX * localW;
		const y = sample.originY * localH;
		if (sample.matrix) {
			ctx.translate(x, y);
			ctx.transform(sample.matrix.a, sample.matrix.b, sample.matrix.c, sample.matrix.d, sample.tx, sample.ty);
			ctx.translate(-x, -y);
			return;
		}
		ctx.translate(sample.tx, sample.ty);
		ctx.translate(x, y);
		ctx.rotate(sample.rotate * Math.PI / 180);
		ctx.scale(sample.scaleX, sample.scaleY);
		ctx.transform(1, Math.tan(sample.skewY * Math.PI / 180), Math.tan(sample.skewX * Math.PI / 180), 1, 0, 0);
		ctx.translate(-x, -y);
	}

	return {
		ANIMATION_TYPES, MOTION_REGISTRY, ANIMATION_CONTROLS, normalizeAnimation, normalizeAnimations, isActive, includesOffCanvas, summaryText, loopDurationMs,
		isSeamlessLoop, sampleAt, composeSamples, seededRandom01, domTransformString, applyToContext, resolveOrigin,
		hashString, mulberry32, createSamplingContext, splitSample, wrap, reflect
	};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GlitterAnimation;
