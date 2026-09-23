'use strict';

// One GIF decoder for the app (omggif's GifReader underneath). Preview never
// decodes pixels: it shows the GIF file itself and reads its size from the
// manifest. Export decodes on demand (SceneCompositor), and code that only
// needs timing reads it with readGifTiming, which skips pixel decoding.

// Canonical frame duration: a missing or zero delay becomes the fallback, and
// nothing plays faster than 20 ms, which is what browsers do with such GIFs.
function normalizeFrameDuration(duration, fallback = 100) {
	const value = Number.isFinite(duration) && duration > 0 ? duration : fallback;
	return Math.max(20, Math.round(value || 100));
}

async function fetchGifBytes(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const arrayBuffer = await response.arrayBuffer();
	if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('Empty file');
	return new Uint8Array(arrayBuffer);
}

function openGifReader(bytes) {
	const reader = new GifReader(bytes);
	if (reader.numFrames() === 0) throw new Error('GIF has 0 frames');
	return reader;
}

function describeGifTiming(reader) {
	const frameCount = reader.numFrames();
	const frameDelays = [];
	for (let i = 0; i < frameCount; i++) {
		frameDelays.push(normalizeFrameDuration(reader.frameInfo(i).delay * 10, 100));
	}
	const averageDelay = frameDelays.reduce((sum, delay) => sum + delay, 0) / frameCount;
	return {
		width: reader.width,
		height: reader.height,
		frameCount,
		frameDelay: frameDelays[0],
		frameDelays,
		frameRate: Math.round((1000 / averageDelay) * 10) / 10,
		isVariableFramerate: new Set(frameDelays).size > 1
	};
}

// Size, frame count and per-frame delays, without decoding any pixels.
function readGifTiming(bytes) {
	return describeGifTiming(openGifReader(bytes));
}

// Decodes every frame. `layout` picks the frame shape:
//   'canvas'  { imageData } at the GIF's full size, with only this frame's
//             patch painted (layer replay composites these in order);
//   'patch'   { data } cropped to the frame's own rectangle (watermark replay
//             places it at x/y).
// Every frame also carries x, y, width, height (its patch) and disposal.
// `yieldEvery` frames, `onYield` is awaited so long decodes can report progress.
async function decodeGif(bytes, { layout = 'canvas', onProgress = null, yieldEvery = 0, onYield = null } = {}) {
	const reader = openGifReader(bytes);
	const timing = describeGifTiming(reader);
	const { width, height, frameCount } = timing;
	const frames = [];
	onProgress?.(0, frameCount);
	for (let i = 0; i < frameCount; i++) {
		const info = reader.frameInfo(i);
		const patchX = info.x || 0;
		const patchY = info.y || 0;
		const patchW = info.width || width;
		const patchH = info.height || height;
		const pixels = new Uint8ClampedArray(width * height * 4);
		reader.decodeAndBlitFrameRGBA(i, pixels);
		if (layout === 'patch') {
			const patch = new Uint8ClampedArray(patchW * patchH * 4);
			for (let y = 0; y < patchH; y++) {
				const rowStart = ((patchY + y) * width + patchX) * 4;
				patch.set(pixels.subarray(rowStart, rowStart + patchW * 4), y * patchW * 4);
			}
			frames.push({ data: patch, width: patchW, height: patchH, x: patchX, y: patchY, disposal: info.disposal });
		} else {
			frames.push({ imageData: new ImageData(pixels, width, height), disposal: info.disposal, x: patchX, y: patchY, width: patchW, height: patchH });
		}
		onProgress?.(i + 1, frameCount);
		if (onYield && yieldEvery > 0 && i + 1 < frameCount && (i + 1) % yieldEvery === 0) await onYield();
	}
	return { ...timing, frames };
}

async function decodeGifFromUrl(url, options) {
	return decodeGif(await fetchGifBytes(url), options);
}

// Decoded bytes held by a decodeGif result.
function getDecodedGifBytes(decoded) {
	return (decoded?.frames || []).reduce((sum, frame) => sum + (frame.imageData?.data.byteLength || frame.data?.byteLength || 0), 0);
}
