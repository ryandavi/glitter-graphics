'use strict';

function validateCanvasSize(width, height) {
	const limits = CONFIG.canvas.limits;
	if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isInteger(width) || !Number.isInteger(height)) return { ok: false, message: 'Enter valid whole-pixel width and height values.' };
	if (width < 1 || height < 1) return { ok: false, message: 'Canvas dimensions must be at least 1 × 1 px.' };
	if (width > limits.maxWidth || height > limits.maxHeight) return { ok: false, message: `Maximum canvas size is ${limits.maxWidth} × ${limits.maxHeight} px. Requested ${width} × ${height} px.` };
	return { ok: true, message: '' };
}

function createAppCanvas(width = 0, height = 0, owner = 'Canvas') {
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(0, Number(width) || 0);
	canvas.height = Math.max(0, Number(height) || 0);
	return typeof APP_MEMORY_LEDGER === 'undefined' ? canvas : APP_MEMORY_LEDGER.trackCanvas(canvas, owner);
}

function ensureCanvasSize(canvas, width, height) {
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
}

function resetCanvasContext(ctx, width, height, imageSmoothingEnabled = true) {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
	ctx.imageSmoothingEnabled = imageSmoothingEnabled;
	ctx.clearRect(0, 0, width, height);
}

// Draws `source` into `target` at a smaller size. Halving in steps through the
// two `scratch` canvases keeps the detail one bilinear pass would skip over.
function downscaleCanvas(source, target, width, height, scratch) {
	const draw = (from, fromWidth, fromHeight, to, toWidth, toHeight) => {
		ensureCanvasSize(to, toWidth, toHeight);
		const ctx = to.getContext('2d', { willReadFrequently: to === target });
		resetCanvasContext(ctx, toWidth, toHeight);
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(from, 0, 0, fromWidth, fromHeight, 0, 0, toWidth, toHeight);
	};
	let current = source;
	let currentWidth = source.width;
	let currentHeight = source.height;
	for (let turn = 0; currentWidth > width * 2 && currentHeight > height * 2; turn++) {
		const nextWidth = Math.ceil(currentWidth / 2);
		const nextHeight = Math.ceil(currentHeight / 2);
		draw(current, currentWidth, currentHeight, scratch[turn % 2], nextWidth, nextHeight);
		current = scratch[turn % 2];
		currentWidth = nextWidth;
		currentHeight = nextHeight;
	}
	draw(current, currentWidth, currentHeight, target, width, height);
	return target;
}
