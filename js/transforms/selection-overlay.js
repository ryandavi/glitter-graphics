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
const ROTATION_CURSOR_CACHE = new Map();

// Rotation cursor: a quarter arc bowing out around a corner, with a filled
// arrowhead at each end, black over a white halo so it reads on any image.
// Drawn for the top-left corner at 0°; `rotation` turns it clockwise, so 90° is
// top-right and 45° points straight up. Cached per 15° step because cursors
// are resolved on every pointermove.
function getRotationCursor(rotation) {
	const angle = Math.round(normalizeRotationDeg(rotation) / 15) * 15 % 360;
	if (ROTATION_CURSOR_CACHE.has(angle)) return ROTATION_CURSOR_CACHE.get(angle);
	const arc = 'M7 16A9 9 0 0 1 16 7';
	const heads = 'M3.5 16H10.5L7 20.5Z M16 3.5V10.5L20.5 7Z';
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">'
		+ `<g transform="rotate(${angle} 12 12)" stroke-linejoin="round">`
		+ `<path d="${arc}" fill="none" stroke="white" stroke-width="4.5" stroke-linecap="round"/>`
		+ `<path d="${heads}" fill="white" stroke="white" stroke-width="3"/>`
		+ `<path d="${arc}" fill="none" stroke="black" stroke-width="2"/>`
		+ `<path d="${heads}" fill="black"/>`
		+ '</g></svg>';
	const cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, auto`;
	ROTATION_CURSOR_CACHE.set(angle, cursor);
	return cursor;
}

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

	// The middle of the device pixel containing `value`: where a line one
	// device pixel wide (or any odd width) is centered to render crisply.
	static snapToPixelCenter(value) {
		const dpr = window.devicePixelRatio || 1;
		return (Math.floor(value * dpr) + 0.5) / dpr;
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
