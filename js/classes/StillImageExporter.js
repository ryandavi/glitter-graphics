'use strict';

function encodeCanvasToBlob(canvas, mimeType, quality) {
	return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob.type === mimeType ? blob : new Blob([blob], { type: mimeType })) : reject(new Error(`${mimeType} encoder produced no file.`)), mimeType, quality));
}

class StillImageExporter {
	constructor(frameComposer, resultPresenter) { this.frameComposer = frameComposer; this.resultPresenter = resultPresenter; this.fileName = `${CONFIG.export.core.defaultBaseName}.png`; }
	setFileName(fileName) { if (fileName) this.fileName = fileName; }
	async process(params) {
		const { target, callbacks, exportSettings } = params;
		const composed = await this.frameComposer.composeFrameAt(params);
		const canvas = document.createElement('canvas'); canvas.width = composed.width; canvas.height = composed.height;
		const ctx = canvas.getContext('2d', { alpha: target.supportsTransparency });
		if (!target.supportsTransparency || !exportSettings.transparency) { ctx.fillStyle = exportSettings.matteColor; ctx.fillRect(0, 0, canvas.width, canvas.height); }
		ctx.putImageData(composed.imageData, 0, 0);
		let blob;
		if (target.format === 'png') { callbacks.onProgress(75, 'Encoding PNG…', 1, 1, { phase: 'Encoding PNG' }); blob = await encodeCanvasToBlob(canvas, target.mimeType); }
		else if (target.format === 'jpeg') blob = await this._encodeJpegGenerations(canvas, exportSettings, callbacks);
		else blob = await this._encodeGif(composed, exportSettings, callbacks);
		callbacks.onProgress(100, 'Export complete', 1, 1, { phase: 'Finalizing' }); callbacks.onStatus('Export complete!');
		const file = new File([blob], this.fileName, { type: target.mimeType, lastModified: Date.now() });
		callbacks.onComplete({ still: true }); this.resultPresenter.show({ blob, file, target, width: composed.width, height: composed.height }); return blob;
	}
	async _encodeJpegGenerations(canvas, settings, callbacks) {
		let blob; const quality = settings.jpegQuality / 100; const total = settings.jpegGenerations;
		for (let generation = 1; generation <= total; generation++) {
			callbacks.onProgress(60 + generation / total * 35, `Encoding JPG ${generation} / ${total}`, generation, total, { phase: 'Encoding JPG' });
			blob = await encodeCanvasToBlob(canvas, 'image/jpeg', quality); if (generation === total) break;
			if (callbacks.isCancelled?.()) throw new Error('Export cancelled');
			const bitmap = await createImageBitmap(blob); canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0); bitmap.close();
		}
		return blob;
	}
	async _encodeGif(composed, settings, callbacks) {
		callbacks.onProgress(65, 'Building palette…', 1, 1, { phase: 'Building palette' });
		const { imageData, width, height, needsTransparency, transparentColor } = composed;
		let frame = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
		const transparent = needsTransparency && transparentColor ? transparentColor.hex : null;
		if (transparent != null) for (let i = 0; i < frame.data.length; i += 4) if (frame.data[i + 3] === 0) { frame.data[i] = transparentColor.r; frame.data[i + 1] = transparentColor.g; frame.data[i + 2] = transparentColor.b; frame.data[i + 3] = 255; }
		const analysis = this.frameComposer._analyzeGifColors([frame]);
		const colorCount = GifPalette.resolveColorCount(settings.colorCount, analysis);
		const useNativePalette = settings.colorCount === 'auto' && !settings.ditherEnabled;
		const globalPalette = useNativePalette ? null : GifPalette.build([frame], colorCount, { transparentColor: transparent, style: settings.paletteStyle });
		if (globalPalette) [frame] = await this.frameComposer._applyGifDither([frame], globalPalette, { ...settings, ditherTemporalMode: 'stable', hasTransparency: transparent != null }, callbacks);
		const options = { workers: this.frameComposer.config.workers, quality: settings.quality, width, height, workerScript: this.frameComposer.config.workerScript, dither: false };
		if (globalPalette) options.globalPalette = globalPalette;
		if (transparent != null) { options.transparent = transparent; options.background = transparent; }
		const gif = new GIF(options); gif.addFrame(frame, { copy: true }); callbacks.onProgress(80, 'Encoding GIF…', 1, 1, { phase: 'Encoding GIF' });
		return new Promise((resolve, reject) => { gif.on('finished', resolve); gif.on('error', reject); gif.on('abort', () => reject(new Error('Export cancelled'))); gif.render(); });
	}
}
