class AutoGlitterManager {
	constructor(editor) {
		this.editor = editor;
		this.result = null;
		this.worker = null;
		this.previewMode = 'posterized';
		this.bindUI();
	}

	bindUI() {
		this.ui = {
			open: document.getElementById('autoGlitterImageBtn'),
			count: document.getElementById('autoGlitterColorCount'),
			analyze: document.getElementById('autoGlitterAnalyzeBtn'),
			create: document.getElementById('autoGlitterCreateBtn'),
			status: document.getElementById('autoGlitterStatus'),
			results: document.getElementById('autoGlitterResults'),
			capacity: document.getElementById('autoGlitterCapacity'),
			existing: document.getElementById('autoGlitterExisting'),
			existingSummary: document.getElementById('autoGlitterExistingSummary'),
			replacePrevious: document.getElementById('autoGlitterReplacePrevious'),
			addAnother: document.getElementById('autoGlitterAddAnother'),
			paletteStyles: [...document.querySelectorAll('#autoGlitterPaletteStyle [data-palette-style]')],
			tuneHue: document.getElementById('autoGlitterTuneHue'),
			preview: document.getElementById('autoGlitterPreview'),
			previewCanvas: document.getElementById('autoGlitterPreviewCanvas'),
			previewModes: [...document.querySelectorAll('#autoGlitterPreviewMode [data-preview-mode]')]
		};

		this.ui.open?.addEventListener('click', () => this.open());
		this.ui.analyze?.addEventListener('click', () => this.analyze());
		this.ui.create?.addEventListener('click', () => this.createLayers());
		this.ui.paletteStyles.forEach((button) => button.addEventListener('click', () => {
			if (button.dataset.paletteStyle === this.paletteStyle) return;
			this.setPaletteStyle(button.dataset.paletteStyle);
			this.reanalyze();
		}));
		this.ui.tuneHue?.addEventListener('change', () => this.reanalyze());
		this.ui.previewModes.forEach((button) => button.addEventListener('click', () => {
			this.previewMode = button.dataset.previewMode;
			this.ui.previewModes.forEach((option) => {
				const active = option.dataset.previewMode === this.previewMode;
				option.classList.toggle('active', active);
				option.setAttribute('aria-pressed', active ? 'true' : 'false');
			});
			this.renderAnalysisPreview();
		}));
		[this.ui.replacePrevious, this.ui.addAnother].forEach((input) => input?.addEventListener('change', () => {
			this.close();
			this.applyCapacity();
			this.clearResult();
			if (!this.ui.analyze.disabled) this.analyze();
		}));
	}

	open() {
		if (!this.editor.originalImageData) {
			this.editor.showError('Load an image before using Auto Glitter');
			return;
		}

		this.previousBatch = this.getLatestBatch();
		const editedCount = this.previousBatch ? this.getEditedLayerCount(this.previousBatch) : 0;
		this.ui.existing.hidden = !this.previousBatch;
		if (this.previousBatch) {
			const count = this.previousBatch.layers.length;
			this.ui.existingSummary.textContent = editedCount > 0
				? `${editedCount === 1 ? 'This set has been changed' : `${editedCount} layers in this set have been changed`}. Replacing it will discard those edits.`
				: `The previous ${count}-layer set has not been changed.`;
			this.ui.existing.classList.toggle('has-warning', editedCount > 0);
			this.ui.replacePrevious.checked = editedCount === 0;
			this.ui.addAnother.checked = editedCount > 0;
		}

		const limits = CONFIG.tools.autoGlitter.limits;
		this.ui.count.min = limits.minColorLayers;
		this.ui.count.value = CONFIG.tools.autoGlitter.defaults.colorLayers;
		this.setPaletteStyle(CONFIG.tools.autoGlitter.defaults.paletteStyle);
		this.ui.tuneHue.checked = CONFIG.tools.autoGlitter.defaults.tuneGlitterHue;
		this.applyCapacity();
		this.clearResult();
		this.editor.modalManager.open('autoGlitterModal');
		if (!this.ui.analyze.disabled) this.analyze();
	}

	setPaletteStyle(style) {
		if (!CONFIG.tools.autoGlitter.paletteStyles[style]) return;
		this.paletteStyle = style;
		this.ui.paletteStyles.forEach((button) => {
			const active = button.dataset.paletteStyle === style;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', active ? 'true' : 'false');
		});
	}

	reanalyze() {
		this.close();
		this.applyCapacity();
		if (!this.ui.analyze.disabled) this.analyze();
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
		return Boolean(this.previousBatch && this.ui.replacePrevious.checked);
	}

	getAvailableSlots() {
		const openSlots = CONFIG.app.limits.maxLayers - this.editor.layers.length;
		return openSlots + (this.shouldReplacePrevious() ? this.previousBatch.layers.length : 0);
	}

	applyCapacity() {
		const limits = CONFIG.tools.autoGlitter.limits;
		const available = this.getAvailableSlots();
		const maximum = Math.min(limits.maxColorLayers, available);
		this.ui.count.max = Math.max(limits.minColorLayers, maximum);
		if (Number(this.ui.count.value) > maximum && maximum >= limits.minColorLayers) this.ui.count.value = maximum;
		this.ui.capacity.textContent = available >= limits.minColorLayers
			? `Up to ${maximum} color layers can be created with this choice.`
			: `At least ${limits.minColorLayers} open layer slots are needed. This choice leaves ${available}.`;
		this.ui.analyze.disabled = available < limits.minColorLayers;
	}

	close() {
		this.analysisId = (this.analysisId || 0) + 1;
		this.worker?.terminate();
		this.worker = null;
		this.analysisReject?.(new Error('Analysis cancelled'));
		this.analysisReject = null;
	}

	clearResult() {
		this.result = null;
		this.openPickerIndex = null;
		this.ui.results.replaceChildren();
		this.ui.results.hidden = true;
		this.ui.preview.hidden = true;
		this.ui.create.disabled = true;
		this.ui.status.textContent = 'Analyze the image to review its distinct color regions.';
	}

	async analyze() {
		if (!this.editor.originalImageData || this.ui.analyze.disabled) return;
		const limits = CONFIG.tools.autoGlitter.limits;
		const available = this.getAvailableSlots();
		const count = Math.max(limits.minColorLayers, Math.min(
			Math.round(Number(this.ui.count.value)) || CONFIG.tools.autoGlitter.defaults.colorLayers,
			limits.maxColorLayers,
			available
		));
		this.ui.count.value = count;
		this.ui.analyze.disabled = true;
		this.ui.create.disabled = true;
		this.ui.results.hidden = true;
		this.ui.status.textContent = 'Finding distinct colors and matching glitter…';

		const analysisId = (this.analysisId || 0) + 1;
		this.analysisId = analysisId;
		this.worker?.terminate();
		this.worker = new Worker('js/workers/auto-glitter.worker.js?v=8');
		const pixels = this.editor.originalImageData.data.slice();
		const swatches = this.editor.glitterManager.getAllContent()
			.filter(glitter => glitter.isActive !== false && !glitter.hasTransparency && glitter.colorCodes?.length)
			.map(glitter => ({ id: glitter.id, colors: glitter.colorCodes }));

		try {
			const result = await new Promise((resolve, reject) => {
				this.analysisReject = reject;
				this.worker.onmessage = ({ data }) => {
					this.analysisReject = null;
					data.error ? reject(new Error(data.error)) : resolve(data);
				};
				this.worker.onerror = () => reject(new Error('The image could not be analyzed.'));
				this.worker.postMessage({
					pixels: pixels.buffer,
					width: this.editor.originalImageData.width,
					height: this.editor.originalImageData.height,
					colorCount: count,
					options: {
						...CONFIG.tools.autoGlitter.analysis,
						...CONFIG.tools.autoGlitter.paletteStyles[this.paletteStyle],
						tuneGlitterHue: this.ui.tuneHue.checked,
						maxSamples: limits.maxSamples
					},
					swatches
				}, [pixels.buffer]);
			});
			if (analysisId !== this.analysisId) return;
			this.result = result;
			this.renderReviewResults();
		} catch (error) {
			if (analysisId !== this.analysisId) return;
			this.clearResult();
			this.ui.status.textContent = error.message;
		} finally {
			if (analysisId !== this.analysisId) return;
			this.worker?.terminate();
			this.worker = null;
			this.analysisReject = null;
			this.applyCapacity();
		}
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
			row.querySelector('.auto-glitter-source-color').style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
			row.querySelector('.auto-glitter-color-name').textContent = `Color ${index + 1}`;
			row.querySelector('.auto-glitter-coverage').textContent = `${this.formatCoverage(color.count)} of image`;
			this.updateMatchThumbnail(row, color);
			const handle = row.querySelector('.auto-glitter-drag-handle');
			const choice = row.querySelector('.auto-glitter-choice');
			const unmerge = row.querySelector('.auto-glitter-unmerge');
			if (color.manualMergeTarget != null) {
				row.classList.add('is-merged');
				const targetIndex = this.resolveManualMergeTarget(index);
				row.querySelector('.auto-glitter-coverage').textContent = `${this.formatCoverage(color.count)} · combined with Color ${targetIndex + 1}`;
				handle.hidden = true;
				choice.hidden = true;
				unmerge.hidden = false;
			} else {
				handle.setAttribute('aria-label', `Drag Color ${index + 1} onto another color to combine them`);
				handle.disabled = activeIndices.length <= 1;
				this.bindMergeHandle(handle, row, index);
				this.bindMergeRow(row, index, activeIndices.length <= 1);
				choice.setAttribute('aria-label', `Choose glitter for Color ${index + 1}`);
				choice.addEventListener('click', () => {
					this.openPickerIndex = this.openPickerIndex === index ? null : index;
					this.renderReviewResults();
				});
			}
			unmerge.addEventListener('click', () => this.separateColor(index));
			if (this.openPickerIndex === index && color.manualMergeTarget == null) this.renderGlitterPicker(row, color, index, glitters);
			this.ui.results.appendChild(row);
		});

		this.ui.results.hidden = false;
		this.ui.preview.hidden = false;
		this.renderAnalysisPreview();
		this.ui.create.disabled = !activeIndices.length;
		const actual = activeIndices.length;
		const hasManualMerges = this.result.palette.some((color) => color.manualMergeTarget != null);
		this.ui.status.textContent = hasManualMerges
			? `${actual} ${actual === 1 ? 'layer' : 'layers'} will be created. Combined regions remain fully covered.`
			: (actual === Number(this.ui.count.value)
				? 'Review the glitter matches, then create the layers.'
				: `Close shades were combined. ${actual} ${actual === 1 ? 'layer' : 'layers'} will be created.`);
	}

	formatCoverage(count) {
		const percent = count / this.result.visiblePixelCount * 100;
		return `${percent < 1 ? percent.toFixed(1) : Math.round(percent)}%`;
	}

	renderGlitterPicker(row, color, index, glitters) {
		const picker = row.querySelector('.auto-glitter-picker');
		const choice = row.querySelector('.auto-glitter-choice');
		picker.hidden = false;
		choice.setAttribute('aria-expanded', 'true');
		const grid = document.createElement('div');
		grid.className = 'asset-grid visible auto-glitter-picker-grid';
		glitters.forEach((glitter) => {
			const button = this.editor.glitterManager.createItemElement(glitter, () => {
				color.selectedGlitterId = glitter.id;
				color.selectedColorAdjust = null;
				this.openPickerIndex = null;
				this.renderReviewResults();
			});
			const selected = String(glitter.id) === String(color.selectedGlitterId);
			button.classList.toggle('selected', selected);
			button.setAttribute('aria-pressed', selected ? 'true' : 'false');
			grid.appendChild(button);
		});
		picker.appendChild(grid);
	}

	renderAnalysisPreview() {
		if (!this.result || !this.ui.previewCanvas || !this.editor.originalImageData) return;
		const source = this.editor.originalImageData;
		const canvas = this.ui.previewCanvas;
		canvas.width = source.width;
		canvas.height = source.height;
		canvas.classList.toggle('is-posterized', this.previewMode === 'posterized');
		const context = canvas.getContext('2d');
		const output = context.createImageData(source.width, source.height);
		if (this.previewMode === 'original') {
			output.data.set(source.data);
		} else {
			for (let pixelIndex = 0, offset = 0; pixelIndex < this.result.labels.length; pixelIndex++, offset += 4) {
				const label = this.result.labels[pixelIndex];
				if (label === 255) continue;
				const color = this.result.palette[this.resolveManualMergeTarget(label)];
				if (!color) continue;
				output.data[offset] = color.r;
				output.data[offset + 1] = color.g;
				output.data[offset + 2] = color.b;
				output.data[offset + 3] = source.data[offset + 3];
			}
		}
		context.putImageData(output, 0, 0);
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
		this.openPickerIndex = null;
		this.renderReviewResults();
	}

	separateColor(index) {
		delete this.result.palette[index].manualMergeTarget;
		this.renderReviewResults();
	}

	updateMatchThumbnail(row, color) {
		const glitter = this.editor.glitterManager.getAllContent().find(item => String(item.id) === String(color.selectedGlitterId));
		const image = row.querySelector('img');
		const name = row.querySelector('.auto-glitter-match-name');
		image.src = glitter?.thumbnailUrl || glitter?.url || '';
		image.alt = '';
		image.style.filter = buildCssColorFilter(color.selectedColorAdjust);
		name.textContent = glitter?.name || 'Glitter';
		const detail = row.querySelector('.auto-glitter-choice small');
		const hue = color.selectedColorAdjust?.hue || 0;
		detail.textContent = hue ? `Glitter · Hue ${hue > 0 ? '+' : ''}${hue}°` : 'Glitter';
	}

	createLayers() {
		if (!this.result) return;
		const activePaletteIndices = this.getActivePaletteIndices();
		const available = this.getAvailableSlots();
		if (available < activePaletteIndices.length) {
			this.editor.showError('There are not enough open layer slots. Analyze again with fewer colors.');
			return;
		}

		this.ui.create.disabled = true;
		this.ui.status.textContent = 'Creating editable glitter layers…';
		const { width, height, data } = this.editor.originalImageData;
		if (this.shouldReplacePrevious()) this.removePreviousBatch();
		const baseIndex = this.editor.layers.findIndex(layer => layer.type === LayerType.BASE_IMAGE);
		const created = [];
		const batchId = `auto-glitter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const createdAt = Date.now();
		const manualRoots = this.result.palette.map((_color, index) => this.resolveManualMergeTarget(index));

		activePaletteIndices.forEach((paletteIndex) => {
			const glitterId = this.result.palette[paletteIndex].selectedGlitterId;
			const glitter = this.editor.glitterManager.getAllContent().find(item => String(item.id) === String(glitterId));
			const layer = this.editor.glitterManager.createLayer();
			if (!layer) return;
			layer.selectedGlitterId = glitter?.id ?? glitterId;
			layer.name = glitter?.name || `Color ${paletteIndex + 1}`;
			layer.settings.feather = 0;
			layer.settings.colorAdjust = this.result.palette[paletteIndex].selectedColorAdjust
				? normalizeColorAdjust(this.result.palette[paletteIndex].selectedColorAdjust)
				: null;

			const paint = this.editor.glitterManager.ensurePaintMask(layer.id);
			const context = paint.add.getContext('2d', { willReadFrequently: true });
			const mask = context.createImageData(width, height);
			for (let pixelIndex = 0, offset = 0; pixelIndex < this.result.labels.length; pixelIndex++, offset += 4) {
				if (manualRoots[this.result.labels[pixelIndex]] !== paletteIndex) continue;
				mask.data[offset] = 255;
				mask.data[offset + 1] = 255;
				mask.data[offset + 2] = 255;
				mask.data[offset + 3] = data[offset + 3];
			}
			context.putImageData(mask, 0, 0);
			paint.hasContent = true;
			paint.liveRevision++;
			this.editor.glitterManager.commitPaintState(layer);
			created.push(layer);
		});
		created.forEach((layer) => {
			layer.autoGlitter = {
				batchId,
				createdAt,
				batchSize: created.length,
				generatedState: JSON.stringify(this.captureGeneratedState(layer))
			};
		});

		this.editor.layers.splice(baseIndex + 1, 0, ...created);
		this.editor.layerManager.renderLayersList();
		this.editor.updatePreview();
		const baseLayer = this.editor.layers.find((layer) => layer.type === LayerType.BASE_IMAGE);
		if (baseLayer) this.editor.layerManager.setActiveLayer(baseLayer.id);
		this.editor.updateActionButtons();
		this.editor.saveState();
		this.editor.modalManager.close('autoGlitterModal');
		this.editor.updateStatus(`Created ${created.length} editable glitter ${created.length === 1 ? 'layer' : 'layers'}`);
	}

	removePreviousBatch() {
		const ids = new Set(this.previousBatch.layers.map((layer) => layer.id));
		this.previousBatch.layers.forEach((layer) => this.editor.glitterManager.releaseLayerResources(layer));
		this.editor.layers = this.editor.layers.filter((layer) => !ids.has(layer.id));
	}
}
