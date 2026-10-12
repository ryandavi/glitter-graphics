const DOCUMENT_START_METHODS = {
	whenBooted(stageId) { return APP_BOOT.whenBooted(stageId); },
setupImageListeners() {
		const imageUpload = document.getElementById('imageUpload');
		const projectUpload = document.getElementById('projectUpload');
		const workspaceStart = document.getElementById('workspaceStart');
		const openProjectBtn = document.getElementById('openProjectBtn');
		const openProjectMenuItem = document.getElementById('openProjectMenuItem');
		const openImageBtn = document.getElementById('openImageBtn');

		const openNewCanvasBtn = document.getElementById('openNewCanvasBtn');
		openNewCanvasBtn?.addEventListener('click', (event) => {
			event.stopPropagation();
			this.modalManager.open('newCanvasModal');
		});
		this.renderWorkspaceStartPresets();

		document.getElementById('workspaceStartTutorial')?.addEventListener('click', () => this.openGuideAt('getting-started'));
		document.querySelectorAll('#workspaceStartAbout, #appHeaderTitle').forEach((button) => {
			button.addEventListener('click', () => this.modalManager.open('aboutModal'));
		});
		document.getElementById('workspaceStartWhatsNew')?.addEventListener('click', (event) => {
			try {
				PREFERENCES.set('welcomeLastSeenRelease', CONFIG.app.currentRelease);
			} catch (error) {
				console.warn('Failed to save the last-seen release:', error);
			}
			event.currentTarget.classList.remove('has-update');
			event.currentTarget.removeAttribute('aria-label');
			this.openDocumentAt('aboutModal', 'AboutVersionHistory');
		});

		openImageBtn?.addEventListener('click', () => imageUpload?.click());

		if (imageUpload) {
			imageUpload.addEventListener('change', async (e) => {
				await openEditorFiles(this, Array.from(e.target.files || []), { asDocument: true });
				e.target.value = '';
			});
		}

		if (projectUpload) {
			projectUpload.addEventListener('change', async (e) => {
				const file = e.target.files?.[0];
				if (!file) return;
				await this.openProjectFile(file);
				e.target.value = '';
			});
		}

		[openProjectBtn, openProjectMenuItem].forEach((button) => {
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
			await openEditorFiles(this, files);
		});

		this.syncDocumentStartState();
		window.addEventListener('imageLoaded', () => {
			this.syncDocumentStartState();
			this.fitDocumentToSettledWorkspace();
		});
		window.addEventListener('imageRemoved', () => this.syncDocumentStartState());
	},

	syncDocumentStartState() {
		const noDocument = !this.originalImage;
		const workspaceStart = document.getElementById('workspaceStart');
		if (workspaceStart) {
			workspaceStart.hidden = !noDocument;
			workspaceStart.setAttribute('aria-hidden', noDocument ? 'false' : 'true');
		}
		document.body.classList.toggle('no-document', noDocument);
	},

	// One-click blank canvases on the start card. Each tile uses the default
	// blank-document color; anything else goes through More Presets.
	renderWorkspaceStartPresets() {
		const host = document.getElementById('workspaceStartPresets');
		if (!host || host.dataset.rendered === 'true') return;
		host.dataset.rendered = 'true';
		const morePresets = document.getElementById('openNewCanvasBtn');
		CONFIG.canvas.presets.filter((preset) => preset.quickStart).forEach((preset) => {
			let button = host.querySelector(`[data-preset-id="${preset.id}"]`);
			if (!button) {
				button = buildCanvasSizeCard(preset, { quickStart: true });
				host.insertBefore(button, morePresets);
			}
			button.addEventListener('click', () => this.createBlankCanvas(preset.width, preset.height));
		});
	},

	// With the startup Welcome gated off, an unseen release marks the start
	// card's "What's new" link instead of reopening the modal. A first visit
	// has nothing to compare against, so it records the release silently.
	syncWhatsNewMarker() {
		const link = document.getElementById('workspaceStartWhatsNew');
		if (!link) return;
		try {
			const lastSeenRelease = PREFERENCES.get('welcomeLastSeenRelease');
			if (lastSeenRelease === null) PREFERENCES.set('welcomeLastSeenRelease', CONFIG.app.currentRelease);
			const hasUnseenRelease = lastSeenRelease !== null && lastSeenRelease !== CONFIG.app.currentRelease;
			link.classList.toggle('has-update', hasUnseenRelease);
			if (hasUnseenRelease) link.setAttribute('aria-label', "What's new: new release available");
		} catch (error) {
			console.warn('Failed to check the last-seen release:', error);
		}
	},

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
	},

	renderNewCanvasPresets() {
		const host = document.getElementById('newCanvasPresets');
		if (!host || host.dataset.rendered === 'true') return;
		host.dataset.rendered = 'true';
		host.replaceChildren();
		CONFIG.canvas.presetGroups.forEach((group) => {
			const presets = CONFIG.canvas.presets.filter((preset) => preset.group === group.id);
			if (!presets.length) return;
			const grid = document.createElement('div');
			grid.className = 'blank-image-grid';
			presets.forEach((preset) => grid.appendChild(buildCanvasSizeCard(preset)));
			host.appendChild(buildCanvasPresetGroup(group.label, grid));
		});
		TemplateLibrary.list('project').then((templates) => {
			if (!templates.length || host.querySelector('[data-template-group]')) return;
			const grid = document.createElement('div');
			grid.className = 'blank-image-grid';
			templates.forEach((template) => {
				const previewWrapper = document.createElement('span');
				previewWrapper.className = 'action-card-media blank-preview-wrapper template-preview-wrapper';
				const preview = document.createElement('span');
				preview.className = 'blank-preview template-preview';
				preview.style.aspectRatio = template.aspectRatio || '1 / 1';
				preview.style.background = template.preview || 'var(--color-bg-primary)';
				previewWrapper.appendChild(preview);
				const button = buildActionCard({
					className: 'blank-image-option new-canvas-template-btn',
					dataset: { templateId: template.id }, pressed: false,
					ariaLabel: `${template.label} template`, media: previewWrapper,
					title: template.label, details: [{ text: template.description, className: 'blank-detail' }]
				});
				grid.appendChild(button);
			});
			const group = buildCanvasPresetGroup('Templates', grid);
			group.dataset.templateGroup = '';
			host.appendChild(group);
		}).catch((error) => console.warn('Templates unavailable:', error));
	},

	// The inactive color keeps its row so the phone's settings band cannot resize.
	setNewCanvasBackground(value) {
		document.querySelectorAll('#newCanvasBackground .segmented-option').forEach((option) => {
			const active = option.dataset.value === value;
			option.classList.toggle('active', active);
			option.setAttribute('aria-pressed', String(active));
		});
		const colorRow = document.getElementById('canvasColorRow');
		if (colorRow) {
			const unavailable = value !== 'color';
			colorRow.classList.toggle('is-unavailable', unavailable);
			colorRow.querySelectorAll('input, button').forEach(control => { control.disabled = unavailable; });
		}
	},

	async createBlankCanvas(width, height, color = CONFIG.canvas.defaults.blankDocument.color) {
		await this.loadBlankImage(width, height, color);
		PREFERENCES.set('recentCanvasSizes', pushRecent(PREFERENCES.get('recentCanvasSizes'),
			{ width, height }, CONFIG.canvas.recentSizeCount, (a, b) => a.width === b.width && a.height === b.height));
	},

	renderRecentCanvasSizes() {
		const host = document.getElementById('newCanvasPresets');
		host.querySelector('[data-recent-group]')?.remove();
		const sizes = PREFERENCES.get('recentCanvasSizes').filter(size => validateCanvasSize(size.width, size.height).ok);
		if (!sizes.length) return;
		const grid = panelDiv('blank-image-grid');
		sizes.forEach(size => {
			const preset = CONFIG.canvas.presets.find(preset => preset.width === size.width && preset.height === size.height);
			grid.appendChild(buildCanvasSizeCard({ ...size, label: preset?.label || 'Custom' }, { recent: true }));
		});
		const group = buildCanvasPresetGroup('Recent', grid);
		group.dataset.recentGroup = '';
		host.prepend(group);
		fitGridRow(grid);
	},

	syncNewCanvasSelection() {
		const host = document.getElementById('newCanvasPresets');
		const templateId = host.dataset.selectedTemplateId;
		const width = Number(document.getElementById('newCanvasWidth').value);
		const height = Number(document.getElementById('newCanvasHeight').value);
		host.querySelectorAll('.blank-image-option').forEach(button => {
			const active = templateId ? button.dataset.templateId === templateId
				: Number(button.dataset.width) === width && Number(button.dataset.height) === height;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		});
		const settings = document.getElementById('newCanvasSettingsSection');
		settings.inert = Boolean(templateId);
		settings.classList.toggle('is-unavailable', Boolean(templateId));
		document.getElementById('newCanvasTemplateNote').hidden = !templateId;
		document.querySelector('#createCanvasBtn .name').textContent = templateId ? 'Open Template' : 'Create Canvas';
		this.updateOrientationButtons(width, height);
	},

	initializeNewCanvasModal() {
		this.renderNewCanvasPresets();
		this.renderRecentCanvasSizes();
		delete document.getElementById('newCanvasPresets').dataset.selectedTemplateId;
		const defaults = CONFIG.canvas.defaults.blankDocument;
		document.getElementById('newCanvasWidth').value = defaults.width;
		document.getElementById('newCanvasHeight').value = defaults.height;
		document.getElementById('newCanvasColor').value = defaults.color;
		document.getElementById('newCanvasName').value = '';
		this.setNewCanvasBackground('color');
		this.syncNewCanvasSelection();
	},

	setupNewCanvasModalListeners() {
		this.renderNewCanvasPresets();
		const createBtn = document.getElementById('createCanvasBtn');

		const widthInput = document.getElementById('newCanvasWidth');
		const heightInput = document.getElementById('newCanvasHeight');
		const colorInput = document.getElementById('newCanvasColor');
		const nameInput = document.getElementById('newCanvasName');
		const projectNameInput = document.getElementById('projectNameInput');
		projectNameInput.maxLength = CONFIG.project.name.maxLength;
		projectNameInput.placeholder = CONFIG.project.name.placeholder;
		const presetsHost = document.getElementById('newCanvasPresets');
		if (widthInput) widthInput.max = CONFIG.canvas.limits.maxWidth;
		if (heightInput) heightInput.max = CONFIG.canvas.limits.maxHeight;

		presetsHost?.addEventListener('click', (event) => {
			const button = event.target.closest('.blank-image-option');
			if (!button || !presetsHost.contains(button)) return;
			if (button.dataset.templateId) {
				presetsHost.dataset.selectedTemplateId = button.dataset.templateId;
			} else {
				delete presetsHost.dataset.selectedTemplateId;
				widthInput.value = button.dataset.width;
				heightInput.value = button.dataset.height;
			}
			this.syncNewCanvasSelection();
		});
		presetsHost?.addEventListener('dblclick', (event) => {
			if (event.target.closest('.blank-image-option')) createBtn.click();
		});
		const recentGridObserver = new ResizeObserver(() => {
			fitGridRow(presetsHost.querySelector('[data-recent-group] .blank-image-grid'));
		});
		recentGridObserver.observe(presetsHost);

		// Orientation swaps the two dimensions; picking the current one does nothing.
		document.getElementById('newCanvasOrientation')?.addEventListener('click', (event) => {
			const option = event.target.closest('.segmented-option');
			if (!option || option.disabled) return;
			const width = parseInt(widthInput.value);
			const height = parseInt(heightInput.value);
			if (width === height || (option.dataset.value === 'portrait') === (height > width)) return;
			widthInput.value = height;
			heightInput.value = width;
			this.syncNewCanvasSelection();
		});

		// Dimension inputs
		if (widthInput && heightInput) {
			const updateOrientation = () => {
				this.syncNewCanvasSelection();
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
				const validation = validateCanvasSize(width, height);
				if (!validation.ok) { this.showError(validation.message); return; }
				const backgroundType = document.querySelector('#newCanvasBackground .segmented-option.active')?.dataset.value;
				const color = backgroundType === 'transparent' ? 'transparent' : colorInput.value;
				const name = nameInput.value.trim();

				await this.createBlankCanvas(width, height, color);
				this.setProjectName(name, { markDirty: false });
				this.modalManager.close('newCanvasModal');
			});
		}

	}
};
