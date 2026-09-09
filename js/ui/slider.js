// A range input's raw position (an integer over its min..max) can map to a
// different logical value via data-scale. Only 'log' exists: position runs
// geometrically across [data-scale-min, data-scale-max], so the low end of the
// track gets far more resolution. With no data-scale, value === position, so
// every existing slider is untouched.
function sliderScaleFor(el) {
	if (!el || el.dataset.scale !== 'log') {
		return { toValue: (pos) => pos, toPosition: (val) => val };
	}
	const posMax = Number(el.max) || 1000;
	const lo = Math.log(Number(el.dataset.scaleMin) || 1);
	const hi = Math.log(Number(el.dataset.scaleMax) || 100);
	const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
	return {
		toValue: (pos) => Math.round(Math.exp(lo + (clamp(pos, 0, posMax) / posMax) * (hi - lo))),
		toPosition: (val) => Math.round(posMax * (Math.log(clamp(Number(val), Math.exp(lo), Math.exp(hi))) - lo) / (hi - lo))
	};
}

// The logical value of a slider (px, %, …): its DOM position through the scale.
function readSliderValue(el) {
	return sliderScaleFor(el).toValue(Number(el.value));
}

// Put a logical value onto a slider, converting to a raw position first.
function writeSliderValue(el, value) {
	el.value = String(sliderScaleFor(el).toPosition(value));
}

function bindSlider(slider, valueEl, options = {}) {
	if (!slider) return null;

	// A `.property-value` stamped `data-value-scale="percent"` (buildSliderRow's
	// `valueScale: 'percent'`) reads as its 0–100 % position through the slider's
	// real range — the readout the caller gets for free, no custom formatValue.
	const asPercent = valueEl?.dataset?.valueScale === 'percent';
	const scaleMin = asPercent ? Number(slider.dataset.scaleMin ?? slider.min) : 0;
	const scaleMax = asPercent ? Number(slider.dataset.scaleMax ?? slider.max) : 1;

	const {
		suffix = '',
		formatValue = asPercent
			? (value) => formatRangePercent(value, scaleMin, scaleMax)
			: (value) => formatUnit(value, suffix),
		parseValue = (rawValue) => parseInt(rawValue, 10),
		apply = null,
		onCommit = null,
		onError = null,
		resetValue,
		resetButton = null,
		debounceMs = CONFIG.tools.selection.timing.sliderDebounceMs,
		enableDoubleClickReset = false
	} = options;

	let lastApplyPromise = Promise.resolve();
	let commitTimeout = null;
	let commitVersion = 0;

	// resetValue may be a function so the revert target can follow context (e.g.
	// the mask brush's Size/Spacing revert to the active raster tip's manifest
	// value, not a fixed default). Resolved fresh on every read.
	const resolveReset = () => (typeof resetValue === 'function' ? resetValue() : resetValue);

	const handleError = (error) => {
		if (typeof onError === 'function') {
			onError(error);
			return;
		}
		console.error(error);
	};

	const readValue = () => sliderScaleFor(slider).toValue(parseValue(slider.value));
	const updateDisplay = (value) => {
		if (valueEl) valueEl.innerHTML = formatValue(value);
	};
	const syncResetButton = (value) => {
		const target = resolveReset();
		if (!resetButton || target === undefined) return;
		resetButton.disabled = value === target;
	};
	const runApply = (value, event) => {
		updateDisplay(value);
		syncResetButton(value);
		if (typeof apply !== 'function') return Promise.resolve();

		try {
			return Promise.resolve(apply(value, slider, event));
		} catch (error) {
			handleError(error);
			return Promise.resolve();
		}
	};
	const scheduleCommit = (value, event) => {
		if (typeof onCommit !== 'function') return;
		clearTimeout(commitTimeout);
		const version = ++commitVersion;
		commitTimeout = setTimeout(async () => {
			try {
				await lastApplyPromise;
				if (version !== commitVersion) return;
				await onCommit(value, slider, event);
			} catch (error) {
				handleError(error);
			}
		}, debounceMs);
	};
	const resetToDefault = () => {
		const target = resolveReset();
		if (target === undefined) return;
		writeSliderValue(slider, target);
		slider.dispatchEvent(new Event('input'));
		slider.dispatchEvent(new Event('change'));
	};

	slider.addEventListener('input', (event) => {
		const value = readValue();
		lastApplyPromise = runApply(value, event).catch((error) => {
			handleError(error);
		});
	});

	slider.addEventListener('change', (event) => {
		const value = readValue();
		updateDisplay(value);
		syncResetButton(value);
		scheduleCommit(value, event);
	});

	if (resetButton && resetValue !== undefined) {
		// Claim this button so the panel-wide revert fallback leaves it alone.
		resetButton.dataset.revertBound = '';
		resetButton.addEventListener('click', resetToDefault);
	}

	if (enableDoubleClickReset && resetValue !== undefined) {
		slider.addEventListener('dblclick', resetToDefault);
	}

	const initialValue = readValue();
	updateDisplay(initialValue);
	syncResetButton(initialValue);

	return {
		updateDisplay,
		syncResetButton,
		resetToDefault
	};
}

