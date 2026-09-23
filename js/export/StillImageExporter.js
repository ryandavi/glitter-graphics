'use strict';

function encodeCanvasToBlob(canvas, mimeType, quality) {
	return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob.type === mimeType ? blob : new Blob([blob], { type: mimeType })) : reject(new Error(`${mimeType} encoder produced no file.`)), mimeType, quality));
}

class StillImageExporter {
	constructor(frameComposer, resultPresenter, gifEncodingPipeline = new GifEncodingPipeline()) { this.frameComposer = frameComposer; this.resultPresenter = resultPresenter; this.gifEncodingPipeline = gifEncodingPipeline; this.fileName = `${CONFIG.export.core.defaultBaseName}.png`; }
	setFileName(fileName) { if (fileName) this.fileName = fileName; }
	async process(params) {
		const { target, callbacks, exportSettings } = params;
		const composed = await this.frameComposer.composeFrameAt(params);
		const canvas = createAppCanvas(0, 0, 'export/StillImageExporter'); canvas.width = composed.width; canvas.height = composed.height;
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
		const encoded = await this.gifEncodingPipeline.encode({
			frames: [composed.imageData],
			settings,
			transparency: composed.transparency,
			mode: 'still',
			reportProgress: (phase, ratio, detail, current, total) => callbacks.onProgress(
				65 + ratio * 30,
				detail,
				current,
				total,
				{ phase: phase === 'encoding' ? 'Encoding GIF' : 'Building palette' }
			),
			isCancelled: callbacks.isCancelled
		});
		return encoded.blob;
	}
}
