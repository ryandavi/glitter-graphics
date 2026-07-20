class AutoGlitterManager {
	constructor(editor) {
		this.editor = editor;
		this.result = null;
		this.worker = null;
		this.segmentDirty = true;
		this.segmentPromise = null;
		this.analysisInFlight = false;
		this.analysisQueued = false;
		this.workerRequests = new Map();
		this.discardRequest = null;
		// Ephemeral preview batch shown on the real canvas while the Auto
		// Glitter UI is open. Layers carry `isPreview = true`, which excludes
		// them from history snapshots, the layers list, export, and project
		// save until commit. Undo/redo is disabled while a session is active
		// (HistoryManager.canUndo/canRedo) — ephemeral layers must never enter
		// a history state.
		this.session = null;
		this.bindUI();
	}

	bindUI() {
		this.ui = {
			open: document.getElementById('autoGlitterImageBtn'),
			count: document.getElementById('autoGlitterColorCount'),
			mergeDistinctness: document.getElementById('autoGlitterMergeDistinctness'),
			detail: document.getElementById('autoGlitterDetail'),
			cleanEdges: document.getElementById('autoGlitterCleanEdges'),
			cancel: document.getElementById('cancelAutoGlitterBtn'),
			create: document.getElementById('autoGlitterCreateBtn'),
			status: document.getElementById('autoGlitterStatus'),
			results: document.getElementById('autoGlitterResults'),
			capacity: document.getElementById('autoGlitterCapacity'),
			existing: document.getElementById('autoGlitterExisting'),
			existingSummary: document.getElementById('autoGlitterExistingSummary'),
			editCurrent: document.getElementById('autoGlitterEditCurrent'),
			replacePrevious: document.getElementById('autoGlitterReplacePrevious'),
			addAnother: document.getElementById('autoGlitterAddAnother'),
			paletteStyles: [...document.querySelectorAll('#autoGlitterPaletteStyle [data-value]')],
			tuneHue: document.getElementById('autoGlitterTuneHue'),
			previewModes: [...document.querySelectorAll('#autoGlitterPreviewMode [data-value]')]
		};
		this.canvasUI = {
			banner: document.getElementById('autoGlitterPreviewBanner'),
			status: document.getElementById('autoGlitterCanvasStatus'),
			exit: document.getElementById('autoGlitterPreviewExit')
		};
		initializeInlineProcessingStatus(this.canvasUI.status);

		this.ui.open?.addEventListener('click', () => this.open());
		this.ui.cancel?.addEventListener('click', () => this.requestDiscardSession());
		this.canvasUI.exit?.addEventListener('click', () => this.requestDiscardSession());
		this.ui.create?.addEventListener('click', () => this.createLayers());
		document.getElementById('galleryPickerStripDone')?.addEventListener('click', () => {
			if (this.hasActivePickerSession()) this.closePickerSession(true);
		});
		this.ui.paletteStyles.forEach((button) => button.addEventListener('click', () => {
			if (button.dataset.value === this.paletteStyle) return;
			this.setPaletteStyle(button.dataset.value);
			this.ui.mergeDistinctness.value = CONFIG.tools.autoGlitter.paletteStyles[this.paletteStyle].mergeDistinctness;
			this.updateControlReadout(this.ui.mergeDistinctness);
			this.scheduleReduce();
		}));
		[this.ui.count, this.ui.mergeDistinctness, this.ui.detail].forEach((input) => input?.addEventListener('input', () => {
			this.updateControlReadout(input);
			this.applyCapacity();
			this.scheduleReduce();
		}));
		[this.ui.count, this.ui.mergeDistinctness, this.ui.detail].forEach((input) => {
			document.getElementById(`reset${input.id.charAt(0).toUpperCase()}${input.id.slice(1)}`)?.addEventListener('click', () => {
				input.value = CONFIG.ui.sliders[input.id].value;
				this.updateControlReadout(input);
				this.applyCapacity();
				this.scheduleReduce();
			});
		});
		[this.ui.tuneHue, this.ui.cleanEdges].forEach((input) => input?.addEventListener('change', () => this.scheduleReduce()));
		this.ui.previewModes.forEach((button) => button.addEventListener('click', () => {
			const mode = button.dataset.value;
			this.ui.previewModes.forEach((option) => {
				const active = option.dataset.value === mode;
				option.classList.toggle('active', active);
				option.setAttribute('aria-pressed', active ? 'true' : 'false');
			});
			this.setSessionPreviewMode(mode);
		}));
		[this.ui.editCurrent, this.ui.replacePrevious, this.ui.addAnother].forEach((input) => input?.addEventListener('change', () => {
			if (!input.checked) return;
			this.changePreviousMode();
		}));
		window.addEventListener('layerChanged', () => {
			if (!this.session || this.editor.layerManager.activeLayerId === this.session.baseLayerId) return;
			const baseLayerId = this.session.baseLayerId;
			this.requestDiscardSession().then((discarded) => {
				if (!discarded && this.session && baseLayerId != null) this.editor.layerManager.setActiveLayer(baseLayerId);
			});
		});
	}

	open() {
		const availability = this.editor.baseBackgroundManager?.getAutoGlitterAvailability();
		if (availability && !availability.available) {
			this.editor.showError(availability.message);
			return;
		}
		if (!this.editor.originalImageData) {
			this.editor.showError('Choose a Base Image before using Auto Glitter');
			return;
		}

		if (this.session) this.endSessionUI();
		this.previousBatch = this.getLatestBatch();
		const editedCount = this.previousBatch ? this.getEditedLayerCount(this.previousBatch) : 0;
		this.ui.existing.hidden = !this.previousBatch;
		if (this.previousBatch) {
			const count = this.previousBatch.layers.length;
			this.ui.existingSummary.textContent = editedCount > 0
				? `${editedCount === 1 ? 'This set has been changed' : `${editedCount} layers in this set have been changed`}. Edit preserves its visible regions; Replace discards those edits.`
				: `Edit the current ${count}-layer set, replace it, or keep it and add another.`;
			this.ui.existing.classList.toggle('has-warning', editedCount > 0);
			this.ui.editCurrent.checked = true;
		}

		const limits = CONFIG.tools.autoGlitter.limits;
		this.ui.count.min = limits.minColorLayers;
		this.ui.count.max = limits.maxColorLayers;
		this.applySessionSettings(this.previousBatch?.layers[0]?.autoGlitter?.sessionState);
		[this.ui.count, this.ui.mergeDistinctness, this.ui.detail].forEach((input) => this.updateControlReadout(input));
		this.clearResult();
		this.startSession();
		this.segmentDirty = true;
		this.showSessionPanel();
		if (this.previousBatch) this.loadPreviousBatch();
		else this.analyze();
	}

	applySessionSettings(saved) {
		const defaults = CONFIG.tools.autoGlitter.defaults;
		const paletteStyle = saved && CONFIG.tools.autoGlitter.paletteStyles[saved.paletteStyle]
			? saved.paletteStyle
			: defaults.paletteStyle;
		this.ui.count.value = saved ? saved.colorCount : defaults.colorLayers;
		this.setPaletteStyle(paletteStyle);
		this.ui.mergeDistinctness.value = saved
			? saved.mergeDistinctness
			: CONFIG.tools.autoGlitter.paletteStyles[paletteStyle].mergeDistinctness;
		this.ui.detail.value = saved ? saved.detail : defaults.detail;
		this.ui.cleanEdges.checked = saved ? saved.cleanEdges : defaults.cleanEdges;
		this.ui.tuneHue.checked = saved ? saved.tuneHue : defaults.tuneGlitterHue;
	}

	captureSessionSettings() {
		return {
			version: 1,
			colorCount: Number(this.ui.count.value),
			paletteStyle: this.paletteStyle,
			mergeDistinctness: Number(this.ui.mergeDistinctness.value),
			detail: Number(this.ui.detail.value),
			cleanEdges: this.ui.cleanEdges.checked,
			tuneHue: this.ui.tuneHue.checked
		};
	}

	setPaletteStyle(style) {
		if (!CONFIG.tools.autoGlitter.paletteStyles[style]) return;
		this.paletteStyle = style;
		this.ui.paletteStyles.forEach((button) => {
			const active = button.dataset.value === style;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', active ? 'true' : 'false');
		});
	}

	updateControlReadout(input) {
		const value = document.getElementById(`${input.id}Value`);
		if (!value) return;
		value.textContent = `${input.value}${CONFIG.ui.sliders[input.id]?.unit || ''}`;
	}

	scheduleReduce() {
		if (!this.session) return;
		if (this.isEditingPrevious()) this.ui.replacePrevious.checked = true;
		// Invalidate the running result immediately, but debounce the replacement.
		// analyze() coalesces any timer that catches an in-flight worker request.
		this.analysisRunId = (this.analysisRunId || 0) + 1;
		this.ui.create.disabled = true;
		this.setCanvasPreviewState(true, 'Updating preview…');
		clearTimeout(this.reduceTimer);
		this.reduceTimer = setTimeout(() => {
			this.reduceTimer = null;
			this.analyze();
		}, CONFIG.tools.autoGlitter.timing.reduceThrottleMs);
	}

	getLatestBatch() {
		const batches = new Map();
		this.editor.layers.forEach((layer) => {
			const metadata = layer.autoGlitter;
			if (!metadata?.batchId) return;
			const batch = batches.get(metadata.batchId) || { id: metadata.batchId, createdAt: metadata.createdAt || 0, layers: [] };
			batch.createdAt = Math.max(batch.createdAt, metadata.createdAt || 0);
			batch.layers.push(layer);
			batches.set(metadata.batchId, batch);
		});
		return [...batches.values()].sort((left, right) => right.createdAt - left.createdAt)[0] || null;
	}

	getEditedLayerCount(batch) {
		if (!batch?.layers.length) return 0;
		const expectedSize = batch.layers[0].autoGlitter?.batchSize || batch.layers.length;
		let edited = batch.layers.filter((layer) => JSON.stringify(this.captureGeneratedState(layer)) !== layer.autoGlitter?.generatedState).length;
		if (batch.layers.length !== expectedSize) edited += Math.abs(expectedSize - batch.layers.length);
		return edited;
	}

	captureGeneratedState(layer) {
		return {
			maskVersion: layer.maskVersion || 0,
			selectedGlitterId: layer.selectedGlitterId,
			name: layer.name,
			visible: layer.visible,
			locked: layer.locked,
			fill: layer.fill ? JSON.parse(JSON.stringify(layer.fill)) : null,
			settings: layer.settings ? JSON.parse(JSON.stringify(layer.settings)) : null
		};
	}

	shouldReplacePrevious() {
		return Boolean(this.previousBatch && (this.ui.editCurrent.checked || this.ui.replacePrevious.checked));
	}

	isEditingPrevious() {
		return Boolean(this.previousBatch && this.ui.editCurrent.checked);
	}

	getAvailableSlots() {
		// Ephemeral session layers don't count: they are reused/replaced by the
		// batch being sized, not competition for its slots.
		const occupied = this.editor.layers.filter((layer) => !layer.isPreview).length;
		const openSlots = CONFIG.app.limits.maxLayers - occupied;
		return openSlots + (this.shouldReplacePrevious() ? this.previousBatch.layers.length : 0);
	}

	applyCapacity() {
		const limits = CONFIG.tools.autoGlitter.limits;
		const available = this.getAvailableSlots();
		const maximum = Math.min(limits.maxColorLayers, available);
		this.ui.count.max = Math.max(limits.minColorLayers, maximum);
		if (Number(this.ui.count.value) > maximum && maximum >= limits.minColorLayers) this.ui.count.value = maximum;
		this.ui.capacity.textContent = available >= limits.minColorLayers
			? (this.isEditingPrevious()
				? `Up to ${maximum} color layers can remain in the edited set.`
				: `Up to ${maximum} color layers can be created with this choice.`)
			: `At least ${limits.minColorLayers} open layer slots are needed. This choice leaves ${available}.`;
		const creatable = this.result && this.getActivePaletteIndices().some((index) => !this.result.palette[index].skipped);
		this.ui.create.disabled = available < limits.minColorLayers || !creatable;
	}

	cancelAnalysis() {
		this.analysisRunId = (this.analysisRunId || 0) + 1;
		clearTimeout(this.reduceTimer);
		this.reduceTimer = null;
		this.analysisQueued = false;
	}

	requestDiscardSession() {
		if (!this.session) return Promise.resolve(true);
		if (this.discardRequest) return this.discardRequest;
		const activeSession = this.session;
		const editingPrevious = this.isEditingPrevious();
		this.discardRequest = this.editor.confirmAction({
			title: editingPrevious ? 'Discard Auto Glitter Changes?' : 'Discard Auto Glitter Preview?',
			message: editingPrevious
				? 'Leaving Auto Glitter will discard these changes and keep the current set as it was.'
				: 'The preview layers have not been created yet. Leaving Auto Glitter will discard them.',
			confirmLabel: editingPrevious ? 'Discard Changes' : 'Discard Preview',
			cancelLabel: 'Keep Editing'
		}).then((confirmed) => {
			if (confirmed && this.session === activeSession) this.endSessionUI();
			return confirmed;
		}).finally(() => {
			this.discardRequest = null;
		});
		return this.discardRequest;
	}

	endSessionUI(options = {}) {
		const previousShowAllLayers = options.previousShowAllLayers ?? this.session?.previousShowAllLayers;
		const previousTool = options.previousTool ?? this.session?.previousTool;
		this.cancelAnalysis();
		this.worker?.terminate();
		this.worker = null;
		this.segmentPromise = null;
		this.segmentDirty = true;
		this.workerRequests.forEach(({ reject }) => reject(new Error('Analysis cancelled')));
		this.workerRequests.clear();
		this.closePickerSession(false);
		this.canvasUI.banner.hidden = true;
		this.canvasUI.banner.classList.remove('visible');
		this.setCanvasPreviewState(false);
		if (options.cancel !== false) this.cancelSession();
		if (previousShowAllLayers === false && this.editor.showAllLayers) this.editor.togglePreview();
		const baseLayer = this.editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
		const activeLayer = this.editor.layerManager.getActiveLayer();
		const targetLayer = activeLayer && !activeLayer.isPreview ? activeLayer : baseLayer;
		this.editor.updateSidePanelUI(targetLayer);
		if (previousTool && previousTool !== this.editor.currentTool) this.editor.setTool(previousTool, { persist: false });
		else this.editor.updateContextToolbars();
		this.editor.updateActionButtons();
		if (this.editor.mobileManager?.isMobile && targetLayer) this.editor.mobileManager.prepareSettings(targetLayer);
	}

	clearResult() {
		this.result = null;
		this.closePickerSession(false);
		this.ui.results.replaceChildren();
		this.ui.results.hidden = true;
		this.ui.create.disabled = true;
		this.ui.create.textContent = 'Create Layers';
		this.ui.status.textContent = 'Finding the image\'s distinct colors…';
	}

	changePreviousMode() {
		if (!this.session || !this.previousBatch) return;
		this.cancelAnalysis();
		this.closePickerSession(false);
		[...this.session.layers].forEach((layer) => this.removeSessionLayer(layer));
		this.session.layers = [];
		this.session.maskSignatures.clear();
		this.clearResult();
		this.syncPreviousBatchVisibility();
		this.editor.updatePreview();
		if (this.isEditingPrevious()) {
			this.loadPreviousBatch();
			return;
		}
		this.applyCapacity();
		this.analyze();
	}

	loadPreviousBatch() {
		if (!this.session || !this.previousBatch?.layers.length) return;
		this.cancelAnalysis();
		this.clearResult();
		if (!this.previousBatch.layers[0].autoGlitter?.sessionState) {
			const limits = CONFIG.tools.autoGlitter.limits;
			this.ui.count.value = Math.max(limits.minColorLayers, Math.min(limits.maxColorLayers, this.previousBatch.layers.length));
			this.updateControlReadout(this.ui.count);
		}
		const { width, height, data } = this.editor.originalImageData;
		const labels = new Uint8Array(width * height);
		labels.fill(255);
		const palette = this.previousBatch.layers.map((layer) => {
			const [r, g, b] = this.parseLayerColor(layer.fill?.color);
			return {
				r, g, b,
				count: 0,
				selectedGlitterId: layer.selectedGlitterId,
				selectedColorAdjust: layer.settings?.colorAdjust ? JSON.parse(JSON.stringify(layer.settings.colorAdjust)) : null,
				sourceLayer: layer
			};
		});
		this.previousBatch.layers.forEach((layer, paletteIndex) => {
			const mask = this.editor.maskCompositor.getMaskData(layer);
			for (let pixelIndex = 0; pixelIndex < labels.length; pixelIndex++) {
				if (mask[pixelIndex] >= CONFIG.tools.selection.transparency.alphaThreshold) labels[pixelIndex] = paletteIndex;
			}
		});
		let visiblePixelCount = 0;
		for (let pixelIndex = 0, offset = 3; pixelIndex < labels.length; pixelIndex++, offset += 4) {
			if (data[offset] >= CONFIG.tools.autoGlitter.analysis.alphaThreshold) visiblePixelCount++;
			const label = labels[pixelIndex];
			if (label !== 255) palette[label].count++;
		}
		this.result = { labels, palette, visiblePixelCount };
		this.analysisRunId = (this.analysisRunId || 0) + 1;
		this.renderReviewResults();
		this.ui.status.textContent = 'Editing the current Auto Glitter set. Palette or Advanced changes will rebuild it from the Base Image.';
		this.setCanvasPreviewState(false);
		this.applyCapacity();
	}

	parseLayerColor(value) {
		const color = String(value || '').trim();
		const rgb = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
		if (rgb) return rgb.slice(1, 4).map((component) => Math.max(0, Math.min(255, Math.round(Number(component)))));
		const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
		if (hex) {
			const expanded = hex.length === 3 ? hex.split('').map((digit) => digit + digit).join('') : hex;
			return [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16));
		}
		return [0, 0, 0];
	}

	async analyze() {
		if (!this.editor.originalImageData || !this.session) return;
		if (this.analysisInFlight) {
			this.analysisQueued = true;
			return;
		}
		this.analysisInFlight = true;
		this.analysisQueued = false;
		const limits = CONFIG.tools.autoGlitter.limits;
		const available = this.getAvailableSlots();
		const count = Math.max(limits.minColorLayers, Math.min(
			Math.round(Number(this.ui.count.value)) || CONFIG.tools.autoGlitter.defaults.colorLayers,
			limits.maxColorLayers,
			available
		));
		this.ui.count.value = count;
		this.updateControlReadout(this.ui.count);
		const analysisId = (this.analysisRunId || 0) + 1;
		this.analysisRunId = analysisId;
		this.setCanvasPreviewState(true, this.segmentDirty ? 'Analyzing image…' : 'Updating preview…');
		this.ui.status.textContent = this.segmentDirty ? 'Finding distinct colors…' : 'Updating color matches…';
		const swatches = this.editor.glitterManager.getAllContent()
			.filter(glitter => glitter.isActive !== false && !glitter.hasTransparency && glitter.colorCodes?.length)
			.map(glitter => ({ id: glitter.id, colors: glitter.colorCodes }));
		let previewUpdated = false;

		try {
			await this.ensureSegmented();
			if (analysisId !== this.analysisRunId) return;
			const result = await this.requestWorker('reduce', { colorCount: count, options: this.getWorkerOptions(), swatches });
			if (analysisId !== this.analysisRunId) return;
			this.result = result;
			this.renderReviewResults();
			previewUpdated = true;
		} catch (error) {
			if (analysisId !== this.analysisRunId) return;
			this.ui.status.textContent = error.message;
			this.setCanvasPreviewState(false, error.message);
		} finally {
			if (analysisId === this.analysisRunId) {
				this.applyCapacity();
				if (previewUpdated) this.setCanvasPreviewState(false);
			}
			this.analysisInFlight = false;
			if (this.analysisQueued && !this.reduceTimer && this.session) {
				this.analysisQueued = false;
				this.analyze();
			}
		}
	}

	setCanvasPreviewState(processing, message = null) {
		if (!this.canvasUI?.banner) return;
		this.canvasUI.banner.classList.toggle('is-processing', processing);
		this.canvasUI.banner.setAttribute('aria-busy', processing ? 'true' : 'false');
		setInlineProcessingStatus(this.canvasUI.status, {
			active: processing,
			error: !processing && Boolean(message),
			label: message
		});
	}

	getWorkerOptions() {
		return {
			...CONFIG.tools.autoGlitter.analysis,
			...CONFIG.tools.autoGlitter.paletteStyles[this.paletteStyle],
			mergeDistinctness: Number(this.ui.mergeDistinctness.value),
			tuneGlitterHue: this.ui.tuneHue.checked,
			maxSamples: CONFIG.tools.autoGlitter.limits.maxSamples,
			cleanup: {
				aliasDissolve: { ...CONFIG.tools.autoGlitter.cleanup.aliasDissolve, enabled: this.ui.cleanEdges.checked },
				despeckle: { ...CONFIG.tools.autoGlitter.cleanup.despeckle, absMin: Number(this.ui.detail.value) }
			}
		};
	}

	ensureWorker() {
		if (this.worker) return;
		this.worker = new Worker('js/workers/auto-glitter.worker.js?v=11');
		this.worker.onmessage = ({ data }) => {
			const pending = this.workerRequests.get(data.requestId);
			if (!pending) return;
			this.workerRequests.delete(data.requestId);
			data.type === 'error' ? pending.reject(new Error(data.error)) : pending.resolve(data);
		};
		this.worker.onerror = () => {
			this.workerRequests.forEach(({ reject }) => reject(new Error('The image could not be analyzed.')));
			this.workerRequests.clear();
			this.worker?.terminate();
			this.worker = null;
			this.segmentDirty = true;
		};
	}

	requestWorker(type, payload, transfer = []) {
		this.ensureWorker();
		const requestId = (this.workerRequestId || 0) + 1;
		this.workerRequestId = requestId;
		return new Promise((resolve, reject) => {
			this.workerRequests.set(requestId, { resolve, reject });
			this.worker.postMessage({ type, requestId, ...payload }, transfer);
		});
	}

	ensureSegmented() {
		if (!this.segmentDirty) return Promise.resolve();
		if (this.segmentPromise) return this.segmentPromise;
		const source = this.editor.originalImageData;
		const pixels = source.data.slice();
		this.segmentPromise = this.requestWorker('segment', {
			pixels: pixels.buffer,
			width: source.width,
			height: source.height,
			options: this.getWorkerOptions()
		}, [pixels.buffer]).then(() => { this.segmentDirty = false; }).finally(() => { this.segmentPromise = null; });
		return this.segmentPromise;
	}

	renderReviewResults() {
		const template = document.getElementById('tpl-auto-glitter-match');
		const glitters = this.editor.glitterManager.getAllContent().filter(glitter => glitter.isActive !== false && !glitter.hasTransparency);
		this.ui.results.replaceChildren();
		const activeIndices = this.getActivePaletteIndices();
		const orderedIndices = activeIndices.flatMap((root) => [
			root,
			...this.result.palette.map((_color, index) => index).filter((index) =>
				index !== root
				&& this.result.palette[index].manualMergeTarget != null
				&& this.resolveManualMergeTarget(index) === root)
		]);

		orderedIndices.forEach((index) => {
			const color = this.result.palette[index];
			if (color.selectedGlitterId == null) {
				color.selectedGlitterId = color.suggestedGlitterId ?? glitters[0]?.id ?? null;
				color.selectedColorAdjust = color.suggestedColorAdjust ? { ...color.suggestedColorAdjust } : null;
			}
			const row = template.content.firstElementChild.cloneNode(true);
			row.dataset.paletteIndex = index;
			row.id = `autoGlitterMatch${index}`;
			row.querySelector('.auto-glitter-source-color').style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
			row.querySelector('.auto-glitter-color-name').textContent = `Color ${index + 1}`;
			row.querySelector('.auto-glitter-coverage').textContent = `${this.formatCoverage(color.count)} of image`;
			this.updateMatchThumbnail(row, color);
			const handle = row.querySelector('.auto-glitter-drag-handle');
			const skip = row.querySelector('.auto-glitter-skip');
			const choice = row.querySelector('.auto-glitter-choice');
			const unmerge = row.querySelector('.auto-glitter-unmerge');
			if (color.manualMergeTarget != null) {
				row.classList.add('is-merged');
				const targetIndex = this.resolveManualMergeTarget(index);
				row.querySelector('.auto-glitter-coverage').textContent = `${this.formatCoverage(color.count)} · combined with Color ${targetIndex + 1}`;
				handle.hidden = true;
				skip.hidden = true;
				choice.hidden = true;
				unmerge.hidden = false;
			} else {
				handle.setAttribute('aria-label', `Drag Color ${index + 1} onto another color to combine them`);
				handle.disabled = activeIndices.length <= 1;
				this.bindMergeHandle(handle, row, index);
				this.bindMergeRow(row, index, activeIndices.length <= 1);
				choice.setAttribute('aria-label', `Choose glitter for Color ${index + 1}`);
				choice.addEventListener('click', () => this.openGlitterPicker(index));
				row.classList.toggle('is-skipped', Boolean(color.skipped));
				skip.classList.toggle('hidden', Boolean(color.skipped));
				skip.setAttribute('aria-label', color.skipped ? `Include Color ${index + 1}` : `Skip Color ${index + 1}`);
				skip.setAttribute('aria-pressed', color.skipped ? 'true' : 'false');
				skip.querySelector('use').setAttribute('href', color.skipped ? '#icon-eye-slash' : '#icon-eye');
				skip.addEventListener('click', () => this.setColorSkipped(index, !color.skipped));
			}
			unmerge.addEventListener('click', () => this.separateColor(index));
			this.ui.results.appendChild(row);
		});

		this.ui.results.hidden = false;
		this.reconcileSession();
		const actual = activeIndices.filter((index) => !this.result.palette[index].skipped).length;
		this.ui.create.disabled = !actual;
		this.ui.create.textContent = this.isEditingPrevious()
			? 'Apply Changes'
			: `Create ${actual} ${actual === 1 ? 'Layer' : 'Layers'}`;
		const hasManualMerges = this.result.palette.some((color) => color.manualMergeTarget != null);
		if (this.isEditingPrevious()) {
			this.ui.status.textContent = `${actual} ${actual === 1 ? 'layer remains' : 'layers remain'} in the current set. Review the matches, then apply your changes.`;
		} else {
			this.ui.status.textContent = hasManualMerges
				? `${actual} ${actual === 1 ? 'layer' : 'layers'} will be created. Combined regions remain fully covered.`
				: (actual === Number(this.ui.count.value)
					? 'Review the glitter matches, then create the layers.'
					: `Close shades were combined. ${actual} ${actual === 1 ? 'layer' : 'layers'} will be created.`);
		}
	}

	formatCoverage(count) {
		const percent = count / this.result.visiblePixelCount * 100;
		return `${percent < 1 ? percent.toFixed(1) : Math.round(percent)}%`;
	}

	openGlitterPicker(index) {
		const color = this.result?.palette[index];
		if (!this.session || !color || color.manualMergeTarget != null) return;
		this.ui.results.querySelector(`[data-palette-index="${index}"] .auto-glitter-choice`)?.setAttribute('aria-expanded', 'true');
		pickerOpenSession(this, { paletteIndex: index }, {
			refresh: () => this.updatePickerStrip(),
			reveal: () => revealAssetBrowser(this.editor, this.editor.glitterManager, color.selectedGlitterId)
		});
	}

	hasActivePickerSession() {
		return Boolean(this.session && this.pickerSession && this.result?.palette[this.pickerSession.paletteIndex]);
	}

	getPickerGlitterId() {
		if (!this.hasActivePickerSession()) return null;
		return this.result.palette[this.pickerSession.paletteIndex].selectedGlitterId;
	}

	updatePickerStrip() {
		const armed = this.hasActivePickerSession();
		const index = this.pickerSession?.paletteIndex;
		renderPickerStrip({
			ownsStrip: true,
			visible: armed,
			armed,
			title: armed ? `Choosing glitter for Color ${index + 1}` : '',
			detail: 'Auto Glitter preview'
		});
	}

	selectPickerGlitter(id) {
		if (!this.hasActivePickerSession()) return;
		const glitter = this.editor.glitterManager.getItemById(id);
		if (!glitter || glitter.isActive === false) return;
		if (glitter.hasTransparency) {
			this.editor.showError('Choose a glitter without transparency for Auto Glitter');
			return;
		}
		const color = this.result.palette[this.pickerSession.paletteIndex];
		color.selectedGlitterId = glitter.id;
		color.selectedColorAdjust = null;
		this.renderReviewResults();
		this.editor.glitterManager.updateSelection();
	}

	closePickerSession(returnToPanel = false) {
		const index = this.pickerSession?.paletteIndex;
		pickerCloseSession(this, { refresh: () => this.updatePickerStrip() });
		if (!returnToPanel) return;
		returnFromPickerToProperties(this.editor, {
			section: 'autoGlitterSettings',
			focusId: index == null ? null : `autoGlitterMatch${index}`
		});
	}

	bindMergeHandle(handle, row, index) {
		handle.addEventListener('pointerdown', (event) => {
			if (handle.disabled || event.button !== 0) return;
			this.mergeDrag = { pointerId: event.pointerId, sourceIndex: index, sourceRow: row, targetRow: null, startX: event.clientX, startY: event.clientY };
			handle.setPointerCapture?.(event.pointerId);
			event.preventDefault();
		});
		handle.addEventListener('pointermove', (event) => this.moveMergeDrag(event));
		handle.addEventListener('pointerup', (event) => this.endMergeDrag(event));
		handle.addEventListener('pointercancel', (event) => this.endMergeDrag(event, true));
	}

	bindMergeRow(row, index, disabled) {
		row.draggable = !disabled;
		row.addEventListener('pointerdown', (event) => {
			row.mergeDragBlocked = Boolean(event.target.closest('button'));
		});
		row.addEventListener('pointerup', () => { row.mergeDragBlocked = false; });
		row.addEventListener('pointercancel', () => { row.mergeDragBlocked = false; });
		row.addEventListener('dragstart', (event) => {
			if (disabled || row.mergeDragBlocked) {
				event.preventDefault();
				return;
			}
			this.nativeMergeSourceIndex = index;
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(index));
			row.classList.add('is-dragging');
		});
		row.addEventListener('dragover', (event) => {
			if (this.nativeMergeSourceIndex == null || this.nativeMergeSourceIndex === index) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = 'move';
			row.classList.add('is-merge-target');
		});
		row.addEventListener('dragleave', (event) => {
			if (!row.contains(event.relatedTarget)) row.classList.remove('is-merge-target');
		});
		row.addEventListener('drop', (event) => {
			event.preventDefault();
			const sourceIndex = this.nativeMergeSourceIndex;
			this.clearNativeMergeDrag();
			if (sourceIndex != null) this.combineColors(sourceIndex, index);
		});
		row.addEventListener('dragend', () => this.clearNativeMergeDrag());
	}

	clearNativeMergeDrag() {
		this.nativeMergeSourceIndex = null;
		this.ui.results.querySelectorAll('.is-dragging, .is-merge-target').forEach((row) => {
			row.classList.remove('is-dragging', 'is-merge-target');
		});
	}

	moveMergeDrag(event) {
		const drag = this.mergeDrag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.sourceRow.classList.add('is-dragging');
		const target = document.elementsFromPoint(event.clientX, event.clientY).find((element) =>
			element.classList?.contains('auto-glitter-match')
			&& !element.classList.contains('is-merged')
			&& element !== drag.sourceRow
		);
		if (drag.targetRow !== target) {
			drag.targetRow?.classList.remove('is-merge-target');
			drag.targetRow = target || null;
			drag.targetRow?.classList.add('is-merge-target');
		}
		event.preventDefault();
	}

	endMergeDrag(event, cancelled = false) {
		const drag = this.mergeDrag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		drag.sourceRow.classList.remove('is-dragging');
		drag.targetRow?.classList.remove('is-merge-target');
		if (!cancelled && drag.targetRow) this.combineColors(drag.sourceIndex, Number(drag.targetRow.dataset.paletteIndex));
		this.mergeDrag = null;
	}

	getActivePaletteIndices() {
		return this.result?.palette
			.map((_color, index) => index)
			.filter((index) => this.result.palette[index].manualMergeTarget == null) || [];
	}

	resolveManualMergeTarget(index) {
		const visited = new Set();
		let current = index;
		while (this.result.palette[current]?.manualMergeTarget != null && !visited.has(current)) {
			visited.add(current);
			current = this.result.palette[current].manualMergeTarget;
		}
		return current;
	}

	combineColors(sourceIndex, targetIndex) {
		if (sourceIndex === targetIndex || this.result.palette[targetIndex]?.manualMergeTarget != null) return;
		this.result.palette[sourceIndex].manualMergeTarget = targetIndex;
		this.closePickerSession(false);
		this.renderReviewResults();
	}

	separateColor(index) {
		delete this.result.palette[index].manualMergeTarget;
		this.renderReviewResults();
	}

	updateMatchThumbnail(row, color) {
		const glitter = this.editor.glitterManager.getAllContent().find(item => String(item.id) === String(color.selectedGlitterId));
		const image = row.querySelector('img');
		image.src = glitter?.thumbnailUrl || glitter?.url || '';
		image.alt = '';
		image.style.filter = buildCssColorFilter(color.selectedColorAdjust);
		const hue = color.selectedColorAdjust?.hue || 0;
		const detail = hue ? `, hue ${hue > 0 ? '+' : ''}${hue}°` : '';
		row.querySelector('.auto-glitter-choice').title = `${glitter?.name || 'Glitter'}${detail}`;
	}

	// ===== EPHEMERAL PREVIEW SESSION =====

	startSession() {
		const baseLayer = this.editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
		const previousShowAllLayers = this.editor.showAllLayers;
		if (!this.editor.showAllLayers) this.editor.togglePreview();
		this.session = {
			previewMode: 'glitter',
			previousTool: this.editor.currentTool,
			layers: [],
			hiddenPrevious: null,
			maskSignatures: new Map(),
			baseLayerId: baseLayer?.id || null,
			previousShowAllLayers,
			previousActiveLayerId: this.editor.layerManager.activeLayerId,
			previousSelectedLayerIds: [...this.editor.layerManager.selectedLayerIds]
		};
		this.editor.historyManager.updateButtons();
		this.editor.setTool(ToolType.HAND, { persist: false });
		this.editor.updateActionButtons();
	}

	showSessionPanel() {
		const baseLayer = this.editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
		this.editor.updateSidePanelUI(baseLayer);
		this.editor.updateContextToolbars();
		this.editor.setCollapsibleSectionOpen?.('autoGlitterSettings', true, true);
		this.canvasUI.banner.hidden = false;
		this.canvasUI.banner.classList.add('visible');
		this.setCanvasPreviewState(true, 'Analyzing image…');
		if (this.editor.mobileManager?.isMobile) {
			this.editor.mobileManager.prepareSettings(baseLayer, { keys: LAYER_UI_CONFIG.AUTO_GLITTER.mobileSettingsSections, preserveDrawer: true });
			this.editor.mobileManager.openDrawer('edit');
		}
	}

	isSessionActive() {
		return Boolean(this.session);
	}

	allowsPreviewTool(tool) {
		return toolAllowedByAccess(tool, CONFIG.tools.autoGlitter.previewToolAccess);
	}

	handleCanvasSelect(x, y) {
		if (!this.session) return false;
		if (this.session.previewMode !== 'glitter') {
			this.editor.updateStatus('Switch the Auto Glitter preview to Glitter to choose a match from the canvas');
			return true;
		}

		const layer = [...this.session.layers].reverse().find((candidate) =>
			candidate.visible && this.editor.layerManager.isPixelInLayerSelection(candidate, x, y)
		);
		if (!layer || layer._autoGlitterRoot == null) {
			this.editor.updateStatus('No Auto Glitter match at this location');
			return true;
		}

		const index = layer._autoGlitterRoot;
		this.openGlitterPicker(index);
		this.editor.updateStatus(`Choosing glitter for Color ${index + 1}`);
		return true;
	}

	// 'glitter' shows the batch as built, 'flat' swaps each fill slot to its
	// solid palette color (the old posterized view, on the real canvas),
	// 'original' hides the batch.
	setSessionPreviewMode(mode) {
		if (!this.session || this.session.previewMode === mode) return;
		this.session.previewMode = mode;
		this.reconcileSession();
	}

	// Excludes a color from layer creation; its preview layer hides live.
	setColorSkipped(paletteIndex, skipped) {
		if (!this.result) return;
		const root = this.resolveManualMergeTarget(paletteIndex);
		this.result.palette[root].skipped = Boolean(skipped);
		this.renderReviewResults();
	}

	// Sync the ephemeral batch to the current analysis result. Reuses layer
	// objects positionally (recreating one restarts its GIF and drops its mask
	// for a frame — the no-flicker rule); only masks whose membership actually
	// changed are rewritten.
	reconcileSession() {
		if (!this.session || !this.result) return;
		const palette = this.result.palette;
		const manualRoots = palette.map((_color, index) => this.resolveManualMergeTarget(index));
		const roots = this.getActivePaletteIndices();
		this.syncPreviousBatchVisibility();

		while (this.session.layers.length > roots.length) {
			this.removeSessionLayer(this.session.layers.pop());
		}

		const glitters = this.editor.glitterManager.getAllContent();
		const baseIndex = this.editor.layers.findIndex((layer) => layer.type === LayerType.BASE_IMAGE);
		roots.forEach((rootIndex, position) => {
			let layer = this.session.layers[position];
			if (!layer) {
				layer = this.editor.glitterManager.createLayer({ skipLimitCheck: true });
				const sourceLayer = palette[rootIndex].sourceLayer;
				if (sourceLayer) {
					layer.settings = JSON.parse(JSON.stringify(sourceLayer.settings));
					layer.settings.feather = 0;
					layer.settings.invert = false;
					layer.fill = JSON.parse(JSON.stringify(sourceLayer.fill));
					layer.name = sourceLayer.name;
					layer._autoGlitterSourceVisible = sourceLayer.visible;
					layer._autoGlitterSourceLocked = sourceLayer.locked;
				}
				layer.isPreview = true;
				layer.settings.feather = 0;
				this.editor.layers.splice(baseIndex + 1 + position, 0, layer);
				this.session.layers[position] = layer;
			}
			const color = palette[rootIndex];
			const glitter = glitters.find((item) => String(item.id) === String(color.selectedGlitterId));
			layer._autoGlitterRoot = rootIndex;
			layer.selectedGlitterId = glitter?.id ?? color.selectedGlitterId;
			layer.name = color.sourceLayer?.name || glitter?.name || `Color ${rootIndex + 1}`;
			layer.settings.colorAdjust = color.selectedColorAdjust ? normalizeColorAdjust(color.selectedColorAdjust) : null;
			layer.fill.color = `rgb(${color.r}, ${color.g}, ${color.b})`;
			layer.fill.mode = this.session.previewMode === 'flat' ? 'solid' : 'glitter';
			layer.visible = this.session.previewMode !== 'original' && !color.skipped;
			this.writeSessionMask(layer, rootIndex, manualRoots);
		});
		this.editor.updatePreview();
	}

	writeSessionMask(layer, rootIndex, manualRoots) {
		const members = [];
		for (let index = 0; index < manualRoots.length; index++) {
			if (manualRoots[index] === rootIndex) members.push(index);
		}
		// Masks depend on the labels array (one per analysis) + which palette
		// entries fold into this root — skip the full-canvas rewrite otherwise.
		const signature = `${this.analysisRunId}:${members.join(',')}`;
		if (this.session.maskSignatures.get(layer.id) === signature) return;

		const { width, height, data } = this.editor.originalImageData;
		const labels = this.result.labels;
		const memberSet = new Uint8Array(manualRoots.length);
		members.forEach((index) => { memberSet[index] = 1; });
		const paint = this.editor.glitterManager.ensurePaintMask(layer.id);
		const context = paint.add.getContext('2d', { willReadFrequently: true });
		const mask = context.createImageData(width, height);
		for (let pixelIndex = 0, offset = 0; pixelIndex < labels.length; pixelIndex++, offset += 4) {
			const label = labels[pixelIndex];
			if (label === 255 || !memberSet[label]) continue;
			mask.data[offset] = 255;
			mask.data[offset + 1] = 255;
			mask.data[offset + 2] = 255;
			mask.data[offset + 3] = data[offset + 3];
		}
		context.putImageData(mask, 0, 0);
		this.editor.glitterManager.markPaintTransient(layer);
		this.session.maskSignatures.set(layer.id, signature);
	}

	// Editing or replacing previews the result by hiding the old batch;
	// visibility is restored on cancel or when switching back to "Keep and add".
	syncPreviousBatchVisibility() {
		const replace = this.shouldReplacePrevious();
		if (replace && !this.session.hiddenPrevious) {
			this.session.hiddenPrevious = this.previousBatch.layers.map((layer) => ({ layer, visible: layer.visible }));
			this.session.hiddenPrevious.forEach(({ layer }) => { layer.visible = false; });
		} else if (!replace && this.session.hiddenPrevious) {
			this.restoreHiddenPreviousBatch();
		}
	}

	restoreHiddenPreviousBatch() {
		this.session?.hiddenPrevious?.forEach(({ layer, visible }) => { layer.visible = visible; });
		if (this.session) this.session.hiddenPrevious = null;
	}

	removeSessionLayer(layer) {
		this.editor.glitterManager.releaseLayerResources(layer);
		this.editor.layers = this.editor.layers.filter((existing) => existing.id !== layer.id);
		this.session.maskSignatures.delete(layer.id);
	}

	cancelSession() {
		if (!this.session) return;
		const session = this.session;
		const activeLayer = this.editor.layerManager.getActiveLayer();
		const restoreSelection = Boolean(activeLayer?.isPreview);
		this.restoreHiddenPreviousBatch();
		[...this.session.layers].forEach((layer) => this.removeSessionLayer(layer));
		this.session = null;
		if (restoreSelection) {
			this.editor.layerManager.restoreSelectionState(session.previousActiveLayerId, session.previousSelectedLayerIds);
		}
		this.editor.historyManager.updateButtons();
		this.editor.updatePreview();
		this.editor.updateActionButtons();
	}

	// Commits the ephemeral session batch: the preview layers ARE the final
	// layers — masks get their real paintHistory snapshot here (reconciles use
	// transient versions to avoid snapshotting on every live change).
	createLayers() {
		if (!this.result || !this.session) return;
		const wasEditingPrevious = this.isEditingPrevious();
		const previousShowAllLayers = this.session.previousShowAllLayers;
		const previousTool = this.session.previousTool;
		this.reconcileSession();
		const kept = this.session.layers.filter((layer) => !this.result.palette[layer._autoGlitterRoot].skipped);
		const skipped = this.session.layers.filter((layer) => !kept.includes(layer));
		if (this.getAvailableSlots() < kept.length) {
			this.editor.showError('There are not enough open layer slots. Analyze again with fewer colors.');
			return;
		}
		if (!kept.length) return;

		this.ui.create.disabled = true;
		this.ui.status.textContent = wasEditingPrevious ? 'Applying Auto Glitter changes…' : 'Creating editable glitter layers…';
		if (this.shouldReplacePrevious()) this.removePreviousBatch();
		else this.restoreHiddenPreviousBatch();
		skipped.forEach((layer) => this.removeSessionLayer(layer));

		const batchId = `auto-glitter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const createdAt = Date.now();
		const sessionState = this.captureSessionSettings();
		kept.forEach((layer) => {
			const sourceVisible = layer._autoGlitterSourceVisible;
			const sourceLocked = layer._autoGlitterSourceLocked;
			delete layer.isPreview;
			delete layer._autoGlitterRoot;
			delete layer._autoGlitterSourceVisible;
			delete layer._autoGlitterSourceLocked;
			layer.visible = wasEditingPrevious && sourceVisible != null ? sourceVisible : true;
			layer.locked = wasEditingPrevious && sourceLocked != null ? sourceLocked : false;
			layer.fill.mode = 'glitter';
			this.editor.glitterManager.commitPaintState(layer);
		});
		kept.forEach((layer) => {
			layer.autoGlitter = {
				batchId,
				createdAt,
				batchSize: kept.length,
				sessionState,
				generatedState: JSON.stringify(this.captureGeneratedState(layer))
			};
		});
		const canvasEffectsDisabled = this.editor.baseBackgroundManager?.disablePixelEffects({ apply: false }) || false;

		this.session = null;
		this.editor.historyManager.updateButtons();
		this.editor.layerManager.renderLayersList();
		this.editor.updatePreview();
		const baseLayer = this.editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
		if (baseLayer) this.editor.layerManager.setActiveLayer(baseLayer.id);
		this.editor.updateActionButtons();
		this.editor.saveState();
		this.endSessionUI({ cancel: false, previousShowAllLayers, previousTool });
		const effectNotice = canvasEffectsDisabled ? '; Canvas Effects turned off (settings preserved)' : '';
		const action = wasEditingPrevious ? 'Updated' : 'Created';
		this.editor.updateStatus(`${action} ${kept.length} editable glitter ${kept.length === 1 ? 'layer' : 'layers'}${effectNotice}`);
	}

	removePreviousBatch() {
		const ids = new Set(this.previousBatch.layers.map((layer) => layer.id));
		this.previousBatch.layers.forEach((layer) => this.editor.glitterManager.releaseLayerResources(layer));
		this.editor.layers = this.editor.layers.filter((layer) => !ids.has(layer.id));
	}
}
