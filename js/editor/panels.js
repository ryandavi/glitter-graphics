// The host that stands for "no single layer": what can be added, or the
// multi-selection's actions.
const NO_SELECTION_PANEL = 'noLayerSettings';

const EDITOR_PANEL_METHODS = {
	setupSlider(sliderId, valueId, suffix, updateCallback, resetValue, field = null) {
		const slider = document.getElementById(sliderId);
		const valueDisplay = document.getElementById(valueId);
		const resetBtn = document.getElementById('reset' + sliderId.charAt(0).toUpperCase() + sliderId.slice(1));

		if (!slider || !valueDisplay) return;


		bindSlider(slider, valueDisplay, {
			suffix,
			resetValue,
			resetButton: resetBtn,
			cost: field?.cost,
			onInput: typeof updateCallback === 'function'
				? (value, sliderEl, event) => updateCallback(event || { target: sliderEl })
				: null,
		});
	}

,
	syncQuickSlider(canonicalId, quickId, quickValueId, suffix) {
		const canonical = document.getElementById(canonicalId);
		const quick = document.getElementById(quickId);
		const quickValue = document.getElementById(quickValueId);
		if (!canonical || !quick) return;

		quick.min = canonical.min;
		quick.max = canonical.max;
		// Mirror any non-linear scale so the quick slider's raw position maps the
		// same way the canonical one does (positions are copied verbatim below).
		if (canonical.dataset.scale) {
			quick.dataset.scale = canonical.dataset.scale;
			quick.dataset.scaleMin = canonical.dataset.scaleMin;
			quick.dataset.scaleMax = canonical.dataset.scaleMax;
			quick.step = canonical.step;
		}
		quick.value = canonical.value;
		if (quickValue) quickValue.innerHTML = formatUnit(readSliderValue(canonical), suffix);

		let syncing = false;
		canonical.addEventListener('input', () => {
			if (syncing) return;
			syncing = true;
			quick.value = canonical.value;
			if (quickValue) quickValue.innerHTML = formatUnit(readSliderValue(canonical), suffix);
			syncing = false;
		});

		quick.addEventListener('input', () => {
			if (syncing) return;
			syncing = true;
			canonical.value = quick.value;
			if (quickValue) quickValue.innerHTML = formatUnit(readSliderValue(quick), suffix);
			canonical.dispatchEvent(new Event('input'));
			syncing = false;
		});
	}

,
	setupMaskEditorListeners() {
		// Size / Spacing revert to the ACTIVE raster tip's manifest value (its
		// authored diameter / spacing), falling back to the global default for
		// vector tips. Passed as a thunk so bindSlider resolves it per click.
		this.setupSlider('maskBrushSize', 'maskBrushSizeValue', 'px', () => {
			this.maskEditor?._updateBrushCursorSize();
		}, () => this.maskEditor?.rasterSliderDefault('maskBrushSize') ?? FIELDS.maskBrushSize.value);

		this.setupSlider('maskBrushSoftness', 'maskBrushSoftnessValue', '%', () => {
			this.maskEditor?.renderOverlay();
		}, FIELDS.maskBrushSoftness.value);

		this.setupSlider('maskBrushFlow', 'maskBrushFlowValue', '%', () => {
			this.maskEditor?.renderOverlay();
		}, FIELDS.maskBrushFlow.value);

		// Spacing is a percentage of brush size; it only affects future stamps
		// (the resulting stroke is baked into the mask), so no live re-render.
		this.setupSlider('maskBrushSpacing', 'maskBrushSpacingValue', '%', null,
			() => this.maskEditor?.rasterSliderDefault('maskBrushSpacing')
				?? FIELDS.maskBrushSpacing.value);

		// Smoothing (EMA stabilizer); affects the live stroke only, no re-render.
		this.setupSlider('maskBrushSmoothing', 'maskBrushSmoothingValue', '%', null,
			FIELDS.maskBrushSmoothing.value);

		this.syncQuickSlider('maskBrushSize', 'maskBrushSizeQuick', 'maskBrushSizeQuickValue', 'px');

		this.maskEditor?.setupUIListeners();
	}

,
	syncCheckboxes(id1, id2, bidirectional = true) {
		const elem1 = document.getElementById(id1);
		const elem2 = document.getElementById(id2);

		if (!elem1 || !elem2) return;

		let syncing = false;

		elem1.addEventListener('change', (e) => {
			if (syncing) return;
			syncing = true;
			elem2.checked = e.target.checked;
			elem2.dispatchEvent(new Event('change'));
			syncing = false;
		});

		if (bidirectional) {
			elem2.addEventListener('change', (e) => {
				if (syncing) return;
				syncing = true;
				elem1.checked = e.target.checked;
				elem1.dispatchEvent(new Event('change'));
				syncing = false;
			});
		}
	}

,
	setupLayerSettingsListeners() {
		this.syncCheckboxes('contiguous', 'contextContiguous');
		this.syncCheckboxes('multiSelect', 'contextMultiSelect');
	}

,

setupLayerBlendModeListeners() {
	if (this._layerBlendModeListenersBound) return;
	this._layerBlendModeListenersBound = true;
	document.addEventListener('change', (event) => {
		const control = event.target.closest?.('select.layer-blend-mode');
		if (!control) return;
		const layer = this.layerManager?.getActiveLayer();
		if (!layer || !LAYER_UI_CONFIG[layer.type]?.blendable) return;
		layer.blendMode = GlitterBlendModes.normalize(control.value);
		this.requestPreviewUpdate();
		this.saveState('Edit appearance');
	});
}

,
syncLayerBlendModeControl(layer) {
	if (!layer || !LAYER_UI_CONFIG[layer.type]?.blendable) return;
	const sectionId = PANEL_SCHEMAS[layer.type]?.section?.id;
	const control = sectionId ? document.querySelector(`#${sectionId} select.layer-blend-mode`) : null;
	if (!control) return;
	control.value = GlitterBlendModes.forLayer(layer);
	syncPropertyReverts(control.closest('.property-row'));
}

,
isLayerContentLocked(layer) {
		return Boolean(isLayerFullyLocked(layer) && layer.type !== LayerType.BASE_IMAGE);
	}

,
	canEditLayer(layer, options = {}) {
		const editable = Boolean(layer) && !this.isLayerContentLocked(layer);
		if (!editable && options.notify) {
			this.showError('Unlock this layer to edit it');
		}
		return editable;
	}

,
	// Every lock pins the transform, including a position-only one that
	// canEditLayer lets through.
	canTransformLayer(layer, options = {}) {
		const free = Boolean(layer) && (!layer.locked || layer.type === LayerType.BASE_IMAGE);
		if (!free && options.notify) {
			this.showError('Unlock this layer to move or transform it');
		}
		return free;
	}

,
	syncLockedLayerUI(layer) {
		const locked = this.isLayerContentLocked(layer) && !this.layerManager.hasMultiSelection();
		Object.values(LayerType).map((type) => PANEL_SCHEMAS[type]).filter(Boolean).forEach((schema) => {
			const section = document.getElementById(schema.section.id);
			if (!section) return;
			const sectionLocked = locked && section.classList.contains('visible');
			// The panel's flyout sections live in the window.
			const flyouts = document.getElementById(`${schema.sectionPrefix}Flyouts`);
			if (flyouts) {
				flyouts.inert = sectionLocked;
				flyouts.classList.toggle('is-layer-edit-locked', sectionLocked);
			}
			section.classList.toggle('is-layer-edit-locked', sectionLocked);
			const content = section.querySelector(':scope > .section-content');
			if (content) {
				content.inert = sectionLocked;
				content.setAttribute('aria-disabled', String(sectionLocked));
				content.title = sectionLocked ? 'Unlock this layer to edit its properties' : '';
			}
		});
		const badge = document.getElementById('inspectorLockedBadge');
		if (badge) badge.hidden = !locked;

		// A position-only lock (see isLayerFullyLocked) leaves the panel editable
		// apart from its Transform controls.
		const positionLocked = Boolean(layer?.locked) && !locked && !this.layerManager.hasMultiSelection();
		document.querySelectorAll('.transform-panel-host').forEach((host) => {
			host.inert = positionLocked;
			host.classList.toggle('is-position-locked', positionLocked);
			host.title = positionLocked ? 'Unlock this layer to move or resize it' : '';
		});

		['centerLayerHorizontal', 'centerLayerVertical', 'duplicateLayerSelection'].forEach((id) => {
			const button = document.getElementById(id);
			if (button) button.disabled = locked;
		});
	}

,
	// The Inspector's panels by `sectionPrefix`, in the order the switch and the
	// phone bar show them: the tool's own panel leads, then the session's or
	// the selection's. With nothing selected the canvas's own properties show
	// under what can be added.
	getVisiblePanels() {
		if (!this.originalImage) return [];
		const manager = this.layerManager;
		const layer = manager.getInspectedLayer();
		const session = getSessionDefinition(this)?.panel;
		const panels = [];
		if (session) panels.push(session);
		else {
			if (!manager.getActiveLayer() || manager.hasMultiSelection()) panels.push(NO_SELECTION_PANEL);
			if (layer) panels.push(PANEL_SCHEMAS[layer.type].sectionPrefix);
		}
		const tool = TOOLS[this.currentTool]?.panel(this, layer);
		return tool ? [tool, ...panels.filter((name) => name !== tool)] : panels;
	}

,
	// The one way the Inspector follows the editor: which panels show, their
	// values, the lock state, the header, and pickers armed for another layer.
	// Selection, tools, undo, project load and sessions all end here.
	refreshInspector() {
		this.setupLayerBlendModeListeners();
		const layer = this.layerManager.getInspectedLayer();
		// A picker armed for another layer ends before the panels load.
		this.pickers.closeStale();
		const names = this.getVisiblePanels();
		Array.from(document.getElementById('inspectorBody').children).forEach((host) => {
			const shown = names.includes(host.id.replace(/Section$/, ''));
			host.classList.toggle('visible', shown);
			if (shown) return;
			host.classList.remove('is-open');
			host.querySelector(':scope > .section-content')?.classList.remove('visible');
		});
		this.syncPanelEmptyStates(layer);
		this.syncCollapsibleSections?.(names.find((name) => this.switchPanels.has(name)));
		this.syncNoLayerPanelState();

		this.syncLayerBlendModeControl(layer);
		this.loadActiveLayerSettings();
		this.updateGlitterSelection();
		this.updateStickerSelection();
		syncLibraryView();
		// Canvas Properties owns the document-size card for every tool.
		const documentSize = document.getElementById('documentSizeGroup');
		const sizeHost = document.getElementById('baseCanvasSizeHost');
		if (documentSize && sizeHost && documentSize.parentElement !== sizeHost) sizeHost.appendChild(documentSize);
		this.syncLockedLayerUI(layer);

		// The Library's kind and title follow whatever is still armed.
		syncPickerTarget(this);

		this.syncCanvasBoundsViews();
	}

,
	// What a new layer most likely needs next, from its type's `openOnCreate`:
	// 'asset' is the Library on its asset, 'panel' is its properties (which
	// only the phone has to open), and anything else is the key of a flyout
	// section, which on the phone is that paint's Library. The layer list's
	// "go to" buttons name their target themselves.
	openCreateTarget(layer, target = LAYER_UI_CONFIG[layer?.type]?.openOnCreate) {
		if (!target || this.layerManager.getActiveLayer() !== layer) return;
		const mobile = this.mobileManager;
		if (target === 'asset') getLayerManagerForType(this, layer.type).armAssetPicker();
		else if (target === 'panel') {
			if (mobile?.isMobile) mobile.openLeadingSection();
		} else {
			if (this.pickers.flyout !== target) this.pickers.toggleFlyout(target);
			// In the phone's sheet a section does not open its Library by itself.
			if (mobile?.isMobile) this.armPaintSlot(layer, target);
		}
	},

	// Open the glitter Library on one of a layer's paints, through the type's
	// own field host: the call its glitter chip makes.
	armPaintSlot(layer, slotKey) {
		const host = getLayerManagerForType(this, layer.type).fieldHost;
		if (getPaintSlotDefinition(layer.type, slotKey) && host.getLayer() === layer) host.armPicker(slotKey);
	},

	// The tail end of "a tool made a layer": back to Select, and the panel
	// reloads once the caller has finished placing it.
	finishLayerCreation(layer) {
		if (!layer) return;
		this.setTool(ToolType.SELECT);
		setTimeout(() => this.refreshInspector(), 0);
	}

,
	getVisibleSwitchPanels() {
		return this.getVisiblePanels().filter((name) => this.switchPanels.has(name));
	}

	// The switch between panels showing together (a tool's settings beside the
	// layer's properties).
,
	renderPanelSwitch(host, names) {
		host.replaceChildren();
		if (names.length < 2) return;
		const group = tplClone('tpl-segmented');
		group.setAttribute('role', 'group');
		group.setAttribute('aria-label', 'Panel');
		names.forEach((name) => {
			const button = tplClone('tpl-segmented-option');
			const open = document.getElementById(`${name}Section`)?.classList.contains('is-open');
			button.textContent = this.switchPanels.get(name).section.tab;
			button.classList.toggle('active', open);
			button.setAttribute('aria-pressed', String(open));
			button.addEventListener('click', () => this.setCollapsibleSectionOpen(name, true));
			group.appendChild(button);
		});
		host.appendChild(group);
	}

	// The Inspector's one bar names the selection; the panels below it never do.
,
	syncInspectorHeader() {
		const icon = document.getElementById('inspectorTitleIcon');
		const text = document.getElementById('inspectorTitleText');
		const badge = document.getElementById('inspectorTitleBadge');
		const bar = document.getElementById('inspectorSwitch');
		if (!icon || !text || !badge || !bar || !this.switchPanels) return;
		const count = this.layerManager?.getSelectedLayers?.().length || 0;
		const active = this.layerManager?.getActiveLayer?.();
		const session = this.switchPanels.get(getSessionDefinition(this)?.panel)?.section;
		let title = { icon: 'sliders', text: 'Properties' };
		if (session) title = { icon: session.icon, text: session.title };
		else if (!this.originalImage) title = { ...title };
		else if (count > 1) title = { icon: 'layers', text: `${count} layers` };
		else if (active) {
			// The kind of layer, then its name: a fill layer is named by its paint
			// (a glitter, a hex colour), which alone does not read as a title.
			const name = describeLayer(active, this).name;
			const kind = LAYER_UI_CONFIG[active.type]?.displayName || name;
			title = { icon: PANEL_SCHEMAS[active.type].section.icon, text: kind, name: name === kind ? '' : name };
		}
		else title = { icon: PANEL_SCHEMAS[LayerType.BASE_IMAGE].section.icon, text: 'Canvas' };
		icon.setAttribute('href', `#icon-${title.icon}`);
		// As the phone's sheet the bar names the open section.
		const sheet = this.mobileManager?.sheetSection;
		text.textContent = sheet ? sheet.title : title.text;
		document.getElementById('inspectorTitleName').textContent = sheet ? '' : title.name || '';
		badge.replaceChildren(...(session?.badge ? [buildFeatureBadge(session.badge)] : []));

		const names = this.getVisibleSwitchPanels();
		bar.hidden = names.length < 2;
		this.renderPanelSwitch(bar, names);
		this.mobileManager?.syncBar();
		// The window names the same layer, and follows the selection.
		this.libraryWindow?.sync();
	}

,
	updateZoomUI() {
		const percentage = this.viewport.getZoomPercentage();
		// Zoom context toolbar reads with the muted-unit treatment like the panels.
		this.contextToolbarRenderer?.setValue('zoomPercentage', `${percentage}%`);
		document.getElementById('statusZoom').innerHTML = formatUnit(percentage, '%');


		this.contextToolbarRenderer?.setEnabled('zoomOut', this.viewport.currentZoomIndex > 0);
		document.getElementById('zoomIn').disabled = this.viewport.currentZoomIndex >= CONFIG.ui.zoom.levels.length - 1;

		// Update cursor
		this.previewContainer.classList.remove('zoom-cursor', 'hand-cursor');
		if (this.currentTool === ToolType.ZOOM) {
			this.previewContainer.classList.add('zoom-cursor');
		} else if (this.currentTool === ToolType.HAND) {
			this.previewContainer.classList.add('hand-cursor');
		}
	}

,
	updateTransparencyGrid() {
		if (!this.previewContainer.classList.contains('transparent-bg')) return;

		const baseSize = CONFIG.canvas.grid.baseSize;
		const size = baseSize * this.viewport.currentZoom;
		const half = size / 2;

		this.previewWrapper.style.backgroundSize = `${size}px ${size}px`;
		this.previewWrapper.style.backgroundPosition =
			`${this.viewport.panX}px ${this.viewport.panY}px, ${this.viewport.panX}px ${this.viewport.panY + half}px, ${this.viewport.panX + half}px ${this.viewport.panY - half}px, ${this.viewport.panX - half}px ${this.viewport.panY}px`;
	}

	// ===== UX: EMPTY STATE MANAGEMENT =====,

,
	// A panel with an empty state (schema `controls`) shows its controls while
	// the inspected layer is of the panel's type and has something to edit
	// (the type's `panelEmpty`). Pass no layer to reset every panel.
	syncPanelEmptyStates(layer = null) {
		Object.values(LayerType).forEach((type) => {
			const schema = PANEL_SCHEMAS[type];
			const filled = layer?.type === type && !LAYER_UI_CONFIG[type].panelEmpty?.(layer);
			[schema, ...(schema.auxiliarySections || [])].filter((panel) => panel.controls).forEach((panel) => {
				document.getElementById(panel.controls.emptyId).classList.toggle('visible', !filled);
				document.getElementById(panel.controls.id).classList.toggle('visible', filled);
			});
		});
		this.mobileManager?.syncBar();
	}

,
	syncNoLayerPanelState() {
		const selectedLayers = this.layerManager?.getSelectedLayers?.() || [];
		const multiCount = selectedLayers.length;
		const canTransform = this.layerManager?.canTransformMultiSelection?.() || false;
		const defaultGroups = document.getElementById('noLayerDefaultGroups');
		const multiGroup = document.getElementById('multiLayerSelectionGroup');
		const emptyText = document.getElementById('noLayerEmptyText');
		const emptySubtext = document.getElementById('noLayerEmptySubtext');

		if (multiCount > 1) {
			if (defaultGroups) defaultGroups.hidden = true;
			if (multiGroup) multiGroup.hidden = false;
			if (emptyText) emptyText.textContent = `${multiCount} layers selected`;
			if (emptySubtext) emptySubtext.textContent = canTransform
				? 'Drag the shared box to move them. Shift+click changes the selection; use Align and Actions below.'
				: 'Selected together for layer actions. Movement and alignment are unavailable while the selection includes a locked, pinned, empty, or Base Image layer.';
			document.querySelectorAll('#multiSelectionAlignScope button, [data-multi-align]').forEach((button) => { button.disabled = !canTransform; });
			document.querySelectorAll('[data-multi-distribute]').forEach((button) => { button.disabled = !canTransform || multiCount < 3; });
			const canChangeLayers = selectedLayers.every((layer) => layer.type !== LayerType.BASE_IMAGE && !isLayerFullyLocked(layer));
			const duplicate = document.getElementById('multiSelectionDuplicateBtn');
			const remove = document.getElementById('multiSelectionDeleteBtn');
			if (duplicate) {
				const gate = this.layerManager.canAddLayers(multiCount);
				duplicate.disabled = !canChangeLayers || !gate.ok;
				duplicate.title = gate.ok ? 'Duplicate selected layers' : gate.reason;
			}
			if (remove) remove.disabled = !canChangeLayers;
			this.syncMultiSelectionOpacity?.(selectedLayers);
			return;
		}

		if (defaultGroups) defaultGroups.hidden = false;
		if (multiGroup) multiGroup.hidden = true;
		if (emptyText) emptyText.textContent = 'Nothing selected';
		if (emptySubtext) emptySubtext.textContent = 'Pick a layer to edit it, or add content below.';
	}

,
	loadActiveLayerSettings() {
		const layer = this.layerManager.getInspectedLayer();
		if (!layer) return;
		this.animationPanel?.load(layer);

		getLayerManagerForType(this, layer.type)?.loadLayerSettings(layer);
		queueMicrotask(() => syncPropertyReverts());
	}

,
	updateGlitterSelection() {
		const layer = this.layerManager.getInspectedLayer();
		const manager = getLayerManagerForType(this, layer?.type);
		const selectedGlitterId = manager?.resolveSelectedGlitterId?.(layer)
			?? manager?.slotPicker?.resolveSelectedGlitterId(layer)
			?? getLayerFillGlitterId(layer);

		// Only the glitter browser: other kinds reuse numeric ids.
		const glitterOptions = document.querySelectorAll(`#${getAssetBrowserSchema('glitter').browserHost} .asset-option`);

		glitterOptions.forEach(opt => {
			const isSelected = layer && selectedGlitterId != null &&
				String(opt.dataset.id) === String(selectedGlitterId);
			opt.classList.toggle('selected', isSelected);
		});

		// Update helpful message
		this.updateHelpfulMessage();

	}

,
	updateStickerSelection() {
		const layer = this.layerManager.getActiveLayer();

		// Get all sticker options (from asset browser)
		const stickerOptions = document.querySelectorAll(`#${getAssetBrowserSchema('sticker').browserHost} .asset-option`);

		// Early return if no sticker layer is active
		if (!layer || layer.type !== LayerType.STICKER || !layer.stickerSourceId) {
			// Clear all selections
			stickerOptions.forEach(opt => opt.classList.remove('selected'));
			return;
		}

		// Mark the matching sticker as selected
		stickerOptions.forEach(opt => {
			// Convert both to strings for comparison (or both to numbers)
			const isSelected = String(opt.dataset.id) === String(layer.stickerSourceId);
			opt.classList.toggle('selected', isSelected);
		});
	}
};
