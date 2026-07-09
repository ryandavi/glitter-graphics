// ============================================
// GLITTER COLOR ADJUST (hue / saturation / brightness)
// ============================================
// Single source of truth for the WP4 color-adjust math (docs/TOOL-EXPANSION-PLAN.md).
//
// The DOM preview applies buildCssColorFilter() as a CSS `filter`; the GIF
// exporter applies applyColorAdjustToImageData() per-pixel to the flattened
// frames. Both derive from the SAME Filter Effects spec definitions —
// hue-rotate and saturate are linear feColorMatrix operations, brightness is a
// linear feComponentTransfer slope, CSS shorthand filters operate in sRGB on
// non-premultiplied values — so the pixel pass matches the CSS filter exactly.
// ctx.filter is deliberately never used: unsupported on Safari/iOS, which is a
// supported export path.
//
// Canonical adjust shape (identity values; treat a missing/null adjust as identity):
//   { hue: 0 /* deg, -180..180 */, saturation: 100 /* % */, brightness: 100 /* % */ }
//
// Canonical operation order is hue-rotate -> saturate -> brightness. CSS applies
// a filter list left to right, so buildCssColorFilter() emits in that order and
// composeColorAdjustMatrix() multiplies in the same order. Keep them in lockstep.

const COLOR_ADJUST_IDENTITY = Object.freeze({ hue: 0, saturation: 100, brightness: 100 });

function normalizeColorAdjust(adjust) {
	return {
		hue: Number.isFinite(adjust?.hue) ? adjust.hue : COLOR_ADJUST_IDENTITY.hue,
		saturation: Number.isFinite(adjust?.saturation) ? adjust.saturation : COLOR_ADJUST_IDENTITY.saturation,
		brightness: Number.isFinite(adjust?.brightness) ? adjust.brightness : COLOR_ADJUST_IDENTITY.brightness
	};
}

function isIdentityColorAdjust(adjust) {
	const a = normalizeColorAdjust(adjust);
	return a.hue === 0 && a.saturation === 100 && a.brightness === 100;
}

// CSS filter string for the DOM preview. Returns '' for identity so callers can
// assign it straight to element.style.filter (empty string clears the filter).
function buildCssColorFilter(adjust) {
	const a = normalizeColorAdjust(adjust);
	const parts = [];
	if (a.hue !== 0) parts.push(`hue-rotate(${a.hue}deg)`);
	if (a.saturation !== 100) parts.push(`saturate(${a.saturation}%)`);
	if (a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`);
	return parts.join(' ');
}

// Row-major 3x3 matrix mapping [R,G,B] -> [R',G',B'] (no constant term: all
// three operations are purely linear). Alpha is untouched throughout.
function composeColorAdjustMatrix(adjust) {
	const a = normalizeColorAdjust(adjust);
	const s = a.saturation / 100;
	const b = a.brightness / 100;
	const rad = (a.hue * Math.PI) / 180;
	const c = Math.cos(rad);
	const n = Math.sin(rad);

	// feColorMatrix type="hueRotate" (Filter Effects spec, verbatim coefficients).
	const H = [
		0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928,
		0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.140, 0.072 - c * 0.072 - n * 0.283,
		0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072
	];

	// feColorMatrix type="saturate".
	const S = [
		0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
		0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
		0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s
	];

	// result = brightness(saturate(hueRotate(px)))  =>  M = b * (S x H)
	const M = new Float64Array(9);
	for (let row = 0; row < 3; row++) {
		for (let col = 0; col < 3; col++) {
			M[row * 3 + col] = b * (
				S[row * 3] * H[col] +
				S[row * 3 + 1] * H[3 + col] +
				S[row * 3 + 2] * H[6 + col]
			);
		}
	}
	return M;
}

// Mutates imageData in place (and returns it). No-op on identity, so callers
// can apply it unconditionally without cost for unadjusted glitter.
function applyColorAdjustToImageData(imageData, adjust) {
	if (isIdentityColorAdjust(adjust)) return imageData;

	const m = composeColorAdjustMatrix(adjust);
	const d = imageData.data;
	for (let i = 0; i < d.length; i += 4) {
		const r = d[i];
		const g = d[i + 1];
		const bl = d[i + 2];
		d[i] = Math.min(255, Math.max(0, Math.round(m[0] * r + m[1] * g + m[2] * bl)));
		d[i + 1] = Math.min(255, Math.max(0, Math.round(m[3] * r + m[4] * g + m[5] * bl)));
		d[i + 2] = Math.min(255, Math.max(0, Math.round(m[6] * r + m[7] * g + m[8] * bl)));
	}
	return imageData;
}

