'use strict';

// The Webcam look and the filter steps around it (js/effects/filter-ops.js):
// Resample softens without blocks, Color Balance tints by tonal range, Noise
// can sit in the shadows and moves with the frame index; the Webcam op runs a
// whole camera on its sensor grid (js/effects/webcam-sensor.js) from the real
// CONFIG profiles; and the looks: Color Balance starts neutral, Webcam is a
// Web & Film look with a profile per resolution.

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const configContext = vm.createContext({ console, structuredClone, Math, navigator: { hardwareConcurrency: 4, userAgent: 'node' } });
for (const file of ['js/core/math.js', 'js/core/color.js', 'js/core/releases.js', 'js/core/fields.js', 'js/core/area.js', 'js/core/config.js']) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), configContext, { filename: file });
}
const profiles = vm.runInContext('CONFIG.tools.filter.webcam.resolutions', configContext);
global.CONFIG = { tools: { filter: { tintPresets: {}, animation: { frameMs: 100, crawl: {} }, webcam: { resolutions: profiles } } } };
global.FIELDS = require('../../js/core/fields.js');
const Ops = require('../../js/effects/filter-ops.js');
const Filters = require('../../js/effects/filter-looks.js');

const width = 32, height = 24;
function fixture(fill, w = width, h = height) {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fill(x, y), (y * w + x) * 4);
	return { width: w, height: h, data };
}
const checker = () => fixture((x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
const flat = (value) => fixture(() => [value, value, value, 255]);
const run = (op, image, params, context = {}) => Ops.get(op).pixel(image, params, context).data;
const contrast = (data) => {
	let total = 0;
	for (let offset = 4; offset < data.length; offset += 4) total += Math.abs(data[offset] - data[offset - 4]);
	return total / (data.length / 4);
};

(async () => {
	// Resample: scale 1 is the identity; half scale averages a checker to grey.
	assert.deepEqual(run('resample', checker(), { scale: 1 }), checker().data, 'Resample at full scale returns the input');
	assert.equal(Ops.get('resample').isActive({ scale: 1 }), false);
	const softened = run('resample', checker(), { scale: 0.5 });
	assert(contrast(softened) < contrast(checker().data) * 0.1, 'Half scale loses the one-pixel checker');
	assert(Math.abs(softened[(12 * width + 16) * 4] - 128) < 4, 'The detail averages to mid grey, not to blocks of black and white');

	// Color Balance: zero shifts are inactive; a shadow shift tints dark pixels
	// more than light ones, and a highlight shift the reverse.
	const neutral = { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] };
	assert.equal(Ops.get('colorBalance').isActive(neutral), false, 'A neutral balance is inactive');
	const shadowGreen = { ...neutral, shadows: [0, 1, 0] };
	const darkShift = run('colorBalance', flat(30), shadowGreen)[1] - 30;
	const lightShift = run('colorBalance', flat(220), shadowGreen)[1] - 220;
	assert(darkShift > 40 && lightShift < 5, `Shadow green lands in the shadows: dark +${darkShift}, light +${lightShift}`);
	const highlightBlue = run('colorBalance', flat(220), { ...neutral, highlights: [0, 0, -1] });
	assert(highlightBlue[2] < 160 && highlightBlue[0] === 220, 'Highlight yellow (minus blue) only moves blue');

	// Noise: frame 0 keeps a still's pattern; later frames reseed; the shadow
	// weight leaves white untouched.
	const grain = (image, params, context) => run('noise', image, { amount: 0.4, ...params }, { seed: 'layer', ...context });
	assert.deepEqual(grain(flat(128), {}, { frameIndex: 0 }), grain(flat(128), {}, {}), 'Frame 0 seeds like a still');
	assert.notDeepEqual(grain(flat(128), {}, { frameIndex: 1 }), grain(flat(128), {}, { frameIndex: 0 }), 'Frame 1 has new grain');
	assert.deepEqual(grain(flat(255), { shadows: 1 }, {}), flat(255).data, 'Shadow-weighted grain leaves white alone');
	assert.notDeepEqual(grain(flat(20), { shadows: 1 }, {}), flat(20).data, 'Shadow-weighted grain still lands in the shadows');

	// Webcam op. Profiles are resized to the fixture so one fixture pixel is
	// one sensor pixel; Node has no JPEG, so that stage is skipped here.
	const W = 120, H = 90;
	const sensor = (resolution, extra = {}) => ({ ...profiles[resolution], height: H, ...extra });
	const scene = () => fixture((x) => x < W / 3 ? [35, 35, 38, 255] : x < 2 * W / 3 ? [125, 120, 118, 255] : [215, 215, 218, 255], W, H);
	const webcam = async (image, params, context = {}) => (await Ops.get('webcam').pixel(image, { amount: 1, ...params }, { seed: 'take', ...context })).data;
	// Pixel-to-pixel spread (green channel) over a band of columns.
	const spread = (data, from, to) => {
		let total = 0, count = 0;
		for (let y = 10; y < H - 10; y++) for (let x = Math.round(from * W) + 4; x < Math.round(to * W) - 4; x++) {
			total += Math.abs(data[(y * W + x) * 4 + 1] - data[(y * W + x + 1) * 4 + 1]); count++;
		}
		return total / count;
	};
	const mean = (data, from, to) => {
		let total = 0, count = 0;
		for (let y = 0; y < H; y++) for (let x = Math.round(from * W); x < Math.round(to * W); x++) { total += data[(y * W + x) * 4 + 1]; count++; }
		return total / count;
	};

	assert.equal(Ops.get('webcam').isActive({ sensor: profiles[480], amount: 0 }), false, 'Webcam at Amount 0 is inactive');
	const still = await webcam(scene(), { sensor: sensor(480) });
	assert.deepEqual(await webcam(scene(), { sensor: sensor(480) }, { frameIndex: 0 }), still, 'A still keeps one pattern per seed');
	assert.notDeepEqual(await webcam(scene(), { sensor: sensor(480) }, { frameIndex: 1 }), still, 'The next frame has new sensor noise');
	const alpha = scene(); alpha.data[3] = 77;
	assert.equal((await webcam(alpha, { sensor: sensor(480) }))[3], 77, 'Alpha is left alone');

	// Noise sits in the shadows: dark band spread > mid > bright.
	const [dark, mid, bright] = [spread(still, 0, 1 / 3), spread(still, 1 / 3, 2 / 3), spread(still, 2 / 3, 1)];
	assert(dark > mid * 1.5 && mid > bright, `Noise is strongest in the shadows: dark ${dark.toFixed(1)}, mid ${mid.toFixed(1)}, bright ${bright.toFixed(1)}`);
	// Limited range: shadows crush darker, highlights wash brighter.
	assert(mean(still, 0, 1 / 3) < 35 && mean(still, 2 / 3, 1) > 215, `Blacks crush and highlights wash out: ${mean(still, 0, 1 / 3).toFixed(0)}, ${mean(still, 2 / 3, 1).toFixed(0)}`);
	// 480p is the rougher camera: more noise than 720p in the same shadows.
	const hd = await webcam(scene(), { sensor: sensor(720) });
	assert(spread(still, 0, 1 / 3) > spread(hd, 0, 1 / 3) * 1.15, `480p is noisier than 720p: ${spread(still, 0, 1 / 3).toFixed(1)} vs ${spread(hd, 0, 1 / 3).toFixed(1)}`);
	// A dark scene gets auto-exposure gain, and with it more noise.
	const dim = fixture(() => [30, 30, 32, 255], W, H), lit = () => fixture(() => [110, 110, 112, 255], W, H);
	const dimOut = await webcam(dim, { sensor: sensor(720) }), litOut = await webcam(lit(), { sensor: sensor(720) });
	assert(mean(dimOut, 0, 1) > 30, `Auto-exposure lifts a dark scene: ${mean(dimOut, 0, 1).toFixed(0)}`);
	assert(spread(dimOut, 0, 1) > spread(litOut, 0, 1), 'A dark scene is noisier than a lit one');
	// The sensor grid: a sensor a quarter of the image's height loses a
	// one-pixel checker, and its noise averages down instead of growing.
	const fineChecker = () => fixture((x, y) => ((x + y) % 2 ? [200, 200, 200, 255] : [60, 60, 60, 255]), W, H);
	assert(contrast(await webcam(fineChecker(), { sensor: sensor(480, { height: H / 4 }) })) < contrast(fineChecker().data) * 0.2, 'Detail finer than the sensor is lost');
	const small = await webcam(lit(), { sensor: sensor(720, { height: H * 4 }) });
	assert(spread(small, 0, 1) < spread(litOut, 0, 1), 'On an image smaller than the sensor the noise averages down');
	// Colour: muted overall, but reds hold more of their saturation than blues.
	const swatches = fixture((x) => x < W / 2 ? [200, 60, 50, 255] : [50, 80, 200, 255], W, H);
	const colored = await webcam(swatches, { sensor: sensor(720) });
	const chroma = (from, to) => {
		let total = 0, count = 0;
		for (let y = 20; y < H - 20; y++) for (let x = Math.round(from * W) + 8; x < Math.round(to * W) - 8; x++) {
			const o = (y * W + x) * 4; total += Math.max(colored[o], colored[o + 1], colored[o + 2]) - Math.min(colored[o], colored[o + 1], colored[o + 2]); count++;
		}
		return total / count;
	};
	assert(chroma(0, 0.5) / 150 > chroma(0.5, 1) / 150 + 0.05, `Reds hold saturation better than blues: ${chroma(0, 0.5).toFixed(0)} vs ${chroma(0.5, 1).toFixed(0)} (both 150 in)`);

	// Looks: Color Balance starts neutral with the Midtones range; Webcam is a
	// Web & Film look with one step carrying its resolution's profile.
	const balance = Filters.normalize('color-balance');
	assert.equal(balance.range, 'midtones');
	assert.equal(Filters.recipe(balance).every((entry) => Ops.get(entry.op).isActive(entry.params) === false), true, 'A new Color Balance changes nothing');
	assert.deepEqual(Filters.recipe({ ...balance, shadowsGreen: 50 })[0].params.shadows, [0, 0.5, 0]);
	assert.equal(Filters.looksLibrary.get('webcam').group, 'web');
	assert.equal(Filters.normalize('webcam').resolution, '720', 'Webcam defaults to 720p');
	assert.deepEqual(Filters.recipe(Filters.normalize('webcam', { strength: 0 })), [], 'Webcam at Strength 0 has no steps');
	const at = (resolution) => Filters.recipe(Filters.normalize('webcam', { resolution }));
	assert.deepEqual(at('480').map((entry) => entry.op), ['webcam']);
	assert.equal(JSON.stringify(at('480')[0].params.sensor), JSON.stringify(profiles[480]));
	assert.equal(JSON.stringify(at('720')[0].params.sensor), JSON.stringify(profiles[720]));

	console.log('PASS filter webcam: resample, color balance, shadow + per-frame noise, webcam sensor (shadow noise, range, 480 vs 720, exposure gain, sensor grid, colour), Color Balance and Webcam looks');
})().catch((error) => { console.error(error); process.exit(1); });
