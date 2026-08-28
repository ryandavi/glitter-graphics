const COMMANDS = {
	zoomIn: { label: 'Zoom In', group: 'View', keys: ['mod+=', 'mod+shift++'], displayKey: 'Ctrl/Cmd + +', run: (editor) => editor.viewport.zoomIn(null, null, { animate: true }) },
	zoomOut: { label: 'Zoom Out', group: 'View', keys: ['mod+-'], displayKey: 'Ctrl/Cmd + -', run: (editor) => editor.viewport.zoomOut(null, null, { animate: true }) },
	zoomReset: { label: 'Reset Zoom (100%)', group: 'View', keys: ['mod+1'], displayKey: 'Ctrl/Cmd + 1', run: (editor) => editor.viewport.resetZoom({ animate: true }) },
	zoomFit: { label: 'Fit Screen', group: 'View', keys: ['mod+0'], displayKey: 'Ctrl/Cmd + 0', run: (editor) => editor.viewport.zoomToFit({ animate: true }) },
	zoomFill: { run: (editor) => editor.viewport.zoomToFill({ animate: true }) },
	zoomSelection: {
		label: 'Zoom to Selection', group: 'View', keys: ['shift+2'], displayKey: 'Shift + 2',
		when: (editor) => editor.getSelectedActionableLayers().length > 0,
		run: (editor) => editor.zoomToSelection({ animate: true })
	},
	trackpadPan: { label: 'Pan Canvas', group: 'View', binding: { type: 'gesture', device: 'trackpad', gesture: 'Two-finger swipe' } },
	trackpadZoom: { label: 'Zoom Around Pointer', group: 'View', binding: { type: 'gesture', device: 'trackpad', gesture: 'Pinch' } },
	touchPan: { label: 'Pan Canvas', group: 'View', binding: { type: 'gesture', device: 'touch', gesture: 'Drag empty canvas' } },
	touchTransform: { label: 'Move, Scale, and Rotate Selection', group: 'Transform', binding: { type: 'gesture', device: 'touch', gesture: 'Two-finger transform' } },
	middleButtonPan: { label: 'Pan Canvas from Any Tool', group: 'View', binding: { type: 'gesture', device: 'pointer', gesture: 'Middle-button drag' } },
	scrubbyZoom: { label: 'Smooth Zoom with Zoom Tool', group: 'View', binding: { type: 'gesture', device: 'pointer', gesture: 'Drag right/up or left/down' } },
	fitToolGesture: { label: 'Fit Canvas to Workspace', group: 'View', binding: { type: 'gesture', device: 'pointer', gesture: 'Double-click Hand tool' } },
	resetToolGesture: { label: 'Reset Zoom to 100%', group: 'View', binding: { type: 'gesture', device: 'pointer', gesture: 'Double-click Zoom tool' } },
	centerCanvasH: { run: (editor) => editor.viewport.centerHorizontal({ animate: true }) },
	centerCanvasV: { run: (editor) => editor.viewport.centerVertical({ animate: true }) },
	centerSelectionH: { run: (editor) => centerSelection(editor, 'centerHorizontal', 'centerX') },
	centerSelectionV: { run: (editor) => centerSelection(editor, 'centerVertical', 'centerY') },
	duplicateSelection: {
		label: 'Duplicate Selected Layer(s)', group: 'Transform', keys: ['mod+d'], displayKey: 'Ctrl/Cmd + D',
		when: (editor) => editor.getSelectedActionableLayers().length > 0,
		run: (editor) => editor.cloneSelectedLayers()
	},
	copySelection: {
		label: 'Copy Selected Layer(s)', group: 'Clipboard', keys: ['mod+c'], displayKey: 'Ctrl/Cmd + C',
		when: (editor) => editor.getSelectedActionableLayers().length > 0,
		run: (editor) => copySelectedLayers(editor)
	},
	paste: {
		label: 'Paste Image or Layer(s)', group: 'Clipboard', displayKey: 'Ctrl/Cmd + V',
		instruction: 'Paste'
	},
	toolSelect: { label: 'Select Tool', group: 'Tools', keys: ['v'], displayKey: 'V', run: (editor) => editor.setTool(ToolType.SELECT) },
	toolText: { label: 'Text Tool', group: 'Tools', keys: ['t'], displayKey: 'T', when: (editor) => Boolean(editor.originalImage), run: (editor) => editor.setTool(ToolType.TEXT) },
	toolShape: { label: 'Shape Tool', group: 'Tools', keys: ['u'], displayKey: 'U', when: (editor) => Boolean(editor.originalImage), run: (editor) => editor.setTool(ToolType.SHAPE) },
	toolColorFill: { label: 'Color Fill Tool', group: 'Tools', keys: ['i'], displayKey: 'I', when: (editor) => Boolean(editor.originalImage), run: (editor) => editor.setTool(ToolType.COLOR_PICKER) },
	toolBrush: { label: 'Mask Brush Tool', group: 'Tools', keys: ['b'], displayKey: 'B', run: (editor) => { editor.setTool(ToolType.BRUSH); editor.maskEditor?.setMode('add'); } },
	toolEraser: { label: 'Mask Eraser Tool', group: 'Tools', keys: ['e'], displayKey: 'E', run: (editor) => { editor.setTool(ToolType.BRUSH); editor.maskEditor?.setMode('sub'); } },
	toolHand: { label: 'Hand Tool', group: 'Tools', keys: ['h'], displayKey: 'H', when: (editor) => Boolean(editor.originalImage), run: (editor) => editor.setTool(ToolType.HAND) },
	toolZoom: { label: 'Zoom Tool', group: 'Tools', keys: ['z'], displayKey: 'Z', when: (editor) => Boolean(editor.originalImage), run: (editor) => editor.setTool(ToolType.ZOOM) },
	selectAll: {
		label: 'Select All Movable Layers', group: 'Selection', keys: ['mod+a'], displayKey: 'Ctrl/Cmd + A',
		run: (editor) => {
			const ids = editor.layerManager.layers.filter((layer) => !layer.locked && layer.type !== LayerType.BASE_IMAGE).map((layer) => layer.id);
			if (ids.length) editor.layerManager.setSelection(ids, { activeLayerId: ids[ids.length - 1] });
		}
	},
	deleteSelection: { label: 'Delete Selected Layer(s)', group: 'Transform', keys: ['Delete', 'Backspace'], displayKey: 'Delete / Backspace', when: (editor) => editor.getSelectedActionableLayers().length > 0, run: (editor) => editor.deleteSelectedLayers() },
	swapBrushMode: { label: 'Swap Paint/Erase (Mask Brush)', group: 'Brush', keys: ['x'], displayKey: 'X', when: (editor) => editor.currentTool === ToolType.BRUSH, run: (editor) => editor.maskEditor?.toggleMode() },
	brushSetPaint: { run: (editor) => editor.maskEditor?.setMode('add') },
	brushSetErase: { run: (editor) => editor.maskEditor?.setMode('sub') },
	brushSizeDown: { label: 'Decrease Brush Size', group: 'Brush', keys: ['BracketLeft', 'shift+BracketLeft'], displayKey: '[ / Shift + [', when: (editor) => editor.currentTool === ToolType.BRUSH, run: (editor, event) => editor.maskEditor?.adjustBrushSize(event.shiftKey ? -10 : -5) },
	brushSizeUp: { label: 'Increase Brush Size', group: 'Brush', keys: ['BracketRight', 'shift+BracketRight'], displayKey: '] / Shift + ]', when: (editor) => editor.currentTool === ToolType.BRUSH, run: (editor, event) => editor.maskEditor?.adjustBrushSize(event.shiftKey ? 10 : 5) },
	saveProject: { label: 'Save Project', group: 'File', keys: ['mod+s'], displayKey: 'Ctrl/Cmd + S', allowWhileTyping: true, run: (editor) => editor.saveProjectFile() },
	undo: { label: 'Undo', group: 'History', keys: ['mod+z'], displayKey: 'Ctrl/Cmd + Z', allowWhileTyping: true, run: (editor) => editor.undo() },
	redo: { label: 'Redo', group: 'History', keys: ['mod+shift+z', 'mod+y'], displayKey: 'Ctrl/Cmd + Shift + Z / Ctrl/Cmd + Y', allowWhileTyping: true, run: (editor) => editor.redo() },
	temporaryHand: { label: 'Temporarily Use Hand Tool', group: 'View', displayKey: 'Space', instruction: 'Hold' },
	nudge: { label: 'Nudge Selected Layer', group: 'Transform', displayKey: 'Arrow Keys' },
	nudgeFast: { label: 'Nudge Selected Layer 10px', group: 'Transform', displayKey: 'Shift + Arrow Keys' },
	clearSelection: { label: 'Cancel Active Transform / Clear Multi-Selection', group: 'Selection', displayKey: 'Escape' },
	duplicateDrag: { label: 'Duplicate Layer(s) While Dragging', group: 'Transform', binding: { type: 'gesture', device: 'pointer', gesture: 'Drag', modifiers: ['alt'] } },
	axisLock: { label: 'Axis-lock Selected Layer Move', group: 'Transform', binding: { type: 'gesture', device: 'pointer', gesture: 'Drag', modifiers: ['shift'] } },
	disableSnapping: { label: 'Temporarily Disable Snapping', group: 'Transform', instruction: 'Hold', binding: { type: 'gesture', device: 'pointer', gesture: 'Drag', modifiers: ['control'] } },
	snapRotation: { label: 'Snap Rotation to 15deg', group: 'Transform', binding: { type: 'gesture', device: 'pointer', gesture: 'Rotate', modifiers: ['shift'] } },
	resizeCenter: { label: 'Resize Layer(s) from Center', group: 'Transform', binding: { type: 'gesture', device: 'pointer', gesture: 'Resize', modifiers: ['alt'] } }
};


const SHORTCUT_GROUP_ALIASES = Object.freeze({
	File: 'Essentials',
	History: 'Essentials',
	Clipboard: 'Essentials',
	View: 'Canvas & View'
});

function isGestureCommand(command) {
	return command.binding?.type === 'gesture';
}

function getShortcutGroups(kind = 'keyboard') {
	const groups = new Map();
	Object.values(COMMANDS).filter((command) => {
		if (!command.label) return false;
		return kind === 'gesture' ? isGestureCommand(command) : Boolean(command.displayKey) && !isGestureCommand(command);
	}).forEach((command) => {
		const group = kind === 'gesture'
			? (command.group === 'Transform' ? 'Move & Transform' : 'Navigate')
			: (SHORTCUT_GROUP_ALIASES[command.group] || command.group);
		if (!groups.has(group)) groups.set(group, []);
		groups.get(group).push(command);
	});
	const order = kind === 'gesture'
		? ['Navigate', 'Move & Transform']
		: ['Essentials', 'Tools', 'Canvas & View', 'Selection', 'Transform', 'Brush'];
	const rank = (title) => {
		const index = order.indexOf(title);
		return index === -1 ? order.length : index;
	};
	return Array.from(groups, ([title, items]) => ({ title, items }))
		.sort((a, b) => rank(a.title) - rank(b.title));
}

function centerSelection(editor, method, groupAxis) {
	if (editor.layerManager.hasMultiSelection()) {
		if (!editor.layerManager.canTransformMultiSelection()) {
			editor.showError('This selection cannot move because it includes a locked, Base Image, or Fill layer');
			return;
		}
		editor.groupTransformManager?.alignToCanvas(groupAxis);
		return;
	}
	const layer = editor.layerManager.getActiveLayer();
	if (!editor.canEditLayer(layer, { notify: true })) return;
	const context = editor.getMovableLayerContext(layer);
	context?.manager?.[method]?.(layer.id);
}
