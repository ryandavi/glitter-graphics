// Builds one animation-wide palette so stationary colors receive the same GIF
// index in every frame. This prevents the crawling noise caused by learning a
// separate palette for each frame before error-diffusion dithering.
class GifPalette {
	static resolveColorCount(value, analysis = null) {
		if (Number.isFinite(Number(value)) && [32, 64, 128, 256].includes(Number(value))) return Number(value);
		const observed = analysis?.observedColorCount || 0;
		if (observed && observed <= 64) return 64;
		if (observed && observed <= 512) return 128;
		return 256;
	}

	static build(frames, maximumColors = 128, { transparentColor = null, maxSamples = 262144, style = 'vivid' } = {}) {
		const histogram = new Map();
		const frameBudget = Math.max(1, Math.floor(maxSamples / Math.max(1, frames.length)));
		frames.forEach((frame) => {
			const pixelCount = frame.width * frame.height;
			const step = Math.max(1, Math.ceil(pixelCount / frameBudget));
			for (let pixel = 0; pixel < pixelCount; pixel += step) {
				const offset = pixel * 4;
				const r = frame.data[offset];
				const g = frame.data[offset + 1];
				const b = frame.data[offset + 2];
				const rgb = (r << 16) | (g << 8) | b;
				if (transparentColor !== null && rgb === transparentColor) continue;
				const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
				const entry = histogram.get(key) || { r: 0, g: 0, b: 0, count: 0 };
				const chroma = Math.max(r, g, b) - Math.min(r, g, b);
				const weight = style === 'vivid' ? 1 + chroma / 255 : (style === 'natural' ? 1 : 1 + chroma / 510);
				entry.r += r * weight;
				entry.g += g * weight;
				entry.b += b * weight;
				entry.count += weight;
				histogram.set(key, entry);
			}
		});

		const reserved = transparentColor === null ? 0 : 1;
		const target = Math.max(1, maximumColors - reserved);
		const colors = [...histogram.values()].map((entry) => ({
			r: entry.r / entry.count,
			g: entry.g / entry.count,
			b: entry.b / entry.count,
			count: entry.count
		}));
		let boxes = colors.length ? [colors] : [];
		while (boxes.length < target) {
			let splitIndex = -1;
			let splitChannel = 'r';
			let bestScore = -1;
			boxes.forEach((box, index) => {
				if (box.length < 2) return;
				const ranges = ['r', 'g', 'b'].map((channel) => {
					const values = box.map((color) => color[channel]);
					return { channel, range: Math.max(...values) - Math.min(...values) };
				});
				const widest = ranges.sort((a, b) => b.range - a.range)[0];
				const population = box.reduce((sum, color) => sum + color.count, 0);
				const score = widest.range * Math.sqrt(population);
				if (score > bestScore) {
					bestScore = score;
					splitIndex = index;
					splitChannel = widest.channel;
				}
			});
			if (splitIndex < 0) break;
			const box = boxes[splitIndex].sort((a, b) => a[splitChannel] - b[splitChannel]);
			const total = box.reduce((sum, color) => sum + color.count, 0);
			let cumulative = 0;
			let pivot = 1;
			for (; pivot < box.length; pivot++) {
				cumulative += box[pivot - 1].count;
				if (cumulative >= total / 2) break;
			}
			boxes.splice(splitIndex, 1, box.slice(0, pivot), box.slice(pivot));
		}

		const palette = [];
		if (transparentColor !== null) palette.push((transparentColor >> 16) & 255, (transparentColor >> 8) & 255, transparentColor & 255);
		const seen = new Set();
		if (transparentColor !== null) seen.add(transparentColor);
		boxes.forEach((box) => {
			const count = box.reduce((sum, color) => sum + color.count, 0) || 1;
			let rgb = [
				Math.round(box.reduce((sum, color) => sum + color.r * color.count, 0) / count),
				Math.round(box.reduce((sum, color) => sum + color.g * color.count, 0) / count),
				Math.round(box.reduce((sum, color) => sum + color.b * color.count, 0) / count)
			];
			if (style === 'websafe') rgb = rgb.map((channel) => Math.round(channel / 51) * 51);
			const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
			if (!seen.has(key)) {
				seen.add(key);
				palette.push(...rgb);
			}
		});
		return palette;
	}
}
