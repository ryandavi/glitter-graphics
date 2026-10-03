function getCommittedRasterScale(editor, layer) {
	const transform = getLayerManagerForType(editor, layer.type)?.layerTransforms?.get(layer.id);
	const group = editor.groupTransformManager;
	const groupEntry = group?.isDraggingHandle ? group.dragStartState?.layerStates?.find(entry => entry.layer.id === layer.id) : null;
	const scale = transform?.isDraggingHandle ? transform.dragStartState?.transform?.scale : transform?.gestureInteractionActive ? transform.gestureStartScale : groupEntry?.scale;
	return scale || layer.transform.scale;
}

// Logical layout stays stable; only paint masks acquire the transform scale.
function getRasterMeasurement(layer, measurement) {
	if (!LAYER_UI_CONFIG[layer.type]?.rasterizesScale || measurement.rasterScale) return measurement;
	const sx = measurement.paintScale?.x / 100 || layer.transform.scale.x / 100;
	const sy = measurement.paintScale?.y / 100 || layer.transform.scale.y / 100;
	if (sx === 1 && sy === 1) return measurement;
	const key = `${measurement.key}|raster:${sx}:${sy}`;
	if (measurement._rasterCache?.key === key) return measurement._rasterCache;
	const width = Math.max(1, Math.ceil(measurement.width * sx));
	const height = Math.max(1, Math.ceil(measurement.height * sy));
	const dx = (width - measurement.width * sx) / 2;
	const dy = (height - measurement.height * sy) / 2;
	const raster = { ...measurement, key, width, height, rasterScale: { x: sx, y: sy }, _borderMaskCache: null, _backgroundMaskCache: null, _bevelMaskCache: null, _rasterCache: null };
	const draw = (source, painter) => {
		const canvas = createAppCanvas(width, height, 'paint/mask-raster');
		canvas._rasterScale = { x: sx, y: sy };
		canvas._textureOrigin = { x: (source._textureOrigin?.x || 0) * sx + dx, y: (source._textureOrigin?.y || 0) * sy + dy };
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.translate(dx, dy);
		ctx.scale(sx, sy);
		if (painter) painter(ctx); else ctx.drawImage(source, 0, 0);
		if (shouldUseCrispMaskEdges()) binarizeCanvasAlpha(ctx);
		return canvas;
	};
	raster.canvas = draw(measurement.canvas, measurement.drawMask);
	raster.emojiCanvas = measurement.emojiCanvas ? draw(measurement.emojiCanvas) : null;
	raster.lettersCanvas = raster.canvas;
	if (raster.emojiCanvas) {
		raster.lettersCanvas = createMaskCanvasLike(raster.canvas);
		const ctx = raster.lettersCanvas.getContext('2d');
		ctx.drawImage(raster.canvas, 0, 0);
		ctx.globalCompositeOperation = 'destination-out';
		ctx.drawImage(raster.emojiCanvas, 0, 0);
	}
	raster.drawMask = (ctx, method) => {
		ctx.save(); ctx.translate(dx, dy); ctx.scale(sx, sy);
		measurement.drawMask(ctx, method); ctx.restore();
	};
	raster.drawBackground = ctx => {
		ctx.save(); ctx.translate(dx, dy); ctx.scale(sx, sy);
		renderTextBackgroundGeometry(ctx, measurement.textBackgroundGeometry); ctx.restore();
	};
	['layoutX', 'shapeW'].forEach(key => { if (Number.isFinite(measurement[key])) raster[key] = measurement[key] * sx + (key === 'layoutX' ? dx : 0); });
	['layoutY', 'shapeH'].forEach(key => { if (Number.isFinite(measurement[key])) raster[key] = measurement[key] * sy + (key === 'layoutY' ? dy : 0); });
	if (measurement.shapePath) {
		raster.shapePath = new Path2D();
		raster.shapePath.addPath(measurement.shapePath, new DOMMatrix([sx, 0, 0, sy, 0, 0]));
	}
	measurement._rasterCache = raster;
	return raster;
}

// Shared mask-edge policy for brush stamps, text, and shapes. Softness and
// flow remain source semantics; this switch controls raster edge antialiasing.
function shouldUseCrispMaskEdges() {
	return PREFERENCES.get('crispMaskEdges');
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
