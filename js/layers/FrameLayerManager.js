// ============================================
// FRAME LAYER MANAGER
// ============================================
// Frame layers (js/layers/types/frame.js): a border around the picture.
// Pinned (the default), a frame fills the canvas minus its inset and follows
// canvas resizes, with no handles. Unpinned, it keeps its bounds and moves
// and resizes like a shape. The style kind is a ring of shade masks painted
// with the fill slot (js/paint/frames.js); the image kind draws a frame
// sticker fitted to the box. Preview spans and the export read the same
// masks, shading and placement.

class FrameLayerManager {
	constructor(editor) {
		this.editor = editor;
		this.layerElements = new Map();
		this.layerTransforms = new Map();
		this.maskUrlCache = new Map();
		// Canvas picking (hitTest): opaque-pixel maps by look, and the frame
		// images they are read from.
		this.hitAlpha = new Map();
		this.hitImages = new Map();
		this.slotPicker = new SlotGlitterPicker(editor, {
			type: LayerType.FRAME,
			defaultSlot: 'fill',
			section: 'frameSettings',
			typeWord: 'frame',
			ensureSlot: (layer, key) => this.ensureSlot(layer, key),
			onPicked: (layer) => {
				this.renderLayer(layer);
				this.loadLayerSettings(layer);
			}
		});
		this.setupUI();
		this.fieldHost = this.createFieldHost();
		bindFieldControls(this.fieldHost);
		this.setupEventListeners();
	}

	setupUI() {
		const id = (x) => document.getElementById(x);
		this.ui = {
			presets: id('framePresets'),
			summary: id('frameContentSummary'),
			pinned: id('framePinned'),
			insetRow: id('frameInsetRow'),
			shadeRow: id('frameShadeRow'),
			imagePicker: id('frameImagePicker'),
			imageInfo: id('frameImageInfo'),
			fillCard: id('frameFillColor')?.closest('.paint-slot-card') || null,
			transformGroup: id('frameTransformPanelHost')?.closest('[data-panel-group]') || null
		};
	}

	// How the declared field binder edits a frame.
	createFieldHost() {
		return {
			type: LayerType.FRAME,
			editor: this.editor,
			getLayer: () => this.getActiveLayer(),
			ensureSlot: (layer, key) => this.ensureSlot(layer, key),
			getSlotDefaults: (key) => getSlotDefaults(LayerType.FRAME, key),
			apply: (layer, mutate, change) => {
				mutate();
				this.renderLayer(layer);
				if (change.live) return;
				this.loadLayerSettings(layer);
				this.editor.saveState('Edit frame');
				this.editor.layerManager.renderLayersList();
			},
			render: (layer) => this.renderLayer(layer),
			commit: () => {
				this.editor.saveState('Edit frame');
				this.editor.layerManager.renderLayersList();
			},
			armPicker: (key) => this.slotPicker.arm(key),
			getArmedSlot: (layer) => this.slotPicker.getArmedSlot(layer)
		};
	}

	// The frame's own options: kind, style, image fit and pinning. Their
	// numbers are declared fields (the type definition).
	setupEventListeners() {
		const edit = (mutate, label = 'Edit frame') => {
			const layer = this.getActiveLayer();
			if (!layer || !this.editor.canEditLayer(layer, { notify: true })) return;
			if (mutate(layer) === false) return;
			this.renderLayer(layer);
			this.loadLayerSettings(layer);
			this.editor.syncTransformHandlesForActiveLayer?.();
			this.editor.layerManager.renderLayersList();
			this.editor.saveState(label);
		};
		const bindOptions = (name, prefix, key) => getOptions(name).forEach(({ value }) => {
			document.getElementById(`${prefix}${panelCap(value)}`)?.addEventListener('click', () => edit((layer) => {
				if (key === 'fit' && value === 'slice' && !layer.frameData.image?.slice) return false;
				if (layer.frameData[key] === value) return false;
				layer.frameData[key] = value;
				return true;
			}));
		});
		bindOptions('frameKind', 'frameKind', 'kind');
		bindOptions('frameStyle', 'frameStyle', 'style');
		bindOptions('frameFit', 'frameFit', 'fit');
		const revealImages = () => {
			this.ui.imagePicker?.scrollIntoView({ block: 'nearest' });
			this.ui.imagePicker?.querySelector('button')?.focus();
		};
		document.getElementById('frameImageChange')?.addEventListener('click', revealImages);
		document.getElementById('frameImageThumbnail')?.addEventListener('click', revealImages);
		this.ui.pinned?.addEventListener('change', () => edit((layer) => this.setPinned(layer, this.ui.pinned.checked), 'Pin frame'));
	}

	// ===== DATA =====

	ensureSlot(layer, key) {
		if (!layer?.frameData) return null;
		return ensureSlotEffectData(layer.frameData, key, {
			builders: { fill: () => getSlotDefaults(LayerType.FRAME, 'fill'), sparkles: () => buildDefaultSparkles() }
		});
	}

	createLayer(options = {}) {
		if (!this.editor.layerManager.requireLayerCapacity()) return null;
		const defaults = CONFIG.tools.frames.defaults;
		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.FRAME,
			name: 'Frame',
			visible: true,
			locked: false,
			opacity: FIELDS.layerOpacity.value,
			transform: createDefaultTransform(),
			frameData: {
				pinned: defaults.pinned,
				kind: defaults.kind,
				style: defaults.style,
				fit: defaults.fit,
				inset: FIELDS.frameInset.value,
				sliceScale: FIELDS.frameSliceScale.value,
				widthPx: FIELDS.frameThickness.value,
				radius: FIELDS.frameRadius.value,
				shade: FIELDS.frameShade.value,
				width: 0,
				height: 0,
				fill: getSlotDefaults(LayerType.FRAME, 'fill'),
				image: null,
				sparkles: null
			}
		};
		// The field defaults match the default preset (so a new frame's reverts
		// read unchanged); applying it keeps the preset authoritative.
		const preset = FRAME_PRESETS.get(defaults.preset);
		if (preset) FRAME_PRESETS.apply(preset, layer.frameData);
		this.normalizeLayer(layer);
		return layer;
	}

	// Runs where a frame enters the document (create, deserialize, project
	// load).
	normalizeLayer(layer) {
		if (layer?.type !== LayerType.FRAME) return null;
		const data = layer.frameData ||= {};
		const defaults = CONFIG.tools.frames.defaults;
		data.pinned = data.pinned !== false;
		if (!FRAME_KINDS[data.kind]) data.kind = defaults.kind;
		if (!FRAME_STYLES[data.style]) data.style = defaults.style;
		if (!isOptionValue('frameFit', data.fit)) data.fit = defaults.fit;
		[['inset', 'frameInset'], ['widthPx', 'frameThickness'], ['radius', 'frameRadius'], ['shade', 'frameShade'], ['sliceScale', 'frameSliceScale']].forEach(([key, spec]) => {
			const value = Number(data[key]);
			data[key] = Number.isFinite(value) ? value : FIELDS[spec].value;
		});
		data.fill = mergeSlotEffectDefaults(data.fill, getSlotDefaults(LayerType.FRAME, 'fill'));
		normalizeSlotTextureCoordinates(data.fill);
		data.image ??= null;
		if (data.image) data.image.slice = normalizeSlice(data.image.slice, data.image.width, data.image.height);
		if (data.fit === 'slice' && !data.image?.slice) data.fit = defaults.fit;
		data.sparkles = normalizeSparklesData(data.sparkles);
		layer.transform ||= createDefaultTransform();
		this.syncPinnedGeometry(layer);
		const canvas = this.getCanvasSize();
		if (!(data.width > 0) || !(data.height > 0)) {
			data.width = canvas?.width || CONFIG.tools.frames.minSize;
			data.height = canvas?.height || CONFIG.tools.frames.minSize;
		}
		return layer;
	}

	// ===== GEOMETRY =====

	getCanvasSize() {
		const canvas = this.editor.originalCanvas;
		return canvas?.width && canvas?.height ? { width: canvas.width, height: canvas.height } : null;
	}

	// A pinned frame's box and transform are derived from the canvas. Every
	// read path (render, frame, export, sparkles host) calls this first, so a
	// canvas resize, a document scale or an undo lands the frame on the
	// current canvas with no bookkeeping of its own.
	syncPinnedGeometry(layer) {
		const data = layer?.frameData;
		if (!data?.pinned) return;
		const canvas = this.getCanvasSize();
		if (!canvas) return;
		const inset = Math.max(0, Math.round(data.inset || 0));
		const minSize = CONFIG.tools.frames.minSize;
		data.width = Math.max(minSize, canvas.width - inset * 2);
		data.height = Math.max(minSize, canvas.height - inset * 2);
		const transform = layer.transform ||= createDefaultTransform();
		transform.position.x = canvas.width / 2;
		transform.position.y = canvas.height / 2;
		transform.rotation = 0;
		transform.scale.x = 100;
		transform.scale.y = 100;
		transform.flipX = false;
		transform.flipY = false;
	}

	// Layer frame (see getLayerFrame): the frame box.
	getFrameBox(layer) {
		if (!layer?.frameData) return null;
		this.syncPinnedGeometry(layer);
		return { width: layer.frameData.width, height: layer.frameData.height, offsetX: 0, offsetY: 0 };
	}

	// Canvas picking: a frame is hit on its painted pixels only (the ring, or
	// the frame image's opaque pixels), within tolerance document px, so a
	// click inside the frame reaches the layers under it.
	hitTest(layer, x, y, tolerance = 0) {
		const alpha = this.getHitAlpha(layer);
		if (!alpha) return false;
		const metrics = computeLayerTransform(getLayerTransform(layer), { width: alpha.width, height: alpha.height });
		const dx = x - metrics.centerX;
		const dy = y - metrics.centerY;
		const cos = Math.cos(metrics.rotationRad);
		const sin = Math.sin(metrics.rotationRad);
		const localX = Math.floor((dx * cos + dy * sin) / metrics.signedScaleX + alpha.width / 2);
		const localY = Math.floor((-dx * sin + dy * cos) / metrics.signedScaleY + alpha.height / 2);
		const reach = Math.max(0, Math.round(tolerance));
		for (let py = localY - reach; py <= localY + reach; py++) {
			if (py < 0 || py >= alpha.height) continue;
			for (let px = localX - reach; px <= localX + reach; px++) {
				if (px >= 0 && px < alpha.width && alpha.data[py * alpha.width + px]) return true;
			}
		}
		return false;
	}

	// The frame's opaque pixels in box space, cached per look. An image frame
	// reads its first frame once the image has loaded; until then it has none.
	getHitAlpha(layer) {
		this.syncPinnedGeometry(layer);
		const data = layer.frameData;
		const width = Math.round(data.width);
		const height = Math.round(data.height);
		let key;
		let draw;
		if (data.kind === 'image') {
			const url = data.image?.url;
			if (!url) return null;
			let image = this.hitImages.get(url);
			if (!image) {
				this.hitImages.set(url, { pending: true });
				loadImageElement(url).then(decoded => {
					this.hitImages.set(url, decoded);
					this.hitAlpha.clear();
				}).catch(error => {
					this.hitImages.delete(url);
					console.warn('Could not decode frame image:', error);
				});
				return null;
			}
			if (!image.complete || !image.naturalWidth) return null;
			key = `image:${url}:${data.fit}:${data.sliceScale}:${JSON.stringify(data.image.slice)}:${width}x${height}`;
			draw = (ctx) => {
				drawFrameImage(ctx, image, data, width, height);
			};
		} else {
			key = `style:${getFrameMaskKey(data, width, height)}`;
			draw = (ctx) => buildFrameShadeMasks(data, width, height).forEach((mask) => ctx.drawImage(mask.canvas, 0, 0));
		}
		const cached = this.hitAlpha.get(key);
		if (cached) return cached;
		const canvas = createAppCanvas(width, height, 'layers/FrameLayerManager');
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		draw(ctx);
		const pixels = ctx.getImageData(0, 0, width, height).data;
		canvas.width = canvas.height = 0;
		const alpha = { width, height, data: new Uint8Array(width * height) };
		const threshold = CONFIG.rendering.maskAlphaThreshold;
		for (let i = 0; i < alpha.data.length; i++) alpha.data[i] = pixels[i * 4 + 3] >= threshold ? 1 : 0;
		this.hitAlpha.set(key, alpha);
		while (this.hitAlpha.size > 8) this.hitAlpha.delete(this.hitAlpha.keys().next().value);
		return alpha;
	}

	// Unpinning keeps the current box, so the frame stays where it is.
	setPinned(layer, pinned) {
		if (layer.frameData.pinned === pinned) return false;
		layer.frameData.pinned = pinned;
		this.syncPinnedGeometry(layer);
		return true;
	}

	// Bake a committed CSS scale into the frame's box, like a shape: the ring
	// thickness stays in pixels instead of stretching.
	commitScale(layer) {
		if (layer?.type !== LayerType.FRAME) return;
		const transform = getLayerTransform(layer);
		const sx = (transform.scale.x || 100) / 100;
		const sy = (transform.scale.y || 100) / 100;
		if (Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3) return;
		const minSize = CONFIG.tools.frames.minSize;
		layer.frameData.width = Math.max(minSize, Math.round(layer.frameData.width * sx));
		layer.frameData.height = Math.max(minSize, Math.round(layer.frameData.height * sy));
		scaleLayerFields(layer, { corner: PREFERENCES.get('scaleCorners') ? Math.max(sx, sy) : 1 });
		transform.scale.x = 100;
		transform.scale.y = 100;
		this.renderLayer(layer);
		this.loadLayerSettings(layer);
	}

	// Shared transform interface (StickerManager.updateTransform). Panel size
	// edits arrive as a scale and are baked at once.
	updateTransform(layerId, updates) {
		const transform = this.layerTransforms.get(layerId);
		const layer = this.editor.layerManager.getLayerById(layerId);
		if (!transform || !layer) return;
		transform.updateTransform(updates);
		if (updates.scale) {
			this.commitScale(layer);
			return;
		}
		const element = this.layerElements.get(layerId);
		if (element) {
			transform.applyTransform(element, { width: layer.frameData.width, height: layer.frameData.height });
			if (transform.transformHandles) transform.updateHandlePositions();
		}
	}

	// ===== PAINT =====

	// The style kind's back-to-front paint list: one item per shade mask, each
	// the fill slot shaded for its band. resolveSource(entry) resolves the
	// fill slot (preview or export). Items carry their mask for the preview.
	buildFrameStack(layer, resolveSource) {
		const data = layer.frameData;
		if (!FRAME_KINDS[data.kind]?.paints) return [];
		const entry = getLayerPaintSlots(layer).find((slot) => slot.key === 'fill');
		const source = entry?.renders ? resolveSource(entry) : null;
		if (!source) return [];
		const sourceKey = getPaintSlotSourceKey(layer, entry);
		return buildFrameShadeMasks(data, data.width, data.height).map((mask) => ({
			key: mask.key,
			role: entry.role,
			definition: entry.definition,
			data: entry.data,
			source: shadeFramePaintSource(source, mask.shade, data.shade),
			sourceKey,
			offsetX: 0,
			offsetY: 0,
			mask: mask.canvas
		}));
	}

	// Export masks for the slot stack (renderSlotMasks contract).
	renderSlotMasks(layer) {
		this.syncPinnedGeometry(layer);
		const { width, height } = layer.frameData;
		const shades = buildFrameShadeMasks(layer.frameData, width, height);
		const fill = shades[0]?.canvas || createAppCanvas(Math.round(width), Math.round(height), 'layers/FrameLayerManager');
		const masks = { fill, renderWidth: fill.width, renderHeight: fill.height };
		shades.forEach((mask) => { masks[mask.key] = mask.canvas; });
		return masks;
	}

	getMaskUrl(canvas, cacheKey) {
		if (this.maskUrlCache.has(cacheKey)) return this.maskUrlCache.get(cacheKey);
		const url = canvas.toDataURL('image/png');
		this.maskUrlCache.set(cacheKey, url);
		while (this.maskUrlCache.size > 32) this.maskUrlCache.delete(this.maskUrlCache.keys().next().value);
		return url;
	}

	// Sparkles read the frame's painted ring, or its image placed in the box.
	getSparkleHost(layer) {
		this.syncPinnedGeometry(layer);
		const data = layer.frameData;
		const width = Math.round(data.width);
		const height = Math.round(data.height);
		if (data.kind === 'image') {
			const image = data.image;
			if (!image?.url) return null;
			return {
				key: `frame-image:${image.url}:${data.fit}:${data.sliceScale}:${JSON.stringify(image.slice)}`,
				width,
				height,
				loadPixels: async () => {
					const source = await loadSparkleImageHostPixels(image.url, image.isAnimated);
					let drawable = source;
					if (!(source instanceof HTMLCanvasElement) && !(source instanceof HTMLImageElement)) {
						drawable = createAppCanvas(source.width, source.height, 'layers/FrameLayerManager');
						drawable.getContext('2d').putImageData(source instanceof ImageData ? source : new ImageData(source.data, source.width, source.height), 0, 0);
					}
					const canvas = createAppCanvas(width, height, 'layers/FrameLayerManager');
					drawFrameImage(canvas.getContext('2d'), drawable, data, width, height);
					return canvas;
				}
			};
		}
		return {
			key: `frame:${getFrameMaskKey(data, width, height)}|${getSparkleMaskHostKey(data.fill)}`,
			width,
			height,
			loadPixels: () => {
				const ring = createAppCanvas(width, height, 'layers/FrameLayerManager');
				const ctx = ring.getContext('2d');
				buildFrameShadeMasks(data, width, height).forEach((mask) => ctx.drawImage(mask.canvas, 0, 0));
				return paintSparkleMaskHost(ring, data.fill);
			}
		};
	}

	// ===== PREVIEW =====

	renderContent(layersToShow) {
		const keep = new Set(layersToShow.filter((layer) => layer.type === LayerType.FRAME).map((layer) => layer.id));
		Array.from(this.layerElements.keys()).forEach((layerId) => {
			if (!keep.has(layerId)) this.removeLayerElement(layerId);
		});
		layersToShow.forEach((layer) => {
			if (layer.type === LayerType.FRAME) this.renderLayer(layer);
		});
	}

	renderLayer(layer) {
		if (layer?.type !== LayerType.FRAME) return;
		this.syncPinnedGeometry(layer);
		const data = layer.frameData;
		let wrapper = this.layerElements.get(layer.id);
		let stack = wrapper?.querySelector('.frame-layer-stack');
		if (!wrapper) {
			wrapper = document.createElement('div');
			wrapper.className = 'frame-layer-element';
			wrapper.dataset.layerId = layer.id;
			wrapper.setAttribute('role', 'img');
		}
		if (!stack) {
			stack = document.createElement('div');
			stack.className = 'frame-layer-stack';
			wrapper.replaceChildren(stack);
		}
		if (!wrapper.parentNode) this.editor.canvasElementsContainer.appendChild(wrapper);
		this.layerElements.set(layer.id, wrapper);

		let transform = this.layerTransforms.get(layer.id);
		if (!transform) {
			transform = new LayerTransform(layer, this.editor);
			transform.setupMouseDrag(wrapper);
			this.layerTransforms.set(layer.id, transform);
		}
		transform.layer = layer;
		transform.element = wrapper;

		this.reconcileContent(stack, layer);
		transform.applyTransform(wrapper, { width: data.width, height: data.height });
		wrapper.setAttribute('aria-label', layer.name || 'Frame');

		if (
			layer.id === this.editor.layerManager.activeLayerId
			&& this.editor.currentTool === ToolType.SELECT
			&& !this.editor.layerManager.hasMultiSelection()
			&& isLayerSelectableOnCanvas(layer)
			&& !layer.locked
		) {
			if (!transform.isDraggingHandle) transform.createTransformHandles();
		} else {
			transform.removeTransformHandles();
		}
		this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);
	}

	reconcileContent(stack, layer) {
		const data = layer.frameData;
		const width = Math.round(data.width);
		const height = Math.round(data.height);
		this.syncElementScale(layer, stack.parentNode, stack);
		let group = stack.querySelector(':scope > .frame-layer-images');
		if (data.kind === 'image') {
			reconcileSlotStack(stack, [], { spanClassName: 'frame-layer-content', width, height, layer, getMask: () => null });
			const rects = getFrameSliceRects(data, data.image?.width, data.image?.height, width, height);
			if (!group) {
				group = document.createElement('span');
				group.className = 'frame-layer-images';
				stack.insertBefore(group, stack.querySelector('.sparkle-layer'));
			}
			const spans = Array.from(group.children);
			const pieces = rects || [null];
			pieces.forEach((rect, index) => {
				let image = spans[index];
				if (!image) {
					image = document.createElement('span');
					image.className = 'frame-layer-image';
					group.appendChild(image);
				}
				if (rect) Object.assign(image.style, sliceSpanStyle(rect, data.image.width, data.image.height));
				else {
					const place = getFrameImagePlacement(data.fit, data.image?.width, data.image?.height, width, height);
					Object.assign(image.style, { left: `${place.x}px`, top: `${place.y}px`, width: `${place.width}px`, height: `${place.height}px`, backgroundSize: '100% 100%', backgroundPosition: '0 0' });
				}
				const background = data.image?.url ? `url("${data.image.url}")` : 'none';
				if (image.style.backgroundImage !== background) image.style.backgroundImage = background;
				image.classList.toggle('pixelated', data.image?.isPixelated !== false);
			});
			spans.slice(pieces.length).forEach((span) => span.remove());
		} else {
			group?.remove();
			reconcileSlotStack(stack, this.buildFrameStack(layer, (entry) => resolvePaintSlotPreviewSource(this.editor, layer, entry)), {
				spanClassName: 'frame-layer-content',
				width,
				height,
				layer,
				glitterLibrary: this.editor.glitterLibrary,
				getMask: (item) => ({ canvas: item.mask, url: this.getMaskUrl(item.mask, `${getFrameMaskKey(data, width, height)}|${item.key}`) })
			});
		}
		reconcileSparkleLayers(stack, layer, { editor: this.editor, width, height });
	}

	// Called by LayerTransform.applyTransform during handle drags: the stack
	// is laid out at the frame's own size and CSS-scaled like a shape's.
	syncElementScale(layer, wrapper = this.layerElements.get(layer?.id), stack = wrapper?.querySelector('.frame-layer-stack')) {
		if (!stack || !layer?.frameData) return;
		const transform = getLayerTransform(layer);
		stack.style.width = `${Math.round(layer.frameData.width)}px`;
		stack.style.height = `${Math.round(layer.frameData.height)}px`;
		stack.style.transform = `scale(${(transform.scale.x || 100) / 100}, ${(transform.scale.y || 100) / 100})`;
	}

	releaseLayerResources(layer) {
		this.removeLayerElement(layer?.id);
	}

	// ===== PANEL =====

	getFrameImageAssets() {
		const category = CONFIG.tools.frames.imageCategory;
		return (this.editor.stickerLibrary?.content || []).filter((item) => item.category === category);
	}

	async chooseFrameImage(item) {
		const layer = this.getActiveLayer();
		if (!layer || !this.editor.canEditLayer(layer, { notify: true })) return;
		const asset = await this.editor.stickerLibrary.ensureAssetDetails(item.id);
		if (!asset || this.getActiveLayer()?.id !== layer.id) return;
		layer.frameData.kind = 'image';
		layer.frameData.image = {
			stickerId: asset.id,
			url: asset.url,
			baseUrl: asset.url,
			variantUrls: asset.variantUrls ? { ...asset.variantUrls } : null,
			category: asset.category,
			name: asset.name,
			width: asset.width,
			height: asset.height,
			isAnimated: Boolean(asset.isAnimated),
			isPixelated: asset.isPixelated !== false,
			slice: normalizeSlice(asset.slice, asset.width, asset.height)
		};
		layer.frameData.fit = layer.frameData.image.slice ? 'slice' : CONFIG.tools.frames.defaults.fit;
		layer.name = asset.name || 'Frame';
		this.renderLayer(layer);
		this.loadLayerSettings(layer);
		this.editor.layerManager.renderLayersList();
		this.editor.saveState('Choose frame image');
	}

	// The frame images as a preset-grid library, so they pick like the Style
	// presets. Rebuilt when the sticker library has loaded more of them.
	getFrameImageLibrary() {
		const assets = this.getFrameImageAssets();
		if (this.imageLibrary?.entries.length === assets.length) return this.imageLibrary;
		const byId = new Map(assets.map((item) => [String(item.id), item]));
		this.imageLibrary = GlitterPresetLibrary.createPresetLibrary({
			id: 'frame-images',
			groups: [{ id: 'frames', label: '' }],
			entries: assets.map((item) => ({ id: String(item.id), label: item.name, group: 'frames', value: { stickerId: item.id } })),
			renderThumbnail(entry, element) {
				const item = byId.get(entry.id);
				element.classList.add('is-drawn');
				element.classList.toggle('is-sliced', Boolean(item?.sliced || item?.slice));
				if (item?.sliced || item?.slice) {
					const mark = document.createElement('span');
					mark.className = 'asset-slice-mark';
					mark.title = 'Stretches without distorting its corners.';
					mark.appendChild(createIcon('stretch'));
					element.appendChild(mark);
				}
				element.classList.toggle('pixelated', item?.isPixelated !== false);
				element.style.backgroundImage = item ? `url(${item.thumbnailUrl || item.url})` : '';
			}
		});
		return this.imageLibrary;
	}

	renderImagePicker(layer) {
		if (!this.ui.imagePicker) return;
		const current = layer?.frameData.image?.stickerId;
		GlitterPresetLibrary.renderPresetGrid(this.ui.imagePicker, this.getFrameImageLibrary(), {
			activeId: current == null ? null : String(current),
			contextId: 'frame-images',
			onChoose: (entry) => this.chooseFrameImage({ id: entry.value.stickerId })
		});
	}

	loadLayerSettings(layer) {
		if (layer?.type !== LayerType.FRAME) return;
		const data = layer.frameData;
		const syncOptions = (name, prefix, current) => getOptions(name).forEach(({ value }) => {
			const button = document.getElementById(`${prefix}${panelCap(value)}`);
			if (!button) return;
			button.classList.toggle('active', value === current);
			button.setAttribute('aria-pressed', String(value === current));
		});
		syncOptions('frameKind', 'frameKind', data.kind);
		syncOptions('frameStyle', 'frameStyle', data.style);
		syncOptions('frameFit', 'frameFit', data.fit);
		const sliceFit = document.getElementById('frameFitSlice');
		if (sliceFit) sliceFit.hidden = !data.image?.slice;
		const sliceScaleRow = document.getElementById('frameSliceScaleRow');
		if (sliceScaleRow) sliceScaleRow.hidden = data.kind !== 'image' || data.fit !== 'slice';
		document.querySelectorAll('#frameSettingsSection [data-frame-kind]').forEach((element) => {
			element.hidden = element.dataset.frameKind !== data.kind;
		});
		// The ring's paint and geometry only apply to the style kind.
		const paints = FRAME_KINDS[data.kind].paints;
		if (this.ui.fillCard) this.ui.fillCard.hidden = !paints;
		['frameThicknessRow', 'frameRadiusRow'].forEach((rowId) => {
			const row = document.getElementById(rowId);
			if (row) row.hidden = !paints;
		});
		if (this.ui.pinned) this.ui.pinned.checked = data.pinned;
		if (this.ui.insetRow) this.ui.insetRow.hidden = !data.pinned;
		if (this.ui.transformGroup) this.ui.transformGroup.hidden = data.pinned;
		const style = FRAME_STYLES[data.style];
		if (this.ui.shadeRow) this.ui.shadeRow.hidden = !style.bands.some((band) => Object.values(band.shades).some(Boolean));
		const presetId = findFramePresetId(data);
		// The Frame card's header names what is inside, so it can collapse.
		if (this.ui.summary) {
			this.ui.summary.textContent = data.kind === 'image'
				? (data.image?.name || 'None')
				: (FRAME_PRESETS.get(presetId)?.label || 'Custom');
		}
		if (this.ui.presets) {
			GlitterPresetLibrary.renderPresetGrid(this.ui.presets, FRAME_PRESETS, {
				activeId: presetId,
				contextId: 'frame',
				onChoose: (entry) => {
					const active = this.getActiveLayer();
					if (!active || !this.editor.canEditLayer(active, { notify: true })) return;
					FRAME_PRESETS.apply(entry, active.frameData);
					this.renderLayer(active);
					this.loadLayerSettings(active);
					this.editor.layerManager.renderLayersList();
					this.editor.saveState('Frame preset');
				}
			});
		}
		this.renderImagePicker(layer);
		if (this.ui.imageInfo) {
			this.ui.imageInfo.hidden = !data.image;
			if (data.image) {
				const thumbnail = document.getElementById('frameImageThumbnail');
				if (thumbnail) {
					thumbnail.style.backgroundImage = `url("${data.image.url}")`;
					thumbnail.classList.toggle('pixelated', data.image.isPixelated !== false);
				}
				const name = document.getElementById('frameImageName');
				if (name) name.textContent = data.image.name || 'Frame';
				this.editor.renderAssetBadges(document.getElementById('frameImageBadges'), data.image, this.editor.stickerManager);
			}
		}
		this.editor.loadTransformSettings?.(layer, 'frame');
		syncFieldControls(this.fieldHost, layer);
		syncPropertyReverts();
	}

	// ===== EXPORT =====

	buildExportPlan(layer, context) {
		this.syncPinnedGeometry(layer);
		const compositor = context.compositor;
		if (layer.frameData.kind === 'image') return this.buildImageExportPlan(layer, compositor);
		return compositor._buildSlotStackExportPlan(layer, {
			buildStack: (resolveSource) => this.buildFrameStack(layer, resolveSource)
		});
	}

	// An image frame: the frame sticker (every frame of an animated one, as an
	// authored source like a sticker) placed in the box, sparkles around it,
	// then the layer transform.
	buildImageExportPlan(layer, compositor) {
		const data = layer.frameData;
		const image = data.image;
		const key = `${layer.id}:image`;
		const scratch = {
			still: null,
			source: createAppCanvas(0, 0, 'layers/FrameLayerManager'),
			composite: createAppCanvas(0, 0, 'layers/FrameLayerManager')
		};
		const descriptor = image?.url && image.isAnimated ? {
			key,
			label: image.name || 'Frame',
			ownerLayerId: layer.id,
			effectSlot: null,
			role: 'sticker',
			replayPolicy: 'native-layer',
			sourceIdentity: image,
			ensureLoaded: async (callbacks, { timingOnly = false } = {}) => {
				await compositor._loadAnimatedSource(image.url, {
					timingOnly,
					onStatus: () => callbacks.onStatus(`Loading ${image.name || 'frame'}...`),
					failure: `Failed to load frame ${image.name || ''}`
				});
			},
			getAnimation: () => compositor._getAnimatedSource(image.url)
		} : null;
		return {
			prepareMasks: async () => {},
			prepareStaticResources: async ({ callbacks }) => {
				if (!image?.url || image.isAnimated || scratch.still) return;
				callbacks.onStatus(`Loading ${image.name || 'frame'}...`);
				try {
					scratch.still = await compositor._loadStaticImage(image.url);
				} catch (error) {
					throw new Error(`Failed to load frame ${image.name || ''}`);
				}
			},
			getAuthoredSources: (library) => [
				...(descriptor ? [descriptor] : []),
				...compositor._getSlotAuthoredSources(layer, library).filter((source) => source.effectSlot !== 'fill')
			],
			render: ({ ctx, frameIndex, timestamp, sourceSelectionMap, resolvedFramesBySource }) => {
				let pixels = scratch.still;
				if (descriptor) {
					const frames = resolvedFramesBySource?.get(key);
					if (!frames?.length) throw new Error(`Missing resolved frame image for layer ${layer.id}`);
					pixels = compositor._readResolvedSource(frames, compositor._getReducedFrameIndex(frameIndex, frames.length, sourceSelectionMap?.get(key)));
				}
				const imageData = pixels ? compositor._getFrameImageData(pixels) : null;
				if (!imageData) return;
				const width = Math.round(data.width);
				const height = Math.round(data.height);
				ensureCanvasSize(scratch.source, imageData.width, imageData.height);
				scratch.source.getContext('2d').putImageData(imageData, 0, 0);
				const pad = Math.ceil(compositor._getSparklePadding(layer));
				ensureCanvasSize(scratch.composite, width + pad * 2, height + pad * 2);
				const compositeCtx = scratch.composite.getContext('2d', { alpha: true });
				resetCanvasContext(compositeCtx, scratch.composite.width, scratch.composite.height, image.isPixelated === false);
				const frame = { frameIndex, timestamp, sourceSelectionMap, resolvedFramesBySource };
				const placement = { offsetX: pad, offsetY: pad };
				if (pad) compositor._drawLayerSparkles(compositeCtx, layer, 'behind', frame, placement);
				compositeCtx.save();
				compositeCtx.translate(pad, pad);
				drawFrameImage(compositeCtx, scratch.source, data, width, height);
				compositeCtx.restore();
				if (pad) compositor._drawLayerSparkles(compositeCtx, layer, 'front', frame, placement);
				compositor._drawTransformedCanvas(ctx, scratch.composite, layer, width, height, { pad });
			}
		};
	}
}

Object.assign(FrameLayerManager.prototype, MOVABLE_LAYER_METHODS);

FrameLayerManager.LAYER_TYPE = LayerType.FRAME;
Object.assign(FrameLayerManager.prototype, { getActiveLayer: LAYER_ELEMENT_METHODS.getActiveLayer, clearElements: LAYER_ELEMENT_METHODS.clearElements, removeLayerElement: LAYER_ELEMENT_METHODS.removeLayerElement });
