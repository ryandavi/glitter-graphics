#!/usr/bin/env node
// ============================================
// abr-import — Photoshop ABR  ->  our raster-brush format
// ============================================
// Decodes an .abr into normalised stamp PNGs under images/brushes/<pack>/ and
// patches data/brushes.json with a pack entry (dynamics from the ABR brush
// descriptor, plus attribution you supply). Pure Node, zero deps.
//
//   node tools/abr-import.js <file.abr> [options]
//
//   --pack <id>         pack id (kebab-case). Default: derived from filename.
//   --label <text>      human label for the pack. Default: derived from pack id.
//   --order <n>         sort order among packs. Default: (max existing)+10.
//   --author <text>     original brush author / site.
//   --author-url <url>  original source URL (often a web.archive.org capture).
//   --archived-by <t>   archivist / re-host who preserved the pack.
//   --archive-url <url> the archivist's post or collection URL.
//   --license <text>    e.g. "unknown", "personal-use", "CC-BY-4.0".
//   --notes <text>      free-form provenance note.
//   --tags a,b,c        tags applied to every brush in the pack.
//   --categories a,b    categories applied to every brush in the pack.
//   --invert            treat the ABR tip data as inverted (paint = dark).
//   --drop-sample a,b   1-based indices of sampled tips to skip entirely
//                       (e.g. a "NO REDISTRIBUTING" credit-stamp tip).
//   --all-presets       emit every distinct preset as its own brush (default:
//                       one brush per tip = the preset that uses the most of
//                       Photoshop's brush engine — its "real" behaviour).
//   --keep-plain        also emit the zero-dynamics preset as "<Pack> Stamp"
//                       when the chosen brush for that tip is a scatter brush.
//   --check             also compare decoded tip sizes to a sibling *png/ dir.
//   --dry-run           print what would be written; touch nothing.

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseAbr } = require('./abr-lib.js');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'data', 'brushes.json');

// ---------- args ----------
function parseArgs(argv) {
	const out = { _: [], tags: [], categories: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) { out._.push(a); continue; }
		const key = a.slice(2);
		const flagOnly = ['invert', 'check', 'dry-run', 'all-presets', 'keep-plain'];
		if (flagOnly.includes(key)) { out[camel(key)] = true; continue; }
		const val = argv[++i];
		if (key === 'tags' || key === 'categories') out[key] = splitList(val);
		else if (key === 'drop-sample') out.dropSample = new Set(splitList(val).map(Number));
		else out[camel(key)] = val;
	}
	return out;
}
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const splitList = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
const kebab = (s) => s.toLowerCase()
	.replace(/\.abr$/i, '')
	.replace(/[^a-z0-9]+/g, '-')
	.replace(/^-+|-+$/g, '')
	.replace(/-{2,}/g, '-');
const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

// ---------- tiny PNG encoder (RGBA, filter 0) ----------
function crc32(buf) {
	let c = ~0;
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i];
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
	}
	return ~c >>> 0;
}
function chunk(type, data) {
	const t = Buffer.from(type, 'latin1');
	const body = Buffer.concat([t, data]);
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
	const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([len, body, crc]);
}
// coverage: Uint8Array (w*h), 0..255. Output: grey+alpha, grey = 255 (white),
// alpha = coverage — drawImage-equivalent to white RGBA, ~40% smaller on disk.
function encodePng(coverage, w, h) {
	const raw = Buffer.alloc(h * (1 + w * 2));
	for (let y = 0; y < h; y++) {
		let o = y * (1 + w * 2);
		raw[o++] = 0; // filter: None
		for (let x = 0; x < w; x++) {
			raw[o++] = 255;
			raw[o++] = coverage[y * w + x];
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;   // bit depth
	ihdr[9] = 4;   // colour type: greyscale + alpha
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

// ---------- trim fully-transparent margins ----------
function trim(coverage, w, h, threshold = 2) {
	let minX = w, minY = h, maxX = -1, maxY = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (coverage[y * w + x] > threshold) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	if (maxX < 0) return { coverage, w, h };            // empty — keep as-is
	const nw = maxX - minX + 1;
	const nh = maxY - minY + 1;
	if (nw === w && nh === h) return { coverage, w, h };
	const out = new Uint8Array(nw * nh);
	for (let y = 0; y < nh; y++) {
		for (let x = 0; x < nw; x++) out[y * nw + x] = coverage[(y + minY) * w + (x + minX)];
	}
	return { coverage: out, w: nw, h: nh };
}

// ---------- manifest ----------
function loadManifest() {
	if (!fs.existsSync(MANIFEST)) {
		return { version: today(), packs: [] };
	}
	return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}
const today = () => new Date().toISOString().slice(0, 10);

// ---------- main ----------
function main() {
	const args = parseArgs(process.argv.slice(2));
	const abrPath = args._[0];
	if (!abrPath) {
		process.stderr.write('usage: node tools/abr-import.js <file.abr> [options]\n');
		process.exit(2);
	}

	const abr = parseAbr(fs.readFileSync(abrPath), { invert: Boolean(args.invert) });
	const packId = kebab(args.pack || path.basename(abrPath));
	const packLabel = args.label || titleCase(packId);
	const drop = args.dropSample || new Set();
	const sampleById = new Map(abr.samples.map((s) => [s.id, s]));
	const sampleOrdinal = new Map(abr.samples.map((s, idx) => [s.id, idx + 1]));
	process.stdout.write(`${path.basename(abrPath)} — ABR v${abr.version}.${abr.subversion}, ${abr.samples.length} sampled tip(s), ${abr.presets.length} preset(s)\n`);
	abr.samples.forEach((s, idx) => process.stdout.write(`  sample ${idx + 1}: ${s.width}x${s.height}${drop.has(idx + 1) ? '  (dropped)' : ''}\n`));

	const manifest = loadManifest();
	const existingIdx = manifest.packs.findIndex((p) => p.id === packId);
	const order = args.order != null
		? Number(args.order)
		: (existingIdx >= 0
			? manifest.packs[existingIdx].order
			: manifest.packs.reduce((m, p) => Math.max(m, p.order || 0), 0) + 10);

	const outDir = path.join(ROOT, 'images', 'brushes', packId);
	// The pack folder is generated output — rebuild it from scratch so renamed or
	// dropped tips never leave orphans behind.
	if (!args.dryRun) fs.rmSync(outDir, { recursive: true, force: true });
	const brushes = [];
	const written = [];
	const tipFileBySample = new Map();   // sampledId -> { src, width, height }
	const SCATTER_MAX = 10;              // engine fraction-of-size cap (PS ~1000%)

	// Write one PNG per unique sampled tip, reused by every preset that points at it.
	function tipFor(sample) {
		if (tipFileBySample.has(sample.id)) return tipFileBySample.get(sample.id);
		const t = trim(sample.coverage, sample.width, sample.height);
		const file = `${packId}-tip-${tipFileBySample.size + 1}.png`;
		if (!args.dryRun) {
			fs.mkdirSync(outDir, { recursive: true });
			fs.writeFileSync(path.join(outDir, file), encodePng(t.coverage, t.w, t.h));
		}
		written.push(`${packId}/${file}  ${t.w}x${t.h}`);
		const entry = { src: `images/brushes/${packId}/${file}`, width: t.w, height: t.h };
		tipFileBySample.set(sample.id, entry);
		return entry;
	}

	function toDynamics(preset, sample) {
		return {
			diameter: preset.diameter || Math.max(sample.width, sample.height),
			spacing: round(preset.spacing, 3),
			angle: preset.angle || 0,
			roundness: round(preset.roundness, 3),
			flipX: preset.flipX,
			flipY: preset.flipY,
			scatter: round(Math.min(SCATTER_MAX, preset.scatter), 3),
			bothAxes: preset.bothAxes,
			count: preset.count,
			countJitter: round(preset.countJitter, 3),
			sizeJitter: round(preset.sizeJitter, 3),
			angleJitter: round(preset.angleJitter, 3),
			// Tiny pixel-scale tips (Stardust is 9px) look like mush when the canvas
			// bilinear-scales them up — stamp them nearest-neighbour instead.
			smoothing: Math.max(sample.width, sample.height) > 32
		};
	}
	// How much of Photoshop's brush engine a preset actually uses — the picker
	// entry for a tip is the preset that uses the MOST (its "real" behaviour).
	const dynScore = (d) =>
		(d.scatter > 0) + (d.sizeJitter > 0) + (d.countJitter > 0) + (d.angleJitter > 0) +
		(d.count > 1) + (d.angle !== 0) + (d.roundness < 1) + (d.flipX || d.flipY ? 1 : 0);
	const isPlain = (d) => dynScore(d) === 0;

	// Group presets by the tip they stamp, preserving first-seen tip order.
	const tipOrder = [];
	const presetsByTip = new Map();
	abr.presets.forEach((preset, i) => {
		const sample = preset.sampledId ? sampleById.get(preset.sampledId) : abr.samples[i];
		if (!sample) {
			process.stderr.write(`  ! no sample bitmap for preset "${preset.name}" — skipped\n`);
			return;
		}
		if (drop.has(sampleOrdinal.get(sample.id))) return;
		if (/redistribut|do not share|no ?redist/i.test(preset.name || '')) {
			process.stderr.write(`  * preset carries a redistribution notice: "${preset.name}"\n`);
		}
		if (!presetsByTip.has(sample.id)) { presetsByTip.set(sample.id, []); tipOrder.push(sample); }
		presetsByTip.get(sample.id).push({ preset, dynamics: toDynamics(preset, sample) });
	});

	// Per tip: keep the richest preset (default), or every distinct one
	// (--all-presets). --keep-plain also emits the zero-dynamics preset as a
	// separate "<Pack> Stamp" entry when the winner isn't already plain.
	const picked = [];  // { sample, dynamics, plain }
	tipOrder.forEach((sample) => {
		const entries = presetsByTip.get(sample.id);
		if (args.allPresets) {
			const seen = new Set();
			entries.forEach(({ dynamics }) => {
				const sig = JSON.stringify(dynamics);
				if (seen.has(sig)) return;
				seen.add(sig);
				picked.push({ sample, dynamics, plain: isPlain(dynamics) });
			});
			return;
		}
		const winner = entries.reduce((best, e) => (dynScore(e.dynamics) > dynScore(best.dynamics) ? e : best), entries[0]);
		picked.push({ sample, dynamics: winner.dynamics, plain: isPlain(winner.dynamics) });
		if (args.keepPlain && !isPlain(winner.dynamics)) {
			const plain = entries.find((e) => isPlain(e.dynamics));
			if (plain) picked.push({ sample, dynamics: plain.dynamics, plain: true });
		}
	});

	const realCount = picked.filter((p) => !p.plain).length;
	// "Stamp" only distinguishes a plain fallback from a scatter brush in the same
	// pack. A pack that is ALL plain tips (Swirlies, Sparkles) just numbers them.
	const suffixPlain = realCount > 0;
	const primaryCount = suffixPlain ? realCount : picked.length;
	let primaryN = 0, plainN = 0;
	picked.forEach((p, idx) => {
		let label;
		if (p.plain && suffixPlain) {
			plainN++;
			label = picked.filter((q) => q.plain).length > 1 ? `${packLabel} Stamp ${plainN}` : `${packLabel} Stamp`;
		} else {
			primaryN++;
			label = primaryCount > 1 ? `${packLabel} ${primaryN}` : packLabel;
		}
		const n = brushes.length + 1;
		brushes.push({
			id: uniqueId(`${packId}-${n}`, brushes),
			label,
			order: idx,
			tags: args.tags.slice(),
			categories: args.categories.slice(),
			tip: tipFor(p.sample),
			dynamics: p.dynamics
		});
	});

	const pack = {
		id: packId,
		label: packLabel,
		order,
		source: path.basename(abrPath),
		attribution: {
			author: args.author || '',
			authorUrl: args.authorUrl || '',
			archivedBy: args.archivedBy || '',
			archiveUrl: args.archiveUrl || '',
			license: args.license || 'unknown',
			notes: args.notes || ''
		},
		brushes
	};

	if (args.check || args.checkDir) runCheck(args.checkDir || path.dirname(abrPath), brushes);

	if (existingIdx >= 0) manifest.packs[existingIdx] = pack;
	else manifest.packs.push(pack);
	manifest.packs.sort((a, b) => (a.order || 0) - (b.order || 0));
	manifest.version = today();

	process.stdout.write(`pack "${packId}" — ${brushes.length} brush(es)\n`);
	written.forEach((w) => process.stdout.write(`  ${w}\n`));
	if (args.dryRun) {
		process.stdout.write('\n--dry-run: manifest NOT written. Would be:\n');
		process.stdout.write(JSON.stringify(pack, null, '\t') + '\n');
		return;
	}
	fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
	fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, '\t') + '\n');
	process.stdout.write(`\nwrote ${path.relative(ROOT, MANIFEST)} (${manifest.packs.length} packs)\n`);
}

function uniqueId(want, brushes) {
	let id = want, n = 2;
	while (brushes.some((b) => b.id === id)) id = `${want}-${n++}`;
	return id;
}
const round = (v, d) => { const f = 10 ** d; return Math.round((Number(v) || 0) * f) / f; };

// Sibling *png/ folders the pack shipped with, for a size sanity check.
function runCheck(dir, brushes) {
	const siblings = fs.readdirSync(dir).filter((d) => /png$/i.test(d) && fs.statSync(path.join(dir, d)).isDirectory());
	if (!siblings.length) { process.stderr.write('  --check: no sibling *png/ folder found\n'); return; }
	const pngs = [];
	for (const s of siblings) {
		for (const f of fs.readdirSync(path.join(dir, s))) {
			if (f.toLowerCase().endsWith('.png')) pngs.push(pngSize(path.join(dir, s, f)));
		}
	}
	// Decoded tips are trimmed, siblings usually aren't — so only assert the
	// decoded tip is never LARGER than any sibling, and that counts match.
	const maxW = Math.max(...pngs.map((p) => p.w));
	const maxH = Math.max(...pngs.map((p) => p.h));
	let ok = pngs.length === brushes.length;
	for (const b of brushes) {
		if (b.tip.width > maxW + 1 || b.tip.height > maxH + 1) ok = false;
	}
	process.stdout.write(`  --check: ${brushes.length} decoded vs ${pngs.length} sibling PNGs — ${ok ? 'OK' : 'MISMATCH'}\n`);
	if (!ok) process.exitCode = 1;
}
function pngSize(p) {
	const b = fs.readFileSync(p);
	return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

main();
