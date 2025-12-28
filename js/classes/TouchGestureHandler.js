// ============================================
// TOUCH GESTURE HANDLER CLASS
// Reusable touch gesture state machine for viewport and sticker interactions
// Prevents gesture conflicts with proper locking and state transitions
// ============================================

class TouchGestureHandler {
	constructor(element, callbacks = {}) {
		this.element = element;
		this.callbacks = callbacks;

		// Gesture state machine
		this.state = 'idle'; // idle, single_pan, pinch_zoom, two_pan
		this.gestureLockedUntilRelease = false;

		// Touch tracking
		this.touches = new Map();

		// Touch count stability tracking (prevents false single-touch detection)
		this.touchCountHistory = []; // Last few frames
		this.historyLength = 3; // Number of frames to average
		this.stableTouchCount = 0;

		// Gesture data
		this.startData = {
			distance: 0,
			angle: 0,
			centerX: 0,
			centerY: 0
		};

		this.lastData = {
			distance: 0,
			angle: 0,
			centerX: 0,
			centerY: 0
		};

		// Configuration
		this.minPinchMovement = 10;
		this.rotationEnabled = callbacks.onRotate !== undefined;
		this.preventPropagation = callbacks.preventPropagation !== false; // Default true

		this.setupEventListeners();
	}

setupEventListeners() {
	const capturePhase = this.callbacks.capturePhase || false;
	this.element.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false, capture: capturePhase });
	this.element.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false, capture: capturePhase });
	this.element.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false, capture: capturePhase });
	this.element.addEventListener('touchcancel', (e) => this.handleTouchCancel(e), { passive: false, capture: capturePhase });
}

	// Update touch count with stability checking
	updateStableTouchCount() {
		this.touchCountHistory.push(this.touches.size);

		if (this.touchCountHistory.length > this.historyLength) {
			this.touchCountHistory.shift();
		}

		// Use the maximum count from recent history
		// This prevents momentary single-touch false positives
		this.stableTouchCount = Math.max(...this.touchCountHistory);
	}

handleTouchStart(e) {
	// CRITICAL: Stop propagation for sticker elements
	if (this.preventPropagation) {
		e.stopPropagation();
	}
	
	// ALWAYS prevent default for viewport touch gestures
	if (!this.preventPropagation && e.touches.length >= 2) {
		e.preventDefault();
	}

	// NEW: If this is a viewport handler and touch started on a sticker, ignore it
	if (!this.preventPropagation && this.callbacks.capturePhase) {
		// Check if any touch is starting on a sticker element
		for (let touch of e.changedTouches) {
			const target = document.elementFromPoint(touch.clientX, touch.clientY);
			if (target && target.closest('.sticker-element')) {
				console.log('🌍 VIEWPORT: Ignoring touch on sticker element');
				return; // Don't process this touch at all
			}
		}
	}

	// Add all new touches to our tracking
	for (let touch of e.changedTouches) {
		this.touches.set(touch.identifier, {
			x: touch.clientX,
			y: touch.clientY,
			startX: touch.clientX,
			startY: touch.clientY,
			prevX: touch.clientX,
			prevY: touch.clientY
		});
	}

		this.updateStableTouchCount();
		const touchCount = this.stableTouchCount;

		// If we're already in a gesture, don't start a new one
		if (this.gestureLockedUntilRelease) {
			e.preventDefault();
			return;
		}

		// Determine gesture type based on stable touch count
		if (touchCount === 1) {
			this.startSinglePan();
		} else if (touchCount >= 2) {
			e.preventDefault();
			this.startTwoFingerGesture();
		}
	}

	handleTouchMove(e) {
		// CRITICAL: Stop propagation for sticker elements
		if (this.preventPropagation) {
			e.stopPropagation();
		}

		// Update all touch positions
		for (let touch of e.changedTouches) {
			const tracked = this.touches.get(touch.identifier);
			if (tracked) {
				tracked.prevX = tracked.x;
				tracked.prevY = tracked.y;
				tracked.x = touch.clientX;
				tracked.y = touch.clientY;
			}
		}

		this.updateStableTouchCount();
		const touchCount = this.stableTouchCount;

		// CRITICAL: Once in a two-finger gesture, STAY in it
		// Don't switch to single-pan even if touch count momentarily drops
		if (this.state === 'pinch_zoom' || this.state === 'two_pan') {
			// Only process if we have at least 2 touches in our Map
			if (this.touches.size >= 2) {
				e.preventDefault();
				this.updateTwoFingerGesture();
			}
			// If touch count drops below 2, just skip this frame
			return;
		}

		// Process single-pan
		if (this.state === 'single_pan' && touchCount === 1) {
			e.preventDefault();
			this.updateSinglePan();
		}
	}

	handleTouchEnd(e) {
		// CRITICAL: Stop propagation for sticker elements
		if (this.preventPropagation) {
			e.stopPropagation();
		}

		// Remove ended touches
		for (let touch of e.changedTouches) {
			this.touches.delete(touch.identifier);
		}

		this.updateStableTouchCount();
		const touchCount = this.touches.size;

		// If all touches are released, reset completely
		if (touchCount === 0) {
			this.state = 'idle';
			this.gestureLockedUntilRelease = false;
			this.touchCountHistory = [];
			this.stableTouchCount = 0;

			if (this.callbacks.onGestureEnd) {
				this.callbacks.onGestureEnd();
			}
		}
		// REMOVED: The "else if" that locked gesture when dropping below 2 fingers
		// This was preventing viewport pinch zoom after sticker interaction
	}

	handleTouchCancel(e) {
		// Treat cancel the same as end
		this.handleTouchEnd(e);
	}

	// ===== SINGLE FINGER PAN =====

	startSinglePan() {
		this.state = 'single_pan';
		this.gestureLockedUntilRelease = true;

		if (this.callbacks.onGestureStart) {
			this.callbacks.onGestureStart('single_pan');
		}
	}

	updateSinglePan() {
		const touch = Array.from(this.touches.values())[0];
		if (!touch) return;

		const incrementalDeltaX = touch.x - touch.prevX;
		const incrementalDeltaY = touch.y - touch.prevY;

		if (this.callbacks.onSinglePan) {
			this.callbacks.onSinglePan(incrementalDeltaX, incrementalDeltaY, touch.x, touch.y);
		}
	}

	// ===== TWO FINGER GESTURES =====

	startTwoFingerGesture() {
		const touchArray = Array.from(this.touches.values());
		if (touchArray.length < 2) return;

		const [touch1, touch2] = touchArray;

		// Calculate initial metrics
		this.startData.distance = this.getTouchDistance(touch1, touch2);
		this.startData.angle = this.getTouchAngle(touch1, touch2);
		this.startData.centerX = (touch1.x + touch2.x) / 2;
		this.startData.centerY = (touch1.y + touch2.y) / 2;

		// Copy to lastData
		this.lastData = { ...this.startData };

		// Start in two_pan state, we'll switch to pinch if needed
		this.state = 'two_pan';
		this.gestureLockedUntilRelease = true;

		if (this.callbacks.onGestureStart) {
			this.callbacks.onGestureStart('two_finger');
		}
	}

	updateTwoFingerGesture() {
		const touchArray = Array.from(this.touches.values());
		if (touchArray.length < 2) return;

		const [touch1, touch2] = touchArray;

		// Calculate current metrics
		const currentDistance = this.getTouchDistance(touch1, touch2);
		const currentAngle = this.getTouchAngle(touch1, touch2);
		const currentCenterX = (touch1.x + touch2.x) / 2;
		const currentCenterY = (touch1.y + touch2.y) / 2;

		// Determine if we're pinching based on distance change
		const distanceChange = Math.abs(currentDistance - this.startData.distance);
		const isPinching = distanceChange > this.minPinchMovement;

		// Transition state if needed (only once)
		if (this.state === 'two_pan' && isPinching) {
			this.state = 'pinch_zoom';
		}

		// Process based on state
		if (this.state === 'pinch_zoom') {
			// Calculate scale change since last frame
			const scale = currentDistance / this.lastData.distance;

			// Only apply if scale change is meaningful (prevents jitter)
			if (Math.abs(scale - 1.0) > 0.001) {
				if (this.callbacks.onPinchZoom) {
					this.callbacks.onPinchZoom(scale, currentCenterX, currentCenterY);
				}
			}

			// Handle rotation if enabled
			if (this.rotationEnabled && this.callbacks.onRotate) {
				const angleDelta = currentAngle - this.lastData.angle;
				// Normalize angle delta to -180 to 180 range
				const normalizedDelta = ((angleDelta + 180) % 360) - 180;

				if (Math.abs(normalizedDelta) > 0.5) {
					this.callbacks.onRotate(normalizedDelta, currentCenterX, currentCenterY);
				}
			}
		} else if (this.state === 'two_pan') {
			// Two-finger pan
			const deltaX = currentCenterX - this.lastData.centerX;
			const deltaY = currentCenterY - this.lastData.centerY;

			// Only apply if movement is meaningful
			if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
				if (this.callbacks.onTwoPan) {
					this.callbacks.onTwoPan(deltaX, deltaY, currentCenterX, currentCenterY);
				}
			}
		}

		// Update last data
		this.lastData.distance = currentDistance;
		this.lastData.angle = currentAngle;
		this.lastData.centerX = currentCenterX;
		this.lastData.centerY = currentCenterY;
	}

	// ===== UTILITY METHODS =====

	getTouchDistance(touch1, touch2) {
		const dx = touch2.x - touch1.x;
		const dy = touch2.y - touch1.y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	getTouchAngle(touch1, touch2) {
		const dx = touch2.x - touch1.x;
		const dy = touch2.y - touch1.y;
		return Math.atan2(dy, dx) * (180 / Math.PI);
	}

	// ===== PUBLIC API =====

	isActive() {
		return this.state !== 'idle';
	}

	getCurrentState() {
		return this.state;
	}

	reset() {
		this.touches.clear();
		this.state = 'idle';
		this.gestureLockedUntilRelease = false;
		this.touchCountHistory = [];
		this.stableTouchCount = 0;
	}

	destroy() {
		this.element.removeEventListener('touchstart', this.handleTouchStart);
		this.element.removeEventListener('touchmove', this.handleTouchMove);
		this.element.removeEventListener('touchend', this.handleTouchEnd);
		this.element.removeEventListener('touchcancel', this.handleTouchCancel);
		this.reset();
	}
}