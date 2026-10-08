'use strict';

const LAYER_ELEMENT_METHODS = {
	getActiveLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === this.constructor.LAYER_TYPE ? layer : null;
	},
	clearElements() {
		Array.from(this.layerElements.keys()).forEach(id => this.removeLayerElement(id));
	},
	removeLayerElement(layerId) {
		const transform = this.layerTransforms?.get(layerId);
		if (transform) {
			transform.destroy();
			this.layerTransforms.delete(layerId);
		}
		removeManagedLayerElement(this.layerElements, layerId);
	}
};
