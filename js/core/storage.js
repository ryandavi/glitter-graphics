'use strict';

const STORAGE_KEYS = Object.freeze({
	preferences: { key: 'glitter.preferences', resetWith: () => PREFERENCES.resetAll() },
	exportSettings: { key: 'glitter.export-settings', resetWith: editor => { editor.settingsStore.reset(editor.exportSettings); editor.saveSettingsToStorage(); } },
	theme: { key: 'glitter.theme', resetWith: editor => { editor.interfaceTheme = 'dark'; editor.applyInterfaceTheme(); } },
	toolbarPlacement: { key: 'glitter.toolbar-placement', resetWith: editor => editor.contextToolbarRenderer.resetPlacement() },
	brushSettings: { key: 'glitter.brush-settings', resetWith: editor => editor.maskEditor.resetToolSettingsToDefaults() },
	brushDynamics: { key: 'glitter.brush-dynamics', resetWith: editor => { editor.maskEditor.brushDynamics = {}; editor.maskEditor._saveBrushDynamics(); editor.maskEditor._syncDynamicsPanel(); } },
	panelWidths: { key: 'glitter.panel-widths', resetWith: () => Object.keys(PANEL_RESIZE_TARGETS).forEach(resetPanelWidth) },
	dockVisibility: { key: 'glitter.dock-visibility', resetWith: () => resetDockVisibility() },
	panelCards: { key: 'glitter.panel-cards', resetWith: () => resetPanelCardStates() }
});

// What the start screen found last time, so its first paint matches what the
// scripts will find (the head script in index.html applies them):
//   hasCamera    whether Take Photo was available
// Layout hints, not settings, so they stay out of STORAGE_KEYS and Reset.
const START_HINTS_KEY = 'glitter.start-hints';

// Set in sessionStorage when the Welcome is closed, so it stays closed for
// the rest of the tab's session, reloads included.
const WELCOME_CLOSED_KEY = 'glitter.welcome-closed';

function writeStartHint(name, value) {
	writeStored(START_HINTS_KEY, { ...readStored(START_HINTS_KEY, {}), [name]: value });
}

function readStored(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) return fallback;
		const value = JSON.parse(raw);
		if (fallback && typeof fallback === 'object' && (!value || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(fallback))) return fallback;
		return value;
	} catch { return fallback; }
}

function writeStored(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch { return false; }
}

function removeStored(key) {
	try { localStorage.removeItem(key); } catch { /* Storage can be blocked. */ }
}

function resetStoredSettings(editor) {
	Object.values(STORAGE_KEYS).forEach(spec => spec.resetWith(editor));
}
