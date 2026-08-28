// ============================================
// ABR (Photoshop brush) reader — shared library
// ============================================
// Pure Node, zero dependencies. Parses Adobe ABR v6.1 / v6.2 files into:
//   { version, subversion, samples: [{ id, width, height, coverage:Uint8Array }],
//     presets: [{ name, sampledId, diameter, spacing, angle, roundness,
//                 flipX, flipY, scatter, bothAxes, count, countJitter,
//                 sizeJitter, angleJitter }] }
// coverage is 8-bit, row-major, 0 = no paint … 255 = full paint (already
// de-inverted to match how the app stamps a tip).
//
// Layout facts (cross-checked against GIMP app/core/gimpbrush-load.c):
//   - file: uint16 version, uint16 subversion (BE)
//   - sections: "8BIM" + 4-char tag + uint32 length + body (+ pad to even)
//   - "samp": repeated entries, each:
//       uint32 brushSize  (entry length; next entry starts at
//                          ceil(brushSize/4)*4 past THIS point)
//       skip 47 bytes (subversion 1) / 301 bytes (subversion 2)
//       int32 top,left,bottom,right ; int16 depthBits ; int8 compress
//       depth = depthBits >> 3 ; width=right-left ; height=bottom-top
//       compress 0 -> raw ; 1 -> PSD PackBits, `height` row-lengths (uint16)
//                                then the packed rows
//   - "desc": a 4-byte descriptor version (16) then a standard Action
//     Descriptor. The brush-engine params live under Brsh -> VlLs -> each
//     brushPreset object.

'use strict';

// ---------- little binary cursor ----------
class Reader {
	constructor(buf, pos = 0) { this.b = buf; this.p = pos; }
	get eof() { return this.p >= this.b.length; }
	u8() { return this.b[this.p++]; }
	i8() { const v = this.b.readInt8(this.p); this.p += 1; return v; }
	u16() { const v = this.b.readUInt16BE(this.p); this.p += 2; return v; }
	u32() { const v = this.b.readUInt32BE(this.p); this.p += 4; return v; }
	i32() { const v = this.b.readInt32BE(this.p); this.p += 4; return v; }
	f64() { const v = this.b.readDoubleBE(this.p); this.p += 8; return v; }
	bytes(n) { const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
	skip(n) { this.p += n; }
	ascii(n) { return this.bytes(n).toString('latin1'); }
}

// ---------- 8BIM section index ----------
function readSections(buf) {
	const r = new Reader(buf, 0);
	const version = r.u16();
	const subversion = r.u16();
	const sections = {};
	while (r.p + 12 <= buf.length) {
		const sig = r.ascii(4);
		if (sig !== '8BIM') break;
		const tag = r.ascii(4);
		const len = r.u32();
		sections[tag] = buf.subarray(r.p, r.p + len);
		r.p += len + (len % 2);
	}
	return { version, subversion, sections };
}

// ---------- Action Descriptor parser (enough of it for brush presets) ----------
function readUnicodeString(r) {
	const n = r.u32();
	let s = '';
	for (let i = 0; i < n; i++) {
		const code = r.u16();
		if (code) s += String.fromCharCode(code);
	}
	return s;
}
function readKey(r) {
	const len = r.u32() || 4;
	return r.ascii(len);
}
function readItem(r) {
	const type = r.ascii(4);
	switch (type) {
		case 'Objc': case 'GlbO': {
			readUnicodeString(r);           // class name (unused)
			readKey(r);                     // classID
			const count = r.u32();
			const obj = {};
			for (let i = 0; i < count; i++) obj[readKey(r)] = readItem(r);
			return obj;
		}
		case 'VlLs': {
			const count = r.u32();
			const arr = [];
			for (let i = 0; i < count; i++) arr.push(readItem(r));
			return arr;
		}
		case 'doub': return r.f64();
		case 'UntF': { const unit = r.ascii(4); return { unit, value: r.f64() }; }
		case 'TEXT': return readUnicodeString(r);
		case 'enum': return { type: readKey(r), value: readKey(r) };
		case 'long': return r.i32();
		case 'comp': return r.f64();                            // 64-bit int, precision is fine here
		case 'bool': return r.u8() !== 0;
		case 'tdta': { const n = r.u32(); r.skip(n); return null; }
		default: throw new Error(`Unknown descriptor item type "${type}" at ${r.p}`);
	}
}
function parseDescriptor(body) {
	const r = new Reader(body, 4);       // skip descriptor version (16)
	readUnicodeString(r);                // name
	readKey(r);                          // classID
	const count = r.u32();
	const out = {};
	for (let i = 0; i < count; i++) out[readKey(r)] = readItem(r);
	return out;
}

const num = (v) => (v && typeof v === 'object' && 'value' in v) ? v.value : v;
// A Photoshop "brVr" dynamics object: { bVTy: control type, fStp, jitter (#Prc) }.
// We only take the jitter amount (0..1000 as a percent); the pressure/tilt/fade
// control type is not modelled by the mask brush.
const jitterOf = (obj) => { const j = num(obj && obj.jitter); return Number.isFinite(j) ? j / 100 : 0; };

// One Photoshop brushPreset -> our dynamics shape. A .abr commonly stores the
// SAME sampled tip several times as different presets (plain, +scatter,
// +everything); the importer dedupes identical results.
function mapPreset(preset) {
	const tip = preset['Brsh'] || {};
	const scatterOn = preset['useScatter'] === true;
	const tipDynOn = preset['useTipDynamics'] === true;
	const pct = (v, d) => { const n = num(v); return Number.isFinite(n) ? n / 100 : d; };

	// When Scattering is on, the preset carries its OWN spacing / count and two
	// brVr objects as direct siblings (not nested).
	const tipSpacing = pct(tip['Spcn'], 0.25);
	const spacing = scatterOn && Number.isFinite(num(preset['Spcn'])) ? num(preset['Spcn']) / 100 : tipSpacing;

	return {
		name: preset['Nm  '] || tip['Nm  '] || '',
		sampledId: tip['sampledData'] || null,
		diameter: Math.round(num(tip['Dmtr']) || 0),
		spacing,
		angle: num(tip['Angl']) || 0,
		roundness: pct(tip['Rndn'], 1),
		flipX: tip['flipX'] === true,
		flipY: tip['flipY'] === true,
		// Scattering
		scatter: scatterOn ? jitterOf(preset['scatterDynamics']) : 0,        // 0..10 (PS 0..1000%)
		bothAxes: scatterOn ? (preset['bothAxes'] === true) : true,
		count: scatterOn ? Math.max(1, Math.round(num(preset['Cnt ']) || 1)) : 1,
		countJitter: scatterOn ? jitterOf(preset['countDynamics']) : 0,       // 0..1
		// Shape Dynamics
		sizeJitter: tipDynOn ? jitterOf(preset['szVr']) : 0,                  // 0..1
		angleJitter: tipDynOn ? jitterOf(preset['angleDynamics']) : 0,        // 0..1
		// Colour Dynamics — captured for reference only; the mask brush paints
		// coverage, not colour, so MaskEditor ignores these.
		colorDynamics: preset['useColorDynamics'] === true ? {
			hue: pct(preset['H   '], 0),
			saturation: pct(preset['Strt'], 0),
			brightness: pct(preset['Brgh'], 0)
		} : null
	};
}

// ---------- samp decoder ----------
function unpackBits(r, expected) {
	const out = Buffer.allocUnsafe(expected);
	let o = 0;
	while (o < expected) {
		const n = r.i8();
		if (n >= 0) {
			const c = n + 1;
			r.bytes(c).copy(out, o); o += c;
		} else if (n !== -128) {
			const c = 1 - n;
			const v = r.u8();
			out.fill(v, o, o + c); o += c;
		}
	}
	return out;
}

function readSamples(sampBody, subversion, invert = false) {
	const r = new Reader(sampBody, 0);
	const samples = [];
	while (r.p + 4 <= sampBody.length) {
		const start = r.p;
		const brushSize = r.u32();
		if (brushSize <= 0) break;
		let end = start + 4 + brushSize;
		while (end % 4 !== 0) end++;

		r.skip(subversion === 1 ? 47 : 301);
		const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
		const depth = r.u16() >> 3;
		const compress = r.u8();
		const width = right - left;
		const height = bottom - top;
		if (width < 1 || height < 1 || width > 20000 || height > 20000) {
			throw new Error(`samp entry out of range: ${width}x${height}`);
		}

		let raw;
		if (!compress) {
			raw = Buffer.from(r.bytes(width * height * depth));
			if (depth === 2) {
				const eight = Buffer.allocUnsafe(width * height);
				for (let i = 0; i < eight.length; i++) eight[i] = raw.readUInt16BE(i * 2) >> 8;
				raw = eight;
			}
		} else {
			const rowLens = [];
			for (let y = 0; y < height; y++) rowLens.push(r.u16());
			raw = Buffer.allocUnsafe(width * height);
			let o = 0;
			for (let y = 0; y < height; y++) {
				const rowEnd = r.p + rowLens[y];
				const rr = new Reader(sampBody, r.p);
				const row = unpackBits(rr, width);
				row.copy(raw, o); o += width;
				r.p = rowEnd;
			}
		}

		// These packs store straight coverage: 0 = empty, 255 = full paint —
		// which already matches how the app blends a white stamp (alpha = value).
		// `invert` is here for packs that ship the tip the other way round.
		const coverage = new Uint8Array(width * height);
		if (invert) for (let i = 0; i < coverage.length; i++) coverage[i] = 255 - raw[i];
		else coverage.set(raw.subarray(0, coverage.length));

		samples.push({ id: hyphenateId(sampBody, start), width, height, coverage });
		r.p = end;
	}
	return samples;
}

// The sample's UUID string lives right after brushSize, as a Pascal string
// (1 length byte + ASCII). Pull it so presets can be matched by `sampledData`.
function hyphenateId(body, entryStart) {
	const len = body[entryStart + 4];
	return body.subarray(entryStart + 5, entryStart + 5 + len).toString('latin1');
}

// ---------- public entry ----------
function parseAbr(buf, { invert = false } = {}) {
	const { version, subversion, sections } = readSections(buf);
	if (version !== 6 && version !== 10) {
		throw new Error(`Unsupported ABR version ${version} (need 6). Re-save from Photoshop as ABR.`);
	}
	const samples = sections.samp ? readSamples(sections.samp, subversion, invert) : [];
	let presets = [];
	if (sections.desc) {
		const d = parseDescriptor(sections.desc);
		const list = d['Brsh'];
		if (Array.isArray(list)) presets = list.map(mapPreset);
	}
	return { version, subversion, samples, presets };
}

module.exports = { parseAbr, parseDescriptor, readSections };
