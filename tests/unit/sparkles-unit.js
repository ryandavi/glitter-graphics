'use strict';

// Sparkles registries and engine: glyph, behavior and preset conformance,
// seeded layouts, the loop contract (every particle back at its start after
// one cycle) and highlight detection fixtures.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const context = vm.createContext({
	console,
	structuredClone,
	Math,
	navigator: { hardwareConcurrency: 4, userAgent: 'node' },
	normalizeEffectGradient: (value) => value || { stops: [] },
	mergeSlotEffectDefaults: (target, defaults) => (target ? Object.assign(target, { ...defaults, ...target }) : { ...defaults }),
	normalizeSlotTextureCoordinates: (target) => target
});
for (const file of [
	'js/core/releases.js',
	'js/core/fields.js',
	'js/core/config.js',
	'js/core/options.js',
	'js/core/math.js', 'js/effects/easing.js',
	'js/effects/animation.js',
	'js/effects/highlight-detect.js',
	'js/ui/preset-library.js',
	'js/paint/sparkles.js'
]) {
	vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const run = (code) => vm.runInContext(code, context);

function fail(message) {
	throw new Error(`sparkles: ${message}`);
}

function image(width, height, shade) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [value, alpha = 255] = shade(x, y);
			const i = (y * width + x) * 4;
			data[i] = data[i + 1] = data[i + 2] = value;
			data[i + 3] = alpha;
		}
	}
	return { data, width, height };
}

const glyphs = run('SPARKLE_GLYPHS');
const tiers = run('SPARKLE_STYLE_TIERS');
const behaviors = run('SPARKLE_BEHAVIORS');
const animation = run('GlitterAnimation');
const presets = run('SPARKLE_PRESETS');
const defaults = run('buildDefaultSparkles()');

// Glyphs and style tiers.
Object.values(glyphs).forEach((glyph) => {
	if (typeof glyph.draw !== 'function' || !glyph.label) fail(`glyph ${glyph.id} is missing draw or label`);
});
run("getOptionValues('sparkleStyle')").forEach((style) => {
	const list = tiers[style];
	if (!list?.length) fail(`style ${style} has no tiers`);
	if (list[list.length - 1][0] !== Infinity) fail(`style ${style} does not cover every strength`);
	list.forEach(([, glyph]) => { if (!glyphs[glyph]) fail(`style ${style} names unknown glyph ${glyph}`); });
});
Object.keys(run('CONFIG.tools.sparkles.defaults.glyphs')).forEach((id) => {
	if (!glyphs[id]?.pickable) fail(`default glyph ${id} is not pickable`);
});

// Behaviors come from the motion library and loop.
if (behaviors.length < 2) fail('expected at least twinkle and glint behaviors');
behaviors.forEach(({ value }) => {
	const motion = animation.MOTION_REGISTRY[value];
	if (!motion?.targets.includes('particle')) fail(`behavior ${value} is not a particle-safe motion`);
	if (!animation.isSeamlessLoop({ type: value })) fail(`behavior ${value} does not loop seamlessly`);
});

// Presets: plain values on real slot keys and registry options.
presets.entries.forEach((entry) => {
	Object.keys(entry.value).forEach((key) => {
		if (!(key in defaults)) fail(`preset ${entry.id} sets unknown key ${key}`);
	});
	const value = entry.value;
	if (value.emitter && !run(`isOptionValue('sparkleEmitter', ${JSON.stringify(value.emitter)})`)) fail(`preset ${entry.id} emitter`);
	if (value.behavior && !run(`isOptionValue('sparkleBehavior', ${JSON.stringify(value.behavior)})`)) fail(`preset ${entry.id} behavior`);
	if (value.style && !run(`isOptionValue('sparkleStyle', ${JSON.stringify(value.style)})`)) fail(`preset ${entry.id} style`);
	Object.keys(value.glyphs || {}).forEach((id) => { if (!glyphs[id]?.pickable) fail(`preset ${entry.id} glyph ${id}`); });
	const fields = run('FIELDS');
	[['count', 'sparkleCount'], ['sizeMin', 'sparkleSizeMin'], ['sizeMax', 'sparkleSizeMax'], ['cycleMs', 'sparkleCycle'], ['sensitivity', 'sparkleSensitivity'], ['spacing', 'sparkleSpacing']]
		.forEach(([key, spec]) => {
			if (value[key] == null) return;
			if (value[key] < fields[spec].min || value[key] > fields[spec].max) fail(`preset ${entry.id} ${key} outside its field range`);
		});
	const target = { ...defaults, glyphs: { ...defaults.glyphs } };
	presets.apply(entry, target);
	if (run(`findSparklePresetId(${JSON.stringify(target)})`) !== entry.id) fail(`preset ${entry.id} is not recognized after applying it`);
});

// Seeded layouts repeat exactly and respect the host's pixels.
context.layoutData = { ...defaults, glyphs: { ...defaults.glyphs }, count: 30 };
const halfOpaque = image(100, 80, (x) => [200, x < 50 ? 255 : 0]);
context.hostHalf = { width: 200, height: 160, pixels: halfOpaque };
const first = run('computeSparkleLayout(layoutData, hostHalf)');
const second = run('computeSparkleLayout(layoutData, hostHalf)');
if (JSON.stringify(first) !== JSON.stringify(second)) fail('layout is not deterministic');
if (!first.length) fail('scatter placed no particles');
if (first.some((particle) => particle.x >= 100)) fail('scatter placed particles on transparent pixels');
context.layoutData.seed = 2;
if (JSON.stringify(run('computeSparkleLayout(layoutData, hostHalf)')) === JSON.stringify(first)) fail('seed does not change the layout');
context.layoutData.count = 500;
if (run('computeSparkleLayout(layoutData, { width: 400, height: 400, pixels: null })').length > run('CONFIG.tools.sparkles.maxCount')) {
	fail('count is not capped');
}

// Edges: on the host's outline, or on its box edge when it has no pixels.
context.edgeData = { ...defaults, glyphs: { ...defaults.glyphs }, emitter: 'edges', count: 30 };
const edgeLayout = run('computeSparkleLayout(edgeData, hostHalf)');
if (!edgeLayout.length) fail('edges placed no particles');
edgeLayout.forEach((particle) => {
	const nearOutline = particle.x <= 3 || Math.abs(particle.x - 100) <= 3 || particle.y <= 3 || particle.y >= 157;
	if (!nearOutline || particle.x > 102) fail(`edge particle at ${particle.x},${particle.y} is off the opaque half's outline`);
});
run('computeSparkleLayout(edgeData, { width: 200, height: 100, pixels: null })').forEach((particle) => {
	const onBox = particle.x === 0 || particle.x === 200 || particle.y === 0 || particle.y === 100;
	if (!onBox) fail(`box-edge particle at ${particle.x},${particle.y} is off the perimeter`);
});

// Fall wraps inside the emitter area: particles move and stay within it.
context.fallData = { ...defaults, glyphs: { ...defaults.glyphs }, behavior: 'fall', cycleMs: 3000 };
context.fallLayout = first;
const fallen = run("sampleSparkleFrame(fallData, fallLayout, 1000, 'fall')");
if (!fallen.some((sample) => Math.abs(sample.ty) > 5)) fail('fall does not move particles');
fallen.forEach((sample) => {
	const y = sample.particle.y + sample.ty;
	const margin = sample.particle.size;
	if (y < -margin || y > 160 + margin) fail(`fallen particle at y ${y} left the emitter area`);
});

// Loop contract: every particle is back at its start after one cycle, for
// every behavior.
behaviors.forEach(({ value }) => {
	context.loopData = { ...defaults, glyphs: { ...defaults.glyphs }, behavior: value, cycleMs: 2400 };
	context.loopLayout = first;
	const start = run("sampleSparkleFrame(loopData, loopLayout, 0, 'seam')");
	const end = run("sampleSparkleFrame(loopData, loopLayout, loopData.cycleMs, 'seam')");
	start.forEach((sample, index) => {
		const other = end[index];
		['tx', 'ty', 'scaleX', 'scaleY', 'opacity'].forEach((key) => {
			if (Math.abs(sample[key] - other[key]) > 1e-3) fail(`${value} particle ${index} ${key} does not close the loop`);
		});
		const turn = ((sample.rotate - other.rotate) % 360 + 360) % 360;
		if (turn > 1e-3 && 360 - turn > 1e-3) fail(`${value} particle ${index} rotation does not close the loop`);
	});
});

// Highlight fixtures: a dark CD with bright specks gets stars; a flat white
// image and a smooth gradient get none.
const specks = [[40, 40], [120, 60], [200, 150], [80, 180], [160, 30]];
const cd = image(240, 200, (x, y) => [specks.some(([sx, sy]) => Math.hypot(x - sx, y - sy) < 2.5) ? 255 : 40 + x / 4]);
context.kiraData = { ...defaults, glyphs: { ...defaults.glyphs }, emitter: 'highlights', count: 20, spacing: 12 };
context.cdHost = { width: 240, height: 200, pixels: cd };
context.whiteHost = { width: 240, height: 200, pixels: image(240, 200, () => [255]) };
context.gradientHost = { width: 240, height: 200, pixels: image(240, 200, (x) => [x]) };
const stars = run('computeSparkleLayout(kiraData, cdHost)');
if (stars.length < specks.length) fail(`expected a star on each of ${specks.length} highlights, got ${stars.length}`);
stars.forEach((star) => {
	if (!specks.some(([sx, sy]) => Math.hypot(star.x - sx - 0.5, star.y - sy - 0.5) <= 3)) fail(`star at ${star.x},${star.y} is off every highlight`);
	if (!glyphs[star.glyph]) fail(`star uses unknown glyph ${star.glyph}`);
});
if (run('computeSparkleLayout(kiraData, whiteHost)').length) fail('flat white image got stars');
if (run('computeSparkleLayout(kiraData, gradientHost)').length) fail('smooth gradient got stars');
if (run('computeSparkleLayout(kiraData, { width: 240, height: 200, pixels: null })').length) fail('a host without pixels got highlight stars');

process.stdout.write(`Sparkles verification passed (${Object.keys(glyphs).length} glyphs, ${behaviors.length} behaviors, ${presets.entries.length} presets)\n`);
