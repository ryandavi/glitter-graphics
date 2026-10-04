class FilterLayerManager {
	constructor(editor) {
		this.editor = editor;
		this.layerElements = new Map();
		this.layerTransforms = new Map();
		this.grainTileCache = new Map();
		this.snapshotInputs = new ByteBudgetCache({ id: 'filter-snapshot-inputs', label: 'Pixel filter inputs', measure: (value) => value?.imageData?.data?.byteLength || 0 });
		this.snapshotOutputs = new ByteBudgetCache({ id: 'filter-snapshot-outputs', label: 'Pixel filter outputs', measure: (value) => (value?.frames || []).reduce((sum, frame) => sum + canvasBytes(frame), 0) });
		this.snapshotTimers = new Map();
		// Signature of the render each layer has queued, so repeated preview
		// updates of an unchanged scene don't keep postponing it.
		this.snapshotPending = new Map();
		// Layers whose Still preview was switched to animated with the panel
		// button; the switch lasts until the layer or its input is edited.
		this.animatedPreviews = new Set();
		// True while a pointer gesture edits a layer under a displayed snapshot:
		// the live layers show instead so the edit is visible.
		this.liveEditing = false;
		this.displayedSnapshotLayerId = null;
		this.lastLayersToShow = [];
		this.snapshotPlaybackFrame = null;
		this.lastOutputMs = new Map();
		this.imageIdentities = new WeakMap();
		this.nextImageIdentity = 1;
		this.snapshotCompositor = new SceneCompositor({
			editor,
			resolveShapeFillImage: (imageRef) => editor.shapeGlitterManager.getImageFillAsset(imageRef)
		});
		this.snapshotQueue = Promise.resolve();
		this.setupUI();
		this.setupEventListeners();
		this.renderLookPicker();
	}

	getLayerType() {
		return LayerType.FILTER;
	}

	createLayer(options = {}) {
		return this.normalizeLayer({
			id: this.editor.layerManager.generateLayerId(),
			type: LayerType.FILTER,
			name: 'Filter',
			visible: true,
			locked: false,
			opacity: 100,
			filterData: options.filterData || { type: CONFIG.tools.filter.defaultType }
		});
	}

	normalizeLayer(layer) {
		if (!layer || layer.type !== LayerType.FILTER) return null;
		layer.opacity = Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 100;
		layer.filterData = GlitterFilter.normalizeFilterData(layer.filterData);
		return layer;
	}

	setupUI() {
		const get = (id) => document.getElementById(id);
		this.ui = {
			opacity: get('filterLayerOpacity'), lookGroup: get('filterLooksGroup'), looks: get('filterLooksPicker'),
			currentInfo: get('filterCurrentLookInfo'), currentThumbnail: get('filterCurrentLookThumbnail'),
			currentName: get('filterCurrentLookName'), currentBadges: get('filterCurrentLookBadges'), currentShow: get('filterCurrentLookShow'),
			customize: get('filterCustomize'), customizeTitle: get('filterCustomizeTitle'),
			snapshotStatus: get('filterSnapshotStatus'), snapshotActions: get('filterSnapshotActions'), renderPreview: get('filterRenderPreview')
		};
	}

	getActiveLayer() {
		const layer = this.editor.layerManager.getActiveLayer();
		return layer?.type === LayerType.FILTER ? layer : null;
	}

	update(key, value, commit = false) {
		if (this.loadingSettings) return;
		const layer = this.getActiveLayer();
		if (!layer) return;
		if (key === 'opacity') layer.opacity = value;
		else layer.filterData[key] = value;
		this.editor.layerManager.renderLayersList();
		this.editor.requestPreviewUpdate();
		if (commit) this.editor.saveState('Edit filter');
	}

	bindRange(control, key) {
		if (!control) return;
		const spec = FIELDS[control.dataset.role];
		const suffix = spec?.unit || '';
		bindSlider(control, document.getElementById(`${control.id}Value`), {
			suffix,
			parseValue: (value) => Number(value),
			apply: (value) => this.update(key, value),
			onCommit: () => this.editor.saveState('Edit filter'),
			resetValue: spec?.value,
			resetButton: document.getElementById(`reset${control.id.charAt(0).toUpperCase()}${control.id.slice(1)}`)
		});
	}

	setupEventListeners() {
		this.bindRange(this.ui.opacity, 'opacity');
		this.ui.currentShow?.addEventListener('click', () => this.showActiveLookInLibrary());
		this.ui.renderPreview?.addEventListener('click', () => {
			const layer = this.getActiveLayer();
			if (!layer || GlitterFilters.tier(layer.filterData) !== 3) return;
			if (this.animatedPreviews.has(layer.id)) this.animatedPreviews.delete(layer.id);
			else this.animatedPreviews.add(layer.id);
			this.syncSnapshotControls(layer);
			this.scheduleSnapshot(layer, { immediate: true });
		});
		// Canvas drags and handle gestures move layer elements directly without a
		// preview update, so a displayed snapshot would hide the edit. Any
		// pressed-pointer move while a layer under it is selected shows the live
		// layers until the pointer is released.
		document.addEventListener('pointermove', (event) => {
			if (event.buttons && !this.liveEditing && this.shouldPauseForEdit()) this.pauseForEdit();
		}, { capture: true, passive: true });
		const resume = () => { if (this.liveEditing) this.resumeAfterEdit(); };
		document.addEventListener('pointerup', resume, true);
		document.addEventListener('pointercancel', resume, true);
	}

	shouldPauseForEdit() {
		if (!this.displayedSnapshotLayerId || this.editor.viewport?.isPanning) return false;
		const topIndex = this.editor.layers.findIndex((layer) => layer.id === this.displayedSnapshotLayerId);
		const ids = new Set([...(this.editor.selectedLayerIds || []), this.editor.layerManager.activeLayerId]);
		return this.editor.layers.some((layer, index) => index < topIndex && ids.has(layer.id));
	}

	pauseForEdit() {
		this.liveEditing = true;
		this.statusBeforeEdit = this.editor.notifications?.statusText?.textContent ?? '';
		this.applySnapshotVisibility(this.lastLayersToShow);
		this.editor.updateStatus('Pixel filter paused while you edit');
	}

	resumeAfterEdit() {
		this.liveEditing = false;
		this.resumeStatusPending = true;
		this.editor.requestPreviewUpdate();
	}

	// Called after every history save: edits that don't go through a preview
	// update (panel fields, nudges) still re-check each snapshot's input.
	noteSceneEdited() {
		if (PREFERENCES.get('filterPreviewLevel') === 'off') return;
		if (this.editor.layers.some((layer) => layer.type === LayerType.FILTER && GlitterFilters.tier(layer.filterData) === 3)) this.editor.requestPreviewUpdate();
	}

	chooseLook(entry) {
		const layer = this.getActiveLayer();
		if (!layer) return;
		layer.filterData = GlitterFilter.normalizeFilterData(GlitterFilters.looksLibrary.apply(entry));
		this.loadLayerSettings(layer);
		this.editor.requestPreviewUpdate();
		this.editor.layerManager.renderLayersList();
		this.editor.saveState('Choose look');
	}

	loadLayerSettings(layer) {
		if (!layer || layer.type !== LayerType.FILTER) return;
		this.loadingSettings = true;
		writeSliderValue(this.ui.opacity, layer.opacity);
		this.loadingSettings = false;
		this.renderLookPicker();
		this.renderCustomizeControls(layer);
		this.syncSnapshotControls(layer);
	}

	syncSnapshotControls(layer) {
		const tier3 = GlitterFilters.tier(layer.filterData) === 3;
		const level = PREFERENCES.get('filterPreviewLevel');
		const animatedOn = this.animatedPreviews.has(layer.id);
		if (this.ui.snapshotStatus) {
			this.ui.snapshotStatus.hidden = !tier3;
			this.ui.snapshotStatus.classList.toggle('is-warning', level === 'off');
			this.ui.snapshotStatus.textContent = {
				off: 'This filter only shows in exports. Turn on Pixel Filter Preview in Settings to see it here.',
				animated: 'Showing the animated filter preview.',
				still: animatedOn ? 'Showing the animated filter preview until your next edit.' : 'Showing a still frame with this filter. Glitter animation resumes while you edit.'
			}[level] || '';
		}
		if (this.ui.snapshotActions) this.ui.snapshotActions.hidden = !tier3 || level !== 'still';
		const label = this.ui.renderPreview?.querySelector('.name');
		if (label) label.textContent = animatedOn ? 'Show still frame' : 'Preview animation';
	}

	renderLookPicker() {
		if (!this.ui.looks) return;
		const activeLayer = this.getActiveLayer();
		const filterData = activeLayer?.filterData;
		const activeId = filterData?.type === 'instagram' ? `instagram:${filterData.presetId}` : filterData?.type;
		GlitterPresetLibrary.renderPresetGrid(this.ui.looks, GlitterFilters.looksLibrary, {
			activeId,
			contextId: activeLayer?.id,
			groupFilter: this.ui.lookGroup,
			onGroupChange: () => this.renderCurrentLookSummary(activeId),
			onChoose: (entry) => this.chooseLook(entry)
		});
		this.renderCurrentLookSummary(activeId);
	}

	renderCurrentLookSummary(activeId) {
		const entry = GlitterFilters.looksLibrary.get(activeId);
		if (!this.ui.currentInfo) return;
		if (!entry) {
			this.ui.currentInfo.hidden = true;
			if (this.ui.customizeTitle) this.ui.customizeTitle.textContent = '';
			return;
		}
		const group = GlitterFilters.looksLibrary.groups.find((candidate) => candidate.id === entry.group);
		this.ui.currentInfo.hidden = false;
		this.ui.currentInfo.setAttribute('aria-label', `Current look: ${entry.label}`);
		GlitterFilters.looksLibrary.renderThumbnail?.(entry, this.ui.currentThumbnail);
		this.ui.currentName.textContent = entry.label;
		this.ui.currentBadges.replaceChildren();
		if (group) {
			const badge = document.createElement('button');
			badge.type = 'button';
			badge.className = 'asset-info-badge badge-category';
			badge.textContent = group.label;
			badge.title = `Browse ${group.label} looks`;
			badge.addEventListener('click', () => this.showActiveLookInLibrary());
			this.ui.currentBadges.appendChild(badge);
		}
		const visibleCategory = this.ui.lookGroup?.value || null;
		this.ui.currentShow.hidden = visibleCategory == null || visibleCategory === entry.group;
		this.ui.currentShow.title = `Show ${entry.label} in ${group?.label || 'the library'}`;
		if (this.ui.customizeTitle) this.ui.customizeTitle.textContent = `${entry.label} settings`;
	}

	showActiveLookInLibrary() {
		const layer = this.getActiveLayer();
		const filterData = layer?.filterData;
		const activeId = filterData?.type === 'instagram' ? `instagram:${filterData.presetId}` : filterData?.type;
		const entry = GlitterFilters.looksLibrary.get(activeId);
		if (!entry || !this.ui.lookGroup) return;
		this.ui.lookGroup.value = entry.group;
		this.ui.lookGroup.dispatchEvent(new Event('change'));
		this.ui.looks.querySelector(`[data-preset-id="${entry.id}"]`)?.focus();
	}

	renderCustomizeControls(layer) {
		const filter = GlitterFilters.get(layer.filterData.type);
		// Controls with no effect under the current values (a field's `when`)
		// stay out; select changes re-render, so they appear when relevant.
		const fields = Object.entries(filter.fields).filter(([, field]) => !field.when || field.when(layer.filterData));
		this.ui.customize.hidden = !fields.length;
		// The set keeps its title; only the rows are rebuilt.
		this.ui.customize.querySelectorAll(':scope > :not(.property-set-label)').forEach((row) => row.remove());
		fields.forEach(([key, field]) => {
			let item;
			if (field.kind === 'number') item = { kind: 'slider', id: field.controlId, slider: field.specId, revert: true, ...(field.valueScale ? { valueScale: field.valueScale } : {}) };
			else if (field.kind === 'boolean') item = { kind: 'toggle', id: field.controlId, label: field.label, checked: field.default };
			else if (field.kind === 'color') item = { kind: 'field', id: field.controlId, label: field.label, type: 'color', value: field.default, revert: true };
			else if (field.kind === 'select') item = { kind: 'select', id: field.controlId, label: field.label, options: GlitterFilters.fieldOptions(field) };
			if (!item) return;
			const node = buildPanelItem(item);
			this.ui.customize.appendChild(node);
			const control = document.getElementById(field.controlId);
			if (field.kind === 'number') {
				writeSliderValue(control, layer.filterData[key]);
				this.bindRange(control, key);
			} else if (field.kind === 'boolean') {
				control.checked = Boolean(layer.filterData[key]);
				control.addEventListener('change', () => this.update(key, control.checked, true));
			} else {
				control.value = layer.filterData[key];
				const apply = (commit) => {
					const active = this.getActiveLayer();
					if (!active) return;
					const next = { ...active.filterData, [key]: control.value };
					if (active.filterData.type === 'tint' && key === 'color') next.presetId = 'custom';
					active.filterData = GlitterFilter.normalizeFilterData(next);
					this.editor.layerManager.renderLayersList();
					this.editor.requestPreviewUpdate();
					if (commit) {
						this.loadLayerSettings(active);
						this.editor.saveState('Edit filter');
					}
				};
				if (field.kind === 'color') control.addEventListener('input', () => apply(false));
				control.addEventListener('change', () => apply(true));
			}
		});
		syncPropertyReverts(this.ui.customize);
	}

	renderContent(layersToShow) {
		this.lastLayersToShow = layersToShow;
		reconcileLayerElements(this.layerElements, layersToShow, LayerType.FILTER, (layer) => this.renderLayer(layer));
		const level = PREFERENCES.get('filterPreviewLevel');
		let updating = false;
		layersToShow.forEach((layer) => {
			if (layer.type === LayerType.FILTER && GlitterFilters.tier(layer.filterData) === 3) updating = this.syncSnapshot(layer, level) || updating;
		});
		this.applySnapshotVisibility(layersToShow);
		if (layersToShow.some((layer) => this.snapshotOutputs.get(layer.id)?.frames?.length > 1)) this.startSnapshotPlayback();
		if (this.resumeStatusPending) {
			this.resumeStatusPending = false;
			this.editor.updateStatus(updating ? 'Updating pixel filter preview…' : this.statusBeforeEdit);
		}
	}

	getFilterSignature(layer) {
		return `${JSON.stringify(layer.filterData)}|${layer.opacity}|${GlitterBlendModes.forLayer(layer)}`;
	}

	isAnimatedPreview(layer, level = PREFERENCES.get('filterPreviewLevel')) {
		return this.animatedPreviews.has(layer.id) || (level === 'animated' && !getMemoryBudget().constrained);
	}

	// Keeps a tier-3 layer's snapshot matching the scene. A snapshot whose input
	// (the layers below) changed is dropped at once so the live layers show; one
	// whose own settings changed stays up until its replacement lands. Returns
	// true while the live layers stand in for a pending render.
	syncSnapshot(layer, level) {
		if (level === 'off') return false;
		const inputSignature = this.getInputSignature(layer, this.getSnapshotLayers(layer));
		const filterSignature = this.getFilterSignature(layer);
		const output = this.snapshotOutputs.get(layer.id);
		if (output && (output.inputSignature !== inputSignature || output.filterSignature !== filterSignature) && this.animatedPreviews.delete(layer.id)) {
			if (this.getActiveLayer()?.id === layer.id) this.syncSnapshotControls(layer);
		}
		if (output && output.inputSignature !== inputSignature) this.snapshotOutputs.delete(layer.id);
		const current = this.snapshotOutputs.get(layer.id);
		const signature = `${inputSignature}|${filterSignature}|${this.isAnimatedPreview(layer, level)}`;
		if (current?.signature === signature) return false;
		if (!this.liveEditing && this.snapshotPending.get(layer.id) !== signature) this.scheduleSnapshot(layer);
		return !current;
	}

	renderLayer(layer) {
		let element = this.layerElements.get(layer.id);
		if (!element) {
			element = document.createElement('div');
			element.className = 'filter-layer-overlay ui-ignore-gestures';
			element.dataset.layerId = layer.id;
			this.editor.canvasElementsContainer.append(element);
			this.layerElements.set(layer.id, element);
		}
		const width = this.editor.previewCanvas?.width || 1;
		const height = this.editor.previewCanvas?.height || 1;
		const viewScale = this.editor.viewport?.currentZoom || 1;
		const blendMode = GlitterBlendModes.forLayer(layer);
		const tier = GlitterFilters.tier(layer.filterData);
		const signature = `${JSON.stringify(layer.filterData)}|${layer.opacity}|${blendMode}|${this.editor.layerManager.getLayerZIndex(layer.id)}|${width}|${height}|${viewScale}`;
		if (element.dataset.renderSignature === signature) {
			if (tier === 3) this.paintSnapshotElement(layer, element);
			return element;
		}
		element.dataset.renderSignature = signature;
		element.dataset.filterTier = tier;
		const layerZIndex = this.editor.layerManager.getLayerZIndex(layer.id);
		const layerOpacity = layer.opacity / 100;
		element.style.zIndex = '';
		element.style.opacity = '';
		element.style.backdropFilter = '';
		element.style.webkitBackdropFilter = '';
		if (tier === 3) {
			element.replaceChildren();
			const canvas = createAppCanvas(width, height, 'layers/FilterLayerManager');
			canvas.className = 'filter-snapshot-canvas';
			canvas.style.zIndex = layerZIndex;
			element.append(canvas);
			this.paintSnapshotElement(layer, element);
			return element;
		}
		element.querySelector('.filter-snapshot-canvas')?.remove();
		// Not applied as element.style.mixBlendMode on this container: it paints
		// no content of its own (children paint the tint/vignette/grain overlays,
		// and tone/blur adjust the backdrop directly via CSS filter), so a
		// container-level blend mode would be a no-op at best. Each paint op
		// gets the override directly instead - see overlayLayerStyles.
		const children = GlitterFilter.overlayLayerStyles(layer.filterData, { width, height, seed: layer.id, viewScale, tileCache: this.grainTileCache, blendMode });
		const retained = new Set();
		const caption = GlitterFilter.resolve(layer.filterData).caption;
		if (caption) {
			let child = element.querySelector('.filter-layer-name');
			if (!child) child = document.createElement('div');
			child.className = 'filter-layer-name';
			child.textContent = caption;
			const spec = GlitterFilter.nameCaptionSpec(caption, { width, height });
			child.style.fontSize = `${spec.fontPx}px`;
			child.style.transform = `translateY(${spec.y - height / 2}px)`;
			child.style.zIndex = layerZIndex;
			child.style.opacity = layerOpacity;
			element.append(child);
		} else element.querySelector('.filter-layer-name')?.remove();
		children.forEach((spec, index) => {
			const key = `${spec.className}-${index}`;
			let child = element.querySelector(`[data-filter-child="${key}"]`);
			if (!child) {
				child = document.createElement('div');
				child.dataset.filterChild = key;
				element.append(child);
			}
			child.className = spec.className;
			child.dataset.filterChild = key;
			child.removeAttribute('style');
			Object.assign(child.style, spec.style);
			child.style.zIndex = layerZIndex;
			child.style.opacity = Number(spec.style.opacity ?? 1) * layerOpacity;
			element.append(child);
			retained.add(child);
		});
		element.querySelectorAll('[data-filter-child]').forEach((child) => {
			if (!retained.has(child)) child.remove();
		});
		return element;
	}

	getImageIdentity(value) {
		if (!value || typeof value !== 'object') return 'none';
		if (!this.imageIdentities.has(value)) this.imageIdentities.set(value, this.nextImageIdentity++);
		return this.imageIdentities.get(value);
	}

	getSnapshotLayers(layer) {
		const index = this.editor.layers.indexOf(layer);
		return this.editor.layers.slice(0, Math.max(0, index)).filter((candidate) => candidate.visible && !candidate.isPreview && layerHasVisibleContent(candidate));
	}

	getInputSignature(layer, layers) {
		const serialized = layers.map((candidate) => this.editor.layerManager.serializeLayer(candidate));
		return `${this.editor.originalCanvas.width}x${this.editor.originalCanvas.height}|image:${this.getImageIdentity(this.editor.originalImageData)}|${JSON.stringify(serialized)}`;
	}

	buildSnapshotParams(layers) {
		return {
			visibleLayers: layers,
			glitterGifs: this.editor.glitterLibrary.content,
			canvasData: {
				width: this.editor.originalCanvas.width,
				height: this.editor.originalCanvas.height,
				originalData: new Uint8ClampedArray(this.editor.originalImageData.data),
				originalAlpha: this.editor.originalAlphaChannel,
				alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold,
				hasBaseImage: this.editor.baseBackgroundManager?.hasBaseImage() ?? true
			},
			exportSettings: { ...this.editor.exportSettings, baseImage: true, watermarkEnabled: false, transparency: true },
			target: { supportsTransparency: true },
			callbacks: {
				onStatus: () => {}, onProgress: () => {}, onLayerLoaded: () => {}, isCancelled: () => false,
				createMask: (candidate) => this.editor.maskCompositor.getMaskData(candidate),
				renderSlotMasks: (candidate) => getLayerManagerForType(this.editor, candidate.type).renderSlotMasks(candidate),
				ensureTextFont: (fontId) => FontLibrary.ensureLoaded(fontId)
			}
		};
	}

	scheduleSnapshot(layer, options = {}) {
		const level = PREFERENCES.get('filterPreviewLevel');
		if (level === 'off' || GlitterFilters.tier(layer.filterData) !== 3) return;
		const animated = this.isAnimatedPreview(layer, level);
		const signature = `${this.getInputSignature(layer, this.getSnapshotLayers(layer))}|${this.getFilterSignature(layer)}|${animated}`;
		this.snapshotPending.set(layer.id, signature);
		clearTimeout(this.snapshotTimers.get(layer.id));
		const input = this.snapshotInputs.get(layer.id);
		const delay = options.immediate ? 0 : (input && (this.lastOutputMs.get(layer.id) || Infinity) < 50 ? 0 : CONFIG.tools.filter.snapshot.settleMs);
		this.snapshotTimers.set(layer.id, setTimeout(() => {
			this.snapshotQueue = this.snapshotQueue.then(() => this.renderSnapshot(layer, animated, signature)).catch((error) => console.error('Pixel filter preview queue failed:', error));
		}, delay));
	}

	async renderSnapshot(layer, animated, signature) {
		// A newer schedule supersedes this one; its own render follows in the queue.
		// Direct calls (no signature) always render.
		const superseded = () => signature !== undefined && this.snapshotPending.get(layer.id) !== signature;
		if (superseded()) return;
		const layers = this.getSnapshotLayers(layer);
		const inputSignature = this.getInputSignature(layer, layers);
		const filterSignature = this.getFilterSignature(layer);
		const showingLive = !this.snapshotOutputs.get(layer.id);
		if (showingLive && !animated) this.editor.updateStatus('Updating pixel filter preview…');
		const previewStarted = performance.now();
		const done = this.editor.beginActivity('filter-preview', 'Updating filter preview');
		let input = this.snapshotInputs.get(layer.id);
		try {
			if (!input || input.signature !== inputSignature) {
				const params = this.buildSnapshotParams(layers);
				const preparedContext = await this.snapshotCompositor.prepareContext(params);
				const composed = await this.snapshotCompositor.composeFrameAt({ ...params, preparedContext, timestamp: 0 });
				input = { signature: inputSignature, imageData: composed.imageData, preparedContext, params };
				this.snapshotInputs.set(layer.id, input);
			}
			let duration = 0;
			let frameCount = 1;
			if (animated) {
				// The filter itself joins the estimate so an animated Dither's
				// shimmer sets the loop even over a still scene.
				const estimate = await this.snapshotCompositor.estimateLoopDuration({
					layers: [...layers, layer], library: this.editor.glitterLibrary.content,
					fallbackDuration: CONFIG.export.defaults.frameDelay,
					maxFrames: 24, baseImage: true
				});
				duration = estimate.duration || 1200;
				const frameBytes = input.imageData.width * input.imageData.height * 4;
				const budgetFrames = Math.max(2, Math.floor(getMemoryBudget().previewCacheBytes / Math.max(1, frameBytes)) - 2);
				frameCount = Math.max(2, Math.min(24, estimate.estimatedFrameCount || 24, budgetFrames));
			}
			const frames = [];
			const started = performance.now();
			const shimmerFrameMs = GlitterFilter.shimmerAnimation(layer.filterData) ? CONFIG.tools.pixelEffects.animation.frameDurationMs : 0;
			for (let index = 0; index < frameCount; index++) {
				if (superseded()) return;
				const timestamp = duration * index / frameCount;
				let source = input.imageData;
				if (index > 0) source = (await this.snapshotCompositor.composeFrameAt({ ...input.params, preparedContext: input.preparedContext, timestamp })).imageData;
				const canvas = createAppCanvas(source.width, source.height, 'layers/FilterLayerManager');
				const context = canvas.getContext('2d');
				context.putImageData(source, 0, 0);
				await GlitterFilter.renderToCanvas(context, source.width, source.height, layer.filterData, layer.opacity / 100, {
					keepAlpha: true, alphaThreshold: CONFIG.tools.selection.transparency.alphaThreshold,
					seed: layer.id, frameIndex: shimmerFrameMs ? Math.floor(timestamp / shimmerFrameMs) : index, matteColor: this.editor.exportSettings.matteColor,
					blendMode: GlitterBlendModes.forLayer(layer)
				});
				frames.push(canvas);
				if (animated) {
					this.editor.updateStatus(`Rendering preview ${index + 1}/${frameCount}`);
					this.editor.updateActivity('filter-preview', { label: 'Rendering preview', current: index + 1, total: frameCount });
				}
			}
			this.lastOutputMs.set(layer.id, (performance.now() - started) / frameCount);
			this.snapshotOutputs.set(layer.id, {
				signature: `${inputSignature}|${filterSignature}|${animated}`, inputSignature, filterSignature,
				frames, frameDuration: animated ? duration / frameCount : 0, startedAt: performance.now()
			});
			if (!superseded()) this.snapshotPending.delete(layer.id);
			this.editor.requestPreviewUpdate();
			if (animated) {
				this.startSnapshotPlayback();
				this.editor.updateStatus('Animated filter preview ready');
			} else if (showingLive) this.editor.updateStatus('Pixel filter preview updated');
		} catch (error) {
			if (!superseded()) this.snapshotPending.delete(layer.id);
			console.error('Pixel filter preview failed:', error);
			this.editor.updateStatus('Pixel filter preview unavailable; it will still apply on export.');
		} finally {
			dbg(`[filter-preview] ${layer.filterData.type}: ${(performance.now() - previewStarted).toFixed(1)}ms`);
			done();
		}
	}

	paintSnapshotElement(layer, element) {
		const output = this.snapshotOutputs.get(layer.id);
		const canvas = element.querySelector('.filter-snapshot-canvas');
		if (!output?.frames?.length || !canvas) return;
		const index = output.frames.length > 1 ? Math.floor((performance.now() - output.startedAt) / output.frameDuration) % output.frames.length : 0;
		const frame = output.frames[index];
		if (canvas.width !== frame.width) canvas.width = frame.width;
		if (canvas.height !== frame.height) canvas.height = frame.height;
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(frame, 0, 0);
	}

	startSnapshotPlayback() {
		if (this.snapshotPlaybackFrame) return;
		const tick = () => {
			this.snapshotPlaybackFrame = null;
			let active = false;
			this.layerElements.forEach((element, id) => {
				const layer = this.editor.layers.find((candidate) => candidate.id === id);
				const output = this.snapshotOutputs.get(id);
				if (layer && output?.frames?.length > 1) { active = true; this.paintSnapshotElement(layer, element); }
			});
			if (active) this.snapshotPlaybackFrame = requestAnimationFrame(tick);
		};
		this.snapshotPlaybackFrame = requestAnimationFrame(tick);
	}

	applySnapshotVisibility(layersToShow) {
		this.editor.previewCanvas.style.visibility = '';
		// [data-filter-snapshot-hidden] hides by opacity in _workspace.scss so the
		// covered layers stay clickable under the snapshot.
		// The wrapper, not the elements container: the base image's sparkles sit
		// beside #previewCanvas (BaseBackgroundManager.renderSparkleElement).
		this.editor.previewWrapper.querySelectorAll('[data-filter-snapshot-hidden]').forEach((node) => {
			delete node.dataset.filterSnapshotHidden;
		});
		const tier3 = this.liveEditing ? [] : layersToShow.filter((layer) => layer.type === LayerType.FILTER && GlitterFilters.tier(layer.filterData) === 3 && this.snapshotOutputs.get(layer.id)?.frames?.length);
		this.layerElements.forEach((element, id) => {
			const canvas = element.querySelector('.filter-snapshot-canvas');
			if (canvas) canvas.style.visibility = tier3.some((layer) => layer.id === id) ? '' : 'hidden';
		});
		this.displayedSnapshotLayerId = null;
		if (!tier3.length) return;
		const top = tier3.reduce((winner, candidate) => this.editor.layers.indexOf(candidate) > this.editor.layers.indexOf(winner) ? candidate : winner);
		const topIndex = this.editor.layers.indexOf(top);
		this.displayedSnapshotLayerId = top.id;
		this.editor.previewCanvas.style.visibility = 'hidden';
		this.editor.layers.slice(0, topIndex).forEach((candidate) => {
			this.editor.previewWrapper.querySelectorAll(`[data-layer-id="${candidate.id}"]`).forEach((node) => {
				node.dataset.filterSnapshotHidden = 'true';
			});
		});
	}

	refreshSnapshots() {
		this.snapshotOutputs.clear();
		this.snapshotPending.clear();
		this.animatedPreviews.clear();
		const active = this.getActiveLayer();
		if (active) this.syncSnapshotControls(active);
		this.editor.requestPreviewUpdate();
	}

	removeLayerElement(layerId) {
		clearTimeout(this.snapshotTimers.get(layerId));
		this.snapshotTimers.delete(layerId);
		this.snapshotPending.delete(layerId);
		this.animatedPreviews.delete(layerId);
		this.snapshotInputs.delete(layerId);
		this.snapshotOutputs.delete(layerId);
		removeManagedLayerElement(this.layerElements, layerId);
	}

	releaseLayerResources(layer) {
		this.removeLayerElement(layer?.id);
	}

	clearElements() {
		this.layerElements.forEach((element) => element.remove());
		this.layerElements.clear();
		this.grainTileCache.clear();
		this.snapshotInputs.clear();
		this.snapshotOutputs.clear();
		this.snapshotTimers.forEach(clearTimeout);
		this.snapshotTimers.clear();
		this.snapshotPending.clear();
		this.animatedPreviews.clear();
		this.displayedSnapshotLayerId = null;
		this.snapshotCompositor.releaseDecodedSources();
		if (this.snapshotPlaybackFrame) cancelAnimationFrame(this.snapshotPlaybackFrame);
		this.snapshotPlaybackFrame = null;
	}

	buildExportPlan(layer, context) {
		return context.compositor._buildFilterExportPlan(layer);
	}
}
