'use strict';

// An edit session owns its keys; adding a session adds no command dispatch branch.
// A session with steps of its own returns them from `history` ({ undo, redo,
// canUndo, canRedo }) and takes Undo and Redo for as long as it lasts.
const SESSIONS = Object.freeze([
	{ id: 'autoGlitter', isActive: editor => editor.autoGlitterManager.isSessionActive(),
		cancel: editor => editor.autoGlitterManager.requestDiscardSession(),
		allows: (editor, command) => command.group === 'View' || (command.group === 'Tools' && editor.autoGlitterManager.allowsPreviewTool(command.tool)) },
	{ id: 'crop', isActive: (editor) => editor.currentTool === ToolType.CROP && Boolean(editor.canvasBounds), mode: { label: 'Crop', icon: 'crop' }, confirm: (editor) => editor.applyCanvasBounds(), cancel: (editor) => editor.cancelCanvasBounds({ keepTool: true }), nudge: (editor, event) => editor.cropEdit.nudge(event), history: (editor) => editor.canvasBounds },
	{ id: 'textEdit', isActive: (editor) => Boolean(editor.textGlitterManager?.editSession),
		mode: { label: 'Text', icon: 'text' }, end: editor => editor.textGlitterManager.endTextEdit(), cancel: (editor) => editor.textGlitterManager.endTextEdit() },
	{ id: 'pathEdit', isActive: (editor) => Boolean(editor.pathEdit?.session),
		mode: { label: 'Pen', icon: 'pen' }, canConfirm: (editor) => editor.pathEdit?.canHandleEnter(),
		confirm: (editor) => editor.pathEdit.handleEnter(), cancel: (editor) => editor.pathEdit.handleEscape(),
		delete: (editor) => editor.pathEdit.deleteSelection(), nudge: (editor, event) => editor.pathEdit.nudge(event),
		shortcuts: [
			{ label: 'Delete Selected Points / Last Point While Drawing', group: 'Pen', displayKey: 'Delete / Backspace' },
			{ label: 'Nudge Selected Points', group: 'Pen', displayKey: 'Arrow Keys' },
			{ label: 'Nudge Selected Points 10px', group: 'Pen', displayKey: 'Shift + Arrow Keys' },
			{ label: 'Finish Path / Edit Selected Path', group: 'Pen', displayKey: 'Enter' },
			{ label: 'Finish Path / Clear Point Selection', group: 'Pen', displayKey: 'Escape' }
		] }
]);

function getSessionDefinition(editor, handler) {
	return SESSIONS.find((session) => session.isActive(editor) || (handler === 'confirm' && session.canConfirm?.(editor))) || null;
}

function dispatchSessionKey(editor, handler, event) {
	return getSessionDefinition(editor, handler)?.[handler]?.(editor, event);
}

function sessionAllowsCommand(editor, command) {
	return getSessionDefinition(editor)?.allows?.(editor, command) !== false;
}

const ESCAPE_HANDLERS = Object.freeze([
	{ id: 'field', handle: () => {
		const active = document.activeElement;
		if (!focusKeyClaim().typing && !active?.closest('.effect-gradient-editor')) return false;
		active.blur();
		return true;
	} },
	{ id: 'modal', handle: editor => editor.modalManager.closeTopModal() },
	{ id: 'sheet', handle: editor => {
		if (!editor.mobileManager?.isMobile || !editor.mobileManager.activeDrawer) return false;
		editor.mobileManager.closeAllDrawers();
		return true;
	} },
	{ id: 'picker', handle: editor => editor.pickers.closeActive() },
	{ id: 'drag', handle: editor => {
		if (editor.maskEditor.strokeActive) { editor.maskEditor._cancelStroke(); return true; }
		if (editor.pathEdit.session?.drag) { editor.pathEdit.cancelDrag(); return true; }
		if (editor.cropEdit.drag) { editor.cropEdit.cancelDrag(); return true; }
		const layer = editor.layerManager.getActiveLayer();
		const transform = editor.getMovableLayerContext(layer)?.manager?.layerTransforms?.get(layer?.id);
		return editor.groupTransformManager.cancelActiveDrag() || transform?.cancelActiveDrag();
	} },
	{ id: 'session', handle: editor => {
		const session = getSessionDefinition(editor);
		if (!session?.cancel) return false;
		session.cancel(editor);
		return true;
	} },
	{ id: 'selection', handle: editor => {
		if (!editor.layerManager.getSelectedLayers().length) return false;
		editor.layerManager.clearSelection();
		return true;
	} }
]);

function handleEscape(editor, event) {
	const handled = ESCAPE_HANDLERS.some(entry => entry.handle(editor, event));
	if (handled) event.preventDefault();
	return handled;
}
