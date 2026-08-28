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
	if (!visible) return;
	if (title) title.textContent = state.title || '';
	if (detail) detail.textContent = state.detail || '';
	if (done) done.hidden = !armed || state.showDone === false;
}
