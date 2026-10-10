// Canvas Background is a permanent, structurally locked base layer whose
// appearance remains editable through the same paint-source system as shapes,
// text, and glitter fills.
class BaseBackgroundManager {
	constructor(editor) {
		this.editor = editor;
		this.pickerSession = null;
		this.slotPicker = new SlotGlitterPicker(editor, {
			type: LayerType.BASE_IMAGE, defaultSlot: 'background', typeWord: 'canvas',
			ensureSlot: (layer, key) => key === 'background' ? layer.background : this.fieldHost.ensureSlot(layer, key),
			onPicked: (layer) => { this.loadLayerSettings(layer); this.editor.requestPreviewUpdate(); }
		});
		Object.defineProperty(this.slotPicker, 'pickerSession', { get: () => this.pickerSession, set: value => { this.pickerSession = value; } });
		this.slotPicker.getTarget = () => this.getGlitterSelectionTarget();
		this.backgroundSourceCache = null;
		// Glitter mode paints the background as a DOM element above the base
		// canvas; image and gradient modes draw into the canvas (app.js
		// renderPreviewCanvas). Not in a layerElements map: the background is
		// never outlined as selected or hidden per element.
		this.backgroundElement = null;
		// An animated base image plays as an <img> of the uploaded file, as an
		// animated sticker does, right above the base canvas.
		this.animationElement = null;
		this.animationPlateCache = null;
		this.sparkleElement = null;
		this.sparkleImageKeys = new WeakMap();
		this.sparkleImageCounter = 0;
		this.setupUI();
		this.setupEventListeners();
	}

	renderContent() {
		this.renderBackgroundElement();
		this.renderAnimationElement();
		this.renderSparkleElement();
	}

	// The base image's animation, when it has one and it is on: the uploaded
	// GIF's timing and file, where its full frame sits on the canvas
	// (`placement`), and the still parts of the base around it (`plate`).
	getAnimation(layer = this.getBaseLayer()) {
		const source = this.editor.baseImageSource;
		if (!source?.animation || !this.hasBaseImage()) return null;
		if (layer?.background?.mode !== 'image' || layer.background.animate === false) return null;
		return { ...source.animation, name: source.file?.name || 'Base Image', placement: source.placement, plate: this.getAnimationPlate(source) };
	}

	// The animation the canvas shows: none while motion is paused.
	getPreviewAnimation(layer = this.getBaseLayer()) {
		return layer?.visible && !this.editor.animationTicker.paused ? this.getAnimation(layer) : null;
	}

	// The still base with the animation's rectangle cleared, so a canvas
	// extension shows around the animation and never through it. Null when
	// the animation covers the whole canvas.
	getAnimationPlate(source) {
		const still = this.editor.originalImageData;
		const { x, y, width, height } = source.placement.clip;
		const left = x;
		const top = y;
		const right = x + width;
		const bottom = y + height;
		if (left <= 0 && top <= 0 && right >= still.width && bottom >= still.height) return null;
		const cache = this.animationPlateCache;
		const key = `${left},${top},${right},${bottom}`;
		if (cache?.still === still && cache.key === key) return cache.plate;
		const plate = new ImageData(new Uint8ClampedArray(still.data), still.width, still.height);
		for (let row = top; row < bottom; row++) {
			plate.data.fill(0, (row * still.width + left) * 4, (row * still.width + right) * 4);
		}
		this.animationPlateCache = { still, key, plate };
		return plate;
	}

	// Reconciled, never rebuilt: a new element would restart the GIF.
	renderAnimationElement() {
		const layer = this.getBaseLayer();
		const animation = this.getPreviewAnimation(layer);
		if (!animation) {
			this.animationElement?.remove();
			this.animationElement = null;
			return;
		}
		let image = this.animationElement;
		if (!image) {
			image = document.createElement('img');
			image.className = 'base-animation-element';
			image.alt = '';
			image.draggable = false;
			this.animationElement = image;
		}
		const canvas = this.editor.previewCanvas;
		if (canvas.nextSibling !== image) canvas.after(image);
		if (image.dataset.source !== animation.url) {
			image.dataset.source = animation.url;
			image.src = animation.url;
		}
		const { x, y, width, height, clip } = animation.placement;
		image.style.left = `${x}px`;
		image.style.top = `${y}px`;
		image.style.width = `${width}px`;
		image.style.height = `${height}px`;
		// Only the part a crop has left shows.
		const inset = [clip.y - y, x + width - clip.x - clip.width, y + height - clip.y - clip.height, clip.x - x].map((value) => `${Math.max(0, value)}px`);
		image.style.clipPath = `inset(${inset.join(' ')})`;
		image.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);
		image.style.opacity = String(layer.opacity / 100);
		image.style.filter = buildCssColorFilter(layer.background.colorAdjust);
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
		// Above the photo: the base canvas, or the animation playing over it.
		const photo = this.animationElement || this.editor.previewCanvas;
		if (photo.nextSibling !== host) photo.after(host);
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

	// How the declared field binder edits the canvas's sparkles slot, and how
	// either of its paints is armed. The background slot itself keeps its own
	// bindings above.
	createFieldHost() {
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
		this.animationElement?.remove();
		this.animationElement = null;
		this.sparkleElement?.remove();
		this.sparkleElement = null;
	}

	getBaseLayer() {
		return this.editor.layerManager.getBaseLayer() || null;
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
			colorAdjust: normalizeColorAdjust(layer.background.colorAdjust),
			// Whether an animated base image plays; a still one ignores it.
			animate: layer.background.animate !== false
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
			imageBadges: id('baseBackgroundImageBadges'), animationSection: id('baseBackgroundAnimationSection'),
			animate: id('baseBackgroundAnimate'), animateNote: id('baseBackgroundAnimateNote'),
			gallerySection: id('designGallerySection')
		};
		installEffectGradientEditor({
			prefix: 'baseBackground',
			getData: () => this.getActiveLayer()?.background || null,
			onUpdate: (commit) => this.applyChange(commit)
		});
	}

	setupEventListeners() {
		getOptionValues('paintMode').forEach((mode) => {
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
		this.fieldHost = this.createFieldHost();
		bindFieldControls(this.fieldHost);
		this.ui.imageChange?.addEventListener('click', () => this.chooseReplacementImage());
		this.ui.animate?.addEventListener('change', () => {
			const layer = this.getActiveLayer();
			if (!layer) return;
			layer.background.animate = this.ui.animate.checked;
			this.applyChange(true);
		});
		this.bindRange('Scale', 'scale');
		this.bindRange('Opacity', 'opacity');
		['Hue', 'Saturation', 'Brightness'].forEach((name) => this.bindColorAdjust(name));
		bindGlitterRecolorAction(this.editor, () => this.getActiveLayer(), 'background', 'baseBackground');
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

	// What the base canvas draws. With the animation playing over it, that is
	// only the plate around the animation.
	getBackgroundSourceImageData(background, width, height) {
		if (background.mode === 'image') {
			const animation = this.getPreviewAnimation();
			return animation ? animation.plate : this.editor.originalImageData;
		}
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
		syncGlitterRecolorAction(this.editor, layer, 'background', 'baseBackground', () => this.getActiveLayer());
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
		setAssetChangeLabel(this.ui.imageChange, hasImage ? 'Replace' : 'Choose Image');
		this.syncAnimationControls(layer);
		this.updateGlitterInfo(layer);
		if (this.fieldHost) syncFieldControls(this.fieldHost, layer);
	}

	// The Animation section shows only for an animated base image.
	syncAnimationControls(layer) {
		const animation = this.hasBaseImage() ? this.editor.baseImageSource?.animation : null;
		if (this.ui.animationSection) this.ui.animationSection.hidden = !animation || layer.background.mode !== 'image';
		this.editor.renderAssetBadges(this.ui.imageBadges, { isAnimated: Boolean(animation) }, null);
		if (!animation) return;
		if (this.ui.animate) this.ui.animate.checked = layer.background.animate !== false;
		if (this.ui.animateNote) {
			this.ui.animateNote.textContent = `${animation.frameCount} frames, ${(animation.totalDuration / 1000).toFixed(1)} s. Glitter picked by color, Auto Glitter and Kira Kira read the first frame.`;
		}
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
		pickerOpenSession(this, { kind: 'paint', layerId: layer.id, slot }, {
			reveal: () => revealAssetBrowser(this.editor, this.editor.glitterLibrary, glitterId)
		});
	}

	hasActivePickerSession() {
		return Boolean(this.pickerSession && this.getActiveLayer()?.id === this.pickerSession.layerId);
	}

	getGlitterSelectionTarget() {
		return this.hasActivePickerSession() ? this.pickerSession.slot : 'background';
	}

	closePickerSession() {
		pickerCloseSession(this, { updateSelection: () => this.editor.updateGlitterSelection() });
	}

	chooseReplacementImage() {
		document.getElementById('imageUpload')?.click();
	}

	buildExportPlan(layer, context) {
		return context.compositor._buildBaseImageExportPlan(layer);
	}
}

BaseBackgroundManager.LAYER_TYPE = LayerType.BASE_IMAGE;
// Canvas Properties also shows with nothing selected, so the canvas is this
// manager's layer then too.
Object.assign(BaseBackgroundManager.prototype, {
	getActiveLayer() {
		const layer = this.editor.layerManager.getInspectedLayer();
		return layer?.type === LayerType.BASE_IMAGE ? layer : null;
	}
});
