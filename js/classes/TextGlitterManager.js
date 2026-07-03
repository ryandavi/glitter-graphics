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
			textureScale: document.getElementById('textTextureScale'),
			textureScaleValue: document.getElementById('textTextureScaleValue'),
			textureOpacity: document.getElementById('textTextureOpacity'),
			textureOpacityValue: document.getElementById('textTextureOpacityValue'),
			alignButtons: Array.from(document.querySelectorAll('[data-text-align]'))
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

				layer.textData.fontId = fontId;
				this.textMaskCache.delete(this.getCacheKeyForLayer(layer));

				try {
					await this.ensureFontLoaded(fontId);
					await this.refreshLayer(layer, { saveHistory: true });
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

		this.attachSlider(this.ui.textureScale, this.ui.textureScaleValue, '%', (value, layer) => {
			layer.settings.scale = value;
			this.updateExistingBackground(layer);
		}, CONFIG.defaultScale, false);

		this.attachSlider(this.ui.textureOpacity, this.ui.textureOpacityValue, '%', (value, layer) => {
			layer.settings.opacity = value;
			this.updateExistingBackground(layer);
		}, CONFIG.defaultOpacity, false);

		this.ui.alignButtons.forEach((button) => {
			button.addEventListener('click', async () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;

				const align = button.dataset.textAlign;
				if (!align || align === layer.textData.align) return;

				layer.textData.align = align;
				try {
					await this.refreshLayer(layer, { saveHistory: true });
				} catch (error) {
					this.reportFontLoadError(error);
				}
			});
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
			applyValue(value, layer);
			updateDisplay(value);

			try {
				await this.refreshLayer(layer, { saveHistory: false, refreshLayerList: false, refreshPreview: refreshTextLayout });
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

		this.ui.fontPicker.innerHTML = '';
		this.fontManifest.forEach((font) => {
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
		return layer?.type === LayerType.TEXT_GLITTER ? layer : null;
	}

	createLayer() {
		if (this.editor.layerManager.layers.length >= CONFIG.maxLayers) {
			this.editor.showError(`Maximum ${CONFIG.maxLayers} layers reached`);
			return null;
		}

		const defaultText = CONFIG.textLayers.defaultText;
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
				align: 'center',
				width: 0,
				height: 0,
				border: null,
				shadow: null,
				transform: {
					position: {
						x: this.editor.originalCanvas.width / 2,
						y: this.editor.originalCanvas.height / 2
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

		return layer;
	}

	loadLayerSettings(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER) return;

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
	}

	updateAlignmentSelection(align) {
		this.ui.alignButtons.forEach((button) => {
			button.classList.toggle('active', button.dataset.textAlign === align);
		});
	}

	scheduleTextCommit(layer) {
		clearTimeout(this.textInputTimer);
		this.textInputTimer = setTimeout(async () => {
			try {
				await this.refreshLayer(layer, { saveHistory: true });
			} catch (error) {
				this.reportFontLoadError(error);
			}
		}, CONFIG.sliderDebounceMs);
	}

	getCacheKeyForLayer(layer) {
		const textData = layer.textData;
		return JSON.stringify([
			textData.text,
			textData.fontId,
			textData.fontSize,
			textData.letterSpacing,
			textData.lineHeight,
			textData.align
		]);
	}

	getMeasurementEntry(layer) {
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
		const lineHeightPx = fontSize * layer.textData.lineHeight;

		ctx.font = this.getFontDeclaration(font, fontSize);
		ctx.textBaseline = 'alphabetic';

		const sampleMetrics = ctx.measureText('Hg');
		const ascent = sampleMetrics.actualBoundingBoxAscent || fontSize * 0.8;
		const descent = sampleMetrics.actualBoundingBoxDescent || fontSize * 0.2;

		const measuredLines = lines.map((line) => ({
			text: line,
			width: this.measureLineWidth(ctx, line, layer.textData.letterSpacing)
		}));

		const textWidth = measuredLines.reduce((max, line) => Math.max(max, line.width), 0);
		const textHeight = lines.length > 0
			? ascent + descent + lineHeightPx * Math.max(lines.length - 1, 0)
			: ascent + descent;

		const canvasWidth = Math.max(1, Math.ceil(textWidth + padding * 2));
		const canvasHeight = Math.max(1, Math.ceil(textHeight + padding * 2));
		const canvas = document.createElement('canvas');
		canvas.width = canvasWidth;
		canvas.height = canvasHeight;

		const maskCtx = canvas.getContext('2d', { willReadFrequently: true });
		maskCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		maskCtx.fillStyle = '#ffffff';
		maskCtx.font = this.getFontDeclaration(font, fontSize);
		maskCtx.textBaseline = 'alphabetic';

		measuredLines.forEach((line, index) => {
			const baselineY = padding + ascent + index * lineHeightPx;
			this.drawLine(maskCtx, line.text, line.width, {
				align: layer.textData.align,
				padding,
				maxWidth: textWidth,
				baselineY,
				letterSpacing: layer.textData.letterSpacing
			});
		});

		const entry = {
			key,
			canvas,
			lines: measuredLines,
			padding,
			width: canvasWidth,
			height: canvasHeight,
			textWidth,
			textHeight,
			ascent,
			lineHeightPx
		};

		this.textMaskCache.set(key, entry);
		layer.textData.width = canvasWidth;
		layer.textData.height = canvasHeight;
		return entry;
	}

	measureLineWidth(ctx, text, letterSpacing) {
		if (!text) return 0;
		if (!letterSpacing) return ctx.measureText(text).width;

		let width = 0;
		for (let index = 0; index < text.length; index++) {
			width += ctx.measureText(text[index]).width;
			if (index < text.length - 1) {
				width += letterSpacing;
			}
		}
		return width;
	}

	drawLine(ctx, text, lineWidth, options) {
		const { align, padding, maxWidth, baselineY, letterSpacing } = options;

		if (!letterSpacing) {
			ctx.textAlign = align;
			let x = padding;
			if (align === 'center') x += maxWidth / 2;
			if (align === 'right') x += maxWidth;
			ctx.fillText(text, x, baselineY);
			return;
		}

		let startX = padding;
		if (align === 'center') {
			startX += (maxWidth - lineWidth) / 2;
		} else if (align === 'right') {
			startX += (maxWidth - lineWidth);
		}

		for (let index = 0; index < text.length; index++) {
			const char = text[index];
			ctx.textAlign = 'left';
			ctx.fillText(char, startX, baselineY);
			startX += ctx.measureText(char).width;
			if (index < text.length - 1) {
				startX += letterSpacing;
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

		if (!layer.textData.text.trim()) {
			this.removeLayerElement(layer.id);
			return;
		}

		const glitter = this.editor.glitterManager.getItemById(layer.selectedGlitterId);
		if (!glitter) {
			this.removeLayerElement(layer.id);
			return;
		}

		let wrapper = this.layerElements.get(layer.id);
		let content = wrapper?.querySelector('.text-glitter-content');

		if (!wrapper) {
			wrapper = document.createElement('div');
			wrapper.className = 'text-glitter-element';
			wrapper.dataset.layerId = layer.id;
		}

		if (!content) {
			content = document.createElement('span');
			content.className = 'text-glitter-content';
			wrapper.replaceChildren(content);
		}

		wrapper.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);
		content.textContent = layer.textData.text;
		this.applyGlitterBackground(content, glitter, layer);
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

				const entry = this.getMeasurementEntry(layer);
				const font = this.getFontById(layer.textData.fontId);
				this.applyTextStyles(wrapper, content, layer, font, entry);

				const transform = this.layerTransforms.get(layer.id);
				if (transform) {
					transform.element = wrapper;
					transform.applyTransform(wrapper, {
						width: layer.textData.width,
						height: layer.textData.height
					});

					if (layer.id === this.editor.layerManager.activeLayerId && this.editor.currentTool === ToolType.SELECT) {
						transform.createTransformHandles();
					} else {
						transform.removeTransformHandles();
					}
				}

				wrapper.style.visibility = '';
				this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);
			})
			.catch((error) => {
				wrapper.style.visibility = 'hidden';
				this.reportFontLoadError(error);
			});
	}

	applyTextStyles(wrapper, content, layer, font, measurement) {
		wrapper.style.setProperty('--text-mask-padding', `${measurement.padding}px`);
		content.style.fontFamily = this.getFontFamily(font);
		content.style.fontWeight = String(font?.weight || 400);
		content.style.fontSize = `${layer.textData.fontSize}px`;
		content.style.letterSpacing = `${layer.textData.letterSpacing}px`;
		content.style.lineHeight = String(layer.textData.lineHeight);
		content.style.textAlign = layer.textData.align;
	}

	applyGlitterBackground(content, glitter, layer) {
		content.style.backgroundImage = `url(${glitter.url})`;
		content.style.opacity = layer.settings.opacity / 100;

		const glitterScale = layer.settings.scale / 100;
		const baseSize = glitter.frames?.width || glitter.width || 50;
		content.style.backgroundSize = `${Math.round(baseSize * glitterScale)}px`;
		content.classList.toggle('pixelated', Boolean(glitter.isPixelated));
	}

	updateExistingBackground(layer) {
		const wrapper = this.layerElements.get(layer.id);
		const content = wrapper?.querySelector('.text-glitter-content');
		const glitter = this.editor.glitterManager.getItemById(layer.selectedGlitterId);
		if (!content || !glitter) return;
		this.applyGlitterBackground(content, glitter, layer);
	}

	updateLiveTextContent(layerId, text) {
		const wrapper = this.layerElements.get(layerId);
		const content = wrapper?.querySelector('.text-glitter-content');
		if (content) {
			content.textContent = text;
		}
	}

	async refreshLayer(layer, options = {}) {
		const {
			saveHistory = false,
			refreshLayerList = true,
			refreshPreview = true
		} = options;

		await this.ensureFontLoaded(layer.textData.fontId);
		this.getMeasurementEntry(layer);

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
}
