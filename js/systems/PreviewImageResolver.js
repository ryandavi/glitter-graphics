'use strict';

class PreviewImageResolver {
	constructor(editor) {
		this.editor = editor;
		this.previewFrames = new Map();
		this.retimedPreviews = new Map();
		this.retimedUrls = new Set();
		this.shownPreviews = new WeakMap();
		APP_MEMORY_LEDGER.register({ id: 'retimed-gifs', label: 'Retimed preview GIFs', category: 'Preview caches', measure: () => Array.from(this.retimedPreviews.values()).reduce((sum, entry) => sum + entry.bytes, 0) });
	}

	// The URL a preview element shows for an animated source: a still while
	// motion is paused, a retimed copy when this use of the GIF stores a cycle
	// length, otherwise the file. `use` is `{ element, timingRecord,
	// sourceIdentity }` as the export's authored descriptor names them.
	getPreviewImageUrl(url, use = null) {
		if (!url) return url;
		if (!this.editor.animationTicker.paused) {
			if (use?.timingRecord?.gifCycleMs) return this.getRetimedPreviewUrl(url, use);
			if (use?.element) this.shownPreviews.delete(use.element);
			return url;
		}
		let entry = this.previewFrames.get(url);
		if (!entry) {
			entry = { url: null };
			this.previewFrames.set(url, entry);
			this.loadPreviewFrame(url).then(frameUrl => {
				entry.url = frameUrl;
				if (this.previewFrames.get(url) === entry && this.editor.animationTicker.paused) this.editor.requestPreviewUpdate();
			}).catch(error => {
				entry.url = url;
				console.warn('Could not pause preview image:', error);
			});
		}
		return entry.url || url;
	}

	// A copy of the file with the export's own delays for this use written
	// into it. Until that copy has decoded, the element keeps the URL it
	// already shows; the copy then replaces it in one swap.
	getRetimedPreviewUrl(url, use) {
		const gifCycleMs = use.timingRecord.gifCycleMs;
		const key = `${gifCycleMs}|${url}`;
		let entry = this.retimedPreviews.get(key);
		if (entry) this.retimedPreviews.delete(key);
		else {
			entry = { url: null, bytes: 0, settled: false };
			// The record may change again before the file has loaded.
			entry.ready = this.buildRetimedPreview(url, { sourceIdentity: use.sourceIdentity, timingRecord: { gifCycleMs } }).then((built) => {
				Object.assign(entry, built, { settled: true });
				if (this.retimedPreviews.get(key) !== entry) this.releaseRetimedPreview(entry);
				else this.editor.requestPreviewUpdate();
			});
		}
		this.retimedPreviews.set(key, entry);
		while (this.retimedPreviews.size > CONFIG.memory.retimedGifEntries) {
			const [oldest, evicted] = this.retimedPreviews.entries().next().value;
			this.retimedPreviews.delete(oldest);
			this.releaseRetimedPreview(evicted);
		}
		const shown = this.shownPreviews.get(use.element);
		const kept = !entry.settled && shown?.source === url && (shown.url === url || this.retimedUrls.has(shown.url));
		const next = kept ? shown.url : entry.url || url;
		if (use.element) this.shownPreviews.set(use.element, { source: url, url: next });
		return next;
	}

	async buildRetimedPreview(url, use) {
		let objectUrl = null;
		try {
			const bytes = await fetchGifBytes(url);
			const timing = this.editor.sceneCompositor.getAuthoredPassTiming(use, readGifTiming(bytes), CONFIG.export.defaults.frameDelay);
			if (timing.delays === timing.file) return {};
			const retimed = retimeGifBytes(bytes, timing.delays);
			objectUrl = URL.createObjectURL(new Blob([retimed], { type: 'image/gif' }));
			await loadImageElement(objectUrl);
			this.retimedUrls.add(objectUrl);
			return { url: objectUrl, bytes: retimed.byteLength };
		} catch (error) {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			console.warn('Could not retime preview image:', error);
			return {};
		}
	}

	releaseRetimedPreview(entry) {
		if (!entry.url) return;
		this.retimedUrls.delete(entry.url);
		URL.revokeObjectURL(entry.url);
		entry.url = null;
	}

	// Resolves once every retimed copy asked for so far has decoded.
	retimedPreviewsSettled() {
		return Promise.all(Array.from(this.retimedPreviews.values(), (entry) => entry.ready));
	}

	async loadPreviewFrame(url) {
		const bytes = await fetchGifBytes(url);
		const canvas = createAppCanvas(0, 0, 'systems/AnimationPanelController');
		if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) {
			const reader = openGifReader(bytes);
			canvas.width = reader.width;
			canvas.height = reader.height;
			const pixels = new Uint8ClampedArray(reader.width * reader.height * 4);
			reader.decodeAndBlitFrameRGBA(0, pixels);
			canvas.getContext('2d').putImageData(new ImageData(pixels, reader.width, reader.height), 0, 0);
		} else {
			const image = await loadImageElement(url);
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			canvas.getContext('2d').drawImage(image, 0, 0);
		}
		return canvas.toDataURL('image/png');
	}

}
