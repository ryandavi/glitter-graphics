const TRANSFORM_INTERACTION_METHODS = {
snapTransformPosition(transform, position, options = {}) {
		const config = CONFIG.snapping;
		if (!config.enabled || options.ctrlKey) {
			this.clearSmartGuides();
			return position;
		}
		const metrics = transform.getFrameMetrics?.();
		if (!metrics) return position;
		const current = transform.getTransform().position;
		const dx = position.x - current.x;
		const dy = position.y - current.y;
		const movingX = [metrics.minX + dx, (metrics.minX + metrics.maxX) / 2 + dx, metrics.maxX + dx];
		const movingY = [metrics.minY + dy, (metrics.minY + metrics.maxY) / 2 + dy, metrics.maxY + dy];
		const targetsX = [];
		const targetsY = [];
		if (config.snapToCanvas) {
			targetsX.push(0, this.originalCanvas.width / 2, this.originalCanvas.width);
			targetsY.push(0, this.originalCanvas.height / 2, this.originalCanvas.height);
		}
		if (config.snapToLayers) {
			this.layerManager.layers.forEach((layer) => {
				if (layer.id === transform.layer.id || layer.visible === false || layer.locked) return;
				const other = this.getMovableLayerContext(layer)?.manager?.layerTransforms?.get(layer.id)?.getFrameMetrics?.();
				if (!other) return;
				targetsX.push(other.minX, (other.minX + other.maxX) / 2, other.maxX);
				targetsY.push(other.minY, (other.minY + other.maxY) / 2, other.maxY);
			});
		}
		const threshold = config.threshold / Math.max(0.01, this.viewport.currentZoom);
		const best = (moving, targets) => {
			let result = null;
			moving.forEach((value) => targets.forEach((target) => {
				const delta = target - value;
				if (Math.abs(delta) <= threshold && (!result || Math.abs(delta) < Math.abs(result.delta))) result = { delta, target };
			}));
			return result;
		};
		const x = best(movingX, targetsX);
		const y = best(movingY, targetsY);
		this.renderSmartGuides(x?.target, y?.target);
		return { x: position.x + (x?.delta || 0), y: position.y + (y?.delta || 0) };
	}

,
	renderSmartGuides(x, y) {
		this.clearSmartGuides();
		if (x == null && y == null) return;
		const add = (axis, value) => {
			const guide = document.createElement('div');
			guide.className = `smart-guide smart-guide-${axis} ui-ignore-gestures`;
			guide.style[axis === 'x' ? 'left' : 'top'] = `${value}px`;
			this.canvasElementsContainer.appendChild(guide);
		};
		if (x != null) add('x', x);
		if (y != null) add('y', y);
	}

,
	snapGroupDelta(bounds, delta, excludedIds, options = {}) {
		const config = CONFIG.snapping;
		if (!config.enabled || options.ctrlKey || !bounds) { this.clearSmartGuides(); return delta; }
		const targetsX = config.snapToCanvas ? [0, this.originalCanvas.width / 2, this.originalCanvas.width] : [];
		const targetsY = config.snapToCanvas ? [0, this.originalCanvas.height / 2, this.originalCanvas.height] : [];
		if (config.snapToLayers) this.layerManager.layers.forEach((layer) => {
			if (excludedIds.includes(layer.id) || layer.visible === false || layer.locked) return;
			const metrics = this.getMovableLayerContext(layer)?.manager?.layerTransforms?.get(layer.id)?.getFrameMetrics?.();
			if (!metrics) return;
			targetsX.push(metrics.minX, (metrics.minX + metrics.maxX) / 2, metrics.maxX);
			targetsY.push(metrics.minY, (metrics.minY + metrics.maxY) / 2, metrics.maxY);
		});
		const threshold = config.threshold / Math.max(0.01, this.viewport.currentZoom);
		const nearest = (moving, targets) => {
			let result = null;
			moving.forEach((value) => targets.forEach((target) => { const adjustment = target - value; if (Math.abs(adjustment) <= threshold && (!result || Math.abs(adjustment) < Math.abs(result.adjustment))) result = { adjustment, target }; }));
			return result;
		};
		const x = nearest([bounds.left + delta.x, bounds.centerX + delta.x, bounds.right + delta.x], targetsX);
		const y = nearest([bounds.top + delta.y, bounds.centerY + delta.y, bounds.bottom + delta.y], targetsY);
		this.renderSmartGuides(x?.target, y?.target);
		return { x: delta.x + (x?.adjustment || 0), y: delta.y + (y?.adjustment || 0) };
	}

,
	clearSmartGuides() {
		this.canvasElementsContainer?.querySelectorAll('.smart-guide').forEach((guide) => guide.remove());
	}

,
	applyTransformSizeFromPanel(prefix, layer, manager, axis, rawValue) {
		const value = Math.max(1, Math.round(rawValue));
		const ids = this.getTransformIds(prefix);
		const lockAspect = Boolean(document.getElementById(ids.proportional)?.checked);

		if (prefix === 'sticker') {
			const nativeWidth = Math.max(1, layer.stickerData.width);
			const nativeHeight = Math.max(1, layer.stickerData.height);
			let nextScaleX = axis === 'width'
				? (value / nativeWidth) * 100
				: getLayerTransform(layer).scale.x;
			let nextScaleY = axis === 'height'
				? (value / nativeHeight) * 100
				: getLayerTransform(layer).scale.y;

			if (lockAspect) {
				const uniform = axis === 'width' ? nextScaleX : nextScaleY;
				nextScaleX = uniform;
				nextScaleY = uniform;
			}

			manager.updateTransform(layer.id, {
				scale: { x: nextScaleX, y: nextScaleY }
			});
			return true;
		}

		if (prefix === 'shape') {
			const aspect = Math.max(0.01, layer.shapeData.width / Math.max(1, layer.shapeData.height));
			let nextWidth = axis === 'width' ? value : layer.shapeData.width;
			let nextHeight = axis === 'height' ? value : layer.shapeData.height;
			if (lockAspect) {
				if (axis === 'width') {
					nextHeight = Math.max(CONFIG.tools.shapes.minSize, Math.round(nextWidth / aspect));
				} else {
					nextWidth = Math.max(CONFIG.tools.shapes.minSize, Math.round(nextHeight * aspect));
				}
			}
			return Boolean(manager.setShapeSize?.(layer, nextWidth, nextHeight));
		}

		if (prefix === 'text' && (layer.textData?.boxMode || 'auto') === 'fixed') {
			const transform = getLayerTransform(layer);
			const scaleX = Math.max(0.01, (transform.scale.x || 100) / 100);
			const scaleY = Math.max(0.01, (transform.scale.y || 100) / 100);
			const currentWidth = Math.max(1, layer.textData.boxWidth || 1);
			const currentHeight = Math.max(1, layer.textData.boxHeight || 1);
			const displayAspect = (currentWidth * scaleX) / Math.max(1, currentHeight * scaleY);
			let nextWidth = axis === 'width' ? value / scaleX : currentWidth;
			let nextHeight = axis === 'height' ? value / scaleY : currentHeight;
			if (lockAspect) {
				if (axis === 'width') nextHeight = (value / displayAspect) / scaleY;
				else nextWidth = (value * displayAspect) / scaleX;
			}
			return Boolean(manager.setBoxSize?.(layer, nextWidth, nextHeight));
		}

		const current = this.getTransformSizeState(layer, prefix);
		if (!current?.visible) return false;
		const transform = getLayerTransform(layer);
		const scale = { ...transform.scale };
		if (axis === 'width') scale.x = clampLayerScale(scale.x * value / current.width);
		else scale.y = clampLayerScale(scale.y * value / current.height);
		manager.updateTransform(layer.id, { scale });
		return true;
	}

,
	setupTransformListeners(prefix, layerType, getManager) {
		const ids = this.getTransformIds(prefix);
		const activeManager = () => {
			const layer = this.layerManager.getActiveLayer();
			const manager = getManager();
			return (layer && layer.type === layerType && manager) ? { layer, manager } : null;
		};
		const showUnit = (el, num, unit) => { if (el) el.innerHTML = formatUnit(Math.round(num), unit); };
		['Fit', 'Fill'].forEach((mode) => {
			document.getElementById(`${prefix}${mode}Canvas`)?.addEventListener('click', async () => {
				const active = activeManager();
				const transform = active?.manager?.layerTransforms?.get(active.layer.id);
				const metrics = transform?.getFrameMetrics?.();
				if (!active || !metrics) return;
				const factor = (mode === 'Fill' ? Math.max : Math.min)(
					this.originalCanvas.width / Math.max(1, metrics.displayWidth),
					this.originalCanvas.height / Math.max(1, metrics.displayHeight)
				);
				const current = getLayerTransform(active.layer);
				active.manager.updateTransform(active.layer.id, {
					position: { x: this.originalCanvas.width / 2, y: this.originalCanvas.height / 2 },
					scale: { x: clampLayerScale(current.scale.x * factor), y: clampLayerScale(current.scale.y * factor) }
				});
				if (prefix === 'text') await active.manager.commitScaleToFontSize?.(active.layer);
				if (prefix === 'shape') active.manager.commitScale?.(active.layer);
				this.loadTransformSettings(active.layer, prefix);
				this.saveState('Transform layer');
			});
		});
		const bindNumberInput = (id, applyValue) => {
			const input = document.getElementById(id);
			if (!input) return;

			input.addEventListener('input', () => {
				const active = activeManager();
				const value = parseFloat(input.value);
				if (!active || Number.isNaN(value)) return;
				applyValue(value, active);
				this.loadTransformSettings(active.layer, prefix, { preserveInputId: id });
			});

			input.addEventListener('change', () => {
				const active = activeManager();
				if (!active) return;
				this.loadTransformSettings(active.layer, prefix);
				this.saveState('Transform layer');
			});

			input.addEventListener('keydown', (event) => {
				if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
				event.preventDefault();
				const step = event.shiftKey ? 10 : 1;
				const current = parseFloat(input.value || '0');
				const delta = event.key === 'ArrowUp' ? step : -step;
				const min = input.min !== '' ? parseFloat(input.min) : Number.NEGATIVE_INFINITY;
				input.value = String(Math.max(min, Math.round(current + delta)));
				input.dispatchEvent(new Event('input'));
				input.dispatchEvent(new Event('change'));
			});
		};

		bindNumberInput(ids.posX, (value, active) => {
			active.manager.updateTransform(active.layer.id, { position: { x: value } });
		});
		bindNumberInput(ids.posY, (value, active) => {
			active.manager.updateTransform(active.layer.id, { position: { y: value } });
		});
		bindNumberInput(ids.sizeWidth, (value, active) => {
			this.applyTransformSizeFromPanel(prefix, active.layer, active.manager, 'width', value);
		});
		bindNumberInput(ids.sizeHeight, (value, active) => {
			this.applyTransformSizeFromPanel(prefix, active.layer, active.manager, 'height', value);
		});

		// Rotation
		const rotation = document.getElementById(ids.rotation);
		const rotationValue = document.getElementById(ids.rotationValue);
		const resetRotation = document.getElementById(ids.resetRotation);

		if (rotation && rotationValue) {
			rotation.addEventListener('input', (e) => {
				// Shift-drag snaps to 15° increments, mirroring the rotation handle.
				let value = parseFloat(e.target.value);
				if (this.shiftHeld) {
					value = Math.round(value / 15) * 15;
					e.target.value = value;
				}
				showUnit(rotationValue, value, '°');

				const active = activeManager();
				if (active) {
					active.manager.updateTransform(active.layer.id, { rotation: value });
					this.syncResetTransformState(prefix, active.layer);
				}
			});

			rotation.addEventListener('change', () => this.saveState('Transform layer'));
		}

		if (resetRotation) {
			resetRotation.addEventListener('click', () => {
				if (rotation) rotation.value = CONFIG.tools.stickers.defaults.transform.rotation;
				showUnit(rotationValue, CONFIG.tools.stickers.defaults.transform.rotation, '°');

				const active = activeManager();
				if (active) {
					active.manager.updateTransform(active.layer.id, { rotation: CONFIG.tools.stickers.defaults.transform.rotation });
					this.syncResetTransformState(prefix, active.layer);
					this.saveState('Transform layer');
				}
			});
		}

		// Opacity
		const opacity = document.getElementById(ids.opacity);
		const opacityValue = document.getElementById(ids.opacityValue);
		const resetOpacity = document.getElementById(ids.resetOpacity);

		if (opacity && opacityValue) {
			opacity.addEventListener('input', (e) => {
				const value = parseFloat(e.target.value);
				showUnit(opacityValue, value, '%');

				const active = activeManager();
				if (active) active.manager.updateTransform(active.layer.id, { opacity: value });
			});

			opacity.addEventListener('change', () => this.saveState('Transform layer'));
		}

		if (resetOpacity) {
			resetOpacity.addEventListener('click', () => {
				if (opacity) opacity.value = CONFIG.tools.stickers.defaults.transform.opacity;
				showUnit(opacityValue, CONFIG.tools.stickers.defaults.transform.opacity, '%');

				const active = activeManager();
				if (active) {
					active.manager.updateTransform(active.layer.id, { opacity: CONFIG.tools.stickers.defaults.transform.opacity });
					this.saveState('Transform layer');
				}
			});
		}

		const proportionalScale = document.getElementById(ids.proportional);
		if (proportionalScale) {
			proportionalScale.addEventListener('change', (event) => {
				const active = activeManager();
				if (!active) return;
				const current = getLayerTransform(active.layer);
				active.manager.updateTransform(active.layer.id, {
					proportionalScale: event.target.checked,
					...(event.target.checked ? { scale: { x: current.scale.x, y: current.scale.x } } : {})
				});
				this.loadTransformSettings(active.layer, prefix);
				this.saveState('Transform layer');
			});
		}

		const bindAxisScale = (axis, inputId, valueId, resetId) => {
			const input = document.getElementById(inputId);
			const display = document.getElementById(valueId);
			const reset = document.getElementById(resetId);
			if (!input) return;

			input.addEventListener('input', (event) => {
				const active = activeManager();
				if (!active) return;
				const value = clampLayerScale(parseFloat(event.target.value) || 100);
				const current = getLayerTransform(active.layer);
				const scale = { ...current.scale, [axis]: value };
				if (document.getElementById(ids.proportional)?.checked) {
					const otherAxis = axis === 'x' ? 'y' : 'x';
					const previous = Math.max(0.01, current.scale[axis]);
					scale[otherAxis] = clampLayerScale(current.scale[otherAxis] * value / previous);
				}
				active.manager.updateTransform(active.layer.id, { scale });
				this.loadTransformSettings(active.layer, prefix);
			});
			input.addEventListener('change', () => this.saveState('Transform layer'));
			reset?.addEventListener('click', () => {
				const active = activeManager();
				if (!active) return;
				const current = getLayerTransform(active.layer);
				const scale = { ...current.scale, [axis]: 100 };
				if (document.getElementById(ids.proportional)?.checked) scale[axis === 'x' ? 'y' : 'x'] = 100;
				active.manager.updateTransform(active.layer.id, { scale });
				this.loadTransformSettings(active.layer, prefix);
				this.saveState('Transform layer');
			});
		};
		bindAxisScale('x', ids.scaleX, ids.scaleXValue, ids.resetScaleX);
		bindAxisScale('y', ids.scaleY, ids.scaleYValue, ids.resetScaleY);

		const scaleSlider = document.getElementById(ids.scaleSlider);
		const scaleSummary = document.getElementById(ids.scaleSummary);
		if (scaleSlider) {
			scaleSlider.addEventListener('input', (event) => {
				const active = activeManager();
				if (!active) return;
				const value = clampLayerScale(parseFloat(event.target.value) || 100);
				active.manager.updateTransform(active.layer.id, {
					scale: { x: value, y: value }
				});
				if (scaleSummary) {
					scaleSummary.innerHTML = this.formatScaleSummary(this.getLayerTransformData(active.layer));
				}
				this.loadTransformSettings(active.layer, prefix);
			});

			scaleSlider.addEventListener('change', async () => {
				const active = activeManager();
				if (!active) return;
				if (
					prefix === 'text'
					&& (active.layer.textData?.boxMode || 'auto') === 'auto'
					&& active.manager.commitScaleToFontSize
				) {
					await active.manager.commitScaleToFontSize(active.layer);
					this.loadTransformSettings(active.layer, prefix);
				}
				this.saveState('Transform layer');
			});
		}

		const resetScale = document.getElementById(ids.resetScale);
		if (resetScale) {
			resetScale.addEventListener('click', () => {
				const active = activeManager();
				if (!active) return;
				active.manager.updateTransform(active.layer.id, {
					scale: {
						x: CONFIG.tools.stickers.defaults.transform.scale.x,
						y: CONFIG.tools.stickers.defaults.transform.scale.y
					}
				});
				this.loadTransformSettings(active.layer, prefix);
				this.saveState('Transform layer');
			});
		}

		// Flip
		const attachFlip = (checkboxId, property) => {
			const checkbox = document.getElementById(checkboxId);
			if (!checkbox) return;

			checkbox.addEventListener('change', (e) => {
				const active = activeManager();
				if (active) {
					active.manager.updateTransform(active.layer.id, { [property]: e.target.checked });
					this.syncResetTransformState(prefix, active.layer);
					this.saveState('Transform layer');
				}
			});
		};

		attachFlip(ids.flipX, 'flipX');
		attachFlip(ids.flipY, 'flipY');

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
			button.addEventListener('click', () => {
				const active = activeManager();
				if (!active?.manager?.alignToCanvas) return;
				active.manager.alignToCanvas(active.layer.id, mode);
				this.loadTransformSettings(active.layer, prefix);
			});
		});

		const resetTransform = document.getElementById(ids.resetTransform);
		if (resetTransform) {
			resetTransform.addEventListener('click', () => {
				const active = activeManager();
				if (!active?.manager?.resetTransform) return;
				active.manager.resetTransform(active.layer.id);
				this.loadTransformSettings(active.layer, prefix);
			});
		}
	}
};
