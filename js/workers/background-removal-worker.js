'use strict';

/* global ort */
importScripts('../vendor/background-removal/ort.webgpu.min.js?v=f249207a');

let session;
const progress = label => self.postMessage({ type: 'progress', label });

async function loadModel(config) {
	progress('Downloading background remover');
	const cache = typeof caches !== 'undefined' ? await caches.open(config.cacheName).catch(() => null) : null;
	const parts = [];
	for (let index = 0; index < config.modelUrls.length; index++) {
		const url = config.modelUrls[index];
		let response = await cache?.match(url);
		if (!response) {
			response = await fetch(url);
			if (!response.ok) throw new Error('Could not download the background remover. Check your connection and try again.');
			if (cache) await cache.put(url, response.clone()).catch(() => {});
		}
		parts.push(await response.arrayBuffer());
		progress(`Downloading background remover (${index + 1}/${config.modelUrls.length})`);
	}
	const model = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) { model.set(new Uint8Array(part), offset); offset += part.byteLength; }
	return model;
}

async function removeBackground(blob, config) {
	if (!session) {
		ort.env.wasm.wasmPaths = { mjs: config.runtimeModule, wasm: config.runtimePath + 'ort-wasm-simd-threaded.jsep.wasm' };
		ort.env.wasm.numThreads = 1;
		const model = await loadModel(config);
		progress('Preparing background remover');
		if (self.navigator.gpu && await self.navigator.gpu.requestAdapter()) {
			try { session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }); }
			catch (_) { /* Quantized operators may need the WASM provider. */ }
		}
		if (!session) session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
	}
	progress('Removing background…');
	const image = await createImageBitmap(blob);
	try {
		const size = config.inputSize;
		const input = new OffscreenCanvas(size, size);
		const ctx = input.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(image, 0, 0, size, size);
		const pixels = ctx.getImageData(0, 0, size, size).data;
		const count = size * size;
		const data = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			data[i] = pixels[i * 4] / 255 - 0.5;
			data[count + i] = pixels[i * 4 + 1] / 255 - 0.5;
			data[count * 2 + i] = pixels[i * 4 + 2] / 255 - 0.5;
		}
		const tensor = new ort.Tensor('float32', data, [1, 3, size, size]);
		const outputs = await session.run({ [session.inputNames[0]]: tensor });
		try {
			const output = outputs[session.outputNames[0]];
			const values = output.data;
			let min = Infinity, max = -Infinity;
			for (let i = 0; i < count; i++) { min = Math.min(min, values[i]); max = Math.max(max, values[i]); }
			const mask = ctx.createImageData(size, size);
			for (let i = 0; i < count; i++) {
				mask.data[i * 4] = mask.data[i * 4 + 1] = mask.data[i * 4 + 2] = 255;
				mask.data[i * 4 + 3] = Math.round((values[i] - min) / Math.max(1e-8, max - min) * 255);
			}
			ctx.putImageData(mask, 0, 0);
			// Preserve native dimensions, RGB and existing alpha for history and reuse.
			const result = new OffscreenCanvas(image.width, image.height);
			const resultCtx = result.getContext('2d');
			resultCtx.drawImage(image, 0, 0);
			resultCtx.globalCompositeOperation = 'destination-in';
			resultCtx.drawImage(input, 0, 0, image.width, image.height);
			return await result.convertToBlob({ type: 'image/png' });
		} finally {
			tensor.dispose();
			Object.values(outputs).forEach(output => output.dispose());
		}
	} finally { image.close(); }
}

self.onmessage = async ({ data }) => {
	try { self.postMessage({ type: 'result', blob: await removeBackground(data.blob, data.config) }); }
	catch (error) {
		console.warn('Background removal failed:', error);
		const message = error?.message || '';
		self.postMessage({ type: 'error', message: message.startsWith('Could not download')
			? message : 'Background removal could not finish. Try a smaller image or reload and try again.' });
	}
};
