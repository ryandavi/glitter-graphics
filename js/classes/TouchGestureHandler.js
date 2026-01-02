class TouchGestureHandler {
    constructor(element, callbacks = {}) {
        this.element = element;
        this.callbacks = callbacks;
        
        // State
        this.state = 'idle'; // idle, pending, panning, pinching
        this.touches = new Map();
        
        // Tap Data
        this.startPos = { x: 0, y: 0 };
        this.startTime = 0;
        
        // Two Finger Data
        this.lastDist = 0;
        this.lastCenter = { x: 0, y: 0 };

        // Config
        this.tapThreshold = 10; // pixels

        this.setupEventListeners();
    }

    setupEventListeners() {
        const opt = { passive: false, capture: true };
        this.element.addEventListener('touchstart', this.handleStart.bind(this), opt);
        this.element.addEventListener('touchmove', this.handleMove.bind(this), opt);
        this.element.addEventListener('touchend', this.handleEnd.bind(this), opt);
        this.element.addEventListener('touchcancel', this.handleEnd.bind(this), opt);
    }

    handleStart(e) {
        // 1. Prevent Default immediately to stop browser scrolling/zooming/native-clicks
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();

        // 2. Track touches
        for (let t of e.changedTouches) {
            this.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }

        const count = this.touches.size;

        // 3. Determine State
        if (count === 1) {
            const t = Array.from(this.touches.values())[0];
            this.state = 'pending'; // Waiting to see if it's a tap or pan
            this.startPos = { x: t.x, y: t.y };
            this.startTime = Date.now();
        } 
        else if (count >= 2) {
            this.state = 'pinching'; // Immediately lock to pinch
            this.initPinchData();
            if (this.callbacks.onGestureStart) this.callbacks.onGestureStart('two_finger');
        }
    }

    handleMove(e) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();

        // Update Coords
        for (let t of e.changedTouches) {
            const rec = this.touches.get(t.identifier);
            if (rec) { rec.x = t.clientX; rec.y = t.clientY; }
        }

        // Logic
        if (this.state === 'pending') {
            // We have 1 finger. Did it move enough to become a PAN?
            const t = Array.from(this.touches.values())[0];
            const dx = t.x - this.startPos.x;
            const dy = t.y - this.startPos.y;
            const dist = Math.hypot(dx, dy);

            if (dist > this.tapThreshold) {
                this.state = 'panning'; // Upgrade state
                // Update start pos so we don't jump
                this.startPos = { x: t.x, y: t.y };
                if (this.callbacks.onGestureStart) this.callbacks.onGestureStart('single_pan');
            }
        }

        if (this.state === 'panning') {
            const t = Array.from(this.touches.values())[0];
            const dx = t.x - this.startPos.x;
            const dy = t.y - this.startPos.y;

            if (this.callbacks.onSinglePan) {
                this.callbacks.onSinglePan(dx, dy, t.x, t.y);
            }
            // Reset delta
            this.startPos = { x: t.x, y: t.y };
        }

        if (this.state === 'pinching' && this.touches.size >= 2) {
            this.updatePinch();
        }
    }

    handleEnd(e) {
        if (e.cancelable) e.preventDefault(); // KILL NATIVE CLICKS
        e.stopPropagation();

        // Remove touches
        for (let t of e.changedTouches) {
            this.touches.delete(t.identifier);
        }

        // Tap Detection
        // Only if we are still 'pending' (never moved much) and time is short
        if (this.state === 'pending' && this.touches.size === 0) {
            const duration = Date.now() - this.startTime;
            if (duration < 300) {
                if (this.callbacks.onSimpleTap) {
                    this.callbacks.onSimpleTap(this.startPos.x, this.startPos.y);
                }
            }
        }

        // Reset State
        if (this.touches.size === 0) {
            this.state = 'idle';
            if (this.callbacks.onGestureEnd) this.callbacks.onGestureEnd();
        } else if (this.touches.size < 2 && this.state === 'pinching') {
            // If dropping from 2 fingers to 1, go idle to prevent accidental pans
            this.state = 'idle';
        }
    }

    // --- Helpers ---

    initPinchData() {
        const t = Array.from(this.touches.values());
        this.lastDist = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
        this.lastCenter = { x: (t[0].x + t[1].x)/2, y: (t[0].y + t[1].y)/2 };
    }

    updatePinch() {
        const t = Array.from(this.touches.values());
        const dist = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
        const center = { x: (t[0].x + t[1].x)/2, y: (t[0].y + t[1].y)/2 };

        // Zoom
        if (this.lastDist > 0) {
            const scale = dist / this.lastDist;
            if (Math.abs(scale - 1) > 0.001 && this.callbacks.onPinchZoom) {
                this.callbacks.onPinchZoom(scale, center.x, center.y);
            }
        }

        // Pan (Two Finger)
        const dx = center.x - this.lastCenter.x;
        const dy = center.y - this.lastCenter.y;
        if (this.callbacks.onTwoPan) {
            this.callbacks.onTwoPan(dx, dy);
        }

        this.lastDist = dist;
        this.lastCenter = center;
    }
    destroy() {
        this.element.removeEventListener('touchstart', this.handleTouchStart);
        this.element.removeEventListener('touchmove', this.handleTouchMove);
        this.element.removeEventListener('touchend', this.handleTouchEnd);
        this.element.removeEventListener('touchcancel', this.handleTouchEnd);
    }
}