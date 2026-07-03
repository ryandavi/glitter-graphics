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
		this.glitterSelectionTarget = 'fill';
	}

	async init() {
		this.setupUI();
		this.setupEventListeners();
	}

	setupUI() {
		this.ui = {
			section: document.getElementById('textSettingsSection'),
			textInput: document.getElementById('textLayerInput'),
			fontPicker: document.getElementById('textFontPicker'),
			fontSize: document.getElementById('textFontSize'),
			fontSizeValue: document.getElementById('textFontSizeValue'),
			letterSpacing: document.getElementById('textLetterSpacing'),
			letterSpacingValue: document.getElementById('textLetterSpacingValue'),
			lineHeight: document.getElementById('textLineHeight'),
			lineHeightValue: document.getElementById('textLineHeightValue'),
			fillGlitterChip: document.getElementById('textFillGlitterChip'),
			fillGlitterChange: document.getElementById('textFillGlitterChange'),
			fillGlitterLabel: document.getElementById('textFillGlitterLabel'),
			fillGlitterSwatch: document.getElementById('textFillGlitterSwatch'),
			textureScale: document.getElementById('textTextureScale'),
			textureScaleValue: document.getElementById('textTextureScaleValue'),
			textureOpacity: document.getElementById('textTextureOpacity'),
			textureOpacityValue: document.getElementById('textTextureOpacityValue'),
			alignButtons: Array.from(document.querySelectorAll('[data-text-align]')),
			verticalAlignButtons: Array.from(document.querySelectorAll('[data-text-valign]')),
			boxModeButtons: Array.from(document.querySelectorAll('[data-text-box-mode]')),
			boxModeHint: document.getElementById('textBoxModeHint'),
			borderEnabled: document.getElementById('textBorderEnabled'),
			borderControls: document.getElementById('textBorderControls'),
			borderWidth: document.getElementById('textBorderWidth'),
			borderWidthValue: document.getElementById('textBorderWidthValue'),
			borderColor: document.getElementById('textBorderColor'),
			borderColorRow: document.getElementById('textBorderColorRow'),
			borderSourceValue: document.getElementById('textBorderSourceValue'),
			borderGlitterChip: document.getElementById('textBorderGlitterChip'),
			borderGlitterChange: document.getElementById('textBorderGlitterChange'),
			borderGlitterLabel: document.getElementById('textBorderGlitterLabel'),
			borderGlitterSwatch: document.getElementById('textBorderGlitterSwatch'),
			borderUseColor: document.getElementById('textBorderUseColor'),
			borderUseGlitter: document.getElementById('textBorderUseGlitter'),
			shadowEnabled: document.getElementById('textShadowEnabled'),
			shadowControls: document.getElementById('textShadowControls'),
			shadowOffsetX: document.getElementById('textShadowOffsetX'),
			shadowOffsetXValue: document.getElementById('textShadowOffsetXValue'),
			shadowOffsetY: document.getElementById('textShadowOffsetY'),
			shadowOffsetYValue: document.getElementById('textShadowOffsetYValue'),
			shadowColor: document.getElementById('textShadowColor'),
			shadowColorRow: document.getElementById('textShadowColorRow'),
			shadowSourceValue: document.getElementById('textShadowSourceValue'),
			shadowGlitterChip: document.getElementById('textShadowGlitterChip'),
			shadowGlitterChange: document.getElementById('textShadowGlitterChange'),
			shadowGlitterLabel: document.getElementById('textShadowGlitterLabel'),
			shadowGlitterSwatch: document.getElementById('textShadowGlitterSwatch'),
			shadowUseColor: document.getElementById('textShadowUseColor'),
			shadowUseGlitter: document.getElementById('textShadowUseGlitter')
		};
	}

	setupEventListeners() {
		if (this.ui.textInput) {
			this.ui.textInput.addEventListener('input', () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;

				const value = this.ui.textInput.value.slice(0, CONFIG.textLayers.maxTextLength);
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

		this.attachSlider(this.ui.fontSize, this.ui.fontSizeValue, 'px', (value, layer) => {
			layer.textData.fontSize = value;
		}, CONFIG.textLayers.defaultFontSize);

		this.attachSlider(this.ui.letterSpacing, this.ui.letterSpacingValue, 'px', (value, layer) => {
			layer.textData.letterSpacing = value;
		}, CONFIG.textLayers.defaultLetterSpacing);

		this.attachSlider(this.ui.lineHeight, this.ui.lineHeightValue, '%', (value, layer) => {
			layer.textData.lineHeight = value / 100;
		}, Math.round(CONFIG.textLayers.lineHeight * 100));

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

					this.revealGlitterBrowser();
					this.editor.updateStatus('Pick a glitter for the text fill.');
				});
			});
		}

		this.attachSlider(this.ui.textureScale, this.ui.textureScaleValue, '%', (value, layer) => {
			layer.settings.scale = value;
		}, CONFIG.defaultScale, false);

		this.attachSlider(this.ui.textureOpacity, this.ui.textureOpacityValue, '%', (value, layer) => {
			layer.settings.opacity = value;
		}, CONFIG.defaultOpacity, false);

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

	getPointAnchorWorldPosition(layer, frame = this.getTextFrame(layer)) {
		if (!frame) {
			return { ...layer.textData.transform.position };
		}
		const localPoint = this.getFrameAnchorLocalPoint(frame, layer.textData.align || 'left');
		return this.getWorldPointFromLocal(layer.textData.transform, localPoint);
	}

	setPointAnchorWorldPosition(layer, worldPoint, frame = this.getTextFrame(layer)) {
		if (!worldPoint || !frame) return;

		const localPoint = this.getFrameAnchorLocalPoint(frame, layer.textData.align || 'left');
		const transform = layer.textData.transform;
		const scaleX = (transform.scale.x || 100) / 100;
		const scaleY = (transform.scale.y || 100) / 100;
		const rotationRad = (transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);

		transform.position.x = worldPoint.x - (localPoint.x * scaleX * cos - localPoint.y * scaleY * sin);
		transform.position.y = worldPoint.y - (localPoint.x * scaleX * sin + localPoint.y * scaleY * cos);
	}

	applyPointAnchorSnapshot(layer, snapshot, measurement = null) {
		if (!snapshot || !layer?.textData || (layer.textData.boxMode || 'auto') !== 'auto') {
			return;
		}

		const nextFrame = this.getTextFrame(layer, measurement);
		if (!nextFrame) return;
		this.setPointAnchorWorldPosition(layer, snapshot.world, nextFrame);
	}

	getDefaultBorder() {
		return {
			widthPx: 4,
			glitterId: null,
			color: '#000000'
		};
	}

	getDefaultShadow() {
		return {
			offsetX: 6,
			offsetY: 6,
			glitterId: null,
			color: '#000000'
		};
	}

	getMinBoxSize() {
		return Math.max(1, Math.round(CONFIG.textLayers.minBoxSize || 40));
	}

	normalizeLayer(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER || !layer.textData) return;
		if (layer.textData.border === undefined) {
			layer.textData.border = null;
		}
		if (layer.textData.shadow === undefined) {
			layer.textData.shadow = null;
		}
		if (!layer.textData.boxMode) {
			layer.textData.boxMode = CONFIG.textLayers.defaultBoxMode || 'auto';
		}
		if (!layer.textData.verticalAlign) {
			layer.textData.verticalAlign = CONFIG.textLayers.defaultVerticalAlign || 'top';
		}
		if (!layer.textData.lineHeight) {
			layer.textData.lineHeight = CONFIG.textLayers.lineHeight;
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

	ensureEffectData(layer, effectName) {
		this.normalizeLayer(layer);
		if (!layer?.textData) return null;

		if (!layer.textData[effectName]) {
			layer.textData[effectName] = effectName === 'border'
				? this.getDefaultBorder()
				: this.getDefaultShadow();
		}

		return layer.textData[effectName];
	}

	getEffectData(layer, effectName) {
		this.normalizeLayer(layer);
		return layer?.textData?.[effectName] || null;
	}

	getGlitterSelectionTarget(layer = this.getActiveTextLayer()) {
		const target = this.glitterSelectionTarget || 'fill';
		if (target === 'border' && !this.getEffectData(layer, 'border')) {
			return 'fill';
		}
		if (target === 'shadow' && !this.getEffectData(layer, 'shadow')) {
			return 'fill';
		}
		return target;
	}

	setGlitterSelectionTarget(target = 'fill', layer = this.getActiveTextLayer()) {
		this.glitterSelectionTarget = target;
		const resolvedTarget = this.getGlitterSelectionTarget(layer);
		this.glitterSelectionTarget = resolvedTarget;
		this.updateEffectTargetButtons(layer);
		this.editor.updateGlitterSelection();
	}

	revealGlitterBrowser() {
		this.editor.setCollapsibleSectionOpen?.('designGallery', true, true);
		const browser = document.getElementById('glitterOptions');
		browser?.scrollIntoView({
			block: 'nearest',
			inline: 'nearest',
			behavior: 'smooth'
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
						if (this.getGlitterSelectionTarget(layer) === effectName) {
							this.setGlitterSelectionTarget('fill', layer);
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

				this.revealGlitterBrowser();
				this.editor.updateStatus(`Border and shadow choose their own source. Pick a glitter for the ${effectName}.`);
			});
		});
	}

	bindEffectUseColor(button, effectName) {
		if (!button) return;

		button.addEventListener('click', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;

			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					const effectData = this.ensureEffectData(layer, effectName);
					effectData.glitterId = null;
					this.setGlitterSelectionTarget(effectName, layer);
				}, { saveHistory: true, refreshPreview: false });
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});
	}

	bindEffectUseGlitter(button, effectName) {
		if (!button) return;

		button.addEventListener('click', () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;

			this.ensureEffectData(layer, effectName);
			this.setGlitterSelectionTarget(effectName, layer);
			this.revealGlitterBrowser();
			this.editor.updateStatus(`Pick a glitter for the ${effectName}.`);
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
					this.setGlitterSelectionTarget(effectName, layer);
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

		const updateDisplay = (value) => {
			valueDisplay.textContent = `${value}${suffix}`;
		};

		updateDisplay(slider.value);

		slider.addEventListener('input', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;

			const value = parseInt(slider.value, 10);
			updateDisplay(value);

			try {
				await this.runLayoutRefreshWithAnchor(layer, () => {
					applyValue(value, layer);
				}, {
					saveHistory: false,
					refreshLayerList: false,
					refreshPreview: refreshTextLayout
				});
			} catch (error) {
				this.reportFontLoadError(error);
			}
		});

		slider.addEventListener('change', () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;

			const value = parseInt(slider.value, 10);
			applyValue(value, layer);
			updateDisplay(value);
			this.editor.saveState();
			this.editor.layerManager.renderLayersList();
		});

		const resetId = 'reset' + slider.id.charAt(0).toUpperCase() + slider.id.slice(1);
		const resetButton = document.getElementById(resetId);
		if (resetButton) {
			resetButton.addEventListener('click', () => {
				slider.value = resetValue;
				slider.dispatchEvent(new Event('input'));
				slider.dispatchEvent(new Event('change'));
			});
		}
	}

	async loadFontsManifest() {
		if (this.fontManifestPromise) {
			return this.fontManifestPromise;
		}

		this.fontManifestPromise = (async () => {
			const response = await fetch(CONFIG.textLayers.fontsManifest);
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

		this.ui.fontPicker.innerHTML = '';
		fonts.forEach((font) => {
			const button = document.createElement('button');
			button.className = 'btn-simple text-font-option';
			button.type = 'button';
			button.dataset.fontId = font.id;
			button.textContent = font.name;
			button.style.fontFamily = this.getFontFamily(font);
			this.ui.fontPicker.appendChild(button);
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
		return this.fontsById.get(fontId) || this.fontsById.get(CONFIG.textLayers.defaultFontId) || null;
	}

	getFontFamily(font) {
		if (!font) return 'sans-serif';
		return `"${font.name}", ${font.fallback || 'sans-serif'}`;
	}

	getFontDeclaration(font, fontSize) {
		if (!font?.name) {
			return `400 ${fontSize}px sans-serif`;
		}
		return `${font.weight || 400} ${fontSize}px "${font.name}"`;
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
				await document.fonts.load(this.getFontDeclaration(font, CONFIG.textLayers.defaultFontSize), 'Hg');
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
		if (this.editor.layerManager.layers.length >= CONFIG.maxLayers) {
			this.editor.showError(`Maximum ${CONFIG.maxLayers} layers reached`);
			return null;
		}

		const defaultText = options.text ?? CONFIG.textLayers.defaultText;
		const initialPosition = options.position || {
			x: this.editor.originalCanvas.width / 2,
			y: this.editor.originalCanvas.height / 2
		};
		const initialAlign = options.align || 'center';
		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.TEXT_GLITTER,
			name: this.getLayerName(defaultText),
			visible: true,
			locked: false,
			selectedGlitterId: CONFIG.defaultGlitterId,
			settings: {
				scale: CONFIG.defaultScale,
				opacity: CONFIG.defaultOpacity
			},
			textData: {
				text: defaultText,
				fontId: CONFIG.textLayers.defaultFontId,
				fontSize: CONFIG.textLayers.defaultFontSize,
				letterSpacing: CONFIG.textLayers.defaultLetterSpacing,
				lineHeight: CONFIG.textLayers.lineHeight,
				align: initialAlign,
				verticalAlign: CONFIG.textLayers.defaultVerticalAlign || 'top',
				boxMode: options.boxMode || CONFIG.textLayers.defaultBoxMode || 'auto',
				width: 0,
				height: 0,
				border: null,
				shadow: null,
				transform: {
					position: {
						x: initialPosition.x,
						y: initialPosition.y
					},
					rotation: 0,
					scale: {
						x: CONFIG.defaultStickerScale,
						y: CONFIG.defaultStickerScale
					},
					proportionalScale: true,
					opacity: CONFIG.defaultStickerOpacity,
					flipX: false,
					flipY: false
				}
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
			this.ui.fontSizeValue.textContent = `${layer.textData.fontSize}px`;
		}

		if (this.ui.letterSpacing && this.ui.letterSpacingValue) {
			this.ui.letterSpacing.value = layer.textData.letterSpacing;
			this.ui.letterSpacingValue.textContent = `${layer.textData.letterSpacing}px`;
		}

		if (this.ui.lineHeight && this.ui.lineHeightValue) {
			const lineHeightPercent = Math.round((layer.textData.lineHeight || CONFIG.textLayers.lineHeight) * 100);
			this.ui.lineHeight.value = lineHeightPercent;
			this.ui.lineHeightValue.textContent = `${lineHeightPercent}%`;
		}

		if (this.ui.textureScale && this.ui.textureScaleValue) {
			this.ui.textureScale.value = layer.settings.scale;
			this.ui.textureScaleValue.textContent = `${layer.settings.scale}%`;
		}

		if (this.ui.textureOpacity && this.ui.textureOpacityValue) {
			this.ui.textureOpacity.value = layer.settings.opacity;
			this.ui.textureOpacityValue.textContent = `${layer.settings.opacity}%`;
		}

		this.updateFontSelection(layer.textData.fontId);
		this.updateAlignmentSelection(layer.textData.align);
		this.updateVerticalAlignmentSelection(layer.textData.verticalAlign);
		this.updateBoxModeSelection(layer);
		this.updateEffectControls(layer);
	}

	focusTextInput(selectAll = false) {
		if (!this.ui.textInput || this.editor.mobileManager?.isMobile) return;

		this.ui.textInput.focus();
		if (selectAll) {
			this.ui.textInput.select();
		}
	}

	updateFontSelection(fontId) {
		if (!this.ui.fontPicker) return;

		this.ui.fontPicker.querySelectorAll('[data-font-id]').forEach((button) => {
			button.classList.toggle('active', button.dataset.fontId === fontId);
		});

		this.scrollActiveFontIntoView();
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
				? 'Box text wraps inside the frame. Drag the side handles to resize the box; corner handles scale the text.'
				: 'Point text hugs the glyphs. Corner handles scale it. Switch to Box for wrapping inside a resizable frame.';
		}
	}

	updateEffectControls(layer) {
		this.normalizeLayer(layer);

		const border = this.getEffectData(layer, 'border');
		const shadow = this.getEffectData(layer, 'shadow');

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
			this.ui.borderWidthValue.textContent = `${border.widthPx}px`;
			this.ui.borderColor.value = border.color;
		} else {
			const defaults = this.getDefaultBorder();
			this.ui.borderWidth.value = defaults.widthPx;
			this.ui.borderWidthValue.textContent = `${defaults.widthPx}px`;
			this.ui.borderColor.value = defaults.color;
		}

		if (shadow) {
			this.ui.shadowOffsetX.value = shadow.offsetX;
			this.ui.shadowOffsetXValue.textContent = `${shadow.offsetX}px`;
			this.ui.shadowOffsetY.value = shadow.offsetY;
			this.ui.shadowOffsetYValue.textContent = `${shadow.offsetY}px`;
			this.ui.shadowColor.value = shadow.color;
		} else {
			const defaults = this.getDefaultShadow();
			this.ui.shadowOffsetX.value = defaults.offsetX;
			this.ui.shadowOffsetXValue.textContent = `${defaults.offsetX}px`;
			this.ui.shadowOffsetY.value = defaults.offsetY;
			this.ui.shadowOffsetYValue.textContent = `${defaults.offsetY}px`;
			this.ui.shadowColor.value = defaults.color;
		}

		this.updateFillSourceUI(layer);
		this.updateEffectSourceUI(layer, 'border');
		this.updateEffectSourceUI(layer, 'shadow');
		this.updateEffectTargetButtons(layer);
	}

	updateFillSourceUI(layer) {
		if (!this.ui.fillGlitterChip || !this.ui.fillGlitterLabel || !this.ui.fillGlitterSwatch) return;

		const glitter = this.editor.glitterManager?.getItemById(layer?.selectedGlitterId);
		if (glitter) {
			this.ui.fillGlitterLabel.textContent = glitter.name;
			this.ui.fillGlitterLabel.title = glitter.name;
			this.ui.fillGlitterChip.title = `Current fill glitter: ${glitter.name}. Click to choose another glitter.`;
			if (this.ui.fillGlitterChange) {
				this.ui.fillGlitterChange.title = this.ui.fillGlitterChip.title;
			}
			this.ui.fillGlitterSwatch.style.backgroundImage = `url(${glitter.url})`;
			this.ui.fillGlitterSwatch.classList.toggle('pixelated', Boolean(glitter.isPixelated));
		} else {
			this.ui.fillGlitterLabel.textContent = 'No glitter selected';
			this.ui.fillGlitterLabel.title = '';
			this.ui.fillGlitterChip.title = 'Pick a glitter for the text fill';
			if (this.ui.fillGlitterChange) {
				this.ui.fillGlitterChange.title = this.ui.fillGlitterChip.title;
			}
			this.ui.fillGlitterSwatch.style.backgroundImage = 'none';
			this.ui.fillGlitterSwatch.classList.remove('pixelated');
		}
	}

	toggleEffectControls(element, isVisible) {
		if (!element) return;
		element.classList.toggle('visible', isVisible);
	}

	updateEffectTargetButtons(layer) {
		const activeTarget = this.getGlitterSelectionTarget(layer);
		this.ui.fillGlitterChip?.classList.toggle('target-active', activeTarget === 'fill');
		this.ui.fillGlitterChange?.classList.toggle('target-active', activeTarget === 'fill');
		this.ui.borderGlitterChip?.classList.toggle('target-active', activeTarget === 'border');
		this.ui.borderGlitterChange?.classList.toggle('target-active', activeTarget === 'border');
		this.ui.shadowGlitterChip?.classList.toggle('target-active', activeTarget === 'shadow');
		this.ui.shadowGlitterChange?.classList.toggle('target-active', activeTarget === 'shadow');
	}

	updateEffectSourceUI(layer, effectName) {
		const effectData = this.getEffectData(layer, effectName);
		const config = effectName === 'border'
			? {
				button: this.ui.borderGlitterChip,
				changeButton: this.ui.borderGlitterChange,
				sourceValue: this.ui.borderSourceValue,
				label: this.ui.borderGlitterLabel,
				swatch: this.ui.borderGlitterSwatch,
				useColor: this.ui.borderUseColor,
				useGlitter: this.ui.borderUseGlitter,
				colorRow: this.ui.borderColorRow
			}
			: {
				button: this.ui.shadowGlitterChip,
				changeButton: this.ui.shadowGlitterChange,
				sourceValue: this.ui.shadowSourceValue,
				label: this.ui.shadowGlitterLabel,
				swatch: this.ui.shadowGlitterSwatch,
				useColor: this.ui.shadowUseColor,
				useGlitter: this.ui.shadowUseGlitter,
				colorRow: this.ui.shadowColorRow
			};

		if (!config.button || !config.sourceValue || !config.label || !config.swatch || !config.useColor || !config.useGlitter || !config.colorRow) {
			return;
		}

		const summary = this.getEffectSourceSummary(effectData, effectName);
		config.sourceValue.textContent = summary.modeLabel;
		config.label.textContent = summary.label;
		config.label.title = summary.label;
		config.button.title = summary.buttonTitle;
		if (config.changeButton) {
			config.changeButton.title = summary.buttonTitle;
		}
		config.swatch.style.backgroundImage = summary.backgroundImage;
		config.swatch.style.backgroundColor = summary.backgroundColor;
		config.swatch.classList.toggle('pixelated', summary.pixelated);
		config.useColor.hidden = !summary.usesGlitter;
		config.useGlitter.hidden = summary.usesGlitter;
		config.colorRow.hidden = summary.usesGlitter;
	}

	getEffectSourceSummary(effectData, effectName) {
		const defaultColor = effectName === 'shadow'
			? this.getDefaultShadow().color
			: this.getDefaultBorder().color;
		const effectTitle = effectName === 'shadow' ? 'shadow' : 'border';
		if (!effectData) {
			return {
				modeLabel: 'Solid Color',
				label: defaultColor.toUpperCase(),
				buttonTitle: `Pick a glitter for the text ${effectTitle}`,
				backgroundImage: 'none',
				backgroundColor: defaultColor,
				usesGlitter: false,
				pixelated: false
			};
		}

		if (effectData.glitterId) {
			const glitter = this.editor.glitterManager.getItemById(effectData.glitterId);
			if (glitter) {
				return {
					modeLabel: 'Glitter',
					label: glitter.name,
					buttonTitle: `Current ${effectTitle} glitter: ${glitter.name}. Click to choose another glitter.`,
					backgroundImage: `url(${glitter.url})`,
					backgroundColor: 'transparent',
					usesGlitter: true,
					pixelated: Boolean(glitter.isPixelated)
				};
			}
		}

		return {
			modeLabel: 'Solid Color',
			label: (effectData.color || defaultColor).toUpperCase(),
			buttonTitle: `The text ${effectTitle} is using a solid color. Click to choose a glitter instead.`,
			backgroundImage: 'none',
			backgroundColor: effectData.color || '#000000',
			usesGlitter: false,
			pixelated: false
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
		}, CONFIG.sliderDebounceMs);
	}

	getCacheKeyForLayer(layer) {
		this.normalizeLayer(layer);
		const textData = layer.textData;
		return JSON.stringify([
			textData.text,
			textData.fontId,
			textData.fontSize,
			textData.letterSpacing,
			textData.lineHeight,
			textData.align,
			textData.verticalAlign || 'top',
			textData.boxMode || 'auto',
			textData.boxWidth ?? null,
			textData.boxHeight ?? null,
			textData.border ? textData.border.widthPx : null,
			textData.shadow ? textData.shadow.offsetX : null,
			textData.shadow ? textData.shadow.offsetY : null,
			CONFIG.textLayers.crispEdges !== false
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
		const lines = String(layer.textData.text || '').split('\n');
		const padding = CONFIG.textLayers.maskPadding;
		const fontSize = layer.textData.fontSize;
		const letterSpacing = layer.textData.letterSpacing;
		const lineHeightPx = fontSize * layer.textData.lineHeight;
		const borderWidth = Math.max(0, layer.textData.border?.widthPx || 0);
		const shadowOffsetX = layer.textData.shadow?.offsetX || 0;
		const shadowOffsetY = layer.textData.shadow?.offsetY || 0;
		const boxMode = layer.textData.boxMode || 'auto';

		ctx.font = this.getFontDeclaration(font, fontSize);
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
		maskCtx.font = this.getFontDeclaration(font, fontSize);
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

		if (CONFIG.textLayers.crispEdges !== false) {
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
			transform.setupTouchGestures(wrapper);
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
					transform.element = wrapper;
					transform.applyTransform(wrapper, {
						width: layer.textData.width,
						height: layer.textData.height
					});

					if (layer.id === this.editor.layerManager.activeLayerId && this.editor.currentTool === ToolType.SELECT) {
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
		if (!stack || !this.fontFaces.has(layer.textData.fontId)) return;
		this.syncStackGeometry(stack, layer);
	}

	getSpanDescriptors(layer, measurement) {
		const descriptors = [];
		const shadow = this.getEffectData(layer, 'shadow');
		const border = this.getEffectData(layer, 'border');

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

		if (border?.widthPx > 0) {
			const { canvas: borderCanvas, cacheKey: borderCacheKey } = this.getBorderMaskCanvas(layer, measurement, border.widthPx);
			descriptors.push({
				key: 'border',
				offsetX: 0,
				offsetY: 0,
				source: this.getEffectPaintSource(layer, 'border'),
				maskType: 'border',
				maskCanvas: borderCanvas,
				maskCacheKey: borderCacheKey
			});
		}

		descriptors.push({
			key: 'fill',
			offsetX: 0,
			offsetY: 0,
			source: {
				mode: 'glitter',
				glitterId: layer.selectedGlitterId,
				opacity: layer.settings.opacity / 100
			},
			maskType: 'fill',
			maskCanvas: measurement.canvas,
			maskCacheKey: measurement.key
		});

		return descriptors;
	}

	// One continuous stroke, like a Photoshop stroke: stamp the glyph mask at
	// N angles around a ring onto a single canvas (union, not N separate
	// layers), then texture that one shape once. Mirrors
	// GifExporter._createBorderMaskCanvas so the live preview matches export.
	getBorderMaskCanvas(layer, measurement, widthPx) {
		const cutOutFill = layer.settings.opacity < 100;
		const cacheKey = `border:${widthPx}:${cutOutFill ? 1 : 0}`;

		if (measurement._borderMaskCache?.key === cacheKey) {
			return { canvas: measurement._borderMaskCache.canvas, cacheKey: `${measurement.key}|${cacheKey}` };
		}

		const canvas = document.createElement('canvas');
		canvas.width = measurement.canvas.width;
		canvas.height = measurement.canvas.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });

		this.getBorderOffsets(widthPx).forEach((offset) => {
			ctx.drawImage(measurement.canvas, offset.x, offset.y);
		});

		if (cutOutFill) {
			ctx.globalCompositeOperation = 'destination-out';
			ctx.drawImage(measurement.canvas, 0, 0);
			ctx.globalCompositeOperation = 'source-over';
		}

		measurement._borderMaskCache = { key: cacheKey, canvas };
		return { canvas, cacheKey: `${measurement.key}|${cacheKey}` };
	}

	getEffectPaintSource(layer, effectName) {
		const effectData = this.getEffectData(layer, effectName);
		if (!effectData) return null;

		if (effectData.glitterId && this.editor.glitterManager.getItemById(effectData.glitterId)) {
			return {
				mode: 'glitter',
				glitterId: effectData.glitterId,
				opacity: 1
			};
		}

		return {
			mode: 'solid',
			color: effectData.color || '#000000',
			opacity: 1
		};
	}

	getBorderOffsets(widthPx) {
		const radius = Math.max(1, widthPx);
		const steps = widthPx > 6 ? 16 : 8;
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

		if (source.mode === 'solid') {
			span.style.backgroundImage = 'none';
			span.style.backgroundColor = source.color;
			span.style.backgroundSize = '';
			span.style.opacity = String(source.opacity ?? 1);
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

		const glitterScale = layer.settings.scale / 100;
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
		} else {
			return false;
		}

		return this.applyResizedBoxRect(layer, dragState, rect, metrics);
	}

	createTransformHandles(layerId) {
		const transform = this.layerTransforms.get(layerId);
		if (transform) {
			transform.createTransformHandles();
		}
	}

	removeTransformHandles() {
		this.layerTransforms.forEach((transform) => {
			transform.removeTransformHandles();
		});
	}

	removeLayerElement(layerId) {
		const layer = this.editor.layerManager.layers.find((entry) => entry.id === layerId);
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
