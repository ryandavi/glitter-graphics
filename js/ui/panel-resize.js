'use strict';

// Desktop sidebar resizing. The layers and design columns are fixed-width flex
// items driven by --layer-panel-width / --glitter-panel-width; dragging a handle
// writes those custom properties on :root and persists the result.
//
// Only a user-chosen width is ever written. Untouched panels keep falling
// through to the stylesheet's responsive defaults (css/_assets.scss narrows both
// columns under 1700px and 1200px), so the app still adapts on its own until
// someone expresses a preference.
//
// Mobile is excluded outright: MobileManager turns these columns into bottom
// drawers whose size is owned by the sheet-drag handle instead.

const PANEL_RESIZE_STORAGE_KEY = 'glitter.panelWidths';

const PANEL_RESIZE_TARGETS = Object.freeze({
	layers: {
		variable: '--layer-panel-width',
		selector: '.layers-panel',
		// The handle lives on the inner edge - the side facing the canvas.
		edge: 'end',
		min: 240,
		max: 620,
		// Snap points are the widths where the panel's own layout changes:
		// the layer list's thumbnail grid steps at 300 and 400.
		snaps: [260, 300, 360, 400, 480],
		label: 'Resize Layers panel'
	},
	design: {
		variable: '--glitter-panel-width',
		selector: '.design-panel',
		edge: 'start',
		min: 300,
		max: 720,
		// 300 is the gallery's 2-column floor; 350 is today's default; 420 is
		// where property pairs stop being cramped; 520 fits 4 gallery columns.
		snaps: [300, 350, 420, 520, 620],
		label: 'Resize Design panel'
	}
});

// How close to a snap point a drag has to land before it sticks.
const PANEL_RESIZE_SNAP_TOLERANCE = 10;
// The canvas is the point of the app; sidebars never squeeze it below this.
const PANEL_RESIZE_MIN_CANVAS = 360;

function readPanelWidths() {
	try {
		const stored = JSON.parse(localStorage.getItem(PANEL_RESIZE_STORAGE_KEY) || '{}');
		return stored && typeof stored === 'object' ? stored : {};
	} catch (error) {
		return {};
	}
}

function writePanelWidths(widths) {
	try {
		localStorage.setItem(PANEL_RESIZE_STORAGE_KEY, JSON.stringify(widths));
	} catch (error) {
		// A full or blocked store must not break resizing for this session.
	}
}

// The largest this panel may become without starving the canvas or the other
// sidebar. Measured live, so it stays correct as the window resizes.
function getPanelResizeMax(key) {
	const config = PANEL_RESIZE_TARGETS[key];
	const other = Object.entries(PANEL_RESIZE_TARGETS).find(([name]) => name !== key)?.[1];
	const otherPanel = other ? document.querySelector(other.selector) : null;
	const otherWidth = otherPanel && getComputedStyle(otherPanel).display !== 'none'
		? otherPanel.getBoundingClientRect().width
		: 0;
	const toolbar = document.querySelector('.toolbar');
	const toolbarWidth = toolbar ? toolbar.getBoundingClientRect().width : 0;
	const available = window.innerWidth - otherWidth - toolbarWidth - PANEL_RESIZE_MIN_CANVAS;
	return Math.max(config.min, Math.min(config.max, Math.round(available)));
}

function clampPanelWidth(key, width) {
	const config = PANEL_RESIZE_TARGETS[key];
	return Math.round(Math.min(getPanelResizeMax(key), Math.max(config.min, width)));
}

// Snap unless the pointer is held with Alt, which is the usual escape hatch for
// "I mean exactly this value".
function snapPanelWidth(key, width, disableSnap) {
	if (disableSnap) return width;
	const snap = PANEL_RESIZE_TARGETS[key].snaps
		.find((point) => Math.abs(point - width) <= PANEL_RESIZE_SNAP_TOLERANCE);
	return snap === undefined ? width : snap;
}

function applyPanelWidth(key, width) {
	document.documentElement.style.setProperty(PANEL_RESIZE_TARGETS[key].variable, `${width}px`);
}

function clearPanelWidth(key) {
	document.documentElement.style.removeProperty(PANEL_RESIZE_TARGETS[key].variable);
}

function getPanelWidth(key) {
	const panel = document.querySelector(PANEL_RESIZE_TARGETS[key].selector);
	return panel ? Math.round(panel.getBoundingClientRect().width) : PANEL_RESIZE_TARGETS[key].min;
}

function setPanelWidth(key, width, { persist = true, snap = false } = {}) {
	const next = clampPanelWidth(key, snap ? snapPanelWidth(key, width, false) : width);
	applyPanelWidth(key, next);
	if (persist) {
		const widths = readPanelWidths();
		widths[key] = next;
		writePanelWidths(widths);
	}
	document.dispatchEvent(new CustomEvent('panelresize', { detail: { panel: key, width: next } }));
	return next;
}

function resetPanelWidth(key) {
	clearPanelWidth(key);
	const widths = readPanelWidths();
	delete widths[key];
	writePanelWidths(widths);
	document.dispatchEvent(new CustomEvent('panelresize', { detail: { panel: key, width: getPanelWidth(key) } }));
}

function buildPanelResizeHandle(key) {
	const config = PANEL_RESIZE_TARGETS[key];
	const handle = document.createElement('div');
	handle.className = `panel-resize-handle panel-resize-handle-${config.edge}`;
	handle.dataset.panelResize = key;
	// A separator, not a slider: it divides two regions and the useful
	// announcement is the panel width it controls.
	handle.setAttribute('role', 'separator');
	handle.setAttribute('tabindex', '0');
	handle.setAttribute('aria-orientation', 'vertical');
	handle.setAttribute('aria-label', config.label);
	// Gesture code treats the canvas as its own surface; this is chrome.
	handle.classList.add('ui-ignore-gestures');
	return handle;
}

function initializePanelResize(editor) {
	if (document.querySelector('[data-panel-resize]')) return;

	Object.entries(PANEL_RESIZE_TARGETS).forEach(([key, config]) => {
		const panel = document.querySelector(config.selector);
		if (!panel) return;
		const handle = buildPanelResizeHandle(key);
		panel.appendChild(handle);

		let startX = 0;
		let startWidth = 0;
		let pointerId = null;

		const onMove = (event) => {
			// Dragging the design panel's handle rightwards makes it narrower;
			// the layers handle works the other way round.
			const delta = config.edge === 'start' ? startX - event.clientX : event.clientX - startX;
			const raw = startWidth + delta;
			applyPanelWidth(key, clampPanelWidth(key, snapPanelWidth(key, raw, event.altKey)));
		};

		const onUp = () => {
			if (pointerId === null) return;
			try { handle.releasePointerCapture(pointerId); } catch (error) { /* already released */ }
			pointerId = null;
			handle.classList.remove('is-dragging');
			document.body.classList.remove('is-resizing-panel');
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			setPanelWidth(key, getPanelWidth(key));
			editor?.viewport?.handleResize?.();
		};

		handle.addEventListener('pointerdown', (event) => {
			if (event.button !== 0 || editor?.mobileManager?.isMobile) return;
			event.preventDefault();
			pointerId = event.pointerId;
			handle.setPointerCapture(pointerId);
			startX = event.clientX;
			startWidth = getPanelWidth(key);
			handle.classList.add('is-dragging');
			document.body.classList.add('is-resizing-panel');
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
			window.addEventListener('pointercancel', onUp);
		});

		// Double-click returns the panel to the stylesheet's responsive default.
		handle.addEventListener('dblclick', () => {
			resetPanelWidth(key);
			editor?.viewport?.handleResize?.();
		});

		handle.addEventListener('keydown', (event) => {
			const step = event.shiftKey ? 40 : 8;
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				event.preventDefault();
				const direction = event.key === 'ArrowRight' ? 1 : -1;
				const delta = config.edge === 'start' ? -direction * step : direction * step;
				setPanelWidth(key, getPanelWidth(key) + delta);
				editor?.viewport?.handleResize?.();
			} else if (event.key === 'Home' || event.key === 'Escape') {
				event.preventDefault();
				resetPanelWidth(key);
				editor?.viewport?.handleResize?.();
			}
		});
	});

	// Restore stored widths, re-clamped against the current window so a width
	// chosen on a wide monitor cannot strand the canvas on a small one.
	const stored = readPanelWidths();
	Object.keys(PANEL_RESIZE_TARGETS).forEach((key) => {
		if (typeof stored[key] !== 'number') return;
		applyPanelWidth(key, clampPanelWidth(key, stored[key]));
	});

	window.addEventListener('resize', () => {
		if (editor?.mobileManager?.isMobile) return;
		const widths = readPanelWidths();
		Object.keys(PANEL_RESIZE_TARGETS).forEach((key) => {
			if (typeof widths[key] !== 'number') return;
			applyPanelWidth(key, clampPanelWidth(key, widths[key]));
		});
	});
}
