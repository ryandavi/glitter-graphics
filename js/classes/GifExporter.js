// ============================================
// GIF EXPORT MANAGER CLASS
// ============================================
class GifExporter {
	constructor() {
		this.config = {
			workers: 4,
			quality: 1,
			workerScript: 'js/gif.worker.js',
			fileName: 'ryandavi-com_glitter.gif',
			timing: { forceDelay: 100, maxFrames: 60 },
			debug: typeof CONFIG !== 'undefined' ? CONFIG.debug : false,
			watermarkAlphaThreshold: 128,
			useAdaptiveQuality: false // Add this flag
		};

		// Reusable canvas elements
		this.canvas = document.createElement('canvas');
		this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

		this.helperCanvas = document.createElement('canvas');
		this.helperCtx = this.helperCanvas.getContext('2d', { willReadFrequently: true });
	}

	gcd(a, b) { return !b ? a : this.gcd(b, a % b); }
	lcm(a, b) { return (a * b) / this.gcd(a, b); }

	_hasTransparency(canvasData) {
		const { originalAlpha, alphaThreshold } = canvasData;
		for (let i = 0; i < originalAlpha.length; i++) {
			if (originalAlpha[i] < alphaThreshold) {
				return true; // Found at least one transparent pixel
			}
		}
		return false; // No transparency in image
	}

	// Add this inside the GifExporter class
	_formatBytes(bytes, decimals = 2) {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const dm = decimals < 0 ? 0 : decimals;
		const sizes = ['Bytes', 'KB', 'MB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
	}


	_getSizeWarningsHTML(bytes) {
		const MB = 1024 * 1024;

		const warningsConfig = [
			{ message: "Too big for Discord", limit: 10 * MB },
			{ message: "Too big for Discord Nitro", limit: 500 * MB },
			{ message: "Too big for Twitter", limit: 15 * MB },
			{ message: "Kind of huge for a typical GIF...", limit: 50 * MB } // maximum size warning
		];

		const warnings = warningsConfig
			.filter(w => bytes > w.limit)
			.map(w => {
				const title = `${this._formatBytes(w.limit)} limit`;
				const text = `${w.message}`;
				return `<div class="size-warning" data-tooltip="${title}">${text}</div>`;
			});

		return warnings.join('');
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

		if (!reducedFrameCount || reducedFrameCount <= 0) {
			return frameIndex % originalFrameCount;
		}

		const normalizedIndex = (frameIndex % reducedFrameCount) / reducedFrameCount;
		return Math.min(originalFrameCount - 1, Math.floor(normalizedIndex * originalFrameCount));
	}








	_drawTransformedCanvas(ctx, sourceCanvas, transform, width, height) {
		const centerX = transform.position.x;
		const centerY = transform.position.y;
		const scaleX = transform.scale.x / 100;
		const scaleY = transform.scale.y / 100;
		const rotation = transform.rotation * Math.PI / 180;

		ctx.save();
		ctx.imageSmoothingEnabled = false;
		ctx.globalAlpha = transform.opacity / 100;
		ctx.translate(centerX, centerY);

		if (rotation !== 0) {
			ctx.rotate(rotation);
		}

		ctx.scale(
			scaleX * (transform.flipX ? -1 : 1),
			scaleY * (transform.flipY ? -1 : 1)
		);

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
		const { transform, isAnimated, width, height } = layer.stickerData;

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

		// Create temporary canvas for the sticker frame
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = width;
		tempCanvas.height = height;
		const tempCtx = tempCanvas.getContext('2d', {
			willReadFrequently: true,
			alpha: true
		});
		tempCtx.putImageData(imageData, 0, 0);

		this._drawTransformedCanvas(ctx, tempCanvas, transform, width, height);
	}

	_renderTextLayerToCanvas(layer, ctx, frameIndex, frameMap = null, flattenedFrameMap = null, textMaskCanvases = null) {
		const textMaskCanvas = textMaskCanvases?.get(layer.id);
		if (!textMaskCanvas) {
			throw new Error(`Missing text mask for layer ${layer.id}`);
		}

		const frames = flattenedFrameMap?.get(layer.id);
		if (!frames?.length) {
			throw new Error(`Missing flattened glitter frames for text layer ${layer.id}`);
		}

		const reducedFrameCount = frameMap?.get(layer.id);
		const frameIndexForLayer = this._getReducedFrameIndex(frameIndex, frames.length, reducedFrameCount);
		const frameImageData = frames[frameIndexForLayer];
		if (!frameImageData) {
			throw new Error(`Invalid glitter frame for text layer ${layer.id} frame ${frameIndexForLayer}`);
		}

		const fillCanvas = document.createElement('canvas');
		fillCanvas.width = textMaskCanvas.width;
		fillCanvas.height = textMaskCanvas.height;
		const fillCtx = fillCanvas.getContext('2d', { willReadFrequently: true, alpha: true });

		const patternSource = document.createElement('canvas');
		patternSource.width = frameImageData.width;
		patternSource.height = frameImageData.height;
		patternSource.getContext('2d').putImageData(frameImageData, 0, 0);

		const pattern = fillCtx.createPattern(patternSource, 'repeat');
		const scale = (layer.settings.scale <= 0 ? 1 : layer.settings.scale) / 100;
		const matrix = new DOMMatrix().scaleSelf(scale, scale);
		pattern.setTransform(matrix);

		fillCtx.clearRect(0, 0, fillCanvas.width, fillCanvas.height);
		fillCtx.globalAlpha = layer.settings.opacity / 100;
		fillCtx.fillStyle = pattern;
		fillCtx.fillRect(0, 0, fillCanvas.width, fillCanvas.height);
		fillCtx.globalCompositeOperation = 'destination-in';
		fillCtx.drawImage(textMaskCanvas, 0, 0);
		fillCtx.globalCompositeOperation = 'source-over';

		this._drawTransformedCanvas(
			ctx,
			fillCanvas,
			layer.textData.transform,
			layer.textData.width,
			layer.textData.height
		);
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
		const { visibleLayers, glitterGifs, canvasData, exportSettings, callbacks } = params;

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
		visibleLayers.forEach((layer) => {
			if (layer.type !== LayerType.GLITTER_FILL) return;

			const rawMask = callbacks.createMask(layer);
			maskDataMap.set(layer.id, rawMask);
			maskCanvases.set(layer.id, this._createMaskCanvas(rawMask, canvasData.width, canvasData.height));
		});

		for (const layer of visibleLayers) {
			if (layer.type !== LayerType.TEXT_GLITTER) continue;
			textMaskCanvases.set(layer.id, await callbacks.renderTextMask(layer));
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
		const baseIsEffectivelyVisible = baseLayer && (baseLayer.visible !== false) && exportSettings.baseImage;

		// If the base layer is hidden, the background is effectively transparent
		const effectiveHasTransparency = !baseIsEffectivelyVisible || originalHasTransparency;

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

		// 4. Synchronization
		const frameCalc = this._calculateTotalFrames(visibleLayers, glitterGifs, exportSettings.maxFrames, exportSettings.smartFrameReduction);
		const totalFrames = frameCalc.totalFrames;
		const frameMap = frameCalc.frameMap;
		const reductions = frameCalc.reductions;

		callbacks.onStatus(`Rendering ${totalFrames} frames...`);

		// 5. Prepare Masks
		callbacks.onProgress(10, 'Preparing masks...', 0, totalFrames);
		this.helperCanvas.width = canvasData.width;
		this.helperCanvas.height = canvasData.height;

		// 6. Setup Encoder with Adaptive Quality
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

		const gif = new GIF(gifOptions);

		// 7. Render Loop
		this.canvas.width = canvasData.width;
		this.canvas.height = canvasData.height;

		const frameSkip = exportSettings.exportFrameSkip || 1;
		const framesToRender = [];

		// Build list of frames to actually render
		for (let f = 0; f < totalFrames; f++) {
			if (f % frameSkip === 0) {
				framesToRender.push(f);
			}
		}

		// Apply reverse if enabled
		if (exportSettings.exportReverse) {
			framesToRender.reverse();
		}

		dbg(`[GifExporter] Rendering ${framesToRender.length} of ${totalFrames} frames (skip: ${frameSkip}, reverse: ${!!exportSettings.exportReverse})`);

		for (let i = 0; i < framesToRender.length; i++) {
			const f = framesToRender[i];

			try {
				const frameData = this._renderFrame(
					f,
					canvasData,
					visibleLayers,
					glitterGifs,
					maskCanvases,
					textMaskCanvases,
					safeKey,
					exportSettings,
					watermark,
					needsTransparency,
					frameMap,
					flattenedFrameMap
				);

				gif.addFrame(frameData, {
					delay: exportSettings.frameDelay, // Keep using exportSettings.frameDelay
					copy: true
				});

				const progressPercent = 10 + Math.floor((i / framesToRender.length) * 65);
				callbacks.onProgress(progressPercent, `Rendering frame ${i + 1}/${framesToRender.length}...`, i + 1, framesToRender.length);
			} catch (error) {
				if (this.config.debug) console.error(`[GifExporter] Error rendering frame ${f}:`, error);
				throw new Error(`Frame ${f} render failed: ${error.message}`);
			}
		}

		// 8. Output
		callbacks.onProgress(75, 'Encoding GIF...', framesToRender.length, framesToRender.length);

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

		gif.on('finished', (blob) => this._handleFileSave(blob, callbacks, framesToRender.length, reductions));

		dbg('Starting GIF render:', {
			totalFrames: totalFrames,
			renderedFrames: framesToRender.length,
			frameSkip: frameSkip,
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
			if (layer.type === LayerType.GLITTER_FILL || layer.type === LayerType.TEXT_GLITTER) {
				const frames = flattenedFrameMap?.get(layer.id);
				if (frames?.length) {
					allFrames.push(...frames);
				}
			} else if (layer.type === LayerType.STICKER) {
				const stickerData = layer.stickerData;
				if (stickerData.isAnimated) {
					const frames = flattenedFrameMap?.get(layer.id);
					if (frames?.length) {
						allFrames.push(...frames);
					}
				} else if (!stickerData.isAnimated && stickerData.staticImageData) {
					allFrames.push(stickerData.staticImageData);
				}
			}
		});

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

	_renderFrame(frameIndex, canvasData, layers, library, maskCanvases, textMaskCanvases, safeKey, exportSettings, watermark, needsTransparency, frameMap = null, flattenedFrameMap = null) {
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

		if (shouldRenderBase) {
			if (needsTransparency) {
				// SCENARIO A: GIF Transparency is ACTIVE.
				const bgImage = new ImageData(new Uint8ClampedArray(originalData), width, height);
				const data = bgImage.data;

				for (let i = 0; i < originalAlpha.length; i++) {
					if (originalAlpha[i] < alphaThreshold) {
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
				hCtx.putImageData(new ImageData(new Uint8ClampedArray(originalData), width, height), 0, 0);
				ctx.drawImage(this.helperCanvas, 0, 0);
			}
		}

		// 5. Composite Glitter and Sticker Layers (in correct z-order)
		layers.forEach((layer) => {
			if (layer.visible === false) return;

			if (layer.type === LayerType.GLITTER_FILL) {
				// Render glitter layer
				const maskCanvas = maskCanvases.get(layer.id);
				if (!maskCanvas) {
					throw new Error(`Missing mask canvas for layer ${layer.id}`);
				}

				const frames = flattenedFrameMap?.get(layer.id);
				if (!frames?.length) {
					throw new Error(`Missing flattened glitter frames for layer ${layer.id}`);
				}

				// Use frameMap for smart reduction
				const reducedFrameCount = frameMap?.get(layer.id);
				const fIdx = this._getReducedFrameIndex(frameIndex, frames.length, reducedFrameCount);
				const frameImageData = frames[fIdx];
				if (!frameImageData) {
					throw new Error(`Invalid glitter frame format for layer ${layer.id} frame ${fIdx}`);
				}

				hCtx.save();
				hCtx.clearRect(0, 0, width, height);

				const patternSource = document.createElement('canvas');
				patternSource.width = frameImageData.width;
				patternSource.height = frameImageData.height;
				patternSource.getContext('2d').putImageData(frameImageData, 0, 0);

				const pattern = hCtx.createPattern(patternSource, 'repeat');
				const scale = (layer.settings.scale <= 0 ? 1 : layer.settings.scale) / 100;
				const matrix = new DOMMatrix().scaleSelf(scale, scale);
				pattern.setTransform(matrix);

				hCtx.globalAlpha = layer.settings.opacity / 100;
				hCtx.fillStyle = pattern;
				hCtx.fillRect(0, 0, width, height);

				hCtx.globalCompositeOperation = 'destination-in';
				hCtx.drawImage(maskCanvas, 0, 0);

				hCtx.restore();
				ctx.drawImage(this.helperCanvas, 0, 0);

			} else if (layer.type === LayerType.STICKER) {
				// Render sticker layer
				this._renderLayerToCanvas(layer, ctx, frameIndex, frameMap, flattenedFrameMap);
			} else if (layer.type === LayerType.TEXT_GLITTER) {
				this._renderTextLayerToCanvas(layer, ctx, frameIndex, frameMap, flattenedFrameMap, textMaskCanvases);
			}
		});

		// 6. Render Watermark
		if (exportSettings.watermarkEnabled && watermark) {
			this._renderWatermarkToCanvas(watermark, ctx, width, height, frameIndex);
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

			for (let i = 0; i < frameCount; i++) {
				const frameInfo = reader.frameInfo(i);

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
				frameCount
			};
		} catch (error) {
			if (this.config.debug) console.error(`[_parseGifWithMetadata] Error loading ${url}:`, error);
			throw error;
		}
	}

	_buildFlattenedFrameMap(layers, library) {
		const flattenedFrameMap = new Map();

		layers.forEach(layer => {
			let animation, name, isSticker;

			if (layer.type === LayerType.GLITTER_FILL || layer.type === LayerType.TEXT_GLITTER) {
				const glitter = library.find(g => g.id === layer.selectedGlitterId);
				if (!glitter?.frames?.frames?.length) return;
				animation = glitter.frames;
				name = glitter.name;
				isSticker = false;
			} else if (layer.type === LayerType.STICKER && layer.stickerData.isAnimated) {
				const stickerData = layer.stickerData;
				if (!stickerData.frames?.frames?.length) return;
				animation = stickerData.frames;
				name = stickerData.name;
				isSticker = true;
			} else {
				return;
			}

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
			let previousDisposal = null; // Track PREVIOUS frame's disposal

			// CRITICAL: Check for transparency in raw frames BEFORE disposal calculation
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

			// Stickers keep their original disposal methods. Glitter still uses
			// the existing heuristic analysis below.
			let useOriginalDisposal = isSticker;
			let calculatedDisposal = null;

			if (!useOriginalDisposal) {
				// Only analyze disposal for glitter (old logic)
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


				/*
				Disposal Method 1 (STACK):
				- Leaves the previous frame on the canvas
				- Draws the new frame on top of it
				- Used for opaque animations or delta-based GIFs (only pixels that changed)
				
				Disposal Method 2 (CLEAR):
				- Clears the canvas to transparent/background
				- Then draws the new frame from scratch
				- Used for transparent animations where each frame is independent
				
				Disposal Method 3 (RESTORE):
				- Restores to the state before the previous frame was drawn
				- Rarely used
				*/

				// Calculate disposal for glitter
				// PRIORITY: Transparency always requires CLEAR
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

				// Get THIS frame's disposal (will be used NEXT iteration)
				const currentDisposal = useOriginalDisposal
					? (frame.disposal === 0 || frame.disposal == null ? 1 : frame.disposal)
					: calculatedDisposal;

				// Apply the previous frame's disposal before drawing this frame.
				if (i > 0 && previousDisposal === 2) {
					ctx.clearRect(0, 0, width, height);
				} else if (i > 0 && previousDisposal === 3 && previousFrameData) {
					ctx.putImageData(previousFrameData, 0, 0);
				}

				// Save canvas state if THIS frame needs it for NEXT frame
				if (currentDisposal === 3) {
					previousFrameData = ctx.getImageData(0, 0, width, height);
				}

				// Draw current frame
				tempCtx.putImageData(frameImageData, 0, 0);
				ctx.drawImage(tempCanvas, 0, 0);

				// Capture the composited result
				const flattenedData = ctx.getImageData(0, 0, width, height);
				flattenedFrames.push(flattenedData);

				// Check FIRST FRAME ONLY for actual transparency
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

				// Save disposal for NEXT iteration
				previousDisposal = currentDisposal;
			}

			flattenedFrameMap.set(layer.id, flattenedFrames);
		});

		return flattenedFrameMap;
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
		const scaledWidth = Math.round(watermark.width * (CONFIG.watermarkScale / 100));
		const scaledHeight = Math.round(watermark.height * (CONFIG.watermarkScale / 100));

		// Calculate position
		let x, y;
		switch (CONFIG.watermarkPosition) {
			case 'top-left': x = CONFIG.watermarkPaddingX; y = CONFIG.watermarkPaddingY; break;
			case 'top-center': x = (canvasWidth - scaledWidth) / 2; y = CONFIG.watermarkPaddingY; break;
			case 'top-right': x = canvasWidth - scaledWidth - CONFIG.watermarkPaddingX; y = CONFIG.watermarkPaddingY; break;
			case 'bottom-left': x = CONFIG.watermarkPaddingX; y = canvasHeight - scaledHeight - CONFIG.watermarkPaddingY; break;
			case 'bottom-center': x = (canvasWidth - scaledWidth) / 2; y = canvasHeight - scaledHeight - CONFIG.watermarkPaddingY; break;
			case 'bottom-right': x = canvasWidth - scaledWidth - CONFIG.watermarkPaddingX; y = canvasHeight - scaledHeight - CONFIG.watermarkPaddingY; break;
			case 'center': x = (canvasWidth - scaledWidth) / 2; y = (canvasHeight - scaledHeight) / 2; break;
			default: x = CONFIG.watermarkPaddingX; y = CONFIG.watermarkPaddingY;
		}

		// Draw watermark
		ctx.save();
		ctx.globalAlpha = CONFIG.watermarkOpacity / 100;
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
			if (layer.type === LayerType.GLITTER_FILL || layer.type === LayerType.TEXT_GLITTER) {
				// Handle glitter layers
				const glitter = library.find(g => g.id === layer.selectedGlitterId);
				if (!glitter.frames) {
					callbacks.onStatus(`Loading ${glitter.name}...`);
					try {
						glitter.frames = await callbacks.parseGif(glitter.url);
					} catch (e) {
						throw new Error(`Failed to load ${glitter.name}`);
					}
				}

				if (layer.type === LayerType.TEXT_GLITTER) {
					try {
						await callbacks.ensureTextFont(layer.textData.fontId);
					} catch (e) {
						throw new Error(e.message);
					}
				}
			} else if (layer.type === LayerType.STICKER) {
				// Handle sticker layers
				const stickerData = layer.stickerData;

				if (stickerData.isAnimated && !stickerData.frames) {
					callbacks.onStatus(`Loading ${stickerData.name}...`);
					try {
						// Use same parser as glitter
						stickerData.frames = await callbacks.parseGif(stickerData.url);
					} catch (e) {
						throw new Error(`Failed to load sticker ${stickerData.name}`);
					}
				} else if (!stickerData.isAnimated && !stickerData.staticImageData) {
					// Load static image
					callbacks.onStatus(`Loading ${stickerData.name}...`);
					try {
						stickerData.staticImageData = await this._loadStaticImage(stickerData.url);
					} catch (e) {
						throw new Error(`Failed to load static sticker ${stickerData.name}`);
					}
				}
			}
		}
	}

	async _loadWatermark(callbacks) {
		if (!CONFIG.watermarkUrl) {
			return null;
		}

		callbacks.onStatus('Loading watermark...');

		try {
			const response = await fetch(CONFIG.watermarkUrl);
			const blob = await response.blob();
			const arrayBuffer = await blob.arrayBuffer();
			const uint8Array = new Uint8Array(arrayBuffer);

			// Check GIF signature
			const isGif = uint8Array[0] === 0x47 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46;

			if (isGif) {
				const frames = await this._parseGifWithMetadata(CONFIG.watermarkUrl, uint8Array);

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
					img.src = CONFIG.watermarkUrl;
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

	_calculateTotalFrames(layers, library, maxFrames, smartFrameReduction = false) {
		const layerFrameCounts = new Map();

		layers.forEach(l => {
			let count = 1;
			if (l.type === LayerType.GLITTER_FILL || l.type === LayerType.TEXT_GLITTER) {
				const glitter = library.find(g => g.id === l.selectedGlitterId);
				if (glitter?.frames?.frames) {
					count = glitter.frames.frames.length;
				}
			} else if (l.type === LayerType.STICKER) {
				if (l.stickerData.isAnimated && l.stickerData.frames?.frames) {
					count = l.stickerData.frames.frames.length;
				}
			}
			layerFrameCounts.set(l.id, count);
		});

		if (layerFrameCounts.size === 0) {
			if (this.config.debug) console.warn('[GifExporter] No valid layers, defaulting to 1 frame');
			return { totalFrames: 1, frameMap: new Map(), reductions: [] };
		}

		// Apply smart reduction or standard LCM
		const result = smartFrameReduction
			? this._smartReduceFrames(layerFrameCounts, maxFrames, layers) // PASS LAYERS
			: this._standardLCM(layerFrameCounts, maxFrames);

		if (this.config.debug) {
			dbg('[GifExporter] Calculated total frames:', result.totalFrames);
			if (result.reductions.length > 0) {
				dbg('[GifExporter] Smart reductions applied:', result.reductions);
			}
		}

		return result;
	}

	_standardLCM(layerFrameCounts, maxFrames) {
		const counts = Array.from(layerFrameCounts.values()).filter(c => c > 0);

		let total = counts[0];
		if (counts.length > 1) {
			total = counts.reduce((acc, val) => this.lcm(acc, val), total);
		}

		const totalFrames = Math.min(total, maxFrames);

		return {
			totalFrames,
			frameMap: layerFrameCounts,
			reductions: []
		};
	}

	_smartReduceFrames(layerFrameCounts, maxFrames, layers) {
		const reductions = [];
		let reducedCounts = new Map(layerFrameCounts);

		// Check if we have glitter layers with multiple frames
		const hasMultiFrameGlitter = layers.some(layer =>
			(layer.type === LayerType.GLITTER_FILL || layer.type === LayerType.TEXT_GLITTER) &&
			layerFrameCounts.get(layer.id) > 1
		);

		// Step 1: Round to multiples of 3 ONLY if there are multi-frame glitter layers AND it helps
		if (hasMultiFrameGlitter) {
			// Calculate original LCM first
			const originalCounts = Array.from(reducedCounts.values()).filter(c => c > 0);
			const originalLCM = originalCounts.reduce((acc, val) => this.lcm(acc, val), originalCounts[0]);

			layerFrameCounts.forEach((originalCount, layerId) => {
				const nearestMultipleOf3 = Math.round(originalCount / 3) * 3;
				const difference = Math.abs(originalCount - nearestMultipleOf3);
				const percentDiff = difference / originalCount;

				// Only round if within 20% AND nearestMultipleOf3 is valid
				if (nearestMultipleOf3 > 0 && percentDiff <= 0.20 && nearestMultipleOf3 !== originalCount) {
					// Test if this reduction would help the final LCM
					const testMap = new Map(reducedCounts);
					testMap.set(layerId, nearestMultipleOf3);
					const testCounts = Array.from(testMap.values()).filter(c => c > 0);
					const testLCM = testCounts.reduce((acc, val) => this.lcm(acc, val), testCounts[0]);

					// Only apply if it reduces LCM by at least 10%
					if (testLCM < originalLCM * 0.9) {
						reducedCounts.set(layerId, nearestMultipleOf3);
						reductions.push({
							layerId,
							original: originalCount,
							reduced: nearestMultipleOf3,
							reason: 'rounded-to-multiple-of-3'
						});
					}
				}
			});
		}

		// Step 2: Calculate initial LCM
		let counts = Array.from(reducedCounts.values()).filter(c => c > 0);
		let totalFrames = counts.length > 0 ? counts.reduce((acc, val) => this.lcm(acc, val), counts[0]) : 1;

		// Step 3: Cap individual animations based on their size
		reducedCounts.forEach((count, layerId) => {
			let targetCap = null;

			if (count > 60) {
				// Very long animations: cap at 30
				targetCap = 30;
			} else if (count > 36) {
				// Long animations: cap at 24
				targetCap = 24;
			} else if (count > 24) {
				// Medium-long: cap at 18
				targetCap = 18;
			}

			if (targetCap && count > targetCap) {
				const newCount = targetCap;
				reducedCounts.set(layerId, newCount);

				const existingIdx = reductions.findIndex(r => r.layerId === layerId);
				if (existingIdx >= 0) {
					reductions[existingIdx].reduced = newCount;
					reductions[existingIdx].reason = 'capped-at-' + targetCap;
				} else {
					reductions.push({
						layerId,
						original: layerFrameCounts.get(layerId),
						reduced: newCount,
						reason: 'capped-at-' + targetCap
					});
				}
			}
		});

		// Recalculate final LCM
		counts = Array.from(reducedCounts.values()).filter(c => c > 0);
		totalFrames = counts.length > 0 ? counts.reduce((acc, val) => this.lcm(acc, val), counts[0]) : 1;

		return {
			totalFrames: Math.min(totalFrames, maxFrames),
			frameMap: reducedCounts,
			reductions
		};
	}

	_handleFileSave(blob, callbacks, frameCount, reductions = []) {
		dbg('_handleFileSave called with blob size:', blob.size);
		callbacks.onProgress(100, 'Export complete!', 0, 0);
		callbacks.onStatus('Export complete!');
		callbacks.onComplete({
			smartReduced: reductions.length > 0,
			frameReductions: reductions
		});

		const file = new File([blob], this.config.fileName, {
			type: 'image/gif',
			lastModified: Date.now()
		});

		const url = URL.createObjectURL(blob);

		// Pass frameCount, blob.size, and reductions to the preview modal
		this._showExportPreviewModal(url, file, frameCount, blob.size, reductions);
	}




	_showExportPreviewModal(blobUrl, file, frameCount, fileSize, reductions = []) {
		const modal = document.getElementById('exportPreviewModal');
		const img = document.getElementById('exportPreviewImage');
		const instructions = modal.querySelector('.export-preview-instructions');
		const closeBtn = document.getElementById('closeExportPreviewModal');

		// Stats Elements
		const exportStats = document.getElementById('exportStats');

		if (exportStats) {
			const statSize = document.getElementById('exportStatSize');
			const statFrames = document.getElementById('exportStatFrames');

			// remove .size-warning and .smart-reduction-badge elements from exportStats
			const previousBadges = exportStats.querySelectorAll('.size-warning, .smart-reduction-badge');
			previousBadges.forEach(badge => {
				badge.remove();
			});


			if (statFrames) {
				statFrames.textContent = `Frames: ${frameCount != null ? frameCount : 'Unknown'}`;
			}

			// Set stats text
			if (statSize) {
				statSize.textContent = `Size: ${fileSize != null ? this._formatBytes(fileSize) : 'Unknown'}`;

				if (fileSize != null) {
					const warnings = this._getSizeWarningsHTML(fileSize);
					if (warnings) {
						exportStats.insertAdjacentHTML('beforeend', warnings);
					}
				}
			}

			// Add smart reduction badge if applied
			if (reductions.length > 0) {
				const badge = `<span class="smart-reduction-badge" title="Optimized ${reductions.length} layer${reductions.length > 1 ? 's' : ''} for smaller file size">Smart Reduced</span>`;
				exportStats.insertAdjacentHTML('beforeend', badge);
			}
		}




		// Button Elements
		const shareBtn = document.getElementById('exportPreviewShare');
		const openBtn = document.getElementById('exportPreviewOpen');
		const saveBtn = document.getElementById('exportPreviewSave'); // New Button

		// 1. Environment Detection
		// Force iOS logic if iPhone/iPad detected
		const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
		const canShare = navigator.canShare && navigator.canShare({ files: [file] });

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

		// 3. Set Image
		img.src = blobUrl;

		// 4. Configure UI Logic
		if (isIOS) {
			// --- iOS Logic ---

			// disable right click on image
			img.oncontextmenu = () => false;

			// DISABLE "Open GIF" & "Save" (Direct download fails/breaks on iOS)
			configureBtn(openBtn, false);
			configureBtn(saveBtn, false);

			if (canShare) {
				// ENABLE "Share" (mapped to Save Image)
				configureBtn(shareBtn, true, "Save Image");


				instructions.innerHTML = `
		<p>Tap <strong>"Save Image"</strong> below to save to Files or share.</p>
		<p class="text-muted"><strong>Why can't I just tap and hold?</strong>
		<p class="text-muted">
			iOS doesn't support saving animated GIFs created dynamically in the browser. 
			Using the Share button preserves the animation properly. I know it's annoying.
		</p>`;
			} else {
				// Fallback (Rare old iOS)
				configureBtn(shareBtn, false);
				instructions.innerHTML = `
		<p>Long-press the image to save.</p>
		<p class="text-muted">
			Note: This may save as a still image. Update iOS to use the Share feature for full animation support.
		</p>`;
			}
		}
		else {
			// --- Desktop / Android Logic ---

			// enable right click on image
			img.oncontextmenu = () => true;

			// ENABLE "Open GIF" & "Save" (Standard browser features)
			configureBtn(openBtn, true);
			configureBtn(saveBtn, true);

			// Handle Share button (Some desktops like Safari/Edge support it)
			if (canShare) {
				configureBtn(shareBtn, true, "Share");
				instructions.innerHTML = `<p>Save using the buttons below or right-click the image.</p>`;
			} else {
				configureBtn(shareBtn, false);
				instructions.innerHTML = `<p>Use the <strong>Save</strong> button or right-click the image.</p>`;
			}
		}

		// 5. Show Modal
		modal.classList.add('visible');

		// 6. Handlers
		const cleanup = () => {
			modal.classList.remove('visible');
			setTimeout(() => URL.revokeObjectURL(blobUrl), 500);
		};

		closeBtn.onclick = cleanup;
		modal.onclick = (e) => { if (e.target === modal) cleanup(); };

		// Handler: Share (iOS "Save Image")
		shareBtn.onclick = async () => {
			if (shareBtn.disabled || !canShare) return;
			try {
				await navigator.share({
					files: [file],
					title: 'Glitter GIF',
					text: 'Created with ' + CONFIG.siteName
				});
			} catch (error) {
				if (error.name !== 'AbortError') if (this.config.debug) console.error('Share failed:', error);
			}
		};

		// Handler: Open in New Tab
		openBtn.onclick = () => {
			if (openBtn.disabled) return;
			const win = window.open(blobUrl, '_blank');
			if (!win) alert('Please allow popups to view the full image.');
		};

		// Handler: Save / Download (Desktop)
		saveBtn.onclick = () => {
			if (saveBtn.disabled) return;
			const a = document.createElement('a');
			a.href = blobUrl;
			a.download = this.config.fileName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
		};
	}
}
