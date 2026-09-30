'use strict';

// Shared lifecycle for generators that stage real layer objects on the canvas
// before one commit. The isPreview flag is the contract consumed by history,
// export, project save and the layers list.
const PreviewLayerSession = Object.freeze({
	stage(layer) {
		if (layer) layer.isPreview = true;
		return layer;
	},

	commit(layers) {
		(layers || []).forEach((layer) => { delete layer.isPreview; });
	},

	remove(editor, layers, release = true) {
		const ids = new Set((layers || []).map((layer) => layer.id));
		if (release) {
			(layers || []).forEach((layer) => getLayerManagerForType(editor, layer.type)?.releaseLayerResources?.(layer));
		}
		editor.layers = editor.layers.filter((layer) => !ids.has(layer.id));
	}
});
