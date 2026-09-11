(function (root) {
	const GRAIN_IDENTITY = Object.freeze({ amount: 0, size: 25, roughness: 0.5, monochrome: true });

	function clamp(value, minimum, maximum) {
		return Math.min(maximum, Math.max(minimum, value));
	}

	function normalizeGrain(value) {
		const size = Number(value?.size);
		return {
			amount: clamp(Number(value?.amount) || 0, 0, 1),
			size: clamp(Number.isFinite(size) ? size : GRAIN_IDENTITY.size, 0, 100),
			roughness: clamp(value?.roughness == null ? GRAIN_IDENTITY.roughness : Number(value.roughness), 0, 1),
			monochrome: value?.monochrome !== false
		};
	}

	function isIdentityGrain(value) {
		return normalizeGrain(value).amount <= 0;
	}

	function tileSignature(value, seed) {
		const grain = normalizeGrain(value);
		return `${grain.size}|${grain.roughness}|${grain.monochrome}|${String(seed)}`;
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
		const randomAt = (x, y, channel, salt) => {
			let next = baseSeed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(channel + 1, 2246822519) ^ Math.imul(salt + 1, 3266489917);
			next = Math.imul(next ^ next >>> 13, 1274126177);
			return ((next ^ next >>> 16) >>> 0) / 4294967295;
		};
		const smoothNoise = (x, y, channel, salt, cells) => {
			const gridX = x / tileSize * cells;
			const gridY = y / tileSize * cells;
			const x0 = Math.floor(gridX);
			const y0 = Math.floor(gridY);
			const tx = gridX - x0;
			const ty = gridY - y0;
			const easeX = tx * tx * (3 - 2 * tx);
			const easeY = ty * ty * (3 - 2 * ty);
			const wrap = (coordinate) => (coordinate % cells + cells) % cells;
			const top = randomAt(wrap(x0), wrap(y0), channel, salt) * (1 - easeX) + randomAt(wrap(x0 + 1), wrap(y0), channel, salt) * easeX;
			const bottom = randomAt(wrap(x0), wrap(y0 + 1), channel, salt) * (1 - easeX) + randomAt(wrap(x0 + 1), wrap(y0 + 1), channel, salt) * easeX;
			return top * (1 - easeY) + bottom * easeY;
		};
		const sizeMix = Math.pow(grain.size / 100, 0.7);
		const particlePx = 0.75 + Math.pow(grain.size / 100, 1.35) * 5.25;
		const particleCells = Math.max(12, Math.round(tileSize / particlePx));
		const data = new Uint8ClampedArray(tileSize * tileSize * 4);
		for (let y = 0; y < tileSize; y++) for (let x = 0; x < tileSize; x++) {
			const index = (y * tileSize + x) * 4;
			for (let channel = 0; channel < 3; channel++) {
				const sourceChannel = grain.monochrome ? 0 : channel;
				const fine = (randomAt(x, y, sourceChannel, 0) + randomAt(x, y, sourceChannel, 1) + randomAt(x, y, sourceChannel, 2)) / 3;
				const particle = (smoothNoise(x, y, sourceChannel, 3, particleCells) + smoothNoise(x, y, sourceChannel, 4, particleCells) + smoothNoise(x, y, sourceChannel, 5, particleCells)) / 3;
				const regular = fine * (1 - sizeMix) + particle * sizeMix;
				const irregular = randomAt(x, y, sourceChannel, 6);
				const clump = 0.8 + smoothNoise(x, y, sourceChannel, 7, 19) * 0.4;
				let detail = (regular - 0.5) * (1 - grain.roughness * 0.15) + (irregular - 0.5) * grain.roughness * 0.4;
				detail *= 1 + (clump - 1) * grain.roughness;
				data[index + channel] = clamp(128 + detail * 290, 0, 255);
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
