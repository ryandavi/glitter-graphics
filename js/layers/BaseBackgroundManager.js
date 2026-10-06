// Canvas Background is a permanent, structurally locked base layer whose
// appearance remains editable through the same paint-source system as shapes,
// text, and glitter fills.
class BaseBackgroundManager {
	constructor(editor) {
		this.editor = editor;
		this.pickerSession = null;
		this.backgroundSourceCache = null;
		// Glitter mode paints the background as a DOM element above the base
		// canvas; image and gradient modes draw into the canvas (app.js
		// renderPreviewCanvas). Not in a layerElements map: the background is
		// never outlined as selected or hidden per element.
		this.backgroundElement = null;
		this.sparkleElement = null;
		this.sparkleImageKeys = new WeakMap();
		this.sparkleImageCounter = 0;
		this.setupUI();
		this.setupEventListeners();
	}

	renderContent() {
		this.renderBackgroundElement();
		this.renderSparkleElement();
	}

	renderBackgroundElement() {
		const layer = this.getBaseLayer();
		const glitter = layer?.visible && layer.background?.mode === 'glitter'
			? this.editor.glitterLibrary.getItemById(layer.background.glitterId)
			: null;
		if (!glitter) {
			// A missing glitter keeps the last element, as the fill layers do.
			if (!layer?.visible || layer.background?.mode !== 'glitter') this.clearBackgroundElement();
			return;
		}
		let wrapper = this.backgroundElement;
		if (!wrapper) {
			wrapper = document.createElement('div');
			wrapper.className = 'glitter-element base-background-element';
			wrapper.appendChild(document.createElement('div'));
			this.editor.canvasElementsContainer.appendChild(wrapper);
			this.backgroundElement = wrapper;
		}
		wrapper.dataset.layerId = layer.id;
		const inner = wrapper.firstElementChild;
		inner.className = 'glitter-background visible';
		const [entry] = getLayerPaintSlots(layer);
		applyPaintSourceToElement(inner, resolvePaintSlotPreviewSource(this.editor, layer, entry), { glitterLibrary: this.editor.glitterLibrary });
		inner.style.maskImage = 'none';
		inner.style.webkitMaskImage = 'none';
		inner.style.visibility = '';
		wrapper.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);
	}

	// Canvas sparkles cover the whole document just above the base image, in
	// their own canvas-sized element at the base layer's z-index. The photo is
	// #previewCanvas at that same z-index, so the host goes right after it in
	// the wrapper: DOM order puts the stars over the photo and under layer 2.
	renderSparkleElement() {
		const layer = this.getBaseLayer();
		const size = this.getDocumentSize();
		if (!layer?.visible || !getLayerSparkleEntries(layer).length || !size) {
			this.sparkleElement?.remove();
			this.sparkleElement = null;
			return;
		}
		let host = this.sparkleElement;
		if (!host) {
			host = document.createElement('div');
			host.className = 'sparkle-host-element';
			this.sparkleElement = host;
		}
		const canvas = this.editor.previewCanvas;
		if (canvas.nextSibling !== host) canvas.after(host);
		host.dataset.layerId = layer.id;
		host.style.width = `${size.width}px`;
		host.style.height = `${size.height}px`;
		host.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);
		host.style.opacity = String(layer.opacity / 100);
		reconcileSparkleLayers(host, layer, { editor: this.editor, width: size.width, height: size.height });
	}

	// The export composes at the original canvas size, so the sparkle host box
	// uses it too.
	getDocumentSize() {
		const canvas = this.editor.originalCanvas?.width ? this.editor.originalCanvas : this.editor.previewCanvas;
		return canvas?.width && canvas?.height ? { width: canvas.width, height: canvas.height } : null;
	}

	// Kira Kira reads the photo itself (not any filter above it), which is
	// replace-only, so its identity keys the detection cache.
	getSparkleHost(layer) {
		const size = this.getDocumentSize();
		if (!size) return null;
		const imageData = layer.background?.mode === 'image' && this.hasBaseImage() ? this.editor.originalImageData : null;
		if (imageData && !this.sparkleImageKeys.has(imageData)) this.sparkleImageKeys.set(imageData, ++this.sparkleImageCounter);
		return {
			key: imageData ? `base:${this.sparkleImageKeys.get(imageData)}` : 'base:none',
			width: size.width,
			height: size.height,
			loadPixels: () => imageData
		};
	}

	// How the declared field binder edits the canvas's sparkles slot. The
	// background slot itself keeps its own bindings above.
	createSparkleFieldHost() {
		return {
			type: LayerType.BASE_IMAGE,
			editor: this.editor,
			getLayer: () => this.getActiveLayer(),
			ensureSlot: (layer, key) => (layer.background[key] ||= buildDefaultSparkles()),
			getSlotDefaults: () => buildDefaultSparkles(),
			apply: (layer, mutate, change) => {
				mutate();
				this.renderContent();
				if (change.live) return;
				this.loadLayerSettings(layer);
				this.editor.layerManager.renderLayersList();
				this.editor.saveState('Edit canvas sparkles');
			},
			render: () => this.renderContent(),
			commit: () => this.editor.saveState('Edit canvas sparkles'),
			armPicker: (key) => this.armPicker(key),
			getArmedSlot: () => (this.hasActivePickerSession() ? this.pickerSession.slot : null)
		};
	}

	clearBackgroundElement() {
		this.backgroundElement?.remove();
		this.backgroundElement = null;
	}

	clearElements() {
		this.clearBackgroundElement();
		this.sparkleElement?.remove();
		this.sparkleElement = null;
	}

	getActiveLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === LayerType.BASE_IMAGE ? layer : null;
	}

	getBaseLayer() {
		return this.editor.layers?.find((layer) => layer.type === LayerType.BASE_IMAGE) || null;
	}

	hasBaseImage() {
		const source = this.editor.baseImageSource;
		if (!source) return false;
		if (typeof source.hasBaseImage === 'boolean') return source.hasBaseImage;
		return source.kind !== 'preset';
	}

	// Runs where the canvas layer enters the document (create, deserialize,
	// project load). Everything else reads the canonical shape directly.
	normalizeLayer(layer) {
		if (!layer || layer.type !== LayerType.BASE_IMAGE) return null;
		layer.locked = true;
		layer.background ||= {};
		layer.background.glitterId ??= CONFIG.tools.glitter.defaults.fillGlitterId.canvasBackground;
		// Keep an already-normalized gradient intact. The gradient editor holds
		// references to its stops while a range or preview handle is being dragged;
		// replacing this object from getData() makes those references stale after
		// the first input event.
		if (!layer.background.gradient || !Array.isArray(layer.background.gradient.stops) || layer.background.gradient.stops.length < 2) {
			layer.background.gradient = normalizeEffectGradient(layer.background.gradient);
		}
		Object.assign(layer.background, {
			mode: isOptionValue('paintMode', layer.background.mode) ? layer.background.mode : 'image',
			color: layer.background.color || '#ffffff',
			scale: Number(layer.background.scale ?? FIELDS.textureScale.value),
			colorAdjust: normalizeColorAdjust(layer.background.colorAdjust)
		});
		normalizeSlotTextureCoordinates(layer.background);
		layer.background.sparkles = normalizeSparklesData(layer.background.sparkles);
		// Canvas pixel effects became filter layers (ProjectSerializer v4 -> v5).
		delete layer.background.pixelEffects;
		delete layer.background.posterize;
		return layer;
	}

	setupUI() {
		const id = (value) => document.getElementById(value);
		this.ui = {
			section: id('baseLayerSettingsSection'),
			autoGlitter: id('autoGlitterImageBtn'),
			imageInfo: id('baseBackgroundImageInfo'), imageThumbnail: id('baseBackgroundImageThumbnail'),
			imageName: id('baseBackgroundImageName'), imageChange: id('baseBackgroundImageChange'),
			glitterInfo: id('baseBackgroundGlitterInfo'), glitterChip: id('baseBackgroundGlitterChip'),
			glitterLabel: id('baseBackgroundGlitterLabel'), glitterBadges: id('baseBackgroundGlitterBadges'),
			glitterSize: id('baseBackgroundGlitterSize'), glitterFrames: id('baseBackgroundGlitterFrames'),
			glitterChange: id('baseBackgroundGlitterChange'), color: id('baseBackgroundColor'),
			gallerySection: id('designGallerySection'), pickerStrip: id('galleryPickerStrip'),
			pickerTitle: id('galleryPickerStripTitle'), pickerDetail: id('galleryPickerStripDetail'), pickerDone: id('galleryPickerStripDone')
		};
		installEffectGradientEditor({
			prefix: 'baseBackground',
			getData: () => this.getActiveLayer()?.background || null,
			onUpdate: (commit) => this.applyChange(commit)
		});
	}

	setupEventListeners() {
		getOptionValues('paintMode').filter((mode) => mode !== 'gradient').forEach((mode) => {
			document.getElementById(`baseBackground${mode[0].toUpperCase()}${mode.slice(1)}`)?.addEventListener('click', () => this.setMode(mode));
		});
		this.ui.color?.addEventListener('input', () => {
			const layer = this.getActiveLayer();
			if (!layer) return;
			layer.background.mode = 'solid';
			layer.background.color = this.ui.color.value;
			this.applyChange(false);
		});
		this.ui.color?.addEventListener('change', () => this.editor.saveState('Edit background'));
		[this.ui.glitterChip, this.ui.glitterChange].forEach((button) => button?.addEventListener('click', () => this.armPicker()));
		this.sparkleFieldHost = this.createSparkleFieldHost();
		bindFieldControls(this.sparkleFieldHost);
		this.ui.imageChange?.addEventListener('click', () => this.chooseReplacementImage());
		this.ui.pickerDone?.addEventListener('click', () => { if (this.hasActivePickerSession()) this.closePicker(); });
		this.bindRange('Scale', 'scale');
		this.bindRange('Opacity', 'opacity');
		['Hue', 'Saturation', 'Brightness'].forEach((name) => this.bindColorAdjust(name));
		bindSlotTextureCoordinateControls({
			prefix: 'baseBackground',
			getLayer: () => this.getActiveLayer(),
			getData: (layer) => layer?.background,
			render: () => this.applyChange(false),
			save: () => this.editor.saveState('Edit background')
		});
	}

	bindRange(name, key) {
		const input = document.getElementById(`baseBackground${name}`);
		const value = document.getElementById(`baseBackground${name}Value`);
		if (!input) return;
		const spec = FIELDS[name === 'Scale' ? 'textureScale' : 'slotOpacity'];
		bindSlider(input, value, {
			suffix: '%', resetValue: spec.value,
			resetButton: document.getElementById(`resetBaseBackground${name}`),
			apply: (next) => {
				const layer = this.getActiveLayer();
				if (!layer) return;
				if (key === 'opacity') layer.opacity = next;
				else layer.background[key] = next;
				this.applyChange(false);
			},
			onCommit: () => this.editor.saveState('Edit background')
		});
	}

	bindColorAdjust(name) {
		const input = document.getElementById(`baseBackground${name}`);
		const value = document.getElementById(`baseBackground${name}Value`);
		if (!input) return;
		const key = name.toLowerCase();
		const spec = FIELDS[key];
		bindSlider(input, value, {
			suffix: name === 'Hue' ? '\u00b0' : '%', resetValue: spec.value,
			resetButton: document.getElementById(`resetBaseBackground${name}`),
			apply: (next) => {
				const layer = this.getActiveLayer();
				if (!layer) return;
				layer.background.colorAdjust[key] = next;
				this.applyChange(false);
			},
			onCommit: () => this.editor.saveState('Edit background')
		});
	}

	setMode(mode) {
		const layer = this.getActiveLayer();
		if (!layer) return;
		layer.background.mode = mode;
		syncPaintSlotSourceUI(document.getElementById(`baseBackground${mode[0].toUpperCase()}${mode.slice(1)}`), mode);
		this.applyChange(true);
	}

	applyChange(commit) {
		this.updateAutoGlitterAvailability();
		this.editor.requestPreviewUpdate();
		this.editor.layerManager.renderLayersList();
		if (commit) this.editor.saveState('Edit background');
	}

	getBackgroundSourceImageData(background, width, height) {
		if (background.mode === 'image') return this.editor.originalImageData;
		if (background.mode !== 'gradient') return null;
		const key = `${width}x${height}:${JSON.stringify(background.gradient)}`;
		if (this.backgroundSourceCache?.key === key) return this.backgroundSourceCache.data;
		const canvas = createAppCanvas(0, 0, 'layers/BaseBackgroundManager');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
		ctx.fillStyle = createEffectCanvasGradient(ctx, background.gradient, { x: 0, y: 0, width, height });
		ctx.fillRect(0, 0, width, height);
		const data = ctx.getImageData(0, 0, width, height);
		this.backgroundSourceCache = { key, data };
		return data;
	}

	getAutoGlitterAvailability(layer = this.getBaseLayer()) {
		if (layer?.type !== LayerType.BASE_IMAGE) layer = null;
		if (!this.hasBaseImage() || !this.editor.originalImageData) {
			return { available: false, message: 'Choose a Base Image before using Auto Glitter' };
		}
		if (layer?.background.mode !== 'image') {
			return { available: false, message: 'Switch Canvas Background to Image before using Auto Glitter' };
		}
		return { available: true, message: 'Turn the image colors into editable glitter fill layers' };
	}

	updateAutoGlitterAvailability(layer) {
		if (!this.ui.autoGlitter) return;
		const availability = this.getAutoGlitterAvailability(layer);
		this.ui.autoGlitter.disabled = !availability.available;
		this.ui.autoGlitter.title = availability.message;
		this.ui.autoGlitter.setAttribute('aria-disabled', availability.available ? 'false' : 'true');
	}

	loadLayerSettings(layer) {
		if (layer?.type !== LayerType.BASE_IMAGE) return;
		this.updateAutoGlitterAvailability(layer);
		const modeButton = document.getElementById(`baseBackground${layer.background.mode[0].toUpperCase()}${layer.background.mode.slice(1)}`);
		syncPaintSlotSourceUI(modeButton || document.getElementById('baseBackgroundImage'), layer.background.mode);
		if (this.ui.color) this.ui.color.value = layer.background.color;
		syncSlider(document.getElementById('baseBackgroundScale'), layer.background.scale);
		syncSlider(document.getElementById('baseBackgroundOpacity'), layer.opacity);
		const adjust = normalizeColorAdjust(layer.background.colorAdjust);
		['hue', 'saturation', 'brightness'].forEach(key => syncSlider(document.getElementById(`baseBackground${fieldControlCap(key)}`), adjust[key]));
		syncSlotTextureCoordinateControls('baseBackground', layer.background);
		const hasImage = this.hasBaseImage();
		if (this.ui.imageName) this.ui.imageName.textContent = hasImage
			? (this.editor.baseImageSource?.file?.name || 'Base Image')
			: 'No base image';
		if (this.ui.imageThumbnail) {
			this.ui.imageThumbnail.replaceChildren();
			this.ui.imageThumbnail.classList.toggle('base-image-thumbnail', hasImage);
			if (hasImage) {
				const image = document.createElement('img');
				image.src = this.editor.layerManager.baseImageSwatchDataUrl || this.editor.originalImage?.src || '';
				image.alt = '';
				this.ui.imageThumbnail.appendChild(image);
			}
			this.ui.imageThumbnail.classList.toggle('empty', !hasImage);
		}
		if (this.ui.imageChange) this.ui.imageChange.textContent = hasImage ? 'Replace' : 'Choose Image';
		this.updateGlitterInfo(layer);
		if (this.sparkleFieldHost) syncFieldControls(this.sparkleFieldHost, layer);
	}

	updateGlitterInfo(layer) {
		const glitter = this.editor.glitterLibrary.getItemById(layer.background.glitterId);
		if (!glitter) return;
		this.editor.renderGlitterAssetDisplay({
			thumbnail: this.ui.glitterChip,
			name: this.ui.glitterLabel,
			badges: this.ui.glitterBadges,
			size: this.ui.glitterSize,
			frames: this.ui.glitterFrames
		}, glitter, layer.background.colorAdjust);
	}

	// slot: 'background' (the canvas paint) or 'sparkles'.
	armPicker(slot = 'background') {
		const layer = this.getActiveLayer();
		if (!layer) return;
		const glitterId = slot === 'sparkles' ? layer.background.sparkles?.glitterId : layer.background.glitterId;
		pickerOpenSession(this, { layerId: layer.id, slot }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => revealAssetBrowser(this.editor, this.editor.glitterManager, glitterId)
		});
	}

	hasActivePickerSession() {
		return Boolean(this.pickerSession && this.getActiveLayer()?.id === this.pickerSession.layerId);
	}

	getGlitterSelectionTarget() {
		return this.hasActivePickerSession() ? this.pickerSession.slot || 'background' : 'background';
	}

	updatePickerStrip() {
		const layer = this.getActiveLayer();
		if (!layer) return;
		const armed = this.hasActivePickerSession();
		renderPickerStrip({
			ownsStrip: true,
			visible: true,
			armed,
			hint: !armed,
			title: this.getGlitterSelectionTarget() === 'sparkles' ? 'Choosing sparkle glitter' : 'Choosing background glitter',
			detail: this.getGlitterSelectionTarget() === 'sparkles' ? 'Applying to Canvas Sparkles' : 'Applying to Canvas Background'
		});
	}

	closePicker() {
		const focusId = this.getGlitterSelectionTarget() === 'sparkles' ? 'canvasSparklesGlitterChip' : 'baseBackgroundGlitterChip';
		this.closePickerSession();
		returnFromPickerToProperties(this.editor, { section: 'baseLayerSettings', focusId });
	}

	closePickerSession() {
		pickerCloseSession(this, {
			refresh: () => this.updatePickerStrip(),
			updateSelection: () => this.editor.updateGlitterSelection()
		});
	}

	chooseReplacementImage() {
		document.getElementById('imageUpload')?.click();
	}

	buildExportPlan(layer, context) {
		return context.compositor._buildBaseImageExportPlan(layer);
	}
}
