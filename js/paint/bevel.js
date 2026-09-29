'use strict';

// Bevel profiles describe the signed slope across the inner edge. Mask
// generation below is the only preview/export implementation.
const BEVEL_PROFILES = Object.freeze({
	smooth: Object.freeze({ id: 'smooth', label: 'Smooth', slope: (t) => Math.cos(t * Math.PI * 0.5) }),
	chisel: Object.freeze({ id: 'chisel', label: 'Chisel', slope: () => 1 }),
	pillow: Object.freeze({ id: 'pillow', label: 'Pillow', slope: (t) => -Math.cos(t * Math.PI * 0.5) }),
	emboss: Object.freeze({ id: 'emboss', label: 'Emboss', slope: (t) => Math.sin(t * Math.PI) }),
	gloss: Object.freeze({ id: 'gloss', label: 'Gloss', gloss: true })
});

function getBevelProfile(value) {
	return BEVEL_PROFILES[value] || BEVEL_PROFILES.smooth;
}

function normalizeBevelData(data) {
	if (!data) return data;
	data.size = clampFieldValue('bevelSize', data.size);
	data.depth = clampFieldValue('bevelDepth', data.depth);
	data.angle = clampFieldValue('bevelAngle', data.angle);
	data.altitude = clampFieldValue('bevelAltitude', data.altitude);
	data.soften = clampFieldValue('bevelSoften', data.soften);
	data.profile = getBevelProfile(data.profile).id;
	return data;
}

function clampFieldValue(key, value) {
	const spec = FIELDS[key];
	const number = Number(value);
	return Math.max(spec.min, Math.min(spec.max, Number.isFinite(number) ? number : spec.value));
}

function createBevelMaskCanvases(sourceCanvas, bevelData) {
	const data = normalizeBevelData({ ...bevelData });
	const field = createSignedDistanceField(sourceCanvas);
	const highlight = createMaskCanvasLike(sourceCanvas);
	const shade = createMaskCanvasLike(sourceCanvas);
	const highlightCtx = highlight.getContext('2d', { willReadFrequently: true, alpha: true });
	const shadeCtx = shade.getContext('2d', { willReadFrequently: true, alpha: true });
	const highlightImage = highlightCtx.createImageData(field.width, field.height);
	const shadeImage = shadeCtx.createImageData(field.width, field.height);
	const profile = getBevelProfile(data.profile);
	const depth = data.depth / 100;
	const soften = Math.max(0, data.soften);
	if (profile.gloss) {
		writeGlossMask(field, highlightImage, depth, soften);
		highlightCtx.putImageData(highlightImage, 0, 0);
		shadeCtx.putImageData(shadeImage, 0, 0);
		return Object.freeze({ highlight, shade });
	}
	const angle = data.angle * Math.PI / 180;
	const altitude = data.altitude * Math.PI / 180;
	const lightX = Math.cos(angle);
	const lightY = -Math.sin(angle);
	const lightStrength = Math.cos(altitude);
	const size = Math.max(1, data.size);
	const extent = size + soften;

	for (let y = 0; y < field.height; y++) {
		for (let x = 0; x < field.width; x++) {
			const index = y * field.width + x;
			const distance = field.distance[index];
			if (!field.inside[index] || distance > extent) continue;
			const left = field.distance[index - (x > 0 ? 1 : 0)];
			const right = field.distance[index + (x + 1 < field.width ? 1 : 0)];
			const up = field.distance[index - (y > 0 ? field.width : 0)];
			const down = field.distance[index + (y + 1 < field.height ? field.width : 0)];
			const gradientX = (right - left) * 0.5;
			const gradientY = (down - up) * 0.5;
			const gradientLength = Math.hypot(gradientX, gradientY) || 1;
			const t = Math.max(0, Math.min(1, distance / extent));
			const lighting = ((-gradientX / gradientLength) * lightX + (-gradientY / gradientLength) * lightY)
				* profile.slope(t) * lightStrength;
			const edgeFade = soften && distance > size ? Math.max(0, (extent - distance) / soften) : 1;
			const alpha = Math.round(Math.min(1, Math.abs(lighting) * depth * edgeFade) * 255);
			(lighting >= 0 ? highlightImage : shadeImage).data[index * 4 + 3] = alpha;
		}
	}
	highlightCtx.putImageData(highlightImage, 0, 0);
	shadeCtx.putImageData(shadeImage, 0, 0);
	return Object.freeze({ highlight, shade });
}

function writeGlossMask(field, image, depth, soften) {
	let minY = field.height;
	let maxY = -1;
	for (let index = 0; index < field.inside.length; index++) {
		if (!field.inside[index]) continue;
		const y = Math.floor(index / field.width);
		minY = Math.min(minY, y);
		maxY = Math.max(maxY, y);
	}
	if (maxY < minY) return;
	const cutoff = minY + (maxY - minY + 1) * 0.55;
	const fadeStart = cutoff - soften;
	for (let y = minY; y <= maxY; y++) {
		let strength = y < cutoff ? 1 : 0;
		if (soften && y > fadeStart && y < cutoff) strength = (cutoff - y) / soften;
		if (!strength) continue;
		for (let x = 0; x < field.width; x++) {
			const index = y * field.width + x;
			if (field.inside[index]) image.data[index * 4 + 3] = Math.round(strength * depth * 255);
		}
	}
}

