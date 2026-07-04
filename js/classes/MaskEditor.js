class MaskEditor {
	constructor(editor) {
		this.editor = editor;
		this.isEditing = false;
		this.mode = 'add';
		this.showOverlay = true;
		this.activePointerId = null;
		this.currentLayerId = null;
		this.strokeActive = false;
		this.strokeChanged = false;
		this.lastPoint = null;
		this.scratchAddCanvas = null;
		this.scratchSubCanvas = null;
		this.livePreviewQueued = false;
		this.liveOverlayQueued = false;
		this.cursorVisible = false;
		this.touchRingTimeout = null;
		this.stampCacheKey = '';
		this.stampCanvas = null;
		this.overlayPatternCache = new Map();
		this.ui = {
			toggle: document.getElementById('editMaskToggle'),
			modeButtons: Array.from(document.querySelectorAll('[data-mask-mode]')),
			overlayToggle: document.getElementById('maskOverlayToggle'),
			clearButton: document.getElementById('clearMaskPaint'),
			invertToggle: document.getElementById('maskInvertToggle'),
			overlayCanvas: document.getElementById('maskOverlayCanvas'),
			cursor: document.getElementById('maskBrushCursor')
		};

		this.overlayCtx = this.ui.overlayCanvas?.getContext('2d', { willReadFrequently: true }) || null;

		this._setupPointerListeners();
	}

	setupUIListeners() {
		// The panel button is a shortcut for the Brush tool — one source of truth.
		this.ui.toggle?.addEventListener('click', () => {
			if (this.editor.currentTool === ToolType.BRUSH) {
				this.editor.setTool(ToolType.SELECT);
			} else {
				this.editor.setTool(ToolType.BRUSH);
			}
		});

		this.ui.modeButtons.forEach((button) => {
			button.addEventListener('click', () => {
				this.setMode(button.dataset.maskMode);
			});
		});

		// Preview-control toggle button, same pattern as transparency/bounds
		this.ui.overlayToggle?.addEventListener('click', () => {
			this.showOverlay = this.ui.overlayToggle.classList.toggle('active');
			this.renderOverlay();
		});

		this.ui.clearButton?.addEventListener('click', async () => {
			const layer = this.editor.layerManager.getActiveLayer();
			if (!layer || layer.type !== LayerType.GLITTER_FILL) {
				return;
			}

			if (!layer.maskHasContent) {
				return;
			}

			const confirmed = await this.editor.confirmAction({
				title: 'Clear Paint?',
				message: 'Remove all painted strokes from this layer? Color selections will stay in place.',
				confirmLabel: 'Clear Paint'
			});
			if (!confirmed) {
				return;
			}

			this.editor.glitterManager.clearPaintForLayer(layer);
			this.editor.updatePreview();
			this.editor.layerManager.renderLayersList();
			this.editor.updateActionButtons();
			this.editor.updateHelpfulMessage();
			this.editor.saveState();
			this.loadLayer(layer);
			this.renderOverlay();
		});

		// Mirror of the Selection Options invert checkbox — one state, two views.
		// Forward through #invert's change event so the commit/history path runs once.
		this.ui.invertToggle?.addEventListener('change', () => {
			const invert = document.getElementById('invert');
			if (!invert) {
				return;
			}

			invert.checked = this.ui.invertToggle.checked;
			invert.dispatchEvent(new Event('change'));
		});

		this.loadLayer(this.editor.layerManager.getActiveLayer());
	}

	canActivate() {
		// Color-picker parity: usable whenever an image is loaded — painting on
		// a non-glitter layer auto-creates a glitter layer (see _handlePointerDown).
		return Boolean(this.editor.originalImage);
	}

	onToolChanged(tool) {
		if (tool === ToolType.BRUSH) {
			this.enterEditMode();
		} else if (this.isEditing) {
			this.exitEditMode({ switchTool: false });
		}
	}

	enterEditMode() {
		if (this.isEditing || !this.canActivate()) {
			return;
		}

		const layer = this.editor.layerManager.getActiveLayer();
		this.isEditing = true;
		this.currentLayerId = (layer && layer.type === LayerType.GLITTER_FILL) ? layer.id : null;
		document.body.classList.add('mask-editing');
		this.ui.toggle?.classList.add('active');
		if (this.ui.overlayToggle) {
			this.ui.overlayToggle.disabled = false;
			this.ui.overlayToggle.classList.toggle('active', this.showOverlay);
		}
		this.loadLayer(layer);
		this.editor.updateHelpfulMessage();
		this.renderOverlay();
	}

	exitEditMode(options = {}) {
		if (!this.isEditing) {
			return;
		}

		const { commitStroke = true, switchTool = true } = options;

		if (this.strokeActive) {
			if (commitStroke) {
				this._finishStroke();
			} else {
				this._cancelStroke();
			}
		}

		this.isEditing = false;
		this.currentLayerId = null;
		document.body.classList.remove('mask-editing');
		this.ui.toggle?.classList.remove('active');
		if (this.ui.overlayToggle) {
			this.ui.overlayToggle.disabled = true;
		}
		this._hideCursor();
		this._clearOverlay();
		this.editor.updateHelpfulMessage();

		// Leaving edit state by any path other than a tool change (layer switch,
		// undo, image clear) must also release the Brush tool itself.
		if (switchTool && this.editor.currentTool === ToolType.BRUSH) {
			this.editor.setTool(ToolType.SELECT);
		}
	}

	handleLayerChange(nextLayerId) {
		if (this.isEditing && this.currentLayerId !== nextLayerId) {
			if (this.strokeActive) {
				this._finishStroke();
			}

			// The brush persists across any layer switch (color-picker parity);
			// it targets glitter layers and auto-creates one when painting elsewhere.
			const layer = this.editor.layerManager.getActiveLayer();
			this.currentLayerId = (layer && layer.type === LayerType.GLITTER_FILL) ? layer.id : null;
			this.renderOverlay();
		}

		this.loadLayer(this.editor.layerManager.getActiveLayer());
	}

	handleStateRestore() {
		this.exitEditMode({ commitStroke: false });
		this.loadLayer(this.editor.layerManager.getActiveLayer());
	}

	releaseBrushTool(options = {}) {
		const { commitStroke = false } = options;

		if (!this.isEditing && this.editor.currentTool !== ToolType.BRUSH) {
			return;
		}

		if (this.isEditing) {
			this.exitEditMode({ commitStroke, switchTool: false });
		}

		if (this.editor.currentTool === ToolType.BRUSH) {
			this.editor.setTool(ToolType.SELECT);
		}
	}

	handleLayerDeleted(layerId) {
		if (!layerId || this.editor.currentTool !== ToolType.BRUSH) {
			return;
		}

		if (!this.currentLayerId || this.currentLayerId === layerId || this.isEditing) {
			this.releaseBrushTool({ commitStroke: false });
		}
	}

	updateToolButtonState() {
		const enabled = this.canActivate();
		if (this.ui.toggle) {
			this.ui.toggle.disabled = !enabled;
		}

		const brushTool = document.getElementById('brushTool');
		if (brushTool) {
			brushTool.disabled = !enabled;
		}
	}

	loadLayer(layer) {
		const isGlitterLayer = layer && layer.type === LayerType.GLITTER_FILL;
		this.updateToolButtonState();

		if (this.ui.clearButton) {
			this.ui.clearButton.disabled = !layer?.maskHasContent;
		}

		if (this.ui.invertToggle) {
			this.ui.invertToggle.checked = Boolean(layer?.settings?.invert);
			this.ui.invertToggle.disabled = !isGlitterLayer;
		}

		this._syncModeButtons();
		this._updateBrushCursorSize();
		this.renderOverlay();
	}

	setMode(mode) {
		if (mode !== 'add' && mode !== 'sub') {
			return;
		}

		this.mode = mode;
		this._syncModeButtons();
		this.editor.updateHelpfulMessage();
	}

	toggleMode() {
		this.setMode(this.mode === 'add' ? 'sub' : 'add');
	}

	adjustBrushSize(delta) {
		const slider = document.getElementById('maskBrushSize');
		if (!slider) {
			return false;
		}

		const currentValue = parseInt(slider.value || CONFIG.maskBrush.defaultSize, 10);
		const nextValue = Math.max(
			CONFIG.maskBrush.minSize,
			Math.min(CONFIG.maskBrush.maxSize, currentValue + delta)
		);

		if (nextValue === currentValue) {
			return false;
		}

		slider.value = String(nextValue);
		slider.dispatchEvent(new Event('input'));
		return true;
	}

	renderOverlay() {
		if (!this.overlayCtx || !this.ui.overlayCanvas) {
			return;
		}

		const layer = this.editor.layerManager.getActiveLayer();
		const width = this.editor.previewCanvas.width;
		const height = this.editor.previewCanvas.height;
		this.ui.overlayCanvas.width = width;
		this.ui.overlayCanvas.height = height;

		if (!this.isEditing || !this.strokeActive || !this.showOverlay || !layer || layer.type !== LayerType.GLITTER_FILL) {
			this._clearOverlay();
			return;
		}

		const maskCanvas = this.editor.maskCompositor.getMaskCanvas(layer, {
			draft: this.strokeActive
		});
		const { fillColor, stripeColor } = this._getOverlayPalette(layer);

		this.overlayCtx.clearRect(0, 0, width, height);
		this.overlayCtx.globalAlpha = CONFIG.maskBrush.overlayOpacity;
		this.overlayCtx.drawImage(maskCanvas, 0, 0);
		this.overlayCtx.globalCompositeOperation = 'source-in';
		this.overlayCtx.fillStyle = fillColor;
		this.overlayCtx.fillRect(0, 0, width, height);
		const stripePattern = this._getOverlayStripePattern(stripeColor);
		if (stripePattern) {
			this.overlayCtx.globalCompositeOperation = 'source-atop';
			this.overlayCtx.globalAlpha = Math.min(
				1,
				CONFIG.maskBrush.overlayOpacity + (CONFIG.maskBrush.overlayStripeOpacityBoost || 0)
			);
			this.overlayCtx.fillStyle = stripePattern;
			this.overlayCtx.fillRect(0, 0, width, height);
		}
		this.overlayCtx.globalCompositeOperation = 'source-over';
		this.overlayCtx.globalAlpha = 1;
	}

	_setupPointerListeners() {
		const opts = { capture: true };

		this.editor.previewContainer.addEventListener('pointerdown', (event) => this._handlePointerDown(event), opts);
		this.editor.previewContainer.addEventListener('pointermove', (event) => this._handlePointerMove(event), opts);
		this.editor.previewContainer.addEventListener('pointerup', (event) => this._handlePointerUp(event), opts);
		this.editor.previewContainer.addEventListener('pointercancel', (event) => this._handlePointerCancel(event), opts);
		this.editor.previewContainer.addEventListener('pointerleave', () => this._hideCursor(), opts);
		this.editor.previewContainer.addEventListener('click', (event) => this._swallowEditingClick(event), opts);
	}

	_handlePointerDown(event) {
		if (this._shouldShowTouchRingForPointer(event)) {
			this._showTouchRing(event.clientX, event.clientY);
			return;
		}

		if (!this._shouldHandleEvent(event) || event.button !== 0) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		this._startStrokeFromScreenPoint(event.clientX, event.clientY, {
			pointerId: event.pointerId
		});
		this._updateCursorPosition(event);
	}

	_handlePointerMove(event) {
		if (!this.isEditing) {
			return;
		}

		this._updateCursorPosition(event);

		if (!this.strokeActive || event.pointerId !== this.activePointerId) {
			return;
		}

		const point = this._getCanvasPoint(event);
		if (!point) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const layer = this.editor.layerManager.getActiveLayer();
		const paint = this.editor.glitterManager.getPaintMask(layer.id);
		if (!paint) {
			return;
		}

		this._stampAlongPath(layer, paint, this.lastPoint, point);
		this.lastPoint = point;
	}

	_handlePointerUp(event) {
		if (!this.strokeActive || event.pointerId !== this.activePointerId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this._finishStroke();
	}

	_handlePointerCancel(event) {
		if (!this.strokeActive || event.pointerId !== this.activePointerId) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this._cancelStroke();
	}

	_swallowEditingClick(event) {
		if (!this.isEditing || event.target.closest('.ui-ignore-gestures')) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
	}

	handleTouchPan(screenX, screenY) {
		if (!this.isEditing || this.editor.currentTool !== ToolType.BRUSH) {
			return false;
		}

		const point = this._getCanvasPointFromScreen(screenX, screenY);
		if (!point) {
			return false;
		}

		if (!this.strokeActive) {
			const started = this._startStrokeFromScreenPoint(screenX, screenY, {
				showTouchRing: true
			});
			if (!started) {
				return false;
			}

			return true;
		}

		const layer = this.editor.layerManager.getActiveLayer();
		const paint = layer ? this.editor.glitterManager.getPaintMask(layer.id) : null;
		if (!layer || layer.id !== this.currentLayerId || !paint) {
			return false;
		}

		this._stampAlongPath(layer, paint, this.lastPoint, point);
		this.lastPoint = point;
		return true;
	}

	handleTouchTap(screenX, screenY) {
		if (!this.isEditing || this.editor.currentTool !== ToolType.BRUSH) {
			return false;
		}

		const started = this._startStrokeFromScreenPoint(screenX, screenY, {
			showTouchRing: true
		});
		if (!started) {
			return false;
		}

		this._finishStroke();
		return true;
	}

	handleTouchGestureStart(gestureType) {
		if (gestureType === 'two_finger' && this.strokeActive) {
			this._cancelStroke();
		}
	}

	handleTouchGestureEnd() {
		if (this.strokeActive) {
			this._finishStroke();
		}
	}

	_finishStroke() {
		const layer = this.editor.layerManager.getActiveLayer();
		if (!layer || layer.id !== this.currentLayerId) {
			this._resetStrokeState();
			return;
		}

		if (this.strokeChanged) {
			this.editor.glitterManager.commitPaintState(layer);
			this.editor.updatePreview();
			this.editor.layerManager.renderLayersList();
			this.editor.updateActionButtons();
			this.editor.updateHelpfulMessage();
			this.editor.saveState();
			this.loadLayer(layer);
			this.renderOverlay();
		}

		this.editor.ignoreNextClick = true;
		setTimeout(() => {
			this.editor.ignoreNextClick = false;
		}, 0);

		this._resetStrokeState();
	}

	_cancelStroke() {
		const layer = this.editor.layerManager.getActiveLayer();
		const paint = layer ? this.editor.glitterManager.getPaintMask(layer.id) : null;
		if (paint && this.scratchAddCanvas && this.scratchSubCanvas) {
			const addCtx = paint.add.getContext('2d', { willReadFrequently: true });
			const subCtx = paint.sub.getContext('2d', { willReadFrequently: true });
			addCtx.clearRect(0, 0, paint.add.width, paint.add.height);
			subCtx.clearRect(0, 0, paint.sub.width, paint.sub.height);
			addCtx.drawImage(this.scratchAddCanvas, 0, 0);
			subCtx.drawImage(this.scratchSubCanvas, 0, 0);
			paint.hasContent = this.editor.glitterManager.paintCanvasHasContent(paint.add) || this.editor.glitterManager.paintCanvasHasContent(paint.sub);
			if (layer) {
				layer.maskHasContent = paint.hasContent;
			}
			paint.liveRevision++;
		}

		this.loadLayer(layer);
		this.renderOverlay();
		this._resetStrokeState();
	}

	_resetStrokeState() {
		if (this.activePointerId !== null) {
			this.editor.previewContainer.releasePointerCapture?.(this.activePointerId);
		}

		this.strokeActive = false;
		this.strokeChanged = false;
		this.activePointerId = null;
		this.lastPoint = null;
		this.scratchAddCanvas = null;
		this.scratchSubCanvas = null;
		this.livePreviewQueued = false;
		this.liveOverlayQueued = false;
		this.renderOverlay();
	}

	_captureScratchCanvases(paint) {
		this.scratchAddCanvas = document.createElement('canvas');
		this.scratchAddCanvas.width = paint.add.width;
		this.scratchAddCanvas.height = paint.add.height;
		this.scratchAddCanvas.getContext('2d', { willReadFrequently: true }).drawImage(paint.add, 0, 0);

		this.scratchSubCanvas = document.createElement('canvas');
		this.scratchSubCanvas.width = paint.sub.width;
		this.scratchSubCanvas.height = paint.sub.height;
		this.scratchSubCanvas.getContext('2d', { willReadFrequently: true }).drawImage(paint.sub, 0, 0);
	}

	_startStrokeFromScreenPoint(screenX, screenY, options = {}) {
		const point = this._getCanvasPointFromScreen(screenX, screenY);
		if (!point) {
			return false;
		}

		const layer = this._ensurePaintableLayer();
		if (!layer) {
			return false;
		}

		const paint = this.editor.glitterManager.ensurePaintMask(layer.id);
		this.strokeActive = true;
		this.strokeChanged = false;
		this.activePointerId = options.pointerId ?? null;
		this.lastPoint = point;
		this.currentLayerId = layer.id;
		this._captureScratchCanvases(paint);

		if (options.pointerId !== undefined && options.pointerId !== null) {
			this.editor.previewContainer.setPointerCapture?.(options.pointerId);
		}

		if (options.showTouchRing) {
			this._showTouchRing(screenX, screenY);
		}

		this._stampAtPoint(layer, paint, point.x, point.y);
		return true;
	}

	_ensurePaintableLayer() {
		let layer = this.editor.layerManager.getActiveLayer();
		if (layer && layer.type === LayerType.GLITTER_FILL) {
			return layer;
		}

		// Same convention as the color picker on a non-glitter layer:
		// auto-create a glitter layer and work in it.
		if (!CONFIG.autoCreateGlitterLayer) {
			this.editor.updateStatus('Select a glitter layer to paint on');
			return null;
		}

		layer = this.editor.glitterManager.createLayer();
		if (!layer) {
			return null; // maxLayers reached — createLayer already showed the error
		}

		this.editor.layerManager.insertLayer(layer);
		this.editor.layerManager.setActiveLayer(layer.id);
		this.editor.layerManager.renderLayersList();
		return layer;
	}

	_stampAlongPath(layer, paint, fromPoint, toPoint) {
		const spacing = Math.max(1, this.getBrushSize() * CONFIG.maskBrush.stampSpacing);
		const dx = toPoint.x - fromPoint.x;
		const dy = toPoint.y - fromPoint.y;
		const distance = Math.hypot(dx, dy);

		if (distance === 0) {
			return;
		}

		const steps = Math.floor(distance / spacing);
		for (let step = 1; step <= steps; step++) {
			const progress = (step * spacing) / distance;
			const x = fromPoint.x + dx * progress;
			const y = fromPoint.y + dy * progress;
			this._stampAtPoint(layer, paint, x, y);
		}

		this._stampAtPoint(layer, paint, toPoint.x, toPoint.y);
	}

	_stampAtPoint(layer, paint, x, y) {
		const stamp = this._getStampCanvas();
		const size = this.getBrushSize();
		const halfSize = size / 2;
		const destinationX = x - halfSize;
		const destinationY = y - halfSize;
		const targetCtx = (this.mode === 'add' ? paint.add : paint.sub).getContext('2d', { willReadFrequently: true });
		const oppositeCtx = (this.mode === 'add' ? paint.sub : paint.add).getContext('2d', { willReadFrequently: true });

		targetCtx.save();
		targetCtx.globalCompositeOperation = 'source-over';
		targetCtx.drawImage(stamp, destinationX, destinationY, size, size);
		targetCtx.restore();

		oppositeCtx.save();
		oppositeCtx.globalCompositeOperation = 'destination-out';
		oppositeCtx.drawImage(stamp, destinationX, destinationY, size, size);
		oppositeCtx.restore();

		paint.liveRevision++;
		paint.hasContent = true;
		layer.maskHasContent = true;
		this.strokeChanged = true;
		this._queueOverlayRefresh();
	}

	_queueOverlayRefresh() {
		if (this.liveOverlayQueued) {
			return;
		}

		this.liveOverlayQueued = true;
		requestAnimationFrame(() => {
			this.liveOverlayQueued = false;
			this.renderOverlay();
		});
	}

	_queueLivePreviewRefresh(layer) {
		if (CONFIG.maskBrush.livePreviewThrottle !== 'raf' || this.livePreviewQueued) {
			return;
		}

		this.livePreviewQueued = true;
		requestAnimationFrame(() => {
			this.livePreviewQueued = false;
			if (!this.strokeActive || !this.isEditing) {
				return;
			}

			this.editor.glitterManager.renderLayer(
				layer,
				this.editor.originalCanvas.width,
				this.editor.originalCanvas.height,
				{ draftMask: true }
			);
		});
	}

	_getStampCanvas() {
		const key = [this.getBrushSize(), this.getBrushSoftness(), this.getBrushFlow()].join('|');
		if (this.stampCacheKey === key && this.stampCanvas) {
			return this.stampCanvas;
		}

		const size = this.getBrushSize();
		const softness = this.getBrushSoftness() / 100;
		const flow = this.getBrushFlow() / 100;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		const radius = size / 2;
		const innerRadius = radius * (1 - softness);

		if (innerRadius >= radius) {
			// Softness 0: hard-edged circle. A radial gradient with equal inner
			// and outer radius is degenerate and paints nothing per spec.
			ctx.fillStyle = `rgba(255, 255, 255, ${flow})`;
			ctx.beginPath();
			ctx.arc(radius, radius, radius, 0, Math.PI * 2);
			ctx.fill();
		} else {
			const gradient = ctx.createRadialGradient(radius, radius, innerRadius, radius, radius, radius);
			gradient.addColorStop(0, `rgba(255, 255, 255, ${flow})`);
			gradient.addColorStop(Math.max(0.001, innerRadius / radius), `rgba(255, 255, 255, ${flow})`);
			gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, size, size);
		}

		this.stampCanvas = canvas;
		this.stampCacheKey = key;
		return canvas;
	}

	_getCanvasPoint(event) {
		return this._getCanvasPointFromScreen(event.clientX, event.clientY);
	}

	_getCanvasPointFromScreen(screenX, screenY) {
		const point = this.editor.viewport.screenToCanvas(screenX, screenY);
		if (!this.editor.viewport.isWithinCanvas(point.x, point.y)) {
			return null;
		}

		return {
			x: point.x,
			y: point.y
		};
	}

	_shouldHandleEvent(event) {
		// Real touch input is handled entirely by TouchGestureHandler
		// (handleTouchPan/handleTouchTap) — this pointer pipeline is mouse-only.
		// Gate on pointerType, not viewport width: a narrow desktop browser
		// window is still mouse input and must be able to draw.
		if (!this.isEditing || event.pointerType === 'touch') {
			return false;
		}

		if (event.target.closest('.ui-ignore-gestures') || event.target.closest('.transform-handles')) {
			return false;
		}

		return Boolean(this.editor.originalImage);
	}

	_updateCursorPosition(event) {
		if (!this.ui.cursor || !this.isEditing || event.pointerType === 'touch') {
			return;
		}

		const rect = this.editor.previewContainer.getBoundingClientRect();
		const point = this.editor.viewport.screenToCanvas(event.clientX, event.clientY);
		if (!this.editor.viewport.isWithinCanvas(point.x, point.y)) {
			this._hideCursor();
			return;
		}

		const screenX = event.clientX - rect.left;
		const screenY = event.clientY - rect.top;
		const diameter = this.getBrushSize() * this.editor.viewport.currentZoom;
		this.ui.cursor.style.width = `${diameter}px`;
		this.ui.cursor.style.height = `${diameter}px`;
		this.ui.cursor.style.left = `${screenX}px`;
		this.ui.cursor.style.top = `${screenY}px`;
		this.ui.cursor.classList.add('visible');
		this.cursorVisible = true;
	}

	_shouldShowTouchRingForPointer(event) {
		if (!this.isEditing || !this.editor.mobileManager?.isMobile) {
			return false;
		}

		if (this.editor.currentTool !== ToolType.BRUSH || event.pointerType !== 'touch') {
			return false;
		}

		if (event.target.closest('.ui-ignore-gestures') || event.target.closest('.transform-handles')) {
			return false;
		}

		return Boolean(this._getCanvasPointFromScreen(event.clientX, event.clientY));
	}

	_showTouchRing(screenX, screenY) {
		if (!this.ui.cursor || !this.isEditing) {
			return;
		}

		clearTimeout(this.touchRingTimeout);

		const rect = this.editor.previewContainer.getBoundingClientRect();
		const point = this._getCanvasPointFromScreen(screenX, screenY);
		if (!point) {
			this._hideCursor();
			return;
		}

		const screenOffsetX = screenX - rect.left;
		const screenOffsetY = screenY - rect.top;
		const diameter = this.getBrushSize() * this.editor.viewport.currentZoom;
		this.ui.cursor.style.width = `${diameter}px`;
		this.ui.cursor.style.height = `${diameter}px`;
		this.ui.cursor.style.left = `${screenOffsetX}px`;
		this.ui.cursor.style.top = `${screenOffsetY}px`;
		this.ui.cursor.classList.add('visible', 'touch-preview');
		this.cursorVisible = true;

		this.touchRingTimeout = setTimeout(() => {
			if (this.ui.cursor?.classList.contains('touch-preview')) {
				this._hideCursor();
			}
		}, 220);
	}

	_updateBrushCursorSize() {
		if (!this.cursorVisible || !this.ui.cursor) {
			return;
		}

		const diameter = this.getBrushSize() * this.editor.viewport.currentZoom;
		this.ui.cursor.style.width = `${diameter}px`;
		this.ui.cursor.style.height = `${diameter}px`;
	}

	_hideCursor() {
		if (!this.ui.cursor) {
			return;
		}

		clearTimeout(this.touchRingTimeout);
		this.ui.cursor.classList.remove('visible', 'touch-preview');
		this.cursorVisible = false;
	}

	_clearOverlay() {
		if (!this.overlayCtx || !this.ui.overlayCanvas) {
			return;
		}

		this.overlayCtx.clearRect(0, 0, this.ui.overlayCanvas.width, this.ui.overlayCanvas.height);
	}

	_syncModeButtons() {
		this.ui.modeButtons.forEach((button) => {
			button.classList.toggle('active', button.dataset.maskMode === this.mode);
		});
	}

	_getOverlayPalette(layer) {
		const glitter = layer?.selectedGlitterId
			? this.editor.glitterManager?.getItemById(layer.selectedGlitterId)
			: null;
		const fillColor = this._normalizeOverlayColor(glitter?.colorCodes?.[0]) || CONFIG.maskBrush.overlayColor;
		return {
			fillColor,
			stripeColor: this._getContrastColor(fillColor)
		};
	}

	_getOverlayStripePattern(color) {
		if (!this.overlayCtx) {
			return null;
		}

		if (this.overlayPatternCache.has(color)) {
			return this.overlayPatternCache.get(color);
		}

		const patternCanvas = document.createElement('canvas');
		patternCanvas.width = 8;
		patternCanvas.height = 8;
		const patternCtx = patternCanvas.getContext('2d', { willReadFrequently: true });
		if (!patternCtx) {
			return null;
		}

		patternCtx.clearRect(0, 0, 8, 8);
		patternCtx.strokeStyle = this._withAlpha(color, 0.65);
		patternCtx.lineWidth = 2;
		patternCtx.beginPath();
		patternCtx.moveTo(-2, 8);
		patternCtx.lineTo(8, -2);
		patternCtx.moveTo(2, 10);
		patternCtx.lineTo(10, 2);
		patternCtx.stroke();

		const pattern = this.overlayCtx.createPattern(patternCanvas, 'repeat');
		this.overlayPatternCache.set(color, pattern);
		return pattern;
	}

	_normalizeOverlayColor(value) {
		if (typeof value !== 'string') {
			return null;
		}

		const hex = value.trim();
		if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
			return hex;
		}

		if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
			return '#' + hex.slice(1).split('').map((char) => char + char).join('');
		}

		return null;
	}

	_getContrastColor(hex) {
		const rgb = this._hexToRgb(hex);
		if (!rgb) {
			return '#ffffff';
		}

		const luminance = ((0.299 * rgb.r) + (0.587 * rgb.g) + (0.114 * rgb.b)) / 255;
		return luminance > 0.6 ? '#111111' : '#ffffff';
	}

	_hexToRgb(hex) {
		const normalized = this._normalizeOverlayColor(hex);
		if (!normalized) {
			return null;
		}

		return {
			r: parseInt(normalized.slice(1, 3), 16),
			g: parseInt(normalized.slice(3, 5), 16),
			b: parseInt(normalized.slice(5, 7), 16)
		};
	}

	_withAlpha(hex, alpha) {
		const rgb = this._hexToRgb(hex);
		if (!rgb) {
			return `rgba(255, 255, 255, ${alpha})`;
		}

		return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
	}

	getBrushSize() {
		return parseInt(document.getElementById('maskBrushSize')?.value || CONFIG.maskBrush.defaultSize, 10);
	}

	getBrushSoftness() {
		return parseInt(document.getElementById('maskBrushSoftness')?.value || CONFIG.maskBrush.defaultSoftness, 10);
	}

	getBrushFlow() {
		return parseInt(document.getElementById('maskBrushFlow')?.value || CONFIG.maskBrush.defaultFlow, 10);
	}
}
