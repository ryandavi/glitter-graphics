// A range input's raw position (an integer over its min..max) can map to a
// different logical value via data-scale. Only 'log' exists: position runs
// geometrically across [data-scale-min, data-scale-max], so the low end of the
// track gets far more resolution. Values land on data-scale-step (whole
// numbers without it). With no data-scale, value === position, so every
// existing slider is untouched.
function sliderScaleFor(el) {
	if (!el || el.dataset.scale !== 'log') {
		return { toValue: (pos) => pos, toPosition: (val) => val };
	}
	const posMax = Number(el.max) || 1000;
	const lo = Math.log(Number(el.dataset.scaleMin) || 1);
	const hi = Math.log(Number(el.dataset.scaleMax) || 100);
	const grid = Number(el.dataset.scaleStep) || 1;
	return {
		toValue: (pos) => Number((Math.round(Math.exp(lo + (clamp(pos, 0, posMax) / posMax) * (hi - lo)) / grid) * grid).toFixed(stepDecimals(grid))),
		toPosition: (val) => Math.round(posMax * (Math.log(clamp(Number(val), Math.exp(lo), Math.exp(hi))) - lo) / (hi - lo))
	};
}

// A slider whose spec has typeMin / typeMax accepts a typed value past its
// track. The thumb rests at the end and the value itself is kept in
// data-typed-value until the track is dragged or stepped again.
function sliderTypedValue(el) {
	const typed = el?.dataset?.typedValue;
	return typed === undefined ? null : Number(typed);
}

// The logical value of a slider (px, %, …): its DOM position through the scale.
function readSliderValue(el) {
	return sliderTypedValue(el) ?? sliderScaleFor(el).toValue(Number(el.value));
}

// Put a logical value onto a slider, converting to a raw position first.
function writeSliderValue(el, value) {
	el.value = String(sliderScaleFor(el).toPosition(value));
	const next = Number(value);
	if (el.dataset.typeMax !== undefined && Number.isFinite(next) && (next < Number(el.min) || next > Number(el.max))) {
		el.dataset.typedValue = String(Math.min(Number(el.dataset.typeMax), Math.max(Number(el.dataset.typeMin), next)));
	} else {
		delete el.dataset.typedValue;
	}
}

// The readout text for a slider value: a percent of the slider's range when the
// readout asks for it (buildSliderRow's `valueScale: 'percent'`), otherwise the
// value with its unit. The unit defaults to the one the renderer stamped.
function formatSliderReadout(slider, valueEl, value, unit = slider.dataset.unit ?? '') {
	if (valueEl?.dataset?.valueScale === 'percent') {
		return formatRangePercent(value, Number(slider.dataset.scaleMin ?? slider.min), Number(slider.dataset.scaleMax ?? slider.max));
	}
	return formatUnit(value, unit);
}

// Show a value a panel set programmatically: track position, readout and
// revert state. Programmatic writes fire no input/change events, so the
// listeners bindSlider installed never see them.
function syncSlider(slider, value, options = {}) {
	if (!slider) return;
	const valueEl = options.valueEl !== undefined ? options.valueEl : document.getElementById(`${slider.id}Value`);
	writeSliderValue(slider, value);
	if (valueEl) valueEl.innerHTML = formatSliderReadout(slider, valueEl, value, options.unit);
	if (typeof syncPropertyRevert === 'function') syncPropertyRevert(slider);
}

// ===== LIVE APPLY SCHEDULER =====
// A control's canvas work runs at a cadence picked from what the work costs
// (FIELDS `cost`), never per call site:
//   style    a CSS property on existing elements: once per frame
//   raster   re-rasterizes a mask on the main thread: once per frame, until a
//            run goes over CONFIG.ui.live.rasterBudgetMs; then only once the
//            value settles, until a run is fast again
//   compute  a whole-document recompute: the same against settleMs, with the
//            activity pill while a value waits
// Every tier is latest-wins: one run in flight and one value waiting. Readouts
// and revert state belong to the caller and update on every tick;
// flushLiveApply (a slider's release) runs the waiting value at once.
const LIVE_APPLY_JOBS = new Map();

function liveApplyBudget(cost) {
	if (cost === 'raster') return CONFIG.ui.live.rasterBudgetMs;
	if (cost === 'compute') return CONFIG.ui.live.settleMs;
	return Infinity;
}

function armLiveApply(job) {
	if (job.running) return;
	if (job.slow) {
		clearTimeout(job.timer);
		if (job.cost === 'compute' && !job.endActivity && typeof window !== 'undefined') {
			job.endActivity = window.editor?.beginActivity?.('live-apply', 'Updating preview') || null;
		}
		job.timer = setTimeout(() => {
			job.timer = 0;
			startLiveApply(job);
		}, CONFIG.ui.live.settleMs);
		return;
	}
	if (!job.frame) {
		job.frame = requestAnimationFrame(() => {
			job.frame = 0;
			startLiveApply(job);
		});
	}
}

function finishLiveApply(job, runId, started) {
	if (runId === job.runId) {
		job.slow = performance.now() - started > liveApplyBudget(job.cost);
		job.inFlight = null;
	}
	if (job.running) return;
	if (job.pending) {
		armLiveApply(job);
		return;
	}
	job.endActivity?.();
	job.endActivity = null;
	if (!job.slow) LIVE_APPLY_JOBS.delete(job.key);
}

// Runs the waiting value. The run receives a ticket: an async run checks
// ticket.isCurrent() after each await and stops once a newer run has started.
function startLiveApply(job) {
	const run = job.pending;
	if (!run) return undefined;
	job.pending = null;
	const runId = ++job.runId;
	const started = performance.now();
	let result;
	try {
		result = run({ isCurrent: () => job.runId === runId });
	} catch (error) {
		finishLiveApply(job, runId, started);
		throw error;
	}
	if (result && typeof result.then === 'function') {
		job.running += 1;
		const settle = () => {
			job.running -= 1;
			finishLiveApply(job, runId, started);
		};
		const inFlight = result.then(settle, (error) => {
			settle();
			throw error;
		});
		// Still the newest run unless it settled already or was superseded.
		if (job.runId === runId && job.running) job.inFlight = inFlight;
		return inFlight;
	}
	finishLiveApply(job, runId, started);
	return undefined;
}

function scheduleLiveApply(key, cost, run) {
	let job = LIVE_APPLY_JOBS.get(key);
	if (!job) {
		job = { key, cost, pending: null, frame: 0, timer: 0, running: 0, runId: 0, slow: false, inFlight: null, endActivity: null };
		LIVE_APPLY_JOBS.set(key, job);
	}
	job.cost = cost;
	job.pending = run;
	armLiveApply(job);
}

// Runs the waiting value now, even over a run still in flight (whose ticket
// goes stale). Returns a promise while the final value is still being applied.
function flushLiveApply(key) {
	const job = LIVE_APPLY_JOBS.get(key);
	if (!job) return undefined;
	if (job.frame) cancelAnimationFrame(job.frame);
	clearTimeout(job.timer);
	job.frame = 0;
	job.timer = 0;
	if (job.pending) return startLiveApply(job);
	return job.inFlight || undefined;
}

// options:
//   cost                                 FIELDS cost tier of `apply`
//   onInput(value, slider, event)        every tick, before any scheduling:
//                                        mirrors and readouts only
//   apply(value, slider, event, ticket)  the canvas work, scheduled by `cost`
//   onCommit(value, slider, event)       once per gesture, after the final apply
function bindSlider(slider, valueEl, options = {}) {
	if (!slider) return null;

	// A `.property-value` stamped `data-value-scale="percent"` (buildSliderRow's
	// `valueScale: 'percent'`) reads as its 0–100 % position through the slider's
	// real range — the readout the caller gets for free, no custom formatValue.
	const {
		suffix = slider.dataset.unit ?? '',
		formatValue = (value) => formatSliderReadout(slider, valueEl, value, suffix),
		parseValue = (rawValue) => parseInt(rawValue, 10),
		apply = null,
		onInput = null,
		onCommit = null,
		onError = null,
		resetValue,
		resetButton = null,
		cost = 'style',
		enableDoubleClickReset = false
	} = options;

	const liveKey = slider.id || slider;

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

	const readValue = () => sliderTypedValue(slider) ?? sliderScaleFor(slider).toValue(parseValue(slider.value));
	const updateDisplay = (value) => {
		if (valueEl) valueEl.innerHTML = formatValue(value);
	};
	const syncResetButton = (value) => {
		const target = resolveReset();
		if (!resetButton || target === undefined) return;
		resetButton.disabled = value === target;
	};
	// Never rejects, so the scheduler's latest-wins chain and the commit that
	// waits on it cannot stall on a failed apply.
	const runApply = (value, event, ticket) => {
		try {
			const result = apply(value, slider, event, ticket);
			return result && typeof result.then === 'function' ? result.then(null, handleError) : undefined;
		} catch (error) {
			handleError(error);
			return undefined;
		}
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
		updateDisplay(value);
		syncResetButton(value);
		if (typeof onInput === 'function') onInput(value, slider, event);
		if (typeof apply === 'function') scheduleLiveApply(liveKey, cost, (ticket) => runApply(value, event, ticket));
	});

	// Release: the final value is applied at once, then committed. A commit
	// that waits on an async apply keeps the history key of the key step that
	// caused it.
	slider.addEventListener('change', (event) => {
		const value = readValue();
		updateDisplay(value);
		syncResetButton(value);
		const stepKey = currentStepCoalesceKey();
		const commit = () => {
			if (typeof onCommit !== 'function') return;
			try {
				const result = withStepCoalesceKey(stepKey, () => onCommit(value, slider, event));
				if (result && typeof result.then === 'function') result.then(null, handleError);
			} catch (error) {
				handleError(error);
			}
		};
		const settled = flushLiveApply(liveKey);
		if (settled) settled.then(commit, commit);
		else commit();
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

// ===== NUMERIC CONTROL KEYS =====
// One stepping function and one delegated listener for every numeric control:
// number fields, sliders, and the editable readout beside a slider (a
// contenteditable `[role="spinbutton"]` that proxies its range input).

const NUMERIC_CONTROL_SELECTOR = 'input[type="number"], input[type="range"], [role="spinbutton"][data-editable-value]';

// History key shared by the saves one key step triggers, so a held arrow is
// one undo. editor.saveState reads it; it is set only while a step's events run.
let stepCoalesceKey = null;
let numericFocusSession = 0;
let numericControlKeyCount = 0;
const numericControlKeys = new WeakMap();

function currentStepCoalesceKey() {
	return stepCoalesceKey;
}

function withStepCoalesceKey(key, run) {
	const previous = stepCoalesceKey;
	stepCoalesceKey = key;
	try {
		return run();
	} finally {
		stepCoalesceKey = previous;
	}
}

// Steps coalesce per control and per visit: leaving a control and coming back
// starts a new undo step, so an earlier run of steps can still be undone to.
function numericStepCoalesceKey(control) {
	let key = control.id;
	if (!key) {
		if (!numericControlKeys.has(control)) numericControlKeys.set(control, `control${++numericControlKeyCount}`);
		key = numericControlKeys.get(control);
	}
	return `step:${key}:${numericFocusSession}`;
}

// The input a numeric control steps: itself, or a readout's range input.
function numericStepTarget(control) {
	if (!control) return null;
	if (control.tagName === 'INPUT') return control;
	return control.closest('.property-pair-cell, .property-row')?.querySelector(':scope > input[type="range"]') || null;
}

function stepDecimals(step) {
	const text = String(step);
	if (text.includes('e-')) return Number(text.split('e-')[1]);
	return (text.split('.')[1] || '').length;
}

// One key step: plain = one `step`, Shift = x10, Alt = x0.1 where the field
// has no step grid (`step="any"`); elsewhere Alt does nothing, so a value
// never lands off its grid. A slider steps in its raw track domain, so a log
// slider steps geometrically. Writes the value and fires `input` then
// `change`, as a native step does. A scrub uses value units from its start,
// schedules input through live apply, and defers change until release.
// Returns whether the value changed.
function stepNumericControl(control, direction, { shift = false, alt = false, scrub = false, from, commit = true } = {}) {
	const target = numericStepTarget(control);
	if (!target || target.disabled || target.readOnly) return false;
	const isRange = target.type === 'range';
	const gridless = !isRange && target.step === 'any';
	if (alt && !shift && !gridless && !scrub) return false;
	const grid = Number(target.step) > 0 ? Number(target.step) : 1;
	const step = (scrub ? 1 : grid) * (shift ? 10 : alt ? 0.1 : 1);
	const hasBound = (bound) => bound !== '' && bound != null;
	const min = hasBound(target.min) ? Number(target.min) : (isRange ? 0 : -Infinity);
	const max = hasBound(target.max) ? Number(target.max) : (isRange ? 100 : Infinity);
	// A readout steps as far as it can be typed; the track stops at its ends.
	const pastTrack = isRange && control !== target && target.dataset.typeMax !== undefined;
	const low = pastTrack ? Number(target.dataset.typeMin) : min;
	const high = pastTrack ? Number(target.dataset.typeMax) : max;
	const current = (isRange ? sliderTypedValue(target) : null) ?? (Number(target.value) || 0);
	let next = (from ?? current) + direction * step;
	let decimals = Math.max(stepDecimals(current), stepDecimals(step));
	if (!gridless) {
		// Land on the step grid (counted from min, as the browser does), so a
		// typed off-grid value steps back onto it.
		const origin = Number.isFinite(min) ? min : 0;
		next = origin + Math.round((next - origin) / grid) * grid;
		decimals = stepDecimals(grid);
	}
	next = Number(Math.min(high, Math.max(low, next)).toFixed(decimals));
	// A log track holds one value across several positions where its value grid
	// is coarser than the track, so a step moves on to the next value.
	if (isRange && !pastTrack && target.dataset.scale === 'log') {
		const scale = sliderScaleFor(target);
		while (next > low && next < high && scale.toValue(next) === scale.toValue(current)) next += direction;
	}
	if (next === current) return false;
	if (pastTrack) writeSliderValue(target, next);
	else {
		target.value = String(next);
		if (isRange) delete target.dataset.typedValue;
	}
	const preview = () => target.dispatchEvent(new Event('input', { bubbles: true }));
	if (scrub) scheduleLiveApply(target, target.dataset.numericCost || 'style', preview);
	else withStepCoalesceKey(numericStepCoalesceKey(target), preview);
	if (commit) withStepCoalesceKey(numericStepCoalesceKey(target), () => target.dispatchEvent(new Event('change', { bubbles: true })));

	return true;
}

// What the focused element does with the keyboard, for the app's shortcut
// guard and the layer nudge:
//   typing  it takes typed characters, so shortcuts stay out
//   arrows  the arrow keys it uses itself: 'all', 'vertical' or null. A
//           button, toggle or segmented option uses none, so the arrows still
//           nudge the layer while one has focus.
const ARROWLESS_INPUT_TYPES = new Set(['checkbox', 'button', 'submit', 'reset', 'color', 'file', 'image']);

function focusKeyClaim(element = document.activeElement) {
	if (!element || !element.tagName) return { typing: false, arrows: null };
	const tag = element.tagName;
	const typing = tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element.isContentEditable);
	let arrows = null;
	if (tag === 'INPUT') arrows = ARROWLESS_INPUT_TYPES.has(element.type) ? null : 'all';
	else if (typing || tag === 'SELECT') arrows = 'all';
	else if (element.closest('[role="slider"], [role="spinbutton"], [role="grid"], [data-picker-navigation]')) arrows = 'all';
	else if (element.closest('[role="listbox"]')) arrows = 'vertical';
	return { typing, arrows };
}

function focusClaimsArrowKey(key, element = document.activeElement) {
	const { arrows } = focusKeyClaim(element);
	return arrows === 'all' || (arrows === 'vertical' && (key === 'ArrowUp' || key === 'ArrowDown'));
}

function selectNumericControlText(control) {
	if (control.tagName === 'INPUT') {
		if (control.type === 'number') control.select();
		return;
	}
	const range = document.createRange();
	range.selectNodeContents(control);
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
}

// Readouts the user has typed into since they last matched their slider.
const editedReadouts = new WeakSet();

// Typed readout text -> its slider. A readout nobody typed into commits
// nothing, so focusing one and leaving records no history.
function commitEditableReadout(readout) {
	if (!editedReadouts.has(readout)) return;
	editedReadouts.delete(readout);
	const input = numericStepTarget(readout);
	if (!input) return;
	const typed = Number.parseFloat(readout.textContent);
	const next = readout.dataset.valueScale === 'percent' && Number.isFinite(typed)
		? rangePercentToValue(typed, Number(input.dataset.scaleMin ?? input.min), Number(input.dataset.scaleMax ?? input.max))
		: typed;
	const before = readSliderValue(input);
	if (Number.isFinite(next)) writeSliderValue(input, next);
	// `input` redraws the readout from the slider either way.
	input.dispatchEvent(new Event('input', { bubbles: true }));
	if (readSliderValue(input) !== before) input.dispatchEvent(new Event('change', { bubbles: true }));
}

function cancelEditableReadout(readout) {
	if (!editedReadouts.has(readout)) return;
	editedReadouts.delete(readout);
	numericStepTarget(readout)?.dispatchEvent(new Event('input', { bubbles: true }));
}

// The wheel over a focused number field or readout steps it as the arrow keys
// do: up raises, Shift is x10, and one run of steps is one undo. A control
// that is not focused leaves the wheel to the panel. One mouse notch is one
// step; a trackpad's small deltas add up to CONFIG.ui.numericWheel.stepPx.
let numericWheelTravel = 0;

function stepNumericControlByWheel(event) {
	if (event.ctrlKey || event.metaKey) return;
	// Shift turns a vertical wheel into a horizontal one on some platforms.
	const delta = event.deltaY || event.deltaX;
	if (!delta) return;
	event.preventDefault();
	const control = event.currentTarget;
	numericWheelTravel = Math.sign(delta) === Math.sign(numericWheelTravel) ? numericWheelTravel + delta : delta;
	if (event.deltaMode === 0 && Math.abs(numericWheelTravel) < CONFIG.ui.numericWheel.stepPx) return;
	numericWheelTravel = 0;
	if (control.tagName !== 'INPUT') editedReadouts.delete(control);
	stepNumericControl(control, delta < 0 ? 1 : -1, { shift: event.shiftKey, alt: event.altKey });
	if (document.activeElement === control) selectNumericControlText(control);
}

// Pointer distance is in value units, independent of a field's step grid.
// Fractional motion accumulates before stepNumericControl lands on that grid.
function numericScrubDelta(distance, { shift = false, alt = false } = {}) {
	return distance * (shift ? 10 : alt ? 0.1 : 1);
}

function installNumericControlKeys() {
	// A number field's value at focus or at its last commit: what Escape restores.
	const committedValues = new WeakMap();
	let scrub = null;
	let scrubbedMark = null;
	const finishScrub = (cancel) => {
		const drag = scrub;
		if (!drag) return;
		scrub = null;
		if (drag.started) {
			scrubbedMark = drag.mark;
			if (cancel) {
				drag.input.value = drag.startText;
				scheduleLiveApply(drag.input, drag.input.dataset.numericCost || 'style', () => drag.input.dispatchEvent(new Event('input', { bubbles: true })));
			}
			const settled = flushLiveApply(drag.input);
			const commit = () => {
				if (!cancel && drag.input.value !== drag.startText) drag.input.dispatchEvent(new Event('change', { bubbles: true }));
			};
			if (settled) settled.then(commit, commit);
			else commit();
		}
		if (drag.mark.hasPointerCapture(drag.pointerId)) drag.mark.releasePointerCapture(drag.pointerId);
		drag.input.focus({ preventScroll: true });
	};
	let pointerFocusCandidate = null;
	let pendingPointerSelect = null;
	const controlOf = (target) => (target?.matches?.(NUMERIC_CONTROL_SELECTOR) ? target : null);

	document.addEventListener('keydown', (event) => {
		if (scrub && event.key === 'Escape') {
			event.preventDefault();
			event.stopImmediatePropagation();
			finishScrub(true);
			return;
		}
		const control = controlOf(event.target);
		if (!control || event.ctrlKey || event.metaKey || event.isComposing) return;
		const isRange = control.type === 'range';
		const isField = control.type === 'number';

		if (event.key === 'Enter') {
			if (isRange) return;
			if (isField) {
				// The browser commits a typed value on Enter (`change`) and focus
				// stays; the text is selected again once its handlers have re-synced it.
				setTimeout(() => {
					if (document.activeElement === control) control.select();
				}, 0);
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			commitEditableReadout(control);
			selectNumericControlText(control);
			return;
		}

		if (event.key === 'Escape') {
			// A slider has no edit to cancel: it hands the keys back and Escape
			// goes on to the app. In a modal, Escape closes the modal.
			if (isRange) {
				control.blur();
				return;
			}
			if (control.closest('.modal-content')) return;
			event.preventDefault();
			event.stopPropagation();
			if (isField) {
				// Typing previews live without committing: put the committed value back.
				const committed = committedValues.get(control);
				if (committed !== undefined && control.value !== committed) {
					control.value = committed;
					control.dispatchEvent(new Event('input', { bubbles: true }));
				}
			} else {
				cancelEditableReadout(control);
			}
			control.blur();
			return;
		}

		// Up and Down step every numeric control. Left and Right step a slider
		// and move the caret in a field. PageUp and PageDown are a slider's x10.
		const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
		const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
		const page = event.key === 'PageUp' || event.key === 'PageDown';
		if (!vertical && !(isRange && (horizontal || page))) return;
		event.preventDefault();
		event.stopPropagation();
		const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' || event.key === 'PageUp' ? 1 : -1;
		if (!isRange && !isField) editedReadouts.delete(control);
		stepNumericControl(control, direction, { shift: event.shiftKey || page, alt: event.altKey });
		if (!isRange && document.activeElement === control) selectNumericControlText(control);
	}, true);

	document.addEventListener('input', (event) => {
		if (event.target?.matches?.('[role="spinbutton"][data-editable-value]')) editedReadouts.add(event.target);
		// Dragging the track takes the value back onto it.
		if (event.isTrusted && event.target?.type === 'range') delete event.target.dataset.typedValue;
	}, true);

	document.addEventListener('change', (event) => {
		if (event.target?.matches?.('input[type="number"]')) committedValues.set(event.target, event.target.value);
	}, true);

	// Select-all on focus, so typing replaces the value. The click that gave
	// focus would otherwise drop a caret into the selection on mouseup.
	document.addEventListener('pointerdown', (event) => {
		scrubbedMark = null;
		const mark = event.target.closest?.('.numeric-scrub-mark');
		const input = mark?.control;
		if (mark && (event.pointerType === 'mouse' || event.pointerType === 'pen') && event.button === 0 && input && !input.disabled && !input.readOnly && !scrub) {
			// Deferring label focus until release avoids blur commits mid-drag.
			event.preventDefault();
			scrub = { mark, input, pointerId: event.pointerId, startX: event.clientX, lastX: event.clientX, startText: input.value, start: Number(input.value) || 0, distance: 0, started: false };
			mark.setPointerCapture(event.pointerId);
		}
		pointerFocusCandidate = controlOf(event.target);
	}, true);
	document.addEventListener('pointermove', (event) => {
		if (!scrub || scrub.pointerId !== event.pointerId) return;
		if (!scrub.started && Math.abs(event.clientX - scrub.startX) < CONFIG.ui.numericScrub.thresholdPx) return;
		if (!scrub.started) {
			// Native typed changes commit on blur. Finish that edit before the
			// drag so a later blur cannot record the same scrub a second time.
			if (document.activeElement === scrub.input && committedValues.get(scrub.input) !== scrub.input.value) {
				scrub.input.blur();
				scrub.startText = scrub.input.value;
				scrub.start = Number(scrub.input.value) || 0;
			}
			scrub.input.focus({ preventScroll: true });
		}
		scrub.started = true;
		event.preventDefault();
		scrub.distance += numericScrubDelta(event.clientX - scrub.lastX, { shift: event.shiftKey, alt: event.altKey });
		scrub.lastX = event.clientX;
		stepNumericControl(scrub.input, scrub.distance, { scrub: true, from: scrub.start, commit: false });
	}, true);
	document.addEventListener('pointerup', (event) => {
		if (scrub?.pointerId === event.pointerId) finishScrub(false);
	}, true);
	document.addEventListener('pointercancel', (event) => {
		if (scrub?.pointerId === event.pointerId) finishScrub(true);
	}, true);
	document.addEventListener('lostpointercapture', (event) => {
		if (scrub?.pointerId === event.pointerId) finishScrub(true);
	}, true);
	document.addEventListener('click', (event) => {
		if (event.target === scrubbedMark) {
			event.preventDefault();
			event.stopPropagation();
			scrubbedMark = null;
		}
	}, true);
	document.addEventListener('focusin', (event) => {
		const control = controlOf(event.target);
		if (!control) return;
		numericFocusSession += 1;
		if (control.type === 'range') return;
		if (control.type === 'number') committedValues.set(control, control.value);
		numericWheelTravel = 0;
		control.addEventListener('wheel', stepNumericControlByWheel, { passive: false });
		selectNumericControlText(control);
		pendingPointerSelect = pointerFocusCandidate === control ? control : null;
	});
	document.addEventListener('focusout', (event) => {
		event.target?.removeEventListener?.('wheel', stepNumericControlByWheel);
	});
	document.addEventListener('mouseup', (event) => {
		const control = pendingPointerSelect;
		pendingPointerSelect = null;
		pointerFocusCandidate = null;
		if (!control || event.target !== control || document.activeElement !== control) return;
		event.preventDefault();
		selectNumericControlText(control);
	}, true);

	// A dragged slider keeps focus, so the arrows continue from where the drag
	// ended (Safari and Firefox on macOS do not focus a clicked range input).
	document.addEventListener('pointerup', (event) => {
		const slider = event.target;
		if (slider?.matches?.('input[type="range"]') && !slider.disabled && document.activeElement !== slider) {
			slider.focus({ preventScroll: true });
		}
	}, true);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') installNumericControlKeys();
