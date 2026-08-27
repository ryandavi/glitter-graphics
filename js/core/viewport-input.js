'use strict';

/**
 * Browser wheel streams vary by device and deltaMode. This adapter is the only
 * place that turns them into viewport intent; consumers receive pixels or a
 * continuous zoom factor and never need platform-specific branches.
 */
const VIEWPORT_INPUT = Object.freeze({
	normalizeWheel(event, options = {}) {
		const pageSize = Math.max(1, options.pageSize || 1);
		const lineSize = Math.max(1, options.lineSize || 16);
		const unit = event.deltaMode === 1 ? lineSize : event.deltaMode === 2 ? pageSize : 1;
		const rawX = Number.isFinite(event.deltaX) ? event.deltaX * unit : 0;
		const rawY = Number.isFinite(event.deltaY) ? event.deltaY * unit : 0;

		if (event.ctrlKey || event.metaKey) {
			const limitedDelta = Math.max(-100, Math.min(100, rawY));
			const sensitivity = options.zoomSensitivity ?? 0.002;
			return {
				type: 'zoom',
				factor: Math.exp(-limitedDelta * sensitivity),
				clientX: event.clientX,
				clientY: event.clientY
			};
		}

		let deltaX = rawX;
		let deltaY = rawY;
		if (event.shiftKey && Math.abs(deltaX) < Math.abs(deltaY)) {
			deltaX = deltaY;
			deltaY = 0;
		}

		return { type: 'pan', deltaX: -deltaX, deltaY: -deltaY };
	}
});
