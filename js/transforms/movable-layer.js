'use strict';

function runMovableTransform(manager, layerId, action, refresh) {
	const transform = manager.layerTransforms.get(layerId);
	if (!transform) return;
	transform[action]();
	const layer = manager.editor.layerManager.getLayerById(layerId);
	if (layer) refresh(layer);
}

function movableCenterHorizontal(manager, layerId, refresh) {
	runMovableTransform(manager, layerId, 'centerHorizontal', refresh);
}

function movableCenterVertical(manager, layerId, refresh) {
	runMovableTransform(manager, layerId, 'centerVertical', refresh);
}

function movableAlignToCanvas(manager, layerId, mode, refresh) {
	const transform = manager.layerTransforms.get(layerId);
	if (!transform) return;
	transform.alignToCanvas(mode);
	const layer = manager.editor.layerManager.getLayerById(layerId);
	if (layer) refresh(layer);
}

function movableResetTransform(manager, layerId, refresh) {
	runMovableTransform(manager, layerId, 'resetTransform', refresh);
}

function movableCreateTransformHandles(manager, layerId) {
	manager.layerTransforms.forEach((transform, candidateId) => {
		if (candidateId !== layerId) transform.removeTransformHandles();
	});
	manager.layerTransforms.get(layerId)?.createTransformHandles();
}

function movableRemoveTransformHandles(manager) {
	manager.layerTransforms.forEach((transform) => transform.removeTransformHandles());
}
