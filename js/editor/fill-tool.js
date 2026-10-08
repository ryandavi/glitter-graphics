'use strict';

const EDITOR_FILL_TOOL_METHODS = {
	resolveFillLayer(x, y, { create = true, deferHistory = false } = {}) {
		let layer = this.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.GLITTER_FILL) {
			layer = this.layerManager.getLayersAtPoint(x, y).find(candidate => candidate.type === LayerType.GLITTER_FILL);
			if (layer) this.layerManager.selectLayerFromCanvas(layer.id);
			else if (create && CONFIG.app.behavior.autoCreateGlitterLayer) {
				if (deferHistory) {
					layer = this.glitterManager.createLayer();
					if (layer) this.layerManager.insertLayer(layer, { suppressDesignGalleryFocus: true });
				} else layer = this.layerManager.addLayer(LayerType.GLITTER_FILL);
			}
		}
		return layer && this.canEditLayer(layer, { notify: true }) ? layer : null;
	},
	handleColorPickAction(x, y, event = null) {
		if (this.currentTool !== ToolType.GLITTER_FILL || !this.originalImage) return;
		if (!this.resolveFillLayer(x, y)) {
			this.showError('Please select or create an editable fill layer first');
			return;
		}
		this.glitterFillSelector(x, y, event);
	},
	glitterFillSelector(x, y, event) {
		const layer = this.layerManager.getActiveLayer();
		if (layer?.type !== LayerType.GLITTER_FILL) return;

		// A color pick reads the base image under the pointer, so the seed stays
		// in document px whatever the layer's transform. The selection it builds
		// is then placed by that transform like the rest of the mask.
		const pixelIndex = y * this.originalCanvas.width + x;
		const alpha = this.originalAlphaChannel[pixelIndex];
		const isTransparent = alpha < CONFIG.tools.selection.transparency.alphaThreshold;

		// 1. Config Check: Block if transparent and selection isn't allowed
		if (isTransparent && !CONFIG.tools.selection.transparency.allowTransparentSelection) {
			this.showError('Cannot select transparent pixels');
			return;
		}

		const i = pixelIndex * 4;

		// 2. Data Extraction
		// If it's transparent, we force RGB to 0 to be clean, 
		// because the 'isTransparent' flag will do the heavy lifting in the mask logic.
		const r = isTransparent ? 0 : this.originalImageData.data[i];
		const g = isTransparent ? 0 : this.originalImageData.data[i + 1];
		const b = isTransparent ? 0 : this.originalImageData.data[i + 2];

		// 3. Multi-Select Logic with Shift Key Support
		const shiftPressed = event && event.shiftKey;

		// If Shift is pressed, enable multi-select
		if (shiftPressed && !layer.settings.multiSelect) {
			layer.settings.multiSelect = true;

			// Update UI checkboxes
			const multiSelect = document.getElementById('multiSelect');
			const contextMultiSelect = document.getElementById('contextMultiSelect');
			if (multiSelect) multiSelect.checked = true;
			if (contextMultiSelect) contextMultiSelect.checked = true;

			this.updateStatus('Multi-select enabled');
		}

		// If multi-select is off (and shift wasn't pressed), clear previous selections
		const multiSelect = layer.settings.multiSelect;
		if (!multiSelect) layer.selections = [];

		// 4. Save the Selection
		layer.selections.push({
			r, g, b, x, y,
			isTransparent: isTransparent
		});

		// 5. UI & Preview Updates (Crucial: These must happen after pushing the data)
		this.saveState('Edit document'); // For Undo/Redo

		// Paint the chip/status/toolbar feedback on this frame, *before*
		// kicking off the (potentially slow) mask pipeline, so the click never
		// looks like dead air. updatePreview is deferred a frame so the browser
		// actually gets to paint the above first.
		this.updateActionButtons();
		this.updateSelectedColorsDisplay(); // To show "Transparent" or the RGB values in the sidebar
		this.updateContextToolbars();
		this.updateHelpfulMessage();
		this.updateStatus('Applying glitter…');

		this.glitterManager.markMaskRequestStart(layer.id);
		this.requestPreviewUpdate();

	},
	updateSelectedColorsDisplay() {
		const container = document.getElementById('selectedColorsDisplay');
		if (!container) return;

		const layer = this.layerManager.getActiveLayer();
		const card = container.closest('.color-selection');

		// Only show for glitter layers with selections; otherwise the card shows just
		// its "Pick a color on the canvas to add it." note.
		if (!layer || layer.type !== LayerType.GLITTER_FILL || !layer.selections || layer.selections.length === 0) {
			card?.classList.add('is-empty');
			container.innerHTML = '';
			return;
		}

		card?.classList.remove('is-empty');
		container.innerHTML = '';

		layer.selections.forEach((sel, index) => {
			const chip = document.createElement('div');
			chip.className = 'selected-color-chip';

			const swatch = document.createElement('div');
			swatch.className = 'selected-color-swatch';
			swatch.style.backgroundColor = `rgb(${sel.r}, ${sel.g}, ${sel.b})`;

			const text = document.createElement('span');
			text.textContent = `${sel.r},${sel.g},${sel.b}`;

			const removeBtn = document.createElement('button');
			removeBtn.className = 'selected-color-remove';
			removeBtn.type = 'button';
			removeBtn.textContent = '×';
			removeBtn.title = 'Remove this color selection';
			removeBtn.setAttribute('aria-label', `Remove color ${sel.r}, ${sel.g}, ${sel.b}`);
			removeBtn.onclick = () => this.removeColorSelection(index);

			chip.append(swatch, text, removeBtn);
			container.appendChild(chip);
		});
	},
	removeColorSelection(index) {
		const layer = this.layerManager.getActiveLayer();

		// Only works on glitter layers
		if (!layer || layer.type !== LayerType.GLITTER_FILL || !layer.selections) {
			return;
		}

		layer.selections.splice(index, 1);
		this.saveState('Edit document');

		if (hasMaskContent(layer)) {
			this.requestPreviewUpdate();
		} else {
			this.clearPreview();
		}

		this.updateActionButtons();
		this.updateSelectedColorsDisplay();
		this.updateContextToolbars();
		this.updateHelpfulMessage();
	},
	handleMultiSelectChange(checked) {
		const layer = this.layerManager.getActiveLayer();
		if (!layer) return;

		// Update layer directly
		layer.settings.multiSelect = checked;

		// If turning off multi-select and we have multiple selections, keep only first
		if (!checked && layer.selections && layer.selections.length > 1) {
			layer.selections = [layer.selections[0]];
		}

		// Update the count
		const contextSelectionCount = document.getElementById('contextSelectionCount');
		if (contextSelectionCount) {
			const count = layer.selections ? layer.selections.length : 0;
			contextSelectionCount.textContent = count > 1 ? count : '';
		}

		this.requestPreviewUpdate();
		this.updateSelectedColorsDisplay();
	},
	setupColorPickerContextListeners() {
		const contextThreshold = document.getElementById('contextThreshold');
		const contextThresholdValue = document.getElementById('contextThresholdValue');

		// Threshold slider: a second handle on the design panel's Threshold.
		bindSlider(contextThreshold, contextThresholdValue, {
			formatValue: (value) => String(value),
			cost: FIELDS.threshold.cost,
			onInput: (value) => {
				const threshold = document.getElementById('threshold');
				const thresholdValue = document.getElementById('thresholdValue');
				if (threshold) threshold.value = value;
				if (thresholdValue) thresholdValue.textContent = value;
				syncPropertyReverts();
			},
			apply: (value) => {
				const host = this.glitterManager.fieldHost;
				const layer = host.getLayer();
				if (!layer) return;
				const binding = LAYER_UI_CONFIG[host.type].fields.find(field => field.id === 'threshold');
				host.apply(layer, () => writeFieldValue(layer, binding, value), { live: true });
				host.afterFieldChange(layer, null, binding);
			},
			onCommit: () => this.glitterManager.fieldHost.commit()
		});


	},
	updateColorPickerControls() {
		dbg(`Updating color picker controls`);
		const layer = this.layerManager.getActiveLayer();
		if (!layer || layer.type !== LayerType.GLITTER_FILL) return;

		dbg(`Updating color picker controls for layer ${layer.id}`);

		const contextThreshold = document.getElementById('contextThreshold');
		const contextThresholdValue = document.getElementById('contextThresholdValue');
		const contextMultiSelect = document.getElementById('contextMultiSelect');
		const contextContiguous = document.getElementById('contextContiguous');
		const contextSelectionCount = document.getElementById('contextSelectionCount');

		if (contextThreshold && contextThresholdValue) {
			contextThreshold.value = layer.settings.threshold;
			contextThresholdValue.textContent = layer.settings.threshold;
		}

		if (contextMultiSelect) {
			contextMultiSelect.checked = layer.settings.multiSelect;
		}

		if (contextContiguous) {
			contextContiguous.checked = layer.settings.contiguous;
		}

		if (contextSelectionCount) {
			const count = layer.selections ? layer.selections.length : 0;
			contextSelectionCount.textContent = count > 1 ? count : '';
		}
	}
};
