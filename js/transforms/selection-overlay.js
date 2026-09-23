// ============================================
// SELECTION OVERLAY
// Screen-space layer for selection chrome: handles, bounding boxes, hover
// outlines and smart guides.
// ============================================
// Chrome used to live inside the zoomed preview wrapper, so every size was
// divided by the zoom and then scaled back up. Each handle landed on its own
// sub-pixel offset and the browser rounded each one separately, so corner
// handles rendered at uneven sizes. Here sizes are plain CSS pixels and every
// axis-aligned edge is snapped to a device pixel once.
//
// Canvas-to-screen mapping: the wrapper is translated by the pan and scaled by
// the zoom from its top-left, and it shares this overlay's origin (both sit at
// the container's top-left). During an animated zoom the CSS transition moves
// the wrapper without the viewport numbers, so the mapping is read from the
// wrapper's rendered rect instead, and the overlay follows it frame by frame.
const ROTATION_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath fill='white' stroke='black' stroke-width='1' d='M12 3v4m0 10v4M3 12h4m10 0h4M6.34 6.34l2.83 2.83m5.66 5.66l2.83 2.83M6.34 17.66l2.83-2.83m5.66-5.66l2.83-2.83'/%3E%3C/svg%3E") 12 12, auto`;

class SelectionOverlay {
	constructor(viewport, insertAfter) {
		this.viewport = viewport;
		this.wrapper = viewport.previewWrapper;
		this.element = document.createElement('div');
		this.element.className = 'selection-overlay';
		(insertAfter || this.wrapper).after(this.element);
		this.syncers = new Set();
		this.followFrame = null;

		// Mutation and resize callbacks run before paint, so the chrome moves in
		// the same frame as the canvas.
		const sync = () => this.sync();
		new MutationObserver(sync).observe(this.wrapper, { attributes: true, attributeFilter: ['style', 'class'] });
		new ResizeObserver(sync).observe(viewport.previewContainer);
	}

	// Syncers redraw one piece of chrome from current state; they run whenever
	// the view changes. Owners add one when their chrome is created and remove
	// it when the chrome is removed.
	addSyncer(fn) { this.syncers.add(fn); }
	removeSyncer(fn) { this.syncers.delete(fn); }

	sync() {
		this.syncers.forEach((fn) => {
			// A stale syncer (its layer already gone) must not stop the others.
			try { fn(); } catch (error) { console.warn('Selection overlay sync failed', error); }
		});
		if (this.wrapper.classList.contains('viewport-transition') && !this.followFrame) {
			this.followFrame = requestAnimationFrame(() => {
				this.followFrame = null;
				this.sync();
			});
		}
	}

	append(node) {
		this.element.appendChild(node);
	}

	// Document reset: drop all chrome and its syncers along with the layers.
	clear() {
		this.element.replaceChildren();
		this.syncers.clear();
	}

	getMapping() {
		if (this.wrapper.classList.contains('viewport-transition')) {
			const wrapperRect = this.wrapper.getBoundingClientRect();
			const ownRect = this.element.getBoundingClientRect();
			const layoutWidth = this.wrapper.offsetWidth;
			return {
				zoom: layoutWidth > 0 ? wrapperRect.width / layoutWidth : this.viewport.currentZoom,
				originX: wrapperRect.left - ownRect.left,
				originY: wrapperRect.top - ownRect.top
			};
		}
		return { zoom: this.viewport.currentZoom, originX: this.viewport.panX, originY: this.viewport.panY };
	}

	toScreen(point, view = this.getMapping()) {
		return { x: view.originX + point.x * view.zoom, y: view.originY + point.y * view.zoom };
	}

	static snap(value) {
		const dpr = window.devicePixelRatio || 1;
		return Math.round(value * dpr) / dpr;
	}

	// Place a box given in canvas units ({ centerX, centerY, width, height,
	// rotation }). Unrotated boxes get all four edges on device pixels; rotated
	// boxes can't be snapped and rotate about their center.
	placeFrame(element, frame, view = this.getMapping()) {
		const snap = SelectionOverlay.snap;
		const center = this.toScreen({ x: frame.centerX, y: frame.centerY }, view);
		const width = frame.width * view.zoom;
		const height = frame.height * view.zoom;
		const rotation = Number(frame.rotation) || 0;
		const style = element.style;
		if (rotation % 360 === 0) {
			const left = snap(center.x - width / 2);
			const top = snap(center.y - height / 2);
			style.left = `${left}px`;
			style.top = `${top}px`;
			style.width = `${snap(center.x + width / 2) - left}px`;
			style.height = `${snap(center.y + height / 2) - top}px`;
			style.transform = '';
		} else {
			style.left = `${center.x - width / 2}px`;
			style.top = `${center.y - height / 2}px`;
			style.width = `${width}px`;
			style.height = `${height}px`;
			style.transform = `rotate(${rotation}deg)`;
		}
	}

	// Center a handle on a screen point. Handle wrappers are even-sized and
	// centered by CSS, so a snapped center keeps the visible square on whole
	// device pixels.
	placePoint(element, point) {
		element.style.left = `${SelectionOverlay.snap(point.x)}px`;
		element.style.top = `${SelectionOverlay.snap(point.y)}px`;
	}

	// Stalk from a screen point on the box's top edge, `length` px long,
	// pointing away from a box rotated `rotation` degrees. CSS pivots the stalk
	// on its top center; the extra 180° turns it from pointing down to up.
	placeStalk(element, point, length, rotation) {
		element.style.left = `${point.x}px`;
		element.style.top = `${point.y}px`;
		element.style.height = `${length}px`;
		element.style.transform = `translate(-50%, 0) rotate(${(Number(rotation) || 0) + 180}deg)`;
	}
}
