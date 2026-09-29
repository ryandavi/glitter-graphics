(function (root) {
	'use strict';

	const stop = (offset, color) => ({ offset, color, alpha: 1 });
	const colors = (values) => values.map((color, index) => stop(index / (values.length - 1), color));
	// Hard-band stops: each color's stop marks where its band starts, and a
	// closing stop repeats the last color at 100% so every band has both ends
	// on the strip. Rendering is the same without it (the last color runs to
	// the edge either way); it keeps the band layout explicit for editing and
	// for reverseEffectGradientStops.
	const bands = (values, weights = values.map(() => 1)) => {
		const total = weights.reduce((sum, weight) => sum + weight, 0);
		let offset = 0;
		const stops = values.map((color, index) => {
			const result = stop(offset / total, color);
			offset += weights[index];
			return result;
		});
		stops.push(stop(1, values[values.length - 1]));
		return stops;
	};
	const gradient = (values, options = {}) => ({ stops: colors(values), interpolation: options.interpolation || 'linear', ...options });
	const flag = (id, label, values, weights = null, options = {}) => ({
		id,
		label,
		group: 'pride',
		tags: ['flag', 'pride'],
		value: { stops: bands(values, weights || values.map(() => 1)), interpolation: 'steps', angle: 180, ...options }
	});

	const entries = [
		// Basic matches CONFIG.rendering.gradient.stops, so a fresh gradient
		// shows as this preset: a plain two-color start to build on.
		{ id: 'basic', label: 'Basic', group: 'duotone', value: gradient(['#ff4fa3', '#6554ff']) },
		{ id: 'pink-blue', label: 'Pink / Blue', group: 'duotone', value: gradient(['#ff3ea5', '#258dff']) },
		{ id: 'purple-gold', label: 'Purple / Gold', group: 'duotone', value: gradient(['#5a189a', '#ffd166']) },
		{ id: 'black-white', label: 'Black / White', group: 'duotone', value: gradient(['#000000', '#ffffff']) },

		{ id: 'spectrum', label: 'Spectrum', group: 'rainbow', value: gradient(['#ff004c', '#ff8a00', '#ffe600', '#36d65c', '#00b7ff', '#5747ff', '#d62cff']) },
		{ id: 'pastel-rainbow', label: 'Pastel', group: 'rainbow', value: gradient(['#ffb3c7', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff', '#ffc6ff']) },
		{ id: 'neon-rainbow', label: 'Neon', group: 'rainbow', value: gradient(['#ff1493', '#ff5f00', '#fff700', '#39ff14', '#00e5ff', '#7a00ff']) },
		{ id: 'y2k-candy', label: 'Y2K Candy', group: 'rainbow', value: gradient(['#ff71ce', '#ffce5c', '#7dffcf', '#01cdfe', '#b967ff']) },

		flag('pride-6', 'Pride 6', ['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787']),
		flag('original-8', 'Original 8', ['#d6006e', '#e4002b', '#fe5000', '#ffcd00', '#00843d', '#009aa6', '#003da5', '#a634b2']),
		flag('trans', 'Trans', ['#5bcefa', '#f5a9b8', '#ffffff', '#f5a9b8', '#5bcefa']),
		flag('bi', 'Bisexual', ['#d60270', '#9b4f96', '#0038a8'], [2, 1, 2]),
		flag('pan', 'Pansexual', ['#ff218c', '#ffd800', '#21b1ff']),
		flag('nonbinary', 'Nonbinary', ['#fcf434', '#ffffff', '#9c59d1', '#2c2c2c']),
		flag('lesbian', 'Lesbian', ['#d52d00', '#ff9a56', '#ffffff', '#d362a4', '#a30262']),
		flag('ace', 'Asexual', ['#000000', '#a3a3a3', '#ffffff', '#800080']),
		flag('aro', 'Aromantic', ['#3da542', '#a7d379', '#ffffff', '#a9a9a9', '#000000']),
		flag('genderfluid', 'Genderfluid', ['#ff76a4', '#ffffff', '#c011d7', '#000000', '#2f3cbe']),
		flag('genderqueer', 'Genderqueer', ['#b57edc', '#ffffff', '#4a8123']),
		flag('agender', 'Agender', ['#000000', '#bcc4c7', '#ffffff', '#b7f684', '#ffffff', '#bcc4c7', '#000000']),
		flag('gay-men', 'Gay Men', ['#078d70', '#26ceaa', '#98e8c1', '#ffffff', '#7bade2', '#5049cc', '#3d1a78']),
		flag('intersex', 'Intersex', ['#ffd800', '#7902aa', '#ffd800'], [43, 19, 38], { type: 'radial' }),

		{ id: 'chrome', label: 'Chrome', group: 'web', value: gradient(['#171b22', '#f8fbff', '#74869b', '#ffffff', '#202a36'], { interpolation: 'smooth' }) },
		{ id: 'gold', label: 'Gold', group: 'web', value: gradient(['#5d3100', '#f6c453', '#fff4ad', '#b96e00', '#ffe08a']) },
		{ id: 'silver', label: 'Silver', group: 'web', value: gradient(['#4c5663', '#eef4fb', '#8795a5', '#ffffff', '#66717d']) },
		{ id: 'holographic', label: 'Holographic', group: 'web', value: gradient(['#8cf5ff', '#f7b8ff', '#fff7aa', '#b9ffd8', '#b9c4ff', '#ffbde1']) },
		{ id: 'bubblegum', label: 'Bubblegum', group: 'web', value: gradient(['#ff5fb7', '#ffd4ed', '#8edbff']) },
		{ id: 'vaporwave', label: 'Vaporwave', group: 'web', value: gradient(['#ff4fd8', '#8c52ff', '#00e5ff']) },
		{ id: 'sunset', label: 'Sunset', group: 'web', value: gradient(['#ff2d55', '#ff8a3d', '#ffd166', '#7b2cbf']) },
		{ id: 'aqua-glass', label: 'Aqua Glass', group: 'web', value: gradient(['#0067a8', '#75efff', '#e8ffff', '#0098d8']) },
		{ id: 'frutiger-sky', label: 'Frutiger Sky', group: 'web', value: gradient(['#178bff', '#7edcff', '#f5ffff', '#70d14b']) },
		{ id: 'candy-stripe', label: 'Candy Stripe', group: 'web', value: { stops: bands(['#ff72b6', '#ffffff', '#62d7ff', '#ffffff']), interpolation: 'steps' } },
		{ id: 'myspace-blue', label: 'MySpace Blue', group: 'web', value: gradient(['#003399', '#2c65c8', '#8cb4e8', '#ffffff']) }
	];

	const library = root.GlitterPresetLibrary.createPresetLibrary({
		id: 'gradients',
		groups: [
			{ id: 'duotone', label: 'Duotone' },
			{ id: 'rainbow', label: 'Rainbow' },
			{ id: 'pride', label: 'Pride' },
			{ id: 'web', label: 'Y2K & Web' }
		],
		entries,
		renderThumbnail(entry, element) {
			element.style.backgroundImage = effectGradientToCss(entry.value);
		},
		apply(entry, target, value) {
			if (!target) return;
			const keepAngle = target.angle;
			target.stops = value.stops;
			target.interpolation = value.interpolation;
			// A preset owns its type: one without `type` is linear, so applying it
			// after a radial preset (Intersex) does not inherit the radial.
			target.type = value.type || CONFIG.rendering.gradient.type;
			if (value.angle != null && keepAngle === CONFIG.rendering.gradient.angle) target.angle = value.angle;
		}
	});

	function findGradientPresetId(gradientValue) {
		const current = normalizeEffectGradient(gradientValue);
		const id = library.entries.find((entry) => {
			const preset = normalizeEffectGradient({ ...current, type: CONFIG.rendering.gradient.type, ...entry.value });
			return current.interpolation === preset.interpolation
				&& current.type === preset.type
				&& JSON.stringify(current.stops) === JSON.stringify(preset.stops);
		})?.id;
		return id || null;
	}

	root.GRADIENT_PRESETS = library;
	root.findGradientPresetId = findGradientPresetId;
	if (typeof module !== 'undefined' && module.exports) module.exports = { library, bands, flag };
})(typeof self !== 'undefined' ? self : globalThis);
