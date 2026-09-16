// ============================================
// GIF EXPORT MANAGER CLASS
// ============================================
const GIF_EXPORT_PROGRESS_PHASES = Object.freeze({
	loading: { label: 'Loading sources', start: 0, end: 8 },
	masks: { label: 'Preparing masks', start: 8, end: 12 },
	planning: { label: 'Planning timing', start: 12, end: 15 },
	composing: { label: 'Composing frames', start: 15, end: 65 },
	reducing: { label: 'Reducing frames', start: 65, end: 70 },
	palette: { label: 'Building palette', start: 70, end: 78 },
	encoding: { label: 'Encoding', start: 78, end: 99 },
	finalizing: { label: 'Finalizing', start: 99, end: 100 }
});

function reportGifExportProgress(callbacks, phaseKey, ratio = 0, detail = '', phaseCurrent = 0, phaseTotal = 0, options = {}) {
	const phase = GIF_EXPORT_PROGRESS_PHASES[phaseKey];
	const boundedRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
	const percent = phase.start + ((phase.end - phase.start) * boundedRatio);
	callbacks.onProgress(percent, detail, phaseCurrent, phaseTotal, {
		phase: phase.label,
		detail,
		phaseCurrent,
		phaseTotal,
		indeterminate: options.indeterminate ?? phaseTotal <= 0
	});
}

function ensureCanvasSize(canvas, width, height) {
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
}

function resetCanvasContext(ctx, width, height, imageSmoothingEnabled = true) {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	ctx.imageSmoothingEnabled = imageSmoothingEnabled;
	ctx.clearRect(0, 0, width, height);
}

class GifExporter {
	constructor(options = {}) {
		if (!options || typeof options.show === 'function') options = { resultPresenter: options };
		const exportConfig = CONFIG.export || {};
		this.config = {
			debug: typeof CONFIG !== 'undefined' ? CONFIG.debug?.enabled : false,
			watermarkAlphaThreshold: exportConfig.watermark.alphaThreshold
		};
		this.fileName = `${exportConfig.core?.defaultBaseName || 'ryandavi-com_glitter'}.gif`;

		// Reusable canvas elements
		this.canvas = document.createElement('canvas');
		this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

		this.helperCanvas = document.createElement('canvas');
		this.helperCtx = this.helperCanvas.getContext('2d');
		this.layerBlendCanvas = document.createElement('canvas');
		this.layerBlendCtx = this.layerBlendCanvas.getContext('2d', { willReadFrequently: true });
		this.patternSourceCanvas = document.createElement('canvas');
		this.patternSourceCtx = this.patternSourceCanvas.getContext('2d');
		this.filterGrainTileCache = new Map();
		this.resultPresenter = options.resultPresenter || (typeof ExportResultPresenter === 'function' ? new ExportResultPresenter() : null);
		this.authoredFrameResolver = options.authoredFrameResolver || new AuthoredFrameResolver();
		this.gifEncodingPipeline = options.gifEncodingPipeline || new GifEncodingPipeline();
		this.resolveShapeFillImage = options.resolveShapeFillImage || (() => null);
	}

	// The compositor no longer predicts whether transparency will remain
	// visible after composition; it only decides where composition starts.
	_resolvePreserveAlpha(targetSupportsTransparency, exportSettings) {
		return Boolean(targetSupportsTransparency && exportSettings.transparency);
	}

	setFileName(fileName) {
		if (fileName) {
			this.fileName = fileName;
		}
	}


	_collectProceduralSources(layers, { includeBaseImage = true } = {}) {
		const sources = [];
		const shimmerBase = layers.find((layer) => {
			if (!includeBaseImage || layer.type !== LayerType.BASE_IMAGE || layer.visible === false) return false;
			const settings = GlitterPixelEffects.normalizeSettings(layer.background?.pixelEffects || layer.background?.posterize, CONFIG.tools.pixelEffects);
			return ['image', 'gradient'].includes(layer.background?.mode || 'image') && settings.paletteEnabled && settings.paletteMode === 'dither'
				&& settings.dither.shimmer && GlitterPixelEffects.getShimmerAnimation(settings.dither.algorithm, CONFIG.tools.pixelEffects);
		});
		if (shimmerBase) {
			const settings = GlitterPixelEffects.normalizeSettings(shimmerBase.background?.pixelEffects || shimmerBase.background?.posterize, CONFIG.tools.pixelEffects);
			const animation = GlitterPixelEffects.getShimmerAnimation(settings.dither.algorithm, CONFIG.tools.pixelEffects);
			const frameDuration = CONFIG.tools.pixelEffects.animation.frameDurationMs;
			sources.push({
				key: '__base_dither',
				label: 'Base image shimmer',
				ownerLayerId: shimmerBase.id,
				naturalPeriod: animation.frames * frameDuration,
				preferredSamplingRate: 1000 / frameDuration,
				sampleAt: (timestamp, period = animation.frames * frameDuration) => {
					const cycleTime = ((timestamp % period) + period) % period;
					return { frameIndex: Math.min(animation.frames - 1, Math.floor(cycleTime / period * animation.frames)) };
				}
			});
		}
		layers.forEach((layer) => {
			if (layer.type === LayerType.BASE_IMAGE || !GlitterAnimation.isActive(layer.animation)) return;
			const animation = GlitterAnimation.normalizeAnimation(layer.animation);
			sources.push({
				key: `__anim_${layer.id}`,
				label: `${layer.name || 'Layer'} animation`,
				ownerLayerId: layer.id,
				effectSlot: 'animation',
				naturalPeriod: animation.periodMs,
				phase: animation.phase,
				preferredSamplingRate: CONFIG.tools.animation.exportFps,
				sampleAt: (timestamp, period = animation.periodMs) => ({
					sample: GlitterAnimation.sampleAt({ ...animation, periodMs: period }, timestamp, { layerId: layer.id })
				})
			});
		});
		return sources;
	}

	_createProceduralTimelines(proceduralSources) {
		return proceduralSources.map((source) => new ProceduralAnimationSource({
			...source,
			sampler: source.sampleAt
		}));
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








	// `smooth` mirrors the preview's image-rendering: pixel art stays crisp under
	// the layer scale, art flagged smooth gets the browser's bilinear filtering
	// so the export matches what the canvas showed.
	_drawTransformedCanvas(ctx, sourceCanvas, transform, width, height, { smooth = false } = {}) {
		const metrics = computeLayerTransform(transform, { width, height });
		const animation = this._activeLayerAnimation?.transform === transform
			? this._activeLayerAnimation.sample
			: null;

		ctx.save();
		ctx.imageSmoothingEnabled = smooth;
		ctx.globalAlpha *= metrics.opacity;
		if (animation) {
			ctx.globalAlpha *= animation.opacity;
			ctx.translate(animation.tx, animation.ty);
		}
		ctx.translate(metrics.centerX, metrics.centerY);

		if (metrics.rotationRad !== 0) {
			ctx.rotate(metrics.rotationRad);
		}

		ctx.scale(metrics.signedScaleX, metrics.signedScaleY);
		if (animation) {
			ctx.translate(-width / 2, -height / 2);
			GlitterAnimation.applyToContext(ctx, { ...animation, tx: 0, ty: 0 }, width, height);
			ctx.translate(width / 2, height / 2);
		}

		ctx.drawImage(
			sourceCanvas,
			-width / 2,
			-height / 2,
			width,
			height
		);

		ctx.restore();
	}

	_getAnimationBox(layer, canvasWidth, canvasHeight) {
		if (layer.type === LayerType.GLITTER_FILL) return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
		let width;
		let height;
		if (layer.type === LayerType.STICKER) ({ width, height } = layer.stickerData);
		else if (layer.type === LayerType.TEXT_GLITTER) ({ width, height } = layer.textData);
		else if (layer.type === LayerType.SHAPE) ({ width, height } = layer.shapeData);
		width = Number(width) || 1;
		height = Number(height) || 1;
		const metrics = computeLayerTransform(getLayerTransform(layer), { width, height });
		return { x: metrics.centerX - width / 2, y: metrics.centerY - height / 2, width, height };
	}

	_renderLayerToCanvas(layer, ctx, frameIndex, sourceSelectionMap = null, resolvedFramesBySource = null, scratch = null) {
		const transform = getLayerTransform(layer);
		const { isAnimated, width, height } = layer.stickerData;

		// Determine which frame/image to use
		let imageData;
		if (isAnimated && layer.stickerData.frames) {
			const source = resolvedFramesBySource?.get(layer.id);
			if (!source?.length) {
				throw new Error(`Missing resolved sticker frames for layer ${layer.id}`);
			}

			const reducedFrameCount = sourceSelectionMap?.get(layer.id);
			const stickerFrameIndex = this._getReducedFrameIndex(frameIndex, source.length, reducedFrameCount);
			imageData = this._readResolvedSource(source, stickerFrameIndex);
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
		const tempCanvas = scratch?.sourceCanvas;
		if (!tempCanvas) throw new Error(`Missing sticker scratch for layer ${layer.id}`);
		this._renderPatternSourceInto(tempCanvas, imageData, layer.stickerData.colorAdjust);
		this._renderStickerEffects(layer, ctx, tempCanvas, frameIndex, sourceSelectionMap, resolvedFramesBySource, scratch);

		this._drawTransformedCanvas(ctx, tempCanvas, transform, width, height, {
			smooth: layer.stickerData.isPixelated === false
		});
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

	_renderStickerEffects(layer, ctx, stickerCanvas, frameIndex, sourceSelectionMap, resolvedFramesBySource, scratch) {
		const shadow = layer.stickerData?.shadow;
		if (!shadow) return;
		const pad = Math.ceil(Math.max(
			Math.abs(shadow.offsetX || 0),
			Math.abs(shadow.offsetY || 0)
		)) + 2;
		const source = this._getStickerEffectSource(layer, 'shadow');
		if (!source || !scratch?.shadowMaskCanvas || !scratch?.shadowFillCanvas) return;
		const effectMask = scratch.shadowMaskCanvas;
		ensureCanvasSize(effectMask, stickerCanvas.width + pad * 2, stickerCanvas.height + pad * 2);
		const effectMaskCtx = scratch.shadowMaskCtx;
		resetCanvasContext(effectMaskCtx, effectMask.width, effectMask.height);
		const offsetX = shadow.offsetX || 0;
		const offsetY = shadow.offsetY || 0;
		effectMaskCtx.drawImage(stickerCanvas, pad + offsetX, pad + offsetY);
		effectMask._textureOrigin = { x: offsetX, y: offsetY };
		this._renderFilledMaskInto(scratch.shadowFillCanvas, effectMask, source, layer, frameIndex, this._getStickerFrameKey(layer, 'shadow'), sourceSelectionMap, resolvedFramesBySource);
		// The shadow is the sticker's own silhouette, so it scales the same way.
		this._drawTransformedCanvas(ctx, scratch.shadowFillCanvas, getLayerTransform(layer), scratch.shadowFillCanvas.width, scratch.shadowFillCanvas.height, {
			smooth: layer.stickerData.isPixelated === false
		});
	}

	_renderTextLayerToCanvas(layer, ctx, frameIndex, sourceSelectionMap = null, resolvedFramesBySource = null, textMaskCanvases = null, scratch = null) {
		const textMasks = textMaskCanvases?.get(layer.id);
		if (!textMasks?.fill) {
			throw new Error(`Missing text mask for layer ${layer.id}`);
		}
		const width = layer.textData.width;
		const height = layer.textData.height;
		const compositeCanvas = scratch?.compositeCanvas;
		const fillCanvas = scratch?.fillCanvas;
		if (!compositeCanvas || !fillCanvas) throw new Error(`Missing text scratch for layer ${layer.id}`);
		ensureCanvasSize(compositeCanvas, width, height);
		ensureCanvasSize(fillCanvas, width, height);
		const compositeCtx = scratch.compositeCtx;
		resetCanvasContext(compositeCtx, width, height);
		const draw = (maskCanvas, source, sourceKey) => {
			if (!maskCanvas || !source) return;
			this._renderFilledMaskInto(
				fillCanvas,
				maskCanvas,
				source,
				layer,
				frameIndex,
				sourceKey,
				sourceSelectionMap,
				resolvedFramesBySource
			);
			compositeCtx.drawImage(fillCanvas, 0, 0, width, height);
		};

		// Text Background renders furthest back (behind shadow/border/fill),
		// matching preview's getSpanDescriptors ordering exactly.
		if (layer.textData.textBackground?.enabled && textMasks.background) {
			draw(
				textMasks.background,
				this._getTextEffectSource(layer, 'backgroundFill'),
				this._getTextFrameKey(layer, 'backgroundFill')
			);
		}

		const shadow = layer.textData.shadow;
		if (shadow && textMasks.shadow) {
			draw(
				textMasks.shadow,
				this._getTextEffectSource(layer, 'shadow'),
				this._getTextFrameKey(layer, 'shadow')
			);
		}

		const border = layer.textData.border;
		const renderBorder = () => {
			if (!(border?.widthPx > 0) || !textMasks.border) return;
			draw(
				textMasks.border,
				this._getTextEffectSource(layer, 'border'),
				this._getTextFrameKey(layer, 'border')
			);
		};
		const drawBorderAfterFill = this._getBorderDrawOrder(border) === 'front';

		if (!drawBorderAfterFill) {
			renderBorder();
		}

		draw(
			textMasks.fill,
			this._getTextEffectSource(layer, 'fill'),
			this._getTextFrameKey(layer, 'fill')
		);

		if (drawBorderAfterFill) {
			renderBorder();
		}

		// Preview fades/transforms the wrapper around the complete span stack.
		// Export must likewise composite the object's paints before applying its
		// whole-layer opacity or animation, or overlapping effects show through.
		this._drawTransformedCanvas(ctx, compositeCanvas, getLayerTransform(layer), width, height);
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
			glitterId: slot === 'fill' ? layer.selectedGlitterId : layer.shapeData?.[slot]?.glitterId,
			imageResolver: this.resolveShapeFillImage
		});
	}

	_getShapeFrameKey(layer, slot) {
		return `${layer.id}:${slot}`;
	}

	// Per-slot glitter sources (like text) — each slot in glitter mode with a
	// glitter contributes its own resolved frame set keyed by layer.id:slot.
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
	// reusing the target-writing fill helper and _drawTransformedCanvas.
	_renderShapeLayerToCanvas(layer, ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, shapeMaskCanvases, scratch = null) {
		const masks = shapeMaskCanvases?.get(layer.id);
		if (!masks?.fill) {
			throw new Error(`Missing shape mask for layer ${layer.id}`);
		}
		const d = layer.shapeData;
		const t = getLayerTransform(layer);
		const w = masks.renderWidth;
		const h = masks.renderHeight;
		const compositeCanvas = scratch?.compositeCanvas;
		const fillCanvas = scratch?.fillCanvas;
		if (!compositeCanvas || !fillCanvas) throw new Error(`Missing shape scratch for layer ${layer.id}`);
		ensureCanvasSize(compositeCanvas, w, h);
		ensureCanvasSize(fillCanvas, w, h);
		const compositeCtx = scratch.compositeCtx;
		resetCanvasContext(compositeCtx, w, h);
		const draw = (maskCanvas, slot) => {
			if (!maskCanvas) return;
			const source = this._getShapeEffectSource(layer, slot);
			if (!source) return;
			this._renderFilledMaskInto(fillCanvas, maskCanvas, source, layer, frameIndex, this._getShapeFrameKey(layer, slot), sourceSelectionMap, resolvedFramesBySource);
			compositeCtx.drawImage(fillCanvas, 0, 0, w, h);
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
		this._drawTransformedCanvas(ctx, compositeCanvas, t, w, h);
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
				opacity: layer.textData?.fill?.opacity ?? layer.settings.opacity ?? 100,
				colorAdjust: layer.settings.colorAdjust
			});
		}

		if (effectName === 'backgroundFill') {
			return resolveEffectPaintSource(layer.textData?.textBackground?.fill);
		}

		return resolveEffectPaintSource(layer.textData?.[effectName]);
	}

	_createGlitterDescriptor(library, { key, label, ownerLayerId, effectSlot = null, glitterId }) {
		const glitter = library.find((item) => item.id === glitterId);
		return {
			key,
			label: label || glitter?.name || String(glitterId),
			ownerLayerId,
			effectSlot,
			role: 'glitter',
			replayPolicy: 'derived-glitter',
			sourceIdentity: glitter,
			ensureLoaded: async (callbacks) => {
				if (!glitter) throw new Error(`Missing glitter ${glitterId}`);
				if (glitter.frames) return;
				callbacks.onStatus(`Loading ${glitter.name}...`);
				try { glitter.frames = await callbacks.parseGif(glitter.url); }
				catch (error) { throw new Error(`Failed to load ${glitter.name}`); }
			},
			getAnimation: () => glitter?.frames
		};
	}

	_createStickerDescriptor(layer) {
		const stickerData = layer.stickerData;
		return {
			key: layer.id,
			label: stickerData.name,
			ownerLayerId: layer.id,
			effectSlot: null,
			role: 'sticker',
			replayPolicy: 'native-layer',
			sourceIdentity: stickerData,
			ensureLoaded: async (callbacks) => {
				if (stickerData.frames) return;
				callbacks.onStatus(`Loading ${stickerData.name}...`);
				try { stickerData.frames = await callbacks.parseGif(stickerData.url); }
				catch (error) { throw new Error(`Failed to load sticker ${stickerData.name}`); }
			},
			getAnimation: () => stickerData.frames
		};
	}

	_createAuthoredTimingSource(descriptor, fallbackDuration) {
		const animation = descriptor.getAnimation();
		if (!animation?.frames?.length) throw new Error(`Missing animation data for ${descriptor.key}`);
		const timing = this._reconcileAuthoredTiming(descriptor, animation, fallbackDuration);
		return new AuthoredAnimationSource({
			key: descriptor.key,
			label: descriptor.label,
			ownerLayerId: descriptor.ownerLayerId,
			effectSlot: descriptor.effectSlot,
			frameCount: animation.frames.length,
			frameDurations: timing.frameDurations,
			fallbackDuration: timing.fallbackDuration
		});
	}

	// Archival assets carry a curated frameRate/isVariableFramerate in their manifest
	// (data/stickers/*.json, data/glitter/*.json). The GIF file's own embedded
	// per-frame delays are decoded independently and occasionally turn out corrupted
	// (e.g. a delay of 1cs instead of 100cs), which silently produces a wildly wrong
	// export cadence. When the two disagree by more than 2x, trust the manifest.
	_reconcileAuthoredTiming(descriptor, animation, fallbackDuration) {
		const decodedDurations = animation.frameDelays || [];
		const decodedFallback = animation.frameDelay || fallbackDuration;
		const manifestFrameRate = Number(descriptor.sourceIdentity?.frameRate);
		if (descriptor.sourceIdentity?.isVariableFramerate || !Number.isFinite(manifestFrameRate) || manifestFrameRate <= 0) {
			return { frameDurations: decodedDurations, fallbackDuration: decodedFallback };
		}
		const manifestDuration = 1000 / manifestFrameRate;
		const decodedAverage = decodedDurations.length
			? decodedDurations.reduce((sum, duration) => sum + duration, 0) / decodedDurations.length
			: decodedFallback;
		const ratio = decodedAverage / manifestDuration;
		if (ratio < 0.5 || ratio > 2) {
			console.warn(
				`[GifExporter] "${descriptor.label}" (${descriptor.key}): decoded GIF frame timing ` +
				`(~${decodedAverage.toFixed(1)}ms/frame) disagrees with its authored frame rate ` +
				`(${manifestFrameRate}fps = ${manifestDuration.toFixed(1)}ms/frame) by more than 2x. ` +
				`Using the authored rate for export — the source GIF file's embedded delays may be corrupted.`
			);
			return { frameDurations: [], fallbackDuration: manifestDuration };
		}
		return { frameDurations: decodedDurations, fallbackDuration: decodedFallback };
	}

	_validateAuthoredSourceKeys(descriptors) {
		const keys = new Set();
		for (const descriptor of descriptors) {
			if (keys.has(descriptor.key)) throw new Error(`Duplicate authored source key: ${descriptor.key}`);
			keys.add(descriptor.key);
		}
	}

	_buildLayerExportPlan(layer) {
		switch (layer?.type) {
			case LayerType.BASE_IMAGE: {
				const background = layer.background || { mode: 'image' };
				const mode = background.mode || 'image';
				return {
					prepareMasks: async () => {},
					prepareStaticResources: async () => {},
					getAuthoredSources: (library) => mode === 'glitter' ? [this._createGlitterDescriptor(library, {
						key: layer.id, label: `${library.find((item) => item.id === layer.selectedGlitterId)?.name || 'Glitter'} (background)`,
						ownerLayerId: layer.id, glitterId: layer.selectedGlitterId
					})] : [],
					render: ({ ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, width, height }) => {
						if (mode === 'image' || mode === 'gradient' || mode === 'none') return;
						ctx.save();
						ctx.globalAlpha = (background.opacity ?? 100) / 100;
						if (mode === 'solid') ctx.fillStyle = background.color || '#ffffff';
						else if (mode === 'gradient') ctx.fillStyle = createEffectCanvasGradient(ctx, background.gradient, { x: 0, y: 0, width, height });
						else {
							const frames = resolvedFramesBySource?.get(layer.id) || [];
							const reduced = sourceSelectionMap?.get(layer.id);
							const frame = this._readResolvedSource(frames, this._getReducedFrameIndex(frameIndex, frames.length, reduced));
							if (!frame) throw new Error(`Missing background glitter frame for ${layer.id}`);
							const pattern = ctx.createPattern(this._renderPatternSourceInto(this.patternSourceCanvas, frame, background.colorAdjust), 'repeat');
							pattern.setTransform(new DOMMatrix()
								.translateSelf(Number(background.textureOffsetX) || 0, Number(background.textureOffsetY) || 0)
								.scaleSelf((background.scale || 100) / 100));
							ctx.imageSmoothingEnabled = !this._isGlitterPixelated(layer.selectedGlitterId);
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
					prepareStaticResources: async () => {},
					getAuthoredSources: (library) => fillMode === 'glitter' ? [this._createGlitterDescriptor(library, {
						key: layer.id, ownerLayerId: layer.id, glitterId: layer.selectedGlitterId
					})] : [],
					render: ({ ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, maskCanvases, helperCtx, width, height }) => {
						const maskCanvas = maskCanvases.get(layer.id);
						if (!maskCanvas) {
							throw new Error(`Missing mask canvas for layer ${layer.id}`);
						}

						const frames = resolvedFramesBySource?.get(layer.id);
						if (fillMode === 'glitter' && !frames?.length) {
							throw new Error(`Missing resolved glitter frames for layer ${layer.id}`);
						}

						const reducedFrameCount = sourceSelectionMap?.get(layer.id);
						const fIdx = fillMode === 'glitter' ? this._getReducedFrameIndex(frameIndex, frames.length, reducedFrameCount) : 0;
						const frameImageData = fillMode === 'glitter' ? this._readResolvedSource(frames, fIdx) : null;
						if (fillMode === 'glitter' && !frameImageData) {
							throw new Error(`Invalid glitter frame format for layer ${layer.id} frame ${fIdx}`);
						}

						helperCtx.save();
						helperCtx.clearRect(0, 0, width, height);

						helperCtx.globalAlpha = (layer.opacity ?? layer.settings.opacity ?? 100) / 100;
						if (fillMode === 'solid') {
							helperCtx.fillStyle = layer.fill.color;
						} else if (fillMode === 'gradient') {
							helperCtx.fillStyle = createEffectCanvasGradient(helperCtx, layer.fill.gradient, { x: 0, y: 0, width, height });
						} else {
							const patternSource = this._renderPatternSourceInto(this.patternSourceCanvas, frameImageData, layer.settings.colorAdjust);
							const pattern = helperCtx.createPattern(patternSource, 'repeat');
							const scale = (layer.settings.scale <= 0 ? 1 : layer.settings.scale) / 100;
							pattern.setTransform(new DOMMatrix()
								.translateSelf(Number(layer.fill?.textureOffsetX) || 0, Number(layer.fill?.textureOffsetY) || 0)
								.scaleSelf(scale, scale));
							helperCtx.imageSmoothingEnabled = !this._isGlitterPixelated(layer.selectedGlitterId);
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
				const scratch = {
					compositeCanvas: document.createElement('canvas'),
					fillCanvas: document.createElement('canvas')
				};
				scratch.compositeCtx = scratch.compositeCanvas.getContext('2d', { alpha: true });
				return {
					prepareMasks: async ({ textMaskCanvases, callbacks }) => {
						const fillMaskCanvas = await callbacks.renderTextMask(layer);
						const backgroundMaskCanvas = layer.textData?.textBackground?.enabled
							? await callbacks.renderTextBackgroundMask(layer)
							: null;
						textMaskCanvases.set(layer.id, this._buildTextMaskEntry(layer, fillMaskCanvas, backgroundMaskCanvas));
					},
					prepareStaticResources: async ({ callbacks }) => {
						try { await callbacks.ensureTextFont(layer.textData.fontId); }
						catch (error) { throw new Error(error.message); }
					},
					getAuthoredSources: (library) => glitterSources.map((source) => this._createGlitterDescriptor(library, {
						...source, label: `${library.find((item) => item.id === source.glitterId)?.name || 'Glitter'} (${source.slot})`,
						ownerLayerId: layer.id, effectSlot: source.slot
					})),
					render: ({ ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, textMaskCanvases }) => {
						this._renderTextLayerToCanvas(layer, ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, textMaskCanvases, scratch);
					}
				};
			}

			case LayerType.SHAPE: {
				const glitterSources = this._getShapeGlitterSources(layer);
				const scratch = {
					compositeCanvas: document.createElement('canvas'),
					fillCanvas: document.createElement('canvas')
				};
				scratch.compositeCtx = scratch.compositeCanvas.getContext('2d', { alpha: true });
				return {
					prepareMasks: async ({ shapeMaskCanvases, callbacks }) => {
						// The shape manager is the single source of truth for fill, border,
						// and shadow masks so preview/export stay in sync.
						shapeMaskCanvases.set(layer.id, callbacks.renderShapeMask(layer));
					},
					prepareStaticResources: async () => {},
					getAuthoredSources: (library) => glitterSources.map((source) => this._createGlitterDescriptor(library, {
						...source, label: `${library.find((item) => item.id === source.glitterId)?.name || 'Glitter'} (${source.slot})`,
						ownerLayerId: layer.id, effectSlot: source.slot
					})),
					render: ({ ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, shapeMaskCanvases }) => {
						this._renderShapeLayerToCanvas(layer, ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, shapeMaskCanvases, scratch);
					}
				};
			}

			case LayerType.STICKER: {
				const glitterSources = this._getStickerGlitterSources(layer);
				const scratch = {
					sourceCanvas: document.createElement('canvas'),
					shadowMaskCanvas: document.createElement('canvas'),
					shadowFillCanvas: document.createElement('canvas')
				};
				scratch.shadowMaskCtx = scratch.shadowMaskCanvas.getContext('2d', { alpha: true });
				return {
					prepareMasks: async () => {},
					prepareStaticResources: async ({ callbacks }) => {
						const stickerData = layer.stickerData;
						if (!stickerData.isAnimated && !this._getFrameImageData(stickerData.staticImageData)) {
							stickerData.staticImageData = null;
							callbacks.onStatus(`Loading ${stickerData.name}...`);
							try {
								stickerData.staticImageData = await this._loadStaticImage(stickerData.url);
							} catch (error) {
								throw new Error(`Failed to load static sticker ${stickerData.name}`);
							}
						}
					},
					getAuthoredSources: (library) => [
						...(layer.stickerData.isAnimated ? [this._createStickerDescriptor(layer)] : []),
						...glitterSources.map((source) => this._createGlitterDescriptor(library, {
							...source, label: `${library.find((item) => item.id === source.glitterId)?.name || 'Glitter'} (${source.slot})`,
							ownerLayerId: layer.id, effectSlot: source.slot
						}))
					],
					render: ({ ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource }) => {
						this._renderLayerToCanvas(layer, ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, scratch);
					}
				};
			}

			case LayerType.FILTER: {
				return {
					prepareMasks: async () => {},
					prepareStaticResources: async () => {},
					getAuthoredSources: () => [],
					render: ({ ctx, width, height, keepAlpha, alphaThreshold }) => {
						if (!GlitterFilter.isActive(layer.filterData, layer.opacity)) return;
						const caption = GlitterFilter.resolve(layer.filterData).caption;
						const captionSpec = caption ? GlitterFilter.nameCaptionSpec(caption, { width, height }) : null;
						GlitterFilter.renderToCanvas(ctx, width, height, layer.filterData, layer.opacity / 100, {
							keepAlpha,
							alphaThreshold,
							seed: layer.id,
							tileCache: this.filterGrainTileCache,
							blendMode: GlitterBlendModes.forLayer(layer),
							renderSource: captionSpec ? (sourceContext) => GlitterFilter.drawCaption(sourceContext, captionSpec) : null
						});
					}
				};
			}

			default:
				return {
					prepareMasks: async () => {},
					prepareStaticResources: async () => {},
					getAuthoredSources: () => [],
					render: () => {}
				};
		}
	}

	_getTextEffectGlitterSources(layer) {
		// Non-glitter modes must not declare stale selectedGlitterId values as sources.
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

		if (layer.textData?.textBackground?.enabled && layer.textData.textBackground.fill?.mode === 'glitter' && layer.textData.textBackground.fill.glitterId) {
			sources.push({
				key: this._getTextFrameKey(layer, 'backgroundFill'),
				slot: 'backgroundFill',
				glitterId: layer.textData.textBackground.fill.glitterId
			});
		}

		return sources;
	}

	_renderFilledMaskInto(fillCanvas, maskCanvas, source, layer, frameIndex, sourceKey, sourceSelectionMap, resolvedFramesBySource) {
		ensureCanvasSize(fillCanvas, maskCanvas.width, maskCanvas.height);
		const fillCtx = fillCanvas.getContext('2d', { alpha: true });
		resetCanvasContext(fillCtx, fillCanvas.width, fillCanvas.height);
		fillCtx.globalAlpha = source.opacity ?? 1;

		let fillsSurface = true;
		if (source.mode === 'solid') {
			fillCtx.fillStyle = source.color;
		} else if (source.mode === 'gradient') {
			fillCtx.fillStyle = createEffectCanvasGradient(fillCtx, source.gradient, {
				x: 0, y: 0, width: fillCanvas.width, height: fillCanvas.height
			});
		} else if (source.mode === 'image') {
			const paintBox = maskCanvas._paintBox || { x: 0, y: 0, width: fillCanvas.width, height: fillCanvas.height };
			const placement = getImageFillPlacement(source, paintBox);
			fillCtx.imageSmoothingEnabled = source.imageRendering !== 'pixelated';
			if (source.tile) {
				const pattern = fillCtx.createPattern(source.image, 'repeat');
				pattern.setTransform(new DOMMatrix()
					.translateSelf(placement.dx, placement.dy)
					.scaleSelf(
						placement.dw / (source.image.naturalWidth || source.image.width),
						placement.dh / (source.image.naturalHeight || source.image.height)
					));
				fillCtx.fillStyle = pattern;
			} else {
				fillsSurface = false;
				fillCtx.drawImage(source.image, placement.dx, placement.dy, placement.dw, placement.dh);
			}
		} else {
			const frameImageData = this._getResolvedFrame(sourceKey, frameIndex, sourceSelectionMap, resolvedFramesBySource);
			const patternSource = this._renderPatternSourceInto(this.patternSourceCanvas, frameImageData, source.colorAdjust);

			const pattern = fillCtx.createPattern(patternSource, 'repeat');
			const sourceScale = source.scale ?? layer.settings.scale;
			const scale = (sourceScale <= 0 ? 1 : sourceScale) / 100;
			const textureOrigin = getSlotTexturePatternOrigin(maskCanvas, source, layer);
			const matrix = new DOMMatrix()
				.translateSelf(textureOrigin.x, textureOrigin.y)
				.scaleSelf(scale, scale);
			pattern.setTransform(matrix);
			fillCtx.imageSmoothingEnabled = !this._isGlitterPixelated(source.glitterId);
			fillCtx.fillStyle = pattern;
		}

		if (fillsSurface) fillCtx.fillRect(0, 0, fillCanvas.width, fillCanvas.height);
		fillCtx.globalCompositeOperation = 'destination-in';
		fillCtx.drawImage(maskCanvas, 0, 0);
		fillCtx.globalCompositeOperation = 'source-over';

		return fillCanvas;
	}

	// Which glitters are pixel art, by id, for the length of one export. A texture
	// drawn through createPattern().setTransform() is resampled by the destination
	// context, so a scaled pixel-art tile blurs unless smoothing is turned off —
	// the canvas preview avoids this with image-rendering: pixelated, and the
	// export has to make the same decision from the same flag.
	_indexPixelatedGlitters(library) {
		this._pixelatedGlitterIds = new Set(
			(library || []).filter((item) => item?.isPixelated).map((item) => item.id)
		);
	}

	_isGlitterPixelated(glitterId) {
		return Boolean(glitterId) && Boolean(this._pixelatedGlitterIds?.has(glitterId));
	}

	// Build the repeating-pattern source canvas for a glitter frame, applying the
	// WP4 color-adjust matrix when the layer/slot has a non-identity adjustment.
	// The resolved frame is a shared cached ImageData, so a non-identity adjust
	// works on a COPY — never mutate the cache. Identity adjust puts the original
	// bytes straight through, keeping export byte-identical to pre-WP4 content.
	_renderPatternSourceInto(patternSource, frameImageData, colorAdjust) {
		const normalizedFrame = this._getFrameImageData(frameImageData);
		if (!normalizedFrame) throw new Error('Invalid image frame data');
		ensureCanvasSize(patternSource, normalizedFrame.width, normalizedFrame.height);
		const pctx = patternSource === this.patternSourceCanvas
			? this.patternSourceCtx
			: patternSource.getContext('2d');
		resetCanvasContext(pctx, patternSource.width, patternSource.height);

		if (colorAdjust && !isIdentityColorAdjust(colorAdjust)) {
			const copy = new ImageData(
				new Uint8ClampedArray(normalizedFrame.data),
				normalizedFrame.width,
				normalizedFrame.height
			);
			applyColorAdjustToImageData(copy, colorAdjust);
			pctx.putImageData(copy, 0, 0);
		} else {
			pctx.putImageData(normalizedFrame, 0, 0);
		}

		return patternSource;
	}

	_prepareBasePipeline(visibleLayers, canvasData, exportSettings) {
		const layer = visibleLayers.find((entry) => entry.type === LayerType.BASE_IMAGE);
		const background = layer?.background;
		if (!layer || layer.visible === false || !exportSettings.baseImage || !['image', 'gradient'].includes(background?.mode || 'image')) return null;
		const { width, height, originalData } = canvasData;
		let source = null;
		if (background.mode === 'gradient') {
			const canvas = document.createElement('canvas');
			ensureCanvasSize(canvas, width, height);
			const sourceCtx = canvas.getContext('2d', { alpha: true });
			sourceCtx.fillStyle = createEffectCanvasGradient(sourceCtx, background.gradient, { x: 0, y: 0, width, height });
			sourceCtx.fillRect(0, 0, width, height);
			source = sourceCtx.getImageData(0, 0, width, height);
		} else {
			source = new ImageData(new Uint8ClampedArray(originalData), width, height);
		}
		const settings = GlitterPixelEffects.normalizeSettings(background.pixelEffects || background.posterize, CONFIG.tools.pixelEffects);
		let ditherPalette = null;
		if (settings.paletteEnabled && settings.paletteMode === 'dither') {
			const pixelized = GlitterPixelEffects.pixelize(source.data, width, height, settings.pixelateEnabled ? settings.pixelSize : 1);
			ditherPalette = GlitterPixelEffects.getPalette(pixelized, width, height, settings, {
				pixelEffects: CONFIG.tools.pixelEffects,
				autoGlitter: CONFIG.tools.autoGlitter
			});
		}
		return {
			source,
			settings,
			colorAdjust: normalizeColorAdjust(background.colorAdjust),
			opacity: background.opacity ?? 100,
			ditherPalette,
			shimmerAnimation: settings.paletteEnabled && settings.paletteMode === 'dither' && settings.dither.shimmer
				? GlitterPixelEffects.getShimmerAnimation(settings.dither.algorithm, CONFIG.tools.pixelEffects)
				: null,
			processedFrames: new Map()
		};
	}

	_getBasePipelineImageData(context, frameIndex) {
		const pipeline = context.basePipeline;
		if (!pipeline) throw new Error('Missing prepared base pipeline');
		const { width, height } = context.canvasData;
		const shimmerFrame = pipeline.shimmerAnimation
			? ((Math.floor(frameIndex) % pipeline.shimmerAnimation.frames) + pipeline.shimmerAnimation.frames) % pipeline.shimmerAnimation.frames
			: 0;
		const cached = pipeline.processedFrames.get(shimmerFrame);
		if (cached) return cached;
		const pixelEffectsActive = pipeline.settings.pixelateEnabled || pipeline.settings.paletteEnabled;
		if (!pixelEffectsActive && isIdentityColorAdjust(pipeline.colorAdjust) && pipeline.opacity === 100) {
			pipeline.processedFrames.set(shimmerFrame, pipeline.source);
			return pipeline.source;
		}
		const data = !pipeline.settings.pixelateEnabled && !pipeline.settings.paletteEnabled
			? new Uint8ClampedArray(pipeline.source.data)
			: GlitterPixelEffects.applyPixelEffects(pipeline.source.data, width, height, pipeline.settings, {
				pixelEffects: CONFIG.tools.pixelEffects,
				autoGlitter: CONFIG.tools.autoGlitter
			}, shimmerFrame, pipeline.ditherPalette);
		const result = new ImageData(data, width, height);
		applyColorAdjustToImageData(result, pipeline.colorAdjust);
		if (pipeline.opacity < 100) {
			for (let offset = 3; offset < result.data.length; offset += 4) result.data[offset] = Math.round(result.data[offset] * pipeline.opacity / 100);
		}
		pipeline.processedFrames.set(shimmerFrame, result);
		return result;
	}

	_getResolvedFrame(sourceKey, frameIndex, sourceSelectionMap, resolvedFramesBySource) {
		const frames = resolvedFramesBySource?.get(sourceKey);
		if (!frames?.length) {
			throw new Error(`Missing resolved glitter frames for ${sourceKey}`);
		}

		const reducedFrameCount = sourceSelectionMap?.get(sourceKey);
		const frameIndexForLayer = this._getReducedFrameIndex(frameIndex, frames.length, reducedFrameCount);
		const frameImageData = this._readResolvedSource(frames, frameIndexForLayer);
		if (!frameImageData) {
			throw new Error(`Invalid glitter frame for ${sourceKey} frame ${frameIndexForLayer}`);
		}

		return frameImageData;
	}

	_readResolvedSource(source, frameIndex) {
		return typeof source?.getFrame === 'function' ? source.getFrame(frameIndex) : source?.[frameIndex];
	}

	_buildTextMaskEntry(layer, fillMaskCanvas, backgroundMaskCanvas = null) {
		const entry = {
			fill: fillMaskCanvas,
			border: null,
			shadow: null,
			background: backgroundMaskCanvas
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
		return getBorderPlacement(borderData);
	}

	_getBorderDrawOrder(borderData) {
		return getBorderDrawOrder(borderData);
	}

	_getBorderEdgeStyle(borderData) {
		return getBorderEdgeStyle(borderData);
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
		return createMaskDifferenceCanvas(baseCanvas, subtractCanvas);
	}

	_createDilatedMaskCanvas(sourceCanvas, radius, edgeStyle = 'round') {
		return createDilatedMaskCanvas(sourceCanvas, radius, edgeStyle);
	}

	_createErodedMaskCanvas(sourceCanvas, radius, edgeStyle = 'round') {
		return createErodedMaskCanvas(sourceCanvas, radius, edgeStyle);
	}

	_getMorphOffsets(widthPx) {
		return getMorphOffsets(widthPx);
	}

	_createOffsetMaskCanvas(sourceCanvas, offsetX, offsetY) {
		const canvas = document.createElement('canvas');
		canvas.width = sourceCanvas.width;
		canvas.height = sourceCanvas.height;
		this._copyTextureOrigin(canvas, sourceCanvas, offsetX, offsetY);
		const ctx = canvas.getContext('2d', { alpha: true });
		ctx.drawImage(sourceCanvas, offsetX, offsetY);
		return canvas;
	}

	_copyTextureOrigin(targetCanvas, sourceCanvas, offsetX = 0, offsetY = 0) {
		const sourceOrigin = sourceCanvas?._textureOrigin || { x: 0, y: 0 };
		targetCanvas._textureOrigin = {
			x: sourceOrigin.x + offsetX,
			y: sourceOrigin.y + offsetY
		};
	}

	_createBorderMaskCanvas(fillMaskCanvas, widthPx, cutOutFill = false) {
		const canvas = document.createElement('canvas');
		canvas.width = fillMaskCanvas.width;
		canvas.height = fillMaskCanvas.height;
		const ctx = canvas.getContext('2d', { alpha: true });

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

	_createWatermarkDescriptor(watermark) {
		return {
			key: '__watermark',
			label: 'Animated watermark',
			ownerLayerId: null,
			effectSlot: null,
			role: 'watermark',
			replayPolicy: 'watermark-current',
			sourceIdentity: watermark,
			ensureLoaded: async () => {},
			getAnimation: () => watermark,
			transformResolvedFrame: (frame) => {
				if (this.config.watermarkAlphaThreshold <= 0) return frame;
				const copy = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
				for (let offset = 3; offset < copy.data.length; offset += 4) {
					copy.data[offset] = copy.data[offset] < this.config.watermarkAlphaThreshold ? 0 : 255;
				}
				return copy;
			}
		};
	}

	async _prepareExportContext(params) {
		const { visibleLayers, glitterGifs, canvasData, exportSettings, callbacks } = params;
		const settingsSnapshot = Object.freeze({ ...exportSettings });
		const layerPlans = visibleLayers.map((layer) => ({ layer, plan: this._buildLayerExportPlan(layer) }));
		const authoredSources = layerPlans.flatMap(({ plan }) => plan.getAuthoredSources(glitterGifs));
		this._validateAuthoredSourceKeys(authoredSources);
		const sourceKeys = new Set(authoredSources.map((descriptor) => descriptor.key));
		for (const descriptor of authoredSources) {
			await descriptor.ensureLoaded(callbacks);
		}
		for (let index = 0; index < layerPlans.length; index++) {
			await layerPlans[index].plan.prepareStaticResources({ callbacks, canvasData });
			callbacks.onLayerLoaded?.(index + 1, layerPlans.length);
		}
		let watermark = null;
		if (settingsSnapshot.watermarkEnabled) watermark = await this._loadWatermark(callbacks, settingsSnapshot.watermark);
		const watermarkCanvas = watermark ? document.createElement('canvas') : null;
		const watermarkSource = watermark?.isAnimated ? this._createWatermarkDescriptor(watermark) : null;
		if (watermarkSource) {
			if (sourceKeys.has(watermarkSource.key)) throw new Error(`Duplicate authored source key: ${watermarkSource.key}`);
			sourceKeys.add(watermarkSource.key);
			authoredSources.push(watermarkSource);
		}
		const masks = {
			raw: new Map(),
			glitter: new Map(),
			text: new Map(),
			shape: new Map()
		};
		for (const { plan } of layerPlans) {
			await plan.prepareMasks({
				maskDataMap: masks.raw,
				maskCanvases: masks.glitter,
				textMaskCanvases: masks.text,
				shapeMaskCanvases: masks.shape,
				canvasData,
				callbacks
			});
		}
		this._indexPixelatedGlitters(glitterGifs);
		const basePipeline = this._prepareBasePipeline(visibleLayers, canvasData, settingsSnapshot);
		return {
			visibleLayers,
			library: glitterGifs,
			canvasData,
			exportSettings: settingsSnapshot,
			layerPlans,
			masks,
			authoredSources,
			proceduralSources: this._collectProceduralSources(visibleLayers, { includeBaseImage: settingsSnapshot.baseImage }),
			basePipeline,
			watermark,
			watermarkCanvas,
			watermarkSource
		};
	}

	_prepareAuthoredResolution(context, session, fallbackDuration) {
		const resolvedFramesBySource = new Map();
		const authoredTimelines = [];
		for (const descriptor of context.authoredSources) {
			const animation = descriptor.getAnimation();
			resolvedFramesBySource.set(descriptor.key, {
				length: animation.frames.length,
				getFrame: (frameIndex) => this.authoredFrameResolver.resolveFrame(descriptor, frameIndex, session)
			});
			const sourceFallback = descriptor.role === 'watermark' ? fallbackDuration : CONFIG.export.defaults.frameDelay;
			authoredTimelines.push(this._createAuthoredTimingSource(descriptor, sourceFallback));
		}
		return { resolvedFramesBySource, authoredTimelines };
	}

	_resolveSelectedAuthored(context, session, timestamp, fallbackDuration) {
		const resolvedFramesBySource = new Map();
		const sourceSelectionMap = new Map();
		for (const descriptor of context.authoredSources) {
			const sourceFallback = descriptor.role === 'watermark' ? fallbackDuration : CONFIG.export.defaults.frameDelay;
			const timeline = this._createAuthoredTimingSource(descriptor, sourceFallback);
			const nativeFrameIndex = timeline.frameIndexAt(timestamp);
			resolvedFramesBySource.set(descriptor.key, [this.authoredFrameResolver.resolveFrame(descriptor, nativeFrameIndex, session)]);
			sourceSelectionMap.set(descriptor.key, { frameIndex: 0, nativeFrameIndex });
		}
		for (const descriptor of context.proceduralSources) {
			sourceSelectionMap.set(descriptor.key, descriptor.sampleAt(timestamp));
		}
		return { resolvedFramesBySource, sourceSelectionMap };
	}


	async process(params) {
		const { visibleLayers, glitterGifs, canvasData, callbacks, scheduleSink = null, outputFormat = 'gif' } = params;
		const exportSettings = {
			...params.exportSettings,
			frameDelay: AuthoredAnimationSource.normalizeDuration(params.exportSettings.frameDelay, CONFIG.export.defaults.frameDelay)
		};
		this.filterGrainTileCache.clear();

		// Common preparation owns source loading, masks, and immutable settings.
		reportGifExportProgress(callbacks, 'loading', 0, 'Loading animation sources…', 0, visibleLayers.length);
		let loadingSourceCount = 0;
		const loadingCallbacks = {
			...callbacks,
			onStatus: (detail) => {
				callbacks.onStatus(detail);
				if (!detail.startsWith('Loading ')) return;
				loadingSourceCount++;
				reportGifExportProgress(callbacks, 'loading', 0, detail, loadingSourceCount, 0, { indeterminate: true });
			},
			onLayerLoaded: (current, total) => {
				const layerShare = exportSettings.watermarkEnabled ? 0.45 : 0.9;
				reportGifExportProgress(callbacks, 'loading', layerShare * (current / total), `Loaded layer sources ${current} / ${total}`, current, total);
			},
			onSourceProgress: (detail, current, total) => {
				const hasTotal = Number.isFinite(total) && total > 0;
				const progress = hasTotal ? Math.min(1, current / total) : 0;
				const isDecode = detail.startsWith('Decoding');
				const ratio = isDecode ? 0.65 + (progress * 0.3) : 0.45 + (progress * 0.2);
				reportGifExportProgress(callbacks, 'loading', ratio, detail, current, total, { indeterminate: !hasTotal });
			}
		};
		const context = await this._prepareExportContext({ ...params, visibleLayers, glitterGifs, canvasData, exportSettings, callbacks: loadingCallbacks });
		const { proceduralSources } = context;
		reportGifExportProgress(callbacks, 'loading', 1, 'Animation sources ready', visibleLayers.length, visibleLayers.length);

		reportGifExportProgress(callbacks, 'masks', 0, 'Preparing layer masks…', 0, visibleLayers.length);
		reportGifExportProgress(callbacks, 'masks', 1, 'Layer masks ready', visibleLayers.length, visibleLayers.length);

		// Animation materializes authored frames on demand; still composition resolves one selected frame.
		reportGifExportProgress(callbacks, 'planning', 0, 'Indexing animation frames…');
		await this._yieldForProgress();
		const resolutionSession = this.authoredFrameResolver.createSession({ isCancelled: callbacks.isCancelled });
		const { resolvedFramesBySource, authoredTimelines } = this._prepareAuthoredResolution(context, resolutionSession, exportSettings.frameDelay);

		const preserveAlpha = this._resolvePreserveAlpha(params.target?.supportsTransparency ?? outputFormat === 'gif', exportSettings);

		const timelineConfig = CONFIG.export.timeline;
		const requestedFidelity = Number(exportSettings.exportFidelity);
		const fidelityIndex = Math.max(0, Math.min(
			timelineConfig.fidelityStops.length - 1,
			Number.isFinite(requestedFidelity) ? requestedFidelity : CONFIG.export.defaults.exportFidelity
		));
		const preset = timelineConfig.fidelityStops[fidelityIndex];
		const sourceTimelines = [...authoredTimelines, ...this._createProceduralTimelines(proceduralSources)];

		callbacks.onStatus('Planning animation timing...');
		reportGifExportProgress(callbacks, 'planning', 0.5, 'Resolving source timing…');
		ensureCanvasSize(this.helperCanvas, canvasData.width, canvasData.height);
		ensureCanvasSize(this.layerBlendCanvas, canvasData.width, canvasData.height);
		ensureCanvasSize(this.canvas, canvasData.width, canvasData.height);
		let renderedCandidateCount = 0;
		const planner = new CompositeTimelinePlanner(timelineConfig);
		const plannerOptions = {
			timelines: sourceTimelines,
			outputFormat,
			fallbackDuration: exportSettings.frameDelay,
			maxLoopDurationMs: timelineConfig.maxLoopDurationMs,
			maxSamplingFps: exportSettings.maxSamplingFps === 'auto' ? preset.maxSamplingFps : (exportSettings.maxSamplingFps || preset.maxSamplingFps),
			manualFrameSkip: exportSettings.exportFrameSkip,
			reverse: exportSettings.exportReverse,
			smartReduction: exportSettings.smartFrameReduction,
			preRenderSampling: fidelityIndex >= 2,
			preRenderBudgetMultiplier: fidelityIndex >= 3 ? timelineConfig.preRenderBudgetMultiplier : 1,
			visualErrorThreshold: Number.isFinite(exportSettings.visualErrorThreshold)
				? exportSettings.visualErrorThreshold
				: preset.visualError,
			preferredFrameBudget: exportSettings.maxFrames || timelineConfig.preferredFrameBudget,
			hardFrameLimit: timelineConfig.hardFrameLimit,
			onStatus: (detail) => {
				callbacks.onStatus(detail);
				reportGifExportProgress(callbacks, 'planning', 1, detail);
			},
			renderFrame: async (timestamp, frameSelection, candidateCount) => {
				renderedCandidateCount++;
				reportGifExportProgress(callbacks, 'composing', renderedCandidateCount / candidateCount, `Composing frame ${renderedCandidateCount} / ${candidateCount}`, renderedCandidateCount, candidateCount);
				const frame = this._renderFrame({
					outputFrameIndex: 0,
					timestamp,
					context,
					transparency: { enabled: preserveAlpha },
					sourceSelectionMap: frameSelection,
					resolvedFramesBySource
				});
				if (renderedCandidateCount < candidateCount
					&& renderedCandidateCount % CONFIG.export.progress.yieldEveryFrames === 0) {
					await this._yieldForProgress();
				}
				return frame;
			}
		};
		const plan = scheduleSink
			? planner.planSchedule(plannerOptions)
			: await planner.plan(plannerOptions);
		plan.width = canvasData.width;
		plan.height = canvasData.height;
		dbg('[GifExporter] Render clock:', {
			mode: plan.renderClock.mode,
			targetDuration: plan.renderClock.targetDuration,
			actualDuration: plan.renderClock.duration,
			frameCount: plan.renderClock.frameCount,
			outputFps: plan.renderClock.outputFps,
			averageFps: plan.renderClock.averageFps,
			minimumDelay: plan.renderClock.minimumDelay,
			maximumDelay: plan.renderClock.maximumDelay,
			maximumAuthoredBoundaryLateness: plan.renderClock.maximumAuthoredBoundaryLateness,
			authoredOccurrencesMissed: plan.renderClock.authoredOccurrencesMissed,
			clippedOccurrencesMissed: plan.renderClock.clippedOccurrencesMissed,
			proceduralCadenceShortfall: plan.renderClock.cadenceShortfall,
			framesBeforeReduction: plan.renderClock.framesBeforeReduction,
			framesAfterReduction: plan.renderClock.framesAfterReduction
		});
		if (!scheduleSink) reportGifExportProgress(callbacks, 'reducing', 1, `Removed ${plan.reduction.exactDuplicatesMerged + plan.reduction.nearDuplicatesMerged} duplicate or near-duplicate frames`, plan.reduction.outputFrameCount, plan.reduction.renderedFrameCount);
		if (plan.reduction.budgetCompromiseRequired) {
			const detail = 'The hard frame limit requires a quality compromise; no frames were silently truncated.';
			callbacks.onStatus(detail);
			reportGifExportProgress(callbacks, 'reducing', 1, detail);
		}

		if (scheduleSink) {
			return scheduleSink({
				schedulePlan: plan,
				renderScheduleEntry: (entry, scheduleIndex = 0) => this._renderFrameToCanvas({
					outputFrameIndex: scheduleIndex,
					timestamp: entry.timestamp,
					context,
					transparency: { enabled: preserveAlpha },
					sourceSelectionMap: entry.selection,
					resolvedFramesBySource
				})
			});
		}
		const frames = plan.frames;
		plan.frameCount = frames.length;
		delete plan.frames;
		const encoded = await this.gifEncodingPipeline.encode({
			frames,
			delays: plan.frameDurations,
			settings: exportSettings,
			transparency: { enabled: preserveAlpha },
			mode: 'animation',
			reportProgress: (phase, ratio, detail, current, total) => reportGifExportProgress(callbacks, phase, ratio, detail, current, total),
			isCancelled: callbacks.isCancelled
		});
		plan.colorAnalysis = encoded.analysis;
		if (plan.colorAnalysis) {
			plan.colorAnalysis.ditherEnabled = Boolean(exportSettings.ditherEnabled && !encoded.transparencyUsed);
			plan.colorAnalysis.paletteSize = encoded.paletteSize;
			plan.colorAnalysis.paletteMode = encoded.paletteMode;
			plan.colorAnalysis.authoredDither = visibleLayers.some((layer) => {
				const effects = layer.background?.pixelEffects;
				return effects?.paletteEnabled && effects.paletteMode === 'dither';
			});
		}
		this._handleFileSave(encoded.blob, callbacks, plan);
		return encoded.blob;

	}

	async composeFrameAt(params) {
		const { visibleLayers, canvasData, exportSettings, callbacks, timestamp = 0 } = params;
		this.filterGrainTileCache.clear();
		callbacks.onProgress(0, 'Loading sources…', 0, visibleLayers.length, { phase: 'Preparing' });
		const context = await this._prepareExportContext(params);
		const session = this.authoredFrameResolver.createSession({ isCancelled: callbacks.isCancelled });
		const { resolvedFramesBySource, sourceSelectionMap } = this._resolveSelectedAuthored(context, session, timestamp, exportSettings.frameDelay);
		const preserveAlpha = this._resolvePreserveAlpha(params.target?.supportsTransparency ?? true, exportSettings);
		ensureCanvasSize(this.helperCanvas, canvasData.width, canvasData.height);
		ensureCanvasSize(this.layerBlendCanvas, canvasData.width, canvasData.height);
		ensureCanvasSize(this.canvas, canvasData.width, canvasData.height);
		callbacks.onProgress(45, 'Composing still frame…', 1, 1, { phase: 'Composing' });
		const imageData = this._renderFrame({
			outputFrameIndex: 0,
			timestamp,
			context,
			transparency: { enabled: preserveAlpha },
			sourceSelectionMap,
			resolvedFramesBySource
		});
		return {
			imageData,
			width: canvasData.width,
			height: canvasData.height,
			timestamp,
			transparency: { enabled: preserveAlpha }
		};
	}

	// --- HELPER METHODS ---

	_renderFrameToCanvas({ outputFrameIndex: frameIndex, timestamp = 0, context, transparency, sourceSelectionMap = null, resolvedFramesBySource = null }) {
		const { canvasData, visibleLayers: layers, exportSettings, watermark, watermarkCanvas, layerPlans, masks } = context;
		const { enabled: preserveAlpha } = transparency;
		const maskCanvases = masks.glitter;
		const textMaskCanvases = masks.text;
		const shapeMaskCanvases = masks.shape;
		const { width, height, alphaThreshold } = canvasData;
		const ctx = this.ctx;
		const hCtx = this.helperCtx;

		// 1. Reset/Setup Canvas
		ensureCanvasSize(this.canvas, width, height);
		ensureCanvasSize(this.helperCanvas, width, height);
		ensureCanvasSize(this.layerBlendCanvas, width, height);
		resetCanvasContext(ctx, width, height);
		resetCanvasContext(hCtx, width, height);

		// 2. Identify Base Image Visibility
		const baseLayer = layers.find(l => l.type === LayerType.BASE_IMAGE);
		const isBaseLayerVisible = baseLayer ? (baseLayer.visible !== false) : false;
		const shouldRenderBase = exportSettings.baseImage && isBaseLayerVisible;
		const baseMode = baseLayer?.background?.mode || 'image';

		// 3. Start from the matte, or leave the canvas clear for real alpha.
		// The compositor never predicts final transparency or paints an RGB key.
		if (!preserveAlpha) {
			const matte = this._parseHexColor(exportSettings.matteColor || '#ffffff');
			ctx.fillStyle = `rgb(${matte.r}, ${matte.g}, ${matte.b})`;
			ctx.fillRect(0, 0, width, height);
		}

		// 4. Draw the base image with its real RGBA alpha. When the compositor
		// is transparent this reveals the base's own alpha; when it holds a
		// matte, normal alpha compositing blends the base against it.
		if (shouldRenderBase && ((baseMode === 'image' && canvasData.hasBaseImage !== false) || baseMode === 'gradient')) {
			const baseEffectFrame = sourceSelectionMap?.get('__base_dither')?.frameIndex ?? frameIndex;
			const baseImage = this._getBasePipelineImageData(context, baseEffectFrame);
			resetCanvasContext(hCtx, width, height);
			hCtx.putImageData(baseImage, 0, 0);
			ctx.drawImage(this.helperCanvas, 0, 0);
		}

		// 5. Composite Glitter and Sticker Layers (in correct z-order)
		layerPlans.forEach(({ layer, plan }) => {
			if (layer.visible === false) return;
			if (layer.type === LayerType.BASE_IMAGE && !exportSettings.baseImage) return;
			const blendMode = LAYER_UI_CONFIG[layer.type]?.blendable
				? GlitterBlendModes.forLayer(layer)
				: CONFIG.layers.defaultBlendMode;
			// Filter layers read the real canvas beneath them (tone/blur adjust
			// existing pixels in place) rather than painting independent content,
			// so they can't be routed through the offscreen layer-group blend used
			// by paint layers - that would hand them a blank canvas to read from.
			// Their blend mode is applied internally, per paint op, instead.
			const usesLayerGroupBlend = layer.type !== LayerType.FILTER;
			const renderCtx = (!usesLayerGroupBlend || blendMode === CONFIG.layers.defaultBlendMode) ? ctx : this.layerBlendCtx;
			if (usesLayerGroupBlend && renderCtx === this.layerBlendCtx) {
				renderCtx.setTransform(1, 0, 0, 1, 0, 0);
				renderCtx.globalAlpha = 1;
				renderCtx.globalCompositeOperation = 'source-over';
				renderCtx.clearRect(0, 0, width, height);
			}
			const animationUnits = GlitterAnimation.isActive(layer.animation)
				? [{ animData: layer.animation, anchorBox: this._getAnimationBox(layer, width, height) }]
				: [{ animData: null, anchorBox: null }];
			animationUnits.forEach((unit) => {
				renderCtx.save();
				if (unit.animData) {
					const sample = sourceSelectionMap?.get(`__anim_${layer.id}`)?.sample
						|| GlitterAnimation.sampleAt(unit.animData, timestamp, { layerId: layer.id });
					if (layer.type === LayerType.GLITTER_FILL) {
						renderCtx.translate(unit.anchorBox.x, unit.anchorBox.y);
						GlitterAnimation.applyToContext(renderCtx, sample, unit.anchorBox.width, unit.anchorBox.height);
						renderCtx.translate(-unit.anchorBox.x, -unit.anchorBox.y);
						renderCtx.globalAlpha *= sample.opacity;
					} else {
						this._activeLayerAnimation = { transform: getLayerTransform(layer), sample };
					}
				}
				try {
					plan.render({
						ctx: renderCtx,
						frameIndex,
						sourceSelectionMap,
						resolvedFramesBySource,
						maskCanvases,
						textMaskCanvases,
						shapeMaskCanvases,
						helperCtx: hCtx,
						width,
						height,
						keepAlpha: preserveAlpha,
						alphaThreshold
					});
				} finally {
					this._activeLayerAnimation = null;
					renderCtx.restore();
				}
			});
			if (usesLayerGroupBlend && renderCtx === this.layerBlendCtx) {
				if (blendMode === 'color-burn') {
					const destination = ctx.getImageData(0, 0, width, height);
					const source = renderCtx.getImageData(0, 0, width, height);
					GlitterBlendModes.compositeColorBurn(destination, source);
					ctx.putImageData(destination, 0, 0);
				} else {
					ctx.save();
					ctx.globalCompositeOperation = GlitterBlendModes.cssToGCO(blendMode);
					ctx.drawImage(this.layerBlendCanvas, 0, 0);
					ctx.restore();
				}
			}
		});

		// 6. Render Watermark
		if (exportSettings.watermarkEnabled && watermark) {
			const watermarkFrame = sourceSelectionMap?.get('__watermark')?.frameIndex ?? frameIndex;
			this._renderWatermarkToCanvas(watermark, watermarkCanvas, ctx, width, height, watermarkFrame, resolvedFramesBySource?.get('__watermark'));
		}

		return this.canvas;
	}

	_renderFrame(options) {
		this._renderFrameToCanvas(options);
		const { width, height } = options.context.canvasData;
		return this.ctx.getImageData(0, 0, width, height);
	}

	async _parseGifWithMetadata(url, providedBytes = null, onProgress = null) {
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
			onProgress?.(0, frameCount);

			for (let i = 0; i < frameCount; i++) {
				const frameInfo = reader.frameInfo(i);
				frameDelays.push(AuthoredAnimationSource.normalizeDuration(frameInfo.delay * 10, 100));

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
				onProgress?.(i + 1, frameCount);
				if (i + 1 < frameCount && (i + 1) % CONFIG.export.progress.yieldEveryFrames === 0) {
					await this._yieldForProgress();
				}
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

	_yieldForProgress() {
		return new Promise((resolve) => requestAnimationFrame(resolve));
	}

	async estimateLoopDuration({
		layers,
		library,
		fallbackDuration,
		parseGif,
		smartReduction = false,
		exportFidelity = CONFIG.export.defaults.exportFidelity,
		maxSamplingFps = 'auto',
		maxFrames = CONFIG.export.defaults.maxFrames,
		manualFrameSkip = CONFIG.export.defaults.frameSkip,
		baseImage = true,
		visualErrorThreshold = CONFIG.export.defaults.visualErrorThreshold,
		outputFormat = 'gif'
	}) {
		const callbacks = {
			parseGif,
			onStatus: () => {},
			ensureTextFont: async () => {}
		};
		const layerPlans = layers.map((layer) => ({ layer, plan: this._buildLayerExportPlan(layer) }));
		const descriptors = layerPlans.flatMap(({ plan }) => plan.getAuthoredSources(library));
		this._validateAuthoredSourceKeys(descriptors);
		for (const descriptor of descriptors) {
			await descriptor.ensureLoaded(callbacks);
		}
		const timelines = [
			...descriptors.map((descriptor) => this._createAuthoredTimingSource(descriptor, fallbackDuration)),
			...this._createProceduralTimelines(this._collectProceduralSources(layers, { includeBaseImage: baseImage }))
		];
		const timelineConfig = CONFIG.export.timeline;
		const requestedFidelity = Number(exportFidelity);
		const fidelityIndex = Math.max(0, Math.min(
			timelineConfig.fidelityStops.length - 1,
			Number.isFinite(requestedFidelity) ? requestedFidelity : CONFIG.export.defaults.exportFidelity
		));
		const fidelity = timelineConfig.fidelityStops[fidelityIndex];
		const plan = await new CompositeTimelinePlanner(timelineConfig).plan({
			timelines,
			outputFormat,
			fallbackDuration,
			maxLoopDurationMs: timelineConfig.maxLoopDurationMs,
			maxSamplingFps: maxSamplingFps === 'auto' ? fidelity.maxSamplingFps : maxSamplingFps,
			manualFrameSkip,
			reverse: false,
			smartReduction,
			preRenderSampling: fidelityIndex >= 2,
			preRenderBudgetMultiplier: fidelityIndex >= 3 ? timelineConfig.preRenderBudgetMultiplier : 1,
			visualErrorThreshold: Number.isFinite(visualErrorThreshold) ? visualErrorThreshold : fidelity.visualError,
			preferredFrameBudget: maxFrames,
			hardFrameLimit: timelineConfig.hardFrameLimit,
			renderFrame: (_timestamp, selection) => {
				const data = new Uint8ClampedArray(Math.max(1, timelines.length) * 4);
				timelines.forEach((timeline, index) => {
					const selected = selection.get(timeline.key);
					if (timeline.kind === 'authored') {
						data[index * 4] = Math.round((selected?.frameIndex || 0) / Math.max(1, timeline.frameCount - 1) * 255);
					} else {
						let hash = 2166136261;
						for (const character of JSON.stringify(selected)) {
							hash ^= character.charCodeAt(0);
							hash = Math.imul(hash, 16777619);
						}
						data[index * 4] = hash & 0xff;
						data[index * 4 + 1] = (hash >>> 8) & 0xff;
						data[index * 4 + 2] = (hash >>> 16) & 0xff;
					}
					data[index * 4 + 3] = 255;
				});
				return new ImageData(data, Math.max(1, timelines.length), 1);
			}
		});
		return {
			...plan.loopSeam,
			duration: plan.totalDuration,
			estimatedFrameCount: plan.frameCount,
			maximumVisualError: plan.reduction.maximumVisualError,
			timingResolution: plan.timingResolution
		};
	}

	_renderWatermarkToCanvas(watermark, watermarkCanvas, ctx, canvasWidth, canvasHeight, frameIndex, resolvedFrames = null) {
		if (!watermark) return;

		// Determine which frame/image to use
		let sourceData;
		if (watermark.isAnimated) {
			const frames = resolvedFrames || watermark.frames;
			const frameCount = frames.length;
			const watermarkFrameIndex = frameIndex % frameCount;
			const frame = this._readResolvedSource(frames, watermarkFrameIndex);
			sourceData = this._getFrameImageData(frame, watermark.width, watermark.height);
		} else if (watermark.frames?.length) {
			// A one-frame GIF is static, but still uses the GIF frame representation.
			sourceData = this._getFrameImageData(watermark.frames[0], watermark.width, watermark.height);
		} else {
			sourceData = watermark.imageData;
		}

		if (!sourceData) {
			if (this.config.debug) console.error('[GifExporter] Invalid watermark frame', frameIndex);
			return;
		}

		if (!watermarkCanvas) throw new Error('Missing watermark scratch canvas');
		ensureCanvasSize(watermarkCanvas, watermark.width, watermark.height);
		const tempCtx = watermarkCanvas.getContext('2d', { alpha: true });
		resetCanvasContext(tempCtx, watermark.width, watermark.height, false);

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
		ctx.drawImage(watermarkCanvas, 0, 0, watermark.width, watermark.height, x, y, scaledWidth, scaledHeight);
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



	async _loadWatermark(callbacks, watermarkUrl = CONFIG.export.watermark.url) {
		if (!watermarkUrl) {
			return null;
		}

		callbacks.onStatus('Loading watermark...');

		try {
			const response = await fetch(watermarkUrl);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const contentLength = Number(response.headers.get('content-length'));
			let blob;
			if (response.body && Number.isFinite(contentLength) && contentLength > 0) {
				const reader = response.body.getReader();
				const chunks = [];
				let received = 0;
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					chunks.push(value);
					received += value.byteLength;
					callbacks.onSourceProgress?.(`Downloading watermark… ${Math.round(received / 1024)} / ${Math.round(contentLength / 1024)} KB`, received, contentLength);
				}
				blob = new Blob(chunks, { type: response.headers.get('content-type') || '' });
			} else {
				callbacks.onSourceProgress?.('Downloading watermark…', 0, 0);
				blob = await response.blob();
			}
			const arrayBuffer = await blob.arrayBuffer();
			const uint8Array = new Uint8Array(arrayBuffer);

			// Check GIF signature
			const isGif = uint8Array[0] === 0x47 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46;

			if (isGif) {
				callbacks.onSourceProgress?.('Decoding animated watermark…', 0, 0);
				await this._yieldForProgress();
				const frames = await this._parseGifWithMetadata(watermarkUrl, uint8Array, (current, total) => {
					const detail = current > 0 ? `Decoding watermark frame ${current} / ${total}` : `Preparing ${total} watermark frames…`;
					callbacks.onSourceProgress?.(detail, current, total);
				});

				return {
					isAnimated: frames.frameCount > 1,
					width: frames.width,
					height: frames.height,
					frames: frames.frames,
					frameCount: frames.frameCount,
					frameDelay: frames.frameDelay,
					frameDelays: frames.frameDelays,
					alphaProcessed: frames.frameCount > 1
				};
			} else {
				// For static images
				callbacks.onSourceProgress?.('Decoding watermark image…', 0, 0);
				await this._yieldForProgress();
				return new Promise((resolve, reject) => {
					const img = new Image();
					const objectUrl = URL.createObjectURL(blob);

					img.onload = () => {
						URL.revokeObjectURL(objectUrl);
						const canvas = document.createElement('canvas');
						canvas.width = img.naturalWidth;
						canvas.height = img.naturalHeight;
						const ctx = canvas.getContext('2d', { alpha: true });
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

					img.onerror = () => {
						URL.revokeObjectURL(objectUrl);
						reject(new Error('Failed to load watermark image'));
					};
					img.src = objectUrl;
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

	_handleFileSave(blob, callbacks, plan) {
		dbg('_handleFileSave called with blob size:', blob.size);
		reportGifExportProgress(callbacks, 'finalizing', 1, 'Export complete');
		callbacks.onStatus('Export complete!');
		callbacks.onComplete({
			smartReduced: plan.reduction.framesRemoved > 0,
			timelinePlan: plan
		});

		const file = new File([blob], this.fileName, {
			type: 'image/gif',
			lastModified: Date.now()
		});

		this.resultPresenter?.show({ blob, file, target: EXPORT_TARGETS['animation:gif'], width: this.canvas.width, height: this.canvas.height, frameCount: plan.frameCount, duration: plan.totalDuration / 1000, timelinePlan: plan });
	}
}
