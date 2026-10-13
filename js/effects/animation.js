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
		custom: motion(({ out, data, p }) => sampleKeys(out, data, p), { label: 'Custom', group: 'Custom', feature: 'timeline', keyed: true, activeWhen: () => true }),
		breath: motion(({ out, amount, oscillation }) => { out.scaleX = out.scaleY = 1 + amount / 100 * oscillation; }, { label: 'Breath', convertible: true, group: 'Ambient', fields: ['amount'] }),
		float: motion(({ out, amount, oscillation, angle }) => {
			const lift = amount * oscillation;
			out.tx += Math.cos(angle) * lift;
			out.ty += Math.sin(angle) * lift;
		}, { label: 'Float', convertible: true, group: 'Ambient', fields: ['amount', 'angle'], targets: ['layer', 'particle'], particleLabel: 'Float' }),
		sway: motion(({ out, amount, oscillation }) => { out.rotate = amount * oscillation; }, { label: 'Sway', convertible: true, group: 'Ambient', fields: ['amount'] }),
		dim: motion(({ out, data, wave }) => { out.opacity = 1 - (1 - data.opacityFloor / 100) * wave; }, { label: 'Dim', convertible: true, group: 'Ambient', fields: ['opacityFloor'], activeWhen: (data) => data.opacityFloor < 100 }),
		drift: motion(({ data, p, vector }) => vector(Number(data.distance) * p), { label: 'Drift', group: 'Ambient', fields: ['angle', 'distance'], travels: true, activeWhen: (data) => data.distance !== 0 }),
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
		pulse: motion(({ out, amount, wave }) => { out.scaleX = out.scaleY = 1 + amount / 100 * wave; }, { label: 'Pulse', convertible: true, group: 'Ambient', fields: ['amount'], targets: ['layer', 'particle'], particleLabel: 'Pulse' }),
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
		move: motion(({ out, data, wave, vector }) => { vector(Number(data.distance) * wave); if (data.opacityFloor) out.opacity = 1 - (1 - data.opacityFloor / 100) * wave; }, { label: 'Move', convertible: true, group: 'Movement', fields: ['angle', 'distance', 'opacityFloor'], travels: true, activeWhen: (data) => data.distance !== 0 }),
		// The orbit center offsets the path independently of the transform anchor.
		orbit: motion(({ out, data, p }) => {
			const [anchorX, anchorY] = resolveOrigin(data, 'orbitCenter');
			out.tx = (anchorX - 0.5) * 2 * data.radius + data.radius * Math.cos(2 * Math.PI * p);
			out.ty = (anchorY - 0.5) * 2 * data.radius + data.radius * Math.sin(2 * Math.PI * p);
		}, { label: 'Orbit', group: 'Movement', fields: ['radius'], travels: true, targets: ['layer', 'particle'], activeWhen: (data) => data.radius !== 0, anchor: { stores: 'motion', label: 'Orbit center', note: 'Sets the center of the orbit path.' }, particleLabel: 'Orbit' }),
		// Amount adds a scale pulse to the spin.
		rotate: motion(({ out, data, amount, oscillation, p }) => { out.rotate = data.turns * 360 * p; if (amount) out.scaleX = out.scaleY = 1 + amount / 100 * oscillation; }, { label: 'Rotate', convertible: true, group: 'Movement', fields: ['amount', 'turns'], targets: ['layer', 'particle'], activeWhen: (data) => data.turns !== 0, particleLabel: 'Spin' }),
		// Angle selects the closest horizontal or vertical flip axis.
		flip: motion(({ out, data, angle, p }) => {
			const flipScale = Math.cos(data.turns * 2 * Math.PI * p);
			if (Math.abs(Math.sin(angle)) > Math.abs(Math.cos(angle))) out.scaleY = flipScale;
			else out.scaleX = flipScale;
		}, { label: 'Flip', group: 'Movement', fields: ['angle', 'turns'], activeWhen: (data) => data.turns !== 0 }),
		zoom: motion(({ out, amount, wave }) => { out.scaleX = out.scaleY = 1 + amount / 100 * wave; }, { label: 'Zoom', convertible: true, group: 'Movement', fields: ['amount'] }),
		ping: motion(({ out, data, p }) => { out.scaleX = out.scaleY = 1 + data.radius / 100 * p; out.opacity = 1 - (1 - data.opacityFloor / 100) * p; }, { label: 'Ping', group: 'Movement', fields: ['radius', 'opacityFloor'], activeWhen: (data) => data.radius !== 0 }),
		// Repeat picks the wrap: none, a copy on the opposite edge, or a tiled row.
		// Repeated copies exchange places at the wrap, including shadows.
		marquee: motion(wrapMotion(), { label: 'Marquee', group: 'Movement', fields: ['angle', 'repeat', 'gap'], fieldWhen: { gap: (data) => data.repeat === 'tile' }, travels: true, needsBounds: true, offCanvas: true, activeWhen: () => true }),
		fall: motion(wrapMotion({ angle: 90, repeat: 'none' }), { label: 'Fall', group: 'Movement', targets: ['particle'], needsBounds: true, activeWhen: () => true }),
		rise: motion(wrapMotion({ angle: 270, repeat: 'none' }), { label: 'Rise', group: 'Movement', targets: ['particle'], needsBounds: true, activeWhen: () => true }),
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
		}, { particleData: (context) => ({ angle: mulberry32(hashString(context.id) ^ Number(context.seed))() * 360 }), label: 'Ricochet', group: 'Movement', fields: ['turns', 'angle'], travels: true, targets: ['layer', 'particle'], needsBounds: true, offCanvas: true, activeWhen: () => true }),
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
		rainbow: motion(({ out, p }) => { out.hue = 360 * p; }, { label: 'Rainbow', convertible: true, group: 'Color', fields: [], activeWhen: () => true })
	});
	const MOTION_REGISTRY = Object.freeze(Object.fromEntries(Object.entries(MOTION_DEFINITIONS).map(([id, definition]) => [
		id,
		Object.freeze({ id, ...definition })
	])));
	const ANIMATION_CONTROLS = Object.freeze([
		['periodMs', 'PeriodMs', 'animDuration', 0.001], ['amount', 'Amount', 'animAmount', 1],
		['angle', 'Angle', 'animAngle', 1], ['distance', 'Distance', 'animDistance', 1],
		['radius', 'Radius', 'animRadius', 1], ['turns', 'Turns', 'animTurns', 1],
		['duty', 'Duty', 'animDuty', 1], ['opacityFloor', 'OpacityFloor', 'animOpacityFloor', 1],
		['gap', 'Gap', 'animGap', 1],
		['delayMs', 'DelayMs', 'animDelay', 0.001], ['phase', 'Phase', 'animPhase', 100],
		['anchorX', 'AnchorX', 'animAnchorX', 100], ['anchorY', 'AnchorY', 'animAnchorY', 100],
		['easing', 'Easing'], ['direction', 'Direction'], ['fillMode', 'FillMode'],
		['anchor', 'Anchor'], ['snapMode', 'SnapMode'], ['repeat', 'Repeat']
	].map(([key, suffix, field, scale = 1]) => Object.freeze({ key, suffix, field, scale })));
	const ANIMATION_TYPES = Object.freeze(Object.keys(MOTION_REGISTRY));
	const POSE_CHANNELS = Object.freeze(Object.fromEntries([
		['tx', 'Position X', 'px', 0, 'number', 'add', 'animKeyOffset'], ['ty', 'Position Y', 'px', 0, 'number', 'add', 'animKeyOffset'],
		['rotate', 'Rotation', '°', 0, 'angle', 'matrix', 'animKeyAngle'],
		['scaleX', 'Scale X', '', 1, 'number', 'multiply', 'animKeyScale', 100], ['scaleY', 'Scale Y', '', 1, 'number', 'multiply', 'animKeyScale', 100],
		['skewX', 'Skew X', '°', 0, 'angle', 'matrix', 'animKeySkew'], ['skewY', 'Skew Y', '°', 0, 'angle', 'matrix', 'animKeySkew'],
		['opacity', 'Opacity', '', 1, 'number', 'multiply', 'layerOpacity', 100], ['hue', 'Hue', '°', 0, 'angle', 'add', 'animKeyAngle']
	].map(([id, label, unit, rest, interpolation, composition, field, displayScale = 1]) => [id, Object.freeze({ id, label, unit, rest, interpolation, composition, field, displayScale })])));
	// What a person poses: each property writes one or two channels through one
	// control. Panels iterate this; a key still stores its channels sparsely.
	const POSE_PROPERTIES = Object.freeze([
		['position', 'Position', ['tx', 'ty'], 'pair', ''], ['rotation', 'Rotation', ['rotate'], 'number'],
		['scale', 'Scale', ['scaleX', 'scaleY'], 'pair'], ['skew', 'Skew', ['skewX', 'skewY'], 'pair'],
		['opacity', 'Opacity', ['opacity'], 'slider'], ['hue', 'Hue', ['hue'], 'number']
	].map(([id, label, channels, control, unit]) => Object.freeze({ id, label, channels: Object.freeze(channels), control, ...(unit == null ? {} : { unit }) })));
	const IDENTITY = Object.freeze({
		...Object.fromEntries(Object.entries(POSE_CHANNELS).filter(([id]) => id !== 'hue').map(([id, channel]) => [id, channel.rest])),
		originX: 0.5, originY: 0.5, hue: POSE_CHANNELS.hue.rest
	});
	const BASE_DEFAULTS = Object.freeze({
		periodMs: 1000, easing: 'linear', steps: 2, direction: 'normal', iterations: Infinity,
		delayMs: 0, phase: 0, fillMode: 'none', amount: 0, angle: 0, distance: 0,
		radius: 0, turns: 0, duty: 50, opacityFloor: 0, repeat: 'none', gap: 0,
		orbitCenter: 'center', orbitCenterX: 0.5, orbitCenterY: 0.5, snapMode: 'smooth'
	});
	const CONVERT_TIMING_KEYS = Object.freeze(['periodMs', 'easing', 'steps', 'direction', 'iterations', 'delayMs', 'phase', 'fillMode', 'snapMode']);
	function mod(value, span) { return ((value % span) + span) % span; }

	function wrap(u0, span, progress) { return span > 0 ? mod(u0 + span * progress, span) - u0 : 0; }

	function reflect(start, room, trips, progress) {
		return room > 0 ? room - Math.abs(mod(start + 2 * room * trips * progress, 2 * room) - room) - start : 0;
	}

	// `repeat`: 'none' leaves the area before it re-enters, 'wrap' re-enters on
	// the opposite edge as it leaves, and 'tile' fills the travel axis with
	// copies one gap apart. Each mode crosses a whole number of spans per cycle.
	function wrapMotion({ angle: fixedAngle, repeat: fixedRepeat } = {}) {
		return ({ out, data, options, p }) => {
			const repeat = fixedRepeat ?? data.repeat;
			const angle = (fixedAngle ?? data.angle) * Math.PI / 180;
			const dx = Math.cos(angle), dy = Math.sin(angle);
			const project = ({ left, top, right, bottom }) => {
				const values = [left * dx + top * dy, right * dx + top * dy, left * dx + bottom * dy, right * dx + bottom * dy];
				return [Math.min(...values), Math.max(...values)];
			};
			const [cMin, cMax] = project({ left: 0, top: 0, right: options.area.width, bottom: options.area.height });
			const [lMin, lMax] = project(options.restVisual);
			const travel = cMax - cMin, extent = lMax - lMin;
			if (repeat !== 'tile') {
				const span = repeat === 'wrap' ? Math.max(travel, extent) : travel + extent;
				const offset = wrap(lMax - cMin, span, p);
				out.tx = dx * offset;
				out.ty = dy * offset;
				if (repeat === 'wrap') out.copies = [0, -1, 1].map((index) => ({ x: dx * span * index, y: dy * span * index }));
				return;
			}
			// Neighbors meet on whichever pair of box edges touches first along the
			// travel line, so the gap is the same clear space at every angle.
			// maxCopies bounds the row a small layer tiles across a large canvas.
			const gap = Math.max(0, Number(data.gap));
			const reach = (size, component) => Math.abs(component) < 1e-6 ? Infinity : (Math.floor(size + 1e-6) + gap) / Math.abs(component);
			const pitch = Math.max(1, travel / data.maxCopies, Math.min(
				reach(options.restVisual.right - options.restVisual.left, dx),
				reach(options.restVisual.bottom - options.restVisual.top, dy)
			));
			// Whole-pixel steps and offsets keep every copy on the layer's own pixel
			// phase; a fractional seam between neighbors antialiases into a visible line.
			const stepX = Math.round(dx * pitch), stepY = Math.round(dy * pitch);
			const span = stepX * dx + stepY * dy;
			// A cycle crosses whole tiles, close to the one canvas the other modes cross.
			const progress = mod(Math.max(1, Math.round(travel / span)) * p, 1);
			out.tx = Math.round(stepX * progress);
			out.ty = Math.round(stepY * progress);
			// The range covers every offset in a span, so the copy count holds through a cycle.
			const indices = [0];
			for (let index = Math.ceil((cMin - lMax) / span) - 1; index <= Math.floor((cMax - lMin) / span); index++) if (index) indices.push(index);
			out.copies = indices.map((index) => ({ x: stepX * index, y: stepY * index }));
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
		if (MOTION_REGISTRY[type].keyed) normalized.keys = normalizeKeys(normalized.keys);
		return normalized;
	}

	function normalizeKeys(keys) {
		const byPosition = new Map();
		if (!Array.isArray(keys)) return [];
		keys.forEach((key) => {
			if (!key || !Number.isFinite(key.at) || key.at < 0 || key.at > 1) return;
			const at = key.at === 1 ? 0 : key.at;
			const previous = byPosition.get(at);
			const values = { ...previous?.values };
			Object.entries(key.values && typeof key.values === 'object' ? key.values : {}).forEach(([id, value]) => {
				if (!Object.hasOwn(POSE_CHANNELS, id) || !Number.isFinite(value)) return;
				values[id] = id === 'opacity' ? Math.max(0, Math.min(1, value)) : value;
			});
			const easing = Object.hasOwn(GlitterEasing.EASINGS, key.easing) || key.easing === 'steps' ? key.easing : previous?.easing || 'linear';
			byPosition.set(at, { at, easing, values });
		});
		return [...byPosition.values()].sort((a, b) => a.at - b.at);
	}

	// The pose a keyed motion has at one of its positions, before timing.
	function keyRestSample(value, at) {
		return sampleAt({ ...value, phase: at, easing: 'linear', snapMode: 'smooth', delayMs: 0, direction: 'normal', iterations: Infinity }, 0);
	}

	function interpolateChannel(channel, from, to, progress) {
		let difference = to - from;
		if (channel.interpolation === 'angle') {
			difference = mod(difference + 180, 360) - 180;
			if (difference === -180) difference = 180;
		}
		return from + difference * progress;
	}

	function sampleKeys(out, data, progress) {
		const p = mod(progress, 1);
		Object.entries(POSE_CHANNELS).forEach(([id, channel]) => {
			const keys = data.keys.filter((key) => Object.hasOwn(key.values, id));
			if (!keys.length) return;
			if (keys.length === 1) { out[id] = keys[0].values[id]; return; }
			const index = keys.findLastIndex((key) => key.at <= p);
			const from = keys[index < 0 ? keys.length - 1 : index];
			const to = keys[(index + 1) % keys.length];
			const length = mod(to.at - from.at, 1);
			const fraction = mod(p - from.at, 1) / length;
			const eased = GlitterEasing.easingFn(from.easing, { steps: data.steps })(fraction);
			out[id] = interpolateChannel(channel, from.values[id], to.values[id], eased);
		});
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

	function runTiming(value) {
		const data = normalizeAnimation(value);
		const start = Number(data.delayMs);
		return { start, end: Number.isFinite(data.iterations) ? Math.max(0, start + loopDurationMs(data) - Number(data.phase) * data.periodMs) : Infinity };
	}

	function iterationsForRun(animation, { start, end }) {
		const data = normalizeAnimation(animation);
		if (end === Infinity) return Infinity;
		const delayMs = clampNumber(start, 0, FIELDS.animDelay.max * 1000);
		return Number(clampNumber((end - delayMs) / data.periodMs + Number(data.phase), FIELDS.animIterations.min, FIELDS.animIterations.max).toFixed(2));
	}

	// Typical canvas speed of a traveling motion in px/s: the median step over
	// one cycle, so a wrap's jump and an easing's slow ends do not skew it.
	function travelSpeed(value, samplingContext = {}, steps = 48) {
		const data = { ...normalizeAnimation(value), delayMs: 0, phase: 0 };
		if (!MOTION_REGISTRY[data.type].travels) return 0;
		const distances = [];
		let previous = sampleAt(data, 0, samplingContext);
		for (let index = 1; index <= steps; index++) {
			const next = sampleAt(data, data.periodMs * index / steps, samplingContext);
			distances.push(Math.hypot(next.tx - previous.tx, next.ty - previous.ty));
			previous = next;
		}
		distances.sort((a, b) => a - b);
		return distances[steps >> 1] * steps * 1000 / data.periodMs;
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

	function easedProgress(data, progress) {
		let p = GlitterEasing.easingFn(data.easing, { steps: data.steps })(progress);
		if (data.snapMode === 'step' && data.easing !== 'steps') p = GlitterEasing.stepsEase(p, data.steps);
		return p;
	}

	function pose(data, progress, tMs, options, p = easedProgress(data, progress)) {
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

	function progressAt(data, tMs, fill) {
		const period = Math.max(1, Number(data.periodMs));
		const localTime = Number(tMs) - Number(data.delayMs);
		if (!fill && localTime < 0) return null;
		let u = localTime / period + Number(data.phase || 0);
		let held = false;
		if (u < 0) {
			if (!fill || !['backwards', 'both'].includes(data.fillMode)) return null;
			u = 0;
			held = true;
		}
		const iterations = data.iterations === Infinity ? Infinity : Math.max(0, Number(data.iterations));
		if (Number.isFinite(iterations) && u >= iterations) {
			if (!fill || !['forwards', 'both'].includes(data.fillMode)) return null;
			const finalCycle = Math.max(0, Math.ceil(iterations) - 1);
			const finalProgress = directedProgress(iterations - Math.floor(iterations) || 1, finalCycle, data.direction);
			return { cycle: finalCycle, progress: finalProgress, eased: easedProgress(data, finalProgress), held: true };
		}
		const cycle = Math.floor(u);
		const progress = directedProgress(u - cycle, cycle, data.direction);
		return { cycle, progress, eased: easedProgress(data, progress), held };
	}

	function cycleProgress(value, tMs, { fill = true } = {}) {
		return progressAt(normalizeAnimation(value), tMs, fill);
	}

	// A key's intrinsic position can occur more than once under elastic or
	// bounce easing. Pick the nearest occurrence in the current repetition.
	function timeAtProgress(value, at, timestamp) {
		const data = normalizeAnimation(value);
		const current = progressAt(data, timestamp, false);
		if (!current || data.easing === 'steps' || data.snapMode === 'step' || !Number.isFinite(at)) return null;
		const { samples, iterations, tolerance } = config().keySeek;
		const keyAt = mod(at, 1);
		const evaluate = (fraction) => easedProgress(data, directedProgress(fraction, current.cycle, data.direction));
		const candidates = [];
		const add = (fraction) => {
			const time = Number(data.delayMs) + (current.cycle + fraction - Number(data.phase)) * data.periodMs;
			if (progressAt(data, time, false)) candidates.push(time);
		};
		let left = 0, leftValue = evaluate(left);
		for (let index = 1; index <= samples; index++) {
			const right = index / samples, rightValue = evaluate(right);
			for (let turn = Math.ceil(Math.min(leftValue, rightValue) - keyAt - tolerance); turn <= Math.floor(Math.max(leftValue, rightValue) - keyAt + tolerance); turn++) {
				const target = keyAt + turn;
				if (Math.abs(leftValue - target) <= tolerance) { add(left); continue; }
				if (Math.abs(rightValue - target) <= tolerance) { add(right); continue; }
				let low = left, high = right, lowValue = leftValue;
				for (let step = 0; step < iterations; step++) {
					const middle = (low + high) / 2, middleValue = evaluate(middle);
					if ((middleValue - target) * (lowValue - target) > 0) { low = middle; lowValue = middleValue; }
					else high = middle;
				}
				add((low + high) / 2);
			}
			left = right; leftValue = rightValue;
		}
		return candidates.sort((a, b) => Math.abs(a - timestamp) - Math.abs(b - timestamp))[0] ?? null;
	}

	function sampleAt(value, tMs, options = {}) {
		if (Array.isArray(value)) {
			return composeSamples(
				normalizeAnimations(value).filter((animation) => isActive(animation)).map((animation) => sampleAt(animation, tMs, options)),
				options
			);
		}
		const data = normalizeAnimation(value);
		const position = progressAt(data, tMs, true);
		return position ? pose(data, position.progress, tMs, options, position.eased)
			: { ...IDENTITY, originX: options.origin?.[0] ?? 0.5, originY: options.origin?.[1] ?? 0.5 };
	}

	// Samples a preset into evenly spaced linear keys: the fewest that reach the
	// channel tolerances, else the most the ladder allows. The result keeps the
	// preset's timing, so key positions sit before its easing. Null when the
	// preset has no keyed form or the keyed motion strays past the limit, as a
	// half-wave does under an easing that overshoots.
	function convertToKeys(value) {
		const cfg = config().convert;
		const data = normalizeAnimation(value);
		if (!MOTION_REGISTRY[data.type].convertible || !isActive(data)) return null;
		const smooth = { ...data, snapMode: data.snapMode === 'pixel-snap' ? 'smooth' : data.snapMode };
		const channels = Object.values(POSE_CHANNELS);
		const difference = (channel, a, b) => {
			const distance = Math.abs(a - b);
			return channel.interpolation === 'angle' ? Math.min(mod(distance, 360), 360 - mod(distance, 360)) : distance;
		};
		const positions = Array.from({ length: cfg.samples }, (_unused, index) => index / cfg.samples);
		const source = positions.map((p) => pose(smooth, p, 0, {}, p));
		const used = channels.filter((channel) => source.some((sample) => difference(channel, sample[channel.id], channel.rest) > cfg.exactError));
		const timing = Object.fromEntries(CONVERT_TIMING_KEYS.map((key) => [key, data[key]]));
		const build = (count) => normalizeAnimation({ ...timing, type: 'custom', keys: Array.from({ length: count }, (_unused, index) => {
			const sample = pose(smooth, index / count, 0, {}, index / count);
			return { at: index / count, easing: 'linear', values: Object.fromEntries(used.map((channel) => [channel.id, sample[channel.id]])) };
		}) });
		// The worst channel, as a multiple of its tolerance.
		const measure = (pairs) => pairs.reduce((worst, [a, b]) => channels.reduce((current, channel) => {
			const error = difference(channel, a[channel.id], b[channel.id]);
			return error / cfg.tolerance[channel.id] > current.ratio ? { ratio: error / cfg.tolerance[channel.id], channel: channel.id, value: error } : current;
		}, worst), { ratio: 0, channel: null, value: 0 });
		const counts = cfg.keyCounts.filter((count) => count <= config().maxKeys);
		let animation, fit;
		// A turning channel keeps its winding only while neighbouring keys sit
		// under a half turn apart, where the shortest path is unambiguous.
		const winds = (count) => used.some((channel) => channel.interpolation === 'angle' && Array.from({ length: count }, (_unused, index) =>
			Math.abs(pose(smooth, (index + 1) / count, 0, {}, (index + 1) / count)[channel.id] - pose(smooth, index / count, 0, {}, index / count)[channel.id])).some((turn) => turn >= 180 - cfg.exactError));
		for (const count of counts) {
			if (winds(count) && count !== counts.at(-1)) continue;
			animation = build(count);
			fit = measure(positions.map((p, index) => [source[index], pose(animation, p, 0, {}, p)]));
			if (fit.ratio <= 1) break;
		}
		// Two repetitions under the motion's own easing and direction, seam included.
		const played = (entry) => ({ ...entry, snapMode: smooth.snapMode, delayMs: 0, phase: 0, iterations: Infinity });
		const times = Array.from({ length: cfg.samples * 2 + 1 }, (_unused, index) => index * data.periodMs / cfg.samples);
		const run = measure(times.map((time) => [sampleAt(played(data), time), sampleAt(played(animation), time)]));
		const worst = run.ratio > fit.ratio ? run : fit;
		if (worst.ratio > cfg.maxError) return null;
		return { animation, error: worst.value > cfg.exactError ? { channel: worst.channel, value: worst.value } : null };
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

	function isSeamlessLoop(value, samplingContext = {}, duration = normalizeAnimation(value).periodMs) {
		const data = normalizeAnimation(value);
		const context = { id: '__seam__', seed: 0, ...samplingContext };
		const a = sampleAt(data, 0, context);
		const b = sampleAt(data, duration, context);
		// hue wraps at 360deg (0deg and 360deg render identically), so it needs a
		// modular comparison instead of the other channels' exact equality.
		const transformSeamless = Object.keys(IDENTITY).filter((key) => key !== 'hue').every((key) => Math.abs(a[key] - b[key]) <= 1e-3);
		const hueDifference = ((a.hue - b.hue) % 360 + 360) % 360;
		const hueSeamless = Math.min(hueDifference, 360 - hueDifference) <= 1e-3;
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
		ANIMATION_TYPES, MOTION_REGISTRY, ANIMATION_CONTROLS, POSE_CHANNELS, POSE_PROPERTIES, keyRestSample, normalizeAnimation, normalizeAnimations, normalizeKeys, interpolateChannel, cycleProgress, timeAtProgress, convertToKeys, isActive, includesOffCanvas, summaryText, loopDurationMs,
		isSeamlessLoop, runTiming, iterationsForRun, travelSpeed, sampleAt, composeSamples, seededRandom01, domTransformString, applyToContext, resolveOrigin,
		hashString, mulberry32, createSamplingContext, splitSample, sampleMatrix, multiplyMatrices, wrap, reflect
	};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GlitterAnimation;
