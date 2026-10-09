const COMMANDS = {
	canvasBoundsRatioMenu: { run: (editor) => editor.openCanvasBoundsMenu('contextCropRatio', getCanvasRatioOptions(editor), (id) => editor.setCanvasBoundsRatio(id)) },
	canvasBoundsFitMenu: { run: (editor) => editor.openCanvasBoundsMenu('contextCropFit', CANVAS_BOUNDS_SOURCES, (id) => editor.ensureCanvasBounds().setSource(id)) },
	canvasBoundsApply: { run: (editor) => editor.applyCanvasBounds() },
	canvasBoundsCancel: { run: (editor) => editor.cancelCanvasBounds() },
	canvasBoundsSwap: { run: (editor) => editor.ensureCanvasBounds().swapOrientation() },
	documentScaleApply: { run: (editor) => editor.applyScaleDesign() },
	documentScaleReset: { run: (editor) => editor.setDocumentScale(editor.documentSizeDefaults().scale) },
	removeBackground: { label: 'Remove background', group: 'Sticker', when: editor => editor.stickerManager.canRemoveBackground(), run: editor => editor.stickerManager.removeBackground() },
	recolorGlitter: { label: 'Recolor a glitter', group: 'Library', run: (editor, target) => editor.glitterRecolor.command(target) },
	copyStyleAsPreset: {
		label: 'Copy style as preset', group: 'Text',
		when: editor => CONFIG.debug.enabled && Boolean(editor.textGlitterManager?.getActiveTextLayer()),
		async run(editor) {
			const manager = editor.textGlitterManager;
			const layer = manager?.getActiveTextLayer();
			if (!CONFIG.debug.enabled || !layer) return;
			try {
				const entry = createStylePresetEntryFromLayer(layer, key => getSlotDefaults(layer.type, key));
				await navigator.clipboard.writeText(JSON.stringify(entry, null, '\t') + ',');
				editor.updateStatus('Style preset copied');
			} catch (error) {
				editor.showError('Could not copy style preset: ' + error.message);
			}
		}
	},
	textFontSize: { run: (editor, value) => editor.textGlitterManager.runTextCommand('size', value) },
	textToggleBold: { label: 'Toggle Bold', group: 'Text', keys: ['mod+b'], displayKey: 'Ctrl/Cmd + B', allowWhileTyping: true, when: editor => Boolean(editor.textGlitterManager?.getActiveTextLayer()), run: editor => editor.textGlitterManager.runTextCommand('bold') },
	textToggleItalic: { label: 'Toggle Italic', group: 'Text', keys: ['mod+i'], displayKey: 'Ctrl/Cmd + I', allowWhileTyping: true, when: editor => Boolean(editor.textGlitterManager?.getActiveTextLayer()), run: editor => editor.textGlitterManager.runTextCommand('italic') },
	textToggleUnderline: { label: 'Toggle Underline', group: 'Text', keys: ['mod+u'], displayKey: 'Ctrl/Cmd + U', allowWhileTyping: true, when: editor => Boolean(editor.textGlitterManager?.getActiveTextLayer()), run: editor => editor.textGlitterManager.runTextCommand('underline') },
	textToggleStrikethrough: { label: 'Toggle Strikethrough', group: 'Text', allowWhileTyping: true, when: editor => Boolean(editor.textGlitterManager?.getActiveTextLayer()), run: editor => editor.textGlitterManager.runTextCommand('strikethrough') },
	textAlignLeft: { label: 'Align Text Left', group: 'Text', run: editor => editor.textGlitterManager.runTextCommand('align', 'left') },
	textAlignCenter: { label: 'Align Text Center', group: 'Text', run: editor => editor.textGlitterManager.runTextCommand('align', 'center') },
	textAlignRight: { label: 'Align Text Right', group: 'Text', run: editor => editor.textGlitterManager.runTextCommand('align', 'right') },
	textAlignJustify: { label: 'Align Text Justify', group: 'Text', run: editor => editor.textGlitterManager.runTextCommand('align', 'justify') },
	splitText: { label: 'Split Text', group: 'Text', run: editor => editor.textGlitterManager.openTextMenu('textSplit', ['characters', 'words', 'lines'].map(mode => ({ label: mode[0].toUpperCase() + mode.slice(1), run: () => editor.textGlitterManager.splitText(mode) }))) },
	zoomIn: { label: 'Zoom In', group: 'View', keys: ['mod+=', 'mod+shift++'], displayKey: 'Ctrl/Cmd + +', run: (editor) => editor.viewport.zoomIn(null, null, { animate: true }) },
	zoomOut: { label: 'Zoom Out', group: 'View', keys: ['mod+-'], displayKey: 'Ctrl/Cmd + -', run: (editor) => editor.viewport.zoomOut(null, null, { animate: true }) },
	zoomReset: { label: 'Reset Zoom (100%)', group: 'View', keys: ['mod+1'], displayKey: 'Ctrl/Cmd + 1', run: (editor) => editor.viewport.resetZoom({ animate: true }) },
	zoomFit: { label: 'Fit Screen', group: 'View', keys: ['mod+0'], displayKey: 'Ctrl/Cmd + 0', run: (editor) => editor.viewport.zoomToFit({ animate: true }) },
	zoomFill: { run: (editor) => editor.viewport.zoomToFill({ animate: true }) },
	toggleMemoryOverlay: {
		label: 'Toggle Memory Overlay', group: 'View', keys: ['mod+shift+alt+m'], displayKey: 'Ctrl/Cmd + Alt + Shift + M',
		run: (editor) => {
			if (!CONFIG.debug.enabled) {
				editor.updateStatus('Memory overlay is available when debug mode is enabled');
				return;
			}
			APP_MEMORY_LEDGER.toggleOverlay();
		}
	},
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
	flipHorizontal: {
		label: 'Flip Horizontal', group: 'Transform', keys: ['shift+h'], displayKey: 'Shift + H',
		when: (editor) => editor.getSelectedActionableLayers().length === 1 && Boolean(editor.getMovableLayerContext(editor.layerManager.getActiveLayer())),
		run: (editor) => flipActiveLayer(editor, 'flipX')
	},
	flipVertical: {
		label: 'Flip Vertical', group: 'Transform', keys: ['shift+v'], displayKey: 'Shift + V',
		when: (editor) => editor.getSelectedActionableLayers().length === 1 && Boolean(editor.getMovableLayerContext(editor.layerManager.getActiveLayer())),
		run: (editor) => flipActiveLayer(editor, 'flipY')
	},
	copySelection: {
		label: 'Copy Selected Layer(s)', group: 'Clipboard', keys: ['mod+c'], displayKey: 'Ctrl/Cmd + C',
		when: (editor) => !window.getSelection()?.toString() && editor.getSelectedActionableLayers().length > 0,
		run: (editor) => copySelectedLayers(editor)
	},
	paste: {
		label: 'Paste Image, Layer(s) or Text', group: 'Clipboard', displayKey: 'Ctrl/Cmd + V',
		instruction: 'Paste'
	},
	librarySearch: { label: 'Search the Library', group: 'View', keys: ['/', 'shift+/'], displayKey: '/',
		when: (editor) => editor.libraryWindow.isOpen,
		run: () => focusLibrarySearch() },
	...Object.fromEntries(Object.entries(TOOLS).flatMap(([tool, definition]) => [
		[definition.command, { tool, label: `${definition.name} Tool`, group: 'Tools', keys: [definition.key], displayKey: definition.key.toUpperCase(),
			when: (editor) => editor.autoGlitterManager?.isSessionActive()
				? Boolean(editor.originalImage) && editor.autoGlitterManager.allowsPreviewTool(tool)
				: definition.available(editor, { hasImage: Boolean(editor.originalImage), autoPreviewActive: false }),
			run: (editor) => { editor.setTool(tool); definition.onShortcut?.(editor); } }],
		...(definition.shortcuts || []).map((shortcut) => [shortcut.command, { ...shortcut, tool, group: 'Tools', keys: [shortcut.key], displayKey: shortcut.key.toUpperCase() }])
	])),
	selectAll: {
		label: 'Select All Movable Layers', group: 'Selection', keys: ['mod+a'], displayKey: 'Ctrl/Cmd + A',
		run: (editor) => {
			const ids = editor.layerManager.layers.filter((layer) => !layer.locked && layer.type !== LayerType.BASE_IMAGE).map((layer) => layer.id);
			if (ids.length) editor.layerManager.setSelection(ids, { activeLayerId: ids[ids.length - 1] });
		}
	},
	sessionDelete: { label: 'Delete session selection', keys: ['Delete', 'Backspace'], when: (editor) => Boolean(getSessionDefinition(editor)?.delete), run: (editor, event) => dispatchSessionKey(editor, 'delete', event) },
	sessionConfirm: { label: 'Finish editing', keys: ['Enter'], when: (editor) => Boolean(getSessionDefinition(editor, 'confirm')?.confirm), run: (editor, event) => dispatchSessionKey(editor, 'confirm', event) },
	sessionCancel: { label: 'Cancel editing', keys: ['Escape'], allowWhileTyping: true, when: (editor) => Boolean(getSessionDefinition(editor)?.cancel), run: (editor, event) => dispatchSessionKey(editor, 'cancel', event) },
	pathToggleClosed: { run: (editor) => editor.pathEdit.toggleClosed() },
	pathPointCorner: { run: (editor) => editor.pathEdit.setSelectionType('corner') },
	pathPointSmooth: { run: (editor) => editor.pathEdit.setSelectionType('smooth') },
	pathPointMirrored: { run: (editor) => editor.pathEdit.setSelectionType('mirrored') },
	pathNextCorner: { run: (editor) => editor.pathEdit.setNextPointType('corner') },
	pathNextCurve: { run: (editor) => editor.pathEdit.setNextPointType('curve') },
	pathConstrain: { label: 'Constrain Segment or Handle to 45deg', group: 'Pen', binding: { type: 'gesture', device: 'pointer', gesture: 'Draw or drag a handle', modifiers: ['shift'] } },
	pathBreakHandles: { label: 'Break a Handle Pair', group: 'Pen', binding: { type: 'gesture', device: 'pointer', gesture: 'Drag a handle', modifiers: ['alt'] } },
	pathInsertPoint: { label: 'Add a Point', group: 'Pen', binding: { type: 'gesture', device: 'pointer', gesture: 'Click a segment' } },
	pathBendSegment: { label: 'Bend a Segment', group: 'Pen', binding: { type: 'gesture', device: 'pointer', gesture: 'Drag a segment' } },
	pathTogglePoint: { label: 'Switch a Point Between Corner and Smooth', group: 'Pen', binding: { type: 'gesture', device: 'pointer', gesture: 'Double-click a point' } },
	convertShapeToPath: {
		label: 'Convert Shape to Path', group: 'Pen',
		when: (editor) => editor.layerManager.getActiveLayer()?.type === LayerType.SHAPE && !editor.layerManager.hasMultiSelection(),
		run: (editor) => editor.pathLayerManager.convertShapeLayer(editor.layerManager.getActiveLayer())
	},
	deleteSelection: { label: 'Delete Selected Layer(s)', group: 'Transform', keys: ['Delete', 'Backspace'], displayKey: 'Delete / Backspace', when: (editor) => editor.getSelectedActionableLayers().length > 0, run: (editor) => editor.deleteSelectedLayers() },
	swapBrushMode: { label: 'Swap Paint/Erase (Glitter Brush)', group: 'Brush', keys: ['x'], displayKey: 'X', when: (editor) => editor.currentTool === ToolType.BRUSH, run: (editor) => editor.maskEditor?.toggleMode() },
	brushSetPaint: { run: (editor) => editor.maskEditor?.setMode('add') },
	brushSetErase: { run: (editor) => editor.maskEditor?.setMode('sub') },
	brushSizeDown: { label: 'Decrease Brush Size', group: 'Brush', keys: ['BracketLeft', 'shift+BracketLeft'], displayKey: '[ / Shift + [', when: (editor) => editor.currentTool === ToolType.BRUSH, run: (editor, event) => editor.maskEditor?.adjustBrushSize(event.shiftKey ? -10 : -5) },
	brushSizeUp: { label: 'Increase Brush Size', group: 'Brush', keys: ['BracketRight', 'shift+BracketRight'], displayKey: '] / Shift + ]', when: (editor) => editor.currentTool === ToolType.BRUSH, run: (editor, event) => editor.maskEditor?.adjustBrushSize(event.shiftKey ? 10 : 5) },
	saveProject: { label: 'Save Project', group: 'File', keys: ['mod+s'], displayKey: 'Ctrl/Cmd + S', allowWhileTyping: true, run: (editor) => editor.saveProjectFile() },
	undo: { label: 'Undo', group: 'History', keys: ['mod+z'], displayKey: 'Ctrl/Cmd + Z', allowWhileTyping: true, run: (editor) => editor.undo() },
	redo: { label: 'Redo', group: 'History', keys: ['mod+shift+z', 'mod+y'], displayKey: 'Ctrl/Cmd + Shift + Z / Ctrl/Cmd + Y', allowWhileTyping: true, run: (editor) => editor.redo() },
	temporaryHand: { label: 'Temporarily Use Hand Tool', group: 'View', displayKey: 'Space', instruction: 'Hold' },
	nudge: { label: 'Nudge Selected Layer', group: 'Transform', displayKey: 'Arrow Keys', keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'shift+ArrowLeft', 'shift+ArrowRight', 'shift+ArrowUp', 'shift+ArrowDown'], when: (editor, event) => (!focusClaimsArrowKey(event.key) || (editor.currentTool === ToolType.SELECT && document.activeElement === editor.textGlitterManager?.ui?.textInput)) && Boolean(editor.originalImage), run: (editor, event) => getSessionDefinition(editor)?.nudge ? dispatchSessionKey(editor, 'nudge', event) : editor.tryArrowNudge(event) },
	nudgeFast: { label: 'Nudge Selected Layer 10px', group: 'Transform', displayKey: 'Shift + Arrow Keys' },
	gradientStopNudge: { label: 'Move Focused Gradient Stop 1%', group: 'Gradient', displayKey: 'Arrow Keys' },
	gradientStopNudgeSnap: { label: 'Move Focused Gradient Stop 5%', group: 'Gradient', displayKey: 'Shift + Arrow Keys' },
	gradientStopDelete: { label: 'Delete Focused Gradient Stop', group: 'Gradient', displayKey: 'Delete / Backspace' },
	clearSelection: { label: 'Cancel Current Action / Clear Selection', group: 'Selection', displayKey: 'Escape' },
	duplicateDrag: { label: 'Duplicate Layer(s) While Dragging', group: 'Transform', binding: { type: 'gesture', device: 'pointer', gesture: 'Drag', modifiers: ['alt'] } },
	gradientStopDuplicateDrag: { label: 'Duplicate Gradient Stop While Dragging', group: 'Transform', binding: { type: 'gesture', device: 'pointer', gesture: 'Drag gradient stop', modifiers: ['alt'] } },
	gradientStopSnapDrag: { label: 'Snap Gradient Stop to 5% Steps', group: 'Transform', binding: { type: 'gesture', device: 'pointer', gesture: 'Drag gradient stop', modifiers: ['shift'] } },
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
	[...Object.values(COMMANDS), ...SESSIONS.flatMap((session) => session.shortcuts || [])].filter((command) => {
		if (!command.label) return false;
		return kind === 'gesture' ? isGestureCommand(command) : Boolean(command.displayKey) && !isGestureCommand(command);
	}).forEach((command) => {
		const group = kind === 'gesture'
			? ({ Transform: 'Move & Transform', Pen: 'Pen' }[command.group] || 'Navigate')
			: (SHORTCUT_GROUP_ALIASES[command.group] || command.group);
		if (!groups.has(group)) groups.set(group, []);
		groups.get(group).push(command);
	});
	const order = kind === 'gesture'
		? ['Navigate', 'Move & Transform', 'Pen']
		: ['Essentials', 'Tools', 'Canvas & View', 'Selection', 'Transform', 'Brush', 'Pen', 'Gradient'];
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
			editor.showError('This selection cannot move because it includes a locked, pinned, empty, or Base Image layer');
			return;
		}
		editor.groupTransformManager?.alignToCanvas(groupAxis);
		return;
	}
	const layer = editor.layerManager.getActiveLayer();
	if (!editor.canTransformLayer(layer, { notify: true })) return;
	const context = editor.getMovableLayerContext(layer);
	context?.manager?.[method]?.(layer.id);
}

function flipActiveLayer(editor, property) {
	const layer = editor.layerManager.getActiveLayer();
	const context = editor.getMovableLayerContext(layer);
	if (!context || !editor.canTransformLayer(layer, { notify: true })) return;
	const transform = getLayerTransform(layer);
	editor.applyTransformEditWithAnchor(layer, context.manager, () => context.manager.updateTransform(layer.id, {
		[property]: !transform[property]
	}));
	editor.loadTransformSettings(layer, context.prefix);
	editor.saveState('Transform layer');
}
