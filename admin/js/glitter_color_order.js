// A proposed order for a glitter wall: rainbow, then neutrals, then earth
// tones, with multicolor and pattern tiles last. It only suggests; the saved
// order is whatever the grid is arranged into.
const GLITTER_COLOR_ORDER_THRESHOLDS = Object.freeze({
	neutralSaturation: 0.16,
	mutedEarthSaturation: 0.55,
	paleCreamLightness: 0.78,
	lightNeutral: 0.65,
	darkNeutral: 0.12,
	lightEarth: 0.75,
	darkEarth: 0.4
});

// `item` has `colorCodes` (dominant first) and `tags` (names). The key is
// [band, negative lightness]; equal keys keep the order they came in.
function glitterColorOrder(item) {
	const endBand = (item.tags || []).some(tag => /^(multicolor|pattern)$/i.test(tag));
	const hex = item.colorCodes?.[0];
	if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return endBand ? [15, 0] : [10, 0];
	const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	const delta = max - min, lightness = (max + min) / 2;
	const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
	let hue = delta === 0 ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
	hue = (hue * 60 + 360) % 360;
	if (endBand) return [15, -lightness];
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
	return [band, -lightness];
}

function sortByGlitterColor(items) {
	const keys = new Map(items.map(item => [item, glitterColorOrder(item)]));
	return [...items].sort((a, b) => keys.get(a)[0] - keys.get(b)[0] || keys.get(a)[1] - keys.get(b)[1]);
}
