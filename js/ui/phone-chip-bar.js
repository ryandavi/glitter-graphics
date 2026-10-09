'use strict';

// The phone's chip bar: the section index of every panel the Inspector shows
// (getPanelSectionIndex), drawn as chips. The Inspector draws the same index
// as lines and inline sections. A chip opens its section in a sheet, which
// `sheets` (MobileManager) owns.
class PhoneChipBar {
	constructor(editor, sheets) {
		this.editor = editor;
		this.sheets = sheets;
		this.element = document.getElementById('phoneChipBar');
		this.entries = [];
		this.frame = null;
		// What a chip shows arrives as `sectionstatechange`. Which sections there
		// are also follows `hidden`, which managers set without an event.
		this.observer = new MutationObserver(() => this.sync());
		document.addEventListener('sectionstatechange', () => this.sync());
		this.element.addEventListener('click', (event) => {
			const chip = event.target.closest('.phone-chip');
			const entry = chip && this.entries[Number(chip.dataset.chipIndex)];
			if (entry) this.pressChip(entry);
		});
		// The bar has no scrollbar, so a mouse wheel scrolls it sideways.
		this.element.addEventListener('wheel', (event) => {
			if (!event.deltaY || event.deltaX) return;
			this.element.scrollLeft += event.deltaY;
			event.preventDefault();
		}, { passive: false });
	}

	start() {
		this.observer.observe(document.getElementById('inspectorBody'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });
		this.sync();
	}

	stop() {
		this.observer.disconnect();
		cancelAnimationFrame(this.frame);
	}

	sync() {
		if (!this.sheets.isMobile) return;
		cancelAnimationFrame(this.frame);
		this.frame = requestAnimationFrame(() => this.render());
	}

	// The chips: the section index of every panel the Inspector shows, in
	// panel order, the tool's panel first.
	render() {
		const bar = this.element;
		const sheets = this.sheets;
		if (!sheets.isMobile) return;
		const entries = this.editor.getVisiblePanels()
			.map((name) => document.getElementById(`${name}Section`))
			.flatMap((host) => getPanelSectionIndex(host).map((entry) => ({ ...entry, host })))
			.filter((entry) => entry.button?.dataset.phoneChip !== 'false');
		this.entries = entries;

		// The open section follows the selection: the same section of the next
		// layer keeps the sheet, and a layer without it closes the sheet.
		if (sheets.sheetSection) {
			const next = entries.find((entry) => entry.key === sheets.sheetSection.key && !entry.line && !entry.button);
			if (!next) {
				if (sheets.activeDrawer === 'inspector') sheets.closeAllDrawers();
				else sheets.setSheetSection(null);
			} else if (next.element !== sheets.sheetSection.element) {
				this.openPanel(next.host);
				sheets.setSheetSection(next);
			}
		}

		const signature = entries.map((entry) => `${entry.host.id}/${entry.key}`).join('|');
		if (bar.dataset.signature !== signature) {
			bar.dataset.signature = signature;
			bar.scrollLeft = 0;
			bar.replaceChildren(...entries.map((entry, index) => {
				const chip = document.createElement('button');
				chip.type = 'button';
				chip.className = entry.button ? 'phone-chip is-add' : 'phone-chip';
				if (entry.button) {
					chip.appendChild(createIcon('plus'));
					chip.setAttribute('aria-label', `Add ${entry.title} layer`);
				}
				chip.dataset.chipIndex = String(index);
				if (entry.card && getSectionState(entry.card).swatch !== null) {
					const swatch = document.createElement('span');
					swatch.className = 'phone-chip-swatch';
					chip.appendChild(swatch);
				}
				chip.append(entry.title);
				return chip;
			}));
		}
		entries.forEach((entry, index) => {
			const chip = bar.children[index];
			if (chip.lastChild?.nodeType === Node.TEXT_NODE) chip.lastChild.textContent = entry.title;
			const state = entry.card ? getSectionState(entry.card) : null;
			if (state && state.swatch !== null) {
				// Off, a section has no paint to show, whatever it would use if on.
				const unset = state.unset || state.off;
				chip.firstElementChild.style.background = unset ? '' : state.swatch;
				chip.firstElementChild.classList.toggle('is-unset', unset);
			}
			const open = !entry.button && (entry.line ? entry.line.classList.contains('is-flyout-open') : sheets.sheetSection?.element === entry.element);
			if (open && !chip.classList.contains('active')) chip.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
			chip.classList.toggle('active', Boolean(open));
			chip.classList.toggle('is-off', Boolean(state?.off));
			if (!entry.button) chip.setAttribute('aria-pressed', String(Boolean(open)));
			chip.disabled = Boolean(entry.button?.disabled);
		});
	}

	// A chip opens its section, swaps the sheet to it, or closes it. A button
	// chip is its button.
	pressChip(entry) {
		const sheets = this.sheets;
		// A sheet still sliding away is done with.
		sheets.cancelDrawerCloseFinalization();
		if (entry.button) {
			entry.button.click();
			return;
		}
		if (entry.line) {
			if (entry.line.classList.contains('is-flyout-open')) sheets.closeAllDrawers();
			// The window owns a flyout section: its line opens it.
			else entry.line.querySelector(':scope > .property-card-title').click();
			return;
		}
		if (sheets.activeDrawer === 'inspector' && sheets.sheetSection?.element === entry.element) {
			sheets.closeAllDrawers();
			return;
		}
		this.openPanel(entry.host);
		sheets.setSheetSection(entry);
		if (sheets.activeDrawer !== 'inspector') sheets.toggleDrawer('inspector');
		this.sync();
	}

	// Of a tool's panel and the layer's, the Inspector shows one.
	openPanel(host) {
		if (host.classList.contains('switch-panel') && !host.classList.contains('is-open')) {
			this.editor.setCollapsibleSectionOpen(host.id.replace(/Section$/, ''), true);
		}
	}

	// Back on a Library sheet that was opened from a section's sheet.
	returnToSection() {
		const key = this.sheets.sheetReturn;
		const entry = key && this.entries.find((candidate) => candidate.key === key && !candidate.line && !candidate.button);
		if (!entry) return false;
		this.pressChip(entry);
		return true;
	}

	// Open the selection's first section from its layer-list row.
	openLeadingSection() {
		if (this.sheets.activeDrawer === 'inspector' || this.sheets.activeDrawer === 'window') return;
		this.render();
		const entry = this.entries.find((candidate) => !candidate.button);
		if (entry) this.pressChip(entry);
	}
}
