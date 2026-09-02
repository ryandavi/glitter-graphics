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
// v1 simplification vs text: all glitter-mode slots share ONE swatch
// (layer.selectedGlitterId), so a shape has a single glitter frame source keyed
// by layer.id (like a glitter-fill layer). Per-slot independent glitter is a
// future enhancement; the data model already carries per-slot scale/opacity/
// colorAdjust.
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
		// Shared gallery picker strip (same DOM the text picker uses).
		this.ui.gallerySection = id('designGallerySection');
		this.ui.pickerStrip = id('galleryPickerStrip');
		this.ui.pickerStripTitle = id('galleryPickerStripTitle');
		this.ui.pickerStripDetail = id('galleryPickerStripDetail');
		this.ui.pickerStripDone = id('galleryPickerStripDone');
		this.ui.opacity = id('shapeOpacity');
		this.ui.opacityValue = id('shapeOpacityValue');
		this.ui.rotation = id('shapeRotation');
		this.ui.rotationValue = id('shapeRotationValue');
		this.ui.posX = id('shapePosX');
		this.ui.posY = id('shapePosY');
		this.ui.flipX = id('shapeFlipX');
		this.ui.flipY = id('shapeFlipY');
		this.ui.borderEnabled = id('shapeBorderEnabled');
		this.ui.borderControls = id('shapeBorderControls');
		this.ui.borderWidth = id('shapeBorderWidth');
		this.ui.borderWidthValue = id('shapeBorderWidthValue');
		this.ui.borderStyleSolid = id('shapeBorderStyleSolid');
		this.ui.borderStyleDotted = id('shapeBorderStyleDotted');
		this.ui.borderDotSpacing = id('shapeBorderDotSpacing');
		this.ui.borderDotSpacingValue = id('shapeBorderDotSpacingValue');
		this.ui.borderDotSpacingRow = id('shapeBorderDotSpacingRow');
		this.ui.borderOpacity = id('shapeBorderOpacity');
		this.ui.borderOpacityValue = id('shapeBorderOpacityValue');
		this.ui.borderEdgeRounded = id('shapeBorderEdgeRounded');
		this.ui.borderEdgeHard = id('shapeBorderEdgeHard');
		this.ui.borderPositionOutside = id('shapeBorderPositionOutside');
		this.ui.borderPositionCenter = id('shapeBorderPositionCenter');
		this.ui.borderPositionInside = id('shapeBorderPositionInside');
		this.ui.borderOrderBehind = id('shapeBorderOrderBehind');
		this.ui.borderOrderFront = id('shapeBorderOrderFront');
		this.ui.shadowEnabled = id('shapeShadowEnabled');
		this.ui.shadowControls = id('shapeShadowControls');
		this.ui.shadowOffsetX = id('shapeShadowOffsetX');
		this.ui.shadowOffsetXValue = id('shapeShadowOffsetXValue');
		this.ui.shadowOffsetY = id('shapeShadowOffsetY');
		this.ui.shadowOffsetYValue = id('shapeShadowOffsetYValue');
		this.ui.shadowOpacity = id('shapeShadowOpacity');
		this.ui.shadowOpacityValue = id('shapeShadowOpacityValue');
		this.ui.resetEffects = id('resetShapeEffects');
		this.ui.fillOpacity = id('shapeFillOpacity');
		this.ui.fillOpacityValue = id('shapeFillOpacityValue');

		// Per-slot source-control refs (segmented buttons, glitter display, color).
		['shapeFill', 'shapeBorder', 'shapeShadow'].forEach((prefix) => {
			['None', 'Glitter', 'Solid'].forEach((m) => { this.ui[prefix + m] = id(prefix + m); });
			this.ui[prefix + 'GlitterInfo'] = id(prefix + 'GlitterInfo');
			this.ui[prefix + 'GlitterChip'] = id(prefix + 'GlitterChip');
			this.ui[prefix + 'GlitterChange'] = id(prefix + 'GlitterChange');
			this.ui[prefix + 'GlitterLabel'] = id(prefix + 'GlitterLabel');
			this.ui[prefix + 'GlitterBadges'] = id(prefix + 'GlitterBadges');
			this.ui[prefix + 'GlitterSize'] = id(prefix + 'GlitterSize');
			this.ui[prefix + 'GlitterFrames'] = id(prefix + 'GlitterFrames');
			this.ui[prefix + 'ColorRow'] = id(prefix + 'ColorRow');
			this.ui[prefix + 'Color'] = id(prefix + 'Color');
			// The slot's Advanced (color-adjust) block — glitter-only.
			const info = this.ui[prefix + 'GlitterInfo'];
			this.ui[prefix + 'Advanced'] = info?.closest('.paint-slot-card')?.querySelector('.advanced-disclosure') || null;
		});
		['shapeFill', 'shapeBorder', 'shapeShadow'].forEach((prefix) => {
			const slot = prefix === 'shapeFill' ? 'fill' : prefix === 'shapeBorder' ? 'border' : 'shadow';
			installEffectGradientEditor({
				prefix,
				getData: () => {
					const layer = this.getActiveShapeLayer();
					return layer ? this.ensureEffectData(layer, slot) : null;
				},
				onUpdate: (commit) => {
					const layer = this.getActiveShapeLayer();
					if (!layer) return;
					this.renderLayer(layer);
					if (commit) this.editor.saveState('Edit shape');
				}
			});
		});

		const borderConfig = CONFIG.tools.shapes.border || {};
		if (this.ui.borderWidth) {
			this.ui.borderWidth.min = String(borderConfig.minWidthPx ?? 1);
			this.ui.borderWidth.max = String(borderConfig.maxWidthPx ?? 60);
		}
		if (this.ui.borderDotSpacing) {
			this.ui.borderDotSpacing.min = String(borderConfig.minDotSpacingPx ?? 1);
			this.ui.borderDotSpacing.max = String(borderConfig.maxDotSpacingPx ?? 60);
		}

		this.renderShapePicker();
		this.renderShapeGallery();
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
	}

	_syncPickerActive() {
		const activeLayer = this.getActiveShapeLayer();
		const current = activeLayer ? activeLayer.shapeData.shapeId : this.getActiveShapeId();
		this.ui.picker?.querySelectorAll('.brush-shape-option').forEach((el) => {
			const selected = el.dataset.shape === current;
			el.classList.toggle('active', selected);
			el.setAttribute('aria-selected', selected ? 'true' : 'false');
		});
	}

	setupEventListeners() {
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

		// Fill / Border / Shadow source segmented controls.
		this._bindSource('shapeFill', 'fill', ['none', 'glitter', 'solid']);
		this._bindSource('shapeBorder', 'border', ['glitter', 'solid']);
		this._bindSource('shapeShadow', 'shadow', ['glitter', 'solid']);

		// Solid color inputs.
		this._bindColor('shapeFillColor', 'fill');
		this._bindColor('shapeBorderColor', 'border');
		this._bindColor('shapeShadowColor', 'shadow');

		// Glitter chip / Change → arm the gallery picker for that slot (shows the
		// strip + Done, like text). v1: all glitter slots share the one swatch.
		['shapeFill', 'shapeBorder', 'shapeShadow'].forEach((prefix) => {
			const slot = prefix === 'shapeFill' ? 'fill' : prefix === 'shapeBorder' ? 'border' : 'shadow';
			[this.ui[prefix + 'GlitterChip'], this.ui[prefix + 'GlitterChange']].forEach((btn) => {
				btn?.addEventListener('click', () => this.armPicker(slot));
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

		// Effect enable toggles.
		this.ui.borderEnabled?.addEventListener('change', () => this._toggleEffect('border', this.ui.borderEnabled.checked));
		this.ui.shadowEnabled?.addEventListener('change', () => this._toggleEffect('shadow', this.ui.shadowEnabled.checked));
		this.ui.resetEffects?.addEventListener('click', () => this._resetEffects());

		// Geometry sliders (change the mask → invalidate).
		this._attachSlider(this.ui.borderWidth, this.ui.borderWidthValue, 'px', (v, l) => { this.ensureEffectData(l, 'border').widthPx = v; }, this.getDefaultBorder().widthPx, true);
		this._attachSlider(this.ui.borderDotSpacing, this.ui.borderDotSpacingValue, 'px', (v, l) => { this.ensureEffectData(l, 'border').dotSpacingPx = v; }, this.getDefaultBorder().dotSpacingPx, true);
		this._attachSlider(this.ui.shadowOffsetX, this.ui.shadowOffsetXValue, 'px', (v, l) => { this.ensureEffectData(l, 'shadow').offsetX = v; }, this.getDefaultShadow().offsetX, true);
		this._attachSlider(this.ui.shadowOffsetY, this.ui.shadowOffsetYValue, 'px', (v, l) => { this.ensureEffectData(l, 'shadow').offsetY = v; }, this.getDefaultShadow().offsetY, true);

		// Non-geometry sliders (opacity, hsb) — re-render only.
		this._attachSlider(this.ui.borderOpacity, this.ui.borderOpacityValue, '%', (v, l) => { this.ensureEffectData(l, 'border').opacity = v; }, 100, false);
		this._attachSlider(this.ui.shadowOpacity, this.ui.shadowOpacityValue, '%', (v, l) => { this.ensureEffectData(l, 'shadow').opacity = v; }, 100, false);
		this._attachSlider(this.ui.fillOpacity, this.ui.fillOpacityValue, '%', (v, l) => { this.ensureEffectData(l, 'fill').opacity = v; }, 100, false);
		// Position / Transform / Scale / Flip are wired by the shared
		// app.setupTransformListeners('shape', …) — same code as sticker + text.

		// Per-slot Advanced: Scale + HSB (color adjust). Scale is a texture scale
		// (non-geometry). All reuse the color-adjust module.
		this._bindSlotAdvanced('shapeFill', 'fill');
		this._bindSlotAdvanced('shapeBorder', 'border');
		this._bindSlotAdvanced('shapeShadow', 'shadow');
		[
			['shapeFill', 'fill'],
			['shapeBorder', 'border'],
			['shapeShadow', 'shadow']
		].forEach(([prefix, slot]) => {
			bindSlotTextureCoordinateControls({
				prefix,
				getLayer: () => this.getActiveShapeLayer(),
				getData: (layer) => this.ensureEffectData(layer, slot),
				render: (layer) => this.renderLayer(layer),
				save: () => this.editor.saveState('Edit shape')
			});
		});

		this.ui.borderStyleSolid?.addEventListener('click', () => this.setBorderStyle('solid'));
		this.ui.borderStyleDotted?.addEventListener('click', () => this.setBorderStyle('dotted'));
		this.ui.borderEdgeRounded?.addEventListener('click', () => this.setBorderEdgeStyle('round'));
		this.ui.borderEdgeHard?.addEventListener('click', () => this.setBorderEdgeStyle('hard'));
		this.ui.borderPositionOutside?.addEventListener('click', () => this.setBorderPlacement('outside'));
		this.ui.borderPositionCenter?.addEventListener('click', () => this.setBorderPlacement('center'));
		this.ui.borderPositionInside?.addEventListener('click', () => this.setBorderPlacement('inside'));
		this.ui.borderOrderBehind?.addEventListener('click', () => this.setBorderDrawOrder('behind'));
		this.ui.borderOrderFront?.addEventListener('click', () => this.setBorderDrawOrder('front'));
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

	_cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

	_bindSource(prefix, slot, modes) {
		modes.forEach((mode) => {
			const btn = this.ui[prefix + this._cap(mode)];
			btn?.addEventListener('click', () => {
				const layer = this.getActiveShapeLayer();
				if (!layer) return;
				const data = this.ensureEffectData(layer, slot);
				data.mode = mode;
				// Switching to glitter never opens the gallery and is never empty —
				// fall back to the default glitter. The gallery opens only via the
				// swatch/Change buttons (armPicker).
				if (mode === 'glitter' && !this.getSlotGlitterId(layer, slot)) {
					if (slot === 'fill') layer.selectedGlitterId = CONFIG.tools.glitter.defaults.fillGlitterId;
					else if (slot === 'border') data.glitterId = CONFIG.tools.glitter.defaults.borderGlitterId;
					else if (slot === 'shadow') data.glitterId = CONFIG.tools.glitter.defaults.shadowGlitterId;
				}
				this._refreshSourceUI(layer, slot);
				this.invalidateMeasurement(layer);
				this.renderLayer(layer);
				this.editor.saveState('Edit shape');
				this.editor.layerManager.renderLayersList();
			});
		});
	}

	_bindColor(id, slot) {
		const input = document.getElementById(id);
		input?.addEventListener('input', () => {
			const layer = this.getActiveShapeLayer();
			if (!layer) return;
			this.ensureEffectData(layer, slot).color = input.value;
			this.renderLayer(layer);
		});
		input?.addEventListener('change', () => this.editor.saveState('Edit shape'));
	}

	_bindSlotAdvanced(prefix, slot) {
		const axes = [
			['Scale', 'scale', '%'],
			['Hue', 'hue', '°'],
			['Saturation', 'saturation', '%'],
			['Brightness', 'brightness', '%']
		];
		axes.forEach(([suffix, key, unit]) => {
			const slider = document.getElementById(prefix + suffix);
			const valueEl = document.getElementById(prefix + suffix + 'Value');
			if (!slider) return;
			this._attachSlider(slider, valueEl, unit, (v, layer) => {
				const data = this.ensureEffectData(layer, slot);
				if (key === 'scale') {
					data.scale = v;
				} else {
					this.ensureColorAdjust(data)[key] = v;
					this.refreshSlotSwatch(layer, slot);
				}
			}, key === 'scale' ? 100 : COLOR_ADJUST_IDENTITY[key], false);
		});
	}

	ensureColorAdjust(target) {
		return ensureSlotColorAdjust(target);
	}

	_attachSlider(slider, valueEl, suffix, apply, resetValue, geometry) {
		if (!slider) return;
		const resetBtn = document.getElementById('reset' + this._cap(slider.id));

		bindSlider(slider, valueEl, {
			suffix,
			resetValue,
			resetButton: resetBtn,
			apply: (value) => {
				const layer = this.getActiveShapeLayer();
				if (!layer) return;
				if (geometry) {
					this.mutateGeometryPreservingShape(layer, () => apply(value, layer));
				} else {
					apply(value, layer);
				}
				this.renderLayer(layer);
			},
			onCommit: () => {
				this.editor.saveState('Edit shape');
				this.editor.layerManager.renderLayersList();
			}
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

	_toggleEffect(slot, enabled) {
		const layer = this.getActiveShapeLayer();
		if (!layer) return;
		this.mutateGeometryPreservingShape(layer, () => {
			layer.shapeData.effectDrafts ||= {};
			if (enabled) {
				layer.shapeData[slot] = layer.shapeData.effectDrafts[slot] || this.ensureEffectData(layer, slot);
				delete layer.shapeData.effectDrafts[slot];
			} else {
				if (layer.shapeData[slot]) layer.shapeData.effectDrafts[slot] = layer.shapeData[slot];
				layer.shapeData[slot] = null;
			}
		});
		this.loadLayerSettings(layer);
		this.renderLayer(layer);
		this.editor.saveState('Edit shape');
		this.editor.layerManager.renderLayersList();
	}

	_resetEffects() {
		const layer = this.getActiveShapeLayer();
		if (!layer) return;
		this.mutateGeometryPreservingShape(layer, () => {
			layer.shapeData.border = null;
			layer.shapeData.shadow = null;
			delete layer.shapeData.effectDrafts;
		});
		this.loadLayerSettings(layer);
		this.renderLayer(layer);
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

		const stripText = !armed && !assetArmed
			? {}
			: assetArmed
				? formatAssetPickerStripText('shape', layer.name)
				: formatPickerStripText(s.slot, layer.name, 'shape');
		renderPickerStrip({
			ownsStrip: true,
			visible: armed || assetArmed,
			armed: armed || assetArmed,
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

	_refreshSourceUI(layer, slot) {
		const prefix = slot === 'fill' ? 'shapeFill' : slot === 'border' ? 'shapeBorder' : 'shapeShadow';
		const data = this.getEffectData(layer, slot);
		const mode = data?.mode || 'solid';

		const glitterInfo = this.ui[prefix + 'GlitterInfo'];
		syncPaintSlotSourceUI(this.ui[prefix + 'Glitter'], mode);

		if (mode === 'glitter') {
			// Glitter mode is never empty — fall back to the default glitter.
			if (!this.getSlotGlitterId(layer, slot)) {
				if (slot === 'fill') layer.selectedGlitterId = CONFIG.tools.glitter.defaults.fillGlitterId;
				else if (slot === 'border') data.glitterId = CONFIG.tools.glitter.defaults.borderGlitterId;
				else if (slot === 'shadow') data.glitterId = CONFIG.tools.glitter.defaults.shadowGlitterId;
			}
			const glitter = this.editor.glitterManager.getItemById(this.getSlotGlitterId(layer, slot));
			const els = {
				thumbnail: this.ui[prefix + 'GlitterChip'],
				name: this.ui[prefix + 'GlitterLabel'],
				badges: this.ui[prefix + 'GlitterBadges'],
				size: this.ui[prefix + 'GlitterSize'],
				frames: this.ui[prefix + 'GlitterFrames']
			};
			if (glitter) {
				this.editor.renderGlitterAssetDisplay(els, glitter, this.getSlotColorAdjust(layer, slot));
			} else if (this.editor.clearGlitterAssetDisplay) {
				this.editor.clearGlitterAssetDisplay(els);
			}
		}
	}

	_loadColorAdjust(prefix, adjust, scale) {
		const a = normalizeColorAdjust(adjust);
		const set = (suffix, value, unit) => {
			const slider = document.getElementById(prefix + suffix);
			const display = document.getElementById(prefix + suffix + 'Value');
			if (slider) slider.value = String(value);
			if (display) display.innerHTML = formatUnit(value, unit);
		};
		set('Scale', scale ?? 100, '%');
		set('Hue', a.hue, '°');
		set('Saturation', a.saturation, '%');
		set('Brightness', a.brightness, '%');
	}

	loadLayerSettings(layer) {
		if (!layer || layer.type !== LayerType.SHAPE) return;
		this.normalizeLayer(layer);
		const d = layer.shapeData;
		const fillDefaults = this.getDefaultFill();
		const borderDefaults = this.getDefaultBorder();
		const shadowDefaults = this.getDefaultShadow();
		if (this.ui.assetThumbnail) this.ui.assetThumbnail.innerHTML = ShapeLibrary.getIconSvg(d.shapeId);
		if (this.ui.assetName) this.ui.assetName.textContent = this.getShapeLabel(d.shapeId);

		this._syncPickerActive();

		// Position/Transform/Scale/Flip use the shared transform panel.
		this.editor.loadTransformSettings?.(layer, 'shape');

		// Border
		const border = d.border;
		syncPanelEffectToggle(this.ui.borderEnabled, Boolean(border));
		// .property-module-content is display:none until it has the .visible class
		// (NOT the hidden attribute) — reuse the same mechanism as text.
		const bd = border || borderDefaults;
		if (this.ui.borderWidth) { this.ui.borderWidth.value = bd.widthPx; this.ui.borderWidthValue.innerHTML = formatUnit(bd.widthPx, 'px'); }
		if (this.ui.borderDotSpacing) { this.ui.borderDotSpacing.value = bd.dotSpacingPx ?? borderDefaults.dotSpacingPx; this.ui.borderDotSpacingValue.innerHTML = formatUnit(bd.dotSpacingPx ?? borderDefaults.dotSpacingPx, 'px'); }
		if (this.ui.borderOpacity) { this.ui.borderOpacity.value = bd.opacity ?? borderDefaults.opacity; this.ui.borderOpacityValue.innerHTML = formatUnit(bd.opacity ?? borderDefaults.opacity, '%'); }
		if (this.ui.shapeBorderColor) this.ui.shapeBorderColor.value = bd.color || '#000000';
		this._syncBorderStyleUI(bd);
		this._syncBorderEdgeUI(bd);
		this._syncBorderPlacementUI(bd);
		this._syncBorderDrawOrderUI(bd);
		this._loadColorAdjust('shapeBorder', bd.colorAdjust, bd.scale ?? borderDefaults.scale);

		// Shadow
		const shadow = d.shadow;
		syncPanelEffectToggle(this.ui.shadowEnabled, Boolean(shadow));
		const sd = shadow || shadowDefaults;
		if (this.ui.shadowOffsetX) { this.ui.shadowOffsetX.value = sd.offsetX; this.ui.shadowOffsetXValue.innerHTML = formatUnit(sd.offsetX, 'px'); }
		if (this.ui.shadowOffsetY) { this.ui.shadowOffsetY.value = sd.offsetY; this.ui.shadowOffsetYValue.innerHTML = formatUnit(sd.offsetY, 'px'); }
		if (this.ui.shadowOpacity) { this.ui.shadowOpacity.value = sd.opacity ?? shadowDefaults.opacity; this.ui.shadowOpacityValue.innerHTML = formatUnit(sd.opacity ?? shadowDefaults.opacity, '%'); }
		if (this.ui.shapeShadowColor) this.ui.shapeShadowColor.value = sd.color || '#000000';
		this._loadColorAdjust('shapeShadow', sd.colorAdjust, sd.scale ?? shadowDefaults.scale);
		syncSlotTextureCoordinateControls('shapeShadow', sd);

		// Fill
		if (this.ui.shapeFillColor) this.ui.shapeFillColor.value = d.fill.color || '#ff66cc';
		if (this.ui.fillOpacity) { this.ui.fillOpacity.value = d.fill.opacity ?? fillDefaults.opacity; this.ui.fillOpacityValue.innerHTML = formatUnit(d.fill.opacity ?? fillDefaults.opacity, '%'); }
		this._loadColorAdjust('shapeFill', d.fill.colorAdjust, d.fill.scale ?? fillDefaults.scale);
		syncSlotTextureCoordinateControls('shapeFill', d.fill);
		syncSlotTextureCoordinateControls('shapeBorder', bd);

		this._refreshSourceUI(layer, 'fill');
		this._refreshSourceUI(layer, 'border');
		this._refreshSourceUI(layer, 'shadow');
	}

	// ===== DEFAULTS / DATA MODEL =====

	getDefaultFill() {
		return buildDefaultFill({ includeTexture: true });
	}

	getDefaultBorder() {
		return buildDefaultBorder({
			config: CONFIG.tools.shapes.border || {},
			fallbackWidthPx: 6,
			fallbackMode: 'glitter',
			includeShapeStyle: true,
			includeColorAdjust: true,
			defaultGlitterId: CONFIG.tools.glitter.defaults.borderGlitterId
		});
	}

	getDefaultShadow() {
		return buildDefaultShadow({
			config: CONFIG.tools.shapes.shadow || {},
			defaultMode: 'glitter',
			defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId,
			includeColorAdjust: true
		});
	}

	normalizeLayer(layer) {
		if (!layer || layer.type !== LayerType.SHAPE) return;
		const data = layer.shapeData;
		data.fill = { ...this.getDefaultFill(), ...(data.fill || {}) };
		if (data.border === undefined) data.border = null;
		if (data.border) data.border = { ...this.getDefaultBorder(), ...data.border };
		if (data.shadow === undefined) data.shadow = null;
		if (data.shadow) data.shadow = { ...this.getDefaultShadow(), ...data.shadow };
		normalizeSlotTextureCoordinates(data.fill);
		normalizeSlotTextureCoordinates(data.border);
		normalizeSlotTextureCoordinates(data.shadow);
		if (!data.transform) {
			data.transform = createDefaultTransform();
		}
		syncLayerTransformReference(layer, data.transform);
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
			selectedGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId,
			settings: { scale: CONFIG.tools.effects.defaults.scale, opacity: CONFIG.tools.effects.defaults.opacity },
			shapeData: {
				shapeId,
				width,
				height,
				transform,
				fill: this.getDefaultFill(),
				border: null,
				shadow: null
			}
		};

		layer.transform = transform;
		syncLayerTransformReference(layer, transform);
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
			this.normalizeLayer(layer);
			return layer;
		}
		return null;
	}

	getEffectData(layer, slot) {
		this.normalizeLayer(layer);
		return getSlotEffectData(layer?.shapeData, slot);
	}

	// mergeBorderDefaults is true: backfill newer border keys onto legacy data.
	ensureEffectData(layer, slot) {
		this.normalizeLayer(layer);
		if (!layer?.shapeData) return null;
		return ensureSlotEffectData(layer.shapeData, slot, {
			builders: {
				fill: () => this.getDefaultFill(),
				border: () => this.getDefaultBorder(),
				shadow: () => this.getDefaultShadow()
			},
			mergeBorderDefaults: true
		});
	}

	setBorderStyle(style) {
		const layer = this.getActiveShapeLayer();
		if (!layer) return;

		const border = this.ensureEffectData(layer, 'border');
		if (border.style === style) return;

		this.mutateGeometryPreservingShape(layer, () => {
			this.ensureEffectData(layer, 'border').style = style === 'dotted' ? 'dotted' : 'solid';
		});
		this._syncBorderStyleUI(this.getEffectData(layer, 'border'));
		this.renderLayer(layer);
		this.editor.saveState('Edit shape');
		this.editor.layerManager.renderLayersList();
	}

	setBorderEdgeStyle(edgeStyle) {
		const layer = this.getActiveShapeLayer();
		if (!layer) return;

		const border = this.ensureEffectData(layer, 'border');
		if (this.getBorderEdgeStyle(border) === edgeStyle) return;

		this.mutateGeometryPreservingShape(layer, () => {
			this.ensureEffectData(layer, 'border').edgeStyle = edgeStyle === 'hard' ? 'hard' : 'round';
		});
		this._syncBorderEdgeUI(this.getEffectData(layer, 'border'));
		this.renderLayer(layer);
		this.editor.saveState('Edit shape');
		this.editor.layerManager.renderLayersList();
	}

	setBorderPlacement(placement) {
		const layer = this.getActiveShapeLayer();
		if (!layer) return;

		const border = this.ensureEffectData(layer, 'border');
		if (this.getBorderPlacement(border) === placement) return;

		this.mutateGeometryPreservingShape(layer, () => {
			this.ensureEffectData(layer, 'border').placement = placement;
		});
		this._syncBorderPlacementUI(this.getEffectData(layer, 'border'));
		this.renderLayer(layer);
		this.editor.saveState('Edit shape');
		this.editor.layerManager.renderLayersList();
	}

	setBorderDrawOrder(drawOrder) {
		const layer = this.getActiveShapeLayer();
		if (!layer) return;

		const border = this.ensureEffectData(layer, 'border');
		if (this.getBorderDrawOrder(border) === drawOrder) return;

		border.drawOrder = drawOrder;
		this._syncBorderDrawOrderUI(border);
		this.renderLayer(layer);
		this.editor.saveState('Edit shape');
		this.editor.layerManager.renderLayersList();
	}

	_syncBorderStyleUI(borderData) {
		const style = borderData?.style === 'dotted' ? 'dotted' : 'solid';
		this.ui.borderStyleSolid?.classList.toggle('active', style === 'solid');
		this.ui.borderStyleDotted?.classList.toggle('active', style === 'dotted');
		if (this.ui.borderDotSpacingRow) {
			this.ui.borderDotSpacingRow.hidden = style !== 'dotted';
		}
		if (this.ui.borderDotSpacing) {
			this.ui.borderDotSpacing.disabled = style !== 'dotted';
		}
	}

	getBorderPlacement(borderData) {
		return getBorderPlacement(borderData);
	}

	getBorderEdgeStyle(borderData) {
		return getBorderEdgeStyle(borderData);
	}

	getBorderDrawOrder(borderData) {
		return getBorderDrawOrder(borderData);
	}

	getBorderOutsidePadding(borderData) {
		return getBorderOutsidePadding(borderData, {
			miterLimit: CONFIG.tools.shapes.border.hardEdgeMiterLimit
		});
	}

	_syncBorderEdgeUI(borderData) {
		const edgeStyle = this.getBorderEdgeStyle(borderData);
		this.ui.borderEdgeRounded?.classList.toggle('active', edgeStyle === 'round');
		this.ui.borderEdgeHard?.classList.toggle('active', edgeStyle === 'hard');
	}

	_syncBorderPlacementUI(borderData) {
		const placement = this.getBorderPlacement(borderData);
		this.ui.borderPositionOutside?.classList.toggle('active', placement === 'outside');
		this.ui.borderPositionCenter?.classList.toggle('active', placement === 'center');
		this.ui.borderPositionInside?.classList.toggle('active', placement === 'inside');
	}

	_syncBorderDrawOrderUI(borderData) {
		const drawOrder = this.getBorderDrawOrder(borderData);
		this.ui.borderOrderBehind?.classList.toggle('active', drawOrder === 'behind');
		this.ui.borderOrderFront?.classList.toggle('active', drawOrder === 'front');
	}

	// Glitter id for a slot: fill shares the layer swatch (like text); border and
	// shadow carry their own so each can be an independent glitter.
	getSlotGlitterId(layer, slot) {
		return slot === 'fill' ? layer.selectedGlitterId : this.getEffectData(layer, slot)?.glitterId;
	}

	// Each slot's colorAdjust lives on its own effect object (fill = shapeData.fill).
	getSlotColorAdjust(layer, slot) {
		return this.getEffectData(layer, slot)?.colorAdjust;
	}

	// Live-tint this slot's glitter chip (and, for fill, the layers-list swatch) to
	// match a colorAdjust drag without a full panel reload.
	refreshSlotSwatch(layer, slot) {
		const prefix = slot === 'fill' ? 'shapeFill' : slot === 'border' ? 'shapeBorder' : 'shapeShadow';
		const chip = this.ui[prefix + 'GlitterChip'];
		if (chip) chip.style.filter = buildCssColorFilter(this.getSlotColorAdjust(layer, slot));
		if (slot === 'fill') this.editor.refreshLayerSwatchFilter(layer);
	}

	// Shared with GifExporter via resolveEffectPaintSource so preview/export stay aligned.
	getEffectPaintSource(layer, slot) {
		return resolveEffectPaintSource(this.getEffectData(layer, slot), {
			allowNone: slot === 'fill',
			glitterId: this.getSlotGlitterId(layer, slot),
			glitterAvailable: (glitterId) => Boolean(this.editor.glitterManager.getItemById(glitterId))
		});
	}

	// ===== MASK / MEASUREMENT =====

	getMeasurementCacheKey(layer) {
		const d = layer.shapeData;
		return JSON.stringify([
			d.shapeId,
			d.width,
			d.height,
			d.border ? [d.border.widthPx, d.border.style || 'solid', d.border.dotSpacingPx ?? this.getDefaultBorder().dotSpacingPx, this.getBorderPlacement(d.border), this.getBorderEdgeStyle(d.border)] : null,
			d.shadow ? [d.shadow.offsetX, d.shadow.offsetY] : null,
			shouldUseCrispMaskEdges(),
			CONFIG.rendering.maskAlphaThreshold
		]);
	}

	// Rasterize the shape into a padded mask canvas (crisp-thresholded like text,
	// per CONFIG.rendering.crispMaskEdges — same GIF-fringe reasoning). Returns the
	// canvas plus the shape's frame rect within it (for handles/selection).
	getMeasurementEntry(layer) {
		this.normalizeLayer(layer);
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
		const borderWidth = this.getBorderOutsidePadding(d.border);
		const shX = d.shadow?.offsetX || 0;
		const shY = d.shadow?.offsetY || 0;

		const inkLeft = Math.min(-borderWidth, shX);
		const inkRight = Math.max(w + borderWidth, w + shX);
		const inkTop = Math.min(-borderWidth, shY);
		const inkBottom = Math.max(h + borderWidth, h + shY);

		const layoutX = padding - inkLeft;
		const layoutY = padding - inkTop;
		const canvasWidth = Math.max(1, Math.ceil(inkRight - inkLeft + padding * 2));
		const canvasHeight = Math.max(1, Math.ceil(inkBottom - inkTop + padding * 2));

		const canvas = document.createElement('canvas');
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
		ShapeLibrary.trace(d.shapeId, ctx, w / 2, h / 2, { fit: 'fill' });
		ctx.restore();

		if (shouldUseCrispMaskEdges()) {
			binarizeCanvasAlpha(ctx, canvasWidth, canvasHeight);
		}

		const entry = {
			key,
			canvas,
			width: canvasWidth,
			height: canvasHeight,
			frameRect: {
				x: layoutX + inkLeft,
				y: layoutY + inkTop,
				width: inkRight - inkLeft,
				height: inkBottom - inkTop
			},
			shapeRect: { x: layoutX, y: layoutY, width: w, height: h },
			// Kept so the border can be re-derived as a vector STROKE of the path
			// (smooth) rather than a ring-union of the raster silhouette (scalloped).
			shapeId: d.shapeId,
			shapeW: w,
			shapeH: h,
			layoutX,
			layoutY
		};

		this.measurementCache.set(key, entry);
		while (this.measurementCache.size > this.maxMeasurementCacheEntries) {
			const oldestKey = this.measurementCache.keys().next().value;
			this.measurementCache.delete(oldestKey);
		}
		d.renderWidth = canvasWidth;
		d.renderHeight = canvasHeight;
		return entry;
	}

	// The user-facing frame in shape-local units, centered relative to the padded
	// mask canvas (mirrors TextGlitterManager.getTextFrame). It includes border
	// and shadow so selection, snapping, and transforms describe visible pixels.
	// NOT named getShapeFrame(layer): that name is already a class method below
	// (hit-test frame, returns raw {x,y,width,height} in a different shape) and a
	// second same-named method here would silently shadow one of them.
	getShapeHandleFrame(layer, measurement = null) {
		this.normalizeLayer(layer);
		if (!layer?.shapeData) return null;

		const entry = measurement || this.getMeasurementEntry(layer);
		const rect = entry.frameRect;
		if (!rect) return null;

		return {
			width: rect.width,
			height: rect.height,
			offsetX: rect.x + rect.width / 2 - entry.width / 2,
			offsetY: rect.y + rect.height / 2 - entry.height / 2
		};
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
		const drawOrder = this.getBorderDrawOrder(borderData);
		const placement = this.getBorderPlacement(borderData);
		const edgeStyle = this.getBorderEdgeStyle(borderData);
		const effectivePlacement = borderStyle === 'dotted' && placement === 'outside' && drawOrder === 'front'
			? 'center'
			: placement;
		const dotSpacingPx = Math.max(1, borderData?.dotSpacingPx ?? this.getDefaultBorder().dotSpacingPx);
		const canvas = document.createElement('canvas');
		canvas.width = measurement.canvas.width;
		canvas.height = measurement.canvas.height;
		canvas._textureOrigin = { ...measurement.canvas._textureOrigin };
		const ctx = canvas.getContext('2d', { willReadFrequently: true });

		const path = ShapeLibrary.buildTransformedPath(measurement.shapeId, measurement.shapeW / 2, measurement.shapeH / 2, { fit: 'fill' });
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

	// Full mask set for a shape (fill / border / shadow) in local render space.
	// SINGLE source of truth used by both the live preview (getSpanDescriptors)
	// and the exporter (via the renderShapeMask callback) — so they never diverge.
	buildMaskEntry(layer) {
		const measurement = this.getMeasurementEntry(layer);
		const d = layer.shapeData;
		const entry = {
			fill: measurement.canvas,
			border: null,
			shadow: null,
			renderWidth: measurement.width,
			renderHeight: measurement.height,
			measurement
		};
		if (d.shadow) {
			entry.shadow = this._offsetCanvas(measurement.canvas, d.shadow.offsetX || 0, d.shadow.offsetY || 0);
		}
		if (d.border?.widthPx > 0) {
			entry.border = this.getBorderMaskCanvas(measurement, d.border);
		}
		return entry;
	}

	_offsetCanvas(sourceCanvas, offsetX, offsetY) {
		const canvas = document.createElement('canvas');
		canvas.width = sourceCanvas.width;
		canvas.height = sourceCanvas.height;
		const sourceOrigin = sourceCanvas._textureOrigin || { x: 0, y: 0 };
		canvas._textureOrigin = {
			x: sourceOrigin.x + offsetX,
			y: sourceOrigin.y + offsetY
		};
		canvas.getContext('2d', { willReadFrequently: true }).drawImage(sourceCanvas, offsetX, offsetY);
		return canvas;
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

	renderLayer(layer) {
		if (layer.type !== LayerType.SHAPE) return;
		this.normalizeLayer(layer);

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
		wrapper.style.opacity = String((layer.shapeData.transform.opacity ?? 100) / 100);
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

		const descriptors = this.getSpanDescriptors(layer, measurement);
		const existing = new Map();
		Array.from(stack.children).forEach((child) => {
			if (child.dataset.spanKey) existing.set(child.dataset.spanKey, child);
		});

		descriptors.forEach((descriptor) => {
			let span = existing.get(descriptor.key);
			if (!span) {
				span = document.createElement('span');
				span.className = 'shape-glitter-content';
				span.dataset.spanKey = descriptor.key;
			}
			const maskUrl = this.getPreviewMaskDataUrl(descriptor.maskCanvas, descriptor.maskCacheKey);
			this.applySpanStyles(span, measurement, maskUrl);
			this.applySpanOffset(span, descriptor.offsetX, descriptor.offsetY);
			this.applyPaintSource(
				span,
				descriptor.source,
				layer,
				descriptor.maskCanvas,
				descriptor.offsetX,
				descriptor.offsetY
			);
			stack.appendChild(span);
			existing.delete(descriptor.key);
		});

		existing.forEach((span) => span.remove());
	}

	getSpanDescriptors(layer, measurement) {
		const descriptors = [];
		const shadow = this.getEffectData(layer, 'shadow');
		const border = this.getEffectData(layer, 'border');
		const drawBorderAfterFill = this.getBorderDrawOrder(border) === 'front';

		// Preview shadow uses the un-offset silhouette + a live CSS translate (so
		// dragging the offset is cheap); export bakes the same offset into the mask.
		if (shadow) {
			descriptors.push({
				key: 'shadow',
				offsetX: shadow.offsetX || 0,
				offsetY: shadow.offsetY || 0,
				source: this.getEffectPaintSource(layer, 'shadow'),
				maskCanvas: measurement.canvas,
				maskCacheKey: `${measurement.key}|fill`
			});
		}

		// Vector-stroked outer border (same getBorderMaskCanvas the exporter uses).
		const borderDescriptor = border?.widthPx > 0
			? {
				key: 'border',
				offsetX: 0,
				offsetY: 0,
				source: this.getEffectPaintSource(layer, 'border'),
				maskCanvas: this.getBorderMaskCanvas(measurement, border),
				maskCacheKey: `${measurement.key}|border:${border.widthPx}:${border.style || 'solid'}:${border.dotSpacingPx ?? this.getDefaultBorder().dotSpacingPx}:${this.getBorderPlacement(border)}:${this.getBorderDrawOrder(border)}:${this.getBorderEdgeStyle(border)}`
			}
			: null;

		if (borderDescriptor && !drawBorderAfterFill) {
			descriptors.push(borderDescriptor);
		}

		const fillSource = this.getEffectPaintSource(layer, 'fill');
		if (fillSource) {
			descriptors.push({
				key: 'fill',
				offsetX: 0,
				offsetY: 0,
				source: fillSource,
				maskCanvas: measurement.canvas,
				maskCacheKey: `${measurement.key}|fill`
			});
		}

		if (borderDescriptor && drawBorderAfterFill) {
			descriptors.push(borderDescriptor);
		}

		return descriptors;
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

	applySpanStyles(span, measurement, maskUrl) {
		span.style.display = 'block';
		span.style.position = 'absolute';
		span.style.left = '0';
		span.style.top = '0';
		span.style.width = `${measurement.width}px`;
		span.style.height = `${measurement.height}px`;
		span.style.maskSize = `${measurement.width}px ${measurement.height}px`;
		span.style.maskRepeat = 'no-repeat';
		span.style.maskPosition = '0 0';
		span.style.webkitMaskSize = `${measurement.width}px ${measurement.height}px`;
		span.style.webkitMaskRepeat = 'no-repeat';
		span.style.webkitMaskPosition = '0 0';
		if (maskUrl) {
			span.style.maskImage = `url(${maskUrl})`;
			span.style.webkitMaskImage = `url(${maskUrl})`;
			span.style.visibility = '';
		} else {
			span.style.visibility = 'hidden';
		}
	}

	applySpanOffset(span, offsetX = 0, offsetY = 0) {
		const x = offsetX || 0;
		const y = offsetY || 0;
		span.style.transform = (x || y) ? `translate(${x}px, ${y}px)` : 'none';
	}

	// Mirror of TextGlitterManager.applyPaintSource (glitter/solid + colorAdjust).
	applyPaintSource(span, source, layer = null, maskCanvas = null, localOffsetX = 0, localOffsetY = 0) {
		if (!source) {
			span.style.backgroundImage = 'none';
			span.style.backgroundColor = 'transparent';
			span.style.backgroundSize = '';
			span.style.backgroundPosition = '';
			span.style.opacity = '1';
			span.style.filter = '';
			span.classList.remove('pixelated');
			return;
		}

		if (source.mode === 'solid' || source.mode === 'gradient') {
			span.style.backgroundImage = source.mode === 'gradient' ? effectGradientToCss(source.gradient) : 'none';
			span.style.backgroundColor = source.mode === 'solid' ? source.color : 'transparent';
			span.style.backgroundSize = '';
			span.style.backgroundPosition = '';
			span.style.opacity = String(source.opacity ?? 1);
			span.style.filter = '';
			span.classList.remove('pixelated');
			return;
		}

		const glitter = this.editor.glitterManager.getItemById(source.glitterId);
		if (!glitter) {
			this.applyPaintSource(span, { mode: 'solid', color: '#000000', opacity: 1 });
			return;
		}

		span.style.backgroundImage = `url(${glitter.url})`;
		span.style.backgroundColor = 'transparent';
		span.style.opacity = String(source.opacity ?? 1);
		span.style.filter = buildCssColorFilter(source.colorAdjust);
		const glitterScale = (source.scale ?? 100) / 100;
		const baseSize = glitter.frames?.width || glitter.width || 50;
		span.style.backgroundSize = `${Math.round(baseSize * glitterScale)}px`;
		const textureOrigin = getSlotTexturePatternOrigin(maskCanvas, source, layer, {
			localOffsetX,
			localOffsetY
		});
		span.style.backgroundPosition = `${textureOrigin.x}px ${textureOrigin.y}px`;
		span.classList.toggle('pixelated', Boolean(glitter.isPixelated));
	}

	syncStackGeometry(stack, layer, measurement = null) {
		if (!stack || !layer?.shapeData) return;
		const entry = measurement || this.getMeasurementEntry(layer);
		const scaleX = (layer.shapeData.transform.scale.x || 100) / 100;
		const scaleY = (layer.shapeData.transform.scale.y || 100) / 100;
		stack.style.position = 'relative';
		stack.style.width = `${entry.width}px`;
		stack.style.height = `${entry.height}px`;
		stack.style.transform = `scale(${scaleX}, ${scaleY})`;
		stack.style.setProperty('--layer-scale', String(Math.max(scaleX, scaleY) || 1));

		const frame = this.getShapeHandleFrame(layer, entry);
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
		const spans = new Map(Array.from(stack.children).map((span) => [span.dataset.spanKey, span]));
		this.getSpanDescriptors(layer, measurement).forEach((descriptor) => {
			if (descriptor.source?.mode !== 'glitter' || descriptor.source.textureAnchor !== 'canvas') return;
			const span = spans.get(descriptor.key);
			if (!span) return;
			const origin = getSlotTexturePatternOrigin(descriptor.maskCanvas, descriptor.source, layer, {
				localOffsetX: descriptor.offsetX,
				localOffsetY: descriptor.offsetY
			});
			span.style.backgroundPosition = `${origin.x}px ${origin.y}px`;
		});
	}

	// ===== TRANSFORM COMMIT (re-rasterize on scale) =====

	// Bake a committed CSS scale into the shape's intrinsic pixel size and reset
	// scale to 100, then re-measure — so a scaled-up shape has crisp 1:1 edges
	// instead of an upscaled raster (the "mixels" fix). Called by LayerTransform
	// on scale-handle release.
	commitScale(layer) {
		if (!layer || layer.type !== LayerType.SHAPE) return;
		this.normalizeLayer(layer);
		const t = layer.shapeData.transform;
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
		this.normalizeLayer(layer);
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

	// Hit-test frame in canvas space (for the transform system / selection).
	getShapeFrame(layer) {
		this.normalizeLayer(layer);
		const measurement = this.getMeasurementEntry(layer);
		return measurement.frameRect;
	}
}
