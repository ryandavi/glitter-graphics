'use strict';

class ClipPreview {
	constructor(editor) {
		this.editor = editor;
		this.entries = new Map();
		document.addEventListener('pointermove', event => {
			if (event.buttons && [...this.entries.values()].some(entry => editor.layerManager.isLayerSelected(entry.base.id))) editor.requestPreviewUpdate();
		}, { passive: true });
		document.addEventListener('pointerup', () => this.refresh());
		document.addEventListener('pointercancel', () => this.refresh());
	}

	// Layer managers redraw their own element without a preview pass, so a
	// changed base is picked up here: after a pointer gesture and after every
	// committed edit (editor.saveState).
	refresh() {
		if (this.entries.size) this.editor.requestPreviewUpdate();
	}

	containsPoint(base, x, y) {
		return this.getHitPoints(base, x, y).length > 0;
	}

	getHitPoints(base, x, y) {
		const body = this.editor.getClipBodyCache().peek(base);
		if (!body) return [];
		return getClipRestPoints(this.editor, base, x, y).filter(point => point.x >= 0 && point.y >= 0 && point.x < body.width && point.y < body.height && body.getContext('2d').getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data[3] > 0);
	}

	reconcile(visibleLayers) {
		const editor = this.editor;
		const retained = new Set();
		for (const layer of visibleLayers) {
			const base = getClipBase(editor.layers, layer);
			const element = getLayerManagerForType(editor, layer.type)?.layerElements?.get(layer.id);
			if (!base || !element) continue;
			retained.add(layer.id);
			let entry = this.entries.get(layer.id);
			if (entry && entry.element !== element) {
				this.release(layer.id, entry);
				entry = null;
			}
			if (!entry) {
				const wrapper = document.createElement('div');
				wrapper.className = 'clip-wrapper';
				wrapper.style.visibility = 'hidden';
				wrapper.dataset.clipLayerId = layer.id;
				// The wrapper lives in the mask's space; this puts the layer back
				// in the document's.
				const content = document.createElement('div');
				content.className = 'clip-content';
				element.before(wrapper);
				wrapper.append(content);
				content.append(element);
				entry = { wrapper, content, element, key: null, space: null, url: null, pending: null, slow: false };
				this.entries.set(layer.id, entry);
			}
			entry.base = base;
			const wrapper = entry.wrapper;
			Object.assign(wrapper.style, { zIndex: editor.layerManager.getLayerZIndex(layer.id), mixBlendMode: GlitterBlendModes.forLayer(layer), opacity: base.visible === false ? '0' : String(base.opacity / 100) });
			this.placeMask(entry);
			element.style.mixBlendMode = 'normal';
			const key = getClipContentKey(editor, base);
			const dragging = editor.isLayerPointerInteractionActive?.() || getLayerManagerForType(editor, base.type)?.layerTransforms?.get(base.id)?.isDraggingHandle;
			if (!dragging) entry.slow = false;
			if (entry.key !== key && !entry.pending && !(dragging && entry.slow)) this.updateMask(entry, key);
			if (GlitterAnimation.isActive(GlitterAnimation.getLayerAnimations(base))) {
				editor.animationTicker.register(`clip-${layer.id}`, {
					getWrapper: () => wrapper,
					paint: elapsed => this.paintMotion(entry, elapsed)
				});
			} else {
				editor.animationTicker.unregister(`clip-${layer.id}`);
				this.paintMotion(entry, 0);
			}
		}
		for (const [id, entry] of this.entries) {
			if (retained.has(id)) continue;
			this.release(id, entry);
		}
	}

	// The wrapper takes the box of the mask it shows, and the content undoes
	// the turn that paintMotion gives that box.
	placeMask(entry) {
		const { width, height } = this.editor.originalCanvas;
		const space = entry.space || { x: 0, y: 0, width, height };
		Object.assign(entry.wrapper.style, { left: `${space.x}px`, top: `${space.y}px`, width: `${space.width}px`, height: `${space.height}px` });
		Object.assign(entry.content.style, {
			left: `${-space.x}px`, top: `${-space.y}px`, width: `${width}px`, height: `${height}px`,
			transform: entry.space ? `translate(${space.centerX}px, ${space.centerY}px) rotate(${-space.rotationRad}rad) translate(${-space.centerX}px, ${-space.centerY}px)` : ''
		});
	}

	async updateMask(entry, key) {
		const request = entry.pending = {};
		const started = performance.now();
		const done = this.editor.beginActivity('clip-preview', 'Updating clipping preview');
		try {
			const cache = this.editor.getClipBodyCache();
			const space = getClipPreviewSpace(this.editor, entry.base);
			// Picking reads the document-space body, so a turned base keeps both.
			const [body] = await Promise.all([cache.get(entry.base, { space }), space && cache.get(entry.base)]);
			const blob = await encodeCanvasToBlob(body);
			const url = URL.createObjectURL(blob);
			try {
				await loadImageElement(url);
				if (entry.pending !== request || !entry.wrapper.isConnected) { URL.revokeObjectURL(url); return; }
				const previous = entry.url;
				entry.wrapper.style.maskImage = `url("${url}")`;
				entry.wrapper.style.webkitMaskImage = `url("${url}")`;
				entry.url = url;
				entry.space = space;
				this.placeMask(entry);
				this.paintMotion(entry, GlitterAnimation.isActive(GlitterAnimation.getLayerAnimations(entry.base)) ? this.editor.animationTicker.getCurrentTime() : 0);
				entry.wrapper.style.visibility = '';
				entry.key = key;
				if (previous) URL.revokeObjectURL(previous);
			} catch (error) { URL.revokeObjectURL(url); throw error; }
			entry.slow = performance.now() - started > CONFIG.ui.live.rasterBudgetMs;
		} catch (error) {
			console.error('Clipping preview failed:', error);
			this.editor.showError('Could not update clipping preview');
		} finally {
			done();
			if (entry.pending === request) entry.pending = null;
			if (entry.wrapper.isConnected && entry.key && entry.key !== getClipContentKey(this.editor, entry.base)) this.editor.requestPreviewUpdate();
		}
	}

	paintMotion(entry, elapsed) {
		const { wrapper, base } = entry;
		const context = getLayerAnimationSamplingContext(this.editor, base);
		const sample = GlitterAnimation.sampleAt(GlitterAnimation.normalizeAnimations(this.editor.keyRecording?.previewAnimations(base) || GlitterAnimation.getLayerAnimations(base)), elapsed, context);
		const frame = getLayerFrame(this.editor, base);
		if (!frame) {
			wrapper.style.opacity = '0';
			wrapper._motionCopies?.forEach(copy => copy.remove());
			wrapper._motionCopies = [];
			return;
		}
		const metrics = computeLayerTransform(getLayerTransform(base), frame);
		const { move, local } = GlitterAnimation.splitSample(sample);
		const degrees = metrics.rotationRad * 180 / Math.PI;
		const space = entry.space;
		const motion = `translate(${move.x}px, ${move.y}px) translate(${metrics.centerX}px, ${metrics.centerY}px) rotate(${degrees}deg) scale(${metrics.signedScaleX}, ${metrics.signedScaleY}) translate(${-frame.width / 2}px, ${-frame.height / 2}px) translate(${sample.originX * frame.width}px, ${sample.originY * frame.height}px) ${GlitterAnimation.domTransformString(local)} translate(${-sample.originX * frame.width}px, ${-sample.originY * frame.height}px) translate(${frame.width / 2}px, ${frame.height / 2}px) scale(${1 / metrics.signedScaleX}, ${1 / metrics.signedScaleY}) rotate(${-degrees}deg) translate(${-metrics.centerX}px, ${-metrics.centerY}px)`;
		const transform = space ? `translate(${-space.x}px, ${-space.y}px) ${motion} translate(${space.centerX}px, ${space.centerY}px) rotate(${space.rotationRad}rad) translate(${space.x - space.centerX}px, ${space.y - space.centerY}px)` : motion;
		wrapper.style.transform = transform;
		wrapper.style.opacity = String((base.visible === false ? 0 : base.opacity / 100) * sample.opacity);
		wrapper.style.filter = sample.hue ? `hue-rotate(${sample.hue}deg)` : '';
		const offsets = (sample.copies || []).filter(copy => Math.abs(copy.x) + Math.abs(copy.y) > 1e-6);
		const copies = wrapper._motionCopies ||= [];
		while (copies.length > offsets.length) copies.pop().remove();
		while (copies.length < offsets.length) {
			const copy = document.createElement('div');
			copy.className = 'clip-wrapper clip-motion-copy';
			copy.setAttribute('aria-hidden', 'true');
			wrapper.after(copy);
			copies.push(copy);
		}
		copies.forEach((copy, index) => {
			syncMotionCopyChildren(wrapper, copy);
			copy.style.cssText = wrapper.style.cssText;
			copy.style.pointerEvents = 'none';
			copy.style.transform = `translate(${offsets[index].x}px, ${offsets[index].y}px) ${transform}`;
		});
	}

	release(id, entry) {
		entry.pending = null;
		if (entry.element.isConnected) {
			entry.wrapper.before(entry.element);
			entry.element.style.mixBlendMode = GlitterBlendModes.forLayer(this.editor.layerManager.getLayerById(id));
		}
		entry.wrapper._motionCopies?.forEach(copy => copy.remove());
		entry.wrapper.remove();
		if (entry.url) URL.revokeObjectURL(entry.url);
		this.editor.animationTicker.unregister(`clip-${id}`);
		this.entries.delete(id);
	}
}
