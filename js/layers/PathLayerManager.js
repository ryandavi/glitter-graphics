// ============================================
// PATH LAYER MANAGER
// ============================================
// Path layers (js/layers/types/path.js): Bézier geometry painted with a fill
// and a stroke. Points are stored in layer-local px around the origin the
// layer transform places; every geometry change re-centers them
// (recenterLayer), so rotation, flip and position stay in the transform.
//
// The body mask is the fill united with the stroke, each only while it
// renders: with fill None the body is the line alone, so the outline wraps
// both sides of it and the shadow is the line's shadow. Outline, shadow,
// bevel and sparkles are raster effects of that body, as text derives them
// from its glyphs. Preview spans and the export read the same masks.
//
// A resize is baked into the points on release (commitScale), so masks are
// always drawn at 100% and a live drag only CSS-scales the stack.

class PathLayerManager {
	constructor(editor) {
		this.editor = editor;
		this.layerElements = new Map();
		this.layerTransforms = new Map();
		this.measurementCache = createMeasurementCache(4);
		this.maskUrlCache = createMaskUrlCache(64);
		this.slotPicker = new SlotGlitterPicker(editor, {
			type: LayerType.PATH,
			// The paint a gallery pick lands on: the fill while it is on, the
			// stroke of a line that has none.
			defaultSlot: (layer) => (layer?.pathData?.fill?.mode !== 'none' || !layer?.pathData?.stroke ? 'fill' : 'stroke'),
			section: 'pathSettings',
			typeWord: 'path',
			ensureSlot: (layer, key) => this.ensureSlot(layer, key),
			onPicked: (layer) => {
				this.renderLayer(layer);
				this.loadLayerSettings(layer);
			}
		});
		this.setupUI();
		this.fieldHost = this.createFieldHost();
		bindFieldControls(this.fieldHost);
		this.setupEventListeners();
	}

	setupUI() {
		const id = (x) => document.getElementById(x);
		this.ui = {
			summary: id('pathSummary'),
			presets: id('pathStrokePresets'),
			toggleClosed: id('pathToggleClosed'),
			reverse: id('pathReverse'),
			swapEnds: id('pathSwapEnds'),
			editPoints: id('pathEditPoints'),
			capRow: id('pathStrokeCapRow'),
			dashRow: id('pathStrokeDash')?.closest('.property-row') || null,
			gapRow: id('pathStrokeGap')?.closest('.property-row') || null,
			dashOffsetRow: id('pathStrokeDashOffset')?.closest('.property-row') || null,
			endsSet: id('pathStrokeEnds'),
			endSet: id('pathStrokeEndSet'),
			startShapes: id('pathStrokeStartShapes'),
			endShapes: id('pathStrokeEndShapes'),
			startSizeRow: id('pathStrokeStartSize')?.closest('.property-row') || null,
			endSizeRow: id('pathStrokeEndSize')?.closest('.property-row') || null,
			resetEffects: id('resetPathEffects')
		};
	}

	// How the declared field binder (ui/paint-slot-controls.js) edits a path.
	createFieldHost() {
		return {
			type: LayerType.PATH,
			editor: this.editor,
			getLayer: () => this.getActiveLayer(),
			ensureSlot: (layer, key) => this.ensureSlot(layer, key),
			getSlotDefaults: (key) => getSlotDefaults(LayerType.PATH, key),
			apply: (layer, mutate, change) => {
				mutate();
				this.renderLayer(layer);
				if (change.live) return;
				this.loadLayerSettings(layer);
				this.editor.saveState('Edit path');
				this.editor.layerManager.renderLayersList();
			},
			render: (layer) => this.renderLayer(layer),
			commit: () => {
				this.editor.saveState('Edit path');
				this.editor.layerManager.renderLayersList();
			},
			armPicker: (key) => this.slotPicker.arm(key),
			getArmedSlot: (layer) => this.slotPicker.getArmedSlot(layer)
		};
	}

	setupEventListeners() {
		this.ui.toggleClosed?.addEventListener('click', () => this.editGeometry((subpaths) => {
			const closed = subpaths.every((subpath) => subpath.closed);
			subpaths.forEach((subpath) => { subpath.closed = !closed && subpath.points.length > 2; });
		}, 'Close path'));
		this.ui.reverse?.addEventListener('click', () => this.editGeometry((subpaths) => {
			subpaths.forEach((subpath) => PathGeometry.reverseSubpath(subpath));
		}, 'Reverse path'));
		this.ui.swapEnds?.addEventListener('click', () => this.edit((layer) => {
			const stroke = layer.pathData.stroke;
			if (!stroke) return false;
			[stroke.startShapeId, stroke.endShapeId] = [stroke.endShapeId, stroke.startShapeId];
			[stroke.startSize, stroke.endSize] = [stroke.endSize, stroke.startSize];
			return true;
		}, 'Swap line ends'));
		this.ui.editPoints?.addEventListener('click', () => {
			const layer = this.getActiveLayer();
			if (layer) this.editor.pathEdit?.begin(layer);
		});
		document.getElementById('shapeConvertToPath')?.addEventListener('click', () => COMMANDS.convertShapeToPath.run(this.editor));
		this.ui.resetEffects?.addEventListener('click', () => this.edit((layer) => {
			const data = layer.pathData;
			data.border = null;
			data.shadow = null;
			data.bevel = buildDefaultBevel();
			data.sparkles = null;
			if (data.effectDrafts) ['border', 'shadow', 'sparkles'].forEach((key) => { delete data.effectDrafts[key]; });
			return true;
		}));
	}

	// One committed edit of the active path's own data (not a declared field).
	edit(mutate, label = 'Edit path') {
		const layer = this.getActiveLayer();
		if (!layer || !this.editor.canEditLayer(layer, { notify: true })) return;
		if (mutate(layer) === false) return;
		this.renderLayer(layer);
		this.loadLayerSettings(layer);
		this.editor.layerManager.renderLayersList();
		this.editor.saveState(label);
	}

	// One committed edit of the active path's geometry, in place.
	editGeometry(mutate, label) {
		this.edit((layer) => {
			mutate(layer.pathData.subpaths);
			layer.pathData.subpaths.forEach((subpath) => PathGeometry.solveAutoHandles(subpath));
			this.recenterLayer(layer);
			this.editor.pathEdit?.syncAfterExternalEdit(layer.id);
			return true;
		}, label);
	}

	// ===== DEFAULTS / DATA MODEL =====

	ensureSlot(layer, key) {
		if (!layer?.pathData) return null;
		return ensureLayerPaintSlot(layer, key, () => getSlotDefaults(LayerType.PATH, key));
	}

	// Runs where a path enters the document (create, deserialize, project
	// load). Getters and render paths read the canonical shape directly.
	normalizeLayer(layer) {
		if (layer?.type !== LayerType.PATH) return;
		const data = layer.pathData ||= {};
		data.subpaths = PathGeometry.normalizeSubpaths(data.subpaths);
		data.fillRule = data.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
		data.fill = mergeSlotEffectDefaults(data.fill, getSlotDefaults(LayerType.PATH, 'fill'));
		if (data.stroke === undefined) data.stroke = null;
		if (data.stroke) {
			data.stroke = mergeSlotEffectDefaults(data.stroke, getSlotDefaults(LayerType.PATH, 'stroke'));
			data.stroke.edgeStyle = getStrokeEdgeStyle(data.stroke);
			data.stroke.cap = getStrokeCap(data.stroke);
			data.stroke.dashStyle = getStrokeDashStyle(data.stroke);
			STROKE_ENDS.forEach((end) => {
				if (!ShapeLibrary.getOrnament(data.stroke[`${end}ShapeId`])) data.stroke[`${end}ShapeId`] = null;
			});
		}
		if (data.border === undefined) data.border = null;
		if (data.border) data.border = mergeSlotEffectDefaults(data.border, getSlotDefaults(LayerType.PATH, 'border'));
		if (data.shadow === undefined) data.shadow = null;
		if (data.shadow) data.shadow = mergeSlotEffectDefaults(data.shadow, getSlotDefaults(LayerType.PATH, 'shadow'));
		data.bevel ||= buildDefaultBevel();
		data.bevel.highlight = mergeSlotEffectDefaults(data.bevel.highlight, buildDefaultBevel().highlight);
		data.bevel.shade = mergeSlotEffectDefaults(data.bevel.shade, buildDefaultBevel().shade);
		normalizeBevelData(data.bevel.highlight);
		data.sparkles = normalizeSparklesData(data.sparkles);
		[data.fill, data.stroke, data.border, data.shadow, data.bevel.highlight, data.bevel.shade].forEach((slot) => normalizeSlotTextureCoordinates(slot));
		layer.transform ||= createDefaultTransform();
	}

	// The one way a path is made. `subpaths` are in canvas px; the layer is
	// placed so they stay where they are. With none, a default line is centered
	// on the canvas. An open path defaults to a stroke and no fill, a closed
	// one to a fill and no stroke; `stroke` and `fill` are partial slot data
	// over those defaults (`stroke: null` for none).
	createLayer(options = {}) {
		if (!this.editor.layerManager.requireLayerCapacity()) return null;
		const canvas = this.editor.originalCanvas;
		let subpaths = PathGeometry.normalizeSubpaths(options.subpaths);
		if (!subpaths.length) {
			const half = Math.min(CONFIG.tools.path.line.defaultLength, canvas.width * 0.6) / 2;
			const center = { x: Math.round(canvas.width / 2), y: Math.round(canvas.height / 2) };
			subpaths = PathGeometry.normalizeSubpaths([{ closed: false, points: [
				{ x: center.x - Math.round(half), y: center.y },
				{ x: center.x + Math.round(half), y: center.y }
			] }]);
		}
		const closed = subpaths.every((subpath) => subpath.closed);
		const fill = { ...getSlotDefaults(LayerType.PATH, 'fill'), ...(closed ? {} : { mode: 'none' }), ...(options.fill || {}) };
		let stroke = closed ? null : getSlotDefaults(LayerType.PATH, 'stroke');
		if (options.stroke === null) stroke = null;
		else if (options.stroke) stroke = { ...getSlotDefaults(LayerType.PATH, 'stroke'), ...options.stroke };

		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.PATH,
			name: options.name || 'Path',
			visible: true,
			locked: false,
			opacity: FIELDS.layerOpacity.value,
			transform: createDefaultTransform({ position: { x: 0, y: 0 } }),
			pathData: {
				subpaths,
				fillRule: 'nonzero',
				fill,
				stroke,
				border: null,
				shadow: null,
				bevel: buildDefaultBevel()
			}
		};
		this.normalizeLayer(layer);
		this.recenterLayer(layer);
		if (options.position) {
			layer.transform.position.x = options.position.x;
			layer.transform.position.y = options.position.y;
		}
		return layer;
	}

	// Replace a shape layer with a path of the same outline, in its place in
	// the stack: its transform, and every paint slot the two types share by
	// key (fill, outline, shadow, bevel, sparkles, parked drafts). An image
	// fill has no path equivalent and becomes the slot's color.
	convertShapeLayer(shape) {
		if (shape?.type !== LayerType.SHAPE || !this.editor.canEditLayer(shape, { notify: true })) return null;
		const shapeManager = this.editor.shapeGlitterManager;
		const data = shape.shapeData;
		const corner = LAYER_UI_CONFIG[LayerType.SHAPE].supportsCornerRadius(shape) ? data.cornerRadiusPx : 0;
		const subpaths = ShapeLibrary.getSubpaths(data.shapeId, data.width / 2, data.height / 2, { fit: 'fill', cornerRadiusPx: corner });
		this.editor.layerManager.setActiveLayer(shape.id);
		const layer = this.createLayer({ subpaths, name: shape.name, stroke: null });
		if (!layer) return null;

		// Where the shape's own center is on canvas (its element is padded
		// unevenly by an offset shadow).
		const measurement = shapeManager.getMeasurementEntry(shape);
		const rect = measurement.shapeRect;
		const source = getLayerTransform(shape);
		const scaleX = (source.scale.x / 100) * (source.flipX ? -1 : 1);
		const scaleY = (source.scale.y / 100) * (source.flipY ? -1 : 1);
		const rotation = (source.rotation || 0) * Math.PI / 180;
		const cos = Math.cos(rotation);
		const sin = Math.sin(rotation);
		const place = (x, y) => ({
			x: source.position.x + x * scaleX * cos - y * scaleY * sin,
			y: source.position.y + x * scaleX * sin + y * scaleY * cos
		});
		// createLayer left the geometry's origin at this offset from the
		// shape's center.
		const origin = layer.transform.position;
		const position = place(
			rect.x + rect.width / 2 - measurement.width / 2 + origin.x,
			rect.y + rect.height / 2 - measurement.height / 2 + origin.y
		);
		layer.transform = cloneTransform(source, { position });
		layer.visible = shape.visible;
		layer.opacity = shape.opacity;
		layer.blendMode = shape.blendMode;
		if (shape.animations?.length) layer.animations = structuredClone(shape.animations);

		const shapeSlots = LAYER_UI_CONFIG[LayerType.SHAPE].paintSlots;
		LAYER_UI_CONFIG[LayerType.PATH].paintSlots.forEach((definition) => {
			const twin = shapeSlots.find((entry) => entry.key === definition.key);
			if (!twin) return;
			const slot = readFieldPath(shape, twin.pathKeys);
			writeFieldPath(layer, definition.pathKeys, slot ? structuredClone(slot) : null);
			if (definition.enabledKeys && twin.enabledKeys) writeFieldPath(layer, definition.enabledKeys, Boolean(readFieldPath(shape, twin.enabledKeys)));
			const draft = twin.draftKeys ? readFieldPath(shape, twin.draftKeys) : null;
			if (draft && definition.draftKeys) {
				layer.pathData.effectDrafts ||= {};
				writeFieldPath(layer, definition.draftKeys, structuredClone(draft));
			}
		});
		if (!getPaintSlotDefinition(LayerType.PATH, 'fill').modes.includes(layer.pathData.fill.mode)) layer.pathData.fill.mode = 'solid';
		this.normalizeLayer(layer);
		if (Math.abs(scaleX) !== 1 || Math.abs(scaleY) !== 1) {
			// An unbaked shape scale is baked into the points, as a resize is.
			PathGeometry.scaleSubpaths(layer.pathData.subpaths, Math.abs(scaleX), Math.abs(scaleY));
			layer.transform.scale = { x: 100, y: 100 };
			this.recenterLayer(layer);
		}

		this.editor.layerManager.insertLayer(layer);
		this.editor.layerManager.deleteLayer(shape.id, { skipHistory: true });
		this.editor.layerManager.setActiveLayer(layer.id);
		this.editor.requestPreviewUpdate();
		this.editor.layerManager.renderLayersList();
		this.editor.saveState('Convert to path');
		this.editor.updateStatus('Converted to a path');
		return layer;
	}

	// ===== GEOMETRY =====

	static scaleDocumentGeometry(layer, scaleX, scaleY) {
		PathGeometry.scaleSubpaths(layer.pathData.subpaths, scaleX, scaleY);
	}

	// Bring the points back around the origin after a geometry change and move
	// the layer by the same offset through its rotation and flip, so nothing
	// shifts on canvas.
	recenterLayer(layer) {
		const step = CONFIG.tools.stickers.transform.roundValues ? 1 : undefined;
		const offset = PathGeometry.recenter(layer.pathData.subpaths, step);
		if (!offset.x && !offset.y) return;
		const transform = layer.transform;
		const dx = offset.x * (transform.scale.x / 100) * (transform.flipX ? -1 : 1);
		const dy = offset.y * (transform.scale.y / 100) * (transform.flipY ? -1 : 1);
		const rotation = (transform.rotation || 0) * Math.PI / 180;
		const cos = Math.cos(rotation);
		const sin = Math.sin(rotation);
		transform.position.x += dx * cos - dy * sin;
		transform.position.y += dx * sin + dy * cos;
	}

	// Canvas px <-> path-local px through the layer transform as rendered.
	getPlacement(layer) {
		const { extentX, extentY } = this.getMaskExtents(layer);
		const padding = CONFIG.rendering.maskPaddingPx;
		const box = { width: Math.max(1, (extentX + padding) * 2), height: Math.max(1, (extentY + padding) * 2) };
		const metrics = computeLayerTransform(getLayerTransform(layer), box);
		return { metrics, cos: Math.cos(metrics.rotationRad), sin: Math.sin(metrics.rotationRad) };
	}

	toLocal(layer, point, placement = this.getPlacement(layer)) {
		const { metrics, cos, sin } = placement;
		const dx = point.x - metrics.centerX;
		const dy = point.y - metrics.centerY;
		return {
			x: (dx * cos + dy * sin) / metrics.signedScaleX,
			y: (-dx * sin + dy * cos) / metrics.signedScaleY
		};
	}

	toCanvas(layer, point, placement = this.getPlacement(layer)) {
		const { metrics, cos, sin } = placement;
		const x = point.x * metrics.signedScaleX;
		const y = point.y * metrics.signedScaleY;
		return { x: metrics.centerX + x * cos - y * sin, y: metrics.centerY + x * sin + y * cos };
	}

	// The layer's geometry in canvas px: what the point editor reads and
	// writes, so it never has to follow the points' re-centering.
	readCanvasSubpaths(layer) {
		const placement = this.getPlacement(layer);
		const origin = this.toCanvas(layer, { x: 0, y: 0 }, placement);
		const vector = (handle) => {
			if (!handle) return null;
			const tip = this.toCanvas(layer, handle, placement);
			return { x: tip.x - origin.x, y: tip.y - origin.y };
		};
		return layer.pathData.subpaths.map((subpath) => ({
			closed: subpath.closed,
			points: subpath.points.map((point) => ({
				...this.toCanvas(layer, point, placement),
				in: vector(point.in),
				out: vector(point.out),
				type: point.type
			}))
		}));
	}

	writeCanvasSubpaths(layer, subpaths) {
		const placement = this.getPlacement(layer);
		const origin = this.toLocal(layer, { x: placement.metrics.centerX, y: placement.metrics.centerY }, placement);
		const vector = (handle) => {
			if (!handle) return null;
			const tip = this.toLocal(layer, { x: placement.metrics.centerX + handle.x, y: placement.metrics.centerY + handle.y }, placement);
			return { x: tip.x - origin.x, y: tip.y - origin.y };
		};
		layer.pathData.subpaths = PathGeometry.normalizeSubpaths(subpaths.map((subpath) => ({
			closed: subpath.closed,
			points: subpath.points.map((point) => ({
				...this.toLocal(layer, point, placement),
				in: vector(point.in),
				out: vector(point.out),
				type: point.type
			}))
		})));
		this.recenterLayer(layer);
	}

	// What the point editor edits through (js/ui/path-edit.js): a set of
	// subpaths in canvas px. `write` re-renders; a label records history.
	createEditHost(layerId) {
		const getLayer = () => {
			const layer = this.editor.layerManager.getLayerById(layerId);
			return layer?.type === LayerType.PATH ? layer : null;
		};
		return {
			layerId,
			getLayer,
			read: () => {
				const layer = getLayer();
				return layer ? this.readCanvasSubpaths(layer) : [];
			},
			write: (subpaths, { label = null, coalesceKey = null, render = true } = {}) => {
				const layer = getLayer();
				if (!layer) return;
				this.writeCanvasSubpaths(layer, subpaths);
				if (render) this.renderLayer(layer);
				if (!label) return;
				this.loadLayerSettings(layer);
				this.editor.layerManager.renderLayersList();
				this.editor.saveState(label, coalesceKey ? { coalesceKey } : {});
			},
			render: () => {
				const layer = getLayer();
				if (layer) this.renderLayer(layer);
			}
		};
	}

	// ===== MASK / MEASUREMENT =====

	getActiveStroke(layer) {
		const stroke = layer.pathData.stroke;
		return stroke && Number(stroke.widthPx) > 0 ? stroke : null;
	}

	isFillActive(layer) {
		return layer.pathData.fill?.mode !== 'none';
	}

	// The key serializes the geometry: history restore rebuilds layer objects,
	// so only a content key finds a restored layer's masks again.
	getMeasurementCacheKey(layer) {
		const d = layer.pathData;
		return JSON.stringify([
			d.subpaths,
			d.fillRule,
			this.isFillActive(layer),
			getStrokeMaskKey(this.getActiveStroke(layer)),
			d.border ? [d.border.widthPx, getBorderPlacement(d.border), getBorderEdgeStyle(d.border)] : null,
			d.shadow ? getShadowMaskKey(d.shadow) : null,
			shouldUseCrispMaskEdges(),
			CONFIG.rendering.maskAlphaThreshold
		]);
	}

	getMaskExtents(layer) {
		const d = layer.pathData;
		const stroke = this.getActiveStroke(layer);
		const bounds = PathGeometry.getBounds(d.subpaths) || { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
		const reach = stroke ? getStrokeReach(d.subpaths, stroke) : 0;
		const borderReach = getBorderOutsidePadding(d.border);
		const bodyBox = { x: bounds.minX - reach, y: bounds.minY - reach, width: bounds.width + reach * 2, height: bounds.height + reach * 2 };
		const shadowBox = d.shadow ? getShadowSlotBounds(bodyBox, d.shadow) : bodyBox;
		const extentX = Math.ceil(Math.max(
			borderReach - bodyBox.x, bodyBox.x + bodyBox.width + borderReach,
			-shadowBox.x, shadowBox.x + shadowBox.width
		));
		const extentY = Math.ceil(Math.max(
			borderReach - bodyBox.y, bodyBox.y + bodyBox.height + borderReach,
			-shadowBox.y, shadowBox.y + shadowBox.height
		));
		return { bounds, borderReach, extentX, extentY };
	}

	// Rasterize the fill, the stroke and their union (the body) into one padded
	// surface whose center is the path's origin, so the layer transform places
	// the element by the same point the geometry is stored around.
	getMeasurementEntry(layer) {
		const key = this.getMeasurementCacheKey(layer);
		const cached = this.measurementCache.get(key);
		if (cached) return cached;

		const d = layer.pathData;
		const stroke = this.getActiveStroke(layer);
		const fillActive = this.isFillActive(layer);
		const { bounds, borderReach, extentX, extentY } = this.getMaskExtents(layer);
		const surface = allocatePaddedMaskCanvas(
			{ left: -extentX, top: -extentY, right: extentX, bottom: extentY },
			'layers/PathLayerManager'
		);
		const { canvas, ctx, width, height } = surface;
		const originX = surface.layoutX;
		const originY = surface.layoutY;
		// Textures register against the geometry's top-left corner.
		canvas._textureOrigin = { x: originX + bounds.minX, y: originY + bounds.minY };

		const drawFill = (context) => {
			context.save();
			context.fillStyle = '#ffffff';
			context.translate(originX, originY);
			context.fill(PathGeometry.toPath2D(d.subpaths), d.fillRule);
			context.restore();
		};
		let fillCanvas = null;
		let strokeCanvas = null;
		if (stroke) {
			strokeCanvas = buildStrokeMask({ subpaths: d.subpaths }, stroke, { width, height, originX, originY });
			copyMaskTextureOrigin(strokeCanvas, canvas);
		}
		if (fillActive) {
			fillCanvas = stroke ? createMaskCanvasLike(canvas) : canvas;
			const fillCtx = stroke ? fillCanvas.getContext('2d', { willReadFrequently: true }) : ctx;
			drawFill(fillCtx);
			if (shouldUseCrispMaskEdges()) binarizeCanvasAlpha(fillCtx);
		}
		if (stroke) {
			if (fillCanvas) ctx.drawImage(fillCanvas, 0, 0);
			ctx.drawImage(strokeCanvas, 0, 0);
		}

		const geometryRect = { x: originX + bounds.minX, y: originY + bounds.minY, width: bounds.width, height: bounds.height };
		// The body's painted pixels. A path with nothing switched on keeps a
		// box around its geometry so it can still be selected.
		const bodyRect = this.scanInkRect(ctx, width, height) || {
			x: geometryRect.x - 0.5, y: geometryRect.y - 0.5, width: geometryRect.width + 1, height: geometryRect.height + 1
		};
		const frameRect = {
			x: bodyRect.x - borderReach,
			y: bodyRect.y - borderReach,
			width: bodyRect.width + borderReach * 2,
			height: bodyRect.height + borderReach * 2
		};
		const entry = {
			key,
			canvas,
			fillCanvas,
			strokeCanvas,
			width,
			height,
			originX,
			originY,
			geometryRect,
			bodyRect,
			// The layer's frame: the body plus its outline, no shadow.
			frameRect,
			// Every visible pixel: the frame plus the shadow.
			visualRect: d.shadow ? unionRects(frameRect, getShadowSlotBounds(bodyRect, d.shadow)) : frameRect
		};
		canvas._paintBox = geometryRect;
		canvas._shadowBounds = bodyRect;
		return this.measurementCache.set(key, entry);
	}

	// Bounding box of a mask's opaque pixels, or null when it has none.
	scanInkRect(ctx, width, height) {
		const pixels = ctx.getImageData(0, 0, width, height).data;
		const threshold = CONFIG.rendering.maskAlphaThreshold;
		let minX = width, minY = height, maxX = -1, maxY = -1;
		for (let y = 0; y < height; y++) {
			let offset = y * width * 4 + 3;
			for (let x = 0; x < width; x++, offset += 4) {
				if (pixels[offset] < threshold) continue;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				maxY = y;
			}
		}
		if (maxX < 0) return null;
		return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
	}

	// Layer frame (see getLayerFrame): the body plus its outline. A horizontal
	// line's frame has the stroke's height.
	getBodyFrame(layer, measurement = null) {
		if (!layer?.pathData) return null;
		const entry = measurement || this.getMeasurementEntry(layer);
		return frameFromCanvasRect(entry.frameRect, entry.width, entry.height);
	}

	getVisualFrame(layer, measurement = null) {
		if (!layer?.pathData) return null;
		const entry = measurement || this.getMeasurementEntry(layer);
		return frameFromCanvasRect(entry.visualRect, entry.width, entry.height);
	}

	// The preview element's box: the mask surface.
	getElementBox(layer) {
		if (!layer?.pathData) return null;
		const entry = this.getMeasurementEntry(layer);
		return { width: entry.width, height: entry.height };
	}

	// Canvas picking in document px: inside the fill, or within the stroke (and
	// outline) of the line. A path with nothing switched on is picked on its
	// geometry so it can still be selected.
	hitTest(layer, x, y, tolerance = 0) {
		const d = layer.pathData;
		const local = this.toLocal(layer, { x, y });
		if (this.isFillActive(layer) && PathGeometry.containsPoint(d.subpaths, local, d.fillRule)) return true;
		const stroke = this.getActiveStroke(layer);
		const outline = getBorderOutsidePadding(d.border) + tolerance;
		if (PathGeometry.hitTestStroke(d.subpaths, local, (stroke ? stroke.widthPx / 2 : 0) + outline)) return true;
		if (!stroke) return false;
		// An ornament is wider than its line.
		return d.subpaths.some((subpath) => planStrokeSubpath(subpath, stroke).ornaments.some((ornament) => {
			const size = Number(stroke[`${ornament.end}Size`]) * stroke.widthPx;
			return Math.hypot(local.x - ornament.x, local.y - ornament.y) <= size * 0.75 + outline;
		}));
	}

	getSlotStack(layer) {
		return buildSlotStack(layer, (entry) => resolvePaintSlotPreviewSource(this.editor, layer, entry));
	}

	// The mask a slot paints through. Fill and stroke have their own; every
	// effect is derived from the body. An outline always has paint to run
	// under, so it underlaps the body's soft edge.
	getSlotMask(measurement, slot, layer = null) {
		const key = measurement.key;
		if (slot.key === 'fill') return measurement.fillCanvas && { canvas: measurement.fillCanvas, cacheKey: `${key}|fill` };
		if (slot.key === 'stroke') return measurement.strokeCanvas && { canvas: measurement.strokeCanvas, cacheKey: `${key}|stroke` };
		if (slot.role === 'border') {
			const border = slot.data;
			const borderKey = `${border.widthPx}:${getBorderPlacement(border)}:${getBorderEdgeStyle(border)}:${Boolean(border.fillEnclosed)}`;
			if (measurement._borderMaskCache?.key !== borderKey) {
				measurement._borderMaskCache = { key: borderKey, canvas: createBorderMaskCanvas(measurement.canvas, border, { underlap: true }) };
			}
			return { canvas: measurement._borderMaskCache.canvas, cacheKey: `${key}|border:${borderKey}` };
		}
		if (slot.role === 'shadow') {
			return { canvas: createShadowSlotMaskCanvas(measurement.canvas, slot.data), cacheKey: `${key}|shadow:${getShadowMaskKey(slot.data)}` };
		}
		if (slot.role === 'bevel') {
			const bevel = layer?.pathData?.bevel?.highlight || slot.data;
			const bevelKey = `${bevel?.profile}:${bevel?.size}:${bevel?.depth}:${bevel?.angle}:${bevel?.altitude}:${bevel?.soften}`;
			if (measurement._bevelMaskCache?.key !== bevelKey) measurement._bevelMaskCache = { key: bevelKey, ...createBevelMaskCanvases(measurement.canvas, bevel) };
			return { canvas: slot.key === 'bevelShade' ? measurement._bevelMaskCache.shade : measurement._bevelMaskCache.highlight, cacheKey: `${key}|bevel:${bevelKey}:${slot.key}` };
		}
		return null;
	}

	// Every slot mask in local render space, keyed by slot key (the
	// renderSlotMasks contract). Export bakes the shadow offset into its mask;
	// the preview translates the span.
	renderSlotMasks(layer) {
		const measurement = this.getMeasurementEntry(layer);
		const masks = {
			// The compositor requires a fill mask; a fill of None never draws it.
			fill: measurement.fillCanvas || measurement.canvas,
			renderWidth: measurement.width,
			renderHeight: measurement.height,
			measurement
		};
		getLayerPaintSlots(layer).forEach((entry) => {
			if (!entry.renders || entry.key === 'fill' || entry.role === 'sparkles') return;
			const slotMask = this.getSlotMask(measurement, entry, layer)?.canvas || null;
			masks[entry.key] = entry.role === 'shadow' && slotMask
				? createOffsetMaskCanvas(slotMask, getShadowSlotOffset(entry.data).x, getShadowSlotOffset(entry.data).y)
				: slotMask;
		});
		return masks;
	}

	// Sparkles read the body painted with whichever of its paints shows.
	getSparkleHost(layer) {
		const measurement = this.getMeasurementEntry(layer);
		const paint = this.isFillActive(layer) ? layer.pathData.fill : layer.pathData.stroke || layer.pathData.fill;
		return {
			key: `path:${measurement.key}|${getSparkleMaskHostKey(paint)}`,
			width: measurement.width,
			height: measurement.height,
			loadPixels: () => paintSparkleMaskHost(measurement.canvas, paint)
		};
	}

	// ===== PREVIEW RENDER (span stack) =====

	renderContent(layersToShow) {
		const keep = new Set(layersToShow.filter((layer) => layer.type === LayerType.PATH).map((layer) => layer.id));
		Array.from(this.layerElements.keys()).forEach((layerId) => {
			if (!keep.has(layerId)) this.removeLayerElement(layerId);
		});
		layersToShow.forEach((layer) => {
			if (layer.type === LayerType.PATH) this.renderLayer(layer);
		});
	}

	renderLayer(layer) {
		if (layer?.type !== LayerType.PATH) return;
		let wrapper = this.layerElements.get(layer.id);
		let stack = wrapper?.querySelector('.path-layer-stack');
		if (!wrapper) {
			wrapper = document.createElement('div');
			wrapper.className = 'path-layer-element';
			wrapper.dataset.layerId = layer.id;
			wrapper.setAttribute('role', 'img');
		}
		if (!stack) {
			stack = document.createElement('div');
			stack.className = 'path-layer-stack';
			wrapper.replaceChildren(stack);
		}
		if (!wrapper.parentNode) this.editor.canvasElementsContainer.appendChild(wrapper);
		this.layerElements.set(layer.id, wrapper);

		let transform = this.layerTransforms.get(layer.id);
		if (!transform) {
			transform = new LayerTransform(layer, this.editor);
			transform.setupMouseDrag(wrapper);
			this.layerTransforms.set(layer.id, transform);
		}
		transform.layer = layer;
		transform.element = wrapper;

		const measurement = this.getMeasurementEntry(layer);
		reconcileSlotStack(stack, this.getSlotStack(layer), {
			spanClassName: 'path-layer-content',
			width: measurement.width,
			height: measurement.height,
			layer,
			glitterLibrary: this.editor.glitterLibrary,
			getMask: (item) => {
				const mask = this.getSlotMask(measurement, item, layer);
				return mask && { canvas: mask.canvas, url: this.maskUrlCache.get(mask.canvas, mask.cacheKey) };
			}
		});
		reconcileSparkleLayers(stack, layer, { editor: this.editor, width: measurement.width, height: measurement.height });
		syncLayerAnimationPreview(wrapper, layer, this.editor.animationTicker);
		wrapper.setAttribute('aria-label', layer.name || 'Path');
		transform.applyTransform(wrapper, { width: measurement.width, height: measurement.height });

		if (
			layer.id === this.editor.layerManager.activeLayerId
			&& this.editor.currentTool === ToolType.SELECT
			&& !this.editor.layerManager.hasMultiSelection()
			&& !layer.locked
		) {
			if (!transform.isDraggingHandle) transform.createTransformHandles();
		} else {
			transform.removeTransformHandles();
		}
		this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);
		this.editor.pathEdit?.syncChrome();
	}

	// Called by LayerTransform.applyTransform during handle drags: the stack is
	// laid out at the mask's own size and CSS-scaled until the resize is baked.
	syncElementScale(layer, wrapper = this.layerElements.get(layer?.id)) {
		const stack = wrapper?.querySelector('.path-layer-stack');
		if (!stack || !layer?.pathData) return;
		const measurement = this.getMeasurementEntry(layer);
		const scale = getLayerTransform(layer).scale;
		stack.style.width = `${measurement.width}px`;
		stack.style.height = `${measurement.height}px`;
		stack.style.transform = `scale(${(scale.x || 100) / 100}, ${(scale.y || 100) / 100})`;
		syncSlotStackTextureOrigins(stack, this.getSlotStack(layer), layer, (slot) => this.getSlotMask(measurement, slot, layer)?.canvas);
	}

	// ===== TRANSFORM =====

	// Bake a finished resize into the points. Stroke width, dashes and effect
	// sizes are canvas pixels: they follow the resize by how much the geometry
	// itself grew (a line stretched across its thin axis did not), when Scale
	// Outlines & Effects is on.
	commitScale(layer) {
		if (layer?.type !== LayerType.PATH) return;
		const transform = getLayerTransform(layer);
		const sx = (transform.scale.x || 100) / 100;
		const sy = (transform.scale.y || 100) / 100;
		if (Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3) return;
		const subpaths = layer.pathData.subpaths;
		const before = PathGeometry.getBounds(subpaths);
		PathGeometry.scaleSubpaths(subpaths, sx, sy);
		PathGeometry.roundSubpaths(subpaths);
		const after = PathGeometry.getBounds(subpaths);
		const beforeSize = before ? Math.hypot(before.width, before.height) : 0;
		const growth = beforeSize > 0 ? Math.hypot(after.width, after.height) / beforeSize : 1;
		const factors = {
			geometry: growth,
			effect: PREFERENCES.get('scaleEffects') ? growth : 1,
			texture: PREFERENCES.get('scaleTextures') ? growth : 1,
			corner: PREFERENCES.get('scaleCorners') ? growth : 1
		};
		scaleLayerSlotFields(layer, factors);
		scaleLayerFields(layer, factors);
		transform.scale.x = 100;
		transform.scale.y = 100;
		this.recenterLayer(layer);
		this.renderLayer(layer);
		this.loadLayerSettings(layer);
		syncPropertyReverts();
	}

	// Shared transform interface (StickerManager.updateTransform). Panel size
	// edits arrive as a scale and are baked at once.
	updateTransform(layerId, updates) {
		const transform = this.layerTransforms.get(layerId);
		const layer = this.editor.layerManager.getLayerById(layerId);
		if (!transform || !layer) return;
		transform.updateTransform(updates);
		if (updates.scale && !transform.isDraggingHandle && !transform.gestureInteractionActive) {
			this.commitScale(layer);
			return;
		}
		const element = this.layerElements.get(layerId);
		if (element) {
			const measurement = this.getMeasurementEntry(layer);
			transform.applyTransform(element, { width: measurement.width, height: measurement.height });
			if (transform.transformHandles) transform.updateHandlePositions();
		}
		this.editor.pathEdit?.syncChrome();
	}

	// ===== PANEL =====

	// The ornament shapes as a preset-grid library: thumbnails, not names.
	getOrnamentLibrary(end) {
		this.ornamentLibraries ||= {};
		if (this.ornamentLibraries[end]) return this.ornamentLibraries[end];
		this.ornamentLibraries[end] = GlitterPresetLibrary.createPresetLibrary({
			id: `stroke-${end}-ornaments`,
			groups: [{ id: 'ornaments', label: '' }],
			entries: [
				{ id: 'none', label: 'None', group: 'ornaments', value: { shapeId: null } },
				...ShapeLibrary.ORNAMENT_SHAPES.map(({ id, label }) => ({ id, label, group: 'ornaments', value: { shapeId: id } }))
			],
			renderThumbnail(entry, element) {
				element.classList.add('is-drawn');
				element.style.backgroundImage = `url(${getStrokeThumbnail(`${end}:${entry.id}`, { [`${end}ShapeId`]: entry.value.shapeId })})`;
			}
		});
		return this.ornamentLibraries[end];
	}

	loadLayerSettings(layer) {
		if (layer?.type !== LayerType.PATH) return;
		const d = layer.pathData;
		const stroke = d.stroke;
		const shown = stroke || getSlotDefaults(LayerType.PATH, 'stroke');
		const hasOpen = d.subpaths.some((subpath) => !subpath.closed);
		const allClosed = d.subpaths.length > 0 && !hasOpen;
		const presetId = findStrokePresetId(stroke);

		if (this.ui.summary) {
			const points = PathGeometry.countPoints(d.subpaths);
			this.ui.summary.textContent = `${allClosed ? 'Closed' : 'Open'}, ${points} ${points === 1 ? 'point' : 'points'}`;
		}
		if (this.ui.toggleClosed) {
			this.ui.toggleClosed.querySelector('.name').textContent = allClosed ? 'Open path' : 'Close path';
			this.ui.toggleClosed.disabled = !allClosed && !d.subpaths.some((subpath) => subpath.points.length > 2);
		}
		if (this.ui.swapEnds) this.ui.swapEnds.hidden = !hasOpen || !stroke;
		// Caps and ends belong to open paths; their settings are kept while
		// the path is closed.
		if (this.ui.capRow) this.ui.capRow.hidden = !hasOpen;
		if (this.ui.endsSet) this.ui.endsSet.hidden = !hasOpen;
		if (this.ui.endSet) this.ui.endSet.hidden = !hasOpen;
		const dashStyle = getStrokeDashStyle(shown);
		if (this.ui.dashRow) this.ui.dashRow.hidden = dashStyle !== 'dashed';
		if (this.ui.gapRow) this.ui.gapRow.hidden = dashStyle === 'solid';
		if (this.ui.dashOffsetRow) this.ui.dashOffsetRow.hidden = dashStyle === 'solid';
		if (this.ui.startSizeRow) this.ui.startSizeRow.hidden = !shown.startShapeId;
		if (this.ui.endSizeRow) this.ui.endSizeRow.hidden = !shown.endShapeId;

		if (this.ui.presets) {
			GlitterPresetLibrary.renderPresetGrid(this.ui.presets, STROKE_PRESETS, {
				activeId: presetId,
				contextId: 'path',
				onChoose: (entry) => this.edit((active) => {
					STROKE_PRESETS.apply(entry, this.ensureSlot(active, 'stroke'));
					return true;
				}, 'Line preset')
			});
		}
		STROKE_ENDS.forEach((end) => {
			const grid = this.ui[`${end}Shapes`];
			if (!grid) return;
			GlitterPresetLibrary.renderPresetGrid(grid, this.getOrnamentLibrary(end), {
				activeId: shown[`${end}ShapeId`] || 'none',
				contextId: `path-${end}`,
				onChoose: (entry) => this.edit((active) => {
					this.ensureSlot(active, 'stroke')[`${end}ShapeId`] = entry.value.shapeId;
					return true;
				})
			});
		});

		this.editor.loadTransformSettings?.(layer, 'path');
		syncFieldControls(this.fieldHost, layer);
		this.editor.pathEdit?.syncPanel();
		syncPropertyReverts();
	}

	// ===== HOUSEKEEPING =====

	releaseLayerResources(layer) {
		this.removeLayerElement(layer?.id);
	}

	buildExportPlan(layer, context) {
		return context.compositor._buildSlotStackExportPlan(layer);
	}
}

Object.assign(PathLayerManager.prototype, MOVABLE_LAYER_METHODS);

PathLayerManager.LAYER_TYPE = LayerType.PATH;
Object.assign(PathLayerManager.prototype, { getActiveLayer: LAYER_ELEMENT_METHODS.getActiveLayer, clearElements: LAYER_ELEMENT_METHODS.clearElements, removeLayerElement: LAYER_ELEMENT_METHODS.removeLayerElement });
