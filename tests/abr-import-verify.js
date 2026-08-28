'use strict';

// Exercises tools/abr-lib.js against the real .abr sources in tools/brush-sources/
// and checks the generated data/brushes.json is internally consistent.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseAbr } = require('../tools/abr-lib.js');

const SRC = path.join(__dirname, '..', 'tools', 'brush-sources');
const read = (p) => fs.readFileSync(path.join(SRC, p));

// ---- v6.2 sampled packs (bruisedxheart.org) ---------------------------------
const swirlies = parseAbr(read('BHBrush04Swirlies.abr'));
assert.strictEqual(swirlies.version, 6);
assert.strictEqual(swirlies.subversion, 2);
assert.strictEqual(swirlies.samples.length, 4, 'Swirlies has 4 sampled tips');
assert.strictEqual(swirlies.presets.length, 4);
assert(swirlies.samples.every((s) => s.width > 100 && s.height > 100 && s.coverage.length === s.width * s.height),
	'every decoded tip has a full coverage buffer');
assert(swirlies.presets.every((p) => p.scatter === 0 && p.sizeJitter === 0 && p.count === 1),
	'plain sampled brushes carry no dynamics');
// presets reference real sample ids
const ids = new Set(swirlies.samples.map((s) => s.id));
assert(swirlies.presets.every((p) => ids.has(p.sampledId)), 'each preset points at a decoded sample');

// ---- v6.1 pack with real Scattering + Shape Dynamics (at0mica.net) ----------
const heart = parseAbr(read('heartattack_ps/at0mica_net-heartattack.abr'));
assert.strictEqual(heart.version, 6);
assert.strictEqual(heart.subversion, 1);
assert(heart.presets.length >= 5, 'heartattack ships several presets');
const scattered = heart.presets.filter((p) => p.scatter > 0);
assert(scattered.length >= 3, 'at least three heartattack presets use Scattering');
assert(scattered.some((p) => p.sizeJitter > 0 && p.countJitter > 0),
	'Shape Dynamics (size jitter) and count jitter are extracted');
assert(scattered.every((p) => p.scatter <= 10), 'scatter is normalised to the engine range (<=1000%)');

const stardust = parseAbr(read('stardust_ps/at0mica_net-stardust.abr'));
assert(stardust.samples.length === 1 && stardust.samples[0].width === 9,
	'stardust is a single 9px particle tip');
assert(stardust.presets.some((p) => p.scatter > 0), 'stardust has a scattered preset');

// ---- generated manifest sanity --------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'brushes.json'), 'utf8'));
assert(typeof manifest.version === 'string' && Array.isArray(manifest.packs));
const brushIds = new Set();
for (const pack of manifest.packs) {
	assert(/^[a-z][a-z0-9-]*$/.test(pack.id), `pack id ${pack.id}`);
	assert(pack.attribution && pack.attribution.license, `${pack.id} keeps an attribution.license`);
	for (const brush of pack.brushes) {
		assert(!brushIds.has(brush.id), `duplicate brush id ${brush.id}`);
		brushIds.add(brush.id);
		const tip = path.join(__dirname, '..', brush.tip.src);
		assert(fs.existsSync(tip), `${brush.id} tip file exists: ${brush.tip.src}`);
		const png = fs.readFileSync(tip);
		assert.strictEqual(png.readUInt32BE(16), brush.tip.width, `${brush.id} tip width matches PNG`);
		assert.strictEqual(png.readUInt32BE(20), brush.tip.height, `${brush.id} tip height matches PNG`);
		assert(brush.dynamics.scatter >= 0 && brush.dynamics.scatter <= 10);
		assert(Number.isInteger(brush.dynamics.count) && brush.dynamics.count >= 1);
	}
}

process.stdout.write(`PASS abr-lib decodes v6.1 + v6.2 packs; ${manifest.packs.length} packs / ${brushIds.size} brushes in data/brushes.json check out\n`);
