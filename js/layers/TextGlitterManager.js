// ============================================
// TEXT GLITTER MANAGER CLASS
// Handles text glitter layer rendering, font loading, and text settings
// ============================================
class TextGlitterManager {
	constructor(editor) {
		this.editor = editor;

		this.layerElements = new Map();
		this.layerTransforms = new Map();

		this.fontPickerRendered = false;

		this.textMaskCache = new Map();
		// Preview mask data URL per layer id and mask bucket (fill, border, ...),
		// each keyed by content. Dropped when the layer's element is removed.
		this.previewMaskUrls = new Map();
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
	}

	async init() {
		this.setupUI();
		this.setupEventListeners();
		this.setupPickerStripListeners();
		FontLibrary.loadManifest().then(() => this.renderFontPicker()).catch((error) => this.reportFontLoadError(error));
	}

	setupUI() {
		this.ui = {
			section: document.getElementById('textSettingsSection'),
			textInput: document.getElementById('textLayerInput'),
			fontPicker: document.getElementById('textFontPicker'),
			fontBold: document.getElementById('textFontBold'),
			fontItalic: document.getElementById('textFontItalic'),
			textCaseSelect: document.getElementById('textCaseSelect'),
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
			ensureSlot: (layer, key) => this.ensureEffectData(layer, key),
			getSlotDefaults: (key) => this.getEffectDefaults(key),
			apply: (layer, mutate, change) => this.runLayoutRefreshWithAnchor(layer, mutate, change.live
				? { saveHistory: false, refreshLayerList: false, refreshPreview: Boolean(change.geometry) }
				: { saveHistory: true, refreshPreview: false }
			).catch((error) => this.reportFontLoadError(error)),
			render: (layer) => this.renderLayer(layer),
			commit: () => {
				this.editor.saveState('Edit text');
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
			this.ui.textInput.addEventListener('input', () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;

				const value = this.ui.textInput.value.slice(0, CONFIG.tools.text.maxTextLength);
				if (value !== this.ui.textInput.value) {
					this.ui.textInput.value = value;
				}

				this.preparePendingAnchorPreservation(layer);
				layer.textData.text = value;
				layer.name = this.getLayerName(value);
				this.updateLiveTextContent(layer.id, value);
				this.editor.layerManager.renderLayersList();
				this.editor.updateActionButtons();
				this.editor.updateHelpfulMessage();
				this.scheduleTextCommit(layer);
			});
		}

		if (this.ui.fontPicker) {
			this.ui.fontPicker.addEventListener('click', async (event) => {
				const button = event.target.closest('[data-font-id]');
				if (!button) return;

				const layer = this.getActiveTextLayer();
				if (!layer) return;

				const fontId = button.dataset.fontId;
				if (!fontId || fontId === layer.textData.fontId) return;

				try {
					await this.runLayoutRefreshWithAnchor(layer, async () => {
						layer.textData.fontId = fontId;
						await FontLibrary.ensureLoaded(fontId);
					}, { saveHistory: true });
				} catch (error) {
					this.reportFontLoadError(error);
				}
			});
		}

		const bindFontStyleToggle = (button, property, activeValue, inactiveValue) => {
			button?.addEventListener('click', async () => {
				const layer = this.getActiveTextLayer();
				if (!layer) return;
				await this.runLayoutRefreshWithAnchor(layer, () => {
					layer.textData[property] = layer.textData[property] === activeValue ? inactiveValue : activeValue;
				}, { saveHistory: true });
			});
		};
		bindFontStyleToggle(this.ui.fontBold, 'fontWeight', 700, 400);
		bindFontStyleToggle(this.ui.fontItalic, 'fontStyle', 'italic', 'normal');
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

		this.ui.alignButtons.forEach((button) => {
			button.addEventListener('click', () => {
				const layer = this.getActiveTextLayer();
				const align = button.dataset.textAlign;
				if (!layer || !align || align === layer.textData.align) return;
				editLayout(layer, () => { layer.textData.align = align; });
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
				if (!nextMode || nextMode === (layer.textData.boxMode || 'auto')) return;
				editLayout(layer, () => {
					if (nextMode === 'fixed') {
						this.ensureFixedBox(layer);
					} else {
						layer.textData.boxMode = 'auto';
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
				layer.textData.textBackground = this.getDefaultTextBackground();
				delete layer.textData.effectDrafts;
				delete layer.animation;
			}, { refreshPreview: false });
			this.editor.animationPanel?.load(layer);
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
			world: this.getTextOriginWorldPosition(layer)
		};
	}

	preparePendingAnchorPreservation(layer) {
		if (!layer || layer._pendingPointAnchorSnapshot
			|| (layer.textData?.boxMode || 'auto') !== 'auto') return;
		layer._pendingPointAnchorSnapshot = this.getPointAnchorSnapshot(layer);
	}

	async runLayoutRefreshWithAnchor(layer, mutateFn, options = {}) {
		const snapshot = ((layer.textData?.boxMode || 'auto') === 'auto' || options.preservePointAnchor)
			? this.getPointAnchorSnapshot(layer)
			: null;
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
		const scaleX = (transform.scale.x || 100) / 100;
		const scaleY = (transform.scale.y || 100) / 100;
		const rotationRad = (transform.rotation * Math.PI) / 180;
		const cos = Math.cos(rotationRad);
		const sin = Math.sin(rotationRad);
		return {
			x: transform.position.x + localPoint.x * scaleX * cos - localPoint.y * scaleY * sin,
			y: transform.position.y + localPoint.x * scaleX * sin + localPoint.y * scaleY * cos
		};
	}

	setWorldPointFromLocal(transform, localPoint, worldPoint) {
		const scaleX = (transform.scale.x || 100) / 100;
		const scaleY = (transform.scale.y || 100) / 100;
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
		this.setTextOriginWorldPosition(layer, snapshot.world, measurement);
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
	getDefaultBorder() {
		return buildDefaultBorder({
			config: CONFIG.tools.text.border,
			slot: getPaintSlotDefinition(LayerType.TEXT_GLITTER, 'border'),
			fallbackMode: 'glitter',
			defaultGlitterId: CONFIG.tools.glitter.defaults.borderGlitterId.text
		});
	}

	getDefaultShadow() {
		return buildDefaultShadow({
			defaultMode: 'glitter',
			defaultGlitterId: CONFIG.tools.glitter.defaults.shadowGlitterId.text
		});
	}

	getDefaultFill() {
		return buildDefaultFill({ defaultGlitterId: CONFIG.tools.glitter.defaults.fillGlitterId.text });
	}

	// textBackground.fill is its own full paint slot (scale/colorAdjust
	// included, like border/shadow) — the canonical Fill representation, not a
	// Text Background-specific paint model (DYNAMIC-TEXT-BACKGROUND-
	// IMPLEMENTATION-PLAN.md "Fill integration").
	getDefaultBackgroundFill() {
		return buildDefaultFill({
			defaultGlitterId: CONFIG.tools.glitter.defaults.backgroundGlitterId
		});
	}

	// Geometry defaults to the "Instagram" preset (TEXT_BACKGROUND_PRESETS,
	// matches TEXT_BACKGROUND_PRESET_OPTIONS' default selection) rather than
	// raw slider defaults, so a freshly enabled background already looks like a
	// deliberate choice instead of the placeholder-preset "Choose a preset…" state.
	getDefaultTextBackground() {
		return {
			enabled: false,
			...TEXT_BACKGROUND_PRESETS.instagram,
			fill: this.getDefaultBackgroundFill()
		};
	}

	getMinBoxSize() {
		return Math.max(1, Math.round(CONFIG.tools.text.minBoxSize || 40));
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
			layer.textData.border = mergeSlotEffectDefaults(layer.textData.border, this.getDefaultBorder());
		}
		if (layer.textData.shadow === undefined) {
			layer.textData.shadow = null;
		}
		if (layer.textData.shadow) {
			layer.textData.shadow = mergeSlotEffectDefaults(layer.textData.shadow, this.getDefaultShadow());
		}
		layer.textData.fill = mergeSlotEffectDefaults(layer.textData.fill, this.getDefaultFill());
		normalizeSlotTextureCoordinates(layer.textData.fill);
		normalizeSlotTextureCoordinates(layer.textData.border);
		normalizeSlotTextureCoordinates(layer.textData.shadow);
		if (!layer.textData.boxMode) {
			layer.textData.boxMode = CONFIG.tools.text.defaultBoxMode || 'auto';
		}
		if (!layer.textData.verticalAlign) {
			layer.textData.verticalAlign = CONFIG.tools.text.defaultVerticalAlign || 'top';
		}
		this.normalizeTextBackground(layer);
		if (!layer.textData.lineHeight) {
			layer.textData.lineHeight = FIELDS.textLineHeight.value / 100;
		}
		if (!layer.textData.fontWeight) {
			layer.textData.fontWeight = CONFIG.tools.text.defaultFontWeight || 400;
		}
		if (!layer.textData.fontStyle) {
			layer.textData.fontStyle = CONFIG.tools.text.defaultFontStyle || 'normal';
		}
		if (!['none', 'upper', 'lower', 'title'].includes(layer.textData.textCase)) {
			layer.textData.textCase = CONFIG.tools.text.defaultTextCase;
		}
	}

	// Phase 2 (data model): defaults, clamping, and the point-vs-box mode
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
		const clamp = (value, fallback, min, max) => {
			const num = Number(value);
			return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : fallback;
		};
		tb.horizontalPadding = clamp(tb.horizontalPadding, defaults.horizontalPadding, 0, 400);
		tb.verticalPadding = clamp(tb.verticalPadding, defaults.verticalPadding, 0, 400);
		tb.cornerRadius = clamp(tb.cornerRadius, defaults.cornerRadius, 0, 400);
		tb.mergeDistance = clamp(tb.mergeDistance, defaults.mergeDistance, 0, 400);
		tb.lineSpacingSensitivity = clamp(tb.lineSpacingSensitivity, defaults.lineSpacingSensitivity, 0, 100);
		tb.fill = mergeSlotEffectDefaults(tb.fill, defaults.fill);
		normalizeSlotTextureCoordinates(tb.fill);
		// Point text has no independent container — Text Box can only ever be
		// reached from box text, and a box→point switch must not leave it stuck.
		if (tb.mode === 'text-box' && (layer.textData.boxMode || 'auto') !== 'fixed') {
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
		layer.textData.boxMode = 'auto';
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
		if ((layer.textData.boxMode || 'auto') !== 'fixed') return;

		const entry = this.getMeasurementEntry(layer);
		if (!entry.lines.length) return;

		const minBoxSize = this.getMinBoxSize();
		const lastLine = entry.lines[entry.lines.length - 1];
		const fullHeight = entry.ascent + (entry.lines.length - 1) * entry.lineHeightPx + lastLine.descent;
		const maxLineWidth = entry.lines.reduce((max, line) => Math.max(max, line.width), 0);

		layer.textData.boxWidth = Math.max(minBoxSize, Math.ceil(maxLineWidth) + 1);
		layer.textData.boxHeight = Math.max(minBoxSize, Math.ceil(fullHeight) + 1);
	}

	// 'backgroundFill' is Text Background's nested `textBackground.fill` slot —
	// routed to a different root so it reuses every generic paint-slot binder
	// (toggle excepted: the whole effect's enable/disable is
	// `textBackground.enabled`, not fill nullability) without a parallel
	// implementation.
	ensureEffectData(layer, effectName) {
		if (!layer?.textData) return null;
		if (effectName === 'backgroundFill') {
			return ensureSlotEffectData(layer.textData.textBackground, 'fill', {
				builders: { fill: () => this.getDefaultBackgroundFill() }
			});
		}
		return ensureSlotEffectData(layer.textData, effectName, {
			builders: {
				fill: () => this.getDefaultFill(),
				border: () => this.getDefaultBorder(),
				shadow: () => this.getDefaultShadow()
			}
		});
	}

	getEffectData(layer, effectName) {
		if (effectName === 'backgroundFill') {
			return getSlotEffectData(layer?.textData?.textBackground, 'fill');
		}
		return getSlotEffectData(layer?.textData, effectName);
	}

	getGlitterSelectionTarget(layer = this.getActiveTextLayer()) {
		return pickerSelectionTarget(this, layer, {
			fallback: 'fill',
			isValid: (session) => session.slot === 'fill' || Boolean(this.getEffectData(layer, session.slot))
		});
	}

	// Thin back-compat wrapper: arming a slot opens a picker session on the
	// active layer. Callers that used to reset to 'fill' now open a fill
	// session, which browse mode / getGlitterSelectionTarget treats identically.
	setGlitterSelectionTarget(target = 'fill', layer = this.getActiveTextLayer()) {
		this.openPickerSession(layer, target);
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
		this.ensureEffectData(layer, key);
		this.setGlitterSelectionTarget(key, layer);
		const selectedGlitterId = this.resolveSelectedGlitterId(layer);
		if (selectedGlitterId) this.editor.glitterManager?.scrollToContent(selectedGlitterId);
		revealAssetBrowser(this.editor, this.editor.glitterManager);
		this.editor.updateStatus(`Choose ${this.getEffectTitle(key)} glitter, then press Esc or Done.`);
	}

	renderFontPicker() {
		if (!this.ui.fontPicker) return;
		this.fontPickerRendered = true;

		const fonts = [...FontLibrary.fonts].sort(
			(a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured))
		);

		// Every font gets the same card: a same sample phrase rendered in the
		// font itself (never the font's own name — that's shown separately
		// below, in the UI font, like a gallery card's name caption), plus a
		// corner badge for any script beyond plain Latin.
		const sampleTextByScript = { latin: 'Glitter', ja: 'グリッター', ko: '글리터', zh: '闪粉' };
		const langLabels = { ja: 'JA', ko: 'KO', zh: 'ZH' };

		this.ui.fontPicker.innerHTML = '';
		fonts.forEach((font) => {
			const scripts = font.scripts || ['latin'];
			const sampleScript = scripts.find((script) => script !== 'latin' && sampleTextByScript[script]) || 'latin';
			const extraScripts = scripts.filter((script) => script !== 'latin');

			const card = document.createElement('button');
			card.className = 'choice-card text-font-option';
			card.type = 'button';
			card.dataset.fontId = font.id;
			const credit = Attribution.creditLine(font.attribution);
			card.title = credit ? `${font.name} — ${credit}` : font.name;

			const sample = document.createElement('span');
			sample.className = 'text-font-option-sample';
			sample.style.fontFamily = FontLibrary.getFamily(font);
			sample.textContent = sampleTextByScript[sampleScript];
			card.appendChild(sample);

			const name = document.createElement('span');
			name.className = 'text-font-option-name';
			name.textContent = font.name;
			card.appendChild(name);

			// One corner badge: extra scripts and/or the device-font marker
			// (system faces render with a fallback on devices without them).
			const badgeLabels = extraScripts.map((script) => langLabels[script] || script.toUpperCase());
			if (font.system) badgeLabels.push('System');
			if (badgeLabels.length > 0) {
				const badge = document.createElement('span');
				badge.className = 'text-font-option-badge';
				extraScripts.forEach((script) => badge.classList.add(`is-${script}`));
				if (font.system) badge.classList.add('is-system');
				badge.textContent = badgeLabels.join(' · ');
				card.appendChild(badge);
			}

			this.ui.fontPicker.appendChild(card);
		});
	}

	// The picker's samples render in their own faces, so the panel loads every
	// font the first time it opens.
	async ensureFontPickerReady() {
		await FontLibrary.loadManifest();
		if (!this.fontPickerRendered) this.renderFontPicker();
		return FontLibrary.ensureAllLoaded((error) => this.reportFontLoadError(error));
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

		const defaultText = options.text ?? CONFIG.tools.text.defaultText;
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
				fontWeight: CONFIG.tools.text.defaultFontWeight || 400,
				fontStyle: CONFIG.tools.text.defaultFontStyle || 'normal',
				textCase: CONFIG.tools.text.defaultTextCase,
				fontSize: FIELDS.textFontSize.value,
				letterSpacing: FIELDS.textLetterSpacing.value,
				lineHeight: FIELDS.textLineHeight.value / 100,
				align: initialAlign,
				verticalAlign: CONFIG.tools.text.defaultVerticalAlign || 'top',
				boxMode: options.boxMode || CONFIG.tools.text.defaultBoxMode || 'auto',
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

		this.ensureFontPickerReady().catch((error) => {
			this.reportFontLoadError(error);
		});

		if (this.ui.textInput) {
			this.ui.textInput.value = layer.textData.text;
		}

		syncFieldControls(this.fieldHost, layer);

		this.updateFontSelection(layer.textData.fontId);
		this.updateFontStyleSelection(layer.textData);
		this.updateAlignmentSelection(layer.textData.align);
		this.updateVerticalAlignmentSelection(layer.textData.verticalAlign);
		this.updateBoxModeSelection(layer);
		this.syncTextBackgroundUI(layer);
		this.updatePickerStrip();
		this.editor.loadTransformSettings?.(layer, 'text');
	}

	focusTextInput(selectAll = false) {
		if (!this.ui.textInput) return;
		this.ui.textInput.closest('[data-panel-group]')?.classList.remove('collapsed');

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

	updateFontSelection(fontId) {
		if (!this.ui.fontPicker) return;

		this.ui.fontPicker.querySelectorAll('[data-font-id]').forEach((button) => {
			button.classList.toggle('active', button.dataset.fontId === fontId);
		});

		// Only reveal the active card when the font actually changed. This runs
		// on every panel sync, so scrolling unconditionally threw the list back
		// to the selected font whenever anything else about the text changed -
		// pressing Bold while browsing further down the list lost your place.
		if (fontId !== this.lastRevealedFontId) {
			this.lastRevealedFontId = fontId;
			this.scrollActiveFontIntoView();
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
	}

	applyTextCase(text, mode) {
		const value = String(text || '');
		if (mode === 'upper') return value.toLocaleUpperCase();
		if (mode === 'lower') return value.toLocaleLowerCase();
		if (mode === 'title') return value.replace(/(^|\s)(\S)/gu, (match, space, letter) => space + letter.toLocaleUpperCase());
		return value;
	}

	scrollActiveFontIntoView() {
		const picker = this.ui.fontPicker;
		const active = picker?.querySelector('.text-font-option.active');
		if (!picker || !active || picker.scrollHeight <= picker.clientHeight) return;

		const top = active.offsetTop;
		const bottom = top + active.offsetHeight;
		if (top < picker.scrollTop) {
			picker.scrollTop = top;
		} else if (bottom > picker.scrollTop + picker.clientHeight) {
			picker.scrollTop = bottom - picker.clientHeight;
		}
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
		const mode = layer?.textData?.boxMode || 'auto';
		this.ui.boxModeButtons.forEach((button) => {
			button.classList.toggle('active', button.dataset.textBoxMode === mode);
		});

		// CSS hides only the vertical alignment controls in point mode.
		if (this.ui.section) {
			this.ui.section.dataset.boxMode = mode;
		}

		if (this.ui.boxModeHint) {
			this.ui.boxModeHint.textContent = mode === 'fixed'
				? 'Box text wraps inside the frame. Side handles resize the box; corner handles scale the text and box together.'
				: 'Point text hugs the glyphs. Corner handles scale it. Switch to Box for wrapping inside a resizable frame.';
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
		const isBoxText = (layer.textData.boxMode || 'auto') === 'fixed';
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
		const connectionRow = this.ui.bgConnSeparate?.closest('[data-stack-group="Line Connection"]');
		if (connectionRow) connectionRow.hidden = tb.mode !== 'lines';
		const mergeSet = this.ui.bgMergeDistance?.closest('.property-set');
		if (mergeSet) mergeSet.hidden = tb.mode !== 'lines' || tb.lineConnection === 'separate';
	}

	updateEffectTargetButtons(layer) {
		syncPaintSlotPickerTargets(this.fieldHost, layer);
		this.updatePickerStrip();
	}

	setupPickerStripListeners() {
		this.ui.pickerStripDone?.addEventListener('click', () => {
			// The strip is shared by every asset/effect manager. Text may only own
			// Done while a text layer has an armed text picker session.
			if (this.editor.layerManager.getActiveLayer()?.type !== LayerType.TEXT_GLITTER || !this.pickerSession) return;
			const slot = this.pickerSession?.slot || 'fill';
			this.closePickerSession();
			this.returnToTextProperties(slot);
		});

		// Single global Esc listener: exits picker mode, but stays out of the way
		// when the user is typing or a modal owns the interaction.
		document.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape' || !this.pickerSession) return;
			const active = document.activeElement;
			const isTyping = active && (active.tagName === 'INPUT'
				|| active.tagName === 'TEXTAREA' || active.isContentEditable);
			if (isTyping) return;
			if (this.editor.modalManager?.isAnyOpen?.()) return;
			event.preventDefault();
			const slot = this.pickerSession?.slot || 'fill';
			this.closePickerSession();
			this.returnToTextProperties(slot);
			this.editor.updateStatus('Exited glitter picker. Gallery clicks now change the text fill.');
		});
	}

	// Explicit exit from picker mode (Done / Esc) returns focus to where the
	// user armed from. This is deliberately NOT part of closePickerSession —
	// the automatic clears (layer switch, effect disable, history restore)
	// already move the user elsewhere and must not yank the view back.
	returnToTextProperties(slot = 'fill') {
		const chipId = slot === 'border'
			? 'textBorderGlitterChip'
			: slot === 'shadow'
				? 'textShadowGlitterChip'
				: slot === 'backgroundFill'
					? 'textBackgroundGlitterChip'
					: 'textFillGlitterChip';
		returnFromPickerToProperties(this.editor, { section: 'textSettings', focusId: chipId });
	}

	// D-1c: the gallery status strip. Same copy/look whether armed or not —
	// picker mode (an armed slot) adds a Done button; browse mode names the
	// default slot (fill) a swatch click applies to. Driven from
	// updateEffectTargetButtons (arm/disarm, fill-mode flips, layer activate)
	// and app.updateSidePanelUI (switching to any layer type).
	updatePickerStrip() {
		const layer = this.getActiveTextLayer();
		if (!layer) {
			renderPickerStrip({ ownsStrip: true, visible: false });
			return;
		}
		const armedSlot = pickerSelectionTarget(this, layer, {
			isValid: (session) => session.slot === 'fill' || Boolean(this.getEffectData(layer, session.slot))
		});
		const fillData = this.getEffectData(layer, 'fill');
		const fillIsSolid = fillData?.mode === 'solid';
		if (armedSlot) {
			let stripText;
			if (armedSlot === 'fill' && fillIsSolid) {
				const color = (fillData.color || '#000000').toUpperCase();
				stripText = { title: 'Choosing fill glitter', detail: `${formatPickerTarget(layer.name, 'text')}; current fill is solid (${color}).` };
			} else {
				stripText = formatPickerStripText(this.getEffectTitle(armedSlot), layer.name, 'text');
			}
			renderPickerStrip({ ownsStrip: true, visible: true, armed: true, ...stripText });
			return;
		}
		const stripText = fillIsSolid
			? { title: 'Choosing fill glitter', detail: `${formatPickerTarget(layer.name, 'text')}; current fill is solid (${(fillData.color || '#000000').toUpperCase()}).` }
			: formatPickerStripText('fill', layer.name, 'text');
		renderPickerStrip({ ownsStrip: true, visible: true, hint: true, ...stripText });
	}

	// One place each slot's default comes from.
	getEffectDefaults(effectName) {
		if (effectName === 'fill') return this.getDefaultFill();
		if (effectName === 'shadow') return this.getDefaultShadow();
		if (effectName === 'backgroundFill') return this.getDefaultBackgroundFill();
		return this.getDefaultBorder();
	}

	getEffectTitle(effectName) {
		return effectName === 'backgroundFill' ? 'background' : effectName;
	}

	scheduleTextCommit(layer) {
		clearTimeout(this.textInputTimer);
		this.textInputTimer = setTimeout(async () => {
			try {
				await this.refreshLayer(layer, {
					saveHistory: true,
					preservePointAnchorFrom: layer._pendingPointAnchorSnapshot || null
				});
			} catch (error) {
				this.reportFontLoadError(error);
			}
		}, CONFIG.tools.selection.timing.sliderDebounceMs);
	}

	getCacheKeyForLayer(layer) {
		const textData = layer.textData;
		return JSON.stringify([
			textData.text,
			textData.textCase,
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
			textData.verticalAlign || 'top',
			textData.boxMode || 'auto',
			textData.boxWidth ?? null,
			textData.boxHeight ?? null,
			textData.border ? [textData.border.widthPx, getBorderPlacement(textData.border)] : null,
			textData.shadow ? textData.shadow.offsetX : null,
			textData.shadow ? textData.shadow.offsetY : null,
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
		const lines = this.applyTextCase(layer.textData.text, layer.textData.textCase).split('\n');
		const padding = CONFIG.rendering?.maskPaddingPx ?? 8;
		const fontSize = layer.textData.fontSize;
		const letterSpacing = layer.textData.letterSpacing;
		const lineHeightPx = fontSize * layer.textData.lineHeight;
		const borderWidth = getBorderOutsidePadding(layer.textData.border);
		const shadowOffsetX = layer.textData.shadow?.offsetX || 0;
		const shadowOffsetY = layer.textData.shadow?.offsetY || 0;
		const boxMode = layer.textData.boxMode || 'auto';

		ctx.font = FontLibrary.getDeclaration(font, fontSize, layer.textData.fontWeight, layer.textData.fontStyle);
		ctx.textBaseline = 'alphabetic';

		const sampleMetrics = ctx.measureText('Hg');
		const ascent = sampleMetrics.actualBoundingBoxAscent || fontSize * 0.8;
		const descent = sampleMetrics.actualBoundingBoxDescent || fontSize * 0.2;

		let measuredLines = [];
		let layoutWidth = 0;
		let layoutHeight = 0;
		let visibleLineCount = 0;
		let hasOverflow = false;
		let contentOffsetY = 0;
		const minBoxSize = this.getMinBoxSize();

		if (boxMode === 'fixed') {
			layoutWidth = Math.max(minBoxSize, Math.round(layer.textData.boxWidth || minBoxSize));
			layoutHeight = Math.max(minBoxSize, Math.round(layer.textData.boxHeight || minBoxSize));
			const wrapped = this.wrapTextLines(ctx, lines, layoutWidth, letterSpacing, fontSize);
			measuredLines = wrapped.lines;

			measuredLines.forEach((line, index) => {
				const bottom = ascent + index * lineHeightPx + line.descent;
				if (bottom <= layoutHeight) {
					visibleLineCount++;
				}
			});
			hasOverflow = visibleLineCount < measuredLines.length;
		} else {
			measuredLines = lines.map((line) => this.measureLine(ctx, line, letterSpacing, fontSize));
			layoutWidth = measuredLines.reduce((max, line) => Math.max(max, line.width), 0);
			layoutHeight = ascent + descent + lineHeightPx * Math.max(lines.length - 1, 0);
			visibleLineCount = measuredLines.length;
		}

		const visibleLines = measuredLines.slice(0, visibleLineCount);
		let textInkLeft = Infinity;
		let textInkTop = Infinity;
		let textInkRight = -Infinity;
		let textInkBottom = -Infinity;
		let hasInk = false;

		if (boxMode === 'fixed') {
			// Vertical alignment uses visible glyph ink. Overflow lines are omitted
			// below, while glyph overhang and effects may extend past the area frame.
			if (visibleLineCount > 0) {
				visibleLines.forEach((line, index) => {
					const baselineY = ascent + index * lineHeightPx;
					textInkTop = Math.min(textInkTop, baselineY - line.ascent);
					textInkBottom = Math.max(textInkBottom, baselineY + line.descent);
				});
				contentOffsetY = this.getVerticalAlignOffset(
					layer.textData.verticalAlign || 'top',
					layoutHeight,
					textInkBottom - textInkTop
				) - textInkTop;
			}
			// The first pass exists only to derive the vertical alignment offset.
			// Rebuild the canonical bounds from the positioned lines below so the
			// unaligned top/bottom cannot leak into Text Bounds geometry.
			textInkLeft = Infinity;
			textInkTop = Infinity;
			textInkRight = -Infinity;
			textInkBottom = -Infinity;
		}

		// Canonical per-line layout for Text Background (docs/DYNAMIC-TEXT-
		// BACKGROUND-IMPLEMENTATION-PLAN.md "Expose canonical layout geometry"):
		// one positioned+aligned rect per visible line, in the same unshifted
		// local space as textInk*/box* below. `blank` lines (no ink) carry no
		// rect — Text Background treats them as hard separators, never their
		// own rectangle.
		const positionedLines = [];

		visibleLines.forEach((line, index) => {
			const offsetX = this.getAlignOffset(layer.textData.align, layoutWidth, line.width);
			const baselineY = contentOffsetY + ascent + index * lineHeightPx;
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

		if (!hasInk) {
			textInkLeft = 0;
			textInkTop = 0;
			textInkRight = 0;
			textInkBottom = 0;
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
				boxRect: boxMode === 'fixed' ? { x: 0, y: 0, width: layoutWidth, height: layoutHeight } : null,
				lineHeightPx,
				ascent,
				descent
			}, textBackgroundProps);
		}
		const backgroundBounds = textBackgroundGeometry?.bounds;

		const artLeft = Math.min(textInkLeft - borderWidth, textInkLeft + shadowOffsetX, backgroundBounds ? backgroundBounds.x : Infinity);
		const artRight = Math.max(textInkRight + borderWidth, textInkRight + shadowOffsetX, backgroundBounds ? backgroundBounds.x + backgroundBounds.width : -Infinity);
		const artTop = Math.min(textInkTop - borderWidth, textInkTop + shadowOffsetY, backgroundBounds ? backgroundBounds.y : Infinity);
		const artBottom = Math.max(textInkBottom + borderWidth, textInkBottom + shadowOffsetY, backgroundBounds ? backgroundBounds.y + backgroundBounds.height : -Infinity);
		const frameLeft = boxMode === 'fixed' ? Math.min(0, artLeft) : artLeft;
		const frameRight = boxMode === 'fixed' ? Math.max(layoutWidth, artRight) : artRight;
		const frameTop = boxMode === 'fixed' ? Math.min(0, artTop) : artTop;
		const frameBottom = boxMode === 'fixed' ? Math.max(layoutHeight, artBottom) : artBottom;

		const layoutX = padding - frameLeft;
		const layoutY = padding - frameTop;
		const canvasWidth = Math.max(1, Math.ceil(frameRight - frameLeft + padding * 2));
		const canvasHeight = Math.max(1, Math.ceil(frameBottom - frameTop + padding * 2));
		const canvas = createAppCanvas(0, 0, 'layers/TextGlitterManager');
		canvas.width = canvasWidth;
		canvas.height = canvasHeight;
		canvas._textureOrigin = { x: layoutX, y: layoutY };

		const maskCtx = canvas.getContext('2d', { willReadFrequently: true });
		maskCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		maskCtx.fillStyle = '#ffffff';
		maskCtx.font = FontLibrary.getDeclaration(font, fontSize, layer.textData.fontWeight, layer.textData.fontStyle);
		maskCtx.textBaseline = 'alphabetic';
		maskCtx.textAlign = 'left';

		visibleLines.forEach((line, index) => {
			this.drawLine(maskCtx, line.text, {
				startX: layoutX + this.getAlignOffset(layer.textData.align, layoutWidth, line.width),
				baselineY: layoutY + contentOffsetY + ascent + index * lineHeightPx,
				letterSpacing
			});
		});

		if (shouldUseCrispMaskEdges()) {
			// Hard pixel edges (editor aesthetic, MASK-FEATURE-PLAN decision 5).
			// Also load-bearing for export: fillText antialiasing leaves partial-alpha
			// edge pixels that composite over the GIF transparency key (magenta) and
			// fringe on transparent exports. A binary mask has nothing to blend.
			binarizeCanvasAlpha(maskCtx, canvasWidth, canvasHeight);
		}

		const entry = {
			key,
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
			// Selection and transform bounds describe every visible pixel. Area
			// text keeps a separate boxRect for its reflow handles.
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
		if (!layer?.textData || (layer.textData.boxMode || 'auto') !== 'fixed') {
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

	getIntrinsicTextFrame(layer, measurement = null) {
		const fixedBoxFrame = this.getFixedBoxFrame(layer, measurement);
		if (fixedBoxFrame) return fixedBoxFrame;

		if (!layer?.textData) return null;
		const entry = measurement || this.getMeasurementEntry(layer);
		const rect = entry.textInkRect;
		if (!rect || rect.width <= 0 || rect.height <= 0) {
			return this.getTextFrame(layer, entry);
		}
		return {
			width: rect.width,
			height: rect.height,
			offsetX: rect.x + rect.width / 2 - entry.width / 2,
			offsetY: rect.y + rect.height / 2 - entry.height / 2
		};
	}

	getAlignOffset(align, maxWidth, lineWidth) {
		if (align === 'center') return (maxWidth - lineWidth) / 2;
		if (align === 'right') return maxWidth - lineWidth;
		return 0;
	}

	getVerticalAlignOffset(verticalAlign, boxHeight, contentHeight) {
		if (verticalAlign === 'middle') {
			return Math.max(0, (boxHeight - contentHeight) / 2);
		}
		if (verticalAlign === 'bottom') {
			return Math.max(0, boxHeight - contentHeight);
		}
		return 0;
	}

	measureLine(ctx, text, letterSpacing, fontSize) {
		if (!text) {
			return { text, width: 0, ascent: 0, descent: 0, inkLeft: 0, inkRight: 0 };
		}

		const lineMetrics = ctx.measureText(text);
		const ascent = lineMetrics.actualBoundingBoxAscent ?? fontSize * 0.8;
		const descent = lineMetrics.actualBoundingBoxDescent ?? fontSize * 0.2;

		if (!letterSpacing) {
			return {
				text,
				width: lineMetrics.width,
				ascent,
				descent,
				inkLeft: lineMetrics.actualBoundingBoxLeft ?? 0,
				inkRight: lineMetrics.actualBoundingBoxRight ?? lineMetrics.width
			};
		}

		let advance = 0;
		let minX = Infinity;
		let maxX = -Infinity;
		for (let index = 0; index < text.length; index++) {
			const charMetrics = ctx.measureText(text[index]);
			minX = Math.min(minX, advance - (charMetrics.actualBoundingBoxLeft ?? 0));
			maxX = Math.max(maxX, advance + (charMetrics.actualBoundingBoxRight ?? charMetrics.width));
			advance += charMetrics.width;
			if (index < text.length - 1) {
				advance += letterSpacing;
			}
		}

		return { text, width: advance, ascent, descent, inkLeft: -minX, inkRight: maxX };
	}

	wrapTextLines(ctx, sourceLines, boxWidth, letterSpacing, fontSize) {
		const wrappedLines = [];

		sourceLines.forEach((sourceLine) => {
			if (sourceLine === '') {
				wrappedLines.push(this.measureLine(ctx, '', letterSpacing, fontSize));
				return;
			}

			const tokens = sourceLine.split(/(\s+)/);
			let current = '';

			const pushMeasured = (value) => {
				wrappedLines.push(this.measureLine(ctx, value, letterSpacing, fontSize));
			};

			for (const token of tokens) {
				if (token === '') continue;

				const candidate = current + token;
				if (!current || this.measureLine(ctx, candidate, letterSpacing, fontSize).width <= boxWidth) {
					current = candidate;
					continue;
				}

				if (/^\s+$/.test(token)) {
					pushMeasured(current.trimEnd());
					current = '';
					continue;
				}

				if (current.trim().length > 0) {
					pushMeasured(current.trimEnd());
					current = '';
				}

				let remaining = token;
				while (remaining) {
					let slice = '';
					let consumed = 0;
					for (let index = 0; index < remaining.length; index++) {
						const next = slice + remaining[index];
						const width = this.measureLine(ctx, next, letterSpacing, fontSize).width;
						if (slice && width > boxWidth) {
							break;
						}
						slice = next;
						consumed = index + 1;
						if (width > boxWidth) {
							break;
						}
					}

					if (!slice) {
						slice = remaining[0];
						consumed = 1;
					}

					const rest = remaining.slice(consumed);
					if (rest) {
						pushMeasured(slice);
						remaining = rest;
					} else {
						current = slice;
						remaining = '';
					}
				}
			}

			if (current || wrappedLines.length === 0) {
				pushMeasured(current.trimEnd());
			}
		});

		return { lines: wrappedLines };
	}

	drawLine(ctx, text, options) {
		const { startX, baselineY, letterSpacing } = options;

		if (!letterSpacing) {
			ctx.fillText(text, startX, baselineY);
			return;
		}

		let x = startX;
		for (let index = 0; index < text.length; index++) {
			const char = text[index];
			ctx.fillText(char, x, baselineY);
			x += ctx.measureText(char).width;
			if (index < text.length - 1) {
				x += letterSpacing;
			}
		}
	}

	// Every slot mask for export, in text-local space: the canvases the
	// preview masks with, with the shadow offset baked in (preview translates
	// the unshifted mask instead).
	async renderSlotMasks(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER) {
			throw new Error('Invalid text layer');
		}

		await FontLibrary.ensureLoaded(layer.textData.fontId);
		const measurement = this.getMeasurementEntry(layer);
		const masks = {
			fill: measurement.canvas,
			renderWidth: layer.textData.width,
			renderHeight: layer.textData.height
		};
		getLayerPaintSlots(layer).forEach((entry) => {
			if (!entry.renders || entry.key === 'fill') return;
			masks[entry.key] = entry.role === 'shadow'
				? createOffsetMaskCanvas(measurement.canvas, entry.data.offsetX || 0, entry.data.offsetY || 0)
				: this.getSlotMask(layer, measurement, entry)?.canvas || null;
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

		if (!layer.textData.text.trim()) {
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
				if (layer._pendingPointAnchorTarget && measurement.boxMode === 'auto') {
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
				this.editor.layerManager.updateSelectionHighlight(this.editor.layerManager.activeLayerId);
			})
			.catch((error) => {
				wrapper.style.visibility = 'hidden';
				this.reportFontLoadError(error);
			});
	}

	reconcileTextSpans(stack, layer, measurement) {
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
	}

	// The stack is a local-space surface sized to the mask canvas in text-local
	// pixels and scaled by CSS transform, matching export's rendered canvas.
	syncStackGeometry(stack, layer, measurement = null) {
		if (!stack || !layer?.textData) return;

		const entry = measurement || this.getMeasurementEntry(layer);
		const scaleX = (layer.transform.scale.x || 100) / 100;
		const scaleY = (layer.transform.scale.y || 100) / 100;

		stack.style.width = `${entry.width}px`;
		stack.style.height = `${entry.height}px`;
		stack.style.transform = `scale(${scaleX}, ${scaleY})`;
		stack.style.setProperty('--layer-scale', String(Math.max(scaleX, scaleY) || 1));

		const rect = entry.frameRect;
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
		const measurement = this.getMeasurementEntry(layer);
		this.syncStackGeometry(stack, layer, measurement);
		syncSlotStackTextureOrigins(stack, this.getSlotStack(layer), layer, (item) => this.getSlotMask(layer, measurement, item)?.canvas);
	}

	getSlotStack(layer) {
		return buildSlotStack(layer, (entry) => resolvePaintSlotPreviewSource(this.editor, layer, entry));
	}

	// The mask a slot paints through, in text-local space. The fill and shadow
	// share the glyph mask (the shadow is offset by the caller); the text
	// background exists only once its geometry has shapes. bucket and cacheKey
	// address the per-layer preview mask URL cache.
	getSlotMask(layer, measurement, slot) {
		if (slot.key === 'backgroundFill') {
			const canvas = measurement.textBackgroundGeometry?.shapes?.length
				? this.getTextBackgroundMaskCanvas(layer, measurement)
				: null;
			return canvas ? { canvas, bucket: 'background', cacheKey: measurement.key } : null;
		}
		if (slot.key === 'border') {
			const { canvas, cacheKey } = this.getBorderMaskCanvas(layer, measurement, slot.data);
			return { canvas, bucket: 'border', cacheKey };
		}
		return { canvas: measurement.canvas, bucket: 'fill', cacheKey: measurement.key };
	}

	// One continuous stroke, like a Photoshop stroke: the glyph mask grown,
	// shrunk or both by the border width (mask-geometry.js), textured once.
	// Preview and export both read it through getSlotMask.
	getBorderMaskCanvas(layer, measurement, borderData = this.getEffectData(layer, 'border')) {
		const widthPx = Math.max(0, borderData?.widthPx || 0);
		const placement = getBorderPlacement(borderData);
		const edgeStyle = getBorderEdgeStyle(borderData);
		const cacheKey = `border:${widthPx}:${placement}:${edgeStyle}`;

		if (measurement._borderMaskCache?.key === cacheKey) {
			return { canvas: measurement._borderMaskCache.canvas, cacheKey: `${measurement.key}|${cacheKey}` };
		}

		const fillMask = measurement.canvas;
		let canvas = null;

		if (widthPx > 0) {
			if (placement === 'inside') {
				canvas = createMaskDifferenceCanvas(
					fillMask,
					createErodedMaskCanvas(fillMask, widthPx, edgeStyle)
				);
			} else if (placement === 'center') {
				canvas = createMaskDifferenceCanvas(
					createDilatedMaskCanvas(fillMask, Math.ceil(widthPx / 2), edgeStyle),
					createErodedMaskCanvas(fillMask, Math.floor(widthPx / 2), edgeStyle)
				);
			} else {
				canvas = createMaskDifferenceCanvas(
					createDilatedMaskCanvas(fillMask, widthPx, edgeStyle),
					fillMask
				);
			}
		}

		if (canvas) {
			canvas._textureOrigin = { ...fillMask._textureOrigin };
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
		canvas._textureOrigin = { ...measurement.canvas._textureOrigin };
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.fillStyle = '#ffffff';
		renderTextBackgroundGeometry(ctx, geometry);

		if (shouldUseCrispMaskEdges()) {
			binarizeCanvasAlpha(ctx, canvas.width, canvas.height);
		}

		measurement._backgroundMaskCache = { key: measurement.key, canvas };
		return canvas;
	}

	getEffectPaintSource(layer, key) {
		const entry = getLayerPaintSlots(layer).find((slot) => slot.key === key);
		return entry ? resolvePaintSlotPreviewSource(this.editor, layer, entry) : null;
	}

	updateLiveTextContent(layerId, text) {
		const wrapper = this.layerElements.get(layerId);
		if (!wrapper) return;

		wrapper.setAttribute('aria-label', text);
	}

	async refreshLayer(layer, options = {}) {
		const {
			saveHistory = false,
			refreshLayerList = true,
			refreshPreview = true,
			preservePointAnchorFrom = null
		} = options;

		await FontLibrary.ensureLoaded(layer.textData.fontId);
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
			this.editor.saveState('Edit text');
		}
	}

	canResizeBoxEdges(layer) {
		return Boolean(layer?.type === LayerType.TEXT_GLITTER && layer.textData?.boxMode === 'fixed');
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
		const boxHeight = Math.max(minBoxSize, Math.round(dragState.boxHeight || layer.textData.boxHeight || minBoxSize));
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
		const newCenterLocalY = (rect.top + rect.bottom) / 2;

		layer.textData.boxMode = 'fixed';
		layer.textData.boxWidth = nextBoxWidth;
		layer.textData.boxHeight = nextBoxHeight;
		const measurement = this.getMeasurementEntry(layer);
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

		const metrics = this.getBoxResizeMetrics(layer, dragState);
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
		if (!dragState.textBoxSnapEdges) {
			const measurement = this.getMeasurementEntry(layer);
			const ink = measurement.textInkRect;
			const box = measurement.boxRect;
			dragState.textBoxSnapEdges = ink && box ? {
				left: (ink.x - box.x - box.width / 2) * metrics.scaleX,
				right: (ink.x + ink.width - box.x - box.width / 2) * metrics.scaleX,
				top: (ink.y - box.y - box.height / 2) * metrics.scaleY,
				bottom: (ink.y + ink.height - box.y - box.height / 2) * metrics.scaleY
			} : {};
		}
		const threshold = CONFIG.snapping.threshold / Math.max(0.01, this.editor.viewport.currentZoom);
		const snap = (value, target) => (
			PREFERENCES.get('snappingEnabled') &&
			!options.ctrlKey &&
			Number.isFinite(target) &&
			Math.abs(value - target) <= threshold
				? target
				: value
		);
		const inkEdges = dragState.textBoxSnapEdges;

		if (edge === 'right') {
			rect.right = Math.max(snap(localX, inkEdges?.right), rect.left + metrics.minDisplayWidth);
		} else if (edge === 'left') {
			rect.left = Math.min(snap(localX, inkEdges?.left), rect.right - metrics.minDisplayWidth);
		} else if (edge === 'bottom') {
			rect.bottom = Math.max(snap(localY, inkEdges?.bottom), rect.top + metrics.minDisplayHeight);
		} else if (edge === 'top') {
			rect.top = Math.min(snap(localY, inkEdges?.top), rect.bottom - metrics.minDisplayHeight);
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

	async commitScaleToFontSize(layer) {
		if (!layer || layer.type !== LayerType.TEXT_GLITTER) return;

		const transform = getLayerTransform(layer);
		const scaleX = Math.max(0.01, (transform.scale.x || 100) / 100);
		const scaleY = Math.max(0.01, (transform.scale.y || 100) / 100);
		const scaleFactor = Math.min(scaleX, scaleY);
		if (Math.abs(scaleFactor - 1) < 1e-3 && Math.abs(scaleY - 1) < 1e-3) {
			transform.scale.x = 100;
			transform.scale.y = 100;
			transform.proportionalScale = true;
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
		layer.textData.letterSpacing *= bakedFactor;
		if ((layer.textData.boxMode || 'auto') === 'fixed') {
			layer.textData.boxWidth *= bakedFactor;
			layer.textData.boxHeight *= bakedFactor;
		}
		if (layer.textData.border && PREFERENCES.get('scaleEffects')) {
			layer.textData.border.widthPx *= bakedFactor;
		}
		if (layer.textData.shadow && PREFERENCES.get('scaleEffects')) {
			layer.textData.shadow.offsetX *= bakedFactor;
			layer.textData.shadow.offsetY *= bakedFactor;
		}
		if (PREFERENCES.get('scaleTextures')) {
			layer.textData.fill.scale = roundSlotTextureScale(layer.textData.fill.scale * bakedFactor);
			if (layer.textData.border) {
				layer.textData.border.scale = roundSlotTextureScale((layer.textData.border.scale ?? 100) * bakedFactor);
			}
			if (layer.textData.shadow) {
				layer.textData.shadow.scale = roundSlotTextureScale((layer.textData.shadow.scale ?? 100) * bakedFactor);
			}
		}
		transform.scale.x = (scaleX / bakedFactor) * 100;
		transform.scale.y = (scaleY / bakedFactor) * 100;
		transform.proportionalScale = true;

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

	createTransformHandles(layerId) {
		movableCreateTransformHandles(this, layerId);
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

	centerHorizontal(layerId) {
		movableCenterHorizontal(this, layerId, (layer) => this.loadLayerSettings(layer));
	}

	centerVertical(layerId) {
		movableCenterVertical(this, layerId, (layer) => this.loadLayerSettings(layer));
	}

	alignToCanvas(layerId, mode) {
		movableAlignToCanvas(this, layerId, mode, (layer) => this.loadLayerSettings(layer));
	}

	resetTransform(layerId) {
		movableResetTransform(this, layerId, (layer) => this.loadLayerSettings(layer));
	}

	removeTransformHandles() {
		movableRemoveTransformHandles(this);
	}

	removeLayerElement(layerId) {
		this.previewMaskUrls.delete(layerId);

		const element = this.layerElements.get(layerId);
		if (element?.parentNode) {
			element.parentNode.removeChild(element);
		}

		const transform = this.layerTransforms.get(layerId);
		if (transform) {
			transform.destroy();
			this.layerTransforms.delete(layerId);
		}

		this.layerElements.delete(layerId);
	}

	clearElements() {
		// New document / image reset: no layer survives, so any armed picker
		// session is stale.
		this.closePickerSession();
		Array.from(this.layerElements.keys()).forEach((layerId) => {
			this.removeLayerElement(layerId);
		});
	}

	clearPreviewMaskUrls() {
		this.previewMaskUrls.clear();
	}

	// Each mask "slot" (fill, border, ...) gets its own cached data URL — border
	// needs a different rasterized shape than fill, so they can't share one.
	// Synchronous (toDataURL, not toBlob+Image) so a live box-resize drag never
	// shows a stale mask stretched to the new box size while a blob decodes.
	getPreviewMaskDataUrl(layer, maskType, canvas, cacheKey) {
		let bucket = this.previewMaskUrls.get(layer.id);
		if (!bucket) {
			bucket = {};
			this.previewMaskUrls.set(layer.id, bucket);
		}
		const cached = bucket[maskType];

		if (cached?.key === cacheKey) {
			return cached.url;
		}

		const url = canvas.toDataURL('image/png');
		bucket[maskType] = { key: cacheKey, url };
		return url;
	}
}
