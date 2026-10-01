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

function createOutlineMaskCanvas(sourceCanvas, widthPx, edgeStyle = 'round', fillInterior = false, fillEnclosed = false) {
	const expanded = createDilatedMaskCanvas(sourceCanvas, widthPx, edgeStyle);
	const outline = fillInterior ? expanded : createMaskDifferenceCanvas(expanded, sourceCanvas);
	return fillEnclosed ? fillEnclosedMaskAreas(outline, sourceCanvas) : outline;
}

function createBorderMaskCanvas(sourceCanvas, borderData) {
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
		canvas = createOutlineMaskCanvas(sourceCanvas, widthPx, edgeStyle);
	}
	if (borderData?.fillEnclosed) fillEnclosedMaskAreas(canvas, sourceCanvas);
	return canvas;
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
	const threshold = CONFIG.rendering.maskAlphaThreshold ?? 128;
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

	if (edgeStyle === 'hard') {
		return createCrossMorphCanvas(sourceCanvas, nextRadius, 'dilate');
	}

	return createDistanceThresholdMaskCanvas(sourceCanvas, -nextRadius);
}

// How far a shadow's silhouette reaches past the mask it is cast from.
function getShadowReach(shadow) {
	return Math.max(0, Number(shadow?.spread) || 0) + Math.max(0, Number(shadow?.blur) || 0);
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

	if (edgeStyle === 'hard') {
		return createCrossMorphCanvas(sourceCanvas, nextRadius, 'erode');
	}

	return createDistanceThresholdMaskCanvas(sourceCanvas, nextRadius, true);
}

// Exact squared Euclidean distance transform (Felzenszwalb-Huttenlocher).
// The returned field is positive inside the thresholded silhouette and
// negative outside. Soft effect masks (bevel/gloss) deliberately consume the
// unbinarized values they derive from this field; silhouette masks do not.
function createSignedDistanceField(sourceCanvas, alphaThreshold = null) {
	const width = sourceCanvas.width;
	const height = sourceCanvas.height;
	const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
	const rgba = ctx.getImageData(0, 0, width, height).data;
	const inside = new Uint8Array(width * height);
	const threshold = Number.isFinite(alphaThreshold) ? alphaThreshold : (CONFIG.rendering.maskAlphaThreshold ?? 128);
	for (let index = 0; index < inside.length; index++) inside[index] = rgba[index * 4 + 3] >= threshold ? 1 : 0;
	const toInside = exactEuclideanDistanceTransform(inside, width, height, 1);
	const toOutside = exactEuclideanDistanceTransform(inside, width, height, 0);
	const distance = new Float32Array(width * height);
	for (let index = 0; index < distance.length; index++) {
		distance[index] = inside[index] ? Math.sqrt(toOutside[index]) : -Math.sqrt(toInside[index]);
	}
	return Object.freeze({ width, height, distance, inside });
}

function exactEuclideanDistanceTransform(binary, width, height, targetValue) {
	const infinity = Infinity;
	let targetCount = 0;
	for (let index = 0; index < binary.length; index++) targetCount += binary[index] === targetValue ? 1 : 0;
	if (!targetCount) return new Float64Array(width * height).fill(infinity);
	const scratch = new Float64Array(width * height);
	const output = new Float64Array(width * height);
	const maxLength = Math.max(width, height);
	const f = new Float64Array(maxLength);
	const d = new Float64Array(maxLength);
	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) f[y] = binary[y * width + x] === targetValue ? 0 : infinity;
		distanceTransform1D(f, d, height);
		for (let y = 0; y < height; y++) scratch[y * width + x] = d[y];
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) f[x] = scratch[y * width + x];
		distanceTransform1D(f, d, width);
		for (let x = 0; x < width; x++) output[y * width + x] = d[x];
	}
	return output;
}

function distanceTransform1D(f, d, length) {
	const v = new Int32Array(length);
	const z = new Float64Array(length + 1);
	let first = 0;
	while (first < length && !Number.isFinite(f[first])) first++;
	if (first === length) {
		d.fill(Infinity, 0, length);
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
	}
}

function createDistanceThresholdMaskCanvas(sourceCanvas, threshold, erode = false) {
	const field = createSignedDistanceField(sourceCanvas);
	const canvas = createMaskCanvasLike(sourceCanvas);
	const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
	const image = ctx.createImageData(canvas.width, canvas.height);
	for (let index = 0; index < field.distance.length; index++) {
		const filled = erode ? field.distance[index] > threshold : field.distance[index] >= threshold;
		image.data[index * 4 + 3] = filled ? 255 : 0;
	}
	ctx.putImageData(image, 0, 0);
	return canvas;
}

function createCrossMorphCanvas(sourceCanvas, radius, operation) {
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
