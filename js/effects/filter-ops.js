(function (root) {
	'use strict';

	const Tone = root.GlitterToneAdjust || (typeof require === 'function' ? require('./tone-adjust.js') : null);
	const Blur = root.GlitterBlur || (typeof require === 'function' ? require('./blur.js') : null);

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
		})
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
