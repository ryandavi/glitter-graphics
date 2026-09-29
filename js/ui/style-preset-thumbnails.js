'use strict';

// Style preset thumbnails drawn by the real renderer. Each look is applied to
// a throwaway sample layer (never added to the document), its slot masks come
// from the layer type's own manager (renderSlotMasks, the export path), and
// the slot stack is painted back to front like SceneCompositor paints it. So
// a tile shows what the preset really does at a default layer's size, where
// the CSS sketch in style-presets.js only guessed (an outline wider than the
// shadow offset hides that shadow on canvas, which a sketch can't know).
//
// Glitter paints its GIF's first frame. Stickers have no sample artwork to
// render, so their tiles keep the sketch.

const STYLE_PREVIEW_SIZE = Object.freeze({ width: 192, height: 72, pad: 6 });
const STYLE_PREVIEW_CACHE = new Map();
const STYLE_PREVIEW_IMAGES = new Map();

function getStylePreviewManager(editor, type) {
	if (type === LayerType.TEXT_GLITTER) return editor.textGlitterManager;
	if (type === LayerType.SHAPE) return editor.shapeGlitterManager;
	return null;
}

function createStylePreviewLayer(manager, type, entry) {
	const layer = {
		id: `style-preview:${type}:${entry.id}`,
		type,
		name: '',
		visible: true,
		locked: false,
		opacity: FIELDS.layerOpacity.value,
		transform: createDefaultTransform({ position: { x: 0, y: 0 } })
	};
	if (type === LayerType.TEXT_GLITTER) {
		layer.textData = {
			text: 'Aa',
			fontId: CONFIG.tools.text.defaultFontId,
			fontWeight: CONFIG.tools.text.defaultFontWeight || 400,
			fontStyle: 'normal',
			textCase: 'none',
			fontSize: FIELDS.textFontSize.value,
			letterSpacing: 0,
			lineHeight: 1,
			align: 'center',
			verticalAlign: 'top',
			boxMode: 'auto',
			width: 0,
			height: 0,
			border: null,
			shadow: null
		};
	} else {
		const shapeId = 'heart';
		const sized = manager.sizeForShape(shapeId, CONFIG.tools.shapes.defaultSize * 0.6);
		layer.shapeData = {
			shapeId,
			width: sized.width,
			height: sized.height,
			fill: manager.getDefaultFill(),
			border: null,
			shadow: null,
			bevel: manager.getDefaultBevel()
		};
	}
	manager.normalizeLayer(layer);
	return layer;
}

function loadStylePreviewImage(url) {
	if (!STYLE_PREVIEW_IMAGES.has(url)) {
		STYLE_PREVIEW_IMAGES.set(url, new Promise((resolve) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = () => resolve(null);
			image.src = url;
		}));
	}
	return STYLE_PREVIEW_IMAGES.get(url);
}

// One slot's paint over a surface the mask's size (as SceneCompositor's
// _renderFilledMaskInto sizes it), then kept only where the mask is. Returns
// false when a glitter isn't loaded yet, so the tile isn't cached with a
// stand-in color.
async function paintStylePreviewSlot(editor, surface, mask, source) {
	surface.width = mask.width;
	surface.height = mask.height;
	const ctx = surface.getContext('2d');
	ctx.globalAlpha = source.opacity ?? 1;
	if (source.mode === 'gradient') {
		ctx.fillStyle = createEffectCanvasGradient(ctx, source.gradient, { x: 0, y: 0, width: surface.width, height: surface.height });
	} else if (source.mode === 'glitter') {
		const url = editor.glitterLibrary?.getItemById(source.glitterId)?.url;
		const image = url ? await loadStylePreviewImage(url) : null;
		if (!image) return false;
		const pattern = ctx.createPattern(image, 'repeat');
		const scale = Math.max(1, source.scale || 100) / 100;
		pattern.setTransform(new DOMMatrix().scaleSelf(scale, scale));
		ctx.fillStyle = pattern;
	} else {
		ctx.fillStyle = source.color || '#000000';
	}
	ctx.fillRect(0, 0, surface.width, surface.height);
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'destination-in';
	ctx.drawImage(mask, 0, 0);
	ctx.globalCompositeOperation = 'source-over';
	return true;
}

// The painted pixels' box, so the tile frames the look, not the padding.
function getStylePreviewInkBox(canvas) {
	const { width, height } = canvas;
	const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
	let left = width;
	let top = height;
	let right = -1;
	let bottom = -1;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			if (pixels[(y * width + x) * 4 + 3] < 8) continue;
			if (x < left) left = x;
			if (x > right) right = x;
			if (y < top) top = y;
			if (y > bottom) bottom = y;
		}
	}
	return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

async function renderStylePresetPreview(editor, type, entry) {
	const manager = getStylePreviewManager(editor, type);
	const library = STYLE_PRESETS[type];
	if (!manager?.renderSlotMasks || !library) return null;
	const layer = createStylePreviewLayer(manager, type, entry);
	library.apply(entry, {
		layer,
		context: {
			getSlotDefaults: (key) => (manager.getSlotDefaults || manager.getEffectDefaults).call(manager, key),
			glitterAvailable: (glitterId) => Boolean(editor.glitterLibrary?.getItemById(glitterId))
		}
	});
	if (layer.textData?.fontId) await FontLibrary.ensureLoaded(layer.textData.fontId);
	const masks = await manager.renderSlotMasks(layer);
	const width = Math.max(1, Math.ceil(masks.renderWidth || masks.fill.width));
	const height = Math.max(1, Math.ceil(masks.renderHeight || masks.fill.height));
	const composite = createAppCanvas(width, height, 'ui/style-preset-thumbnails');
	const surface = createAppCanvas(0, 0, 'ui/style-preset-thumbnails');
	const tile = createAppCanvas(STYLE_PREVIEW_SIZE.width, STYLE_PREVIEW_SIZE.height, 'ui/style-preset-thumbnails');
	try {
		const compositeCtx = composite.getContext('2d');
		const stack = buildSlotStack(layer, (slot) => resolvePaintSlotPreviewSource(editor, layer, slot));
		for (const item of stack) {
			const mask = masks[item.key];
			if (!mask) continue;
			if (!await paintStylePreviewSlot(editor, surface, mask, item.source)) return null;
			compositeCtx.drawImage(surface, 0, 0, width, height);
		}
		const ink = getStylePreviewInkBox(composite);
		if (ink) {
			const { width: tileWidth, height: tileHeight, pad } = STYLE_PREVIEW_SIZE;
			const scale = Math.min((tileWidth - pad * 2) / ink.width, (tileHeight - pad * 2) / ink.height, 1.5);
			const drawWidth = ink.width * scale;
			const drawHeight = ink.height * scale;
			tile.getContext('2d').drawImage(composite, ink.x, ink.y, ink.width, ink.height,
				(tileWidth - drawWidth) / 2, (tileHeight - drawHeight) / 2, drawWidth, drawHeight);
		}
		return tile.toDataURL('image/png');
	} finally {
		[composite, surface, tile].forEach((canvas) => { canvas.width = canvas.height = 0; });
	}
}

// -> the cached data URL, or a promise of one (null when the sample can't be
// rendered yet, e.g. the glitter library is still loading; the tile keeps its
// sketch and the next grid render tries again).
function getStylePresetPreview(editor, type, entry) {
	const key = `${type}:${entry.id}`;
	if (!STYLE_PREVIEW_CACHE.has(key)) {
		const pending = renderStylePresetPreview(editor, type, entry)
			.catch((error) => {
				console.warn(`Style preset preview failed for ${entry.id}`, error);
				return null;
			})
			.then((url) => {
				if (url) STYLE_PREVIEW_CACHE.set(key, url);
				else STYLE_PREVIEW_CACHE.delete(key);
				return url;
			});
		STYLE_PREVIEW_CACHE.set(key, pending);
	}
	return STYLE_PREVIEW_CACHE.get(key);
}
