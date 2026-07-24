// ============================================
// GIF EXPORT MANAGER CLASS
// ============================================
class GifExporter {
	constructor() {
		const exportConfig = CONFIG.export || {};
		this.config = {
			workers: exportConfig.core?.workers ?? 4,
			quality: exportConfig.core?.quality ?? 1,
			workerScript: 'js/workers/gif.worker.js',
			timing: {
				forceDelay: exportConfig.core?.timing?.forceDelay ?? 100,
				maxFrames: exportConfig.core?.timing?.maxFrames ?? 60
			},
			debug: typeof CONFIG !== 'undefined' ? CONFIG.debug?.enabled : false,
			watermarkAlphaThreshold: exportConfig.watermark?.alphaThreshold ?? 128,
			useAdaptiveQuality: false // Add this flag
		};
		this.fileName = `${exportConfig.core?.defaultBaseName || 'ryandavi-com_glitter'}.gif`;

		// Reusable canvas elements
		this.canvas = document.createElement('canvas');
		this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

		this.helperCanvas = document.createElement('canvas');
		this.helperCtx = this.helperCanvas.getContext('2d', { willReadFrequently: true });
		this.basePixelEffectCache = new Map();
		this.baseDitherPaletteCache = new Map();
		this.previewBlobUrl = null;
	}

	_hasTransparency(canvasData) {
		const { originalAlpha, alphaThreshold } = canvasData;
		for (let i = 0; i < originalAlpha.length; i++) {
			if (originalAlpha[i] < alphaThreshold) {
				return true; // Found at least one transparent pixel
			}
		}
		return false; // No transparency in image
	}

	setFileName(fileName) {
		if (fileName) {
			this.fileName = fileName;
		}
	}


	_getSizeWarnings(bytes) {
		return (CONFIG.export?.limits?.sizeWarnings || [])
			.map((warning) => ({
				label: warning.label,
				detail: warning.detail,
				limit: warning.limitMB * 1024 * 1024
			}))
			.filter((warning) => bytes > warning.limit);
	}

	_renderPreviewTemplate(host, templateId, { format, isVideo }) {
		const template = document.getElementById(templateId);
		if (!host || !template) return;
		const fragment = template.content.cloneNode(true);
		fragment.querySelectorAll('[data-export-format]').forEach((element) => {
			element.textContent = format.toUpperCase();
		});
		fragment.querySelectorAll('[data-export-gif-only]').forEach((element) => {
			 element.hidden = isVideo;
		});
		host.replaceChildren(fragment);
		host.hidden = false;
	}

	_renderSizeWarnings(host, bytes) {
		if (!host) return;
		host.replaceChildren();
		if (!Number.isFinite(bytes)) {
			host.hidden = true;
			return;
		}

		const template = document.getElementById('tpl-export-size-warning');
		const warnings = this._getSizeWarnings(bytes);
		warnings.forEach((warning) => {
			const node = template.content.cloneNode(true);
			const warningElement = node.querySelector('.size-warning');
			warningElement.querySelector('strong').textContent = warning.label;
			warningElement.querySelector('span').textContent = warning.detail;
			warningElement.setAttribute('aria-label', `${warning.label}. ${warning.detail}.`);
			host.appendChild(node);
		});
		host.hidden = warnings.length === 0;
	}

	_analyzeGifColors(frames) {
		const settings = CONFIG.export?.limits?.colorAnalysis;
		if (!settings || !frames?.length) return null;

		const frameSampleCount = Math.min(frames.length, settings.maxFrames);
		const frameIndexes = new Set();
		for (let index = 0; index < frameSampleCount; index++) {
			const position = frameSampleCount === 1
				? 0
				: Math.round((index * (frames.length - 1)) / (frameSampleCount - 1));
			frameIndexes.add(position);
		}

		let observedColorCount = 0;
		for (const frameIndex of frameIndexes) {
			const imageData = this._getFrameImageData(frames[frameIndex]);
			if (!imageData) continue;
			const pixelCount = imageData.width * imageData.height;
			const pixelStep = Math.max(1, Math.ceil(pixelCount / settings.maxPixelsPerFrame));
			const colors = new Set();
			for (let pixel = 0; pixel < pixelCount; pixel += pixelStep) {
				const offset = pixel * 4;
				const color = (imageData.data[offset] << 16)
					| (imageData.data[offset + 1] << 8)
					| imageData.data[offset + 2];
				colors.add(color);
				if (colors.size > settings.significantColorCount) {
					return {
						significant: true,
						observedColorCount: colors.size,
						paletteSize: settings.paletteSize
					};
				}
			}
			observedColorCount = Math.max(observedColorCount, colors.size);
		}

		return {
			significant: false,
			observedColorCount,
			paletteSize: settings.paletteSize
		};
	}

	_getFrameImageData(frame, fallbackWidth = null, fallbackHeight = null) {
		if (frame instanceof ImageData) {
			return frame;
		}

		if (frame?.imageData instanceof ImageData) {
			return frame.imageData;
		}

		if (frame?.data instanceof ImageData) {
			return frame.data;
		}

		if (frame?.data instanceof Uint8ClampedArray) {
			const width = frame.width || fallbackWidth;
			const height = frame.height || fallbackHeight;
			if (width && height && frame.data.length === width * height * 4) {
				return new ImageData(new Uint8ClampedArray(frame.data), width, height);
			}
		}

		return null;
	}

	_getReducedFrameIndex(frameIndex, originalFrameCount, reducedFrameCount = null) {
		if (!originalFrameCount) {
			return 0;
		}

		if (reducedFrameCount && typeof reducedFrameCount === 'object' && Number.isInteger(reducedFrameCount.frameIndex)) {
			return Math.max(0, Math.min(originalFrameCount - 1, reducedFrameCount.frameIndex));
		}

		if (!reducedFrameCount || reducedFrameCount <= 0) {
			return frameIndex % originalFrameCount;
		}

		const normalizedIndex = (frameIndex % reducedFrameCount) / reducedFrameCount;
		return Math.min(originalFrameCount - 1, Math.floor(normalizedIndex * originalFrameCount));
	}








	_drawTransformedCanvas(ctx, sourceCanvas, transform, width, height) {
		const metrics = computeLayerTransform(transform, { width, height });

		ctx.save();
		ctx.imageSmoothingEnabled = false;
		ctx.globalAlpha = metrics.opacity;
		ctx.translate(metrics.centerX, metrics.centerY);

		if (metrics.rotationRad !== 0) {
			ctx.rotate(metrics.rotationRad);
		}

		ctx.scale(metrics.signedScaleX, metrics.signedScaleY);

		ctx.drawImage(
			sourceCanvas,
			-width / 2,
			-height / 2,
			width,
			height
		);

		ctx.restore();
	}

	_renderLayerToCanvas(layer, ctx, frameIndex, frameMap = null, flattenedFrameMap = null) {
		const transform = getLayerTransform(layer);
		const { isAnimated, width, height } = layer.stickerData;

		// Determine which frame/image to use
		let imageData;
		if (isAnimated && layer.stickerData.frames) {
			const frames = flattenedFrameMap?.get(layer.id);
			if (!frames?.length) {
				throw new Error(`Missing flattened sticker frames for layer ${layer.id}`);
			}

			const reducedFrameCount = frameMap?.get(layer.id);
			const stickerFrameIndex = this._getReducedFrameIndex(frameIndex, frames.length, reducedFrameCount);
			imageData = frames[stickerFrameIndex];
			if (!imageData) {
				throw new Error(`Invalid sticker frame format for layer ${layer.id} frame ${stickerFrameIndex}`);
			}
		} else if (layer.stickerData.staticImageData) {
			imageData = layer.stickerData.staticImageData;
		} else {
			throw new Error(`No image data for sticker layer ${layer.id}`);
		}

		// The same color-adjust matrix used by glitter/text/shape export also
		// matches the sticker image's CSS preview filter.
		const tempCanvas = this._patternSourceFromFrame(imageData, layer.stickerData.colorAdjust);
		this._renderStickerEffects(layer, ctx, tempCanvas, frameIndex, frameMap, flattenedFrameMap);

		this._drawTransformedCanvas(ctx, tempCanvas, transform, width, height);
	}

	_getStickerEffectSource(layer, slot) {
		const data = layer.stickerData?.[slot];
		return data ? resolveEffectPaintSource(data, { glitterId: data.glitterId }) : null;
	}

	_getStickerFrameKey(layer, slot) {
		return `${layer.id}:${slot}`;
	}

	_getStickerGlitterSources(layer) {
		const data = layer.stickerData?.shadow;
		return data?.mode === 'glitter' && data.glitterId
			? [{ key: this._getStickerFrameKey(layer, 'shadow'), slot: 'shadow', glitterId: data.glitterId }]
			: [];
	}

	_renderStickerEffects(layer, ctx, stickerCanvas, frameIndex, frameMap, flattenedFrameMap) {
		const shadow = layer.stickerData?.shadow;
		if (!shadow) return;
		const pad = Math.ceil(Math.max(
			Math.abs(shadow.offsetX || 0),
			Math.abs(shadow.offsetY || 0)
		)) + 2;
		const mask = document.createElement('canvas');
		mask.width = stickerCanvas.width + pad * 2;
		mask.height = stickerCanvas.height + pad * 2;
		mask.getContext('2d').drawImage(stickerCanvas, pad, pad);
		const source = this._getStickerEffectSource(layer, 'shadow');
		const effectMask = this._createOffsetMaskCanvas(mask, shadow.offsetX || 0, shadow.offsetY || 0);
		if (!source || !effectMask) return;
		const filled = this._createFilledMaskCanvas(effectMask, source, layer, frameIndex, this._getStickerFrameKey(layer, 'shadow'), frameMap, flattenedFrameMap);
		this._drawTransformedCanvas(ctx, filled, getLayerTransform(layer), filled.width, filled.height);
	}

	_renderTextLayerToCanvas(layer, ctx, frameIndex, frameMap = null, flattenedFrameMap = null, textMaskCanvases = null) {
		const textMasks = textMaskCanvases?.get(layer.id);
		if (!textMasks?.fill) {
			throw new Error(`Missing text mask for layer ${layer.id}`);
		}

		const shadow = layer.textData.shadow;
		if (shadow && textMasks.shadow) {
			this._renderFilledTextMaskToCanvas(
				layer,
				ctx,
				frameIndex,
				textMasks.shadow,
				this._getTextEffectSource(layer, 'shadow'),
				this._getTextFrameKey(layer, 'shadow'),
				frameMap,
				flattenedFrameMap
			);
		}

		const border = layer.textData.border;
		const renderBorder = () => {
			if (!(border?.widthPx > 0) || !textMasks.border) return;
			this._renderFilledTextMaskToCanvas(
				layer,
				ctx,
				frameIndex,
				textMasks.border,
				this._getTextEffectSource(layer, 'border'),
				this._getTextFrameKey(layer, 'border'),
				frameMap,
				flattenedFrameMap
			);
		};
		const drawBorderAfterFill = this._getBorderDrawOrder(border) === 'front';

		if (!drawBorderAfterFill) {
			renderBorder();
		}

		this._renderFilledTextMaskToCanvas(
			layer,
			ctx,
			frameIndex,
			textMasks.fill,
			this._getTextEffectSource(layer, 'fill'),
			this._getTextFrameKey(layer, 'fill'),
			frameMap,
			flattenedFrameMap
		);

		if (drawBorderAfterFill) {
			renderBorder();
		}
	}

	_shapeUsesGlitter(layer) {
		const d = layer.shapeData;
		if (!d) return false;
		if (d.fill?.mode === 'glitter') return true;
		if (d.border && d.border.mode === 'glitter') return true;
		if (d.shadow && d.shadow.mode === 'glitter') return true;
		return false;
	}

	// Shared with ShapeGlitterManager via resolveEffectPaintSource. Each slot has
	// its own glitter: fill uses layer.selectedGlitterId, border/shadow use their
	// own effectData.glitterId.
	_getShapeEffectSource(layer, slot) {
		return resolveEffectPaintSource(slot === 'fill' ? layer.shapeData?.fill : layer.shapeData?.[slot], {
			allowNone: slot === 'fill',
			glitterId: slot === 'fill' ? layer.selectedGlitterId : layer.shapeData?.[slot]?.glitterId
		});
	}

	_getShapeFrameKey(layer, slot) {
		return `${layer.id}:${slot}`;
	}

	// Per-slot glitter sources (like text) — each slot in glitter mode with a
	// glitter contributes its own flattened frame set keyed by layer.id:slot.
	_getShapeGlitterSources(layer) {
		const d = layer.shapeData;
		const sources = [];
		if (d.fill?.mode === 'glitter' && layer.selectedGlitterId) {
			sources.push({ key: this._getShapeFrameKey(layer, 'fill'), slot: 'fill', glitterId: layer.selectedGlitterId });
		}
		if (d.border && d.border.widthPx > 0 && d.border.mode === 'glitter' && d.border.glitterId) {
			sources.push({ key: this._getShapeFrameKey(layer, 'border'), slot: 'border', glitterId: d.border.glitterId });
		}
		if (d.shadow && d.shadow.mode === 'glitter' && d.shadow.glitterId) {
			sources.push({ key: this._getShapeFrameKey(layer, 'shadow'), slot: 'shadow', glitterId: d.shadow.glitterId });
		}
		return sources;
	}

	// Mirror of _renderTextLayerToCanvas for shape layers (shadow, border, fill),
	// reusing the generic _createFilledMaskCanvas + _drawTransformedCanvas.
	_renderShapeLayerToCanvas(layer, ctx, frameIndex, frameMap, flattenedFrameMap, shapeMaskCanvases) {
		const masks = shapeMaskCanvases?.get(layer.id);
		if (!masks?.fill) {
			throw new Error(`Missing shape mask for layer ${layer.id}`);
		}
		const d = layer.shapeData;
		const t = getLayerTransform(layer);
		const w = masks.renderWidth;
		const h = masks.renderHeight;
		const draw = (maskCanvas, slot) => {
			if (!maskCanvas) return;
			const source = this._getShapeEffectSource(layer, slot);
			if (!source) return;
			const fillCanvas = this._createFilledMaskCanvas(maskCanvas, source, layer, frameIndex, this._getShapeFrameKey(layer, slot), frameMap, flattenedFrameMap);
			this._drawTransformedCanvas(ctx, fillCanvas, t, w, h);
		};
		const drawBorder = () => {
			if (d.border?.widthPx > 0 && masks.border) draw(masks.border, 'border');
		};
		if (d.shadow && masks.shadow) draw(masks.shadow, 'shadow');
		if (this._getBorderDrawOrder(d.border) !== 'front') {
			drawBorder();
		}
		draw(masks.fill, 'fill');
		if (this._getBorderDrawOrder(d.border) === 'front') {
			drawBorder();
		}
	}

	_getTextFrameKey(layer, slot) {
		return `${layer.id}:${slot}`;
	}

	_getTextEffectSource(layer, effectName) {
		if (effectName === 'fill') {
			return resolveEffectPaintSource(layer.textData?.fill, {
				allowNone: true,
				glitterId: layer.selectedGlitterId,
				scale: layer.settings.scale ?? 100,
				opacity: layer.settings.opacity ?? 100,
				colorAdjust: layer.settings.colorAdjust
			});
		}

		return resolveEffectPaintSource(layer.textData?.[effectName]);
	}

	_buildLayerExportPlan(layer) {
		switch (layer?.type) {
			case LayerType.BASE_IMAGE: {
				const background = layer.background || { mode: 'image' };
				const mode = background.mode || 'image';
				return {
					prepareMasks: async () => {},
					loadSources: async (library, callbacks) => {
						if (mode !== 'glitter') return;
						const glitter = library.find((item) => item.id === layer.selectedGlitterId);
						if (!glitter) throw new Error(`Missing glitter ${layer.selectedGlitterId}`);
						if (!glitter.frames) glitter.frames = await callbacks.parseGif(glitter.url);
					},
					flattenFrames: (library, flattenSource) => {
						if (mode !== 'glitter') return;
						const glitter = library.find((item) => item.id === layer.selectedGlitterId);
						if (glitter?.frames?.frames?.length) flattenSource(layer.id, glitter.frames, `${glitter.name} (background)`, false);
					},
					collectTransparencyFrames: (flattenedFrameMap, allFrames) => {
						if (mode === 'glitter') allFrames.push(...(flattenedFrameMap?.get(layer.id) || []));
					},
					collectFrameCounts: (library, counts) => {
						if (mode !== 'glitter') { counts.set(layer.id, 1); return; }
						const glitter = library.find((item) => item.id === layer.selectedGlitterId);
						counts.set(layer.id, glitter?.frames?.frames?.length || glitter?.frameCount || 1);
					},
					hasMultiFrameGlitter: (counts) => mode === 'glitter' && (counts.get(layer.id) || 0) > 1,
					render: ({ ctx, frameIndex, frameMap, flattenedFrameMap, width, height }) => {
						if (mode === 'image' || mode === 'gradient' || mode === 'none') return;
						ctx.save();
						ctx.globalAlpha = (background.opacity ?? 100) / 100;
						if (mode === 'solid') ctx.fillStyle = background.color || '#ffffff';
						else if (mode === 'gradient') ctx.fillStyle = createEffectCanvasGradient(ctx, background.gradient, { x: 0, y: 0, width, height });
						else {
							const frames = flattenedFrameMap?.get(layer.id) || [];
							const reduced = frameMap?.get(layer.id);
							const frame = frames[this._getReducedFrameIndex(frameIndex, frames.length, reduced)];
							if (!frame) throw new Error(`Missing background glitter frame for ${layer.id}`);
							const pattern = ctx.createPattern(this._patternSourceFromFrame(frame, background.colorAdjust), 'repeat');
							pattern.setTransform(new DOMMatrix().scaleSelf((background.scale || 100) / 100));
							ctx.fillStyle = pattern;
						}
						ctx.fillRect(0, 0, width, height);
						ctx.restore();
					}
				};
			}
			case LayerType.GLITTER_FILL:
				const fillMode = layer.fill?.mode || 'glitter';
				return {
					prepareMasks: async ({ maskDataMap, maskCanvases, canvasData, callbacks }) => {
						const rawMask = callbacks.createMask(layer);
						maskDataMap.set(layer.id, rawMask);
						maskCanvases.set(layer.id, this._createMaskCanvas(rawMask, canvasData.width, canvasData.height));
					},
					loadSources: async (library, callbacks) => {
						if (fillMode !== 'glitter') return;
						const glitter = library.find((item) => item.id === layer.selectedGlitterId);
						if (!glitter) {
							throw new Error(`Missing glitter ${layer.selectedGlitterId}`);
						}
						if (!glitter.frames) {
							callbacks.onStatus(`Loading ${glitter.name}...`);
							try {
								glitter.frames = await callbacks.parseGif(glitter.url);
							} catch (error) {
								throw new Error(`Failed to load ${glitter.name}`);
							}
						}
					},
					flattenFrames: (library, flattenSource) => {
						if (fillMode !== 'glitter') return;
						const glitter = library.find((item) => item.id === layer.selectedGlitterId);
						if (!glitter?.frames?.frames?.length) return;
						flattenSource(layer.id, glitter.frames, glitter.name, false);
					},
					collectTransparencyFrames: (flattenedFrameMap, allFrames) => {
						if (fillMode !== 'glitter') return;
						const frames = flattenedFrameMap?.get(layer.id);
						if (frames?.length) {
							allFrames.push(...frames);
						}
					},
					collectFrameCounts: (library, layerFrameCounts) => {
						if (fillMode !== 'glitter') { layerFrameCounts.set(layer.id, 1); return; }
						const glitter = library.find((item) => item.id === layer.selectedGlitterId);
						layerFrameCounts.set(layer.id, glitter?.frames?.frames?.length || glitter?.frameCount || 1);
					},
					hasMultiFrameGlitter: (layerFrameCounts) => fillMode === 'glitter' && (layerFrameCounts.get(layer.id) || 0) > 1,
					render: ({ ctx, frameIndex, frameMap, flattenedFrameMap, maskCanvases, helperCtx, width, height }) => {
						const maskCanvas = maskCanvases.get(layer.id);
						if (!maskCanvas) {
							throw new Error(`Missing mask canvas for layer ${layer.id}`);
						}

						const frames = flattenedFrameMap?.get(layer.id);
						if (fillMode === 'glitter' && !frames?.length) {
							throw new Error(`Missing flattened glitter frames for layer ${layer.id}`);
						}

						const reducedFrameCount = frameMap?.get(layer.id);
						const fIdx = fillMode === 'glitter' ? this._getReducedFrameIndex(frameIndex, frames.length, reducedFrameCount) : 0;
						const frameImageData = fillMode === 'glitter' ? frames[fIdx] : null;
						if (fillMode === 'glitter' && !frameImageData) {
							throw new Error(`Invalid glitter frame format for layer ${layer.id} frame ${fIdx}`);
						}

						helperCtx.save();
						helperCtx.clearRect(0, 0, width, height);

						helperCtx.globalAlpha = layer.settings.opacity / 100;
						if (fillMode === 'solid') {
							helperCtx.fillStyle = layer.fill.color;
						} else if (fillMode === 'gradient') {
							helperCtx.fillStyle = createEffectCanvasGradient(helperCtx, layer.fill.gradient, { x: 0, y: 0, width, height });
						} else {
							const patternSource = this._patternSourceFromFrame(frameImageData, layer.settings.colorAdjust);
							const pattern = helperCtx.createPattern(patternSource, 'repeat');
							const scale = (layer.settings.scale <= 0 ? 1 : layer.settings.scale) / 100;
							pattern.setTransform(new DOMMatrix().scaleSelf(scale, scale));
							helperCtx.fillStyle = pattern;
						}
						helperCtx.fillRect(0, 0, width, height);
						helperCtx.globalCompositeOperation = 'destination-in';
						helperCtx.drawImage(maskCanvas, 0, 0);
						helperCtx.restore();

						ctx.drawImage(this.helperCanvas, 0, 0);
					}
				};

			case LayerType.TEXT_GLITTER: {
				const glitterSources = this._getTextEffectGlitterSources(layer);
				return {
					prepareMasks: async ({ textMaskCanvases, callbacks }) => {
						const fillMaskCanvas = await callbacks.renderTextMask(layer);
						textMaskCanvases.set(layer.id, this._buildTextMaskEntry(layer, fillMaskCanvas));
					},
					loadSources: async (library, callbacks) => {
						for (const source of glitterSources) {
							const glitter = library.find((item) => item.id === source.glitterId);
							if (!glitter) {
								throw new Error(`Missing glitter ${source.glitterId}`);
							}
							if (!glitter.frames) {
								callbacks.onStatus(`Loading ${glitter.name}...`);
								try {
									glitter.frames = await callbacks.parseGif(glitter.url);
								} catch (error) {
									throw new Error(`Failed to load ${glitter.name}`);
								}
							}
						}

						try {
							await callbacks.ensureTextFont(layer.textData.fontId);
						} catch (error) {
							throw new Error(error.message);
						}
					},
					flattenFrames: (library, flattenSource) => {
						glitterSources.forEach((source) => {
							const glitter = library.find((item) => item.id === source.glitterId);
							if (!glitter?.frames?.frames?.length) return;
							flattenSource(source.key, glitter.frames, `${glitter.name} (${source.slot})`, false);
						});
					},
					collectTransparencyFrames: (flattenedFrameMap, allFrames) => {
						glitterSources.forEach((source) => {
							const frames = flattenedFrameMap?.get(source.key);
							if (frames?.length) {
								allFrames.push(...frames);
							}
						});
					},
					collectFrameCounts: (library, layerFrameCounts) => {
						glitterSources.forEach((source) => {
							const glitter = library.find((item) => item.id === source.glitterId);
							layerFrameCounts.set(source.key, glitter?.frames?.frames?.length || glitter?.frameCount || 1);
						});
					},
					hasMultiFrameGlitter: (layerFrameCounts) => glitterSources.some((source) =>
						(layerFrameCounts.get(source.key) || 0) > 1
					),
					render: ({ ctx, frameIndex, frameMap, flattenedFrameMap, textMaskCanvases }) => {
						this._renderTextLayerToCanvas(layer, ctx, frameIndex, frameMap, flattenedFrameMap, textMaskCanvases);
					}
				};
			}

			case LayerType.SHAPE: {
				const glitterSources = this._getShapeGlitterSources(layer);
				return {
					prepareMasks: async ({ shapeMaskCanvases, callbacks }) => {
						// The shape manager is the single source of truth for fill, border,
						// and shadow masks so preview/export stay in sync.
						shapeMaskCanvases.set(layer.id, callbacks.renderShapeMask(layer));
					},
					loadSources: async (library, callbacks) => {
						for (const source of glitterSources) {
							const glitter = library.find((item) => item.id === source.glitterId);
							if (!glitter) {
								throw new Error(`Missing glitter ${source.glitterId}`);
							}
							if (!glitter.frames) {
								callbacks.onStatus(`Loading ${glitter.name}...`);
								try {
									glitter.frames = await callbacks.parseGif(glitter.url);
								} catch (error) {
									throw new Error(`Failed to load ${glitter.name}`);
								}
							}
						}
					},
					flattenFrames: (library, flattenSource) => {
						glitterSources.forEach((source) => {
							const glitter = library.find((item) => item.id === source.glitterId);
							if (!glitter?.frames?.frames?.length) return;
							flattenSource(source.key, glitter.frames, `${glitter.name} (${source.slot})`, false);
						});
					},
					collectTransparencyFrames: () => {
						// Safe-key selection historically ignored shape slots; keep that
						// behavior for this refactor so export output stays unchanged.
					},
					collectFrameCounts: (library, layerFrameCounts) => {
						if (glitterSources.length === 0) {
							layerFrameCounts.set(layer.id, 1);
							return;
						}

						glitterSources.forEach((source) => {
							const glitter = library.find((item) => item.id === source.glitterId);
							layerFrameCounts.set(source.key, glitter?.frames?.frames?.length || glitter?.frameCount || 1);
						});
					},
					hasMultiFrameGlitter: (layerFrameCounts) => glitterSources.some((source) =>
						(layerFrameCounts.get(source.key) || 0) > 1
					),
					render: ({ ctx, frameIndex, frameMap, flattenedFrameMap, shapeMaskCanvases }) => {
						this._renderShapeLayerToCanvas(layer, ctx, frameIndex, frameMap, flattenedFrameMap, shapeMaskCanvases);
					}
				};
			}

			case LayerType.STICKER: {
				const glitterSources = this._getStickerGlitterSources(layer);
				return {
					prepareMasks: async () => {},
					loadSources: async (library, callbacks) => {
						const stickerData = layer.stickerData;
						if (stickerData.isAnimated && !stickerData.frames) {
							callbacks.onStatus(`Loading ${stickerData.name}...`);
							try {
								stickerData.frames = await callbacks.parseGif(stickerData.url);
							} catch (error) {
								throw new Error(`Failed to load sticker ${stickerData.name}`);
							}
						} else if (!stickerData.isAnimated && !stickerData.staticImageData) {
							callbacks.onStatus(`Loading ${stickerData.name}...`);
							try {
								stickerData.staticImageData = await this._loadStaticImage(stickerData.url);
							} catch (error) {
								throw new Error(`Failed to load static sticker ${stickerData.name}`);
							}
						}
						for (const source of glitterSources) {
							const glitter = library.find((item) => item.id === source.glitterId);
							if (!glitter) throw new Error(`Missing glitter ${source.glitterId}`);
							if (!glitter.frames) glitter.frames = await callbacks.parseGif(glitter.url);
						}
					},
					flattenFrames: (library, flattenSource) => {
						const stickerData = layer.stickerData;
						if (stickerData.isAnimated && stickerData.frames?.frames?.length) {
							flattenSource(layer.id, stickerData.frames, stickerData.name, true);
						}
						glitterSources.forEach((source) => {
							const glitter = library.find((item) => item.id === source.glitterId);
							if (glitter?.frames?.frames?.length) flattenSource(source.key, glitter.frames, `${glitter.name} (${source.slot})`, false);
						});
					},
					collectTransparencyFrames: (flattenedFrameMap, allFrames) => {
						const stickerData = layer.stickerData;
						if (stickerData.isAnimated) {
							const frames = flattenedFrameMap?.get(layer.id);
							if (frames?.length) {
								allFrames.push(...frames);
							}
						} else if (stickerData.staticImageData) {
							allFrames.push(stickerData.staticImageData);
						}
						glitterSources.forEach((source) => {
							const frames = flattenedFrameMap?.get(source.key);
							if (frames?.length) allFrames.push(...frames);
						});
					},
					collectFrameCounts: (library, layerFrameCounts) => {
						const frameCount = layer.stickerData.isAnimated
							? (layer.stickerData.frames?.frames?.length || layer.stickerData.frameCount || 1)
							: 1;
						layerFrameCounts.set(layer.id, frameCount);
						glitterSources.forEach((source) => {
							const glitter = library.find((item) => item.id === source.glitterId);
							layerFrameCounts.set(source.key, glitter?.frames?.frames?.length || glitter?.frameCount || 1);
						});
					},
					hasMultiFrameGlitter: (layerFrameCounts) => glitterSources.some((source) => (layerFrameCounts.get(source.key) || 0) > 1),
					render: ({ ctx, frameIndex, frameMap, flattenedFrameMap }) => {
						this._renderLayerToCanvas(layer, ctx, frameIndex, frameMap, flattenedFrameMap);
					}
				};
			}

			default:
				return {
					prepareMasks: async () => {},
					loadSources: async () => {},
					flattenFrames: () => {},
					collectTransparencyFrames: () => {},
					collectFrameCounts: () => {},
					hasMultiFrameGlitter: () => false,
					render: () => {}
				};
		}
	}

	_getTextEffectGlitterSources(layer) {
		// Single chokepoint for every export-side text-glitter enumeration
		// (frame flatten/load, total-frame count, transparency scan). A
		// solid-mode fill renders no glitter — including its stale
		// selectedGlitterId here would frame-count and flatten a source that
		// never appears, breaking preview↔export parity and static-GIF output.
		const sources = [];

		if (layer.textData?.fill?.mode === 'glitter') {
			sources.push({
				key: this._getTextFrameKey(layer, 'fill'),
				slot: 'fill',
				glitterId: layer.selectedGlitterId
			});
		}

		if (layer.textData?.border?.mode === 'glitter' && layer.textData.border.widthPx > 0 && layer.textData.border.glitterId) {
			sources.push({
				key: this._getTextFrameKey(layer, 'border'),
				slot: 'border',
				glitterId: layer.textData.border.glitterId
			});
		}

		if (layer.textData?.shadow?.mode === 'glitter' && layer.textData.shadow.glitterId) {
			sources.push({
				key: this._getTextFrameKey(layer, 'shadow'),
				slot: 'shadow',
				glitterId: layer.textData.shadow.glitterId
			});
		}

		return sources;
	}

	_renderFilledTextMaskToCanvas(layer, ctx, frameIndex, maskCanvas, source, sourceKey, frameMap, flattenedFrameMap) {
		if (!maskCanvas || !source) {
			return;
		}

		const fillCanvas = this._createFilledMaskCanvas(
			maskCanvas,
			source,
			layer,
			frameIndex,
			sourceKey,
			frameMap,
			flattenedFrameMap
		);

		this._drawTransformedCanvas(
			ctx,
			fillCanvas,
			getLayerTransform(layer),
			layer.textData.width,
			layer.textData.height
		);
	}

	_createFilledMaskCanvas(maskCanvas, source, layer, frameIndex, sourceKey, frameMap, flattenedFrameMap) {
		const fillCanvas = document.createElement('canvas');
		fillCanvas.width = maskCanvas.width;
		fillCanvas.height = maskCanvas.height;
		const fillCtx = fillCanvas.getContext('2d', { willReadFrequently: true, alpha: true });

		fillCtx.clearRect(0, 0, fillCanvas.width, fillCanvas.height);
		fillCtx.globalAlpha = source.opacity ?? 1;

		if (source.mode === 'solid') {
			fillCtx.fillStyle = source.color;
		} else if (source.mode === 'gradient') {
			fillCtx.fillStyle = createEffectCanvasGradient(fillCtx, source.gradient, {
				x: 0, y: 0, width: fillCanvas.width, height: fillCanvas.height
			});
		} else {
			const frameImageData = this._getFrameImageForKey(sourceKey, frameIndex, frameMap, flattenedFrameMap);
			const patternSource = this._patternSourceFromFrame(frameImageData, source.colorAdjust);

			const pattern = fillCtx.createPattern(patternSource, 'repeat');
			const sourceScale = source.scale ?? layer.settings.scale;
			const scale = (sourceScale <= 0 ? 1 : sourceScale) / 100;
			const matrix = new DOMMatrix().scaleSelf(scale, scale);
			pattern.setTransform(matrix);
			fillCtx.fillStyle = pattern;
		}

		fillCtx.fillRect(0, 0, fillCanvas.width, fillCanvas.height);
		fillCtx.globalCompositeOperation = 'destination-in';
		fillCtx.drawImage(maskCanvas, 0, 0);
		fillCtx.globalCompositeOperation = 'source-over';

		return fillCanvas;
	}

	// Build the repeating-pattern source canvas for a glitter frame, applying the
	// WP4 color-adjust matrix when the layer/slot has a non-identity adjustment.
	// The flattened frame is a shared cached ImageData, so a non-identity adjust
	// works on a COPY — never mutate the cache. Identity adjust puts the original
	// bytes straight through, keeping export byte-identical to pre-WP4 content.
	_patternSourceFromFrame(frameImageData, colorAdjust) {
		const patternSource = document.createElement('canvas');
		patternSource.width = frameImageData.width;
		patternSource.height = frameImageData.height;
		const pctx = patternSource.getContext('2d');

		if (colorAdjust && !isIdentityColorAdjust(colorAdjust)) {
			const copy = new ImageData(
				new Uint8ClampedArray(frameImageData.data),
				frameImageData.width,
				frameImageData.height
			);
			applyColorAdjustToImageData(copy, colorAdjust);
			pctx.putImageData(copy, 0, 0);
		} else {
			pctx.putImageData(frameImageData, 0, 0);
		}

		return patternSource;
	}

	_hashBasePixels(pixels) {
		let hash = 2166136261;
		for (let index = 0; index < pixels.length; index += 4) {
			hash = Math.imul(hash ^ pixels[index], 16777619);
			hash = Math.imul(hash ^ pixels[index + 1], 16777619);
			hash = Math.imul(hash ^ pixels[index + 2], 16777619);
			hash = Math.imul(hash ^ pixels[index + 3], 16777619);
		}
		return hash >>> 0;
	}

	_getBasePipelineImageData(layer, canvasData, frameIndex) {
		const { width, height, originalData } = canvasData;
		const background = layer.background;
		let source;
		if (background.mode === 'gradient') {
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const sourceCtx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
			sourceCtx.fillStyle = createEffectCanvasGradient(sourceCtx, background.gradient, { x: 0, y: 0, width, height });
			sourceCtx.fillRect(0, 0, width, height);
			source = sourceCtx.getImageData(0, 0, width, height);
		} else {
			source = new ImageData(new Uint8ClampedArray(originalData), width, height);
		}
		const settings = GlitterPixelEffects.normalizeSettings(background.pixelEffects || background.posterize, CONFIG.tools.pixelEffects);
		const shimmerFrame = settings.paletteEnabled && settings.paletteMode === 'dither' && settings.dither.shimmer
			&& GlitterPixelEffects.getShimmerAnimation(settings.dither.algorithm, CONFIG.tools.pixelEffects) ? frameIndex : 0;
		const sourceHash = this._hashBasePixels(source.data);
		const key = `${width}x${height}:${sourceHash}:${JSON.stringify(settings)}:${JSON.stringify(background.colorAdjust)}:${background.opacity}:${shimmerFrame}`;
		const cached = this.basePixelEffectCache.get(key);
		if (cached) return cached;
		let ditherPalette = null;
		if (settings.paletteEnabled && settings.paletteMode === 'dither') {
			const paletteKey = `${width}x${height}:${sourceHash}:${settings.pixelSize}:${settings.colorCount}:${settings.paletteStyle}:${settings.mergeDistinctness}:${settings.dither.palette}:${settings.dither.duotone.join(',')}`;
			ditherPalette = this.baseDitherPaletteCache.get(paletteKey);
			if (!ditherPalette) {
				const pixelized = GlitterPixelEffects.pixelize(source.data, width, height, settings.pixelateEnabled ? settings.pixelSize : 1);
				ditherPalette = GlitterPixelEffects.getPalette(pixelized, width, height, settings, {
					pixelEffects: CONFIG.tools.pixelEffects,
					autoGlitter: CONFIG.tools.autoGlitter
				});
				this.baseDitherPaletteCache.set(paletteKey, ditherPalette);
				while (this.baseDitherPaletteCache.size > 16) this.baseDitherPaletteCache.delete(this.baseDitherPaletteCache.keys().next().value);
			}
		}
		const data = !settings.pixelateEnabled && !settings.paletteEnabled
			? new Uint8ClampedArray(source.data)
			: GlitterPixelEffects.applyPixelEffects(source.data, width, height, settings, {
				pixelEffects: CONFIG.tools.pixelEffects,
				autoGlitter: CONFIG.tools.autoGlitter
			}, shimmerFrame, ditherPalette);
		const result = new ImageData(data, width, height);
		applyColorAdjustToImageData(result, background.colorAdjust);
		if ((background.opacity ?? 100) < 100) {
			for (let offset = 3; offset < result.data.length; offset += 4) result.data[offset] = Math.round(result.data[offset] * background.opacity / 100);
		}
		this.basePixelEffectCache.set(key, result);
		while (this.basePixelEffectCache.size > 32) this.basePixelEffectCache.delete(this.basePixelEffectCache.keys().next().value);
		return result;
	}

	_getFrameImageForKey(sourceKey, frameIndex, frameMap, flattenedFrameMap) {
		const frames = flattenedFrameMap?.get(sourceKey);
		if (!frames?.length) {
			throw new Error(`Missing flattened glitter frames for ${sourceKey}`);
		}

		const reducedFrameCount = frameMap?.get(sourceKey);
		const frameIndexForLayer = this._getReducedFrameIndex(frameIndex, frames.length, reducedFrameCount);
		const frameImageData = frames[frameIndexForLayer];
		if (!frameImageData) {
			throw new Error(`Invalid glitter frame for ${sourceKey} frame ${frameIndexForLayer}`);
		}

		return frameImageData;
	}

	_buildTextMaskEntry(layer, fillMaskCanvas) {
		const entry = {
			fill: fillMaskCanvas,
			border: null,
			shadow: null
		};

		if (layer.textData?.shadow) {
			entry.shadow = this._createOffsetMaskCanvas(
				fillMaskCanvas,
				layer.textData.shadow.offsetX || 0,
				layer.textData.shadow.offsetY || 0
			);
		}

		if (layer.textData?.border?.widthPx > 0) {
			entry.border = this._createPlacedBorderMaskCanvas(fillMaskCanvas, layer.textData.border);
		}

		return entry;
	}

	_getBorderPlacement(borderData) {
		return borderData?.placement === 'inside'
			? 'inside'
			: borderData?.placement === 'center'
				? 'center'
				: 'outside';
	}

	_getBorderDrawOrder(borderData) {
		return borderData?.drawOrder === 'front' ? 'front' : 'behind';
	}

	_getBorderEdgeStyle(borderData) {
		return borderData?.edgeStyle === 'hard' ? 'hard' : 'round';
	}

	_createPlacedBorderMaskCanvas(fillMaskCanvas, borderData) {
		const widthPx = Math.max(0, borderData?.widthPx || 0);
		if (widthPx <= 0) {
			return null;
		}

		const placement = this._getBorderPlacement(borderData);
		const edgeStyle = this._getBorderEdgeStyle(borderData);
		if (placement === 'inside') {
			return this._createMaskDifferenceCanvas(
				fillMaskCanvas,
				this._createErodedMaskCanvas(fillMaskCanvas, widthPx, edgeStyle)
			);
		}
		if (placement === 'center') {
			return this._createMaskDifferenceCanvas(
				this._createDilatedMaskCanvas(fillMaskCanvas, Math.ceil(widthPx / 2), edgeStyle),
				this._createErodedMaskCanvas(fillMaskCanvas, Math.floor(widthPx / 2), edgeStyle)
			);
		}
		return this._createMaskDifferenceCanvas(
			this._createDilatedMaskCanvas(fillMaskCanvas, widthPx, edgeStyle),
			fillMaskCanvas
		);
	}

	_createMaskDifferenceCanvas(baseCanvas, subtractCanvas) {
		const canvas = document.createElement('canvas');
		canvas.width = baseCanvas.width;
		canvas.height = baseCanvas.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
		ctx.drawImage(baseCanvas, 0, 0);
		if (subtractCanvas) {
			ctx.globalCompositeOperation = 'destination-out';
			ctx.drawImage(subtractCanvas, 0, 0);
			ctx.globalCompositeOperation = 'source-over';
		}
		return canvas;
	}

	_createDilatedMaskCanvas(sourceCanvas, radius, edgeStyle = 'round') {
		const nextRadius = Math.max(0, Math.round(radius));
		if (nextRadius <= 0) {
			return sourceCanvas;
		}

		if (edgeStyle === 'hard') {
			const horizontal = document.createElement('canvas');
			horizontal.width = sourceCanvas.width;
			horizontal.height = sourceCanvas.height;
			const horizontalCtx = horizontal.getContext('2d', { willReadFrequently: true, alpha: true });
			for (let offsetX = -nextRadius; offsetX <= nextRadius; offsetX++) {
				horizontalCtx.drawImage(sourceCanvas, offsetX, 0);
			}

			const canvas = document.createElement('canvas');
			canvas.width = sourceCanvas.width;
			canvas.height = sourceCanvas.height;
			const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
			for (let offsetY = -nextRadius; offsetY <= nextRadius; offsetY++) {
				ctx.drawImage(horizontal, 0, offsetY);
			}
			return canvas;
		}

		const canvas = document.createElement('canvas');
		canvas.width = sourceCanvas.width;
		canvas.height = sourceCanvas.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
		ctx.drawImage(sourceCanvas, 0, 0);
		this._getMorphOffsets(nextRadius).forEach((offset) => {
			ctx.drawImage(sourceCanvas, offset.x, offset.y);
		});
		return canvas;
	}

	_createErodedMaskCanvas(sourceCanvas, radius, edgeStyle = 'round') {
		const nextRadius = Math.max(0, Math.round(radius));
		if (nextRadius <= 0) {
			return sourceCanvas;
		}

		if (edgeStyle === 'hard') {
			const horizontal = document.createElement('canvas');
			horizontal.width = sourceCanvas.width;
			horizontal.height = sourceCanvas.height;
			const horizontalCtx = horizontal.getContext('2d', { willReadFrequently: true, alpha: true });
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
			const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
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
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
		ctx.drawImage(sourceCanvas, 0, 0);
		ctx.globalCompositeOperation = 'destination-in';
		this._getMorphOffsets(nextRadius).forEach((offset) => {
			ctx.drawImage(sourceCanvas, -offset.x, -offset.y);
		});
		ctx.globalCompositeOperation = 'source-over';
		return canvas;
	}

	_getMorphOffsets(widthPx) {
		const radius = Math.max(1, widthPx);
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

	_createOffsetMaskCanvas(sourceCanvas, offsetX, offsetY) {
		const canvas = document.createElement('canvas');
		canvas.width = sourceCanvas.width;
		canvas.height = sourceCanvas.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
		ctx.drawImage(sourceCanvas, offsetX, offsetY);
		return canvas;
	}

	_createBorderMaskCanvas(fillMaskCanvas, widthPx, cutOutFill = false) {
		const canvas = document.createElement('canvas');
		canvas.width = fillMaskCanvas.width;
		canvas.height = fillMaskCanvas.height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });

		const radius = Math.max(1, widthPx);
		// Lockstep with TextGlitterManager.getBorderOffsets — sample count scales
		// with radius so wide borders don't scallop.
		const steps = Math.max(16, Math.min(64, Math.ceil(radius * 4)));
		const seen = new Set();

		for (let index = 0; index < steps; index++) {
			const angle = (Math.PI * 2 * index) / steps;
			const x = Math.round(Math.cos(angle) * radius);
			const y = Math.round(Math.sin(angle) * radius);
			const key = `${x},${y}`;
			if (seen.has(key) || (x === 0 && y === 0)) {
				continue;
			}
			seen.add(key);
			ctx.drawImage(fillMaskCanvas, x, y);
		}

		if (cutOutFill) {
			ctx.globalCompositeOperation = 'destination-out';
			ctx.drawImage(fillMaskCanvas, 0, 0);
			ctx.globalCompositeOperation = 'source-over';
		}

		return canvas;
	}

	_isTransparencyFilled(layers, maskDataMap, canvasData) {
		return layers.some(layer => {
			if (
				!layer.visible ||
				layer.type !== LayerType.GLITTER_FILL ||
				layer.settings.opacity !== 100
			) {
				return false;
			}

			const maskData = maskDataMap.get(layer.id);
			if (!maskData) {
				return false;
			}

			for (let i = 0; i < maskData.length; i++) {
				if (maskData[i] > 0 && canvasData.originalAlpha[i] < canvasData.alphaThreshold) {
					return true;
				}
			}

			return false;
		});
	}


	async process(params) {
		const { visibleLayers, glitterGifs, canvasData, exportSettings, callbacks, frameSink = null } = params;

		// Validate frame delay at the start
		exportSettings.frameDelay = Math.max(20, exportSettings.frameDelay || 100);

		// 1. Ensure Frames Loaded
		callbacks.onProgress(0, 'Loading glitter frames...', 0, 0);
		await this._loadMissingFrames(visibleLayers, glitterGifs, callbacks);

		// 1.5. Prepare masks so preview and export share identical data
		callbacks.onProgress(3, 'Preparing masks...', 0, 0);
		const maskDataMap = new Map();
		const maskCanvases = new Map();
		const textMaskCanvases = new Map();
		const shapeMaskCanvases = new Map();
		for (const layer of visibleLayers) {
			await this._buildLayerExportPlan(layer).prepareMasks({
				maskDataMap,
				maskCanvases,
				textMaskCanvases,
				shapeMaskCanvases,
				canvasData,
				callbacks
			});
		}

		// 1.75. Load Watermark (if enabled)
		let watermark = null;
		if (exportSettings.watermarkEnabled) {
			watermark = await this._loadWatermark(callbacks);
			if (watermark) {
				dbg('[GifExporter] Watermark loaded:', watermark);
			}
		}

		// 2. De-Optimize Frames
		callbacks.onProgress(5, 'Processing frames...', 0, 0);
		const flattenedFrameMap = this._buildFlattenedFrameMap(visibleLayers, glitterGifs);

		// De-optimize watermark if animated
		if (watermark && watermark.isAnimated) {
			this._deoptimizeWatermarkFrames(watermark);
		}

		// Around line 6596-6611 - Fix transparency detection when base is off
		// 3. TRANSPARENCY DETECTION
		const originalHasTransparency = this._hasTransparency(canvasData);
		const transparencyIsFilled = this._isTransparencyFilled(visibleLayers, maskDataMap, canvasData);

		// Check if the base layer is actually being rendered
		const baseLayer = visibleLayers.find(l => l.type === LayerType.BASE_IMAGE);
		const baseMode = baseLayer?.background?.mode || 'image';
		const baseHasImageSource = baseMode !== 'image' || canvasData.hasBaseImage !== false;
		const baseIsEffectivelyVisible = baseLayer && (baseLayer.visible !== false) && exportSettings.baseImage && baseMode !== 'none' && baseHasImageSource;
		const baseOpacity = baseLayer?.background?.opacity ?? 100;
		const baseHasTransparency = !baseIsEffectivelyVisible
			|| baseOpacity < 100
			|| (baseMode === 'image' && originalHasTransparency)
			|| (baseMode === 'gradient' && normalizeEffectGradient(baseLayer.background.gradient).stops.some((stop) => stop.alpha < 1));

		// If the base layer is hidden, the background is effectively transparent
		const effectiveHasTransparency = baseHasTransparency;

		// When base is off, honor transparency setting regardless of fill.
		// When base is ON, only enable transparency if it's not being consumed by opaque fill
		const needsTransparency = exportSettings.transparency && (
			!baseIsEffectivelyVisible || // Base off = always respect transparency checkbox
			(effectiveHasTransparency && !transparencyIsFilled) // Base on = only if not filled
		);

		const safeKey = needsTransparency
			? this._findSafeTransparencyKey(visibleLayers, glitterGifs, canvasData, watermark, flattenedFrameMap)
			: null;

		if (safeKey) {
			dbg(`[GifExporter] Selected Safe Transparency Key: RGB(${safeKey.r}, ${safeKey.g}, ${safeKey.b})`);
		}

		// 4. Build a time-based plan from the timing of every visible source.
		const timelineConfig = CONFIG.export.timeline;
		const presetName = exportSettings.optimizationPreset || timelineConfig.defaultPreset;
		const preset = timelineConfig.presets[presetName] || timelineConfig.presets[timelineConfig.defaultPreset];
		const sourceTimelines = [...(flattenedFrameMap.sourceTimelines || [])];
		const shimmerBase = visibleLayers.find((layer) => {
			if (layer.type !== LayerType.BASE_IMAGE || layer.visible === false || !exportSettings.baseImage) return false;
			const settings = GlitterPixelEffects.normalizeSettings(layer.background?.pixelEffects || layer.background?.posterize, CONFIG.tools.pixelEffects);
			return ['image', 'gradient'].includes(layer.background?.mode || 'image') && settings.paletteEnabled && settings.paletteMode === 'dither'
				&& settings.dither.shimmer && GlitterPixelEffects.getShimmerAnimation(settings.dither.algorithm, CONFIG.tools.pixelEffects);
		});
		if (shimmerBase) {
			const settings = GlitterPixelEffects.normalizeSettings(shimmerBase.background?.pixelEffects || shimmerBase.background?.posterize, CONFIG.tools.pixelEffects);
			const animation = GlitterPixelEffects.getShimmerAnimation(settings.dither.algorithm, CONFIG.tools.pixelEffects);
			sourceTimelines.push(new AnimationSourceTimeline({
				key: '__base_dither',
				ownerLayerId: shimmerBase.id,
				frames: Array.from({ length: animation.frames }, (_value, index) => index),
				fallbackDuration: CONFIG.tools.pixelEffects.animation.frameDurationMs
			}));
		}
		if (watermark?.isAnimated) {
			sourceTimelines.push(new AnimationSourceTimeline({
				key: '__watermark',
				frames: watermark.frames,
				frameDurations: watermark.frameDelays || [],
				fallbackDuration: watermark.frameDelay || exportSettings.frameDelay
			}));
		}

		callbacks.onStatus('Planning animation timing...');
		callbacks.onProgress(10, 'Preparing timeline...', 0, 0);
		this.helperCanvas.width = canvasData.width;
		this.helperCanvas.height = canvasData.height;
		this.canvas.width = canvasData.width;
		this.canvas.height = canvasData.height;
		let renderedCandidateCount = 0;
		const planner = new CompositeTimelinePlanner(timelineConfig);
		const plan = await planner.plan({
			timelines: sourceTimelines,
			fallbackDuration: exportSettings.frameDelay,
			maxLoopDurationMs: timelineConfig.maxLoopDurationMs,
			maxSamplingFps: exportSettings.maxSamplingFps || preset.maxSamplingFps,
			manualFrameSkip: exportSettings.exportFrameSkip,
			reverse: exportSettings.exportReverse,
			smartReduction: exportSettings.smartFrameReduction,
			visualErrorThreshold: Number.isFinite(exportSettings.visualErrorThreshold)
				? exportSettings.visualErrorThreshold
				: preset.visualError,
			preferredFrameBudget: exportSettings.maxFrames || timelineConfig.preferredFrameBudget,
			hardFrameLimit: timelineConfig.hardFrameLimit,
			renderFrame: (timestamp, frameSelection) => {
				renderedCandidateCount++;
				callbacks.onProgress(10, `Composing frame ${renderedCandidateCount}...`, renderedCandidateCount, 0);
				return this._renderFrame(
					0,
					canvasData,
					visibleLayers,
					glitterGifs,
					maskCanvases,
					textMaskCanvases,
					shapeMaskCanvases,
					safeKey,
					exportSettings,
					watermark,
					needsTransparency,
					frameSelection,
					flattenedFrameMap
				);
			}
		});
		plan.width = canvasData.width;
		plan.height = canvasData.height;
		plan.frameDelay = plan.totalDuration / plan.frames.length;
		plan.colorAnalysis = this._analyzeGifColors(plan.frames);
		if (plan.colorAnalysis) plan.colorAnalysis.ditherEnabled = Boolean(exportSettings.ditherEnabled);
		plan.reductions = [];
		if (plan.reduction.exactDuplicatesMerged) plan.reductions.push({ reason: 'exact-duplicates', count: plan.reduction.exactDuplicatesMerged });
		if (plan.reduction.nearDuplicatesMerged) plan.reductions.push({ reason: 'near-duplicates', count: plan.reduction.nearDuplicatesMerged });
		if (!plan.loopSeam.exact) callbacks.onStatus('Loop optimized with a best-fit seam; the exact common loop was too long.');
		if (plan.reduction.budgetCompromiseRequired) callbacks.onStatus('The hard frame limit requires a quality compromise; no frames were silently truncated.');

		// 5. Setup Encoder with Adaptive Quality
		let finalQuality = exportSettings.quality;

		if (this.config.useAdaptiveQuality && !exportSettings.quality) {
			const pixelCount = canvasData.width * canvasData.height;
			finalQuality = pixelCount > 100000 ? 10 : 5;
			dbg(`[GifExporter] Using adaptive quality: ${finalQuality} (${pixelCount} pixels)`);
		} else {
			dbg(`[GifExporter] Using fixed quality: ${finalQuality}`);
		}

		const gifOptions = {
			workers: this.config.workers,
			quality: finalQuality,
			width: canvasData.width,
			height: canvasData.height,
			workerScript: this.config.workerScript,
			dither: needsTransparency
				? false
				: (exportSettings.ditherEnabled ? exportSettings.ditherType : false)
		};

		if (needsTransparency && safeKey) {
			gifOptions.transparent = safeKey.hex;
			gifOptions.background = safeKey.hex;
			dbg('[GifExporter] Transparency enabled with key:', safeKey.hex);
		}

		if (frameSink) {
			return frameSink(plan);
		}

		const gif = new GIF(gifOptions);
		plan.frames.forEach((frame, index) => gif.addFrame(frame, {
			delay: plan.frameDurations[index],
			copy: true
		}));

		// 6. Output
		callbacks.onProgress(75, 'Encoding GIF...', plan.frames.length, plan.frames.length);

		// NOTE: these fire from gif.js's event emitter, outside the caller's
		// try/catch — throwing here would leave the progress bar stuck and the
		// export button disabled forever. Route to the error callback instead.
		gif.on('error', (error) => {
			if (this.config.debug) console.error('GIF encoding error:', error);
			if (callbacks.onError) callbacks.onError(new Error('GIF encoding failed: ' + error.message));
		});

		gif.on('abort', () => {
			if (callbacks.onError) callbacks.onError(new Error('Export cancelled'));
		});

		gif.on('finished', (blob) => this._handleFileSave(blob, callbacks, plan));

		dbg('Starting GIF render:', {
			originalFrames: plan.reduction.originalFrameCount,
			renderedFrames: plan.frames.length,
			totalDuration: plan.totalDuration,
			workers: this.config.workers,
			quality: exportSettings.quality,
			key: safeKey,
			transparencyActive: needsTransparency
		});

		gif.render();
	}

	// --- HELPER METHODS ---

	_findSafeTransparencyKey(layers, library, canvasData, watermark = null, flattenedFrameMap = null) {
		const candidates = [
			// Use colors far from black - start with bright magenta
			{ name: 'Magenta', r: 255, g: 0, b: 255, hex: 0xFF00FF },
			{ name: 'Cyan', r: 0, g: 255, b: 255, hex: 0x00FFFF },
			{ name: 'Yellow', r: 255, g: 255, b: 0, hex: 0xFFFF00 },
			// Fallback to originals if needed
			{ name: 'DarkGray1', r: 1, g: 1, b: 1, hex: 0x010101 },
			{ name: 'DarkGray2', r: 2, g: 2, b: 2, hex: 0x020202 },
			{ name: 'DarkGray3', r: 3, g: 3, b: 3, hex: 0x030303 },
			{ name: 'OffGreen', r: 0, g: 1, b: 0, hex: 0x000100 }
		];

		// Collect all frames from all sources
		const allFrames = [];

		layers.forEach(layer => {
			this._buildLayerExportPlan(layer).collectTransparencyFrames(flattenedFrameMap, allFrames);
		});
		const baseLayer = layers.find((layer) => layer.type === LayerType.BASE_IMAGE && layer.visible !== false);
		if (baseLayer && ['image', 'gradient'].includes(baseLayer.background?.mode || 'image')) {
			allFrames.push(this._getBasePipelineImageData(baseLayer, canvasData, 0));
		}

		// Add watermark frames if present
		if (watermark) {
			if (watermark.isAnimated && watermark.frames) {
				allFrames.push(...watermark.frames);
			} else if (!watermark.isAnimated && watermark.imageData) {
				allFrames.push(watermark.imageData);
			}
		}

		for (const candidate of candidates) {
			let isSafe = true;

			// Check base image
			const imgData = canvasData.originalData;
			const imgLen = imgData.length;

			for (let i = 0; i < imgLen; i += 4) {
				const pixelIndex = i / 4;
				if (canvasData.originalAlpha[pixelIndex] < canvasData.alphaThreshold) continue;

				if (imgData[i] === candidate.r &&
					imgData[i + 1] === candidate.g &&
					imgData[i + 2] === candidate.b) {
					isSafe = false;
					break;
				}
			}

			if (!isSafe) continue;

			// Check all frames (glitter and stickers)
			for (const frame of allFrames) {
				const imageData = this._getFrameImageData(frame);
				if (!imageData) {
					isSafe = false;
					break;
				}

				const data = imageData.data;
				const len = data.length;

				for (let i = 0; i < len; i += 4) {
					if (data[i + 3] === 0) continue; // Skip transparent pixels
					if (data[i] === candidate.r &&
						data[i + 1] === candidate.g &&
						data[i + 2] === candidate.b) {
						isSafe = false;
						break;
					}
				}
				if (!isSafe) break;
			}

			if (isSafe) {
				dbg(`[GifExporter] Found safe transparency key: ${candidate.name} RGB(${candidate.r}, ${candidate.g}, ${candidate.b})`);
				return candidate;
			}
		}

		if (this.config.debug) console.warn('[GifExporter] All candidates failed. Using ultra-dark fallback.');
		return { name: 'Fallback', hex: 0x000001, r: 0, g: 0, b: 1 };
	}

	_renderFrame(frameIndex, canvasData, layers, library, maskCanvases, textMaskCanvases, shapeMaskCanvases, safeKey, exportSettings, watermark, needsTransparency, frameMap = null, flattenedFrameMap = null) {
		const { width, height, originalData, originalAlpha, alphaThreshold } = canvasData;
		const ctx = this.ctx;
		const hCtx = this.helperCtx;

		// 1. Reset/Setup Canvas
		this.canvas.width = width;
		this.canvas.height = height;
		ctx.clearRect(0, 0, width, height);

		// 2. Identify Base Image Visibility
		const baseLayer = layers.find(l => l.type === LayerType.BASE_IMAGE);
		const isBaseLayerVisible = baseLayer ? (baseLayer.visible !== false) : false;
		const shouldRenderBase = exportSettings.baseImage && isBaseLayerVisible;
		const baseMode = baseLayer?.background?.mode || 'image';

		// 3. Determine Background Fill Color
		let bgR, bgG, bgB;
		if (needsTransparency && safeKey) {
			bgR = safeKey.r;
			bgG = safeKey.g;
			bgB = safeKey.b;
		} else {
			const matte = this._parseHexColor(exportSettings.matteColor || '#ffffff');
			bgR = matte.r;
			bgG = matte.g;
			bgB = matte.b;
		}

		// 4. Draw Base Image or Fill Background
		ctx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
		ctx.fillRect(0, 0, width, height);

		if (shouldRenderBase && ((baseMode === 'image' && canvasData.hasBaseImage !== false) || baseMode === 'gradient')) {
			const baseEffectFrame = frameMap?.get('__base_dither')?.frameIndex ?? frameIndex;
			const baseImage = this._getBasePipelineImageData(baseLayer, canvasData, baseEffectFrame);
			if (needsTransparency) {
				// SCENARIO A: GIF Transparency is ACTIVE.
				const bgImage = new ImageData(new Uint8ClampedArray(baseImage.data), width, height);
				const data = bgImage.data;

				for (let i = 0; i < originalAlpha.length; i++) {
					if (data[i * 4 + 3] < alphaThreshold) {
						const offset = i * 4;
						data[offset] = bgR;
						data[offset + 1] = bgG;
						data[offset + 2] = bgB;
						data[offset + 3] = 255;
					}
				}
				ctx.putImageData(bgImage, 0, 0);
			} else {
				// SCENARIO B: GIF Transparency is INACTIVE (Matte mode or Consumption mode).
				hCtx.canvas.width = width;
				hCtx.canvas.height = height;
				hCtx.clearRect(0, 0, width, height);
				hCtx.putImageData(baseImage, 0, 0);
				ctx.drawImage(this.helperCanvas, 0, 0);
			}
		}

		// 5. Composite Glitter and Sticker Layers (in correct z-order)
		layers.forEach((layer) => {
			if (layer.visible === false) return;
			if (layer.type === LayerType.BASE_IMAGE && !exportSettings.baseImage) return;
			this._buildLayerExportPlan(layer).render({
				ctx,
				frameIndex,
				frameMap,
				flattenedFrameMap,
				maskCanvases,
				textMaskCanvases,
				shapeMaskCanvases,
				helperCtx: hCtx,
				width,
				height
			});
		});

		// 6. Render Watermark
		if (exportSettings.watermarkEnabled && watermark) {
			const watermarkFrame = frameMap?.get('__watermark')?.frameIndex ?? frameIndex;
			this._renderWatermarkToCanvas(watermark, ctx, width, height, watermarkFrame);
		}

		// 8. Debug logic for problem frames
		if (this.config.debug && (frameIndex === 0 || frameIndex === 1)) {
			let safeKeyInFrame = 0;
			let data = ctx.getImageData(0, 0, width, height).data;
			for (let i = 0; i < data.length; i += 4) {
				if (data[i] === bgR && data[i + 1] === bgG && data[i + 2] === bgB) {
					safeKeyInFrame++;
				}
			}
			dbg(`[GifExporter] Frame ${frameIndex} background color pixels: ${safeKeyInFrame}`);
		}

		return ctx.getImageData(0, 0, width, height);
	}

	async _parseGifWithMetadata(url, providedBytes = null) {
		try {
			let uintArray = providedBytes;
			if (!uintArray) {
				const response = await fetch(url);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const arrayBuffer = await response.arrayBuffer();
				if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('Empty file');
				uintArray = new Uint8Array(arrayBuffer);
			}
			const reader = new GifReader(uintArray);
			const frameCount = reader.numFrames();

			if (frameCount === 0) throw new Error('GIF has 0 frames');

			const width = reader.width;
			const height = reader.height;
			const frames = [];
			const frameDelays = [];

			for (let i = 0; i < frameCount; i++) {
				const frameInfo = reader.frameInfo(i);
				frameDelays.push(AnimationSourceTimeline.normalizeDuration(frameInfo.delay * 10, 100));

				// Get full canvas data
				const fullPixels = new Uint8ClampedArray(width * height * 4);
				reader.decodeAndBlitFrameRGBA(i, fullPixels);

				// Extract patch dimensions
				const patchX = frameInfo.x || 0;
				const patchY = frameInfo.y || 0;
				const patchW = frameInfo.width || width;
				const patchH = frameInfo.height || height;

				// Extract the patch from full canvas
				const patchData = new Uint8ClampedArray(patchW * patchH * 4);
				for (let y = 0; y < patchH; y++) {
					for (let x = 0; x < patchW; x++) {
						const srcIdx = ((patchY + y) * width + (patchX + x)) * 4;
						const dstIdx = (y * patchW + x) * 4;
						patchData[dstIdx] = fullPixels[srcIdx];
						patchData[dstIdx + 1] = fullPixels[srcIdx + 1];
						patchData[dstIdx + 2] = fullPixels[srcIdx + 2];
						patchData[dstIdx + 3] = fullPixels[srcIdx + 3];
					}
				}

				// Return in same format as glitter parser expects
				frames.push({
					data: patchData,  // Patch-sized raw data
					width: patchW,
					height: patchH,
					x: patchX,
					y: patchY,
					disposal: frameInfo.disposal
				});
			}

			return {
				width,
				height,
				frames,
				frameCount,
				frameDelay: frameDelays[0],
				frameDelays,
				isVariableFramerate: new Set(frameDelays).size > 1
			};
		} catch (error) {
			if (this.config.debug) console.error(`[_parseGifWithMetadata] Error loading ${url}:`, error);
			throw error;
		}
	}

	_buildFlattenedFrameMap(layers, library) {
		const flattenedFrameMap = new Map();
		const sourceTimelines = [];
		const flattenSource = (mapKey, animation, name, isSticker) => {
			let glitterHasTransparency = false;
			const rawFrames = animation.frames;
			const width = animation.width;
			const height = animation.height;
			const flattenedFrames = [];

			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			ctx.imageSmoothingEnabled = false;

			const tempCanvas = document.createElement('canvas');
			tempCanvas.width = width;
			tempCanvas.height = height;
			const tempCtx = tempCanvas.getContext('2d');
			tempCtx.imageSmoothingEnabled = false;

			let previousFrameData = null;
			let previousDisposal = null;

			if (rawFrames.length > 0) {
				const firstFrameImage = this._getFrameImageData(rawFrames[0], width, height);
				if (!firstFrameImage) {
					throw new Error(`Invalid first frame for "${name}"`);
				}

				const firstFrameData = firstFrameImage.data;
				for (let j = 3; j < firstFrameData.length; j += 4) {
					if (firstFrameData[j] < 255) {
						glitterHasTransparency = true;
						dbg(`[GifExporter] "${name}" pre-check: Has transparency detected`);
						break;
					}
				}
			}

			let useOriginalDisposal = isSticker;
			let calculatedDisposal = null;

			if (!useOriginalDisposal) {
				let usesDeltas = false;
				let needsClearing = false;
				let isAnimation = false;

				if (rawFrames.length > 1) {
					const frame1Image = this._getFrameImageData(rawFrames[0], width, height);
					const frame2Image = this._getFrameImageData(rawFrames[1], width, height);
					if (!frame1Image || !frame2Image) {
						throw new Error(`Invalid animation frames for "${name}"`);
					}

					const frame1Data = frame1Image.data;
					const frame2Data = frame2Image.data;
					let transparentCount = 0;
					let opaqueCount = 0;
					let differentPixels = 0;

					for (let i = 0; i < frame2Data.length; i += 4) {
						const alpha = frame2Data[i + 3];

						if (alpha === 0) transparentCount++;
						else if (alpha === 255) opaqueCount++;

						if (Math.abs(frame1Data[i] - frame2Data[i]) > 10 ||
							Math.abs(frame1Data[i + 1] - frame2Data[i + 1]) > 10 ||
							Math.abs(frame1Data[i + 2] - frame2Data[i + 2]) > 10 ||
							Math.abs(frame1Data[i + 3] - frame2Data[i + 3]) > 10) {
							differentPixels++;
						}
					}

					const totalPixels = frame2Data.length / 4;
					const transparentPercent = (transparentCount / totalPixels) * 100;
					const differentPercent = (differentPixels / totalPixels) * 100;

					usesDeltas = (transparentPercent > 60 || transparentPercent < 30);
					isAnimation = transparentPercent >= 30 && transparentPercent <= 60 && differentPercent < 25;
					needsClearing = (differentPixels > 20 && !usesDeltas) || isAnimation;

					dbg(`[DEBUG] "${name}" - Frame 2: ${transparentPercent.toFixed(1)}% transparent, ${differentPercent.toFixed(1)}% different, usesDeltas: ${usesDeltas}, isAnimation: ${isAnimation}, needsClearing: ${needsClearing}`);
				}

				if (glitterHasTransparency) {
					calculatedDisposal = 2;
				} else if (usesDeltas) {
					calculatedDisposal = 1;
				} else if (needsClearing) {
					calculatedDisposal = 2;
				} else {
					calculatedDisposal = 1;
				}
				dbg(`[DISPOSAL] "${name}": Calculated strategy = ${calculatedDisposal === 1 ? 'STACK' : 'CLEAR'} (hasTransparency: ${glitterHasTransparency})`);
			} else {
				dbg(`[DISPOSAL] "${name}": Using original frame disposal methods (sticker)`);
			}

			for (let i = 0; i < rawFrames.length; i++) {
				const frame = rawFrames[i];
				const frameImageData = this._getFrameImageData(frame, width, height);
				if (!frameImageData) {
					throw new Error(`Invalid frame ${i} for "${name}"`);
				}

				const currentDisposal = useOriginalDisposal
					? (frame.disposal === 0 || frame.disposal == null ? 1 : frame.disposal)
					: calculatedDisposal;

				if (i > 0 && previousDisposal === 2) {
					ctx.clearRect(0, 0, width, height);
				} else if (i > 0 && previousDisposal === 3 && previousFrameData) {
					ctx.putImageData(previousFrameData, 0, 0);
				}

				if (currentDisposal === 3) {
					previousFrameData = ctx.getImageData(0, 0, width, height);
				}

				tempCtx.putImageData(frameImageData, 0, 0);
				ctx.drawImage(tempCanvas, 0, 0);

				const flattenedData = ctx.getImageData(0, 0, width, height);
				flattenedFrames.push(flattenedData);

				if (i === 0) {
					const checkData = flattenedData.data;
					for (let j = 3; j < checkData.length; j += 4) {
						if (checkData[j] < 255) {
							glitterHasTransparency = true;
							break;
						}
					}
					dbg(`[GifExporter] "${name}" (${isSticker ? 'sticker' : 'glitter'}) has transparency: ${glitterHasTransparency}, disposal: ${currentDisposal}`);
				}

				previousDisposal = currentDisposal;
			}

			flattenedFrameMap.set(mapKey, flattenedFrames);
			sourceTimelines.push(new AnimationSourceTimeline({
				key: mapKey,
				ownerLayerId: String(mapKey).split(':')[0],
				effectSlot: String(mapKey).includes(':') ? String(mapKey).split(':').at(-1) : null,
				frames: flattenedFrames,
				frameDurations: animation.frameDelays || [],
				fallbackDuration: animation.frameDelay || CONFIG.export.defaults.frameDelay
			}));
		};

		layers.forEach((layer) => {
			this._buildLayerExportPlan(layer).flattenFrames(library, flattenSource);
		});
		flattenedFrameMap.sourceTimelines = sourceTimelines;

		return flattenedFrameMap;
	}

	async estimateLoopDuration({ layers, library, fallbackDuration, parseGif }) {
		await this._loadMissingFrames(layers, library, {
			parseGif,
			onStatus: () => {},
			// Estimation only reads animation timing; fonts are needed later when
			// the full export path renders text masks.
			ensureTextFont: async () => {}
		});
		const timelines = [];
		const collectTimeline = (key, animation) => {
			if (!animation?.frames?.length) return;
			timelines.push(new AnimationSourceTimeline({
				key,
				frames: animation.frames,
				frameDurations: animation.frameDelays || [],
				fallbackDuration: animation.frameDelay || fallbackDuration
			}));
		};
		layers.forEach((layer) => {
			this._buildLayerExportPlan(layer).flattenFrames(library, collectTimeline);
		});
		const timelineConfig = CONFIG.export.timeline;
		return new CompositeTimelinePlanner(timelineConfig).estimateLoop(
			timelines,
			fallbackDuration,
			timelineConfig.maxLoopDurationMs
		);
	}

	_deoptimizeWatermarkFrames(watermark) {
		if (!watermark || !watermark.isAnimated) return;

		const { width, height, frames } = watermark;
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });

		let prevFrame = null;

		for (let i = 0; i < frames.length; i++) {
			const frame = frames[i];

			if (prevFrame && frame.disposal === 2) {
				ctx.putImageData(prevFrame, 0, 0);
			} else if (frame.disposal === 3) {
				ctx.clearRect(0, 0, width, height);
			}

			ctx.putImageData(frame.data, frame.x, frame.y);
			const fullFrame = ctx.getImageData(0, 0, width, height);
			frame.data = fullFrame;
			frame.x = 0;
			frame.y = 0;
			frame.width = width;
			frame.height = height;

			if (frame.disposal === 2) {
				prevFrame = ctx.getImageData(0, 0, width, height);
			}
		}
	}

	_renderWatermarkToCanvas(watermark, ctx, canvasWidth, canvasHeight, frameIndex) {
		if (!watermark) return;

		// Determine which frame/image to use
		let sourceData;
		if (watermark.isAnimated) {
			const frameCount = watermark.frames.length;
			const watermarkFrameIndex = frameIndex % frameCount;
			const frame = watermark.frames[watermarkFrameIndex];
			sourceData = this._getFrameImageData(frame, watermark.width, watermark.height);
		} else {
			sourceData = watermark.imageData;
		}

		if (!sourceData) {
			if (this.config.debug) console.error('[GifExporter] Invalid watermark frame', frameIndex);
			return;
		}

		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = watermark.width;
		tempCanvas.height = watermark.height;
		const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true, alpha: true });

		// Only process if not already done during load
		if (watermark.alphaProcessed) {
			// Already processed, just use it
			tempCtx.putImageData(sourceData, 0, 0);
		} else {
			// Process now (fallback)
			const processedData = new ImageData(
				new Uint8ClampedArray(sourceData.data),
				sourceData.width,
				sourceData.height
			);

			const threshold = this.config.watermarkAlphaThreshold;
			if (threshold > 0) {
				const data = processedData.data;
				for (let i = 3; i < data.length; i += 4) {
					data[i] = data[i] < threshold ? 0 : 255;
				}
			}
			tempCtx.putImageData(processedData, 0, 0);
		}

		// Calculate scaled dimensions
		const scaledWidth = Math.round(watermark.width * (CONFIG.export.watermark.scale / 100));
		const scaledHeight = Math.round(watermark.height * (CONFIG.export.watermark.scale / 100));

		// Calculate position
		let x, y;
		switch (CONFIG.export.watermark.position) {
			case 'top-left': x = CONFIG.export.watermark.paddingX; y = CONFIG.export.watermark.paddingY; break;
			case 'top-center': x = (canvasWidth - scaledWidth) / 2; y = CONFIG.export.watermark.paddingY; break;
			case 'top-right': x = canvasWidth - scaledWidth - CONFIG.export.watermark.paddingX; y = CONFIG.export.watermark.paddingY; break;
			case 'bottom-left': x = CONFIG.export.watermark.paddingX; y = canvasHeight - scaledHeight - CONFIG.export.watermark.paddingY; break;
			case 'bottom-center': x = (canvasWidth - scaledWidth) / 2; y = canvasHeight - scaledHeight - CONFIG.export.watermark.paddingY; break;
			case 'bottom-right': x = canvasWidth - scaledWidth - CONFIG.export.watermark.paddingX; y = canvasHeight - scaledHeight - CONFIG.export.watermark.paddingY; break;
			case 'center': x = (canvasWidth - scaledWidth) / 2; y = (canvasHeight - scaledHeight) / 2; break;
			default: x = CONFIG.export.watermark.paddingX; y = CONFIG.export.watermark.paddingY;
		}

		// Draw watermark
		ctx.save();
		ctx.globalAlpha = CONFIG.export.watermark.opacity / 100;
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(tempCanvas, 0, 0, watermark.width, watermark.height, x, y, scaledWidth, scaledHeight);
		ctx.restore();
	}


	_parseHexColor(hex) {
		hex = hex.replace('#', '');
		const r = parseInt(hex.substring(0, 2), 16);
		const g = parseInt(hex.substring(2, 4), 16);
		const b = parseInt(hex.substring(4, 6), 16);
		return { r, g, b };
	}

	_createMaskCanvas(rawMaskData, width, height) {
		const c = document.createElement('canvas');
		c.width = width;
		c.height = height;
		const ctx = c.getContext('2d');

		const imgData = ctx.createImageData(width, height);
		const data = imgData.data;

		for (let i = 0; i < rawMaskData.length; i++) {
			const val = rawMaskData[i];
			const pIdx = i * 4;
			data[pIdx] = 0;
			data[pIdx + 1] = 0;
			data[pIdx + 2] = 0;
			data[pIdx + 3] = val;
		}

		ctx.putImageData(imgData, 0, 0);
		return c;
	}



	async _loadMissingFrames(layers, library, callbacks) {
		for (const layer of layers) {
			await this._buildLayerExportPlan(layer).loadSources(library, callbacks);
		}
	}

	async _loadWatermark(callbacks) {
		if (!CONFIG.export.watermark.url) {
			return null;
		}

		callbacks.onStatus('Loading watermark...');

		try {
			const response = await fetch(CONFIG.export.watermark.url);
			const blob = await response.blob();
			const arrayBuffer = await blob.arrayBuffer();
			const uint8Array = new Uint8Array(arrayBuffer);

			// Check GIF signature
			const isGif = uint8Array[0] === 0x47 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46;

			if (isGif) {
				const frames = await this._parseGifWithMetadata(CONFIG.export.watermark.url, uint8Array);

				// Process alpha threshold ONCE during load if threshold is active
				if (this.config.watermarkAlphaThreshold > 0) {
					frames.frames.forEach(frame => {
						const data = frame.data.data;
						for (let i = 3; i < data.length; i += 4) {
							data[i] = data[i] < this.config.watermarkAlphaThreshold ? 0 : 255;
						}
					});
				}

				return {
					isAnimated: true,
					width: frames.width,
					height: frames.height,
					frames: frames.frames,
					frameCount: frames.frameCount,
					alphaProcessed: true // Flag to skip processing in render
				};
			} else {
				// For static images
				return new Promise((resolve, reject) => {
					const img = new Image();
					img.crossOrigin = 'anonymous';

					img.onload = () => {
						const canvas = document.createElement('canvas');
						canvas.width = img.naturalWidth;
						canvas.height = img.naturalHeight;
						const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
						ctx.drawImage(img, 0, 0);

						let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

						// Process alpha threshold ONCE during load
						if (this.config.watermarkAlphaThreshold > 0) {
							const data = imageData.data;
							for (let i = 3; i < data.length; i += 4) {
								data[i] = data[i] < this.config.watermarkAlphaThreshold ? 0 : 255;
							}
						}

						resolve({
							isAnimated: false,
							width: img.naturalWidth,
							height: img.naturalHeight,
							imageData: imageData,
							alphaProcessed: true
						});
					};

					img.onerror = () => reject(new Error('Failed to load watermark image'));
					img.src = CONFIG.export.watermark.url;
				});
			}
		} catch (error) {
			if (this.config.debug) console.error('[GifExporter] Watermark load error:', error);
			throw new Error(`Failed to load watermark: ${error.message}`);
		}
	}


	async _loadStaticImage(url) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = img.naturalWidth;
				canvas.height = img.naturalHeight;
				const ctx = canvas.getContext('2d');
				ctx.drawImage(img, 0, 0);
				const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
				resolve(imageData);
			};
			img.onerror = () => reject(new Error('Failed to load image'));
			img.src = url;
		});
	}

	clearPreviewBlobUrl() {
		if (!this.previewBlobUrl) {
			return;
		}

		URL.revokeObjectURL(this.previewBlobUrl);
		this.previewBlobUrl = null;
	}

	_handleFileSave(blob, callbacks, plan) {
		dbg('_handleFileSave called with blob size:', blob.size);
		callbacks.onProgress(100, 'Export complete!', 0, 0);
		callbacks.onStatus('Export complete!');
		callbacks.onComplete({
			smartReduced: plan.reduction.exactDuplicatesMerged + plan.reduction.nearDuplicatesMerged > 0,
			timelinePlan: plan
		});

		const file = new File([blob], this.fileName, {
			type: 'image/gif',
			lastModified: Date.now()
		});

		this.clearPreviewBlobUrl();
		const url = URL.createObjectURL(blob);
		this.previewBlobUrl = url;

		this._showExportPreviewModal(url, file, plan.frames.length, blob.size, plan.reductions, {
			format: 'gif',
			width: this.canvas.width,
			height: this.canvas.height,
			duration: plan.totalDuration / 1000,
			timelinePlan: plan
		});
	}




	_showExportPreviewModal(blobUrl, file, frameCount, fileSize, reductions = [], options = {}) {
		const modal = document.getElementById('exportPreviewModal');
		const img = document.getElementById('exportPreviewImage');
		const video = document.getElementById('exportPreviewVideo');
		const instructions = modal.querySelector('.export-preview-instructions');
		const closeBtn = document.getElementById('closeExportPreviewModal');
		const format = options.format === 'mp4' ? 'mp4' : 'gif';
		const isVideo = format === 'mp4';

		// Stats Elements
		const exportStats = document.getElementById('exportStats');

		if (exportStats) {
			const statSize = document.getElementById('exportStatSize');
			const statFrames = document.getElementById('exportStatFrames');
			const statDuration = document.getElementById('exportStatDuration');
			const statDimensions = document.getElementById('exportStatDimensions');
			const durationRow = document.getElementById('exportStatDurationRow');
			const dimensionsRow = document.getElementById('exportStatDimensionsRow');

			if (statFrames) {
				statFrames.textContent = frameCount != null ? String(frameCount) : 'Unknown';
			}
			if (statDuration) {
				durationRow.hidden = !Number.isFinite(options.duration);
				if (!durationRow.hidden) statDuration.textContent = `${options.duration.toFixed(2)}s`;
			}
			if (statDimensions) {
				dimensionsRow.hidden = !options.width || !options.height;
				if (!dimensionsRow.hidden) statDimensions.textContent = `${options.width} × ${options.height}px`;
			}

			// Set stats text
			if (statSize) {
				statSize.textContent = fileSize != null ? formatBytes(fileSize) : 'Unknown';

			}

		}
		this._renderSizeWarnings(document.getElementById('exportSizeWarnings'), fileSize);
		const formatNotices = document.getElementById('exportFormatNotices');
		const colorNoticeText = document.getElementById('exportColorNoticeText');
		const colorAnalysis = options.timelinePlan?.colorAnalysis;
		const showColorNotice = !isVideo && Boolean(colorAnalysis?.significant);
		if (formatNotices) formatNotices.hidden = !showColorNotice;
		if (showColorNotice && colorNoticeText) {
			colorNoticeText.textContent = colorAnalysis.ditherEnabled
				? 'GIFs can display up to 256 colors in each frame. This artwork uses many more, so similar colors were blended together. Dithering helps gradients look smoother, but may add a fine texture.'
				: 'GIFs can display up to 256 colors in each frame. This artwork uses many more, so similar colors were blended together. Gradients and photos may show bands of color; turn on Dithering in Export Settings to smooth them.';
		}

		const timelinePlan = options.timelinePlan?.reduction ? options.timelinePlan : null;
		const reductionSummary = document.getElementById('exportReductionSummary');
		if (reductionSummary) {
			const reduction = timelinePlan?.reduction;
			const removedFrames = reduction
				? reduction.exactDuplicatesMerged + reduction.nearDuplicatesMerged
				: 0;
			const hasReduction = Boolean(reduction?.smartReductionEnabled && removedFrames > 0);
			const hasPlanWarning = Boolean(timelinePlan && (
				!timelinePlan.loopSeam.exact
					|| !reduction.preferredBudgetMet
					|| reduction.budgetCompromiseRequired
					|| !reduction.durationPreserved
			));
			const optimizationDetails = document.getElementById('exportOptimizationDetails');
			reductionSummary.hidden = !hasReduction && !hasPlanWarning;
			optimizationDetails.hidden = !hasReduction;
			optimizationDetails.open = false;
			if (!reductionSummary.hidden) {
				const title = document.getElementById('exportReductionTitle');
				const summary = document.getElementById('exportReductionText');
				const seam = document.getElementById('exportSeamStatus');
				title.textContent = hasPlanWarning ? 'About this animation' : 'File size optimized';
				if (hasReduction) {
					const frameLabel = removedFrames === 1 ? 'frame' : 'frames';
					const kind = reduction.nearDuplicatesMerged > 0
						? (reduction.exactDuplicatesMerged > 0 ? 'repeated or nearly identical' : 'nearly identical')
						: 'repeated';
					summary.textContent = `Removed ${removedFrames} ${kind} ${frameLabel} without changing the speed.`;

					document.getElementById('exportDetailFrames').textContent = `${reduction.originalFrameCount} → ${reduction.outputFrameCount}`;
					document.getElementById('exportDetailExact').textContent = String(reduction.exactDuplicatesMerged);
					document.getElementById('exportDetailExactRow').hidden = reduction.exactDuplicatesMerged === 0;
					document.getElementById('exportDetailNear').textContent = String(reduction.nearDuplicatesMerged);
					document.getElementById('exportDetailNearRow').hidden = reduction.nearDuplicatesMerged === 0;
					document.getElementById('exportDetailTiming').textContent = reduction.durationPreserved ? 'Unchanged' : 'May differ';
					document.getElementById('exportDetailLoop').textContent = timelinePlan.loopSeam.exact ? 'Exact match' : 'Best available match';
					document.getElementById('exportDetailError').textContent = `${(reduction.maximumVisualError * 100).toFixed(2)}%`;
					document.getElementById('exportDetailErrorRow').hidden = reduction.nearDuplicatesMerged === 0;
				} else {
					summary.textContent = '';
				}

				const planMessages = [];
				if (!timelinePlan.loopSeam.exact) {
					planMessages.push('The animations repeat at different times, so the beginning and ending may not match perfectly.');
				}
				if (!reduction.preferredBudgetMet) {
					planMessages.push(`Kept ${reduction.outputFrameCount} frames to keep the motion smooth.`);
				}
				if (reduction.budgetCompromiseRequired) {
					planMessages.push('This animation is longer than the export limit allows, so some motion detail may be reduced.');
				}
				if (!reduction.durationPreserved) {
					planMessages.push('The exported animation may play at a different speed than the preview.');
				}
				seam.hidden = planMessages.length === 0;
				seam.textContent = planMessages.join(' ');
			}
		}




		// Button Elements
		const shareBtn = document.getElementById('exportPreviewShare');
		const openBtn = document.getElementById('exportPreviewOpen');
		const saveBtn = document.getElementById('exportPreviewSave'); // New Button

		// 1. Environment Detection
		// Force iOS logic if iPhone/iPad detected
		const isIOS = CONFIG.debug.forceIOSExportPreview
			|| /iPhone|iPad|iPod/i.test(navigator.userAgent)
			|| (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		modal.classList.toggle('is-ios', isIOS);
		let canShare = false;
		try {
			canShare = Boolean(navigator.canShare?.({ files: [file] }));
		} catch (error) {
			canShare = false;
		}

		// 2. Helper to manage Button State (Text + Disabled)
		const configureBtn = (btn, isEnabled, text = null) => {
			if (!btn) return;
			btn.disabled = !isEnabled;
			// Optional: btn.style.display = isEnabled ? 'inline-flex' : 'none'; 
			if (text) {
				const span = btn.querySelector('.name');
				if (span) span.textContent = text;
			}
		};

		// 3. Set format-specific preview
		img.hidden = isVideo;
		video.hidden = !isVideo;
		if (isVideo) {
			img.removeAttribute('src');
			video.src = blobUrl;
			video.play().catch(() => {});
		} else {
			video.pause();
			video.removeAttribute('src');
			img.src = blobUrl;
		}

		// 4. Configure UI Logic
		if (isIOS) {
			// --- iOS Logic ---

			img.oncontextmenu = () => false;

			// DISABLE "Open GIF" & "Save" (Direct download fails/breaks on iOS)
			configureBtn(openBtn, false, `Open ${format.toUpperCase()}`);
			configureBtn(saveBtn, false, `Save ${format.toUpperCase()}`);

			if (canShare) {
				configureBtn(shareBtn, true, isVideo ? 'Share Video' : 'Share GIF');
				this._renderPreviewTemplate(
					instructions,
					isVideo ? 'tpl-export-instructions-ios-video' : 'tpl-export-instructions-ios-gif',
					{ format, isVideo }
				);
			} else {
				configureBtn(shareBtn, false);
				this._renderPreviewTemplate(instructions, 'tpl-export-instructions-ios-unsupported', { format, isVideo });
			}
		}
		else {
			// --- Desktop / Android Logic ---

			// enable right click on image
			img.oncontextmenu = () => true;

			// ENABLE "Open GIF" & "Save" (Standard browser features)
			configureBtn(openBtn, true, `Open ${format.toUpperCase()}`);
			configureBtn(saveBtn, true, `Save ${format.toUpperCase()}`);

			// Handle Share button (Some desktops like Safari/Edge support it)
			if (canShare) {
				configureBtn(shareBtn, true, "Share");
			} else {
				configureBtn(shareBtn, false);
			}
			instructions.replaceChildren();
			instructions.hidden = true;
		}

		// 5. Show Modal
		modal.classList.add('visible');

		// 6. Handlers
		const cleanup = () => {
			modal.classList.remove('visible');
			video.pause();
			setTimeout(() => {
				if (this.previewBlobUrl === blobUrl) {
					this.clearPreviewBlobUrl();
				}
			}, 500);
		};

		closeBtn.onclick = cleanup;
		modal.onclick = (e) => { if (e.target === modal) cleanup(); };

		// Handler: Share (iOS "Save Image")
		shareBtn.onclick = async () => {
			if (shareBtn.disabled || !canShare) return;
			try {
				await navigator.share({
					files: [file],
					title: `Glitter ${format.toUpperCase()}`,
					text: 'Created with ' + CONFIG.app.siteName
				});
			} catch (error) {
				if (error.name !== 'AbortError') if (this.config.debug) console.error('Share failed:', error);
			}
		};

		// Handler: Open in New Tab
		openBtn.onclick = () => {
			if (openBtn.disabled) return;
			const win = window.open(blobUrl, '_blank');
			if (!win) {
				window.editor?.alertAction({
					title: 'Popup Blocked',
					message: 'Please allow popups to view the full image.'
				});
			}
		};

		// Handler: Save / Download (Desktop)
		saveBtn.onclick = () => {
			if (saveBtn.disabled) return;
			downloadBlob(file, file.name);
		};
	}
}
