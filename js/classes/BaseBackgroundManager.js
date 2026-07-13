// Canvas Background is a permanent, structurally locked base layer whose
// appearance remains editable through the same paint-source system as shapes,
// text, and glitter fills.
class BaseBackgroundManager {
	constructor(editor) {
		this.editor = editor;
		this.pickerSession = null;
		this.setupUI();
		this.setupEventListeners();
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
		Object.assign(layer.background, {
			mode: ['image', 'none', 'glitter', 'solid', 'gradient'].includes(layer.background.mode) ? layer.background.mode : 'image',
			color: layer.background.color || '#ffffff',
			gradient: normalizeEffectGradient(layer.background.gradient),
			scale: Number(layer.background.scale ?? CONFIG.tools.effects.defaults.scale),
			opacity: Number(layer.background.opacity ?? 100),
			colorAdjust: normalizeColorAdjust(layer.background.colorAdjust)
		});
		return layer;
	}

	setupUI() {
		const id = (value) => document.getElementById(value);
		this.ui = {
			section: id('baseLayerSettingsSection'),
			imageInfo: id('baseBackgroundImageInfo'), imageThumbnail: id('baseBackgroundImageThumbnail'),
			imageName: id('baseBackgroundImageName'), imageChange: id('baseBackgroundImageChange'),
			glitterInfo: id('baseBackgroundGlitterInfo'), glitterChip: id('baseBackgroundGlitterChip'),
			glitterLabel: id('baseBackgroundGlitterLabel'), glitterBadges: id('baseBackgroundGlitterBadges'),
			glitterSize: id('baseBackgroundGlitterSize'), glitterFrames: id('baseBackgroundGlitterFrames'),
			glitterChange: id('baseBackgroundGlitterChange'), color: id('baseBackgroundColor'),
			gallerySection: id('designGallerySection'), pickerStrip: id('galleryPickerStrip'),
			pickerTitle: id('galleryPickerStripTitle'), pickerDetail: id('galleryPickerStripDetail'), pickerDone: id('galleryPickerStripDone')
		};
		// The legacy host lives in Design's source markup. Once schema rendering
		// has populated it, promote it to a sibling accordion section.
		const designGallery = id('designGallerySection');
		if (this.ui.section && designGallery?.parentElement && this.ui.section.parentElement !== designGallery.parentElement) {
			designGallery.after(this.ui.section);
		}
		// Canvas Size is a canvas/background property. Move the existing control
		// intact so its established listeners, ids, and SCSS remain the authority.
		const canvasSize = id('canvasSizeGroup');
		const canvasHost = id('baseCanvasSizeHost');
		if (canvasSize && canvasHost) canvasHost.replaceWith(canvasSize);
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
		this.ui.color?.addEventListener('change', () => this.editor.saveState());
		[this.ui.glitterChip, this.ui.glitterChange].forEach((button) => button?.addEventListener('click', () => this.armPicker()));
		this.ui.imageChange?.addEventListener('click', () => this.chooseReplacementImage());
		this.ui.pickerDone?.addEventListener('click', () => { if (this.hasActivePickerSession()) this.closePicker(); });
		this.bindRange('Scale', 'scale');
		this.bindRange('Opacity', 'opacity');
		['Hue', 'Saturation', 'Brightness'].forEach((name) => this.bindColorAdjust(name));
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
			onCommit: () => this.editor.saveState()
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
			onCommit: () => this.editor.saveState()
		});
	}

	setMode(mode) {
		const layer = this.normalizeLayer(this.getActiveLayer());
		if (!layer) return;
		layer.background.mode = mode;
		syncPaintSlotSourceUI(document.getElementById(`baseBackground${mode[0].toUpperCase()}${mode.slice(1)}`), mode);
		this.applyChange(true);
	}

	applyChange(commit) {
		this.editor.updatePreview();
		this.editor.layerManager.renderLayersList();
		if (commit) this.editor.saveState();
	}

	loadLayerSettings(layer) {
		layer = this.normalizeLayer(layer);
		if (!layer) return;
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
		const hasImage = this.hasBaseImage();
		if (this.ui.imageName) this.ui.imageName.textContent = hasImage
			? (this.editor.baseImageSource?.file?.name || 'Base Image')
			: 'No base image';
		if (this.ui.imageThumbnail) {
			this.ui.imageThumbnail.style.backgroundImage = hasImage
				? `url(${this.editor.layerManager.baseImageSwatchDataUrl || ''})`
				: 'none';
			this.ui.imageThumbnail.classList.toggle('empty', !hasImage);
		}
		if (this.ui.imageChange) this.ui.imageChange.textContent = hasImage ? 'Replace' : 'Choose Image';
		this.updateGlitterInfo(layer);
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
		this.pickerSession = { layerId: layer.id };
		this.updatePickerStrip();
		revealAssetBrowser(this.editor, this.editor.glitterManager, layer.selectedGlitterId);
	}

	hasActivePickerSession() {
		return Boolean(this.getActiveLayer()?.id === this.pickerSession?.layerId);
	}

	updatePickerStrip() {
		const layer = this.getActiveLayer();
		if (!layer) return;
		const armed = this.hasActivePickerSession();
		this.ui.pickerStrip.hidden = !armed;
		this.ui.pickerStrip.classList.toggle('is-armed', armed);
		this.ui.gallerySection?.classList.toggle('picker-mode', armed);
		if (!armed) return;
		this.ui.pickerTitle.textContent = 'Choosing background glitter';
		this.ui.pickerDetail.textContent = 'Applying to Canvas Background';
		this.ui.pickerDone.hidden = false;
	}

	closePicker() {
		this.pickerSession = null;
		this.updatePickerStrip();
		if (this.editor.mobileManager?.isMobile) {
			if (this.editor.mobileManager.activeDrawer === 'design') this.editor.mobileManager.closeAllDrawers();
			return;
		}
		this.editor.setCollapsibleSectionOpen?.('baseLayerSettings', true, true);
	}

	chooseReplacementImage() {
		document.getElementById('imageUpload')?.click();
	}
}
