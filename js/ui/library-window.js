'use strict';

// The window: the column between the canvas and the Inspector. It shows the
// flyout section whose line was pressed, and the Library while a picker is
// armed; a paint section on its Glitter source shows both. What is open is
// derived from PickerRegistry (`flyout`, `active`), never set directly. At
// phone width the Library is the design drawer, a flyout section sits in its
// panel, and the window stays closed.
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
		this.flyoutCard = null;
		// A source change in the open section arms or releases the Library.
		this.flyoutObserver = new MutationObserver(() => this.sync());
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

		const pressLine = (event) => {
			const title = event.target.closest?.('.property-line > .property-card-title');
			if (!title || event.target.closest('.property-header-switch')) return false;
			const card = document.getElementById(title.parentElement.dataset.flyoutFor);
			if (card) this.editor.pickers.toggleFlyout(card.dataset.flyoutKey);
			return true;
		};
		document.addEventListener('click', pressLine);
		document.addEventListener('keydown', (event) => {
			if ((event.key === 'Enter' || event.key === ' ') && pressLine(event)) event.preventDefault();
		});
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
		const mobile = Boolean(this.editor.mobileManager?.isMobile);
		const card = this.syncFlyout(mobile);
		const picking = Boolean(this.editor.pickers.active);
		// The phone's Library drawer is always there to open.
		document.getElementById('designGallerySection')?.classList.toggle('visible', mobile || picking);
		this.element.classList.toggle('has-flyout', Boolean(card));
		this.element.classList.toggle('has-library', picking);
		const open = !mobile && (picking || Boolean(card));
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

	// The open flyout section follows the inspected layer: the same line on
	// another layer keeps the window and retitles it, no such line closes it.
	// Returns the section showing, or null.
	syncFlyout(mobile) {
		const editor = this.editor;
		const pickers = editor.pickers;
		const layer = editor.layerManager.getInspectedLayer();
		const prefix = layer && PANEL_SCHEMAS[layer.type]?.sectionPrefix;
		const available = !mobile && prefix && editor.originalImage && !editor.autoGlitterManager?.isSessionActive();
		const card = (pickers.flyout && available)
			? document.querySelector(`#${prefix}Flyouts > [data-flyout-key="${pickers.flyout}"]`) : null;
		if (!card) pickers.flyout = null;

		if (card !== this.flyoutCard) {
			this.flyoutObserver.disconnect();
			this.flyoutCard?.classList.remove('is-flyout-open');
			card?.classList.add('is-flyout-open');
			if (card) this.flyoutObserver.observe(card, { attributes: true, attributeFilter: ['data-paint-mode'] });
			this.flyoutCard = card;
			const toggle = card ? buildFlyoutSwitch(card) : null;
			document.getElementById('flyoutSwitch').replaceChildren(...(toggle ? [toggle] : []));
			document.querySelectorAll('.property-line').forEach((line) => {
				const open = Boolean(card) && line.dataset.flyoutFor === card.id;
				line.classList.toggle('is-flyout-open', open);
				line.querySelector(':scope > .property-card-title').setAttribute('aria-expanded', String(open));
			});
		}
		document.getElementById('flyoutSection').classList.toggle('visible', Boolean(card));
		if (!card) return null;
		document.getElementById('flyoutTitleIcon').setAttribute('href', `#icon-${PANEL_SCHEMAS[layer.type].section.icon}`);
		document.getElementById('flyoutTitleText').textContent = `${card.dataset.flyoutTitle} · ${describeLayer(layer, editor).name}`;

		// The Glitter source is the glitter Library: arm it through the section's
		// own chip, which is where every manager binds its picker.
		const wantsLibrary = card.dataset.paintMode === 'glitter' && !editor.isLayerContentLocked(layer);
		if (wantsLibrary && !pickers.active) document.getElementById(getPaintSlotChipId(layer.type, pickers.flyout))?.click();
		else if (!wantsLibrary && pickers.active) pickers.closeAll();
		return card;
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
