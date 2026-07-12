const COMMANDS = {
	zoomIn: { run: (editor) => editor.viewport.zoomIn() },
	zoomOut: { run: (editor) => editor.viewport.zoomOut() },
	zoomReset: { run: (editor) => editor.viewport.resetZoom() },
	zoomFit: { run: (editor) => editor.viewport.zoomToFit() },
	zoomFill: { run: (editor) => editor.viewport.zoomToFill() },
	centerCanvasH: { run: (editor) => editor.viewport.centerHorizontal() },
	centerCanvasV: { run: (editor) => editor.viewport.centerVertical() },
	centerSelectionH: { run: (editor) => centerSelection(editor, 'centerHorizontal', 'centerX') },
	centerSelectionV: { run: (editor) => centerSelection(editor, 'centerVertical', 'centerY') },
	duplicateSelection: { run: (editor) => editor.cloneSelectedLayers() }
};

function centerSelection(editor, method, groupAxis) {
	if (editor.layerManager.hasMultiSelection()) {
		editor.groupTransformManager?.alignToCanvas(groupAxis);
		return;
	}
	const layer = editor.layerManager.getActiveLayer();
	const context = editor.getMovableLayerContext(layer);
	context?.manager?.[method]?.(layer.id);
}
