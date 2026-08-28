// ============================================
// BRUSH LIBRARY  (raster / image-tip brushes)
// ============================================
// The vector brush tips (round, square, calligraphy, star, heart) stay in
// ShapeLibrary — geometry shared with the Shape tool. This module owns the OTHER
// kind: sampled bitmap tips imported from Photoshop .abr packs
// (see tools/abr-import.js), each carrying its own scatter / jitter defaults and
// attribution.
//
// Single source of truth: data/brushes.json drives the picker thumbnail, the
// on-canvas stamp (MaskEditor reads getTipCanvas + defaultDynamics), the brush
// cursor silhouette, and the credit line — nothing about a raster brush is
// declared twice.
//
// assets() is the gallery-facing catalog that unifies vector and raster tips.

const BrushLibrary = {
	PACKS: [],              // validated manifest packs, in render order
	BRUSHES: {},            // brushId -> { packId, label, tip, dynamics, tags, categories, sourceName, attribution? }
	manifestPromise: null,
	_tipCanvas: new Map(),  // brushId -> HTMLCanvasElement (normalised, native res)
	_tipPromise: new Map(), // brushId -> Promise<HTMLCanvasElement>

	// Fallback for any dynamics key a brush omits. Also the shape MaskEditor uses
	// for a vector tip, so its dab engine is kind-agnostic (scatter 0, count 1).
	DEFAULT_DYNAMICS: Object.freeze({
		diameter: 0,        // 0 => "use the tip's larger side"
		spacing: 0.25,
		angle: 0,
		roundness: 1,
		flipX: false,
		flipY: false,
		scatter: 0,
		bothAxes: true,
		count: 1,
		countJitter: 0,
		sizeJitter: 0,
		angleJitter: 0,
		smoothing: true       // bilinear tip scaling; false = nearest-neighbour (crisp pixels)
	}),

	KNOWN_LICENSES: new Set(['unknown', 'personal-use', 'commercial', 'public-domain', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0']),

	async loadManifest() {
		if (this.manifestPromise) return this.manifestPromise;

		this.manifestPromise = (async () => {
			const url = CONFIG.tools.maskBrush.rasterBrushes.manifest;
			const response = await fetch(url, { cache: 'no-store' });
			if (!response.ok) throw new Error(`Failed to load brushes manifest (${response.status})`);
			const manifest = await response.json();
			this.applyManifest(manifest);
			await this._preloadTips();
			return manifest;
		})();

		try {
			return await this.manifestPromise;
		} catch (error) {
			this.manifestPromise = null;
			throw error;
		}
	},

	applyManifest(manifest) {
		if (typeof manifest?.version !== 'string' || !Array.isArray(manifest?.packs)) {
			throw new Error('Brushes manifest needs a version string and a packs array');
		}

		// Vector tip ids are reserved — a raster brush must never reuse one.
		const vectorIds = new Set((ShapeLibrary.BRUSH_SHAPES || []).map((entry) => entry.id));
		const brushIds = new Set();
		const packIds = new Set();
		const packs = [];
		const brushes = {};

		manifest.packs.forEach((pack) => {
			if (!/^[a-z][a-z0-9-]*$/.test(pack?.id) || packIds.has(pack.id)) {
				throw new Error(`Brushes manifest has an invalid or duplicate pack id: ${pack?.id}`);
			}
			if (!pack.label || !Number.isFinite(pack.order)) {
				throw new Error(`Brush pack "${pack.id}" needs a label and a numeric order`);
			}
			const attribution = this._sanitizeAttribution(pack.attribution, pack.id);
			if (!Array.isArray(pack.brushes) || !pack.brushes.length) {
				throw new Error(`Brush pack "${pack.id}" has no brushes`);
			}
			packIds.add(pack.id);

			pack.brushes.forEach((brush) => {
				if (!/^[a-z][a-z0-9-]*$/.test(brush?.id) || brushIds.has(brush.id) || vectorIds.has(brush.id)) {
					throw new Error(`Brush pack "${pack.id}" has an invalid or colliding brush id: ${brush?.id}`);
				}
				if (!brush.label) throw new Error(`Brush "${brush.id}" needs a label`);
				const tip = brush.tip || {};
				if (typeof tip.src !== 'string' || !tip.src.startsWith('images/brushes/')) {
					throw new Error(`Brush "${brush.id}" tip.src must be under images/brushes/`);
				}
				if (!Number.isInteger(tip.width) || !Number.isInteger(tip.height) || tip.width < 1 || tip.height < 1) {
					throw new Error(`Brush "${brush.id}" needs positive integer tip dimensions`);
				}
				brushIds.add(brush.id);
				brushes[brush.id] = {
					packId: pack.id,
					label: brush.label,
					order: Number.isFinite(brush.order) ? brush.order : 0,
					sourceName: brush.sourceName || '',
					tags: this._slugList(brush.tags),
					categories: this._slugList(brush.categories),
					tip: { src: tip.src, width: tip.width, height: tip.height },
					dynamics: this._sanitizeDynamics(brush.dynamics),
					attribution: brush.attribution ? this._sanitizeAttribution(brush.attribution, brush.id) : null
				};
			});

			packs.push({
				id: pack.id,
				label: pack.label,
				order: pack.order,
				source: pack.source || '',
				attribution,
				brushIds: pack.brushes
					.slice()
					.sort((a, b) => (a.order || 0) - (b.order || 0))
					.map((brush) => brush.id)
			});
		});

		packs.sort((a, b) => a.order - b.order);

		this.PACKS = packs;
		this.BRUSHES = brushes;
	},

	_slugList(value) {
		if (!Array.isArray(value)) return [];
		return value
			.filter((entry) => typeof entry === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(entry))
			.slice(0, 24);
	},

	_sanitizeAttribution(raw, ownerId) {
		const a = raw && typeof raw === 'object' ? raw : {};
		const str = (value) => (typeof value === 'string' ? value.trim() : '');
		const license = str(a.license) || 'unknown';
		if (!this.KNOWN_LICENSES.has(license)) {
			throw new Error(`"${ownerId}" attribution.license "${license}" is not a known value`);
		}
		return {
			author: str(a.author),
			authorUrl: str(a.authorUrl),
			archivedBy: str(a.archivedBy),
			archiveUrl: str(a.archiveUrl),
			license,
			notes: str(a.notes)
		};
	},

	_sanitizeDynamics(raw) {
		const d = raw && typeof raw === 'object' ? raw : {};
		const out = { ...this.DEFAULT_DYNAMICS };
		const clampNum = (value, lo, hi, fallback) => (Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback);
		out.diameter = Number.isFinite(d.diameter) && d.diameter > 0 ? Math.round(d.diameter) : 0;
		out.spacing = clampNum(d.spacing, 0.01, 4, out.spacing);
		out.angle = clampNum(d.angle, -360, 360, 0);
		out.roundness = clampNum(d.roundness, 0.05, 1, 1);
		out.flipX = d.flipX === true;
		out.flipY = d.flipY === true;
		out.scatter = clampNum(d.scatter, 0, 10, 0);   // fraction of brush size (Photoshop scatter goes to ~1000%)
		out.bothAxes = d.bothAxes !== false;
		out.count = Math.round(clampNum(d.count, 1, 32, 1));
		out.countJitter = clampNum(d.countJitter, 0, 1, 0);
		out.sizeJitter = clampNum(d.sizeJitter, 0, 1, 0);
		out.angleJitter = clampNum(d.angleJitter, 0, 1, 0);
		out.smoothing = d.smoothing !== false;
		return out;
	},

	// ----- lookups -----
	isRaster(id) { return Object.prototype.hasOwnProperty.call(this.BRUSHES, id); },
	get(id) { return this.BRUSHES[id] || null; },
	packById(id) { return this.PACKS.find((pack) => pack.id === id) || null; },

	assets() {
		const vector = (ShapeLibrary.BRUSH_SHAPES || []).map(({ id, label }) => ({
			id,
			name: label,
			category: 'basic',
			categories: ['basic'],
			thumbnailUrl: `data:image/svg+xml,${encodeURIComponent(ShapeLibrary.getIconSvg(id))}`,
			tags: ['basic', 'vector'],
			searchTerms: [id, label, 'basic', 'vector'],
			attribution: null,
			kind: 'vector'
		}));
		const raster = this.PACKS.flatMap((pack) => pack.brushIds.map((id) => {
			const brush = this.BRUSHES[id];
			return {
				id,
				name: brush.label,
				category: brush.packId,
				categories: [...brush.categories],
				thumbnailUrl: brush.tip.src,
				tags: [...brush.tags],
				searchTerms: [brush.packId, brush.sourceName, ...pack.label.split(/\s+/), ...brush.label.split(/\s+/), ...brush.tags, ...brush.categories],
				attribution: this.attributionFor(id),
				kind: 'raster'
			};
		}));
		return [...vector, ...raster];
	},

	// Manifest defaults merged onto the fallback shape. For a vector tip this is
	// just the neutral shape (scatter 0, count 1) so MaskEditor treats both kinds
	// through one code path.
	defaultDynamics(id) {
		const brush = this.BRUSHES[id];
		return brush ? { ...this.DEFAULT_DYNAMICS, ...brush.dynamics } : { ...this.DEFAULT_DYNAMICS };
	},

	// Brush override (if any) layered on the pack default. null for vector tips.
	attributionFor(id) {
		const brush = this.BRUSHES[id];
		if (!brush) return null;
		const pack = this.packById(brush.packId);
		return { ...(pack ? pack.attribution : {}), ...(brush.attribution || {}) };
	},

	// A one-line human credit, e.g. "bruisedxheart.org · archived by Belle — Salvaged · unknown licence".
	creditLine(id) {
		const a = this.attributionFor(id);
		if (!a) return '';
		const parts = [];
		if (a.author) parts.push(a.author);
		if (a.archivedBy) parts.push(`archived by ${a.archivedBy}`);
		if (a.license && a.license !== 'unknown') parts.push(`${a.license} licence`);
		else if (a.license === 'unknown') parts.push('licence unknown');
		return parts.join(' · ');
	},

	// ----- tip bitmaps -----
	// Native-resolution stamp canvas: white RGB, alpha = coverage. MaskEditor
	// scales / rotates this per dab. Cached; returns null until the image decodes
	// (MaskEditor falls back to skipping the stamp and re-renders on the promise).
	getTipCanvas(id) { return this._tipCanvas.get(id) || null; },

	loadTip(id) {
		if (this._tipCanvas.has(id)) return Promise.resolve(this._tipCanvas.get(id));
		if (this._tipPromise.has(id)) return this._tipPromise.get(id);
		const brush = this.BRUSHES[id];
		if (!brush) return Promise.reject(new Error(`Unknown raster brush "${id}"`));

		const promise = new Promise((resolve, reject) => {
			const image = new Image();
			image.decoding = 'async';
			image.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = brush.tip.width;
				canvas.height = brush.tip.height;
				const ctx = canvas.getContext('2d', { willReadFrequently: true });
				ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
				this._normalizeTip(ctx, canvas.width, canvas.height);
				this._tipCanvas.set(id, canvas);
				resolve(canvas);
			};
			image.onerror = () => reject(new Error(`Failed to load brush tip: ${brush.tip.src}`));
			image.src = brush.tip.src;
		});
		this._tipPromise.set(id, promise);
		return promise;
	},

	// Our importer already emits white+alpha, but a hand-dropped tip might be
	// opaque grayscale ink on white, or black on transparent. Force the invariant:
	// RGB = white, alpha = coverage (max of existing alpha and dark-ink luminance).
	_normalizeTip(ctx, w, h) {
		const image = ctx.getImageData(0, 0, w, h);
		const data = image.data;
		let alphaSeen = false;
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] !== 255) { alphaSeen = true; break; }
		}
		for (let i = 0; i < data.length; i += 4) {
			const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
			const inkFromLuma = 255 - Math.round(0.299 * r + 0.587 * g + 0.114 * b);
			const coverage = alphaSeen ? a : inkFromLuma;
			data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = coverage;
		}
		ctx.putImageData(image, 0, 0);
	},

	_preloadTips() {
		const ids = Object.keys(this.BRUSHES);
		return Promise.allSettled(ids.map((id) => this.loadTip(id)));
	},

	// Cursor silhouette markup for MaskEditor._syncCursorAppearance (raster tips).
	getCursorMarkup(id) {
		const brush = this.BRUSHES[id];
		if (!brush) return '';
		return `<img src="${brush.tip.src}" alt="" draggable="false">`;
	}
};
