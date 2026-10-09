'use strict';

// A picker session is what the Library's next pick changes. Every session is
// `{ kind, layerId?, slot?, library?, label? }`:
//   kind: 'paint'  one of a layer's paint slots; `slot` is its key (the
//                  layer's own fill is 'fill', never null) and the Library
//                  shows glitter.
//   kind: 'asset'  anything else (a sticker, a shape, a font, a brush tip, a
//                  colour match); `library` is the Library kind it shows and
//                  `label` names what a pick changes.
// `layerId` ties the session to a layer: it ends when another is inspected.
class PickerRegistry {
	constructor(editor) {
		this.editor = editor;
		this.managers = new Set();
		// The flyout section the window shows, by its key (`data-flyout-key`).
		// With an armed session this is the one open target.
		this.flyout = null;
		['libraryWindowClose', 'flyoutClose'].forEach((id) => {
			document.getElementById(id)?.addEventListener('click', () => this.closeActive());
		});
		document.getElementById('libraryBack')?.addEventListener('click', () => this.editor.libraryWindow?.backToSection());
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

	// A paint session for one of the open section's paints keeps the window
	// on it.
	sessionKeepsFlyout(manager, session) {
		const layer = this.editor.layerManager.getInspectedLayer();
		const owner = layer && getLayerManagerForType(this.editor, layer.type);
		const card = this.getFlyoutCard();
		if (!owner || !card || (manager !== owner && manager !== owner.slotPicker)) return false;
		return session.kind === 'paint' && getSectionPaintSlots(card).some((slot) => slot.dataset.slot === session.slot);
	}

	register(manager) {
		if (manager) this.managers.add(manager);
		return manager;
	}

	get active() {
		return Array.from(this.managers).find((manager) => manager.pickerSession) || null;
	}

	// The user dismissing what is open (Close, Escape). A tool change ends the
	// session it finds instead (`toolChange`), not the section the window
	// shows: that follows the selection.
	closeActive({ toolChange = false } = {}) {
		// The phone's sheet slides away first and then lets go of what it showed.
		const mobile = this.editor.mobileManager;
		if (!toolChange && mobile?.isMobile && mobile.activeDrawer === 'window') {
			mobile.closeAllDrawers();
			return true;
		}
		if (!toolChange && this.closeFlyout()) return true;
		const manager = this.active;
		if (!manager) return false;
		manager.closePickerSession({ restorePicker: false });
		return true;
	}

	closeAll({ except = null } = {}) {
		this.managers.forEach(manager => {
			if (manager !== except && manager.pickerSession) manager.closePickerSession({ restorePicker: false });
		});
	}

	// A session tied to a layer ends when another layer is inspected, or when
	// the paint it is armed for is gone from the layer (undo).
	closeStale() {
		const layer = this.editor.layerManager.getInspectedLayer();
		this.managers.forEach((manager) => {
			const session = manager.pickerSession;
			if (session?.layerId == null) return;
			const gone = session.layerId !== layer?.id || (session.kind === 'paint' && !getLayerPaintSlot(layer, session.slot));
			if (gone) manager.closePickerSession({ restorePicker: false });
		});
	}

	closeForLayer(layerId) {
		this.managers.forEach((manager) => {
			if (manager.pickerSession?.layerId === layerId) manager.closePickerSession({ restorePicker: false });
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
	syncPickerTarget(manager.editor);
	options.reveal?.();
	manager.editor?.libraryWindow?.sync();
	return manager.pickerSession;
}

function pickerCloseSession(manager, options = {}) {
	if (!manager.pickerSession && !options.force) return false;
	manager.pickerSession = null;
	options.refresh?.();
	syncPickerTarget(manager.editor);
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

// The Library's asset kind is the armed session's: `library` on the session,
// or glitter for a paint slot. syncLibraryView reads it and names the target
// in the Library's bar.
function syncPickerTarget(editor) {
	const section = document.getElementById('designGallerySection');
	if (!section) return;
	const session = editor?.pickers?.active?.pickerSession;
	if (session) section.dataset.pickerLibrary = session.library || 'glitter';
	else delete section.dataset.pickerLibrary;
	syncLibraryView();
}

// "Outline": what the armed session changes, or '' when nothing is armed or
// an open flyout section's bar beside it already says it. Which layer is the
// Inspector's bar to say.
function describePickerTarget(editor) {
	const pickers = editor?.pickers;
	const manager = pickers?.active;
	const session = manager?.pickerSession;
	// In the phone's sheet the Library covers the section, so it names the target itself.
	if (!session || (pickers.sessionKeepsFlyout(manager, session) && !editor.mobileManager?.isMobile)) return '';
	const layer = session.layerId == null ? null : editor.layerManager.getLayerById(session.layerId);
	return session.label || (layer ? panelCap(getPaintSlotLabel(layer.type, session.slot)) : '');
}

// An asset row opens its Library, and pressed again closes it, as a line
// does its section. `owner` is the manager holding the row's session.
function pressAssetRow(editor, owner, arm) {
	if (owner?.pickerSession?.kind === 'asset') editor.pickers.closeActive();
	else arm();
}

// The glitter picker of a layer type whose paints are all declared slots
// (Frame, Sparkles): arm a slot and route the next gallery pick into it.
// Registered with the PickerRegistry like the managers' own sessions.
// defaultSlot is a slot key, or (layer) => key where it depends on the layer.
class SlotGlitterPicker {
	constructor(editor, { type, defaultSlot, typeWord, ensureSlot, onPicked }) {
		this.editor = editor;
		this.type = type;
		this.defaultSlot = defaultSlot;
		this.typeWord = typeWord;
		this.ensureSlot = ensureSlot;
		this.onPicked = onPicked;
		this.pickerSession = null;
	}

	getLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === this.type ? layer : null;
	}

	armPicker(slot) {
		const layer = this.getLayer();
		if (!layer) return;
		pickerOpenSession(this, { kind: 'paint', layerId: layer.id, slot }, {
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
		return true;
	}

	closePickerSession() {
		pickerCloseSession(this, { updateSelection: () => this.editor.updateGlitterSelection() });
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
	picker.closePickerSession = () => manager.closePickerSession();
	return picker;
}
