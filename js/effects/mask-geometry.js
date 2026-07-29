'use strict';

// Border resolution and mask morphology live here so preview and export
// cannot acquire independent geometry policies.
const BORDER_PLACEMENTS = Object.freeze(['outside', 'center', 'inside']);

function getBorderPlacement(borderData) {
	return BORDER_PLACEMENTS.includes(borderData?.placement) ? borderData.placement : 'outside';
}

function getBorderEdgeStyle(borderData) {
	return borderData?.edgeStyle === 'hard' ? 'hard' : 'round';
}

function getBorderDrawOrder(borderData) {
	return borderData?.drawOrder === 'front' ? 'front' : 'behind';
}

function getBorderOutsidePadding(borderData, { miterLimit = 1 } = {}) {
	const widthPx = Math.max(0, borderData?.widthPx || 0);
	const multiplier = getBorderEdgeStyle(borderData) === 'hard' ? Math.max(1, miterLimit) : 1;
	switch (getBorderPlacement(borderData)) {
		case 'inside':
			return 0;
		case 'center':
			return Math.ceil((widthPx / 2) * multiplier);
		default:
			return Math.ceil(widthPx * multiplier);
	}
}

function copyMaskTextureOrigin(targetCanvas, sourceCanvas) {
	const sourceOrigin = sourceCanvas?._textureOrigin || { x: 0, y: 0 };
	targetCanvas._textureOrigin = { ...sourceOrigin };
}

function createMaskCanvasLike(sourceCanvas) {
	const canvas = document.createElement('canvas');
	canvas.width = sourceCanvas.width;
	canvas.height = sourceCanvas.height;
	copyMaskTextureOrigin(canvas, sourceCanvas);
	return canvas;
}

function createMaskDifferenceCanvas(baseCanvas, subtractCanvas) {
	const canvas = createMaskCanvasLike(baseCanvas);
	const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
	ctx.drawImage(baseCanvas, 0, 0);
	if (subtractCanvas) {
		ctx.globalCompositeOperation = 'destination-out';
		ctx.drawImage(subtractCanvas, 0, 0);
		ctx.globalCompositeOperation = 'source-over';
	}
	return canvas;
}

function createDilatedMaskCanvas(sourceCanvas, radius, edgeStyle = 'round') {
	const nextRadius = Math.max(0, Math.round(radius));
	if (nextRadius <= 0) return sourceCanvas;

	if (edgeStyle === 'hard') {
		const horizontal = createMaskCanvasLike(sourceCanvas);
		const horizontalCtx = horizontal.getContext('2d', { willReadFrequently: true, alpha: true });
		for (let offsetX = -nextRadius; offsetX <= nextRadius; offsetX++) {
			horizontalCtx.drawImage(sourceCanvas, offsetX, 0);
		}
		const canvas = createMaskCanvasLike(sourceCanvas);
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
		for (let offsetY = -nextRadius; offsetY <= nextRadius; offsetY++) {
			ctx.drawImage(horizontal, 0, offsetY);
		}
		return canvas;
	}

	const canvas = createMaskCanvasLike(sourceCanvas);
	const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
	ctx.drawImage(sourceCanvas, 0, 0);
	getMorphOffsets(nextRadius).forEach((offset) => {
		ctx.drawImage(sourceCanvas, offset.x, offset.y);
	});
	return canvas;
}

function createErodedMaskCanvas(sourceCanvas, radius, edgeStyle = 'round') {
	const nextRadius = Math.max(0, Math.round(radius));
	if (nextRadius <= 0) return sourceCanvas;

	if (edgeStyle === 'hard') {
		const horizontal = createMaskCanvasLike(sourceCanvas);
		const horizontalCtx = horizontal.getContext('2d', { willReadFrequently: true, alpha: true });
		horizontalCtx.drawImage(sourceCanvas, 0, 0);
		horizontalCtx.globalCompositeOperation = 'destination-in';
		for (let offsetX = -nextRadius; offsetX <= nextRadius; offsetX++) {
			if (offsetX !== 0) horizontalCtx.drawImage(sourceCanvas, -offsetX, 0);
		}
		horizontalCtx.globalCompositeOperation = 'source-over';

		const canvas = createMaskCanvasLike(sourceCanvas);
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
		ctx.drawImage(horizontal, 0, 0);
		ctx.globalCompositeOperation = 'destination-in';
		for (let offsetY = -nextRadius; offsetY <= nextRadius; offsetY++) {
			if (offsetY !== 0) ctx.drawImage(horizontal, 0, -offsetY);
		}
		ctx.globalCompositeOperation = 'source-over';
		return canvas;
	}

	const canvas = createMaskCanvasLike(sourceCanvas);
	const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
	ctx.drawImage(sourceCanvas, 0, 0);
	ctx.globalCompositeOperation = 'destination-in';
	getMorphOffsets(nextRadius).forEach((offset) => {
		ctx.drawImage(sourceCanvas, -offset.x, -offset.y);
	});
	ctx.globalCompositeOperation = 'source-over';
	return canvas;
}

function getMorphOffsets(widthPx) {
	const radius = Math.max(1, widthPx);
	const borderSampling = CONFIG.rendering.borderSampling;
	const steps = Math.max(
		borderSampling.minSteps,
		Math.min(borderSampling.maxSteps, Math.ceil(radius * borderSampling.stepsPerPixel))
	);
	const seen = new Set();
	const offsets = [];
	for (let index = 0; index < steps; index++) {
		const angle = (Math.PI * 2 * index) / steps;
		const x = Math.round(Math.cos(angle) * radius);
		const y = Math.round(Math.sin(angle) * radius);
		const key = `${x},${y}`;
		if (seen.has(key) || (x === 0 && y === 0)) continue;
		seen.add(key);
		offsets.push({ x, y });
	}
	return offsets;
}
