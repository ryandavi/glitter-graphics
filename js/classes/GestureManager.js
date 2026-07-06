class GestureManager {
	constructor(previewContainer, viewport) {
		this.previewContainer = previewContainer;
		this.viewport = viewport;
		this.pointers = new Map();
		this.state = 'idle';
		this.route = null;
		this.primaryPointerId = null;
		this.lastCenter = null;
		this.lastDistance = 0;
		this.lastAngle = 0;
		this.lastTap = null;
		this.singlePanVelocity = { x: 0, y: 0 };
		this.lastSinglePanMoveTime = 0;
		this.touchGestureActive = false;
		this.suppressClickUntil = 0;

		this.boundPointerDown = this.handlePointerDown.bind(this);
		this.boundPointerMove = this.handlePointerMove.bind(this);
		this.boundPointerUp = this.handlePointerUp.bind(this);
		this.boundPointerCancel = this.handlePointerCancel.bind(this);
		this.boundClickCapture = this.handleClickCapture.bind(this);

		this.setupEventListeners();
		this.setupIOSGestureGuards();
	}

	get editor() {
		return this.viewport.editor || window.editor;
	}

	setupEventListeners() {
		const options = { capture: true };
		this.previewContainer.style.touchAction = 'none';
		this.previewContainer.addEventListener('pointerdown', this.boundPointerDown, options);
		this.previewContainer.addEventListener('pointermove', this.boundPointerMove, options);
		this.previewContainer.addEventListener('pointerup', this.boundPointerUp, options);
		this.previewContainer.addEventListener('pointercancel', this.boundPointerCancel, options);
		this.previewContainer.addEventListener('click', this.boundClickCapture, options);
	}

	setupIOSGestureGuards() {
		if (GestureManager.iOSGuardsInstalled) {
			return;
		}

		const preventGestureZoom = (event) => {
			event.preventDefault();
		};

		document.addEventListener('gesturestart', preventGestureZoom, { passive: false });
		document.addEventListener('gesturechange', preventGestureZoom, { passive: false });
		GestureManager.iOSGuardsInstalled = true;
	}

	handleClickCapture(event) {
		if (Date.now() <= this.suppressClickUntil) {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			this.suppressClickUntil = 0;
		}
	}

	handlePointerDown(event) {
		if (event.pointerType !== 'touch') {
			return;
		}

		this.viewport.cancelInertia?.();

		if (event.target.closest('.ui-ignore-gestures') || event.target.closest('.transform-handle-wrapper')) {
			return;
		}

		this.previewContainer.setPointerCapture?.(event.pointerId);
		event.preventDefault();
		event.stopPropagation();

		const pointer = this.createPointerRecord(event);
		this.pointers.set(event.pointerId, pointer);

		if (this.pointers.size === 1) {
			this.primaryPointerId = event.pointerId;
			this.state = 'pending';
			this.route = this.resolveSinglePointerRoute(pointer);
			this.lastCenter = { x: pointer.x, y: pointer.y };
			this.lastDistance = 0;
			this.lastAngle = 0;
			this.touchGestureActive = false;
			this.startRouteIfNeeded(this.route);
			return;
		}

		if (this.pointers.size === 2) {
			this.upgradeToTwoFinger();
		}
	}

	handlePointerMove(event) {
		if (event.pointerType !== 'touch') {
			return;
		}

		const pointer = this.pointers.get(event.pointerId);
		if (!pointer) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		pointer.x = event.clientX;
		pointer.y = event.clientY;
		pointer.target = event.target;

		if (this.state === 'pending') {
			this.maybeStartSingleFingerGesture(pointer);
			return;
		}

		if (this.state === 'dragging') {
			this.applySingleFingerMove(pointer);
			return;
		}

		if (this.state === 'twoFinger' && this.pointers.size >= 2) {
			this.applyTwoFingerMove();
		}
	}

	handlePointerUp(event) {
		this.finishPointer(event);
	}

	handlePointerCancel(event) {
		this.finishPointer(event);
	}

	finishPointer(event) {
		if (event.pointerType !== 'touch') {
			return;
		}

		const pointer = this.pointers.get(event.pointerId);
		if (!pointer) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		this.previewContainer.releasePointerCapture?.(event.pointerId);

		const wasPending = this.state === 'pending';
		const wasDragging = this.state === 'dragging';
		const wasTwoFinger = this.state === 'twoFinger';
		const routeBeforeRemoval = this.route;

		this.pointers.delete(event.pointerId);

		if (wasPending && this.pointers.size === 0) {
			if (this.isTap(pointer)) {
				this.handleTap(pointer, routeBeforeRemoval);
			}
			this.resetGestureState();
			return;
		}

		if (wasTwoFinger && this.pointers.size === 1) {
			const remaining = this.getPrimaryPointer();
			this.transitionFromTwoFingerToSingle(remaining, routeBeforeRemoval);
			return;
		}

		if ((wasDragging || wasTwoFinger) && this.pointers.size === 0) {
			this.finishActiveRoute(routeBeforeRemoval);
			if (wasDragging) {
				this.maybeStartViewportInertia(routeBeforeRemoval);
			}
			this.notifyGestureEnd();
			this.resetGestureState();
		}
	}

	createPointerRecord(event) {
		return {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			startX: event.clientX,
			startY: event.clientY,
			downTime: Date.now(),
			target: event.target
		};
	}

	resolveSinglePointerRoute(pointer) {
		const editor = this.editor;
		if (!editor) {
			return { type: 'viewport' };
		}

		if (editor.currentTool === ToolType.BRUSH) {
			return { type: 'brush' };
		}

		if (editor.currentTool === ToolType.SELECT) {
			const canvasPoint = this.viewport.screenToCanvas(pointer.x, pointer.y);
			const topLayer = editor.layerManager.getTopVisibleLayerAtPoint(canvasPoint.x, canvasPoint.y, {
				includeBase: false
			});
			if (this.isTransformableLayer(topLayer)) {
				return {
					type: 'layerDrag',
					layerId: topLayer.id
				};
			}
		}

		return { type: 'viewport' };
	}

	resolveTwoFingerRoute() {
		const editor = this.editor;
		if (!editor) {
			return { type: 'viewportTwoFinger' };
		}

		if (editor.currentTool === ToolType.BRUSH) {
			return { type: 'brushViewport' };
		}

		const activeLayer = editor.layerManager.getActiveLayer();
		const pointers = Array.from(this.pointers.values());
		if (
			editor.currentTool === ToolType.SELECT &&
			this.isTransformableLayer(activeLayer) &&
			pointers.length >= 2 &&
			this.isPointInLayer(activeLayer, pointers[0].x, pointers[0].y) &&
			this.isPointInLayer(activeLayer, pointers[1].x, pointers[1].y)
		) {
			return {
				type: 'layerGesture',
				layerId: activeLayer.id
			};
		}

		return { type: 'viewportTwoFinger' };
	}

	startRouteIfNeeded(route) {
		return route;
	}

	maybeStartSingleFingerGesture(pointer) {
		const dx = pointer.x - pointer.startX;
		const dy = pointer.y - pointer.startY;
		const distance = Math.hypot(dx, dy);

		if (distance <= CONFIG.gestures.tapSlopPx) {
			return;
		}

		this.state = 'dragging';
		this.lastCenter = { x: pointer.x, y: pointer.y };
		this.beginRouteInteraction(this.route);
		this.notifyGestureStart('single_pan');
		this.lastTap = null;
		this.resetSinglePanVelocity();
	}

	beginRouteInteraction(route) {
		if (!route) {
			return;
		}

		if (route.type === 'layerDrag' || route.type === 'layerGesture') {
			const layer = this.getLayerById(route.layerId);
			if (layer && this.editor.layerManager.activeLayerId !== layer.id) {
				this.editor.layerManager.setActiveLayer(layer.id);
			}
			const transform = this.getLayerTransform(route.layerId);
			transform?.beginGestureInteraction?.();
		}
	}

	applySingleFingerMove(pointer) {
		const dx = pointer.x - this.lastCenter.x;
		const dy = pointer.y - this.lastCenter.y;
		if (dx === 0 && dy === 0) {
			return;
		}

		if (this.route?.type === 'brush') {
			this.editor.maskEditor?.handleTouchPan(pointer.x, pointer.y);
		} else if (this.route?.type === 'layerDrag') {
			const transform = this.getLayerTransform(this.route.layerId);
			transform?.dragByScreenDelta?.(dx, dy);
		} else {
			this.viewport.panBy(dx, dy);
			this.recordSinglePanVelocity(dx, dy);
		}

		this.lastCenter = { x: pointer.x, y: pointer.y };
	}

	upgradeToTwoFinger() {
		const previousRoute = this.route;
		this.route = this.resolveTwoFingerRoute();
		this.state = 'twoFinger';
		this.lastTap = null;
		this.beginRouteInteraction(this.route);
		this.initializeTwoFingerMetrics();

		if (!this.touchGestureActive) {
			this.notifyGestureStart('two_finger');
			return;
		}

		if (previousRoute?.type === 'brush') {
			this.editor.maskEditor?.handleTouchGestureStart('two_finger');
		}
	}

	initializeTwoFingerMetrics() {
		const pointers = Array.from(this.pointers.values());
		if (pointers.length < 2) {
			return;
		}

		this.lastCenter = {
			x: (pointers[0].x + pointers[1].x) / 2,
			y: (pointers[0].y + pointers[1].y) / 2
		};
		this.lastDistance = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
		this.lastAngle = Math.atan2(pointers[1].y - pointers[0].y, pointers[1].x - pointers[0].x) * (180 / Math.PI);
	}

	applyTwoFingerMove() {
		const pointers = Array.from(this.pointers.values());
		if (pointers.length < 2) {
			return;
		}

		const center = {
			x: (pointers[0].x + pointers[1].x) / 2,
			y: (pointers[0].y + pointers[1].y) / 2
		};
		const distance = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
		const angle = Math.atan2(pointers[1].y - pointers[0].y, pointers[1].x - pointers[0].x) * (180 / Math.PI);
		const scale = this.lastDistance > 0 ? distance / this.lastDistance : 1;
		let rotateDeg = angle - this.lastAngle;
		if (rotateDeg > 180) rotateDeg -= 360;
		if (rotateDeg < -180) rotateDeg += 360;

		const composite = {
			scale,
			rotateDeg,
			translateX: center.x - this.lastCenter.x,
			translateY: center.y - this.lastCenter.y,
			centroidX: center.x,
			centroidY: center.y
		};

		if (this.route?.type === 'layerGesture') {
			const transform = this.getLayerTransform(this.route.layerId);
			transform?.applyGestureDelta?.(composite);
		} else {
			this.viewport.pinchZoomAt(composite.scale, composite.centroidX, composite.centroidY);
			this.viewport.panBy(composite.translateX, composite.translateY);
		}

		this.lastCenter = center;
		this.lastDistance = distance;
		this.lastAngle = angle;
	}

	transitionFromTwoFingerToSingle(remainingPointer, previousRoute) {
		this.notifyGestureEnd();

		this.state = 'dragging';
		this.lastCenter = { x: remainingPointer.x, y: remainingPointer.y };
		this.lastDistance = 0;
		this.lastAngle = 0;
		this.route = this.routeAfterTwoFinger(previousRoute);
		this.resetSinglePanVelocity();

		if (this.route?.type === 'layerDrag') {
			const transform = this.getLayerTransform(this.route.layerId);
			transform?.beginGestureInteraction?.();
		}

		this.notifyGestureStart('single_pan');
	}

	routeAfterTwoFinger(previousRoute) {
		if (!previousRoute) {
			return { type: 'viewport' };
		}

		if (previousRoute.type === 'layerGesture') {
			return {
				type: 'layerDrag',
				layerId: previousRoute.layerId
			};
		}

		return { type: 'viewport' };
	}

	handleTap(pointer, route) {
		this.suppressClickUntil = Date.now() + 400;
		const isDoubleTap = this.isDoubleTap(pointer);

		if (route?.type === 'brush') {
			this.editor.maskEditor?.handleTouchTap(pointer.x, pointer.y);
			this.recordTap(pointer, isDoubleTap);
			return;
		}

		if (route?.type === 'layerDrag') {
			const layer = this.getLayerById(route.layerId);
			if (layer && this.editor.layerManager.activeLayerId !== layer.id) {
				this.editor.layerManager.setActiveLayer(layer.id);
			}
		} else {
			this.editor.handleWorkspaceAction(pointer.x, pointer.y, {
				tool: this.editor.currentTool,
				source: 'touch'
			});
		}

		if (isDoubleTap) {
			this.handleDoubleTap(pointer, route);
		}

		this.recordTap(pointer, isDoubleTap);
	}

	isTap(pointer) {
		const duration = Date.now() - pointer.downTime;
		const distance = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
		return duration <= CONFIG.gestures.tapMaxMs && distance <= CONFIG.gestures.tapSlopPx;
	}

	isDoubleTap(pointer) {
		if (!this.lastTap) {
			return false;
		}

		const duration = Date.now() - this.lastTap.time;
		const distance = Math.hypot(pointer.x - this.lastTap.x, pointer.y - this.lastTap.y);
		return duration <= CONFIG.gestures.doubleTapMs && distance <= CONFIG.gestures.doubleTapSlopPx;
	}

	recordTap(pointer, wasDoubleTap) {
		if (wasDoubleTap) {
			this.lastTap = null;
			return;
		}

		this.lastTap = {
			time: Date.now(),
			x: pointer.x,
			y: pointer.y
		};
	}

	handleDoubleTap(pointer, route) {
		if (this.editor.currentTool !== ToolType.SELECT) {
			return;
		}

		if (route?.type === 'layerDrag') {
			const layer = this.getLayerById(route.layerId);
			if (!layer) {
				return;
			}

			this.editor.layerManager.setActiveLayer(layer.id);
			if (layer.type === LayerType.TEXT_GLITTER || layer.type === LayerType.SHAPE) {
				if (this.editor.mobileManager?.isMobile) {
					this.editor.mobileManager.prepareSettings?.(layer);
					if (!this.editor.mobileManager.settingsOpen) {
						this.editor.mobileManager.toggleSettings?.();
					}
					this.editor.setCollapsibleSectionOpen?.('textSettings', true);
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							this.editor.textGlitterManager?.focusTextInput?.(true);
						});
					});
					return;
				}

				this.editor.textGlitterManager?.focusTextInput?.(true);
			}
			return;
		}

		if (route?.type === 'viewport') {
			if (this.viewport.currentZoom >= 4) {
				this.viewport.zoomToFit();
			} else {
				this.viewport.zoomIn(pointer.x, pointer.y);
			}
		}
	}

	notifyGestureStart(type) {
		if (this.touchGestureActive) {
			if (type === 'two_finger') {
				this.editor.touchGestureActive = true;
			}
			return;
		}

		this.touchGestureActive = true;
		if (this.editor) {
			this.editor.touchGestureActive = true;
			this.editor.maskEditor?.handleTouchGestureStart(type);
		}
	}

	notifyGestureEnd() {
		if (!this.touchGestureActive) {
			return;
		}

		this.touchGestureActive = false;
		if (this.editor) {
			this.editor.touchGestureActive = false;
			this.editor.maskEditor?.handleTouchGestureEnd();
		}
	}

	finishActiveRoute(route) {
		if (!route) {
			return;
		}

		if (route.type === 'layerDrag' || route.type === 'layerGesture') {
			const transform = this.getLayerTransform(route.layerId);
			transform?.endGestureInteraction?.();
		}
	}

	maybeStartViewportInertia(route) {
		if (route?.type !== 'viewport') {
			this.resetSinglePanVelocity();
			return;
		}

		const speed = Math.hypot(this.singlePanVelocity.x, this.singlePanVelocity.y);
		if (speed > 0.5) {
			this.viewport.startInertia?.(this.singlePanVelocity.x, this.singlePanVelocity.y);
		}

		this.resetSinglePanVelocity();
	}

	recordSinglePanVelocity(deltaX, deltaY) {
		const now = performance.now();
		if (!this.lastSinglePanMoveTime) {
			this.lastSinglePanMoveTime = now;
			return;
		}

		const elapsed = Math.max(1, now - this.lastSinglePanMoveTime);
		const frameScale = 16.67 / elapsed;
		this.singlePanVelocity = {
			x: deltaX * frameScale,
			y: deltaY * frameScale
		};
		this.lastSinglePanMoveTime = now;
	}

	resetSinglePanVelocity() {
		this.singlePanVelocity = { x: 0, y: 0 };
		this.lastSinglePanMoveTime = 0;
	}

	resetGestureState() {
		this.state = 'idle';
		this.route = null;
		this.primaryPointerId = null;
		this.lastCenter = null;
		this.lastDistance = 0;
		this.lastAngle = 0;
		this.resetSinglePanVelocity();
		this.touchGestureActive = false;
		if (this.editor) {
			this.editor.touchGestureActive = false;
		}
	}

	getPrimaryPointer() {
		return this.pointers.get(this.primaryPointerId) || Array.from(this.pointers.values())[0] || null;
	}

	isTransformableLayer(layer) {
		return Boolean(layer && (layer.type === LayerType.STICKER || layer.type === LayerType.TEXT_GLITTER || layer.type === LayerType.SHAPE));
	}

	isPointInLayer(layer, screenX, screenY) {
		const point = this.viewport.screenToCanvas(screenX, screenY);
		if (layer.type === LayerType.STICKER) {
			return this.editor.layerManager.isPointInSticker(layer, point.x, point.y);
		}
		if (layer.type === LayerType.TEXT_GLITTER) {
			return this.editor.layerManager.isPointInText(layer, point.x, point.y);
		}
		if (layer.type === LayerType.SHAPE) {
			return this.editor.layerManager.isPointInShape(layer, point.x, point.y);
		}
		return false;
	}

	getLayerById(layerId) {
		return this.editor?.layerManager?.layers?.find((layer) => layer.id === layerId) || null;
	}

	getLayerTransform(layerId) {
		const layer = this.getLayerById(layerId);
		if (!layer) {
			return null;
		}

		if (layer.type === LayerType.STICKER) {
			return this.editor.stickerManager?.layerTransforms?.get(layerId) || null;
		}
		if (layer.type === LayerType.TEXT_GLITTER) {
			return this.editor.textGlitterManager?.layerTransforms?.get(layerId) || null;
		}
		if (layer.type === LayerType.SHAPE) {
			return this.editor.shapeGlitterManager?.layerTransforms?.get(layerId) || null;
		}
		return null;
	}

	destroy() {
		const options = { capture: true };
		this.previewContainer.removeEventListener('pointerdown', this.boundPointerDown, options);
		this.previewContainer.removeEventListener('pointermove', this.boundPointerMove, options);
		this.previewContainer.removeEventListener('pointerup', this.boundPointerUp, options);
		this.previewContainer.removeEventListener('pointercancel', this.boundPointerCancel, options);
		this.previewContainer.removeEventListener('click', this.boundClickCapture, options);
	}
}

GestureManager.iOSGuardsInstalled = false;
