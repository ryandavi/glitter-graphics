'use strict';

// Desktop rail and sidebar resizing. Widths are driven by --toolbar-width,
// --layer-panel-width, --glitter-panel-width and --library-window-width;
// dragging a handle writes those properties on :root and persists the result.
//
// Only a user-chosen width is ever written. Untouched panels keep falling
// through to the stylesheet's responsive defaults (css/panels/_layout.scss
// narrows the Layers column under 1700px and 1200px), so the app still adapts
// on its own until someone expresses a preference. The viewport follows the
// columns through its own ResizeObserver.
//
// Mobile is excluded outright: MobileManager turns these columns into sheets
// whose size is owned by the sheet-drag handle instead.

const PANEL_RESIZE_STORAGE_KEY = STORAGE_KEYS.panelWidths.key;

// Each column's custom property, element and handle edge (the handle lives on
// the side facing the canvas). Its limits and snap points are
// CONFIG.ui.panelResize.panels, merged in here.
const PANEL_RESIZE_TARGETS = Object.freeze(Object.fromEntries(Object.entries({
	toolbar: { variable: '--toolbar-width', selector: '.toolbar', handleHost: '.main-area', edge: 'end', label: 'Resize toolbar' },
	layers: { variable: '--layer-panel-width', selector: '.layers-panel', edge: 'end', label: 'Resize Layers panel' },
	inspector: { variable: '--glitter-panel-width', selector: '.inspector-panel', edge: 'start', label: 'Resize Inspector' },
	library: { variable: '--library-window-width', selector: '.library-window', edge: 'start', label: 'Resize Library window' }
}).map(([key, target]) => [key, { ...target, ...CONFIG.ui.panelResize.panels[key] }])));

// The same store holds the Library window's section share under this key.
const PANEL_SPLIT_STORAGE_FIELD = 'librarySplit';


function readPanelWidths() {
	return readStored(PANEL_RESIZE_STORAGE_KEY, {});
}

function writePanelWidths(widths) {
	writeStored(PANEL_RESIZE_STORAGE_KEY, widths);
}

// A column's live width, or 0 while it is hidden or floats over the canvas.
function getPanelFlowWidth(key) {
	const panel = document.querySelector(PANEL_RESIZE_TARGETS[key].selector);
	if (!panel) return 0;
	const style = getComputedStyle(panel);
	return style.display === 'none' || style.position === 'absolute' ? 0 : panel.getBoundingClientRect().width;
}

// The largest this panel may become without starving the canvas or the other
// columns. Measured live, so it stays correct as the window resizes.
function getPanelResizeMax(key) {
	const config = PANEL_RESIZE_TARGETS[key];
	const otherWidth = Object.keys(PANEL_RESIZE_TARGETS)
		.filter((name) => name !== key)
		.reduce((total, name) => total + getPanelFlowWidth(name), 0);
	const toolbar = document.querySelector('.toolbar');
	const toolbarWidth = toolbar && key !== 'toolbar' ? toolbar.getBoundingClientRect().width : 0;
	let available = window.innerWidth - otherWidth - toolbarWidth - CONFIG.ui.panelResize.minCanvas;
	if ((key === 'toolbar' || key === 'layers') && PREFERENCES.get('balanceSidebars')) {
		const libraryWidth = getPanelFlowWidth('library');
		const libraryFollows = libraryWidth > 0 && !document.documentElement.style.getPropertyValue(PANEL_RESIZE_TARGETS.library.variable);
		const matchingColumns = Number(getPanelFlowWidth('inspector') > 0) + Number(libraryFollows);
		const fixedWidth = libraryFollows ? 0 : libraryWidth;
		const leftLimit = Math.min(PANEL_RESIZE_TARGETS.inspector.max,
			(window.innerWidth - fixedWidth - CONFIG.ui.panelResize.minCanvas) / (1 + matchingColumns));
		available = leftLimit - (getSidebarLeftWidth() - getPanelWidth(key));
	}
	return Math.max(getPanelResizeMin(key), Math.min(config.max, Math.round(available)));
}

function getSidebarLeftWidth() {
	return getPanelWidth('toolbar') + getPanelWidth('layers')
		+ parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spacing-base'));
}

function syncSidebarBalance() {
	if (window.innerWidth <= CONFIG.ui.mobile.breakpoint || !PREFERENCES.get('balanceSidebars')) return;
	const config = PANEL_RESIZE_TARGETS.inspector;
	const width = Math.max(config.min, Math.min(config.max, getSidebarLeftWidth()));
	document.documentElement.style.setProperty(config.variable, `${width}px`);
}

// The toolbar's compact width follows the density tokens, including coarse pointers.
function getPanelResizeMin(key) {
	const config = PANEL_RESIZE_TARGETS[key];
	return config.min ?? parseFloat(getComputedStyle(document.querySelector(config.selector)).minWidth);
}

function clampPanelWidth(key, width) {
	return Math.round(Math.min(getPanelResizeMax(key), Math.max(getPanelResizeMin(key), width)));
}

// Snap unless the pointer is held with Alt, which is the usual escape hatch for
// "I mean exactly this value".
function snapPanelWidth(key, width, disableSnap) {
	if (disableSnap) return width;
	const snap = [getPanelResizeMin(key), ...PANEL_RESIZE_TARGETS[key].snaps]
		.find((point) => Math.abs(point - width) <= CONFIG.ui.panelResize.snapTolerance);
	return snap === undefined ? width : snap;
}

function applyPanelWidth(key, width) {
	if (key === 'inspector' && PREFERENCES.get('balanceSidebars')) PREFERENCES.set('balanceSidebars', false);
	document.documentElement.style.setProperty(PANEL_RESIZE_TARGETS[key].variable, `${width}px`);
	if (key === 'toolbar') document.documentElement.classList.toggle('tool-names-visible', width >= PANEL_RESIZE_TARGETS.toolbar.namesWidth);
	if (key === 'toolbar' || key === 'layers') syncSidebarBalance();
}

function clearPanelWidth(key) {
	document.documentElement.style.removeProperty(PANEL_RESIZE_TARGETS[key].variable);
	if (key === 'toolbar') document.documentElement.classList.remove('tool-names-visible');
	syncSidebarBalance();
}

function getPanelWidth(key) {
	const panel = document.querySelector(PANEL_RESIZE_TARGETS[key].selector);
	return panel ? Math.round(panel.getBoundingClientRect().width) : getPanelResizeMin(key);
}

function setPanelWidth(key, width, { persist = true, snap = false } = {}) {
	const next = clampPanelWidth(key, snap ? snapPanelWidth(key, width, false) : width);
	applyPanelWidth(key, next);
	if (persist) {
		const widths = readPanelWidths();
		widths[key] = next;
		writePanelWidths(widths);
	}
	return next;
}

function resetPanelWidth(key) {
	clearPanelWidth(key);
	const widths = readPanelWidths();
	delete widths[key];
	writePanelWidths(widths);
}

// The share of the Library window its open section holds, or null while the
// section fits its content.
function readLibrarySplit() {
	const share = readPanelWidths()[PANEL_SPLIT_STORAGE_FIELD];
	return typeof share === 'number' ? share : null;
}

function writeLibrarySplit(share) {
	const widths = readPanelWidths();
	if (share === null) delete widths[PANEL_SPLIT_STORAGE_FIELD];
	else widths[PANEL_SPLIT_STORAGE_FIELD] = share;
	writePanelWidths(widths);
}

// Window listeners belong to a press, including the interval before its
// threshold. Callers restore their own values when `end` receives true.
function bindPointerDrag(handle, {
	canStart = () => true, start = () => {}, activate = () => {}, move, end = () => {},
	threshold = 0, axis = null, capture = () => handle, bodyClass = null,
	bindPress = true, suppress = () => {}, clickHost = handle
}) {
	let press = null, suppressClick = false;
	const activatePress = event => {
		press.moved = true;
		press.capture = capture();
		press.capture?.setPointerCapture(event.pointerId);
		if (bodyClass) document.body.classList.add(bodyClass);
		activate(event);
	};
	const finish = cancelled => {
		if (!press) return;
		const previous = press;
		press = null;
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', onUp);
		window.removeEventListener('pointercancel', onCancel);
		window.removeEventListener('lostpointercapture', onLost);
		window.removeEventListener('blur', onBlur);
		document.removeEventListener('keydown', onKey, true);
		if (previous.capture?.hasPointerCapture(previous.pointerId)) previous.capture.releasePointerCapture(previous.pointerId);
		if (bodyClass) document.body.classList.remove(bodyClass);
		if (previous.moved || cancelled) {
			suppressClick = true;
			suppress();
			setTimeout(() => { suppressClick = false; }, 0);
		}
		end(cancelled, previous);
	};
	const onMove = event => {
		if (!press || event.pointerId !== press.pointerId) return;
		if (!press.moved) {
			const dx = event.clientX - press.x, dy = event.clientY - press.y;
			const distance = axis === 'x' ? Math.abs(dx) : axis === 'y' ? Math.abs(dy) : Math.hypot(dx, dy);
			if (distance < threshold) return;
			activatePress(event);
		}
		move(event);
	};
	const onUp = event => { if (event.pointerId === press?.pointerId) finish(false); };
	const onCancel = event => { if (event.pointerId === press?.pointerId) finish(true); };
	const onLost = event => { if (event.target === press?.capture) onCancel(event); };
	const onBlur = () => finish(true);
	const onKey = event => {
		if (event.key !== 'Escape') return;
		event.preventDefault(); event.stopImmediatePropagation();
		finish(true);
	};
	const begin = event => {
		if (event.button !== 0 || press || !canStart(event)) return false;
		if (start(event) === false) return false;
		event.preventDefault();
		press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
		window.addEventListener('lostpointercapture', onLost);
		window.addEventListener('blur', onBlur);
		document.addEventListener('keydown', onKey, true);
		if (!threshold) activatePress(event);
		return true;
	};
	if (bindPress) handle.addEventListener('pointerdown', begin);
	clickHost?.addEventListener('click', event => {
		if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
	}, true);
	return { begin, finish, get active() { return Boolean(press); } };
}

function bindResizeHandleDrag(handle, options) {
	return bindPointerDrag(handle, {
		...options,
		activate: () => handle.classList.add('is-dragging'),
		end: cancelled => { handle.classList.remove('is-dragging'); options.end?.(cancelled); }
	});
}

function bindSeparator(handle, {
	orientation, label, canUse = () => true, change, reset,
	keyStep = CONFIG.ui.panelResize.keyStep, fastKeyStep = CONFIG.ui.panelResize.fastKeyStep
}) {
	handle.tabIndex = 0;
	handle.setAttribute('role', 'separator');
	handle.setAttribute('aria-orientation', orientation);
	handle.setAttribute('aria-label', label);
	handle.addEventListener('dblclick', () => { if (canUse()) reset(); });
	handle.addEventListener('keydown', event => {
		if (!canUse()) return;
		const [back, forward] = orientation === 'horizontal' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
		if (![back, forward, 'Home', 'Escape'].includes(event.key)) return;
		event.preventDefault(); event.stopPropagation();
		if (event.key === 'Home' || event.key === 'Escape') reset();
		else change((event.key === forward ? 1 : -1) * (event.shiftKey ? fastKeyStep : keyStep));
	});
	return (min, max, value) => {
		handle.setAttribute('aria-valuemin', String(min));
		handle.setAttribute('aria-valuemax', String(max));
		handle.setAttribute('aria-valuenow', String(value));
	};
}

function bindSizeHandle(handle, {
	orientation, label, direction = 1, read, apply, persist, reset,
	canUse = () => true, bodyClass, onChange = () => {},
	keyStep = CONFIG.ui.panelResize.keyStep, fastKeyStep = CONFIG.ui.panelResize.fastKeyStep
}) {
	const coordinate = orientation === 'horizontal' ? 'clientY' : 'clientX';
	const sign = () => typeof direction === 'function' ? direction() : direction;
	let startSize, startPosition;
	bindResizeHandleDrag(handle, {
		canStart: canUse, bodyClass,
		start: event => {
			startSize = read(); startPosition = event[coordinate];
			onChange('start');
		},
		move: event => {
			if (!canUse()) return;
			apply(startSize + (event[coordinate] - startPosition) * sign(), event);
			onChange('move');
		},
		end: cancelled => {
			if (cancelled) apply(startSize);
			else persist(read());
			onChange(cancelled ? 'cancel' : 'end');
		}
	});
	return bindSeparator(handle, {
		orientation, label, canUse, keyStep, fastKeyStep,
		change: delta => {
			onChange('start'); apply(read() + delta * Math.sign(sign())); persist(read()); onChange('end');
		},
		reset: () => {
			onChange('start');
			const value = reset();
			if (value !== undefined) apply(value);
			onChange('end');
		}
	});
}

function buildPanelResizeHandle(key) {
	const config = PANEL_RESIZE_TARGETS[key];
	const handle = document.createElement('div');
	handle.className = `panel-resize-handle panel-resize-handle-${config.edge}`;
	handle.dataset.panelResize = key;
	// A separator, not a slider: it divides two regions and the useful
	// announcement is the panel width it controls.
	// Gesture code treats the canvas as its own surface; this is chrome.
	handle.classList.add('ui-ignore-gestures');
	return handle;
}

function initializePanelResize(editor) {
	if (document.querySelector('[data-panel-resize]')) return;
	const stored = readPanelWidths();
	// Preserve an existing manually sized Inspector when introducing the preference.
	if (typeof stored.inspector === 'number' && !Object.prototype.hasOwnProperty.call(PREFERENCES.values, 'balanceSidebars')) {
		PREFERENCES.set('balanceSidebars', false);
	}
	const balanceToggle = document.getElementById('balanceSidebars');
	if (balanceToggle) balanceToggle.checked = PREFERENCES.get('balanceSidebars');
	PREFERENCES.onChange('balanceSidebars', (balanced) => {
		const duringDrag = Boolean(editor.viewport.panelResizeCentering);
		if (!duringDrag) editor.viewport.beginPanelResize();
		const toggle = document.getElementById('balanceSidebars');
		if (toggle) toggle.checked = balanced;
		if (balanced) {
			const widths = readPanelWidths();
			delete widths.inspector;
			writePanelWidths(widths);
			if (window.innerWidth > CONFIG.ui.mobile.breakpoint) {
				['toolbar', 'layers'].forEach((key) => {
					const width = getPanelWidth(key);
					if (clampPanelWidth(key, width) !== width) setPanelWidth(key, width);
				});
				syncSidebarBalance();
			}
		} else if (window.innerWidth > CONFIG.ui.mobile.breakpoint) {
			setPanelWidth('inspector', getPanelWidth('inspector'));
		} else {
			clearPanelWidth('inspector');
		}
		if (!duringDrag) editor.viewport.endPanelResize();
	});

	Object.entries(PANEL_RESIZE_TARGETS).forEach(([key, config]) => {
		const panel = document.querySelector(config.selector);
		if (!panel) return;
		const handle = buildPanelResizeHandle(key);
		(config.handleHost ? document.querySelector(config.handleHost) : panel).appendChild(handle);

		let startWidth;
		bindSizeHandle(handle, {
			orientation: 'vertical', label: config.label, direction: config.edge === 'start' ? -1 : 1,
			canUse: () => !editor?.mobileManager?.isMobile, bodyClass: 'is-resizing-panel',
			read: () => getPanelWidth(key),
			apply: (value, event) => applyPanelWidth(key, clampPanelWidth(key, event ? snapPanelWidth(key, value, event.altKey) : value)),
			persist: value => { if (key !== 'inspector' || value !== startWidth) setPanelWidth(key, value); },
			reset: () => resetPanelWidth(key),
			onChange: phase => {
				if (phase === 'start') { startWidth = getPanelWidth(key); editor.viewport.beginPanelResize(); }
				else if (phase === 'cancel' || phase === 'end') editor.viewport.endPanelResize();
			}
		});
	});

	// Restore stored widths, re-clamped against the current window so a width
	// chosen on a wide monitor cannot strand the canvas on a small one.
	Object.keys(PANEL_RESIZE_TARGETS).forEach((key) => {
		if (key === 'inspector' && PREFERENCES.get('balanceSidebars')) return;
		if (typeof stored[key] !== 'number') return;
		applyPanelWidth(key, clampPanelWidth(key, stored[key]));
	});
	syncSidebarBalance();
	// Panels can appear after a document opens, without a window resize.
	const balanceObserver = new ResizeObserver(() => syncSidebarBalance());
	['toolbar', 'layers'].forEach((key) => {
		const panel = document.querySelector(PANEL_RESIZE_TARGETS[key].selector);
		if (panel) balanceObserver.observe(panel);
	});

	window.addEventListener('resize', () => {
		if (window.innerWidth <= CONFIG.ui.mobile.breakpoint) return;
		const widths = readPanelWidths();
		Object.keys(PANEL_RESIZE_TARGETS).forEach((key) => {
			if (key === 'inspector' && PREFERENCES.get('balanceSidebars')) return;
			if (typeof widths[key] !== 'number') return;
			applyPanelWidth(key, clampPanelWidth(key, widths[key]));
		});
		syncSidebarBalance();
	});
}
