function resolveEffectPaintSource(effectData, options = {}) {
	if (!effectData) {
		return null;
	}

	if (options.allowNone && effectData.mode === 'none') {
		return null;
	}

	const glitterId = options.glitterId ?? effectData.glitterId ?? null;
	const scale = options.scale ?? effectData.scale ?? 100;
	const opacity = options.opacity ?? effectData.opacity ?? 100;
	const colorAdjust = options.colorAdjust ?? effectData.colorAdjust;
	const solidColor = options.solidColor ?? effectData.color ?? '#000000';
	const glitterAvailable = typeof options.glitterAvailable === 'function'
		? options.glitterAvailable(glitterId)
		: options.glitterAvailable !== false;
	const wantsGlitter = effectData.mode
		? effectData.mode === 'glitter'
		: Boolean(glitterId);

	if (wantsGlitter && glitterId && glitterAvailable) {
		return {
			mode: 'glitter',
			glitterId,
			scale,
			opacity: opacity / 100,
			colorAdjust
		};
	}

	return {
		mode: 'solid',
		color: solidColor,
		opacity: opacity / 100
	};
}
