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
			const modal = document.getElementById('newCanvasModal');
			if (!modal) return;
			modal.classList.add('visible');
			this.initializeNewCanvasModal();
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
		host.className = 'new-canvas-preset-groups';
		host.replaceChildren();
		const groups = [
			{ id: 'classic', label: 'Web Classics' },
			{ id: 'social', label: 'Social Media' },
			{ id: 'general', label: 'General' }
		];
		groups.forEach((group) => {
			const presets = CONFIG.canvas.presets.filter((preset) => preset.group === group.id);
			if (!presets.length) return;
			const section = document.createElement('section');
			section.className = 'new-canvas-preset-group';
			const title = document.createElement('h3');
			title.className = 'new-canvas-preset-title';
			title.textContent = group.label;
			const grid = document.createElement('div');
			grid.className = 'blank-image-grid';
			presets.forEach((preset) => {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'blank-image-option new-canvas-preset-btn';
				button.dataset.presetId = preset.id;
				button.dataset.width = preset.width;
				button.dataset.height = preset.height;
				button.setAttribute('aria-label', `${preset.label}, ${preset.width} by ${preset.height} pixels`);
				const previewWrapper = document.createElement('span');
				previewWrapper.className = 'blank-preview-wrapper';
				const preview = document.createElement('span');
				preview.className = 'blank-preview';
				preview.style.aspectRatio = `${preset.width} / ${preset.height}`;
				preview.classList.toggle('wide', preset.width > preset.height);
				previewWrapper.appendChild(preview);
				const label = document.createElement('strong');
				label.className = 'blank-label';
				label.textContent = preset.label;
				const dimensions = document.createElement('span');
				dimensions.className = 'blank-dimensions';
				dimensions.textContent = `${preset.width} × ${preset.height}`;
				const detail = document.createElement('span');
				detail.className = 'blank-detail';
				detail.textContent = preset.detail;
				button.append(previewWrapper, label, dimensions, detail);
				grid.appendChild(button);
			});
			section.append(title, grid);
			host.appendChild(section);
		});
	}

,
	initializeNewCanvasModal() {
		this.renderNewCanvasPresets();
		const widthInput = document.getElementById('newCanvasWidth');
		const heightInput = document.getElementById('newCanvasHeight');
		const colorInput = document.getElementById('newCanvasColor');
		const presetButtons = document.querySelectorAll('.new-canvas-preset-btn');
		const backgroundRadios = document.querySelectorAll('input[name="canvasBackground"]');
		const colorRow = document.getElementById('canvasColorRow');

		// Reset to defaults
		if (widthInput) widthInput.value = CONFIG.canvas.defaults.blankDocument.width;
		if (heightInput) heightInput.value = CONFIG.canvas.defaults.blankDocument.height;
		if (colorInput) colorInput.value = CONFIG.canvas.defaults.blankDocument.color;

		// Reset background to "Color" option
		const colorRadio = document.querySelector('input[name="canvasBackground"][value="color"]');
		if (colorRadio) colorRadio.checked = true;

		// Enable color row since we default to color background
		if (colorRow) colorRow.classList.remove('disabled');

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
		const orientationPortrait = document.getElementById('orientationPortrait');
		const orientationLandscape = document.getElementById('orientationLandscape');
		const presetButtons = document.querySelectorAll('.new-canvas-preset-btn');
		const backgroundRadios = document.querySelectorAll('input[name="canvasBackground"]');
		const colorRow = document.getElementById('canvasColorRow');
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
				const width = parseInt(btn.dataset.width);
				const height = parseInt(btn.dataset.height);

				if (widthInput) widthInput.value = width;
				if (heightInput) heightInput.value = height;

				syncPresetHighlight();
				this.updateOrientationButtons(width, height);
			});
		});

		// Orientation toggle - Portrait
		if (orientationPortrait) {
			orientationPortrait.addEventListener('click', () => {
				const width = parseInt(widthInput.value);
				const height = parseInt(heightInput.value);

				if (width === height) return;

				if (width > height) {
					widthInput.value = height;
					heightInput.value = width;
				}

				syncPresetHighlight();
				this.updateOrientationButtons(parseInt(widthInput.value), parseInt(heightInput.value));
			});
		}

		// Orientation toggle - Landscape
		if (orientationLandscape) {
			orientationLandscape.addEventListener('click', () => {
				const width = parseInt(widthInput.value);
				const height = parseInt(heightInput.value);

				if (width === height) return;

				if (height > width) {
					widthInput.value = height;
					heightInput.value = width;
				}

				syncPresetHighlight();
				this.updateOrientationButtons(parseInt(widthInput.value), parseInt(heightInput.value));
			});
		}

		// Dimension inputs
		if (widthInput && heightInput) {
			const updateOrientation = () => {
				syncPresetHighlight();
				this.updateOrientationButtons(parseInt(widthInput.value), parseInt(heightInput.value));
			};

			widthInput.addEventListener('input', updateOrientation);
			heightInput.addEventListener('input', updateOrientation);
		}

		// Background type toggle
		backgroundRadios.forEach(radio => {
			radio.addEventListener('change', (e) => {
				if (colorRow) {
					colorRow.classList.toggle('disabled', radio.value !== 'color');
				}
			});
		});

		// Create button
		if (createBtn) {
			createBtn.addEventListener('click', async () => {
				const width = parseInt(widthInput.value);
				const height = parseInt(heightInput.value);
				if (!Number.isInteger(width) || !Number.isInteger(height) ||
					width < 100 || height < 100 ||
					width > CONFIG.canvas.limits.maxWidth || height > CONFIG.canvas.limits.maxHeight) {
					this.showError(`Canvas dimensions must be between 100 and ${CONFIG.canvas.limits.maxWidth} pixels.`);
					return;
				}
				const backgroundType = document.querySelector('input[name="canvasBackground"]:checked').value;
				const color = backgroundType === 'color' ? colorInput.value : 'transparent';

				await this.loadBlankImage(width, height, color);
				this.modalManager.close('newCanvasModal');
			});
		}

	}
};
