// Canvas Background is a permanent, structurally locked base layer whose
// appearance remains editable through the same paint-source system as shapes,
// text, and glitter fills.
class BaseBackgroundManager {
	constructor(editor) {
		this.editor = editor;
		this.pickerSession = null;
		this.pixelEffectCache = new Map();
		this.pixelEffectRequest = 0;
		this.pixelEffectWorker = null;
		this.pixelEffectPendingKey = null;
		this.pixelEffectDebounceTimer = null;
		this.lastPixelEffectPreview = null;
		this.shimmerPreview = { key: null, frameIndex: 0, timer: null, pending: false, requestId: 0 };
		this.setupUI();
		this.setupEventListeners();
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) this.pauseShimmerPreview();
			else this.scheduleShimmerPreview();
		});
	}

	getActiveLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === LayerType.BASE_IMAGE ? layer : null;
	}

	hasBaseImage() {
		const source = this.editor.baseImageSource;
		if (!source) return false;
		if (typeof source.hasBaseImage === 'boolean') return source.hasBaseImage;
		return source.kind !== 'preset';
	}

	normalizeLayer(layer) {
		if (!layer || layer.type !== LayerType.BASE_IMAGE) return null;
		layer.locked = true;
		layer.selectedGlitterId ||= CONFIG.tools.glitter.defaults.fillGlitterId;
		layer.background ||= {};
		// Keep an already-normalized gradient intact. The gradient editor holds
		// references to its stops while a range or preview handle is being dragged;
		// replacing this object from getData() makes those references stale after
		// the first input event.
		if (!layer.background.gradient || !Array.isArray(layer.background.gradient.stops) || layer.background.gradient.stops.length < 2) {
			layer.background.gradient = normalizeEffectGradient(layer.background.gradient);
		}
		Object.assign(layer.background, {
			mode: ['image', 'none', 'glitter', 'solid', 'gradient'].includes(layer.background.mode) ? layer.background.mode : 'image',
			color: layer.background.color || '#ffffff',
			scale: Number(layer.background.scale ?? CONFIG.tools.effects.defaults.scale),
			opacity: Number(layer.background.opacity ?? 100),
			colorAdjust: normalizeColorAdjust(layer.background.colorAdjust)
		});
		normalizeSlotTextureCoordinates(layer.background);
		const legacyPosterize = layer.background.posterize;
		layer.background.pixelEffects = GlitterPixelEffects.normalizeSettings(
			layer.background.pixelEffects || legacyPosterize,
			CONFIG.tools.pixelEffects
		);
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
		Object.assign(this.ui, {
			pixelateEnabled: id('pixelEffectsPixelateEnabled'), paletteEnabled: id('pixelEffectsPaletteEnabled'),
			resetEffects: id('resetPixelEffects'),
			pixelCard: id('pixelEffectsPaletteMode')?.closest('.pixel-effects-card'),
			pixelateCard: id('pixelEffectsPixelSize')?.closest('.pixelate-effect-card'),
			pixelSize: id('pixelEffectsPixelSize'), paletteMode: id('pixelEffectsPaletteMode'),
			paletteStyle: id('pixelEffectsPaletteStyle'), colorCount: id('pixelEffectsColorCount'),
			mergeDistinctness: id('pixelEffectsMergeDistinctness'), detail: id('pixelEffectsDetail'),
			cleanEdges: id('pixelEffectsCleanEdges'), paletteControls: id('pixelEffectsPaletteControls'),
			posterizeControls: id('pixelEffectsPosterizeControls'), ditherControls: id('pixelEffectsDitherControls'),
			algorithm: id('pixelEffectsAlgorithm'), ditherPalette: id('pixelEffectsDitherPalette'), ditherScale: id('pixelEffectsDitherScale'),
			duotone: id('pixelEffectsDuotone'), strength: id('pixelEffectsStrength'), angle: id('pixelEffectsAngle'),
			shimmer: id('pixelEffectsShimmer'), status: id('pixelEffectsStatus')
		});
		const pixelEffectsTitle = this.ui.pixelCard?.closest('[data-panel-group="Effects"]')?.querySelector(':scope > .subsection-title');
		const pixelEffectsChevron = pixelEffectsTitle?.querySelector('.panel-group-chevron');
		if (this.ui.status && pixelEffectsTitle) {
			pixelEffectsTitle.insertBefore(this.ui.status, pixelEffectsChevron || null);
		}
		if (this.ui.duotone) {
			['Dark', 'Light'].forEach((label, index) => {
				const group = document.createElement('label');
				group.className = 'effect-option-group';
				const text = document.createElement('span');
				text.className = 'effect-option-label setting-label';
				text.textContent = label;
				const input = document.createElement('input');
				input.type = 'color';
				input.id = `pixelEffectsDuotone${index}`;
				group.append(text, input);
				this.ui.duotone.appendChild(group);
			});
		}
		// The legacy host lives in Design's source markup. Once schema rendering
		// has populated it, promote it to a sibling accordion section.
		const designGallery = id('designGallerySection');
		if (this.ui.section && designGallery?.parentElement && this.ui.section.parentElement !== designGallery.parentElement) {
			designGallery.after(this.ui.section);
		}
		// Document sizing is a canvas/background property. Move both existing
		// controls intact so their established listeners and ids remain authoritative.
		const documentSize = id('documentSizeGroup');
		const scaleDesign = id('scaleDesignPanel');
		const canvasHost = id('baseCanvasSizeHost');
		if (documentSize && canvasHost) {
			canvasHost.replaceWith(documentSize);
			if (scaleDesign) documentSize.appendChild(scaleDesign);
		}
		installEffectGradientEditor({
			prefix: 'baseBackground',
			getData: () => this.normalizeLayer(this.getActiveLayer())?.background || null,
			onUpdate: (commit) => this.applyChange(commit)
		});
	}

	setupEventListeners() {
		['image', 'none', 'glitter', 'solid'].forEach((mode) => {
			document.getElementById(`baseBackground${mode[0].toUpperCase()}${mode.slice(1)}`)?.addEventListener('click', () => this.setMode(mode));
		});
		this.ui.color?.addEventListener('input', () => {
			const layer = this.normalizeLayer(this.getActiveLayer());
			if (!layer) return;
			layer.background.mode = 'solid';
			layer.background.color = this.ui.color.value;
			this.applyChange(false);
		});
		this.ui.color?.addEventListener('change', () => this.editor.saveState('Edit background'));
		[this.ui.glitterChip, this.ui.glitterChange].forEach((button) => button?.addEventListener('click', () => this.armPicker()));
		this.ui.imageChange?.addEventListener('click', () => this.chooseReplacementImage());
		this.ui.pickerDone?.addEventListener('click', () => { if (this.hasActivePickerSession()) this.closePicker(); });
		this.bindRange('Scale', 'scale');
		this.bindRange('Opacity', 'opacity');
		['Hue', 'Saturation', 'Brightness'].forEach((name) => this.bindColorAdjust(name));
		bindSlotTextureCoordinateControls({
			prefix: 'baseBackground',
			getLayer: () => this.getActiveLayer(),
			getData: (layer) => this.normalizeLayer(layer)?.background,
			render: () => this.applyChange(false),
			save: () => this.editor.saveState('Edit background')
		});
		this.bindPixelEffects();
	}

	bindPixelEffects() {
		const bindRange = (id, path, slider) => {
			const input = document.getElementById(id);
			if (!input) return;
			const spec = CONFIG.ui.sliders[slider];
			bindSlider(input, document.getElementById(`${id}Value`), {
				suffix: spec.unit,
				parseValue: (rawValue) => Number(rawValue),
				resetValue: spec.value,
				resetButton: document.getElementById(`reset${id[0].toUpperCase()}${id.slice(1)}`),
				apply: (next) => this.updatePixelSetting(path, next, false),
				onCommit: () => this.editor.saveState('Edit background')
			});
		};
		bindRange('pixelEffectsPixelSize', 'pixelSize', 'pixelEffectsPixelSize');
		bindRange('pixelEffectsColorCount', 'colorCount', 'pixelEffectsColorCount');
		bindRange('pixelEffectsMergeDistinctness', 'mergeDistinctness', 'pixelEffectsMergeDistinctness');
		bindRange('pixelEffectsDetail', 'detail', 'pixelEffectsDetail');
		bindRange('pixelEffectsStrength', 'dither.strength', 'pixelEffectsStrength');
		bindRange('pixelEffectsDitherScale', 'dither.scale', 'pixelEffectsDitherScale');
		bindRange('pixelEffectsAngle', 'dither.angle', 'pixelEffectsAngle');
		this.bindPixelSegment(this.ui.paletteMode, 'paletteMode');
		this.bindPixelSegment(this.ui.paletteStyle, 'paletteStyle');
		this.bindPixelSelect(this.ui.algorithm, 'dither.algorithm');
		this.bindPixelSelect(this.ui.ditherPalette, 'dither.palette');
		this.ui.pixelateEnabled?.addEventListener('change', () => this.updatePixelSetting('pixelateEnabled', this.ui.pixelateEnabled.checked, true));
		this.ui.paletteEnabled?.addEventListener('change', () => this.updatePixelSetting('paletteEnabled', this.ui.paletteEnabled.checked, true));
		this.ui.resetEffects?.addEventListener('click', () => this.resetPixelEffects());
		this.ui.cleanEdges?.addEventListener('change', () => this.updatePixelSetting('cleanEdges', this.ui.cleanEdges.checked, true));
		this.ui.shimmer?.addEventListener('change', () => this.updatePixelSetting('dither.shimmer', this.ui.shimmer.checked, true));
		[0, 1].forEach((index) => document.getElementById(`pixelEffectsDuotone${index}`)?.addEventListener('change', (event) => {
			this.updatePixelSetting(`dither.duotone.${index}`, event.target.value, true);
		}));
	}

	bindPixelSegment(group, path) {
		group?.querySelectorAll('.segmented-option').forEach((button) => button.addEventListener('click', () => {
			this.updatePixelSetting(path, button.dataset.value, true);
		}));
	}

	bindPixelSelect(select, path) {
		select?.addEventListener('change', () => this.updatePixelSetting(path, select.value, true));
	}

	resetPixelEffects() {
		const layer = this.normalizeLayer(this.getActiveLayer());
		if (!layer) return;
		layer.background.pixelEffects = GlitterPixelEffects.normalizeSettings(CONFIG.tools.pixelEffects.defaults, CONFIG.tools.pixelEffects);
		this.invalidatePixelEffects();
		this.loadPixelEffectSettings(layer);
		this.applyChange(true);
	}

	disablePixelEffects({ apply = true, commit = true } = {}) {
		const baseLayer = this.editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
		const layer = this.normalizeLayer(baseLayer);
		if (!layer) return false;
		const settings = layer.background.pixelEffects;
		if (!settings.pixelateEnabled && !settings.paletteEnabled) return false;
		settings.pixelateEnabled = false;
		settings.paletteEnabled = false;
		this.invalidatePixelEffects();
		this.loadPixelEffectSettings(layer);
		if (apply) this.applyChange(commit);
		return true;
	}

	updatePixelSetting(path, value, commit) {
		const layer = this.normalizeLayer(this.getActiveLayer());
		if (!layer) return;
		const keys = path.split('.');
		let target = layer.background.pixelEffects;
		for (let index = 0; index < keys.length - 1; index++) target = target[keys[index]];
		target[keys.at(-1)] = value;
		layer.background.pixelEffects = GlitterPixelEffects.normalizeSettings(target === layer.background.pixelEffects ? target : layer.background.pixelEffects, CONFIG.tools.pixelEffects);
		this.invalidatePixelEffects();
		this.loadPixelEffectSettings(layer);
		this.applyChange(commit);
	}

	invalidatePixelEffects() {
		this.pixelEffectRequest++;
		this.pixelEffectPendingKey = null;
		clearTimeout(this.pixelEffectDebounceTimer);
		this.pixelEffectDebounceTimer = null;
		this.pixelEffectCache.clear();
		this.stopShimmerPreview();
		this.ui.pixelCard?.setAttribute('aria-busy', 'false');
		setInlineProcessingStatus(this.ui.status);
	}

	isShimmerPreviewEnabled(settings) {
		return settings.paletteEnabled && settings.paletteMode === 'dither' && settings.dither.shimmer
			&& Boolean(GlitterPixelEffects.getShimmerAnimation(settings.dither.algorithm, CONFIG.tools.pixelEffects));
	}

	pauseShimmerPreview() {
		clearTimeout(this.shimmerPreview.timer);
		this.shimmerPreview.timer = null;
	}

	stopShimmerPreview() {
		this.pauseShimmerPreview();
		this.shimmerPreview.requestId++;
		this.shimmerPreview.key = null;
		this.shimmerPreview.frameIndex = 0;
		this.shimmerPreview.pending = false;
		if (this.pixelEffectWorker) this.pixelEffectWorker.postMessage({ clearAnimation: true });
	}

	startShimmerPreview(key) {
		this.pauseShimmerPreview();
		this.shimmerPreview.key = key;
		this.shimmerPreview.frameIndex = 0;
		this.shimmerPreview.pending = false;
		this.scheduleShimmerPreview();
	}

	scheduleShimmerPreview(delay = CONFIG.tools.pixelEffects.animation.frameDurationMs) {
		if (!this.shimmerPreview.key || this.shimmerPreview.pending || this.shimmerPreview.timer || document.hidden) return;
		const layer = this.normalizeLayer(this.editor.layers.find((entry) => entry.type === LayerType.BASE_IMAGE));
		const applicable = layer?.visible !== false && ((layer?.background.mode === 'image' && this.hasBaseImage()) || layer?.background.mode === 'gradient');
		if (!applicable || !this.isShimmerPreviewEnabled(layer.background.pixelEffects)) return;
		this.shimmerPreview.timer = setTimeout(() => {
			this.shimmerPreview.timer = null;
			this.requestShimmerPreviewFrame();
		}, delay);
	}

	requestShimmerPreviewFrame() {
		const state = this.shimmerPreview;
		if (!state.key || state.pending || document.hidden) return;
		const worker = this.ensurePixelEffectWorker();
		const layer = this.normalizeLayer(this.editor.layers.find((entry) => entry.type === LayerType.BASE_IMAGE));
		const animation = layer && GlitterPixelEffects.getShimmerAnimation(layer.background.pixelEffects.dither.algorithm, CONFIG.tools.pixelEffects);
		if (!animation) return;
		const requestId = `shimmer-${++state.requestId}`;
		const key = state.key;
		const frameIndex = (state.frameIndex + 1) % animation.frames;
		const startedAt = performance.now();
		state.pending = true;
		const finish = ({ data }) => {
			if (data.requestId !== requestId) return;
			worker.removeEventListener('message', finish);
			if (state.key !== key || state.requestId !== Number(requestId.slice(8))) return;
			state.pending = false;
			if (data.error) {
				this.stopShimmerPreview();
				return;
			}
			const result = new ImageData(new Uint8ClampedArray(data.pixels), this.editor.previewCanvas.width, this.editor.previewCanvas.height);
			state.frameIndex = frameIndex;
			this.lastPixelEffectPreview = result;
			const layer = this.normalizeLayer(this.editor.layers.find((entry) => entry.type === LayerType.BASE_IMAGE));
			const applicable = layer?.visible !== false && ((layer?.background.mode === 'image' && this.hasBaseImage()) || layer?.background.mode === 'gradient');
			if (applicable && this.isShimmerPreviewEnabled(layer.background.pixelEffects)) {
				this.editor.renderBasePreviewImageData(layer.background, result);
			}
			const elapsed = performance.now() - startedAt;
			this.scheduleShimmerPreview(Math.max(0, CONFIG.tools.pixelEffects.animation.frameDurationMs - elapsed));
		};
		worker.addEventListener('message', finish);
		worker.postMessage({ requestId, animationKey: key, frameIndex });
	}

	_hashPixels(pixels) {
		let hash = 2166136261;
		for (let index = 0; index < pixels.length; index += 4) {
			hash = Math.imul(hash ^ pixels[index], 16777619);
			hash = Math.imul(hash ^ pixels[index + 1], 16777619);
			hash = Math.imul(hash ^ pixels[index + 2], 16777619);
			hash = Math.imul(hash ^ pixels[index + 3], 16777619);
		}
		return hash >>> 0;
	}

	getPixelEffectImageData(source, width, height, settings, frameIndex = 0) {
		const shimmerFrame = settings.paletteEnabled && settings.paletteMode === 'dither' && settings.dither.shimmer
			&& GlitterPixelEffects.getShimmerAnimation(settings.dither.algorithm, CONFIG.tools.pixelEffects) ? frameIndex : 0;
		const key = `${width}x${height}:${this._hashPixels(source.data)}:${JSON.stringify(settings)}:${shimmerFrame}`;
		const cached = this.pixelEffectCache.get(key);
		if (cached) return cached;
		const data = GlitterPixelEffects.applyPixelEffects(source.data, width, height, settings, {
			pixelEffects: CONFIG.tools.pixelEffects,
			autoGlitter: CONFIG.tools.autoGlitter
		}, shimmerFrame);
		const result = new ImageData(data, width, height);
		this.pixelEffectCache.set(key, result);
		while (this.pixelEffectCache.size > 16) this.pixelEffectCache.delete(this.pixelEffectCache.keys().next().value);
		return result;
	}

	ensurePixelEffectWorker() {
		if (this.pixelEffectWorker) return this.pixelEffectWorker;
		this.pixelEffectWorker = new Worker('js/workers/pixel-effects.worker.js?v=5');
		this.pixelEffectWorker.addEventListener('error', (error) => {
			dbg('[BaseBackgroundManager] Palette effect worker failed:', error);
			this.pixelEffectPendingKey = null;
			this.ui.pixelCard?.setAttribute('aria-busy', 'false');
			setInlineProcessingStatus(this.ui.status, { error: true, label: 'Could not update' });
			this.pixelEffectWorker?.terminate();
			this.pixelEffectWorker = null;
			this.stopShimmerPreview();
		});
		return this.pixelEffectWorker;
	}

	requestPreviewImageData(source, width, height, settings, key) {
		if (this.pixelEffectPendingKey === key) return;
		const animationKey = this.isShimmerPreviewEnabled(settings) ? key : null;
		const token = ++this.pixelEffectRequest;
		this.pixelEffectPendingKey = key;
		setInlineProcessingStatus(this.ui.status, { active: true, label: 'Updating' });
		this.ui.pixelCard?.setAttribute('aria-busy', 'true');
		clearTimeout(this.pixelEffectDebounceTimer);
		this.pixelEffectDebounceTimer = setTimeout(() => {
			this.pixelEffectDebounceTimer = null;
			if (token !== this.pixelEffectRequest) return;
			const worker = this.ensurePixelEffectWorker();
			const pixels = source.data.slice();
			const finish = ({ data }) => {
				if (data.requestId !== token) return;
				worker.removeEventListener('message', finish);
				if (token !== this.pixelEffectRequest) return;
				this.pixelEffectPendingKey = null;
				this.ui.pixelCard?.setAttribute('aria-busy', 'false');
				if (data.error) {
					setInlineProcessingStatus(this.ui.status, { error: true, label: data.error });
					return;
				}
				const result = new ImageData(new Uint8ClampedArray(data.pixels), width, height);
				this.pixelEffectCache.set(key, result);
				this.lastPixelEffectPreview = result;
				if (animationKey) this.startShimmerPreview(animationKey);
				setInlineProcessingStatus(this.ui.status);
				this.editor.requestPreviewUpdate();
			};
			worker.addEventListener('message', finish);
			worker.postMessage({
				requestId: token,
				pixels: pixels.buffer,
				width,
				height,
				settings,
				segmentKey: `${width}x${height}:${this._hashPixels(source.data)}:${settings.pixelSize}:${settings.paletteStyle}`,
				config: { pixelEffects: CONFIG.tools.pixelEffects, autoGlitter: CONFIG.tools.autoGlitter },
				frameIndex: 0,
				animationKey
			}, [pixels.buffer]);
		}, CONFIG.tools.pixelEffects.timing.previewDebounceMs);
	}

	getPreviewImageData(source, width, height, settings) {
		const key = `${width}x${height}:${this._hashPixels(source.data)}:${JSON.stringify(settings)}:0`;
		const shimmerEnabled = this.isShimmerPreviewEnabled(settings);
		if (!shimmerEnabled && this.shimmerPreview.key) this.stopShimmerPreview();
		if (shimmerEnabled && this.shimmerPreview.key && this.shimmerPreview.key !== key) this.stopShimmerPreview();
		if (shimmerEnabled && this.shimmerPreview.key === key) {
			this.scheduleShimmerPreview();
			return this.lastPixelEffectPreview;
		}
		if (this.pixelEffectCache.has(key)) {
			if (shimmerEnabled) this.requestPreviewImageData(source, width, height, settings, key);
			return this.pixelEffectCache.get(key);
		}
		this.requestPreviewImageData(source, width, height, settings, key);
		return this.lastPixelEffectPreview?.width === width && this.lastPixelEffectPreview?.height === height
			? this.lastPixelEffectPreview
			: source;
	}

	bindRange(name, key) {
		const input = document.getElementById(`baseBackground${name}`);
		const value = document.getElementById(`baseBackground${name}Value`);
		if (!input) return;
		const spec = CONFIG.ui.sliders[name === 'Scale' ? 'textureScale' : 'slotOpacity'];
		bindSlider(input, value, {
			suffix: '%', resetValue: spec.value,
			resetButton: document.getElementById(`resetBaseBackground${name}`),
			apply: (next) => {
				const layer = this.normalizeLayer(this.getActiveLayer());
				if (!layer) return;
				layer.background[key] = next;
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
		const spec = CONFIG.ui.sliders[key];
		bindSlider(input, value, {
			suffix: name === 'Hue' ? '\u00b0' : '%', resetValue: spec.value,
			resetButton: document.getElementById(`resetBaseBackground${name}`),
			apply: (next) => {
				const layer = this.normalizeLayer(this.getActiveLayer());
				if (!layer) return;
				layer.background.colorAdjust[key] = next;
				this.applyChange(false);
			},
			onCommit: () => this.editor.saveState('Edit background')
		});
	}

	setMode(mode) {
		const layer = this.normalizeLayer(this.getActiveLayer());
		if (!layer) return;
		this.invalidatePixelEffects();
		layer.background.mode = mode;
		syncPaintSlotSourceUI(document.getElementById(`baseBackground${mode[0].toUpperCase()}${mode.slice(1)}`), mode);
		this.applyChange(true);
	}

	applyChange(commit) {
		this.updateAutoGlitterAvailability();
		const layer = this.normalizeLayer(this.getActiveLayer());
		if (layer) this.loadPixelEffectSettings(layer);
		this.editor.requestPreviewUpdate();
		this.editor.layerManager.renderLayersList();
		if (commit) this.editor.saveState('Edit background');
	}

	getBackgroundSourceImageData(background, width, height) {
		if (background.mode === 'image') return this.editor.originalImageData;
		if (background.mode !== 'gradient') return null;
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
		ctx.fillStyle = createEffectCanvasGradient(ctx, background.gradient, { x: 0, y: 0, width, height });
		ctx.fillRect(0, 0, width, height);
		return ctx.getImageData(0, 0, width, height);
	}

	getAutoGlitterAvailability(layer = this.editor.layers?.find((entry) => entry.type === LayerType.BASE_IMAGE)) {
		layer = this.normalizeLayer(layer);
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
		layer = this.normalizeLayer(layer);
		if (!layer) return;
		this.updateAutoGlitterAvailability(layer);
		const modeButton = document.getElementById(`baseBackground${layer.background.mode[0].toUpperCase()}${layer.background.mode.slice(1)}`);
		syncPaintSlotSourceUI(modeButton || document.getElementById('baseBackgroundImage'), layer.background.mode);
		if (this.ui.color) this.ui.color.value = layer.background.color;
		['Scale', 'Opacity'].forEach((name) => {
			const key = name.toLowerCase();
			const input = document.getElementById(`baseBackground${name}`);
			const value = document.getElementById(`baseBackground${name}Value`);
			if (input) input.value = layer.background[key];
			if (value) value.innerHTML = formatUnit(layer.background[key], '%');
		});
		this.editor.applyColorAdjustToSliders('baseBackground', layer.background.colorAdjust);
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
		this.loadPixelEffectSettings(layer);
	}

	loadPixelEffectSettings(layer) {
		const settings = layer.background.pixelEffects;
		const applicable = (layer.background.mode === 'image' && this.hasBaseImage()) || layer.background.mode === 'gradient';
		syncPanelEffectAvailability(this.ui.pixelateCard, applicable);
		syncPanelEffectAvailability(this.ui.pixelCard, applicable);
		syncPanelEffectToggle(this.ui.pixelateEnabled, settings.pixelateEnabled);
		syncPanelEffectToggle(this.ui.paletteEnabled, settings.paletteEnabled);
		const setSegment = (group, value) => group?.querySelectorAll('.segmented-option').forEach((button) => {
			const active = button.dataset.value === value;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', active ? 'true' : 'false');
		});
		setSegment(this.ui.paletteMode, settings.paletteMode);
		setSegment(this.ui.paletteStyle, settings.paletteStyle);
		if (this.ui.algorithm) this.ui.algorithm.value = settings.dither.algorithm;
		if (this.ui.ditherPalette) this.ui.ditherPalette.value = settings.dither.palette;
		const setRange = (id, value, suffix) => {
			const input = document.getElementById(id);
			if (input) input.value = value;
			const output = document.getElementById(`${id}Value`);
			if (output) output.innerHTML = formatUnit(value, suffix);
		};
		setRange('pixelEffectsPixelSize', settings.pixelSize, 'px');
		setRange('pixelEffectsColorCount', settings.colorCount, '');
		setRange('pixelEffectsMergeDistinctness', settings.mergeDistinctness, '');
		setRange('pixelEffectsDetail', settings.detail, 'px');
		setRange('pixelEffectsStrength', settings.dither.strength, '%');
		setRange('pixelEffectsDitherScale', settings.dither.scale, '×');
		setRange('pixelEffectsAngle', settings.dither.angle, '°');
		if (this.ui.cleanEdges) this.ui.cleanEdges.checked = settings.cleanEdges;
		if (this.ui.shimmer) {
			const shimmerSupported = Boolean(GlitterPixelEffects.getShimmerAnimation(settings.dither.algorithm, CONFIG.tools.pixelEffects));
			this.ui.shimmer.checked = settings.dither.shimmer;
			this.ui.shimmer.disabled = !shimmerSupported;
		}
		[0, 1].forEach((index) => { const input = document.getElementById(`pixelEffectsDuotone${index}`); if (input) input.value = settings.dither.duotone[index]; });
		if (this.ui.paletteControls) this.ui.paletteControls.hidden = settings.paletteMode === 'dither' && settings.dither.palette !== 'auto';
		if (this.ui.posterizeControls) this.ui.posterizeControls.hidden = settings.paletteMode !== 'posterize';
		if (this.ui.ditherControls) this.ui.ditherControls.hidden = settings.paletteMode !== 'dither';
		if (this.ui.duotone) this.ui.duotone.hidden = settings.dither.palette !== 'duotone';
		if (this.ui.angle) this.ui.angle.closest('.setting-column').hidden = settings.dither.algorithm !== 'halftone';
		if (this.ui.ditherScale) this.ui.ditherScale.closest('.setting-column').hidden = !['bayer', 'halftone'].includes(settings.dither.algorithm);
	}

	updateGlitterInfo(layer) {
		const glitter = this.editor.glitterManager.getItemById(layer.selectedGlitterId);
		if (!glitter) return;
		this.editor.renderGlitterAssetDisplay({
			thumbnail: this.ui.glitterChip,
			name: this.ui.glitterLabel,
			badges: this.ui.glitterBadges,
			size: this.ui.glitterSize,
			frames: this.ui.glitterFrames
		}, glitter, layer.background.colorAdjust);
	}

	armPicker() {
		const layer = this.getActiveLayer();
		if (!layer) return;
		pickerOpenSession(this, { layerId: layer.id }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => revealAssetBrowser(this.editor, this.editor.glitterManager, layer.selectedGlitterId)
		});
	}

	hasActivePickerSession() {
		return Boolean(this.pickerSession && this.getActiveLayer()?.id === this.pickerSession.layerId);
	}

	updatePickerStrip() {
		const layer = this.getActiveLayer();
		if (!layer) return;
		const armed = this.hasActivePickerSession();
		renderPickerStrip({
			ownsStrip: true,
			visible: armed,
			armed,
			title: 'Choosing background glitter',
			detail: 'Applying to Canvas Background'
		});
	}

	closePicker() {
		this.closePickerSession();
		returnFromPickerToProperties(this.editor, { section: 'baseLayerSettings', focusId: 'baseBackgroundGlitterChip' });
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
}
