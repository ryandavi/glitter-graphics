'use strict';

// One GIF decoder for the app (omggif's GifReader underneath). Preview never
// decodes playing pixels: it shows the GIF file itself and reads its size from the
// manifest. Export decodes on demand (SceneCompositor), and code that only
// needs timing reads it with readGifTiming, which skips pixel decoding.
// Pause motion decodes only the first frame for a static preview texture.

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

function describeGifTiming(reader, bytes) {
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
		isVariableFramerate: new Set(frameDelays).size > 1,
		canRetime: findGifDelayOffsets(reader, bytes) != null
	};
}

// Where each frame's delay sits in the file: the two little-endian
// centisecond bytes of its Graphic Control Extension. Null when a frame has
// none, because a browser then plays that frame on a delay the file cannot
// state.
function findGifDelayOffsets(reader, bytes) {
	const offsets = [];
	let position = 13 + (bytes[10] & 0x80 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
	for (let index = 0; index < reader.numFrames(); index++) {
		const frame = reader.frameInfo(index);
		const descriptor = frame.data_offset - (frame.has_local_palette ? frame.palette_size * 3 : 0) - 10;
		let offset = null;
		while (position < descriptor && bytes[position] === 0x21) {
			if (bytes[position + 1] === 0xf9) offset = position + 4;
			position += 2;
			while (bytes[position]) position += bytes[position] + 1;
			position++;
		}
		if (offset == null) return null;
		offsets.push(offset);
		position = frame.data_offset + frame.data_length;
	}
	return offsets;
}

// The cycle lengths a GIF can be stretched to: on the delay grid, no frame
// under the minimum delay, inside the stretch range of the file's own cycle.
// Null for a still.
function getGifCycleRange(frameDurations) {
	const { gifDelayQuantumMs: quantum, gifMinimumDelayMs: minimumDelay } = CONFIG.export.timeline.renderClock;
	const stretch = CONFIG.tools.gifCycle.stretchRange;
	const cycle = frameDurations.reduce((sum, duration) => sum + duration, 0);
	const range = {
		min: Math.ceil(Math.max(frameDurations.length * minimumDelay, cycle * stretch.min) / quantum) * quantum,
		max: Math.floor(cycle * stretch.max / quantum) * quantum
	};
	return frameDurations.length > 1 && range.min <= range.max ? range : null;
}

// Scales delays to total exactly targetCycleMs on the GIF delay grid, none
// under the minimum delay. Frames keep their order and relative length; the
// units flooring leaves over go to the largest remainders, earlier frame
// first. Returns null when the target cannot be represented.
function retimeGifDelays(frameDurations, targetCycleMs) {
	const { gifDelayQuantumMs: quantum, gifMinimumDelayMs: minimumDelay } = CONFIG.export.timeline.renderClock;
	const cycle = frameDurations.reduce((sum, duration) => sum + duration, 0);
	if (targetCycleMs === cycle) return [...frameDurations];
	const minimumUnits = minimumDelay / quantum;
	const targetUnits = targetCycleMs / quantum;
	if (!Number.isInteger(targetUnits) || targetUnits < frameDurations.length * minimumUnits || !(cycle > 0)) return null;
	const ideal = frameDurations.map((duration) => duration * targetUnits / cycle);
	const units = ideal.map((value) => Math.max(minimumUnits, Math.floor(value)));
	let spare = targetUnits - units.reduce((sum, value) => sum + value, 0);
	// Frames lifted to the minimum can overspend the target; the frames
	// furthest over their share give that back.
	const order = (direction) => units.map((_, index) => index)
		.sort((left, right) => direction * ((units[right] - ideal[right]) - (units[left] - ideal[left])) || left - right);
	for (const index of spare > 0 ? order(-1) : []) {
		if (!spare) break;
		units[index]++;
		spare--;
	}
	while (spare < 0) {
		const index = order(1).find((candidate) => units[candidate] > minimumUnits);
		units[index]--;
		spare++;
	}
	return units.map((value) => value * quantum);
}

// A copy of the GIF with these delays written into its Graphic Control
// Extensions. Pixels, palettes, disposal and transparency are untouched.
// Returns null when a frame has no extension to write into.
function retimeGifBytes(bytes, frameDurations) {
	const reader = openGifReader(bytes);
	const offsets = findGifDelayOffsets(reader, bytes);
	if (!offsets || offsets.length !== frameDurations.length) return null;
	const quantum = CONFIG.export.timeline.renderClock.gifDelayQuantumMs;
	const output = new Uint8Array(bytes);
	offsets.forEach((offset, index) => {
		const delay = Math.round(frameDurations[index] / quantum);
		output[offset] = delay & 0xff;
		output[offset + 1] = delay >> 8;
	});
	return output;
}

// Size, frame count and per-frame delays, without decoding any pixels.
function readGifTiming(bytes) {
	return describeGifTiming(openGifReader(bytes), bytes);
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
	const timing = describeGifTiming(reader, bytes);
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
