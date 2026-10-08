'use strict';

// Border resolution and mask morphology live here so preview and export
// cannot acquire independent geometry policies.
const BORDER_PLACEMENTS = Object.freeze(getOptionValues('borderPlacement'));
const BORDER_STYLES = Object.freeze(getOptionValues('borderStyle'));

function getBorderStyle(borderData) {
	return BORDER_STYLES.includes(borderData?.style) ? borderData.style : 'solid';
}

function getBorderPlacement(borderData) {
	return BORDER_PLACEMENTS.includes(borderData?.placement) ? borderData.placement : 'outside';
}

function getBorderEdgeStyle(borderData) {
	return isOptionValue('borderEdgeStyle', borderData?.edgeStyle) ? borderData.edgeStyle : 'round';
}

function getBorderDrawOrder(borderData) {
	return borderData?.drawOrder === 'front' ? 'front' : 'behind';
}

function getBorderOutsidePadding(borderData, { miterLimit = 1 } = {}) {
	const widthPx = Math.max(0, borderData?.widthPx || 0);
	const multiplier = getBorderEdgeStyle(borderData) === 'miter' ? Math.max(1, miterLimit) : 1;
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
	targetCanvas._rasterScale = sourceCanvas?._rasterScale;
}

function createMaskCanvasLike(sourceCanvas) {
	const canvas = createAppCanvas(0, 0, 'paint/mask-geometry');
	canvas.width = sourceCanvas.width;
	canvas.height = sourceCanvas.height;
	copyMaskTextureOrigin(canvas, sourceCanvas);
	return canvas;
}

// A same-size copy of the mask shifted by a shadow offset. The texture origin
// moves with it so the pattern stays registered to the shifted artwork.
function createOffsetMaskCanvas(sourceCanvas, offsetX, offsetY) {
	const canvas = createMaskCanvasLike(sourceCanvas);
	canvas._textureOrigin = {
		x: canvas._textureOrigin.x + offsetX,
		y: canvas._textureOrigin.y + offsetY
	};
	canvas.getContext('2d', { willReadFrequently: true }).drawImage(sourceCanvas, offsetX, offsetY);
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

// What an outside outline is cut away from. Cutting an antialiased outline
// along the exact silhouette leaves their shared edge pixels see-through (50%
// outline under 50% artwork covers only 75%), so the cutout is pulled in one
// pixel and the outline runs under the artwork's soft edge. The pull is a
// 3x3 alpha minimum: it removes an edge ramp but leaves an evenly translucent
// interior as it was. Crisp masks have no partial pixels and are cut exactly,
// and so is an outline with nothing drawn inside it (`underlap` false).
function createOutlineCutoutCanvas(sourceCanvas, underlap = true) {
	if (!underlap || shouldUseCrispMaskEdges()) return sourceCanvas;
	const { width, height } = sourceCanvas;
	if (!width || !height) return sourceCanvas;
	const source = sourceCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
	const canvas = createMaskCanvasLike(sourceCanvas);
	const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
	const image = ctx.createImageData(width, height);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		let alpha = 255;
		// Only pixels on the canvas count: a mask that runs off its canvas has
		// no edge there.
		for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1) && alpha; ny++) {
			for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
				alpha = Math.min(alpha, source[(ny * width + nx) * 4 + 3]);
			}
		}
		image.data[(y * width + x) * 4 + 3] = alpha;
	}
	ctx.putImageData(image, 0, 0);
	return canvas;
}

function createOutlineMaskCanvas(sourceCanvas, widthPx, edgeStyle = 'round', fillInterior = false, fillEnclosed = false, underlap = true) {
	const expanded = createDilatedMaskCanvas(sourceCanvas, widthPx, edgeStyle);
	const outline = fillInterior ? expanded : createMaskDifferenceCanvas(expanded, createOutlineCutoutCanvas(sourceCanvas, underlap));
	return fillEnclosed ? fillEnclosedMaskAreas(outline, sourceCanvas) : outline;
}

function createBorderMaskCanvas(sourceCanvas, borderData, { underlap = true } = {}) {
	const widthPx = Math.max(0, borderData?.widthPx || 0);
	if (!widthPx) return null;
	const placement = getBorderPlacement(borderData);
	const edgeStyle = getBorderEdgeStyle(borderData);
	let canvas;
	if (placement === 'inside') {
		canvas = createMaskDifferenceCanvas(sourceCanvas, createErodedMaskCanvas(sourceCanvas, widthPx, edgeStyle));
	} else if (placement === 'center') {
		canvas = createMaskDifferenceCanvas(
			createDilatedMaskCanvas(sourceCanvas, Math.ceil(widthPx / 2), edgeStyle),
			createErodedMaskCanvas(sourceCanvas, Math.floor(widthPx / 2), edgeStyle)
		);
	} else {
		canvas = createOutlineMaskCanvas(sourceCanvas, widthPx, edgeStyle, false, false, underlap);
	}
	if (borderData?.fillEnclosed) fillEnclosedMaskAreas(canvas, sourceCanvas);
	return canvas;
}

// Canvas transforms scale strokeText's width as well as its glyphs. A contour
// of the settled vector raster lets its outline be stroked in physical pixels.
function createMaskContourPath(canvas) {
	const { width, height } = canvas;
	const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
	const edges = new Map();
	const stride = width + 1;
	const occupied = (x, y) => x >= 0 && x < width && y >= 0 && y < height && pixels[(y * width + x) * 4 + 3] >= CONFIG.rendering.maskAlphaThreshold;
	const add = (x, y, nx, ny) => {
		const key = y * stride + x;
		if (!edges.has(key)) edges.set(key, []);
		edges.get(key).push(ny * stride + nx);
	};
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		if (!occupied(x, y)) continue;
		if (!occupied(x, y - 1)) add(x, y, x + 1, y);
		if (!occupied(x + 1, y)) add(x + 1, y, x + 1, y + 1);
		if (!occupied(x, y + 1)) add(x + 1, y + 1, x, y + 1);
		if (!occupied(x - 1, y)) add(x, y + 1, x, y);
	}
	const simplify = points => {
		const keep = new Set([0, points.length - 1]);
		const pending = [[0, points.length - 1]];
		const toleranceSquared = CONFIG.rendering.maskContourTolerancePx ** 2;
		while (pending.length) {
			const [first, last] = pending.pop();
			const a = points[first], b = points[last];
			const dx = b.x - a.x, dy = b.y - a.y;
			const length = dx * dx + dy * dy;
			let maximum = toleranceSquared, winner = -1;
			for (let index = first + 1; index < last; index++) {
				const point = points[index];
				const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
				const distance = (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2;
				if (distance > maximum) { maximum = distance; winner = index; }
			}
			if (winner >= 0) { keep.add(winner); pending.push([first, winner], [winner, last]); }
		}
		return points.filter((point, index) => keep.has(index));
	};
	const path = new Path2D();
	while (edges.size) {
		const start = edges.keys().next().value;
		let current = start;
		const points = [];
		do {
			points.push({ x: current % stride, y: Math.floor(current / stride) });
			const outgoing = edges.get(current);
			if (!outgoing?.length) break;
			current = outgoing.pop();
			if (!outgoing.length) edges.delete(points.at(-1).y * stride + points.at(-1).x);
		} while (current !== start);
		if (points.length < 3) continue;
		points.push(points[0]);
		const contour = simplify(points);
		path.moveTo(contour[0].x, contour[0].y);
		contour.slice(1).forEach(point => path.lineTo(point.x, point.y));
		path.closePath();
	}
	return path;
}

// Keep edge-connected transparency open while adding every closed counter to
// an effect mask. Reachability is tested against the completed effect plus its
// source silhouette, so a thick outline can close a region that was open in
// the source without turning the source artwork itself into outline paint.
// Four-neighbor reachability matches the mask's pixel grid: diagonal contact
// alone does not make an enclosed letter counter open.
function fillEnclosedMaskAreas(targetCanvas, sourceCanvas) {
	const width = sourceCanvas.width;
	const height = sourceCanvas.height;
	if (!width || !height || targetCanvas.width !== width || targetCanvas.height !== height) return targetCanvas;
	const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
	const source = sourceCtx.getImageData(0, 0, width, height).data;
	const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
	const target = targetCtx.getImageData(0, 0, width, height);
	const threshold = CONFIG.rendering.maskAlphaThreshold;
	const outside = new Uint8Array(width * height);
	const queue = new Int32Array(width * height);
	let head = 0;
	let tail = 0;
	const isOccupied = (index) => source[index * 4 + 3] >= threshold || target.data[index * 4 + 3] >= threshold;
	const addOutside = (index) => {
		if (outside[index] || isOccupied(index)) return;
		outside[index] = 1;
		queue[tail++] = index;
	};
	for (let x = 0; x < width; x++) {
		addOutside(x);
		addOutside((height - 1) * width + x);
	}
	for (let y = 1; y < height - 1; y++) {
		addOutside(y * width);
		addOutside(y * width + width - 1);
	}
	while (head < tail) {
		const index = queue[head++];
		const x = index % width;
		if (x > 0) addOutside(index - 1);
		if (x + 1 < width) addOutside(index + 1);
		if (index >= width) addOutside(index - width);
		if (index + width < outside.length) addOutside(index + width);
	}
	for (let index = 0; index < outside.length; index++) {
		if (!isOccupied(index) && !outside[index]) target.data[index * 4 + 3] = 255;
	}
	targetCtx.putImageData(target, 0, 0);
	return targetCanvas;
}

function createDilatedMaskCanvas(sourceCanvas, radius, edgeStyle = 'round') {
	const nextRadius = Math.max(0, Math.round(radius));
	if (nextRadius <= 0) return sourceCanvas;

	if (edgeStyle === 'hard' || edgeStyle === 'miter') {
		return createCrossMorphCanvas(sourceCanvas, nextRadius, 'dilate', edgeStyle === 'miter');
	}

	return createDistanceThresholdMaskCanvas(sourceCanvas, -nextRadius);
}

// How far a shadow's silhouette reaches past the mask it is cast from.
function getShadowReach(shadow) {
	return Math.max(0, Number(shadow?.spread) || 0) + Math.max(0, Number(shadow?.blur) || 0);
}

function getShadowKind(data) {
	return isOptionValue('shadowKind', data?.kind) ? data.kind : 'drop';
}

function getShadowSlotOffset(data) {
	return getShadowKind(data) !== 'drop' ? { x: 0, y: 0 } : { x: Number(data?.offsetX) || 0, y: Number(data?.offsetY) || 0 };
}

function getShadowMaskKey(data) {
	return [getShadowKind(data), data.offsetX, data.offsetY, data.spread, data.blur, data.castLength, data.castLean, data.castLengthRatio, data.castLeanRatio, data.castBlurRatio, getCastShadowAnchor(data)].join(':');
}

function getCastShadowAnchor(data) {
	return isOptionValue('shadowCastAnchor', data?.castAnchor) ? data.castAnchor : 'bottom';
}

function getCastShadowGeometry(box, data) {
	const { length, lean } = getCastShadowProjection(data, box);
	const baseline = getCastShadowAnchor(data) === 'baseline' && Number.isFinite(box.baseline) ? box.baseline : box.y + box.height;
	const height = Math.max(1, baseline - box.y);
	return { baseline, shear: lean / height, scaleY: length / height };
}

// Cast projects a copy onto the floor behind the artwork. The chosen anchor
// stays fixed; its top projects by Lean and up by Length, in physical pixels.
function getCastShadowProjection(data, box) {
	if (box?.castSize && data.castLengthRatio != null) {
		return { length: Math.max(0, data.castLengthRatio) * box.castSize.y, lean: data.castLeanRatio * box.castSize.x };
	}
	const length = Math.max(FIELDS.shadowCastLength.min, Math.min(FIELDS.shadowCastLength.max, Number(data?.castLength ?? FIELDS.shadowCastLength.value)));
	const lean = Math.max(FIELDS.shadowCastLean.min, Math.min(FIELDS.shadowCastLean.max, Number(data?.castLean ?? FIELDS.shadowCastLean.value)));
	return { lean, length };
}

function getCastShadowBlur(box, data) {
	return box?.castSize && data.castBlurRatio != null
		? Math.max(0, data.castBlurRatio) * Math.sqrt(box.castSize.x * box.castSize.y)
		: Math.max(0, Number(data?.blur) || 0);
}

function getShadowSlotBounds(box, data) {
	const kind = getShadowKind(data);
	if (kind === 'cast') {
		const { length } = getCastShadowProjection(data, box);
		if (!length || !box.height) return { x: box.x, y: box.y, width: 0, height: 0 };
		const { baseline, shear, scaleY } = getCastShadowGeometry(box, data);
		const topShift = shear * (baseline - box.y);
		const bottomShift = shear * (baseline - box.y - box.height);
		const blur = getCastShadowBlur(box, data);
		return {
			x: box.x + Math.min(topShift, bottomShift) - blur,
			y: baseline + scaleY * (box.y - baseline) - blur,
			width: box.width + Math.abs(topShift - bottomShift) + blur * 2,
			height: box.height * scaleY + blur * 2
		};
	}
	const vector = { x: Number(data?.offsetX) || 0, y: Number(data?.offsetY) || 0 };
	const swept = kind === 'extrude';
	const reach = getShadowReach(data);
	return {
		x: box.x + (swept ? Math.min(0, vector.x) : vector.x) - reach,
		y: box.y + (swept ? Math.min(0, vector.y) : vector.y) - reach,
		width: box.width + (swept ? Math.abs(vector.x) : 0) + reach * 2,
		height: box.height + (swept ? Math.abs(vector.y) : 0) + reach * 2
	};
}

function createExtrudedMaskCanvas(source, offsetX, offsetY) {
	const canvas = createMaskCanvasLike(source);
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	const steps = Math.ceil(Math.max(Math.abs(offsetX), Math.abs(offsetY)));
	for (let step = 0; step <= steps; step++) {
		const fraction = steps ? step / steps : 0;
		ctx.drawImage(source, Math.round(offsetX * fraction), Math.round(offsetY * fraction));
	}
	return canvas;
}

function createShadowSlotMaskCanvas(source, data) {
	const kind = getShadowKind(data);
	if (kind === 'cast') {
		const canvas = createMaskCanvasLike(source);
		const box = source._shadowBounds;
		const { length } = getCastShadowProjection(data, box);
		if (!length || !box?.height) return canvas;
		const { baseline, shear, scaleY } = getCastShadowGeometry(box, data);
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.setTransform(1, 0, -shear, scaleY, shear * baseline, baseline * (1 - scaleY));
		ctx.drawImage(source, 0, 0);
		ctx.resetTransform();
		if (shouldUseCrispMaskEdges()) binarizeCanvasAlpha(ctx);
		return createShadowMaskCanvas(canvas, 0, getCastShadowBlur(box, data));
	}
	const mask = createShadowMaskCanvas(source, Number(data?.spread) || 0, Number(data?.blur) || 0);
	return kind === 'extrude'
		? createExtrudedMaskCanvas(mask, Number(data?.offsetX) || 0, Number(data?.offsetY) || 0)
		: mask;
}

// A shadow's silhouette: the mask grown by `spread`, then, with `blur`, faded
// out over the next `blur` px, so offset 0 plus blur is a soft glow. The fade
// reads the signed distance field (exact, one pass, no canvas filter, so it
// is the same in every browser and in export). Hard shadows keep the plain
// dilation.
function createShadowMaskCanvas(sourceCanvas, spread = 0, blur = 0) {
	const radius = Math.max(0, Math.round(spread));
	const soft = Math.max(0, Math.round(blur));
	if (!soft) return createDilatedMaskCanvas(sourceCanvas, radius, 'round');
	const field = createSignedDistanceField(sourceCanvas);
	const canvas = createMaskCanvasLike(sourceCanvas);
	const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
	const image = ctx.createImageData(canvas.width, canvas.height);
	for (let index = 0; index < field.distance.length; index++) {
		const beyond = -field.distance[index] - radius;
		if (beyond <= 0) {
			image.data[index * 4 + 3] = 255;
			continue;
		}
		if (beyond >= soft) continue;
		// Cosine ease, squared: full at the edge, a long faint tail like a
		// gaussian glow, and exactly zero at `soft`.
		const ease = 0.5 + 0.5 * Math.cos(Math.PI * beyond / soft);
		image.data[index * 4 + 3] = Math.round(255 * ease * ease);
	}
	ctx.putImageData(image, 0, 0);
	return canvas;
}

function createErodedMaskCanvas(sourceCanvas, radius, edgeStyle = 'round') {
	const nextRadius = Math.max(0, Math.round(radius));
	if (nextRadius <= 0) return sourceCanvas;

	if (edgeStyle === 'hard' || edgeStyle === 'miter') {
		return createCrossMorphCanvas(sourceCanvas, nextRadius, 'erode', edgeStyle === 'miter');
	}

	return createDistanceThresholdMaskCanvas(sourceCanvas, nextRadius, true);
}

// Exact squared Euclidean distance transform (Felzenszwalb-Huttenlocher).
// The returned field is positive inside the thresholded silhouette and
// negative outside. Soft effect masks (bevel/gloss) deliberately consume the
// unbinarized values they derive from this field; silhouette masks do not.
function createSignedDistanceField(sourceCanvas, alphaThreshold = null, antialias = false) {
	const width = sourceCanvas.width;
	const height = sourceCanvas.height;
	const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
	const rgba = ctx.getImageData(0, 0, width, height).data;
	const inside = new Uint8Array(width * height);
	const threshold = Number.isFinite(alphaThreshold) ? alphaThreshold : (CONFIG.rendering.maskAlphaThreshold);
	for (let index = 0; index < inside.length; index++) inside[index] = rgba[index * 4 + 3] >= threshold ? 1 : 0;
	const nearestInside = antialias ? new Int32Array(inside.length) : null;
	const nearestOutside = antialias ? new Int32Array(inside.length) : null;
	const toInside = exactEuclideanDistanceTransform(inside, width, height, 1, nearestInside);
	const toOutside = exactEuclideanDistanceTransform(inside, width, height, 0, nearestOutside);
	const distance = new Float32Array(width * height);
	for (let index = 0; index < distance.length; index++) {
		distance[index] = inside[index] ? Math.sqrt(toOutside[index]) : -Math.sqrt(toInside[index]);
		if (antialias) {
			const alpha = rgba[index * 4 + 3] / 255;
			const nearest = inside[index] ? nearestOutside[index] : nearestInside[index];
			const boundaryAlpha = nearest >= 0 ? rgba[nearest * 4 + 3] / 255 : (inside[index] ? 0 : 1);
			distance[index] = alpha > 0 && alpha < 1 ? alpha - 0.5 : distance[index] + boundaryAlpha - 0.5;
		}
	}
	return Object.freeze({ width, height, distance, inside });
}

function exactEuclideanDistanceTransform(binary, width, height, targetValue, nearest = null) {
	const infinity = Infinity;
	let targetCount = 0;
	for (let index = 0; index < binary.length; index++) targetCount += binary[index] === targetValue ? 1 : 0;
	if (!targetCount) { nearest?.fill(-1); return new Float64Array(width * height).fill(infinity); }
	const scratch = new Float64Array(width * height);
	const sites = nearest ? new Int32Array(width * height) : null;
	const indices = nearest ? new Int32Array(Math.max(width, height)) : null;
	const output = new Float64Array(width * height);
	const maxLength = Math.max(width, height);
	const f = new Float64Array(maxLength);
	const d = new Float64Array(maxLength);
	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) f[y] = binary[y * width + x] === targetValue ? 0 : infinity;
		distanceTransform1D(f, d, height, indices);
		for (let y = 0; y < height; y++) {
			scratch[y * width + x] = d[y];
			if (sites) sites[y * width + x] = indices[y] * width + x;
		}
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) f[x] = scratch[y * width + x];
		distanceTransform1D(f, d, width, indices);
		for (let x = 0; x < width; x++) {
			output[y * width + x] = d[x];
			if (nearest) nearest[y * width + x] = sites[y * width + indices[x]];
		}
	}
	return output;
}

function distanceTransform1D(f, d, length, indices = null) {
	const v = new Int32Array(length);
	const z = new Float64Array(length + 1);
	let first = 0;
	while (first < length && !Number.isFinite(f[first])) first++;
	if (first === length) {
		d.fill(Infinity, 0, length);
		indices?.fill(-1, 0, length);
		return;
	}
	let k = 0;
	v[0] = first;
	z[0] = -Infinity;
	z[1] = Infinity;
	for (let q = first + 1; q < length; q++) {
		if (!Number.isFinite(f[q])) continue;
		// Recompute the intersection after every pop; z[0] = -Infinity stops it.
		const intersect = (p) => ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
		let s = intersect(v[k]);
		while (s <= z[k]) {
			k--;
			s = intersect(v[k]);
		}
		k++;
		v[k] = q;
		z[k] = s;
		z[k + 1] = Infinity;
	}
	k = 0;
	for (let q = 0; q < length; q++) {
		while (z[k + 1] < q) k++;
		const delta = q - v[k];
		d[q] = delta * delta + f[v[k]];
		if (indices) indices[q] = v[k];
	}
}

function createDistanceThresholdMaskCanvas(sourceCanvas, threshold, erode = false) {
	const crisp = shouldUseCrispMaskEdges();
	const field = createSignedDistanceField(sourceCanvas, null, !crisp);
	const canvas = createMaskCanvasLike(sourceCanvas);
	const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
	const image = ctx.createImageData(canvas.width, canvas.height);
	for (let index = 0; index < field.distance.length; index++) {
		const filled = erode ? field.distance[index] > threshold : field.distance[index] >= threshold;
		image.data[index * 4 + 3] = crisp ? (filled ? 255 : 0) : Math.round(255 * Math.max(0, Math.min(1, 0.5 + field.distance[index] - threshold)));
	}
	ctx.putImageData(image, 0, 0);
	return canvas;
}

function createCrossMorphCanvas(sourceCanvas, radius, operation, square = false) {
	const buffers = [createMaskCanvasLike(sourceCanvas), createMaskCanvasLike(sourceCanvas)];
	let current = sourceCanvas;
	for (let step = 0; step < radius; step++) {
		const canvas = buffers[step % buffers.length];
		const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(current, 0, 0);
		ctx.globalCompositeOperation = operation === 'erode' ? 'destination-in' : 'source-over';
		ctx.drawImage(current, -1, 0);
		ctx.drawImage(current, 1, 0);
		ctx.drawImage(current, 0, -1);
		ctx.drawImage(current, 0, 1);
		if (square) {
			ctx.drawImage(current, -1, -1); ctx.drawImage(current, 1, -1);
			ctx.drawImage(current, -1, 1); ctx.drawImage(current, 1, 1);
		}
		ctx.globalCompositeOperation = 'source-over';
		current = canvas;
	}
	return current;
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
