// ============================================
// STICKER MULTI-RESOLUTION SUPPORT
// ============================================
// See docs/STICKER-MULTI-RESOLUTION-PLAN.md. Stickers with `variantUrls` (a
// {"<measured width>": {url, width, height}} map from the sticker's detail
// JSON) can swap to a higher- or lower-resolution source file as they're
// resized, the way Twitter's own sticker viewer does: crisp at rest, no
// mid-drag reloading.

// One HTMLImageElement per URL, shared by the live canvas and the export
// path, so swapping between resolutions already seen doesn't re-decode.
const AssetImageCache = {
	_cache: new Map(),

	get(url) {
		if (!url) return Promise.reject(new Error('AssetImageCache: no url given'));
		if (!this._cache.has(url)) {
			this._cache.set(url, new Promise((resolve, reject) => {
				const img = new Image();
				img.decoding = 'async';
				img.onload = () => resolve(img);
				img.onerror = () => {
					this._cache.delete(url);
					reject(new Error(`Failed to load image: ${url}`));
				};
				img.src = url;
			}));
		}
		return this._cache.get(url);
	}
};

const StickerVariants = {
	// Picks the smallest available source whose measured width is >= the
	// rendered width, or the largest available if none is big enough.
	// `variantUrls` may be null/empty (everything pre-migration) — in that
	// case the base is always the answer.
	pickBestUrl(baseUrl, baseWidth, variantUrls, renderedWidth) {
		const candidates = [{ url: baseUrl, width: Number(baseWidth) || 0 }];
		if (variantUrls && typeof variantUrls === 'object') {
			for (const entry of Object.values(variantUrls)) {
				if (entry?.url && Number.isFinite(entry.width)) {
					candidates.push({ url: entry.url, width: entry.width });
				}
			}
		}
		if (candidates.length === 1) return baseUrl;

		const need = Math.max(1, Math.ceil(Number(renderedWidth) || 0));
		const fits = candidates.filter((candidate) => candidate.width >= need).sort((a, b) => a.width - b.width);
		if (fits.length) return fits[0].url;
		return candidates.reduce((best, candidate) => (candidate.width > best.width ? candidate : best)).url;
	}
};
