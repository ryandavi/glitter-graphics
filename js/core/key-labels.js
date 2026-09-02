'use strict';

// Platform key vocabulary, shared by the Commands & Shortcuts modal
// (js/ui/editor-disclosures.js) and the guide (js/ui/modals-wiring.js) so the
// two never disagree about what a modifier is called on this machine.
//
// Bindings are authored with the generic names below — 'Ctrl/Cmd' for the
// primary accelerator, 'Alt' for the option key — and resolved to native labels
// at render time. Nothing stores a resolved label; search still matches the
// generic names, so "Cmd" finds a binding on Windows and vice versa.

const KEY_LABELS_MAC = Object.freeze({
	'Ctrl/Cmd': '⌘', Cmd: '⌘', Command: '⌘',
	Control: '⌃', Ctrl: '⌃',
	Alt: '⌥', Option: '⌥',
	Shift: '⇧'
});

const KEY_LABELS_PC = Object.freeze({
	'Ctrl/Cmd': 'Ctrl', Cmd: 'Ctrl', Command: 'Ctrl',
	Control: 'Ctrl', Ctrl: 'Ctrl',
	Alt: 'Alt', Option: 'Alt',
	Shift: 'Shift'
});

function isMacPlatform() {
	const platform = navigator.userAgentData?.platform || navigator.platform || '';
	return /mac/i.test(platform);
}

function getKeyLabels() {
	return isMacPlatform() ? KEY_LABELS_MAC : KEY_LABELS_PC;
}

// Anything that isn't a modifier (letters, digits, Space, Escape) is already
// native and passes through untouched.
function formatKeyLabel(label, labels = getKeyLabels()) {
	return labels[label] || label;
}

// Rewrites authored key names in already-rendered markup. Used on the guide,
// whose prose is static HTML: `.guide-kbd` is a visible key chip, and
// `.guide-key-label` marks a key named inline in a sentence, where a chip would
// break the surrounding voice.
function localizeKeyLabels(root) {
	if (!root) return;
	const labels = getKeyLabels();
	root.querySelectorAll('.guide-kbd, .guide-key-label').forEach((node) => {
		const authored = node.dataset.key || node.textContent.trim();
		// Remember what was authored so a re-run stays idempotent and so search
		// over the guide still sees the generic name.
		node.dataset.key = authored;
		node.textContent = formatKeyLabel(authored, labels);
	});
}
