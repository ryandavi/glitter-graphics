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
        this.activeHandleType = null;
        this.activeHandleElement = null;
        this.activeHandlePointerId = null;
        this.dragStartState = null;
        this.isDraggingHandle = false;
        this.gestureInteractionActive = false;
        this.gestureInteractionChanged = false;

        // Bind methods for event listeners
        this.handleHandlePointerMove = this.handleHandlePointerMove.bind(this);
        this.handleHandlePointerUp = this.handleHandlePointerUp.bind(this);

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
        `opacity: ${metrics.opacity}`,
        `pointer-events: ${pointerEvents}`,
        `display: ${this.layer.visible ? 'block' : 'none'}`,
        `z-index: ${zIndex}`,
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
     * @param {Object} updates - Object with properties to update (position, scale, rotation, opacity, flipX, flipY)
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

    if (updates.opacity !== undefined) {
        transform.opacity = updates.opacity;
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

    getHandleFrame() {
        const dimensions = this.getDimensions();
        const textFrame = this.layer.type === LayerType.TEXT_GLITTER
            ? this.editor.textGlitterManager?.getTextFrame?.(this.layer)
            : null;

        if (textFrame) {
            return textFrame;
        }

        const shapeFrame = this.layer.type === LayerType.SHAPE
            ? this.editor.shapeGlitterManager?.getShapeHandleFrame?.(this.layer)
            : null;

        if (shapeFrame) {
            return shapeFrame;
        }

        return {
            width: dimensions.width,
            height: dimensions.height,
            offsetX: 0,
            offsetY: 0
        };
    }

    getFrameMetrics(transform = this.getTransform(), frame = this.getHandleFrame()) {
        const scaleX = (transform.scale.x || 100) / 100;
        const scaleY = (transform.scale.y || 100) / 100;
        const displayWidth = frame.width * scaleX;
        const displayHeight = frame.height * scaleY;
        const rotationRad = (transform.rotation * Math.PI) / 180;
        const cos = Math.cos(rotationRad);
        const sin = Math.sin(rotationRad);
        const frameOffsetX = frame.offsetX * scaleX;
        const frameOffsetY = frame.offsetY * scaleY;
        const centerX = transform.position.x + frameOffsetX * cos - frameOffsetY * sin;
        const centerY = transform.position.y + frameOffsetX * sin + frameOffsetY * cos;
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
		this.editor.canvasElementsContainer.appendChild(outline);
		this.hoverOutline = outline;
		this.updateHoverOutlinePosition();
	}

	updateHoverOutlinePosition() {
		if (!this.hoverOutline) return;
		const transform = this.getTransform();
		const metrics = this.getFrameMetrics(transform);
		this.hoverOutline.style.cssText = `
			left: ${metrics.centerX}px;
			top: ${metrics.centerY}px;
			width: ${metrics.displayWidth}px;
			height: ${metrics.displayHeight}px;
			transform: translate(-50%, -50%) rotate(${transform.rotation}deg);
		`;
	}

	removeHoverOutline() {
		this.hoverOutline?.remove();
		this.hoverOutline = null;
	}

    getCanvasPointFromClient(clientX, clientY) {
        return this.editor.viewport.screenToCanvas(clientX, clientY);
    }

    delegateSelectionFromCanvasPoint(canvasPoint, options = {}) {
        const x = Math.round(canvasPoint.x);
        const y = Math.round(canvasPoint.y);
		if (!CONFIG.app.behavior.autoSelect && !options.toggleSelection && !options.cycleDeep) {
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

        this.editor.saveState();
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

        if (this.element) {
            this.applyTransform(this.element, this.getDimensions());
        }
        if (this.transformHandles) {
            this.updateHandlePositions();
        }

        this.editor.saveState();
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
		&& !CONFIG.app.behavior.autoSelect
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
			this.editor.updateStatus('This selection cannot move because it includes a locked, Base Image, or Glitter Fill layer');
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
            this.editor.saveState();
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
    }

    dragByScreenDelta(deltaX, deltaY) {
        this.beginGestureInteraction();

        const canvasDeltaX = deltaX / this.editor.viewport.currentZoom;
        const canvasDeltaY = deltaY / this.editor.viewport.currentZoom;
        const transform = this.getTransform();

        this.updateTransform({
            position: {
                x: transform.position.x + canvasDeltaX,
                y: transform.position.y + canvasDeltaY
            }
        });

        this.gestureInteractionChanged = true;
        this.syncGestureTransform();
    }

    applyGestureDelta(gestureDelta) {
        this.beginGestureInteraction();

        const transform = this.getTransform();
        const centroidCanvas = this.editor.viewport.screenToCanvas(gestureDelta.centroidX, gestureDelta.centroidY);
        const currentScaleX = transform.scale.x || 100;
        const currentScaleY = transform.scale.y || 100;
        const nextScaleX = clampLayerScale(currentScaleX * gestureDelta.scale);
        const nextScaleY = transform.proportionalScale
            ? nextScaleX
            : clampLayerScale(currentScaleY * gestureDelta.scale);
        const scaleFactor = currentScaleX !== 0 ? nextScaleX / currentScaleX : 1;
        const rotationDeltaRad = (gestureDelta.rotateDeg * Math.PI) / 180;
        const translateCanvasX = gestureDelta.translateX / this.editor.viewport.currentZoom;
        const translateCanvasY = gestureDelta.translateY / this.editor.viewport.currentZoom;
        const relativeX = transform.position.x - centroidCanvas.x;
        const relativeY = transform.position.y - centroidCanvas.y;
        const scaledX = relativeX * scaleFactor;
        const scaledY = relativeY * scaleFactor;
        const rotatedX = (scaledX * Math.cos(rotationDeltaRad)) - (scaledY * Math.sin(rotationDeltaRad));
        const rotatedY = (scaledX * Math.sin(rotationDeltaRad)) + (scaledY * Math.cos(rotationDeltaRad));

        this.updateTransform({
            position: {
                x: centroidCanvas.x + rotatedX + translateCanvasX,
                y: centroidCanvas.y + rotatedY + translateCanvasY
            },
            scale: {
                x: nextScaleX,
                y: nextScaleY
            },
            rotation: transform.rotation + gestureDelta.rotateDeg
        });

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
            this.editor.saveState();
        }

        this.gestureInteractionActive = false;
        this.gestureInteractionChanged = false;
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
    
    // Create container
    const container = document.createElement('div');
    container.className = 'transform-handles';
    container.dataset.layerId = this.layer.id;
    
    // Create bounding box (draggable for moving)
    const boundingBox = document.createElement('div');
    boundingBox.className = 'transform-bounding-box';
    boundingBox.dataset.handleType = 'move';
	boundingBox.title = 'Move. Shift constrains movement; Alt-drag duplicates; Ctrl bypasses snapping.';
    container.appendChild(boundingBox);
    
    // Create corner handles
    const corners = ['tl', 'tr', 'br', 'bl'];
    corners.forEach(corner => {
        const handleWrapper = document.createElement('div');
        handleWrapper.className = 'transform-handle-wrapper';
        handleWrapper.dataset.handleType = `corner-${corner}`;
		handleWrapper.title = 'Resize. Alt resizes from the center.';
        
        const handle = document.createElement('div');
        handle.className = `transform-handle transform-handle-corner corner-${corner}`;
        
        handleWrapper.appendChild(handle);
        container.appendChild(handleWrapper);
    });

    if (this.supportsEdgeResize()) {
        const edges = ['top', 'right', 'bottom', 'left'];
        edges.forEach(edge => {
            const handleWrapper = document.createElement('div');
            handleWrapper.className = 'transform-handle-wrapper';
            handleWrapper.dataset.handleType = `edge-${edge}`;
			handleWrapper.title = 'Resize one side. Alt resizes from the center.';

            const handle = document.createElement('div');
            handle.className = `transform-handle transform-handle-edge edge-${edge}`;

            handleWrapper.appendChild(handle);
            container.appendChild(handleWrapper);
        });
    }
    
    // Create rotation handle
    const rotationLine = document.createElement('div');
    rotationLine.className = 'transform-rotation-line';
    container.appendChild(rotationLine);
    
    const rotationWrapper = document.createElement('div');
    rotationWrapper.className = 'transform-handle-wrapper';
    rotationWrapper.dataset.handleType = 'rotation';
	rotationWrapper.title = 'Rotate. Hold Shift to snap to 15 degree increments.';
    
    const rotationHandle = document.createElement('div');
    rotationHandle.className = 'transform-handle transform-handle-rotation';
    
    rotationWrapper.appendChild(rotationHandle);
    container.appendChild(rotationWrapper);
    
    // Add to canvas
    this.editor.canvasElementsContainer.appendChild(container);
    this.transformHandles = container;
    
    // Position handles - this will now use the correct transform that was just applied
    this.updateHandlePositions();
    
    // Attach event listeners
    this.attachHandleListeners();
}

    /**
     * Update positions of transform handles based on current transform
     */
    updateHandlePositions() {
        if (!this.transformHandles) return;

        const transform = this.getTransform();
        const frame = this.getHandleFrame();
        const config = CONFIG.ui.stickerHandles;

        // Calculate display dimensions
        const displayWidth = frame.width * (transform.scale.x / 100);
        const displayHeight = frame.height * (transform.scale.y / 100);

        // Get rotation in radians
        const rotationRad = (transform.rotation * Math.PI) / 180;
        const cos = Math.cos(rotationRad);
        const sin = Math.sin(rotationRad);
        // Frame offsets are text-local units; scale them into display space.
        const frameOffsetX = frame.offsetX * (transform.scale.x / 100);
        const frameOffsetY = frame.offsetY * (transform.scale.y / 100);
        const centerX = transform.position.x + frameOffsetX * cos - frameOffsetY * sin;
        const centerY = transform.position.y + frameOffsetX * sin + frameOffsetY * cos;

        // Half dimensions
        const hw = displayWidth / 2;
        const hh = displayHeight / 2;
		const zoom = this.editor.viewport.currentZoom;
		const outset = screenPixelsToCanvasUnits(config.outwardOffset, zoom);

		// Handles sit just outside the selection border. The bounding box remains
		// exact, so the visual outset cannot change transform geometry.
        const corners = {
			tl: { x: -hw - outset, y: -hh - outset },
			tr: { x: hw + outset, y: -hh - outset },
			br: { x: hw + outset, y: hh + outset },
			bl: { x: -hw - outset, y: hh + outset }
        };

        const edges = {
			top: { x: 0, y: -hh - outset },
			right: { x: hw + outset, y: 0 },
			bottom: { x: 0, y: hh + outset },
			left: { x: -hw - outset, y: 0 }
        };

        // Rotate corners and translate to position
        const rotatePoint = (local) => ({
            x: centerX + (local.x * cos - local.y * sin),
            y: centerY + (local.x * sin + local.y * cos)
        });

        const rotatedCorners = {};
        Object.keys(corners).forEach(key => {
            rotatedCorners[key] = rotatePoint(corners[key]);
        });

        // Position bounding box
        const boundingBox = this.transformHandles.querySelector('.transform-bounding-box');
        if (boundingBox) {
            boundingBox.style.cssText = `
				position: absolute;
				left: ${centerX}px;
				top: ${centerY}px;
				width: ${displayWidth}px;
				height: ${displayHeight}px;
				transform: translate(-50%, -50%) rotate(${transform.rotation}deg);
				pointer-events: auto;
				cursor: move;
			`;
        }

        // Position corner handle wrappers
        Object.keys(rotatedCorners).forEach(corner => {
            const wrapper = this.transformHandles.querySelector(`[data-handle-type="corner-${corner}"]`);
            if (wrapper) {
                const pos = rotatedCorners[corner];
                wrapper.style.cssText = `
					position: absolute;
					left: ${pos.x}px;
					top: ${pos.y}px;
					transform: translate(-50%, -50%);
				`;
                wrapper.style.cursor = this.getCornerCursor(corner, transform.rotation);
            }
        });

        if (this.supportsEdgeResize()) {
            Object.keys(edges).forEach(edge => {
                const wrapper = this.transformHandles.querySelector(`[data-handle-type="edge-${edge}"]`);
                if (!wrapper) return;

                const pos = rotatePoint(edges[edge]);
                wrapper.style.cssText = `
					position: absolute;
					left: ${pos.x}px;
					top: ${pos.y}px;
					transform: translate(-50%, -50%);
				`;
                wrapper.style.cursor = this.getEdgeCursor(edge, transform.rotation);
            });
        }

        // Position rotation handle (above top center)
		const rotationHandleDistance = screenPixelsToCanvasUnits(config.rotationHandleDistance, zoom);
        const topCenterLocal = { x: 0, y: -hh - rotationHandleDistance };
        const topCenter = {
            x: centerX + (topCenterLocal.x * cos - topCenterLocal.y * sin),
            y: centerY + (topCenterLocal.x * sin + topCenterLocal.y * cos)
        };

        const rotationWrapper = this.transformHandles.querySelector('[data-handle-type="rotation"]');
        if (rotationWrapper) {
            rotationWrapper.style.cssText = `
				position: absolute;
				left: ${topCenter.x}px;
				top: ${topCenter.y}px;
				transform: translate(-50%, -50%);
				cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath fill='white' stroke='black' stroke-width='1' d='M12 3v4m0 10v4M3 12h4m10 0h4M6.34 6.34l2.83 2.83m5.66 5.66l2.83 2.83M6.34 17.66l2.83-2.83m5.66-5.66l2.83-2.83'/%3E%3C/svg%3E") 12 12, auto;
			`;
        }

        // Position rotation line
        const rotationLine = this.transformHandles.querySelector('.transform-rotation-line');
        if (rotationLine) {
            const topBoxLocal = { x: 0, y: -hh };
            const topBox = {
                x: centerX + (topBoxLocal.x * cos - topBoxLocal.y * sin),
                y: centerY + (topBoxLocal.x * sin + topBoxLocal.y * cos)
            };

            const lineLength = rotationHandleDistance;
            const lineAngle = transform.rotation;
			const lineWidth = screenPixelsToCanvasUnits(config.boundingBoxWidth, zoom);

            rotationLine.style.cssText = `
				position: absolute;
				left: ${topBox.x}px;
				top: ${topBox.y}px;
				width: ${lineWidth}px;
				height: ${lineLength}px;
				transform: translate(-50%, 0) rotate(${lineAngle}deg);
				transform-origin: top center;
				pointer-events: none;
			`;
        }
    }

    /**
     * Remove transform handles
     */
removeTransformHandles() {
    // Remove handles stored in this instance
    if (this.transformHandles) {
        // Re-enable pointer events on element
        if (this.element) {
            this.element.classList.remove('has-transform-handles');
        }
        
        if (this.transformHandles.parentNode) {
            this.transformHandles.parentNode.removeChild(this.transformHandles);
        }
    }

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

        const handles = this.transformHandles.querySelectorAll('[data-handle-type]');

        handles.forEach(handle => {
            const handleType = handle.dataset.handleType;

			handle.addEventListener('pointerdown', (e) => {
				if (this.layer.locked) return;
                if (e.pointerType === 'mouse' && e.button !== 0) {
                    return;
                }

                const canvasPoint = this.getCanvasPointFromClient(e.clientX, e.clientY);
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

                const transform = this.getTransform();
                const dimensions = this.getDimensions();

                this.dragStartState = {
                    mouseX: e.clientX,
                    mouseY: e.clientY,
                    canvasX: this.editor.viewport.screenToCanvas(e.clientX, e.clientY).x,
                    canvasY: this.editor.viewport.screenToCanvas(e.clientX, e.clientY).y,
                    transform: {
                        position: { ...transform.position },
                        scale: { ...transform.scale },
                        rotation: transform.rotation
                    },
                    width: dimensions.width,
                    height: dimensions.height,
                    boxWidth: this.layer.textData?.boxWidth ?? null,
                    boxHeight: this.layer.textData?.boxHeight ?? null,
                    handleFrame: this.getHandleFrame(),
                    textBoxFrame: this.editor.textGlitterManager?.getFixedBoxFrame?.(this.layer) ?? null,
					didMove: false,
					altDuplicatePending: handleType === 'move' && e.altKey,
					targetTransform: this
                };
            });

            handle.addEventListener('pointermove', this.handleHandlePointerMove);
            handle.addEventListener('pointerup', this.handleHandlePointerUp);
            handle.addEventListener('pointercancel', this.handleHandlePointerUp);
        });
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
			if (!didMove && Math.hypot(deltaX, deltaY) < 3) return;
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
				this.editor.saveState();
			} else {
				const point = this.getCanvasPointFromClient(upEvent.clientX, upEvent.clientY);
				this.delegateSelectionFromCanvasPoint(point, { cycleDeep: true });
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

        if (this.activeHandleType.startsWith('corner-')) {
			this.dragStartState.didMove = true;
            this.handleCornerDrag(e);
        } else if (this.activeHandleType.startsWith('edge-')) {
			this.dragStartState.didMove = true;
            this.handleEdgeResizeDrag(e);
        } else if (this.activeHandleType === 'rotation') {
			this.dragStartState.didMove = true;
            this.handleRotationDrag(e);
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
            // Clear the drag flag before committing so ShapeGlitterManager.renderLayer()'s
            // handle-refresh guard doesn't skip rebuilding the (now differently-sized) box.
            this.isDraggingHandle = false;
            if (
				this.layer.type === LayerType.TEXT_GLITTER
				&& ht.startsWith('corner-')
				&& !this.editor.textGlitterManager?.canResizeBoxEdges?.(this.layer)
			) {
                await this.editor.textGlitterManager?.commitScaleToFontSize?.(this.layer);
            } else if (this.layer.type === LayerType.SHAPE && (ht.startsWith('corner-') || ht.startsWith('edge-'))) {
                this.editor.shapeGlitterManager?.commitScale(this.layer);
            }
			if (completedDrag?.didMove) {
				if (completedDrag.targetLayerId) {
					this.editor.layerManager.setActiveLayer(completedDrag.targetLayerId);
				}
				this.editor.saveState();
			} else if (completedDrag?.altDuplicatePending) {
				const point = this.getCanvasPointFromClient(e.clientX, e.clientY);
				this.delegateSelectionFromCanvasPoint(point, { cycleDeep: true });
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
		if (!this.dragStartState.didMove && Math.hypot(deltaX, deltaY) < 3) return;
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
		const snappedPosition = this.editor.snapTransformPosition(targetTransform, { x: newX, y: newY }, { ctrlKey: e.ctrlKey });
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
		if (start.targetLayerId) {
			this.editor.layerManager.deleteLayers([start.targetLayerId], { skipHistory: true, silent: true });
			this.editor.layerManager.setActiveLayer(this.layer.id);
		} else {
			const transform = this.getTransform();
			transform.position = { ...start.transform.position };
			transform.scale = { ...start.transform.scale };
			transform.rotation = start.transform.rotation;
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
		const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
		const textManager = this.editor.textGlitterManager;
		if (textManager?.canResizeBoxEdges?.(this.layer)) {
			const corner = this.activeHandleType.replace('corner-', '');
			textManager.resizeBoxFromHandle(this.layer, corner, this.dragStartState, canvasPos);
			return;
		}
        // Point text and other transformable layers scale from their visible
        // frame. Box text is handled above by changing its frame dimensions.
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

        const proportional = this.layer.type === LayerType.TEXT_GLITTER || transform.proportionalScale;
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

        this.updateTransform({
            position: nextPosition || undefined,
            scale: {
                x: newScaleX,
                y: newScaleY
            }
        });

        // Re-apply transform to element
        const dimensions = this.getDimensions();
        this.applyTransform(this.element, dimensions);

        this.updateHandlePositions();
    }

    handleEdgeResizeDrag(e) {
        const edge = this.activeHandleType.replace('edge-', '');
		const textManager = this.editor.textGlitterManager;
		if (textManager?.canResizeBoxEdges?.(this.layer)) {
			const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
			textManager.resizeBoxFromHandle(this.layer, edge, this.dragStartState, canvasPos);
			return;
		}

		this.handleOneAxisScale(e, edge);
    }

    // One-axis scale for a shape edge handle (left/right → scaleX, top/bottom →
    // scaleY). Same local-space projection as handleCornerDrag.
    handleOneAxisScale(e, edge) {
        const transform = this.getTransform();
        const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
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
		const lockAspect = Boolean(transform.proportionalScale);
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

        this.updateTransform({ position: nextPosition || undefined, scale });
        this.applyTransform(this.element, this.getDimensions());
        this.updateHandlePositions();
    }

    /**
     * Handle dragging of rotation handle
     */
    handleRotationDrag(e) {
        const transform = this.getTransform();
        const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
        const metrics = this.getFrameMetrics(transform);

        // Calculate angle from center to mouse
        const centerX = metrics.centerX;
        const centerY = metrics.centerY;
        const angle = Math.atan2(canvasPos.y - centerY, canvasPos.x - centerX) * (180 / Math.PI);

        // Adjust for initial offset (rotation handle is at top = -90 degrees)
        let newRotation = angle + 90;

        // Photoshop parity: hold Shift to snap rotation to 15° increments.
        if (e.shiftKey) {
            newRotation = Math.round(newRotation / 15) * 15;
        }

        // Normalize to 0-360
        if (newRotation < 0) newRotation += 360;
        if (newRotation >= 360) newRotation -= 360;

        this.updateTransform({
            rotation: newRotation
        });

        // Re-apply transform to element
        const dimensions = this.getDimensions();
        this.applyTransform(this.element, dimensions);

        this.updateHandlePositions();
    }

    /**
     * Get appropriate cursor for corner handle based on rotation
     */
    getCornerCursor(corner, rotation) {
        // Normalize rotation to 0-360
        let angle = rotation % 360;
        if (angle < 0) angle += 360;

        // Base cursors for each corner (at 0 rotation)
        const baseCursors = {
            tl: 'nwse-resize',
            tr: 'nesw-resize',
            br: 'nwse-resize',
            bl: 'nesw-resize'
        };

        // Determine which cursor to use based on rotation
        // Every 45 degrees, cursors rotate
        const cursorIndex = Math.round(angle / 45) % 8;
        const cursors = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];

        // Get base cursor index
        const baseIndex = {
            tl: 0,
            tr: 2,
            br: 4,
            bl: 6
        }[corner];

        const finalIndex = (baseIndex + cursorIndex) % 8;
        return cursors[finalIndex];
    }

    getEdgeCursor(edge, rotation) {
        let angle = rotation % 360;
        if (angle < 0) angle += 360;

        const baseIndex = (edge === 'top' || edge === 'bottom') ? 1 : 3;
        const cursorIndex = Math.round(angle / 45) % 8;
        const cursors = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];

        return cursors[(baseIndex + cursorIndex) % 8];
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
