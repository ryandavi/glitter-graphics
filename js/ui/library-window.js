'use strict';

// Two modes share this class:
//  - The flyout (#flyoutWindow) is a floating panel over the desktop canvas,
//    anchored to the Inspector's left edge at the row that opened it. It never
//    counts toward the canvas rect. Esc, an outside press or Close dismiss it.
//  - The Library (#libraryWindow) is the left dock's second tab, beside
//    Layers (the tabs are each dock header's title). A picker armed in the Inspector shows it, and
//    ending the pick returns to the tab chosen by hand. A hidden dock is shown
//    for the pick only. Browsing by hand shows the kind picked in
//    #libraryBrowseKind
//    in #libraryKindBar, under the header.
// At phone width #libraryWindow moves out of the dock to be the sheet, and
// #flyoutSection moves into it. PickerRegistry owns the one open target.

// Presses that leave an open desktop flyout alone: itself, the Library it
// arms, the timeline (a bar opens its own section), the row that opened it,
// and the floating bits its controls open.
const FLYOUT_KEEP_OPEN = '#flyoutWindow, #libraryWindow, .dock-tabs, #timelineDock, .property-line.is-flyout-open, .app-menu-popover, .is-fixed-menu, .scroll-region-track, .modal, .tooltip';

class LibraryWindow {
	constructor(editor) {
		this.editor = editor;
		this.element = document.getElementById('libraryWindow');
		this.isOpen = false;
		this.pending = false;
		this.flyoutCard = null;
		this.flyoutWindow = document.getElementById('flyoutWindow');
		this.flyoutSection = document.getElementById('flyoutSection');
		this.flyoutOpen = false;
		// The left dock's tab chosen by hand, and the Library kind browsed on it.
		this.dock = document.getElementById('layersPanel');
				this.kindSelect = document.getElementById('libraryBrowseKind');
		this.tab = 'layers';
		this.browseChoice = ASSET_BROWSERS[0].prefix;
		// The kind showing while browsing by hand, otherwise null.
		this.browseKind = null;
		this.initializeDockTabs();
		this.initializeFlyoutWindow();
		// A paint switching to or from glitter, or the section turning on or
		// off, changes what the window arms.
		document.addEventListener('sectionstatechange', (event) => {
			if (event.target === this.flyoutCard) this.sync();
		});

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

	initializeDockTabs() {
		// Each dock header carries its own copy of the tabs in the same place,
		// so they never move when the tab does; one is showing at a time.
		document.querySelectorAll('.dock-tabs-header > .section-header-title').forEach((title) => {
			title.prepend(tplClone('tpl-dock-tabs'));
			title.parentElement.querySelector('.section-header-actions')?.append(tplClone('tpl-dock-pin'));
		});
		this.dock.addEventListener('click', (event) => {
			const button = event.target.closest('[data-dock-tab]');
			if (button) this.setTab(button.dataset.dockTab);
		});
		this.kindSelect.append(...ASSET_BROWSERS.map((schema) => new Option(schema.title, schema.prefix)));
		this.kindSelect.addEventListener('change', () => {
			this.browseChoice = this.kindSelect.value;
			this.sync();
		});
	}

	// Layers while a pick is armed ends the pick; the Library tab shows then
	// anyway.
	setTab(tab) {
		if (tab === 'layers' && this.editor.pickers.active) this.editor.pickers.closeActive();
		this.refocusTab = Boolean(document.activeElement?.closest?.('[data-dock-tab]'));
		this.tab = tab;
		this.sync();
	}

	// The floating flyout keeps its place beside the Inspector as the layout
	// moves under it, and closes on a press outside it.
	initializeFlyoutWindow() {
		if (!this.flyoutWindow) return;
		this.initializeFlyoutFold();
		this.initializeFlyoutResize();
		const reposition = () => this.positionFlyout();
		window.addEventListener('resize', reposition);
		document.getElementById('designPanel')?.addEventListener('scroll', reposition, { passive: true });
		if (typeof ResizeObserver === 'function') {
			const observer = new ResizeObserver(reposition);
			[this.flyoutWindow, document.getElementById('designPanel'), document.getElementById('previewContainer')]
				.forEach((node) => node && observer.observe(node));
		}
		document.addEventListener('pointerdown', (event) => {
			if (!this.flyoutOpen) return;
			const pickers = this.editor.pickers;
			// A session's own section stays until the session ends.
			if (!pickers.flyout || getSessionDefinition(this.editor)?.flyout) return;
			const target = event.target;
			if (!(target instanceof Element) || target.closest(FLYOUT_KEEP_OPEN)) return;
			// A pick from the canvas belongs to an asset session.
			if (pickers.active?.pickerSession.kind === 'asset' && target.closest('#previewContainer')) return;
			pickers.closeFlyout();
		}, true);
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
		const sheet = Boolean(mobile?.isMobile);
		this.placeWindow(sheet);
		this.placeFlyoutSection(sheet);
		const card = this.syncFlyout();
		const picking = Boolean(this.editor.pickers.active);
		this.element.classList.toggle('has-flyout', Boolean(card));
		this.element.classList.toggle('has-library', picking);
		this.syncLibraryMode(sheet, picking, card);
		this.syncFlyoutWindow(!sheet && Boolean(card));
	}

	// The Library is a tab of the left dock on the desktop and its own sheet
	// on the phone.
	placeWindow(sheet) {
		const home = sheet ? this.flyoutWindow.parentElement : this.dock;
		if (this.element.parentElement === home) return;
		if (sheet) this.flyoutWindow.after(this.element);
		else this.dock.appendChild(this.element);
	}

	// The flyout section lives in the floating window on the desktop and in
	// the sheet, ahead of the Library, on the phone.
	placeFlyoutSection(sheet) {
		const section = this.flyoutSection;
		if (!section || !this.flyoutWindow) return;
		if (sheet && section.parentElement !== this.element) {
			this.element.insertBefore(section, document.getElementById('designGallerySection'));
		} else if (!sheet && section.parentElement !== this.flyoutWindow) {
			this.flyoutWindow.appendChild(section);
		}
	}

	// Library mode: the dock's tab, or the whole sheet on the phone. A picker
	// armed on the desktop shows the tab (and a hidden dock for the pick); the
	// flyout floats on its own.
	syncLibraryMode(sheet, picking, card) {
		const mobile = this.editor.mobileManager;
		const browsing = !sheet && !picking && this.tab === 'library';
		const open = sheet ? (picking || Boolean(card)) : (picking || browsing);
		this.browseKind = browsing ? this.browseChoice : null;
		document.getElementById('designGallerySection')?.classList.toggle('visible', picking || browsing);
		if (!sheet) this.syncDockTabs(open, browsing);
		syncLibraryView();
		if (open === this.isOpen) {
			this.syncBack(sheet, picking, card);
			return;
		}
		this.isOpen = open;
		this.element.classList.toggle('is-open', open);
		if (sheet) {
			if (open) mobile.openDrawer('window');
			else if (mobile.activeDrawer === 'window') mobile.closeAllDrawers();
		}
		this.syncBack(sheet, picking, card);
	}

	syncDockTabs(library, browsing) {
		this.dock.classList.toggle('is-library-tab', library);
		// A hidden dock, or the closed compact-width overlay, shows for a pick only.
		setDockPeek('layers', library && (leftDockOverlay.active ? !browsing : !isDockVisible('layers')));
		this.dock.querySelectorAll('[data-dock-tab]').forEach((button) => {
			const active = (button.dataset.dockTab === 'library') === library;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
		// The press moved the copy under the pointer out of sight; keyboard focus
		// follows to the one showing.
		if (this.refocusTab) {
			this.refocusTab = false;
			const showing = library ? this.element : document.getElementById('layersPanelSection');
			showing.querySelector(`[data-dock-tab="${library ? 'library' : 'layers'}"]`)?.focus();
		}
		this.kindSelect.value = this.browseChoice;
	}

	// A press on the window's bar folds it to the bar; the title is the
	// keyboard stop. The bar's own controls keep their clicks.
	initializeFlyoutFold() {
		const header = document.getElementById('flyoutHeader');
		const title = header?.querySelector('.section-header-title');
		if (!title) return;
		title.tabIndex = 0; title.setAttribute('role', 'button');
		const toggle = () => {
			if (this.flyoutSection.parentElement === this.flyoutWindow) this.setFlyoutFolded(!this.flyoutFolded);
		};
		header.addEventListener('click', (event) => {
			if (event.target.isConnected && !event.target.closest('button, input, select, a, label, [data-no-accordion-toggle]')) toggle();
		});
		title.addEventListener('keydown', (event) => {
			if (event.target !== title || !['Enter', ' '].includes(event.key)) return;
			event.preventDefault(); event.stopPropagation(); toggle();
		});
		this.setFlyoutFolded(false);
	}

	setFlyoutFolded(folded) {
		this.flyoutFolded = folded;
		this.flyoutWindow.classList.toggle('is-folded', folded);
		const title = document.querySelector('#flyoutHeader > .section-header-title');
		title?.setAttribute('aria-expanded', String(!folded));
		if (title) title.title = folded ? 'Expand' : 'Collapse';
		this.positionFlyout();
	}

	// The window's left edge sizes it. It is as wide as the Inspector until
	// dragged, and never wider than the canvas area beside the Inspector.
	initializeFlyoutResize() {
		const host = this.flyoutWindow;
		const handle = document.createElement('div');
		handle.className = 'panel-resize-handle panel-resize-handle-start flyout-resize-handle ui-ignore-gestures';
		host.appendChild(handle);
		const min = () => Math.min(CONFIG.ui.panelResize.flyoutMinWidth, this.flyoutMaxWidth ?? Infinity);
		const max = () => this.flyoutMaxWidth ?? window.innerWidth;
		const width = () => Math.round(host.getBoundingClientRect().width);
		const apply = (value) => {
			const next = Math.round(Math.max(min(), Math.min(max(), value)));
			host.style.setProperty('--flyout-width', `${next}px`);
			this.syncFlyoutSeparator(Math.round(min()), Math.round(max()), next);
			this.positionFlyout();
		};
		this.syncFlyoutSeparator = bindSizeHandle(handle, {
			orientation: 'vertical', label: 'Resize window', direction: -1, bodyClass: 'is-resizing-panel',
			canUse: () => this.flyoutOpen, read: width, apply,
			persist: (value) => PREFERENCES.set('flyoutWidth', value),
			reset: () => PREFERENCES.reset('flyoutWidth')
		});
		// The stored width, also when Settings resets it.
		const restore = (value) => {
			if (value) host.style.setProperty('--flyout-width', `${value}px`);
			else host.style.removeProperty('--flyout-width');
			this.positionFlyout();
		};
		PREFERENCES.onChange('flyoutWidth', restore);
		restore(PREFERENCES.get('flyoutWidth'));
	}

	// Flyout mode: a floating panel over the canvas. Opening, closing and
	// switching it moves no dock, so the canvas rect and timeline are untouched.
	syncFlyoutWindow(show) {
		if (!this.flyoutWindow) return;
		if (this.flyoutOpen !== show) {
			this.flyoutOpen = show;
			this.flyoutWindow.classList.toggle('is-open', show);
		}
		this.positionFlyout();
	}

	// Beside the Inspector, level with the row that opened it, kept inside the
	// canvas area.
	positionFlyout() {
		const host = this.flyoutWindow;
		if (!host || !this.flyoutOpen) return;
		const origin = host.offsetParent?.getBoundingClientRect();
		const canvas = document.getElementById('previewContainer')?.getBoundingClientRect();
		const inspector = document.getElementById('designPanel')?.getBoundingClientRect();
		if (!origin || !canvas || !inspector) return;
		// The gap is the window's own margin, so the tokens own the spacing.
		const gap = parseFloat(getComputedStyle(host).marginTop) || 0;
		host.style.setProperty('--flyout-right', `${origin.right - inspector.left}px`);
		host.style.setProperty('--flyout-max-height', `${Math.max(0, canvas.height - gap * 2)}px`);
		// A narrow canvas area narrows the window rather than pushing it off
		// the left edge.
		this.flyoutMaxWidth = Math.max(0, Math.round(inspector.left - Math.max(canvas.left, 0) - gap * 2));
		host.style.setProperty('--flyout-max-width', `${this.flyoutMaxWidth}px`);
		this.syncFlyoutSeparator?.(Math.round(Math.min(CONFIG.ui.panelResize.flyoutMinWidth, this.flyoutMaxWidth)), this.flyoutMaxWidth, Math.round(host.getBoundingClientRect().width));
		const line = document.querySelector('.property-line.is-flyout-open');
		const anchor = line ? Math.min(Math.max(line.getBoundingClientRect().top, inspector.top), inspector.bottom) : inspector.top;
		const top = Math.max(canvas.top + gap, Math.min(anchor, canvas.bottom - gap - host.offsetHeight));
		host.style.setProperty('--flyout-top', `${top - origin.top - gap}px`);
	}

	// The open flyout section follows the inspected layer: the same line on
	// another layer keeps the window and retitles it, no such line closes it.
	// Returns the section showing, or null.
	syncFlyout() {
		const editor = this.editor;
		const pickers = editor.pickers;
		const layer = editor.layerManager.getInspectedLayer();
		const session = getSessionDefinition(editor);
		const available = editor.originalImage && (session?.flyout || !session?.closesLibrary);
		const card = available ? pickers.getFlyoutCard() : null;
		if (!card) pickers.flyout = null;

		if (card !== this.flyoutCard) {
			this.flyoutCard?.classList.remove('is-flyout-open');
			this.flyoutCard?.parentElement.classList.remove('has-flyout-open');
			card?.classList.add('is-flyout-open');
			// Another section opens unfolded.
			if (this.flyoutFolded) this.setFlyoutFolded(false);
			card?.parentElement.classList.add('has-flyout-open');
			this.flyoutCard = card;
			// The window's bar is the section's: the Inspector's bar beside it
			// names the layer.
			bindSectionBar({
				title: document.getElementById('flyoutTitleText'),
				reset: document.getElementById('flyoutReset'),
				switchHost: document.getElementById('flyoutSwitch')
			}, card);
			if (card) document.getElementById('flyoutTitleIcon').setAttribute('href', `#icon-${card.parentElement.dataset.flyoutIcon}`);
			document.querySelectorAll('.property-line').forEach((line) => {
				const open = Boolean(card) && line.dataset.flyoutFor === card.id;
				line.classList.toggle('is-flyout-open', open);
				line.querySelector(':scope > .property-card-title').setAttribute('aria-expanded', String(open));
			});
			// The open line is the phone's active chip.
			editor.mobileManager?.syncBar();
		}
		document.getElementById('flyoutSection').classList.toggle('visible', Boolean(card));
		if (!card) return null;
		// A session's section names what it is showing, and arms nothing: the
		// session opened the Library itself.
		if (session?.flyout) {
			document.getElementById('flyoutTitleText').textContent = card.dataset.flyoutTitle;
			return card;
		}

		// A Glitter source is the glitter Library. A section with two paints
		// keeps the one the user armed, and otherwise takes the first. The
		// phone's sheet has room for one of the two, so there the section shows
		// and the Library opens over it when its glitter is pressed.
		const usable = !card.classList.contains('is-off') && !editor.isLayerContentLocked(layer);
		const glitterSlots = usable ? getSectionPaintSlots(card).filter((slot) => slot.dataset.paintMode === 'glitter') : [];
		const armed = pickers.active?.pickerSession.slot;
		if (!glitterSlots.length) pickers.closeAll();
		else if (editor.mobileManager?.isMobile) return card;
		else if (!glitterSlots.some((slot) => slot.dataset.slot === armed)) editor.armPaintSlot(layer, glitterSlots[0].dataset.slot);
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
		if (!mobile?.isMobile || !pickers.active) return false;
		if (!this.flyoutCard) return mobile.returnToSection();
		pickers.closeAll();
		this.sync();
		return true;
	}
}
