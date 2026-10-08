'use strict';

class AnimationTicker {
	constructor(editor) {
		this.editor = editor;
		this.targets = new Map();
		this.frameRequest = null;
		this.paused = false;
		this.timelineStartedAt = null;
		this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
		this.reducedMotion?.addEventListener?.('change', () => this.refresh());
	}

	// Every layer render calls this. Painting only the registered layer keeps
	// a full preview pass linear in animated layers (repainting all of them
	// here made it quadratic).
	register(layerId, target) {
		const now = performance.now();
		// Preview and export share one document timeline. A layer added later joins
		// the current phase; its authored phase value is the deliberate offset.
		if (this.timelineStartedAt == null) this.timelineStartedAt = now;
		const current = this.targets.get(layerId);
		// A target with its own paint (a sparkles slot) closes over its layout,
		// so a re-registration always replaces it.
		const unchanged = current
			&& !target.paint
			&& current.target.getWrapper() === target.getWrapper()
			&& current.target.getLayer() === target.getLayer();
		if (!unchanged) this.targets.set(layerId, { target });
		this._paintEntry(layerId, this.targets.get(layerId), now, this._isPreviewPaused());
		if (!this._isPreviewPaused()) this.start();
	}

	unregister(layerId) {
		this.targets.delete(layerId);
		if (!this.targets.size) {
			this.timelineStartedAt = null;
			this.stop();
		}
	}

	setPaused(paused) {
		this.paused = Boolean(paused);
		this.refresh();
	}

	getCurrentTime() {
		if (this._isPreviewPaused()) return 0;
		return this.timelineStartedAt == null ? 0 : Math.max(0, performance.now() - this.timelineStartedAt);
	}

	refresh() {
		this._paint(performance.now());
		if (this._isPreviewPaused() || !this.targets.size) this.stop();
		else this.start();
	}

	_isPreviewPaused() {
		return this.paused || this.reducedMotion?.matches || PREFERENCES.get('reduceMotion');
	}

	start() {
		if (this.frameRequest != null || !this.targets.size) return;
		this.frameRequest = requestAnimationFrame((now) => this._tick(now));
	}

	stop() {
		if (this.frameRequest != null) cancelAnimationFrame(this.frameRequest);
		this.frameRequest = null;
	}

	_tick(now) {
		this.frameRequest = null;
		this._paint(now);
		if (!this._isPreviewPaused() && this.targets.size) this.start();
	}

	_paint(now) {
		const frozen = this._isPreviewPaused();
		this.targets.forEach((entry, layerId) => this._paintEntry(layerId, entry, now, frozen));
	}

	_paintEntry(layerId, entry, now, frozen) {
		const target = entry.target;
		if (!target.getWrapper()?.isConnected) {
			this.targets.delete(layerId);
			return;
		}
		const wrapper = target.getWrapper();
		const elapsed = this.timelineStartedAt == null ? 0 : Math.max(0, now - this.timelineStartedAt);
		if (target.paint) {
			target.paint(frozen ? 0 : elapsed);
			return;
		}
		const layer = target.getLayer();
		LAYER_UI_CONFIG[layer.type]?.animate?.(layer, frozen ? 0 : elapsed, wrapper, {
			editor: this.editor,
			layerId,
			data: target.getData()
		});
	}
}

function paintLayerAnimationPreview(layer, elapsed, wrapper, context) {
	const transform = getLayerTransform(layer);
	const samplingContext = getLayerAnimationSamplingContext(context.editor, layer);
	const sample = GlitterAnimation.sampleAt(context.data, elapsed, samplingContext);
	const { move, local } = GlitterAnimation.splitSample(sample);
	// The sample moves the layer in document px. The wrapper sits inside the
	// element's rotation and flip but outside its scale (the element is sized,
	// not CSS-scaled), so only those two are undone.
	const radians = -(Number(transform.rotation) || 0) * Math.PI / 180;
	const canvasTx = move.x;
	const canvasTy = move.y;
	const domSample = {
		...local,
		tx: (Math.cos(radians) * canvasTx - Math.sin(radians) * canvasTy) * (transform.flipX ? -1 : 1),
		ty: (Math.sin(radians) * canvasTx + Math.cos(radians) * canvasTy) * (transform.flipY ? -1 : 1)
	};
	if (sample.matrix) domSample.matrix = { ...sample.matrix, e: domSample.tx, f: domSample.ty };
	wrapper.style.transform = GlitterAnimation.domTransformString(domSample);
	wrapper.style.opacity = String(sample.opacity);
	wrapper.style.transformOrigin = `${sample.originX * 100}% ${sample.originY * 100}%`;
	// hue-rotate on the wrapper composes with each child's own static
	// filter (fill/shadow color adjust) rather than overwriting it.
	wrapper.style.filter = sample.hue ? `hue-rotate(${sample.hue}deg)` : '';
	const offsets = (sample.copies || []).filter(({ x, y }) => Math.abs(x) + Math.abs(y) > 1e-6);
	const copies = wrapper._motionCopies ||= [];
	while (copies.length > offsets.length) copies.pop().remove();
	while (copies.length < offsets.length) {
		const copy = document.createElement('div');
		copy.className = 'layer-anim-wrapper layer-anim-copy';
		copy.setAttribute('aria-hidden', 'true');
		(copies[copies.length - 1] || wrapper).after(copy);
		copies.push(copy);
		syncMotionCopyChildren(wrapper, copy);
	}
	if (copies.length && !wrapper._motionCopyObserver) {
		wrapper._motionCopyObserver = new MutationObserver((records) => {
			if (records.some((record) => record.target !== wrapper || record.type === 'childList')) copies.forEach((copy) => syncMotionCopyChildren(wrapper, copy));
		});
		wrapper._motionCopyObserver.observe(wrapper, { subtree: true, attributes: true, childList: true, characterData: true });
	} else if (!copies.length) {
		wrapper._motionCopyObserver?.disconnect();
		wrapper._motionCopyObserver = null;
	}
	copies.forEach((copy, index) => {
		const { x, y } = offsets[index];
		const tx = domSample.tx + (Math.cos(radians) * x - Math.sin(radians) * y) * (transform.flipX ? -1 : 1);
		const ty = domSample.ty + (Math.sin(radians) * x + Math.cos(radians) * y) * (transform.flipY ? -1 : 1);
		copy.style.transform = GlitterAnimation.domTransformString({ ...domSample, tx, ty });
		copy.style.opacity = wrapper.style.opacity;
		copy.style.transformOrigin = wrapper.style.transformOrigin;
		copy.style.filter = wrapper.style.filter;
	});
}

// Reconcile the replicas so editing masks and animated particles never restarts GIFs.
function syncMotionCopyChildren(source, target) {
	Array.from(source.childNodes).forEach((node, index) => {
		let copy = target.childNodes[index];
		if (!copy || copy.nodeType !== node.nodeType || copy.nodeName !== node.nodeName) {
			const replacement = node.cloneNode(false);
			if (copy) copy.replaceWith(replacement); else target.appendChild(replacement);
			copy = replacement;
		}
		if (node.nodeType === Node.ELEMENT_NODE) {
			Array.from(copy.attributes).forEach(({ name }) => { if (name === 'id' || !node.hasAttribute(name)) copy.removeAttribute(name); });
			Array.from(node.attributes).forEach(({ name, value }) => { if (name !== 'id' && copy.getAttribute(name) !== value) copy.setAttribute(name, value); });
			syncMotionCopyChildren(node, copy);
			if (node instanceof HTMLCanvasElement && node.width && node.height) copy.getContext('2d').drawImage(node, 0, 0);
		} else if (copy.nodeValue !== node.nodeValue) copy.nodeValue = node.nodeValue;
	});
	while (target.childNodes.length > source.childNodes.length) target.lastChild.remove();
}

function animateTransformableLayerPreview(layer, elapsed, wrapper, context) {
	paintLayerAnimationPreview(layer, elapsed, wrapper, context);
}

function syncLayerAnimationPreview(element, layer, ticker) {
	if (!element || !ticker) return null;
	let wrapper = Array.from(element.children).find((child) => child.classList.contains('layer-anim-wrapper'));
	const active = GlitterAnimation.isActive(layer.animations);
	if (!active) {
		if (wrapper) {
			wrapper._motionCopyObserver?.disconnect();
			wrapper._motionCopies?.forEach((copy) => copy.remove());
			while (wrapper.firstChild) element.insertBefore(wrapper.firstChild, wrapper);
			wrapper.remove();
		}
		ticker.unregister(layer.id);
		return null;
	}
	if (!wrapper) {
		wrapper = document.createElement('div');
		wrapper.className = 'layer-anim-wrapper';
		element.insertBefore(wrapper, element.firstChild);
	}
	Array.from(element.children).forEach((child) => {
		if (child !== wrapper && !child.matches('.transform-handle-wrapper, .layer-hover-outline, .layer-anim-copy')) wrapper.appendChild(child);
	});
	ticker.register(layer.id, {
		targetId: layer.id,
		getData: () => layer.animations,
		getLayer: () => layer,
		getWrapper: () => wrapper
	});
	return wrapper;
}
