'use strict';

class PickerRegistry {
	constructor(editor) {
		this.editor = editor;
		this.managers = new Set();
		// The flyout section the window shows, by its key (`data-flyout-key`).
		// With an armed session this is the one open target.
		this.flyout = null;
		['galleryPickerStripDone', 'libraryWindowClose', 'flyoutClose'].forEach((id) => {
			document.getElementById(id)?.addEventListener('click', () => this.closeActive());
		});
	}

	// Pressing a line opens its section, swaps the window to it, or closes it.
	toggleFlyout(key) {
		this.flyout = this.flyout === key ? null : key;
		this.closeAll();
		this.editor.libraryWindow?.sync();
	}

	closeFlyout() {
		if (!this.flyout) return false;
		this.toggleFlyout(this.flyout);
		return true;
	}

	// The open section's card for the inspected layer, or null: the same key
	// names the same line on every layer type that has it.
	getFlyoutCard() {
		const layer = this.editor.layerManager.getInspectedLayer();
		const prefix = layer && PANEL_SCHEMAS[layer.type]?.sectionPrefix;
		return (this.flyout && prefix) ? document.querySelector(`#${prefix}Flyouts > [data-flyout-key="${this.flyout}"]`) : null;
	}

	// A glitter session for one of the open section's paints keeps the window
	// on it. A session with no slot is the layer's fill.
	sessionKeepsFlyout(manager, session) {
		const layer = this.editor.layerManager.getInspectedLayer();
		const owner = layer && getLayerManagerForType(this.editor, layer.type);
		const card = this.getFlyoutCard();
		if (!owner || !card || (manager !== owner && manager !== owner.slotPicker)) return false;
		if (session.kind && session.kind !== 'glitter') return false;
		return getSectionPaintSlots(card).some((slot) => slot.dataset.slot === (session.slot || 'fill'));
	}

	register(manager) {
		if (manager) this.managers.add(manager);
		return manager;
	}

	get active() {
		return Array.from(this.managers).find((manager) => manager.pickerSession) || null;
	}

	closeActive({ returnToProperties = true } = {}) {
		// A tool change ends the session it finds (`returnToProperties: false`),
		// not the section the window shows: that follows the selection.
		if (returnToProperties && this.closeFlyout()) return true;
		const manager = this.active;
		if (!manager) return false;
		if (returnToProperties) manager.handlePickerDone();
		else manager.closePickerSession({ restorePicker: false });
		return true;
	}

	closeAll({ except = null } = {}) {
		this.managers.forEach(manager => {
			if (manager !== except && manager.pickerSession) manager.closePickerSession({ restorePicker: false });
		});
	}
}

// The paints of a section: its own, then any nested in it (Bevel's Shade).
function getSectionPaintSlots(card) {
	return [card, ...card.querySelectorAll('[data-role="paint-slot"][data-nested]')].filter((slot) => slot.dataset.slot);
}

function pickerOpenSession(manager, session, options = {}) {
	const registry = manager.editor?.pickers;
	registry?.closeAll({ except: manager });
	if (registry?.flyout && !registry.sessionKeepsFlyout(manager, session)) registry.flyout = null;
	manager.pickerSession = { ...session };
	options.refresh?.();
	options.reveal?.();
	manager.editor?.libraryWindow?.sync();
	return manager.pickerSession;
}

function pickerCloseSession(manager, options = {}) {
	if (!manager.pickerSession && !options.force) return false;
	manager.pickerSession = null;
	options.refresh?.();
	options.updateSelection?.();
	manager.editor?.libraryWindow?.sync();
	return true;
}

function pickerSessionMatches(manager, layer, predicate = null) {
	const session = manager.pickerSession;
	if (!session || !layer || session.layerId !== layer.id) return false;
	return predicate ? Boolean(predicate(session, layer)) : true;
}

function pickerSelectionTarget(manager, layer, options = {}) {
	const fallback = options.fallback ?? null;
	if (!pickerSessionMatches(manager, layer, options.isValid)) return fallback;
	return manager.pickerSession.slot ?? fallback;
}

// The paint slot an armed session targets, or null. A slot counts only while
// its data exists at its declared path (js/paint/paint-slots.js), never by
// reading the data root with the slot key: nested slots (bevel) are not there.
function pickerArmedSlot(manager, layer, isValid = null) {
	return pickerSelectionTarget(manager, layer, {
		isValid: (session) => (!isValid || isValid(session)) && Boolean(getLayerPaintSlot(layer, session.slot))
	});
}

function returnFromPickerToProperties(editor, options = {}) {
	const { section, focusId } = options;
	if (editor.mobileManager?.isMobile) {
		editor.mobileManager.openDrawer('edit');
	}
	// Mobile moves the same sections into the Edit drawer, so opening the
	// drawer and expanding the originating section are separate requirements.
	if (section) editor.setCollapsibleSectionOpen?.(section, true);
	if (focusId) {
		requestAnimationFrame(() => {
			document.getElementById(focusId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		});
	}
}

function renderPickerStrip(state = {}) {
	const recolor = window.editor?.glitterRecolor;
	if (recolor?.pickerSession) state = recolor.getPickerStripState();
	const strip = document.getElementById('galleryPickerStrip');
	if (!strip || !state.ownsStrip) return;
	const title = document.getElementById('galleryPickerStripTitle');
	const detail = document.getElementById('galleryPickerStripDetail');
	const done = document.getElementById('galleryPickerStripDone');
	const section = document.getElementById('designGallerySection');
	const visible = Boolean(state.visible) && (Boolean(recolor?.pickerSession) || !window.editor?.layerManager?.hasMultiSelection());
	const armed = visible && Boolean(state.armed);
	const hint = visible && Boolean(state.hint);

	strip.hidden = !visible;
	strip.classList.toggle('is-armed', armed);
	strip.classList.toggle('is-hint', hint);
	section?.classList.toggle('picker-mode', armed && state.pickerMode !== false);
	if (section) {
		if (visible && state.library) section.dataset.pickerLibrary = state.library;
		else delete section.dataset.pickerLibrary;
	}
	syncLibraryView();
	if (!visible) return;
	if (title) title.textContent = state.title || '';
	if (detail) detail.textContent = state.detail || '';
	if (done) done.hidden = !armed || state.showDone === false;
}

// The glitter picker of a layer type whose paints are all declared slots
// (Frame, Sparkles): arm a slot, route the next gallery pick into it, and
// drive the gallery strip while such a layer is active. Registered with the
// PickerRegistry like the managers' own sessions. Unarmed picks go to
// defaultSlot: a slot key, or (layer) => key where it depends on the layer.
class SlotGlitterPicker {
	constructor(editor, { type, defaultSlot, section, typeWord, ensureSlot, onPicked }) {
		this.editor = editor;
		this.type = type;
		this.defaultSlot = defaultSlot;
		this.section = section;
		this.typeWord = typeWord;
		this.ensureSlot = ensureSlot;
		this.onPicked = onPicked;
		this.pickerSession = null;
	}

	getLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === this.type ? layer : null;
	}

	arm(slot) {
		const layer = this.getLayer();
		if (!layer) return;
		pickerOpenSession(this, { layerId: layer.id, slot }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => revealAssetBrowser(this.editor, this.editor.glitterLibrary, getLayerPaintSlot(layer, slot)?.glitterId)
		});
	}

	getArmedSlot(layer) {
		return pickerSelectionTarget(this, layer);
	}

	getDefaultSlot(layer) {
		return typeof this.defaultSlot === 'function' ? this.defaultSlot(layer) : this.defaultSlot;
	}

	getTarget(layer) {
		return this.getArmedSlot(layer) || this.getDefaultSlot(layer);
	}

	resolveSelectedGlitterId(layer) {
		const data = getLayerPaintSlot(layer, this.getTarget(layer));
		return data?.mode === 'glitter' ? data.glitterId ?? null : null;
	}

	// A gallery pick: the target slot switches to that glitter, color adjust
	// reset, as every other slot pick does.
	applyPick(layer, glitterId) {
		const data = this.ensureSlot(layer, this.getTarget(layer));
		if (!data) return false;
		const previousId = data.glitterId;
		data.glitterId = glitterId;
		data.mode = 'glitter';
		data.colorAdjust = null;
		this.pendingPick = Promise.resolve(this.onPicked(layer, glitterId, previousId));
		this.updatePickerStrip();
		return true;
	}

	updatePickerStrip() {
		const layer = this.getLayer();
		if (!layer) return;
		if (this.pickerSession && this.pickerSession.layerId !== layer.id) pickerCloseSession(this);
		const armed = Boolean(this.getArmedSlot(layer));
		renderPickerStrip({
			ownsStrip: true,
			visible: true,
			armed,
			hint: !armed,
			...formatPickerStripText(layer, this.getTarget(layer), this.typeWord)
		});
	}

	handlePickerDone() {
		const slot = this.pickerSession?.slot || this.getDefaultSlot(this.getLayer());
		this.closePickerSession();
		returnFromPickerToProperties(this.editor, { section: this.section, focusId: getPaintSlotChipId(this.type, slot) });
	}

	closePickerSession() {
		pickerCloseSession(this, {
			refresh: () => this.updatePickerStrip(),
			updateSelection: () => this.editor.updateGlitterSelection()
		});
	}
}

// Mixed asset/paint pickers keep their asset UI while the slot picker owns paint writes.
function createManagerSlotPicker(manager, { type, defaultSlot, typeWord, onPicked }) {
	const picker = new SlotGlitterPicker(manager.editor, {
		type, defaultSlot, typeWord,
		ensureSlot: (layer, key) => manager.fieldHost.ensureSlot(layer, key),
		onPicked
	});
	Object.defineProperty(picker, 'pickerSession', {
		get: () => manager.pickerSession,
		set: (value) => { manager.pickerSession = value; }
	});
	picker.getTarget = (layer) => manager.getGlitterSelectionTarget(layer);
	picker.updatePickerStrip = () => manager.updatePickerStrip();
	picker.handlePickerDone = () => manager.handlePickerDone();
	picker.closePickerSession = () => manager.closePickerSession();
	return picker;
}
