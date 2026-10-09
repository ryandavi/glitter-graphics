'use strict';

// The window: the column between the canvas and the Inspector. It shows the
// flyout section whose line was pressed, and the Library while a picker is
// armed; a paint section on its Glitter source shows both. What is open is
// derived from PickerRegistry (`flyout`, `active`), never set directly. At
// phone width it is the bar layout's sheet (MobileManager); with the drawer
// layout the Library is the design drawer, a flyout section sits in its
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
		// The section whose Library the user closed in the phone's sheet, by id:
		// it shows whole until its glitter is pressed again.
		this.libraryDismissed = null;
		// A source change or the switch of the open section arms or releases the
		// Library.
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
			if (!card) return true;
			const pickers = this.editor.pickers;
			pickers.toggleFlyout(card.dataset.flyoutKey);
			// A line that is off turns on and opens in one press.
			const power = card.querySelector(':scope > .property-card-title input[type="checkbox"]');
			if (pickers.flyout && power && !power.checked) power.click();
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
		const mobile = this.editor.mobileManager;
		const sheet = Boolean(mobile?.usesBar);
		const drawers = Boolean(mobile?.usesDrawers);
		const card = this.syncFlyout(drawers);
		const picking = Boolean(this.editor.pickers.active);
		// The phone's Library drawer is always there to open.
		document.getElementById('designGallerySection')?.classList.toggle('visible', drawers || picking);
		this.element.classList.toggle('has-flyout', Boolean(card));
		this.element.classList.toggle('has-library', picking);
		const open = !drawers && (picking || Boolean(card));
		if (open === this.isOpen) return;
		const viewport = this.editor.viewport;
		const current = viewport?.captureViewState?.() || null;
		const tookCanvasSpace = this.isOpen && this.tier !== 'float';
		this.isOpen = open;
		this.element.classList.toggle('is-open', open);

		// As a sheet, the phone's drawers own the canvas refit and the view.
		if (sheet) {
			this.viewState = null;
			this.fitZoom = null;
			this.setTier(null);
			if (open) mobile.openDrawer('window');
			else mobile.closeSheet('window');
			return;
		}

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
	syncFlyout(drawers) {
		const editor = this.editor;
		const pickers = editor.pickers;
		const layer = editor.layerManager.getInspectedLayer();
		const available = !drawers && editor.originalImage && !editor.autoGlitterManager?.isSessionActive();
		const card = available ? pickers.getFlyoutCard() : null;
		if (!card) pickers.flyout = null;

		if (card !== this.flyoutCard) {
			this.flyoutObserver.disconnect();
			this.flyoutCard?.classList.remove('is-flyout-open');
			card?.classList.add('is-flyout-open');
			if (card) this.flyoutObserver.observe(card, { subtree: true, attributes: true, attributeFilter: ['data-paint-mode', 'data-effect-enabled'] });
			this.flyoutCard = card;
			this.libraryDismissed = null;
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

		// A Glitter source is the glitter Library: arm it through the paint's own
		// chip, which is where every manager binds its picker. A section with two
		// paints keeps the one the user armed, and otherwise takes the first.
		const usable = !card.classList.contains('is-off') && !editor.isLayerContentLocked(layer);
		const glitterSlots = usable ? getSectionPaintSlots(card).filter((slot) => slot.dataset.paintMode === 'glitter') : [];
		const armed = pickers.active && (pickers.active.pickerSession.slot || 'fill');
		if (armed || !glitterSlots.length) this.libraryDismissed = null;
		if (!glitterSlots.length) pickers.closeAll();
		else if (this.libraryDismissed === card.id) return card;
		else if (!glitterSlots.some((slot) => slot.dataset.slot === armed)) glitterSlots[0].querySelector('.asset-info.glitter-source-glitter .asset-info-thumbnail')?.click();
		return card;
	}

	// In the phone's sheet the Library and a section share little room, so the
	// Library's Close leaves the section. Returns whether it did.
	dismissLibrary() {
		const pickers = this.editor.pickers;
		if (!this.editor.mobileManager?.usesBar || !this.flyoutCard || !pickers.active) return false;
		this.libraryDismissed = this.flyoutCard.id;
		pickers.closeAll();
		this.sync();
		return true;
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
