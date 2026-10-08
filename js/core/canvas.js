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
