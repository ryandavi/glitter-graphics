'use strict';

// GIF alone reduces true RGBA into binary transparency; this threshold is
// encoder-private and must never be conflated with the selection alpha
// threshold (CONFIG.tools.selection.transparency.alphaThreshold, 254) or the
// watermark preprocessing threshold (CONFIG.export.watermark.alphaThreshold).
const GIF_TRANSPARENCY_ALPHA_THRESHOLD = 128;
// Bits kept per channel when looking up the nearest palette color. The table
// holds every possible cell (2^(3·bits) entries), so a color-rich animation
// searches the palette at most once per cell for the whole export instead of
// once per pixel. GifPalette itself bins at 5 bits, so 6 loses nothing visible.
const GIF_PALETTE_LOOKUP_BITS = 6;

class GifEncodingPipeline {
	constructor(config = {}) {
		this.config = {
			workers: config.workers ?? CONFIG.export.core.workers,
			workerScript: config.workerScript || CONFIG.export.core.workerScript
		};
	}

	_analyzeColors(frames, alphaThreshold = 1) {
		const settings = CONFIG.export?.limits?.colorAnalysis;
		if (!settings || !frames?.length) return null;
		const count = Math.min(frames.length, settings.maxFrames);
		const indexes = new Set(Array.from({ length: count }, (_, index) => count === 1 ? 0 : Math.round(index * (frames.length - 1) / (count - 1))));
		let observedColorCount = 0;
		for (const frameIndex of indexes) {
			const frame = frames[frameIndex];
			const pixelCount = frame.width * frame.height;
			const pixelStep = Math.max(1, Math.ceil(pixelCount / settings.maxPixelsPerFrame));
			const colors = new Set();
			for (let pixel = 0; pixel < pixelCount; pixel += pixelStep) {
				const offset = pixel * 4;
				if (frame.data[offset + 3] < alphaThreshold) continue;
				colors.add((frame.data[offset] << 16) | (frame.data[offset + 1] << 8) | frame.data[offset + 2]);
				if (colors.size > settings.significantColorCount) return { significant: true, observedColorCount: colors.size, paletteSize: settings.paletteSize };
			}
			observedColorCount = Math.max(observedColorCount, colors.size);
		}
		return { significant: false, observedColorCount, paletteSize: settings.paletteSize };
	}

	_applyDitherFrame(frame, paletteBytes, settings, mode, frameIndex) {
		const palette = [];
		for (let index = 0; index < paletteBytes.length; index += 3) palette.push(paletteBytes.slice(index, index + 3));
		const type = String(settings.ditherType || '').toLowerCase();
		const algorithm = type.includes('atkinson') ? 'atkinson' : type.includes('falsefloyd') ? 'falsefloyd'
			: type.includes('stucki') ? 'stucki' : type.includes('bayer') ? 'bayer' : type.includes('halftone') ? 'halftone' : 'floyd';
		return new ImageData(GlitterPixelEffects.applyPixelEffects(frame.data, frame.width, frame.height, {
			pixelateEnabled: false,
			paletteEnabled: true,
			pixelSize: 1,
			paletteMode: 'dither',
			dither: {
				algorithm,
				angle: 45,
				strength: settings.ditherAmount,
				scale: settings.ditherScale,
				edgeProtection: settings.ditherEdgeProtection,
				serpentine: type.includes('serpentine'),
				shimmer: mode === 'animation' && settings.ditherTemporalMode === 'animated',
				palette: 'auto',
				duotone: ['#000000', '#ffffff']
			}
		}, { pixelEffects: CONFIG.tools.pixelEffects, autoGlitter: CONFIG.tools.autoGlitter }, frameIndex, palette), frame.width, frame.height);
	}

	_frameHasTransparency(frame, alphaThreshold) {
		const data = frame.data;
		for (let offset = 3; offset < data.length; offset += 4) {
			if (data[offset] < alphaThreshold) return true;
		}
		return false;
	}

	// One slot per color cell, filled on first use (-1 = not searched yet), and
	// only valid for one palette: share it across the frames of one encode.
	_createPaletteCache() {
		return new Int32Array(1 << (GIF_PALETTE_LOOKUP_BITS * 3)).fill(-1);
	}

	// Mirrors GlitterPixelEffects' private dithering distance formula
	// (dr²·0.3 + dg²·0.59 + db²·0.11) for consistency with the rest of the
	// app's color matching. Kept local because that helper expects palette
	// entries as [r,g,b] triples while GifPalette works in flat byte arrays.
	// Every color in a cell resolves to the palette color nearest the cell's
	// center, so the answer never depends on which pixel reached it first.
	// Returns the palette color packed as 0xRRGGBB.
	_nearestPaletteRGB(r, g, b, palette, cache) {
		const shift = 8 - GIF_PALETTE_LOOKUP_BITS;
		const slot = ((r >> shift) << (GIF_PALETTE_LOOKUP_BITS * 2)) | ((g >> shift) << GIF_PALETTE_LOOKUP_BITS) | (b >> shift);
		const cached = cache[slot];
		if (cached >= 0) return cached;
		const half = 1 << (shift - 1);
		const centerR = ((r >> shift) << shift) | half;
		const centerG = ((g >> shift) << shift) | half;
		const centerB = ((b >> shift) << shift) | half;
		let bestOffset = 0;
		let bestDistance = Infinity;
		for (let offset = 0; offset < palette.length; offset += 3) {
			const dr = centerR - palette[offset];
			const dg = centerG - palette[offset + 1];
			const db = centerB - palette[offset + 2];
			const distance = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
			if (distance < bestDistance) { bestDistance = distance; bestOffset = offset; }
		}
		const color = (palette[bestOffset] << 16) | (palette[bestOffset + 1] << 8) | palette[bestOffset + 2];
		cache[slot] = color;
		return color;
	}

	// Choose an RGB value absent from the small visible palette to reserve as
	// the GIF transparency sentinel. This is an encoder-private value, never a
	// source chroma key: it never scans source images, glitter frames,
	// stickers, or rendered frames - only the already-built visible palette.
	_selectTransparencySentinel(visiblePalette) {
		const candidates = [
			[255, 0, 255], [0, 255, 255], [255, 255, 0],
			[1, 1, 1], [2, 2, 2], [3, 3, 3], [0, 1, 0]
		];
		const present = new Set();
		for (let offset = 0; offset < visiblePalette.length; offset += 3) {
			present.add((visiblePalette[offset] << 16) | (visiblePalette[offset + 1] << 8) | visiblePalette[offset + 2]);
		}
		for (const [r, g, b] of candidates) {
			const hex = (r << 16) | (g << 8) | b;
			if (!present.has(hex)) return { r, g, b, hex };
		}
		for (let hex = 0; hex <= 0xFFFFFF; hex++) {
			if (!present.has(hex)) return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255, hex };
		}
		throw new Error('No unused RGB value available for GIF transparency sentinel');
	}

	// The core fix for the disappearing-fill bug: every opaque pixel is
	// remapped to an exact visible-palette RGB before GIF.js ever sees it, so
	// its own nearest-color lookup can never drift an opaque color onto the
	// reserved transparency index. Every transparent pixel maps directly to
	// the sentinel. Alpha itself never participates in the color decision.
	_prepareTransparentFrame(frame, visiblePalette, sentinel, alphaThreshold, cache = this._createPaletteCache()) {
		const copy = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
		const data = copy.data;
		let hasTransparentPixel = false;
		for (let offset = 0; offset < data.length; offset += 4) {
			if (data[offset + 3] < alphaThreshold) {
				data[offset] = sentinel.r;
				data[offset + 1] = sentinel.g;
				data[offset + 2] = sentinel.b;
				data[offset + 3] = 255;
				hasTransparentPixel = true;
			} else if (visiblePalette.length) {
				const color = this._nearestPaletteRGB(data[offset], data[offset + 1], data[offset + 2], visiblePalette, cache);
				data[offset] = color >> 16;
				data[offset + 1] = (color >> 8) & 255;
				data[offset + 2] = color & 255;
				data[offset + 3] = 255;
			} else {
				// No visible color exists anywhere in the animation (item 25:
				// an all-transparent export); the sentinel alone is sufficient.
				data[offset] = sentinel.r;
				data[offset + 1] = sentinel.g;
				data[offset + 2] = sentinel.b;
				data[offset + 3] = 255;
			}
		}
		return { frame: copy, hasTransparentPixel };
	}

	// GIF keeps a pixel or drops it. Below the cut, keep a faint pixel with
	// probability alpha / cut through a fixed 4x4 Bayer pattern, so a glow's
	// tail reads as a fading dither and never flickers between frames. Pixels
	// at or above the cut are untouched, so solid art is unchanged.
	_ditherSoftEdges(frame, alphaThreshold) {
		const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
		const copy = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
		const data = copy.data;
		for (let y = 0; y < frame.height; y++) {
			for (let x = 0; x < frame.width; x++) {
				const offset = (y * frame.width + x) * 4 + 3;
				const alpha = data[offset];
				if (alpha === 0 || alpha >= alphaThreshold) continue;
				data[offset] = alpha / alphaThreshold > (bayer[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? 255 : 0;
			}
		}
		return copy;
	}

	async encode({ frames, delays = [], settings, transparency, mode = 'animation', reportProgress, isCancelled }) {
		if (isCancelled?.()) throw new Error('Export cancelled');
		// Step timings for logExportTimings(); only read when debug is on.
		const timings = {};
		let stepStart = performance.now();
		const lap = (label) => {
			const now = performance.now();
			timings[label] = Math.round((timings[label] || 0) + now - stepStart);
			stepStart = now;
		};
		if (transparency?.enabled && transparency.ditherSoftEdges) {
			frames = frames.map((frame) => this._ditherSoftEdges(frame, GIF_TRANSPARENCY_ALPHA_THRESHOLD));
		}
		lap('softEdgeDitherMs');
		reportProgress?.('palette', 0, '');
		const frameCount = frames.length;
		const width = frames[0].width;
		const height = frames[0].height;
		// transparency.enabled means transparent GIF output was requested; it
		// does not mean any frame actually ended up with a transparent pixel.
		const hasGifTransparency = Boolean(transparency?.enabled)
			&& frames.some((frame) => this._frameHasTransparency(frame, GIF_TRANSPARENCY_ALPHA_THRESHOLD));
		lap('transparencyScanMs');
		const analysis = this._analyzeColors(frames, hasGifTransparency ? GIF_TRANSPARENCY_ALPHA_THRESHOLD : 1);
		const colorCount = GifPalette.resolveColorCount(settings.colorCount, analysis);
		const useNativePalette = !hasGifTransparency && settings.colorCount === 'auto' && !settings.ditherEnabled;
		lap('colorAnalysisMs');
		reportProgress?.('palette', 0.25, '');

		const sampleBudget = { maxSamples: settings.quality <= 1 ? 524288 : (settings.quality <= 10 ? 262144 : 131072) };
		let globalPalette = null;
		let visiblePalette = [];
		let sentinel = null;
		if (hasGifTransparency) {
			visiblePalette = GifPalette.build(frames, Math.max(1, colorCount - 1), {
				style: settings.paletteStyle,
				alphaThreshold: GIF_TRANSPARENCY_ALPHA_THRESHOLD,
				...sampleBudget
			});
			sentinel = this._selectTransparencySentinel(visiblePalette);
			globalPalette = [sentinel.r, sentinel.g, sentinel.b, ...visiblePalette];
		} else if (!useNativePalette) {
			globalPalette = GifPalette.build(frames, colorCount, { style: settings.paletteStyle, ...sampleBudget });
		}
		lap('paletteBuildMs');

		reportProgress?.('palette', 0.5, '');
		const frameSettings = {
			...settings,
			ditherTemporalMode: mode === 'still' ? 'stable' : settings.ditherTemporalMode,
			hasTransparency: hasGifTransparency
		};
		const options = {
			workers: this.config.workers,
			quality: settings.quality,
			width,
			height,
			workerScript: this.config.workerScript,
			dither: false
		};
		if (globalPalette) options.globalPalette = globalPalette;
		if (hasGifTransparency) options.background = sentinel.hex;
		const gif = new GIF(options);
		const paletteMode = useNativePalette ? 'native' : 'shared';
		const paletteCache = hasGifTransparency ? this._createPaletteCache() : null;
		for (let index = 0; index < frameCount; index++) {
			if (isCancelled?.()) throw new Error('Export cancelled');
			const sourceFrame = frames[index];
			let preparedFrame = sourceFrame;
			let frameIsTransparent = false;
			stepStart = performance.now();
			if (hasGifTransparency) {
				const prepared = this._prepareTransparentFrame(sourceFrame, visiblePalette, sentinel, GIF_TRANSPARENCY_ALPHA_THRESHOLD, paletteCache);
				preparedFrame = prepared.frame;
				frameIsTransparent = prepared.hasTransparentPixel;
				// A fully opaque frame inside an otherwise-transparent animation
				// must not designate one of its own visible colors as transparent.
				gif.setOption('transparent', frameIsTransparent ? sentinel.hex : null);
			} else if (!useNativePalette && frameSettings.ditherEnabled) {
				preparedFrame = this._applyDitherFrame(sourceFrame, globalPalette, frameSettings, mode, index);
			}
			lap('framePrepareMs');
			gif.addFrame(preparedFrame, { delay: delays[index], copy: true });
			lap('frameQueueMs');
			frames[index] = null;
			preparedFrame = null;
			reportProgress?.('palette', 0.5 + ((index + 1) / frameCount * 0.5), '', index + 1, frameCount);
			if (index + 1 < frameCount && (index + 1) % CONFIG.export.progress.yieldEveryFrames === 0) {
				await yieldForExportProgress();
			}
		}
		reportProgress?.('palette', 1, '', frameCount, frameCount);
		stepStart = performance.now();
		return new Promise((resolve, reject) => {
			const cancelTimer = window.setInterval(() => {
				if (isCancelled?.()) gif.abort();
			}, CONFIG.export.progress.timerRefreshMs);
			const stop = () => clearInterval(cancelTimer);
			gif.on('error', (error) => { stop(); reject(new Error(`GIF encoding failed: ${error.message}`)); });
			gif.on('abort', () => { stop(); reject(new Error('Export cancelled')); });
			gif.on('progress', (progress) => {
				if (isCancelled?.()) { gif.abort(); return; }
				try {
					reportProgress?.('encoding', progress, '', Math.round(progress * frameCount), frameCount);
				} catch (error) {
					gif.abort();
					reject(error);
				}
			});
			gif.on('finished', (blob) => {
				stop();
				lap('workerEncodeMs');
				if (isCancelled?.()) reject(new Error('Export cancelled'));
				else resolve({ blob, analysis, paletteSize: colorCount, paletteMode, transparencyUsed: hasGifTransparency, workers: this.config.workers, timings });
			});
			try { gif.render(); } catch (error) { stop(); reject(error); }
		});
	}
}
