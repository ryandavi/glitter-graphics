// ============================================
// SPARKLE LAYER MANAGER
// ============================================
// Sparkles layers (js/layers/types/sparkles.js): a canvas-sized host whose
// only content is one sparkles slot, for whole-picture weather in front of
// everything. The slot, engine and panel card are the Sparkles effect's
// (js/paint/sparkles.js); this manager only hosts them.

class SparkleLayerManager {
	constructor(editor) {
		this.editor = editor;
		this.layerElements = new Map();
		this.layerTransforms = new Map();
		this.slotPicker = new SlotGlitterPicker(editor, {
			type: LayerType.SPARKLES,
			defaultSlot: 'sparkles',
			section: 'sparkleLayerSettings',
			typeWord: 'sparkles layer',
			ensureSlot: (layer, key) => this.ensureSlot(layer, key),
			onPicked: (layer) => {
				this.editor.requestPreviewUpdate();
				this.loadLayerSettings(layer);
			}
		});
		this.fieldHost = this.createFieldHost();
		bindFieldControls(this.fieldHost);
		this.setupOpacity();
	}

	createFieldHost() {
		return {
			type: LayerType.SPARKLES,
			editor: this.editor,
			getLayer: () => this.getActiveLayer(),
			ensureSlot: (layer, key) => this.ensureSlot(layer, key),
			getSlotDefaults: () => this.getDefaultSparkles(),
			apply: (layer, mutate, change) => {
				mutate();
				this.editor.requestPreviewUpdate();
				if (change.live) return;
				this.loadLayerSettings(layer);
				this.editor.layerManager.renderLayersList();
				this.editor.saveState('Edit sparkles');
			},
			render: () => this.editor.requestPreviewUpdate(),
			commit: () => this.editor.saveState('Edit sparkles'),
			armPicker: (key) => this.slotPicker.arm(key),
			getArmedSlot: (layer) => this.slotPicker.getArmedSlot(layer)
		};
	}

	setupOpacity() {
		const control = document.getElementById('sparkleLayerOpacity');
		if (!control) return;
		bindSlider(control, document.getElementById('sparkleLayerOpacityValue'), {
			resetValue: FIELDS.layerOpacity.value,
			resetButton: document.getElementById('resetSparkleLayerOpacity'),
			apply: (value) => {
				const layer = this.getActiveLayer();
				if (!layer) return;
				layer.opacity = value;
				this.editor.requestPreviewUpdate();
			},
			onCommit: () => this.editor.saveState('Edit sparkles')
		});
	}

	getActiveLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === LayerType.SPARKLES ? layer : null;
	}

	// A new layer starts as the Winter Snow preset.
	getDefaultSparkles() {
		const data = buildDefaultSparkles();
		SPARKLE_PRESETS.apply('winter-snow', data);
		return data;
	}

	ensureSlot(layer, key) {
		if (key !== 'sparkles' || !layer) return null;
		layer.sparkles ||= this.getDefaultSparkles();
		return layer.sparkles;
	}

	createLayer() {
		if (!this.editor.layerManager.requireLayerCapacity()) return null;
		return this.normalizeLayer({
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.SPARKLES,
			name: 'Sparkles',
			visible: true,
			locked: false,
			opacity: FIELDS.layerOpacity.value,
			sparkles: this.getDefaultSparkles()
		});
	}

	normalizeLayer(layer) {
		if (layer?.type !== LayerType.SPARKLES) return null;
		const opacity = Number(layer.opacity);
		layer.opacity = Number.isFinite(opacity) ? opacity : FIELDS.layerOpacity.value;
		layer.sparkles = normalizeSparklesData(layer.sparkles);
		return layer;
	}

	// The export composes at the original canvas size, so the host box does too.
	getDocumentSize() {
		const canvas = this.editor.originalCanvas?.width ? this.editor.originalCanvas : this.editor.previewCanvas;
		return canvas?.width && canvas?.height ? { width: canvas.width, height: canvas.height } : null;
	}

	// The whole canvas, with no pixels of its own: Scatter covers the picture
	// and Edges trace its border.
	getSparkleHost() {
		const size = this.getDocumentSize();
		return size ? { key: 'sparkle-layer', width: size.width, height: size.height, loadPixels: () => null } : null;
	}

	renderContent(layersToShow) {
		reconcileLayerElements(this.layerElements, layersToShow, LayerType.SPARKLES, (layer) => this.renderLayer(layer));
	}

	renderLayer(layer) {
		const size = this.getDocumentSize();
		if (!size) return;
		let host = this.layerElements.get(layer.id);
		if (!host) {
			host = document.createElement('div');
			host.className = 'sparkle-host-element sparkle-layer-element ui-ignore-gestures';
			host.dataset.layerId = layer.id;
			this.editor.canvasElementsContainer.appendChild(host);
			this.layerElements.set(layer.id, host);
		}
		host.style.width = `${size.width}px`;
		host.style.height = `${size.height}px`;
		host.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);
		host.style.opacity = String(layer.opacity / 100);
		host.style.mixBlendMode = GlitterBlendModes.forLayer(layer);
		reconcileSparkleLayers(host, layer, { editor: this.editor, width: size.width, height: size.height });
	}

	removeLayerElement(layerId) {
		removeManagedLayerElement(this.layerElements, layerId);
	}

	releaseLayerResources(layer) {
		this.removeLayerElement(layer?.id);
	}

	clearElements() {
		this.layerElements.forEach((element) => element.remove());
		this.layerElements.clear();
	}

	loadLayerSettings(layer) {
		if (layer?.type !== LayerType.SPARKLES) return;
		writeSliderValue(document.getElementById('sparkleLayerOpacity'), layer.opacity);
		syncFieldControls(this.fieldHost, layer);
		syncPropertyReverts();
	}

	// Particles over the whole canvas, in document px, faded by the layer
	// opacity as the preview host is.
	buildExportPlan(layer, context) {
		const compositor = context.compositor;
		return {
			prepareMasks: async () => {},
			prepareStaticResources: async () => {},
			getAuthoredSources: (library) => compositor._getSlotAuthoredSources(layer, library),
			render: ({ ctx, frameIndex, timestamp, sourceSelectionMap, resolvedFramesBySource, width, height }) => {
				const host = getSparkleHost(this.editor, layer);
				if (!host) return;
				ctx.save();
				ctx.globalAlpha *= layer.opacity / 100;
				const frame = { frameIndex, timestamp, sourceSelectionMap, resolvedFramesBySource };
				const placement = { scaleX: width / Math.max(1, host.width), scaleY: height / Math.max(1, host.height) };
				compositor._drawLayerSparkles(ctx, layer, 'behind', frame, placement);
				compositor._drawLayerSparkles(ctx, layer, 'front', frame, placement);
				ctx.restore();
			}
		};
	}
}
