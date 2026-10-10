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
			typeWord: 'sparkles layer',
			ensureSlot: (layer, key) => this.ensureSlot(layer, key),
			onPicked: (layer) => {
				this.editor.requestPreviewUpdate();
				this.loadLayerSettings(layer);
			}
		});
		// Per layer: the scene signature the host key uses, and the newer one
		// waiting out the settle delay, so dragging something below doesn't
		// re-detect the scene on every preview update.
		this.sceneKeys = new Map();
		this.pendingSceneKeys = new Map();
		this.sceneTimers = new Map();
		this.sceneCompositor = new SceneCompositor({
			editor,
			resolveShapeFillImage: (imageRef) => editor.shapeGlitterManager.getImageFillAsset(imageRef)
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
			getSlotDefaults: () => getSlotDefaults(LayerType.SPARKLES, 'sparkles'),
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
			armPicker: (key) => this.slotPicker.armPicker(key),
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

	// A new layer starts as the Winter Snow preset.

	ensureSlot(layer, key) {
		if (key !== 'sparkles' || !layer) return null;
		layer.sparkles ||= getSlotDefaults(LayerType.SPARKLES, 'sparkles');
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
			sparkles: getSlotDefaults(LayerType.SPARKLES, 'sparkles')
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

	// The whole canvas. Scatter covers the picture and Edges trace its border,
	// with no pixels; Highlights reads the scene below the layer.
	getSparkleHost(layer) {
		const size = this.getDocumentSize();
		if (!size) return null;
		if (layer?.sparkles?.emitter !== 'highlights') return { key: 'sparkle-layer', width: size.width, height: size.height, loadPixels: () => null };
		if (!this.sceneKeys.has(layer.id)) this.sceneKeys.set(layer.id, this.getSceneSignature(layer));
		return {
			key: `sparkle-scene:${layer.id}:${this.sceneKeys.get(layer.id)}`,
			width: size.width,
			height: size.height,
			loadPixels: () => this.composeScene(layer)
		};
	}

	// Every visible layer below this one except other Sparkles layers, so
	// stars aren't detected on stars.
	getSceneLayers(layer) {
		const index = this.editor.layers.indexOf(layer);
		return this.editor.layers.slice(0, Math.max(0, index)).filter((candidate) => candidate.type !== LayerType.SPARKLES
			&& candidate.visible && !candidate.isPreview && layerHasVisibleContent(candidate));
	}

	getSceneSignature(layer) {
		const signature = this.editor.filterLayerManager.getInputSignature(layer, this.getSceneLayers(layer));
		return GlitterAnimation.hashString(signature).toString(36);
	}

	// A changed scene moves the stars once it has been still for
	// sceneSettleMs; until then the old stars stay up.
	syncSceneKey(layer) {
		if (layer.sparkles?.emitter !== 'highlights') return;
		const signature = this.getSceneSignature(layer);
		if (!this.sceneKeys.has(layer.id) || this.sceneKeys.get(layer.id) === signature) {
			this.sceneKeys.set(layer.id, signature);
			this.clearPendingScene(layer.id);
			return;
		}
		if (this.pendingSceneKeys.get(layer.id) === signature) return;
		this.clearPendingScene(layer.id);
		this.pendingSceneKeys.set(layer.id, signature);
		this.sceneTimers.set(layer.id, setTimeout(() => {
			this.clearPendingScene(layer.id);
			this.sceneKeys.set(layer.id, signature);
			this.editor.requestPreviewUpdate();
		}, CONFIG.tools.sparkles.sceneSettleMs));
	}

	flushSceneKey(layer) {
		if (layer.sparkles?.emitter !== 'highlights') return;
		this.clearPendingScene(layer.id);
		this.sceneKeys.set(layer.id, this.getSceneSignature(layer));
	}

	clearPendingScene(layerId) {
		clearTimeout(this.sceneTimers.get(layerId));
		this.sceneTimers.delete(layerId);
		this.pendingSceneKeys.delete(layerId);
	}

	// The scene below, at document size. An animated scene is detected on the
	// mean of a few frames across its loop, as an animated sticker host is, so
	// the stars sit on persistently bright spots.
	async composeScene(layer) {
		const layers = this.getSceneLayers(layer);
		const size = this.getDocumentSize();
		if (!size) return null;
		const params = this.editor.filterLayerManager.buildSnapshotParams(layers);
		const preparedContext = await this.sceneCompositor.prepareContext(params);
		const estimate = await this.sceneCompositor.estimateLoopDuration({
			layers, library: this.editor.glitterLibrary.getRenderContent(),
			fallbackDuration: CONFIG.export.defaults.frameDelay,
			maxFrames: CONFIG.tools.sparkles.sceneSampleFrames, baseImage: true, baseAnimation: params.canvasData.baseAnimation
		});
		const count = Math.max(1, Math.min(CONFIG.tools.sparkles.sceneSampleFrames, estimate.estimatedFrameCount || 1));
		const frames = [];
		for (let index = 0; index < count; index++) {
			const { imageData } = await this.sceneCompositor.composeFrameAt({ ...params, preparedContext, timestamp: (estimate.duration || 0) * index / count });
			frames.push(readSparkleAnalysisPixels(imageData, size.width, size.height));
		}
		return frames.length > 1 ? GlitterHighlightDetect.meanFrames(frames) : frames[0];
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
		this.syncSceneKey(layer);
		reconcileSparkleLayers(host, layer, { editor: this.editor, width: size.width, height: size.height });
	}

	removeLayerElement(layerId) {
		LAYER_ELEMENT_METHODS.removeLayerElement.call(this, layerId);
		this.clearPendingScene(layerId);
		this.sceneKeys.delete(layerId);
	}

	releaseLayerResources(layer) {
		this.removeLayerElement(layer?.id);
	}

	clearElements() {
		LAYER_ELEMENT_METHODS.clearElements.call(this);
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
			// An export never waits out the settle delay: it detects on the scene
			// as it is now.
			prepareStaticResources: async () => this.flushSceneKey(layer),
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

SparkleLayerManager.LAYER_TYPE = LayerType.SPARKLES;
Object.assign(SparkleLayerManager.prototype, { getActiveLayer: LAYER_ELEMENT_METHODS.getActiveLayer });
