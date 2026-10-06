// GIF frame worker: gif.js's encoder, plus the export dither ahead of it so the
// per-pixel dither runs off the main thread and across every encoder worker.
// GifEncodingPipeline passes { settings, config } as gif.js's `dither` option;
// gif.worker.js itself only ever sees `dither: false`.
importScripts('../effects/pixel-effects.js?v=dcb26229', 'gif.worker.js?v=638b1a97');

const encodeFrame = self.onmessage;
self.onmessage = (event) => {
	const task = event.data;
	if (task.dither && typeof task.dither === 'object') {
		const { settings, config } = task.dither;
		const palette = [];
		for (let offset = 0; offset < task.globalPalette.length; offset += 3) {
			palette.push([task.globalPalette[offset], task.globalPalette[offset + 1], task.globalPalette[offset + 2]]);
		}
		task.data = GlitterPixelEffects.applyPixelEffects(task.data, task.width, task.height, settings, config, task.index, palette);
		task.dither = false;
	}
	return encodeFrame(event);
};
