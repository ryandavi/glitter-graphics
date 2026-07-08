// ============================================
// SHAPE GLITTER MANAGER
// ============================================
// Parametric vector-shape layers (WP5b, docs/TOOL-EXPANSION-PLAN.md): circle,
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
		this.activeShapeId = CONFIG.shapes.defaultShapeId;
		// Gallery picker session (reuses the shared strip + Done UX from text):
		// { layerId, slot } while the user is choosing a glitter for a slot.
		this.pickerSession = null;
		this.setupUI();
		this.setupEventListeners();
	}

	getActiveShapeId() {
		return this.activeShapeId || CONFIG.shapes.defaultShapeId;
	}

	setupUI() {
		const id = (x) => document.getElementById(x);
		this.ui.section = id('shapeSettingsSection');
		this.ui.picker = id('shapeShapePicker');
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
		this.ui.shadowEnabled = id('shapeShadowEnabled');
		this.ui.shadowControls = id('shapeShadowControls');
		this.ui.shadowOffsetX = id('shapeShadowOffsetX');
		this.ui.shadowOffsetXValue = id('shapeShadowOffsetXValue');
		this.ui.shadowOffsetY = id('shapeShadowOffsetY');
		this.ui.shadowOffsetYValue = id('shapeShadowOffsetYValue');
		this.ui.shadowOpacity = id('shapeShadowOpacity');
		this.ui.shadowOpacityValue = id('shapeShadowOpacityValue');

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
			this.ui[prefix + 'Advanced'] = info?.closest('.text-effect-subsection')?.querySelector('.advanced-disclosure') || null;
		});

		this.renderShapePicker();
	}

	renderShapePicker() {
		const picker = this.ui.picker;
		if (!picker) return;
		picker.innerHTML = '';
		ShapeLibrary.FILL_SHAPES.forEach(({ id, label }) => {
			const card = document.createElement('button');
			card.type = 'button';
			card.className = 'brush-shape-option';
			card.dataset.shape = id;
			card.title = label;
			card.setAttribute('role', 'option');
			card.setAttribute('aria-label', label);
			// Same geometry source as the mask, so the thumbnail matches the shape.
			card.innerHTML =
				'<span class="brush-shape-option-icon" aria-hidden="true">' +
				`${ShapeLibrary.getIconSvg(id)}</span>` +
				`<span class="brush-shape-option-name">${label}</span>`;
			picker.appendChild(card);
		});
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
	}

	setupEventListeners() {
		// Shape picker: sets the active shape for new shapes, and reshapes the
		// selected layer if one is active.
		this.ui.picker?.addEventListener('click', (event) => {
			const card = event.target.closest('.brush-shape-option');
			if (!card) return;
			this.activeShapeId = card.dataset.shape;
			const layer = this.getActiveShapeLayer();
			if (layer) {
				const newId = card.dataset.shape;
				layer.shapeData.shapeId = newId;
				layer.name = this.getShapeLabel(newId);
				// Re-fit the box to the new shape's natural aspect (preserving the
				// larger dimension) so the transform box updates and it isn't
				// left stretched into the old shape's proportions.
				const size = Math.max(layer.shapeData.width, layer.shapeData.height);
				const sized = this.sizeForShape(newId, size);
				layer.shapeData.width = sized.width;
				layer.shapeData.height = sized.height;
				this.invalidateMeasurement(layer);
				this.renderLayer(layer);
				this.editor.saveState();
				this.editor.layerManager.renderLayersList();
			}
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
			if (this.getActiveShapeLayer() && this.pickerSession) this.handlePickerDone();
		});
		document.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || !this.pickerSession || !this.getActiveShapeLayer()) return;
			const a = document.activeElement;
			if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
			if (this.editor.modalManager?.isAnyOpen?.()) return;
			event.preventDefault();
			this.handlePickerDone();
		});

		// Effect enable toggles.
		this.ui.borderEnabled?.addEventListener('change', () => this._toggleEffect('border', this.ui.borderEnabled.checked));
		this.ui.shadowEnabled?.addEventListener('change', () => this._toggleEffect('shadow', this.ui.shadowEnabled.checked));

		// Geometry sliders (change the mask → invalidate).
		this._attachSlider(this.ui.borderWidth, this.ui.borderWidthValue, 'px', (v, l) => { this.ensureEffectData(l, 'border').widthPx = v; }, this.getDefaultBorder().widthPx, true);
		this._attachSlider(this.ui.borderDotSpacing, this.ui.borderDotSpacingValue, 'px', (v, l) => { this.ensureEffectData(l, 'border').dotSpacingPx = v; }, this.getDefaultBorder().dotSpacingPx, true);
		this._attachSlider(this.ui.shadowOffsetX, this.ui.shadowOffsetXValue, 'px', (v, l) => { this.ensureEffectData(l, 'shadow').offsetX = v; }, this.getDefaultShadow().offsetX, true);
		this._attachSlider(this.ui.shadowOffsetY, this.ui.shadowOffsetYValue, 'px', (v, l) => { this.ensureEffectData(l, 'shadow').offsetY = v; }, this.getDefaultShadow().offsetY, true);

		// Non-geometry sliders (opacity, hsb) — re-render only.
		this._attachSlider(this.ui.borderOpacity, this.ui.borderOpacityValue, '%', (v, l) => { this.ensureEffectData(l, 'border').opacity = v; }, 100, false);
		this._attachSlider(this.ui.shadowOpacity, this.ui.shadowOpacityValue, '%', (v, l) => { this.ensureEffectData(l, 'shadow').opacity = v; }, 100, false);
		// Position / Transform / Scale / Flip are wired by the shared
		// app.setupTransformListeners('shape', …) — same code as sticker + text.

		// Per-slot Advanced: Scale + HSB (color adjust). Scale is a texture scale
		// (non-geometry). All reuse the color-adjust module.
		this._bindSlotAdvanced('shapeFill', 'fill');
		this._bindSlotAdvanced('shapeBorder', 'border');
		this._bindSlotAdvanced('shapeShadow', 'shadow');

		this.ui.borderStyleSolid?.addEventListener('click', () => this.setBorderStyle('solid'));
		this.ui.borderStyleDotted?.addEventListener('click', () => this.setBorderStyle('dotted'));
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
					if (slot === 'fill') layer.selectedGlitterId = CONFIG.defaultFillGlitterId;
					else if (slot === 'border') data.glitterId = CONFIG.defaultBorderGlitterId;
					else if (slot === 'shadow') data.glitterId = CONFIG.defaultShadowGlitterId;
				}
				this._refreshSourceUI(layer, slot);
				this.invalidateMeasurement(layer);
				this.renderLayer(layer);
				this.editor.saveState();
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
		input?.addEventListener('change', () => this.editor.saveState());
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
		if (!target.colorAdjust) target.colorAdjust = { ...COLOR_ADJUST_IDENTITY };
		return target.colorAdjust;
	}

	_attachSlider(slider, valueEl, suffix, apply, resetValue, geometry) {
		if (!slider) return;
		slider.addEventListener('input', () => {
			const layer = this.getActiveShapeLayer();
			if (!layer) return;
			const v = parseInt(slider.value, 10);
			if (valueEl) valueEl.innerHTML = formatUnit(v, suffix);
			apply(v, layer);
			if (geometry) this.invalidateMeasurement(layer);
			this.renderLayer(layer);
		});
		slider.addEventListener('change', () => {
			this.editor.saveState();
			this.editor.layerManager.renderLayersList();
		});
		const resetBtn = document.getElementById('reset' + this._cap(slider.id));
		if (resetBtn && resetValue !== undefined) {
			resetBtn.addEventListener('click', () => {
				slider.value = String(resetValue);
				slider.dispatchEvent(new Event('input'));
				slider.dispatchEvent(new Event('change'));
			});
		}
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
		const layer = this.editor.layerManager.layers.find((l) => l.id === layerId);
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
		if (enabled) {
			this.ensureEffectData(layer, slot);
		} else {
			layer.shapeData[slot] = null;
		}
		this.loadLayerSettings(layer);
		this.invalidateMeasurement(layer);
		this.renderLayer(layer);
		this.editor.saveState();
		this.editor.layerManager.renderLayersList();
	}

	revealGlitterBrowser() {
		if (this.editor.mobileManager?.isMobile) {
			if (this.editor.mobileManager.activeDrawer !== 'design') {
				this.editor.mobileManager.toggleDrawer('design');
			}
			return;
		}
		this.editor.setCollapsibleSectionOpen?.('designGallery', true, true);
		document.getElementById('glitterOptions')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	// ===== GALLERY PICKER SESSION (reuses the text strip + Done UX) =====

	// Arm a slot for glitter picking: open the gallery, show the strip naming the
	// destination + a Done button. Gallery clicks then route to this slot (see
	// GlitterManager.selectGlitter's shape branch).
	armPicker(slot) {
		const layer = this.getActiveShapeLayer();
		if (!layer) return;
		this.pickerSession = { layerId: layer.id, slot };
		this.revealGlitterBrowser();
		this.updatePickerStrip();
	}

	closePickerSession() {
		this.pickerSession = null;
		this.updatePickerStrip();
	}

	// Which shape slot the next gallery pick targets ('fill' when not armed).
	getGlitterSelectionTarget() {
		const layer = this.getActiveShapeLayer();
		const s = this.pickerSession;
		if (layer && s && s.layerId === layer.id) return s.slot;
		return 'fill';
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
		const s = this.pickerSession;
		const slotExists = s && (s.slot === 'fill' || Boolean(this.getEffectData(layer, s.slot)));
		const armed = Boolean(layer && s && s.layerId === layer.id && slotExists);

		// Only drive the strip while a shape is active; otherwise leave it to the
		// text manager (both are called from app.updateSidePanelUI).
		if (!layer) return;

		if (!armed) {
			strip.hidden = true;
			strip.classList.remove('is-armed', 'is-hint');
			this.ui.gallerySection?.classList.remove('picker-mode');
			return;
		}

		strip.hidden = false;
		strip.classList.add('is-armed');
		strip.classList.remove('is-hint');
		this.ui.gallerySection?.classList.add('picker-mode');
		if (this.ui.pickerStripDone) this.ui.pickerStripDone.hidden = false;
		const slotLabel = s.slot === 'border' ? 'Shape Border' : s.slot === 'shadow' ? 'Shape Shadow' : 'Shape Fill';
		if (this.ui.pickerStripTitle) this.ui.pickerStripTitle.textContent = `Choosing glitter for: ${slotLabel}`;
		if (this.ui.pickerStripDetail) this.ui.pickerStripDetail.textContent = `of "${layer.name || 'this shape'}"`;
	}

	// Done/Esc from the shared strip when a shape is active.
	handlePickerDone() {
		const slot = this.pickerSession?.slot || 'fill';
		this.closePickerSession();
		this.returnToShapeProperties(slot);
	}

	returnToShapeProperties(slot = 'fill') {
		if (this.editor.mobileManager?.isMobile) {
			if (this.editor.mobileManager.activeDrawer === 'design') {
				this.editor.mobileManager.closeAllDrawers();
			}
			return;
		}
		this.editor.setCollapsibleSectionOpen?.('shapeSettings', true, true);
		const chipId = slot === 'border' ? 'shapeBorderGlitterChip' : slot === 'shadow' ? 'shapeShadowGlitterChip' : 'shapeFillGlitterChip';
		requestAnimationFrame(() => document.getElementById(chipId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
	}

	_refreshSourceUI(layer, slot) {
		const prefix = slot === 'fill' ? 'shapeFill' : slot === 'border' ? 'shapeBorder' : 'shapeShadow';
		const data = this.getEffectData(layer, slot);
		const mode = data?.mode || 'solid';

		['None', 'Glitter', 'Solid'].forEach((m) => {
			const btn = this.ui[prefix + m];
			if (btn) btn.classList.toggle('active', m.toLowerCase() === mode);
		});

		const glitterInfo = this.ui[prefix + 'GlitterInfo'];
		const colorRow = this.ui[prefix + 'ColorRow'];
		const advanced = this.ui[prefix + 'Advanced'];
		if (glitterInfo) glitterInfo.hidden = mode !== 'glitter';
		if (colorRow) colorRow.hidden = mode !== 'solid';
		if (advanced) advanced.hidden = mode !== 'glitter';

		if (mode === 'glitter') {
			// Glitter mode is never empty — fall back to the default glitter.
			if (!this.getSlotGlitterId(layer, slot)) {
				if (slot === 'fill') layer.selectedGlitterId = CONFIG.defaultFillGlitterId;
				else if (slot === 'border') data.glitterId = CONFIG.defaultBorderGlitterId;
				else if (slot === 'shadow') data.glitterId = CONFIG.defaultShadowGlitterId;
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

		this._syncPickerActive();

		// Position/Transform/Scale/Flip use the shared transform panel.
		this.editor.loadTransformSettings?.(layer, 'shape');

		// Border
		const border = d.border;
		if (this.ui.borderEnabled) this.ui.borderEnabled.checked = Boolean(border);
		// .text-effect-controls is display:none until it has the .visible class
		// (NOT the hidden attribute) — reuse the same mechanism as text.
		if (this.ui.borderControls) this.ui.borderControls.classList.toggle('visible', Boolean(border));
		const bd = border || this.getDefaultBorder();
		if (this.ui.borderWidth) { this.ui.borderWidth.value = bd.widthPx; this.ui.borderWidthValue.innerHTML = formatUnit(bd.widthPx, 'px'); }
		if (this.ui.borderDotSpacing) { this.ui.borderDotSpacing.value = bd.dotSpacingPx ?? this.getDefaultBorder().dotSpacingPx; this.ui.borderDotSpacingValue.innerHTML = formatUnit(bd.dotSpacingPx ?? this.getDefaultBorder().dotSpacingPx, 'px'); }
		if (this.ui.borderOpacity) { this.ui.borderOpacity.value = bd.opacity ?? 100; this.ui.borderOpacityValue.innerHTML = formatUnit(bd.opacity ?? 100, '%'); }
		if (this.ui.shapeBorderColor) this.ui.shapeBorderColor.value = bd.color || '#000000';
		this._syncBorderStyleUI(bd);
		this._loadColorAdjust('shapeBorder', bd.colorAdjust, bd.scale);

		// Shadow
		const shadow = d.shadow;
		if (this.ui.shadowEnabled) this.ui.shadowEnabled.checked = Boolean(shadow);
		if (this.ui.shadowControls) this.ui.shadowControls.classList.toggle('visible', Boolean(shadow));
		const sd = shadow || this.getDefaultShadow();
		if (this.ui.shadowOffsetX) { this.ui.shadowOffsetX.value = sd.offsetX; this.ui.shadowOffsetXValue.innerHTML = formatUnit(sd.offsetX, 'px'); }
		if (this.ui.shadowOffsetY) { this.ui.shadowOffsetY.value = sd.offsetY; this.ui.shadowOffsetYValue.innerHTML = formatUnit(sd.offsetY, 'px'); }
		if (this.ui.shadowOpacity) { this.ui.shadowOpacity.value = sd.opacity ?? 100; this.ui.shadowOpacityValue.innerHTML = formatUnit(sd.opacity ?? 100, '%'); }
		if (this.ui.shapeShadowColor) this.ui.shapeShadowColor.value = sd.color || '#000000';
		this._loadColorAdjust('shapeShadow', sd.colorAdjust, sd.scale);

		// Fill
		if (this.ui.shapeFillColor) this.ui.shapeFillColor.value = d.fill.color || '#ff66cc';
		this._loadColorAdjust('shapeFill', d.fill.colorAdjust, d.fill.scale);

		this._refreshSourceUI(layer, 'fill');
		this._refreshSourceUI(layer, 'border');
		this._refreshSourceUI(layer, 'shadow');
	}

	// ===== DEFAULTS / DATA MODEL =====

	getDefaultFill() {
		return {
			mode: 'glitter',
			color: CONFIG.defaultFillColor,
			scale: 100,
			opacity: 100,
			colorAdjust: null
		};
	}

	getDefaultBorder() {
		return {
			widthPx: 6,
			style: 'solid',
			dotSpacingPx: 10,
			mode: 'solid',
			color: CONFIG.defaultBorderColor,
			glitterId: null,
			scale: 100,
			opacity: 100,
			colorAdjust: null
		};
	}

	getDefaultShadow() {
		return {
			offsetX: 6,
			offsetY: 6,
			mode: 'solid',
			color: CONFIG.defaultShadowColor,
			glitterId: null,
			scale: 100,
			opacity: 100,
			colorAdjust: null
		};
	}

	normalizeLayer(layer) {
		if (!layer || layer.type !== LayerType.SHAPE) return;
		const data = layer.shapeData;
		if (!data.fill) data.fill = this.getDefaultFill();
		if (data.border === undefined) data.border = null;
		if (data.border) data.border = { ...this.getDefaultBorder(), ...data.border };
		if (data.shadow === undefined) data.shadow = null;
		if (!data.transform) {
			data.transform = {
				position: { x: 0, y: 0 },
				rotation: 0,
				scale: { x: 100, y: 100 },
				proportionalScale: true,
				opacity: 100,
				flipX: false,
				flipY: false
			};
		}
	}

	getShapeLabel(shapeId) {
		const entry = ShapeLibrary.FILL_SHAPES.find((s) => s.id === shapeId);
		return entry ? entry.label : 'Shape';
	}

	createLayer(options = {}) {
		if (this.editor.layerManager.layers.length >= CONFIG.maxLayers) {
			this.editor.showError(`Maximum ${CONFIG.maxLayers} layers reached`);
			return null;
		}

		const shapeId = options.shapeId || CONFIG.shapes.defaultShapeId;
		// A drag supplies an explicit box (stretch allowed); a click supplies no
		// size, so derive width/height from the shape's natural aspect so it isn't
		// distorted (a regular hexagon/triangle isn't square).
		let width;
		let height;
		if (options.width && options.height) {
			width = Math.max(CONFIG.shapes.minSize, Math.round(options.width));
			height = Math.max(CONFIG.shapes.minSize, Math.round(options.height));
		} else {
			const sized = this.sizeForShape(shapeId, CONFIG.shapes.defaultSize);
			width = sized.width;
			height = sized.height;
		}
		const position = options.position || {
			x: this.editor.originalCanvas.width / 2,
			y: this.editor.originalCanvas.height / 2
		};

		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.SHAPE,
			name: this.getShapeLabel(shapeId),
			visible: true,
			locked: false,
			selectedGlitterId: CONFIG.defaultFillGlitterId,
			settings: { scale: CONFIG.defaultScale, opacity: CONFIG.defaultOpacity },
			shapeData: {
				shapeId,
				width,
				height,
				transform: {
					position: { x: position.x, y: position.y },
					rotation: 0,
					scale: { x: 100, y: 100 },
					proportionalScale: true,
					opacity: 100,
					flipX: false,
					flipY: false
				},
				fill: this.getDefaultFill(),
				border: null,
				shadow: null
			}
		};

		return layer;
	}

	// Width/height for a shape at a given nominal size, preserving its natural
	// aspect (larger dimension = size).
	sizeForShape(shapeId, size) {
		const aspect = ShapeLibrary.getAspect(shapeId);
		const min = CONFIG.shapes.minSize;
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
		if (slot === 'fill') return layer.shapeData.fill;
		return layer.shapeData[slot] || null;
	}

	ensureEffectData(layer, slot) {
		if (slot === 'fill') {
			if (!layer.shapeData.fill) layer.shapeData.fill = this.getDefaultFill();
			return layer.shapeData.fill;
		}
		if (!layer.shapeData[slot]) {
			layer.shapeData[slot] = slot === 'border' ? this.getDefaultBorder() : this.getDefaultShadow();
		} else if (slot === 'border') {
			layer.shapeData.border = { ...this.getDefaultBorder(), ...layer.shapeData.border };
		}
		return layer.shapeData[slot];
	}

	setBorderStyle(style) {
		const layer = this.getActiveShapeLayer();
		if (!layer) return;

		const border = this.ensureEffectData(layer, 'border');
		if (border.style === style) return;

		border.style = style === 'dotted' ? 'dotted' : 'solid';
		this._syncBorderStyleUI(border);
		this.invalidateMeasurement(layer);
		this.renderLayer(layer);
		this.editor.saveState();
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
			d.border ? [d.border.widthPx, d.border.style || 'solid', d.border.dotSpacingPx ?? this.getDefaultBorder().dotSpacingPx] : null,
			d.shadow ? [d.shadow.offsetX, d.shadow.offsetY] : null
		]);
	}

	// Rasterize the shape into a padded mask canvas (crisp-thresholded like text,
	// per CONFIG.textLayers.crispEdges — same GIF-fringe reasoning). Returns the
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
		const padding = CONFIG.textLayers.maskPadding;
		const borderWidth = Math.max(0, d.border?.widthPx || 0);
		const shX = d.shadow?.offsetX || 0;
		const shY = d.shadow?.offsetY || 0;

		const inkLeft = -(borderWidth + Math.max(0, -shX));
		const inkRight = w + borderWidth + Math.max(0, shX);
		const inkTop = -(borderWidth + Math.max(0, -shY));
		const inkBottom = h + borderWidth + Math.max(0, shY);

		const layoutX = padding - inkLeft;
		const layoutY = padding - inkTop;
		const canvasWidth = Math.max(1, Math.ceil(inkRight - inkLeft + padding * 2));
		const canvasHeight = Math.max(1, Math.ceil(inkBottom - inkTop + padding * 2));

		const canvas = document.createElement('canvas');
		canvas.width = canvasWidth;
		canvas.height = canvasHeight;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.clearRect(0, 0, canvasWidth, canvasHeight);
		ctx.fillStyle = '#ffffff';
		ctx.save();
		ctx.translate(layoutX + w / 2, layoutY + h / 2);
		// trace() fills the shape at the current origin (ShapeLibrary is the single
		// geometry source shared with the brush + the picker thumbnails).
		ShapeLibrary.trace(d.shapeId, ctx, w / 2, h / 2, { fit: 'fill' });
		ctx.restore();

		if (CONFIG.textLayers.crispEdges !== false) {
			const image = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
			const px = image.data;
			for (let i = 3; i < px.length; i += 4) {
				px[i] = px[i] >= 128 ? 255 : 0;
			}
			ctx.putImageData(image, 0, 0);
		}

		const entry = {
			key,
			canvas,
			width: canvasWidth,
			height: canvasHeight,
			frameRect: { x: layoutX, y: layoutY, width: w, height: h },
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
	// mask canvas (mirrors TextGlitterManager.getTextFrame). Border width is part
	// of the selectable shape silhouette, so the frame expands to include it;
	// shadow padding stays excluded so a shadow never drags the box around.
	// NOT named getShapeFrame(layer): that name is already a class method below
	// (hit-test frame, returns raw {x,y,width,height} in a different shape) and a
	// second same-named method here would silently shadow one of them.
	getShapeHandleFrame(layer, measurement = null) {
		this.normalizeLayer(layer);
		if (!layer?.shapeData) return null;

		const entry = measurement || this.getMeasurementEntry(layer);
		const rect = entry.frameRect;
		if (!rect) return null;

		const borderWidth = Math.max(0, layer.shapeData.border?.widthPx || 0);
		return {
			width: rect.width + borderWidth * 2,
			height: rect.height + borderWidth * 2,
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
		const dotSpacingPx = Math.max(1, borderData?.dotSpacingPx ?? this.getDefaultBorder().dotSpacingPx);
		const canvas = document.createElement('canvas');
		canvas.width = measurement.canvas.width;
		canvas.height = measurement.canvas.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });

		const path = ShapeLibrary.buildTransformedPath(measurement.shapeId, measurement.shapeW / 2, measurement.shapeH / 2, { fit: 'fill' });
		ctx.save();
		ctx.translate(measurement.layoutX + measurement.shapeW / 2, measurement.layoutY + measurement.shapeH / 2);
		ctx.strokeStyle = '#ffffff';
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		if (borderStyle === 'dotted') {
			ctx.lineWidth = widthPx;
			ctx.setLineDash([0, widthPx + dotSpacingPx]);
		} else {
			ctx.lineWidth = widthPx * 2;
		}
		ctx.stroke(path);
		ctx.restore();

		// Solid borders render as an outer ring; dotted borders stay centered on
		// the path so each round cap reads as a dot instead of a clipped crescent.
		if (borderStyle !== 'dotted') {
			ctx.globalCompositeOperation = 'destination-out';
			ctx.drawImage(measurement.canvas, 0, 0);
			ctx.globalCompositeOperation = 'source-over';
		}

		if (CONFIG.textLayers.crispEdges !== false) {
			const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const px = image.data;
			for (let i = 3; i < px.length; i += 4) px[i] = px[i] >= 128 ? 255 : 0;
			ctx.putImageData(image, 0, 0);
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
			transform.element = wrapper;
			transform.applyTransform(wrapper, { width: measurement.width, height: measurement.height });
			if (layer.id === this.editor.layerManager.activeLayerId && this.editor.currentTool === ToolType.SELECT) {
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
			this.applyPaintSource(span, descriptor.source);
			stack.appendChild(span);
			existing.delete(descriptor.key);
		});

		existing.forEach((span) => span.remove());
	}

	getSpanDescriptors(layer, measurement) {
		const descriptors = [];
		const shadow = this.getEffectData(layer, 'shadow');
		const border = this.getEffectData(layer, 'border');

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
		if (border?.widthPx > 0) {
			descriptors.push({
				key: 'border',
				offsetX: 0,
				offsetY: 0,
				source: this.getEffectPaintSource(layer, 'border'),
				maskCanvas: this.getBorderMaskCanvas(measurement, border),
				maskCacheKey: `${measurement.key}|border:${border.widthPx}:${border.style || 'solid'}:${border.dotSpacingPx ?? this.getDefaultBorder().dotSpacingPx}`
			});
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
	applyPaintSource(span, source) {
		if (!source) {
			span.style.backgroundImage = 'none';
			span.style.backgroundColor = 'transparent';
			span.style.backgroundSize = '';
			span.style.opacity = '1';
			span.style.filter = '';
			span.classList.remove('pixelated');
			return;
		}

		if (source.mode === 'solid') {
			span.style.backgroundImage = 'none';
			span.style.backgroundColor = source.color;
			span.style.backgroundSize = '';
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

	// Called by LayerTransform.applyTransform during handle drags.
	syncElementScale(layer, wrapper = this.layerElements.get(layer?.id)) {
		const stack = wrapper?.querySelector('.shape-glitter-stack');
		if (!stack) return;
		this.syncStackGeometry(stack, layer);
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

		layer.shapeData.width = Math.max(CONFIG.shapes.minSize, Math.round(layer.shapeData.width * sx));
		layer.shapeData.height = Math.max(CONFIG.shapes.minSize, Math.round(layer.shapeData.height * sy));
		if (layer.shapeData.border) {
			layer.shapeData.border.widthPx = Math.max(1, Math.round(layer.shapeData.border.widthPx * Math.max(sx, sy)));
		}
		t.scale.x = 100;
		t.scale.y = 100;
		this.invalidateMeasurement(layer);
		this.renderLayer(layer);
		// Border/fill/shadow sliders show pre-commit values otherwise (e.g. border
		// width baked larger by the scale) until the layer is reselected.
		this.loadLayerSettings(layer);
	}

	// ===== SETTINGS / UI =====

	centerHorizontal(layerId) {
		const transform = this.layerTransforms.get(layerId);
		if (!transform) return;
		transform.centerHorizontal();
		const layer = this.editor.layerManager.layers.find((entry) => entry.id === layerId);
		if (layer) this.loadLayerSettings(layer);
	}

	centerVertical(layerId) {
		const transform = this.layerTransforms.get(layerId);
		if (!transform) return;
		transform.centerVertical();
		const layer = this.editor.layerManager.layers.find((entry) => entry.id === layerId);
		if (layer) this.loadLayerSettings(layer);
	}

	// ===== HOUSEKEEPING =====

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
		this.layerTransforms.forEach((transform) => transform.removeTransformHandles());
	}

	createTransformHandles(layerId) {
		const transform = this.layerTransforms.get(layerId);
		if (transform) transform.createTransformHandles();
	}

	// Hit-test frame in canvas space (for the transform system / selection).
	getShapeFrame(layer) {
		this.normalizeLayer(layer);
		const measurement = this.getMeasurementEntry(layer);
		return measurement.frameRect;
	}
}
