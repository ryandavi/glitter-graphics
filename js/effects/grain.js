(function (root) {
	const GRAIN_IDENTITY = Object.freeze({ amount: 0, size: 1, roughness: 0.5, monochrome: true });

	function clamp(value, minimum, maximum) {
		return Math.min(maximum, Math.max(minimum, value));
	}

	function normalizeGrain(value) {
		return {
			amount: clamp(Number(value?.amount) || 0, 0, 1),
			size: clamp(Number(value?.size) || 1, 0.25, 16),
			roughness: clamp(value?.roughness == null ? GRAIN_IDENTITY.roughness : Number(value.roughness), 0, 1),
			monochrome: value?.monochrome !== false
		};
	}

	function isIdentityGrain(value) {
		return normalizeGrain(value).amount <= 0;
	}

	function tileSignature(value, seed) {
		const grain = normalizeGrain(value);
		return `${grain.roughness}|${grain.monochrome}|${String(seed)}`;
	}

	function hashSeed(seed) {
		let hash = 2166136261;
		for (const character of String(seed)) {
			hash ^= character.charCodeAt(0);
			hash = Math.imul(hash, 16777619);
		}
		return hash >>> 0;
	}

	function createNoise(value, seed, tileSize = 256) {
		const grain = normalizeGrain(value);
		const baseSeed = hashSeed(seed);
		const randomAt = (x, y, channel, octave) => {
			let next = baseSeed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(channel + 1, 2246822519) ^ Math.imul(octave + 1, 3266489917);
			next = Math.imul(next ^ next >>> 13, 1274126177);
			return ((next ^ next >>> 16) >>> 0) / 4294967295;
		};
		const octave = (x, y, channel, cell, level) => {
			if (cell === 1) return randomAt(x, y, channel, level);
			const x0 = Math.floor(x / cell);
			const y0 = Math.floor(y / cell);
			const tx = (x % cell) / cell;
			const ty = (y % cell) / cell;
			const smoothX = tx * tx * (3 - 2 * tx);
			const smoothY = ty * ty * (3 - 2 * ty);
			const top = randomAt(x0, y0, channel, level) * (1 - smoothX) + randomAt(x0 + 1, y0, channel, level) * smoothX;
			const bottom = randomAt(x0, y0 + 1, channel, level) * (1 - smoothX) + randomAt(x0 + 1, y0 + 1, channel, level) * smoothX;
			return top * (1 - smoothY) + bottom * smoothY;
		};
		const data = new Uint8ClampedArray(tileSize * tileSize * 4);
		const contrast = 72 + grain.roughness * 183;
		for (let y = 0; y < tileSize; y++) for (let x = 0; x < tileSize; x++) {
			const index = (y * tileSize + x) * 4;
			for (let channel = 0; channel < 3; channel++) {
				const sourceChannel = grain.monochrome ? 0 : channel;
				const smooth = octave(x, y, sourceChannel, 16, 0);
				const medium = octave(x, y, sourceChannel, 4, 1);
				const harsh = octave(x, y, sourceChannel, 1, 2);
				const detail = smooth * (1 - grain.roughness) + (medium * 0.55 + harsh * 0.45) * grain.roughness;
				data[index + channel] = clamp(128 + (detail - 0.5) * contrast, 0, 255);
			}
			data[index + 3] = 255;
		}
		return data;
	}

	function buildTile(value, seed, tileSize = 256) {
		const Canvas = typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : null;
		const canvas = Canvas ? new Canvas(tileSize, tileSize) : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
		if (!canvas) {
			return { width: tileSize, height: tileSize, data: createNoise(value, seed, tileSize) };
		}
		canvas.width = tileSize;
		canvas.height = tileSize;
		const context = canvas.getContext('2d');
		context.putImageData(new ImageData(createNoise(value, seed, tileSize), tileSize, tileSize), 0, 0);
		return canvas;
	}

	const api = { GRAIN_IDENTITY, normalizeGrain, isIdentityGrain, tileSignature, createNoise, buildTile };
	root.GlitterGrain = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
