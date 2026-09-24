// ============================================
// SHAPE GLITTER MANAGER
// ============================================
// Parametric vector-shape layers: circle,
// square, star, heart, each with a glitter-or-solid Fill, optional Border, and
// optional Shadow. Deliberately mirrors TextGlitterManager's span-stack preview
// and effect-slot model — a shape is "text with a shape mask instead of glyphs"
// — reusing the shared leaf modules (ShapeLibrary geometry, color-adjust,
// LayerTransform, and the exporter's generic fill/border/offset helpers).
//
// Every slot (fill, border, shadow) is a self-contained paint slot with its
// own glitterId, scale, opacity and colorAdjust.
//
// Scale answer (the "mixels" question): live drag uses cheap CSS transform;
// on release commitScale() bakes the scale into shapeData.width/height and
// re-rasterizes the mask at the new pixel size — always 1:1, no upscaled raster.

class ShapeGlitterManager {
	constructor(editor) {
		this.editor = editor;
		this.layerElements = new Map();
		this.layerTransforms = new Map();
		this.measurementCache = new Map();
		this.maxMeasurementCacheEntries = 4;
		this.maskUrlCache = new Map();
		// Uploaded pixels stay outside JSON-cloned layer/history state. Layers keep
		// only an immutable ref, so old refs remain available to undo/redo.
		this.imageFillAssets = new Map();
		this.ui = {};
		// Shape id used for the NEXT shape created by the tool (set by the picker).
		this.activeShapeId = CONFIG.tools.shapes.defaultShapeId;
		// Gallery picker session (reuses the shared strip + Done UX from text):
		// { layerId, slot } while the user is choosing a glitter for a slot.
		this.pickerSession = null;
		// Layer whose underlying shape asset is being replaced. Asset replacement
		// and glitter-slot picking are mutually exclusive picker modes.
		this.shapeChangeLayerId = null;
		this.setupUI();
		this.setupEventListeners();
	}

	getActiveShapeId() {
		return this.activeShapeId || CONFIG.tools.shapes.defaultShapeId;
	}

	setupUI() {
		const id = (x) => document.getElementById(x);
		this.ui.section = id('shapeSettingsSection');
		this.ui.picker = id('shapeShapePicker');
		this.ui.gallery = id('shapesOptions');
		this.ui.assetThumbnail = id('shapeAssetThumbnail');
		this.ui.assetName = id('shapeAssetName');
		this.ui.assetChange = id('shapeAssetChange');
		this.ui.radiusRow = id('shapeRadiusRow');
		// Shared gallery picker strip (same DOM the text picker uses).
		this.ui.gallerySection = id('designGallerySection');
		this.ui.pickerStrip = id('galleryPickerStrip');
		this.ui.pickerStripTitle = id('galleryPickerStripTitle');
		this.ui.pickerStripDetail = id('galleryPickerStripDetail');
		this.ui.pickerStripDone = id('galleryPickerStripDone');
		this.ui.resetEffects = id('resetShapeEffects');
		this.ui.fillImageThumbnail = id('shapeFillImageThumbnail');
		this.ui.fillImageName = id('shapeFillImageName');
		this.ui.fillImageChange = id('shapeFillImageChange');
		this.ui.fillImageFit = id('shapeFillImageFit');
		this.ui.fillImageRendering = Array.from(document.querySelectorAll('[data-fill-rendering]'));
		this.ui.fillImageInput = document.createElement('input');
		this.ui.fillImageInput.type = 'file';
		this.ui.fillImageInput.accept = 'image/*';
		this.ui.fillImageInput.hidden = true;
		this.ui.fillImageInput.className = 'ui-ignore-gestures';
		document.body.appendChild(this.ui.fillImageInput);

		this.renderShapePicker();
		this.renderShapeGallery();
	}

	// How the declared field binder (ui/paint-slot-controls.js) edits a shape.
	// Edits that change the mask footprint keep the shape itself in place.
	createFieldHost() {
		return {
			type: LayerType.SHAPE,
			editor: this.editor,
			getLayer: () => this.getActiveShapeLayer(),
			ensureSlot: (layer, key) => this.ensureEffectData(layer, key),
			getSlotDefaults: (key) => this.getSlotDefaults(key),
			apply: (layer, mutate, change) => {
				if (change.geometry) this.mutateGeometryPreservingShape(layer, mutate);
				else mutate();
				this.renderLayer(layer);
				if (change.live) return;
				this.loadLayerSettings(layer);
				this.editor.saveState('Edit shape');
				this.editor.layerManager.renderLayersList();
			},
			render: (layer) => this.renderLayer(layer),
			commit: () => {
				this.editor.saveState('Edit shape');
				this.editor.layerManager.renderLayersList();
			},
			armPicker: (key) => this.armPicker(key),
			afterFieldChange: (layer, key, binding) => {
				if (key === 'fill' && binding.path.startsWith('offset')) this.syncFillImageAlignment(layer.shapeData.fill);
			}
		};
	}

	renderShapePicker() {
		const picker = this.ui.picker;
		if (!picker) return;
		picker.innerHTML = '';
		ShapeLibrary.FILL_SHAPES.forEach(({ id, label }) => {
			const card = createShapeCard(id, label);
			card.setAttribute('role', 'option');
			picker.appendChild(card);
		});
		this._syncPickerActive();
	}

	renderShapeGallery() {
		if (!this.ui.gallery) return;

		const categories = document.createElement('div');
		categories.className = 'shape-gallery-categories';

		ShapeLibrary.FILL_SHAPE_CATEGORIES.forEach(({ id: categoryId, label }) => {
			const shapes = ShapeLibrary.FILL_SHAPES.filter((shape) => shape.category === categoryId);
			if (!shapes.length) return;

			const section = document.createElement('section');
			section.className = 'shape-gallery-section';

			const heading = document.createElement('h3');
			heading.className = 'shape-gallery-heading';
			heading.id = `shapeGallery${categoryId.charAt(0).toUpperCase()}${categoryId.slice(1)}`;
			heading.textContent = label;
			section.appendChild(heading);

			const grid = document.createElement('div');
			grid.className = 'asset-grid shape-gallery-grid';
			grid.setAttribute('aria-labelledby', heading.id);

			shapes.forEach(({ id, label: shapeLabel }) => {
				const card = createShapeCard(id, shapeLabel, { className: 'asset-option shape-gallery-option' });
				card.addEventListener('click', () => {
					const armedLayer = this.editor.layerManager.getLayerById(this.shapeChangeLayerId);
					const targetLayer = armedLayer?.type === LayerType.SHAPE ? armedLayer : this.getActiveShapeLayer();
					if (targetLayer) {
						this.applyShapeToLayer(targetLayer, id);
						if (this.shapeChangeLayerId) this.updatePickerStrip();
						return;
					}
					const layer = this.editor.layerManager.addLayer(LayerType.SHAPE, { shapeLayer: { shapeId: id } });
					if (layer) this.editor.finishLayerCreation(layer);
				});
				grid.appendChild(card);
			});
			section.appendChild(grid);
			categories.appendChild(section);
		});

		this.ui.gallery.replaceChildren(categories);
		this._syncPickerActive();
	}

	_syncPickerActive() {
		const activeLayer = this.getActiveShapeLayer();
		const current = activeLayer ? activeLayer.shapeData.shapeId : this.getActiveShapeId();
		this.ui.picker?.querySelectorAll('.brush-shape-option').forEach((el) => {
			const selected = el.dataset.shape === current;
			el.classList.toggle('active', selected);
			el.setAttribute('aria-selected', selected ? 'true' : 'false');
		});
		this.ui.gallery?.querySelectorAll('.shape-gallery-option').forEach((el) => {
			const selected = el.dataset.shape === current;
			el.classList.toggle('selected', selected);
		});
	}

	setupEventListeners() {
		this.fieldHost = this.createFieldHost();
		bindFieldControls(this.fieldHost);

		[this.ui.assetThumbnail, this.ui.assetChange].filter(Boolean).forEach((control) => {
			control.addEventListener('click', () => this.armShapeAssetPicker());
		});

		// Shape picker: sets the active shape for new shapes, and reshapes the
		// selected layer if one is active.
		this.ui.picker?.addEventListener('click', (event) => {
			const card = event.target.closest('.brush-shape-option');
			if (!card) return;
			this.activeShapeId = card.dataset.shape;
			const layer = this.getActiveShapeLayer();
			if (layer) this.applyShapeToLayer(layer, card.dataset.shape);
			this._syncPickerActive();
		});

		[this.ui.fillImageThumbnail, this.ui.fillImageChange].filter(Boolean).forEach((control) => {
			control.addEventListener('click', () => this.chooseFillImage());
		});
		this.ui.fillImageInput?.addEventListener('change', async () => {
			const file = this.ui.fillImageInput.files?.[0];
			const layerId = this.ui.fillImageInput.dataset.layerId;
			this.ui.fillImageInput.value = '';
			if (file) await this.setFillImageFromFile(layerId, file);
		});
		this.ui.fillImageFit?.addEventListener('change', () => {
			const layer = this.getActiveShapeLayer();
			if (!layer) return;
			const fill = this.ensureEffectData(layer, 'fill');
			const selected = this.ui.fillImageFit.value;
			if (selected === 'tile') {
				fill.fit = 'none';
				fill.tile = true;
			} else {
				fill.fit = normalizeImageFit(selected);
				fill.tile = false;
			}
			this.renderLayer(layer);
			this.editor.saveState('Edit shape');
		});
		this.ui.fillImageRendering.forEach((button) => {
			button.addEventListener('click', () => {
				const layer = this.getActiveShapeLayer();
				if (!layer) return;
				const fill = this.ensureEffectData(layer, 'fill');
				fill.imageRendering = normalizeImageRendering(button.dataset.fillRendering);
				this.syncFillImageRendering(fill);
				this.renderLayer(layer);
				this.editor.saveState('Edit shape');
			});
		});
		document.querySelectorAll('[data-fill-align], [data-fill-valign]').forEach((button) => {
			button.addEventListener('click', () => {
				const layer = this.getActiveShapeLayer();
				if (!layer) return;
				const fill = this.ensureEffectData(layer, 'fill');
				if (button.dataset.fillAlign != null) fill.offsetXPercent = Number(button.dataset.fillAlign);
				if (button.dataset.fillValign != null) fill.offsetYPercent = Number(button.dataset.fillValign);
				this.loadLayerSettings(layer);
				this.renderLayer(layer);
				this.editor.saveState('Edit shape');
			});
		});

		// Shared picker strip: Done (only acts while a shape is armed) + global Esc.
		this.ui.pickerStripDone?.addEventListener('click', () => {
			if (this.getActiveShapeLayer() && (this.pickerSession || this.shapeChangeLayerId)) this.handlePickerDone();
		});
		document.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || (!this.pickerSession && !this.shapeChangeLayerId) || !this.getActiveShapeLayer()) return;
			const a = document.activeElement;
			if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
			if (this.editor.modalManager?.isAnyOpen?.()) return;
			event.preventDefault();
			this.handlePickerDone();
		});

		this.ui.resetEffects?.addEventListener('click', () => this._resetEffects());
	}

	applyShapeToLayer(layer, shapeId) {
		if (!this.editor.canEditLayer(layer, { notify: true })) return false;
		layer.shapeData.shapeId = shapeId;
		layer.name = this.getShapeLabel(shapeId);
		const size = Math.max(layer.shapeData.width, layer.shapeData.height);
		const sized = this.sizeForShape(shapeId, size);
		layer.shapeData.width = sized.width;
		layer.shapeData.height = sized.height;
		this.invalidateMeasurement(layer);
		this.renderLayer(layer);
		this.loadLayerSettings(layer);
		this.editor.saveState('Edit shape');
		this.editor.layerManager.renderLayersList();
		return true;
	}

	chooseFillImage() {
		const layer = this.getActiveShapeLayer();
		if (!layer || !this.ui.fillImageInput) return;
		this.ui.fillImageInput.dataset.layerId = layer.id;
		this.ui.fillImageInput.click();
	}

	async setFillImageFromFile(layerId, file) {
		const layer = this.editor.layerManager.getLayerById(layerId);
		if (!layer || layer.type !== LayerType.SHAPE) return false;
		const maxSize = CONFIG.tools.shapes.imageFill.maxUploadSize;
		if (!file.type?.startsWith('image/')) {
			this.editor.showError('Please choose a valid image file.');
			return false;
		}
		if (file.size > maxSize) {
			this.editor.showError(`File is too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB.`);
			return false;
		}
		try {
			const dataUrl = await this.readFileAsDataUrl(file);
			const imageRef = `shape-fill-${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
			await this.registerImageFillAsset(imageRef, {
				dataUrl,
				name: file.name,
				mimeType: file.type
			});
			const targetLayer = this.editor.layerManager.getLayerById(layerId);
			if (!targetLayer || targetLayer.type !== LayerType.SHAPE) {
				this.pruneImageFillAssets();
				return false;
			}
			const fill = this.ensureEffectData(targetLayer, 'fill');
			fill.imageRef = imageRef;
			fill.mode = 'image';
			this.renderLayer(targetLayer);
			if (this.getActiveShapeLayer()?.id === targetLayer.id) this.loadLayerSettings(targetLayer);
			this.editor.saveState('Edit shape');
			this.editor.layerManager.renderLayersList();
			return true;
		} catch (error) {
			this.editor.showError(error.message || 'Could not load that image.');
			return false;
		}
	}

	readFileAsDataUrl(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(new Error('Could not read that image.'));
			reader.readAsDataURL(file);
		});
	}

	async registerImageFillAsset(imageRef, payload) {
		if (!imageRef || !payload?.dataUrl) return null;
		const image = await new Promise((resolve, reject) => {
			const candidate = new Image();
			candidate.onload = () => resolve(candidate);
			candidate.onerror = () => reject(new Error('Could not decode that image.'));
			candidate.src = payload.dataUrl;
		});
		const asset = {
			image,
			url: payload.dataUrl,
			dataUrl: payload.dataUrl,
			name: payload.name || 'Image',
			mimeType: payload.mimeType || 'image/png',
			// Multi-frame GIFs are decoded only when an export needs them
			// (SceneCompositor), like glitter and sticker GIFs. isAnimated is a
			// cheap up-front probe (readGifTiming decodes no pixels) so the
			// exporter knows which slots to ask for.
			isAnimated: false
		};
		if (asset.mimeType === 'image/gif') {
			try {
				asset.isAnimated = await this._probeAnimatedGif(payload.dataUrl);
			} catch (error) {
				console.warn('Animated GIF probe failed; treating fill as static.', error);
			}
		}
		this.imageFillAssets.set(imageRef, asset);
		return asset;
	}

	async _probeAnimatedGif(dataUrl) {
		return readGifTiming(await fetchGifBytes(dataUrl)).frameCount > 1;
	}

	getImageFillAsset(imageRef) {
		return imageRef ? this.imageFillAssets.get(imageRef) || null : null;
	}

	clearImageFillAssets() {
		this.imageFillAssets.clear();
	}

	pruneImageFillAssets() {
		const used = new Set();
		const collect = (layers) => (layers || []).forEach((layer) => {
			const imageRef = layer?.type === LayerType.SHAPE ? layer.shapeData?.fill?.imageRef : null;
			if (imageRef) used.add(imageRef);
		});
		collect(this.editor.layers);
		(this.editor.historyManager?.history || []).forEach((state) => collect(state.layers));
		Array.from(this.imageFillAssets.keys()).forEach((imageRef) => {
			if (!used.has(imageRef)) this.imageFillAssets.delete(imageRef);
		});
	}

	// Shared transform interface (same contract as StickerManager.updateTransform)
	// so app.setupTransformListeners drives the shape's Position/Transform/Scale/
	// Flip panel exactly like stickers and text. Scale is applied as a live CSS
	// transform here; the transform HANDLES bake it to a crisp pixel size on
	// release (LayerTransform.commitScale).
	updateTransform(layerId, updates) {
		const transform = this.layerTransforms.get(layerId);
		if (!transform) return;
		transform.updateTransform(updates);
		const layer = this.editor.layerManager.getLayerById(layerId);
		const element = this.layerElements.get(layerId);
		if (layer && element) {
			const measurement = this.getMeasurementEntry(layer);
			transform.applyTransform(element, { width: measurement.width, height: measurement.height });
			if (transform.transformHandles) transform.updateHandlePositions();
		}
	}

	_resetEffects() {
		const layer = this.getActiveShapeLayer();
		if (!layer) return;
		this.mutateGeometryPreservingShape(layer, () => {
			layer.shapeData.border = null;
			layer.shapeData.shadow = null;
			delete layer.shapeData.effectDrafts;
			delete layer.animation;
		});
		this.loadLayerSettings(layer);
		this.renderLayer(layer);
		this.editor.animationPanel?.load(layer);
		this.editor.saveState('Edit shape');
		this.editor.layerManager.renderLayersList();
	}

	// ===== GALLERY PICKER SESSION (reuses the text strip + Done UX) =====

	// Arm a slot for glitter picking: open the gallery, show the strip naming the
	// destination + a Done button. Gallery clicks then route to this slot (see
	// GlitterManager.selectGlitter's shape branch).
	armPicker(slot) {
		const layer = this.getActiveShapeLayer();
		if (!layer) return;
		this.shapeChangeLayerId = null;
		pickerOpenSession(this, { layerId: layer.id, slot }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => revealAssetBrowser(this.editor, this.editor.glitterManager)
		});
	}

	armShapeAssetPicker() {
		const layer = this.getActiveShapeLayer();
		if (!layer) return;
		this.shapeChangeLayerId = layer.id;
		pickerCloseSession(this, { refresh: () => this.updatePickerStrip() });
		this.updatePickerStrip();
		revealAssetBrowser(this.editor);
		requestAnimationFrame(() => requestAnimationFrame(() => {
			this.ui.gallery?.scrollTo?.({ top: 0, behavior: 'smooth' });
		}));
	}

	closePickerSession() {
		pickerCloseSession(this, {
			refresh: () => this.updatePickerStrip(),
			updateSelection: () => this.editor.updateGlitterSelection()
		});
	}

	// Which shape slot the next gallery pick targets ('fill' when not armed).
	getGlitterSelectionTarget() {
		const layer = this.getActiveShapeLayer();
		return pickerSelectionTarget(this, layer, { fallback: 'fill' });
	}

	// The glitter id the gallery should highlight for this layer — the armed
	// slot's glitter (so choosing a border glitter highlights the border's swatch).
	resolveSelectedGlitterId(layer) {
		if (!layer || layer.type !== LayerType.SHAPE) return null;
		return this.getSlotGlitterId(layer, this.getGlitterSelectionTarget());
	}

	updatePickerStrip() {
		const strip = this.ui.pickerStrip;
		if (!strip) return;
		const layer = this.getActiveShapeLayer();
		const assetArmed = Boolean(layer && this.shapeChangeLayerId === layer.id);
		const s = this.pickerSession;
		const slotExists = s && (s.slot === 'fill' || Boolean(this.getEffectData(layer, s.slot)));
		const armed = Boolean(layer && s && s.layerId === layer.id && slotExists);

		// Only drive the strip while a shape is active; otherwise leave it to the
		// text manager (both are called from app.updateSidePanelUI).
		if (!layer) return;

		const stripText = assetArmed
			? formatAssetPickerStripText('shape', layer.name)
			: formatPickerStripText(armed ? s.slot : 'fill', layer.name, 'shape');
		renderPickerStrip({
			ownsStrip: true,
			visible: true,
			armed: armed || assetArmed,
			hint: !armed && !assetArmed,
			pickerMode: armed,
			...stripText
		});
	}

	// Done/Esc from the shared strip when a shape is active.
	handlePickerDone() {
		if (this.shapeChangeLayerId) {
			this.shapeChangeLayerId = null;
			this.updatePickerStrip();
			this.returnToShapeProperties('asset');
			return;
		}
		const slot = this.pickerSession?.slot || 'fill';
		this.closePickerSession();
		this.returnToShapeProperties(slot);
	}

	returnToShapeProperties(slot = 'fill') {
		const chipId = slot === 'asset'
			? 'shapeAssetChange'
			: slot === 'border'
				? 'shapeBorderGlitterChip'
				: slot === 'shadow' ? 'shapeShadowGlitterChip' : 'shapeFillGlitterChip';
		returnFromPickerToProperties(this.editor, { section: 'shapeSettings', focusId: chipId });
	}

	loadLayerSettings(layer) {
		if (!layer || layer.type !== LayerType.SHAPE) return;
		const d = layer.shapeData;
		if (this.ui.assetThumbnail) this.ui.assetThumbnail.innerHTML = ShapeLibrary.getIconSvg(d.shapeId);
		if (this.ui.assetName) this.ui.assetName.textContent = this.getShapeLabel(d.shapeId);
		if (this.ui.radiusRow) this.ui.radiusRow.hidden = !LAYER_UI_CONFIG[LayerType.SHAPE].supportsCornerRadius(layer);

		this._syncPickerActive();

		// Position/Transform/Scale/Flip use the shared transform panel.
		this.editor.loadTransformSettings?.(layer, 'shape');
		syncFieldControls(this.fieldHost, layer);
		this.syncFillImageControls(d.fill);

		// This method writes slider values and option-active classes directly, which
		// fires no events; sweep the reverts so they match what's on screen (the
		// sticker/text/glitter panels get this sweep via loadActiveLayerSettings —
		// shapes load through LAYER_UI_CONFIG.onActivate instead).
		syncPropertyReverts();
	}

	// The image source's asset display, fit, alignment and sampling. Its scale
	// and position sliders are declared fill fields.
	syncFillImageControls(fill) {
		const asset = this.getImageFillAsset(fill?.imageRef);
		if (this.ui.fillImageThumbnail) {
			this.ui.fillImageThumbnail.replaceChildren();
			if (asset) {
				const image = document.createElement('img');
				image.src = asset.url;
				image.alt = '';
				this.ui.fillImageThumbnail.appendChild(image);
			}
			this.ui.fillImageThumbnail.classList.toggle('empty', !asset);
		}
		if (this.ui.fillImageName) this.ui.fillImageName.textContent = asset?.name || 'No image selected';
		if (this.ui.fillImageChange) this.ui.fillImageChange.textContent = asset ? 'Change' : 'Choose Image';
		if (this.ui.fillImageFit) {
			const normalizedFit = normalizeImageFit(fill?.fit);
			this.ui.fillImageFit.value = (normalizedFit === 'none' && fill?.tile) ? 'tile' : normalizedFit;
		}
		this.syncFillImageAlignment(fill);
		this.syncFillImageRendering(fill);
	}

	syncFillImageRendering(fill) {
		const rendering = normalizeImageRendering(fill?.imageRendering);
		this.ui.fillImageRendering.forEach((button) => {
			const active = button.dataset.fillRendering === rendering;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
	}

	syncFillImageAlignment(fill) {
		const x = normalizeImagePositionPercent(fill?.offsetXPercent);
		const y = normalizeImagePositionPercent(fill?.offsetYPercent);
		document.querySelectorAll('[data-fill-align]').forEach((button) => {
			const active = Number(button.dataset.fillAlign) === x;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
		document.querySelectorAll('[data-fill-valign]').forEach((button) => {
			const active = Number(button.dataset.fillValign) === y;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
	}

	// ===== DEFAULTS / DATA MODEL =====

	getDefaultFill() {
		return buildDefaultFill({ defaultGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId.shape });
	}

	getDefaultBorder() {
		return buildDefaultBorder({
			config: CONFIG.tools.shapes.border,
			slot: getPaintSlotDefinition(LayerType.SHAPE, 'border'),
			fallbackMode: 'glitter',
			includeShapeStyle: true,
			includeColorAdjust: true,
			defaultGlitterId: CONFIG.tools.glitter.defaults.borderGlitterId.shape
		});
	}

	getDefaultShadow() {
		return buildDefaultShadow({
			defaultMode: 'glitter',
			defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId.shape,
			includeColorAdjust: true
		});
	}

	getSlotDefaults(key) {
		if (key === 'border') return this.getDefaultBorder();
		if (key === 'shadow') return this.getDefaultShadow();
		return this.getDefaultFill();
	}

	// Runs where a shape enters the document (create, deserialize, project
	// load). Getters and render paths read the canonical shape directly.
	normalizeLayer(layer) {
		if (!layer || layer.type !== LayerType.SHAPE) return;
		const data = layer.shapeData;
		data.cornerRadiusPx ??= FIELDS.shapeRadius.value;
		data.fill = mergeSlotEffectDefaults(data.fill, this.getDefaultFill());
		if (data.border === undefined) data.border = null;
		if (data.border) data.border = mergeSlotEffectDefaults(data.border, this.getDefaultBorder());
		if (data.shadow === undefined) data.shadow = null;
		if (data.shadow) data.shadow = mergeSlotEffectDefaults(data.shadow, this.getDefaultShadow());
		normalizeSlotTextureCoordinates(data.fill);
		normalizeSlotTextureCoordinates(data.border);
		normalizeSlotTextureCoordinates(data.shadow);
		layer.transform ||= createDefaultTransform();
	}

	getShapeLabel(shapeId) {
		const entry = ShapeLibrary.FILL_SHAPES.find((s) => s.id === shapeId);
		return entry ? entry.label : 'Shape';
	}

	createLayer(options = {}) {
		if (!this.editor.layerManager.requireLayerCapacity()) return null;

		const shapeId = options.shapeId || CONFIG.tools.shapes.defaultShapeId;
		// A drag supplies an explicit box (stretch allowed); a click supplies no
		// size, so derive width/height from the shape's natural aspect so it isn't
		// distorted (a regular hexagon/triangle isn't square).
		let width;
		let height;
		if (options.width && options.height) {
			width = Math.max(CONFIG.tools.shapes.minSize, Math.round(options.width));
			height = Math.max(CONFIG.tools.shapes.minSize, Math.round(options.height));
		} else {
			const sized = this.sizeForShape(shapeId, CONFIG.tools.shapes.defaultSize);
			width = sized.width;
			height = sized.height;
		}
		const position = options.position || {
			x: this.editor.originalCanvas.width / 2,
			y: this.editor.originalCanvas.height / 2
		};
		const transform = createDefaultTransform({
			position: { x: position.x, y: position.y }
		});

		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.SHAPE,
			name: this.getShapeLabel(shapeId),
			visible: true,
			locked: false,
			opacity: FIELDS.layerOpacity.value,
			transform,
			shapeData: {
				shapeId,
				width,
				height,
				fill: this.getDefaultFill(),
				border: null,
				shadow: null
			}
		};

		this.normalizeLayer(layer);
		return layer;
	}

	// Width/height for a shape at a given nominal size, preserving its natural
	// aspect (larger dimension = size).
	sizeForShape(shapeId, size) {
		const aspect = ShapeLibrary.getAspect(shapeId);
		const min = CONFIG.tools.shapes.minSize;
		if (aspect >= 1) {
			return { width: Math.max(min, Math.round(size)), height: Math.max(min, Math.round(size / aspect)) };
		}
		return { width: Math.max(min, Math.round(size * aspect)), height: Math.max(min, Math.round(size)) };
	}

	getActiveShapeLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type === LayerType.SHAPE) {
			return layer;
		}
		return null;
	}

	getEffectData(layer, slot) {
		return getSlotEffectData(layer?.shapeData, slot);
	}

	ensureEffectData(layer, slot) {
		if (!layer?.shapeData) return null;
		return ensureSlotEffectData(layer.shapeData, slot, {
			builders: {
				fill: () => this.getDefaultFill(),
				border: () => this.getDefaultBorder(),
				shadow: () => this.getDefaultShadow()
			}
		});
	}

	getBorderOutsidePadding(borderData) {
		return getBorderOutsidePadding(borderData, {
			miterLimit: CONFIG.tools.shapes.border.hardEdgeMiterLimit
		});
	}

	getSlotGlitterId(layer, slot) {
		return this.getEffectData(layer, slot)?.glitterId;
	}

	getEffectPaintSource(layer, key) {
		const entry = getLayerPaintSlots(layer).find((slot) => slot.key === key);
		return entry ? resolvePaintSlotPreviewSource(this.editor, layer, entry) : null;
	}

	// ===== MASK / MEASUREMENT =====

	getMeasurementCacheKey(layer) {
		const d = layer.shapeData;
		return JSON.stringify([
			d.shapeId,
			d.width,
			d.height,
			LAYER_UI_CONFIG[LayerType.SHAPE].supportsCornerRadius(layer) ? d.cornerRadiusPx : null,
			d.border ? [d.border.widthPx, d.border.style || 'solid', d.border.dotSpacingPx ?? this.getDefaultBorder().dotSpacingPx, getBorderPlacement(d.border), getBorderEdgeStyle(d.border)] : null,
			d.shadow ? [d.shadow.offsetX, d.shadow.offsetY] : null,
			shouldUseCrispMaskEdges(),
			CONFIG.rendering.maskAlphaThreshold
		]);
	}

	// Rasterize the shape into a padded mask canvas (crisp-thresholded like text,
	// per CONFIG.rendering.crispMaskEdges — same GIF-fringe reasoning). Returns the
	// canvas plus the shape's body and visual rects within it.
	getMeasurementEntry(layer) {
		const key = this.getMeasurementCacheKey(layer);
		const cached = this.measurementCache.get(key);
		if (cached) {
			this.measurementCache.delete(key);
			this.measurementCache.set(key, cached);
			layer.shapeData.renderWidth = cached.width;
			layer.shapeData.renderHeight = cached.height;
			return cached;
		}

		const d = layer.shapeData;
		const w = d.width;
		const h = d.height;
		const padding = CONFIG.rendering?.maskPaddingPx ?? 8;
		// Canvas allocation reserves the worst-case hard-miter spike (miterLimit ×
		// width) so a star point never clips; the user-facing frame uses only the
		// nominal outward border extent so the transform box hugs the shape instead
		// of the reservation. For round edges the two are equal.
		const borderReserve = this.getBorderOutsidePadding(d.border);
		const borderExtent = getBorderOutsidePadding(d.border);
		const shX = d.shadow?.offsetX || 0;
		const shY = d.shadow?.offsetY || 0;

		const inkLeft = Math.min(-borderReserve, shX);
		const inkRight = Math.max(w + borderReserve, w + shX);
		const inkTop = Math.min(-borderReserve, shY);
		const inkBottom = Math.max(h + borderReserve, h + shY);

		const frameLeft = Math.min(-borderExtent, shX);
		const frameRight = Math.max(w + borderExtent, w + shX);
		const frameTop = Math.min(-borderExtent, shY);
		const frameBottom = Math.max(h + borderExtent, h + shY);

		const layoutX = padding - inkLeft;
		const layoutY = padding - inkTop;
		const canvasWidth = Math.max(1, Math.ceil(inkRight - inkLeft + padding * 2));
		const canvasHeight = Math.max(1, Math.ceil(inkBottom - inkTop + padding * 2));

		const canvas = createAppCanvas(0, 0, 'layers/ShapeGlitterManager');
		canvas.width = canvasWidth;
		canvas.height = canvasHeight;
		canvas._textureOrigin = { x: layoutX, y: layoutY };
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.clearRect(0, 0, canvasWidth, canvasHeight);
		ctx.fillStyle = '#ffffff';
		ctx.save();
		ctx.translate(layoutX + w / 2, layoutY + h / 2);
		// trace() fills the shape at the current origin (ShapeLibrary is the single
		// geometry source shared with the brush + the picker thumbnails).
		ShapeLibrary.trace(d.shapeId, ctx, w / 2, h / 2, { fit: 'fill', cornerRadiusPx: d.cornerRadiusPx });
		ctx.restore();

		if (shouldUseCrispMaskEdges()) {
			binarizeCanvasAlpha(ctx, canvasWidth, canvasHeight);
		}

		const entry = {
			key,
			canvas,
			width: canvasWidth,
			height: canvasHeight,
			// Every visible pixel: body plus shadow (the layer's visual bounds).
			frameRect: {
				x: layoutX + frameLeft,
				y: layoutY + frameTop,
				width: frameRight - frameLeft,
				height: frameBottom - frameTop
			},
			// The layer's frame: the shape plus its nominal outward border, no
			// shadow (handles, hit-testing, alignment; see getShapeBodyFrame).
			bodyRect: {
				x: layoutX - borderExtent,
				y: layoutY - borderExtent,
				width: w + borderExtent * 2,
				height: h + borderExtent * 2
			},
			shapeRect: { x: layoutX, y: layoutY, width: w, height: h },
			// Kept so the border can be re-derived as a vector STROKE of the path
			// (smooth) rather than a ring-union of the raster silhouette (scalloped).
			shapeId: d.shapeId,
			shapeW: w,
			shapeH: h,
			cornerRadiusPx: d.cornerRadiusPx,
			layoutX,
			layoutY
		};
		canvas._paintBox = entry.shapeRect;

		this.measurementCache.set(key, entry);
		while (this.measurementCache.size > this.maxMeasurementCacheEntries) {
			const oldestKey = this.measurementCache.keys().next().value;
			this.measurementCache.delete(oldestKey);
		}
		d.renderWidth = canvasWidth;
		d.renderHeight = canvasHeight;
		return entry;
	}

	// Layer frame (see getLayerFrame): the shape plus its nominal outward border.
	// Uses the nominal border extent, not the hard-miter canvas reservation, so
	// the box hugs the shape instead of the reservation.
	getShapeBodyFrame(layer, measurement = null) {
		if (!layer?.shapeData) return null;
		const entry = measurement || this.getMeasurementEntry(layer);
		return frameFromCanvasRect(entry.bodyRect, entry.width, entry.height);
	}

	// Layer visual bounds: the body plus shadow.
	getShapeVisualFrame(layer, measurement = null) {
		if (!layer?.shapeData) return null;
		const entry = measurement || this.getMeasurementEntry(layer);
		return frameFromCanvasRect(entry.frameRect, entry.width, entry.height);
	}

	// A smooth OUTER border, calculated by stroking the shape's actual vector path
	// (uniform lineWidth in output space) instead of unioning N offset copies of
	// the raster silhouette — no scalloping on sharp corners like a star's points.
	// The stroke is 2×widthPx (centered on the edge), then the shape silhouette is
	// punched out so only the outer widthPx ring remains: this reads as an outline
	// on a no-fill shape and sits cleanly around the fill otherwise.
	getBorderMaskCanvas(measurement, borderData) {
		const widthPx = Math.max(0, borderData?.widthPx || 0);
		if (widthPx <= 0) {
			return null;
		}

		const borderStyle = borderData?.style === 'dotted' ? 'dotted' : 'solid';
		const drawOrder = getBorderDrawOrder(borderData);
		const placement = getBorderPlacement(borderData);
		const edgeStyle = getBorderEdgeStyle(borderData);
		const effectivePlacement = borderStyle === 'dotted' && placement === 'outside' && drawOrder === 'front'
			? 'center'
			: placement;
		const dotSpacingPx = Math.max(1, borderData?.dotSpacingPx ?? this.getDefaultBorder().dotSpacingPx);
		const canvas = createAppCanvas(0, 0, 'layers/ShapeGlitterManager');
		canvas.width = measurement.canvas.width;
		canvas.height = measurement.canvas.height;
		canvas._textureOrigin = { ...measurement.canvas._textureOrigin };
		const ctx = canvas.getContext('2d', { willReadFrequently: true });

		const path = ShapeLibrary.buildTransformedPath(measurement.shapeId, measurement.shapeW / 2, measurement.shapeH / 2, {
			fit: 'fill',
			cornerRadiusPx: measurement.cornerRadiusPx
		});
		ctx.save();
		ctx.translate(measurement.layoutX + measurement.shapeW / 2, measurement.layoutY + measurement.shapeH / 2);
		ctx.strokeStyle = '#ffffff';
		if (edgeStyle === 'hard') {
			ctx.lineJoin = 'miter';
			// 'inside' clips a double-width centered stroke to the shape path rather
			// than offsetting it, so at a reflex/concave vertex (a heart's inner
			// notch, a star's inner corners) a long miter spike self-intersects the
			// clip and splits the fill into disconnected slivers. outside/center
			// don't clip, so they're free to use the full configured limit to keep
			// convex points (star, sparkle) from bevelling off.
			ctx.miterLimit = effectivePlacement === 'inside'
				? CONFIG.tools.shapes.border?.hardEdgeInsideMiterLimit ?? 2
				: Math.max(1, CONFIG.tools.shapes.border?.hardEdgeMiterLimit ?? 2);
			ctx.lineCap = borderStyle === 'dotted' ? 'square' : 'butt';
		} else {
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';
		}
		if (effectivePlacement === 'inside') {
			ctx.save();
			ctx.clip(path);
		}
		if (borderStyle === 'dotted') {
			ctx.lineWidth = effectivePlacement === 'center' ? widthPx : widthPx * 2;
			ctx.setLineDash([0, widthPx + dotSpacingPx]);
		} else {
			ctx.lineWidth = effectivePlacement === 'center' ? widthPx : widthPx * 2;
		}
		ctx.stroke(path);
		if (effectivePlacement === 'inside') {
			ctx.restore();
		}
		ctx.restore();

		if (effectivePlacement === 'outside') {
			ctx.globalCompositeOperation = 'destination-out';
			ctx.drawImage(measurement.canvas, 0, 0);
			ctx.globalCompositeOperation = 'source-over';
		}

		if (shouldUseCrispMaskEdges()) {
			binarizeCanvasAlpha(ctx);
		}
		return canvas;
	}

	// Every slot mask for a shape in local render space, keyed by slot key.
	// The preview (getSlotMask) and the exporter (renderSlotMasks callback)
	// build masks through the same functions, so they never diverge. Export
	// bakes the shadow offset into its mask; preview translates the span.
	renderSlotMasks(layer) {
		const measurement = this.getMeasurementEntry(layer);
		const masks = {
			fill: measurement.canvas,
			renderWidth: measurement.width,
			renderHeight: measurement.height,
			measurement
		};
		getLayerPaintSlots(layer).forEach((entry) => {
			if (!entry.renders || entry.key === 'fill') return;
			masks[entry.key] = entry.role === 'shadow'
				? createOffsetMaskCanvas(measurement.canvas, entry.data.offsetX || 0, entry.data.offsetY || 0)
				: this.getBorderMaskCanvas(measurement, entry.data);
		});
		return masks;
	}

	// ===== PREVIEW RENDER (span stack) =====

	renderContent(layersToShow) {
		const keep = new Set();
		layersToShow.forEach((layer) => {
			if (layer.type === LayerType.SHAPE) keep.add(layer.id);
		});
		Array.from(this.layerElements.keys()).forEach((layerId) => {
			if (!keep.has(layerId)) this.removeLayerElement(layerId);
		});
		layersToShow.forEach((layer) => {
			if (layer.type === LayerType.SHAPE) this.renderLayer(layer);
		});
	}

	clearElements() {
		Array.from(this.layerElements.keys()).forEach((layerId) => this.removeLayerElement(layerId));
	}

	renderLayer(layer) {
		if (layer.type !== LayerType.SHAPE) return;

		let wrapper = this.layerElements.get(layer.id);
		let stack = wrapper?.querySelector('.shape-glitter-stack');

		if (!wrapper) {
			wrapper = document.createElement('div');
			wrapper.className = 'shape-glitter-element';
			wrapper.dataset.layerId = layer.id;
			wrapper.setAttribute('role', 'img');
		}
		if (!stack) {
			stack = document.createElement('div');
			stack.className = 'shape-glitter-stack';
			wrapper.replaceChildren(stack);
		}

		wrapper.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);
		wrapper.style.opacity = String(layer.opacity / 100);
		if (!wrapper.parentNode) {
			this.editor.canvasElementsContainer.appendChild(wrapper);
		}
		this.layerElements.set(layer.id, wrapper);

		if (!this.layerTransforms.has(layer.id)) {
			const transform = new LayerTransform(layer, this.editor);
			transform.element = wrapper;
			transform.setupMouseDrag(wrapper);
			this.layerTransforms.set(layer.id, transform);
		}

		const measurement = this.getMeasurementEntry(layer);
		this.reconcileSpans(stack, layer, measurement);
		syncLayerAnimationPreview(wrapper, layer, this.editor.animationTicker);
		wrapper.setAttribute('aria-label', this.getShapeLabel(layer.shapeData.shapeId));

		const transform = this.layerTransforms.get(layer.id);
		if (transform) {
			transform.layer = layer;
			transform.element = wrapper;
			transform.applyTransform(wrapper, { width: measurement.width, height: measurement.height });
			if (
				layer.id === this.editor.layerManager.activeLayerId &&
				this.editor.currentTool === ToolType.SELECT &&
				!this.editor.layerManager.hasMultiSelection()
			) {
				if (!transform.isDraggingHandle) transform.createTransformHandles();
			} else {
				transform.removeTransformHandles();
			}
		}

		this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);
	}

	reconcileSpans(stack, layer, measurement) {
		this.syncStackGeometry(stack, layer, measurement);
		reconcileSlotStack(stack, this.getSlotStack(layer), {
			spanClassName: 'shape-glitter-content',
			width: measurement.width,
			height: measurement.height,
			layer,
			glitterLibrary: this.editor.glitterLibrary,
			getMask: (item) => {
				const mask = this.getSlotMask(measurement, item);
				return mask && { canvas: mask.canvas, url: this.getPreviewMaskDataUrl(mask.canvas, mask.cacheKey) };
			}
		});
	}

	getSlotStack(layer) {
		return buildSlotStack(layer, (entry) => resolvePaintSlotPreviewSource(this.editor, layer, entry));
	}

	// The mask a slot paints through: the vector-stroked border mask, or the
	// shape silhouette for the fill and (offset by the caller) the shadow.
	getSlotMask(measurement, slot) {
		if (slot.key === 'border') {
			const border = slot.data;
			return {
				canvas: this.getBorderMaskCanvas(measurement, border),
				cacheKey: `${measurement.key}|border:${border.widthPx}:${border.style || 'solid'}:${border.dotSpacingPx ?? this.getDefaultBorder().dotSpacingPx}:${getBorderPlacement(border)}:${getBorderDrawOrder(border)}:${getBorderEdgeStyle(border)}`
			};
		}
		return { canvas: measurement.canvas, cacheKey: `${measurement.key}|fill` };
	}

	getPreviewMaskDataUrl(canvas, cacheKey) {
		if (this.maskUrlCache.has(cacheKey)) return this.maskUrlCache.get(cacheKey);
		const url = canvas.toDataURL('image/png');
		this.maskUrlCache.set(cacheKey, url);
		// Bound the cache so long editing sessions don't grow it forever.
		if (this.maskUrlCache.size > 64) {
			const firstKey = this.maskUrlCache.keys().next().value;
			this.maskUrlCache.delete(firstKey);
		}
		return url;
	}

	syncStackGeometry(stack, layer, measurement = null) {
		if (!stack || !layer?.shapeData) return;
		const entry = measurement || this.getMeasurementEntry(layer);
		const scaleX = (layer.transform.scale.x || 100) / 100;
		const scaleY = (layer.transform.scale.y || 100) / 100;
		stack.style.position = 'relative';
		stack.style.width = `${entry.width}px`;
		stack.style.height = `${entry.height}px`;
		stack.style.transform = `scale(${scaleX}, ${scaleY})`;
		stack.style.setProperty('--layer-scale', String(Math.max(scaleX, scaleY) || 1));

		// Hover outline follows the layer's frame.
		const frame = this.getShapeBodyFrame(layer, entry);
		if (frame) {
			const left = (entry.width / 2) + frame.offsetX - (frame.width / 2);
			const top = (entry.height / 2) + frame.offsetY - (frame.height / 2);
			stack.style.setProperty('--tf-top', `${top}px`);
			stack.style.setProperty('--tf-left', `${left}px`);
			stack.style.setProperty('--tf-right', `${entry.width - left - frame.width}px`);
			stack.style.setProperty('--tf-bottom', `${entry.height - top - frame.height}px`);
		}
	}

	// Called by LayerTransform.applyTransform during handle drags. Canvas-
	// anchored repeats must be re-registered as the object transform changes.
	syncElementScale(layer, wrapper = this.layerElements.get(layer?.id)) {
		const stack = wrapper?.querySelector('.shape-glitter-stack');
		if (!stack) return;
		const measurement = this.getMeasurementEntry(layer);
		this.syncStackGeometry(stack, layer, measurement);
		syncSlotStackTextureOrigins(stack, this.getSlotStack(layer), layer, (item) => this.getSlotMask(measurement, item).canvas);
	}

	// ===== TRANSFORM COMMIT (re-rasterize on scale) =====

	// Bake a committed CSS scale into the shape's intrinsic pixel size and reset
	// scale to 100, then re-measure — so a scaled-up shape has crisp 1:1 edges
	// instead of an upscaled raster (the "mixels" fix). Called by LayerTransform
	// on scale-handle release.
	commitScale(layer) {
		if (!layer || layer.type !== LayerType.SHAPE) return;
		const t = layer.transform;
		const sx = (t.scale.x || 100) / 100;
		const sy = (t.scale.y || 100) / 100;
		if (Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3) return;

		layer.shapeData.width = Math.max(CONFIG.tools.shapes.minSize, Math.round(layer.shapeData.width * sx));
		layer.shapeData.height = Math.max(CONFIG.tools.shapes.minSize, Math.round(layer.shapeData.height * sy));
		const effectScale = Math.max(sx, sy);
		if (layer.shapeData.border && PREFERENCES.get('scaleEffects')) {
			layer.shapeData.border.widthPx = Math.max(1, Math.round(layer.shapeData.border.widthPx * effectScale));
			layer.shapeData.border.dotSpacingPx = Math.max(1, layer.shapeData.border.dotSpacingPx * effectScale);
		}
		if (layer.shapeData.shadow && PREFERENCES.get('scaleEffects')) {
			layer.shapeData.shadow.offsetX *= sx;
			layer.shapeData.shadow.offsetY *= sy;
		}
		if (PREFERENCES.get('scaleTextures')) {
			layer.shapeData.fill.scale = roundSlotTextureScale((layer.shapeData.fill.scale ?? 100) * effectScale);
			if (layer.shapeData.border) {
				layer.shapeData.border.scale = roundSlotTextureScale((layer.shapeData.border.scale ?? 100) * effectScale);
			}
			if (layer.shapeData.shadow) {
				layer.shapeData.shadow.scale = roundSlotTextureScale((layer.shapeData.shadow.scale ?? 100) * effectScale);
			}
		}
		t.scale.x = 100;
		t.scale.y = 100;
		this.invalidateMeasurement(layer);
		this.renderLayer(layer);
		// Border/fill/shadow sliders show pre-commit values otherwise (e.g. border
		// width baked larger by the scale) until the layer is reselected.
		this.loadLayerSettings(layer);
		// Baked values are no longer the defaults those sliders shipped with.
		syncPropertyReverts();
	}

	setShapeSize(layer, width, height) {
		if (!layer || layer.type !== LayerType.SHAPE) return false;
		layer.shapeData.width = Math.max(CONFIG.tools.shapes.minSize, Math.round(width));
		layer.shapeData.height = Math.max(CONFIG.tools.shapes.minSize, Math.round(height));
		this.invalidateMeasurement(layer);
		this.renderLayer(layer);
		this.loadLayerSettings(layer);
		this.editor.layerManager.renderLayersList();
		return true;
	}

	// ===== SETTINGS / UI =====

	centerHorizontal(layerId) {
		movableCenterHorizontal(this, layerId, (layer) => this.loadLayerSettings(layer));
	}

	centerVertical(layerId) {
		movableCenterVertical(this, layerId, (layer) => this.loadLayerSettings(layer));
	}

	alignToCanvas(layerId, mode) {
		movableAlignToCanvas(this, layerId, mode, (layer) => this.loadLayerSettings(layer));
	}

	resetTransform(layerId) {
		movableResetTransform(this, layerId, (layer) => this.loadLayerSettings(layer));
	}

	// ===== HOUSEKEEPING =====

	mutateGeometryPreservingShape(layer, mutate) {
		const before = this.getMeasurementEntry(layer);
		const beforeRect = before.shapeRect;
		const transform = getLayerTransform(layer);
		const scaleX = (transform.scale.x || 100) / 100;
		const scaleY = (transform.scale.y || 100) / 100;
		const rotation = (transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotation);
		const sin = Math.sin(rotation);
		const localBeforeX = beforeRect.x + beforeRect.width / 2 - before.width / 2;
		const localBeforeY = beforeRect.y + beforeRect.height / 2 - before.height / 2;
		const worldX = transform.position.x + localBeforeX * scaleX * cos - localBeforeY * scaleY * sin;
		const worldY = transform.position.y + localBeforeX * scaleX * sin + localBeforeY * scaleY * cos;

		mutate();
		this.invalidateMeasurement(layer);

		const after = this.getMeasurementEntry(layer);
		const afterRect = after.shapeRect;
		const localAfterX = afterRect.x + afterRect.width / 2 - after.width / 2;
		const localAfterY = afterRect.y + afterRect.height / 2 - after.height / 2;
		transform.position.x = worldX - (localAfterX * scaleX * cos - localAfterY * scaleY * sin);
		transform.position.y = worldY - (localAfterX * scaleX * sin + localAfterY * scaleY * cos);
	}

	invalidateMeasurement(layer) {
		this.measurementCache.clear();
		this.maskUrlCache.clear();
	}

	removeLayerElement(layerId) {
		const transform = this.layerTransforms.get(layerId);
		if (transform) {
			transform.removeTransformHandles();
			this.layerTransforms.delete(layerId);
		}
		const element = this.layerElements.get(layerId);
		if (element?.parentNode) element.parentNode.removeChild(element);
		this.layerElements.delete(layerId);
	}

	releaseLayerResources(layer) {
		if (!layer || layer.type !== LayerType.SHAPE) return;
		this.removeLayerElement(layer.id);
	}

	removeTransformHandles() {
		movableRemoveTransformHandles(this);
	}

	createTransformHandles(layerId) {
		movableCreateTransformHandles(this, layerId);
	}
}
