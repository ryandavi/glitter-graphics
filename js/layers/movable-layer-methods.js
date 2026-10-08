'use strict';

const MOVABLE_LAYER_METHODS = {
	centerHorizontal(layerId) {
		movableCenterHorizontal(this, layerId, layer => this.loadLayerSettings(layer));
	},
	centerVertical(layerId) {
		movableCenterVertical(this, layerId, layer => this.loadLayerSettings(layer));
	},
	alignToCanvas(layerId, mode) {
		movableAlignToCanvas(this, layerId, mode, layer => this.loadLayerSettings(layer));
	},
	resetTransform(layerId) {
		movableResetTransform(this, layerId, layer => this.loadLayerSettings(layer));
	},
	createTransformHandles(layerId) {
		movableCreateTransformHandles(this, layerId);
	},
	removeTransformHandles() {
		movableRemoveTransformHandles(this);
	}
};
