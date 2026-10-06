// Color selection math is independent of asset browsing and layer rendering.
function selectionColorDistanceSq(r1, g1, b1, r2, g2, b2) {
	return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

function featherColorSelection(editor, mask, radius) {
	if (radius <= 0) return;

	const width = editor.originalCanvas.width;
	const height = editor.originalCanvas.height;
	const horizontal = new Float32Array(mask.length);

	for (let y = 0; y < height; y++) {
		const rowOffset = y * width;
		const prefix = new Uint32Array(width + 1);

		for (let x = 0; x < width; x++) {
			prefix[x + 1] = prefix[x] + mask[rowOffset + x];
		}

		for (let x = 0; x < width; x++) {
			const left = Math.max(0, x - radius);
			const right = Math.min(width - 1, x + radius);
			const count = right - left + 1;
			const sum = prefix[right + 1] - prefix[left];
			horizontal[rowOffset + x] = sum / count;
		}
	}

	for (let x = 0; x < width; x++) {
		const prefix = new Float32Array(height + 1);

		for (let y = 0; y < height; y++) {
			prefix[y + 1] = prefix[y] + horizontal[y * width + x];
		}

		for (let y = 0; y < height; y++) {
			const top = Math.max(0, y - radius);
			const bottom = Math.min(height - 1, y + radius);
			const count = bottom - top + 1;
			const sum = prefix[bottom + 1] - prefix[top];
			mask[y * width + x] = Math.round(sum / count);
		}
	}
}

function floodColorSelection(editor, mask, startX, startY, targetColor, thresholdSq) {
	const width = editor.originalCanvas.width;
	const height = editor.originalCanvas.height;
	const totalPixels = width * height;
	const data = editor.originalImageData.data;
	const alphaChannel = editor.originalAlphaChannel;

	// The stack contains the 1D index of the pixel
	const stack = [startY * width + startX];

	while (stack.length > 0) {
		const idx = stack.pop();

		// 1. Skip if this pixel is already marked in the mask
		if (mask[idx] === 255) continue;

		const r = data[idx * 4];
		const g = data[idx * 4 + 1];
		const b = data[idx * 4 + 2];
		const alpha = alphaChannel[idx];

		let isMatch = false;

		// 2. DECISION LOGIC: 
		// If we are looking for transparency vs looking for a specific color
		if (targetColor.isTransparent) {
			// Match only if the current pixel is also transparent
			isMatch = (alpha < CONFIG.tools.selection.transparency.alphaThreshold);
		} else {
			// Match only if the current pixel is OPAQUE and the color is within the threshold
			isMatch = (alpha >= CONFIG.tools.selection.transparency.alphaThreshold &&
				selectionColorDistanceSq(r, g, b, targetColor.r, targetColor.g, targetColor.b) <= thresholdSq);
		}

		if (isMatch) {
			// Mark the pixel as part of the mask
			mask[idx] = 255;

			// 3. ADD NEIGHBORS (Right, Left, Down, Up)
			// Check bounds to prevent wrapping around the edges of the image

			// Right
			if ((idx + 1) % width !== 0 && mask[idx + 1] === 0) {
				stack.push(idx + 1);
			}
			// Left
			if (idx % width !== 0 && mask[idx - 1] === 0) {
				stack.push(idx - 1);
			}
			// Down
			if (idx + width < totalPixels && mask[idx + width] === 0) {
				stack.push(idx + width);
			}
			// Up
			if (idx - width >= 0 && mask[idx - width] === 0) {
				stack.push(idx - width);
			}
		}
	}
}

function buildColorSelectionMask(editor, layer) {
	const buildStart = performance.now();
	const width = editor.originalCanvas.width;
	const height = editor.originalCanvas.height;
	const len = width * height;
	const mask = new Uint8Array(len);
	const thresholdSq = layer.settings.threshold * layer.settings.threshold;
	const data = editor.originalImageData.data;
	const alphaChannel = editor.originalAlphaChannel;

	layer.selections.forEach(sel => {
		if (layer.settings.contiguous) {
			const floodStart = performance.now();
			floodColorSelection(editor, mask, sel.x, sel.y, sel, thresholdSq);
			dbg(`[G-1] floodFill: ${(performance.now() - floodStart).toFixed(1)}ms`);
			return;
		}

		const scanStart = performance.now();
		for (let i = 0; i < len; i++) {
			if (mask[i] === 255) continue;

			if (sel.isTransparent) {
				if (alphaChannel[i] < CONFIG.tools.selection.transparency.alphaThreshold) {
					mask[i] = 255;
				}
				continue;
			}

			if (alphaChannel[i] < CONFIG.tools.selection.transparency.alphaThreshold) continue;

			const idx = i * 4;
			const r = data[idx];
			const g = data[idx + 1];
			const b = data[idx + 2];

			if (selectionColorDistanceSq(r, g, b, sel.r, sel.g, sel.b) <= thresholdSq) {
				mask[i] = 255;
			}
		}
		dbg(`[G-1] non-contiguous scan: ${(performance.now() - scanStart).toFixed(1)}ms`);
	});

	dbg(`[G-1] buildSelectionMask total: ${(performance.now() - buildStart).toFixed(1)}ms`);
	return mask;
}


const GLITTER_COLOR_ORDER_THRESHOLDS = Object.freeze({
	neutralSaturation: 0.16,
	mutedEarthSaturation: 0.55,
	paleCreamLightness: 0.78,
	lightNeutral: 0.65,
	darkNeutral: 0.12,
	lightEarth: 0.75,
	darkEarth: 0.4
});

// Keys are [band, end-band group, negative lightness]; equal keys preserve manifest order.
function glitterColorOrder(item) {
	const endBand = (item.tags || []).some(tag => /^(multicolor|pattern)$/i.test(tag));
	const endGroup = (item.tags || []).some(tag => /^christmas$/i.test(tag)) ? 1 : 0;
	const hex = item.colorCodes?.[0];
	if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return endBand ? [15, endGroup, 0] : [10, 0, 0];
	const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	const delta = max - min, lightness = (max + min) / 2;
	const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
	let hue = delta === 0 ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
	hue = (hue * 60 + 360) % 360;
	if (endBand) return [15, endGroup, -lightness];
	let band;
	// Low saturation stays neutral; warm muted colors and pale creams are earth tones.
	if (saturation < GLITTER_COLOR_ORDER_THRESHOLDS.neutralSaturation) band = lightness > GLITTER_COLOR_ORDER_THRESHOLDS.lightNeutral ? 8 : lightness > GLITTER_COLOR_ORDER_THRESHOLDS.darkNeutral ? 9 : 10;
	else if (hue >= 15 && hue <= 65 && (saturation < GLITTER_COLOR_ORDER_THRESHOLDS.mutedEarthSaturation || lightness > GLITTER_COLOR_ORDER_THRESHOLDS.paleCreamLightness)) band = lightness > GLITTER_COLOR_ORDER_THRESHOLDS.lightEarth ? 11 : lightness > GLITTER_COLOR_ORDER_THRESHOLDS.darkEarth ? 12 : hue < 45 ? 13 : 14;
	else if ((hue >= 300 && hue < 345) || (hue >= 345 && lightness > 0.65)) band = 0;
	else if (hue < 15 || hue >= 345) band = 1;
	else if (hue < 45) band = 2;
	else if (hue < 70) band = 3;
	else if (hue < 165) band = 4;
	else if (hue < 195) band = 5;
	else if (hue < 255) band = 6;
	else band = 7;
	return [band, 0, -lightness];
}

function sortByGlitterColor(items) {
	return [...items].sort((a, b) => {
		const left = a._glitterColorOrder || glitterColorOrder(a);
		const right = b._glitterColorOrder || glitterColorOrder(b);
		return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
	});
}
