'use strict';

// The shared flyout and asset window overlays the desktop canvas and becomes
// the phone sheet. PickerRegistry owns its one open target.
class LibraryWindow {
	constructor(editor) {
		this.editor = editor;
		this.element = document.getElementById('libraryWindow');
		this.isOpen = false;
		this.pending = false;
		this.flyoutCard = null;
		this.flyoutObserver = new MutationObserver(() => this.sync());

		const pressLine = (event) => {
			const title = event.target.closest?.('.property-line > .property-card-title');
			if (!title || event.target.closest('.property-header-switch')) return false;
			const card = document.getElementById(title.parentElement.dataset.flyoutFor);
			if (!card) return true;
			const pickers = this.editor.pickers;
			// Opening a section only shows it: one that is off opens as an inert
			// preview, and the switch in the bar turns it on.
			pickers.toggleFlyout(card.dataset.flyoutKey);
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
		const card = this.syncFlyout();
		const picking = Boolean(this.editor.pickers.active);
		document.getElementById('designGallerySection')?.classList.toggle('visible', picking);
		this.element.classList.toggle('has-flyout', Boolean(card));
		this.element.classList.toggle('has-library', picking);
		const open = (picking || Boolean(card));
		if (open === this.isOpen) {
			this.syncBack(sheet, picking, card);
			return;
		}
		this.isOpen = open;
		this.element.classList.toggle('is-open', open);
		if (sheet) {
			if (open) mobile.openDrawer('window');
			else mobile.closeSheet('window');
		}
		this.syncBack(sheet, picking, card);
	}

	// The open flyout section follows the inspected layer: the same line on
	// another layer keeps the window and retitles it, no such line closes it.
	// Returns the section showing, or null.
	syncFlyout() {
		const editor = this.editor;
		const pickers = editor.pickers;
		const layer = editor.layerManager.getInspectedLayer();
		const available = editor.originalImage && !editor.autoGlitterManager?.isSessionActive();
		const card = available ? pickers.getFlyoutCard() : null;
		if (!card) pickers.flyout = null;

		if (card !== this.flyoutCard) {
			this.flyoutObserver.disconnect();
			this.flyoutCard?.classList.remove('is-flyout-open');
			this.flyoutCard?.parentElement.classList.remove('has-flyout-open');
			card?.classList.add('is-flyout-open');
			card?.parentElement.classList.add('has-flyout-open');
			if (card) this.flyoutObserver.observe(card, { subtree: true, attributes: true, attributeFilter: ['data-paint-mode', 'data-effect-enabled'] });
			this.flyoutCard = card;
			syncSectionHeaderReset(document.getElementById('flyoutReset'), card);
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
		// The Inspector's bar beside it names the layer.
		document.getElementById('flyoutTitleText').textContent = card.dataset.flyoutTitle;

		// A Glitter source is the glitter Library: arm it through the paint's own
		// chip, which is where every manager binds its picker. A section with two
		// paints keeps the one the user armed, and otherwise takes the first. The
		// phone's sheet has room for one of the two, so there the section shows
		// and the Library opens over it when its glitter is pressed.
		const usable = !card.classList.contains('is-off') && !editor.isLayerContentLocked(layer);
		const glitterSlots = usable ? getSectionPaintSlots(card).filter((slot) => slot.dataset.paintMode === 'glitter') : [];
		const armed = pickers.active && (pickers.active.pickerSession.slot || 'fill');
		if (!glitterSlots.length) pickers.closeAll();
		else if (editor.mobileManager?.usesBar) return card;
		else if (!glitterSlots.some((slot) => slot.dataset.slot === armed)) glitterSlots[0].querySelector('.asset-info.glitter-source-glitter .asset-info-thumbnail')?.click();
		return card;
	}

	// In the phone's sheet the Library opens over the section it picks for,
	// whichever sheet that section is in; Back returns to it.
	syncBack(sheet, picking, card) {
		this.element.classList.toggle('has-back', sheet && picking && Boolean(card || this.editor.mobileManager.sheetReturn));
	}

	backToSection() {
		const pickers = this.editor.pickers;
		const mobile = this.editor.mobileManager;
		if (!mobile?.usesBar || !pickers.active) return false;
		if (!this.flyoutCard) return mobile.returnToSection();
		pickers.closeAll();
		this.sync();
		return true;
	}


}
