const TRANSFORM_PANEL_METHODS = {
renderTransformPanels() {
		Object.values(LayerType).forEach((type) => {
			const prefix = LAYER_UI_CONFIG[type]?.transformPrefix;
			const host = prefix && document.getElementById(`${prefix}TransformPanelHost`);
			if (!host) return;

			buildTransformPanel(this, host, prefix, LAYER_UI_CONFIG[type].transformCapabilities || {});
		});
	}

,
	getTransformIds(prefix) {
		return getPanelTransformIds(prefix);
	}

,
	getLayerTransformData(layer) {
		return getLayerTransform(layer);
	}

	// Single source of truth for "which manager + panel prefix owns this
	// layer's transform" (arrow nudge, centering, panel load/save, context
	// toolbars): the type's transformPrefix and managerKey. A layer that is
	// not transformable right now (a pinned frame) has none.
,
	getMovableLayerContext(layer) {
		const prefix = LAYER_UI_CONFIG[layer?.type]?.transformPrefix;
		if (!prefix || !isLayerTransformable(layer)) return null;
		return { prefix, manager: getLayerManagerForType(this, layer.type) };
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
		const transform = this.getLayerTransformData(layer);
		const resetTransform = document.getElementById(ids.resetTransform);
		if (resetTransform) {
			// Reset also returns a type with a home placement to it.
			const home = LAYER_UI_CONFIG[layer?.type]?.defaultTransform?.(this, layer);
			const moved = Boolean(home) && (
				Math.abs(transform.position.x - home.position.x) > 0.5
				|| Math.abs(transform.position.y - home.position.y) > 0.5
			);
			resetTransform.disabled = !moved && !this.hasResettableTransformAdjustments(transform);
		}
		// Per-row reverts: on only when their control is away from its default.
		const resetFlip = document.getElementById(ids.resetFlip);
		if (resetFlip) resetFlip.disabled = !(transform?.flipX || transform?.flipY);
		const resetAnchor = document.getElementById(ids.resetAnchor);
		if (resetAnchor) resetAnchor.disabled = Math.abs(transform.anchor.x - 0.5) < 1e-6 && Math.abs(transform.anchor.y - 0.5) < 1e-6;
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

		const frame = this.getMovableLayerContext(layer)?.manager?.layerTransforms?.get(layer.id)?.getFrame?.();
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
		// Never rewrite a field the user is typing in (it would replace a partial
		// value like "1" with its clamped result). Sliders and toggles keep focus
		// after a click, so they must still follow canvas edits and undo.
		const isTyping = (input) => input === document.activeElement && ['number', 'text'].includes(input.type);
		const canSyncInput = (input) => input && input.id !== preserveInputId && !isTyping(input);

		const posX = document.getElementById(ids.posX);
		const posY = document.getElementById(ids.posY);
		const anchorPoint = getLayerAnchorPoint(this, layer) || transform.position;
		if (canSyncInput(posX)) posX.value = Math.round(anchorPoint.x);
		if (canSyncInput(posY)) posY.value = Math.round(anchorPoint.y);
		const anchorSelect = document.getElementById(ids.anchorSelect);
		if (anchorSelect) {
			const preset = [0, 0.5, 1].includes(transform.anchor.x) && [0, 0.5, 1].includes(transform.anchor.y)
				? `${transform.anchor.x},${transform.anchor.y}`
				: 'custom';
			anchorSelect.value = preset;
		}

		const sizeState = this.getTransformSizeState(layer, prefix);
		const sizeGroup = document.getElementById(ids.sizeGroup);
		const sizeWidth = document.getElementById(ids.sizeWidth);
		const sizeHeight = document.getElementById(ids.sizeHeight);
		if (sizeGroup && sizeState) {
			sizeGroup.hidden = !sizeState.visible;
		}
		if (sizeState?.visible && canSyncInput(sizeWidth)) sizeWidth.value = sizeState.width;
		if (sizeState?.visible && canSyncInput(sizeHeight)) sizeHeight.value = sizeState.height;

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
		// Both axes always show their own slider; when the ratio is locked the X
		// row reads simply "Scale" since dragging it moves both.
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
			if (canSyncInput(input)) input.value = value;
			if (display) display.innerHTML = formatUnit(Math.round(value), '%');
			if (reset) reset.disabled = Math.abs(value - 100) < 0.01;
		});

		const flipX = document.getElementById(ids.flipX);
		const flipY = document.getElementById(ids.flipY);
		if (flipX) flipX.checked = transform.flipX;
		if (flipY) flipY.checked = transform.flipY;

		// v2 opacity model: the Layer section's Opacity row in the Appearance group.
		const layerOpacity = document.getElementById(`${prefix}LayerOpacity`);
		const layerOpacityValue = document.getElementById(`${prefix}LayerOpacityValue`);
		if (layerOpacity && layerOpacityValue) {
			const value = layer.opacity;
			layerOpacity.value = value;
			layerOpacityValue.innerHTML = formatUnit(Math.round(value), '%');
			const resetLayerOpacity = document.getElementById(`reset${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}LayerOpacity`);
			if (resetLayerOpacity) resetLayerOpacity.disabled = Math.round(value) === 100;
		}

		this.syncTransformAlignmentButtons(prefix, this.getTransformAlignmentState(layer));

		this.syncResetTransformState(prefix, layer);
	}

,
	syncTransformHandlesForActiveLayer() {
		const managers = [...new Set(Object.values(LayerType)
			.filter((type) => LAYER_UI_CONFIG[type]?.transformPrefix)
			.map((type) => getLayerManagerForType(this, type))
			.filter((manager) => manager?.removeTransformHandles))];
		if (!managers.length) return;
		const activeLayer = this.layerManager.getActiveLayer();
		const owner = this.currentTool === ToolType.SELECT
			&& activeLayer
			&& !activeLayer.locked
			&& !this.layerManager.hasMultiSelection()
			&& isLayerSelectableOnCanvas(activeLayer)
			? getLayerManagerForType(this, activeLayer.type)
			: null;
		managers.forEach((manager) => {
			if (manager !== owner) manager.removeTransformHandles();
		});
		if (this.currentTool === ToolType.SELECT && activeLayer && this.layerManager.hasMultiSelection() && this.layerManager.canTransformMultiSelection()) {
			this.groupTransformManager?.createTransformHandles();
		} else {
			this.groupTransformManager?.removeTransformHandles();
		}
		owner?.createTransformHandles(activeLayer.id);
	}
};
