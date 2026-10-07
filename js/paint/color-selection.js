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
