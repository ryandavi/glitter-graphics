const TRANSFORM_PANEL_METHODS = {
renderTransformPanels() {
		[
			{ hostId: 'stickerTransformPanelHost', prefix: 'sticker', type: LayerType.STICKER },
			{ hostId: 'textTransformPanelHost', prefix: 'text', type: LayerType.TEXT_GLITTER },
			{ hostId: 'shapeTransformPanelHost', prefix: 'shape', type: LayerType.SHAPE }
		].forEach(({ hostId, prefix, type }) => {
			const host = document.getElementById(hostId);
			if (!host) return;

			buildTransformPanel(this, host, prefix, LAYER_UI_CONFIG[type]?.transformCapabilities || {});
		});
		finalizePanelSchemaSections(this);
	}

,
	getTransformIds(prefix) {
		return getPanelTransformIds(prefix);
	}

,
	getLayerTransformData(layer) {
		return getLayerTransform(layer);
	}

	// Single source of truth for the three movable/transformable layer types.
	// Anything keyed to "which manager + panel prefix owns this layer's transform"
	// (arrow nudge, centering, panel load/save, context toolbars) resolves through
	// here so sticker/text/shape stay in lockstep — register a new type once.
,
	getMovableLayerContext(layer) {
		switch (layer?.type) {
			case LayerType.STICKER:
				return { prefix: 'sticker', manager: this.stickerManager };
			case LayerType.TEXT_GLITTER:
				return { prefix: 'text', manager: this.textGlitterManager };
			case LayerType.SHAPE:
				return { prefix: 'shape', manager: this.shapeGlitterManager };
			default:
				return null;
		}
	}

,
	formatScaleSummary(transform) {
		const x = Math.round(transform.scale.x);
		const y = Math.round(transform.scale.y);
		return x === y
			? formatUnit(x, '%')
			: `${formatUnit(x, '%')} × ${formatUnit(y, '%')}`;
	}

,
	getScaleSliderValue(transform) {
		const x = Math.round(transform.scale.x || 100);
		const y = Math.round(transform.scale.y || 100);
		return x === y ? x : Math.round((x + y) / 2);
	}

,
	hasScaleAdjustment(transform) {
		if (!transform?.scale) return false;
		return Math.abs((transform.scale.x || 100) - 100) > 0.5
			|| Math.abs((transform.scale.y || 100) - 100) > 0.5;
	}

,
	hasResettableTransformAdjustments(transform, options = {}) {
		if (!transform) return false;
		return this.hasScaleAdjustment(transform)
			|| Math.abs(transform.rotation || 0) > 0.5
			|| Boolean(transform.flipX)
			|| Boolean(transform.flipY)
			|| transform.proportionalScale === false;
	}

	// Handlers that bypass loadTransformSettings (rotation slider, flips) still
	// need the Reset Transform enabled state to track the layer.
,
	syncResetTransformState(prefix, layer) {
		const ids = this.getTransformIds(prefix);
		const resetTransform = document.getElementById(ids.resetTransform);
		if (resetTransform) {
			resetTransform.disabled = !this.hasResettableTransformAdjustments(
				this.getLayerTransformData(layer)
			);
		}
	}

,
	getTransformSizeState(layer, prefix) {
		const transform = this.getLayerTransformData(layer);
		if (!layer || !transform) return null;

		if (prefix === 'sticker') {
			return {
				visible: true,
				width: Math.max(1, Math.round(layer.stickerData.width * ((transform.scale.x || 100) / 100))),
				height: Math.max(1, Math.round(layer.stickerData.height * ((transform.scale.y || 100) / 100)))
			};
		}

		if (prefix === 'shape') {
			return {
				visible: true,
				width: Math.max(1, Math.round(layer.shapeData.width)),
				height: Math.max(1, Math.round(layer.shapeData.height))
			};
		}

		const frame = this.textGlitterManager?.layerTransforms?.get(layer.id)?.getHandleFrame?.();
		return {
			visible: Boolean(frame),
			width: Math.max(1, Math.round((frame?.width || 1) * ((transform.scale.x || 100) / 100))),
			height: Math.max(1, Math.round((frame?.height || 1) * ((transform.scale.y || 100) / 100)))
		};
	}

,
	getTransformAlignmentState(layer) {
		if (!layer || !this.originalCanvas) return null;

		let metrics = null;
		try {
			metrics = new LayerTransform(layer, this).getFrameMetrics();
		} catch (error) {
			return null;
		}

		if (!metrics) return null;

		const pickAxisAlignment = (candidates, tolerance = 1) => {
			const best = candidates.reduce((winner, candidate) => {
				if (!winner || candidate.delta < winner.delta) return candidate;
				return winner;
			}, null);
			return best && best.delta <= tolerance ? best.mode : null;
		};

		const canvasWidth = this.originalCanvas.width;
		const canvasHeight = this.originalCanvas.height;
		const midX = (metrics.minX + metrics.maxX) / 2;
		const midY = (metrics.minY + metrics.maxY) / 2;

		return {
			x: pickAxisAlignment([
				{ mode: 'left', delta: Math.abs(metrics.minX) },
				{ mode: 'centerX', delta: Math.abs(midX - (canvasWidth / 2)) },
				{ mode: 'right', delta: Math.abs(metrics.maxX - canvasWidth) }
			]),
			y: pickAxisAlignment([
				{ mode: 'top', delta: Math.abs(metrics.minY) },
				{ mode: 'centerY', delta: Math.abs(midY - (canvasHeight / 2)) },
				{ mode: 'bottom', delta: Math.abs(metrics.maxY - canvasHeight) }
			])
		};
	}

,
	syncTransformAlignmentButtons(prefix, alignmentState) {
		const ids = this.getTransformIds(prefix);
		[
			['left', ids.alignLeft],
			['centerX', ids.alignCenterX],
			['right', ids.alignRight],
			['top', ids.alignTop],
			['centerY', ids.alignCenterY],
			['bottom', ids.alignBottom]
		].forEach(([mode, id]) => {
			const button = document.getElementById(id);
			if (!button) return;
			const active = mode === 'left' || mode === 'centerX' || mode === 'right'
				? alignmentState?.x === mode
				: alignmentState?.y === mode;
			button.classList.toggle('active', Boolean(active));
		});
	}

,
	loadTransformSettings(layer, prefix, options = {}) {
		const transform = this.getLayerTransformData(layer);
		if (!transform) return;

		const ids = this.getTransformIds(prefix);
		const preserveInputId = options.preserveInputId || null;

		const posX = document.getElementById(ids.posX);
		const posY = document.getElementById(ids.posY);
		if (posX && posX.id !== preserveInputId) posX.value = Math.round(transform.position.x);
		if (posY && posY.id !== preserveInputId) posY.value = Math.round(transform.position.y);

		const sizeState = this.getTransformSizeState(layer, prefix);
		const sizeGroup = document.getElementById(ids.sizeGroup);
		const sizeWidth = document.getElementById(ids.sizeWidth);
		const sizeHeight = document.getElementById(ids.sizeHeight);
		if (sizeGroup && sizeState) {
			sizeGroup.hidden = !sizeState.visible;
		}
		if (sizeWidth && sizeState?.visible && sizeWidth.id !== preserveInputId) sizeWidth.value = sizeState.width;
		if (sizeHeight && sizeState?.visible && sizeHeight.id !== preserveInputId) sizeHeight.value = sizeState.height;

		const rotation = document.getElementById(ids.rotation);
		const rotationValue = document.getElementById(ids.rotationValue);
		if (rotation && rotationValue) {
			rotation.value = transform.rotation;
			rotationValue.innerHTML = formatUnit(Math.round(transform.rotation), '°');
		}

		const proportional = document.getElementById(ids.proportional);
		if (proportional) {
			proportional.checked = transform.proportionalScale;
		}
		const transformPanel = document.querySelector(`[data-transform-prefix="${prefix}"]`);
		transformPanel?.classList.toggle('is-aspect-locked', Boolean(proportional?.checked));
		const scaleXLabel = transformPanel?.querySelector('.transform-scale-x .property-label');
		if (scaleXLabel) scaleXLabel.textContent = proportional?.checked ? 'Scale' : 'Scale X';
		const scaleSummary = document.getElementById(ids.scaleSummary);
		if (scaleSummary) {
			scaleSummary.innerHTML = this.formatScaleSummary(transform);
		}
		const scaleSlider = document.getElementById(ids.scaleSlider);
		if (scaleSlider) {
			scaleSlider.value = this.getScaleSliderValue(transform);
		}
		const resetScale = document.getElementById(ids.resetScale);
		if (resetScale) {
			resetScale.disabled = !this.hasScaleAdjustment(transform);
		}
		[
			[ids.scaleX, ids.scaleXValue, ids.resetScaleX, transform.scale.x],
			[ids.scaleY, ids.scaleYValue, ids.resetScaleY, transform.scale.y]
		].forEach(([inputId, valueId, resetId, value]) => {
			const input = document.getElementById(inputId);
			const display = document.getElementById(valueId);
			const reset = document.getElementById(resetId);
			if (input) input.value = value;
			if (display) display.innerHTML = formatUnit(Math.round(value), '%');
			if (reset) reset.disabled = Math.abs(value - 100) < 0.01;
		});

		const opacity = document.getElementById(ids.opacity);
		const opacityValue = document.getElementById(ids.opacityValue);
		if (opacity && opacityValue) {
			opacity.value = transform.opacity;
			opacityValue.innerHTML = formatUnit(Math.round(transform.opacity), '%');
		}

		const flipX = document.getElementById(ids.flipX);
		const flipY = document.getElementById(ids.flipY);
		if (flipX) flipX.checked = transform.flipX;
		if (flipY) flipY.checked = transform.flipY;

		this.syncTransformAlignmentButtons(prefix, this.getTransformAlignmentState(layer));

		this.syncResetTransformState(prefix, layer);
	}

,
	syncTransformHandlesForActiveLayer() {
		if (!this.stickerManager || !this.textGlitterManager) return;

		const activeLayer = this.layerManager.getActiveLayer();
		if (this.currentTool !== ToolType.SELECT || !activeLayer) {
			this.stickerManager.removeTransformHandles();
			this.textGlitterManager.removeTransformHandles();
			this.shapeGlitterManager?.removeTransformHandles();
			this.groupTransformManager?.removeTransformHandles();
			return;
		}

		if (this.layerManager.hasMultiSelection()) {
			this.stickerManager.removeTransformHandles();
			this.textGlitterManager.removeTransformHandles();
			this.shapeGlitterManager?.removeTransformHandles();
			if (this.layerManager.canTransformMultiSelection()) this.groupTransformManager?.createTransformHandles();
			else this.groupTransformManager?.removeTransformHandles();
			return;
		}

		if (activeLayer.locked) {
			this.stickerManager.removeTransformHandles();
			this.textGlitterManager.removeTransformHandles();
			this.shapeGlitterManager?.removeTransformHandles();
			this.groupTransformManager?.removeTransformHandles();
			return;
		}

		this.groupTransformManager?.removeTransformHandles();

		if (activeLayer.type === LayerType.STICKER) {
			this.stickerManager.createTransformHandles(activeLayer.id);
			this.textGlitterManager.removeTransformHandles();
			this.shapeGlitterManager?.removeTransformHandles();
			return;
		}

		if (activeLayer.type === LayerType.TEXT_GLITTER) {
			this.textGlitterManager.createTransformHandles(activeLayer.id);
			this.stickerManager.removeTransformHandles();
			this.shapeGlitterManager?.removeTransformHandles();
			return;
		}

		if (activeLayer.type === LayerType.SHAPE) {
			this.shapeGlitterManager?.createTransformHandles(activeLayer.id);
			this.stickerManager.removeTransformHandles();
			this.textGlitterManager.removeTransformHandles();
			return;
		}

		this.stickerManager.removeTransformHandles();
		this.textGlitterManager.removeTransformHandles();
		this.shapeGlitterManager?.removeTransformHandles();
	}
};
