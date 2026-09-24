// ============================================
// LAYER TRANSFORM CLASS
// Handles transform operations for moveable/transformable layer elements
// Can be used by StickerManager, TextLayer, or any future transformable layers
// Uses composition pattern - doesn't extend anything
// ============================================
class LayerTransform {
	constructor(layer, editor) {
		this.layer = layer;
		this.editor = editor;
		this.element = null;
		this.hoverOutline = null;

		// Transform handles state (desktop only)
		this.transformHandles = null;
		this.chrome = null;
		this.activeHandleType = null;
		this.activeHandleElement = null;
		this.activeHandlePointerId = null;
		this.dragStartState = null;
		this.isDraggingHandle = false;
		this.gestureInteractionActive = false;
		this.gestureInteractionChanged = false;
		this.gestureRawPosition = null;
		this.lastTouchMoveHandleTap = null;

		// Bind methods for event listeners
		this.handleHandlePointerMove = this.handleHandlePointerMove.bind(this);
		this.handleHandlePointerUp = this.handleHandlePointerUp.bind(this);
		// Selection-overlay syncers: redraw chrome when the view pans or zooms.
		this.syncHandlePositions = () => this.updateHandlePositions();
		this.syncHoverOutline = () => this.updateHoverOutlinePosition();

		// rAF flag for settings-panel sync during drags
		this._settingsSyncScheduled = false;
	}

	/**
	 * Sync the settings panel to this layer, throttled to one update per
	 * animation frame. Drag handlers fire per pointer event — running the
	 * full loadStickerSettings (a dozen+ DOM reads/writes) that often is
	 * wasted work the screen can't show.
	 */
	scheduleSettingsSync() {
		if (this._settingsSyncScheduled) return;
		this._settingsSyncScheduled = true;
		requestAnimationFrame(() => {
			this._settingsSyncScheduled = false;
			const prefix = LAYER_UI_CONFIG[this.layer.type]?.transformPrefix || null;
			if (prefix) {
				this.editor.loadTransformSettings?.(this.layer, prefix);
			}
		});
	}

	getLayerElementSelector() {
		return getLayerElementSelector(this.layer.id, { transformableOnly: true });
	}

	refreshElementReference() {
		const layerElement = document.querySelector(this.getLayerElementSelector());
		if (layerElement) {
			this.element = layerElement;
			return layerElement;
		}
		return null;
	}

	supportsEdgeResize() {
		return [LayerType.STICKER, LayerType.TEXT_GLITTER, LayerType.SHAPE].includes(this.layer.type);
	}

	// ===== CORE TRANSFORM APPLICATION =====

	/**
	 * Apply CSS transform to a DOM element based on layer transform data
	 * Works with any layer that has a transform object with: position, rotation, scale, opacity, flipX, flipY
	 * @param {HTMLElement} element - DOM element to transform
	 * @param {Object} dimensions - Object with width/height properties (natural size)
	 */
applyTransform(element, dimensions) {
	// CRITICAL: If element is null, try to get a fresh reference
	if (!element) {
		console.warn('⚠️ applyTransform called with null element - attempting to refresh reference');

		// Try to get the current element from the layer manager
		const layerElement = this.refreshElementReference();

		if (layerElement) {
			dbg('✅ Found fresh element reference');
			this.element = layerElement;
			element = layerElement;
		} else {
			console.warn('⚠️ Could not find element for layer:', this.layer.id);
			return; // Can't apply transform without an element
		}
	}

	if (!element.style) {
		console.warn('⚠️ Element has no style property:', element);
		return;
	}

	const transform = this.getTransform();
	const metrics = computeLayerTransform(transform, dimensions);

	// Build transform array - MUST include translate(-50%, -50%) for centering
	const transforms = [
		`translate(-50%, -50%)`,
		`translate(${metrics.centerX}px, ${metrics.centerY}px)`,
		`rotate(${metrics.rotationDeg}deg)`,
		`scaleX(${transform.flipX ? -1 : 1})`,
		`scaleY(${transform.flipY ? -1 : 1})`
	];

	// Determine pointer-events based on tool mode
	// Only allow interaction in SELECT tool
	const isSelectTool = this.editor.currentTool === ToolType.SELECT;
	const pointerEvents = (this.layer.visible && isSelectTool) ? 'auto' : 'none';

	// Get z-index
	const zIndex = this.editor.layerManager.getLayerZIndex(this.layer.id);

	// CRITICAL: Build style string manually to ensure nothing gets overwritten
	const styleString = [
		`position: absolute`,
		`width: ${metrics.displayWidth}px`,
		`height: ${metrics.displayHeight}px`,
		`transform: ${transforms.join(' ')}`,
		`opacity: ${this.layer.opacity / 100}`,
		`pointer-events: ${pointerEvents}`,
		`display: ${this.layer.visible ? 'block' : 'none'}`,
		`z-index: ${zIndex}`,
		`mix-blend-mode: ${GlitterBlendModes.forLayer(this.layer)}`,
		`touch-action: none`
	].join('; ') + ';';

	dbg('📐 Applying transform:', {
		position: transform.position,
		displayWidth: metrics.displayWidth,
		displayHeight: metrics.displayHeight,
		transformString: transforms.join(' ')
	});

	element.style.cssText = styleString;

	// Text previews render in local space and scale via a CSS transform on the
	// inner stack — keep it in sync (drags call applyTransform without renderLayer).
	if (this.layer.type === LayerType.TEXT_GLITTER) {
		this.editor.textGlitterManager?.syncElementScale?.(this.layer, element);
	} else if (this.layer.type === LayerType.SHAPE) {
		this.editor.shapeGlitterManager?.syncElementScale?.(this.layer, element);
	}
	this.updateHoverOutlinePosition();
}

	// ===== TRANSFORM UPDATES =====

	/**
	 * Update transform properties and re-apply to element
	 * @param {Object} updates - Transform properties to update.
	 */
updateTransform(updates) {
	const transform = this.getTransform();

	// Apply updates
	if (updates.position) {
		const newX = updates.position.x ?? transform.position.x;
		const newY = updates.position.y ?? transform.position.y;

		transform.position.x = CONFIG.tools.stickers.transform.roundValues ? Math.round(newX) : newX;
		transform.position.y = CONFIG.tools.stickers.transform.roundValues ? Math.round(newY) : newY;
	}

	if (updates.scale) {
		transform.scale.x = clampLayerScale(updates.scale.x ?? transform.scale.x);
		transform.scale.y = clampLayerScale(updates.scale.y ?? transform.scale.y);
	}

	if (updates.proportionalScale !== undefined) {
		transform.proportionalScale = updates.proportionalScale;
	}

	if (updates.rotation !== undefined) {
		// Normalize rotation to 0-360 range
		let newRotation = CONFIG.tools.stickers.transform.roundValues ? Math.round(updates.rotation) : updates.rotation;
		newRotation = newRotation % 360;
		if (newRotation < 0) newRotation += 360;
		transform.rotation = newRotation;
	}

	if (updates.anchor) {
		transform.anchor = { x: updates.anchor.x, y: updates.anchor.y };
	}

	if (updates.opacity !== undefined) {
		this.layer.opacity = updates.opacity;
	}

	if (updates.flipX !== undefined) {
		transform.flipX = updates.flipX;
	}

	if (updates.flipY !== undefined) {
		transform.flipY = updates.flipY;
	}

	// REMOVED: Handle update now happens in StickerManager after applyTransform
}

	// ===== HELPER METHODS =====

	/**
	 * Get the transform object from layer data
	 * Child classes can override this if transform is stored differently
	 */
	getTransform() {
		const transform = getLayerTransform(this.layer);
		if (!transform) {
			throw new Error('Layer does not have a transform object');
		}
		return transform;
	}

	/**
	 * Get the dimensions object from layer data
	 * Child classes can override this if dimensions are stored differently
	 */
	getDimensions() {
		// Default: assumes layer has stickerData with width/height
		if (this.layer.stickerData) {
			return {
				width: this.layer.stickerData.width,
				height: this.layer.stickerData.height
			};
		}
		if (this.layer.textData) {
			return {
				width: this.layer.textData.width,
				height: this.layer.textData.height
			};
		}
		if (this.layer.shapeData) {
			return {
				width: this.layer.shapeData.renderWidth || this.layer.shapeData.width,
				height: this.layer.shapeData.renderHeight || this.layer.shapeData.height
			};
		}
		throw new Error('Layer does not have dimensions');
	}

	// The layer's frame (see getLayerFrame): handles, hit-testing, alignment,
	// snapping and group bounds. Falls back to the element box.
	getFrame() {
		const frame = getLayerFrame(this.editor, this.layer);
		if (frame) return frame;
		const dimensions = this.getDimensions();
		return { width: dimensions.width, height: dimensions.height, offsetX: 0, offsetY: 0 };
	}

	// Every painted pixel, shadow included: export culling and crop-to-artwork.
	getVisualBounds() {
		return getLayerVisualBounds(this.editor, this.layer) || this.getFrame();
	}

	// Where the layer's element is actually drawn: `position` after the
	// pixel-grid snap in computeLayerTransform. Frames and handles measure from
	// this so they sit exactly on the rendered artwork.
	getRenderedPosition(transform = this.getTransform()) {
		return withRenderedPosition(transform, this.getDimensions()).position;
	}

	getFrameMetrics(transform = this.getTransform(), frame = this.getFrame()) {
		const scaleX = (transform.scale.x || 100) / 100;
		const scaleY = (transform.scale.y || 100) / 100;
		const displayWidth = frame.width * scaleX;
		const displayHeight = frame.height * scaleY;
		const rotationRad = (transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);
		const frameOffsetX = frame.offsetX * scaleX;
		const frameOffsetY = frame.offsetY * scaleY;
		const origin = this.getRenderedPosition(transform);
		const centerX = origin.x + frameOffsetX * cos - frameOffsetY * sin;
		const centerY = origin.y + frameOffsetX * sin + frameOffsetY * cos;
		const hw = displayWidth / 2;
		const hh = displayHeight / 2;
		const corners = [
			{ x: -hw, y: -hh },
			{ x: hw, y: -hh },
			{ x: hw, y: hh },
			{ x: -hw, y: hh }
		].map((point) => ({
			x: centerX + (point.x * cos - point.y * sin),
			y: centerY + (point.x * sin + point.y * cos)
		}));

		return {
			scaleX,
			scaleY,
			rotationRad,
			cos,
			sin,
			centerX,
			centerY,
			displayWidth,
			displayHeight,
			corners,
			minX: Math.min(...corners.map((point) => point.x)),
			maxX: Math.max(...corners.map((point) => point.x)),
			minY: Math.min(...corners.map((point) => point.y)),
			maxY: Math.max(...corners.map((point) => point.y))
		};
	}

	// Hit test against the frame in canvas units. `tolerance` (canvas units)
	// widens every side so thin layers stay clickable.
	containsPoint(point, tolerance = 0) {
		const metrics = this.getFrameMetrics();
		const dx = point.x - metrics.centerX;
		const dy = point.y - metrics.centerY;
		// Undo the rotation to test in the frame's own axes.
		const localX = dx * metrics.cos + dy * metrics.sin;
		const localY = -dx * metrics.sin + dy * metrics.cos;
		return Math.abs(localX) <= Math.abs(metrics.displayWidth) / 2 + tolerance
			&& Math.abs(localY) <= Math.abs(metrics.displayHeight) / 2 + tolerance;
	}

	showHoverOutline() {
		if (
			this.layer.type !== LayerType.STICKER
			|| this.editor.currentTool !== ToolType.SELECT
			|| this.editor.layerManager.isLayerSelected(this.layer.id)
		) return;

		this.removeHoverOutline();
		const outline = document.createElement('div');
		outline.className = 'transform-hover-outline';
		outline.dataset.layerId = this.layer.id;
		this.editor.viewport.selectionOverlay.append(outline);
		this.hoverOutline = outline;
		this.editor.viewport.selectionOverlay.addSyncer(this.syncHoverOutline);
		this.updateHoverOutlinePosition();
	}

	updateHoverOutlinePosition() {
		if (!this.hoverOutline) return;
		const transform = this.getTransform();
		const metrics = this.getFrameMetrics(transform);
		this.editor.viewport.selectionOverlay.placeFrame(this.hoverOutline, {
			centerX: metrics.centerX,
			centerY: metrics.centerY,
			width: metrics.displayWidth,
			height: metrics.displayHeight,
			rotation: transform.rotation
		});
	}

	removeHoverOutline() {
		this.editor.viewport.selectionOverlay.removeSyncer(this.syncHoverOutline);
		this.hoverOutline?.remove();
		this.hoverOutline = null;
	}

	getCanvasPointFromClient(clientX, clientY) {
		return this.editor.viewport.screenToCanvas(clientX, clientY);
	}

	delegateSelectionFromCanvasPoint(canvasPoint, options = {}) {
		const x = Math.round(canvasPoint.x);
		const y = Math.round(canvasPoint.y);
		if (!PREFERENCES.get('autoSelect') && !options.toggleSelection && !options.cycleDeep) {
			return false;
		}

		if (options.toggleSelection || options.cycleDeep) {
			this.editor.layerManager.handleLayerPick(x, y, {
				toggleSelection: Boolean(options.toggleSelection),
				cycleDeep: Boolean(options.cycleDeep)
			});
			return true;
		}

		const topLayer = this.editor.layerManager.getTopVisibleLayerAtPoint(x, y, {
			includeBase: false,
			excludeLocked: true
		});
		if (topLayer && topLayer.id !== this.layer.id) {
			this.editor.layerManager.selectLayerFromCanvas(topLayer.id);
			return true;
		}

		return false;
	}

	// ===== CENTERING METHODS =====

	centerHorizontal() {
		this.alignToCanvas('centerX');
	}

	centerVertical() {
		this.alignToCanvas('centerY');
	}

	alignToCanvas(mode) {
		if (!this.editor.originalCanvas) return;

		const transform = this.getTransform();
		const metrics = this.getFrameMetrics(transform);
		let deltaX = 0;
		let deltaY = 0;

		switch (mode) {
			case 'left':
				deltaX = -metrics.minX;
				break;
			case 'centerX':
				deltaX = (this.editor.originalCanvas.width / 2) - ((metrics.minX + metrics.maxX) / 2);
				break;
			case 'right':
				deltaX = this.editor.originalCanvas.width - metrics.maxX;
				break;
			case 'top':
				deltaY = -metrics.minY;
				break;
			case 'centerY':
				deltaY = (this.editor.originalCanvas.height / 2) - ((metrics.minY + metrics.maxY) / 2);
				break;
			case 'bottom':
				deltaY = this.editor.originalCanvas.height - metrics.maxY;
				break;
			default:
				return;
		}

		this.updateTransform({
			position: {
				x: transform.position.x + deltaX,
				y: transform.position.y + deltaY
			}
		});

		if (this.element) {
			this.applyTransform(this.element, this.getDimensions());
		}
		if (this.transformHandles) {
			this.updateHandlePositions();
		}

		this.editor.saveState('Transform layer');
	}

	resetTransform(options = {}) {
		const transform = this.getTransform();
		const next = createDefaultTransform({
			position: {
				x: transform.position.x,
				y: transform.position.y
			}
		});

		transform.rotation = next.rotation;
		if (!options.preserveScale) {
			transform.scale.x = next.scale.x;
			transform.scale.y = next.scale.y;
			transform.proportionalScale = next.proportionalScale;
		}
		transform.flipX = next.flipX;
		transform.flipY = next.flipY;
		transform.anchor = { ...next.anchor };

		if (this.element) {
			this.applyTransform(this.element, this.getDimensions());
		}
		if (this.transformHandles) {
			this.updateHandlePositions();
		}

		this.editor.saveState('Transform layer');
	}

	// ===== MOUSE DRAG HANDLING =====

	/**
	 * Setup mouse drag listeners for an element
	 * @param {HTMLElement} element - Element to make draggable
	 */
setupMouseDrag(element) {
	let isDragging = false;
	let didMove = false;
	let startCanvasX = 0;
	let startCanvasY = 0;
	let startPosition = null;
	let lockedAxis = null;
	let altPending = false;
	let dragTransform = this;
	let dragSourceTransform = this;
	let altCloneId = null;
	if (this.layer.type === LayerType.STICKER) {
		element.addEventListener('mouseenter', () => this.showHoverOutline());
		element.addEventListener('mouseleave', () => this.removeHoverOutline());
	}

const swallowFollowupClick = () => {
	this.editor.ignoreNextClick = true;
	setTimeout(() => {
		this.editor.ignoreNextClick = false;
	}, 150);
};

	const handleMouseDown = (e) => {
	if (e.button !== 0) return; // Left click only
	this.removeHoverOutline();
	const pinnedTransform = this.editor.currentTool === ToolType.SELECT
		&& !PREFERENCES.get('autoSelect')
		&& !this.editor.layerManager.hasMultiSelection()
		? (() => {
			const activeLayer = this.editor.layerManager.getActiveLayer();
			if (!activeLayer || activeLayer.locked || !isTransformableLayerType(activeLayer.type)) return null;
			const context = this.editor.getMovableLayerContext(activeLayer);
			return context?.manager?.layerTransforms?.get(activeLayer.id) || null;
		})()
		: null;
	if (this.layer.locked && !pinnedTransform) {
		if (this.editor.currentTool === ToolType.SELECT) {
			e.preventDefault();
			e.stopPropagation();
			this.editor.layerManager.selectLayerFromCanvas(this.layer.id);
		}
		return;
	}

	// Don't start drag if clicking on transform handles
	if (e.target.closest('.transform-handles')) return;

	// Check if we're in the right tool mode
	if (this.editor.currentTool === ToolType.HAND ||
		this.editor.currentTool === ToolType.ZOOM ||
		this.editor.currentTool === ToolType.COLOR_PICKER) {
		return;
	}

	if (this.editor.layerManager.hasMultiSelection() && this.editor.layerManager.isLayerSelected(this.layer.id)) {
		const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);

		if (e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			swallowFollowupClick();
			this.delegateSelectionFromCanvasPoint(canvasPos, {
				toggleSelection: e.shiftKey,
				cycleDeep: e.altKey
			});
			return;
		}

		e.preventDefault();
		e.stopPropagation();
		this.editor.layerManager.focusLayerInSelection(this.layer.id);
		if (!this.editor.layerManager.canTransformMultiSelection()) {
			this.editor.showError('This selection cannot move because it includes a locked, Base Image, or Fill layer');
		}
		return;
	}

	const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
	if (!pinnedTransform && !e.altKey && this.delegateSelectionFromCanvasPoint(canvasPos, {
		toggleSelection: e.shiftKey,
		cycleDeep: e.altKey
	})) {
		if (e.shiftKey || e.altKey) {
			e.preventDefault();
			e.stopPropagation();
			swallowFollowupClick();
		}
		return;
	}

	e.preventDefault();
	e.stopPropagation();

	// Select this layer if not already selected
	if (!pinnedTransform && this.editor.layerManager.activeLayerId !== this.layer.id) {
		dbg('🎯 Selecting layer and starting drag immediately');
		this.editor.layerManager.selectLayerFromCanvas(this.layer.id);
	}

	// ALWAYS start dragging (whether we just selected or it was already selected)
	isDragging = true;
	didMove = false;
	altPending = e.altKey;
	dragTransform = pinnedTransform || this;
	dragSourceTransform = dragTransform;

	startCanvasX = canvasPos.x;
	startCanvasY = canvasPos.y;
	startPosition = { ...dragTransform.getTransform().position };
	lockedAxis = null;

	    document.addEventListener('mousemove', handleMouseMove);
	    document.addEventListener('mouseup', handleMouseUp);
		this.activeMouseDragCancel = cancelMouseDrag;
	};

const handleMouseMove = (e) => {
	if (!isDragging) return;

	e.preventDefault();

	// Convert current mouse position to canvas coordinates
	const currentCanvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);

	// Calculate delta from drag origin
	const deltaX = currentCanvasPos.x - startCanvasX;
	const deltaY = currentCanvasPos.y - startCanvasY;

	if (!didMove && Math.hypot(deltaX, deltaY) < 3) {
		return;
	}
	if (!didMove && altPending) {
		this.editor.groupTransformManager?.ensureHistoryBaseline?.();
		const clone = this.editor.layerManager.cloneLayer(dragTransform.layer.id, { positionOffset: { x: 0, y: 0 }, skipHistory: true });
		const ctx = this.editor.getMovableLayerContext(clone);
		dragTransform = ctx?.manager?.layerTransforms?.get(clone?.id) || this;
		altCloneId = clone?.id || null;
		this.editor.setDuplicateDragFeedback?.(true, 1);
		this.editor.addDuplicateGhost?.(dragSourceTransform, dragTransform);
		startPosition = { ...dragTransform.getTransform().position };
		altPending = false;
	}

	didMove = true;

	let constrainedDeltaX = deltaX;
	let constrainedDeltaY = deltaY;

	if (e.shiftKey) {
		lockedAxis = lockedAxis || (Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y');
		if (lockedAxis === 'x') {
			constrainedDeltaY = 0;
		} else {
			constrainedDeltaX = 0;
		}
	} else {
		lockedAxis = null;
	}

	// Apply delta to current position
	const activeTransform = dragTransform;
	const snappedPosition = this.editor.snapTransformPosition(activeTransform, {
		x: startPosition.x + constrainedDeltaX,
		y: startPosition.y + constrainedDeltaY
	}, { ctrlKey: e.ctrlKey });
	activeTransform.updateTransform({
		position: snappedPosition
	});

	// CRITICAL FIX: Ensure we have a valid element reference
	// If this.element is null (e.g., after selection re-render), get fresh reference
	if (!activeTransform.element) {
		const layerElement = activeTransform.refreshElementReference();
		if (layerElement) {
			dbg('✅ Refreshed element reference in mousemove');
			activeTransform.element = layerElement;
		}
	}

	// Re-apply transform to the CURRENT element
	const dimensions = activeTransform.getDimensions();
	activeTransform.applyTransform(activeTransform.element, dimensions);
	this.editor.syncDuplicateGhost?.(activeTransform);

	// CRITICAL FIX: Ensure handles exist before trying to update them
	// If they don't exist yet (first drag after selection), create them
	if (!activeTransform.transformHandles && this.editor.currentTool === ToolType.SELECT && CONFIG.ui.stickerHandles.enabled) {
		dbg('✅ Creating handles on first mousemove');
		activeTransform.createTransformHandles();
	}

	// Update handle positions during drag
	if (activeTransform.transformHandles) {
		activeTransform.updateHandlePositions();
	}

	// Update settings UI if available
	if (activeTransform.layer.type === LayerType.STICKER || activeTransform.layer.type === LayerType.TEXT_GLITTER || activeTransform.layer.type === LayerType.SHAPE) {
		activeTransform.scheduleSettingsSync();
	}
};

	const handleMouseUp = (e) => {
		if (!isDragging) return;

		isDragging = false;
		lockedAxis = null;
		startPosition = null;
		if (didMove) {
			swallowFollowupClick();
			this.editor.saveState('Transform layer');
		}
		if (!didMove && altPending) {
			const point = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
			this.delegateSelectionFromCanvasPoint(point, { cycleDeep: true });
			swallowFollowupClick();
		}
		altPending = false;
		altCloneId = null;
	    didMove = false;
		this.activeMouseDragCancel = null;
		this.editor.setDuplicateDragFeedback?.(false);
		this.editor.clearSmartGuides?.();
	    document.removeEventListener('mousemove', handleMouseMove);
	    document.removeEventListener('mouseup', handleMouseUp);
	};

	const cancelMouseDrag = () => {
		if (!isDragging) return false;
		if (altCloneId) {
			this.editor.layerManager.deleteLayers([altCloneId], { skipHistory: true, silent: true });
			this.editor.layerManager.setActiveLayer(dragSourceTransform.layer.id);
		} else if (startPosition) {
			dragTransform.updateTransform({ position: { ...startPosition } });
			dragTransform.applyTransform(dragTransform.element, dragTransform.getDimensions());
			dragTransform.updateHandlePositions();
		}
		isDragging = false;
		didMove = false;
		altPending = false;
		altCloneId = null;
		this.activeMouseDragCancel = null;
		this.editor.setDuplicateDragFeedback?.(false);
		this.editor.clearSmartGuides?.();
		document.removeEventListener('mousemove', handleMouseMove);
		document.removeEventListener('mouseup', handleMouseUp);
		return true;
	};

	element.addEventListener('mousedown', handleMouseDown);
}
	beginGestureInteraction() {
		if (this.gestureInteractionActive) {
			return;
		}

		this.gestureInteractionActive = true;
		this.gestureInteractionChanged = false;
		this.gestureRawPosition = { ...this.getTransform().position };
	}

	dragByScreenDelta(deltaX, deltaY) {
		this.beginGestureInteraction();

		const canvasDeltaX = deltaX / this.editor.viewport.currentZoom;
		const canvasDeltaY = deltaY / this.editor.viewport.currentZoom;
		const rawPosition = this.gestureRawPosition || { ...this.getTransform().position };
		rawPosition.x += canvasDeltaX;
		rawPosition.y += canvasDeltaY;
		this.gestureRawPosition = rawPosition;
		const snappedPosition = this.editor.snapTransformPosition(this, rawPosition);

		this.updateTransform({
			position: snappedPosition
		});

		this.gestureInteractionChanged = true;
		this.syncGestureTransform();
	}

	applyGestureDelta(gestureDelta) {
		this.beginGestureInteraction();

		const transform = this.getTransform();
		const previousCentroidCanvas = this.editor.viewport.screenToCanvas(
			gestureDelta.previousCentroidX ?? gestureDelta.centroidX,
			gestureDelta.previousCentroidY ?? gestureDelta.centroidY
		);
		const centroidCanvas = this.editor.viewport.screenToCanvas(gestureDelta.centroidX, gestureDelta.centroidY);
		const currentScaleX = transform.scale.x || 100;
		const currentScaleY = transform.scale.y || 100;
		const nextScaleX = clampLayerScale(currentScaleX * gestureDelta.scale);
		const nextScaleY = transform.proportionalScale
			? nextScaleX
			: clampLayerScale(currentScaleY * gestureDelta.scale);
		const scaleFactor = currentScaleX !== 0 ? nextScaleX / currentScaleX : 1;
		const rotationDeltaRad = (gestureDelta.rotateDeg * Math.PI) / 180;
		const relativeX = transform.position.x - previousCentroidCanvas.x;
		const relativeY = transform.position.y - previousCentroidCanvas.y;
		const scaledX = relativeX * scaleFactor;
		const scaledY = relativeY * scaleFactor;
		const rotatedX = (scaledX * Math.cos(rotationDeltaRad)) - (scaledY * Math.sin(rotationDeltaRad));
		const rotatedY = (scaledX * Math.sin(rotationDeltaRad)) + (scaledY * Math.cos(rotationDeltaRad));

		this.updateTransform({
			position: {
				x: centroidCanvas.x + rotatedX,
				y: centroidCanvas.y + rotatedY
			},
			scale: {
				x: nextScaleX,
				y: nextScaleY
			},
			rotation: transform.rotation + gestureDelta.rotateDeg
		});
		this.gestureRawPosition = { ...this.getTransform().position };

		this.gestureInteractionChanged = true;
		this.syncGestureTransform();
	}

	syncGestureTransform() {
		const dimensions = this.getDimensions();
		this.applyTransform(this.element, dimensions);

		if (this.transformHandles) {
			this.updateHandlePositions();
		}

		if (this.layer.type === LayerType.STICKER || this.layer.type === LayerType.TEXT_GLITTER || this.layer.type === LayerType.SHAPE) {
			this.scheduleSettingsSync();
		}
	}

	endGestureInteraction() {
		if (!this.gestureInteractionActive) {
			return;
		}

		if (this.gestureInteractionChanged) {
			this.editor.saveState('Transform layer');
		}

		this.gestureInteractionActive = false;
		this.gestureInteractionChanged = false;
		this.gestureRawPosition = null;
		this.editor.clearSmartGuides?.();
	}

	// ===== TRANSFORM HANDLES (DESKTOP ONLY) =====

	/**
	 * Create visual transform handles for desktop interaction
	 * Only works when CONFIG.ui.stickerHandles.enabled is true
	 */
createTransformHandles() {
	this.removeHoverOutline();
	// Check if handles are enabled
	if (!CONFIG.ui.stickerHandles.enabled) return;

	// Only create handles in SELECT tool mode
	if (this.editor.currentTool !== ToolType.SELECT) return;

	// CRITICAL: Ensure we have a valid element reference
	// The element might be null or stale after layer selection/re-render
	if (!this.element) {
		const layerElement = this.refreshElementReference();
		if (layerElement) {
			dbg('✅ Refreshed element reference in createTransformHandles');
			this.element = layerElement;
		} else {
			console.warn('⚠️ Cannot create transform handles - element not found');
			return;
		}
	}

	// CRITICAL: Apply transform to element before creating handles
	// This ensures the element is in the correct position before we position handles
	const dimensions = this.getDimensions();
	this.applyTransform(this.element, dimensions);

	// Remove existing handles first
	this.removeTransformHandles();

	// Keep text wrappers interactive while selected so touch gestures can
	// still begin on the layer itself; stickers can rely on the child <img>.
	if (this.element && this.layer.type === LayerType.STICKER) {
		this.element.classList.add('has-transform-handles');
	}

	const handles = ['corner-tl', 'corner-tr', 'corner-br', 'corner-bl'];
	if (this.supportsEdgeResize()) handles.push('edge-top', 'edge-right', 'edge-bottom', 'edge-left');
	handles.push('rotate-tl', 'rotate-tr', 'rotate-br', 'rotate-bl', 'rotation', 'anchor');
	if (LAYER_UI_CONFIG[this.layer.type]?.supportsCornerRadius?.(this.layer)) {
		handles.push('radius-tl', 'radius-tr', 'radius-br', 'radius-bl');
	}
	// Selection chrome lives in the screen-space overlay, outside the zoom.
	this.chrome = new SelectionChrome(this.editor.viewport.selectionOverlay, {
		layerId: this.layer.id,
		handles,
		titles: {
			move: 'Move. Shift constrains movement; Alt-drag duplicates; Ctrl bypasses snapping.',
			corner: 'Resize. Alt resizes from the center.',
			edge: 'Resize one side. Alt resizes from the center.',
			rotation: 'Rotate. Hold Shift to snap to 15 degree increments.'
		}
	});
	this.transformHandles = this.chrome.element;
	this.editor.viewport.selectionOverlay.addSyncer(this.syncHandlePositions);

	// Position handles - this will now use the correct transform that was just applied
	this.updateHandlePositions();

	// Attach event listeners
	this.attachHandleListeners();
}

	// The chrome's description (see SelectionChrome): the frame, and for area
	// text the box its edge handles resize.
	getChromeModel() {
		const transform = this.getTransform();
		const describe = (metrics) => ({
			centerX: metrics.centerX,
			centerY: metrics.centerY,
			width: metrics.displayWidth,
			height: metrics.displayHeight,
			rotation: transform.rotation
		});
		const boxFrame = this.editor.textGlitterManager?.getFixedBoxFrame?.(this.layer);
		const metrics = this.getFrameMetrics(transform);
		const active = this.activeHandleType || '';
		let badge = null;
		if (active !== 'move') {
			if (active === 'rotation' || active.startsWith('rotate-')) {
				let angle = normalizeRotationDeg(transform.rotation);
				if (angle > 180) angle -= 360;
				badge = { mode: 'angle', text: `${this.dragStartState?.snapDisabled ? angle.toFixed(1) : Math.round(angle)}°` };
			} else if (active.startsWith('radius-')) {
				badge = { mode: 'radius', text: `Radius ${Math.round(this.layer.shapeData.cornerRadiusPx)}` };
			} else {
				const prefix = LAYER_UI_CONFIG[this.layer.type]?.transformPrefix;
				const size = this.editor.getTransformSizeState?.(this.layer, prefix);
				if (size?.visible) badge = { mode: 'size', text: `${size.width} × ${size.height}` };
			}
		}
		const anchor = transform.anchor;
		const customAnchor = Math.abs(anchor.x - 0.5) > 1e-6 || Math.abs(anchor.y - 0.5) > 1e-6;
		const coarse = window.matchMedia?.('(pointer: coarse)').matches;
		// A moved anchor always shows. A centered one shows faintly on fine
		// pointers so it can be found and dragged, except while moving and on
		// layers too small on screen, where the center is where you grab to move.
		// On touch a finger on the middle means "move", so it stays hidden there.
		const pivoting = active === 'rotation' || active.startsWith('rotate-') || (this.isDraggingHandle && this.dragStartState?.altKey);
		const zoom = this.editor.viewport.currentZoom || 1;
		const shortSide = Math.min(Math.abs(metrics.displayWidth), Math.abs(metrics.displayHeight)) * zoom;
		const showCentered = !coarse && active !== 'move' && shortSide >= CONFIG.ui.stickerHandles.anchorMinSpan;
		const showAnchor = customAnchor || active === 'anchor' || (!coarse && pivoting) || showCentered;
		const model = {
			frame: describe(this.getFrameMetrics(transform)),
			resizeFrame: boxFrame ? describe(this.getFrameMetrics(transform, boxFrame)) : null,
			anchorPoint: showAnchor ? getLayerAnchorPoint(this.editor, this.layer) : null,
			anchorSubtle: !customAnchor && !pivoting && active !== 'anchor',
			badge
		};
		if (LAYER_UI_CONFIG[this.layer.type]?.supportsCornerRadius?.(this.layer) && !this.isDraggingHandle || active.startsWith('radius-')) {
			const zoom = this.editor.viewport.currentZoom || 1;
			const minSpan = window.matchMedia?.('(pointer: coarse)').matches
				? CONFIG.ui.stickerHandles.radiusHandleCoarseMinSpan : CONFIG.ui.stickerHandles.radiusHandleMinSpan;
			if (Math.min(metrics.displayWidth, metrics.displayHeight) * zoom >= minSpan) {
				const inset = Math.max(this.layer.shapeData.cornerRadiusPx || 0, CONFIG.ui.stickerHandles.radiusHandleMinInset / zoom);
				const hw = metrics.displayWidth / 2;
				const hh = metrics.displayHeight / 2;
				const point = (sx, sy) => ({
					x: metrics.centerX + (sx * (hw - inset) * metrics.cos - sy * (hh - inset) * metrics.sin),
					y: metrics.centerY + (sx * (hw - inset) * metrics.sin + sy * (hh - inset) * metrics.cos)
				});
				model.radiusPoints = {
					'radius-tl': point(-1, -1), 'radius-tr': point(1, -1),
					'radius-br': point(1, 1), 'radius-bl': point(-1, 1)
				};
			}
		}
		return model;
	}

	updateHandlePositions() {
		if (!this.chrome) return;
		this.chrome.render(this.getChromeModel());
	}

	/**
	 * Remove transform handles
	 */
removeTransformHandles() {
	this.editor.viewport.selectionOverlay.removeSyncer(this.syncHandlePositions);
	document.removeEventListener('pointermove', this.handleHandlePointerMove);
	document.removeEventListener('pointerup', this.handleHandlePointerUp);
	document.removeEventListener('pointercancel', this.handleHandlePointerUp);
	// Remove handles stored in this instance
	if (this.transformHandles) {
		// Re-enable pointer events on element
		if (this.element) {
			this.element.classList.remove('has-transform-handles');
		}

		this.chrome?.remove();
	}
	this.chrome = null;

	this.activeHandleType = null;
	this.activeHandleElement = null;
	this.activeHandlePointerId = null;
	this.dragStartState = null;
	this.isDraggingHandle = false;

	// CRITICAL FIX: Also remove any orphaned handles for this layer in the DOM
	// This prevents duplicate handles from accumulating
	const orphanedHandles = document.querySelectorAll(`.transform-handles[data-layer-id="${this.layer.id}"]`);
	orphanedHandles.forEach(handle => {
		if (handle.parentNode) {
			handle.parentNode.removeChild(handle);
		}
	});

	this.transformHandles = null;
	this.activeHandleType = null;
	this.dragStartState = null;
}

	/**
	 * Attach pointer event listeners to transform handles
	 */
	attachHandleListeners() {
		if (!this.transformHandles) return;

		this.chrome.onPointerDown((handleType, e, handle) => this.beginHandleDrag(handleType, e, handle));
		this.transformHandles.addEventListener('dblclick', (event) => {
			if (!event.target.closest('[data-handle-type="anchor"]')) return;
			this.getTransform().anchor = { ...CONFIG.tools.stickers.defaults.transform.anchor };
			this.updateHandlePositions();
			this.scheduleSettingsSync();
			this.editor.saveState('Change anchor');
		});
	}

	beginHandleDrag(handleType, e, handle) {
		if (this.layer.locked) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;

		const canvasPoint = this.getCanvasPointFromClient(e.clientX, e.clientY);
		if (handleType.startsWith('rotate-')) handleType = 'rotation';
		if (handleType === 'move' && e.pointerType === 'mouse' && e.altKey) {
			this.startAltDuplicateHandleDrag(e);
			return;
		}
		if (handleType === 'move' && !e.altKey && this.delegateSelectionFromCanvasPoint(canvasPoint, {
			toggleSelection: e.shiftKey,
			cycleDeep: e.altKey
		})) {
			return;
		}

		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();

		this.activeHandleType = handleType;
		this.activeHandleElement = handle;
		this.activeHandlePointerId = e.pointerId;
		this.isDraggingHandle = true;
		handle.setPointerCapture?.(e.pointerId);
		document.addEventListener('pointermove', this.handleHandlePointerMove);
		document.addEventListener('pointerup', this.handleHandlePointerUp);
		document.addEventListener('pointercancel', this.handleHandlePointerUp);

		const transform = this.getTransform();
		const dimensions = this.getDimensions();
		const frame = this.getFrame();
		const textBoxFrame = this.editor.textGlitterManager?.getFixedBoxFrame?.(this.layer) ?? null;
		const frameMetrics = this.getFrameMetrics(transform, frame);
		// Edge handles of area text sit on its box, not the frame.
		const handleMetrics = handleType.startsWith('edge-') && textBoxFrame
			? this.getFrameMetrics(transform, textBoxFrame)
			: frameMetrics;

		this.dragStartState = {
			mouseX: e.clientX,
			mouseY: e.clientY,
			canvasX: canvasPoint.x,
			canvasY: canvasPoint.y,
			transform: {
				position: { ...transform.position },
				scale: { ...transform.scale },
				rotation: transform.rotation,
				anchor: { ...transform.anchor }
			},
			cornerRadiusPx: this.layer.shapeData?.cornerRadiusPx,
			width: dimensions.width,
			height: dimensions.height,
			boxWidth: this.layer.textData?.boxWidth ?? null,
			boxHeight: this.layer.textData?.boxHeight ?? null,
			handleFrame: frame,
			textBoxFrame,
			// Where the grabbed handle's true point (frame corner or edge
			// midpoint) was, so scale drags follow the pointer's movement.
			handlePoint: getFrameHandlePoint(handleMetrics, handleType),
			pivot: getLayerAnchorPoint(this.editor, this.layer),
			altKey: e.altKey,
			didMove: false,
			altDuplicatePending: handleType === 'move' && e.altKey,
			targetTransform: this
		};
	}

	startAltDuplicateHandleDrag(event) {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const start = this.editor.viewport.screenToCanvas(event.clientX, event.clientY);
		const sourcePosition = { ...this.getTransform().position };
		let clone = null;
		let targetTransform = null;
		let didMove = false;
		let lockedAxis = null;

		const cleanup = () => {
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onUp);
			document.removeEventListener('pointercancel', onUp);
			this.editor.setDuplicateDragFeedback?.(false);
			this.activeDocumentDragCancel = null;
		};
		this.activeDocumentDragCancel = () => {
			if (clone) {
				this.editor.layerManager.deleteLayers([clone.id], { skipHistory: true, silent: true });
				this.editor.layerManager.setActiveLayer(this.layer.id);
			}
			cleanup();
			return true;
		};
		const onMove = (moveEvent) => {
			if (moveEvent.pointerId !== event.pointerId) return;
			moveEvent.preventDefault();
			const point = this.editor.viewport.screenToCanvas(moveEvent.clientX, moveEvent.clientY);
			const deltaX = point.x - start.x;
			const deltaY = point.y - start.y;
			if (!didMove && !hasPassedDragThreshold({ x: event.clientX, y: event.clientY }, moveEvent)) return;
			if (!clone) {
				this.editor.groupTransformManager?.ensureHistoryBaseline?.();
				clone = this.editor.layerManager.cloneLayer(this.layer.id, { positionOffset: { x: 0, y: 0 }, skipHistory: true, skipSelection: true });
				if (!clone) return;
				this.editor.setDuplicateDragFeedback?.(true, 1);
				const ctx = this.editor.getMovableLayerContext(clone);
				targetTransform = ctx?.manager?.layerTransforms?.get(clone.id) || null;
				this.editor.addDuplicateGhost?.(this, targetTransform);
			}
			didMove = true;
			lockedAxis = moveEvent.shiftKey ? (lockedAxis || (Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y')) : null;
			const nextX = sourcePosition.x + (lockedAxis === 'y' ? 0 : deltaX);
			const nextY = sourcePosition.y + (lockedAxis === 'x' ? 0 : deltaY);
			if (targetTransform) {
				targetTransform.updateTransform({ position: { x: nextX, y: nextY } });
				targetTransform.applyTransform(targetTransform.element, targetTransform.getDimensions());
				this.editor.syncDuplicateGhost?.(targetTransform);
			} else {
				getLayerTransform(clone).position = { x: nextX, y: nextY };
			}
		};
		const onUp = (upEvent) => {
			if (upEvent.pointerId !== event.pointerId) return;
			cleanup();
			if (didMove && clone) {
				this.editor.layerManager.setActiveLayer(clone.id);
				this.editor.saveState('Transform layer');
			} else {
				const point = this.getCanvasPointFromClient(upEvent.clientX, upEvent.clientY);
				this.setAnchorFromCanvasPoint(point, { ctrlKey: upEvent.ctrlKey || upEvent.metaKey, shiftKey: upEvent.shiftKey });
				this.editor.saveState('Change anchor');
			}
			this.editor.ignoreNextClick = true;
			setTimeout(() => { this.editor.ignoreNextClick = false; }, 150);
		};
		document.addEventListener('pointermove', onMove);
		document.addEventListener('pointerup', onUp);
		document.addEventListener('pointercancel', onUp);
	}

	/**
	 * Handle pointer move during handle drag
	 */
	handleHandlePointerMove(e) {
		if (
			!this.activeHandleType ||
			!this.dragStartState ||
			e.pointerId !== this.activeHandlePointerId
		) {
			return;
		}

		e.preventDefault();
		e.stopPropagation();

		const start = this.dragStartState;
		if (!start.didMove && !hasPassedDragThreshold({ x: start.mouseX, y: start.mouseY }, e)) return;

		if (this.activeHandleType.startsWith('corner-')) {
			this.dragStartState.didMove = true;
			this.handleCornerDrag(e);
		} else if (this.activeHandleType.startsWith('edge-')) {
			this.dragStartState.didMove = true;
			this.handleEdgeResizeDrag(e);
		} else if (this.activeHandleType === 'rotation') {
			this.dragStartState.didMove = true;
			this.handleRotationDrag(e);
		} else if (this.activeHandleType === 'anchor') {
			this.dragStartState.didMove = true;
			this.handleAnchorDrag(e);
		} else if (this.activeHandleType.startsWith('radius-')) {
			this.dragStartState.didMove = true;
			this.handleRadiusDrag(e);
		} else if (this.activeHandleType === 'move') {
			this.handleMoveDrag(e);
		}

		if (this.layer.type === LayerType.STICKER || this.layer.type === LayerType.TEXT_GLITTER || this.layer.type === LayerType.SHAPE) {
			this.scheduleSettingsSync();
		}
	}

	/**
	 * Handle pointer end to finish handle drag
	 */
	async handleHandlePointerUp(e) {
		if (e.pointerId !== this.activeHandlePointerId) {
			return;
		}

		const completedHandle = this.activeHandleElement;
		document.removeEventListener('pointermove', this.handleHandlePointerMove);
		document.removeEventListener('pointerup', this.handleHandlePointerUp);
		document.removeEventListener('pointercancel', this.handleHandlePointerUp);
		if (this.isDraggingHandle) {
			e.preventDefault();
			e.stopPropagation();
			// Shape/text scale commits rerender the layer to keep it crisp. That
			// rebuild removes the old handles and clears this instance's live drag
			// fields, so retain the completed gesture before committing.
			const completedDrag = this.dragStartState;
			// Shapes are parametric: bake a committed scale into pixel size and
			// re-rasterize so large shapes stay crisp (no upscaled-raster mixels).
			const ht = this.activeHandleType || '';
			const anchorBeforeCommit = (ht.startsWith('corner-') || ht.startsWith('edge-'))
				? getLayerAnchorPoint(this.editor, this.layer) : null;
			// Clear the drag flag before committing so ShapeGlitterManager.renderLayer()'s
			// handle-refresh guard doesn't skip rebuilding the (now differently-sized) box.
			this.isDraggingHandle = false;
			if (
				this.layer.type === LayerType.TEXT_GLITTER
				&& ht.startsWith('corner-')
			) {
				await this.editor.textGlitterManager?.commitScaleToFontSize?.(this.layer);
			} else if (this.layer.type === LayerType.SHAPE && (ht.startsWith('corner-') || ht.startsWith('edge-'))) {
				this.editor.shapeGlitterManager?.commitScale(this.layer);
			} else if (this.layer.type === LayerType.STICKER && (ht.startsWith('corner-') || ht.startsWith('edge-'))) {
				await this.editor.stickerManager?.commitResolutionSwap(this.layer);
			}
			if (anchorBeforeCommit) {
				const anchorAfterCommit = getLayerAnchorPoint(this.editor, this.layer);
				const transform = this.getTransform();
				transform.position.x += anchorBeforeCommit.x - anchorAfterCommit.x;
				transform.position.y += anchorBeforeCommit.y - anchorAfterCommit.y;
				const context = this.editor.getMovableLayerContext(this.layer);
				context?.manager?.updateTransform(this.layer.id, {});
			}
			if (completedDrag?.didMove) {
				if (completedDrag.targetLayerId) {
					this.editor.layerManager.setActiveLayer(completedDrag.targetLayerId);
				}
				this.editor.saveState(ht === 'anchor' ? 'Change anchor' : ht.startsWith('radius-') ? 'Change corner radius' : 'Transform layer');
			} else if (completedDrag?.altDuplicatePending) {
				const point = this.getCanvasPointFromClient(e.clientX, e.clientY);
				this.delegateSelectionFromCanvasPoint(point, { cycleDeep: true });
			} else if (e.pointerType === 'touch' && ht === 'move') {
				const now = Date.now();
				const previous = this.lastTouchMoveHandleTap;
				const isDoubleTap = previous
					&& now - previous.time <= CONFIG.ui.gestures.doubleTapMs
					&& Math.hypot(e.clientX - previous.x, e.clientY - previous.y) <= CONFIG.ui.gestures.doubleTapSlopPx;
				if (isDoubleTap) {
					this.lastTouchMoveHandleTap = null;
					this.editor.viewport.gestureManager.handleDoubleTap(
						{ x: e.clientX, y: e.clientY },
						{ type: 'layerDrag', layerId: this.layer.id }
					);
				} else {
					this.lastTouchMoveHandleTap = { time: now, x: e.clientX, y: e.clientY };
				}
			}

			if (e.pointerType === 'mouse') {
				this.editor.ignoreNextClick = true;
				setTimeout(() => {
					this.editor.ignoreNextClick = false;
				}, 150);
			}
		}

		this.editor.setDuplicateDragFeedback?.(false);
		this.editor.clearSmartGuides?.();
		(this.activeHandleElement || completedHandle)?.releasePointerCapture?.(e.pointerId);
		this.activeHandleType = null;
		this.activeHandleElement = null;
		this.activeHandlePointerId = null;
		this.dragStartState = null;
	}

	/**
	 * Handle dragging of move handle (bounding box)
	 */
	handleMoveDrag(e) {
		const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);

		const deltaX = canvasPos.x - this.dragStartState.canvasX;
		const deltaY = canvasPos.y - this.dragStartState.canvasY;
		if (!this.dragStartState.didMove && this.dragStartState.altDuplicatePending) {
			this.editor.groupTransformManager?.ensureHistoryBaseline?.();
			const clone = this.editor.layerManager.cloneLayer(this.layer.id, { positionOffset: { x: 0, y: 0 }, skipHistory: true, skipSelection: true });
			const ctx = this.editor.getMovableLayerContext(clone);
			const target = ctx?.manager?.layerTransforms?.get(clone?.id);
			if (!target) return;
			this.editor.setDuplicateDragFeedback?.(true, 1);
			this.editor.addDuplicateGhost?.(this, target);
			this.dragStartState.targetTransform = target;
			this.dragStartState.targetLayerId = clone.id;
			this.dragStartState.transform.position = { ...target.getTransform().position };
			this.dragStartState.altDuplicatePending = false;
		}
		this.dragStartState.didMove = true;
		const axis = e.shiftKey
			? (this.dragStartState.lockedAxis || (Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y'))
			: null;
		this.dragStartState.lockedAxis = axis;
		const nextDeltaX = axis === 'y' ? 0 : deltaX;
		const nextDeltaY = axis === 'x' ? 0 : deltaY;

		const newX = this.dragStartState.transform.position.x + nextDeltaX;
		const newY = this.dragStartState.transform.position.y + nextDeltaY;

		const targetTransform = this.dragStartState.targetTransform || this;
		const snappedPosition = this.editor.snapTransformPosition(targetTransform, { x: newX, y: newY }, { ctrlKey: e.ctrlKey || e.metaKey });
		targetTransform.updateTransform({
			position: snappedPosition
		});

		// Re-apply transform to element
		const dimensions = targetTransform.getDimensions();
		targetTransform.applyTransform(targetTransform.element, dimensions);
		this.editor.syncDuplicateGhost?.(targetTransform);

		targetTransform.updateHandlePositions();
	}

	cancelActiveDrag() {
		if (this.activeDocumentDragCancel?.()) return true;
		if (this.activeMouseDragCancel?.()) return true;
		const start = this.dragStartState;
		if (!this.isDraggingHandle || !start) return false;
		document.removeEventListener('pointermove', this.handleHandlePointerMove);
		document.removeEventListener('pointerup', this.handleHandlePointerUp);
		document.removeEventListener('pointercancel', this.handleHandlePointerUp);
		if (start.targetLayerId) {
			this.editor.layerManager.deleteLayers([start.targetLayerId], { skipHistory: true, silent: true });
			this.editor.layerManager.setActiveLayer(this.layer.id);
		} else {
			const transform = this.getTransform();
			transform.position = { ...start.transform.position };
			transform.scale = { ...start.transform.scale };
			transform.rotation = start.transform.rotation;
			transform.anchor = { ...start.transform.anchor };
			if (start.cornerRadiusPx != null && this.layer.shapeData) this.layer.shapeData.cornerRadiusPx = start.cornerRadiusPx;
			if (start.boxWidth != null && this.layer.textData) this.layer.textData.boxWidth = start.boxWidth;
			if (start.boxHeight != null && this.layer.textData) this.layer.textData.boxHeight = start.boxHeight;
			this.applyTransform(this.element, this.getDimensions());
			this.updateHandlePositions();
		}
		this.editor.setDuplicateDragFeedback?.(false);
		this.editor.clearSmartGuides?.();
		this.activeHandleElement?.releasePointerCapture?.(this.activeHandlePointerId);
		this.activeHandleType = null;
		this.activeHandleElement = null;
		this.activeHandlePointerId = null;
		this.dragStartState = null;
		this.isDraggingHandle = false;
		return true;
	}

	/**
	 * Handle dragging of corner handles (scale)
	 */
	handleCornerDrag(e) {
		const canvasPos = this.getAnchoredHandlePoint(e);
		// Point and box text scale from their visible frame. Area text's edge
		// handles resize/reflow its box without scaling the artwork.
		const transform = this.getTransform();
		const start = this.dragStartState;
		const frame = start.handleFrame || { width: start.width, height: start.height, offsetX: 0, offsetY: 0 };

		// Frame center in canvas space at drag start (fixed reference while scaling)
		const worldRotationRad = (transform.rotation * Math.PI) / 180;
		const worldCos = Math.cos(worldRotationRad);
		const worldSin = Math.sin(worldRotationRad);
		const startOffsetX = frame.offsetX * (start.transform.scale.x / 100);
		const startOffsetY = frame.offsetY * (start.transform.scale.y / 100);
		const centerX = start.transform.position.x + startOffsetX * worldCos - startOffsetY * worldSin;
		const centerY = start.transform.position.y + startOffsetX * worldSin + startOffsetY * worldCos;

		// Rotate mouse vector back to local space
		const vectorX = canvasPos.x - centerX;
		const vectorY = canvasPos.y - centerY;
		const rotationRad = -worldRotationRad;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);
		const localX = vectorX * cos - vectorY * sin;
		const localY = vectorX * sin + vectorY * cos;

		const proportional = this.layer.type === LayerType.TEXT_GLITTER || Boolean(transform.proportionalScale) !== Boolean(e.shiftKey);
		let newScaleX;
		let newScaleY;
		let nextPosition = null;
		if (e.altKey) {
			// Alt keeps the visible frame center fixed (Figma/Photoshop center resize).
			const candidateX = clampLayerScale((Math.abs(localX) * 2 / frame.width) * 100);
			const candidateY = clampLayerScale((Math.abs(localY) * 2 / frame.height) * 100);
			const initialX = (frame.width / 2) * (start.transform.scale.x / 100);
			const initialY = (frame.height / 2) * (start.transform.scale.y / 100);
			const factor = Math.max(0.01, (Math.abs(localX) * initialX + Math.abs(localY) * initialY)
				/ Math.max(0.01, initialX * initialX + initialY * initialY));
			newScaleX = proportional ? clampLayerScale(start.transform.scale.x * factor) : candidateX;
			newScaleY = proportional ? clampLayerScale(start.transform.scale.y * factor) : candidateY;
		} else {
			// Default corner resize keeps the opposite corner fixed.
			const corner = this.activeHandleType.replace('corner-', '');
			const signX = corner.includes('l') ? -1 : 1;
			const signY = corner.includes('t') ? -1 : 1;
			const oppositeLocalX = -signX * (frame.width / 2) * (start.transform.scale.x / 100);
			const oppositeLocalY = -signY * (frame.height / 2) * (start.transform.scale.y / 100);
			const oppositeWorldX = centerX + oppositeLocalX * worldCos - oppositeLocalY * worldSin;
			const oppositeWorldY = centerY + oppositeLocalX * worldSin + oppositeLocalY * worldCos;
			const fromOppositeX = canvasPos.x - oppositeWorldX;
			const fromOppositeY = canvasPos.y - oppositeWorldY;
			const localFromOppositeX = fromOppositeX * cos - fromOppositeY * sin;
			const localFromOppositeY = fromOppositeX * sin + fromOppositeY * cos;
			// Clamp before the anchor math below — deriving nextPosition from an
			// unclamped scale makes the layer drift diagonally once the limit hits.
			const candidateX = clampLayerScale((Math.abs(localFromOppositeX) / frame.width) * 100);
			const candidateY = clampLayerScale((Math.abs(localFromOppositeY) / frame.height) * 100);
			const initialX = signX * frame.width * (start.transform.scale.x / 100);
			const initialY = signY * frame.height * (start.transform.scale.y / 100);
			const factor = Math.max(0.01, (localFromOppositeX * initialX + localFromOppositeY * initialY)
				/ Math.max(0.01, initialX * initialX + initialY * initialY));
			newScaleX = proportional ? clampLayerScale(start.transform.scale.x * factor) : candidateX;
			newScaleY = proportional ? clampLayerScale(start.transform.scale.y * factor) : candidateY;

			const draggedLocalX = oppositeLocalX + signX * frame.width * (newScaleX / 100);
			const draggedLocalY = oppositeLocalY + signY * frame.height * (newScaleY / 100);
			const visibleCenterLocalX = (oppositeLocalX + draggedLocalX) / 2;
			const visibleCenterLocalY = (oppositeLocalY + draggedLocalY) / 2;
			const visibleCenterWorldX = centerX + visibleCenterLocalX * worldCos - visibleCenterLocalY * worldSin;
			const visibleCenterWorldY = centerY + visibleCenterLocalX * worldSin + visibleCenterLocalY * worldCos;
			const scaledOffsetX = frame.offsetX * (newScaleX / 100);
			const scaledOffsetY = frame.offsetY * (newScaleY / 100);
			nextPosition = {
				x: visibleCenterWorldX - (scaledOffsetX * worldCos - scaledOffsetY * worldSin),
				y: visibleCenterWorldY - (scaledOffsetX * worldSin + scaledOffsetY * worldCos)
			};
		}

		const fixedAnchor = e.altKey ? getLayerAnchorPoint(this.editor, this.layer) : null;
		this.updateTransform({
			position: nextPosition || undefined,
			scale: {
				x: newScaleX,
				y: newScaleY
			}
		});
		if (fixedAnchor) {
			const after = getLayerAnchorPoint(this.editor, this.layer);
			this.getTransform().position.x += fixedAnchor.x - after.x;
			this.getTransform().position.y += fixedAnchor.y - after.y;
		}

		// Re-apply transform to element
		const dimensions = this.getDimensions();
		this.applyTransform(this.element, dimensions);

		this.updateHandlePositions();
	}

	handleEdgeResizeDrag(e) {
		const edge = this.activeHandleType.replace('edge-', '');
		const textManager = this.editor.textGlitterManager;
		if (textManager?.canResizeBoxEdges?.(this.layer)) {
			const canvasPos = this.getAnchoredHandlePoint(e);
			textManager.resizeBoxFromHandle(this.layer, edge, this.dragStartState, canvasPos, { ctrlKey: e.ctrlKey });
			return;
		}

		this.handleOneAxisScale(e, edge);
	}

	// One-axis scale for a shape edge handle (left/right → scaleX, top/bottom →
	// scaleY). Same local-space projection as handleCornerDrag.
	handleOneAxisScale(e, edge) {
		const transform = this.getTransform();
		const canvasPos = this.getAnchoredHandlePoint(e);
		const start = this.dragStartState;
		const frame = start.handleFrame || { width: start.width, height: start.height, offsetX: 0, offsetY: 0 };

		const worldRotationRad = (transform.rotation * Math.PI) / 180;
		const worldCos = Math.cos(worldRotationRad);
		const worldSin = Math.sin(worldRotationRad);
		const startOffsetX = (frame.offsetX || 0) * (start.transform.scale.x / 100);
		const startOffsetY = (frame.offsetY || 0) * (start.transform.scale.y / 100);
		const centerX = start.transform.position.x + startOffsetX * worldCos - startOffsetY * worldSin;
		const centerY = start.transform.position.y + startOffsetX * worldSin + startOffsetY * worldCos;
		const vectorX = canvasPos.x - centerX;
		const vectorY = canvasPos.y - centerY;
		const cos = Math.cos(-worldRotationRad);
		const sin = Math.sin(-worldRotationRad);
		const localX = vectorX * cos - vectorY * sin;
		const localY = vectorX * sin + vectorY * cos;

		const isHorizontal = edge === 'left' || edge === 'right';
		const scale = {
			x: start.transform.scale.x,
			y: start.transform.scale.y
		};
		const lockAspect = Boolean(transform.proportionalScale) !== Boolean(e.shiftKey);
		const axisSign = edge === 'left' || edge === 'top' ? -1 : 1;
		let nextPosition = null;
		if (e.altKey) {
			if (isHorizontal) {
				scale.x = clampLayerScale((Math.abs(localX) * 2 / frame.width) * 100);
			} else {
				scale.y = clampLayerScale((Math.abs(localY) * 2 / frame.height) * 100);
			}
		} else if (isHorizontal) {
			const oppositeLocalX = -axisSign * (frame.width / 2) * (start.transform.scale.x / 100);
			const oppositeWorldX = centerX + oppositeLocalX * worldCos;
			const oppositeWorldY = centerY + oppositeLocalX * worldSin;
			const fromOppositeX = canvasPos.x - oppositeWorldX;
			const fromOppositeY = canvasPos.y - oppositeWorldY;
			const localDistance = axisSign * (fromOppositeX * cos - fromOppositeY * sin);
			scale.x = clampLayerScale((Math.max(0, localDistance) / frame.width) * 100);
		} else {
			const oppositeLocalY = -axisSign * (frame.height / 2) * (start.transform.scale.y / 100);
			const oppositeWorldX = centerX - oppositeLocalY * worldSin;
			const oppositeWorldY = centerY + oppositeLocalY * worldCos;
			const fromOppositeX = canvasPos.x - oppositeWorldX;
			const fromOppositeY = canvasPos.y - oppositeWorldY;
			const localDistance = axisSign * (fromOppositeX * sin + fromOppositeY * cos);
			scale.y = clampLayerScale((Math.max(0, localDistance) / frame.height) * 100);
		}

		if (isHorizontal) {
			if (lockAspect) {
				scale.y = clampLayerScale(start.transform.scale.y * scale.x / Math.max(0.01, start.transform.scale.x));
			}
		} else {
			if (lockAspect) {
				scale.x = clampLayerScale(start.transform.scale.x * scale.y / Math.max(0.01, start.transform.scale.y));
			}
		}

		if (!e.altKey) {
			const visibleCenterLocalX = isHorizontal
				? -axisSign * (frame.width / 2) * (start.transform.scale.x / 100) + axisSign * (frame.width / 2) * (scale.x / 100)
				: 0;
			const visibleCenterLocalY = isHorizontal
				? 0
				: -axisSign * (frame.height / 2) * (start.transform.scale.y / 100) + axisSign * (frame.height / 2) * (scale.y / 100);
			const visibleCenterWorldX = centerX + visibleCenterLocalX * worldCos - visibleCenterLocalY * worldSin;
			const visibleCenterWorldY = centerY + visibleCenterLocalX * worldSin + visibleCenterLocalY * worldCos;
			const scaledOffsetX = (frame.offsetX || 0) * (scale.x / 100);
			const scaledOffsetY = (frame.offsetY || 0) * (scale.y / 100);
			nextPosition = {
				x: visibleCenterWorldX - (scaledOffsetX * worldCos - scaledOffsetY * worldSin),
				y: visibleCenterWorldY - (scaledOffsetX * worldSin + scaledOffsetY * worldCos)
			};
		}

		const fixedAnchor = e.altKey ? getLayerAnchorPoint(this.editor, this.layer) : null;
		this.updateTransform({ position: nextPosition || undefined, scale });
		if (fixedAnchor) {
			const after = getLayerAnchorPoint(this.editor, this.layer);
			this.getTransform().position.x += fixedAnchor.x - after.x;
			this.getTransform().position.y += fixedAnchor.y - after.y;
		}
		this.applyTransform(this.element, this.getDimensions());
		this.updateHandlePositions();
	}

	// The grabbed handle's true point now (see anchoredHandlePoint): scale
	// math measures from here, so the grab offset and handle outset never
	// make the layer jump.
	getAnchoredHandlePoint(e) {
		const start = this.dragStartState;
		const point = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
		return anchoredHandlePoint(start.handlePoint, { x: start.canvasX, y: start.canvasY }, point);
	}

	// Relative rotation about the frame center: the layer turns by the
	// pointer's change in angle, and the frame center stays put.
	handleRotationDrag(e) {
		const start = this.dragStartState;
		const point = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
		const delta = rotationDeltaDeg(start.pivot, { x: start.canvasX, y: start.canvasY }, point);
		const rotation = normalizeRotationDeg(snapRotationDeg(start.transform.rotation + delta, e.shiftKey));
		const position = rotatePointAbout(start.transform.position, start.pivot, rotation - start.transform.rotation);

		this.updateTransform({ rotation });
		this.getTransform().position = position;
		this.applyTransform(this.element, this.getDimensions());
		this.updateHandlePositions();
	}

	setAnchorFromCanvasPoint(point, options = {}) {
		const transform = this.getTransform();
		const target = getLayerAnchorFromPoint(this.editor, this.layer, point);
		if (!target) return;
		const clamp = CONFIG.ui.stickerHandles.anchorClamp;
		let { x, y } = target;
		// Shift jumps to the nearest of the nine frame points, like Shift snapping
		// rotation to steps. Otherwise the anchor catches on those points, or on
		// the canvas center, within the snap threshold. Ctrl/Cmd turns both off.
		const grid = [0, 0.5, 1];
		const nearest = (value) => grid.reduce((best, step) => Math.abs(value - step) < Math.abs(value - best) ? step : best);
		if (options.shiftKey) {
			x = nearest(x);
			y = nearest(y);
		} else if (!options.ctrlKey && CONFIG.snapping.enabled) {
			const threshold = CONFIG.snapping.threshold / Math.max(0.01, this.editor.viewport.currentZoom);
			const snapX = grid.find((value) => Math.abs((x - value) * target.width) <= threshold);
			const snapY = grid.find((value) => Math.abs((y - value) * target.height) <= threshold);
			const canvas = this.editor.originalCanvas;
			const canvasCenter = canvas ? { x: canvas.width / 2, y: canvas.height / 2 } : null;
			if (snapX === undefined && snapY === undefined && canvasCenter && CONFIG.snapping.snapToCanvas
				&& Math.hypot(point.x - canvasCenter.x, point.y - canvasCenter.y) <= threshold) {
				({ x, y } = getLayerAnchorFromPoint(this.editor, this.layer, canvasCenter));
			} else {
				if (snapX !== undefined) x = snapX;
				if (snapY !== undefined) y = snapY;
			}
		}
		transform.anchor.x = Math.max(clamp.min, Math.min(clamp.max, x));
		transform.anchor.y = Math.max(clamp.min, Math.min(clamp.max, y));
		this.updateHandlePositions();
		this.scheduleSettingsSync();
	}

	handleAnchorDrag(e) {
		this.setAnchorFromCanvasPoint(this.getCanvasPointFromClient(e.clientX, e.clientY), { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey });
	}

	handleRadiusDrag(e) {
		const metrics = this.getFrameMetrics();
		const point = this.getCanvasPointFromClient(e.clientX, e.clientY);
		const dx = point.x - metrics.centerX;
		const dy = point.y - metrics.centerY;
		const localX = dx * metrics.cos + dy * metrics.sin;
		const localY = -dx * metrics.sin + dy * metrics.cos;
		const corner = this.activeHandleType.replace('radius-', '');
		const sx = corner.includes('l') ? -1 : 1;
		const sy = corner.includes('t') ? -1 : 1;
		const insetX = metrics.displayWidth / 2 - sx * localX;
		const insetY = metrics.displayHeight / 2 - sy * localY;
		const scale = Math.max(0.01, Math.min(metrics.scaleX, metrics.scaleY));
		const radius = Math.max(0, Math.min(FIELDS.shapeRadius.max, Math.min(this.layer.shapeData.width, this.layer.shapeData.height) / 2, (insetX + insetY) / (2 * scale)));
		this.layer.shapeData.cornerRadiusPx = radius;
		this.editor.shapeGlitterManager.invalidateMeasurement(this.layer);
		this.editor.shapeGlitterManager.renderLayer(this.layer);
		this.updateHandlePositions();
	}

	/**
	 * Cleanup - remove all event listeners and DOM elements
	 */
	destroy() {
		// Remove transform handles
		this.removeTransformHandles();
		this.removeHoverOutline();

		// Clear element reference
		this.element = null;
	}
}
