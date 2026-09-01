// Small deterministic PRNG (mulberry32) — seeds scatter/jitter per stroke so a
// live re-render or an undo/redo reproduces the same spray.
function maskMulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0; a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const maskClamp = (value, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(value) ? value : lo));

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
		this.strokeModeOverride = null;
		this.lastPoint = null;
		this.stampCarry = 0;
		this.smoothedPoint = null;
		// WP2 straight lines: strokeOrigin anchors axis-lock; axisLockDir is the
		// unit direction once the shift-drag has moved far enough to pick one;
		// lastStrokeEndPoint (with its layerId) is where a shift-click connects from.
		this.strokeOrigin = null;
		this.axisLockDir = null;
		this.lastStrokeEndPoint = null;
		this.scratchAddCanvas = null;
		this.scratchSubCanvas = null;
		this.livePreviewQueued = false;
		this.liveOverlayQueued = false;
		this.cursorVisible = false;
		this.touchRingTimeout = null;
		this.stampCacheKey = '';
		this.stampCanvas = null;
		// WP1: Brush and Eraser keep independent setting sets. This store is the
		// source of truth (the DOM panel is a view that setMode writes into); all
		// getBrush*() getters read the ACTIVE mode's entry (getActiveMode(), so a
		// pen-eraser override uses eraser settings). Seeded from CONFIG, then
		// merged with any localStorage-persisted values.
		this.toolSettings = this._loadToolSettings();
		// Scatter / jitter / tip-orientation overrides, keyed by BRUSH id (not by
		// paint mode — a scatter setting means the same thing painting or erasing).
		// Empty entry => fall back to BrushLibrary.defaultDynamics(id). WP-raster.
		this.brushDynamics = this._loadBrushDynamics();
		// Per-stroke seeded PRNG so scatter is stable across live re-renders and
		// reproducible on undo/redo. Seeded in _startStrokeFromScreenPoint.
		this._strokeRng = null;
		// Travel direction of the last painted segment, so a single click-stamp
		// still has an axis to scatter across.
		this._lastDirX = 1;
		this._lastDirY = 0;
		this.overlayPatternCache = new Map();
		this.ui = {
			overlayToggle: document.getElementById('maskOverlayToggle'),
			clearButton: document.getElementById('clearMaskPaint'),
			copySettingsButton: document.getElementById('maskCopyOppositeSettings'),
			resetSettingsButton: document.getElementById('maskResetCurrentSettings'),
			pressureToggle: document.getElementById('maskBrushPressure'),
			overlayCanvas: document.getElementById('maskOverlayCanvas'),
			cursor: document.getElementById('maskBrushCursor'),
			cursorShape: document.getElementById('maskBrushCursorShape'),
			dynamicsHost: document.getElementById('brushDynamicsHost'),
			tipThumbnail: document.getElementById('brushTipThumbnail'),
			tipName: document.getElementById('brushTipName'),
			tipBadges: document.getElementById('brushTipBadges'),
			tipChange: document.getElementById('brushTipChange')
		};
		// Last brush-shape id painted into the cursor's outline SVG, so
		// _syncCursorAppearance only rebuilds the markup when the tip changes.
		this._cursorShapeId = null;

		this.overlayCtx = this.ui.overlayCanvas?.getContext('2d', { willReadFrequently: true }) || null;

		this._setupPointerListeners();
	}

	setupUIListeners() {
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
				title: 'Clear Paint',
				message: 'All painted strokes on this layer will be removed. Color selections will stay in place.',
				confirmLabel: 'Clear Paint'
			});
			if (!confirmed) {
				return;
			}

			this.editor.glitterManager.clearPaintForLayer(layer);
			this.editor.requestPreviewUpdate();
			this.editor.layerManager.renderLayersList();
			this.editor.updateActionButtons();
			this.editor.updateHelpfulMessage();
			this.editor.saveState('Paint mask');
			this.loadLayer(layer);
			this.renderOverlay();
		});

		this.ui.copySettingsButton?.addEventListener('click', () => {
			const targetMode = this.mode;
			const sourceMode = targetMode === 'add' ? 'sub' : 'add';
			const sourceLabel = sourceMode === 'sub' ? 'eraser' : 'brush';
			this.copySettingsBetweenModes(sourceMode, targetMode);
			this.editor.updateStatus(`Copied ${sourceLabel} settings into this ${targetMode === 'sub' ? 'eraser' : 'brush'}`);
		});

		this.ui.resetSettingsButton?.addEventListener('click', () => {
			const label = this.mode === 'sub' ? 'Eraser' : 'Brush';
			this.resetToolModeToDefaults(this.mode);
			this.editor.updateStatus(`${label} settings reset`);
		});

		[this.ui.tipThumbnail, this.ui.tipChange].forEach((control) => {
			control?.addEventListener('click', () => this.editor.brushTipManager?.openPicker());
		});
		this.renderDynamicsPanel();

		this._bindSettingInputs();
		// Seed the one DOM panel from the active mode's stored settings.
		this._applySettingsToDOM(this.mode);
		this._updatePanelTitle();

		this.loadLayer(this.editor.layerManager.getActiveLayer());
	}

	// ===== PER-MODE SETTINGS STORE (WP1) =====

	_defaultToolSettings() {
		const mb = CONFIG.tools.maskBrush;
		const base = {
			size: mb.defaults.size,
			softness: mb.defaults.softness,
			flow: mb.defaults.flow,
			spacing: Math.round(mb.stroke.stampSpacing * 100),
			smoothing: mb.defaults.smoothing ?? 0,
			shape: mb.defaults.shape || 'round',
			pressure: true
		};
		// Eraser inherits the shared defaults, overriding only the listed keys.
		const sub = Object.assign({}, base, mb.eraserDefaults || {});
		return { add: Object.assign({}, base), sub };
	}

	// Only accept known keys with the right primitive types, so a corrupted or
	// stale localStorage payload can never inject junk into the store.
	_sanitizeSettings(raw, fallback) {
		const out = Object.assign({}, fallback);
		if (raw && typeof raw === 'object') {
			['size', 'softness', 'flow', 'spacing', 'smoothing'].forEach((key) => {
				if (Number.isFinite(raw[key])) out[key] = raw[key];
			});
			if (typeof raw.shape === 'string' && MaskEditor.isKnownBrushShape(raw.shape)) {
				out.shape = raw.shape;
			}
			if (typeof raw.pressure === 'boolean') out.pressure = raw.pressure;
		}
		return out;
	}

	_loadToolSettings() {
		const defaults = this._defaultToolSettings();
		try {
			const raw = localStorage.getItem(MaskEditor.SETTINGS_STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				return {
					add: this._sanitizeSettings(parsed?.add, defaults.add),
					sub: this._sanitizeSettings(parsed?.sub, defaults.sub)
				};
			}
		} catch (error) {
			// Ignore quota/JSON errors — defaults are a fine fallback.
		}
		return defaults;
	}

	_saveToolSettings() {
		try {
			localStorage.setItem(MaskEditor.SETTINGS_STORAGE_KEY, JSON.stringify(this.toolSettings));
		} catch (error) {
			// Non-fatal: settings just won't persist this session.
		}
	}

	resetToolSettingsToDefaults() {
		this.toolSettings = this._defaultToolSettings();
		this._saveToolSettings();
		this._applySettingsToDOM(this.mode);
		this._updateBrushCursorSize();
		this.renderOverlay();
	}

	resetToolModeToDefaults(mode = this.mode) {
		if (mode !== 'add' && mode !== 'sub') return;
		this.toolSettings[mode] = { ...this._defaultToolSettings()[mode] };
		this._saveToolSettings();
		if (mode === this.mode) this._applySettingsToDOM(mode);
		this._updateBrushCursorSize();
		this.renderOverlay();
	}

	// Attach store-writing listeners on top of app.js's display listeners. Slider
	// input writes into the CURRENTLY-SELECTED mode (this.mode, not
	// getActiveMode) — the panel edits the toolbar tool, never a transient
	// pen-eraser override. Persist on `change` (drag end), not every input frame.
	_bindSettingInputs() {
		const sliders = [
			['maskBrushSize', 'size'],
			['maskBrushSoftness', 'softness'],
			['maskBrushFlow', 'flow'],
			['maskBrushSpacing', 'spacing'],
			['maskBrushSmoothing', 'smoothing']
		];

		sliders.forEach(([id, key]) => {
			const el = document.getElementById(id);
			if (!el) return;
			el.addEventListener('input', () => {
				const value = parseInt(el.value, 10);
				if (Number.isFinite(value)) {
					this.toolSettings[this.mode][key] = value;
					// A raster tip remembers its own size (Photoshop presets do),
					// so switching brushes doesn't clobber it.
					if (key === 'size' && MaskEditor.isRasterBrush(this.getBrushShape())) {
						this._setBrushDynamicRaw('size', value);
					}
				}
			});
			el.addEventListener('change', () => { this._saveToolSettings(); this._saveBrushDynamics(); });
		});

		const pressure = document.getElementById('maskBrushPressure');
		pressure?.addEventListener('change', () => {
			this.toolSettings[this.mode].pressure = pressure.checked;
			this._saveToolSettings();
		});
	}

	// Push a mode's stored values out to the shared DOM panel. Dispatching 'input'
	// reuses app.js's value-display / reset-button / quick-slider sync for free
	// (and re-writes the same value into the store — idempotent).
	_applySettingsToDOM(mode) {
		const s = this.toolSettings[mode];
		const setSlider = (id, value) => {
			const el = document.getElementById(id);
			if (!el) return;
			el.value = String(value);
			el.dispatchEvent(new Event('input'));
		};

		setSlider('maskBrushSize', s.size);
		setSlider('maskBrushSoftness', s.softness);
		setSlider('maskBrushFlow', s.flow);
		setSlider('maskBrushSpacing', s.spacing);
		setSlider('maskBrushSmoothing', s.smoothing);

		const pressure = document.getElementById('maskBrushPressure');
		if (pressure) pressure.checked = s.pressure;

		this._applyShapeToPicker(s.shape);
		this._syncCursorAppearance();
		this._syncDynamicsPanel();
		// The stamp cache key embeds the shape/size/softness, so switching modes
		// must invalidate the cached stamp.
		this.stampCacheKey = '';
	}

	_applyShapeToPicker(shape) {
		const preview = this.ui.tipThumbnail;
		if (!preview) return;
		const raster = MaskEditor.isRasterBrush(shape);
		const label = raster ? BrushLibrary.get(shape)?.label : MaskEditor.BRUSH_SHAPES.find((entry) => entry.id === shape)?.label;
		preview.classList.toggle('is-raster', raster);
		preview.classList.toggle('is-vector', !raster);
		preview.replaceChildren();
		if (raster) preview.innerHTML = BrushLibrary.getCursorMarkup(shape);
		else preview.innerHTML = ShapeLibrary.getIconSvg(shape);
		if (this.ui.tipName) this.ui.tipName.textContent = label || shape;
		if (this.ui.tipBadges) {
			this.ui.tipBadges.replaceChildren(this._assetBadge(raster ? BrushLibrary.packById(BrushLibrary.get(shape).packId)?.label : 'Basic'));
		}
		this.editor.brushTipManager?.updateSelection();
	}

	_assetBadge(label) {
		const badge = document.createElement('span');
		badge.className = 'asset-info-badge badge-category';
		badge.textContent = label || '';
		return badge;
	}

	// Keep the shared Mask Settings title stable and swap its header icon to show
	// the active paint mode (Brush ↔ Eraser). Mobile relocates the same section.
	_updatePanelTitle() {
		const isEraser = this.mode === 'sub';
		const titleText = document.getElementById('brushSettingsTitleText');
		if (titleText) titleText.textContent = 'Mask Settings';
		const titleIcon = document.getElementById('brushSettingsTitleIcon');
		if (titleIcon) titleIcon.setAttribute('href', isEraser ? '#icon-eraser' : '#icon-brush');
		if (this.ui.copySettingsButton) {
			this.ui.copySettingsButton.textContent = isEraser ? 'Copy Brush Settings' : 'Copy Eraser Settings';
			this.ui.copySettingsButton.title = isEraser
				? 'Copy the current brush settings into the eraser'
				: 'Copy the current eraser settings into the brush';
		}
		if (this.ui.resetSettingsButton) {
			this.ui.resetSettingsButton.textContent = isEraser ? 'Reset Eraser' : 'Reset Brush';
			this.ui.resetSettingsButton.title = `Restore ${isEraser ? 'eraser' : 'brush'} settings to their defaults`;
		}
	}

	copySettingsBetweenModes(sourceMode, targetMode) {
		if (!this.toolSettings[sourceMode] || !this.toolSettings[targetMode]) {
			return;
		}

		this.toolSettings[targetMode] = {
			...this.toolSettings[sourceMode]
		};
		this._applySettingsToDOM(targetMode);
		this._saveToolSettings();
		this._updateBrushCursorSize();
	}

	getBrushShape() {
		return this.toolSettings[this.getActiveMode()].shape || 'round';
	}

	setBrushShape(shape) {
		if (!MaskEditor.isKnownBrushShape(shape)) return;
		const settings = this.toolSettings[this.mode];
		if (settings.shape === shape) return;
		const prevShape = settings.shape;
		settings.shape = shape;
		// The stamp cache key includes the shape, so the next stamp regenerates;
		// clear it eagerly so nothing reuses the previous shape mid-session.
		this.stampCacheKey = '';
		// Size follows the brush (Photoshop presets do): a raster tip picks up the
		// size you last gave it, else its native tip diameter. Leaving a raster tip
		// stashes the current size against it and restores the shared/vector size.
		if (MaskEditor.isRasterBrush(prevShape) && prevShape !== shape) {
			this._setBrushDynamicRaw('size', settings.size, prevShape);
			this._saveBrushDynamics();
		}
		if (MaskEditor.isRasterBrush(shape)) {
			const lim = CONFIG.tools.maskBrush.limits;
			const native = BrushLibrary.get(shape)?.dynamics.diameter || 128;
			settings.size = Math.round(maskClamp(this.brushDynamics[shape]?.size ?? native, lim.minSize, lim.maxSize));
		}
		this._applyShapeToPicker(shape);
		this._syncCursorAppearance();
		this._saveToolSettings();
		this._applySettingsToDOM(this.mode);
		this._syncDynamicsPanel();
		this._updateBrushCursorSize();
	}

	// ===== PER-BRUSH DYNAMICS STORE (scatter / jitter / tip orientation) =====
	// Stored in PANEL units (scatter %, roundness %, jitter %) keyed by brush id,
	// holding only the keys the user changed. getBrushDynamics() resolves the
	// manifest default underneath and converts to engine units for the stamp loop.

	_loadBrushDynamics() {
		try {
			const raw = localStorage.getItem(MaskEditor.DYNAMICS_STORAGE_KEY);
			const parsed = raw ? JSON.parse(raw) : null;
			if (parsed && typeof parsed === 'object') return parsed;
		} catch (error) {
			// Corrupt payload — start clean.
		}
		return {};
	}

	_saveBrushDynamics() {
		try {
			localStorage.setItem(MaskEditor.DYNAMICS_STORAGE_KEY, JSON.stringify(this.brushDynamics));
		} catch (error) {
			// Non-fatal: overrides just won't persist this session.
		}
	}

	// The brush's manifest defaults, in PANEL units, before user overrides.
	_dynamicsManifestModel(shape = this.getBrushShape()) {
		const base = (typeof BrushLibrary !== 'undefined')
			? BrushLibrary.defaultDynamics(shape)
			: { ...CONFIG.tools.maskBrush.dynamics.defaults, scatter: 0, roundness: 1, countJitter: 0, sizeJitter: 0, angleJitter: 0, count: 1, angle: 0, flipX: false, flipY: false, bothAxes: true };
		return {
			scatter: Math.round((base.scatter || 0) * 100),
			count: base.count || 1,
			countJitter: Math.round((base.countJitter || 0) * 100),
			sizeJitter: Math.round((base.sizeJitter || 0) * 100),
			angleJitter: Math.round((base.angleJitter || 0) * 100),
			angle: base.angle || 0,
			roundness: Math.round((base.roundness ?? 1) * 100),
			flipX: base.flipX === true,
			flipY: base.flipY === true,
			bothAxes: base.bothAxes !== false,
			smoothing: base.smoothing !== false
		};
	}

	// Manifest defaults + this brush's stored overrides, still in PANEL units.
	_dynamicsPanelModel(shape = this.getBrushShape()) {
		return Object.assign(this._dynamicsManifestModel(shape), this.brushDynamics[shape] || {});
	}

	// Engine units for the stamp loop: scatter/jitter as 0..1 fractions, angle in
	// degrees, roundness 0..1, count an int.
	getBrushDynamics() {
		const m = this._dynamicsPanelModel();
		const limits = CONFIG.tools.maskBrush.dynamics.limits;
		return {
			scatter: maskClamp(m.scatter, 0, limits.scatterMax) / 100,
			count: Math.round(maskClamp(m.count, 1, limits.countMax)),
			countJitter: maskClamp(m.countJitter, 0, 100) / 100,
			sizeJitter: maskClamp(m.sizeJitter, 0, 100) / 100,
			angleJitter: maskClamp(m.angleJitter, 0, 100) / 100,
			angle: maskClamp(m.angle, -360, 360),
			roundness: maskClamp(m.roundness, 5, 100) / 100,
			flipX: m.flipX === true,
			flipY: m.flipY === true,
			bothAxes: m.bothAxes !== false,
			smoothing: m.smoothing !== false
		};
	}

	// True when the active brush would stamp exactly like the pre-dynamics engine
	// (one upright dab, no scatter/jitter) AND the tip is vector — lets the plain
	// fast path keep running for the common case and existing edge tests.
	_dynamicsAreNeutral() {
		if (MaskEditor.isRasterBrush(this.getBrushShape())) return false;
		const d = this.getBrushDynamics();
		return d.count === 1 && d.scatter === 0 && d.sizeJitter === 0 &&
			d.angleJitter === 0 && d.angle === 0 && d.roundness === 1 &&
			!d.flipX && !d.flipY;
	}

	setBrushDynamic(key, value) {
		const shape = this.getBrushShape();
		const manifest = this._dynamicsManifestModel(shape);
		if (!(key in manifest)) return;
		const store = this.brushDynamics[shape] || (this.brushDynamics[shape] = {});
		const next = (typeof manifest[key] === 'boolean') ? Boolean(value) : Number(value);
		if (next === manifest[key]) delete store[key];       // back at default — don't persist
		else store[key] = next;
		if (!Object.keys(store).length) delete this.brushDynamics[shape];
		this._saveBrushDynamics();
	}

	// Write a raw per-brush value (e.g. remembered `size`) that isn't part of the
	// Scatter & Jitter manifest model, so setBrushDynamic's "drop if default"
	// logic doesn't apply. Saved by the caller.
	_setBrushDynamicRaw(key, value, shape = this.getBrushShape()) {
		if (!MaskEditor.isRasterBrush(shape)) return;
		(this.brushDynamics[shape] || (this.brushDynamics[shape] = {}))[key] = value;
	}

	// Builds the Scatter & Jitter rows into #brushDynamicsHost once; _syncDynamicsPanel
	// keeps their values and raster-only visibility current.
	renderDynamicsPanel() {
		const host = this.ui.dynamicsHost;
		if (!host) return;
		host.innerHTML = '';

		const buildRow = (spec) => {
			const row = document.createElement('div');
			row.className = 'property-row brush-dynamic-row';
			row.dataset.dynamic = spec.key;
			if (spec.rasterOnly) row.dataset.rasterOnly = '';
			row.innerHTML =
				`<span class="property-label" title="${spec.hint}">${spec.label}</span>` +
				`<input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step || 1}" data-dynamic-input>` +
				`<span class="property-value" data-dynamic-value></span>` +
				`<button class="property-revert" type="button" title="Reset to default" aria-label="Reset to default" data-dynamic-reset>` +
					`<svg class="icon"><use href="#icon-undo"></use></svg></button>`;
			return row;
		};
		const specs = new Map(MaskEditor.DYNAMICS_SLIDERS.map((spec) => [spec.key, spec]));
		[['scatter', 'count'], ['countJitter', 'sizeJitter'], ['angle', 'angleJitter']].forEach((keys) => {
			const pair = document.createElement('div');
			pair.className = 'property-pair-group brush-dynamic-pair';
			keys.forEach((key) => pair.appendChild(buildRow(specs.get(key))));
			host.appendChild(pair);
		});
		host.appendChild(buildRow(specs.get('roundness')));

		const flips = document.createElement('div');
		flips.className = 'brush-dynamic-toggles';
		MaskEditor.DYNAMICS_TOGGLES.forEach((spec) => {
			const label = document.createElement('label');
			// R4: a boolean setting is a toggle row, the same as every other
			// boolean in the panel - not a full-width pill.
			label.className = 'property-row is-toggle';
			if (spec.rasterOnly) label.dataset.rasterOnly = '';
			label.innerHTML = `<span class="property-label" title="${spec.hint}">${spec.label}</span>`
				+ `<input type="checkbox" data-dynamic-toggle="${spec.key}">`
				+ `<span class="property-switch" aria-hidden="true"></span>`;
			flips.appendChild(label);
		});
		host.appendChild(flips);

		host.addEventListener('input', (event) => {
			const slider = event.target.closest('[data-dynamic-input]');
			if (slider) {
				this.setBrushDynamic(slider.closest('[data-dynamic]').dataset.dynamic, slider.value);
				this._syncDynamicsRowValue(slider.closest('[data-dynamic]'));
				return;
			}
			const toggle = event.target.closest('[data-dynamic-toggle]');
			if (toggle) this.setBrushDynamic(toggle.dataset.dynamicToggle, toggle.checked);
		});
		host.addEventListener('click', (event) => {
			if (event.target.closest('[data-dynamic-reset]')) {
				const row = event.target.closest('[data-dynamic]');
				const store = this.brushDynamics[this.getBrushShape()];
				if (store) { delete store[row.dataset.dynamic]; if (!Object.keys(store).length) delete this.brushDynamics[this.getBrushShape()]; }
				this._saveBrushDynamics();
				this._syncDynamicsPanel();
			}
		});

		this._syncDynamicsPanel();
	}

	_syncDynamicsRowValue(row) {
		const spec = MaskEditor.DYNAMICS_SLIDERS.find((entry) => entry.key === row.dataset.dynamic);
		const input = row.querySelector('[data-dynamic-input]');
		const out = row.querySelector('[data-dynamic-value]');
		if (spec && out) out.innerHTML = formatUnit(input.value, spec.unit);
		const manifest = this._dynamicsManifestModel();
		const isDefault = Number(input.value) === manifest[row.dataset.dynamic];
		row.classList.toggle('is-overridden', !isDefault);
		// Rule D: the revert is inert (and therefore invisible) at the default.
		const revert = row.querySelector('[data-dynamic-reset]');
		if (revert) revert.disabled = isDefault;
	}

	_syncDynamicsPanel() {
		const host = this.ui.dynamicsHost;
		if (!host) return;
		const model = this._dynamicsPanelModel();
		const isRaster = MaskEditor.isRasterBrush(this.getBrushShape());

		host.querySelectorAll('[data-dynamic]').forEach((row) => {
			const key = row.dataset.dynamic;
			const input = row.querySelector('[data-dynamic-input]');
			input.value = String(model[key]);
			this._syncDynamicsRowValue(row);
			if ('rasterOnly' in row.dataset) row.hidden = !isRaster;
		});
		host.querySelectorAll('.brush-dynamic-pair').forEach((pair) => {
			pair.hidden = Array.from(pair.querySelectorAll('[data-dynamic]')).every((row) => row.hidden);
		});
		host.querySelectorAll('[data-dynamic-toggle]').forEach((toggle) => {
			toggle.checked = Boolean(model[toggle.dataset.dynamicToggle]);
			const label = toggle.closest('label');
			if (label && 'rasterOnly' in label.dataset) label.hidden = !isRaster;
		});
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

			// Switching layers ends the current line context — a Shift-click on the
			// new layer should start fresh, not connect to the old layer's stroke.
			this.lastStrokeEndPoint = null;

			// The brush persists across any layer switch (color-picker parity);
			// it targets glitter layers and auto-creates one when painting elsewhere.
			const layer = this.editor.layerManager.getActiveLayer();
			this.currentLayerId = (layer && layer.type === LayerType.GLITTER_FILL) ? layer.id : null;
			this.renderOverlay();
		}

		this.loadLayer(this.editor.layerManager.getActiveLayer());
	}

	handleStateRestore() {
		// Undo/redo shouldn't kick the user out of the Brush/Eraser tool —
		// exit the live stroke state only, and leave currentTool alone.
		this.exitEditMode({ commitStroke: false, switchTool: false });
		// The mask underneath changed — drop the Shift-click connect anchor so it
		// can't draw from a point that no longer reflects what's on the canvas.
		this.lastStrokeEndPoint = null;
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

		const brushTool = document.getElementById('brushTool');
		if (brushTool) {
			brushTool.disabled = !enabled;
		}
	}

	loadLayer(layer) {
		this.updateToolButtonState();

		if (this.ui.clearButton) {
			this.ui.clearButton.disabled = !layer?.maskHasContent;
		}

		this._syncModeButtons();
		this._updateBrushCursorSize();
		this.renderOverlay();
	}

	setMode(mode) {
		if (mode !== 'add' && mode !== 'sub') {
			return;
		}

		const changed = this.mode !== mode;
		this.mode = mode;
		if (changed) {
			// Swap the shared DOM panel to the newly-active mode's stored values
			// and retitle it (Brush ↔ Eraser).
			this._applySettingsToDOM(mode);
			this._updatePanelTitle();
			this._updateBrushCursorSize();
			this._saveToolSettings();
		}
		this._syncModeButtons();
		this._syncCursorAppearance();
		this.editor.updateHelpfulMessage();
	}

	toggleMode() {
		this.setMode(this.mode === 'add' ? 'sub' : 'add');
	}

	// The mode actually painting right now: the per-stroke pen-eraser override
	// when one is active, otherwise the toolbar-selected mode.
	getActiveMode() {
		return this.strokeModeOverride || this.mode;
	}

	// A pen's eraser end reports pointerdown with button 5 (and bit 32 set in
	// `buttons`) per the Pointer Events spec — NOT button 0, which is why a
	// plain button check ignores it entirely (Wacom Cintiq report). Legacy
	// IE/Edge exposed it as its own pointerType instead.
	_isEraserPointer(event) {
		if (event.pointerType === 'eraser') return true;
		if (event.pointerType !== 'pen') return false;
		return event.button === 5 || (event.buttons & 32) !== 0;
	}

	adjustBrushSize(delta) {
		const slider = document.getElementById('maskBrushSize');
		if (!slider) {
			return false;
		}

		const currentValue = parseInt(slider.value || CONFIG.tools.maskBrush.defaults.size, 10);
		const nextValue = Math.max(
			CONFIG.tools.maskBrush.limits.minSize,
			Math.min(CONFIG.tools.maskBrush.limits.maxSize, currentValue + delta)
		);

		if (nextValue === currentValue) {
			return false;
		}

		slider.value = String(nextValue);
		// 'input' updates the display + store (via _bindSettingInputs); 'change'
		// persists it to localStorage.
		slider.dispatchEvent(new Event('input'));
		slider.dispatchEvent(new Event('change'));
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
		this.overlayCtx.globalAlpha = CONFIG.tools.maskBrush.overlay.opacity;
		this.overlayCtx.drawImage(maskCanvas, 0, 0);
		this.overlayCtx.globalCompositeOperation = 'source-in';
		this.overlayCtx.fillStyle = fillColor;
		this.overlayCtx.fillRect(0, 0, width, height);
		const stripePattern = this._getOverlayStripePattern(stripeColor);
		if (stripePattern) {
			this.overlayCtx.globalCompositeOperation = 'source-atop';
			this.overlayCtx.globalAlpha = Math.min(
				1,
				CONFIG.tools.maskBrush.overlay.opacity + (CONFIG.tools.maskBrush.overlay.stripeOpacityBoost || 0)
			);
			this.overlayCtx.fillStyle = stripePattern;
			this.overlayCtx.fillRect(0, 0, width, height);
		}
		this.overlayCtx.globalCompositeOperation = 'source-over';
		this.overlayCtx.globalAlpha = 1;

		// Erase strokes get a second pass: the mask removed SO FAR this stroke is
		// painted back in a solid contrasting slab, so you can see what you're
		// taking out instead of just watching an edge quietly recede.
		if (this.getActiveMode() === 'sub') {
			const bite = this._getEraseBiteCanvas(layer);
			if (bite) {
				this.overlayCtx.globalAlpha = CONFIG.tools.maskBrush.overlay.eraseBiteOpacity ?? 0.6;
				this.overlayCtx.drawImage(bite, 0, 0);
				this.overlayCtx.globalAlpha = 1;
			}
		}
	}

	// A pre-tinted canvas of the glitter removed so far by the current erase
	// stroke: this stroke's eraser footprint (current sub-mask minus its
	// stroke-start snapshot), clipped to the mask that was painted before the
	// stroke started. Erasing a selection-only mask isn't highlighted here — the
	// composite still visibly recedes. The work canvas is reused between frames.
	_getEraseBiteCanvas(layer) {
		const paint = this.editor.glitterManager.getPaintMask(layer.id);
		if (!paint || !this.scratchSubCanvas || !this.scratchAddCanvas) {
			return null;
		}

		const w = paint.sub.width;
		const h = paint.sub.height;
		if (!this._biteCanvas) {
			this._biteCanvas = document.createElement('canvas');
		}
		const canvas = this._biteCanvas;
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.globalCompositeOperation = 'source-over';
		ctx.clearRect(0, 0, w, h);

		ctx.drawImage(paint.sub, 0, 0);
		ctx.globalCompositeOperation = 'destination-out';
		ctx.drawImage(this.scratchSubCanvas, 0, 0);
		ctx.globalCompositeOperation = 'destination-in';
		ctx.drawImage(this.scratchAddCanvas, 0, 0);

		ctx.globalCompositeOperation = 'source-in';
		ctx.fillStyle = CONFIG.tools.maskBrush.overlay.eraseBiteColor || '#ff3b30';
		ctx.fillRect(0, 0, w, h);
		ctx.globalCompositeOperation = 'source-over';

		return canvas;
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

		const eraserInput = this._isEraserPointer(event);
		if (!this._shouldHandleEvent(event) || (event.button !== 0 && !eraserInput)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		// A pen's eraser end always erases, whatever paint mode the toolbar has
		// selected (Photoshop behavior). The override lasts for this stroke only —
		// _resetStrokeState restores the toolbar-selected mode.
		this.strokeModeOverride = eraserInput ? 'sub' : null;

		const started = this._startStrokeFromScreenPoint(event.clientX, event.clientY, {
			pointerId: event.pointerId,
			pressure: this._getPointerPressure(event.pointerType, event.pressure),
			shiftKey: event.shiftKey
		});
		// A refused stroke (nothing to erase, non-paintable layer) never reaches
		// _resetStrokeState, so clear the pen-eraser override here or it would
		// linger onto the next hover and mislabel the cursor.
		if (!started) {
			this.strokeModeOverride = null;
		}
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

		event.preventDefault();
		event.stopPropagation();

		const layer = this.editor.layerManager.getActiveLayer();
		const paint = layer ? this.editor.glitterManager.getPaintMask(layer.id) : null;
		if (!paint) {
			return;
		}

		// Pens and high-frequency mice report several positions between frames.
		// Painting each coalesced sample keeps a fast stroke continuous instead of
		// faceted; the smoothing anchor advances through every sample in order.
		for (const sample of this._pointerSamples(event)) {
			const point = this._getCanvasPointFromScreen(sample.clientX, sample.clientY);
			if (!point) {
				continue;
			}
			// WebKit can expose Force Touch trackpad values through PointerEvent
			// pressure while still identifying the device as a mouse. Pressure is a
			// brush feature only for actual pen input; a mouse/trackpad must paint at
			// the configured Flow even when Safari reports zero pressure.
			point.pressure = this._getPointerPressure(event.pointerType, sample.pressure);
			const nextPoint = this._resolveStrokePoint(point, event.shiftKey);
			this._stampAlongPath(layer, paint, this.lastPoint, nextPoint);
			this.lastPoint = nextPoint;
		}
	}

	// Coalesced pointer samples when the browser exposes them, else the event
	// itself. Consumers read clientX / clientY / pressure only.
	_pointerSamples(event) {
		const coalesced = event.getCoalescedEvents?.();
		if (coalesced && coalesced.length) {
			return coalesced;
		}
		return [event];
	}

	_getPointerPressure(pointerType, pressure) {
		return pointerType === 'pen' ? pressure : null;
	}

	// Turns a raw pointer sample into the point actually painted this move.
	// With Shift held we axis-lock (project onto the nearest 0/45/90° ray from
	// the stroke origin) and bypass EMA smoothing — the projection already
	// stabilizes the line, and smoothing would bow it. Without Shift we smooth
	// as usual, and clear any lock so releasing Shift mid-stroke resumes freehand
	// from the current position with no jump.
	_resolveStrokePoint(point, shiftHeld) {
		if (shiftHeld && this.strokeOrigin) {
			const locked = this._projectAxisLock(point);
			locked.pressure = point.pressure;
			// Keep the smoothing anchor on the locked point so a later Shift release
			// eases from here rather than snapping back to the raw pointer.
			this.smoothedPoint = { x: locked.x, y: locked.y };
			return locked;
		}

		this.axisLockDir = null;
		return this._applySmoothing(point);
	}

	// Project `point` onto a straight ray from strokeOrigin. The ray direction is
	// chosen once, on the first move past a small threshold, by snapping the drag
	// angle to the nearest 45°, then reused for the rest of the stroke.
	_projectAxisLock(point) {
		const origin = this.strokeOrigin;
		const dx = point.x - origin.x;
		const dy = point.y - origin.y;

		if (!this.axisLockDir) {
			if (Math.hypot(dx, dy) < MaskEditor.AXIS_LOCK_MIN_DISTANCE) {
				// Not enough travel to commit to a direction yet — hold at origin.
				return { x: origin.x, y: origin.y };
			}
			const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
			this.axisLockDir = { x: Math.cos(snapped), y: Math.sin(snapped) };
		}

		const dir = this.axisLockDir;
		const projected = dx * dir.x + dy * dir.y;
		return { x: origin.x + dir.x * projected, y: origin.y + dir.y * projected };
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

		const smoothed = this._applySmoothing(point);
		this._stampAlongPath(layer, paint, this.lastPoint, smoothed);
		this.lastPoint = smoothed;
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

		// Remember where this stroke ended so a following Shift-click can draw a
		// straight line from here (Photoshop line-connect). Tagged with the layer
		// id so it never connects across layers.
		if (this.lastPoint) {
			this.lastStrokeEndPoint = {
				x: this.lastPoint.x,
				y: this.lastPoint.y,
				pressure: this.lastPoint.pressure,
				layerId: layer.id
			};
		}

		if (this.strokeChanged) {
			this.editor.glitterManager.commitPaintState(layer);
			this.editor.requestPreviewUpdate();
			this.editor.layerManager.renderLayersList();
			this.editor.updateActionButtons();
			this.editor.updateHelpfulMessage();
			this.editor.saveState('Paint mask');
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
		this.strokeModeOverride = null;
		this.activePointerId = null;
		this.lastPoint = null;
		// Axis-lock is per-stroke; lastStrokeEndPoint is NOT (it survives to the
		// next Shift-click), so it is cleared elsewhere (layer switch / undo).
		this.strokeOrigin = null;
		this.axisLockDir = null;
		this.scratchAddCanvas = null;
		this.scratchSubCanvas = null;
		this.livePreviewQueued = false;
		this.liveOverlayQueued = false;
		// A pen-eraser override just cleared — put the ring back to whatever the
		// toolbar mode is before the next hover frame.
		this._syncCursorAppearance();
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

		// Erase mode on a layer with nothing to remove: don't start a stroke that
		// would silently pile up in the subtract mask, flip maskHasContent true,
		// and commit an empty "Paint mask" undo state. The user has most likely
		// not noticed the Paint/Erase control is set to Erase — say so, once.
		if (this.getActiveMode() === 'sub' && !hasMaskContent(layer)) {
			this._warnNothingToErase();
			return false;
		}

		const paint = this.editor.glitterManager.ensurePaintMask(layer.id);
		this.strokeActive = true;
		this.strokeChanged = false;
		this.activePointerId = options.pointerId ?? null;
		point.pressure = options.pressure;
		this.lastPoint = point;
		this.currentLayerId = layer.id;
		this._captureScratchCanvases(paint);

		if (options.pointerId !== undefined && options.pointerId !== null) {
			this.editor.previewContainer.setPointerCapture?.(options.pointerId);
		}

		if (options.showTouchRing) {
			this._showTouchRing(screenX, screenY);
		}

		// The first point of the stroke is a stamp; reset the spacing accumulator
		// so the next stamp lands exactly `spacing` further along the path, and
		// seed the smoothing anchor at the raw start point (no lag on the first
		// stamp).
		this.stampCarry = 0;
		this.smoothedPoint = { x: point.x, y: point.y };
		// Seed the per-stroke scatter/jitter PRNG so a live re-render (and an
		// undo/redo) reproduces the exact same spray for this stroke.
		this._strokeRng = maskMulberry32((Date.now() ^ (point.x * 73856093) ^ (point.y * 19349663)) >>> 0);
		this._lastDirX = 1;
		this._lastDirY = 0;
		// WP2: this point anchors axis-lock for a Shift-drag that follows. Shift
		// constrains ONLY the current stroke (from this point) — it deliberately
		// does NOT connect a line from a previous stroke, which surprised users.
		this.strokeOrigin = { x: point.x, y: point.y };
		this.axisLockDir = null;
		this._stampAtPoint(layer, paint, point.x, point.y, point.pressure);
		return true;
	}

	// Debounced so scrubbing the eraser back and forth over an empty layer nags
	// once, not once per attempted stroke.
	_warnNothingToErase() {
		const now = Date.now();
		if (now - (this._lastNothingToEraseWarning || 0) < 1500) {
			return;
		}
		this._lastNothingToEraseWarning = now;
		this.editor.showError('Nothing to erase on this layer yet — switch to Paint to add glitter');
	}

	_ensurePaintableLayer() {
		let layer = this.editor.layerManager.getActiveLayer();
		if (layer && layer.type === LayerType.GLITTER_FILL) {
			if (!this.editor.canEditLayer(layer, { notify: true })) return null;
			return layer;
		}

		// Erasing has nothing to do on a layer that can't hold glitter —
		// don't create a fresh glitter layer just to immediately mark it dirty.
		if (this.getActiveMode() === 'sub') {
			this.editor.showError('Nothing to erase here — select a glitter layer first');
			return null;
		}

		// Same convention as the color picker on a non-glitter layer:
		// auto-create a glitter layer and work in it.
		if (!CONFIG.app.behavior.autoCreateGlitterLayer) {
			this.editor.showError('Select a glitter layer to paint on');
			return null;
		}

		layer = this.editor.glitterManager.createLayer();
		if (!layer) {
			return null; // maxLayers reached — createLayer already showed the error
		}

		this.editor.layerManager.insertLayer(layer, { suppressDesignGalleryFocus: true });
		this.editor.layerManager.setActiveLayer(layer.id);
		this.editor.layerManager.renderLayersList();
		return layer;
	}

	// Lays stamps at a fixed spacing along the whole stroke. `stampCarry` is the
	// distance already travelled toward the next stamp before this segment, so
	// spacing is honoured continuously across pointer-move segments instead of
	// being reset each move (and we do NOT force a stamp at the segment end —
	// that's what previously made the Spacing control look like a no-op, since a
	// stamp landed at every move point regardless of spacing).
	_stampAlongPath(layer, paint, fromPoint, toPoint) {
		const spacing = Math.max(1, this.getBrushSize() * this.getBrushSpacing());
		const dx = toPoint.x - fromPoint.x;
		const dy = toPoint.y - fromPoint.y;
		const distance = Math.hypot(dx, dy);

		if (distance === 0) {
			return;
		}

		// Remember this segment's heading so scatter has an axis to spread across
		// (the normal) even on a slow, near-stationary drag.
		this._lastDirX = dx / distance;
		this._lastDirY = dy / distance;

		const fromPressure = fromPoint.pressure;
		const toPressure = toPoint.pressure;
		const carry = this.stampCarry || 0;

		// Offset (along this segment) of the first stamp; if it's past the segment
		// end, no stamp lands here — just accumulate the travelled distance.
		let along = spacing - carry;
		if (along > distance) {
			this.stampCarry = carry + distance;
			return;
		}

		let lastAlong = 0;
		while (along <= distance) {
			const progress = along / distance;
			const x = fromPoint.x + dx * progress;
			const y = fromPoint.y + dy * progress;
			const pressure = this._interpolatePressure(fromPressure, toPressure, progress);
			this._stampAtPoint(layer, paint, x, y, pressure);
			lastAlong = along;
			along += spacing;
		}

		// Leftover distance from the last stamp to the segment end carries forward.
		this.stampCarry = distance - lastAlong;
	}

	_interpolatePressure(fromPressure, toPressure, progress) {
		const from = fromPressure ?? toPressure ?? 0.5;
		const to = toPressure ?? from;
		return from + (to - from) * progress;
	}

	isPressureEnabled() {
		return this.toolSettings[this.getActiveMode()].pressure;
	}

	_getStampAlpha(pressure) {
		const flow = this.getBrushFlow() / 100;
		if (!this.isPressureEnabled() || pressure == null) {
			return flow;
		}

		// Non-pen input is normalized to null before it reaches this method, so
		// only a pressure-sensitive pen can alter the configured Flow.
		const pressureMultiplier = Math.max(0, pressure * 2);
		return Math.min(1, flow * pressureMultiplier);
	}

	_stampAtPoint(layer, paint, x, y, pressure) {
		const alpha = this._getStampAlpha(pressure);
		const activeMode = this.getActiveMode();
		const targetCtx = (activeMode === 'add' ? paint.add : paint.sub).getContext('2d', { willReadFrequently: true });
		const oppositeCtx = (activeMode === 'add' ? paint.sub : paint.add).getContext('2d', { willReadFrequently: true });

		if (this._dynamicsAreNeutral()) {
			this._stampPlainDab(targetCtx, oppositeCtx, x, y, alpha);
		} else if (!this._stampDynamicDabs(targetCtx, oppositeCtx, x, y, alpha)) {
			return;   // raster tip still decoding — nothing painted, try again next move
		}

		paint.liveRevision++;
		paint.hasContent = true;
		layer.maskHasContent = true;
		this.strokeChanged = true;
		this._queueOverlayRefresh();
	}

	// The pre-dynamics path: one upright vector stamp, size×size, optionally
	// pixel-snapped for crisp edges. Kept byte-for-byte so existing mask-edge
	// behaviour and tests are untouched when no dynamics are in play.
	_stampPlainDab(targetCtx, oppositeCtx, x, y, alpha) {
		const stamp = this._getStampCanvas();
		const size = this.getBrushSize();
		const halfSize = size / 2;
		const crispStamp = this.getBrushSoftness() === 0 && shouldUseCrispMaskEdges();
		const destinationX = crispStamp ? Math.round(x - halfSize) : x - halfSize;
		const destinationY = crispStamp ? Math.round(y - halfSize) : y - halfSize;

		targetCtx.save();
		targetCtx.globalCompositeOperation = 'source-over';
		targetCtx.globalAlpha = alpha;
		if (crispStamp) targetCtx.imageSmoothingEnabled = false;
		targetCtx.drawImage(stamp, destinationX, destinationY, size, size);
		targetCtx.restore();

		oppositeCtx.save();
		oppositeCtx.globalCompositeOperation = 'destination-out';
		oppositeCtx.globalAlpha = alpha;
		if (crispStamp) oppositeCtx.imageSmoothingEnabled = false;
		oppositeCtx.drawImage(stamp, destinationX, destinationY, size, size);
		oppositeCtx.restore();
	}

	// Scatter / jitter path. Emits `count` dabs around (x,y); each is drawn into
	// BOTH the active mask (source-over) and the opposite mask (destination-out)
	// so erasing stays exact. Returns false only when a raster tip hasn't decoded
	// yet (so the caller can skip cleanly). Randomness comes from the per-stroke
	// seeded PRNG — a live re-render lays the same spray.
	_stampDynamicDabs(targetCtx, oppositeCtx, x, y, alpha) {
		const tip = this._activeTip();
		if (!tip) return false;

		const size = this.getBrushSize();
		const dyn = this.getBrushDynamics();
		const rng = this._strokeRng || Math.random;
		const sym = () => rng() * 2 - 1;
		const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1));

		// Stroke normal (scatter across) and tangent (scatter along, when bothAxes).
		const dl = Math.hypot(this._lastDirX, this._lastDirY) || 1;
		const tx = this._lastDirX / dl, ty = this._lastDirY / dl;
		const nx = -ty, ny = tx;
		const scatterPx = dyn.scatter * size;

		const maxCount = maskClamp(Math.round(dyn.count), 1, CONFIG.tools.maskBrush.dynamics.limits.countMax);
		const minCount = Math.max(1, Math.round(maxCount * (1 - dyn.countJitter)));
		const count = dyn.countJitter > 0 ? randInt(minCount, maxCount) : maxCount;

		for (let i = 0; i < count; i++) {
			const offN = sym() * scatterPx;
			const offT = dyn.bothAxes ? sym() * scatterPx : 0;
			const cx = x + nx * offN + tx * offT;
			const cy = y + ny * offN + ty * offT;
			const dabSize = Math.max(1, size * (1 - rng() * dyn.sizeJitter));
			const rot = (dyn.angle + sym() * dyn.angleJitter * 180) * Math.PI / 180;
			this._drawDab(targetCtx, oppositeCtx, tip, cx, cy, dabSize, rot, dyn.roundness, dyn.flipX, dyn.flipY, alpha, dyn.smoothing);
		}
		return true;
	}

	// One transformed dab into the active + opposite masks. `tip` is a canvas
	// (white RGB, alpha = coverage); its larger side is fit to `dabSize`
	// (Photoshop "diameter"), then squashed by `roundness` and mirrored by flips.
	_drawDab(targetCtx, oppositeCtx, tip, cx, cy, dabSize, rot, roundness, flipX, flipY, alpha, smoothing = true) {
		const aspect = tip.width / tip.height;
		let w, h;
		if (aspect >= 1) { w = dabSize; h = dabSize / aspect; }
		else { h = dabSize; w = dabSize * aspect; }
		h *= roundness;
		const sx = flipX ? -1 : 1;
		const sy = flipY ? -1 : 1;

		for (const [ctx, op] of [[targetCtx, 'source-over'], [oppositeCtx, 'destination-out']]) {
			ctx.save();
			ctx.globalCompositeOperation = op;
			ctx.globalAlpha = alpha;
			ctx.imageSmoothingEnabled = smoothing;   // false → crisp nearest-neighbour for tiny pixel tips
			ctx.translate(cx, cy);
			if (rot) ctx.rotate(rot);
			if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
			ctx.drawImage(tip, -w / 2, -h / 2, w, h);
			ctx.restore();
		}
	}

	// The active tip as a plain canvas for the dab renderer: the vector stamp
	// (size×size) as-is, or the raster pack tip at native resolution. Returns null
	// if a raster tip is still decoding (loadTip re-renders when it lands).
	_activeTip() {
		const shape = this.getBrushShape();
		if (MaskEditor.isRasterBrush(shape)) {
			const canvas = BrushLibrary.getTipCanvas(shape);
			if (canvas) return canvas;
			BrushLibrary.loadTip(shape).then(() => this._queueOverlayRefresh()).catch(() => {});
			return null;
		}
		return this._getStampCanvas();
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
		if (CONFIG.tools.maskBrush.livePreview.throttle !== 'raf' || this.livePreviewQueued) {
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
		// Flow (and pressure) are applied as globalAlpha at draw time instead of
		// being baked in here, since pressure varies per-stamp along a stroke.
		const shape = this.getBrushShape();
		const key = [
			shape,
			this.getBrushSize(),
			this.getBrushSoftness(),
			shouldUseCrispMaskEdges(),
			CONFIG.rendering.maskAlphaThreshold
		].join('|');
		if (this.stampCacheKey === key && this.stampCanvas) {
			return this.stampCanvas;
		}

		const size = this.getBrushSize();
		const softness = this.getBrushSoftness() / 100;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });

		if (shape === 'round') {
			this._drawRoundStamp(ctx, size, softness);
		} else {
			this._drawShapeStamp(ctx, shape, size, softness);
		}
		if (softness === 0 && shouldUseCrispMaskEdges()) {
			binarizeCanvasAlpha(ctx);
		}

		this.stampCanvas = canvas;
		this.stampCacheKey = key;
		return canvas;
	}

	_drawRoundStamp(ctx, size, softness) {
		const radius = size / 2;
		const innerRadius = radius * (1 - softness);

		if (innerRadius >= radius) {
			// Softness 0: hard-edged circle. A radial gradient with equal inner
			// and outer radius is degenerate and paints nothing per spec.
			ctx.fillStyle = 'rgba(255, 255, 255, 1)';
			ctx.beginPath();
			ctx.arc(radius, radius, radius, 0, Math.PI * 2);
			ctx.fill();
		} else {
			const gradient = ctx.createRadialGradient(radius, radius, innerRadius, radius, radius, radius);
			gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
			gradient.addColorStop(Math.max(0.001, innerRadius / radius), 'rgba(255, 255, 255, 1)');
			gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, size, size);
		}
	}

	// Non-round tips (square, calligraphy, star, heart). Softness feathers the
	// edge with a canvas blur; the shape is inset by the blur radius so the
	// feathered edge stays inside the size×size stamp (mirroring how the round
	// tip's gradient reaches, but never exceeds, the brush radius).
	_drawShapeStamp(ctx, shape, size, softness) {
		const radius = size / 2;
		const blurPx = softness * radius * 0.8;
		const shapeRadius = Math.max(1, radius - blurPx);

		ctx.save();
		ctx.translate(radius, radius);
		if (blurPx > 0.01) {
			ctx.filter = `blur(${blurPx}px)`;
		}
		ctx.fillStyle = 'rgba(255, 255, 255, 1)';
		// Geometry lives in ShapeLibrary (shared with the Shape tool). trace() fills
		// the shape itself. Brush stamps are uniform → same half-extent for W and H.
		ShapeLibrary.trace(shape, ctx, shapeRadius, shapeRadius);
		ctx.restore();
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
		// Real touch input is handled by GestureManager — this pointer pipeline is
		// intentionally mouse/pen-only.
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
		this._syncCursorAppearance();
		this.cursorVisible = true;
	}

	_shouldShowTouchRingForPointer(event) {
		if (!this.isEditing || !Input.isCoarse) {
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
		this._syncCursorAppearance();
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

	// Keep the on-canvas cursor honest about the current tool: an eraser look
	// (dashed warning-tinted, minus glyph instead of plus) whenever the active
	// mode subtracts — a per-stroke pen-eraser override counts — and an outline
	// that traces the actual brush tip instead of always a circle, so a square /
	// star / calligraphy tip is obvious before the first stroke.
	_syncCursorAppearance() {
		const cursor = this.ui.cursor;
		if (!cursor) {
			return;
		}

		cursor.classList.toggle('erasing', this.getActiveMode() === 'sub');

		const shape = this.getBrushShape();
		if (shape !== this._cursorShapeId) {
			this._cursorShapeId = shape;
			const raster = MaskEditor.isRasterBrush(shape);
			if (this.ui.cursorShape) {
				// 'round' keeps the crisp CSS-border circle; a vector tip swaps in a
				// stroked SVG silhouette (getContentSvg, so it matches the stamp with
				// no design-box padding); a raster tip shows its own bitmap, faint.
				this.ui.cursorShape.innerHTML = raster
					? BrushLibrary.getCursorMarkup(shape)
					: (shape === 'round' ? '' : ShapeLibrary.getContentSvg(shape));
			}
			cursor.classList.toggle('shaped', shape !== 'round');
			cursor.classList.toggle('raster', raster);
		}
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
		// The single Mask Brush button is "active" whenever the tool is engaged,
		// regardless of paint mode; add vs. sub is shown by the Paint/Erase
		// segmented control in the mask-brush context bar.
		const isBrushActive = this.editor.currentTool === ToolType.BRUSH;
		document.getElementById('brushTool')?.classList.toggle('active', isBrushActive);
		document.querySelectorAll('#maskBrushControls [data-brush-mode]').forEach((option) => {
			const on = option.dataset.brushMode === this.mode;
			option.classList.toggle('active', on);
			option.setAttribute('aria-pressed', on ? 'true' : 'false');
		});
	}

	_getOverlayPalette(layer) {
		const glitter = layer?.selectedGlitterId
			? this.editor.glitterManager?.getItemById(layer.selectedGlitterId)
			: null;
		const fillColor = this._normalizeOverlayColor(glitter?.colorCodes?.[0]) || CONFIG.tools.maskBrush.overlay.color;
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

	// All brush getters read the ACTIVE mode's stored settings (getActiveMode, so
	// a pen-eraser override paints with the Eraser's values). The DOM panel is a
	// view synced by _applySettingsToDOM — never read from it here.
	getBrushSize() {
		return this.toolSettings[this.getActiveMode()].size;
	}

	getBrushSoftness() {
		return this.toolSettings[this.getActiveMode()].softness;
	}

	getBrushFlow() {
		return this.toolSettings[this.getActiveMode()].flow;
	}

	// Distance between stamps along a stroke, as a fraction of brush size (the
	// stored value is a percentage; return the fraction).
	getBrushSpacing() {
		return this.toolSettings[this.getActiveMode()].spacing / 100;
	}

	// Stroke smoothing strength, 0 (off) .. ~0.9 (heavy). Capped below 1 so the
	// brush never fully freezes. The stored value is a 0–100% percentage.
	getBrushSmoothing() {
		const value = this.toolSettings[this.getActiveMode()].smoothing;
		return Math.max(0, Math.min(100, value)) / 100 * 0.9;
	}

	// Exponential-moving-average stabilizer: ease the brush position toward the
	// raw pointer instead of following it exactly, damping jitter. Returns the
	// smoothed point (carrying the raw pressure) and advances the anchor. At
	// strength 0 it tracks the pointer exactly (and keeps the anchor synced so
	// turning smoothing on mid-stroke doesn't jump).
	_applySmoothing(point) {
		const strength = this.getBrushSmoothing();
		if (strength <= 0 || !this.smoothedPoint) {
			this.smoothedPoint = { x: point.x, y: point.y };
			return point;
		}

		const follow = 1 - strength;
		const x = this.smoothedPoint.x + (point.x - this.smoothedPoint.x) * follow;
		const y = this.smoothedPoint.y + (point.y - this.smoothedPoint.y) * follow;
		this.smoothedPoint = { x, y };
		return { x, y, pressure: point.pressure };
	}
}

// localStorage key for the per-mode brush/eraser settings store (WP1). Bump the
// version suffix if the stored shape ever changes incompatibly.
MaskEditor.SETTINGS_STORAGE_KEY = 'glitter.toolSettings.v1';

// Per-brush scatter/jitter overrides (keyed by brush id), independent of the
// per-mode settings above.
MaskEditor.DYNAMICS_STORAGE_KEY = 'glitter.brushDynamics.v1';

// Minimum canvas-space travel (WP2) before a Shift-drag commits to an axis-lock
// direction — avoids a jittery direction pick on the first pixel of movement.
MaskEditor.AXIS_LOCK_MIN_DISTANCE = 4;

// Brush tip catalog: the vector tips live in ShapeLibrary (shared with the Shape
// tool, WP5a); raster packs live in BrushLibrary. This static alias keeps
// existing MaskEditor.BRUSH_SHAPES references working for the vector set.
MaskEditor.BRUSH_SHAPES = ShapeLibrary.BRUSH_SHAPES;

MaskEditor.isRasterBrush = (id) => typeof BrushLibrary !== 'undefined' && BrushLibrary.isRaster(id);
MaskEditor.isKnownBrushShape = (id) =>
	MaskEditor.BRUSH_SHAPES.some((entry) => entry.id === id) || MaskEditor.isRasterBrush(id);

// Scatter & Jitter panel rows (PANEL units). rasterOnly rows hide for vector tips.
MaskEditor.DYNAMICS_SLIDERS = [
	{ key: 'scatter', label: 'Scatter', unit: '%', min: 0, max: CONFIG.tools.maskBrush.dynamics.limits.scatterMax, hint: 'Spread each stamp off the stroke path, as a percentage of brush size.' },
	{ key: 'count', label: 'Count', unit: '×', min: 1, max: CONFIG.tools.maskBrush.dynamics.limits.countMax, hint: 'How many dabs to lay down at every stamp position.' },
	{ key: 'countJitter', label: 'Count Jitter', unit: '%', min: 0, max: 100, hint: 'Randomly vary the dab count between 1 and Count.' },
	{ key: 'sizeJitter', label: 'Size Jitter', unit: '%', min: 0, max: 100, hint: 'Randomly shrink each dab from the full brush size.' },
	{ key: 'angle', label: 'Angle', unit: '°', min: -180, max: 180, rasterOnly: true, hint: 'Base rotation of the tip.' },
	{ key: 'angleJitter', label: 'Angle Jitter', unit: '%', min: 0, max: 100, hint: 'Randomly rotate each dab.' },
	{ key: 'roundness', label: 'Roundness', unit: '%', min: 5, max: 100, rasterOnly: true, hint: 'Squash the tip along one axis (100% = unchanged).' }
];
MaskEditor.DYNAMICS_TOGGLES = [
	{ key: 'bothAxes', label: 'Scatter both axes', hint: 'Scatter along the stroke as well as across it.' },
	{ key: 'smoothing', label: 'Smooth scaling', rasterOnly: true, hint: 'Off = crisp nearest-neighbour pixels — better for tiny pixel tips like Stardust.' },
	{ key: 'flipX', label: 'Flip X', rasterOnly: true, hint: 'Mirror the tip horizontally.' },
	{ key: 'flipY', label: 'Flip Y', rasterOnly: true, hint: 'Mirror the tip vertically.' }
];
