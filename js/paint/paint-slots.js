'use strict';

// Paint slots: the fills, borders, shadows and backgrounds a layer paints
// with. Each layer type declares its slots once, back to front, in its
// registerLayerType definition (js/layers/types/). Anything that needs to know
// which slots a layer has, where their data lives, or how they stack reads
// these helpers instead of listing slots per layer type.
//
// A slot declaration:
//   key            stable id; also the export source-key suffix and span key
//   role           'fill' | 'border' | 'shadow' | 'background'
//   path           where the slot object lives on the layer ('textData.fill')
//   enabledPath    optional toggle that must be truthy for the slot to count
//   draftPath      optional parked copy kept while the effect is switched off
//   glitterDefault CONFIG.tools.glitter.defaults key used to repair a missing glitter
//   wholeLayer     the slot is the layer's only paint: it covers the canvas,
//                  uses the layer opacity and exports under the layer id
//   sourceLabel    export source label suffix (null for none; defaults to key)
//   countsAsEffect false keeps the slot's color adjust out of the Effects badge
//   framePadding   (data) => px the slot paints outside the layer frame
//   documentPixels pixel fields rescaled with the document:
//                  { hostPath?, fields?, signedFields?, minimum? }

const PAINT_SLOT_ROLES = Object.freeze(['fill', 'border', 'shadow', 'background']);

function splitPaintSlotPath(path) {
	return path ? Object.freeze(String(path).split('.')) : null;
}

function readPaintSlotPath(root, keys) {
	if (!keys) return null;
	let value = root;
	for (const key of keys) {
		if (value == null) return null;
		value = value[key];
	}
	return value ?? null;
}

function normalizePaintSlotDefinition(definition, type) {
	if (!definition?.key || !PAINT_SLOT_ROLES.includes(definition.role) || !definition.path) {
		throw new Error(`Invalid paint slot on layer type ${type}`);
	}
	const documentPixels = definition.documentPixels
		? Object.freeze({
			...definition.documentPixels,
			hostKeys: splitPaintSlotPath(definition.documentPixels.hostPath)
		})
		: null;
	return Object.freeze({
		...definition,
		pathKeys: splitPaintSlotPath(definition.path),
		enabledKeys: splitPaintSlotPath(definition.enabledPath),
		draftKeys: splitPaintSlotPath(definition.draftPath),
		documentPixels
	});
}

// A zero-width border is present (it keeps its settings and badge) but draws
// nothing. Every other slot draws whenever it is present.
function paintSlotRenders(definition, data) {
	if (!data) return false;
	return definition.role !== 'border' || Number(data.widthPx) > 0;
}

// present: the slot object exists and its toggle, if any, is on.
// renders: present and it would draw something.
// includeDrafts adds the parked copies of switched-off effects (present and
// renders are false for those), for passes that must reach every stored slot.
function getLayerPaintSlots(layer, { includeDrafts = false } = {}) {
	const definitions = LAYER_UI_CONFIG[layer?.type]?.paintSlots;
	if (!definitions?.length) return [];
	const entries = [];
	definitions.forEach((definition) => {
		const data = readPaintSlotPath(layer, definition.pathKeys);
		const present = Boolean(data) && (!definition.enabledKeys || Boolean(readPaintSlotPath(layer, definition.enabledKeys)));
		entries.push({
			key: definition.key,
			role: definition.role,
			definition,
			data,
			present,
			renders: present && paintSlotRenders(definition, data),
			draft: false
		});
		if (includeDrafts && definition.draftKeys) {
			const draft = readPaintSlotPath(layer, definition.draftKeys);
			if (draft && typeof draft === 'object') {
				entries.push({ key: definition.key, role: definition.role, definition, data: draft, present: false, renders: false, draft: true });
			}
		}
	});
	return entries;
}

function getLayerPaintSlot(layer, key) {
	const definition = LAYER_UI_CONFIG[layer?.type]?.paintSlots?.find((entry) => entry.key === key);
	return definition ? readPaintSlotPath(layer, definition.pathKeys) : null;
}

// The paint slot that fills a layer's own artwork. Glitter fill and canvas
// background layers are a single whole-layer paint.
function getLayerFillSlot(layer) {
	const definition = LAYER_UI_CONFIG[layer?.type]?.paintSlots?.find((entry) => entry.role === 'fill');
	return definition ? readPaintSlotPath(layer, definition.pathKeys) : null;
}

function getLayerFillGlitterId(layer) {
	return getLayerFillSlot(layer)?.glitterId ?? null;
}

function layerHasPaintSlotRole(layer, role) {
	return getLayerPaintSlots(layer).some((entry) => entry.role === role && entry.present);
}

function layerHasBorderEffect(layer) {
	return layerHasPaintSlotRole(layer, 'border');
}

function layerHasShadowEffect(layer) {
	return layerHasPaintSlotRole(layer, 'shadow');
}

function layerHasActiveColorAdjust(layer) {
	return getLayerPaintSlots(layer).some((entry) => entry.present
		&& entry.definition.countsAsEffect !== false
		&& entry.data.colorAdjust
		&& !isIdentityColorAdjust(entry.data.colorAdjust));
}

// Glitter ids a layer's present slots point at (drafts excluded), for asset
// preloading. Only slots in glitter mode count: a solid slot keeps its last
// glitter id for when the user switches back, but does not need it decoded.
function getLayerSlotGlitterIds(layer) {
	return getLayerPaintSlots(layer)
		.filter((entry) => entry.present && entry.data.mode === 'glitter' && entry.data.glitterId != null)
		.map((entry) => entry.data.glitterId);
}

// Export frame-source key for one slot. Whole-layer slots keep the bare layer
// id so their authored source keys match what earlier exports produced.
function getPaintSlotSourceKey(layer, entry) {
	return entry.definition.wholeLayer ? layer.id : `${layer.id}:${entry.key}`;
}

// Fill-role slots may be switched to None. Whole-layer slots fade with the
// layer opacity instead of a slot opacity.
function resolvePaintSlotSource(layer, entry, options = {}) {
	return resolveEffectPaintSource(entry.data, {
		allowNone: entry.role === 'fill',
		...(entry.definition.wholeLayer ? { opacity: layer.opacity } : {}),
		...options
	});
}

// The preview resolves a slot exactly like export, plus a live check that
// the glitter is in the library (a missing one shows the slot color).
function resolvePaintSlotPreviewSource(editor, layer, entry) {
	return resolvePaintSlotSource(layer, entry, {
		glitterAvailable: (glitterId) => Boolean(editor.glitterManager?.getItemById(glitterId)),
		imageResolver: (imageRef) => editor.shapeGlitterManager?.getImageFillAsset(imageRef)
	});
}

// Back-to-front paint order for one layer: declaration order, except that a
// border drawn in front of its fill moves after it. The DOM preview
// (reconcileSlotStack) and the export compositor (GifExporter) both read this
// list, so the ordering rules live here only. resolveSource(entry) returns a
// paint source or null to skip the slot.
function buildSlotStack(layer, resolveSource) {
	const stack = [];
	const front = [];
	getLayerPaintSlots(layer).forEach((entry) => {
		if (!entry.renders) return;
		const source = resolveSource(entry);
		if (!source) return;
		const isShadow = entry.role === 'shadow';
		const item = {
			key: entry.key,
			role: entry.role,
			definition: entry.definition,
			data: entry.data,
			source,
			sourceKey: getPaintSlotSourceKey(layer, entry),
			offsetX: isShadow ? (entry.data.offsetX || 0) : 0,
			offsetY: isShadow ? (entry.data.offsetY || 0) : 0
		};
		(entry.role === 'border' && getBorderDrawOrder(entry.data) === 'front' ? front : stack).push(item);
	});
	return stack.concat(front);
}

// Pixels the layer paints outside its own frame, for bounds tests.
function getLayerSlotFramePadding(layer) {
	return getLayerPaintSlots(layer).reduce((padding, entry) => (
		entry.renders && entry.definition.framePadding
			? Math.max(padding, entry.definition.framePadding(entry.data))
			: padding
	), 0);
}

// A sticker shadow is drawn on a canvas padded by its offset (plus a
// two-pixel margin) so the shifted silhouette is never clipped.
function getShadowCanvasPadding(shadow) {
	return Math.ceil(Math.max(Math.abs(shadow?.offsetX || 0), Math.abs(shadow?.offsetY || 0))) + 2;
}

// Displayed tile width of a glitter at 100% scale. The manifest width is
// authoritative; decoded frames only exist once the GIF has been parsed.
function getGlitterTileSize(glitter) {
	return glitter?.frames?.width || glitter?.width || 50;
}

// ===== DOM PREVIEW =====

// Paint one resolved source onto an element's background. Masks, offsets and
// whole-element opacity for the layer are the caller's job. maskCanvas
// supplies the texture origin and image-fill paint box; layer is only needed
// for canvas-anchored textures.
function applyPaintSourceToElement(element, source, options = {}) {
	const { glitterLibrary = null, layer = null, maskCanvas = null, localOffsetX = 0, localOffsetY = 0 } = options;
	const style = element.style;
	style.backgroundSize = '';
	style.backgroundPosition = '';
	style.backgroundRepeat = '';
	style.imageRendering = '';
	style.filter = '';
	element.classList.remove('pixelated');

	if (!source) {
		style.backgroundImage = 'none';
		style.backgroundColor = 'transparent';
		style.opacity = '1';
		return;
	}

	style.opacity = String(source.opacity ?? 1);

	if (source.mode === 'image') {
		const placement = getImageFillPlacement(source, maskCanvas?._paintBox);
		style.backgroundImage = `url(${source.url})`;
		style.backgroundColor = 'transparent';
		style.backgroundSize = `${placement.dw}px ${placement.dh}px`;
		style.backgroundPosition = `${placement.dx}px ${placement.dy}px`;
		style.backgroundRepeat = source.tile ? 'repeat' : 'no-repeat';
		style.imageRendering = source.imageRendering === 'pixelated' ? 'pixelated' : 'auto';
		return;
	}

	if (source.mode === 'solid' || source.mode === 'gradient') {
		style.backgroundImage = source.mode === 'gradient' ? effectGradientToCss(source.gradient) : 'none';
		style.backgroundColor = source.mode === 'solid' ? source.color : 'transparent';
		return;
	}

	const glitter = glitterLibrary?.getItemById(source.glitterId);
	if (!glitter) {
		applyPaintSourceToElement(element, { mode: 'solid', color: '#000000', opacity: 1 });
		return;
	}

	style.backgroundImage = `url(${glitter.url})`;
	style.backgroundColor = 'transparent';
	// CSS filter mirrors the export color-adjust matrix pass.
	style.filter = buildCssColorFilter(source.colorAdjust);
	style.backgroundSize = `${Math.round(getGlitterTileSize(glitter) * (source.scale ?? 100) / 100)}px`;
	const origin = getSlotTexturePatternOrigin(maskCanvas, source, layer, { localOffsetX, localOffsetY });
	style.backgroundPosition = `${origin.x}px ${origin.y}px`;
	style.backgroundRepeat = 'repeat';
	element.classList.toggle('pixelated', Boolean(glitter.isPixelated));
}

function applySlotSpanMask(span, width, height, maskUrl) {
	span.style.display = 'block';
	span.style.width = `${width}px`;
	span.style.height = `${height}px`;
	span.style.maskSize = `${width}px ${height}px`;
	span.style.maskRepeat = 'no-repeat';
	span.style.maskPosition = '0 0';
	span.style.webkitMaskSize = `${width}px ${height}px`;
	span.style.webkitMaskRepeat = 'no-repeat';
	span.style.webkitMaskPosition = '0 0';
	if (maskUrl) {
		span.style.maskImage = `url(${maskUrl})`;
		span.style.webkitMaskImage = `url(${maskUrl})`;
		span.style.visibility = '';
	} else {
		span.style.visibility = 'hidden';
	}
}

function applySlotSpanOffset(span, offsetX = 0, offsetY = 0) {
	const x = offsetX || 0;
	const y = offsetY || 0;
	span.style.transform = (x || y) ? `translate(${x}px, ${y}px)` : 'none';
}

// One span per stack item, keyed by slot key, in stack order. A shadow uses
// the unshifted artwork mask plus a live CSS translate so dragging its offset
// is cheap; export bakes the same offset into its mask instead.
// getMask(item) returns { canvas, url } or null to leave the slot out.
function reconcileSlotStack(stack, items, options) {
	const { spanClassName, width, height, layer, glitterLibrary, getMask } = options;
	const existing = new Map();
	Array.from(stack.children).forEach((child) => {
		if (child.dataset.spanKey) existing.set(child.dataset.spanKey, child);
	});

	items.forEach((item) => {
		const mask = getMask(item);
		if (!mask?.canvas) return;
		let span = existing.get(item.key);
		if (!span) {
			span = document.createElement('span');
			span.className = spanClassName;
			span.dataset.spanKey = item.key;
		}
		applySlotSpanMask(span, width, height, mask.url);
		applySlotSpanOffset(span, item.offsetX, item.offsetY);
		applyPaintSourceToElement(span, item.source, {
			glitterLibrary,
			layer,
			maskCanvas: mask.canvas,
			localOffsetX: item.offsetX,
			localOffsetY: item.offsetY
		});
		stack.appendChild(span);
		existing.delete(item.key);
	});

	existing.forEach((span) => span.remove());
}

// Canvas-anchored textures register against the document, so they move as the
// layer transform changes. Drags bypass the full render, so re-register them.
function syncSlotStackTextureOrigins(stack, items, layer, getMaskCanvas) {
	const spans = new Map(Array.from(stack.children).map((span) => [span.dataset.spanKey, span]));
	items.forEach((item) => {
		if (item.source?.mode !== 'glitter' || item.source.textureAnchor !== 'canvas') return;
		const span = spans.get(item.key);
		if (!span) return;
		const origin = getSlotTexturePatternOrigin(getMaskCanvas(item), item.source, layer, {
			localOffsetX: item.offsetX,
			localOffsetY: item.offsetY
		});
		span.style.backgroundPosition = `${origin.x}px ${origin.y}px`;
	});
}
