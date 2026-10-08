// ============================================
// TEXT GLITTER MANAGER CLASS
// Handles text glitter layer rendering, font loading, and text settings
// ============================================
class TextGlitterManager {
	constructor(editor) {
		this.editor = editor;

		this.layerElements = new Map();
		this.layerTransforms = new Map();

		this.textMaskCache = new Map();
		// Preview mask data URL per layer id and mask bucket (fill, border, ...),
		// each keyed by content. Dropped when the layer's element is removed.
		// Keyed `${layerId}|${maskType}`; rebuilt on demand, so in the preview budget.
		this.previewMaskUrls = new ByteBudgetCache({
			id: 'text-preview-masks',
			label: 'Text preview mask URLs',
			measure: (entry) => (entry?.url?.length || 0) * 2
		});
		this.measureCanvas = createAppCanvas(0, 0, 'layers/TextGlitterManager');
		this.measureCtx = this.measureCanvas.getContext('2d');

		this.textInputTimer = null;

		// Picker session (D-1c): the gallery's armed destination, nullable and
		// layer-bound. `null` = BROWSE MODE — a gallery click applies to the
		// active layer's own fill (the only implicit destination anyone expects).
		// `{ layerId, slot }` = PICKER MODE — entered only by an explicit arming
		// gesture (chip / Change / Use Glitter), cleared on layer switch, effect
		// disable, history restore, Done, or Esc. Because the session names its
		// layer, a mismatch with the active layer is structurally treated as
		// browse mode — the old sticky-target layer-switch trap is impossible.
		//
		// This is pure UI state. The exporter never reads it: per-slot paint
		// resolution (resolvePaintSlotSource, shared with SceneCompositor) depends
		// only on layer.textData, so preview↔export parity is unaffected.
		this.pickerSession = null;
		this.slotPicker = createManagerSlotPicker(this, {
			type: LayerType.TEXT_GLITTER, defaultSlot: 'fill', typeWord: 'text',
			onPicked: (layer, id) => {
				return this.refreshLayer(layer, { saveHistory: false, refreshLayerList: false, refreshPreview: false });
			}
		});
	}

	async init() {
		this.setupUI();
		this.setupEventListeners();
		this.setupTextEditing();
		this.setupTextActions();
	}

	setupUI() {
		this.ui = {
			section: document.getElementById('textSettingsSection'),
			textInput: document.getElementById('textLayerInput'),
			fontThumbnail: document.getElementById('textFontThumbnail'),
			fontName: document.getElementById('textFontName'),
			fontChange: document.getElementById('textFontChange'),
			fontBold: document.getElementById('textFontBold'),
			fontItalic: document.getElementById('textFontItalic'),
			textCaseSelect: document.getElementById('textCaseSelect'),
			orientationButtons: Array.from(document.querySelectorAll('[data-text-orientation]')),
			warpPresets: document.getElementById('textWarpPresets'),
			warpBendRow: document.getElementById('textWarpBendRow'),
			warpSummary: document.getElementById('textWarpSummary'),
			alignButtons: Array.from(document.querySelectorAll('[data-text-align]')),
			verticalAlignButtons: Array.from(document.querySelectorAll('[data-text-valign]')),
			boxModeButtons: Array.from(document.querySelectorAll('[data-text-box-mode]')),
			boxModeHint: document.getElementById('textBoxModeHint'),
			fitBoxToContent: document.getElementById('textFitBoxToContent'),
			bgModeLines: document.getElementById('textBackgroundModeLines'),
			bgModeBounds: document.getElementById('textBackgroundModeBounds'),
			bgModeBox: document.getElementById('textBackgroundModeBox'),
			bgConnSeparate: document.getElementById('textBackgroundConnectionSeparate'),
			bgConnMerge: document.getElementById('textBackgroundConnectionMerge'),
			bgConnConnected: document.getElementById('textBackgroundConnectionConnected'),
			bgMergeDistance: document.getElementById('textBackgroundMergeDistance'),
			bgPreset: document.getElementById('textBackgroundPreset'),
			resetEffects: document.getElementById('resetTextEffects'),
			// D-1c gallery picker strip
			gallerySection: document.getElementById('designGallerySection'),
			pickerStrip: document.getElementById('galleryPickerStrip'),
			pickerStripTitle: document.getElementById('galleryPickerStripTitle'),
			pickerStripDetail: document.getElementById('galleryPickerStripDetail'),
			pickerStripDone: document.getElementById('galleryPickerStripDone')
		};
	}

	// How the declared field binder (ui/paint-slot-controls.js) edits text: every
	// change re-measures the text around its point anchor. Live edits skip
	// history and re-render the whole preview only when the footprint changes.
	createFieldHost() {
		return {
			type: LayerType.TEXT_GLITTER,
			editor: this.editor,
			getLayer: () => this.getActiveTextLayer(),
			ensureSlot: (layer, key) => ensureLayerPaintSlot(layer, key, () => getSlotDefaults(LayerType.TEXT_GLITTER, key)),
			getSlotDefaults: (key) => getSlotDefaults(LayerType.TEXT_GLITTER, key),
			apply: (layer, mutate, change) => this.runLayoutRefreshWithAnchor(layer, mutate, change.live
				? { saveHistory: false, refreshLayerList: false, refreshPreview: Boolean(change.geometry), isCurrent: change.ticket?.isCurrent }
				: { saveHistory: true, refreshPreview: false }
			).catch((error) => this.reportFontLoadError(error)),
			render: (layer) => this.renderLayer(layer),
			// Bend can move the warp onto or off a preset tile mid-drag.
			afterFieldChange: (layer, key, binding) => {
				if (binding?.path === 'textData.warp.bend') this.syncWarpUI(layer, { live: true });
			},
			commit: () => {
				if (this.editSession) this.editSession.dirty = true;
				else this.editor.saveState('Edit text');
				this.editor.layerManager.renderLayersList();
			},
			armPicker: (key) => this.armPicker(key),
			getArmedSlot: (layer) => this.getGlitterSelectionTarget(layer),
			// The gallery can't stay armed for a slot that no longer exists.
			onSlotDisabled: (layer, key) => {
				if (this.pickerSession?.layerId === layer.id && this.pickerSession?.slot === key) {
					this.closePickerSession();
				}
			}
		};
	}

	setupEventListeners() {
		this.fieldHost = this.createFieldHost();
		bindFieldControls(this.fieldHost);

		if (this.ui.textInput) {
			this.ui.textInput.addEventListener('input', (event) => {
				if (event.isComposing) return;
				const layer = this.getActiveTextLayer();
				if (!layer) return;

				this.applyTextEdit(layer, this.ui.textInput.value, { start: this.ui.textInput.selectionStart, end: this.ui.textInput.selectionEnd });
			});
			this.ui.textInput.addEventListener('compositionend', () => this.applyTextEdit(this.getActiveTextLayer(), this.ui.textInput.value, { start: this.ui.textInput.selectionStart, end: this.ui.textInput.selectionEnd }));
		}

		// The current-font row opens the Library's Fonts in picker mode.
		[this.ui.fontThumbnail, this.ui.fontChange].filter(Boolean).forEach((control) => {
			control.addEventListener('click', () => this.editor.fontBrowserManager?.openPicker());
		});

		this.ui.textCaseSelect?.addEventListener('change', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;
			await this.runLayoutRefreshWithAnchor(layer, () => { layer.textData.textCase = this.ui.textCaseSelect.value; }, { saveHistory: true });
		});

		// One layout edit: mutate, re-measure around the anchor, record history.
		const editLayout = async (layer, mutate, options = {}) => {
			try {
				await this.runLayoutRefreshWithAnchor(layer, mutate, { saveHistory: true, ...options });
			} catch (error) {
				this.reportFontLoadError(error);
			}
		};

		this.ui.orientationButtons.forEach(button => {
			button.addEventListener('click', () => {
				const layer = this.getActiveTextLayer();
				if (!layer || layer.textData.orientation === button.dataset.textOrientation) return;
				editLayout(layer, () => { layer.textData.orientation = button.dataset.textOrientation; });
			});
		});

		this.ui.verticalAlignButtons.forEach((button) => {
			button.addEventListener('click', () => {
				const layer = this.getActiveTextLayer();
				const verticalAlign = button.dataset.textValign;
				if (!layer || !verticalAlign || verticalAlign === layer.textData.verticalAlign) return;
				editLayout(layer, () => { layer.textData.verticalAlign = verticalAlign; });
			});
		});

		this.ui.boxModeButtons.forEach((button) => {
			button.addEventListener('click', () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;
				const nextMode = button.dataset.textBoxMode;
				if (!nextMode || nextMode === (layer.textData.boxMode || 'point')) return;
				editLayout(layer, () => {
					if (nextMode !== 'point') {
						this.ensureFixedBox(layer);
						layer.textData.boxMode = nextMode;
						if (nextMode === 'autoHeight') delete layer.textData.boxHeight;
					} else {
						layer.textData.boxMode = 'point';
						delete layer.textData.boxWidth;
						delete layer.textData.boxHeight;
						// Text Box backgrounds need a box; fall back to text bounds.
						this.normalizeTextBackground(layer);
					}
				}, { preservePointAnchor: true });
			});
		});

		this.ui.fitBoxToContent?.addEventListener('click', () => {
			const layer = this.getActiveTextLayer();
			if (layer) editLayout(layer, () => this.fitBoxToText(layer));
		});

		this.ui.resetEffects?.addEventListener('click', async () => {
			const layer = this.getActiveTextLayer();
			if (!layer) return;
			await editLayout(layer, () => {
				layer.textData.border = null;
				layer.textData.shadow = null;
				layer.textData.bevel = buildDefaultBevel();
				layer.textData.sparkles = null;
				layer.textData.textBackground = this.getDefaultTextBackground();
				delete layer.textData.effectDrafts;
			}, { refreshPreview: false });
		});

		// Text Background shape options. Its toggle, source and geometry sliders
		// are declared fields (js/layers/types/text.js); the toggle flips
		// `textBackground.enabled` so the geometry survives being switched off.
		const bindBackgroundOption = (button, key, value) => {
			button?.addEventListener('click', () => {
				const layer = this.getActiveTextLayer();
				if (!layer || layer.textData.textBackground[key] === value) return;
				editLayout(layer, () => {
					layer.textData.textBackground[key] = value;
					this.normalizeTextBackground(layer);
				}, { refreshPreview: false });
			});
		};
		bindBackgroundOption(this.ui.bgModeLines, 'mode', 'lines');
		bindBackgroundOption(this.ui.bgModeBounds, 'mode', 'text-bounds');
		bindBackgroundOption(this.ui.bgModeBox, 'mode', 'text-box');
		bindBackgroundOption(this.ui.bgConnSeparate, 'lineConnection', 'separate');
		bindBackgroundOption(this.ui.bgConnMerge, 'lineConnection', 'merge-adjacent');
		bindBackgroundOption(this.ui.bgConnConnected, 'lineConnection', 'connected');

		this.ui.bgPreset?.addEventListener('change', () => {
			const layer = this.getActiveTextLayer();
			const presetKey = this.ui.bgPreset.value;
			if (!layer || !presetKey) return;
			editLayout(layer, () => this.applyTextBackgroundPreset(layer, presetKey), { refreshPreview: false });
		});
	}

	getPointAnchorSnapshot(layer) {
		if (!layer?.textData) return null;

		return {
			world: layer.textData.boxMode === 'autoHeight' ? getLayerAnchorPoint(this.editor, layer) : this.getTextOriginWorldPosition(layer),
			transformAnchor: layer.textData.boxMode === 'autoHeight'
		};
	}

	preparePendingAnchorPreservation(layer) {
		if (!layer || layer._pendingPointAnchorSnapshot
			|| !['point', 'autoHeight'].includes(layer.textData?.boxMode)) return;
		layer._pendingPointAnchorSnapshot = this.getPointAnchorSnapshot(layer);
	}

	async runLayoutRefreshWithAnchor(layer, mutateFn, options = {}) {
		const snapshot = (['point', 'autoHeight'].includes(layer.textData?.boxMode) || options.preservePointAnchor)
			? this.getPointAnchorSnapshot(layer)
			: null;
		if (this.editSession) this.editSession.dirty = true;
		await mutateFn();
		return this.refreshLayer(layer, {
			...options,
			preservePointAnchorFrom: snapshot
		});
	}

	getFrameAnchorLocalPoint(frame, align = 'left') {
		const left = frame.offsetX - frame.width / 2;
		const right = frame.offsetX + frame.width / 2;
		const top = frame.offsetY - frame.height / 2;
		if (align === 'center') {
			return { x: frame.offsetX, y: top };
		}
		if (align === 'right') {
			return { x: right, y: top };
		}
		return { x: left, y: top };
	}

	getWorldPointFromLocal(transform, localPoint) {
		const scaleX = (transform.scale.x || 100) / 100 * (transform.flipX ? -1 : 1);
		const scaleY = (transform.scale.y || 100) / 100 * (transform.flipY ? -1 : 1);
		const rotationRad = (transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);
		return {
			x: transform.position.x + localPoint.x * scaleX * cos - localPoint.y * scaleY * sin,
			y: transform.position.y + localPoint.x * scaleX * sin + localPoint.y * scaleY * cos
		};
	}

	setWorldPointFromLocal(transform, localPoint, worldPoint) {
		const scaleX = (transform.scale.x || 100) / 100 * (transform.flipX ? -1 : 1);
		const scaleY = (transform.scale.y || 100) / 100 * (transform.flipY ? -1 : 1);
		const rotationRad = (transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);

		transform.position.x = worldPoint.x - (localPoint.x * scaleX * cos - localPoint.y * scaleY * sin);
		transform.position.y = worldPoint.y - (localPoint.x * scaleX * sin + localPoint.y * scaleY * cos);
	}

	getPointAnchorWorldPosition(layer, frame = this.getTextFrame(layer)) {
		if (!frame) {
			return { ...getLayerTransform(layer).position };
		}
		const localPoint = this.getFrameAnchorLocalPoint(frame, layer.textData.align || 'left');
		return this.getWorldPointFromLocal(getLayerTransform(layer), localPoint);
	}

	setPointAnchorWorldPosition(layer, worldPoint, frame = this.getTextFrame(layer)) {
		if (!worldPoint || !frame) return;

		const localPoint = this.getFrameAnchorLocalPoint(frame, layer.textData.align || 'left');
		this.setWorldPointFromLocal(getLayerTransform(layer), localPoint, worldPoint);
	}

	getFrameCenterWorldPosition(layer, frame = this.getTextFrame(layer)) {
		if (!frame) {
			return { ...getLayerTransform(layer).position };
		}

		return this.getWorldPointFromLocal(getLayerTransform(layer), {
			x: frame.offsetX,
			y: frame.offsetY
		});
	}

	setFrameCenterWorldPosition(layer, worldPoint, frame = this.getTextFrame(layer)) {
		if (!worldPoint || !frame) return;

		this.setWorldPointFromLocal(getLayerTransform(layer), {
			x: frame.offsetX,
			y: frame.offsetY
		}, worldPoint);
	}

	applyPointAnchorSnapshot(layer, snapshot, measurement = null) {
		if (!snapshot || !layer?.textData) return;
		if (snapshot.transformAnchor) {
			const after = getLayerAnchorPoint(this.editor, layer);
			layer.transform.position.x += snapshot.world.x - after.x;
			layer.transform.position.y += snapshot.world.y - after.y;
		} else this.setTextOriginWorldPosition(layer, snapshot.world, measurement);
	}

	getTextOriginLocalPoint(layer, measurement = null) {
		const entry = measurement || this.getMeasurementEntry(layer);
		const align = layer.textData.align || 'left';
		const x = entry.layoutOffsetX + (
			align === 'center'
				? entry.layoutWidth / 2
				: align === 'right'
					? entry.layoutWidth
					: 0
		);
		return {
			x: x - entry.width / 2,
			y: entry.layoutOffsetY + entry.contentOffsetY + entry.ascent - entry.height / 2
		};
	}

	getTextOriginWorldPosition(layer, measurement = null) {
		return this.getWorldPointFromLocal(
			getLayerTransform(layer),
			this.getTextOriginLocalPoint(layer, measurement)
		);
	}

	setTextOriginWorldPosition(layer, worldPoint, measurement = null) {
		if (!worldPoint) return;
		this.setWorldPointFromLocal(
			getLayerTransform(layer),
			this.getTextOriginLocalPoint(layer, measurement),
			worldPoint
		);
	}

	// Effects default to GLITTER using the per-effect default id so the slot
	// shows a real glitter (not the "No glitter selected" solid placeholder) the
	// moment it's enabled. See buildDefaultBorder in effects/slot-effects.js.

	// textBackground.fill is its own full paint slot (scale/colorAdjust
	// included, like border/shadow) — the canonical Fill representation, not a
	// Text Background-specific paint model.

	// Geometry defaults to the "Instagram" preset (TEXT_BACKGROUND_PRESETS,
	// matches TEXT_BACKGROUND_PRESET_OPTIONS' default selection) rather than
	// raw slider defaults, so a freshly enabled background already looks like a
	// deliberate choice instead of the placeholder-preset "Choose a preset…" state.
	getDefaultTextBackground() {
		return buildDefaultTextBackground();
	}

	getMinBoxSize() {
		return Math.max(1, Math.round(CONFIG.tools.text.minBoxSize));
	}

	// Runs where a text layer enters the document (create, deserialize, project
	// load). Getters and render paths read the canonical shape directly.
	normalizeLayer(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER || !layer.textData) return;
		layer.transform ||= createDefaultTransform();
		if (layer.textData.border === undefined) {
			layer.textData.border = null;
		}
		if (layer.textData.border) {
			layer.textData.border = mergeSlotEffectDefaults(layer.textData.border, getSlotDefaults(LayerType.TEXT_GLITTER, 'border'));
		}
		if (layer.textData.shadow === undefined) {
			layer.textData.shadow = null;
		}
		if (layer.textData.shadow) {
			layer.textData.shadow = mergeSlotEffectDefaults(layer.textData.shadow, getSlotDefaults(LayerType.TEXT_GLITTER, 'shadow'));
		}
		layer.textData.bevel ||= buildDefaultBevel();
		layer.textData.bevel.highlight = mergeSlotEffectDefaults(layer.textData.bevel.highlight, buildDefaultBevel().highlight);
		layer.textData.bevel.shade = mergeSlotEffectDefaults(layer.textData.bevel.shade, buildDefaultBevel().shade);
		normalizeBevelData(layer.textData.bevel.highlight);
		layer.textData.sparkles = normalizeSparklesData(layer.textData.sparkles);
		layer.textData.fill = mergeSlotEffectDefaults(layer.textData.fill, getSlotDefaults(LayerType.TEXT_GLITTER, 'fill'));
		normalizeSlotTextureCoordinates(layer.textData.fill);
		normalizeSlotTextureCoordinates(layer.textData.border);
		normalizeSlotTextureCoordinates(layer.textData.shadow);
		normalizeSlotTextureCoordinates(layer.textData.bevel.highlight);
		normalizeSlotTextureCoordinates(layer.textData.bevel.shade);
		if (!isOptionValue('textBoxMode', layer.textData.boxMode)) {
			layer.textData.boxMode = CONFIG.tools.text.defaultBoxMode;
		}
		if (!layer.textData.verticalAlign) {
			layer.textData.verticalAlign = CONFIG.tools.text.defaultVerticalAlign;
		}
		if (layer.textData.boxMode === 'autoHeight') delete layer.textData.boxHeight;
		if (!isOptionValue('textAlign', layer.textData.align)) layer.textData.align = 'left';
		if (!isOptionValue('textVerticalAlign', layer.textData.verticalAlign)) layer.textData.verticalAlign = CONFIG.tools.text.defaultVerticalAlign;
		layer.textData.decoration = { underline: Boolean(layer.textData.decoration?.underline), strikethrough: Boolean(layer.textData.decoration?.strikethrough) };
		layer.textData.colorEmoji = typeof layer.textData.colorEmoji === 'boolean' ? layer.textData.colorEmoji : CONFIG.tools.text.defaultColorEmoji;
		this.normalizeTextBackground(layer);
		if (!layer.textData.lineHeight) {
			layer.textData.lineHeight = FIELDS.textLineHeight.value / 100;
		}
		if (!layer.textData.fontWeight) {
			layer.textData.fontWeight = CONFIG.tools.text.defaultFontWeight;
		}
		if (!layer.textData.fontStyle) {
			layer.textData.fontStyle = CONFIG.tools.text.defaultFontStyle;
		}
		if (!isOptionValue('textOrientation', layer.textData.orientation)) {
			layer.textData.orientation = CONFIG.tools.text.defaultOrientation;
		}
		if (!isOptionValue('textCase', layer.textData.textCase)) {
			layer.textData.textCase = CONFIG.tools.text.defaultTextCase;
		}
		layer.textData.warp = normalizeTextWarp(layer.textData.warp);
	}

	// Defaults, clamping, and the point-vs-box mode
	// guard. `enabled`/`mode`/`lineConnection`/padding/radius/merge fields and
	// `fill` (the canonical Fill shape) are the ONLY persisted state — presets
	// just write into these same fields (see applyTextBackgroundPreset).
	normalizeTextBackground(layer) {
		const defaults = this.getDefaultTextBackground();
		if (!layer.textData.textBackground || typeof layer.textData.textBackground !== 'object') {
			layer.textData.textBackground = defaults;
			return;
		}
		const tb = layer.textData.textBackground;
		tb.enabled = Boolean(tb.enabled);
		if (!TEXT_BACKGROUND_MODES.includes(tb.mode)) tb.mode = defaults.mode;
		if (!TEXT_BACKGROUND_CONNECTIONS.includes(tb.lineConnection)) tb.lineConnection = defaults.lineConnection;
		tb.horizontalPadding = clampNumber(tb.horizontalPadding, 0, 400, defaults.horizontalPadding);
		tb.verticalPadding = clampNumber(tb.verticalPadding, 0, 400, defaults.verticalPadding);
		tb.cornerRadius = clampNumber(tb.cornerRadius, 0, 400, defaults.cornerRadius);
		tb.mergeDistance = clampNumber(tb.mergeDistance, 0, 400, defaults.mergeDistance);
		tb.lineSpacingSensitivity = clampNumber(tb.lineSpacingSensitivity, 0, 100, defaults.lineSpacingSensitivity);
		tb.fill = mergeSlotEffectDefaults(tb.fill, defaults.fill);
		normalizeSlotTextureCoordinates(tb.fill);
		// Point text has no independent container — Text Box can only ever be
		// reached from box text, and a box→point switch must not leave it stuck.
		if (tb.mode === 'text-box' && (layer.textData.boxMode || 'point') === 'point') {
			tb.mode = 'text-bounds';
		}
	}

	// Writes a preset's values into the SAME persisted fields a manual edit
	// would touch (plan: "Selecting a preset should write normal values...
	// Afterward, editing any control simply changes those properties" — no
	// preset identifier is stored). `fill` and `enabled` are left untouched.
	applyTextBackgroundPreset(layer, presetKey) {
		const preset = TEXT_BACKGROUND_PRESETS[presetKey];
		if (!preset) return;
		this.normalizeLayer(layer);
		Object.assign(layer.textData.textBackground, preset);
		this.normalizeTextBackground(layer);
	}

	findMatchingPreset(textBackground) {
		if (!textBackground) return '';
		const match = Object.entries(TEXT_BACKGROUND_PRESETS).find(([, preset]) =>
			Object.entries(preset).every(([field, value]) => textBackground[field] === value)
		);
		return match?.[0] || '';
	}

	ensureFixedBox(layer) {

		if (layer.textData.boxWidth && layer.textData.boxHeight) {
			layer.textData.boxMode = 'fixed';
			return;
		}

		// Convert like Illustrator: the frame captures the current text block
		// exactly (+1px so rounding can't re-wrap the widest line).
		layer.textData.boxMode = 'point';
		const entry = this.getMeasurementEntry(layer);
		layer.textData.boxMode = 'fixed';
		const minBoxSize = this.getMinBoxSize();
		layer.textData.boxWidth = Math.max(minBoxSize, Math.ceil(entry.layoutWidth || entry.textWidth || 1) + 1);
		layer.textData.boxHeight = Math.max(minBoxSize, Math.ceil(entry.layoutHeight || entry.textHeight || 1) + 1);
	}

	// "Fit to Text" for an already-fixed box: shrink-wraps the box to the
	// CURRENTLY WRAPPED lines — width becomes the widest wrapped line, height
	// becomes enough for all of them — the manual, mobile-friendly equivalent
	// of Illustrator's double-click-edge-to-fit gesture. This preserves
	// existing line breaks (both explicit ones and wraps from the old box
	// width) rather than re-flowing into one unwrapped line; it just corrects
	// a box that's now too small (or wastefully large) for its content, e.g.
	// after a font change makes glyphs wider/narrower. entry.lines is the
	// FULL wrapped line list (unlike entry.layoutWidth/Height, which in fixed
	// mode just echo the current boxWidth/boxHeight and don't grow to fit
	// overflowing content).
	fitBoxToText(layer) {
		if (layer.textData.boxMode !== 'fixed') return;

		const fit = this.getFitBoxSize(layer);
		if (!fit) return;

		layer.textData.boxWidth = fit.width;
		layer.textData.boxHeight = fit.height;
	}

	// The box that shrink-wraps the currently wrapped lines (+1px so rounding
	// can't re-wrap the widest line).
	getFitBoxSize(layer) {
		const entry = this.getMeasurementEntry(layer);
		if (!entry.lines.length) return null;

		const minBoxSize = this.getMinBoxSize();
		const fullHeight = layer.textData.orientation === 'stacked' ? entry.layout.contentHeight : entry.ascent + (entry.lines.length - 1) * entry.lineHeightPx + entry.lines.at(-1).descent;
		return {
			width: Math.max(minBoxSize, Math.ceil(entry.layout.contentWidth) + 1),
			height: Math.max(minBoxSize, Math.ceil(fullHeight) + 1)
		};
	}

	// Double-clicking a box edge, like Illustrator: that edge moves to the text
	// while the opposite one stays put. Side edges fit the width, top and bottom
	// the height (which an auto-height box already does).
	fitBoxEdgeToText(layer, edge) {
		if (!this.canResizeBoxEdges(layer)) return false;
		const horizontal = edge === 'left' || edge === 'right';
		if (!horizontal && layer.textData.boxMode !== 'fixed') return false;

		const fit = this.getFitBoxSize(layer);
		if (!fit) return false;
		if (horizontal ? fit.width === layer.textData.boxWidth : fit.height === layer.textData.boxHeight) return false;

		const dragState = { transform: getLayerTransform(layer), textResizeEdge: edge };
		const metrics = this.getBoxResizeMetrics(layer, dragState);
		const rect = {
			left: -metrics.baseDisplayWidth / 2,
			right: metrics.baseDisplayWidth / 2,
			top: -metrics.baseDisplayHeight / 2,
			bottom: metrics.baseDisplayHeight / 2
		};
		if (edge === 'right') rect.right = rect.left + fit.width * metrics.scaleX;
		else if (edge === 'left') rect.left = rect.right - fit.width * metrics.scaleX;
		else if (edge === 'bottom') rect.bottom = rect.top + fit.height * metrics.scaleY;
		else if (edge === 'top') rect.top = rect.bottom - fit.height * metrics.scaleY;
		else return false;

		return this.applyResizedBoxRect(layer, dragState, rect, metrics);
	}

	// Slots resolve through their declared path, so a nested slot (Text
	// Background's fill, the two bevel paints) reads like any other.
	ensureEffectData(layer, effectName) {
		if (!layer?.textData) return null;
		return ensureLayerPaintSlot(layer, effectName, () => getSlotDefaults(LayerType.TEXT_GLITTER, effectName));
	}

	getEffectData(layer, effectName) {
		return getLayerPaintSlot(layer, effectName);
	}

	getGlitterSelectionTarget(layer = this.getActiveTextLayer()) {
		return pickerArmedSlot(this, layer) || 'fill';
	}

	openPickerSession(layer = this.getActiveTextLayer(), slot = 'fill') {
		if (!layer) return;
		pickerOpenSession(this, { layerId: layer.id, slot }, {
			refresh: () => this.updateEffectTargetButtons(layer)
		});
		this.editor.updateGlitterSelection();
	}

	closePickerSession() {
		pickerCloseSession(this, {
			refresh: () => this.updateEffectTargetButtons(this.getActiveTextLayer()),
			updateSelection: () => this.editor.updateGlitterSelection()
		});
	}

	resolveSelectedGlitterId(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER) return null;
		return getLayerPaintSlot(layer, this.getGlitterSelectionTarget(layer))?.glitterId ?? null;
	}

	// The slot's glitter chip or Change button: arm the gallery for that slot.
	armPicker(key) {
		const layer = this.getActiveTextLayer();
		if (!layer) return;
		// A font picker left open (no Done, e.g. a drawer tab back to Edit) owns
		// the strip and the Library view; a slot pick supersedes it.
		this.editor.fontBrowserManager?.closePickerSession();
		this.ensureEffectData(layer, key);
		this.openPickerSession(layer, key);
		const selectedGlitterId = this.resolveSelectedGlitterId(layer);
		revealAssetBrowser(this.editor, this.editor.glitterLibrary, selectedGlitterId);
		this.editor.updateStatus(`Choose ${this.getEffectTitle(key)} glitter, then press Esc or Done.`);
	}

	// One font change: re-measure around the anchor, one history step.
	async setLayerFont(layer, fontId) {
		if (!layer || !fontId || fontId === layer.textData.fontId) return;
		if (!this.editor.canEditLayer(layer, { notify: true })) return;
		// The first use of a font fetches its file before the text can redraw.
		const done = this.editor.beginActivity('text-font', 'Loading font');
		try {
			await this.runLayoutRefreshWithAnchor(layer, async () => {
				layer.textData.fontId = fontId;
				await FontLibrary.ensureLoaded(fontId);
			}, { saveHistory: true });
		} catch (error) {
			this.reportFontLoadError(error);
		} finally {
			done();
		}
	}

	reportFontLoadError(error) {
		if (!error || error._textGlitterReported) return;
		error._textGlitterReported = true;
		this.editor.showError(error.message);
	}

	getLayerName(text) {
		const trimmed = (text || '').replace(/\s+/g, ' ').trim();
		if (!trimmed) return 'Text';
		return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
	}

	getActiveTextLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		if (layer?.type === LayerType.TEXT_GLITTER) {
			return layer;
		}
		return null;
	}

	createLayer(options = {}) {
		if (!this.editor.layerManager.requireLayerCapacity()) return null;

		const defaultText = clampTextLength(options.text ?? '', CONFIG.tools.text.maxTextLength);
		const initialPosition = options.position || {
			x: this.editor.originalCanvas.width / 2,
			y: this.editor.originalCanvas.height / 2
		};
		const initialAlign = options.align || 'center';
		const transform = createDefaultTransform({
			position: {
				x: initialPosition.x,
				y: initialPosition.y
			}
		});
		const layer = {
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.TEXT_GLITTER,
			name: this.getLayerName(defaultText),
			visible: true,
			locked: false,
			opacity: FIELDS.layerOpacity.value,
			transform,
			textData: {
				text: defaultText,
				fontId: CONFIG.tools.text.defaultFontId,
				fontWeight: CONFIG.tools.text.defaultFontWeight,
				fontStyle: CONFIG.tools.text.defaultFontStyle,
				textCase: CONFIG.tools.text.defaultTextCase,
				orientation: CONFIG.tools.text.defaultOrientation,
				fontSize: FIELDS.textFontSize.value,
				letterSpacing: FIELDS.textLetterSpacing.value,
				lineHeight: FIELDS.textLineHeight.value / 100,
				align: initialAlign,
				verticalAlign: CONFIG.tools.text.defaultVerticalAlign,
				boxMode: options.boxMode || CONFIG.tools.text.defaultBoxMode,
				boxWidth: options.boxWidth,
				boxHeight: options.boxHeight,
				colorEmoji: CONFIG.tools.text.defaultColorEmoji,
				decoration: { underline: false, strikethrough: false },
				width: 0,
				height: 0,
				border: null,
				shadow: null
			}
		};

		this.normalizeLayer(layer);
		FontLibrary.ensureLoaded(layer.textData.fontId).catch((error) => {
			this.reportFontLoadError(error);
		});
		if (options.anchorPosition) {
			layer._pendingPointAnchorTarget = {
				x: options.anchorPosition.x,
				y: options.anchorPosition.y
			};
		}

		return layer;
	}

	loadLayerSettings(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER) return;

		if (this.ui.textInput) {
			this.ui.textInput.value = layer.textData.text;
		}

		syncFieldControls(this.fieldHost, layer);

		this.updateFontRow(layer.textData.fontId);
		this.editor.fontBrowserManager?.updateSelection();
		this.updateFontStyleSelection(layer.textData);
		this.syncTextActionUI(layer);
		this.updateAlignmentSelection(layer.textData.align);
		this.updateVerticalAlignmentSelection(layer.textData.verticalAlign);
		this.updateBoxModeSelection(layer);
		this.syncTextBackgroundUI(layer);
		this.syncWarpUI(layer);
		this.updatePickerStrip();
		this.editor.loadTransformSettings?.(layer, 'text');
	}

	// The warp grid applies a type and bend in one history step; Bend (a
	// declared field) shows once a warp is chosen. A bend tuned off every
	// preset keeps its nearest tile highlighted as edited, and the collapsed
	// Warp header names it either way.
	syncWarpUI(layer, { live = false } = {}) {
		const warp = layer.textData.warp;
		const match = matchWarpPreset(warp);
		const entry = match && WARP_PRESETS.get(match.id);
		if (this.ui.warpBendRow) this.ui.warpBendRow.hidden = warp.type === 'none';
		if (this.ui.warpSummary) this.ui.warpSummary.textContent = entry ? entry.label : (WARP_TYPES[warp.type]?.label || '');
		if (!this.ui.warpPresets) return;
		const selection = { activeId: match?.id || null, modified: Boolean(match?.modified), contextId: 'text' };
		if (live) {
			GlitterPresetLibrary.setPresetGridActive(this.ui.warpPresets, WARP_PRESETS, selection);
			return;
		}
		GlitterPresetLibrary.renderPresetGrid(this.ui.warpPresets, WARP_PRESETS, {
			...selection,
			onChoose: (entry) => {
				const active = this.getActiveTextLayer();
				if (!active || !this.editor.canEditLayer(active, { notify: true })) return;
				this.runLayoutRefreshWithAnchor(active, () => WARP_PRESETS.apply(entry, active.textData), { saveHistory: true })
					.catch((error) => this.reportFontLoadError(error));
			}
		});
	}

	focusTextInput(selectAll = false) {
		if (!this.ui.textInput) return;
		if (!this.editor.mobileManager?.isMobile) {
			this.editor.setCollapsibleSectionOpen?.('textSettings', true);
		}

		requestAnimationFrame(() => {
			this.ui.textInput.focus();
			if (selectAll) {
				this.ui.textInput.select();
			}
		});
	}

	updateFontRow(fontId) {
		const font = FontLibrary.getFont(fontId);
		if (!font) return;
		if (this.ui.fontName) this.ui.fontName.textContent = font.name;
		if (this.ui.fontThumbnail) {
			let sample = this.ui.fontThumbnail.querySelector('.text-font-thumbnail-sample');
			if (!sample) {
				sample = document.createElement('span');
				sample.className = 'text-font-thumbnail-sample';
				this.ui.fontThumbnail.replaceChildren(sample);
			}
			sample.style.fontFamily = FontLibrary.getFamily(font);
			sample.textContent = getFontSampleText(font, 'short');
		}
	}

	updateFontStyleSelection(textData) {
		const states = [
			[this.ui.fontBold, textData.fontWeight === 700],
			[this.ui.fontItalic, textData.fontStyle === 'italic']
		];
		states.forEach(([button, active]) => {
			button?.classList.toggle('active', active);
			button?.setAttribute('aria-pressed', String(active));
		});
		if (this.ui.textCaseSelect) this.ui.textCaseSelect.value = textData.textCase;
		this.ui.orientationButtons.forEach(button => {
			const active = button.dataset.textOrientation === textData.orientation;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
	}

	updateAlignmentSelection(align) {
		this.ui.alignButtons.forEach((button) => {
			button.classList.toggle('active', button.dataset.textAlign === align);
		});
	}

	updateVerticalAlignmentSelection(verticalAlign) {
		this.ui.verticalAlignButtons.forEach((button) => {
			button.classList.toggle('active', button.dataset.textValign === (verticalAlign || 'top'));
		});
	}

	updateBoxModeSelection(layer) {
		const mode = layer?.textData?.boxMode || 'point';
		this.ui.boxModeButtons.forEach((button) => {
			button.classList.toggle('active', button.dataset.textBoxMode === mode);
		});

		// CSS hides only the vertical alignment controls in point mode.
		if (this.ui.section) {
			this.ui.section.dataset.boxMode = mode;
		}

		if (this.ui.boxModeHint) {
			this.ui.boxModeHint.textContent = getOptions('textBoxMode').find(option => option.value === mode).hint;
		}

		if (this.ui.fitBoxToContent) {
			const enabled = mode === 'fixed';
			this.ui.fitBoxToContent.disabled = !enabled;
			this.ui.fitBoxToContent.title = enabled
				? 'Resize the box to exactly fit the current text (keeps existing line breaks/wraps)'
				: 'Fit to Text is available only in Box mode';
		}
	}

	// Text Background's mode and line-connection options, and the rows that
	// only apply to some modes.
	syncTextBackgroundUI(layer) {
		const tb = layer.textData.textBackground;
		const isBoxText = layer.textData.boxMode !== 'point';
		this.ui.bgModeBox?.toggleAttribute('disabled', !isBoxText);
		if (this.ui.bgModeBox) this.ui.bgModeBox.hidden = !isBoxText;
		[
			[this.ui.bgModeLines, 'lines'],
			[this.ui.bgModeBounds, 'text-bounds'],
			[this.ui.bgModeBox, 'text-box']
		].forEach(([button, mode]) => button?.classList.toggle('active', tb.mode === mode));
		[
			[this.ui.bgConnSeparate, 'separate'],
			[this.ui.bgConnMerge, 'merge-adjacent'],
			[this.ui.bgConnConnected, 'connected']
		].forEach(([button, connection]) => button?.classList.toggle('active', tb.lineConnection === connection));
		if (this.ui.bgPreset) this.ui.bgPreset.value = this.findMatchingPreset(tb);
		// Line Connection only matters in Lines mode; Merge Distance/Spacing
		// Sensitivity only matter once lines can actually merge (plan: "expose
		// only controls relevant to the active mode").
		const connectionRow = this.ui.bgConnSeparate?.closest('.property-row');
		if (connectionRow) connectionRow.hidden = tb.mode !== 'lines';
		const mergeSet = this.ui.bgMergeDistance?.closest('.property-set');
		if (mergeSet) mergeSet.hidden = tb.mode !== 'lines' || tb.lineConnection === 'separate';
	}

	updateEffectTargetButtons(layer) {
		syncPaintSlotPickerTargets(this.fieldHost, layer);
		this.updatePickerStrip();
	}

	handlePickerDone() {
		const slot = this.pickerSession?.slot || 'fill';
		this.closePickerSession();
		this.returnToTextProperties(slot);
	}

	// Explicit exit from picker mode (Done / Esc) returns focus to where the
	// user armed from. This is deliberately NOT part of closePickerSession —
	// the automatic clears (layer switch, effect disable, history restore)
	// already move the user elsewhere and must not yank the view back.
	returnToTextProperties(slot = 'fill') {
		returnFromPickerToProperties(this.editor, { section: 'textSettings', focusId: getPaintSlotChipId(LayerType.TEXT_GLITTER, slot) });
	}

	// D-1c: the gallery status strip. Same copy/look whether armed or not —
	// picker mode (an armed slot) adds a Done button; browse mode names the
	// default slot (fill) a swatch click applies to. Driven from
	// updateEffectTargetButtons (arm/disarm, fill-mode flips, layer activate)
	// and app.updateSidePanelUI (switching to any layer type).
	updatePickerStrip() {
		// An open font picker owns the strip while it lasts.
		if (this.editor.fontBrowserManager?.pickerSession) {
			this.editor.fontBrowserManager.updatePickerStrip();
			return;
		}
		const layer = this.getActiveTextLayer();
		if (!layer) {
			renderPickerStrip({ ownsStrip: true, visible: false });
			return;
		}
		const armedSlot = pickerArmedSlot(this, layer);
		const fillData = this.getEffectData(layer, 'fill');
		const fillIsSolid = fillData?.mode === 'solid';
		if (armedSlot) {
			let stripText;
			if (armedSlot === 'fill' && fillIsSolid) {
				const color = (fillData.color || '#000000').toUpperCase();
				stripText = { title: 'Choosing fill glitter', detail: `${formatPickerTarget(layer.name, 'text')}; current fill is solid (${color}).` };
			} else {
				stripText = formatPickerStripText(layer, armedSlot, 'text');
			}
			renderPickerStrip({ ownsStrip: true, visible: true, armed: true, ...stripText });
			return;
		}
		const stripText = fillIsSolid
			? { title: 'Choosing fill glitter', detail: `${formatPickerTarget(layer.name, 'text')}; current fill is solid (${(fillData.color || '#000000').toUpperCase()}).` }
			: formatPickerStripText(layer, 'fill', 'text');
		renderPickerStrip({ ownsStrip: true, visible: true, hint: true, ...stripText });
	}

	// One place each slot's default comes from.

	getEffectTitle(effectName) {
		return getPaintSlotLabel(LayerType.TEXT_GLITTER, effectName);
	}

	scheduleTextCommit(layer) {
		clearTimeout(this.textInputTimer);
		this.textInputTimer = setTimeout(async () => {
			try {
				await this.refreshLayer(layer, {
					saveHistory: !this.editSession,
					preservePointAnchorFrom: layer._pendingPointAnchorSnapshot || null
				});
			} catch (error) {
				this.reportFontLoadError(error);
			}
		}, CONFIG.ui.live.settleMs);
	}

	getCacheKeyForLayer(layer) {
		const textData = layer.textData;
		return JSON.stringify([
			textData.text,
			getCommittedRasterScale(this.editor, layer).x, getCommittedRasterScale(this.editor, layer).y,
			textData.textCase,
			textData.orientation,
			textData.fontId,
			textData.fontWeight,
			textData.fontStyle,
			// Font-readiness is part of the key: selection highlights and transform
			// handles measure synchronously right after layer creation, before the
			// FontFace resolves. Without this flag that fallback-font measurement
			// (and its rasterized canvas) is cached under the same key the real
			// font would use, so the fallback sticks for the whole session.
			FontLibrary.isLoaded(textData.fontId),
			textData.fontSize,
			textData.letterSpacing,
			textData.lineHeight,
			textData.align,
			isTextWarpActive(textData.warp) ? [textData.warp.type, textData.warp.bend] : null,
			textData.verticalAlign || 'top',
			textData.boxMode || 'point',
			textData.boxWidth ?? null,
			textData.boxHeight ?? null,
			textData.decoration,
			textData.colorEmoji,
			textData.border ? [textData.border.widthPx, getBorderPlacement(textData.border), getBorderEdgeStyle(textData.border)] : null,
			textData.shadow ? getShadowMaskKey(textData.shadow) : null,
			textData.shadow ? textData.shadow.offsetY : null,
			textData.shadow ? textData.shadow.spread : null,
			textData.shadow ? textData.shadow.blur || 0 : null,
			// Text Background's geometry-affecting fields only (never `fill` —
			// paint-only changes must not invalidate layout/geometry caching).
			textData.textBackground?.enabled
				? [
					textData.textBackground.mode,
					textData.textBackground.lineConnection,
					textData.textBackground.horizontalPadding,
					textData.textBackground.verticalPadding,
					textData.textBackground.cornerRadius,
					textData.textBackground.mergeDistance,
					textData.textBackground.lineSpacingSensitivity
				]
				: null,
			shouldUseCrispMaskEdges(),
			CONFIG.rendering.maskAlphaThreshold
		]);
	}

	getMeasurementEntry(layer) {

		const key = this.getCacheKeyForLayer(layer);
		const cached = this.textMaskCache.get(key);
		if (cached) {
			layer.textData.width = cached.width;
			layer.textData.height = cached.height;
			return cached;
		}

		const font = FontLibrary.getFont(layer.textData.fontId);
		const ctx = this.measureCtx;
		const padding = CONFIG.rendering.maskPaddingPx;
		const fontSize = layer.textData.fontSize;
		const letterSpacing = layer.textData.letterSpacing;
		const lineHeightPx = fontSize * layer.textData.lineHeight;
		const paintScale = { ...getCommittedRasterScale(this.editor, layer) };
		const sx = paintScale.x / 100;
		const sy = paintScale.y / 100;
		const borderWidth = getBorderOutsidePadding(layer.textData.border);
		const borderReserve = getBorderOutsidePadding(layer.textData.border, { miterLimit: CONFIG.rendering.borderMiterLimit });
		const boxMode = layer.textData.boxMode || 'point';

		ctx.font = FontLibrary.getDeclaration(font, fontSize, layer.textData.fontWeight, layer.textData.fontStyle);
		ctx.textBaseline = 'alphabetic';

		const sampleMetrics = ctx.measureText('Hg');
		const ascent = sampleMetrics.actualBoundingBoxAscent || fontSize * 0.8;
		const descent = sampleMetrics.actualBoundingBoxDescent || fontSize * 0.2;

		const layout = TextLayout.layout(ctx, layer.textData.text, layer.textData, { fontSize, letterSpacing, lineHeightPx, ascent, descent, minBoxSize: this.getMinBoxSize() });
		const { lines: measuredLines, visibleLines, layoutWidth, layoutHeight, hasOverflow, contentOffsetY } = layout;
		let textInkLeft = Infinity;
		let textInkTop = Infinity;
		let textInkRight = -Infinity;
		let textInkBottom = -Infinity;
		let hasInk = false;

		// Canonical per-line layout for Text Background:
		// one positioned+aligned rect per visible line, in the same unshifted
		// local space as textInk*/box* below. `blank` lines (no ink) carry no
		// rect — Text Background treats them as hard separators, never their
		// own rectangle.
		const positionedLines = [];

		visibleLines.forEach(line => {
			const offsetX = line.x;
			const baselineY = line.baseline;
			const isBlank = !line.text || (line.inkRight - line.inkLeft) <= 0;
			if (isBlank) {
				positionedLines.push({ blank: true });
				return;
			}
			hasInk = true;
			const left = offsetX - line.inkLeft;
			const right = offsetX + line.inkRight;
			const top = baselineY - line.ascent;
			const bottom = baselineY + line.descent;
			positionedLines.push({ left, top, right, bottom, blank: false });
			textInkLeft = Math.min(textInkLeft, left);
			textInkRight = Math.max(textInkRight, right);
			textInkTop = Math.min(textInkTop, top);
			textInkBottom = Math.max(textInkBottom, bottom);
		});

		layout.decorations.forEach(rect => {
			textInkLeft = Math.min(textInkLeft, rect.x); textInkRight = Math.max(textInkRight, rect.x + rect.width);
			textInkTop = Math.min(textInkTop, rect.y); textInkBottom = Math.max(textInkBottom, rect.y + rect.height); hasInk = true;
		});

		if (!hasInk) {
			textInkLeft = 0;
			textInkTop = 0;
			textInkRight = 0;
			textInkBottom = 0;
		}

		// A warp re-places every glyph around the flat block's center, so the
		// ink, the per-line rects (Text Background) and the frame all come from
		// the warped glyphs. Unwarped text keeps the flat path.
		// An envelope warp draws the flat artwork through its envelope, so it
		// keeps the flat ink box and decorations the warped ones replace below.
		const flatInkRect = { left: textInkLeft, top: textInkTop, right: textInkRight, bottom: textInkBottom };
		const flatDecorations = layout.decorations;
		const warpEnvelope = hasInk && hasWarpEnvelope(layer.textData.warp);
		const warpedGlyphs = hasInk && isTextWarpActive(layer.textData.warp)
			? this.layoutWarpedTextGlyphs(ctx, visibleLines, {
				glyphs: layout.glyphs,
				warp: layer.textData.warp,
				align: layer.textData.align,
				layoutWidth,
				contentOffsetY,
				ascent,
				lineHeightPx,
				letterSpacing,
				fontSize,
				inkRect: flatInkRect
			})
			: null;
		if (warpedGlyphs) layout.decorations = TextLayout.warpDecorations(layout, warpedGlyphs, letterSpacing);
		if (warpedGlyphs) {
			textInkLeft = Infinity;
			textInkTop = Infinity;
			textInkRight = -Infinity;
			textInkBottom = -Infinity;
			positionedLines.forEach((line, index) => {
				if (line.blank) return;
				const bounds = [...warpedGlyphs.filter(glyph => glyph.line === index && glyph.bounds).map(glyph => glyph.bounds), ...layout.decorations.filter(rect => rect.line === index && rect.bounds).map(rect => rect.bounds)];
				if (!bounds.length) {
					positionedLines[index] = { blank: true };
					return;
				}
				const rect = {
					left: Math.min(...bounds.map((box) => box.left)),
					top: Math.min(...bounds.map((box) => box.top)),
					right: Math.max(...bounds.map((box) => box.right)),
					bottom: Math.max(...bounds.map((box) => box.bottom)),
					blank: false
				};
				positionedLines[index] = rect;
				textInkLeft = Math.min(textInkLeft, rect.left);
				textInkTop = Math.min(textInkTop, rect.top);
				textInkRight = Math.max(textInkRight, rect.right);
				textInkBottom = Math.max(textInkBottom, rect.bottom);
			});
		}

		// Geometry is generated here (unshifted local space, same origin as
		// textInk*/box* above) so its bounds can widen the mask canvas's frame
		// before layoutX/Y are fixed — an enabled background must contribute to
		// visual/export bounds, or padded backgrounds could be clipped.
		const textBackgroundProps = layer.textData.textBackground;
		let textBackgroundGeometry = null;
		if (textBackgroundProps?.enabled) {
			textBackgroundGeometry = generateTextBackgroundGeometry({
				lines: positionedLines,
				textInkRect: hasInk ? { x: textInkLeft, y: textInkTop, width: textInkRight - textInkLeft, height: textInkBottom - textInkTop } : null,
				boxRect: boxMode !== 'point' ? { x: 0, y: 0, width: layoutWidth, height: layoutHeight } : null,
				lineHeightPx,
				ascent,
				descent
			}, textBackgroundProps);
		}
		const backgroundBounds = textBackgroundGeometry?.bounds;

		// A trailing blank line has no floor; multiline text uses its last ink line.
		const lastInkLine = positionedLines.findLastIndex(line => !line.blank);
		const shadowBaseline = warpedGlyphs
			? Math.max(...warpedGlyphs.filter(glyph => glyph.bounds && (layer.textData.orientation === 'stacked' || glyph.line === lastInkLine)).map(glyph => glyph.placement.y))
			: layer.textData.orientation === 'stacked' ? Math.max(ascent, ...visibleLines.filter(line => line.text).map(line => line.baseline)) : contentOffsetY + ascent + Math.max(0, lastInkLine) * lineHeightPx;
		const shadowBounds = getShadowSlotBounds({ x: textInkLeft * sx, y: textInkTop * sy, width: (textInkRight - textInkLeft) * sx, height: (textInkBottom - textInkTop) * sy, baseline: shadowBaseline * sy, castSize: { x: fontSize * sx, y: fontSize * sy } }, layer.textData.shadow);
		const artLeft = Math.min(textInkLeft - borderReserve / sx, shadowBounds.x / sx, backgroundBounds ? backgroundBounds.x : Infinity);
		const artRight = Math.max(textInkRight + borderReserve / sx, (shadowBounds.x + shadowBounds.width) / sx, backgroundBounds ? backgroundBounds.x + backgroundBounds.width : -Infinity);
		const artTop = Math.min(textInkTop - borderReserve / sy, shadowBounds.y / sy, backgroundBounds ? backgroundBounds.y : Infinity);
		const artBottom = Math.max(textInkBottom + borderReserve / sy, (shadowBounds.y + shadowBounds.height) / sy, backgroundBounds ? backgroundBounds.y + backgroundBounds.height : -Infinity);
		// Body (the layer's frame for handles and hit-testing): the layout box,
		// the glyphs with their border, and the background plate. No shadow, and
		// the layout box rather than ink, so the box holds still while typing.
		// Warped point text has left its flat layout box, so it hugs the ink.
		const hugInk = Boolean(warpedGlyphs) && boxMode === 'point';
		const bodyLeft = Math.min(hugInk ? Infinity : 0, hasInk ? textInkLeft - borderWidth / sx : 0, backgroundBounds ? backgroundBounds.x : Infinity);
		const bodyRight = Math.max(hugInk ? -Infinity : layoutWidth, hasInk ? textInkRight + borderWidth / sx : 0, backgroundBounds ? backgroundBounds.x + backgroundBounds.width : -Infinity);
		const bodyTop = Math.min(hugInk ? Infinity : 0, hasInk ? textInkTop - borderWidth / sy : 0, backgroundBounds ? backgroundBounds.y : Infinity);
		const bodyBottom = Math.max(hugInk ? -Infinity : layoutHeight, hasInk ? textInkBottom + borderWidth / sy : 0, backgroundBounds ? backgroundBounds.y + backgroundBounds.height : -Infinity);
		const frameLeft = boxMode !== 'point' ? Math.min(0, artLeft) : artLeft;
		const frameRight = boxMode !== 'point' ? Math.max(layoutWidth, artRight) : artRight;
		const frameTop = boxMode !== 'point' ? Math.min(0, artTop) : artTop;
		const frameBottom = boxMode !== 'point' ? Math.max(layoutHeight, artBottom) : artBottom;

		const layoutX = padding - frameLeft;
		const layoutY = padding - frameTop;
		const canvasWidth = Math.max(1, Math.ceil(frameRight - frameLeft + padding * 2));
		const canvasHeight = Math.max(1, Math.ceil(frameBottom - frameTop + padding * 2));
		const canvas = createAppCanvas(0, 0, 'layers/TextGlitterManager');
		canvas.width = canvasWidth;
		canvas.height = canvasHeight;
		canvas._textureOrigin = { x: layoutX, y: layoutY };
		canvas._shadowBounds = { x: layoutX + textInkLeft, y: layoutY + textInkTop, width: textInkRight - textInkLeft, height: textInkBottom - textInkTop, baseline: layoutY + shadowBaseline, castSize: { x: fontSize, y: fontSize } };

		const maskCtx = canvas.getContext('2d', { willReadFrequently: true });
		maskCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		maskCtx.fillStyle = '#ffffff';
		maskCtx.font = FontLibrary.getDeclaration(font, fontSize, layer.textData.fontWeight, layer.textData.fontStyle);
		maskCtx.textBaseline = 'alphabetic';
		maskCtx.textAlign = 'left';

		const fontDeclaration = maskCtx.font;
		const warpMetrics = warpEnvelope ? TextLayout.getWarpMetrics(flatInkRect, fontSize, ascent) : null;
		// drawFlat(flat, x, y) paints unwarped artwork offset by (x, y).
		const drawThroughEnvelope = (context, drawFlat) => drawThroughWarpEnvelope(context, layer.textData.warp, warpMetrics, flatInkRect, layoutX, layoutY, (flat, x, y) => {
			flat.font = fontDeclaration;
			flat.textBaseline = 'alphabetic';
			flat.fillStyle = '#fff';
			drawFlat(flat, x, y);
		});
		const drawDecorations = context => (warpEnvelope
			? drawThroughEnvelope(context, (flat, x, y) => TextLayout.drawDecorations(flat, flatDecorations, x, y))
			: TextLayout.drawDecorations(context, layout.decorations, layoutX, layoutY));
		const drawMask = (context, method = 'fillText') => {
			context.font = fontDeclaration;
			context.textBaseline = 'alphabetic';
			context.fillStyle = '#fff';
			if (warpEnvelope) {
				drawThroughEnvelope(context, (flat, x, y) => {
					layout.runs.forEach(run => flat[method](run.text, x + run.x, y + run.baseline));
					TextLayout.drawDecorations(flat, flatDecorations, x, y);
				});
				return;
			}
			if (warpedGlyphs) {
				warpedGlyphs.forEach((glyph) => {
					if (!glyph.bounds) return;
					context.save();
					context.translate(layoutX + glyph.placement.x, layoutY + glyph.placement.y);
					context.rotate(glyph.placement.rotation);
					context.scale(1, glyph.placement.scaleY);
					context[method](glyph.char, -glyph.advance / 2, 0);
					context.restore();
				});
			} else {
				layout.runs.forEach(run => context[method](run.text, layoutX + run.x, layoutY + run.baseline));
			}

			TextLayout.drawDecorations(context, layout.decorations, layoutX, layoutY);
		};
		drawMask(maskCtx);

		let lettersCanvas = canvas;
		let lettersCtx = maskCtx;
		let emojiCanvas = null;
		if (layer.textData.colorEmoji) {
			if (!this.colorGlyphCtx) this.colorGlyphCtx = createAppCanvas(CONFIG.tools.text.colorGlyphProbe.size, CONFIG.tools.text.colorGlyphProbe.size, 'layers/TextGlitterManager').getContext('2d', { willReadFrequently: true });
			const colorGlyphs = layout.glyphs.map((glyph, index) => ({ glyph, index })).filter(({ glyph }) => isColorTextGlyph(this.colorGlyphCtx, glyph.char, FontLibrary.getDeclaration(font, CONFIG.tools.text.colorGlyphProbe.fontSize, layer.textData.fontWeight, layer.textData.fontStyle)));
			if (colorGlyphs.length) {
				lettersCanvas = createAppCanvas(canvasWidth, canvasHeight, 'layers/TextGlitterManager');
				lettersCanvas._textureOrigin = canvas._textureOrigin;
				lettersCtx = lettersCanvas.getContext('2d', { willReadFrequently: true });
				lettersCtx.drawImage(canvas, 0, 0);
				emojiCanvas = createAppCanvas(canvasWidth, canvasHeight, 'layers/TextGlitterManager');
				const emojiCtx = emojiCanvas.getContext('2d', { willReadFrequently: true });
				emojiCtx.font = maskCtx.font; emojiCtx.textBaseline = 'alphabetic';
				if (warpEnvelope) drawThroughEnvelope(emojiCtx, (flat, x, y) => colorGlyphs.forEach(({ glyph }) => flat.fillText(glyph.char, x + glyph.x, y + glyph.baseline)));
				else colorGlyphs.forEach(({ glyph, index }) => {
					const placement = warpedGlyphs?.[index]?.placement;
					emojiCtx.save();
					if (placement) { emojiCtx.translate(layoutX + placement.x, layoutY + placement.y); emojiCtx.rotate(placement.rotation); emojiCtx.scale(1, placement.scaleY); emojiCtx.fillText(glyph.char, -glyph.advance / 2, 0); }
					else emojiCtx.fillText(glyph.char, layoutX + glyph.x, layoutY + glyph.baseline);
					emojiCtx.restore();
				});
				binarizeCanvasAlpha(emojiCtx, canvasWidth, canvasHeight);
				lettersCtx.globalCompositeOperation = 'destination-out'; lettersCtx.drawImage(emojiCanvas, 0, 0); lettersCtx.globalCompositeOperation = 'source-over'; lettersCtx.fillStyle = '#fff'; drawDecorations(lettersCtx);
			}
		}
		if (shouldUseCrispMaskEdges()) binarizeCanvasAlpha(lettersCtx, canvasWidth, canvasHeight);

		if (shouldUseCrispMaskEdges()) {
			// Hard pixel edges keep mask outlines crisp.
			// Also load-bearing for export: fillText antialiasing leaves partial-alpha
			// edge pixels that composite over the GIF transparency key (magenta) and
			// fringe on transparent exports. A binary mask has nothing to blend.
			binarizeCanvasAlpha(maskCtx, canvasWidth, canvasHeight);
		}

		const entry = {
			paintScale,
			key,
			drawMask,
			layout,
			lettersCanvas,
			emojiCanvas,
			warpedGlyphs,
			warpEnvelope,
			canvas,
			lines: measuredLines,
			positionedLines,
			width: canvasWidth,
			height: canvasHeight,
			textWidth: layoutWidth,
			textHeight: layoutHeight,
			ascent,
			descent,
			lineHeightPx,
			// Final canvas-local space (translated from the unshifted space used
			// above), ready to rasterize directly via renderTextBackgroundGeometry —
			// see getTextBackgroundMaskCanvas, the single call site preview and
			// every export path share.
			textBackgroundGeometry: textBackgroundGeometry
				? translateTextBackgroundGeometry(textBackgroundGeometry, layoutX, layoutY)
				: null,
			layoutWidth,
			layoutHeight,
			layoutOffsetX: layoutX,
			layoutOffsetY: layoutY,
			boxMode,
			contentOffsetY,
			hasOverflow,
			textInkRect: {
				x: layoutX + textInkLeft,
				y: layoutY + textInkTop,
				width: textInkRight - textInkLeft,
				height: textInkBottom - textInkTop
			},
			boxRect: boxMode === 'fixed'
				? { x: layoutX, y: layoutY, width: layoutWidth, height: layoutHeight }
				: null,
			// The layer's frame: handles, hit-testing, alignment (see getTextBodyFrame).
			bodyRect: {
				x: layoutX + bodyLeft,
				y: layoutY + bodyTop,
				width: Math.max(1, bodyRight - bodyLeft),
				height: Math.max(1, bodyBottom - bodyTop)
			},
			// Every visible pixel, shadow included. Area text keeps a separate
			// boxRect for its reflow handles.
			frameRect: {
				x: layoutX + frameLeft,
				y: layoutY + frameTop,
				width: frameRight - frameLeft,
				height: frameBottom - frameTop
			},
			paddingBox: {
				top: Math.floor(layoutY),
				right: Math.floor(canvasWidth - layoutX - layoutWidth),
				bottom: Math.floor(canvasHeight - layoutY - layoutHeight),
				left: Math.floor(layoutX)
			}
		};

		this.textMaskCache.set(key, entry);
		layer.textData.width = canvasWidth;
		layer.textData.height = canvasHeight;
		return entry;
	}

	// The user-facing visible-art frame in text-local units, centered relative
	// to the mask canvas. Fixed text keeps its layout box separately.
	getTextFrame(layer, measurement = null) {
		if (!layer?.textData) return null;

		const entry = measurement || this.getMeasurementEntry(layer);
		const rect = entry.frameRect;
		if (!rect) return null;

		return {
			width: rect.width,
			height: rect.height,
			offsetX: rect.x + rect.width / 2 - entry.width / 2,
			offsetY: rect.y + rect.height / 2 - entry.height / 2
		};
	}

	getFixedBoxFrame(layer, measurement = null) {
		if (!layer?.textData || (layer.textData.boxMode || 'point') === 'point') {
			return null;
		}
		const entry = measurement || this.getMeasurementEntry(layer);
		const rect = entry.boxRect;
		if (!rect) return null;
		return {
			width: rect.width,
			height: rect.height,
			offsetX: rect.x + rect.width / 2 - entry.width / 2,
			offsetY: rect.y + rect.height / 2 - entry.height / 2
		};
	}

	// Layer frame (see getLayerFrame): layout box + glyph border + background.
	getTextBodyFrame(layer, measurement = null) {
		if (!layer?.textData) return null;
		const entry = measurement || this.getMeasurementEntry(layer);
		return frameFromCanvasRect(entry.bodyRect, entry.width, entry.height);
	}

	// Layer visual bounds: the body plus shadow.
	getTextVisualFrame(layer, measurement = null) {
		if (!layer?.textData) return null;
		const entry = measurement || this.getMeasurementEntry(layer);
		return frameFromCanvasRect(unionRects(entry.frameRect, entry.bodyRect), entry.width, entry.height);
	}

	getAlignOffset(align, maxWidth, lineWidth) {
		return TextLayout.getAlignOffset(align, maxWidth, lineWidth);
	}

	// Glyph-by-glyph layout for warped text (js/paint/text-warp.js), in the
	// same unshifted space as the flat layout. Each glyph keeps its flat advance
	// (per-glyph drawing drops kerning, as letter spacing already does) and
	// carries its warped placement and ink bounds; blank glyphs have no bounds.
	layoutWarpedTextGlyphs(ctx, lines, options) {
		return TextLayout.layoutWarpedTextGlyphs(ctx, lines, options);
	}

	// Every slot mask for export, in text-local space: the canvases the
	// preview masks with, with the shadow offset baked in (preview translates
	// the unshifted mask instead).
	async renderSlotMasks(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER) {
			throw new Error('Invalid text layer');
		}

		await FontLibrary.ensureLoaded(layer.textData.fontId);
		const measurement = getRasterMeasurement(layer, this.getMeasurementEntry(layer));
		const masks = {
			fill: measurement.lettersCanvas,
			emoji: measurement.emojiCanvas,
			renderWidth: measurement.width,
			renderHeight: measurement.height,
			rasterScale: measurement.rasterScale
		};
		getLayerPaintSlots(layer).forEach((entry) => {
			if (!entry.renders || entry.key === 'fill' || entry.role === 'sparkles') return;
			const slotMask = this.getSlotMask(layer, measurement, entry)?.canvas || null;
			masks[entry.key] = entry.role === 'shadow' && slotMask
				? createOffsetMaskCanvas(slotMask, getShadowSlotOffset(entry.data).x, getShadowSlotOffset(entry.data).y)
				: slotMask;
		});
		return masks;
	}

	renderContent(layersToShow) {
		const keep = new Set();
		layersToShow.forEach((layer) => {
			if (layer.type === LayerType.TEXT_GLITTER) keep.add(layer.id);
		});
		Array.from(this.layerElements.keys()).forEach((layerId) => {
			if (!keep.has(layerId)) this.removeLayerElement(layerId);
		});
		layersToShow.forEach((layer) => {
			if (layer.type === LayerType.TEXT_GLITTER) this.renderLayer(layer);
		});
	}

	renderLayer(layer) {
		if (layer.type !== LayerType.TEXT_GLITTER) return;

		if (!layer.textData.text.trim() && this.editSession?.layerId !== layer.id) {
			this.removeLayerElement(layer.id);
			return;
		}

		const fill = layer.textData.fill;
		if (fill.mode === 'glitter' && !this.editor.glitterLibrary.getItemById(fill.glitterId)) {
			this.removeLayerElement(layer.id);
			return;
		}

		let wrapper = this.layerElements.get(layer.id);
		let stack = wrapper?.querySelector('.text-glitter-stack');

		if (!wrapper) {
			wrapper = document.createElement('div');
			wrapper.className = 'text-glitter-element';
			wrapper.dataset.layerId = layer.id;
			wrapper.setAttribute('role', 'img');
		}

		if (!stack) {
			stack = document.createElement('div');
			stack.className = 'text-glitter-stack';
			wrapper.replaceChildren(stack);
		}

		wrapper.style.zIndex = this.editor.layerManager.getLayerZIndex(layer.id);

		if (!FontLibrary.isLoaded(layer.textData.fontId)) {
			wrapper.style.visibility = 'hidden';
		}

		if (!wrapper.parentNode) {
			this.editor.canvasElementsContainer.appendChild(wrapper);
		}

		this.layerElements.set(layer.id, wrapper);

		if (!this.layerTransforms.has(layer.id)) {
			const transform = new LayerTransform(layer, this.editor);
			transform.element = wrapper;
			transform.setupMouseDrag(wrapper);
			this.layerTransforms.set(layer.id, transform);
		}

		FontLibrary.ensureLoaded(layer.textData.fontId)
			.then(() => {
				if (!this.layerElements.has(layer.id)) return;

				const measurement = this.getMeasurementEntry(layer);
				if (layer._pendingPointAnchorTarget && measurement.boxMode === 'point') {
					this.setPointAnchorWorldPosition(layer, layer._pendingPointAnchorTarget, this.getTextFrame(layer, measurement));
					delete layer._pendingPointAnchorTarget;
				}
				this.reconcileTextSpans(stack, layer, measurement);
				wrapper.classList.toggle('text-overflowing', Boolean(measurement.hasOverflow));
				syncLayerAnimationPreview(wrapper, layer, this.editor.animationTicker);

				const transform = this.layerTransforms.get(layer.id);
				if (transform) {
					transform.layer = layer;
					transform.element = wrapper;
					transform.applyTransform(wrapper, {
						width: layer.textData.width,
						height: layer.textData.height
					});

					if (
						layer.id === this.editor.layerManager.activeLayerId &&
						this.editor.currentTool === ToolType.SELECT &&
						!this.editor.layerManager.hasMultiSelection()
					) {
						if (!transform.isDraggingHandle) {
							transform.createTransformHandles();
						}
					} else {
						transform.removeTransformHandles();
					}
				}

				wrapper.setAttribute('aria-label', layer.textData.text);
				wrapper.style.visibility = '';
				this.renderTextSelection();
				this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);
			})
			.catch((error) => {
				wrapper.style.visibility = 'hidden';
				this.reportFontLoadError(error);
			});
	}

	reconcileTextSpans(stack, layer, measurement) {
		measurement = getRasterMeasurement(layer, measurement);
		this.syncStackGeometry(stack, layer, measurement);
		reconcileSlotStack(stack, this.getSlotStack(layer), {
			spanClassName: 'text-glitter-content',
			width: measurement.width,
			height: measurement.height,
			layer,
			glitterLibrary: this.editor.glitterLibrary,
			getMask: (item) => {
				const mask = this.getSlotMask(layer, measurement, item);
				return mask && {
					canvas: mask.canvas,
					url: this.getPreviewMaskDataUrl(layer, mask.bucket, mask.canvas, mask.cacheKey)
				};
			}
		});
		reconcileSparkleLayers(stack, layer, { editor: this.editor, width: measurement.width, height: measurement.height });
	}

	// Sparkles read the text mask painted with its fill, in mask-canvas space
	// (the same box the export composites the slot stack in).
	getSparkleHost(layer) {
		const measurement = getRasterMeasurement(layer, this.getMeasurementEntry(layer));
		const fill = layer.textData.fill;
		return {
			key: `text:${this.getCacheKeyForLayer(layer)}|${getSparkleMaskHostKey(fill)}`,
			width: measurement.width,
			height: measurement.height,
			loadPixels: () => paintSparkleMaskHost(measurement.canvas, fill)
		};
	}

	// The stack is a local-space surface sized to the mask canvas in text-local
	// pixels and scaled by CSS transform, matching export's rendered canvas.
	syncStackGeometry(stack, layer, measurement = null) {
		if (!stack || !layer?.textData) return;

		const entry = getRasterMeasurement(layer, measurement || this.getMeasurementEntry(layer));
		const scaleX = (layer.transform.scale.x || 100) / 100;
		const scaleY = (layer.transform.scale.y || 100) / 100;

		stack.dataset.rasterScaleX = entry.rasterScale?.x || 1;
		stack.dataset.rasterScaleY = entry.rasterScale?.y || 1;
		stack.style.width = `${entry.width}px`;
		stack.style.height = `${entry.height}px`;
		const logical = this.getMeasurementEntry(layer);
		stack.style.left = `${(logical.width * scaleX - entry.width) / 2}px`;
		stack.style.top = `${(logical.height * scaleY - entry.height) / 2}px`;
		stack.style.transform = `scale(${scaleX / (entry.rasterScale?.x || 1)}, ${scaleY / (entry.rasterScale?.y || 1)})`;
		stack.style.setProperty('--layer-scale', String(Math.max(scaleX, scaleY) || 1));

		// The overflow marker follows the layer's frame.
		const rect = entry.bodyRect;
		if (rect) {
			stack.style.setProperty('--tf-top', `${rect.y}px`);
			stack.style.setProperty('--tf-left', `${rect.x}px`);
			stack.style.setProperty('--tf-right', `${entry.width - rect.x - rect.width}px`);
			stack.style.setProperty('--tf-bottom', `${entry.height - rect.y - rect.height}px`);
		}
	}

	// Called by LayerTransform.applyTransform so stack scale and canvas-anchored
	// texture registration stay live during drags (which bypass renderLayer).
	syncElementScale(layer, wrapper = this.layerElements.get(layer?.id)) {
		const stack = wrapper?.querySelector('.text-glitter-stack');
		// System fonts are resolved by the browser and deliberately have no
		// FontFace cache entry. Their existing stack can still scale live.
		if (!stack) return;
		const scale = layer.transform.scale;
		const ratioX = scale.x / 100 / Number(stack.dataset.rasterScaleX || 1);
		const ratioY = scale.y / 100 / Number(stack.dataset.rasterScaleY || 1);
		const measurement = this.getMeasurementEntry(layer);
		stack.style.transform = `scale(${ratioX}, ${ratioY})`;
		stack.style.left = `${(measurement.width * scale.x / 100 - Number(stack.style.width.replace("px", "")) * ratioX) / 2}px`;
		stack.style.top = `${(measurement.height * scale.y / 100 - Number(stack.style.height.replace("px", "")) * ratioY) / 2}px`;
		syncSlotStackTextureOrigins(stack, this.getSlotStack(layer), layer, slot => this.getSlotMask(layer, measurement, slot)?.canvas);
	}

	getSlotStack(layer, resolveSource = entry => resolvePaintSlotPreviewSource(this.editor, layer, entry)) {
		const stack = buildSlotStack(layer, resolveSource);
		const measurement = getRasterMeasurement(layer, this.getMeasurementEntry(layer));
		if (measurement.emojiCanvas) {
			const canvas = measurement.emojiCanvas;
			const source = { mode: 'image', image: canvas, url: this.getPreviewMaskDataUrl(layer, 'emoji', canvas, measurement.key), fit: 'fill', imageScalePercent: 100, offsetXPercent: 0, offsetYPercent: 0, tile: false, opacity: 1 };
			const fillIndex = stack.findIndex(item => item.key === 'fill');
			stack.splice(fillIndex >= 0 ? fillIndex + 1 : stack.findIndex(item => item.role === 'bevel') >= 0 ? stack.findIndex(item => item.role === 'bevel') : stack.length, 0, { key: 'emoji', role: 'fill', data: {}, source, sourceKey: `${layer.id}:emoji`, offsetX: 0, offsetY: 0 });
		}
		return stack;
	}

	// The mask a slot paints through, in text-local space. The fill and shadow
	// share the glyph mask (the shadow is offset by the caller); the text
	// background exists only once its geometry has shapes. bucket and cacheKey
	// address the per-layer preview mask URL cache.
	getSlotMask(layer, measurement, slot) {
		measurement = getRasterMeasurement(layer, measurement);
		if (slot.key === 'emoji') return { rasterScale: measurement.rasterScale, canvas: measurement.emojiCanvas, bucket: 'emojiMask', cacheKey: measurement.key };
		if (slot.key === 'backgroundFill') {
			const canvas = measurement.textBackgroundGeometry?.shapes?.length
				? this.getTextBackgroundMaskCanvas(layer, measurement)
				: null;
			return canvas ? { rasterScale: measurement.rasterScale, canvas, bucket: 'background', cacheKey: measurement.key } : null;
		}
		if (slot.key === 'border') {
			const { canvas, cacheKey } = this.getBorderMaskCanvas(layer, measurement, slot.data);
			return { rasterScale: measurement.rasterScale, canvas, bucket: 'border', cacheKey };
		}
		if (slot.role === 'shadow') {
			return { rasterScale: measurement.rasterScale, canvas: createShadowSlotMaskCanvas(measurement.canvas, slot.data), bucket: 'shadow', cacheKey: `${measurement.key}|shadow:${getShadowMaskKey(slot.data)}` };
		}
		if (slot.role === 'bevel') {
			const bevel = layer.textData.bevel?.highlight;
			const key = `${bevel?.profile}:${bevel?.size}:${bevel?.depth}:${bevel?.angle}:${bevel?.altitude}:${bevel?.soften}`;
			if (measurement._bevelMaskCache?.key !== key) measurement._bevelMaskCache = { key, ...createBevelMaskCanvases(measurement.lettersCanvas, bevel) };
			return { rasterScale: measurement.rasterScale, canvas: slot.key === 'bevelShade' ? measurement._bevelMaskCache.shade : measurement._bevelMaskCache.highlight, bucket: slot.key, cacheKey: `${measurement.key}|bevel:${key}:${slot.key}` };
		}
		return { rasterScale: measurement.rasterScale, canvas: slot.key === 'fill' ? measurement.lettersCanvas : measurement.canvas, bucket: slot.key === 'fill' ? 'fill' : 'glyphs', cacheKey: measurement.key };
	}

	// One continuous stroke, like a Photoshop stroke: the glyph mask grown,
	// shrunk or both by the border width (mask-geometry.js), textured once.
	// Preview and export both read it through getSlotMask.
	getBorderMaskCanvas(layer, measurement, borderData = this.getEffectData(layer, 'border')) {
		const widthPx = Math.max(0, borderData?.widthPx || 0);
		const placement = getBorderPlacement(borderData);
		const edgeStyle = getBorderEdgeStyle(borderData);
		const fillEnclosed = Boolean(borderData?.fillEnclosed);
		const underlap = layerOutlineUnderlapsFill(layer);
		const cacheKey = `border:${widthPx}:${placement}:${edgeStyle}:${fillEnclosed}:${underlap}`;

		if (measurement._borderMaskCache?.key === cacheKey) {
			return { canvas: measurement._borderMaskCache.canvas, cacheKey: `${measurement.key}|${cacheKey}` };
		}

		const fillMask = measurement.canvas;
		let canvas;
		if (edgeStyle === 'miter') {
			canvas = createMaskCanvasLike(fillMask);
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			ctx.strokeStyle = '#fff';
			ctx.lineJoin = 'miter';
			ctx.miterLimit = CONFIG.rendering.borderMiterLimit;
			ctx.lineWidth = placement === 'center' ? widthPx : widthPx * 2;
			// An envelope or an uneven scale would stretch a stroked glyph's line
			// width with it. An even scale is undone in the line width instead,
			// which keeps the glyph's own curves.
			const scale = measurement.rasterScale;
			if ((scale && scale.x !== scale.y) || measurement.warpEnvelope || measurement.emojiCanvas || Object.values(layer.textData.decoration || {}).some(Boolean)) {
				measurement._outlinePath ||= createMaskContourPath(fillMask);
				ctx.stroke(measurement._outlinePath);
			} else {
				ctx.lineWidth /= scale?.x || 1;
				measurement.drawMask(ctx, 'strokeText');
			}
			if (placement !== 'center') {
				ctx.globalCompositeOperation = placement === 'inside' ? 'destination-in' : 'destination-out';
				ctx.drawImage(placement === 'inside' ? fillMask : createOutlineCutoutCanvas(fillMask, underlap), 0, 0);
				ctx.globalCompositeOperation = 'source-over';
			}
			// A stroke wider than a curve is round (the dot of an i) comes out of
			// the browser with a hollow in it. The Smooth outline has no hollows
			// and lies inside the Sharp one, so it fills them, and it rounds off
			// a corner too pointed for the miter limit instead of leaving it cut.
			const smooth = createBorderMaskCanvas(fillMask, { ...borderData, edgeStyle: 'round', fillEnclosed: false }, { underlap });
			if (smooth) ctx.drawImage(smooth, 0, 0);
			if (fillEnclosed) fillEnclosedMaskAreas(canvas, fillMask);
			if (shouldUseCrispMaskEdges()) binarizeCanvasAlpha(ctx);
		} else canvas = createBorderMaskCanvas(fillMask, borderData, { underlap });

		if (canvas) {
			copyMaskTextureOrigin(canvas, fillMask);
		}
		measurement._borderMaskCache = { key: cacheKey, canvas };
		return { canvas, cacheKey: `${measurement.key}|${cacheKey}` };
	}

	// The ONE Text Background mask builder: preview and export both reach it
	// through getSlotMask, against the same pre-computed
	// `measurement.textBackgroundGeometry` (already in the mask canvas's own
	// local space; see getMeasurementEntry). Cached on the measurement entry
	// the same way the border mask is, so it isn't rebuilt per animation frame.
	getTextBackgroundMaskCanvas(layer, measurement = this.getMeasurementEntry(layer)) {
		const geometry = measurement.textBackgroundGeometry;
		if (!geometry?.shapes?.length) return null;
		if (measurement._backgroundMaskCache?.key === measurement.key) {
			return measurement._backgroundMaskCache.canvas;
		}

		const canvas = createAppCanvas(0, 0, 'layers/TextGlitterManager');
		canvas.width = measurement.width;
		canvas.height = measurement.height;
		copyMaskTextureOrigin(canvas, measurement.canvas);
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.fillStyle = '#ffffff';
		if (measurement.drawBackground) measurement.drawBackground(ctx);
		else renderTextBackgroundGeometry(ctx, geometry);

		if (shouldUseCrispMaskEdges()) {
			binarizeCanvasAlpha(ctx, canvas.width, canvas.height);
		}

		measurement._backgroundMaskCache = { key: measurement.key, canvas };
		return canvas;
	}

	async refreshLayer(layer, options = {}) {
		const {
			saveHistory = false,
			refreshLayerList = true,
			refreshPreview = true,
			preservePointAnchorFrom = null,
			isCurrent = null
		} = options;

		await FontLibrary.ensureLoaded(layer.textData.fontId);
		// A live edit that a newer one has overtaken: the newer run measures and
		// draws the layer, and this one's anchor snapshot is out of date.
		if (isCurrent && !isCurrent()) return;
		const measurement = this.getMeasurementEntry(layer);
		if (preservePointAnchorFrom) {
			this.applyPointAnchorSnapshot(layer, preservePointAnchorFrom, measurement);
		}
		layer._pendingPointAnchorSnapshot = null;

		if (refreshPreview) {
			this.editor.requestPreviewUpdate();
		} else {
			this.renderLayer(layer);
		}

		if (refreshLayerList) {
			this.editor.layerManager.renderLayersList();
		}

		this.loadLayerSettings(layer);
		this.editor.updateActionButtons();
		this.editor.updateHelpfulMessage();

		if (saveHistory) {
			if (this.editSession) this.editSession.dirty = true;
			else this.editor.saveState('Edit text');
		}
	}

	canResizeBoxEdges(layer, edge = null) {
		return Boolean(layer?.type === LayerType.TEXT_GLITTER && layer.textData?.boxMode !== 'point' && (!edge || ['left', 'right', 'top', 'bottom', 'tl', 'tr', 'bl', 'br'].includes(edge)));
	}

	getBoxResizeMetrics(layer, dragState) {
		const rotationRad = -(dragState.transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);
		const worldRotationRad = (dragState.transform.rotation * Math.PI) / 180;
		const worldCos = Math.cos(worldRotationRad);
		const worldSin = Math.sin(worldRotationRad);
		const minBoxSize = this.getMinBoxSize();
		const scaleX = Math.max(0.01, (dragState.transform.scale.x || 100) / 100);
		const scaleY = Math.max(0.01, (dragState.transform.scale.y || 100) / 100);
		const boxWidth = Math.max(minBoxSize, Math.round(dragState.boxWidth || layer.textData.boxWidth || minBoxSize));
		const boxHeight = Math.max(minBoxSize, Math.round(dragState.boxHeight || layer.textData.boxHeight || this.getMeasurementEntry(layer).layoutHeight));
		const frame = dragState.textBoxFrame || this.getFixedBoxFrame(layer) || { offsetX: 0, offsetY: 0 };
		const baseDisplayWidth = boxWidth * scaleX;
		const baseDisplayHeight = boxHeight * scaleY;
		const minDisplayWidth = minBoxSize * scaleX;
		const minDisplayHeight = minBoxSize * scaleY;
		// Frame offsets are text-local units; scale them into display space.
		const originWorldX = dragState.transform.position.x + frame.offsetX * scaleX * worldCos - frame.offsetY * scaleY * worldSin;
		const originWorldY = dragState.transform.position.y + frame.offsetX * scaleX * worldSin + frame.offsetY * scaleY * worldCos;
		return {
			rotationRad,
			cos,
			sin,
			worldRotationRad,
			worldCos,
			worldSin,
			minBoxSize,
			scaleX,
			scaleY,
			minDisplayWidth,
			minDisplayHeight,
			baseDisplayWidth,
			baseDisplayHeight,
			originWorldX,
			originWorldY
		};
	}

	applyResizedBoxRect(layer, dragState, rect, metrics) {
		const nextBoxWidth = Math.max(metrics.minBoxSize, Math.round((rect.right - rect.left) / metrics.scaleX));
		const nextBoxHeight = Math.max(metrics.minBoxSize, Math.round((rect.bottom - rect.top) / metrics.scaleY));
		const newCenterLocalX = (rect.left + rect.right) / 2;
		let newCenterLocalY = (rect.top + rect.bottom) / 2;

		const keepAutoHeight = layer.textData.boxMode === 'autoHeight' && dragState.textResizeEdge && ['left', 'right'].includes(dragState.textResizeEdge);
		layer.textData.boxMode = keepAutoHeight ? 'autoHeight' : 'fixed';
		layer.textData.boxWidth = nextBoxWidth;
		if (keepAutoHeight) delete layer.textData.boxHeight;
		else layer.textData.boxHeight = nextBoxHeight;
		const measurement = this.getMeasurementEntry(layer);
		if (keepAutoHeight) newCenterLocalY = rect.top + measurement.layoutHeight * metrics.scaleY / 2;
		const desiredFrameCenterX = metrics.originWorldX + newCenterLocalX * metrics.worldCos - newCenterLocalY * metrics.worldSin;
		const desiredFrameCenterY = metrics.originWorldY + newCenterLocalX * metrics.worldSin + newCenterLocalY * metrics.worldCos;
		const nextFrame = this.getFixedBoxFrame(layer, measurement) || { offsetX: 0, offsetY: 0 };
		const nextOffsetX = nextFrame.offsetX * metrics.scaleX;
		const nextOffsetY = nextFrame.offsetY * metrics.scaleY;

		layer.transform.position.x = desiredFrameCenterX - (nextOffsetX * metrics.worldCos - nextOffsetY * metrics.worldSin);
		layer.transform.position.y = desiredFrameCenterY - (nextOffsetX * metrics.worldSin + nextOffsetY * metrics.worldCos);

		const transform = this.layerTransforms.get(layer.id);
		if (transform) {
			transform.element = this.layerElements.get(layer.id) || transform.element;
			this.renderLayer(layer);
			transform.applyTransform(transform.element, {
				width: measurement.width,
				height: measurement.height
			});
			transform.updateHandlePositions();
		} else {
			this.renderLayer(layer);
		}

		this.loadLayerSettings(layer);
		this.editor.updateHelpfulMessage();
		return true;
	}

	resizeBoxFromHandle(layer, edge, dragState, canvasPos, options = {}) {
		if (!this.canResizeBoxEdges(layer)) {
			return false;
		}

		dragState.textResizeEdge = edge;
		const metrics = this.getBoxResizeMetrics(layer, dragState);
		const measurement = this.getMeasurementEntry(layer);
		const ink = measurement.textInkRect;
		const axes = ['left', 'right'].includes(edge) ? 'x' : ['top', 'bottom'].includes(edge) ? 'y' : 'xy';
		const ownInk = CONFIG.snapping.targets.textBox.ownInk && ink ? {
			x: [ink.x, ink.x + ink.width].map(x => this.getWorldPointFromLocal(layer.transform, { x: x - measurement.width / 2, y: 0 }).x),
			y: [ink.y, ink.y + ink.height].map(y => this.getWorldPointFromLocal(layer.transform, { x: 0, y: y - measurement.height / 2 }).y)
		} : { x: [], y: [] };
		canvasPos = this.editor.snapScalePoint(this.layerTransforms.get(layer.id), canvasPos, { ...options, kind: 'textBox', axes, targets: ownInk });
		const vectorX = canvasPos.x - metrics.originWorldX;
		const vectorY = canvasPos.y - metrics.originWorldY;
		const localX = vectorX * metrics.cos - vectorY * metrics.sin;
		const localY = vectorX * metrics.sin + vectorY * metrics.cos;
		const rect = {
			left: -metrics.baseDisplayWidth / 2,
			right: metrics.baseDisplayWidth / 2,
			top: -metrics.baseDisplayHeight / 2,
			bottom: metrics.baseDisplayHeight / 2
		};

		if (edge === 'right') {
			rect.right = Math.max(localX, rect.left + metrics.minDisplayWidth);
		} else if (edge === 'left') {
			rect.left = Math.min(localX, rect.right - metrics.minDisplayWidth);
		} else if (edge === 'bottom') {
			rect.bottom = Math.max(localY, rect.top + metrics.minDisplayHeight);
		} else if (edge === 'top') {
			rect.top = Math.min(localY, rect.bottom - metrics.minDisplayHeight);
		} else if (edge === 'tl') {
			rect.left = Math.min(localX, rect.right - metrics.minDisplayWidth);
			rect.top = Math.min(localY, rect.bottom - metrics.minDisplayHeight);
		} else if (edge === 'tr') {
			rect.right = Math.max(localX, rect.left + metrics.minDisplayWidth);
			rect.top = Math.min(localY, rect.bottom - metrics.minDisplayHeight);
		} else if (edge === 'br') {
			rect.right = Math.max(localX, rect.left + metrics.minDisplayWidth);
			rect.bottom = Math.max(localY, rect.top + metrics.minDisplayHeight);
		} else if (edge === 'bl') {
			rect.left = Math.min(localX, rect.right - metrics.minDisplayWidth);
			rect.bottom = Math.max(localY, rect.top + metrics.minDisplayHeight);
		} else {
			return false;
		}

		return this.applyResizedBoxRect(layer, dragState, rect, metrics);
	}

	setBoxSize(layer, width, height) {
		if (!this.canResizeBoxEdges(layer)) {
			return false;
		}

		const worldCenter = this.getFrameCenterWorldPosition(layer);
		const minBoxSize = this.getMinBoxSize();
		layer.textData.boxWidth = Math.max(minBoxSize, Math.round(width));
		layer.textData.boxHeight = Math.max(minBoxSize, Math.round(height));
		const measurement = this.getMeasurementEntry(layer);
		const nextFrame = this.getFixedBoxFrame(layer, measurement);
		if (nextFrame) {
			this.setFrameCenterWorldPosition(layer, worldCenter, nextFrame);
		}

		this.renderLayer(layer);
		this.loadLayerSettings(layer);
		this.editor.layerManager.renderLayersList();
		this.editor.updateHelpfulMessage();
		return true;
	}

	async commitScale(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER) return;

		const transform = getLayerTransform(layer);
		const scaleX = Math.max(0.01, (transform.scale.x || 100) / 100);
		const scaleY = Math.max(0.01, (transform.scale.y || 100) / 100);
		const scaleFactor = Math.min(scaleX, scaleY);
		if (Math.abs(scaleX - 1) < 1e-3 && Math.abs(scaleY - 1) < 1e-3) {
			transform.scale.x = 100;
			transform.scale.y = 100;
			return;
		}

		const worldCenter = this.getFrameCenterWorldPosition(layer);
		const previousFontSize = layer.textData.fontSize;
		const nextFontSize = Math.max(
			FIELDS.textFontSize.min,
			Math.min(FIELDS.textFontSize.max, Math.round(previousFontSize * scaleFactor))
		);
		const bakedFactor = nextFontSize / Math.max(1, previousFontSize);
		layer.textData.fontSize = nextFontSize;
		if (layer.textData.boxMode !== 'point') {
			layer.textData.boxWidth = Math.round(layer.textData.boxWidth * bakedFactor);
			if (layer.textData.boxMode === 'fixed') layer.textData.boxHeight = Math.round(layer.textData.boxHeight * bakedFactor);
		}
		const factors = {
			geometry: bakedFactor,
			effect: PREFERENCES.get('scaleEffects') ? bakedFactor : 1,
			texture: PREFERENCES.get('scaleTextures') ? bakedFactor : 1
		};
		scaleLayerSlotFields(layer, factors);
		scaleLayerFields(layer, factors, binding => !['textData.fontSize', 'textData.boxWidth', 'textData.boxHeight'].includes(binding.path));
		transform.scale.x = (scaleX / bakedFactor) * 100;
		transform.scale.y = (scaleY / bakedFactor) * 100;

		const measurement = this.getMeasurementEntry(layer);
		const nextFrame = this.getTextFrame(layer, measurement);
		if (nextFrame) {
			this.setFrameCenterWorldPosition(layer, worldCenter, nextFrame);
		}

		try {
			await this.refreshLayer(layer, {
				saveHistory: false,
				refreshLayerList: false
			});
		} catch (error) {
			this.reportFontLoadError(error);
		}
		// Baked values are no longer the defaults those sliders shipped with.
		syncPropertyReverts();
	}

	// ===== TRANSFORM UPDATES (Delegation to LayerTransform, mirrors StickerManager) =====

	updateTransform(layerId, updates) {
		const transform = this.layerTransforms.get(layerId);
		if (!transform) return;

		transform.updateTransform(updates);

		const element = this.layerElements.get(layerId);
		if (element) {
			transform.applyTransform(element, transform.getDimensions());

			if (transform.transformHandles) {
				transform.updateHandlePositions();
			}
		}
	}

	// ===== CENTERING METHODS (Delegation to LayerTransform, mirrors StickerManager) =====

	removeLayerElement(layerId) {
		this.previewMaskUrls.deleteWhere((key) => key.startsWith(`${layerId}|`));
		LAYER_ELEMENT_METHODS.removeLayerElement.call(this, layerId);
	}

	clearElements() {
		// New document / image reset: no layer survives, so any armed picker
		// session is stale.
		this.closePickerSession();
		LAYER_ELEMENT_METHODS.clearElements.call(this);
	}

	clearPreviewMaskUrls() {
		this.previewMaskUrls.clear();
	}

	// Each mask "slot" (fill, border, ...) gets its own cached data URL — border
	// needs a different rasterized shape than fill, so they can't share one.
	// Synchronous (toDataURL, not toBlob+Image) so a live box-resize drag never
	// shows a stale mask stretched to the new box size while a blob decodes.
	getPreviewMaskDataUrl(layer, maskType, canvas, cacheKey) {
		const slotKey = `${layer.id}|${maskType}`;
		const cached = this.previewMaskUrls.get(slotKey);

		if (cached?.key === cacheKey) {
			return cached.url;
		}

		const url = canvas.toDataURL('image/png');
		this.previewMaskUrls.set(slotKey, { key: cacheKey, url });
		return url;
	}

	buildExportPlan(layer, context) {
		return context.compositor._buildSlotStackExportPlan(layer, { ensureTextFont: true });
	}
}

Object.assign(TextGlitterManager.prototype, TEXT_EDIT_METHODS, TEXT_ACTION_METHODS);

Object.assign(TextGlitterManager.prototype, MOVABLE_LAYER_METHODS);
