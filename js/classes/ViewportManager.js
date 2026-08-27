// ============================================
// VIEWPORT MANAGER CLASS
// Handles all zoom, pan, and coordinate conversion logic
// ============================================
class ViewportManager {
	constructor(previewContainer, previewWrapper) {
		// DOM references
		this.previewContainer = previewContainer;
		this.previewWrapper = previewWrapper;
		this.editor = null;

		// Zoom state
		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.ui.zoom.levels.indexOf(1);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 3; // Fallback

		// Pan state
		this.panX = 0;
		this.panY = 0;
		this.isPanning = false;
		this.panStartX = 0;
		this.panStartY = 0;
		this.lastPanX = 0;
		this.lastPanY = 0;
		this.inertiaFrame = null;
		this.inertiaVelocityX = 0;
		this.inertiaVelocityY = 0;

		// Frame-batched wheel / precision-trackpad input. Deltas accumulate here
		// and apply as one composed transform per animation frame.
		this._inputFrame = null;
		this._pendingInput = this._emptyPendingInput();

		// Resize tracking
		this.lastViewportWidth = 0;
		this.lastViewportHeight = 0;
		this.resizeTimeout = null;
		this.viewTransitionTimer = null;

		// Canvas dimensions (set by editor when image loads)
		this.canvasWidth = 0;
		this.canvasHeight = 0;

		// Initialize
		this.initializeViewportDimensions();
		this.setupEventListeners();
	}

	// ===== INITIALIZATION =====

	initializeViewportDimensions() {
		const rect = this.previewContainer.getBoundingClientRect();
		this.lastViewportWidth = rect.width;
		this.lastViewportHeight = rect.height;
	}

	setupEventListeners() {
		// Window resize
		window.addEventListener('resize', () => this.handleWindowResize());
		window.visualViewport?.addEventListener('resize', () => this.handleWindowResize());

		// Mouse pan. The editor starts left-button Hand-tool pans; the viewport
		// owns middle-button navigation so it remains available from every tool.
		this.previewContainer.addEventListener('mousedown', (e) => {
			if (e.button === 1) {
				e.preventDefault();
				this.startPan(e.clientX, e.clientY);
			}
		});
		this.previewContainer.addEventListener('auxclick', (e) => {
			if (e.button === 1) e.preventDefault();
		});

		window.addEventListener('mousemove', (e) => {
			this._handlePanMove(e);
		});

		window.addEventListener('mouseup', () => {
			this.endPan();
		});

		window.addEventListener('blur', () => {
			this.endPan();
		});

		// Touch gestures
		this.gestureManager = new GestureManager(this.previewContainer, this);
	}

	// ===== PUBLIC API =====

	/**
	 * Set canvas dimensions (called by editor when image loads)
	 */
	setCanvasDimensions(width, height) {
		this.canvasWidth = width;
		this.canvasHeight = height;
	}

	/**
	 * Convert screen coordinates to canvas coordinates
	 * Essential for sticker placement, selection, etc.
	 */
	screenToCanvas(screenX, screenY) {
		const rect = this.previewWrapper.getBoundingClientRect();
		const canvasX = (screenX - rect.left) / this.currentZoom;
		const canvasY = (screenY - rect.top) / this.currentZoom;

		return { x: canvasX, y: canvasY };
	}

	/**
	 * Check if canvas coordinates are within bounds
	 */
	isWithinCanvas(canvasX, canvasY) {
		return canvasX >= 0 &&
			canvasX < this.canvasWidth &&
			canvasY >= 0 &&
			canvasY < this.canvasHeight;
	}

	/**
	 * Get current zoom percentage
	 */
	getZoomPercentage() {
		return Math.round(this.currentZoom * 100);
	}

	/**
	 * Capture the canvas point currently under the center of the viewport.
	 * Canvas-space focus survives layout changes; raw pan offsets do not.
	 */
	captureViewState() {
		const rect = this.previewContainer.getBoundingClientRect();
		return {
			zoom: this.currentZoom,
			focusX: (rect.width / 2 - this.panX) / this.currentZoom,
			focusY: (rect.height / 2 - this.panY) / this.currentZoom
		};
	}

	restoreViewState(state, options = {}) {
		if (!state || !this.canvasWidth) return;
		this.prepareViewChange(options);
		const rect = this.previewContainer.getBoundingClientRect();
		this.currentZoom = state.zoom;
		this._syncZoomIndex();
		this.panX = rect.width / 2 - state.focusX * this.currentZoom;
		this.panY = rect.height / 2 - state.focusY * this.currentZoom;
		this.lastViewportWidth = rect.width;
		this.lastViewportHeight = rect.height;
		this.applyTransform();
		this._notifyViewportChanged();
	}

	startViewTransition() {
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
		if (this.viewTransitionTimer) clearTimeout(this.viewTransitionTimer);
		this.previewWrapper.classList.add('viewport-transition');
		// Commit the current transform before the next method writes its target.
		void this.previewWrapper.offsetWidth;
		this.viewTransitionTimer = setTimeout(() => this.cancelViewTransition(), 350);
	}

	cancelViewTransition() {
		if (this.viewTransitionTimer) clearTimeout(this.viewTransitionTimer);
		this.viewTransitionTimer = null;
		this.previewWrapper.classList.remove('viewport-transition');
	}

	prepareViewChange(options = {}) {
		if (options.animate) this.startViewTransition();
		else this.cancelViewTransition();
		this.cancelInertia();
		this.cancelQueuedInput();
	}

	// ===== ZOOM METHODS =====

	setZoom(newZoom, clickX = null, clickY = null, options = {}) {
		if (!this.canvasWidth) return;
		this.prepareViewChange(options);

		const oldZoom = this.currentZoom;
		const containerRect = this.previewContainer.getBoundingClientRect();

		// 1. Get the click position relative to the container
		let screenX, screenY;
		if (clickX !== null && clickY !== null) {
			screenX = clickX - containerRect.left;
			screenY = clickY - containerRect.top;
		} else {
			screenX = containerRect.width / 2;
			screenY = containerRect.height / 2;
		}

		// 2. Find where that click lands in "Canvas Pixel" space
		let canvasX = (screenX - this.panX) / oldZoom;
		let canvasY = (screenY - this.panY) / oldZoom;

		// 3. PHOTOSHOP CLAMP:
		// If we clicked in the grey area, snap the anchor to the nearest image edge
		const clampedCanvasX = Math.max(0, Math.min(this.canvasWidth, canvasX));
		const clampedCanvasY = Math.max(0, Math.min(this.canvasHeight, canvasY));

		// 4. Find where that clamped "Edge Pixel" is currently located on the screen
		// This is our fixed anchor point.
		const anchorX = this.panX + (clampedCanvasX * oldZoom);
		const anchorY = this.panY + (clampedCanvasY * oldZoom);

		// 5. Update the Zoom Level
		this.currentZoom = Math.max(
			CONFIG.ui.zoom.levels[0],
			Math.min(CONFIG.ui.zoom.levels[CONFIG.ui.zoom.levels.length - 1], newZoom)
		);

		this._syncZoomIndex();

		// 6. Calculate new Pan
		// The new pan is: Screen Anchor Position - (Clamped Canvas Pixel * New Zoom)
		// This ensures the edge of the image stays exactly where it was on screen.
		this.panX = anchorX - (clampedCanvasX * this.currentZoom);
		this.panY = anchorY - (clampedCanvasY * this.currentZoom);

		this.applyTransform();
		this._notifyViewportChanged();
	}

	/**
	 * Apply a continuous zoom delta around a screen-space anchor. Touch pinch,
	 * trackpad pinch, and future gesture sources all share this one primitive.
	 */
	zoomByFactor(factor, anchorX = null, anchorY = null, options = {}) {
		if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
		this.setZoom(this.currentZoom * factor, anchorX, anchorY, options);
	}

	// ===== FRAME-BATCHED INPUT =====
	// Wheel and precision-trackpad streams emit many events per frame. Callers
	// queue their intent through these; a single composed transform is applied
	// on the next animation frame so intermediate states never reach a paint.

	_emptyPendingInput() {
		return { panX: 0, panY: 0, zoomFactor: 1, zoomAnchorX: null, zoomAnchorY: null };
	}

	queuePanBy(deltaX, deltaY) {
		if (!this.canvasWidth || (!deltaX && !deltaY)) return;
		this._pendingInput.panX += deltaX;
		this._pendingInput.panY += deltaY;
		this._scheduleInputFlush();
	}

	queueZoomByFactor(factor, anchorX = null, anchorY = null) {
		if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
		this._pendingInput.zoomFactor *= factor;
		this._pendingInput.zoomAnchorX = anchorX;
		this._pendingInput.zoomAnchorY = anchorY;
		this._scheduleInputFlush();
	}

	_scheduleInputFlush() {
		if (this._inputFrame !== null) return;
		this._inputFrame = requestAnimationFrame(() => {
			this._inputFrame = null;
			this._flushQueuedInput();
		});
	}

	_flushQueuedInput() {
		const pending = this._pendingInput;
		this._pendingInput = this._emptyPendingInput();

		if (pending.zoomFactor !== 1) {
			// One frame's worth of high-resolution wheel deltas should not snap the
			// zoom across several stops at once.
			const factor = Math.max(0.5, Math.min(2, pending.zoomFactor));
			this.zoomByFactor(factor, pending.zoomAnchorX, pending.zoomAnchorY);
		}
		if (pending.panX || pending.panY) {
			this.panBy(pending.panX, pending.panY);
		}
	}

	cancelQueuedInput() {
		if (this._inputFrame !== null) {
			cancelAnimationFrame(this._inputFrame);
			this._inputFrame = null;
		}
		this._pendingInput = this._emptyPendingInput();
	}

	_syncZoomIndex() {
		let closestDiff = Number.MAX_VALUE;
		CONFIG.ui.zoom.levels.forEach((z, i) => {
			const diff = Math.abs(this.currentZoom - z);
			if (diff < closestDiff) {
				closestDiff = diff;
				this.currentZoomIndex = i;
			}
		});
	}

	zoomIn(clickX = null, clickY = null, options = {}) {
		const next = CONFIG.ui.zoom.levels.find((zoom) => zoom > this.currentZoom + 0.0001);
		this.setZoom(next ?? this.currentZoom * 1.5, clickX, clickY, options);
	}

	zoomOut(clickX = null, clickY = null, options = {}) {
		const next = [...CONFIG.ui.zoom.levels].reverse()
			.find((zoom) => zoom < this.currentZoom - 0.0001);
		this.setZoom(next ?? this.currentZoom / 1.5, clickX, clickY, options);
	}

	zoomToFit(options = {}) {
		if (!this.canvasWidth) return;
		this.prepareViewChange(options);

		const containerRect = this.previewContainer.getBoundingClientRect();
		const padding = 40;

		const scaleX = (containerRect.width - padding) / this.canvasWidth;
		const scaleY = (containerRect.height - padding) / this.canvasHeight;
		const fitZoom = Math.min(scaleX, scaleY);

		this.currentZoom = fitZoom;

		// Update zoom index
		this.currentZoomIndex = CONFIG.ui.zoom.levels.findIndex(z => z >= fitZoom);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 0;

		// Center the canvas
		this.panX = (containerRect.width - (this.canvasWidth * fitZoom)) / 2;
		this.panY = (containerRect.height - (this.canvasHeight * fitZoom)) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	zoomToFill(options = {}) {
		if (!this.canvasWidth) return;
		this.prepareViewChange(options);

		const containerRect = this.previewContainer.getBoundingClientRect();
		const padding = 40;

		const scaleX = (containerRect.width - padding) / this.canvasWidth;
		const scaleY = (containerRect.height - padding) / this.canvasHeight;
		const fillZoom = Math.max(scaleX, scaleY);

		this.currentZoom = fillZoom;

		// Update zoom index
		this.currentZoomIndex = CONFIG.ui.zoom.levels.findIndex(z => z >= fillZoom);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = CONFIG.ui.zoom.levels.length - 1;

		// Center the canvas
		this.panX = (containerRect.width - (this.canvasWidth * fillZoom)) / 2;
		this.panY = (containerRect.height - (this.canvasHeight * fillZoom)) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	zoomToBounds(bounds, options = {}) {
		if (!bounds || !this.canvasWidth) return;
		const width = Math.max(1, bounds.right - bounds.left);
		const height = Math.max(1, bounds.bottom - bounds.top);
		const rect = this.previewContainer.getBoundingClientRect();
		const padding = options.padding ?? 80;
		const availableWidth = Math.max(1, rect.width - padding);
		const availableHeight = Math.max(1, rect.height - padding);
		const minZoom = CONFIG.ui.zoom.levels[0];
		const maxZoom = CONFIG.ui.zoom.levels[CONFIG.ui.zoom.levels.length - 1];
		const zoom = Math.max(minZoom, Math.min(maxZoom,
			Math.min(availableWidth / width, availableHeight / height)
		));

		this.prepareViewChange(options);
		this.currentZoom = zoom;
		this._syncZoomIndex();
		this.panX = rect.width / 2 - ((bounds.left + bounds.right) / 2) * zoom;
		this.panY = rect.height / 2 - ((bounds.top + bounds.bottom) / 2) * zoom;
		this.applyTransform();
		this._notifyViewportChanged();
	}

	resetZoom(options = {}) {
		if (!this.canvasWidth) return;
		this.prepareViewChange(options);

		const containerRect = this.previewContainer.getBoundingClientRect();

		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.ui.zoom.levels.indexOf(1);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 3;

		// Center the canvas
		this.panX = (containerRect.width - this.canvasWidth) / 2;
		this.panY = (containerRect.height - this.canvasHeight) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	resetZoomSmart() {
		if (!this.canvasWidth) return;
		this.cancelInertia();

		const containerRect = this.previewContainer.getBoundingClientRect();

		// Safety check for hidden container
		if (containerRect.width === 0 || containerRect.height === 0) return;

		const padding = 40;
		const scaleX = (containerRect.width - padding) / this.canvasWidth;
		const scaleY = (containerRect.height - padding) / this.canvasHeight;
		const fitZoom = Math.min(scaleX, scaleY);

		// If image needs to shrink to fit, do it. Otherwise 100%
		if (fitZoom < 1) {
			this.zoomToFit();
		} else {
			this.resetViewport();
		}
	}

	resetViewport() {
		if (!this.canvasWidth) return;
		this.prepareViewChange();

		const containerRect = this.previewContainer.getBoundingClientRect();

		// Sync resize tracking
		this.lastViewportWidth = containerRect.width;
		this.lastViewportHeight = containerRect.height;

		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.ui.zoom.levels.indexOf(1);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 3;

		// Center the canvas
		this.panX = (containerRect.width - this.canvasWidth) / 2;
		this.panY = (containerRect.height - this.canvasHeight) / 2;

		this.applyTransform();
	}

	// ===== CENTERING METHODS =====

	centerHorizontal(options = {}) {
		if (!this.canvasWidth) return;
		this.prepareViewChange(options);

		const containerRect = this.previewContainer.getBoundingClientRect();
		const scaledWidth = this.canvasWidth * this.currentZoom;

		// Center horizontally, keep vertical position
		this.panX = (containerRect.width - scaledWidth) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	centerVertical(options = {}) {
		if (!this.canvasWidth) return;
		this.prepareViewChange(options);

		const containerRect = this.previewContainer.getBoundingClientRect();
		const scaledHeight = this.canvasHeight * this.currentZoom;

		// Center vertically, keep horizontal position
		this.panY = (containerRect.height - scaledHeight) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	// ===== PAN METHODS =====

	startPan(x, y) {
		if (!this.canvasWidth) return;
		this.cancelViewTransition();
		this.cancelInertia();
		this.cancelQueuedInput();

		this.isPanning = true;
		this.panStartX = x;
		this.panStartY = y;
		this.lastPanX = this.panX;
		this.lastPanY = this.panY;

		this.previewContainer.classList.add('panning');
	}

	clampPanToVisibleBounds() {
		if (!this.canvasWidth || !this.canvasHeight || !this.previewContainer) {
			return;
		}

		const containerRect = this.previewContainer.getBoundingClientRect();
		const scaledWidth = this.canvasWidth * this.currentZoom;
		const scaledHeight = this.canvasHeight * this.currentZoom;
		const minVisibleWidth = Math.min(containerRect.width, scaledWidth * 0.15);
		const minVisibleHeight = Math.min(containerRect.height, scaledHeight * 0.15);
		const minPanX = minVisibleWidth - scaledWidth;
		const maxPanX = containerRect.width - minVisibleWidth;
		const minPanY = minVisibleHeight - scaledHeight;
		const maxPanY = containerRect.height - minVisibleHeight;

		this.panX = Math.min(maxPanX, Math.max(minPanX, this.panX));
		this.panY = Math.min(maxPanY, Math.max(minPanY, this.panY));
	}

	panBy(deltaX, deltaY) {
		if (!this.canvasWidth || (!deltaX && !deltaY)) return;
		this.cancelViewTransition();
		this.cancelInertia();
		this.cancelQueuedInput();
		this.panX += deltaX;
		this.panY += deltaY;
		this.clampPanToVisibleBounds();
		this.applyTransform();
		this._notifyViewportChanged();
	}

	endPan() {
		if (!this.isPanning) return;

		this.isPanning = false;
		this.previewContainer.classList.remove('panning');
	}

	pinchZoomAt(scale, clientX, clientY) {
		this.zoomByFactor(scale, clientX, clientY);
	}

	/**
	 * Apply a two-finger scale and translation as one transform. The canvas point
	 * below the previous centroid lands below the new centroid without an
	 * intermediate paint or duplicated translation.
	 */
	transformByGesture(scale, fromClientX, fromClientY, toClientX, toClientY) {
		if (!this.canvasWidth || !Number.isFinite(scale) || scale <= 0) return;
		this.cancelViewTransition();
		this.cancelInertia();
		this.cancelQueuedInput();

		const rect = this.previewContainer.getBoundingClientRect();
		const fromX = fromClientX - rect.left;
		const fromY = fromClientY - rect.top;
		const toX = toClientX - rect.left;
		const toY = toClientY - rect.top;
		const canvasX = (fromX - this.panX) / this.currentZoom;
		const canvasY = (fromY - this.panY) / this.currentZoom;
		const minZoom = CONFIG.ui.zoom.levels[0];
		const maxZoom = CONFIG.ui.zoom.levels[CONFIG.ui.zoom.levels.length - 1];
		const newZoom = Math.max(minZoom, Math.min(maxZoom, this.currentZoom * scale));

		this.currentZoom = newZoom;
		this._syncZoomIndex();
		this.panX = toX - (canvasX * newZoom);
		this.panY = toY - (canvasY * newZoom);
		this.clampPanToVisibleBounds();
		this.applyTransform();
		this._notifyViewportChanged();
	}

	cancelInertia() {
		if (this.inertiaFrame) {
			cancelAnimationFrame(this.inertiaFrame);
			this.inertiaFrame = null;
		}

		this.inertiaVelocityX = 0;
		this.inertiaVelocityY = 0;
	}

	startInertia(velocityX, velocityY) {
		if (!CONFIG.ui.gestures.inertia?.enabled) {
			return;
		}

		// Momentum is motion the user did not ask to continue; honor a reduced-motion
		// preference the same way animated zoom transitions do.
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			return;
		}

		const decay = CONFIG.ui.gestures.inertia.decay ?? 0.92;
		this.cancelInertia();

		this.inertiaVelocityX = velocityX;
		this.inertiaVelocityY = velocityY;

		const tick = () => {
			this.panX += this.inertiaVelocityX;
			this.panY += this.inertiaVelocityY;
			this.clampPanToVisibleBounds();
			this.applyTransform();
			this._notifyViewportChanged();

			this.inertiaVelocityX *= decay;
			this.inertiaVelocityY *= decay;

			if (Math.hypot(this.inertiaVelocityX, this.inertiaVelocityY) < 0.5) {
				this.cancelInertia();
				return;
			}

			this.inertiaFrame = requestAnimationFrame(tick);
		};

		this.inertiaFrame = requestAnimationFrame(tick);
	}

	// ===== RESIZE HANDLING =====

	handleWindowResize() {
		clearTimeout(this.resizeTimeout);
		this.resizeTimeout = setTimeout(() => {
			this.performResizeUpdate();
		}, 100);
	}

	performResizeUpdate() {
		const containerRect = this.previewContainer.getBoundingClientRect();
		const newWidth = containerRect.width;
		const newHeight = containerRect.height;

		// If canvas exists, adjust pan to keep centered
		if (this.canvasWidth) {
			const deltaX = newWidth - this.lastViewportWidth;
			const deltaY = newHeight - this.lastViewportHeight;

			this.panX += deltaX / 2;
			this.panY += deltaY / 2;

			this.applyTransform();
			this._notifyViewportChanged();

			// Optional: auto-fit on resize
			this.zoomToFit();
		}

		// Update stored dimensions
		this.lastViewportWidth = newWidth;
		this.lastViewportHeight = newHeight;
	}

	// ===== TRANSFORM APPLICATION =====

	applyTransform() {
		// 1. Apply the visual transform
		this.previewWrapper.style.transform =
			`translate(${this.panX}px, ${this.panY}px) scale(${this.currentZoom})`;

		// 2. Pass the zoom value to CSS as a variable
		// We set it on previewWrapper so all children (stickers, canvas) can see it
		this.previewWrapper.style.setProperty('--zoom', this.currentZoom);


		// Update the SVG filter radius to stay consistent with zoom
		const filter = document.getElementById('selection-glow');
		if (filter) {
			const outer = filter.querySelector('feMorphology[result="outer_edge"]');
			const inner = filter.querySelector('feMorphology[result="inner_edge"]');

			// CALCULATIONS
			// Divide by zoom to keep them visually consistent on screen
			const scaledOffset = CONFIG.tools.glitter.preview.selectedOutlineOffset; //  / this.currentZoom;
			const scaledTotal = Math.max(scaledOffset + 1, (CONFIG.tools.glitter.preview.selectedOutlineOffset + CONFIG.tools.glitter.preview.selectedOutlineWidth) / this.currentZoom);

			if (inner) inner.setAttribute('radius', scaledOffset);
			if (outer) outer.setAttribute('radius', scaledTotal);
		}


	}

	// ===== PRIVATE HELPERS =====

	_handlePanMove(e) {
		if (!this.isPanning) return;

		const deltaX = e.clientX - this.panStartX;
		const deltaY = e.clientY - this.panStartY;

		this.panX = this.lastPanX + deltaX;
		this.panY = this.lastPanY + deltaY;

		this.clampPanToVisibleBounds();
		this.applyTransform();
		this._notifyViewportChanged();
		e.preventDefault();
	}

	_notifyViewportChanged() {
		// Dispatch custom event for editor to listen to
		window.dispatchEvent(new CustomEvent('viewportChanged', {
			detail: {
				zoom: this.currentZoom,
				zoomPercentage: this.getZoomPercentage(),
				panX: this.panX,
				panY: this.panY
			}
		}));
	}
}
