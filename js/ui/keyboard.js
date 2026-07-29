'use strict';

function normalizeShortcutEvent(event) {
	const parts = [];
	if (event.ctrlKey || event.metaKey) parts.push('mod');
	if (event.shiftKey) parts.push('shift');
	if (event.altKey) parts.push('alt');
	const key = event.code === 'BracketLeft' || event.code === 'BracketRight'
		? event.code
		: event.key.length === 1 ? event.key.toLowerCase() : event.key;
	parts.push(key);
	return parts.join('+');
}

function matchShortcut(event) {
	const combo = normalizeShortcutEvent(event);
	return Object.values(COMMANDS).find((command) => command.keys?.includes(combo)) || null;
}

function dispatchKeyboardCommand(editor, event, { isTyping = false } = {}) {
	const command = matchShortcut(event);
	if (!command || (isTyping && !command.allowWhileTyping) || command.when?.(editor, event) === false) return false;
	event.preventDefault();
	command.run(editor, event);
	return true;
}
