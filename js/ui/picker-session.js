'use strict';

class PickerRegistry {
	constructor(editor) {
		this.editor = editor;
		this.managers = new Set();
	}

	register(manager) {
		if (manager) this.managers.add(manager);
		return manager;
	}

	get active() {
		return Array.from(this.managers).find((manager) => manager.pickerSession) || null;
	}

	closeActive({ returnToProperties = true } = {}) {
		const manager = this.active;
		if (!manager) return false;
		const slot = manager.pickerSession?.slot || 'fill';
		if (returnToProperties && typeof manager.handlePickerDone === 'function') {
			manager.handlePickerDone();
		} else if (returnToProperties && typeof manager.closePicker === 'function') {
			manager.closePicker();
		} else {
			manager.closePickerSession?.();
			if (returnToProperties) manager.returnToTextProperties?.(slot);
		}
		return true;
	}

	closeAll() {
		this.managers.forEach((manager) => manager.closePickerSession?.());
	}
}

function pickerOpenSession(manager, session, options = {}) {
	manager.pickerSession = { ...session };
	options.refresh?.();
	options.reveal?.();
	return manager.pickerSession;
}

function pickerCloseSession(manager, options = {}) {
	if (!manager.pickerSession && !options.force) return false;
	manager.pickerSession = null;
	options.refresh?.();
	options.updateSelection?.();
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

function returnFromPickerToProperties(editor, options = {}) {
	const { section, focusId } = options;
	if (editor.mobileManager?.isMobile) {
		editor.mobileManager.openDrawer('edit');
	}
	// Mobile moves the same accordion into the Edit drawer, so opening the
	// drawer and expanding the originating section are separate requirements.
	if (section) editor.setCollapsibleSectionOpen?.(section, true, true);
	if (focusId) {
		requestAnimationFrame(() => {
			document.getElementById(focusId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		});
	}
}

function renderPickerStrip(state = {}) {
	const strip = document.getElementById('galleryPickerStrip');
	if (!strip || !state.ownsStrip) return;
	const title = document.getElementById('galleryPickerStripTitle');
	const detail = document.getElementById('galleryPickerStripDetail');
	const done = document.getElementById('galleryPickerStripDone');
	const section = document.getElementById('designGallerySection');
	const visible = Boolean(state.visible);
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
// defaultSlot.
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
		document.getElementById('galleryPickerStripDone')?.addEventListener('click', () => {
			if (this.getArmedSlot(this.getLayer())) this.handlePickerDone();
		});
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
			reveal: () => revealAssetBrowser(this.editor, this.editor.glitterManager, getLayerPaintSlot(layer, slot)?.glitterId)
		});
	}

	getArmedSlot(layer) {
		return pickerSelectionTarget(this, layer);
	}

	getTarget(layer) {
		return this.getArmedSlot(layer) || this.defaultSlot;
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
		data.glitterId = glitterId;
		data.mode = 'glitter';
		data.colorAdjust = null;
		this.onPicked(layer);
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
			...formatPickerStripText(this.getTarget(layer), layer.name, this.typeWord)
		});
	}

	handlePickerDone() {
		const slot = this.pickerSession?.slot || this.defaultSlot;
		const prefix = getPaintSlotDefinition(this.type, slot)?.panelPrefix;
		this.closePickerSession();
		returnFromPickerToProperties(this.editor, { section: this.section, focusId: prefix ? `${prefix}GlitterChip` : null });
	}

	closePickerSession() {
		pickerCloseSession(this, {
			refresh: () => this.updatePickerStrip(),
			updateSelection: () => this.editor.updateGlitterSelection()
		});
	}
}
