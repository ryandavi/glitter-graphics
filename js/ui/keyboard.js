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

// Several commands may share a key (Delete removes path points in a path
// session and layers otherwise): the first whose `when` holds runs.
function dispatchKeyboardCommand(editor, event, { isTyping = false } = {}) {
	const combo = normalizeShortcutEvent(event);
	const command = Object.values(COMMANDS).find((candidate) => candidate.keys?.includes(combo)
		&& !(isTyping && !candidate.allowWhileTyping)
		&& candidate.when?.(editor, event) !== false);
	if (!command) return false;
	event.preventDefault();
	command.run(editor, event);
	return true;
}
