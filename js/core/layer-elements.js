function removeManagedLayerElement(elements, layerId) {
	const element = elements.get(layerId);
	element?.remove();
	elements.delete(layerId);
}

function reconcileLayerElements(elements, layers, type, render) {
	const relevantLayers = layers.filter((layer) => layer.type === type);
	const keep = new Set(relevantLayers.map((layer) => layer.id));
	[...elements.keys()].forEach((layerId) => {
		if (!keep.has(layerId)) removeManagedLayerElement(elements, layerId);
	});
	relevantLayers.forEach(render);
}
