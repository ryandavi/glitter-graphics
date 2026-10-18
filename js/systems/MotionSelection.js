'use strict';

class MotionSelection {
	constructor(editor) { this.editor = editor; this.byLayer = new Map(); }
	get(layerId) {
		const layer = this.editor.layerManager.getLayerById(layerId), selected = this.byLayer.get(layerId);
		const animation = layer?.animations?.find(entry => entry.id === selected?.motionId) || layer?.animations?.[0];
		return { motionId: animation?.id, keyAt: selected?.motionId === animation?.id ? selected?.keyAt : undefined };
	}
	select(layerId, motionId, { keyAt, seek = false } = {}) {
		const layer = this.editor.layerManager.getLayerById(layerId), animation = layer?.animations?.find(entry => entry.id === motionId);
		if (!animation) return;
		const previous = this.get(layerId);
		this.byLayer.set(layerId, { motionId, keyAt: keyAt ?? (previous.motionId === motionId ? previous.keyAt : undefined) });
		if (seek && keyAt != null) {
			const ticker = this.editor.animationTicker;
			const periodMs = this.editor.keyPeriod(layer, animation);
			const time = GlitterAnimation.timeAtProgress({ ...animation, periodMs }, keyAt, ticker.getPlayheadTime(), { endMs: ticker.loopMs > 0 ? ticker.loopMs : Infinity });
			if (time != null) { this.editor.setPlayback(false); ticker.seek(time); }
			else this.editor.updateStatus('This key is outside the played run or loop. Extend the run or loop to reach it.');
		}
		window.dispatchEvent(new CustomEvent('motionselectionchange', { detail: { layerId, motionId, keyAt } }));
	}
}
