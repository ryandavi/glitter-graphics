// Shared mask-edge policy for brush stamps, text, and shapes. Softness and
// flow remain source semantics; this switch controls raster edge antialiasing.
function shouldUseCrispMaskEdges() {
	return CONFIG.rendering.crispMaskEdges !== false;
}

function binarizeCanvasAlpha(ctx, width = ctx.canvas.width, height = ctx.canvas.height) {
	const image = ctx.getImageData(0, 0, width, height);
	const pixels = image.data;
	const threshold = CONFIG.rendering.maskAlphaThreshold;
	for (let i = 3; i < pixels.length; i += 4) {
		pixels[i] = pixels[i] >= threshold ? 255 : 0;
	}
	ctx.putImageData(image, 0, 0);
}
