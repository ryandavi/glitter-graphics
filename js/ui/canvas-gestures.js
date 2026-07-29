const CANVAS_GESTURE_METHODS = {
togglePreview() {
		if (this.autoGlitterManager?.isSessionActive()) return;
		this.showAllLayers = !this.showAllLayers;

		const previewToggle = document.getElementById('previewModeToggle');
		if (previewToggle) {
			previewToggle.classList.toggle('active', !this.showAllLayers);
			previewToggle.setAttribute('aria-pressed', String(!this.showAllLayers));
			const name = previewToggle.querySelector('.name');
			if (name) name.textContent = this.showAllLayers ? 'Show Only Selected Layer' : 'Show All Layers';
		}

		this.requestPreviewUpdate();
		this.updateActionButtons(); // Updates the button title
	}

,
	setupPreviewListeners() {
		const previewToggle = document.getElementById('previewModeToggle');
		const transparencyToggle = document.getElementById('transparencyToggle');
		const boundsToggle = document.getElementById('boundsToggle');
		const snappingToggle = document.getElementById('snappingToggle');

		if (previewToggle) {
			previewToggle.addEventListener('click', () => this.togglePreview());
		}

		if (transparencyToggle) {
			transparencyToggle.addEventListener('click', () => {
				const isActive = transparencyToggle.classList.toggle('active');
				this.previewContainer.classList.toggle('transparent-bg', isActive);

				if (isActive) {
					this.updateTransparencyGrid();
				} else {
					this.previewContainer.style.backgroundSize = '';
					this.previewContainer.style.backgroundPosition = '';
				}
			});
		}

		if (boundsToggle) {
			boundsToggle.addEventListener('click', () => {
				const isActive = boundsToggle.classList.toggle('active');
				this.previewContainer.classList.toggle('bounds', isActive);
			});
		}
		if (snappingToggle) {
			snappingToggle.classList.toggle('active', PREFERENCES.get('snappingEnabled'));
			snappingToggle.addEventListener('click', () => {
				PREFERENCES.set('snappingEnabled', !PREFERENCES.get('snappingEnabled'));
				snappingToggle.classList.toggle('active', PREFERENCES.get('snappingEnabled'));
				this.clearSmartGuides();
			});
		}

		// In setupEventListeners() or wherever you set up preview container events
		this.previewContainer.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'touch') {
				return;
			}
			if (e.target.closest('.ui-ignore-gestures')) {
				return;
			}
			if (this.currentTool === ToolType.TEXT) {
				return;
			}
			if (this.currentTool === ToolType.SELECT && this.originalImage && e.button === 0 &&
				!e.altKey &&
				!e.target.closest(TRANSFORMABLE_LAYER_ELEMENT_SELECTOR) &&
				!e.target.closest('.group-transform-handles')) {
				this.startSelectionMarquee(e);
				return;
			}
			// Shape tool: drag out the initial size (Photoshop-style); a plain click
			// with no drag falls back to a default-size shape at the click point.
			if (this.currentTool === ToolType.SHAPE && this.originalImage) {
				this.startShapeDrag(e);
				return;
			}
			this.handlePreviewContainerClick(e);
		});

		this.previewContainer.addEventListener('click', (e) => {
			this.handlePreviewContainerClick(e);
		});

		// Prevent right-click context menu on preview area
		this.previewContainer.addEventListener('contextmenu', (e) => {
			// Always prevent on canvas
			if (e.target === this.previewCanvas || e.target === document.getElementById('maskOverlayCanvas')) {
				e.preventDefault();
				return;
			}

			// When zoom tool is active, prevent anywhere in container for zoom out functionality
			if (this.currentTool === ToolType.ZOOM) {
				e.preventDefault();
			}
		});
	}

,
	startSelectionMarquee(e) {
		const start = { x: e.clientX, y: e.clientY };
		const additive = e.shiftKey;
		const existingIds = additive ? this.layerManager.getSelectedLayers().map((layer) => layer.id) : [];
		const marquee = document.createElement('div');
		marquee.className = 'selection-marquee ui-ignore-gestures';
		this.previewContainer.appendChild(marquee);
		let didMove = false;
		const update = (ev) => {
			const rect = this.previewContainer.getBoundingClientRect();
			const left = Math.min(start.x, ev.clientX) - rect.left;
			const top = Math.min(start.y, ev.clientY) - rect.top;
			const width = Math.abs(ev.clientX - start.x);
			const height = Math.abs(ev.clientY - start.y);
			didMove = didMove || Math.max(width, height) >= 3;
			marquee.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
		};
		const cleanup = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			marquee.remove();
		};
		const onMove = (ev) => update(ev);
		const onCancel = () => cleanup();
		const onUp = (ev) => {
			cleanup();
			if (!didMove) {
				this.handlePreviewContainerClick(e);
				return;
			}
			const a = this.viewport.screenToCanvas(start.x, start.y);
			const b = this.viewport.screenToCanvas(ev.clientX, ev.clientY);
			const box = { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
			const hits = this.layerManager.layers.filter((layer) => {
				const ctx = this.getMovableLayerContext(layer);
				const transform = ctx?.manager?.layerTransforms?.get(layer.id);
				if (!transform || !layer.visible || layer.locked) return false;
				const metrics = transform.getFrameMetrics();
				return metrics.maxX >= box.left && metrics.minX <= box.right && metrics.maxY >= box.top && metrics.minY <= box.bottom;
			}).map((layer) => layer.id);
			const ids = [...new Set([...existingIds, ...hits])];
			if (ids.length) this.layerManager.setSelection(ids, { activeLayerId: ids[ids.length - 1], source: 'canvas' });
			else if (!additive) this.layerManager.clearSelection();
			this.ignoreNextClick = true;
			setTimeout(() => { this.ignoreNextClick = false; }, 0);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
	}

	// Rubber-band shape creation: drag out the box, release to create a shape of
	// that size (Shift constrains to a square). A negligible drag = a plain click,
	// which makes a default-size shape at the click point.
,
	beginShapeCreationGesture(clientX, clientY, options = {}) {
		if (!this.originalImage || !this.previewContainer) {
			return false;
		}

		this.cancelShapeCreationGesture();

		const rect = this.previewContainer.getBoundingClientRect();
		const preview = document.createElement('div');
		preview.className = 'shape-drag-preview';
		this.previewContainer.appendChild(preview);

		this.shapeCreationGesture = {
			startCanvas: this.viewport.screenToCanvas(clientX, clientY),
			startScreen: { x: clientX - rect.left, y: clientY - rect.top },
			containerRect: rect,
			preview,
			suppressNextClick: options.suppressNextClick !== false
		};

		return true;
	}

,
	getShapeCreationBox(clientX, clientY, useCanvas = false, shiftKey = false) {
		const session = this.shapeCreationGesture;
		if (!session) {
			return null;
		}

		const pointA = useCanvas ? session.startCanvas : session.startScreen;
		const pointB = useCanvas
			? this.viewport.screenToCanvas(clientX, clientY)
			: {
				x: clientX - session.containerRect.left,
				y: clientY - session.containerRect.top
			};

		let width = Math.abs(pointB.x - pointA.x);
		let height = Math.abs(pointB.y - pointA.y);
		if (shiftKey) {
			width = Math.max(width, height);
			height = width;
		}

		const left = pointB.x < pointA.x ? pointA.x - width : pointA.x;
		const top = pointB.y < pointA.y ? pointA.y - height : pointA.y;
		return {
			left,
			top,
			width,
			height,
			centerX: left + width / 2,
			centerY: top + height / 2
		};
	}

,
	updateShapeCreationGesture(clientX, clientY, shiftKey = false) {
		const session = this.shapeCreationGesture;
		if (!session) {
			return;
		}

		const box = this.getShapeCreationBox(clientX, clientY, false, shiftKey);
		if (!box) {
			return;
		}

		session.preview.style.left = `${box.left}px`;
		session.preview.style.top = `${box.top}px`;
		session.preview.style.width = `${box.width}px`;
		session.preview.style.height = `${box.height}px`;
	}

,
	cancelShapeCreationGesture() {
		const session = this.shapeCreationGesture;
		if (!session) {
			return;
		}

		session.preview?.remove();
		this.shapeCreationGesture = null;
	}

,
	finishShapeCreationGesture(clientX, clientY, options = {}) {
		const session = this.shapeCreationGesture;
		if (!session) {
			return null;
		}

		const box = this.getShapeCreationBox(clientX, clientY, true, Boolean(options.shiftKey));
		const suppressNextClick = options.suppressNextClick ?? session.suppressNextClick;

		this.cancelShapeCreationGesture();

		if (!box) {
			return null;
		}

		const isClick = Math.max(box.width, box.height) < 6;
		const shapeLayer = isClick
			? {
				shapeId: this.shapeGlitterManager.getActiveShapeId(),
				position: { x: session.startCanvas.x, y: session.startCanvas.y }
			}
			: {
				shapeId: this.shapeGlitterManager.getActiveShapeId(),
				position: { x: box.centerX, y: box.centerY },
				width: box.width,
				height: box.height
			};

		const layer = this.layerManager.addLayer(LayerType.SHAPE, { shapeLayer });

		if (suppressNextClick) {
			this.ignoreNextClick = true;
			setTimeout(() => { this.ignoreNextClick = false; }, 0);
		}

		this.finishLayerCreation(layer);
		return layer;
	}

,
	startShapeDrag(e) {
		if (this.beginShapeCreationGesture(e.clientX, e.clientY, { shiftKey: e.shiftKey, suppressNextClick: true })) {
			const onMove = (ev) => {
				this.updateShapeCreationGesture(ev.clientX, ev.clientY, ev.shiftKey);
			};

			const onUp = (ev) => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				window.removeEventListener('pointercancel', onCancel);
				this.finishShapeCreationGesture(ev.clientX, ev.clientY, {
					shiftKey: ev.shiftKey,
					suppressNextClick: true
				});
			};

			const onCancel = () => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				window.removeEventListener('pointercancel', onCancel);
				this.cancelShapeCreationGesture();
			};

			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
			window.addEventListener('pointercancel', onCancel);
			return;
		}

		const container = this.previewContainer;
		const rect = container.getBoundingClientRect();
		const startCanvas = this.viewport.screenToCanvas(e.clientX, e.clientY);
		const startScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };

		const preview = document.createElement('div');
		preview.className = 'shape-drag-preview';
		container.appendChild(preview);

		let lastShift = false;

		const boxFromEvent = (ev, useCanvas) => {
			const a = useCanvas ? startCanvas : startScreen;
			const b = useCanvas
				? this.viewport.screenToCanvas(ev.clientX, ev.clientY)
				: { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
			let w = Math.abs(b.x - a.x);
			let h = Math.abs(b.y - a.y);
			if (ev.shiftKey) { w = h = Math.max(w, h); }
			const left = b.x < a.x ? a.x - w : a.x;
			const top = b.y < a.y ? a.y - h : a.y;
			return { left, top, w, h, cx: left + w / 2, cy: top + h / 2 };
		};

		const onMove = (ev) => {
			lastShift = ev.shiftKey;
			const box = boxFromEvent(ev, false);
			preview.style.left = `${box.left}px`;
			preview.style.top = `${box.top}px`;
			preview.style.width = `${box.w}px`;
			preview.style.height = `${box.h}px`;
		};

		const onUp = (ev) => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			preview.remove();

			const box = boxFromEvent(ev, true);
			const isClick = Math.max(box.w, box.h) < 6;
			// A click: no explicit box → createLayer derives an aspect-correct default
			// size. A drag: pass the drawn box (may stretch, Photoshop-style).
			const shapeLayer = isClick
				? { shapeId: this.shapeGlitterManager.getActiveShapeId(), position: { x: startCanvas.x, y: startCanvas.y } }
				: { shapeId: this.shapeGlitterManager.getActiveShapeId(), position: { x: box.cx, y: box.cy }, width: box.w, height: box.h };

			const layer = this.layerManager.addLayer(LayerType.SHAPE, { shapeLayer });

			// Swallow the click that follows this pointerup so it can't double-create.
			this.ignoreNextClick = true;
			setTimeout(() => { this.ignoreNextClick = false; }, 0);

			this.finishLayerCreation(layer);
		};

		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	// ===== GLOBAL LISTENERS =====
,
	setupGlobalListeners() {
		// Keyboard
		document.addEventListener('keydown', (e) => this.handleKeyboard(e));
		document.addEventListener('keyup', (e) => this.handleKeyUp(e));
		// A keyup can be missed if focus leaves the window mid-drag; clear Shift.
		window.addEventListener('blur', () => { this.shiftHeld = false; });

		// Viewport changes
		window.addEventListener('viewportChanged', () => {
			this.updateZoomUI();
			this.updateTransparencyGrid();
			this.updateStatusBar();
			this.maskEditor?._updateBrushCursorSize();
			this.maskEditor?.renderOverlay();
		});

		// Prevent leaving if unsaved
		window.addEventListener('beforeunload', (e) => {
			if ((this.originalImage || this.historyManager.canUndo()) && !this.isSaved) {
				e.preventDefault();
				e.returnValue = '';
			}
		});

		// Scroll zoom
		this.previewContainer.addEventListener('wheel', (e) => {
			if (!this.originalImage) {
				return;
			}

			e.preventDefault();

			if (e.ctrlKey || e.metaKey) {
				if (e.deltaY < 0) {
					this.viewport.zoomIn(e.clientX, e.clientY);
				} else {
					this.viewport.zoomOut(e.clientX, e.clientY);
				}
				return;
			}

			if (e.shiftKey) {
				this.viewport.panBy(-e.deltaY, 0);
				return;
			}

			this.viewport.panBy(0, -e.deltaY);
		}, { passive: false });
	}
};
