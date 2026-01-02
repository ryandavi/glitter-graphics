// ============================================
// VIEWPORT MANAGER CLASS
// Handles all zoom, pan, and coordinate conversion logic
// ============================================
class ViewportManager {
	constructor(previewContainer, previewWrapper) {
		// DOM references
		this.previewContainer = previewContainer;
		this.previewWrapper = previewWrapper;

		// Zoom state
		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.zoomLevels.indexOf(1);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 3; // Fallback

		// Pan state
		this.panX = 0;
		this.panY = 0;
		this.isPanning = false;
		this.panStartX = 0;
		this.panStartY = 0;
		this.lastPanX = 0;
		this.lastPanY = 0;

		// Resize tracking
		this.lastViewportWidth = 0;
		this.lastViewportHeight = 0;
		this.resizeTimeout = null;

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

		// Mouse pan
		this.previewContainer.addEventListener('mousedown', (e) => {
			if (e.button === 0) { // Left click only
				this._handlePanStart(e);
			}
		});

		this.previewContainer.addEventListener('mousemove', (e) => {
			this._handlePanMove(e);
		});

		this.previewContainer.addEventListener('mouseup', () => {
			this.endPan();
		});

		this.previewContainer.addEventListener('mouseleave', () => {
			this.endPan();
		});

		// Touch gestures
		this.setupTouchGestures();
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
		const rect = this.previewContainer.getBoundingClientRect();
		const containerX = screenX - rect.left;
		const containerY = screenY - rect.top;

		const canvasX = (containerX - this.panX) / this.currentZoom;
		const canvasY = (containerY - this.panY) / this.currentZoom;

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

	// ===== ZOOM METHODS =====

	setZoom(newZoom, clickX = null, clickY = null) {
		if (!this.canvasWidth) return;

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
			CONFIG.zoomLevels[0],
			Math.min(CONFIG.zoomLevels[CONFIG.zoomLevels.length - 1], newZoom)
		);

		// Update index for UI
		let closestDiff = Number.MAX_VALUE;
		CONFIG.zoomLevels.forEach((z, i) => {
			const diff = Math.abs(this.currentZoom - z);
			if (diff < closestDiff) {
				closestDiff = diff;
				this.currentZoomIndex = i;
			}
		});

		// 6. Calculate new Pan
		// The new pan is: Screen Anchor Position - (Clamped Canvas Pixel * New Zoom)
		// This ensures the edge of the image stays exactly where it was on screen.
		this.panX = anchorX - (clampedCanvasX * this.currentZoom);
		this.panY = anchorY - (clampedCanvasY * this.currentZoom);

		this.applyTransform();
		this._notifyViewportChanged();
	}

	zoomIn(clickX = null, clickY = null) {
		if (this.currentZoomIndex < CONFIG.zoomLevels.length - 1) {
			this.setZoom(CONFIG.zoomLevels[this.currentZoomIndex + 1], clickX, clickY);
		} else {
			const nextZoom = this.currentZoom * 1.5;
			this.setZoom(nextZoom, clickX, clickY);
		}
	}

	zoomOut(clickX = null, clickY = null) {
		if (this.currentZoomIndex > 0) {
			this.setZoom(CONFIG.zoomLevels[this.currentZoomIndex - 1], clickX, clickY);
		} else {
			const nextZoom = this.currentZoom / 1.5;
			this.setZoom(nextZoom, clickX, clickY);
		}
	}

	zoomToFit() {
		if (!this.canvasWidth) return;

		const containerRect = this.previewContainer.getBoundingClientRect();
		const padding = 40;

		const scaleX = (containerRect.width - padding) / this.canvasWidth;
		const scaleY = (containerRect.height - padding) / this.canvasHeight;
		const fitZoom = Math.min(scaleX, scaleY);

		this.currentZoom = fitZoom;

		// Update zoom index
		this.currentZoomIndex = CONFIG.zoomLevels.findIndex(z => z >= fitZoom);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 0;

		// Center the canvas
		this.panX = (containerRect.width - (this.canvasWidth * fitZoom)) / 2;
		this.panY = (containerRect.height - (this.canvasHeight * fitZoom)) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	zoomToFill() {
		if (!this.canvasWidth) return;

		const containerRect = this.previewContainer.getBoundingClientRect();
		const padding = 40;

		const scaleX = (containerRect.width - padding) / this.canvasWidth;
		const scaleY = (containerRect.height - padding) / this.canvasHeight;
		const fillZoom = Math.max(scaleX, scaleY);

		this.currentZoom = fillZoom;

		// Update zoom index
		this.currentZoomIndex = CONFIG.zoomLevels.findIndex(z => z >= fillZoom);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = CONFIG.zoomLevels.length - 1;

		// Center the canvas
		this.panX = (containerRect.width - (this.canvasWidth * fillZoom)) / 2;
		this.panY = (containerRect.height - (this.canvasHeight * fillZoom)) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	resetZoom() {
		if (!this.canvasWidth) return;

		const containerRect = this.previewContainer.getBoundingClientRect();

		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.zoomLevels.indexOf(1);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 3;

		// Center the canvas
		this.panX = (containerRect.width - this.canvasWidth) / 2;
		this.panY = (containerRect.height - this.canvasHeight) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	resetZoomSmart() {
		if (!this.canvasWidth) return;

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

		const containerRect = this.previewContainer.getBoundingClientRect();

		// Sync resize tracking
		this.lastViewportWidth = containerRect.width;
		this.lastViewportHeight = containerRect.height;

		this.currentZoom = 1;
		this.currentZoomIndex = CONFIG.zoomLevels.indexOf(1);
		if (this.currentZoomIndex === -1) this.currentZoomIndex = 3;

		// Center the canvas
		this.panX = (containerRect.width - this.canvasWidth) / 2;
		this.panY = (containerRect.height - this.canvasHeight) / 2;

		this.applyTransform();
	}

	// ===== CENTERING METHODS =====

	centerHorizontal() {
		if (!this.canvasWidth) return;

		const containerRect = this.previewContainer.getBoundingClientRect();
		const scaledWidth = this.canvasWidth * this.currentZoom;

		// Center horizontally, keep vertical position
		this.panX = (containerRect.width - scaledWidth) / 2;

		this.applyTransform();
		this._notifyViewportChanged();
	}

	centerVertical() {
		if (!this.canvasWidth) return;

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

		this.isPanning = true;
		this.panStartX = x;
		this.panStartY = y;
		this.lastPanX = this.panX;
		this.lastPanY = this.panY;

		this.previewContainer.classList.add('panning');
	}

	endPan() {
		if (!this.isPanning) return;

		this.isPanning = false;
		this.previewContainer.classList.remove('panning');
	}

	// ===== TOUCH GESTURES =====

setupTouchGestures() {
    // Kill any existing browser click listeners if you can, 
    // or rely on the Mock Event gatekeeper.
    
    this.touchHandler = new TouchGestureHandler(this.previewContainer, {
        
        // === 1. SINGLE PAN ===
        onSinglePan: (dx, dy) => {
            console.log('👆 1-Finger Pan:', dx, dy);
            // DIRECTLY APPLY PAN (Bypassing tool checks for debugging)
            // If this works, you can wrap it in: if(window.editor.currentTool === ToolType.HAND) { ... }
            this.panX += dx;
            this.panY += dy;
            this.applyTransform();
            this._notifyViewportChanged();
        },

        // === 2. PINCH ZOOM ===
        onPinchZoom: (scale, cx, cy) => {
            console.log('🤏 Pinch:', scale);
            const rect = this.previewContainer.getBoundingClientRect();
            const anchorX = cx - rect.left;
            const anchorY = cy - rect.top;
            
            // Calculate Zoom
            const canvasX = (anchorX - this.panX) / this.currentZoom;
            const canvasY = (anchorY - this.panY) / this.currentZoom;
            
            let newZoom = this.currentZoom * scale;
            newZoom = Math.max(0.1, Math.min(16, newZoom));

            this.panX = anchorX - (canvasX * newZoom);
            this.panY = anchorY - (canvasY * newZoom);
            this.currentZoom = newZoom;
            
            this.applyTransform();
            this._notifyViewportChanged();
        },

        // === 3. TWO FINGER PAN ===
        onTwoPan: (dx, dy) => {
            this.panX += dx;
            this.panY += dy;
            this.applyTransform();
            this._notifyViewportChanged();
        },

        // === 4. TAP (THE CLICK REPLACEMENT) ===
        onSimpleTap: (x, y) => {
            console.log('✅ Clean Tap Detected');
            if (!window.editor) return;

            const target = document.elementFromPoint(x, y);
            
            // Create Fake Event
            const mockEvent = {
                target: target,
                clientX: x,
                clientY: y,
                button: 0,
                type: 'click',
                isSimpleTap: true, // PASSKEY
                preventDefault: () => {},
                stopPropagation: () => {}
            };

            window.editor.handlePreviewContainerClick(mockEvent);
        }
    });
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
			const scaledOffset = CONFIG.selectedGlitterOffset; //  / this.currentZoom;
			const scaledTotal = Math.max(scaledOffset + 1, (CONFIG.selectedGlitterOffset + CONFIG.selectedGlitterWidth) / this.currentZoom);

			if (inner) inner.setAttribute('radius', scaledOffset);
			if (outer) outer.setAttribute('radius', scaledTotal);
		}


	}

	// ===== PRIVATE HELPERS =====

	_handlePanStart(e) {
		// Will be controlled by editor based on current tool
		// Editor will call startPan() when appropriate
	}

	_handlePanMove(e) {
		if (!this.isPanning) return;

		const deltaX = e.clientX - this.panStartX;
		const deltaY = e.clientY - this.panStartY;

		this.panX = this.lastPanX + deltaX;
		this.panY = this.lastPanY + deltaY;

		this.applyTransform();
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