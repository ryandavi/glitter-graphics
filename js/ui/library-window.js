'use strict';

// The window: the column between the canvas and the Inspector that holds the
// Library while a picker is armed. Whether it is open is derived from
// PickerRegistry, never set directly. At phone width the Library is the
// design drawer and the window stays closed.
//
// How it sits depends on the room left for the canvas (`data-library-window`
// on <body>, read by css/panels/_library-window.scss):
//   dock   a fourth column; the canvas refits beside it
//   fold   the same, with the Layers column folded away while it is open
//   float  over the canvas against the Inspector's edge; the canvas is untouched
class LibraryWindow {
	constructor(editor) {
		this.editor = editor;
		this.element = document.getElementById('libraryWindow');
		this.isOpen = false;
		this.tier = null;
		this.pending = false;
		this.layoutFrame = null;
		// The view the user had before the window took canvas space, and the
		// zoom the refit chose, so a zoom they pick while it is open survives.
		this.viewState = null;
		this.fitZoom = null;

		// The viewport refits itself after either of these; only the tier is ours.
		const relayout = () => {
			if (this.isOpen) this.setTier(this.measureTier());
		};
		window.addEventListener('resize', relayout);
		document.addEventListener('panelresize', relayout);
	}

	// Sessions swap inside one task (the old one closes, the new one opens),
	// so the window settles once afterwards instead of closing in between.
	sync() {
		if (this.pending) return;
		this.pending = true;
		queueMicrotask(() => {
			this.pending = false;
			this.apply();
		});
	}

	apply() {
		if (!this.element) return;
		const open = !this.editor.mobileManager?.isMobile && Boolean(this.editor.pickers.active);
		if (open === this.isOpen) return;
		const viewport = this.editor.viewport;
		const current = viewport?.captureViewState?.() || null;
		const tookCanvasSpace = this.isOpen && this.tier !== 'float';
		this.isOpen = open;
		this.element.classList.toggle('is-open', open);

		if (open) {
			this.viewState = current;
			this.setTier(this.measureTier());
			if (this.tier !== 'float') this.afterLayout(() => this.fitCanvas());
			return;
		}

		const before = this.viewState;
		const userZoomed = this.fitZoom !== null && current && Math.abs(current.zoom - this.fitZoom) > 0.0001;
		this.viewState = null;
		this.fitZoom = null;
		this.setTier(null);
		if (!tookCanvasSpace || !before) return;
		// Keep a zoom chosen while the window was open; otherwise return to the
		// view from before it opened.
		this.afterLayout(() => viewport.restoreViewState(userZoomed ? current : before, { animate: true }));
	}

	// Measured with all four columns in flow, so the answer does not depend on
	// the tier currently applied.
	measureTier() {
		document.body.dataset.libraryWindow = 'dock';
		const width = (selector) => document.querySelector(selector)?.getBoundingClientRect().width || 0;
		const columns = width('.main-content') - width('.inspector-panel') - width('.library-window');
		const minCanvas = CONFIG.ui.libraryWindow.minCanvasWidth;
		if (columns - width('.layers-panel') >= minCanvas) return 'dock';
		return columns >= minCanvas ? 'fold' : 'float';
	}

	setTier(tier) {
		this.tier = tier;
		if (tier) document.body.dataset.libraryWindow = tier;
		else delete document.body.dataset.libraryWindow;
	}

	fitCanvas() {
		const viewport = this.editor.viewport;
		if (!viewport) return;
		viewport.performResizeUpdate({ animate: true });
		this.fitZoom = viewport.currentZoom;
	}

	afterLayout(run) {
		cancelAnimationFrame(this.layoutFrame);
		this.layoutFrame = requestAnimationFrame(() => {
			this.layoutFrame = requestAnimationFrame(() => {
				this.layoutFrame = null;
				run();
			});
		});
	}
}
