'use strict';

// Vector tip rasterization and its cache do not depend on the editor.
function drawRoundBrushStamp(ctx, size, softness) {
	const radius = size / 2;
	const innerRadius = radius * (1 - softness);

	if (innerRadius >= radius) {
		// Softness 0: hard-edged circle. A radial gradient with equal inner
		// and outer radius is degenerate and paints nothing per spec.
		ctx.fillStyle = 'rgba(255, 255, 255, 1)';
		ctx.beginPath();
		ctx.arc(radius, radius, radius, 0, Math.PI * 2);
		ctx.fill();
	} else {
		const gradient = ctx.createRadialGradient(radius, radius, innerRadius, radius, radius, radius);
		gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
		gradient.addColorStop(Math.max(0.001, innerRadius / radius), 'rgba(255, 255, 255, 1)');
		gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, size, size);
	}
}

function drawShapeBrushStamp(ctx, shape, size, softness) {
	const radius = size / 2;
	const blurPx = softness * radius * 0.8;
	const shapeRadius = Math.max(1, radius - blurPx);

	ctx.save();
	ctx.translate(radius, radius);
	ctx.fillStyle = 'rgba(255, 255, 255, 1)';
	// Geometry lives in ShapeLibrary (shared with the Shape tool). trace() fills
	// the shape itself. Brush stamps are uniform → same half-extent for W and H.
	ShapeLibrary.trace(shape, ctx, shapeRadius, shapeRadius);
	ctx.restore();
	if (blurPx > 0.01) {
		const feathered = createShadowMaskCanvas(ctx.canvas, 0, blurPx);
		ctx.clearRect(0, 0, size, size);
		ctx.drawImage(feathered, 0, 0);
		ctx.save();
		ctx.globalCompositeOperation = 'source-in';
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, size, size);
		ctx.restore();
	}
}

class BrushStampCache {
	clear() {
		this.stampCacheKey = '';
		this.stampCanvas = null;
	}
	get(shape, size, softnessPercent) {
		// Flow (and pressure) are applied as globalAlpha at draw time instead of
		// being baked in here, since pressure varies per-stamp along a stroke.

		const key = [shape, size, softnessPercent, shouldUseCrispMaskEdges(), CONFIG.rendering.maskAlphaThreshold].join(
			'|'
		);
		if (this.stampCacheKey === key && this.stampCanvas) {
			return this.stampCanvas;
		}

		const softness = softnessPercent / 100;
		const canvas = createAppCanvas(0, 0, 'paint/brush-stamp');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });

		if (shape === 'round') {
			drawRoundBrushStamp(ctx, size, softness);
		} else {
			drawShapeBrushStamp(ctx, shape, size, softness);
		}
		if (softness === 0 && shouldUseCrispMaskEdges()) {
			binarizeCanvasAlpha(ctx);
		}

		this.stampCanvas = canvas;
		this.stampCacheKey = key;
		return canvas;
	}
}
