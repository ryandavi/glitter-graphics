// ============================================
// ATTRIBUTION
// ============================================
// One shape for "who made this / where it came from / how it's licensed",
// shared by every asset library (brushes, fonts, stickers, shapes) and by the
// categories an asset inherits from. Empty fields are dropped: a missing key
// and "" mean the same thing — no attribution.
//
//   author     creator / artist / foundry
//   authorUrl  link for `author`
//   source     where this copy came from (archive, pack, re-share)
//   sourceUrl  link for `source`
//   license    one of LICENSES ids, or omitted when unknown
//   notes      free text ("will remove on request", track / film, …)
//
// Resolution order everywhere is item over category over manifest-default,
// via Attribution.resolve(...layers) — later layers win per field.

const Attribution = {
	FIELDS: Object.freeze(['author', 'authorUrl', 'source', 'sourceUrl', 'license', 'notes']),

	// id -> display label, in admin dropdown order.
	LICENSES: Object.freeze([
		['unknown', 'License unknown'],
		['personal-use', 'Personal use only'],
		['commercial', 'Commercial use OK'],
		['public-domain', 'Public domain'],
		['CC0-1.0', 'CC0 1.0'],
		['CC-BY-4.0', 'CC BY 4.0'],
		['CC-BY-SA-4.0', 'CC BY-SA 4.0'],
		['OFL-1.1', 'SIL Open Font License 1.1'],
		['system', 'System font']
	]),

	get KNOWN_LICENSES() {
		return this._known || (this._known = new Set(this.LICENSES.map(([id]) => id)));
	},

	licenseLabel(license) {
		const hit = this.LICENSES.find(([id]) => id === license);
		return hit ? hit[1] : (license || '');
	},

	// Normalize one raw attribution object. Returns null when nothing usable is
	// present. Throws on an unrecognized license so a typo fails loudly at load.
	sanitize(raw, ownerId = 'attribution') {
		if (!raw || typeof raw !== 'object') return null;
		const str = (value) => (typeof value === 'string' ? value.trim() : '');
		const out = {};
		for (const key of this.FIELDS) {
			if (key === 'license') continue;
			const value = str(raw[key]);
			if (value) out[key] = value;
		}
		const license = str(raw.license);
		if (license) {
			if (!this.KNOWN_LICENSES.has(license)) {
				throw new Error(`${ownerId}: unknown attribution license "${license}"`);
			}
			out.license = license;
		}
		return Object.keys(out).length ? out : null;
	},

	// Accept a legacy free-text string or a structured object.
	coerce(raw, ownerId = 'attribution') {
		if (typeof raw === 'string') {
			const notes = raw.trim();
			return notes ? { notes } : null;
		}
		return this.sanitize(raw, ownerId);
	},

	// Merge attribution layers left -> right (later wins per field), e.g.
	// resolve(categoryAttribution, itemAttribution). Skips null / empty layers.
	resolve(...layers) {
		const out = {};
		for (const layer of layers) {
			if (!layer || typeof layer !== 'object') continue;
			for (const key of this.FIELDS) {
				const value = typeof layer[key] === 'string' ? layer[key].trim() : layer[key];
				if (value) out[key] = value;
			}
		}
		return Object.keys(out).length ? out : null;
	},

	isEmpty(attr) {
		return !this.resolve(attr);
	},

	// One-line human credit: "Ryan Davis · via Belle — Salvaged · CC BY 4.0".
	creditLine(attr) {
		const a = this.resolve(attr);
		if (!a) return '';
		const parts = [];
		if (a.author) parts.push(a.author);
		if (a.source) parts.push(`via ${a.source}`);
		if (a.license && a.license !== 'unknown' && a.license !== 'system') {
			parts.push(this.licenseLabel(a.license));
		} else if (a.license === 'unknown') {
			parts.push('license unknown');
		}
		return parts.join(' · ');
	},

	// Shared "Source & usage" block for the asset browser's per-collection credit
	// (BrushTipManager packs, ContentManager sticker categories). Returns null
	// when there is nothing to credit. DOM only — styling is .asset-collection-credit
	// in css/_assets.scss.
	buildCreditElement(attr, { heading = 'Source & usage', bylineVerb = 'Created by' } = {}) {
		const a = this.resolve(attr);
		if (!a) return null;

		const info = document.createElement('div');
		info.className = 'asset-collection-credit';

		const headingEl = document.createElement('div');
		headingEl.className = 'asset-collection-credit-heading property-group-label';
		headingEl.textContent = heading;
		info.appendChild(headingEl);

		const link = (text, href) => {
			const el = document.createElement('a');
			el.href = href;
			el.target = '_blank';
			el.rel = 'noopener';
			el.textContent = text;
			return el;
		};

		if (a.author) {
			const byline = document.createElement('div');
			byline.className = 'asset-collection-credit-byline';
			byline.append(`${bylineVerb} `);
			byline.appendChild(a.authorUrl ? link(a.author, a.authorUrl) : document.createTextNode(a.author));
			info.appendChild(byline);
		}

		const meta = document.createElement('div');
		meta.className = 'asset-collection-credit-meta';
		if (a.license) {
			const license = document.createElement('span');
			license.textContent = this.licenseLabel(a.license);
			meta.appendChild(license);
		}
		if (a.source) {
			const via = document.createElement('span');
			via.textContent = `Via ${a.source}`;
			meta.appendChild(via);
		}
		if (meta.childElementCount) info.appendChild(meta);

		if (a.notes) {
			const notes = document.createElement('details');
			notes.className = 'asset-collection-credit-notes';
			const summary = document.createElement('summary');
			summary.textContent = 'Note';
			const copy = document.createElement('div');
			copy.textContent = a.notes;
			notes.append(summary, copy);
			info.appendChild(notes);
		}

		const links = document.createElement('div');
		links.className = 'asset-collection-credit-links';
		if (a.sourceUrl) links.appendChild(link('View source', a.sourceUrl));
		if (links.childElementCount) info.appendChild(links);

		return info;
	}
};
