'use strict';

function encodeCanvasToBlob(canvas, mimeType, quality) {
	return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob.type === mimeType ? blob : new Blob([blob], { type: mimeType })) : reject(new Error(`${mimeType} encoder produced no file.`)), mimeType, quality));
}

class StillImageExporter {
	constructor(frameComposer, resultPresenter, gifEncodingPipeline = new GifEncodingPipeline()) { this.frameComposer = frameComposer; this.resultPresenter = resultPresenter; this.gifEncodingPipeline = gifEncodingPipeline; this.fileName = `${CONFIG.export.core.defaultBaseName}.png`; }
	setFileName(fileName) { if (fileName) this.fileName = fileName; }
	async process(params) {
		params = { ...params, callbacks: { ...params.callbacks, progressFormat: 'still' } };
		const { target, callbacks, exportSettings } = params;
		const composed = await this.frameComposer.composeFrameAt(params);
		const canvas = createAppCanvas(0, 0, 'export/StillImageExporter'); canvas.width = composed.width; canvas.height = composed.height;
		const ctx = canvas.getContext('2d', { alpha: target.supportsTransparency });
		if (!target.supportsTransparency || !exportSettings.transparency) { ctx.fillStyle = exportSettings.matteColor; ctx.fillRect(0, 0, canvas.width, canvas.height); }
		ctx.putImageData(composed.imageData, 0, 0);
		let blob;
		if (target.format === 'png') { reportExportProgress(callbacks, 'encoding', 0, '', 1, 1); blob = await encodeCanvasToBlob(canvas, target.mimeType); }
		else if (target.format === 'jpeg') blob = await this._encodeJpeg(canvas, exportSettings, callbacks);
		else blob = await this._encodeGif(composed, exportSettings, callbacks);
		if (callbacks.isCancelled?.()) throw new Error('Export cancelled');
		reportExportProgress(callbacks, 'finalizing', 1); callbacks.onStatus('Export complete!');
		const file = new File([blob], this.fileName, { type: target.mimeType, lastModified: Date.now() });
		callbacks.onComplete({ still: true }); this.resultPresenter.show({ blob, file, target, width: composed.width, height: composed.height }); return blob;
	}
	async _encodeJpeg(canvas, settings, callbacks) {
		reportExportProgress(callbacks, 'encoding', 0.95, '', 1, 1);
		return encodeCanvasToBlob(canvas, 'image/jpeg', settings.jpegQuality / 100);
	}
	async _encodeGif(composed, settings, callbacks) {
		reportExportProgress(callbacks, 'palette', 0);
		const encoded = await this.gifEncodingPipeline.encode({
			frames: [composed.imageData],
			settings,
			transparency: composed.transparency,
			mode: 'still',
			reportProgress: (phase, ratio, detail, current, total) => reportExportProgress(callbacks, phase, ratio, detail, current, total),
			isCancelled: callbacks.isCancelled
		});
		return encoded.blob;
	}
}
