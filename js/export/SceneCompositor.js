// ============================================
// SCENE COMPOSITOR
// Renders the document to canvas for every export format: per-layer export
// plans, slot and mask rendering, authored and procedural source timing, the
// base pixel pipeline and the watermark. GifExporter, Mp4Exporter and
// StillImageExporter only encode what it composes (planAnimation for
// animations, composeFrameAt for stills).
// ============================================
const EXPORT_PROGRESS_PHASES = Object.freeze({
	loading: { label: 'Loading sources', start: 0, end: 8 },
	masks: { label: 'Preparing masks', start: 8, end: 12 },
	planning: { label: 'Planning timing', start: 12, end: 15 },
	composing: { label: 'Composing frames', start: 15, end: 65 },
	reducing: { label: 'Reducing frames', start: 65, end: 70 },
	palette: { label: 'Building palette', start: 70, end: 78 },
	encoding: { label: 'Encoding', start: 78, end: 99 },
	finalizing: { label: 'Finalizing', start: 99, end: 100 }
});

function reportExportProgress(callbacks, phaseKey, ratio = 0, detail = '', phaseCurrent = 0, phaseTotal = 0, options = {}) {
	const phase = EXPORT_PROGRESS_PHASES[phaseKey];
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

class SceneCompositor {
	constructor(options = {}) {
		this.editor = options.editor || null;
		const exportConfig = CONFIG.export || {};
		this.config = {
			debug: typeof CONFIG !== 'undefined' ? CONFIG.debug?.enabled : false,
			watermarkAlphaThreshold: exportConfig.watermark.alphaThreshold
		};

		// Reusable canvas elements
		this.canvas = createAppCanvas(0, 0, 'export/SceneCompositor');
		this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

		this.helperCanvas = createAppCanvas(0, 0, 'export/SceneCompositor');
		this.helperCtx = this.helperCanvas.getContext('2d');
		this.layerBlendCanvas = createAppCanvas(0, 0, 'export/SceneCompositor');
		this.layerBlendCtx = this.layerBlendCanvas.getContext('2d', { willReadFrequently: true });
		this.patternSourceCanvas = createAppCanvas(0, 0, 'export/SceneCompositor');
		this.patternSourceCtx = this.patternSourceCanvas.getContext('2d');
		this._patternAdjustScratch = null;
		this.filterGrainTileCache = new Map();
		this.authoredFrameResolver = options.authoredFrameResolver || new AuthoredFrameResolver();
		this.resolveShapeFillImage = options.resolveShapeFillImage || (() => null);
		// Animated sources decoded for the running export, by URL. Nothing is
		// stored on asset records or layers; releaseDecodedSources() drops these
		// when an export finishes. Timing reads (no pixels) are small and kept.
		this.decodedSources = new Map();
		this.sourceTimings = new Map();
	}

	releaseDecodedSources() {
		this.decodedSources.clear();
	}

	getDecodedSourceBytes() {
		let total = 0;
		this.decodedSources.forEach((decoded) => { total += getDecodedGifBytes(decoded); });
		return total;
	}

	// Loads one animated source for export, or only its timing (loop estimate).
	async _loadAnimatedSource(url, { timingOnly = false, onStatus = null, failure }) {
		if (this.decodedSources.has(url) || (timingOnly && this.sourceTimings.has(url))) return;
		onStatus?.();
		try {
			if (timingOnly) this.sourceTimings.set(url, readGifTiming(await fetchGifBytes(url)));
			else this.decodedSources.set(url, await decodeGifFromUrl(url));
		} catch (error) {
			throw new Error(failure);
		}
	}

	_getAnimatedSource(url) {
		return this.decodedSources.get(url) || this.sourceTimings.get(url) || null;
	}

	// The compositor no longer predicts whether transparency will remain
	// visible after composition; it only decides where composition starts.
	_resolvePreserveAlpha(targetSupportsTransparency, exportSettings) {
		return Boolean(targetSupportsTransparency && exportSettings.transparency);
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
	_drawTransformedCanvas(ctx, sourceCanvas, layer, width, height, { smooth = false } = {}) {
		const transform = getLayerTransform(layer);
		const metrics = computeLayerTransform(transform, { width, height });
		const animation = this._activeLayerAnimation?.layer === layer
			? this._activeLayerAnimation.sample
			: null;

		ctx.save();
		ctx.imageSmoothingEnabled = smooth;
		ctx.globalAlpha *= layer.opacity / 100;
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

		// Rainbow: rotate hue on the isolated source canvas before it's composited,
		// mirroring the live-preview wrapper filter. sourceCanvas is rebuilt fresh
		// every frame, so mutating it in place here is safe.
		if (animation?.hue) {
			const sourceCtx = sourceCanvas.getContext('2d');
			const pixels = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
			applyColorAdjustToImageData(pixels, { hue: animation.hue, saturation: 100, brightness: 100 });
			sourceCtx.putImageData(pixels, 0, 0);
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
		const origin = getLayerAnimationOrigin(this.editor, layer, { width, height });
		return { x: metrics.centerX - width / 2, y: metrics.centerY - height / 2, width, height, origin };
	}

	_renderLayerToCanvas(layer, ctx, frameIndex, sourceSelectionMap = null, resolvedFramesBySource = null, scratch = null) {
		const { isAnimated, width, height } = layer.stickerData;

		// Determine which frame/image to use
		let imageData;
		if (isAnimated && this.decodedSources.has(layer.stickerData.url)) {
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

		this._drawTransformedCanvas(ctx, tempCanvas, layer, width, height, {
			smooth: layer.stickerData.isPixelated === false
		});
	}

	// Sticker shadows share the slot paint path. The shadow is the sticker's own
	// silhouette on a canvas padded by its offset, so it is drawn with the
	// sticker transform rather than composited into a slot stack.
	_renderStickerEffects(layer, ctx, stickerCanvas, frameIndex, sourceSelectionMap, resolvedFramesBySource, scratch) {
		if (!scratch?.shadowMaskCanvas || !scratch?.shadowFillCanvas) return;
		buildSlotStack(layer, (entry) => this._getSlotSource(layer, entry)).forEach((item) => {
			const pad = getShadowCanvasPadding(item.data);
			const effectMask = scratch.shadowMaskCanvas;
			ensureCanvasSize(effectMask, stickerCanvas.width + pad * 2, stickerCanvas.height + pad * 2);
			const effectMaskCtx = scratch.shadowMaskCtx;
			resetCanvasContext(effectMaskCtx, effectMask.width, effectMask.height);
			effectMaskCtx.drawImage(stickerCanvas, pad + item.offsetX, pad + item.offsetY);
			effectMask._textureOrigin = { x: item.offsetX, y: item.offsetY };
			this._renderFilledMaskInto(scratch.shadowFillCanvas, effectMask, item.source, layer, frameIndex, item.sourceKey, sourceSelectionMap, resolvedFramesBySource);
			this._drawTransformedCanvas(ctx, scratch.shadowFillCanvas, layer, scratch.shadowFillCanvas.width, scratch.shadowFillCanvas.height, {
				smooth: layer.stickerData.isPixelated === false
			});
		});
	}

	// Composite a text or shape layer's slot stack (buildSlotStack order, the
	// same list the preview span stack reads) into one surface, then place it.
	// Preview fades/transforms the wrapper around the complete span stack, so
	// export must composite the object's paints before applying its
	// whole-layer opacity or animation, or overlapping effects show through.
	_renderSlotStackToCanvas(layer, ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, slotMasks, scratch) {
		if (!slotMasks?.fill) {
			throw new Error(`Missing slot masks for layer ${layer.id}`);
		}
		const width = slotMasks.renderWidth;
		const height = slotMasks.renderHeight;
		const compositeCanvas = scratch?.compositeCanvas;
		const fillCanvas = scratch?.fillCanvas;
		if (!compositeCanvas || !fillCanvas) throw new Error(`Missing slot scratch for layer ${layer.id}`);
		ensureCanvasSize(compositeCanvas, width, height);
		ensureCanvasSize(fillCanvas, width, height);
		const compositeCtx = scratch.compositeCtx;
		resetCanvasContext(compositeCtx, width, height);
		buildSlotStack(layer, (entry) => this._getSlotSource(layer, entry)).forEach((item) => {
			const maskCanvas = slotMasks[item.key];
			if (!maskCanvas) return;
			this._renderFilledMaskInto(fillCanvas, maskCanvas, item.source, layer, frameIndex, item.sourceKey, sourceSelectionMap, resolvedFramesBySource);
			compositeCtx.drawImage(fillCanvas, 0, 0, width, height);
		});
		this._drawTransformedCanvas(ctx, compositeCanvas, layer, width, height);
	}

	// The preview resolves the same slot with resolvePaintSlotSource, adding
	// only the live glitter-availability check.
	_getSlotSource(layer, entry) {
		return resolvePaintSlotSource(layer, entry, { imageResolver: this.resolveShapeFillImage });
	}

	// Authored animation sources for every slot that will actually draw:
	// animated image fills, then glitter frames from the front slot back. That
	// is the order exports have always listed them in; the timeline planner
	// reads sources in list order.
	_getSlotAuthoredSources(layer, library) {
		const images = [];
		const glitters = [];
		getLayerPaintSlots(layer).reverse().forEach((entry) => {
			if (!entry.renders) return;
			const source = this._getSlotSource(layer, entry);
			if (source?.mode === 'glitter') {
				const suffix = entry.definition.sourceLabel === undefined ? entry.key : entry.definition.sourceLabel;
				const name = library.find((item) => item.id === source.glitterId)?.name || 'Glitter';
				glitters.push(this._createGlitterDescriptor(library, {
					key: getPaintSlotSourceKey(layer, entry),
					label: suffix ? `${name} (${suffix})` : undefined,
					ownerLayerId: layer.id,
					effectSlot: entry.definition.wholeLayer ? null : entry.key,
					glitterId: source.glitterId
				}));
			} else if (entry.data.mode === 'image') {
				const asset = this.resolveShapeFillImage(entry.data.imageRef);
				if (asset?.isAnimated) images.push(this._createSlotImageDescriptor(layer, entry, asset));
			}
		});
		return [...images, ...glitters];
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
			ensureLoaded: async (callbacks, { timingOnly = false } = {}) => {
				if (!glitter) throw new Error(`Missing glitter ${glitterId}`);
				await this._loadAnimatedSource(glitter.url, {
					timingOnly,
					onStatus: () => callbacks.onStatus(`Loading ${glitter.name}...`),
					failure: `Failed to load ${glitter.name}`
				});
			},
			getAnimation: () => (glitter ? this._getAnimatedSource(glitter.url) : null)
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
			ensureLoaded: async (callbacks, { timingOnly = false } = {}) => {
				await this._loadAnimatedSource(stickerData.url, {
					timingOnly,
					onStatus: () => callbacks.onStatus(`Loading ${stickerData.name}...`),
					failure: `Failed to load sticker ${stickerData.name}`
				});
			},
			getAnimation: () => this._getAnimatedSource(stickerData.url)
		};
	}

	// Animated GIF image fills are read exactly like any other animated asset
	// (glitter/sticker GIFs): decoded on demand into the export's source cache
	// and replayed with native-layer disposal — this is what gives the composite planner exact frame
	// boundaries instead of collapsing an image-only animation to one frame.
	_createSlotImageDescriptor(layer, entry, asset) {
		return {
			key: `${getPaintSlotSourceKey(layer, entry)}:image`,
			label: `${layer.name || 'Shape'} ${entry.key} image`,
			ownerLayerId: layer.id,
			effectSlot: entry.key,
			role: 'shape-fill-image',
			replayPolicy: 'native-layer',
			sourceIdentity: asset,
			ensureLoaded: async (callbacks, { timingOnly = false } = {}) => {
				await this._loadAnimatedSource(asset.dataUrl, {
					timingOnly,
					onStatus: () => callbacks.onStatus(`Loading ${asset.name || 'image'}...`),
					failure: `Failed to load animated fill ${asset.name || ''}`
				});
			},
			getAnimation: () => this._getAnimatedSource(asset.dataUrl)
		};
	}

	_createAuthoredTimingSource(descriptor, fallbackDuration) {
		const animation = descriptor.getAnimation();
		const frameCount = animation?.frameCount ?? animation?.frames?.length;
		if (!frameCount) throw new Error(`Missing animation data for ${descriptor.key}`);
		const timing = this._reconcileAuthoredTiming(descriptor, animation, fallbackDuration);
		return new AuthoredAnimationSource({
			key: descriptor.key,
			label: descriptor.label,
			ownerLayerId: descriptor.ownerLayerId,
			effectSlot: descriptor.effectSlot,
			frameCount,
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
				`[SceneCompositor] "${descriptor.label}" (${descriptor.key}): decoded GIF frame timing ` +
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
		const getAuthoredSources = (library) => this._getSlotAuthoredSources(layer, library);
		switch (layer?.type) {
			case LayerType.BASE_IMAGE: {
				// Image and gradient backgrounds go through the base pixel
				// pipeline (_prepareBasePipeline); solid and glitter paint here.
				const mode = layer.background?.mode || 'image';
				return {
					prepareMasks: async () => {},
					prepareStaticResources: async () => {},
					getAuthoredSources,
					render: ({ ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, width, height }) => {
						if (mode !== 'solid' && mode !== 'glitter') return;
						const [entry] = getLayerPaintSlots(layer);
						const source = this._getSlotSource(layer, entry);
						if (!source) return;
						ctx.save();
						this._paintSourceInto(ctx, width, height, source, {
							frameIndex, sourceKey: getPaintSlotSourceKey(layer, entry), sourceSelectionMap, resolvedFramesBySource
						});
						ctx.restore();
					}
				};
			}
			case LayerType.GLITTER_FILL:
				return {
					prepareMasks: async ({ maskDataMap, maskCanvases, canvasData, callbacks }) => {
						const rawMask = callbacks.createMask(layer);
						maskDataMap.set(layer.id, rawMask);
						maskCanvases.set(layer.id, this._createMaskCanvas(rawMask, canvasData.width, canvasData.height));
					},
					prepareStaticResources: async () => {},
					getAuthoredSources,
					render: ({ ctx, frameIndex, rainbowHue, sourceSelectionMap, resolvedFramesBySource, maskCanvases, helperCtx, width, height }) => {
						const maskCanvas = maskCanvases.get(layer.id);
						if (!maskCanvas) {
							throw new Error(`Missing mask canvas for layer ${layer.id}`);
						}
						const [entry] = getLayerPaintSlots(layer);
						const source = this._getSlotSource(layer, entry);
						if (!source) return;

						helperCtx.save();
						helperCtx.clearRect(0, 0, width, height);
						this._paintMaskedSource(helperCtx, width, height, maskCanvas, source, {
							frameIndex, sourceKey: getPaintSlotSourceKey(layer, entry), sourceSelectionMap, resolvedFramesBySource
						});
						helperCtx.restore();

						if (rainbowHue) {
							const pixels = helperCtx.getImageData(0, 0, width, height);
							applyColorAdjustToImageData(pixels, { hue: rainbowHue, saturation: 100, brightness: 100 });
							helperCtx.putImageData(pixels, 0, 0);
						}

						ctx.drawImage(this.helperCanvas, 0, 0);
					}
				};

			case LayerType.TEXT_GLITTER:
			case LayerType.SHAPE: {
				const scratch = {
					compositeCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
					fillCanvas: createAppCanvas(0, 0, 'export/SceneCompositor')
				};
				scratch.compositeCtx = scratch.compositeCanvas.getContext('2d', { alpha: true });
				return {
					// The layer's manager builds every slot mask (the same masks its
					// preview uses), so preview and export never diverge.
					prepareMasks: async ({ slotMaskCanvases, callbacks }) => {
						slotMaskCanvases.set(layer.id, await callbacks.renderSlotMasks(layer));
					},
					prepareStaticResources: async ({ callbacks }) => {
						if (layer.type === LayerType.TEXT_GLITTER) await callbacks.ensureTextFont(layer.textData.fontId);
					},
					getAuthoredSources,
					render: ({ ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, slotMaskCanvases }) => {
						this._renderSlotStackToCanvas(layer, ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, slotMaskCanvases?.get(layer.id), scratch);
					}
				};
			}

			case LayerType.STICKER: {
				const scratch = {
					sourceCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
					shadowMaskCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
					shadowFillCanvas: createAppCanvas(0, 0, 'export/SceneCompositor')
				};
				scratch.shadowMaskCtx = scratch.shadowMaskCanvas.getContext('2d', { alpha: true });
				return {
					prepareMasks: async () => {},
					prepareStaticResources: async ({ callbacks }) => {
						const stickerData = layer.stickerData;
						if (!stickerData.isAnimated) {
							// Resolved independently of whatever resolution the live
							// canvas last swapped to, so exports stay crisp regardless
							// of the zoom level last used while editing.
							const resolvedUrl = this._resolveStickerExportUrl(layer);
							if (!this._getFrameImageData(stickerData.staticImageData) || stickerData._exportResolvedUrl !== resolvedUrl) {
								stickerData.staticImageData = null;
								callbacks.onStatus(`Loading ${stickerData.name}...`);
								try {
									stickerData.staticImageData = await this._loadStaticImage(resolvedUrl);
									stickerData._exportResolvedUrl = resolvedUrl;
								} catch (error) {
									throw new Error(`Failed to load static sticker ${stickerData.name}`);
								}
							}
						}
					},
					getAuthoredSources: (library) => [
						...(layer.stickerData.isAnimated ? [this._createStickerDescriptor(layer)] : []),
						...getAuthoredSources(library)
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

	_renderFilledMaskInto(fillCanvas, maskCanvas, source, layer, frameIndex, sourceKey, sourceSelectionMap, resolvedFramesBySource) {
		ensureCanvasSize(fillCanvas, maskCanvas.width, maskCanvas.height);
		const fillCtx = fillCanvas.getContext('2d', { alpha: true });
		resetCanvasContext(fillCtx, fillCanvas.width, fillCanvas.height);
		this._paintMaskedSource(fillCtx, fillCanvas.width, fillCanvas.height, maskCanvas, source, {
			layer, frameIndex, sourceKey, sourceSelectionMap, resolvedFramesBySource
		});
		return fillCanvas;
	}

	// Paint a source across the surface, then keep only what the mask covers.
	_paintMaskedSource(ctx, width, height, maskCanvas, source, paintOptions) {
		this._paintSourceInto(ctx, width, height, source, { ...paintOptions, maskCanvas });
		ctx.globalCompositeOperation = 'destination-in';
		ctx.drawImage(maskCanvas, 0, 0);
		ctx.globalCompositeOperation = 'source-over';
	}

	// Fill a width x height surface with one resolved paint source at the
	// source opacity. maskCanvas (optional) supplies the texture origin and the
	// image-fill paint box; layer is only read for canvas-anchored textures.
	_paintSourceInto(ctx, width, height, source, { maskCanvas = null, layer = null, frameIndex, sourceKey, sourceSelectionMap, resolvedFramesBySource }) {
		ctx.globalAlpha = source.opacity ?? 1;

		let fillsSurface = true;
		if (source.mode === 'solid') {
			ctx.fillStyle = source.color;
		} else if (source.mode === 'gradient') {
			ctx.fillStyle = createEffectCanvasGradient(ctx, source.gradient, {
				x: 0, y: 0, width, height
			});
		} else if (source.mode === 'image') {
			const paintBox = maskCanvas?._paintBox || { x: 0, y: 0, width, height };
			const placement = getImageFillPlacement(source, paintBox);
			// An animated GIF fill is registered as an authored source (like a
			// glitter/sticker GIF), so it gets exact-frame-boundary sampling from
			// the composite timeline planner instead of being invisible to it —
			// present only when this slot's asset actually decoded as animated.
			const imageSourceKey = `${sourceKey}:image`;
			const drawable = resolvedFramesBySource?.get(imageSourceKey)
				? this._renderPatternSourceInto(
					this.patternSourceCanvas,
					this._getResolvedFrame(imageSourceKey, frameIndex, sourceSelectionMap, resolvedFramesBySource),
					null
				)
				: source.image;
			ctx.imageSmoothingEnabled = source.imageRendering !== 'pixelated';
			if (source.tile) {
				const pattern = ctx.createPattern(drawable, 'repeat');
				pattern.setTransform(new DOMMatrix()
					.translateSelf(placement.dx, placement.dy)
					.scaleSelf(
						placement.dw / (source.image.naturalWidth || source.image.width),
						placement.dh / (source.image.naturalHeight || source.image.height)
					));
				ctx.fillStyle = pattern;
			} else {
				fillsSurface = false;
				ctx.drawImage(drawable, placement.dx, placement.dy, placement.dw, placement.dh);
			}
		} else {
			const frameImageData = this._getResolvedFrame(sourceKey, frameIndex, sourceSelectionMap, resolvedFramesBySource);
			const patternSource = this._renderPatternSourceInto(this.patternSourceCanvas, frameImageData, source.colorAdjust);

			const pattern = ctx.createPattern(patternSource, 'repeat');
			const sourceScale = source.scale;
			const scale = (sourceScale <= 0 ? 1 : sourceScale) / 100;
			const textureOrigin = getSlotTexturePatternOrigin(maskCanvas, source, layer);
			const matrix = new DOMMatrix()
				.translateSelf(textureOrigin.x, textureOrigin.y)
				.scaleSelf(scale, scale);
			pattern.setTransform(matrix);
			ctx.imageSmoothingEnabled = !this._isGlitterPixelated(source.glitterId);
			ctx.fillStyle = pattern;
		}

		if (fillsSurface) ctx.fillRect(0, 0, width, height);
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
			const copy = this._getPatternAdjustScratch(normalizedFrame.width, normalizedFrame.height);
			copy.data.set(normalizedFrame.data);
			applyColorAdjustToImageData(copy, colorAdjust);
			pctx.putImageData(copy, 0, 0);
		} else {
			pctx.putImageData(normalizedFrame, 0, 0);
		}

		return patternSource;
	}

	// Reused across frames/calls (see EXPORT-PERFORMANCE-PLAN.md Part 2a): the
	// copy is consumed synchronously within this call via putImageData and never
	// stored past it, so pooling is safe. Must track the CURRENT glitter frame's
	// dimensions, not the export canvas's — different glitter/sticker sources
	// (and even different frames of the same animated source) can legitimately
	// hand this a different width/height, so this resizes on every mismatch.
	_getPatternAdjustScratch(width, height) {
		const scratch = this._patternAdjustScratch;
		if (scratch && scratch.width === width && scratch.height === height) return scratch;
		const next = new ImageData(width, height);
		this._patternAdjustScratch = next;
		return next;
	}

	_prepareBasePipeline(visibleLayers, canvasData, exportSettings) {
		const layer = visibleLayers.find((entry) => entry.type === LayerType.BASE_IMAGE);
		const background = layer?.background;
		if (!layer || layer.visible === false || !exportSettings.baseImage || !['image', 'gradient'].includes(background?.mode || 'image')) return null;
		const { width, height, originalData } = canvasData;
		let source = null;
		if (background.mode === 'gradient') {
			const canvas = createAppCanvas(0, 0, 'export/SceneCompositor');
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
			opacity: layer.opacity,
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
		const watermarkCanvas = watermark ? createAppCanvas(0, 0, 'export/SceneCompositor') : null;
		const watermarkSource = watermark?.isAnimated ? this._createWatermarkDescriptor(watermark) : null;
		if (watermarkSource) {
			if (sourceKeys.has(watermarkSource.key)) throw new Error(`Duplicate authored source key: ${watermarkSource.key}`);
			sourceKeys.add(watermarkSource.key);
			authoredSources.push(watermarkSource);
		}
		const masks = {
			raw: new Map(),
			glitter: new Map(),
			slot: new Map()
		};
		for (const { plan } of layerPlans) {
			await plan.prepareMasks({
				maskDataMap: masks.raw,
				maskCanvases: masks.glitter,
				slotMaskCanvases: masks.slot,
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



	// Shared animation front end for GIF and MP4: prepares the export context and
	// plans the render clock. `schedule: true` (MP4) plans the schedule only and
	// returns a renderer for its entries; otherwise the planner pre-renders the
	// kept frames into plan.frames (GIF).
	async planAnimation(params) {
		const { visibleLayers, glitterGifs, canvasData, callbacks, schedule = false, outputFormat = 'gif' } = params;
		const exportSettings = {
			...params.exportSettings,
			frameDelay: AuthoredAnimationSource.normalizeDuration(params.exportSettings.frameDelay, CONFIG.export.defaults.frameDelay)
		};
		this.filterGrainTileCache.clear();

		// Common preparation owns source loading, masks, and immutable settings.
		reportExportProgress(callbacks, 'loading', 0, 'Loading animation sources…', 0, visibleLayers.length);
		let loadingSourceCount = 0;
		const loadingCallbacks = {
			...callbacks,
			onStatus: (detail) => {
				callbacks.onStatus(detail);
				if (!detail.startsWith('Loading ')) return;
				loadingSourceCount++;
				reportExportProgress(callbacks, 'loading', 0, detail, loadingSourceCount, 0, { indeterminate: true });
			},
			onLayerLoaded: (current, total) => {
				const layerShare = exportSettings.watermarkEnabled ? 0.45 : 0.9;
				reportExportProgress(callbacks, 'loading', layerShare * (current / total), `Loaded layer sources ${current} / ${total}`, current, total);
			},
			onSourceProgress: (detail, current, total) => {
				const hasTotal = Number.isFinite(total) && total > 0;
				const progress = hasTotal ? Math.min(1, current / total) : 0;
				const isDecode = detail.startsWith('Decoding');
				const ratio = isDecode ? 0.65 + (progress * 0.3) : 0.45 + (progress * 0.2);
				reportExportProgress(callbacks, 'loading', ratio, detail, current, total, { indeterminate: !hasTotal });
			}
		};
		const context = await this._prepareExportContext({ ...params, visibleLayers, glitterGifs, canvasData, exportSettings, callbacks: loadingCallbacks });
		const { proceduralSources } = context;
		reportExportProgress(callbacks, 'loading', 1, 'Animation sources ready', visibleLayers.length, visibleLayers.length);

		reportExportProgress(callbacks, 'masks', 0, 'Preparing layer masks…', 0, visibleLayers.length);
		reportExportProgress(callbacks, 'masks', 1, 'Layer masks ready', visibleLayers.length, visibleLayers.length);

		// Animation materializes authored frames on demand; still composition resolves one selected frame.
		reportExportProgress(callbacks, 'planning', 0, 'Indexing animation frames…');
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
		reportExportProgress(callbacks, 'planning', 0.5, 'Resolving source timing…');
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
				reportExportProgress(callbacks, 'planning', 1, detail);
			},
			renderFrame: async (timestamp, frameSelection, candidateCount) => {
				renderedCandidateCount++;
				reportExportProgress(callbacks, 'composing', renderedCandidateCount / candidateCount, `Composing frame ${renderedCandidateCount} / ${candidateCount}`, renderedCandidateCount, candidateCount);
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
		const plan = schedule
			? planner.planSchedule(plannerOptions)
			: await planner.plan(plannerOptions);
		plan.width = canvasData.width;
		plan.height = canvasData.height;
		dbg('[SceneCompositor] Render clock:', {
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
		if (!schedule) reportExportProgress(callbacks, 'reducing', 1, `Removed ${plan.reduction.exactDuplicatesMerged + plan.reduction.nearDuplicatesMerged} duplicate or near-duplicate frames`, plan.reduction.outputFrameCount, plan.reduction.renderedFrameCount);
		if (plan.reduction.budgetCompromiseRequired) {
			const detail = 'The hard frame limit requires a quality compromise; no frames were silently truncated.';
			callbacks.onStatus(detail);
			reportExportProgress(callbacks, 'reducing', 1, detail);
		}

		return {
			plan,
			context,
			exportSettings,
			preserveAlpha,
			renderScheduleEntry: (entry, scheduleIndex = 0) => this._renderFrameToCanvas({
				outputFrameIndex: scheduleIndex,
				timestamp: entry.timestamp,
				context,
				transparency: { enabled: preserveAlpha },
				sourceSelectionMap: entry.selection,
				resolvedFramesBySource
			})
		};
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
		const slotMaskCanvases = masks.slot;
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
				let rainbowHue = 0;
				if (unit.animData) {
					const sampled = sourceSelectionMap?.get(`__anim_${layer.id}`)?.sample;
					const origin = [unit.anchorBox.origin?.x ?? 0.5, unit.anchorBox.origin?.y ?? 0.5];
					const sample = sampled
						? { ...sampled, originX: origin[0], originY: origin[1] }
						: GlitterAnimation.sampleAt(unit.animData, timestamp, { layerId: layer.id, origin });
					rainbowHue = sample.hue || 0;
					if (layer.type === LayerType.GLITTER_FILL) {
						renderCtx.translate(unit.anchorBox.x, unit.anchorBox.y);
						GlitterAnimation.applyToContext(renderCtx, sample, unit.anchorBox.width, unit.anchorBox.height);
						renderCtx.translate(-unit.anchorBox.x, -unit.anchorBox.y);
						renderCtx.globalAlpha *= sample.opacity;
					} else {
						this._activeLayerAnimation = { layer, sample };
					}
				}
				try {
					plan.render({
						ctx: renderCtx,
						frameIndex,
						rainbowHue,
						sourceSelectionMap,
						resolvedFramesBySource,
						maskCanvases,
						slotMaskCanvases,
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

	_yieldForProgress() {
		return new Promise((resolve) => requestAnimationFrame(resolve));
	}

	async estimateLoopDuration({
		layers,
		library,
		fallbackDuration,
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
			onStatus: () => {},
			ensureTextFont: async () => {}
		};
		const layerPlans = layers.map((layer) => ({ layer, plan: this._buildLayerExportPlan(layer) }));
		const descriptors = layerPlans.flatMap(({ plan }) => plan.getAuthoredSources(library));
		this._validateAuthoredSourceKeys(descriptors);
		for (const descriptor of descriptors) {
			await descriptor.ensureLoaded(callbacks, { timingOnly: true });
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
			if (this.config.debug) console.error('[SceneCompositor] Invalid watermark frame', frameIndex);
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
		const c = createAppCanvas(0, 0, 'export/SceneCompositor');
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
				const frames = await decodeGif(uint8Array, {
					layout: 'patch',
					onProgress: (current, total) => {
						const detail = current > 0 ? `Decoding watermark frame ${current} / ${total}` : `Preparing ${total} watermark frames…`;
						callbacks.onSourceProgress?.(detail, current, total);
					},
					yieldEvery: CONFIG.export.progress.yieldEveryFrames,
					onYield: () => this._yieldForProgress()
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
						const canvas = createAppCanvas(0, 0, 'export/SceneCompositor');
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
			if (this.config.debug) console.error('[SceneCompositor] Watermark load error:', error);
			throw new Error(`Failed to load watermark: ${error.message}`);
		}
	}


	async _loadStaticImage(url) {
		const img = await AssetImageCache.get(url);
		const canvas = createAppCanvas(0, 0, 'export/SceneCompositor');
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext('2d');
		ctx.drawImage(img, 0, 0);
		return ctx.getImageData(0, 0, canvas.width, canvas.height);
	}

	// Picks the best-fitting variant for the layer's *settled* on-canvas size
	// (native width × transform scale — canvas-space, so it's already
	// independent of editor viewport zoom), the same rule the live canvas
	// applies at resize-gesture-end. See StickerManager.commitResolutionSwap.
	_resolveStickerExportUrl(layer) {
		const stickerData = layer.stickerData;
		const baseUrl = stickerData.baseUrl || stickerData.url;
		if (!stickerData.variantUrls || !Object.keys(stickerData.variantUrls).length) return baseUrl;
		const scalePercent = layer.transform?.scale?.x ?? 100;
		const renderedWidth = (stickerData.width || 0) * (scalePercent / 100);
		return StickerVariants.pickBestUrl(baseUrl, stickerData.width, stickerData.variantUrls, renderedWidth);
	}
}
