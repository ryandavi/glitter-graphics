'use strict';

const GlitterEasing = (() => {
	const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
	const EASINGS = Object.freeze({
		linear: (t) => clamp01(t),
		ease: (t) => {
			const x = clamp01(t);
			return x * x * (3 - 2 * x);
		},
		easeIn: (t) => clamp01(t) ** 2,
		easeOut: (t) => 1 - (1 - clamp01(t)) ** 2,
		easeInOut: (t) => {
			const x = clamp01(t);
			return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2;
		},
		bounceOut: (t) => {
			let x = clamp01(t);
			const n = 7.5625;
			const d = 2.75;
			if (x < 1 / d) return n * x * x;
			if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
			if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
			return n * (x -= 2.625 / d) * x + 0.984375;
		},
		elasticOut: (t) => {
			const x = clamp01(t);
			if (x === 0 || x === 1) return x;
			return (2 ** (-10 * x)) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
		}
	});

	function stepsEase(t, count, jump = 'end') {
		const x = clamp01(t);
		const steps = Math.max(1, Math.floor(Number(count) || 1));
		if (jump === 'start') return Math.min(1, Math.ceil(x * steps) / steps);
		return Math.floor(x * steps) / steps;
	}

	function easingFn(name, options = {}) {
		if (name === 'steps') return (t) => stepsEase(t, options.steps, options.jump);
		return EASINGS[name] || EASINGS.linear;
	}

	return { EASINGS, stepsEase, easingFn };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GlitterEasing;
