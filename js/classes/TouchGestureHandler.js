class TouchGestureHandler {
constructor(element, callbacks = {}) {
    this.element = element;
    this.callbacks = callbacks;
    
    // State
    this.state = 'idle';
    this.touches = new Map();
    
// Store bound functions for removal
this.boundHandleStart = this.handleStart.bind(this);
this.boundHandleMove = this.handleMove.bind(this);
this.boundHandleEnd = this.handleEnd.bind(this);
// NEW: Document-level bound functions (to catch touches that end outside element)
this.boundHandleDocumentEnd = this.handleDocumentEnd.bind(this);
        
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
    this.element.addEventListener('touchstart', this.boundHandleStart, opt);
    this.element.addEventListener('touchmove', this.boundHandleMove, opt);
    this.element.addEventListener('touchend', this.boundHandleEnd, opt);
    this.element.addEventListener('touchcancel', this.boundHandleEnd, opt);
    
    // NEW: Listen on document for touchend/cancel to catch touches that end outside element
    document.addEventListener('touchend', this.boundHandleDocumentEnd, opt);
    document.addEventListener('touchcancel', this.boundHandleDocumentEnd, opt);
}


handleStart(e) {
    console.log('🟢 handleStart - changedTouches:', e.changedTouches.length, 'existing touches:', this.touches.size);
    
    // CRITICAL: Check if touch started on UI elements
    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    
    // If touching UI controls, don't interfere at all
    if (target && target.closest('.ui-ignore-gestures')) {
        console.log('🎯 Touch on UI element - ignoring completely');
        // Don't track this touch, don't prevent default, just exit
        return;
    }

    // Optional callback to check if we should ignore this target
    if (this.callbacks.shouldIgnoreTarget && this.callbacks.shouldIgnoreTarget(target)) {
        console.log('🎯 Target ignored by shouldIgnoreTarget callback');
        return;
    }

    // For canvas touches: prevent default to stop browser behavior
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    // Track touches
    for (let t of e.changedTouches) {
        console.log('  ➕ Adding touch:', t.identifier, 'at', t.clientX, t.clientY);
        this.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }

    const count = this.touches.size;
    console.log('  📊 Total touches now:', count);

    // Determine State
    if (count === 1) {
        const t = Array.from(this.touches.values())[0];
        this.state = 'pending';
        this.startPos = { x: t.x, y: t.y };
        this.startTime = Date.now();
    } 
else if (count >= 2) {
    console.log('  🎯 State change: → pinching (count >= 2)');
    this.state = 'pinching';
    this.initPinchData();
    if (this.callbacks.onGestureStart) this.callbacks.onGestureStart('two_finger');
}
}
handleMove(e) {
    // Check if touching UI element
    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (target && target.closest('.ui-ignore-gestures')) {
        console.log('🚫 handleMove on UI - ignoring');
        return; // Ignore moves on UI
    }

    // Optional callback to check if we should ignore this target
    if (this.callbacks.shouldIgnoreTarget && this.callbacks.shouldIgnoreTarget(target)) {
        console.log('🚫 handleMove on ignored target');
        return;
    }

    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    console.log('🔄 handleMove - state:', this.state, 'touches:', this.touches.size, 'changedTouches:', e.changedTouches.length);

    // Update Coords
    for (let t of e.changedTouches) {
        const rec = this.touches.get(t.identifier);
        if (rec) { 
            rec.x = t.clientX; 
            rec.y = t.clientY; 
        } else {
            console.warn('  ⚠️ Touch', t.identifier, 'not found in Map!');
        }
    }

    // Logic
    if (this.state === 'pending') {
        const t = Array.from(this.touches.values())[0];
        const dx = t.x - this.startPos.x;
        const dy = t.y - this.startPos.y;
        const dist = Math.hypot(dx, dy);

if (dist > this.tapThreshold) {
    console.log('  🎯 State change: pending → panning');
    this.state = 'panning';
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
        this.startPos = { x: t.x, y: t.y };
    }

    if (this.state === 'pinching' && this.touches.size >= 2) {
        this.updatePinch();
    }
}

handleEnd(e) {
    console.log('🔴 handleEnd - changedTouches:', e.changedTouches.length, 'existing touches before cleanup:', this.touches.size);
    
    // CRITICAL: ALWAYS remove touches FIRST, before any other logic
    // This prevents ghost touches from accumulating
    for (let t of e.changedTouches) {
        console.log('  ➖ Deleting touch:', t.identifier);
        this.touches.delete(t.identifier);
    }
    
    console.log('  📊 Touches remaining:', this.touches.size);
    
    // Check if ended on UI element
    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (target && target.closest('.ui-ignore-gestures')) {
        // Just update state and exit - touches already deleted above
        if (this.touches.size === 0) {
            this.state = 'idle';
        }
        return;
    }

    // Optional callback to check if we should ignore this target
    if (this.callbacks.shouldIgnoreTarget && this.callbacks.shouldIgnoreTarget(target)) {
        // Just update state and exit - touches already deleted above
        if (this.touches.size === 0) {
            this.state = 'idle';
        }
        return;
    }

    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    // Tap Detection - ONLY fire if still 'pending'
    if (this.state === 'pending' && this.touches.size === 0) {
        const duration = Date.now() - this.startTime;
        if (duration < 300) {
            console.log('✅ Simple tap detected');
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
        this.state = 'idle';
    }
}


handleDocumentEnd(e) {
    // Only process touches that are tracked by THIS handler
    for (let t of e.changedTouches) {
        if (this.touches.has(t.identifier)) {
            console.log('📄 Document caught orphaned touch:', t.identifier);
            // Clean up this touch
            this.touches.delete(t.identifier);
            
            // Update state if needed
            if (this.touches.size === 0) {
                this.state = 'idle';
                if (this.callbacks.onGestureEnd) {
                    this.callbacks.onGestureEnd();
                }
            } else if (this.touches.size < 2 && this.state === 'pinching') {
                this.state = 'idle';
            }
        }
    }
    
    console.log('📄 Document end - touches remaining:', this.touches.size);
}



    // --- Helpers ---

initPinchData() {
    const t = Array.from(this.touches.values());
    this.lastDist = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
    this.lastCenter = { x: (t[0].x + t[1].x)/2, y: (t[0].y + t[1].y)/2 };
    this.lastAngle = Math.atan2(t[1].y - t[0].y, t[1].x - t[0].x) * (180 / Math.PI);
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

// Rotate
const angle = Math.atan2(t[1].y - t[0].y, t[1].x - t[0].x) * (180 / Math.PI);
let angleDelta = angle - this.lastAngle;
if (angleDelta > 180) angleDelta -= 360;
if (angleDelta < -180) angleDelta += 360;
if (Math.abs(angleDelta) > 1 && this.callbacks.onRotate) {
    this.callbacks.onRotate(angleDelta, center.x, center.y);
}

this.lastDist = dist;
this.lastCenter = center;
this.lastAngle = angle;

    }
destroy() {
    const opt = { passive: false, capture: true };
    
    // Remove element listeners
    this.element.removeEventListener('touchstart', this.boundHandleStart, opt);
    this.element.removeEventListener('touchmove', this.boundHandleMove, opt);
    this.element.removeEventListener('touchend', this.boundHandleEnd, opt);
    this.element.removeEventListener('touchcancel', this.boundHandleEnd, opt);
    
    // NEW: Remove document listeners
    document.removeEventListener('touchend', this.boundHandleDocumentEnd, opt);
    document.removeEventListener('touchcancel', this.boundHandleDocumentEnd, opt);
    
    // Clear state
    this.touches.clear();
    this.state = 'idle';
}
}