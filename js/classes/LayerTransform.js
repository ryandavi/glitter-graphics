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
		this.dragStartState = null;
		this.isDraggingHandle = false;
		
		// Bind methods for event listeners
		this.handleMouseMove = this.handleMouseMove.bind(this);
		this.handleMouseUp = this.handleMouseUp.bind(this);
	}
	
	// ===== CORE TRANSFORM APPLICATION =====
	
	/**
	 * Apply CSS transform to a DOM element based on layer transform data
	 * Works with any layer that has a transform object with: position, rotation, scale, opacity, flipX, flipY
	 * @param {HTMLElement} element - DOM element to transform
	 * @param {Object} dimensions - Object with width/height properties (natural size)
	 */
	applyTransform(element, dimensions) {
		const transform = this.getTransform();
		
		// Calculate actual display size
		const displayWidth = dimensions.width * (transform.scale.x / 100);
		const displayHeight = dimensions.height * (transform.scale.y / 100);
		
		// Build transform array
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
		
		// Apply styles
		element.style.cssText = `
			position: absolute;
			width: ${displayWidth}px;
			height: ${displayHeight}px;
			transform: ${transforms.join(' ')};
			opacity: ${transform.opacity / 100};
			pointer-events: ${pointerEvents};
			display: ${this.layer.visible ? 'block' : 'none'};
			z-index: ${this.editor.layerManager.getLayerZIndex(this.layer.id)};
		`;
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
			transform.rotation = CONFIG.roundStickerTransforms ? Math.round(updates.rotation) : updates.rotation;
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
		
		// Update transform handles if they exist
		if (this.transformHandles) {
			this.updateHandlePositions();
		}
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
		throw new Error('Layer does not have dimensions');
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
				this.editor.layerManager.setActiveLayer(this.layer.id);
			}
			
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
			
			// Re-apply transform to element
			const dimensions = this.getDimensions();
			this.applyTransform(element, dimensions);
			
			// Update settings UI if available
			if (this.editor.loadStickerSettings && this.layer.type === LayerType.STICKER) {
				this.editor.loadStickerSettings(this.layer);
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
	
	// ===== TOUCH GESTURE HANDLING =====
	
	/**
	 * Setup touch gestures for an element (pan, pinch, rotate)
	 * @param {HTMLElement} element - Element to make touch-interactive
	 */
	setupTouchGestures(element) {
		// Remove any existing gesture handler
		if (element._touchHandler) {
			element._touchHandler.destroy();
		}
		
		const viewport = this.editor.viewport;
		let startTransform = null;
		
		const handler = new TouchGestureHandler(element, {
			// CRITICAL: Don't prevent default when using non-SELECT tools
			// This allows simple taps to pass through to the canvas
			preventPropagation: false,  // Let events bubble up
			
			// Skip sticker touches entirely when not in SELECT tool
			shouldIgnoreTarget: (target) => {
				if (this.editor.currentTool !== ToolType.SELECT) {
					console.log('🎯 LayerTransform: Ignoring touch - not SELECT tool');
					return true;  // Let the touch pass through to canvas
				}
				return false;
			},
			
			onGestureStart: (gestureType) => {
				// Double-check tool mode (already filtered by shouldIgnoreTarget)
				if (this.editor.currentTool !== ToolType.SELECT) {
					return;
				}
				
				const isSelected = this.editor.layerManager.activeLayerId === this.layer.id;
				
				// Store transform state on gesture start
				const transform = this.getTransform();
				startTransform = {
					scale: { ...transform.scale },
					rotation: transform.rotation,
					position: { ...transform.position }
				};
				
				// Select layer if not already selected
				if (!isSelected) {
					this.editor.layerManager.setActiveLayer(this.layer.id);
				}
			},
			
			onSinglePan: (deltaX, deltaY, touchX, touchY) => {
				const isSelected = this.editor.layerManager.activeLayerId === this.layer.id;
				if (!isSelected || !startTransform) return;
				
				// Convert screen delta to canvas coordinates
				const canvasDeltaX = deltaX / viewport.currentZoom;
				const canvasDeltaY = deltaY / viewport.currentZoom;
				
				const transform = this.getTransform();
				this.updateTransform({
					position: {
						x: transform.position.x + canvasDeltaX,
						y: transform.position.y + canvasDeltaY
					}
				});
				
				// Re-apply transform to element
				const dimensions = this.getDimensions();
				this.applyTransform(element, dimensions);
				
				// Update settings UI if available
				if (this.editor.loadStickerSettings && this.layer.type === LayerType.STICKER) {
					this.editor.loadStickerSettings(this.layer);
				}
			},
			
			onPinchZoom: (scale, centerX, centerY) => {
				const isSelected = this.editor.layerManager.activeLayerId === this.layer.id;
				if (!isSelected || !startTransform) return;
				
				const transform = this.getTransform();
				const currentScaleX = transform.scale.x;
				const currentScaleY = transform.scale.y;
				
				const newScaleX = currentScaleX * scale;
				const newScaleY = transform.proportionalScale 
					? newScaleX 
					: currentScaleY * scale;
				
				// Clamp scale values
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
				this.applyTransform(element, dimensions);
				
				// Update settings UI if available
				if (this.editor.loadStickerSettings && this.layer.type === LayerType.STICKER) {
					this.editor.loadStickerSettings(this.layer);
				}
			},
			
			onRotate: (angleDelta, centerX, centerY) => {
				const isSelected = this.editor.layerManager.activeLayerId === this.layer.id;
				if (!isSelected || !startTransform) return;
				
				const transform = this.getTransform();
				const newRotation = (transform.rotation + angleDelta) % 360;
				
				this.updateTransform({
					rotation: newRotation
				});
				
				// Re-apply transform to element
				const dimensions = this.getDimensions();
				this.applyTransform(element, dimensions);
				
				// Update settings UI if available
				if (this.editor.loadStickerSettings && this.layer.type === LayerType.STICKER) {
					this.editor.loadStickerSettings(this.layer);
				}
			},
			
			onGestureEnd: () => {
				if (startTransform) {
					this.editor.saveState();
				}
				startTransform = null;
			}
		});
		
		// Store handler on element for cleanup
		element._touchHandler = handler;
		element.style.touchAction = 'none';
		
		// Save state when all touches are released
		element.addEventListener('touchend', (e) => {
			if (e.touches.length === 0) {
				this.editor.saveState();
			}
		});
	}
	
	// ===== TRANSFORM HANDLES (DESKTOP ONLY) =====
	
	/**
	 * Create visual transform handles for desktop interaction
	 * Only works when CONFIG.stickerHandles.enabled is true
	 */
	createTransformHandles() {
		// Check if handles are enabled
		if (!CONFIG.stickerHandles.enabled) return;
		
		// Don't show handles on mobile
		if (this.editor.mobileManager && this.editor.mobileManager.isMobile) {
			return;
		}
		
		// Only create handles in SELECT tool mode
		if (this.editor.currentTool !== ToolType.SELECT) return;
		
		// Remove existing handles first
		this.removeTransformHandles();
		
		// Disable pointer events on the element itself when handles are active
		if (this.element) {
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
		
		// Position handles
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
		const dimensions = this.getDimensions();
		const config = CONFIG.stickerHandles;
		
		// Calculate display dimensions
		const displayWidth = dimensions.width * (transform.scale.x / 100);
		const displayHeight = dimensions.height * (transform.scale.y / 100);
		
		// Get rotation in radians
		const rotationRad = (transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);
		
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
		
		// Rotate corners and translate to position
		const rotatedCorners = {};
		Object.keys(corners).forEach(key => {
			const local = corners[key];
			rotatedCorners[key] = {
				x: transform.position.x + (local.x * cos - local.y * sin),
				y: transform.position.y + (local.x * sin + local.y * cos)
			};
		});
		
		// Position bounding box
		const boundingBox = this.transformHandles.querySelector('.transform-bounding-box');
		if (boundingBox) {
			boundingBox.style.cssText = `
				position: absolute;
				left: ${transform.position.x}px;
				top: ${transform.position.y}px;
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
		
		// Position rotation handle (above top center)
		const topCenterLocal = { x: 0, y: -hh - config.rotationHandleDistance };
		const topCenter = {
			x: transform.position.x + (topCenterLocal.x * cos - topCenterLocal.y * sin),
			y: transform.position.y + (topCenterLocal.x * sin + topCenterLocal.y * cos)
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
				x: transform.position.x + (topBoxLocal.x * cos - topBoxLocal.y * sin),
				y: transform.position.y + (topBoxLocal.x * sin + topBoxLocal.y * cos)
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
		if (this.transformHandles) {
			// Re-enable pointer events on element
			if (this.element) {
				this.element.classList.remove('has-transform-handles');
			}
			
			if (this.transformHandles.parentNode) {
				this.transformHandles.parentNode.removeChild(this.transformHandles);
			}
		}
		this.transformHandles = null;
		this.activeHandleType = null;
		this.dragStartState = null;
	}
	
	/**
	 * Attach mouse event listeners to transform handles
	 */
	attachHandleListeners() {
		if (!this.transformHandles) return;
		
		const handles = this.transformHandles.querySelectorAll('[data-handle-type]');
		
		handles.forEach(handle => {
			const handleType = handle.dataset.handleType;
			
			handle.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				
				this.activeHandleType = handleType;
				this.isDraggingHandle = true;
				
				const transform = this.getTransform();
				const dimensions = this.getDimensions();
				
				// Store initial state
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
					height: dimensions.height
				};
				
				// Attach global listeners
				document.addEventListener('mousemove', this.handleMouseMove);
				document.addEventListener('mouseup', this.handleMouseUp);
			});
		});
	}
	
	/**
	 * Handle mouse move during handle drag
	 */
	handleMouseMove(e) {
		if (!this.activeHandleType || !this.dragStartState) return;
		
		if (this.activeHandleType.startsWith('corner-')) {
			this.handleCornerDrag(e);
		} else if (this.activeHandleType === 'rotation') {
			this.handleRotationDrag(e);
		} else if (this.activeHandleType === 'move') {
			this.handleMoveDrag(e);
		}
		
		// Update UI if available
		if (this.editor.loadStickerSettings && this.layer.type === LayerType.STICKER) {
			this.editor.loadStickerSettings(this.layer);
		}
	}
	
	/**
	 * Handle mouse up to end handle drag
	 */
	handleMouseUp(e) {
		if (this.isDraggingHandle) {
			e.preventDefault();
			e.stopPropagation();
			this.editor.saveState();
			
			// Set flag to prevent click handling
			this.editor.ignoreNextClick = true;
			setTimeout(() => {
				this.editor.ignoreNextClick = false;
			}, 150);
		}
		
		this.activeHandleType = null;
		this.dragStartState = null;
		this.isDraggingHandle = false;
		
		document.removeEventListener('mousemove', this.handleMouseMove);
		document.removeEventListener('mouseup', this.handleMouseUp);
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
		const transform = this.getTransform();
		const canvasPos = this.editor.viewport.screenToCanvas(e.clientX, e.clientY);
		
		// Get vector from center to mouse in canvas space
		const centerX = transform.position.x;
		const centerY = transform.position.y;
		const vectorX = canvasPos.x - centerX;
		const vectorY = canvasPos.y - centerY;
		
		// Rotate vector back to local space
		const rotationRad = -(transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);
		const localX = vectorX * cos - vectorY * sin;
		const localY = vectorX * sin + vectorY * cos;
		
		// Calculate new scale based on corner
		const corner = this.activeHandleType.replace('corner-', '');
		const startWidth = this.dragStartState.width * (this.dragStartState.transform.scale.x / 100);
		const startHeight = this.dragStartState.height * (this.dragStartState.transform.scale.y / 100);
		
		let newWidth, newHeight;
		
		// Determine new dimensions based on which corner
		if (corner === 'br' || corner === 'tr') {
			newWidth = Math.abs(localX) * 2;
		} else {
			newWidth = Math.abs(localX) * 2;
		}
		
		if (corner === 'br' || corner === 'bl') {
			newHeight = Math.abs(localY) * 2;
		} else {
			newHeight = Math.abs(localY) * 2;
		}
		
		// Convert to scale percentage
		const newScaleX = (newWidth / this.dragStartState.width) * 100;
		const newScaleY = transform.proportionalScale 
			? newScaleX 
			: (newHeight / this.dragStartState.height) * 100;
		
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
	
	/**
	 * Cleanup - remove all event listeners and DOM elements
	 */
	destroy() {
		// Remove touch handler if it exists
		if (this.element && this.element._touchHandler) {
			this.element._touchHandler.destroy();
		}
		
		// Remove transform handles
		this.removeTransformHandles();
		
		// Clear element reference
		this.element = null;
	}
}