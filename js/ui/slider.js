function bindSlider(slider, valueEl, options = {}) {
	if (!slider) return null;

	const {
		suffix = '',
		formatValue = (value) => formatUnit(value, suffix),
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

	const handleError = (error) => {
		if (typeof onError === 'function') {
			onError(error);
			return;
		}
		console.error(error);
	};

	const readValue = () => parseValue(slider.value);
	const updateDisplay = (value) => {
		if (valueEl) valueEl.innerHTML = formatValue(value);
	};
	const syncResetButton = (value) => {
		if (!resetButton || resetValue === undefined) return;
		resetButton.disabled = value === resetValue;
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
		if (resetValue === undefined) return;
		slider.value = String(resetValue);
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

