'use strict';

class GifEncodingPipeline {
	constructor(config = {}) {
		this.config = {
			workers: config.workers ?? CONFIG.export.core.workers,
			workerScript: config.workerScript || CONFIG.export.core.workerScript
		};
	}

	_analyzeColors(frames) {
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
				colors.add((frame.data[offset] << 16) | (frame.data[offset + 1] << 8) | frame.data[offset + 2]);
				if (colors.size > settings.significantColorCount) return { significant: true, observedColorCount: colors.size, paletteSize: settings.paletteSize };
			}
			observedColorCount = Math.max(observedColorCount, colors.size);
		}
		return { significant: false, observedColorCount, paletteSize: settings.paletteSize };
	}

	async _applyDither(frames, paletteBytes, settings, mode, reportProgress, isCancelled) {
		if (!settings.ditherEnabled || settings.hasTransparency) return frames;
		const palette = [];
		for (let index = 0; index < paletteBytes.length; index += 3) palette.push(paletteBytes.slice(index, index + 3));
		const type = String(settings.ditherType || '').toLowerCase();
		const algorithm = type.includes('atkinson') ? 'atkinson' : type.includes('falsefloyd') ? 'falsefloyd'
			: type.includes('stucki') ? 'stucki' : type.includes('bayer') ? 'bayer' : type.includes('halftone') ? 'halftone' : 'floyd';
		const output = [];
		for (let index = 0; index < frames.length; index++) {
			if (isCancelled?.()) throw new Error('Export cancelled');
			const frame = frames[index];
			output.push(new ImageData(GlitterPixelEffects.applyPixelEffects(frame.data, frame.width, frame.height, {
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
			}, { pixelEffects: CONFIG.tools.pixelEffects, autoGlitter: CONFIG.tools.autoGlitter }, index, palette), frame.width, frame.height));
			reportProgress?.('palette', 0.5 + ((index + 1) / frames.length * 0.5), `Applying palette to frame ${index + 1} / ${frames.length}`, index + 1, frames.length);
			if (index + 1 < frames.length && (index + 1) % CONFIG.export.progress.yieldEveryFrames === 0) {
				await new Promise((resolve) => requestAnimationFrame(resolve));
			}
		}
		return output;
	}

	async encode({ frames, delays = [], settings, transparency, mode = 'animation', reportProgress, isCancelled }) {
		if (isCancelled?.()) throw new Error('Export cancelled');
		reportProgress?.('palette', 0, 'Analyzing export colors');
		const safeKey = transparency?.needed ? transparency.safeKey : null;
		const preparedFrames = safeKey ? frames.map((frame) => {
			let hasTransparentPixel = false;
			for (let offset = 3; offset < frame.data.length; offset += 4) {
				if (frame.data[offset] === 0) { hasTransparentPixel = true; break; }
			}
			if (!hasTransparentPixel) return frame;
			const copy = new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
			for (let offset = 0; offset < copy.data.length; offset += 4) {
				if (copy.data[offset + 3] !== 0) continue;
				copy.data[offset] = safeKey.r;
				copy.data[offset + 1] = safeKey.g;
				copy.data[offset + 2] = safeKey.b;
				copy.data[offset + 3] = 255;
			}
			return copy;
		}) : frames;
		const analysis = this._analyzeColors(preparedFrames);
		const colorCount = GifPalette.resolveColorCount(settings.colorCount, analysis);
		const useNativePalette = settings.colorCount === 'auto' && !settings.ditherEnabled;
		reportProgress?.('palette', 0.25, useNativePalette ? 'Preparing per-frame colors' : 'Choosing a shared palette');
		const globalPalette = useNativePalette ? null : GifPalette.build(preparedFrames, colorCount, {
			transparentColor: safeKey?.hex ?? null,
			style: settings.paletteStyle,
			maxSamples: settings.quality <= 1 ? 524288 : (settings.quality <= 10 ? 262144 : 131072)
		});
		reportProgress?.('palette', 0.5, settings.ditherEnabled ? 'Applying the export palette…' : 'Palette ready');
		const encodedFrames = useNativePalette ? preparedFrames : await this._applyDither(preparedFrames, globalPalette, {
			...settings,
			ditherTemporalMode: mode === 'still' ? 'stable' : settings.ditherTemporalMode,
			hasTransparency: Boolean(safeKey)
		}, mode, reportProgress, isCancelled);
		reportProgress?.('palette', 1, `Palette ready for ${frames.length} frames`, frames.length, frames.length);
		const options = {
			workers: this.config.workers,
			quality: settings.quality,
			width: frames[0].width,
			height: frames[0].height,
			workerScript: this.config.workerScript,
			dither: false
		};
		if (globalPalette) options.globalPalette = globalPalette;
		if (safeKey) { options.transparent = safeKey.hex; options.background = safeKey.hex; }
		const gif = new GIF(options);
		encodedFrames.forEach((frame, index) => gif.addFrame(frame, { delay: delays[index], copy: true }));
		return new Promise((resolve, reject) => {
			gif.on('error', (error) => reject(new Error(`GIF encoding failed: ${error.message}`)));
			gif.on('abort', () => reject(new Error('Export cancelled')));
			gif.on('progress', (progress) => {
				if (isCancelled?.()) { gif.abort(); return; }
				try {
					reportProgress?.('encoding', progress, `Encoding… ${Math.round(progress * 100)}%`, Math.round(progress * frames.length), frames.length);
				} catch (error) {
					gif.abort();
					reject(error);
				}
			});
			gif.on('finished', (blob) => resolve({ blob, analysis, paletteSize: colorCount }));
			gif.render();
		});
	}
}
