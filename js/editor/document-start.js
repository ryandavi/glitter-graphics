// Start mark easter egg: clicking the mark throws old-web pixel sparkles (a
// cross that shrinks to a speck) and leaves a short trail behind the pointer.
// One overlay canvas exists only while sparkles are alive; nothing runs idle.
const START_SPARKLE = {
	burstCount: 36,
	burstSpeed: [90, 280],   // px/s
	burstLife: [900, 1600],  // ms
	trailFor: 1600,          // ms after a click that pointer moves leave sparkles
	trailEvery: 30,          // ms between trail sparkles
	trailLife: [700, 1200],
	gravity: 420,            // px/s²
	drag: 2.2,               // 1/s
	maxParticles: 180
};

const startSparkles = {
	canvas: null,
	ctx: null,
	particles: [],
	frame: 0,
	lastTime: 0,
	trailUntil: 0,
	lastTrail: 0,
	palette: null, // null = rainbow
	mark: null,

	// --start-sparkle-colors on .start-sparkles: a comma list, or `rainbow`.
	readPalette() {
		const value = getComputedStyle(this.canvas).getPropertyValue('--start-sparkle-colors').trim();
		if (!value || value === 'rainbow') return null;
		// Split on top-level commas only, so rgb(…) and color-mix(…) survive.
		const colors = [];
		let depth = 0;
		let start = 0;
		for (let i = 0; i < value.length; i++) {
			if (value[i] === '(') depth++;
			else if (value[i] === ')') depth--;
			else if (value[i] === ',' && depth === 0) {
				colors.push(value.slice(start, i).trim());
				start = i + 1;
			}
		}
		colors.push(value.slice(start).trim());
		return colors.filter(Boolean);
	},

	color() {
		if (this.palette?.length) return this.palette[Math.random() * this.palette.length | 0];
		// Rainbow: one channel full, two random, so always bright, never muddy.
		const channels = [255, Math.random() * 256 | 0, Math.random() * 256 | 0];
		for (let i = 2; i > 0; i--) {
			const j = Math.random() * (i + 1) | 0;
			[channels[i], channels[j]] = [channels[j], channels[i]];
		}
		return `rgb(${channels.join(',')})`;
	},

	between([min, max]) { return min + Math.random() * (max - min); },

	add(x, y, vx, vy, life) {
		if (this.particles.length >= START_SPARKLE.maxParticles) return;
		this.particles.push({ x, y, vx, vy, age: 0, life, color: this.color() });
	},

	burst(x, y, mark) {
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
		this.mark?.classList.remove('is-sparkling');
		this.mark = mark;
		this.mark?.classList.add('is-sparkling');
		this.start();
		this.palette = this.readPalette();
		for (let i = 0; i < START_SPARKLE.burstCount; i++) {
			const angle = (i / START_SPARKLE.burstCount) * Math.PI * 2 + Math.random() * 0.4;
			const speed = this.between(START_SPARKLE.burstSpeed);
			this.add(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed - 80, this.between(START_SPARKLE.burstLife));
		}
		this.trailUntil = performance.now() + START_SPARKLE.trailFor;
	},

	trail(event) {
		const now = performance.now();
		if (now > this.trailUntil || now - this.lastTrail < START_SPARKLE.trailEvery) return;
		this.lastTrail = now;
		this.add(event.clientX, event.clientY, this.between([-25, 25]), this.between([20, 90]), this.between(START_SPARKLE.trailLife));
		this.start();
	},

	start() {
		if (!this.canvas) {
			this.canvas = document.createElement('canvas');
			this.canvas.className = 'start-sparkles';
			this.canvas.setAttribute('aria-hidden', 'true');
			document.body.appendChild(this.canvas);
			this.ctx = this.canvas.getContext('2d');
			this.resize();
			this.onMove = (event) => this.trail(event);
			window.addEventListener('pointermove', this.onMove, { passive: true });
		}
		if (!this.frame) {
			this.lastTime = 0;
			this.frame = requestAnimationFrame((time) => this.step(time));
		}
	},

	resize() {
		const ratio = Math.min(window.devicePixelRatio || 1, 2);
		this.canvas.width = Math.round(window.innerWidth * ratio);
		this.canvas.height = Math.round(window.innerHeight * ratio);
		this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	},

	step(time) {
		this.frame = 0;
		if (time >= this.trailUntil) {
			this.mark?.classList.remove('is-sparkling');
			this.mark = null;
		}
		const delta = this.lastTime ? Math.min(time - this.lastTime, 50) : 16.7;
		this.lastTime = time;
		const seconds = delta / 1000;
		const damp = Math.exp(-START_SPARKLE.drag * seconds);
		const { ctx } = this;
		ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

		for (let i = this.particles.length - 1; i >= 0; i--) {
			const p = this.particles[i];
			p.age += delta;
			if (p.age >= p.life || p.y > window.innerHeight + 5) {
				this.particles.splice(i, 1);
				continue;
			}
			p.vx *= damp;
			p.vy = p.vy * damp + START_SPARKLE.gravity * seconds;
			p.x += p.vx * seconds;
			p.y += p.vy * seconds;

			const t = p.age / p.life;
			const px = Math.round(p.x);
			const py = Math.round(p.y);
			ctx.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : (Math.random() < 0.15 ? 0.45 : 1);
			ctx.fillStyle = p.color;
			if (t < 0.6) {
				// Cross sparkle, 5px then 3px.
				const size = t < 0.3 ? 5 : 3;
				const half = size >> 1;
				ctx.fillRect(px, py - half, 1, size);
				ctx.fillRect(px - half, py, size, 1);
			} else {
				const size = t < 0.8 ? 2 : 1;
				ctx.fillRect(px, py, size, size);
			}
		}
		ctx.globalAlpha = 1;

		if (this.particles.length || performance.now() < this.trailUntil) {
			this.frame = requestAnimationFrame((next) => this.step(next));
		} else {
			this.stop();
		}
	},

	stop() {
		this.mark?.classList.remove('is-sparkling');
		this.mark = null;
		window.removeEventListener('pointermove', this.onMove);
		this.canvas?.remove();
		this.canvas = null;
		this.ctx = null;
	}
};

const DOCUMENT_START_METHODS = {
	whenBooted(stageId) { return APP_BOOT.whenBooted(stageId); },
setupImageListeners() {
		const imageUpload = document.getElementById('imageUpload');
		const projectUpload = document.getElementById('projectUpload');
		const openProjectBtn = document.getElementById('openProjectBtn');
		const openProjectMenuItem = document.getElementById('openProjectMenuItem');

		// The base and the Welcome each draw the three open buttons; one handler
		// per action serves both.
		const openNewCanvas = (event) => {
			event.stopPropagation();
			this.modalManager.open('newCanvasModal');
		};
		['openNewCanvasBtn', 'startBlankCanvasBtn'].forEach((id) => document.getElementById(id)?.addEventListener('click', openNewCanvas));
		this.setupWorkspaceStartPresets();
		this.setupStartWelcome();

		document.getElementById('workspaceStartTutorial')?.addEventListener('click', () => this.openDocumentAt('guideModal', 'getting-started'));
		document.getElementById('workspaceStartAbout')?.addEventListener('click', () => this.modalManager.open('aboutModal'));
		document.getElementById('workspaceStartGuide')?.addEventListener('click', () => this.modalManager.open('guideModal'));
		document.getElementById('workspaceStartWhatsNew')?.addEventListener('click', (event) => {
			try {
				PREFERENCES.set('welcomeLastSeenRelease', CONFIG.app.currentRelease);
			} catch (error) {
				console.warn('Failed to save the last-seen release:', error);
			}
			event.currentTarget.classList.remove('has-update');
			event.currentTarget.removeAttribute('aria-label');
			this.modalManager.open('updatesModal');
		});

		['openImageBtn', 'welcomeOpenImageBtn'].forEach((id) => document.getElementById(id)?.addEventListener('click', () => imageUpload?.click()));
		// Take Photo renders from the first paint, disabled while the camera
		// check runs (enabled at once where the last visit found one), so the
		// row never re-centres. The menu item stays hidden without a camera.
		const takePhotoButtons = document.querySelectorAll('[data-take-photo]');
		const takePhotoMenuItem = document.getElementById('takePhotoMenuItem');
		const setTakePhotoState = (available, title) => takePhotoButtons.forEach((button) => {
			button.disabled = !available;
			if (title) button.title = title;
			else button.removeAttribute('title');
		});
		if (document.documentElement.classList.contains('has-camera-hint')) {
			setTakePhotoState(true);
			if (takePhotoMenuItem) takePhotoMenuItem.hidden = false;
		}
		[...takePhotoButtons, takePhotoMenuItem].filter(Boolean).forEach((button) => {
			button.addEventListener('click', () => COMMANDS.takePhoto.run(this));
		});
		CameraCapture.watchAvailability(() => {
			const supported = CameraCapture.isSupported();
			setTakePhotoState(supported, supported ? null : 'No camera found');
			if (takePhotoMenuItem) takePhotoMenuItem.hidden = !supported;
			document.documentElement.classList.remove('has-camera-hint');
			writeStartHint('hasCamera', supported);
		});

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

		[openProjectBtn, document.getElementById('welcomeOpenProjectBtn'), openProjectMenuItem].forEach((button) => {
			if (button && projectUpload) {
				button.addEventListener('click', () => {
					projectUpload.click();
				});
			}
		});

		let dragDepth = 0;
		const setDropActive = (active) => {
			this.previewContainer?.classList.toggle('workspace-drop-active', active);
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
		// Help → Show Welcome works on the start screen only, as Save works on
		// a document only.
		const showWelcome = document.getElementById('showWelcomeMenuItem');
		if (showWelcome) showWelcome.disabled = !noDocument;
		if (noDocument && this.recovery) this.refreshWorkspaceStartResume();
	},

	// The Welcome replaces the base while <html> lacks has-welcome-hidden (the
	// head script stamps it before first paint). Close hides it for the rest of
	// the tab's session; Help → Show Welcome brings it back.
	setStartWelcomeVisible(visible) {
		document.documentElement.classList.toggle('has-welcome-hidden', !visible);
		try {
			if (visible) sessionStorage.removeItem(WELCOME_CLOSED_KEY);
			else sessionStorage.setItem(WELCOME_CLOSED_KEY, '1');
		} catch (_error) { /* storage unavailable: the class still applies */ }
	},

	setupStartWelcome() {
		document.querySelectorAll('.start-mark').forEach(mark => mark.addEventListener('click', () => {
			const box = mark.getBoundingClientRect();
			startSparkles.burst(box.left + box.width / 2, box.top + box.height / 2, mark);
		}));
		document.getElementById('startWelcomeClose')?.addEventListener('click', () => {
			this.setStartWelcomeVisible(false);
			document.getElementById('openImageBtn')?.focus({ preventScroll: true });
		});
		document.getElementById('showWelcomeMenuItem')?.addEventListener('click', () => {
			if (this.originalImage) return;
			this.setStartWelcomeVisible(true);
			document.getElementById('startWelcomeClose')?.focus({ preventScroll: true });
		});
		// "Don't show again" is the inverse of the Welcome on Startup setting.
		// It never closes the card; Close does that.
		const dontShow = document.getElementById('welcomeDontShowAgain');
		if (dontShow) this.bindPreferenceControl(dontShow, 'showWelcomeOnStartup', { invert: true });
	},

	// Continue: one item per recovery draft, newest first, at most keepDrafts
	// (js/editor/document-recovery.js). The same items render as tiles under
	// the base and as a list in the Welcome rail. They read only the drafts'
	// summaries.
	async refreshWorkspaceStartResume() {
		const summaries = this.isRecoveryEnabled() && !this.originalImage ? await RECOVERY_STORE.listSummaries() : [];
		if (!this.originalImage) this.renderWorkspaceStartResume(summaries || []);
	},

	renderWorkspaceStartResume(summaries) {
		const drafts = summaries.slice(0, CONFIG.app.recovery.keepDrafts);
		const base = document.getElementById('workspaceStartResumeList');
		// Both lists share one object URL per thumbnail; the base list owns them.
		base?.querySelectorAll('[data-thumbnail-url]').forEach(item => URL.revokeObjectURL(item.dataset.thumbnailUrl));
		const thumbnails = new Map(drafts.filter(summary => summary.thumbnail).map(summary => [summary.id, URL.createObjectURL(summary.thumbnail)]));
		[['workspaceStartResume', base], ['welcomeResume', document.getElementById('welcomeResumeList')]].forEach(([sectionId, list]) => {
			const section = document.getElementById(sectionId);
			if (!section || !list) return;
			// Items fade in the first time they arrive; later re-renders don't.
			list.classList.toggle('is-arriving', list.dataset.rendered !== 'true' && drafts.length > 0);
			list.dataset.rendered = 'true';
			list.replaceChildren(...drafts.map(summary => this.buildWorkspaceStartDraft(summary, thumbnails.get(summary.id), list === base)));
			section.hidden = !drafts.length;
		});
	},

	buildWorkspaceStartDraft(summary, thumbnailUrl, ownsThumbnail) {
		const name = summary.name || CONFIG.project.name.placeholder;
		const { width, height } = summary.canvas;
		const edited = formatRelativeTime(summary.savedAt);
		const item = buildElement('list-row start-draft');
		item.tabIndex = 0;
		item.setAttribute('role', 'button');
		item.setAttribute('aria-label', `Resume ${name}, ${width} by ${height} pixels, edited ${edited}${summary.fileSaved ? '' : ', not saved to a file'}`);
		item.title = `${width} × ${height} px`;
		const media = item.appendChild(buildElement('list-row-media', undefined, 'span'));
		if (thumbnailUrl) {
			const image = media.appendChild(document.createElement('img'));
			image.alt = '';
			image.src = thumbnailUrl;
			if (ownsThumbnail) item.dataset.thumbnailUrl = thumbnailUrl;
		} else {
			media.classList.add('icon-wrapper');
			media.appendChild(createIcon('clock-history'));
		}
		const text = item.appendChild(buildElement('list-row-text', undefined, 'span'));
		text.appendChild(buildElement('list-row-name', name, 'span'));
		const meta = text.appendChild(buildElement('list-row-meta', undefined, 'span'));
		meta.appendChild(buildElement('', edited, 'span'));
		if (!summary.fileSaved) meta.appendChild(buildElement('start-draft-unsaved', 'not saved', 'span'));
		const actions = item.appendChild(buildElement('list-row-actions', undefined, 'span'));
		actions.appendChild(buildIconButton({
			className: 'btn-icon-simple icon-wrapper sm list-row-action',
			label: `Discard ${name}`,
			icon: 'trash',
			onClick: (event) => {
				event.stopPropagation();
				this.discardRecovery(summary.id);
			}
		}));
		item.addEventListener('click', () => this.resumeRecovery(summary.id));
		item.addEventListener('keydown', (event) => {
			if (event.target !== item || (event.key !== 'Enter' && event.key !== ' ')) return;
			event.preventDefault();
			this.resumeRecovery(summary.id);
		});
		return item;
	},

	// One-click blank canvases on the Welcome. The chips are generated at build
	// time (tools/build-shell.js); each uses the default blank-document color,
	// and anything else goes through Other size.
	setupWorkspaceStartPresets() {
		document.getElementById('workspaceStartPresets')?.addEventListener('click', (event) => {
			const id = event.target.closest('[data-preset-id]')?.dataset.presetId;
			const preset = id && CONFIG.canvas.presets.find((entry) => entry.id === id);
			if (preset) this.createBlankCanvas(preset.width, preset.height);
		});
	},

	// An unseen release marks the Welcome's "What's new" instead of opening
	// anything on load. A first visit has nothing to compare against, so it
	// records the release silently.
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
				const preview = buildAddEntrySample(template.sample || {}, 'template-preview');
				preview.style.aspectRatio = template.aspectRatio || '1 / 1';
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
		if (!await this.loadBlankImage(width, height, color)) return false;
		PREFERENCES.set('recentCanvasSizes', pushRecent(PREFERENCES.get('recentCanvasSizes'),
			{ width, height }, CONFIG.canvas.recentSizeCount, (a, b) => a.width === b.width && a.height === b.height));
		return true;
	},

	renderRecentCanvasSizes() {
		const host = document.getElementById('newCanvasPresets');
		host.querySelector('[data-recent-group]')?.remove();
		const sizes = PREFERENCES.get('recentCanvasSizes').filter(size => validateCanvasSize(size.width, size.height).ok);
		if (!sizes.length) return;
		const grid = buildElement('blank-image-grid');
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

	// The File size limit row: the choices come from the shared size-target list,
	// and Custom reveals the KB field.
	syncNewCanvasSizeLimit(limit = null) {
		const select = document.getElementById('newCanvasSizeLimit');
		if (select.options.length < 2) getSizeTargetOptions().forEach(({ value, label }) => {
			if (value !== 'none') select.add(new Option(label, value));
		});
		if (limit) {
			select.value = limit.targetSize;
			document.getElementById('newCanvasSizeLimitKB').value = limit.targetSizeKB;
		}
		document.getElementById('newCanvasSizeLimitKBRow').hidden = select.value !== 'custom';
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
		this.syncNewCanvasSizeLimit({ targetSize: CONFIG.export.defaults.targetSize, targetSizeKB: CONFIG.export.defaults.targetSizeKB });
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
				// A preset can carry its own limit; one without leaves the row as set.
				const sizeTarget = CONFIG.canvas.presets.find((preset) => preset.id === button.dataset.presetId)?.sizeTarget;
				if (sizeTarget) this.syncNewCanvasSizeLimit({ targetSize: sizeTarget, targetSizeKB: CONFIG.export.defaults.targetSizeKB });
			}
			this.syncNewCanvasSelection();
		});
		document.getElementById('newCanvasSizeLimit')?.addEventListener('change', () => this.syncNewCanvasSizeLimit());
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

				if (!await this.createBlankCanvas(width, height, color)) return;
				this.setDocumentSizeLimit({
					targetSize: document.getElementById('newCanvasSizeLimit').value,
					targetSizeKB: Number(document.getElementById('newCanvasSizeLimitKB').value)
				}, { markDirty: false });
				this.setProjectName(name, { markDirty: false });
				this.modalManager.close('newCanvasModal');
			});
		}

	}
};
