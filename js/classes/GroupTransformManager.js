class GroupTransformManager {
	constructor(editor) {
		this.editor = editor;
		this.transformHandles = null;
		this.activeHandleType = null;
		this.activeHandleElement = null;
		this.activeHandlePointerId = null;
		this.dragStartState = null;
		this.gestureInteractionActive = false;
		this.gestureInteractionChanged = false;
		this.isDraggingHandle = false;

		this.handlePointerMove = this.handlePointerMove.bind(this);
		this.handlePointerUp = this.handlePointerUp.bind(this);
	}

	normalizeRotation(angle) {
		let next = angle % 360;
		if (next < 0) next += 360;
		return next;
	}

	getPointerAngle(bounds, event) {
		const canvasPos = this.editor.viewport.screenToCanvas(event.clientX, event.clientY);
		return Math.atan2(canvasPos.y - bounds.centerY, canvasPos.x - bounds.centerX) * (180 / Math.PI);
	}

	applyLayerStateDelta(layerStates, bounds, options = {}) {
		if (!Array.isArray(layerStates) || !bounds) return;

		const translateX = options.translateX || 0;
		const translateY = options.translateY || 0;
		const scaleFactor = Math.max(0.1, Math.min(5, options.scaleFactor || 1));
		const rotateDeg = options.rotateDeg || 0;
		const rotateRad = (rotateDeg * Math.PI) / 180;
		const cos = Math.cos(rotateRad);
		const sin = Math.sin(rotateRad);

		layerStates.forEach(({ transform, position, scale, rotation }) => {
			const relativeX = position.x - bounds.centerX;
			const relativeY = position.y - bounds.centerY;
			const scaledX = relativeX * scaleFactor;
			const scaledY = relativeY * scaleFactor;
			const rotatedX = (scaledX * cos) - (scaledY * sin);
			const rotatedY = (scaledX * sin) + (scaledY * cos);

			transform.updateTransform({
				position: {
					x: bounds.centerX + rotatedX + translateX,
					y: bounds.centerY + rotatedY + translateY
				},
				scale: {
					x: clampLayerScale(scale.x * scaleFactor),
					y: clampLayerScale(scale.y * scaleFactor)
				},
				rotation: this.normalizeRotation(rotation + rotateDeg)
			});
		});
	}

	getSelectedLayers() {
		return this.editor.layerManager.getMultiSelectedMovableLayers();
	}

	isActive() {
		return this.getSelectedLayers().length > 1;
	}

	getSelectedLayerIds() {
		return this.getSelectedLayers().map((layer) => layer.id);
	}

	getLayerTransform(layer) {
		const ctx = this.editor.getMovableLayerContext(layer);
		return ctx?.manager?.layerTransforms?.get(layer.id) || null;
	}

	getLayerEntries() {
		return this.getSelectedLayers()
			.map((layer) => {
				const transform = this.getLayerTransform(layer);
				if (!transform) return null;
				return { layer, transform };
			})
			.filter(Boolean);
	}

	getBounds() {
		const entries = this.getLayerEntries();
		if (entries.length < 2) {
			return null;
		}

		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		entries.forEach(({ transform }) => {
			const metrics = transform.getFrameMetrics();
			minX = Math.min(minX, metrics.minX);
			minY = Math.min(minY, metrics.minY);
			maxX = Math.max(maxX, metrics.maxX);
			maxY = Math.max(maxY, metrics.maxY);
		});

		return {
			left: minX,
			top: minY,
			right: maxX,
			bottom: maxY,
			width: Math.max(1, maxX - minX),
			height: Math.max(1, maxY - minY),
			centerX: (minX + maxX) / 2,
			centerY: (minY + maxY) / 2
		};
	}

	containsCanvasPoint(x, y) {
		const bounds = this.getBounds();
		if (!bounds) return false;
		return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
	}

	containsScreenPoint(screenX, screenY) {
		const point = this.editor.viewport.screenToCanvas(screenX, screenY);
		return this.containsCanvasPoint(point.x, point.y);
	}

	handleMoveSelectionIntent(event) {
		const point = this.editor.viewport.screenToCanvas(event.clientX, event.clientY);
		const x = Math.round(point.x);
		const y = Math.round(point.y);

		if (event.shiftKey) {
			this.editor.layerManager.handleLayerPick(x, y, {
				toggleSelection: Boolean(event.shiftKey),
				cycleDeep: Boolean(event.altKey)
			});
			return true;
		}

		const topLayer = this.editor.layerManager.getTopVisibleLayerAtPoint(x, y, {
			includeBase: false
		});
		if (topLayer && !this.editor.layerManager.isLayerSelected(topLayer.id)) {
			this.editor.layerManager.selectLayerFromCanvas(topLayer.id);
			return true;
		}

		return false;
	}

	getTopSelectedLayerAtCanvasPoint(x, y) {
		return this.editor.layerManager.getLayersAtPoint(x, y, {
			includeBase: false,
			movableOnly: true
		}).find((layer) => this.editor.layerManager.isLayerSelected(layer.id)) || null;
	}

	applyEntries(entries) {
		entries.forEach(({ transform }) => {
			transform.applyTransform(transform.element, transform.getDimensions());
		});

		this.updateHandlePositions();
	}

	ensureHistoryBaseline() {
		const historyManager = this.editor.historyManager;
		const snapshot = historyManager?.history?.[historyManager.historyIndex] || null;
		if (!snapshot) {
			this.editor.saveState();
			return;
		}

		const currentSelectedIds = this.getSelectedLayerIds();
		const snapshotSelectedIds = Array.isArray(snapshot.selectedLayerIds)
			? snapshot.selectedLayerIds
			: (snapshot.activeLayerId ? [snapshot.activeLayerId] : []);
		const sameActive = snapshot.activeLayerId === this.editor.activeLayerId;
		const sameSelection = snapshotSelectedIds.length === currentSelectedIds.length
			&& snapshotSelectedIds.every((layerId) => currentSelectedIds.includes(layerId));

		if (!sameActive || !sameSelection) {
			this.editor.saveState();
		}
	}

	beginGestureInteraction() {
		if (!this.isActive() || this.gestureInteractionActive) {
			return;
		}

		this.ensureHistoryBaseline();
		this.gestureInteractionActive = true;
		this.gestureInteractionChanged = false;
	}

	dragByScreenDelta(deltaX, deltaY) {
		this.beginGestureInteraction();

		const canvasDeltaX = deltaX / this.editor.viewport.currentZoom;
		const canvasDeltaY = deltaY / this.editor.viewport.currentZoom;
		const entries = this.getLayerEntries();
		if (!entries.length) return;

		entries.forEach(({ transform }) => {
			const current = transform.getTransform();
			transform.updateTransform({
				position: {
					x: current.position.x + canvasDeltaX,
					y: current.position.y + canvasDeltaY
				}
			});
		});

		this.gestureInteractionChanged = true;
		this.applyEntries(entries);
	}

	applyGestureDelta(gestureDelta) {
		this.beginGestureInteraction();

		const entries = this.getLayerEntries();
		const bounds = this.getBounds();
		if (!entries.length || !bounds) return;

		const translateCanvasX = gestureDelta.translateX / this.editor.viewport.currentZoom;
		const translateCanvasY = gestureDelta.translateY / this.editor.viewport.currentZoom;
		const scaleFactor = Math.max(0.1, Math.min(5, gestureDelta.scale || 1));
		const rotateDeg = gestureDelta.rotateDeg || 0;
		const layerStates = entries.map(({ transform }) => {
			const current = transform.getTransform();
			return {
				transform,
				position: { ...current.position },
				scale: { ...current.scale },
				rotation: current.rotation || 0
			};
		});

		this.applyLayerStateDelta(layerStates, bounds, {
			translateX: translateCanvasX,
			translateY: translateCanvasY,
			scaleFactor,
			rotateDeg
		});

		this.gestureInteractionChanged = true;
		this.applyEntries(layerStates);
	}

	async commitScaledLayers() {
		for (const layer of this.getSelectedLayers()) {
			if (layer.type === LayerType.TEXT_GLITTER) {
				await this.editor.textGlitterManager?.commitScaleToFontSize?.(layer);
				continue;
			}

			if (layer.type === LayerType.SHAPE) {
				this.editor.shapeGlitterManager?.commitScale(layer);
			}
		}
	}

	async endGestureInteraction() {
		if (!this.gestureInteractionActive) {
			return;
		}

		if (this.gestureInteractionChanged) {
			await this.commitScaledLayers();
			this.editor.saveState();
			this.editor.syncTransformHandlesForActiveLayer?.();
		}

		this.gestureInteractionActive = false;
		this.gestureInteractionChanged = false;
	}

	alignToCanvas(mode) {
		const bounds = this.getBounds();
		if (!bounds || !this.editor.originalCanvas) return;

		let deltaX = 0;
		let deltaY = 0;

		switch (mode) {
			case 'left': deltaX = -bounds.left; break;
			case 'centerX':
				deltaX = (this.editor.originalCanvas.width / 2) - bounds.centerX;
				break;
			case 'right': deltaX = this.editor.originalCanvas.width - bounds.right; break;
			case 'top': deltaY = -bounds.top; break;
			case 'centerY':
				deltaY = (this.editor.originalCanvas.height / 2) - bounds.centerY;
				break;
			case 'bottom': deltaY = this.editor.originalCanvas.height - bounds.bottom; break;
			default:
				return;
		}

		this.translateByCanvasDelta(deltaX, deltaY, { saveState: true });
	}

	alignToSelection(mode) {
		const bounds = this.getBounds();
		const entries = this.getLayerEntries();
		if (!bounds || entries.length < 2) return;
		this.ensureHistoryBaseline();
		entries.forEach(({ transform }) => {
			const metrics = transform.getFrameMetrics();
			let deltaX = 0;
			let deltaY = 0;
			switch (mode) {
				case 'left': deltaX = bounds.left - metrics.minX; break;
				case 'centerX': deltaX = bounds.centerX - ((metrics.minX + metrics.maxX) / 2); break;
				case 'right': deltaX = bounds.right - metrics.maxX; break;
				case 'top': deltaY = bounds.top - metrics.minY; break;
				case 'centerY': deltaY = bounds.centerY - ((metrics.minY + metrics.maxY) / 2); break;
				case 'bottom': deltaY = bounds.bottom - metrics.maxY; break;
				default: return;
			}
			const current = transform.getTransform();
			transform.updateTransform({ position: { x: current.position.x + deltaX, y: current.position.y + deltaY } });
		});
		this.applyEntries(entries);
		this.editor.saveState();
	}

	distribute(axis) {
		const entries = this.getLayerEntries();
		if (entries.length < 3) return;
		const keyed = entries.map((entry) => {
			const metrics = entry.transform.getFrameMetrics();
			return { ...entry, center: axis === 'horizontal' ? (metrics.minX + metrics.maxX) / 2 : (metrics.minY + metrics.maxY) / 2 };
		}).sort((a, b) => a.center - b.center);
		this.ensureHistoryBaseline();
		const step = (keyed[keyed.length - 1].center - keyed[0].center) / (keyed.length - 1);
		keyed.slice(1, -1).forEach((entry, index) => {
			const delta = keyed[0].center + (step * (index + 1)) - entry.center;
			const current = entry.transform.getTransform();
			entry.transform.updateTransform({ position: { x: current.position.x + (axis === 'horizontal' ? delta : 0), y: current.position.y + (axis === 'vertical' ? delta : 0) } });
		});
		this.applyEntries(keyed);
		this.editor.saveState();
	}

	translateByCanvasDelta(deltaX, deltaY, options = {}) {
		const entries = this.getLayerEntries();
		if (!entries.length) return;
		this.ensureHistoryBaseline();

		entries.forEach(({ transform }) => {
			const current = transform.getTransform();
			transform.updateTransform({
				position: {
					x: current.position.x + deltaX,
					y: current.position.y + deltaY
				}
			});
		});

		this.applyEntries(entries);

		if (options.saveState) {
			this.editor.saveState();
		}
	}

	nudge(deltaX, deltaY) {
		this.translateByCanvasDelta(deltaX, deltaY);
	}

	createTransformHandles() {
		if (!CONFIG.ui.stickerHandles.enabled || this.editor.currentTool !== ToolType.SELECT || !this.isActive()) {
			return;
		}

		this.removeTransformHandles();

		const container = document.createElement('div');
		container.className = 'transform-handles group-transform-handles';
		container.dataset.layerId = 'group-selection';

		const boundingBox = document.createElement('div');
		boundingBox.className = 'transform-bounding-box';
		boundingBox.dataset.handleType = 'move';
		container.appendChild(boundingBox);

		['tl', 'tr', 'br', 'bl'].forEach((corner) => {
			const wrapper = document.createElement('div');
			wrapper.className = 'transform-handle-wrapper';
			wrapper.dataset.handleType = `corner-${corner}`;

			const handle = document.createElement('div');
			handle.className = `transform-handle transform-handle-corner corner-${corner}`;

			wrapper.appendChild(handle);
			container.appendChild(wrapper);
		});

		const rotationLine = document.createElement('div');
		rotationLine.className = 'transform-rotation-line';
		container.appendChild(rotationLine);

		const rotationWrapper = document.createElement('div');
		rotationWrapper.className = 'transform-handle-wrapper';
		rotationWrapper.dataset.handleType = 'rotation';

		const rotationHandle = document.createElement('div');
		rotationHandle.className = 'transform-handle transform-handle-rotation';

		rotationWrapper.appendChild(rotationHandle);
		container.appendChild(rotationWrapper);

		this.editor.canvasElementsContainer.appendChild(container);
		this.transformHandles = container;
		this.updateHandlePositions();
		this.attachHandleListeners();
	}

	updateHandlePositions() {
		if (!this.transformHandles) return;

		const bounds = this.getBounds();
		if (!bounds) {
			this.removeTransformHandles();
			return;
		}

		const boundingBox = this.transformHandles.querySelector('.transform-bounding-box');
		if (boundingBox) {
			boundingBox.style.cssText = `
				position: absolute;
				left: ${bounds.left}px;
				top: ${bounds.top}px;
				width: ${bounds.width}px;
				height: ${bounds.height}px;
				pointer-events: auto;
				cursor: move;
			`;
		}

		const zoom = this.editor.viewport.currentZoom;
		const outset = screenPixelsToCanvasUnits(CONFIG.ui.stickerHandles.outwardOffset, zoom);
		const corners = {
			tl: { x: bounds.left - outset, y: bounds.top - outset },
			tr: { x: bounds.right + outset, y: bounds.top - outset },
			br: { x: bounds.right + outset, y: bounds.bottom + outset },
			bl: { x: bounds.left - outset, y: bounds.bottom + outset }
		};

		Object.entries(corners).forEach(([corner, point]) => {
			const wrapper = this.transformHandles.querySelector(`[data-handle-type="corner-${corner}"]`);
			if (!wrapper) return;

			wrapper.style.cssText = `
				position: absolute;
				left: ${point.x}px;
				top: ${point.y}px;
				transform: translate(-50%, -50%);
			`;
			wrapper.style.cursor = corner === 'tl' || corner === 'br' ? 'nwse-resize' : 'nesw-resize';
		});

		const rotationDistance = screenPixelsToCanvasUnits(CONFIG.ui.stickerHandles.rotationHandleDistance, zoom);
		const topCenterX = bounds.centerX;
		const topCenterY = bounds.top - rotationDistance;
		const rotationWrapper = this.transformHandles.querySelector('[data-handle-type="rotation"]');
		if (rotationWrapper) {
			rotationWrapper.style.cssText = `
				position: absolute;
				left: ${topCenterX}px;
				top: ${topCenterY}px;
				transform: translate(-50%, -50%);
				cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath fill='white' stroke='black' stroke-width='1' d='M12 3v4m0 10v4M3 12h4m10 0h4M6.34 6.34l2.83 2.83m5.66 5.66l2.83 2.83M6.34 17.66l2.83-2.83m5.66-5.66l2.83-2.83'/%3E%3C/svg%3E") 12 12, auto;
			`;
		}

		const rotationLine = this.transformHandles.querySelector('.transform-rotation-line');
		if (rotationLine) {
			const lineWidth = screenPixelsToCanvasUnits(CONFIG.ui.stickerHandles.boundingBoxWidth, zoom);
			rotationLine.style.cssText = `
				position: absolute;
				left: ${bounds.centerX}px;
				top: ${bounds.top}px;
				width: ${lineWidth}px;
				height: ${rotationDistance}px;
				transform: translate(-50%, 0);
				transform-origin: top center;
				pointer-events: none;
			`;
		}
	}

	removeTransformHandles() {
		this.removeDocumentHandleListeners();
		if (this.transformHandles?.parentNode) {
			this.transformHandles.parentNode.removeChild(this.transformHandles);
		}

		document.querySelectorAll('.group-transform-handles').forEach((element) => {
			if (element.parentNode) {
				element.parentNode.removeChild(element);
			}
		});

		this.transformHandles = null;
		this.activeHandleType = null;
		this.activeHandleElement = null;
		this.activeHandlePointerId = null;
		this.dragStartState = null;
		this.isDraggingHandle = false;
	}

	removeDocumentHandleListeners() {
		document.removeEventListener('pointermove', this.handlePointerMove);
		document.removeEventListener('pointerup', this.handlePointerUp);
		document.removeEventListener('pointercancel', this.handlePointerUp);
	}

	attachHandleListeners() {
		if (!this.transformHandles) return;

		this.transformHandles.querySelectorAll('[data-handle-type]').forEach((handle) => {
			const handleType = handle.dataset.handleType;

			handle.addEventListener('pointerdown', (event) => {
				if (event.pointerType === 'mouse' && event.button !== 0) {
					return;
				}

				if (handleType === 'move' && this.handleMoveSelectionIntent(event)) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();

				const bounds = this.getBounds();
				const layerStates = this.getLayerEntries().map(({ layer, transform }) => ({
					layer,
					transform,
					position: { ...transform.getTransform().position },
					scale: { ...transform.getTransform().scale },
					rotation: transform.getTransform().rotation || 0
				}));
				this.ensureHistoryBaseline();

				this.activeHandleType = handleType;
				this.activeHandleElement = handle;
				this.activeHandlePointerId = event.pointerId;
				this.isDraggingHandle = true;
				handle.setPointerCapture?.(event.pointerId);

				this.dragStartState = {
					canvasX: this.editor.viewport.screenToCanvas(event.clientX, event.clientY).x,
					canvasY: this.editor.viewport.screenToCanvas(event.clientX, event.clientY).y,
					bounds,
					layerStates,
					startAngle: handleType === 'rotation'
						? this.getPointerAngle(bounds, event)
						: null,
					lockedAxis: null,
					didMove: false,
					selectionCandidateId: handleType === 'move'
						? this.getTopSelectedLayerAtCanvasPoint(
							Math.round(this.editor.viewport.screenToCanvas(event.clientX, event.clientY).x),
							Math.round(this.editor.viewport.screenToCanvas(event.clientX, event.clientY).y)
						)?.id || null
						: null,
					altDuplicatePending: handleType === 'move' && event.altKey,
					originalSelectionIds: handleType === 'move' && event.altKey ? this.getSelectedLayerIds() : null
				};

				// Keep the drag alive even if cloning/reordering moves the original
				// handle node and the browser releases its pointer capture.
				document.addEventListener('pointermove', this.handlePointerMove);
				document.addEventListener('pointerup', this.handlePointerUp);
				document.addEventListener('pointercancel', this.handlePointerUp);
			});

			if (handleType === 'move') {
				handle.addEventListener('click', (event) => {
					if (event.shiftKey || event.altKey) {
						return;
					}

					const point = this.editor.viewport.screenToCanvas(event.clientX, event.clientY);
					const selectedLayer = this.getTopSelectedLayerAtCanvasPoint(
						Math.round(point.x),
						Math.round(point.y)
					);
					if (!selectedLayer) {
						return;
					}

					event.preventDefault();
					event.stopPropagation();
					this.editor.layerManager.selectLayerFromCanvas(selectedLayer.id);
				});
			}
		});
	}

	handlePointerMove(event) {
		if (
			!this.activeHandleType ||
			!this.dragStartState ||
			event.pointerId !== this.activeHandlePointerId
		) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		if (this.activeHandleType === 'move') {
			this.handleMoveDrag(event);
			return;
		}

		if (this.activeHandleType.startsWith('corner-')) {
			this.handleCornerDrag(event);
			return;
		}

		if (this.activeHandleType === 'rotation') {
			this.handleRotationDrag(event);
		}
	}

	async handlePointerUp(event) {
		if (event.pointerId !== this.activeHandlePointerId) {
			return;
		}

		const shouldSingleSelect = this.activeHandleType === 'move'
			&& this.dragStartState?.selectionCandidateId
			&& !this.dragStartState?.didMove
			&& !this.dragStartState?.altDuplicatePending;
		if (this.activeHandleType === 'move' && this.dragStartState?.altDuplicatePending && !this.dragStartState?.didMove) {
			const point = this.editor.viewport.screenToCanvas(event.clientX, event.clientY);
			this.editor.layerManager.handleLayerPick(Math.round(point.x), Math.round(point.y), { cycleDeep: true });
		}

		if (shouldSingleSelect) {
			event.preventDefault();
			event.stopPropagation();
			this.editor.layerManager.selectLayerFromCanvas(this.dragStartState.selectionCandidateId);
		}

		if (this.isDraggingHandle) {
			const completedDrag = this.dragStartState;
			event.preventDefault();
			event.stopPropagation();
			this.isDraggingHandle = false;
			if (!shouldSingleSelect && this.dragStartState?.didMove) {
				if (this.activeHandleType?.startsWith('corner-')) {
					await this.commitScaledLayers();
				}
				if (completedDrag.cloneIds?.length) {
					this.editor.layerManager.setSelection(completedDrag.cloneIds, {
						activeLayerId: completedDrag.cloneIds.at(-1)
					});
				}
				this.editor.saveState();
				this.editor.syncTransformHandlesForActiveLayer?.();
			}

			if (event.pointerType === 'mouse') {
				this.editor.ignoreNextClick = true;
				setTimeout(() => {
					this.editor.ignoreNextClick = false;
				}, 150);
			}
		}

		this.removeDocumentHandleListeners();
		this.editor.setDuplicateDragFeedback?.(false);
		this.editor.clearSmartGuides?.();
		this.activeHandleElement?.releasePointerCapture?.(event.pointerId);
		this.activeHandleType = null;
		this.activeHandleElement = null;
		this.activeHandlePointerId = null;
		this.dragStartState = null;
	}

	handleMoveDrag(event) {
		const canvasPos = this.editor.viewport.screenToCanvas(event.clientX, event.clientY);
		const deltaX = canvasPos.x - this.dragStartState.canvasX;
		const deltaY = canvasPos.y - this.dragStartState.canvasY;
		if (!this.dragStartState.didMove && Math.hypot(deltaX, deltaY) < 3) {
			return;
		}
		if (!this.dragStartState.didMove && this.dragStartState.altDuplicatePending) {
			const sourceTransforms = this.dragStartState.originalSelectionIds.map((id) => {
				const layer = this.editor.layerManager.getLayerById(id);
				return layer ? this.getLayerTransform(layer) : null;
			});
			const clones = this.editor.layerManager.cloneLayers(this.dragStartState.originalSelectionIds, {
				positionOffset: { x: 0, y: 0 },
				skipHistory: true,
				skipSelection: true
			});
			if (!clones) return;
			const cloneList = Array.isArray(clones) ? clones : [clones];
			this.editor.setDuplicateDragFeedback?.(true, cloneList.length);
			const bounds = this.getBounds();
			this.dragStartState.bounds = bounds;
			this.dragStartState.layerStates = cloneList.map((layer) => {
				const transform = this.getLayerTransform(layer);
				return { layer, transform, position: { ...transform.getTransform().position }, scale: { ...transform.getTransform().scale }, rotation: transform.getTransform().rotation || 0 };
			});
			this.dragStartState.cloneIds = cloneList.map((layer) => layer.id);
			this.dragStartState.layerStates.forEach(({ transform }, index) => this.editor.addDuplicateGhost?.(sourceTransforms[index], transform));
			this.dragStartState.altDuplicatePending = false;
		}

		this.dragStartState.didMove = true;
		this.dragStartState.selectionCandidateId = null;
		const axis = event.shiftKey
			? (this.dragStartState.lockedAxis || (Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y'))
			: null;

		this.dragStartState.lockedAxis = axis;

		const rawDelta = { x: axis === 'y' ? 0 : deltaX, y: axis === 'x' ? 0 : deltaY };
		const snappedDelta = this.editor.snapGroupDelta(this.dragStartState.bounds, rawDelta, this.dragStartState.layerStates.map(({ layer }) => layer.id), { ctrlKey: event.ctrlKey });
		const nextDeltaX = snappedDelta.x;
		const nextDeltaY = snappedDelta.y;

		this.dragStartState.layerStates.forEach(({ transform, position }) => {
			transform.updateTransform({
				position: {
					x: position.x + nextDeltaX,
					y: position.y + nextDeltaY
				}
			});
		});

		this.applyEntries(this.dragStartState.layerStates);
		this.editor.syncDuplicateGhosts?.();
	}

	handleCornerDrag(event) {
		const canvasPos = this.editor.viewport.screenToCanvas(event.clientX, event.clientY);
		const bounds = this.dragStartState.bounds;
		if (!bounds) return;

		const halfWidth = Math.max(1, bounds.width / 2);
		const halfHeight = Math.max(1, bounds.height / 2);
		const corner = this.activeHandleType.replace('corner-', '');
		const signX = corner.includes('l') ? -1 : 1;
		const signY = corner.includes('t') ? -1 : 1;
		const oppositeX = bounds.centerX - (signX * halfWidth);
		const oppositeY = bounds.centerY - (signY * halfHeight);
		const outset = CONFIG.ui.stickerHandles.outwardOffset;
		// The handle is drawn just outside the true corner. Convert its pointer
		// position back to the artwork corner, then measure from the fixed opposite
		// corner. Measuring from center made group scale run about 2× ahead.
		const draggedCornerX = canvasPos.x - (signX * outset);
		const draggedCornerY = canvasPos.y - (signY * outset);
		const scaleX = Math.abs(draggedCornerX - oppositeX) / Math.max(1, bounds.width);
		const scaleY = Math.abs(draggedCornerY - oppositeY) / Math.max(1, bounds.height);
		const scaleFactor = Math.max(0.1, Math.min(5, Math.max(scaleX, scaleY)));
		if (!this.dragStartState.didMove && Math.abs(scaleFactor - 1) < 0.01) {
			return;
		}

		this.dragStartState.didMove = true;
		const translateX = event.altKey ? 0 : signX * halfWidth * (scaleFactor - 1);
		const translateY = event.altKey ? 0 : signY * halfHeight * (scaleFactor - 1);
		this.applyLayerStateDelta(this.dragStartState.layerStates, bounds, { scaleFactor, translateX, translateY });

		this.applyEntries(this.dragStartState.layerStates);
	}

	cancelActiveDrag() {
		const start = this.dragStartState;
		if (!this.isDraggingHandle || !start) return false;
		if (start.cloneIds?.length) {
			this.editor.layerManager.deleteLayers(start.cloneIds, { skipHistory: true, silent: true });
			this.editor.layerManager.setSelection(start.originalSelectionIds, { activeLayerId: start.originalSelectionIds.at(-1) });
		} else {
			start.layerStates?.forEach(({ transform, position, scale, rotation }) => {
				transform.updateTransform({ position: { ...position }, scale: { ...scale }, rotation });
			});
			this.applyEntries(start.layerStates || []);
		}
		this.removeDocumentHandleListeners();
		this.editor.setDuplicateDragFeedback?.(false);
		this.activeHandleElement?.releasePointerCapture?.(this.activeHandlePointerId);
		this.activeHandleType = null;
		this.activeHandleElement = null;
		this.activeHandlePointerId = null;
		this.dragStartState = null;
		this.isDraggingHandle = false;
		this.editor.syncTransformHandlesForActiveLayer?.();
		return true;
	}

	handleRotationDrag(event) {
		const bounds = this.dragStartState?.bounds;
		if (!bounds) return;

		const currentAngle = this.getPointerAngle(bounds, event);
		let rotateDeg = currentAngle - (this.dragStartState.startAngle || 0);
		if (rotateDeg > 180) rotateDeg -= 360;
		if (rotateDeg < -180) rotateDeg += 360;
		if (event.shiftKey) {
			rotateDeg = Math.round(rotateDeg / 15) * 15;
		}
		if (!this.dragStartState.didMove && Math.abs(rotateDeg) < 0.5) {
			return;
		}

		this.dragStartState.didMove = true;
		this.applyLayerStateDelta(this.dragStartState.layerStates, bounds, { rotateDeg });
		this.applyEntries(this.dragStartState.layerStates);
	}
}
