'use strict';

// Desktop rail and sidebar resizing. Widths are driven by --toolbar-width,
// --layer-panel-width and --glitter-panel-width;
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
	inspector: { variable: '--glitter-panel-width', selector: '.inspector-panel', edge: 'start', label: 'Resize Inspector' }
}).map(([key, target]) => [key, { ...target, ...CONFIG.ui.panelResize.panels[key] }])));


// The canvas keeps at least this much room (--canvas-min-width): panel drags stop
// there, and the left dock floats over the canvas once the columns need more.
function getCanvasMinWidth() {
	return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--canvas-min-width')) || 0;
}

// The inset dock layout (--dock-gap) keeps one gap after the rail, after each
// side column and at the right edge; flush docks and phones have none.
function getDockGapsWidth(sideColumns) {
	const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-gap')) || 0;
	return gap * (sideColumns + 2);
}

function readPanelWidths() {
	return readStored(PANEL_RESIZE_STORAGE_KEY, {});
}

function writePanelWidths(widths) {
	writeStored(PANEL_RESIZE_STORAGE_KEY, widths);
}

// A column's live width, or 0 while it is hidden or floats over the canvas.
// The rail counts: it is the first column of the row.
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
	const sideColumns = ['layers', 'inspector'].filter((name) => name === key || getPanelFlowWidth(name) > 0).length;
	let available = window.innerWidth - otherWidth - getDockGapsWidth(sideColumns) - getCanvasMinWidth();
	if ((key === 'toolbar' || key === 'layers') && PREFERENCES.get('balanceSidebars')) {
		const matchingColumns = Number(getPanelFlowWidth('inspector') > 0);
		const leftLimit = Math.min(PANEL_RESIZE_TARGETS.inspector.max,
			(window.innerWidth - getCanvasMinWidth()) / (1 + matchingColumns));
		available = leftLimit - (getSidebarLeftWidth() - getPanelWidth(key));
	}
	return Math.max(getPanelResizeMin(key), Math.min(config.max, Math.round(available)));
}

// A dock shown only for a pick (setDockPeek) is not part of the balance.
function getSidebarLeftWidth() {
	const peeking = document.querySelector(PANEL_RESIZE_TARGETS.layers.selector)?.classList.contains('is-dock-peeking');
	return getPanelWidth('toolbar') + (peeking ? 0 : getPanelWidth('layers'));
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
	initializeDockVisibility();
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
	initializeLeftDockOverlay(editor);

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

// ===== Dock visibility =====
// A dock hides rather than collapses: its room goes back to the canvas, which
// is a flex child. Hidden Layers and Inspector docks persist next to the
// widths; the Timeline keeps its own open state (`timelineOpen`). On the phone
// the sheets own these surfaces and the stylesheet ignores the hidden class.
const DOCK_TARGETS = Object.freeze({
	layers: { selector: '#layersPanel', button: 'viewLayersToggle' },
	inspector: { selector: '#designPanel', button: 'viewInspectorToggle' }
});

// What "hide all" took away, so the same command can put it back.
let docksHiddenTogether = null;

function isDockVisible(key) {
	return readStored(STORAGE_KEYS.dockVisibility.key, {})[key] !== false;
}

// What the View toggle shows: in overlay mode the left dock is shown by the
// overlay, not by the stored preference.
function isDockShown(key) {
	return key === 'layers' && leftDockOverlay.active ? isLeftDockOverlayShown() : isDockVisible(key);
}

function applyDockVisibility(key) {
	const visible = isDockShown(key);
	const overlay = key === 'layers' && leftDockOverlay.active;
	document.querySelector(DOCK_TARGETS[key].selector)?.classList.toggle('is-dock-hidden', !overlay && !isDockVisible(key));
	const button = document.getElementById(DOCK_TARGETS[key].button);
	if (button) {
		button.classList.toggle('active', visible);
		button.setAttribute('aria-pressed', String(visible));
	}
}

function setDockVisible(key, visible) {
	const stored = readStored(STORAGE_KEYS.dockVisibility.key, {});
	if (visible) delete stored[key];
	else stored[key] = false;
	writeStored(STORAGE_KEYS.dockVisibility.key, stored);
	applyDockVisibility(key);
	syncSidebarBalance();
}

// A dock hidden by View shows while a picker needs it, without storing that.
function setDockPeek(key, peek) {
	document.querySelector(DOCK_TARGETS[key].selector)?.classList.toggle('is-dock-peeking', peek);
	if (key === 'layers') {
		leftDockOverlay.peek = peek;
		applyLeftDockOverlay();
	}
}

function toggleDock(key) {
	if (key === 'layers' && leftDockOverlay.active) setLeftDockOverlayOpen(!(leftDockOverlay.open || leftDockOverlay.pinned));
	else setDockVisible(key, !isDockVisible(key));
}

function toggleAllDocks(editor) {
	const timelineAvailable = isFeatureAvailable('timeline') && Boolean(editor.originalImage);
	// The overlay is not a stored preference: hiding everything just closes it.
	const keys = Object.keys(DOCK_TARGETS).filter((key) => !(key === 'layers' && leftDockOverlay.active));
	if (docksHiddenTogether) {
		const prior = docksHiddenTogether;
		docksHiddenTogether = null;
		Object.keys(DOCK_TARGETS).filter((key) => key in prior).forEach((key) => setDockVisible(key, prior[key]));
		if (timelineAvailable && prior.timeline) PREFERENCES.set('timelineOpen', true);
		return;
	}
	const prior = {
		...Object.fromEntries(keys.map((key) => [key, isDockVisible(key)])),
		timeline: timelineAvailable && PREFERENCES.get('timelineOpen')
	};
	if (!Object.values(prior).some(Boolean)) return;
	docksHiddenTogether = prior;
	keys.forEach((key) => setDockVisible(key, false));
	setLeftDockOverlayOpen(false);
	if (prior.timeline) PREFERENCES.set('timelineOpen', false);
}

function resetDockVisibility() {
	docksHiddenTogether = null;
	removeStored(STORAGE_KEYS.dockVisibility.key);
	Object.keys(DOCK_TARGETS).forEach(applyDockVisibility);
	syncSidebarBalance();
}

function initializeDockVisibility() {
	Object.keys(DOCK_TARGETS).forEach(applyDockVisibility);
}

// ===== Compact-desktop overlay =====
// Above the phone breakpoint, when the rail, the left dock and the Inspector
// would leave the canvas under --canvas-min-width, the left dock floats over
// the canvas from the rail's edge instead of taking a column, so the canvas and
// the timeline keep one width. It is closed until the rail button opens it
// (the Show Layers command); Esc or a press outside closes it unless pinned.
// This state lives here for the session and never touches the stored Show
// Layers preference, which applies again whenever the window is wide enough.
// The mode is judged from the dock's configured width, not its position, so
// opening it or switching modes cannot change the answer.
const LEFT_DOCK_OVERLAY_KEEP_OPEN = '#layersPanel, #libraryWindow, #flyoutWindow, #toolbarLayersBtn, #viewLayersToggle, .app-menu-popover, .is-fixed-menu, .scroll-region-track, .modal, .tooltip';
const leftDockOverlay = { active: false, open: false, pinned: false, peek: false };

function isLeftDockOverlayShown() {
	return leftDockOverlay.active && (leftDockOverlay.open || leftDockOverlay.pinned || leftDockOverlay.peek);
}

function wantsLeftDockOverlay() {
	const dock = document.querySelector(DOCK_TARGETS.layers.selector);
	const area = document.querySelector('.main-area');
	if (!dock || !area || window.innerWidth <= CONFIG.ui.mobile.breakpoint) return false;
	const inspector = getPanelFlowWidth('inspector');
	const columns = getPanelFlowWidth('toolbar') + inspector + parseFloat(getComputedStyle(dock).width) + getDockGapsWidth(1 + Number(inspector > 0));
	return area.clientWidth - columns < getCanvasMinWidth();
}

function applyLeftDockOverlay() {
	const dock = document.querySelector(DOCK_TARGETS.layers.selector);
	if (!dock) return;
	const { active, pinned } = leftDockOverlay;
	const shown = isLeftDockOverlayShown();
	dock.classList.toggle('is-dock-overlay', active);
	dock.classList.toggle('is-dock-overlay-open', shown);
	const rail = document.getElementById('toolbarLayersBtn');
	if (rail) {
		rail.hidden = !active;
		rail.classList.toggle('active', shown);
		rail.setAttribute('aria-pressed', String(shown));
	}
	document.querySelectorAll('.dock-pin').forEach((pin) => {
		pin.hidden = !active;
		pin.classList.toggle('active', pinned);
		pin.setAttribute('aria-pressed', String(pinned));
	});
	applyDockVisibility('layers');
}

function syncLeftDockOverlay() {
	leftDockOverlay.active = wantsLeftDockOverlay();
	applyLeftDockOverlay();
}

function setLeftDockOverlayOpen(open) {
	leftDockOverlay.open = open;
	if (!open) leftDockOverlay.pinned = false;
	applyLeftDockOverlay();
}

// Esc and outside presses: a pinned overlay, or one a picker is showing, stays.
function closeLeftDockOverlay() {
	const { active, open, pinned, peek } = leftDockOverlay;
	if (!active || !open || pinned || peek) return false;
	setLeftDockOverlayOpen(false);
	return true;
}

function initializeLeftDockOverlay(editor) {
	document.getElementById('toolbarLayersBtn')?.addEventListener('click', () => COMMANDS.layersToggle.run(editor));
	document.getElementById('layersPanel')?.addEventListener('click', (event) => {
		if (!event.target.closest('.dock-pin')) return;
		leftDockOverlay.pinned = !leftDockOverlay.pinned;
		if (leftDockOverlay.pinned) leftDockOverlay.open = true;
		applyLeftDockOverlay();
	});
	document.addEventListener('pointerdown', (event) => {
		if (event.target instanceof Element && !event.target.closest(LEFT_DOCK_OVERLAY_KEEP_OPEN)) closeLeftDockOverlay();
	}, true);
	const observer = new ResizeObserver(syncLeftDockOverlay);
	['.main-area', '.toolbar', DOCK_TARGETS.layers.selector, DOCK_TARGETS.inspector.selector]
		.forEach((selector) => { const node = document.querySelector(selector); if (node) observer.observe(node); });
	syncLeftDockOverlay();
}
