'use strict';

class AnimationTicker {
	constructor() {
		this.targets = new Map();
		this.frameRequest = null;
		this.paused = false;
		this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
		this.reducedMotion?.addEventListener?.('change', () => this.refresh());
	}

	register(layerId, target) {
		const now = performance.now();
		const existing = this.targets.get(layerId);
		const data = target.getData();
		// Restart the clock only when the animation is newly enabled or the
		// preset changed; keep it running across re-renders triggered by
		// unrelated slider tweaks so a finite-iteration preset (fade, pop, ...)
		// actually gets to play instead of always sampling far-future elapsed
		// time and rendering its already-finished pose.
		const startedAt = existing && existing.data?.type === data?.type ? existing.startedAt : now;
		this.targets.set(layerId, { list: [target], startedAt, data });
		this.refresh();
	}

	unregister(layerId) {
		this.targets.delete(layerId);
		if (!this.targets.size) this.stop();
	}

	setPaused(paused) {
		this.paused = Boolean(paused);
		this.refresh();
	}

	getCurrentTime() {
		if (this._isPreviewPaused()) return 0;
		const starts = Array.from(this.targets.values(), (entry) => entry.startedAt);
		return starts.length ? Math.max(0, performance.now() - Math.min(...starts)) : 0;
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
		this.targets.forEach((entry, layerId) => {
			const live = entry.list.filter((target) => target.getWrapper()?.isConnected);
			if (!live.length) {
				this.targets.delete(layerId);
				return;
			}
			live.forEach((target) => {
				const wrapper = target.getWrapper();
				entry.data = target.getData();
				const sample = GlitterAnimation.sampleAt(entry.data, frozen ? 0 : now - entry.startedAt, { layerId });
				const layer = target.getLayer();
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
			});
		});
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
