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
        // Text: resize the box (box mode). Shape: non-uniform one-axis scale
        // (left/right → width, top/bottom → height).
        if (this.layer.type === LayerType.SHAPE) return true;
        return Boolean(
            this.layer.type === LayerType.TEXT_GLITTER &&
            this.editor.textGlitterManager?.canResizeBoxEdges?.(this.layer)
        );
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
    
    // Calculate actual display size by applying scale to natural dimensions
    const displayWidth = dimensions.width * (transform.scale.x / 100);
    const displayHeight = dimensions.height * (transform.scale.y / 100);
    
    // Build transform array - MUST include translate(-50%, -50%) for centering
    const transforms = [
        `translate(-50%, -50%)`,
        `translate(${transform.position.x}px, ${transform.position.y}px)`,
        `rotate(${transform.rotation}deg)`,
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
        `width: ${displayWidth}px`,
        `height: ${displayHeight}px`,
        `transform: ${transforms.join(' ')}`,
        `opacity: ${transform.opacity / 100}`,
        `pointer-events: ${pointerEvents}`,
        `display: ${this.layer.visible ? 'block' : 'none'}`,
        `z-index: ${zIndex}`,
        `touch-action: none`
    ].join('; ') + ';';
    
    dbg('📐 Applying transform:', {
        position: transform.position,
        displayWidth,
        displayHeight,
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

        transform.position.x = CONFIG.roundStickerTransforms ? Math.round(newX) : newX;
        transform.position.y = CONFIG.roundStickerTransforms ? Math.round(newY) : newY;
    }

    if (updates.scale) {
        transform.scale.x = updates.scale.x ?? transform.scale.x;
        transform.scale.y = updates.scale.y ?? transform.scale.y;
    }

    if (updates.rotation !== undefined) {
        // Normalize rotation to 0-360 range
        let newRotation = CONFIG.roundStickerTransforms ? Math.round(updates.rotation) : updates.rotation;
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
        // Default: assumes layer has stickerData.transform or textData.transform etc.
        // This works for stickers - override for other layer types if needed
        if (this.layer.stickerData?.transform) {
            return this.layer.stickerData.transform;
        }
        if (this.layer.textData?.transform) {
            return this.layer.textData.transform;
        }
        if (this.layer.shapeData?.transform) {
            return this.layer.shapeData.transform;
        }
        throw new Error('Layer does not have a transform object');
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

    // ===== CENTERING METHODS =====

    centerHorizontal() {
        const canvasWidth = this.editor.originalCanvas.width;
        const centerX = canvasWidth / 2;

        this.updateTransform({
            position: { x: centerX }
        });

        // Re-apply transform to element
        if (this.element) {
            const dimensions = this.getDimensions();
            this.applyTransform(this.element, dimensions);
        }

        // Keep the selection/transform-handle overlay in sync with the moved element
        if (this.transformHandles) {
            this.updateHandlePositions();
        }

        this.editor.saveState();
    }

    centerVertical() {
        const canvasHeight = this.editor.originalCanvas.height;
        const centerY = canvasHeight / 2;

        this.updateTransform({
            position: { y: centerY }
        });

        // Re-apply transform to element
        if (this.element) {
            const dimensions = this.getDimensions();
            this.applyTransform(this.element, dimensions);
        }

        // Keep the selection/transform-handle overlay in sync with the moved element
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
    let startX = 0;
    let startY = 0;
    let startCanvasX = 0;
    let startCanvasY = 0;
    
const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Left click only
    
    // Don't start drag if clicking on transform handles
    if (e.target.closest('.transform-handles')) return;
    
    // Check if we're in the right tool mode
    if (this.editor.currentTool === ToolType.HAND || 
        this.editor.currentTool === ToolType.ZOOM ||
        this.editor.currentTool === ToolType.COLOR_PICKER) {
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // Select this layer if not already selected
    if (this.editor.layerManager.activeLayerId !== this.layer.id) {
        dbg('🎯 Selecting layer and starting drag immediately');
        this.editor.layerManager.setActiveLayer(this.layer.id);
    }
    
    // ALWAYS start dragging (whether we just selected or it was already selected)
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    
    const canvasPos = this.editor.viewport.screenToCanvas(startX, startY);
    startCanvasX = canvasPos.x;
    startCanvasY = canvasPos.y;
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
};
    
const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    e.preventDefault();
    
    // Convert current mouse position to canvas coordinates
    const currentCanvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
    
    // Calculate delta from last position
    const deltaX = currentCanvasPos.x - startCanvasX;
    const deltaY = currentCanvasPos.y - startCanvasY;
    
    // Get current transform
    const transform = this.getTransform();
    
    // Apply delta to current position
    this.updateTransform({
        position: {
            x: transform.position.x + deltaX,
            y: transform.position.y + deltaY
        }
    });
    
    // ✅ CRITICAL: Update start position for next frame
    // Without this, delta accumulates and sticker flies away!
    startCanvasX = currentCanvasPos.x;
    startCanvasY = currentCanvasPos.y;
    
    // CRITICAL FIX: Ensure we have a valid element reference
    // If this.element is null (e.g., after selection re-render), get fresh reference
    if (!this.element) {
        const layerElement = this.refreshElementReference();
        if (layerElement) {
            dbg('✅ Refreshed element reference in mousemove');
            this.element = layerElement;
        }
    }
    
    // Re-apply transform to the CURRENT element
    const dimensions = this.getDimensions();
    this.applyTransform(this.element, dimensions);
    
    // CRITICAL FIX: Ensure handles exist before trying to update them
    // If they don't exist yet (first drag after selection), create them
    if (!this.transformHandles && this.editor.currentTool === ToolType.SELECT && CONFIG.stickerHandles.enabled) {
        dbg('✅ Creating handles on first mousemove');
        this.createTransformHandles();
    }
    
    // Update handle positions during drag
    if (this.transformHandles) {
        this.updateHandlePositions();
    }
    
    // Update settings UI if available
    if (this.layer.type === LayerType.STICKER || this.layer.type === LayerType.TEXT_GLITTER) {
        this.scheduleSettingsSync();
    }
};
    
    const handleMouseUp = (e) => {
        if (!isDragging) return;

        isDragging = false;
        this.editor.saveState();
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
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
        const nextScaleX = Math.max(10, Math.min(500, currentScaleX * gestureDelta.scale));
        const nextScaleY = transform.proportionalScale
            ? nextScaleX
            : Math.max(10, Math.min(500, currentScaleY * gestureDelta.scale));
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
     * Only works when CONFIG.stickerHandles.enabled is true
     */
createTransformHandles() {
    // Check if handles are enabled
    if (!CONFIG.stickerHandles.enabled) return;
    
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
    container.appendChild(boundingBox);
    
    // Create corner handles
    const corners = ['tl', 'tr', 'br', 'bl'];
    corners.forEach(corner => {
        const handleWrapper = document.createElement('div');
        handleWrapper.className = 'transform-handle-wrapper';
        handleWrapper.dataset.handleType = `corner-${corner}`;
        
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
        const config = CONFIG.stickerHandles;

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

        // Corner positions in local space (before rotation)
        const corners = {
            tl: { x: -hw, y: -hh },
            tr: { x: hw, y: -hh },
            br: { x: hw, y: hh },
            bl: { x: -hw, y: hh }
        };

        const edges = {
            top: { x: 0, y: -hh },
            right: { x: hw, y: 0 },
            bottom: { x: 0, y: hh },
            left: { x: -hw, y: 0 }
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
        const topCenterLocal = { x: 0, y: -hh - config.rotationHandleDistance };
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

            const lineLength = config.rotationHandleDistance;
            const lineAngle = transform.rotation;

            rotationLine.style.cssText = `
				position: absolute;
				left: ${topBox.x}px;
				top: ${topBox.y}px;
				width: ${config.boundingBoxWidth}px;
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
                if (e.pointerType === 'mouse' && e.button !== 0) {
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
                    textBoxFrame: this.editor.textGlitterManager?.getFixedBoxFrame?.(this.layer) ?? null
                };
            });

            handle.addEventListener('pointermove', this.handleHandlePointerMove);
            handle.addEventListener('pointerup', this.handleHandlePointerUp);
            handle.addEventListener('pointercancel', this.handleHandlePointerUp);
        });
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
            this.handleCornerDrag(e);
        } else if (this.activeHandleType.startsWith('edge-')) {
            this.handleEdgeResizeDrag(e);
        } else if (this.activeHandleType === 'rotation') {
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
    handleHandlePointerUp(e) {
        if (e.pointerId !== this.activeHandlePointerId) {
            return;
        }

        if (this.isDraggingHandle) {
            e.preventDefault();
            e.stopPropagation();
            // Shapes are parametric: bake a committed scale into pixel size and
            // re-rasterize so large shapes stay crisp (no upscaled-raster mixels).
            const ht = this.activeHandleType || '';
            // Clear the drag flag before committing so ShapeGlitterManager.renderLayer()'s
            // handle-refresh guard doesn't skip rebuilding the (now differently-sized) box.
            this.isDraggingHandle = false;
            if (this.layer.type === LayerType.SHAPE && (ht.startsWith('corner-') || ht.startsWith('edge-'))) {
                this.editor.shapeGlitterManager?.commitScale(this.layer);
            }
            this.editor.saveState();

            if (e.pointerType === 'mouse') {
                this.editor.ignoreNextClick = true;
                setTimeout(() => {
                    this.editor.ignoreNextClick = false;
                }, 150);
            }
        }

        this.activeHandleElement?.releasePointerCapture?.(e.pointerId);
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

        const newX = this.dragStartState.transform.position.x + deltaX;
        const newY = this.dragStartState.transform.position.y + deltaY;

        this.updateTransform({
            position: { x: newX, y: newY }
        });

        // Re-apply transform to element
        const dimensions = this.getDimensions();
        this.applyTransform(this.element, dimensions);

        this.updateHandlePositions();
    }

    /**
     * Handle dragging of corner handles (scale)
     */
    handleCornerDrag(e) {
        // Corners always SCALE — point and box text alike (box resizing is the
        // edge handles' job). Measured against the handle frame, which for text
        // is the visible frame (ink or box), not the padded mask canvas.
        const transform = this.getTransform();
        const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
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

        // Convert to scale percentage against the frame's local size
        const newScaleX = (Math.abs(localX) * 2 / frame.width) * 100;
        const newScaleY = transform.proportionalScale
            ? newScaleX
            : (Math.abs(localY) * 2 / frame.height) * 100;

        // Clamp values
        const clampedScaleX = Math.max(10, Math.min(500, newScaleX));
        const clampedScaleY = Math.max(10, Math.min(500, newScaleY));

        this.updateTransform({
            scale: {
                x: clampedScaleX,
                y: clampedScaleY
            }
        });

        // Re-apply transform to element
        const dimensions = this.getDimensions();
        this.applyTransform(this.element, dimensions);

        this.updateHandlePositions();
    }

    handleEdgeResizeDrag(e) {
        const edge = this.activeHandleType.replace('edge-', '');

        // Shapes: an edge handle scales ONE axis (non-uniform), mirroring the
        // corner-scale math but for a single dimension. Baked to a crisp pixel
        // size on release (see handleHandlePointerUp → commitScale).
        if (this.layer.type === LayerType.SHAPE) {
            this.handleShapeEdgeResize(e, edge);
            return;
        }

        const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);

        if (!this.editor.textGlitterManager?.resizeBoxFromHandle) {
            return;
        }

        const didResize = this.editor.textGlitterManager.resizeBoxFromHandle(
            this.layer,
            edge,
            this.dragStartState,
            canvasPos
        );

        if (!didResize) {
            return;
        }

        this.element = this.editor.textGlitterManager.layerElements.get(this.layer.id) || this.element;
        const dimensions = this.getDimensions();
        this.applyTransform(this.element, dimensions);
        this.updateHandlePositions();
    }

    // One-axis scale for a shape edge handle (left/right → scaleX, top/bottom →
    // scaleY). Same local-space projection as handleCornerDrag.
    handleShapeEdgeResize(e, edge) {
        const transform = this.getTransform();
        const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
        const start = this.dragStartState;
        const frame = { width: start.width, height: start.height };

        const worldRotationRad = (transform.rotation * Math.PI) / 180;
        const centerX = start.transform.position.x;
        const centerY = start.transform.position.y;
        const vectorX = canvasPos.x - centerX;
        const vectorY = canvasPos.y - centerY;
        const cos = Math.cos(-worldRotationRad);
        const sin = Math.sin(-worldRotationRad);
        const localX = vectorX * cos - vectorY * sin;
        const localY = vectorX * sin + vectorY * cos;

        const isHorizontal = edge === 'left' || edge === 'right';
        const scale = {
            x: transform.scale.x,
            y: transform.scale.y
        };
        if (isHorizontal) {
            scale.x = Math.max(10, Math.min(500, (Math.abs(localX) * 2 / frame.width) * 100));
        } else {
            scale.y = Math.max(10, Math.min(500, (Math.abs(localY) * 2 / frame.height) * 100));
        }

        this.updateTransform({ scale });
        this.applyTransform(this.element, this.getDimensions());
        this.updateHandlePositions();
    }

    /**
     * Handle dragging of rotation handle
     */
    handleRotationDrag(e) {
        const transform = this.getTransform();
        const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);

        // Calculate angle from center to mouse
        const centerX = transform.position.x;
        const centerY = transform.position.y;
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

        // Clear element reference
        this.element = null;
    }
}
