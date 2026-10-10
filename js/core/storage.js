'use strict';

const STORAGE_KEYS = Object.freeze({
	preferences: { key: 'glitter.preferences', resetWith: editor => { PREFERENCES.resetAll(); editor.syncCanvasPreferenceControls(); } },
	exportSettings: { key: 'glitter.export-settings', resetWith: editor => { editor.settingsStore.reset(editor.exportSettings); editor.saveSettingsToStorage(); } },
	theme: { key: 'glitter.theme', resetWith: editor => { editor.interfaceTheme = 'dark'; editor.applyInterfaceTheme(); } },
	toolbarPlacement: { key: 'glitter.toolbar-placement', resetWith: editor => editor.contextToolbarRenderer.resetPlacement() },
	brushSettings: { key: 'glitter.brush-settings', resetWith: editor => editor.maskEditor.resetToolSettingsToDefaults() },
	brushDynamics: { key: 'glitter.brush-dynamics', resetWith: editor => { editor.maskEditor.brushDynamics = {}; editor.maskEditor._saveBrushDynamics(); editor.maskEditor._syncDynamicsPanel(); } },
	panelWidths: { key: 'glitter.panel-widths', resetWith: editor => { Object.keys(PANEL_RESIZE_TARGETS).forEach(resetPanelWidth); editor.libraryWindow.resetSplit(); } },
	panelCards: { key: 'glitter.panel-cards', resetWith: () => resetPanelCardStates() }
});

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
