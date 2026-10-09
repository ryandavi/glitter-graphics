'use strict';

// Desktop sidebar resizing. The layers, Inspector and Library window columns
// are fixed-width flex items driven by --layer-panel-width,
// --glitter-panel-width and --library-window-width; dragging a handle writes
// those custom properties on :root and persists the result.
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
	const toolbarWidth = toolbar ? toolbar.getBoundingClientRect().width : 0;
	const available = window.innerWidth - otherWidth - toolbarWidth - CONFIG.ui.panelResize.minCanvas;
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
		.find((point) => Math.abs(point - width) <= CONFIG.ui.panelResize.snapTolerance);
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
			// Dragging the Inspector's handle rightwards makes it narrower; the
			// layers handle works the other way round.
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
		handle.addEventListener('dblclick', () => resetPanelWidth(key));

		handle.addEventListener('keydown', (event) => {
			const step = event.shiftKey ? CONFIG.ui.panelResize.fastKeyStep : CONFIG.ui.panelResize.keyStep;
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				event.preventDefault();
				const direction = event.key === 'ArrowRight' ? 1 : -1;
				const delta = config.edge === 'start' ? -direction * step : direction * step;
				setPanelWidth(key, getPanelWidth(key) + delta);
			} else if (event.key === 'Home' || event.key === 'Escape') {
				event.preventDefault();
				resetPanelWidth(key);
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
