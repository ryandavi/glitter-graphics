const CANVAS_GESTURE_METHODS = {
	// Tool settings remain editable in a sheet, but its hidden tool cannot draw.
	isCanvasToolSuspended() {
		return Boolean(this.mobileManager?.isMobile && this.mobileManager.activeDrawer && this.currentTool !== ToolType.SELECT);
	}

,

	// The kind of the edit session that owns the canvas and keyboard right
	// now, or null. Context toolbars and commands
	// that must not fire inside a session read it.
	getActiveSession() {
		return getSessionDefinition(this)?.id || null;
	}

,
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
				const enabled = !PREFERENCES.get('snappingEnabled');
				PREFERENCES.set('snappingEnabled', enabled);
				snappingToggle.classList.toggle('active', enabled);
				// Settings shows the same preference, so it has to agree.
				const settingsInput = document.getElementById('snappingEnabled');
				if (settingsInput) settingsInput.checked = enabled;
				this.clearSmartGuides();
			});
		}

		this.previewContainer.addEventListener('pointerdown', event => {
			if (this.isCanvasToolSuspended() || event.pointerType === 'touch' || !this.originalImage || event.target.closest('.ui-ignore-gestures, .transform-handle-wrapper, .transform-handles')) return;
			TOOLS[this.currentTool].onCanvasPointerDown?.(this, event);
		}, { capture: true });

		// In setupEventListeners() or wherever you set up preview container events
		this.previewContainer.addEventListener('pointerdown', (e) => {
			if (this.isCanvasToolSuspended() || e.pointerType === 'touch') {
				return;
			}
			if (e.target.closest('.ui-ignore-gestures')) {
				return;
			}
			if (this.currentTool === ToolType.ZOOM && this.originalImage && e.button === 0) {
				this.startScrubbyZoom(e);
				return;
			}
			if (this.currentTool === ToolType.SELECT && this.originalImage && e.button === 0 &&
				!e.altKey &&
				!e.target.closest(getTransformableLayerElementSelector()) &&
				!e.target.closest('.group-transform-handles')) {
				if (this.startCanvasPickedLayerDrag(e)) return;
				this.startSelectionMarquee(e);
				return;
			}

			// Shape tool: drag out the initial size (Photoshop-style); a plain click
			// with no drag falls back to a default-size shape at the click point.
			if (TOOLS[this.currentTool]?.onCanvasDrag && this.originalImage && e.button === 0) {
				this.startCreationDrag(e);
				return;
			}
			this.handlePreviewContainerClick(e);
		});

		this.previewContainer.addEventListener('click', (e) => {
			this.handlePreviewContainerClick(e);
		});

		// With Select, a double-click opens the editor of a type that has one
		// (LAYER_UI_CONFIG onDoubleClick: a path's points).
		this.previewContainer.addEventListener('dblclick', (e) => {
			if (this.currentTool !== ToolType.SELECT || !this.originalImage || e.target.closest('.ui-ignore-gestures')) return;
			const point = this.viewport.screenToCanvas(e.clientX, e.clientY);
			const layer = this.layerManager.getTopVisibleLayerAtPoint(point.x, point.y, { includeBase: false, excludeLocked: true });
			if (layer) LAYER_UI_CONFIG[layer.type]?.onDoubleClick?.(this, layer);
		});

		// The move cursor for a canvas-picked layer follows the same test as the
		// press that would drag it.
		this.previewContainer.addEventListener('pointermove', (e) => {
			if (e.pointerType !== 'mouse' || e.buttons) return;
			const picked = this.currentTool === ToolType.SELECT && this.originalImage
				&& !e.target.closest(`.ui-ignore-gestures, .group-transform-handles, ${getTransformableLayerElementSelector()}`)
				&& this.getCanvasPickedLayerAt(e);
			this.previewContainer.classList.toggle('is-over-picked-layer', Boolean(picked));
		});
		this.previewContainer.addEventListener('pointerleave', () => this.previewContainer.classList.remove('is-over-picked-layer'));

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
	startScrubbyZoom(event) {
		const start = { x: event.clientX, y: event.clientY, zoom: this.viewport.currentZoom };
		let active = false;
		const cleanup = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			this.previewContainer.classList.remove('scrubby-zooming');
		};
		const onMove = (moveEvent) => {
			const dx = moveEvent.clientX - start.x;
			const dy = moveEvent.clientY - start.y;
			if (!active && Math.hypot(dx, dy) < 4) return;
			active = true;
			this.previewContainer.classList.add('scrubby-zooming');
			// Right/up zoom in; left/down zoom out. Absolute-from-start math avoids
			// compounding event-rate differences between mice and trackpads.
			const distance = dx - dy;
			this.viewport.setZoom(start.zoom * Math.exp(distance * 0.005), start.x, start.y);
		};
		const onUp = () => {
			cleanup();
			if (!active) return;
			this.ignoreNextClick = true;
			setTimeout(() => { this.ignoreNextClick = false; }, 0);
		};
		const onCancel = () => cleanup();
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
	}

,
	// The canvas-picked layer a press at this pointer would drag, if any. The
	// press and the hover cursor share this test.
	getCanvasPickedLayerAt(e) {
		if (e.shiftKey || !PREFERENCES.get('autoSelect') || this.autoGlitterManager?.isSessionActive()) return null;
		const point = this.viewport.screenToCanvas(e.clientX, e.clientY);
		const layer = this.layerManager.getTopVisibleLayerAtPoint(point.x, point.y, { includeBase: false, excludeLocked: true });
		return layer && LAYER_UI_CONFIG[layer.type]?.pickedOnCanvas && isLayerSelectableOnCanvas(layer) ? layer : null;
	}

,
	// A layer picked on the canvas (LAYER_UI_CONFIG pickedOnCanvas) has no
	// element to press, so a press on its painted pixels selects it and hands
	// the drag to its move handle: one press-and-drag, like a sticker.
	startCanvasPickedLayerDrag(e) {
		const layer = this.getCanvasPickedLayerAt(e);
		if (!layer) return false;
		if (this.layerManager.activeLayerId !== layer.id || this.layerManager.hasMultiSelection()) {
			this.layerManager.selectLayerFromCanvas(layer.id);
		}
		if (!isLayerTransformable(layer)) return true;
		const transform = this.getMovableLayerContext(layer)?.manager?.layerTransforms?.get(layer.id);
		if (!transform) return false;
		if (!transform.chrome) transform.createTransformHandles();
		if (!transform.chrome) return false;
		transform.beginHandleDrag('move', e, transform.chrome.box);
		return true;
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
	beginCreationGesture(clientX, clientY, options = {}) {
		if (!this.originalImage || !this.previewContainer) {
			return false;
		}

		this.cancelCreationGesture();

		const rect = this.previewContainer.getBoundingClientRect();
		const preview = document.createElement('div');
		preview.className = 'creation-drag-preview';
		this.previewContainer.appendChild(preview);

		this.creationGesture = {
			startCanvas: this.viewport.screenToCanvas(clientX, clientY),
			startScreen: { x: clientX - rect.left, y: clientY - rect.top },
			containerRect: rect,
			preview,
			suppressNextClick: options.suppressNextClick !== false
		};

		return true;
	}

,
	getCreationBox(clientX, clientY, useCanvas = false, shiftKey = false) {
		const session = this.creationGesture;
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
	// Where a line-shaped creation drag ends: the pointer, or with Shift the
	// nearest angle step around the start.
	getCreationLineEnd(clientX, clientY, useCanvas = false, shiftKey = false) {
		const session = this.creationGesture;
		const start = useCanvas ? session.startCanvas : session.startScreen;
		const end = useCanvas
			? this.viewport.screenToCanvas(clientX, clientY)
			: { x: clientX - session.containerRect.left, y: clientY - session.containerRect.top };
		return shiftKey ? PathGeometry.constrainAngle(start, end, CONFIG.tools.path.line.angleStepDeg) : end;
	}

,
	updateCreationGesture(clientX, clientY, shiftKey = false) {
		const session = this.creationGesture;
		if (!session) {
			return;
		}

		if (TOOLS[this.currentTool]?.dragPreview === 'line') {
			const start = session.startScreen;
			const end = this.getCreationLineEnd(clientX, clientY, false, shiftKey);
			session.preview.classList.add('is-line');
			session.preview.style.left = `${start.x}px`;
			session.preview.style.top = `${start.y}px`;
			session.preview.style.width = `${Math.hypot(end.x - start.x, end.y - start.y)}px`;
			session.preview.style.transform = `rotate(${Math.atan2(end.y - start.y, end.x - start.x)}rad)`;
			return;
		}

		const box = this.getCreationBox(clientX, clientY, false, shiftKey);
		if (!box) {
			return;
		}

		session.preview.style.left = `${box.left}px`;
		session.preview.style.top = `${box.top}px`;
		session.preview.style.width = `${box.width}px`;
		session.preview.style.height = `${box.height}px`;
	}

,
	cancelCreationGesture() {
		const session = this.creationGesture;
		if (!session) {
			return;
		}

		session.preview?.remove();
		this.creationGesture = null;
	}

,
	finishCreationGesture(clientX, clientY, options = {}) {
		const session = this.creationGesture;
		if (!session) {
			return null;
		}

		const box = this.getCreationBox(clientX, clientY, true, Boolean(options.shiftKey));
		const end = this.getCreationLineEnd(clientX, clientY, true, Boolean(options.shiftKey));
		const suppressNextClick = options.suppressNextClick ?? session.suppressNextClick;

		this.cancelCreationGesture();

		if (!box) {
			return null;
		}

		const isClick = Math.max(box.width, box.height) < CONFIG.ui.gestures.creationDragThreshold;
		const layer = TOOLS[this.currentTool]?.onCanvasDrag?.(this, { box, isClick, start: session.startCanvas, end, shiftKey: Boolean(options.shiftKey) });

		if (suppressNextClick) {
			this.ignoreNextClick = true;
			setTimeout(() => { this.ignoreNextClick = false; }, 0);
		}

		return layer;
	}

,
	startCreationDrag(e) {
		if (this.beginCreationGesture(e.clientX, e.clientY, { shiftKey: e.shiftKey, suppressNextClick: true })) {
			const onMove = (ev) => {
				this.updateCreationGesture(ev.clientX, ev.clientY, ev.shiftKey);
			};

			const onUp = (ev) => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				window.removeEventListener('pointercancel', onCancel);
				this.finishCreationGesture(ev.clientX, ev.clientY, {
					shiftKey: ev.shiftKey,
					suppressNextClick: true
				});
			};

			const onCancel = () => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				window.removeEventListener('pointercancel', onCancel);
				this.cancelCreationGesture();
			};

			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
			window.addEventListener('pointercancel', onCancel);
			return;
		}

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
			this.maskEditor?._updateBrushCursorSize();
			this.maskEditor?.renderOverlay();
			this.requestPreviewUpdate();
		});

		// Prevent leaving if unsaved
		window.addEventListener('beforeunload', (e) => {
			if ((this.originalImage || this.historyManager.canUndo()) && !this.isSaved) {
				e.preventDefault();
				e.returnValue = '';
			}
		});

		// Safari exposes trackpad pinch through proprietary GestureEvents. Keep
		// this scoped to the workspace and suppress its companion wheel stream so
		// a physical pinch can never be applied twice.
		let nativeGestureScale = 1;
		let nativeGestureActive = false;
		let nativeGestureSuppressWheelUntil = 0;
		this.previewContainer.addEventListener('gesturestart', (e) => {
			if (!this.originalImage) return;
			e.preventDefault();
			nativeGestureScale = Number.isFinite(e.scale) && e.scale > 0 ? e.scale : 1;
			nativeGestureActive = true;
			nativeGestureSuppressWheelUntil = performance.now() + 100;
		}, { passive: false });
		this.previewContainer.addEventListener('gesturechange', (e) => {
			if (!this.originalImage) return;
			e.preventDefault();
			nativeGestureSuppressWheelUntil = performance.now() + 100;
			// Pointer Events already own direct-screen touches; GestureEvents here
			// are only a fallback for pointerless Safari trackpad pinches.
			if (this.viewport.gestureManager?.pointers?.size) return;
			const nextScale = Number.isFinite(e.scale) && e.scale > 0 ? e.scale : nativeGestureScale;
			this.viewport.zoomByFactor(nextScale / nativeGestureScale, e.clientX, e.clientY);
			nativeGestureScale = nextScale;
		}, { passive: false });
		this.previewContainer.addEventListener('gestureend', (e) => {
			if (!nativeGestureActive) return;
			e.preventDefault();
			nativeGestureActive = false;
			nativeGestureScale = 1;
			nativeGestureSuppressWheelUntil = performance.now() + 100;
		}, { passive: false });

		// Scroll zoom
		this.previewContainer.addEventListener('wheel', (e) => {
			if (!this.originalImage) {
				return;
			}

			e.preventDefault();
			if (nativeGestureActive || performance.now() < nativeGestureSuppressWheelUntil) return;

			const input = VIEWPORT_INPUT.normalizeWheel(e, {
				pageSize: this.viewport.getUsableRect().height,
				zoomSensitivity: CONFIG.ui.gestures.wheelZoomSensitivity
			});
			if (input.type === 'zoom') {
				this.viewport.queueZoomByFactor(input.factor, input.clientX, input.clientY);
			} else {
				this.viewport.queuePanBy(input.deltaX, input.deltaY);
			}
		}, { passive: false });
	}
};
