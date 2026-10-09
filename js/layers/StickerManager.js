// ============================================
// STICKER MANAGER CLASS
// Handles all sticker-related operations
// Now uses LayerTransform for all transform operations
// ============================================
class StickerManager {

	constructor(editor) {
		this.editor = editor;

		this.layerElements = new Map();

		// Store LayerTransform instances for each layer
		this.layerTransforms = new Map(); // layerId -> LayerTransform
		this.pickerSession = null;
		this.slotPicker = createManagerSlotPicker(this, {
			type: LayerType.STICKER, defaultSlot: null, typeWord: 'sticker',
			onPicked: (layer, id) => {
				this.renderLayer(layer);
				this.loadLayerSettings(layer);
			}
		});
		this.effectMaskCache = new Map();
	}

	getLayerType() {
		return LayerType.STICKER;
	}

	renderContent(layersToShow) {
		reconcileLayerElements(
			this.layerElements,
			layersToShow,
			this.getLayerType(),
			(layer) => this.renderLayer(layer)
		);
	}

	setupUI() {
		this.ui = {
			fitCanvas: document.getElementById('stickerFitCanvas'),
			fillCanvas: document.getElementById('stickerFillCanvas'),
			assetThumbnail: document.getElementById('stickerAssetThumbnail')
		};
		this.ui.gallerySection = document.getElementById('designGallerySection');
		this.ui.resetEffects = document.getElementById('resetStickerEffects');
	}

	// How the declared field binder (ui/paint-slot-controls.js) edits a sticker:
	// its image color adjust and its shadow and sparkles slots.
	createFieldHost() {
		return {
			type: LayerType.STICKER,
			editor: this.editor,
			getLayer: () => {
				const layer = this.editor.layerManager.getActiveLayer();
				return layer?.type === LayerType.STICKER ? layer : null;
			},
			ensureSlot: (layer, key) => ensureLayerPaintSlot(layer, key, () => getSlotDefaults(LayerType.STICKER, key)),
			getSlotDefaults: (key) => getSlotDefaults(LayerType.STICKER, key),
			apply: (layer, mutate, change) => {
				mutate();
				this.renderLayer(layer);
				if (change.live) return;
				this.loadLayerSettings(layer);
				this.editor.saveState('Edit sticker');
			},
			render: (layer) => this.renderLayer(layer),
			commit: () => this.editor.saveState('Edit sticker'),
			armPicker: (key) => this.armPicker(key),
			afterFieldChange: (layer, key, binding) => {
				if (!key && binding.colorAdjust) this.refreshColorAdjustVisuals(layer);
			}
		};
	}

	setupEventListeners() {
		document.getElementById('stickerRemoveBackground')?.addEventListener('click', () => COMMANDS.removeBackground.run(this.editor));

		this.ui.fitCanvas?.addEventListener('click', () => this.scaleActiveStickerToCanvas('fit'));
		this.ui.fillCanvas?.addEventListener('click', () => this.scaleActiveStickerToCanvas('fill'));
		this.fieldHost = this.createFieldHost();
		bindFieldControls(this.fieldHost);
		[
			['stickerBorderFillInterior', 'fillInterior'],
			['stickerBorderUnionFrames', 'unionFrames']
		].forEach(([id, property]) => document.getElementById(id)?.addEventListener('change', (event) => {
			const layer = this.fieldHost.getLayer();
			if (!layer) return;
			this.fieldHost.apply(layer, () => {
				this.fieldHost.ensureSlot(layer, 'border')[property] = event.target.checked;
			}, { geometry: true });
		}));
		document.getElementById('stickerSliceEnabled')?.addEventListener('change', (event) => {
			const layer = this.fieldHost.getLayer();
			if (!layer?.stickerData.slice || !this.editor.canEditLayer(layer, { notify: true })) return;
			layer.stickerData.sliceEnabled = event.target.checked;
			this.renderLayer(layer);
			this.editor.requestPreviewUpdate();
			this.editor.saveState('Edit sticker');
		});
		this.ui.resetEffects?.addEventListener('click', () => {
			const layer = this.fieldHost.getLayer();
			if (!layer) return;
			layer.stickerData.shadow = null;
			layer.stickerData.border = null;
			layer.stickerData.bevel = buildDefaultBevel();
			layer.stickerData.sparkles = null;
			delete layer.stickerData.effectDrafts;
			this.renderLayer(layer);
			this.loadLayerSettings(layer);
			this.editor.saveState('Edit sticker');
		});

	}

	refreshColorAdjustVisuals(layer) {
		const filter = buildCssColorFilter(layer?.stickerData?.colorAdjust);
		const image = this.layerElements.get(layer?.id)?.querySelector('img.sticker-image');
		if (image) image.style.filter = filter;
		this.layerElements.get(layer?.id)?.querySelectorAll('.sticker-slices').forEach((group) => { group.style.filter = filter; });
		if (this.ui.assetThumbnail && this.editor.layerManager.getActiveLayer()?.id === layer?.id) {
			this.ui.assetThumbnail.style.filter = filter;
		}
		this.editor.refreshLayerSwatchFilter(layer);
	}

	// 'fit' = contain (whole sticker visible), 'fill' = cover (canvas fully
	// covered). Both center the sticker and scale proportionally.
	scaleActiveStickerToCanvas(mode) {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.STICKER || layer.stickerData?.isEmpty) return;
		const width = Math.max(1, layer.stickerData.width);
		const height = Math.max(1, layer.stickerData.height);
		const pick = mode === 'fill' ? Math.max : Math.min;
		const scale = clampLayerScale(pick(
			this.editor.originalCanvas.width / width,
			this.editor.originalCanvas.height / height
		) * 100);
		this.updateTransform(layer.id, {
			position: { x: this.editor.originalCanvas.width / 2, y: this.editor.originalCanvas.height / 2 },
			scale: { x: scale, y: scale },
			proportionalScale: true
		});
		this.editor.loadTransformSettings(layer, 'sticker');
		this.editor.saveState('Edit sticker');
	}

	armPicker(slot) {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.STICKER || !getLayerPaintSlot(layer, slot)) return;
		pickerOpenSession(this, { kind: 'glitter', layerId: layer.id, slot }, {
			reveal: () => revealAssetBrowser(this.editor, this.editor.glitterLibrary, getLayerPaintSlot(layer, slot)?.glitterId)
		});
	}

	armAssetPicker() {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.STICKER) return;
		pickerOpenSession(this, { kind: 'asset', layerId: layer.id, library: 'sticker', label: 'Sticker' }, {
			reveal: () => revealAssetBrowser(this.editor, this.editor.stickerLibrary, layer.stickerSourceId)
		});
	}

	handlePickerDone() {
		this.closePicker();
	}

	closePicker() {
		const focusId = this.pickerSession?.kind === 'glitter'
			? getPaintSlotChipId(LayerType.STICKER, this.pickerSession.slot)
			: 'stickerAssetThumbnail';
		this.closePickerSession();
		returnFromPickerToProperties(this.editor, { section: 'stickerSettings', focusId });
	}

	closePickerSession() {
		pickerCloseSession(this, { updateSelection: () => this.editor.updateGlitterSelection() });
	}

	// The slot the next gallery pick targets, or null when none is armed (a
	// sticker has no fill slot to fall back to).
	getGlitterSelectionTarget(layer = this.editor.layerManager.getActiveLayer()) {
		return pickerArmedSlot(this, layer, (session) => session.kind !== 'asset');
	}

	resolveSelectedGlitterId(layer) {
		return getLayerPaintSlot(layer, this.getGlitterSelectionTarget(layer))?.glitterId ?? null;
	}

	loadLayerSettings(layer) {
		if (layer?.type !== LayerType.STICKER) return;
		const removeButton = document.getElementById('stickerRemoveBackground');
		if (removeButton) removeButton.hidden = !this.canRemoveBackground(layer);
		if (this.editor.layerManager.getActiveLayer() === layer) {
			const contextButton = document.getElementById('contextRemoveBackground');
			if (contextButton) contextButton.hidden = !this.canRemoveBackground(layer);
		}
		this.editor.loadTransformSettings(layer, 'sticker');
		const asset = this.editor.stickerLibrary.getItemById(layer.stickerSourceId);
		if (asset) this.editor.updateStickerAssetInfo(asset);
		if (this.pickerSession && this.pickerSession.layerId !== layer.id) this.closePicker();
		syncFieldControls(this.fieldHost, layer);
		const sliceToggle = document.getElementById('stickerSliceEnabled');
		if (sliceToggle) {
			sliceToggle.closest('label').hidden = !layer.stickerData.slice;
			sliceToggle.checked = layer.stickerData.sliceEnabled !== false;
		}
		const unionFrames = document.getElementById('stickerBorderUnionFrames');
		if (unionFrames) {
			unionFrames.checked = layer.stickerData.border?.unionFrames ?? CONFIG.tools.stickers.outline.useAllFrames;
			unionFrames.disabled = !layer.stickerData.isAnimated;
		}
		const fillInterior = document.getElementById('stickerBorderFillInterior');
		if (fillInterior) fillInterior.checked = layer.stickerData.border?.fillInterior ?? CONFIG.tools.stickers.outline.fillInterior;
		this.refreshColorAdjustVisuals(layer);
	}

	// Canvas pixels the effect masks extend past the displayed sticker on each
	// side. Slot textures register against it, in the preview and in export.
	getEffectPadding(layer) {
		const scale = getLayerTransform(layer).scale;
		const box = { x: 0, y: 0, width: Math.max(1, Math.round(layer.stickerData.width * Math.max(0.01, Math.abs(scale.x) / 100))), height: Math.max(1, Math.round(layer.stickerData.height * Math.max(0.01, Math.abs(scale.y) / 100))) };
		const shadow = layer.stickerData.shadow;
		const shadowPad = getShadowKind(shadow) === 'drop' ? getShadowReach(shadow) : getShadowCanvasPadding(shadow, box);
		return Math.ceil(Math.max(layer.stickerData.border?.widthPx || 0, shadowPad, layer.stickerData.bevel?.enabled ? 2 : 0));
	}

	// Effects rasterize at the displayed sticker size, and their sizes are
	// canvas pixels: a 1px outline is one canvas pixel at any sticker scale.
	reconcileStickerEffectSpans(layer, element, img) {
		if (!img.complete || !img.naturalWidth) return;
		const transform = getLayerTransform(layer);
		const scaleX = Math.max(0.01, Math.abs(transform.scale.x) / 100);
		const scaleY = Math.max(0.01, Math.abs(transform.scale.y) / 100);
		const width = Math.max(1, Math.round(layer.stickerData.width * scaleX));
		const height = Math.max(1, Math.round(layer.stickerData.height * scaleY));
		const pad = this.getEffectPadding(layer);
		const source = createAppCanvas(width + pad * 2, height + pad * 2, 'layers/StickerManager');
		const sourceCtx = source.getContext('2d', { willReadFrequently: true, alpha: true });
		const unionKey = `${layer.stickerData.baseUrl || layer.stickerData.url}:${width}x${height}`;
		const union = layer.stickerData.border?.unionFrames ? this.effectMaskCache.get(unionKey) : null;
		sourceCtx.imageSmoothingEnabled = layer.stickerData.isPixelated === false;
		if (union) this.drawStickerImage(sourceCtx, union, layer, width, height, pad);
		else {
			this.drawStickerImage(sourceCtx, img, layer, width, height, pad);
			if (layer.stickerData.border?.unionFrames) this.ensureStickerUnionMask(layer, unionKey);
		}
		if (shouldUseCrispMaskEdges()) binarizeCanvasAlpha(sourceCtx);
		source._textureOrigin = { x: -pad, y: -pad };
		source._shadowBounds = { x: pad, y: pad, width, height };
		const existing = new Map(Array.from(element.querySelectorAll('.sticker-effect-layer')).map((span) => [span.dataset.spanKey, span]));
		let bevelMasks = null;
		buildSlotStack(layer, (entry) => resolvePaintSlotPreviewSource(this.editor, layer, entry)).forEach((item) => {
			let mask = source;
			if (item.role === 'shadow') mask = createShadowSlotMaskCanvas(source, item.data);
			if (item.role === 'border') mask = createOutlineMaskCanvas(source, item.data.widthPx, getBorderEdgeStyle(item.data), item.data.fillInterior, item.data.fillEnclosed);
			if (item.role === 'bevel') {
				bevelMasks ||= createBevelMaskCanvases(source, layer.stickerData.bevel.highlight);
				mask = item.key === 'bevelShade' ? bevelMasks.shade : bevelMasks.highlight;
			}
			let span = existing.get(item.key);
			if (!span) {
				span = document.createElement('span');
				span.className = `sticker-effect-layer sticker-effect-${item.role}`;
				span.dataset.spanKey = item.key;
				element.appendChild(span);
			}
			applySlotSpanMask(span, source.width, source.height, mask.toDataURL('image/png'));
			span.style.left = `${-pad}px`;
			span.style.top = `${-pad}px`;
			span.dataset.effectScaleX = scaleX;
			span.dataset.effectScaleY = scaleY;
			span.dataset.effectOffsetX = item.offsetX || 0;
			span.dataset.effectOffsetY = item.offsetY || 0;
			this.syncStickerEffectSpan(layer, span);
			span.style.imageRendering = item.role === 'border' && getBorderEdgeStyle(item.data) === 'hard' ? 'pixelated' : '';
			applyPaintSourceToElement(span, item.source, { glitterLibrary: this.editor.glitterLibrary, layer, maskCanvas: mask });
			existing.delete(item.key);
		});
		existing.forEach((span) => span.remove());
	}

	// Effect masks are expensive distance-field rasters, so resize their last
	// crisp result with the sticker during a live gesture (the shadow offset
	// stretches with it). The settled render rebuilds them at the exact final
	// size, with effect sizes back in canvas pixels.
	syncElementScale(layer, element) {
		const img = element.querySelector('img.sticker-image');
		if (img) this.reconcileSliceSpans(layer, element, img);
		element.querySelectorAll('.sticker-effect-layer').forEach((span) => {
			this.syncStickerEffectSpan(layer, span);
		});
	}

	syncStickerEffectSpan(layer, span) {
		const transform = getLayerTransform(layer);
		const scaleX = Math.max(0.01, Math.abs(transform.scale.x) / 100);
		const scaleY = Math.max(0.01, Math.abs(transform.scale.y) / 100);
		const rasterScaleX = Number(span.dataset.effectScaleX) || scaleX;
		const rasterScaleY = Number(span.dataset.effectScaleY) || scaleY;
		const centerShiftX = layer.stickerData.width * (scaleX - rasterScaleX) / 2;
		const centerShiftY = layer.stickerData.height * (scaleY - rasterScaleY) / 2;
		const ratioX = scaleX / rasterScaleX;
		const ratioY = scaleY / rasterScaleY;
		const offsetX = centerShiftX + ((Number(span.dataset.effectOffsetX) || 0) * ratioX);
		const offsetY = centerShiftY + ((Number(span.dataset.effectOffsetY) || 0) * ratioY);
		span.style.transformOrigin = 'center';
		span.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${ratioX}, ${ratioY})`;
	}

	async ensureStickerUnionMask(layer, key) {
		if (this.effectMaskCache.has(key) || this.effectMaskCache.has(`${key}:loading`)) return;
		this.effectMaskCache.set(`${key}:loading`, true);
		try {
			const decoded = await decodeGifFromUrl(layer.stickerData.baseUrl || layer.stickerData.url);
			const union = createAppCanvas(decoded.width, decoded.height, 'layers/StickerManager');
			const unionCtx = union.getContext('2d', { willReadFrequently: true, alpha: true });
			const frameCanvas = createAppCanvas(decoded.width, decoded.height, 'layers/StickerManager');
			const frameCtx = frameCanvas.getContext('2d', { alpha: true });
			decoded.frames.forEach((frame) => {
				frameCtx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
				frameCtx.putImageData(frame.imageData, 0, 0);
				unionCtx.drawImage(frameCanvas, 0, 0);
			});
			this.effectMaskCache.set(key, union);
			while (this.effectMaskCache.size > CONFIG.memory.stickerEffectMaskCacheEntries) {
				const oldest = this.effectMaskCache.keys().next().value;
				this.effectMaskCache.delete(oldest);
			}
			this.renderLayer(layer);
		} catch (error) {
			console.warn('Could not build animated sticker outline union:', error);
		} finally {
			this.effectMaskCache.delete(`${key}:loading`);
		}
	}

	// ===== LOADING =====

	// ===== UPLOAD HANDLING =====

	// The admin decides is_pixelated for library assets, but an upload never
	// passes through it, so it classifies itself with the same weighted model.
	// The rules and weights are fetched from data/rendering-rules.json rather
	// than restated here — a second copy of the numbers is exactly the drift
	// this is meant to prevent. If they cannot be loaded the upload keeps the
	// pixelated default instead of guessing.

	// Mirrors GifAnalyzer::renderingVerdict(). Two differences are inherent and
	// harmless: canvas reports alpha on 0-255 where GD uses 0-127, so the level
	// count here is finer against the same floor, and an animated upload is
	// read from its first frame rather than a sample of three — a GIF's
	// indexed_gif weight settles it either way.

	// ===== LAYER CREATION =====

	async createStickerLayer(stickerSourceId) {
		const sticker = await this.editor.stickerLibrary.ensureAssetDetails(stickerSourceId);
		if (!sticker) {
			console.error('Sticker not found:', stickerSourceId);
			return null;
		}

		// Use factory method
		const layer = this.createLayer(stickerSourceId);
		if (!layer) return null;  // Factory returns null if max reached

		// Add to layer manager
		this.editor.layerManager.insertLayer(layer);
		this.editor.layerManager.setActiveLayer(layer.id);
		this.editor.layerManager.renderLayersList();

		// Render the sticker
		this.renderLayer(layer);

		// Save state
		this.editor.saveState('Edit sticker');
		this.editor.updateActionButtons();

		return layer;
	}

	createLayer(stickerSourceId = null) {
		if (!this.editor.layerManager.requireLayerCapacity()) return null;
		const sticker = stickerSourceId ? this.editor.stickerLibrary.getItemById(stickerSourceId) : null;
		const transform = createDefaultTransform({
			position: {
				x: this.editor.originalCanvas.width / 2,
				y: this.editor.originalCanvas.height / 2
			}
		});

		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: this.getLayerType(),
			name: sticker?.name || 'New Sticker',
			visible: true,
			locked: false,
			opacity: FIELDS.layerOpacity.value,
			blendMode: CONFIG.layers.defaultBlendMode,
			stickerSourceId: stickerSourceId,
			transform,

			stickerData: {
				isEmpty: !sticker,
				url: sticker?.url || null,
				// Fixed canonical/native-resolution source; `url` is the
				// currently-displayed source and may be swapped to a variant.
				// See StickerManager.commitResolutionSwap.
				baseUrl: sticker?.url || null,
				variantUrls: sticker?.variantUrls || null,
				name: sticker?.name || 'Select a Sticker',
				source: sticker?.source || null,
				isAnimated: sticker?.isAnimated || false,
				isPixelated: sticker?.isPixelated !== false,
				frameCount: sticker?.frameCount || 1,
				slice: normalizeSlice(sticker?.slice, sticker?.width, sticker?.height),
				sliceEnabled: Boolean(sticker?.slice),
				width: sticker?.width || 100,
				height: sticker?.height || 100,
				colorAdjust: { ...COLOR_ADJUST_IDENTITY },
				element: null,
				maskEnabled: false,
				shadow: null,
				border: null,
				bevel: buildDefaultBevel()
			}
		};

		return layer;
	}

	canRemoveBackground(layer = this.editor.layerManager.getActiveLayer()) {
		const item = this.editor.stickerLibrary.getItemById(layer?.stickerSourceId);
		return CONFIG.tools.backgroundRemoval.enabled && layer?.type === LayerType.STICKER
			&& !this.editor.layerManager.hasMultiSelection() && !this.editor.isLayerContentLocked(layer)
			&& item?.source === 'user-upload' && !item.backgroundRemoved && !item.isAnimated && ['image/png', 'image/jpeg'].includes(item.mimeType);
	}

	async removeBackground() {
		if (this.backgroundRemovalLoading || !this.canRemoveBackground()) return;
		const layer = this.editor.layerManager.getActiveLayer();
		const item = this.editor.stickerLibrary.getItemById(layer.stickerSourceId);
		if (item.width * item.height > CONFIG.tools.backgroundRemoval.maxInputPixels) {
			this.editor.showError('This image is too large to remove its background. Try a smaller image.');
			return;
		}
		this.backgroundRemovalLoading = true;
		try {
			await loadScriptOnce('js/systems/BackgroundRemover.js?v=d2ed8cbf');
			this.backgroundRemover ||= new BackgroundRemover(this.editor);
			await this.backgroundRemover.run(layer, item);
		} catch (error) { this.editor.showError(error.message); }
		finally { this.backgroundRemovalLoading = false; }
	}

	async replaceWithCutout(layer, originalId, item) {
		await AssetImageCache.get(item.url);
		if (!this.editor.layerManager.layers.includes(layer) || layer.stickerSourceId !== originalId || !this.editor.canEditLayer(layer)) throw new Error('The sticker changed. Run Remove background again.');
		layer.stickerSourceId = item.id;
		Object.assign(layer.stickerData, {
			baseUrl: item.url, url: item.url, variantUrls: null, name: item.name, source: item.source,
			width: item.width, height: item.height, isAnimated: false, frameCount: 1,
			staticImageData: null, slice: null, sliceEnabled: false
		});
		this.renderLayer(layer);
		this.editor.layerManager.renderLayersList();
		this.editor.requestPreviewUpdate();
		this.editor.updateStickerSelection();
		if (this.editor.layerManager.getActiveLayer() === layer) this.loadLayerSettings(layer);
		this.editor.saveState('Remove background');
		this.editor.updateStatus('Background removed');
	}

	// A Library pick replaces the selected sticker. It never adds a layer.
	async pickLibrarySticker(stickerId) {
		if (!this.editor.originalImage) {
			this.editor.showError('Please load an image first');
			return;
		}

		const activeLayer = this.editor.layerManager.getActiveLayer();
		if (activeLayer?.type !== LayerType.STICKER) {
			this.editor.updateStatus('Select a sticker before choosing one from the Library');
			return;
		}
		const stickerInfo = await this.editor.stickerLibrary.ensureAssetDetails(stickerId);

		if (!stickerInfo) return;

		if (!this.editor.canEditLayer(activeLayer, { notify: true })) return;
		const scalePercent = activeLayer.transform?.scale?.x ?? 100;
		const renderedWidth = stickerInfo.width * (scalePercent / 100);
		const nextUrl = StickerVariants.pickBestUrl(
			stickerInfo.url, stickerInfo.width, stickerInfo.variantUrls, renderedWidth
		);
		try {
			await AssetImageCache.get(nextUrl);
		} catch (error) {
			this.editor.showError('Unable to load that sticker');
			return;
		}
		// Replace the sticker in the current layer
		activeLayer.name = stickerInfo.name;
		activeLayer.stickerSourceId = stickerInfo.id;

		// Update data
		activeLayer.stickerData.isEmpty = false;
		activeLayer.stickerData.baseUrl = stickerInfo.url;
		activeLayer.stickerData.variantUrls = stickerInfo.variantUrls || null;
		activeLayer.stickerData.name = stickerInfo.name;
		activeLayer.stickerData.source = stickerInfo.source;
		activeLayer.stickerData.width = stickerInfo.width;
		activeLayer.stickerData.height = stickerInfo.height;
		activeLayer.stickerData.isAnimated = stickerInfo.isAnimated;
		activeLayer.stickerData.isPixelated = stickerInfo.isPixelated !== false;
		activeLayer.stickerData.frameCount = stickerInfo.frameCount || 1;
		activeLayer.stickerData.slice = normalizeSlice(stickerInfo.slice, stickerInfo.width, stickerInfo.height);
		activeLayer.stickerData.sliceEnabled = Boolean(activeLayer.stickerData.slice);

		// Pick the resolution that matches the layer's current (possibly
		// scaled-up) size, not always the base — same rule commitResolutionSwap
		// applies after a resize gesture.
		activeLayer.stickerData.url = nextUrl;

		// Clear the cached still frame when changing sticker
		activeLayer.stickerData.staticImageData = null;

		// New sticker → its colors are unrelated to the old ones, so a prior
		// hue/sat/bright tweak would apply to the wrong palette. Reset it.
		activeLayer.stickerData.colorAdjust = { ...COLOR_ADJUST_IDENTITY };

		// Render
		this.renderLayer(activeLayer);
		this.editor.layerManager.renderLayersList();
		this.editor.updateStickerSelection();
		this.editor.updateStatus('Sticker replaced');
		this.editor.saveState('Edit sticker');

		// Hide empty state and load settings
		this.editor.setSettingsEmptyState('stickerSettings', false);
		this.loadLayerSettings(activeLayer);
	}

	// ===== RESIZE COMMIT =====

	// Settle a finished resize (LayerTransform.commitScaleChange). With Scale
	// Outlines & Effects on, the outline, shadow and bevel sizes grow with the
	// sticker here, the way a text or shape resize bakes into theirs; off, they
	// stay as set. Either way the panel shows the size that is drawn.
	// startScale is the transform scale the resize began from.
	async commitScale(layer, startScale = null) {
		if (layer?.type !== LayerType.STICKER || layer.stickerData.isEmpty) return;
		const scale = getLayerTransform(layer).scale;
		const factor = startScale
			? Math.max(Math.abs(scale.x), Math.abs(scale.y)) / Math.max(0.01, Math.abs(startScale.x), Math.abs(startScale.y))
			: 1;
		if (Math.abs(factor - 1) >= 1e-3) {
			scaleLayerSlotFields(layer, {
				effect: PREFERENCES.get('scaleEffects') ? factor : 1,
				texture: PREFERENCES.get('scaleTextures') ? factor : 1
			});
		}
		await this.commitResolutionSwap(layer);
		if (this.editor.layerManager.getActiveLayer() === layer) this.loadLayerSettings(layer);
		// Scaled values are no longer the defaults those sliders shipped with.
		syncPropertyReverts();
	}

	// ===== RESOLUTION SWAP =====

	// Called once a resize gesture ends (commitScale).
	// While actively dragging it's fine to look blurry at the sticker's
	// current resolution, matching Twitter's own behavior; this picks the
	// best-fitting variant for the settled size and swaps in, or does nothing
	// if the sticker has no variants (everything pre-migration).
	async commitResolutionSwap(layer) {
		if (layer.type !== LayerType.STICKER || layer.stickerData.isEmpty) return;
		const { baseUrl, variantUrls, width: nativeWidth } = layer.stickerData;
		if (!baseUrl || !variantUrls || !Object.keys(variantUrls).length) {
			this.renderLayer(layer);
			return;
		}

		const scalePercent = layer.transform?.scale?.x ?? 100;
		const renderedWidth = nativeWidth * (scalePercent / 100);
		const bestUrl = StickerVariants.pickBestUrl(baseUrl, nativeWidth, variantUrls, renderedWidth);
		if (bestUrl === layer.stickerData.url) {
			this.renderLayer(layer);
			return;
		}

		try {
			await AssetImageCache.get(bestUrl);
		} catch (error) {
			this.renderLayer(layer);
			return; // Keep the current source if the variant fails to load.
		}
		layer.stickerData.url = bestUrl;
		this.renderLayer(layer);
	}

	getSliceRects(layer, sourceWidth, sourceHeight, boxWidth, boxHeight) {
		const data = layer.stickerData;
		if (!data.slice || data.sliceEnabled === false) return null;
		const slice = scaleSliceInsets(data.slice, data.width, data.height, sourceWidth, sourceHeight);
		const scale = getSliceScale(data.slice, {
			scaleX: boxWidth / data.width, scaleY: boxHeight / data.height,
			boxWidth, boxHeight, pixelated: data.isPixelated !== false
		});
		return getSliceRects(slice, sourceWidth, sourceHeight, boxWidth, boxHeight, scale * data.width / sourceWidth);
	}

	drawStickerImage(ctx, image, layer, width, height, pad = 0) {
		const rects = this.getSliceRects(layer, image.naturalWidth || image.width, image.naturalHeight || image.height, width, height);
		if (!rects) { ctx.drawImage(image, pad, pad, width, height); return; }
		ctx.save();
		ctx.translate(pad, pad);
		drawSlicedImage(ctx, image, rects);
		ctx.restore();
	}

	reconcileSliceSpans(layer, element, img) {
		const scale = getLayerTransform(layer).scale;
		const width = Math.max(1, Math.round(layer.stickerData.width * Math.abs(scale.x) / 100));
		const height = Math.max(1, Math.round(layer.stickerData.height * Math.abs(scale.y) / 100));
		const rects = img.naturalWidth ? this.getSliceRects(layer, img.naturalWidth, img.naturalHeight, width, height) : null;
		img.style.display = rects ? 'none' : '';
		let group = element.querySelector('.sticker-slices');
		if (!rects) { group?.remove(); return; }
		if (!group) {
			group = document.createElement('span');
			group.className = 'sticker-slices';
			// The parent, not the element: animation nests the img in a wrapper.
			img.parentElement.insertBefore(group, img);
		}
		group.style.filter = buildCssColorFilter(layer.stickerData.colorAdjust);
		const existing = Array.from(group.children);
		rects.forEach((rect, index) => {
			let span = existing[index];
			if (!span) {
				span = document.createElement('span');
				span.className = 'sticker-slice';
				group.appendChild(span);
			}
			Object.assign(span.style, sliceSpanStyle(rect, img.naturalWidth, img.naturalHeight));
			const background = `url("${img.src}")`;
			if (span.style.backgroundImage !== background) span.style.backgroundImage = background;
		});
		existing.slice(rects.length).forEach((span) => span.remove());
	}

	// ===== RENDERING =====

	updateSelection() {
		// Delegate to main editor's update method
		this.editor.updateStickerSelection();
	}

	renderLayer(layer) {
		if (layer.type !== LayerType.STICKER) return;

		if (layer.stickerData.isEmpty || !layer.stickerData.url) {
			this.removeStickerElement(layer.id);
			return;
		}

		let element = this.layerElements.get(layer.id);
		const transform = this.layerTransforms.get(layer.id) || new LayerTransform(layer, this.editor);
		transform.removeHoverOutline();
		let img = element?.querySelector('img.sticker-image');
		const isNew = !element;
		if (isNew) {
			element = document.createElement('div');
			element.className = 'sticker-element';
			element.dataset.layerId = layer.id;
			img = document.createElement('img');
			img.className = 'sticker-image';
			img.draggable = false;
			img.addEventListener('load', () => {
				const current = this.editor.layerManager.getLayerById(layer.id);
				if (current) this.renderLayer(current);
			});
			element.appendChild(img);
			this.editor.canvasElementsContainer.appendChild(element);
			this.layerElements.set(layer.id, element);
		}

		// Reassigning an identical URL restarts animated GIFs in some browsers.
		if (img.dataset.sourceUrl !== layer.stickerData.url) {
			img.src = layer.stickerData.url;
			img.dataset.sourceUrl = layer.stickerData.url;
		}
		img.style.filter = buildCssColorFilter(layer.stickerData.colorAdjust);
		// The canvas stack declares image-rendering: pixelated and every child
		// inherits it, so smooth art needs the class toggle to opt back out.
		element.classList.toggle('pixelated', layer.stickerData.isPixelated !== false);
		this.reconcileSliceSpans(layer, element, img);
		this.reconcileStickerEffectSpans(layer, element, img);
		// Behind-the-sticker sparkles sit between the shadow and the image, as
		// the export composites them. The element is sized to the scaled box,
		// so the sparkles stretch with it (fitBox).
		reconcileSparkleLayers(img.parentElement, layer, {
			editor: this.editor,
			width: layer.stickerData.width,
			height: layer.stickerData.height,
			behindAnchor: img,
			fitBox: true
		});

		// The map entry owns the live handles. Keep it across DOM refreshes so
		// sidebar updates always target the live element.
		transform.layer = layer;
		transform.element = element;

		// Apply initial transform
		const dimensions = {
			width: layer.stickerData.width,
			height: layer.stickerData.height
		};
		transform.applyTransform(element, dimensions);
		syncLayerAnimationPreview(element, layer, this.editor.animationTicker);

		if (isNew) transform.setupMouseDrag(element);

		// Store References
		layer.stickerData.element = element;
		this.layerTransforms.set(layer.id, transform);

		// Update selection highlight
		this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);

		// Create transform handles only for true single-layer selection.
		if (
			layer.id === this.editor.layerManager.activeLayerId &&
			this.editor.currentTool === ToolType.SELECT &&
			!this.editor.layerManager.hasMultiSelection()
		) {
			transform.createTransformHandles();
		}
	}

	// ===== TRANSFORM UPDATES (Delegation to LayerTransform) =====

updateTransform(layerId, updates) {
    const transform = this.layerTransforms.get(layerId);
    if (!transform) return;

    // Delegate to LayerTransform
    transform.updateTransform(updates);

    // Re-apply transform to element
		const layer = this.editor.layerManager.getLayerById(layerId);
    if (layer) {
        const element = this.layerElements.get(layerId);
        if (element) {
            const dimensions = {
                width: layer.stickerData.width,
                height: layer.stickerData.height
            };
            transform.applyTransform(element, dimensions);
            
            // MOVED: Update handles AFTER applying transform
            if (transform.transformHandles) {
                transform.updateHandlePositions();
            }
        }
    }
}

	// ===== CENTERING METHODS (Delegation to LayerTransform) =====

	// ===== TRANSFORM HANDLES (Delegation to LayerTransform) =====

	// ===== LAYER REMOVAL =====

	removeSticker(layerId) {
		// Remove transform handles first
		const transform = this.layerTransforms.get(layerId);
		if (transform) {
			transform.removeTransformHandles();
		}

		// Remove DOM element
		this.removeStickerElement(layerId);

		// Clean up maps
		this.layerElements.delete(layerId);
	}

	releaseLayerResources(layer) {
		if (!layer?.id) return;
		this.removeSticker(layer.id);
	}

	removeStickerElement(layerId) {
		const element = this.layerElements.get(layerId);
		if (element && element.parentNode) {
			element.parentNode.removeChild(element);
		}

		// Clean up transform instance
		const transform = this.layerTransforms.get(layerId);
		if (transform) {
			transform.destroy();
			this.layerTransforms.delete(layerId);
		}
	}

	// ===== SERIALIZATION =====

	serializeSticker(layer) {
		// For undo/redo: a deep copy, so an in-place edit to a live slot (outline
		// width, shadow, bevel, sparkles) never rewrites a history state. The DOM
		// element and decoded pixels are runtime-only and never copied.
		const stickerData = { ...layer.stickerData, element: null, staticImageData: null };
		delete stickerData.blendMode;
		return structuredClone({
			...layer,
			blendMode: GlitterBlendModes.forLayer(layer),
			transform: cloneTransform(getLayerTransform(layer)),
			stickerSourceId: layer.stickerSourceId,
			stickerData
		});
	}

	async deserializeSticker(serialized) {
		// Restore into a copy: the serialized object is a history snapshot, and the
		// live layer must not alias it.
		const layerData = structuredClone(serialized);
		layerData.blendMode = GlitterBlendModes.forLayer(layerData);
		if (layerData.animations?.length) layerData.animations = GlitterAnimation.normalizeAnimations(layerData.animations);
		if (layerData.stickerData) {
			delete layerData.stickerData.blendMode;
			layerData.stickerData.staticImageData = null;
		}
		layerData.transform ||= createDefaultTransform();
		// Handle empty sticker layers (no sticker selected yet)
		if (!layerData.stickerSourceId) {
			return layerData;
		}

		// Restore sticker layer from serialized data
		const sticker = this.editor.stickerLibrary.getItemById(layerData.stickerSourceId);
		if (!sticker) {
			const missingId = layerData.stickerSourceId;
			layerData._missingAssets = [...(layerData._missingAssets || []), `sticker ${missingId}`];
			layerData.stickerSourceId = null;
			layerData.stickerData = {
				...(layerData.stickerData || {}),
				isEmpty: true,
				url: null,
				name: 'Missing Sticker'
			};
			return layerData;
		}

		// Serialized blob URLs belong to the session that saved the project. Always
		// bind the layer to the freshly resolved library/embedded asset URL.
		layerData.stickerData.url = sticker.url;
		layerData.stickerData.baseUrl = sticker.url;
		layerData.stickerData.variantUrls = sticker.variantUrls || null;
		layerData.stickerData.name = sticker.name;
		layerData.stickerData.source = sticker.source;
		// Geometry belongs to the saved layer, not to asynchronously hydrated
		// library metadata. Replacing it here made undo resize a sticker whenever
		// its detail record finished loading after the snapshot was captured.
		layerData.stickerData.width = layerData.stickerData.width || sticker.width;
		layerData.stickerData.height = layerData.stickerData.height || sticker.height;
		layerData.stickerData.frameCount = layerData.stickerData.frameCount || sticker.frameCount || 1;
		// Projects saved before scale snapping carry free percentages; bring them
		// onto whole-pixel sizes the same way every scale edit does.
		snapLayerScaleToWholePixels(layerData);
		// The library asset owns this flag, so a project saved before an admin
		// change picks up the corrected rendering on reopen.
		layerData.stickerData.isPixelated = sticker.isPixelated !== false;
		layerData.stickerData.slice = normalizeSlice(layerData.stickerData.slice, layerData.stickerData.width, layerData.stickerData.height);
		layerData.stickerData.colorAdjust = normalizeColorAdjust(layerData.stickerData.colorAdjust);
		if (layerData.stickerData.border) layerData.stickerData.border = { ...getSlotDefaults(LayerType.STICKER, 'border'), ...layerData.stickerData.border };
		if (layerData.stickerData.shadow) layerData.stickerData.shadow = { ...getSlotDefaults(LayerType.STICKER, 'shadow'), ...layerData.stickerData.shadow };
		layerData.stickerData.bevel ||= buildDefaultBevel();
		layerData.stickerData.bevel.highlight = mergeSlotEffectDefaults(layerData.stickerData.bevel.highlight, buildDefaultBevel().highlight);
		layerData.stickerData.bevel.shade = mergeSlotEffectDefaults(layerData.stickerData.bevel.shade, buildDefaultBevel().shade);
		normalizeBevelData(layerData.stickerData.bevel.highlight);
		normalizeSlotTextureCoordinates(layerData.stickerData.border);
		normalizeSlotTextureCoordinates(layerData.stickerData.shadow);
		normalizeSlotTextureCoordinates(layerData.stickerData.bevel.highlight);
		normalizeSlotTextureCoordinates(layerData.stickerData.bevel.shade);
		layerData.stickerData.sparkles = normalizeSparklesData(layerData.stickerData.sparkles);

		return layerData;
	}

	// ===== CLEANUP =====

	destroy() {
		// Remove all sticker elements
		this.layerElements.forEach((element, layerId) => {
			if (element.parentNode) {
				element.parentNode.removeChild(element);
			}
		});

		// Clean up all transform instances
		this.layerTransforms.forEach(transform => {
			transform.destroy();
		});

		this.editor.stickerLibrary.destroy();

		// Clear maps
		this.layerElements.clear();
		this.layerTransforms.clear();
		this.effectMaskCache.clear();
	}

	buildExportPlan(layer, context) {
		return context.compositor._buildStickerExportPlan(layer);
	}
	handleUserUpload(...args) { return this.editor.stickerLibrary.handleUserUpload(...args); }
	registerEmbeddedSticker(...args) { return this.editor.stickerLibrary.registerEmbeddedSticker(...args); }
	handleItemClick(...args) { return this.editor.stickerLibrary.handleItemClick(...args); }
	getItemById(id) { return this.editor.stickerLibrary.getItemById(id); }
	async init() { this.setupUI(); this.setupEventListeners(); }
}

Object.assign(StickerManager.prototype, MOVABLE_LAYER_METHODS);

StickerManager.LAYER_TYPE = LayerType.STICKER;
Object.assign(StickerManager.prototype, { clearElements: LAYER_ELEMENT_METHODS.clearElements, removeLayerElement: LAYER_ELEMENT_METHODS.removeLayerElement });
