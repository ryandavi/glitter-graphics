// ============================================
// SCENE COMPOSITOR
// Renders the document to canvas for every export format: per-layer export
// plans, slot and mask rendering, authored and procedural source timing, the
// base pixel pipeline and the watermark. GifExporter, Mp4Exporter and
// StillImageExporter only encode what it composes (planAnimation for
// animations, composeFrameAt for stills).
// ============================================
const EXPORT_PROGRESS_PHASES = Object.freeze({
	loading: { label: 'Loading artwork', countLabel: 'Loading', noun: 'layer', ranges: { gif: [0, 8], mp4: [0, 8], still: [0, 8] } },
	masks: { label: 'Preparing layers', countLabel: 'Preparing', noun: 'layer', ranges: { gif: [8, 12], mp4: [8, 12], still: [8, 12] } },
	planning: { label: 'Working out timing', ranges: { gif: [12, 15], mp4: [12, 15], still: [12, 15] } },
	composing: { label: 'Drawing frames', countLabel: 'Drawing', noun: 'frame', ranges: { gif: [15, 65], mp4: [15, 65], still: [15, 45] } },
	reducing: { label: 'Removing duplicate frames', ranges: { gif: [65, 70], mp4: [65, 70], still: [45, 65] } },
	palette: { label: 'Choosing colors', ranges: { gif: [70, 78], mp4: [70, 78], still: [65, 78] } },
	encoding: { label: 'Encoding', ranges: { gif: [78, 99], mp4: [15, 99], still: [75, 99] } },
	finalizing: { label: 'Finishing up', ranges: { gif: [99, 100], mp4: [99, 100], still: [99, 100] } }
});

function reportExportProgress(callbacks, phaseKey, ratio = 0, detail = '', phaseCurrent = 0, phaseTotal = 0, options = {}) {
	const phase = EXPORT_PROGRESS_PHASES[phaseKey];
	const [start, end] = phase.ranges[callbacks.progressFormat || 'gif'];
	const boundedRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
	callbacks.phaseTimer?.mark(phase.label);
	callbacks.onProgress(start + ((end - start) * boundedRatio), detail, phaseCurrent, phaseTotal, {
		phase: phase.label, phaseKey, detail, phaseCurrent, phaseTotal,
		indeterminate: options.indeterminate ?? phaseTotal <= 0
	});
}

// Hands the main thread back so progress can paint and Cancel can land. A
// message task, never requestAnimationFrame: a frame callback waits for the
// next screen refresh (twice as long in iOS Low Power Mode) and does not fire
// in a hidden tab, so an export paced by it idles most of its time or stalls.
function yieldForExportProgress() {
	return new Promise((resolve) => {
		const { port1, port2 } = new MessageChannel();
		port1.onmessage = () => {
			port1.close();
			resolve();
		};
		port2.postMessage(null);
	});
}

// Wall-clock time per export phase, shown in the export result so a slow
// export can be read on the device that ran it. mark() returns the phase it
// replaced, so a caller can time a step inside a phase and then resume it.
function createExportPhaseTimer() {
	const totals = new Map();
	let current = null;
	let since = 0;
	const mark = (label) => {
		const previous = current;
		if (label === current) return previous;
		const now = performance.now();
		if (current) totals.set(current, (totals.get(current) || 0) + now - since);
		current = label;
		since = now;
		return previous;
	};
	return {
		mark,
		finish() {
			mark(null);
			return [...totals].map(([label, ms]) => ({ label, ms }));
		}
	};
}

// Debug-only (CONFIG.debug.enabled, or ?debug in the URL): one row per export
// with the settings that drive cost beside every timing, kept for the session
// in window.exportTimingHistory so runs under different settings line up in
// one table. `details` carries the exporter's own columns.
function logExportTimings(format, { plan, context, exportSettings, blob, details = {} }) {
	if (typeof CONFIG === 'undefined' || !CONFIG.debug?.enabled) return;
	const phases = plan.phaseTimings || [];
	const record = {
		format,
		size: `${plan.width}x${plan.height}`,
		layers: context?.visibleLayers?.length ?? 0,
		drawn: plan.reduction?.renderedFrameCount || plan.frameCount,
		frames: plan.frameCount,
		look: exportSettings.ditherPreset,
		colors: exportSettings.colorCount,
		fidelity: exportSettings.exportFidelity,
		quality: exportSettings.quality,
		outputKB: Math.round(blob.size / 1024),
		totalMs: Math.round(phases.reduce((sum, phase) => sum + phase.ms, 0)),
		...Object.fromEntries(phases.map((phase) => [phase.label, Math.round(phase.ms)])),
		...details
	};
	window.exportTimingHistory = [...(window.exportTimingHistory || []), record];
	console.log('[Export timings] this session (copy(JSON.stringify(exportTimingHistory)) to share):');
	console.table(window.exportTimingHistory);
	const layerTimes = [...(context?.layerRenderMs || [])].map(([layer, ms]) => ({
		layer: layer.name || layer.id, type: layer.type, totalMs: Math.round(ms), perFrameMs: Number((ms / Math.max(1, record.drawn)).toFixed(1))
	}));
	if (layerTimes.length) {
		console.log('[Export timings] layer draw time for the last export:');
		console.table(layerTimes);
	}
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
		// One painted particle at a time (drawSparkleFrame draws it at once).
		this.sparklePaintCanvas = createAppCanvas(0, 0, 'export/SceneCompositor');
		// Behind-order sparkles of a fill layer, before they go under its paint.
		this.sparkleBehindCanvas = createAppCanvas(0, 0, 'export/SceneCompositor');
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


	_collectProceduralSources(layers, { includeBaseImage = true, canvasData = null } = {}) {
		return layers.flatMap((layer) => LAYER_UI_CONFIG[layer.type]?.timelineSources?.(layer, {
			compositor: this,
			includeBaseImage,
			canvasData
		}) || []);
	}

	// An animated Dither filter's shimmer, sampled on the shared clock so a
	// still scene under it still exports as an animation.
	_createFilterTimelineSources(layer) {
		if (layer.visible === false || !GlitterFilter.isActive(layer.filterData, layer.opacity)) return [];
		const animation = GlitterFilter.shimmerAnimation(layer.filterData);
		if (!animation) return [];
		const frameDuration = CONFIG.tools.pixelEffects.animation.frameDurationMs;
		return [{
			key: `__filter_shimmer_${layer.id}`,
			label: `${layer.name || 'Filter'} shimmer`,
			ownerLayerId: layer.id,
			naturalPeriod: animation.frames * frameDuration,
			preferredSamplingRate: 1000 / frameDuration,
			sampleAt: (timestamp, period = animation.frames * frameDuration) => {
				const cycleTime = ((timestamp % period) + period) % period;
				return { frameIndex: Math.min(animation.frames - 1, Math.floor(cycleTime / period * animation.frames)) };
			}
		}];
	}

	_createLayerAnimationTimelineSources(layer, { canvasData = null } = {}) {
		const animations = GlitterAnimation.normalizeAnimations(layer.animations);
		if (!animations.some((animation) => GlitterAnimation.isActive(animation))) return [];
		const box = this._getAnimationBox(layer, canvasData?.width || 1, canvasData?.height || 1);
		const samplingContext = this._buildAnimationSamplingContext(layer, box, canvasData);
		return animations.map((animation, index) => ({ animation, index }))
			.filter(({ animation }) => GlitterAnimation.isActive(animation))
			.map(({ animation, index }) => ({
				key: `__anim_${layer.id}_${index}`,
				label: `${layer.name || 'Layer'} ${GlitterAnimation.summaryText(animation)}`,
				ownerLayerId: layer.id,
				effectSlot: `animation-${index}`,
				naturalPeriod: animation.periodMs,
				phase: animation.phase,
				preferredSamplingRate: CONFIG.tools.animation.exportFps,
				sampleAt: (timestamp, period = animation.periodMs) => ({
					sample: GlitterAnimation.sampleAt({ ...animation, periodMs: period }, timestamp, samplingContext)
				})
			}));
	}

	// One procedural source per sparkles slot, period = its cycle. The sampled
	// value is the slot's own clock: the fitted period maps back onto cycleMs,
	// so every particle (a whole number of blinks per cycle) closes the loop.
	_createSparkleTimelineSources(layer) {
		if (layer.visible === false) return [];
		return getLayerSparkleEntries(layer).map((entry) => {
			const cycle = Math.max(1, Number(entry.data.cycleMs) || FIELDS.sparkleCycle.value);
			return {
				key: this._getSparkleTimelineKey(layer, entry),
				label: `${layer.name || 'Layer'} sparkles`,
				ownerLayerId: layer.id,
				effectSlot: entry.key,
				naturalPeriod: cycle,
				preferredSamplingRate: CONFIG.tools.sparkles.exportFps,
				sampleAt: (timestamp, period = cycle) => ({ time: timestamp * cycle / period })
			};
		});
	}

	_getSparkleTimelineKey(layer, entry) {
		return `__sparkles_${getSparkleSampleKey(layer, entry)}`;
	}

	// Draw a layer's sparkles slots of one draw order ('behind' | 'front') into
	// a host-local surface. placement maps host px onto ctx (drawSparkleFrame).
	_drawLayerSparkles(ctx, layer, order, frame, placement) {
		getLayerSparkleEntries(layer).forEach((entry) => {
			if ((entry.data.drawOrder === 'behind' ? 'behind' : 'front') !== order) return;
			const layout = peekSparkleLayout(this.editor, layer, entry);
			if (!layout?.length) return;
			const source = this._getSlotSource(layer, entry);
			if (!source) return;
			const sourceKey = getPaintSlotSourceKey(layer, entry);
			const time = frame.sourceSelectionMap?.get(this._getSparkleTimelineKey(layer, entry))?.time ?? frame.timestamp ?? 0;
			drawSparkleFrame(ctx, entry.data, layout, time, getSparkleSampleKey(layer, entry), (maskCanvas, origin) => {
				maskCanvas._textureOrigin = origin;
				return this._renderFilledMaskInto(
					this.sparklePaintCanvas, maskCanvas, source, layer,
					frame.frameIndex, sourceKey, frame.sourceSelectionMap, frame.resolvedFramesBySource
				);
			}, placement);
		});
	}

	// Host-local px a layer's sparkles may paint past its box.
	_getSparklePadding(layer) {
		return getLayerSparkleEntries(layer).reduce((pad, entry) => Math.max(pad, getSparkleFramePadding(entry.data)), 0);
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
	// so the export matches what the canvas showed. `pad` (layer px, or padX /
	// padY per axis) says the source extends that far past the width x height
	// box on each side (sparkles); the box, not the padding, anchors transform
	// and animation.
	_drawTransformedCanvas(ctx, sourceCanvas, layer, width, height, { smooth = false, pad = 0, padX = pad, padY = pad, rasterScale = null } = {}) {
		const transform = getLayerTransform(layer);
		const metrics = computeLayerTransform(transform, { width: width / (rasterScale?.x || 1), height: height / (rasterScale?.y || 1) });
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

		ctx.scale(metrics.signedScaleX / (rasterScale?.x || 1), metrics.signedScaleY / (rasterScale?.y || 1));
		if (animation) {
			ctx.translate(-width / 2, -height / 2);
			const localAnimation = animation.matrix
				? { ...animation, tx: 0, ty: 0, matrix: { ...animation.matrix, e: 0, f: 0 } }
				: { ...animation, tx: 0, ty: 0 };
			GlitterAnimation.applyToContext(ctx, localAnimation, width, height);
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
			-width / 2 - padX,
			-height / 2 - padY,
			width + padX * 2,
			height + padY * 2
		);

		ctx.restore();
	}

	_getAnimationBox(layer, canvasWidth, canvasHeight) {
		const declared = LAYER_UI_CONFIG[layer.type]?.animationBox?.(this.editor, layer, {
			width: canvasWidth,
			height: canvasHeight
		}) || {};
		let { width, height } = declared;
		width = Number(width) || 1;
		height = Number(height) || 1;
		if (Number.isFinite(declared.x) && Number.isFinite(declared.y)) return { ...declared, width, height };
		const metrics = computeLayerTransform(getLayerTransform(layer), { width, height });
		const origin = getLayerAnimationOrigin(this.editor, layer, { width, height });
		return { x: metrics.centerX - width / 2, y: metrics.centerY - height / 2, width, height, origin };
	}

	_buildAnimationSamplingContext(layer, box, canvasData = null) {
		return {
			canvasW: Number(canvasData?.width) || 1,
			canvasH: Number(canvasData?.height) || 1,
			boxW: Number(box?.width) || 1,
			boxH: Number(box?.height) || 1,
			layerId: layer.id,
			seed: 0
		};
	}

	_renderLayerToCanvas(layer, ctx, frameIndex, sourceSelectionMap = null, resolvedFramesBySource = null, scratch = null, timestamp = 0) {
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
		if (layer.stickerData.slice && layer.stickerData.sliceEnabled !== false) {
			const scale = getLayerTransform(layer).scale;
			const sliced = scratch.unionFrameCanvas;
			ensureCanvasSize(sliced, Math.max(1, Math.round(width * Math.abs(scale.x) / 100)), Math.max(1, Math.round(height * Math.abs(scale.y) / 100)));
			const slicedCtx = sliced.getContext('2d', { alpha: true });
			resetCanvasContext(slicedCtx, sliced.width, sliced.height);
			slicedCtx.imageSmoothingEnabled = layer.stickerData.isPixelated === false;
			this.editor.stickerManager.drawStickerImage(slicedCtx, tempCanvas, layer, sliced.width, sliced.height);
			ensureCanvasSize(tempCanvas, sliced.width, sliced.height);
			const sourceCtx = tempCanvas.getContext('2d');
			resetCanvasContext(sourceCtx, tempCanvas.width, tempCanvas.height);
			sourceCtx.drawImage(sliced, 0, 0);
		}
		this._renderStickerEffects(layer, ctx, tempCanvas, frameIndex, sourceSelectionMap, resolvedFramesBySource, scratch, 'behind');

		// Sparkles composite around the image at the image's own pixel density
		// (a resolution variant may be denser than the layer box), on a canvas
		// padded so particles past the edge are kept, as the preview shows them.
		const sparklePad = this._getSparklePadding(layer);
		let drawCanvas = tempCanvas;
		let padX = 0;
		let padY = 0;
		let drawFrontSparkles = null;
		if (sparklePad > 0) {
			const densityX = tempCanvas.width / Math.max(1, width);
			const densityY = tempCanvas.height / Math.max(1, height);
			const padPxX = Math.ceil(sparklePad * densityX);
			const padPxY = Math.ceil(sparklePad * densityY);
			drawCanvas = scratch.sparkleCanvas;
			ensureCanvasSize(drawCanvas, tempCanvas.width + padPxX * 2, tempCanvas.height + padPxY * 2);
			const sparkleCtx = drawCanvas.getContext('2d', { alpha: true });
			resetCanvasContext(sparkleCtx, drawCanvas.width, drawCanvas.height);
			const frame = { frameIndex, timestamp, sourceSelectionMap, resolvedFramesBySource };
			const placement = { offsetX: padPxX, offsetY: padPxY, scaleX: densityX, scaleY: densityY };
			this._drawLayerSparkles(sparkleCtx, layer, 'behind', frame, placement);
			sparkleCtx.drawImage(tempCanvas, padPxX, padPxY);
			padX = padPxX / densityX;
			padY = padPxY / densityY;
			// Front sparkles go over the bevel, as the preview stacks them, so
			// they are a second pass after the front effects.
			drawFrontSparkles = () => {
				resetCanvasContext(sparkleCtx, drawCanvas.width, drawCanvas.height);
				this._drawLayerSparkles(sparkleCtx, layer, 'front', frame, placement);
				this._drawTransformedCanvas(ctx, drawCanvas, layer, width, height, {
					smooth: layer.stickerData.isPixelated === false,
					padX,
					padY
				});
			};
		}

		this._drawTransformedCanvas(ctx, drawCanvas, layer, width, height, {
			smooth: layer.stickerData.isPixelated === false,
			padX,
			padY
		});
		this._renderStickerEffects(layer, ctx, tempCanvas, frameIndex, sourceSelectionMap, resolvedFramesBySource, scratch, 'front');
		drawFrontSparkles?.();
	}

	// Sticker effects share the slot paint path. Behind effects and front bevel
	// masks are transformed with the authored image instead of entering the
	// text/shape slot-stack compositor.
	_renderStickerEffects(layer, ctx, stickerCanvas, frameIndex, sourceSelectionMap, resolvedFramesBySource, scratch, phase = 'behind') {
		if (!scratch?.shadowMaskCanvas || !scratch?.shadowFillCanvas) return;
		let maskStickerCanvas = stickerCanvas;
		if (layer.stickerData.border?.unionFrames && layer.stickerData.isAnimated) {
			// Every native frame, as the preview's union reads them. The resolved
			// map only holds the frames this export selects (a lazy getter for
			// animated output, one frame for a still), not the whole GIF.
			const frames = this.decodedSources.get(layer.stickerData.url)?.frames || [];
			const union = scratch.unionSourceCanvas;
			const unionKey = `${layer.stickerData.url}:${stickerCanvas.width}x${stickerCanvas.height}:${JSON.stringify(layer.stickerData.slice)}:${layer.stickerData.sliceEnabled}`;
			if (scratch.unionKey !== unionKey) {
				ensureCanvasSize(union, stickerCanvas.width, stickerCanvas.height);
				const unionCtx = union.getContext('2d', { alpha: true });
				resetCanvasContext(unionCtx, union.width, union.height);
				frames.forEach((frame) => {
					const imageData = this._getFrameImageData(frame, stickerCanvas.width, stickerCanvas.height);
					if (!imageData) return;
					ensureCanvasSize(scratch.unionFrameCanvas, imageData.width, imageData.height);
					const frameCtx = scratch.unionFrameCanvas.getContext('2d', { alpha: true });
					resetCanvasContext(frameCtx, imageData.width, imageData.height);
					frameCtx.putImageData(imageData, 0, 0);
					this.editor.stickerManager.drawStickerImage(unionCtx, scratch.unionFrameCanvas, layer, union.width, union.height);
				});
				scratch.unionKey = frames.length ? unionKey : null;
			}
			if (frames.length) maskStickerCanvas = union;
		}
		// Effect masks are built at the sticker's displayed size, as the preview
		// builds them (StickerManager.reconcileStickerEffectSpans), so outline,
		// shadow and bevel sizes are canvas pixels at any sticker scale.
		const scale = getLayerTransform(layer).scale;
		const maskWidth = Math.max(1, Math.round(layer.stickerData.width * Math.max(0.01, Math.abs(scale.x) / 100)));
		const maskHeight = Math.max(1, Math.round(layer.stickerData.height * Math.max(0.01, Math.abs(scale.y) / 100)));
		const densityX = maskWidth / Math.max(1, layer.stickerData.width);
		const densityY = maskHeight / Math.max(1, layer.stickerData.height);
		const previewPad = this.editor.stickerManager.getEffectPadding(layer);
		buildSlotStack(layer, (entry) => this._getSlotSource(layer, entry)).forEach((item) => {
			if ((phase === 'front') !== (item.role === 'bevel')) return;
			const effectRadius = item.role === 'shadow' ? Number(item.data.spread) || 0 : item.role === 'border' ? Number(item.data.widthPx) || 0 : 0;
			const pad = Math.ceil(item.role === 'shadow' ? getShadowCanvasPadding(item.data) : effectRadius + 2);
			const effectMask = scratch.shadowMaskCanvas;
			ensureCanvasSize(effectMask, maskWidth + pad * 2, maskHeight + pad * 2);
			const effectMaskCtx = scratch.shadowMaskCtx;
			resetCanvasContext(effectMaskCtx, effectMask.width, effectMask.height);
			effectMaskCtx.imageSmoothingEnabled = layer.stickerData.isPixelated === false;
			effectMaskCtx.drawImage(maskStickerCanvas, pad, pad, maskWidth, maskHeight);
			if (shouldUseCrispMaskEdges()) binarizeCanvasAlpha(effectMaskCtx);
			let mask = effectMask;
			if (item.role === 'shadow' && getShadowReach(item.data) > 0) mask = createShadowMaskCanvas(effectMask, effectRadius, Number(item.data.blur) || 0);
			if (item.role === 'border') mask = createOutlineMaskCanvas(effectMask, effectRadius, getBorderEdgeStyle(item.data), item.data.fillInterior, item.data.fillEnclosed);
			if (item.role === 'bevel') {
				const pair = createBevelMaskCanvases(effectMask, layer.stickerData.bevel.highlight);
				mask = item.key === 'bevelShade' ? pair.shade : pair.highlight;
			}
			// Where the preview's effect spans register their texture, in this
			// mask's pixels.
			mask._textureOrigin = { x: pad - previewPad * 2, y: pad - previewPad * 2 };
			// A shadow's offset is baked into its mask (the padding covers it); the
			// texture origin moves with it.
			if (item.offsetX || item.offsetY) mask = createOffsetMaskCanvas(mask, Math.round(item.offsetX), Math.round(item.offsetY));
			this._renderFilledMaskInto(scratch.shadowFillCanvas, mask, item.source, layer, frameIndex, item.sourceKey, sourceSelectionMap, resolvedFramesBySource);
			this._drawTransformedCanvas(ctx, scratch.shadowFillCanvas, layer, layer.stickerData.width, layer.stickerData.height, {
				smooth: layer.stickerData.isPixelated === false,
				padX: pad / densityX,
				padY: pad / densityY
			});
		});
	}

	// Composite a text or shape layer's slot stack (buildSlotStack order, the
	// same list the preview span stack reads) into one surface, then place it.
	// Preview fades/transforms the wrapper around the complete span stack, so
	// export must composite the object's paints before applying its
	// whole-layer opacity or animation, or overlapping effects show through.
	_renderSlotStackToCanvas(layer, ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, slotMasks, scratch, timestamp = 0) {
		if (!slotMasks?.fill) {
			throw new Error(`Missing slot masks for layer ${layer.id}`);
		}
		const width = slotMasks.renderWidth;
		const height = slotMasks.renderHeight;
		const compositeCanvas = scratch?.compositeCanvas;
		const fillCanvas = scratch?.fillCanvas;
		if (!compositeCanvas || !fillCanvas) throw new Error(`Missing slot scratch for layer ${layer.id}`);
		// Sparkles may paint past the mask canvas; the preview's span stack
		// does not clip them, so the composite grows by their padding.
		const pad = Math.ceil(this._getSparklePadding(layer));
		ensureCanvasSize(compositeCanvas, width + pad * 2, height + pad * 2);
		ensureCanvasSize(fillCanvas, width, height);
		const compositeCtx = scratch.compositeCtx;
		resetCanvasContext(compositeCtx, compositeCanvas.width, compositeCanvas.height);
		const frame = { frameIndex, timestamp, sourceSelectionMap, resolvedFramesBySource };
		const placement = { offsetX: pad, offsetY: pad };
		if (pad) this._drawLayerSparkles(compositeCtx, layer, 'behind', frame, placement);
		const buildStack = scratch.buildStack || ((resolveSource) => buildSlotStack(layer, resolveSource));
		buildStack((entry) => this._getSlotSource(layer, entry)).forEach((item) => {
			const maskCanvas = slotMasks[item.key];
			if (!maskCanvas) return;
			this._renderFilledMaskInto(fillCanvas, maskCanvas, item.source, layer, frameIndex, item.sourceKey, sourceSelectionMap, resolvedFramesBySource);
			compositeCtx.drawImage(fillCanvas, pad, pad, width, height);
		});
		if (pad) this._drawLayerSparkles(compositeCtx, layer, 'front', frame, placement);
		this._drawTransformedCanvas(ctx, compositeCanvas, layer, width, height, { pad, rasterScale: slotMasks.rasterScale });
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
		const manager = getLayerManagerForType(this.editor, layer?.type);
		if (!manager?.buildExportPlan) throw new Error(`Layer type ${layer?.type || 'unknown'} has no export-plan builder`);
		return manager.buildExportPlan(layer, { compositor: this });
	}

	_buildBaseImageExportPlan(layer) {
		const getAuthoredSources = (library) => this._getSlotAuthoredSources(layer, library);
		const mode = layer.background?.mode || 'image';
		return {
			prepareMasks: async () => {},
			prepareStaticResources: async () => {},
			getAuthoredSources,
			render: ({ ctx, frameIndex, timestamp, sourceSelectionMap, resolvedFramesBySource, width, height }) => {
				const [entry] = getLayerPaintSlots(layer);
				const source = mode === 'solid' || mode === 'glitter' ? this._getSlotSource(layer, entry) : null;
				if (source) {
					ctx.save();
					this._paintSourceInto(ctx, width, height, source, {
						frameIndex, sourceKey: getPaintSlotSourceKey(layer, entry), sourceSelectionMap, resolvedFramesBySource
					});
					ctx.restore();
				}
				// Canvas sparkles sit just above the base image (drawn before the
				// layer loop), in document px; the preview host fades with the
				// layer opacity.
				const host = getLayerSparkleEntries(layer).length ? getSparkleHost(this.editor, layer) : null;
				if (!host) return;
				ctx.save();
				ctx.globalAlpha *= layer.opacity / 100;
				const frame = { frameIndex, timestamp, sourceSelectionMap, resolvedFramesBySource };
				const placement = { scaleX: width / Math.max(1, host.width), scaleY: height / Math.max(1, host.height) };
				this._drawLayerSparkles(ctx, layer, 'behind', frame, placement);
				this._drawLayerSparkles(ctx, layer, 'front', frame, placement);
				ctx.restore();
			}
		};
	}

	_buildGlitterFillExportPlan(layer) {
		const getAuthoredSources = (library) => this._getSlotAuthoredSources(layer, library);
		const scratch = {
			compositeCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
			fillCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
			// The fill's only opacity is the whole-layer one (GlitterManager.getSlotStack).
			buildStack: (resolveSource) => buildSlotStack(layer, (entry) => {
				const source = resolveSource(entry);
				return entry.key === 'fill' && source ? { ...source, opacity: 1 } : source;
			})
		};
		scratch.compositeCtx = scratch.compositeCanvas.getContext('2d', { alpha: true });
		return {
			prepareMasks: async ({ maskDataMap, maskCanvases, slotMaskCanvases, canvasData, callbacks }) => {
				const rawMask = callbacks.createMask(layer);
				maskDataMap.set(layer.id, rawMask);
				const fillMask = this._createMaskCanvas(rawMask, canvasData.width, canvasData.height);
				maskCanvases.set(layer.id, fillMask);
				slotMaskCanvases.set(layer.id, this.editor.glitterManager.renderSlotMasks(layer, fillMask));
			},
			prepareStaticResources: async () => {},
			getAuthoredSources,
			render: ({ ctx, frameIndex, timestamp, sourceSelectionMap, resolvedFramesBySource, slotMaskCanvases }) => {
				const slotMasks = slotMaskCanvases.get(layer.id);
				this._renderSlotStackToCanvas(
					layer,
					ctx,
					frameIndex,
					sourceSelectionMap,
					resolvedFramesBySource,
					slotMasks,
					scratch,
					timestamp
				);
			}
		};
	}

	// buildStack(resolveSource) replaces buildSlotStack for a type whose paint
	// list is not one item per slot (a frame's shade bands); its items name
	// the slotMasks key they paint through.
	_buildSlotStackExportPlan(layer, { ensureTextFont = false, buildStack = null } = {}) {
		if (ensureTextFont && !buildStack) buildStack = resolveSource => this.editor.textGlitterManager.getSlotStack(layer, resolveSource);
		const getAuthoredSources = (library) => this._getSlotAuthoredSources(layer, library);
		const scratch = {
			compositeCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
			fillCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
			buildStack
		};
		scratch.compositeCtx = scratch.compositeCanvas.getContext('2d', { alpha: true });
		return {
			// The layer's manager builds every slot mask (the same masks its
			// preview uses), so preview and export never diverge.
			prepareMasks: async ({ slotMaskCanvases, callbacks }) => {
				slotMaskCanvases.set(layer.id, await callbacks.renderSlotMasks(layer));
			},
			prepareStaticResources: async ({ callbacks }) => {
				if (ensureTextFont) await callbacks.ensureTextFont(layer.textData.fontId);
			},
			getAuthoredSources,
			render: ({ ctx, frameIndex, timestamp, sourceSelectionMap, resolvedFramesBySource, slotMaskCanvases }) => {
				this._renderSlotStackToCanvas(layer, ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, slotMaskCanvases?.get(layer.id), scratch, timestamp);
			}
		};
	}

	_buildStickerExportPlan(layer) {
		const getAuthoredSources = (library) => this._getSlotAuthoredSources(layer, library);
		const scratch = {
			sourceCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
			shadowMaskCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
			shadowFillCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
			unionSourceCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
			unionFrameCanvas: createAppCanvas(0, 0, 'export/SceneCompositor'),
			sparkleCanvas: createAppCanvas(0, 0, 'export/SceneCompositor')
		};
		scratch.shadowMaskCtx = scratch.shadowMaskCanvas.getContext('2d', { alpha: true });
		return {
			prepareMasks: async () => {},
			prepareStaticResources: async ({ callbacks }) => {
				const stickerData = layer.stickerData;
				if (!stickerData.isAnimated) {
					// Export resolution is independent of the live canvas's last zoom.
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
			render: ({ ctx, frameIndex, timestamp, sourceSelectionMap, resolvedFramesBySource }) => {
				this._renderLayerToCanvas(layer, ctx, frameIndex, sourceSelectionMap, resolvedFramesBySource, scratch, timestamp);
			}
		};
	}

	_buildFilterExportPlan(layer) {
		return {
			prepareMasks: async () => {},
			prepareStaticResources: async () => {},
			getAuthoredSources: () => [],
			render: async ({ ctx, width, height, keepAlpha, alphaThreshold, frameIndex, matteColor, sourceSelectionMap }) => {
				if (!GlitterFilter.isActive(layer.filterData, layer.opacity)) return;
				const caption = GlitterFilter.resolve(layer.filterData).caption;
				const captionSpec = caption ? GlitterFilter.nameCaptionSpec(caption, { width, height }) : null;
				await GlitterFilter.renderToCanvas(ctx, width, height, layer.filterData, layer.opacity / 100, {
					keepAlpha,
					alphaThreshold,
					frameIndex: sourceSelectionMap?.get(`__filter_shimmer_${layer.id}`)?.frameIndex ?? frameIndex,
					matteColor,
					seed: layer.id,
					tileCache: this.filterGrainTileCache,
					blendMode: GlitterBlendModes.forLayer(layer),
					renderSource: captionSpec ? (sourceContext) => GlitterFilter.drawCaption(sourceContext, captionSpec) : null
				});
			}
		};
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
		return {
			source,
			colorAdjust: normalizeColorAdjust(background.colorAdjust),
			opacity: layer.opacity,
			processed: null
		};
	}

	_getBasePipelineImageData(context) {
		const pipeline = context.basePipeline;
		if (!pipeline) throw new Error('Missing prepared base pipeline');
		if (pipeline.processed) return pipeline.processed;
		if (isIdentityColorAdjust(pipeline.colorAdjust) && pipeline.opacity === 100) {
			pipeline.processed = pipeline.source;
			return pipeline.source;
		}
		const result = new ImageData(new Uint8ClampedArray(pipeline.source.data), pipeline.source.width, pipeline.source.height);
		applyColorAdjustToImageData(result, pipeline.colorAdjust);
		if (pipeline.opacity < 100) {
			for (let offset = 3; offset < result.data.length; offset += 4) result.data[offset] = Math.round(result.data[offset] * pipeline.opacity / 100);
		}
		pipeline.processed = result;
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
		// Fonts are ready now, so text hosts measure their final masks.
		await prepareSparkleLayouts(this.editor, visibleLayers);
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
			proceduralSources: this._collectProceduralSources(visibleLayers, {
				includeBaseImage: settingsSnapshot.baseImage,
				canvasData
			}),
			basePipeline,
			watermark,
			watermarkCanvas,
			watermarkSource
		};
	}

	async prepareContext(params) {
		return this._prepareExportContext(params);
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
		reportExportProgress(callbacks, 'loading', 0, '', 0, visibleLayers.length);
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
				reportExportProgress(callbacks, 'loading', layerShare * (current / total), '', current, total);
			},
			onSourceProgress: (detail, current, total) => {
				const hasTotal = Number.isFinite(total) && total > 0;
				const progress = hasTotal ? Math.min(1, current / total) : 0;
				const isDecode = detail.startsWith('Decoding');
				const ratio = isDecode ? 0.65 + (progress * 0.3) : 0.45 + (progress * 0.2);
				reportExportProgress(callbacks, 'loading', ratio, '', 0, 0, { indeterminate: !hasTotal });
			}
		};
		const context = await this._prepareExportContext({ ...params, visibleLayers, glitterGifs, canvasData, exportSettings, callbacks: loadingCallbacks });
		const { proceduralSources } = context;
		reportExportProgress(callbacks, 'loading', 1, '', visibleLayers.length, visibleLayers.length);

		reportExportProgress(callbacks, 'masks', 0, '', 0, visibleLayers.length);
		reportExportProgress(callbacks, 'masks', 1, '', visibleLayers.length, visibleLayers.length);

		// Animation materializes authored frames on demand; still composition resolves one selected frame.
		reportExportProgress(callbacks, 'planning', 0, '');
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
		reportExportProgress(callbacks, 'planning', 0.5, '');
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
				reportExportProgress(callbacks, 'planning', 1);
			},
			renderFrame: async (timestamp, frameSelection, candidateCount) => {
				renderedCandidateCount++;
				reportExportProgress(callbacks, 'composing', renderedCandidateCount / candidateCount, '', renderedCandidateCount, candidateCount);
				const frame = await this._renderFrame({
					outputFrameIndex: 0,
					timestamp,
					context,
					transparency: { enabled: preserveAlpha },
					sourceSelectionMap: frameSelection,
					resolvedFramesBySource
				}, callbacks.phaseTimer);
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
		if (!schedule) reportExportProgress(callbacks, 'reducing', 1, '', plan.reduction.outputFrameCount, plan.reduction.renderedFrameCount);
		if (plan.reduction.budgetCompromiseRequired) {
			const detail = 'The hard frame limit requires a quality compromise; no frames were silently truncated.';
			callbacks.onStatus(detail);
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
		const { callbacks, timestamp = 0 } = params;
		this.filterGrainTileCache.clear();
		const context = params.preparedContext || await this.prepareContext(params);
		const { visibleLayers, canvasData, exportSettings } = context;
		reportExportProgress(callbacks, 'loading', 1, '', visibleLayers.length, visibleLayers.length);
		const session = this.authoredFrameResolver.createSession({ isCancelled: callbacks.isCancelled });
		const { resolvedFramesBySource, sourceSelectionMap } = this._resolveSelectedAuthored(context, session, timestamp, exportSettings.frameDelay);
		const preserveAlpha = this._resolvePreserveAlpha(params.target?.supportsTransparency ?? true, exportSettings);
		ensureCanvasSize(this.helperCanvas, canvasData.width, canvasData.height);
		ensureCanvasSize(this.layerBlendCanvas, canvasData.width, canvasData.height);
		ensureCanvasSize(this.canvas, canvasData.width, canvasData.height);
		reportExportProgress(callbacks, 'composing', 1, '', 1, 1);
		const imageData = await this._renderFrame({
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
			transparency: { enabled: preserveAlpha, ditherSoftEdges: preserveAlpha && visibleLayers.some(layerHasSoftShadow) }
		};
	}

	// --- HELPER METHODS ---

	async _renderFrameToCanvas({ outputFrameIndex: frameIndex, timestamp = 0, context, transparency, sourceSelectionMap = null, resolvedFramesBySource = null }) {
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
			const baseImage = this._getBasePipelineImageData(context);
			resetCanvasContext(hCtx, width, height);
			hCtx.putImageData(baseImage, 0, 0);
			ctx.drawImage(this.helperCanvas, 0, 0);
		}

		// 5. Composite Glitter and Sticker Layers (in correct z-order)
		for (const { layer, plan } of layerPlans) {
			if (layer.visible === false) continue;
			if (layer.type === LayerType.BASE_IMAGE && !exportSettings.baseImage) continue;
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
			const animationUnits = GlitterAnimation.isActive(layer.animations)
				? [{ animData: layer.animations, anchorBox: this._getAnimationBox(layer, width, height) }]
				: [{ animData: null, anchorBox: null }];
			for (const unit of animationUnits) {
				renderCtx.save();
				if (unit.animData) {
					const origin = [unit.anchorBox.origin?.x ?? 0.5, unit.anchorBox.origin?.y ?? 0.5];
					const samplingContext = {
						...this._buildAnimationSamplingContext(layer, unit.anchorBox, { width, height }),
						origin
					};
					const sampled = unit.animData.map((animation, index) => ({ animation, index }))
						.filter(({ animation }) => GlitterAnimation.isActive(animation))
						.map(({ animation, index }) =>
							sourceSelectionMap?.get(`__anim_${layer.id}_${index}`)?.sample
							|| GlitterAnimation.sampleAt(animation, timestamp, samplingContext)
						);
					const sample = GlitterAnimation.composeSamples(sampled, { origin });
					this._activeLayerAnimation = { layer, sample };
				}
				const layerStart = performance.now();
				try {
					const renderResult = plan.render({
						ctx: renderCtx,
						frameIndex,
						timestamp,
						sourceSelectionMap,
						resolvedFramesBySource,
						maskCanvases,
						slotMaskCanvases,
						helperCtx: hCtx,
						width,
						height,
						keepAlpha: preserveAlpha,
						alphaThreshold,
						matteColor: exportSettings.matteColor
					});
					if (renderResult?.then) await renderResult;
				} finally {
					this._activeLayerAnimation = null;
					renderCtx.restore();
					// Read by logExportTimings().
					context.layerRenderMs ||= new Map();
					context.layerRenderMs.set(layer, (context.layerRenderMs.get(layer) || 0) + performance.now() - layerStart);
				}
			}
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
		}
		// 6. Render Watermark
		if (exportSettings.watermarkEnabled && watermark) {
			const watermarkFrame = sourceSelectionMap?.get('__watermark')?.frameIndex ?? frameIndex;
			this._renderWatermarkToCanvas(watermark, watermarkCanvas, ctx, width, height, watermarkFrame, resolvedFramesBySource?.get('__watermark'));
		}

		return this.canvas;
	}

	// phaseTimer (optional) times the pixel readback apart from the drawing.
	async _renderFrame(options, phaseTimer = null) {
		await this._renderFrameToCanvas(options);
		const { width, height } = options.context.canvasData;
		const phase = phaseTimer?.mark('Reading pixels');
		const imageData = this.ctx.getImageData(0, 0, width, height);
		if (phase) phaseTimer.mark(phase);
		return imageData;
	}

	_yieldForProgress() {
		return yieldForExportProgress();
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
