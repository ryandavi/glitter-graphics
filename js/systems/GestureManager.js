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
		this.pendingSingleTimer = null;
		this.ignoredPointerIds = new Set();

		this.boundPointerDown = this.handlePointerDown.bind(this);
		this.boundPointerMove = this.handlePointerMove.bind(this);
		this.boundPointerUp = this.handlePointerUp.bind(this);
		this.boundPointerCancel = this.handlePointerCancel.bind(this);
		this.boundClickCapture = this.handleClickCapture.bind(this);
		this.boundLostPointerCapture = this.handleLostPointerCapture.bind(this);
		this.boundCancelActiveGesture = this.cancelActiveGesture.bind(this);

		this.setupEventListeners();
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
		this.previewContainer.addEventListener('lostpointercapture', this.boundLostPointerCapture, options);
		this.previewContainer.addEventListener('click', this.boundClickCapture, options);
		window.addEventListener('blur', this.boundCancelActiveGesture);
		document.addEventListener('visibilitychange', this.boundCancelActiveGesture);
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

		if (event.target.closest('.ui-ignore-gestures')) {
			return;
		}
		const transformHandles = event.target.closest('.transform-handles');
		if (transformHandles && !event.target.closest('.transform-bounding-box')) {
			return;
		}

		this.previewContainer.setPointerCapture?.(event.pointerId);
			event.preventDefault();
			event.stopPropagation();

		if (this.pointers.size >= 2) {
			this.ignoredPointerIds.add(event.pointerId);
			return;
		}

		// A palm landing next to an active finger must not become the second pinch
		// contact. Only devices that actually measure contact geometry can trip this.
		if (this.pointers.size === 1 && this.isLikelyPalmContact(event)) {
			this.ignoredPointerIds.add(event.pointerId);
			return;
		}

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
			this.schedulePendingSingleStart();
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
			if (this.ignoredPointerIds.has(event.pointerId)) {
				event.preventDefault();
				event.stopPropagation();
			}
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
		if (event.pointerType !== 'touch') return;
		if (!this.pointers.has(event.pointerId) && !this.ignoredPointerIds.has(event.pointerId)) return;
		event.preventDefault();
		event.stopPropagation();
		this.cancelActiveGesture(true);
	}

	handleLostPointerCapture(event) {
		if (!this.pointers.has(event.pointerId)) return;
		queueMicrotask(() => {
			if (this.pointers.has(event.pointerId)) this.cancelActiveGesture();
		});
	}

	cancelActiveGesture(force = false) {
		if (!force && document.visibilityState === 'visible' && document.hasFocus() && this.pointers.size === 0) return;
		this.cancelRouteInteraction(this.route);
		this.finishActiveRoute(this.route);
		this.notifyGestureEnd();
		this.pointers.clear();
		this.resetGestureState();
	}

	finishPointer(event) {
		if (event.pointerType !== 'touch') {
			return;
		}

		if (this.ignoredPointerIds.delete(event.pointerId)) {
			event.preventDefault();
			event.stopPropagation();
			this.previewContainer.releasePointerCapture?.(event.pointerId);
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
		this.clearPendingSingleStart();

		if (wasPending && this.pointers.size === 0) {
			if (this.isTap(pointer, routeBeforeRemoval)) {
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
			this.finishActiveRoute(routeBeforeRemoval, pointer);
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
			target: event.target,
			width: Number.isFinite(event.width) ? event.width : 0,
			height: Number.isFinite(event.height) ? event.height : 0
		};
	}

	isLikelyPalmContact(event) {
		const maxPx = CONFIG.ui.gestures.palmRejectionContactPx || 0;
		if (!maxPx) return false;

		const width = Number(event.width);
		const height = Number(event.height);
		// A contact box of 0/1 means the device reports no real geometry — every
		// touchscreen that does this must keep working, so never judge those.
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1) {
			return false;
		}

		if (Math.max(width, height) >= maxPx) return true;

		const primary = this.getPrimaryPointer();
		if (primary && primary.width > 1 && primary.height > 1) {
			return width * height >= primary.width * primary.height * 3;
		}
		return false;
	}

	schedulePendingSingleStart() {
		this.clearPendingSingleStart();
		const graceMs = Math.max(0, CONFIG.ui.gestures.secondFingerGraceMs || 0);
		if (!graceMs) return;
		this.pendingSingleTimer = setTimeout(() => {
			this.pendingSingleTimer = null;
			if (this.state !== 'pending' || this.pointers.size !== 1) return;
			this.maybeStartSingleFingerGesture(this.getPrimaryPointer(), true);
		}, graceMs);
	}

	clearPendingSingleStart() {
		if (this.pendingSingleTimer !== null) clearTimeout(this.pendingSingleTimer);
		this.pendingSingleTimer = null;
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
			if (editor.layerManager.hasMultiSelection() &&
				editor.groupTransformManager?.containsScreenPoint(pointer.x, pointer.y)) {
				return {
					type: 'groupDrag'
				};
			}

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

		const configuredRoute = TOOL_TOUCH_ROUTES[editor.currentTool];
		if (configuredRoute) {
			return { type: configuredRoute };
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
			editor.layerManager.hasMultiSelection() &&
			pointers.length >= 2 &&
			editor.groupTransformManager?.containsScreenPoint(pointers[0].x, pointers[0].y) &&
			editor.groupTransformManager?.containsScreenPoint(pointers[1].x, pointers[1].y)
		) {
			return { type: 'groupGesture' };
		}

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

	maybeStartSingleFingerGesture(pointer, graceElapsed = false) {
		const dx = pointer.x - pointer.startX;
		const dy = pointer.y - pointer.startY;
		const distance = Math.hypot(dx, dy);

		if (this.route?.type === 'tapCreate') {
			return;
		}

		if (distance <= CONFIG.ui.gestures.tapSlopPx) {
			return;
		}
		const commitSlop = CONFIG.ui.gestures.secondFingerCommitSlopPx ?? (CONFIG.ui.gestures.tapSlopPx * 2.5);
		if (!graceElapsed && distance < commitSlop &&
			Date.now() - pointer.downTime < (CONFIG.ui.gestures.secondFingerGraceMs || 0)) {
			return;
		}

		this.clearPendingSingleStart();
		this.state = 'dragging';
		this.beginRouteInteraction(this.route, pointer);
		this.notifyGestureStart('single_pan');
		this.lastTap = null;
		this.resetSinglePanVelocity();
		this.applySingleFingerMove(pointer);
	}

	beginRouteInteraction(route, pointer = null) {
		if (!route) {
			return;
		}

		if (route.type === 'groupDrag' || route.type === 'groupGesture') {
			this.editor.groupTransformManager?.beginGestureInteraction?.();
		} else if (route.type === 'layerDrag' || route.type === 'layerGesture') {
			const layer = this.getLayerById(route.layerId);
			if (layer && this.editor.layerManager.activeLayerId !== layer.id) {
				this.editor.layerManager.selectLayerFromCanvas(layer.id);
			}
			const transform = this.getLayerTransform(route.layerId);
			transform?.beginGestureInteraction?.();
		} else if (route.type === 'creationDrag' && pointer) {
			this.editor.beginShapeCreationGesture?.(pointer.startX, pointer.startY, {
				suppressNextClick: false
			});
		}
	}

	cancelRouteInteraction(route) {
		if (!route) {
			return;
		}

		if (route.type === 'creationDrag') {
			this.editor.cancelShapeCreationGesture?.();
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
		} else if (this.route?.type === 'groupDrag') {
			this.editor.groupTransformManager?.dragByScreenDelta?.(dx, dy);
		} else if (this.route?.type === 'layerDrag') {
			const transform = this.getLayerTransform(this.route.layerId);
			transform?.dragByScreenDelta?.(dx, dy);
		} else if (this.route?.type === 'creationDrag') {
			this.editor.updateShapeCreationGesture?.(pointer.x, pointer.y, false);
		} else {
			this.viewport.panBy(dx, dy);
			this.recordSinglePanVelocity(dx, dy);
		}

		this.lastCenter = { x: pointer.x, y: pointer.y };
	}

	upgradeToTwoFinger() {
		this.clearPendingSingleStart();
		const previousRoute = this.route;
		const nextRoute = this.resolveTwoFingerRoute();
		if (!this.routesShareInteraction(previousRoute, nextRoute)) {
			this.cancelRouteInteraction(previousRoute);
			this.finishActiveRoute(previousRoute);
		}
		this.route = nextRoute;
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

	routesShareInteraction(previousRoute, nextRoute) {
		if (!previousRoute || !nextRoute) return false;
		if (previousRoute.type === 'groupDrag' && nextRoute.type === 'groupGesture') return true;
		return previousRoute.type === 'layerDrag' && nextRoute.type === 'layerGesture' &&
			previousRoute.layerId === nextRoute.layerId;
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
			centroidY: center.y,
			previousCentroidX: this.lastCenter.x,
			previousCentroidY: this.lastCenter.y
		};

		if (this.route?.type === 'groupGesture') {
			this.editor.groupTransformManager?.applyGestureDelta?.(composite);
		} else if (this.route?.type === 'layerGesture') {
			const transform = this.getLayerTransform(this.route.layerId);
			transform?.applyGestureDelta?.(composite);
		} else {
			this.viewport.transformByGesture(
				composite.scale,
				composite.previousCentroidX,
				composite.previousCentroidY,
				composite.centroidX,
				composite.centroidY
			);
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

		if (this.route?.type === 'groupDrag') {
			this.editor.groupTransformManager?.beginGestureInteraction?.();
		} else if (this.route?.type === 'layerDrag') {
			const transform = this.getLayerTransform(this.route.layerId);
			transform?.beginGestureInteraction?.();
		} else if (this.route?.type === 'creationDrag') {
			this.beginRouteInteraction(this.route, remainingPointer);
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

		if (previousRoute.type === 'groupGesture') {
			return { type: 'groupDrag' };
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

		if (route?.type === 'groupDrag') {
			this.editor.handleWorkspaceAction(pointer.x, pointer.y, {
				tool: this.editor.currentTool,
				source: 'touch'
			});
		} else if (route?.type === 'layerDrag') {
			const layer = this.getLayerById(route.layerId);
			if (layer && this.editor.layerManager.activeLayerId !== layer.id) {
				this.editor.layerManager.selectLayerFromCanvas(layer.id);
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

	isTap(pointer, route = null) {
		const distance = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
		if (distance > CONFIG.ui.gestures.tapSlopPx) {
			return false;
		}

		if (route?.type === 'creationDrag' || route?.type === 'tapCreate') {
			return true;
		}

		const duration = Date.now() - pointer.downTime;
		return duration <= CONFIG.ui.gestures.tapMaxMs;
	}

	isDoubleTap(pointer) {
		if (!this.lastTap) {
			return false;
		}

		const duration = Date.now() - this.lastTap.time;
		const distance = Math.hypot(pointer.x - this.lastTap.x, pointer.y - this.lastTap.y);
		return duration <= CONFIG.ui.gestures.doubleTapMs && distance <= CONFIG.ui.gestures.doubleTapSlopPx;
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

			this.editor.layerManager.selectLayerFromCanvas(layer.id);
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
				this.viewport.zoomToFit({ animate: true });
			} else {
				this.viewport.zoomIn(pointer.x, pointer.y, { animate: true });
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

	finishActiveRoute(route, pointer = null) {
		if (!route) {
			return;
		}

		if (route.type === 'groupDrag' || route.type === 'groupGesture') {
			this.editor.groupTransformManager?.endGestureInteraction?.();
		} else if (route.type === 'layerDrag' || route.type === 'layerGesture') {
			const transform = this.getLayerTransform(route.layerId);
			transform?.endGestureInteraction?.();
		} else if (route.type === 'creationDrag') {
			if (pointer) {
				this.editor.finishShapeCreationGesture?.(pointer.x, pointer.y, {
					suppressNextClick: false
				});
			}
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
		this.clearPendingSingleStart();
		this.state = 'idle';
		this.route = null;
		this.primaryPointerId = null;
		this.lastCenter = null;
		this.lastDistance = 0;
		this.lastAngle = 0;
		this.resetSinglePanVelocity();
		this.touchGestureActive = false;
		this.ignoredPointerIds.clear();
		if (this.editor) {
			this.editor.touchGestureActive = false;
		}
	}

	getPrimaryPointer() {
		return this.pointers.get(this.primaryPointerId) || Array.from(this.pointers.values())[0] || null;
	}

	isTransformableLayer(layer) {
		return Boolean(layer && !layer.locked && isTransformableLayerType(layer.type));
	}

	isPointInLayer(layer, screenX, screenY) {
		const hitTestMethod = LAYER_UI_CONFIG[layer.type]?.hitTestMethod;
		if (!hitTestMethod) return false;

		const point = this.viewport.screenToCanvas(screenX, screenY);
		return this.editor.layerManager[hitTestMethod](layer, point.x, point.y);
	}

	getLayerById(layerId) {
		return this.editor?.layerManager?.layers?.find((layer) => layer.id === layerId) || null;
	}

	getLayerTransform(layerId) {
		const layer = this.getLayerById(layerId);
		if (!layer) {
			return null;
		}

		return getLayerManagerForType(this.editor, layer.type)?.layerTransforms?.get(layerId) || null;
	}

	destroy() {
		this.clearPendingSingleStart();
		const options = { capture: true };
		this.previewContainer.removeEventListener('pointerdown', this.boundPointerDown, options);
		this.previewContainer.removeEventListener('pointermove', this.boundPointerMove, options);
		this.previewContainer.removeEventListener('pointerup', this.boundPointerUp, options);
		this.previewContainer.removeEventListener('pointercancel', this.boundPointerCancel, options);
		this.previewContainer.removeEventListener('lostpointercapture', this.boundLostPointerCapture, options);
		this.previewContainer.removeEventListener('click', this.boundClickCapture, options);
		window.removeEventListener('blur', this.boundCancelActiveGesture);
		document.removeEventListener('visibilitychange', this.boundCancelActiveGesture);
	}
}
