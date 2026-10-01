const DOCUMENT_START_METHODS = {
setupImageListeners() {
		const imageUpload = document.getElementById('imageUpload');
		const projectUpload = document.getElementById('projectUpload');
		const workspaceStart = document.getElementById('workspaceStart');
		const openProjectBtn = document.getElementById('openProjectBtn');
		const openProjectSidebarBtn = document.getElementById('openProjectSidebarBtn');
		const openImageBtn = document.getElementById('openImageBtn');

		const openNewCanvasBtn = document.getElementById('openNewCanvasBtn');
		openNewCanvasBtn?.addEventListener('click', (event) => {
			event.stopPropagation();
			this.modalManager.open('newCanvasModal');
		});
		this.renderWorkspaceStartPresets();

		document.getElementById('workspaceStartTutorial')?.addEventListener('click', () => this.openGuideAt('getting-started'));
		document.getElementById('workspaceStartAbout')?.addEventListener('click', () => this.modalManager.open('aboutModal'));
		document.getElementById('workspaceStartWhatsNew')?.addEventListener('click', (event) => {
			try {
				localStorage.setItem('glitterEditor_welcomeLastSeenRelease', CONFIG.app.currentRelease);
			} catch (error) {
				console.warn('Failed to save the last-seen release:', error);
			}
			event.currentTarget.classList.remove('has-update');
			event.currentTarget.removeAttribute('aria-label');
			this.openDocumentAt('aboutModal', 'AboutVersionHistory');
		});

		openImageBtn?.addEventListener('click', () => imageUpload?.click());

		if (imageUpload) {
			imageUpload.addEventListener('change', (e) => this.loadImage(e));
		}

		if (projectUpload) {
			projectUpload.addEventListener('change', async (e) => {
				const file = e.target.files?.[0];
				if (!file) return;
				await this.openProjectFile(file);
				e.target.value = '';
			});
		}

		[openProjectBtn, openProjectSidebarBtn].forEach((button) => {
			if (button && projectUpload) {
				button.addEventListener('click', () => {
					projectUpload.click();
				});
			}
		});

		let dragDepth = 0;
		const setDropActive = (active) => {
			this.previewContainer?.classList.toggle('workspace-drop-active', active);
			workspaceStart?.classList.toggle('drag-over', active);
		};
		this.previewContainer?.addEventListener('dragenter', (event) => {
			if (!event.dataTransfer?.types?.includes('Files')) return;
			event.preventDefault();
			dragDepth += 1;
			setDropActive(true);
		});
		this.previewContainer?.addEventListener('dragover', (event) => {
			if (!event.dataTransfer?.types?.includes('Files')) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
		});
		this.previewContainer?.addEventListener('dragleave', () => {
			dragDepth = Math.max(0, dragDepth - 1);
			if (dragDepth === 0) setDropActive(false);
		});
		this.previewContainer?.addEventListener('drop', async (event) => {
			event.preventDefault();
			dragDepth = 0;
			setDropActive(false);
			const files = Array.from(event.dataTransfer?.files || []);
			if (!files.length) return;
			const project = files.find((file) => file.type === 'application/json' || file.name.toLowerCase().endsWith('.json'));
			if (project) {
				await this.openProjectFile(project);
				return;
			}
			const images = files.filter((file) => file.type.startsWith('image/'));
			if (!images.length) {
				this.showError('Drop an image or a saved Glitter project.');
				return;
			}
			if (!this.originalImage) {
				const loaded = await this.loadImage({ target: { files: [images.shift()] } });
				if (loaded === false || !this.originalImage) return;
			}
			for (const file of images) {
				const gate = this.layerManager.canAddLayers();
				if (!gate.ok) {
					this.showError(gate.reason);
					break;
				}
				const sticker = await this.stickerManager.handleUserUpload(file, { navigate: false });
				if (sticker && !sticker.error) await this.stickerManager.createStickerLayer(sticker.id);
			}
			if (images.length) this.updateStatus(images.length === 1 ? 'Image added as a new layer' : `${images.length} images added as new layers`);
		});

		this.syncDocumentStartState();
		window.addEventListener('imageLoaded', () => {
			this.syncDocumentStartState();
			this.fitDocumentToSettledWorkspace();
		});
		window.addEventListener('imageRemoved', () => this.syncDocumentStartState());
	}

,
	syncDocumentStartState() {
		const noDocument = !this.originalImage;
		const workspaceStart = document.getElementById('workspaceStart');
		if (workspaceStart) {
			workspaceStart.hidden = !noDocument;
			workspaceStart.setAttribute('aria-hidden', noDocument ? 'false' : 'true');
		}
		document.body.classList.toggle('no-document', noDocument);
	}

,
	// One-click blank canvases on the start card. Each tile uses the default
	// blank-document color; anything else goes through More Presets.
	renderWorkspaceStartPresets() {
		const host = document.getElementById('workspaceStartPresets');
		if (!host || host.dataset.rendered === 'true') return;
		host.dataset.rendered = 'true';
		const tiles = CONFIG.canvas.presets.filter((preset) => preset.quickStart).map((preset) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'action-card is-quiet workspace-start-preset';
			button.dataset.presetId = preset.id;
			button.setAttribute('aria-label', `New ${preset.label} canvas, ${preset.width} by ${preset.height} pixels`);
			const preview = document.createElement('span');
			preview.className = 'action-card-media workspace-start-preset-preview';
			const shape = document.createElement('span');
			shape.className = 'workspace-start-preset-shape';
			shape.style.aspectRatio = `${preset.width} / ${preset.height}`;
			preview.appendChild(shape);
			const label = document.createElement('strong');
			label.className = 'action-card-title';
			label.textContent = preset.label;
			const dimensions = document.createElement('span');
			dimensions.className = 'action-card-detail';
			dimensions.textContent = `${preset.width} × ${preset.height} px`;
			button.append(preview, label, dimensions);
			button.addEventListener('click', () => this.loadBlankImage(preset.width, preset.height));
			return button;
		});
		host.prepend(...tiles);
	}

,
	// With the startup Welcome gated off, an unseen release marks the start
	// card's "What's new" link instead of reopening the modal. A first visit
	// has nothing to compare against, so it records the release silently.
	syncWhatsNewMarker() {
		const link = document.getElementById('workspaceStartWhatsNew');
		if (!link) return;
		try {
			const storageKey = 'glitterEditor_welcomeLastSeenRelease';
			const lastSeenRelease = localStorage.getItem(storageKey);
			if (lastSeenRelease === null) localStorage.setItem(storageKey, CONFIG.app.currentRelease);
			const hasUnseenRelease = lastSeenRelease !== null && lastSeenRelease !== CONFIG.app.currentRelease;
			link.classList.toggle('has-update', hasUnseenRelease);
			if (hasUnseenRelease) link.setAttribute('aria-label', "What's new: new release available");
		} catch (error) {
			console.warn('Failed to check the last-seen release:', error);
		}
	}

,
	fitDocumentToSettledWorkspace() {
		if (!this.originalImage || !this.previewWrapper) return;
		this.previewWrapper.style.opacity = '0';
		this.previewWrapper.style.transition = 'none';
		requestAnimationFrame(() => requestAnimationFrame(() => {
			this.viewport.performResizeUpdate();
			this.viewport.resetZoomSmart();
			this.updateZoomUI();
			this.previewWrapper.style.transition = '';
			this.previewWrapper.style.opacity = '1';
		}));
	}

,
	renderNewCanvasPresets() {
		const host = document.getElementById('newCanvasPresets');
		if (!host || host.dataset.rendered === 'true') return;
		host.dataset.rendered = 'true';
		host.replaceChildren();
		// Display order. Templates load asynchronously and always come last.
		const groups = [
			{ id: 'classic', label: 'Web Classics' },
			{ id: 'general', label: 'General' },
			{ id: 'social', label: 'Social Media' }
		];
		groups.forEach((group) => {
			const presets = CONFIG.canvas.presets.filter((preset) => preset.group === group.id);
			if (!presets.length) return;
			const section = document.createElement('section');
			section.className = 'new-canvas-preset-group';
			const title = document.createElement('div');
			title.className = 'property-group-label';
			title.textContent = group.label;
			const grid = document.createElement('div');
			grid.className = 'blank-image-grid';
			presets.forEach((preset) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'action-card blank-image-option new-canvas-preset-btn';
				button.dataset.presetId = preset.id;
				button.dataset.width = preset.width;
				button.dataset.height = preset.height;
				button.setAttribute('aria-label', `${preset.label}, ${preset.width} by ${preset.height} pixels`);
				const previewWrapper = document.createElement('span');
				previewWrapper.className = 'action-card-media blank-preview-wrapper';
				const preview = document.createElement('span');
				preview.className = 'blank-preview';
				preview.style.aspectRatio = `${preset.width} / ${preset.height}`;
				preview.classList.toggle('wide', preset.width > preset.height);
				previewWrapper.appendChild(preview);
				const label = document.createElement('strong');
				label.className = 'action-card-title';
				label.textContent = preset.label;
				const dimensions = document.createElement('span');
				dimensions.className = 'action-card-detail';
				dimensions.textContent = `${preset.width} × ${preset.height}`;
				const detail = document.createElement('span');
				detail.className = 'action-card-detail blank-detail';
				detail.textContent = preset.detail;
				button.append(previewWrapper, label, dimensions, detail);
				grid.appendChild(button);
			});
			section.append(title, grid);
			host.appendChild(section);
		});
		TemplateLibrary.list('project').then((templates) => {
			if (!templates.length || host.querySelector('[data-template-group]')) return;
			const section = document.createElement('section');
			section.className = 'new-canvas-preset-group';
			section.dataset.templateGroup = '';
			const title = document.createElement('div');
			title.className = 'property-group-label';
			title.textContent = 'Templates';
			const grid = document.createElement('div');
			grid.className = 'blank-image-grid';
			templates.forEach((template) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'action-card blank-image-option new-canvas-template-btn';
				button.dataset.templateId = template.id;
				button.setAttribute('aria-pressed', 'false');
				button.setAttribute('aria-label', `${template.label} template`);
				const previewWrapper = document.createElement('span');
				previewWrapper.className = 'action-card-media blank-preview-wrapper template-preview-wrapper';
				const preview = document.createElement('span');
				preview.className = 'blank-preview template-preview';
				preview.style.aspectRatio = template.aspectRatio || '1 / 1';
				preview.style.background = template.preview || 'var(--color-bg-primary)';
				previewWrapper.appendChild(preview);
				const label = document.createElement('strong');
				label.className = 'action-card-title';
				label.textContent = template.label;
				const detail = document.createElement('span');
				detail.className = 'action-card-detail blank-detail';
				detail.textContent = template.description;
				button.append(previewWrapper, label, detail);
				grid.appendChild(button);
			});
			section.append(title, grid);
			host.appendChild(section);
		}).catch((error) => console.warn('Templates unavailable:', error));
	}

,
	// Color / Transparent is one segment; the color row shows only for Color,
	// the same contract as the canvas extension fill.
	setNewCanvasBackground(value) {
		document.querySelectorAll('#newCanvasBackground .segmented-option').forEach((option) => {
			const active = option.dataset.value === value;
			option.classList.toggle('active', active);
			option.setAttribute('aria-pressed', String(active));
		});
		const colorRow = document.getElementById('canvasColorRow');
		if (colorRow) colorRow.hidden = value !== 'color';
	}

,
	initializeNewCanvasModal() {
		this.renderNewCanvasPresets();
		const widthInput = document.getElementById('newCanvasWidth');
		const heightInput = document.getElementById('newCanvasHeight');
		const colorInput = document.getElementById('newCanvasColor');
		const presetButtons = document.querySelectorAll('.new-canvas-preset-btn');
		const host = document.getElementById('newCanvasPresets');
		delete host?.dataset.selectedTemplateId;
		host?.querySelectorAll('.new-canvas-template-btn').forEach((button) => {
			button.classList.remove('active');
			button.setAttribute('aria-pressed', 'false');
		});

		// Reset to defaults
		if (widthInput) widthInput.value = CONFIG.canvas.defaults.blankDocument.width;
		if (heightInput) heightInput.value = CONFIG.canvas.defaults.blankDocument.height;
		if (colorInput) colorInput.value = CONFIG.canvas.defaults.blankDocument.color;

		this.setNewCanvasBackground('color');

		// Find and activate matching preset
		let matchingPreset = null;
		presetButtons.forEach(btn => {
			btn.classList.remove('active');
			btn.setAttribute('aria-pressed', 'false');
			const width = parseInt(btn.dataset.width);
			const height = parseInt(btn.dataset.height);
			if (width === CONFIG.canvas.defaults.blankDocument.width && height === CONFIG.canvas.defaults.blankDocument.height) {
				matchingPreset = btn;
			}
		});

		if (matchingPreset) {
			matchingPreset.classList.add('active');
			matchingPreset.setAttribute('aria-pressed', 'true');
		}

		// Update orientation buttons based on default dimensions
		this.updateOrientationButtons(CONFIG.canvas.defaults.blankDocument.width, CONFIG.canvas.defaults.blankDocument.height);
	}

,
	setupNewCanvasModalListeners() {
		this.renderNewCanvasPresets();
		const createBtn = document.getElementById('createCanvasBtn');


		const widthInput = document.getElementById('newCanvasWidth');
		const heightInput = document.getElementById('newCanvasHeight');
		const colorInput = document.getElementById('newCanvasColor');
		const presetButtons = document.querySelectorAll('.new-canvas-preset-btn');
		const presetsHost = document.getElementById('newCanvasPresets');
		if (widthInput) widthInput.max = CONFIG.canvas.limits.maxWidth;
		if (heightInput) heightInput.max = CONFIG.canvas.limits.maxHeight;

		// Presets are a shortcut, not a mode: highlight tracks whether the current
		// dimensions exactly match a preset, so editing width/height/orientation
		// deselects and swapping back re-selects.
		const syncPresetHighlight = () => {
			const width = parseInt(widthInput?.value);
			const height = parseInt(heightInput?.value);
			presetButtons.forEach(btn => {
				const active = parseInt(btn.dataset.width) === width && parseInt(btn.dataset.height) === height;
				btn.classList.toggle('active', active);
				btn.setAttribute('aria-pressed', active ? 'true' : 'false');
			});
		};

		// Preset buttons
		presetButtons.forEach(btn => {
			btn.addEventListener('click', () => {
				delete presetsHost?.dataset.selectedTemplateId;
				presetsHost?.querySelectorAll('.new-canvas-template-btn').forEach((button) => {
					button.classList.remove('active');
					button.setAttribute('aria-pressed', 'false');
				});
				const width = parseInt(btn.dataset.width);
				const height = parseInt(btn.dataset.height);

				if (widthInput) widthInput.value = width;
				if (heightInput) heightInput.value = height;

				syncPresetHighlight();
				this.updateOrientationButtons(width, height);
			});
		});
		presetsHost?.addEventListener('click', (event) => {
			const button = event.target.closest('.new-canvas-template-btn');
			if (!button) return;
			presetsHost.dataset.selectedTemplateId = button.dataset.templateId;
			presetsHost.querySelectorAll('.new-canvas-template-btn').forEach((candidate) => {
				const active = candidate === button;
				candidate.classList.toggle('active', active);
				candidate.setAttribute('aria-pressed', active ? 'true' : 'false');
			});
			presetButtons.forEach((candidate) => {
				candidate.classList.remove('active');
				candidate.setAttribute('aria-pressed', 'false');
			});
		});

		// Orientation swaps the two dimensions; picking the current one does nothing.
		document.getElementById('newCanvasOrientation')?.addEventListener('click', (event) => {
			const option = event.target.closest('.segmented-option');
			if (!option || option.disabled) return;
			const width = parseInt(widthInput.value);
			const height = parseInt(heightInput.value);
			if (width === height || (option.dataset.value === 'portrait') === (height > width)) return;
			widthInput.value = height;
			heightInput.value = width;
			syncPresetHighlight();
			this.updateOrientationButtons(height, width);
		});

		// Dimension inputs
		if (widthInput && heightInput) {
			const updateOrientation = () => {
				syncPresetHighlight();
				this.updateOrientationButtons(parseInt(widthInput.value), parseInt(heightInput.value));
			};

			widthInput.addEventListener('input', updateOrientation);
			heightInput.addEventListener('input', updateOrientation);
		}

		document.getElementById('newCanvasBackground')?.addEventListener('click', (event) => {
			const option = event.target.closest('.segmented-option');
			if (option) this.setNewCanvasBackground(option.dataset.value);
		});

		// Create button
		if (createBtn) {
			createBtn.addEventListener('click', async () => {
				const templateId = presetsHost?.dataset.selectedTemplateId;
				if (templateId) {
					const loaded = await this.templateManager.applyProject(templateId);
					if (loaded) this.modalManager.close('newCanvasModal');
					return;
				}
				const width = parseInt(widthInput.value);
				const height = parseInt(heightInput.value);
				const { minSize, maxWidth, maxHeight } = CONFIG.canvas.limits;
				if (!Number.isInteger(width) || !Number.isInteger(height) ||
					width < minSize || height < minSize ||
					width > maxWidth || height > maxHeight) {
					this.showError(`Canvas dimensions must be between ${minSize} and ${maxWidth} pixels.`);
					return;
				}
				const backgroundType = document.querySelector('#newCanvasBackground .segmented-option.active')?.dataset.value;
				const color = backgroundType === 'transparent' ? 'transparent' : colorInput.value;

				await this.loadBlankImage(width, height, color);
				this.modalManager.close('newCanvasModal');
			});
		}

	}
};
