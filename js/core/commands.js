const COMMANDS = {
	zoomIn: { run: (editor) => editor.viewport.zoomIn(null, null, { animate: true }) },
	zoomOut: { run: (editor) => editor.viewport.zoomOut(null, null, { animate: true }) },
	zoomReset: { run: (editor) => editor.viewport.resetZoom({ animate: true }) },
	zoomFit: { run: (editor) => editor.viewport.zoomToFit({ animate: true }) },
	zoomFill: { run: (editor) => editor.viewport.zoomToFill({ animate: true }) },
	centerCanvasH: { run: (editor) => editor.viewport.centerHorizontal({ animate: true }) },
	centerCanvasV: { run: (editor) => editor.viewport.centerVertical({ animate: true }) },
	centerSelectionH: { run: (editor) => centerSelection(editor, 'centerHorizontal', 'centerX') },
	centerSelectionV: { run: (editor) => centerSelection(editor, 'centerVertical', 'centerY') },
	duplicateSelection: { run: (editor) => editor.cloneSelectedLayers() }
};

function centerSelection(editor, method, groupAxis) {
	if (editor.layerManager.hasMultiSelection()) {
		if (!editor.layerManager.canTransformMultiSelection()) {
			editor.updateStatus('This selection cannot move because it includes a locked, Base Image, or Glitter Fill layer');
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
