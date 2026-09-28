(function (root) {
	'use strict';

	const Fields = typeof FIELDS !== 'undefined' ? FIELDS : (typeof require === 'function' ? require('../core/fields.js') : null);
	const Presets = root.FILTER_PRESETS || (typeof require === 'function' ? require('./filter-presets.js') : null);
	const Ops = root.GlitterFilterOps || (typeof require === 'function' ? require('./filter-ops.js') : null);
	const PresetLibrary = root.GlitterPresetLibrary || (typeof require === 'function' ? require('../ui/preset-library.js') : null);

	const numeric = (specId, controlId) => Object.freeze({ kind: 'number', specId, spec: Fields[specId], controlId });
	const boolean = (defaultValue, controlId, label) => Object.freeze({ kind: 'boolean', default: defaultValue, controlId, label });
	const color = (defaultValue, controlId, label = 'Color') => Object.freeze({ kind: 'color', default: defaultValue, controlId, label });
	const select = (defaultValue, controlId, label, options) => Object.freeze({ kind: 'select', default: defaultValue, controlId, label, options });
	const step = (op, params) => ({ op, params });
	const clone = (value) => value == null ? value : structuredClone(value);
	const stop = (at, color) => ({ at, color });

	function tintOptions() {
		return Object.entries(CONFIG.tools.filter.tintPresets).map(([value, entry]) => ({ value, label: entry.label }));
	}

	function instagramRecipe(values) {
		const selected = Presets[values.presetId];
		if (!selected) return [];
		const strength = values.strength / 100;
		const steps = selected.ops.map((entry) => step(entry.kind, { ...clone(entry), opacity: Number(entry.opacity ?? 1) * strength }));
		steps.push(step('tone', { tone: lerpTone(selected.tone, strength) }));
		if (values.showName) steps.push(step('caption', { text: selected.name || selected.instagramName }));
		return steps;
	}

	function lerpTone(value, amount) {
		const identity = { brightness: 1, contrast: 1, saturate: 1, hueRotate: 0, invert: 0, grayscale: 0, sepia: 0 };
		const source = value || {};
		const tone = { order: [...Object.keys(source)] };
		Object.entries(identity).forEach(([key, base]) => { tone[key] = base + (Number(source[key] ?? base) - base) * amount; });
		return tone;
	}

	function vignetteGradient(values) {
		const midpoint = values.midpoint / 100;
		const feather = Math.max(0.01, values.feather / 100);
		const edgeStart = Math.max(0, Math.min(1, midpoint - (1 - midpoint) * feather * 0.25));
		const roundness = values.roundness / 100;
		return {
			type: 'radial', center: [0.5, 0.5], radius: 0.72,
			radiusX: 0.72 * (roundness < 0 ? 1 + roundness * 0.45 : 1),
			radiusY: 0.72 * (roundness > 0 ? 1 - roundness * 0.45 : 1),
			shape: Math.abs(roundness) > 0.05 ? 'ellipse' : 'circle',
			stops: [stop(edgeStart, 'transparent'), stop(1, values.color)]
		};
	}

	function vignetteMode(colorValue) {
		const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colorValue);
		if (!match) return 'multiply';
		const luminance = (0.299 * parseInt(match[1], 16) + 0.587 * parseInt(match[2], 16) + 0.114 * parseInt(match[3], 16)) / 255;
		return luminance > 0.5 ? 'screen' : 'multiply';
	}

	const FILTERS = Object.freeze({
		basic: Object.freeze({ id: 'basic', label: 'Basic', group: 'adjust', tags: ['brightness', 'contrast', 'saturation', 'hue'], fields: Object.freeze({
			brightness: numeric('filterBrightness', 'filterBrightness'), contrast: numeric('filterContrast', 'filterContrast'),
			saturation: numeric('filterSaturation', 'filterSaturation'), hue: numeric('filterHue', 'filterHue')
		}), recipe: (values) => [step('tone', { tone: { brightness: 1 + values.brightness / 100, contrast: 1 + values.contrast / 100, saturate: 1 + values.saturation / 100, hueRotate: values.hue } })] }),
		invert: Object.freeze({ id: 'invert', label: 'Invert', group: 'adjust', fields: Object.freeze({ amount: numeric('filterInvertAmount', 'filterInvertAmount') }), recipe: (values) => [step('tone', { tone: { invert: values.amount / 100 } })] }),
		grayscale: Object.freeze({ id: 'grayscale', label: 'Grayscale', group: 'adjust', fields: Object.freeze({ amount: numeric('filterGrayscaleAmount', 'filterGrayscaleAmount') }), recipe: (values) => [step('tone', { tone: { grayscale: values.amount / 100 } })] }),
		sepia: Object.freeze({ id: 'sepia', label: 'Sepia', group: 'adjust', fields: Object.freeze({ amount: numeric('filterSepiaAmount', 'filterSepiaAmount') }), recipe: (values) => [step('tone', { tone: { sepia: values.amount / 100 } })] }),
		tint: Object.freeze({ id: 'tint', label: 'Tint', group: 'stylize', fields: Object.freeze({
			presetId: select('warming-85', 'filterTintPreset', 'Preset', tintOptions), color: color('#ec8a00', 'filterTintColor'), amount: numeric('filterTintAmount', 'filterTintAmount')
		}), normalize(values, source) {
			const presets = CONFIG.tools.filter.tintPresets;
			const match = Object.entries(presets).find(([, entry]) => entry.color?.toLowerCase() === values.color.toLowerCase())?.[0];
			if (!Object.hasOwn(source, 'presetId') && Object.hasOwn(source, 'color')) values.presetId = match || 'custom';
			if (values.presetId !== 'custom' && presets[values.presetId]?.color) values.color = presets[values.presetId].color;
			values.mode = 'soft-light';
		}, recipe: (values) => [step('fill', { color: values.color, mode: values.mode, opacity: values.amount / 100 })],
			summary: (values) => values.presetId === 'custom' ? 'Custom Tint' : (CONFIG.tools.filter.tintPresets[values.presetId]?.label || 'Tint') }),
		vignette: Object.freeze({ id: 'vignette', label: 'Vignette', group: 'stylize', fields: Object.freeze({
			amount: numeric('filterVignetteAmount', 'filterVignetteAmount'), midpoint: numeric('filterVignetteMidpoint', 'filterVignetteMidpoint'),
			roundness: numeric('filterVignetteRoundness', 'filterVignetteRoundness'), feather: numeric('filterVignetteFeather', 'filterVignetteFeather'), color: color('#000000', 'filterVignetteColor')
		}), recipe: (values) => [step('gradient', { mode: vignetteMode(values.color), opacity: values.amount / 100, gradient: vignetteGradient(values) })] }),
		grain: Object.freeze({ id: 'grain', label: 'Grain', group: 'stylize', fields: Object.freeze({
			amount: numeric('filterGrainAmount', 'filterGrainAmount'), size: numeric('filterGrainSize', 'filterGrainSize'),
			roughness: numeric('filterGrainRoughness', 'filterGrainRoughness'), monochrome: boolean(true, 'filterGrainMono', 'Monochrome')
		}), recipe: (values) => [step('grain', { mode: 'soft-light', amount: values.amount / 100, size: values.size, roughness: values.roughness / 100, monochrome: values.monochrome })] }),
		blur: Object.freeze({ id: 'blur', label: 'Blur', group: 'stylize', fields: Object.freeze({ radius: numeric('filterBlurRadius', 'filterBlurRadius') }), recipe: (values) => [step('blur', { radius: values.radius, mode: 'normal', opacity: 1 })] }),
		instagram: Object.freeze({ id: 'instagram', label: 'Instagram', group: 'instagram', tags: ['cssgram'], fields: Object.freeze({
			strength: numeric('filterInstagramStrength', 'filterStrength'), showName: boolean(false, 'filterShowName', 'Show Filter Name')
		}), recipe: instagramRecipe, summary: (values) => Presets[values.presetId]?.name || Presets[values.presetId]?.instagramName || 'Instagram' }),
		scanlines: Object.freeze({ id: 'scanlines', label: 'Scanlines', group: 'web', tags: ['crt', 'retro'], fields: Object.freeze({
			strength: numeric('filterLookStrength', 'filterLookStrength'), spacing: numeric('filterScanlineSpacing', 'filterScanlineSpacing')
		}), recipe: (values) => [step('gradient', {
			mode: 'overlay', opacity: 0.55 * values.strength / 100, gradient: { type: 'repeating-linear', angle: 180, size: values.spacing, stops: [stop(0, 'rgba(0,0,0,0.55)'), stop(0.5, 'rgba(0,0,0,0.55)'), stop(0.5, 'transparent'), stop(1, 'transparent')] }
		})] }),
		'light-leak': Object.freeze({ id: 'light-leak', label: 'Light Leak', group: 'web', tags: ['film', 'warm'], fields: Object.freeze({
			strength: numeric('filterLookStrength', 'filterLookStrength'), size: numeric('filterLightLeakSize', 'filterLightLeakSize')
		}), recipe: (values) => [
			step('gradient', { mode: 'screen', opacity: 0.8 * values.strength / 100, gradient: { type: 'radial', center: [0.02, 0.45], radius: 0.75 * values.size / 100, stops: [stop(0, 'rgba(255,82,34,0.95)'), stop(0.42, 'rgba(255,176,72,0.45)'), stop(1, 'transparent')] } }),
			step('gradient', { mode: 'screen', opacity: 0.45 * values.strength / 100, gradient: { type: 'radial', center: [0.95, 0.12], radius: 0.55 * values.size / 100, stops: [stop(0, 'rgba(255,224,122,0.75)'), stop(1, 'transparent')] } })
		] }),
		'dreamy-glow': Object.freeze({ id: 'dreamy-glow', label: 'Dreamy Glow', group: 'web', tags: ['soft', 'glow'], fields: Object.freeze({
			strength: numeric('filterLookStrength', 'filterLookStrength'), radius: numeric('filterDreamyGlowRadius', 'filterDreamyGlowRadius')
		}), recipe: (values) => [step('blur', { radius: values.radius, mode: 'normal', opacity: 0.62 * values.strength / 100, composite: true })] })
	});

	const FILTER_TYPES = Object.freeze(Object.keys(FILTERS));

	function fieldOptions(field) {
		return typeof field.options === 'function' ? field.options() : (field.options || []);
	}

	function normalize(type, value = {}) {
		const filter = FILTERS[type] || FILTERS[CONFIG.tools.filter.defaultType];
		const normalized = { type: filter.id };
		if (filter.id === 'instagram') normalized.presetId = Object.hasOwn(Presets, value.presetId) ? value.presetId : 'rio';
		Object.entries(filter.fields).forEach(([key, field]) => {
			const sourceValue = value[key];
			if (field.kind === 'number') {
				const parsed = Number(sourceValue);
				const fallback = field.spec.value;
				normalized[key] = Math.min(field.spec.max, Math.max(field.spec.min, Number.isFinite(parsed) ? parsed : fallback));
			} else if (field.kind === 'boolean') normalized[key] = sourceValue == null ? field.default : Boolean(sourceValue);
			else if (field.kind === 'color') normalized[key] = /^#[0-9a-f]{6}$/i.test(sourceValue) ? sourceValue : field.default;
			else if (field.kind === 'select') {
				const options = fieldOptions(field);
				normalized[key] = options.some((entry) => entry.value === sourceValue) ? sourceValue : field.default;
			}
		});
		filter.normalize?.(normalized, value);
		return normalized;
	}

	function recipe(value) {
		const normalized = normalize(value?.type, value);
		return FILTERS[normalized.type].recipe(normalized).map((entry) => ({ op: entry.op, params: clone(entry.params) }));
	}

	function tier(value) {
		return recipe(value).every((entry) => typeof Ops.get(entry.op)?.css === 'function') ? 1 : 3;
	}

	const instagramLookEntries = Object.entries(Presets).map(([presetId, preset]) => ({
		id: `instagram:${presetId}`,
		label: preset.name || preset.instagramName,
		group: 'instagram',
		tags: [preset.instagramName],
		attribution: preset.attribution,
		value: { type: 'instagram', presetId }
	}));
	const looksLibrary = PresetLibrary.createPresetLibrary({
		id: 'filter-looks',
		groups: [
			{ id: 'adjust', label: 'Adjust' }, { id: 'stylize', label: 'Stylize' },
			{ id: 'web', label: 'Web & Film' }, { id: 'instagram', label: 'Instagram' }
		],
		entries: [
			...FILTER_TYPES.filter((id) => id !== 'instagram').map((id) => ({
				id, label: FILTERS[id].label, group: FILTERS[id].group, tags: FILTERS[id].tags, value: { type: id }
			})),
			...instagramLookEntries
		],
		renderThumbnail(entry, element) { root.GlitterFilter?.renderCssThumbnail?.(element, normalize(entry.value.type, entry.value)); }
	});

	const api = { FILTERS, FILTER_TYPES, looksLibrary, get: (id) => FILTERS[id] || null, list: () => Object.values(FILTERS), fieldOptions, normalize, recipe, tier };
	root.GlitterFilters = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
