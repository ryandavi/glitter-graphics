'use strict';

registerLayerType(LayerType.FILTER, {
	describe: (layer) => ({ name: layer.name || 'Filter', detail: `Filter · ${GlitterFilter.summaryText(layer.filterData)}` }),
	displayName: 'Filter',
	hasVisibleContent: (layer) => GlitterFilter.isActive(layer.filterData, layer.opacity),
	serialization: {
		dataKey: 'filterData',
		omit: ['settings'],
		defaultName: () => 'Filter',
		normalize: (editor, layer) => editor.filterLayerManager?.normalizeLayer(layer)
	},
	addedStatusMessage: 'New filter layer added',
	addableViaModal: {
		label: 'Filter',
		icon: 'sliders',
		group: 'effects',
		order: 1,
		description: 'Adjust the appearance of every layer below'
	},
	elementClass: 'filter-layer-overlay',
	transformable: true,
	lockScope: 'position',
	lockedOnCreate: true,
	pickedOnCanvas: true,
	transformPrefix: 'filter',
	transformCapabilities: { position: true, size: true, edgeResize: true, rotation: false, flip: false, align: true, opacity: true, reset: true },
	frame: (editor, layer) => editor.filterLayerManager.getFrameBox(layer),
	elementBox: (editor, layer) => editor.filterLayerManager.getFrameBox(layer),
	resetGeometry: (_editor, layer) => { layer.filterData.region = null; },
	hasResettableGeometry: layer => Boolean(layer.filterData.region),
	defaultTransform: (editor) => {
		return createDefaultTransform({ position: { x: editor.originalCanvas.width / 2, y: editor.originalCanvas.height / 2 } });
	},
	hitTest: (editor, layer, x, y, tolerance) => editor.filterLayerManager.hitTest(layer, x, y, tolerance),
	hitTestBehind: (editor, layer, x, y) => editor.filterLayerManager.hitTestBehind(layer, x, y),
	// A pixel size of 1 means off; only a real mosaic rescales. Pixelate keeps
	// it in `size`, which Grain and Light Leak also use for other units.
	fields: [
		{ path: 'filterData.region.width', documentScale: 'geometry', documentScaleAxis: 'x', minimum: 1, when: (value, layer) => Boolean(layer.filterData.region) },
		{ path: 'filterData.region.height', documentScale: 'geometry', documentScaleAxis: 'y', minimum: 1, when: (value, layer) => Boolean(layer.filterData.region) },
		{ path: 'filterData.size', field: 'pixelEffectsPixelSize', documentScale: 'effect', when: (value, layer) => layer.filterData?.type === 'pixelate' && value > 1 },
		{ path: 'filterData.pixelSize', field: 'pixelEffectsPixelSize', documentScale: 'effect', when: (value) => value > 1 }
	],
	managerKey: 'filterLayerManager',
	timelineSources: (layer, context) => context.compositor._createFilterTimelineSources(layer),
	blendable: true,
	renderSwatch: (layer, context) => {
		const thumbnail = document.createElement('span');
		GlitterFilter.renderCssThumbnail(thumbnail, layer.filterData, layer.opacity / 100);
		context.swatch.classList.add('filter');
		context.swatch.append(thumbnail);
		return true;
	},
	openOnCreate: 'panel',
	toolsOnSelect: []
});
