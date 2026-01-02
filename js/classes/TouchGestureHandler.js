// ============================================
// TOUCH GESTURE HANDLER CLASS
// Reusable touch gesture state machine for viewport and sticker interactions
// Prevents gesture conflicts with proper locking and state transitions
// NOW WITH SIMPLE TAP DETECTION
// ============================================

class TouchGestureHandler {
    constructor(element, callbacks = {}) {
        this.element = element;
        this.callbacks = callbacks;
        
        // State
        this.state = 'idle';
        this.touches = new Map();
        
        // TAP vs PAN Thresholds
        // We allow a little wiggle room (slop) before deciding it's a drag
        this.tapThreshold = 10; 
        this.isPotentialTap = false;
        this.tapStartPosition = { x: 0, y: 0 };
        this.tapStartTime = 0;

        // Gestures
        this.startData = { distance: 0, angle: 0, centerX: 0, centerY: 0 };
        this.lastData = { distance: 0, angle: 0, centerX: 0, centerY: 0 };
        
        // Settings
        this.preventPropagation = callbacks.preventPropagation !== false;

        this.setupEventListeners();
    }

    setupEventListeners() {
        const opt = { passive: false, capture: this.callbacks.capturePhase || false };
        this.element.addEventListener('touchstart', this.handleTouchStart.bind(this), opt);
        this.element.addEventListener('touchmove', this.handleTouchMove.bind(this), opt);
        this.element.addEventListener('touchend', this.handleTouchEnd.bind(this), opt);
        this.element.addEventListener('touchcancel', this.handleTouchEnd.bind(this), opt);
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
        if (this.preventPropagation) e.stopPropagation();
        
        // Prevent default browser zooming/scrolling immediately
        if (e.cancelable) e.preventDefault();

        // Track new touches
        for (let touch of e.changedTouches) {
            this.touches.set(touch.identifier, {
                x: touch.clientX, y: touch.clientY,
                startX: touch.clientX, startY: touch.clientY
            });
        }

        const touchCount = this.touches.size;

        if (touchCount === 1) {
            // SINGLE FINGER: Could be a tap, could be a start of a pan
            const t = Array.from(this.touches.values())[0];
            this.isPotentialTap = true;
            this.tapStartPosition = { x: t.x, y: t.y };
            this.tapStartTime = Date.now();
            this.state = 'checking_tap'; // Wait to see if they move
        } else if (touchCount >= 2) {
            // TWO FINGERS: Immediate gesture
            this.isPotentialTap = false;
            this.startTwoFingerGesture();
        }
    }

    handleTouchMove(e) {
        if (this.preventPropagation) e.stopPropagation();
        if (e.cancelable) e.preventDefault();

        // Update stored touch coordinates
        for (let touch of e.changedTouches) {
            const stored = this.touches.get(touch.identifier);
            if (stored) {
                stored.x = touch.clientX;
                stored.y = touch.clientY;
            }
        }

        const touchCount = this.touches.size;

        // 1. HANDLE SINGLE FINGER PAN logic
        if (touchCount === 1) {
            const t = Array.from(this.touches.values())[0];
            const dx = t.x - t.startX;
            const dy = t.y - t.startY;
            const moveDist = Math.sqrt(dx*dx + dy*dy);

            // If we moved past threshold, it is no longer a tap. It is a Pan.
            if (this.state === 'checking_tap' && moveDist > this.tapThreshold) {
                this.isPotentialTap = false;
                this.startSinglePan(); // Upgrade state to single_pan
            }

            if (this.state === 'single_pan') {
                // Calculate delta since LAST frame (not start)
                // Note: You need to track prevX/prevY in real implementation, simplified here
                this.updateSinglePan(); 
            }
        }
        // 2. HANDLE TWO FINGER logic
        else if (touchCount >= 2 && (this.state === 'two_pan' || this.state === 'pinch_zoom')) {
            this.updateTwoFingerGesture();
        }
    }

    handleTouchEnd(e) {
        if (this.preventPropagation) e.stopPropagation();
        
        // Check for Tap BEFORE removing touches
        if (this.isPotentialTap && this.touches.size === 1) {
            const t = Array.from(this.touches.values())[0];
            const duration = Date.now() - this.tapStartTime;
            
            // If it was short and didn't move much
            if (duration < 300) { // 300ms max for a tap
                 if (this.callbacks.onSimpleTap) {
                     // Pass the final coordinates
                     this.callbacks.onSimpleTap(t.x, t.y);
                 }
            }
        }

        // Cleanup
        for (let touch of e.changedTouches) {
            this.touches.delete(touch.identifier);
        }

        if (this.touches.size === 0) {
            this.reset();
            if (this.callbacks.onGestureEnd) this.callbacks.onGestureEnd();
        }
    }

	handleTouchCancel(e) {
		// Treat cancel the same as end
		this.handleTouchEnd(e);
	}

	// ===== SINGLE FINGER PAN =====

    startSinglePan() {
        this.state = 'single_pan';
        if (this.callbacks.onGestureStart) this.callbacks.onGestureStart('single_pan');
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
	this.everEnteredGesture = true; // NEW: We started two-finger gesture

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

		console.log('✌️ Two-finger state:', this.state, 'distance change:', distanceChange, 'isPinching:', isPinching);

		// Transition state if needed (only once)
		if (this.state === 'two_pan' && isPinching) {
			console.log('✌️ Transitioning from two_pan to pinch_zoom');
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

			console.log('✌️ Two-pan delta:', deltaX, deltaY);

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

	wasSimpleTap() {
		return this.isSimpleTap;
	}

	reset() {
		this.touches.clear();
		this.state = 'idle';
		this.gestureLockedUntilRelease = false;
		this.touchCountHistory = [];
		this.stableTouchCount = 0;
		this.isSimpleTap = true;
		this.totalMovement = 0;
	}

	destroy() {
		this.element.removeEventListener('touchstart', this.handleTouchStart);
		this.element.removeEventListener('touchmove', this.handleTouchMove);
		this.element.removeEventListener('touchend', this.handleTouchEnd);
		this.element.removeEventListener('touchcancel', this.handleTouchCancel);
		this.reset();
	}
}