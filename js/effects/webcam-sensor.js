(function (root) {
	'use strict';

	// An early-2010s laptop webcam, simulated the way the camera made the
	// picture rather than as layers over it. The image is averaged down to the
	// sensor's own grid and every step runs there, in a cheap camera's order:
	//   lens         soft optics, so fine texture goes before edges do
	//   exposure     auto-exposure meters the middle of the frame; a dark scene
	//                gets gain (and with it more noise), bright areas clip
	//   sensor       noise in linear light, before gain: read noise plus shot
	//                noise, fresh per pixel for luma, broader for chroma, and
	//                slow colour blotches in the read noise. The gamma curve
	//                then lifts it most in the shadows, as on a real sensor.
	//   white bal.   gray-world that only partly corrects, so a scene's cast
	//                drifts warm or cool with its lighting
	//   tone         per channel: crushed blacks, a short shoulder, channels
	//                that clip one at a time (bright skin goes pale yellow)
	//   colour       a weak matrix: muted overall, reds and skin hold
	//   ISP          chroma smear, waxy noise reduction, crude sharpening
	//   JPEG         compressed at sensor size
	// and the result is stretched back to the image, as the camera's own
	// preview was. Sizes in a profile are sensor pixels, so the look holds at
	// any image size; on an image smaller than the sensor the noise averages
	// down the way a downscale would.
	//
	// Frame to frame: luma noise is new every frame, like a live sensor;
	// chroma noise and blotches ease between keys `chromaFrames` and
	// `blotchFrames` apart, so the colour drifts instead of flickering. A
	// still (frame 0) keeps one pattern per seed.
	//
	// Temporal effects (a profile's `temporal`) only run past frame 0, so a
	// still never shows them: ghosting blends in a share of the previous
	// frame (kept per seed and grid size, used only when it is the frame just
	// before), exposure flicker nudges the gain from frame to frame, and white
	// balance drifts slowly warm and cool.

	const GAMMA = 2.2;
	// Display input is looked up at 12 bits; linear sensor output at 14 bits
	// over 0 to TONE_MAX (white balance can lift a clipped channel past 1).
	const INPUT_LEVELS = 4095;
	const TONE_LEVELS = 16383;
	const TONE_MAX = 2;
	const toLinearLut = new Float32Array(INPUT_LEVELS + 1);
	for (let index = 0; index <= INPUT_LEVELS; index++) toLinearLut[index] = (index / INPUT_LEVELS) ** GAMMA;
	const inputIndex = (value) => value <= 0 ? 0 : value >= 1 ? INPUT_LEVELS : (value * INPUT_LEVELS + 0.5) | 0;

	const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
	const lerp = (from, to, amount) => from + (to - from) * amount;
	const smooth = (t) => t * t * (3 - 2 * t);

	function seedSalt(seed) {
		let state = 2166136261;
		for (const character of String(seed || '')) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
		return state | 0;
	}

	function hash(x, y, z, salt) {
		let h = salt ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x2c1b3c6d);
		h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
		h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
		return (h ^ (h >>> 16)) >>> 0;
	}

	// Roughly Gaussian with unit variance, from one hash: three 10-bit uniforms.
	const gauss = (h) => (((h & 1023) + ((h >>> 10) & 1023) + ((h >>> 20) & 1023)) / 1023 - 1.5) * 2;

	// A smooth random value in -1..1 along time: one hashed key every `frames`
	// frames, eased between.
	function drift(frame, frames, salt) {
		const time = frame / Math.max(1, frames), key = Math.floor(time), mix = smooth(time - key);
		const at = (index) => hash(index, 0, 0, salt) / 2147483648 - 1;
		return lerp(at(key), at(key + 1), mix);
	}

	// The last developed frame of each stream, for ghosting.
	const history = new Map();
	const HISTORY_LIMIT = 24;

	// Float scratch reused between renders; everything that reads it runs
	// before the first await, so overlapping renders can't share a buffer.
	const pool = new Map();
	function scratch(name, length) {
		let buffer = pool.get(name);
		if (!buffer || buffer.length !== length) { buffer = new Float32Array(length); pool.set(name, buffer); }
		return buffer;
	}

	// Separable Gaussian of the given variance (px²), as passes of a 3-tap kernel.
	function blur(channel, width, height, variance, temp) {
		if (!(variance > 0.01) || width < 2 || height < 2) return;
		const passes = Math.ceil(variance * 1.5), side = variance / passes / 2, middle = 1 - 2 * side, edge = middle + side;
		for (let pass = 0; pass < passes; pass++) {
			for (let y = 0; y < height; y++) {
				const row = y * width, last = row + width - 1;
				temp[row] = channel[row] * edge + channel[row + 1] * side;
				for (let i = row + 1; i < last; i++) temp[i] = channel[i] * middle + (channel[i - 1] + channel[i + 1]) * side;
				temp[last] = channel[last] * edge + channel[last - 1] * side;
			}
			for (let y = 0; y < height; y++) {
				const row = y * width, up = (y > 0 ? y - 1 : 0) * width - row, down = (y < height - 1 ? y + 1 : y) * width - row;
				for (let i = row, end = row + width; i < end; i++) channel[i] = temp[i] * middle + (temp[i + up] + temp[i + down]) * side;
			}
		}
	}

	// A smooth random two-channel field (two colour axes): lattice values
	// `size` px apart, eased between lattice points and between time keys
	// `frames` apart. Variance is kept level through the time blend so the
	// field doesn't pulse. `a` and `b` are full-grid samples.
	function field(width, height, size, frameIndex, frames, salt, a, b) {
		const step = Math.max(1, size);
		const cols = Math.ceil(width / step) + 2, rows = Math.ceil(height / step) + 2;
		const time = Math.max(0, frameIndex) / Math.max(1, frames), key = Math.floor(time), mix = smooth(time - key);
		const level = 1 / Math.sqrt(mix * mix + (1 - mix) * (1 - mix));
		const lattice = [new Float32Array(cols * rows), new Float32Array(cols * rows)];
		lattice.forEach((values, channel) => {
			for (let index = 0; index < values.length; index++) {
				const col = index % cols, row = (index / cols) | 0, channelSalt = salt ^ (channel ? 0x5bd1e995 : 0);
				values[index] = lerp(gauss(hash(col, row, key, channelSalt)), gauss(hash(col, row, key + 1, channelSalt)), mix) * level;
			}
		});
		const xIndex = new Int32Array(width), xWeight = new Float32Array(width);
		for (let x = 0; x < width; x++) { const at = (x + 0.5) / step; xIndex[x] = Math.floor(at); xWeight[x] = smooth(at - xIndex[x]); }
		const [la, lb] = lattice;
		for (let y = 0, cell = 0; y < height; y++) {
			const at = (y + 0.5) / step, rowIndex = Math.floor(at), fy = smooth(at - rowIndex), rowTop = rowIndex * cols;
			for (let x = 0; x < width; x++, cell++) {
				const top = rowTop + xIndex[x], bottom = top + cols, fx = xWeight[x];
				const ua = la[top] + (la[top + 1] - la[top]) * fx, da = la[bottom] + (la[bottom + 1] - la[bottom]) * fx;
				const ub = lb[top] + (lb[top + 1] - lb[top]) * fx, db = lb[bottom] + (lb[bottom + 1] - lb[bottom]) * fx;
				a[cell] = ua + (da - ua) * fy;
				b[cell] = ub + (db - ub) * fy;
			}
		}
	}

	// Linear sensor output → display, through the camera's tone curve.
	const toneCache = new Map();
	function toneLut(black, contrast, knee) {
		const key = `${black.toFixed(4)}|${contrast.toFixed(4)}|${knee.toFixed(4)}`;
		if (toneCache.has(key)) return toneCache.get(key);
		const lut = new Float32Array(TONE_LEVELS + 1);
		for (let index = 0; index <= TONE_LEVELS; index++) {
			const display = (index / TONE_LEVELS * TONE_MAX) ** (1 / GAMMA);
			let x = Math.max(0, display - black) / (1 - black);
			if (x < 1) x += contrast * (smooth(x) - x);
			// Shoulder: a Hermite from the knee (slope 1) to white (slope 0),
			// lifting bright tones into the clip without a kink.
			if (knee < 1 && x > knee) { const t = Math.min(1, (x - knee) / (1 - knee)); x = knee + (1 - knee) * (t + t * t - t * t * t); }
			lut[index] = Math.min(1, x);
		}
		if (toneCache.size > 16) toneCache.clear();
		toneCache.set(key, lut);
		return lut;
	}

	// Area-averages the image's colour onto the sensor grid (0–1 display values).
	function downsample(data, width, height, gridWidth, gridHeight, red, green, blue) {
		const cells = gridWidth * gridHeight;
		if (gridWidth === width && gridHeight === height) {
			for (let cell = 0, offset = 0; cell < cells; cell++, offset += 4) {
				red[cell] = data[offset] / 255; green[cell] = data[offset + 1] / 255; blue[cell] = data[offset + 2] / 255;
			}
			return;
		}
		red.fill(0, 0, cells); green.fill(0, 0, cells); blue.fill(0, 0, cells);
		const counts = scratch('counts', cells);
		counts.fill(0);
		for (let y = 0; y < height; y++) {
			const row = Math.min(gridHeight - 1, Math.floor(y * gridHeight / height)) * gridWidth;
			for (let x = 0, offset = y * width * 4; x < width; x++, offset += 4) {
				const cell = row + Math.min(gridWidth - 1, Math.floor(x * gridWidth / width));
				red[cell] += data[offset]; green[cell] += data[offset + 1]; blue[cell] += data[offset + 2]; counts[cell]++;
			}
		}
		for (let cell = 0; cell < cells; cell++) {
			const scale = 1 / (255 * (counts[cell] || 1));
			red[cell] *= scale; green[cell] *= scale; blue[cell] *= scale;
		}
	}

	// Stretches the sensor picture back over the image bilinearly; alpha stays.
	function upsample(small, gridWidth, gridHeight, imageData) {
		const { width, height, data } = imageData, source = small.data;
		if (gridWidth === width && gridHeight === height) {
			for (let offset = 0; offset < data.length; offset += 4) { data[offset] = source[offset]; data[offset + 1] = source[offset + 1]; data[offset + 2] = source[offset + 2]; }
			return;
		}
		for (let y = 0; y < height; y++) {
			const sy = clamp((y + 0.5) * gridHeight / height - 0.5, 0, gridHeight - 1);
			const top = Math.floor(sy), bottom = Math.min(gridHeight - 1, top + 1), fy = sy - top;
			for (let x = 0, offset = y * width * 4; x < width; x++, offset += 4) {
				const sx = clamp((x + 0.5) * gridWidth / width - 0.5, 0, gridWidth - 1);
				const left = Math.floor(sx), right = Math.min(gridWidth - 1, left + 1), fx = sx - left;
				const a = (top * gridWidth + left) * 4, b = (top * gridWidth + right) * 4, c = (bottom * gridWidth + left) * 4, d = (bottom * gridWidth + right) * 4;
				for (let channel = 0; channel < 3; channel++) {
					const upper = source[a + channel] + (source[b + channel] - source[a + channel]) * fx;
					const lower = source[c + channel] + (source[d + channel] - source[c + channel]) * fx;
					data[offset + channel] = upper + (lower - upper) * fy;
				}
			}
		}
	}

	// Auto-exposure and white balance from the sensor picture: a
	// centre-weighted mean sets the gain; gray-world sets the channel gains,
	// only `correction` of the way, then the camera's own `cast`.
	function meter(red, green, blue, width, height, profile, amount, frame = 0, salt = 0) {
		let total = 0, luma = 0, sumR = 0, sumG = 0, sumB = 0;
		const stride = Math.max(1, Math.round(Math.min(width, height) / 120));
		for (let y = 0; y < height; y += stride) {
			const dy = (y + 0.5) / height - 0.5;
			for (let x = 0; x < width; x += stride) {
				const dx = (x + 0.5) / width - 0.5, weight = Math.max(0.2, 1 - 1.6 * (dx * dx + dy * dy)), cell = y * width + x;
				const r = toLinearLut[inputIndex(red[cell])], g = toLinearLut[inputIndex(green[cell])], b = toLinearLut[inputIndex(blue[cell])];
				sumR += r * weight; sumG += g * weight; sumB += b * weight;
				luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) * weight; total += weight;
			}
		}
		const { exposure, whiteBalance } = profile;
		const mean = Math.max(1e-4, luma / total);
		const gain = clamp((exposure.target / mean) ** exposure.response, exposure.minGain, exposure.maxGain) * exposure.bias;
		const means = [sumR, sumG, sumB].map((sum) => Math.max(1e-4, sum / total));
		const raw = means.map((channel, index) => clamp((mean / channel) ** whiteBalance.correction, 0.75, 1.35) * whiteBalance.cast[index]);
		const { temporal } = profile;
		let flicker = 1;
		if (temporal && frame > 0) {
			flicker += temporal.flicker.amount * drift(frame, temporal.flicker.frames, salt ^ 0x3c6ef372);
			// The cast swings warm (more red, less blue) and cool.
			const swing = temporal.drift.amount * drift(frame, temporal.drift.frames, salt ^ 0x1b873593);
			raw[0] *= 1 + swing; raw[2] *= 1 - swing;
		}
		const level = 0.2126 * raw[0] + 0.7152 * raw[1] + 0.0722 * raw[2];
		return { gain: lerp(1, gain * flicker, amount), balance: raw.map((value) => lerp(1, value / level, amount)) };
	}

	// `profile` is a CONFIG.tools.filter.webcam.resolutions entry; `amount`
	// (0–1) eases every stage in from the untouched image.
	async function render(imageData, profile, { amount = 1, seed = '', frameIndex = 0, jpegRoundTrip = null } = {}) {
		amount = clamp(Number(amount) || 0, 0, 1);
		if (!amount || !profile) return imageData;
		const { width, height, data } = imageData;
		const scale = lerp(1, Math.min(1, profile.height / height), amount);
		const gridWidth = Math.max(1, Math.round(width * scale)), gridHeight = Math.max(1, Math.round(height * scale));
		const cells = gridWidth * gridHeight;
		// Grid pixels per sensor pixel; noise averaged into a coarser grid shrinks.
		const ratio = gridHeight / profile.height, noiseScale = Math.min(1, ratio);
		const red = scratch('red', cells), green = scratch('green', cells), blue = scratch('blue', cells), temp = scratch('temp', cells);
		downsample(data, width, height, gridWidth, gridHeight, red, green, blue);

		// Lens.
		const lensVariance = (profile.lens * ratio) ** 2 * amount;
		blur(red, gridWidth, gridHeight, lensVariance, temp);
		blur(green, gridWidth, gridHeight, lensVariance, temp);
		blur(blue, gridWidth, gridHeight, lensVariance, temp);

		// Exposure, sensor noise, white balance, tone and colour, in one pass.
		const { gain, balance: [balanceR, balanceG, balanceB] } = meter(red, green, blue, gridWidth, gridHeight, profile, amount, Math.max(0, Math.floor(frameIndex)) | 0, seedSalt(seed));
		const { noise, tone, color } = profile;
		const lut = toneLut(tone.black * amount, tone.contrast * amount, lerp(1, tone.knee, amount));
		const toneScale = TONE_LEVELS / TONE_MAX;
		const read = noise.read * amount, shot = noise.shot * amount;
		// Noise sigma by input level: read noise plus shot noise on the signal.
		const sigma = new Float32Array(INPUT_LEVELS + 1);
		for (let index = 0; index <= INPUT_LEVELS; index++) sigma[index] = noiseScale * Math.sqrt(read * read + shot * toLinearLut[index]);
		const salt = seedSalt(seed);
		const chromaA = scratch('chromaA', cells), chromaB = scratch('chromaB', cells), blotchA = scratch('blotchA', cells), blotchB = scratch('blotchB', cells);
		field(gridWidth, gridHeight, noise.chromaSize * ratio, frameIndex, noise.chromaFrames, salt ^ 0x51ed27, chromaA, chromaB);
		field(gridWidth, gridHeight, noise.blotchSize * ratio, frameIndex, noise.blotchFrames, salt ^ 0x7a3d11, blotchA, blotchB);
		const chromaAmount = noise.chroma, blotchAmount = read * noise.blotch;
		const saturation = lerp(1, color.saturation, amount), warmSaturation = lerp(1, color.warmSaturation, amount);
		const frame = Math.max(0, Math.floor(frameIndex)) | 0;
		for (let y = 0, cell = 0; y < gridHeight; y++) {
			for (let x = 0; x < gridWidth; x++, cell++) {
				const ir = inputIndex(red[cell]), ig = inputIndex(green[cell]), ib = inputIndex(blue[cell]);
				const luma = gauss(hash(x, y, frame, salt));
				const ca = chromaA[cell] * chromaAmount, cb = chromaB[cell] * chromaAmount;
				const ba = blotchA[cell] * blotchAmount, bb = blotchB[cell] * blotchAmount;
				// Sensor: signal plus noise, times gain, clipped where the
				// photosite saturates, then white balance. Each channel clips alone.
				let sr = (toLinearLut[ir] + sigma[ir] * (luma + ca) + ba) * gain;
				let sg = (toLinearLut[ig] + sigma[ig] * (luma - 0.5 * (ca + cb)) - 0.5 * (ba + bb)) * gain;
				let sb = (toLinearLut[ib] + sigma[ib] * (luma + cb) + bb) * gain;
				sr = (sr <= 0 ? 0 : sr >= 1 ? 1 : sr) * balanceR;
				sg = (sg <= 0 ? 0 : sg >= 1 ? 1 : sg) * balanceG;
				sb = (sb <= 0 ? 0 : sb >= 1 ? 1 : sb) * balanceB;
				const tr = (sr * toneScale + 0.5) | 0, tg = (sg * toneScale + 0.5) | 0, tb = (sb * toneScale + 0.5) | 0;
				let dr = lut[tr > TONE_LEVELS ? TONE_LEVELS : tr], dg = lut[tg > TONE_LEVELS ? TONE_LEVELS : tg], db = lut[tb > TONE_LEVELS ? TONE_LEVELS : tb];
				// Weak colour matrix: muted, but reds, oranges and skin hold.
				const max = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db), min = dr < dg ? (dr < db ? dr : db) : (dg < db ? dg : db);
				const spread = max - min;
				let warmth = spread > 0.02 ? (dr - (dg + db) / 2) / spread : 0;
				warmth = warmth <= 0 ? 0 : warmth * warmth;
				const keep = saturation + (warmSaturation - saturation) * warmth, Y = 0.299 * dr + 0.587 * dg + 0.114 * db;
				dr = Y + (dr - Y) * keep; db = Y + (db - Y) * keep;
				// Stored as Y / Cb / Cr for the ISP (Y is unchanged by the matrix).
				red[cell] = Y; green[cell] = db - Y; blue[cell] = dr - Y;
			}
		}

		// ISP: chroma smear, then waxy noise reduction and crude sharpening on luma.
		const { isp } = profile;
		const chromaVariance = (isp.chromaBlur * ratio) ** 2 * amount;
		blur(green, gridWidth, gridHeight, chromaVariance, temp);
		blur(blue, gridWidth, gridHeight, chromaVariance, temp);
		// One luma blur serves both: noise reduction pulls low-contrast detail
		// (smaller than `denoiseEdge`) toward it, sharpening pushes away from it.
		const soft = scratch('soft', cells);
		soft.set(red.subarray(0, cells));
		blur(soft, gridWidth, gridHeight, (isp.sharpenRadius * Math.min(1, ratio)) ** 2, temp);
		const denoise = isp.denoise * amount, edge = isp.denoiseEdge, sharpen = isp.sharpen * amount;

		const small = { width: gridWidth, height: gridHeight, data: new Uint8ClampedArray(cells * 4) };
		const out = small.data;
		for (let cell = 0, offset = 0; cell < cells; cell++, offset += 4) {
			const detail = soft[cell] - red[cell], ratioToEdge = detail / edge;
			const cleaned = red[cell] + denoise * detail / (1 + ratioToEdge * ratioToEdge);
			const Y = cleaned + sharpen * (cleaned - soft[cell]), r = Y + blue[cell], b = Y + green[cell];
			out[offset] = r * 255; out[offset + 1] = (Y - 0.299 * r - 0.114 * b) / 0.587 * 255; out[offset + 2] = b * 255; out[offset + 3] = 255;
		}

		// Ghosting: a share of the previous frame of this stream stays.
		const frameNumber = Math.max(0, Math.floor(frameIndex)) | 0, key = `${seed}|${gridWidth}x${gridHeight}`;
		const previous = history.get(key);
		if (profile.temporal?.ghost && frameNumber > 0 && previous?.frame === frameNumber - 1) {
			const ghost = profile.temporal.ghost * amount, last = previous.data;
			for (let index = 0; index < out.length; index += 4) {
				out[index] = lerp(out[index], last[index], ghost); out[index + 1] = lerp(out[index + 1], last[index + 1], ghost); out[index + 2] = lerp(out[index + 2], last[index + 2], ghost);
			}
		}
		if (profile.temporal?.ghost) {
			history.delete(key);
			history.set(key, { frame: frameNumber, data: out.slice() });
			if (history.size > HISTORY_LIMIT) history.delete(history.keys().next().value);
		}

		let developed = small;
		if (jpegRoundTrip && profile.jpeg) {
			developed = await jpegRoundTrip(small, { quality: Math.round(lerp(95, profile.jpeg.quality, amount)), generations: 1, blockSize: 1, chromaBleed: profile.jpeg.chromaBleed * amount });
		}
		upsample(developed, gridWidth, gridHeight, imageData);
		return imageData;
	}

	const api = { render };
	root.GlitterWebcamSensor = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
