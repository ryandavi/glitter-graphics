'use strict';

// The Webcam look's new filter steps (js/effects/filter-ops.js): Resample
// softens without blocks, Color Balance tints by tonal range, Noise can sit
// in the shadows and moves with the frame index; and the looks around them:
// a Color Balance filter that starts neutral, and a Webcam look in Web & Film.

const assert = require('assert/strict');
global.CONFIG = { tools: { filter: { tintPresets: {}, animation: { frameMs: 100, crawl: {} }, webcam: { resolutions: { 480: { label: '480p', height: 480 }, 720: { label: '720p', height: 720 } }, lensDetail: 0.7 } } } };
global.FIELDS = require('../../js/core/fields.js');
const Ops = require('../../js/effects/filter-ops.js');
const Filters = require('../../js/effects/filter-looks.js');

const width = 32, height = 24;
function fixture(fill) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(fill(x, y), (y * width + x) * 4);
	return { width, height, data };
}
const checker = () => fixture((x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
const flat = (value) => fixture(() => [value, value, value, 255]);
const run = (op, image, params, context = {}) => Ops.get(op).pixel(image, params, context).data;
const contrast = (data) => {
	let total = 0;
	for (let offset = 4; offset < data.length; offset += 4) total += Math.abs(data[offset] - data[offset - 4]);
	return total / (data.length / 4);
};

// Resample: scale 1 is the identity; half scale averages a checker to grey.
assert.deepEqual(run('resample', checker(), { scale: 1 }), checker().data, 'Resample at full scale returns the input');
assert.equal(Ops.get('resample').isActive({ scale: 1 }), false);
const softened = run('resample', checker(), { scale: 0.5 });
assert(contrast(softened) < contrast(checker().data) * 0.1, 'Half scale loses the one-pixel checker');
assert(Math.abs(softened[(12 * width + 16) * 4] - 128) < 4, 'The detail averages to mid grey, not to blocks of black and white');

// Resample by sensor height: a sensor half the image's height halves it;
// one taller than the image, or Amount 0, leaves it alone.
assert.deepEqual(run('resample', checker(), { height: 12, amount: 1 }), softened, 'A 12-line sensor on a 24-line image is half scale');
assert.deepEqual(run('resample', checker(), { height: 48, amount: 1 }), checker().data, 'A sensor taller than the image keeps it');
assert.equal(Ops.get('resample').isActive({ height: 12, amount: 0 }), false);

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

// Sensor-sized grain: on a sensor a quarter of the image's height,
// neighbouring pixels share grain, so it changes less pixel to pixel.
const fine = grain(flat(128), {}, {}), coarse = grain(flat(128), { height: 6 }, {});
assert(contrast(coarse) < contrast(fine) * 0.5, `Sensor grain spans pixels: ${contrast(coarse).toFixed(1)} vs ${contrast(fine).toFixed(1)}`);

// Looks: Color Balance starts neutral with the Midtones range; Webcam is a
// Web & Film look whose steps all exist, and Strength 0 does nothing.
const balance = Filters.normalize('color-balance');
assert.equal(balance.range, 'midtones');
assert.equal(Filters.recipe(balance).every((entry) => Ops.get(entry.op).isActive(entry.params) === false), true, 'A new Color Balance changes nothing');
assert.deepEqual(Filters.recipe({ ...balance, shadowsGreen: 50 })[0].params.shadows, [0, 0.5, 0]);
assert.equal(Filters.looksLibrary.get('webcam').group, 'web');
const webcam = Filters.recipe(Filters.normalize('webcam'));
assert.deepEqual(webcam.map((entry) => entry.op), ['resample', 'blur', 'sharpen', 'tone', 'colorBalance', 'noise', 'jpeg']);
assert.deepEqual(Filters.recipe(Filters.normalize('webcam', { strength: 0 })), [], 'Webcam at Strength 0 has no steps');
const at = (resolution) => Filters.recipe(Filters.normalize('webcam', { resolution }));
assert.equal(Filters.normalize('webcam').resolution, '720', 'Webcam defaults to 720p');
assert.deepEqual([at('480')[0].params.height, at('480')[5].params.height], [336, 480], '480p resolves 0.7 of its lines; grain is one sensor pixel');
assert.deepEqual([at('720')[0].params.height, at('720')[5].params.height], [504, 720]);

console.log('PASS filter webcam: resample, color balance, shadow + per-frame noise, sensor resample + grain, Color Balance and Webcam looks');
