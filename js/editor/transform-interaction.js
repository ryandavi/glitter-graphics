const TRANSFORM_INTERACTION_METHODS = {
	collectSnapTargets(kind, excludedIds = []) {
		const policy = CONFIG.snapping.targets[kind];
		const x = [];
		const y = [];
		if (policy.canvasEdges) { x.push(0, this.originalCanvas.width); y.push(0, this.originalCanvas.height); }
		if (policy.canvasCenter) { x.push(this.originalCanvas.width / 2); y.push(this.originalCanvas.height / 2); }
		if (policy.layerEdges || policy.layerCenters) this.layerManager.layers.forEach((layer) => {
			if (excludedIds.includes(layer.id) || layer.visible === false || layer.locked) return;
			const frame = getLayerCanvasBox(this, layer);
			if (!frame) return;
			if (policy.layerEdges) { x.push(frame.left, frame.right); y.push(frame.top, frame.bottom); }
			if (policy.layerCenters) { x.push((frame.left + frame.right) / 2); y.push((frame.top + frame.bottom) / 2); }
		});
		return { x, y };
	},
applyTransformEditWithAnchor(layer, manager, mutate) {
		const before = getLayerAnchorPoint(this, layer);
		const result = mutate();
		const after = getLayerAnchorPoint(this, layer);
		if (before && after) {
			const position = getLayerTransform(layer).position;
			position.x += before.x - after.x;
			position.y += before.y - after.y;
			manager.updateTransform(layer.id, {});
		}
		return result;
	}

,
zoomToSelection(options = {}) {
		const bounds = getLayersCanvasBox(this, this.layerManager.getSelectedLayers());
		if (!bounds) return false;
		this.viewport.zoomToBounds(bounds, options);
		return true;
	}

,
snapTransformPosition(transform, position, options = {}) {
		const config = CONFIG.snapping;
		if (!PREFERENCES.get('snappingEnabled') || options.ctrlKey) {
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
		const { x: targetsX, y: targetsY } = this.collectSnapTargets(options.kind || 'move', options.excludedIds || [transform.layer.id]);
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
	// Snaps the point a scale handle is dragging to the canvas and layer edges.
	// Only meaningful while the frame's edges are axis-aligned (rotation a
	// multiple of 90), so rotated layers pass through. `axes` limits an edge
	// handle to the axis it moves. `line` ({ origin, dir }) keeps a
	// proportional drag on its diagonal: the snapped coordinate is solved on
	// the line, so the other coordinate follows instead of breaking the aspect.
	snapScalePoint(transform, point, options = {}) {
		const config = CONFIG.snapping;
		const rotation = Number(transform?.getTransform().rotation) || 0;
		const quarterTurn = ((rotation % 90) + 90) % 90;
		const aligned = Math.min(quarterTurn, 90 - quarterTurn) < 0.01;
		if (!PREFERENCES.get('snappingEnabled') || options.ctrlKey || !aligned) {
			this.clearSmartGuides();
			return point;
		}
		const axes = options.axes || 'xy';
		const { x: targetsX, y: targetsY } = this.collectSnapTargets(options.kind || 'scale', options.excludedIds || (transform ? [transform.layer.id] : []));
		if (options.targets) { targetsX.push(...options.targets.x); targetsY.push(...options.targets.y); }
		if (options.line) {
			const { origin, dir } = options.line;
			const lengthSquared = dir.x * dir.x + dir.y * dir.y;
			if (lengthSquared > 0) {
				const along = ((point.x - origin.x) * dir.x + (point.y - origin.y) * dir.y) / lengthSquared;
				point = { x: origin.x + dir.x * along, y: origin.y + dir.y * along };
			}
		}
		const threshold = config.threshold / Math.max(0.01, this.viewport.currentZoom);
		const nearest = (value, targets) => {
			let result = null;
			targets.forEach((target) => {
				const delta = target - value;
				if (Math.abs(delta) <= threshold && (!result || Math.abs(delta) < Math.abs(result.delta))) result = { delta, target };
			});
			return result;
		};
		const x = axes.includes('x') ? nearest(point.x, targetsX) : null;
		const y = axes.includes('y') ? nearest(point.y, targetsY) : null;
		let next = point;
		let guideX = null;
		let guideY = null;
		const line = options.line;
		if (line) {
			const onLine = (axis, target) => {
				const dir = line.dir[axis];
				if (Math.abs(dir) < 1e-6) return null;
				const along = (target - line.origin[axis]) / dir;
				return { x: line.origin.x + line.dir.x * along, y: line.origin.y + line.dir.y * along };
			};
			const candidates = [];
			if (x) candidates.push({ point: onLine('x', x.target), axis: 'x', target: x.target });
			if (y) candidates.push({ point: onLine('y', y.target), axis: 'y', target: y.target });
			const pick = candidates.filter((item) => item.point)
				.sort((a, b) => Math.hypot(a.point.x - point.x, a.point.y - point.y) - Math.hypot(b.point.x - point.x, b.point.y - point.y))[0];
			if (pick) {
				next = pick.point;
				if (pick.axis === 'x') guideX = pick.target; else guideY = pick.target;
			}
		} else {
			next = { x: point.x + (x?.delta || 0), y: point.y + (y?.delta || 0) };
			guideX = x?.target ?? null;
			guideY = y?.target ?? null;
		}
		this.renderSmartGuides(guideX, guideY);
		return next;
	}

,
	renderSmartGuides(x, y) {
		this.clearSmartGuides();
		if (x == null && y == null) return;
		// Guides span the canvas and are drawn in the screen-space overlay.
		const overlay = this.viewport.selectionOverlay;
		const view = overlay.getMapping();
		const start = overlay.toScreen({ x: 0, y: 0 }, view);
		const end = overlay.toScreen({ x: this.originalCanvas.width, y: this.originalCanvas.height }, view);
		const add = (axis, value) => {
			const guide = document.createElement('div');
			guide.className = `smart-guide smart-guide-${axis} ui-ignore-gestures`;
			const point = overlay.toScreen({ x: value, y: value }, view);
			if (axis === 'x') {
				guide.style.left = `${SelectionOverlay.snap(point.x)}px`;
				guide.style.top = `${start.y}px`;
				guide.style.height = `${end.y - start.y}px`;
			} else {
				guide.style.top = `${SelectionOverlay.snap(point.y)}px`;
				guide.style.left = `${start.x}px`;
				guide.style.width = `${end.x - start.x}px`;
			}
			overlay.append(guide);
		};
		if (x != null) add('x', x);
		if (y != null) add('y', y);
	}

,
	snapGroupDelta(bounds, delta, excludedIds, options = {}) {
		const config = CONFIG.snapping;
		if (!PREFERENCES.get('snappingEnabled') || options.ctrlKey || !bounds) { this.clearSmartGuides(); return delta; }
		const { x: targetsX, y: targetsY } = this.collectSnapTargets('move', excludedIds);
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
		this.viewport?.selectionOverlay?.element.querySelectorAll('.smart-guide').forEach((guide) => guide.remove());
	}

,
	// A panel scale edit stretches the raster the layer already has. A type
	// that rasterizes its scale is redrawn at the new one when the edit settles,
	// as a handle drag does on release.
	redrawSettledScale(layer, manager) {
		if (LAYER_UI_CONFIG[layer.type]?.rasterizesScale) manager.renderLayer(layer);
	}

,
	applyTransformSizeFromPanel(prefix, layer, manager, axis, rawValue) {
		const value = Math.max(1, Math.round(rawValue));
		const lockAspect = resolveAspectLock(getLayerTransform(layer));

		if (prefix === 'sticker') {
			const nativeWidth = Math.max(1, layer.stickerData.width);
			const nativeHeight = Math.max(1, layer.stickerData.height);
			const current = getLayerTransform(layer).scale;
			let nextScaleX = axis === 'width'
				? (value / nativeWidth) * 100
				: current.x;
			let nextScaleY = axis === 'height'
				? (value / nativeHeight) * 100
				: current.y;

			// The lock keeps the sticker's current proportions, as it does for
			// shapes and text below and for the handles, not its native ones.
			if (lockAspect) {
				if (axis === 'width') nextScaleY = current.y * nextScaleX / Math.max(0.01, current.x);
				else nextScaleX = current.x * nextScaleY / Math.max(0.01, current.y);
			}

			this.applyTransformEditWithAnchor(layer, manager, () => manager.updateTransform(layer.id, {
				scale: { x: nextScaleX, y: nextScaleY }
			}));
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
			return Boolean(this.applyTransformEditWithAnchor(layer, manager, () => manager.setShapeSize?.(layer, nextWidth, nextHeight)));
		}

		if (prefix === 'text' && (layer.textData?.boxMode || 'point') === 'fixed') {
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
			return Boolean(this.applyTransformEditWithAnchor(layer, manager, () => manager.setBoxSize?.(layer, nextWidth, nextHeight)));
		}

		const current = this.getTransformSizeState(layer, prefix);
		if (!current?.visible) return false;
		const transform = getLayerTransform(layer);
		const scale = { ...transform.scale };
		if (axis === 'width') scale.x = clampLayerScale(scale.x * value / current.width);
		else scale.y = clampLayerScale(scale.y * value / current.height);
		this.applyTransformEditWithAnchor(layer, manager, () => manager.updateTransform(layer.id, { scale }));
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
				const startScale = { ...current.scale };
				active.manager.updateTransform(active.layer.id, {
					position: { x: this.originalCanvas.width / 2, y: this.originalCanvas.height / 2 },
					scale: { x: clampLayerScale(current.scale.x * factor), y: clampLayerScale(current.scale.y * factor) }
				});
				await getLayerManagerForType(this, active.layer.type)?.commitScale?.(active.layer, startScale);
				this.loadTransformSettings(active.layer, prefix);
				this.saveState('Transform layer');
			});
		});
		const bindNumberInput = (id, applyValue, { scales = false } = {}) => {
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
				if (scales) this.redrawSettledScale(active.layer, active.manager);
				this.loadTransformSettings(active.layer, prefix);
				this.saveState('Transform layer');
			});
		};

		bindNumberInput(ids.posX, (value, active) => {
			const point = getLayerAnchorPoint(this, active.layer);
			active.manager.updateTransform(active.layer.id, { position: { x: getLayerTransform(active.layer).position.x + value - point.x } });
		});
		bindNumberInput(ids.posY, (value, active) => {
			const point = getLayerAnchorPoint(this, active.layer);
			active.manager.updateTransform(active.layer.id, { position: { y: getLayerTransform(active.layer).position.y + value - point.y } });
		});

		const anchorSelect = document.getElementById(ids.anchorSelect);
		anchorSelect?.addEventListener('change', (event) => {
			const active = activeManager();
			if (!active || event.target.value === 'custom') return;
			const [x, y] = event.target.value.split(',').map(Number);
			active.manager.updateTransform(active.layer.id, { anchor: { x, y } });
			this.loadTransformSettings(active.layer, prefix);
			this.saveState('Change anchor');
		});
		document.getElementById(ids.resetAnchor)?.addEventListener('click', () => {
			const active = activeManager();
			if (!active) return;
			active.manager.updateTransform(active.layer.id, { anchor: { ...CONFIG.tools.stickers.defaults.transform.anchor } });
			this.loadTransformSettings(active.layer, prefix);
			this.saveState('Change anchor');
		});
		bindNumberInput(ids.sizeWidth, (value, active) => {
			this.applyTransformSizeFromPanel(prefix, active.layer, active.manager, 'width', value);
		}, { scales: true });
		bindNumberInput(ids.sizeHeight, (value, active) => {
			this.applyTransformSizeFromPanel(prefix, active.layer, active.manager, 'height', value);
		}, { scales: true });

		// Rotation, layer opacity and scale are sliders like any other: the shared
		// binder owns their readout, revert, frame cadence and commit.
		const commitTransform = () => {
			if (activeManager()) this.saveState('Transform layer');
		};
		const rotation = document.getElementById(ids.rotation);
		bindSlider(rotation, document.getElementById(ids.rotationValue), {
			suffix: '°',
			cost: FIELDS.transformRotation.cost,
			// Shift-drag snaps to 15° increments, mirroring the rotation handle.
			parseValue: (raw) => {
				const value = parseFloat(raw);
				if (!this.shiftHeld) return value;
				const snapped = Math.round(value / 15) * 15;
				rotation.value = snapped;
				return snapped;
			},
			resetValue: CONFIG.tools.stickers.defaults.transform.rotation,
			resetButton: document.getElementById(ids.resetRotation),
			apply: (value) => {
				const active = activeManager();
				if (!active) return;
				this.applyTransformEditWithAnchor(active.layer, active.manager, () => active.manager.updateTransform(active.layer.id, { rotation: value }));
				this.syncResetTransformState(prefix, active.layer);
			},
			onCommit: commitTransform
		});

		// The Layer section's Opacity row in the panel's Appearance group.
		// Writes layer.opacity through updateTransform, which re-applies the element.
		bindSlider(document.getElementById(`${prefix}LayerOpacity`), document.getElementById(`${prefix}LayerOpacityValue`), {
			suffix: '%',
			cost: FIELDS.layerOpacity.cost,
			parseValue: parseFloat,
			resetValue: FIELDS.layerOpacity.value,
			resetButton: document.getElementById(`reset${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}LayerOpacity`),
			apply: (value) => {
				const active = activeManager();
				if (active) active.manager.updateTransform(active.layer.id, { opacity: value });
			},
			onCommit: commitTransform
		});

		const proportionalScale = document.getElementById(ids.proportional);
		if (proportionalScale) {
			proportionalScale.addEventListener('change', (event) => {
				const active = activeManager();
				if (!active) return;
				// Linking X and Y keeps the layer's current proportions; Reset
				// Scale is what returns them to 100%.
				active.manager.updateTransform(active.layer.id, { proportionalScale: event.target.checked });
				this.loadTransformSettings(active.layer, prefix);
				this.saveState('Transform layer');
			});
		}

		const scaleSliderOptions = {
			suffix: '%',
			cost: FIELDS.transformScale.cost,
			parseValue: (raw) => clampLayerScale(parseFloat(raw) || 100),
			formatValue: (value) => formatUnit(Math.round(value), '%')
		};
		const bindAxisScale = (axis, inputId, valueId, resetId) => {
			const input = document.getElementById(inputId);
			const reset = document.getElementById(resetId);
			if (!input) return;

			bindSlider(input, document.getElementById(valueId), {
				...scaleSliderOptions,
				apply: (value) => {
					const active = activeManager();
					if (!active) return;
					const current = getLayerTransform(active.layer);
					const before = current.scale[axis];
					const scale = { ...current.scale, [axis]: value };
					if (document.getElementById(ids.proportional)?.checked) {
						const otherAxis = axis === 'x' ? 'y' : 'x';
						const previous = Math.max(0.01, current.scale[axis]);
						scale[otherAxis] = clampLayerScale(current.scale[otherAxis] * value / previous);
					}
					this.applyTransformEditWithAnchor(active.layer, active.manager, () => active.manager.updateTransform(active.layer.id, { scale }));
					// A key step on the slider or its editable readout. On a small sticker
					// a 1% step is under a pixel, so the whole-pixel snap would land it back
					// on the same size and the arrow keys would do nothing; step a pixel
					// instead.
					const stepped = Boolean(currentStepCoalesceKey());
					if (stepped && getLayerTransform(active.layer).scale[axis] === before && Math.round(value) !== Math.round(before)) {
						const dimension = axis === 'x' ? 'width' : 'height';
						const size = this.getTransformSizeState(active.layer, prefix);
						if (size?.visible) this.applyTransformSizeFromPanel(prefix, active.layer, active.manager, dimension, size[dimension] + Math.sign(value - before));
					}
					this.loadTransformSettings(active.layer, prefix);
				},
				onCommit: () => {
					const active = activeManager();
					if (!active) return;
					this.redrawSettledScale(active.layer, active.manager);
					this.saveState('Transform layer');
				}
			});
			reset?.addEventListener('click', () => {
				const active = activeManager();
				if (!active) return;
				const current = getLayerTransform(active.layer);
				const scale = { ...current.scale, [axis]: 100 };
				if (document.getElementById(ids.proportional)?.checked) scale[axis === 'x' ? 'y' : 'x'] = 100;
				active.manager.updateTransform(active.layer.id, { scale });
				this.redrawSettledScale(active.layer, active.manager);
				this.loadTransformSettings(active.layer, prefix);
				this.saveState('Transform layer');
			});
		};
		bindAxisScale('x', ids.scaleX, ids.scaleXValue, ids.resetScaleX);
		bindAxisScale('y', ids.scaleY, ids.scaleYValue, ids.resetScaleY);

		bindSlider(document.getElementById(ids.scaleSlider), null, {
			...scaleSliderOptions,
			apply: (value) => {
				const active = activeManager();
				if (!active) return;
				this.applyTransformEditWithAnchor(active.layer, active.manager, () => active.manager.updateTransform(active.layer.id, {
					scale: { x: value, y: value }
				}));
				this.loadTransformSettings(active.layer, prefix);
			},
			onCommit: async () => {
				const active = activeManager();
				if (!active) return;
				// The history key of a key step has to outlive the await.
				const coalesceKey = currentStepCoalesceKey();
				if (
					prefix === 'text'
					&& (active.layer.textData?.boxMode || 'point') === 'point'
					&& active.manager.commitScale
				) {
					await active.manager.commitScale(active.layer);
					this.loadTransformSettings(active.layer, prefix);
				}
				this.saveState('Transform layer', { coalesceKey });
			}
		});

		const resetScale = document.getElementById(ids.resetScale);
		if (resetScale) {
			resetScale.addEventListener('click', () => {
				const active = activeManager();
				if (!active) return;
					this.applyTransformEditWithAnchor(active.layer, active.manager, () => active.manager.updateTransform(active.layer.id, {
						scale: {
						x: CONFIG.tools.stickers.defaults.transform.scale.x,
						y: CONFIG.tools.stickers.defaults.transform.scale.y
					}
					}));
				this.redrawSettledScale(active.layer, active.manager);
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
					this.applyTransformEditWithAnchor(active.layer, active.manager, () => active.manager.updateTransform(active.layer.id, { [property]: e.target.checked }));
					this.syncResetTransformState(prefix, active.layer);
					this.saveState('Transform layer');
				}
			});
		};

		attachFlip(ids.flipX, 'flipX');
		attachFlip(ids.flipY, 'flipY');

		// Per-row revert for Flip: back to unflipped on both axes.
		const resetFlip = document.getElementById(ids.resetFlip);
		if (resetFlip) {
			resetFlip.addEventListener('click', () => {
				const active = activeManager();
				if (!active) return;
				const flipX = document.getElementById(ids.flipX);
				const flipY = document.getElementById(ids.flipY);
				if (flipX) flipX.checked = false;
				if (flipY) flipY.checked = false;
				this.applyTransformEditWithAnchor(active.layer, active.manager, () => active.manager.updateTransform(active.layer.id, { flipX: false, flipY: false }));
				this.syncResetTransformState(prefix, active.layer);
				this.saveState('Transform layer');
			});
		}

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
				this.redrawSettledScale(active.layer, active.manager);
				this.loadTransformSettings(active.layer, prefix);
			});
		}
	},

	initializeAltDuplicateFeedback() {
		const sync = (armed) => this.previewContainer?.classList.toggle(
			'alt-duplicate-armed', Boolean(armed) && this.currentTool === ToolType.SELECT
		);
		document.addEventListener('keydown', (event) => {
			if (event.key === 'Alt' && !event.repeat) sync(true);
		});
		document.addEventListener('keyup', (event) => {
			if (event.key === 'Alt') sync(false);
		});
		window.addEventListener('blur', () => {
			sync(false);
			this.endTemporaryHandTool();
		});
		document.getElementById('handTool')?.addEventListener('dblclick', () => {
			if (this.originalImage) this.viewport.zoomToFit({ animate: true });
		});
		document.getElementById('zoomTool')?.addEventListener('dblclick', () => {
			if (this.originalImage) this.viewport.resetZoom({ animate: true });
		});

	},

	setDuplicateDragFeedback(active, count = 1) {
		this.previewContainer?.classList.toggle('duplicate-drag-active', Boolean(active));
		this.duplicateDragStatus = active ? (count > 1 ? `Duplicating ${count} layers` : 'Duplicating layer') : '';
		this.updateStatus(this.duplicateDragStatus);
	},

	addDuplicateGhost(sourceTransform, targetTransform) {
		if (!sourceTransform?.element || !targetTransform || targetTransform.refreshElementReference?.()) return null;
		const ghost = sourceTransform.element.cloneNode(true);
		ghost.removeAttribute('id');
		ghost.removeAttribute('data-layer-id');
		ghost.querySelectorAll?.('[id], [data-layer-id]').forEach((node) => {
			node.removeAttribute('id');
			node.removeAttribute('data-layer-id');
		});
		ghost.dataset.duplicateGhost = '';
		ghost.style.pointerEvents = 'none';
		sourceTransform.element.parentElement?.appendChild(ghost);
		this._duplicateGhosts ||= new Map();
		this._duplicateGhosts.set(targetTransform, ghost);
		this.syncDuplicateGhost(targetTransform);

		let frames = 0;
		const retireWhenReady = () => {
			if (!ghost.isConnected) return;
			if (targetTransform.refreshElementReference?.() || frames++ > 300) {
				ghost.remove();
				this._duplicateGhosts?.delete(targetTransform);
				return;
			}
			requestAnimationFrame(retireWhenReady);
		};
		requestAnimationFrame(retireWhenReady);
		return ghost;
	},

	syncDuplicateGhost(targetTransform) {
		const ghost = this._duplicateGhosts?.get(targetTransform);
		if (!ghost?.isConnected) return;
		targetTransform.applyTransform(ghost, targetTransform.getDimensions());
		ghost.style.pointerEvents = 'none';
	},

	syncDuplicateGhosts() {
		this._duplicateGhosts?.forEach((_ghost, transform) => this.syncDuplicateGhost(transform));
	}
};
