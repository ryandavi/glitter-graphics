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
		const unchanged = current
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
		const layer = target.getLayer();
		const origin = getLayerAnimationOrigin(this.editor, layer, { width: wrapper.offsetWidth, height: wrapper.offsetHeight });
		const sample = GlitterAnimation.sampleAt(target.getData(), frozen ? 0 : elapsed, { layerId, origin: [origin.x, origin.y] });
		const transform = layer.type === LayerType.GLITTER_FILL
			? { rotation: 0, scale: { x: 100, y: 100 }, flipX: false, flipY: false }
			: getLayerTransform(layer);
		const radians = -(Number(transform.rotation) || 0) * Math.PI / 180;
		const scaleX = Math.max(0.0001, (Number(transform.scale?.x) || 100) / 100) * (transform.flipX ? -1 : 1);
		const scaleY = Math.max(0.0001, (Number(transform.scale?.y) || 100) / 100) * (transform.flipY ? -1 : 1);
		const canvasTx = sample.tx;
		const canvasTy = sample.ty;
		const domSample = {
			...sample,
			tx: (Math.cos(radians) * canvasTx - Math.sin(radians) * canvasTy) / scaleX,
			ty: (Math.sin(radians) * canvasTx + Math.cos(radians) * canvasTy) / scaleY
		};
		wrapper.style.transform = GlitterAnimation.domTransformString(domSample);
		wrapper.style.opacity = String(sample.opacity);
		wrapper.style.transformOrigin = `${sample.originX * 100}% ${sample.originY * 100}%`;
		// hue-rotate on the wrapper composes with each child's own static
		// filter (fill/shadow color adjust) rather than overwriting it.
		wrapper.style.filter = sample.hue ? `hue-rotate(${sample.hue}deg)` : '';
	}
}

function syncLayerAnimationPreview(element, layer, ticker) {
	if (!element || !ticker) return null;
	let wrapper = Array.from(element.children).find((child) => child.classList.contains('layer-anim-wrapper'));
	const active = GlitterAnimation.isActive(layer.animation);
	if (!active) {
		if (wrapper) {
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
		if (child !== wrapper && !child.matches('.transform-handle-wrapper, .layer-hover-outline')) wrapper.appendChild(child);
	});
	ticker.register(layer.id, {
		targetId: layer.id,
		getData: () => layer.animation,
		getLayer: () => layer,
		getWrapper: () => wrapper
	});
	return wrapper;
}
