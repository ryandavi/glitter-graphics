// ============================================
// TEXT GLITTER MANAGER CLASS
// Handles text glitter layer rendering, font loading, and text settings
// ============================================
class TextGlitterManager {
	constructor(editor) {
		this.editor = editor;

		this.layerElements = new Map();
		this.layerTransforms = new Map();

		this.fontManifest = [];
		this.fontsById = new Map();
		this.fontManifestPromise = null;
		this.fontLoadPromises = new Map();
		this.fontFaces = new Map();
		this.fontPickerPreloadPromise = null;

		this.textMaskCache = new Map();
		this.measureCanvas = document.createElement('canvas');
		this.measureCtx = this.measureCanvas.getContext('2d');

		this.textInputTimer = null;

		// Picker session (D-1c): the gallery's armed destination, nullable and
		// layer-bound. `null` = BROWSE MODE — a gallery click applies to the
		// active layer's own fill (the only implicit destination anyone expects).
		// `{ layerId, slot }` = PICKER MODE — entered only by an explicit arming
		// gesture (chip / Change / Use Glitter), cleared on layer switch, effect
		// disable, history restore, Done, or Esc. Because the session names its
		// layer, a mismatch with the active layer is structurally treated as
		// browse mode — the old sticky-target layer-switch trap is impossible.
		//
		// This is pure UI state. The exporter never reads it: per-slot paint
		// resolution (getEffectPaintSource ↔ GifExporter._getTextEffectSource)
		// depends only on layer.textData, so preview↔export parity is unaffected.
		this.pickerSession = null;
	}

	async init() {
		this.setupUI();
		this.setupEventListeners();
		this.setupPickerStripListeners();
	}

	setupUI() {
		this.ui = {
			section: document.getElementById('textSettingsSection'),
			textInput: document.getElementById('textLayerInput'),
			fontPicker: document.getElementById('textFontPicker'),
			fontBold: document.getElementById('textFontBold'),
			fontItalic: document.getElementById('textFontItalic'),
			textCaseButtons: Array.from(document.querySelectorAll('[id^="textCase"]')),
			fontSize: document.getElementById('textFontSize'),
			fontSizeValue: document.getElementById('textFontSizeValue'),
			letterSpacing: document.getElementById('textLetterSpacing'),
			letterSpacingValue: document.getElementById('textLetterSpacingValue'),
			lineHeight: document.getElementById('textLineHeight'),
			lineHeightValue: document.getElementById('textLineHeightValue'),
			fillGlitterChip: document.getElementById('textFillGlitterChip'),
			fillGlitterChange: document.getElementById('textFillGlitterChange'),
			fillGlitterLabel: document.getElementById('textFillGlitterLabel'),
			fillGlitterBadges: document.getElementById('textFillGlitterBadges'),
			fillGlitterInfo: document.getElementById('textFillGlitterInfo'),
			fillGlitterSize: document.getElementById('textFillGlitterSize'),
			fillGlitterFrames: document.getElementById('textFillGlitterFrames'),
			fillUseColor: document.getElementById('textFillUseColor'),
			fillUseGlitter: document.getElementById('textFillUseGlitter'),
			fillUseNone: document.getElementById('textFillUseNone'),
			fillColor: document.getElementById('textFillColor'),
			fillColorRow: document.getElementById('textFillColorRow'),
			textureScaleRow: document.getElementById('textTextureScaleRow'),
			textureScale: document.getElementById('textTextureScale'),
			textureScaleValue: document.getElementById('textTextureScaleValue'),
			textureOpacity: document.getElementById('textTextureOpacity'),
			textureOpacityValue: document.getElementById('textTextureOpacityValue'),
			alignButtons: Array.from(document.querySelectorAll('[data-text-align]')),
			verticalAlignButtons: Array.from(document.querySelectorAll('[data-text-valign]')),
			boxModeButtons: Array.from(document.querySelectorAll('[data-text-box-mode]')),
			boxModeHint: document.getElementById('textBoxModeHint'),
			fitBoxToContent: document.getElementById('textFitBoxToContent'),
			borderEnabled: document.getElementById('textBorderEnabled'),
			borderControls: document.getElementById('textBorderControls'),
			borderWidth: document.getElementById('textBorderWidth'),
			borderWidthValue: document.getElementById('textBorderWidthValue'),
			borderColor: document.getElementById('textBorderColor'),
			borderColorRow: document.getElementById('textBorderColorRow'),
			borderGlitterChip: document.getElementById('textBorderGlitterChip'),
			borderGlitterChange: document.getElementById('textBorderGlitterChange'),
			borderGlitterLabel: document.getElementById('textBorderGlitterLabel'),
			borderGlitterBadges: document.getElementById('textBorderGlitterBadges'),
			borderGlitterInfo: document.getElementById('textBorderGlitterInfo'),
			borderGlitterSize: document.getElementById('textBorderGlitterSize'),
			borderGlitterFrames: document.getElementById('textBorderGlitterFrames'),
			borderUseColor: document.getElementById('textBorderUseColor'),
			borderUseGlitter: document.getElementById('textBorderUseGlitter'),
			borderScaleRow: document.getElementById('textBorderScaleRow'),
			borderScale: document.getElementById('textBorderScale'),
			borderScaleValue: document.getElementById('textBorderScaleValue'),
			borderOpacity: document.getElementById('textBorderOpacity'),
			borderOpacityValue: document.getElementById('textBorderOpacityValue'),
			borderEdgeRounded: document.getElementById('textBorderEdgeRounded'),
			borderEdgeHard: document.getElementById('textBorderEdgeHard'),
			borderPositionOutside: document.getElementById('textBorderPositionOutside'),
			borderPositionCenter: document.getElementById('textBorderPositionCenter'),
			borderPositionInside: document.getElementById('textBorderPositionInside'),
			borderOrderBehind: document.getElementById('textBorderOrderBehind'),
			borderOrderFront: document.getElementById('textBorderOrderFront'),
			shadowEnabled: document.getElementById('textShadowEnabled'),
			shadowControls: document.getElementById('textShadowControls'),
			shadowOffsetX: document.getElementById('textShadowOffsetX'),
			shadowOffsetXValue: document.getElementById('textShadowOffsetXValue'),
			shadowOffsetY: document.getElementById('textShadowOffsetY'),
			shadowOffsetYValue: document.getElementById('textShadowOffsetYValue'),
			shadowColor: document.getElementById('textShadowColor'),
			shadowColorRow: document.getElementById('textShadowColorRow'),
			shadowGlitterChip: document.getElementById('textShadowGlitterChip'),
			shadowGlitterChange: document.getElementById('textShadowGlitterChange'),
			shadowGlitterLabel: document.getElementById('textShadowGlitterLabel'),
			shadowGlitterBadges: document.getElementById('textShadowGlitterBadges'),
			shadowGlitterInfo: document.getElementById('textShadowGlitterInfo'),
			shadowGlitterSize: document.getElementById('textShadowGlitterSize'),
			shadowGlitterFrames: document.getElementById('textShadowGlitterFrames'),
			shadowUseColor: document.getElementById('textShadowUseColor'),
			shadowUseGlitter: document.getElementById('textShadowUseGlitter'),
			shadowScaleRow: document.getElementById('textShadowScaleRow'),
			shadowScale: document.getElementById('textShadowScale'),
			shadowScaleValue: document.getElementById('textShadowScaleValue'),
			shadowOpacity: document.getElementById('textShadowOpacity'),
			shadowOpacityValue: document.getElementById('textShadowOpacityValue'),
			// D-1c gallery picker strip
			gallerySection: document.getElementById('designGallerySection'),
			pickerStrip: document.getElementById('galleryPickerStrip'),
			pickerStripTitle: document.getElementById('galleryPickerStripTitle'),
			pickerStripDetail: document.getElementById('galleryPickerStripDetail'),
			pickerStripDone: document.getElementById('galleryPickerStripDone')
		};

		// Color adjust (WP4) HSB sliders, one set per slot. Registered as a compact
		// 3×3 loop instead of nine literal entries above. IDs follow
		// text{Fill,Border,Shadow}{Hue,Saturation,Brightness}[Value].
		['fill', 'border', 'shadow'].forEach((slot) => {
			const slotCap = slot.charAt(0).toUpperCase() + slot.slice(1);
			['Hue', 'Saturation', 'Brightness'].forEach((axis) => {
				this.ui[`${slot}${axis}`] = document.getElementById(`text${slotCap}${axis}`);
				this.ui[`${slot}${axis}Value`] = document.getElementById(`text${slotCap}${axis}Value`);
			});
		});

		const borderConfig = CONFIG.tools.text.border;
		if (this.ui.borderWidth) {
			this.ui.borderWidth.min = String(borderConfig.minWidthPx);
			this.ui.borderWidth.max = String(borderConfig.maxWidthPx);
		}
		['textFill', 'textBorder', 'textShadow'].forEach((prefix) => {
			const effectName = prefix === 'textFill' ? 'fill' : prefix === 'textBorder' ? 'border' : 'shadow';
			installEffectGradientEditor({
				prefix,
				getData: () => {
					const layer = this.getActiveTextLayer();
					return layer ? this.ensureEffectData(layer, effectName) : null;
				},
				onUpdate: (commit) => {
					const layer = this.getActiveTextLayer();
					if (!layer) return;
					this.renderLayer(layer);
					if (commit) this.editor.saveState();
				}
			});
		});
	}

	// colorAdjust lives on the effect data (border/shadow) or on layer.settings
	// (fill, which aliases the layer like its scale/opacity). See effects/slot-effects.js.
	ensureColorAdjust(target) {
		return ensureSlotColorAdjust(target);
	}

	setupEventListeners() {
		if (this.ui.textInput) {
			this.ui.textInput.addEventListener('input', () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;

				const value = this.ui.textInput.value.slice(0, CONFIG.tools.text.maxTextLength);
				if (value !== this.ui.textInput.value) {
					this.ui.textInput.value = value;
				}

				this.preparePendingAnchorPreservation(layer);
				layer.textData.text = value;
				layer.name = this.getLayerName(value);
				this.updateLiveTextContent(layer.id, value);
				this.editor.layerManager.renderLayersList();
				this.editor.updateActionButtons();
				this.editor.updateHelpfulMessage();
				this.scheduleTextCommit(layer);
			});
		}

		if (this.ui.fontPicker) {
			this.ui.fontPicker.addEventListener('click', async (event) => {
				const button = event.target.closest('[data-font-id]');
				if (!button) return;

				const layer = this.getActiveTextLayer();
				if (!layer) return;

				const fontId = button.dataset.fontId;
				if (!fontId || fontId === layer.textData.fontId) return;

				try {
					await this.runLayoutRefreshWithAnchor(layer, async () => {
						layer.textData.fontId = fontId;
						await this.ensureFontLoaded(fontId);
					}, { saveHistory: true });
				} catch (error) {
					this.reportFontLoadError(error);
				}
			});
		}

		const bindFontStyleToggle = (button, property, activeValue, inactiveValue) => {
			button?.addEventListener('click', async () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;
				await this.runLayoutRefreshWithAnchor(layer, () => {
					layer.textData[property] = layer.textData[property] === activeValue ? inactiveValue : activeValue;
				}, { saveHistory: true });
			});
		};
		bindFontStyleToggle(this.ui.fontBold, 'fontWeight', 700, 400);
		bindFontStyleToggle(this.ui.fontItalic, 'fontStyle', 'italic', 'normal');
		this.ui.textCaseButtons.forEach((button) => {
			button.addEventListener('click', async () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;
				const mode = button.id.replace('textCase', '').toLowerCase();
				await this.runLayoutRefreshWithAnchor(layer, () => { layer.textData.textCase = mode; }, { saveHistory: true });
			});
		});

		this.attachSlider(this.ui.fontSize, this.ui.fontSizeValue, 'px', (value, layer) => {
			layer.textData.fontSize = value;
		}, CONFIG.tools.text.defaultFontSize);

		this.attachSlider(this.ui.letterSpacing, this.ui.letterSpacingValue, 'px', (value, layer) => {
			layer.textData.letterSpacing = value;
		}, CONFIG.tools.text.defaultLetterSpacing);

		this.attachSlider(this.ui.lineHeight, this.ui.lineHeightValue, '%', (value, layer) => {
			layer.textData.lineHeight = value / 100;
		}, Math.round(CONFIG.tools.text.lineHeight * 100));

		if (this.ui.fillGlitterChip || this.ui.fillGlitterChange) {
			[this.ui.fillGlitterChip, this.ui.fillGlitterChange].filter(Boolean).forEach((button) => {
				button.addEventListener('click', () => {
					const layer = this.getActiveTextLayer();
					if (!layer) return;

					this.setGlitterSelectionTarget('fill', layer);

					const selectedGlitterId = this.resolveSelectedGlitterId(layer);
					if (selectedGlitterId) {
						this.editor.glitterManager?.scrollToContent(selectedGlitterId);
					}

					revealAssetBrowser(this.editor, this.editor.glitterManager);
					this.editor.updateStatus('Choose fill glitter, then press Esc or Done.');
				});
			});
		}

		this.attachSlider(this.ui.textureScale, this.ui.textureScaleValue, '%', (value, layer) => {
			layer.settings.scale = value;
		}, CONFIG.tools.effects.defaults.scale, false);

		this.attachSlider(this.ui.textureOpacity, this.ui.textureOpacityValue, '%', (value, layer) => {
			layer.settings.opacity = value;
		}, CONFIG.tools.effects.defaults.opacity, false);

		this.ui.alignButtons.forEach((button) => {
			button.addEventListener('click', async () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;

				const align = button.dataset.textAlign;
				if (!align || align === layer.textData.align) return;

				try {
					await this.runLayoutRefreshWithAnchor(layer, () => {
						layer.textData.align = align;
					}, { saveHistory: true });
				} catch (error) {
					this.reportFontLoadError(error);
				}
			});
		});

		this.ui.verticalAlignButtons.forEach((button) => {
			button.addEventListener('click', async () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;

				const verticalAlign = button.dataset.textValign;
				if (!verticalAlign || verticalAlign === layer.textData.verticalAlign) return;

				try {
					await this.runLayoutRefreshWithAnchor(layer, () => {
						layer.textData.verticalAlign = verticalAlign;
					}, { saveHistory: true });
				} catch (error) {
					this.reportFontLoadError(error);
				}
			});
		});

		this.ui.boxModeButtons.forEach((button) => {
			button.addEventListener('click', async () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;

				const nextMode = button.dataset.textBoxMode;
				const currentMode = layer.textData.boxMode || 'auto';
				if (!nextMode || nextMode === currentMode) return;

				try {
					await this.runLayoutRefreshWithAnchor(layer, () => {
						if (nextMode === 'fixed') {
							this.ensureFixedBox(layer);
						} else {
							layer.textData.boxMode = 'auto';
							delete layer.textData.boxWidth;
							delete layer.textData.boxHeight;
						}
					}, { saveHistory: true });
				} catch (error) {
					this.reportFontLoadError(error);
				}
			});
		});

		this.ui.fitBoxToContent?.addEventListener('click', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;

			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					this.fitBoxToText(layer);
				}, { saveHistory: true });
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});

		this.bindEffectToggle(this.ui.borderEnabled, 'border');
		this.bindEffectToggle(this.ui.shadowEnabled, 'shadow');

		this.attachSlider(this.ui.borderWidth, this.ui.borderWidthValue, 'px', (value, layer) => {
			this.ensureEffectData(layer, 'border').widthPx = value;
		}, this.getDefaultBorder().widthPx);

		this.attachSlider(this.ui.shadowOffsetX, this.ui.shadowOffsetXValue, 'px', (value, layer) => {
			this.ensureEffectData(layer, 'shadow').offsetX = value;
		}, this.getDefaultShadow().offsetX);

		this.attachSlider(this.ui.shadowOffsetY, this.ui.shadowOffsetYValue, 'px', (value, layer) => {
			this.ensureEffectData(layer, 'shadow').offsetY = value;
		}, this.getDefaultShadow().offsetY);

		this.bindEffectGlitterPicker([this.ui.borderGlitterChip, this.ui.borderGlitterChange], 'border');
		this.bindEffectGlitterPicker([this.ui.shadowGlitterChip, this.ui.shadowGlitterChange], 'shadow');
		this.bindEffectUseColor(this.ui.borderUseColor, 'border');
		this.bindEffectUseColor(this.ui.shadowUseColor, 'shadow');
		this.bindEffectUseGlitter(this.ui.borderUseGlitter, 'border');
		this.bindEffectUseGlitter(this.ui.shadowUseGlitter, 'shadow');
		this.bindEffectColorInput(this.ui.borderColor, 'border');
		this.bindEffectColorInput(this.ui.shadowColor, 'shadow');

		this.bindFillUseColor();
		this.bindFillUseGlitter();
		this.bindFillUseNone();
		this.bindFillColorInput();

		this.attachSlider(this.ui.borderScale, this.ui.borderScaleValue, '%', (value, layer) => {
			this.ensureEffectData(layer, 'border').scale = value;
		}, this.getDefaultBorder().scale, false);

		this.attachSlider(this.ui.borderOpacity, this.ui.borderOpacityValue, '%', (value, layer) => {
			this.ensureEffectData(layer, 'border').opacity = value;
		}, this.getDefaultBorder().opacity, false);

		this.bindBorderPlacement(this.ui.borderPositionOutside, 'outside');
		this.bindBorderPlacement(this.ui.borderPositionCenter, 'center');
		this.bindBorderPlacement(this.ui.borderPositionInside, 'inside');
		this.bindBorderEdgeStyle(this.ui.borderEdgeRounded, 'round');
		this.bindBorderEdgeStyle(this.ui.borderEdgeHard, 'hard');
		this.bindBorderOrder(this.ui.borderOrderBehind, 'behind');
		this.bindBorderOrder(this.ui.borderOrderFront, 'front');

		this.attachSlider(this.ui.shadowScale, this.ui.shadowScaleValue, '%', (value, layer) => {
			this.ensureEffectData(layer, 'shadow').scale = value;
		}, this.getDefaultShadow().scale, false);

		this.attachSlider(this.ui.shadowOpacity, this.ui.shadowOpacityValue, '%', (value, layer) => {
			this.ensureEffectData(layer, 'shadow').opacity = value;
		}, this.getDefaultShadow().opacity, false);

		this._bindEffectColorAdjust('fill');
		this._bindEffectColorAdjust('border');
		this._bindEffectColorAdjust('shadow');
	}

	// Wire a slot's three HSB sliders (WP4). Fill writes to layer.settings
	// (aliased); border/shadow write to their own effect data. attachSlider
	// handles the live preview refresh and one history entry on release.
	_bindEffectColorAdjust(slot) {
		const axes = [
			['Hue', 'hue', '°'],
			['Saturation', 'saturation', '%'],
			['Brightness', 'brightness', '%']
		];
		axes.forEach(([suffixName, key, unit]) => {
			const slider = this.ui[`${slot}${suffixName}`];
			const display = this.ui[`${slot}${suffixName}Value`];
			if (!slider) return;
			const fallback = COLOR_ADJUST_IDENTITY[key];
			this.attachSlider(slider, display, unit, (value, layer) => {
				const target = slot === 'fill' ? layer.settings : this.ensureEffectData(layer, slot);
				this.ensureColorAdjust(target)[key] = value;
				this.refreshSlotSwatch(layer, slot);
			}, fallback, false);
		});
	}

	// Live-tint this slot's glitter chip (and, for fill, the layers-list swatch) to
	// match a colorAdjust drag without a full panel reload. Render paths bake the
	// same filter in on load via renderGlitterAssetDisplay.
	refreshSlotSwatch(layer, slot) {
		const chip = this.ui[`${slot}GlitterChip`];
		if (chip) {
			const adjust = slot === 'fill'
				? layer.settings?.colorAdjust
				: this.getEffectData(layer, slot)?.colorAdjust;
			chip.style.filter = buildCssColorFilter(adjust);
		}
		if (slot === 'fill') this.editor.refreshLayerSwatchFilter(layer);
	}

	// Push a slot's stored colorAdjust out to its three HSB sliders.
	_loadEffectColorAdjust(slot, adjust) {
		const a = normalizeColorAdjust(adjust);
		const set = (suffixName, value, unit) => {
			const slider = this.ui[`${slot}${suffixName}`];
			const display = this.ui[`${slot}${suffixName}Value`];
			if (slider) slider.value = String(value);
			if (display) display.innerHTML = formatUnit(value, unit);
		};
		set('Hue', a.hue, '°');
		set('Saturation', a.saturation, '%');
		set('Brightness', a.brightness, '%');
	}

	getPointAnchorSnapshot(layer) {
		this.normalizeLayer(layer);
		if (!layer?.textData || (layer.textData.boxMode || 'auto') !== 'auto') {
			return null;
		}

		const frame = this.getTextFrame(layer);
		if (!frame) return null;

		return {
			world: this.getPointAnchorWorldPosition(layer, frame)
		};
	}

	preparePendingAnchorPreservation(layer) {
		if (!layer || layer._pendingPointAnchorSnapshot) return;
		layer._pendingPointAnchorSnapshot = this.getPointAnchorSnapshot(layer);
	}

	async runLayoutRefreshWithAnchor(layer, mutateFn, options = {}) {
		const snapshot = this.getPointAnchorSnapshot(layer);
		await mutateFn();
		return this.refreshLayer(layer, {
			...options,
			preservePointAnchorFrom: snapshot
		});
	}

	getFrameAnchorLocalPoint(frame, align = 'left') {
		const left = frame.offsetX - frame.width / 2;
		const right = frame.offsetX + frame.width / 2;
		const top = frame.offsetY - frame.height / 2;
		if (align === 'center') {
			return { x: frame.offsetX, y: top };
		}
		if (align === 'right') {
			return { x: right, y: top };
		}
		return { x: left, y: top };
	}

	getWorldPointFromLocal(transform, localPoint) {
		const scaleX = (transform.scale.x || 100) / 100;
		const scaleY = (transform.scale.y || 100) / 100;
		const rotationRad = (transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);
		return {
			x: transform.position.x + localPoint.x * scaleX * cos - localPoint.y * scaleY * sin,
			y: transform.position.y + localPoint.x * scaleX * sin + localPoint.y * scaleY * cos
		};
	}

	setWorldPointFromLocal(transform, localPoint, worldPoint) {
		const scaleX = (transform.scale.x || 100) / 100;
		const scaleY = (transform.scale.y || 100) / 100;
		const rotationRad = (transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);

		transform.position.x = worldPoint.x - (localPoint.x * scaleX * cos - localPoint.y * scaleY * sin);
		transform.position.y = worldPoint.y - (localPoint.x * scaleX * sin + localPoint.y * scaleY * cos);
	}

	getPointAnchorWorldPosition(layer, frame = this.getTextFrame(layer)) {
		if (!frame) {
			return { ...getLayerTransform(layer).position };
		}
		const localPoint = this.getFrameAnchorLocalPoint(frame, layer.textData.align || 'left');
		return this.getWorldPointFromLocal(getLayerTransform(layer), localPoint);
	}

	setPointAnchorWorldPosition(layer, worldPoint, frame = this.getTextFrame(layer)) {
		if (!worldPoint || !frame) return;

		const localPoint = this.getFrameAnchorLocalPoint(frame, layer.textData.align || 'left');
		this.setWorldPointFromLocal(getLayerTransform(layer), localPoint, worldPoint);
	}

	getFrameCenterWorldPosition(layer, frame = this.getTextFrame(layer)) {
		if (!frame) {
			return { ...getLayerTransform(layer).position };
		}

		return this.getWorldPointFromLocal(getLayerTransform(layer), {
			x: frame.offsetX,
			y: frame.offsetY
		});
	}

	setFrameCenterWorldPosition(layer, worldPoint, frame = this.getTextFrame(layer)) {
		if (!worldPoint || !frame) return;

		this.setWorldPointFromLocal(getLayerTransform(layer), {
			x: frame.offsetX,
			y: frame.offsetY
		}, worldPoint);
	}

	applyPointAnchorSnapshot(layer, snapshot, measurement = null) {
		if (!snapshot || !layer?.textData || (layer.textData.boxMode || 'auto') !== 'auto') {
			return;
		}

		const nextFrame = this.getTextFrame(layer, measurement);
		if (!nextFrame) return;
		this.setPointAnchorWorldPosition(layer, snapshot.world, nextFrame);
	}

	// Effects default to GLITTER using the per-effect default id so the slot
	// shows a real glitter (not the "No glitter selected" solid placeholder) the
	// moment it's enabled. See buildDefaultBorder in effects/slot-effects.js.
	getDefaultBorder() {
		return buildDefaultBorder({
			config: CONFIG.tools.text.border || {},
			fallbackWidthPx: 4,
			fallbackMode: 'glitter',
			defaultGlitterId: CONFIG.tools.glitter.defaults.borderGlitterId
		});
	}

	getDefaultShadow() {
		return buildDefaultShadow({
			config: CONFIG.tools.text.shadow || {},
			defaultMode: 'glitter',
			defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId
		});
	}

	// The fill slot's texture scale/opacity are (deliberately) the existing
	// layer-level settings.scale/settings.opacity — not duplicated here.
	getDefaultFill() {
		return buildDefaultFill();
	}

	getMinBoxSize() {
		return Math.max(1, Math.round(CONFIG.tools.text.minBoxSize || 40));
	}

	normalizeLayer(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER || !layer.textData) return;
		if (!layer.textData.transform) {
			layer.textData.transform = createDefaultTransform();
		}
		syncLayerTransformReference(layer, layer.textData.transform);
		if (layer.textData.border === undefined) {
			layer.textData.border = null;
		}
		if (layer.textData.border) {
			layer.textData.border = { ...this.getDefaultBorder(), ...layer.textData.border };
		}
		if (layer.textData.shadow === undefined) {
			layer.textData.shadow = null;
		}
		if (layer.textData.shadow) {
			layer.textData.shadow = { ...this.getDefaultShadow(), ...layer.textData.shadow };
		}
		if (!layer.textData.fill) {
			layer.textData.fill = this.getDefaultFill();
		}
		if (!layer.textData.boxMode) {
			layer.textData.boxMode = CONFIG.tools.text.defaultBoxMode || 'auto';
		}
		if (!layer.textData.verticalAlign) {
			layer.textData.verticalAlign = CONFIG.tools.text.defaultVerticalAlign || 'top';
		}
		if (!layer.textData.lineHeight) {
			layer.textData.lineHeight = CONFIG.tools.text.lineHeight;
		}
		if (!layer.textData.fontWeight) {
			layer.textData.fontWeight = CONFIG.tools.text.defaultFontWeight || 400;
		}
		if (!layer.textData.fontStyle) {
			layer.textData.fontStyle = CONFIG.tools.text.defaultFontStyle || 'normal';
		}
		if (!['none', 'upper', 'lower', 'title'].includes(layer.textData.textCase)) {
			layer.textData.textCase = CONFIG.tools.text.defaultTextCase;
		}
	}

	ensureFixedBox(layer) {
		this.normalizeLayer(layer);

		if (layer.textData.boxWidth && layer.textData.boxHeight) {
			layer.textData.boxMode = 'fixed';
			return;
		}

		// Convert like Illustrator: the frame captures the current text block
		// exactly (+1px so rounding can't re-wrap the widest line).
		layer.textData.boxMode = 'auto';
		const entry = this.getMeasurementEntry(layer);
		layer.textData.boxMode = 'fixed';
		const minBoxSize = this.getMinBoxSize();
		layer.textData.boxWidth = Math.max(minBoxSize, Math.ceil(entry.layoutWidth || entry.textWidth || 1) + 1);
		layer.textData.boxHeight = Math.max(minBoxSize, Math.ceil(entry.layoutHeight || entry.textHeight || 1) + 1);
	}

	// "Fit to Text" for an already-fixed box: shrink-wraps the box to the
	// CURRENTLY WRAPPED lines — width becomes the widest wrapped line, height
	// becomes enough for all of them — the manual, mobile-friendly equivalent
	// of Illustrator's double-click-edge-to-fit gesture. This preserves
	// existing line breaks (both explicit ones and wraps from the old box
	// width) rather than re-flowing into one unwrapped line; it just corrects
	// a box that's now too small (or wastefully large) for its content, e.g.
	// after a font change makes glyphs wider/narrower. entry.lines is the
	// FULL wrapped line list (unlike entry.layoutWidth/Height, which in fixed
	// mode just echo the current boxWidth/boxHeight and don't grow to fit
	// overflowing content).
	fitBoxToText(layer) {
		this.normalizeLayer(layer);
		if ((layer.textData.boxMode || 'auto') !== 'fixed') return;

		const entry = this.getMeasurementEntry(layer);
		if (!entry.lines.length) return;

		const minBoxSize = this.getMinBoxSize();
		const lastLine = entry.lines[entry.lines.length - 1];
		const fullHeight = entry.ascent + (entry.lines.length - 1) * entry.lineHeightPx + lastLine.descent;
		const maxLineWidth = entry.lines.reduce((max, line) => Math.max(max, line.width), 0);

		layer.textData.boxWidth = Math.max(minBoxSize, Math.ceil(maxLineWidth) + 1);
		layer.textData.boxHeight = Math.max(minBoxSize, Math.ceil(fullHeight) + 1);
	}

	// mergeBorderDefaults is false: normalizeLayer already backfills border keys.
	ensureEffectData(layer, effectName) {
		this.normalizeLayer(layer);
		if (!layer?.textData) return null;
		return ensureSlotEffectData(layer.textData, effectName, {
			builders: {
				fill: () => this.getDefaultFill(),
				border: () => this.getDefaultBorder(),
				shadow: () => this.getDefaultShadow()
			},
			mergeBorderDefaults: false
		});
	}

	getEffectData(layer, effectName) {
		this.normalizeLayer(layer);
		return getSlotEffectData(layer?.textData, effectName);
	}

	getGlitterSelectionTarget(layer = this.getActiveTextLayer()) {
		return pickerSelectionTarget(this, layer, {
			fallback: 'fill',
			isValid: (session) => session.slot === 'fill' || Boolean(this.getEffectData(layer, session.slot))
		});
	}

	// Thin back-compat wrapper: arming a slot opens a picker session on the
	// active layer. Callers that used to reset to 'fill' now open a fill
	// session, which browse mode / getGlitterSelectionTarget treats identically.
	setGlitterSelectionTarget(target = 'fill', layer = this.getActiveTextLayer()) {
		this.openPickerSession(layer, target);
	}

	openPickerSession(layer = this.getActiveTextLayer(), slot = 'fill') {
		if (!layer) return;
		pickerOpenSession(this, { layerId: layer.id, slot }, {
			refresh: () => this.updateEffectTargetButtons(layer)
		});
		this.editor.updateGlitterSelection();
	}

	closePickerSession() {
		pickerCloseSession(this, {
			refresh: () => this.updateEffectTargetButtons(this.getActiveTextLayer()),
			updateSelection: () => this.editor.updateGlitterSelection()
		});
	}

	resolveSelectedGlitterId(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER) {
			return null;
		}

		const target = this.getGlitterSelectionTarget(layer);
		if (target === 'border') {
			return layer.textData.border?.glitterId ?? null;
		}
		if (target === 'shadow') {
			return layer.textData.shadow?.glitterId ?? null;
		}

		return layer.selectedGlitterId ?? null;
	}

	bindEffectToggle(toggle, effectName) {
		if (!toggle) return;

		toggle.addEventListener('change', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;

			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					if (toggle.checked) {
						this.ensureEffectData(layer, effectName);
					} else {
						layer.textData[effectName] = null;
						// If the gallery was armed for the slot we just disabled,
						// exit picker mode — its destination no longer exists.
						if (this.pickerSession?.layerId === layer.id
							&& this.pickerSession?.slot === effectName) {
							this.closePickerSession();
						}
					}
				}, { saveHistory: true, refreshPreview: false });
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});
	}

	bindEffectGlitterPicker(buttons, effectName) {
		const buttonList = Array.isArray(buttons) ? buttons : [buttons];
		buttonList.filter(Boolean).forEach((button) => {
			button.addEventListener('click', () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;

				this.ensureEffectData(layer, effectName);
				this.setGlitterSelectionTarget(effectName, layer);

				const selectedGlitterId = this.resolveSelectedGlitterId(layer);
				if (selectedGlitterId) {
					this.editor.glitterManager?.scrollToContent(selectedGlitterId);
				}

				revealAssetBrowser(this.editor, this.editor.glitterManager);
				this.editor.updateStatus(`Choose ${effectName} glitter, then press Esc or Done.`);
			});
		});
	}

	bindEffectUseColor(button, effectName) {
		if (!button) return;

		button.addEventListener('click', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;
			// Already solid (mode solid, or legacy data with no glitterId)? No-op.
			if (!this.effectUsesGlitter(this.getEffectData(layer, effectName))) return;

			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					const effectData = this.ensureEffectData(layer, effectName);
					effectData.glitterId = null;
					effectData.mode = 'solid';
				}, { saveHistory: true, refreshPreview: false });
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});
	}

	bindEffectUseGlitter(button, effectName) {
		if (!button) return;

		button.addEventListener('click', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;
			if (this.effectUsesGlitter(this.getEffectData(layer, effectName))) return;

			// Switch the slot to glitter mode in place. This does NOT open the
			// gallery — if no glitter was ever picked it falls back to the slot's
			// default glitter (never an empty "no glitter" state); the gallery opens
			// only when the user clicks the swatch or Change (bindEffectGlitterPicker).
			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					const data = this.ensureEffectData(layer, effectName);
					data.mode = 'glitter';
					if (!data.glitterId) {
						const def = effectName === 'shadow' ? this.getDefaultShadow() : this.getDefaultBorder();
						data.glitterId = def.glitterId;
					}
				}, { saveHistory: true, refreshPreview: false });
			} catch (error) {
				this.reportFontLoadError(error);
			}

			this.editor.updateStatus(`Text ${effectName} is using glitter — click the swatch or Change to pick a different one.`);
		});
	}

	bindEffectColorInput(input, effectName) {
		if (!input) return;

		input.addEventListener('input', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;

			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					const effectData = this.ensureEffectData(layer, effectName);
					effectData.color = input.value;
					effectData.glitterId = null;
					effectData.mode = 'solid';
				}, {
					saveHistory: false,
					refreshLayerList: false,
					refreshPreview: false
				});
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});

		input.addEventListener('change', () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;

			this.editor.saveState();
			this.loadLayerSettings(layer);
		});
	}

	bindBorderPlacement(button, placement) {
		if (!button) return;

		button.addEventListener('click', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;
			const border = this.ensureEffectData(layer, 'border');
			if (this.getBorderPlacement(border) === placement) return;

			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					this.ensureEffectData(layer, 'border').placement = placement;
				}, { saveHistory: true, refreshPreview: false });
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});
	}

	bindBorderEdgeStyle(button, edgeStyle) {
		if (!button) return;

		button.addEventListener('click', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;
			const border = this.ensureEffectData(layer, 'border');
			if (this.getBorderEdgeStyle(border) === edgeStyle) return;

			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					this.ensureEffectData(layer, 'border').edgeStyle = edgeStyle;
				}, { saveHistory: true, refreshPreview: false });
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});
	}

	bindBorderOrder(button, drawOrder) {
		if (!button) return;

		button.addEventListener('click', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;
			const border = this.ensureEffectData(layer, 'border');
			if (this.getBorderDrawOrder(border) === drawOrder) return;

			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					this.ensureEffectData(layer, 'border').drawOrder = drawOrder;
				}, { saveHistory: true, refreshPreview: false });
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});
	}

	// The fill slot's glitter-vs-solid choice lives in layer.textData.fill.mode
	// (glitterId itself stays on layer.selectedGlitterId — the pre-existing
	// convention the gallery/picker-target code already relies on), unlike
	// border/shadow which keep glitterId on the effect object itself. Hence
	// these three bespoke handlers instead of the generic bindEffect* helpers.
	bindFillUseColor() {
		const button = this.ui.fillUseColor;
		if (!button) return;

		button.addEventListener('click', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;
			if (this.getEffectData(layer, 'fill')?.mode === 'solid') return;

			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					this.ensureEffectData(layer, 'fill').mode = 'solid';
				}, { saveHistory: true, refreshPreview: false });
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});
	}

	bindFillUseGlitter() {
		const button = this.ui.fillUseGlitter;
		if (!button) return;

		button.addEventListener('click', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;
			if (this.getEffectData(layer, 'fill')?.mode === 'glitter') return;

			// Switching mode only flips the mode in place — it shows the fill's
			// existing glitter. It deliberately does NOT open the gallery; that
			// only happens when the user clicks the swatch or Change.
			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					this.ensureEffectData(layer, 'fill').mode = 'glitter';
				}, { saveHistory: true, refreshPreview: false });
			} catch (error) {
				this.reportFontLoadError(error);
			}

			this.editor.updateStatus('Text fill is using glitter — click the swatch or Change to pick a different one.');
		});
	}

	bindFillUseNone() {
		const button = this.ui.fillUseNone;
		if (!button) return;

		button.addEventListener('click', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;
			if (this.getEffectData(layer, 'fill')?.mode === 'none') return;

			// No fill → the text reads as an outline (its border becomes hollow).
			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					this.ensureEffectData(layer, 'fill').mode = 'none';
				}, { saveHistory: true, refreshPreview: false });
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});
	}

	bindFillColorInput() {
		const input = this.ui.fillColor;
		if (!input) return;

		input.addEventListener('input', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;

			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					const fillData = this.ensureEffectData(layer, 'fill');
					fillData.color = input.value;
					fillData.mode = 'solid';
				}, {
					saveHistory: false,
					refreshLayerList: false,
					refreshPreview: false
				});
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});

		input.addEventListener('change', () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;

			this.editor.saveState();
			this.loadLayerSettings(layer);
		});
	}

	attachSlider(slider, valueDisplay, suffix, applyValue, resetValue, refreshTextLayout = true) {
		if (!slider || !valueDisplay) return;
		const resetId = 'reset' + slider.id.charAt(0).toUpperCase() + slider.id.slice(1);
		const resetButton = document.getElementById(resetId);

		bindSlider(slider, valueDisplay, {
			suffix,
			resetValue,
			resetButton,
			apply: async (value) => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;

				await this.runLayoutRefreshWithAnchor(layer, () => {
					applyValue(value, layer);
				}, {
					saveHistory: false,
					refreshLayerList: false,
					refreshPreview: refreshTextLayout
				});
			},
			onCommit: () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;
				this.editor.saveState();
				this.editor.layerManager.renderLayersList();
			},
			onError: (error) => {
				this.reportFontLoadError(error);
			}
		});
	}

	async loadFontsManifest() {
		if (this.fontManifestPromise) {
			return this.fontManifestPromise;
		}

		this.fontManifestPromise = (async () => {
			const response = await fetch(CONFIG.tools.text.fontsManifest);
			if (!response.ok) {
				throw new Error(`Failed to load fonts manifest (${response.status})`);
			}

			this.fontManifest = await response.json();
			this.fontsById.clear();
			this.fontManifest.forEach((font) => {
				this.fontsById.set(font.id, font);
			});

			this.renderFontPicker();
			return this.fontManifest;
		})();

		try {
			return await this.fontManifestPromise;
		} catch (error) {
			this.fontManifestPromise = null;
			throw error;
		}
	}

	renderFontPicker() {
		if (!this.ui.fontPicker) return;

		const fonts = [...this.fontManifest].sort(
			(a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured))
		);

		// Every font gets the same card: a same sample phrase rendered in the
		// font itself (never the font's own name — that's shown separately
		// below, in the UI font, like a gallery card's name caption), plus a
		// corner badge for any script beyond plain Latin.
		const sampleTextByScript = { latin: 'Glitter', ja: 'グリッター', ko: '글리터', zh: '闪粉' };
		const langLabels = { ja: 'JA', ko: 'KO', zh: 'ZH' };

		this.ui.fontPicker.innerHTML = '';
		fonts.forEach((font) => {
			const scripts = font.scripts || ['latin'];
			const sampleScript = scripts.find((script) => script !== 'latin' && sampleTextByScript[script]) || 'latin';
			const extraScripts = scripts.filter((script) => script !== 'latin');

			const card = document.createElement('button');
			card.className = 'text-font-option';
			card.type = 'button';
			card.dataset.fontId = font.id;

			const sample = document.createElement('span');
			sample.className = 'text-font-option-sample';
			sample.style.fontFamily = this.getFontFamily(font);
			sample.textContent = sampleTextByScript[sampleScript];
			card.appendChild(sample);

			const name = document.createElement('span');
			name.className = 'text-font-option-name';
			name.textContent = font.name;
			card.appendChild(name);

			// One corner badge: extra scripts and/or the device-font marker
			// (system faces render with a fallback on devices without them).
			const badgeLabels = extraScripts.map((script) => langLabels[script] || script.toUpperCase());
			if (font.system) badgeLabels.push('System');
			if (badgeLabels.length > 0) {
				const badge = document.createElement('span');
				badge.className = 'text-font-option-badge';
				extraScripts.forEach((script) => badge.classList.add(`is-${script}`));
				if (font.system) badge.classList.add('is-system');
				badge.textContent = badgeLabels.join(' · ');
				card.appendChild(badge);
			}

			this.ui.fontPicker.appendChild(card);
		});
	}

	async ensureFontPickerFontsLoaded() {
		await this.loadFontsManifest();

		if (this.fontPickerPreloadPromise) {
			return this.fontPickerPreloadPromise;
		}

		this.fontPickerPreloadPromise = Promise.all(
			this.fontManifest.map((font) =>
				this.ensureFontLoaded(font.id).catch((error) => {
					this.reportFontLoadError(error);
				})
			)
		);

		return this.fontPickerPreloadPromise;
	}

	getFontById(fontId) {
		return this.fontsById.get(fontId) || this.fontsById.get(CONFIG.tools.text.defaultFontId) || null;
	}

	getFontFamily(font) {
		if (!font) return 'sans-serif';
		// System fonts carry their own full stack (device coverage varies).
		if (font.family) return font.family;
		return `"${font.name}", ${font.fallback || 'sans-serif'}`;
	}

	getFontDeclaration(font, fontSize, fontWeight = null, fontStyle = 'normal') {
		const weight = fontWeight || font?.weight || 400;
		if (!font?.name) {
			return `${fontStyle} ${weight} ${fontSize}px sans-serif`;
		}
		// System fonts need the whole stack in canvas font strings too, so a
		// device without the face falls back the same way preview DOM does.
		const family = font.family || `"${font.name}"`;
		return `${fontStyle} ${weight} ${fontSize}px ${family}`;
	}

	async ensureFontLoaded(fontId) {
		await this.loadFontsManifest();

		const font = this.getFontById(fontId);
		if (!font) {
			throw new Error(`Unknown text font "${fontId}"`);
		}

		if (this.fontLoadPromises.has(font.id)) {
			return this.fontLoadPromises.get(font.id);
		}

		const fontPromise = (async () => {
			// Installed-on-device face: nothing to fetch — the family stack's
			// fallback covers devices without it (Android ships neither Comic
			// Sans nor Impact). document.fonts.load still warms measurement.
			if (font.system) {
				if (font.fallbackFontId) {
					await this.ensureFontLoaded(font.fallbackFontId);
				}
				await document.fonts.load(this.getFontDeclaration(font, CONFIG.tools.text.defaultFontSize), 'Hg');
				return null;
			}
			try {
				const response = await fetch(font.file);
				if (!response.ok) {
					throw new Error(`Failed to load font "${font.name}" (${response.status})`);
				}

				const data = await response.arrayBuffer();
				const face = new FontFace(font.name, data, {
					weight: String(font.weight || 400)
				});

				await face.load();
				document.fonts.add(face);
				await document.fonts.load(this.getFontDeclaration(font, CONFIG.tools.text.defaultFontSize), 'Hg');
				this.fontFaces.set(font.id, face);
				return face;
			} catch (error) {
				throw new Error(`Failed to load font "${font.name}": ${error.message}`);
			}
		})();

		this.fontLoadPromises.set(font.id, fontPromise);

		try {
			return await fontPromise;
		} catch (error) {
			this.fontLoadPromises.delete(font.id);
			throw error;
		}
	}

	reportFontLoadError(error) {
		if (!error || error._textGlitterReported) return;
		error._textGlitterReported = true;
		this.editor.showError(error.message);
	}

	getLayerName(text) {
		const trimmed = (text || '').replace(/\s+/g, ' ').trim();
		if (!trimmed) return 'Text';
		return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
	}

	getActiveTextLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type === LayerType.TEXT_GLITTER) {
			this.normalizeLayer(layer);
			return layer;
		}
		return null;
	}

	createLayer(options = {}) {
		if (this.editor.layerManager.layers.length >= CONFIG.app.limits.maxLayers) {
			this.editor.showError(`Maximum ${CONFIG.app.limits.maxLayers} layers reached`);
			return null;
		}

		const defaultText = options.text ?? CONFIG.tools.text.defaultText;
		const initialPosition = options.position || {
			x: this.editor.originalCanvas.width / 2,
			y: this.editor.originalCanvas.height / 2
		};
		const initialAlign = options.align || 'center';
		const transform = createDefaultTransform({
			position: {
				x: initialPosition.x,
				y: initialPosition.y
			}
		});
		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.TEXT_GLITTER,
			name: this.getLayerName(defaultText),
			visible: true,
			locked: false,
			selectedGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId,
			settings: {
				scale: CONFIG.tools.effects.defaults.scale,
				opacity: CONFIG.tools.effects.defaults.opacity
			},
			textData: {
				text: defaultText,
				fontId: CONFIG.tools.text.defaultFontId,
				fontWeight: CONFIG.tools.text.defaultFontWeight || 400,
				fontStyle: CONFIG.tools.text.defaultFontStyle || 'normal',
				textCase: CONFIG.tools.text.defaultTextCase,
				fontSize: CONFIG.tools.text.defaultFontSize,
				letterSpacing: CONFIG.tools.text.defaultLetterSpacing,
				lineHeight: CONFIG.tools.text.lineHeight,
				align: initialAlign,
				verticalAlign: CONFIG.tools.text.defaultVerticalAlign || 'top',
				boxMode: options.boxMode || CONFIG.tools.text.defaultBoxMode || 'auto',
				width: 0,
				height: 0,
				border: null,
				shadow: null,
				transform
			}
		};

		this.ensureFontLoaded(layer.textData.fontId).catch((error) => {
			this.reportFontLoadError(error);
		});
		if (options.anchorPosition) {
			layer._pendingPointAnchorTarget = {
				x: options.anchorPosition.x,
				y: options.anchorPosition.y
			};
		}

		layer.transform = transform;
		syncLayerTransformReference(layer, transform);
		return layer;
	}

	loadLayerSettings(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER) return;
		this.normalizeLayer(layer);

		this.ensureFontPickerFontsLoaded().catch((error) => {
			this.reportFontLoadError(error);
		});

		if (this.ui.textInput) {
			this.ui.textInput.value = layer.textData.text;
		}

		if (this.ui.fontSize && this.ui.fontSizeValue) {
			this.ui.fontSize.value = layer.textData.fontSize;
			this.ui.fontSizeValue.innerHTML = formatUnit(layer.textData.fontSize, 'px');
		}

		if (this.ui.letterSpacing && this.ui.letterSpacingValue) {
			this.ui.letterSpacing.value = layer.textData.letterSpacing;
			this.ui.letterSpacingValue.innerHTML = formatUnit(layer.textData.letterSpacing, 'px');
		}

		if (this.ui.lineHeight && this.ui.lineHeightValue) {
			const lineHeightPercent = Math.round((layer.textData.lineHeight || CONFIG.tools.text.lineHeight) * 100);
			this.ui.lineHeight.value = lineHeightPercent;
			this.ui.lineHeightValue.innerHTML = formatUnit(lineHeightPercent, '%');
		}

		if (this.ui.textureScale && this.ui.textureScaleValue) {
			this.ui.textureScale.value = layer.settings.scale;
			this.ui.textureScaleValue.innerHTML = formatUnit(layer.settings.scale, '%');
		}

		if (this.ui.textureOpacity && this.ui.textureOpacityValue) {
			this.ui.textureOpacity.value = layer.settings.opacity;
			this.ui.textureOpacityValue.innerHTML = formatUnit(layer.settings.opacity, '%');
		}

		this.updateFontSelection(layer.textData.fontId);
		this.updateFontStyleSelection(layer.textData);
		this.updateAlignmentSelection(layer.textData.align);
		this.updateVerticalAlignmentSelection(layer.textData.verticalAlign);
		this.updateBoxModeSelection(layer);
		this.updateEffectControls(layer);
		this.editor.loadTransformSettings?.(layer, 'text');
	}

	focusTextInput(selectAll = false) {
		if (!this.ui.textInput) return;
		this.ui.textInput.closest('[data-panel-group]')?.classList.remove('collapsed');

		if (!this.editor.mobileManager?.isMobile) {
			this.editor.setCollapsibleSectionOpen?.('textSettings', true);
		}

		requestAnimationFrame(() => {
			this.ui.textInput.focus();
			if (selectAll) {
				this.ui.textInput.select();
			}
		});
	}

	updateFontSelection(fontId) {
		if (!this.ui.fontPicker) return;

		this.ui.fontPicker.querySelectorAll('[data-font-id]').forEach((button) => {
			button.classList.toggle('active', button.dataset.fontId === fontId);
		});

		this.scrollActiveFontIntoView();
	}

	updateFontStyleSelection(textData) {
		const states = [
			[this.ui.fontBold, textData.fontWeight === 700],
			[this.ui.fontItalic, textData.fontStyle === 'italic']
		];
		states.forEach(([button, active]) => {
			button?.classList.toggle('active', active);
			button?.setAttribute('aria-pressed', String(active));
		});
		this.ui.textCaseButtons.forEach((button) => {
			const active = button.id === `textCase${textData.textCase.charAt(0).toUpperCase()}${textData.textCase.slice(1)}`;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
	}

	applyTextCase(text, mode) {
		const value = String(text || '');
		if (mode === 'upper') return value.toLocaleUpperCase();
		if (mode === 'lower') return value.toLocaleLowerCase();
		if (mode === 'title') return value.replace(/(^|\s)(\S)/gu, (match, space, letter) => space + letter.toLocaleUpperCase());
		return value;
	}

	scrollActiveFontIntoView() {
		const picker = this.ui.fontPicker;
		const active = picker?.querySelector('.text-font-option.active');
		if (!picker || !active || picker.scrollHeight <= picker.clientHeight) return;

		const top = active.offsetTop;
		const bottom = top + active.offsetHeight;
		if (top < picker.scrollTop) {
			picker.scrollTop = top;
		} else if (bottom > picker.scrollTop + picker.clientHeight) {
			picker.scrollTop = bottom - picker.clientHeight;
		}
	}

	updateAlignmentSelection(align) {
		this.ui.alignButtons.forEach((button) => {
			button.classList.toggle('active', button.dataset.textAlign === align);
		});
	}

	updateVerticalAlignmentSelection(verticalAlign) {
		this.ui.verticalAlignButtons.forEach((button) => {
			button.classList.toggle('active', button.dataset.textValign === (verticalAlign || 'top'));
		});
	}

	updateBoxModeSelection(layer) {
		const mode = layer?.textData?.boxMode || 'auto';
		this.ui.boxModeButtons.forEach((button) => {
			button.classList.toggle('active', button.dataset.textBoxMode === mode);
		});

		// CSS hides only the vertical alignment controls in point mode.
		if (this.ui.section) {
			this.ui.section.dataset.boxMode = mode;
		}

		if (this.ui.boxModeHint) {
			this.ui.boxModeHint.textContent = mode === 'fixed'
				? 'Box text wraps inside the frame. Drag any resize handle to change the box without scaling the text.'
				: 'Point text hugs the glyphs. Corner handles scale it. Switch to Box for wrapping inside a resizable frame.';
		}

		if (this.ui.fitBoxToContent) {
			const enabled = mode === 'fixed';
			this.ui.fitBoxToContent.disabled = !enabled;
			this.ui.fitBoxToContent.title = enabled
				? 'Resize the box to exactly fit the current text (keeps existing line breaks/wraps)'
				: 'Fit to Text is available only in Box mode';
		}
	}

	updateEffectControls(layer) {
		this.normalizeLayer(layer);

		const border = this.getEffectData(layer, 'border');
		const shadow = this.getEffectData(layer, 'shadow');
		const borderDefaults = this.getDefaultBorder();
		const shadowDefaults = this.getDefaultShadow();

		if (this.ui.borderEnabled) {
			this.ui.borderEnabled.checked = Boolean(border);
		}
		if (this.ui.shadowEnabled) {
			this.ui.shadowEnabled.checked = Boolean(shadow);
		}

		this.toggleEffectControls(this.ui.borderControls, Boolean(border));
		this.toggleEffectControls(this.ui.shadowControls, Boolean(shadow));

		if (border) {
			this.ui.borderWidth.value = border.widthPx;
			this.ui.borderWidthValue.innerHTML = formatUnit(border.widthPx, 'px');
			this.ui.borderColor.value = border.color;
			if (this.ui.borderScale) {
				this.ui.borderScale.value = border.scale ?? borderDefaults.scale;
				this.ui.borderScaleValue.innerHTML = formatUnit(border.scale ?? borderDefaults.scale, '%');
			}
			if (this.ui.borderOpacity) {
				this.ui.borderOpacity.value = border.opacity ?? borderDefaults.opacity;
				this.ui.borderOpacityValue.innerHTML = formatUnit(border.opacity ?? borderDefaults.opacity, '%');
			}
			this.syncBorderOptionUI(border);
		} else {
			const defaults = borderDefaults;
			this.ui.borderWidth.value = defaults.widthPx;
			this.ui.borderWidthValue.innerHTML = formatUnit(defaults.widthPx, 'px');
			this.ui.borderColor.value = defaults.color;
			if (this.ui.borderScale) {
				this.ui.borderScale.value = defaults.scale;
				this.ui.borderScaleValue.innerHTML = formatUnit(defaults.scale, '%');
			}
			if (this.ui.borderOpacity) {
				this.ui.borderOpacity.value = defaults.opacity;
				this.ui.borderOpacityValue.innerHTML = formatUnit(defaults.opacity, '%');
			}
			this.syncBorderOptionUI(defaults);
		}

		if (shadow) {
			this.ui.shadowOffsetX.value = shadow.offsetX;
			this.ui.shadowOffsetXValue.innerHTML = formatUnit(shadow.offsetX, 'px');
			this.ui.shadowOffsetY.value = shadow.offsetY;
			this.ui.shadowOffsetYValue.innerHTML = formatUnit(shadow.offsetY, 'px');
			this.ui.shadowColor.value = shadow.color;
			if (this.ui.shadowScale) {
				this.ui.shadowScale.value = shadow.scale ?? shadowDefaults.scale;
				this.ui.shadowScaleValue.innerHTML = formatUnit(shadow.scale ?? shadowDefaults.scale, '%');
			}
			if (this.ui.shadowOpacity) {
				this.ui.shadowOpacity.value = shadow.opacity ?? shadowDefaults.opacity;
				this.ui.shadowOpacityValue.innerHTML = formatUnit(shadow.opacity ?? shadowDefaults.opacity, '%');
			}
		} else {
			const defaults = shadowDefaults;
			this.ui.shadowOffsetX.value = defaults.offsetX;
			this.ui.shadowOffsetXValue.innerHTML = formatUnit(defaults.offsetX, 'px');
			this.ui.shadowOffsetY.value = defaults.offsetY;
			this.ui.shadowOffsetYValue.innerHTML = formatUnit(defaults.offsetY, 'px');
			this.ui.shadowColor.value = defaults.color;
			if (this.ui.shadowScale) {
				this.ui.shadowScale.value = defaults.scale;
				this.ui.shadowScaleValue.innerHTML = formatUnit(defaults.scale, '%');
			}
			if (this.ui.shadowOpacity) {
				this.ui.shadowOpacity.value = defaults.opacity;
				this.ui.shadowOpacityValue.innerHTML = formatUnit(defaults.opacity, '%');
			}
		}

		// Color adjust (WP4): fill aliases layer.settings; border/shadow read their
		// own effect data (identity when the effect is absent).
		this._loadEffectColorAdjust('fill', layer.settings?.colorAdjust);
		this._loadEffectColorAdjust('border', border?.colorAdjust);
		this._loadEffectColorAdjust('shadow', shadow?.colorAdjust);

		this.updateFillSourceUI(layer);
		this.updateEffectSourceUI(layer, 'border');
		this.updateEffectSourceUI(layer, 'shadow');
		this.updateEffectTargetButtons(layer);
	}

	// Fill's shape ({mode, color} + glitterId on layer.selectedGlitterId) differs
	// from border/shadow's ({glitterId, color} directly), so it gets its own
	// summary/update logic rather than sharing getEffectSourceSummary/
	// updateEffectSourceUI — but mirrors their visible behavior exactly.
	updateFillSourceUI(layer) {
		if (!this.ui.fillGlitterChip || !this.ui.fillGlitterLabel) return;

		const fillData = this.ensureEffectData(layer, 'fill');
		const usesGlitter = fillData.mode === 'glitter';
		// Glitter mode is never empty — fall back to the default glitter.
		if (usesGlitter && !layer.selectedGlitterId) {
			layer.selectedGlitterId = CONFIG.tools.glitter.defaults.fillGlitterId;
		}
		const glitter = usesGlitter
			? this.editor.glitterManager?.getItemById(layer?.selectedGlitterId)
			: null;

		// Segmented control reflects the mode; at most one source display shows
		// (None shows neither — the text becomes an outline via its border).
		syncPaintSlotSourceUI(this.ui.fillUseGlitter, fillData.mode);

		if (usesGlitter && glitter) {
			// Reuse the exact Glitter-Properties asset display (thumbnail, name,
			// badges, size, frames) so the two stay visually identical.
			this.editor.renderGlitterAssetDisplay({
				thumbnail: this.ui.fillGlitterChip,
				name: this.ui.fillGlitterLabel,
				badges: this.ui.fillGlitterBadges,
				size: this.ui.fillGlitterSize,
				frames: this.ui.fillGlitterFrames
			}, glitter, layer.settings?.colorAdjust);
			const title = `Current fill glitter: ${glitter.name}. Click to choose another glitter.`;
			this.ui.fillGlitterChip.title = title;
			if (this.ui.fillGlitterChange) this.ui.fillGlitterChange.title = title;
		} else if (usesGlitter) {
			this.clearGlitterAssetDisplay({
				thumbnail: this.ui.fillGlitterChip,
				name: this.ui.fillGlitterLabel,
				badges: this.ui.fillGlitterBadges,
				size: this.ui.fillGlitterSize,
				frames: this.ui.fillGlitterFrames
			});
			const title = 'Pick a glitter for the text fill';
			this.ui.fillGlitterChip.title = title;
			if (this.ui.fillGlitterChange) this.ui.fillGlitterChange.title = title;
		}

		if (this.ui.fillColor) this.ui.fillColor.value = fillData.color || '#000000';
	}

	// Glitter mode but the asset couldn't be resolved (missing/unloaded) — reset
	// the display to a neutral placeholder. Shared by fill and border/shadow.
	clearGlitterAssetDisplay(els, placeholder = 'No glitter selected') {
		if (els.thumbnail) {
			els.thumbnail.classList.remove('glitter-bg');
			els.thumbnail.style.backgroundImage = 'none';
			els.thumbnail.style.backgroundColor = 'transparent';
			els.thumbnail.style.filter = '';
		}
		if (els.name) {
			els.name.textContent = placeholder;
			els.name.title = '';
		}
		if (els.badges) els.badges.innerHTML = '';
		if (els.size) els.size.textContent = '';
		if (els.frames) els.frames.textContent = '';
	}

	toggleEffectControls(element, isVisible) {
		if (!element) return;
		element.classList.toggle('visible', isVisible);
	}

	getBorderPlacement(borderData) {
		return borderData?.placement === 'inside'
			? 'inside'
			: borderData?.placement === 'center'
				? 'center'
				: 'outside';
	}

	getBorderEdgeStyle(borderData) {
		return borderData?.edgeStyle === 'hard' ? 'hard' : 'round';
	}

	getBorderDrawOrder(borderData) {
		return borderData?.drawOrder === 'front' ? 'front' : 'behind';
	}

	getBorderOutsidePadding(borderData) {
		const widthPx = Math.max(0, borderData?.widthPx || 0);
		switch (this.getBorderPlacement(borderData)) {
			case 'inside':
				return 0;
			case 'center':
				return Math.ceil(widthPx / 2);
			default:
				return widthPx;
		}
	}

	syncBorderOptionUI(borderData) {
		const placement = this.getBorderPlacement(borderData);
		const edgeStyle = this.getBorderEdgeStyle(borderData);
		const drawOrder = this.getBorderDrawOrder(borderData);

		this.ui.borderEdgeRounded?.classList.toggle('active', edgeStyle === 'round');
		this.ui.borderEdgeHard?.classList.toggle('active', edgeStyle === 'hard');
		this.ui.borderPositionOutside?.classList.toggle('active', placement === 'outside');
		this.ui.borderPositionCenter?.classList.toggle('active', placement === 'center');
		this.ui.borderPositionInside?.classList.toggle('active', placement === 'inside');
		this.ui.borderOrderBehind?.classList.toggle('active', drawOrder === 'behind');
		this.ui.borderOrderFront?.classList.toggle('active', drawOrder === 'front');
	}

	updateEffectTargetButtons(layer) {
		const activeTarget = this.getGlitterSelectionTarget(layer);
		this.ui.fillGlitterChip?.classList.toggle('target-active', activeTarget === 'fill');
		this.ui.fillGlitterChange?.classList.toggle('target-active', activeTarget === 'fill');
		this.ui.borderGlitterChip?.classList.toggle('target-active', activeTarget === 'border');
		this.ui.borderGlitterChange?.classList.toggle('target-active', activeTarget === 'border');
		this.ui.shadowGlitterChip?.classList.toggle('target-active', activeTarget === 'shadow');
		this.ui.shadowGlitterChange?.classList.toggle('target-active', activeTarget === 'shadow');
		this.updatePickerStrip();
	}

	setupPickerStripListeners() {
		this.ui.pickerStripDone?.addEventListener('click', () => {
			// The strip is shared by every asset/effect manager. Text may only own
			// Done while a text layer has an armed text picker session.
			if (this.editor.layerManager.getActiveLayer()?.type !== LayerType.TEXT_GLITTER || !this.pickerSession) return;
			const slot = this.pickerSession?.slot || 'fill';
			this.closePickerSession();
			this.returnToTextProperties(slot);
		});

		// Single global Esc listener: exits picker mode, but stays out of the way
		// when the user is typing or a modal owns the interaction.
		document.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || !this.pickerSession) return;
			const active = document.activeElement;
			const isTyping = active && (active.tagName === 'INPUT'
				|| active.tagName === 'TEXTAREA' || active.isContentEditable);
			if (isTyping) return;
			if (this.editor.modalManager?.isAnyOpen?.()) return;
			event.preventDefault();
			const slot = this.pickerSession?.slot || 'fill';
			this.closePickerSession();
			this.returnToTextProperties(slot);
			this.editor.updateStatus('Exited glitter picker. Gallery clicks now change the text fill.');
		});
	}

	// Explicit exit from picker mode (Done / Esc) returns focus to where the
	// user armed from. This is deliberately NOT part of closePickerSession —
	// the automatic clears (layer switch, effect disable, history restore)
	// already move the user elsewhere and must not yank the view back.
	returnToTextProperties(slot = 'fill') {
		const chipId = slot === 'border'
			? 'textBorderGlitterChip'
			: slot === 'shadow'
				? 'textShadowGlitterChip'
				: 'textFillGlitterChip';
		returnFromPickerToProperties(this.editor, { section: 'textSettings', focusId: chipId });
	}

	// D-1c: the gallery status strip. Picker mode (armed slot on the active
	// layer) shows an accent strip naming the destination + a Done button;
	// browse mode shows a passive one-line hint only when the active text
	// layer's fill is solid; otherwise the strip is hidden. Driven from
	// updateEffectTargetButtons (arm/disarm, fill-mode flips, layer activate)
	// and app.updateSidePanelUI (switching to any layer type).
	updatePickerStrip() {
		const layer = this.getActiveTextLayer();
		if (!layer) {
			renderPickerStrip({ ownsStrip: true, visible: false });
			return;
		}
		const armedSlot = pickerSelectionTarget(this, layer, {
			isValid: (session) => session.slot === 'fill' || Boolean(this.getEffectData(layer, session.slot))
		});
		const fillData = this.getEffectData(layer, 'fill');
		const fillIsSolid = fillData?.mode === 'solid';
		if (armedSlot) {
			let stripText;
			if (armedSlot === 'fill' && fillIsSolid) {
				const color = (fillData.color || '#000000').toUpperCase();
				stripText = { title: 'Choosing fill glitter', detail: `${formatPickerTarget(layer.name, 'text')}; current fill is solid (${color}).` };
			} else {
				stripText = formatPickerStripText(armedSlot, layer.name, 'text');
			}
			renderPickerStrip({ ownsStrip: true, visible: true, armed: true, ...stripText });
			return;
		}
		renderPickerStrip({
			ownsStrip: true,
			visible: fillIsSolid,
			hint: fillIsSolid,
			title: 'Text fill is a solid color — picking a glitter will switch it.'
		});
	}

	updateEffectSourceUI(layer, effectName) {
		const effectData = this.getEffectData(layer, effectName);
		// Glitter mode is never empty — fall back to the slot's default glitter.
		if (effectData && this.effectUsesGlitter(effectData) && !effectData.glitterId) {
			const def = effectName === 'shadow' ? this.getDefaultShadow() : this.getDefaultBorder();
			effectData.glitterId = def.glitterId;
		}
		const config = effectName === 'border'
			? {
				button: this.ui.borderGlitterChip,
				changeButton: this.ui.borderGlitterChange,
				label: this.ui.borderGlitterLabel,
				badges: this.ui.borderGlitterBadges,
				info: this.ui.borderGlitterInfo,
				size: this.ui.borderGlitterSize,
				frames: this.ui.borderGlitterFrames,
				useColor: this.ui.borderUseColor,
				useGlitter: this.ui.borderUseGlitter,
				colorRow: this.ui.borderColorRow,
				scaleRow: this.ui.borderScaleRow
			}
			: {
				button: this.ui.shadowGlitterChip,
				changeButton: this.ui.shadowGlitterChange,
				label: this.ui.shadowGlitterLabel,
				badges: this.ui.shadowGlitterBadges,
				info: this.ui.shadowGlitterInfo,
				size: this.ui.shadowGlitterSize,
				frames: this.ui.shadowGlitterFrames,
				useColor: this.ui.shadowUseColor,
				useGlitter: this.ui.shadowUseGlitter,
				colorRow: this.ui.shadowColorRow,
				scaleRow: this.ui.shadowScaleRow
			};

		if (!config.button || !config.label || !config.useColor || !config.useGlitter || !config.colorRow) {
			return;
		}

		const summary = this.getEffectSourceSummary(effectData, effectName);
		const usesGlitter = summary.usesGlitter;

		syncPaintSlotSourceUI(config.useGlitter, effectData?.mode || (usesGlitter ? 'glitter' : 'solid'));

		config.button.title = summary.buttonTitle;
		if (config.changeButton) config.changeButton.title = summary.buttonTitle;

		if (usesGlitter && summary.glitter) {
			this.editor.renderGlitterAssetDisplay({
				thumbnail: config.button,
				name: config.label,
				badges: config.badges,
				size: config.size,
				frames: config.frames
			}, summary.glitter, effectData?.colorAdjust);
		} else if (usesGlitter) {
			// Glitter mode selected but nothing picked yet — show the empty
			// "choose a glitter" state (the chip/Change tooltip prompts to pick).
			this.clearGlitterAssetDisplay({
				thumbnail: config.button,
				name: config.label,
				badges: config.badges,
				size: config.size,
				frames: config.frames
			});
		}
		// Solid mode: the color display is shown instead of the glitter info,
		// so the thumbnail/label (now hidden) need no painting.
	}

	// Whether a border/shadow slot is in glitter mode for UI purposes. Explicit
	// `mode` wins (so "Glitter" can be selected before a glitter is picked);
	// legacy data without `mode` falls back to glitterId truthiness.
	effectUsesGlitter(effectData) {
		if (!effectData) return false;
		if (effectData.mode === 'glitter') return true;
		if (effectData.mode === 'solid') return false;
		return Boolean(effectData.glitterId);
	}

	getEffectSourceSummary(effectData, effectName) {
		const defaultColor = effectName === 'shadow'
			? this.getDefaultShadow().color
			: this.getDefaultBorder().color;
		const effectTitle = effectName === 'shadow' ? 'shadow' : 'border';
		if (!effectData) {
			return {
				label: defaultColor.toUpperCase(),
				buttonTitle: `Pick a glitter for the text ${effectTitle}`,
				backgroundImage: 'none',
				backgroundColor: defaultColor,
				usesGlitter: false
			};
		}

		if (this.effectUsesGlitter(effectData)) {
			const glitter = effectData.glitterId
				? this.editor.glitterManager.getItemById(effectData.glitterId)
				: null;
			return {
				label: glitter ? glitter.name : 'No glitter selected',
				buttonTitle: glitter
					? `Current ${effectTitle} glitter: ${glitter.name}. Click to choose another glitter.`
					: `Pick a glitter for the text ${effectTitle}`,
				backgroundImage: glitter ? `url(${glitter.url})` : 'none',
				backgroundColor: 'transparent',
				usesGlitter: true,
				glitter
			};
		}

		return {
			label: (effectData.color || defaultColor).toUpperCase(),
			buttonTitle: `The text ${effectTitle} is using a solid color. Click to choose a glitter instead.`,
			backgroundImage: 'none',
			backgroundColor: effectData.color || '#000000',
			usesGlitter: false
		};
	}

	scheduleTextCommit(layer) {
		clearTimeout(this.textInputTimer);
		this.textInputTimer = setTimeout(async () => {
			try {
				await this.refreshLayer(layer, {
					saveHistory: true,
					preservePointAnchorFrom: layer._pendingPointAnchorSnapshot || null
				});
			} catch (error) {
				this.reportFontLoadError(error);
			}
		}, CONFIG.tools.selection.timing.sliderDebounceMs);
	}

	getCacheKeyForLayer(layer) {
		this.normalizeLayer(layer);
		const textData = layer.textData;
		return JSON.stringify([
			textData.text,
			textData.textCase,
			textData.fontId,
			textData.fontWeight,
			textData.fontStyle,
			// Font-readiness is part of the key: selection highlights and transform
			// handles measure synchronously right after layer creation, before the
			// FontFace resolves. Without this flag that fallback-font measurement
			// (and its rasterized canvas) is cached under the same key the real
			// font would use, so the fallback sticks for the whole session.
			this.fontFaces.has(textData.fontId),
			textData.fontSize,
			textData.letterSpacing,
			textData.lineHeight,
			textData.align,
			textData.verticalAlign || 'top',
			textData.boxMode || 'auto',
			textData.boxWidth ?? null,
			textData.boxHeight ?? null,
			textData.border ? [textData.border.widthPx, this.getBorderPlacement(textData.border)] : null,
			textData.shadow ? textData.shadow.offsetX : null,
			textData.shadow ? textData.shadow.offsetY : null,
			CONFIG.rendering?.crispMaskEdges !== false
		]);
	}

	getMeasurementEntry(layer) {
		this.normalizeLayer(layer);

		const key = this.getCacheKeyForLayer(layer);
		const cached = this.textMaskCache.get(key);
		if (cached) {
			layer.textData.width = cached.width;
			layer.textData.height = cached.height;
			return cached;
		}

		const font = this.getFontById(layer.textData.fontId);
		const ctx = this.measureCtx;
		const lines = this.applyTextCase(layer.textData.text, layer.textData.textCase).split('\n');
		const padding = CONFIG.rendering?.maskPaddingPx ?? 8;
		const fontSize = layer.textData.fontSize;
		const letterSpacing = layer.textData.letterSpacing;
		const lineHeightPx = fontSize * layer.textData.lineHeight;
		const borderWidth = this.getBorderOutsidePadding(layer.textData.border);
		const shadowOffsetX = layer.textData.shadow?.offsetX || 0;
		const shadowOffsetY = layer.textData.shadow?.offsetY || 0;
		const boxMode = layer.textData.boxMode || 'auto';

		ctx.font = this.getFontDeclaration(font, fontSize, layer.textData.fontWeight, layer.textData.fontStyle);
		ctx.textBaseline = 'alphabetic';

		const sampleMetrics = ctx.measureText('Hg');
		const ascent = sampleMetrics.actualBoundingBoxAscent || fontSize * 0.8;
		const descent = sampleMetrics.actualBoundingBoxDescent || fontSize * 0.2;

		let measuredLines = [];
		let layoutWidth = 0;
		let layoutHeight = 0;
		let visibleLineCount = 0;
		let hasOverflow = false;
		let contentOffsetY = 0;
		const minBoxSize = this.getMinBoxSize();

		if (boxMode === 'fixed') {
			layoutWidth = Math.max(minBoxSize, Math.round(layer.textData.boxWidth || minBoxSize));
			layoutHeight = Math.max(minBoxSize, Math.round(layer.textData.boxHeight || minBoxSize));
			const wrapped = this.wrapTextLines(ctx, lines, layoutWidth, letterSpacing, fontSize);
			measuredLines = wrapped.lines;

			measuredLines.forEach((line, index) => {
				const bottom = ascent + index * lineHeightPx + line.descent;
				if (bottom <= layoutHeight) {
					visibleLineCount++;
				}
			});
			hasOverflow = visibleLineCount < measuredLines.length;
		} else {
			measuredLines = lines.map((line) => this.measureLine(ctx, line, letterSpacing, fontSize));
			layoutWidth = measuredLines.reduce((max, line) => Math.max(max, line.width), 0);
			layoutHeight = ascent + descent + lineHeightPx * Math.max(lines.length - 1, 0);
			visibleLineCount = measuredLines.length;
		}

		const visibleLines = measuredLines.slice(0, visibleLineCount);
		let contentLeft = Infinity;
		let contentTop = Infinity;
		let contentRight = -Infinity;
		let contentBottom = -Infinity;
		let hasInk = false;

		if (boxMode === 'fixed') {
			contentLeft = 0;
			contentTop = 0;
			contentRight = layoutWidth;
			contentBottom = layoutHeight;
			// The box rect IS the content — glyph ink is clipped to it, so ink never
			// widens the canvas. Vertical align slides the ink block inside the box,
			// measured from the visible lines' actual ink (not the box-height union,
			// which would always clamp the offset to zero).
			if (visibleLineCount > 0) {
				let textInkTop = Infinity;
				let textInkBottom = -Infinity;
				visibleLines.forEach((line, index) => {
					const baselineY = ascent + index * lineHeightPx;
					textInkTop = Math.min(textInkTop, baselineY - line.ascent);
					textInkBottom = Math.max(textInkBottom, baselineY + line.descent);
				});
				contentOffsetY = this.getVerticalAlignOffset(
					layer.textData.verticalAlign || 'top',
					layoutHeight,
					textInkBottom - textInkTop
				) - textInkTop;
			}
		} else {
			visibleLines.forEach((line, index) => {
				if (!line.text) return;
				const offsetX = this.getAlignOffset(layer.textData.align, layoutWidth, line.width);
				const baselineY = ascent + index * lineHeightPx;
				hasInk = true;
				contentLeft = Math.min(contentLeft, offsetX - line.inkLeft);
				contentRight = Math.max(contentRight, offsetX + line.inkRight);
				contentTop = Math.min(contentTop, baselineY - line.ascent);
				contentBottom = Math.max(contentBottom, baselineY + line.descent);
			});

			if (!hasInk) {
				contentLeft = 0;
				contentTop = 0;
				contentRight = 0;
				contentBottom = 0;
			}
		}

		const inkLeft = contentLeft - (borderWidth + Math.max(0, -shadowOffsetX));
		const inkRight = contentRight + borderWidth + Math.max(0, shadowOffsetX);
		const inkTop = contentTop - (borderWidth + Math.max(0, -shadowOffsetY));
		const inkBottom = contentBottom + borderWidth + Math.max(0, shadowOffsetY);

		const layoutX = padding - inkLeft;
		const layoutY = padding - inkTop;
		const canvasWidth = Math.max(1, Math.ceil(inkRight - inkLeft + padding * 2));
		const canvasHeight = Math.max(1, Math.ceil(inkBottom - inkTop + padding * 2));
		const canvas = document.createElement('canvas');
		canvas.width = canvasWidth;
		canvas.height = canvasHeight;

		const maskCtx = canvas.getContext('2d', { willReadFrequently: true });
		maskCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		maskCtx.fillStyle = '#ffffff';
		maskCtx.font = this.getFontDeclaration(font, fontSize, layer.textData.fontWeight, layer.textData.fontStyle);
		maskCtx.textBaseline = 'alphabetic';
		maskCtx.textAlign = 'left';

		if (boxMode === 'fixed') {
			maskCtx.save();
			maskCtx.beginPath();
			maskCtx.rect(layoutX, layoutY, layoutWidth, layoutHeight);
			maskCtx.clip();
		}

		measuredLines.forEach((line, index) => {
			this.drawLine(maskCtx, line.text, {
				startX: layoutX + this.getAlignOffset(layer.textData.align, layoutWidth, line.width),
				baselineY: layoutY + contentOffsetY + ascent + index * lineHeightPx,
				letterSpacing
			});
		});

		if (boxMode === 'fixed') {
			maskCtx.restore();
		}

		if (CONFIG.rendering?.crispMaskEdges !== false) {
			// Hard pixel edges (editor aesthetic, MASK-FEATURE-PLAN decision 5).
			// Also load-bearing for export: fillText antialiasing leaves partial-alpha
			// edge pixels that composite over the GIF transparency key (magenta) and
			// fringe on transparent exports. A binary mask has nothing to blend.
			const maskImage = maskCtx.getImageData(0, 0, canvasWidth, canvasHeight);
			const maskData = maskImage.data;
			for (let i = 3; i < maskData.length; i += 4) {
				maskData[i] = maskData[i] >= 128 ? 255 : 0;
			}
			maskCtx.putImageData(maskImage, 0, 0);
		}

		const entry = {
			key,
			canvas,
			lines: measuredLines,
			width: canvasWidth,
			height: canvasHeight,
			textWidth: layoutWidth,
			textHeight: layoutHeight,
			ascent,
			lineHeightPx,
			layoutWidth,
			layoutHeight,
			layoutOffsetX: layoutX,
			layoutOffsetY: layoutY,
			boxMode,
			contentOffsetY,
			hasOverflow,
			// The user-facing frame: the text box in fixed mode, the visible art
			// (ink + border/shadow) in point mode. Handles, selection outline, and
			// hit-testing all use this instead of the padded canvas.
			frameRect: boxMode === 'fixed'
				? { x: layoutX, y: layoutY, width: layoutWidth, height: layoutHeight }
				: { x: layoutX + inkLeft, y: layoutY + inkTop, width: inkRight - inkLeft, height: inkBottom - inkTop },
			paddingBox: {
				top: Math.floor(layoutY),
				right: Math.floor(canvasWidth - layoutX - layoutWidth),
				bottom: Math.floor(canvasHeight - layoutY - layoutHeight),
				left: Math.floor(layoutX)
			}
		};

		this.textMaskCache.set(key, entry);
		layer.textData.width = canvasWidth;
		layer.textData.height = canvasHeight;
		return entry;
	}

	// The user-facing frame in text-local units, centered relative to the mask
	// canvas: the text box in fixed mode, the visible art bounds in point mode.
	getTextFrame(layer, measurement = null) {
		this.normalizeLayer(layer);
		if (!layer?.textData) return null;

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

	getFixedBoxFrame(layer, measurement = null) {
		this.normalizeLayer(layer);
		if (!layer?.textData || (layer.textData.boxMode || 'auto') !== 'fixed') {
			return null;
		}
		return this.getTextFrame(layer, measurement);
	}

	getAlignOffset(align, maxWidth, lineWidth) {
		if (align === 'center') return (maxWidth - lineWidth) / 2;
		if (align === 'right') return maxWidth - lineWidth;
		return 0;
	}

	getVerticalAlignOffset(verticalAlign, boxHeight, contentHeight) {
		if (verticalAlign === 'middle') {
			return Math.max(0, (boxHeight - contentHeight) / 2);
		}
		if (verticalAlign === 'bottom') {
			return Math.max(0, boxHeight - contentHeight);
		}
		return 0;
	}

	measureLine(ctx, text, letterSpacing, fontSize) {
		if (!text) {
			return { text, width: 0, ascent: 0, descent: 0, inkLeft: 0, inkRight: 0 };
		}

		const lineMetrics = ctx.measureText(text);
		const ascent = lineMetrics.actualBoundingBoxAscent ?? fontSize * 0.8;
		const descent = lineMetrics.actualBoundingBoxDescent ?? fontSize * 0.2;

		if (!letterSpacing) {
			return {
				text,
				width: lineMetrics.width,
				ascent,
				descent,
				inkLeft: lineMetrics.actualBoundingBoxLeft ?? 0,
				inkRight: lineMetrics.actualBoundingBoxRight ?? lineMetrics.width
			};
		}

		let advance = 0;
		let minX = Infinity;
		let maxX = -Infinity;
		for (let index = 0; index < text.length; index++) {
			const charMetrics = ctx.measureText(text[index]);
			minX = Math.min(minX, advance - (charMetrics.actualBoundingBoxLeft ?? 0));
			maxX = Math.max(maxX, advance + (charMetrics.actualBoundingBoxRight ?? charMetrics.width));
			advance += charMetrics.width;
			if (index < text.length - 1) {
				advance += letterSpacing;
			}
		}

		return { text, width: advance, ascent, descent, inkLeft: -minX, inkRight: maxX };
	}

	wrapTextLines(ctx, sourceLines, boxWidth, letterSpacing, fontSize) {
		const wrappedLines = [];

		sourceLines.forEach((sourceLine) => {
			if (sourceLine === '') {
				wrappedLines.push(this.measureLine(ctx, '', letterSpacing, fontSize));
				return;
			}

			const tokens = sourceLine.split(/(\s+)/);
			let current = '';

			const pushMeasured = (value) => {
				wrappedLines.push(this.measureLine(ctx, value, letterSpacing, fontSize));
			};

			for (const token of tokens) {
				if (token === '') continue;

				const candidate = current + token;
				if (!current || this.measureLine(ctx, candidate, letterSpacing, fontSize).width <= boxWidth) {
					current = candidate;
					continue;
				}

				if (/^\s+$/.test(token)) {
					pushMeasured(current.trimEnd());
					current = '';
					continue;
				}

				if (current.trim().length > 0) {
					pushMeasured(current.trimEnd());
					current = '';
				}

				let remaining = token;
				while (remaining) {
					let slice = '';
					let consumed = 0;
					for (let index = 0; index < remaining.length; index++) {
						const next = slice + remaining[index];
						const width = this.measureLine(ctx, next, letterSpacing, fontSize).width;
						if (slice && width > boxWidth) {
							break;
						}
						slice = next;
						consumed = index + 1;
						if (width > boxWidth) {
							break;
						}
					}

					if (!slice) {
						slice = remaining[0];
						consumed = 1;
					}

					const rest = remaining.slice(consumed);
					if (rest) {
						pushMeasured(slice);
						remaining = rest;
					} else {
						current = slice;
						remaining = '';
					}
				}
			}

			if (current || wrappedLines.length === 0) {
				pushMeasured(current.trimEnd());
			}
		});

		return { lines: wrappedLines };
	}

	drawLine(ctx, text, options) {
		const { startX, baselineY, letterSpacing } = options;

		if (!letterSpacing) {
			ctx.fillText(text, startX, baselineY);
			return;
		}

		let x = startX;
		for (let index = 0; index < text.length; index++) {
			const char = text[index];
			ctx.fillText(char, x, baselineY);
			x += ctx.measureText(char).width;
			if (index < text.length - 1) {
				x += letterSpacing;
			}
		}
	}

	async renderTextMask(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER) {
			throw new Error('Invalid text layer');
		}

		await this.ensureFontLoaded(layer.textData.fontId);
		return this.getMeasurementEntry(layer).canvas;
	}

	renderContent(layersToShow) {
		const keep = new Set();
		layersToShow.forEach((layer) => {
			if (layer.type === LayerType.TEXT_GLITTER) {
				keep.add(layer.id);
			}
		});

		Array.from(this.layerElements.keys()).forEach((layerId) => {
			if (!keep.has(layerId)) {
				this.removeLayerElement(layerId);
			}
		});

		layersToShow.forEach((layer) => {
			if (layer.type === LayerType.TEXT_GLITTER) {
				this.renderLayer(layer);
			}
		});
	}

	renderLayer(layer) {
		if (layer.type !== LayerType.TEXT_GLITTER) return;
		this.normalizeLayer(layer);

		if (!layer.textData.text.trim()) {
			this.removeLayerElement(layer.id);
			return;
		}

		const fillGlitter = this.editor.glitterManager.getItemById(layer.selectedGlitterId);
		if (!fillGlitter) {
			this.removeLayerElement(layer.id);
			return;
		}

		let wrapper = this.layerElements.get(layer.id);
		let stack = wrapper?.querySelector('.text-glitter-stack');

		if (!wrapper) {
			wrapper = document.createElement('div');
			wrapper.className = 'text-glitter-element';
			wrapper.dataset.layerId = layer.id;
			wrapper.setAttribute('role', 'img');
		}

		if (!stack) {
			stack = document.createElement('div');
			stack.className = 'text-glitter-stack';
			wrapper.replaceChildren(stack);
		}

		wrapper.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);

		if (!this.fontFaces.has(layer.textData.fontId)) {
			wrapper.style.visibility = 'hidden';
		}

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

		this.ensureFontLoaded(layer.textData.fontId)
			.then(() => {
				if (!this.layerElements.has(layer.id)) return;

				const measurement = this.getMeasurementEntry(layer);
				if (layer._pendingPointAnchorTarget && measurement.boxMode === 'auto') {
					this.setPointAnchorWorldPosition(layer, layer._pendingPointAnchorTarget, this.getTextFrame(layer, measurement));
					delete layer._pendingPointAnchorTarget;
				}
				this.reconcileTextSpans(stack, layer, measurement);
				wrapper.classList.toggle('text-overflowing', Boolean(measurement.hasOverflow));

				const transform = this.layerTransforms.get(layer.id);
				if (transform) {
					transform.layer = layer;
					transform.element = wrapper;
					transform.applyTransform(wrapper, {
						width: layer.textData.width,
						height: layer.textData.height
					});

					if (
						layer.id === this.editor.layerManager.activeLayerId &&
						this.editor.currentTool === ToolType.SELECT &&
						!this.editor.layerManager.hasMultiSelection()
					) {
						if (!transform.isDraggingHandle) {
							transform.createTransformHandles();
						}
					} else {
						transform.removeTransformHandles();
					}
				}

				wrapper.setAttribute('aria-label', layer.textData.text);
				wrapper.style.visibility = '';
				this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);
			})
			.catch((error) => {
				wrapper.style.visibility = 'hidden';
				this.reportFontLoadError(error);
			});
	}

	reconcileTextSpans(stack, layer, measurement) {
		this.syncStackGeometry(stack, layer, measurement);

		const descriptors = this.getSpanDescriptors(layer, measurement);
		const existing = new Map();
		Array.from(stack.children).forEach((child) => {
			if (child.dataset.spanKey) {
				existing.set(child.dataset.spanKey, child);
			}
		});

		descriptors.forEach((descriptor) => {
			let span = existing.get(descriptor.key);
			if (!span) {
				span = document.createElement('span');
				span.className = 'text-glitter-content';
				span.dataset.spanKey = descriptor.key;
			}

			span.textContent = '';
			span.dataset.maskType = descriptor.maskType;
			const maskUrl = this.getPreviewMaskDataUrl(
				layer,
				descriptor.maskType,
				descriptor.maskCanvas,
				descriptor.maskCacheKey
			);
			this.applyTextStyles(span, measurement, maskUrl);
			this.applySpanOffset(span, descriptor.offsetX, descriptor.offsetY);
			this.applyPaintSource(span, descriptor.source, layer);
			stack.appendChild(span);
			existing.delete(descriptor.key);
		});

		existing.forEach((span) => span.remove());
	}

	// The stack is a local-space surface: sized to the mask canvas in text-local px
	// and scaled by CSS transform. That way the glyphs, padding, and clip actually
	// scale with the layer (the wrapper only sizes the display box), matching the
	// export path which scales the whole rendered canvas.
	syncStackGeometry(stack, layer, measurement = null) {
		if (!stack || !layer?.textData) return;

		const entry = measurement || this.getMeasurementEntry(layer);
		const scaleX = (layer.textData.transform.scale.x || 100) / 100;
		const scaleY = (layer.textData.transform.scale.y || 100) / 100;

		stack.style.width = `${entry.width}px`;
		stack.style.height = `${entry.height}px`;
		stack.style.transform = `scale(${scaleX}, ${scaleY})`;
		stack.style.setProperty('--layer-scale', String(Math.max(scaleX, scaleY) || 1));

		const rect = entry.frameRect;
		if (rect) {
			stack.style.setProperty('--tf-top', `${rect.y}px`);
			stack.style.setProperty('--tf-left', `${rect.x}px`);
			stack.style.setProperty('--tf-right', `${entry.width - rect.x - rect.width}px`);
			stack.style.setProperty('--tf-bottom', `${entry.height - rect.y - rect.height}px`);
		}
	}

	// Called by LayerTransform.applyTransform so the stack scale stays live
	// during handle drags (which bypass renderLayer for performance).
	syncElementScale(layer, wrapper = this.layerElements.get(layer?.id)) {
		const stack = wrapper?.querySelector('.text-glitter-stack');
		// System fonts are resolved by the browser and deliberately have no
		// FontFace cache entry. Their existing stack can still scale live.
		if (!stack) return;
		this.syncStackGeometry(stack, layer);
	}

	getSpanDescriptors(layer, measurement) {
		const descriptors = [];
		const shadow = this.getEffectData(layer, 'shadow');
		const border = this.getEffectData(layer, 'border');
		const drawBorderAfterFill = this.getBorderDrawOrder(border) === 'front';

		if (shadow) {
			descriptors.push({
				key: 'shadow',
				offsetX: shadow.offsetX || 0,
				offsetY: shadow.offsetY || 0,
				source: this.getEffectPaintSource(layer, 'shadow'),
				maskType: 'fill',
				maskCanvas: measurement.canvas,
				maskCacheKey: measurement.key
			});
		}

		const borderDescriptor = border?.widthPx > 0
			? (() => {
				const { canvas: borderCanvas, cacheKey: borderCacheKey } = this.getBorderMaskCanvas(layer, measurement, border);
				return {
					key: 'border',
					offsetX: 0,
					offsetY: 0,
					source: this.getEffectPaintSource(layer, 'border'),
					maskType: 'border',
					maskCanvas: borderCanvas,
					maskCacheKey: borderCacheKey
				};
			})()
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
				maskType: 'fill',
				maskCanvas: measurement.canvas,
				maskCacheKey: measurement.key
			});
		}

		if (borderDescriptor && drawBorderAfterFill) {
			descriptors.push(borderDescriptor);
		}

		return descriptors;
	}

	// One continuous stroke, like a Photoshop stroke: stamp the glyph mask at
	// N angles around a ring onto a single canvas (union, not N separate
	// layers), then texture that one shape once. Mirrors
	// GifExporter._createBorderMaskCanvas so the live preview matches export.
	getBorderMaskCanvas(layer, measurement, borderData = this.getEffectData(layer, 'border')) {
		const widthPx = Math.max(0, borderData?.widthPx || 0);
		const placement = this.getBorderPlacement(borderData);
		const edgeStyle = this.getBorderEdgeStyle(borderData);
		const cacheKey = `border:${widthPx}:${placement}:${edgeStyle}`;

		if (measurement._borderMaskCache?.key === cacheKey) {
			return { canvas: measurement._borderMaskCache.canvas, cacheKey: `${measurement.key}|${cacheKey}` };
		}

		const fillMask = measurement.canvas;
		let canvas = null;

		if (widthPx > 0) {
			if (placement === 'inside') {
				canvas = this.createMaskDifferenceCanvas(
					fillMask,
					this.createErodedMaskCanvas(fillMask, widthPx, edgeStyle)
				);
			} else if (placement === 'center') {
				canvas = this.createMaskDifferenceCanvas(
					this.createDilatedMaskCanvas(fillMask, Math.ceil(widthPx / 2), edgeStyle),
					this.createErodedMaskCanvas(fillMask, Math.floor(widthPx / 2), edgeStyle)
				);
			} else {
				canvas = this.createMaskDifferenceCanvas(
					this.createDilatedMaskCanvas(fillMask, widthPx, edgeStyle),
					fillMask
				);
			}
		}

		measurement._borderMaskCache = { key: cacheKey, canvas };
		return { canvas, cacheKey: `${measurement.key}|${cacheKey}` };
	}

	// Shared with GifExporter via resolveEffectPaintSource so preview/export stay aligned.
	getEffectPaintSource(layer, effectName) {
		if (effectName === 'fill') {
			return resolveEffectPaintSource(this.ensureEffectData(layer, 'fill'), {
				allowNone: true,
				glitterId: layer.selectedGlitterId,
				scale: layer.settings.scale ?? 100,
				opacity: layer.settings.opacity ?? 100,
				colorAdjust: layer.settings.colorAdjust
			});
		}

		return resolveEffectPaintSource(this.getEffectData(layer, effectName), {
			glitterAvailable: (glitterId) => Boolean(this.editor.glitterManager.getItemById(glitterId))
		});
	}

	createMaskDifferenceCanvas(baseCanvas, subtractCanvas) {
		const canvas = document.createElement('canvas');
		canvas.width = baseCanvas.width;
		canvas.height = baseCanvas.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(baseCanvas, 0, 0);
		if (subtractCanvas) {
			ctx.globalCompositeOperation = 'destination-out';
			ctx.drawImage(subtractCanvas, 0, 0);
			ctx.globalCompositeOperation = 'source-over';
		}
		return canvas;
	}

	createDilatedMaskCanvas(sourceCanvas, radius, edgeStyle = 'round') {
		const nextRadius = Math.max(0, Math.round(radius));
		if (nextRadius <= 0) {
			return sourceCanvas;
		}

		if (edgeStyle === 'hard') {
			const horizontal = document.createElement('canvas');
			horizontal.width = sourceCanvas.width;
			horizontal.height = sourceCanvas.height;
			const horizontalCtx = horizontal.getContext('2d', { willReadFrequently: true });
			for (let offsetX = -nextRadius; offsetX <= nextRadius; offsetX++) {
				horizontalCtx.drawImage(sourceCanvas, offsetX, 0);
			}

			const canvas = document.createElement('canvas');
			canvas.width = sourceCanvas.width;
			canvas.height = sourceCanvas.height;
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			for (let offsetY = -nextRadius; offsetY <= nextRadius; offsetY++) {
				ctx.drawImage(horizontal, 0, offsetY);
			}
			return canvas;
		}

		const canvas = document.createElement('canvas');
		canvas.width = sourceCanvas.width;
		canvas.height = sourceCanvas.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(sourceCanvas, 0, 0);
		this.getMorphOffsets(nextRadius).forEach((offset) => {
			ctx.drawImage(sourceCanvas, offset.x, offset.y);
		});
		return canvas;
	}

	createErodedMaskCanvas(sourceCanvas, radius, edgeStyle = 'round') {
		const nextRadius = Math.max(0, Math.round(radius));
		if (nextRadius <= 0) {
			return sourceCanvas;
		}

		if (edgeStyle === 'hard') {
			const horizontal = document.createElement('canvas');
			horizontal.width = sourceCanvas.width;
			horizontal.height = sourceCanvas.height;
			const horizontalCtx = horizontal.getContext('2d', { willReadFrequently: true });
			horizontalCtx.drawImage(sourceCanvas, 0, 0);
			horizontalCtx.globalCompositeOperation = 'destination-in';
			for (let offsetX = -nextRadius; offsetX <= nextRadius; offsetX++) {
				if (offsetX === 0) continue;
				horizontalCtx.drawImage(sourceCanvas, -offsetX, 0);
			}
			horizontalCtx.globalCompositeOperation = 'source-over';

			const canvas = document.createElement('canvas');
			canvas.width = sourceCanvas.width;
			canvas.height = sourceCanvas.height;
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			ctx.drawImage(horizontal, 0, 0);
			ctx.globalCompositeOperation = 'destination-in';
			for (let offsetY = -nextRadius; offsetY <= nextRadius; offsetY++) {
				if (offsetY === 0) continue;
				ctx.drawImage(horizontal, 0, -offsetY);
			}
			ctx.globalCompositeOperation = 'source-over';
			return canvas;
		}

		const canvas = document.createElement('canvas');
		canvas.width = sourceCanvas.width;
		canvas.height = sourceCanvas.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(sourceCanvas, 0, 0);
		ctx.globalCompositeOperation = 'destination-in';
		this.getMorphOffsets(nextRadius).forEach((offset) => {
			ctx.drawImage(sourceCanvas, -offset.x, -offset.y);
		});
		ctx.globalCompositeOperation = 'source-over';
		return canvas;
	}

	getMorphOffsets(widthPx) {
		const radius = Math.max(1, widthPx);
		// Sample count scales with the border radius so the outer envelope of the
		// unioned copies stays smooth (few steps = visible scalloping on wide
		// borders). Kept in lockstep with GifExporter._createBorderMaskCanvas.
		const borderSampling = CONFIG.rendering?.borderSampling || {};
		const steps = Math.max(
			borderSampling.minSteps ?? 16,
			Math.min(
				borderSampling.maxSteps ?? 64,
				Math.ceil(radius * (borderSampling.stepsPerPixel ?? 4))
			)
		);
		const seen = new Set();
		const offsets = [];

		for (let index = 0; index < steps; index++) {
			const angle = (Math.PI * 2 * index) / steps;
			const x = Math.round(Math.cos(angle) * radius);
			const y = Math.round(Math.sin(angle) * radius);
			const key = `${x},${y}`;
			if (seen.has(key) || (x === 0 && y === 0)) {
				continue;
			}
			seen.add(key);
			offsets.push({ x, y });
		}

		return offsets;
	}

	applyTextStyles(span, measurement, maskObjectUrl) {
		// Vertical align is baked into padding-top (not the translate) so the
		// box clip below stays fixed while the text slides inside it — same as
		// the canvas path, which shifts baselines inside a fixed clip rect.
		span.style.display = 'block';
		span.style.width = `${measurement.width}px`;
		span.style.height = `${measurement.height}px`;
		span.style.padding = '0';
		span.style.maskSize = `${measurement.width}px ${measurement.height}px`;
		span.style.maskRepeat = 'no-repeat';
		span.style.maskPosition = '0 0';
		span.style.webkitMaskSize = `${measurement.width}px ${measurement.height}px`;
		span.style.webkitMaskRepeat = 'no-repeat';
		span.style.webkitMaskPosition = '0 0';

		// Clip at the box rect exactly like the export mask. clip-path is applied
		// before the span's translate, so effect spans (shadow/border offsets)
		// carry their clip with them — identical to the export's offset copies
		// of the box-clipped mask.
		if (maskObjectUrl) {
			span.style.maskImage = `url(${maskObjectUrl})`;
			span.style.webkitMaskImage = `url(${maskObjectUrl})`;
			span.style.visibility = '';
		} else {
			span.style.visibility = 'hidden';
		}
	}

	applySpanOffset(span, offsetX = 0, offsetY = 0) {
		const x = offsetX || 0;
		const y = offsetY || 0;
		span.style.transform = (x || y)
			? `translate(${x}px, ${y}px)`
			: 'none';
	}

	applyPaintSource(span, source, layer) {
		if (!source) {
			span.style.backgroundImage = 'none';
			span.style.backgroundColor = 'transparent';
			span.style.backgroundSize = '';
			span.style.opacity = '1';
			span.classList.remove('pixelated');
			return;
		}

		if (source.mode === 'solid' || source.mode === 'gradient') {
			span.style.backgroundImage = source.mode === 'gradient' ? effectGradientToCss(source.gradient) : 'none';
			span.style.backgroundColor = source.mode === 'solid' ? source.color : 'transparent';
			span.style.backgroundSize = '';
			span.style.opacity = String(source.opacity ?? 1);
			span.style.filter = '';
			span.classList.remove('pixelated');
			return;
		}

		const glitter = this.editor.glitterManager.getItemById(source.glitterId);
		if (!glitter) {
			this.applyPaintSource(span, { mode: 'solid', color: '#000000', opacity: 1 }, layer);
			return;
		}

		span.style.backgroundImage = `url(${glitter.url})`;
		span.style.backgroundColor = 'transparent';
		span.style.opacity = String(source.opacity ?? 1);
		// Color adjust (WP4): CSS filter mirrors the export matrix pass per slot.
		span.style.filter = buildCssColorFilter(source.colorAdjust);

		const glitterScale = (source.scale ?? 100) / 100;
		const baseSize = glitter.frames?.width || glitter.width || 50;
		span.style.backgroundSize = `${Math.round(baseSize * glitterScale)}px`;
		span.classList.toggle('pixelated', Boolean(glitter.isPixelated));
	}

	updateExistingBackground(layer) {
		this.renderLayer(layer);
	}

	updateLiveTextContent(layerId, text) {
		const wrapper = this.layerElements.get(layerId);
		if (!wrapper) return;

		wrapper.setAttribute('aria-label', text);
	}

	async refreshLayer(layer, options = {}) {
		const {
			saveHistory = false,
			refreshLayerList = true,
			refreshPreview = true,
			preservePointAnchorFrom = null
		} = options;

		this.normalizeLayer(layer);
		await this.ensureFontLoaded(layer.textData.fontId);
		const measurement = this.getMeasurementEntry(layer);
		if (preservePointAnchorFrom) {
			this.applyPointAnchorSnapshot(layer, preservePointAnchorFrom, measurement);
		}
		layer._pendingPointAnchorSnapshot = null;

		if (refreshPreview) {
			this.editor.updatePreview();
		} else {
			this.renderLayer(layer);
		}

		if (refreshLayerList) {
			this.editor.layerManager.renderLayersList();
		}

		this.loadLayerSettings(layer);
		this.editor.updateActionButtons();
		this.editor.updateHelpfulMessage();

		if (saveHistory) {
			this.editor.saveState();
		}
	}

	canResizeBoxEdges(layer) {
		this.normalizeLayer(layer);
		return Boolean(layer?.type === LayerType.TEXT_GLITTER && layer.textData?.boxMode === 'fixed');
	}

	getBoxResizeMetrics(layer, dragState) {
		const rotationRad = -(dragState.transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);
		const worldRotationRad = (dragState.transform.rotation * Math.PI) / 180;
		const worldCos = Math.cos(worldRotationRad);
		const worldSin = Math.sin(worldRotationRad);
		const minBoxSize = this.getMinBoxSize();
		const scaleX = Math.max(0.01, (dragState.transform.scale.x || 100) / 100);
		const scaleY = Math.max(0.01, (dragState.transform.scale.y || 100) / 100);
		const boxWidth = Math.max(minBoxSize, Math.round(dragState.boxWidth || layer.textData.boxWidth || minBoxSize));
		const boxHeight = Math.max(minBoxSize, Math.round(dragState.boxHeight || layer.textData.boxHeight || minBoxSize));
		const frame = dragState.textBoxFrame || this.getFixedBoxFrame(layer) || { offsetX: 0, offsetY: 0 };
		const baseDisplayWidth = boxWidth * scaleX;
		const baseDisplayHeight = boxHeight * scaleY;
		const minDisplayWidth = minBoxSize * scaleX;
		const minDisplayHeight = minBoxSize * scaleY;
		// Frame offsets are text-local units; scale them into display space.
		const originWorldX = dragState.transform.position.x + frame.offsetX * scaleX * worldCos - frame.offsetY * scaleY * worldSin;
		const originWorldY = dragState.transform.position.y + frame.offsetX * scaleX * worldSin + frame.offsetY * scaleY * worldCos;
		return {
			rotationRad,
			cos,
			sin,
			worldRotationRad,
			worldCos,
			worldSin,
			minBoxSize,
			scaleX,
			scaleY,
			minDisplayWidth,
			minDisplayHeight,
			baseDisplayWidth,
			baseDisplayHeight,
			originWorldX,
			originWorldY
		};
	}

	applyResizedBoxRect(layer, dragState, rect, metrics) {
		const nextBoxWidth = Math.max(metrics.minBoxSize, Math.round((rect.right - rect.left) / metrics.scaleX));
		const nextBoxHeight = Math.max(metrics.minBoxSize, Math.round((rect.bottom - rect.top) / metrics.scaleY));
		const newCenterLocalX = (rect.left + rect.right) / 2;
		const newCenterLocalY = (rect.top + rect.bottom) / 2;

		layer.textData.boxMode = 'fixed';
		layer.textData.boxWidth = nextBoxWidth;
		layer.textData.boxHeight = nextBoxHeight;
		const measurement = this.getMeasurementEntry(layer);
		const desiredFrameCenterX = metrics.originWorldX + newCenterLocalX * metrics.worldCos - newCenterLocalY * metrics.worldSin;
		const desiredFrameCenterY = metrics.originWorldY + newCenterLocalX * metrics.worldSin + newCenterLocalY * metrics.worldCos;
		const nextFrame = this.getFixedBoxFrame(layer, measurement) || { offsetX: 0, offsetY: 0 };
		const nextOffsetX = nextFrame.offsetX * metrics.scaleX;
		const nextOffsetY = nextFrame.offsetY * metrics.scaleY;

		layer.textData.transform.position.x = desiredFrameCenterX - (nextOffsetX * metrics.worldCos - nextOffsetY * metrics.worldSin);
		layer.textData.transform.position.y = desiredFrameCenterY - (nextOffsetX * metrics.worldSin + nextOffsetY * metrics.worldCos);

		const transform = this.layerTransforms.get(layer.id);
		if (transform) {
			transform.element = this.layerElements.get(layer.id) || transform.element;
			this.renderLayer(layer);
			transform.applyTransform(transform.element, {
				width: measurement.width,
				height: measurement.height
			});
			transform.updateHandlePositions();
		} else {
			this.renderLayer(layer);
		}

		this.loadLayerSettings(layer);
		this.editor.updateHelpfulMessage();
		return true;
	}

	resizeBoxFromHandle(layer, edge, dragState, canvasPos) {
		if (!this.canResizeBoxEdges(layer)) {
			return false;
		}

		const metrics = this.getBoxResizeMetrics(layer, dragState);
		const vectorX = canvasPos.x - metrics.originWorldX;
		const vectorY = canvasPos.y - metrics.originWorldY;
		const localX = vectorX * metrics.cos - vectorY * metrics.sin;
		const localY = vectorX * metrics.sin + vectorY * metrics.cos;

		const rect = {
			left: -metrics.baseDisplayWidth / 2,
			right: metrics.baseDisplayWidth / 2,
			top: -metrics.baseDisplayHeight / 2,
			bottom: metrics.baseDisplayHeight / 2
		};

		if (edge === 'right') {
			rect.right = Math.max(localX, rect.left + metrics.minDisplayWidth);
		} else if (edge === 'left') {
			rect.left = Math.min(localX, rect.right - metrics.minDisplayWidth);
		} else if (edge === 'bottom') {
			rect.bottom = Math.max(localY, rect.top + metrics.minDisplayHeight);
		} else if (edge === 'top') {
			rect.top = Math.min(localY, rect.bottom - metrics.minDisplayHeight);
		} else if (edge === 'tl') {
			rect.left = Math.min(localX, rect.right - metrics.minDisplayWidth);
			rect.top = Math.min(localY, rect.bottom - metrics.minDisplayHeight);
		} else if (edge === 'tr') {
			rect.right = Math.max(localX, rect.left + metrics.minDisplayWidth);
			rect.top = Math.min(localY, rect.bottom - metrics.minDisplayHeight);
		} else if (edge === 'br') {
			rect.right = Math.max(localX, rect.left + metrics.minDisplayWidth);
			rect.bottom = Math.max(localY, rect.top + metrics.minDisplayHeight);
		} else if (edge === 'bl') {
			rect.left = Math.min(localX, rect.right - metrics.minDisplayWidth);
			rect.bottom = Math.max(localY, rect.top + metrics.minDisplayHeight);
		} else {
			return false;
		}

		return this.applyResizedBoxRect(layer, dragState, rect, metrics);
	}

	setBoxSize(layer, width, height) {
		if (!this.canResizeBoxEdges(layer)) {
			return false;
		}

		const worldCenter = this.getFrameCenterWorldPosition(layer);
		const minBoxSize = this.getMinBoxSize();
		layer.textData.boxWidth = Math.max(minBoxSize, Math.round(width));
		layer.textData.boxHeight = Math.max(minBoxSize, Math.round(height));
		const measurement = this.getMeasurementEntry(layer);
		const nextFrame = this.getFixedBoxFrame(layer, measurement);
		if (nextFrame) {
			this.setFrameCenterWorldPosition(layer, worldCenter, nextFrame);
		}

		this.renderLayer(layer);
		this.loadLayerSettings(layer);
		this.editor.layerManager.renderLayersList();
		this.editor.updateHelpfulMessage();
		return true;
	}

	async commitScaleToFontSize(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER) return;

		this.normalizeLayer(layer);
		const transform = getLayerTransform(layer);
		const scaleX = Math.max(0.01, (transform.scale.x || 100) / 100);
		const scaleY = Math.max(0.01, (transform.scale.y || 100) / 100);
		const scaleFactor = Math.min(scaleX, scaleY);
		if (Math.abs(scaleFactor - 1) < 1e-3 && Math.abs(scaleY - 1) < 1e-3) {
			transform.scale.x = 100;
			transform.scale.y = 100;
			transform.proportionalScale = true;
			return;
		}

		const worldCenter = this.getFrameCenterWorldPosition(layer);
		layer.textData.fontSize = Math.max(
			CONFIG.tools.text.minFontSize,
			Math.min(CONFIG.tools.text.maxFontSize, Math.round(layer.textData.fontSize * scaleFactor))
		);
		transform.scale.x = (scaleX / scaleFactor) * 100;
		transform.scale.y = (scaleY / scaleFactor) * 100;
		transform.proportionalScale = true;

		const measurement = this.getMeasurementEntry(layer);
		const nextFrame = this.getTextFrame(layer, measurement);
		if (nextFrame) {
			this.setFrameCenterWorldPosition(layer, worldCenter, nextFrame);
		}

		try {
			await this.refreshLayer(layer, {
				saveHistory: false,
				refreshLayerList: false
			});
		} catch (error) {
			this.reportFontLoadError(error);
		}
	}

	createTransformHandles(layerId) {
		movableCreateTransformHandles(this, layerId);
	}

	// ===== TRANSFORM UPDATES (Delegation to LayerTransform, mirrors StickerManager) =====

	updateTransform(layerId, updates) {
		const transform = this.layerTransforms.get(layerId);
		if (!transform) return;

		transform.updateTransform(updates);

		const element = this.layerElements.get(layerId);
		if (element) {
			transform.applyTransform(element, transform.getDimensions());

			if (transform.transformHandles) {
				transform.updateHandlePositions();
			}
		}
	}

	// ===== CENTERING METHODS (Delegation to LayerTransform, mirrors StickerManager) =====

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

	removeTransformHandles() {
		movableRemoveTransformHandles(this);
	}

	removeLayerElement(layerId) {
		const layer = this.editor.layerManager.getLayerById(layerId);
		if (layer) {
			this.revokePreviewMaskCache(layer);
		}

		const element = this.layerElements.get(layerId);
		if (element?.parentNode) {
			element.parentNode.removeChild(element);
		}

		const transform = this.layerTransforms.get(layerId);
		if (transform) {
			transform.destroy();
			this.layerTransforms.delete(layerId);
		}

		this.layerElements.delete(layerId);
	}

	clearElements() {
		// New document / image reset: no layer survives, so any armed picker
		// session is stale.
		this.closePickerSession();
		Array.from(this.layerElements.keys()).forEach((layerId) => {
			this.removeLayerElement(layerId);
		});
	}

	revokePreviewMaskCache(layer) {
		// Data URLs aren't allocated objects — nothing to revoke, just drop the cache.
		delete layer._previewMaskCache;
	}

	// Each mask "slot" (fill, border, ...) gets its own cached data URL — border
	// needs a different rasterized shape than fill, so they can't share one.
	// Synchronous (toDataURL, not toBlob+Image) so a live box-resize drag never
	// shows a stale mask stretched to the new box size while a blob decodes.
	getPreviewMaskDataUrl(layer, maskType, canvas, cacheKey) {
		if (!layer._previewMaskCache) {
			layer._previewMaskCache = {};
		}
		const bucket = layer._previewMaskCache;
		const cached = bucket[maskType];

		if (cached?.key === cacheKey) {
			return cached.url;
		}

		const url = canvas.toDataURL('image/png');
		bucket[maskType] = { key: cacheKey, url };
		return url;
	}
}
