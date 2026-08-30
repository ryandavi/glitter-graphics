'use strict';

const EXPORT_SETTINGS_SCHEMA = Object.freeze({
	format: { storageKey: 'exportFormat', default: () => CONFIG.export.defaults.format, group: 'output', validate: (value) => ['gif', 'mp4'].includes(value) ? value : CONFIG.export.defaults.format },
	mp4LengthMode: { storageKey: 'exportMp4LengthMode', element: 'exportMp4LengthMode', default: () => CONFIG.export.mp4.lengthMode, group: 'playback', validate: (value) => ['duration', 'loops'].includes(value) ? value : CONFIG.export.mp4.lengthMode },
	mp4TargetDuration: { storageKey: 'exportMp4TargetDuration', element: 'exportMp4TargetDuration', kind: 'number', default: () => CONFIG.export.mp4.targetDurationSeconds, group: 'playback', validate: (value) => clampNumber(value, CONFIG.export.mp4.minDurationSeconds, CONFIG.export.mp4.maxDurationSeconds, CONFIG.export.mp4.targetDurationSeconds) },
	mp4LoopCount: { storageKey: 'exportMp4LoopCount', element: 'exportMp4LoopCount', kind: 'integer', default: () => CONFIG.export.mp4.loopCount, group: 'playback', validate: (value) => clampNumber(value, CONFIG.export.mp4.minLoopCount, CONFIG.export.mp4.maxLoopCount, CONFIG.export.mp4.loopCount, true) },
	mp4Quality: { storageKey: 'exportMp4Quality', element: 'exportMp4Quality', default: () => CONFIG.export.mp4.defaultQuality, group: 'quality', validate: (value) => CONFIG.export.mp4.qualityPresets[value] ? value : CONFIG.export.mp4.defaultQuality },
	quality: { storageKey: 'exportQuality', element: 'exportQuality', kind: 'integer', default: () => CONFIG.export.defaults.quality, group: 'optimization', validate: (value) => clampNumber(value, 1, 30, CONFIG.export.defaults.quality, true) },
	ditherEnabled: { storageKey: 'exportDitherEnabled', element: 'exportDitherEnabled', kind: 'checkbox', default: () => CONFIG.export.defaults.ditherEnabled, group: 'quality', validate: Boolean },
	ditherType: { storageKey: 'exportDitherType', element: 'exportDitherType', default: () => CONFIG.export.defaults.ditherType, group: 'quality', validate: (value) => typeof value === 'string' && value ? value : CONFIG.export.defaults.ditherType },
	colorCount: { storageKey: 'exportColorCount', element: 'exportColorCount', default: () => CONFIG.export.defaults.colorCount, group: 'quality', validate: (value) => value === 'auto' || [32, 64, 128, 256].includes(Number(value)) ? (value === 'auto' ? value : Number(value)) : CONFIG.export.defaults.colorCount },
	ditherAmount: { storageKey: 'exportDitherAmount', element: 'exportDitherAmount', kind: 'integer', default: () => CONFIG.export.defaults.ditherAmount, group: 'quality', validate: (value) => clampNumber(value, 0, 100, CONFIG.export.defaults.ditherAmount, true) },
	ditherScale: { storageKey: 'exportDitherScale', element: 'exportDitherScale', kind: 'integer', default: () => CONFIG.export.defaults.ditherScale, group: 'quality', validate: (value) => clampNumber(value, 1, 4, CONFIG.export.defaults.ditherScale, true) },
	ditherTemporalMode: { storageKey: 'exportDitherTemporalMode', element: 'exportDitherTemporalMode', default: () => CONFIG.export.defaults.ditherTemporalMode, group: 'quality', validate: (value) => ['stable', 'animated'].includes(value) ? value : CONFIG.export.defaults.ditherTemporalMode },
	ditherEdgeProtection: { storageKey: 'exportDitherEdgeProtection', element: 'exportDitherEdgeProtection', kind: 'checkbox', default: () => CONFIG.export.defaults.ditherEdgeProtection, group: 'quality', validate: Boolean },
	paletteStyle: { storageKey: 'exportPaletteStyle', element: 'exportPaletteStyle', default: () => CONFIG.export.defaults.paletteStyle, group: 'quality', validate: (value) => ['vivid', 'balanced', 'natural', 'websafe'].includes(value) ? value : CONFIG.export.defaults.paletteStyle },
	ditherPreset: { storageKey: 'exportDitherPreset', element: 'exportDitherPreset', default: () => CONFIG.export.defaults.ditherPreset, group: 'quality', validate: (value) => ['classic', 'clean', 'textured', 'crunchy', 'shimmer', 'custom'].includes(value) ? value : CONFIG.export.defaults.ditherPreset },
	baseImage: { storageKey: 'exportBaseImage', element: 'exportBaseImage', kind: 'checkbox', default: () => CONFIG.export.defaults.baseImage, group: 'output', validate: Boolean },
	frameDelay: { storageKey: 'exportFrameDelay', element: 'exportFrameDelay', kind: 'integer', default: () => CONFIG.export.defaults.frameDelay, group: 'playback', validate: (value) => Number.isFinite(value) && value >= 20 ? Math.round(value) : 20 },
	maxFrames: { storageKey: 'exportMaxFrames', element: 'exportMaxFrames', parse: (value) => value === 'unlimited' ? CONFIG.export.limits.maxFramesHardLimit : parseInt(value), default: () => CONFIG.export.defaults.maxFrames, group: 'optimization', validate: (value) => clampNumber(value, 1, CONFIG.export.limits.maxFramesHardLimit, CONFIG.export.defaults.maxFrames, true) },
	transparency: { storageKey: 'exportTransparency', element: 'exportTransparency', kind: 'checkbox', default: () => CONFIG.export.defaults.transparency, group: 'output', validate: Boolean },
	matteColor: { storageKey: 'exportMatteColor', element: 'exportMatteColor', default: () => CONFIG.export.defaults.matteColor, group: 'output', validate: (value) => /^#[0-9A-Fa-f]{6}$/.test(value) ? value : CONFIG.export.defaults.matteColor },
	watermarkEnabled: { storageKey: 'exportWatermarkEnabled', element: 'exportWatermarkEnabled', kind: 'checkbox', default: () => CONFIG.export.defaults.watermarkEnabled, group: 'output', validate: Boolean },
	watermark: { storageKey: 'exportWatermark', element: 'exportWatermark', default: () => CONFIG.export.defaults.watermark, group: 'output', validate: (value) => CONFIG.export.watermark.options.some((option) => option.url === value) ? value : CONFIG.export.defaults.watermark },
	exportFrameSkip: { storageKey: 'exportFrameSkip', element: 'exportFrameSkip', kind: 'integer', default: () => CONFIG.export.defaults.frameSkip, group: 'optimization', validate: (value) => Number.isFinite(value) && value >= 1 ? Math.round(value) : CONFIG.export.defaults.frameSkip },
	exportReverse: { storageKey: 'exportReverse', element: 'exportReverse', kind: 'checkbox', default: () => CONFIG.export.defaults.reverse, group: 'playback', validate: Boolean },
	smartFrameReduction: { storageKey: 'exportSmartFrameReduction', element: 'exportSmartFrameReduction', kind: 'checkbox', default: () => CONFIG.export.defaults.smartFrameReduction, group: 'optimization', validate: Boolean },
	optimizationPreset: { storageKey: 'exportOptimizationPreset', element: 'exportOptimizationPreset', default: () => CONFIG.export.defaults.optimizationPreset, group: 'optimization', validate: (value) => CONFIG.export.timeline.presets[value] ? value : CONFIG.export.timeline.defaultPreset },
	// 'auto' defers to the Optimization Goal's own sampling rate. Without it the
	// stored number always won, which made the goal's fidelity setting inert.
	maxSamplingFps: { storageKey: 'exportMaxSamplingFps', element: 'exportMaxSamplingFps', group: 'optimization', default: () => CONFIG.export.defaults.maxSamplingFps, parse: (value) => value === 'auto' ? 'auto' : parseInt(value), validate: (value) => value === 'auto' ? 'auto' : clampNumber(value, 1, CONFIG.export.timeline.maxSamplingFps, CONFIG.export.defaults.maxSamplingFps, true) }
});

function clampNumber(value, minimum, maximum, fallback, integer = false) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	const clamped = Math.min(maximum, Math.max(minimum, numeric));
	return integer ? Math.round(clamped) : clamped;
}

class SettingsStore {
	constructor(schema) {
		this.schema = schema;
		this.boundElements = new WeakSet();
	}

	load(source = {}) {
		return Object.fromEntries(Object.entries(this.schema).map(([key, spec]) => {
			const value = Object.prototype.hasOwnProperty.call(source, spec.storageKey)
				? source[spec.storageKey]
				: spec.default();
			return [key, spec.validate(value)];
		}));
	}

	validate(values) {
		Object.entries(this.schema).forEach(([key, spec]) => {
			values[key] = spec.validate(values[key]);
		});
		return values;
	}

	serialize(values) {
		return Object.fromEntries(Object.entries(this.schema).map(([key, spec]) => [
			spec.storageKey,
			values[key]
		]));
	}

	syncToUI(values) {
		Object.entries(this.schema).forEach(([key, spec]) => {
			if (!spec.element) return;
			const element = el(spec.element);
			if (!element) return;
			if (spec.kind === 'checkbox') element.checked = Boolean(values[key]);
			else element.value = values[key];
		});
	}

	bindListeners(values, onChange) {
		Object.entries(this.schema).forEach(([key, spec]) => {
			if (!spec.element) return;
			const element = el(spec.element);
			if (!element || this.boundElements.has(element)) return;
			this.boundElements.add(element);
			element.addEventListener('change', () => {
				const rawValue = spec.kind === 'checkbox' ? element.checked : element.value;
				const parsed = spec.parse ? spec.parse(rawValue) : spec.kind === 'number'
					? parseFloat(rawValue)
					: spec.kind === 'integer' ? parseInt(rawValue) : rawValue;
				values[key] = spec.validate(parsed);
				onChange?.(key, values[key], element);
			});
		});
	}

	reset(values, group = null) {
		Object.entries(this.schema).forEach(([key, spec]) => {
			if (!group || spec.group === group) values[key] = spec.default();
		});
		return this.validate(values);
	}
}
