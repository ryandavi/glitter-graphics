'use strict';

class ImageFillStore {
	constructor(editor) {
		this.editor = editor;
		this.assets = new Map();
	}

	async register(imageRef, payload) {
		if (!imageRef || !payload?.dataUrl) return null;
		const image = await loadImageElement(payload.dataUrl);
		const asset = {
			image,
			url: payload.dataUrl,
			dataUrl: payload.dataUrl,
			name: payload.name || 'Image',
			mimeType: payload.mimeType || 'image/png',
			// Multi-frame GIFs are decoded only when an export needs them
			// (SceneCompositor), like glitter and sticker GIFs. isAnimated is a
			// cheap up-front probe (readGifTiming decodes no pixels) so the
			// exporter knows which slots to ask for.
			isAnimated: false
		};
		if (asset.mimeType === 'image/gif') {
			try {
				asset.isAnimated = await this._probeAnimatedGif(payload.dataUrl);
			} catch (error) {
				console.warn('Animated GIF probe failed; treating fill as static.', error);
			}
		}
		this.assets.set(imageRef, asset);
		this.timingRevision = (this.timingRevision || 0) + 1;
		if (!this.editor.loopEstimatePending) this.editor.scheduleExportDuration?.();
		return asset;
	}

	async _probeAnimatedGif(dataUrl) {
		return readGifTiming(await fetchGifBytes(dataUrl)).frameCount > 1;
	}

	get(imageRef) {
		return imageRef ? this.assets.get(imageRef) || null : null;
	}

	clear() {
		this.assets.clear();
		this.timingRevision = (this.timingRevision || 0) + 1;
	}

	prune() {
		const used = new Set();
		const collect = (layers) => (layers || []).forEach(layer => {
			for (const ref of getLayerAssetRefs(layer)) if (ref.kind === 'image') used.add(ref.id);
		});
		collect(this.editor.layers);
		(this.editor.historyManager?.history || []).forEach((state) => collect(state.layers));
		Array.from(this.assets.keys()).forEach((imageRef) => {
			if (!used.has(imageRef)) this.assets.delete(imageRef);
		});
	}

}
